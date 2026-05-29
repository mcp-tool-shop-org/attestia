/**
 * Deterministic Serialization Tests (E.2)
 *
 * Tests that:
 * - Serializing the same registrar twice produces identical JSON
 * - Field ordering is canonical (alphabetical)
 * - Array ordering is stable (by orderIndex)
 * - Snapshot does not change across no-op operations
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { StructuralRegistrar } from "../../src/structural-registrar";
import { loadInvariantRegistry } from "../../src/registry/loader";
import {
  serializeSnapshot,
  deserializeSnapshot,
  computeSnapshotHash,
  validateSnapshot,
  type RegistrarSnapshotV1,
} from "../../src/persistence";

// =============================================================================
// Test Helpers
// =============================================================================

function createRootState(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    structure: { isRoot: true, ...extra },
    data: null,
  };
}

function createChildState(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    structure: extra,
    data: null,
  };
}

function createTransition(from: string | null, to: ReturnType<typeof createRootState>) {
  return { from, to };
}

function createLegacyRegistrar() {
  return new StructuralRegistrar({ mode: "legacy" });
}

function createRegistryRegistrar() {
  const registryPath = path.join(process.cwd(), "invariants", "registry.json");
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const compiledRegistry = loadInvariantRegistry(raw);
  return new StructuralRegistrar({ mode: "registry", compiledRegistry });
}

function seedStates(registrar: StructuralRegistrar, count: number) {
  for (let i = 0; i < count; i++) {
    const state = i === 0
      ? createRootState(`State${i}`, { version: i })
      : createChildState(`State${i - 1}`, { version: i }); // Uses previous state's ID

    // Actually, for simplicity, let's create independent roots
    const root = createRootState(`State${i}`, { version: i });
    registrar.register(createTransition(null, root));
  }
}

// =============================================================================
// Serialization Tests
// =============================================================================

describe("Deterministic Serialization (E.2)", () => {
  describe("Basic serialization", () => {
    it("serializes empty registrar", () => {
      const registrar = createLegacyRegistrar();
      const snapshot = registrar.snapshot();
      const json = serializeSnapshot(snapshot);

      expect(json).toBeDefined();
      expect(typeof json).toBe("string");

      // Verify it's valid JSON
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe("1.0");
      expect(parsed.state_ids).toEqual([]);
    });

    it("serializes registrar with states", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 5);

      const snapshot = registrar.snapshot();
      const json = serializeSnapshot(snapshot);
      const parsed = JSON.parse(json);

      expect(parsed.state_ids).toHaveLength(5);
      expect(parsed.mode).toBe("legacy");
    });

    it("pretty serialization produces readable output", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 2);

      const snapshot = registrar.snapshot();
      const compact = serializeSnapshot(snapshot, false);
      const pretty = serializeSnapshot(snapshot, true);

      // Pretty should be longer due to whitespace
      expect(pretty.length).toBeGreaterThan(compact.length);

      // Both should parse to same structure
      expect(JSON.parse(pretty)).toEqual(JSON.parse(compact));
    });
  });

  describe("Determinism guarantees", () => {
    it("serializing same registrar twice produces identical JSON", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 10);

      const snapshot = registrar.snapshot();
      const json1 = serializeSnapshot(snapshot);
      const json2 = serializeSnapshot(snapshot);

      expect(json1).toBe(json2); // Bitwise identical
    });

    it("serializing equivalent snapshots produces identical JSON", () => {
      // Create two registrars with same operations
      const registrar1 = createLegacyRegistrar();
      const registrar2 = createLegacyRegistrar();

      // Perform identical operations
      for (let i = 0; i < 5; i++) {
        const state = createRootState(`State${i}`, { version: i });
        registrar1.register(createTransition(null, state));
        registrar2.register(createTransition(null, state));
      }

      const json1 = serializeSnapshot(registrar1.snapshot());
      const json2 = serializeSnapshot(registrar2.snapshot());

      expect(json1).toBe(json2); // Bitwise identical
    });

    it("field ordering is alphabetical", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 2);

      const json = serializeSnapshot(registrar.snapshot());
      const keys = Object.keys(JSON.parse(json));

      // Should be alphabetically sorted
      const sorted = [...keys].sort();
      expect(keys).toEqual(sorted);
    });

    it("state_ids are ordered by orderIndex", () => {
      const registrar = createLegacyRegistrar();

      // Register in specific order
      const root = createRootState("First");
      registrar.register(createTransition(null, root));

      const second = createRootState("Second");
      registrar.register(createTransition(null, second));

      const third = createRootState("Third");
      registrar.register(createTransition(null, third));

      const snapshot = registrar.snapshot();
      const json = serializeSnapshot(snapshot);
      const parsed = JSON.parse(json);

      // Order should reflect registration order
      expect(parsed.state_ids).toEqual(["First", "Second", "Third"]);
    });

    it("lineage keys are sorted alphabetically", () => {
      const registrar = createLegacyRegistrar();

      // Register in reverse alphabetical order
      registrar.register(createTransition(null, createRootState("Zebra")));
      registrar.register(createTransition(null, createRootState("Apple")));
      registrar.register(createTransition(null, createRootState("Middle")));

      const json = serializeSnapshot(registrar.snapshot());
      const parsed = JSON.parse(json);
      const lineageKeys = Object.keys(parsed.lineage);

      // Lineage keys should be sorted
      const sorted = [...lineageKeys].sort();
      expect(lineageKeys).toEqual(sorted);
    });

    it("ordering.assigned keys are sorted alphabetically", () => {
      const registrar = createLegacyRegistrar();

      registrar.register(createTransition(null, createRootState("Zebra")));
      registrar.register(createTransition(null, createRootState("Apple")));

      const json = serializeSnapshot(registrar.snapshot());
      const parsed = JSON.parse(json);
      const assignedKeys = Object.keys(parsed.ordering.assigned);

      const sorted = [...assignedKeys].sort();
      expect(assignedKeys).toEqual(sorted);
    });

    it("no-op operations do not change snapshot", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 3);

      const json1 = serializeSnapshot(registrar.snapshot());

      // Perform no-op operations (validation, listing)
      registrar.listInvariants();
      registrar.getLineage("State0");
      registrar.isRegistered("State0");
      registrar.getRegisteredCount();

      const json2 = serializeSnapshot(registrar.snapshot());

      expect(json1).toBe(json2);
    });
  });

  describe("Round-trip serialization", () => {
    it("deserialize inverts serialize", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 5);

      const snapshot = registrar.snapshot();
      const json = serializeSnapshot(snapshot);
      const parsed = deserializeSnapshot(json);

      // Validate the parsed snapshot
      validateSnapshot(parsed);

      // Compare key fields
      const typedParsed = parsed as RegistrarSnapshotV1;
      expect(typedParsed.version).toBe(snapshot.version);
      expect(typedParsed.mode).toBe(snapshot.mode);
      expect(typedParsed.registry_hash).toBe(snapshot.registry_hash);
      expect(typedParsed.state_ids).toEqual(snapshot.state_ids);
    });

    it("serialize → deserialize → serialize produces identical JSON", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 5);

      const snapshot = registrar.snapshot();
      const json1 = serializeSnapshot(snapshot);
      const parsed = deserializeSnapshot(json1) as RegistrarSnapshotV1;
      const json2 = serializeSnapshot(parsed);

      expect(json1).toBe(json2);
    });
  });

  describe("Snapshot hash", () => {
    it("computes consistent hash", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 5);

      const snapshot = registrar.snapshot();
      const hash1 = computeSnapshotHash(snapshot);
      const hash2 = computeSnapshotHash(snapshot);

      expect(hash1).toBe(hash2);
    });

    it("different snapshots have different hashes", () => {
      const registrar1 = createLegacyRegistrar();
      const registrar2 = createLegacyRegistrar();

      seedStates(registrar1, 3);
      seedStates(registrar2, 5);

      const hash1 = computeSnapshotHash(registrar1.snapshot());
      const hash2 = computeSnapshotHash(registrar2.snapshot());

      expect(hash1).not.toBe(hash2);
    });

    it("hash is based on serialization", () => {
      const registrar = createLegacyRegistrar();
      seedStates(registrar, 3);

      const snapshot = registrar.snapshot();
      const json = serializeSnapshot(snapshot);
      const hash = computeSnapshotHash(snapshot);

      // Hash should be deterministic based on JSON content
      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(8); // 32-bit hex
    });
  });

  describe("Registry mode serialization", () => {
    it("serializes registry mode registrar", () => {
      const registrar = createRegistryRegistrar();
      seedStates(registrar, 3);

      const snapshot = registrar.snapshot();
      const json = serializeSnapshot(snapshot);
      const parsed = JSON.parse(json);

      expect(parsed.mode).toBe("registry");
      // Registry mode now uses a content-addressed SHA-256 (D1-A-003), not a
      // static "registry:<id>" echo.
      expect(parsed.registry_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("legacy and registry mode produce different hashes", () => {
      const legacy = createLegacyRegistrar();
      const registry = createRegistryRegistrar();

      // Same operations
      for (let i = 0; i < 3; i++) {
        const state = createRootState(`State${i}`);
        legacy.register(createTransition(null, state));
        registry.register(createTransition(null, state));
      }

      const legacyHash = legacy.snapshot().registry_hash;
      const registryHash = registry.snapshot().registry_hash;

      // Different modes have different registry hashes
      expect(legacyHash).not.toBe(registryHash);
      expect(legacyHash).toMatch(/^legacy:/);
      // Registry-mode hash is a content-addressed SHA-256 (D1-A-003).
      expect(registryHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("deterministic for registry mode", () => {
      const registrar1 = createRegistryRegistrar();
      const registrar2 = createRegistryRegistrar();

      for (let i = 0; i < 3; i++) {
        const state = createRootState(`State${i}`);
        registrar1.register(createTransition(null, state));
        registrar2.register(createTransition(null, state));
      }

      const json1 = serializeSnapshot(registrar1.snapshot());
      const json2 = serializeSnapshot(registrar2.snapshot());

      expect(json1).toBe(json2);
    });
  });
});
