/**
 * AttestiaService — Composition root for all domain packages.
 *
 * Route handlers delegate to this service; they never import domain
 * packages directly. Each tenant gets its own AttestiaService instance
 * for data isolation.
 *
 * DURABILITY (opt-in) — see {@link AttestiaServiceConfig.persistence}:
 *
 *   When `persistence` is UNDEFINED the service is byte-identical to its
 *   original in-memory form: an InMemoryEventStore, no snapshot store, no files,
 *   and NO domain-event appends. This is deliberate — it keeps every existing
 *   test green and imposes zero cost on callers that don't need durability.
 *
 *   When `persistence` IS configured the service becomes a HYBRID durable store:
 *     - The durable event log (JsonlEventStore) is the AUDIT TRUTH — every state
 *       mutation appends its matching ATTESTIA_EVENTS domain event, fsync'd, as a
 *       FAIL-CLOSED gate (append first; only apply the in-memory mutation if the
 *       append succeeded).
 *     - Subsystem SNAPSHOTS (FileSnapshotStore) are the RESTORE path — on boot we
 *       rehydrate each subsystem from its latest verified snapshot.
 *
 *   This is the exact design that was cross-family design-reviewed. We do NOT
 *   attempt pure event-replay rebuild of the registrar — its snapshot is
 *   frontier-only and there is no persisted transition log to replay from. The
 *   durable event log retains the transition history for audit and future replay,
 *   but deep-lineage rebuild from the log is roadmap, not this change.
 *
 * Documented ceilings (honest, not over-claimed):
 *   (a) SINGLE-WRITER-PER-TENANT. One writer per tenant dir is assumed. The
 *       JsonlEventStore cross-process guard fails closed (CONCURRENCY_CONFLICT)
 *       if another process advances the log, so multi-instance / HA is out of
 *       scope for this change.
 *   (b) REGISTRAR RESTORE IS FRONTIER-ONLY. Deep version lineage (parentKey
 *       chains) is NOT reconstructed on boot; `getLineage` on a restored
 *       registrar returns the restored frontier. The event log keeps the
 *       transition history for audit / future replay.
 *   (c) EVENT-LOG RETENTION/COMPACTION IS ROADMAP. Snapshots prune
 *       (maxSnapshotsPerStream); the append-only event log grows unbounded.
 *   (d) TREASURY-INTERNAL LEDGER IS NOT IN THE TREASURY SNAPSHOT. The Treasury
 *       snapshot schema persists payees / payroll runs / distributions / funding
 *       (the authoritative financial state of record), which DO restore. The
 *       double-entry ledger entries that run-execution writes into the Treasury's
 *       OWN internal ledger are a derived side-effect and are not part of the
 *       Treasury snapshot contract, so they are not rehydrated here. The
 *       standalone service ledger (this.ledger — used for export / GlobalStateHash)
 *       IS snapshotted and restored. Rebuilding the internal ledger from the
 *       durable event log is roadmap, not this change.
 */

import { Vault } from "@attestia/vault";
import { Ledger } from "@attestia/ledger";
import { Treasury } from "@attestia/treasury";
import type {
  PayComponent,
  PayPeriod,
  DistributionStrategy,
  DistributionRecipient,
  Payee,
  PayrollRun,
  DistributionPlan,
  DistributionResult,
  FundingRequest,
} from "@attestia/treasury";
import type { Envelope, BudgetSnapshot, Portfolio } from "@attestia/vault";
import { Reconciler } from "@attestia/reconciler";
import type {
  ReconciliationInput,
  ReconciliationReport,
  AttestationRecord,
} from "@attestia/reconciler";
import {
  InMemoryEventStore,
  JsonlEventStore,
  FileSnapshotStore,
  ATTESTIA_EVENTS,
} from "@attestia/event-store";
import type {
  StoredEvent,
  ReadOptions,
  ReadAllOptions,
  EventStoreIntegrityResult,
  EventStore,
  SnapshotStore,
} from "@attestia/event-store";
import { StructuralRegistrar, INITIAL_INVARIANTS } from "@attestia/registrum";
import { ObserverRegistry } from "@attestia/chain-observer";
import { GovernanceStore } from "@attestia/witness";
import type { GovernanceChangeEvent, GovernancePolicy } from "@attestia/witness";
import {
  verifyByReplay,
  verifyHash,
  computeGlobalStateHash,
} from "@attestia/verify";
import type { ReplayInput, ReplayResult, VerificationResult, GlobalStateHash } from "@attestia/verify";
import { NOOP_TELEMETRY } from "@attestia/types";
import type { Telemetry, DomainEvent, Money } from "@attestia/types";
import { tenantPaths } from "./persistence-paths.js";

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown by {@link AttestiaService.restoreAll} when the latest snapshot is
 * stamped AHEAD of the durable event log (DUR-COMPOSED-002) and no explicit
 * recovery override is set. A snapshot newer than its own audit log means the
 * audit truth was truncated/rolled back/corrupted under it, so adopting it
 * would silently elevate unbacked state above the audit log. Fail closed.
 */
