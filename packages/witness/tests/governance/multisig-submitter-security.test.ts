/**
 * D3-A-004 — wallet/address binding on connect.
 * D3-A-002 — multi-sig idempotency / replay guard under retry.
 * D3-A-003 (production wiring) — multi-sig contributes REAL signatures over the
 *   canonical payload hash, verified before counting toward quorum.
 *
 * These tests do NOT mock the governance signing module — they use real XRPL
 * keypairs so signature verification is genuine end-to-end. Only the xrpl
 * network surface (Client, Wallet.fromSeed, multisign, decode) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
// Use ripple-keypairs directly for key generation: the xrpl module is mocked
// below, so its Wallet/derive helpers are not reliable at module-eval time.
import { generateSeed, deriveKeypair, deriveAddress } from "ripple-keypairs";
import { MultiSigSubmitter } from "../../src/governance/multisig-submitter.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { signPayloadHash } from "../../src/governance/signing.js";
import type { MultiSigConfig } from "../../src/governance/multisig-submitter.js";
import type { AttestationPayload } from "../../src/types.js";

// =============================================================================
// Real keypairs — generated once, shared across the mock and the policy.
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

// Three real signer keys for the multi-sig set.
const KEYS: TestKey[] = [genKey(), genKey(), genKey()];
const KEY_BY_SEED = new Map(KEYS.map((k) => [k.seed, k]));

// A mismatched key whose address differs from the configured signer address.
const MISMATCH_KEY = genKey();

const MASTER_ACCOUNT = "rMultiSigAccount";

// =============================================================================
// Mock xrpl — Wallet.fromSeed returns a wallet bound to the real keypair so
// classicAddress / privateKey are authentic; sign() produces a deterministic
// multisign blob keyed by Sequence (to detect per-retry re-signing).
// =============================================================================

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockIsConnected = vi.fn().mockReturnValue(true);
const mockAutofill = vi.fn();
const mockSubmitAndWait = vi.fn();
const mockRequest = vi.fn();

// Allow tests to override which seed maps to which key (for the mismatch case).
let seedToKey: (seed: string) => TestKey = (seed) => KEY_BY_SEED.get(seed)!;

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
        const key = seedToKey(seed);
        return {
          classicAddress: key.address,
          address: key.address,
          publicKey: key.publicKey,
          privateKey: key.privateKey,
          sign: vi.fn().mockImplementation((tx: Record<string, unknown>) => ({
            tx_blob: `blob_${key.address}_seq${tx.Sequence}`,
            // All signers produce the same multisign hash for the same prepared tx.
            hash: `MULTISIG_HASH_seq${tx.Sequence}`,
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

function makePayload(hash = "abc123"): AttestationPayload {
  return {
    hash,
    timestamp: "2025-01-01T00:00:00Z",
    source: { kind: "registrum", stateId: "state1", orderIndex: 1 },
    summary: { clean: true, matchedCount: 10, mismatchCount: 0, missingCount: 0, attestedBy: "system" },
  };
}

function makeConfig(keys: TestKey[]): MultiSigConfig {
  return {
    rpcUrl: "wss://test.xrpl.example.com",
    chainId: "xrpl:testnet",
    account: MASTER_ACCOUNT,
    signers: keys.map((k) => ({ address: k.address, secret: k.seed })),
    timeoutMs: 5000,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 },
  };
}

/** Governance store that registers each signer's REAL public key. */
function makeStore(keys: TestKey[], quorum: number): GovernanceStore {
  const store = new GovernanceStore();
  for (const [i, k] of keys.entries()) {
    store.addSigner(k.address, `Signer ${i + 1}`, 1, k.publicKey);
  }
  store.changeQuorum(quorum);
  return store;
}

// =============================================================================
// Tests
// =============================================================================

