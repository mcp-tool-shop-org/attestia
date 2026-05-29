/**
 * Solana Observer — Read-only Solana chain observer.
 *
 * Uses @solana/web3.js for all chain interactions.
 * Supports Solana mainnet-beta and devnet.
 *
 * Capabilities:
 * - Native SOL balance (in lamports, 9 decimals)
 * - SPL token balance discovery and querying
 * - Transfer history scanning (native SOL + SPL tokens)
 *
 * Non-capabilities (by design):
 * - No signing
 * - No transaction submission
 * - No account creation
 * - No state modification
 *
 * Solana-specific notes:
 * - SOL amounts are in lamports (1 SOL = 1,000,000,000 lamports)
 * - SPL tokens use associated token accounts
 * - Commitment levels control freshness vs. safety trade-off
 * - Slots are Solana's equivalent of blocks
 */

import {
  Connection,
  PublicKey,
  type Commitment,
  type Finality,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import type { SolanaCommitment, Telemetry } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
import type {
  ChainObserver,
  ObserverConfig,
  BalanceQuery,
  BalanceResult,
  TokenBalanceQuery,
  TokenBalance,
  TransferQuery,
  TransferEvent,
  ConnectionStatus,
} from "../observer.js";
import type { ChainProfile } from "../finality.js";
import { ObserverError, classifyRpcError, toObserverError } from "../errors.js";
import {
  DEFAULT_SOLANA_RPC_CONFIG,
  type SolanaRpcConfig,
} from "./rpc-config.js";
import { withRetry } from "./with-retry.js";

// =============================================================================
// Solana Observer
// =============================================================================

export class SolanaObserver implements ChainObserver {
  readonly chainId: string;
  private connection: Connection | null = null;
  private readonly config: ObserverConfig;
  private readonly profile: ChainProfile | undefined;
  private readonly rpcConfig: SolanaRpcConfig;
  private readonly telemetry: Telemetry;

  constructor(config: ObserverConfig) {
    if (!config.chain.chainId.startsWith("solana:")) {
      throw new Error(
        `SolanaObserver: expected Solana chain ID (solana:*), got '${config.chain.chainId}'`,
      );
    }
    this.chainId = config.chain.chainId;
    this.config = config;
    this.profile = config.profile;
    this.telemetry = config.telemetry ?? NOOP_TELEMETRY;

    // Build RPC config from profile commitment level or defaults
    const commitment: SolanaCommitment =
      config.profile?.finality?.commitmentLevel ?? DEFAULT_SOLANA_RPC_CONFIG.commitment;
    this.rpcConfig = {
      ...DEFAULT_SOLANA_RPC_CONFIG,
      commitment,
      timeoutMs: config.timeoutMs ?? DEFAULT_SOLANA_RPC_CONFIG.timeoutMs,
    };
  }

  async connect(): Promise<void> {
    this.connection = new Connection(this.config.rpcUrl, {
      commitment: this.rpcConfig.commitment as Commitment,
      confirmTransactionInitialTimeout: this.rpcConfig.timeoutMs,
    });
  }

  async disconnect(): Promise<void> {
    this.connection = null;
  }

  async getStatus(): Promise<ConnectionStatus> {
    const now = new Date().toISOString();
    if (!this.connection) {
      return {
        chainId: this.chainId,
        connected: false,
        checkedAt: now,
        error: "SolanaObserver: not connected. Call connect() before querying.",
        errorCode: "NOT_CONNECTED",
      };
    }

    let slot: number;
    try {
      slot = await this.connection.getSlot(
        this.rpcConfig.commitment as Commitment,
      );
    } catch (err) {
      // Core liveness probe failed → genuinely disconnected. Surface the reason
      // and a classified code (D3-B-002). A health probe must not throw.
      return {
        chainId: this.chainId,
        connected: false,
        checkedAt: now,
        error: err instanceof Error ? err.message : String(err),
        errorCode: classifyRpcError(err),
      };
    }

    const status: ConnectionStatus = {
      chainId: this.chainId,
      connected: true,
      latestBlock: slot,
      checkedAt: now,
    };

    // If profile has finality config, also fetch finalized slot. D3-B-009: a
    // finalized-slot failure degrades to "connected, finality unknown" — never
    // "disconnected" (liveness was already proven via getSlot above).
    if (this.profile?.finality) {
      try {
        const finalizedSlot = await this.connection.getSlot("finalized");
        return {
          ...status,
          finalizedBlock: finalizedSlot,
        };
      } catch (err) {
        // Finalized slot unavailable — stay connected, report finality unknown.
        return {
          ...status,
          error: `finality unknown: ${err instanceof Error ? err.message : String(err)}`,
          errorCode: classifyRpcError(err),
        };
      }
    }

    return status;
  }

  async getBalance(query: BalanceQuery): Promise<BalanceResult> {
    const connection = this.requireConnection();
    const pubkey = new PublicKey(query.address);

    // Use query-level finality override or default from RPC config
    const commitment: Commitment =
      (query.finality ?? this.rpcConfig.commitment) as Commitment;

    const [balance, slot] = await this.runRpc("getBalance", () =>
      Promise.all([
        withRetry(() => connection.getBalance(pubkey, commitment), this.rpcConfig.maxRetries, this.rpcConfig.retryDelayMs),
        withRetry(() => connection.getSlot(commitment), this.rpcConfig.maxRetries, this.rpcConfig.retryDelayMs),
      ]),
    );

    return {
      chainId: this.chainId,
      address: query.address,
      balance: balance.toString(),
      decimals: 9, // SOL uses lamports (9 decimals)
      symbol: "SOL",
      atBlock: slot,
      observedAt: new Date().toISOString(),
    };
  }

  async getTokenBalance(query: TokenBalanceQuery): Promise<TokenBalance> {
    const connection = this.requireConnection();
    const ownerPubkey = new PublicKey(query.address);
    const mintPubkey = new PublicKey(query.token);

    // Find token accounts for this owner + mint combination
    const response = await this.runRpc("getTokenBalance", () =>
      withRetry(
        () => connection.getParsedTokenAccountsByOwner(ownerPubkey, { mint: mintPubkey }),
        this.rpcConfig.maxRetries,
        this.rpcConfig.retryDelayMs,
      ),
    );

    if (response.value.length === 0) {
      return {
        chainId: this.chainId,
        address: query.address,
        token: query.token,
        symbol: query.token.slice(0, 8), // Use truncated mint as fallback symbol
        balance: "0",
        decimals: 0,
        observedAt: new Date().toISOString(),
      };
    }

    // Use the first token account (usually the associated token account)
    const tokenAccount = response.value[0]!;
    const parsed = tokenAccount.account.data.parsed as {
      info: {
        tokenAmount: { amount: string; decimals: number; uiAmountString: string };
      };
    };

    const tokenAmount = parsed.info.tokenAmount;

    return {
      chainId: this.chainId,
      address: query.address,
      token: query.token,
      symbol: `SPL:${query.token}`, // Full mint address — avoids misleading truncated hash
      balance: tokenAmount.amount,
      decimals: tokenAmount.decimals,
      observedAt: new Date().toISOString(),
    };
  }

  async getTransfers(query: TransferQuery): Promise<readonly TransferEvent[]> {
    const connection = this.requireConnection();
    const pubkey = new PublicKey(query.address);

    // Use query-level finality override or default from RPC config.
    // getSignaturesForAddress and getParsedTransactions require Finality
    // ('confirmed' | 'finalized'), not Commitment (which also includes 'processed').
    const rawCommitment = query.finality ?? this.rpcConfig.commitment;
    const finality: Finality =
      rawCommitment === "processed" ? "confirmed" : rawCommitment as Finality;

    // Get recent transaction signatures for this address
    const signatures = await this.runRpc("getTransfers", () =>
      withRetry(
        () => connection.getSignaturesForAddress(pubkey, { limit: query.limit ?? 100 }, finality),
        this.rpcConfig.maxRetries,
        this.rpcConfig.retryDelayMs,
      ),
    );

    if (signatures.length === 0) {
      return [];
    }

    // Fetch full parsed transactions
    const txHashes = signatures.map((s) => s.signature);
    const transactions = await this.runRpc("getTransfers", () =>
      withRetry(
        () => connection.getParsedTransactions(txHashes, { commitment: finality, maxSupportedTransactionVersion: 0 }),
        this.rpcConfig.maxRetries,
        this.rpcConfig.retryDelayMs,
      ),
    );

    const events: TransferEvent[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (!tx) continue;

      const sig = signatures[i]!;
      const transferEvents = this.extractTransfers(tx, sig.signature, query, now);
      events.push(...transferEvents);
    }

    // Sort by slot ascending
    events.sort((a, b) => a.blockNumber - b.blockNumber);

    // Apply limit
    if (query.limit !== undefined && events.length > query.limit) {
      return events.slice(0, query.limit);
    }

    return events;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private requireConnection(): Connection {
    if (!this.connection) {
      const err = new ObserverError({
        code: "NOT_CONNECTED",
        chainId: this.chainId,
        message: "SolanaObserver: not connected. Call connect() before querying.",
        hint: "Call connect() and await it before issuing queries.",
      });
      this.emitRpcFailure("NOT_CONNECTED");
      throw err;
    }
    return this.connection;
  }

  /**
   * Emit a structured `rpc` failure telemetry event with low-cardinality
   * attributes (`chainId`, `code`). Never throws.
   */
  private emitRpcFailure(code: string): void {
    try {
      this.telemetry.record({
        package: "@attestia/chain-observer",
        op: "rpc",
        level: "error",
        outcome: "failed",
        attributes: { chainId: this.chainId, code },
      });
    } catch {
      /* observability must never throw into the caller */
    }
  }

  /**
   * Run a Solana RPC operation, classifying and re-throwing any failure as a
   * structured {@link ObserverError} and emitting a `rpc` failure event
   * (D3-B-003). Wraps the already-retried RPC call so the *final* failure (after
   * retries are exhausted) surfaces classified rather than as a raw web3.js error.
   *
   * @param context Operation name for the error message (e.g. "getBalance").
   * @param fn The RPC call (typically a withRetry(...) invocation) to execute.
   */
  private async runRpc<T>(context: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const observerError = toObserverError(err, `SolanaObserver.${context}`, this.chainId);
      this.emitRpcFailure(observerError.code);
      throw observerError;
    }
  }

  /**
   * Extract transfer events from a parsed Solana transaction.
   * Handles both native SOL transfers and SPL token transfers.
   */
  private extractTransfers(
    tx: ParsedTransactionWithMeta,
    signature: string,
    query: TransferQuery,
    observedAt: string,
  ): TransferEvent[] {
    const events: TransferEvent[] = [];
    const slot = tx.slot;
    const timestamp = tx.blockTime
      ? new Date(tx.blockTime * 1000).toISOString()
      : observedAt;

    // Extract instructions
    const instructions = tx.transaction.message.instructions;
    for (const ix of instructions) {
      // Parsed instructions have a "parsed" field
      if (!("parsed" in ix) || typeof ix.parsed !== "object" || ix.parsed === null) continue;

      const parsed = ix.parsed as Record<string, unknown>;
      const program = ix.program as string | undefined;
      const type = parsed.type as string | undefined;
      const info = parsed.info as Record<string, unknown> | undefined;

      if (!info) continue;

      if (program === "system" && type === "transfer") {
        // Native SOL transfer
        const from = info.source as string;
        const to = info.destination as string;
        const amount = String(info.lamports ?? "0");

        if (!this.matchesDirection(from, to, query.address, query.direction)) continue;
        if (query.token) continue; // Token filter set but this is native

        events.push({
          chainId: this.chainId,
          txHash: signature,
          blockNumber: slot,
          from,
          to,
          amount,
          decimals: 9,
          symbol: "SOL",
          timestamp,
          observedAt,
        });
      } else if (
        (program === "spl-token" || program === "spl-token-2022") &&
        (type === "transfer" || type === "transferChecked")
      ) {
        // SPL token transfer
        const from = (info.authority ?? info.source) as string;
        const to = info.destination as string;
        const amount = type === "transferChecked"
          ? String((info.tokenAmount as { amount: string })?.amount ?? "0")
          : String(info.amount ?? "0");
        const decimals = type === "transferChecked"
          ? ((info.tokenAmount as { decimals: number })?.decimals ?? 0)
          : 0;
        const mint = info.mint as string | undefined;

        if (!this.matchesDirection(from, to, query.address, query.direction)) continue;
        if (query.token && mint !== query.token) continue;

        events.push({
          chainId: this.chainId,
          txHash: signature,
          blockNumber: slot,
          from,
          to,
          amount,
          decimals,
          symbol: mint !== undefined ? `SPL:${mint}` : "SPL",
          ...(mint !== undefined ? { token: mint } : {}),
          timestamp,
          observedAt,
        });
      }
    }

    return events;
  }

  /**
   * Check if a transfer matches the direction filter.
   */
  private matchesDirection(
    from: string,
    to: string,
    address: string,
    direction?: "incoming" | "outgoing" | "both",
  ): boolean {
    if (!direction || direction === "both") return true;
    if (direction === "incoming") return to === address;
    if (direction === "outgoing") return from === address;
    return true;
  }
}
