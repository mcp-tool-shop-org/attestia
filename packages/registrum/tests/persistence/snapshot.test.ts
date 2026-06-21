/**
 * Snapshot Schema Tests (E.1)
 *
 * Tests that the snapshot schema:
 * - Validates all required fields
 * - Rejects unknown fields (strict mode)
 * - Rejects missing fields
 * - Validates internal consistency
 */

import { describe, it, expect } from "vitest";
import {
  validateSnapshot,
  SnapshotValidationError,
  SNAPSHOT_VERSION,
  computeLegacyRegistryHash,
  computeRegistryHash,
  type RegistrarSnapshotV1,
} from "../../src/persistence/snapshot";
import { loadInvariantRegistry } from "../../src/registry/loader";
import type { RawInvariantRegistry } from "../../src/registry/loader";

// A minimal, well-formed raw registry used for content-hash tests.
function rawRegistry(
  registryId: string,
  expression: string
): RawInvariantRegistry {
  return {
    version: "1.0",
    registry_id: registryId,
    status: "experimental",
    invariants: [
      {
        id: "state.identity.explicit",
        group: "identity",
        scope: "state",
        description: "Every State must declare an explicit identity.",
        applies_to: ["state.id"],
        condition: { type: "predicate", expression },
        failure_mode: "reject",
      },
    ],
  };
}

// =============================================================================
// Test Helpers
// =============================================================================

function createValidSnapshot(
  overrides: Partial<RegistrarSnapshotV1> = {}
): RegistrarSnapshotV1 {
  return {
    version: SNAPSHOT_VERSION,
    registry_hash: "legacy:inv1,inv2,inv3",
    mode: "legacy",
    state_ids: ["A", "B"],
    lineage: { A: null, B: "A" },
    ordering: {
      max_index: 1,
      assigned: { A: 0, B: 1 },
    },
    ...overrides,
  };
}

