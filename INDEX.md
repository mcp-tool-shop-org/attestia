# Attestia — Repository Index

> Complete file inventory. Last generated: February 11, 2026.

---

## Quick Stats

| Metric | Value |
|--------|-------|
| Packages | 14 (13 + demo) |
| Source files (`.ts`) | ~160 |
| Test files | ~130 |
| Total tests | 2,564 |
| Root docs | 16 markdown files |
| Specs (RFCs) | 10 files |
| Registrum internal docs | 30+ files |
| Research resources | 6 files |

---

## Root

```
.
├── README.md                       Project overview, architecture, status
├── HANDBOOK.md                     Executive overview and full package reference
├── ROADMAP.md                      Phase-by-phase roadmap (Phases 6–15)
├── DESIGN.md                       Architecture decisions and tradeoffs
├── ARCHITECTURE.md                 Package graph, data flows, security model
├── CHANGELOG.md                    Version history
├── LICENSE                         MIT
│
├── VERIFICATION_GUIDE.md           Auditor step-by-step replay guide
├── THREAT_MODEL.md                 STRIDE analysis per component (30 threats)
├── CONTROL_MATRIX.md               30 threat → control → file → test mappings
├── SECURITY.md                     Responsible disclosure policy
├── UPGRADE_GUIDE.md                Deploy without losing state
│
├── REFERENCE_ARCHITECTURE.md       5-layer stack, deployment patterns, trust boundaries
├── INTEGRATION_GUIDE.md            API integration with curl examples + SDK usage
├── INSTITUTIONAL_READINESS.md      Adoption readiness checklist for organizations
├── PERFORMANCE_BASELINE.md         Recorded benchmarks (event store, hash chain, proofs, SLA)
├── PILOT_SCOPE.md                  "Monthly payroll reconciliation" pilot definition
│
├── package.json                    Monorepo root (pnpm workspaces)
├── pnpm-workspace.yaml             Workspace config
├── pnpm-lock.yaml                  Lock file
├── tsconfig.json                   Strict TS config (ES2022, composite)
├── docker-compose.yml              attestia-node + standalone rippled
├── .gitignore                      node_modules, dist, coverage, tsbuildinfo
│
├── assets/
│   └── logo.png                    Attestia logo (used in README)
│
├── specs/                          Formal specifications (9 RFCs + definitions)
├── packages/                       14 monorepo packages
├── resources/                      Research and reference materials
└── .github/                        CI workflows, issue/PR templates
```

---

## specs/

Formal, implementation-agnostic specifications.

```
specs/
├── DEFINITIONS.md                  Normative term definitions (RFC 2119 keywords)
├── RFC-001-DETERMINISTIC-EVENT-MODEL.md   Event structure, hash chain, append-only
├── RFC-002-PROOF-OF-RECONCILIATION.md     3D matching, report hashing, attestation
├── RFC-003-INTENT-CONTROL-STANDARD.md     Intent lifecycle state machine, accounting
├── RFC-004-GLOBAL-STATE-HASH.md           Deterministic replay, subsystem hashing
├── RFC-005-WITNESS-PROTOCOL.md            XRPL memo encoding, retry, degraded mode
├── RFC-006-MULTI-CHAIN-OBSERVER.md        Multi-chain observation protocol (Phase 11)
├── RFC-007-MULTI-SIG-WITNESS.md           N-of-M multi-sig governance (Phase 11)
├── RFC-008-COMPLIANCE-EVIDENCE.md         Compliance evidence generation (Phase 12)
└── RFC-009-EXTERNAL-VERIFICATION.md       External verification protocol (Phase 12)
```

---

## .github/

```
.github/
├── workflows/                      3 workflows
│   ├── ci.yml                      CI pipeline (Node 22/24, build, typecheck, test, coverage, dep-scan, bench)
│   ├── docker.yml                  Docker image publishing to GHCR (release-only)
│   └── pages.yml                   Build + deploy landing page to GitHub Pages
├── ISSUE_TEMPLATE/
│   ├── bug_report.yml              Bug report template
│   └── feature_request.yml         Feature request template
└── pull_request_template.md        PR description template
```

---

## resources/

Research and reference materials. Living knowledge base.

