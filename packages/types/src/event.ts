/**
 * Event Types
 *
 * Append-only event architecture.
 * Every state change in Attestia is captured as a DomainEvent.
 *
 * Rules:
 * - Events are immutable after creation
 * - Every event has metadata (who, when, why)
 * - Events are replayable: same events → same state
 * - No UPDATE, no DELETE — only new events
 */

/**
 * Metadata common to all domain events.
 */
export interface EventMetadata {
  /** Unique event ID */
  readonly eventId: string;

  /** ISO 8601 timestamp */
  readonly timestamp: string;

  /** Who or what caused this event */
  readonly actor: string;

  /** ID of the event that caused this event (causal chain) */
  readonly causationId?: string;

  /** ID for grouping related events across systems */
  readonly correlationId: string;

  /**
   * Who emitted this event.
   * `vault`, `treasury`, `registrum`, and `observer` are Attestia's own domains.
   * `external` is a producer outside those domains. Cognate's AI-governance events use it.
   */
  readonly source: "vault" | "treasury" | "registrum" | "observer" | "external";
}

/**
 * A domain event in the Attestia system.
 * Discriminated by `type` field.
 */
export interface DomainEvent {
  /** Event type identifier (e.g., "intent.declared", "ledger.entry.created") */
  readonly type: string;

  /** Event metadata */
  readonly metadata: EventMetadata;

  /** Event-specific payload (opaque to the framework, typed by consumers) */
  readonly payload: Readonly<Record<string, unknown>>;
}
