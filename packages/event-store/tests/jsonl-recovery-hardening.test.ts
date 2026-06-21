/**
 * Stage-C hardening tests for JsonlEventStore (B-LES-001 / 002 / 007 / 008).
 *
 * - B-LES-001: a stale lockfile held by a provably-dead PID is broken
 *   automatically so appends recover instead of deadlocking forever; a lockfile
 *   held by a LIVE PID is respected (fail-closed) and the timeout message
 *   carries the holder PID + path + recovery instruction.
 * - B-LES-002: skipped (corrupt) lines on load are captured in loadDiagnostics
 *   with line index + reason and surfaced as a "warn"/"degraded" telemetry event
 *   carrying a stable LOAD_LINES_SKIPPED code.
 * - B-LES-007: a file larger than maxLoadBytes fails closed with a structured
 *   LOG_TOO_LARGE error rather than an opaque OOM.
 * - B-LES-008: a record with a non-string appendedAt is counted as a skipped
 *   malformed line, not surfaced later as a hash mismatch.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
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
}

const event1: DomainEvent = { type: "test.created", metadata: {}, payload: { n: 1 } };
const event2: DomainEvent = { type: "test.updated", metadata: {}, payload: { n: 2 } };

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `attestia-recovery-hardening-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

// ─── B-LES-001: stale-lock recovery ──────────────────────────────────────────

describe("stale-lock recovery (B-LES-001)", () => {
  /** A PID that is essentially guaranteed not to exist on the test host. */
  const DEAD_PID = 2_147_480_000;

  it("breaks a stale lock held by a dead PID and the append succeeds", () => {
    const fp = join(testDir, "stale.jsonl");
    const telemetry = new CapturingTelemetry();
    const store = new JsonlEventStore({ filePath: fp, telemetry });

    // Simulate a crashed writer: leave a lockfile naming a dead PID.
    writeFileSync(fp + ".lock", String(DEAD_PID), "utf-8");
    expect(existsSync(fp + ".lock")).toBe(true);

    // Append must succeed by breaking the stale lock (not time out).
    expect(() => store.append("s1", [event1])).not.toThrow();
    expect(store.readAll()).toHaveLength(1);

    // A break_stale telemetry event was emitted naming the dead PID.
    const breaks = telemetry.byOp("lock.break_stale");
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.attributes?.stalePid).toBe(DEAD_PID);
    expect(breaks[0]!.level).toBe("warn");
  });

  it("respects a lock held by a LIVE PID and fails closed with a recovery hint", () => {
    const fp = join(testDir, "live.jsonl");
    const telemetry = new CapturingTelemetry();
    const store = new JsonlEventStore({ filePath: fp, telemetry });

    // Lockfile names the current (live) process — must NOT be broken.
    writeFileSync(fp + ".lock", String(process.pid), "utf-8");

    let thrown: unknown;
    try {
      store.append("s1", [event1]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EventStoreError);
    expect((thrown as EventStoreError).code).toBe("LOCK_TIMEOUT");
    // Operability: message names the holder PID, the lockfile path, and how to recover.
    const msg = (thrown as Error).message;
    expect(msg).toContain(String(process.pid));
    expect(msg).toContain(fp + ".lock");
    expect(msg.toLowerCase()).toContain("delete");

    // We must NOT have broken the live lock.
    expect(telemetry.byOp("lock.break_stale")).toHaveLength(0);
    const timeout = telemetry.byOp("lock.acquire").filter((e) => e.outcome === "failed");
    expect(timeout).toHaveLength(1);
    expect(timeout[0]!.attributes?.holderPid).toBe(process.pid);
  }, 10_000);

  it("fails closed with a recovery hint when the lock PID is unreadable", () => {
    const fp = join(testDir, "garbage-pid.jsonl");
    const store = new JsonlEventStore({ filePath: fp });

    // Non-numeric PID — we cannot prove the holder is dead, so do not break it.
    writeFileSync(fp + ".lock", "not-a-pid", "utf-8");

    let thrown: unknown;
    try {
      store.append("s1", [event1]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EventStoreError);
    expect((thrown as EventStoreError).code).toBe("LOCK_TIMEOUT");
    expect((thrown as Error).message).toContain(fp + ".lock");
  }, 10_000);
});

// ─── B-LES-002 / B-LES-008: load diagnostics ─────────────────────────────────