```
resources/
├── README.md                       Index and usage guide
├── trends/
│   ├── web3-macro-trends-2025-2026.md      10 macro trends + alignment analysis
│   └── a16z-crypto-big-ideas-2025.md       11 themes from a16z 2025 outlook
├── chains/
│   ├── ethereum.md                 State, upgrades (Pectra → Fusaka → Glamsterdam), EIPs
│   └── xrpl.md                     DEX, multi-signing, RLUSD, attestation mechanics
├── protocols/
│   └── stablecoins-and-defi.md     Top stablecoins, DeFi protocols, risk factors
├── standards/
│   └── eips-and-standards.md       EIP-4337, EIP-7702, token standards, XRPL standards
└── architecture/
    └── design-patterns.md          8 design patterns for intent-based financial infra
```

---

## packages/

14 monorepo packages (13 + demo). Dependency direction flows downward — no circular deps.

```
types → registrum, ledger
         ↓           ↓
    chain-observer   |
         ↓           ↓
       vault      treasury
         ↓           ↓
       reconciler ←──┘
         ↓
       witness
         ↓
       event-store (cross-cutting)
         ↓
       verify ──── proof
         ↓
        node (composition root)
         ↓
        sdk (typed client)
```

---

### @attestia/types

Shared domain types. Zero runtime dependencies.

```
packages/types/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                    Package exports
│   ├── financial.ts                Money, Amount, Currency primitives
│   ├── intent.ts                   Intent types and lifecycle states
│   ├── event.ts                    Domain event base types
│   ├── chain.ts                    Chain address, transaction types
│   ├── guards.ts                   Type guards and narrowing functions
│   └── solana.ts                   Solana-specific type extensions
└── tests/
    └── guards.test.ts              62 tests
```

---

### @attestia/registrum

Constitutional governance layer. 11 structural invariants, dual-witness validation, predicate engine, XRPL attestation.

```
packages/registrum/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── LICENSE
├── README.md
├── CONTRIBUTING.md
├── invariants/
│   └── registry.json               11 invariant definitions
├── examples/
│   └── refusal-as-success.ts       Example: principled refusal
├── src/
│   ├── index.ts                    Package exports
│   ├── types.ts                    Registrum domain types
│   ├── invariants.ts               Invariant enforcement engine
│   ├── registrar.ts                Core registrar logic
│   ├── structural-registrar.ts     Structural validation layer
│   ├── version.ts                  Version tracking
│   ├── attestation/
│   │   ├── index.ts
│   │   ├── types.ts                Attestation type definitions
│   │   ├── config.ts               Attestation configuration
│   │   ├── emitter.ts              Attestation event emission
│   │   └── generator.ts            Attestation payload generation
│   ├── cli/
│   │   └── attest.ts               CLI attestation tool
│   ├── persistence/
│   │   ├── index.ts
│   │   ├── rehydrator.ts           State rehydration from events
│   │   ├── replay.ts               Event replay engine
│   │   ├── serializer.ts           Deterministic serialization
│   │   └── snapshot.ts             Snapshot management
│   └── registry/
│       ├── index.ts
│       ├── errors.ts               Registry error types
│       ├── loader.ts               Invariant loader
│       ├── registry-driven-registrar.ts   Registry-driven validation
│       └── predicate/
│           ├── index.ts
│           ├── ast.ts              Predicate AST nodes
│           ├── parser.ts           Predicate expression parser
│           ├── evaluator.ts        Predicate evaluation engine
│           └── validator.ts        Predicate validation
├── tests/
│   ├── invariants.test.ts
│   ├── registry.test.ts
│   ├── property.test.ts            Fast-check property tests
│   ├── attestation/
│   │   ├── emitter.test.ts
│   │   └── generator.test.ts
│   ├── persistence/
│   │   ├── rehydrator.test.ts
│   │   ├── replay.test.ts
│   │   ├── serializer.test.ts
│   │   └── snapshot.test.ts
│   └── parity/                     Parity tests (structural ↔ registry)
│       ├── parity.helpers.ts
│       ├── identity.parity.test.ts
│       ├── lineage.parity.test.ts
│       ├── metadata.parity.test.ts
│       ├── ordering.parity.test.ts
│       ├── persistence.parity.test.ts
│       └── registry-mode.parity.test.ts
│                                   297 tests
└── docs/                           (see Registrum Internal Docs below)
```

