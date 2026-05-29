/**
 * Tests for MultiSigSubmitter — multi-signature XRPL transaction submission.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
// Real keypairs so the secure verify-then-count path works end-to-end.
// (xrpl is mocked below, so generate keys via ripple-keypairs directly.)
import { generateSeed, deriveKeypair, deriveAddress } from "ripple-keypairs";
import { MultiSigSubmitter, normalizeTimestamp } from "../../src/governance/multisig-submitter.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import type { MultiSigConfig } from "../../src/governance/multisig-submitter.js";
import type { AttestationPayload } from "../../src/types.js";

// =============================================================================
// Real signer keys — shared between the wallet mock and the governance policy.
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

// Up to 5 signer keys, addressed by index (1-based in helpers).
const KEYS: TestKey[] = [genKey(), genKey(), genKey(), genKey(), genKey()];
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
const mockRequest = vi.fn();

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
      request: mockRequest,
    })),
    Wallet: {
      ...actual.Wallet,
      fromSeed: vi.fn().mockImplementation((seed: string) => {
        const key = KEY_BY_SEED.get(seed)!;
        return {
          classicAddress: key.address,
          address: key.address,
          publicKey: key.publicKey,
          privateKey: key.privateKey,
          sign: vi.fn().mockImplementation((tx: Record<string, unknown>, multisign?: boolean) => ({
            tx_blob: `blob_${key.address}_${multisign ? "multi" : "single"}`,
            // All signers produce the same XRPL tx hash for the same prepared tx.
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
  };
});

// =============================================================================
// Helpers
// =============================================================================

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

function makeConfig(signerCount = 3): MultiSigConfig {
  const signers = KEYS.slice(0, signerCount).map((k) => ({ address: k.address, secret: k.seed }));
  return {
    rpcUrl: "wss://test.xrpl.example.com",
    chainId: "xrpl:testnet",
    account: MASTER_ACCOUNT,
    signers,
    timeoutMs: 5000,
  };
}

function makeGovernanceStore(signerCount = 3, quorum = 2): GovernanceStore {
  const store = new GovernanceStore();
  for (const [i, k] of KEYS.slice(0, signerCount).entries()) {
    store.addSigner(k.address, `Signer ${i + 1}`, 1, k.publicKey);
  }
  store.changeQuorum(quorum);
  return store;
}

// =============================================================================
// Tests
// =============================================================================

describe("MultiSigSubmitter", () => {
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
        hash: "0xMultiSigTxHash",
        meta: { ledger_index: 42 },
        ledger_index: 42,
      },
    });
    // Default: the tx is not yet on-chain (pre-submit idempotency check misses).
    mockRequest.mockRejectedValue(new Error("txnNotFound"));
  });

  describe("constructor and connection", () => {
    it("constructs with valid config", () => {
      const config = makeConfig();
      const submitter = new MultiSigSubmitter(config);
      expect(submitter).toBeDefined();
      expect(submitter.isConnected()).toBe(false);
    });

    it("connect initializes client and wallets", async () => {
      const submitter = new MultiSigSubmitter(makeConfig());
      await submitter.connect();
      expect(mockConnect).toHaveBeenCalledOnce();
      expect(submitter.isConnected()).toBe(true);
    });

    it("disconnect cleans up client and wallets", async () => {
      const submitter = new MultiSigSubmitter(makeConfig());
      await submitter.connect();
      await submitter.disconnect();
      expect(mockDisconnect).toHaveBeenCalledOnce();
    });
  });

  describe("submit", () => {
    it("2-of-3 multi-sig succeeds", async () => {
      const config = makeConfig(3);
      const store = makeGovernanceStore(3, 2);
      const policy = store.getCurrentPolicy();

      const submitter = new MultiSigSubmitter(config);
      await submitter.connect();

      const record = await submitter.submit(makePayload(), policy);

      expect(record.id).toMatch(/^witness:multisig:/);
      expect(record.chainId).toBe("xrpl:testnet");
      expect(record.witnessAccount).toBe("rMultiSigAccount");
      expect(record.txHash).toBe("0xMultiSigTxHash");
      expect(record.ledgerIndex).toBe(42);
      expect(record.payload.hash).toBe("abc123");
    });

    it("builds 1-drop self-send payment with memo", async () => {
      const config = makeConfig(2);
      const store = makeGovernanceStore(2, 2);
      const policy = store.getCurrentPolicy();

      const submitter = new MultiSigSubmitter(config);
      await submitter.connect();

      await submitter.submit(makePayload(), policy);

      // Verify autofill was called with self-send payment
      expect(mockAutofill).toHaveBeenCalledOnce();
      const tx = mockAutofill.mock.calls[0]![0];
      expect(tx.TransactionType).toBe("Payment");
      expect(tx.Account).toBe("rMultiSigAccount");
      expect(tx.Destination).toBe("rMultiSigAccount");
      expect(tx.Amount).toBe("1");
      expect(tx.Memos).toBeDefined();
      expect(tx.Memos.length).toBe(1);
    });

    it("throws when not connected", async () => {
      const config = makeConfig();
      const store = makeGovernanceStore();
      const policy = store.getCurrentPolicy();

      const submitter = new MultiSigSubmitter(config);

      await expect(submitter.submit(makePayload(), policy)).rejects.toThrow(
        "not connected",
      );
    });

    it("wraps errors in WitnessSubmitError", async () => {
      const config = makeConfig(3);
      const store = makeGovernanceStore(3, 2);
      const policy = store.getCurrentPolicy();

      mockSubmitAndWait.mockRejectedValue(new Error("tembad_amount"));

      const submitter = new MultiSigSubmitter(config);
      await submitter.connect();

      await expect(submitter.submit(makePayload(), policy)).rejects.toThrow(
        "Witness submission failed",
      );
    });
  });

  describe("signature verification", () => {
    it("rejects when a signer produces a mismatched tx hash", async () => {
      const config = makeConfig(3);
      const store = makeGovernanceStore(3, 2);
      const policy = store.getCurrentPolicy();

      const submitter = new MultiSigSubmitter(config);
      await submitter.connect();

      // Tamper: make the third wallet produce a different hash
      const wallets = (submitter as unknown as { wallets: Map<string, { sign: ReturnType<typeof vi.fn> }> }).wallets;
      const entries = [...wallets.entries()];
      const [addr, tamperedWallet] = entries[2]!;
      tamperedWallet.sign = vi.fn().mockReturnValue({
        tx_blob: "tampered_blob",
        hash: "different_hash",
      });
      wallets.set(addr, tamperedWallet);

      await expect(submitter.submit(makePayload(), policy)).rejects.toThrow(
        "hash mismatch",
      );
    });

    it("passes when all signers produce matching hashes", async () => {
      const config = makeConfig(3);
      const store = makeGovernanceStore(3, 2);
      const policy = store.getCurrentPolicy();

      const submitter = new MultiSigSubmitter(config);
      await submitter.connect();

      // Default mock produces consistent hashes — should succeed
      const record = await submitter.submit(makePayload(), policy);
      expect(record.txHash).toBeDefined();
    });
  });

  describe("buildTransaction", () => {
    it("returns memo and transaction details", () => {
      const submitter = new MultiSigSubmitter(makeConfig());
      const result = submitter.buildTransaction(makePayload());

      expect(result.account).toBe("rMultiSigAccount");
      expect(result.destination).toBe("rMultiSigAccount");
      expect(result.amount).toBe("1");
      expect(result.memo).toBeDefined();
      expect(result.memo.MemoType).toBeDefined();
      expect(result.memo.MemoData).toBeDefined();
    });
  });

  describe("timestamp normalization", () => {
    it("normalizeTimestamp produces ISO 8601 UTC strings", () => {
      const date = new Date("2025-06-15T12:30:00Z");
      const result = normalizeTimestamp(date);
      expect(result).toBe("2025-06-15T12:30:00.000Z");
    });

    it("normalizeTimestamp is consistent for same input", () => {
      const date = new Date("2025-01-01T00:00:00Z");
      const r1 = normalizeTimestamp(date);
      const r2 = normalizeTimestamp(date);
      expect(r1).toBe(r2);
    });

    it("normalizeTimestamp always ends with Z (UTC)", () => {
      const date = new Date();
      const result = normalizeTimestamp(date);
      expect(result).toMatch(/Z$/);
    });
  });

  describe("fee handling", () => {
    it("includes feeDrops when configured", async () => {
      const config: MultiSigConfig = {
        ...makeConfig(2),
        feeDrops: "15",
      };
      const store = makeGovernanceStore(2, 2);
      const policy = store.getCurrentPolicy();

      const submitter = new MultiSigSubmitter(config);
      await submitter.connect();

      await submitter.submit(makePayload(), policy);

      const tx = mockAutofill.mock.calls[0]![0];
      expect(tx.Fee).toBe("15");
    });

    it("omits fee when not configured", async () => {
      const config = makeConfig(2);
      const store = makeGovernanceStore(2, 2);
      const policy = store.getCurrentPolicy();

      const submitter = new MultiSigSubmitter(config);
      await submitter.connect();

      await submitter.submit(makePayload(), policy);

      const tx = mockAutofill.mock.calls[0]![0];
      expect(tx.Fee).toBeUndefined();
    });
  });
});
