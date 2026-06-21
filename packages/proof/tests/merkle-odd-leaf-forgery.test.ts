/**
 * Merkle Odd-Leaf Forgery Tests (A-PROOF-001, CVE-2012-2459 class).
 *
 * The classic Bitcoin/Merkle vulnerability: when a tree level has an ODD
 * node count and the last node is paired with ITSELF, the trees built over
 * [a, b, c] and [a, b, c, c] collapse to the SAME root. An attacker can then
 * mint a valid inclusion proof for a phantom duplicated leaf (index 3) that
 * verifies against a genuinely published root — an inclusion-proof forgery.
 *
 * Fix: RFC 6962 (Certificate Transparency) odd-node PROMOTION — the last
 * unpaired node is carried UP to the next level UNCHANGED (never hashed with
 * itself). The tree shape becomes unambiguous and the collision disappears.
 *
 * These tests pin the invariant: the two shapes MUST NOT share a root, and a
 * phantom index-3 proof built over [a, b, c, c] MUST NOT verify against the
 * [a, b, c] root.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MerkleTree } from "../src/merkle-tree.js";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("Merkle odd-leaf forgery (A-PROOF-001, CVE-2012-2459)", () => {
  it("build([a,b,c]) and build([a,b,c,c]) must NOT share a root", () => {
    const a = sha256("leaf-a");
    const b = sha256("leaf-b");
    const c = sha256("leaf-c");

    const honest = MerkleTree.build([a, b, c]);
    const padded = MerkleTree.build([a, b, c, c]);

    // Under self-duplication these collide (the bug). Under RFC 6962
    // promotion the 3-leaf tree carries `c` up unchanged while the 4-leaf
    // tree hashes the trailing c||c pair — so the roots diverge.
    expect(padded.getRoot()).not.toBe(honest.getRoot());
  });

  it("a phantom index-3 proof over [a,b,c,c] does NOT verify against the [a,b,c] root", () => {
    const a = sha256("leaf-a");
    const b = sha256("leaf-b");
    const c = sha256("leaf-c");

    const honest = MerkleTree.build([a, b, c]);
    const honestRoot = honest.getRoot()!;

    // Attacker builds the 4-leaf padded tree and forges an inclusion proof
    // for the phantom duplicated leaf at index 3, then re-points it at the
    // genuinely published 3-leaf root.
    const padded = MerkleTree.build([a, b, c, c]);
    const phantomProof = padded.getProof(3)!;
    const forged = { ...phantomProof, root: honestRoot };

    // The forgery must be rejected.
    expect(MerkleTree.verifyProof(forged)).toBe(false);
  });

  it("honest proofs over both shapes still verify against their own roots", () => {
    const a = sha256("leaf-a");
    const b = sha256("leaf-b");
    const c = sha256("leaf-c");

    const honest = MerkleTree.build([a, b, c]);
    for (let i = 0; i < 3; i++) {
      expect(MerkleTree.verifyProof(honest.getProof(i)!)).toBe(true);
    }

    const padded = MerkleTree.build([a, b, c, c]);
    for (let i = 0; i < 4; i++) {
      expect(MerkleTree.verifyProof(padded.getProof(i)!)).toBe(true);
    }
  });
});
