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

import { NOOP_TELEMETRY, type Telemetry } from "@attestia/types";
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
 * Sybil resistance (A-VERIFY-001): quorum and pass/fail tallies are computed
 * over DISTINCT `verifierId`s, never the raw report count. One actor submitting
 * N PASS reports under the same identity therefore counts as a single vote and
 * cannot forge a quorum. Multiple reports from the same identity are collapsed:
 * - if they all agree, the single agreed verdict is that verifier's vote;
 * - if they CONFLICT (e.g. one PASS, one FAIL), the verifier is counted as a
 *   FAIL vote (reject-on-conflict) — a self-contradicting verifier must not be
 *   able to swing consensus toward PASS.
 *
 * Bundle agreement (A-VERIFY-001): all counted reports must concern the SAME
 * `bundleHash`. A verifier that passed a different bundle proves nothing about
 * the bundle under consensus, so any disagreement on bundleHash among the
 * counted verifiers makes the consensus FAIL.
 *
 * Other rules:
 * - If >50% of distinct verifiers report PASS, consensus is PASS
 * - If exactly 50/50, consensus is FAIL (conservative)
 * - Verifiers who disagree with the majority verdict are listed as dissenters
 * - If no reports are provided, verdict is FAIL with 0 agreement
 *
 * The default `minimumVerifiers` of 1 is permissive: a caller that omits the
 * threshold can obtain a PASS from a single verifier. The default is retained
 * for backward compatibility, but any PASS reached with an applied quorum
 * threshold of <= 1 is flagged via `singleVerifierPass` so fail-closed callers
 * can refuse it and demand an explicit threshold of >= 2.
 *
 * @param reports - All submitted verifier reports
 * @param minimumVerifiers - Minimum DISTINCT verifiers before consensus is valid (default: 1, permissive — see above)
 * @param telemetry - Optional sink (B-RVP-001). When provided, one
 *   `"consensus.aggregate"` event is emitted with low-cardinality outcome
 *   labels. Side-channel only: never changes the verdict; a throwing sink is
 *   swallowed. Defaults to a silent no-op sink.
 * @returns ConsensusResult with verdict, counts, dissenters, a human-readable
 *   reason, and the weak-quorum flag
 */
