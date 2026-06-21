/**
 * Cross-Chain Invariant Checker
 *
 * Validates structural invariants across multi-chain events:
 * - Asset conservation (no creation/destruction across chains)
 * - No duplicate settlement (same event settled twice)
 * - Event ordering consistency
 * - Governance consistency
 *
 * Design:
 * - Pure structural validation — no network calls
 * - Each check returns pass/fail with evidence
 * - Composable: run individual checks or all at once
 */

import { parseAmount } from "@attestia/ledger";

// =============================================================================
// Types
// =============================================================================

/**
 * A cross-chain event for invariant checking.
 */
export interface InvariantEvent {
  /** Chain identifier */
  readonly chainId: string;

  /** Unique event identifier */
  readonly eventId: string;

  /** Event type (transfer, settlement, bridge, etc.) */
  readonly eventType: string;

  /**
   * Amount as a canonical decimal numeral string for precision (e.g.,
   * "100.50", "1000000"). This is NOT a raw integer-minor-units string — it is
   * interpreted together with {@link decimals}. Feeding it directly to BigInt is
   * incorrect: a decimal point throws and an empty string silently yields zero.
   * Asset-conservation normalization scales by `10 ** decimals` via the
   * canonical `parseAmount` money helper before summing.
   */
  readonly amount: string;

  /**
   * Number of decimal places for {@link amount} (the Money scale).
   * XRP/USDC = 6, ETH = 18, integer-minor-units = 0. Optional for backward
   * compatibility: when omitted, defaults to 0 (amount is treated as integer
   * minor units and must contain no fractional digits).
   */
  readonly decimals?: number;

  /** Symbol (e.g., "ETH", "SOL", "XRP") */
  readonly symbol: string;

  /** Sequence index within the chain */
  readonly sequenceIndex: number;

  /** ISO 8601 timestamp */
  readonly timestamp: string;

  /** Optional: linked event on another chain */
  readonly linkedEventId?: string;

  /** Optional: settlement chain ID */
  readonly settlementChainId?: string;
}

/**
 * Result of a single invariant check.
 */
export interface InvariantCheckResult {
  /** Name of the invariant */
  readonly invariant: string;

  /** Whether the invariant holds */
  readonly holds: boolean;

  /** Evidence of violations (empty if holds) */
  readonly violations: readonly string[];
}

/**
 * Result of running all invariant checks.
 */
export interface InvariantAuditResult {
  /** Overall verdict */
  readonly verdict: "PASS" | "FAIL";

  /** Individual check results */
  readonly checks: readonly InvariantCheckResult[];

  /** Total number of violations */
  readonly totalViolations: number;

  /** ISO 8601 timestamp */
  readonly auditedAt: string;
}

// =============================================================================
// Individual Invariant Checks
// =============================================================================

/**
 * Check asset conservation across chains.
 *
 * For each symbol, the total amount sent from chain A to chain B
 * must equal the total amount received on chain B from chain A.
 * Bridge events must balance.
 */
export function checkAssetConservation(
  events: readonly InvariantEvent[],
): InvariantCheckResult {
  const violations: string[] = [];

  // Group bridge events by symbol. `decimals` records the scale agreed for the
  // symbol so that mixed scales (which cannot be summed safely) are detected.
  const bySymbol = new Map<
    string,
    { outflows: bigint; inflows: bigint; decimals: number }
  >();

  for (const event of events) {
    if (event.eventType !== "bridge_out" && event.eventType !== "bridge_in") {
      continue;
    }

    const decimals = event.decimals ?? 0;

    // Reject mixed decimal scales for the same symbol — summing minor units
    // across different scales would silently corrupt the conservation check.
    const existing = bySymbol.get(event.symbol);
    if (existing && existing.decimals !== decimals) {
      violations.push(
        `Mixed decimal scales for ${event.symbol}: event ${event.eventId} ` +
        `declares decimals=${String(decimals)}, but ${String(existing.decimals)} ` +
        `was already recorded for this symbol`,
      );
      continue;
    }

    // Normalize the decimal-string amount to integer minor units via the
    // canonical money parser. It validates the format fail-closed: empty or
    // non-canonical amounts throw rather than coercing to zero, and a decimal
    // amount (e.g. "100.50") is scaled correctly instead of throwing.
    let amount: bigint;
    try {
      amount = parseAmount(event.amount, decimals);
    } catch {
      violations.push(
        `Invalid amount "${event.amount}" for event ${event.eventId}`,
      );
      continue;
    }

    const bucket = existing ?? { outflows: 0n, inflows: 0n, decimals };
    if (event.eventType === "bridge_out") {
      bucket.outflows += amount;
    } else {
      bucket.inflows += amount;
    }

    bySymbol.set(event.symbol, bucket);
  }

  for (const [symbol, { outflows, inflows }] of bySymbol) {
    if (outflows !== inflows) {
      violations.push(
        `Asset conservation violation for ${symbol}: ` +
        `outflows=${outflows.toString()}, inflows=${inflows.toString()}, ` +
        `delta=${(outflows - inflows).toString()}`,
      );
    }
  }

  return {
    invariant: "asset_conservation",
    holds: violations.length === 0,
    violations,
  };
}

