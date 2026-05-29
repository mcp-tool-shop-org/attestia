/**
 * Report Formatter Tests (D5-B-001).
 *
 * Until now every verification artifact was raw JSON — there was NO
 * human-readable renderer for an external auditor. These formatters turn a
 * `VerifierReport` and a `ComplianceReport` into deterministic Markdown so a
 * human can read the verdict, the per-subsystem table, the discrepancy list,
 * and — crucially for compliance — the verified-vs-asserted split, so an
 * auditor is not misled by an architectural-assertion score.
 *
 * The formatters are pure (no I/O) and deterministic: the same report renders
 * to the same string every time. We assert structural content, not exact
 * whitespace, so the layout can evolve without breaking the contract.
 */

import { describe, it, expect } from "vitest";
import { formatVerifierReport, formatComplianceReport } from "../src/report-formatter.js";
import type { VerifierReport } from "../src/types.js";
import type { ComplianceReport, EvaluatedControl } from "../src/compliance/index.js";

// =============================================================================
// VerifierReport fixtures
// =============================================================================

function passingVerifierReport(): VerifierReport {
  return {
    reportId: "a".repeat(64),
    verifierId: "verifier-alice",
    verdict: "PASS",
    subsystemChecks: [
      { subsystem: "ledger", expected: "b".repeat(64), actual: "b".repeat(64), matches: true },
      { subsystem: "registrum", expected: "c".repeat(64), actual: "c".repeat(64), matches: true },
      { subsystem: "global", expected: "d".repeat(64), actual: "d".repeat(64), matches: true },
    ],
    discrepancies: [],
    bundleHash: "e".repeat(64),
    verifiedAt: "2026-05-29T00:00:00.000Z",
  };
}

function failingVerifierReport(): VerifierReport {
  return {
    reportId: "1".repeat(64),
    verifierId: "verifier-bob",
    verdict: "FAIL",
    subsystemChecks: [
      { subsystem: "ledger", expected: "aaa", actual: "zzz", matches: false },
      { subsystem: "registrum", expected: "ccc", actual: "ccc", matches: true },
      { subsystem: "global", expected: "ddd", actual: "eee", matches: false },
    ],
    discrepancies: [
      "Ledger hash mismatch: bundle claims aaa, recomputed zzz",
      "Global hash mismatch: bundle claims ddd, recomputed eee",
    ],
    bundleHash: "f".repeat(64),
    verifiedAt: "2026-05-29T00:00:00.000Z",
  };
}

// =============================================================================
// ComplianceReport fixtures
// =============================================================================

function control(
  controlId: string,
  passed: boolean,
  evidenceClass: EvaluatedControl["evidenceClass"],
): EvaluatedControl {
  return {
    mapping: {
      controlId,
      controlName: `Control ${controlId}`,
      controlDescription: "desc",
      attestiaControl: "some-capability",
      attestiaPackage: "@attestia/verify",
      evidenceTypes: ["hash-chain"],
      status: "implemented",
    },
    passed,
    evidenceDetail: "[PASS] something",
    evidenceClass,
  };
}

function complianceReport(): ComplianceReport {
  const evaluations: EvaluatedControl[] = [
    control("CC1.1", true, "verified"),
    control("CC2.1", true, "verified"),
    control("CC3.1", true, "asserted"),
    control("CC4.1", false, "failed"),
  ];
  return {
    framework: {
      id: "soc2-type2",
      name: "SOC 2 Type II",
      version: "2017",
      description: "Trust Services Criteria",
    },
    evaluations,
    totalControls: 4,
    passedControls: 3,
    verifiedControls: 2,
    assertedControls: 1,
    score: 75,
    generatedAt: "2026-05-29T00:00:00.000Z",
  };
}

// =============================================================================
// formatVerifierReport
// =============================================================================

describe("formatVerifierReport (D5-B-001)", () => {
  it("renders a PASS verdict and the verifier id", () => {
    const out = formatVerifierReport(passingVerifierReport());
    expect(out).toContain("PASS");
    expect(out).toContain("verifier-alice");
  });

  it("renders the per-subsystem table with subsystem / expected / actual / matches", () => {
    const out = formatVerifierReport(passingVerifierReport());
    expect(out).toContain("ledger");
    expect(out).toContain("registrum");
    expect(out).toContain("global");
    // table headers
    expect(out.toLowerCase()).toContain("subsystem");
    expect(out.toLowerCase()).toContain("expected");
    expect(out.toLowerCase()).toContain("actual");
    expect(out.toLowerCase()).toContain("matches");
  });

  it("renders the FAILING subsystem and the discrepancy list for a failing report", () => {
    const out = formatVerifierReport(failingVerifierReport());
    expect(out).toContain("FAIL");
    // the failing subsystems appear
    expect(out).toContain("ledger");
    expect(out).toContain("global");
    // discrepancies are rendered verbatim
    expect(out).toContain("Ledger hash mismatch: bundle claims aaa, recomputed zzz");
    expect(out).toContain("Global hash mismatch: bundle claims ddd, recomputed eee");
  });

  it("indicates there are no discrepancies for a passing report", () => {
    const out = formatVerifierReport(passingVerifierReport());
    expect(out.toLowerCase()).toContain("no discrepancies");
  });

  it("is pure and deterministic — same report renders identically", () => {
    const r = passingVerifierReport();
    expect(formatVerifierReport(r)).toBe(formatVerifierReport(r));
  });
});

// =============================================================================
// formatComplianceReport
// =============================================================================

describe("formatComplianceReport (D5-B-001)", () => {
  it("renders framework name and score", () => {
    const out = formatComplianceReport(complianceReport());
    expect(out).toContain("SOC 2 Type II");
    expect(out).toContain("75");
  });

  it("renders the verified vs asserted split so the score is not misleading", () => {
    const out = formatComplianceReport(complianceReport());
    const lower = out.toLowerCase();
    expect(lower).toContain("verified");
    expect(lower).toContain("asserted");
    // the actual counts must appear
    expect(out).toContain("2"); // verifiedControls
    expect(out).toContain("1"); // assertedControls
  });

  it("renders a per-control table including the control ids and their class", () => {
    const out = formatComplianceReport(complianceReport());
    expect(out).toContain("CC1.1");
    expect(out).toContain("CC2.1");
    expect(out).toContain("CC3.1");
    expect(out).toContain("CC4.1");
    // class labels surface per control
    expect(out.toLowerCase()).toContain("verified");
    expect(out.toLowerCase()).toContain("asserted");
    expect(out.toLowerCase()).toContain("failed");
  });

  it("is pure and deterministic — same report renders identically", () => {
    const r = complianceReport();
    expect(formatComplianceReport(r)).toBe(formatComplianceReport(r));
  });
});
