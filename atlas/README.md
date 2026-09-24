# attestia: how it works

Mapped at 2026-09-24 from commit f0d4cf2.

## What this is

23 parts, mostly TypeScript (407 files). Work enters through 4 doors; the busiest is Publish to GHCR, which reaches 16 parts. It publishes to npm and a container image.

## What changed since the last map

This is the first map.

## What comes in

1. **Publish to GHCR.** When a release is published; or by hand. Checks package.json, packages/, pnpm-lock.yaml and 2 more.
2. **Release.** When a tag matching `v*` is pushed. Runs packages/attestia/tests/, packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts and 94 more; checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more.
3. **CI.** On a pull request touching 12 paths; on a push to main touching 12 paths; or by hand. Runs packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts, packages/chain-observer/tests/evm/ and 93 more; checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more.
4. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.

## What happens through Publish to GHCR

1. The workflow checks 4 files in the repository root and packages/ (15 parts).
2. It publishes a container image.

## Who reads the results

Publish to GHCR writes nothing this map can see.

## The other doors

**Release** runs packages/attestia/tests/, packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts and 94 more, checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more, publishes to npm, and creates a GitHub release.

**CI** runs packages/chain-observer/tests/chains.test.ts, packages/chain-observer/tests/error-ux.test.ts, packages/chain-observer/tests/evm/ and 93 more, and checks packages/chain-observer/src/, packages/demo/src/, packages/event-store/src/ and 11 more.

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

## What breaks what

- **chain-observer** is imported by no other part and sits on the path of 3 doors.
- **demo** is imported by no other part and sits on the path of 3 doors.
- **event-store** is imported by no other part and sits on the path of 3 doors.
- **ledger** is imported by no other part and sits on the path of 3 doors.
- **node** is imported by no other part and sits on the path of 3 doors.
- **proof** is imported by no other part and sits on the path of 3 doors.
- **reconciler** is imported by no other part and sits on the path of 3 doors.
- **registrum** is imported by no other part and sits on the path of 3 doors.

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

People write .github/, assets/, docs/, resources/, the repository root, site/ and specs/; 10 writes with paths built at run time may land here.

## Where to start

Publish to GHCR runs no code this map can follow; it only checks code, so there is no path of files to read in order.

## What this map cannot see

- 10 writes and 13 reads use paths built at run time and are not named here.
- 1 write and 2 reads go to the directory the command is run in, the home directory or a path its caller passes, not to this repository.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 20 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