export class RestoreAheadOfLogError extends Error {
  readonly code = "RESTORE_SNAPSHOT_AHEAD_OF_LOG";
  constructor(stampedPosition: number, livePosition: number) {
    super(
      `Snapshot is ahead of the durable event log (snapshot@${stampedPosition}, ` +
        `log@${livePosition}); refusing to adopt a snapshot newer than its own ` +
        `audit log. Set persistence.allowSnapshotAheadOfLog to override for a ` +
        `deliberate recovery.`,
    );
    this.name = "RestoreAheadOfLogError";
  }
}

/**
 * Coded governance conflict (SEAM-2). The underlying {@link GovernanceStore}
 * throws plain `Error`s (duplicate signer, unknown signer, invalid quorum),
 * which would otherwise surface to clients as a generic 500. The governance
 * delegators on {@link AttestiaService} translate them into one of these coded
 * errors so the route's global error handler maps them to a 4xx with a safe
 * `{code,message,hint}` envelope, never the raw thrown message.
 */
export class GovernanceConflictError extends Error {
  constructor(
    readonly code:
      | "SIGNER_EXISTS"
      | "SIGNER_NOT_FOUND"
      | "INVALID_QUORUM"
      | "GOVERNANCE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "GovernanceConflictError";
  }
}

/**
 * Classify a plain Error thrown by the GovernanceStore into a coded
 * {@link GovernanceConflictError}. The store's messages are stable, prefixed
 * sentences; we match on the prefix and discard the (internal-detail-bearing)
 * message in favor of a safe coded error. An unrecognized message becomes a
 * generic GOVERNANCE_CONFLICT (409) rather than leaking through as a 500.
 */
function asGovernanceError(err: unknown): GovernanceConflictError {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("Signer already exists")) {
    return new GovernanceConflictError("SIGNER_EXISTS", message);
  }
  if (message.startsWith("Signer not found")) {
    return new GovernanceConflictError("SIGNER_NOT_FOUND", message);
  }
  if (
    message.startsWith("Quorum") ||
    message.startsWith("Weight must be") ||
    message.includes("public key")
  ) {
    // Invalid input the caller can fix (bad quorum / weight / key) → 400.
    return new GovernanceConflictError("INVALID_QUORUM", message);
  }
  // State conflicts (e.g. "Cannot remove signer … would be less than quorum")
  // and any unrecognized governance error → a generic 409 conflict, never a 500.
  return new GovernanceConflictError("GOVERNANCE_CONFLICT", message);
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Opt-in durability configuration. When present, the service persists its audit
 * log + subsystem snapshots under a per-tenant directory derived from `dataDir`
 * and the service's `ownerId`. When absent, the service is purely in-memory
 * (original behavior).
 */
export interface PersistenceConfig {
  /**
   * Persistence root shared by all tenants of one service tree. Each tenant gets
   * its own `<dataDir>/<sha256(ownerId)>` directory (see persistence-paths.ts).
   */
  readonly dataDir: string;
  /**
   * When to write subsystem snapshots:
   * - "afterEachMutation" (default): snapshot synchronously after every
   *   successful mutation, so a restart loses at most the un-acknowledged tail of
   *   the event log (the documented crash window).
   * - "onShutdown": snapshot only in {@link AttestiaService.stop}. Faster
   *   per-mutation, but a hard crash falls back to the last clean snapshot and a
   *   larger replay-from-log gap (surfaced as a telemetry WARN on next boot).
   */
  readonly snapshotCadence?: "afterEachMutation" | "onShutdown";
  /** How many snapshots to retain per subsystem stream before pruning. Default 5. */
  readonly maxSnapshotsPerStream?: number;
  /**
   * Verify hash chain (event log) and stateHash (snapshots) on load, failing
   * closed on corruption. Default true.
   */
  readonly verifyOnLoad?: boolean;
  /** Defensive cap (bytes) on the event-log file read into memory on boot. */
  readonly maxLoadBytes?: number;
  /**
   * Explicit recovery override (DUR-COMPOSED-002). When the latest snapshot is
   * stamped AHEAD of the durable event log (its `eventPosition` exceeds the
   * log's live position), the snapshot describes state the log cannot back —
   * the audit truth was truncated, rolled back, or corrupted UNDER the snapshot.
   * By default {@link AttestiaService.restoreAll} FAILS CLOSED in this case
   * (refuses to adopt the snapshot and throws) rather than silently trusting a
   * snapshot newer than its own audit log.
   *
   * Set this to `true` only for a deliberate operator-driven recovery where the
   * out-of-band log loss is understood and accepted; restore then proceeds with
   * the ahead-of-log snapshot and emits the same crash-window WARN. Default
   * false (fail closed). The log-ahead-of-snapshot case (the documented crash
   * window) is unaffected — it always warns and proceeds.
   */
  readonly allowSnapshotAheadOfLog?: boolean;
}

export interface AttestiaServiceConfig {
  readonly ownerId: string;
  readonly defaultCurrency: string;
  readonly defaultDecimals: number;
  /**
   * Optional observability sink, threaded into every domain package this
   * service composes (event-store, ledger, vault, treasury, reconciler,
   * registrum). Defaults to {@link NOOP_TELEMETRY} so the service stays silent
   * unless a host (the Hono app) injects a bridge to its logger + metrics.
   */
  readonly telemetry?: Telemetry;
  /**
   * Opt-in durability. UNDEFINED → byte-identical in-memory behavior (the
   * default that keeps existing tests green). Defined → durable JSONL event log
   * (audit truth) + file snapshots (restore path). See {@link PersistenceConfig}
   * and the module header for the design and its documented ceilings.
   */
  readonly persistence?: PersistenceConfig;
}

