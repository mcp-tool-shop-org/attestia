/**
 * EVM Observer — Read-only Ethereum/EVM chain observer.
 *
 * Uses viem for all chain interactions.
 * Supports any EVM-compatible chain (Ethereum, Base, Arbitrum, Optimism, Polygon, etc.)
 *
 * Capabilities:
 * - Native token balance (ETH, etc.)
 * - ERC-20 token balance
 * - ERC-20 Transfer event scanning
 *
 * Non-capabilities (by design):
 * - No signing
 * - No transaction submission
 * - No contract deployment
 * - No state modification
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  type PublicClient,
  type HttpTransport,
  type Chain,
} from "viem";
import {
  mainnet,
  sepolia,
  base,
  arbitrum,
  optimism,
  polygon,
} from "viem/chains";
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
  RpcRetryConfig,
  EvmChainDescriptor,
} from "../observer.js";
import { DEFAULT_RPC_RETRY } from "../observer.js";
import type { ChainProfile } from "../finality.js";
import { ObserverError, classifyRpcError, toObserverError } from "../errors.js";
import { withRetry } from "../retry.js";
import { type Telemetry, NOOP_TELEMETRY } from "@attestia/types";

// =============================================================================
// Chain ID to viem Chain mapping
// =============================================================================

/** XRPL EVM Sidechain Devnet — custom chain definition */
const xrplEvmDevnet = {
  id: 1440002,
  name: "XRPL EVM Sidechain Devnet",
  nativeCurrency: { name: "XRP", symbol: "XRP", decimals: 18 },
  rpcUrls: { default: { http: [] } },
} as const satisfies Chain;

const VIEM_CHAINS: Record<string, Chain> = {
  "eip155:1": mainnet,
  "eip155:11155111": sepolia,
  "eip155:8453": base,
  "eip155:42161": arbitrum,
  "eip155:10": optimism,
  "eip155:137": polygon,
  "eip155:1440002": xrplEvmDevnet,
};

// =============================================================================
// Native token metadata per chain
// =============================================================================

/**
 * Native token metadata for known EVM chains.
 * Used by getBalance() to return correct decimals/symbol per chain
 * instead of hardcoding ETH values.
 */
const NATIVE_TOKEN_META: Record<string, { symbol: string; decimals: number }> = {
  "eip155:1": { symbol: "ETH", decimals: 18 },
  "eip155:11155111": { symbol: "ETH", decimals: 18 },
  "eip155:8453": { symbol: "ETH", decimals: 18 },
  "eip155:42161": { symbol: "ETH", decimals: 18 },
  "eip155:10": { symbol: "ETH", decimals: 18 },
  "eip155:137": { symbol: "POL", decimals: 18 },
  "eip155:1440002": { symbol: "XRP", decimals: 18 },
};

/** Default native token metadata for unknown EVM chains. */
const DEFAULT_NATIVE_TOKEN = { symbol: "ETH", decimals: 18 };

// ERC-20 ABI fragments (read-only)
const ERC20_BALANCE_OF = parseAbiItem(
  "function balanceOf(address owner) view returns (uint256)"
);
const ERC20_SYMBOL = parseAbiItem(
  "function symbol() view returns (string)"
);
const ERC20_DECIMALS = parseAbiItem(
  "function decimals() view returns (uint8)"
);
const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

// =============================================================================
// EVM Observer
// =============================================================================

export class EvmObserver implements ChainObserver {
  readonly chainId: string;
  private client: PublicClient<HttpTransport, Chain> | null = null;
  private readonly config: ObserverConfig;
  private readonly profile: ChainProfile | undefined;
  private readonly nativeToken: { symbol: string; decimals: number };
  private readonly telemetry: Telemetry;
  private readonly retryConfig: RpcRetryConfig;

  /**
   * Maximum block span for a filterless (all-tokens) Transfer scan.
   *
   * Without a token (address) filter, getLogs scans EVERY contract over the
   * range — expensive, and many RPCs reject address-less getLogs outright. Cap
   * the span and fail closed (D3-A-006). 200k blocks accommodates realistic L2
   * scan windows while still rejecting unbounded/whole-chain ranges.
   */
  private static readonly MAX_FILTERLESS_BLOCK_SPAN = 200_000;

