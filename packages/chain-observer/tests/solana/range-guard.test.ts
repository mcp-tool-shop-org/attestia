/**
 * SolanaObserver fails closed on integers above 2^53 - 1.
 *
 * @solana/web3.js 3.x returns slots, balances, block times and parsed-instruction
 * numbers as bigint. The observer's public shapes carry slots and decimals as
 * numbers, and a number above Number.MAX_SAFE_INTEGER silently loses precision.
 * Such a value must raise an ObserverError with code RPC_ERROR rather than be
 * rounded into an output.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SolanaObserver } from "../../src/solana/solana-observer.js";
import { ObserverError } from "../../src/errors.js";
import { CHAINS } from "../../src/chains.js";
import { SOLANA_MAINNET_PROFILE } from "../../src/profiles.js";

const TOO_BIG = BigInt(Number.MAX_SAFE_INTEGER) + 1n; // 2^53
const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT = "So11111111111111111111111111111111111111112";

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

async function connected(): Promise<SolanaObserver> {
  const observer = new SolanaObserver({
    chain: CHAINS.SOLANA_MAINNET,
    rpcUrl: "https://mock-solana-rpc.example.com",
    timeoutMs: 5000,
    profile: SOLANA_MAINNET_PROFILE,
  });
  await observer.connect();
  return observer;
}

function parsedTransferTx(slot: bigint, decimals: bigint | number) {
  return {
    slot,
    blockTime: 1_700_000_000n,
    transaction: {
      message: {
        instructions: [
          {
            program: "spl-token",
            parsed: {
              type: "transferChecked",
              info: {
                authority: OWNER,
                destination: MINT,
                mint: MINT,
                tokenAmount: { amount: "42", decimals },
              },
            },
          },
        ],
      },
    },
  };
}

async function expectRpcError(call: Promise<unknown>): Promise<ObserverError> {
  const err = await call.then(
    () => {
      throw new Error("expected the call to reject");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ObserverError);
  expect((err as ObserverError).code).toBe("RPC_ERROR");
  expect((err as ObserverError).chainId).toBe(CHAINS.SOLANA_MAINNET.chainId);
  expect((err as ObserverError).hint.length).toBeGreaterThan(0);
  return err as ObserverError;
}

describe("SolanaObserver range guard (2^53 - 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSlot.mockResolvedValue(250_000_000n);
    mockGetBalance.mockResolvedValue(5_000_000_000n);
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });
    mockGetSignaturesForAddress.mockResolvedValue([]);
    mockGetParsedTransactions.mockResolvedValue([]);
  });

  it("accepts the largest safe integer exactly", async () => {
    mockGetSlot.mockResolvedValue(BigInt(Number.MAX_SAFE_INTEGER));
    const observer = await connected();
    const result = await observer.getBalance({ address: OWNER });
    expect(result.atBlock).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("getBalance rejects an out-of-range slot with RPC_ERROR", async () => {
    mockGetSlot.mockResolvedValue(TOO_BIG);
    const observer = await connected();
    const err = await expectRpcError(observer.getBalance({ address: OWNER }));
    expect(err.message).toContain(String(TOO_BIG));
  });

  it("getStatus reports disconnected with RPC_ERROR instead of a rounded slot", async () => {
    mockGetSlot.mockResolvedValue(TOO_BIG);
    const observer = await connected();
    const status = await observer.getStatus();
    expect(status.connected).toBe(false);
    expect(status.errorCode).toBe("RPC_ERROR");
    expect(status.latestBlock).toBeUndefined();
  });

  it("getStatus rejects an out-of-range finalized slot as an error, not a rounded value", async () => {
    mockGetSlot.mockResolvedValueOnce(250_000_000n).mockResolvedValueOnce(TOO_BIG);
    const observer = await connected();
    const status = await observer.getStatus();
    expect(status.connected).toBe(true);
    expect(status.errorCode).toBe("RPC_ERROR");
    expect(status.finalizedBlock).toBeUndefined();
  });

  it("getTokenBalance rejects out-of-range decimals with RPC_ERROR", async () => {
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [
        {
          account: {
            data: {
              parsed: { info: { tokenAmount: { amount: "1", decimals: TOO_BIG, uiAmountString: "1" } } },
            },
          },
        },
      ],
    });
    const observer = await connected();
    await expectRpcError(observer.getTokenBalance({ address: OWNER, token: MINT }));
  });

  it("getTransfers rejects an out-of-range transaction slot with RPC_ERROR", async () => {
    mockGetSignaturesForAddress.mockResolvedValue([{ signature: "sig1", slot: TOO_BIG }]);
    mockGetParsedTransactions.mockResolvedValue([parsedTransferTx(TOO_BIG, 6n)]);
    const observer = await connected();
    await expectRpcError(observer.getTransfers({ address: OWNER }));
  });

  it("getTransfers rejects out-of-range instruction decimals with RPC_ERROR", async () => {
    mockGetSignaturesForAddress.mockResolvedValue([{ signature: "sig1", slot: 250_000_000n }]);
    mockGetParsedTransactions.mockResolvedValue([parsedTransferTx(250_000_000n, TOO_BIG)]);
    const observer = await connected();
    await expectRpcError(observer.getTransfers({ address: OWNER }));
  });
});
