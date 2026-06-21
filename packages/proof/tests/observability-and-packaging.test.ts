/**
 * Stage C amend for @attestia/proof:
 * - B-RVP-001 observability: verifyAttestationProof(Detailed) emit a structured
 *   "proof.verify" event ({ valid, firstFailedCheck }), defensively guarded.
 * - B-RVP-008 humanization: packageAttestationProofResult names WHICH
 *   precondition failed (empty-tree / index-out-of-range /
 *   index-not-in-event-hashes), while the leaf-binding forgery boundary STILL
 *   throws. The legacy packageAttestationProof null contract is preserved.
 */
import { describe, it, expect } from "vitest";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import {
  MerkleTree,
  hashAttestation,
  packageAttestationProof,
  packageAttestationProofResult,
  verifyAttestationProof,
  verifyAttestationProofDetailed,
} from "../src/index.js";

function captureSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return { events, telemetry: { record: (e) => events.push(e) } };
}

const throwingSink: Telemetry = {
  record() {
    throw new Error("sink boom");
  },
};

const attestation = { id: "att-1", reportHash: "rh", value: 42 };
const leaf = hashAttestation(attestation);
const tree = MerkleTree.build([leaf]);

// =============================================================================
// B-RVP-001 — proof verification telemetry
// =============================================================================

describe("verifyAttestationProofDetailed observability (B-RVP-001)", () => {
  it("emits a proof.verify ok event when the package is valid", () => {
    const { telemetry, events } = captureSink();
    const pkg = packageAttestationProof(attestation, [leaf], tree, 0)!;

    const result = verifyAttestationProofDetailed(pkg, telemetry);
    expect(result.valid).toBe(true);

    const e = events.find((ev) => ev.op === "proof.verify")!;
    expect(e.package).toBe("@attestia/proof");
    expect(e.outcome).toBe("ok");
    expect(e.attributes).toMatchObject({ valid: true, firstFailedCheck: "none" });
  });

  it("emits a failed event naming the first failed check (forgery indicator)", () => {
    const { telemetry, events } = captureSink();
    const pkg = packageAttestationProof(attestation, [leaf], tree, 0)!;
    // Tamper the attestation so the hash-recompute check fails first.
    const forged = { ...pkg, attestation: { ...attestation, value: 999 } };

    const result = verifyAttestationProofDetailed(forged, telemetry);
    expect(result.valid).toBe(false);

    const e = events.find((ev) => ev.op === "proof.verify")!;
    expect(e.outcome).toBe("failed");
    expect(e.attributes!.valid).toBe(false);
    expect(e.attributes!.firstFailedCheck).toBe("attestation-hash-recompute");
    expect(e.message).toMatch(/possible forgery/i);
  });

  it("verifyAttestationProof forwards the sink and stays boolean", () => {
    const { telemetry, events } = captureSink();
    const pkg = packageAttestationProof(attestation, [leaf], tree, 0)!;
    expect(verifyAttestationProof(pkg, telemetry)).toBe(true);
    expect(events.some((e) => e.op === "proof.verify")).toBe(true);
  });

  it("a throwing sink never changes the result (defensively guarded)", () => {
    const pkg = packageAttestationProof(attestation, [leaf], tree, 0)!;
    expect(() => verifyAttestationProofDetailed(pkg, throwingSink)).not.toThrow();
    expect(verifyAttestationProofDetailed(pkg, throwingSink).valid).toBe(true);
  });

  it("emits nothing and verifies identically with the default no-op sink", () => {
    const pkg = packageAttestationProof(attestation, [leaf], tree, 0)!;
    expect(verifyAttestationProofDetailed(pkg).valid).toBe(true);
  });
});

// =============================================================================
// B-RVP-008 — structured packaging result
// =============================================================================

describe("packageAttestationProofResult humanization (B-RVP-008)", () => {
  it("returns ok:true with the package on success", () => {
    const result = packageAttestationProofResult(attestation, [leaf], tree, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(verifyAttestationProof(result.package)).toBe(true);
    }
  });

  it("names 'empty-tree' for an empty Merkle tree", () => {
    const result = packageAttestationProofResult({}, [], MerkleTree.build([]), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty-tree");
      expect(result.detail).toMatch(/empty/i);
    }
  });

  it("names 'index-out-of-range' for an unprovable index", () => {
    const result = packageAttestationProofResult(attestation, [leaf], tree, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("index-out-of-range");
      expect(result.detail).toMatch(/out of range/i);
    }
  });

  it("names 'index-not-in-event-hashes' when the tree/eventHashes lengths disagree", () => {
    // Build a 2-leaf tree but pass a 1-element eventHashes: index 1 is provable
    // in the tree yet absent from eventHashes.
    const leaf2 = hashAttestation({ id: "att-2" });
    const twoLeafTree = MerkleTree.build([leaf, leaf2]);
    const result = packageAttestationProofResult(attestation, [leaf], twoLeafTree, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("index-not-in-event-hashes");
      expect(result.detail).toMatch(/out of sync/i);
    }
  });

  it("STILL throws on the leaf-binding mismatch (forgery boundary preserved)", () => {
    const wrong = { id: "wrong" };
    const eventHashes = [hashAttestation(wrong), leaf];
    const tree2 = MerkleTree.build(eventHashes);
    // Ask to package `attestation` at index 0, where the stored hash is `wrong`.
    expect(() =>
      packageAttestationProofResult(attestation, eventHashes, tree2, 0),
    ).toThrow(/does not match the attestation/i);
  });

  it("legacy packageAttestationProof preserves the null contract for all three soft causes", () => {
    expect(packageAttestationProof({}, [], MerkleTree.build([]), 0)).toBeNull();
    expect(packageAttestationProof(attestation, [leaf], tree, 5)).toBeNull();
    const twoLeafTree = MerkleTree.build([leaf, hashAttestation({ id: "z" })]);
    expect(packageAttestationProof(attestation, [leaf], twoLeafTree, 1)).toBeNull();
  });
});
