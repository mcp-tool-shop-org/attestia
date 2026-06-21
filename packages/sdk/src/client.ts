/**
 * @attestia/sdk — Attestia Client.
 *
 * Main entry point for the Attestia SDK.
 *
 * Provides typed methods for:
 * - Intent lifecycle (declare, approve, reject, execute, verify)
 * - Verification (state hash, replay)
 * - Proof operations (get attestation proof, verify proof)
 *
 * Design:
 * - Delegates to HttpClient for transport
 * - Namespace grouping: client.intents, client.verify, client.proofs
 * - All methods return typed responses
 * - Pagination via cursor strings
 */

import type { AttestiaClientConfig, AttestiaResponse, PaginatedList } from "./types.js";
import { HttpClient } from "./http-client.js";

// =============================================================================
// Domain Types (SDK-specific; mirrors the server types)
// =============================================================================

/**
 * Intent status values as returned by the API.
 */
export type IntentStatus =
  | "declared"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "verified"
  | "failed";

/**
 * Money amount representation.
 */
export interface Money {
  readonly amount: string;
  readonly currency: string;
  readonly decimals: number;
}

/**
 * Intent parameters.
 */
export interface IntentParams {
  readonly fromChainId?: string | undefined;
  readonly toChainId?: string | undefined;
  readonly fromAddress?: string | undefined;
  readonly toAddress?: string | undefined;
  readonly amount?: Money | undefined;
  readonly receiveToken?: string | undefined;
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Intent kind values.
 */
export type IntentKind =
  | "transfer"
  | "swap"
  | "allocate"
  | "deallocate"
  | "bridge"
  | "stake"
  | "unstake";

/**
 * Intent as returned by the API.
 */
export interface Intent {
  readonly id: string;
  readonly status: IntentStatus;
  readonly kind: IntentKind;
  readonly description: string;
  readonly declaredBy: string;
  readonly declaredAt: string;
  readonly params: IntentParams;
}

/**
 * Parameters for declaring a new intent.
 */
export interface DeclareIntentParams {
  readonly id: string;
  readonly kind: IntentKind;
  readonly description: string;
  readonly params: IntentParams;
  readonly envelopeId?: string | undefined;
}

/**
 * Parameters for listing intents.
 */
export interface ListIntentsParams {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  readonly status?: IntentStatus | undefined;
}

/**
 * Global state hash response.
 */
export interface GlobalStateHash {
  readonly hash: string;
  readonly computedAt: string;
}

/**
 * Replay verification input.
 */
export interface ReplayInput {
  readonly ledgerSnapshot: Record<string, unknown>;
  readonly registrumSnapshot: Record<string, unknown>;
  readonly expectedHash?: string | undefined;
}

/**
 * Replay verification result.
 */
export interface ReplayResult {
  readonly match: boolean;
  readonly computedHash: string;
  readonly expectedHash: string;
  readonly details: Record<string, unknown>;
}

/**
 * Merkle proof step.
 */
export interface MerkleProofStep {
  readonly hash: string;
  readonly direction: "left" | "right";
}

/**
 * Attestation proof package (self-contained, portable).
 */
export interface AttestationProofPackage {
  readonly version: 1;
  readonly attestation: unknown;
  readonly attestationHash: string;
  readonly merkleRoot: string;
  readonly inclusionProof: {
    readonly leafHash: string;
    readonly leafIndex: number;
    readonly siblings: readonly MerkleProofStep[];
    readonly root: string;
  };
  readonly packagedAt: string;
  readonly packageHash: string;
}

/**
 * Proof verification result.
 */
export interface ProofVerificationResult {
  readonly valid: boolean;
  readonly verifiedAt: string;
}

/**
 * Merkle root response.
 */
export interface MerkleRootInfo {
  readonly merkleRoot: string;
  readonly leafCount: number;
  readonly computedAt: string;
}

// =============================================================================
// Treasury Domain Types (mirrors the server's treasury package)
// =============================================================================

/** Payroll run lifecycle status. */
export type PayrollRunStatus = "draft" | "approved" | "executed" | "failed";

/** A pay period — the window a payroll run settles. */
export interface PayPeriod {
  readonly start: string; // ISO 8601 date
  readonly end: string; // ISO 8601 date
  readonly label: string; // e.g. "2025-Q1", "2025-Jan"
}

/** A resolved payroll entry for one payee in a run. */
export interface PayrollEntry {
  readonly payeeId: string;
  readonly grossPay: Money;
  readonly deductions: Money;
  readonly netPay: Money;
  readonly components: readonly {
    readonly componentId: string;
    readonly name: string;
    readonly type: string;
    readonly amount: Money;
  }[];
}

/** A payroll run as returned by the API. */
export interface PayrollRun {
  readonly id: string;
  readonly period: PayPeriod;
  readonly status: PayrollRunStatus;
  readonly entries: readonly PayrollEntry[];
  readonly totalGross: Money;
  readonly totalDeductions: Money;
  readonly totalNet: Money;
  readonly createdAt: string;
  readonly executedAt?: string | undefined;
}

/** Parameters for creating a payroll run. */
export interface CreatePayrollRunParams {
  readonly id: string;
  readonly period: PayPeriod;
}

/** Distribution strategy. */
export type DistributionStrategy = "proportional" | "fixed" | "milestone";

/** Distribution plan lifecycle status. */
export type DistributionStatus = "draft" | "approved" | "executed" | "failed";

/** A recipient in a distribution plan. */
export interface DistributionRecipient {
  readonly payeeId: string;
  /** Basis points for proportional/milestone, or a fallback amount for fixed. */
  readonly share?: number | undefined;
  /** Precision-safe payout for the fixed strategy. */
  readonly amount?: Money | undefined;
  readonly milestoneMet?: boolean | undefined;
}

/** A distribution plan as returned by the API. */
export interface DistributionPlan {
  readonly id: string;
  readonly name: string;
  readonly strategy: DistributionStrategy;
  readonly pool: Money;
  readonly recipients: readonly DistributionRecipient[];
  readonly status: DistributionStatus;
  readonly createdAt: string;
  readonly executedAt?: string | undefined;
}

/** Parameters for creating a distribution plan. */
export interface CreateDistributionParams {
  readonly id: string;
  readonly name: string;
  readonly strategy: DistributionStrategy;
  readonly pool: Money;
  readonly recipients: readonly DistributionRecipient[];
}

/** A single computed payout in a distribution result. */
export interface DistributionPayout {
  readonly payeeId: string;
  readonly amount: Money;
}

/** The result of computing/executing a distribution plan. */
export interface DistributionResult {
  readonly planId: string;
  readonly payouts: readonly DistributionPayout[];
  readonly totalDistributed: Money;
  readonly remainder: Money;
}

/** Funding request lifecycle status. */
export type FundingStatus =
  | "pending"
  | "gate1-approved"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

/** An approval gate — one of the two required signatures. */
export interface FundingGate {
  readonly approvedBy: string;
  readonly reason?: string | undefined;
  readonly approvedAt: string;
}

/** A dual-gate funding request as returned by the API. */
export interface FundingRequest {
  readonly id: string;
  readonly description: string;
  readonly amount: Money;
  readonly requestedBy: string;
  readonly status: FundingStatus;
  readonly gate1?: FundingGate | undefined;
  readonly gate2?: FundingGate | undefined;
  readonly createdAt: string;
  readonly executedAt?: string | undefined;
}

/** Parameters for submitting a funding request. */
export interface SubmitFundingParams {
  readonly id: string;
  readonly description: string;
  readonly amount: Money;
  readonly requestedBy: string;
}

// =============================================================================
// Vault Domain Types (mirrors the server's vault package)
// =============================================================================

/** A budget envelope as returned by the API. */
export interface Envelope {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly decimals: number;
  readonly allocated: string;
  readonly spent?: string | undefined;
  readonly available?: string | undefined;
  readonly category?: string | undefined;
}

/** Parameters for creating a budget envelope. */
export interface CreateEnvelopeParams {
  readonly id: string;
  readonly name: string;
  readonly category?: string | undefined;
}

/** The aggregate budget snapshot across all envelopes. */
export interface BudgetSnapshot {
  readonly ownerId: string;
  readonly envelopes: readonly Envelope[];
  readonly totalAllocated: string;
  readonly totalSpent: string;
  readonly totalAvailable: string;
  readonly currency: string;
  readonly asOf: string;
}

/** A single token position in the portfolio. */
export interface TokenPosition {
  readonly currency: string;
  readonly amount: string;
  readonly chainId?: string | undefined;
}

/** A multi-chain portfolio snapshot. */
export interface Portfolio {
  readonly ownerId: string;
  readonly nativePositions: readonly TokenPosition[];
  readonly tokenPositions: readonly TokenPosition[];
  readonly observedAt: string;
  readonly totals: readonly { readonly currency: string; readonly amount: string }[];
}

// =============================================================================
// Governance Domain Types (mirrors the server's witness/governance package)
// =============================================================================

/** A single signer in the governance policy. */
export interface SignerEntry {
  readonly address: string;
  readonly label: string;
  readonly weight: number;
  readonly publicKey?: string | undefined;
}

/** The current multi-sig governance policy. */
export interface GovernancePolicy {
  readonly id: string;
  readonly version: number;
  readonly signers: readonly SignerEntry[];
  readonly quorum: number;
  readonly updatedAt: string;
}

/** Parameters for adding a governance signer. */
export interface AddSignerParams {
  readonly address: string;
  readonly label: string;
  readonly weight?: number | undefined;
  readonly publicKey?: string | undefined;
}

/** Parameters for paginated list endpoints (cursor + limit). */
export interface ListPageParams {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

// =============================================================================
// Auto-Pagination Helper
// =============================================================================

/**
 * Transparently walk every page of a cursor-paginated endpoint.
 *
 * `fetchPage` is called with the current cursor (`undefined` for the first
 * page) and must resolve to one {@link PaginatedList} page. The generator
 * yields each item in order, then follows `pagination.cursor` to the next page
 * until the server signals exhaustion (`hasMore === false` or a missing
 * cursor). Used by the `iterate()` method on every list namespace so callers
 * can `for await (const item of client.treasury.payrollRuns.iterate())` without
 * managing cursors by hand.
 */
export async function* paginateAll<T>(
  fetchPage: (cursor: string | undefined) => Promise<PaginatedList<T>>,
): AsyncGenerator<T, void, void> {
  let cursor: string | undefined = undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.data) {
      yield item;
    }
    // Stop when the server says there are no more pages, or when it stops
    // handing back a cursor (a defensive guard against an infinite loop if a
    // server ever returns hasMore:true without a next cursor). The server sends
    // `cursor: null` on the final page, so coalesce any nullish cursor to
    // `undefined` to terminate the loop cleanly.
    const next = page.pagination.hasMore ? page.pagination.cursor : undefined;
    cursor = next ?? undefined;
  } while (cursor !== undefined);
}