function createEmptySnapshot(): RegistrarSnapshotV1 {
  return {
    version: SNAPSHOT_VERSION,
    registry_hash: "legacy:inv1,inv2",
    mode: "legacy",
    state_ids: [],
    lineage: {},
    ordering: {
      max_index: -1,
      assigned: {},
    },
  };
}

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("Snapshot Schema Validation (E.1)", () => {
  describe("Valid snapshots", () => {
    it("accepts a valid snapshot", () => {
      const snapshot = createValidSnapshot();
      expect(() => validateSnapshot(snapshot)).not.toThrow();
    });

    it("accepts an empty snapshot", () => {
      const snapshot = createEmptySnapshot();
      expect(() => validateSnapshot(snapshot)).not.toThrow();
    });

    it("accepts snapshot with registry mode", () => {
      const snapshot = createValidSnapshot({
        mode: "registry",
        registry_hash: "registry:registrum.invariants.v1",
      });
      expect(() => validateSnapshot(snapshot)).not.toThrow();
    });

    it("accepts snapshot with many states", () => {
      const stateIds = Array.from({ length: 100 }, (_, i) => `State${i}`);
      const lineage: Record<string, string | null> = {};
      const assigned: Record<string, number> = {};

      stateIds.forEach((id, index) => {
        lineage[id] = index === 0 ? null : stateIds[index - 1];
        assigned[id] = index;
      });

      const snapshot = createValidSnapshot({
        state_ids: stateIds,
        lineage,
        ordering: {
          max_index: 99,
          assigned,
        },
      });

      expect(() => validateSnapshot(snapshot)).not.toThrow();
    });
  });

  describe("Type validation", () => {
    it("rejects non-object", () => {
      expect(() => validateSnapshot(null)).toThrow(SnapshotValidationError);
      expect(() => validateSnapshot("string")).toThrow(SnapshotValidationError);
      expect(() => validateSnapshot(123)).toThrow(SnapshotValidationError);
      expect(() => validateSnapshot([])).toThrow(SnapshotValidationError);
    });

    it("rejects wrong version", () => {
      const snapshot = { ...createValidSnapshot(), version: "2.0" };
      // Fail-closed for an unsupported version; the message is humanized in
      // Stage C (RT-B-002/009) — it names the version and carries an actionable
      // hint (migrate / replay / upgrade) rather than a bare rejection.
      expect(() => validateSnapshot(snapshot)).toThrow(
        /Unsupported snapshot version/
      );
      expect(() => validateSnapshot(snapshot)).toThrow(/Hint:/);
    });

    it("rejects empty registry_hash", () => {
      const snapshot = { ...createValidSnapshot(), registry_hash: "" };
      expect(() => validateSnapshot(snapshot)).toThrow(/registry_hash/);
    });

    it("rejects non-string registry_hash", () => {
      const snapshot = { ...createValidSnapshot(), registry_hash: 123 };
      expect(() => validateSnapshot(snapshot)).toThrow(/registry_hash/);
    });

    it("rejects invalid mode", () => {
      const snapshot = { ...createValidSnapshot(), mode: "invalid" };
      expect(() => validateSnapshot(snapshot)).toThrow(/mode/);
    });

    it("rejects non-array state_ids", () => {
      const snapshot = { ...createValidSnapshot(), state_ids: "not-array" };
      expect(() => validateSnapshot(snapshot)).toThrow(/state_ids/);
    });

    it("rejects non-string in state_ids", () => {
      const snapshot = { ...createValidSnapshot(), state_ids: ["A", 123] };
      expect(() => validateSnapshot(snapshot)).toThrow(/state_ids\[1\]/);
    });

    it("rejects non-object lineage", () => {
      const snapshot = { ...createValidSnapshot(), lineage: "not-object" };
      expect(() => validateSnapshot(snapshot)).toThrow(/lineage/);
    });

    it("rejects invalid lineage value", () => {
      const snapshot = {
        ...createValidSnapshot(),
        lineage: { A: null, B: 123 },
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/lineage\['B'\]/);
    });

    it("rejects non-integer max_index", () => {
      const snapshot = {
        ...createValidSnapshot(),
        ordering: { ...createValidSnapshot().ordering, max_index: 1.5 },
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/max_index/);
    });

    it("rejects non-integer order index", () => {
      const snapshot = {
        ...createValidSnapshot(),
        ordering: {
          max_index: 1,
          assigned: { A: 0, B: 1.5 },
        },
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/ordering\.assigned\['B'\]/);
    });
  });

  describe("Unknown field rejection (strict mode)", () => {
    it("rejects unknown top-level fields", () => {
      const snapshot = {
        ...createValidSnapshot(),
        unknown_field: "value",
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/Unknown field 'unknown_field'/);
    });

    it("rejects derived metrics", () => {
      const snapshot = {
        ...createValidSnapshot(),
        state_count: 2, // Derived metric - forbidden
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/Unknown field/);
    });

    it("rejects summaries", () => {
      const snapshot = {
        ...createValidSnapshot(),
        lineage_summary: { depth: 2 }, // Summary - forbidden
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/Unknown field/);
    });

    it("rejects caches", () => {
      const snapshot = {
        ...createValidSnapshot(),
        lookup_cache: {}, // Cache - forbidden
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/Unknown field/);
    });

    it("rejects replay hints", () => {
      const snapshot = {
        ...createValidSnapshot(),
        replay_hint: "fast-path", // Hint - forbidden
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/Unknown field/);
    });

    it("rejects timestamps", () => {
      const snapshot = {
        ...createValidSnapshot(),
        created_at: Date.now(), // Timestamp - forbidden
      };
      expect(() => validateSnapshot(snapshot)).toThrow(/Unknown field/);
    });
  });

  describe("Missing field rejection", () => {
    it("rejects missing version", () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as Record<string, unknown>).version;
      expect(() => validateSnapshot(snapshot)).toThrow(/version/);
    });

    it("rejects missing registry_hash", () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as Record<string, unknown>).registry_hash;
      expect(() => validateSnapshot(snapshot)).toThrow(/registry_hash/);
    });

    it("rejects missing mode", () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as Record<string, unknown>).mode;
      expect(() => validateSnapshot(snapshot)).toThrow(/mode/);
    });

    it("rejects missing state_ids", () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as Record<string, unknown>).state_ids;
      expect(() => validateSnapshot(snapshot)).toThrow(/state_ids/);
    });

    it("rejects missing lineage", () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as Record<string, unknown>).lineage;
      expect(() => validateSnapshot(snapshot)).toThrow(/lineage/);
    });

    it("rejects missing ordering", () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as Record<string, unknown>).ordering;
      expect(() => validateSnapshot(snapshot)).toThrow(/ordering/);
    });
  });

  describe("Consistency validation", () => {
    it("rejects state_id without lineage entry", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B", "C"],
        lineage: { A: null, B: "A" }, // Missing C
        ordering: {
          max_index: 2,
          assigned: { A: 0, B: 1, C: 2 },
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(/State 'C'.*no lineage/);
    });

    it("rejects lineage entry without state_id", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B"],
        lineage: { A: null, B: "A", C: "A" }, // Extra C
        ordering: {
          max_index: 1,
          assigned: { A: 0, B: 1 },
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(/Lineage entry 'C'.*no corresponding/);
    });

    it("rejects lineage parent that does not exist", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B"],
        lineage: { A: null, B: "NonExistent" }, // Invalid parent
        ordering: {
          max_index: 1,
          assigned: { A: 0, B: 1 },
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(/parent 'NonExistent'.*does not exist/);
    });

    // --- Root-reachability and cycle detection (D1-A-004) ---
    // Parent-existence alone is not enough: a lineage where every parent
    // exists can still be unreachable from any root (a cycle). Such a snapshot
    // describes an impossible append-only history and must be rejected.

    it("rejects a 2-node lineage cycle with no root (A->B->A)", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B"],
        lineage: { A: "B", B: "A" }, // every parent exists, but no root
        ordering: {
          max_index: 1,
          assigned: { A: 0, B: 1 },
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(SnapshotValidationError);
      expect(() => validateSnapshot(snapshot)).toThrow(/cycle|root/i);
    });

    it("rejects a self-parent cycle (A->A)", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A"],
        lineage: { A: "A" }, // A is its own parent — never terminates at root
        ordering: { max_index: 0, assigned: { A: 0 } },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(SnapshotValidationError);
      expect(() => validateSnapshot(snapshot)).toThrow(/cycle|root/i);
    });

    it("rejects a longer cycle embedded among valid roots (A->B->C->A)", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["Root", "A", "B", "C"],
        lineage: { Root: null, A: "B", B: "C", C: "A" },
        ordering: {
          max_index: 3,
          assigned: { Root: 0, A: 1, B: 2, C: 3 },
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(SnapshotValidationError);
      expect(() => validateSnapshot(snapshot)).toThrow(/cycle|root/i);
    });

    it("accepts a valid chain that terminates at a null-parent root", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B", "C"],
        lineage: { A: null, B: "A", C: "B" }, // A is root; B, C reachable
        ordering: {
          max_index: 2,
          assigned: { A: 0, B: 1, C: 2 },
        },
      });
      expect(() => validateSnapshot(snapshot)).not.toThrow();
    });

    it("accepts a forest of independent roots", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["R1", "R2", "C1"],
        lineage: { R1: null, R2: null, C1: "R1" },
        ordering: {
          max_index: 2,
          assigned: { R1: 0, R2: 1, C1: 2 },
        },
      });
      expect(() => validateSnapshot(snapshot)).not.toThrow();
    });

    it("rejects state_id without ordering entry", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B", "C"],
        lineage: { A: null, B: "A", C: "B" },
        ordering: {
          max_index: 2,
          assigned: { A: 0, B: 1 }, // Missing C
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(/State 'C'.*no ordering/);
    });

    it("rejects ordering entry without state_id", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B"],
        lineage: { A: null, B: "A" },
        ordering: {
          max_index: 2,
          assigned: { A: 0, B: 1, C: 2 }, // Extra C
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(/Ordering entry 'C'.*no corresponding/);
    });

    it("rejects incorrect max_index", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B"],
        lineage: { A: null, B: "A" },
        ordering: {
          max_index: 5, // Wrong - highest assigned is 1
          assigned: { A: 0, B: 1 },
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(/max_index.*should equal highest assigned/);
    });

    it("rejects duplicate order indices", () => {
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B"],
        lineage: { A: null, B: "A" },
        ordering: {
          max_index: 0,
          assigned: { A: 0, B: 0 }, // Duplicate
        },
      });
      expect(() => validateSnapshot(snapshot)).toThrow(/Order indices must be unique/);
    });

    it("accepts non-contiguous order indices", () => {
      // This is valid: the snapshot projects the live frontier (latest version
      // per StateID). When an id gains a new append-only version, its frontier
      // order index advances, leaving gaps relative to other ids' indices.
      const snapshot = createValidSnapshot({
        state_ids: ["A", "B"],
        lineage: { A: null, B: "A" },
        ordering: {
          max_index: 5, // Highest assigned is 5
          assigned: { A: 2, B: 5 }, // Gap is OK
        },
      });
      expect(() => validateSnapshot(snapshot)).not.toThrow();
    });
  });
});

