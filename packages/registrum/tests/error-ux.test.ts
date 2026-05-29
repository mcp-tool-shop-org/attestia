/**
 * Error-UX tests (D1-B-001, D1-B-003, D1-B-005).
 *
 * Covers:
 * - D1-B-001: InvariantViolation messages are enriched with the offending
 *   operands, and carry a structured `details` ({ field, expected, actual }).
 * - D1-B-003: the append-only guard throws a typed AppendOnlyViolationError
 *   (HALT-class, stable code, carries the offending versionKey), not a raw Error.
 * - D1-B-005: every registrum error class exposes a stable `code` from the
 *   documented vocabulary.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import {
  StructuralRegistrar,
  ParityViolationError,
  AppendOnlyViolationError,
} from "../src/structural-registrar.js";
import { loadInvariantRegistry } from "../src/registry/loader.js";
import {
  RegistryError,
  InvariantDefinitionError,
} from "../src/registry/errors.js";
import { ParseError, parsePredicate } from "../src/registry/predicate/parser.js";
import {
  ValidationError,
  validatePredicate,
} from "../src/registry/predicate/validator.js";
import { EvaluationError } from "../src/registry/predicate/evaluator.js";
import {
  SnapshotValidationError,
  validateSnapshot,
} from "../src/persistence/snapshot.js";
import {
  RehydrationError,
  RegistryMismatchError,
} from "../src/persistence/rehydrator.js";
import type { State, Transition, InvariantViolation } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

function getCompiledRegistry() {
  const registryPath = path.join(process.cwd(), "invariants", "registry.json");
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  return loadInvariantRegistry(raw);
}

function rootState(id: string, extra: Record<string, unknown> = {}): State {
  return { id, structure: { isRoot: true, ...extra }, data: null };
}

function childState(id: string, extra: Record<string, unknown> = {}): State {
  return { id, structure: { ...extra }, data: null };
}

function tx(from: string | null, to: State): Transition {
  return { from, to };
}

function makeRegistry() {
  return new StructuralRegistrar({
    mode: "registry",
    compiledRegistry: getCompiledRegistry(),
  });
}

/** Find the violation for a given invariant id in a rejection. */
function violationFor(
  result: { kind: string; violations?: readonly InvariantViolation[] },
  id: string
): InvariantViolation | undefined {
  if (result.kind !== "rejected" || !result.violations) return undefined;
  return result.violations.find((v) => v.invariantId === id);
}

// =============================================================================
// D1-B-001 — enriched messages + structured details
// =============================================================================

describe("D1-B-001 enriched invariant-violation messages", () => {
  it("identity.immutable carries the offending ids in message + details", () => {
    const reg = makeRegistry();
    // Register a root "A", then propose a transition from A whose to.id is "B"
    // (identity mutation) — violates state.identity.immutable.
    expect(reg.register(tx(null, rootState("A"))).kind).toBe("accepted");

    const result = reg.register(tx("A", childState("B")));
    expect(result.kind).toBe("rejected");

    const v = violationFor(result, "state.identity.immutable");
    expect(v).toBeDefined();
    // Message interpolates the concrete operands.
    expect(v!.message).toContain("'B'");
    expect(v!.message).toContain("'A'");
    // Structured details name the offending operands.
    expect(v!.details).toBeDefined();
    expect(v!.details!.field).toBe("to.id");
    expect(v!.details!.expected).toBe("A");
    expect(v!.details!.actual).toBe("B");
  });

  it("lineage.parent_exists names the missing parent id", () => {
    const reg = makeRegistry();
    // Child referencing a parent "Ghost" that was never registered.
    const result = reg.register(tx("Ghost", childState("Ghost")));
    expect(result.kind).toBe("rejected");

    const v = violationFor(result, "state.lineage.parent_exists");
    expect(v).toBeDefined();
    expect(v!.message).toContain("Ghost");
    expect(v!.details).toBeDefined();
    expect(v!.details!.field).toBe("from");
    expect(v!.details!.actual).toBe("Ghost");
  });

  it("identity.unique names the duplicate id (HALT-class)", () => {
    const reg = makeRegistry();
    expect(reg.register(tx(null, rootState("Dup"))).kind).toBe("accepted");

    // A second root with the same id violates uniqueness (a HALT invariant).
    const result = reg.register(tx(null, rootState("Dup")));
    expect(result.kind).toBe("rejected");

    const v = violationFor(result, "state.identity.unique");
    expect(v).toBeDefined();
    expect(v!.classification).toBe("HALT");
    expect(v!.message).toContain("Dup");
    expect(v!.details).toBeDefined();
    expect(v!.details!.actual).toBe("Dup");
  });

  it("keeps the stable rule text available on the invariant description", () => {
    const reg = makeRegistry();
    const descriptors = reg.listInvariants();
    const immutable = descriptors.find(
      (d) => d.id === "state.identity.immutable"
    );
    expect(immutable).toBeDefined();
    // The value-free rule text is the stable description, with NO interpolated
    // operands (no quoted ids). Enrichment lives on the violation message, not
    // on the rule text.
    expect(immutable!.description).not.toContain("'");
    expect(immutable!.description.toLowerCase()).toContain("identity");
  });
});

