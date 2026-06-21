/**
 * Tests for Solana RPC resilience behavior.
 *
 * Verifies that the SolanaObserver fails closed on errors,
 * does not emit partial events, and handles edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SolanaObserver } from "../../src/solana/solana-observer.js";
import { CHAINS } from "../../src/chains.js";
import type { ObserverConfig } from "../../src/observer.js";

// =============================================================================
// Mocks
// =============================================================================

const mockGetSlot = vi.fn();
const mockGetBalance = vi.fn();
const mockGetParsedTokenAccountsByOwner = vi.fn();
const mockGetSignaturesForAddress = vi.fn();
const mockGetParsedTransactions = vi.fn();

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

function createConfig(): ObserverConfig {
  return {
    chain: CHAINS.SOLANA_MAINNET,
    rpcUrl: "https://mock-solana-rpc.example.com",
    timeoutMs: 5000,
    // Keep retry backoff tiny so transient-error tests stay fast and
    // deterministic (the shared retry helper now governs Solana too).
    retry: { maxRetries: 3, delayMs: 1 },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("SolanaObserver RPC resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fail-closed behavior", () => {
    it("getBalance throws when not connected", async () => {
      const observer = new SolanaObserver(createConfig());

      await expect(
        observer.getBalance({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("not connected");
    });

    it("getTokenBalance throws when not connected", async () => {
      const observer = new SolanaObserver(createConfig());

      await expect(
        observer.getTokenBalance({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        }),
      ).rejects.toThrow("not connected");
    });

    it("getTransfers throws when not connected", async () => {
      const observer = new SolanaObserver(createConfig());

      await expect(
        observer.getTransfers({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("not connected");
    });

    it("all queries fail after disconnect", async () => {
      mockGetSlot.mockResolvedValue(100);
      mockGetBalance.mockResolvedValue(0);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();
      await observer.disconnect();

      await expect(
        observer.getBalance({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("not connected");
    });
  });

  describe("RPC error handling", () => {
    it("getBalance propagates RPC errors", async () => {
      mockGetBalance.mockRejectedValue(new Error("RPC timeout"));
      mockGetSlot.mockResolvedValue(100);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      await expect(
        observer.getBalance({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("RPC timeout");
    });

    it("getTransfers propagates non-retryable errors immediately", async () => {
      mockGetSignaturesForAddress.mockRejectedValue(
        new Error("Invalid public key"),
      );

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      await expect(
        observer.getTransfers({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("Invalid public key");
    });

    it("getTransfers retries transient 429 errors then exhausts", async () => {
      mockGetSignaturesForAddress.mockRejectedValue(
        new Error("429 Too Many Requests"),
      );

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      // With retry, it will exhaust retries and then throw
      await expect(
        observer.getTransfers({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("429 Too Many Requests");

      // Should have been called multiple times (initial + retries)
      expect(mockGetSignaturesForAddress.mock.calls.length).toBeGreaterThan(1);
    }, 30_000);

    it("getTransfers does not emit partial events on transaction fetch failure", async () => {
      mockGetSignaturesForAddress.mockResolvedValue([
        { signature: "sig1", slot: 100 },
        { signature: "sig2", slot: 101 },
      ]);
      mockGetParsedTransactions.mockRejectedValue(
        new Error("Transaction fetch failed"),
      );

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      // Non-retryable error propagates immediately, not partial results
      await expect(
        observer.getTransfers({
          address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        }),
      ).rejects.toThrow("Transaction fetch failed");
    });

    it("getStatus returns disconnected on permanent error", async () => {
      mockGetSlot.mockRejectedValue(new Error("Invalid endpoint"));

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const status = await observer.getStatus();
      expect(status.connected).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles null transactions in batch gracefully", async () => {
      const addr = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      mockGetSignaturesForAddress.mockResolvedValue([
        { signature: "sig1", slot: 100 },
        { signature: "sig2", slot: 101 },
      ]);
      // First tx is null (skipped/dropped), second has data
      mockGetParsedTransactions.mockResolvedValue([
        null,
        {
          slot: 101,
          blockTime: 1700000001,
          transaction: {
            message: {
              instructions: [{
                program: "system",
                parsed: {
                  type: "transfer",
                  info: {
                    source: "sender",
                    destination: addr,
                    lamports: 1000,
                  },
                },
              }],
            },
          },
          meta: {},
        },
      ]);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({ address: addr });

      // Should only include the non-null transaction
      expect(result.length).toBe(1);
      expect(result[0]!.amount).toBe("1000");
    });

    it("handles transactions with no matching instructions", async () => {
      const addr = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      mockGetSignaturesForAddress.mockResolvedValue([
        { signature: "sig1", slot: 100 },
      ]);
      mockGetParsedTransactions.mockResolvedValue([
        {
          slot: 100,
          blockTime: 1700000000,
          transaction: {
            message: {
              instructions: [{
                // Non-parsed instruction (compiled)
                programId: "some-program",
                data: "base58data",
                accounts: [],
              }],
            },
          },
          meta: {},
        },
      ]);

      const observer = new SolanaObserver(createConfig());
      await observer.connect();

      const result = await observer.getTransfers({ address: addr });

      expect(result.length).toBe(0);
    });
  });
});
