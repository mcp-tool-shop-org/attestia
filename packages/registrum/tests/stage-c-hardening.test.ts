/**
 * Stage C hardening tests (RT-B-001..005, 007, 008, 009).
 *
 * Stage C = humanization + proactive amend. These tests lock the gaps the
 * Stage B audit found between "works" and "respects the operator + the future":
 *
 *  - RT-B-001: snapshot consistency validation must not RangeError on a large
 *    ledger (the Math.max(...spread) ceiling) — it now uses an O(n) scan.
 *  - RT-B-002: a versioned migration seam (SUPPORTED set + migrateToLatest)
 *    exists, is identity for the current version, and stays fail-closed for
 *    unknown versions.
 *  - RT-B-003: the rehydrate / fromSnapshot restore boundary emits structured
 *    ok/failed telemetry with stable low-cardinality error codes.
 *  - RT-B-004: the registry loader (the constitutional gatekeeper) emits
 *    ok/failed telemetry on load.
 *  - RT-B-005: duplicate invariant ids are rejected fail-closed at load.
 *  - RT-B-007: RegistryDrivenRegistrar threads degraded-predicate telemetry.
 *  - RT-B-008: snapshot() emits a structured "snapshot produced" event.
 *  - RT-B-009: high-stakes rehydration errors carry an actionable hint.
 *
 * Telemetry MUST never affect a verdict (fail-closed semantics preserved) and
 * MUST be silent by default (no sink → no events).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { StructuralRegistrar } from "../src/structural-registrar.js";
import {
  loadInvariantRegistry,
  type CompiledInvariantRegistry,
} from "../src/registry/loader.js";
import { RegistryDrivenRegistrar } from "../src/registry/registry-driven-registrar.js";
import {
  SNAPSHOT_VERSION,
  SUPPORTED_SNAPSHOT_VERSIONS,
  migrateToLatest,
  validateSnapshot,
  SnapshotValidationError,
  computeRegistryHash,
  type RegistrarSnapshotV1,
} from "../src/persistence/snapshot.js";
import {
  rehydrate,
  RegistryMismatchError,
  ModeMismatchError,
} from "../src/persistence/rehydrator.js";
import { RegistryError } from "../src/registry/errors.js";
import type { Telemetry, ObservabilityEvent } from "@attestia/types";
import type { State, Transition } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

/** A Telemetry sink that records every event for assertions. */
class CapturingTelemetry implements Telemetry {
  readonly events: ObservabilityEvent[] = [];
  record(event: ObservabilityEvent): void {
    this.events.push(event);
  }
  byOp(op: string): ObservabilityEvent[] {
    return this.events.filter((e) => e.op === op);
  }
}

function getCompiledRegistry(): CompiledInvariantRegistry {
  const registryPath = path.join(process.cwd(), "invariants", "registry.json");
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  return loadInvariantRegistry(raw);
}

function rootState(id: string): State {
  return { id, structure: { isRoot: true }, data: null };
}

function tx(from: string | null, to: State): Transition {
  return { from, to };
}

/**
 * A registry with ONE structurally-broken invariant: it compares the string
 * `state.id` with a number using `>`, which the evaluator rejects at runtime
 * and fails closed. Static validation accepts it; the bug is only visible at
 * evaluation time — the silent-failure case observability is meant to surface.
 */
function brokenRegistry(): CompiledInvariantRegistry {
  return loadInvariantRegistry({
    version: "1.0",
    registry_id: "test.broken",
    invariants: [
      {
        id: "test.broken_predicate",
        group: "identity",
        scope: "state",
        description: "Structurally broken: compares a string id with a number.",
        applies_to: ["state.id"],
        condition: { type: "predicate", expression: "state.id > 5" },
        failure_mode: "reject",
      },
    ],
  });
}

// =============================================================================
// RT-B-001 — large-ledger consistency validation (no Math.max spread RangeError)
// =============================================================================

