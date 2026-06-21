/**
 * Stage-C hardening tests for the snapshot stores (B-LES-004 / 005 / 006 / 009).
 *
 * - B-LES-004: FileSnapshotStore.save is atomic (temp + fsync + rename); no
 *   .tmp file is left behind on success.
 * - B-LES-005: load() fails closed on a tampered (stateHash-mismatch) snapshot
 *   by default, and verifyOnLoad:false opts out for recovery.
 * - B-LES-006: prune(keep) and maxSnapshotsPerStream bound snapshot count.
 * - B-LES-009: save / load / corrupt-read emit telemetry on both stores.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import {
  FileSnapshotStore,
  InMemorySnapshotStore,
} from "../src/snapshot-store.js";

class CapturingTelemetry implements Telemetry {
  readonly events: ObservabilityEvent[] = [];
  record(event: ObservabilityEvent): void {
    this.events.push(event);
  }
  byOp(op: string): ObservabilityEvent[] {
    return this.events.filter((e) => e.op === op);
  }
}

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `attestia-snap-hardening-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

/** Reach the on-disk snapshot path the store uses for a given stream/version. */
function snapshotDir(baseDir: string, streamId: string): string {
  const safe = createHash("sha256").update(streamId).digest("hex").slice(0, 32);
  return join(baseDir, safe);
}

// ─── B-LES-004: atomic save ──────────────────────────────────────────────────