describe("MultiSigSubmitter security (D3-A-002 / D3-A-004 / D3-A-003)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedToKey = (seed) => KEY_BY_SEED.get(seed)!;
    mockAutofill.mockImplementation((tx: Record<string, unknown>) => ({
      ...tx,
      Sequence: 100,
      Fee: "12",
      LastLedgerSequence: 200,
    }));
    mockSubmitAndWait.mockResolvedValue({
      result: { hash: "0xMultiSigTxHash", meta: { ledger_index: 42 }, ledger_index: 42 },
    });
    // Default: tx not found on-chain (pre-submit check).
    mockRequest.mockRejectedValue(new Error("txnNotFound"));
  });

  describe("D3-A-004 — wallet/address binding", () => {
    it("rejects connect when a wallet's classicAddress != configured signer address", async () => {
      // Configure signer[1] with a seed that derives to a DIFFERENT address.
      const keys = [KEYS[0]!, KEYS[1]!, KEYS[2]!];
      const config = makeConfig(keys);

      // Override: signer[1]'s seed yields the mismatch key's wallet.
      const badSeed = keys[1]!.seed;
      seedToKey = (seed) => (seed === badSeed ? MISMATCH_KEY : KEY_BY_SEED.get(seed)!);

      const submitter = new MultiSigSubmitter(config);
      await expect(submitter.connect()).rejects.toThrow(/address/i);
    });

    it("connects cleanly when every wallet matches its configured address", async () => {
      const submitter = new MultiSigSubmitter(makeConfig(KEYS));
      await expect(submitter.connect()).resolves.toBeUndefined();
      expect(submitter.isConnected()).toBe(true);
    });
  });

  describe("D3-A-003 — real signatures verified before quorum", () => {
    it("2-of-3 succeeds with genuinely-signed, verifiable contributions", async () => {
      const submitter = new MultiSigSubmitter(makeConfig(KEYS));
      const store = makeStore(KEYS, 2);
      await submitter.connect();

      const record = await submitter.submit(makePayload(), store.getCurrentPolicy());
      expect(record.txHash).toBe("0xMultiSigTxHash");
      expect(record.ledgerIndex).toBe(42);
    });

    it("buildMultiSign stores real payload-hash signatures (not the tx hash)", async () => {
      const submitter = new MultiSigSubmitter(makeConfig(KEYS));
      const store = makeStore(KEYS, 2);
      await submitter.connect();
      const policy = store.getCurrentPolicy();

      const prepared = { TransactionType: "Payment", Account: MASTER_ACCOUNT, Sequence: 100 } as never;
      const result = submitter.buildMultiSign(makePayload(), policy, prepared);

      // Each recorded signature must be a real signature over the payload hash —
      // verifiable, and NOT equal to the multisign tx hash.
      const { buildCanonicalSigningPayload, xrplSignatureVerifier } = await import(
        "../../src/governance/signing.js"
      );
      const payloadHash = buildCanonicalSigningPayload(makePayload(), policy);
      for (const ss of result.signerSignatures) {
        expect(ss.signature).not.toMatch(/^MULTISIG_HASH/);
        const signer = policy.signers.find((s) => s.address === ss.address)!;
        expect(xrplSignatureVerifier(ss, payloadHash, signer)).toBe(true);
      }
    });
  });

  describe("D3-A-002 — idempotency / replay guard under retry", () => {
    it("does NOT double-submit when the first response is lost then retried", async () => {
      const submitter = new MultiSigSubmitter(makeConfig(KEYS));
      const store = makeStore(KEYS, 2);
      await submitter.connect();

      // First submitAndWait: applied on-ledger but response lost (retryable).
      mockSubmitAndWait.mockRejectedValueOnce(new Error("timeout: connection lost"));

      let autofillCalls = 0;
      mockAutofill.mockImplementation((tx: Record<string, unknown>) => {
        autofillCalls += 1;
        // Increasing Sequence would change the hash if autofill ran per-retry.
        return { ...tx, Sequence: 100 + autofillCalls - 1, Fee: "12", LastLedgerSequence: 200 };
      });

      // After the lost submission, the pre-submit existence check finds the tx.
      let existenceChecks = 0;
      mockRequest.mockImplementation(async () => {
        existenceChecks += 1;
        if (existenceChecks === 1) throw new Error("txnNotFound"); // pre-submit, attempt 1
        return { result: { validated: true, ledger_index: 999, hash: "fixed" } };
      });

      const record = await submitter.submit(makePayload(), store.getCurrentPolicy());

      // Found via the fixed-hash on-chain check — no duplicate.
      expect(record.ledgerIndex).toBe(999);
      // submitAndWait attempted exactly once (the lost one); retry did NOT re-submit.
      expect(mockSubmitAndWait).toHaveBeenCalledTimes(1);
      // Autofill ran once (before the loop), not per retry.
      expect(autofillCalls).toBe(1);
    });

    it("performs a pre-submit on-chain existence check before submitAndWait", async () => {
      const submitter = new MultiSigSubmitter(makeConfig(KEYS));
      const store = makeStore(KEYS, 2);
      await submitter.connect();

      // The tx is ALREADY confirmed on-chain (e.g. resubmission of a prior witness).
      const queriedHashes: unknown[] = [];
      mockRequest.mockImplementation(async (req: { transaction: string }) => {
        queriedHashes.push(req.transaction);
        return { result: { validated: true, ledger_index: 555, hash: "already" } };
      });

      const record = await submitter.submit(makePayload(), store.getCurrentPolicy());

      expect(record.ledgerIndex).toBe(555);
      // Must NOT submit again — recognized as already witnessed.
      expect(mockSubmitAndWait).not.toHaveBeenCalled();
      // A-WIT-001: the existence check must query the COMBINED multisign blob's
      // on-chain hash (hashes.hashSignedTx of the combined blob), NOT a
      // per-signer signing hash.
      expect(queriedHashes).toContain("combined_onchain_hash");
      expect(queriedHashes.every((h) => !String(h).startsWith("MULTISIG_HASH"))).toBe(true);
    });
  });
});
