/**
 * Tests for EvmObserver.
 *
 * Uses vitest mocking to mock viem's createPublicClient.
 * No actual RPC calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvmObserver } from "../../src/evm/evm-observer.js";
import { CHAINS } from "../../src/chains.js";
import {
  ETHEREUM_PROFILE,
  POLYGON_PROFILE,
  ARBITRUM_PROFILE,
} from "../../src/profiles.js";
import type { ObserverConfig } from "../../src/observer.js";

// =============================================================================
// Mocks
// =============================================================================

const mockGetBlockNumber = vi.fn().mockResolvedValue(12345n);
const mockGetBalance = vi.fn().mockResolvedValue(1000000000000000000n);
const mockReadContract = vi.fn();
const mockGetLogs = vi.fn().mockResolvedValue([]);
const mockGetBlock = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlockNumber: mockGetBlockNumber,
      getBalance: mockGetBalance,
      readContract: mockReadContract,
      getLogs: mockGetLogs,
      getBlock: mockGetBlock,
    })),
  };
});

function createConfig(
  chain = CHAINS.ETHEREUM_MAINNET,
  profile?: ObserverConfig["profile"],
): ObserverConfig {
  return {
    chain,
    rpcUrl: "https://mock-rpc.example.com",
    timeoutMs: 5000,
    ...(profile && { profile }),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("EvmObserver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockReset();
    mockGetLogs.mockResolvedValue([]);
    mockGetBlock.mockReset();
  });

  describe("constructor", () => {
    it("creates observer for EVM chain", () => {
      const observer = new EvmObserver(createConfig());
      expect(observer.chainId).toBe("eip155:1");
    });

    it("rejects non-EVM chain IDs", () => {
      expect(
        () =>
          new EvmObserver(createConfig(CHAINS.XRPL_MAINNET))
      ).toThrow("expected EVM chain ID");
    });
  });

  describe("connect / disconnect", () => {
    it("connects successfully", async () => {
      const observer = new EvmObserver(createConfig());
      await expect(observer.connect()).resolves.toBeUndefined();
    });

    it("disconnects cleanly", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();
      await expect(observer.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("returns connected with block number", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.chainId).toBe("eip155:1");
      expect(status.connected).toBe(true);
      expect(status.latestBlock).toBe(12345);
    });

    it("returns disconnected when not connected", async () => {
      const observer = new EvmObserver(createConfig());

      const status = await observer.getStatus();

      expect(status.connected).toBe(false);
    });
  });

  describe("getBalance", () => {
    it("returns native ETH balance", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getBalance({
        address: "0x1234567890abcdef1234567890abcdef12345678",
      });

      expect(result.chainId).toBe("eip155:1");
      expect(result.balance).toBe("1000000000000000000");
      expect(result.decimals).toBe(18);
      expect(result.symbol).toBe("ETH");
    });

    it("throws when not connected", async () => {
      const observer = new EvmObserver(createConfig());
      await expect(
        observer.getBalance({ address: "0xabc" })
      ).rejects.toThrow("not connected");
    });
  });

  describe("getTokenBalance", () => {
    it("returns ERC-20 token balance", async () => {
      mockReadContract
        .mockResolvedValueOnce(1000000n) // balanceOf
        .mockResolvedValueOnce("USDC") // symbol
        .mockResolvedValueOnce(6); // decimals

      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getTokenBalance({
        address: "0x1234567890abcdef1234567890abcdef12345678",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      });

      expect(result.symbol).toBe("USDC");
      expect(result.balance).toBe("1000000");
      expect(result.decimals).toBe(6);
    });
  });

  describe("getTransfers", () => {
    it("returns empty array when no transfers found", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: "0x1234567890abcdef1234567890abcdef12345678",
        fromBlock: 100,
        toBlock: 200,
      });

      expect(result).toEqual([]);
    });

    it("maps Transfer logs to TransferEvent with token metadata", async () => {
      mockGetLogs.mockResolvedValueOnce([
        {
          transactionHash: "0xdeadbeef",
          blockNumber: 150n,
          address: "0xtoken",
          args: {
            from: "0xsender",
            to: "0x1234567890abcdef1234567890abcdef12345678",
            value: 500000n,
          },
        },
      ]);

      // Mock token metadata queries (symbol + decimals)
      mockReadContract
        .mockResolvedValueOnce("USDC") // symbol
        .mockResolvedValueOnce(6); // decimals

      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: "0x1234567890abcdef1234567890abcdef12345678",
        direction: "incoming",
        token: "0xtoken",
        fromBlock: 100,
        toBlock: 200,
      });

      expect(result.length).toBe(1);
      expect(result[0]!.txHash).toBe("0xdeadbeef");
      expect(result[0]!.from).toBe("0xsender");
      expect(result[0]!.amount).toBe("500000");
      expect(result[0]!.symbol).toBe("USDC");
      expect(result[0]!.decimals).toBe(6);
    });

    // A-CO-002: dedup must not drop distinct transfers in the same tx.
    //
    // A single tx routinely emits multiple DISTINCT ERC-20 Transfer logs (swaps,
    // routers, multisend). When the watched address both receives and sends in
    // one tx, dedup-by-txHash silently drops the second distinct log. Dedup must
    // key on (transactionHash, logIndex), which uniquely identifies a log event.
    it("preserves two distinct Transfer logs in the same tx (token-filtered)", async () => {
      const watched = "0x1234567890abcdef1234567890abcdef12345678";
      // Incoming query (to: watched) — one log at logIndex 0.
      mockGetLogs.mockResolvedValueOnce([
        {
          transactionHash: "0xsametx",
          logIndex: 0,
          blockNumber: 150n,
          address: "0xtoken",
          args: { from: "0xother", to: watched, value: 100n },
        },
      ]);
      // Outgoing query (from: watched) — a DISTINCT log at logIndex 3, same tx.
      mockGetLogs.mockResolvedValueOnce([
        {
          transactionHash: "0xsametx",
          logIndex: 3,
          blockNumber: 150n,
          address: "0xtoken",
          args: { from: watched, to: "0xthird", value: 40n },
        },
      ]);

      mockReadContract
        .mockResolvedValueOnce("USDC") // symbol
        .mockResolvedValueOnce(6); // decimals

      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: watched,
        token: "0xtoken",
        fromBlock: 100,
        toBlock: 200,
      });

      // Both distinct transfers must survive — not just the incoming one.
      expect(result.length).toBe(2);
      const values = result.map((e) => e.amount).sort();
      expect(values).toEqual(["100", "40"]);
    });

    it("preserves two distinct Transfer logs in the same tx (filterless)", async () => {
      const watched = "0x1234567890abcdef1234567890abcdef12345678";
      mockGetLogs.mockResolvedValueOnce([
        {
          transactionHash: "0xsametx",
          logIndex: 0,
          blockNumber: 150n,
          address: "0xtoken",
          args: { from: "0xother", to: watched, value: 100n },
        },
      ]);
      mockGetLogs.mockResolvedValueOnce([
        {
          transactionHash: "0xsametx",
          logIndex: 3,
          blockNumber: 150n,
          address: "0xtoken",
          args: { from: watched, to: "0xthird", value: 40n },
        },
      ]);

      mockReadContract
        .mockResolvedValueOnce("USDC")
        .mockResolvedValueOnce(6);

      const observer = new EvmObserver(createConfig());
      await observer.connect();

      // No token → filterless path.
      const result = await observer.getTransfers({
        address: watched,
        fromBlock: 100,
        toBlock: 200,
      });

      expect(result.length).toBe(2);
      const values = result.map((e) => e.amount).sort();
      expect(values).toEqual(["100", "40"]);
    });

    it("removes true duplicates (same txHash AND logIndex) returned by both filters", async () => {
      const watched = "0x1234567890abcdef1234567890abcdef12345678";
      // A self-transfer (from === to === watched) is returned by BOTH the to- and
      // from-filtered queries as the SAME log (same txHash + logIndex) → dedup it.
      const selfLog = {
        transactionHash: "0xselftx",
        logIndex: 1,
        blockNumber: 150n,
        address: "0xtoken",
        args: { from: watched, to: watched, value: 7n },
      };
      mockGetLogs.mockResolvedValueOnce([selfLog]); // incoming
      mockGetLogs.mockResolvedValueOnce([selfLog]); // outgoing (same log)

      mockReadContract
        .mockResolvedValueOnce("USDC")
        .mockResolvedValueOnce(6);

      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: watched,
        token: "0xtoken",
        fromBlock: 100,
        toBlock: 200,
      });

      expect(result.length).toBe(1);
      expect(result[0]!.amount).toBe("7");
    });

    it("flags a guessed (UNKNOWN) fallback when token metadata query fails (PB-WCO-005)", async () => {
      mockGetLogs.mockResolvedValueOnce([
        {
          transactionHash: "0xdeadbeef",
          blockNumber: 150n,
          address: "0xbadtoken",
          args: {
            from: "0xsender",
            to: "0x1234567890abcdef1234567890abcdef12345678",
            value: 100n,
          },
        },
      ]);

      // Token metadata query fails
      mockReadContract.mockRejectedValue(new Error("Contract error"));

      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: "0x1234567890abcdef1234567890abcdef12345678",
        direction: "incoming",
        token: "0xbadtoken",
        fromBlock: 100,
        toBlock: 200,
      });

      expect(result.length).toBe(1);
      // PB-WCO-005: the guess is now explicit — non-confident symbol + a flag —
      // instead of a confident-looking "ERC20" that hides a fabricated decimals.
      expect(result[0]!.symbol).toBe("UNKNOWN");
      expect(result[0]!.decimals).toBe(18);
      expect(result[0]!.metaResolved).toBe(false);
    });
  });

  describe("getTransfers — block-range DoS guard (D3-A-006)", () => {
    it("rejects an over-large range for the all-tokens (filterless) path", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      // No `token` → filterless getLogs across ALL contracts. A huge span must
      // be rejected fail-closed rather than scanning the whole chain.
      await expect(
        observer.getTransfers({
          address: "0x1234567890abcdef1234567890abcdef12345678",
          fromBlock: 0,
          toBlock: 5_000_000,
        }),
      ).rejects.toThrow(/range|span|block/i);

      // The over-large query must NOT have hit the RPC.
      expect(mockGetLogs).not.toHaveBeenCalled();
    });

    it("throws a structured ObserverError with a code and hint", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      try {
        await observer.getTransfers({
          address: "0x1234567890abcdef1234567890abcdef12345678",
          fromBlock: 0,
          toBlock: 5_000_000,
        });
        expect.fail("expected getTransfers to throw");
      } catch (err) {
        expect(err).toHaveProperty("code");
        expect((err as { code: string }).code).toBe("BLOCK_RANGE_TOO_LARGE");
        expect((err as { hint?: string }).hint).toBeTruthy();
      }
    });

    it("allows a bounded all-tokens range", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: "0x1234567890abcdef1234567890abcdef12345678",
        fromBlock: 100,
        toBlock: 200,
      });

      expect(result).toEqual([]);
      expect(mockGetLogs).toHaveBeenCalled();
    });

    it("rejects an over-large range even with a token filter (hard ceiling)", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      await expect(
        observer.getTransfers({
          address: "0x1234567890abcdef1234567890abcdef12345678",
          token: "0xtoken",
          fromBlock: 0,
          toBlock: 100_000_000,
        }),
      ).rejects.toThrow(/range|span|block/i);
    });
  });

  describe("dynamic native token metadata", () => {
    it("returns POL symbol for Polygon", async () => {
      const observer = new EvmObserver(createConfig(CHAINS.POLYGON));
      await observer.connect();

      const result = await observer.getBalance({
        address: "0x1234567890abcdef1234567890abcdef12345678",
      });

      expect(result.symbol).toBe("POL");
      expect(result.decimals).toBe(18);
    });

    it("returns ETH for Arbitrum", async () => {
      const observer = new EvmObserver(createConfig(CHAINS.ARBITRUM_ONE));
      await observer.connect();

      const result = await observer.getBalance({
        address: "0x1234567890abcdef1234567890abcdef12345678",
      });

      expect(result.symbol).toBe("ETH");
      expect(result.decimals).toBe(18);
    });

    it("uses profile nativeToken when provided", async () => {
      const customProfile = {
        ...POLYGON_PROFILE,
        nativeToken: { symbol: "MATIC", decimals: 18 },
      };
      const observer = new EvmObserver(
        createConfig(CHAINS.POLYGON, customProfile),
      );
      await observer.connect();

      const result = await observer.getBalance({
        address: "0x1234567890abcdef1234567890abcdef12345678",
      });

      expect(result.symbol).toBe("MATIC");
    });
  });

  describe("backward compatibility", () => {
    it("works without profile (no profile = same behavior)", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const result = await observer.getBalance({
        address: "0x1234567890abcdef1234567890abcdef12345678",
      });

      expect(result.symbol).toBe("ETH");
      expect(result.decimals).toBe(18);
    });

    it("getStatus without profile does not return finalized/safe blocks", async () => {
      const observer = new EvmObserver(createConfig());
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.connected).toBe(true);
      expect(status.latestBlock).toBe(12345);
      expect(status.finalizedBlock).toBeUndefined();
      expect(status.safeBlock).toBeUndefined();
      expect(mockGetBlock).not.toHaveBeenCalled();
    });
  });

  describe("getStatus with profile", () => {
    it("returns finalized and safe blocks when profile has finality config", async () => {
      mockGetBlock
        .mockResolvedValueOnce({ number: 12281n }) // finalized
        .mockResolvedValueOnce({ number: 12333n }); // safe

      const observer = new EvmObserver(
        createConfig(CHAINS.ETHEREUM_MAINNET, ETHEREUM_PROFILE),
      );
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.connected).toBe(true);
      expect(status.latestBlock).toBe(12345);
      expect(status.finalizedBlock).toBe(12281);
      expect(status.safeBlock).toBe(12333);
    });

    it("omits safe block when profile has no safeBlockTag", async () => {
      mockGetBlock.mockResolvedValueOnce({ number: 12281n }); // finalized only

      const profileNoSafe = {
        ...ARBITRUM_PROFILE,
        finality: {
          ...ARBITRUM_PROFILE.finality,
          safeBlockTag: undefined,
          finalizedBlockTag: "finalized",
        },
      };
      const observer = new EvmObserver(
        createConfig(CHAINS.ARBITRUM_ONE, profileNoSafe),
      );
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.connected).toBe(true);
      expect(status.finalizedBlock).toBe(12281);
      expect(status.safeBlock).toBeUndefined();
    });
  });
});