describe("load diagnostics (B-LES-002, B-LES-008)", () => {
  it("captures per-line skip reasons in loadDiagnostics", () => {
    const fp = join(testDir, "diag.jsonl");
    const seed = new JsonlEventStore({ filePath: fp });
    seed.append("s1", [event1, event2]); // two valid lines

    // Append a corrupt (unparseable) line.
    writeFileSync(fp, "NOT JSON\n", { flag: "a" });

    const telemetry = new CapturingTelemetry();
    const store = new JsonlEventStore({ filePath: fp, telemetry });

    const diag = store.loadDiagnostics;
    expect(diag.eventsLoaded).toBe(2);
    expect(diag.skippedLines).toBe(1);
    expect(diag.skips).toHaveLength(1);
    expect(diag.skips[0]!.reason).toBe("parse_error");
    expect(diag.skips[0]!.lineIndex).toBe(3); // 1-based, after the two valid lines

    // Load telemetry escalated to warn/degraded with a stable code.
    const loadEvents = telemetry.byOp("load");
    expect(loadEvents).toHaveLength(1);
    expect(loadEvents[0]!.level).toBe("warn");
    expect(loadEvents[0]!.outcome).toBe("degraded");
    expect(loadEvents[0]!.attributes?.code).toBe("LOAD_LINES_SKIPPED");
  });

  it("clean load yields empty skips and an info-level event", () => {
    const fp = join(testDir, "clean.jsonl");
    const seed = new JsonlEventStore({ filePath: fp });
    seed.append("s1", [event1]);

    const telemetry = new CapturingTelemetry();
    const store = new JsonlEventStore({ filePath: fp, telemetry });
    expect(store.loadDiagnostics.skippedLines).toBe(0);
    expect(store.loadDiagnostics.skips).toHaveLength(0);
    expect(telemetry.byOp("load")[0]!.level).toBe("info");
  });

  it("treats a non-string appendedAt as a missing_field skip (B-LES-008)", () => {
    const fp = join(testDir, "bad-appendedAt.jsonl");
    // Hand-write a record whose appendedAt is a number, not a string.
    const record = {
      event: { type: "x", metadata: {}, payload: {} },
      streamId: "s1",
      version: 1,
      globalPosition: 1,
      appendedAt: 12345, // wrong type
      hash: "deadbeef",
      previousHash: "genesis",
    };
    writeFileSync(fp, JSON.stringify(record) + "\n", "utf-8");

    // verifyOnLoad:false so the (now empty) chain does not throw for unrelated reasons.
    const store = new JsonlEventStore({ filePath: fp, verifyOnLoad: false });
    const diag = store.loadDiagnostics;
    expect(diag.eventsLoaded).toBe(0);
    expect(diag.skippedLines).toBe(1);
    expect(diag.skips[0]!.reason).toBe("missing_field");
  });
});

// ─── B-LES-007: load size guard ──────────────────────────────────────────────

describe("load size guard (B-LES-007)", () => {
  it("fails closed with LOG_TOO_LARGE when the file exceeds maxLoadBytes", () => {
    const fp = join(testDir, "big.jsonl");
    const seed = new JsonlEventStore({ filePath: fp });
    seed.append("s1", [event1, event2]);
    const size = readFileSync(fp, "utf-8").length;

    let thrown: unknown;
    try {
      // eslint-disable-next-line no-new
      new JsonlEventStore({ filePath: fp, maxLoadBytes: Math.max(1, size - 1) });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EventStoreError);
    expect((thrown as EventStoreError).code).toBe("LOG_TOO_LARGE");
    expect((thrown as Error).message.toLowerCase()).toContain("maxloadbytes");
  });

  it("loads normally when under the limit", () => {
    const fp = join(testDir, "small.jsonl");
    const seed = new JsonlEventStore({ filePath: fp });
    seed.append("s1", [event1]);

    expect(
      () => new JsonlEventStore({ filePath: fp, maxLoadBytes: 10_000_000 }),
    ).not.toThrow();
  });

  it("imposes no limit by default", () => {
    const fp = join(testDir, "nolimit.jsonl");
    const seed = new JsonlEventStore({ filePath: fp });
    seed.append("s1", [event1]);
    expect(() => new JsonlEventStore({ filePath: fp })).not.toThrow();
  });
});
