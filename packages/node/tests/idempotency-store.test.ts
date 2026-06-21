/**
 * Tests for InMemoryIdempotencyStore lifecycle — size and clear().
 */

import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "../src/middleware/idempotency.js";
import type { CachedResponse } from "../src/middleware/idempotency.js";

function entry(body = "{}", cachedAt = Date.now()): CachedResponse {
  return { status: 200, body, headers: {}, cachedAt, bodyHash: "0".repeat(64) };
}

describe("InMemoryIdempotencyStore lifecycle", () => {
  it("size reflects number of cached entries", () => {
    const store = new InMemoryIdempotencyStore(86400000, { sweepIntervalMs: 0 });

    expect(store.size).toBe(0);

    store.set("k1", {
      status: 200,
      body: "{}",
      headers: {},
      cachedAt: Date.now(),
      bodyHash: "0".repeat(64),
    });
    expect(store.size).toBe(1);

    store.set("k2", {
      status: 201,
      body: '{"ok":true}',
      headers: {},
      cachedAt: Date.now(),
      bodyHash: "0".repeat(64),
    });
    expect(store.size).toBe(2);
  });

  it("clear() removes all entries", () => {
    const store = new InMemoryIdempotencyStore(86400000, { sweepIntervalMs: 0 });

    store.set("k1", {
      status: 200,
      body: "{}",
      headers: {},
      cachedAt: Date.now(),
      bodyHash: "0".repeat(64),
    });
    store.set("k2", {
      status: 200,
      body: "{}",
      headers: {},
      cachedAt: Date.now(),
      bodyHash: "0".repeat(64),
    });

    expect(store.size).toBe(2);

    store.clear();

    expect(store.size).toBe(0);
    expect(store.get("k1")).toBeUndefined();
    expect(store.get("k2")).toBeUndefined();
  });
});

// =============================================================================
// B-NODE-002 [HIGH]: bounded eviction — sweeper + cap + body-size cap.
// =============================================================================

describe("InMemoryIdempotencyStore eviction (B-NODE-002)", () => {
  it("sweep() drops entries past the TTL even if never re-read", () => {
    const ttl = 1000;
    const store = new InMemoryIdempotencyStore(ttl, { sweepIntervalMs: 0 });
    const now = Date.now();

    store.set("fresh", entry("{}", now));
    store.set("stale", entry("{}", now - ttl - 1));
    expect(store.size).toBe(2);

    // The stale entry was never re-read (its lazy get()-eviction never fired),
    // so only the background sweep can reclaim it.
    const evicted = store.sweep(now);
    expect(evicted).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get("fresh")).toBeDefined();
  });

  it("enforces a max-entries cap with LRU/FIFO eviction", () => {
    const store = new InMemoryIdempotencyStore(86400000, {
      maxEntries: 2,
      sweepIntervalMs: 0,
    });

    store.set("a", entry());
    store.set("b", entry());
    store.set("c", entry()); // exceeds cap → "a" (oldest) evicted

    expect(store.size).toBe(2);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toBeDefined();
    expect(store.get("c")).toBeDefined();
  });

  it("does not cache a body larger than maxBodyBytes", () => {
    const store = new InMemoryIdempotencyStore(86400000, {
      maxBodyBytes: 8,
      sweepIntervalMs: 0,
    });

    store.set("small", entry("tiny"));
    store.set("big", entry("x".repeat(100)));

    expect(store.get("small")).toBeDefined();
    // The oversized response is simply not cached — a retry re-executes.
    expect(store.get("big")).toBeUndefined();
    expect(store.size).toBe(1);
  });

  it("dispose() stops the sweeper and is idempotent", () => {
    let cleared = 0;
    const store = new InMemoryIdempotencyStore(86400000, {
      sweepIntervalMs: 1000,
      setIntervalFn: () => ({}) as NodeJS.Timeout,
      clearIntervalFn: () => {
        cleared++;
      },
    });

    store.dispose();
    store.dispose();
    expect(cleared).toBe(1);
  });
});
