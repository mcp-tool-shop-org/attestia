/**
 * Stage C amend for @attestia/reconciler:
 * - B-RVP-002 defensive: Reconciler.reconcile returns its completed report even
 *   when the injected telemetry sink throws (observability must not break the op).
 * - B-RVP-006 extensibility: settlement-pair table is injectable into
 *   isSettlementPair / getSettlementChain / preventDoubleCounting /
 *   linkCrossChainEvents (add a chain as config, not a source edit).
 * - B-RVP-004 degradation: a large dedup group / event set emits a scale-warning
 *   telemetry event; preventDoubleCounting's bucketed pass is behavior-preserving.
 */
import { describe, it, expect } from "vitest";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import { Reconciler } from "../src/reconciler.js";
import {
  isSettlementPair,
  getSettlementChain,
  preventDoubleCounting,
  linkCrossChainEvents,
  DEFAULT_SETTLEMENT_PAIRS,
} from "../src/cross-chain-rules.js";
import type { CrossChainEvent } from "../src/cross-chain-rules.js";

function captureSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return { events, telemetry: { record: (e) => events.push(e) } };
}

const throwingSink: Telemetry = {
  record() {
    throw new Error("pushgateway down");
  },
};

function makeEvent(
  chainId: string,
  overrides: Partial<CrossChainEvent> = {},
): CrossChainEvent {
  return {
    chainId,
    txHash: `0x${chainId}-tx`,
    blockNumber: 100,
    amount: "1000000000000000000",
    symbol: "ETH",
    from: "0xsender",
    to: "0xreceiver",
    timestamp: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// =============================================================================
// B-RVP-002 — telemetry must not break reconciliation
// =============================================================================

describe("Reconciler telemetry guard (B-RVP-002)", () => {
  it("returns the completed report even when the sink throws", () => {
    const reconciler = new Reconciler({ telemetry: throwingSink });
    let report: ReturnType<Reconciler["reconcile"]> | undefined;
    expect(() => {
      report = reconciler.reconcile({ intents: [], ledgerEntries: [], chainEvents: [] });
    }).not.toThrow();
    expect(report).toBeDefined();
    expect(report!.summary.allReconciled).toBe(true);
  });

  it("still emits one reconcile event when the sink is well-behaved", () => {
    const { telemetry, events } = captureSink();
    const reconciler = new Reconciler({ telemetry });
    reconciler.reconcile({ intents: [], ledgerEntries: [], chainEvents: [] });
    expect(events.filter((e) => e.op === "reconcile")).toHaveLength(1);
  });
});

// =============================================================================
// B-RVP-006 — injectable settlement pairs
// =============================================================================

describe("injectable settlement pairs (B-RVP-006)", () => {
  it("isSettlementPair / getSettlementChain default to the built-in table", () => {
    expect(isSettlementPair("eip155:42161", "eip155:1")).toBe(true);
    expect(getSettlementChain("eip155:42161")).toBe("eip155:1");
    expect(DEFAULT_SETTLEMENT_PAIRS.get("eip155:8453")).toBe("eip155:1");
  });

  it("recognizes a NEW settlement chain via an injected map without a source edit", () => {
    const scroll = "eip155:534352";
    // Built-in does not know Scroll.
    expect(isSettlementPair(scroll, "eip155:1")).toBe(false);

    const extended = new Map([...DEFAULT_SETTLEMENT_PAIRS, [scroll, "eip155:1"]]);
    expect(isSettlementPair(scroll, "eip155:1", extended)).toBe(true);
    expect(getSettlementChain(scroll, extended)).toBe("eip155:1");

    // And dedup honors the injected map.
    const events = [
      makeEvent(scroll, { txHash: "0xscroll" }),
      makeEvent("eip155:1", { txHash: "0xeth" }),
    ];
    const withDefault = preventDoubleCounting(events);
    expect(withDefault.removed.length).toBe(0); // Scroll unknown by default

    const withInjected = preventDoubleCounting(events, { settlementPairs: extended });
    expect(withInjected.removed.length).toBe(1);
    expect(withInjected.removed[0]!.chainId).toBe("eip155:1");
  });

  it("linkCrossChainEvents labels an injected settlement pair as 'settlement'", () => {
    const scroll = "eip155:534352";
    const extended = new Map([...DEFAULT_SETTLEMENT_PAIRS, [scroll, "eip155:1"]]);
    const events = [makeEvent(scroll, { txHash: "0xa" }), makeEvent("eip155:1", { txHash: "0xb" })];

    expect(linkCrossChainEvents(events)[0]!.linkType).toBe("structural");
    expect(linkCrossChainEvents(events, { settlementPairs: extended })[0]!.linkType).toBe("settlement");
  });
});

// =============================================================================
// B-RVP-004 — scale telemetry + behavior-preserving dedup
// =============================================================================

describe("scale telemetry + bounded dedup (B-RVP-004)", () => {
  it("preventDoubleCounting result is unchanged vs the previous semantics (multi-L2 → one L1)", () => {
    const events = [
      makeEvent("eip155:42161", { txHash: "0xarb" }),
      makeEvent("eip155:10", { txHash: "0xop" }),
      makeEvent("eip155:1", { txHash: "0xeth" }),
    ];
    const result = preventDoubleCounting(events);
    expect(result.kept.length).toBe(2);
    expect(result.removed.length).toBe(1);
    expect(result.removed[0]!.chainId).toBe("eip155:1");
  });

  it("warns when a same-amount dedup group exceeds the scale threshold", () => {
    const { telemetry, events } = captureSink();
    // 5 identical-key events (same amount/symbol/addresses) → one big group.
    const group = Array.from({ length: 5 }, (_, i) =>
      makeEvent("eip155:1", { txHash: `0x${i}` }),
    );
    preventDoubleCounting(group, { telemetry, scaleWarnThreshold: 4 });
    const warn = events.find((e) => e.op === "preventDoubleCounting");
    expect(warn).toBeDefined();
    expect(warn!.level).toBe("warn");
    expect(warn!.attributes).toMatchObject({ kind: "dedup-group" });
  });

  it("warns when the linkCrossChainEvents event set exceeds the scale threshold", () => {
    const { telemetry, events } = captureSink();
    const set = Array.from({ length: 6 }, (_, i) =>
      makeEvent(i % 2 === 0 ? "eip155:1" : "eip155:42161", { txHash: `0x${i}` }),
    );
    linkCrossChainEvents(set, { telemetry, scaleWarnThreshold: 5 });
    const warn = events.find((e) => e.op === "linkCrossChainEvents");
    expect(warn).toBeDefined();
    expect(warn!.attributes).toMatchObject({ kind: "event-set", size: 6 });
  });

  it("a throwing sink never breaks dedup (defensively guarded)", () => {
    const group = Array.from({ length: 3 }, (_, i) =>
      makeEvent("eip155:1", { txHash: `0x${i}` }),
    );
    expect(() =>
      preventDoubleCounting(group, { telemetry: throwingSink, scaleWarnThreshold: 1 }),
    ).not.toThrow();
  });
});
