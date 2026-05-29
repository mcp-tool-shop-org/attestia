/**
 * Funding Gate — Dual-gate funding approval.
 *
 * Implements a strict two-approver gate for funding requests.
 * Both gatekeepers must approve before funds can be released.
 *
 * Rules:
 * - Exactly two gatekeepers configured per treasury
 * - Each gatekeeper can only approve once per request
 * - A single rejection kills the request
 * - Approval order doesn't matter
 * - Executed requests record in the ledger
 *
 * Separation of duties (D4-A-003):
 * - The requester may NOT approve any gate on their own request, even if they
 *   are also a configured gatekeeper. A gatekeeper who raised a request can
 *   still approve OTHER requests; they are only barred from self-satisfying a
 *   gate on the one they originated. Violations throw
 *   FundingError("REQUESTER_CANNOT_APPROVE"). This preserves the two-distinct-
 *   approver guarantee: a single person can never supply both the request and
 *   one of its two approvals. (Submission by a gatekeeper is permitted; the
 *   control is enforced at approval time.)
 */

import { Ledger } from "@attestia/ledger";
import type { Currency, LedgerEntry, Money } from "@attestia/types";
import type { FundingRequest, FundingGate, FundingStatus } from "./types.js";

// =============================================================================
// Error
// =============================================================================

export class FundingError extends Error {
  public readonly code: FundingErrorCode;
  constructor(code: FundingErrorCode, message: string) {
    super(message);
    this.name = "FundingError";
    this.code = code;
  }
}

export type FundingErrorCode =
  | "REQUEST_EXISTS"
  | "REQUEST_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "NOT_GATEKEEPER"
  | "ALREADY_APPROVED"
  | "DUPLICATE_GATEKEEPER"
  | "REQUESTER_CANNOT_APPROVE";

// =============================================================================
// Funding Gate
// =============================================================================

export class FundingGateManager {
  private readonly requests: Map<string, FundingRequest> = new Map();
  private readonly gatekeepers: readonly [string, string];