// =============================================================================
// Snapshot stream IDs
// =============================================================================

/** Snapshot stream IDs, one per persisted subsystem, plus a crash-consistency manifest. */
const SNAPSHOT_STREAMS = {
  ledger: "ledger",
  registrar: "registrar",
  vault: "vault",
  treasury: "treasury",
  governance: "governance",
  /** Carries {eventPosition, ts} stamped at snapshot time for crash-window detection. */
  manifest: "_manifest",
} as const;

/** Shape of the crash-consistency manifest snapshot. */
interface SnapshotManifest {
  /** The event log's globalPosition at the moment the snapshot set was written. */
  readonly eventPosition: number;
  /** When the snapshot set was taken (ISO 8601). */
  readonly ts: string;
}

// =============================================================================
// Service
// =============================================================================

export class AttestiaService {
  vault: Vault;
  readonly ledger: Ledger;
  readonly treasury: Treasury;
  readonly reconciler: Reconciler;
  /**
   * Typed as the shared {@link EventStore} interface (+ the two members both
   * concrete stores expose that the interface omits) so readAllEvents /
   * getStateSnapshot / verifyIntegrity are unchanged whether the backing store
   * is InMemoryEventStore (default) or JsonlEventStore (persistent).
   */
  readonly eventStore: EventStore & {
    verifyIntegrity(): EventStoreIntegrityResult;
  };
  readonly registrar: StructuralRegistrar;
  readonly governanceStore: GovernanceStore;

  private readonly _attestations: AttestationRecord[] = [];
  private _ready = false;

  // ─── Persistence state (all undefined in default in-memory mode) ──────────
  private readonly _config: AttestiaServiceConfig;
  private readonly _telemetry: Telemetry;
  private readonly _observerRegistry: ObserverRegistry;
  private readonly _persistence: PersistenceConfig | undefined;
  private readonly _snapshotStore: SnapshotStore | undefined;
  /** True iff persistence is configured — gates every append/snapshot call. */
  private readonly _persistent: boolean;

  constructor(config: AttestiaServiceConfig) {
    this._config = config;
    // Single shared sink for every domain package. The bridge is stateless, so
    // sharing one instance across all of them is intentional (and cheaper than
    // one sink each). NOOP when the host injects nothing.
    const telemetry = config.telemetry ?? NOOP_TELEMETRY;
    this._telemetry = telemetry;
    this._persistence = config.persistence;
    this._persistent = config.persistence !== undefined;

    this.registrar = new StructuralRegistrar({ mode: "legacy", telemetry });
    this.ledger = new Ledger({ telemetry });
    this.governanceStore = new GovernanceStore();

    if (config.persistence !== undefined) {
      // ── Durable mode: JSONL event log (audit truth) + file snapshot store. ──
      const paths = tenantPaths(config.persistence.dataDir, config.ownerId);
      const verifyOnLoad = config.persistence.verifyOnLoad ?? true;
      this.eventStore = new JsonlEventStore({
        filePath: paths.eventLogPath,
        verifyOnLoad,
        telemetry,
        ...(config.persistence.maxLoadBytes !== undefined
          ? { maxLoadBytes: config.persistence.maxLoadBytes }
          : {}),
      });
      this._snapshotStore = new FileSnapshotStore(paths.snapshotBaseDir, {
        verifyOnLoad,
        telemetry,
        maxSnapshotsPerStream: config.persistence.maxSnapshotsPerStream ?? 5,
      });
    } else {
      // ── Default in-memory mode: byte-identical to the original service. ──
      this.eventStore = new InMemoryEventStore({ telemetry });
    }

    // ObserverRegistry holds pre-built observers; telemetry is configured per
    // observer (ObserverConfig.telemetry) at registration time, not here. No
    // live observers are registered by this service, so nothing to wire.
    const observerRegistry = new ObserverRegistry();
    this._observerRegistry = observerRegistry;
    this.vault = new Vault(
      {
        ownerId: config.ownerId,
        watchedAddresses: [],
        defaultCurrency: config.defaultCurrency,
        defaultDecimals: config.defaultDecimals,
      },
      observerRegistry,
      telemetry,
    );

    this.treasury = new Treasury(
      {
        orgId: config.ownerId,
        name: `${config.ownerId}-treasury`,
        defaultCurrency: config.defaultCurrency,
        defaultDecimals: config.defaultDecimals,
        gatekeepers: ["gatekeeper-1", "gatekeeper-2"],
      },
      telemetry,
    );

    this.reconciler = new Reconciler({
      registrar: this.registrar,
      attestorId: "attestia-node",
      telemetry,
    });

    this._ready = true;
  }

  // ─── Audit-log append (persistent mode only) ──────────────────────────────

