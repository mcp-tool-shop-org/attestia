<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/proof

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) — proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Binary SHA-256 Merkle trees, inclusion proofs, and self-contained attestation proof packages.**

[![npm version](https://img.shields.io/npm/v/@attestia/proof)](https://www.npmjs.com/package/@attestia/proof)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- **Binary Merkle tree** built from pre-hashed SHA-256 leaves
- Generate **inclusion proofs** for any leaf in O(log n) time
- **Static proof verification** without access to the original tree
- Self-contained **attestation proof packages** verifiable without the full event store
- Tamper-evident `packageHash` covers all fields using RFC 8785 canonical JSON
- Immutable tree: build once, query many times
- Deterministic: same leaves always produce the same root
- 53 tests

## Installation

```bash
npm install @attestia/proof
```

## Usage

### Build a Merkle Tree and Generate Proofs

```typescript
import { MerkleTree } from "@attestia/proof";
import { createHash } from "node:crypto";

// Hash your data into SHA-256 leaf values
const leaves = ["event-1", "event-2", "event-3"].map((data) =>
  createHash("sha256").update(data).digest("hex"),
);

// Build the tree
const tree = MerkleTree.build(leaves);
console.log(tree.getRoot());       // root hash (hex string)
console.log(tree.getLeafCount());  // 3

// Generate an inclusion proof for leaf at index 0
const proof = tree.getProof(0);
// proof.leafHash, proof.siblings, proof.root
```

### Verify an Inclusion Proof

```typescript
import { MerkleTree } from "@attestia/proof";

// Verification is static -- no tree needed
const isValid = MerkleTree.verifyProof(proof);
console.log(isValid); // true
```

### Package an Attestation Proof

```typescript
import { MerkleTree, packageAttestationProof, verifyAttestationProof } from "@attestia/proof";

// Build tree from all event hashes in the system
const tree = MerkleTree.build(eventHashes);

// Package a specific attestation with its inclusion proof
const pkg = packageAttestationProof(
  attestationData,  // the attestation object
  eventHashes,      // all event hashes (ordered)
  tree,             // pre-built Merkle tree
  attestationIndex, // index of this attestation's hash
);

// The package is self-contained and portable
console.log(pkg.version);        // 1
console.log(pkg.merkleRoot);     // root hash
console.log(pkg.packageHash);    // tamper-evident hash of the entire package
```

### Verify an Attestation Proof Package

```typescript
import { verifyAttestationProof } from "@attestia/proof";

// Third parties verify with ONLY the package -- no event store needed
const isValid = verifyAttestationProof(pkg);
// Checks: attestation hash, Merkle inclusion, root consistency, package hash
```

## API

| Export | Description |
|---|---|
| `MerkleTree` | Immutable binary Merkle tree with `build()`, `getRoot()`, `getProof()`, `verifyProof()` |
| `packageAttestationProof()` | Wrap an attestation + Merkle proof into a portable proof package |
| `verifyAttestationProof()` | Verify a self-contained proof package (4-step check) |

### Types

| Type | Description |
|---|---|
| `MerkleProof` | Inclusion proof: `leafHash`, `leafIndex`, `siblings`, `root` |
| `MerkleProofStep` | Single sibling step: `hash` + `direction` (`"left"` or `"right"`) |
| `MerkleNode` | Internal tree node: `hash`, optional `left`/`right` children |
| `AttestationProofPackage` | Self-contained proof: attestation, hashes, inclusion proof, `packageHash` |

## How It Works

1. **Build**: Pre-hashed SHA-256 leaves are paired bottom-up. Each internal node is `SHA-256(left || right)`. Odd leaves are duplicated.
2. **Prove**: Walk from a leaf to the root, collecting sibling hashes at each level with their direction (left/right).
3. **Verify**: Reconstruct the root from the leaf hash and siblings. If it matches the expected root, the leaf is proven to be in the tree.
4. **Package**: An attestation proof package bundles the attestation data, its hash, the Merkle root, the inclusion proof, and a `packageHash` computed over all fields using canonical JSON.

## Ecosystem

This package is part of the Attestia monorepo with 13 sister packages:

`@attestia/types` | `@attestia/ledger` | `@attestia/registrum` | `@attestia/vault` | `@attestia/treasury` | `@attestia/event-store` | `@attestia/verify` | `@attestia/reconciler` | `@attestia/chain-observer` | `@attestia/witness` | `@attestia/sdk` | `@attestia/node` | `@attestia/demo`

## Docs

| Document | Description |
|---|---|
| [Architecture](../../docs/architecture.md) | System architecture overview |
| [API Reference](../../docs/api.md) | Full API documentation |

## License

[MIT](../../LICENSE)
