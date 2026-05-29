/**
 * Tests for the core Ledger class.
 *
 * Covers:
 * - Account management
 * - Append-only enforcement (no update/delete)
 * - Double-entry balance validation
 * - Entry validation (duplicates, unknown accounts, etc.)
 * - Query operations
 * - Multi-currency support
 * - Intent/txHash linkage
 * - Snapshot/restore
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { AccountRef, LedgerEntry, Money } from "@attestia/types";
import { Ledger } from "../src/ledger.js";
import { LedgerError } from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────

const TS = "2024-01-15T10:00:00.000Z";
const TS2 = "2024-01-15T11:00:00.000Z";

const CASH: AccountRef = { id: "cash", type: "asset", name: "Cash" };
const REVENUE: AccountRef = { id: "revenue", type: "income", name: "Revenue" };
const EXPENSE: AccountRef = { id: "rent", type: "expense", name: "Rent Expense" };
const PAYABLE: AccountRef = { id: "ap", type: "liability", name: "Accounts Payable" };
const EQUITY: AccountRef = { id: "equity", type: "equity", name: "Owner Equity" };

function usdc(amount: string): Money {
  return { amount, currency: "USDC", decimals: 6 };
}

function xrp(amount: string): Money {
  return { amount, currency: "XRP", decimals: 6 };
}

function makeEntry(
  id: string,
  accountId: string,
  type: "debit" | "credit",
  money: Money,
  correlationId: string,
  extra?: { intentId?: string; txHash?: string },
): LedgerEntry {
  return {
    id,
    accountId,
    type,
    money,
    timestamp: TS,
    correlationId,
    ...extra,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Ledger", () => {
  let ledger: Ledger;

  beforeEach(() => {
    ledger = new Ledger();
    ledger.registerAccount(CASH, TS);
    ledger.registerAccount(REVENUE, TS);
    ledger.registerAccount(EXPENSE, TS);
    ledger.registerAccount(PAYABLE, TS);
    ledger.registerAccount(EQUITY, TS);
  });

  // ─── Account Management ──────────────────────────────────────────────

  describe("account management", () => {
    it("registers and retrieves accounts", () => {
      const account = ledger.getAccount("cash");
      expect(account).toBeDefined();
      expect(account!.ref.type).toBe("asset");
    });

    it("checks account existence", () => {
      expect(ledger.hasAccount("cash")).toBe(true);
      expect(ledger.hasAccount("nonexistent")).toBe(false);
    });

    it("lists all accounts", () => {
      expect(ledger.getAccounts()).toHaveLength(5);
    });

    it("rejects duplicate account ID", () => {
      expect(() => ledger.registerAccount(CASH, TS)).toThrow(LedgerError);
    });

    it("uses current timestamp when none provided", () => {
      const newLedger = new Ledger();
      const account = newLedger.registerAccount({ id: "test", type: "asset", name: "Test" });
      expect(account.createdAt).toBeTruthy();
    });
  });

  // ─── Core Append ─────────────────────────────────────────────────────

  describe("append", () => {
    it("appends a balanced debit/credit pair", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ];

      const result = ledger.append(entries);
      expect(result.correlationId).toBe("tx1");
      expect(result.entryCount).toBe(2);
      expect(result.timestamp).toBe(TS);
    });

    it("appends a multi-line transaction", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("70.000000"), "tx1"),
        makeEntry("e3", "ap", "credit", usdc("30.000000"), "tx1"),
      ];

      const result = ledger.append(entries);
      expect(result.entryCount).toBe(3);
    });

    it("tracks entry count and transaction count", () => {
      expect(ledger.entryCount).toBe(0);
      expect(ledger.transactionCount).toBe(0);

      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      expect(ledger.entryCount).toBe(2);
      expect(ledger.transactionCount).toBe(1);
    });

    it("stores description from options", () => {
      ledger.append(
        [
          makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
          makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
        ],
        { description: "Payment received" },
      );

      const txns = ledger.getTransactions();
      expect(txns[0]!.description).toBe("Payment received");
    });
  });

  // ─── Validation (Fail-Closed) ────────────────────────────────────────

  describe("validation", () => {
    it("rejects empty entries", () => {
      expect(() => ledger.append([])).toThrow(LedgerError);
      expect(() => ledger.append([])).toThrow(/empty/i);
    });

    it("rejects mixed correlation IDs", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx2"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
      expect(() => ledger.append(entries)).toThrow(/correlationId/);
    });

    it("rejects duplicate entry ID (within batch)", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e1", "revenue", "credit", usdc("100.000000"), "tx1"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
      expect(() => ledger.append(entries)).toThrow(/Duplicate/);
    });

    it("rejects duplicate entry ID (across batches)", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("50.000000"), "tx2"),
        makeEntry("e3", "revenue", "credit", usdc("50.000000"), "tx2"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
      expect(() => ledger.append(entries)).toThrow(/already exists/);
    });

    it("rejects unknown account", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "nonexistent", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
      expect(() => ledger.append(entries)).toThrow(/Unknown account/);
    });

    it("rejects invalid money (empty amount)", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", { amount: "", currency: "USDC", decimals: 6 }, "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
    });

    it("rejects zero amount entries", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("0.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("0.000000"), "tx1"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
      expect(() => ledger.append(entries)).toThrow(/positive/);
    });

    it("rejects negative amount entries", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("-100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("-100.000000"), "tx1"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
      expect(() => ledger.append(entries)).toThrow(/positive/);
    });

    it("rejects unbalanced transaction", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("50.000000"), "tx1"),
      ];
      expect(() => ledger.append(entries)).toThrow(LedgerError);
      expect(() => ledger.append(entries)).toThrow(/unbalanced/i);
    });

    it("rejects unbalanced multi-currency transaction", () => {
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", xrp("100.000000"), "tx1"),
      ];
      // This should fail because USDC debits != USDC credits (100 != 0)
      expect(() => ledger.append(entries)).toThrow(LedgerError);
    });

    it("does not partially commit on validation failure", () => {
      // First append succeeds
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      // Second append fails (unbalanced)
      try {
        ledger.append([
          makeEntry("e3", "cash", "debit", usdc("200.000000"), "tx2"),
          makeEntry("e4", "revenue", "credit", usdc("100.000000"), "tx2"),
        ]);
      } catch {
        // Expected
      }

      // Only the first two entries should exist
      expect(ledger.entryCount).toBe(2);
      expect(ledger.transactionCount).toBe(1);
    });
  });

  // ─── Append-Only Enforcement ─────────────────────────────────────────

  describe("append-only enforcement", () => {
    it("has no update method", () => {
      expect((ledger as Record<string, unknown>)["update"]).toBeUndefined();
    });

    it("has no delete method", () => {
      expect((ledger as Record<string, unknown>)["delete"]).toBeUndefined();
    });

    it("has no modify method", () => {
      expect((ledger as Record<string, unknown>)["modify"]).toBeUndefined();
    });

    it("has no remove method", () => {
      expect((ledger as Record<string, unknown>)["remove"]).toBeUndefined();
    });

    it("corrections are done via reversing entries", () => {
      // Original: cash received $100
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      // Correction: reverse the original
      ledger.append([
        makeEntry("e3", "cash", "credit", usdc("100.000000"), "reverse-tx1"),
        makeEntry("e4", "revenue", "debit", usdc("100.000000"), "reverse-tx1"),
      ]);

      // Cash balance should be zero
      const balance = ledger.getBalance("cash");
      expect(balance.balances[0]!.balance).toBe("0.000000");
    });
  });

  // ─── Multi-Currency ──────────────────────────────────────────────────

  describe("multi-currency", () => {
    it("supports multiple currencies in separate transactions", () => {
      // USDC transaction
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      // XRP transaction
      ledger.append([
        makeEntry("e3", "cash", "debit", xrp("500.000000"), "tx2"),
        makeEntry("e4", "revenue", "credit", xrp("500.000000"), "tx2"),
      ]);

      const balance = ledger.getBalance("cash");
      expect(balance.balances).toHaveLength(2);

      const usdcBal = balance.balances.find((b) => b.currency === "USDC");
      const xrpBal = balance.balances.find((b) => b.currency === "XRP");

      expect(usdcBal!.balance).toBe("100.000000");
      expect(xrpBal!.balance).toBe("500.000000");
    });

    it("requires balance per currency within a single transaction", () => {
      // Both currencies must balance independently
      const entries: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
        makeEntry("e3", "cash", "debit", xrp("200.000000"), "tx1"),
        makeEntry("e4", "revenue", "credit", xrp("200.000000"), "tx1"),
      ];

      const result = ledger.append(entries);
      expect(result.entryCount).toBe(4);
    });
  });

  // ─── Intent & TxHash Linkage ─────────────────────────────────────────

  describe("intent and txHash linkage", () => {
    it("stores intentId on entries", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1", { intentId: "intent-001" }),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1", { intentId: "intent-001" }),
      ]);

      const entries = ledger.getEntries({ intentId: "intent-001" });
      expect(entries).toHaveLength(2);
    });

    it("stores txHash on entries", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1", { txHash: "0xabc123" }),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1", { txHash: "0xabc123" }),
      ]);

      const entries = ledger.getEntries({ txHash: "0xabc123" });
      expect(entries).toHaveLength(2);
    });
  });

  // ─── Query Operations ────────────────────────────────────────────────

  describe("queries", () => {
    beforeEach(() => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);
      ledger.append([
        makeEntry("e3", "cash", "debit", usdc("50.000000"), "tx2"),
        makeEntry("e4", "revenue", "credit", usdc("50.000000"), "tx2"),
      ]);
    });

    it("returns all entries without filter", () => {
      expect(ledger.getEntries()).toHaveLength(4);
    });

    it("filters by accountId", () => {
      expect(ledger.getEntries({ accountId: "cash" })).toHaveLength(2);
    });

    it("filters by correlationId", () => {
      expect(ledger.getEntries({ correlationId: "tx1" })).toHaveLength(2);
    });

    it("filters by currency", () => {
      expect(ledger.getEntries({ currency: "USDC" })).toHaveLength(4);
      expect(ledger.getEntries({ currency: "XRP" })).toHaveLength(0);
    });

    it("getEntriesByCorrelation returns transaction entries", () => {
      const entries = ledger.getEntriesByCorrelation("tx1");
      expect(entries).toHaveLength(2);
      expect(entries[0]!.id).toBe("e1");
    });

    it("getTransactions returns all transactions", () => {
      const txns = ledger.getTransactions();
      expect(txns).toHaveLength(2);
      expect(txns[0]!.correlationId).toBe("tx1");
      expect(txns[1]!.correlationId).toBe("tx2");
    });

    it("filters by timestamp range", () => {
      // Add a later transaction
      const laterEntry1: LedgerEntry = {
        id: "e5",
        accountId: "cash",
        type: "debit",
        money: usdc("25.000000"),
        timestamp: TS2,
        correlationId: "tx3",
      };
      const laterEntry2: LedgerEntry = {
        id: "e6",
        accountId: "revenue",
        type: "credit",
        money: usdc("25.000000"),
        timestamp: TS2,
        correlationId: "tx3",
      };
      ledger.append([laterEntry1, laterEntry2]);

      const filtered = ledger.getEntries({
        fromTimestamp: TS2,
      });
      expect(filtered).toHaveLength(2);
    });

    it("filters by toTimestamp", () => {
      const filtered = ledger.getEntries({
        toTimestamp: TS,
      });
      expect(filtered).toHaveLength(4);
    });
  });

  // ─── Balance Queries ─────────────────────────────────────────────────

  describe("balances", () => {
    it("computes correct balance for debit-normal account", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const balance = ledger.getBalance("cash");
      expect(balance.accountType).toBe("asset");
      expect(balance.balances[0]!.balance).toBe("100.000000");
      expect(balance.balances[0]!.totalDebits).toBe("100.000000");
      expect(balance.balances[0]!.totalCredits).toBe("0.000000");
    });

    it("computes correct balance for credit-normal account", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const balance = ledger.getBalance("revenue");
      expect(balance.accountType).toBe("income");
      expect(balance.balances[0]!.balance).toBe("100.000000");
      expect(balance.balances[0]!.totalDebits).toBe("0.000000");
      expect(balance.balances[0]!.totalCredits).toBe("100.000000");
    });

    it("returns empty balances for account with no entries", () => {
      const balance = ledger.getBalance("equity");
      expect(balance.balances).toHaveLength(0);
    });

    it("handles multiple debits and credits to the same account", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);
      ledger.append([
        makeEntry("e3", "rent", "debit", usdc("40.000000"), "tx2"),
        makeEntry("e4", "cash", "credit", usdc("40.000000"), "tx2"),
      ]);

      const balance = ledger.getBalance("cash");
      // Cash: 100 debit - 40 credit = 60 (debit-normal)
      expect(balance.balances[0]!.balance).toBe("60.000000");
      expect(balance.balances[0]!.totalDebits).toBe("100.000000");
      expect(balance.balances[0]!.totalCredits).toBe("40.000000");
    });
  });

  // ─── Trial Balance ───────────────────────────────────────────────────

  describe("trial balance", () => {
    it("produces balanced trial balance", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const tb = ledger.getTrialBalance(TS);
      expect(tb.balanced).toBe(true);
      expect(tb.lines).toHaveLength(2);
    });

    it("produces balanced trial balance with multiple transactions", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);
      ledger.append([
        makeEntry("e3", "rent", "debit", usdc("40.000000"), "tx2"),
        makeEntry("e4", "cash", "credit", usdc("40.000000"), "tx2"),
      ]);

      const tb = ledger.getTrialBalance(TS);
      expect(tb.balanced).toBe(true);
    });

    it("uses current timestamp when none provided", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const tb = ledger.getTrialBalance();
      expect(tb.generatedAt).toBeTruthy();
      expect(tb.balanced).toBe(true);
    });

    it("correctly separates debit and credit columns", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const tb = ledger.getTrialBalance(TS);

      const cashLine = tb.lines.find((l) => l.accountId === "cash");
      const revLine = tb.lines.find((l) => l.accountId === "revenue");

      // Cash (asset, debit-normal) should show in debit column
      expect(cashLine!.debitBalance).toBe("100.000000");
      expect(cashLine!.creditBalance).toBe("0.000000");

      // Revenue (income, credit-normal) should show in credit column
      expect(revLine!.debitBalance).toBe("0.000000");
      expect(revLine!.creditBalance).toBe("100.000000");
    });

    // D2-A-004: a self-consistent Ledger can never legitimately be unbalanced.
    // getTrialBalance() must fail closed (throw) on imbalance — imbalance
    // signals corruption, and silently returning balanced:false lets callers
    // ignore a broken invariant.
    it("getTrialBalance does NOT throw for a balanced ledger", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);
      expect(() => ledger.getTrialBalance(TS)).not.toThrow();
    });

    it("getTrialBalance throws UNBALANCED_TRANSACTION when internal state is corrupt", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      // Simulate state corruption: inject an unbalanced entry directly into the
      // private entries array, bypassing append()'s balance validation. This is
      // the only way a Ledger could become unbalanced — a bug or memory
      // corruption. The reporting query must refuse to return such state.
      const internal = ledger as unknown as { _entries: LedgerEntry[] };
      internal._entries.push(
        makeEntry("corrupt", "cash", "debit", usdc("0.000001"), "txX"),
      );

      let thrown: unknown;
      try {
        ledger.getTrialBalance(TS);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(LedgerError);
      expect((thrown as LedgerError).code).toBe("UNBALANCED_TRANSACTION");
    });
  });

  // ─── Snapshot & Restore ──────────────────────────────────────────────

  describe("snapshot / fromSnapshot", () => {
    it("creates a snapshot with all data", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const snap = ledger.snapshot();
      expect(snap.version).toBe(1);
      expect(snap.accounts).toHaveLength(5);
      expect(snap.entries).toHaveLength(2);
      expect(snap.createdAt).toBeTruthy();
    });

    it("restores a ledger from a snapshot", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const snap = ledger.snapshot();
      const restored = Ledger.fromSnapshot(snap);

      expect(restored.entryCount).toBe(2);
      expect(restored.getAccounts()).toHaveLength(5);

      const balance = restored.getBalance("cash");
      expect(balance.balances[0]!.balance).toBe("100.000000");
    });

    it("restored ledger maintains validation rules", () => {
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ]);

      const snap = ledger.snapshot();
      const restored = Ledger.fromSnapshot(snap);

      // Should reject duplicate entry IDs
      expect(() =>
        restored.append([
          makeEntry("e1", "cash", "debit", usdc("50.000000"), "tx2"),
          makeEntry("e3", "revenue", "credit", usdc("50.000000"), "tx2"),
        ]),
      ).toThrow(LedgerError);

      // Should accept new entries
      expect(() =>
        restored.append([
          makeEntry("e5", "cash", "debit", usdc("50.000000"), "tx3"),
          makeEntry("e6", "revenue", "credit", usdc("50.000000"), "tx3"),
        ]),
      ).not.toThrow();
    });
  });

  // ─── Determinism ─────────────────────────────────────────────────────

  describe("determinism", () => {
    it("same entries in same order produce same state", () => {
      const entries1: LedgerEntry[] = [
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      ];
      const entries2: LedgerEntry[] = [
        makeEntry("e3", "rent", "debit", usdc("40.000000"), "tx2"),
        makeEntry("e4", "cash", "credit", usdc("40.000000"), "tx2"),
      ];

      // Ledger A
      const ledgerA = new Ledger();
      ledgerA.registerAccount(CASH, TS);
      ledgerA.registerAccount(REVENUE, TS);
      ledgerA.registerAccount(EXPENSE, TS);
      ledgerA.append(entries1);
      ledgerA.append(entries2);

      // Ledger B (same operations)
      const ledgerB = new Ledger();
      ledgerB.registerAccount(CASH, TS);
      ledgerB.registerAccount(REVENUE, TS);
      ledgerB.registerAccount(EXPENSE, TS);
      ledgerB.append(entries1);
      ledgerB.append(entries2);

      const balA = ledgerA.getBalance("cash");
      const balB = ledgerB.getBalance("cash");
      expect(balA.balances[0]!.balance).toBe(balB.balances[0]!.balance);

      const tbA = ledgerA.getTrialBalance(TS);
      const tbB = ledgerB.getTrialBalance(TS);
      expect(tbA.balanced).toBe(tbB.balanced);
      expect(tbA.lines).toEqual(tbB.lines);
    });
  });

  // ─── LedgerError ─────────────────────────────────────────────────────

  describe("LedgerError", () => {
    it("has correct name and code", () => {
      const err = new LedgerError("UNBALANCED_TRANSACTION", "test");
      expect(err.name).toBe("LedgerError");
      expect(err.code).toBe("UNBALANCED_TRANSACTION");
      expect(err.message).toBe("test");
    });
  });
});
