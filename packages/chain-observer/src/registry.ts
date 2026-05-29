/**
 * Observer Registry
 *
 * Manages multiple ChainObservers for multi-chain queries.
 * Provides a single entry point for cross-chain observation.
 *
 * Design rules:
 * - Observers are registered, not auto-discovered
 * - Each chain has at most one observer
 * - Multi-chain queries run in parallel
 * - Individual chain failures don't block others
 */

import type { ChainId } from "@attestia/types";
import type {
  ChainObserver,
  BalanceQuery,
  BalanceResult,
  ConnectionStatus,
} from "./observer.js";

/**
 * Result of a multi-chain operation that may partially fail.
 */
export interface MultiChainResult<T> {
  readonly successes: readonly T[];
  readonly errors: readonly { readonly chainId: ChainId; readonly error: string }[];
}

export class ObserverRegistry {
  private readonly observers: Map<ChainId, ChainObserver> = new Map();

  /**
   * Register an observer for a chain.
   * Throws if an observer for this chain is already registered.
   */
  register(observer: ChainObserver): void {
    if (this.observers.has(observer.chainId)) {
      throw new Error(
        `ObserverRegistry: observer for chain '${observer.chainId}' is already registered`
      );
    }
    this.observers.set(observer.chainId, observer);
  }

  /**
   * Unregister an observer for a chain.
   * Returns true if an observer was removed, false if none was registered.
   */
  unregister(chainId: ChainId): boolean {
    return this.observers.delete(chainId);
  }

  /**
   * Get the observer for a specific chain.
   * Throws if no observer is registered for this chain.
   */
  get(chainId: ChainId): ChainObserver {
    const observer = this.observers.get(chainId);
    if (!observer) {
      throw new Error(
        `ObserverRegistry: no observer registered for chain '${chainId}'`
      );
    }
    return observer;
  }

  /**
   * Check if an observer is registered for a chain.
   */
  has(chainId: ChainId): boolean {
    return this.observers.has(chainId);
  }

  /**
   * List all registered chain IDs.
   */
  listChains(): readonly ChainId[] {
    return [...this.observers.keys()];
  }

  /**
   * Connect all registered observers.
   */
  async connectAll(): Promise<MultiChainResult<ConnectionStatus>> {
    const chainIds = [...this.observers.keys()];
    const results = await Promise.allSettled(
      chainIds.map(async (chainId) => {
        const observer = this.observers.get(chainId)!;
        await observer.connect();
        return observer.getStatus();
      })
    );

    return this.partitionResults(results, chainIds);
  }

  /**
   * Disconnect all registered observers.
   */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.observers.values()].map((observer) => observer.disconnect())
    );
  }

  /**
   * Get status of all registered observers.
   */
  async getStatusAll(): Promise<MultiChainResult<ConnectionStatus>> {
    const chainIds = [...this.observers.keys()];
    const results = await Promise.allSettled(
      chainIds.map((chainId) => this.observers.get(chainId)!.getStatus())
    );
    return this.partitionResults(results, chainIds);
  }

  /**
   * Get balance across multiple chains for the same address pattern.
   * Useful for checking an address across all observed chains.
   */
  async getBalanceMultiChain(
    query: BalanceQuery,
    chainIds?: readonly ChainId[]
  ): Promise<MultiChainResult<BalanceResult>> {
    const targets = chainIds ?? this.listChains();
    const results = await Promise.allSettled(
      targets.map((chainId) => {
        const observer = this.observers.get(chainId);
        if (!observer) {
          return Promise.reject(
            new Error(`No observer registered for chain '${chainId}'`)
          );
        }
        return observer.getBalance(query);
      })
    );
    // D3-A-005: attribute results by the EXACT ordered target list used to build
    // them, not by observers.keys() — `targets` may be a reordered subset.
    return this.partitionResults(results, targets);
  }

  /**
   * Partition Promise.allSettled results into successes and errors.
   *
   * @param results The settled results, positionally aligned with `chainIds`.
   * @param chainIds The chain IDs in the EXACT order the tasks were dispatched,
   *   so a rejected result at index `i` is attributed to `chainIds[i]`. Callers
   *   MUST pass the same ordered list they used to build `results` (which may be
   *   a reordered subset of the registered observers).
   */
  private partitionResults<T extends { readonly chainId?: ChainId }>(
    results: PromiseSettledResult<T>[],
    chainIds: readonly ChainId[]
  ): MultiChainResult<T> {
    const successes: T[] = [];
    const errors: { readonly chainId: ChainId; readonly error: string }[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "fulfilled") {
        successes.push(result.value);
      } else {
        const chainId = chainIds[i] ?? "unknown";
        errors.push({
          chainId,
          error: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        });
      }
    }

    return { successes, errors };
  }
}