// =============================================================================
// D1-B-003 — typed append-only violation
// =============================================================================

describe("D1-B-003 AppendOnlyViolationError", () => {
  it("is thrown (typed, HALT-class) when a version key is reused", () => {
    const reg = makeRegistry();
    expect(reg.register(tx(null, rootState("X"))).kind).toBe("accepted");

    // Force corruption: rewind the order counter so the next accept reuses the
    // composite versionKey "X#0" that already exists. This is the exact
    // structural condition the append-only guard defends against.
    (reg as unknown as { currentOrderIndex: number }).currentOrderIndex = 0;

    let thrown: unknown;
    try {
      // Same-id transition on X — would append X#0 again.
      reg.register(tx("X", childState("X")));
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AppendOnlyViolationError);
    const err = thrown as AppendOnlyViolationError;
    expect(err.code).toBe("APPEND_ONLY_VIOLATION");
    expect(err.versionKey).toBe("X#0");
    expect(err.message).toContain("[HALT]");
    expect(err.message).toContain("X#0");
  });
});

// =============================================================================
// D1-B-005 — stable error codes
// =============================================================================

describe("D1-B-005 stable error codes", () => {
  it("each error class exposes its documented, stable code", () => {
    expect(new RegistryError("x").code).toBe("REGISTRY_INVALID");
    expect(new InvariantDefinitionError("x").code).toBe(
      "INVARIANT_DEF_INVALID"
    );
    expect(new ParseError("x").code).toBe("PREDICATE_PARSE");
    expect(new ValidationError("x").code).toBe("PREDICATE_UNSAFE");
    expect(new EvaluationError("x").code).toBe("PREDICATE_EVAL");
    expect(new SnapshotValidationError("x").code).toBe("SNAPSHOT_INVALID");
    expect(new RehydrationError("x").code).toBe("REHYDRATION_FAILED");
    expect(new RegistryMismatchError("a", "b").code).toBe("REGISTRY_DRIFT");
    expect(new ParityViolationError("x", "a", "b").code).toBe("PARITY_HALT");
    expect(new AppendOnlyViolationError("X#0").code).toBe(
      "APPEND_ONLY_VIOLATION"
    );
  });

  it("RegistryMismatchError narrows the inherited RehydrationError code", () => {
    const err = new RegistryMismatchError("expected", "actual");
    // Still an instance of the base class...
    expect(err).toBeInstanceOf(RehydrationError);
    // ...but carries the more specific drift code.
    expect(err.code).toBe("REGISTRY_DRIFT");
  });

  it("codes surface on thrown errors from real failure paths", () => {
    // ParseError from a malformed predicate.
    let parseCode: unknown;
    try {
      parsePredicate("state.id ==");
    } catch (e) {
      parseCode = (e as { code?: unknown }).code;
    }
    expect(parseCode).toBe("PREDICATE_PARSE");

    // ValidationError from an unsafe predicate (forbidden root identifier).
    let valCode: unknown;
    try {
      validatePredicate(parsePredicate("danger.field == 1"));
    } catch (e) {
      valCode = (e as { code?: unknown }).code;
    }
    expect(valCode).toBe("PREDICATE_UNSAFE");

    // SnapshotValidationError from an invalid snapshot.
    let snapCode: unknown;
    try {
      validateSnapshot({ not: "a snapshot" });
    } catch (e) {
      snapCode = (e as { code?: unknown }).code;
    }
    expect(snapCode).toBe("SNAPSHOT_INVALID");

    // RegistryError from a malformed registry.
    let regCode: unknown;
    try {
      loadInvariantRegistry(null);
    } catch (e) {
      regCode = (e as { code?: unknown }).code;
    }
    expect(regCode).toBe("REGISTRY_INVALID");
  });

  it("the code vocabulary is the stable, expected set", () => {
    const codes = new Set([
      new RegistryError("x").code,
      new InvariantDefinitionError("x").code,
      new ParseError("x").code,
      new ValidationError("x").code,
      new EvaluationError("x").code,
      new SnapshotValidationError("x").code,
      new RehydrationError("x").code,
      new RegistryMismatchError("a", "b").code,
      new ParityViolationError("x", "a", "b").code,
      new AppendOnlyViolationError("X#0").code,
    ]);
    expect(codes).toEqual(
      new Set([
        "REGISTRY_INVALID",
        "INVARIANT_DEF_INVALID",
        "PREDICATE_PARSE",
        "PREDICATE_UNSAFE",
        "PREDICATE_EVAL",
        "SNAPSHOT_INVALID",
        "REHYDRATION_FAILED",
        "REGISTRY_DRIFT",
        "PARITY_HALT",
        "APPEND_ONLY_VIOLATION",
      ])
    );
  });
});
