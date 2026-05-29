/**
 * Property-based tests for hash chain integrity.
 *
 * Uses fast-check to verify invariants:
 * 1. Any N events → valid chain
 * 2. Remove any event → breaks chain
 * 3. Modify any field → breaks chain
 * 4. verifyIntegrity() is idempotent
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { InMemoryEventStore } from "../src/in-memory-store.js";
import { verifyHashChain } from "../src/hash-chain.js";
import type { StoredEvent } from "../src/types.js";
import type { DomainEvent } from "@attestia/types";

// =============================================================================
// Arbitraries
// =============================================================================

const arbDomainEvent: fc.Arbitrary<DomainEvent> = fc.record({
  type: fc.constantFrom(
    "test.created",
    "test.updated",
    "test.deleted",
    "test.processed",
  ),
  metadata: fc.dictionary(fc.string(), fc.jsonValue()).map(
    (d) => d as Record<string, unknown>,
  ),
  payload: fc.dictionary(fc.string(), fc.jsonValue()).map(
    (d) => d as Record<string, unknown>,
  ),
});

// =============================================================================
// Tests
// =============================================================================

describe("hash chain property tests", () => {
  it("any N events produce a valid chain", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 1, maxLength: 20 }),
        (events) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const result = store.verifyIntegrity();
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("removing any event from the middle breaks the chain", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 3, maxLength: 10 }),
        fc.nat(),
        (events, removeIndex) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const allEvents = store.readAll() as StoredEvent[];
          // Remove an event from the middle (not first, not last)
          const idx = 1 + (removeIndex % (allEvents.length - 2));
          const tampered = [
            ...allEvents.slice(0, idx),
            ...allEvents.slice(idx + 1),
          ];

          const result = verifyHashChain(tampered);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 30 },
    );
  });

  // D2-A-005: head-truncation must be detectable. A fully-hashed chain MUST
  // begin at genesis; removing the first event (or any leading run) leaves a
  // chain whose first event's previousHash is no longer GENESIS_HASH.
  it("removing the FIRST event breaks the chain (head truncation)", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 2, maxLength: 10 }),
        (events) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const allEvents = store.readAll() as StoredEvent[];
          // Drop the head — the new first event's previousHash is the dropped
          // event's hash, not GENESIS_HASH.
          const tampered = allEvents.slice(1);

          const result = verifyHashChain(tampered);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("removing a leading run of events breaks the chain", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 4, maxLength: 12 }),
        fc.nat(),
        (events, dropCount) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const allEvents = store.readAll() as StoredEvent[];
          // Drop a leading run of 1..len-1 events.
          const n = 1 + (dropCount % (allEvents.length - 1));
          const tampered = allEvents.slice(n);

          const result = verifyHashChain(tampered);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("removing a trailing run still validates the surviving prefix", () => {
    // Removing the TAIL is legitimate append-truncation from the chain's POV:
    // the surviving prefix still starts at genesis and links correctly, so the
    // hash chain alone reports valid. (Detecting tail loss is the store's job
    // via globalPosition/length, not verifyHashChain's.) This guards against an
    // over-eager genesis check that would false-positive on a valid prefix.
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 4, maxLength: 12 }),
        fc.nat(),
        (events, dropCount) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const allEvents = store.readAll() as StoredEvent[];
          const keep = allEvents.length - (1 + (dropCount % (allEvents.length - 1)));
          const tampered = allEvents.slice(0, keep);

          const result = verifyHashChain(tampered);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("flipping the first event's previousHash away from genesis breaks the chain", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 1, maxLength: 10 }),
        (events) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const allEvents = [...store.readAll()] as Array<
            StoredEvent & { hash: string; previousHash: string }
          >;
          // Point the genesis event at a fabricated predecessor.
          allEvents[0] = {
            ...allEvents[0]!,
            previousHash: "f".repeat(64),
          };

          const result = verifyHashChain(allEvents);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.position === allEvents[0]!.globalPosition)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("modifying any event payload breaks the chain", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 2, maxLength: 8 }),
        fc.nat(),
        (events, modifyIndex) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const allEvents = [...store.readAll()] as StoredEvent[];
          const idx = modifyIndex % allEvents.length;

          // Tamper with the event payload
          const original = allEvents[idx]!;
          allEvents[idx] = {
            ...original,
            event: {
              ...original.event,
              payload: { ...original.event.payload, tampered: true },
            },
          };

          const result = verifyHashChain(allEvents);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("verifyIntegrity is idempotent", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 1, maxLength: 10 }),
        (events) => {
          const store = new InMemoryEventStore();
          store.append("stream", events);

          const r1 = store.verifyIntegrity();
          const r2 = store.verifyIntegrity();
          const r3 = store.verifyIntegrity();

          expect(r1.valid).toBe(r2.valid);
          expect(r2.valid).toBe(r3.valid);
          expect(r1.lastVerifiedPosition).toBe(r2.lastVerifiedPosition);
          expect(r2.lastVerifiedPosition).toBe(r3.lastVerifiedPosition);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("appending to separate streams still produces valid global chain", () => {
    fc.assert(
      fc.property(
        fc.array(arbDomainEvent, { minLength: 1, maxLength: 5 }),
        fc.array(arbDomainEvent, { minLength: 1, maxLength: 5 }),
        (eventsA, eventsB) => {
          const store = new InMemoryEventStore();
          store.append("stream-a", eventsA);
          store.append("stream-b", eventsB);

          const result = store.verifyIntegrity();
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
