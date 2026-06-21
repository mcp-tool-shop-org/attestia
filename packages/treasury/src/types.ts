/**
 * @attestia/treasury domain types.
 *
 * Org Treasury manages organisational finances:
 * - Deterministic payroll (runs, schedules, pay components)
 * - DAO distributions (proportional, fixed, milestone-based)
 * - Dual-gate funding (two explicitly approvers required)
 * - Double-entry ledger integration
 *
 * Evolved from Payroll Engine (Python).
 */

import type { Money, Currency } from "@attestia/types";

// =============================================================================
// Payroll
// =============================================================================

/** A payee in the treasury system. */
export interface Payee {
  readonly id: string;
  readonly name: string;
  readonly address: string; // On-chain or off-chain payout address
  readonly chainId?: string;
  readonly status: PayeeStatus;
  readonly registeredAt: string; // ISO 8601
}

export type PayeeStatus = "active" | "inactive" | "suspended";

/** A pay component (base salary, bonus, deduction, reimbursement, etc.) */
export interface PayComponent {
  readonly id: string;
  readonly name: string;
  readonly type: PayComponentType;
  readonly amount: Money;
  readonly recurring: boolean;
  readonly taxable: boolean;
}

export type PayComponentType =
  | "base"
  | "bonus"
  | "deduction"
  | "reimbursement"
  | "commission"
  | "allowance";

/** A payroll schedule entry linking a payee to their pay components. */
export interface PayrollScheduleEntry {
  readonly payeeId: string;
  readonly components: readonly PayComponent[];
}

/** A payroll run — a deterministic snapshot of all payments for a period. */
export interface PayrollRun {
  readonly id: string;
  readonly period: PayPeriod;
  readonly status: PayrollRunStatus;
  readonly entries: readonly PayrollEntry[];
  readonly totalGross: Money;
  readonly totalDeductions: Money;
  readonly totalNet: Money;
  readonly createdAt: string;
  readonly executedAt?: string;
}

export type PayrollRunStatus = "draft" | "approved" | "executed" | "failed";

export interface PayPeriod {
  readonly start: string; // ISO 8601 date
  readonly end: string;   // ISO 8601 date
  readonly label: string; // e.g. "2024-Q1", "2024-Jan"
}

/** A single payroll entry for one payee in a run. */
export interface PayrollEntry {
  readonly payeeId: string;
  readonly grossPay: Money;
  readonly deductions: Money;
  readonly netPay: Money;
  readonly components: readonly ResolvedPayComponent[];
}

/** A pay component resolved to its final amount for a specific run. */
export interface ResolvedPayComponent {
  readonly componentId: string;
  readonly name: string;
  readonly type: PayComponentType;
  readonly amount: Money;
}

// =============================================================================
// Distributions
// =============================================================================

/** A distribution plan for DAO/org distributions. */
export interface DistributionPlan {
  readonly id: string;
  readonly name: string;
  readonly strategy: DistributionStrategy;
  readonly pool: Money;
  readonly recipients: readonly DistributionRecipient[];
  readonly status: DistributionStatus;
  readonly createdAt: string;
  readonly executedAt?: string;
}

export type DistributionStrategy = "proportional" | "fixed" | "milestone";

export type DistributionStatus = "draft" | "approved" | "executed" | "failed";

/** A recipient in a distribution. */
export interface DistributionRecipient {
  readonly payeeId: string;
  /**
   * For proportional/milestone: basis points (1/10000th), bounded ≤ 10000.
   * For fixed: a fallback numeric amount, kept for backward compatibility.
   *
   * For the "fixed" strategy, prefer {@link amount} — a decimal-string Money
   * value that never round-trips through a JS number. A JS number loses
   * integer precision above 2^53 (`String(9007199254740993)` yields
   * `"9007199254740992"`), so a fixed `share` above `Number.MAX_SAFE_INTEGER`
   * is rejected with INVALID_SHARES rather than silently paying the wrong sum.
   */
  readonly share?: number;
  /**
   * For the "fixed" strategy: the exact payout amount as a decimal-string
   * Money value. Preferred over {@link share} — preserves precision for large
   * amounts. Ignored by proportional/milestone strategies.
   */
  readonly amount?: Money;
  /** For milestone: whether the milestone was met. */
  readonly milestoneMet?: boolean;
  /** The resolved payout amount (set during execution). */
  readonly resolvedAmount?: Money;
}

/** The result of executing a distribution. */
export interface DistributionResult {
  readonly planId: string;
  readonly payouts: readonly DistributionPayout[];
  readonly totalDistributed: Money;
  readonly remainder: Money;
}

export interface DistributionPayout {
  readonly payeeId: string;
  readonly amount: Money;
}

// =============================================================================
// Dual-Gate Funding
// =============================================================================

/** A funding request requiring two explicit approvals. */
export interface FundingRequest {
  readonly id: string;
  readonly description: string;
  readonly amount: Money;
  readonly requestedBy: string;
  readonly status: FundingStatus;
  readonly gate1?: FundingGate;
  readonly gate2?: FundingGate;
  readonly createdAt: string;
  readonly executedAt?: string;
}

export type FundingStatus =
  | "pending"
  | "gate1-approved"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

/** An approval gate — one of the two required signatures. */
export interface FundingGate {
  readonly approvedBy: string;
  readonly reason?: string;
  readonly approvedAt: string;
}

// =============================================================================
// Treasury Config & Snapshot
// =============================================================================

export interface TreasuryConfig {
  readonly orgId: string;
  readonly name: string;
  readonly defaultCurrency: Currency;
  readonly defaultDecimals: number;
  /** Accounts that must approve funding requests (exactly 2). */
  readonly gatekeepers: readonly [string, string];
}

export interface TreasurySnapshot {
  readonly version: number;
  readonly config: TreasuryConfig;
  readonly payees: readonly Payee[];
  readonly payrollRuns: readonly PayrollRun[];
  readonly distributionPlans: readonly DistributionPlan[];
  readonly fundingRequests: readonly FundingRequest[];
  readonly asOf: string;
}
