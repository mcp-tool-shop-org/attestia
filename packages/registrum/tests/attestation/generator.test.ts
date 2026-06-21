/**
 * Attestation Generator Tests
 *
 * Tests for attestation payload generation.
 * Verifies determinism, correctness, and format compliance.
 */

import { describe, it, expect } from "vitest";
import type { RegistrarSnapshotV1 } from "../../src/persistence/snapshot.js";
import {
  generateAttestationPayload,
  computeSnapshotHashForAttestation,
  canonicalizeForHash,
  serializeAttestationPayload,
  computeAttestationHash,
  toAttestationMode,
  encodeAsXrplMemos,
  decodeXrplMemos,
  validateAttestationPayload,
  verifyAttestationBinding,
  REGISTRUM_VERSION,
} from "../../src/attestation/index.js";
import type { AttestationPayload } from "../../src/attestation/index.js";

// Test fixtures
const createTestSnapshot = (): RegistrarSnapshotV1 => ({
  version: 1,
  registry_hash: "abc123def456".padEnd(64, "0"),
  mode: "dual",
  state_ids: ["state-1", "state-2", "state-3"],
  lineage: {
    "state-1": null,
    "state-2": "state-1",
    "state-3": "state-2",
  },
  ordering: {
    max_index: 2,
    assigned: {
      "state-1": 0,
      "state-2": 1,
      "state-3": 2,
    },
  },
});

// The generator now fail-closed binds the attestation's registry_hash to the
// snapshot's own registry_hash (A-REG-001). The test registry hash MUST equal
// the snapshot fixture's registry_hash, otherwise generateAttestationPayload
// correctly refuses to stamp a forged constitution binding. (Previously these
// differed, which silently produced a mismatched binding.)
const TEST_REGISTRY_HASH = createTestSnapshot().registry_hash;

