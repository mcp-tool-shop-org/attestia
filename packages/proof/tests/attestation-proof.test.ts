/**
 * Attestation Proof Packaging Tests
 *
 * Verifies:
 * - Package creation from attestation + tree
 * - Self-verification (round-trip)
 * - Tampered attestation fails
 * - Tampered proof fails
 * - Tampered package hash fails
 * - Multiple attestations from same tree
 * - Round-trip serialization (JSON.stringify + parse + verify)
 * - Edge cases
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { MerkleTree } from "../src/merkle-tree.js";
import {
  hashAttestation as hashAttestationExported,
  packageAttestationProof,
  verifyAttestationProof,
} from "../src/attestation-proof.js";
import type { AttestationProofPackage } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Create a mock attestation */
function makeAttestation(id: string, amount: number) {
  return {
    id,
    type: "payment",
    amount: `${amount}.00`,
    currency: "USDC",
    timestamp: "2025-06-15T00:00:00Z",
  };
}

/** Hash an attestation the same way the proof package does */
function hashAttestation(attestation: unknown): string {
  return sha256(canonicalize(attestation));
}

/** Create N attestations and their event hashes */
function makeAttestationsAndHashes(count: number): {
  attestations: unknown[];
  eventHashes: string[];
} {
  const attestations: unknown[] = [];
  const eventHashes: string[] = [];

  for (let i = 0; i < count; i++) {
    const att = makeAttestation(`att-${i}`, (i + 1) * 100);
    attestations.push(att);
    eventHashes.push(hashAttestation(att));
  }

  return { attestations, eventHashes };
}

// =============================================================================
// Package Creation
// =============================================================================

describe("packageAttestationProof", () => {
  it("creates a valid proof package", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);

    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0);

    expect(pkg).not.toBeNull();
    expect(pkg!.version).toBe(1);
    expect(pkg!.attestation).toEqual(attestations[0]);
    expect(pkg!.attestationHash).toBe(eventHashes[0]);
    expect(pkg!.merkleRoot).toBe(tree.getRoot());
    expect(pkg!.inclusionProof).toBeDefined();
    expect(pkg!.inclusionProof.leafIndex).toBe(0);
    expect(pkg!.packagedAt).toBeTruthy();
    expect(pkg!.packageHash).toBeTruthy();
    expect(pkg!.packageHash.length).toBe(64);
  });

  it("returns null for empty tree", () => {
    const pkg = packageAttestationProof({}, [], MerkleTree.build([]), 0);
    expect(pkg).toBeNull();
  });

  it("returns null for out-of-range index", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);

    expect(packageAttestationProof(attestations[0]!, eventHashes, tree, -1)).toBeNull();
    expect(packageAttestationProof(attestations[0]!, eventHashes, tree, 4)).toBeNull();
    expect(packageAttestationProof(attestations[0]!, eventHashes, tree, 100)).toBeNull();
  });

  it("creates packages for every attestation in a tree", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(8);
    const tree = MerkleTree.build(eventHashes);

    for (let i = 0; i < 8; i++) {
      const pkg = packageAttestationProof(attestations[i]!, eventHashes, tree, i);
      expect(pkg).not.toBeNull();
      expect(pkg!.attestation).toEqual(attestations[i]);
      expect(pkg!.inclusionProof.leafIndex).toBe(i);
      expect(pkg!.merkleRoot).toBe(tree.getRoot());
    }
  });

  it("different attestations get different package hashes", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);

    const pkg0 = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;
    const pkg1 = packageAttestationProof(attestations[1]!, eventHashes, tree, 1)!;

    expect(pkg0.packageHash).not.toBe(pkg1.packageHash);
    expect(pkg0.attestationHash).not.toBe(pkg1.attestationHash);
  });
});

// =============================================================================
// Self-Verification
// =============================================================================

