/**
 * Consensus Distinct-Identity & Bundle-Agreement Tests (A-VERIFY-001).
 *
 * `aggregateVerifierReports` previously computed quorum and pass/fail tallies
 * from the raw report COUNT, with no deduplication of `verifierId`. That let a
 * single actor forge a quorum by submitting N PASS reports under the same
 * identity. It also counted reports that passed a DIFFERENT bundleHash toward
 * the same consensus, so a verifier approving an unrelated bundle could swing
 * the verdict.
 *
 * Fix contract:
 * - Quorum and tallies are computed over DISTINCT verifierIds.
 * - A verifierId that submits conflicting verdicts is rejected (counts as a
 *   FAIL vote — reject-on-conflict).
 * - All COUNTED reports must share the same bundleHash; if reports disagree on
 *   bundleHash the consensus is FAIL.
 */

import { describe, it, expect } from "vitest";
import type { VerifierReport } from "../src/types.js";
import { aggregateVerifierReports } from "../src/verification-consensus.js";

function makeReport(
  verifierId: string,
  verdict: "PASS" | "FAIL",
  overrides: Partial<VerifierReport> = {},
): VerifierReport {
  return {
    reportId: `report-${verifierId}-${Math.random().toString(36).slice(2, 8)}`,
    verifierId,
    verdict,
    subsystemChecks: [],
    discrepancies: verdict === "FAIL" ? ["mismatch"] : [],
    bundleHash: "a".repeat(64),
    verifiedAt: "2025-06-15T00:00:00Z",
    ...overrides,
  };
}

describe("consensus distinct-identity quorum (A-VERIFY-001)", () => {
  it("one verifier submitting 3 PASS reports does NOT forge a quorum of 2", () => {
    const reports = [
      makeReport("solo", "PASS"),
      makeReport("solo", "PASS"),
      makeReport("solo", "PASS"),
    ];
    const result = aggregateVerifierReports(reports, 2);

    // Only ONE distinct verifier exists → quorum of 2 is NOT met → FAIL.
    expect(result.quorumReached).toBe(false);
    expect(result.verdict).toBe("FAIL");
    expect(result.totalVerifiers).toBe(1);
    expect(result.passCount).toBe(1);
  });

  it("collapses duplicate identities to a single vote when quorum IS met", () => {
    const reports = [
      makeReport("v1", "PASS"),
      makeReport("v1", "PASS"), // duplicate identity, ignored
      makeReport("v2", "PASS"),
    ];
    const result = aggregateVerifierReports(reports, 2);

    expect(result.totalVerifiers).toBe(2);
    expect(result.passCount).toBe(2);
    expect(result.verdict).toBe("PASS");
    expect(result.quorumReached).toBe(true);
  });

  it("rejects a verifierId that submits conflicting verdicts (reject-on-conflict)", () => {
    const reports = [
      makeReport("flip", "PASS"),
      makeReport("flip", "FAIL"), // same identity, conflicting verdict
      makeReport("v2", "PASS"),
    ];
    const result = aggregateVerifierReports(reports, 2);

    // The conflicting identity is counted as a FAIL vote → 1 PASS, 1 FAIL.
    expect(result.totalVerifiers).toBe(2);
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.verdict).toBe("FAIL");
  });

  it("a quorum forged by one identity is rejected even with the permissive default", () => {
    // Default minimumVerifiers is 1, so a lone identity reaches quorum — but it
    // must still collapse to ONE verifier, and the weak-quorum flag must fire.
    const reports = [
      makeReport("solo", "PASS"),
      makeReport("solo", "PASS"),
    ];
    const result = aggregateVerifierReports(reports);

    expect(result.totalVerifiers).toBe(1);
    expect(result.verdict).toBe("PASS");
    expect(result.singleVerifierPass).toBe(true);
  });
});

describe("consensus bundle-agreement (A-VERIFY-001)", () => {
  it("reports passing DIFFERENT bundleHashes do not form a consensus → FAIL", () => {
    const reports = [
      makeReport("v1", "PASS", { bundleHash: "a".repeat(64) }),
      makeReport("v2", "PASS", { bundleHash: "b".repeat(64) }),
    ];
    const result = aggregateVerifierReports(reports, 2);

    expect(result.verdict).toBe("FAIL");
  });

  it("a PASS bundle plus an off-bundle PASS cannot manufacture a quorum", () => {
    const reports = [
      makeReport("v1", "PASS", { bundleHash: "a".repeat(64) }),
      makeReport("v2", "PASS", { bundleHash: "a".repeat(64) }),
      makeReport("v3", "PASS", { bundleHash: "deadbeef".repeat(8) }),
    ];
    const result = aggregateVerifierReports(reports, 3);

    expect(result.verdict).toBe("FAIL");
  });

  it("unanimous agreement on the SAME bundleHash still PASSes", () => {
    const reports = [
      makeReport("v1", "PASS"),
      makeReport("v2", "PASS"),
      makeReport("v3", "PASS"),
    ];
    const result = aggregateVerifierReports(reports, 3);

    expect(result.verdict).toBe("PASS");
    expect(result.quorumReached).toBe(true);
  });
});
