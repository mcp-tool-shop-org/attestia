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
import { NOOP_TELEMETRY, type Telemetry } from "@attestia/types";
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
 * Stable reason code for why {@link packageAttestationProofResult} could not
 * mint a package. Each names a DISTINCT, operator-actionable precondition the
 * caller violated — previously all three collapsed into a bare `null`
 * (B-RVP-008), making a batch failure undiagnosable.
 */
export type PackageFailureReason =
  /** The Merkle tree is empty — `tree.getRoot()` is null. */
  | "empty-tree"
  /** `attestationIndex` is out of range / unprovable — `tree.getProof()` is null. */
  | "index-out-of-range"
  /** The index exists in the tree but not in the provided `eventHashes`. */
  | "index-not-in-event-hashes";

/**
 * The structured outcome of {@link packageAttestationProofResult}: either the
 * minted package, or a named reason the precondition failed.
 */
export type PackageAttestationResult =
  | { readonly ok: true; readonly package: AttestationProofPackage }
  | {
      readonly ok: false;
      /** Stable, low-cardinality reason code (safe to branch/alert on). */
      readonly reason: PackageFailureReason;
      /** Human-readable detail naming the offending index and lengths. */
      readonly detail: string;
    };

/**
 * Package an attestation with a Merkle inclusion proof, returning a STRUCTURED
 * result instead of a bare null (B-RVP-008).
 *
 * {@link packageAttestationProof} returns `null` for three operationally
 * distinct failures, so a batch job that drops some packages cannot tell
 * whether the tree was empty, the index was wrong, or `eventHashes` was the
 * wrong length. This variant names the precondition that failed — turning a
 * debugging session into a one-line config fix — while the security-critical
 * leaf-binding mismatch (a forgery indicator) is STILL a thrown Error, exactly
 * as before.
 *
 * @param attestation - The attestation data to prove
 * @param eventHashes - All event hashes in the system (ordered)
 * @param tree - Pre-built Merkle tree over eventHashes
 * @param attestationIndex - Index of this attestation's hash in eventHashes
 * @returns `{ ok: true, package }` or `{ ok: false, reason, detail }`
 * @throws Error when the proven leaf is not the attestation's own hash
 *   (leaf-binding / forgery boundary — never a soft failure)
 */
export function packageAttestationProofResult(
  attestation: unknown,
  eventHashes: readonly string[],
  tree: MerkleTree,
  attestationIndex: number,
): PackageAttestationResult {
  const root = tree.getRoot();
  if (root === null) {
    return {
      ok: false,
      reason: "empty-tree",
      detail:
        `cannot package attestation at index ${attestationIndex}: the Merkle tree is empty ` +
        `(no root). Build the tree over a non-empty eventHashes set first ` +
        `(received ${eventHashes.length} event hash(es)).`,
    };
  }

  const inclusionProof = tree.getProof(attestationIndex);
  if (inclusionProof === null) {
    return {
      ok: false,
      reason: "index-out-of-range",
      detail:
        `cannot package attestation: index ${attestationIndex} is out of range for the tree ` +
        `(${eventHashes.length} event hash(es)). Pass an index in [0, ${eventHashes.length - 1}].`,
    };
  }

  // Hash the attestation data using canonical JSON (single source of truth)
  const attestationHash = hashAttestation(attestation);

  // The leaf the proof proves MUST be this attestation's own hash. If the
  // caller points at an index whose stored hash is some OTHER event, the
  // resulting package would prove inclusion of a leaf that is not this
  // attestation — a forgeable shape. Refuse to mint such a package.
  const expectedHash = eventHashes[attestationIndex];
  if (expectedHash === undefined) {
    return {
      ok: false,
      reason: "index-not-in-event-hashes",
      detail:
        `cannot package attestation: index ${attestationIndex} is provable in the tree but ` +
        `absent from eventHashes (length ${eventHashes.length}). The tree and eventHashes ` +
        `are out of sync — rebuild the tree from the same eventHashes you pass here.`,
    };
  }
  if (expectedHash !== attestationHash) {
    // Security boundary, NOT a soft failure: a mismatch here would mint a proof
    // for a leaf that is not this attestation (a forgery shape). Throw loudly.
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
    ok: true,
    package: {
      version: 1,
      attestation,
      attestationHash,
      merkleRoot: root,
      inclusionProof,
      packagedAt,
      packageHash,
    },
  };
}

/**
 * Package an attestation with a Merkle inclusion proof.
 *
 * Creates a self-contained proof package that a third party can
 * independently verify without access to the full event store.
 *
 * Thin boolean-shaped wrapper over {@link packageAttestationProofResult}:
 * returns the package on success and `null` on any soft precondition failure,
 * preserving the original contract. Use {@link packageAttestationProofResult}
 * when you need to know WHICH precondition failed (e.g. batch packaging).
 *
 * @param attestation - The attestation data to prove
 * @param eventHashes - All event hashes in the system (ordered)
 * @param tree - Pre-built Merkle tree over eventHashes
 * @param attestationIndex - Index of this attestation's hash in eventHashes
 * @returns AttestationProofPackage or null if proof generation fails
 * @throws Error on the leaf-binding / forgery boundary (see the Result variant)
 */
export function packageAttestationProof(
  attestation: unknown,
  eventHashes: readonly string[],
  tree: MerkleTree,
  attestationIndex: number,
): AttestationProofPackage | null {
  const result = packageAttestationProofResult(
    attestation,
    eventHashes,
    tree,
    attestationIndex,
  );
  return result.ok ? result.package : null;
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
 * @param telemetry - Optional sink (B-RVP-001). When provided, one
 *   `"proof.verify"` event is emitted carrying low-cardinality
 *   `{ valid, firstFailedCheck }` attributes — so a forged/failed proof
 *   (a forgery indicator) is alertable at the moment of divergence. Side-channel
 *   only: never changes the result; a throwing sink is swallowed. Defaults to a
 *   silent no-op sink.
 * @returns `{ valid, checks }` — `valid` is true iff all checks pass
 */
export function verifyAttestationProofDetailed(
  pkg: AttestationProofPackage,
  telemetry: Telemetry = NOOP_TELEMETRY,
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

  const valid = checks.every((c) => c.passed);
  // The first failed check is the most useful low-cardinality label — the check
  // names are a small fixed set (the five named checks). "none" when valid.
  const firstFailedCheck = checks.find((c) => !c.passed)?.name ?? "none";

  // Observability (B-RVP-001): one structured event per verification. A forged
  // or failed proof is the exact moment financial-truth infra must alert.
  // Defensively guarded so a throwing sink can never alter or abort the result.
  try {
    telemetry.record({
      package: "@attestia/proof",
      op: "proof.verify",
      level: valid ? "info" : "warn",
      outcome: valid ? "ok" : "failed",
      attributes: { valid, firstFailedCheck },
      message: valid
        ? "attestation proof package verified: all 5 checks passed"
        : `attestation proof package FAILED at check "${firstFailedCheck}" ` +
          `(${checks.filter((c) => !c.passed).length}/5 checks failed) — possible forgery or tampering`,
    });
  } catch {
    /* a sink must not break verification — see NOOP_TELEMETRY contract */
  }

  return {
    valid,
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
 * @param telemetry - Optional sink, forwarded to
 *   {@link verifyAttestationProofDetailed}. Defaults to a silent no-op sink.
 * @returns true if all checks pass
 */
export function verifyAttestationProof(
  pkg: AttestationProofPackage,
  telemetry: Telemetry = NOOP_TELEMETRY,
): boolean {
  return verifyAttestationProofDetailed(pkg, telemetry).valid;
}