describe("verifyAttestationProof", () => {
  it("valid package verifies successfully", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    expect(verifyAttestationProof(pkg)).toBe(true);
  });

  it("all packages from same tree verify", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(8);
    const tree = MerkleTree.build(eventHashes);

    for (let i = 0; i < 8; i++) {
      const pkg = packageAttestationProof(attestations[i]!, eventHashes, tree, i)!;
      expect(verifyAttestationProof(pkg)).toBe(true);
    }
  });

  it("single-attestation tree verifies", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(1);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    expect(verifyAttestationProof(pkg)).toBe(true);
  });
});

// =============================================================================
// Tamper Detection
// =============================================================================

describe("tamper detection", () => {
  it("tampered attestation data fails", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    const tampered: AttestationProofPackage = {
      ...pkg,
      attestation: { ...pkg.attestation as Record<string, unknown>, amount: "999.00" },
    };

    expect(verifyAttestationProof(tampered)).toBe(false);
  });

  it("tampered attestation hash fails", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    const tampered: AttestationProofPackage = {
      ...pkg,
      attestationHash: sha256("fake"),
    };

    expect(verifyAttestationProof(tampered)).toBe(false);
  });

  it("tampered merkle root fails", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    const tampered: AttestationProofPackage = {
      ...pkg,
      merkleRoot: sha256("wrong-root"),
    };

    expect(verifyAttestationProof(tampered)).toBe(false);
  });

  it("tampered inclusion proof sibling fails", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    const tamperedSiblings = [...pkg.inclusionProof.siblings];
    if (tamperedSiblings.length > 0) {
      tamperedSiblings[0] = { ...tamperedSiblings[0]!, hash: sha256("fake-sibling") };
    }

    const tampered: AttestationProofPackage = {
      ...pkg,
      inclusionProof: {
        ...pkg.inclusionProof,
        siblings: tamperedSiblings,
      },
    };

    expect(verifyAttestationProof(tampered)).toBe(false);
  });

  it("tampered package hash fails", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    const tampered: AttestationProofPackage = {
      ...pkg,
      packageHash: sha256("tampered-package"),
    };

    expect(verifyAttestationProof(tampered)).toBe(false);
  });

  it("tampered packagedAt timestamp fails", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    const tampered: AttestationProofPackage = {
      ...pkg,
      packagedAt: "2099-01-01T00:00:00.000Z",
    };

    expect(verifyAttestationProof(tampered)).toBe(false);
  });

  it("merkleRoot/inclusionProof.root mismatch fails", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    // Create a different tree to get a valid proof with different root
    const otherHashes = eventHashes.map((_, i) => sha256(`other-${i}`));
    const otherTree = MerkleTree.build(otherHashes);
    const otherProof = otherTree.getProof(0)!;

    // Mix: merkleRoot from original, proof from other tree
    const tampered: AttestationProofPackage = {
      ...pkg,
      inclusionProof: otherProof,
    };

    expect(verifyAttestationProof(tampered)).toBe(false);
  });
});

// =============================================================================
// JSON Round-Trip
// =============================================================================