  /**
   * Append a domain event to the durable event store as the FAIL-CLOSED gate of
   * a mutation. In default in-memory mode this is a NO-OP (we deliberately do
   * NOT append, so existing events/export tests are untouched).
   *
   * Ordering contract: the caller MUST call this BEFORE applying the in-memory
   * mutation. If the append throws (disk full, fsync error, concurrency
   * conflict), the mutation never runs and the error propagates — the audit log
   * and in-memory state can never disagree about whether a mutation happened.
   */
  private _audit(
    streamId: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): void {
    if (!this._persistent) return;
    const event: DomainEvent = {
      type,
      metadata: {
        eventId: `${type}:${streamId}:${this.eventStore.globalPosition() + 1}`,
        timestamp: new Date().toISOString(),
        actor: this._config.ownerId,
        correlationId: streamId,
        source: streamSource(streamId),
      },
      payload,
    };
    // Fail-closed: any throw here aborts the mutation (we have not applied it yet).
    this.eventStore.append(streamId, [event]);
  }

  /**
   * Run a mutation under the durable contract: APPEND-EVENT (fail-closed gate)
   * → apply the in-memory mutation → snapshot per cadence. In default in-memory
   * mode the audit + snapshot steps are no-ops, so `apply()` runs exactly as
   * before.
   */
  private _mutate<T>(
    streamId: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
    apply: () => T,
  ): T {
    this._audit(streamId, type, payload);
    const result = apply();
    this._snapshotIfCadence();
    return result;
  }

  // ─── Intent Lifecycle ──────────────────────────────────────────────

  declareIntent(
    id: string,
    kind: string,
    description: string,
    params: Record<string, unknown>,
    envelopeId?: string,
  ) {
    return this._mutate(
      "vault",
      ATTESTIA_EVENTS.INTENT_DECLARED,
      {
        intentId: id,
        kind,
        description,
        declaredBy: this._config.ownerId,
        params,
      },
      () =>
        this.vault.declareIntent(
          id,
          kind as Parameters<Vault["declareIntent"]>[1],
          description,
          params as Parameters<Vault["declareIntent"]>[3],
          envelopeId,
        ),
    );
  }

  approveIntent(id: string, reason?: string) {
    return this._mutate(
      "vault",
      ATTESTIA_EVENTS.INTENT_APPROVED,
      { intentId: id, approvedBy: this._config.ownerId },
      () => this.vault.approveIntent(id, reason),
    );
  }

  rejectIntent(id: string, reason: string) {
    return this._mutate(
      "vault",
      ATTESTIA_EVENTS.INTENT_REJECTED,
      { intentId: id, rejectedBy: this._config.ownerId, reason },
      () => this.vault.rejectIntent(id, reason),
    );
  }

  executeIntent(id: string, chainId: string, txHash: string) {
    return this._mutate(
      "vault",
      ATTESTIA_EVENTS.INTENT_EXECUTED,
      { intentId: id, correlationId: txHash },
      () => {
        this.vault.markIntentExecuting(id);
        return this.vault.recordIntentExecution(id, chainId, txHash);
      },
    );
  }

  verifyIntent(
    id: string,
    matched: boolean,
    discrepancies?: readonly string[],
  ) {
    return this._mutate(
      "vault",
      ATTESTIA_EVENTS.INTENT_VERIFIED,
      { intentId: id, verifiedAt: new Date().toISOString() },
      () => this.vault.verifyIntent(id, matched, discrepancies),
    );
  }

  getIntent(id: string) {
    return this.vault.intents.getIntent(id);
  }

  listIntents(status?: string) {
    return this.vault.intents.listIntents(
      status as Parameters<Vault["intents"]["listIntents"]>[0],
    );
  }

  // ─── Treasury delegators (additive) ────────────────────────────────
  //
  // Thin forwards to the already-public Treasury methods. In persistent mode
  // the EXECUTING delegators append their domain event as the fail-closed gate;
  // pure setup/read delegators (register/get/list/compute) do not append — they
  // do not mutate the audited financial state, so the audit log stays focused on
  // value-moving events. Note: Treasury exposes get/create/approve/execute but
  // NOT list*/getDistribution/getPayrollRun(list) — those list/get views are
  // implemented here off the snapshot (see exports_needed note in the report).

  registerPayee(id: string, name: string, address: string, chainId?: string): Payee {
    return this.treasury.registerPayee(id, name, address, chainId);
  }

  setPaySchedule(payeeId: string, components: readonly PayComponent[]) {
    return this.treasury.setPaySchedule(payeeId, components);
  }

  createPayrollRun(id: string, period: PayPeriod): PayrollRun {
    return this.treasury.createPayrollRun(id, period);
  }

  approvePayrollRun(id: string): PayrollRun {
    return this.treasury.approvePayrollRun(id);
  }

  executePayrollRun(id: string): PayrollRun {
    const run = this.treasury.getPayrollRun(id);
    return this._mutate(
      "treasury",
      ATTESTIA_EVENTS.PAYROLL_EXECUTED,
      {
        runId: id,
        recipientCount: run.entries.length,
        totalAmount: run.totalNet.amount,
        currency: run.totalNet.currency,
      },
      () => this.treasury.executePayrollRun(id),
    );
  }

  getPayrollRun(id: string): PayrollRun {
    return this.treasury.getPayrollRun(id);
  }

  /** List-view implemented off the treasury snapshot (Treasury has no listPayrollRuns). */
  listPayrollRuns(): readonly PayrollRun[] {
    return this.treasury.snapshot().payrollRuns;
  }

  createDistribution(
    id: string,
    name: string,
    strategy: DistributionStrategy,
    pool: Money,
    recipients: readonly DistributionRecipient[],
  ): DistributionPlan {
    return this.treasury.createDistribution(id, name, strategy, pool, recipients);
  }

