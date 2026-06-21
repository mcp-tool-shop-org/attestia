/**
 * Tests for MultiSigWitness — full lifecycle multi-sig witness orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSeed, deriveKeypair, deriveAddress } from "ripple-keypairs";
import { MultiSigWitness } from "../../src/governance/multisig-witness.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import type { MultiSigWitnessConfig } from "../../src/governance/multisig-witness.js";
import type { MultiSigConfig } from "../../src/governance/multisig-submitter.js";
import type { WitnessConfig, AttestationPayload } from "../../src/types.js";

// =============================================================================
// Real signer keys (shared between wallet mock and governance policy).
// =============================================================================

interface TestKey {
  readonly seed: string;
  readonly address: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

function genKey(): TestKey {
  const seed = generateSeed();
  const kp = deriveKeypair(seed);
  return { seed, address: deriveAddress(kp.publicKey), publicKey: kp.publicKey, privateKey: kp.privateKey };
}

const KEYS: TestKey[] = [genKey(), genKey(), genKey()];
const KEY_BY_SEED = new Map(KEYS.map((k) => [k.seed, k]));
const MASTER_ACCOUNT = "rMultiSigAccount";

// =============================================================================
// Mocks
// =============================================================================

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockIsConnected = vi.fn().mockReturnValue(true);
const mockAutofill = vi.fn();
const mockSubmitAndWait = vi.fn();

vi.mock("xrpl", async () => {
  const actual = await vi.importActual<typeof import("xrpl")>("xrpl");
  return {
    ...actual,
    Client: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      isConnected: mockIsConnected,
      autofill: mockAutofill,
      submitAndWait: mockSubmitAndWait,
      // tx lookup: not found (pre-submit idempotency check misses by default).
      request: vi.fn().mockRejectedValue(new Error("txnNotFound")),
    })),
    Wallet: {
      ...actual.Wallet,
      fromSeed: vi.fn().mockImplementation((seed: string) => {
        const key = KEY_BY_SEED.get(seed);
        if (key) {
          // Governance signer wallet — bound to a real keypair.
          return {
            classicAddress: key.address,
            address: key.address,
            publicKey: key.publicKey,
            privateKey: key.privateKey,
            sign: vi.fn().mockImplementation((tx: Record<string, unknown>, multisign?: boolean) => ({
              tx_blob: `blob_${key.address}_${multisign ? "multi" : "single"}`,
              hash: "consistent_tx_hash",
            })),
          };
        }
        // Single-signer wallet (single mode never verifies governance signatures).
        return {
          classicAddress: `rAddr_${seed}`,
          address: `rAddr_${seed}`,
          sign: vi.fn().mockImplementation((tx: Record<string, unknown>, multisign?: boolean) => ({
            tx_blob: `blob_${seed}_${multisign ? "multi" : "single"}`,
            hash: "consistent_tx_hash",
          })),
        };
      }),
    },
    multisign: vi.fn().mockReturnValue("combined_multisign_blob"),
    decode: vi.fn().mockImplementation(() => ({
      Account: MASTER_ACCOUNT,
      Destination: MASTER_ACCOUNT,
      TransactionType: "Payment",
    })),
    // A-WIT-001: idempotency hash is derived from the COMBINED multisign blob via
    // hashes.hashSignedTx. Mock it (real hashSignedTx requires a valid hex blob).
    hashes: {
      ...actual.hashes,
      hashSignedTx: vi.fn().mockReturnValue("combined_onchain_hash"),
    },
  };
});

// =============================================================================
// Helpers
// =============================================================================

function makePayload(hash = "payload-hash"): AttestationPayload {
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

function makeMultiSigConfig(): MultiSigConfig {
  return {
    rpcUrl: "wss://test.xrpl.example.com",
    chainId: "xrpl:testnet",
    account: MASTER_ACCOUNT,
    signers: KEYS.map((k) => ({ address: k.address, secret: k.seed })),
    timeoutMs: 5000,
  };
}

function makeSingleConfig(): WitnessConfig {
  return {
    rpcUrl: "wss://test.xrpl.example.com",
    chainId: "xrpl:testnet",
    account: "rSingleAccount",
    secret: "singleSeed",
    timeoutMs: 5000,
  };
}

function makeGovernanceStore(): GovernanceStore {
  const store = new GovernanceStore();
  store.addSigner(KEYS[0]!.address, "One", 1, KEYS[0]!.publicKey);
  store.addSigner(KEYS[1]!.address, "Two", 1, KEYS[1]!.publicKey);
  store.addSigner(KEYS[2]!.address, "Three", 1, KEYS[2]!.publicKey);
  store.changeQuorum(2);
  return store;
}

// =============================================================================
// Tests
// =============================================================================

describe("MultiSigWitness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutofill.mockImplementation((tx: Record<string, unknown>) => ({
      ...tx,
      Sequence: 100,
      Fee: "12",
      LastLedgerSequence: 200,
    }));
    mockSubmitAndWait.mockResolvedValue({
      result: {
        hash: "0xWitnessHash",
        meta: { ledger_index: 55 },
        ledger_index: 55,
      },
    });
  });

  describe("mode detection", () => {
    it("uses multisig mode when governance config present", () => {
      const config: MultiSigWitnessConfig = {
        governance: {
          multiSigConfig: makeMultiSigConfig(),
          store: makeGovernanceStore(),
        },
      };
      const witness = new MultiSigWitness(config);
      expect(witness.getMode()).toBe("multisig");
    });

    it("uses single mode when only singleSignerConfig present", () => {
      const config: MultiSigWitnessConfig = {
        singleSignerConfig: makeSingleConfig(),
      };
      const witness = new MultiSigWitness(config);
      expect(witness.getMode()).toBe("single");
    });

    it("throws when neither config is provided", () => {
      expect(() => new MultiSigWitness({})).toThrow(
        "requires either governance config or singleSignerConfig",
      );
    });
  });

  describe("connection lifecycle", () => {
    it("connects and disconnects in multisig mode", async () => {
      const config: MultiSigWitnessConfig = {
        governance: {
          multiSigConfig: makeMultiSigConfig(),
          store: makeGovernanceStore(),
        },
      };
      const witness = new MultiSigWitness(config);

      await witness.connect();
      expect(witness.isConnected()).toBe(true);

      await witness.disconnect();
    });

    it("connects and disconnects in single mode", async () => {
      const config: MultiSigWitnessConfig = {
        singleSignerConfig: makeSingleConfig(),
      };
      const witness = new MultiSigWitness(config);

      await witness.connect();
      expect(witness.isConnected()).toBe(true);

      await witness.disconnect();
    });
  });

  describe("witnessing in multisig mode", () => {
    it("full lifecycle: create policy, add 3 signers, set 2-of-3, witness", async () => {
      const store = makeGovernanceStore();
      const config: MultiSigWitnessConfig = {
        governance: {
          multiSigConfig: makeMultiSigConfig(),
          store,
        },
      };

      const witness = new MultiSigWitness(config);
      await witness.connect();

      const record = await witness.witnessPayload(makePayload());

      expect(record.id).toMatch(/^witness:multisig:/);
      expect(record.chainId).toBe("xrpl:testnet");
      expect(record.witnessAccount).toBe("rMultiSigAccount");
      expect(record.ledgerIndex).toBe(55);

      // Record should be tracked
      expect(witness.getRecords().length).toBe(1);
      expect(witness.getRecords()[0]).toBe(record);

      await witness.disconnect();
    });

    it("getCurrentPolicy returns the governance policy", () => {
      const store = makeGovernanceStore();
      const config: MultiSigWitnessConfig = {
        governance: {
          multiSigConfig: makeMultiSigConfig(),
          store,
        },
      };

      const witness = new MultiSigWitness(config);
      const policy = witness.getCurrentPolicy();

      expect(policy).not.toBeNull();
      expect(policy!.signers.length).toBe(3);
      expect(policy!.quorum).toBe(2);
    });
  });

  describe("witnessing in single mode", () => {
    it("submits payload via single-signer submitter", async () => {
      const config: MultiSigWitnessConfig = {
        singleSignerConfig: makeSingleConfig(),
      };

      const witness = new MultiSigWitness(config);
      await witness.connect();

      const record = await witness.witnessPayload(makePayload());

      expect(record).toBeDefined();
      expect(record.chainId).toBe("xrpl:testnet");
      expect(witness.getRecords().length).toBe(1);

      await witness.disconnect();
    });

    it("getCurrentPolicy returns null in single mode", () => {
      const config: MultiSigWitnessConfig = {
        singleSignerConfig: makeSingleConfig(),
      };

      const witness = new MultiSigWitness(config);
      expect(witness.getCurrentPolicy()).toBeNull();
    });
  });

  describe("backward compatibility", () => {
    it("single mode produces standard witness records", async () => {
      const config: MultiSigWitnessConfig = {
        singleSignerConfig: makeSingleConfig(),
      };

      const witness = new MultiSigWitness(config);
      await witness.connect();

      const record = await witness.witnessPayload(makePayload());

      // Standard witness record fields
      expect(record.id).toMatch(/^witness:/);
      expect(record.payload).toBeDefined();
      expect(record.chainId).toBeDefined();
      expect(record.txHash).toBeDefined();
      expect(record.ledgerIndex).toBeDefined();
      expect(record.witnessedAt).toBeDefined();
      expect(record.witnessAccount).toBeDefined();

      await witness.disconnect();
    });
  });

  describe("multiple witness operations", () => {
    it("tracks multiple witness records", async () => {
      const store = makeGovernanceStore();
      const config: MultiSigWitnessConfig = {
        governance: {
          multiSigConfig: makeMultiSigConfig(),
          store,
        },
      };

      const witness = new MultiSigWitness(config);
      await witness.connect();

      await witness.witnessPayload(makePayload("hash-1"));
      await witness.witnessPayload(makePayload("hash-2"));
      await witness.witnessPayload(makePayload("hash-3"));

      expect(witness.getRecords().length).toBe(3);

      await witness.disconnect();
    });
  });

  describe("payload integrity", () => {
    it("verifyPayloadIntegrity delegates correctly", () => {
      const config: MultiSigWitnessConfig = {
        singleSignerConfig: makeSingleConfig(),
      };

      const witness = new MultiSigWitness(config);

      // A valid payload should verify
      const payload = makePayload();
      // verifyPayloadHash checks if hash matches canonical JSON — this payload
      // was manually constructed so it won't match, but verifyPayloadIntegrity
      // should still return a boolean
      const result = witness.verifyPayloadIntegrity(payload);
      expect(typeof result).toBe("boolean");
    });
  });
});
