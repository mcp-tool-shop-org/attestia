/**
 * Idempotency middleware.
 *
 * Caches POST mutation responses by Idempotency-Key header.
 * If the same key is seen again within the TTL, the cached
 * response is returned instead of re-executing the handler.
 *
 * Scoping (security-critical): the cache key is NOT the raw client-supplied
 * Idempotency-Key. It is composed of the authenticated tenant, the HTTP method
 * and concrete request path, AND the Idempotency-Key:
 *
 *     `${tenantId}:${method} ${path}:${idempotencyKey}`
 *
 * This prevents two distinct failures that a global, key-only store has:
 *   - Cross-tenant leakage (D6-A-001): tenant B replaying tenant A's cached
 *     mutation response by reusing the same key + body.
 *   - Wrong-result replay (D6-A-002): the same key on a different route/param
 *     (e.g. /intents/A/approve then /intents/B/approve) replaying the first
 *     response instead of acting on the second resource.
 */

import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/api-contract.js";
import { createErrorEnvelope } from "../types/error.js";

// =============================================================================
// Idempotency Store Interface
// =============================================================================

export interface CachedResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string>;
  readonly cachedAt: number;
  /** SHA-256 hex digest of the original request body */
  readonly bodyHash: string;
}

export interface IdempotencyStore {
  get(key: string): CachedResponse | undefined;
  set(key: string, response: CachedResponse): void;
}

// =============================================================================
// In-Memory Store
// =============================================================================

/** Default cap on retained idempotency entries (B-NODE-002). */
export const DEFAULT_MAX_ENTRIES = 50_000;

/** Default background sweep interval (5 minutes) for expired-entry eviction. */
export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60_000;

export interface InMemoryIdempotencyStoreOptions {
  /**
   * Maximum number of entries to retain. Once exceeded, the least-recently-set
   * entry is evicted (FIFO/LRU), bounding memory even when keys are written once
   * and never re-read (the common success case, B-NODE-002). Default:
   * {@link DEFAULT_MAX_ENTRIES}.
   */
  readonly maxEntries?: number | undefined;
  /**
   * How often (ms) the background sweeper drops entries past their TTL. Without
   * it, a key that is never re-read is never evicted (its lazy eviction in
   * `get()` never fires). Default: 0 — no background timer (cap-only eviction),
   * so a bare `new InMemoryIdempotencyStore(...)` never leaks a timer. The real
   * server opts in by passing {@link DEFAULT_SWEEP_INTERVAL_MS} (see createApp's
   * `enableStoreSweepers`).
   */
  readonly sweepIntervalMs?: number | undefined;
  /**
   * Maximum cached body size (bytes). Responses with a larger body are not
   * cached, so one large response cannot dominate memory (B-NODE-002). A skipped
   * cache simply means a retry re-executes — safe for idempotent mutations.
   * Default: {@link DEFAULT_MAX_BODY_BYTES}.
   */
  readonly maxBodyBytes?: number | undefined;
  /** Timer factory, for testing. Default: unref'd `setInterval`. */
  readonly setIntervalFn?: ((handler: () => void, ms: number) => NodeJS.Timeout) | undefined;
  /** Clear-timer function. Default: `clearInterval`. */
  readonly clearIntervalFn?: ((handle: NodeJS.Timeout) => void) | undefined;
}