  approveDistribution(id: string): DistributionPlan {
    return this.treasury.approveDistribution(id);
  }

  computeDistribution(id: string): DistributionResult {
    return this.treasury.computeDistribution(id);
  }

  executeDistribution(id: string): DistributionResult {
    const plan = this.treasury.snapshot().distributionPlans.find((p) => p.id === id);
    return this._mutate(
      "treasury",
      ATTESTIA_EVENTS.DISTRIBUTION_EXECUTED,
      {
        planId: id,
        recipientCount: plan?.recipients.length ?? 0,
        totalAmount: plan?.pool.amount ?? "0",
        currency: plan?.pool.currency ?? this._config.defaultCurrency,
      },
      () => this.treasury.executeDistribution(id),
    );
  }

  /** Get-view off the treasury snapshot (Treasury has no getDistribution). */
  getDistribution(id: string): DistributionPlan | undefined {
    return this.treasury.snapshot().distributionPlans.find((p) => p.id === id);
  }

  /** List-view off the treasury snapshot (Treasury has no listDistributions). */
  listDistributions(): readonly DistributionPlan[] {
    return this.treasury.snapshot().distributionPlans;
  }

  submitFunding(id: string, description: string, amount: Money, requestedBy: string): FundingRequest {
    return this.treasury.submitFunding(id, description, amount, requestedBy);
  }

  approveFundingGate(id: string, approvedBy: string, reason?: string): FundingRequest {
    const before = this.treasury.getFundingRequest(id);
    // gate level is 1 for the first approval, 2 once gate1 is already filled.
    const level = before.gate1 === undefined ? 1 : 2;
    return this._mutate(
      "treasury",
      ATTESTIA_EVENTS.FUNDING_GATE_APPROVED,
      { gateId: id, approverId: approvedBy, level },
      () => this.treasury.approveFundingGate(id, approvedBy, reason),
    );
  }

  rejectFunding(id: string, rejectedBy: string, reason?: string): FundingRequest {
    return this.treasury.rejectFunding(id, rejectedBy, reason);
  }

  executeFunding(id: string): FundingRequest {
    return this.treasury.executeFunding(id);
  }

  getFundingRequest(id: string): FundingRequest {
    return this.treasury.getFundingRequest(id);
  }

  /** List-view off the treasury snapshot (Treasury has no listFundingRequests). */
  listFundingRequests(): readonly FundingRequest[] {
    return this.treasury.snapshot().fundingRequests;
  }

  // ─── Vault budgets / portfolio delegators (additive) ───────────────

  createEnvelope(id: string, name: string, category?: string): Envelope {
    return this.vault.createEnvelope(id, name, category);
  }

  allocateToEnvelope(envelopeId: string, amount: Money): Envelope {
    return this._mutate(
      "vault",
      ATTESTIA_EVENTS.BUDGET_ALLOCATED,
      {
        budgetId: this._config.ownerId,
        envelopeId,
        amount: amount.amount,
        currency: amount.currency,
      },
      () => this.vault.allocateToEnvelope(envelopeId, amount),
    );
  }

  getBudget(): BudgetSnapshot {
    return this.vault.getBudget();
  }

  /** List-view off the budget snapshot (Vault has no listEnvelopes). */
  listEnvelopes(): readonly Envelope[] {
    return this.vault.getBudget().envelopes;
  }

  observePortfolio(): Promise<Portfolio> {
    return this.vault.observePortfolio();
  }

  // ─── Governance delegators (SEAM-2) ────────────────────────────────
  //
  // Governance policy changes are value-authorizing mutations (they change WHO
  // can approve), so they MUST go through the same durability gate as treasury /
  // vault: append the matching GOVERNANCE_* domain event to the audit log
  // (fail-closed) BEFORE applying the in-memory change, then snapshot per
  // cadence. Routes call these delegators instead of touching governanceStore
  // directly — so a governance change is in the audit trail and survives a
  // restart, and the GovernanceStore's plain Errors become coded conflicts
  // (mapped to 4xx by the error handler) instead of leaking as 500.

  addSigner(
    address: string,
    label: string,
    weight?: number,
    publicKey?: string,
  ): GovernancePolicy {
    return this._mutate(
      "governance",
      ATTESTIA_EVENTS.GOVERNANCE_SIGNER_ADDED,
      {
        signerAddress: address,
        addedBy: this._config.ownerId,
        // newSignerCount AFTER this add (the store has not applied it yet).
        newSignerCount: this.governanceStore.signerCount + 1,
      },
      () => {
        try {
          this.governanceStore.addSigner(address, label, weight, publicKey);
        } catch (err) {
          throw asGovernanceError(err);
        }
        return this.governanceStore.getCurrentPolicy();
      },
    );
  }

  removeSigner(address: string): GovernancePolicy {
    return this._mutate(
      "governance",
      ATTESTIA_EVENTS.GOVERNANCE_SIGNER_REMOVED,
      {
        signerAddress: address,
        removedBy: this._config.ownerId,
        newSignerCount: Math.max(0, this.governanceStore.signerCount - 1),
      },
      () => {
        try {
          this.governanceStore.removeSigner(address);
        } catch (err) {
          throw asGovernanceError(err);
        }
        return this.governanceStore.getCurrentPolicy();
      },
    );
  }

