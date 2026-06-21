/**
 * Vault — Personal Vault top-level coordinator.
 *
 * Composes:
 * - PortfolioObserver (multi-chain observation)
 * - BudgetEngine (envelope budgeting)
 * - IntentManager (intent lifecycle)
 *
 * The Vault is the user-facing API. It orchestrates the subsystems
 * and enforces the Intent → Approve → Execute → Verify pattern.
 */

import type { ObserverRegistry } from "@attestia/chain-observer";
import type { Money, ChainId, TxHash, Telemetry } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
import { PortfolioObserver } from "./portfolio.js";
import { BudgetEngine } from "./budget.js";
import { IntentManager } from "./intent-manager.js";
import type {
  VaultConfig,
  VaultSnapshot,
  Portfolio,
  Envelope,
  VaultIntent,
  VaultIntentKind,
  VaultIntentParams,
  WatchedAddress,
  TokenPosition,
  BudgetSnapshot,
} from "./types.js";

// =============================================================================
// Snapshot versioning
// =============================================================================

/**
 * The snapshot schema version this build writes and can restore. A snapshot
 * carrying any other `version` is rejected at restore time (see
 * {@link Vault.restoreFromSnapshot}) rather than silently mis-restored into a
 * structurally-valid but semantically-wrong vault.
 */
export const CURRENT_VAULT_SNAPSHOT_VERSION = 1 as const;

// =============================================================================
// Error
// =============================================================================

export class VaultError extends Error {
  public readonly code: VaultErrorCode;
  public readonly hint: string;
  constructor(code: VaultErrorCode, message: string, hint: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.hint = hint;
  }
}

export type VaultErrorCode =
  | "UNSUPPORTED_SNAPSHOT_VERSION"
  | "RESTORE_INVALID";

// =============================================================================
// Vault
// =============================================================================

export class Vault {
  readonly config: VaultConfig;
  private readonly portfolio: PortfolioObserver;
  readonly budget: BudgetEngine;
  readonly intents: IntentManager;

