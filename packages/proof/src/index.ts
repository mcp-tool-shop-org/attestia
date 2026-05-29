/**
 * @attestia/proof — Cryptographic proof packaging for Attestia.
 *
 * Merkle trees over event sets, inclusion proofs, and
 * self-contained attestation proof packages.
 *
 * @packageDocumentation
 */

// Types
export type {
  SiblingDirection,
  MerkleProofStep,
  MerkleProof,
  MerkleNode,
  AttestationProofPackage,
} from "./types.js";

// Merkle tree
export { MerkleTree } from "./merkle-tree.js";

// Attestation proof packaging
export {
  hashAttestation,
  packageAttestationProof,
  verifyAttestationProof,
  verifyAttestationProofDetailed,
} from "./attestation-proof.js";

export type {
  AttestationCheck,
  AttestationVerificationResult,
} from "./attestation-proof.js";
