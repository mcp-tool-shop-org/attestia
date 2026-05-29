/**
 * Observability tests (D1-B-002).
 *
 * `evaluatePredicate` fails closed: a predicate that throws an EvaluationError
 * is coerced to `false`. Historically that error was swallowed silently, so a
 * structurally-broken invariant was indistinguishable from a legitimately-false
 * one. D1-B-002 keeps the fail-closed behavior but makes the swallow OBSERVABLE
 * via an injectable Telemetry sink.
 *
 * These tests use a capturing sink to verify:
 *  - a throwing predicate emits a `degraded` warn event (op "predicate.eval")
 *    while still returning false (fail-closed preserved),
 *  - a normal register emits an `ok` event (op "register"),
 *  - a normal validate emits an `ok` event (op "validate"),
 *  - the default (no sink) path is silent and unchanged,
 *  - telemetry never changes a verdict, even when record() throws.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { StructuralRegistrar } from "../src/structural-registrar.js";
import {
  loadInvariantRegistry,
  type CompiledInvariantRegistry,
} from "../src/registry/loader.js";
import { evaluatePredicate } from "../src/registry/predicate/evaluator.js";
import type {
  Telemetry,
  ObservabilityEvent,
} from "@attestia/types";
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

/**
 * A registry with ONE structurally-broken invariant: it compares the string
 * `state.id` with a number using `>`, which the evaluator rejects at runtime
 * (EvaluationError) and fails closed. Static validation accepts it — the bug is
 * only visible at evaluation time, which is exactly the silent-failure case
 * D1-B-002 makes observable.
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

function rootState(id: string): State {
  return { id, structure: { isRoot: true }, data: null };
}

function tx(from: string | null, to: State): Transition {
  return { from, to };
}

// =============================================================================
// Tests
// =============================================================================

describe("D1-B-002 evaluatePredicate telemetry", () => {
  it("emits a degraded warn event when a predicate throws (fail-closed kept)", () => {
    const reg = brokenRegistry();
    const sink = new CapturingTelemetry();

    const result = evaluatePredicate(
      reg.invariants[0]!.ast,
      {
        state: { id: "hello", structure: {} },
        transition: { from: null, to: { id: "hello", structure: {} } },
        registry: {
          contains_state: () => false,
          max_order_index: () => -1,
          compute_order_index: () => 0,
        },
        ordering: null,
      },
      sink,
      "test.broken_predicate"
    );

    // Fail-closed behavior is preserved.
    expect(result).toBe(false);

    // The swallowed error is now observable.
    const events = sink.byOp("predicate.eval");
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.package).toBe("@attestia/registrum");
    expect(ev.level).toBe("warn");
    expect(ev.outcome).toBe("degraded");
    expect(ev.attributes).toEqual({ invariantId: "test.broken_predicate" });
    expect(typeof ev.message).toBe("string");
    expect(ev.message).toMatch(/numeric/i);
  });

  it("emits nothing when the predicate evaluates cleanly", () => {
    const reg = getCompiledRegistry();
    const sink = new CapturingTelemetry();
    // A well-formed identity predicate evaluates to a boolean without throwing.
    const idInvariant = reg.invariants.find(
      (i) => i.id === "state.identity.explicit"
    )!;
    const result = evaluatePredicate(
      idInvariant.ast,
      {
        state: { id: "ok", structure: { isRoot: true } },
        transition: { from: null, to: { id: "ok", structure: { isRoot: true } } },
        registry: {
          contains_state: () => false,
          max_order_index: () => -1,
          compute_order_index: () => 0,
        },
        ordering: null,
      },
      sink,
      "state.identity.explicit"
    );
    expect(result).toBe(true);
    expect(sink.byOp("predicate.eval").length).toBe(0);
  });

  it("defaults to a no-op sink (silent, unchanged behavior)", () => {
    const reg = brokenRegistry();
    // No telemetry argument — must not throw and must still fail closed.
    const result = evaluatePredicate(reg.invariants[0]!.ast, {
      state: { id: "hello", structure: {} },
      transition: { from: null, to: { id: "hello", structure: {} } },
      registry: {
        contains_state: () => false,
        max_order_index: () => -1,
        compute_order_index: () => 0,
      },
      ordering: null,
    });
    expect(result).toBe(false);
  });
});

describe("D1-B-002 registrar register/validate telemetry", () => {
  it("a normal register emits an ok event", () => {
    const sink = new CapturingTelemetry();
    const reg = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: getCompiledRegistry(),
      telemetry: sink,
    });

    const result = reg.register(tx(null, rootState("A")));
    expect(result.kind).toBe("accepted");

    const events = sink.byOp("register");
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.outcome).toBe("ok");
    expect(ev.level).toBe("info");
    expect(ev.attributes).toMatchObject({ mode: "registry", result: "accepted" });
    expect(typeof ev.durationMs).toBe("number");
    expect(ev.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("a rejected register still emits an ok (completed-verdict) event", () => {
    const sink = new CapturingTelemetry();
    const reg = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: getCompiledRegistry(),
      telemetry: sink,
    });

    // Child referencing a non-existent parent → rejected verdict.
    const result = reg.register(tx("Ghost", { id: "Ghost", structure: {}, data: null }));
    expect(result.kind).toBe("rejected");

    const ev = sink.byOp("register")[0]!;
    expect(ev.outcome).toBe("ok");
    expect(ev.attributes).toMatchObject({ result: "rejected" });
  });

  it("a normal validate emits an ok event", () => {
    const sink = new CapturingTelemetry();
    const reg = new StructuralRegistrar({
      mode: "registry",
      compiledRegistry: getCompiledRegistry(),
      telemetry: sink,
    });

    const report = reg.validate(rootState("Probe"));
    expect(report.valid).toBe(true);

    const events = sink.byOp("validate");
    expect(events.length).toBe(1);
    expect(events[0]!.outcome).toBe("ok");
    expect(events[0]!.attributes).toMatchObject({ valid: true });
  });

  it("a misbehaving sink never affects the verdict", () => {
    // The Telemetry contract says record() never throws; registrum defends
    // against a buggy sink anyway (observability must never break the operation
    // it observes). A throwing sink must be swallowed and the verdict returned.
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

    // No throw escapes; the accepted verdict is produced normally.
    let result: { kind: string } | undefined;
    expect(() => {
      result = reg.register(tx(null, rootState("Safe")));
    }).not.toThrow();
    expect(result!.kind).toBe("accepted");

    // validate() is likewise unaffected.
    let report: { valid: boolean } | undefined;
    expect(() => {
      report = reg.validate(rootState("Probe"));
    }).not.toThrow();
    expect(report!.valid).toBe(true);
  });
});
