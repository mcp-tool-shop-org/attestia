/**
 * Tests for PayrollEngine — deterministic payroll computation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PayrollEngine, PayrollError } from "../src/payroll.js";
import { Ledger } from "@attestia/ledger";
import type { Money } from "@attestia/types";
import type { PayComponent, PayPeriod } from "../src/types.js";

function usdc(amount: string): Money {
  return { amount, currency: "USDC", decimals: 6 };
}

function comp(
  id: string,
  name: string,
  type: PayComponent["type"],
  amount: string,
): PayComponent {
  return {
    id,
    name,
    type,
    amount: usdc(amount),
    recurring: true,
    taxable: type !== "reimbursement",
  };
}

const JAN_2024: PayPeriod = {
  start: "2024-01-01",
  end: "2024-01-31",
  label: "2024-Jan",
};

describe("PayrollEngine", () => {
  let engine: PayrollEngine;

  beforeEach(() => {
    engine = new PayrollEngine("USDC", 6);
  });

  // ─── Payee management ───────────────────────────────────────────────

  describe("payees", () => {
    it("registers a payee", () => {
      const p = engine.registerPayee("p-1", "Alice", "0xAlice", "eip155:1");
      expect(p.id).toBe("p-1");
      expect(p.name).toBe("Alice");
      expect(p.status).toBe("active");
      expect(p.chainId).toBe("eip155:1");
    });

    it("registers payee without chainId", () => {
      const p = engine.registerPayee("p-1", "Alice", "0xAlice");
      expect(p.chainId).toBeUndefined();
    });

    it("throws on duplicate payee", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      expect(() => engine.registerPayee("p-1", "Bob", "0xBob")).toThrow(
        PayrollError,
      );
    });

    it("gets a payee by ID", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      expect(engine.getPayee("p-1").name).toBe("Alice");
    });

    it("throws for unknown payee", () => {
      expect(() => engine.getPayee("unknown")).toThrow(PayrollError);
    });

    it("updates payee status", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      const updated = engine.updatePayeeStatus("p-1", "suspended");
      expect(updated.status).toBe("suspended");
    });

    it("lists payees, optionally by status", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      engine.registerPayee("p-2", "Bob", "0xBob");
      engine.updatePayeeStatus("p-2", "inactive");
      expect(engine.listPayees().length).toBe(2);
      expect(engine.listPayees("active").length).toBe(1);
      expect(engine.listPayees("inactive").length).toBe(1);
    });
  });

  // ─── Schedule management ───────────────────────────────────────────

  describe("schedules", () => {
    it("sets a payroll schedule", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      const schedule = engine.setSchedule("p-1", [
        comp("base", "Base Salary", "base", "5000"),
      ]);
      expect(schedule.payeeId).toBe("p-1");
      expect(schedule.components.length).toBe(1);
    });

    it("throws on empty components", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      expect(() => engine.setSchedule("p-1", [])).toThrow(/component/i);
    });

    it("throws on unknown payee", () => {
      expect(() =>
        engine.setSchedule("unknown", [
          comp("base", "Base", "base", "5000"),
        ]),
      ).toThrow(PayrollError);
    });

    it("throws on wrong currency", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      expect(() =>
        engine.setSchedule("p-1", [
          {
            id: "base",
            name: "Base",
            type: "base",
            amount: { amount: "5000", currency: "XRP", decimals: 6 },
            recurring: true,
            taxable: true,
          },
        ]),
      ).toThrow(/currency/i);
    });

    it("retrieves a schedule", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      engine.setSchedule("p-1", [comp("base", "Base", "base", "5000")]);
      expect(engine.getSchedule("p-1")?.payeeId).toBe("p-1");
    });

    it("returns undefined for unknown schedule", () => {
      expect(engine.getSchedule("unknown")).toBeUndefined();
    });
  });

  // ─── Payroll runs ──────────────────────────────────────────────────

  describe("payroll runs", () => {
    beforeEach(() => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      engine.registerPayee("p-2", "Bob", "0xBob");
      engine.setSchedule("p-1", [
        comp("base", "Base Salary", "base", "5000"),
        comp("bonus", "Bonus", "bonus", "500"),
        comp("tax", "Tax", "deduction", "800"),
      ]);
      engine.setSchedule("p-2", [
        comp("base", "Base Salary", "base", "4000"),
        comp("ded", "Insurance", "deduction", "300"),
      ]);
    });

    it("creates a payroll run with correct computations", () => {
      const run = engine.createRun("run-1", JAN_2024);

      expect(run.id).toBe("run-1");
      expect(run.status).toBe("draft");
      expect(run.entries.length).toBe(2);

      // Alice: gross = 5000 + 500 = 5500, deductions = 800, net = 4700
      const alice = run.entries.find((e) => e.payeeId === "p-1")!;
      expect(alice.grossPay.amount).toBe("5500.000000");
      expect(alice.deductions.amount).toBe("800.000000");
      expect(alice.netPay.amount).toBe("4700.000000");

      // Bob: gross = 4000, deductions = 300, net = 3700
      const bob = run.entries.find((e) => e.payeeId === "p-2")!;
      expect(bob.grossPay.amount).toBe("4000.000000");
      expect(bob.deductions.amount).toBe("300.000000");
      expect(bob.netPay.amount).toBe("3700.000000");

      // Totals
      expect(run.totalGross.amount).toBe("9500.000000");
      expect(run.totalDeductions.amount).toBe("1100.000000");
      expect(run.totalNet.amount).toBe("8400.000000");
    });

    it("throws on duplicate run ID", () => {
      engine.createRun("run-1", JAN_2024);
      expect(() => engine.createRun("run-1", JAN_2024)).toThrow(PayrollError);
    });

    it("skips inactive payees", () => {
      engine.updatePayeeStatus("p-2", "inactive");
      const run = engine.createRun("run-1", JAN_2024);
      expect(run.entries.length).toBe(1);
      expect(run.entries[0]!.payeeId).toBe("p-1");
    });

    it("approves a draft run", () => {
      engine.createRun("run-1", JAN_2024);
      const approved = engine.approveRun("run-1");
      expect(approved.status).toBe("approved");
    });

    it("throws approving non-draft run", () => {
      engine.createRun("run-1", JAN_2024);
      engine.approveRun("run-1");
      expect(() => engine.approveRun("run-1")).toThrow(/cannot approve/i);
    });

    it("executes an approved run with ledger entries", () => {
      const ledger = new Ledger();
      engine.createRun("run-1", JAN_2024);
      engine.approveRun("run-1");
      const executed = engine.executeRun("run-1", ledger);

      expect(executed.status).toBe("executed");
      expect(executed.executedAt).toBeDefined();

      // Verify ledger entries exist (2 payees × 2 entries each = 4 entries)
      const entries = ledger.getEntries();
      expect(entries.length).toBe(4);
    });

    it("throws executing non-approved run", () => {
      const ledger = new Ledger();
      engine.createRun("run-1", JAN_2024);
      expect(() => engine.executeRun("run-1", ledger)).toThrow(
        /must be 'approved'/i,
      );
    });

    it("getRun throws for unknown", () => {
      expect(() => engine.getRun("unknown")).toThrow(PayrollError);
    });

    it("lists runs by status", () => {
      engine.createRun("run-1", JAN_2024);
      engine.createRun("run-2", {
        start: "2024-02-01",
        end: "2024-02-29",
        label: "2024-Feb",
      });
      engine.approveRun("run-2");

      expect(engine.listRuns().length).toBe(2);
      expect(engine.listRuns("draft").length).toBe(1);
      expect(engine.listRuns("approved").length).toBe(1);
    });
  });

  // ─── Atomic execution (A-TREAS-003) ────────────────────────────────
  // executeRun must be all-or-nothing. computeEntry's netPay = gross -
  // deductions has no floor, so an entry whose deductions meet or exceed gross
  // produces a zero/negative netPay. Appending per-entry meant a later bad
  // entry threw mid-loop, leaving earlier entries committed and the run stuck
  // 'approved' (retry collides on corrId). Execution must validate every
  // netPay is strictly positive BEFORE any ledger write and append the whole
  // run as one balanced batch.

  describe("atomic execution", () => {
    it("rejects a run with a non-positive netPay before any ledger write", () => {
      const ledger = new Ledger();
      engine.registerPayee("p-1", "Alice", "0xAlice");
      engine.registerPayee("p-2", "Bob", "0xBob");
      // Alice nets positive; Bob's deduction exceeds gross → negative netPay.
      engine.setSchedule("p-1", [comp("base", "Base", "base", "5000")]);
      engine.setSchedule("p-2", [
        comp("base", "Base", "base", "1000"),
        comp("ded", "Garnish", "deduction", "1500"),
      ]);
      engine.createRun("run-1", JAN_2024);
      engine.approveRun("run-1");

      let err: PayrollError | undefined;
      try {
        engine.executeRun("run-1", ledger);
      } catch (e) {
        err = e as PayrollError;
      }

      // Rejected with a clear treasury error — not an opaque ledger throw.
      expect(err).toBeInstanceOf(PayrollError);
      expect(err!.code).toBe("INVALID_AMOUNT");

      // Nothing committed: all-or-nothing.
      expect(ledger.getEntries().length).toBe(0);
    });

    it("writes all entries of a valid run in a single balanced batch", () => {
      const ledger = new Ledger();
      engine.registerPayee("p-1", "Alice", "0xAlice");
      engine.registerPayee("p-2", "Bob", "0xBob");
      engine.setSchedule("p-1", [comp("base", "Base", "base", "5000")]);
      engine.setSchedule("p-2", [comp("base", "Base", "base", "4000")]);
      engine.createRun("run-1", JAN_2024);
      engine.approveRun("run-1");
      engine.executeRun("run-1", ledger);

      expect(ledger.transactionCount).toBe(1);
      expect(ledger.getEntries().length).toBe(4);
      expect(() => ledger.getTrialBalance()).not.toThrow();
    });
  });

  // ─── Export / Import ───────────────────────────────────────────────

  describe("export / import", () => {
    it("round-trips payees and runs", () => {
      engine.registerPayee("p-1", "Alice", "0xAlice");
      engine.setSchedule("p-1", [comp("base", "Base", "base", "5000")]);
      engine.createRun("run-1", JAN_2024);

      const payees = engine.exportPayees();
      const runs = engine.exportRuns();

      const engine2 = new PayrollEngine("USDC", 6);
      engine2.importPayees(payees);
      engine2.importRuns(runs);

      expect(engine2.getPayee("p-1").name).toBe("Alice");
      expect(engine2.getRun("run-1").entries.length).toBe(1);
    });
  });
});
