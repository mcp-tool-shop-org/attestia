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
    this.portfolio = new PortfolioObserver(observerRegistry);
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
      version: 1,
      config: this.config,
      envelopes: this.budget.listEnvelopes(),
      intents: this.intents.exportIntents(),
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore vault state from a snapshot.
   */
  restoreFromSnapshot(
    snapshot: VaultSnapshot,
    observerRegistry: ObserverRegistry,
    telemetry: Telemetry = NOOP_TELEMETRY,
  ): Vault {
    const vault = new Vault(snapshot.config, observerRegistry, telemetry);

    // Restore budget envelopes
    for (const env of snapshot.envelopes) {
      vault.budget.createEnvelope(env.id, env.name, env.category);
      // Replay allocation/spending
      if (env.allocated !== "0") {
        vault.budget.allocate(env.id, {
          amount: env.allocated,
          currency: env.currency,
          decimals: env.decimals,
        });
      }
      if (env.spent !== "0") {
        vault.budget.spend(env.id, {
          amount: env.spent,
          currency: env.currency,
          decimals: env.decimals,
        });
      }
    }

    // Restore intents
    vault.intents.importIntents(snapshot.intents);

    return vault;
  }
}
