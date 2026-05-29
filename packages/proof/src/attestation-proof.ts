/**
 * @attestia/proof — Attestation Proof Packaging.
 *
 * Wraps an attestation with a Merkle inclusion proof into a
 * self-contained, independently verifiable proof package.
 *
 * Design:
 * - Self-contained: third parties verify with ONLY this package
 * - No access to the full event store needed
 * - packageHash covers all fields for tamper evidence
 * - Uses SHA-256 + RFC 8785 canonical JSON (same as rest of Attestia)
 * - All pure functions, no I/O
 */

import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { MerkleTree } from "./merkle-tree.js";
import type { AttestationProofPackage, MerkleProof } from "./types.js";

// =============================================================================
// Internal Helpers
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// =============================================================================
// Canonical Attestation Hashing (single source of truth)
// =============================================================================

/**
 * Compute the canonical hash of an attestation.
 *
 * SHA-256 over RFC 8785 (JCS) canonical JSON. This is the ONE function that
 * defines what an attestation hashes to in Attestia. The Merkle leaf for an
 * attestation, the `attestationHash` field of a proof package, and the value
 * `verifyAttestationProof` recomputes are ALL this function — there is no
 * second implementation to drift against.
 *
 * Callers building a Merkle tree of attestations MUST use this for the leaves
 * so that `packageAttestationProof` can bind the proof to the attestation.
 *
 * @param attestation - Any JSON-serializable attestation value
 * @returns 64-char lowercase SHA-256 hex digest of the canonical JSON
 */
export function hashAttestation(attestation: unknown): string {
  return sha256(canonicalize(attestation));
}

/**
 * Compute the package hash from all fields except packageHash itself.
 * This provides tamper evidence for the entire proof package.
 */
function computePackageHash(
  attestation: unknown,
  attestationHash: string,
  merkleRoot: string,
  inclusionProof: MerkleProof,
  packagedAt: string,
): string {
  const data = {
    version: 1,
    attestation,
    attestationHash,
    merkleRoot,
    inclusionProof,
    packagedAt,
  };
  return sha256(canonicalize(data));
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Package an attestation with a Merkle inclusion proof.
 *
 * Creates a self-contained proof package that a third party can
 * independently verify without access to the full event store.
 *
 * @param attestation - The attestation data to prove
 * @param eventHashes - All event hashes in the system (ordered)
 * @param tree - Pre-built Merkle tree over eventHashes
 * @param attestationIndex - Index of this attestation's hash in eventHashes
 * @returns AttestationProofPackage or null if proof generation fails
 */
export function packageAttestationProof(
  attestation: unknown,
  eventHashes: readonly string[],
  tree: MerkleTree,
  attestationIndex: number,
): AttestationProofPackage | null {
  const root = tree.getRoot();
  if (root === null) {
    return null;
  }

  const inclusionProof = tree.getProof(attestationIndex);
  if (inclusionProof === null) {
    return null;
  }

  // Hash the attestation data using canonical JSON (single source of truth)
  const attestationHash = hashAttestation(attestation);

  // The leaf the proof proves MUST be this attestation's own hash. If the
  // caller points at an index whose stored hash is some OTHER event, the
  // resulting package would prove inclusion of a leaf that is not this
  // attestation — a forgeable shape. Refuse to mint such a package.
  const expectedHash = eventHashes[attestationIndex];
  if (expectedHash === undefined) {
    return null;
  }
  if (expectedHash !== attestationHash) {
    throw new Error(
      `packageAttestationProof: eventHashes[${attestationIndex}] does not match the attestation's hash — ` +
        `the proven leaf must be the attestation's own hash`,
    );
  }
  // The inclusion proof's leaf must also be that same hash (the tree was
  // built over eventHashes, so getProof(index).leafHash === eventHashes[index],
  // but assert it explicitly to keep the binding airtight).
  if (inclusionProof.leafHash !== attestationHash) {
    throw new Error(
      "packageAttestationProof: inclusion proof leafHash does not match the attestation hash",
    );
  }

  const packagedAt = new Date().toISOString();

  const packageHash = computePackageHash(
    attestation,
    attestationHash,
    root,
    inclusionProof,
    packagedAt,
  );

  return {
    version: 1,
    attestation,
    attestationHash,
    merkleRoot: root,
    inclusionProof,
    packagedAt,
    packageHash,
  };
}

/**
 * Verify an attestation proof package.
 *
 * Checks:
 * 1. attestationHash matches recomputed hash of attestation data
 * 2. The proven leaf IS this attestation: attestationHash === inclusionProof.leafHash
 *    (without this, a genuine inclusion proof for a real event can be
 *    stapled onto a different forged attestation and still verify)
 * 3. Merkle inclusion proof is valid (leaf → root path)
 * 4. merkleRoot in package matches root in inclusion proof
 * 5. packageHash matches recomputed hash of all fields
 *
 * @param pkg - The proof package to verify
 * @returns true if all checks pass
 */
export function verifyAttestationProof(
  pkg: AttestationProofPackage,
): boolean {
  // Check 1: Recompute attestation hash
  const recomputedAttestationHash = hashAttestation(pkg.attestation);
  if (recomputedAttestationHash !== pkg.attestationHash) {
    return false;
  }

  // Check 2: Bind the attestation to the proven leaf. The inclusion proof
  // proves that `inclusionProof.leafHash` is in the tree; we must confirm
  // that leaf is THIS attestation's hash, otherwise the proof is for some
  // other event and the attestation is forged.
  if (pkg.attestationHash !== pkg.inclusionProof.leafHash) {
    return false;
  }

  // Check 3: Verify Merkle inclusion proof
  if (!MerkleTree.verifyProof(pkg.inclusionProof)) {
    return false;
  }

  // Check 4: merkleRoot consistency
  if (pkg.merkleRoot !== pkg.inclusionProof.root) {
    return false;
  }

  // Check 4: Recompute package hash
  const recomputedPackageHash = computePackageHash(
    pkg.attestation,
    pkg.attestationHash,
    pkg.merkleRoot,
    pkg.inclusionProof,
    pkg.packagedAt,
  );
  if (recomputedPackageHash !== pkg.packageHash) {
    return false;
  }

  return true;
}
