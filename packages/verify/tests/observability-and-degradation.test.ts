/**
 * Stage C amend (B-RVP-001 observability + B-RVP-003/005 degradation +
 * B-RVP-006 extensibility + B-RVP-009 humanization) for @attestia/verify.
 *
 * Covers:
 * - Telemetry on aggregateVerifierReports / auditMultiChainReplay /
 *   auditCrossChainInvariants — structured events, defensively guarded.
 * - Gap detection (multi-chain replay + checkSequenceContiguity) fails closed.
 * - Expected-chain coverage detection (auditMultiChainReplay) fails closed.
 * - ConsensusResult.reason names the specific FAIL cause.
 * - auditCrossChainInvariants additionalChecks / checks extension points.
 *
 * All telemetry is side-channel only: a throwing sink never changes a verdict.
 */
import { describe, it, expect } from "vitest";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import {
  aggregateVerifierReports,
} from "../src/verification-consensus.js";
import {
  auditMultiChainReplay,
} from "../src/multi-chain-replay.js";
import type { ChainEvent } from "../src/multi-chain-replay.js";
import {
  auditCrossChainInvariants,
  checkSequenceContiguity,
  checkEventOrdering,
  BUILTIN_INVARIANT_CHECKS,
} from "../src/cross-chain-invariants.js";
import type {
  InvariantEvent,
  InvariantCheckResult,
} from "../src/cross-chain-invariants.js";
import type { VerifierReport } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

function captureSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return { events, telemetry: { record: (e) => events.push(e) } };
}

const throwingSink: Telemetry = {
  record() {
    throw new Error("sink boom");
  },
};

function makeReport(
  verifierId: string,
  verdict: "PASS" | "FAIL",
  bundleHash = "a".repeat(64),
): VerifierReport {
  return {
    reportId: `report-${verifierId}`,
    verifierId,
    verdict,
    subsystemChecks: [],
    discrepancies: verdict === "FAIL" ? ["mismatch"] : [],
    bundleHash,
    verifiedAt: "2025-06-15T00:00:00Z",
  };
}

function chainEvent(chainId: string, sequenceIndex: number): ChainEvent {
  return {
    chainId,
    eventHash: `evt-${chainId}-${sequenceIndex}`,
    sequenceIndex,
    timestamp: `2025-01-01T00:00:${String(sequenceIndex).padStart(2, "0")}Z`,
    data: { type: "transfer", amount: String(1000 + sequenceIndex) },
  };
}

