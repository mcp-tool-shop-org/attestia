/**
 * Merkle Domain Separation Tests (D5-A-002, RFC 6962-style).
 *
 * Without domain separation between leaves and internal nodes, a Merkle
 * tree is vulnerable to second-preimage attacks:
 *
 *  - An attacker who knows two adjacent leaves L, R can present the
 *    INTERNAL digest H(L||R) as if it were a single-leaf hash, producing
 *    a valid "single-leaf" proof for data that was never a real leaf.
 *  - Two differently-shaped trees can be coerced to share a root.
 *
 * Fix: tagged hashing — leaf = SHA-256(0x00 || leafBytes),
 * parent = SHA-256(0x01 || left || right). Build and verifyProof must
 * apply the same tags, so a leaf digest can never equal an internal one.
 *
 * Full invariant per test: the legitimate proof verifies AND the
 * second-preimage / collision forgery is REJECTED.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MerkleTree } from "../src/merkle-tree.js";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Untagged binary pair hash — the OLD internal-node construction. */
function untaggedPair(left: string, right: string): string {
  const buf = Buffer.allocUnsafe(64);
  buf.set(Buffer.from(left, "hex"), 0);
  buf.set(Buffer.from(right, "hex"), 32);
  return createHash("sha256").update(buf).digest("hex");
}

function makeLeaves(count: number): string[] {
  return Array.from({ length: count }, (_, i) => sha256(`leaf-${i}`));
}

describe("Merkle domain separation (D5-A-002)", () => {
  it("legitimate single-leaf and multi-leaf proofs still verify", () => {
    // Baseline: the fix must not break honest proofs.
    const single = MerkleTree.build([sha256("only")]);
    expect(MerkleTree.verifyProof(single.getProof(0)!)).toBe(true);

    const tree = MerkleTree.build(makeLeaves(4));
    for (let i = 0; i < 4; i++) {
      expect(MerkleTree.verifyProof(tree.getProof(i)!)).toBe(true);
    }
  });

  it("an internal-node digest cannot be presented as a single-leaf proof", () => {
    // Two real leaves and their UNTAGGED internal parent digest.
    const [l, r] = makeLeaves(2) as [string, string];
    const internalDigest = untaggedPair(l, r);

    // A two-leaf tree's root, under the OLD construction, equalled
    // untaggedPair(l, r). An attacker crafts a "single-leaf" proof whose
    // leafHash is that internal digest and whose root is the same digest
    // (single-leaf proofs have no siblings → leaf IS root).
    const forged = {
      leafHash: internalDigest,
      leafIndex: 0,
      siblings: [] as const,
      root: internalDigest,
    };

    // With domain separation, a single-leaf root is H(0x00 || leaf), which
    // can never equal an untagged internal digest → forgery REJECTED.
    expect(MerkleTree.verifyProof(forged)).toBe(false);

    // And the real two-leaf tree no longer has that internal digest as root.
    const realTree = MerkleTree.build([l, r]);
    expect(realTree.getRoot()).not.toBe(internalDigest);
  });

  it("a single-leaf root is NOT the raw leaf (leaf is tagged)", () => {
    const leaf = sha256("solo");
    const tree = MerkleTree.build([leaf]);
    // Under domain separation the root is H(0x00 || leaf), not the leaf.
    expect(tree.getRoot()).not.toBe(leaf);
    expect(tree.getRoot()!.length).toBe(64);
  });

  it("differently-shaped trees do not share a root", () => {
    // Classic shape-collision: a 2-leaf tree whose leaves are themselves the
    // roots of two 2-leaf subtrees, vs a 4-leaf tree over the same base data.
    const base = makeLeaves(4) as [string, string, string, string];

    // Shape A: flat 4-leaf tree.
    const flat = MerkleTree.build(base);

    // Shape B: build the two subtree roots first, then a 2-leaf tree over them.
    const leftRoot = MerkleTree.build([base[0], base[1]]).getRoot()!;
    const rightRoot = MerkleTree.build([base[2], base[3]]).getRoot()!;
    const nested = MerkleTree.build([leftRoot, rightRoot]);

    // Without leaf/internal separation these collide; with it they must not.
    expect(flat.getRoot()).not.toBe(nested.getRoot());
  });
});
