/**
 * Observability across treasury financial operations (D4-B-001).
 *
 * Verifies that a capturing {@link Telemetry} sink receives structured events
 * for funding gate decisions + execution, payroll runs, and distributions,
 * with low-cardinality attributes only.
 */
import { describe, it, expect } from "vitest";
import { Ledger } from "@attestia/ledger";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import { FundingGateManager } from "../src/funding.js";
import { PayrollEngine } from "../src/payroll.js";
import { DistributionEngine } from "../src/distribution.js";

function captureSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return {
    events,
    telemetry: {
      record(event) {
        events.push(event);
      },
    },
  };
}

function usdc(amount: string): { amount: string; currency: string; decimals: number } {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("treasury observability (D4-B-001)", () => {
  it("emits funding.gate decisions and funding.execute", () => {
    const sink = captureSink();
    const funding = new FundingGateManager(["alice", "bob"], "USDC", 6, sink.telemetry);
    const ledger = new Ledger();

    funding.submitRequest("req-1", "server costs", usdc("500.000000"), "carol");
    funding.approveGate("req-1", "alice");
    funding.approveGate("req-1", "bob");
    funding.executeRequest("req-1", ledger);

    const gateEvents = sink.events.filter((e) => e.op === "funding.gate");
    expect(gateEvents).toHaveLength(2);
    expect(gateEvents[0]!.attributes).toEqual({ gate: "gate1", decision: "approved" });
    expect(gateEvents[1]!.attributes).toEqual({ gate: "gate2", decision: "approved" });

    const exec = sink.events.find((e) => e.op === "funding.execute");
    expect(exec).toBeDefined();
    expect(exec!.outcome).toBe("ok");
    // Amount belongs in message, not attributes.
    expect(exec!.attributes).toBeUndefined();
    expect(exec!.message).toContain("500.000000");
  });

  it("emits a funding.gate rejection event", () => {
    const sink = captureSink();
    const funding = new FundingGateManager(["alice", "bob"], "USDC", 6, sink.telemetry);

    funding.submitRequest("req-2", "sketchy", usdc("1.000000"), "carol");
    funding.rejectRequest("req-2", "alice", "no");

    const rej = sink.events.find((e) => e.op === "funding.gate" && e.attributes?.decision === "rejected");
    expect(rej).toBeDefined();
    expect(rej!.level).toBe("warn");
  });

  it("emits payroll.run with a recipientCount attribute", () => {
    const sink = captureSink();
    const payroll = new PayrollEngine("USDC", 6, sink.telemetry);
    const ledger = new Ledger();

    payroll.registerPayee("p-1", "Pat", "0xpat");
    payroll.setSchedule("p-1", [
      { id: "c-1", name: "base", type: "base", amount: usdc("1000.000000"), recurring: true, taxable: true },
    ]);
    payroll.createRun("run-1", { label: "2024-01", start: "2024-01-01", end: "2024-01-31" });
    payroll.approveRun("run-1");
    payroll.executeRun("run-1", ledger);

    const run = sink.events.find((e) => e.op === "payroll.run");
    expect(run).toBeDefined();
    expect(run!.outcome).toBe("ok");
    expect(run!.attributes).toEqual({ recipientCount: 1 });
    expect(run!.message).toContain("1000.000000");
  });

  it("emits distribution.execute with a recipientCount attribute", () => {
    const sink = captureSink();
    const dist = new DistributionEngine("USDC", 6, sink.telemetry);
    const ledger = new Ledger();

    dist.createPlan("plan-1", "Q1 split", "proportional", usdc("1000.000000"), [
      { payeeId: "a", share: 5000 },
      { payeeId: "b", share: 5000 },
    ]);
    dist.approvePlan("plan-1");
    dist.executeDistribution("plan-1", ledger);

    const exec = sink.events.find((e) => e.op === "distribution.execute");
    expect(exec).toBeDefined();
    expect(exec!.outcome).toBe("ok");
    expect(exec!.attributes).toEqual({ recipientCount: 2 });
  });

  it("defaults to a silent sink when none is injected", () => {
    const payroll = new PayrollEngine("USDC", 6);
    const ledger = new Ledger();
    payroll.registerPayee("p-x", "X", "0xx");
    payroll.setSchedule("p-x", [
      { id: "c-x", name: "base", type: "base", amount: usdc("1.000000"), recurring: true, taxable: true },
    ]);
    payroll.createRun("run-x", { label: "2024-02", start: "2024-02-01", end: "2024-02-29" });
    payroll.approveRun("run-x");
    expect(() => payroll.executeRun("run-x", ledger)).not.toThrow();
  });
});