---

### @attestia/ledger

Append-only double-entry accounting engine.

```
packages/ledger/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts                    Ledger domain types
│   ├── ledger.ts                   Core ledger engine
│   ├── accounts.ts                 Chart of accounts
│   ├── balance-calculator.ts       Balance computation
│   └── money-math.ts              Arbitrary-precision money arithmetic
└── tests/
    ├── ledger.test.ts
    ├── accounts.test.ts
    ├── balance-calculator.test.ts
    ├── money-math.test.ts
    └── property.test.ts            Fast-check property tests
                                    144 tests
```

---

### @attestia/chain-observer

Multi-chain read-only observation. EVM, XRPL, Solana, L2 adapters.

```
packages/chain-observer/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── observer.ts                 Observer interface + base types
│   ├── finality.ts                 Chain finality abstractions
│   ├── chains.ts                   Chain definitions (CAIP-2 IDs)
│   ├── profiles.ts                 Chain profile configurations
│   ├── registry.ts                 Observer registry (multi-chain)
│   ├── evm/
│   │   ├── index.ts
│   │   ├── evm-observer.ts         EVM observer (viem)
│   │   ├── l2-adapter.ts           L2 gas normalization, receipt fields
│   │   └── reorg-detector.ts       Reorg detection + cross-chain collision
│   ├── xrpl/
│   │   ├── index.ts
│   │   └── xrpl-observer.ts        XRPL observer (xrpl.js)
│   └── solana/
│       ├── index.ts
│       ├── solana-observer.ts       Solana observer
│       ├── log-parser.ts            Program log parsing
│       └── rpc-config.ts            RPC resilience config
└── tests/
    ├── chains.test.ts
    ├── finality.test.ts
    ├── profiles.test.ts
    ├── registry.test.ts
    ├── evm/
    │   ├── evm-observer.test.ts
    │   ├── l2-adapter.test.ts
    │   ├── reorg-detector.test.ts
    │   └── cross-chain-collision.test.ts
    ├── xrpl/
    │   └── xrpl-observer.test.ts
    └── solana/
        ├── solana-observer.test.ts
        ├── log-parser.test.ts
        ├── rpc-resilience.test.ts
        └── replay-determinism.test.ts
                                    242 tests
```

---

### @attestia/vault

Personal vault. Multi-chain observation, envelope budgeting, intent allocation.

```
packages/vault/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── vault.ts                    Vault orchestrator
│   ├── portfolio.ts                Multi-chain portfolio tracking
│   ├── budget.ts                   Envelope budgeting
│   └── intent-manager.ts           Intent declaration and lifecycle
└── tests/
    ├── vault.test.ts
    ├── vault-restore.test.ts
    ├── portfolio.test.ts
    ├── portfolio-branches.test.ts
    ├── budget.test.ts
    └── intent-manager.test.ts
                                    67 tests
```

---

### @attestia/treasury

Org treasury. Deterministic payroll, DAO distributions, dual-gate funding, double-entry integration.

```
packages/treasury/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── treasury.ts                 Treasury orchestrator
│   ├── payroll.ts                  Deterministic payroll engine
│   ├── distribution.ts             DAO distribution plans
│   └── funding.ts                  Dual-gate funding
└── tests/
    ├── treasury.test.ts
    ├── payroll.test.ts
    ├── distribution.test.ts
    └── funding.test.ts
                                    63 tests
```

---

### @attestia/reconciler

Cross-system reconciliation. 3D matching (vault ↔ ledger ↔ chain) with Registrum attestation.

```
packages/reconciler/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── reconciler.ts               Reconciliation orchestrator
│   ├── attestor.ts                 Registrum-backed attestation
│   ├── intent-chain-matcher.ts     Intent ↔ chain matching
│   ├── intent-ledger-matcher.ts    Intent ↔ ledger matching
│   ├── ledger-chain-matcher.ts     Ledger ↔ chain matching
│   └── cross-chain-rules.ts        Cross-chain reconciliation rules
└── tests/
    ├── reconciler.test.ts
    ├── attestor.test.ts
    ├── intent-chain-matcher.test.ts
    ├── intent-ledger-matcher.test.ts
    ├── ledger-chain-matcher.test.ts
    └── cross-chain-rules.test.ts
                                    56 tests
```

