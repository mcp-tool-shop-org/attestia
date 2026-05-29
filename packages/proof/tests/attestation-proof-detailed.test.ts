/**
 * Detailed Attestation Proof Verification Tests (D5-B-004).
 *
 * `verifyAttestationProof` returns a bare boolean, which hides WHICH of the
 * five security checks failed — the most security-critical call in the stack
 * is also the least informative. `verifyAttestationProofDetailed` exposes a
 * per-check breakdown so an external auditor can see exactly where a package
 * broke (attestation-hash recompute, leaf binding, Merkle inclusion, root
 * consistency, package-hash recompute).
 *
 * These tests assert the FULL contract:
 *  - an honest package passes every check,
 *  - a forged attestation fails specifically on the leaf-binding check
 *    (the discriminating check the boolean wrapper cannot reveal),
 *  - the boolean wrapper stays consistent with `detailed.valid`.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { MerkleTree } from "../src/merkle-tree.js";
import {
  packageAttestationProof,
  verifyAttestationProof,
  verifyAttestationProofDetailed,
} from "../src/attestation-proof.js";
import type { AttestationProofPackage } from "../src/types.js";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hashAttestation(attestation: unknown): string {
  return sha256(canonicalize(attestation));
}

function makeAttestation(id: string, amount: number) {
  return {
    id,
    type: "payment",
    amount: `${amount}.00`,
    currency: "USDC",
    timestamp: "2025-06-15T00:00:00Z",
  };
}

/** Recompute packageHash exactly as the implementation does (forger is consistent). */
function repackage(
  base: AttestationProofPackage,
  overrides: Partial<AttestationProofPackage>,
): AttestationProofPackage {
  const merged = { ...base, ...overrides };
  const packageHash = sha256(
    canonicalize({
      version: merged.version,
      attestation: merged.attestation,
      attestationHash: merged.attestationHash,
      merkleRoot: merged.merkleRoot,
      inclusionProof: merged.inclusionProof,
      packagedAt: merged.packagedAt,
    }),
  );
  return { ...merged, packageHash };
}

// The five named checks, in order. Kept here so the test pins the contract.
const CHECK_NAMES = [
  "attestation-hash-recompute",
  "leaf-binding",
  "merkle-inclusion",
  "root-consistency",
  "package-hash-recompute",
] as const;

function buildHonestPackage(): AttestationProofPackage {
  const real = makeAttestation("real", 100);
  const others = [makeAttestation("e1", 200), makeAttestation("e2", 300)];
  const attestations = [real, ...others];
  const eventHashes = attestations.map(hashAttestation);
  const tree = MerkleTree.build(eventHashes);
  return packageAttestationProof(real, eventHashes, tree, 0)!;
}

describe("verifyAttestationProofDetailed (D5-B-004)", () => {
  it("an honest package returns valid:true with ALL five checks passed", () => {
    const honest = buildHonestPackage();
    const result = verifyAttestationProofDetailed(honest);

    expect(result.valid).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual([...CHECK_NAMES]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("a forged attestation returns valid:false with leaf-binding flagged", () => {
    const honest = buildHonestPackage();

    // Keep the GENUINE inclusion proof for leaf 0, swap in a different
    // attestation + its honestly-recomputed hash (recompute passes), and
    // recompute packageHash (package-hash passes). Only leaf-binding catches it.
    const forgedAttestation = makeAttestation("FORGED-never-in-tree", 999999);
    const forged = repackage(honest, {
      attestation: forgedAttestation,
      attestationHash: hashAttestation(forgedAttestation),
    });

    const result = verifyAttestationProofDetailed(forged);

    expect(result.valid).toBe(false);

    const byName = Object.fromEntries(
      result.checks.map((c) => [c.name, c]),
    );
    // The discriminating failure: the proven leaf is not this attestation.
    expect(byName["leaf-binding"]!.passed).toBe(false);
    expect(byName["leaf-binding"]!.detail).toBeTruthy();
    // The attacker keeps these self-consistent, so they still pass.
    expect(byName["attestation-hash-recompute"]!.passed).toBe(true);
    expect(byName["package-hash-recompute"]!.passed).toBe(true);
  });

  it("flags attestation-hash-recompute when the stored hash is wrong", () => {
    const honest = buildHonestPackage();
    // Corrupt only the stored attestationHash (and repackage so package-hash
    // would still match the corrupted field). The recompute check must catch it.
    const tampered = repackage(honest, { attestationHash: "0".repeat(64) });

    const result = verifyAttestationProofDetailed(tampered);
    expect(result.valid).toBe(false);
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName["attestation-hash-recompute"]!.passed).toBe(false);
  });

  it("flags package-hash-recompute when the tamper-evidence hash is wrong", () => {
    const honest = buildHonestPackage();
    // Tamper packageHash directly (do NOT recompute) — every other check holds,
    // only the package-hash recompute should fail.
    const tampered: AttestationProofPackage = {
      ...honest,
      packageHash: "f".repeat(64),
    };

    const result = verifyAttestationProofDetailed(tampered);
    expect(result.valid).toBe(false);
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName["package-hash-recompute"]!.passed).toBe(false);
    expect(byName["attestation-hash-recompute"]!.passed).toBe(true);
    expect(byName["leaf-binding"]!.passed).toBe(true);
  });

  it("verifyAttestationProof boolean stays consistent with detailed.valid", () => {
    const honest = buildHonestPackage();
    expect(verifyAttestationProof(honest)).toBe(
      verifyAttestationProofDetailed(honest).valid,
    );

    const forgedAttestation = makeAttestation("forged", 1);
    const forged = repackage(honest, {
      attestation: forgedAttestation,
      attestationHash: hashAttestation(forgedAttestation),
    });
    expect(verifyAttestationProof(forged)).toBe(
      verifyAttestationProofDetailed(forged).valid,
    );
  });
});
