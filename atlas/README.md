# attestia: how it works

Mapped at 2026-09-30 from commit 56da319 by Atlas 1.24.0.

## What this is

23 parts, mostly TypeScript (407 files), CSS (2), JavaScript (2) and Astro (1). Work enters through 5 doors; the busiest is Publish to GHCR, which reaches 16 parts. It publishes @mcptoolshop/attestia to npm and a container image. It deploys a site to GitHub Pages. People import @mcptoolshop/attestia.

## What changed since 2026-09-24 (245af30)

- CI's pull request trigger now also names `codecov.yml`.
- CI's push trigger now also names `codecov.yml`.
- CI now also builds packages/attestia/src/chain-observer.ts, packages/attestia/src/event-store.ts, packages/attestia/src/index.ts and 10 more.
- And 5 more changes to doors.
- 1 file added and 589 changed content, across 22 parts.

## What comes in

1. **Publish to GHCR.** When a release is published; or by hand. Runs packages/node/src/main.ts; builds packages/attestia/src/chain-observer.ts, packages/attestia/src/event-store.ts, packages/attestia/src/index.ts and 193 more; packs package.json, packages/, packages/attestia/package.json and 17 more into an image.
2. **CI.** On a pull request to main touching 13 paths; on a push to main touching 13 paths; or by hand. Runs packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts, packages/chain-observer/tests/evm/ and 175 more; builds packages/attestia/src/chain-observer.ts, packages/attestia/src/event-store.ts, packages/attestia/src/index.ts and 193 more.
3. **Release.** When a tag matching `v*` is pushed. Runs packages/attestia/tests/, packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts and 181 more; builds packages/attestia/src/chain-observer.ts, packages/attestia/src/event-store.ts, packages/attestia/src/index.ts and 193 more.
4. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
5. **@mcptoolshop/attestia** (the package people import). Loads packages/attestia/dist/index.d.ts, built from a source this map cannot place.

## What happens through Publish to GHCR

1. The workflow runs packages/node/src/main.ts in node; it builds 13 files in attestia, packages/chain-observer/src/ in chain-observer, packages/demo/src/ in demo, packages/event-store/src/ in event-store, packages/ledger/src/ in ledger, and 146 files in 10 more parts; it packs packages/attestia/package.json in attestia, packages/chain-observer/package.json in chain-observer, packages/demo/package.json in demo, packages/event-store/package.json in event-store, packages/ledger/package.json in ledger, and 419 files in 12 more places into an image.
   1. Inside packages/node/src/main.ts, `main` does, in order: `loadConfig`, `parseApiKeys` and `createApp`.
   2. **`createApp`** runs, in order:
      1. `requestIdMiddleware`
      2. `loggerMiddleware`
      3. `metricsMiddleware`
      4. `createErrorHandler`
      5. `createHealthRoutes`
      6. `authMiddleware`
      7. `createMetricsRoute`
      8. `createPublicVerifyRoutes`
      9. `createPublicProofRoutes`
      10. `createPublicComplianceRoutes`
      11. `createPublicOpenApiRoutes`
2. It publishes a container image.

## Who reads the results

Publish to GHCR writes nothing this map can see.

## The other doors

**CI** runs packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts, packages/chain-observer/tests/evm/ and 175 more, builds packages/attestia/src/chain-observer.ts, packages/attestia/src/event-store.ts, packages/attestia/src/index.ts and 193 more, and uploads coverage to Codecov.

**Release** runs packages/attestia/tests/, packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts and 181 more, builds packages/attestia/src/chain-observer.ts, packages/attestia/src/event-store.ts, packages/attestia/src/index.ts and 193 more, publishes @mcptoolshop/attestia to npm, and creates a GitHub release.

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**@mcptoolshop/attestia** (the package people import) loads packages/attestia/dist/index.d.ts, built from a source this map cannot place.

## What breaks what

- **types** is imported by 13 parts (attestia, chain-observer, demo, event-store, ledger, node, proof, reconciler, registrum, treasury, vault, verify, witness) and sits on the path of 3 doors.
- **ledger** is imported by 7 parts (attestia, demo, node, reconciler, treasury, vault, verify) and sits on the path of 3 doors.
- **registrum** is imported by 5 parts (attestia, demo, node, reconciler, verify) and sits on the path of 3 doors.
- **chain-observer** is imported by 4 parts (attestia, demo, node, vault) and sits on the path of 3 doors.
- **reconciler** is imported by 4 parts (attestia, demo, node, witness) and sits on the path of 3 doors.
- **event-store** is imported by 3 parts (attestia, demo, node) and sits on the path of 3 doors.
- **proof** is imported by 3 parts (attestia, demo, node) and sits on the path of 3 doors.
- **vault** is imported by 3 parts (attestia, demo, node) and sits on the path of 3 doors.

## What tends to change together

No two source files changed together often enough to name.

Window: 180 days; a pair counts from 3 shared commits, since the window holds fewer than 30 qualifying commits.

## What no test touches

- **demo** is imported by no test.
- **scripts** is imported by no test.

## Written but never read

No place this map can see is written, so none goes unread.

## Helpers that look duplicated

These are candidates from names and call order, not a judgement.

- **withRetry** is exported by packages/chain-observer/src/retry.ts (chain-observer) and packages/witness/src/retry.ts (witness); the two look alike.

## Generated, never hand-edited

Nothing in this repository writes to a tracked place this map can see.

## Hand-authored

People write .github/, assets/, docs/, resources/, the repository root, site/ and specs/; 5 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → packages/chain-observer/src/index.ts → packages/types/src/chain.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 5 writes and 7 reads use paths built at run time and are not named here.
- 6 writes and 66 reads go to a path their caller passes, not to this repository.
- There is a docker-compose.yml that no workflow runs; what deploys from it does so from outside this repository, and is not on this page.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 25 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
