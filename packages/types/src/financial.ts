/**
 * Financial Types
 *
 * Core financial primitives for deterministic accounting.
 * Ported from payroll-engine concepts, simplified for web3.
 *
 * Rules:
 * - All amounts are strings to avoid floating-point errors
 * - Currency is always explicit (no implicit USD)
 * - Ledger entries are append-only by contract
 */

/**
 * Supported currency identifiers.
 * Token symbols for crypto, ISO 4217 codes for reference.
 */
export type Currency = string;

/**
 * A precise monetary amount.
 * String representation to avoid IEEE 754 floating-point issues.
 * Use a bigint or decimal library for arithmetic.
 *
 * **Precision contract:** `amount` and `decimals` together declare the scale
 * of the value, and they must be coherent — the number of fractional digits in
 * `amount` must not exceed `decimals`. `{ amount: "100.50", decimals: 2 }` and
 * `{ amount: "100", decimals: 6 }` are valid; `{ amount: "100.999",
 * decimals: 2 }` is NOT, because it carries 3 fractional digits while declaring
 * 2. Consumers scale by `10 ** decimals` to reach the canonical integer
 * representation, so an over-precise amount would silently misround. The
 * {@link isMoney} guard enforces this fail-closed at system boundaries.
 */
export interface Money {
  /**
   * String representation of the amount (e.g., "100.50", "1000000").
   * Must be a canonical decimal numeral with at most `decimals` fractional
   * digits (see the precision contract on {@link Money}).
   */
  readonly amount: string;

  /** Currency symbol or identifier (e.g., "USDC", "XRP", "RLUSD") */
  readonly currency: Currency;

  /**
   * Number of decimal places for this currency.
   * XRP = 6 (drops), USDC = 6, ETH = 18 (wei).
   * `amount` must not carry more fractional digits than this.
   */
  readonly decimals: number;
}

/**
 * Reference to an account in the ledger.
 */
export interface AccountRef {
  /** Unique account identifier */
  readonly id: string;

  /** Account type (asset, liability, income, expense, equity) */
  readonly type: "asset" | "liability" | "income" | "expense" | "equity";

  /** Human-readable name */
  readonly name: string;
}

/**
 * Type of ledger entry (double-entry accounting).
 */
export type LedgerEntryType = "debit" | "credit";

/**
 * A single line in the ledger.
 * Always part of a balanced transaction (debits = credits).
 */
export interface LedgerEntry {
  /** Unique entry identifier */
  readonly id: string;

  /** Which account this entry affects */
  readonly accountId: string;

  /** Debit or credit */
  readonly type: LedgerEntryType;

  /** The amount */
  readonly money: Money;

  /** ISO 8601 timestamp */
  readonly timestamp: string;

  /** Reference to the intent that caused this entry */
  readonly intentId?: string;

  /** Reference to the on-chain transaction */
  readonly txHash?: string;

  /** Correlation ID for grouping related entries */
  readonly correlationId: string;
}
