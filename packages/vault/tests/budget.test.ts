/**
 * Tests for BudgetEngine — envelope budgeting.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BudgetEngine, BudgetError } from "../src/budget.js";
import type { Money } from "@attestia/types";

function usdc(amount: string): Money {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("BudgetEngine", () => {
  let budget: BudgetEngine;

  beforeEach(() => {
    budget = new BudgetEngine("owner-1", "USDC", 6);
  });

  // ─── Envelope management ────────────────────────────────────────────

  describe("createEnvelope", () => {
    it("creates an envelope with zero balances", () => {
      const env = budget.createEnvelope("rent", "Rent", "housing");
      expect(env.id).toBe("rent");
      expect(env.name).toBe("Rent");
      expect(env.currency).toBe("USDC");
      expect(env.allocated).toBe("0");
      expect(env.spent).toBe("0");
      expect(env.available).toBe("0");
      expect(env.category).toBe("housing");
    });

    it("creates envelope without category", () => {
      const env = budget.createEnvelope("misc", "Miscellaneous");
      expect(env.id).toBe("misc");
      expect(env.category).toBeUndefined();
    });

    it("throws on duplicate envelope ID", () => {
      budget.createEnvelope("rent", "Rent");
      expect(() => budget.createEnvelope("rent", "Rent Again")).toThrow(
        BudgetError,
      );
    });
  });

  describe("getEnvelope", () => {
    it("returns existing envelope", () => {
      budget.createEnvelope("rent", "Rent");
      expect(budget.getEnvelope("rent").id).toBe("rent");
    });

    it("throws for unknown envelope", () => {
      expect(() => budget.getEnvelope("unknown")).toThrow(BudgetError);
    });
  });

  describe("hasEnvelope", () => {
    it("returns true for existing", () => {
      budget.createEnvelope("rent", "Rent");
      expect(budget.hasEnvelope("rent")).toBe(true);
    });

    it("returns false for unknown", () => {
      expect(budget.hasEnvelope("unknown")).toBe(false);
    });
  });

  describe("listEnvelopes", () => {
    it("returns all envelopes", () => {
      budget.createEnvelope("a", "A");
      budget.createEnvelope("b", "B");
      expect(budget.listEnvelopes().length).toBe(2);
    });
  });

  describe("getByCategory", () => {
    it("filters by category", () => {
      budget.createEnvelope("rent", "Rent", "housing");
      budget.createEnvelope("food", "Food", "essentials");
      budget.createEnvelope("utils", "Utilities", "housing");
      expect(budget.getByCategory("housing").length).toBe(2);
    });
  });

  // ─── Budget operations ──────────────────────────────────────────────

  describe("allocate", () => {
    it("increases allocated and available", () => {
      budget.createEnvelope("rent", "Rent");
      const env = budget.allocate("rent", usdc("1000"));
      expect(env.allocated).toBe("1000.000000");
      expect(env.available).toBe("1000.000000");
      expect(env.spent).toBe("0");
    });

    it("accumulates multiple allocations", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("500"));
      const env = budget.allocate("rent", usdc("300"));
      expect(env.allocated).toBe("800.000000");
      expect(env.available).toBe("800.000000");
    });

    it("rejects wrong currency", () => {
      budget.createEnvelope("rent", "Rent");
      expect(() =>
        budget.allocate("rent", {
          amount: "100",
          currency: "XRP",
          decimals: 6,
        }),
      ).toThrow(/currency/i);
    });

    it("rejects zero/negative amounts", () => {
      budget.createEnvelope("rent", "Rent");
      expect(() => budget.allocate("rent", usdc("0"))).toThrow(BudgetError);
      expect(() => budget.allocate("rent", usdc("-10"))).toThrow(BudgetError);
    });
  });

  describe("deallocate", () => {
    it("decreases allocated and available", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      const env = budget.deallocate("rent", usdc("200"));
      expect(env.allocated).toBe("800.000000");
      expect(env.available).toBe("800.000000");
    });

    it("throws if would go below spent", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      budget.spend("rent", usdc("800"));
      expect(() => budget.deallocate("rent", usdc("300"))).toThrow(
        /below spent/i,
      );
    });
  });

  describe("spend", () => {
    it("records spending and reduces available", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      const env = budget.spend("rent", usdc("400"));
      expect(env.spent).toBe("400.000000");
      expect(env.available).toBe("600.000000");
      expect(env.allocated).toBe("1000.000000");
    });

    it("accumulates spending", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      budget.spend("rent", usdc("200"));
      const env = budget.spend("rent", usdc("300"));
      expect(env.spent).toBe("500.000000");
      expect(env.available).toBe("500.000000");
    });

    it("throws on insufficient budget", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("100"));
      expect(() => budget.spend("rent", usdc("200"))).toThrow(
        /insufficient/i,
      );
    });

    it("allows spending exactly the available amount", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("500"));
      const env = budget.spend("rent", usdc("500"));
      expect(env.available).toBe("0.000000");
      expect(env.spent).toBe("500.000000");
    });
  });

  describe("reverseSpend", () => {
    it("reverses a previous spend", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      budget.spend("rent", usdc("400"));
      const env = budget.reverseSpend("rent", usdc("400"));
      expect(env.spent).toBe("0.000000");
      expect(env.available).toBe("1000.000000");
    });

    it("reverses a partial spend, leaving the remainder spent", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      budget.spend("rent", usdc("400"));
      const env = budget.reverseSpend("rent", usdc("150"));
      expect(env.spent).toBe("250.000000");
      expect(env.available).toBe("750.000000");
    });

    it("allows reversing exactly the spent amount", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      budget.spend("rent", usdc("400"));
      const env = budget.reverseSpend("rent", usdc("400"));
      expect(env.spent).toBe("0.000000");
      expect(env.available).toBe("1000.000000");
    });

    it("rejects over-reversal that would drive spent negative", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      budget.spend("rent", usdc("400"));
      // Over-reversing (e.g. double failure-handling) must not drive spent
      // negative and inflate available beyond allocated — fail closed.
      expect(() => budget.reverseSpend("rent", usdc("500"))).toThrow(BudgetError);
      expect(() => budget.reverseSpend("rent", usdc("500"))).toThrow(
        /exceed|spent/i,
      );
      // State must be unchanged after the rejected over-reversal.
      const env = budget.getEnvelope("rent");
      expect(env.spent).toBe("400.000000");
      expect(env.available).toBe("600.000000");
    });

    it("rejects reversing from an envelope with nothing spent", () => {
      budget.createEnvelope("rent", "Rent");
      budget.allocate("rent", usdc("1000"));
      expect(() => budget.reverseSpend("rent", usdc("1"))).toThrow(BudgetError);
    });
  });

  // ─── Snapshot ───────────────────────────────────────────────────────

  describe("snapshot", () => {
    it("captures full budget state", () => {
      budget.createEnvelope("rent", "Rent", "housing");
      budget.createEnvelope("food", "Food", "essentials");
      budget.allocate("rent", usdc("1000"));
      budget.allocate("food", usdc("500"));
      budget.spend("rent", usdc("200"));

      const snap = budget.snapshot();
      expect(snap.ownerId).toBe("owner-1");
      expect(snap.envelopes.length).toBe(2);
      expect(snap.totalAllocated).toBe("1500.000000");
      expect(snap.totalSpent).toBe("200.000000");
      expect(snap.totalAvailable).toBe("1300.000000");
      expect(snap.currency).toBe("USDC");
    });
  });

  describe("fromSnapshot", () => {
    it("restores budget state from snapshot", () => {
      budget.createEnvelope("rent", "Rent", "housing");
      budget.allocate("rent", usdc("1000"));
      budget.spend("rent", usdc("300"));

      const snap = budget.snapshot();
      const restored = BudgetEngine.fromSnapshot(snap);

      expect(restored.hasEnvelope("rent")).toBe(true);
      const env = restored.getEnvelope("rent");
      expect(env.allocated).toBe("1000.000000");
      expect(env.spent).toBe("300.000000");
      expect(env.available).toBe("700.000000");
    });
  });
});
