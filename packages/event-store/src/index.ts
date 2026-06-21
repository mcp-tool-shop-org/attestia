/**
 * @attestia/event-store — Append-only event persistence.
 *
 * Provides:
 * - EventStore interface for append-only event streams
 * - InMemoryEventStore for tests and development
 * - JsonlEventStore for durable file-based persistence
 * - EventCatalog for schema versioning and migration
 * - Attestia domain event definitions (20 event types)
 * - SnapshotStore for checkpoint-based recovery
 *
 * @packageDocumentation
 */

// Core types
export type {
  StoredEvent,
  HashedStoredEvent,
  ExpectedVersion,
  AppendOptions,
  AppendResult,
  ReadDirection,
  ReadOptions,
  ReadAllOptions,
  EventHandler,
  Subscription,
  EventStore,
  EventStoreErrorCode,
  IntegrityError,
  EventStoreIntegrityResult,
} from "./types.js";
export { EventStoreError, isHashedEvent } from "./types.js";

// Hash chain
export { computeEventHash, verifyHashChain, GENESIS_HASH } from "./hash-chain.js";

// Implementations
export { InMemoryEventStore } from "./in-memory-store.js";
export type { InMemoryEventStoreOptions } from "./in-memory-store.js";
export { JsonlEventStore } from "./jsonl-store.js";
export type {
  JsonlEventStoreOptions,
  LoadDiagnostics,
  LoadSkip,
  LoadSkipReason,
} from "./jsonl-store.js";

// Catalog & schema versioning
export type { EventSchema, EventMigration, CatalogErrorCode } from "./catalog.js";
export { EventCatalog, CatalogError } from "./catalog.js";
export { createVersionedEvent, getSchemaVersion } from "./catalog.js";

// Attestia domain events
export { ATTESTIA_EVENTS, createAtlestiaCatalog } from "./attestia-events.js";
export type { AttestiaEventType } from "./attestia-events.js";
export type {
  IntentDeclaredPayload,
  IntentApprovedPayload,
  IntentRejectedPayload,
  IntentExecutedPayload,
  IntentVerifiedPayload,
  IntentFailedPayload,
  BudgetAllocatedPayload,
  PortfolioObservedPayload,
  TransactionAppendedPayload,
  AccountRegisteredPayload,
  PayrollExecutedPayload,
  DistributionExecutedPayload,
  FundingGateApprovedPayload,
  StateRegisteredPayload,
  AttestationEmittedPayload,
  ChainEventDetectedPayload,
  BalanceObservedPayload,
  ReconciliationCompletedPayload,
  AttestationRecordedPayload,
  WitnessRecordSubmittedPayload,
} from "./attestia-events.js";

// Snapshot store
export type {
  StoredSnapshot,
  SaveSnapshotOptions,
  SnapshotStore,
  SnapshotStoreOptions,
  FileSnapshotStoreOptions,
  PruneOptions,
  PruneResult,
} from "./snapshot-store.js";
export {
  InMemorySnapshotStore,
  FileSnapshotStore,
  computeSnapshotHash,
  verifySnapshotIntegrity,
} from "./snapshot-store.js";
