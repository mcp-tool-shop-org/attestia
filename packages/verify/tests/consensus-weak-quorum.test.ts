/**
 * Consensus Weak-Quorum Tests (D5-A-005).
 *
 * `aggregateVerifierReports` defaults `minimumVerifiers = 1`. A caller that
 * omits the threshold therefore gets a PASS verdict from a SINGLE verifier —
 * a compromised lone verifier can self-approve. The default cannot be removed
 * without breaking existing callers, so the ConsensusResult must explicitly
 * flag a PASS that was reached with a quorum of 1 (or 0), letting fail-closed
 * downstream code refuse it.
 *
 * Full invariant: a genuine multi-verifier PASS is NOT flagged, while a
 * single-verifier / no-real-quorum PASS IS flagged.
 */

import { describe, it, expect } from "vitest";
import type { VerifierReport } from "../src/types.js";
import { aggregateVerifierReports } from "../src/verification-consensus.js";

function makeReport(verifierId: string, verdict: "PASS" | "FAIL"): VerifierReport {
  return {
    reportId: `report-${verifierId}`,
    verifierId,
    verdict,
    subsystemChecks: [],
    discrepancies: verdict === "FAIL" ? ["mismatch"] : [],
    bundleHash: "a".repeat(64),
    verifiedAt: "2025-06-15T00:00:00Z",
  };
}

describe("consensus weak-quorum flag (D5-A-005)", () => {
  it("a single-verifier PASS with the permissive default is FLAGGED", () => {
    // Caller omits minimumVerifiers → default 1 → a lone verifier passes.
    const result = aggregateVerifierReports([makeReport("solo", "PASS")]);

    expect(result.verdict).toBe("PASS");
    expect(result.quorumReached).toBe(true);
    // The new flag lets downstream refuse a PASS no stronger than one verifier.
    expect(result.singleVerifierPass).toBe(true);
  });

  it("a single-verifier PASS with explicit minimumVerifiers=1 is FLAGGED", () => {
    const result = aggregateVerifierReports([makeReport("solo", "PASS")], 1);
    expect(result.verdict).toBe("PASS");
    expect(result.singleVerifierPass).toBe(true);
  });

  it("a genuine multi-verifier PASS (quorum >= 2) is NOT flagged", () => {
    const reports = [
      makeReport("v1", "PASS"),
      makeReport("v2", "PASS"),
      makeReport("v3", "PASS"),
    ];
    const result = aggregateVerifierReports(reports, 3);

    expect(result.verdict).toBe("PASS");
    expect(result.quorumReached).toBe(true);
    expect(result.singleVerifierPass).toBe(false);
  });

  it("a FAIL verdict is never flagged as a single-verifier PASS", () => {
    // Quorum not met → FAIL. The flag is strictly about weak PASSes.
    const fail = aggregateVerifierReports([makeReport("solo", "PASS")], 3);
    expect(fail.verdict).toBe("FAIL");
    expect(fail.singleVerifierPass).toBe(false);

    const empty = aggregateVerifierReports([], 1);
    expect(empty.verdict).toBe("FAIL");
    expect(empty.singleVerifierPass).toBe(false);
  });

  it("a 2-of-2 PASS requiring quorum 2 is a real quorum, NOT flagged", () => {
    const result = aggregateVerifierReports(
      [makeReport("v1", "PASS"), makeReport("v2", "PASS")],
      2,
    );
    expect(result.verdict).toBe("PASS");
    expect(result.singleVerifierPass).toBe(false);
  });
});
