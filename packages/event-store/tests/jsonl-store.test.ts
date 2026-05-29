/**
 * Tests for JsonlEventStore.
 *
 * Verifies:
 * - Persistence: events survive store recreation
 * - Crash safety: partial/corrupt lines are skipped
 * - File creation: directory and file created on demand
 * - Parity: same behavior as InMemoryEventStore for core operations
 * - Append + fsync: data written to disk
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DomainEvent } from "@attestia/types";
import { JsonlEventStore } from "../src/jsonl-store.js";
import { EventStoreError } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

let testDir: string;
let testFile: string;

function freshPath(): string {
  const id = Math.random().toString(36).slice(2, 10);
  return join(testDir, `store-${id}.jsonl`);
}

function makeEvent(type: string, correlationId?: string): DomainEvent {
  return {
    type,
    metadata: {
      eventId: `evt-${type}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      actor: "test",
      correlationId: correlationId ?? `corr-${Math.random().toString(36).slice(2, 8)}`,
      source: "vault",
    },
    payload: { type },
  };
}

function makeEvents(count: number, prefix = "event"): DomainEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent(`${prefix}.${i + 1}`),
  );
}

beforeEach(() => {
  testDir = join(tmpdir(), `attestia-jsonl-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testDir, { recursive: true });
  testFile = join(testDir, "events.jsonl");
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// =============================================================================
// File Creation
// =============================================================================

describe("file creation", () => {
  it("creates the file on first append", () => {
    const store = new JsonlEventStore({ filePath: testFile });

    expect(existsSync(testFile)).toBe(false);

    store.append("stream-1", [makeEvent("test")]);

    expect(existsSync(testFile)).toBe(true);
  });

  it("creates nested directories", () => {
    const nestedPath = join(testDir, "deep", "nested", "dir", "events.jsonl");
    const store = new JsonlEventStore({ filePath: nestedPath });

    store.append("stream-1", [makeEvent("test")]);

    expect(existsSync(nestedPath)).toBe(true);
  });

  it("loads from existing file on construction", () => {
    const path = freshPath();

    // Write events with first store
    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", [makeEvent("first")]);
    store1.append("stream-1", [makeEvent("second")]);

    // Recreate store from same file
    const store2 = new JsonlEventStore({ filePath: path });

    expect(store2.streamVersion("stream-1")).toBe(2);
    expect(store2.globalPosition()).toBe(2);

    const events = store2.read("stream-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe("first");
    expect(events[1]!.event.type).toBe("second");
  });
});

// =============================================================================
// Persistence
// =============================================================================

describe("persistence", () => {
  it("events survive store recreation", () => {
    const path = freshPath();

    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-a", makeEvents(3, "a"));
    store1.append("stream-b", makeEvents(2, "b"));

    const store2 = new JsonlEventStore({ filePath: path });

    expect(store2.streamVersion("stream-a")).toBe(3);
    expect(store2.streamVersion("stream-b")).toBe(2);
    expect(store2.globalPosition()).toBe(5);
  });

  it("preserves event data across reload", () => {
    const path = freshPath();

    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", [makeEvent("intent.declared")]);

    const store2 = new JsonlEventStore({ filePath: path });
    const [event] = store2.read("stream-1");

    expect(event!.event.type).toBe("intent.declared");
    expect(event!.event.metadata.actor).toBe("test");
    expect(event!.event.payload).toEqual({ type: "intent.declared" });
    expect(event!.streamId).toBe("stream-1");
    expect(event!.version).toBe(1);
    expect(event!.globalPosition).toBe(1);
  });

  it("continues version sequence after reload", () => {
    const path = freshPath();

    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", makeEvents(3));

    const store2 = new JsonlEventStore({ filePath: path });
    const result = store2.append("stream-1", [makeEvent("continued")]);

    expect(result.fromVersion).toBe(4);
    expect(store2.streamVersion("stream-1")).toBe(4);
    expect(store2.globalPosition()).toBe(4);
  });

  it("continues global position after reload", () => {
    const path = freshPath();

    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", makeEvents(3));
    store1.append("stream-2", makeEvents(2));

    const store2 = new JsonlEventStore({ filePath: path });
    store2.append("stream-3", [makeEvent("new")]);

    const all = store2.readAll();
    expect(all).toHaveLength(6);
    expect(all[5]!.globalPosition).toBe(6);
  });

  it("file contains one JSON per line", () => {
    const path = freshPath();

    const store = new JsonlEventStore({ filePath: path });
    store.append("stream-1", makeEvents(3));

    const content = readFileSync(path, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.streamId).toBe("stream-1");
      expect(typeof parsed.version).toBe("number");
      expect(typeof parsed.globalPosition).toBe("number");
    }
  });
});

// =============================================================================
// Crash Safety
// =============================================================================

describe("crash safety", () => {
  it("skips corrupt lines at end of file", () => {
    const path = freshPath();

    // Write valid events then append garbage
    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", makeEvents(2));

    // Simulate crash: append partial JSON
    writeFileSync(path, '{"partial":true, "broken\n', { flag: "a" });

    // Reload — should skip the corrupt line
    const store2 = new JsonlEventStore({ filePath: path });

    expect(store2.streamVersion("stream-1")).toBe(2);
    expect(store2.globalPosition()).toBe(2);
  });

  it("skips empty lines", () => {
    const path = freshPath();

    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", [makeEvent("test")]);

    // Inject empty lines
    const content = readFileSync(path, "utf-8");
    writeFileSync(path, "\n\n" + content + "\n\n");

    const store2 = new JsonlEventStore({ filePath: path });
    expect(store2.streamVersion("stream-1")).toBe(1);
  });

  it("skips lines with missing required fields", () => {
    const path = freshPath();

    // Write a valid event first
    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", [makeEvent("valid")]);

    // Append a line missing streamId
    const content = readFileSync(path, "utf-8");
    writeFileSync(path, content + '{"event":{"type":"bad"},"version":1,"globalPosition":99}\n');

    const store2 = new JsonlEventStore({ filePath: path });
    expect(store2.streamVersion("stream-1")).toBe(1);
    expect(store2.globalPosition()).toBe(1);
  });
});

// =============================================================================
// Core Operations (Parity with InMemoryEventStore)
// =============================================================================

describe("core operations", () => {
  it("assigns monotonically increasing versions within a stream", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });

    store.append("stream-1", makeEvents(2));
    store.append("stream-1", makeEvents(3));

    const all = store.read("stream-1");
    expect(all).toHaveLength(5);
    expect(all.map((e) => e.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it("maintains independent version sequences per stream", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });

    store.append("stream-a", makeEvents(3));
    store.append("stream-b", makeEvents(2));

    expect(store.streamVersion("stream-a")).toBe(3);
    expect(store.streamVersion("stream-b")).toBe(2);
  });

  it("reads forward from specific version", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("stream-1", makeEvents(5));

    const events = store.read("stream-1", { fromVersion: 3 });
    expect(events).toHaveLength(3);
    expect(events[0]!.version).toBe(3);
  });

  it("reads backward", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("stream-1", makeEvents(5));

    const events = store.read("stream-1", {
      fromVersion: 4,
      direction: "backward",
    });

    expect(events).toHaveLength(4);
    expect(events[0]!.version).toBe(4);
    expect(events[3]!.version).toBe(1);
  });

  it("reads with maxCount", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("stream-1", makeEvents(10));

    const events = store.read("stream-1", { maxCount: 3 });
    expect(events).toHaveLength(3);
  });

  it("readAll returns events in global order", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("stream-a", [makeEvent("a1")]);
    store.append("stream-b", [makeEvent("b1")]);
    store.append("stream-a", [makeEvent("a2")]);

    const all = store.readAll();
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.streamId)).toEqual(["stream-a", "stream-b", "stream-a"]);
  });

  it("returns empty array for non-existent stream", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    expect(store.read("nope")).toEqual([]);
  });
});

// =============================================================================
// Concurrency Control
// =============================================================================

describe("concurrency control", () => {
  it("succeeds with correct expectedVersion", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("stream-1", makeEvents(3));

    const result = store.append("stream-1", [makeEvent("next")], {
      expectedVersion: 3,
    });

    expect(result.fromVersion).toBe(4);
  });

  it("fails with wrong expectedVersion", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("stream-1", makeEvents(3));

    expect(() =>
      store.append("stream-1", [makeEvent("next")], { expectedVersion: 2 }),
    ).toThrow("at version 3, expected 2");
  });

  it("succeeds with no_stream on new stream", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });

    const result = store.append("new-stream", [makeEvent("first")], {
      expectedVersion: "no_stream",
    });

    expect(result.fromVersion).toBe(1);
  });

  it("fails with no_stream on existing stream", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("existing", [makeEvent("first")]);

    expect(() =>
      store.append("existing", [makeEvent("second")], { expectedVersion: "no_stream" }),
    ).toThrow("already exists");
  });

  it("succeeds with 'any'", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    store.append("stream-1", makeEvents(5));

    const result = store.append("stream-1", [makeEvent("any")], {
      expectedVersion: "any",
    });

    expect(result.fromVersion).toBe(6);
  });
});

// =============================================================================
// Subscriptions
// =============================================================================

describe("subscriptions", () => {
  it("stream subscription receives events", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    const received: string[] = [];

    store.subscribe("stream-1", (event) => received.push(event.event.type));

    store.append("stream-1", [makeEvent("first")]);
    store.append("stream-1", [makeEvent("second")]);

    expect(received).toEqual(["first", "second"]);
  });

  it("global subscription receives events from all streams", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    const received: string[] = [];

    store.subscribeAll((event) => received.push(`${event.streamId}:${event.event.type}`));

    store.append("a", [makeEvent("x")]);
    store.append("b", [makeEvent("y")]);

    expect(received).toEqual(["a:x", "b:y"]);
  });

  it("unsubscribe stops receiving events", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });
    const received: string[] = [];

    const sub = store.subscribe("stream-1", (event) => received.push(event.event.type));

    store.append("stream-1", [makeEvent("before")]);
    sub.unsubscribe();
    store.append("stream-1", [makeEvent("after")]);

    expect(received).toEqual(["before"]);
  });
});

// =============================================================================
// Error Handling
// =============================================================================

describe("errors", () => {
  it("rejects empty stream ID", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });

    expect(() => store.append("", [makeEvent("test")])).toThrow("non-empty string");
  });

  it("rejects empty events array", () => {
    const store = new JsonlEventStore({ filePath: freshPath() });

    expect(() => store.append("stream-1", [])).toThrow("Cannot append zero events");
  });

  it("exposes file path", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });

    expect(store.filePath).toBe(path);
  });
});

// =============================================================================
// File Locking (C1 — concurrent append protection)
// =============================================================================

describe("file locking", () => {
  it("concurrent appends produce unique global positions and valid hash chain", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });

    // Fire multiple synchronous appends rapidly — since append() is synchronous
    // and locked, they should serialize correctly
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(store.append(`stream-${i % 3}`, [makeEvent(`concurrent.${i}`)]));
    }

    // All global positions should be unique
    const all = store.readAll();
    const positions = all.map((e) => e.globalPosition);
    expect(new Set(positions).size).toBe(10);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Hash chain should verify
    const integrity = store.verifyIntegrity();
    expect(integrity.valid).toBe(true);
  });

  it("lockfile is cleaned up after successful append", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });

    store.append("stream-1", [makeEvent("test")]);

    // The .lock file should not exist after append completes
    expect(existsSync(path + ".lock")).toBe(false);
  });

  it("lockfile is cleaned up after failed append", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });
    store.append("stream-1", [makeEvent("first")]);

    // Force a concurrency conflict — lock should still be released
    try {
      store.append("stream-1", [makeEvent("conflict")], { expectedVersion: 999 });
    } catch {
      // Expected
    }

    expect(existsSync(path + ".lock")).toBe(false);
  });

  it("second store instance serializes appends via lockfile", () => {
    const path = freshPath();

    const store1 = new JsonlEventStore({ filePath: path });
    store1.append("stream-1", [makeEvent("from-store1")]);

    const store2 = new JsonlEventStore({ filePath: path });
    store2.append("stream-1", [makeEvent("from-store2")]);

    // Both appends should be in the file
    const content = readFileSync(path, "utf-8").trim().split("\n");
    expect(content).toHaveLength(2);

    // Reload and verify positions are unique
    const store3 = new JsonlEventStore({ filePath: path });
    const all = store3.readAll();
    const positions = all.map((e) => e.globalPosition);
    expect(new Set(positions).size).toBe(2);
  });
});

// =============================================================================
// Verify-on-load — fail closed against tampered files (D2-A-003)
// =============================================================================

describe("verify on load", () => {
  /**
   * Write a valid store, then corrupt the payload of the SECOND line in place
   * (preserving line count and JSON validity, so the corrupt-line skipper does
   * not silently drop it). The hash chain must catch this on load.
   */
  function tamperSecondLine(path: string): void {
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    const rec = JSON.parse(lines[1]!) as {
      event: { payload: Record<string, unknown> };
    };
    rec.event.payload = { ...rec.event.payload, tampered: true };
    lines[1] = JSON.stringify(rec);
    writeFileSync(path, lines.join("\n") + "\n", "utf-8");
  }

  it("throws EventStoreError when loading a tampered file (default)", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);

    tamperSecondLine(path);

    // Default verifyOnLoad: true — construction must fail closed.
    let thrown: unknown;
    try {
      new JsonlEventStore({ filePath: path });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EventStoreError);
    expect((thrown as EventStoreError).code).toBe("INTEGRITY_VIOLATION");
  });

  it("loads a tampered file when verifyOnLoad is explicitly false", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });
    store.append("s", [makeEvent("a"), makeEvent("b")]);

    tamperSecondLine(path);

    // Opt out — load succeeds, but integrity reports invalid.
    const reloaded = new JsonlEventStore({ filePath: path, verifyOnLoad: false });
    expect(reloaded.readAll()).toHaveLength(2);
    expect(reloaded.verifyIntegrity().valid).toBe(false);
  });

  it("loads a clean file when verifyOnLoad is on", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);

    // Untampered — default verifyOnLoad must succeed.
    const reloaded = new JsonlEventStore({ filePath: path });
    expect(reloaded.readAll()).toHaveLength(3);
    expect(reloaded.verifyIntegrity().valid).toBe(true);
  });

  it("detects head truncation on load (fail closed)", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);

    // Drop the first (genesis) line — head truncation.
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    writeFileSync(path, lines.slice(1).join("\n") + "\n", "utf-8");

    expect(() => new JsonlEventStore({ filePath: path })).toThrow(EventStoreError);
  });

  it("does not leak the absolute file path in the thrown message (V2-004)", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });
    store.append("s", [makeEvent("a"), makeEvent("b"), makeEvent("c")]);

    tamperSecondLine(path);

    let thrown: unknown;
    try {
      new JsonlEventStore({ filePath: path });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(EventStoreError);
    const err = thrown as EventStoreError;
    expect(err.code).toBe("INTEGRITY_VIOLATION");

    // The absolute server-side path must NOT appear in the client-facing message.
    expect(err.message).not.toContain(path);
    expect(err.message).not.toContain(testDir);

    // The integrity signal is preserved: basename + violation reason + position.
    const base = path.split(/[\\/]/).pop()!;
    expect(base).toMatch(/\.jsonl$/); // sanity: we derived a real basename
    expect(err.message).toContain(base);
    expect(err.message).toMatch(/First violation at position \d+:/);
    // The tampered second line yields a hash-mismatch reason — confirm the
    // human-readable reason rides along in the message.
    expect(err.message).toMatch(/[Hh]ash mismatch at position 2/);

    // The full absolute path is still available to operators on a
    // non-enumerable field (so it is not serialized to clients).
    expect((err as unknown as { filePath?: string }).filePath).toBe(path);
    expect(Object.keys(err)).not.toContain("filePath");
    expect(JSON.stringify(err)).not.toContain(path);
  });
});

