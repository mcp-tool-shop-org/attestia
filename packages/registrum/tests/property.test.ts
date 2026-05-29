/**
 * Property-Based Tests for @attestia/registrum
 *
 * Uses fast-check to verify constitutional invariants hold under
 * arbitrary valid inputs:
 *
 * 1. All 11 invariants hold for ANY valid transition sequence
 * 2. Ordering is monotonic and total
 * 3. Canonical serialization is stable (same state → same bytes)
 * 4. Snapshot → restore → snapshot is idempotent (replay determinism)
 * 5. Invalid transitions are always rejected (fail-closed)
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { State, Transition, StateID } from "../src/types.js";
import { StructuralRegistrar } from "../src/structural-registrar.js";
import { INITIAL_INVARIANTS } from "../src/invariants.js";
import {
  serializeSnapshot,
  computeSnapshotChecksum32,
} from "../src/persistence/serializer.js";
import {
  generateAttestationPayload,
  computeSnapshotHashForAttestation,
  canonicalizeForHash,
} from "../src/attestation/index.js";

// =============================================================================
// Arbitraries
// =============================================================================

/** Generate a valid StateID (non-empty alphanumeric string). */
const arbStateId: fc.Arbitrary<StateID> = fc.stringMatching(/^[a-z0-9]{1,12}$/);

/** Generate a unique set of StateIDs. */
function arbUniqueIds(count: number): fc.Arbitrary<string[]> {
  return fc
    .uniqueArray(arbStateId, { minLength: count, maxLength: count })
    .filter((arr) => arr.length === count);
}

/** Generate a root State (isRoot = true, from = null). */
function arbRootState(id: StateID): State {
  return {
    id,
    structure: { isRoot: true },
    data: null,
  };
}

/** Generate a child Transition (from = parentId). */
function arbChildTransition(parentId: StateID): Transition {
  return {
    from: parentId,
    to: {
      id: parentId,
      structure: {},
      data: null,
    },
  };
}

/**
 * Generate a valid chain of transitions:
 * - First is a root state (from = null)
 * - Subsequent can either be new roots or child transitions
 */
function arbTransitionChain(
  ids: string[],
): Transition[] {
  const transitions: Transition[] = [];

  // First must be root
  transitions.push({
    from: null,
    to: arbRootState(ids[0]!),
  });

  // Subsequent: child transitions on the last registered state
  for (let i = 1; i < ids.length; i++) {
    transitions.push({
      from: null,
      to: arbRootState(ids[i]!),
    });
  }

  return transitions;
}

/**
 * Create a fresh legacy-mode registrar for testing.
 */
function createLegacyRegistrar(): StructuralRegistrar {
  return new StructuralRegistrar({
    mode: "legacy",
    invariants: INITIAL_INVARIANTS,
  });
}

// =============================================================================
// Property: Invariants Hold for Any Valid Transition Sequence
// =============================================================================