  /**
   * Hard ceiling on the block span for any Transfer scan (even token-filtered).
   * Most providers reject very large getLogs ranges; this fails closed with a
   * structured error rather than emitting a guaranteed-to-be-rejected RPC call.
   */
  private static readonly MAX_BLOCK_SPAN = 1_000_000;

  constructor(config: ObserverConfig) {
    if (!config.chain.chainId.startsWith("eip155:")) {
      throw new Error(
        `EvmObserver: expected EVM chain ID (eip155:*), got '${config.chain.chainId}'`
      );
    }
    this.chainId = config.chain.chainId;
    this.config = config;
    this.profile = config.profile;
    this.telemetry = config.telemetry ?? NOOP_TELEMETRY;
    this.retryConfig = config.retry ?? DEFAULT_RPC_RETRY;

    // Resolve native token metadata: profile > static map > default
    this.nativeToken =
      config.profile?.nativeToken ??
      NATIVE_TOKEN_META[this.chainId] ??
      DEFAULT_NATIVE_TOKEN;
  }

  async connect(): Promise<void> {
    const viemChain = this.resolveViemChain();

    this.client = createPublicClient({
      chain: viemChain,
      transport: http(this.config.rpcUrl, {
        timeout: this.config.timeoutMs ?? 30_000,
      }),
    });
  }

  /**
   * Resolve the viem Chain to connect with (PB-WCO-006).
   *
   * Resolution order:
   *   1. Built-in {@link VIEM_CHAINS} map (the well-known chains).
   *   2. A config-supplied {@link EvmChainDescriptor} (`config.evmChain`).
   *   3. A minimal chain synthesized from the eip155 chain id + `rpcUrl`.
   *
   * viem only strictly needs `id` + `rpcUrls` for read calls, so an unknown but
   * valid EVM chain degrades to "works with defaults" instead of hard-failing
   * with UNSUPPORTED_CHAIN — supporting a new L2/sidechain becomes configuration,
   * not a source edit + release. UNSUPPORTED_CHAIN is now only thrown when the
   * eip155 chain id cannot be parsed (a structurally invalid chain ref).
   */
  private resolveViemChain(): Chain {
    const builtin = VIEM_CHAINS[this.chainId];
    if (builtin) return builtin;

    // Parse the numeric id from the eip155:<id> chain ref (constructor already
    // guaranteed the eip155: prefix).
    const numericId = Number(this.chainId.slice("eip155:".length));
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new ObserverError({
        code: "UNSUPPORTED_CHAIN",
        chainId: this.chainId,
        message:
          `EvmObserver: cannot derive a numeric EVM chain id from '${this.chainId}'. ` +
          `Built-in: ${Object.keys(VIEM_CHAINS).join(", ")}`,
        hint:
          `Use a valid eip155:<id> chain ref, supply config.evmChain for a custom chain, ` +
          `or use one of the built-in chains (${Object.keys(VIEM_CHAINS).join(", ")}).`,
      });
    }

