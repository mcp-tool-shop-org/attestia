/**
 * Intent Manager — Personal vault intent lifecycle.
 *
 * Manages the Intent → Approve → Execute → Verify flow for all
 * vault operations. Every financial action starts as an intent.
 *
 * Rules:
 * - Intents are append-only (state transitions, never deletion)
 * - Only valid transitions are allowed (declared→approved, etc.)
 * - Humans approve; the system verifies
 * - Each intent is linked to a budget envelope (when applicable)
 * - Failed intents can reverse budget reservations
 */

import type {
  IntentStatus,
  ChainId,
  TxHash,
  Money,
  Telemetry,
} from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
import { compareMoney } from "@attestia/ledger";
import { BudgetEngine } from "./budget.js";
import type {
  VaultIntent,
  VaultIntentKind,
  VaultIntentParams,
  VaultIntentApproval,
  VaultIntentExecution,
  VaultIntentVerification,
} from "./types.js";

// =============================================================================
// Error
// =============================================================================

export class IntentError extends Error {
  public readonly code: IntentErrorCode;
  constructor(code: IntentErrorCode, message: string) {
    super(message);
    this.name = "IntentError";
    this.code = code;
  }
}

export type IntentErrorCode =
  | "INTENT_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "ALREADY_EXISTS"
  | "BUDGET_EXCEEDED"
  | "VALIDATION_FAILED"
  | "IMPORT_NOT_EMPTY"
  | "DUPLICATE_IMPORT_ID";

// =============================================================================
// Valid Transitions
// =============================================================================

const VALID_TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  declared: ["approved", "rejected"],
  approved: ["executing", "rejected"],
  rejected: [],
  executing: ["executed", "failed"],
  executed: ["verified", "failed"],
  verified: [],
  failed: [],
};

// =============================================================================
// Intent Manager
// =============================================================================

export class IntentManager {
  private readonly intents: Map<string, VaultIntent> = new Map();
  private readonly budget: BudgetEngine;
  private readonly telemetry: Telemetry;

  /**
   * @param telemetry Optional observability sink (D4-B-001). Defaults to
   *   {@link NOOP_TELEMETRY}. Lifecycle transitions emit `intent.transition`
   *   with `{ from, to }` status attributes (both low-cardinality enums); the
   *   raw intent id goes in `message`, never `attributes`.
   */
  constructor(budget: BudgetEngine, telemetry: Telemetry = NOOP_TELEMETRY) {
    this.budget = budget;
    this.telemetry = telemetry;
  }

