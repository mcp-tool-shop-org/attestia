/**
 * Solana Deterministic Replay Validation
 *
 * Verifies that parsing the same Solana transaction data twice
 * produces byte-identical TransferEvent arrays.
 *
 * This is critical for Attestia's integrity model:
 * replaying the same chain data must always produce
 * the same domain events and hash chains.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SolanaObserver } from "../../src/solana/solana-observer.js";
import { CHAINS } from "../../src/chains.js";
import { parseProgramLogs } from "../../src/solana/log-parser.js";
import type { ObserverConfig } from "../../src/observer.js";

// =============================================================================
// Mocks
// =============================================================================

const mockGetSlot = vi.fn().mockResolvedValue(250_000_000n);
const mockGetBalance = vi.fn().mockResolvedValue(0n);
const mockGetParsedTokenAccountsByOwner = vi.fn().mockResolvedValue({ value: [] });
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
  };
}

// =============================================================================
// Fixtures
// =============================================================================

const FIXTURE_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/**
 * Fixture: A mix of native SOL and SPL token transfers
 * at different slots, simulating real-world transaction data.
 */
const FIXTURE_SIGNATURES = [
  { signature: "sig-sol-1", slot: 250_000_100n },
  { signature: "sig-spl-1", slot: 250_000_050n },
  { signature: "sig-sol-2", slot: 250_000_200n },
];

const FIXTURE_TRANSACTIONS = [
  {
    slot: 250_000_100n,
    blockTime: 1700001000n,
    transaction: {
      message: {
        instructions: [{
          program: "system",
          parsed: {
            type: "transfer",
            info: {
              source: "SenderA",
              destination: FIXTURE_ADDRESS,
              lamports: 2_500_000_000,
            },
          },
        }],
      },
    },
    meta: {},
  },
  {
    slot: 250_000_050n,
    blockTime: 1700000500n,
    transaction: {
      message: {
        instructions: [{
          program: "spl-token",
          parsed: {
            type: "transferChecked",
            info: {
              authority: "SenderB",
              destination: FIXTURE_ADDRESS,
              mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              tokenAmount: { amount: "5000000", decimals: 6 },
            },
          },
        }],
      },
    },
    meta: {},
  },
  {
    slot: 250_000_200n,
    blockTime: 1700002000n,
    transaction: {
      message: {
        instructions: [{
          program: "system",
          parsed: {
            type: "transfer",
            info: {
              source: "SenderC",
              destination: FIXTURE_ADDRESS,
              lamports: 100_000_000,
            },
          },
        }],
      },
    },
    meta: {},
  },
];

// =============================================================================
// Tests
// =============================================================================

describe("Solana replay determinism", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produces identical TransferEvent[] on two independent parses", async () => {
    // Run 1
    mockGetSignaturesForAddress.mockResolvedValueOnce([...FIXTURE_SIGNATURES]);
    mockGetParsedTransactions.mockResolvedValueOnce([...FIXTURE_TRANSACTIONS]);

    const observer1 = new SolanaObserver(createConfig());
    await observer1.connect();
    const result1 = await observer1.getTransfers({ address: FIXTURE_ADDRESS });

    // Run 2 — fresh observer, same fixture data
    mockGetSignaturesForAddress.mockResolvedValueOnce([...FIXTURE_SIGNATURES]);
    mockGetParsedTransactions.mockResolvedValueOnce([...FIXTURE_TRANSACTIONS]);

    const observer2 = new SolanaObserver(createConfig());
    await observer2.connect();
    const result2 = await observer2.getTransfers({ address: FIXTURE_ADDRESS });

    // Must have same number of events
    expect(result1.length).toBe(result2.length);
    expect(result1.length).toBe(3);

    // Structural comparison (excluding observedAt timestamps which vary)
    for (let i = 0; i < result1.length; i++) {
      const e1 = result1[i]!;
      const e2 = result2[i]!;

      expect(e1.chainId).toBe(e2.chainId);
      expect(e1.txHash).toBe(e2.txHash);
      expect(e1.blockNumber).toBe(e2.blockNumber);
      expect(e1.from).toBe(e2.from);
      expect(e1.to).toBe(e2.to);
      expect(e1.amount).toBe(e2.amount);
      expect(e1.decimals).toBe(e2.decimals);
      expect(e1.symbol).toBe(e2.symbol);
      expect(e1.token).toBe(e2.token);
      expect(e1.timestamp).toBe(e2.timestamp);
    }
  });

  it("sorts by slot ascending regardless of input order", async () => {
    // Input order: slot 100, 50, 200
    mockGetSignaturesForAddress.mockResolvedValueOnce([...FIXTURE_SIGNATURES]);
    mockGetParsedTransactions.mockResolvedValueOnce([...FIXTURE_TRANSACTIONS]);

    const observer = new SolanaObserver(createConfig());
    await observer.connect();
    const result = await observer.getTransfers({ address: FIXTURE_ADDRESS });

    expect(result[0]!.blockNumber).toBe(250_000_050); // SPL transfer (earliest slot)
    expect(result[1]!.blockNumber).toBe(250_000_100); // SOL transfer
    expect(result[2]!.blockNumber).toBe(250_000_200); // SOL transfer (latest slot)
  });

  it("preserves transfer type information deterministically", async () => {
    mockGetSignaturesForAddress.mockResolvedValueOnce([...FIXTURE_SIGNATURES]);
    mockGetParsedTransactions.mockResolvedValueOnce([...FIXTURE_TRANSACTIONS]);

    const observer = new SolanaObserver(createConfig());
    await observer.connect();
    const result = await observer.getTransfers({ address: FIXTURE_ADDRESS });

    // First event (slot 050): SPL transfer
    expect(result[0]!.symbol).toBe("SPL:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // Full mint with SPL: prefix
    expect(result[0]!.decimals).toBe(6);
    expect(result[0]!.token).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    // Second event (slot 100): Native SOL
    expect(result[1]!.symbol).toBe("SOL");
    expect(result[1]!.decimals).toBe(9);
    expect(result[1]!.token).toBeUndefined();

    // Third event (slot 200): Native SOL
    expect(result[2]!.symbol).toBe("SOL");
    expect(result[2]!.amount).toBe("100000000");
  });
});

describe("Log parser replay determinism", () => {
  it("produces identical output on repeated parsing", () => {
    const logs = [
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]",
      "Program log: Instruction: Transfer",
      "Program data: dGVzdERhdGE=",
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ];

    const run1 = JSON.stringify(parseProgramLogs(logs));
    const run2 = JSON.stringify(parseProgramLogs(logs));
    const run3 = JSON.stringify(parseProgramLogs(logs));

    expect(run1).toBe(run2);
    expect(run2).toBe(run3);
  });

  it("produces identical output regardless of log array construction", () => {
    const logsA = ["Program X invoke [1]", "Program X success"];
    const logsB = ["Program X invoke [1]"].concat(["Program X success"]);

    expect(JSON.stringify(parseProgramLogs(logsA))).toBe(
      JSON.stringify(parseProgramLogs(logsB)),
    );
  });
});
