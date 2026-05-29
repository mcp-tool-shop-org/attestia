/**
 * Tests for the balance calculator.
 *
 * Covers:
 * - Account balance computation
 * - Trial balance computation and balancing check
 * - Normal balance rules (debit vs credit normal)
 * - Multi-currency balances
 * - Edge cases (empty entries, contra balances)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { AccountRef, LedgerEntry, Money } from "@attestia/types";
import { AccountRegistry } from "../src/accounts.js";
import {
  computeAccountBalance,
  computeTrialBalance,
  assertTrialBalanced,
} from "../src/balance-calculator.js";
import { LedgerError } from "../src/types.js";
import type { TrialBalance } from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────

const TS = "2024-01-15T10:00:00.000Z";

const CASH: AccountRef = { id: "cash", type: "asset", name: "Cash" };
const REVENUE: AccountRef = { id: "revenue", type: "income", name: "Revenue" };
const EXPENSE: AccountRef = { id: "rent", type: "expense", name: "Rent" };
const PAYABLE: AccountRef = { id: "ap", type: "liability", name: "AP" };
const EQUITY: AccountRef = { id: "equity", type: "equity", name: "Equity" };

function usdc(amount: string): Money {
  return { amount, currency: "USDC", decimals: 6 };
}

function xrp(amount: string): Money {
  return { amount, currency: "XRP", decimals: 6 };
}

function entry(
  id: string,
  accountId: string,
  type: "debit" | "credit",
  money: Money,
  correlationId: string,
): LedgerEntry {
  return { id, accountId, type, money, timestamp: TS, correlationId };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("computeAccountBalance", () => {
  let accounts: AccountRegistry;

  beforeEach(() => {
    accounts = new AccountRegistry();
    accounts.register(CASH, TS);
    accounts.register(REVENUE, TS);
    accounts.register(EXPENSE, TS);
    accounts.register(PAYABLE, TS);
    accounts.register(EQUITY, TS);
  });

  it("computes balance for a debit-normal account (asset)", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      entry("e2", "cash", "debit", usdc("50.000000"), "tx2"),
      entry("e3", "cash", "credit", usdc("30.000000"), "tx3"),
    ];

    const balance = computeAccountBalance("cash", entries, accounts);
    expect(balance.accountType).toBe("asset");
    // 100 + 50 - 30 = 120
    expect(balance.balances[0]!.balance).toBe("120.000000");
    expect(balance.balances[0]!.totalDebits).toBe("150.000000");
    expect(balance.balances[0]!.totalCredits).toBe("30.000000");
  });

  it("computes balance for a credit-normal account (income)", () => {
    const entries = [
      entry("e1", "revenue", "credit", usdc("200.000000"), "tx1"),
      entry("e2", "revenue", "credit", usdc("100.000000"), "tx2"),
      entry("e3", "revenue", "debit", usdc("50.000000"), "tx3"),
    ];

    const balance = computeAccountBalance("revenue", entries, accounts);
    expect(balance.accountType).toBe("income");
    // Credits - Debits = 300 - 50 = 250
    expect(balance.balances[0]!.balance).toBe("250.000000");
  });

  it("computes balance for liability account", () => {
    const entries = [
      entry("e1", "ap", "credit", usdc("500.000000"), "tx1"),
      entry("e2", "ap", "debit", usdc("200.000000"), "tx2"),
    ];

    const balance = computeAccountBalance("ap", entries, accounts);
    // Credit-normal: 500 - 200 = 300
    expect(balance.balances[0]!.balance).toBe("300.000000");
  });

  it("computes balance for expense account", () => {
    const entries = [
      entry("e1", "rent", "debit", usdc("1000.000000"), "tx1"),
    ];

    const balance = computeAccountBalance("rent", entries, accounts);
    // Debit-normal: 1000
    expect(balance.balances[0]!.balance).toBe("1000.000000");
  });

  it("computes balance for equity account", () => {
    const entries = [
      entry("e1", "equity", "credit", usdc("5000.000000"), "tx1"),
    ];

    const balance = computeAccountBalance("equity", entries, accounts);
    // Credit-normal: 5000
    expect(balance.balances[0]!.balance).toBe("5000.000000");
  });

  it("returns empty balances for account with no entries", () => {
    const balance = computeAccountBalance("equity", [], accounts);
    expect(balance.balances).toHaveLength(0);
  });

  it("handles multi-currency balances", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      entry("e2", "cash", "debit", xrp("500.000000"), "tx2"),
    ];

    const balance = computeAccountBalance("cash", entries, accounts);
    expect(balance.balances).toHaveLength(2);

    const usdcBal = balance.balances.find((b) => b.currency === "USDC");
    const xrpBal = balance.balances.find((b) => b.currency === "XRP");

    expect(usdcBal!.balance).toBe("100.000000");
    expect(xrpBal!.balance).toBe("500.000000");
  });

  it("computes contra balance (debit-normal account with more credits)", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("50.000000"), "tx1"),
      entry("e2", "cash", "credit", usdc("100.000000"), "tx2"),
    ];

    const balance = computeAccountBalance("cash", entries, accounts);
    // 50 - 100 = -50 (contra balance for debit-normal account)
    expect(balance.balances[0]!.balance).toBe("-50.000000");
  });

  it("only includes entries for the requested account", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      entry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
    ];

    const cashBalance = computeAccountBalance("cash", entries, accounts);
    expect(cashBalance.balances).toHaveLength(1);
    expect(cashBalance.balances[0]!.balance).toBe("100.000000");
  });
});

describe("computeTrialBalance", () => {
  let accounts: AccountRegistry;

  beforeEach(() => {
    accounts = new AccountRegistry();
    accounts.register(CASH, TS);
    accounts.register(REVENUE, TS);
    accounts.register(EXPENSE, TS);
    accounts.register(PAYABLE, TS);
    accounts.register(EQUITY, TS);
  });

  it("produces a balanced trial balance for a simple transaction", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      entry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
    ];

    const tb = computeTrialBalance(entries, accounts, TS);
    expect(tb.balanced).toBe(true);
    expect(tb.generatedAt).toBe(TS);
    expect(tb.lines).toHaveLength(2);
  });

  it("produces a balanced trial balance for multiple transactions", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("1000.000000"), "tx1"),
      entry("e2", "equity", "credit", usdc("1000.000000"), "tx1"),
      entry("e3", "rent", "debit", usdc("200.000000"), "tx2"),
      entry("e4", "cash", "credit", usdc("200.000000"), "tx2"),
      entry("e5", "cash", "debit", usdc("500.000000"), "tx3"),
      entry("e6", "revenue", "credit", usdc("500.000000"), "tx3"),
    ];

    const tb = computeTrialBalance(entries, accounts, TS);
    expect(tb.balanced).toBe(true);

    // Cash: 1000 + 500 - 200 = 1300 (debit)
    const cashLine = tb.lines.find((l) => l.accountId === "cash");
    expect(cashLine!.debitBalance).toBe("1300.000000");
    expect(cashLine!.creditBalance).toBe("0.000000");

    // Revenue: 500 (credit)
    const revLine = tb.lines.find((l) => l.accountId === "revenue");
    expect(revLine!.debitBalance).toBe("0.000000");
    expect(revLine!.creditBalance).toBe("500.000000");

    // Rent: 200 (debit)
    const rentLine = tb.lines.find((l) => l.accountId === "rent");
    expect(rentLine!.debitBalance).toBe("200.000000");
    expect(rentLine!.creditBalance).toBe("0.000000");

    // Equity: 1000 (credit)
    const eqLine = tb.lines.find((l) => l.accountId === "equity");
    expect(eqLine!.debitBalance).toBe("0.000000");
    expect(eqLine!.creditBalance).toBe("1000.000000");
  });

  it("handles empty entries", () => {
    const tb = computeTrialBalance([], accounts, TS);
    expect(tb.balanced).toBe(true);
    expect(tb.lines).toHaveLength(0);
  });

  it("handles contra balances in trial balance", () => {
    // Asset account (debit-normal) with more credits than debits
    const entries = [
      entry("e1", "cash", "debit", usdc("50.000000"), "tx1"),
      entry("e2", "revenue", "credit", usdc("50.000000"), "tx1"),
      entry("e3", "rent", "debit", usdc("100.000000"), "tx2"),
      entry("e4", "cash", "credit", usdc("100.000000"), "tx2"),
    ];

    const tb = computeTrialBalance(entries, accounts, TS);
    expect(tb.balanced).toBe(true);

    // Cash: 50 - 100 = -50 (debit-normal with credit surplus → shows in credit column)
    const cashLine = tb.lines.find((l) => l.accountId === "cash");
    expect(cashLine!.debitBalance).toBe("0.000000");
    expect(cashLine!.creditBalance).toBe("50.000000");
  });

  it("handles multi-currency trial balance", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      entry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
      entry("e3", "cash", "debit", xrp("200.000000"), "tx2"),
      entry("e4", "revenue", "credit", xrp("200.000000"), "tx2"),
    ];

    const tb = computeTrialBalance(entries, accounts, TS);
    expect(tb.balanced).toBe(true);
    // 2 accounts × 2 currencies = 4 lines
    expect(tb.lines).toHaveLength(4);
  });
});

// ─── assertTrialBalanced (D2-A-004 — fail closed) ──────────────────────────

describe("assertTrialBalanced", () => {
  let accounts: AccountRegistry;

  beforeEach(() => {
    accounts = new AccountRegistry();
    accounts.register(CASH, TS);
    accounts.register(REVENUE, TS);
  });

  it("does not throw for a balanced trial balance", () => {
    const entries = [
      entry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      entry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
    ];
    const tb = computeTrialBalance(entries, accounts, TS);
    expect(() => assertTrialBalanced(tb)).not.toThrow();
    // Returns the trial balance for chaining.
    expect(assertTrialBalanced(tb)).toBe(tb);
  });

  it("throws UNBALANCED_TRANSACTION for an imbalanced trial balance", () => {
    // Hand-build a corrupt (imbalanced) trial balance — debits != credits.
    const corrupt: TrialBalance = {
      generatedAt: TS,
      balanced: false,
      lines: [
        {
          accountId: "cash",
          accountType: "asset",
          currency: "USDC",
          decimals: 6,
          debitBalance: "100.000000",
          creditBalance: "0.000000",
        },
        {
          accountId: "revenue",
          accountType: "income",
          currency: "USDC",
          decimals: 6,
          debitBalance: "0.000000",
          creditBalance: "90.000000",
        },
      ],
    };

    expect(() => assertTrialBalanced(corrupt)).toThrow(LedgerError);
    try {
      assertTrialBalanced(corrupt);
      expect.fail("expected assertTrialBalanced to throw");
    } catch (err) {
      expect((err as LedgerError).code).toBe("UNBALANCED_TRANSACTION");
    }
  });
});
