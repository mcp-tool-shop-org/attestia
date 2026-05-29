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
} from "../observer.js";
import type { ChainProfile } from "../finality.js";
import { ObserverError } from "../errors.js";

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

    // Resolve native token metadata: profile > static map > default
    this.nativeToken =
      config.profile?.nativeToken ??
      NATIVE_TOKEN_META[this.chainId] ??
      DEFAULT_NATIVE_TOKEN;
  }

  async connect(): Promise<void> {
    const viemChain = VIEM_CHAINS[this.chainId];
    if (!viemChain) {
      throw new Error(
        `EvmObserver: unsupported chain '${this.chainId}'. ` +
          `Supported: ${Object.keys(VIEM_CHAINS).join(", ")}`
      );
    }

    this.client = createPublicClient({
      chain: viemChain,
      transport: http(this.config.rpcUrl, {
        timeout: this.config.timeoutMs ?? 30_000,
      }),
    });
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
      };
    }

    try {
      const blockNumber = await this.client.getBlockNumber();

      const status: ConnectionStatus = {
        chainId: this.chainId,
        connected: true,
        latestBlock: Number(blockNumber),
        checkedAt: now,
      };

      // When a profile with finality config is present, also fetch
      // finalized and safe block numbers via EVM block tags.
      if (this.profile?.finality) {
        const { finalizedBlockTag, safeBlockTag } = this.profile.finality;
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
      }

      return status;
    } catch {
      return {
        chainId: this.chainId,
        connected: false,
        checkedAt: now,
      };
    }
  }

  async getBalance(query: BalanceQuery): Promise<BalanceResult> {
    const client = this.requireClient();
    const address = query.address as `0x${string}`;

    const [balance, blockNumber] = await Promise.all([
      query.atBlock !== undefined
        ? client.getBalance({ address, blockNumber: BigInt(query.atBlock) })
        : client.getBalance({ address }),
      query.atBlock !== undefined
        ? Promise.resolve(BigInt(query.atBlock))
        : client.getBlockNumber(),
    ]);

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

    const [balance, symbol, decimals] = await Promise.all([
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
    ]);

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
    const currentBlock = await client.getBlockNumber();

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
    this.assertBlockSpan(fromBlock, toBlock, query.token === undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allLogs: any[] = [];
    const now = new Date().toISOString();

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
          // Avoid duplicates (self-transfers)
          if (!allLogs.some((e) => e.transactionHash === log.transactionHash)) {
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
          if (!allLogs.some((e) => e.transactionHash === log.transactionHash)) {
            allLogs.push(log);
          }
        }
      }
    }

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
        .filter((r): r is PromiseFulfilledResult<readonly [string, { symbol: string; decimals: number }]> => r.status === "fulfilled")
        .map((r) => r.value),
    );

    // Convert logs to TransferEvents with resolved metadata
    const events: TransferEvent[] = allLogs.map((log) => {
      const meta = tokenMetaMap.get((log.address as string).toLowerCase()) ?? { symbol: "ERC20", decimals: 18 };
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

  /** Per-token metadata cache to avoid repeated on-chain queries. Max 1000 entries. */
  private static readonly MAX_TOKEN_CACHE = 1000;
  private readonly tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();

  private requireClient(): PublicClient<HttpTransport, Chain> {
    if (!this.client) {
      throw new Error(
        "EvmObserver: not connected. Call connect() before querying."
      );
    }
    return this.client;
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
   * Results are cached per token address for the lifetime of this observer.
   * Falls back to sensible defaults if on-chain queries fail.
   */
  private async resolveTokenMeta(
    tokenAddress: `0x${string}`,
  ): Promise<{ symbol: string; decimals: number }> {
    const cached = this.tokenMetaCache.get(tokenAddress);
    if (cached) return cached;

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
      return meta;
    } catch {
      // If metadata query fails, use defaults rather than failing the transfer scan.
      const fallback = { symbol: "ERC20", decimals: 18 };
      this.evictOldestIfFull();
      this.tokenMetaCache.set(tokenAddress, fallback);
      return fallback;
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
    tokenMeta: { symbol: string; decimals: number },
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
    };
  }
}
