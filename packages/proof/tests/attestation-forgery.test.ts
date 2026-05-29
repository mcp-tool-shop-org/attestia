/**
 * Attestation Proof Forgery Tests (D5-A-001).
 *
 * The core Attestia invariant: a forged proof package MUST NOT verify.
 *
 * The original verifier recomputed attestationHash, validated the Merkle
 * path, checked merkleRoot === inclusionProof.root, and recomputed
 * packageHash — but NEVER checked that the proven leaf is actually the
 * attestation being claimed:
 *
 *     pkg.attestationHash === pkg.inclusionProof.leafHash
 *
 * Without that binding, an attacker can take a GENUINE inclusion proof for
 * some real event at leaf i and staple a DIFFERENT attestation (plus its
 * honestly-recomputed hash) on top. Every check the verifier performs
 * passes, yet the attestation was never in the tree. That is forgery.
 *
 * Each test asserts the FULL invariant: the honest package verifies AND the
 * forgery is rejected.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { MerkleTree } from "../src/merkle-tree.js";
import {
  packageAttestationProof,
  verifyAttestationProof,
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

/**
 * Recompute packageHash exactly as the implementation does, so a forger's
 * package is internally consistent (the attacker controls all fields and
 * will of course recompute the tamper-evidence hash over their forgery).
 */
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

describe("attestation proof forgery (D5-A-001)", () => {
  it("a genuine inclusion proof + a DIFFERENT attestation does NOT verify", () => {
    // A real tree of events. Leaf 0 is the legitimately-proven attestation.
    const real = makeAttestation("real", 100);
    const others = [makeAttestation("e1", 200), makeAttestation("e2", 300)];
    const attestations = [real, ...others];
    const eventHashes = attestations.map(hashAttestation);
    const tree = MerkleTree.build(eventHashes);

    // Honest package for leaf 0 verifies.
    const honest = packageAttestationProof(real, eventHashes, tree, 0)!;
    expect(verifyAttestationProof(honest)).toBe(true);

    // Forgery: keep the GENUINE inclusion proof (a valid path for leaf 0's
    // real hash), but swap in a completely different attestation and its
    // honestly-recomputed hash. The forger recomputes packageHash too.
    const forgedAttestation = makeAttestation("FORGED-never-in-tree", 999999);
    const forged = repackage(honest, {
      attestation: forgedAttestation,
      attestationHash: hashAttestation(forgedAttestation),
      // inclusionProof, merkleRoot left as the genuine ones.
    });

    // The forged attestation's hash does NOT equal the proven leaf hash,
    // so the package must be rejected.
    expect(forged.attestationHash).not.toBe(forged.inclusionProof.leafHash);
    expect(verifyAttestationProof(forged)).toBe(false);
  });

  it("swapping a real proof for leaf i onto a real attestation for leaf j fails", () => {
    // Two genuine attestations, both truly in the tree.
    const attestations = [
      makeAttestation("acct-a", 100),
      makeAttestation("acct-b", 200),
      makeAttestation("acct-c", 300),
      makeAttestation("acct-d", 400),
    ];
    const eventHashes = attestations.map(hashAttestation);
    const tree = MerkleTree.build(eventHashes);

    const pkgA = packageAttestationProof(attestations[0]!, eventHashes, tree, 0)!;
    const pkgB = packageAttestationProof(attestations[1]!, eventHashes, tree, 1)!;
    expect(verifyAttestationProof(pkgA)).toBe(true);
    expect(verifyAttestationProof(pkgB)).toBe(true);

    // Forge: attestation A's data, but B's (genuine, same-tree) inclusion
    // proof. Same merkleRoot, valid Merkle path — only the leaf binding
    // catches this.
    const forged = repackage(pkgA, {
      inclusionProof: pkgB.inclusionProof,
    });

    expect(forged.attestationHash).not.toBe(forged.inclusionProof.leafHash);
    expect(verifyAttestationProof(forged)).toBe(false);
  });

  it("packageAttestationProof throws when eventHashes[index] != attestationHash", () => {
    // Packaging-time defense: the index must point at the attestation's own
    // hash. If the caller passes an index whose stored hash is some OTHER
    // event, packaging must refuse rather than mint a self-inconsistent proof.
    const real = makeAttestation("real", 100);
    const wrong = makeAttestation("wrong", 200);
    // eventHashes claim leaf 0 is `wrong`, but we ask to package `real` at 0.
    const eventHashes = [hashAttestation(wrong), hashAttestation(real)];
    const tree = MerkleTree.build(eventHashes);

    expect(() => packageAttestationProof(real, eventHashes, tree, 0)).toThrow();
  });

  it("honest packages for every leaf still verify (no regression)", () => {
    const attestations = Array.from({ length: 6 }, (_, i) =>
      makeAttestation(`att-${i}`, (i + 1) * 100),
    );
    const eventHashes = attestations.map(hashAttestation);
    const tree = MerkleTree.build(eventHashes);

    for (let i = 0; i < attestations.length; i++) {
      const pkg = packageAttestationProof(attestations[i]!, eventHashes, tree, i)!;
      expect(verifyAttestationProof(pkg)).toBe(true);
      // The binding holds for honest packages.
      expect(pkg.attestationHash).toBe(pkg.inclusionProof.leafHash);
    }
  });
});