// =============================================================================
// Registry Hash Tests
// =============================================================================

describe("Registry Hash Computation", () => {
  describe("Legacy mode hash", () => {
    it("computes deterministic hash from invariant IDs", () => {
      const hash1 = computeLegacyRegistryHash(["a", "b", "c"]);
      const hash2 = computeLegacyRegistryHash(["a", "b", "c"]);
      expect(hash1).toBe(hash2);
    });

    it("sorts IDs for determinism", () => {
      const hash1 = computeLegacyRegistryHash(["c", "a", "b"]);
      const hash2 = computeLegacyRegistryHash(["a", "b", "c"]);
      expect(hash1).toBe(hash2);
    });

    it("includes legacy prefix", () => {
      const hash = computeLegacyRegistryHash(["inv1"]);
      expect(hash).toMatch(/^legacy:/);
    });

    it("produces different hashes for different invariants", () => {
      const hash1 = computeLegacyRegistryHash(["a", "b"]);
      const hash2 = computeLegacyRegistryHash(["a", "c"]);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Registry mode hash (content-addressed, D1-A-003)", () => {
    it("is a hex-encoded SHA-256 of the compiled registry content", () => {
      const reg = loadInvariantRegistry(
        rawRegistry("registrum.invariants.v1", "exists(state.id)")
      );
      const hash = computeRegistryHash(reg);
      // 64 lowercase hex chars — a real content digest, not a static id echo.
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toContain("registrum.invariants.v1");
    });

    it("is deterministic for identical registry content", () => {
      const a = loadInvariantRegistry(rawRegistry("same", "exists(state.id)"));
      const b = loadInvariantRegistry(rawRegistry("same", "exists(state.id)"));
      expect(computeRegistryHash(a)).toBe(computeRegistryHash(b));
    });

    it("CHANGES when a predicate expression changes (constitutional drift)", () => {
      // Same registry_id, same invariant id — only the predicate differs.
      // A static-id hash would collide here; a content hash must not.
      const original = loadInvariantRegistry(
        rawRegistry("registrum.core", "exists(state.id)")
      );
      const tampered = loadInvariantRegistry(
        rawRegistry("registrum.core", "exists(state.id) && state.id != \"\"")
      );
      expect(computeRegistryHash(original)).not.toBe(
        computeRegistryHash(tampered)
      );
    });

    it("changes when failure_mode changes", () => {
      const reject = loadInvariantRegistry(rawRegistry("r", "exists(state.id)"));
      const rawHalt = rawRegistry("r", "exists(state.id)");
      const haltRegistry = loadInvariantRegistry({
        ...rawHalt,
        invariants: [{ ...rawHalt.invariants[0], failure_mode: "halt" }],
      });
      expect(computeRegistryHash(reject)).not.toBe(
        computeRegistryHash(haltRegistry)
      );
    });

    it("produces different hashes for genuinely different registries", () => {
      const v1 = loadInvariantRegistry(rawRegistry("v1", "exists(state.id)"));
      const v2 = loadInvariantRegistry(
        rawRegistry("v2", "exists(transition.to.id)")
      );
      expect(computeRegistryHash(v1)).not.toBe(computeRegistryHash(v2));
    });
  });
});
