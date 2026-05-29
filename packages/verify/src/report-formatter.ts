/**
 * @attestia/verify — Human-readable report formatters.
 *
 * Verification artifacts are raw JSON: correct for machines, opaque for the
 * external auditor who has to READ them. These formatters render a
 * {@link VerifierReport} and a {@link ComplianceReport} into deterministic
 * Markdown — a verdict line, a per-row table, and the lists an auditor needs
 * (discrepancies for a verifier report; the verified-vs-asserted split for a
 * compliance report, so a high score built on architectural assertions cannot
 * masquerade as cryptographically-verified compliance).
 *
 * Design:
 * - Pure functions, no I/O. The same report renders to the same string.
 * - Output is GitHub-flavored Markdown (tables render in any MD viewer, and
 *   degrade to readable plaintext).
 * - Long hashes are abbreviated in tables for legibility; the verdict and
 *   discrepancy text are never abbreviated.
 */

import type {
  VerifierReport,
  SubsystemCheck,
} from "./types.js";
import type {
  ComplianceReport,
  EvaluatedControl,
} from "./compliance/index.js";

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Abbreviate a long hex hash for table legibility (first 8 + last 4), leaving
 * short values untouched. Used ONLY inside tables — never for values an auditor
 * must compare byte-for-byte (those live in the discrepancy list verbatim).
 */
function abbrevHash(value: string): string {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/** Escape the Markdown table cell delimiter so values can't break the table. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/** Render a Markdown table from a header row and body rows. */
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
  return body.length > 0 ? `${head}\n${sep}\n${body}` : `${head}\n${sep}`;
}

// =============================================================================
// Verifier report
// =============================================================================

/**
 * Render a {@link VerifierReport} as human-readable Markdown.
 *
 * Includes:
 * - the overall verdict (PASS / FAIL) and verifier identity,
 * - a per-subsystem table (subsystem | expected | actual | matches),
 * - the discrepancy list (or an explicit "no discrepancies" note on PASS).
 *
 * Pure and deterministic.
 *
 * @param report - The verifier report to render
 * @returns A Markdown string
 */
export function formatVerifierReport(report: VerifierReport): string {
  const verdictIcon = report.verdict === "PASS" ? "✅" : "❌";

  const lines: string[] = [];
  lines.push("# Verification Report");
  lines.push("");
  lines.push(`**Verdict:** ${verdictIcon} ${report.verdict}`);
  lines.push(`**Verifier:** ${report.verifierId}`);
  lines.push(`**Bundle:** ${report.bundleHash}`);
  lines.push(`**Report ID:** ${report.reportId}`);
  lines.push(`**Verified at:** ${report.verifiedAt}`);
  lines.push("");

  // Per-subsystem table.
  lines.push("## Subsystem checks");
  lines.push("");
  if (report.subsystemChecks.length === 0) {
    lines.push("_No subsystem checks recorded._");
  } else {
    const rows = report.subsystemChecks.map((c: SubsystemCheck) => [
      c.subsystem,
      abbrevHash(c.expected),
      abbrevHash(c.actual),
      c.matches ? "yes" : "NO",
    ]);
    lines.push(table(["Subsystem", "Expected", "Actual", "Matches"], rows));
  }
  lines.push("");

  // Discrepancy list.
  lines.push("## Discrepancies");
  lines.push("");
  if (report.discrepancies.length === 0) {
    lines.push("_No discrepancies — all checks passed._");
  } else {
    for (const d of report.discrepancies) {
      lines.push(`- ${d}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// Compliance report
// =============================================================================

/** Human-facing label for an evidence class. */
function evidenceClassLabel(cls: EvaluatedControl["evidenceClass"]): string {
  switch (cls) {
    case "verified":
      return "verified";
    case "asserted":
      return "asserted";
    case "failed":
      return "failed";
  }
}

/**
 * Render a {@link ComplianceReport} as human-readable Markdown.
 *
 * Includes:
 * - the framework, overall score, and pass count,
 * - the **verified vs asserted** split (the Stage-A EvidenceClass distinction)
 *   surfaced prominently, so a reader is not misled into treating an
 *   architectural-assertion score as cryptographically verified,
 * - a per-control table (control | name | status | passed | evidence class).
 *
 * Pure and deterministic.
 *
 * @param report - The compliance report to render
 * @returns A Markdown string
 */
export function formatComplianceReport(report: ComplianceReport): string {
  const lines: string[] = [];
  lines.push("# Compliance Report");
  lines.push("");
  lines.push(`**Framework:** ${report.framework.name} (${report.framework.version})`);
  lines.push(`**Score:** ${report.score}%`);
  lines.push(`**Generated at:** ${report.generatedAt}`);
  lines.push("");

  // Verified vs asserted split — the load-bearing distinction. A score that is
  // mostly "asserted" is an architectural-posture score, NOT a proof of
  // cryptographically-verified compliance; spell that out so it can't mislead.
  const failedControls = report.totalControls - report.passedControls;
  lines.push("## Evidence strength");
  lines.push("");
  lines.push(
    table(
      ["Class", "Controls", "Meaning"],
      [
        [
          "Verified",
          String(report.verifiedControls),
          "backed by cryptographically verifiable evidence",
        ],
        [
          "Asserted",
          String(report.assertedControls),
          "architectural claim corroborated by a state bundle (not a proof)",
        ],
        ["Failed", String(failedControls), "did not pass"],
      ],
    ),
  );
  lines.push("");
  lines.push(
    `_${report.passedControls} of ${report.totalControls} controls passed — ` +
      `**${report.verifiedControls} verified**, ${report.assertedControls} asserted. ` +
      `Treat asserted controls as weaker evidence than verified ones._`,
  );
  lines.push("");

  // Per-control table.
  lines.push("## Controls");
  lines.push("");
  if (report.evaluations.length === 0) {
    lines.push("_No controls evaluated._");
  } else {
    const rows = report.evaluations.map((e: EvaluatedControl) => [
      e.mapping.controlId,
      e.mapping.controlName,
      e.mapping.status,
      e.passed ? "yes" : "NO",
      evidenceClassLabel(e.evidenceClass),
    ]);
    lines.push(
      table(
        ["Control", "Name", "Status", "Passed", "Evidence"],
        rows,
      ),
    );
  }
  lines.push("");

  return lines.join("\n");
}