function invEvent(overrides: Partial<InvariantEvent> = {}): InvariantEvent {
  return {
    chainId: "eip155:1",
    eventId: `e-${overrides.sequenceIndex ?? 0}`,
    eventType: "transfer",
    amount: "1000",
    symbol: "ETH",
    sequenceIndex: 0,
    timestamp: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// =============================================================================
// B-RVP-001 — consensus telemetry + B-RVP-009 reason
// =============================================================================

describe("aggregateVerifierReports observability + reason (B-RVP-001 / B-RVP-009)", () => {
  it("emits a consensus.aggregate ok event with low-cardinality attributes on PASS", () => {
    const { telemetry, events } = captureSink();
    const result = aggregateVerifierReports(
      [makeReport("v1", "PASS"), makeReport("v2", "PASS")],
      2,
      telemetry,
    );

    expect(result.verdict).toBe("PASS");
    const e = events.find((ev) => ev.op === "consensus.aggregate")!;
    expect(e.package).toBe("@attestia/verify");
    expect(e.outcome).toBe("ok");
    expect(e.attributes).toMatchObject({
      verdict: "PASS",
      totalVerifiers: 2,
      passCount: 2,
      quorumReached: true,
      bundleAgreement: true,
      dissenterCount: 0,
    });
    expect(result.reason).toMatch(/consensus PASS/);
  });

  it("names 'no verifier reports submitted' for the empty case", () => {
    const { telemetry, events } = captureSink();
    const result = aggregateVerifierReports([], 2, telemetry);
    expect(result.verdict).toBe("FAIL");
    expect(result.reason).toBe("no verifier reports submitted");
    expect(events.some((e) => e.op === "consensus.aggregate" && e.outcome === "failed")).toBe(true);
  });

  it("names 'quorum not reached' when below the threshold", () => {
    const result = aggregateVerifierReports([makeReport("v1", "PASS")], 3);
    expect(result.verdict).toBe("FAIL");
    expect(result.reason).toMatch(/quorum not reached: 1 of 3/);
  });

  it("names a bundleHash disagreement", () => {
    const result = aggregateVerifierReports(
      [
        makeReport("v1", "PASS", "a".repeat(64)),
        makeReport("v2", "PASS", "b".repeat(64)),
      ],
      2,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.bundleAgreement).toBe(false);
    expect(result.reason).toMatch(/disagree on bundleHash/);
  });

  it("names 'majority did not pass' on a genuine split", () => {
    const result = aggregateVerifierReports(
      [makeReport("v1", "PASS"), makeReport("v2", "FAIL")],
      2,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.reason).toMatch(/majority did not pass/);
  });

  it("a throwing sink never changes the verdict (defensively guarded)", () => {
    const reports = [makeReport("v1", "PASS"), makeReport("v2", "PASS")];
    const guarded = aggregateVerifierReports(reports, 2, throwingSink);
    const plain = aggregateVerifierReports(reports, 2);
    expect(guarded.verdict).toBe(plain.verdict);
    expect(guarded.reason).toBe(plain.reason);
  });
});

// =============================================================================
// B-RVP-001/003/005 — multi-chain replay
// =============================================================================

describe("auditMultiChainReplay observability + degradation (B-RVP-001/003/005)", () => {
  it("emits a multichain.audit event with chainCount/eventCount and surfaces them on the result", () => {
    const { telemetry, events } = captureSink();
    const evts = [
      chainEvent("eip155:1", 0),
      chainEvent("eip155:1", 1),
      chainEvent("eip155:42161", 0),
    ];
    const result = auditMultiChainReplay(evts, { telemetry });

    expect(result.verdict).toBe("PASS");
    expect(result.chainCount).toBe(2);
    expect(result.eventCount).toBe(3);
    const e = events.find((ev) => ev.op === "multichain.audit")!;
    expect(e.attributes).toMatchObject({ verdict: "PASS", chainCount: 2, eventCount: 3 });
  });

  it("the legacy string overload (expectedCombinedHash) still works", () => {
    const evts = [chainEvent("eip155:1", 0), chainEvent("eip155:1", 1)];
    const first = auditMultiChainReplay(evts);
    const second = auditMultiChainReplay(evts, first.combinedHash);
    expect(second.verdict).toBe("PASS");
    const mismatch = auditMultiChainReplay(evts, "f".repeat(64));
    expect(mismatch.verdict).toBe("FAIL");
    expect(mismatch.discrepancies[0]).toMatch(/MULTICHAIN_HASH_MISMATCH/);
  });

  it("FAILS CLOSED on a sequence gap when contiguity is required (B-RVP-003)", () => {
    // [0,1,4] — indices 2 and 3 are absent (dropped/withheld events).
    const evts = [
      chainEvent("eip155:1", 0),
      chainEvent("eip155:1", 1),
      chainEvent("eip155:1", 4),
    ];
    const lenient = auditMultiChainReplay(evts);
    expect(lenient.verdict).toBe("PASS"); // unchanged default behavior

    const strict = auditMultiChainReplay(evts, { requireContiguousSequence: true });
    expect(strict.verdict).toBe("FAIL");
    expect(strict.discrepancies[0]).toMatch(/MULTICHAIN_SEQUENCE_GAP/);
    expect(strict.discrepancies[0]).toMatch(/between sequence 1 and 4/);
  });

  it("FAILS CLOSED when an expected chain produced zero events (B-RVP-005)", () => {
    const evts = [chainEvent("eip155:1", 0), chainEvent("eip155:1", 1)];
    // We expected solana too, but the observer went dark.
    const result = auditMultiChainReplay(evts, {
      expectedChainIds: ["eip155:1", "solana:mainnet-beta"],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.discrepancies.some((d) => d.includes("MULTICHAIN_CHAIN_ABSENT"))).toBe(true);
    expect(result.discrepancies.some((d) => d.includes("solana:mainnet-beta"))).toBe(true);
  });

  it("an empty audit with expected chains FAILS rather than silently PASSing (B-RVP-005)", () => {
    const result = auditMultiChainReplay([], { expectedChainIds: ["eip155:1"] });
    expect(result.verdict).toBe("FAIL");
    expect(result.eventCount).toBe(0);
    expect(result.chainCount).toBe(0);
  });

  it("a throwing sink never changes the verdict (defensively guarded)", () => {
    const evts = [chainEvent("eip155:1", 0)];
    expect(() => auditMultiChainReplay(evts, { telemetry: throwingSink })).not.toThrow();
    const guarded = auditMultiChainReplay(evts, { telemetry: throwingSink });
    expect(guarded.verdict).toBe("PASS");
  });
});

// =============================================================================
// B-RVP-001/003/006 — cross-chain invariants
// =============================================================================

describe("auditCrossChainInvariants observability + extensibility (B-RVP-001/006)", () => {
  it("emits an invariants.audit event with per-invariant holds", () => {
    const { telemetry, events } = captureSink();
    const evts = [invEvent({ sequenceIndex: 0 }), invEvent({ sequenceIndex: 1 })];
    const result = auditCrossChainInvariants(evts, { telemetry });
    expect(result.verdict).toBe("PASS");
    const e = events.find((ev) => ev.op === "invariants.audit")!;
    expect(e.attributes).toMatchObject({ verdict: "PASS", totalViolations: 0 });
    expect(e.attributes!["holds.event_ordering"]).toBe(true);
  });

  it("default audit still runs exactly the four built-ins (no behavior change)", () => {
    const result = auditCrossChainInvariants([invEvent()]);
    expect(result.checks.map((c) => c.invariant)).toEqual([
      "asset_conservation",
      "no_duplicate_settlement",
      "event_ordering",
      "governance_consistency",
    ]);
    expect(BUILTIN_INVARIANT_CHECKS).toHaveLength(4);
  });

  it("additionalChecks appends a custom invariant and counts its violations (B-RVP-006)", () => {
    // Opt into contiguity as a registered extra check, over a gappy chain.
    const evts = [
      invEvent({ sequenceIndex: 0, eventId: "a" }),
      invEvent({ sequenceIndex: 5, eventId: "b" }),
    ];
    // Without the extra check the built-ins pass (strictly increasing, no gap rule).
    expect(auditCrossChainInvariants(evts).verdict).toBe("PASS");

    const withGap = auditCrossChainInvariants(evts, {
      additionalChecks: [checkSequenceContiguity],
    });
    expect(withGap.verdict).toBe("FAIL");
    expect(withGap.checks.map((c) => c.invariant)).toContain("sequence_contiguity");
    expect(withGap.totalViolations).toBeGreaterThan(0);
  });

  it("a fully custom check set replaces the built-ins", () => {
    const alwaysFail = (): InvariantCheckResult => ({
      invariant: "custom",
      holds: false,
      violations: ["nope"],
    });
    const result = auditCrossChainInvariants([invEvent()], { checks: [alwaysFail] });
    expect(result.checks).toHaveLength(1);
    expect(result.verdict).toBe("FAIL");
  });

  it("a throwing sink never changes the verdict (defensively guarded)", () => {
    expect(() =>
      auditCrossChainInvariants([invEvent()], { telemetry: throwingSink }),
    ).not.toThrow();
  });
});

describe("checkSequenceContiguity (B-RVP-003)", () => {
  it("holds for a contiguous chain", () => {
    const evts = [
      invEvent({ sequenceIndex: 0 }),
      invEvent({ sequenceIndex: 1 }),
      invEvent({ sequenceIndex: 2 }),
    ];
    expect(checkSequenceContiguity(evts).holds).toBe(true);
  });

  it("flags a hole as a missing-event violation", () => {
    const evts = [invEvent({ sequenceIndex: 1, eventId: "x" }), invEvent({ sequenceIndex: 3, eventId: "y" })];
    const result = checkSequenceContiguity(evts);
    expect(result.holds).toBe(false);
    expect(result.violations[0]).toMatch(/possible missing event/);
  });

  it("checks each chain independently and does not flag the strict-increase case checkEventOrdering catches", () => {
    // checkEventOrdering catches non-increase; contiguity catches gaps — different lenses.
    const ordering = checkEventOrdering([
      invEvent({ chainId: "c", sequenceIndex: 0 }),
      invEvent({ chainId: "c", sequenceIndex: 0 }),
    ]);
    expect(ordering.holds).toBe(false);
  });
});