---

### @attestia/witness

XRPL attestation witness. On-chain proofs, multi-sig governance, retry with jitter, degraded mode.

```
packages/witness/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── vitest.integration.config.ts    Separate config for Docker/rippled tests
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── witness.ts                  Witness orchestrator
│   ├── payload.ts                  Attestation payload construction
│   ├── memo-encoder.ts             XRPL memo field encoding
│   ├── submitter.ts                Transaction submission to XRPL
│   ├── verifier.ts                 On-chain proof verification
│   ├── retry.ts                    Exponential backoff + jitter
│   └── governance/
│       ├── index.ts
│       ├── types.ts                GovernanceChangeEvent union types
│       ├── signing.ts              Canonical signing payloads (SHA-256 + RFC 8785)
│       ├── governance-store.ts     Event-sourced N-of-M governance store
│       ├── multisig-submitter.ts   Multi-sig transaction submission
│       ├── multisig-witness.ts     Multi-sig witness orchestrator
│       └── registrum-bridge.ts     Governance ↔ Registrum bridge
└── tests/
    ├── witness.test.ts
    ├── witness-mocked.test.ts
    ├── payload.test.ts
    ├── memo-encoder.test.ts
    ├── submitter.test.ts
    ├── submitter-mocked.test.ts
    ├── verifier.test.ts
    ├── verifier-mocked.test.ts
    ├── canonicalization.test.ts
    ├── retry.test.ts
    ├── timeout.test.ts
    ├── governance/
    │   ├── types.test.ts
    │   ├── signing.test.ts
    │   ├── governance-store.test.ts
    │   ├── multisig-submitter.test.ts
    │   ├── multisig-witness.test.ts
    │   ├── registrum-bridge.test.ts
    │   └── security.test.ts
    └── integration/
        └── rippled-standalone.test.ts   Docker-based XRPL round-trip
                                    245 tests
```

---

### @attestia/event-store

Append-only event persistence. In-memory, JSONL, snapshots, hash chain, 34-event catalog.

```
packages/event-store/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts                    EventStore interface
│   ├── in-memory-store.ts          In-memory implementation
│   ├── jsonl-store.ts              JSONL file-based implementation
│   ├── snapshot-store.ts           Snapshot persistence
│   ├── hash-chain.ts               SHA-256 hash chain (RFC 8785)
│   ├── catalog.ts                  Event type catalog + versioning
│   └── attestia-events.ts          34 domain event definitions
└── tests/
    ├── in-memory-store.test.ts
    ├── jsonl-store.test.ts
    ├── hash-chain.test.ts
    ├── hash-chain-property.test.ts  Fast-check property tests
    ├── catalog.test.ts
    ├── snapshot-store.test.ts
    ├── snapshot-integrity.test.ts
    ├── corruption-recovery.test.ts
    ├── migration-roundtrip.test.ts
    └── bench/
        └── event-store.bench.ts    Storage performance benchmark
                                    190 tests
```

---

### @attestia/verify

Deterministic replay verification, state bundles, external verification, compliance evidence, SLA enforcement.

```
packages/verify/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts                    Core verification types
│   ├── replay.ts                   Event replay engine
│   ├── multi-chain-replay.ts       Multi-chain replay verification
│   ├── cross-chain-invariants.ts   Cross-chain invariant checks
│   ├── global-state-hash.ts        Subsystem → global hash computation
│   ├── state-bundle.ts             Exportable state bundle creation + verification
│   ├── verifier-node.ts            Standalone replay verification from bundles
│   ├── verification-consensus.ts   Multi-verifier consensus (majority rule)
│   ├── compliance/
│   │   ├── index.ts
│   │   ├── types.ts                ComplianceFramework, ControlMapping, ComplianceReport
│   │   ├── soc2-mapping.ts         SOC 2 Type II control mappings (CC1–CC9)
│   │   ├── iso27001-mapping.ts     ISO 27001 Annex A control mappings
│   │   └── evidence-generator.ts   Programmatic evidence generation + scoring
│   └── sla/
│       ├── index.ts
│       ├── types.ts                SlaPolicy, SlaTarget, SlaEvaluation
│       ├── sla-engine.ts           Advisory SLA evaluation (fail-closed)
│       └── tenant-governance.ts    Tenant create/suspend/reactivate/validate
└── tests/
    ├── replay.test.ts
    ├── multi-chain-replay.test.ts
    ├── cross-chain-invariants.test.ts
    ├── global-state-hash.test.ts
    ├── state-bundle.test.ts
    ├── verifier-node.test.ts
    ├── verification-consensus.test.ts
    ├── compliance/
    │   ├── soc2-mapping.test.ts
    │   ├── iso27001-mapping.test.ts
    │   └── evidence-generator.test.ts
    ├── sla/
    │   ├── sla-engine.test.ts
    │   ├── tenant-governance.test.ts
    │   └── governance-hardening.test.ts   Adversarial tests (21 tests)
    └── bench/
        ├── replay.bench.ts
        └── multi-chain-replay.bench.ts
                                    200 tests
```

