/**
 * Regression & edge-case tests for resuming after a torn tail (crash recovery).
 *
 * Covers:
 * 1. Exact crash-and-resume sequence: append N events, leave a torn tail with
 *    no trailing newline, reopen, append M more, reopen with verifyOnLoad: true.
 * 2. Torn line in the middle of the file is still refused (tampering, not crash).
 * 3. Clean file (ending in \n) gets no extra newline (byte-identical prefix).
 * 4. Edge cases:
 *    - Telemetry emitted on newline repair (append.repair_newline), once per load.
 *    - File that is only a torn fragment (0 valid events, no newline).
 *    - Empty (0-byte) file gets no leading newline.
 *    - Valid last line missing trailing \n (or ending in bare \r) is repaired.
 *    - Clean CRLF (\r\n) file gets no extra newline.
 *    - Concurrent writer advancing a torn file between load and first append
 *      fails closed with CONCURRENCY_CONFLICT before writing a newline.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DomainEvent, ObservabilityEvent, Telemetry } from "@attestia/types";
import { JsonlEventStore } from "../src/jsonl-store.js";
import { EventStoreError } from "../src/types.js";

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

function makeEvent(type: string, index = 0): DomainEvent {
  return {
    type,
    metadata: {
      eventId: `evt-${type}-${index}`,
      timestamp: "2026-10-24T12:00:00.000Z",
      actor: "test-runner",
      correlationId: `corr-${index}`,
      source: "vault",
    },
    payload: { index, type },
  };
}

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `attestia-torn-tail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe("torn-tail resume recovery", () => {
  it("1. exact sequence: append N, leave torn tail without newline, reopen, append M, reopen with verifyOnLoad: true", () => {
    const fp = join(testDir, "store.jsonl");

    // Step 1: Writer A appends N = 3 events.
    const writerA = new JsonlEventStore({ filePath: fp });
    writerA.append("stream-1", [
      makeEvent("evt.1", 1),
      makeEvent("evt.2", 2),
      makeEvent("evt.3", 3),
    ]);

    // Simulate kill -9 mid-write: append a torn JSON fragment with NO trailing newline.
    appendFileSync(fp, 'TORNLINE{"x":', "utf-8");

    // Step 2: Writer B opens the store with default verifyOnLoad: true.
    const writerB = new JsonlEventStore({ filePath: fp });
    expect(writerB.readAll()).toHaveLength(3);
    expect(writerB.loadDiagnostics.eventsLoaded).toBe(3);
    expect(writerB.loadDiagnostics.skippedLines).toBe(1);
    expect(writerB.loadDiagnostics.skips).toEqual([
      { lineIndex: 4, reason: "parse_error" },
    ]);

    // Step 3: Writer B appends M = 2 more events across two appends.
    writerB.append("stream-1", [makeEvent("evt.4", 4)]);
    writerB.append("stream-1", [makeEvent("evt.5", 5)]);

    // Step 4: Reopen with verifyOnLoad: true.
    const reopened = new JsonlEventStore({ filePath: fp, verifyOnLoad: true });

    // Must open and pass full integrity verification.
    const integrity = reopened.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.lastVerifiedPosition).toBe(5);
    expect(integrity.errors).toEqual([]);

    // All N + M = 5 events are present with contiguous globalPositions and stream versions.
    const all = reopened.readAll();
    expect(all).toHaveLength(5);
    expect(all.map((e) => e.globalPosition)).toEqual([1, 2, 3, 4, 5]);
    expect(all.map((e) => e.version)).toEqual([1, 2, 3, 4, 5]);
    expect(all.map((e) => e.event.type)).toEqual([
      "evt.1",
      "evt.2",
      "evt.3",
      "evt.4",
      "evt.5",
    ]);

    // loadDiagnostics reports exactly the one original torn line at lineIndex 4.
    expect(reopened.loadDiagnostics).toEqual({
      eventsLoaded: 5,
      skippedLines: 1,
      skips: [{ lineIndex: 4, reason: "parse_error" }],
    });
  });

  it("2. refuses a torn line in the middle of the file (tampering, not a crash)", () => {
    const fp = join(testDir, "middle-torn.jsonl");
    const store = new JsonlEventStore({ filePath: fp });
    store.append("stream-1", [
      makeEvent("evt.1", 1),
      makeEvent("evt.2", 2),
      makeEvent("evt.3", 3),
    ]);

    // Replace the 2nd record (in the middle of the chain) with a torn fragment.
    const lines = readFileSync(fp, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    lines[1] = '{"event":{"type":"torn-middle"';
    writeFileSync(fp, lines.join("\n") + "\n", "utf-8");

    // Reopening with verifyOnLoad: true (default) must refuse with INTEGRITY_VIOLATION
    // because skipping line 2 breaks globalPosition contiguity (1 -> 3) and previousHash.
    let thrown: unknown;
    try {
      new JsonlEventStore({ filePath: fp });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EventStoreError);
    expect((thrown as EventStoreError).code).toBe("INTEGRITY_VIOLATION");
    expect((thrown as Error).message).toMatch(/globalPosition is not contiguous/);
  });

  it("3. clean file ending in \\n gets no extra newline (byte-identical prefix)", () => {
    const fp = join(testDir, "clean.jsonl");
    const store1 = new JsonlEventStore({ filePath: fp });
    store1.append("stream-1", [makeEvent("evt.1", 1), makeEvent("evt.2", 2)]);

    const beforeBytes = readFileSync(fp);
    expect(beforeBytes[beforeBytes.length - 1]).toBe(0x0a); // ends with \n

    const telemetry = new CapturingTelemetry();
    const store2 = new JsonlEventStore({ filePath: fp, telemetry });
    store2.append("stream-1", [makeEvent("evt.3", 3)]);

    const afterBytes = readFileSync(fp);
    // Prefix must be byte-for-byte identical to beforeBytes.
    expect(afterBytes.subarray(0, beforeBytes.length).equals(beforeBytes)).toBe(true);

    // The newly appended suffix starts immediately with '{' (no extra leading \n).
    const suffix = afterBytes.subarray(beforeBytes.length).toString("utf-8");
    expect(suffix.startsWith("{")).toBe(true);
    expect(suffix.endsWith("\n")).toBe(true);
    expect(suffix.trim().split("\n")).toHaveLength(1);

    // No newline-repair telemetry was emitted.
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(0);
  });

  it("4a. emits structured telemetry on newline repair once, and not on subsequent appends", () => {
    const fp = join(testDir, "telemetry-repair.jsonl");
    const writerA = new JsonlEventStore({ filePath: fp });
    writerA.append("stream-1", [makeEvent("evt.1", 1)]);
    appendFileSync(fp, '{"partial":', "utf-8");

    const telemetry = new CapturingTelemetry();
    const writerB = new JsonlEventStore({ filePath: fp, telemetry });

    // No repair emitted on load alone (store is read-only until append).
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(0);

    // First append repairs the missing trailing newline and emits telemetry.
    writerB.append("stream-1", [makeEvent("evt.2", 2)]);
    const repairs = telemetry.byOp("append.repair_newline");
    expect(repairs).toHaveLength(1);
    expect(repairs[0]!.package).toBe("@attestia/event-store");
    expect(repairs[0]!.level).toBe("warn");
    expect(repairs[0]!.outcome).toBe("degraded");
    expect(repairs[0]!.attributes?.code).toBe("TORN_TAIL_NEWLINE_REPAIRED");
    expect(repairs[0]!.attributes?.skippedLines).toBe(1);
    expect(repairs[0]!.message).toContain("telemetry-repair.jsonl");

    // Second append on the same instance must NOT emit another repair event.
    writerB.append("stream-1", [makeEvent("evt.3", 3)]);
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(1);
  });

  it("4b. recovers when the file consists solely of a torn fragment (0 valid events, no newline)", () => {
    const fp = join(testDir, "only-fragment.jsonl");
    writeFileSync(fp, '{"event":{"type":"torn.genesis",', "utf-8");

    const telemetry = new CapturingTelemetry();
    const store = new JsonlEventStore({ filePath: fp, telemetry });
    expect(store.readAll()).toHaveLength(0);
    expect(store.loadDiagnostics.eventsLoaded).toBe(0);
    expect(store.loadDiagnostics.skippedLines).toBe(1);

    // Append two events after the lone torn fragment.
    store.append("stream-1", [makeEvent("evt.1", 1)]);
    store.append("stream-1", [makeEvent("evt.2", 2)]);

    // Reopen with verifyOnLoad: true — genesis event on line 2 and event 2 on line 3 must verify.
    const reopened = new JsonlEventStore({ filePath: fp, verifyOnLoad: true });
    expect(reopened.verifyIntegrity().valid).toBe(true);
    expect(reopened.readAll().map((e) => e.globalPosition)).toEqual([1, 2]);
    expect(reopened.loadDiagnostics).toEqual({
      eventsLoaded: 2,
      skippedLines: 1,
      skips: [{ lineIndex: 1, reason: "parse_error" }],
    });
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(1);
  });

  it("4c. empty (0-byte) file gets no leading newline on first append", () => {
    const fp = join(testDir, "empty.jsonl");
    writeFileSync(fp, "", "utf-8");

    const telemetry = new CapturingTelemetry();
    const store = new JsonlEventStore({ filePath: fp, telemetry });
    store.append("stream-1", [makeEvent("evt.1", 1)]);

    const raw = readFileSync(fp, "utf-8");
    expect(raw.startsWith("{")).toBe(true);
    expect(raw.split("\n")).toHaveLength(2); // 1 line + trailing empty string after \n
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(0);
  });

  it("4d. repairs a valid last record whose trailing newline was stripped (or ends with bare \\r)", () => {
    const fp = join(testDir, "unterminated-valid.jsonl");
    const store1 = new JsonlEventStore({ filePath: fp });
    store1.append("stream-1", [makeEvent("evt.1", 1)]);

    // Strip trailing \n and leave a bare \r (not a line terminator for split("\n")).
    const withoutLf = readFileSync(fp, "utf-8").replace(/\n$/, "\r");
    writeFileSync(fp, withoutLf, "utf-8");

    const telemetry = new CapturingTelemetry();
    const store2 = new JsonlEventStore({ filePath: fp, telemetry });
    expect(store2.readAll()).toHaveLength(1);
    expect(store2.loadDiagnostics.skippedLines).toBe(0);

    // Append second event; repair must insert \n so event 1 and event 2 are not fused.
    store2.append("stream-1", [makeEvent("evt.2", 2)]);

    const reopened = new JsonlEventStore({ filePath: fp, verifyOnLoad: true });
    expect(reopened.readAll().map((e) => e.globalPosition)).toEqual([1, 2]);
    expect(reopened.verifyIntegrity().valid).toBe(true);
    expect(reopened.loadDiagnostics.skippedLines).toBe(0);
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(1);
  });

  it("4e. clean CRLF-terminated file (\\r\\n) gets no extra newline", () => {
    const fp = join(testDir, "crlf.jsonl");
    const store1 = new JsonlEventStore({ filePath: fp });
    store1.append("stream-1", [makeEvent("evt.1", 1)]);

    const crlfContent = readFileSync(fp, "utf-8").replace(/\n/g, "\r\n");
    writeFileSync(fp, crlfContent, "utf-8");

    const telemetry = new CapturingTelemetry();
    const store2 = new JsonlEventStore({ filePath: fp, telemetry });
    store2.append("stream-1", [makeEvent("evt.2", 2)]);

    expect(telemetry.byOp("append.repair_newline")).toHaveLength(0);

    const reopened = new JsonlEventStore({ filePath: fp, verifyOnLoad: true });
    expect(reopened.readAll().map((e) => e.globalPosition)).toEqual([1, 2]);
    expect(reopened.verifyIntegrity().valid).toBe(true);
    expect(reopened.loadDiagnostics.skippedLines).toBe(0);
  });

  it("4f. concurrent writer advancing a torn file between load and first append fails closed with CONCURRENCY_CONFLICT before repairing", () => {
    const fp = join(testDir, "concurrent-torn.jsonl");
    const seed = new JsonlEventStore({ filePath: fp });
    seed.append("stream-1", [makeEvent("evt.1", 1)]);
    appendFileSync(fp, 'TORNLINE{"x":', "utf-8");

    // Both writerA and writerB load the same torn-tail state.
    const telemetryA = new CapturingTelemetry();
    const writerA = new JsonlEventStore({ filePath: fp, telemetry: telemetryA });
    const writerB = new JsonlEventStore({ filePath: fp });

    // Writer B appends first — repairs the newline and writes position 2.
    writerB.append("stream-1", [makeEvent("evt.2b", 2)]);
    const bytesAfterB = readFileSync(fp);

    // Writer A now attempts to append from its stale cursor. Under the lock,
    // _detectExternalAdvanceUnderLock must reject BEFORE writing a repair \n.
    let thrown: unknown;
    try {
      writerA.append("stream-1", [makeEvent("evt.2a", 2)]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EventStoreError);
    expect((thrown as EventStoreError).code).toBe("CONCURRENCY_CONFLICT");
    expect(telemetryA.byOp("append.repair_newline")).toHaveLength(0);

    // File on disk is untouched by writerA.
    expect(readFileSync(fp).equals(bytesAfterB)).toBe(true);

    // Reopened store verifies cleanly with writerB's event.
    const reopened = new JsonlEventStore({ filePath: fp, verifyOnLoad: true });
    expect(reopened.verifyIntegrity().valid).toBe(true);
    expect(reopened.readAll().map((e) => e.globalPosition)).toEqual([1, 2]);
  });

  it("4g. if event write fails after newline repair succeeds, retry does not double-repair or false-conflict", () => {
    const fp = join(testDir, "repair-then-enospc.jsonl");
    const seed = new JsonlEventStore({ filePath: fp });
    seed.append("stream-1", [makeEvent("evt.1", 1)]);
    appendFileSync(fp, 'TORNLINE{"x":', "utf-8");

    const telemetry = new CapturingTelemetry();
    const store = new JsonlEventStore({ filePath: fp, telemetry });

    // Let the first _writeAndSync("\n") succeed, then fail the event write once.
    const internal = store as unknown as {
      _writeAndSync: (data: string) => number;
    };
    const realWrite = internal._writeAndSync.bind(store);
    let callCount = 0;
    internal._writeAndSync = (data: string): number => {
      callCount++;
      if (callCount === 2) {
        const err = new Error("simulated ENOSPC on event write") as NodeJS.ErrnoException;
        err.code = "ENOSPC";
        throw err;
      }
      return realWrite(data);
    };

    expect(() => store.append("stream-1", [makeEvent("evt.2-doomed", 2)])).toThrow(
      "simulated ENOSPC on event write",
    );
    internal._writeAndSync = realWrite;

    // Repair happened once; in-memory event state rolled back to position 1.
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(1);
    expect(store.globalPosition()).toBe(1);

    // Retry succeeds without false CONCURRENCY_CONFLICT or duplicate repair.
    store.append("stream-1", [makeEvent("evt.2", 2)]);
    expect(telemetry.byOp("append.repair_newline")).toHaveLength(1);
    expect(store.globalPosition()).toBe(2);

    const reopened = new JsonlEventStore({ filePath: fp, verifyOnLoad: true });
    expect(reopened.verifyIntegrity().valid).toBe(true);
    expect(reopened.readAll().map((e) => e.globalPosition)).toEqual([1, 2]);
    expect(reopened.loadDiagnostics.skippedLines).toBe(1);
  });
});
