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

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly _cache = new Map<string, CachedResponse>();
  private readonly _ttlMs: number;

  constructor(ttlMs: number = 86400000) {
    this._ttlMs = ttlMs;
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
    this._cache.set(key, response);
  }

  get size(): number {
    return this._cache.size;
  }

  clear(): void {
    this._cache.clear();
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
          {
            error: {
              code: "IDEMPOTENCY_MISMATCH",
              message: "Idempotency key reuse with different request body",
            },
          },
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
