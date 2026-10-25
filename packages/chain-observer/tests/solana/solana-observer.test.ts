/**
 * Tests for SolanaObserver.
 *
 * Uses vitest mocking to mock @solana/web3.js Connection.
 * No actual RPC calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SolanaObserver } from "../../src/solana/solana-observer.js";
import { CHAINS } from "../../src/chains.js";
import { SOLANA_MAINNET_PROFILE } from "../../src/profiles.js";
import type { ObserverConfig } from "../../src/observer.js";

// =============================================================================
// Mocks
// =============================================================================

const mockGetSlot = vi.fn().mockResolvedValue(250_000_000n);
const mockGetBalance = vi.fn().mockResolvedValue(5_000_000_000n); // 5 SOL
const mockGetParsedTokenAccountsByOwner = vi.fn().mockResolvedValue({ value: [] });
const mockGetSignaturesForAddress = vi.fn().mockResolvedValue([]);
const mockGetParsedTransactions = vi.fn().mockResolvedValue([]);

vi.mock("@solana/web3.js", async () => {
  const actual = await vi.importActual("@solana/web3.js");
  return {
    ...actual,
    Connection: vi.fn(() => ({
      getSlot: mockGetSlot,
      getBalance: mockGetBalance,
      getParsedTokenAccountsByOwner: mockGetParsedTokenAccountsByOwner,
      getSignaturesForAddress: mockGetSignaturesForAddress,
      getParsedTransactions: mockGetParsedTransactions,
    })),
  };
});

function createConfig(
  chain = CHAINS.SOLANA_MAINNET,
  profile?: ObserverConfig["profile"],
): ObserverConfig {
  return {
    chain,
    rpcUrl: "https://mock-solana-rpc.example.com",
    timeoutMs: 5000,
    ...(profile && { profile }),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("SolanaObserver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSlot.mockResolvedValue(250_000_000n);
    mockGetBalance.mockResolvedValue(5_000_000_000n);
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });
    mockGetSignaturesForAddress.mockResolvedValue([]);
    mockGetParsedTransactions.mockResolvedValue([]);
  });

  describe("constructor", () => {
    it("creates observer for Solana chain", () => {
      const observer = new SolanaObserver(createConfig());
      expect(observer.chainId).toBe("solana:mainnet-beta");
    });

    it("creates observer for Solana devnet", () => {
      const observer = new SolanaObserver(createConfig(CHAINS.SOLANA_DEVNET));
      expect(observer.chainId).toBe("solana:devnet");
    });

    it("rejects non-Solana chain IDs", () => {
      expect(
        () => new SolanaObserver(createConfig(CHAINS.ETHEREUM_MAINNET)),
      ).toThrow("expected Solana chain ID");
    });

    it("rejects XRPL chain IDs", () => {
      expect(
        () => new SolanaObserver(createConfig(CHAINS.XRPL_MAINNET)),
      ).toThrow("expected Solana chain ID");
    });
  });

  describe("connect / disconnect", () => {
    it("connects successfully", async () => {
      const observer = new SolanaObserver(createConfig());
      await expect(observer.connect()).resolves.toBeUndefined();
    });

    it("disconnects cleanly", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();
      await expect(observer.disconnect()).resolves.toBeUndefined();
    });

    it("disconnect is idempotent", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();
      await observer.disconnect();
      await expect(observer.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("returns connected with slot number", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.chainId).toBe("solana:mainnet-beta");
      expect(status.connected).toBe(true);
      expect(status.latestBlock).toBe(250_000_000);
    });

    it("returns disconnected when not connected", async () => {
      const observer = new SolanaObserver(createConfig());

      const status = await observer.getStatus();

      expect(status.connected).toBe(false);
      expect(status.latestBlock).toBeUndefined();
    });

    it("returns disconnected when slot query fails", async () => {
      mockGetSlot.mockRejectedValueOnce(new Error("RPC error"));

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.connected).toBe(false);
    });

    it("fail-closed after disconnect", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();
      await observer.disconnect();

      const status = await observer.getStatus();
      expect(status.connected).toBe(false);
    });

    it("includes finalized slot when profile has finality config", async () => {
      mockGetSlot
        .mockResolvedValueOnce(250_000_000n)  // confirmed (main query)
        .mockResolvedValueOnce(249_999_900n); // finalized

      const observer = new SolanaObserver(
        createConfig(CHAINS.SOLANA_MAINNET, SOLANA_MAINNET_PROFILE),
      );
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.latestBlock).toBe(250_000_000);
      expect(status.finalizedBlock).toBe(249_999_900);
    });
  });

  describe("getBalance", () => {
    it("returns native SOL balance in lamports", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getBalance({
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      });

      expect(result.chainId).toBe("solana:mainnet-beta");
      expect(result.balance).toBe("5000000000"); // 5 SOL in lamports
      expect(result.decimals).toBe(9);
      expect(result.symbol).toBe("SOL");
      expect(result.atBlock).toBe(250_000_000);
    });

    it("throws when not connected", async () => {
      const observer = new SolanaObserver(createConfig());
      await expect(
        observer.getBalance({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("not connected");
    });

    it("uses query-level finality override", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      await observer.getBalance({
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        finality: "finalized",
      });

      // Verify getBalance was called with "finalized" commitment
      expect(mockGetBalance).toHaveBeenCalledWith(
        expect.anything(),
        "finalized",
      );
    });

    it("respects profile commitment level", async () => {
      const observer = new SolanaObserver(
        createConfig(CHAINS.SOLANA_MAINNET, SOLANA_MAINNET_PROFILE),
      );
      await observer.connect();

      await observer.getBalance({
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      });

      // Profile has "confirmed" commitment
      expect(mockGetBalance).toHaveBeenCalledWith(
        expect.anything(),
        "confirmed",
      );
    });
  });

  describe("getTokenBalance", () => {
    it("returns zero for missing token account", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTokenBalance({
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      });

      expect(result.balance).toBe("0");
      expect(result.decimals).toBe(0);
    });

    it("returns SPL token balance", async () => {
      mockGetParsedTokenAccountsByOwner.mockResolvedValueOnce({
        value: [
          {
            pubkey: { toBase58: () => "ata-address" },
            account: {
              data: {
                parsed: {
                  info: {
                    tokenAmount: {
                      amount: "1000000",
                      decimals: 6,
                      uiAmountString: "1.0",
                    },
                  },
                },
              },
            },
          },
        ],
      });

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTokenBalance({
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      });

      expect(result.balance).toBe("1000000");
      expect(result.decimals).toBe(6);
      expect(result.token).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    });
  });

  describe("getTransfers", () => {
    it("returns empty array when no signatures found", async () => {
      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      });

      expect(result).toEqual([]);
    });

    it("extracts native SOL transfers", async () => {
      const addr = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      mockGetSignaturesForAddress.mockResolvedValueOnce([
        { signature: "sig1", slot: 250_000_000n },
      ]);
      mockGetParsedTransactions.mockResolvedValueOnce([
        {
          slot: 250_000_000n,
          blockTime: 1700000000n,
          transaction: {
            message: {
              instructions: [
                {
                  program: "system",
                  parsed: {
                    type: "transfer",
                    info: {
                      source: "SenderPubkey11111111111111111111111111111111",
                      destination: addr,
                      lamports: 1_000_000_000,
                    },
                  },
                },
              ],
            },
          },
          meta: {},
        },
      ]);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: addr,
        direction: "incoming",
      });

      expect(result.length).toBe(1);
      expect(result[0]!.txHash).toBe("sig1");
      expect(result[0]!.amount).toBe("1000000000");
      expect(result[0]!.symbol).toBe("SOL");
      expect(result[0]!.decimals).toBe(9);
      expect(result[0]!.blockNumber).toBe(250_000_000);
    });

    it("extracts SPL token transfers", async () => {
      const addr = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      mockGetSignaturesForAddress.mockResolvedValueOnce([
        { signature: "sig2", slot: 250_000_001n },
      ]);
      mockGetParsedTransactions.mockResolvedValueOnce([
        {
          slot: 250_000_001n,
          blockTime: 1700000001n,
          transaction: {
            message: {
              instructions: [
                {
                  program: "spl-token",
                  parsed: {
                    type: "transferChecked",
                    info: {
                      authority: "SenderPubkey11111111111111111111111111111111",
                      destination: addr,
                      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                      tokenAmount: {
                        amount: "1000000",
                        decimals: 6,
                      },
                    },
                  },
                },
              ],
            },
          },
          meta: {},
        },
      ]);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: addr,
        direction: "incoming",
      });

      expect(result.length).toBe(1);
      expect(result[0]!.amount).toBe("1000000");
      expect(result[0]!.decimals).toBe(6);
      expect(result[0]!.token).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    });

    it("filters by direction", async () => {
      const addr = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      mockGetSignaturesForAddress.mockResolvedValueOnce([
        { signature: "sig3", slot: 250_000_002n },
      ]);
      mockGetParsedTransactions.mockResolvedValueOnce([
        {
          slot: 250_000_002n,
          blockTime: 1700000002n,
          transaction: {
            message: {
              instructions: [
                {
                  program: "system",
                  parsed: {
                    type: "transfer",
                    info: {
                      source: addr,
                      destination: "ReceiverPubkey1111111111111111111111111111",
                      lamports: 500_000_000,
                    },
                  },
                },
              ],
            },
          },
          meta: {},
        },
      ]);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      // Should not appear when filtering for incoming
      const incoming = await observer.getTransfers({
        address: addr,
        direction: "incoming",
      });
      expect(incoming.length).toBe(0);

      // Reset mocks for outgoing query
      mockGetSignaturesForAddress.mockResolvedValueOnce([
        { signature: "sig3", slot: 250_000_002n },
      ]);
      mockGetParsedTransactions.mockResolvedValueOnce([
        {
          slot: 250_000_002n,
          blockTime: 1700000002n,
          transaction: {
            message: {
              instructions: [
                {
                  program: "system",
                  parsed: {
                    type: "transfer",
                    info: {
                      source: addr,
                      destination: "ReceiverPubkey1111111111111111111111111111",
                      lamports: 500_000_000,
                    },
                  },
                },
              ],
            },
          },
          meta: {},
        },
      ]);

      const outgoing = await observer.getTransfers({
        address: addr,
        direction: "outgoing",
      });
      expect(outgoing.length).toBe(1);
      expect(outgoing[0]!.from).toBe(addr);
    });

    it("applies limit", async () => {
      const addr = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      mockGetSignaturesForAddress.mockResolvedValueOnce([
        { signature: "sig-a", slot: 100n },
        { signature: "sig-b", slot: 101n },
        { signature: "sig-c", slot: 102n },
      ]);
      mockGetParsedTransactions.mockResolvedValueOnce([
        {
          slot: 100n,
          blockTime: 1700000000n,
          transaction: {
            message: {
              instructions: [{
                program: "system",
                parsed: { type: "transfer", info: { source: "x", destination: addr, lamports: 1 } },
              }],
            },
          },
          meta: {},
        },
        {
          slot: 101n,
          blockTime: 1700000001n,
          transaction: {
            message: {
              instructions: [{
                program: "system",
                parsed: { type: "transfer", info: { source: "y", destination: addr, lamports: 2 } },
              }],
            },
          },
          meta: {},
        },
        {
          slot: 102n,
          blockTime: 1700000002n,
          transaction: {
            message: {
              instructions: [{
                program: "system",
                parsed: { type: "transfer", info: { source: "z", destination: addr, lamports: 3 } },
              }],
            },
          },
          meta: {},
        },
      ]);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({
        address: addr,
        limit: 2,
      });

      expect(result.length).toBe(2);
    });

    it("sorts by slot ascending", async () => {
      const addr = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      mockGetSignaturesForAddress.mockResolvedValueOnce([
        { signature: "sig-later", slot: 200n },
        { signature: "sig-earlier", slot: 100n },
      ]);
      mockGetParsedTransactions.mockResolvedValueOnce([
        {
          slot: 200n,
          blockTime: 1700000200n,
          transaction: {
            message: {
              instructions: [{
                program: "system",
                parsed: { type: "transfer", info: { source: "a", destination: addr, lamports: 1 } },
              }],
            },
          },
          meta: {},
        },
        {
          slot: 100n,
          blockTime: 1700000100n,
          transaction: {
            message: {
              instructions: [{
                program: "system",
                parsed: { type: "transfer", info: { source: "b", destination: addr, lamports: 2 } },
              }],
            },
          },
          meta: {},
        },
      ]);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({ address: addr });

      expect(result[0]!.blockNumber).toBe(100);
      expect(result[1]!.blockNumber).toBe(200);
    });
  });
});
