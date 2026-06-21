/**
 * Multi-Chain Replay Auditor
 *
 * Replays events across multiple chains and computes per-chain hash chains
 * plus a combined cross-chain hash. Used to verify that multi-chain state
 * is consistent and tamper-evident.
 *
 * Design:
 * - Per-chain hash chains for isolation
 * - Combined cross-chain hash for holistic integrity
 * - Deterministic: same events → same result (always)
 * - Fail-closed: any divergence → audit failure
 */

import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { NOOP_TELEMETRY, type Telemetry } from "@attestia/types";

// =============================================================================
// Types
// =============================================================================

/**
 * A single chain's event for replay.
 */
export interface ChainEvent {
  /** Chain identifier (e.g., "eip155:1", "solana:mainnet-beta") */
  readonly chainId: string;

  /** Event hash or unique identifier */
  readonly eventHash: string;

  /** Event sequence index within the chain */
  readonly sequenceIndex: number;

  /** ISO 8601 timestamp */
  readonly timestamp: string;

  /** Event data (canonical JSON-serializable) */
  readonly data: Record<string, unknown>;
}

/**
 * Result of replaying a single chain.
 */
export interface ChainReplayResult {
  /** Chain identifier */
  readonly chainId: string;

  /** Final hash-chain digest for this chain */
  readonly hashChain: string;

  /** Number of events replayed */
  readonly eventCount: number;

  /** Hash of the first event (for anchoring) */
  readonly firstEventHash: string;

  /** Hash of the last event */
  readonly lastEventHash: string;
}

/**
 * Result of a full multi-chain replay audit.
 */
export interface MultiChainAuditResult {
  /** Overall audit verdict */
  readonly verdict: "PASS" | "FAIL";

  /** Combined cross-chain hash */
  readonly combinedHash: string;

  /** Per-chain replay results */
  readonly chains: readonly ChainReplayResult[];

  /** ISO 8601 timestamp of the audit */
  readonly auditedAt: string;

  /** Discrepancies found (empty if PASS) */
  readonly discrepancies: readonly string[];

  /** Number of distinct chains audited. */
  readonly chainCount: number;

  /** Total number of events replayed across all chains. */
  readonly eventCount: number;
}

/**
 * Options for {@link auditMultiChainReplay}.
 *
 * All fields are optional and additive — omitting the whole object preserves
 * the original `(events, expectedCombinedHash?)` behavior exactly.
 */
export interface MultiChainAuditOptions {
  /**
   * Expected combined cross-chain hash. When provided, a mismatch is a
   * fail-closed discrepancy. (Previously the positional second argument.)
   */
  readonly expectedCombinedHash?: string;

  /**
   * Chain IDs the auditor is expected to have observed. When provided, any
   * expected chain that produced ZERO events is a fail-closed discrepancy:
   * an observer that went dark must not be indistinguishable from a chain
   * that was verified clean (B-RVP-005). Without this, an empty/partial event
   * set silently PASSes.
   */
  readonly expectedChainIds?: readonly string[];

  /**
   * When true, each chain's `sequenceIndex` values are required to be
   * contiguous (dense) — a hole in the sequence (e.g. observed [1,2,5]) is the
   * signature of a dropped/withheld event during an RPC outage and is flagged
   * as a fail-closed discrepancy (B-RVP-003). Defaults to false because the
   * {@link ChainEvent} model does not universally guarantee dense indices;
   * operators ingesting a complete, contiguous chain opt in.
   */
  readonly requireContiguousSequence?: boolean;

  /**
   * Optional telemetry sink (B-RVP-001). When provided, one
   * `"multichain.audit"` event is emitted carrying low-cardinality
   * `{ verdict, chainCount, eventCount }` attributes. Side-channel only: it
   * never changes the verdict, and a throwing sink is swallowed.
   */
  readonly telemetry?: Telemetry;
}

// =============================================================================
// Multi-Chain Replay Auditor
// =============================================================================

/**
 * Compute the hash chain for a single chain's events.
 *
 * Each event's hash is chained: H(n) = SHA-256(H(n-1) + canonical(event))
 * The initial hash H(0) = SHA-256("genesis:" + chainId).
 */
export function computeChainHashChain(
  chainId: string,
  events: readonly ChainEvent[],
): ChainReplayResult {
  let currentHash = sha256(`genesis:${chainId}`);
  let firstHash = "";
  let lastHash = "";

  for (const event of events) {
    const eventCanonical = canonicalize({
      chainId: event.chainId,
      eventHash: event.eventHash,
      sequenceIndex: event.sequenceIndex,
      data: event.data,
    });

    currentHash = sha256(currentHash + eventCanonical);

    if (firstHash === "") {
      firstHash = currentHash;
    }
    lastHash = currentHash;
  }

  return {
    chainId,
    hashChain: currentHash,
    eventCount: events.length,
    firstEventHash: firstHash || currentHash,
    lastEventHash: lastHash || currentHash,
  };
}

/**
 * Compute the combined cross-chain hash from per-chain results.
 *
 * Sorts chain results by chainId for determinism, then combines
 * all hash chains into a single digest.
 */
export function computeCombinedHash(
  chainResults: readonly ChainReplayResult[],
): string {
  const sorted = [...chainResults].sort((a, b) =>
    a.chainId.localeCompare(b.chainId),
  );

  const combined = canonicalize({
    chains: sorted.map((r) => ({
      chainId: r.chainId,
      hashChain: r.hashChain,
      eventCount: r.eventCount,
    })),
  });

  return sha256(combined);
}