describe("atomic save (B-LES-004)", () => {
  it("leaves no .tmp file after a successful save", () => {
    const dir = join(testDir, "atomic");
    const store = new FileSnapshotStore(dir);
    store.save({ streamId: "s1", version: 1, state: { a: 1 } });

    const files = readdirSync(snapshotDir(dir, "s1"));
    expect(files).toContain("1.json");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("save then load round-trips correctly", () => {
    const dir = join(testDir, "roundtrip");
    const store = new FileSnapshotStore(dir);
    store.save({ streamId: "s1", version: 7, state: { x: "y" } });
    expect(store.load("s1")!.state).toEqual({ x: "y" });
  });
});

// ─── B-LES-005: integrity verify on load ─────────────────────────────────────

describe("integrity verify on load (B-LES-005)", () => {
  it("FileSnapshotStore rejects a tampered snapshot by default", () => {
    const dir = join(testDir, "tamper-file");
    const store = new FileSnapshotStore(dir);
    store.save({ streamId: "s1", version: 1, state: { balance: 100 } });

    // Tamper with the state while leaving stateHash intact.
    const fp = join(snapshotDir(dir, "s1"), "1.json");
    const parsed = JSON.parse(readFileSync(fp, "utf-8")) as Record<string, unknown>;
    parsed.state = { balance: 999999 };
    writeFileSync(fp, JSON.stringify(parsed, null, 2), "utf-8");

    const telemetry = new CapturingTelemetry();
    const guarded = new FileSnapshotStore(dir, { telemetry });
    expect(guarded.load("s1")).toBeUndefined(); // fail closed
    const warn = telemetry.byOp("snapshot.load").find((e) => e.level === "warn");
    expect(warn?.attributes?.code).toBe("SNAPSHOT_INTEGRITY_FAILED");
  });

  it("FileSnapshotStore returns the tampered snapshot when verifyOnLoad:false", () => {
    const dir = join(testDir, "tamper-file-opt-out");
    const store = new FileSnapshotStore(dir);
    store.save({ streamId: "s1", version: 1, state: { balance: 100 } });

    const fp = join(snapshotDir(dir, "s1"), "1.json");
    const parsed = JSON.parse(readFileSync(fp, "utf-8")) as Record<string, unknown>;
    parsed.state = { balance: 999999 };
    writeFileSync(fp, JSON.stringify(parsed, null, 2), "utf-8");

    const recovery = new FileSnapshotStore(dir, { verifyOnLoad: false });
    expect(recovery.load("s1")!.state).toEqual({ balance: 999999 });
  });

  it("InMemorySnapshotStore rejects a tampered snapshot by default", () => {
    const telemetry = new CapturingTelemetry();
    const store = new InMemorySnapshotStore({ telemetry });
    store.save({ streamId: "s1", version: 1, state: { v: 1 } });

    // Mutate the stored snapshot's state in place (simulate tamper).
    const loaded = store.load("s1")!;
    (loaded.state as { v: number }).v = 99;

    expect(store.load("s1")).toBeUndefined();
    const warn = telemetry.byOp("snapshot.load").find((e) => e.level === "warn");
    expect(warn?.attributes?.code).toBe("SNAPSHOT_INTEGRITY_FAILED");
  });

  it("emits a warn on a corrupt (unparseable) snapshot file (B-LES-009)", () => {
    const dir = join(testDir, "corrupt-read");
    const store = new FileSnapshotStore(dir);
    store.save({ streamId: "s1", version: 1, state: { a: 1 } });

    // Corrupt the file on disk.
    const fp = join(snapshotDir(dir, "s1"), "1.json");
    writeFileSync(fp, "{ this is not json", "utf-8");

    const telemetry = new CapturingTelemetry();
    const guarded = new FileSnapshotStore(dir, { telemetry });
    expect(guarded.load("s1")).toBeUndefined();
    const warn = telemetry.byOp("snapshot.load").find((e) => e.level === "warn");
    expect(warn?.attributes?.code).toBe("SNAPSHOT_PARSE_FAILED");
  });
});

// ─── B-LES-006: prune / retention ────────────────────────────────────────────

describe("prune (B-LES-006)", () => {
  it("FileSnapshotStore.prune keeps the N highest versions", () => {
    const dir = join(testDir, "prune-file");
    const store = new FileSnapshotStore(dir);
    for (const v of [1, 2, 3, 4, 5]) {
      store.save({ streamId: "s1", version: v, state: { v } });
    }
    const result = store.prune("s1", { keep: 2 });
    expect(result.deleted).toBe(3);
    expect(result.kept).toBe(2);

    const remaining = readdirSync(snapshotDir(dir, "s1"))
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(remaining).toEqual(["4.json", "5.json"]);
    expect(store.load("s1")!.version).toBe(5);
  });

  it("maxSnapshotsPerStream auto-prunes on save", () => {
    const dir = join(testDir, "auto-prune");
    const store = new FileSnapshotStore(dir, { maxSnapshotsPerStream: 2 });
    for (const v of [1, 2, 3, 4]) {
      store.save({ streamId: "s1", version: v, state: { v } });
    }
    const remaining = readdirSync(snapshotDir(dir, "s1")).filter((f) =>
      f.endsWith(".json"),
    );
    expect(remaining).toHaveLength(2);
  });

  it("InMemorySnapshotStore.prune keeps the N highest versions", () => {
    const store = new InMemorySnapshotStore();
    for (const v of [1, 2, 3]) {
      store.save({ streamId: "s1", version: v, state: { v } });
    }
    const result = store.prune("s1", { keep: 1 });
    expect(result.deleted).toBe(2);
    expect(store.load("s1")!.version).toBe(3);
    expect(store.loadAtVersion("s1", 1)).toBeUndefined();
  });

  it("prune is a no-op when count <= keep", () => {
    const store = new InMemorySnapshotStore();
    store.save({ streamId: "s1", version: 1, state: { v: 1 } });
    expect(store.prune("s1", { keep: 5 })).toEqual({ deleted: 0, kept: 1 });
  });

  it("prune rejects keep < 1", () => {
    const store = new InMemorySnapshotStore();
    expect(() => store.prune("s1", { keep: 0 })).toThrow(TypeError);
  });
});

// ─── B-LES-009: save/load telemetry ──────────────────────────────────────────

describe("snapshot telemetry (B-LES-009)", () => {
  it("emits save and load events on FileSnapshotStore", () => {
    const telemetry = new CapturingTelemetry();
    const store = new FileSnapshotStore(join(testDir, "tele-file"), { telemetry });
    store.save({ streamId: "s1", version: 1, state: { a: 1 } });
    store.load("s1");

    const saves = telemetry.byOp("snapshot.save");
    expect(saves).toHaveLength(1);
    expect(saves[0]!.attributes?.version).toBe(1);
    expect(typeof saves[0]!.attributes?.bytes).toBe("number");

    const loads = telemetry.byOp("snapshot.load");
    expect(loads.some((e) => e.attributes?.hit === true)).toBe(true);
  });

  it("emits a load miss for an absent stream", () => {
    const telemetry = new CapturingTelemetry();
    const store = new FileSnapshotStore(join(testDir, "tele-miss"), { telemetry });
    expect(store.load("nope")).toBeUndefined();
    const loads = telemetry.byOp("snapshot.load");
    expect(loads.some((e) => e.attributes?.hit === false)).toBe(true);
  });
});
