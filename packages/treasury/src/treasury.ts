/**
 * Treasury — Top-level coordinator for org finances.
 *
 * Composes:
 * - PayrollEngine: deterministic payroll computation and execution
 * - DistributionEngine: DAO and org distributions
 * - FundingGateManager: dual-gate funding approval
 * - Ledger: double-entry ledger for all financial records
 *
 * The Treasury is the entry point for all organizational financial operations.
 */

import { Ledger } from "@attestia/ledger";
import type { Money, Telemetry } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
import type {
  TreasuryConfig,
  TreasurySnapshot,
  PayComponent,
  PayPeriod,
  DistributionRecipient,
  DistributionStrategy,
} from "./types.js";
import { PayrollEngine } from "./payroll.js";
import { DistributionEngine } from "./distribution.js";
import { FundingGateManager } from "./funding.js";

// =============================================================================
// Snapshot versioning
// =============================================================================

/**
 * The treasury snapshot schema version this build writes and can restore. A
 * snapshot carrying any other `version` is rejected at restore time (see
 * {@link Treasury.fromSnapshot}) rather than silently mis-restored into a
 * structurally-valid but semantically-wrong treasury.
 */
export const CURRENT_TREASURY_SNAPSHOT_VERSION = 1 as const;

// =============================================================================
// Error
// =============================================================================

export class TreasuryError extends Error {
  public readonly code: TreasuryErrorCode;
  public readonly hint: string;
  constructor(code: TreasuryErrorCode, message: string, hint: string) {
    super(message);
    this.name = "TreasuryError";
    this.code = code;
    this.hint = hint;
  }
}

export type TreasuryErrorCode = "UNSUPPORTED_SNAPSHOT_VERSION";

// =============================================================================
// Treasury
// =============================================================================

export class Treasury {
  private readonly config: TreasuryConfig;
  private readonly ledger: Ledger;
  private readonly payroll: PayrollEngine;
  private readonly distributions: DistributionEngine;
  private readonly funding: FundingGateManager;

  /**
   * @param telemetry Optional observability sink (D4-B-001), threaded into the
   *   payroll, distribution, and funding engines. Defaults to
   *   {@link NOOP_TELEMETRY}. It is a runtime concern, not part of the
   *   serializable {@link TreasuryConfig}, so it is passed separately.
   */
  constructor(config: TreasuryConfig, telemetry: Telemetry = NOOP_TELEMETRY) {
    this.config = config;
    this.ledger = new Ledger();
    this.payroll = new PayrollEngine(
      config.defaultCurrency,
      config.defaultDecimals,
      telemetry,
    );
    this.distributions = new DistributionEngine(
      config.defaultCurrency,
      config.defaultDecimals,
      telemetry,
    );
    this.funding = new FundingGateManager(
      config.gatekeepers,
      config.defaultCurrency,
      config.defaultDecimals,
      telemetry,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Payroll
  // ───────────────────────────────────────────────────────────────────────

  registerPayee(
    id: string,
    name: string,
    address: string,
    chainId?: string,
  ) {
    return this.payroll.registerPayee(id, name, address, chainId);
  }

  setPaySchedule(
    payeeId: string,
    components: readonly PayComponent[],
  ) {
    return this.payroll.setSchedule(payeeId, components);
  }

  createPayrollRun(id: string, period: PayPeriod) {
    return this.payroll.createRun(id, period);
  }

  approvePayrollRun(id: string) {
    return this.payroll.approveRun(id);
  }

  executePayrollRun(id: string) {
    return this.payroll.executeRun(id, this.ledger);
  }

  getPayrollRun(id: string) {
    return this.payroll.getRun(id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Distributions
  // ───────────────────────────────────────────────────────────────────────

  createDistribution(
    id: string,
    name: string,
    strategy: DistributionStrategy,
    pool: Money,
    recipients: readonly DistributionRecipient[],
  ) {
    return this.distributions.createPlan(id, name, strategy, pool, recipients);
  }

  approveDistribution(id: string) {
    return this.distributions.approvePlan(id);
  }

  computeDistribution(id: string) {
    return this.distributions.computeDistribution(id);
  }

  executeDistribution(id: string) {
    return this.distributions.executeDistribution(id, this.ledger);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Funding
  // ───────────────────────────────────────────────────────────────────────

  submitFunding(
    id: string,
    description: string,
    amount: Money,
    requestedBy: string,
  ) {
    return this.funding.submitRequest(id, description, amount, requestedBy);
  }

  approveFundingGate(id: string, approvedBy: string, reason?: string) {
    return this.funding.approveGate(id, approvedBy, reason);
  }

  rejectFunding(id: string, rejectedBy: string, reason?: string) {
    return this.funding.rejectRequest(id, rejectedBy, reason);
  }

  executeFunding(id: string) {
    return this.funding.executeRequest(id, this.ledger);
  }

  getFundingRequest(id: string) {
    return this.funding.getRequest(id);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Ledger access
  // ───────────────────────────────────────────────────────────────────────

  getLedger(): Ledger {
    return this.ledger;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Snapshot
  // ───────────────────────────────────────────────────────────────────────

  snapshot(): TreasurySnapshot {
    return {
      version: CURRENT_TREASURY_SNAPSHOT_VERSION,
      config: this.config,
      payees: this.payroll.exportPayees(),
      payrollRuns: this.payroll.exportRuns(),
      distributionPlans: this.distributions.exportPlans(),
      fundingRequests: this.funding.exportRequests(),
      asOf: new Date().toISOString(),
    };
  }

  static fromSnapshot(
    snap: TreasurySnapshot,
    telemetry: Telemetry = NOOP_TELEMETRY,
  ): Treasury {
    // Reject an unrecognised snapshot version up front rather than silently
    // mis-restoring it into a structurally-valid but semantically-wrong
    // treasury (fields defaulting to undefined/zero corrupt financial state).
    if (snap.version !== CURRENT_TREASURY_SNAPSHOT_VERSION) {
      throw new TreasuryError(
        "UNSUPPORTED_SNAPSHOT_VERSION",
        `Cannot restore treasury snapshot version ${String(snap.version)}: this build restores version ${CURRENT_TREASURY_SNAPSHOT_VERSION}`,
        `Migrate the snapshot to version ${CURRENT_TREASURY_SNAPSHOT_VERSION} before restoring, or restore with a build that supports version ${String(snap.version)}.`,
      );
    }

    const treasury = new Treasury(snap.config, telemetry);
    // Restore into a FRESH treasury (the documented pattern): import* below
    // fail closed if their target map is already populated.
    treasury.payroll.importPayees(snap.payees);
    treasury.payroll.importRuns(snap.payrollRuns);
    treasury.distributions.importPlans(snap.distributionPlans);
    treasury.funding.importRequests(snap.fundingRequests);

    telemetry.record({
      package: "@attestia/treasury",
      op: "treasury.restore",
      level: "info",
      outcome: "ok",
      attributes: {
        payeeCount: snap.payees.length,
        runCount: snap.payrollRuns.length,
        planCount: snap.distributionPlans.length,
        requestCount: snap.fundingRequests.length,
        snapshotVersion: snap.version,
      },
      message: `treasury '${snap.config.orgId}' restored from snapshot`,
    });

    return treasury;
  }
}
