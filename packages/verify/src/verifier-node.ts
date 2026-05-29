/**
 * @attestia/verify — External Verifier Node.
 *
 * Accepts a state bundle and independently verifies it by:
 * 1. Checking bundle integrity (hash consistency)
 * 2. Replaying subsystems from snapshots
 * 3. Comparing replayed state against bundle's GlobalStateHash
 * 4. Producing a VerifierReport with verdict and evidence
 *
 * Design:
 * - Pure function `runVerification()` for stateless operation
 * - VerifierNode class for stateful (multi-bundle) usage
 * - No network access — works entirely from bundle data
 * - Strict mode: missing optional fields (chainHashes) cause FAIL
 */

import { createHash, randomBytes } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { NOOP_TELEMETRY, type Telemetry } from "@attestia/types";
import type {
  ExportableStateBundle,
  VerifierConfig,
  VerifierReport,
  SubsystemCheck,
  VerificationVerdict,
} from "./types.js";
import { verifyBundleIntegrity } from "./state-bundle.js";
import { verifyByReplay } from "./replay.js";
import {
  computeGlobalStateHash,
  hashLedgerSnapshot,
  hashRegistrumSnapshot,
} from "./global-state-hash.js";

// =============================================================================
// Internal Helpers
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function generateReportId(verifierId: string, bundleHash: string): string {
  const nonce = randomBytes(16).toString("hex");
  return sha256(canonicalize({ verifierId, bundleHash, nonce }));
}

/**
 * Emit a `"verify.phase"` telemetry event for one verification phase.
 *
 * Attributes are kept to `{ phase, passed }` only — both low-cardinality and
 * safe as metric labels. The verifier id is deliberately NOT an attribute (raw
 * ids are unbounded; they belong in `message`, per the Telemetry contract).
 * The emit is defensively guarded: observability must never break the
 * verification it observes, so a throwing sink is swallowed (the
 * {@link Telemetry} contract forbids throwing, but we do not trust a host to
 * honor it).
 */
