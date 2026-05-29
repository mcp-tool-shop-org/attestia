/**
 * Structured reconciliation discrepancies (D4-B-002).
 *
 * Verifies that matchers emit machine-readable {@link Discrepancy} objects
 * alongside the legacy prose `string[]`, that the structured form carries the
 * right code / dimension / expected / actual, and that the reconciliation
 * summary aggregates them by code.
 */
import { describe, it, expect } from "vitest";
import { IntentLedgerMatcher } from "../src/intent-ledger-matcher.js";
import { LedgerChainMatcher } from "../src/ledger-chain-matcher.js";
import { IntentChainMatcher } from "../src/intent-chain-matcher.js";
import { Reconciler } from "../src/reconciler.js";
import { countByCode, makeDiscrepancy } from "../src/discrepancy.js";
import type {
  ReconcilableIntent,
  ReconcilableLedgerEntry,
  ReconcilableChainEvent,
} from "../src/types.js";

function usdc(amount: string): { amount: string; currency: string; decimals: number } {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("structured discrepancies (D4-B-002)", () => {
  describe("IntentLedgerMatcher emits structured discrepancies", () => {
    it("an amount mismatch yields code AMOUNT_MISMATCH + dimension amount + expected/actual", () => {
      const matcher = new IntentLedgerMatcher();
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
          money: usdc("90.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-1",
          correlationId: "corr-1",
        },
      ];

      const results = matcher.match(intents, entries);
      expect(results).toHaveLength(1);
      const match = results[0]!;

      // Legacy prose still present (backward compat) ...
      expect(match.discrepancies).toHaveLength(1);
      // ... and a structured companion in lockstep.
      expect(match.structuredDiscrepancies).toHaveLength(1);

      const d = match.structuredDiscrepancies[0]!;
      expect(d.code).toBe("AMOUNT_MISMATCH");
      expect(d.dimension).toBe("amount");
      expect(d.expected).toBe("100.000000");
      expect(d.actual).toBe("90.000000");
      // Structured message mirrors the prose string exactly.
      expect(d.message).toBe(match.discrepancies[0]);
    });

    it("flags an amount-bearing intent with no debit (credit-only) as AMOUNT_MISMATCH", () => {
      const matcher = new IntentLedgerMatcher();
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-co",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-credit",
          accountId: "acct-1",
          type: "credit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-co",
          correlationId: "corr-co",
        },
      ];

      const d = matcher.match(intents, entries)[0]!.structuredDiscrepancies[0]!;
      expect(d.code).toBe("AMOUNT_MISMATCH");
      expect(d.dimension).toBe("amount");
      expect(d.actual).toBe("0.000000");
    });

    it("a missing ledger entry yields MISSING_LEDGER + dimension presence (no expected/actual)", () => {
      const matcher = new IntentLedgerMatcher();
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-2",
          status: "executed",
          kind: "transfer",
          amount: usdc("200.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const d = matcher.match(intents, [])[0]!.structuredDiscrepancies[0]!;
      expect(d.code).toBe("MISSING_LEDGER");
      expect(d.dimension).toBe("presence");
      expect(d.expected).toBeUndefined();
      expect(d.actual).toBeUndefined();
    });

    it("an orphaned ledger entry yields MISSING_INTENT + presence", () => {
      const matcher = new IntentLedgerMatcher();
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

      const d = matcher.match([], entries)[0]!.structuredDiscrepancies[0]!;
      expect(d.code).toBe("MISSING_INTENT");
      expect(d.dimension).toBe("presence");
    });

    it("a clean match has an empty structuredDiscrepancies array", () => {
      const matcher = new IntentLedgerMatcher();
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-ok",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-ok",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-ok",
          correlationId: "corr-ok",
        },
      ];

      const match = matcher.match(intents, entries)[0]!;
      expect(match.status).toBe("matched");
      expect(match.structuredDiscrepancies).toEqual([]);
    });
  });

  describe("LedgerChainMatcher emits structured discrepancies", () => {
    it("a symbol mismatch yields CURRENCY_MISMATCH + dimension currency + expected/actual", () => {
      const matcher = new LedgerChainMatcher();
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "le-1",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          txHash: "0xabc",
          correlationId: "corr-1",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "ethereum",
          txHash: "0xabc",
          from: "0xfrom",
          to: "0xto",
          amount: "100000000",
          decimals: 6,
          symbol: "USDT", // ledger says USDC, chain says USDT
          timestamp: "2024-01-01T00:00:02Z",
        },
      ];

      const d = matcher.match(entries, events)[0]!.structuredDiscrepancies[0]!;
      expect(d.code).toBe("CURRENCY_MISMATCH");
      expect(d.dimension).toBe("currency");
      expect(d.expected).toBe("USDC");
      expect(d.actual).toBe("USDT");
    });

    it("an unmatched on-chain event yields MISSING_LEDGER + presence", () => {
      const matcher = new LedgerChainMatcher();
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "ethereum",
          txHash: "0xorphan",
          from: "0xfrom",
          to: "0xto",
          amount: "5000000",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:02Z",
        },
      ];

      const d = matcher.match([], events)[0]!.structuredDiscrepancies[0]!;
      expect(d.code).toBe("MISSING_LEDGER");
      expect(d.dimension).toBe("presence");
    });
  });

  describe("IntentChainMatcher emits structured discrepancies", () => {
    it("an executed intent with no chain event yields MISSING_CHAIN + presence", () => {
      const matcher = new IntentChainMatcher();
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-x",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          chainId: "ethereum",
          txHash: "0xmissing",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const d = matcher.match(intents, [])[0]!.structuredDiscrepancies[0]!;
      expect(d.code).toBe("MISSING_CHAIN");
      expect(d.dimension).toBe("presence");
    });

    it("an unauthorized chain transfer yields MISSING_INTENT + presence", () => {
      const matcher = new IntentChainMatcher();
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "ethereum",
          txHash: "0xrogue",
          from: "0xfrom",
          to: "0xto",
          amount: "100000000",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:02Z",
        },
      ];

      const d = matcher.match([], events)[0]!.structuredDiscrepancies[0]!;
      expect(d.code).toBe("MISSING_INTENT");
      expect(d.dimension).toBe("presence");
    });
  });

  describe("summary aggregates structured discrepancies by code", () => {
    it("counts discrepancies by code across all three matching dimensions", () => {
      const reconciler = new Reconciler();

      const intents: ReconcilableIntent[] = [
        // executed but no ledger + no chain → MISSING_LEDGER (intent↔ledger)
        // and MISSING_CHAIN (intent↔chain)
        {
          id: "intent-missing",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          chainId: "ethereum",
          txHash: "0xnochain",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const report = reconciler.reconcile({
        intents,
        ledgerEntries: [],
        chainEvents: [],
      });

      const counts = report.summary.discrepancyCountsByCode;
      expect(counts["MISSING_LEDGER"]).toBe(1);
      expect(counts["MISSING_CHAIN"]).toBe(1);

      // The flat structured list matches the per-code totals.
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      expect(report.summary.structuredDiscrepancies).toHaveLength(total);
      // And prose + structured stay in lockstep (same count).
      expect(report.summary.discrepancies).toHaveLength(
        report.summary.structuredDiscrepancies.length,
      );
    });

    it("a fully reconciled report has no structured discrepancies", () => {
      const reconciler = new Reconciler();
      const report = reconciler.reconcile({
        intents: [],
        ledgerEntries: [],
        chainEvents: [],
      });
      expect(report.summary.allReconciled).toBe(true);
      expect(report.summary.structuredDiscrepancies).toEqual([]);
      expect(report.summary.discrepancyCountsByCode).toEqual({});
    });
  });

  describe("discrepancy helpers", () => {
    it("makeDiscrepancy omits expected/actual when not provided", () => {
      const d = makeDiscrepancy("MISSING_INTENT", "presence", "gone");
      expect(d).toEqual({
        code: "MISSING_INTENT",
        dimension: "presence",
        message: "gone",
      });
      expect("expected" in d).toBe(false);
      expect("actual" in d).toBe(false);
    });

    it("countByCode tallies and omits absent codes", () => {
      const counts = countByCode([
        makeDiscrepancy("AMOUNT_MISMATCH", "amount", "a"),
        makeDiscrepancy("AMOUNT_MISMATCH", "amount", "b"),
        makeDiscrepancy("MISSING_CHAIN", "presence", "c"),
      ]);
      expect(counts).toEqual({ AMOUNT_MISMATCH: 2, MISSING_CHAIN: 1 });
    });
  });
});
