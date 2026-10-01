<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/types

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Shared domain types for the entire Attestia stack. Zero runtime dependencies. Pure TypeScript contracts.**

[![npm version](https://img.shields.io/npm/v/@attestia/types)](https://www.npmjs.com/package/@attestia/types)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Defines the canonical types used across all 14 Attestia packages
- Intent lifecycle: `declared` -> `approved` -> `executing` -> `executed` -> `verified`
- Financial primitives: `Money` (string amounts), `AccountRef`, `LedgerEntry`
- Multi-chain references: `ChainRef`, `BlockRef`, `TokenRef`, `OnChainEvent`
- Solana-specific extensions: `SolanaOnChainEvent`, `SolanaSlotRef`, `SolanaCommitment`
- Event architecture: `DomainEvent` with full causation/correlation tracking
- 12 runtime type guards for safe validation at system boundaries
- Zero runtime dependencies -- pure type contracts with guards

## Installation

```bash
npm install @attestia/types
```

## Usage

### Financial primitives

```typescript
import type { Money, AccountRef, LedgerEntry } from "@attestia/types";

const payment: Money = {
  amount: "1000.00",
  currency: "USDC",
  decimals: 6,
};

const treasury: AccountRef = {
  id: "treasury-main",
  type: "asset",
  name: "Main Treasury",
};
```

### Intent lifecycle

```typescript
import type { Intent, IntentStatus } from "@attestia/types";

const transfer: Intent = {
  id: "intent-001",
  status: "declared",
  kind: "transfer",
  description: "Pay vendor invoice #1234",
  declaredBy: "ops-admin",
  declaredAt: new Date().toISOString(),
  params: { to: "0xabc...", amount: "500.00", currency: "USDC" },
};
```

### Chain references

```typescript
import type { ChainRef, OnChainEvent, BlockRef } from "@attestia/types";

const ethereum: ChainRef = {
  chainId: "eip155:1",
  name: "Ethereum Mainnet",
  family: "evm",
};
```

### Runtime type guards

```typescript
import { isMoney, isIntent, isOnChainEvent } from "@attestia/types";

function processInput(data: unknown) {
  if (isMoney(data)) {
    console.log(`${data.amount} ${data.currency}`);
  }
  if (isIntent(data)) {
    console.log(`Intent ${data.id} is ${data.status}`);
  }
}
```

## API

### Types

| Export | Description |
|--------|-------------|
| `Money` | Precise monetary amount (string-based, currency-explicit) |
| `Currency` | Currency identifier (token symbols, ISO 4217) |
| `AccountRef` | Reference to a ledger account (asset, liability, income, expense, equity) |
| `LedgerEntry` | A single line in the ledger with debit/credit type |
| `Intent` | A proposed financial action with lifecycle state |
| `IntentStatus` | Lifecycle states: declared, approved, rejected, executing, executed, verified, failed |
| `IntentDeclaration` / `IntentApproval` / `IntentExecution` / `IntentVerification` | Lifecycle event records |
| `ChainRef` / `BlockRef` / `TokenRef` | Chain-agnostic blockchain references |
| `OnChainEvent` | An observed on-chain event (read-only) |
| `SolanaOnChainEvent` | Solana-specific event with slot, programId, signature |
| `SolanaSlotRef` / `SolanaCommitment` | Solana slot and commitment primitives |
| `DomainEvent` | Append-only event with full metadata (actor, causation, correlation) |
| `EventMetadata` | Metadata common to all domain events |

### Type Guards

| Guard | Narrows to |
|-------|------------|
| `isMoney(value)` | `Money` |
| `isAccountRef(value)` | `AccountRef` |
| `isLedgerEntry(value)` | `LedgerEntry` |
| `isIntent(value)` | `Intent` |
| `isIntentStatus(value)` | `IntentStatus` |
| `isDomainEvent(value)` | `DomainEvent` |
| `isChainRef(value)` | `ChainRef` |
| `isBlockRef(value)` | `BlockRef` |
| `isTokenRef(value)` | `TokenRef` |
| `isOnChainEvent(value)` | `OnChainEvent` |
| `isSolanaOnChainEvent(value)` | `SolanaOnChainEvent` |
| `isEventMetadata(value)` | `EventMetadata` |

## Ecosystem

This package is the foundation for all Attestia packages:

| Package | Role |
|---------|------|
| `@attestia/ledger` | Double-entry accounting engine |
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
