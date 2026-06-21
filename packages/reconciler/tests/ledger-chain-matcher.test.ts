/**
 * LedgerChainMatcher tests
 */
import { describe, it, expect } from "vitest";
import { LedgerChainMatcher } from "../src/ledger-chain-matcher.js";
import type {
  ReconcilableLedgerEntry,
  ReconcilableChainEvent,
} from "../src/types.js";

function usdc(amount: string): { amount: string; currency: string; decimals: number } {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("LedgerChainMatcher", () => {
  const matcher = new LedgerChainMatcher();

  describe("matched entries", () => {
    it("matches ledger entry to chain event by txHash", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-1",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xabc123",
          correlationId: "corr-1",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xabc123",
          from: "0xsender",
          to: "0xreceiver",
          amount: "100000000", // 100 USDC in smallest unit (6 dec)
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(entries, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
      expect(results[0]!.txHash).toBe("0xabc123");
    });

    it("skips ledger entries without txHash", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-notx",
          accountId: "acct-1",
          type: "debit",
          money: usdc("50.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          correlationId: "corr-none",
        },
      ];

      const results = matcher.match(entries, []);
      expect(results).toHaveLength(0);
    });
  });

  describe("amount mismatches", () => {
    it("reports amount mismatch between ledger and chain", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-2",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xdef456",
          correlationId: "corr-2",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xdef456",
          from: "0xsender",
          to: "0xreceiver",
          amount: "90000000", // 90 USDC — mismatch
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(entries, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("amount-mismatch");
      expect(results[0]!.discrepancies).toHaveLength(1);
    });

    it("reports currency mismatch", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-curr",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xmix",
          correlationId: "corr-mix",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xmix",
          from: "0xsender",
          to: "0xreceiver",
          amount: "100000000000000000000",
          decimals: 18,
          symbol: "ETH",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(entries, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("amount-mismatch");
      expect(results[0]!.discrepancies[0]).toMatch(/currency mismatch/i);
    });
  });

  describe("missing records", () => {
    it("reports missing chain event for ledger entry with txHash", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-miss",
          accountId: "acct-1",
          type: "debit",
          money: usdc("50.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xghost",
          correlationId: "corr-ghost",
        },
      ];

      const results = matcher.match(entries, []);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("missing-chain");
      expect(results[0]!.discrepancies[0]).toMatch(/no on-chain event/i);
    });

    it("reports unmatched on-chain events", () => {
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "xrpl:mainnet",
          txHash: "0xorphan",
          from: "rSender",
          to: "rReceiver",
          amount: "1000000",
          decimals: 6,
          symbol: "XRP",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match([], events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("missing-ledger");
      expect(results[0]!.discrepancies[0]).toMatch(/no matching ledger entry/i);
    });
  });

  describe("malformed chain amounts (A-REC-003)", () => {
    // An untrusted chain event carrying a non-numeric amount must NOT throw
    // out of the whole batch. The bad match is flagged and other entries still
    // reconcile.
    it("does not throw when a chain amount is malformed", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-bad",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xbad",
          correlationId: "corr-bad",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xbad",
          from: "0xsender",
          to: "0xreceiver",
          amount: "not-a-number", // malformed — BigInt() would throw
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      expect(() => matcher.match(entries, events)).not.toThrow();
      const results = matcher.match(entries, events);
      const bad = results.find((r) => r.txHash === "0xbad")!;
      expect(bad).toBeDefined();
      expect(bad.status).not.toBe("matched");
      expect(bad.structuredDiscrepancies.length).toBeGreaterThan(0);
    });

    it("one malformed event does not abort reconciliation of good entries", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-good",
          accountId: "acct-1",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xgood",
          correlationId: "corr-good",
        },
        {
          id: "entry-bad2",
          accountId: "acct-1",
          type: "debit",
          money: usdc("50.000000"),
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xbad2",
          correlationId: "corr-bad2",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xgood",
          from: "0xsender",
          to: "0xreceiver",
          amount: "100000000",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:00Z",
        },
        {
          chainId: "eth:1",
          txHash: "0xbad2",
          from: "0xsender",
          to: "0xreceiver",
          amount: "12.5", // not an integer string — BigInt() would throw
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(entries, events);
      const good = results.find((r) => r.txHash === "0xgood")!;
      expect(good.status).toBe("matched");
      const bad = results.find((r) => r.txHash === "0xbad2")!;
      expect(bad.status).not.toBe("matched");
      expect(bad.structuredDiscrepancies.length).toBeGreaterThan(0);
    });
  });

  describe("cross-decimal matching", () => {
    it("normalizes amounts across different decimal bases", () => {
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-xdec",
          accountId: "acct-1",
          type: "debit",
          money: { amount: "1.000000", currency: "TOKEN", decimals: 6 },
          timestamp: "2024-01-01T00:00:00Z",
          txHash: "0xdec",
          correlationId: "corr-dec",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xdec",
          from: "0xsender",
          to: "0xreceiver",
          amount: "1000000000000000000", // 1 TOKEN with 18 decimals
          decimals: 18,
          symbol: "TOKEN",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(entries, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
    });
  });
});
