/**
 * D3-A-001 — Single-sig idempotency under retry.
 *
 * The idempotency guard must survive retries. Previously, autofill + sign ran
 * INSIDE the retry loop, so each retry re-fetched the Sequence, producing a new
 * transaction hash; `_checkExistingTx` then looked up the *new* hash, missed the
 * already-applied tx, and re-submitted — a duplicate fund-affecting submission.
 *
 * The fix: autofill + sign ONCE before the retry loop (fixed Sequence +
 * LastLedgerSequence → fixed hash), and retry only `submitAndWait` of that single
 * signed blob, checking the SAME fixed hash each attempt.
 *
 * Scenario: submitAndWait throws a retryable error the first time (response lost,
 * but the tx WAS applied on-ledger). On retry, the fixed-hash existence check must
 * find it and return WITHOUT a second submitAndWait.
 */

import { describe, it, expect, vi } from "vitest";
import { XrplSubmitter } from "../src/submitter.js";
import { buildReconciliationPayload } from "../src/payload.js";
import type { WitnessConfig } from "../src/types.js";

const testConfig: WitnessConfig = {
  rpcUrl: "wss://dummy",
  chainId: "xrpl:testnet",
  account: "rTestAccount",
  secret: "sEdTM1uX8pu2do5XvTnutH6HsouMaM2",
  // Fast retry so the test does not wait on real backoff.
  retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 },
};

function makePayload() {
  return buildReconciliationPayload(
    {
      id: "recon-idem",
      scope: {},
      timestamp: "2024-01-01T00:00:00Z",
      intentLedgerMatches: [],
      ledgerChainMatches: [],
      intentChainMatches: [],
      summary: {
        totalIntents: 1,
        totalLedgerEntries: 1,
        totalChainEvents: 1,
        matchedCount: 1,
        mismatchCount: 0,
        missingCount: 0,
        allReconciled: true,
        discrepancies: [],
      },
    },
    {
      id: "att:recon-idem",
      reconciliationId: "recon-idem",
      allReconciled: true,
      summary: {
        totalIntents: 1,
        totalLedgerEntries: 1,
        totalChainEvents: 1,
        matchedCount: 1,
        mismatchCount: 0,
        missingCount: 0,
        allReconciled: true,
        discrepancies: [],
      },
      attestedBy: "test",
      attestedAt: "2024-01-01T00:00:01Z",
      reportHash: "idem-hash",
    },
  );
}

describe("XrplSubmitter idempotency under retry (D3-A-001)", () => {
  it("does NOT double-submit when the first response is lost then retried", async () => {
    const submitter = new XrplSubmitter(testConfig);

    let autofillCalls = 0;
    let sequenceCounter = 100;

    // Each autofill returns an INCREASING Sequence — if autofill ran per-retry,
    // the signed hash would differ between attempts and the existence check would miss.
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
      autofill: vi.fn().mockImplementation((tx: Record<string, unknown>) => {
        autofillCalls += 1;
        return { ...tx, Sequence: sequenceCounter++, Fee: "12", LastLedgerSequence: 200 };
      }),
      // First call: applied on-ledger but response lost (retryable). Then never called again.
      submitAndWait: vi.fn().mockRejectedValueOnce(new Error("timeout: connection lost")),
      // tx lookup: not found on the first (pre-submit) check, found after the lost submission.
      request: vi.fn(),
    };

    // Sign returns a hash that depends on the Sequence in the prepared tx, so a
    // re-autofill (new Sequence) would yield a different hash.
    const signCalls: string[] = [];
    const mockWallet = {
      classicAddress: "rTestAccount",
      sign: vi.fn().mockImplementation((prepared: Record<string, unknown>) => {
        const hash = `HASH_SEQ_${prepared.Sequence}`;
        signCalls.push(hash);
        return { tx_blob: `BLOB_SEQ_${prepared.Sequence}`, hash };
      }),
    };

    // request(tx) behaviour: the FIRST existence check (before submit) finds nothing;
    // after the lost submitAndWait, the SAME fixed hash is now validated on-ledger.
    let existenceChecks = 0;
    mockClient.request.mockImplementation(async (req: { command: string; transaction: string }) => {
      existenceChecks += 1;
      // First pre-submit check: not found.
      if (existenceChecks === 1) {
        throw new Error("txnNotFound");
      }
      // Subsequent checks: the originally-signed tx is now validated.
      // Crucially this must be queried with the SAME hash that was first signed.
      expect(req.transaction).toBe(signCalls[0]);
      return { result: { validated: true, ledger_index: 888, hash: req.transaction } };
    });

    (submitter as unknown as { client: unknown }).client = mockClient;
    (submitter as unknown as { wallet: unknown }).wallet = mockWallet;

    const record = await submitter.submit(makePayload());

    // The on-ledger tx was found via the fixed hash — no duplicate submission.
    expect(record.ledgerIndex).toBe(888);
    expect(record.txHash).toBe(signCalls[0]);

    // submitAndWait must have been attempted exactly once (the lost one); the retry
    // path must NOT have re-submitted.
    expect(mockClient.submitAndWait).toHaveBeenCalledTimes(1);

    // Autofill + sign happen ONCE (before the loop), not per retry.
    expect(autofillCalls).toBe(1);
    expect(signCalls.length).toBe(1);
  });
});