  /**
   * @param telemetry Optional observability sink (D4-B-001), threaded into the
   *   budget engine and intent manager. Defaults to {@link NOOP_TELEMETRY}.
   */
  constructor(
    config: VaultConfig,
    observerRegistry: ObserverRegistry,
    telemetry: Telemetry = NOOP_TELEMETRY,
  ) {
    this.config = config;
    this.portfolio = new PortfolioObserver(observerRegistry, telemetry);
    this.budget = new BudgetEngine(
      config.ownerId,
      config.defaultCurrency,
      config.defaultDecimals,
      telemetry,
    );
    this.intents = new IntentManager(this.budget, telemetry);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Portfolio (Observe)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Observe portfolio — scan all watched addresses across all chains.
   */
  async observePortfolio(): Promise<Portfolio> {
    return this.portfolio.observe(
      this.config.ownerId,
      this.config.watchedAddresses,
    );
  }

  /**
   * Observe a specific token position for a watched address.
   */
  async observeToken(
    address: WatchedAddress,
    token: string,
    issuer?: string,
  ): Promise<TokenPosition | null> {
    return this.portfolio.observeToken(address, token, issuer);
  }

  /**
   * Get transfer history for a watched address.
   */
  async getTransfers(
    address: WatchedAddress,
    options?: {
      direction?: "incoming" | "outgoing" | "both";
      token?: string;
      fromBlock?: number;
      toBlock?: number;
      limit?: number;
    },
  ) {
    return this.portfolio.getTransfers(address, options);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Budget (Allocate)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create a new budget envelope.
   */
  createEnvelope(id: string, name: string, category?: string): Envelope {
    return this.budget.createEnvelope(id, name, category);
  }

  /**
   * Allocate funds to an envelope.
   */
  allocateToEnvelope(envelopeId: string, amount: Money): Envelope {
    return this.budget.allocate(envelopeId, amount);
  }

  /**
   * Get budget snapshot.
   */
  getBudget(): BudgetSnapshot {
    return this.budget.snapshot();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Intents (Intent → Approve → Execute → Verify)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Declare a new intent.
   */
  declareIntent(
    id: string,
    kind: VaultIntentKind,
    description: string,
    params: VaultIntentParams,
    envelopeId?: string,
  ): VaultIntent {
    return this.intents.declare(
      id,
      kind,
      description,
      this.config.ownerId,
      params,
      envelopeId,
    );
  }

  /**
   * Approve an intent (human authorization required).
   */
  approveIntent(intentId: string, reason?: string): VaultIntent {
    return this.intents.approve(intentId, this.config.ownerId, reason);
  }

  /**
   * Reject an intent.
   */
  rejectIntent(intentId: string, reason: string): VaultIntent {
    return this.intents.reject(intentId, this.config.ownerId, reason);
  }

  /**
   * Record that an intent's transaction has been submitted to the chain.
   */
  markIntentExecuting(intentId: string): VaultIntent {
    return this.intents.markExecuting(intentId);
  }

  /**
   * Record successful on-chain execution.
   */
  recordIntentExecution(
    intentId: string,
    chainId: ChainId,
    txHash: TxHash,
  ): VaultIntent {
    return this.intents.recordExecution(intentId, chainId, txHash);
  }

  /**
   * Verify an executed intent against on-chain state.
   */
  verifyIntent(
    intentId: string,
    matched: boolean,
    discrepancies?: readonly string[],
  ): VaultIntent {
    return this.intents.verify(intentId, matched, discrepancies);
  }

  /**
   * Record that an intent failed.
   */
  recordIntentFailure(
    intentId: string,
    discrepancies: readonly string[],
  ): VaultIntent {
    return this.intents.recordFailure(intentId, discrepancies);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Snapshot (persistence)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Take a full vault snapshot for persistence.
   */
  snapshot(): VaultSnapshot {
    return {
      version: CURRENT_VAULT_SNAPSHOT_VERSION,
      config: this.config,
      envelopes: this.budget.listEnvelopes(),
      intents: this.intents.exportIntents(),
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore vault state from a snapshot.
   *
   * Restore is robust: each envelope's committed `allocated`/`spent` state is
   * set DIRECTLY (via {@link BudgetEngine.restoreEnvelope}) rather than replayed
   * through allocate()/spend(). Replaying spend() against the live guard could
   * abort a VALID snapshot with INSUFFICIENT_BUDGET (ordering/flooring edge
   * cases) and leave a half-built vault. Direct restore means any consistent
   * snapshot always restores, while a genuinely corrupt envelope (negative or
   * spent>allocated) still fails closed before any state is mutated — the
   * returned vault is always either the full snapshot or an exception, never a
   * partial.
   *
   * The snapshot `version` is checked first: an unrecognised version is
   * rejected with a clear, actionable error rather than silently mis-restored.
   */
  restoreFromSnapshot(
    snapshot: VaultSnapshot,
    observerRegistry: ObserverRegistry,
    telemetry: Telemetry = NOOP_TELEMETRY,
  ): Vault {
    if (snapshot.version !== CURRENT_VAULT_SNAPSHOT_VERSION) {
      throw new VaultError(
        "UNSUPPORTED_SNAPSHOT_VERSION",
        `Cannot restore vault snapshot version ${String(snapshot.version)}: this build restores version ${CURRENT_VAULT_SNAPSHOT_VERSION}`,
        `Migrate the snapshot to version ${CURRENT_VAULT_SNAPSHOT_VERSION} before restoring, or restore with a build that supports version ${String(snapshot.version)}.`,
      );
    }

    const vault = new Vault(snapshot.config, observerRegistry, telemetry);

    // Restore budget envelopes by setting committed state directly. A corrupt
    // envelope throws INVALID_ENVELOPE_STATE here, before any intents are
    // imported — fail closed, never half-built.
    try {
      for (const env of snapshot.envelopes) {
        vault.budget.restoreEnvelope(env);
      }
    } catch (err) {
      throw new VaultError(
        "RESTORE_INVALID",
        `Vault snapshot is inconsistent and cannot be restored: ${err instanceof Error ? err.message : String(err)}`,
        "Inspect the snapshot's envelopes — each must have allocated >= spent and non-negative amounts. This usually indicates corruption or a failed migration.",
      );
    }

    // Restore intents
    vault.intents.importIntents(snapshot.intents);

    // Restore is an operationally significant event — surface it. Counts are
    // low-cardinality; the version goes in attributes as a small bounded enum.
    telemetry.record({
      package: "@attestia/vault",
      op: "vault.restore",
      level: "info",
      outcome: "ok",
      attributes: {
        envelopeCount: snapshot.envelopes.length,
        intentCount: snapshot.intents.length,
        snapshotVersion: snapshot.version,
      },
      message: `vault '${snapshot.config.ownerId}' restored from snapshot (${snapshot.envelopes.length} envelope(s), ${snapshot.intents.length} intent(s))`,
    });

    return vault;
  }
}