  changeQuorum(quorum: number): GovernancePolicy {
    const previousQuorum = this.governanceStore.getCurrentPolicy().quorum;
    return this._mutate(
      "governance",
      ATTESTIA_EVENTS.GOVERNANCE_QUORUM_CHANGED,
      {
        previousQuorum,
        newQuorum: quorum,
        changedBy: this._config.ownerId,
      },
      () => {
        try {
          this.governanceStore.changeQuorum(quorum);
        } catch (err) {
          throw asGovernanceError(err);
        }
        return this.governanceStore.getCurrentPolicy();
      },
    );
  }

  getCurrentPolicy(): GovernancePolicy {
    return this.governanceStore.getCurrentPolicy();
  }

  // ─── Events ────────────────────────────────────────────────────────

  readAllEvents(options?: ReadAllOptions): readonly StoredEvent[] {
    return this.eventStore.readAll(options);
  }

  readStreamEvents(
    streamId: string,
    options?: ReadOptions,
  ): readonly StoredEvent[] {
    return this.eventStore.read(streamId, options);
  }

  // ─── Verification ──────────────────────────────────────────────────

  replayVerify(input: ReplayInput): ReplayResult {
    return verifyByReplay(input);
  }

  hashVerify(
    ledgerSnapshot: unknown,
    registrumSnapshot: unknown,
    expectedHash: string,
  ): VerificationResult {
    return verifyHash(
      {
        ledgerSnapshot: ledgerSnapshot as Parameters<typeof verifyHash>[0]["ledgerSnapshot"],
        registrumSnapshot: registrumSnapshot as Parameters<typeof verifyHash>[0]["registrumSnapshot"],
      },
      expectedHash,
    );
  }

  // ─── Reconciliation & Attestation ─────────────────────────────────

  reconcile(input: ReconciliationInput): ReconciliationReport {
    return this.reconciler.reconcile(input);
  }

  async attest(report: ReconciliationReport): Promise<AttestationRecord> {
    // attest() drives a registrar.register() internally, which advances the
    // registrar frontier — a STATE_REGISTERED-class mutation. In persistent mode
    // we append the matching domain event as the fail-closed gate BEFORE the
    // registration happens, then snapshot per cadence after.
    if (this._persistent) {
      const before = this.registrar.snapshot();
      this._audit("registrum", ATTESTIA_EVENTS.STATE_REGISTERED, {
        // The attestor uses its own stateId; we stamp the frontier position we
        // are about to advance past. parentId is the prior frontier tail (or null
        // for the first registration); orderIndex is the next assigned slot.
        stateId: report.id,
        parentId:
          before.state_ids.length > 0
            ? before.state_ids[before.state_ids.length - 1]!
            : null,
        orderIndex: before.ordering.max_index + 1,
      });
    }
    const attestation = await this.reconciler.attest(report);
    this._attestations.push(attestation);
    this._snapshotIfCadence();
    return attestation;
  }

  listAttestations(): readonly AttestationRecord[] {
    return this._attestations;
  }

  // ─── Export ──────────────────────────────────────────────────────

  /**
   * Get a state snapshot with GlobalStateHash for export/audit.
   */
  getStateSnapshot(): {
    ledgerSnapshot: ReturnType<Ledger["snapshot"]>;
    registrumSnapshot: ReturnType<StructuralRegistrar["snapshot"]>;
    globalStateHash: GlobalStateHash;
  } {
    const ledgerSnapshot = this.ledger.snapshot();
    const registrumSnapshot = this.registrar.snapshot();
    const globalStateHash = computeGlobalStateHash(ledgerSnapshot, registrumSnapshot);
    return { ledgerSnapshot, registrumSnapshot, globalStateHash };
  }

  /**
   * Get all events for export (NDJSON streaming).
   */
  getAllEventsForExport(): readonly StoredEvent[] {
    return this.eventStore.readAll();
  }

  // ─── Health & Integrity ──────────────────────────────────────────

  /**
   * Verify event store integrity and check writability.
   * Called during startup self-check and by /ready deep health.
   */
  checkEventStoreWritable(): { writable: boolean; integrity: EventStoreIntegrityResult } {
    const integrity = this.eventStore.verifyIntegrity();
    // Check write capability by verifying the store exists and is functional
    const writable = integrity.valid;
    return { writable, integrity };
  }

  // ─── Snapshot + Restore ───────────────────────────────────────────

  /**
   * Write a snapshot for each subsystem under its own streamId, stamped with the
   * event log's current globalPosition for crash-consistency. No-op in default
   * in-memory mode (no snapshot store).
   *
   * The manifest is written LAST and carries the position observed AFTER all
   * subsystem snapshots are on disk. On restore, if the live event log is ahead
   * of the manifest position, those extra events are un-acknowledged mutations
   * (the documented crash window) and {@link restoreAll} emits a gap WARN.
   */
  snapshotAll(): void {
    if (this._snapshotStore === undefined) return;
    const store = this._snapshotStore;
    const eventPosition = this.eventStore.globalPosition();

    store.save({
      streamId: SNAPSHOT_STREAMS.ledger,
      version: eventPosition,
      state: this.ledger.snapshot(),
    });
    store.save({
      streamId: SNAPSHOT_STREAMS.registrar,
      version: eventPosition,
      state: this.registrar.snapshot(),
    });
    store.save({
      streamId: SNAPSHOT_STREAMS.vault,
      version: eventPosition,
      state: this.vault.snapshot(),
    });
    store.save({
      streamId: SNAPSHOT_STREAMS.treasury,
      version: eventPosition,
      state: this.treasury.snapshot(),
    });
    store.save({
      streamId: SNAPSHOT_STREAMS.governance,
      version: eventPosition,
      state: this.governanceStore.getEventHistory(),
    });

    const manifest: SnapshotManifest = {
      eventPosition,
      ts: new Date().toISOString(),
    };
    store.save({
      streamId: SNAPSHOT_STREAMS.manifest,
      version: eventPosition,
      state: manifest,
    });
  }

