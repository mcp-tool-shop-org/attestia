/**
 * Canonical Signing and Signature Aggregation
 *
 * Deterministic payload construction and multi-signature aggregation
 * for N-of-M governance quorum enforcement.
 *
 * Design:
 * - RFC 8785 (JCS) canonical JSON serialization
 * - SHA-256 content addressing
 * - Lexicographic signature ordering for determinism
 * - Quorum verification before aggregation
 */

import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { verifyKeypairSignature, deriveAddress } from "xrpl";
import { sign as rippleSign } from "ripple-keypairs";
import type { AttestationPayload } from "../types.js";
import type { GovernancePolicy, SignerEntry, QuorumResult } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A single signer's signature contribution.
 */
export interface SignerSignature {
  /** Signer's XRPL address */
  readonly address: string;

  /** Hex-encoded signature bytes */
  readonly signature: string;

  /** ISO 8601 timestamp when signature was created */
  readonly signedAt: string;
}

/**
 * A function that cryptographically verifies a single signer's signature
 * over the canonical payload hash, against that signer's registered policy entry.
 *
 * Returns `true` only when the signature is a valid cryptographic signature of
 * `payloadHash` produced by the key registered for `signer`. Returns `false`
 * (or throws) for any signature that does not verify — fabricated, replayed,
 * or signed by a different key.
 *
 * @param sig The signature contribution to verify
 * @param payloadHash The canonical signing payload hash that should have been signed
 * @param signer The signer's registered governance entry (source of the public key)
 */
export type SignatureVerifier = (
  sig: SignerSignature,
  payloadHash: string,
  signer: SignerEntry,
) => boolean;

/**
 * Options for {@link aggregateSignatures}.
 */
export interface AggregateOptions {
  /**
   * Cryptographic signature verifier (verify-then-count).
   *
   * When provided, each signature MUST verify against the registered signer's
   * public key over `payloadHash` BEFORE its weight counts toward quorum.
   * Use {@link xrplSignatureVerifier} for real XRPL secp256k1/ed25519 verification.
   *
   * Fail-closed rule: if any signer in the policy carries a `publicKey`, a
   * verifier is REQUIRED — calling without one throws, so a registered key is
   * never silently bypassed.
   */
  readonly verify?: SignatureVerifier;
}

/**
 * An aggregated multi-signature payload.
 */
export interface AggregatedSignature {
  /** The canonical signing payload hash */
  readonly payloadHash: string;

  /** All individual signatures, ordered lexicographically by address */
  readonly signatures: readonly SignerSignature[];

  /** Quorum check result */
  readonly quorum: QuorumResult;

  /** ISO 8601 timestamp when aggregation was completed */
  readonly aggregatedAt: string;
}

// =============================================================================
// Canonical Signing Payload
// =============================================================================

/**
 * Build a canonical signing payload from an attestation and governance policy.
 *
 * The payload is deterministic: same attestation + same policy → same bytes.
 * Uses RFC 8785 (JCS) for canonical JSON, then SHA-256 for the hash.
 *
 * @param attestation The attestation payload to sign
 * @param policy The governance policy at the time of signing
 * @returns SHA-256 hash of the canonical signing payload
 */
