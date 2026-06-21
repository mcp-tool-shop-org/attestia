/**
 * Merkle Tree Tests
 *
 * Verifies:
 * - Build from various leaf counts (0, 1, 2, 3, 4, 7, 8, 1000)
 * - Proof generation + verification for each leaf
 * - Tampered proof fails
 * - Tampered leaf fails
 * - Wrong root fails
 * - Empty tree
 * - Deterministic (same leaves → same root)
 * - Power-of-2 vs non-power-of-2
 * - Root changes when any leaf changes
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MerkleTree } from "../src/merkle-tree.js";

// =============================================================================
// Helpers
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Tag a leaf the same way production code does (RFC 6962 domain separation).
 * leaf = SHA-256(0x00 || leafBytes).
 */
function hashLeaf(leaf: string): string {
  const buf = Buffer.allocUnsafe(33);
  buf[0] = 0x00;
  buf.set(Buffer.from(leaf, "hex"), 1);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Hash pair using the same tagged construction as production code.
 * parent = SHA-256(0x01 || leftBytes || rightBytes) — both children are
 * 32-byte digests. The 0x01 tag domain-separates internal nodes from leaves.
 */
function hashPair(left: string, right: string): string {
  const buf = Buffer.allocUnsafe(65);
  buf[0] = 0x01;
  buf.set(Buffer.from(left, "hex"), 1);
  buf.set(Buffer.from(right, "hex"), 33);
  return createHash("sha256").update(buf).digest("hex");
}

/** Generate N distinct leaf hashes */
function makeLeaves(count: number): string[] {
  return Array.from({ length: count }, (_, i) => sha256(`leaf-${i}`));
}

// =============================================================================
// Construction
// =============================================================================

describe("MerkleTree construction", () => {
  it("empty tree has null root", () => {
    const tree = MerkleTree.build([]);
    expect(tree.getRoot()).toBeNull();
    expect(tree.getLeafCount()).toBe(0);
  });

  it("single leaf — root is the TAGGED leaf (domain separation)", () => {
    const leaf = sha256("only-one");
    const tree = MerkleTree.build([leaf]);

    // With RFC 6962 domain separation the single-leaf root is H(0x00 || leaf),
    // never the raw leaf — so it cannot be confused with an internal node.
    expect(tree.getRoot()).toBe(hashLeaf(leaf));
    expect(tree.getRoot()).not.toBe(leaf);
    expect(tree.getLeafCount()).toBe(1);
  });

  it("two leaves — root is hash of tagged pair", () => {
    const [a, b] = makeLeaves(2);
    const tree = MerkleTree.build([a!, b!]);

    // Leaves are tagged before pairing: H(0x01 || H(0x00||a) || H(0x00||b)).
    const expectedRoot = hashPair(hashLeaf(a!), hashLeaf(b!));
    expect(tree.getRoot()).toBe(expectedRoot);
    expect(tree.getLeafCount()).toBe(2);
  });

  it("three leaves — odd count handled by RFC 6962 promotion (CVE-2012-2459)", () => {
    const leaves = makeLeaves(3);
    const tree = MerkleTree.build(leaves);

    expect(tree.getRoot()).toBeTruthy();
    expect(tree.getLeafCount()).toBe(3);

    // RFC 6962 promotion (NOT self-duplication): the lone third leaf l2 has no
    // sibling at the bottom level, so it is carried UP unchanged and paired
    // with the level-1 parent h01 → H(H(l0,l1), l2). Self-duplication would
    // give H(H(l0,l1), H(l2,l2)) and collide with build([l0,l1,l2,l2]).
    const l0 = hashLeaf(leaves[0]!);
    const l1 = hashLeaf(leaves[1]!);
    const l2 = hashLeaf(leaves[2]!);
    const h01 = hashPair(l0, l1);
    const expectedRoot = hashPair(h01, l2);
    expect(tree.getRoot()).toBe(expectedRoot);
  });

  it("four leaves — perfect binary tree", () => {
    const leaves = makeLeaves(4);
    const tree = MerkleTree.build(leaves);

    const l = leaves.map(hashLeaf);
    const h01 = hashPair(l[0]!, l[1]!);
    const h23 = hashPair(l[2]!, l[3]!);
    const expectedRoot = hashPair(h01, h23);
    expect(tree.getRoot()).toBe(expectedRoot);
  });

  it("seven leaves — non-power-of-2", () => {
    const leaves = makeLeaves(7);
    const tree = MerkleTree.build(leaves);

    expect(tree.getRoot()).toBeTruthy();
    expect(tree.getRoot()!.length).toBe(64);
    expect(tree.getLeafCount()).toBe(7);
  });

  it("eight leaves — power-of-2", () => {
    const leaves = makeLeaves(8);
    const tree = MerkleTree.build(leaves);

    expect(tree.getRoot()).toBeTruthy();
    expect(tree.getRoot()!.length).toBe(64);
    expect(tree.getLeafCount()).toBe(8);
  });

  it("1000 leaves — large tree", () => {
    const leaves = makeLeaves(1000);
    const tree = MerkleTree.build(leaves);

    expect(tree.getRoot()).toBeTruthy();
    expect(tree.getRoot()!.length).toBe(64);
    expect(tree.getLeafCount()).toBe(1000);
  });
});

// =============================================================================
// Determinism
// =============================================================================

describe("MerkleTree determinism", () => {
  it("same leaves produce same root", () => {
    const leaves = makeLeaves(10);
    const tree1 = MerkleTree.build(leaves);
    const tree2 = MerkleTree.build(leaves);

    expect(tree1.getRoot()).toBe(tree2.getRoot());
  });

  it("different leaves produce different roots", () => {
    const leaves1 = makeLeaves(5);
    const leaves2 = makeLeaves(5).map((_, i) => sha256(`different-${i}`));
    const tree1 = MerkleTree.build(leaves1);
    const tree2 = MerkleTree.build(leaves2);

    expect(tree1.getRoot()).not.toBe(tree2.getRoot());
  });

  it("root changes when any single leaf changes", () => {
    const leaves = makeLeaves(8);
    const originalRoot = MerkleTree.build(leaves).getRoot();

    for (let i = 0; i < leaves.length; i++) {
      const modified = [...leaves];
      modified[i] = sha256(`tampered-${i}`);
      const newRoot = MerkleTree.build(modified).getRoot();
      expect(newRoot).not.toBe(originalRoot);
    }
  });

  it("leaf order matters", () => {
    const leaves = makeLeaves(4);
    const reversed = [...leaves].reverse();
    const tree1 = MerkleTree.build(leaves);
    const tree2 = MerkleTree.build(reversed);

    expect(tree1.getRoot()).not.toBe(tree2.getRoot());
  });
});

// =============================================================================
// Proof Generation
// =============================================================================

describe("MerkleTree proof generation", () => {
  it("returns null for empty tree", () => {
    const tree = MerkleTree.build([]);
    expect(tree.getProof(0)).toBeNull();
  });

  it("returns null for out-of-range index", () => {
    const tree = MerkleTree.build(makeLeaves(5));
    expect(tree.getProof(-1)).toBeNull();
    expect(tree.getProof(5)).toBeNull();
    expect(tree.getProof(100)).toBeNull();
  });

  it("single leaf — proof has no siblings", () => {
    const leaf = sha256("single");
    const tree = MerkleTree.build([leaf]);
    const proof = tree.getProof(0);

    expect(proof).not.toBeNull();
    // leafHash stays the UNTAGGED caller value...
    expect(proof!.leafHash).toBe(leaf);
    expect(proof!.leafIndex).toBe(0);
    expect(proof!.siblings).toEqual([]);
    // ...but the root is the tagged leaf (domain separation).
    expect(proof!.root).toBe(hashLeaf(leaf));
  });

  it("two leaves — proof has one sibling (tagged sibling digest)", () => {
    const [a, b] = makeLeaves(2);
    const tree = MerkleTree.build([a!, b!]);

    const proof0 = tree.getProof(0);
    expect(proof0).not.toBeNull();
    // leafHash is the untagged caller value; the sibling is the tagged leaf.
    expect(proof0!.leafHash).toBe(a!);
    expect(proof0!.siblings.length).toBe(1);
    expect(proof0!.siblings[0]!.hash).toBe(hashLeaf(b!));
    expect(proof0!.siblings[0]!.direction).toBe("right");

    const proof1 = tree.getProof(1);
    expect(proof1).not.toBeNull();
    expect(proof1!.leafHash).toBe(b!);
    expect(proof1!.siblings.length).toBe(1);
    expect(proof1!.siblings[0]!.hash).toBe(hashLeaf(a!));
    expect(proof1!.siblings[0]!.direction).toBe("left");
  });

  it("generates valid proof for every leaf in a 4-leaf tree", () => {
    const leaves = makeLeaves(4);
    const tree = MerkleTree.build(leaves);

    for (let i = 0; i < 4; i++) {
      const proof = tree.getProof(i);
      expect(proof).not.toBeNull();
      expect(proof!.leafHash).toBe(leaves[i]);
      expect(proof!.leafIndex).toBe(i);
      expect(proof!.root).toBe(tree.getRoot());
      expect(MerkleTree.verifyProof(proof!)).toBe(true);
    }
  });

  it("generates valid proof for every leaf in a 7-leaf tree", () => {
    const leaves = makeLeaves(7);
    const tree = MerkleTree.build(leaves);

    for (let i = 0; i < 7; i++) {
      const proof = tree.getProof(i);
      expect(proof).not.toBeNull();
      expect(MerkleTree.verifyProof(proof!)).toBe(true);
    }
  });

  it("generates valid proof for every leaf in an 8-leaf tree", () => {
    const leaves = makeLeaves(8);
    const tree = MerkleTree.build(leaves);

    for (let i = 0; i < 8; i++) {
      const proof = tree.getProof(i);
      expect(proof).not.toBeNull();
      expect(MerkleTree.verifyProof(proof!)).toBe(true);
    }
  });

  it("generates valid proof for every leaf in a 1000-leaf tree", () => {
    const leaves = makeLeaves(1000);
    const tree = MerkleTree.build(leaves);

    // Spot-check first, last, middle, and random positions
    const indicesToCheck = [0, 1, 499, 500, 998, 999];
    for (const i of indicesToCheck) {
      const proof = tree.getProof(i);
      expect(proof).not.toBeNull();
      expect(proof!.leafHash).toBe(leaves[i]);
      expect(MerkleTree.verifyProof(proof!)).toBe(true);
    }
  });
});

// =============================================================================
// Proof Verification
// =============================================================================

describe("MerkleTree proof verification", () => {
  it("valid proof verifies successfully", () => {
    const leaves = makeLeaves(8);
    const tree = MerkleTree.build(leaves);
    const proof = tree.getProof(3)!;

    expect(MerkleTree.verifyProof(proof)).toBe(true);
  });

  it("tampered leaf hash fails verification", () => {
    const leaves = makeLeaves(8);
    const tree = MerkleTree.build(leaves);
    const proof = tree.getProof(3)!;

    const tampered = {
      ...proof,
      leafHash: sha256("tampered"),
    };
    expect(MerkleTree.verifyProof(tampered)).toBe(false);
  });

  it("tampered sibling hash fails verification", () => {
    const leaves = makeLeaves(8);
    const tree = MerkleTree.build(leaves);
    const proof = tree.getProof(3)!;

    const tamperedSiblings = [...proof.siblings];
    tamperedSiblings[0] = {
      ...tamperedSiblings[0]!,
      hash: sha256("tampered-sibling"),
    };

    const tampered = {
      ...proof,
      siblings: tamperedSiblings,
    };
    expect(MerkleTree.verifyProof(tampered)).toBe(false);
  });

  it("wrong root fails verification", () => {
    const leaves = makeLeaves(8);
    const tree = MerkleTree.build(leaves);
    const proof = tree.getProof(3)!;

    const tampered = {
      ...proof,
      root: sha256("wrong-root"),
    };
    expect(MerkleTree.verifyProof(tampered)).toBe(false);
  });

  it("swapped sibling direction fails verification", () => {
    const leaves = makeLeaves(4);
    const tree = MerkleTree.build(leaves);
    const proof = tree.getProof(0)!;

    // Flip the first sibling direction
    const flippedSiblings = proof.siblings.map((s, i) =>
      i === 0 ? { ...s, direction: "left" as const } : s,
    );

    const tampered = {
      ...proof,
      siblings: flippedSiblings,
    };
    expect(MerkleTree.verifyProof(tampered)).toBe(false);
  });

  it("proof from one tree fails against another tree's root", () => {
    const tree1 = MerkleTree.build(makeLeaves(4));
    const tree2 = MerkleTree.build(makeLeaves(4).map((_, i) => sha256(`other-${i}`)));

    const proof = tree1.getProof(0)!;
    const crossTreeProof = {
      ...proof,
      root: tree2.getRoot()!,
    };

    expect(MerkleTree.verifyProof(crossTreeProof)).toBe(false);
  });

  it("single-leaf proof verifies correctly", () => {
    const leaf = sha256("only");
    const tree = MerkleTree.build([leaf]);
    const proof = tree.getProof(0)!;

    expect(MerkleTree.verifyProof(proof)).toBe(true);
  });

  it("three-leaf tree — all proofs verify", () => {
    const leaves = makeLeaves(3);
    const tree = MerkleTree.build(leaves);

    for (let i = 0; i < 3; i++) {
      const proof = tree.getProof(i)!;
      expect(MerkleTree.verifyProof(proof)).toBe(true);
    }
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("MerkleTree edge cases", () => {
  it("proof path length is log2(n) for power-of-2 trees", () => {
    // 8 leaves → 3 levels of siblings
    const tree = MerkleTree.build(makeLeaves(8));
    const proof = tree.getProof(0)!;
    expect(proof.siblings.length).toBe(3); // log2(8) = 3

    // 4 leaves → 2 levels
    const tree4 = MerkleTree.build(makeLeaves(4));
    const proof4 = tree4.getProof(0)!;
    expect(proof4.siblings.length).toBe(2); // log2(4) = 2

    // 2 leaves → 1 level
    const tree2 = MerkleTree.build(makeLeaves(2));
    const proof2 = tree2.getProof(0)!;
    expect(proof2.siblings.length).toBe(1); // log2(2) = 1
  });

  it("duplicate leaves produce valid tree and proofs", () => {
    const leaf = sha256("duplicate");
    const leaves = [leaf, leaf, leaf, leaf];
    const tree = MerkleTree.build(leaves);

    expect(tree.getRoot()).toBeTruthy();

    for (let i = 0; i < 4; i++) {
      const proof = tree.getProof(i)!;
      expect(proof.leafHash).toBe(leaf);
      expect(MerkleTree.verifyProof(proof)).toBe(true);
    }
  });

  it("power-of-2 vs non-power-of-2 produce different roots", () => {
    const leaves8 = makeLeaves(8);
    const leaves7 = leaves8.slice(0, 7);

    const tree8 = MerkleTree.build(leaves8);
    const tree7 = MerkleTree.build(leaves7);

    // Different leaf counts → different roots (even sharing first 7 leaves)
    expect(tree8.getRoot()).not.toBe(tree7.getRoot());
  });

  it("proof for last leaf in odd-count tree verifies", () => {
    const leaves = makeLeaves(5);
    const tree = MerkleTree.build(leaves);

    // Last leaf (index 4) is the odd one out — promoted (RFC 6962), not
    // paired with itself; its proof must still fold back to the root.
    const proof = tree.getProof(4)!;
    expect(proof.leafHash).toBe(leaves[4]);
    expect(MerkleTree.verifyProof(proof)).toBe(true);
  });
});

// =============================================================================
// H10: verifyProof hash validation
// =============================================================================

describe("MerkleTree.verifyProof hash validation (H10)", () => {
  function validProof() {
    const leaves = makeLeaves(4);
    const tree = MerkleTree.build(leaves);
    return tree.getProof(0)!;
  }

  it("throws on non-hex leafHash", () => {
    const proof = validProof();
    const bad = { ...proof, leafHash: "not-a-hex-string" };
    expect(() => MerkleTree.verifyProof(bad)).toThrow("proof.leafHash");
  });

  it("throws on wrong-length root", () => {
    const proof = validProof();
    const bad = { ...proof, root: "abcd" };
    expect(() => MerkleTree.verifyProof(bad)).toThrow("proof.root");
  });

  it("throws on invalid sibling hash", () => {
    const proof = validProof();
    const badSiblings = [...proof.siblings];
    badSiblings[0] = { ...badSiblings[0]!, hash: "ZZZZ" };
    const bad = { ...proof, siblings: badSiblings };
    expect(() => MerkleTree.verifyProof(bad)).toThrow("proof.siblings[0]");
  });

  it("valid proof still passes after validation is added", () => {
    const proof = validProof();
    expect(MerkleTree.verifyProof(proof)).toBe(true);
  });
});
