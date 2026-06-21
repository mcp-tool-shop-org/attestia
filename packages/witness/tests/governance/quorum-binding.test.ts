/**
 * A-WIT-002 — quorum-downgrade binding gap.
 *
 * Both the policyId (GovernanceStore.getCurrentPolicy) and the canonical signing
 * payload (buildCanonicalSigningPayload) must bind the FULL quorum-relevant
 * policy: per-signer {address, weight, publicKey} plus quorum and version.
 *
 * The original implementations bound only {version, addresses.sort(), quorum},
 * EXCLUDING each signer's weight and publicKey. That let two policies with the
 * same addresses + quorum + version but DIFFERENT weight distributions share an
 * identical policyId AND signed-payload hash. An attacker controlling the policy
 * object at verification time could re-weight signers so a smaller genuine
 * subset of signatures meets quorum — a quorum downgrade that the bound hash
 * failed to detect.
 *
 * RED before the fix: the two policies below (identical addresses/quorum/version,
 * different weights) produce the SAME policyId and the SAME canonical signing
 * payload hash, so the assertions that they MUST differ fail.
 */

import { describe, it, expect } from "vitest";
import {
  buildCanonicalSigningPayload,
} from "../../src/governance/signing.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import type { AttestationPayload } from "../../src/types.js";

function makePayload(hash = "attestation-abc"): AttestationPayload {
  return {
    hash,
    timestamp: "2025-01-01T00:00:00Z",
    source: { kind: "registrum", stateId: "state1", orderIndex: 1 },
    summary: {
      clean: true,
      matchedCount: 10,
      mismatchCount: 0,
      missingCount: 0,
      attestedBy: "system",
    },
  };
}

/**
 * Two stores with the SAME addresses, SAME quorum, SAME version, but DIFFERENT
 * per-signer weight distributions.
 *
 * Store A: rAlpha=1, rBeta=1, rGamma=1   (total 3, quorum 2 → needs 2 signers)
 * Store B: rAlpha=2, rBeta=1, rGamma=1   (total 4, quorum 2 → rAlpha alone meets)
 *
 * Both have quorum=2 and 3 add events + 1 quorum event (version 4).
 */
function makeStoreA(): GovernanceStore {
  const store = new GovernanceStore();
  store.addSigner("rAlpha", "Alpha", 1);
  store.addSigner("rBeta", "Beta", 1);
  store.addSigner("rGamma", "Gamma", 1);
  store.changeQuorum(2);
  return store;
}

function makeStoreB(): GovernanceStore {
  const store = new GovernanceStore();
  store.addSigner("rAlpha", "Alpha", 2); // re-weighted: 2 instead of 1
  store.addSigner("rBeta", "Beta", 1);
  store.addSigner("rGamma", "Gamma", 1);
  store.changeQuorum(2);
  return store;
}

describe("A-WIT-002 — policyId binds per-signer weight", () => {
  it("two policies differing ONLY in weights produce DIFFERENT policyIds", () => {
    const policyA = makeStoreA().getCurrentPolicy();
    const policyB = makeStoreB().getCurrentPolicy();

    // Same addresses, same quorum, same version — only weights differ.
    expect(policyA.signers.map((s) => s.address).sort()).toEqual(
      policyB.signers.map((s) => s.address).sort(),
    );
    expect(policyA.quorum).toBe(policyB.quorum);
    expect(policyA.version).toBe(policyB.version);

    // A re-weighting changes the quorum semantics, so it MUST change the policyId.
    expect(policyA.id).not.toBe(policyB.id);
  });
});

describe("A-WIT-002 — canonical signing payload binds per-signer weight", () => {
  it("re-weighted signers must NOT verify against the original signed hash", () => {
    const policyA = makeStoreA().getCurrentPolicy();
    const policyB = makeStoreB().getCurrentPolicy();
    const payload = makePayload();

    const hashA = buildCanonicalSigningPayload(payload, policyA);
    const hashB = buildCanonicalSigningPayload(payload, policyB);

    // Identical attestation + identical addresses/quorum/version, different
    // weights → the signed-payload hash MUST differ, so signatures over hashA
    // cannot be replayed against a re-weighted policyB.
    expect(hashA).not.toBe(hashB);
  });
});

describe("A-WIT-002 — policyId binds per-signer publicKey", () => {
  it("two policies differing ONLY in a signer's publicKey produce DIFFERENT policyIds and signed hashes", () => {
    // Real keypairs whose addresses are deterministic; we register two DIFFERENT
    // public keys for the SAME address slot is impossible (publicKey must derive
    // to address), so instead we compare a policy WITH a registered key against
    // the SAME policy WITHOUT one — both share addresses/quorum/version.
    const withKeyStore = new GovernanceStore();
    // A real key so addSigner accepts it (publicKey must derive to address).
    // Generated inline to avoid network/keygen flakiness across runs.
    const seedKp = makeKey();
    withKeyStore.addSigner(seedKp.address, "Keyed", 1, seedKp.publicKey);
    withKeyStore.addSigner("rPlain", "Plain", 1);
    withKeyStore.changeQuorum(1);

    const noKeyStore = new GovernanceStore();
    noKeyStore.addSigner(seedKp.address, "Keyed", 1); // SAME address, no publicKey
    noKeyStore.addSigner("rPlain", "Plain", 1);
    noKeyStore.changeQuorum(1);

    const withKey = withKeyStore.getCurrentPolicy();
    const noKey = noKeyStore.getCurrentPolicy();

    expect(withKey.signers.map((s) => s.address).sort()).toEqual(
      noKey.signers.map((s) => s.address).sort(),
    );
    expect(withKey.quorum).toBe(noKey.quorum);
    expect(withKey.version).toBe(noKey.version);

    // Registering / changing a signer's public key changes the policy identity.
    expect(withKey.id).not.toBe(noKey.id);

    const payload = makePayload();
    expect(buildCanonicalSigningPayload(payload, withKey)).not.toBe(
      buildCanonicalSigningPayload(payload, noKey),
    );
  });
});

// Local keypair helper (ripple-keypairs is a real dependency; xrpl is NOT mocked here).
import { generateSeed, deriveKeypair, deriveAddress } from "ripple-keypairs";
function makeKey() {
  const seed = generateSeed();
  const kp = deriveKeypair(seed);
  return { address: deriveAddress(kp.publicKey), publicKey: kp.publicKey };
}
