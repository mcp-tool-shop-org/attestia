/**
 * Portfolio Observer — Multi-chain portfolio aggregation.
 *
 * Takes an ObserverRegistry from @attestia/chain-observer and
 * builds a unified portfolio view across all watched addresses.
 *
 * Rules:
 * - Read-only: no signing, no execution
 * - Aggregates by currency across chains
 * - Fails gracefully on individual chain errors
 * - Always records observation timestamp
 */

import type { ObserverRegistry, TransferQuery } from "@attestia/chain-observer";
import type { Telemetry } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";

import type {
  Portfolio,
  TokenPosition,
  CurrencyTotal,
  WatchedAddress,
  ObservationError,
} from "./types.js";
import { formatAmount } from "@attestia/ledger";

// =============================================================================
// Portfolio Observer
// =============================================================================

export class PortfolioObserver {
  private readonly registry: ObserverRegistry;
  private readonly telemetry: Telemetry;

  /**
   * @param telemetry Optional observability sink (D4-B-001). Defaults to
   *   {@link NOOP_TELEMETRY}. A partial observation (one or more chains
   *   unreachable) emits `portfolio.observe` with outcome `degraded` and a
   *   `{ chainsTotal, chainsFailed }` attribute pair (both low-cardinality
   *   counts); raw addresses/reasons stay in the surfaced
   *   {@link Portfolio.errors}, never in `attributes`.
   */
  constructor(registry: ObserverRegistry, telemetry: Telemetry = NOOP_TELEMETRY) {
    this.registry = registry;
    this.telemetry = telemetry;
  }

  /**
   * Observe the full portfolio for an owner across all watched addresses.
   * Individual chain/address failures don't block the overall observation.
   */
  async observe(
    ownerId: string,
    addresses: readonly WatchedAddress[],
  ): Promise<Portfolio> {
    const now = new Date().toISOString();
    const nativePositions: TokenPosition[] = [];
    const tokenPositions: TokenPosition[] = [];
    const errors: ObservationError[] = [];

    // Query native balances for each watched address
    for (const addr of addresses) {
      if (!this.registry.has(addr.chainId)) {
        errors.push({
          chainId: addr.chainId,
          address: addr.address,
          reason: `No observer for chain '${addr.chainId}'`,
        });
        continue;
      }

      try {
        const observer = this.registry.get(addr.chainId);
        const result = await observer.getBalance({ address: addr.address });

        nativePositions.push({
          chainId: result.chainId,
          address: addr.address,
          symbol: result.symbol,
          balance: result.balance,
          decimals: result.decimals,
          observedAt: result.observedAt,
        });
      } catch (err) {
        errors.push({
          chainId: addr.chainId,
          address: addr.address,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Aggregate totals (only from the addresses that responded). A malformed
    // balance string from a single observer is recorded into `errors` and
    // skipped rather than thrown — one bad response must not blank the whole
    // portfolio total (degradation stays visible, not silent).
    const totals = this.aggregateTotals(
      [...nativePositions, ...tokenPositions],
      errors,
    );

    // Graceful degradation must be VISIBLE: a portfolio assembled from a subset
    // of reachable chains carries the failures + a `partial` flag so the caller
    // never mistakes a silently-incomplete total for an authoritative one.
    const partial = errors.length > 0;
    if (partial) {
      // Counts are low-cardinality (safe as metric labels); the raw
      // addresses/reasons live in the surfaced `errors`, not in `attributes`.
      this.telemetry.record({
        package: "@attestia/vault",
        op: "portfolio.observe",
        level: "warn",
        outcome: "degraded",
        attributes: {
          chainsTotal: addresses.length,
          chainsFailed: errors.length,
        },
        message: `portfolio for '${ownerId}' is partial: ${errors.length}/${addresses.length} watched address(es) failed`,
      });
    }

    return {
      ownerId,
      nativePositions,
      tokenPositions,
      observedAt: now,
      totals,
      errors,
      partial,
    };
  }

  /**
   * Observe a specific token position for an address.
   */
  async observeToken(
    address: WatchedAddress,
    token: string,
    issuer?: string,
  ): Promise<TokenPosition | null> {
    if (!this.registry.has(address.chainId)) {
      return null;
    }

    try {
      const observer = this.registry.get(address.chainId);
      const query = issuer !== undefined
        ? { address: address.address, token, issuer }
        : { address: address.address, token };
      const result = await observer.getTokenBalance(query);

      return {
        chainId: result.chainId,
        address: address.address,
        symbol: result.symbol,
        balance: result.balance,
        decimals: result.decimals,
        token: result.token,
        observedAt: result.observedAt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get transfer history for an address.
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
    if (!this.registry.has(address.chainId)) {
      return [];
    }

    const observer = this.registry.get(address.chainId);
    const transferQuery: TransferQuery = Object.assign(
      { address: address.address },
      options?.direction !== undefined ? { direction: options.direction } : {},
      options?.token !== undefined ? { token: options.token } : {},
      options?.fromBlock !== undefined ? { fromBlock: options.fromBlock } : {},
      options?.toBlock !== undefined ? { toBlock: options.toBlock } : {},
      options?.limit !== undefined ? { limit: options.limit } : {},
    );
    return observer.getTransfers(transferQuery);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────

  private aggregateTotals(
    positions: readonly TokenPosition[],
    errors: ObservationError[],
  ): readonly CurrencyTotal[] {
    const totals = new Map<
      string,
      {
        currency: string;
        balance: bigint;
        decimals: number;
        chainIds: Set<string>;
      }
    >();

    for (const pos of positions) {
      // Key by symbol AND decimals: the same symbol reported with different
      // decimals on different chains (e.g. 6-decimal USDC vs an 18-decimal
      // wrapped variant) is NOT additive in base units. Grouping them would
      // silently sum apples + oranges; keeping them separate keeps each total
      // honest.
      const key = `${pos.symbol}:${pos.decimals}`;

      // A malformed balance string would throw a SyntaxError out of BigInt()
      // and abort the entire aggregation. Skip + record it instead so one bad
      // observer response can't blank every other chain's total.
      let amount: bigint;
      try {
        amount = BigInt(pos.balance);
      } catch {
        errors.push({
          chainId: pos.chainId,
          address: pos.address,
          reason: `Malformed balance '${pos.balance}' for ${pos.symbol}`,
        });
        continue;
      }

      const existing = totals.get(key);
      if (existing) {
        existing.balance += amount;
        existing.chainIds.add(pos.chainId);
      } else {
        totals.set(key, {
          currency: pos.symbol,
          balance: amount,
          decimals: pos.decimals,
          chainIds: new Set([pos.chainId]),
        });
      }
    }

    return [...totals.values()].map((data) => ({
      currency: data.currency,
      totalBalance: formatAmount(data.balance, data.decimals),
      decimals: data.decimals,
      chainCount: data.chainIds.size,
    }));
  }
}
