<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/event-store

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) — proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Append-only event persistence with SHA-256 hash chaining, schema versioning, and snapshot support.**

[![npm version](https://img.shields.io/npm/v/@attestia/event-store)](https://www.npmjs.com/package/@attestia/event-store)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- **Append-only** event store with tamper-evident SHA-256 hash chaining (RFC 8785 canonical JSON)
- Two implementations: `InMemoryEventStore` (tests/dev) and `JsonlEventStore` (durable file-based)
- **34 domain event types** covering the full Attestia lifecycle (intents, ledger, treasury, observer, reconciliation)
- **EventCatalog** for schema registration, versioning, and migration
- **SnapshotStore** for checkpoint-based recovery (`InMemorySnapshotStore` and `FileSnapshotStore`)
- Optimistic concurrency control via `expectedVersion` on append
- Per-stream and global subscriptions with synchronous dispatch
- Hash chain integrity verification with `verifyHashChain()`
- 190 tests

## Installation

```bash
npm install @attestia/event-store
```

## Usage

### Basic Event Storage

```typescript
import { InMemoryEventStore } from "@attestia/event-store";

const store = new InMemoryEventStore();

// Append events to a stream
const result = store.append("intent-001", [
  {
    type: "vault.intent.declared",
    metadata: { timestamp: new Date().toISOString() },
    payload: { intentId: "intent-001", kind: "transfer", description: "Payroll" },
  },
]);

console.log(result.fromVersion); // 1
console.log(result.count);      // 1

// Read events from a stream
const events = store.read("intent-001");
```

### Optimistic Concurrency

```typescript
// Only append if stream is at version 1
store.append("intent-001", [newEvent], { expectedVersion: 1 });

// Only append if stream does not exist yet
store.append("new-stream", [firstEvent], { expectedVersion: "no_stream" });
```

### Hash Chain Verification

```typescript
import { computeEventHash, verifyHashChain, GENESIS_HASH } from "@attestia/event-store";

// Verify integrity of the entire store
const integrity = store.verifyIntegrity();
console.log(integrity.valid);               // true if chain is intact
console.log(integrity.lastVerifiedPosition); // last verified global position

// Or verify a subset of events manually
const events = store.readAll();
const result = verifyHashChain(events);
```

### Subscriptions

```typescript
// Subscribe to a specific stream
const sub = store.subscribe("intent-001", (event) => {
  console.log("New event:", event.event.type);
});

// Subscribe to all streams
const globalSub = store.subscribeAll((event) => {
  console.log(`[${event.streamId}] ${event.event.type}`);
});

// Unsubscribe when done
sub.unsubscribe();
```

### Schema Versioning with EventCatalog

```typescript
import { EventCatalog, createVersionedEvent } from "@attestia/event-store";

const catalog = new EventCatalog();

catalog.register({
  type: "vault.intent.declared",
  version: 1,
  validate: (payload) => payload.intentId !== undefined,
});

// Create a versioned event
const event = createVersionedEvent("vault.intent.declared", 1, payload);
```

### Snapshot Store

```typescript
import { InMemorySnapshotStore, computeSnapshotHash } from "@attestia/event-store";

const snapshots = new InMemorySnapshotStore();

await snapshots.save({
  streamId: "intent-001",
  version: 10,
  state: { /* serialized aggregate state */ },
});

const latest = await snapshots.load("intent-001");
```

## API

### Core

| Export | Description |
|---|---|
| `InMemoryEventStore` | In-memory implementation for tests and development |
| `JsonlEventStore` | File-based JSONL implementation for durable persistence |
| `EventStoreError` | Typed error class with error codes |

### Hash Chain

| Export | Description |
|---|---|
| `computeEventHash()` | Compute SHA-256 hash of an event given its predecessor |
| `verifyHashChain()` | Verify the integrity of an event sequence |
| `GENESIS_HASH` | The sentinel hash used for the first event in a chain |

### Schema and Catalog

| Export | Description |
|---|---|
| `EventCatalog` | Schema registry with versioning and migration |
| `createVersionedEvent()` | Create an event with version metadata |
| `ATTESTIA_EVENTS` | All 34 Attestia domain event definitions |
| `createAtlestiaCatalog()` | Pre-built catalog with all Attestia events registered |

### Snapshots

| Export | Description |
|---|---|
| `InMemorySnapshotStore` | In-memory snapshot storage |
| `FileSnapshotStore` | File-based snapshot storage |
| `computeSnapshotHash()` | SHA-256 hash of a snapshot for integrity |
| `verifySnapshotIntegrity()` | Verify a snapshot has not been tampered with |

## Ecosystem

This package is part of the Attestia monorepo with 13 sister packages:

`@attestia/types` | `@attestia/ledger` | `@attestia/registrum` | `@attestia/vault` | `@attestia/treasury` | `@attestia/verify` | `@attestia/proof` | `@attestia/reconciler` | `@attestia/chain-observer` | `@attestia/witness` | `@attestia/sdk` | `@attestia/node` | `@attestia/demo`

## Docs

| Document | Description |
|---|---|
| [Architecture](../../docs/architecture.md) | System architecture overview |
| [Event Catalog](../../docs/events.md) | Full event type reference |
| [API Reference](../../docs/api.md) | Full API documentation |

## License

[MIT](../../LICENSE)
