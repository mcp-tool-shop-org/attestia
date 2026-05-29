/**
 * Dual-Mode Persistence Tests (V1-001)
 *
 * `dual` is the RECOMMENDED production mode: every register()/validate() runs
 * both the registry AST engine and the legacy predicate engine and HALTS
 * fail-closed on divergence (see StructuralRegistrar.dualWitness). A
 * dual-witness registrar's snapshot() therefore emits `mode: "dual"`.
 *
 * The persistence contract MUST accept that snapshot. These tests prove the
 * full production loop: dualWitness() → snapshot() → validateSnapshot() →
 * rehydrate()/fromSnapshot() → continue accepting transitions, and that the
 * registry content-hash guard still fires on constitutional drift in dual mode.
 *
 * Before the V1-001 fix these all FAILED: validateSnapshot rejected
 * mode:"dual", RehydrationOptions.mode could not be "dual", and
 * computeExpectedHash had no dual branch.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { StructuralRegistrar } from "../../src/structural-registrar";
import { loadInvariantRegistry } from "../../src/registry/loader";
import { INITIAL_INVARIANTS } from "../../src/invariants";
import {
  serializeSnapshot,
  deserializeSnapshot,
  validateSnapshot,
  rehydrate,
  RegistryMismatchError,
  type RegistrarSnapshotV1,
} from "../../src/persistence";
import type { State } from "../../src/types";

// =============================================================================
// Helpers
// =============================================================================

function createRootState(id: string, extra: Record<string, unknown> = {}): State {
  return { id, structure: { isRoot: true, ...extra }, data: null };
}

function createTransition(from: string | null, to: State) {
  return { from, to };
}

function getCompiledRegistry() {
  const registryPath = path.join(process.cwd(), "invariants", "registry.json");
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  return loadInvariantRegistry(raw);
}

function createDualRegistrar() {
  return StructuralRegistrar.dualWitness({
    compiledRegistry: getCompiledRegistry(),
    invariants: INITIAL_INVARIANTS,
  });
}

// =============================================================================
// Dual-mode snapshot → validate → rehydrate round-trip (V1-001)
// =============================================================================

describe("dual-mode persistence (V1-001)", () => {
  it("a dual-witness snapshot carries mode 'dual'", () => {
    const registrar = createDualRegistrar();
    registrar.register(createTransition(null, createRootState("Doc1")));

    const snap = registrar.snapshot();
    expect(snap.mode).toBe("dual");
  });

  it("validateSnapshot ACCEPTS a dual-mode snapshot", () => {
    const registrar = createDualRegistrar();
    registrar.register(createTransition(null, createRootState("Doc1")));
    const snap = registrar.snapshot();

    // Must not throw.
    expect(() => validateSnapshot(snap)).not.toThrow();
  });

  it("rehydrate() restores a dual-mode snapshot (frontier + order cursor)", () => {
    const registrar = createDualRegistrar();
    registrar.register(createTransition(null, createRootState("A")));
    registrar.register(createTransition(null, createRootState("B")));
    registrar.register(createTransition(null, createRootState("C")));

    const snap = registrar.snapshot();

    const state = rehydrate(snap, {
      mode: "dual",
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });

    expect(state.registry.size).toBe(3);
    expect(state.currentOrderIndex).toBe(3);
  });

  it("fromSnapshot() round-trips a dual registrar and it stays dual + registry-authoritative", () => {
    const original = createDualRegistrar();
    original.register(createTransition(null, createRootState("A")));
    original.register(createTransition(null, createRootState("B")));

    const snap = original.snapshot();

    const rehydrated = StructuralRegistrar.fromSnapshot(snap, {
      mode: "dual",
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });

    // Restored as a dual-witness registrar.
    expect(rehydrated.getMode()).toBe("dual");
    expect(rehydrated.getRegisteredCount()).toBe(2);
    expect(rehydrated.getCurrentOrderIndex()).toBe(2);

    // Snapshot round-trips byte-for-byte (frontier identity preserved). Checked
    // BEFORE any continuation so both registrars hold the same state set.
    expect(serializeSnapshot(rehydrated.snapshot())).toBe(
      serializeSnapshot(original.snapshot())
    );

    // It still behaves as dual: a subsequent register runs BOTH witnesses,
    // they agree, and parity_status is the ACTUAL comparison result.
    const result = rehydrated.register(
      createTransition(null, createRootState("C"))
    );
    expect(result.kind).toBe("accepted");
    expect(rehydrated.getLastParityStatus()).toBe("AGREED");
    expect(rehydrated.getRegisteredCount()).toBe(3);
  });

  it("survives JSON serialize → deserialize → rehydrate", () => {
    const original = createDualRegistrar();
    original.register(createTransition(null, createRootState("Doc1")));

    const json = serializeSnapshot(original.snapshot());
    const parsed = deserializeSnapshot(json);

    const rehydrated = StructuralRegistrar.fromSnapshot(parsed, {
      mode: "dual",
      compiledRegistry: getCompiledRegistry(),
      invariants: INITIAL_INVARIANTS,
    });

    expect(rehydrated.getMode()).toBe("dual");
    expect(rehydrated.isRegistered("Doc1")).toBe(true);
  });

  it("dual snapshot uses the registry content hash (registry-authoritative)", () => {
    // On agreement, dual is registry-authoritative, so its snapshot hash must
    // be the registry CONTENT hash — not a legacy id-list hash. A registry
    // content hash is 64 hex chars; the legacy hash is a `legacy:` string.
    const registrar = createDualRegistrar();
    registrar.register(createTransition(null, createRootState("Doc1")));
    const snap = registrar.snapshot();

    expect(snap.registry_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.registry_hash.startsWith("legacy:")).toBe(false);
  });

  // The constitutional-drift guard MUST still fire in dual mode. This is the
  // safety property: a snapshot taken under one constitution cannot be
  // rehydrated under a silently-mutated one.
  it("rejects constitutional drift on a dual-mode snapshot (content-hash guard)", () => {
    const original = createDualRegistrar();
    original.register(createTransition(null, createRootState("Doc1")));
    const snap = original.snapshot();

    // Same registry_id, one predicate expression mutated in memory.
    const registryPath = path.join(process.cwd(), "invariants", "registry.json");
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    raw.invariants[0].condition.expression =
      raw.invariants[0].condition.expression + " && true";
    const tampered = loadInvariantRegistry(raw);

    expect(() => {
      StructuralRegistrar.fromSnapshot(snap, {
        mode: "dual",
        compiledRegistry: tampered,
        invariants: INITIAL_INVARIANTS,
      });
    }).toThrow(RegistryMismatchError);
  });

  it("dual mode requires compiledRegistry on rehydration (fail-closed)", () => {
    const original = createDualRegistrar();
    original.register(createTransition(null, createRootState("Doc1")));
    const snap = original.snapshot();

    expect(() => {
      StructuralRegistrar.fromSnapshot(snap, {
        mode: "dual",
        // compiledRegistry intentionally omitted
        invariants: INITIAL_INVARIANTS,
      } as unknown as { mode: "dual"; invariants: typeof INITIAL_INVARIANTS });
    }).toThrow(/registry/i);
  });
});
