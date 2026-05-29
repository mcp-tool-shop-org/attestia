/**
 * Chain Observer Interface
 *
 * The core abstraction for observing blockchain state.
 * Every chain-specific implementation (EVM, XRPL, etc.) must satisfy this interface.
 *
 * Design rules:
 * - All methods are read-only — no mutations, no signing
 * - All methods return Promises (chain queries are inherently async)
 * - All responses include observation metadata (when, from which chain)
 * - Errors are thrown, not returned — fail-closed
 */

import type { ChainId, ChainRef, Telemetry } from "@attestia/types";
import type { ChainProfile } from "./finality.js";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for connecting to a chain.
 */
export interface ObserverConfig {
  /** Chain to observe */
  readonly chain: ChainRef;

  /** RPC endpoint URL (HTTP for EVM, WebSocket for XRPL) */
  readonly rpcUrl: string;

  /** Optional request timeout in milliseconds */
  readonly timeoutMs?: number;

  /**
   * Optional chain profile with finality configuration.
   * When provided, observers can use chain-specific finality parameters
   * (e.g., confirmation depth, safe/finalized block tags, commitment levels).
   */
  readonly profile?: ChainProfile;

  /**
   * Optional telemetry sink for structured observability events.
   *
   * When omitted, observers emit nothing (default {@link NOOP_TELEMETRY}),
   * keeping the package dependency-free and silent. When provided, observers
   * emit a `rpc` event (outcome `"failed"`, low-cardinality attributes
   * `{ chainId, code }`) when a classified RPC failure occurs, so hosts can
   * meter failure rates by chain and error class. `record` MUST NOT throw.
   */
  readonly telemetry?: Telemetry;
}

// =============================================================================
// Connection
// =============================================================================

/**
 * Connection status of an observer.
 */
export interface ConnectionStatus {
  readonly chainId: ChainId;
  readonly connected: boolean;
  readonly latestBlock?: number;
  readonly checkedAt: string;

  /**
   * The most recent finalized block/slot (EVM "finalized" tag, Solana "finalized" commitment).
   * Only populated when the observer has a ChainProfile with finality config.
   */
  readonly finalizedBlock?: number;

  /**
   * The most recent safe block (EVM "safe" tag).
   * Only populated when the observer has a ChainProfile with finality config.
   */
  readonly safeBlock?: number;

  /**
   * Human-readable reason the probe failed, populated when `connected` is false.
   *
   * A health probe must never throw (callers poll it), but it must also never
   * silently swallow *why* it failed — that violates the package's
   * "errors are surfaced, never swallowed" rule. When the connection check
   * errors, this carries the underlying error message so an operator can see
   * the cause (e.g. "fetch failed", "WebSocket not connected") instead of an
   * unexplained `connected: false`.
   */
  readonly error?: string;

  /**
   * Machine-readable classification of a failed probe, populated alongside
   * {@link error} when `connected` is false. Mirrors {@link ObserverErrorCode}
   * values (e.g. "NOT_CONNECTED", "RPC_TIMEOUT", "RPC_UNREACHABLE") so callers
   * can branch on the code without string-matching `error`.
   */
  readonly errorCode?: string;
}

// =============================================================================
// Balance Queries
// =============================================================================

/**
 * Query for native token balance (ETH, XRP, etc.).
 */
export interface BalanceQuery {
  /** Address to check */
  readonly address: string;

  /** Optional block/ledger number for historical queries */
  readonly atBlock?: number;

  /**
   * Finality level for the query (Solana commitment level).
   * When specified, the observer should query at this finality level.
   * Only applicable to chains that support multiple finality levels (e.g., Solana).
   */
  readonly finality?: "processed" | "confirmed" | "finalized";
}

/**
 * Result of a balance query.
 */
export interface BalanceResult {
  readonly chainId: ChainId;
  readonly address: string;

  /** Balance in the smallest unit (wei, drops, etc.) as a string */
  readonly balance: string;

  /** Number of decimals for this native token */
  readonly decimals: number;

  /** Native token symbol */
  readonly symbol: string;

  /** Block/ledger at which this balance was observed */
  readonly atBlock: number;

  /** ISO 8601 timestamp of observation */
  readonly observedAt: string;
}

// =============================================================================
// Token Balance Queries
// =============================================================================

/**
 * Query for a specific token balance (ERC-20, trust line, etc.).
 */
export interface TokenBalanceQuery {
  /** Address to check */
  readonly address: string;

  /** Token contract address (EVM) or currency+issuer (XRPL) */
  readonly token: string;

  /** Token issuer (XRPL only) */
  readonly issuer?: string;
}

/**
 * Result of a token balance query.
 */
export interface TokenBalance {
  readonly chainId: ChainId;
  readonly address: string;
  readonly token: string;
  readonly symbol: string;
  readonly balance: string;
  readonly decimals: number;
  readonly observedAt: string;
}

// =============================================================================
// Transfer Queries
// =============================================================================

/**
 * Query for transfer events.
 */
export interface TransferQuery {
  /** Address to watch (as sender, recipient, or both) */
  readonly address: string;

  /** Direction filter */
  readonly direction?: "incoming" | "outgoing" | "both";

  /** Optional: specific token contract (EVM) or currency (XRPL) */
  readonly token?: string;

  /** Start block/ledger */
  readonly fromBlock?: number;

  /** End block/ledger */
  readonly toBlock?: number;

  /** Maximum results to return */
  readonly limit?: number;

  /**
   * Finality level for the query (Solana commitment level).
   * When specified, the observer should only return transfers at this finality level.
   * Only applicable to chains that support multiple finality levels (e.g., Solana).
   */
  readonly finality?: "processed" | "confirmed" | "finalized";
}

/**
 * A detected transfer event.
 */
export interface TransferEvent {
  readonly chainId: ChainId;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly decimals: number;
  readonly symbol: string;
  readonly token?: string;
  readonly timestamp: string;
  readonly observedAt: string;
}

// =============================================================================
// Observer Interface
// =============================================================================

/**
 * The ChainObserver interface.
 *
 * Implementations observe a single chain. The ObserverRegistry manages
 * multiple observers for multi-chain queries.
 *
 * Guarantees:
 * - All methods are read-only
 * - No signing, no transaction submission
 * - Errors are thrown (fail-closed)
 * - Results include observation metadata
 */
export interface ChainObserver {
  /** Which chain this observer watches */
  readonly chainId: ChainId;

  /** Connect to the chain's RPC endpoint */
  connect(): Promise<void>;

  /** Disconnect from the chain */
  disconnect(): Promise<void>;

  /** Check connection status */
  getStatus(): Promise<ConnectionStatus>;

  /** Get native token balance for an address */
  getBalance(query: BalanceQuery): Promise<BalanceResult>;

  /** Get a specific token balance */
  getTokenBalance(query: TokenBalanceQuery): Promise<TokenBalance>;

  /** Get transfer events for an address */
  getTransfers(query: TransferQuery): Promise<readonly TransferEvent[]>;
}