    const descriptor: EvmChainDescriptor = this.config.evmChain ?? { id: numericId };
    return EvmObserver.synthesizeChain(descriptor, numericId, this.config.rpcUrl);
  }

  /**
   * Build a minimal viem {@link Chain} for an EVM chain not in the built-in map
   * (PB-WCO-006). viem needs only `id` + `rpcUrls` for read calls; name and
   * native-currency default sensibly so labeling stays reasonable.
   */
  private static synthesizeChain(
    descriptor: EvmChainDescriptor,
    fallbackId: number,
    rpcUrl: string,
  ): Chain {
    const id = descriptor.id || fallbackId;
    return {
      id,
      name: descriptor.name ?? `EVM Chain ${id}`,
      nativeCurrency: descriptor.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
    } as const satisfies Chain;
  }

  async disconnect(): Promise<void> {
    this.client = null;
  }

  async getStatus(): Promise<ConnectionStatus> {
    const now = new Date().toISOString();
    if (!this.client) {
      return {
        chainId: this.chainId,
        connected: false,
        checkedAt: now,
        error: "EvmObserver: not connected. Call connect() before querying.",
        errorCode: "NOT_CONNECTED",
      };
    }

    let blockNumber: bigint;
    try {
      blockNumber = await this.client.getBlockNumber();
    } catch (err) {
      // The core liveness probe failed → genuinely disconnected. Surface the
      // reason and a classified code instead of an unexplained connected:false
      // (D3-B-002). A health probe must not throw, so we return rather than rethrow.
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
      latestBlock: Number(blockNumber),
      checkedAt: now,
    };

    // When a profile with finality config is present, also fetch finalized and
    // safe block numbers via EVM block tags. D3-B-009: a finality-tag failure
    // (some RPCs/chains don't serve "finalized"/"safe") must degrade to
    // "connected, finality unknown" — NOT "disconnected". We already proved
    // liveness via getBlockNumber above, so we wrap this in its own try/catch
    // and, on failure, return the connected status with the latest block plus a
    // soft error note (without flipping connected to false).
    if (this.profile?.finality) {
      const { finalizedBlockTag, safeBlockTag } = this.profile.finality;
      try {
        const blockPromises: [Promise<bigint> | undefined, Promise<bigint> | undefined] = [
          finalizedBlockTag
            ? this.client.getBlock({ blockTag: finalizedBlockTag as "finalized" }).then((b) => b.number ?? 0n)
            : undefined,
          safeBlockTag
            ? this.client.getBlock({ blockTag: safeBlockTag as "safe" }).then((b) => b.number ?? 0n)
            : undefined,
        ];

        const [finalizedBlock, safeBlock] = await Promise.all(
          blockPromises.map((p) => p ?? Promise.resolve(undefined))
        );

        return {
          ...status,
          ...(finalizedBlock !== undefined && { finalizedBlock: Number(finalizedBlock) }),
          ...(safeBlock !== undefined && { safeBlock: Number(safeBlock) }),
        };
      } catch (err) {
        // Finality tags unavailable — stay connected, report finality unknown.
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
    const client = this.requireClient();
    const address = query.address as `0x${string}`;

    const [balance, blockNumber] = await this.runRpc("getBalance", () =>
      Promise.all([
        query.atBlock !== undefined
          ? client.getBalance({ address, blockNumber: BigInt(query.atBlock) })
          : client.getBalance({ address }),
        query.atBlock !== undefined
          ? Promise.resolve(BigInt(query.atBlock))
          : client.getBlockNumber(),
      ]),
    );

    return {
      chainId: this.chainId,
      address: query.address,
      balance: balance.toString(),
      decimals: this.nativeToken.decimals,
      symbol: this.nativeToken.symbol,
      atBlock: Number(blockNumber),
      observedAt: new Date().toISOString(),
    };
  }

  async getTokenBalance(query: TokenBalanceQuery): Promise<TokenBalance> {
    const client = this.requireClient();
    const tokenAddress = query.token as `0x${string}`;
    const ownerAddress = query.address as `0x${string}`;

    const [balance, symbol, decimals] = await this.runRpc("getTokenBalance", () =>
      Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: [ERC20_BALANCE_OF],
          functionName: "balanceOf",
          args: [ownerAddress],
        }),
        client.readContract({
          address: tokenAddress,
          abi: [ERC20_SYMBOL],
          functionName: "symbol",
        }),
        client.readContract({
          address: tokenAddress,
          abi: [ERC20_DECIMALS],
          functionName: "decimals",
        }),
      ]),
    );

    return {
      chainId: this.chainId,
      address: query.address,
      token: query.token,
      symbol: symbol as string,
      balance: (balance as bigint).toString(),
      decimals: Number(decimals),
      observedAt: new Date().toISOString(),
    };
  }

  async getTransfers(query: TransferQuery): Promise<readonly TransferEvent[]> {
    const client = this.requireClient();
    const address = query.address as `0x${string}`;
    const currentBlock = await this.runRpc("getTransfers", () => client.getBlockNumber());

    const fromBlock = query.fromBlock !== undefined
      ? BigInt(query.fromBlock)
      : currentBlock - 1000n; // Default: last ~1000 blocks
    const toBlock = query.toBlock !== undefined
      ? BigInt(query.toBlock)
      : currentBlock;

    // D3-A-006: bound the block span before issuing any getLogs. An unbounded
    // (or very large) range is a DoS risk — and a filterless all-tokens scan is
    // worse, since getLogs without an address scans every contract and many RPCs
    // reject address-less getLogs entirely. Fail closed with a structured error.
    // (This throws ObserverError BLOCK_RANGE_TOO_LARGE *before* any RPC, so it is
    // intentionally outside runRpc — it is a guard, not a classified RPC failure.)
    this.assertBlockSpan(fromBlock, toBlock, query.token === undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allLogs: any[] = [];
    const now = new Date().toISOString();

    // All getLogs calls run under runRpc so a network/RPC failure surfaces as a
    // classified ObserverError (RPC_TIMEOUT / RATE_LIMITED / ...) with telemetry,
    // rather than a raw viem error (D3-B-003).
    await this.runRpc("getTransfers", async () => {
      if (query.token) {
        // ERC-20 Transfer events for a specific token
        const tokenAddress = query.token as `0x${string}`;

        if (query.direction !== "outgoing") {
          const incomingLogs = await client.getLogs({
            address: tokenAddress,
            event: ERC20_TRANSFER_EVENT,
            args: { to: address },
            fromBlock,
            toBlock,
          });
          allLogs.push(...incomingLogs);
        }

        if (query.direction !== "incoming") {
          const outgoingLogs = await client.getLogs({
            address: tokenAddress,
            event: ERC20_TRANSFER_EVENT,
            args: { from: address },
            fromBlock,
            toBlock,
          });

          for (const log of outgoingLogs) {
            // A-CO-002: de-dup on the (transactionHash, logIndex) tuple, which
            // uniquely identifies a log event. A single tx can emit MANY distinct
            // Transfer logs (DEX swap, router, multisend) — and when the watched
            // address both receives and sends in one tx, those distinct logs share
            // a txHash but differ by logIndex. De-duping on txHash alone silently
            // drops the later distinct transfer; the tuple removes only TRUE
            // duplicates (the same log returned by both the from- and to-filters).
            if (!EvmObserver.logSeen(allLogs, log)) {
              allLogs.push(log);
            }
          }
        }
      } else {
        // ERC-20 Transfer events across all tokens (no specific token filter)
        if (query.direction !== "outgoing") {
          const incomingLogs = await client.getLogs({
            event: ERC20_TRANSFER_EVENT,
            args: { to: address },
            fromBlock,
            toBlock,
          });
          allLogs.push(...incomingLogs);
        }

        if (query.direction !== "incoming") {
          const outgoingLogs = await client.getLogs({
            event: ERC20_TRANSFER_EVENT,
            args: { from: address },
            fromBlock,
            toBlock,
          });

          for (const log of outgoingLogs) {
            // A-CO-002: de-dup on (transactionHash, logIndex). See the token-
            // filtered path above for the full rationale.
            if (!EvmObserver.logSeen(allLogs, log)) {
              allLogs.push(log);
            }
          }
        }
      }
    });

    // Resolve token metadata for all unique token addresses in the logs.
    // Batch the unique addresses to minimize RPC calls.
    const uniqueTokenAddresses = [...new Set(
      allLogs.map((log) => (log.address as string).toLowerCase()),
    )];
    const metaResults = await Promise.allSettled(
      uniqueTokenAddresses.map(async (addr) => {
        const meta = await this.resolveTokenMeta(addr as `0x${string}`);
        return [addr, meta] as const;
      }),
    );
    const tokenMetaMap = new Map(
      metaResults
        .filter((r): r is PromiseFulfilledResult<readonly [string, { symbol: string; decimals: number; resolved: boolean }]> => r.status === "fulfilled")
        .map((r) => r.value),
    );

    // Convert logs to TransferEvents with resolved metadata. A token whose meta
    // entry is missing (its resolve promise itself rejected) is treated as an
    // explicit unresolved guess (PB-WCO-005) — never a confident default.
    const events: TransferEvent[] = allLogs.map((log) => {
      const meta =
        tokenMetaMap.get((log.address as string).toLowerCase()) ??
        { symbol: "UNKNOWN", decimals: 18, resolved: false };
      return this.logToTransferEvent(log, now, meta);
    });

    // Sort by block number (ascending)
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

  /**
   * True when `log` is already present in `seen`, keyed on the
   * (transactionHash, logIndex) tuple that uniquely identifies a log event
   * (A-CO-002). Distinct transfers within the same tx (same hash, different
   * logIndex) are NOT considered duplicates; only the exact same log is.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static logSeen(seen: any[], log: any): boolean {
    return seen.some(
      (e) =>
        e.transactionHash === log.transactionHash &&
        e.logIndex === log.logIndex,
    );
  }

  /** Per-token metadata cache to avoid repeated on-chain queries. Max 1000 entries. */
  private static readonly MAX_TOKEN_CACHE = 1000;
  /**
   * Cache of SUCCESSFULLY-resolved token metadata only. Fallback (guessed)
   * metadata is NEVER cached (PB-WCO-005), so a transient decimals-query failure
   * does not poison every subsequent transfer for that token — a later
   * successful resolve corrects it.
   */
  private readonly tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();

  private requireClient(): PublicClient<HttpTransport, Chain> {
    if (!this.client) {
      const err = new ObserverError({
        code: "NOT_CONNECTED",
        chainId: this.chainId,
        message: "EvmObserver: not connected. Call connect() before querying.",
        hint: "Call connect() and await it before issuing queries.",
      });
      this.emitRpcFailure("NOT_CONNECTED");
      throw err;
    }
    return this.client;
  }

  /**
   * Emit a structured `rpc` failure telemetry event with low-cardinality
   * attributes (`chainId`, `code`). Never throws — telemetry must not break the
   * operation it observes (the sink contract guarantees `record` won't throw,
   * but we guard defensively).
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
   * Emit a structured `rpc.retry` event (outcome `"degraded"`, level `warn`)
   * when a transient RPC failure is about to be retried (PB-WCO-004). This gives
   * operators the early-warning window that silent retries removed: a rising
   * retry rate per chain reveals a degrading endpoint BEFORE it tips into hard
   * failures. Low-cardinality attributes only (`chainId`, `code`, `attempt`).
   * Never throws.
   */
  private emitRpcRetry(code: string, attempt: number): void {
    try {
      this.telemetry.record({
        package: "@attestia/chain-observer",
        op: "rpc.retry",
        level: "warn",
        outcome: "degraded",
        attributes: { chainId: this.chainId, code, attempt },
        message: `EvmObserver: retrying transient RPC failure (${code}) on ${this.chainId}, attempt ${attempt}`,
      });
    } catch {
      /* observability must never throw into the caller */
    }
  }

  /**
   * Run an RPC operation under the shared retry-with-backoff discipline
   * (PB-WCO-001): transient classified failures (RATE_LIMITED / RPC_TIMEOUT /
   * RPC_UNREACHABLE) are retried, all other classes fail closed immediately.
   * The FINAL failure (after retries) is classified and re-thrown as a
   * structured {@link ObserverError} with a `rpc` failure event (D3-B-003); each
   * retry emits an `rpc.retry` event (PB-WCO-004). The original error is
   * preserved as `cause`.
   *
   * @param context Operation name for the error message (e.g. "getBalance").
   * @param fn The RPC call to execute.
   */
  private async runRpc<T>(context: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(fn, {
        maxRetries: this.retryConfig.maxRetries,
        delayMs: this.retryConfig.delayMs,
        onRetry: ({ attempt, code }) => this.emitRpcRetry(code, attempt),
      });
    } catch (err) {
      const observerError = toObserverError(err, `EvmObserver.${context}`, this.chainId);
      this.emitRpcFailure(observerError.code);
      throw observerError;
    }
  }

  /**
   * Enforce a bound on the Transfer-scan block span (D3-A-006).
   *
   * @param fromBlock Inclusive start block.
   * @param toBlock Inclusive end block.
   * @param filterless True when no token (address) filter is applied — the
   *   dangerous all-contracts path, which gets a much tighter cap.
   * @throws ObserverError (`BLOCK_RANGE_TOO_LARGE`) if the span exceeds the cap.
   */
  private assertBlockSpan(fromBlock: bigint, toBlock: bigint, filterless: boolean): void {
    const span = toBlock - fromBlock;
    const limit = filterless
      ? BigInt(EvmObserver.MAX_FILTERLESS_BLOCK_SPAN)
      : BigInt(EvmObserver.MAX_BLOCK_SPAN);

    if (span > limit) {
      const kind = filterless ? "all-tokens (filterless)" : "token-filtered";
      throw new ObserverError({
        code: "BLOCK_RANGE_TOO_LARGE",
        chainId: this.chainId,
        message:
          `EvmObserver.getTransfers: block range ${span} exceeds the maximum ` +
          `${kind} span of ${limit} (fromBlock=${fromBlock}, toBlock=${toBlock}).`,
        hint: filterless
          ? `Provide a 'token' to scan a single contract, or narrow the range to <= ${limit} blocks (chunk larger scans).`
          : `Narrow the range to <= ${limit} blocks, or chunk the scan into smaller windows.`,
      });
    }
  }

  /**
   * Resolve token metadata (symbol + decimals) for an ERC-20 contract.
   *
   * On success the result is cached and returned with `resolved: true`. On
   * failure (PB-WCO-005) we do NOT fail the whole transfer scan, but we also do
   * NOT pretend the guess is ground truth: we emit a `token_meta_fallback`
   * telemetry warn, return `resolved: false` with a non-confident `"UNKNOWN"`
   * symbol, and DO NOT cache the fallback — so a transient failure cannot poison
   * the token for the observer's lifetime, and a later successful resolve wins.
   */
  private async resolveTokenMeta(
    tokenAddress: `0x${string}`,
  ): Promise<{ symbol: string; decimals: number; resolved: boolean }> {
    const cached = this.tokenMetaCache.get(tokenAddress);
    if (cached) return { ...cached, resolved: true };

    const client = this.requireClient();
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: [ERC20_SYMBOL],
          functionName: "symbol",
        }),
        client.readContract({
          address: tokenAddress,
          abi: [ERC20_DECIMALS],
          functionName: "decimals",
        }),
      ]);
      const meta = { symbol: symbol as string, decimals: Number(decimals) };
      this.evictOldestIfFull();
      this.tokenMetaCache.set(tokenAddress, meta);
      return { ...meta, resolved: true };
    } catch {
      // Metadata query failed. Degrade WITHOUT lying: flag the guess, warn, and
      // refuse to cache it so it doesn't misstate amounts for the process
      // lifetime (PB-WCO-005). `decimals: 18` is a structural necessity (amount
      // must carry SOME scale) but `resolved: false` + `symbol: "UNKNOWN"` make
      // the guess explicit on the resulting TransferEvent.
      this.emitTokenMetaFallback();
      return { symbol: "UNKNOWN", decimals: 18, resolved: false };
    }
  }

  /**
   * Emit a `token_meta_fallback` telemetry warn (outcome `"degraded"`) when an
   * ERC-20 symbol/decimals query fails and a guessed default is used. Low-
   * cardinality attributes only (`chainId`). Never throws. This surfaces a
   * previously-silent degradation operators must be able to meter (PB-WCO-005).
   */
  private emitTokenMetaFallback(): void {
    try {
      this.telemetry.record({
        package: "@attestia/chain-observer",
        op: "token_meta_fallback",
        level: "warn",
        outcome: "degraded",
        attributes: { chainId: this.chainId },
        message:
          `EvmObserver: ERC-20 metadata (symbol/decimals) query failed on ${this.chainId}; ` +
          `using guessed defaults (symbol=UNKNOWN, decimals=18). Reported amounts for ` +
          `non-18-decimal tokens may be misstated until metadata resolves — see TransferEvent.metaResolved.`,
      });
    } catch {
      /* observability must never throw into the caller */
    }
  }

  /** Evict the oldest cache entry if at capacity. */
  private evictOldestIfFull(): void {
    if (this.tokenMetaCache.size >= EvmObserver.MAX_TOKEN_CACHE) {
      const oldest = this.tokenMetaCache.keys().next().value;
      if (oldest !== undefined) {
        this.tokenMetaCache.delete(oldest);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private logToTransferEvent(
    log: any,
    observedAt: string,
    tokenMeta: { symbol: string; decimals: number; resolved: boolean },
  ): TransferEvent {
    return {
      chainId: this.chainId,
      txHash: log.transactionHash ?? "",
      blockNumber: Number(log.blockNumber ?? 0n),
      from: log.args?.from ?? "",
      to: log.args?.to ?? "",
      amount: (log.args?.value ?? 0n).toString(),
      decimals: tokenMeta.decimals,
      symbol: tokenMeta.symbol,
      token: log.address,
      timestamp: new Date().toISOString(), // Block timestamp requires extra query
      observedAt,
      // PB-WCO-005: expose whether symbol/decimals are ground truth or guessed.
      metaResolved: tokenMeta.resolved,
    };
  }
}
