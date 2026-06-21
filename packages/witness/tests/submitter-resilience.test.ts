/**
 * Stage C resilience tests for the witness submit path.
 *
 * Covers:
 * - PB-WCO-002: a per-attempt deadline bounds submitAndWait. A hung attempt
 *   becomes a retryable AttemptTimeoutError; the retry's fixed-hash idempotency
 *   check recovers a possibly-applied tx instead of resubmitting blindly. A
 *   submit.timeout telemetry warn is emitted.
 * - PB-WCO-003: a connection dropped mid-submit triggers a single best-effort
 *   reconnect with a distinct telemetry signal; a failed reconnect surfaces a
 *   clear, actionable error instead of silently bricking the submitter.
 *
 * Fully mocked XRPL client — no network.
 */

import { describe, it, expect, vi } from "vitest";
import { XrplSubmitter } from "../src/submitter.js";
import { buildReconciliationPayload } from "../src/payload.js";
import type { WitnessConfig } from "../src/types.js";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";

function makeSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return { telemetry: { record: (e) => { events.push(e); } }, events };
}

const fastRetry = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 };

function makePayload() {
  return buildReconciliationPayload(
    {
      id: "recon-res",
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
      id: "att:recon-res",
      reconciliationId: "recon-res",
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
      reportHash: "res-hash",
    },
  );
}

interface MockClient {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  autofill: ReturnType<typeof vi.fn>;
  submitAndWait: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

function inject(submitter: XrplSubmitter): MockClient {
  const mockClient: MockClient = {
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
  return mockClient;
}

const baseConfig: WitnessConfig = {
  rpcUrl: "wss://dummy",
  chainId: "xrpl:testnet",
  account: "rTestAccount",
  secret: "sEdTM1uX8pu2do5XvTnutH6HsouMaM2",
};

// =============================================================================
// PB-WCO-002 — per-attempt submitAndWait deadline
// =============================================================================

describe("submitAndWait per-attempt timeout (PB-WCO-002)", () => {
  it("a hung submitAndWait times out, retries, and recovers via idempotency", async () => {
    const { telemetry, events } = makeSink();
    const submitter = new XrplSubmitter({
      ...baseConfig,
      telemetry,
      retry: fastRetry,
      submitTimeoutMs: 20, // tiny per-attempt deadline
    });
    const client = inject(submitter);

    // First attempt: submitAndWait HANGS forever (half-open WebSocket) → deadline
    // elapses → AttemptTimeoutError → retry. The tx actually applied, so the
    // second attempt's pre-submit existence check recovers it.
    client.submitAndWait
      .mockImplementationOnce(() => new Promise(() => {})) // never settles
      .mockResolvedValue({ result: { meta: { ledger_index: 777 } } });

    let checks = 0;
    client.request.mockImplementation(async () => {
      checks += 1;
      if (checks === 1) throw new Error("txnNotFound"); // first attempt: not yet on-chain
      return { result: { validated: true, ledger_index: 777 } }; // recovered after timeout
    });

    const record = await submitter.submit(makePayload());

    expect(record.ledgerIndex).toBe(777);
    // The hung first attempt did NOT cause a duplicate submission — the recovery
    // came from the idempotency check, so submitAndWait ran exactly once.
    expect(client.submitAndWait).toHaveBeenCalledTimes(1);

    // submit.timeout telemetry warn was emitted for the hung attempt.
    const timeout = events.find((e) => e.op === "submit.timeout");
    expect(timeout).toBeDefined();
    expect(timeout!.level).toBe("warn");
    expect(timeout!.outcome).toBe("degraded");
    expect(timeout!.attributes).toMatchObject({ attempt: 1 });

    // A retry fired and the run ended ok via the idempotent hit.
    expect(events.some((e) => e.op === "submit.retry")).toBe(true);
    expect(events.some((e) => e.op === "submit.idempotent_hit")).toBe(true);
    expect(events.some((e) => e.op === "submit" && e.outcome === "ok")).toBe(true);
  });

  it("does not blindly resubmit on timeout — the same fixed blob is reused", async () => {
    const submitter = new XrplSubmitter({
      ...baseConfig,
      retry: fastRetry,
      submitTimeoutMs: 20,
    });
    const client = inject(submitter);

    // First attempt hangs → timeout; second attempt succeeds normally (tx was
    // NOT applied, existence check keeps returning not-found).
    client.submitAndWait
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ result: { meta: { ledger_index: 555 } } });

    const record = await submitter.submit(makePayload());

    expect(record.txHash).toBe("TXHASH_ABC123"); // fixed hash unchanged across attempts
    // Both submitAndWait calls used the SAME signed blob (determinism preserved).
    for (const call of client.submitAndWait.mock.calls) {
      expect(call[0]).toBe("SIGNED_BLOB");
    }
  });

  it("submitTimeoutMs <= 0 disables the deadline (unbounded wait restored)", async () => {
    const submitter = new XrplSubmitter({ ...baseConfig, submitTimeoutMs: 0 });
    const client = inject(submitter);
    client.submitAndWait.mockResolvedValue({ result: { meta: { ledger_index: 1 } } });
    const record = await submitter.submit(makePayload());
    expect(record.ledgerIndex).toBe(1);
  });
});

// =============================================================================
// PB-WCO-003 — connection dropped mid-submit
// =============================================================================

describe("connection lost mid-submit (PB-WCO-003)", () => {
  it("reconnects once and continues when the connection dropped, emitting a signal", async () => {
    const { telemetry, events } = makeSink();
    const submitter = new XrplSubmitter({ ...baseConfig, telemetry, retry: fastRetry });
    const client = inject(submitter);

    // Connection is down on the first submit attempt, restored after reconnect.
    client.isConnected.mockReturnValueOnce(false).mockReturnValue(true);

    const record = await submitter.submit(makePayload());

    expect(record.ledgerIndex).toBe(999);
    // A reconnect was attempted exactly once.
    expect(client.connect).toHaveBeenCalledTimes(1);

    const signal = events.find((e) => e.op === "submit.connection_lost");
    expect(signal).toBeDefined();
    expect(signal!.attributes).toMatchObject({ attempt: 1, reconnected: true });
    expect(signal!.level).toBe("warn");
  });

  it("surfaces a clear, actionable error when the reconnect fails", async () => {
    const { telemetry, events } = makeSink();
    const submitter = new XrplSubmitter({ ...baseConfig, telemetry, retry: { ...fastRetry, maxAttempts: 1 } });
    const client = inject(submitter);

    client.isConnected.mockReturnValue(false); // never comes back
    client.connect.mockRejectedValue(new Error("endpoint unreachable"));

    await expect(submitter.submit(makePayload())).rejects.toThrow(/connect\(\) to recover/);

    const signal = events.find((e) => e.op === "submit.connection_lost");
    expect(signal).toBeDefined();
    expect(signal!.attributes).toMatchObject({ reconnected: false });
    expect(signal!.level).toBe("error");
  });
});