---

### @attestia/proof

Merkle trees, inclusion proofs, attestation proof packaging. New in Phase 12.

```
packages/proof/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts                    MerkleProof, MerkleNode, AttestationProofPackage
│   ├── merkle-tree.ts              Binary SHA-256 Merkle tree
│   └── attestation-proof.ts        Self-contained attestation proof packaging
└── tests/
    ├── merkle-tree.test.ts         Tree build, proof gen/verify, tamper detection
    └── attestation-proof.test.ts   Package create, self-verify, round-trip
                                    53 tests
```

---

### @attestia/node

HTTP REST API service. Hono framework, auth, multi-tenancy, public API, compliance, observability.

```
packages/node/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile                      Multi-stage (node:22-slim)
├── .env.example                    Environment variable reference
├── alerts/
│   └── attestia-alerts.yml         Prometheus alerting rules
├── docs/
│   ├── api-versioning.md           Versioning strategy
│   └── curl-examples.md            curl examples for all endpoints
├── src/
│   ├── main.ts                     Entrypoint (graceful shutdown)
│   ├── app.ts                      Hono app factory
│   ├── config.ts                   Zod-validated env config
│   ├── middleware/
│   │   ├── index.ts
│   │   ├── auth.ts                 API key + JWT authentication
│   │   ├── tenant.ts               Multi-tenant isolation
│   │   ├── rate-limit.ts           Token-bucket rate limiter (authenticated)
│   │   ├── public-rate-limit.ts    IP-based rate limiter (public endpoints)
│   │   ├── idempotency.ts          Idempotency-Key support
│   │   ├── etag.ts                 ETag generation (SHA-256)
│   │   ├── metrics.ts              Prometheus counters + histograms
│   │   ├── logger.ts               Structured pino logging
│   │   ├── request-id.ts           X-Request-Id propagation
│   │   ├── error-handler.ts        Error envelope formatting
│   │   └── validate.ts             Zod request validation
│   ├── routes/
│   │   ├── index.ts
│   │   ├── intents.ts              Intent CRUD + lifecycle (7 endpoints)
│   │   ├── events.ts               Event queries (2 endpoints)
│   │   ├── verify.ts               Replay + hash verification (2 endpoints)
│   │   ├── attestation.ts          Reconcile + attest + list (3 endpoints)
│   │   ├── export.ts               NDJSON events + state snapshot (2 endpoints)
│   │   ├── proofs.ts               Merkle proof generation + verification (4 endpoints)
│   │   ├── compliance.ts           Compliance frameworks + reports (3 endpoints)
│   │   ├── public-verify.ts        Public verification API (5 endpoints, no auth)
│   │   ├── public-openapi.ts       OpenAPI 3.1 schema (1 endpoint)
│   │   ├── health.ts               /health + /ready
│   │   └── metrics.ts              /metrics (Prometheus text)
│   ├── services/
│   │   ├── index.ts
│   │   ├── attestia-service.ts     Composition root (wires all packages)
│   │   ├── tenant-registry.ts      Per-tenant service isolation
│   │   └── audit-log.ts            Append-only audit trail
│   └── types/
│       ├── index.ts
│       ├── api-contract.ts         Route type contracts
│       ├── dto.ts                  Zod-validated DTOs
│       ├── auth.ts                 Auth context types
│       ├── error.ts                Error envelope types
│       └── pagination.ts           Cursor-based pagination types
└── tests/
    ├── setup.ts                    Test harness
    ├── intents.test.ts
    ├── events.test.ts
    ├── verify.test.ts
    ├── attestation.test.ts
    ├── export.test.ts
    ├── health.test.ts
    ├── health-deep.test.ts
    ├── config.test.ts
    ├── audit-log.test.ts
    ├── tenant-registry.test.ts
    ├── idempotency-store.test.ts
    ├── metrics-collector.test.ts
    ├── pagination.test.ts
    ├── middleware/
    │   ├── auth.test.ts
    │   ├── error-handler.test.ts
    │   ├── etag.test.ts
    │   ├── idempotency.test.ts
    │   ├── logger.test.ts
    │   ├── rate-limit.test.ts
    │   ├── public-rate-limit.test.ts
    │   └── tenant.test.ts
    ├── routes/
    │   ├── public-verify.test.ts
    │   ├── public-openapi.test.ts
    │   ├── proofs.test.ts
    │   └── compliance.test.ts
    ├── edge-cases/
    │   ├── concurrent-mutations.test.ts
    │   ├── idempotency-conflict.test.ts
    │   └── rate-limit-recovery.test.ts
    ├── pilot/
    │   └── payroll-lifecycle.test.ts    End-to-end pilot test
    └── bench/
        └── intent-lifecycle.bench.ts    Lifecycle performance benchmark
                                    184 tests
```