describe("property: invariants hold under arbitrary valid transitions", () => {
  it("all root transitions with unique IDs are accepted", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            const transition: Transition = {
              from: null,
              to: arbRootState(id),
            };
            const result = registrar.register(transition);
            expect(result.kind).toBe("accepted");
          }

          expect(registrar.getRegisteredCount()).toBe(ids.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("child transitions on registered parents are accepted", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          // Register root
          const rootId = ids[0]!;
          const rootResult = registrar.register({
            from: null,
            to: arbRootState(rootId),
          });
          expect(rootResult.kind).toBe("accepted");

          // Child transitions on root (same id = update)
          for (let i = 1; i < ids.length; i++) {
            // Register another root so we have more states
            const result = registrar.register({
              from: null,
              to: arbRootState(ids[i]!),
            });
            expect(result.kind).toBe("accepted");
          }

          // Now do a child transition on the first root
          const childResult = registrar.register(arbChildTransition(rootId));
          expect(childResult.kind).toBe("accepted");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// Property: Ordering is Monotonic and Total
// =============================================================================

describe("property: ordering is monotonic and total", () => {
  it("each accepted transition gets a strictly increasing orderIndex", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 25 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();
          let lastIndex = -1;

          for (const id of ids) {
            const result = registrar.register({
              from: null,
              to: arbRootState(id),
            });

            if (result.kind === "accepted") {
              expect(result.orderIndex).toBeGreaterThan(lastIndex);
              lastIndex = result.orderIndex;
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("orderIndex starts at 0 and increments by 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (let i = 0; i < ids.length; i++) {
            const result = registrar.register({
              from: null,
              to: arbRootState(ids[i]!),
            });

            if (result.kind === "accepted") {
              expect(result.orderIndex).toBe(i);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// Property: Canonical Serialization is Stable
// =============================================================================

describe("property: canonical serialization is stable", () => {
  it("serializing the same snapshot twice produces identical output", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            registrar.register({
              from: null,
              to: arbRootState(id),
            });
          }

          const snapshot = registrar.snapshot();
          const json1 = serializeSnapshot(snapshot);
          const json2 = serializeSnapshot(snapshot);

          expect(json1).toBe(json2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("checksum is deterministic for the same state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            registrar.register({
              from: null,
              to: arbRootState(id),
            });
          }

          const snapshot = registrar.snapshot();
          const hash1 = computeSnapshotChecksum32(snapshot);
          const hash2 = computeSnapshotChecksum32(snapshot);

          expect(hash1).toBe(hash2);
          expect(hash1).toMatch(/^[0-9a-f]{8}$/);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("attestation hash (SHA-256) is deterministic", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            registrar.register({
              from: null,
              to: arbRootState(id),
            });
          }

          const snapshot = registrar.snapshot();
          const sha1 = computeSnapshotHashForAttestation(snapshot);
          const sha2 = computeSnapshotHashForAttestation(snapshot);

          expect(sha1).toBe(sha2);
          expect(sha1).toMatch(/^[0-9a-f]{64}$/);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("canonicalize is idempotent: canonicalize(parse(canonicalize(obj))) === canonicalize(obj)", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 8 }),
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
          ),
          { minKeys: 1, maxKeys: 10 },
        ),
        (obj) => {
          const c1 = canonicalizeForHash(obj);
          const roundtripped = JSON.parse(c1);
          const c2 = canonicalizeForHash(roundtripped);
          expect(c2).toBe(c1);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// =============================================================================
// Property: Snapshot Roundtrip (Replay Determinism)
// =============================================================================

describe("property: snapshot → restore → snapshot is idempotent", () => {
  it("snapshot roundtrip produces identical serialized output", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            registrar.register({
              from: null,
              to: arbRootState(id),
            });
          }

          const snap1 = registrar.snapshot();
          const json1 = serializeSnapshot(snap1);

          // Restore from snapshot
          const restored = StructuralRegistrar.fromSnapshot(snap1, {
            mode: "legacy",
            invariants: INITIAL_INVARIANTS,
          });

          const snap2 = restored.snapshot();
          const json2 = serializeSnapshot(snap2);

          expect(json2).toBe(json1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("restored registrar has same count and order index", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            registrar.register({
              from: null,
              to: arbRootState(id),
            });
          }

          const snap = registrar.snapshot();
          const restored = StructuralRegistrar.fromSnapshot(snap, {
            mode: "legacy",
            invariants: INITIAL_INVARIANTS,
          });

          expect(restored.getRegisteredCount()).toBe(registrar.getRegisteredCount());
          expect(restored.getCurrentOrderIndex()).toBe(registrar.getCurrentOrderIndex());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("attestation payload is identical before and after restore", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            registrar.register({
              from: null,
              to: arbRootState(id),
            });
          }

          const snap1 = registrar.snapshot();
          const opts = {
            registrumVersion: "0.1.0",
            mode: "legacy-only" as const,
            parityStatus: "AGREED" as const,
            transitionFrom: 0,
            transitionTo: snap1.ordering.max_index,
          };
          const payload1 = generateAttestationPayload(snap1, snap1.registry_hash, opts);

          const restored = StructuralRegistrar.fromSnapshot(snap1, {
            mode: "legacy",
            invariants: INITIAL_INVARIANTS,
          });
          const snap2 = restored.snapshot();
          const payload2 = generateAttestationPayload(snap2, snap2.registry_hash, opts);

          expect(payload2.snapshot_hash).toBe(payload1.snapshot_hash);
          expect(payload2.state_count).toBe(payload1.state_count);
          expect(payload2.ordering_max).toBe(payload1.ordering_max);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property: Invalid Transitions are Always Rejected (Fail-Closed)
// =============================================================================

describe("property: fail-closed — invalid transitions never succeed", () => {
  it("empty state ID is always rejected", () => {
    fc.assert(
      fc.property(fc.constant(undefined), () => {
        const registrar = createLegacyRegistrar();
        const result = registrar.register({
          from: null,
          to: { id: "", structure: { isRoot: true }, data: null },
        });
        expect(result.kind).toBe("rejected");
      }),
      { numRuns: 1 },
    );
  });

  it("non-root state without parent declaration is rejected", () => {
    fc.assert(
      fc.property(
        arbStateId,
        (id) => {
          const registrar = createLegacyRegistrar();
          // from=null but isRoot not set → lineage.explicit violation
          const result = registrar.register({
            from: null,
            to: { id, structure: {}, data: null },
          });
          expect(result.kind).toBe("rejected");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("referencing non-existent parent is rejected", () => {
    fc.assert(
      fc.property(
        arbStateId,
        arbStateId,
        (childId, parentId) => {
          const registrar = createLegacyRegistrar();
          // Parent doesn't exist in registry
          const result = registrar.register({
            from: parentId,
            to: { id: parentId, structure: {}, data: null },
          });
          expect(result.kind).toBe("rejected");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("duplicate root state ID is rejected (halt)", () => {
    fc.assert(
      fc.property(
        arbStateId,
        (id) => {
          const registrar = createLegacyRegistrar();

          // First registration succeeds
          const r1 = registrar.register({
            from: null,
            to: arbRootState(id),
          });
          expect(r1.kind).toBe("accepted");

          // Second registration with same ID fails
          const r2 = registrar.register({
            from: null,
            to: arbRootState(id),
          });
          expect(r2.kind).toBe("rejected");
          if (r2.kind === "rejected") {
            const hasHalt = r2.violations.some((v) =>
              v.classification === "HALT",
            );
            expect(hasHalt).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property: Lineage Traces are Accurate
// =============================================================================

describe("property: lineage traces", () => {
  it("root states have lineage of length 1 (just themselves)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          for (const id of ids) {
            registrar.register({
              from: null,
              to: arbRootState(id),
            });
          }

          for (const id of ids) {
            const lineage = registrar.getLineage(id);
            expect(lineage.length).toBe(1);
            expect(lineage[0]).toBe(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a same-id version transition appends to lineage (append-only)", () => {
    fc.assert(
      fc.property(
        arbStateId,
        (rootId) => {
          const registrar = createLegacyRegistrar();

          // Register root (version 1)
          registrar.register({
            from: null,
            to: arbRootState(rootId),
          });

          // Same-id version transition (from: rootId, to.id: rootId) → version 2.
          // Append-only: this MUST NOT overwrite v1; it records a new version
          // whose parent is the prior version.
          registrar.register(arbChildTransition(rootId));

          // Lineage now contains BOTH versions of the same id, newest first.
          const lineage = registrar.getLineage(rootId);
          expect(lineage.length).toBe(2);
          expect(lineage[0]).toBe(rootId);
          expect(lineage[1]).toBe(rootId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("v1 → v2 → v3 on one id yields a 3-entry lineage in newest-first order", () => {
    const registrar = createLegacyRegistrar();
    const id = "entity";

    // v1: root
    const r1 = registrar.register({ from: null, to: arbRootState(id) });
    expect(r1.kind).toBe("accepted");

    // v2: same-id transition
    const r2 = registrar.register(arbChildTransition(id));
    expect(r2.kind).toBe("accepted");

    // v3: same-id transition
    const r3 = registrar.register(arbChildTransition(id));
    expect(r3.kind).toBe("accepted");

    // Lineage walks the full version chain (3 entries), all the same id.
    const lineage = registrar.getLineage(id);
    expect(lineage.length).toBe(3);
    expect(lineage).toEqual([id, id, id]);

    // Order indices are strictly increasing across versions (append-only history).
    if (r1.kind === "accepted" && r2.kind === "accepted" && r3.kind === "accepted") {
      expect(r1.orderIndex).toBeLessThan(r2.orderIndex);
      expect(r2.orderIndex).toBeLessThan(r3.orderIndex);
    }
  });

  // V3-001: prove register() is NON-DESTRUCTIVE on the prior entry directly —
  // i.e. the ORIGINAL v1 version's identity (orderIndex + parent link) is left
  // UNCHANGED, not merely that a new entry was appended somewhere.
  //
  // To make this a direct (not transitive) proof, an UNRELATED root is
  // registered between v1 and v2 so that v2.orderIndex is NOT v1.orderIndex + 1.
  // A hypothetical destructive register() that rewrote the same-id slot in place
  // would have to either reuse v1's index (collapsing the chain) or overwrite
  // v1's index with v2's (orphaning the lineage). The lineage walk below is the
  // public window into the version chain: it starts at the frontier (v2) and
  // follows each entry's stored parentKey back to a null-parented root. It can
  // only return [id, id] if BOTH versions still exist as distinct entries AND
  // v1 still carries its ORIGINAL orderIndex (so v2's parentKey resolves to it)
  // AND v1's parentKey is still null (so the walk terminates at a root rather
  // than truncating or cycling).
  it("register() leaves the prior version's orderIndex and parent link UNCHANGED (V3-001)", () => {
    const registrar = createLegacyRegistrar();
    const id = "doc";

    // v1: root version of `id`. Capture its assigned orderIndex.
    const v1 = registrar.register({ from: null, to: arbRootState(id) });
    expect(v1.kind).toBe("accepted");
    if (v1.kind !== "accepted") return;
    const v1OrderIndex = v1.orderIndex;
    expect(v1OrderIndex).toBe(0);

    // v1 is a born-root: its lineage is exactly itself (parentKey === null).
    expect(registrar.getLineage(id)).toEqual([id]);

    // Register an UNRELATED root in between. This advances the global cursor so
    // that v2 will NOT be assigned v1OrderIndex + 1 — defeating any "overwrite
    // the same-id slot with the next index" shortcut.
    const other = registrar.register({ from: null, to: arbRootState("other") });
    expect(other.kind).toBe("accepted");

    // v2: a SAME-id transition on `id`. Append-only — must record a new version
    // and mutate NOTHING in v1's entry.
    const v2 = registrar.register(arbChildTransition(id));
    expect(v2.kind).toBe("accepted");
    if (v2.kind !== "accepted") return;

    // v2 got a fresh, strictly-greater, NON-adjacent index (proves the unrelated
    // registration sat between the two versions of `id`).
    expect(v2.orderIndex).toBeGreaterThan(v1OrderIndex);
    expect(v2.orderIndex).not.toBe(v1OrderIndex + 1);

    // Both versions of `id` are retained (append-only): 2 distinct id frontiers
    // (`id`, `other`) but 3 total versions across history.
    expect(registrar.getRegisteredCount()).toBe(2);
    expect(registrar.getVersionCount()).toBe(3);

    // The ORIGINAL v1 entry is still individually retrievable with its identity
    // intact. The frontier (v2) → parentKey → v1 → null walk yields exactly
    // [id, id]; this is only possible if v1 still has orderIndex v1OrderIndex
    // (so v2's parentKey `id#${v1OrderIndex}` resolves to it) and v1's parentKey
    // is still null (so the chain terminates at a root). A destructive register
    // would have broken one of those, changing the walk.
    expect(registrar.getLineage(id)).toEqual([id, id]);

    // A snapshot taken now still projects v1's order index as the frontier's
    // ancestor cursor base — the original index was never reused or rewritten.
    const snap = registrar.snapshot();
    // The frontier for `id` is v2; its cross-id parent is null (born-root chain).
    expect(snap.lineage[id]).toBe(null);
    // `other`'s index is strictly between v1's and v2's, confirming v1's index
    // (0) was untouched while the cursor marched forward independently.
    expect(snap.ordering.assigned["other"]).toBeGreaterThan(v1OrderIndex);
    expect(snap.ordering.assigned["other"]).toBeLessThan(v2.orderIndex);
  });
});

// =============================================================================
// Property: Different States Produce Different Hashes
// =============================================================================

describe("property: different states → different hashes (collision resistance)", () => {
  it("adding one more state changes the snapshot hash", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((n) => arbUniqueIds(n)),
        (ids) => {
          const registrar = createLegacyRegistrar();

          // Register all but last
          for (let i = 0; i < ids.length - 1; i++) {
            registrar.register({
              from: null,
              to: arbRootState(ids[i]!),
            });
          }
          const hash1 = computeSnapshotChecksum32(registrar.snapshot());

          // Register the last
          registrar.register({
            from: null,
            to: arbRootState(ids[ids.length - 1]!),
          });
          const hash2 = computeSnapshotChecksum32(registrar.snapshot());

          expect(hash1).not.toBe(hash2);
        },
      ),
      { numRuns: 200 },
    );
  });
});
