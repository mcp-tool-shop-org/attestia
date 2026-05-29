/**
 * @attestia/verify — Multi-Verifier Consensus.
 *
 * Aggregates multiple independent VerifierReports into a single
 * ConsensusResult using majority rule.
 *
 * Design:
 * - Pure functions, no I/O
 * - Majority rule: >50% PASS → consensus PASS
 * - Minimum verifier threshold (quorum) before consensus is valid
 * - Tracks dissenting verifiers for audit trail
 * - Deterministic: same reports → same consensus (minus timestamp)
 */

import type {
  VerifierReport,
  ConsensusResult,
  VerificationVerdict,
} from "./types.js";

// =============================================================================
// Public API
// =============================================================================

/**
 * Check whether enough verifier reports have been submitted
 * for consensus to be meaningful.
 *
 * @param reports - All submitted verifier reports
 * @param minimumVerifiers - Minimum number of verifiers required
 * @returns true if the minimum threshold is met
 */
export function isConsensusReached(
  reports: readonly VerifierReport[],
  minimumVerifiers: number,
): boolean {
  return reports.length >= minimumVerifiers;
}

/**
 * Aggregate multiple verifier reports into a consensus result.
 *
 * Rules:
 * - If >50% of verifiers report PASS, consensus is PASS
 * - If exactly 50/50, consensus is FAIL (conservative)
 * - Verifiers who disagree with the majority are listed as dissenters
 * - If no reports are provided, verdict is FAIL with 0 agreement
 *
 * The default `minimumVerifiers` of 1 is permissive: a caller that omits the
 * threshold can obtain a PASS from a single verifier. The default is retained
 * for backward compatibility, but any PASS reached with an applied quorum
 * threshold of <= 1 is flagged via `singleVerifierPass` so fail-closed callers
 * can refuse it and demand an explicit threshold of >= 2.
 *
 * @param reports - All submitted verifier reports
 * @param minimumVerifiers - Minimum verifiers before consensus is valid (default: 1, permissive — see above)
 * @returns ConsensusResult with verdict, counts, dissenters, and the weak-quorum flag
 */
export function aggregateVerifierReports(
  reports: readonly VerifierReport[],
  minimumVerifiers: number = 1,
): ConsensusResult {
  const total = reports.length;

  // A PASS is "single-verifier" (weak) when the applied quorum threshold is
  // <= 1, i.e. one verifier would have sufficed. Computed per-verdict below.
  const weakThreshold = minimumVerifiers <= 1;

  if (total === 0) {
    return {
      verdict: "FAIL",
      totalVerifiers: 0,
      passCount: 0,
      failCount: 0,
      agreementRatio: 0,
      quorumReached: false,
      singleVerifierPass: false,
      dissenters: [],
      consensusAt: new Date().toISOString(),
    };
  }

  const passCount = reports.filter((r) => r.verdict === "PASS").length;
  const failCount = total - passCount;

  const quorumReached = total >= minimumVerifiers;

  // Majority rule: strictly more than 50% must PASS for consensus PASS.
  // If quorum is not reached, verdict is always FAIL — a compromised single
  // verifier cannot approve anything when minimumVerifiers requires more.
  const verdict: VerificationVerdict =
    quorumReached && passCount > total / 2 ? "PASS" : "FAIL";

  // Dissenters are those who disagree with the majority verdict
  const dissenters = reports
    .filter((r) => r.verdict !== verdict)
    .map((r) => r.verifierId);

  // Agreement ratio: proportion of verifiers who agree with the verdict
  const majorityCount = verdict === "PASS" ? passCount : failCount;
  const agreementRatio = majorityCount / total;

  return {
    verdict,
    totalVerifiers: total,
    passCount,
    failCount,
    agreementRatio,
    quorumReached,
    // Flag a PASS that only required a lone verifier (weak quorum threshold).
    singleVerifierPass: verdict === "PASS" && weakThreshold,
    dissenters,
    consensusAt: new Date().toISOString(),
  };
}
