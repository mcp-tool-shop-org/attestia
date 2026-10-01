<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/vault

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Personal financial management with multi-chain portfolio observation, envelope budgeting, and intent-based allocation.**

[![npm version](https://img.shields.io/npm/v/@attestia/vault)](https://www.npmjs.com/package/@attestia/vault)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Multi-chain portfolio observation via `@attestia/chain-observer` (EVM, XRPL, and more)
- Envelope budgeting inspired by NextLedger -- allocate, spend, and track by category
- Full intent lifecycle: Declare, Approve, Execute, Verify
- All financial actions are intents -- no direct mutations
- Deterministic arithmetic using bigint via `@attestia/ledger`
- Snapshot-able and restorable state for persistence
- Read-only chain observation (no signing from the vault)

## Installation

```bash
npm install @attestia/vault
```

## Usage

### Create a Vault

```ts
import { Vault } from "@attestia/vault";
import { ObserverRegistry } from "@attestia/chain-observer";

const registry = new ObserverRegistry();
// ... register chain observers

const vault = new Vault(
  {
    ownerId: "user-1",
    watchedAddresses: [
      { chainId: "eip155:1", address: "0xabc..." },
      { chainId: "xrpl:mainnet", address: "rXYZ..." },
    ],
    defaultCurrency: "USD",
    defaultDecimals: 6,
  },
  registry,
);
```

### Envelope Budgeting

```ts
// Create envelopes and allocate funds
vault.createEnvelope("rent", "Monthly Rent", "housing");
vault.allocateToEnvelope("rent", {
  amount: "1500",
  currency: "USD",
  decimals: 6,
});

// Check your budget
const budget = vault.getBudget();
console.log(budget.totalAllocated); // "1500"
```

### Intent Lifecycle

```ts
// 1. Declare an intent
const intent = vault.declareIntent(
  "tx-001",
  "transfer",
  "Pay rent for January",
  { toAddress: "0xlandlord...", amount: { amount: "1500", currency: "USD", decimals: 6 } },
  "rent", // envelope ID
);

// 2. Approve (human authorization)
vault.approveIntent("tx-001", "Confirmed by owner");

// 3. Mark executing (tx submitted to chain)
vault.markIntentExecuting("tx-001");

// 4. Record on-chain execution
vault.recordIntentExecution("tx-001", "eip155:1", "0xdeadbeef...");

// 5. Verify against chain state
vault.verifyIntent("tx-001", true);
```

### Portfolio Observation

```ts
const portfolio = await vault.observePortfolio();
console.log(portfolio.nativePositions); // ETH, XRP balances
console.log(portfolio.totals);          // Aggregated by currency
```

### Snapshots

```ts
// Save state
const snapshot = vault.snapshot();

// Restore later
const restored = vault.restoreFromSnapshot(snapshot, registry);
```

## API

### Classes

| Export | Description |
|---|---|
| `Vault` | Top-level coordinator composing portfolio, budget, and intents |
| `BudgetEngine` | Envelope-based budget management with bigint arithmetic |
| `IntentManager` | Intent lifecycle state machine (declared -> verified) |
| `PortfolioObserver` | Multi-chain balance aggregation |

### Error Types

| Export | Codes |
|---|---|
| `BudgetError` | `ENVELOPE_EXISTS`, `ENVELOPE_NOT_FOUND`, `INSUFFICIENT_BUDGET`, `INVALID_AMOUNT`, `CURRENCY_MISMATCH` |
| `IntentError` | `INTENT_NOT_FOUND`, `INVALID_TRANSITION`, `ALREADY_EXISTS`, `BUDGET_EXCEEDED`, `VALIDATION_FAILED` |

## Ecosystem

Attestia is a monorepo with 14 packages. Vault sits alongside:

| Package | Purpose |
|---|---|
| `@attestia/types` | Shared domain types (Money, ChainId, IntentStatus) |
| `@attestia/ledger` | Double-entry ledger with bigint money math |
| `@attestia/chain-observer` | Multi-chain balance and transfer observation |
| `@attestia/registrum` | State registration with invariant enforcement |
| `@attestia/treasury` | Org-level payroll, distributions, and funding |
| `@attestia/reconciler` | 3D cross-system reconciliation engine |
| `@attestia/witness` | XRPL on-chain attestation pipeline |
| `@attestia/proof` | Proof generation and verification |
| `@attestia/verify` | Verification utilities |
| `@attestia/event-store` | Event sourcing infrastructure |
| `@attestia/node` | Node runtime and orchestration |
| `@attestia/sdk` | Developer SDK |
| `@attestia/demo` | Demo and examples |

## License

[MIT](../../LICENSE)
