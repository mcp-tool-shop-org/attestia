---
title: Reference
description: Package status table, documentation index, and security and data scope for Attestia.
sidebar:
  order: 4
---

This page is the quick-reference for Attestia's 15 packages, the full documentation index, and the security and data scope declaration.

## Package status

Version 2.1.3. 15 workspace packages, 2,605 tests in CI plus 3 bundle smoke tests, 94.9–100% statement coverage per package. All green. Counts are from CI on Node 22.

| Package | Tests | Purpose |
|---------|-------|---------|
| `@attestia/types` | 75 | Shared domain types (zero deps) |
| `@attestia/registrum` | 368 | Constitutional governance — 11 invariants, dual-witness validation |
| `@attestia/ledger` | 156 | Append-only double-entry engine |
| `@attestia/chain-observer` | 295 | Multi-chain read-only observation (EVM + XRPL + Solana + L2s) |
| `@attestia/vault` | 91 | Personal vault — portfolios, budgets, intents |
| `@attestia/treasury` | 109 | Org treasury — payroll, distributions, funding gates |
| `@attestia/reconciler` | 98 | 3D cross-system matching + Registrum attestation |
| `@attestia/witness` | 295 | XRPL on-chain attestation, multi-sig governance, retry |
| `@attestia/verify` | 273 | Replay verification, compliance evidence, SLA enforcement |
| `@attestia/event-store` | 263 | Append-only event persistence, JSONL, hash chain, 34 event types |
| `@attestia/proof` | 94 | Merkle trees, inclusion proofs, attestation proof packaging |
| `@attestia/sdk` | 115 | Typed HTTP client SDK for external consumers |
| `@attestia/node` | 362 | Hono REST API — 57 endpoints, auth, multi-tenancy, public API, compliance |
| `@mcptoolshop/attestia` | 3 | The published npm package: every library above in one bundle, with subpath exports (smoke tests, run by `pnpm test`; CI's coverage run doesn't include them) |
| `@attestia/demo` | — | Interactive CLI demo — walk through the full Attestia pipeline (private, no tests) |

### Package dependency flow

The packages form a directed acyclic graph:

- **Foundation:** `@attestia/types` (zero deps, shared by all)
- **Domain layer:** `registrum`, `ledger`, `vault`, `treasury`, `event-store`
- **Integration layer:** `chain-observer`, `reconciler`, `witness`, `verify`, `proof`
- **API surface:** `node` (REST API), `sdk` (typed HTTP client)

## Documentation index

Attestia ships with extensive documentation in the repository root:

| Document | Purpose |
|----------|---------|
| HANDBOOK.md | Executive overview and full package reference |
| ROADMAP.md | Phase-by-phase project roadmap |
| DESIGN.md | Architecture decisions and rationale |
| ARCHITECTURE.md | Package graph, data flows, security model |
| REFERENCE_ARCHITECTURE.md | 5-layer stack, deployment patterns, trust boundaries |
| INTEGRATION_GUIDE.md | API integration with curl examples + SDK usage |
| VERIFICATION_GUIDE.md | Auditor step-by-step replay guide |
| THREAT_MODEL.md | STRIDE analysis per component |
| CONTROL_MATRIX.md | Threat-to-control-to-file-to-test mappings |
| SECURITY.md | Responsible disclosure policy |
| INSTITUTIONAL_READINESS.md | Adoption readiness checklist |
| PERFORMANCE_BASELINE.md | Recorded benchmarks |

## Security and data scope

### Data accessed

Attestia reads and writes financial ledger entries, attestation records, and cryptographic proofs. When the witness module is active, it connects to blockchain nodes (primarily XRPL) to submit and verify attestation records.

### Data NOT accessed

- No telemetry
- No user credential storage
- No third-party analytics

### Permissions required

- **Read/write access** to local data directories for event store persistence
- **Network access** for blockchain attestation only (XRPL witness module)
- See the [THREAT_MODEL.md](https://github.com/mcp-tool-shop-org/Attestia/blob/main/THREAT_MODEL.md) in the repository for the full STRIDE analysis covering every component

## Scorecard

Attestia passes all five ship gates:

| Gate | Status |
|------|--------|
| A. Security Baseline | PASS |
| B. Error Handling | PASS |
| C. Operator Docs | PASS |
| D. Shipping Hygiene | PASS |
| E. Identity | PASS |

## License

Attestia is released under the [MIT License](https://github.com/mcp-tool-shop-org/Attestia/blob/main/LICENSE).
