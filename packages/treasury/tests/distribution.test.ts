/**
 * Tests for DistributionEngine — DAO & org distributions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DistributionEngine, DistributionError } from "../src/distribution.js";
import { Ledger } from "@attestia/ledger";
import type { Money } from "@attestia/types";
import type { DistributionRecipient } from "../src/types.js";

function usdc(amount: string): Money {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("DistributionEngine", () => {
  let engine: DistributionEngine;

  beforeEach(() => {
    engine = new DistributionEngine("USDC", 6);
  });

  // ─── Plan management ───────────────────────────────────────────────

  describe("plan management", () => {
    it("creates a distribution plan", () => {
      const plan = engine.createPlan(
        "d-1",
        "Q1 Bonus",
        "proportional",
        usdc("10000"),
        [
          { payeeId: "p-1", share: 5000 },
          { payeeId: "p-2", share: 5000 },
        ],
      );

      expect(plan.id).toBe("d-1");
      expect(plan.status).toBe("draft");
      expect(plan.recipients.length).toBe(2);
    });

    it("throws on duplicate plan ID", () => {
      engine.createPlan("d-1", "Test", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 5000 },
      ]);
      expect(() =>
        engine.createPlan("d-1", "Test 2", "proportional", usdc("100"), [
          { payeeId: "p-1", share: 5000 },
        ]),
      ).toThrow(DistributionError);
    });

    it("throws on empty recipients", () => {
      expect(() =>
        engine.createPlan("d-1", "Test", "proportional", usdc("100"), []),
      ).toThrow(/recipient/i);
    });

    it("throws when proportional shares exceed 10000", () => {
      expect(() =>
        engine.createPlan("d-1", "Over-allocated", "proportional", usdc("100"), [
          { payeeId: "p-1", share: 6000 },
          { payeeId: "p-2", share: 5000 },
        ]),
      ).toThrow(/10000/);
    });

    it("throws when fixed amounts exceed pool", () => {
      expect(() =>
        engine.createPlan("d-1", "Too much", "fixed", usdc("100"), [
          { payeeId: "p-1", share: 60 },
          { payeeId: "p-2", share: 50 },
        ]),
      ).toThrow(/exceed/i);
    });

    it("approves a draft plan", () => {
      engine.createPlan("d-1", "Test", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 5000 },
      ]);
      const approved = engine.approvePlan("d-1");
      expect(approved.status).toBe("approved");
    });

    it("throws approving non-draft plan", () => {
      engine.createPlan("d-1", "Test", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 5000 },
      ]);
      engine.approvePlan("d-1");
      expect(() => engine.approvePlan("d-1")).toThrow(/cannot approve/i);
    });

    it("lists plans by status", () => {
      engine.createPlan("d-1", "A", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 5000 },
      ]);
      engine.createPlan("d-2", "B", "proportional", usdc("200"), [
        { payeeId: "p-1", share: 5000 },
      ]);
      engine.approvePlan("d-2");

      expect(engine.listPlans().length).toBe(2);
      expect(engine.listPlans("draft").length).toBe(1);
      expect(engine.listPlans("approved").length).toBe(1);
    });
  });

  // ─── Share validation (D4-B-003) ──────────────────────────────────
  // Individual recipient.share values flow into BigInt(share) and bigint
  // arithmetic during resolution. A fractional share throws an opaque
  // RangeError, a negative mints a negative payout, and NaN/Infinity corrupt
  // the math. createPlan must validate every share is a non-negative integer
  // (and ≤ 10000 for proportional/milestone) and reject with INVALID_SHARES.

  describe("share validation", () => {
    function expectInvalidShares(
      strategy: "proportional" | "fixed" | "milestone",
      recipients: DistributionRecipient[],
    ): void {
      let err: unknown;
      try {
        engine.createPlan("d-1", "Bad shares", strategy, usdc("10000"), recipients);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(DistributionError);
      expect((err as DistributionError).code).toBe("INVALID_SHARES");
    }

    for (const strategy of ["proportional", "fixed", "milestone"] as const) {
      it(`rejects a negative share (${strategy})`, () => {
        expectInvalidShares(strategy, [
          { payeeId: "p-1", share: -100, milestoneMet: true },
        ]);
      });

      it(`rejects a fractional share (${strategy})`, () => {
        expectInvalidShares(strategy, [
          { payeeId: "p-1", share: 33.33, milestoneMet: true },
        ]);
      });

      it(`rejects a NaN share (${strategy})`, () => {
        expectInvalidShares(strategy, [
          { payeeId: "p-1", share: NaN, milestoneMet: true },
        ]);
      });

      it(`rejects an Infinity share (${strategy})`, () => {
        expectInvalidShares(strategy, [
          { payeeId: "p-1", share: Infinity, milestoneMet: true },
        ]);
      });
    }

    it("names the offending payeeId and value in the message", () => {
      let err: DistributionError | undefined;
      try {
        engine.createPlan("d-1", "Bad", "proportional", usdc("100"), [
          { payeeId: "p-good", share: 5000 },
          { payeeId: "p-bad", share: -7 },
        ]);
      } catch (e) {
        err = e as DistributionError;
      }
      expect(err).toBeInstanceOf(DistributionError);
      expect(err!.message).toContain("p-bad");
      expect(err!.message).toContain("-7");
    });

    it("rejects an individual proportional share above 10000", () => {
      // Single recipient whose share alone exceeds the basis-point ceiling.
      expectInvalidShares("proportional", [
        { payeeId: "p-1", share: 10001 },
      ]);
    });

    it("rejects an individual milestone share above 10000", () => {
      expectInvalidShares("milestone", [
        { payeeId: "p-1", share: 20000, milestoneMet: true },
      ]);
    });

    it("does NOT bound fixed shares at 10000 (they are amounts, not basis points)", () => {
      // A fixed share of 50000 against a 100000 pool is a legitimate amount.
      const plan = engine.createPlan("d-1", "Big stipend", "fixed", usdc("100000"), [
        { payeeId: "p-1", share: 50000 },
      ]);
      expect(plan.recipients[0]!.share).toBe(50000);
    });

    it("accepts a zero share", () => {
      const plan = engine.createPlan("d-1", "Zero", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 0 },
        { payeeId: "p-2", share: 5000 },
      ]);
      expect(plan.recipients.length).toBe(2);
    });
  });

  // ─── Duplicate recipient validation (D4-B-004) ────────────────────
  // Recipients with duplicate payeeIds collide on correlationId during
  // execute and silently double-credit. createPlan must reject duplicates.

  describe("duplicate recipient validation", () => {
    it("rejects duplicate payeeIds with DUPLICATE_RECIPIENT", () => {
      let err: DistributionError | undefined;
      try {
        engine.createPlan("d-1", "Dupes", "proportional", usdc("10000"), [
          { payeeId: "p-1", share: 3000 },
          { payeeId: "p-1", share: 2000 },
        ]);
      } catch (e) {
        err = e as DistributionError;
      }
      expect(err).toBeInstanceOf(DistributionError);
      expect(err!.code).toBe("DUPLICATE_RECIPIENT");
      expect(err!.message).toContain("p-1");
    });

    it("rejects duplicates across all strategies", () => {
      for (const strategy of ["proportional", "fixed", "milestone"] as const) {
        expect(() =>
          engine.createPlan(`d-${strategy}`, "Dupes", strategy, usdc("100"), [
            { payeeId: "dup", share: 10, milestoneMet: true },
            { payeeId: "dup", share: 10, milestoneMet: true },
          ]),
        ).toThrow(DistributionError);
      }
    });

    it("accepts distinct payeeIds", () => {
      const plan = engine.createPlan("d-1", "Distinct", "proportional", usdc("10000"), [
        { payeeId: "p-1", share: 3000 },
        { payeeId: "p-2", share: 2000 },
      ]);
      expect(plan.recipients.length).toBe(2);
    });
  });

  // ─── Proportional distribution ────────────────────────────────────

  describe("proportional distribution", () => {
    it("splits pool by basis points", () => {
      engine.createPlan("d-1", "Revenue share", "proportional", usdc("10000"), [
        { payeeId: "p-1", share: 6000 }, // 60%
        { payeeId: "p-2", share: 3000 }, // 30%
        { payeeId: "p-3", share: 1000 }, // 10%
      ]);

      const result = engine.computeDistribution("d-1");

      expect(result.payouts.length).toBe(3);
      expect(result.payouts[0]!.amount.amount).toBe("6000.000000");
      expect(result.payouts[1]!.amount.amount).toBe("3000.000000");
      expect(result.payouts[2]!.amount.amount).toBe("1000.000000");
      expect(result.remainder.amount).toBe("0.000000");
    });

    it("handles uneven splits with remainder", () => {
      engine.createPlan("d-1", "Split", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 3333 }, // 33.33%
        { payeeId: "p-2", share: 3333 }, // 33.33%
        { payeeId: "p-3", share: 3333 }, // 33.33%
      ]);

      const result = engine.computeDistribution("d-1");

      // 100 * 3333 / 10000 = 33.33 each, remainder = 0.01
      const total = result.payouts.reduce(
        (sum, p) => sum + parseFloat(p.amount.amount),
        0,
      );
      expect(total).toBeLessThan(100);
      expect(parseFloat(result.remainder.amount)).toBeGreaterThan(0);
    });
  });

  // ─── Fixed distribution ───────────────────────────────────────────

  describe("fixed distribution", () => {
    it("gives fixed amounts", () => {
      engine.createPlan("d-1", "Stipend", "fixed", usdc("500"), [
        { payeeId: "p-1", share: 200 },
        { payeeId: "p-2", share: 150 },
      ]);

      const result = engine.computeDistribution("d-1");

      expect(result.payouts[0]!.amount.amount).toBe("200.000000");
      expect(result.payouts[1]!.amount.amount).toBe("150.000000");
      expect(result.remainder.amount).toBe("150.000000");
    });
  });

  // ─── Milestone distribution ───────────────────────────────────────

  describe("milestone distribution", () => {
    it("pays only recipients who met milestones", () => {
      const recipients: DistributionRecipient[] = [
        { payeeId: "p-1", share: 3000, milestoneMet: true },
        { payeeId: "p-2", share: 3000, milestoneMet: false },
        { payeeId: "p-3", share: 4000, milestoneMet: true },
      ];

      engine.createPlan("d-1", "Grants", "milestone", usdc("10000"), recipients);
      const result = engine.computeDistribution("d-1");

      // Only p-1 and p-3 get paid (shares 3000 and 4000, total 7000)
      // p-1: 10000 * 3000 / 7000 = 4285.714285
      // p-3: 10000 * 4000 / 7000 = 5714.285714
      expect(result.payouts.length).toBe(2);
      expect(result.payouts[0]!.payeeId).toBe("p-1");
      expect(result.payouts[1]!.payeeId).toBe("p-3");

      const total = parseFloat(result.totalDistributed.amount);
      expect(total).toBeLessThanOrEqual(10000);
    });

    it("distributes nothing if no milestones met", () => {
      engine.createPlan("d-1", "Grants", "milestone", usdc("1000"), [
        { payeeId: "p-1", share: 5000, milestoneMet: false },
      ]);

      const result = engine.computeDistribution("d-1");
      expect(result.payouts.length).toBe(0);
      expect(result.remainder.amount).toBe("1000.000000");
    });
  });

  // ─── Execute ──────────────────────────────────────────────────────

  describe("executeDistribution", () => {
    it("records entries in the ledger", () => {
      const ledger = new Ledger();
      engine.createPlan("d-1", "Revenue", "proportional", usdc("1000"), [
        { payeeId: "p-1", share: 5000 },
        { payeeId: "p-2", share: 5000 },
      ]);
      engine.approvePlan("d-1");

      const result = engine.executeDistribution("d-1", ledger);

      expect(result.payouts.length).toBe(2);
      // 2 recipients × 2 entries (debit + credit) = 4 entries
      expect(ledger.getEntries().length).toBe(4);

      const plan = engine.getPlan("d-1");
      expect(plan.status).toBe("executed");
    });

    it("throws executing non-approved plan", () => {
      const ledger = new Ledger();
      engine.createPlan("d-1", "Test", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 5000 },
      ]);
      expect(() => engine.executeDistribution("d-1", ledger)).toThrow(
        /cannot execute/i,
      );
    });
  });

  // ─── Fixed-amount precision (A-TREAS-001) ─────────────────────────
  // For the "fixed" strategy, recipient.share is a JS number used as the
  // FIXED payout amount. JS numbers lose integer precision above 2^53, so a
  // share above Number.MAX_SAFE_INTEGER silently rounds (e.g.
  // String(9007199254740993) === "9007199254740992"). Money must never
  // round-trip through a JS number: callers supply a decimal-string `amount`
  // for exactness, and a numeric `share` above MAX_SAFE_INTEGER is rejected.

  describe("fixed-amount precision", () => {
    it("rejects a fixed numeric share above MAX_SAFE_INTEGER (no silent precision loss)", () => {
      // 9007199254740993 is not representable as a JS number; it becomes
      // 9007199254740992. createPlan must reject it rather than pay the wrong
      // amount. Pool is comfortably larger so the only failure is precision.
      let err: DistributionError | undefined;
      try {
        engine.createPlan("d-1", "Whale", "fixed", usdc("99999999999999999"), [
          { payeeId: "p-1", share: 9007199254740993 },
        ]);
      } catch (e) {
        err = e as DistributionError;
      }
      expect(err).toBeInstanceOf(DistributionError);
      expect(err!.code).toBe("INVALID_SHARES");
    });

    it("prefers the exact decimal-string amount for fixed payouts", () => {
      // A precise amount that no JS number could represent exactly.
      const exact = "9007199254740993";
      engine.createPlan("d-1", "Exact stipend", "fixed", usdc("99999999999999999"), [
        { payeeId: "p-1", amount: usdc(exact) },
      ]);
      const result = engine.computeDistribution("d-1");
      expect(result.payouts[0]!.amount.amount).toBe(`${exact}.000000`);
    });

    it("still accepts a small numeric fixed share (non-breaking)", () => {
      engine.createPlan("d-1", "Stipend", "fixed", usdc("500"), [
        { payeeId: "p-1", share: 200 },
      ]);
      const result = engine.computeDistribution("d-1");
      expect(result.payouts[0]!.amount.amount).toBe("200.000000");
    });
  });

  // ─── Atomic execution (A-TREAS-002) ───────────────────────────────
  // executeDistribution must be all-or-nothing. A zero/negative payout in the
  // middle of the recipient list must not leave earlier payouts committed to
  // the ledger with the plan still 'approved' (which would wedge a retry on
  // DUPLICATE_ENTRY_ID). Zero payouts are filtered before any ledger write.

  describe("atomic execution", () => {
    it("does not commit a partial ledger when a later payout would be zero", () => {
      const ledger = new Ledger();
      engine.createPlan("d-1", "Mixed", "fixed", usdc("1000"), [
        { payeeId: "p-1", share: 100 },
        { payeeId: "p-2", share: 0 }, // zero payout — must not wedge the run
      ]);
      engine.approvePlan("d-1");

      const result = engine.executeDistribution("d-1", ledger);

      // Zero payout is filtered: only p-1 is written (1 debit + 1 credit).
      expect(ledger.getEntries().length).toBe(2);
      expect(result.payouts.length).toBe(1);
      expect(result.payouts[0]!.payeeId).toBe("p-1");

      // Plan reaches a terminal 'executed' state — no wedge, retry rejected.
      expect(engine.getPlan("d-1").status).toBe("executed");

      // Trial balance is intact (atomic, balanced batch).
      expect(() => ledger.getTrialBalance()).not.toThrow();
    });

    it("writes all payouts in a single balanced batch", () => {
      const ledger = new Ledger();
      engine.createPlan("d-1", "Revenue", "proportional", usdc("1000"), [
        { payeeId: "p-1", share: 5000 },
        { payeeId: "p-2", share: 5000 },
      ]);
      engine.approvePlan("d-1");
      engine.executeDistribution("d-1", ledger);

      // One atomic transaction covering both recipients.
      expect(ledger.transactionCount).toBe(1);
      expect(ledger.getEntries().length).toBe(4);
      expect(() => ledger.getTrialBalance()).not.toThrow();
    });
  });

  // ─── Export / Import ──────────────────────────────────────────────

  describe("export / import", () => {
    it("round-trips plans", () => {
      engine.createPlan("d-1", "Test", "proportional", usdc("100"), [
        { payeeId: "p-1", share: 5000 },
      ]);

      const plans = engine.exportPlans();
      const engine2 = new DistributionEngine("USDC", 6);
      engine2.importPlans(plans);

      expect(engine2.getPlan("d-1").name).toBe("Test");
    });
  });
});
