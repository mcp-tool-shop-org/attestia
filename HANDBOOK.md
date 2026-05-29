# Attestia — Project Handbook

**Version:** 1.0.1
**Date:** May 29, 2026
**Status:** Active development — Phases 1–12 complete

---

## Executive Summary

Attestia is financial truth infrastructure for the decentralized world. It is the accounting and governance layer that sits beneath wallets, DAOs, and DeFi protocols — observing what happened on-chain, constraining what can happen next, and producing an unbreakable financial record.

Attestia does not move money. It proves what happened, enforces structural rules, and attests the result on-chain.

**By the numbers:**

| Metric | Value |
|--------|-------|
| Packages | 14 |
| Source lines (TypeScript) | ~19,000 |
| Tests | 2,220 |
| Test coverage | 96.80% |
| Runtime dependencies (core) | 0 |
| REST API endpoints | 34 |
| Supported chains | EVM (Ethereum, Arbitrum, Base, Optimism) + XRPL + Solana |

---

## Mission

Smart contracts execute. Blockchains record. But no one attests.

Attestia fills the gap with three guarantees:

1. **Structural governance** — Rules that hold unconditionally, not votes that change with the wind
2. **Deterministic accounting** — Append-only, replayable, reconcilable financial records
3. **Human-approved intent** — AI advises, machines verify, but nothing moves without explicit human authorization

---

## Core Pattern

Every interaction in Attestia follows one flow:

```
Intent  →  Approve  →  Execute  →  Verify
```

1. **Intent** — A user or system declares a desired financial outcome
2. **Approve** — Registrum validates structurally; a human signs explicitly
3. **Execute** — The on-chain transaction is submitted
4. **Verify** — Reconciliation confirms the result; XRPL attests the record

No step is optional. No step is automated away.

---

## Architecture

Attestia is a TypeScript monorepo (pnpm workspaces) organized as 14 packages with strict dependency direction. The core domain packages have zero runtime dependencies.

```
┌─────────────────────────────────────────────────────────────────┐
│                          ATTESTIA                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │   Personal   │  │     Org      │  │                       │ │
│  │    Vault     │  │   Treasury   │  │      Registrum        │ │
│  │              │  │              │  │                       │ │
│  │  Observe.    │  │  Distribute. │  │  11 structural        │ │
│  │  Budget.     │  │  Account.    │  │  invariants.          │ │
│  │  Allocate.   │  │  Reconcile.  │  │  Dual-witness.        │ │
│  └──────┬───────┘  └──────┬───────┘  │  Constitutional law.  │ │
│         │                 │          └───────────┬───────────┘ │
│         └────────┬────────┘                      │             │
│                  │                               │             │
│          ┌───────┴────────┐                      │             │
│          │  Reconciler    │◀─────────────────────┘             │
│          │  3D matching   │                                    │
│          └───────┬────────┘                                    │
│                  │                                             │
│          ┌───────┴────────┐    ┌──────────────┐               │
│          │    Witness     │    │  Event Store  │               │
│          │ XRPL on-chain  │    │  Append-only  │               │
│          │  attestation   │    │  persistence  │               │
│          └────────────────┘    └──────────────┘               │
│                                                                │
│          ┌──────────────┐    ┌──────────────┐                │
│          │    Proof      │    │     SDK       │                │
│          │ Merkle trees  │    │ Typed client  │                │
│          └──────────────┘    └──────────────┘                │
│                                                                │
│          ┌────────────────────────────────────┐               │
│          │  Node (REST API)                    │               │
│          │  34 endpoints · Auth · Multi-tenant │               │
│          └────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### Dependency Hierarchy

```
@attestia/types          (zero deps — shared domain types)
    ↑
@attestia/registrum      (json-canonicalize — standalone constitutional layer)
@attestia/ledger         (types — pure double-entry engine)
@attestia/chain-observer (viem + xrpl.js + @solana/web3.js — multi-chain read layer)
    ↑
@attestia/vault          (types + ledger + chain-observer + registrum)
@attestia/treasury       (types + ledger + registrum)
    ↑
