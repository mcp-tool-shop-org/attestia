/**
 * Rate limiting middleware — token bucket per authenticated principal.
 *
 * Each unique principal gets a token bucket with configurable fill rate and
 * burst capacity. Returns 429 with a Retry-After header when the bucket is
 * empty.
 *
 * Scoping (security-critical): the bucket key is `${tenantId}:${identity}`, NOT
 * `identity` alone. For JWT auth, `identity = claims.sub`, which is only unique
 * WITHIN a tenant — two tenants reusing the same sub would otherwise share one
 * bucket, letting one tenant throttle the other (cross-tenant / targeted DoS,
 * V2-001). This mirrors the tenant-scoped idempotency cache key.
 */

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/api-contract.js";
import { createErrorEnvelope } from "../types/error.js";

// =============================================================================
// Token Bucket
// =============================================================================

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitConfig {
  /** Requests per minute (fill rate) */
  readonly rpm: number;
  /** Maximum burst capacity */
  readonly burst: number;
  /**
   * Maximum number of distinct buckets to retain. Once exceeded, the
   * least-recently-used bucket is evicted (B-NODE-001). A fresh bucket starts
   * full, so dropping an idle/LRU bucket is safe — the next request from that
   * principal simply re-creates a full bucket. Default: {@link DEFAULT_MAX_BUCKETS}.
   */
  readonly maxBuckets?: number | undefined;
  /**
   * How often (ms) the background sweeper drops idle buckets. A bucket is idle
   * when it has had no activity for longer than the full-refill window (the time
   * to refill `burst` tokens at `rpm`), at which point it would refill to full
   * anyway. Default: 0 — no background timer (cap-only eviction), so a bare
   * `new TokenBucketStore(...)` never leaks a timer. The real server opts in by
   * passing {@link DEFAULT_SWEEP_INTERVAL_MS} (see createApp's
   * `enableStoreSweepers`).
   */
  readonly sweepIntervalMs?: number | undefined;
  /**
   * Timer factory, for testing. Defaults to Node's `setInterval` with `unref()`
   * so the sweeper never holds the event loop open. Tests inject a controllable
   * timer (or disable sweeping via `sweepIntervalMs: 0`) to avoid leaked timers.
   */
  readonly setIntervalFn?: ((handler: () => void, ms: number) => NodeJS.Timeout) | undefined;
  /** Clear-timer function paired with {@link setIntervalFn}. Default: `clearInterval`. */
  readonly clearIntervalFn?: ((handle: NodeJS.Timeout) => void) | undefined;
}

/** Default LRU cap on distinct rate-limit buckets (B-NODE-001). */
export const DEFAULT_MAX_BUCKETS = 100_000;

/** Default background sweep interval (5 minutes) for idle-bucket eviction. */
export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60_000;

export class TokenBucketStore {
  // Map preserves insertion order; re-inserting on access turns it into an
  // LRU recency list, so the first key is always the least-recently-used.
  private readonly _buckets = new Map<string, Bucket>();
  private readonly _rpm: number;
  private readonly _burst: number;
  private readonly _maxBuckets: number;
  /** Idle window after which a bucket would refill to full anyway (ms). */
  private readonly _idleWindowMs: number;
  private readonly _clearIntervalFn: (handle: NodeJS.Timeout) => void;
  private _sweepTimer: NodeJS.Timeout | undefined;

  constructor(config: RateLimitConfig) {
    this._rpm = config.rpm;
    this._burst = config.burst;
    this._maxBuckets = config.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    // Time (ms) to refill a full burst at `rpm`. A bucket untouched for longer
    // than this would refill to full on its next access, so it is equivalent to
    // a fresh (absent) bucket and safe to evict.
    this._idleWindowMs = (this._burst / this._rpm) * 60_000;
    this._clearIntervalFn = config.clearIntervalFn ?? clearInterval;

    // Default off (0): a bare store never spins up a timer. The app turns it on.
    const sweepIntervalMs = config.sweepIntervalMs ?? 0;
    if (sweepIntervalMs > 0) {
      const setIntervalFn =
        config.setIntervalFn ??
        ((handler, ms) => {
          const t = setInterval(handler, ms);
          // Never keep the process alive just to sweep buckets.
          t.unref?.();
          return t;
        });
      this._sweepTimer = setIntervalFn(() => this.sweep(), sweepIntervalMs);
    }
  }

  /**
   * Try to consume a token for the given identity.
   *
   * @returns Object with `allowed` flag and metadata.
   */
  consume(identity: string, cost: number = 1): {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
  } {
    const now = Date.now();
    let bucket = this._buckets.get(identity);

    if (bucket === undefined) {
      bucket = { tokens: this._burst, lastRefill: now };
      this._buckets.set(identity, bucket);
      // Enforce the LRU cap on insertion so the store can never grow without
      // bound across distinct principals (B-NODE-001).
      this._evictIfOverCap();
    } else {
      // Touch for LRU recency: re-insert so this key moves to the most-recent
      // (last) position in the Map's iteration order.
      this._buckets.delete(identity);
      this._buckets.set(identity, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedMs = now - bucket.lastRefill;
    const tokensToAdd = (elapsedMs / 60000) * this._rpm;
    bucket.tokens = Math.min(this._burst, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }

    // Calculate when enough tokens will be available
    const retryAfterMs = Math.ceil((cost - bucket.tokens) / this._rpm * 60000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  /**
   * Drop buckets idle longer than the full-refill window. Such a bucket would
   * refill to full on its next access, so evicting it preserves rate-limit
   * semantics exactly while reclaiming memory. Returns the number evicted
   * (handy for tests / metrics).
   */
  sweep(now: number = Date.now()): number {
    let evicted = 0;
    for (const [key, bucket] of this._buckets) {
      if (now - bucket.lastRefill >= this._idleWindowMs) {
        this._buckets.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** Evict least-recently-used buckets until at or under the cap. */
  private _evictIfOverCap(): void {
    while (this._buckets.size > this._maxBuckets) {
      // The first key in iteration order is the least-recently-used.
      const oldest = this._buckets.keys().next().value;
      if (oldest === undefined) break;
      this._buckets.delete(oldest);
    }
  }

  get size(): number {
    return this._buckets.size;
  }

  clear(): void {
    this._buckets.clear();
  }

  /**
   * Stop the background sweeper and release its timer. Idempotent. Call on
   * graceful shutdown (B-NODE-003) so the process can exit cleanly and tests do
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

/**
 * Create rate limiting middleware.
 *
 * Must run AFTER auth middleware. The bucket key is `${tenantId}:${identity}`
 * so principals are isolated per tenant (a JWT `sub` is only unique within its
 * tenant — see the file header, V2-001).
 */
export function rateLimitMiddleware(
  store: TokenBucketStore,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    // Write operations cost more tokens than reads
    const cost = c.req.method === "GET" || c.req.method === "HEAD" ? 1 : 5;
    // Scope the bucket per tenant so a shared identity (JWT sub) across tenants
    // cannot collide into one bucket (cross-tenant throttling / DoS, V2-001).
    const bucketKey = `${auth.tenantId}:${auth.identity}`;
    const result = store.consume(bucketKey, cost);

    c.header("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        createErrorEnvelope(
          "RATE_LIMITED",
          `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`,
        ),
        429,
      );
    }

    return next();
  };
}
