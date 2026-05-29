/**
 * @attestia/ledger — Core Ledger class.
 *
 * Append-only double-entry ledger engine. Once an entry is written,
 * it is permanent. Corrections are new reversing entries.
 *
 * API surface:
 * - registerAccount() — Add an account to the chart
 * - append() — Append a balanced set of entries
 * - getBalance() — Get account balance by ID
 * - getTrialBalance() — Compute the full trial balance
 * - getEntries() — Query entries with optional filters
 * - getEntriesByCorrelation() — Get all entries for a correlation ID
 * - snapshot() — Serialize the entire ledger state
 * - fromSnapshot() — Restore ledger from a snapshot
 *
 * There is NO update(), delete(), or modify(). This is by design.
 */

import type { AccountRef, LedgerEntry } from "@attestia/types";
import { AccountRegistry } from "./accounts.js";
import {
  assertTrialBalanced,
  computeAccountBalance,
  computeTrialBalance,
} from "./balance-calculator.js";
import { validateMoney } from "./money-math.js";
import type {
  AccountBalance,
  AppendOptions,
  AppendResult,
  EntryFilter,
  LedgerAccount,
  LedgerSnapshot,
  LedgerTransaction,
  TrialBalance,
} from "./types.js";
import { LedgerError } from "./types.js";
import { parseAmount } from "./money-math.js";

/**
 * Append-only double-entry ledger.
 *
 * Every append must be a balanced set of entries where total debits
 * equal total credits within the same currency. Entries are immutable
 * once appended. The only way to "correct" an entry is to append
 * a reversing entry.
 */
export class Ledger {
  private readonly _accounts: AccountRegistry = new AccountRegistry();
  private readonly _entries: LedgerEntry[] = [];
  private readonly _entryIds: Set<string> = new Set();
  private readonly _transactions: LedgerTransaction[] = [];

  // ─── Account Management ──────────────────────────────────────────────

  /**
   * Register a new account in the chart of accounts.
   * Accounts are immutable once registered.
   */
  registerAccount(ref: AccountRef, timestamp?: string): LedgerAccount {
    const ts = timestamp ?? new Date().toISOString();
    return this._accounts.register(ref, ts);
  }

  /**
   * Get an account by ID.
   */
  getAccount(id: string): LedgerAccount | undefined {
    return this._accounts.get(id);
  }

  /**
   * Check if an account exists.
   */
  hasAccount(id: string): boolean {
    return this._accounts.has(id);
  }

  /**
   * Get all registered accounts.
   */
  getAccounts(): readonly LedgerAccount[] {
    return this._accounts.getAll();
  }

  // ─── Core Append (The Only Write Operation) ──────────────────────────

  /**
   * Append a balanced set of ledger entries.
   *
   * Validation rules (fail-closed — all must pass):
   * 1. Entries array must not be empty
   * 2. All entries must share the same correlationId
   * 3. All entry IDs must be unique (globally)
   * 4. All referenced accounts must exist
   * 5. All Money values must be valid
   * 6. All entry amounts must be positive
   * 7. Total debits must equal total credits (per currency)
   *
   * Throws LedgerError if any validation fails.
   */
  append(entries: readonly LedgerEntry[], options?: AppendOptions): AppendResult {
    // Rule 1: Non-empty
    if (entries.length === 0) {
      throw new LedgerError("EMPTY_TRANSACTION", "Cannot append an empty set of entries");
    }

    // Rule 2: Same correlation ID
    const correlationId = entries[0]!.correlationId;
    for (const entry of entries) {
      if (entry.correlationId !== correlationId) {
        throw new LedgerError(
          "MIXED_CORRELATION_ID",
          `All entries must share the same correlationId. Expected "${correlationId}", got "${entry.correlationId}"`,
        );
      }
    }

    // Rule 3: Unique entry IDs (check against existing AND within batch)
    const batchIds = new Set<string>();
    for (const entry of entries) {
      if (this._entryIds.has(entry.id)) {
        throw new LedgerError(
          "DUPLICATE_ENTRY_ID",
          `Entry ID already exists in ledger: "${entry.id}"`,
        );
      }
      if (batchIds.has(entry.id)) {
        throw new LedgerError(
          "DUPLICATE_ENTRY_ID",
          `Duplicate entry ID within batch: "${entry.id}"`,
        );
      }
      batchIds.add(entry.id);
    }

    // Rule 4: All accounts must exist
    for (const entry of entries) {
      this._accounts.assertExists(entry.accountId);
    }

    // Rule 5: All Money values must be valid
    for (const entry of entries) {
      validateMoney(entry.money);
    }

    // Rule 6: All amounts must be positive
    for (const entry of entries) {
      const scaled = parseAmount(entry.money.amount, entry.money.decimals);
      if (scaled <= 0n) {
        throw new LedgerError(
          "INVALID_AMOUNT",
          `Entry amounts must be positive. Entry "${entry.id}" has amount "${entry.money.amount}"`,
        );
      }
    }

    // Rule 7: Balance check per currency
    this._assertBalanced(entries);

    // All validations passed — append (committed atomically)
    const timestamp = entries[0]!.timestamp;

    for (const entry of entries) {
      this._entries.push(entry);
      this._entryIds.add(entry.id);
    }

    const transaction: LedgerTransaction = {
      correlationId,
      entries: [...entries],
      timestamp,
      description: options?.description,
    };
    this._transactions.push(transaction);

    return {
      correlationId,
      entryCount: entries.length,
      timestamp,
    };
  }