@attestia/reconciler     (types + registrum + json-canonicalize — 3D matching)
@attestia/witness        (types + registrum + xrpl.js — XRPL attestation + multi-sig)
@attestia/verify         (types + json-canonicalize — replay, compliance, SLA)
@attestia/event-store    (types + json-canonicalize — persistence, JSONL, 34 event types)
@attestia/proof          (json-canonicalize — Merkle trees, inclusion proofs)
    ↑
@attestia/node           (all packages + hono, pino, zod — REST API)
@attestia/sdk            (types — typed HTTP client)
```

---

## Package Reference

### @attestia/types
**Purpose:** Shared domain types across the entire stack.
**Runtime deps:** None.
**Tests:** 72.

Defines the canonical shapes for `Identity`, `Money`, `Intent`, `ChainRef`, `Event`, and all domain event types. Includes type guards, factory functions, and the event metadata builders used by every other package. Zero dependencies by design — this package is the vocabulary of the system.

---

### @attestia/registrum
**Purpose:** Constitutional governance — the structural registrar.
**Runtime deps:** json-canonicalize.
**Tests:** 341.
**Source:** ~5,600 lines (largest package).

The heart of Attestia. Registrum enforces 11 structural invariants that hold unconditionally. It manages identities, organizations, roles, and governance transitions through a deterministic state machine. Features include:

- **11 structural invariants** — identity uniqueness, role hierarchy, transition validity, etc.
- **Dual-witness validation** — critical operations require two independent witnesses
- **XRPL attestation hooks** — governance transitions produce attestation-ready payloads
- **Rehydration** — `rehydrate()` rebuilds state from a sequence of events

This is the constitutional layer. If Registrum rejects something, the system halts. No override, no exception.

---

### @attestia/ledger
**Purpose:** Append-only double-entry accounting engine.
**Runtime deps:** None.
**Tests:** 154.

A pure-function ledger that enforces the fundamental accounting equation: every debit has an equal credit. Features include:

- **Chart of accounts** with hierarchical account types (asset, liability, equity, revenue, expense)
- **Journal entries** — immutable, timestamped, balanced
- **Trial balance** — always computable, always balanced
- **Append-only** — no UPDATE, no DELETE, only new entries

Ported from the Python-based Payroll Engine. Zero runtime dependencies — pure math and state machines.

---

### @attestia/chain-observer
**Purpose:** Multi-chain read-only observation layer.
**Runtime deps:** viem, xrpl.js, @solana/web3.js.
**Tests:** 278.

Observes blockchain state without modifying it. Supports:

- **EVM chains** — Ethereum, Arbitrum, Base, Optimism (via viem)
- **XRPL** — XRP Ledger (via xrpl.js), including XRPL EVM sidechain
- **Solana** — SOL + SPL tokens, program log parsing (via @solana/web3.js)
- L2 adapters with reorg detection and cross-chain reconciliation
- Balance queries, transaction history, token metadata
- Chain-agnostic interface — consumers don't need to know which chain they're reading

This is the only package where external chain SDKs are permitted.

---

### @attestia/vault
**Purpose:** Personal financial management — observe, budget, allocate.
**Runtime deps:** Internal packages only.
**Tests:** 75.

The individual's view of their finances across chains. Features include:

- **Multi-chain portfolio observation** — aggregate balances across EVM + XRPL + Solana
- **Envelope budgeting** — allocate funds to named envelopes with spending limits
- **Intent declaration** — express financial intentions before execution
- **Allocation tracking** — map intents to budgets with constraint validation

Evolved from the NextLedger project (C#).

---

### @attestia/treasury
**Purpose:** Organizational financial management — payroll, distributions, funding gates.
**Runtime deps:** Internal packages only.
**Tests:** 92.

The organization's financial control plane. Features include:

- **Deterministic payroll** — define runs, calculate distributions, execute with full audit trail
- **DAO distributions** — proportional allocation with configurable rules
- **Dual-gate funding** — two independent approvals required for fund release
- **Double-entry integration** — all treasury operations produce balanced ledger entries

Evolved from the Python-based Payroll Engine.

---

### @attestia/reconciler
**Purpose:** Cross-system reconciliation — match intents to reality.
**Runtime deps:** Internal packages + json-canonicalize.
**Tests:** 81.

The truth engine. Reconciler performs 3D matching across three dimensions:

1. **Intent** — what was declared
2. **Ledger** — what was recorded
3. **Chain** — what actually happened on-chain

When all three agree, the record is clean. When they disagree, the system halts (fail-closed). Produces reconciliation reports that feed into the witness for on-chain attestation.

---

### @attestia/witness
**Purpose:** XRPL on-chain attestation — write proofs to the ledger.
**Runtime deps:** xrpl.js, json-canonicalize.
**Tests:** 278.

Takes reconciliation reports and attestation payloads and writes them to the XRP Ledger as payment memos. Features include:

- **Memo encoding** — structured attestation data in XRPL payment memos
- **Round-trip verification** — submit, fetch, decode, verify
- **Multi-sig governance** — event-sourced N-of-M quorum enforcement with signer rotation
- **Retry with exponential backoff and jitter** — handles transient XRPL failures
- **Graceful degradation** — `WitnessSubmitResult` returns `submitted` or `degraded` (never throws)
- **Docker-based integration testing** — standalone `rippled` node, sub-second ledger close

The witness is the bridge between Attestia's internal truth and public, verifiable proof.

---

### @attestia/verify
**Purpose:** Deterministic replay verification, compliance evidence, SLA enforcement.
**Runtime deps:** Internal packages + json-canonicalize.
**Tests:** 242.

Answers one question: given the same sequence of events, do we arrive at the same state? Features include:

- **Full replay verification** — rebuild state from events and compare
- **GlobalStateHash** — a single hash representing the complete system state
- **Hash comparison** — quick integrity check without full replay
- **External verification** — exportable state bundles, verifier nodes, multi-verifier consensus
- **Compliance evidence** — SOC 2 Type II and ISO 27001 Annex A control mappings with programmatic scoring
- **SLA enforcement** — advisory-only evaluation engine with fail-closed semantics
- **Tenant governance** — create, suspend, reactivate, validate lifecycle

If replay produces a different result, something is wrong. Fail-closed.

---

### @attestia/event-store
**Purpose:** Append-only event persistence with hash chaining.
**Runtime deps:** json-canonicalize.
**Tests:** 226.

The durable backbone. All domain events flow through the event store. Features include:

- **In-memory store** — for testing and ephemeral workloads
- **JSONL file store** — one event per line, crash-safe via fsync
- **Hash chaining** — each event includes a hash of the previous, forming a tamper-evident chain (SHA-256, RFC 8785)
- **Snapshot support** — periodic state snapshots for fast recovery with hash verification
- **Event catalog** — 34 formalized event types with schema versioning and migration support
- **Corruption recovery** — truncated lines, corrupt middle, empty file handling

---

### @attestia/proof
**Purpose:** Merkle trees, inclusion proofs, attestation proof packaging.
**Runtime deps:** json-canonicalize.
**Tests:** 75.

Cryptographic proof infrastructure. Features include:

- **Merkle tree construction** — deterministic, content-addressed (binary SHA-256)
- **Leaf inclusion proofs** — portable, verifiable offline
- **Attestation proof packages** — self-contained bundles that can be verified without the full event store

---

### @attestia/sdk
**Purpose:** Typed HTTP client SDK for external consumers.
**Runtime deps:** @attestia/types (type-only).
**Tests:** 79.

The integration layer for third-party systems. Features include:

- **Type-safe API clients** — full intent lifecycle, verification, proofs
- **Retry logic** — exponential backoff on 5xx errors
- **Timeout handling** — AbortController-based
- **API key injection** — automatic header management

---

### @attestia/node
**Purpose:** HTTP service — the deployable API surface.
**Runtime deps:** Hono, pino, Zod.
**Tests:** 227.

The operational interface to the entire Attestia stack. Built on Hono with a full middleware stack:

**34 API endpoints under `/api/v1/` and `/public/v1/`:**

| Category | Endpoints |
|----------|-----------|
| Intent lifecycle | `POST /intents`, `GET /intents`, `GET /intents/:id`, `POST /intents/:id/approve`, `POST /intents/:id/reject`, `POST /intents/:id/execute`, `POST /intents/:id/verify` |
| Events | `GET /events`, `GET /events/:streamId` |
| Verification | `POST /verify/replay`, `POST /verify/hash` |
| Reconciliation | `POST /reconcile`, `POST /attest`, `GET /attestations` |
| Export | `GET /export/events` (NDJSON stream), `GET /export/state` (snapshot + GlobalStateHash) |
| Proofs | `POST /proofs/generate`, `POST /proofs/verify`, `GET /proofs/:id`, `POST /proofs/inclusion` |
| Compliance | `GET /compliance/frameworks`, `POST /compliance/report`, `GET /compliance/summary` |
| Public verification | `GET /public/v1/verify/state-bundle`, `POST /public/v1/verify/submit-report`, `GET /public/v1/verify/consensus`, `POST /public/v1/verify/proof`, `GET /public/v1/openapi.json` |

**Infrastructure endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness probe |
| `GET /ready` | Readiness probe (per-subsystem status) |
| `GET /metrics` | Prometheus metrics |

**Cross-cutting concerns:**
- **Authentication** — API-key (`X-Api-Key`) + JWT bearer (`Authorization: Bearer`)
- **Authorization** — Role-based (admin > operator > viewer)
- **Multi-tenancy** — Isolated service instances via `TenantRegistry`
- **Rate limiting** — Token-bucket per identity (authenticated) + IP-based (public endpoints) with `429 + Retry-After`
- **Idempotency** — `Idempotency-Key` header with TTL cache
- **ETags** — SHA-256 based conditional requests
- **CORS** — Configured for browser-based verifiers on public endpoints
- **Observability** — Prometheus counters/histograms, pino structured logging, `X-Request-Id`
- **Deployment** — Multi-stage Dockerfile (node:22-slim), Docker Compose with rippled
- **Graceful shutdown** — SIGTERM/SIGINT handling

---

## Principles

These hold at every phase and are not negotiable:

| Principle | What it means |
|-----------|---------------|
| **Humans approve; machines verify** | No AI or automation ever approves, signs, or executes |
| **Append-only** | No UPDATE, no DELETE — only new entries |
| **Fail-closed** | Disagreement halts the system; never heals silently |
| **Deterministic replay** | Same events produce the same state, always |
| **Chains are witnesses, not authorities** | XRPL attests; authority flows from structural rules |
| **Zero deps on the critical path** | External libraries only at the edges (chain SDKs, HTTP frameworks) |
| **Truth over speed** | Every financial event is replayable and reconcilable |
| **Intent is not execution** | Declaring what you want and doing it are separate acts with separate gates |
| **Structural governance** | Invariants hold unconditionally — not governance by vote |
| **Advisory AI only** | AI can analyze, warn, suggest — never approve, sign, or execute |

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (ES modules) |
| Runtime | Node.js 20+ |
| Package manager | pnpm 10.28 (workspaces) |
| Build | tsc (per-package) |
| Test framework | Vitest |
| HTTP framework | Hono |
| Logging | pino |
| Validation | Zod |
| EVM interaction | viem |
| XRPL interaction | xrpl.js |
| Solana interaction | @solana/web3.js |
| JSON canonicalization | json-canonicalize (RFC 8785) |
| Property testing | fast-check |
| CI | GitHub Actions (Node 20 + 22 matrix) |
| Coverage | Codecov (OIDC auth) |
| Container | Docker (node:22-slim, multi-stage) |
| XRPL testing | Standalone rippled in Docker |

---

## Project Status & Roadmap

### Current State

Phases 1 through 12 are complete. All 14 packages are built, tested, and operational. The system is audit-ready, externally verifiable, compliance-mappable, and SDK-consumable. An auditor can independently replay events to the same GlobalStateHash.

### Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| **M1: Domain Logic** | All core business logic across 11 packages | Done |
| **M2: Production-Grade** | CI, Docker XRPL, replay verification | Done |
| **M3: Durable** | Event store complete; rehydration pending | In Progress |
| **M4: API Surface** | Deployable REST API with auth + multi-tenancy | Done |
| **M5: Audit-Ready** | Hash chain, witness retry, export, benchmarks, auditor docs; 1,176 tests | Done |
| **M5.5: Category Standard** | 5 RFCs, reference architecture, integration guide, RFC process | Done |
| **M6: Multi-Chain** | Solana, L2s, XRPL EVM sidechain, multi-sig witness; 1,551 tests | Done |
| **M7: Trust Standard** | Proof, SDK, public API, compliance, SLA, governance hardening; 1,928 tests | Done |
| **M8: Integrated** | Full intent-to-proof pipeline, E2E tests | Planned |
| **M9: Intelligent** | Anomaly detection, intent suggestions, NL queries | Planned |
| **M10: User-Facing** | Vault UI, Treasury dashboard, Attestation explorer | Planned |
| **M11: Distributed** | npm publishing, Docker images, documentation site | Planned |

### What's Next

- Pipeline orchestration — wire the full Intent-to-Verify flow with fail-closed semantics
- End-to-end integration test suite (`packages/e2e/`)
- Rehydration (`fromEvents()`) for vault, treasury, reconciler, witness
- WebSocket/SSE for real-time reconciliation updates
- XRPL testnet smoke test and mainnet dry-run verification

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 10+
- Docker (for XRPL integration tests)

### Quick Start

```bash
pnpm install                # Install all dependencies
pnpm build                  # Build all packages
pnpm test                   # Run all tests (2,220)
pnpm test:coverage          # Run with coverage reporting
pnpm typecheck              # Type-check all packages
pnpm bench                  # Run benchmarks
```

### XRPL Integration Testing

```bash
docker compose up -d                                      # Start standalone rippled
pnpm --filter @attestia/witness run test:integration      # Run on-chain round-trip tests
docker compose down                                       # Stop rippled
```

### Docker Deployment

```bash
docker compose up           # Start attestia-node + rippled
curl http://localhost:3000/health
```

### CI Pipeline

GitHub Actions runs on every push and PR to `main`:

1. Install dependencies (pnpm)
2. Build all packages
3. Type-check all packages
4. Run tests with coverage (Node 20 + 22 matrix)
5. Run benchmarks (Node 22 only)
6. Upload coverage to Codecov (OIDC)

Branch protection requires passing CI checks and one review approval.

---

## Repository Structure

```
attestia/
├── packages/
│   ├── types/              # @attestia/types
│   ├── registrum/          # @attestia/registrum
│   ├── ledger/             # @attestia/ledger
│   ├── chain-observer/     # @attestia/chain-observer
│   ├── vault/              # @attestia/vault
│   ├── treasury/           # @attestia/treasury
│   ├── reconciler/         # @attestia/reconciler
│   ├── witness/            # @attestia/witness
│   ├── verify/             # @attestia/verify
│   ├── event-store/        # @attestia/event-store
│   ├── proof/              # @attestia/proof
│   ├── sdk/                # @attestia/sdk
│   └── node/               # @attestia/node
├── .github/
│   ├── workflows/ci.yml
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── specs/                  # 10 formal RFCs (implementation-agnostic)
├── resources/              # Research and reference materials
├── docker-compose.yml
├── Dockerfile
├── DESIGN.md               # Architecture decisions
├── ROADMAP.md              # Full project roadmap
├── HANDBOOK.md             # This document
├── ARCHITECTURE.md         # Package graph, data flows, security model
├── REFERENCE_ARCHITECTURE.md # 5-layer stack, deployment patterns
├── INTEGRATION_GUIDE.md    # API integration with curl examples + SDK
├── THREAT_MODEL.md         # STRIDE analysis per component
├── CONTROL_MATRIX.md       # Threat → control → file → test mappings
├── VERIFICATION_GUIDE.md   # Auditor step-by-step replay guide
├── UPGRADE_GUIDE.md        # Deploy without losing state
├── SECURITY.md             # Responsible disclosure policy
├── INSTITUTIONAL_READINESS.md # Adoption readiness checklist
├── PILOT_SCOPE.md          # Monthly payroll pilot use case
├── PERFORMANCE_BASELINE.md # Benchmark baselines
├── CHANGELOG.md            # Version history
├── INDEX.md                # Complete file inventory
├── LICENSE                 # MIT
└── package.json            # Root workspace config
```

---

## Contributing

1. Fork the repository
2. Create a feature branch from `main`
3. Make changes with tests
4. Ensure all checks pass: `pnpm build && pnpm typecheck && pnpm test`
5. Open a PR against `main`

Branch protection requires:
- At least 1 approving review
- All CI checks passing (build, typecheck, tests on Node 20 + 22)
- No force pushes

---

## License

[MIT](LICENSE) — Copyright (c) 2026 mcp-tool-shop-org