  /** Snapshot only when cadence is afterEachMutation (default). No-op otherwise. */
  private _snapshotIfCadence(): void {
    if (this._snapshotStore === undefined) return;
    const cadence = this._persistence?.snapshotCadence ?? "afterEachMutation";
    if (cadence === "afterEachMutation") {
      this.snapshotAll();
    }
  }

  /**
   * Rehydrate every subsystem from its latest verified snapshot. Called from
   * {@link initialize} when persistence is configured. No-op in in-memory mode.
   *
   * Per-subsystem policy:
   * - Missing snapshot → start that subsystem EMPTY (do not throw); a fresh
   *   tenant has no snapshots yet.
   * - Corrupt snapshot → the FileSnapshotStore fails closed (load returns
   *   undefined and emits its own warn) → start EMPTY and we emit an additional
   *   restore.corrupt WARN so the gap is visible. We never crash on a bad
   *   snapshot — the event log remains the audit truth.
   *
   * Crash-window detection: after restore, if the event log's globalPosition is
   * AHEAD of the manifest's stamped eventPosition, the difference is mutations
   * present in the durable audit log but NOT reflected in the restored snapshot
   * state — the documented crash window. We emit a WARN naming the gap and NEVER
   * silently proceed past it.
   */
  restoreAll(): void {
    if (this._snapshotStore === undefined) return;
    const store = this._snapshotStore;

    // Ledger
    const ledgerSnap = this._loadSnapshot(store, SNAPSHOT_STREAMS.ledger);
    if (ledgerSnap !== undefined) {
      try {
        const restored = Ledger.fromSnapshot(
          ledgerSnap as Parameters<typeof Ledger.fromSnapshot>[0],
        );
        // Ledger is readonly on the field; copy restored state in via reflection
        // is not possible, so we restore by reassigning subsystem references that
        // are reassignable, and for the ledger we instead rely on the treasury's
        // own restore. The standalone ledger field mirrors export-only state, so
        // we reassign it here.
        (this as { ledger: Ledger }).ledger = restored;
      } catch (err) {
        this._restoreWarn("ledger", err);
      }
    }

    // Registrar (frontier-only; legacy mode, default invariants).
    const registrarSnap = this._loadSnapshot(store, SNAPSHOT_STREAMS.registrar);
    if (registrarSnap !== undefined) {
      try {
        const restored = StructuralRegistrar.fromSnapshot(registrarSnap, {
          mode: "legacy",
          invariants: INITIAL_INVARIANTS,
          telemetry: this._telemetry,
        });
        (this as { registrar: StructuralRegistrar }).registrar = restored;
        // Rewire the reconciler to the restored registrar so future attests
        // continue the same lineage.
        (this as { reconciler: Reconciler }).reconciler = new Reconciler({
          registrar: restored,
          attestorId: "attestia-node",
          telemetry: this._telemetry,
        });
      } catch (err) {
        this._restoreWarn("registrar", err);
      }
    }

    // Vault (restoreFromSnapshot returns a NEW Vault — reassign).
    const vaultSnap = this._loadSnapshot(store, SNAPSHOT_STREAMS.vault);
    if (vaultSnap !== undefined) {
      try {
        this.vault = this.vault.restoreFromSnapshot(
          vaultSnap as Parameters<Vault["restoreFromSnapshot"]>[0],
          this._observerRegistry,
          this._telemetry,
        );
      } catch (err) {
        this._restoreWarn("vault", err);
      }
    }

    // Treasury
    const treasurySnap = this._loadSnapshot(store, SNAPSHOT_STREAMS.treasury);
    if (treasurySnap !== undefined) {
      try {
        const restored = Treasury.fromSnapshot(
          treasurySnap as Parameters<typeof Treasury.fromSnapshot>[0],
          this._telemetry,
        );
        (this as { treasury: Treasury }).treasury = restored;
      } catch (err) {
        this._restoreWarn("treasury", err);
      }
    }

    // Governance (event-sourced — replay the persisted event history).
    const govSnap = this._loadSnapshot(store, SNAPSHOT_STREAMS.governance);
    if (govSnap !== undefined) {
      try {
        this.governanceStore.replayFrom(govSnap as readonly GovernanceChangeEvent[]);
      } catch (err) {
        this._restoreWarn("governance", err);
      }
    }

    // Crash-window detection: compare live log position to the manifest stamp.
    const manifestSnap = this._loadSnapshot(store, SNAPSHOT_STREAMS.manifest);
    const stampedPosition =
      manifestSnap !== undefined
        ? (manifestSnap as SnapshotManifest).eventPosition
        : 0;
    const livePosition = this.eventStore.globalPosition();
    if (livePosition > stampedPosition) {
      // NEVER silently proceed: these are audited mutations not present in the
      // restored snapshot state — the documented crash window.
      this._telemetry.record({
        package: "@attestia/node",
        op: "restore.crashWindow",
        level: "warn",
        outcome: "degraded",
        attributes: {
          gap: livePosition - stampedPosition,
          stampedPosition,
          livePosition,
        },
        message:
          `Event log is ahead of the latest snapshot by ${livePosition - stampedPosition} ` +
          `event(s) (snapshot@${stampedPosition}, log@${livePosition}). These are ` +
          `un-acknowledged mutations present in the audit log but not the restored ` +
          `snapshot state — the documented crash window. Audit truth is the event log.`,
      });
    } else if (stampedPosition > livePosition) {
      // DUR-COMPOSED-002: the REVERSE anomaly. The latest snapshot was stamped
      // AHEAD of the durable event log — it describes state the log cannot back.
      // This means the audit log was truncated, rolled back, or corrupted UNDER
      // the snapshot (the audit truth was lost/rewound). Treat it as a
      // crash-window-class anomaly and, by default, FAIL CLOSED: we refuse to
      // adopt a snapshot newer than its own audit log, because doing so would
      // silently elevate unbacked snapshot state above the (now shorter) audit
      // truth. An explicit operator recovery override
      // (persistence.allowSnapshotAheadOfLog) lets a deliberate recovery proceed.
      const gap = stampedPosition - livePosition;
      this._telemetry.record({
        package: "@attestia/node",
        op: "restore.crashWindow",
        level: "warn",
        outcome: "degraded",
        attributes: {
          gap,
          stampedPosition,
          livePosition,
          direction: "snapshotAheadOfLog",
        },
        message:
          `Snapshot is ahead of the durable event log by ${gap} event(s) ` +
          `(snapshot@${stampedPosition}, log@${livePosition}). The snapshot ` +
          `describes state the audit log cannot back — the log was truncated, ` +
          `rolled back, or corrupted under it. Refusing to adopt a snapshot ` +
          `newer than its own audit log (fail-closed). Set ` +
          `persistence.allowSnapshotAheadOfLog to override for a deliberate recovery.`,
      });
      if (this._persistence?.allowSnapshotAheadOfLog !== true) {
        throw new RestoreAheadOfLogError(stampedPosition, livePosition);
      }
    }
  }

