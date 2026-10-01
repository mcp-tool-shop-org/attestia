<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/sdk

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) — proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Typed HTTP client SDK for the Attestia API with retry logic, timeout handling, and namespace-grouped operations.**

[![npm version](https://img.shields.io/npm/v/@attestia/sdk)](https://www.npmjs.com/package/@attestia/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- **Zero external dependencies** -- uses native `fetch()`
- Namespace-grouped API: `client.intents`, `client.verify`, `client.proofs`
- Full **intent lifecycle**: declare, approve, reject, execute, verify
- **Replay verification** and global state hash retrieval
- **Merkle proof** operations: get attestation proofs, verify proof packages
- Automatic **retry with exponential backoff** for 5xx errors (configurable)
- **Timeout handling** via `AbortController` (default: 30s)
- API key injection via `X-Api-Key` header
- Structured `AttestiaError` with error codes, status, and details
- Cursor-based pagination support
- 50 tests

## Installation

```bash
npm install @attestia/sdk
```

## Usage

### Create a Client

```typescript
import { AttestiaClient } from "@attestia/sdk";

const client = new AttestiaClient({
  baseUrl: "https://api.attestia.io",
  apiKey: "your-api-key",
  timeout: 30000,  // optional, default 30s
  retries: 3,      // optional, default 3
});
```

### Intent Lifecycle

```typescript
// Declare an intent
const { data: intent } = await client.intents.declare({
  id: "pay-001",
  kind: "transfer",
  description: "Payroll batch",
  params: {
    toAddress: "0xabc...",
    amount: { amount: "1000", currency: "USDC", decimals: 6 },
  },
});

// Approve
await client.intents.approve("pay-001", "Approved by CFO");

// Execute
await client.intents.execute("pay-001", "ethereum", "0xtxhash...");

// Verify
await client.intents.verify("pay-001", true);

// Get a single intent
const { data } = await client.intents.get("pay-001");

// List with pagination
const { data: page } = await client.intents.list({ limit: 20, status: "declared" });
console.log(page.data);              // Intent[]
console.log(page.pagination.hasMore); // boolean
```

### Verification

```typescript
// Get the current global state hash
const { data: stateHash } = await client.verify.stateHash();
console.log(stateHash.hash);        // SHA-256 hex string
console.log(stateHash.computedAt);  // ISO timestamp

// Full replay verification
const { data: replay } = await client.verify.replay({
  ledgerSnapshot: { /* ... */ },
  registrumSnapshot: { /* ... */ },
  expectedHash: "abc123...",
});
console.log(replay.match); // true if hashes match
```

### Proof Operations

```typescript
// Get the current Merkle root
const { data: root } = await client.proofs.merkleRoot();
console.log(root.merkleRoot);  // hex hash
console.log(root.leafCount);   // number of leaves

// Get an attestation proof package
const { data: pkg } = await client.proofs.getAttestation("attestation-id");

// Verify a proof package
const { data: result } = await client.proofs.verifyProof(pkg);
console.log(result.valid); // true
```

### Error Handling

```typescript
import { AttestiaError } from "@attestia/sdk";

try {
  await client.intents.get("nonexistent");
} catch (err) {
  if (err instanceof AttestiaError) {
    console.log(err.code);       // "NOT_FOUND"
    console.log(err.statusCode); // 404
    console.log(err.details);    // additional context
  }
}
```

## API

### `AttestiaClient`

| Property | Description |
|---|---|
| `intents` | Intent lifecycle operations (declare, get, list, approve, reject, execute, verify) |
| `verify` | Verification operations (stateHash, replay) |
| `proofs` | Proof operations (merkleRoot, getAttestation, verifyProof) |

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | required | Base URL of the Attestia API |
| `apiKey` | `string` | `undefined` | API key for authentication |
| `timeout` | `number` | `30000` | Request timeout in milliseconds |
| `retries` | `number` | `3` | Max retry attempts for 5xx errors |
| `fetchFn` | `typeof fetch` | `globalThis.fetch` | Custom fetch function (testing/polyfills) |

### Types

| Type | Description |
|---|---|
| `AttestiaClientConfig` | Client configuration options |
| `AttestiaResponse<T>` | Standard response envelope with `data`, `status`, `headers` |
| `PaginatedList<T>` | Paginated response with `data[]` and `pagination` metadata |
| `AttestiaError` | Structured error with `code`, `statusCode`, and `details` |
| `Intent` | Intent object with full lifecycle state |
| `AttestationProofPackage` | Self-contained attestation proof |

## Ecosystem

This package is part of the Attestia monorepo with 13 sister packages:

`@attestia/types` | `@attestia/ledger` | `@attestia/registrum` | `@attestia/vault` | `@attestia/treasury` | `@attestia/event-store` | `@attestia/verify` | `@attestia/proof` | `@attestia/reconciler` | `@attestia/chain-observer` | `@attestia/witness` | `@attestia/node` | `@attestia/demo`

## Docs

| Document | Description |
|---|---|
| [Architecture](../../docs/architecture.md) | System architecture overview |
| [API Reference](../../docs/api.md) | Full API documentation |

## License

[MIT](../../LICENSE)