  constructor(
    gatekeepers: readonly [string, string],
    _currency: Currency,
    _decimals: number,
  ) {
    if (gatekeepers[0] === gatekeepers[1]) {
      throw new FundingError(
        "DUPLICATE_GATEKEEPER",
        "Two distinct gatekeepers are required",
      );
    }
    this.gatekeepers = gatekeepers;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Request management
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Submit a new funding request.
   */
  submitRequest(
    id: string,
    description: string,
    amount: Money,
    requestedBy: string,
  ): FundingRequest {
    if (this.requests.has(id)) {
      throw new FundingError("REQUEST_EXISTS", `Request '${id}' already exists`);
    }

    const request: FundingRequest = {
      id,
      description,
      amount,
      requestedBy,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.requests.set(id, request);
    return request;
  }

  getRequest(id: string): FundingRequest {
    const request = this.requests.get(id);
    if (!request) {
      throw new FundingError("REQUEST_NOT_FOUND", `Request '${id}' not found`);
    }
    return request;
  }

  listRequests(status?: FundingStatus): readonly FundingRequest[] {
    const all = [...this.requests.values()];
    return status ? all.filter((r) => r.status === status) : all;
  }

  /**
   * Approve a funding request. Requires one of the two gatekeepers.
   *
   * If this is the first approval → gate1-approved.
   * If this is the second approval → approved.
   */
  approveGate(
    id: string,
    approvedBy: string,
    reason?: string,
  ): FundingRequest {
    const request = this.getRequest(id);

    // Only gatekeepers can approve
    if (!this.isGatekeeper(approvedBy)) {
      throw new FundingError(
        "NOT_GATEKEEPER",
        `'${approvedBy}' is not a gatekeeper`,
      );
    }

    // Separation of duties: the requester cannot approve their own request,
    // even if they are also a gatekeeper. Otherwise a single person could
    // supply both the request and one of the two required approvals (D4-A-003).
    if (approvedBy === request.requestedBy) {
      throw new FundingError(
        "REQUESTER_CANNOT_APPROVE",
        `Requester cannot approve their own request '${id}' (separation of duties)`,
      );
    }

    // Check valid state
    if (request.status !== "pending" && request.status !== "gate1-approved") {
      throw new FundingError(
        "INVALID_TRANSITION",
        `Cannot approve request '${id}' in status '${request.status}'`,
      );
    }

    const gate: FundingGate = {
      approvedBy,
      approvedAt: new Date().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    };

    if (request.status === "pending") {
      // First gate
      const updated: FundingRequest = {
        ...request,
        status: "gate1-approved",
        gate1: gate,
      };
      this.requests.set(id, updated);
      return updated;
    }

    // Second gate — must be different gatekeeper
    if (request.gate1?.approvedBy === approvedBy) {
      throw new FundingError(
        "ALREADY_APPROVED",
        `'${approvedBy}' has already approved request '${id}'`,
      );
    }

    const updated: FundingRequest = {
      ...request,
      status: "approved",
      gate2: gate,
    };
    this.requests.set(id, updated);
    return updated;
  }

  /**
   * Reject a funding request. Any gatekeeper can reject.
   */
  rejectRequest(id: string, rejectedBy: string, reason?: string): FundingRequest {
    const request = this.getRequest(id);

    if (!this.isGatekeeper(rejectedBy)) {
      throw new FundingError(
        "NOT_GATEKEEPER",
        `'${rejectedBy}' is not a gatekeeper`,
      );
    }

    if (request.status === "rejected" || request.status === "executed" || request.status === "failed") {
      throw new FundingError(
        "INVALID_TRANSITION",
        `Cannot reject request '${id}' in status '${request.status}'`,
      );
    }

    const gate: FundingGate = {
      approvedBy: rejectedBy,
      approvedAt: new Date().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    };

    // Determine which gate slot to use for the rejection record
    const updated: FundingRequest = request.gate1
      ? { ...request, status: "rejected", gate2: gate }
      : { ...request, status: "rejected", gate1: gate };

    this.requests.set(id, updated);
    return updated;
  }

  /**
   * Execute an approved funding request, recording in the ledger.
   */
  executeRequest(id: string, ledger: Ledger): FundingRequest {
    const request = this.getRequest(id);

    if (request.status !== "approved") {
      throw new FundingError(
        "INVALID_TRANSITION",
        `Cannot execute request '${id}' in status '${request.status}' (must be 'approved')`,
      );
    }

    // Record in ledger: debit funding expense, credit treasury asset
    const treasuryAccountId = "treasury:main";
    const fundingAccountId = `funding:request:${request.id}`;

    if (!ledger.hasAccount(treasuryAccountId)) {
      ledger.registerAccount({
        id: treasuryAccountId,
        type: "asset",
        name: "Treasury Main Account",
      });
    }
    if (!ledger.hasAccount(fundingAccountId)) {
      ledger.registerAccount({
        id: fundingAccountId,
        type: "expense",
        name: `Funding: ${request.description}`,
      });
    }

    const now = new Date().toISOString();
    const corrId = `funding:${request.id}`;

    const entries: LedgerEntry[] = [
      {
        id: `${corrId}:debit`,
        accountId: fundingAccountId,
        type: "debit",
        money: request.amount,
        timestamp: now,
        correlationId: corrId,
      },
      {
        id: `${corrId}:credit`,
        accountId: treasuryAccountId,
        type: "credit",
        money: request.amount,
        timestamp: now,
        correlationId: corrId,
      },
    ];
    ledger.append(entries, {
      description: `Funding: ${request.description}`,
    });

    const executed: FundingRequest = {
      ...request,
      status: "executed",
      executedAt: new Date().toISOString(),
    };
    this.requests.set(id, executed);
    return executed;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal state access (for Treasury)
  // ─────────────────────────────────────────────────────────────────────

  exportRequests(): readonly FundingRequest[] {
    return [...this.requests.values()];
  }

  importRequests(requests: readonly FundingRequest[]): void {
    for (const r of requests) {
      this.requests.set(r.id, r);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Private
  // ───────────────────────────────────────────────────────────────────────

  private isGatekeeper(id: string): boolean {
    return this.gatekeepers.includes(id);
  }
}
