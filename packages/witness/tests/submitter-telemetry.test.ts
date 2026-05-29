/**
 * D3-B-001 — witness submission telemetry.
 *
 * The submitter is the riskiest external-IO surface in the stack. With a
 * telemetry sink injected, it must emit:
 *  - `submit` attempt (level info) up front
 *  - `submit.retry` (level warn, attributes { attempt }) on each retry
 *  - `submit.idempotent_hit` (level warn) when a lost-but-applied tx is recovered
 *    via the fixed-hash existence check
 *  - `submit` final outcome ok|failed with durationMs (txHash/ledgerIndex live in
 *    `message`, NOT in low-cardinality `attributes`)
 *
 * Verified with a capturing sink over a fully-mocked XRPL client (no network).
 */

import { describe, it, expect, vi } from "vitest";
import { XrplSubmitter } from "../src/submitter.js";
import { MultiSigSubmitter, type MultiSigConfig } from "../src/governance/multisig-submitter.js";
import { buildReconciliationPayload } from "../src/payload.js";
import type { WitnessConfig } from "../src/types.js";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";

// =============================================================================
// Helpers
// =============================================================================

function makeSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return { telemetry: { record: (e) => { events.push(e); } }, events };
}

const fastRetry = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 };

function makePayload() {
  return buildReconciliationPayload(
    {
      id: "recon-tel",
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
      id: "att:recon-tel",
      reconciliationId: "recon-tel",
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
      reportHash: "tel-hash",
    },
  );
}

function injectHappyClient(submitter: XrplSubmitter) {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    autofill: vi.fn().mockImplementation((tx: unknown) => tx),
    submitAndWait: vi.fn().mockResolvedValue({ result: { meta: { ledger_index: 999 } } }),
    request: vi.fn().mockRejectedValue(new Error("txnNotFound")),
  };
  const mockWallet = {
    classicAddress: "rTestAccount",
    sign: vi.fn().mockReturnValue({ tx_blob: "SIGNED_BLOB", hash: "TXHASH_ABC123" }),
  };
  (submitter as unknown as { client: unknown }).client = mockClient;
  (submitter as unknown as { wallet: unknown }).wallet = mockWallet;
  return { mockClient, mockWallet };
}

const baseConfig: WitnessConfig = {
  rpcUrl: "wss://dummy",
  chainId: "xrpl:testnet",
  account: "rTestAccount",
  secret: "sEdTM1uX8pu2do5XvTnutH6HsouMaM2",
};

// =============================================================================
// XrplSubmitter telemetry
// =============================================================================

