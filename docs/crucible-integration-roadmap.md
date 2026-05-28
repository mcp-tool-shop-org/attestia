# Attestia Integration Roadmap — Crucible's Audit Chain Backbone

**Status:** Planned future dogfood swarm. Not yet executed.
**Target repo:** [`mcp-tool-shop-org/Attestia`](https://github.com/mcp-tool-shop-org/Attestia)
**Consumer:** crucible (and downstream eval projects)
**Date drafted:** 2026-05-27

---

## Why

Attestia is `mcp-tool-shop-org`'s "financial truth infrastructure for the decentralized world" — append-only event persistence, hash-chained, XRPL-attested, with structural governance via the Registrum component. Its core primitives are domain-neutral; its current event types and surrounding packages are finance-domain (Personal Vault, Org Treasury, Registrum).

Crucible needs exactly the same primitives (append-only with tamper-evident chain, schema-versioned events, multi-channel attestation) applied to eval-domain artifacts (puzzle attempts, judge evaluations, panel votes, rubric bundles, calibration runs). Rather than build a parallel transparent log from scratch, we extend Attestia into a general-purpose audit-chain framework that serves finance, eval, and other future domains.

The dogfood swarm plans the extension work needed on Attestia to bring it in line with crucible's audit-chain needs.

---

## What Attestia currently provides (as of 2026-05-27)

From [`mcp-tool-shop-org/Attestia`](https://github.com/mcp-tool-shop-org/Attestia), main branch:

- **`@attestia/event-store`** — append-only persistence with SHA-256 hash chaining (RFC 8785 canonical JSON), `InMemoryEventStore` + `JsonlEventStore`, `EventCatalog` for schema registration and versioning, `verifyHashChain()` for integrity, snapshot store, optimistic concurrency, per-stream and global subscriptions, 190 tests.
- **`@attestia/ledger`**, **`@attestia/treasury`**, **`@attestia/vault`** — finance-domain ledgers and aggregates.
- **`@attestia/registrum`** — structural registrar with 11 invariants and dual-witness validation.
- **`@attestia/proof`**, **`@attestia/witness`** — XRPL attestation primitives.
- **`@attestia/reconciler`**, **`@attestia/verify`** — cross-system reconciliation and verification.
- **`@attestia/chain-observer`**, **`@attestia/node`**, **`@attestia/sdk`**, **`@attestia/types`** — supporting infrastructure.

Architecture follows `Intent → Approve → Execute → Verify`. License MIT.

---

## What crucible needs Attestia to add

1. **Eval-domain event types** registered via `EventCatalog` — `crucible.puzzle.*`, `crucible.judge.*`, `crucible.panel.*`, `crucible.bundle.*`, `crucible.tuning.*`, `crucible.preregistration.*`.
2. **ML supply-chain bridges** — in-toto v1 envelope generation, RFC 3161 TSA client, Sigstore/Rekor integration with `cosign sign-blob`.
3. **Multi-channel attestation orchestration** — XRPL (existing) + Sigstore (new) + RFC 3161 (new), with policy (all/any/majority) and verification of all channels.
4. **Inspect AI integration** — bridge so frontier-eval task runs (UK AISI's Inspect framework) emit Attestia events natively.
5. **Public verification SDK** — given a bundle hash, walk the event chain and produce a tamper-evidence report.
6. **Statistical reporting layer** — pass^k computation, Wilson / Clopper-Pearson / Bayesian intervals (via `bayes_evals`), McNemar's exact test, BH-FDR and Westfall-Young correction, all operating on event streams.

The first three are necessary for crucible's §9 audit chain to land. The last three are integration polish that makes crucible-on-Attestia trivial to use from external auditor tooling.

---

## Phase plan (dogfood swarm)

Targeting the established 10-phase dogfood-swarm pattern (health pass → feature pass → final test → full treatment).

### Phase 1 — Health pass (baseline)

Three parallel agents on current Attestia codebase:

- **1a — Bug pass.** Defect detection across all packages. Identify anything that blocks integration: leak under high event volume in `InMemoryEventStore`, `JsonlEventStore` performance at >10k events/stream, race conditions in subscriptions, hash-chain edge cases (genesis, snapshots).
- **1b — Proactive pass.** Identify untracked gaps: finance-coupling in supposedly-generic packages (e.g., does `verify` assume a ledger context?), undocumented assumptions, domain leakage into core abstractions.
- **1c — Humanize pass.** Review error messages, docs, READMEs for clarity to non-finance users. Anything that would confuse an eval engineer picking it up.

**Output:** PRs against Attestia main, baseline triage report, decisions on which generic-vs-finance refactors are needed.

### Phase 2 — Eval-domain event schema design

Extend `EventCatalog` with crucible-aware event types:

```typescript
'crucible.puzzle.published'              // designer commits a new puzzle to Lab
'crucible.puzzle.attempted.started'      // solver begins attempt
'crucible.puzzle.attempted.completed'    // solver submits solution
'crucible.judge.evaluation.requested'    // kernel asks panel to score
'crucible.judge.evaluation.completed'    // panel returns verdict
'crucible.panel.vote.cast'               // individual judge vote
'crucible.panel.consensus.reached'       // panel-level decision
'crucible.bundle.compiled'               // tuning produces new rubric.bundle
'crucible.bundle.released'               // bundle promoted to active
'crucible.tuning.iteration.completed'    // BO step finishes
'crucible.tuning.frozen'                 // tuning protocol completes
'crucible.preregistration.filed'         // AsPredicted URL recorded
'crucible.regression.demoted'            // saturated puzzle archived
```

Each event:
- JSON Schema (versioned per Attestia's existing pattern)
- TypeScript types
- Round-trip serialization tests
- Migration path declarations

**Output:** new event types registered, schema files in `packages/event-store/src/schemas/crucible/`, tests, migration docs.

### Phase 3 — In-toto v1 bridge

**New package:** `@attestia/in-toto`

- Event → in-toto v1 DSSE attestation envelope conversion
- Subject digest extraction (puzzle hash, transcript hash, bundle hash from event payload)
- DSSE envelope generation with configurable signers
- Verification utilities compatible with `cosign verify` and `slsa-verifier` out of the box
- Reference impl pattern from `sigstore/model-transparency`

**Output:** `@attestia/in-toto` on npm, integration with `@attestia/event-store` event streams.

### Phase 4 — RFC 3161 TSA integration

**New package:** `@attestia/timestamp`

- TSA client with configurable backends — Stanford (`timestamp.stanford.edu`, free), FreeTSA, Sectigo, DigiCert
- Batch Merkle root → TSA `TimeStampToken` attachment
- Token verification helpers
- Integration with `@attestia/event-store`: batches can be stamped with TSA tokens at boundaries

**Output:** `@attestia/timestamp` on npm, configurable backend support, integration tests against live Stanford TSA.

### Phase 5 — Sigstore + Rekor integration

**New package:** `@attestia/sigstore`

- `cosign sign-blob` wrappers for event payloads
- Rekor inclusion logging
- OIDC keyless identity via GitHub Actions tokens
- Verification utilities
- Reference pattern from Google Security's "Taming the Wild West of ML: Practical Model Signing with Sigstore" (April 2025)

**Output:** `@attestia/sigstore` on npm, GitHub Actions workflow templates for CI-time signing.

### Phase 6 — Multi-channel witness orchestration

Extend `@attestia/witness` with multi-channel support. Single API:

```typescript
await witness.attestBatch(batchHash, {
  channels: ['xrpl', 'sigstore', 'rfc3161'],
  policy: 'all',  // or 'any' or 'majority'
});

const result = await witness.verifyBatch(batchHash);
// { xrpl: 'verified', sigstore: 'verified', rfc3161: 'verified' }
```

Defense in depth: a single channel can be compromised or unavailable without invalidating the attestation chain.

**Output:** extended `@attestia/witness`, orchestration tests, documentation of trust assumptions per channel.

### Phase 7 — Inspect AI integration

**New package:** `@attestia/inspect-bridge`

- UK AISI Inspect AI task runners emit Attestia events natively
- Bidirectional: Inspect logs → Attestia events, Attestia event stream → Inspect viewer
- Compatible with Anthropic / DeepMind / METR existing eval workflows

**Output:** bridge package, example Inspect task definitions wired to Attestia.

### Phase 8 — Public verification SDK

**New package:** `@attestia/verify-public`

Given a bundle hash, walks the event chain end-to-end:
- Locate all events referencing the bundle
- Verify hash chain integrity from genesis (via `verifyHashChain()`)
- Verify all attestation channels (XRPL, Sigstore, RFC 3161)
- Produce a tamper-evidence report (machine-readable JSON + human-readable Markdown)

**Output:** CLI + library, example reports against a known-good and a deliberately-tampered chain.

### Phase 9 — Reproducibility statistics layer

**New package:** `@attestia/eval-stats`

Wraps event streams in statistical analysis primitives matching crucible's §9.3 statistical stack:
- pass^k computation from event sequences
- Wilson / Clopper-Pearson / Bayesian beta-binomial intervals (delegated to `bayes_evals`)
- McNemar's exact test for paired model comparison
- BH-FDR and Westfall-Young correction
- Distribution-shaped reports (not point estimates) for closed-API models

**Output:** stats package, integration with `bayes_evals` reference library, example notebooks generating crucible-style figures from event streams.

### Phase 10 — Full treatment

Per the `full-treatment` skill:
- shipcheck audit (must pass before release)
- repo-knowledge DB entry
- handbook integration (Starlight docs site)
- README translations in 8 languages via polyglot-mcp / TranslateGemma 12B (local, free)
- Documentation site refresh
- npm publish for all new packages
- Tagged release on GitHub

**Output:** ship-ready Attestia release with all new packages live on npm.

---

## Sequencing

```
Phase 1 (health pass)
  ↓
Phase 2 (eval event schemas)
  ├→ Phase 3 (in-toto bridge)         ┐
  ├→ Phase 4 (RFC 3161 integration)   ├→ Phase 6 (multi-channel witness)  ┐
  └→ Phase 5 (Sigstore/Rekor)         ┘                                   │
                                                                          ↓
                                                                  Phase 8 (verify-public)
Phase 7 (Inspect bridge) — independent
Phase 9 (eval-stats) — independent
                                                                          ↓
                                                                  Phase 10 (full treatment)
```

Phases 3-5 are parallel-safe. Phase 6 depends on all three. Phase 7 and 9 are independent of the attestation work. Phase 10 ties everything together.

Estimated total cost: 1 dogfood-swarm session (10 phases, parallel where possible), ~1 week of swarm execution.

---

## Crucible dependency

Crucible's Phase 1 instrument-quality scaffolding currently lists "transparent log via `@attestia/event-store`" as a deliverable. With this roadmap completed, Crucible's Phase 4 (architectural lock + first diagnostic cycle) depends on:

- **Attestia Phase 2** (eval event schemas) — required before kernel emits events
- **Attestia Phase 3-5** (in-toto + RFC 3161 + Sigstore) — required for §9.5 release stamping
- **Attestia Phase 6** (multi-channel witness) — required for full defense-in-depth attestation
- **Attestia Phase 8** (verify-public) — required for inviting external auditors per §9.6

**Attestia Phase 7 (Inspect bridge) and Phase 9 (eval-stats) are nice-to-have for Crucible Phase 4 but not blocking** — Crucible can produce its first audit-ready diagnostic cycle without them, then adopt as they ship.

---

## Out of scope (for now)

- **Replacing Attestia's financial-domain packages** — Personal Vault, Org Treasury, Registrum's 11 finance invariants stay as-is. The eval-domain extensions live alongside them, not instead of them. Attestia becomes multi-domain, not eval-only.
- **Migrating away from XRPL** — XRPL remains the primary witness channel. Sigstore + RFC 3161 are added as additional independent channels for defense in depth.
- **Building crucible-specific tooling inside Attestia** — Crucible stays the consumer; Attestia provides domain-neutral primitives once eval event types are registered. Crucible's puzzle catalog, kernel mediation, judge orchestration, and scoring logic stay in `dogfood-lab/crucible`.
- **Cross-domain reconciliation** — Attestia has a `@attestia/reconciler` for financial cross-system reconciliation. Whether eval reconciliation (e.g., judge panel cross-validation against external benchmarks) belongs in `@attestia/reconciler` or in a separate package is a Phase 2 design decision.

---

## Open questions

To resolve during Phase 1-2:

1. **Are there current finance-coupling assumptions in core packages that need refactoring?** Phase 1b proactive pass surfaces this.
2. **Does `@attestia/registrum`'s 11-invariant pattern transfer to eval domain, or does eval need its own invariant set?** Phase 2 design decision.
3. **Should `crucible.*` event types live in `@attestia/event-store` core, or in a separate `@attestia/eval-schemas` package?** Architectural call during Phase 2.
4. **Is `@attestia/reconciler` reusable for cross-family panel reconciliation, or is that crucible-specific?** Phase 1-2 evaluation.
5. **What's the right policy default for multi-channel witness in eval contexts — `all` (strictest), `majority` (resilient), or `any` (most permissive)?** Phase 6 calibration, informed by §9 design.

---

## Triggering this swarm

When ready to execute: invoke the `dogfood-swarm` skill against `mcp-tool-shop-org/Attestia` with this roadmap as the scope document. The swarm will run the 10-phase plan, producing PRs against Attestia main and (in Phase 10) a tagged release with all new packages live on npm.

Crucible's Phase 4 diagnostic-cycle work can begin in parallel against current Attestia (`@attestia/event-store` as it stands today) using stub adapters for the not-yet-existing in-toto / RFC 3161 / Sigstore bridges. Those stubs get replaced as Phases 3-5 ship.
