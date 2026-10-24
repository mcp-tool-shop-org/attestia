/**
 * Stored Event Merkle Leaf Binding Tests (Phase 1 PR 1 — Attestia b)
 *
 * Verifies that `hashStoredEventLeaf` binds the full store envelope
 * (`globalPosition`, `streamId`, `version`, `appendedAt`, `hash`, `previousHash`)
 * together with `event` (`type`, `metadata`, `payload`) into the Merkle leaf,
 * while keeping `hashAttestation` byte-identical for existing callers.
 */

import { describe, it, expect } from "vitest";
import { MerkleTree } from "../src/merkle-tree.js";
import {
  hashAttestation,
  hashStoredEventLeaf,
  type StoredEventLeafInput,
} from "../src/index.js";

function makeStoredEvent(
  overrides: Partial<StoredEventLeafInput> = {},
): StoredEventLeafInput {
  return {
    event: {
      type: "cognate.model.transitioned",
      metadata: {
        eventId: "c2c94d60-5766-4226-af68-8f78e3993245",
        timestamp: "2026-10-24T00:35:00.000Z",
        actor: "publisher",
        correlationId: "window-19a-19r-decision",
        source: "cognate",
      },
      payload: {
        modelVersionId: "verdict-prompt-B-defined",
        from: "registered",
        to: "evaluated",
      },
    },
    streamId: "cognate-default-transitions",
    version: 1,
    globalPosition: 17,
    appendedAt: "2026-10-24T05:09:57.704Z",
    hash: "b88c024c6b77f8a1e72b96150985c6b08a9e2b3309cf2a3d9f12c9207424a3f1",
    previousHash: "841c81f5831fbef616f748e1b0d1464dad74c0172150309a23a428c35d9262db",
    ...overrides,
  };
}

describe("hashStoredEventLeaf", () => {
  it("produces a deterministic 64-char lowercase SHA-256 hex digest", () => {
    const stored = makeStoredEvent();
    const leaf = hashStoredEventLeaf(stored);
    expect(leaf).toMatch(/^[0-9a-f]{64}$/);
    expect(hashStoredEventLeaf(stored)).toBe(leaf);
  });

  it("binds globalPosition, streamId, version, appendedAt, hash, and previousHash into the leaf", () => {
    const base = makeStoredEvent();
    const baseLeaf = hashStoredEventLeaf(base);

    // Mutating any store-envelope field must change the leaf digest
    expect(hashStoredEventLeaf(makeStoredEvent({ globalPosition: 999 }))).not.toBe(baseLeaf);
    expect(
      hashStoredEventLeaf(makeStoredEvent({ streamId: "cognate-other-transitions" })),
    ).not.toBe(baseLeaf);
    expect(hashStoredEventLeaf(makeStoredEvent({ version: 2 }))).not.toBe(baseLeaf);
    expect(
      hashStoredEventLeaf(makeStoredEvent({ appendedAt: "2026-10-24T06:00:00.000Z" })),
    ).not.toBe(baseLeaf);
    expect(hashStoredEventLeaf(makeStoredEvent({ hash: "a".repeat(64) }))).not.toBe(baseLeaf);
    expect(hashStoredEventLeaf(makeStoredEvent({ previousHash: "f".repeat(64) }))).not.toBe(
      baseLeaf,
    );
  });

  it("also binds event.type, event.metadata, and event.payload into the leaf", () => {
    const base = makeStoredEvent();
    const baseLeaf = hashStoredEventLeaf(base);

    expect(
      hashStoredEventLeaf(
        makeStoredEvent({
          event: { ...base.event, type: "cognate.run.completed" },
        }),
      ),
    ).not.toBe(baseLeaf);

    expect(
      hashStoredEventLeaf(
        makeStoredEvent({
          event: {
            ...base.event,
            metadata: { ...base.event.metadata, actor: "other-actor" },
          },
        }),
      ),
    ).not.toBe(baseLeaf);

    expect(
      hashStoredEventLeaf(
        makeStoredEvent({
          event: {
            ...base.event,
            payload: { ...base.event.payload, to: "approved" },
          },
        }),
      ),
    ).not.toBe(baseLeaf);
  });

  it("integrates with MerkleTree inclusion proofs and rejects envelope-tampered events", () => {
    const ev1 = makeStoredEvent({
      globalPosition: 1,
      version: 1,
      previousHash: "genesis",
      hash: "1".repeat(64),
    });
    const ev2 = makeStoredEvent({
      globalPosition: 2,
      version: 2,
      previousHash: "1".repeat(64),
      hash: "2".repeat(64),
    });

    const leaves = [hashStoredEventLeaf(ev1), hashStoredEventLeaf(ev2)];
    const tree = MerkleTree.build(leaves);
    const proof = tree.getProof(1)!;

    expect(MerkleTree.verifyProof(proof)).toBe(true);

    // Tampering globalPosition or streamId on ev2 produces a different leafHash
    // that fails verification against the anchored proof root
    const tamperedEv2 = makeStoredEvent({
      globalPosition: 99,
      version: 2,
      streamId: "cognate-other-transitions",
      previousHash: "f".repeat(64),
      hash: "2".repeat(64),
    });
    const tamperedLeaf = hashStoredEventLeaf(tamperedEv2);
    expect(MerkleTree.verifyProof({ ...proof, leafHash: tamperedLeaf })).toBe(false);
  });

  it("keeps hashAttestation byte-identical for existing callers", () => {
    const recordedEvent = {
      type: "cognate.model.transitioned",
      metadata: {
        eventId: "c2c94d60-5766-4226-af68-8f78e3993245",
        timestamp: "2026-10-24T00:35:00.000Z",
        actor: "publisher",
        correlationId: "window-19a-19r-decision",
        source: "external" as const,
      },
      payload: {
        modelVersionId: "verdict-prompt-B-defined",
        from: "registered",
        to: "evaluated",
      },
    };
    expect(hashAttestation(recordedEvent)).toBe(
      "31d36b5b1b65f41a53f956c66826a3af728fcd6d257f3597949f1fea829512b6",
    );
  });

  it("throws when required store-envelope fields are missing or invalid", () => {
    expect(() =>
      hashStoredEventLeaf(null as unknown as StoredEventLeafInput),
    ).toThrow(/stored event must be an object/);
    expect(() =>
      hashStoredEventLeaf({
        ...makeStoredEvent(),
        event: null as unknown as StoredEventLeafInput["event"],
      }),
    ).toThrow(/stored event must be an object/);
    expect(() =>
      hashStoredEventLeaf(makeStoredEvent({ streamId: "" })),
    ).toThrow(/streamId must be a non-empty string/);
    expect(() =>
      hashStoredEventLeaf(makeStoredEvent({ version: 0 })),
    ).toThrow(/version must be a positive integer/);
    expect(() =>
      hashStoredEventLeaf(makeStoredEvent({ globalPosition: 0 })),
    ).toThrow(/globalPosition must be a positive integer/);
    expect(() =>
      hashStoredEventLeaf(makeStoredEvent({ appendedAt: "" })),
    ).toThrow(/appendedAt must be a non-empty ISO timestamp string/);
    expect(() =>
      hashStoredEventLeaf(makeStoredEvent({ hash: "" })),
    ).toThrow(/hash must be a non-empty string/);
    expect(() =>
      hashStoredEventLeaf(makeStoredEvent({ previousHash: "" })),
    ).toThrow(/previousHash must be a non-empty string/);
  });
});