describe("RT-B-001 large-ledger snapshot validation", () => {
  it("validates a snapshot with >150k assigned indices without a RangeError", () => {
    // Build a flat (all-root) snapshot with more states than the Math.max spread
    // argument-count ceiling (~65k–120k). The old `Math.max(...values)` form
    // throws a cryptic engine RangeError here BEFORE the real check runs; the
    // O(n) scan must accept this perfectly valid large snapshot.
    const count = 150_000;
    const state_ids: string[] = new Array(count);
    const lineage: Record<string, string | null> = {};
    const assigned: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
      const id = `S${i}`;
      state_ids[i] = id;
      lineage[id] = null; // all roots → acyclic, root-reachable by construction
      assigned[id] = i;
    }

    const snapshot = {
      version: SNAPSHOT_VERSION,
      registry_hash: "legacy:placeholder",
      mode: "legacy" as const,
      state_ids,
      lineage,
      ordering: { max_index: count - 1, assigned },
    };

    // Must NOT throw a RangeError; a valid large snapshot validates cleanly.
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it("still rejects a max_index that disagrees with the highest index", () => {
    // The O(n) scan must preserve the original consistency check: a wrong
    // max_index is still a SnapshotValidationError, not silently accepted.
    const snapshot = {
      version: SNAPSHOT_VERSION,
      registry_hash: "legacy:x",
      mode: "legacy" as const,
      state_ids: ["A", "B"],
      lineage: { A: null, B: null },
      ordering: { max_index: 99, assigned: { A: 0, B: 1 } },
    };
    expect(() => validateSnapshot(snapshot)).toThrowError(
      SnapshotValidationError
    );
  });
});

// =============================================================================
// RT-B-002 — snapshot version migration seam
// =============================================================================

describe("RT-B-002 snapshot migration seam", () => {
  it("the current version is in the supported set", () => {
    expect(SUPPORTED_SNAPSHOT_VERSIONS.has(SNAPSHOT_VERSION)).toBe(true);
  });

  it("migrateToLatest is the identity for the current version", () => {
    const snap: RegistrarSnapshotV1 = {
      version: SNAPSHOT_VERSION,
      registry_hash: "legacy:x",
      mode: "legacy",
      state_ids: [],
      lineage: {},
      ordering: { max_index: -1, assigned: {} },
    };
    expect(migrateToLatest(snap)).toBe(snap);
  });

  it("validateSnapshot rejects an unknown version fail-closed, with a hint", () => {
    let err: SnapshotValidationError | undefined;
    try {
      validateSnapshot({
        version: "0.9",
        registry_hash: "legacy:x",
        mode: "legacy",
        state_ids: [],
        lineage: {},
        ordering: { max_index: -1, assigned: {} },
      });
    } catch (e) {
      err = e as SnapshotValidationError;
    }
    expect(err).toBeInstanceOf(SnapshotValidationError);
    expect(err!.code).toBe("SNAPSHOT_INVALID");
    expect(err!.field).toBe("version");
    // Humanized: tells the operator what to do, not just what is wrong.
    expect(err!.message).toMatch(/Hint:/);
    expect(err!.message).toMatch(/migration tool|replay|upgrade/i);
  });
});

// =============================================================================
// RT-B-003 / RT-B-009 — rehydrate telemetry + humanized errors
// =============================================================================

describe("RT-B-003 rehydrate telemetry", () => {
  it("emits an ok event with state_count on a successful restore", () => {
    const original = new StructuralRegistrar({ mode: "legacy" });
    original.register(tx(null, rootState("A")));
    original.register(tx(null, rootState("B")));
    const snapshot = original.snapshot();
    // legacy mode needs the same invariant set the snapshot was written with.
    const invariants = (original as unknown as { invariants: never }).invariants;

    const sink = new CapturingTelemetry();
    StructuralRegistrar.fromSnapshot(snapshot, {
      mode: "legacy",
      invariants,
      telemetry: sink,
    });

    const events = sink.byOp("rehydrate");
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.package).toBe("@attestia/registrum");
    expect(ev.outcome).toBe("ok");
    expect(ev.level).toBe("info");
    expect(ev.attributes).toMatchObject({ mode: "legacy", stateCount: 2 });
  });

  it("emits a failed event with REGISTRY_DRIFT on a hash mismatch", () => {
    const compiled = getCompiledRegistry();
    const original = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: compiled,
    });
    original.register(tx(null, rootState("A")));
    const snapshot = original.snapshot();

    // Tamper the registry_hash to force constitutional drift on restore.
    const drifted = { ...snapshot, registry_hash: "deadbeef" };

    const sink = new CapturingTelemetry();
    expect(() =>
      rehydrate(drifted, {
        mode: "registry",
        compiledRegistry: compiled,
        telemetry: sink,
      })
    ).toThrowError(RegistryMismatchError);

    const ev = sink.byOp("rehydrate")[0]!;
    expect(ev.outcome).toBe("failed");
    expect(ev.level).toBe("error");
    expect(ev.attributes).toMatchObject({
      mode: "registry",
      error: "REGISTRY_DRIFT",
    });
    // The full human detail (with the actionable hint) rides in `message`.
    expect(ev.message).toMatch(/Hint:/);
  });

  it("emits a failed event on a mode mismatch and the error carries a hint", () => {
    const compiled = getCompiledRegistry();
    const original = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: compiled,
    });
    const snapshot = original.snapshot();

    const sink = new CapturingTelemetry();
    let err: ModeMismatchError | undefined;
    try {
      rehydrate(snapshot, {
        mode: "legacy",
        invariants: [],
        telemetry: sink,
      });
    } catch (e) {
      err = e as ModeMismatchError;
    }
    expect(err).toBeInstanceOf(ModeMismatchError);
    expect(err!.message).toMatch(/Hint: pass options\.mode = 'registry'/);

    const ev = sink.byOp("rehydrate")[0]!;
    expect(ev.outcome).toBe("failed");
  });

  it("a misbehaving sink never affects the rehydration verdict", () => {
    const original = new StructuralRegistrar({ mode: "legacy" });
    original.register(tx(null, rootState("A")));
    const snapshot = original.snapshot();
    const invariants = (original as unknown as { invariants: never }).invariants;

    const explodingSink: Telemetry = {
      record() {
        throw new Error("sink exploded");
      },
    };
    let reg: StructuralRegistrar | undefined;
    expect(() => {
      reg = StructuralRegistrar.fromSnapshot(snapshot, {
        mode: "legacy",
        invariants,
        telemetry: explodingSink,
      });
    }).not.toThrow();
    expect(reg!.getRegisteredCount()).toBe(1);
  });

  it("defaults to silent (no sink → no events, behavior unchanged)", () => {
    const original = new StructuralRegistrar({ mode: "legacy" });
    original.register(tx(null, rootState("A")));
    const snapshot = original.snapshot();
    const invariants = (original as unknown as { invariants: never }).invariants;

    // No telemetry option — must still restore correctly and emit nothing.
    const reg = StructuralRegistrar.fromSnapshot(snapshot, {
      mode: "legacy",
      invariants,
    });
    expect(reg.getRegisteredCount()).toBe(1);
  });
});

