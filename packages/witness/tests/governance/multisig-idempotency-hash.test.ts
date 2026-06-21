/**
 * A-WIT-001 — multi-sig idempotency hash must be the COMBINED multisign() blob
 * hash, not a per-signer signing hash.
 *
 * The transaction that actually lands on-chain is `multisign([...signedBlobs])`,
 * whose serialization (and therefore its tx id) differs from any single signer's
 * `wallet.sign(prepared, /*multisign*\/ true).hash`. The replay/idempotency guard
 * (`_checkExistingTx`) must query the COMBINED blob's hash; otherwise the
 * lost-but-applied recovery queries a hash that never appears on-chain and the
 * guard silently fails (false-negative → duplicate submission risk).
 *
 * RED before the fix: MultiSignResult.txHash equals the per-signer hash, so the
 * existence check queries the wrong hash and the assertion below fails.
 *
 * The xrpl network surface is mocked, but the per-signer hash and the
 * combined-blob hash are made DELIBERATELY DIFFERENT so the bug is observable:
 * per-signer sign() yields `PER_SIGNER_HASH`, while hashes.hashSignedTx() of the
 * combined blob yields `COMBINED_ONCHAIN_HASH`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSeed, deriveKeypair, deriveAddress } from "ripple-keypairs";
import { MultiSigSubmitter } from "../../src/governance/multisig-submitter.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import type { MultiSigConfig } from "../../src/governance/multisig-submitter.js";
import type { AttestationPayload } from "../../src/types.js";

// =============================================================================
// Real keypairs (so verify-then-count works) — only the xrpl network surface
// is mocked.
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

const PER_SIGNER_HASH = "PER_SIGNER_HASH";
const COMBINED_BLOB = "combined_multisign_blob";
const COMBINED_ONCHAIN_HASH = "COMBINED_ONCHAIN_HASH";

const {
  mockConnect,
  mockDisconnect,
  mockIsConnected,
  mockAutofill,
  mockSubmitAndWait,
  mockRequest,
  mockHashSignedTx,
} = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
  mockIsConnected: vi.fn().mockReturnValue(true),
  mockAutofill: vi.fn(),
  mockSubmitAndWait: vi.fn(),
  mockRequest: vi.fn(),
  mockHashSignedTx: vi.fn(),
}));

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
          sign: vi.fn().mockImplementation(() => ({
            tx_blob: `blob_${key.address}`,
            // Per-signer hash — deliberately DIFFERENT from the combined hash.
            hash: "PER_SIGNER_HASH",
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
    // The on-chain tx id is derived from the COMBINED blob, not a per-signer blob.
    hashes: {
      ...actual.hashes,
      hashSignedTx: mockHashSignedTx,
    },
  };
});

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

function makeStore(keys: TestKey[], quorum: number): GovernanceStore {
  const store = new GovernanceStore();
  for (const [i, k] of keys.entries()) {
    store.addSigner(k.address, `Signer ${i + 1}`, 1, k.publicKey);
  }
  store.changeQuorum(quorum);
  return store;
}

describe("A-WIT-001 — idempotency hash is the combined multisign() blob hash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashSignedTx.mockImplementation((blob: string) =>
      blob === COMBINED_BLOB ? COMBINED_ONCHAIN_HASH : `UNEXPECTED_HASH_FOR_${blob}`,
    );
    mockAutofill.mockImplementation((tx: Record<string, unknown>) => ({
      ...tx,
      Sequence: 100,
      Fee: "12",
      LastLedgerSequence: 200,
    }));
    mockSubmitAndWait.mockResolvedValue({
      result: { hash: COMBINED_ONCHAIN_HASH, meta: { ledger_index: 42 }, ledger_index: 42 },
    });
    mockRequest.mockRejectedValue(new Error("txnNotFound"));
  });

  it("buildMultiSign stores the combined-blob hash (NOT the per-signer hash)", async () => {
    const submitter = new MultiSigSubmitter(makeConfig(KEYS));
    const store = makeStore(KEYS, 2);
    await submitter.connect();
    const policy = store.getCurrentPolicy();

    const prepared = { TransactionType: "Payment", Account: MASTER_ACCOUNT, Sequence: 100 } as never;
    const result = submitter.buildMultiSign(makePayload(), policy, prepared);

    // The existence-check hash MUST equal the on-chain combined-tx hash.
    expect(result.txHash).toBe(COMBINED_ONCHAIN_HASH);
    // And MUST NOT be the per-signer hash (the bug).
    expect(result.txHash).not.toBe(PER_SIGNER_HASH);
    // The hash is derived from the combined blob specifically.
    expect(mockHashSignedTx).toHaveBeenCalledWith(COMBINED_BLOB);
  });

  it("pre-submit existence check QUERIES the combined-blob hash and recovers a lost-but-applied tx", async () => {
    const submitter = new MultiSigSubmitter(makeConfig(KEYS));
    const store = makeStore(KEYS, 2);
    await submitter.connect();

    // The combined tx is already validated on-chain under its COMBINED hash.
    // The guard only recovers it if it queries the COMBINED hash (the fix).
    const queriedHashes: unknown[] = [];
    mockRequest.mockImplementation(async (req: { transaction: string }) => {
      queriedHashes.push(req.transaction);
      if (req.transaction === COMBINED_ONCHAIN_HASH) {
        return { result: { validated: true, ledger_index: 777, hash: COMBINED_ONCHAIN_HASH } };
      }
      throw new Error("txnNotFound");
    });

    const record = await submitter.submit(makePayload(), store.getCurrentPolicy());

    // Recovered via the combined-hash existence check — no duplicate submission.
    expect(record.ledgerIndex).toBe(777);
    expect(record.txHash).toBe(COMBINED_ONCHAIN_HASH);
    expect(mockSubmitAndWait).not.toHaveBeenCalled();
    // The guard queried the combined on-chain hash, never the per-signer hash.
    expect(queriedHashes).toContain(COMBINED_ONCHAIN_HASH);
    expect(queriedHashes).not.toContain(PER_SIGNER_HASH);
  });
});
