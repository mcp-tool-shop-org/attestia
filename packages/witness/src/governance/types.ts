/**
 * Multi-Sig Witness Governance Types
 *
 * Event-sourced governance state for N-of-M multi-signature witnessing.
 * All mutations are captured as events for deterministic replay.
 *
 * Design:
 * - All types are readonly
 * - Event-sourced: state is derived from replaying events
 * - Quorum model: M-of-N (M required signatures out of N total signers)
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * A signer in the governance policy.
 */
export interface SignerEntry {
  /** XRPL account address (r-address) */
  readonly address: string;

  /** Human-readable label for this signer */
  readonly label: string;

  /** Weight of this signer's vote (default: 1) */
  readonly weight: number;

  /** ISO 8601 timestamp when this signer was added */
  readonly addedAt: string;

  /**
   * Signer's XRPL public key (hex), used to cryptographically verify the
   * signer's signatures over the canonical payload hash before counting them
   * toward quorum (verify-then-count). When present, signature verification is
   * mandatory; when absent, the signer cannot be cryptographically verified at
   * the aggregation layer.
   */
  readonly publicKey?: string;
}

/**
 * The current governance policy.
 */
export interface GovernancePolicy {
  /** Unique policy ID (deterministic from event sequence) */
  readonly id: string;

  /** Version number (incremented on each change) */
  readonly version: number;

  /** All active signers */
  readonly signers: readonly SignerEntry[];

  /** Required quorum (total weight needed to approve) */
  readonly quorum: number;

  /** ISO 8601 timestamp of last policy change */
  readonly updatedAt: string;
}

/**
 * Result of a quorum check.
 */
export interface QuorumResult {
  /** Whether the quorum threshold was met */
  readonly met: boolean;

  /** Total weight of provided signatures */
  readonly totalWeight: number;

  /** Required weight (quorum threshold) */
  readonly requiredWeight: number;

  /** Addresses of signers who contributed */
  readonly signerAddresses: readonly string[];

  /** Addresses of signers who did not contribute */
  readonly missingAddresses: readonly string[];
}

// =============================================================================
// Governance Change Events (Event-Sourced)
// =============================================================================

/**
 * Discriminated union of all governance change events.
 * These events form the authoritative history of governance mutations.
 */
export type GovernanceChangeEvent =
  | SignerAddedEvent
  | SignerRemovedEvent
  | QuorumChangedEvent
  | PolicyRotatedEvent
  | SlaPolicySetEvent;

export interface SignerAddedEvent {
  readonly type: "signer_added";
  readonly address: string;
  readonly label: string;
  readonly weight: number;
  readonly timestamp: string;
  /** Signer's XRPL public key (hex), if registered for signature verification. */
  readonly publicKey?: string;
}

export interface SignerRemovedEvent {
  readonly type: "signer_removed";
  readonly address: string;
  readonly timestamp: string;
}

export interface QuorumChangedEvent {
  readonly type: "quorum_changed";
  readonly previousQuorum: number;
  readonly newQuorum: number;
  readonly timestamp: string;
}

export interface PolicyRotatedEvent {
  readonly type: "policy_rotated";
  readonly reason: string;
  readonly timestamp: string;
}

export interface SlaPolicySetEvent {
  readonly type: "sla_policy_set";
  readonly policyId: string;
  readonly policyName: string;
  readonly policyVersion: number;
  readonly targetCount: number;
  readonly timestamp: string;
}

// =============================================================================
// Type Guards
// =============================================================================

export function isSignerAddedEvent(e: GovernanceChangeEvent): e is SignerAddedEvent {
  return e.type === "signer_added";
}

export function isSignerRemovedEvent(e: GovernanceChangeEvent): e is SignerRemovedEvent {
  return e.type === "signer_removed";
}

export function isQuorumChangedEvent(e: GovernanceChangeEvent): e is QuorumChangedEvent {
  return e.type === "quorum_changed";
}

export function isPolicyRotatedEvent(e: GovernanceChangeEvent): e is PolicyRotatedEvent {
  return e.type === "policy_rotated";
}

export function isSlaPolicySetEvent(e: GovernanceChangeEvent): e is SlaPolicySetEvent {
  return e.type === "sla_policy_set";
}
