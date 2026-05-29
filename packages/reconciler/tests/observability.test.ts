/**
 * Observability for reconciliation (D4-B-001).
 *
 * Verifies that a capturing {@link Telemetry} sink receives one structured
 * `reconcile` event per run, carrying low-cardinality count attributes, a
 * duration, and an outcome that degrades when discrepancies are found.
 */
import { describe, it, expect } from "vitest";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import { Reconciler } from "../src/reconciler.js";
import type {
  ReconcilableIntent,
  ReconcilableChainEvent,
} from "../src/types.js";

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

describe("reconciler observability (D4-B-001)", () => {
  it("emits a reconcile event with ok outcome and count attributes for a clean run", () => {
    const sink = captureSink();
    const reconciler = new Reconciler({ telemetry: sink.telemetry });

    reconciler.reconcile({ intents: [], ledgerEntries: [], chainEvents: [] });

    const events = sink.events.filter((e) => e.op === "reconcile");
    expect(events).toHaveLength(1);

    const e = events[0]!;
    expect(e.package).toBe("@attestia/reconciler");
    expect(e.outcome).toBe("ok");
    expect(e.level).toBe("info");
    expect(typeof e.durationMs).toBe("number");
    expect(e.attributes).toEqual({ matched: 0, mismatched: 0, missing: 0 });
  });

  it("emits a degraded reconcile event when discrepancies are present", () => {
    const sink = captureSink();
    const reconciler = new Reconciler({ telemetry: sink.telemetry });

    const intents: ReconcilableIntent[] = [
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

    reconciler.reconcile({ intents, ledgerEntries: [], chainEvents: [] });

    const e = sink.events.find((ev) => ev.op === "reconcile")!;
    expect(e.outcome).toBe("degraded");
    expect(e.level).toBe("warn");
    // missing-ledger (intent↔ledger) + missing-chain (intent↔chain) → 2 missing.
    expect(e.attributes?.missing).toBe(2);
    // Report id (high-cardinality) lives in the message, not attributes.
    expect(e.message).toContain("recon:");
  });

  it("counts an amount mismatch toward the mismatched attribute", () => {
    const sink = captureSink();
    const reconciler = new Reconciler({ telemetry: sink.telemetry });

    const intents: ReconcilableIntent[] = [
      {
        id: "intent-amt",
        status: "executed",
        kind: "transfer",
        amount: usdc("100.000000"),
        chainId: "ethereum",
        txHash: "0xtx",
        declaredAt: "2024-01-01T00:00:00Z",
      },
    ];
    const chainEvents: ReconcilableChainEvent[] = [
      {
        chainId: "ethereum",
        txHash: "0xtx",
        from: "0xfrom",
        to: "0xto",
        amount: "90000000", // 90 USDC, intent expected 100
        decimals: 6,
        symbol: "USDC",
        timestamp: "2024-01-01T00:00:02Z",
      },
    ];

    reconciler.reconcile({ intents, ledgerEntries: [], chainEvents });

    const e = sink.events.find((ev) => ev.op === "reconcile")!;
    expect(e.attributes?.mismatched).toBeGreaterThanOrEqual(1);
    expect(e.outcome).toBe("degraded");
  });

  it("defaults to a silent sink and does not throw without telemetry", () => {
    const reconciler = new Reconciler();
    expect(() =>
      reconciler.reconcile({ intents: [], ledgerEntries: [], chainEvents: [] }),
    ).not.toThrow();
  });
});
