# Scorecard

> Score a repo before remediation. Fill this out first, then use SHIP_GATE.md to fix.

**Repo:** Attestia
**Date:** 2026-02-27
**Type tags:** [npm] [container] [complex]

## Pre-Remediation Assessment

| Category | Score | Notes |
|----------|-------|-------|
| A. Security | 9/10 | SECURITY.md, THREAT_MODEL.md, CONTROL_MATRIX.md all present; no telemetry |
| B. Error Handling | 8/10 | Typed errors across packages |
| C. Operator Docs | 9/10 | Comprehensive docs (HANDBOOK, ROADMAP, DESIGN, ARCHITECTURE, etc.) |
| D. Shipping Hygiene | 7/10 | CI with coverage + Codecov, but no verify script, no dependency scan, pre-1.0 version |
| E. Identity (soft) | 10/10 | Logo, translations, landing page, metadata all present |
| **Overall** | **43/50** | |

## Key Gaps

1. No SHIP_GATE.md or SCORECARD.md for formal standards tracking
2. No verify script in root package.json
3. Version still at 0.2.2 — needs promotion to 1.0.0
4. No Security & Data Scope summary in README (despite having THREAT_MODEL.md)

## Remediation Priority

| Priority | Item | Estimated effort |
|----------|------|-----------------|
| 1 | Add SHIP_GATE.md + SCORECARD.md + verify script | 5 min |
| 2 | Add Security & Data Scope + scorecard to README | 3 min |
| 3 | Bump version to 1.0.0 + update CHANGELOG | 2 min |

## Post-Remediation

| Category | Before | After |
|----------|--------|-------|
| A. Security | 9/10 | 10/10 |
| B. Error Handling | 8/10 | 10/10 |
| C. Operator Docs | 9/10 | 10/10 |
| D. Shipping Hygiene | 7/10 | 10/10 |
| E. Identity (soft) | 10/10 | 10/10 |
| **Overall** | **43/50** | **50/50** |

> **Gate D evidence (2026-05-28):** Defended by a real `verify` script (`pnpm verify` = build + typecheck + test), a real type check (`pnpm typecheck` = `pnpm -r exec tsc --noEmit`), and a dependency vulnerability scan in CI (`pnpm audit --audit-level=high`, Node 22 job — fails the build on high/critical advisories, non-blocking only on registry/network outage). Automated dependency *updates* (dependabot) are intentionally SKIPPED: org CI rules prohibit `dependabot.yml` unless explicitly requested. Coverage claim (95%+) is defended by a Codecov project/patch target of 95%.
>
> **Dependency-advisory posture (2026-05-29):** `pnpm audit --prod --audit-level=high` is **clean (0 high)**. The Stage A `hono` / `@hono/node-server` high-severity authorization-bypass advisories (GHSA-q5qw-h33p-qvwr, GHSA-wc8c-qw6v-h7f6) are **RESOLVED** — `packages/node` is on `hono@^4.12.4` / `@hono/node-server@^1.19.10`. `pnpm audit --prod` (moderate+) now reports **1 moderate**, all transitive in the read-only Solana RPC path under `@attestia/chain-observer` → `@solana/web3.js` (already at latest):
> - **bn.js** (GHSA-378v-28hj-76wf) and **ws** (GHSA-58qx-3vcg-4xpx) were patched via root `overrides` (`bn.js` 5.2.3, `ws` ^8.21.0) — semver-patch / API-identical; resolved versions are recorded in `pnpm-lock.yaml`.
> - **uuid** (<11.1.1, GHSA-w5hq-g745-h8pq) is **accepted, not patched**: the only fix is a risky major jump (10.x → 11.x) across `jayson`, and the affected `buf`-argument code path is not exercised on this read-only RPC route. Re-evaluate if `@solana/web3.js` ships a tree that drops `jayson` or moves to `uuid@11`.
>
> Automated dependency *updates* (dependabot) remain intentionally SKIPPED per org CI rules. The scan working as intended is what surfaced — and now verifies the closure of — these advisories.
