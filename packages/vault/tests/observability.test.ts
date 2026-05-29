/**
 * Observability across vault financial operations (D4-B-001).
 *
 * Verifies that injecting a capturing {@link Telemetry} sink yields structured
 * events for intent lifecycle transitions and budget outcomes, that the default
 * (no sink) stays silent, and that low-cardinality attributes never carry raw
 * amounts or ids.
 */
import { describe, it, expect } from "vitest";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import { BudgetEngine } from "../src/budget.js";
import { IntentManager } from "../src/intent-manager.js";

/** A capturing telemetry sink for assertions. */
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

describe("vault observability (D4-B-001)", () => {
  it("emits an intent.transition event for a lifecycle transition", () => {
    const sink = captureSink();
    const budget = new BudgetEngine("owner-1", "USDC", 6, sink.telemetry);
    const intents = new IntentManager(budget, sink.telemetry);

    intents.declare("i-1", "transfer", "test transfer", "owner-1", {
      amount: usdc("10.000000"),
    });
    // declare does not transition (it creates) — approve is the first transition.
    intents.approve("i-1", "owner-1", "looks good");

    const transitions = sink.events.filter((e) => e.op === "intent.transition");
    expect(transitions.length).toBeGreaterThanOrEqual(1);

    const approved = transitions.find((e) => e.attributes?.to === "approved");
    expect(approved).toBeDefined();
    expect(approved!.package).toBe("@attestia/vault");
    expect(approved!.attributes).toEqual({ from: "declared", to: "approved" });
    // The intent id (high-cardinality) belongs in the message, not attributes.
    expect(approved!.message).toContain("i-1");
  });

  it("emits budget.spend on execution and budget.reverse on failure", () => {
    const sink = captureSink();
    const budget = new BudgetEngine("owner-1", "USDC", 6, sink.telemetry);
    const intents = new IntentManager(budget, sink.telemetry);

    budget.createEnvelope("env-1", "Ops");
    budget.allocate("env-1", usdc("100.000000"));

    intents.declare("i-2", "transfer", "spend", "owner-1", { amount: usdc("40.000000") }, "env-1");
    intents.approve("i-2", "owner-1");
    intents.markExecuting("i-2");
    intents.recordExecution("i-2", "ethereum", "0xabc"); // triggers budget.spend
    intents.recordFailure("i-2", ["chain reverted"]); // triggers budget.reverse

    const spend = sink.events.find((e) => e.op === "budget.spend");
    const reverse = sink.events.find((e) => e.op === "budget.reverse");
    expect(spend).toBeDefined();
    expect(spend!.outcome).toBe("ok");
    expect(reverse).toBeDefined();
    expect(reverse!.outcome).toBe("ok");

    // The full transition chain should also have surfaced, ending in failed.
    const failed = sink.events.find(
      (e) => e.op === "intent.transition" && e.attributes?.to === "failed",
    );
    expect(failed).toBeDefined();
    expect(failed!.outcome).toBe("failed");
  });

  it("marks a non-matching verification as degraded", () => {
    const sink = captureSink();
    const budget = new BudgetEngine("owner-1", "USDC", 6, sink.telemetry);
    const intents = new IntentManager(budget, sink.telemetry);

    intents.declare("i-3", "transfer", "verify", "owner-1", {});
    intents.approve("i-3", "owner-1");
    intents.markExecuting("i-3");
    intents.recordExecution("i-3", "ethereum", "0xdef");
    intents.verify("i-3", false, ["amount off"]);

    const verified = sink.events.find(
      (e) => e.op === "intent.transition" && e.attributes?.to === "verified",
    );
    expect(verified).toBeDefined();
    expect(verified!.outcome).toBe("degraded");
    expect(verified!.attributes?.matched).toBe(false);
  });

  it("defaults to a silent (no-op) sink when none is injected", () => {
    // No telemetry argument — must not throw and must produce no observable
    // side effects we can assert on (we simply exercise the path).
    const budget = new BudgetEngine("owner-1", "USDC", 6);
    const intents = new IntentManager(budget);
    budget.createEnvelope("env-x", "X");
    budget.allocate("env-x", usdc("5.000000"));
    intents.declare("i-x", "transfer", "d", "owner-1", { amount: usdc("1.000000") }, "env-x");
    expect(() => intents.approve("i-x", "owner-1")).not.toThrow();
  });
});
