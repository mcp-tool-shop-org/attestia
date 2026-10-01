<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/treasury

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Organizational financial management with deterministic payroll, DAO distributions, dual-gate funding, and double-entry ledger integration.**

[![npm version](https://img.shields.io/npm/v/@attestia/treasury)](https://www.npmjs.com/package/@attestia/treasury)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Deterministic payroll engine -- same schedule always produces the same run
- DAO distributions with proportional, fixed, and milestone strategies
- Dual-gate funding -- two distinct approvers required before funds are released
- Full double-entry ledger integration via `@attestia/ledger`
- All arithmetic uses bigint for precision (no floating-point)
- Snapshot-able state for persistence and audit
- Evolved from a Python payroll engine

## Installation

```bash
npm install @attestia/treasury
```

## Usage

### Create a Treasury

```ts
import { Treasury } from "@attestia/treasury";

const treasury = new Treasury({
  orgId: "dao-1",
  name: "My DAO Treasury",
  defaultCurrency: "USDC",
  defaultDecimals: 6,
  gatekeepers: ["alice", "bob"], // dual-gate funding requires both
});
```

### Deterministic Payroll

```ts
// Register payees
treasury.registerPayee("dev-1", "Alice", "0xAlice...", "eip155:1");
treasury.registerPayee("dev-2", "Bob", "0xBob...", "eip155:1");

// Set pay schedules
treasury.setPaySchedule("dev-1", [
  { id: "base-1", name: "Base Salary", type: "base", amount: { amount: "5000", currency: "USDC", decimals: 6 }, recurring: true, taxable: true },
  { id: "ded-1", name: "Health Insurance", type: "deduction", amount: { amount: "200", currency: "USDC", decimals: 6 }, recurring: true, taxable: false },
]);

// Create, approve, and execute a payroll run
const run = treasury.createPayrollRun("run-2024-jan", {
  start: "2024-01-01",
  end: "2024-01-31",
  label: "2024-Jan",
});

treasury.approvePayrollRun("run-2024-jan");
treasury.executePayrollRun("run-2024-jan"); // Records in double-entry ledger
```

### DAO Distributions

```ts
// Proportional distribution (basis points, max 10000)
treasury.createDistribution(
  "dist-q1",
  "Q1 Revenue Share",
  "proportional",
  { amount: "100000", currency: "USDC", decimals: 6 },
  [
    { payeeId: "dev-1", share: 6000 }, // 60%
    { payeeId: "dev-2", share: 4000 }, // 40%
  ],
);

treasury.approveDistribution("dist-q1");
const result = treasury.executeDistribution("dist-q1");
console.log(result.totalDistributed); // { amount: "100000", ... }
```

### Dual-Gate Funding

```ts
// Submit a funding request
treasury.submitFunding("fund-1", "Server infrastructure", {
  amount: "10000", currency: "USDC", decimals: 6,
}, "charlie");

// Both gatekeepers must approve (order doesn't matter)
treasury.approveFundingGate("fund-1", "alice", "Budget approved");
treasury.approveFundingGate("fund-1", "bob", "Verified vendor");

// Now it can be executed
treasury.executeFunding("fund-1");
```

### Ledger and Snapshots

```ts
// Access the underlying double-entry ledger
const ledger = treasury.getLedger();
const entries = ledger.getEntries();

// Snapshot for persistence
const snapshot = treasury.snapshot();
const restored = Treasury.fromSnapshot(snapshot);
```

## API

### Classes

| Export | Description |
|---|---|
| `Treasury` | Top-level coordinator composing payroll, distributions, and funding |
| `PayrollEngine` | Deterministic payroll computation with schedule management |
| `DistributionEngine` | DAO/org distributions (proportional, fixed, milestone) |
| `FundingGateManager` | Dual-gate funding approval with gatekeeper enforcement |

### Error Types

| Export | Codes |
|---|---|
| `PayrollError` | `PAYEE_EXISTS`, `PAYEE_NOT_FOUND`, `PAYEE_INACTIVE`, `RUN_EXISTS`, `RUN_NOT_FOUND`, `INVALID_TRANSITION`, `NO_COMPONENTS`, `INVALID_AMOUNT` |
| `DistributionError` | `PLAN_EXISTS`, `PLAN_NOT_FOUND`, `INVALID_TRANSITION`, `INVALID_SHARES`, `POOL_EXCEEDED`, `NO_RECIPIENTS` |
| `FundingError` | `REQUEST_EXISTS`, `REQUEST_NOT_FOUND`, `INVALID_TRANSITION`, `NOT_GATEKEEPER`, `ALREADY_APPROVED`, `DUPLICATE_GATEKEEPER` |

## Ecosystem

Attestia is a monorepo with 14 packages. Treasury sits alongside:

| Package | Purpose |
|---|---|
| `@attestia/types` | Shared domain types (Money, ChainId, IntentStatus) |
| `@attestia/ledger` | Double-entry ledger with bigint money math |
| `@attestia/chain-observer` | Multi-chain balance and transfer observation |
| `@attestia/registrum` | State registration with invariant enforcement |
| `@attestia/vault` | Personal portfolio, budgeting, and intent management |
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
