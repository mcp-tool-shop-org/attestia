/**
 * Cross-Chain Reconciliation Rules
 *
 * Rules for reconciling events across multiple chains.
 * Prevents double-counting of L2 settlement transactions,
 * links cross-chain events structurally (not semantically),
 * and detects settlement pairs.
 *
 * Design rules:
 * - Pure functions — no side effects (telemetry is an optional side channel)
 * - Structural linking only — no semantic merging
 * - Fail-closed: ambiguous matches are flagged, not silently merged
 * - All return types are readonly
 * - Extensible: the settlement-pair table is injectable (B-RVP-006)
 * - Bounded: large dedup groups / event sets emit scale telemetry so a latency
 *   cliff is visible before it becomes an incident (B-RVP-004)
 */

import { NOOP_TELEMETRY, type Telemetry } from "@attestia/types";

// =============================================================================
// Types
// =============================================================================

/**
 * A chain event with enough context for cross-chain reconciliation.
 */
export interface CrossChainEvent {
  readonly chainId: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly amount: string;
  readonly symbol: string;
  readonly from: string;
  readonly to: string;
  readonly timestamp: string;
}

/**
 * A linked pair of cross-chain events.
 * The link is structural (same amount, same token, overlapping addresses)
 * and does NOT imply semantic equivalence.
 */
export interface CrossChainLink {
  readonly sourceEvent: CrossChainEvent;
  readonly destEvent: CrossChainEvent;
  readonly linkType: "settlement" | "bridge" | "structural";
  readonly confidence: "high" | "medium" | "low";
  readonly discrepancies: readonly string[];
}

// =============================================================================
// Settlement Pair Detection
// =============================================================================

/**
 * Built-in L2 → L1 settlement chain ID mapping.
 *
 * Exported (B-RVP-006) so a consumer onboarding a new settlement chain can
 * extend it as CONFIGURATION rather than forking the package:
 *
 * ```ts
 * const pairs = new Map([
 *   ...DEFAULT_SETTLEMENT_PAIRS,
 *   ["eip155:534352", "eip155:1"], // Scroll → Ethereum
 * ]);
 * preventDoubleCounting(events, { settlementPairs: pairs });
 * ```
 */
export const DEFAULT_SETTLEMENT_PAIRS: ReadonlyMap<string, string> = new Map([
  ["eip155:42161", "eip155:1"], // Arbitrum → Ethereum
  ["eip155:10", "eip155:1"],    // Optimism → Ethereum
  ["eip155:8453", "eip155:1"],  // Base → Ethereum
]);

/**
 * Check if two chains form a settlement pair (L2 settles on L1).
 *
 * @param chainA First chain ID
 * @param chainB Second chain ID
 * @param settlementPairs Optional injectable L2→L1 map (B-RVP-006).
 *   Defaults to {@link DEFAULT_SETTLEMENT_PAIRS}.
 * @returns true if chainA settles on chainB or vice versa
 */
export function isSettlementPair(
  chainA: string,
  chainB: string,
  settlementPairs: ReadonlyMap<string, string> = DEFAULT_SETTLEMENT_PAIRS,
): boolean {
  return (
    settlementPairs.get(chainA) === chainB ||
    settlementPairs.get(chainB) === chainA
  );
}

/**
 * Get the settlement chain for an L2, if known.
 *
 * @param l2ChainId The L2 chain ID
 * @param settlementPairs Optional injectable L2→L1 map (B-RVP-006).
 *   Defaults to {@link DEFAULT_SETTLEMENT_PAIRS}.
 */
export function getSettlementChain(
  l2ChainId: string,
  settlementPairs: ReadonlyMap<string, string> = DEFAULT_SETTLEMENT_PAIRS,
): string | undefined {
  return settlementPairs.get(l2ChainId);
}

// =============================================================================
// Shared Options
// =============================================================================

/**
 * Options shared by the cross-chain rule functions (B-RVP-004 / B-RVP-006).
 * All fields are optional; omitting the whole object preserves the original
 * behavior exactly.
 */