// =============================================================================
// Write failure recovery (D2-A-002)
// =============================================================================

describe("write failure recovery", () => {
  /**
   * Replace _writeAndSync with a spy that throws the first time it is called
   * (simulating ENOSPC/EIO) and then delegates to the real implementation.
   * Returns a restore function.
   */
  function failFirstWrite(store: JsonlEventStore): () => void {
    const internal = store as unknown as {
      _writeAndSync: (data: string) => void;
    };
    const real = internal._writeAndSync.bind(store);
    let failed = false;
    internal._writeAndSync = (data: string): void => {
      if (!failed) {
        failed = true;
        const err = new Error("simulated disk failure") as NodeJS.ErrnoException;
        err.code = "ENOSPC";
        throw err;
      }
      real(data);
    };
    return () => {
      internal._writeAndSync = real;
    };
  }

  it("a failed write does not desync in-memory state from disk", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });

    store.append("stream-1", [makeEvent("ok-1")]);
    expect(store.globalPosition()).toBe(1);

    // Next append's write fails.
    const restore = failFirstWrite(store);
    expect(() => store.append("stream-1", [makeEvent("doomed")])).toThrow();
    restore();

    // The failed append must NOT have advanced the global position or the
    // chain head: nothing reached disk, so in-memory state must roll back.
    expect(store.globalPosition()).toBe(1);

    // The next successful append must be contiguous (position 2, not 3) and
    // chain-valid against the survivor at position 1.
    store.append("stream-1", [makeEvent("ok-2")]);
    expect(store.globalPosition()).toBe(2);

    const all = store.readAll();
    expect(all.map((e) => e.globalPosition)).toEqual([1, 2]);
    expect(store.verifyIntegrity().valid).toBe(true);
  });

  it("survives a failed multi-event append without gaps", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });

    store.append("s", [makeEvent("a"), makeEvent("b")]); // positions 1,2

    const restore = failFirstWrite(store);
    expect(() =>
      store.append("s", [makeEvent("c"), makeEvent("d"), makeEvent("e")]),
    ).toThrow();
    restore();

    expect(store.globalPosition()).toBe(2);

    store.append("s", [makeEvent("c2"), makeEvent("d2")]); // positions 3,4
    expect(store.readAll().map((e) => e.globalPosition)).toEqual([1, 2, 3, 4]);
    expect(store.verifyIntegrity().valid).toBe(true);

    // And the on-disk file must match: a fresh load reproduces the same chain.
    const reloaded = new JsonlEventStore({ filePath: path });
    expect(reloaded.readAll().map((e) => e.globalPosition)).toEqual([1, 2, 3, 4]);
    expect(reloaded.verifyIntegrity().valid).toBe(true);
  });

  it("stream version does not advance on a failed append", () => {
    const path = freshPath();
    const store = new JsonlEventStore({ filePath: path });

    store.append("s", [makeEvent("a")]);
    expect(store.streamVersion("s")).toBe(1);

    const restore = failFirstWrite(store);
    expect(() => store.append("s", [makeEvent("doomed")])).toThrow();
    restore();

    expect(store.streamVersion("s")).toBe(1);

    // A retry must be accepted at the correct expected version (1), proving the
    // in-memory stream array was not left with a phantom entry.
    store.append("s", [makeEvent("b")], { expectedVersion: 1 });
    expect(store.streamVersion("s")).toBe(2);
    expect(store.verifyIntegrity().valid).toBe(true);
  });
});
