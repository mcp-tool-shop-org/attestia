/**
 * Registrum–Governance Bridge
 *
 * Links the governance policy to Registrum state, ensuring that
 * attestations are authorized by the correct governance policy.
 *
 * Core responsibilities:
 * - Validate that a governance policy is authoritative for a Registrum state
 * - Replay governance history to rebuild policy at any point in time
 * - Validate that historical attestations had valid quorum at the time
 *
 * Design:
 * - Structural validation only — no cryptographic signature verification
 * - Fail-closed: any ambiguity → rejection
 * - Deterministic: same events → same validation result
 */

import { GovernanceStore } from "./governance-store.js";
import type {
  GovernancePolicy,
  GovernanceChangeEvent,
  QuorumResult,
} from "./types.js";
import type { AttestationPayload } from "../types.js";
import type { SignerSignature, SignatureVerifier } from "./signing.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal Registrum state reference for authority validation.
 */
export interface RegistrumStateRef {
  /** The Registrum state ID */
  readonly stateId: string;

  /** Order index in the Registrum sequence */
  readonly orderIndex: number;

  /** The expected governance policy ID */
  readonly policyId: string;

  /** The expected governance policy version */
  readonly policyVersion: number;
}

/**
 * Result of validating governance authority.
 */
export interface AuthorityValidation {
  /** Whether the policy is authoritative for the Registrum state */
  readonly valid: boolean;

  /** The policy used for validation */
  readonly policy: GovernancePolicy;

  /** The Registrum state ref validated against */
  readonly stateRef: RegistrumStateRef;

  /** Reasons for rejection (empty if valid) */
  readonly rejections: readonly string[];
}

/**
 * Options for {@link validateHistoricalQuorum}.
 */
export interface HistoricalQuorumOptions {
  /**
   * Cryptographic signature verifier (verify-then-count). When supplied,
   * each signature must verify over `payloadHash` against the signer's
   * registered public key before its weight counts toward quorum.
   */
  readonly verify?: SignatureVerifier;

  /**
   * The canonical signing payload hash the signatures were produced over.
   * Required when `verify` is supplied.
   */
  readonly payloadHash?: string;
}

/**
 * Result of validating historical quorum.
 */
export interface HistoricalQuorumValidation {
  /** Whether the attestation had valid quorum at the time */
  readonly valid: boolean;

  /** The policy that was active at the time */
  readonly policyAtTime: GovernancePolicy;

  /** The quorum result */
  readonly quorum: QuorumResult;

  /** Reasons for rejection (empty if valid) */
  readonly rejections: readonly string[];
}

// =============================================================================
// Authority Validation
// =============================================================================

/**
 * Validate that a governance policy is authoritative for a Registrum state.
 *
 * Checks:
 * 1. Policy ID matches the expected policy ID
 * 2. Policy version matches the expected version
 * 3. Policy has at least one signer
 * 4. Quorum is achievable (quorum <= total weight)
 *
 * @param policy The governance policy to validate
 * @param stateRef The Registrum state reference
 * @returns AuthorityValidation result
 */
export function validateAuthority(
  policy: GovernancePolicy,
  stateRef: RegistrumStateRef,
): AuthorityValidation {
  const rejections: string[] = [];

  // Policy ID must match
  if (policy.id !== stateRef.policyId) {
    rejections.push(
      `Policy ID mismatch: expected ${stateRef.policyId}, got ${policy.id}`,
    );
  }

  // Policy version must match
  if (policy.version !== stateRef.policyVersion) {
    rejections.push(
      `Policy version mismatch: expected ${stateRef.policyVersion}, got ${policy.version}`,
    );
  }

  // Policy must have at least one signer
  if (policy.signers.length === 0) {
    rejections.push("Policy has no signers");
  }

  // Quorum must be achievable
  const totalWeight = policy.signers.reduce((sum, s) => sum + s.weight, 0);
  if (policy.quorum > totalWeight) {
    rejections.push(
      `Quorum (${policy.quorum}) exceeds total signer weight (${totalWeight})`,
    );
  }

  return {
    valid: rejections.length === 0,
    policy,
    stateRef,
    rejections,
  };
}

// =============================================================================
// Governance History Replay
// =============================================================================

/**
 * Replay a governance event history to rebuild the policy state.
 *
 * This is the foundation of event-sourced governance: the current state
 * is derived entirely from the ordered event history. Replaying the same
 * events always produces the same policy.
 *
 * @param events The ordered governance event history
 * @returns The rebuilt governance policy
 */
export function replayGovernanceHistory(
  events: readonly GovernanceChangeEvent[],
): GovernancePolicy {
  const store = new GovernanceStore();
  store.replayFrom(events);
  return store.getCurrentPolicy();
}

/**
 * Replay governance history up to a specific version.
 *
 * Useful for reconstructing the policy that was active at a given point
 * in time (identified by version number = number of events applied).
 *
 * @param events The full governance event history
 * @param targetVersion The version to replay up to (inclusive)
 * @returns The policy at the target version
 * @throws If targetVersion exceeds the number of events
 */
