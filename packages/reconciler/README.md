<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/reconciler

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Cross-system reconciliation engine with 3D matching across intents, ledger entries, and on-chain events.**

[![npm version](https://img.shields.io/npm/v/@attestia/reconciler)](https://www.npmjs.com/package/@attestia/reconciler)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Three matching dimensions: Intent vs Ledger, Ledger vs Chain, Intent vs Chain
- Detects amount mismatches, missing records, and orphaned entries
- Cross-chain deduplication prevents L2 settlement double-counting
- Structural linking of cross-chain events with confidence scoring
- Content-addressed attestation via SHA-256 hashing and Registrum integration
- Scoped reconciliation by time range, chain, intent, or correlation ID
- Pure functions for cross-chain rules -- no side effects

## Installation

```bash
npm install @attestia/reconciler
```

## Usage

### Basic Reconciliation

```ts
import { Reconciler } from "@attestia/reconciler";
import type {
  ReconcilableIntent,
  ReconcilableLedgerEntry,
  ReconcilableChainEvent,
} from "@attestia/reconciler";

const reconciler = new Reconciler();

const report = reconciler.reconcile({
  intents: [
    {
      id: "intent-1",
      status: "executed",
      kind: "transfer",
      amount: { amount: "1000", currency: "USDC", decimals: 6 },
      chainId: "eip155:1",
      txHash: "0xabc123...",
      declaredAt: "2024-01-15T10:00:00Z",
      correlationId: "payroll:run-1:dev-1",
    },
  ],
  ledgerEntries: [
    {
      id: "entry-1",
      accountId: "payroll:expense:2024-Jan",
      type: "debit",
      money: { amount: "1000", currency: "USDC", decimals: 6 },
      timestamp: "2024-01-15T10:01:00Z",
      intentId: "intent-1",
      txHash: "0xabc123...",
      correlationId: "payroll:run-1:dev-1",
    },
  ],
  chainEvents: [
    {
      chainId: "eip155:1",
      txHash: "0xabc123...",
      from: "0xTreasury...",
      to: "0xDev1...",
      amount: "1000000000",
      decimals: 6,
      symbol: "USDC",
      timestamp: "2024-01-15T10:01:30Z",
    },
  ],
});

console.log(report.summary.allReconciled); // true
console.log(report.summary.matchedCount);  // 3
```

### Reconciliation with Attestation

```ts
import { Reconciler } from "@attestia/reconciler";
import { Registrar } from "@attestia/registrum";

const registrar = new Registrar();
const reconciler = new Reconciler({
  registrar,
  attestorId: "reconciler-service-1",
});

// Reconcile and attest in one call
const { report, attestation } = await reconciler.reconcileAndAttest({
  intents,
  ledgerEntries,
  chainEvents,
});

console.log(attestation.reportHash);   // SHA-256 of the full report
console.log(attestation.allReconciled);
```

### Scoped Reconciliation

```ts
const report = reconciler.reconcile({
  intents,
  ledgerEntries,
  chainEvents,
  scope: {
    from: "2024-01-01T00:00:00Z",
    to: "2024-01-31T23:59:59Z",
    chainId: "eip155:1",
  },
});
```

### Cross-Chain Deduplication

```ts
import { LedgerChainMatcher } from "@attestia/reconciler";

const matcher = new LedgerChainMatcher();

// Automatically removes L2 settlement artifacts on L1
const { matches, removedSettlementArtifacts } = matcher.matchMultiChain(
  ledgerEntries,
  chainEvents, // events from Arbitrum + Ethereum
);
```

### Structural Linking

```ts
import { linkCrossChainEvents, isSettlementPair } from "@attestia/reconciler";

const links = linkCrossChainEvents(crossChainEvents);
for (const link of links) {
  console.log(link.linkType);   // "settlement" | "bridge" | "structural"
  console.log(link.confidence); // "high" | "medium" | "low"
}
```

## API

### Classes

| Export | Description |
|---|---|
| `Reconciler` | Top-level coordinator running all three matchers |
| `IntentLedgerMatcher` | Matches intents to ledger entries by intentId |
| `LedgerChainMatcher` | Matches ledger entries to chain events by txHash |
| `IntentChainMatcher` | Matches intents to chain events by txHash |
| `Attestor` | Registers reconciliation results in Registrum |

### Cross-Chain Functions

| Export | Description |
|---|---|
| `isSettlementPair()` | Check if two chains form an L2-L1 settlement pair |
| `getSettlementChain()` | Get the settlement chain for an L2 |
| `preventDoubleCounting()` | Remove L1 settlement artifacts from event sets |
| `linkCrossChainEvents()` | Structurally link related cross-chain events |

### Match Statuses

`matched`, `amount-mismatch`, `missing-ledger`, `missing-intent`, `missing-chain`, `unmatched`

## Ecosystem

Attestia is a monorepo with 14 packages. Reconciler sits alongside:

| Package | Purpose |
|---|---|
| `@attestia/types` | Shared domain types (Money, ChainId, IntentStatus) |
| `@attestia/ledger` | Double-entry ledger with bigint money math |
| `@attestia/chain-observer` | Multi-chain balance and transfer observation |
| `@attestia/registrum` | State registration with invariant enforcement |
| `@attestia/vault` | Personal portfolio, budgeting, and intent management |
| `@attestia/treasury` | Org-level payroll, distributions, and funding |
| `@attestia/witness` | XRPL on-chain attestation pipeline |
| `@attestia/proof` | Proof generation and verification |
| `@attestia/verify` | Verification utilities |
| `@attestia/event-store` | Event sourcing infrastructure |
| `@attestia/node` | Node runtime and orchestration |
| `@attestia/sdk` | Developer SDK |
| `@attestia/demo` | Demo and examples |

## License

[MIT](../../LICENSE)
