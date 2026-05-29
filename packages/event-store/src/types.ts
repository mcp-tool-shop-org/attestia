/**
 * @attestia/event-store — Core types.
 *
 * Defines the interfaces and types for append-only event persistence.
 *
 * Design principles:
 * - Events are immutable after creation
 * - Streams are append-only (no UPDATE, no DELETE)
 * - Every event has a monotonically increasing version within its stream
 * - Concurrency control via expected version (optimistic locking)
 * - Subscriptions enable reactive consumers
 */

import type { DomainEvent, EventMetadata } from "@attestia/types";

// =============================================================================
// Stored Event
// =============================================================================

/**
 * An event as persisted in the store.
 *
 * Wraps a DomainEvent with store-level metadata:
 * - streamId: which stream this event belongs to
 * - version: monotonically increasing position within the stream
 * - globalPosition: monotonically increasing position across all streams
 */
export interface StoredEvent<TPayload = Record<string, unknown>> {
  /** The domain event */
  readonly event: Readonly<{
    readonly type: string;
    readonly metadata: EventMetadata;
    readonly payload: Readonly<TPayload>;
  }>;

  /** Stream this event belongs to */
  readonly streamId: string;

  /** Position within this stream (1-based, monotonically increasing) */
  readonly version: number;

  /** Position across all streams (1-based, monotonically increasing) */
  readonly globalPosition: number;

  /** When this event was persisted (store-level, not domain-level) */
  readonly appendedAt: string;
}

// =============================================================================
// Append Options
// =============================================================================

/**
 * Expected version for optimistic concurrency control.
 *
 * - A number: the stream must be at exactly this version before append
 * - "no_stream": the stream must not exist (first write)
 * - "any": no concurrency check (append regardless)
 */
export type ExpectedVersion = number | "no_stream" | "any";

/**
 * Options for appending events to a stream.
 */
export interface AppendOptions {
  /** Expected version for optimistic concurrency control */
  readonly expectedVersion?: ExpectedVersion;
}

/**
 * Result of an append operation.
 */
export interface AppendResult {
  /** Stream ID the events were appended to */
  readonly streamId: string;

  /** Version of the first event appended */
  readonly fromVersion: number;

  /** Version of the last event appended (current stream head) */
  readonly toVersion: number;

  /** Number of events appended */
  readonly count: number;
}

// =============================================================================
// Read Options
// =============================================================================

/**
 * Direction for reading events.
 */
export type ReadDirection = "forward" | "backward";

/**
 * Options for reading events from a stream.
 */
export interface ReadOptions {
  /** Start reading from this version (inclusive, 1-based). Default: 1 */
  readonly fromVersion?: number;

  /** Maximum number of events to read. Default: unlimited */
  readonly maxCount?: number;

  /** Reading direction. Default: "forward" */
  readonly direction?: ReadDirection;
}

/**
 * Options for reading events across all streams.
 */
export interface ReadAllOptions {
  /** Start reading from this global position (inclusive). Default: 1 */
  readonly fromPosition?: number;

  /** Maximum number of events to read. Default: unlimited */
  readonly maxCount?: number;

  /** Reading direction. Default: "forward" */
  readonly direction?: ReadDirection;
}

// =============================================================================
// Subscription
// =============================================================================

/**
 * Callback for event subscriptions.
 */
export type EventHandler = (event: StoredEvent) => void | Promise<void>;

/**
 * A subscription that can be unsubscribed.
 */
export interface Subscription {
  /** Unsubscribe from the stream */
  unsubscribe(): void;
}

// =============================================================================
// Event Store Interface
// =============================================================================

/**
 * Append-only event store.
 *
 * The core persistence interface for Attestia's event-sourced architecture.
 *
 * Invariants:
 * - Events are immutable once appended
 * - Stream versions are contiguous (1, 2, 3, ...) with no gaps
 * - Global positions are monotonically increasing with no gaps
 * - Optimistic concurrency control prevents lost writes
 * - Subscriptions are guaranteed to see events in order
 */
