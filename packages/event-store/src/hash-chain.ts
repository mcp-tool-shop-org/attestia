/**
 * @attestia/event-store — Hash chain for tamper-evident event logs.
 *
 * Each event is hashed using RFC 8785 (JCS) canonicalization + SHA-256.
 * The hash includes the previous event's hash, forming a chain:
 *
 *   event[0].hash = sha256(canonicalize(event[0]) + "genesis")
 *   event[n].hash = sha256(canonicalize(event[n]) + event[n-1].hash)
 *
 * Any modification to any event breaks the chain from that point forward.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import type { StoredEvent } from "./types.js";
import type { EventStoreIntegrityResult, IntegrityError } from "./types.js";

/**
 * The hash used as `previousHash` for the first event in the chain.
 */
export const GENESIS_HASH = "genesis";

/**
 * Compute the canonical content of a StoredEvent for hashing.
 *
 * Extracts the structural fields (event body + store metadata) and
 * canonicalizes them with RFC 8785. Wall-clock fields (appendedAt)
 * are included because they are part of the persisted record.
 */
function canonicalEventContent(event: StoredEvent): string {
  return canonicalize({
    event: {
      type: event.event.type,
      metadata: event.event.metadata,
      payload: event.event.payload,
    },
    streamId: event.streamId,
    version: event.version,
    globalPosition: event.globalPosition,
    appendedAt: event.appendedAt,
  });
}

/**
 * Compute the SHA-256 hash of an event given its predecessor's hash.
 *
 * @param event - The stored event to hash
 * @param previousHash - Hash of the preceding event, or GENESIS_HASH for position 1
 * @returns Hex-encoded SHA-256 hash
 */
export function computeEventHash(
  event: StoredEvent,
  previousHash: string,
): string {
  const content = canonicalEventContent(event);
  const input = content + previousHash;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Verify the hash chain of a sequence of events.
 *
 * Events must be in global position order. Events without `hash` or
 * `previousHash` fields (pre-chain events from older JSONL files) are
 * skipped — chain verification starts from the first hashed event.
 *
 * Head-truncation defense (A-ES-002): once ANY hashed event exists in the
 * sequence, the FIRST hashed event MUST anchor at {@link GENESIS_HASH}. A
 * leading unhashed (pre-chain) line can no longer relax this — otherwise an
 * attacker with file-write could drop the leading hashed events of a chain and
 * prepend a single unhashed line to make the truncated tail's self-claimed
 * `previousHash` be silently adopted as the anchor. The only chains that may
 * legitimately lack a hashed genesis are *fully* legacy (all events unhashed);
 * a genuine legacy→hashed transition still anchors the first hashed event at
 * genesis, because the store has no prior hash to chain from at that point.
 *
 * Additionally, globalPosition contiguity is asserted across the whole
 * sequence (no gaps), so head/middle truncation cannot hide behind a
 * re-based prefix.
 *
 * @param events - Events in global position order
 * @returns Integrity result with any chain breaks
 */
export function verifyHashChain(
  events: readonly StoredEvent[],
): EventStoreIntegrityResult {
  if (events.length === 0) {
    return { valid: true, lastVerifiedPosition: 0, errors: [] };
  }

  const errors: IntegrityError[] = [];
  let lastVerifiedPosition = 0;
  let previousHash = GENESIS_HASH;
  let chainStarted = false;
  // NOTE (A-ES-002): there is intentionally no `sawPreChainEvent` relaxation
  // anymore. A leading unhashed line MUST NOT weaken the genesis-anchor
  // requirement — the first hashed event is enforced to anchor at genesis
  // below, regardless of any pre-chain lines that precede it.

  // globalPosition contiguity: positions must increase by exactly 1 with no
  // gaps. A gap is evidence of a dropped (truncated) record. We check this
  // independently of the hash chain so it also covers all-legacy files.
  let expectedPosition: number | undefined;

  for (const event of events) {
    const record = event as StoredEvent & {
      hash?: string;
      previousHash?: string;
    };

    // Contiguity check — applies to every event regardless of hashing.
    if (expectedPosition !== undefined && event.globalPosition !== expectedPosition) {
      errors.push({
        position: event.globalPosition,
        reason: `globalPosition is not contiguous: expected ${expectedPosition}, got ${event.globalPosition} — possible truncation or reordering`,
      });
    }
    expectedPosition = event.globalPosition + 1;

    // Skip pre-chain events (no hash field)
    if (record.hash === undefined || record.previousHash === undefined) {
      // If chain hasn't started yet, continue looking for first hashed event
      if (!chainStarted) {
        continue;
      }
      // Chain was started but this event lacks hash — break
      errors.push({
        position: event.globalPosition,
        reason: `Event at position ${event.globalPosition} is missing hash fields within a hashed chain`,
      });
      continue;
    }

    if (!chainStarted) {
      // First hashed event. Because a hashed event exists in this sequence,
      // the chain MUST begin at genesis — otherwise head-truncation (dropping
      // the leading events of the chain) is undetectable, because a truncated
      // head's previousHash would simply be adopted as the anchor. A leading
      // unhashed line does NOT grant an exemption (A-ES-002): a genuine
      // legacy→hashed transition still anchors the first hashed event at
      // genesis, since the store had no prior hash to chain from there.
      chainStarted = true;
      if (record.previousHash !== GENESIS_HASH) {
        errors.push({
          position: event.globalPosition,
          reason: `chain does not start at genesis: first hashed event at position ${event.globalPosition} has previousHash "${record.previousHash}", expected GENESIS_HASH ("${GENESIS_HASH}") — possible head truncation`,
        });
        // Adopt the claimed predecessor as the anchor to avoid cascading false
        // positives after the genesis error above; the chain is already flagged
        // invalid by the error we just pushed.
        previousHash = record.previousHash;
      } else {
        previousHash = GENESIS_HASH;
      }
    }

    // Verify previousHash links to predecessor
    const isPreviousHashBreak = record.previousHash !== previousHash;
    if (isPreviousHashBreak) {
      errors.push({
        position: event.globalPosition,
        reason: `previousHash mismatch at position ${event.globalPosition}: expected "${previousHash}", got "${record.previousHash}"`,
      });
    }

    // Recompute hash and verify
    const expectedHash = computeEventHash(event, record.previousHash);
    if (record.hash !== expectedHash) {
      errors.push({
        position: event.globalPosition,
        reason: `Hash mismatch at position ${event.globalPosition}: expected "${expectedHash}", got "${record.hash}"`,
      });
    }

    // Continue with the actual stored hash to avoid cascading false positives
    previousHash = record.hash;
    lastVerifiedPosition = event.globalPosition;
  }

  return {
    valid: errors.length === 0,
    lastVerifiedPosition,
    errors,
  };
}
