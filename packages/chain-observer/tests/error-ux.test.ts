/**
 * Error-UX feature tests (Feature Pass — observability + error-UX).
 *
 * Covers:
 * - D3-B-002: getStatus() surfaces a failure reason (error + errorCode) instead
 *   of an unexplained `connected: false`. A health probe still returns (never
 *   throws) and stays `connected: false` on a genuine liveness failure.
 * - D3-B-009: an EVM/Solana finality-tag failure degrades to
 *   "connected, finality unknown" — NOT "disconnected".
 * - D3-B-003: queries throw structured ObserverError with stable codes
 *   (NOT_CONNECTED, plus classified RPC failures), and emit an `rpc` telemetry
 *   event with low-cardinality { chainId, code } attributes.
 *
 * All RPC clients are mocked — no network access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvmObserver } from "../src/evm/evm-observer.js";
import { XrplObserver } from "../src/xrpl/xrpl-observer.js";
import { SolanaObserver } from "../src/solana/solana-observer.js";
import { CHAINS } from "../src/chains.js";
import {
  ETHEREUM_PROFILE,
  SOLANA_MAINNET_PROFILE,
} from "../src/profiles.js";
import { ObserverError, classifyRpcError } from "../src/errors.js";
import type { ObserverConfig } from "../src/observer.js";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";

// =============================================================================
// viem / web3.js / xrpl mocks (mutable handles so each test sets behavior)
// =============================================================================

const evmGetBlockNumber = vi.fn();
const evmGetBalance = vi.fn();
const evmGetLogs = vi.fn();
const evmGetBlock = vi.fn();
const evmReadContract = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlockNumber: evmGetBlockNumber,
      getBalance: evmGetBalance,
      getLogs: evmGetLogs,
      getBlock: evmGetBlock,
      readContract: evmReadContract,
    })),
  };
});

const solGetSlot = vi.fn();
const solGetBalance = vi.fn();

vi.mock("@solana/web3.js", async () => {
  const actual = await vi.importActual("@solana/web3.js");
  return {
    ...actual,
    Connection: vi.fn(() => ({
      getSlot: solGetSlot,
      getBalance: solGetBalance,
      getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
      getSignaturesForAddress: vi.fn().mockResolvedValue([]),
      getParsedTransactions: vi.fn().mockResolvedValue([]),
    })),
  };
});

const xrplRequest = vi.fn();
const xrplIsConnected = vi.fn().mockReturnValue(true);

vi.mock("xrpl", () => ({
  Client: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    request: xrplRequest,
    isConnected: xrplIsConnected,
  })),
}));

// =============================================================================
// Capturing telemetry sink
// =============================================================================

function makeCapturingSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return {
    telemetry: { record: (e) => { events.push(e); } },
    events,
  };
}

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override to force failures.
  evmGetBlockNumber.mockResolvedValue(12345n);
  evmGetBalance.mockResolvedValue(1n);
  evmGetLogs.mockResolvedValue([]);
  evmGetBlock.mockReset();
  evmReadContract.mockReset();
  solGetSlot.mockResolvedValue(250_000_000);
  solGetBalance.mockResolvedValue(5_000_000_000);
  xrplRequest.mockReset();
  xrplIsConnected.mockReturnValue(true);
});

// =============================================================================
// classifyRpcError — pure classifier unit tests
// =============================================================================

describe("classifyRpcError (D3-B-003)", () => {
  it("classifies rate-limit (HTTP 429) as RATE_LIMITED", () => {
    expect(classifyRpcError(new Error("Request failed with status 429"))).toBe("RATE_LIMITED");
    expect(classifyRpcError(new Error("rpc error -32005 limit exceeded"))).toBe("RATE_LIMITED");
  });

  it("classifies timeouts as RPC_TIMEOUT", () => {
    const e = new Error("The request timed out.");
    e.name = "TimeoutError";
    expect(classifyRpcError(e)).toBe("RPC_TIMEOUT");
    expect(classifyRpcError(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe("RPC_TIMEOUT");
  });

  it("classifies connection failures as RPC_UNREACHABLE", () => {
    expect(classifyRpcError(new Error("connect ECONNREFUSED 127.0.0.1:8545"))).toBe("RPC_UNREACHABLE");
    expect(classifyRpcError(new Error("getaddrinfo ENOTFOUND rpc.example.com"))).toBe("RPC_UNREACHABLE");
    expect(classifyRpcError(new Error("fetch failed"))).toBe("RPC_UNREACHABLE");
    expect(classifyRpcError(new Error("WebSocket is not connected"))).toBe("RPC_UNREACHABLE");
  });

  it("classifies bad payloads as MALFORMED_RESPONSE", () => {
    expect(classifyRpcError(new Error("Unexpected token < in JSON at position 0"))).toBe("MALFORMED_RESPONSE");
  });

  it("falls back to RPC_ERROR for anything unrecognized", () => {
    expect(classifyRpcError(new Error("something weird happened"))).toBe("RPC_ERROR");
    expect(classifyRpcError("a plain string")).toBe("RPC_ERROR");
  });
});

// =============================================================================
// D3-B-002 — getStatus surfaces failure reason (all three observers)
// =============================================================================

describe("getStatus surfaces a reason on failure (D3-B-002)", () => {
  it("EVM: not-connected status carries NOT_CONNECTED reason", async () => {
    const observer = new EvmObserver({ chain: CHAINS.ETHEREUM_MAINNET, rpcUrl: "https://x" });
    const status = await observer.getStatus();
    expect(status.connected).toBe(false);
    expect(status.errorCode).toBe("NOT_CONNECTED");
    expect(status.error).toBeTruthy();
  });

  it("EVM: a failing liveness probe yields connected:false WITH a classified reason", async () => {
    evmGetBlockNumber.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:8545"));
    const observer = new EvmObserver({ chain: CHAINS.ETHEREUM_MAINNET, rpcUrl: "https://x" });
    await observer.connect();

    const status = await observer.getStatus();

    expect(status.connected).toBe(false);
    expect(status.error).toContain("ECONNREFUSED");
    expect(status.errorCode).toBe("RPC_UNREACHABLE");
  });

  it("EVM: getStatus never throws even when the probe rejects", async () => {
    evmGetBlockNumber.mockRejectedValueOnce(new Error("boom"));
    const observer = new EvmObserver({ chain: CHAINS.ETHEREUM_MAINNET, rpcUrl: "https://x" });
    await observer.connect();
    await expect(observer.getStatus()).resolves.toBeDefined();
  });

  it("XRPL: a failing ledger probe yields connected:false WITH a reason", async () => {
    xrplRequest.mockRejectedValueOnce(new Error("websocket disconnected"));
    const observer = new XrplObserver({ chain: CHAINS.XRPL_MAINNET, rpcUrl: "wss://x" });
    await observer.connect();

    const status = await observer.getStatus();

    expect(status.connected).toBe(false);
    expect(status.error).toContain("websocket");
    expect(status.errorCode).toBe("RPC_UNREACHABLE");
  });

  it("XRPL: not-connected status carries NOT_CONNECTED reason", async () => {
    xrplIsConnected.mockReturnValue(false);
    const observer = new XrplObserver({ chain: CHAINS.XRPL_MAINNET, rpcUrl: "wss://x" });
    const status = await observer.getStatus();
    expect(status.connected).toBe(false);
    expect(status.errorCode).toBe("NOT_CONNECTED");
  });

  it("Solana: a failing getSlot probe yields connected:false WITH a reason", async () => {
    solGetSlot.mockRejectedValueOnce(new Error("503 Service Unavailable fetch failed"));
    const observer = new SolanaObserver({ chain: CHAINS.SOLANA_MAINNET, rpcUrl: "https://x" });
    await observer.connect();

    const status = await observer.getStatus();

    expect(status.connected).toBe(false);
    expect(status.error).toBeTruthy();
    expect(status.errorCode).toBe("RPC_UNREACHABLE");
  });
});

// =============================================================================
// D3-B-009 — finality-tag failure degrades, not disconnects
// =============================================================================

describe("finality-tag failure degrades to 'connected, finality unknown' (D3-B-009)", () => {
  it("EVM: stays connected when the finalized/safe block fetch fails", async () => {
    // Liveness OK, but the block-tag fetch (finalized/safe) fails.
    evmGetBlockNumber.mockResolvedValue(12345n);
    evmGetBlock.mockRejectedValue(new Error("finalized tag not supported by this RPC"));

    const observer = new EvmObserver({
      chain: CHAINS.ETHEREUM_MAINNET,
      rpcUrl: "https://x",
      profile: ETHEREUM_PROFILE,
    });
    await observer.connect();

    const status = await observer.getStatus();

    // Crucially: connected stays TRUE; latest block is present; finality is unknown.
    expect(status.connected).toBe(true);
    expect(status.latestBlock).toBe(12345);
    expect(status.finalizedBlock).toBeUndefined();
    expect(status.safeBlock).toBeUndefined();
    expect(status.error).toContain("finality unknown");
  });

  it("Solana: stays connected when the finalized-slot fetch fails", async () => {
    // First getSlot (liveness) OK, second getSlot('finalized') fails.
    solGetSlot
      .mockResolvedValueOnce(250_000_000) // liveness
      .mockRejectedValueOnce(new Error("finalized commitment unavailable")); // finalized

    const observer = new SolanaObserver({
      chain: CHAINS.SOLANA_MAINNET,
      rpcUrl: "https://x",
      profile: SOLANA_MAINNET_PROFILE,
    });
    await observer.connect();

    const status = await observer.getStatus();

    expect(status.connected).toBe(true);
    expect(status.latestBlock).toBe(250_000_000);
    expect(status.finalizedBlock).toBeUndefined();
    expect(status.error).toContain("finality unknown");
  });
});

// =============================================================================
// D3-B-003 — structured ObserverError + telemetry on query failures
// =============================================================================

describe("queries throw structured ObserverError + emit telemetry (D3-B-003)", () => {
  it("EVM: a not-connected getBalance throws ObserverError NOT_CONNECTED and emits rpc/failed", async () => {
    const { telemetry, events } = makeCapturingSink();
    const observer = new EvmObserver({ chain: CHAINS.ETHEREUM_MAINNET, rpcUrl: "https://x", telemetry });

    await expect(observer.getBalance({ address: ADDR })).rejects.toBeInstanceOf(ObserverError);
    try {
      await observer.getBalance({ address: ADDR });
    } catch (err) {
      expect((err as ObserverError).code).toBe("NOT_CONNECTED");
      expect((err as ObserverError).hint).toBeTruthy();
    }

    const rpcFailures = events.filter((e) => e.op === "rpc" && e.outcome === "failed");
    expect(rpcFailures.length).toBeGreaterThan(0);
    expect(rpcFailures[0]!.package).toBe("@attestia/chain-observer");
    expect(rpcFailures[0]!.attributes).toMatchObject({ chainId: "eip155:1", code: "NOT_CONNECTED" });
  });

  it("EVM: a classified RPC failure carries a code and emits telemetry", async () => {
    const { telemetry, events } = makeCapturingSink();
    evmGetBalance.mockRejectedValueOnce(new Error("Request failed with status 429 Too Many Requests"));
    evmGetBlockNumber.mockResolvedValue(999n);

    // Isolate classification from retry: a single transient failure would
    // otherwise be absorbed by the retry layer (PB-WCO-001).
    const observer = new EvmObserver({ chain: CHAINS.ETHEREUM_MAINNET, rpcUrl: "https://x", telemetry, retry: { maxRetries: 0, delayMs: 0 } });
    await observer.connect();

    let caught: unknown;
    try {
      await observer.getBalance({ address: ADDR });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ObserverError);
    expect((caught as ObserverError).code).toBe("RATE_LIMITED");

    const rpcFailures = events.filter((e) => e.op === "rpc" && e.outcome === "failed");
    expect(rpcFailures.some((e) => e.attributes?.code === "RATE_LIMITED")).toBe(true);
    // Attributes must be low-cardinality: only chainId + code.
    expect(Object.keys(rpcFailures[0]!.attributes ?? {}).sort()).toEqual(["chainId", "code"]);
  });

  it("EVM: connect() to a structurally-invalid eip155 ref throws UNSUPPORTED_CHAIN", async () => {
    // PB-WCO-006: UNSUPPORTED_CHAIN now fires only when the eip155 chain id
    // cannot be parsed to a positive integer (a malformed chain ref) — a
    // numeric-but-unknown chain instead synthesizes a minimal chain (see below).
    const observer = new EvmObserver({
      chain: { chainId: "eip155:not-a-number", name: "nope", family: "evm" },
      rpcUrl: "https://x",
    });
    await expect(observer.connect()).rejects.toBeInstanceOf(ObserverError);
    try {
      await observer.connect();
    } catch (err) {
      expect((err as ObserverError).code).toBe("UNSUPPORTED_CHAIN");
    }
  });

  it("EVM: connect() to a numeric-but-unknown eip155 chain synthesizes a chain (PB-WCO-006)", async () => {
    // A valid eip155:<id> that is NOT in the built-in map should degrade to
    // "works with defaults" rather than hard-failing — supporting a new L2 is
    // configuration, not a source edit.
    evmGetBlockNumber.mockResolvedValue(42n);
    const observer = new EvmObserver({
      chain: { chainId: "eip155:8217", name: "Klaytn", family: "evm" },
      rpcUrl: "https://x",
    });
    await expect(observer.connect()).resolves.toBeUndefined();
    const status = await observer.getStatus();
    expect(status.connected).toBe(true);
    expect(status.latestBlock).toBe(42);
  });

  it("EVM: connect() honors a config-supplied evmChain descriptor (PB-WCO-006)", async () => {
    evmGetBlockNumber.mockResolvedValue(7n);
    const observer = new EvmObserver({
      chain: { chainId: "eip155:1313161554", name: "Aurora", family: "evm" },
      rpcUrl: "https://x",
      evmChain: {
        id: 1313161554,
        name: "Aurora Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    });
    await expect(observer.connect()).resolves.toBeUndefined();
    const status = await observer.getStatus();
    expect(status.connected).toBe(true);
  });

  it("XRPL: a not-connected getBalance throws ObserverError NOT_CONNECTED and emits telemetry", async () => {
    const { telemetry, events } = makeCapturingSink();
    xrplIsConnected.mockReturnValue(false);
    const observer = new XrplObserver({ chain: CHAINS.XRPL_MAINNET, rpcUrl: "wss://x", telemetry });

    let caught: unknown;
    try {
      await observer.getBalance({ address: "rSomeAddress" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ObserverError);
    expect((caught as ObserverError).code).toBe("NOT_CONNECTED");
    expect(events.some((e) => e.op === "rpc" && e.attributes?.code === "NOT_CONNECTED")).toBe(true);
  });

  it("XRPL: a classified request failure surfaces as ObserverError with a code", async () => {
    const { telemetry, events } = makeCapturingSink();
    xrplIsConnected.mockReturnValue(true);
    xrplRequest.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));

    // Isolate classification from retry (PB-WCO-001).
    const observer = new XrplObserver({ chain: CHAINS.XRPL_MAINNET, rpcUrl: "wss://x", telemetry, retry: { maxRetries: 0, delayMs: 0 } });
    await observer.connect();

    let caught: unknown;
    try {
      await observer.getBalance({ address: "rSomeAddress" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ObserverError);
    expect((caught as ObserverError).code).toBe("RPC_TIMEOUT");
    expect(events.some((e) => e.op === "rpc" && e.attributes?.code === "RPC_TIMEOUT")).toBe(true);
  });

  it("XRPL: getTokenBalance without an issuer throws structured INVALID_QUERY", async () => {
    xrplIsConnected.mockReturnValue(true);
    const observer = new XrplObserver({ chain: CHAINS.XRPL_MAINNET, rpcUrl: "wss://x" });
    await observer.connect();

    let caught: unknown;
    try {
      await observer.getTokenBalance({ address: "rSomeAddress", token: "USD" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ObserverError);
    expect((caught as ObserverError).code).toBe("INVALID_QUERY");
  });

  it("Solana: a not-connected getBalance throws ObserverError NOT_CONNECTED and emits telemetry", async () => {
    const { telemetry, events } = makeCapturingSink();
    const observer = new SolanaObserver({ chain: CHAINS.SOLANA_MAINNET, rpcUrl: "https://x", telemetry });

    let caught: unknown;
    try {
      await observer.getBalance({ address: "SomeSolanaAddress11111111111111111111111111" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ObserverError);
    expect((caught as ObserverError).code).toBe("NOT_CONNECTED");
    expect(events.some((e) => e.op === "rpc" && e.attributes?.code === "NOT_CONNECTED")).toBe(true);
  });

  it("emitting telemetry never throws into the caller even if the sink throws", async () => {
    const throwingSink: Telemetry = {
      record: () => { throw new Error("sink exploded"); },
    };
    const observer = new EvmObserver({ chain: CHAINS.ETHEREUM_MAINNET, rpcUrl: "https://x", telemetry: throwingSink });
    // requireClient() emits a failure event then throws the ObserverError.
    // The sink throwing must NOT mask the ObserverError or surface "sink exploded".
    await expect(observer.getBalance({ address: ADDR })).rejects.toBeInstanceOf(ObserverError);
  });
});

// =============================================================================
// PB-WCO-001 / PB-WCO-004 — retry parity + retry telemetry across families
// =============================================================================

describe("RPC retry parity + telemetry (PB-WCO-001, PB-WCO-004)", () => {
  it("EVM: absorbs a transient blip with a retry and emits rpc.retry", async () => {
    const { telemetry, events } = makeCapturingSink();
    evmGetBlockNumber.mockResolvedValue(123n);
    // First call rate-limited, second succeeds — the retry layer recovers it.
    evmGetBalance
      .mockRejectedValueOnce(new Error("Request failed with status 429"))
      .mockResolvedValue(7n);

    const observer = new EvmObserver({
      chain: CHAINS.ETHEREUM_MAINNET,
      rpcUrl: "https://x",
      telemetry,
      retry: { maxRetries: 3, delayMs: 0 },
    });
    await observer.connect();

    const result = await observer.getBalance({ address: ADDR });
    expect(result.balance).toBe("7");

    const retries = events.filter((e) => e.op === "rpc.retry");
    expect(retries.length).toBeGreaterThan(0);
    expect(retries[0]!.outcome).toBe("degraded");
    expect(retries[0]!.attributes).toMatchObject({ chainId: "eip155:1", code: "RATE_LIMITED", attempt: 1 });
    // No hard failure event was emitted, since the call ultimately succeeded.
    expect(events.some((e) => e.op === "rpc" && e.outcome === "failed")).toBe(false);
  });

  it("XRPL: absorbs a transient blip with a retry (parity with EVM/Solana)", async () => {
    const { telemetry, events } = makeCapturingSink();
    xrplIsConnected.mockReturnValue(true);
    xrplRequest
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue({ result: { account_data: { Balance: "1000000" }, ledger_index: 42 } });

    const observer = new XrplObserver({
      chain: CHAINS.XRPL_MAINNET,
      rpcUrl: "wss://x",
      telemetry,
      retry: { maxRetries: 3, delayMs: 0 },
    });
    await observer.connect();

    const result = await observer.getBalance({ address: "rSomeAddress" });
    expect(result.balance).toBe("1000000");
    expect(events.some((e) => e.op === "rpc.retry" && e.attributes?.code === "RPC_UNREACHABLE")).toBe(true);
  });

  it("Solana: retries are no longer silent — emits rpc.retry (PB-WCO-004)", async () => {
    const { telemetry, events } = makeCapturingSink();
    solGetSlot.mockResolvedValue(250_000_000);
    solGetBalance
      .mockRejectedValueOnce(new Error("503 Service Unavailable fetch failed"))
      .mockResolvedValue(5_000_000_000);

    const observer = new SolanaObserver({
      chain: CHAINS.SOLANA_MAINNET,
      rpcUrl: "https://x",
      telemetry,
      retry: { maxRetries: 3, delayMs: 0 },
    });
    await observer.connect();

    await observer.getBalance({ address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
    expect(events.some((e) => e.op === "rpc.retry")).toBe(true);
  });
});

// =============================================================================
// PB-WCO-005 — token-metadata fallback is flagged + metered, not silent
// =============================================================================

describe("token metadata fallback is surfaced (PB-WCO-005)", () => {
  it("EVM: emits token_meta_fallback and does NOT cache the guess", async () => {
    const { telemetry, events } = makeCapturingSink();
    evmGetBlockNumber.mockResolvedValue(200n);
    evmGetLogs.mockResolvedValue([
      {
        transactionHash: "0xabc",
        blockNumber: 150n,
        address: "0xbadtoken",
        args: { from: "0xsender", to: ADDR, value: 100n },
      },
    ]);
    // First resolve attempt fails (symbol+decimals readContract rejects)...
    evmReadContract.mockRejectedValueOnce(new Error("revert")).mockRejectedValueOnce(new Error("revert"));

    const observer = new EvmObserver({
      chain: CHAINS.ETHEREUM_MAINNET,
      rpcUrl: "https://x",
      telemetry,
    });
    await observer.connect();

    const result = await observer.getTransfers({
      address: ADDR,
      direction: "incoming",
      token: "0xbadtoken",
      fromBlock: 100,
      toBlock: 200,
    });

    expect(result[0]!.metaResolved).toBe(false);
    expect(result[0]!.symbol).toBe("UNKNOWN");

    const fallbacks = events.filter((e) => e.op === "token_meta_fallback");
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks[0]!.outcome).toBe("degraded");
    expect(fallbacks[0]!.attributes).toMatchObject({ chainId: "eip155:1" });
    // Low-cardinality: chainId only (no token address / amount in attributes).
    expect(Object.keys(fallbacks[0]!.attributes ?? {})).toEqual(["chainId"]);
  });
});
