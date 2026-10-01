<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/witness

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) -- proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**XRPL on-chain attestation pipeline -- writes reconciliation proofs to the XRP Ledger as content-addressed payment memos.**

[![npm version](https://img.shields.io/npm/v/@attestia/witness)](https://www.npmjs.com/package/@attestia/witness)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Writes attestations as 1-drop self-send XRPL payments with memo payloads
- Content-addressed proofs using SHA-256 hashing (tamper-evident)
- Retry with exponential backoff and jitter for transient XRPL failures
- Graceful degradation -- distinguishes permanent vs retryable errors
- Full verification pipeline: submit on-chain, then read back and verify
- N-of-M multi-signature governance with event-sourced policy management
- Dry-run mode for inspecting transactions before submission
- No smart contracts, no Turing-complete execution -- just timestamped proof

## Installation

```bash
npm install @attestia/witness
```

## Usage

### Witness a Reconciliation Report

```ts
import { XrplWitness } from "@attestia/witness";

const witness = new XrplWitness({
  rpcUrl: "wss://s.altnet.rippletest.net:51233",
  chainId: "xrpl:testnet",
  account: "rWitnessAccount...",
  secret: "sWitnessSecret...",
});

await witness.connect();

// Witness a reconciliation report (from @attestia/reconciler)
const record = await witness.witnessReconciliation(report, attestation);

console.log(record.txHash);      // XRPL transaction hash
console.log(record.ledgerIndex); // Validated ledger index
console.log(record.payload.hash); // SHA-256 content hash

await witness.disconnect();
```

### Verify On-Chain Attestation

```ts
await witness.connect();

const result = await witness.verify(record);
console.log(result.verified);       // true
console.log(result.onChainHash);    // matches record.payload.hash
console.log(result.discrepancies);  // []

await witness.disconnect();
```

### Fetch and Decode an Attestation

```ts
const payload = await witness.fetchPayload("XRPL_TX_HASH...");
if (payload) {
  console.log(payload.source.kind);         // "reconciliation"
  console.log(payload.summary.clean);       // true if all reconciled
  console.log(payload.summary.attestedBy);  // attestor identity
}
```

### Dry-Run (Inspect Without Submitting)

```ts
const { payload, transaction } = witness.dryRun(report, attestation);

console.log(transaction.memo);    // Encoded XRPL memo
console.log(transaction.amount);  // "1" (1 drop)
console.log(payload.hash);        // Content-addressed hash
```

### Retry Configuration

```ts
import { XrplWitness, DEFAULT_RETRY_CONFIG } from "@attestia/witness";

const witness = new XrplWitness({
  rpcUrl: "wss://...",
  chainId: "xrpl:testnet",
  account: "r...",
  secret: "s...",
  retry: {
    maxAttempts: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    jitterMs: 500,
  },
});
```

### Multi-Sig Governance

```ts
import { GovernanceStore, MultiSigWitness } from "@attestia/witness";

// Set up governance with N-of-M quorum
const store = new GovernanceStore();
store.apply({ type: "signer_added", address: "rAlice...", label: "Alice", weight: 1, timestamp: new Date().toISOString() });
store.apply({ type: "signer_added", address: "rBob...", label: "Bob", weight: 1, timestamp: new Date().toISOString() });
store.apply({ type: "quorum_changed", previousQuorum: 0, newQuorum: 2, timestamp: new Date().toISOString() });

const policy = store.getPolicy();
console.log(policy.quorum);  // 2 (both must sign)
console.log(policy.signers); // [Alice, Bob]
```

## API

### Classes

| Export | Description |
|---|---|
| `XrplWitness` | Top-level coordinator: submit, verify, fetch, dry-run |
| `XrplSubmitter` | Submits attestation transactions with retry |
| `XrplVerifier` | Reads back and verifies on-chain attestations |
| `GovernanceStore` | Event-sourced multi-sig governance policy store |
| `MultiSigSubmitter` | Multi-signature transaction submission |
| `MultiSigWitness` | Multi-sig witness orchestration |

### Functions

| Export | Description |
|---|---|
| `buildReconciliationPayload()` | Build payload from reconciliation report |
| `buildRegistrumPayload()` | Build payload from Registrum state |
| `verifyPayloadHash()` | Verify content hash integrity (offline) |
| `encodeMemo()` / `decodeMemo()` | XRPL memo hex encoding/decoding |
| `withRetry()` | Generic retry with exponential backoff |
| `isRetryableXrplError()` | Classify XRPL errors as permanent vs transient |
| `validateAuthority()` | Validate signer authority against governance |
| `replayGovernanceHistory()` | Replay event-sourced governance state |

### Error Types

| Export | Description |
|---|---|
| `WitnessSubmitError` | All retry attempts exhausted (includes payload and attempt count) |
| `RetryExhaustedError` | Generic retry exhaustion error |

## Ecosystem

Attestia is a monorepo with 14 packages. Witness sits alongside:

| Package | Purpose |
|---|---|
| `@attestia/types` | Shared domain types (Money, ChainId, IntentStatus) |
| `@attestia/ledger` | Double-entry ledger with bigint money math |
| `@attestia/chain-observer` | Multi-chain balance and transfer observation |
| `@attestia/registrum` | State registration with invariant enforcement |
| `@attestia/vault` | Personal portfolio, budgeting, and intent management |
| `@attestia/treasury` | Org-level payroll, distributions, and funding |
| `@attestia/reconciler` | 3D cross-system reconciliation engine |
| `@attestia/proof` | Proof generation and verification |
| `@attestia/verify` | Verification utilities |
| `@attestia/event-store` | Event sourcing infrastructure |
| `@attestia/node` | Node runtime and orchestration |
| `@attestia/sdk` | Developer SDK |
| `@attestia/demo` | Demo and examples |

## License

[MIT](../../LICENSE)