describe("XrplSubmitter telemetry (D3-B-001)", () => {
  it("emits attempt + final ok (with durationMs) on a clean submission", async () => {
    const { telemetry, events } = makeSink();
    const submitter = new XrplSubmitter({ ...baseConfig, telemetry });
    injectHappyClient(submitter);

    await submitter.submit(makePayload());

    const attempt = events.find((e) => e.op === "submit" && e.level === "info" && e.outcome === undefined);
    expect(attempt).toBeDefined();

    const final = events.find((e) => e.op === "submit" && e.outcome === "ok");
    expect(final).toBeDefined();
    expect(final!.package).toBe("@attestia/witness");
    expect(typeof final!.durationMs).toBe("number");
    // txHash/ledgerIndex must live in message, NOT attributes.
    expect(final!.message).toContain("TXHASH_ABC123");
    expect(final!.attributes).toBeUndefined();

    // No retries on a clean path.
    expect(events.some((e) => e.op === "submit.retry")).toBe(false);
  });

  it("emits submit.retry (warn, { attempt }) when the first submit fails then succeeds", async () => {
    const { telemetry, events } = makeSink();
    const submitter = new XrplSubmitter({ ...baseConfig, telemetry, retry: fastRetry });
    const { mockClient } = injectHappyClient(submitter);

    // First submitAndWait fails (retryable), second succeeds. request() always
    // says "not found" so the retry path actually re-submits (not idempotent hit).
    mockClient.submitAndWait
      .mockRejectedValueOnce(new Error("temporary network blip"))
      .mockResolvedValueOnce({ result: { meta: { ledger_index: 1000 } } });

    await submitter.submit(makePayload());

    const retries = events.filter((e) => e.op === "submit.retry");
    expect(retries.length).toBe(1);
    expect(retries[0]!.level).toBe("warn");
    expect(retries[0]!.attributes).toMatchObject({ attempt: 1 });

    // Still ends ok.
    expect(events.some((e) => e.op === "submit" && e.outcome === "ok")).toBe(true);
  });

  it("emits submit.idempotent_hit (warn) when a lost-but-applied tx is recovered", async () => {
    const { telemetry, events } = makeSink();
    const submitter = new XrplSubmitter({ ...baseConfig, telemetry, retry: fastRetry });
    const { mockClient } = injectHappyClient(submitter);

    // Submit "loses" its response (retryable), but the tx WAS applied — so the
    // second attempt's pre-submit existence check finds it.
    mockClient.submitAndWait.mockRejectedValueOnce(new Error("timeout: connection lost"));

    let checks = 0;
    mockClient.request.mockImplementation(async () => {
      checks += 1;
      if (checks === 1) throw new Error("txnNotFound"); // pre-submit: not found
      return { result: { validated: true, ledger_index: 888 } }; // recovered
    });

    const record = await submitter.submit(makePayload());

    expect(record.ledgerIndex).toBe(888);

    const hit = events.find((e) => e.op === "submit.idempotent_hit");
    expect(hit).toBeDefined();
    expect(hit!.level).toBe("warn");
    expect(hit!.message).toContain("888");

    // A retry fired (the lost attempt → retry), then the idempotent hit resolved it.
    expect(events.some((e) => e.op === "submit.retry")).toBe(true);
    // submitAndWait attempted exactly once (no duplicate submission).
    expect(mockClient.submitAndWait).toHaveBeenCalledTimes(1);
    // Ends ok.
    expect(events.some((e) => e.op === "submit" && e.outcome === "ok")).toBe(true);
  });

  it("emits final outcome=failed (error) when all attempts are exhausted", async () => {
    const { telemetry, events } = makeSink();
    const submitter = new XrplSubmitter({ ...baseConfig, telemetry, retry: fastRetry });
    const { mockClient } = injectHappyClient(submitter);

    mockClient.submitAndWait.mockRejectedValue(new Error("persistent network failure"));

    await expect(submitter.submit(makePayload())).rejects.toThrow();

    const final = events.find((e) => e.op === "submit" && e.outcome === "failed");
    expect(final).toBeDefined();
    expect(final!.level).toBe("error");
    expect(typeof final!.durationMs).toBe("number");
    expect(final!.message).toContain("failed");
  });

  it("emits nothing extra and does not throw when no sink is injected (NOOP default)", async () => {
    const submitter = new XrplSubmitter(baseConfig); // no telemetry
    injectHappyClient(submitter);
    // Should simply work — the default NOOP sink swallows everything.
    const record = await submitter.submit(makePayload());
    expect(record.txHash).toBe("TXHASH_ABC123");
  });
});

// =============================================================================
// MultiSigSubmitter telemetry — verifies the same wiring on the multi-sig path
// =============================================================================

describe("MultiSigSubmitter telemetry (D3-B-001)", () => {
  it("emits submit.idempotent_hit when a lost-but-applied multi-sig tx is recovered", async () => {
    const { telemetry, events } = makeSink();

    const config: MultiSigConfig = {
      rpcUrl: "wss://dummy",
      chainId: "xrpl:testnet",
      account: "rMaster",
      signers: [],
      retry: fastRetry,
      telemetry,
    };
    const submitter = new MultiSigSubmitter(config);

    const mockClient = {
      isConnected: vi.fn().mockReturnValue(true),
      autofill: vi.fn().mockImplementation((tx: unknown) => tx),
      submitAndWait: vi.fn(),
      request: vi.fn(),
    };
    (submitter as unknown as { client: unknown }).client = mockClient;
    // Non-empty wallets so submit() passes the connected guard.
    (submitter as unknown as { wallets: Map<string, unknown> }).wallets = new Map([
      ["rSigner1", {}],
    ]);

    // Stub buildMultiSign so we don't need real signing — return a fixed hash.
    (submitter as unknown as { buildMultiSign: () => unknown }).buildMultiSign = () => ({
      signedBlobs: ["b"],
      signerSignatures: [],
      combinedBlob: "COMBINED",
      txHash: "MS_TXHASH",
    });

    // The pre-submit existence check finds the tx already validated (idempotent hit).
    mockClient.request.mockResolvedValue({ result: { validated: true, ledger_index: 4242 } });

    const record = await submitter.submit(makePayload(), {} as never);

    expect(record.ledgerIndex).toBe(4242);
    expect(mockClient.submitAndWait).not.toHaveBeenCalled();

    const hit = events.find((e) => e.op === "submit.idempotent_hit");
    expect(hit).toBeDefined();
    expect(hit!.package).toBe("@attestia/witness");
    expect(hit!.message).toContain("4242");

    // attempt + final ok also emitted.
    expect(events.some((e) => e.op === "submit" && e.outcome === undefined && e.level === "info")).toBe(true);
    expect(events.some((e) => e.op === "submit" && e.outcome === "ok")).toBe(true);
  });
});