/**
 * Run a full multi-chain replay audit.
 *
 * Groups events by chain, computes per-chain hash chains,
 * then produces a combined cross-chain hash.
 *
 * Fail-closed under partial failure (B-RVP-003 / B-RVP-005):
 * - When `expectedChainIds` is supplied, an expected chain that produced zero
 *   events is a discrepancy (a dark observer must not read as "verified clean").
 * - When `requireContiguousSequence` is true, a gap in a chain's sequence
 *   indices is a discrepancy (a hole is the signature of a dropped event).
 *
 * @param events All events across all chains
 * @param optionsOrExpectedHash Either the expected combined hash (string, for
 *   backward compatibility) or a {@link MultiChainAuditOptions} object.
 * @returns MultiChainAuditResult
 */
export function auditMultiChainReplay(
  events: readonly ChainEvent[],
  optionsOrExpectedHash?: string | MultiChainAuditOptions,
): MultiChainAuditResult {
  // Normalize the overload: a bare string is the legacy expectedCombinedHash.
  const options: MultiChainAuditOptions =
    typeof optionsOrExpectedHash === "string"
      ? { expectedCombinedHash: optionsOrExpectedHash }
      : optionsOrExpectedHash ?? {};
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;

  // Group events by chain
  const byChain = new Map<string, ChainEvent[]>();
  for (const event of events) {
    const existing = byChain.get(event.chainId) ?? [];
    existing.push(event);
    byChain.set(event.chainId, existing);
  }

  // Sort events within each chain by sequence index
  for (const [, chainEvents] of byChain) {
    chainEvents.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  }

  const discrepancies: string[] = [];

  // Gap detection (B-RVP-003): only assert contiguity when the operator opts
  // in via requireContiguousSequence, because dense indices are not guaranteed
  // for every chain. A gap means an event between two observed indices was
  // dropped/withheld/not-yet-observed — fail-closed rather than silently pass.
  if (options.requireContiguousSequence === true) {
    for (const [chainId, chainEvents] of byChain) {
      for (let i = 1; i < chainEvents.length; i++) {
        const prev = chainEvents[i - 1]!;
        const curr = chainEvents[i]!;
        const gap = curr.sequenceIndex - prev.sequenceIndex;
        if (gap > 1) {
          discrepancies.push(
            `[MULTICHAIN_SEQUENCE_GAP] ${chainId}: possible missing event(s) between ` +
              `sequence ${prev.sequenceIndex} and ${curr.sequenceIndex} ` +
              `(${gap - 1} index(es) absent) — a gap is the signature of a dropped or ` +
              `withheld event; ingest the missing event(s) or audit the chain observer's coverage`,
          );
        }
      }
    }
  }

  // Compute per-chain hash chains
  const chainResults: ChainReplayResult[] = [];
  for (const [chainId, chainEvents] of byChain) {
    chainResults.push(computeChainHashChain(chainId, chainEvents));
  }

  // Coverage check (B-RVP-005): an expected chain with zero observed events
  // means an observer never delivered — 'audited nothing' must not read as
  // 'verified clean'. Sorted for deterministic discrepancy ordering.
  if (options.expectedChainIds && options.expectedChainIds.length > 0) {
    const missing = [...options.expectedChainIds]
      .filter((id) => (byChain.get(id)?.length ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));
    for (const chainId of missing) {
      discrepancies.push(
        `[MULTICHAIN_CHAIN_ABSENT] expected chain ${chainId} produced zero events — ` +
          `the observer may be dark or the chain was never ingested; ` +
          `a multi-chain audit must not PASS over a chain it never saw`,
      );
    }
  }

  // Compute combined hash
  const combinedHash = computeCombinedHash(chainResults);

  if (
    options.expectedCombinedHash &&
    combinedHash !== options.expectedCombinedHash
  ) {
    discrepancies.push(
      `[MULTICHAIN_HASH_MISMATCH] Combined hash mismatch: expected ` +
        `${options.expectedCombinedHash}, got ${combinedHash}`,
    );
  }

  const chainCount = chainResults.length;
  const eventCount = events.length;
  const verdict: "PASS" | "FAIL" =
    discrepancies.length === 0 ? "PASS" : "FAIL";

  // Observability (B-RVP-001): one structured event per audit. Counts are
  // low-cardinality and safe as metric labels; raw chain ids and the combined
  // hash (high-cardinality) stay in the message. Defensively guarded — a
  // throwing sink must never alter or abort the audit verdict.
  try {
    telemetry.record({
      package: "@attestia/verify",
      op: "multichain.audit",
      level: verdict === "PASS" ? "info" : "warn",
      outcome: verdict === "PASS" ? "ok" : "failed",
      attributes: { verdict, chainCount, eventCount },
      message:
        `multi-chain replay audit ${verdict.toLowerCase()}: ` +
        `${chainCount} chain(s), ${eventCount} event(s), ` +
        `${discrepancies.length} discrepancy(ies), combinedHash ${combinedHash}`,
    });
  } catch {
    /* a sink must not break the audit — see NOOP_TELEMETRY contract */
  }

  return {
    verdict,
    combinedHash,
    chains: chainResults,
    auditedAt: new Date().toISOString(),
    discrepancies,
    chainCount,
    eventCount,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}
