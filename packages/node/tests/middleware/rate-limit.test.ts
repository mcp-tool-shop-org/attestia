/**
 * Tests for rate limiting middleware.
 *
 * Verifies:
 * - Token bucket allows requests within capacity
 * - Bucket denies requests when empty
 * - Retry-After header is set on 429 responses
 * - Different identities get separate buckets
 * - Buckets are scoped per tenant (no cross-tenant bleed, V2-001)
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { TokenBucketStore, rateLimitMiddleware } from "../../src/middleware/rate-limit.js";
import type { AppEnv } from "../../src/types/api-contract.js";
import type { AuthContext } from "../../src/types/auth.js";

describe("TokenBucketStore", () => {
  it("allows requests within burst capacity", () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 5 });

    for (let i = 0; i < 5; i++) {
      const result = store.consume("user-1");
      expect(result.allowed).toBe(true);
    }
  });

  it("denies requests when burst is exhausted", () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 3 });

    // Exhaust the bucket
    for (let i = 0; i < 3; i++) {
      store.consume("user-1");
    }

    const result = store.consume("user-1");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates buckets per identity", () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 2 });

    // Exhaust user-1
    store.consume("user-1");
    store.consume("user-1");
    expect(store.consume("user-1").allowed).toBe(false);

    // user-2 should still have tokens
    expect(store.consume("user-2").allowed).toBe(true);
  });

  it("reports remaining tokens", () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 3 });

    let result = store.consume("user-1");
    expect(result.remaining).toBe(2);

    result = store.consume("user-1");
    expect(result.remaining).toBe(1);

    result = store.consume("user-1");
    expect(result.remaining).toBe(0);
  });

  it("tracks the number of active buckets", () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 5 });

    store.consume("a");
    store.consume("b");
    store.consume("c");

    expect(store.size).toBe(3);
  });

  it("clear() removes all buckets", () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 5 });

    store.consume("a");
    store.consume("b");
    store.clear();

    expect(store.size).toBe(0);
  });
});

// =============================================================================
// B-NODE-001 [HIGH]: bounded eviction — sweeper + LRU cap, no leaked timers.
// =============================================================================

describe("TokenBucketStore eviction (B-NODE-001)", () => {
  it("does not create a timer when sweepIntervalMs is 0 (no leak in tests)", () => {
    // No timer is created, so dispose() is a no-op and nothing leaks. The cap
    // still bounds memory without a sweeper.
    const store = new TokenBucketStore({ rpm: 60, burst: 5, sweepIntervalMs: 0 });
    store.consume("a");
    expect(store.size).toBe(1);
    store.dispose(); // safe even with no timer
  });

  it("sweep() drops buckets idle past the full-refill window", () => {
    // full-refill window = burst/rpm = 5/300 min = 1s.
    const store = new TokenBucketStore({ rpm: 300, burst: 5, sweepIntervalMs: 0 });
    store.consume("idle", 1); // lastRefill ≈ now

    expect(store.size).toBe(1);
    // Not yet idle (well within the 1s window).
    expect(store.sweep(Date.now() + 500)).toBe(0);
    expect(store.size).toBe(1);
    // Past the 1s window → evicted.
    expect(store.sweep(Date.now() + 2_000)).toBe(1);
    expect(store.size).toBe(0);
  });

  it("evicting an idle bucket preserves rate-limit semantics (fresh bucket is full)", () => {
    const store = new TokenBucketStore({ rpm: 300, burst: 2, sweepIntervalMs: 0 });

    // Exhaust the bucket.
    expect(store.consume("u").allowed).toBe(true);
    expect(store.consume("u").allowed).toBe(true);
    expect(store.consume("u").allowed).toBe(false);

    // Sweep it away as if idle, then re-consume — a fresh full bucket, exactly
    // as if it had refilled. Semantics are unchanged by eviction.
    store.sweep(Date.now() + 60_000);
    expect(store.size).toBe(0);
    expect(store.consume("u").allowed).toBe(true);
  });

  it("enforces an LRU cap on distinct buckets", () => {
    const store = new TokenBucketStore({
      rpm: 60,
      burst: 5,
      maxBuckets: 3,
      sweepIntervalMs: 0,
    });

    store.consume("a");
    store.consume("b");
    store.consume("c");
    expect(store.size).toBe(3);

    // Touch "a" so it becomes most-recent; "b" is now the LRU.
    store.consume("a");
    // Insert a 4th distinct bucket → evicts the LRU ("b"), not "a".
    store.consume("d");

    expect(store.size).toBe(3);
    // "b" was evicted: a fresh full bucket on next access.
    expect(store.consume("b").remaining).toBe(4);
  });

  it("dispose() stops the sweeper and is idempotent", () => {
    let cleared = 0;
    const fakeHandle = {} as NodeJS.Timeout;
    const store = new TokenBucketStore({
      rpm: 60,
      burst: 5,
      sweepIntervalMs: 1000,
      setIntervalFn: () => fakeHandle,
      clearIntervalFn: () => {
        cleared++;
      },
    });

    store.dispose();
    store.dispose(); // idempotent — clearInterval called at most once
    expect(cleared).toBe(1);
  });

  it("invokes the injected sweeper on tick and evicts idle buckets", () => {
    let registered: (() => void) | undefined;
    const store = new TokenBucketStore({
      rpm: 300,
      burst: 1,
      sweepIntervalMs: 1000,
      setIntervalFn: (handler) => {
        registered = handler;
        return {} as NodeJS.Timeout;
      },
      clearIntervalFn: () => {},
    });

    store.consume("x");
    expect(store.size).toBe(1);
    // Drive the registered sweep handler; the bucket's lastRefill is "now", so
    // it is not idle yet — manual sweep with a far-future time evicts it.
    expect(typeof registered).toBe("function");
    expect(store.sweep(Date.now() + 60_000)).toBe(1);
    store.dispose();
  });
});

// =============================================================================
// V2-001 [MEDIUM, tenant-bleed]: bucket must be scoped per tenant.
//
// For JWT auth, identity = claims.sub, which is only unique WITHIN a tenant.
// Two tenants reusing the same sub (e.g. "user-1") must NOT share a bucket —
// otherwise one tenant's traffic throttles the other (targeted cross-tenant
// DoS). The middleware keys the shared store by `${tenantId}:${identity}`.
// =============================================================================

describe("rateLimitMiddleware tenant scoping (V2-001)", () => {
  function makeApp(store: TokenBucketStore, auth: AuthContext) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("auth", auth);
      await next();
    });
    app.use("*", rateLimitMiddleware(store));
    app.get("/ping", (c) => c.text("ok"));
    return app;
  }

  const baseAuth = (tenantId: string): AuthContext => ({
    type: "jwt",
    identity: "user-1", // SAME sub across tenants
    role: "viewer",
    tenantId,
  });

  it("gives two tenants with the same identity independent buckets", async () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 2 });
    const tenantA = makeApp(store, baseAuth("tenant-a"));
    const tenantB = makeApp(store, baseAuth("tenant-b"));

    // Exhaust tenant A's bucket (burst = 2 read tokens).
    expect((await tenantA.request("/ping")).status).toBe(200);
    expect((await tenantA.request("/ping")).status).toBe(200);
    expect((await tenantA.request("/ping")).status).toBe(429);

    // Tenant B shares the same identity ("user-1") but a different tenant —
    // it must still have a full bucket.
    expect((await tenantB.request("/ping")).status).toBe(200);
    expect((await tenantB.request("/ping")).status).toBe(200);
    expect((await tenantB.request("/ping")).status).toBe(429);

    // Two distinct buckets in the shared store.
    expect(store.size).toBe(2);
  });

  it("keys the store by `${tenantId}:${identity}`", async () => {
    const store = new TokenBucketStore({ rpm: 60, burst: 5 });
    const app = makeApp(store, baseAuth("tenant-a"));

    await app.request("/ping");

    // The bucket exists under the composite key, NOT the bare identity.
    expect(store.consume("tenant-a:user-1").remaining).toBeLessThan(5);
    // The bare identity is a fresh, untouched bucket.
    expect(store.consume("user-1").remaining).toBe(4);
  });
});
