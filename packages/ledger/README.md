<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/ledger

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Append-only double-entry accounting engine. Bigint arithmetic, multi-currency balances, trial balance reports. Zero runtime dependencies.**

[![npm version](https://img.shields.io/npm/v/@attestia/ledger)](https://www.npmjs.com/package/@attestia/ledger)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Append-only ledger: no update, no delete, no modify -- by design
- Double-entry enforcement: every transaction must balance (debits = credits)
- Bigint arithmetic throughout -- no IEEE 754 floating-point errors
- Multi-currency accounts with per-currency balance tracking
- Chart of accounts with five account types (asset, liability, income, expense, equity)
- Trial balance generation with automatic balance verification
- Snapshot/restore for persistence with full validation on replay
- Fail-closed: invalid entries throw `LedgerError`, never silently succeed

## Installation

```bash
npm install @attestia/ledger
```

## Usage

### Set up accounts and record a transaction

```typescript
import { Ledger } from "@attestia/ledger";
import type { LedgerEntry } from "@attestia/types";

const ledger = new Ledger();

// Register accounts in the chart
ledger.registerAccount({ id: "cash", type: "asset", name: "Cash" });
ledger.registerAccount({ id: "revenue", type: "income", name: "Revenue" });

// Append a balanced transaction (debit cash, credit revenue)
const entries: LedgerEntry[] = [
  {
    id: "entry-1",
    accountId: "cash",
    type: "debit",
    money: { amount: "1000.00", currency: "USDC", decimals: 6 },
    timestamp: new Date().toISOString(),
    correlationId: "txn-001",
  },
  {
    id: "entry-2",
    accountId: "revenue",
    type: "credit",
    money: { amount: "1000.00", currency: "USDC", decimals: 6 },
    timestamp: new Date().toISOString(),
    correlationId: "txn-001",
  },
];

ledger.append(entries);
```

### Query balances and trial balance

```typescript
// Account balance (multi-currency)
const balance = ledger.getBalance("cash");
console.log(balance.balances);
// [{ currency: "USDC", decimals: 6, balance: "1000.00", totalDebits: "1000.00", totalCredits: "0" }]

// Full trial balance
const trial = ledger.getTrialBalance();
console.log(trial.balanced); // true
```

### Money arithmetic

```typescript
import { addMoney, subtractMoney, compareMoney, zeroMoney } from "@attestia/ledger";

const a = { amount: "100.50", currency: "USDC", decimals: 6 };
const b = { amount: "50.25", currency: "USDC", decimals: 6 };

const sum = addMoney(a, b);       // { amount: "150.75", currency: "USDC", decimals: 6 }
const diff = subtractMoney(a, b); // { amount: "50.25", currency: "USDC", decimals: 6 }
const cmp = compareMoney(a, b);   // 1 (a > b)
```

### Snapshot and restore

```typescript
// Persist
const snapshot = ledger.snapshot();
const json = JSON.stringify(snapshot);

// Restore (replays all entries with full validation)
const restored = Ledger.fromSnapshot(JSON.parse(json));
```

## API

### Ledger Class

| Method | Description |
|--------|-------------|
| `registerAccount(ref, timestamp?)` | Add an account to the chart |
| `append(entries, options?)` | Append a balanced set of entries |
| `getBalance(accountId)` | Get account balance (multi-currency) |
| `getTrialBalance(timestamp?)` | Compute full trial balance |
| `getEntries(filter?)` | Query entries with optional filters |
| `getEntriesByCorrelation(id)` | Get all entries for a transaction |
| `snapshot()` | Serialize ledger state |
| `Ledger.fromSnapshot(snapshot)` | Restore from snapshot (static) |

### Money Math

| Function | Description |
|----------|-------------|
| `addMoney(a, b)` | Add two Money values (same currency) |
| `subtractMoney(a, b)` | Subtract Money values |
| `compareMoney(a, b)` | Compare: -1, 0, or 1 |
| `absMoney(m)` | Absolute value |
| `isZero(m)` / `isPositive(m)` / `isNegative(m)` | Predicates |
| `zeroMoney(currency, decimals)` | Create a zero Money |
| `parseAmount(amount, decimals)` | Parse string to bigint |
| `formatAmount(scaled, decimals)` | Format bigint to string |
| `validateMoney(m)` | Validate a Money object (throws on invalid) |

### Key Types

| Type | Description |
|------|-------------|
| `LedgerTransaction` | Balanced group of entries sharing a correlation ID |
| `AccountBalance` | Full balance for an account across all currencies |
| `TrialBalance` | Complete trial balance report |
| `LedgerSnapshot` | Serializable ledger state for persistence |
| `EntryFilter` | Filter criteria for querying entries |
| `LedgerError` | Structured error with `code` field |

## Ecosystem

| Package | Role |
|---------|------|
| `@attestia/types` | Shared domain types (zero deps) |
| `@attestia/registrum` | Constitutional governance layer |
| `@attestia/chain-observer` | Multi-chain observation (EVM, XRPL, Solana) |
| `@attestia/vault` | Intent management and approval workflows |
| `@attestia/treasury` | Treasury operations |
| `@attestia/reconciler` | Cross-system reconciliation |
| `@attestia/witness` | Cryptographic witnessing |
| `@attestia/proof` | Proof generation and verification |
| `@attestia/verify` | Verification primitives |
| `@attestia/event-store` | Append-only event persistence |
| `@attestia/sdk` | Developer SDK |
| `@attestia/node` | Attestia node runtime |
| `@attestia/demo` | Interactive demonstration |

## Docs

| Document | Description |
|----------|-------------|
| [Architecture](../../docs/ARCHITECTURE.md) | System architecture overview |
| [Intent Lifecycle](../../docs/INTENT_LIFECYCLE.md) | How intents flow through the system |
| [Contributing](../../CONTRIBUTING.md) | Contribution guidelines |

## License

[MIT](../../LICENSE)
