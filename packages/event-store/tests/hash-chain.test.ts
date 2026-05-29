/**
 * Tests for event store hash chain — tamper-evident event log.
 */

import { describe, it, expect } from "vitest";
import { InMemoryEventStore } from "../src/in-memory-store.js";
import { JsonlEventStore } from "../src/jsonl-store.js";
import { computeEventHash, verifyHashChain, GENESIS_HASH } from "../src/hash-chain.js";
import { isHashedEvent } from "../src/types.js";
import type { StoredEvent, HashedStoredEvent } from "../src/types.js";
import type { DomainEvent } from "@attestia/types";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

function makeEvent(type: string, payload: Record<string, unknown> = {}): DomainEvent {
  return {
    type,
    metadata: { timestamp: "2025-01-01T00:00:00Z", correlationId: "test" },
    payload,
  };
}

// =============================================================================
// computeEventHash
// =============================================================================

describe("computeEventHash", () => {
  it("produces a 64-char hex string", () => {
    const event: StoredEvent = {
      event: { type: "test", metadata: { timestamp: "t", correlationId: "c" }, payload: {} },
      streamId: "s",
      version: 1,
      globalPosition: 1,
      appendedAt: "2025-01-01T00:00:00Z",
    };
    const hash = computeEventHash(event, GENESIS_HASH);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const event: StoredEvent = {
      event: { type: "test", metadata: { timestamp: "t", correlationId: "c" }, payload: { x: 1 } },
      streamId: "s",
      version: 1,
      globalPosition: 1,
      appendedAt: "2025-01-01T00:00:00Z",
    };
    const h1 = computeEventHash(event, GENESIS_HASH);
    const h2 = computeEventHash(event, GENESIS_HASH);
    expect(h1).toBe(h2);
  });

  it("changes when event content changes", () => {
    const base: StoredEvent = {
      event: { type: "test", metadata: { timestamp: "t", correlationId: "c" }, payload: {} },
      streamId: "s",
      version: 1,
      globalPosition: 1,
      appendedAt: "2025-01-01T00:00:00Z",
    };
    const modified: StoredEvent = {
      ...base,
      event: { ...base.event, payload: { tampered: true } },
    };
    expect(computeEventHash(base, GENESIS_HASH)).not.toBe(
      computeEventHash(modified, GENESIS_HASH),
    );
  });

  it("changes when previousHash changes", () => {
    const event: StoredEvent = {
      event: { type: "test", metadata: { timestamp: "t", correlationId: "c" }, payload: {} },
      streamId: "s",
      version: 1,
      globalPosition: 1,
      appendedAt: "2025-01-01T00:00:00Z",
    };
    const h1 = computeEventHash(event, GENESIS_HASH);
    const h2 = computeEventHash(event, "different-previous-hash");
    expect(h1).not.toBe(h2);
  });
});

// =============================================================================
// verifyHashChain
// =============================================================================

describe("verifyHashChain", () => {
  it("returns valid for an empty event list", () => {
    const result = verifyHashChain([]);
    expect(result.valid).toBe(true);
    expect(result.lastVerifiedPosition).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid for events without hash fields (pre-chain)", () => {
    const events: StoredEvent[] = [
      {
        event: { type: "test", metadata: { timestamp: "t", correlationId: "c" }, payload: {} },
        streamId: "s",
        version: 1,
        globalPosition: 1,
        appendedAt: "2025-01-01T00:00:00Z",
      },
    ];
    const result = verifyHashChain(events);
    expect(result.valid).toBe(true);
    expect(result.lastVerifiedPosition).toBe(0);
  });

  it("validates a correctly chained sequence", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);
    const events = store.readAll();

    const result = verifyHashChain(events);
    expect(result.valid).toBe(true);
    expect(result.lastVerifiedPosition).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it("detects tampered event content", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);
    const events = [...store.readAll()] as Array<StoredEvent & { hash: string; previousHash: string }>;

    // Tamper with the second event's payload
    events[1] = {
      ...events[1]!,
      event: { ...events[1]!.event, payload: { tampered: true } },
    };

    const result = verifyHashChain(events);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.position).toBe(2);
  });

  it("detects broken chain link (previousHash mismatch)", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);
    const events = [...store.readAll()] as Array<StoredEvent & { hash: string; previousHash: string }>;

    // Replace the second event's previousHash
    events[1] = { ...events[1]!, previousHash: "bogus" };

    const result = verifyHashChain(events);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.position === 2)).toBe(true);
  });

  // D2-A-001: a fully-hashed chain MUST begin at genesis. Otherwise a verifier
  // that adopts the first event's self-claimed previousHash cannot tell a
  // genuine head from a head-truncated tail.
  it("detects head truncation — chain does not start at genesis", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);
    const events = [...store.readAll()] as Array<StoredEvent & { hash: string; previousHash: string }>;

    // Drop the first (genesis) event — the surviving head now links to a hash,
    // not GENESIS_HASH.
    const truncated = events.slice(1);
    expect(truncated[0]!.previousHash).not.toBe(GENESIS_HASH);

    const result = verifyHashChain(truncated);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /genesis/i.test(e.reason))).toBe(true);
  });

  it("rejects a chain whose first event's previousHash is not genesis", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("a"), makeEvent("b")]);
    const events = [...store.readAll()] as Array<StoredEvent & { hash: string; previousHash: string }>;

    // Tamper the genesis event to claim a different predecessor.
    events[0] = { ...events[0]!, previousHash: "a".repeat(64) };

    const result = verifyHashChain(events);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.position === 1)).toBe(true);
  });

  it("still validates a genuine genesis-rooted chain", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);
    const result = verifyHashChain(store.readAll());
    expect(result.valid).toBe(true);
    expect(result.lastVerifiedPosition).toBe(3);
  });
});

