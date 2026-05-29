/**
 * IntentLedgerMatcher tests
 */
import { describe, it, expect } from "vitest";
import { IntentLedgerMatcher } from "../src/intent-ledger-matcher.js";
import type {
  ReconcilableIntent,
  ReconcilableLedgerEntry,
} from "../src/types.js";

function usdc(amount: string): { amount: string; currency: string; decimals: number } {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("IntentLedgerMatcher", () => {
  const matcher = new IntentLedgerMatcher();

  describe("matched intents", () => {
    it("matches intent to ledger entries with same intentId", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-1",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-1",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-1",
          correlationId: "corr-1",
        },
        {
          id: "entry-2",
          accountId: "acct-2",
          type: "credit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-1",
          correlationId: "corr-1",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
      expect(results[0]!.intentId).toBe("intent-1");
      expect(results[0]!.correlationId).toBe("corr-1");
    });

    it("matches intent without amount (credit-only entries)", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-2",
          status: "executed",
          kind: "allocate",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-3",
          accountId: "acct-1",
          type: "credit",
          money: usdc("50.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-2",
          correlationId: "corr-2",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
    });
  });

  describe("amount mismatches", () => {
    it("reports amount mismatch between intent and ledger", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-3",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-4",
          accountId: "acct-1",
          type: "debit",
          money: usdc("90.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-3",
          correlationId: "corr-3",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("amount-mismatch");
      expect(results[0]!.discrepancies).toHaveLength(1);
      expect(results[0]!.discrepancies[0]).toMatch(/amount mismatch/i);
    });
  });

  describe("missing entries", () => {
    it("reports missing ledger for executed intent", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-4",
          status: "executed",
          kind: "transfer",
          amount: usdc("200.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(intents, []);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("missing-ledger");
      expect(results[0]!.discrepancies[0]).toMatch(/no ledger entries/i);
    });

    it("does not report missing ledger for declared (unexecuted) intents", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-5",
          status: "declared",
          kind: "transfer",
          amount: usdc("50.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(intents, []);
      expect(results).toHaveLength(0);
    });

    it("reports orphaned ledger entries (intentId set but intent not found)", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-orphan",
          accountId: "acct-1",
          type: "debit",
          money: usdc("75.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-ghost",
          correlationId: "corr-ghost",
        },
      ];

      const results = matcher.match([], entries);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("missing-intent");
      expect(results[0]!.discrepancies[0]).toMatch(/intent not found/i);
    });
  });

  describe("amount-bearing intent with no debit (D4-A-004)", () => {
    // An outflow intent that carries an amount but is linked only to credit
    // entries has NOT been debited. Reporting it as a clean "matched" hides a
    // real discrepancy (intent amount vs 0 debited). It must be flagged.
    it("flags an amount-bearing intent linked only to credit entries", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-credit-only",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"), // outflow of 100 expected
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-credit",
          accountId: "acct-1",
          type: "credit", // ONLY a credit — no debit recorded the outflow
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-credit-only",
          correlationId: "corr-co",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).not.toBe("matched");
      expect(["amount-mismatch", "missing-ledger"]).toContain(results[0]!.status);
      expect(results[0]!.discrepancies.length).toBeGreaterThan(0);
      // Discrepancy should make clear the debited amount is zero.
      expect(results[0]!.discrepancies.join(" ")).toMatch(/0(\.0+)?/);
    });

    it("still treats amount-less intent with only credit entries as matched", () => {
      // No amount on the intent → debit-absent is legitimately clean.
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-no-amount",
          status: "executed",
          kind: "allocate",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-credit-2",
          accountId: "acct-1",
          type: "credit",
          money: usdc("50.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-no-amount",
          correlationId: "corr-na",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
    });
  });

  describe("multiple intents", () => {
    it("matches multiple intents to their respective ledger entries", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "i-a",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "i-b",
          status: "executed",
          kind: "transfer",
          amount: usdc("200.000000"),
          declaredAt: "2024-01-01T00:01:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "e-a",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "i-a",
          correlationId: "ca",
        },
        {
          id: "e-b",
          accountId: "acct-1",
          type: "debit",
          money: usdc("200.000000"),
          timestamp: "2024-01-01T00:01:01Z",
          intentId: "i-b",
          correlationId: "cb",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "matched")).toBe(true);
    });
  });
});
