/**
 * @attestia/ledger — Append-only double-entry ledger engine.
 *
 * A pure TypeScript ledger with zero runtime dependencies.
 * Enforces double-entry accounting invariants:
 * - Every transaction balances (debits = credits)
 * - Entries are immutable once appended
 * - Corrections are new reversing entries
 * - All monetary arithmetic uses bigint (no floating point)
 * - Multi-currency accounts track balances per currency
 *
 * Design rules (inherited from Attestia):
 * - All types are readonly
 * - No mutation of stored entries
 * - Fail-closed: invalid entries throw, never silently succeed
 * - Zero runtime dependencies
 */

// Core engine
export { Ledger } from "./ledger.js";

// Account registry
export { AccountRegistry } from "./accounts.js";

// Balance computation
export {
  computeAccountBalance,
  computeTrialBalance,
  assertTrialBalanced,
} from "./balance-calculator.js";

// Money arithmetic
export {
  parseAmount,
  formatAmount,
  validateMoney,
  assertSameCurrency,
  addMoney,
  subtractMoney,
  isZero,
  isPositive,
  isNegative,
  zeroMoney,
  compareMoney,
  absMoney,
} from "./money-math.js";

// Types
export type {
  AccountType,
  NormalBalance,
  LedgerAccount,
  LedgerTransaction,
  CurrencyBalance,
  AccountBalance,
  TrialBalanceLine,
  TrialBalance,
  LedgerErrorCode,
  AppendOptions,
  AppendResult,
  LedgerSnapshot,
  EntryFilter,
} from "./types.js";

export { LedgerError, NORMAL_BALANCE } from "./types.js";