export function aggregateVerifierReports(
  reports: readonly VerifierReport[],
  minimumVerifiers: number = 1,
  telemetry: Telemetry = NOOP_TELEMETRY,
): ConsensusResult {
  // A PASS is "single-verifier" (weak) when the applied quorum threshold is
  // <= 1, i.e. one verifier would have sufficed.
  const weakThreshold = minimumVerifiers <= 1;

  if (reports.length === 0) {
    const empty: ConsensusResult = {
      verdict: "FAIL",
      totalVerifiers: 0,
      passCount: 0,
      failCount: 0,
      agreementRatio: 0,
      quorumReached: false,
      singleVerifierPass: false,
      bundleAgreement: true,
      dissenters: [],
      reason: "no verifier reports submitted",
      consensusAt: new Date().toISOString(),
    };
    emitConsensus(telemetry, empty);
    return empty;
  }

  // ── Collapse reports to one vote per DISTINCT verifierId ──────────────────
  // Insertion order is preserved so dissenter ordering stays deterministic.
  interface Vote {
    verdict: VerificationVerdict;
    bundleHash: string;
    conflicted: boolean;
  }
  const byVerifier = new Map<string, Vote>();
  for (const r of reports) {
    const prior = byVerifier.get(r.verifierId);
    if (!prior) {
      byVerifier.set(r.verifierId, {
        verdict: r.verdict,
        bundleHash: r.bundleHash,
        conflicted: false,
      });
      continue;
    }
    // Reject-on-conflict: a verifier that submits disagreeing verdicts (or
    // verdicts against different bundles) is no longer trustworthy → FAIL vote.
    if (prior.verdict !== r.verdict || prior.bundleHash !== r.bundleHash) {
      prior.conflicted = true;
      prior.verdict = "FAIL";
    }
  }

  const votes = [...byVerifier.values()];
  const total = votes.length;

  // ── Bundle agreement: all counted verifiers must concern one bundleHash ───
  // (Conflicted verifiers are already FAIL; among the rest, a split on
  // bundleHash means the verifiers are not attesting to the same artifact.)
  const distinctBundles = new Set(votes.map((v) => v.bundleHash));
  const bundleAgreement = distinctBundles.size <= 1;

  const passCount = votes.filter((v) => v.verdict === "PASS").length;
  const failCount = total - passCount;

  const quorumReached = total >= minimumVerifiers;

  // Majority rule: strictly more than 50% of DISTINCT verifiers must PASS.
  // Quorum must be met AND all counted verifiers must agree on the bundleHash,
  // otherwise the verdict is FAIL — a compromised single verifier, a forged
  // quorum, or an off-bundle PASS cannot approve anything.
  const verdict: VerificationVerdict =
    quorumReached && bundleAgreement && passCount > total / 2 ? "PASS" : "FAIL";

  // Dissenters are distinct verifiers whose vote disagrees with the verdict.
  const dissenters = [...byVerifier.entries()]
    .filter(([, v]) => v.verdict !== verdict)
    .map(([verifierId]) => verifierId);

  // Agreement ratio: proportion of distinct verifiers who agree with the verdict
  const majorityCount = verdict === "PASS" ? passCount : failCount;
  const agreementRatio = majorityCount / total;

  // Human-readable reason (B-RVP-009). For a FAIL, name the SPECIFIC cause in
  // priority order so an operator knows the next step: wait for more verifiers
  // (quorum), investigate a bundle mismatch, or escalate a genuine dissent.
  // The conditions mirror the verdict computation above exactly.
  let reason: string;
  if (verdict === "PASS") {
    reason = `consensus PASS: ${passCount}/${total} distinct verifiers agree (quorum ${minimumVerifiers} met)`;
  } else if (!quorumReached) {
    reason = `quorum not reached: ${total} of ${minimumVerifiers} required distinct verifiers reported`;
  } else if (!bundleAgreement) {
    reason = `verifiers disagree on bundleHash (${distinctBundles.size} distinct bundles) — they are not attesting to the same artifact`;
  } else {
    reason = `majority did not pass: ${passCount}/${total} distinct verifiers reported PASS (need > ${total / 2})`;
  }

  const result: ConsensusResult = {
    verdict,
    totalVerifiers: total,
    passCount,
    failCount,
    agreementRatio,
    quorumReached,
    // Flag a PASS that only required a lone verifier (weak quorum threshold).
    singleVerifierPass: verdict === "PASS" && weakThreshold,
    bundleAgreement,
    dissenters,
    reason,
    consensusAt: new Date().toISOString(),
  };

  emitConsensus(telemetry, result);
  return result;
}

/**
 * Emit a `"consensus.aggregate"` telemetry event (B-RVP-001).
 *
 * Attributes are low-cardinality and safe as metric labels; raw verifier ids
 * (dissenters / bundle hashes) stay out of attributes — the human `reason`
 * carries the detail in `message`. Defensively guarded: a throwing sink must
 * never alter or abort the consensus verdict (the {@link Telemetry} contract
 * forbids throwing, but we do not trust a host to honor it).
 */
function emitConsensus(telemetry: Telemetry, result: ConsensusResult): void {
  try {
    telemetry.record({
      package: "@attestia/verify",
      op: "consensus.aggregate",
      level: result.verdict === "PASS" ? "info" : "warn",
      outcome: result.verdict === "PASS" ? "ok" : "failed",
      attributes: {
        verdict: result.verdict,
        totalVerifiers: result.totalVerifiers,
        passCount: result.passCount,
        failCount: result.failCount,
        quorumReached: result.quorumReached,
        bundleAgreement: result.bundleAgreement,
        dissenterCount: result.dissenters.length,
        singleVerifierPass: result.singleVerifierPass,
      },
      message: `verifier consensus ${result.verdict.toLowerCase()}: ${result.reason}`,
    });
  } catch {
    /* a sink must not break consensus — see NOOP_TELEMETRY contract */
  }
}
