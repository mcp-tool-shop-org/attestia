/**
 * @solana/web3.js is NOT mocked here. A local JSON-RPC server answers the real
 * Connection, so these tests see exactly the value types the library hands back
 * (v3 returns bigint for slots, balances, block times and numbers inside
 * jsonParsed instructions). Every result must be plain JSON: no bigint anywhere,
 * JSON.stringify must not throw, and the shapes and values must be the ones the
 * observer has always produced.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SolanaObserver } from "../../src/solana/solana-observer.js";
import { CHAINS } from "../../src/chains.js";

const OWNER = "11111111111111111111111111111112";
const MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const parsedTx = {
  slot: 250_000_000,
  blockTime: 1_700_000_000,
  version: "legacy",
  meta: { err: null, fee: 5000, preBalances: [], postBalances: [], innerInstructions: [], logMessages: [] },
  transaction: {
    signatures: ["sig1"],
    message: {
      accountKeys: [],
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        {
          program: "system",
          programId: "11111111111111111111111111111111",
          parsed: { type: "transfer", info: { source: OWNER, destination: MINT, lamports: 1_500_000 } },
        },
        {
          program: "spl-token",
          programId: TOKEN_PROGRAM,
          parsed: {
            type: "transferChecked",
            info: {
              authority: OWNER,
              source: OWNER,
              destination: MINT,
              mint: MINT,
              tokenAmount: { amount: "42", decimals: 6, uiAmountString: "0.000042" },
            },
          },
        },
      ],
    },
  },
};

// Canned results keyed by method name. Data, not functions, so no request-controlled value is ever called.
const results = new Map<string, unknown>(Object.entries({
  getSlot: 250_000_000,
  getBalance: ({ context: { slot: 250_000_000 }, value: 5_000_000_000 }),
  getTokenAccountsByOwner: ({
    context: { slot: 250_000_000 },
    value: [
      {
        pubkey: OWNER,
        account: {
          lamports: 2_039_280,
          owner: TOKEN_PROGRAM,
          executable: false,
          rentEpoch: 0,
          space: 165,
          data: {
            program: "spl-token",
            space: 165,
            parsed: {
              type: "account",
              info: {
                isNative: false,
                mint: MINT,
                owner: OWNER,
                state: "initialized",
                tokenAmount: {
                  amount: "123456789012345678",
                  decimals: 9,
                  uiAmount: 123456789.012,
                  uiAmountString: "123456789.012345678",
                },
              },
            },
          },
        },
      },
    ],
  }),
  getSignaturesForAddress: [
    { signature: "sig1", slot: 250_000_000, err: null, memo: null, blockTime: 1_700_000_000, confirmationStatus: "finalized" },
  ],
  getTransaction: parsedTx,
}));

function containsBigint(value: unknown): boolean {
  if (typeof value === "bigint") return true;
  if (Array.isArray(value)) return value.some(containsBigint);
  if (value !== null && typeof value === "object") return Object.values(value).some(containsBigint);
  return false;
}

describe("SolanaObserver against a real JSON-RPC wire (web3.js not mocked)", () => {
  let server: Server;
  let observer: SolanaObserver;
  const chainId = CHAINS.SOLANA_MAINNET.chainId;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString("utf8")));
      req.on("end", () => {
        const answer = (r: { id: unknown; method: string }) => {
          return results.has(r.method)
            ? { jsonrpc: "2.0", id: r.id, result: results.get(r.method) }
            : { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: `no ${r.method}` } };
        };
        const parsed = JSON.parse(body) as { id: unknown; method: string } | { id: unknown; method: string }[];
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    observer = new SolanaObserver({ chain: CHAINS.SOLANA_MAINNET, rpcUrl: `http://127.0.0.1:${port}`, timeoutMs: 5000 });
    await observer.connect();
  });

  afterAll(async () => {
    await observer.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("getStatus returns a numeric slot and serializes", async () => {
    const status = await observer.getStatus();
    expect(status.connected).toBe(true);
    expect(status.latestBlock).toBe(250_000_000);
    expect(containsBigint(status)).toBe(false);
    expect(() => JSON.stringify(status)).not.toThrow();
  });

  it("getBalance returns a string balance and a numeric slot", async () => {
    const result = await observer.getBalance({ chainId, address: OWNER });
    expect(result.balance).toBe("5000000000");
    expect(result.atBlock).toBe(250_000_000);
    expect(containsBigint(result)).toBe(false);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("getTokenBalance keeps the full-precision amount as a string and decimals as a number", async () => {
    const result = await observer.getTokenBalance({ chainId, address: OWNER, token: MINT });
    expect(result.balance).toBe("123456789012345678");
    expect(result.decimals).toBe(9);
    expect(containsBigint(result)).toBe(false);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("getTransfers returns plain numbers and strings for native and SPL transfers", async () => {
    const events = await observer.getTransfers({ chainId, address: OWNER });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ txHash: "sig1", blockNumber: 250_000_000, amount: "1500000", decimals: 9, symbol: "SOL" });
    expect(events[1]).toMatchObject({ amount: "42", decimals: 6, token: MINT });
    expect(events[0]!.timestamp).toBe("2023-11-14T22:13:20.000Z");
    expect(containsBigint(events)).toBe(false);
    expect(() => JSON.stringify(events)).not.toThrow();
  });
});
