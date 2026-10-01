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
 * - Entries import workspace TypeScript source, not the private package names.
 *   The declaration build then inlines MerkleTree and EventStore. Splitting stays
 *   off so those declarations are not left pointing at chunk files that are never emitted.
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
  // Declarations are written by bundle-dts.mjs (API Extractor). tsup's own
  // declaration build leaves imports of private @attestia/* packages.
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "node18",
  noExternal: [/^@attestia\//],
});