function emitPhase(
  telemetry: Telemetry,
  verifierId: string,
  phase: string,
  passed: boolean,
): void {
  try {
    telemetry.record({
      package: "@attestia/verify",
      op: "verify.phase",
      level: passed ? "debug" : "warn",
      outcome: passed ? "ok" : "failed",
      attributes: { phase, passed },
      message: `verifier ${verifierId}: phase "${phase}" ${passed ? "passed" : "failed"}`,
    });
  } catch {
    /* a sink must not break verification — see NOOP_TELEMETRY contract */
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run verification on a state bundle.
 *
 * This is the core stateless verification function. It:
 * 1. Verifies bundle integrity (hashes match)
 * 2. Replays subsystems from snapshots
 * 3. Compares replayed hashes against bundle claims
 * 4. Optionally enforces strict mode (chainHashes required)
 *
 * @param bundle - The state bundle to verify
 * @param config - Verifier identity and configuration
 * @returns VerifierReport with verdict and evidence
 */
export function runVerification(
  bundle: ExportableStateBundle,
  config: VerifierConfig,
): VerifierReport {
  const discrepancies: string[] = [];
  const subsystemChecks: SubsystemCheck[] = [];
  // Optional observability — defaults to a silent no-op sink, so verification
  // is unobserved (and free) unless a host injects a telemetry sink.
  const telemetry = config.telemetry ?? NOOP_TELEMETRY;

  // Step 1: Verify bundle integrity
  const bundleResult = verifyBundleIntegrity(bundle);
  if (bundleResult.verdict === "FAIL") {
    discrepancies.push(...bundleResult.discrepancies);
  }
  emitPhase(telemetry, config.verifierId, "bundle-integrity", bundleResult.verdict === "PASS");

  // Step 2: Replay verification
  // NOTE: We do NOT pass expectedHash here because the bundle's globalStateHash
  // may include chain hashes that replay cannot reproduce (no RPC access).
  // Global hash comparison is handled in Step 4 instead.
  const replayResult = verifyByReplay({
    ledgerSnapshot: bundle.ledgerSnapshot,
    registrumSnapshot: bundle.registrumSnapshot,
  });

  if (replayResult.verdict === "FAIL") {
    for (const d of replayResult.discrepancies) {
      discrepancies.push(d.description);
    }
  }
  emitPhase(telemetry, config.verifierId, "replay", replayResult.verdict === "PASS");

  // Step 3: Per-subsystem hash checks
  const ledgerHash = hashLedgerSnapshot(bundle.ledgerSnapshot);
  const registrumHash = hashRegistrumSnapshot(bundle.registrumSnapshot);

  const ledgerMatches = bundle.globalStateHash.subsystems.ledger === ledgerHash;
  subsystemChecks.push({
    subsystem: "ledger",
    expected: bundle.globalStateHash.subsystems.ledger,
    actual: ledgerHash,
    matches: ledgerMatches,
  });

  if (!ledgerMatches) {
    discrepancies.push(
      `Ledger hash mismatch: bundle claims ${bundle.globalStateHash.subsystems.ledger}, ` +
        `recomputed ${ledgerHash}`,
    );
  }
  emitPhase(telemetry, config.verifierId, "subsystem-ledger", ledgerMatches);

  const registrumMatches =
    bundle.globalStateHash.subsystems.registrum === registrumHash;
  subsystemChecks.push({
    subsystem: "registrum",
    expected: bundle.globalStateHash.subsystems.registrum,
    actual: registrumHash,
    matches: registrumMatches,
  });

  if (!registrumMatches) {
    discrepancies.push(
      `Registrum hash mismatch: bundle claims ${bundle.globalStateHash.subsystems.registrum}, ` +
        `recomputed ${registrumHash}`,
    );
  }
  emitPhase(telemetry, config.verifierId, "subsystem-registrum", registrumMatches);

  // Step 4: Global hash check
  // Recompute global hash from replayed snapshots + bundle's chain hashes
  // (replay alone cannot reproduce chain hashes — those require RPC data).
  const recomputedGlobal = computeGlobalStateHash(
    bundle.ledgerSnapshot,
    bundle.registrumSnapshot,
    bundle.chainHashes,
  );

  const globalMatches = bundle.globalStateHash.hash === recomputedGlobal.hash;
  subsystemChecks.push({
    subsystem: "global",
    expected: bundle.globalStateHash.hash,
    actual: recomputedGlobal.hash,
    matches: globalMatches,
  });

  if (!globalMatches) {
    discrepancies.push(
      `Global hash mismatch: bundle claims ${bundle.globalStateHash.hash}, ` +
        `recomputed ${recomputedGlobal.hash}`,
    );
  }
  emitPhase(telemetry, config.verifierId, "global-hash", globalMatches);

  // Step 5: Chain hashes (strict mode)
  if (config.strictMode === true) {
    const bundleChains = bundle.globalStateHash.subsystems.chains;
    const chainsPresent =
      bundleChains !== undefined && Object.keys(bundleChains).length > 0;
    if (!chainsPresent) {
      discrepancies.push(
        "Strict mode: no chain hashes found in bundle (expected chain observer data)",
      );
    }
    emitPhase(telemetry, config.verifierId, "strict-chains", chainsPresent);
  }

  // Step 6: If chain hashes present, record them
  if (bundle.globalStateHash.subsystems.chains) {
    for (const [chainId, hash] of Object.entries(bundle.globalStateHash.subsystems.chains)) {
      subsystemChecks.push({
        subsystem: `chain:${chainId}`,
        expected: hash,
        actual: hash, // We can't independently recompute chain hashes without RPC
        matches: true,
      });
    }
  }

  const verdict: VerificationVerdict =
    discrepancies.length === 0 ? "PASS" : "FAIL";

  return {
    reportId: generateReportId(config.verifierId, bundle.bundleHash),
    verifierId: config.verifierId,
    verdict,
    subsystemChecks,
    discrepancies,
    bundleHash: bundle.bundleHash,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Stateful verifier node that can verify multiple bundles.
 *
 * Maintains a history of verification reports for audit purposes.
 */
export class VerifierNode {
  private readonly config: VerifierConfig;
  private readonly reports: VerifierReport[] = [];

  constructor(config: VerifierConfig) {
    this.config = config;
  }

  /**
   * Verify a state bundle and store the report.
   */
  verify(bundle: ExportableStateBundle): VerifierReport {
    const report = runVerification(bundle, this.config);
    this.reports.push(report);
    return report;
  }

  /**
   * Get all verification reports.
   */
  getReports(): readonly VerifierReport[] {
    return this.reports;
  }

  /**
   * Get the verifier's identity.
   */
  getVerifierId(): string {
    return this.config.verifierId;
  }
}
