/**
 * IntentChainMatcher tests
 */
import { describe, it, expect } from "vitest";
import { IntentChainMatcher } from "../src/intent-chain-matcher.js";
import type {
  ReconcilableIntent,
  ReconcilableChainEvent,
} from "../src/types.js";

function usdc(amount: string): { amount: string; currency: string; decimals: number } {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("IntentChainMatcher", () => {
  const matcher = new IntentChainMatcher();

  describe("matched intents", () => {
    it("matches intent execution to chain event by txHash", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-1",
          status: "executed",
          kind: "transfer",
          amount: usdc("500.000000"),
          chainId: "eth:1",
          txHash: "0xtx1",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xtx1",
          from: "0xsender",
          to: "0xreceiver",
          amount: "500000000", // 500 USDC
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const results = matcher.match(intents, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
      expect(results[0]!.intentId).toBe("intent-1");
      expect(results[0]!.txHash).toBe("0xtx1");
    });

    it("matches intent without amount (presence check only)", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-2",
          status: "executed",
          kind: "approval",
          txHash: "0xtx2",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xtx2",
          from: "0xsender",
          to: "0xreceiver",
          amount: "0",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const results = matcher.match(intents, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
    });

    it("skips intents without txHash", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-notx",
          status: "declared",
          kind: "transfer",
          amount: usdc("100.000000"),
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(intents, []);
      expect(results).toHaveLength(0);
    });
  });

  describe("amount mismatches", () => {
    it("reports amount mismatch between intent and chain", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-3",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          txHash: "0xtx3",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xtx3",
          from: "0xsender",
          to: "0xreceiver",
          amount: "75000000", // 75 USDC — intent says 100
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const results = matcher.match(intents, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("amount-mismatch");
      expect(results[0]!.discrepancies).toHaveLength(1);
      expect(results[0]!.discrepancies[0]).toMatch(/amount mismatch/i);
    });

    it("reports currency mismatch", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-curr",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          txHash: "0xtxcurr",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xtxcurr",
          from: "0xsender",
          to: "0xreceiver",
          amount: "100000000000000000000",
          decimals: 18,
          symbol: "ETH",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const results = matcher.match(intents, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("amount-mismatch");
      expect(results[0]!.discrepancies[0]).toMatch(/currency mismatch/i);
    });
  });

  describe("missing records", () => {
    it("reports missing chain event for executed intent", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-miss",
          status: "executed",
          kind: "transfer",
          amount: usdc("200.000000"),
          txHash: "0xghost",
          chainId: "eth:1",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const results = matcher.match(intents, []);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("missing-chain");
      expect(results[0]!.txHash).toBe("0xghost");
      expect(results[0]!.chainId).toBe("eth:1");
    });
  });

  describe("unauthorized chain events (D4-A-002)", () => {
    // An on-chain transfer with no declared/approved intent is an
    // unauthorized withdrawal. Fail-closed: it MUST be surfaced as
    // missing-intent, never silently ignored.
    it("flags a chain event that matches no intent as missing-intent", () => {
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xrogue",
          from: "0xtreasury",
          to: "0xattacker",
          amount: "1000000000", // 1000 USDC drained
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      // No intents at all — a transfer happened that nobody declared.
      const results = matcher.match([], events);

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("missing-intent");
      expect(results[0]!.txHash).toBe("0xrogue");
      expect(results[0]!.chainId).toBe("eth:1");
      expect(results[0]!.discrepancies).toHaveLength(1);
      expect(results[0]!.discrepancies[0]).toMatch(/no.*intent/i);
    });

    it("accepts a chain event that DOES match an intent (no false positive)", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-ok",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          chainId: "eth:1",
          txHash: "0xauthorized",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xauthorized",
          from: "0xtreasury",
          to: "0xvendor",
          amount: "100000000",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const results = matcher.match(intents, events);

      // Exactly one result: the authorized match. No spurious missing-intent.
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
      expect(results.some((r) => r.status === "missing-intent")).toBe(false);
    });

    it("separates authorized from unauthorized in a mixed batch", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-ok",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          chainId: "eth:1",
          txHash: "0xauthorized",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xauthorized",
          from: "0xtreasury",
          to: "0xvendor",
          amount: "100000000",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
        {
          chainId: "eth:1",
          txHash: "0xrogue",
          from: "0xtreasury",
          to: "0xattacker",
          amount: "5000000000",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:02Z",
        },
      ];

      const results = matcher.match(intents, events);
      const rogue = results.find((r) => r.txHash === "0xrogue");
      const ok = results.find((r) => r.txHash === "0xauthorized");

      expect(ok!.status).toBe("matched");
      expect(rogue).toBeDefined();
      expect(rogue!.status).toBe("missing-intent");
    });
  });

  describe("malformed chain amounts (A-REC-003)", () => {
    // An untrusted chain event with a non-numeric amount must NOT throw out of
    // the whole reconciliation batch. The bad match is flagged; the batch
    // continues.
    it("does not throw when a matched chain amount is malformed", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-bad",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          txHash: "0xbad",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xbad",
          from: "0xsender",
          to: "0xreceiver",
          amount: "0xdeadbeef", // malformed — BigInt() would throw
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      expect(() => matcher.match(intents, events)).not.toThrow();
      const results = matcher.match(intents, events);
      const bad = results.find((r) => r.txHash === "0xbad")!;
      expect(bad).toBeDefined();
      expect(bad.status).not.toBe("matched");
      expect(bad.structuredDiscrepancies.length).toBeGreaterThan(0);
    });

    it("one malformed event does not abort reconciliation of good intents", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-good",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          txHash: "0xgood",
          declaredAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "intent-bad2",
          status: "executed",
          kind: "transfer",
          amount: usdc("50.000000"),
          txHash: "0xbad2",
          declaredAt: "2024-01-01T00:00:00Z",
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
          timestamp: "2024-01-01T00:00:01Z",
        },
        {
          chainId: "eth:1",
          txHash: "0xbad2",
          from: "0xsender",
          to: "0xreceiver",
          amount: "50.0", // not an integer string — BigInt() would throw
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const results = matcher.match(intents, events);
      const good = results.find((r) => r.txHash === "0xgood")!;
      expect(good.status).toBe("matched");
      const bad = results.find((r) => r.txHash === "0xbad2")!;
      expect(bad.status).not.toBe("matched");
      expect(bad.structuredDiscrepancies.length).toBeGreaterThan(0);
    });
  });

  describe("cross-decimal matching", () => {
    it("handles different decimal bases correctly", () => {
      const intents: ReconcilableIntent[] = [
        {
          id: "intent-xdec",
          status: "executed",
          kind: "transfer",
          amount: { amount: "1.000000", currency: "TKN", decimals: 6 },
          txHash: "0xdec",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xdec",
          from: "0xsender",
          to: "0xreceiver",
          amount: "1000000000000000000", // 1 TKN with 18 decimals
          decimals: 18,
          symbol: "TKN",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const results = matcher.match(intents, events);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("matched");
    });
  });
});