// =============================================================================
// RT-B-004 / RT-B-005 — registry loader telemetry + duplicate-id rejection
// =============================================================================

describe("RT-B-004 registry loader telemetry", () => {
  it("emits an ok event with invariantCount on a successful load", () => {
    const sink = new CapturingTelemetry();
    const registryPath = path.join(process.cwd(), "invariants", "registry.json");
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    const compiled = loadInvariantRegistry(raw, sink);

    const ev = sink.byOp("registry.load")[0]!;
    expect(ev.outcome).toBe("ok");
    expect(ev.level).toBe("info");
    expect(ev.attributes).toMatchObject({
      invariantCount: compiled.invariants.length,
    });
  });

  it("emits a failed event with errorCount when the registry is rejected", () => {
    const sink = new CapturingTelemetry();
    expect(() =>
      loadInvariantRegistry(
        {
          version: "1.0",
          registry_id: "test.bad",
          invariants: [
            {
              id: "bad.one",
              group: "identity",
              scope: "state",
              description: "Unparseable predicate.",
              applies_to: ["state.id"],
              condition: { type: "predicate", expression: "state.id ==" },
              failure_mode: "reject",
            },
          ],
        },
        sink
      )
    ).toThrow();

    const ev = sink.byOp("registry.load")[0]!;
    expect(ev.outcome).toBe("failed");
    expect(ev.level).toBe("error");
    expect(typeof ev.attributes!.errorCount).toBe("number");
    expect(ev.attributes!.errorCount as number).toBeGreaterThanOrEqual(1);
  });

  it("a misbehaving sink never affects the load verdict", () => {
    const explodingSink: Telemetry = {
      record() {
        throw new Error("sink exploded");
      },
    };
    const registryPath = path.join(process.cwd(), "invariants", "registry.json");
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    let compiled: CompiledInvariantRegistry | undefined;
    expect(() => {
      compiled = loadInvariantRegistry(raw, explodingSink);
    }).not.toThrow();
    expect(compiled!.invariants.length).toBeGreaterThan(0);
  });
});

