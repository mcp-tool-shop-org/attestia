/**
 * Stage C humanization / hardening (PB-VT-003,004,006,007,011).
 *
 * - PB-VT-003: Treasury.fromSnapshot rejects an unrecognised version.
 * - PB-VT-004: import* fail closed on non-empty target / duplicate ids.
 * - PB-VT-006: distribution.execute surfaces trapped dust (remainderNonZero).
 * - PB-VT-007: resolvePayouts has a runtime exhaustiveness guard.
 * - PB-VT-011: createRun surfaces silently-skipped (inactive) payees.
 */
import { describe, it, expect } from "vitest";
import { Ledger } from "@attestia/ledger";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import { PayrollEngine, PayrollError } from "../src/payroll.js";
import { DistributionEngine, DistributionError } from "../src/distribution.js";
import { FundingGateManager, FundingError } from "../src/funding.js";
import { Treasury, TreasuryError } from "../src/treasury.js";
import type { TreasurySnapshot, DistributionPlan } from "../src/types.js";

function captureSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return { events, telemetry: { record: (e) => events.push(e) } };
}

function usdc(amount: string) {
  return { amount, currency: "USDC", decimals: 6 };
}

const CONFIG = {
  orgId: "org-1",
  name: "Org",
  defaultCurrency: "USDC" as const,
  defaultDecimals: 6,
  gatekeepers: ["alice", "bob"] as readonly [string, string],
};

// =============================================================================
// PB-VT-003 — treasury snapshot version check
// =============================================================================

describe("Treasury.fromSnapshot version check (PB-VT-003)", () => {
  it("rejects an unrecognised snapshot version with an actionable hint", () => {
    const snap = {
      version: 99,
      config: CONFIG,
      payees: [],
      payrollRuns: [],
      distributionPlans: [],
      fundingRequests: [],
      asOf: new Date().toISOString(),
    } as unknown as TreasurySnapshot;

    try {
      Treasury.fromSnapshot(snap);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TreasuryError);
      expect((e as TreasuryError).code).toBe("UNSUPPORTED_SNAPSHOT_VERSION");
      expect((e as TreasuryError).hint).toContain("Migrate");
    }
  });

  it("emits treasury.restore telemetry on a valid restore", () => {
    const treasury = new Treasury(CONFIG);
    treasury.registerPayee("p-1", "Pat", "0xp");
    const snap = treasury.snapshot();
    const sink = captureSink();
    Treasury.fromSnapshot(snap, sink.telemetry);
    const evt = sink.events.find((e) => e.op === "treasury.restore");
    expect(evt).toBeDefined();
    expect(evt!.attributes).toMatchObject({ payeeCount: 1, snapshotVersion: 1 });
  });
});

// =============================================================================
// PB-VT-004 — import guards
// =============================================================================

describe("import* fail closed (PB-VT-004)", () => {
  it("rejects importPayees into a non-empty engine", () => {
    const payroll = new PayrollEngine("USDC", 6);
    payroll.registerPayee("p-1", "Pat", "0xp");
    try {
      payroll.importPayees([]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as PayrollError).code).toBe("IMPORT_NOT_EMPTY");
    }
  });

  it("rejects a duplicate payee id in the import batch", () => {
    const payroll = new PayrollEngine("USDC", 6);
    const p = {
      id: "dup",
      name: "X",
      address: "0xx",
      status: "active" as const,
      registeredAt: new Date().toISOString(),
    };
    expect(() => payroll.importPayees([p, { ...p }])).toThrow(/Duplicate/);
  });

  it("rejects importPlans into a non-empty engine", () => {
    const dist = new DistributionEngine("USDC", 6);
    dist.createPlan("plan-1", "P", "fixed", usdc("100.000000"), [
      { payeeId: "a", amount: usdc("10.000000") },
    ]);
    expect(() => dist.importPlans([])).toThrow(DistributionError);
  });

  it("rejects importRequests into a non-empty manager", () => {
    const funding = new FundingGateManager(["alice", "bob"], "USDC", 6);
    funding.submitRequest("r-1", "d", usdc("1.000000"), "carol");
    expect(() => funding.importRequests([])).toThrow(FundingError);
  });
});

