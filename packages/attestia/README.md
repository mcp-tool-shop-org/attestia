# @mcptoolshop/attestia

<p align="center"><strong>Financial truth infrastructure for the decentralized world — the whole Attestia library in one package.</strong></p>

Structural governance, deterministic accounting, and human-approved intent — unified across chains, organizations, and individuals. Attestia doesn't move your money; it proves what happened, constrains what can happen, and makes the financial record unbreakable.

This package bundles the full Attestia library surface into a single install (ESM). The internal `@attestia/*` workspace packages are inlined — there is no package sprawl to manage; third-party runtime deps (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) resolve normally.

## Install

```bash
npm install @mcptoolshop/attestia
```

> **ESM only** (Node ≥ 18). Published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC Trusted Publishing.

## Usage

Import a domain as a **namespace** from the root:

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…or import flat symbols from a **subpath**:

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## Subpaths

| Subpath | What it is |
|---------|-----------|
| `@mcptoolshop/attestia` | Root barrel — every domain as a namespace |
| `…/types` | Shared domain types (Money, ids, branded primitives) |
| `…/ledger` | Append-only double-entry engine + deterministic money math |
| `…/registrum` | Constitutional registrar — 11 invariants, dual-witness |
| `…/event-store` | Append-only event persistence — JSONL, hash chain |
| `…/proof` | Merkle trees (RFC 6962), inclusion + attestation proofs |
| `…/vault` | Personal vault — portfolios, budgets, intents |
| `…/treasury` | Org treasury — payroll, distributions, funding gates |
| `…/reconciler` | Cross-system matching + Registrum attestation |
| `…/chain-observer` | Multi-chain read-only observation (EVM, XRPL, Solana, L2s) |
| `…/witness` | XRPL on-chain attestation, multi-sig governance |
| `…/verify` | Replay verification, compliance evidence, SLA |
| `…/sdk` | Typed HTTP client for the Attestia REST API |

## Core pattern

Every interaction follows one flow, and no step is optional:

```
Intent → Approve → Execute → Verify
```

## Documentation

Full handbook, architecture, threat model, and verification guide: **<https://mcp-tool-shop-org.github.io/attestia/>** · Source: **<https://github.com/mcp-tool-shop-org/attestia>**

## License

[MIT](LICENSE) — built by [MCP Tool Shop](https://mcp-tool-shop.github.io/).
