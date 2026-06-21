import { defineConfig } from "tsup";

/**
 * Bundles the public API of every core @attestia/* library into a single,
 * self-contained published package (@mcptoolshop/attestia).
 *
 * - `noExternal: [/^@attestia\//]` INLINES the internal workspace packages, so
 *   the published tarball has zero `@attestia/*` runtime deps (no sprawl).
 * - Third-party deps (xrpl, viem, @solana/web3.js, json-canonicalize,
 *   ripple-keypairs) stay EXTERNAL and are declared in package.json
 *   `dependencies` — the consumer's package manager resolves them.
 * - `splitting: true` deduplicates shared inlined code (e.g. @attestia/types)
 *   into common chunks instead of copying it into every subpath entry.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    types: "src/types.ts",
    ledger: "src/ledger.ts",
    registrum: "src/registrum.ts",
    "event-store": "src/event-store.ts",
    proof: "src/proof.ts",
    vault: "src/vault.ts",
    treasury: "src/treasury.ts",
    reconciler: "src/reconciler.ts",
    "chain-observer": "src/chain-observer.ts",
    witness: "src/witness.ts",
    verify: "src/verify.ts",
    sdk: "src/sdk.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  target: "node18",
  noExternal: [/^@attestia\//],
});