---

### @attestia/sdk

Typed HTTP client SDK for external consumers. New in Phase 12.

```
packages/sdk/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                    Package exports
│   ├── types.ts                    AttestiaClientConfig, AttestiaResponse, AttestiaError
│   ├── http-client.ts              Fetch wrapper: retry, timeout, API key injection
│   └── client.ts                   AttestiaClient (intents, verify, proofs namespaces)
└── tests/
    ├── http-client.test.ts         Mock fetch: GET/POST, headers, retry, timeout
    ├── client.test.ts              Mock HTTP: full intent lifecycle, verification, proofs
    └── integration.test.ts         SDK → Hono app bridge: real API integration
                                    50 tests
```

---

### demo

Examples and demonstrations. No tests (not a published package).

```
packages/demo/
└── ...                             Example scripts and usage demos
```

---

## Registrum Internal Docs

The `@attestia/registrum` package maintains its own extensive documentation library.

```
packages/registrum/docs/
├── WHAT_REGISTRUM_IS.md            Identity and purpose
├── INVARIANTS.md                   11 structural invariants explained
├── PROVABLE_GUARANTEES.md          Formal guarantee definitions
├── ATTESTATION_SPEC.md             Attestation format specification
├── CANONICAL_SERIALIZATION.md      RFC 8785 implementation notes
├── ARCHITECTURAL_CONSTRAINTS.md    Hard boundaries
├── DEFINITIONS.md                  Term definitions
├── FAILURE_MODES.md                Expected failure behaviors
├── FAILURE_BOUNDARIES.md           Blast radius containment
├── FAILURE_STORY_SCHEMA_EVOLUTION.md   Schema evolution case study
├── HISTORY_AND_REPLAY.md           Replay mechanics
├── MIGRATION_CRITERIA.md           Migration decision criteria
├── PACKAGING_INTEGRITY.md          Package integrity guarantees
├── PHASE1_SPEC.md                  Phase 1 specification
├── PHASE_H_REPORT.md              Hardening phase report
├── GOVERNANCE_HANDOFF.md           Governance handoff documentation
├── SCIENTIFIC_POSITION.md          Scientific foundations
├── STEWARD_CLOSING_NOTE.md         Steward closing remarks
├── WHY_XRPL.md                     XRPL selection rationale
├── XRPL_ATTESTATION.md             XRPL attestation mechanics
├── ROADMAP.md                      Registrum-specific roadmap
├── ROADMAP_ECOSYSTEM.md            Ecosystem expansion roadmap
├── RELEASE_CHECKLIST.md            Release process checklist
├── TUTORIAL_DUAL_WITNESS.md        Dual-witness tutorial
├── decisions/
│   ├── .gitkeep
│   └── 001-PHASE_D_CUTOVER.md     Phase D cutover decision record
├── proposals/
│   ├── .gitkeep
│   ├── 001-PHASE_D_CUTOVER.md     Phase D cutover proposal
│   ├── 002-PHASE_9_OPERATIONAL_CHANGES.md   Phase 9 ops proposal (Class B)
│   └── 003-PHASE_10_CATEGORY_STANDARD.md    Phase 10.5 proposal (Class A)
└── governance/
    ├── SCOPE.md                    Governance scope
    ├── ROLES.md                    Role definitions
    ├── PHILOSOPHY.md               Governance philosophy
    ├── CHANGE_CLASSES.md           Change classification (A/B/C)
    ├── DECISION_ARTIFACTS.md       Decision artifact requirements
    ├── DUAL_WITNESS_POLICY.md      Dual-witness policy
    ├── EMERGENCY_POWERS.md         Emergency procedures
    ├── ECOSYSTEM_EXPANSION_POLICY.md   Expansion governance
    ├── VERSIONING.md               Versioning policy
    ├── RFC_PROCESS.md              RFC lifecycle (Draft → Review → Final)
    └── templates/
        ├── PROPOSAL_TEMPLATE.md
        ├── DECISION_RECORD_TEMPLATE.md
        └── GUARANTEE_IMPACT_TEMPLATE.md
```

