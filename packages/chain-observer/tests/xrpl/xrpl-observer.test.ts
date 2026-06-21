/**
 * Tests for XrplObserver.
 *
 * Uses vitest mocking to mock xrpl Client.
 * No actual WebSocket connections are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { XrplObserver } from "../../src/xrpl/xrpl-observer.js";
import { CHAINS } from "../../src/chains.js";
import type { ObserverConfig } from "../../src/observer.js";

// =============================================================================
// Mocks
// =============================================================================

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockRequest = vi.fn();
const mockIsConnected = vi.fn().mockReturnValue(true);

vi.mock("xrpl", () => ({
  Client: vi.fn(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    request: mockRequest,
    isConnected: mockIsConnected,
  })),
}));

function createConfig(
  chain = CHAINS.XRPL_MAINNET
): ObserverConfig {
  return {
    chain,
    rpcUrl: "wss://mock-xrpl.example.com",
    timeoutMs: 5000,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("XrplObserver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockReset();
    mockIsConnected.mockReturnValue(true);
  });

  describe("constructor", () => {
    it("creates observer for XRPL chain", () => {
      const observer = new XrplObserver(createConfig());
      expect(observer.chainId).toBe("xrpl:main");
    });

    it("rejects non-XRPL chain IDs", () => {
      expect(
        () =>
          new XrplObserver(createConfig(CHAINS.ETHEREUM_MAINNET))
      ).toThrow("expected XRPL chain ID");
    });
  });

  describe("connect / disconnect", () => {
    it("connects via WebSocket", async () => {
      const observer = new XrplObserver(createConfig());
      await observer.connect();
      expect(mockConnect).toHaveBeenCalled();
    });

    it("disconnects cleanly", async () => {
      const observer = new XrplObserver(createConfig());
      await observer.connect();
      await observer.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("returns connected with ledger index", async () => {
      mockRequest.mockResolvedValue({
        result: {
          ledger_index: 85000000,
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const status = await observer.getStatus();

      expect(status.chainId).toBe("xrpl:main");
      expect(status.connected).toBe(true);
      expect(status.latestBlock).toBe(85000000);
    });

    it("returns disconnected when not connected", async () => {
      mockIsConnected.mockReturnValue(false);

      const observer = new XrplObserver(createConfig());
      // Don't connect — observer has no client
      const status = await observer.getStatus();

      expect(status.connected).toBe(false);
    });
  });

  describe("getBalance", () => {
    it("returns XRP balance in drops", async () => {
      mockRequest.mockResolvedValue({
        result: {
          account_data: {
            Balance: "50000000", // 50 XRP = 50,000,000 drops
          },
          ledger_index: 85000000,
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const result = await observer.getBalance({
        address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
      });

      expect(result.chainId).toBe("xrpl:main");
      expect(result.address).toBe("rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR");
      expect(result.balance).toBe("50000000");
      expect(result.decimals).toBe(6);
      expect(result.symbol).toBe("XRP");
    });

    it("throws when not connected", async () => {
      mockIsConnected.mockReturnValue(false);

      const observer = new XrplObserver(createConfig());
      // Observer without connect—no client at all
      await expect(
        observer.getBalance({
          address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
        })
      ).rejects.toThrow("not connected");
    });
  });

  describe("getTokenBalance", () => {
    it("returns trust line token balance", async () => {
      mockRequest.mockResolvedValue({
        result: {
          lines: [
            {
              account: "rIssuer123",
              currency: "USD",
              balance: "1500.50",
            },
            {
              account: "rIssuer123",
              currency: "EUR",
              balance: "200.00",
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const result = await observer.getTokenBalance({
        address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
        token: "USD",
        issuer: "rIssuer123",
      });

      expect(result.token).toBe("USD");
      expect(result.symbol).toBe("USD");
      expect(result.balance).toBe("1500.50");
      expect(result.decimals).toBe(15);
    });

    it("returns zero balance when trust line not found", async () => {
      mockRequest.mockResolvedValue({
        result: {
          lines: [],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const result = await observer.getTokenBalance({
        address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
        token: "RLUSD",
        issuer: "rIssuer123",
      });

      expect(result.balance).toBe("0");
    });

    it("throws when issuer is missing", async () => {
      const observer = new XrplObserver(createConfig());
      await observer.connect();

      await expect(
        observer.getTokenBalance({
          address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
          token: "USD",
        })
      ).rejects.toThrow("issuer");
    });
  });

  describe("getTransfers", () => {
    it("returns Payment transactions as transfer events", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "ABCDEF1234567890",
              ledger_index: 85000100,
              tx_json: {
                TransactionType: "Payment",
                Account: "rSender123",
                Destination: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
                DeliverMax: "10000000", // 10 XRP in drops
                date: 790000000, // Ripple epoch seconds
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
        direction: "incoming",
      });

      expect(events.length).toBe(1);
      expect(events[0]!.txHash).toBe("ABCDEF1234567890");
      expect(events[0]!.from).toBe("rSender123");
      expect(events[0]!.to).toBe("rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR");
      expect(events[0]!.amount).toBe("10000000");
      expect(events[0]!.symbol).toBe("XRP");
      expect(events[0]!.decimals).toBe(6);
    });

    it("handles issued token payments", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "FEDCBA0987654321",
              ledger_index: 85000200,
              tx_json: {
                TransactionType: "Payment",
                Account: "rSender456",
                Destination: "rReceiver789",
                DeliverMax: {
                  value: "100.50",
                  currency: "USD",
                  issuer: "rIssuer123",
                },
                date: 790000100,
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rSender456",
        direction: "outgoing",
      });

      expect(events.length).toBe(1);
      expect(events[0]!.amount).toBe("100.50");
      expect(events[0]!.symbol).toBe("USD");
      expect(events[0]!.token).toBe("USD:rIssuer123");
      expect(events[0]!.decimals).toBe(15);
    });

    it("filters by direction", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "TX1",
              ledger_index: 100,
              tx_json: {
                TransactionType: "Payment",
                Account: "rOther",
                Destination: "rMyAddress",
                DeliverMax: "5000000",
              },
            },
            {
              hash: "TX2",
              ledger_index: 101,
              tx_json: {
                TransactionType: "Payment",
                Account: "rMyAddress",
                Destination: "rOther",
                DeliverMax: "3000000",
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      // Incoming only
      const incoming = await observer.getTransfers({
        address: "rMyAddress",
        direction: "incoming",
      });
      expect(incoming.length).toBe(1);
      expect(incoming[0]!.txHash).toBe("TX1");

      // Outgoing only
      const outgoing = await observer.getTransfers({
        address: "rMyAddress",
        direction: "outgoing",
      });
      expect(outgoing.length).toBe(1);
      expect(outgoing[0]!.txHash).toBe("TX2");
    });

    it("skips non-Payment transactions", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "TX1",
              ledger_index: 100,
              tx_json: {
                TransactionType: "OfferCreate",
                Account: "rMyAddress",
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rMyAddress",
      });
      expect(events.length).toBe(0);
    });

    it("returns empty array when no transactions", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rMyAddress",
      });
      expect(events).toEqual([]);
    });

    // A-CO-001: partial-payment over-statement.
    //
    // On XRPL, Amount/DeliverMax is the INTENDED MAXIMUM — for a tfPartialPayment
    // (flag 0x00020000) the actual delivered amount is far smaller and lives ONLY
    // in transaction metadata (`meta.delivered_amount`). The observer must report
    // the delivered amount, never the ceiling.
    it("reports the metadata delivered_amount for a partial payment, not DeliverMax", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "PARTIAL_XRP",
              ledger_index: 85000300,
              tx_json: {
                TransactionType: "Payment",
                Account: "rSender123",
                Destination: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
                DeliverMax: "10000", // intended ceiling
                Flags: 0x00020000, // tfPartialPayment
                date: 790000000,
              },
              meta: {
                delivered_amount: "1", // actually delivered: 1 drop
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
        direction: "incoming",
      });

      expect(events.length).toBe(1);
      // Must report the DELIVERED 1 drop, not the 10000 ceiling.
      expect(events[0]!.amount).toBe("1");
      expect(events[0]!.symbol).toBe("XRP");
      expect(events[0]!.decimals).toBe(6);
    });

    it("reports the metadata delivered_amount for a partial issued-token payment", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "PARTIAL_IOU",
              ledger_index: 85000400,
              tx_json: {
                TransactionType: "Payment",
                Account: "rSender456",
                Destination: "rReceiver789",
                DeliverMax: {
                  value: "100.50",
                  currency: "USD",
                  issuer: "rIssuer123",
                },
                Flags: 0x00020000, // tfPartialPayment
                date: 790000100,
              },
              meta: {
                delivered_amount: {
                  value: "0.01",
                  currency: "USD",
                  issuer: "rIssuer123",
                },
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rReceiver789",
        direction: "incoming",
      });

      expect(events.length).toBe(1);
      expect(events[0]!.amount).toBe("0.01");
      expect(events[0]!.symbol).toBe("USD");
      expect(events[0]!.token).toBe("USD:rIssuer123");
      expect(events[0]!.decimals).toBe(15);
    });

    it("falls back to deprecated meta.DeliveredAmount for partial payments", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "PARTIAL_DEPRECATED",
              ledger_index: 85000500,
              tx_json: {
                TransactionType: "Payment",
                Account: "rSender123",
                Destination: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
                DeliverMax: "10000",
                Flags: 0x00020000,
                date: 790000000,
              },
              meta: {
                DeliveredAmount: "5", // deprecated field name
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
        direction: "incoming",
      });

      expect(events.length).toBe(1);
      expect(events[0]!.amount).toBe("5");
    });

    it("fails closed when a partial payment's delivered_amount is 'unavailable'", async () => {
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "PARTIAL_UNAVAILABLE",
              ledger_index: 85000600,
              tx_json: {
                TransactionType: "Payment",
                Account: "rSender123",
                Destination: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
                DeliverMax: "10000",
                Flags: 0x00020000,
                date: 790000000,
              },
              meta: {
                delivered_amount: "unavailable",
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      // Must NOT substitute the requested amount — fail closed.
      await expect(
        observer.getTransfers({
          address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
          direction: "incoming",
        }),
      ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    });

    it("uses DeliverMax for a non-partial payment (full delivery)", async () => {
      // No tfPartialPayment flag → Amount/DeliverMax IS the delivered amount.
      mockRequest.mockResolvedValue({
        result: {
          transactions: [
            {
              hash: "FULL_XRP",
              ledger_index: 85000700,
              tx_json: {
                TransactionType: "Payment",
                Account: "rSender123",
                Destination: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
                DeliverMax: "10000000",
                Flags: 0, // not a partial payment
                date: 790000000,
              },
              meta: {
                delivered_amount: "10000000",
              },
            },
          ],
        },
      });

      const observer = new XrplObserver(createConfig());
      await observer.connect();

      const events = await observer.getTransfers({
        address: "rN7n3473SaZBCG4dFL83w7p1W9cgZw6XtR",
        direction: "incoming",
      });

      expect(events.length).toBe(1);
      expect(events[0]!.amount).toBe("10000000");
    });
  });
});
