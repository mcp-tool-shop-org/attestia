/**
 * D3-A-003 — Cryptographic signature verification before quorum counting.
 *
 * Adversarial scenarios proving that aggregateSignatures and
 * validateHistoricalQuorum perform verify-then-count: a signature must
 * cryptographically verify over the canonical payloadHash against the
 * signer's registered public key BEFORE its weight counts toward quorum.
 *
 * A fabricated signature (e.g. the XRPL tx hash, or random bytes) must NOT
 * count toward quorum.
 */

import { describe, it, expect } from "vitest";
import { deriveKeypair, deriveAddress } from "xrpl";
import { sign as rkSign } from "ripple-keypairs";
import { Wallet } from "xrpl";
import {
  buildCanonicalSigningPayload,
  aggregateSignatures,
  xrplSignatureVerifier,
} from "../../src/governance/signing.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { validateHistoricalQuorum } from "../../src/governance/registrum-bridge.js";
import type { SignerSignature } from "../../src/governance/signing.js";
import type { AttestationPayload } from "../../src/types.js";

// =============================================================================
// Helpers — real XRPL keypairs so signatures are genuinely verifiable
// =============================================================================

interface RealSigner {
  readonly address: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

function makeSigner(): RealSigner {
  const seed = Wallet.generate().seed!;
  const kp = deriveKeypair(seed);
  return {
    address: deriveAddress(kp.publicKey),
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  };
}

function realSign(signer: RealSigner, payloadHash: string): string {
  // Sign the canonical payloadHash bytes (hex-encoded message).
  const messageHex = Buffer.from(payloadHash, "utf8").toString("hex").toUpperCase();
  return rkSign(messageHex, signer.privateKey);
}

function makePayload(hash = "abc123"): AttestationPayload {
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

function storeWith(signers: RealSigner[], quorum: number): GovernanceStore {
  const store = new GovernanceStore();
  for (const [i, s] of signers.entries()) {
    store.addSigner(s.address, `Signer ${i + 1}`, 1, s.publicKey);
  }
  store.changeQuorum(quorum);
  return store;
}

// =============================================================================
// Tests
// =============================================================================

describe("aggregateSignatures — cryptographic verify-then-count (D3-A-003)", () => {
  it("counts a genuinely-signed signature toward quorum", () => {
    const a = makeSigner();
    const b = makeSigner();
    const store = storeWith([a, b], 2);
    const policy = store.getCurrentPolicy();
    const payload = makePayload();
    const payloadHash = buildCanonicalSigningPayload(payload, policy);

    const sigs: SignerSignature[] = [
      { address: a.address, signature: realSign(a, payloadHash), signedAt: "2025-01-01T00:00:00Z" },
      { address: b.address, signature: realSign(b, payloadHash), signedAt: "2025-01-01T00:00:01Z" },
    ];

    const result = aggregateSignatures(sigs, policy, payloadHash, {
      verify: xrplSignatureVerifier,
    });
    expect(result.quorum.met).toBe(true);
    expect(result.quorum.totalWeight).toBe(2);
  });

  it("REJECTS a fabricated signature — does NOT count toward quorum", () => {
    const a = makeSigner();
    const b = makeSigner();
    const store = storeWith([a, b], 2);
    const policy = store.getCurrentPolicy();
    const payload = makePayload();
    const payloadHash = buildCanonicalSigningPayload(payload, policy);

    // a signs genuinely; b's "signature" is fabricated (e.g. a tx hash).
    const sigs: SignerSignature[] = [
      { address: a.address, signature: realSign(a, payloadHash), signedAt: "2025-01-01T00:00:00Z" },
      { address: b.address, signature: "DEADBEEFCAFEBABE".repeat(8), signedAt: "2025-01-01T00:00:01Z" },
    ];

    // Must throw — the fabricated signature cannot verify, so quorum (2) is unreachable.
    expect(() =>
      aggregateSignatures(sigs, policy, payloadHash, { verify: xrplSignatureVerifier }),
    ).toThrow();
  });

  it("REJECTS a signature over a DIFFERENT payload hash (replay)", () => {
    const a = makeSigner();
    const b = makeSigner();
    const store = storeWith([a, b], 2);
    const policy = store.getCurrentPolicy();

    const realHash = buildCanonicalSigningPayload(makePayload("real"), policy);
    const otherHash = buildCanonicalSigningPayload(makePayload("other"), policy);

    // Both sign the OTHER payload, then attacker replays against realHash.
    const sigs: SignerSignature[] = [
      { address: a.address, signature: realSign(a, otherHash), signedAt: "2025-01-01T00:00:00Z" },
      { address: b.address, signature: realSign(b, otherHash), signedAt: "2025-01-01T00:00:01Z" },
    ];

    expect(() =>
      aggregateSignatures(sigs, policy, realHash, { verify: xrplSignatureVerifier }),
    ).toThrow();
  });

  it("REJECTS a signature signed by a DIFFERENT key than the registered signer", () => {
    const a = makeSigner();
    const b = makeSigner();
    const imposter = makeSigner();
    const store = storeWith([a, b], 2);
    const policy = store.getCurrentPolicy();
    const payloadHash = buildCanonicalSigningPayload(makePayload(), policy);

    // a signs genuinely; the second entry uses b's address but the imposter's key.
    const sigs: SignerSignature[] = [
      { address: a.address, signature: realSign(a, payloadHash), signedAt: "2025-01-01T00:00:00Z" },
      { address: b.address, signature: realSign(imposter, payloadHash), signedAt: "2025-01-01T00:00:01Z" },
    ];

    expect(() =>
      aggregateSignatures(sigs, policy, payloadHash, { verify: xrplSignatureVerifier }),
    ).toThrow();
  });

  it("when policy registers public keys, a verifier is REQUIRED (fail-closed)", () => {
    const a = makeSigner();
    const b = makeSigner();
    const store = storeWith([a, b], 2);
    const policy = store.getCurrentPolicy();
    const payloadHash = buildCanonicalSigningPayload(makePayload(), policy);

    const sigs: SignerSignature[] = [
      { address: a.address, signature: realSign(a, payloadHash), signedAt: "2025-01-01T00:00:00Z" },
      { address: b.address, signature: realSign(b, payloadHash), signedAt: "2025-01-01T00:00:01Z" },
    ];

    // No verifier supplied, but signers have registered public keys → must throw.
    expect(() => aggregateSignatures(sigs, policy, payloadHash)).toThrow(
      /verif/i,
    );
  });
});

describe("validateHistoricalQuorum — verify-then-count (D3-A-003)", () => {
  it("a fabricated signature does NOT count toward historical quorum", () => {
    const a = makeSigner();
    const b = makeSigner();
    const store = storeWith([a, b], 2);
    const events = store.getEventHistory();
    const policyVersion = events.length; // current version
    const policy = store.getCurrentPolicy();
    const payload = makePayload();
    const payloadHash = buildCanonicalSigningPayload(payload, policy);

    const sigs: SignerSignature[] = [
      { address: a.address, signature: realSign(a, payloadHash), signedAt: "2025-01-01T00:00:00Z" },
      { address: b.address, signature: "NOT_A_REAL_SIGNATURE", signedAt: "2025-01-01T00:00:01Z" },
    ];

    const result = validateHistoricalQuorum(payload, sigs, events, policyVersion, {
      verify: xrplSignatureVerifier,
      payloadHash,
    });

    expect(result.valid).toBe(false);
    expect(result.quorum.met).toBe(false);
    // Only the genuine signature counts.
    expect(result.quorum.totalWeight).toBe(1);
  });

  it("genuine signatures meeting quorum validate historically", () => {
    const a = makeSigner();
    const b = makeSigner();
    const store = storeWith([a, b], 2);
    const events = store.getEventHistory();
    const policyVersion = events.length;
    const policy = store.getCurrentPolicy();
    const payload = makePayload();
    const payloadHash = buildCanonicalSigningPayload(payload, policy);

    const sigs: SignerSignature[] = [
      { address: a.address, signature: realSign(a, payloadHash), signedAt: "2025-01-01T00:00:00Z" },
      { address: b.address, signature: realSign(b, payloadHash), signedAt: "2025-01-01T00:00:01Z" },
    ];

    const result = validateHistoricalQuorum(payload, sigs, events, policyVersion, {
      verify: xrplSignatureVerifier,
      payloadHash,
    });

    expect(result.valid).toBe(true);
    expect(result.quorum.met).toBe(true);
  });
});
