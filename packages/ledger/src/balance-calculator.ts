/**
 * @attestia/ledger — Balance calculation engine.
 *
 * Computes account balances, trial balances, and balance queries.
 * All calculations are deterministic using bigint arithmetic.
 *
 * Rules:
 * - Balances are computed per-currency (never cross-currency)
 * - Normal balance rules determine sign conventions
 * - Trial balance must always balance (debits = credits per currency)
 */

import type { LedgerEntry } from "@attestia/types";
import type { AccountRegistry } from "./accounts.js";
import type {
  AccountBalance,
  CurrencyBalance,
  TrialBalance,
  TrialBalanceLine,
} from "./types.js";
import { LedgerError, NORMAL_BALANCE } from "./types.js";
import { formatAmount, parseAmount } from "./money-math.js";

/**
 * Key for grouping entries by account + currency.
 */
function balanceKey(accountId: string, currency: string): string {
  return `${accountId}::${currency}`;
}

/**
 * Internal accumulator for building balances.
 */
interface BalanceAccumulator {
  readonly accountId: string;
  readonly currency: string;
  readonly decimals: number;
  totalDebits: bigint;
  totalCredits: bigint;
}

/**
 * Build accumulators from a list of entries.
 */
function buildAccumulators(
  entries: readonly LedgerEntry[],
): Map<string, BalanceAccumulator> {
  const accumulators = new Map<string, BalanceAccumulator>();

  for (const entry of entries) {
    const key = balanceKey(entry.accountId, entry.money.currency);
    let acc = accumulators.get(key);

    if (acc === undefined) {
      acc = {
        accountId: entry.accountId,
        currency: entry.money.currency,
        decimals: entry.money.decimals,
        totalDebits: 0n,
        totalCredits: 0n,
      };
      accumulators.set(key, acc);
    }

    const amount = parseAmount(entry.money.amount, entry.money.decimals);

    if (entry.type === "debit") {
      acc.totalDebits += amount;
    } else {
      acc.totalCredits += amount;
    }
  }

  return accumulators;
}

/**
 * Compute the balance for a single account across all currencies.
 */
export function computeAccountBalance(
  accountId: string,
  entries: readonly LedgerEntry[],
  accounts: AccountRegistry,
): AccountBalance {
  const account = accounts.assertExists(accountId);
  const accountEntries = entries.filter((e) => e.accountId === accountId);
  const accumulators = buildAccumulators(accountEntries);
  const normalBalance = NORMAL_BALANCE[account.ref.type];

  const balances: CurrencyBalance[] = [];

  for (const acc of accumulators.values()) {
    // Compute net balance based on normal balance direction
    const net = normalBalance === "debit"
      ? acc.totalDebits - acc.totalCredits
      : acc.totalCredits - acc.totalDebits;

    balances.push({
      currency: acc.currency,
      decimals: acc.decimals,
      balance: formatAmount(net, acc.decimals),
      totalDebits: formatAmount(acc.totalDebits, acc.decimals),
      totalCredits: formatAmount(acc.totalCredits, acc.decimals),
    });
  }

  return {
    accountId,
    accountType: account.ref.type,
    balances,
  };
}

/**
 * Compute the trial balance from all entries.
 *
 * For each account+currency:
 * - Debit-normal accounts: if net debit > 0, show in debit column; else credit column
 * - Credit-normal accounts: if net credit > 0, show in credit column; else debit column
 *
 * Total debits MUST equal total credits per currency for the trial balance to be balanced.
 */
export function computeTrialBalance(
  entries: readonly LedgerEntry[],
  accounts: AccountRegistry,
  timestamp: string,
): TrialBalance {
  const accumulators = buildAccumulators(entries);
  const lines: TrialBalanceLine[] = [];

  // Track totals per currency
  const currencyTotals = new Map<string, { debits: bigint; credits: bigint; decimals: number }>();

  for (const acc of accumulators.values()) {
    const accountType = accounts.getType(acc.accountId);
    const normalBal = NORMAL_BALANCE[accountType];

    // Net balance in the account's normal direction
    const netDebit = acc.totalDebits - acc.totalCredits;

    let debitBalance: bigint;
    let creditBalance: bigint;

    if (normalBal === "debit") {
      // Debit-normal: positive net goes to debit column
      if (netDebit >= 0n) {
        debitBalance = netDebit;
        creditBalance = 0n;
      } else {
        debitBalance = 0n;
        creditBalance = -netDebit;
      }
    } else {
      // Credit-normal: positive net credit goes to credit column
      const netCredit = acc.totalCredits - acc.totalDebits;
      if (netCredit >= 0n) {
        debitBalance = 0n;
        creditBalance = netCredit;
      } else {
        debitBalance = -netCredit;
        creditBalance = 0n;
      }
    }

    lines.push({
      accountId: acc.accountId,
      accountType,
      currency: acc.currency,
      decimals: acc.decimals,
      debitBalance: formatAmount(debitBalance, acc.decimals),
      creditBalance: formatAmount(creditBalance, acc.decimals),
    });

    // Accumulate totals per currency
    let totals = currencyTotals.get(acc.currency);
    if (totals === undefined) {
      totals = { debits: 0n, credits: 0n, decimals: acc.decimals };
      currencyTotals.set(acc.currency, totals);
    }
    totals.debits += debitBalance;
    totals.credits += creditBalance;
  }

  // Check if balanced per currency
  let balanced = true;
  for (const totals of currencyTotals.values()) {
    if (totals.debits !== totals.credits) {
      balanced = false;
      break;
    }
  }

  return {
    lines,
    generatedAt: timestamp,
    balanced,
  };
}

/**
 * Assert that a trial balance is in balance (debits = credits per currency),
 * failing closed if it is not.
 *
 * The double-entry invariant (every transaction balances) means a
 * self-consistent ledger can NEVER legitimately produce an unbalanced trial
 * balance. An imbalance therefore signals corruption — a bug, tampered state,
 * or partial write — and must be treated as an error, not a reportable
 * condition. This is the fail-closed counterpart to {@link computeTrialBalance},
 * which keeps the boolean flag for standalone reporting.
 *
 * Totals are recomputed from the lines (not trusting the `balanced` flag) so a
 * tampered flag cannot smuggle an imbalanced report past this check.
 *
 * @param trialBalance - The trial balance to verify
 * @returns The same trial balance (for chaining) when balanced
 * @throws LedgerError("UNBALANCED_TRANSACTION") if any currency is unbalanced
 */
export function assertTrialBalanced(trialBalance: TrialBalance): TrialBalance {
  const totalsByCurrency = new Map<string, { debits: bigint; credits: bigint }>();

  for (const line of trialBalance.lines) {
    let totals = totalsByCurrency.get(line.currency);
    if (totals === undefined) {
      totals = { debits: 0n, credits: 0n };
      totalsByCurrency.set(line.currency, totals);
    }
    totals.debits += parseAmount(line.debitBalance, line.decimals);
    totals.credits += parseAmount(line.creditBalance, line.decimals);
  }

  for (const [currency, totals] of totalsByCurrency) {
    if (totals.debits !== totals.credits) {
      throw new LedgerError(
        "UNBALANCED_TRANSACTION",
        `Trial balance is unbalanced for currency "${currency}": debits=${totals.debits.toString()}, credits=${totals.credits.toString()}. A balanced ledger cannot produce this — state is corrupt.`,
      );
    }
  }

  return trialBalance;
}