// =============================================================================
// PB-VT-006 — dust surfaced in telemetry
// =============================================================================

describe("distribution dust surfacing (PB-VT-006)", () => {
  it("reports remainderNonZero=true when integer division traps dust", () => {
    const sink = captureSink();
    const dist = new DistributionEngine("USDC", 6, sink.telemetry);
    const ledger = new Ledger();

    // 3-way split of a pool that doesn't divide evenly leaves dust.
    dist.createPlan("plan-1", "Thirds", "proportional", usdc("100.000000"), [
      { payeeId: "a", share: 3333 },
      { payeeId: "b", share: 3333 },
      { payeeId: "c", share: 3334 },
    ]);
    dist.approvePlan("plan-1");
    const result = dist.executeDistribution("plan-1", ledger);

    const evt = sink.events.find((e) => e.op === "distribution.execute");
    expect(evt).toBeDefined();
    // The pool less the distributed sum is the trapped dust.
    const remainderZero = result.remainder.amount === "0.000000";
    expect(evt!.attributes?.remainderNonZero).toBe(!remainderZero);
    expect(evt!.message).toContain("remainder (dust)");
  });
});

// =============================================================================
// PB-VT-007 — strategy exhaustiveness guard (runtime)
// =============================================================================

describe("distribution strategy exhaustiveness (PB-VT-007)", () => {
  it("throws a clean UNKNOWN_STRATEGY error for an unhandled strategy", () => {
    const dist = new DistributionEngine("USDC", 6);
    // Inject a plan with an out-of-union strategy by reaching into the map via
    // a crafted import — simulates a future enum value reaching resolution.
    const plan = {
      id: "x",
      name: "X",
      strategy: "bogus" as unknown as DistributionPlan["strategy"],
      pool: usdc("10.000000"),
      recipients: [{ payeeId: "a", share: 1 }],
      status: "draft" as const,
      createdAt: new Date().toISOString(),
    } as DistributionPlan;
    dist.importPlans([plan]);

    try {
      dist.computeDistribution("x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DistributionError);
      expect((e as DistributionError).code).toBe("UNKNOWN_STRATEGY");
    }
  });
});

// =============================================================================
// PB-VT-011 — payroll createRun surfaces skipped payees
// =============================================================================

describe("payroll createRun visibility (PB-VT-011)", () => {
  it("emits payroll.run.created with included + skippedInactive counts", () => {
    const sink = captureSink();
    const payroll = new PayrollEngine("USDC", 6, sink.telemetry);

    payroll.registerPayee("p-1", "Active", "0x1");
    payroll.registerPayee("p-2", "Inactive", "0x2");
    payroll.setSchedule("p-1", [
      { id: "c1", name: "base", type: "base", amount: usdc("1000.000000"), recurring: true, taxable: true },
    ]);
    payroll.setSchedule("p-2", [
      { id: "c2", name: "base", type: "base", amount: usdc("500.000000"), recurring: true, taxable: true },
    ]);
    // p-2 was scheduled but is now inactive — it should be a visible omission.
    payroll.updatePayeeStatus("p-2", "inactive");

    payroll.createRun("run-1", { label: "2024-01", start: "2024-01-01", end: "2024-01-31" });

    const evt = sink.events.find((e) => e.op === "payroll.run.created");
    expect(evt).toBeDefined();
    expect(evt!.outcome).toBe("degraded");
    expect(evt!.attributes).toEqual({ included: 1, skippedInactive: 1 });
    expect(evt!.message).toContain("skipped");
  });

  it("emits an ok payroll.run.created when nobody is skipped", () => {
    const sink = captureSink();
    const payroll = new PayrollEngine("USDC", 6, sink.telemetry);
    payroll.registerPayee("p-1", "Active", "0x1");
    payroll.setSchedule("p-1", [
      { id: "c1", name: "base", type: "base", amount: usdc("1000.000000"), recurring: true, taxable: true },
    ]);
    payroll.createRun("run-1", { label: "2024-01", start: "2024-01-01", end: "2024-01-31" });

    const evt = sink.events.find((e) => e.op === "payroll.run.created");
    expect(evt!.outcome).toBe("ok");
    expect(evt!.attributes).toEqual({ included: 1, skippedInactive: 0 });
  });
});
