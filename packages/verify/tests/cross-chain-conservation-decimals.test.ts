/**
 * Cross-Chain Asset Conservation — Decimal Amount Tests (A-VERIFY-002).
 *
 * `checkAssetConservation` previously fed amount strings straight into
 * `BigInt(event.amount)`. That is wrong for the canonical Money representation,
 * which uses decimal numeral strings + a `decimals` scale:
 *   - `BigInt("100.50")` THROWS → a balanced bridge is reported as a false
 *     conservation violation ("Invalid amount").
 *   - `BigInt("")` returns 0n → a missing amount is silently counted as zero
 *     instead of being rejected.
 *
 * Fix contract:
 * - Decimal-string amounts are parsed and normalized to integer minor units
 *   using each event's `decimals` scale before summing.
 * - Amounts that share a symbol must agree on `decimals` (mixed scales cannot
 *   be summed safely).
 * - Empty / non-canonical amounts are REJECTED as a structured violation, never
 *   coerced to zero.
 */

import { describe, it, expect } from "vitest";
import { checkAssetConservation } from "../src/cross-chain-invariants.js";
import type { InvariantEvent } from "../src/cross-chain-invariants.js";

function makeEvent(overrides: Partial<InvariantEvent> = {}): InvariantEvent {
  return {
    chainId: "eip155:1",
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    eventType: "transfer",
    amount: "1000",
    symbol: "ETH",
    sequenceIndex: 0,
    timestamp: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("checkAssetConservation — decimal amounts (A-VERIFY-002)", () => {
  it("balances decimal-string amounts: 100.50 + 0.50 == 101.00", () => {
    const events: InvariantEvent[] = [
      makeEvent({ eventType: "bridge_out", amount: "100.50", symbol: "USDC", decimals: 2 }),
      makeEvent({ eventType: "bridge_out", amount: "0.50", symbol: "USDC", decimals: 2 }),
      makeEvent({ eventType: "bridge_in", amount: "101.00", symbol: "USDC", decimals: 2 }),
    ];

    const result = checkAssetConservation(events);
    expect(result.holds).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("detects a real decimal imbalance instead of throwing", () => {
    const events: InvariantEvent[] = [
      makeEvent({ eventType: "bridge_out", amount: "100.50", symbol: "USDC", decimals: 2 }),
      makeEvent({ eventType: "bridge_in", amount: "100.00", symbol: "USDC", decimals: 2 }),
    ];

    const result = checkAssetConservation(events);
    expect(result.holds).toBe(false);
    expect(result.violations[0]).toContain("Asset conservation violation");
  });

  it("rejects an empty-string amount as a violation (never treated as 0)", () => {
    const events: InvariantEvent[] = [
      makeEvent({ eventType: "bridge_out", amount: "", symbol: "ETH", decimals: 0 }),
      makeEvent({ eventType: "bridge_in", amount: "", symbol: "ETH", decimals: 0 }),
    ];

    const result = checkAssetConservation(events);
    expect(result.holds).toBe(false);
    // Must be flagged as an invalid amount, NOT silently balanced at 0 == 0.
    expect(result.violations.some((v) => v.includes("Invalid amount"))).toBe(true);
  });

  it("normalizes by decimals scale (6dp) correctly", () => {
    const events: InvariantEvent[] = [
      makeEvent({ eventType: "bridge_out", amount: "1.000001", symbol: "XRP", decimals: 6 }),
      makeEvent({ eventType: "bridge_in", amount: "1.000001", symbol: "XRP", decimals: 6 }),
    ];

    const result = checkAssetConservation(events);
    expect(result.holds).toBe(true);
  });
});