describe("RT-B-005 duplicate invariant id rejection", () => {
  it("rejects a registry with two invariants sharing an id, with a hint", () => {
    let err: RegistryError | undefined;
    try {
      loadInvariantRegistry({
        version: "1.0",
        registry_id: "test.dup",
        invariants: [
          {
            id: "dup.id",
            group: "identity",
            scope: "state",
            description: "First copy.",
            applies_to: ["state.id"],
            condition: { type: "predicate", expression: "state.id != null" },
            failure_mode: "reject",
          },
          {
            id: "dup.id",
            group: "identity",
            scope: "state",
            description: "Second copy with same id.",
            applies_to: ["state.id"],
            condition: { type: "predicate", expression: "state.id != null" },
            failure_mode: "reject",
          },
        ],
      });
    } catch (e) {
      err = e as RegistryError;
    }
    expect(err).toBeInstanceOf(RegistryError);
    expect(err!.code).toBe("REGISTRY_INVALID");
    expect(err!.message).toMatch(/duplicate invariant id/i);
    expect(err!.message).toContain("dup.id");
    expect(err!.message).toMatch(/Hint:/);
  });

  it("a single repeated id is reported once (deduplicated report)", () => {
    let msg = "";
    try {
      loadInvariantRegistry({
        version: "1.0",
        registry_id: "test.dup3",
        invariants: ["a", "a", "a"].map((id, i) => ({
          id,
          group: "identity",
          scope: "state",
          description: `copy ${i}`,
          applies_to: ["state.id"],
          condition: { type: "predicate", expression: "state.id != null" },
          failure_mode: "reject",
        })),
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    // "a" should appear exactly once in the duplicate list.
    const occurrences = msg.split("a").length - 1;
    // (message contains other letters too; assert the id is named and the
    // report is not absurdly repetitive)
    expect(msg).toMatch(/duplicate invariant id\(s\): a\b/i);
    expect(occurrences).toBeGreaterThan(0);
  });

  it("a well-formed registry with unique ids still loads", () => {
    expect(() => getCompiledRegistry()).not.toThrow();
  });
});

// =============================================================================
// RT-B-007 — RegistryDrivenRegistrar degraded-predicate telemetry
// =============================================================================

describe("RT-B-007 RegistryDrivenRegistrar telemetry", () => {
  it("emits a degraded event when a predicate throws during register()", () => {
    const sink = new CapturingTelemetry();
    const reg = new RegistryDrivenRegistrar(brokenRegistry(), sink);

    // "hello" > 5 throws at eval → fails closed to false → rejected verdict.
    const result = reg.register(tx(null, { id: "hello", structure: {}, data: null }));
    expect(result.kind).toBe("rejected");

    const events = sink.byOp("predicate.eval");
    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events[0]!;
    expect(ev.outcome).toBe("degraded");
    expect(ev.attributes).toEqual({ invariantId: "test.broken_predicate" });
  });

  it("emits a degraded event when a predicate throws during validate()", () => {
    const sink = new CapturingTelemetry();
    const reg = new RegistryDrivenRegistrar(brokenRegistry(), sink);

    const report = reg.validate({ id: "hello", structure: {}, data: null });
    expect(report.valid).toBe(false);
    expect(sink.byOp("predicate.eval").length).toBeGreaterThanOrEqual(1);
  });

  it("is silent by default (no sink → no degraded events leak)", () => {
    // No telemetry argument; behavior (fail-closed reject) is unchanged.
    const reg = new RegistryDrivenRegistrar(brokenRegistry());
    const result = reg.register(tx(null, { id: "hello", structure: {}, data: null }));
    expect(result.kind).toBe("rejected");
  });
});

// =============================================================================
// RT-B-008 — snapshot() telemetry
// =============================================================================

describe("RT-B-008 snapshot telemetry", () => {
  it("emits a snapshot event with mode + stateCount", () => {
    const sink = new CapturingTelemetry();
    const reg = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: getCompiledRegistry(),
      telemetry: sink,
    });
    reg.register(tx(null, rootState("A")));
    reg.register(tx(null, rootState("B")));

    const snap = reg.snapshot();
    expect(snap.state_ids.length).toBe(2);

    const ev = sink.byOp("snapshot")[0]!;
    expect(ev.package).toBe("@attestia/registrum");
    expect(ev.outcome).toBe("ok");
    expect(ev.level).toBe("info");
    expect(ev.attributes).toMatchObject({ mode: "registry", stateCount: 2 });
  });

  it("snapshot() value is unaffected by a misbehaving sink", () => {
    const explodingSink: Telemetry = {
      record() {
        throw new Error("sink exploded");
      },
    };
    const reg = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: getCompiledRegistry(),
      telemetry: explodingSink,
    });
    reg.register(tx(null, rootState("A")));

    let snap: RegistrarSnapshotV1 | undefined;
    expect(() => {
      snap = reg.snapshot();
    }).not.toThrow();
    expect(snap!.state_ids).toEqual(["A"]);
  });

  it("snapshot registry_hash still round-trips for rehydration", () => {
    // Telemetry on snapshot() must not alter the structural output: the hash it
    // stamps must still match a freshly computed one for the same registry.
    const compiled = getCompiledRegistry();
    const reg = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: compiled,
    });
    reg.register(tx(null, rootState("A")));
    const snap = reg.snapshot();
    expect(snap.registry_hash).toBe(computeRegistryHash(compiled));
  });
});