  /**
   * Assert that debits equal credits within a set of entries, per currency.
   */
  private _assertBalanced(entries: readonly LedgerEntry[]): void {
    // Group by currency
    const currencyTotals = new Map<string, { debits: bigint; credits: bigint }>();

    for (const entry of entries) {
      const currency = entry.money.currency;
      let totals = currencyTotals.get(currency);
      if (totals === undefined) {
        totals = { debits: 0n, credits: 0n };
        currencyTotals.set(currency, totals);
      }

      const amount = parseAmount(entry.money.amount, entry.money.decimals);

      if (entry.type === "debit") {
        totals.debits += amount;
      } else {
        totals.credits += amount;
      }
    }

    for (const [currency, totals] of currencyTotals) {
      if (totals.debits !== totals.credits) {
        throw new LedgerError(
          "UNBALANCED_TRANSACTION",
          `Transaction is unbalanced for currency "${currency}": debits=${totals.debits.toString()}, credits=${totals.credits.toString()}`,
        );
      }
    }
  }

  // ─── Query Operations ────────────────────────────────────────────────

  /**
   * Get the balance for a specific account.
   */
  getBalance(accountId: string): AccountBalance {
    return computeAccountBalance(accountId, this._entries, this._accounts);
  }

  /**
   * Compute the full trial balance.
   *
   * Fails closed: because every appended transaction is balance-validated, a
   * self-consistent ledger can never produce an unbalanced trial balance. If it
   * does, that signals corruption, so this method throws
   * `LedgerError("UNBALANCED_TRANSACTION")` rather than returning a
   * `balanced: false` report that a caller might ignore. Use the standalone
   * `computeTrialBalance` if you need the boolean flag for reporting.
   */
  getTrialBalance(timestamp?: string): TrialBalance {
    const ts = timestamp ?? new Date().toISOString();
    return assertTrialBalanced(
      computeTrialBalance(this._entries, this._accounts, ts),
    );
  }

  /**
   * Get all entries, optionally filtered.
   */
  getEntries(filter?: EntryFilter): readonly LedgerEntry[] {
    if (filter === undefined) {
      return [...this._entries];
    }

    return this._entries.filter((entry) => {
      if (filter.accountId !== undefined && entry.accountId !== filter.accountId) {
        return false;
      }
      if (filter.correlationId !== undefined && entry.correlationId !== filter.correlationId) {
        return false;
      }
      if (filter.intentId !== undefined && entry.intentId !== filter.intentId) {
        return false;
      }
      if (filter.txHash !== undefined && entry.txHash !== filter.txHash) {
        return false;
      }
      if (filter.currency !== undefined && entry.money.currency !== filter.currency) {
        return false;
      }
      if (filter.fromTimestamp !== undefined && entry.timestamp < filter.fromTimestamp) {
        return false;
      }
      if (filter.toTimestamp !== undefined && entry.timestamp > filter.toTimestamp) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get all entries for a given correlation ID (a full transaction).
   */
  getEntriesByCorrelation(correlationId: string): readonly LedgerEntry[] {
    return this._entries.filter((e) => e.correlationId === correlationId);
  }

  /**
   * Get all transactions.
   */
  getTransactions(): readonly LedgerTransaction[] {
    return [...this._transactions];
  }

  /**
   * Get the total number of entries in the ledger.
   */
  get entryCount(): number {
    return this._entries.length;
  }

  /**
   * Get the total number of transactions in the ledger.
   */
  get transactionCount(): number {
    return this._transactions.length;
  }

  // ─── Snapshot (Persistence) ──────────────────────────────────────────

  /**
   * Create a serializable snapshot of the ledger.
   * Can be restored with Ledger.fromSnapshot().
   */
  snapshot(): LedgerSnapshot {
    return {
      version: 1,
      accounts: this._accounts.getAll(),
      entries: [...this._entries],
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Restore a ledger from a snapshot.
   * Replays all accounts and entries, preserving full validation.
   */
  static fromSnapshot(snapshot: LedgerSnapshot): Ledger {
    const ledger = new Ledger();

    // Restore accounts
    for (const account of snapshot.accounts) {
      ledger._accounts.register(account.ref, account.createdAt);
    }

    // Group entries by correlationId and replay
    const groups = new Map<string, LedgerEntry[]>();
    for (const entry of snapshot.entries) {
      let group = groups.get(entry.correlationId);
      if (group === undefined) {
        group = [];
        groups.set(entry.correlationId, group);
      }
      group.push(entry);
    }

    for (const entries of groups.values()) {
      ledger.append(entries);
    }

    return ledger;
  }
}
