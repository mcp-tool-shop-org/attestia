/**
 * Edge/defensive-branch coverage for @attestia/proof.
 *
 * Exercises the failure-path branches that the happy-path/forgery tests don't:
 * the malformed-proof catch in verifyAttestationProofDetailed, the over-long
 * invalid-hash guard, the empty-tree root, and the defensive leaf-binding throw
 * in packageAttestationProof (only reachable when a tree lies about its proof).
 */
import { describe, it, expect } from "vitest";
import {
  MerkleTree,
  packageAttestationProof,
  verifyAttestationProofDetailed,
  hashAttestation,
} from "../src/index.js";
import type { AttestationProofPackage } from "../src/types.js";

const attestation = { id: "att-edge-1", reportHash: "report-hash", value: 42 };
const leaf = hashAttestation(attestation);
const tree = MerkleTree.build([leaf]);
const validPkg = packageAttestationProof(attestation, [leaf], tree, 0);

describe("proof edge branches", () => {
  it("has a valid baseline package", () => {
    expect(validPkg).not.toBeNull();
    expect(verifyAttestationProofDetailed(validPkg!).valid).toBe(true);
  });

  it("verifyAttestationProofDetailed catches a malformed inclusion proof instead of throwing", () => {
    // A non-hex sibling makes MerkleTree.verifyProof throw; the detailed verifier
    // must report merkle-inclusion as a FAILED check (catch branch), not throw.
    const malformed = {
      ...validPkg!,
      inclusionProof: {
        ...validPkg!.inclusionProof,
        siblings: [{ hash: "not-a-valid-hash", direction: "left" }],
      },
    } as unknown as AttestationProofPackage;

    const result = verifyAttestationProofDetailed(malformed);
    const merkle = result.checks.find((c) => c.name === "merkle-inclusion");
    expect(merkle?.passed).toBe(false);
    expect(merkle?.detail).toMatch(/malformed/i);
    expect(result.valid).toBe(false);
  });

  it("rejects an over-long invalid hash (truncated in the error message)", () => {
    const overLong = "z".repeat(200);
    expect(() =>
      MerkleTree.verifyProof({
        leafHash: overLong,
        leafIndex: 0,
        siblings: [],
        root: overLong,
      }),
    ).toThrow(/Invalid SHA-256 hex/);
  });

  it("an empty tree has a null root", () => {
    expect(MerkleTree.build([]).getRoot()).toBeNull();
  });

  it("packageAttestationProof refuses to mint a package whose proof leaf is not the attestation hash", () => {
    // A tree that returns a proof whose leafHash differs from the attestation's
    // own hash (cannot happen with a real tree, but the binding is defensive).
    const lyingTree = {
      getRoot: () => "a".repeat(64),
      getProof: () => ({
        leafHash: "b".repeat(64),
        leafIndex: 0,
        siblings: [],
        root: "a".repeat(64),
      }),
    } as unknown as MerkleTree;

    expect(() =>
      packageAttestationProof(attestation, [leaf], lyingTree, 0),
    ).toThrow(/leafHash/i);
  });
});