export interface CrossChainRuleOptions {
  /**
   * Injectable settlement-pair table (B-RVP-006). Defaults to
   * {@link DEFAULT_SETTLEMENT_PAIRS}. Spread the default to extend it.
   */
  readonly settlementPairs?: ReadonlyMap<string, string>;

  /**
   * Optional telemetry sink (B-RVP-004). When provided, a `warn`-level scale
   * event is emitted whenever a dedup group or candidate-pairing set exceeds
   * {@link scaleWarnThreshold}, so an operator sees scale pressure BEFORE it
   * becomes a latency incident. Side-channel only; a throwing sink is swallowed.
   */
  readonly telemetry?: Telemetry;

  /**
   * Group/event-set size at or above which a scale telemetry warning fires
   * (B-RVP-004). Defaults to 1000. Tune to the deployment's volume.
   */
  readonly scaleWarnThreshold?: number;
}

const DEFAULT_SCALE_WARN_THRESHOLD = 1000;

/** Defensively-guarded scale warning — a sink must never break the operation. */
function warnScale(
  telemetry: Telemetry,
  op: string,
  kind: string,
  size: number,
  threshold: number,
): void {
  try {
    telemetry.record({
      package: "@attestia/reconciler",
      op,
      level: "warn",
      outcome: "degraded",
      attributes: { kind, size, threshold },
      message:
        `cross-chain ${op}: ${kind} of size ${size} exceeds scale threshold ${threshold} — ` +
        `this is an O(n^2) hot path; large same-amount/same-symbol sets can stall the ` +
        `reconciliation. Consider narrowing the scope or pre-bucketing the input.`,
    });
  } catch {
    /* a sink must not break reconciliation — see NOOP_TELEMETRY contract */
  }
}

// =============================================================================
// Double-Counting Prevention
// =============================================================================

/**
 * Remove duplicate events that appear on both an L2 and its settlement chain.
 *
 * Strategy: When the same amount/token/address combination appears on both
 * an L2 and its L1 settlement chain, keep only the L2 event (which is the
 * originating event) and flag the L1 event as a settlement artifact.
 *
 * Performance (B-RVP-004): settlement detection within each same-amount group
 * is done with a single pass that buckets members by `chainId`, then checks
 * each L2's settlement L1 directly — O(group) rather than the previous
 * O(group^2) all-pairs nested loop. This removes the latency cliff on large
 * same-amount/same-symbol sets (e.g. a high-volume stablecoin reconciliation).
 * A scale warning fires via telemetry when any group is unusually large, so the
 * pressure is observable before it bites.
 *
 * @param events All events across multiple chains
 * @param options Optional injectable settlement pairs + scale telemetry
 * @returns Deduplicated events with settlement artifacts removed
 */
