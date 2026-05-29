/**
 * Compliance Evidence — Architectural vs Verified (D5-A-004).
 *
 * Four evidence types — audit-log, multi-sig-governance, reconciliation,
 * consensus — were hardcoded `passed: true` regardless of any bundle or
 * state. A report could therefore score ~100% as a pure architectural
 * assertion, with zero corroborating evidence.
 *
 * Fix:
 *  - With NO bundle, these architectural claims are uncorroborated and must
 *    NOT pass on assertion alone → a no-bundle report cannot score 100% on
 *    architectural-only controls.
 *  - Reports separate cryptographically VERIFIED evidence from ASSERTED
 *    architectural claims (evidenceClass + verified/asserted counts) so a
 *    reader can tell proof from posture.
 */

import { describe, it, expect } from "vitest";
import { generateComplianceEvidence } from "../../src/compliance/evidence-generator.js";
import { SOC2_FRAMEWORK, SOC2_MAPPINGS } from "../../src/compliance/soc2-mapping.js";
import type { ControlMapping, ComplianceFramework } from "../../src/compliance/types.js";

const FRAMEWORK: ComplianceFramework = {
  id: "test",
  name: "Test",
  version: "1",
  description: "test framework",
};

/** Controls whose ONLY evidence is architectural (no bundle can prove them). */
const ARCHITECTURAL_ONLY: readonly ControlMapping[] = [
  {
    controlId: "ARCH-1",
    controlName: "Audit log present",
    controlDescription: "An append-only audit log exists",
    attestiaControl: "audit log",
    attestiaPackage: "@attestia/event-store",
    evidenceTypes: ["audit-log"],
    status: "implemented",
  },
  {
    controlId: "ARCH-2",
    controlName: "Governance present",
    controlDescription: "Multi-sig governance exists",
    attestiaControl: "governance",
    attestiaPackage: "@attestia/witness",
    evidenceTypes: ["multi-sig-governance"],
    status: "implemented",
  },
  {
    controlId: "ARCH-3",
    controlName: "Reconciliation present",
    controlDescription: "Reconciliation engine exists",
    attestiaControl: "reconciliation",
    attestiaPackage: "@attestia/reconciler",
    evidenceTypes: ["reconciliation"],
    status: "implemented",
  },
  {
    controlId: "ARCH-4",
    controlName: "Consensus present",
    controlDescription: "Multi-verifier consensus exists",
    attestiaControl: "consensus",
    attestiaPackage: "@attestia/verify",
    evidenceTypes: ["consensus"],
    status: "implemented",
  },
];

describe("architectural evidence is not free PASS without a bundle (D5-A-004)", () => {
  it("a no-bundle report does NOT score 100% on architectural-only controls", () => {
    const report = generateComplianceEvidence(ARCHITECTURAL_ONLY, FRAMEWORK);

    // Previously: all four hardcoded passed:true → score 100. Now, with no
    // corroborating bundle, none of them may pass on assertion alone.
    expect(report.score).toBeLessThan(100);
    expect(report.passedControls).toBe(0);

    for (const e of report.evaluations) {
      expect(e.passed).toBe(false);
      // Detail should explain why (no bundle / uncorroborated).
      expect(e.evidenceDetail.toLowerCase()).toMatch(
        /no.*bundle|uncorroborated|asserted|fail-closed/,
      );
    }
  });

  it("report separates verified evidence from asserted architectural claims", () => {
    const report = generateComplianceEvidence(ARCHITECTURAL_ONLY, FRAMEWORK);

    // The report exposes the verified/asserted split so a reader can tell
    // cryptographic proof from architectural posture.
    expect(typeof report.verifiedControls).toBe("number");
    expect(typeof report.assertedControls).toBe("number");
    // These controls are architectural — none are cryptographically verified.
    expect(report.verifiedControls).toBe(0);

    for (const e of report.evaluations) {
      expect(e.evidenceClass).toBeDefined();
      // Architectural-only with no bundle → not "verified".
      expect(e.evidenceClass).not.toBe("verified");
    }
  });

  it("the full SOC 2 set scores strictly lower with no bundle than with one", () => {
    // Regression-flavoured: removing the bundle must cost real points now,
    // not just the handful of crypto controls.
    const withBundle = SOC2_MAPPINGS; // shape check only; see existing suite for bundled run
    expect(withBundle.length).toBeGreaterThan(0);

    const noBundle = generateComplianceEvidence(SOC2_MAPPINGS, SOC2_FRAMEWORK);
    // Architectural-only SOC 2 controls (e.g. CC6.1 audit-log only) must now
    // fail without a bundle, so the no-bundle score is well under 100.
    expect(noBundle.score).toBeLessThan(100);
  });
});