export function replayToVersion(
  events: readonly GovernanceChangeEvent[],
  targetVersion: number,
): GovernancePolicy {
  if (targetVersion < 0) {
    throw new Error(`Target version must be >= 0, got ${targetVersion}`);
  }
  if (targetVersion > events.length) {
    throw new Error(
      `Target version ${targetVersion} exceeds event history length ${events.length}`,
    );
  }

  const store = new GovernanceStore();
  store.replayFrom(events.slice(0, targetVersion));
  return store.getCurrentPolicy();
}

// =============================================================================
// Historical Quorum Validation
// =============================================================================

/**
 * Validate that an attestation had valid quorum at the time it was created.
 *
 * Reconstructs the governance policy that was active at the given version,
 * then verifies that the provided signatures meet the quorum requirements
 * of that historical policy.
 *
 * @param attestation The attestation payload to validate
 * @param signatures The signatures that were collected at the time
 * @param events The full governance event history
 * @param policyVersion The policy version that was active when signed
 * @param options Optional cryptographic verifier (see {@link HistoricalQuorumOptions}).
 *   When supplied, each signature must verify over the canonical `payloadHash`
 *   against the signer's registered public key before counting toward quorum
 *   (verify-then-count); entries lacking a verifiable signature are rejected.
 * @returns HistoricalQuorumValidation result
 */
export function validateHistoricalQuorum(
  _attestation: AttestationPayload,
  signatures: readonly SignerSignature[],
  events: readonly GovernanceChangeEvent[],
  policyVersion: number,
  options: HistoricalQuorumOptions = {},
): HistoricalQuorumValidation {
  const rejections: string[] = [];

  // Replay to the historical policy version
  let policyAtTime: GovernancePolicy;
  try {
    policyAtTime = replayToVersion(events, policyVersion);
  } catch (err) {
    return {
      valid: false,
      policyAtTime: { id: "", version: 0, signers: [], quorum: 1, updatedAt: "" },
      quorum: {
        met: false,
        totalWeight: 0,
        requiredWeight: 0,
        signerAddresses: [],
        missingAddresses: [],
      },
      rejections: [`Failed to replay to version ${policyVersion}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const signerByAddress = new Map(policyAtTime.signers.map((s) => [s.address, s]));

  // Validate each signer was in the policy at that time
  for (const sig of signatures) {
    if (!signerByAddress.has(sig.address)) {
      rejections.push(
        `Signer ${sig.address} was not in policy at version ${policyVersion}`,
      );
    }
  }

  // Check for duplicates
  const uniqueAddresses = new Set(signatures.map((s) => s.address));
  if (uniqueAddresses.size !== signatures.length) {
    rejections.push("Duplicate signatures detected");
  }

  // Fail-closed: a policy that registers public keys MUST be verified.
  const { verify, payloadHash } = options;
  const policyHasPublicKeys = policyAtTime.signers.some((s) => s.publicKey);
  if (policyHasPublicKeys && !verify) {
    rejections.push(
      "Policy at version registers signer public keys but no signature verifier was supplied; " +
      "refusing to count unverified signatures.",
    );
  }
  if (verify && payloadHash === undefined) {
    rejections.push(
      "A signature verifier was supplied without a payloadHash; cannot verify signatures.",
    );
  }

  // Verify-then-count: only signatures that verify over payloadHash against the
  // signer's registered key contribute weight. Without a verifier this falls
  // back to structural weight (legacy callers).
  let totalWeight = 0;
  const countedAddresses = new Set<string>();
  const canVerify = Boolean(verify) && payloadHash !== undefined;
  for (const sig of signatures) {
    const signer = signerByAddress.get(sig.address);
    if (!signer) continue; // already rejected above
    if (canVerify) {
      const ok = verify!(sig, payloadHash!, signer);
      if (!ok) {
        rejections.push(
          `Signature from ${sig.address} failed cryptographic verification`,
        );
        continue;
      }
    }
    if (!countedAddresses.has(sig.address)) {
      totalWeight += signer.weight;
      countedAddresses.add(sig.address);
    }
  }

  const allPolicyAddresses = policyAtTime.signers.map((s) => s.address);
  const missingAddresses = allPolicyAddresses.filter(
    (addr) => !countedAddresses.has(addr),
  );

  const quorum: QuorumResult = {
    met: totalWeight >= policyAtTime.quorum,
    totalWeight,
    requiredWeight: policyAtTime.quorum,
    signerAddresses: [...countedAddresses],
    missingAddresses,
  };

  if (!quorum.met) {
    rejections.push(
      `Quorum not met: ${totalWeight} of ${policyAtTime.quorum} required weight`,
    );
  }

  return {
    valid: rejections.length === 0,
    policyAtTime,
    quorum,
    rejections,
  };
}
