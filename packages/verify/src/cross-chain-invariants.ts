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
import { NOOP_TELEMETRY, type Telemetry } from "@attestia/types";

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
 * Check sequence contiguity within each chain (B-RVP-003).
 *
 * {@link checkEventOrdering} only requires strictly-increasing indices, so a
 * chain observed as [1, 2, 5] passes cleanly even though indices 3 and 4 are
 * absent. A hole in the sequence is the signature of exactly the failure the
 * verify layer exists to catch: a dropped, withheld, or not-yet-observed
 * on-chain event during a partial RPC outage. This check flags any gap so
 * partial ingestion is VISIBLE rather than silently tolerated.
 *
 * This is deliberately a SEPARATE, opt-in check rather than folded into
 * {@link checkEventOrdering}: the {@link InvariantEvent} model does not
 * universally guarantee dense indices, so an operator who knows a chain is
 * dense opts in by running this check (e.g. via the `additionalChecks` option
 * of {@link auditCrossChainInvariants}).
 */
export function checkSequenceContiguity(
  events: readonly InvariantEvent[],
): InvariantCheckResult {
  const violations: string[] = [];

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
      const gap = curr.sequenceIndex - prev.sequenceIndex;
      if (gap > 1) {
        violations.push(
          `${chainId}: possible missing event(s) between sequence ` +
            `${prev.sequenceIndex} and ${curr.sequenceIndex} ` +
            `(${gap - 1} index(es) absent, between event ${prev.eventId} and ${curr.eventId}) — ` +
            `a gap signals a dropped or not-yet-observed event; ingest the missing event(s) ` +
            `or audit the chain observer's coverage`,
        );
      }
    }
  }

  return {
    invariant: "sequence_contiguity",
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
 * A composable invariant check: a pure function from the event set to a
 * single {@link InvariantCheckResult}. The four built-ins
 * ({@link checkAssetConservation}, {@link checkNoDuplicateSettlement},
 * {@link checkEventOrdering}, {@link checkGovernanceConsistency}) and the
 * opt-in {@link checkSequenceContiguity} all satisfy this shape, so a caller
 * can register a custom invariant without forking the package.
 */
export type InvariantCheck = (
  events: readonly InvariantEvent[],
) => InvariantCheckResult;

/**
 * The four built-in invariant checks, in canonical evaluation order. Exposed so
 * a caller can run "all built-ins plus my custom invariant" via the
 * `additionalChecks` option without re-listing the defaults (B-RVP-006).
 */
export const BUILTIN_INVARIANT_CHECKS: readonly InvariantCheck[] = [
  checkAssetConservation,
  checkNoDuplicateSettlement,
  checkEventOrdering,
  checkGovernanceConsistency,
];

/**
 * Options for {@link auditCrossChainInvariants}. All fields are optional and
 * additive — omitting the whole object preserves the original four-check
 * behavior exactly.
 */
export interface CrossChainInvariantOptions {
  /**
   * Extra invariant checks to run AFTER the four built-ins (B-RVP-006). Each is
   * a pure {@link InvariantCheck}; its result is appended to `checks` and its
   * violations count toward the verdict. This is the extension point for adding
   * a compliance-driven invariant — or the opt-in
   * {@link checkSequenceContiguity} — without editing this package.
   */
  readonly additionalChecks?: readonly InvariantCheck[];

  /**
   * Replace the built-in checks entirely instead of appending. When provided,
   * `additionalChecks` is ignored. Use when the caller wants full control over
   * the invariant set (e.g. a non-EVM deployment).
   */
  readonly checks?: readonly InvariantCheck[];

  /**
   * Optional telemetry sink (B-RVP-001). When provided, one
   * `"invariants.audit"` event is emitted carrying low-cardinality
   * `{ verdict, totalViolations, checkCount }` attributes. Side-channel only:
   * never changes the verdict, and a throwing sink is swallowed.
   */
  readonly telemetry?: Telemetry;
}

/**
 * Run all cross-chain invariant checks.
 *
 * By default runs the four built-ins. Pass {@link CrossChainInvariantOptions}
 * to add custom invariants (`additionalChecks`) or replace the set (`checks`),
 * and to wire telemetry. Backward compatible: called with just `events` it
 * behaves exactly as before.
 */
export function auditCrossChainInvariants(
  events: readonly InvariantEvent[],
  options: CrossChainInvariantOptions = {},
): InvariantAuditResult {
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;

  const checkFns: readonly InvariantCheck[] =
    options.checks ??
    [...BUILTIN_INVARIANT_CHECKS, ...(options.additionalChecks ?? [])];

  const checks = checkFns.map((fn) => fn(events));

  const totalViolations = checks.reduce(
    (sum, c) => sum + c.violations.length,
    0,
  );

  const verdict: "PASS" | "FAIL" = totalViolations === 0 ? "PASS" : "FAIL";

  // Observability (B-RVP-001): one structured event per audit. Per-invariant
  // holds and counts are low-cardinality; raw violation strings stay out of
  // attributes (they belong in the result). Defensively guarded so a throwing
  // sink can never alter or abort an invariant verdict.
  try {
    const attributes: Record<string, string | number | boolean> = {
      verdict,
      totalViolations,
      checkCount: checks.length,
    };
    // Per-invariant holds as low-cardinality booleans (invariant names are a
    // small, bounded set), so an operator can alert on a specific breach.
    for (const c of checks) {
      attributes[`holds.${c.invariant}`] = c.holds;
    }
    telemetry.record({
      package: "@attestia/verify",
      op: "invariants.audit",
      level: verdict === "PASS" ? "info" : "warn",
      outcome: verdict === "PASS" ? "ok" : "failed",
      attributes,
      message:
        `cross-chain invariant audit ${verdict.toLowerCase()}: ` +
        `${totalViolations} violation(s) across ${checks.length} check(s)` +
        (verdict === "FAIL"
          ? ` — breached: ${checks
              .filter((c) => !c.holds)
              .map((c) => c.invariant)
              .join(", ")}`
          : ""),
    });
  } catch {
    /* a sink must not break the audit — see NOOP_TELEMETRY contract */
  }

  return {
    verdict,
    checks,
    totalViolations,
    auditedAt: new Date().toISOString(),
  };
}