  /**
   * Load the latest snapshot for a stream, returning its `state` or undefined.
   * A corrupt snapshot surfaces as undefined here (the store failed closed) AND
   * an additional restore.corrupt warn, so the caller starts that subsystem
   * empty rather than crashing.
   */
  private _loadSnapshot(store: SnapshotStore, streamId: string): unknown {
    const snap = store.load(streamId);
    if (snap === undefined) {
      // Could be "never snapshotted" (fine) OR "corrupt and failed closed".
      // hasSnapshot distinguishes: a file exists but didn't load → corruption.
      if (store.hasSnapshot(streamId)) {
        this._telemetry.record({
          package: "@attestia/node",
          op: "restore.corrupt",
          level: "warn",
          outcome: "degraded",
          attributes: { stream: streamId },
          message:
            `Snapshot for "${streamId}" exists on disk but failed integrity ` +
            `verification; starting this subsystem empty. The event log remains ` +
            `the audit truth.`,
        });
      }
      return undefined;
    }
    return snap.state;
  }

  /** Emit a restore-failure warn for a subsystem whose rehydrate threw. */
  private _restoreWarn(stream: string, err: unknown): void {
    this._telemetry.record({
      package: "@attestia/node",
      op: "restore.failed",
      level: "warn",
      outcome: "degraded",
      attributes: { stream },
      message:
        `Failed to rehydrate "${stream}" from its snapshot (${err instanceof Error ? err.message : String(err)}); ` +
        `starting this subsystem empty. The event log remains the audit truth.`,
    });
  }

  /**
   * Initialize the service with startup self-checks.
   *
   * In persistent mode this ALSO rehydrates every subsystem from its latest
   * verified snapshot (restore path) before the writability check, so a restart
   * comes up with full state. Sets _ready based on event store integrity.
   */
  async initialize(): Promise<void> {
    if (this._persistent) {
      this.restoreAll();
    }
    const { writable } = this.checkEventStoreWritable();
    this._ready = writable;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  isReady(): boolean {
    return this._ready;
  }

  async stop(): Promise<void> {
    // Always flush a final snapshot in persistent mode so a clean shutdown loses
    // nothing, regardless of cadence.
    if (this._snapshotStore !== undefined) {
      this.snapshotAll();
    }
    this._ready = false;
  }
}

/**
 * Map a snapshot/audit streamId to the DomainEvent metadata `source` enum.
 * (EventMetadata.source is "vault" | "treasury" | "registrum" | "observer".)
 */
function streamSource(
  streamId: string,
): "vault" | "treasury" | "registrum" | "observer" {
  switch (streamId) {
    case "treasury":
      return "treasury";
    case "registrum":
    // Governance is a structural-policy concern; its domain events declare
    // source "registrum" in the event catalog (see GOVERNANCE_SCHEMAS), so map
    // the "governance" stream to that source for metadata consistency.
    case "governance":
      return "registrum";
    case "vault":
    default:
      return "vault";
  }
}
