/**
 * @attestia/verify — Compliance Evidence Generator.
 *
 * Generates compliance reports by evaluating each control mapping
 * against the actual system state.
 *
 * Design:
 * - Pure functions, no I/O
 * - Evidence checks are advisory (pass/fail informational)
 * - Reports are deterministic for same inputs
 * - Works with ExportableStateBundle as primary evidence source
 */

import type { ExportableStateBundle, BundleVerificationResult } from "../types.js";
import { verifyBundleIntegrity } from "../state-bundle.js";
import type {
  ComplianceFramework,
  ControlMapping,
  EvaluatedControl,
  ComplianceReport,
  EvidenceType,
  EvidenceClass,
} from "./types.js";

// =============================================================================
// Evidence Check Functions
// =============================================================================

/**
 * Result of checking one evidence type.
 * `kind` records whether a PASS is cryptographically verified or merely an
 * architectural assertion; on failure it is "failed".
 */
interface EvidenceResult {
  readonly passed: boolean;
  readonly detail: string;
  readonly kind: EvidenceClass;
}

/**
 * The architectural evidence types: capabilities that exist by design but are
 * NOT themselves cryptographic proofs. A bundle cannot "prove" them, so they
 * are fail-closed without a corroborating, integral state bundle and, even
 * when corroborated, are reported as "asserted" rather than "verified".
 */
const ARCHITECTURAL_TYPES: Record<
  Extract<
    EvidenceType,
    "audit-log" | "multi-sig-governance" | "reconciliation" | "consensus"
  >,
  string
> = {
  "audit-log": "Append-only audit log",
  "multi-sig-governance": "Multi-signature governance framework",
  reconciliation: "Three-way reconciliation engine",
  consensus: "Multi-verifier consensus framework",
};

/**
 * Whether a present bundle is corroborated (integral) — used to decide if an
 * architectural claim may be reported as "asserted" rather than failing closed.
 */
function bundleIsCorroborated(
  bundle: ExportableStateBundle | null,
  bundleVerification: BundleVerificationResult | null,
): boolean {
  return (
    bundle !== null &&
    bundleVerification !== null &&
    bundleVerification.bundleHashValid
  );
}

/**
 * Check if a specific evidence type passes for the given bundle.
 * Returns a description of what was checked, the result, and its class.
 */
function checkEvidence(
  evidenceType: EvidenceType,
  bundle: ExportableStateBundle | null,
  bundleVerification: BundleVerificationResult | null,
): EvidenceResult {
  switch (evidenceType) {
    case "hash-chain":
      if (bundle === null) {
        return { passed: false, kind: "failed", detail: "No state bundle available for hash chain verification" };
      }
      if (bundleVerification === null) {
        return { passed: false, kind: "failed", detail: "Bundle verification not performed" };
      }
      return {
        passed: bundleVerification.bundleHashValid,
        kind: bundleVerification.bundleHashValid ? "verified" : "failed",
        detail: bundleVerification.bundleHashValid
          ? "Bundle hash chain is intact"
          : `Hash chain broken: ${bundleVerification.discrepancies.join("; ")}`,
      };

    case "replay-verification":
      if (bundleVerification === null) {
        return { passed: false, kind: "failed", detail: "Replay verification not performed" };
      }
      return {
        passed: bundleVerification.globalHashValid,
        kind: bundleVerification.globalHashValid ? "verified" : "failed",
        detail: bundleVerification.globalHashValid
          ? "State replay verification passed — global hash matches"
          : `Replay mismatch: ${bundleVerification.discrepancies.join("; ")}`,
      };

    case "state-snapshot": {
      if (bundle === null) {
        return { passed: false, kind: "failed", detail: "No state snapshot available" };
      }
      const ok = bundle.version >= 1 && bundle.exportedAt !== undefined;
      return {
        passed: ok,
        kind: ok ? "verified" : "failed",
        detail: `State snapshot v${bundle.version} exported at ${bundle.exportedAt ?? "unknown"}`,
      };
    }

    case "merkle-proof": {
      if (bundle === null) {
        return { passed: false, kind: "failed", detail: "No bundle for Merkle proof verification" };
      }
      const ok = bundle.eventHashes.length > 0;
      return {
        passed: ok,
        kind: ok ? "verified" : "failed",
        detail: `${bundle.eventHashes.length} event hashes available for Merkle tree construction`,
      };
    }

    case "audit-log":
    case "multi-sig-governance":
    case "reconciliation":
    case "consensus": {
      // Architectural claim. Fail-closed without a corroborating bundle so a
      // report cannot score on pure posture; when corroborated, report it as
      // "asserted" (weaker than cryptographically verified) rather than a free PASS.
      const name = ARCHITECTURAL_TYPES[evidenceType];
      if (!bundleIsCorroborated(bundle, bundleVerification)) {
        return {
          passed: false,
          kind: "failed",
          detail: `${name} is asserted but uncorroborated (no integral state bundle) — fail-closed`,
        };
      }
      return {
        passed: true,
        kind: "asserted",
        detail: `${name} present; asserted (architectural claim corroborated by an integral state bundle, not a cryptographic proof)`,
      };
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate a compliance report by evaluating each control mapping
 * against the current system state.
 *
 * @param mappings - Control mappings for the framework
 * @param framework - Framework metadata
 * @param bundle - Optional state bundle for evidence evaluation
 * @returns ComplianceReport with per-control evaluations and score
 */
export function generateComplianceEvidence(
  mappings: readonly ControlMapping[],
  framework: ComplianceFramework,
  bundle?: ExportableStateBundle | undefined,
): ComplianceReport {
  // Pre-compute bundle verification if a bundle is provided
  const bundleVerification =
    bundle !== undefined ? verifyBundleIntegrity(bundle) : null;

  const evaluations: EvaluatedControl[] = mappings.map((mapping) => {
    // A control passes if ALL its evidence types pass
    const evidenceResults = mapping.evidenceTypes.map((et) =>
      checkEvidence(et, bundle ?? null, bundleVerification),
    );

    const allPassed = evidenceResults.every((r) => r.passed);

    // For "not-applicable" controls, always pass
    const passed = mapping.status === "not-applicable" || allPassed;

    // Classify the control's evidence:
    //  - not passing → "failed"
    //  - passing with any cryptographically verified evidence → "verified"
    //  - passing only on architectural assertions → "asserted"
    // (not-applicable controls carry no evidence, so they count as "asserted".)
    let evidenceClass: EvidenceClass;
    if (!passed) {
      evidenceClass = "failed";
    } else if (evidenceResults.some((r) => r.kind === "verified")) {
      evidenceClass = "verified";
    } else {
      evidenceClass = "asserted";
    }

    const evidenceDetail = evidenceResults
      .map((r) => `[${r.passed ? "PASS" : "FAIL"}] ${r.detail}`)
      .join("; ");

    return {
      mapping,
      passed,
      evidenceDetail,
      evidenceClass,
    };
  });

  const passedControls = evaluations.filter((e) => e.passed).length;
  const verifiedControls = evaluations.filter(
    (e) => e.evidenceClass === "verified",
  ).length;
  const assertedControls = evaluations.filter(
    (e) => e.evidenceClass === "asserted",
  ).length;
  const totalControls = evaluations.length;
  const score =
    totalControls > 0 ? Math.round((passedControls / totalControls) * 100) : 0;

  return {
    framework,
    evaluations,
    totalControls,
    passedControls,
    verifiedControls,
    assertedControls,
    score,
    generatedAt: new Date().toISOString(),
  };
}
