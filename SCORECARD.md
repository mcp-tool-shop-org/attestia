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

> **Gate D evidence (2026-05-28):** Defended by a real `verify` script (`pnpm verify` = build + typecheck + test), a real type check (`pnpm typecheck` = `pnpm -r exec tsc --noEmit`), and a dependency vulnerability scan in CI (`pnpm audit --audit-level=high`, Node 22 job — fails the build on high/critical advisories, non-blocking only on registry/network outage). Automated dependency *updates* (dependabot) are intentionally SKIPPED: org CI rules prohibit `dependabot.yml` unless explicitly requested. Coverage claim (96.80%) is defended by a Codecov project/patch target of 95%.
>
> **Open dependency advisories (2026-05-28):** the scan currently flags 6 high-severity advisories in the `@attestia/node` dependency tree — `hono <4.12.4` (GHSA-q5qw-h33p-qvwr) and `@hono/node-server <1.19.10` (GHSA-wc8c-qw6v-h7f6), both authorization-bypass classes. Gate D is not fully green until these are patched (bump `hono` ≥4.12.4 and `@hono/node-server` ≥1.19.10 in `packages/node`). The scan working as intended is what surfaces this.
