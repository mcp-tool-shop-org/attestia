/**
 * @attestia/proof — Merkle Tree.
 *
 * Binary hash tree for inclusion proofs over event sets.
 *
 * Design:
 * - All hashing uses SHA-256 (caller provides pre-hashed leaves)
 * - Domain separation (RFC 6962): leaves and internal nodes are hashed
 *   with distinct one-byte tags so a leaf digest can NEVER equal an
 *   internal-node digest. This defeats second-preimage attacks (an
 *   internal node masquerading as a single leaf) and tree-shape collisions.
 *     leaf   = SHA-256(0x00 || leafBytes)
 *     parent = SHA-256(0x01 || leftBytes || rightBytes)
 * - Caller-supplied leaves stay UNTAGGED in MerkleProof.leafHash; the tag
 *   is applied internally at build + verify time. This keeps the proof
 *   leafHash equal to the value the caller hashed (e.g. an attestation hash).
 * - Odd leaf count: duplicate the last leaf to make even
 * - Empty tree: null root
 * - Single leaf: root is H(0x00 || leaf) — NOT the raw leaf (so it cannot
 *   be confused with an internal node)
 * - Deterministic: same leaves → same root
 * - Immutable: build once, query many times
 */

import { createHash } from "node:crypto";
import type { MerkleNode, MerkleProof, MerkleProofStep } from "./types.js";

// =============================================================================
// Domain Separation Tags (RFC 6962-style)
// =============================================================================

/** Prefix byte for leaf hashing. */
const LEAF_TAG = 0x00;
/** Prefix byte for internal-node hashing. */
const NODE_TAG = 0x01;

// =============================================================================
// Validation
// =============================================================================

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