  /**
   * Emit a lifecycle transition event. `from`/`to` are status enums (safe as
   * metric labels); the high-cardinality intent id stays in `message`.
   */
  private emitTransition(
    id: string,
    from: IntentStatus,
    to: IntentStatus,
  ): void {
    this.telemetry.record({
      package: "@attestia/vault",
      op: "intent.transition",
      level: "info",
      attributes: { from, to },
      message: `intent '${id}' ${from} -> ${to}`,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Declare a new intent. This is the first step in any vault operation.
   *
   * If the intent references a budget envelope and has an amount,
   * the budget engine checks for sufficient available funds.
   */
  declare(
    id: string,
    kind: VaultIntentKind,
    description: string,
    declaredBy: string,
    params: VaultIntentParams,
    envelopeId?: string,
  ): VaultIntent {
    if (this.intents.has(id)) {
      throw new IntentError("ALREADY_EXISTS", `Intent '${id}' already exists`);
    }

    // Pre-check: if linked to an envelope and has an amount, verify budget
    if (envelopeId && params.amount) {
      const envelope = this.budget.getEnvelope(envelopeId);
      const available: Money = {
        amount: envelope.available,
        currency: envelope.currency,
        decimals: envelope.decimals,
      };

      // Use BigInt-safe comparison from @attestia/ledger (no floating-point)
      if (compareMoney(params.amount, available) > 0) {
        // Surface the rejection before throwing: a misconfigured automation
        // repeatedly declaring over-budget intents should be visible to
        // monitoring. Reason is a low-cardinality enum; the id/amounts stay in
        // `message`.
        this.telemetry.record({
          package: "@attestia/vault",
          op: "intent.declare",
          level: "warn",
          outcome: "degraded",
          attributes: { reason: "BUDGET_EXCEEDED" },
          message: `intent '${id}' declare rejected: needs ${params.amount.amount} ${params.amount.currency} but envelope '${envelopeId}' has ${envelope.available} available`,
        });
        throw new IntentError(
          "BUDGET_EXCEEDED",
          `Intent requires ${params.amount.amount} ${params.amount.currency} but envelope '${envelopeId}' only has ${envelope.available} available`,
        );
      }
    }

    const base = {
      id,
      status: "declared" as const,
      kind,
      description,
      declaredBy,
      declaredAt: new Date().toISOString(),
      params,
    };
    const intent: VaultIntent = envelopeId !== undefined
      ? { ...base, envelopeId }
      : base;

    this.intents.set(id, intent);
    return intent;
  }

  /**
   * Approve an intent. Requires human authorization.
   */
  approve(
    intentId: string,
    approvedBy: string,
    reason?: string,
  ): VaultIntent {
    const intent = this.requireIntent(intentId);
    this.assertTransition(intent, "approved");

    const approvalBase = {
      approvedBy,
      approvedAt: new Date().toISOString(),
      approved: true as const,
    };
    const approval: VaultIntentApproval = reason !== undefined
      ? { ...approvalBase, reason }
      : approvalBase;

    const updated: VaultIntent = {
      ...intent,
      status: "approved",
      approval,
    };

    this.intents.set(intentId, updated);
    this.emitTransition(intentId, intent.status, "approved");
    return updated;
  }

  /**
   * Reject an intent.
   */
  reject(
    intentId: string,
    rejectedBy: string,
    reason: string,
  ): VaultIntent {
    const intent = this.requireIntent(intentId);
    this.assertTransition(intent, "rejected");

    const approval: VaultIntentApproval = {
      approvedBy: rejectedBy,
      approvedAt: new Date().toISOString(),
      approved: false,
      reason,
    };

    const updated: VaultIntent = {
      ...intent,
      status: "rejected",
      approval,
    };

    this.intents.set(intentId, updated);
    this.emitTransition(intentId, intent.status, "rejected");
    return updated;
  }

  /**
   * Mark an intent as executing (on-chain tx submitted).
   */
  markExecuting(intentId: string): VaultIntent {
    const intent = this.requireIntent(intentId);
    this.assertTransition(intent, "executing");

    const updated: VaultIntent = {
      ...intent,
      status: "executing",
    };

    this.intents.set(intentId, updated);
    this.emitTransition(intentId, intent.status, "executing");
    return updated;
  }

  /**
   * Record successful execution.
   * This also debits the budget envelope (if applicable).
   */
  recordExecution(
    intentId: string,
    chainId: ChainId,
    txHash: TxHash,
  ): VaultIntent {
    const intent = this.requireIntent(intentId);
    this.assertTransition(intent, "executed");

    const execution: VaultIntentExecution = {
      executedAt: new Date().toISOString(),
      chainId,
      txHash,
    };

    // Debit the budget envelope
    if (intent.envelopeId && intent.params.amount) {
      this.budget.spend(intent.envelopeId, intent.params.amount);
    }

    const updated: VaultIntent = {
      ...intent,
      status: "executed",
      execution,
    };

    this.intents.set(intentId, updated);
    this.emitTransition(intentId, intent.status, "executed");
    return updated;
  }

  /**
   * Verify an executed intent against on-chain state.
   */
  verify(
    intentId: string,
    matched: boolean,
    discrepancies?: readonly string[],
  ): VaultIntent {
    const intent = this.requireIntent(intentId);
    this.assertTransition(intent, "verified");

    const verificationBase = {
      verifiedAt: new Date().toISOString(),
      matched,
    };
    const verification: VaultIntentVerification = discrepancies !== undefined
      ? { ...verificationBase, discrepancies }
      : verificationBase;

    const updated: VaultIntent = {
      ...intent,
      status: "verified",
      verification,
    };

    this.intents.set(intentId, updated);
    // `matched` is low-cardinality (boolean) and meaningful for verification —
    // surface it both as a transition attribute and a coarse outcome.
    this.telemetry.record({
      package: "@attestia/vault",
      op: "intent.transition",
      level: matched ? "info" : "warn",
      outcome: matched ? "ok" : "degraded",
      attributes: { from: intent.status, to: "verified", matched },
      message: `intent '${intentId}' ${intent.status} -> verified (matched=${matched})`,
    });
    return updated;
  }

  /**
   * Record intent failure.
   * If the intent had budget reserved, the spend is reversed.
   */
  recordFailure(
    intentId: string,
    discrepancies: readonly string[],
  ): VaultIntent {
    const intent = this.requireIntent(intentId);
    this.assertTransition(intent, "failed");

    // Reverse budget spend if already executed and linked to envelope
    if (
      intent.status === "executed" &&
      intent.envelopeId &&
      intent.params.amount
    ) {
      this.budget.reverseSpend(intent.envelopeId, intent.params.amount);
    }

    const verification: VaultIntentVerification = {
      verifiedAt: new Date().toISOString(),
      matched: false,
      discrepancies,
    };

    const priorStatus = intent.status;
    const updated: VaultIntent = {
      ...intent,
      status: "failed",
      verification,
    };

    this.intents.set(intentId, updated);
    this.telemetry.record({
      package: "@attestia/vault",
      op: "intent.transition",
      level: "error",
      outcome: "failed",
      attributes: { from: priorStatus, to: "failed" },
      message: `intent '${intentId}' ${priorStatus} -> failed`,
    });
    return updated;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Queries
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get an intent by ID.
   */
  getIntent(id: string): VaultIntent | undefined {
    return this.intents.get(id);
  }

  /**
   * List all intents, optionally filtered by status.
   */
  listIntents(status?: IntentStatus): readonly VaultIntent[] {
    const all = [...this.intents.values()];
    return status ? all.filter((i) => i.status === status) : all;
  }

  /**
   * List intents for a specific envelope.
   */
  listByEnvelope(envelopeId: string): readonly VaultIntent[] {
    return [...this.intents.values()].filter(
      (i) => i.envelopeId === envelopeId,
    );
  }

  /**
   * Total number of intents.
   */
  get count(): number {
    return this.intents.size;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Snapshot
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Export all intents for persistence.
   */
  exportIntents(): readonly VaultIntent[] {
    return [...this.intents.values()];
  }

  /**
   * Restore intents from a snapshot.
   *
   * Restore is into a FRESH manager: importing over existing state would
   * silently overwrite live intents by id, and a duplicate id within the
   * incoming batch would silently keep only the last record. Both are caller
   * bugs / snapshot corruption — fail closed rather than admit them.
   */
  importIntents(intents: readonly VaultIntent[]): void {
    if (this.intents.size > 0) {
      throw new IntentError(
        "IMPORT_NOT_EMPTY",
        `Cannot import intents into a non-empty manager (${this.intents.size} already present) — restore into a fresh IntentManager`,
      );
    }
    const seen = new Set<string>();
    for (const intent of intents) {
      if (seen.has(intent.id)) {
        throw new IntentError(
          "DUPLICATE_IMPORT_ID",
          `Duplicate intent id '${intent.id}' in imported snapshot`,
        );
      }
      seen.add(intent.id);
      this.intents.set(intent.id, intent);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Private
  // ───────────────────────────────────────────────────────────────────────

  private requireIntent(id: string): VaultIntent {
    const intent = this.intents.get(id);
    if (!intent) {
      throw new IntentError("INTENT_NOT_FOUND", `Intent '${id}' not found`);
    }
    return intent;
  }

  private assertTransition(intent: VaultIntent, target: IntentStatus): void {
    // `?? []` future-proofs against a new IntentStatus added to the
    // @attestia/types enum that is missing a key here: instead of throwing an
    // opaque "cannot read includes of undefined", an unknown status yields an
    // empty allow-list and a clean INVALID_TRANSITION below.
    const allowed = VALID_TRANSITIONS[intent.status] ?? [];
    if (!allowed.includes(target)) {
      // A wedged state machine (e.g. a retry loop on an invalid transition) is
      // operationally interesting — surface it before throwing. from/to are
      // low-cardinality status enums; the intent id stays in `message`.
      this.telemetry.record({
        package: "@attestia/vault",
        op: "intent.transition",
        level: "warn",
        outcome: "degraded",
        attributes: { from: intent.status, to: target, reason: "INVALID_TRANSITION" },
        message: `intent '${intent.id}' rejected transition ${intent.status} -> ${target}`,
      });
      throw new IntentError(
        "INVALID_TRANSITION",
        `Cannot transition intent '${intent.id}' from '${intent.status}' to '${target}'`,
      );
    }
  }
}