describe("Attestation Generator", () => {
  describe("generateAttestationPayload", () => {
    it("generates valid attestation payload from snapshot", () => {
      const snapshot = createTestSnapshot();
      const payload = generateAttestationPayload(snapshot, TEST_REGISTRY_HASH, {
        registrumVersion: REGISTRUM_VERSION,
        mode: "dual",
        parityStatus: "AGREED",
        transitionFrom: 0,
        transitionTo: 100,
      });

      expect(payload.registrum_version).toBe(REGISTRUM_VERSION);
      expect(payload.snapshot_version).toBe("1");
      expect(payload.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(payload.registry_hash).toBe(TEST_REGISTRY_HASH);
      expect(payload.mode).toBe("dual");
      expect(payload.parity_status).toBe("AGREED");
      expect(payload.transition_range).toEqual({ from: 0, to: 100 });
      expect(payload.state_count).toBe(3);
      expect(payload.ordering_max).toBe(2);
    });

    it("produces deterministic output for same input", () => {
      const snapshot = createTestSnapshot();
      const options = {
        registrumVersion: REGISTRUM_VERSION,
        mode: "dual" as const,
        parityStatus: "AGREED" as const,
        transitionFrom: 0,
        transitionTo: 100,
      };

      const payload1 = generateAttestationPayload(snapshot, TEST_REGISTRY_HASH, options);
      const payload2 = generateAttestationPayload(snapshot, TEST_REGISTRY_HASH, options);

      expect(payload1).toEqual(payload2);
      expect(computeAttestationHash(payload1)).toBe(computeAttestationHash(payload2));
    });

    it("produces different output for different snapshots", () => {
      const snapshot1 = createTestSnapshot();
      const snapshot2 = { ...createTestSnapshot(), state_ids: ["different"] };

      const options = {
        registrumVersion: REGISTRUM_VERSION,
        mode: "dual" as const,
        parityStatus: "AGREED" as const,
        transitionFrom: 0,
        transitionTo: 100,
      };

      const payload1 = generateAttestationPayload(snapshot1, TEST_REGISTRY_HASH, options);
      const payload2 = generateAttestationPayload(snapshot2, TEST_REGISTRY_HASH, options);

      expect(payload1.snapshot_hash).not.toBe(payload2.snapshot_hash);
    });
  });

  describe("computeSnapshotHashForAttestation", () => {
    it("produces 64-character hex hash", () => {
      const snapshot = createTestSnapshot();
      const hash = computeSnapshotHashForAttestation(snapshot);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic", () => {
      const snapshot = createTestSnapshot();
      const hash1 = computeSnapshotHashForAttestation(snapshot);
      const hash2 = computeSnapshotHashForAttestation(snapshot);

      expect(hash1).toBe(hash2);
    });

    it("changes with snapshot content", () => {
      const snapshot1 = createTestSnapshot();
      const snapshot2 = { ...createTestSnapshot(), state_ids: ["changed"] };

      const hash1 = computeSnapshotHashForAttestation(snapshot1);
      const hash2 = computeSnapshotHashForAttestation(snapshot2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("canonicalizeForHash", () => {
    it("produces deterministic JSON regardless of key order", () => {
      const obj1 = { z: 1, a: 2, m: 3 };
      const obj2 = { a: 2, z: 1, m: 3 };
      const obj3 = { m: 3, z: 1, a: 2 };

      const canonical1 = canonicalizeForHash(obj1);
      const canonical2 = canonicalizeForHash(obj2);
      const canonical3 = canonicalizeForHash(obj3);

      expect(canonical1).toBe(canonical2);
      expect(canonical2).toBe(canonical3);
    });

    it("sorts nested objects", () => {
      const obj = {
        outer: {
          z: 1,
          a: { z: 2, a: 3 },
        },
      };

      const canonical = canonicalizeForHash(obj);
      const parsed = JSON.parse(canonical);

      // Verify structure is preserved
      expect(parsed.outer.a.a).toBe(3);
      expect(parsed.outer.a.z).toBe(2);
    });

    it("preserves arrays", () => {
      const obj = { arr: [3, 1, 2] };
      const canonical = canonicalizeForHash(obj);
      const parsed = JSON.parse(canonical);

      expect(parsed.arr).toEqual([3, 1, 2]);
    });
  });

  describe("serializeAttestationPayload", () => {
    it("produces valid JSON", () => {
      const snapshot = createTestSnapshot();
      const payload = generateAttestationPayload(snapshot, TEST_REGISTRY_HASH, {
        registrumVersion: REGISTRUM_VERSION,
        mode: "dual",
        parityStatus: "AGREED",
        transitionFrom: 0,
        transitionTo: 100,
      });

      const serialized = serializeAttestationPayload(payload);
      const parsed = JSON.parse(serialized);

      expect(parsed.registrum_version).toBe(payload.registrum_version);
      expect(parsed.snapshot_hash).toBe(payload.snapshot_hash);
    });

    it("is deterministic", () => {
      const snapshot = createTestSnapshot();
      const payload = generateAttestationPayload(snapshot, TEST_REGISTRY_HASH, {
        registrumVersion: REGISTRUM_VERSION,
        mode: "dual",
        parityStatus: "AGREED",
        transitionFrom: 0,
        transitionTo: 100,
      });

      const serialized1 = serializeAttestationPayload(payload);
      const serialized2 = serializeAttestationPayload(payload);

      expect(serialized1).toBe(serialized2);
    });
  });

  describe("toAttestationMode", () => {
    it("returns dual when parity is AGREED", () => {
      expect(toAttestationMode("legacy", "AGREED")).toBe("dual");
      expect(toAttestationMode("registry", "AGREED")).toBe("dual");
    });

    it("returns mode-specific when parity is HALTED", () => {
      expect(toAttestationMode("legacy", "HALTED")).toBe("legacy-only");
      expect(toAttestationMode("registry", "HALTED")).toBe("registry-only");
    });
  });

  describe("XRPL Memo Encoding", () => {
    const createTestPayload = (): AttestationPayload => ({
      registrum_version: "1.0.0",
      snapshot_version: "1",
      snapshot_hash: "a".repeat(64),
      registry_hash: "b".repeat(64),
      mode: "dual",
      parity_status: "AGREED",
      transition_range: { from: 0, to: 100 },
      state_count: 10,
      ordering_max: 9,
    });

    it("encodes all fields as memos", () => {
      const payload = createTestPayload();
      const memos = encodeAsXrplMemos(payload);

      expect(memos.Memos.length).toBe(9);
    });

    it("encodes memo types as hex", () => {
      const payload = createTestPayload();
      const memos = encodeAsXrplMemos(payload);

      for (const { Memo } of memos.Memos) {
        expect(Memo.MemoType).toMatch(/^[0-9A-F]+$/);
        expect(Memo.MemoData).toMatch(/^[0-9A-F]+$/);
      }
    });

    it("produces deterministic ordering", () => {
      const payload = createTestPayload();
      const memos1 = encodeAsXrplMemos(payload);
      const memos2 = encodeAsXrplMemos(payload);

      expect(JSON.stringify(memos1)).toBe(JSON.stringify(memos2));
    });

    it("round-trips through decode", () => {
      const payload = createTestPayload();
      const memos = encodeAsXrplMemos(payload);
      const decoded = decodeXrplMemos(memos);

      expect(decoded.registrum_version).toBe(payload.registrum_version);
      expect(decoded.snapshot_hash).toBe(payload.snapshot_hash);
      expect(decoded.registry_hash).toBe(payload.registry_hash);
      expect(decoded.mode).toBe(payload.mode);
      expect(decoded.parity_status).toBe(payload.parity_status);
      expect(decoded.transition_range).toEqual(payload.transition_range);
      expect(decoded.state_count).toBe(payload.state_count);
      expect(decoded.ordering_max).toBe(payload.ordering_max);
    });
  });

  describe("validateAttestationPayload", () => {
    const createValidPayload = (): AttestationPayload => ({
      registrum_version: "1.0.0",
      snapshot_version: "1",
      snapshot_hash: "a".repeat(64),
      registry_hash: "b".repeat(64),
      mode: "dual",
      parity_status: "AGREED",
      transition_range: { from: 0, to: 100 },
      state_count: 10,
      ordering_max: 9,
    });

    it("accepts valid payload", () => {
      const payload = createValidPayload();
      expect(() => validateAttestationPayload(payload)).not.toThrow();
    });

    it("rejects null", () => {
      expect(() => validateAttestationPayload(null)).toThrow();
    });

    it("rejects non-object", () => {
      expect(() => validateAttestationPayload("string")).toThrow();
    });

    it("rejects missing fields", () => {
      const payload = createValidPayload();
      const { registrum_version, ...withoutVersion } = payload;
      expect(() => validateAttestationPayload(withoutVersion)).toThrow(
        /registrum_version/
      );
    });

    it("rejects invalid mode", () => {
      const payload = { ...createValidPayload(), mode: "invalid" };
      expect(() => validateAttestationPayload(payload)).toThrow(/mode/);
    });

    it("rejects invalid parity_status", () => {
      const payload = { ...createValidPayload(), parity_status: "invalid" };
      expect(() => validateAttestationPayload(payload)).toThrow(/parity/);
    });

    it("rejects invalid hash format", () => {
      const payload = { ...createValidPayload(), snapshot_hash: "short" };
      expect(() => validateAttestationPayload(payload)).toThrow(/snapshot_hash/);
    });

    it("rejects invalid transition_range", () => {
      const payload = { ...createValidPayload(), transition_range: null };
      expect(() => validateAttestationPayload(payload)).toThrow(/transition_range/);
    });
  });
});

describe("Attestation Determinism", () => {
  it("same snapshot produces same attestation hash across multiple runs", () => {
    const hashes: string[] = [];

    for (let i = 0; i < 10; i++) {
      const snapshot = createTestSnapshot();
      const payload = generateAttestationPayload(snapshot, TEST_REGISTRY_HASH, {
        registrumVersion: REGISTRUM_VERSION,
        mode: "dual",
        parityStatus: "AGREED",
        transitionFrom: 0,
        transitionTo: 100,
      });
      hashes.push(computeAttestationHash(payload));
    }

    // All hashes should be identical
    expect(new Set(hashes).size).toBe(1);
  });

  it("attestation hash is sensitive to all fields", () => {
    const baseSnapshot = createTestSnapshot();
    const baseOptions = {
      registrumVersion: REGISTRUM_VERSION,
      mode: "dual" as const,
      parityStatus: "AGREED" as const,
      transitionFrom: 0,
      transitionTo: 100,
    };

    const basePayload = generateAttestationPayload(
      baseSnapshot,
      TEST_REGISTRY_HASH,
      baseOptions
    );
    const baseHash = computeAttestationHash(basePayload);

    // Change each option and verify hash changes
    const variants = [
      { ...baseOptions, mode: "legacy-only" as const },
      { ...baseOptions, parityStatus: "HALTED" as const },
      { ...baseOptions, transitionFrom: 1 },
      { ...baseOptions, transitionTo: 99 },
    ];

    for (const variant of variants) {
      const payload = generateAttestationPayload(
        baseSnapshot,
        TEST_REGISTRY_HASH,
        variant
      );
      const hash = computeAttestationHash(payload);
      expect(hash).not.toBe(baseHash);
    }
  });
});

describe("Constitution binding (A-REG-001, fail-closed)", () => {
  // RED-first regression for the constitution-binding gap: the attestation's
  // top-level registry_hash was taken verbatim from caller input and never
  // cross-checked against the snapshot's own registry_hash. An attestation
  // could therefore advertise a "good" constitution while witnessing a
  // snapshot produced under a different/weaker one, and a spec-compliant
  // verifier (told to check registry_hash against a local registry) would pass
  // it. The generator must now refuse the mismatch, and a verify helper must
  // reject any attestation whose top-level registry_hash != snapshot's.

  const SNAPSHOT_HASH_X = createTestSnapshot().registry_hash; // the REAL hash
  const MISMATCHED_HASH_Y = "deadbeefcafe".padEnd(64, "1"); // a DIFFERENT hash

  it("generateAttestationPayload THROWS when registryHash != snapshot.registry_hash", () => {
    const snapshot = createTestSnapshot(); // registry_hash === SNAPSHOT_HASH_X
    expect(() =>
      generateAttestationPayload(snapshot, MISMATCHED_HASH_Y, {
        registrumVersion: REGISTRUM_VERSION,
        mode: "dual",
        parityStatus: "AGREED",
        transitionFrom: 0,
        transitionTo: 100,
      })
    ).toThrow(/registry_hash mismatch/i);
  });

  it("generateAttestationPayload stamps the snapshot's registry_hash (X), never a mismatched Y", () => {
    const snapshot = createTestSnapshot();
    // Calling with the matching hash succeeds and stamps X.
    const payload = generateAttestationPayload(snapshot, SNAPSHOT_HASH_X, {
      registrumVersion: REGISTRUM_VERSION,
      mode: "dual",
      parityStatus: "AGREED",
      transitionFrom: 0,
      transitionTo: 100,
    });
    expect(payload.registry_hash).toBe(SNAPSHOT_HASH_X);
    expect(payload.registry_hash).toBe(snapshot.registry_hash);
    expect(payload.registry_hash).not.toBe(MISMATCHED_HASH_Y);
  });

  it("verifyAttestationBinding accepts a correctly-bound attestation", () => {
    const snapshot = createTestSnapshot();
    const payload = generateAttestationPayload(snapshot, SNAPSHOT_HASH_X, {
      registrumVersion: REGISTRUM_VERSION,
      mode: "dual",
      parityStatus: "AGREED",
      transitionFrom: 0,
      transitionTo: 100,
    });
    expect(() => verifyAttestationBinding(payload, snapshot)).not.toThrow();
  });

  it("verifyAttestationBinding REJECTS an attestation whose registry_hash != snapshot.registry_hash", () => {
    const snapshot = createTestSnapshot();
    const goodPayload = generateAttestationPayload(snapshot, SNAPSHOT_HASH_X, {
      registrumVersion: REGISTRUM_VERSION,
      mode: "dual",
      parityStatus: "AGREED",
      transitionFrom: 0,
      transitionTo: 100,
    });
    // Forge the constitution binding: a verifier checking registry_hash against
    // a local registry would pass MISMATCHED_HASH_Y if it happened to match
    // that registry — but it does NOT match the snapshot this payload witnesses.
    const forged: AttestationPayload = {
      ...goodPayload,
      registry_hash: MISMATCHED_HASH_Y,
    };
    expect(() => verifyAttestationBinding(forged, snapshot)).toThrow(
      /constitution binding failed/i
    );
  });

  it("verifyAttestationBinding REJECTS an attestation whose snapshot_hash does not match the snapshot", () => {
    const snapshot = createTestSnapshot();
    const goodPayload = generateAttestationPayload(snapshot, SNAPSHOT_HASH_X, {
      registrumVersion: REGISTRUM_VERSION,
      mode: "dual",
      parityStatus: "AGREED",
      transitionFrom: 0,
      transitionTo: 100,
    });
    // Same registry_hash, but witnesses a DIFFERENT snapshot.
    const otherSnapshot: RegistrarSnapshotV1 = {
      ...createTestSnapshot(),
      state_ids: ["only-one"],
      lineage: { "only-one": null },
      ordering: { max_index: 0, assigned: { "only-one": 0 } },
    };
    expect(() => verifyAttestationBinding(goodPayload, otherSnapshot)).toThrow(
      /snapshot binding failed/i
    );
  });
});

describe("Version Consistency (Packaging Invariant)", () => {
  it("REGISTRUM_VERSION matches package.json version", async () => {
    // This test enforces that the authoritative version in src/version.ts
    // matches the published package.json version
    const packageJson = await import("../../package.json", {
      assert: { type: "json" },
    });
    expect(REGISTRUM_VERSION).toBe(packageJson.default.version);
  });

  it("REGISTRUM_VERSION is a valid semver string", () => {
    // Basic semver format check: MAJOR.MINOR.PATCH
    expect(REGISTRUM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("attestation payload uses authoritative version", () => {
    const snapshot = createTestSnapshot();
    const payload = generateAttestationPayload(snapshot, TEST_REGISTRY_HASH, {
      registrumVersion: REGISTRUM_VERSION,
      mode: "dual",
      parityStatus: "AGREED",
      transitionFrom: 0,
      transitionTo: 100,
    });

    expect(payload.registrum_version).toBe(REGISTRUM_VERSION);
  });
});
