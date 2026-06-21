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

  describe("multi-currency debits (A-REC-001)", () => {
    // A second-currency outflow linked to an intent must NOT be silently
    // dropped from the debit total. Currently the debit loop sums only
    // same-currency debits, so a 50 EUR debit linked to a 100 USDC intent is
    // invisible and the intent is wrongly reported "matched". The fix must
    // flag CURRENCY_MISMATCH and refuse the clean "matched" status.
    it("flags a different-currency debit linked to an intent (CURRENCY_MISMATCH)", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-xcurr",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "debit-usdc",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-xcurr",
          correlationId: "corr-x",
        },
        {
          id: "debit-eur",
          accountId: "acct-2",
          type: "debit",
          money: { amount: "50.00", currency: "EUR", decimals: 2 },
          timestamp: "2024-01-01T00:00:02Z",
          intentId: "intent-xcurr",
          correlationId: "corr-x",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      const match = results[0]!;
      // The intent is NOT cleanly matched — a real second-currency outflow exists.
      expect(match.status).not.toBe("matched");
      // A structured CURRENCY_MISMATCH must be emitted.
      const codes = match.structuredDiscrepancies.map((d) => d.code);
      expect(codes).toContain("CURRENCY_MISMATCH");
      const curr = match.structuredDiscrepancies.find(
        (d) => d.code === "CURRENCY_MISMATCH",
      )!;
      expect(curr.dimension).toBe("currency");
      // The mismatched currency is surfaced (intent USDC vs debit EUR).
      expect(`${curr.expected} ${curr.actual}`).toMatch(/EUR/);
    });

    it("does not flag CURRENCY_MISMATCH when all debits share the intent currency", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-same",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "debit-a",
          accountId: "acct-1",
          type: "debit",
          money: usdc("60.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-same",
          correlationId: "corr-s",
        },
        {
          id: "debit-b",
          accountId: "acct-1",
          type: "debit",
          money: usdc("40.000000"),
          timestamp: "2024-01-01T00:00:02Z",
          intentId: "intent-same",
          correlationId: "corr-s",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
      expect(
        results[0]!.structuredDiscrepancies.map((d) => d.code),
      ).not.toContain("CURRENCY_MISMATCH");
    });
  });

  describe("debit decimal normalization (A-REC-002)", () => {
    // A same-currency debit recorded with a different `decimals` than the intent
    // must be normalized to a common base before summing. Currently raw scaled
    // bigints are added directly, mis-totalling the debit.
    it("matches when a same-currency debit uses a different decimal base", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-dec",
          status: "executed",
          kind: "transfer",
          amount: { amount: "100.000000", currency: "USDC", decimals: 6 },
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "debit-2dec",
          accountId: "acct-1",
          type: "debit",
          // Same value (100 USDC) but recorded with 2 decimals instead of 6.
          money: { amount: "100.00", currency: "USDC", decimals: 2 },
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-dec",
          correlationId: "corr-d",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      const match = results[0]!;
      // Values agree after normalization → matched, with a DECIMALS_MISMATCH note.
      expect(match.status).toBe("matched");
      const codes = match.structuredDiscrepancies.map((d) => d.code);
      expect(codes).toContain("DECIMALS_MISMATCH");
    });

    it("reports AMOUNT_MISMATCH when normalized values differ across decimal bases", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-dec2",
          status: "executed",
          kind: "transfer",
          amount: { amount: "100.000000", currency: "USDC", decimals: 6 },
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "debit-wrong",
          accountId: "acct-1",
          type: "debit",
          // 90 USDC at 2 decimals — differs from the 100 USDC intent even
          // after normalization.
          money: { amount: "90.00", currency: "USDC", decimals: 2 },
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-dec2",
          correlationId: "corr-d2",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      const match = results[0]!;
      expect(match.status).toBe("amount-mismatch");
      expect(match.structuredDiscrepancies.map((d) => d.code)).toContain(
        "AMOUNT_MISMATCH",
      );
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
