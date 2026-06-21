/**
 * @attestia/treasury — Org Treasury: deterministic payroll,
 * DAO distributions, dual-gate funding, double-entry ledger.
 */

// Core engines
export { PayrollEngine, PayrollError } from "./payroll.js";
export type { PayrollErrorCode } from "./payroll.js";

export { DistributionEngine, DistributionError } from "./distribution.js";
export type { DistributionErrorCode } from "./distribution.js";

export { FundingGateManager, FundingError } from "./funding.js";
export type { FundingErrorCode } from "./funding.js";

// Coordinator
export {
  Treasury,
  TreasuryError,
  CURRENT_TREASURY_SNAPSHOT_VERSION,
} from "./treasury.js";
export type { TreasuryErrorCode } from "./treasury.js";

// Types
export type {
  Payee,
  PayeeStatus,
  PayComponent,
  PayComponentType,
  PayrollScheduleEntry,
  PayrollRun,
  PayrollRunStatus,
  PayPeriod,
  PayrollEntry,
  ResolvedPayComponent,
  DistributionPlan,
  DistributionStrategy,
  DistributionStatus,
  DistributionRecipient,
  DistributionResult,
  DistributionPayout,
  FundingRequest,
  FundingStatus,
  FundingGate,
  TreasuryConfig,
  TreasurySnapshot,
} from "./types.js";
