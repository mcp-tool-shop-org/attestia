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
 * The result of a single named verification check within
 * {@link verifyAttestationProofDetailed}.
 */
export interface AttestationCheck {
  /** Stable check identifier (see {@link verifyAttestationProofDetailed}). */
  readonly name: string;
  /** Whether this individual check passed. */
  readonly passed: boolean;
  /** Human-readable detail — present whether the check passed or failed. */
  readonly detail?: string;
}

/**
 * The detailed outcome of verifying an attestation proof package: the overall
 * verdict plus the per-check breakdown.
 */
export interface AttestationVerificationResult {
  /** True iff every check passed. */
  readonly valid: boolean;
  /** Each of the five checks, in evaluation order. */
  readonly checks: readonly AttestationCheck[];
}

/**
 * Verify an attestation proof package, returning a per-check breakdown.
 *
 * `verifyAttestationProof` collapses verification to a single boolean, which
 * hides WHICH guarantee a bad package violated — unhelpful when this is the
 * most security-critical call in the stack. This variant runs the SAME five
 * checks but reports each one, so an external auditor can see exactly where a
 * package broke:
 *
 *  1. `attestation-hash-recompute` — `attestationHash` equals the recomputed
 *     canonical hash of `attestation`.
 *  2. `leaf-binding` — the proven leaf IS this attestation
 *     (`attestationHash === inclusionProof.leafHash`). Without this, a genuine
 *     inclusion proof for a real event can be stapled onto a different forged
 *     attestation and still verify.
 *  3. `merkle-inclusion` — the Merkle inclusion proof folds to its root.
 *  4. `root-consistency` — `merkleRoot` equals `inclusionProof.root`.
 *  5. `package-hash-recompute` — `packageHash` equals the recomputed
 *     tamper-evidence hash over all fields.
 *
 * All five checks are ALWAYS evaluated (no short-circuit), so a failing
 * package reports every check that failed, not just the first.
 *
 * @param pkg - The proof package to verify
 * @returns `{ valid, checks }` — `valid` is true iff all checks pass
 */
export function verifyAttestationProofDetailed(
  pkg: AttestationProofPackage,
): AttestationVerificationResult {
  const checks: AttestationCheck[] = [];

  // Check 1: Recompute attestation hash.
  const recomputedAttestationHash = hashAttestation(pkg.attestation);
  const hashRecomputed = recomputedAttestationHash === pkg.attestationHash;
  checks.push({
    name: "attestation-hash-recompute",
    passed: hashRecomputed,
    detail: hashRecomputed
      ? "attestationHash matches the recomputed canonical hash of the attestation"
      : `attestationHash mismatch: package claims ${pkg.attestationHash}, recomputed ${recomputedAttestationHash}`,
  });

  // Check 2: Bind the attestation to the proven leaf. The inclusion proof
  // proves that `inclusionProof.leafHash` is in the tree; we must confirm that
  // leaf is THIS attestation's hash, otherwise the proof is for some other
  // event and the attestation is forged.
  const leafBound = pkg.attestationHash === pkg.inclusionProof.leafHash;
  checks.push({
    name: "leaf-binding",
    passed: leafBound,
    detail: leafBound
      ? "the proven Merkle leaf is this attestation's hash"
      : `proven leaf is NOT this attestation: attestationHash ${pkg.attestationHash} != inclusionProof.leafHash ${pkg.inclusionProof.leafHash} (forgery indicator)`,
  });

  // Check 3: Verify the Merkle inclusion proof folds to its root. Guarded so a
  // malformed proof (e.g. non-hex sibling) is reported as a failed check rather
  // than throwing out of the verifier.
  let merkleValid = false;
  let merkleDetail: string;
  try {
    merkleValid = MerkleTree.verifyProof(pkg.inclusionProof);
    merkleDetail = merkleValid
      ? "Merkle inclusion proof folds to its stated root"
      : "Merkle inclusion proof does not fold to its stated root";
  } catch (err) {
    merkleValid = false;
    merkleDetail = `Merkle inclusion proof is malformed: ${err instanceof Error ? err.message : String(err)}`;
  }
  checks.push({
    name: "merkle-inclusion",
    passed: merkleValid,
    detail: merkleDetail,
  });

  // Check 4: merkleRoot consistency.
  const rootConsistent = pkg.merkleRoot === pkg.inclusionProof.root;
  checks.push({
    name: "root-consistency",
    passed: rootConsistent,
    detail: rootConsistent
      ? "package merkleRoot matches the inclusion proof's root"
      : `merkleRoot mismatch: package ${pkg.merkleRoot} != inclusionProof.root ${pkg.inclusionProof.root}`,
  });

  // Check 5: Recompute package hash (tamper evidence over all fields).
  const recomputedPackageHash = computePackageHash(
    pkg.attestation,
    pkg.attestationHash,
    pkg.merkleRoot,
    pkg.inclusionProof,
    pkg.packagedAt,
  );
  const packageHashValid = recomputedPackageHash === pkg.packageHash;
  checks.push({
    name: "package-hash-recompute",
    passed: packageHashValid,
    detail: packageHashValid
      ? "packageHash matches the recomputed tamper-evidence hash"
      : `packageHash mismatch: package claims ${pkg.packageHash}, recomputed ${recomputedPackageHash}`,
  });

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}

/**
 * Verify an attestation proof package.
 *
 * Thin boolean wrapper over {@link verifyAttestationProofDetailed} — returns
 * `true` iff all five checks pass. Use {@link verifyAttestationProofDetailed}
 * when you need to know WHICH check failed.
 *
 * @param pkg - The proof package to verify
 * @returns true if all checks pass
 */
export function verifyAttestationProof(
  pkg: AttestationProofPackage,
): boolean {
  return verifyAttestationProofDetailed(pkg).valid;
}