describe("JSON round-trip serialization", () => {
  it("package survives JSON.stringify + JSON.parse + verify", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(8);
    const tree = MerkleTree.build(eventHashes);

    for (let i = 0; i < 8; i++) {
      const pkg = packageAttestationProof(attestations[i]!, eventHashes, tree, i)!;

      // Serialize → deserialize
      const serialized = JSON.stringify(pkg);
      const deserialized = JSON.parse(serialized) as AttestationProofPackage;

      // Should still verify
      expect(verifyAttestationProof(deserialized)).toBe(true);
    }
  });

  it("serialized package preserves all fields", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(4);
    const tree = MerkleTree.build(eventHashes);
    const pkg = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;

    const serialized = JSON.stringify(pkg);
    const deserialized = JSON.parse(serialized) as AttestationProofPackage;

    expect(deserialized.version).toBe(1);
    expect(deserialized.attestation).toEqual(pkg.attestation);
    expect(deserialized.attestationHash).toBe(pkg.attestationHash);
    expect(deserialized.merkleRoot).toBe(pkg.merkleRoot);
    expect(deserialized.inclusionProof.leafHash).toBe(pkg.inclusionProof.leafHash);
    expect(deserialized.inclusionProof.leafIndex).toBe(pkg.inclusionProof.leafIndex);
    expect(deserialized.inclusionProof.root).toBe(pkg.inclusionProof.root);
    expect(deserialized.inclusionProof.siblings.length).toBe(pkg.inclusionProof.siblings.length);
    expect(deserialized.packagedAt).toBe(pkg.packagedAt);
    expect(deserialized.packageHash).toBe(pkg.packageHash);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  it("handles complex attestation objects", () => {
    const complex = {
      id: "complex-1",
      nested: { deep: { value: 42, array: [1, 2, 3] } },
      metadata: { tags: ["a", "b"], created: "2025-06-15T00:00:00Z" },
    };

    const hash = hashAttestation(complex);
    const tree = MerkleTree.build([hash]);
    const pkg = packageAttestationProof(complex, [hash], tree, 0)!;

    expect(pkg).not.toBeNull();
    expect(verifyAttestationProof(pkg)).toBe(true);
  });

  it("handles attestation with null/boolean values", () => {
    const att = { id: "null-test", value: null, active: true, deleted: false };
    const hash = hashAttestation(att);
    const tree = MerkleTree.build([hash]);
    const pkg = packageAttestationProof(att, [hash], tree, 0)!;

    expect(verifyAttestationProof(pkg)).toBe(true);

    // Round-trip
    const deserialized = JSON.parse(JSON.stringify(pkg)) as AttestationProofPackage;
    expect(verifyAttestationProof(deserialized)).toBe(true);
  });

  it("odd number of attestations produces valid proofs", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(7);
    const tree = MerkleTree.build(eventHashes);

    // Last attestation (odd one out)
    const pkg = packageAttestationProof(attestations[6]!, eventHashes, tree, 6)!;
    expect(pkg).not.toBeNull();
    expect(verifyAttestationProof(pkg)).toBe(true);
  });

  it("large number of attestations (100) all produce valid proofs", () => {
    const { attestations, eventHashes } = makeAttestationsAndHashes(100);
    const tree = MerkleTree.build(eventHashes);

    // Spot-check several positions
    const indices = [0, 1, 49, 50, 98, 99];
    for (const i of indices) {
      const pkg = packageAttestationProof(attestations[i]!, eventHashes, tree, i)!;
      expect(verifyAttestationProof(pkg)).toBe(true);
    }
  });
});

// =============================================================================
// hashAttestation (exported single source of truth)
// =============================================================================

describe("hashAttestation", () => {
  it("is deterministic for the same input", () => {
    const att = makeAttestation("att-deterministic", 100);
    expect(hashAttestationExported(att)).toBe(hashAttestationExported(att));
  });

  it("is invariant to key ordering (RFC 8785 canonical JSON)", () => {
    const a = { id: "x", type: "payment", amount: "100.00" };
    const b = { amount: "100.00", type: "payment", id: "x" };
    expect(hashAttestationExported(a)).toBe(hashAttestationExported(b));
  });

  it("produces a 64-char lowercase SHA-256 hex digest", () => {
    const hash = hashAttestationExported(makeAttestation("att-shape", 100));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different attestations", () => {
    const h0 = hashAttestationExported(makeAttestation("att-0", 100));
    const h1 = hashAttestationExported(makeAttestation("att-1", 200));
    expect(h0).not.toBe(h1);
  });

  it("equals the value the proof package binds to (round-trips at index 0)", () => {
    const att = makeAttestation("att-bind", 100);
    const leaf = hashAttestationExported(att);

    // Build the tree over the attestation's own hash as the single leaf.
    const tree = MerkleTree.build([leaf]);
    const pkg = packageAttestationProof(att, [leaf], tree, 0)!;

    // The package binds to exactly this hash...
    expect(pkg).not.toBeNull();
    expect(pkg.attestationHash).toBe(leaf);
    expect(pkg.inclusionProof.leafHash).toBe(leaf);
    // ...and the bound proof verifies.
    expect(verifyAttestationProof(pkg)).toBe(true);
  });
});