// =============================================================================
// InMemoryEventStore hash chain
// =============================================================================

describe("InMemoryEventStore hash chain", () => {
  it("appended events have hash and previousHash fields", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("test")]);
    const events = store.readAll();
    expect(events).toHaveLength(1);
    expect(isHashedEvent(events[0]!)).toBe(true);
    const hashed = events[0] as HashedStoredEvent;
    expect(hashed.previousHash).toBe(GENESIS_HASH);
    expect(hashed.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains events across multiple appends", () => {
    const store = new InMemoryEventStore();
    store.append("s1", [makeEvent("a")]);
    store.append("s2", [makeEvent("b")]);
    store.append("s1", [makeEvent("c")]);
    const events = store.readAll();

    expect(events).toHaveLength(3);
    const e0 = events[0] as HashedStoredEvent;
    const e1 = events[1] as HashedStoredEvent;
    const e2 = events[2] as HashedStoredEvent;

    expect(e0.previousHash).toBe(GENESIS_HASH);
    expect(e1.previousHash).toBe(e0.hash);
    expect(e2.previousHash).toBe(e1.hash);
  });

  it("verifyIntegrity passes for valid store", () => {
    const store = new InMemoryEventStore();
    store.append("s", [makeEvent("a"), makeEvent("b")]);
    store.append("s", [makeEvent("c")]);
    const result = store.verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.lastVerifiedPosition).toBe(3);
  });
});

// =============================================================================
// JsonlEventStore hash chain
// =============================================================================

describe("JsonlEventStore hash chain", () => {
  const testDir = join(process.cwd(), ".test-hash-chain");

  function createStore(name: string): JsonlEventStore {
    return new JsonlEventStore({ filePath: join(testDir, `${name}.jsonl`) });
  }

  // Clean up before each test
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("persists hash chain fields in JSONL", () => {
    const store = createStore("persist");
    store.append("s", [makeEvent("a"), makeEvent("b")]);

    // Reload from file
    const reloaded = new JsonlEventStore({ filePath: store.filePath });
    const events = reloaded.readAll();
    expect(events).toHaveLength(2);
    expect(isHashedEvent(events[0]!)).toBe(true);
    expect(isHashedEvent(events[1]!)).toBe(true);
  });

  it("continues chain after reload", () => {
    const store = createStore("continue");
    store.append("s", [makeEvent("a")]);

    // Reload and append more
    const reloaded = new JsonlEventStore({ filePath: store.filePath });
    reloaded.append("s", [makeEvent("b")]);

    const events = reloaded.readAll();
    expect(events).toHaveLength(2);
    const e0 = events[0] as HashedStoredEvent;
    const e1 = events[1] as HashedStoredEvent;
    expect(e1.previousHash).toBe(e0.hash);
  });

  it("verifyIntegrity passes after reload", () => {
    const store = createStore("integrity");
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);

    const reloaded = new JsonlEventStore({ filePath: store.filePath });
    const result = reloaded.verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.lastVerifiedPosition).toBe(3);
  });

  it("backward compat: loads pre-chain JSONL without errors", () => {
    const filePath = join(testDir, "legacy.jsonl");
    // Write a legacy event without hash fields
    const legacy = JSON.stringify({
      event: { type: "old", metadata: { timestamp: "t", correlationId: "c" }, payload: {} },
      streamId: "s",
      version: 1,
      globalPosition: 1,
      appendedAt: "2025-01-01T00:00:00Z",
    });
    writeFileSync(filePath, legacy + "\n", "utf-8");

    const store = new JsonlEventStore({ filePath });
    expect(store.globalPosition()).toBe(1);

    // New appends get hash chain
    store.append("s", [makeEvent("new")]);
    const events = store.readAll();
    expect(events).toHaveLength(2);
    expect(isHashedEvent(events[0]!)).toBe(false); // legacy
    expect(isHashedEvent(events[1]!)).toBe(true);   // new
  });
});
