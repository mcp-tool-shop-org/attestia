/**
 * Tests for the optional observability sink on the event stores (D2-B-001).
 *
 * Verifies, via a capturing Telemetry:
 * - JsonlEventStore emits "load" (with eventsLoaded / skippedLines),
 *   "verify" (ok), "append" (count / globalPosition), and "lock.acquire" (ok).
 * - A tampered file surfaces a "verify" failed event before the store throws.
 * - A held lockfile surfaces a "lock.acquire" failed (LOCK_TIMEOUT) event.
 * - InMemoryEventStore emits "append" and "verify" events.
 * - The default (no sink) is silent and a throwing sink never breaks behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DomainEvent, ObservabilityEvent, Telemetry } from "@attestia/types";
import { JsonlEventStore } from "../src/jsonl-store.js";
import { InMemoryEventStore } from "../src/in-memory-store.js";
import { EventStoreError } from "../src/types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

class CapturingTelemetry implements Telemetry {
  readonly events: ObservabilityEvent[] = [];
  record(event: ObservabilityEvent): void {
    this.events.push(event);
  }
  byOp(op: string): ObservabilityEvent[] {
    return this.events.filter((e) => e.op === op);
  }
  reset(): void {
    this.events.length = 0;
  }
}

function makeEvent(type: string): DomainEvent {
  return {
    type,
    metadata: {
      eventId: `evt-${type}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      actor: "test",
      correlationId: `corr-${Math.random().toString(36).slice(2, 8)}`,
      source: "vault",
    },
    payload: { type },
  };
}

let testDir: string;
let testFile: string;
let telemetry: CapturingTelemetry;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `attestia-telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(testDir, { recursive: true });
  testFile = join(testDir, "events.jsonl");
  telemetry = new CapturingTelemetry();
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── JsonlEventStore ─────────────────────────────────────────────────────────

describe("JsonlEventStore telemetry (D2-B-001)", () => {
  it("emits a load event on construction over an empty/new file", () => {
    new JsonlEventStore({ filePath: testFile, telemetry });

    const loads = telemetry.byOp("load");
    expect(loads).toHaveLength(1);
    const ev = loads[0]!;
    expect(ev.package).toBe("@attestia/event-store");
    expect(ev.outcome).toBe("ok");
    expect(ev.attributes?.eventsLoaded).toBe(0);
    expect(ev.attributes?.skippedLines).toBe(0);
    expect(typeof ev.durationMs).toBe("number");
  });

  it("emits a verify ok event on construction", () => {
    new JsonlEventStore({ filePath: testFile, telemetry });

    const verifies = telemetry.byOp("verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.outcome).toBe("ok");
    expect(verifies[0]!.attributes?.valid).toBe(true);
    expect(verifies[0]!.attributes?.errorCount).toBe(0);
  });

  it("emits append events with count and globalPosition", () => {
    const store = new JsonlEventStore({ filePath: testFile, telemetry });
    telemetry.reset();

    store.append("stream-a", [makeEvent("a.1"), makeEvent("a.2")]);
    store.append("stream-b", [makeEvent("b.1")]);

    const appends = telemetry.byOp("append");
    expect(appends).toHaveLength(2);
    expect(appends[0]!.attributes?.count).toBe(2);
    expect(appends[0]!.attributes?.globalPosition).toBe(2);
    expect(appends[1]!.attributes?.count).toBe(1);
    expect(appends[1]!.attributes?.globalPosition).toBe(3);
    expect(appends[0]!.outcome).toBe("ok");
  });

  it("emits a lock.acquire ok event on each append", () => {
    const store = new JsonlEventStore({ filePath: testFile, telemetry });
    telemetry.reset();

    store.append("stream-a", [makeEvent("a.1")]);

    const locks = telemetry.byOp("lock.acquire");
    expect(locks).toHaveLength(1);
    expect(locks[0]!.outcome).toBe("ok");
    expect(locks[0]!.attributes?.contended).toBe(false);
    expect(typeof locks[0]!.durationMs).toBe("number");
  });

  it("reflects loaded event count + skipped corrupt lines on reload", () => {
    const store = new JsonlEventStore({ filePath: testFile, telemetry });
    store.append("stream-a", [makeEvent("a.1"), makeEvent("a.2")]);
    // Append a corrupt partial line (simulates a torn write on crash).
    appendFileSync(testFile, "{not valid json\n", "utf-8");

    const reloadTelemetry = new CapturingTelemetry();
    new JsonlEventStore({ filePath: testFile, telemetry: reloadTelemetry });

    const load = reloadTelemetry.byOp("load")[0]!;
    expect(load.attributes?.eventsLoaded).toBe(2);
    expect(load.attributes?.skippedLines).toBe(1);
  });

  it("emits a verify failed event when the file is tampered, before throwing", () => {
    // Build a valid 2-event log, then corrupt the payload of the first record
    // so the hash chain breaks.
    const seed = new JsonlEventStore({ filePath: testFile });
    seed.append("stream-a", [makeEvent("a.1"), makeEvent("a.2")]);

    const lines = readFileSync(testFile, "utf-8").split("\n").filter((l) => l.trim());
    const first = JSON.parse(lines[0]!) as { event: { payload: Record<string, unknown> } };
    first.event.payload = { tampered: true };
    writeFileSync(testFile, [JSON.stringify(first), lines[1]].join("\n") + "\n", "utf-8");

    const tamperTelemetry = new CapturingTelemetry();
    expect(
      () => new JsonlEventStore({ filePath: testFile, telemetry: tamperTelemetry }),
    ).toThrow(EventStoreError);

    const verifies = tamperTelemetry.byOp("verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.outcome).toBe("failed");
    expect(verifies[0]!.attributes?.valid).toBe(false);
    expect((verifies[0]!.attributes?.errorCount as number) > 0).toBe(true);
  });

  it("emits a lock.acquire failed (LOCK_TIMEOUT) event when the lock is held", () => {
    const store = new JsonlEventStore({ filePath: testFile, telemetry });
    telemetry.reset();

    // Pre-create the lockfile so the next append cannot acquire it and times out.
    writeFileSync(testFile + ".lock", "99999", "utf-8");

    expect(() => store.append("stream-a", [makeEvent("a.1")])).toThrow(
      EventStoreError,
    );

    const locks = telemetry.byOp("lock.acquire");
    const failed = locks.find((e) => e.outcome === "failed");
    expect(failed).toBeDefined();
    expect(failed!.level).toBe("error");
    expect(failed!.attributes?.code).toBe("LOCK_TIMEOUT");
    // A failed lock means no append commit, so no append event is emitted.
    expect(telemetry.byOp("append")).toHaveLength(0);
  }, 15_000);

  it("defaults to a silent sink and a throwing sink never breaks behavior", () => {
    // No telemetry option → no throw, normal behavior.
    const silent = new JsonlEventStore({ filePath: testFile });
    const r1 = silent.append("s", [makeEvent("x")]);
    expect(r1.count).toBe(1);

    // Hostile sink → guarded, behavior unaffected.
    const hostile: Telemetry = {
      record() {
        throw new Error("sink exploded");
      },
    };
    const file2 = join(testDir, "events2.jsonl");
    const guarded = new JsonlEventStore({ filePath: file2, telemetry: hostile });
    const r2 = guarded.append("s", [makeEvent("y")]);
    expect(r2.count).toBe(1);
  });
});

// ─── InMemoryEventStore ──────────────────────────────────────────────────────

describe("InMemoryEventStore telemetry (D2-B-001)", () => {
  it("emits append events with count and globalPosition", () => {
    const store = new InMemoryEventStore({ telemetry });

    store.append("stream-a", [makeEvent("a.1"), makeEvent("a.2")]);
    store.append("stream-b", [makeEvent("b.1")]);

    const appends = telemetry.byOp("append");
    expect(appends).toHaveLength(2);
    expect(appends[0]!.package).toBe("@attestia/event-store");
    expect(appends[0]!.attributes?.count).toBe(2);
    expect(appends[0]!.attributes?.globalPosition).toBe(2);
    expect(appends[1]!.attributes?.globalPosition).toBe(3);
  });

  it("emits a verify event on verifyIntegrity", () => {
    const store = new InMemoryEventStore({ telemetry });
    store.append("stream-a", [makeEvent("a.1")]);
    telemetry.reset();

    const result = store.verifyIntegrity();
    expect(result.valid).toBe(true);

    const verifies = telemetry.byOp("verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.outcome).toBe("ok");
    expect(verifies[0]!.attributes?.valid).toBe(true);
  });

  it("defaults to a silent sink and a throwing sink never breaks behavior", () => {
    const silent = new InMemoryEventStore();
    expect(silent.append("s", [makeEvent("x")]).count).toBe(1);

    const hostile: Telemetry = {
      record() {
        throw new Error("boom");
      },
    };
    const guarded = new InMemoryEventStore({ telemetry: hostile });
    expect(guarded.append("s", [makeEvent("y")]).count).toBe(1);
    expect(() => guarded.verifyIntegrity()).not.toThrow();
  });
});