export function preventDoubleCounting(
  events: readonly CrossChainEvent[],
  options: CrossChainRuleOptions = {},
): {
  readonly kept: readonly CrossChainEvent[];
  readonly removed: readonly CrossChainEvent[];
} {
  const settlementPairs = options.settlementPairs ?? DEFAULT_SETTLEMENT_PAIRS;
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  const threshold = options.scaleWarnThreshold ?? DEFAULT_SCALE_WARN_THRESHOLD;

  // Group events by canonical key: amount + symbol + address set
  const eventsByKey = new Map<string, CrossChainEvent[]>();

  for (const event of events) {
    // Create a normalized key from amount + symbol + sorted addresses
    const addresses = [event.from, event.to].sort().join("|");
    const key = `${event.amount}:${event.symbol}:${addresses}`;

    const list = eventsByKey.get(key) ?? [];
    list.push(event);
    eventsByKey.set(key, list);
  }

  const kept: CrossChainEvent[] = [];
  const removed: CrossChainEvent[] = [];

  for (const [, group] of eventsByKey) {
    if (group.length <= 1) {
      kept.push(...group);
      continue;
    }

    // Surface scale pressure: a single large same-amount/same-symbol group is
    // the input that used to make this hot path quadratic (B-RVP-004).
    if (group.length >= threshold) {
      warnScale(telemetry, "preventDoubleCounting", "dedup-group", group.length, threshold);
    }

    // Bucket the group's chains in a single pass. A settlement chain (L1) is
    // an "artifact" iff some L2 that settles on it is also present in this
    // same-amount group — exactly the condition the old O(n^2) pair loop tested.
    const chainsPresent = new Set<string>();
    for (const event of group) chainsPresent.add(event.chainId);

    const artifactL1Chains = new Set<string>();
    for (const chainId of chainsPresent) {
      const settlesOn = getSettlementChain(chainId, settlementPairs);
      if (settlesOn !== undefined && chainsPresent.has(settlesOn)) {
        // This L2's L1 settlement chain is in the group → its events are artifacts.
        artifactL1Chains.add(settlesOn);
      }
    }

    if (artifactL1Chains.size > 0) {
      for (const event of group) {
        if (artifactL1Chains.has(event.chainId)) {
          removed.push(event);
        } else {
          kept.push(event);
        }
      }
    } else {
      // No settlement pair found — keep all
      kept.push(...group);
    }
  }

  return { kept, removed };
}

// =============================================================================
// Structural Linking
// =============================================================================

/**
 * Link cross-chain events that appear structurally related.
 *
 * Structural linking uses heuristics (same amount, same token, overlapping
 * addresses) to identify potentially related events across chains.
 * This does NOT merge events — it only creates references for human review.
 *
 * Performance (B-RVP-004): linking is inherently all-pairs because a link
 * requires only 2 of 3 criteria (amount / symbol / address overlap), so a pair
 * can match on symbol + address while differing on amount — bucketing by any
 * single criterion would drop valid links. Rather than silently degrade, this
 * emits a scale-warning telemetry event when the event set is large enough that
 * the O(n^2) comparison becomes a latency concern, so the pressure is visible.
 *
 * @param events All events across multiple chains
 * @param options Optional injectable settlement pairs + scale telemetry
 * @returns Array of structural links between events
 */
export function linkCrossChainEvents(
  events: readonly CrossChainEvent[],
  options: CrossChainRuleOptions = {},
): readonly CrossChainLink[] {
  const settlementPairs = options.settlementPairs ?? DEFAULT_SETTLEMENT_PAIRS;
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  const threshold = options.scaleWarnThreshold ?? DEFAULT_SCALE_WARN_THRESHOLD;

  if (events.length >= threshold) {
    warnScale(telemetry, "linkCrossChainEvents", "event-set", events.length, threshold);
  }

  const links: CrossChainLink[] = [];

  // Compare all pairs of events from different chains
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]!;
      const b = events[j]!;

      // Skip same-chain events
      if (a.chainId === b.chainId) continue;

      // Check for structural similarity
      const discrepancies: string[] = [];
      let matchScore = 0;

      if (a.amount === b.amount) matchScore++;
      else discrepancies.push(`amount: ${a.amount} vs ${b.amount}`);

      if (a.symbol === b.symbol) matchScore++;
      else discrepancies.push(`symbol: ${a.symbol} vs ${b.symbol}`);

      // Check address overlap (from or to matches)
      const addressOverlap =
        a.from === b.from || a.from === b.to ||
        a.to === b.from || a.to === b.to;
      if (addressOverlap) matchScore++;
      else discrepancies.push("no address overlap");

      // Only link if at least 2 of 3 criteria match
      if (matchScore < 2) continue;

      const linkType = isSettlementPair(a.chainId, b.chainId, settlementPairs)
        ? "settlement" as const
        : "structural" as const;

      const confidence =
        matchScore === 3 ? "high" as const :
        matchScore === 2 ? "medium" as const :
        "low" as const;

      links.push({
        sourceEvent: a,
        destEvent: b,
        linkType,
        confidence,
        discrepancies,
      });
    }
  }

  return links;
}