/** Default cap on a single cached response body (1 MiB). */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly _cache = new Map<string, CachedResponse>();
  private readonly _ttlMs: number;
  private readonly _maxEntries: number;
  private readonly _maxBodyBytes: number;
  private readonly _clearIntervalFn: (handle: NodeJS.Timeout) => void;
  private _sweepTimer: NodeJS.Timeout | undefined;

  constructor(
    ttlMs: number = 86400000,
    options: InMemoryIdempotencyStoreOptions = {},
  ) {
    this._ttlMs = ttlMs;
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this._clearIntervalFn = options.clearIntervalFn ?? clearInterval;

    // Default off (0): a bare store never spins up a timer. The app turns it on.
    const sweepIntervalMs = options.sweepIntervalMs ?? 0;
    if (sweepIntervalMs > 0) {
      const setIntervalFn =
        options.setIntervalFn ??
        ((handler, ms) => {
          const t = setInterval(handler, ms);
          t.unref?.();
          return t;
        });
      this._sweepTimer = setIntervalFn(() => this.sweep(), sweepIntervalMs);
    }
  }

  get(key: string): CachedResponse | undefined {
    const entry = this._cache.get(key);
    if (entry === undefined) {
      return undefined;
    }

    if (Date.now() - entry.cachedAt > this._ttlMs) {
      this._cache.delete(key);
      return undefined;
    }

    return entry;
  }

  set(key: string, response: CachedResponse): void {
    // Bound a single cached body so one oversized response cannot dominate
    // memory. Skipping the cache is safe: the next identical retry re-executes
    // the (idempotent) mutation rather than replaying.
    if (response.body.length > this._maxBodyBytes) {
      return;
    }
    // Re-insert to keep most-recent at the tail of the Map's iteration order.
    this._cache.delete(key);
    this._cache.set(key, response);
    this._evictIfOverCap();
  }

  /**
   * Drop every entry past its TTL. Without this, an entry written once and
   * never re-read would live until process exit (B-NODE-002). Returns the
   * number evicted.
   */
  sweep(now: number = Date.now()): number {
    let evicted = 0;
    for (const [key, entry] of this._cache) {
      if (now - entry.cachedAt > this._ttlMs) {
        this._cache.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** Evict least-recently-set entries until at or under the cap. */
  private _evictIfOverCap(): void {
    while (this._cache.size > this._maxEntries) {
      const oldest = this._cache.keys().next().value;
      if (oldest === undefined) break;
      this._cache.delete(oldest);
    }
  }

  get size(): number {
    return this._cache.size;
  }

  clear(): void {
    this._cache.clear();
  }

  /**
   * Stop the background sweeper and release its timer. Idempotent. Call on
   * graceful shutdown (B-NODE-003) so the process exits cleanly and tests do
   * not leak a timer.
   */
  dispose(): void {
    if (this._sweepTimer !== undefined) {
      this._clearIntervalFn(this._sweepTimer);
      this._sweepTimer = undefined;
    }
  }
}

// =============================================================================
// Middleware
// =============================================================================

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function idempotencyMiddleware(
  store: IdempotencyStore,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method !== "POST") {
      return next();
    }

    const idempotencyKey = c.req.header(IDEMPOTENCY_HEADER);
    if (idempotencyKey === undefined) {
      return next();
    }

    // Bind the cache entry to the authenticated tenant. Without a resolved
    // tenant we cannot guarantee isolation, so we fail closed: skip caching
    // entirely rather than risk a shared, tenant-less bucket (D6-A-001).
    const auth = c.get("auth");
    if (auth === undefined) {
      return next();
    }

    // Scope the cache key to tenant + method + concrete path + the client key.
    // The concrete path (not the route template) keeps per-param requests
    // distinct, e.g. /intents/A/approve vs /intents/B/approve (D6-A-002).
    const storeKey = `${auth.tenantId}:${c.req.method} ${c.req.path}:${idempotencyKey}`;

    // Read the request body and compute its hash for comparison
    const requestBody = await c.req.text();
    const requestBodyHash = createHash("sha256").update(requestBody).digest("hex");

    const cached = store.get(storeKey);
    if (cached !== undefined) {
      // Same key but different body → cache poisoning attempt
      if (cached.bodyHash !== requestBodyHash) {
        return c.json(
          createErrorEnvelope(
            "IDEMPOTENCY_MISMATCH",
            "Idempotency key reuse with different request body",
            "Reuse this Idempotency-Key only for byte-identical retries; use a fresh key for a different request.",
          ),
          422,
        );
      }

      for (const [key, value] of Object.entries(cached.headers)) {
        c.header(key, value);
      }
      c.header("X-Idempotent-Replay", "true");
      return c.body(cached.body, cached.status as 200);
    }

    await next();

    if (c.res.status < 400) {
      const clonedRes = c.res.clone();
      const body = await clonedRes.text();
      const headers: Record<string, string> = {};
      clonedRes.headers.forEach((value, key) => {
        headers[key] = value;
      });

      store.set(storeKey, {
        status: clonedRes.status,
        body,
        headers,
        cachedAt: Date.now(),
        bodyHash: requestBodyHash,
      });
    }
  };
}