---

## File Counts by Type

| Type | Count | Description |
|------|-------|-------------|
| `.ts` (src) | ~160 | Source files |
| `.ts` (test) | ~130 | Test files |
| `.ts` (bench) | 4 | Benchmark files |
| `.ts` (config) | 13 | vitest.config.ts per package |
| `.md` (root) | 16 | Top-level documentation |
| `.md` (specs) | 10 | RFC specifications |
| `.md` (registrum) | 30+ | Registrum internal docs |
| `.md` (node) | 2 | API docs |
| `.md` (resources) | 7 | Research materials |
| `.json` | 17 | package.json (15) + tsconfig (1) + invariants (1) |
| `.yml` | 8 | workflows (3: ci, docker, pages), Docker Compose, issue templates (2), alerts, codecov |
| `.png` | 1 | Logo |

---

## Dependency Graph (External)

| Dependency | Used By | Purpose |
|------------|---------|---------|
| `viem` | chain-observer | Ethereum + L2 RPC |
| `xrpl` | chain-observer, witness | XRPL WebSocket client |
| `@solana/web3.js` | chain-observer | Solana RPC |
| `hono` | node | HTTP framework |
| `pino` | node | Structured logging |
| `zod` | node | Schema validation |
| `json-canonicalize` | registrum, event-store, reconciler, verify, proof | RFC 8785 deterministic JSON |
| `vitest` | all | Test runner |
| `fast-check` | registrum, ledger, event-store | Property-based testing |
| `@vitest/coverage-v8` | all | Coverage instrumentation |

---

## Navigation

| What you need | Where to look |
|---------------|---------------|
| Project overview | [README.md](README.md) |
| Executive summary | [HANDBOOK.md](HANDBOOK.md) |
| What's planned | [ROADMAP.md](ROADMAP.md) |
| How it's built | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Why decisions were made | [DESIGN.md](DESIGN.md) |
| Security posture | [THREAT_MODEL.md](THREAT_MODEL.md), [CONTROL_MATRIX.md](CONTROL_MATRIX.md) |
| How to verify | [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) |
| How to integrate | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| API examples | [packages/node/docs/curl-examples.md](packages/node/docs/curl-examples.md) |
| Formal specs | [specs/](specs/) |
| Governance process | [packages/registrum/docs/governance/](packages/registrum/docs/governance/) |
| Research materials | [resources/](resources/) |
| Benchmarks | [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) |
| Responsible disclosure | [SECURITY.md](SECURITY.md) |
| SDK usage | [packages/sdk/](packages/sdk/) |
| Public verification API | [specs/RFC-009-EXTERNAL-VERIFICATION.md](specs/RFC-009-EXTERNAL-VERIFICATION.md) |
| Compliance evidence | [specs/RFC-008-COMPLIANCE-EVIDENCE.md](specs/RFC-008-COMPLIANCE-EVIDENCE.md) |
