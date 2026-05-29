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
  // Track whether any pre-chain (unhashed) event preceded the first hashed
  // event. A chain that starts fresh MUST anchor at genesis; a chain that
  // follows legacy pre-chain events has no cryptographic predecessor to verify
  // against, so the first hashed link is adopted as the anchor.
  let sawPreChainEvent = false;

  for (const event of events) {
    const record = event as StoredEvent & {
      hash?: string;
      previousHash?: string;
    };

    // Skip pre-chain events (no hash field)
    if (record.hash === undefined || record.previousHash === undefined) {
      // If chain hasn't started yet, continue looking for first hashed event
      if (!chainStarted) {
        sawPreChainEvent = true;
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
      // First hashed event. A fully-hashed store MUST begin at genesis —
      // otherwise head-truncation (dropping the leading events of the chain)
      // is undetectable, because a truncated head's previousHash would simply
      // be adopted as the anchor. Only when genuine legacy pre-chain events
      // precede this event is a non-genesis anchor permitted (those events
      // carry no hash, so the link cannot be verified cryptographically).
      chainStarted = true;
      if (record.previousHash !== GENESIS_HASH) {
        if (!sawPreChainEvent) {
          errors.push({
            position: event.globalPosition,
            reason: `chain does not start at genesis: first hashed event at position ${event.globalPosition} has previousHash "${record.previousHash}", expected GENESIS_HASH ("${GENESIS_HASH}") — possible head truncation`,
          });
        }
        // Adopt the claimed predecessor as the anchor (legacy-compat path, or
        // to avoid cascading false positives after the genesis error above).
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
