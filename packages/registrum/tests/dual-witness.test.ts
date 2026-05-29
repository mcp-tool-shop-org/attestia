/**
 * Runtime Dual-Witness Comparator Tests (D1-A-002)
 *
 * Registrum's constitutional claim is fail-closed dual-witness governance:
 * every register()/validate() runs BOTH the registry AST engine AND the legacy
 * predicate engine, compares normalized outcomes, and HALTS on any divergence.
 *
 * These tests verify the RUNTIME comparator (not just the offline parity
 * suite):
 *   - Agreement → the operation proceeds and parity_status is AGREED, derived
 *     from the actual comparison (not supplied as input).
 *   - Divergence → the operation throws (fail-closed HALT); no state mutates.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import {
  StructuralRegistrar,
  ParityViolationError,
} from "../src/structural-registrar.js";
import { loadInvariantRegistry } from "../src/registry/loader.js";
import { INITIAL_INVARIANTS } from "../src/invariants.js";
import type { Invariant, Transition, State } from "../src/types.js";
import { generateAttestationFromRegistrar } from "../src/attestation/generator.js";

// =============================================================================
// Helpers
// =============================================================================

function getCompiledRegistry() {
  const registryPath = path.join(process.cwd(), "invariants", "registry.json");
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  return loadInvariantRegistry(raw);
}

function createRootState(id: string, extra: Record<string, unknown> = {}): State {
  return { id, structure: { isRoot: true, ...extra }, data: null };
}

function createTransition(from: string | null, to: State): Transition {
  return { from, to };
}

// A legacy invariant set that DIVERGES from the registry: it rejects every
// root transition (the registry accepts well-formed roots). Transition-scope
// so it fires for BOTH register() and validate(transition), letting us force a
// witness disagreement on both paths.
const ALWAYS_REJECT_ROOTS: readonly Invariant[] = [
  {
    id: "test.always_reject_roots",
    scope: "transition",
    appliesTo: ["from"],
    failureMode: "reject",
    description: "Test-only invariant that rejects all root transitions.",
    predicate: (input) => {
      const t =
        input.kind === "transition" || input.kind === "registration"
          ? input.transition
          : null;
      if (!t) return true;
      return t.from !== null; // reject roots (from === null)
    },
  },
];

// A legacy invariant set that diverges from the registry for EXACTLY ONE id
// ("Diverge"): it rejects the root transition whose target id is "Diverge"
// while agreeing with the registry (accepting) on every other well-formed root.
// This lets a single registrar HALT on one input and AGREE on the next, so we
// can prove the order cursor is NOT consumed by a halted register().
const REJECT_ONLY_DIVERGE: readonly Invariant[] = [
  {
    id: "test.reject_only_diverge",
    scope: "transition",
    appliesTo: ["from"],
    failureMode: "reject",
    description: "Test-only invariant that rejects the root id 'Diverge'.",
    predicate: (input) => {
      const t =
        input.kind === "transition" || input.kind === "registration"
          ? input.transition
          : null;
      if (!t) return true;
      // Diverge from the registry only for the id "Diverge" (reject its root).
      // Agree (accept) on all other roots and on all non-root transitions.
      return !(t.from === null && t.to.id === "Diverge");
    },
  },
];

// =============================================================================
// Agreement path
// =============================================================================

describe("dual-witness: agreement", () => {
  it("proceeds when both engines agree and records parity_status AGREED", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });

    const result = registrar.register(
      createTransition(null, createRootState("Doc1"))
    );

    expect(result.kind).toBe("accepted");
    // parity_status is derived from the ACTUAL comparison, not an input.
    expect(registrar.getLastParityStatus()).toBe("AGREED");
    // State mutated exactly once (not twice — one engine is authoritative).
    expect(registrar.getRegisteredCount()).toBe(1);
    expect(registrar.isRegistered("Doc1")).toBe(true);
  });

  it("agrees on rejection (both engines reject the same input)", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });

    // Non-root with null parent: rejected by both engines (lineage.explicit).
    const result = registrar.register(
      createTransition(null, { id: "Orphan", structure: {}, data: null })
    );

    expect(result.kind).toBe("rejected");
    expect(registrar.getLastParityStatus()).toBe("AGREED");
    // No state mutated on a rejected transition.
    expect(registrar.getRegisteredCount()).toBe(0);
  });

  it("validate agrees and reports AGREED", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });

    const report = registrar.validate(createRootState("Valid"));
    expect(report.valid).toBe(true);
    expect(registrar.getLastParityStatus()).toBe("AGREED");
  });
});

// =============================================================================
// Attestation derives parity_status from the ACTUAL comparison (D1-A-002)
// =============================================================================

describe("dual-witness: attestation derives parity_status from comparison", () => {
  it("emits parity_status AGREED + mode 'dual' from the registrar, not input", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });
    registrar.register(createTransition(null, createRootState("Doc1")));

    const payload = generateAttestationFromRegistrar(registrar, {
      registryHash: "a".repeat(64),
      transitionFrom: 0,
      transitionTo: 0,
    });

    // parity_status comes from getLastParityStatus(), not a caller-supplied value.
    expect(payload.parity_status).toBe("AGREED");
    expect(payload.mode).toBe("dual");
    expect(payload.state_count).toBe(1);
  });

  it("refuses to attest when no dual-witness comparison has run", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });
    // No register/validate yet → no actual parity result to attest. Fail-closed.
    expect(() =>
      generateAttestationFromRegistrar(registrar, {
        registryHash: "a".repeat(64),
        transitionFrom: 0,
        transitionTo: 0,
      })
    ).toThrow(/parity/i);
  });
});

// =============================================================================
// Divergence path (fail-closed HALT)
// =============================================================================

describe("dual-witness: divergence halts fail-closed", () => {
  it("throws ParityViolationError on register when engines disagree", () => {
    // Registry accepts a well-formed root; the injected legacy witness rejects
    // all roots. The engines therefore disagree → the comparator must HALT.
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: ALWAYS_REJECT_ROOTS,
    });

    expect(() =>
      registrar.register(createTransition(null, createRootState("Doc1")))
    ).toThrow(ParityViolationError);
  });

  it("does NOT mutate state when a register halts", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: ALWAYS_REJECT_ROOTS,
    });

    try {
      registrar.register(createTransition(null, createRootState("Doc1")));
    } catch {
      // expected
    }

    // Fail-closed: a halted operation leaves the registrar untouched.
    expect(registrar.getRegisteredCount()).toBe(0);
    expect(registrar.isRegistered("Doc1")).toBe(false);
  });

  it("throws ParityViolationError on validate when engines disagree", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      invariants: ALWAYS_REJECT_ROOTS,
    });

    // For a root transition, the legacy witness rejects (registration-scope
    // invariant) while the registry accepts → divergence on validate(transition).
    expect(() =>
      registrar.validate(createTransition(null, createRootState("Doc1")))
    ).toThrow(ParityViolationError);
  });

  // V3-002: a halted register() must consume NOTHING — not even the order
  // cursor. The append-only guarantee is that a divergence leaves the registrar
  // byte-identical to its pre-call state, so the very next agreeing register()
  // is accepted at orderIndex 0 (the cursor was never advanced by the halt).
  it("does NOT consume the order cursor on a halted register; the next agreeing register lands at orderIndex 0", () => {
    const registrar = StructuralRegistrar.dualWitness({
      compiledRegistry: getCompiledRegistry(),
      // Diverges only for the id "Diverge"; agrees on every other root.
      invariants: REJECT_ONLY_DIVERGE,
    });

    // Pre-conditions: empty registrar, cursor at 0.
    expect(registrar.getCurrentOrderIndex()).toBe(0);
    expect(registrar.getRegisteredCount()).toBe(0);

    // Register the divergent id → witnesses disagree → fail-closed HALT.
    expect(() =>
      registrar.register(createTransition(null, createRootState("Diverge")))
    ).toThrow(ParityViolationError);

    // The halt mutated NOTHING: no state registered AND the order cursor is
    // still 0 (it was not consumed by the rejected/halted attempt).
    expect(registrar.getRegisteredCount()).toBe(0);
    expect(registrar.isRegistered("Diverge")).toBe(false);
    expect(registrar.getCurrentOrderIndex()).toBe(0);
    // Parity status reflects the actual HALT.
    expect(registrar.getLastParityStatus()).toBe("HALTED");

    // A SUBSEQUENT agreeing register() proceeds and is accepted at orderIndex 0
    // — proving the cursor was never advanced by the halt.
    const result = registrar.register(
      createTransition(null, createRootState("Doc1"))
    );
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.orderIndex).toBe(0);
    }
    expect(registrar.getLastParityStatus()).toBe("AGREED");
    expect(registrar.getCurrentOrderIndex()).toBe(1);
    expect(registrar.getRegisteredCount()).toBe(1);
  });
});
