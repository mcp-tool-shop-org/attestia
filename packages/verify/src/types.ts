/**
 * @attestia/verify — Types for deterministic verification.
 *
 * These types define the verification protocol:
 * - GlobalStateHash: content-addressed hash combining all subsystem snapshots
 * - VerificationResult: pass/fail verdict with structured evidence
 * - ReplayContext: inputs needed to deterministically reproduce state
 */

import type { LedgerSnapshot } from "@attestia/ledger";
import type { RegistrarSnapshotV1 } from "@attestia/registrum";
import type { Telemetry } from "@attestia/types";

// Re-export for convenience (used by state-bundle consumers)
export type { LedgerSnapshot } from "@attestia/ledger";
export type { RegistrarSnapshotV1 } from "@attestia/registrum";

// =============================================================================
// Global State Hash
// =============================================================================

/**
 * A GlobalStateHash is a single SHA-256 digest that covers
 * the entire system state at a point in time.
 *
 * Computed from canonical JSON of all subsystem snapshots.
 * If any bit of any subsystem changes, the hash changes.
 */
export interface GlobalStateHash {
  /** SHA-256 hex digest (64 characters, lowercase) */
  readonly hash: string;

  /** ISO 8601 timestamp of when the hash was computed */
  readonly computedAt: string;

  /** Individual subsystem hashes for audit trail */
  readonly subsystems: {
    readonly ledger: string;
    readonly registrum: string;
    /** Optional per-chain observer hashes (added in Phase 11) */
    readonly chains?: Record<string, string>;
  };
}

// =============================================================================
// Verification
// =============================================================================

/**
 * Verdict from a verification check.
 */
export type VerificationVerdict = "PASS" | "FAIL";

/**
 * A single discrepancy found during verification.
 */
export interface VerificationDiscrepancy {
  /** Which subsystem had the mismatch */
  readonly subsystem: "ledger" | "registrum" | "global";

  /** What was expected */
  readonly expected: string;

  /** What was actually found */
  readonly actual: string;

  /** Human-readable description */
  readonly description: string;
}

/**
 * Result of a verification operation.
 */
export interface VerificationResult {
  /** Overall verdict */
  readonly verdict: VerificationVerdict;

  /** The GlobalStateHash that was verified */
  readonly globalHash: GlobalStateHash;

  /** Any discrepancies found (empty if verdict = PASS) */
  readonly discrepancies: readonly VerificationDiscrepancy[];

  /** ISO 8601 timestamp of verification */
  readonly verifiedAt: string;
}

// =============================================================================
// Replay
// =============================================================================

/**
 * Replay input: the raw events/actions needed to reproduce state.
 */
export interface ReplayInput {
  /** Ledger snapshot to verify against */
  readonly ledgerSnapshot: LedgerSnapshot;

  /** Registrum snapshot to verify against */
  readonly registrumSnapshot: RegistrarSnapshotV1;

  /** Expected GlobalStateHash (optional — if provided, verifies match) */
  readonly expectedHash?: string;
}

/**
 * Result of replaying state from snapshots.
 */
export interface ReplayResult {
  /** Whether replay produced identical state */
  readonly verdict: VerificationVerdict;

  /** Hash of the replayed state */
  readonly replayedHash: GlobalStateHash;

  /** Hash of the original state */
  readonly originalHash: GlobalStateHash;

  /** Discrepancies found during replay */
  readonly discrepancies: readonly VerificationDiscrepancy[];
}

// =============================================================================
// Exportable State Bundle (Phase 12)
// =============================================================================

/**
 * A self-contained, exportable bundle of system state.
 *
 * Contains everything an external verifier needs to independently
 * verify the system's integrity without trusting the operator.
 *
 * The bundleHash is a SHA-256 digest of the canonical form of all
 * internal hashes, providing tamper evidence for the bundle itself.
 */
export interface ExportableStateBundle {
  /** Version identifier for bundle format */
  readonly version: 1;

  /** Ledger snapshot at time of export */
  readonly ledgerSnapshot: LedgerSnapshot;

  /** Registrum snapshot at time of export */
  readonly registrumSnapshot: RegistrarSnapshotV1;

  /** The GlobalStateHash computed from the snapshots */
  readonly globalStateHash: GlobalStateHash;

  /** SHA-256 hashes of all events in the event store (ordered) */
  readonly eventHashes: readonly string[];

  /** Optional per-chain observer hashes */
  readonly chainHashes?: Record<string, string>;

  /** ISO 8601 timestamp of when the bundle was exported */
  readonly exportedAt: string;