export interface EventStore {
  /**
   * Append one or more events to a stream.
   *
   * Events are assigned monotonically increasing versions within the stream
   * and monotonically increasing global positions across all streams.
   *
   * @param streamId - The stream to append to
   * @param events - Events to append (in order)
   * @param options - Append options (expected version, etc.)
   * @returns Result with version range and count
   * @throws EventStoreError if concurrency check fails
   */
  append(
    streamId: string,
    events: readonly DomainEvent[],
    options?: AppendOptions,
  ): AppendResult;

  /**
   * Read events from a single stream.
   *
   * @param streamId - The stream to read from
   * @param options - Read options (from version, direction, limit)
   * @returns Array of stored events (may be empty if stream doesn't exist)
   */
  read(streamId: string, options?: ReadOptions): readonly StoredEvent[];

  /**
   * Read events across all streams in global order.
   *
   * @param options - Read options (from position, direction, limit)
   * @returns Array of stored events in global position order
   */
  readAll(options?: ReadAllOptions): readonly StoredEvent[];

  /**
   * Subscribe to new events on a specific stream.
   *
   * The handler is called for each new event appended to the stream.
   * Events are delivered in version order.
   *
   * @param streamId - The stream to subscribe to
   * @param handler - Callback for each new event
   * @returns Subscription handle for unsubscribing
   */
  subscribe(streamId: string, handler: EventHandler): Subscription;

  /**
   * Subscribe to all new events across all streams.
   *
   * The handler is called for each new event appended to any stream.
   * Events are delivered in global position order.
   *
   * @param handler - Callback for each new event
   * @returns Subscription handle for unsubscribing
   */
  subscribeAll(handler: EventHandler): Subscription;

  /**
   * Check if a stream exists (has at least one event).
   *
   * @param streamId - The stream to check
   * @returns True if the stream has events
   */
  streamExists(streamId: string): boolean;

  /**
   * Get the current version of a stream (version of the last event).
   *
   * @param streamId - The stream to check
   * @returns Current version, or 0 if stream doesn't exist
   */
  streamVersion(streamId: string): number;

  /**
   * Get the current global position (position of the last event).
   *
   * @returns Current global position, or 0 if store is empty
   */
  globalPosition(): number;
}

// =============================================================================
// Hash Chain
// =============================================================================

/**
 * A stored event with hash chain fields.
 *
 * Extends StoredEvent with cryptographic linking to the previous event.
 * Events produced by stores with hash chaining enabled will have these fields.
 * Legacy events (from older JSONL files) will not.
 */
export interface HashedStoredEvent<TPayload = Record<string, unknown>>
  extends StoredEvent<TPayload> {
  /** SHA-256 hash of this event's canonical content + previousHash */
  readonly hash: string;

  /** Hash of the preceding event, or "genesis" for the first event */
  readonly previousHash: string;
}

/**
 * Type guard: check if a StoredEvent has hash chain fields.
 */
export function isHashedEvent(
  event: StoredEvent,
): event is HashedStoredEvent {
  const record = event as unknown as Record<string, unknown>;
  return typeof record.hash === "string" && typeof record.previousHash === "string";
}

/**
 * A single integrity error found during hash chain verification.
 */
export interface IntegrityError {
  /** Global position of the problematic event */
  readonly position: number;
  /** Description of the integrity violation */
  readonly reason: string;
}

/**
 * Result of verifying event store hash chain integrity.
 */
export interface EventStoreIntegrityResult {
  /** Whether the entire chain is valid */
  readonly valid: boolean;
  /** Global position of the last successfully verified event */
  readonly lastVerifiedPosition: number;
  /** List of integrity errors found */
  readonly errors: readonly IntegrityError[];
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Error codes for EventStore operations.
 */
export type EventStoreErrorCode =
  | "CONCURRENCY_CONFLICT"
  | "INVALID_STREAM_ID"
  | "EMPTY_APPEND"
  | "INVALID_VERSION"
  | "STORE_CLOSED"
  | "LOCK_TIMEOUT"
  | "INTEGRITY_VIOLATION";

/**
 * Error thrown by EventStore operations.
 */
export class EventStoreError extends Error {
  constructor(
    public readonly code: EventStoreErrorCode,
    message: string,
    public readonly streamId?: string,
  ) {
    super(message);
    this.name = "EventStoreError";
  }
}
