# attestia: how it works

Mapped at 2026-09-24 from commit 245af30.

## What this is

23 parts, mostly TypeScript (407 files). Work enters through 5 doors; the busiest is Publish to GHCR, which reaches 16 parts. It publishes @mcptoolshop/attestia (packages/attestia) to npm and a container image. People run attestia-demo.

## What changed since 2026-09-24 (f0d4cf2)

- attestia now imports chain-observer.
- attestia now imports event-store.
- attestia now imports ledger.
- And 49 more new imports between parts.
- Publish to GHCR now also runs packages/node/src/main.ts.
- attestia-demo (packages/demo/package.json) is a new command. It runs packages/demo/src/index.ts.
- 1 file changed content, across 1 part.

## What comes in

1. **Publish to GHCR.** When a release is published; or by hand. Runs packages/node/src/main.ts; checks package.json, packages/, pnpm-lock.yaml and 2 more.
2. **Release.** When a tag matching `v*` is pushed. Runs packages/attestia/tests/, packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts and 94 more; checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more.
3. **CI.** On a pull request touching 12 paths; on a push to main touching 12 paths; or by hand. Runs packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts, packages/chain-observer/tests/evm/ and 93 more; checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more.
4. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
5. **attestia-demo** (a command people run). Runs packages/demo/src/index.ts.

## What happens through Publish to GHCR

1. The workflow runs packages/node/src/main.ts in node; it checks 4 files in the repository root and packages/ (15 parts).
   1. Inside packages/node/src/main.ts, main does, in order: load config, parse api keys and create app.
   2. **Create app** runs, in order:
      1. request id middleware
      2. logger middleware
      3. metrics middleware
      4. create error handler
      5. create health routes
      6. auth middleware
      7. create metrics route
      8. create public verify routes
      9. create public proof routes
      10. create public compliance routes
      11. create public open api routes
2. It publishes a container image.

## Who reads the results

Publish to GHCR writes nothing this map can see.

## The other doors

**Release** runs packages/attestia/tests/, packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts and 94 more, checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more, publishes @mcptoolshop/attestia (packages/attestia) to npm, and creates a GitHub release.

**CI** runs packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts, packages/chain-observer/tests/evm/ and 93 more, and checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more.

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**attestia-demo** (a command people run) runs packages/demo/src/index.ts and reaches chain-observer, event-store, ledger, proof, reconciler, registrum, types, vault and verify.

## What breaks what

- **types** is imported by 13 parts (attestia, chain-observer, demo, event-store, ledger, node, proof, reconciler, registrum, treasury, vault, verify, witness) and sits on the path of 4 doors.
- **ledger** is imported by 7 parts (attestia, demo, node, reconciler, treasury, vault, verify) and sits on the path of 4 doors.
- **registrum** is imported by 5 parts (attestia, demo, node, reconciler, verify) and sits on the path of 4 doors.
- **chain-observer** is imported by 4 parts (attestia, demo, node, vault) and sits on the path of 4 doors.
- **reconciler** is imported by 4 parts (attestia, demo, node, witness) and sits on the path of 4 doors.
- **event-store** is imported by 3 parts (attestia, demo, node) and sits on the path of 4 doors.
- **proof** is imported by 3 parts (attestia, demo, node) and sits on the path of 4 doors.
- **vault** is imported by 3 parts (attestia, demo, node) and sits on the path of 4 doors.

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

.github/workflows/ci.yml → packages/node/src/main.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 5 writes and 7 reads use paths built at run time and are not named here.
- 6 writes and 66 reads go to the directory the command is run in, the home directory or a path its caller passes, not to this repository.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 25 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