  /**
   * SHA-256 of canonical(globalStateHash.hash, eventHashes, chainHashes).
   * Tamper-evidence for the bundle itself.
   */
  readonly bundleHash: string;
}

/**
 * Result of verifying a state bundle's internal consistency.
 */
export interface BundleVerificationResult {
  /** Overall verdict */
  readonly verdict: VerificationVerdict;

  /** Whether the bundleHash is consistent with contents */
  readonly bundleHashValid: boolean;

  /** Whether the globalStateHash matches recomputed hash from snapshots */
  readonly globalHashValid: boolean;

  /** Any discrepancies found */
  readonly discrepancies: readonly string[];

  /** ISO 8601 timestamp of verification */
  readonly verifiedAt: string;
}

// =============================================================================
// External Verification (Phase 12)
// =============================================================================

/**
 * Configuration for an external verifier.
 */
export interface VerifierConfig {
  /** Unique identity of this verifier */
  readonly verifierId: string;

  /** Human-readable label for the verifier */
  readonly label?: string;

  /** If true, missing optional fields (e.g., chainHashes) cause FAIL */
  readonly strictMode?: boolean;

  /**
   * Optional telemetry sink. When provided, {@link runVerification} emits a
   * `"verify.phase"` event per verification phase (bundle integrity, replay,
   * subsystem hashes, global hash, …) with low-cardinality
   * `{ phase, passed }` attributes, making large-bundle verification
   * observable. Telemetry is a side channel: it never changes the verdict, and
   * omitting it emits nothing (the verifier defaults to a no-op sink).
   */
  readonly telemetry?: Telemetry;
}

/**
 * A subsystem-level check within a verifier report.
 */
export interface SubsystemCheck {
  /** Name of the subsystem */
  readonly subsystem: string;

  /** Expected hash */
  readonly expected: string;

  /** Actual (recomputed) hash */
  readonly actual: string;

  /** Whether they match */
  readonly matches: boolean;
}

/**
 * Report produced by an external verifier after verifying a state bundle.
 */
export interface VerifierReport {
  /** Unique report ID */
  readonly reportId: string;

  /** Identity of the verifier */
  readonly verifierId: string;

  /** Overall verdict */
  readonly verdict: VerificationVerdict;

  /** Per-subsystem hash comparisons */
  readonly subsystemChecks: readonly SubsystemCheck[];

  /** Any discrepancies found */
  readonly discrepancies: readonly string[];

  /** Hash of the bundle that was verified */
  readonly bundleHash: string;

  /** ISO 8601 timestamp of verification */
  readonly verifiedAt: string;
}

/**
 * Result of aggregating multiple verifier reports into a consensus.
 */
export interface ConsensusResult {
  /** Overall consensus verdict */
  readonly verdict: VerificationVerdict;

  /** Number of verifiers who reported */
  readonly totalVerifiers: number;

  /** Number who reported PASS */
  readonly passCount: number;

  /** Number who reported FAIL */
  readonly failCount: number;

  /** Agreement ratio (0-1) */
  readonly agreementRatio: number;

  /**
   * Whether the minimum DISTINCT-verifier threshold was met. Quorum is computed
   * over unique `verifierId`s, so duplicate reports from one identity count as a
   * single verifier and cannot forge a quorum (A-VERIFY-001).
   */
  readonly quorumReached: boolean;

  /**
   * True when the verdict is PASS but the quorum threshold that was applied
   * was <= 1 — i.e. a single verifier was sufficient to approve. Such a PASS
   * offers no protection against a compromised lone verifier; fail-closed
   * callers should refuse it and require an explicit minimumVerifiers >= 2.
   * Always false for a FAIL verdict.
   */
  readonly singleVerifierPass: boolean;

  /**
   * True when all counted (distinct) verifiers attested to the SAME
   * `bundleHash`. When false, the verifiers disagree on which bundle they
   * verified, so the consensus is forced to FAIL — a verifier passing a
   * different bundle proves nothing about the bundle under consensus
   * (A-VERIFY-001). Vacuously true for an empty report set.
   */
  readonly bundleAgreement: boolean;

  /** Verifier IDs that dissented from the majority */
  readonly dissenters: readonly string[];

  /**
   * Human-readable explanation of the verdict, mirroring the SLA /
   * tenant-governance convention (B-RVP-009). For a PASS it states the margin;
   * for a FAIL it names the SPECIFIC cause — no reports, quorum not reached,
   * bundle disagreement, or majority-not-PASS — so an on-call engineer gets an
   * actionable next step without decoding the numeric fields. Always present.
   */
  readonly reason: string;

  /** ISO 8601 timestamp */
  readonly consensusAt: string;
}
