/**
 * Bundle smoke test — verifies every subpath re-export resolves and exposes
 * its key public symbols. Runs against source (the workspace deps resolve via
 * pnpm), so it catches a broken/missing re-export before the tsup build.
 *
 * The dist SHAPE (that the published tarball actually contains every entry) is
 * verified separately by `npm pack --dry-run` in release.yml.
 */
import { describe, it, expect } from "vitest";

import * as root from "../src/index.js";
import * as types from "../src/types.js";
import * as ledger from "../src/ledger.js";
import * as registrum from "../src/registrum.js";
import * as eventStore from "../src/event-store.js";
import * as proof from "../src/proof.js";
import * as vault from "../src/vault.js";
import * as treasury from "../src/treasury.js";
import * as reconciler from "../src/reconciler.js";
import * as chainObserver from "../src/chain-observer.js";
import * as witness from "../src/witness.js";
import * as verify from "../src/verify.js";
import * as sdk from "../src/sdk.js";

const subpaths = {
  types,
  ledger,
  registrum,
  "event-store": eventStore,
  proof,
  vault,
  treasury,
  reconciler,
  "chain-observer": chainObserver,
  witness,
  verify,
  sdk,
};

describe("@mcptoolshop/attestia bundle", () => {
  it("every subpath exports at least one symbol", () => {
    for (const [name, mod] of Object.entries(subpaths)) {
      expect(Object.keys(mod as object).length, `subpath '${name}' is empty`).toBeGreaterThan(0);
    }
  });

  it("the root barrel exposes every domain as a namespace", () => {
    const namespaces = [
      "types",
      "ledger",
      "registrum",
      "eventStore",
      "proof",
      "vault",
      "treasury",
      "reconciler",
      "chainObserver",
      "witness",
      "verify",
      "sdk",
    ] as const;
    for (const ns of namespaces) {
      const value = (root as Record<string, unknown>)[ns];
      expect(value, `root namespace '${ns}' missing`).toBeTypeOf("object");
      expect(Object.keys(value as object).length, `root namespace '${ns}' empty`).toBeGreaterThan(0);
    }
  });

  it("exposes the load-bearing public symbols (deep + namespaced agree)", () => {
    // High-confidence symbols from the core packages.
    expect(ledger.addMoney).toBeTypeOf("function");
    expect(ledger.compareMoney).toBeTypeOf("function");
    expect(proof.MerkleTree).toBeTypeOf("function");
    expect(proof.hashAttestation).toBeTypeOf("function");
    expect(registrum.StructuralRegistrar).toBeTypeOf("function");
    expect(eventStore.JsonlEventStore).toBeTypeOf("function");
    expect(eventStore.InMemoryEventStore).toBeTypeOf("function");
    expect(eventStore.ATTESTIA_EVENTS).toBeTypeOf("object");
    expect(vault.Vault).toBeTypeOf("function");
    expect(treasury.Treasury).toBeTypeOf("function");
    expect(reconciler.Reconciler).toBeTypeOf("function");

    // The namespaced root must point at the same implementations.
    expect(root.ledger.addMoney).toBe(ledger.addMoney);
    expect(root.proof.MerkleTree).toBe(proof.MerkleTree);
  });
});