function assertValidSha256Hex(hash: string, context: string): void {
  if (!SHA256_HEX_RE.test(hash)) {
    throw new Error(
      `Invalid SHA-256 hex hash (${context}): expected 64 lowercase hex chars, got "${hash.length > 80 ? hash.slice(0, 80) + "…" : hash}"`,
    );
  }
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Hash a caller-supplied leaf into its tagged tree-leaf digest.
 *
 * leaf = SHA-256(0x00 || leafBytes). The 0x00 prefix domain-separates
 * leaves from internal nodes (which use 0x01), so no internal-node digest
 * can ever be presented as a single-leaf hash (second-preimage defense).
 */
function hashLeaf(leaf: string): string {
  const buf = Buffer.allocUnsafe(33);
  buf[0] = LEAF_TAG;
  buf.set(Buffer.from(leaf, "hex"), 1);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Hash two child hashes to produce a parent hash.
 *
 * parent = SHA-256(0x01 || leftBytes || rightBytes) — the 0x01 prefix
 * domain-separates internal nodes from leaves. Because both child inputs
 * are fixed-length (32 bytes each for SHA-256), the boundary is
 * unambiguous and string-concatenation collisions are impossible.
 */
function hashPair(left: string, right: string): string {
  const buf = Buffer.allocUnsafe(65);
  buf[0] = NODE_TAG;
  buf.set(Buffer.from(left, "hex"), 1);
  buf.set(Buffer.from(right, "hex"), 33);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Build a Merkle tree from a layer of nodes (bottom-up).
 * Returns the root node.
 */
function buildTree(leaves: readonly string[]): MerkleNode | null {
  if (leaves.length === 0) {
    return null;
  }

  // Create leaf nodes — apply the leaf domain-separation tag so leaf
  // digests can never collide with internal-node digests.
  let currentLevel: MerkleNode[] = leaves.map((hash) => ({
    hash: hashLeaf(hash),
  }));

  // Build tree bottom-up
  while (currentLevel.length > 1) {
    const nextLevel: MerkleNode[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;

      // If odd number of nodes, duplicate the last one
      const right =
        i + 1 < currentLevel.length ? currentLevel[i + 1]! : left;

      const parentHash = hashPair(left.hash, right.hash);
      nextLevel.push({
        hash: parentHash,
        left,
        right,
      });
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0] ?? null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Immutable Merkle tree built from pre-hashed leaves.
 *
 * Usage:
 * ```ts
 * const tree = MerkleTree.build(["aabb...", "ccdd...", ...]);
 * const root = tree.getRoot();          // root hash or null
 * const proof = tree.getProof(0);       // inclusion proof for leaf 0
 * MerkleTree.verifyProof(proof);        // true/false
 * ```
 */
export class MerkleTree {
  private readonly root: MerkleNode | null;
  private readonly leaves: readonly string[];

  private constructor(leaves: readonly string[]) {
    this.leaves = leaves;
    this.root = buildTree(leaves);
  }

  /**
   * Build a Merkle tree from pre-hashed leaf values.
   *
   * Leaves must be SHA-256 hex strings (64 chars). The caller is
   * responsible for hashing their data before passing it here.
   *
   * @param leaves - Array of SHA-256 hex strings
   * @returns Immutable MerkleTree instance
   */
  static build(leaves: readonly string[]): MerkleTree {
    for (let i = 0; i < leaves.length; i++) {
      assertValidSha256Hex(leaves[i]!, `leaf[${i}]`);
    }
    return new MerkleTree(leaves);
  }

  /**
   * Get the root hash of the tree.
   * Returns null for an empty tree.
   */
  getRoot(): string | null {
    return this.root?.hash ?? null;
  }

  /**
   * Get the number of leaves in the tree.
   */
  getLeafCount(): number {
    return this.leaves.length;
  }

  /**
   * Generate an inclusion proof for the leaf at the given index.
   *
   * The returned proof is self-contained: it includes the leaf hash,
   * all sibling hashes along the path to the root, and the root itself.
   *
   * @param leafIndex - 0-based index of the leaf
   * @returns MerkleProof or null if index is out of range or tree is empty
   */
  getProof(leafIndex: number): MerkleProof | null {
    if (
      this.root === null ||
      leafIndex < 0 ||
      leafIndex >= this.leaves.length
    ) {
      return null;
    }

    const leafHash = this.leaves[leafIndex]!;

    // Single leaf — no siblings needed
    if (this.leaves.length === 1) {
      return {
        leafHash,
        leafIndex,
        siblings: [],
        root: this.root.hash,
      };
    }

    // Walk the tree bottom-up, collecting siblings
    const siblings: MerkleProofStep[] = [];
    let currentIndex = leafIndex;

    // Reconstruct levels to find siblings at each level. The bottom level is
    // the TAGGED leaf digests (matching buildTree); every sibling we emit is
    // therefore a tagged-leaf or internal digest, exactly what verifyProof
    // folds together.
    let currentLevel = this.leaves.map(hashLeaf);

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i]!;
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1]! : left;
        nextLevel.push(hashPair(left, right));
      }

      // Determine sibling for currentIndex
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      // Handle odd count: if we're the last element with no sibling, use self
      const sibling =
        siblingIndex < currentLevel.length
          ? currentLevel[siblingIndex]!
          : currentLevel[currentIndex]!;

      siblings.push({
        hash: sibling,
        direction: isLeft ? "right" : "left",
      });

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = nextLevel;
    }

    return {
      leafHash,
      leafIndex,
      siblings,
      root: this.root.hash,
    };
  }

  /**
   * Verify a Merkle inclusion proof.
   *
   * Statically verifiable — does not need the original tree.
   * Checks that traversing from the leaf through the sibling path
   * produces the expected root hash.
   *
   * @param proof - The inclusion proof to verify
   * @returns true if the proof is valid
   */
  static verifyProof(proof: MerkleProof): boolean {
    assertValidSha256Hex(proof.leafHash, "proof.leafHash");
    assertValidSha256Hex(proof.root, "proof.root");
    for (let i = 0; i < proof.siblings.length; i++) {
      assertValidSha256Hex(proof.siblings[i]!.hash, `proof.siblings[${i}]`);
    }

    // Apply the leaf domain-separation tag before folding. The caller-supplied
    // proof.leafHash is the UNTAGGED leaf; a single-leaf proof therefore folds
    // to H(0x00 || leaf), which can never equal a (0x01-tagged) internal node.
    let currentHash = hashLeaf(proof.leafHash);

    for (const step of proof.siblings) {
      if (step.direction === "left") {
        // Sibling is on the left
        currentHash = hashPair(step.hash, currentHash);
      } else {
        // Sibling is on the right
        currentHash = hashPair(currentHash, step.hash);
      }
    }

    return currentHash === proof.root;
  }
}