// =============================================================================
// Namespace Classes
// =============================================================================

/**
 * Intent operations namespace.
 */
export class IntentsNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Declare a new intent.
   */
  async declare(params: DeclareIntentParams): Promise<AttestiaResponse<Intent>> {
    const result = await this.http.post<Intent>("/api/v1/intents", params);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Get a single intent by ID.
   */
  async get(id: string): Promise<AttestiaResponse<Intent>> {
    const result = await this.http.get<Intent>(`/api/v1/intents/${encodeURIComponent(id)}`);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * List intents with cursor pagination.
   */
  async list(params?: ListIntentsParams): Promise<AttestiaResponse<PaginatedList<Intent>>> {
    const query = new URLSearchParams();
    if (params?.cursor !== undefined) query.set("cursor", params.cursor);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.status !== undefined) query.set("status", params.status);

    const qs = query.toString();
    const path = qs.length > 0 ? `/api/v1/intents?${qs}` : "/api/v1/intents";

    // List endpoint returns { data: T[], pagination: {...} } directly (no outer envelope)
    const result = await this.http.getFullBody<PaginatedList<Intent>>(path);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Approve an intent.
   */
  async approve(id: string, reason?: string): Promise<AttestiaResponse<Intent>> {
    const body = reason !== undefined ? { reason } : {};
    const result = await this.http.post<Intent>(
      `/api/v1/intents/${encodeURIComponent(id)}/approve`,
      body,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Reject an intent with a required reason.
   */
  async reject(id: string, reason: string): Promise<AttestiaResponse<Intent>> {
    const result = await this.http.post<Intent>(
      `/api/v1/intents/${encodeURIComponent(id)}/reject`,
      { reason },
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Mark an intent as executed with chain details.
   */
  async execute(id: string, chainId: string, txHash: string): Promise<AttestiaResponse<Intent>> {
    const result = await this.http.post<Intent>(
      `/api/v1/intents/${encodeURIComponent(id)}/execute`,
      { chainId, txHash },
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Verify an intent with reconciliation result.
   */
  async verify(
    id: string,
    matched: boolean,
    discrepancies?: string[],
  ): Promise<AttestiaResponse<Intent>> {
    const body: { matched: boolean; discrepancies?: string[] } = { matched };
    if (discrepancies !== undefined) {
      body.discrepancies = discrepancies;
    }
    const result = await this.http.post<Intent>(
      `/api/v1/intents/${encodeURIComponent(id)}/verify`,
      body,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }
}

/**
 * Verification operations namespace.
 */
export class VerifyNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get the current global state hash.
   */
  async stateHash(): Promise<AttestiaResponse<GlobalStateHash>> {
    const result = await this.http.get<GlobalStateHash>("/api/v1/verify/hash");
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Perform a full replay verification.
   */
  async replay(input: ReplayInput): Promise<AttestiaResponse<ReplayResult>> {
    const result = await this.http.post<ReplayResult>("/api/v1/verify/replay", input);
    return { data: result.data, status: result.status, headers: result.headers };
  }
}

/**
 * Proof operations namespace.
 */
export class ProofsNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get the current Merkle root.
   */
  async merkleRoot(): Promise<AttestiaResponse<MerkleRootInfo>> {
    const result = await this.http.get<MerkleRootInfo>("/api/v1/proofs/merkle-root");
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Get an attestation proof package by ID.
   */
  async getAttestation(id: string): Promise<AttestiaResponse<AttestationProofPackage>> {
    const result = await this.http.get<AttestationProofPackage>(
      `/api/v1/proofs/attestation/${encodeURIComponent(id)}`,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Verify an attestation proof package.
   */
  async verifyProof(pkg: AttestationProofPackage): Promise<AttestiaResponse<ProofVerificationResult>> {
    const result = await this.http.post<ProofVerificationResult>("/api/v1/proofs/verify", pkg);
    return { data: result.data, status: result.status, headers: result.headers };
  }
}

// =============================================================================
// Treasury Namespaces
// =============================================================================

/**
 * Payroll-run operations (sub-namespace of {@link TreasuryNamespace}).
 */
export class PayrollRunsNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a payroll run.
   */
  async create(params: CreatePayrollRunParams): Promise<AttestiaResponse<PayrollRun>> {
    const result = await this.http.post<PayrollRun>("/api/v1/treasury/payroll-runs", params);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Approve a payroll run.
   */
  async approve(id: string): Promise<AttestiaResponse<PayrollRun>> {
    const result = await this.http.post<PayrollRun>(
      `/api/v1/treasury/payroll-runs/${encodeURIComponent(id)}/approve`,
      {},
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Execute a payroll run.
   */
  async execute(id: string): Promise<AttestiaResponse<PayrollRun>> {
    const result = await this.http.post<PayrollRun>(
      `/api/v1/treasury/payroll-runs/${encodeURIComponent(id)}/execute`,
      {},
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Get a single payroll run by ID.
   */
  async get(id: string): Promise<AttestiaResponse<PayrollRun>> {
    const result = await this.http.get<PayrollRun>(
      `/api/v1/treasury/payroll-runs/${encodeURIComponent(id)}`,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * List payroll runs with cursor pagination.
   */
  async list(params?: ListPageParams): Promise<AttestiaResponse<PaginatedList<PayrollRun>>> {
    const path = buildListPath("/api/v1/treasury/payroll-runs", params);
    const result = await this.http.getFullBody<PaginatedList<PayrollRun>>(path);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Auto-paginate over every payroll run, following cursors transparently.
   */
  iterate(params?: ListPageParams): AsyncGenerator<PayrollRun, void, void> {
    return paginateAll<PayrollRun>(async (cursor) => {
      const result = await this.list(mergeCursor(params, cursor));
      return result.data;
    });
  }
}

/**
 * Distribution operations (sub-namespace of {@link TreasuryNamespace}).
 */
export class DistributionsNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a distribution plan.
   */
  async create(params: CreateDistributionParams): Promise<AttestiaResponse<DistributionPlan>> {
    const result = await this.http.post<DistributionPlan>("/api/v1/treasury/distributions", params);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Approve a distribution plan.
   */
  async approve(id: string): Promise<AttestiaResponse<DistributionPlan>> {
    const result = await this.http.post<DistributionPlan>(
      `/api/v1/treasury/distributions/${encodeURIComponent(id)}/approve`,
      {},
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Compute (dry-run) a distribution plan's payouts without mutating it.
   */
  async compute(id: string): Promise<AttestiaResponse<DistributionResult>> {
    const result = await this.http.post<DistributionResult>(
      `/api/v1/treasury/distributions/${encodeURIComponent(id)}/compute`,
      {},
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Execute a distribution plan.
   */
  async execute(id: string): Promise<AttestiaResponse<DistributionResult>> {
    const result = await this.http.post<DistributionResult>(
      `/api/v1/treasury/distributions/${encodeURIComponent(id)}/execute`,
      {},
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Get a single distribution plan by ID.
   */
  async get(id: string): Promise<AttestiaResponse<DistributionPlan>> {
    const result = await this.http.get<DistributionPlan>(
      `/api/v1/treasury/distributions/${encodeURIComponent(id)}`,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * List distribution plans with cursor pagination.
   */
  async list(params?: ListPageParams): Promise<AttestiaResponse<PaginatedList<DistributionPlan>>> {
    const path = buildListPath("/api/v1/treasury/distributions", params);
    const result = await this.http.getFullBody<PaginatedList<DistributionPlan>>(path);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Auto-paginate over every distribution plan, following cursors transparently.
   */
  iterate(params?: ListPageParams): AsyncGenerator<DistributionPlan, void, void> {
    return paginateAll<DistributionPlan>(async (cursor) => {
      const result = await this.list(mergeCursor(params, cursor));
      return result.data;
    });
  }
}

/**
 * Dual-gate funding operations (sub-namespace of {@link TreasuryNamespace}).
 */
export class FundingGatesNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Submit a funding request (first leg of the dual-gate flow).
   */
  async submit(params: SubmitFundingParams): Promise<AttestiaResponse<FundingRequest>> {
    const result = await this.http.post<FundingRequest>("/api/v1/treasury/funding-gates", params);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Approve a funding gate. The approver is required; a reason is optional.
   */
  async approve(
    id: string,
    approvedBy: string,
    reason?: string,
  ): Promise<AttestiaResponse<FundingRequest>> {
    const body: { approvedBy: string; reason?: string } = { approvedBy };
    if (reason !== undefined) {
      body.reason = reason;
    }
    const result = await this.http.post<FundingRequest>(
      `/api/v1/treasury/funding-gates/${encodeURIComponent(id)}/approve`,
      body,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Reject a funding request. The rejector is required; a reason is optional.
   */
  async reject(
    id: string,
    rejectedBy: string,
    reason?: string,
  ): Promise<AttestiaResponse<FundingRequest>> {
    const body: { rejectedBy: string; reason?: string } = { rejectedBy };
    if (reason !== undefined) {
      body.reason = reason;
    }
    const result = await this.http.post<FundingRequest>(
      `/api/v1/treasury/funding-gates/${encodeURIComponent(id)}/reject`,
      body,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Execute a fully-approved funding request.
   */
  async execute(id: string): Promise<AttestiaResponse<FundingRequest>> {
    const result = await this.http.post<FundingRequest>(
      `/api/v1/treasury/funding-gates/${encodeURIComponent(id)}/execute`,
      {},
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Get a single funding request by ID.
   */
  async get(id: string): Promise<AttestiaResponse<FundingRequest>> {
    const result = await this.http.get<FundingRequest>(
      `/api/v1/treasury/funding-gates/${encodeURIComponent(id)}`,
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * List funding requests with cursor pagination.
   */
  async list(params?: ListPageParams): Promise<AttestiaResponse<PaginatedList<FundingRequest>>> {
    const path = buildListPath("/api/v1/treasury/funding-gates", params);
    const result = await this.http.getFullBody<PaginatedList<FundingRequest>>(path);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Auto-paginate over every funding request, following cursors transparently.
   */
  iterate(params?: ListPageParams): AsyncGenerator<FundingRequest, void, void> {
    return paginateAll<FundingRequest>(async (cursor) => {
      const result = await this.list(mergeCursor(params, cursor));
      return result.data;
    });
  }
}

/**
 * Treasury operations namespace — payroll runs, distributions, and funding
 * gates, each grouped as its own sub-namespace.
 */
export class TreasuryNamespace {
  /** Payroll-run operations. */
  readonly payrollRuns: PayrollRunsNamespace;
  /** Distribution operations. */
  readonly distributions: DistributionsNamespace;
  /** Dual-gate funding operations. */
  readonly fundingGates: FundingGatesNamespace;

  constructor(http: HttpClient) {
    this.payrollRuns = new PayrollRunsNamespace(http);
    this.distributions = new DistributionsNamespace(http);
    this.fundingGates = new FundingGatesNamespace(http);
  }
}

// =============================================================================
// Vault Namespace
// =============================================================================

/**
 * Vault operations namespace — budget envelopes and multi-chain portfolio.
 */
export class VaultNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a budget envelope.
   */
  async createEnvelope(params: CreateEnvelopeParams): Promise<AttestiaResponse<Envelope>> {
    const result = await this.http.post<Envelope>("/api/v1/vault/envelopes", params);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Allocate funds into an existing envelope.
   */
  async allocate(id: string, amount: Money): Promise<AttestiaResponse<Envelope>> {
    const result = await this.http.post<Envelope>(
      `/api/v1/vault/envelopes/${encodeURIComponent(id)}/allocate`,
      { amount },
    );
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Get the aggregate budget snapshot.
   */
  async budget(): Promise<AttestiaResponse<BudgetSnapshot>> {
    const result = await this.http.get<BudgetSnapshot>("/api/v1/vault/budget");
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * List budget envelopes with cursor pagination.
   */
  async listEnvelopes(params?: ListPageParams): Promise<AttestiaResponse<PaginatedList<Envelope>>> {
    const path = buildListPath("/api/v1/vault/envelopes", params);
    const result = await this.http.getFullBody<PaginatedList<Envelope>>(path);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Auto-paginate over every budget envelope, following cursors transparently.
   */
  iterateEnvelopes(params?: ListPageParams): AsyncGenerator<Envelope, void, void> {
    return paginateAll<Envelope>(async (cursor) => {
      const result = await this.listEnvelopes(mergeCursor(params, cursor));
      return result.data;
    });
  }

  /**
   * Observe the multi-chain portfolio.
   */
  async portfolio(): Promise<AttestiaResponse<Portfolio>> {
    const result = await this.http.get<Portfolio>("/api/v1/vault/portfolio");
    return { data: result.data, status: result.status, headers: result.headers };
  }
}

// =============================================================================
// Governance Namespace
// =============================================================================

/**
 * Governance operations namespace — per-tenant multi-sig policy administration.
 *
 * Mutations (addSigner / removeSigner / changeQuorum) are admin-only on the
 * server; the read (getPolicy) needs only the ambient authenticated context.
 */
export class GovernanceNamespace {
  constructor(private readonly http: HttpClient) {}

  /**
   * Add a signer to the governance policy.
   */
  async addSigner(params: AddSignerParams): Promise<AttestiaResponse<GovernancePolicy>> {
    const result = await this.http.post<GovernancePolicy>("/api/v1/governance/signers", params);
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Remove a signer from the governance policy by address.
   */
  async removeSigner(address: string): Promise<AttestiaResponse<GovernancePolicy>> {
    const result = await this.http.post<GovernancePolicy>("/api/v1/governance/signers/remove", {
      address,
    });
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Change the quorum threshold (total signer weight required to approve).
   */
  async changeQuorum(quorum: number): Promise<AttestiaResponse<GovernancePolicy>> {
    const result = await this.http.post<GovernancePolicy>("/api/v1/governance/quorum", { quorum });
    return { data: result.data, status: result.status, headers: result.headers };
  }

  /**
   * Get the current governance policy.
   */
  async getPolicy(): Promise<AttestiaResponse<GovernancePolicy>> {
    const result = await this.http.get<GovernancePolicy>("/api/v1/governance/policy");
    return { data: result.data, status: result.status, headers: result.headers };
  }
}

// =============================================================================
// List Path Helpers
// =============================================================================

/** Build a cursor/limit query string onto a list path (shared by namespaces). */
function buildListPath(base: string, params?: ListPageParams): string {
  const query = new URLSearchParams();
  if (params?.cursor !== undefined) query.set("cursor", params.cursor);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  const qs = query.toString();
  return qs.length > 0 ? `${base}?${qs}` : base;
}

/**
 * Merge the auto-pagination cursor into the caller's list params for one page
 * fetch. {@link paginateAll} owns the cursor (seeding the first page at
 * `undefined`), so the threaded cursor always wins; any `cursor` the caller put
 * on `iterate()` params is dropped to avoid skipping the first page, while
 * `limit` is preserved across every page.
 */
function mergeCursor(
  params: ListPageParams | undefined,
  cursor: string | undefined,
): ListPageParams {
  const { cursor: _ignored, ...rest } = params ?? {};
  return cursor !== undefined ? { ...rest, cursor } : { ...rest };
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * Attestia SDK client — main entry point.
 *
 * Usage:
 * ```typescript
 * const client = new AttestiaClient({
 *   baseUrl: "https://api.attestia.io",
 *   apiKey: "your-api-key",
 * });
 *
 * const intent = await client.intents.declare({
 *   id: "pay-001",
 *   kind: "transfer",
 *   description: "Payroll batch",
 *   params: { toAddress: "0x...", amount: { amount: "1000", currency: "USDC", decimals: 6 } },
 * });
 * ```
 */
export class AttestiaClient {
  /** Intent lifecycle operations. */
  readonly intents: IntentsNamespace;
  /** Verification operations. */
  readonly verify: VerifyNamespace;
  /** Proof operations. */
  readonly proofs: ProofsNamespace;
  /** Treasury operations — payroll runs, distributions, funding gates. */
  readonly treasury: TreasuryNamespace;
  /** Vault operations — budget envelopes and portfolio. */
  readonly vault: VaultNamespace;
  /** Governance operations — multi-sig policy administration. */
  readonly governance: GovernanceNamespace;

  private readonly http: HttpClient;

  constructor(config: AttestiaClientConfig) {
    this.http = new HttpClient(config);
    this.intents = new IntentsNamespace(this.http);
    this.verify = new VerifyNamespace(this.http);
    this.proofs = new ProofsNamespace(this.http);
    this.treasury = new TreasuryNamespace(this.http);
    this.vault = new VaultNamespace(this.http);
    this.governance = new GovernanceNamespace(this.http);
  }
}
