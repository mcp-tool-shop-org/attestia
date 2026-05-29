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
}

export class TokenBucketStore {
  private readonly _buckets = new Map<string, Bucket>();
  private readonly _rpm: number;
  private readonly _burst: number;

  constructor(config: RateLimitConfig) {
    this._rpm = config.rpm;
    this._burst = config.burst;
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

  get size(): number {
    return this._buckets.size;
  }

  clear(): void {
    this._buckets.clear();
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
