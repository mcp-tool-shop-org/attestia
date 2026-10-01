# RFC-001: Deterministic Financial Event Model v1

**Status:** Draft
**Created:** 2026-02-11
**Author:** Attestia Working Group

---

## Abstract

This specification defines the Deterministic Financial Event Model used by Attestia. It covers the structure of domain events, append-only persistence semantics, stream versioning, global ordering, and the SHA-256 hash chain algorithm that provides tamper evidence. A conforming implementation guarantees that identical events produce identical state.

---

## Status of This Document

Draft. This document is subject to revision before finalization.

---

## 1. Introduction

Financial control systems require an immutable, auditable record of every state change. Traditional databases allow updates and deletions, making it impossible to prove that historical records have not been modified.

Attestia solves this with an append-only event model where every state change is captured as an immutable domain event. Events are cryptographically linked into a hash chain, making any insertion, deletion, or modification detectable.

This specification defines the event model in sufficient detail that an independent implementation can produce byte-compatible event stores.

---

## 2. Terminology

All terms are defined in [DEFINITIONS.md](DEFINITIONS.md). Key terms used in this specification:

- **Domain Event**, **Event Metadata**, **Stream**, **Global Position**, **Stored Event**
- **Hash Chain**, **Genesis Hash**
- **RFC 8785 (JCS)**, **SHA-256**

---

## 3. Specification

### 3.1 Domain Event Structure

A Domain Event MUST contain exactly three fields:

```typescript
interface DomainEvent {
  readonly type: string;
  readonly metadata: EventMetadata;
  readonly payload: Record<string, unknown>;
}
```

- `type`: A namespaced event identifier (e.g., `"vault.intent.declared"`). MUST be a non-empty string.
- `metadata`: Event metadata as defined in Section 3.2.
- `payload`: Event-specific data. The framework treats this as opaque. Consumers define the schema per event type.

All fields MUST be read-only after creation.

### 3.2 Event Metadata

Every domain event MUST carry the following metadata:

```typescript
interface EventMetadata {
  readonly eventId: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly causationId?: string;
  readonly correlationId: string;
  readonly source: "vault" | "treasury" | "registrum" | "observer" | "external";
}
```

- `eventId`: A globally unique identifier for this event. MUST be unique across all events in the store.
- `timestamp`: ISO 8601 timestamp of when the event occurred.
- `actor`: Identifier of the entity that caused this event.
- `causationId`: OPTIONAL. Identifier of the event that directly caused this event.
- `correlationId`: Identifier for grouping related events across subsystems.
- `source`: `vault`, `treasury`, `registrum`, or `observer` when an Attestia subsystem emitted the event. `external` when a producer outside those domains emitted it. Cognate's AI-governance events use `external`. Attestia's own emitters do not.

### 3.3 Stored Event

When a domain event is persisted, the store wraps it with additional metadata:

```typescript
interface StoredEvent {
  readonly event: DomainEvent;
  readonly streamId: string;
  readonly version: number;
  readonly globalPosition: number;
  readonly appendedAt: string;
}
```

- `streamId`: The stream this event belongs to. MUST be a non-empty string.
- `version`: Position within the stream. MUST be a positive integer. MUST be contiguous within a stream (1, 2, 3, ...) with no gaps.
- `globalPosition`: Position across all streams. MUST be a positive integer. MUST be monotonically increasing with no gaps.
- `appendedAt`: ISO 8601 timestamp of when the event was persisted.

### 3.4 Append-Only Semantics

An event store MUST enforce the following invariants:

1. **Immutability**: Once appended, an event MUST NOT be modified or deleted.
2. **Contiguous versioning**: Stream versions MUST be contiguous integers starting at 1.
3. **Monotonic global ordering**: Global positions MUST be monotonically increasing with no gaps.
4. **Optimistic concurrency**: When an expected version is specified, the append MUST fail if the stream's current version does not match.

### 3.5 Concurrency Control

The store MUST support three concurrency modes:

- **Exact version**: The stream MUST be at exactly the specified version before append.
- **No stream**: The stream MUST NOT exist (first write).
- **Any**: No concurrency check (append regardless).

A concurrency conflict MUST result in a `CONCURRENCY_CONFLICT` error.

---

## 4. Hash Chain Algorithm

### 4.1 Event Hashing

Each stored event is hashed using the following algorithm:

1. Extract the canonical content of the stored event:
   ```
   content = {
     event: { type, metadata, payload },
     streamId,
     version,
     globalPosition,
     appendedAt
   }
   ```

2. Serialize the content using RFC 8785 (JSON Canonicalization Scheme).

3. Concatenate the canonical string with the previous event's hash:
   ```
   input = canonicalize(content) + previousHash
   ```

4. Compute the SHA-256 hash:
   ```
   hash = sha256(input)
   ```

For the first event in the chain, `previousHash` MUST be the string `"genesis"`.

### 4.2 Hashed Stored Event

A stored event with hash chain fields:

```typescript
interface HashedStoredEvent extends StoredEvent {
  readonly hash: string;
  readonly previousHash: string;
}
```

- `hash`: SHA-256 hex digest (64 lowercase characters).
- `previousHash`: Hash of the preceding event, or `"genesis"` for the first hashed event.

### 4.3 Chain Verification

To verify a hash chain:

1. Read all events in global position order.
2. Set `previousHash = "genesis"`.
3. For each event with hash fields:
   a. Verify that `event.previousHash === previousHash`.
   b. Recompute the hash using the algorithm in Section 4.1.
   c. Verify that `event.hash === recomputed hash`.
   d. Set `previousHash = event.hash`.
4. If any verification step fails, report the position and nature of the break.

Events without hash fields (legacy events from pre-chain stores) SHOULD be skipped. Chain verification MUST start from the first hashed event.

### 4.4 Backward Compatibility

A conforming implementation MUST handle event stores that contain a mix of unhashed (legacy) and hashed events. Legacy events are loaded normally. Hash chain verification begins at the first event that contains `hash` and `previousHash` fields.

---

## 5. Security Considerations

- **Tamper detection**: The hash chain detects any modification to any event from the point of modification forward. It does not prevent deletion of the entire event file.
- **External backup**: Operators SHOULD maintain external backups. XRPL witness records provide independent proof of state at specific points in time.
- **Hash algorithm**: SHA-256 is used for its wide adoption and collision resistance. If SHA-256 is compromised in the future, a new RFC SHOULD specify a migration path.
- **Canonicalization**: RFC 8785 ensures deterministic serialization. Implementations MUST NOT use custom serialization.

---

## 6. Conformance

A conforming implementation:

1. MUST implement the `EventStore` interface as specified in Section 3.4.
2. MUST produce hash chains compatible with the algorithm in Section 4.1.
3. MUST verify chain integrity on startup using the algorithm in Section 4.3.
4. MUST handle backward compatibility with unhashed events as specified in Section 4.4.
5. MUST use RFC 8785 for all canonicalization.
6. MUST use SHA-256 for all hashing.

---

## 7. References

- [RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
- [RFC 2119 — Key Words](https://www.rfc-editor.org/rfc/rfc2119)
- `packages/types/src/event.ts` — DomainEvent, EventMetadata
- `packages/event-store/src/types.ts` — StoredEvent, HashedStoredEvent, EventStore
- `packages/event-store/src/hash-chain.ts` — computeEventHash, verifyHashChain
