/**
 * @attestia/ledger — Internal types for the ledger engine.
 *
 * These extend the shared @attestia/types with ledger-specific
 * structures used only within this package.
 *
 * Rules:
 * - All types are readonly
 * - No mutation of stored entries
 * - Fail-closed: invalid entries throw, never silently succeed
 */

import type {
  AccountRef,
  LedgerEntry,
  Telemetry,
} from "@attestia/types";

// ─── Account Types ───────────────────────────────────────────────────────

/** The five fundamental account types in double-entry accounting. */
export type AccountType = AccountRef["type"];

/** Normal balance direction for an account. */
export type NormalBalance = "debit" | "credit";

/**
 * Map account types to their normal balance direction.
 *
 * - Asset, Expense → debit-normal (increases with debits)
 * - Liability, Income, Equity → credit-normal (increases with credits)
 */
export const NORMAL_BALANCE: Readonly<Record<AccountType, NormalBalance>> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  income: "credit",
  equity: "credit",
} as const;

// ─── Ledger Types ────────────────────────────────────────────────────────

/**
 * An immutable account registered in the ledger.
 * Wraps the shared AccountRef with ledger-specific metadata.
 */
export interface LedgerAccount {
  readonly ref: AccountRef;
  readonly createdAt: string;
}

/**
 * A balanced group of ledger entries sharing a correlation ID.
 * All entries within a transaction must balance (total debits = total credits).
 */
export interface LedgerTransaction {
  readonly correlationId: string;
  readonly entries: readonly LedgerEntry[];
  readonly timestamp: string;
  readonly description?: string | undefined;
}

/**
 * Balance for a single currency within an account.
 */
export interface CurrencyBalance {
  readonly currency: string;
  readonly decimals: number;
  /** Net balance as string. Positive = normal direction, negative = contra. */
  readonly balance: string;
  /** Total debits applied to this account in this currency. */
  readonly totalDebits: string;
  /** Total credits applied to this account in this currency. */
  readonly totalCredits: string;
}

/**
 * Full balance information for an account across all currencies.
 */
export interface AccountBalance {
  readonly accountId: string;
  readonly accountType: AccountType;
  readonly balances: readonly CurrencyBalance[];
}

/**
 * A single line in the trial balance.
 */
export interface TrialBalanceLine {
  readonly accountId: string;
  readonly accountType: AccountType;
  readonly currency: string;
  readonly decimals: number;
  readonly debitBalance: string;
  readonly creditBalance: string;
}

/**
 * The full trial balance report.
 * Total debits MUST equal total credits (per currency).
 */
export interface TrialBalance {
  readonly lines: readonly TrialBalanceLine[];
  readonly generatedAt: string;
  /** Whether the trial balance is in balance (debits = credits per currency). */
  readonly balanced: boolean;
}

// ─── Error Types ─────────────────────────────────────────────────────────

/** Error codes for ledger operations. */
export type LedgerErrorCode =
  | "UNBALANCED_TRANSACTION"
  | "UNKNOWN_ACCOUNT"
  | "CURRENCY_MISMATCH"
  | "INVALID_AMOUNT"
  | "DUPLICATE_ENTRY_ID"
  | "DUPLICATE_ACCOUNT_ID"
  | "EMPTY_TRANSACTION"
  | "MIXED_CORRELATION_ID"
  | "INVALID_MONEY";

/**
 * Structured error from the ledger engine.
 * Always thrown — never returns error codes silently.
 */
export class LedgerError extends Error {
  public readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

// ─── Ledger Options ──────────────────────────────────────────────────────

/**
 * Options for constructing a {@link Ledger}.
 */
export interface LedgerOptions {
  /**
   * Optional telemetry sink. When provided, the ledger emits structured
   * {@link Telemetry} events (package `"@attestia/ledger"`) on append and on
   * trial-balance failure. Emission is best-effort and never affects ledger
   * behavior — `record` is contractually non-throwing.
   *
   * @default NOOP_TELEMETRY (no events emitted)
   */
  readonly telemetry?: Telemetry;
}

// ─── Append Options ──────────────────────────────────────────────────────

/**
 * Options for appending a transaction to the ledger.
 */
export interface AppendOptions {
  readonly description?: string | undefined;
}

/**
 * Result of a successful append operation.
 */
export interface AppendResult {
  readonly correlationId: string;
  readonly entryCount: number;
  readonly timestamp: string;
}

// ─── Snapshot Types ──────────────────────────────────────────────────────

/**
 * Serializable snapshot of the entire ledger state.
 * Used for persistence and rehydration.
 */
export interface LedgerSnapshot {
  readonly version: 1;
  readonly accounts: readonly LedgerAccount[];
  readonly entries: readonly LedgerEntry[];
  readonly createdAt: string;
}

// ─── Query Types ─────────────────────────────────────────────────────────

/**
 * Filter criteria for querying ledger entries.
 */
export interface EntryFilter {
  readonly accountId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly intentId?: string | undefined;
  readonly txHash?: string | undefined;
  readonly currency?: string | undefined;
  readonly fromTimestamp?: string | undefined;
  readonly toTimestamp?: string | undefined;
}