export function buildCanonicalSigningPayload(
  attestation: AttestationPayload,
  policy: GovernancePolicy,
): string {
  const payload = {
    attestationHash: attestation.hash,
    attestationTimestamp: attestation.timestamp,
    policyId: policy.id,
    policyVersion: policy.version,
    quorum: policy.quorum,
    signers: policy.signers.map((s) => s.address).sort(),
  };

  const canonical = canonicalize(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

// =============================================================================
// Cryptographic Signing & Verification (D3-A-003)
// =============================================================================

/**
 * Encode the canonical payload hash as the hex message that signers sign.
 *
 * The signed message is the UTF-8 bytes of the canonical payload-hash hex
 * string, themselves hex-encoded (the form `ripple-keypairs` / XRPL crypto
 * expects). Signing and verification MUST agree on this encoding.
 */
export function encodePayloadHashForSigning(payloadHash: string): string {
  return Buffer.from(payloadHash, "utf8").toString("hex").toUpperCase();
}

/**
 * Produce a real cryptographic signature over the canonical payload hash.
 *
 * Used by the multi-sig submitter so each signer contributes a signature that
 * is genuinely verifiable against their registered public key — not the XRPL
 * transaction hash (which carries no proof of the signer's intent over the
 * payload). The result is hex and can be verified with {@link xrplSignatureVerifier}.
 *
 * @param payloadHash The canonical signing payload hash to sign
 * @param privateKey The signer's XRPL private key (hex, e.g. from Wallet.privateKey)
 * @returns Hex-encoded signature over the payload hash
 */
export function signPayloadHash(payloadHash: string, privateKey: string): string {
  return rippleSign(encodePayloadHashForSigning(payloadHash), privateKey);
}

/**
 * Real XRPL signature verifier.
 *
 * Verifies that `sig.signature` is a valid cryptographic signature of
 * `payloadHash` produced by `signer.publicKey`, and that the public key
 * actually corresponds to the registered signer address (defence against a
 * signer entry whose `publicKey` does not match its `address`).
 *
 * Returns `false` (never throws) for malformed signatures, missing public keys,
 * key/address mismatches, or signatures that do not verify — so a non-verifying
 * contribution simply does not count toward quorum.
 */
export const xrplSignatureVerifier: SignatureVerifier = (sig, payloadHash, signer) => {
  // A signer without a registered public key cannot be cryptographically
  // verified at this layer — fail closed (do not count).
  if (!signer.publicKey) {
    return false;
  }

  // The registered public key must derive to the registered signer address.
  try {
    if (deriveAddress(signer.publicKey) !== signer.address) {
      return false;
    }
  } catch {
    return false;
  }

  const message = encodePayloadHashForSigning(payloadHash);
  try {
    return verifyKeypairSignature(message, sig.signature, signer.publicKey);
  } catch {
    // Malformed signature bytes, wrong length, etc. — does not verify.
    return false;
  }
};

// =============================================================================
// Signature Ordering
// =============================================================================

/**
 * Order signatures lexicographically by signer address.
 *
 * This ensures deterministic ordering regardless of the order
 * in which signatures were collected.
 *
 * @param signatures Unordered signatures
 * @returns Signatures ordered by address (ascending)
 */
export function orderSignatures(
  signatures: readonly SignerSignature[],
): readonly SignerSignature[] {
  return [...signatures].sort((a, b) => a.address.localeCompare(b.address));
}

// =============================================================================
// Signature Aggregation
// =============================================================================

/**
 * Aggregate individual signatures into a multi-signature payload.
 *
 * Verifies, in order:
 * 1. No duplicate signatures (same address)
 * 2. All signers are in the policy
 * 3. **Cryptographic verification (verify-then-count):** every signature must
 *    verify over `payloadHash` against the signer's registered public key
 *    BEFORE its weight counts toward quorum. A fabricated, replayed, or
 *    wrong-key signature is rejected and contributes zero weight.
 * 4. Quorum is met by the verified weight only.
 *
 * Fail-closed rule: if any signer in the policy carries a `publicKey`, an
 * {@link AggregateOptions.verify} function is REQUIRED — calling without one
 * throws, so registered keys are never silently bypassed. When no signer has a
 * public key and no verifier is supplied, the function falls back to structural
 * checks (legacy behaviour) — but the secure call sites
 * (multi-sig submitter, historical-quorum validation) always supply a verifier.
 *
 * @param signatures Individual signer signatures
 * @param policy The governance policy to verify against
 * @param payloadHash The canonical signing payload hash that was signed
 * @param options Optional cryptographic verifier (see {@link AggregateOptions})
 * @returns Aggregated signature with quorum result
 * @throws If quorum is not met (by verified weight)
 * @throws If duplicate signatures are found
 * @throws If a signer is not in the policy
 * @throws If the policy registers public keys but no verifier is supplied
 */
export function aggregateSignatures(
  signatures: readonly SignerSignature[],
  policy: GovernancePolicy,
  payloadHash: string,
  options: AggregateOptions = {},
): AggregatedSignature {
  // Check for duplicate signers
  const addresses = signatures.map((s) => s.address);
  const uniqueAddresses = new Set(addresses);
  if (uniqueAddresses.size !== addresses.length) {
    const duplicates = addresses.filter(
      (addr, idx) => addresses.indexOf(addr) !== idx,
    );
    throw new Error(
      `Duplicate signatures from: ${[...new Set(duplicates)].join(", ")}`,
    );
  }

  // Verify all signers are in the policy
  const signerByAddress = new Map(policy.signers.map((s) => [s.address, s]));
  for (const addr of addresses) {
    if (!signerByAddress.has(addr)) {
      throw new Error(`Signer ${addr} is not in the governance policy`);
    }
  }

  // Fail-closed: a policy that registers public keys MUST be verified.
  const verify = options.verify;
  const policyHasPublicKeys = policy.signers.some((s) => s.publicKey);
  if (policyHasPublicKeys && !verify) {
    throw new Error(
      "aggregateSignatures: governance policy registers signer public keys but " +
      "no signature verifier was supplied. Refusing to count unverified signatures " +
      "(pass options.verify, e.g. xrplSignatureVerifier).",
    );
  }

  // Verify-then-count: only signatures that cryptographically verify over the
  // canonical payloadHash against their registered key contribute weight.
  let totalWeight = 0;
  const countedAddresses = new Set<string>();
  for (const sig of signatures) {
    const signer = signerByAddress.get(sig.address)!;
    if (verify) {
      const ok = verify(sig, payloadHash, signer);
      if (!ok) {
        // Do not count an unverifiable signature toward quorum.
        continue;
      }
    }
    totalWeight += signer.weight;
    countedAddresses.add(sig.address);
  }

  const allPolicyAddresses = policy.signers.map((s) => s.address);
  const missingAddresses = allPolicyAddresses.filter((addr) => !countedAddresses.has(addr));

  const quorum: QuorumResult = {
    met: totalWeight >= policy.quorum,
    totalWeight,
    requiredWeight: policy.quorum,
    signerAddresses: [...countedAddresses],
    missingAddresses,
  };

  if (!quorum.met) {
    throw new Error(
      `Quorum not met: ${totalWeight} of ${policy.quorum} verified weight ` +
      `(${countedAddresses.size} of ${policy.signers.length} signers verified)`,
    );
  }

  // Only retain the signatures that actually counted toward quorum.
  const counted = signatures.filter((s) => countedAddresses.has(s.address));

  return {
    payloadHash,
    signatures: orderSignatures(counted),
    quorum,
    aggregatedAt: new Date().toISOString(),
  };
}