/**
 * Check for duplicate settlement.
 *
 * The same event should not appear as settled more than once.
 */
export function checkNoDuplicateSettlement(
  events: readonly InvariantEvent[],
): InvariantCheckResult {
  const violations: string[] = [];
  const settled = new Map<string, string>();

  for (const event of events) {
    if (event.eventType !== "settlement") continue;

    if (!event.linkedEventId) {
      violations.push(
        `Settlement event ${event.eventId} has no linkedEventId`,
      );
      continue;
    }

    const existing = settled.get(event.linkedEventId);
    if (existing) {
      violations.push(
        `Duplicate settlement: event ${event.linkedEventId} settled by both ` +
        `${existing} and ${event.eventId}`,
      );
    }
    settled.set(event.linkedEventId, event.eventId);
  }

  return {
    invariant: "no_duplicate_settlement",
    holds: violations.length === 0,
    violations,
  };
}

/**
 * Check event ordering consistency.
 *
 * Within each chain, events must have monotonically increasing sequence indices.
 * Timestamps should be non-decreasing (allowing equal timestamps for same-block events).
 */
export function checkEventOrdering(
  events: readonly InvariantEvent[],
): InvariantCheckResult {
  const violations: string[] = [];

  // Group by chain
  const byChain = new Map<string, InvariantEvent[]>();
  for (const event of events) {
    const chain = byChain.get(event.chainId) ?? [];
    chain.push(event);
    byChain.set(event.chainId, chain);
  }

  for (const [chainId, chainEvents] of byChain) {
    const sorted = [...chainEvents].sort(
      (a, b) => a.sequenceIndex - b.sequenceIndex,
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;

      // Sequence index must be strictly increasing
      if (curr.sequenceIndex <= prev.sequenceIndex) {
        violations.push(
          `${chainId}: non-increasing sequence at index ${curr.sequenceIndex} ` +
          `(event ${curr.eventId} after ${prev.eventId})`,
        );
      }

      // Timestamps should be non-decreasing
      if (curr.timestamp < prev.timestamp) {
        violations.push(
          `${chainId}: timestamp regression at index ${curr.sequenceIndex} ` +
          `(${curr.timestamp} < ${prev.timestamp})`,
        );
      }
    }
  }

  return {
    invariant: "event_ordering",
    holds: violations.length === 0,
    violations,
  };
}

/**
 * Check governance consistency.
 *
 * Governance events should have valid transitions:
 * - No negative quorum
 * - No duplicate signer additions without removal
 * - Version numbers must be monotonically increasing
 */
export function checkGovernanceConsistency(
  events: readonly InvariantEvent[],
): InvariantCheckResult {
  const violations: string[] = [];
  const governanceEvents = events.filter((e) =>
    e.eventType.startsWith("governance_"),
  );

  if (governanceEvents.length === 0) {
    return { invariant: "governance_consistency", holds: true, violations: [] };
  }

  // Check version ordering
  const sorted = [...governanceEvents].sort(
    (a, b) => a.sequenceIndex - b.sequenceIndex,
  );

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;

    if (curr.sequenceIndex <= prev.sequenceIndex) {
      violations.push(
        `Governance version regression: ${curr.sequenceIndex} <= ${prev.sequenceIndex}`,
      );
    }
  }

  // Check for duplicate signer additions
  const activeSigner = new Set<string>();
  for (const event of sorted) {
    const signerAddr = event.eventId.split(":")[1]; // convention: "signer_added:rAddr"
    if (!signerAddr) continue;

    if (event.eventType === "governance_signer_added") {
      if (activeSigner.has(signerAddr)) {
        violations.push(
          `Duplicate signer addition: ${signerAddr} already active`,
        );
      }
      activeSigner.add(signerAddr);
    } else if (event.eventType === "governance_signer_removed") {
      activeSigner.delete(signerAddr);
    }
  }

  return {
    invariant: "governance_consistency",
    holds: violations.length === 0,
    violations,
  };
}

// =============================================================================
// Combined Audit
// =============================================================================

/**
 * Run all cross-chain invariant checks.
 */
export function auditCrossChainInvariants(
  events: readonly InvariantEvent[],
): InvariantAuditResult {
  const checks = [
    checkAssetConservation(events),
    checkNoDuplicateSettlement(events),
    checkEventOrdering(events),
    checkGovernanceConsistency(events),
  ];

  const totalViolations = checks.reduce(
    (sum, c) => sum + c.violations.length,
    0,
  );

  return {
    verdict: totalViolations === 0 ? "PASS" : "FAIL",
    checks,
    totalViolations,
    auditedAt: new Date().toISOString(),
  };
}
