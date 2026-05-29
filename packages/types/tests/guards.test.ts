/**
 * Runtime type guard tests for @attestia/types
 *
 * Validates that guards narrow correctly for valid inputs
 * and reject invalid / malformed inputs at system boundaries.
 */
import { describe, it, expect } from "vitest";
import {
  isMoney,
  isAccountRef,
  isLedgerEntryType,
  isLedgerEntry,
  isIntentStatus,
  isIntent,
  isEventMetadata,
  isDomainEvent,
  isChainRef,
  isBlockRef,
  isTokenRef,
  isOnChainEvent,
  isSolanaOnChainEvent,
} from "../src/guards.js";

// =============================================================================
// Financial guards
// =============================================================================

describe("isMoney", () => {
  it("accepts valid Money", () => {
    expect(isMoney({ amount: "100.50", currency: "USDC", decimals: 6 })).toBe(true);
  });

  it("accepts zero amount", () => {
    expect(isMoney({ amount: "0", currency: "XRP", decimals: 6 })).toBe(true);
  });

  it("accepts zero decimals", () => {
    expect(isMoney({ amount: "1", currency: "BTC", decimals: 0 })).toBe(true);
  });

  it("rejects null", () => {
    expect(isMoney(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isMoney("100")).toBe(false);
    expect(isMoney(100)).toBe(false);
    expect(isMoney(undefined)).toBe(false);
  });

  it("rejects numeric amount (must be string)", () => {
    expect(isMoney({ amount: 100, currency: "USDC", decimals: 6 })).toBe(false);
  });

  it("rejects missing currency", () => {
    expect(isMoney({ amount: "100", decimals: 6 })).toBe(false);
  });

  it("rejects negative decimals", () => {
    expect(isMoney({ amount: "1", currency: "X", decimals: -1 })).toBe(false);
  });

  it("rejects non-integer decimals", () => {
    expect(isMoney({ amount: "1", currency: "X", decimals: 6.5 })).toBe(false);
  });

  // --- Numeric format validation of `amount` (D1-A-005) ---
  // The amount is a string to avoid IEEE-754 error, but it must still be a
  // canonical decimal numeral. Garbage strings that happen to be `typeof
  // "string"` must be rejected fail-closed at the system boundary.

  it("accepts canonical decimal amounts", () => {
    expect(isMoney({ amount: "100.50", currency: "USDC", decimals: 6 })).toBe(true);
    expect(isMoney({ amount: "0", currency: "XRP", decimals: 6 })).toBe(true);
    expect(isMoney({ amount: "0.0", currency: "XRP", decimals: 6 })).toBe(true);
    expect(isMoney({ amount: "1000000", currency: "USDC", decimals: 6 })).toBe(true);
    expect(isMoney({ amount: "-5.25", currency: "USDC", decimals: 6 })).toBe(true);
    expect(isMoney({ amount: "-0", currency: "USDC", decimals: 6 })).toBe(true);
  });

  it("rejects empty amount string", () => {
    expect(isMoney({ amount: "", currency: "USDC", decimals: 6 })).toBe(false);
  });

  it("rejects whitespace in amount", () => {
    expect(isMoney({ amount: " 100", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "100 ", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "1 00", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "\t1", currency: "USDC", decimals: 6 })).toBe(false);
  });

  it("rejects NaN / Infinity amounts", () => {
    expect(isMoney({ amount: "NaN", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "Infinity", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "-Infinity", currency: "USDC", decimals: 6 })).toBe(false);
  });

  it("rejects exponential notation", () => {
    expect(isMoney({ amount: "1e6", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "1E6", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "1.5e-3", currency: "USDC", decimals: 6 })).toBe(false);
  });

  it("rejects multi-dot / malformed numerals", () => {
    expect(isMoney({ amount: "1.2.3", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: ".5", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "5.", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "1,000", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "0x10", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "abc", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "+5", currency: "USDC", decimals: 6 })).toBe(false);
    expect(isMoney({ amount: "--5", currency: "USDC", decimals: 6 })).toBe(false);
  });
});

describe("isAccountRef", () => {
  it("accepts valid AccountRef for each type", () => {
    for (const type of ["asset", "liability", "income", "expense", "equity"]) {
      expect(isAccountRef({ id: "acc-1", type, name: "Test" })).toBe(true);
    }
  });

  it("rejects empty id", () => {
    expect(isAccountRef({ id: "", type: "asset", name: "Test" })).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(isAccountRef({ id: "a", type: "checking", name: "Test" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isAccountRef(null)).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(isAccountRef({ id: "a", type: "asset" })).toBe(false);
  });
});

describe("isLedgerEntryType", () => {
  it("accepts debit", () => {
    expect(isLedgerEntryType("debit")).toBe(true);
  });

  it("accepts credit", () => {
    expect(isLedgerEntryType("credit")).toBe(true);
  });

  it("rejects other strings", () => {
    expect(isLedgerEntryType("transfer")).toBe(false);
    expect(isLedgerEntryType("")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isLedgerEntryType(0)).toBe(false);
    expect(isLedgerEntryType(null)).toBe(false);
  });
});

describe("isLedgerEntry", () => {
  const validEntry = {
    id: "entry-1",
    accountId: "acc-1",
    type: "debit",
    money: { amount: "100", currency: "USD", decimals: 2 },
    timestamp: "2024-01-01T00:00:00Z",
    correlationId: "corr-1",
  };

  it("accepts valid LedgerEntry", () => {
    expect(isLedgerEntry(validEntry)).toBe(true);
  });

  it("accepts entry with optional fields", () => {
    expect(isLedgerEntry({ ...validEntry, intentId: "int-1", txHash: "0xabc" })).toBe(true);
  });

  it("rejects entry with invalid money", () => {
    expect(isLedgerEntry({ ...validEntry, money: { amount: 100 } })).toBe(false);
  });

  it("rejects entry with invalid type", () => {
    expect(isLedgerEntry({ ...validEntry, type: "transfer" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isLedgerEntry(null)).toBe(false);
  });
});

// =============================================================================
// Intent guards
// =============================================================================

describe("isIntentStatus", () => {
  const validStatuses = ["declared", "approved", "rejected", "executing", "executed", "verified", "failed"];

  it("accepts all valid statuses", () => {
    for (const status of validStatuses) {
      expect(isIntentStatus(status)).toBe(true);
    }
  });

  it("rejects invalid strings", () => {
    expect(isIntentStatus("pending")).toBe(false);
    expect(isIntentStatus("cancelled")).toBe(false);
    expect(isIntentStatus("")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isIntentStatus(1)).toBe(false);
    expect(isIntentStatus(null)).toBe(false);
  });
});

describe("isIntent", () => {
  const validIntent = {
    id: "int-1",
    status: "declared",
    kind: "transfer",
    description: "Send 100 USDC",
    declaredBy: "user-1",
    declaredAt: "2024-01-01T00:00:00Z",
    params: { to: "addr", amount: "100" },
  };

  it("accepts valid Intent", () => {
    expect(isIntent(validIntent)).toBe(true);
  });

  it("accepts Intent with empty params", () => {
    expect(isIntent({ ...validIntent, params: {} })).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(isIntent({ ...validIntent, status: "pending" })).toBe(false);
  });

  it("rejects missing description", () => {
    const { description, ...rest } = validIntent;
    expect(isIntent(rest)).toBe(false);
  });

  it("rejects null params", () => {
    expect(isIntent({ ...validIntent, params: null })).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isIntent("intent")).toBe(false);
  });
});

// =============================================================================
// Event guards
// =============================================================================

describe("isEventMetadata", () => {
  const validMetadata = {
    eventId: "evt-1",
    timestamp: "2024-01-01T00:00:00Z",
    actor: "system",
    correlationId: "corr-1",
    source: "vault",
  };

  it("accepts valid metadata for each source", () => {
    for (const source of ["vault", "treasury", "registrum", "observer"]) {
      expect(isEventMetadata({ ...validMetadata, source })).toBe(true);
    }
  });

  it("accepts metadata with optional causationId", () => {
    expect(isEventMetadata({ ...validMetadata, causationId: "cause-1" })).toBe(true);
  });

  it("rejects invalid source", () => {
    expect(isEventMetadata({ ...validMetadata, source: "ledger" })).toBe(false);
  });

  it("rejects missing correlationId", () => {
    const { correlationId, ...rest } = validMetadata;
    expect(isEventMetadata(rest)).toBe(false);
  });
});

describe("isDomainEvent", () => {
  const validEvent = {
    type: "intent.declared",
    metadata: {
      eventId: "evt-1",
      timestamp: "2024-01-01T00:00:00Z",
      actor: "user-1",
      correlationId: "corr-1",
      source: "vault",
    },
    payload: { intentId: "int-1" },
  };

  it("accepts valid DomainEvent", () => {
    expect(isDomainEvent(validEvent)).toBe(true);
  });

  it("rejects event with invalid metadata", () => {
    expect(isDomainEvent({ ...validEvent, metadata: { eventId: "x" } })).toBe(false);
  });

  it("rejects event with null payload", () => {
    expect(isDomainEvent({ ...validEvent, payload: null })).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isDomainEvent(42)).toBe(false);
  });
});

// =============================================================================
// Chain guards
// =============================================================================

describe("isChainRef", () => {
  it("accepts valid ChainRef", () => {
    expect(isChainRef({ chainId: "eip155:1", name: "Ethereum", family: "evm" })).toBe(true);
  });

  it("rejects missing family", () => {
    expect(isChainRef({ chainId: "eip155:1", name: "Ethereum" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isChainRef(null)).toBe(false);
  });
});

describe("isBlockRef", () => {
  const validBlock = {
    chainId: "eip155:1",
    blockNumber: 12345,
    blockHash: "0xabc",
    timestamp: "2024-01-01T00:00:00Z",
  };

  it("accepts valid BlockRef", () => {
    expect(isBlockRef(validBlock)).toBe(true);
  });

  it("rejects non-integer blockNumber", () => {
    expect(isBlockRef({ ...validBlock, blockNumber: 1.5 })).toBe(false);
  });

  it("rejects string blockNumber", () => {
    expect(isBlockRef({ ...validBlock, blockNumber: "12345" })).toBe(false);
  });
});

describe("isTokenRef", () => {
  it("accepts valid TokenRef", () => {
    expect(isTokenRef({
      chainId: "eip155:1",
      address: "0xA0b8...",
      symbol: "USDC",
      decimals: 6,
    })).toBe(true);
  });

  it("rejects negative decimals", () => {
    expect(isTokenRef({
      chainId: "eip155:1",
      address: "0x",
      symbol: "X",
      decimals: -1,
    })).toBe(false);
  });
});

describe("isOnChainEvent", () => {
  const validOnChainEvent = {
    id: "evt-1",
    chainId: "eip155:1",
    txHash: "0xabc",
    block: {
      chainId: "eip155:1",
      blockNumber: 100,
      blockHash: "0xdef",
      timestamp: "2024-01-01T00:00:00Z",
    },
    eventType: "transfer",
    data: { from: "0x1", to: "0x2" },
    observedAt: "2024-01-01T00:01:00Z",
  };

  it("accepts valid OnChainEvent", () => {
    expect(isOnChainEvent(validOnChainEvent)).toBe(true);
  });

  it("rejects event with invalid block", () => {
    expect(isOnChainEvent({ ...validOnChainEvent, block: { chainId: "x" } })).toBe(false);
  });

  it("rejects event with null data", () => {
    expect(isOnChainEvent({ ...validOnChainEvent, data: null })).toBe(false);
  });

  it("rejects null", () => {
    expect(isOnChainEvent(null)).toBe(false);
  });
});

// =============================================================================
// Solana chain guards
// =============================================================================

describe("isSolanaOnChainEvent", () => {
  const validSolanaEvent = {
    id: "sol-evt-1",
    chainId: "solana:mainnet-beta",
    txHash: "5wHu1qwD7q3hYLpGGf3TqHLnXJNjV9F8j4mYQyKqxF2C",
    block: {
      chainId: "solana:mainnet-beta",
      blockNumber: 250000000,
      blockHash: "7nPkM4pBzjJVkbGRFfLnCZr5z2Z3q4W1M9kYdV8Z5kGo",
      timestamp: "2024-06-15T12:00:00Z",
    },
    eventType: "transfer",
    data: { from: "So11111111111111111111111111111111111111112", to: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
    observedAt: "2024-06-15T12:00:01Z",
    slot: 250000000,
    programId: "11111111111111111111111111111111",
    accountKeys: ["So11111111111111111111111111111111111111112", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
    signature: "5wHu1qwD7q3hYLpGGf3TqHLnXJNjV9F8j4mYQyKqxF2C",
  };

  it("accepts valid SolanaOnChainEvent", () => {
    expect(isSolanaOnChainEvent(validSolanaEvent)).toBe(true);
  });

  it("also satisfies base isOnChainEvent", () => {
    expect(isOnChainEvent(validSolanaEvent)).toBe(true);
  });

  it("rejects standard OnChainEvent without Solana fields", () => {
    const standardEvent = {
      id: "evt-1",
      chainId: "eip155:1",
      txHash: "0xabc",
      block: {
        chainId: "eip155:1",
        blockNumber: 100,
        blockHash: "0xdef",
        timestamp: "2024-01-01T00:00:00Z",
      },
      eventType: "transfer",
      data: { from: "0x1", to: "0x2" },
      observedAt: "2024-01-01T00:01:00Z",
    };
    expect(isSolanaOnChainEvent(standardEvent)).toBe(false);
  });

  it("rejects event with non-integer slot", () => {
    expect(isSolanaOnChainEvent({ ...validSolanaEvent, slot: 1.5 })).toBe(false);
  });

  it("rejects event with missing programId", () => {
    const { programId, ...rest } = validSolanaEvent;
    expect(isSolanaOnChainEvent(rest)).toBe(false);
  });

  it("rejects event with non-string accountKeys", () => {
    expect(isSolanaOnChainEvent({ ...validSolanaEvent, accountKeys: [1, 2] })).toBe(false);
  });

  it("rejects event with non-array accountKeys", () => {
    expect(isSolanaOnChainEvent({ ...validSolanaEvent, accountKeys: "notarray" })).toBe(false);
  });

  it("rejects event with missing signature", () => {
    const { signature, ...rest } = validSolanaEvent;
    expect(isSolanaOnChainEvent(rest)).toBe(false);
  });

  it("rejects null", () => {
    expect(isSolanaOnChainEvent(null)).toBe(false);
  });

  it("accepts event with empty accountKeys array", () => {
    expect(isSolanaOnChainEvent({ ...validSolanaEvent, accountKeys: [] })).toBe(true);
  });
});
