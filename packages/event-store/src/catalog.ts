/**
 * @attestia/event-store — Event Catalog & Schema Versioning.
 *
 * Formalizes all domain events into a unified catalog with:
 * - Typed event definitions (type string → payload shape)
 * - Schema versioning (each event type tracks its schema version)
 * - Migration hooks (transform v1 events to v2 shape)
 * - Backward-compatible decoding (old events remain readable)
 *
 * Design principles:
 * - Events are immutable after creation (no schema changes retroactively)
 * - New versions are additive (new fields with defaults, not removed fields)
 * - Migration is read-time only (stored events are never rewritten)
 * - Unknown event types are preserved (forward compatibility)
 */

import type { DomainEvent, EventMetadata } from "@attestia/types";

// =============================================================================
// Event Schema Definition
// =============================================================================

/**
 * Defines a versioned event schema.
 *
 * Each event type has a schema version. When the payload shape changes,
 * the version is bumped and a migration function is provided to
 * transform old events to the new shape.
 */
export interface EventSchema {
  /** Event type string (e.g., "intent.declared") */
  readonly type: string;

  /** Current schema version (positive integer) */
  readonly version: number;

  /** Human-readable description of this event */
  readonly description: string;

  /** Which subsystem emits this event */
  readonly source: EventMetadata["source"];

  /**
   * Validate a payload against the current schema version.
   * Returns true if the payload is valid for this version.
   */
  validate(payload: unknown): boolean;
}

/**
 * Migration function that transforms an event payload from one version
 * to the next.
 *
 * Migrations are applied sequentially: v1 → v2 → v3 → ...
 * Each migration transforms the payload one version forward.
 */
export type EventMigration = (
  payload: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * A registered event type in the catalog.
 */
interface CatalogEntry {
  /** The current schema definition */
  readonly schema: EventSchema;

  /** Migrations indexed by source version (e.g., migrations[1] = v1→v2) */
  readonly migrations: Map<number, EventMigration>;
}

// =============================================================================
// Event Catalog
// =============================================================================

/**
 * Centralized registry of all domain event types.
 *
 * The catalog serves as:
 * 1. Documentation: what events exist in the system
 * 2. Validation: runtime payload checking
 * 3. Migration: transforming old event versions to current
 * 4. Discovery: listing all known event types
 *
 * Usage:
 * ```ts
 * const catalog = new EventCatalog();
 *
 * catalog.register({
 *   type: "intent.declared",
 *   version: 1,
 *   description: "A new intent was declared in the vault",
 *   source: "vault",
 *   validate: (p): p is IntentDeclaredPayload =>
 *     typeof p === "object" && p !== null && "intentId" in p,
 * });
 *
 * // Later, when schema changes:
 * catalog.registerMigration("intent.declared", 1, (payload) => ({
 *   ...payload,
 *   version: 2,
 *   newField: "default",
 * }));
 * ```
 */
export class EventCatalog {
  private readonly _entries = new Map<string, CatalogEntry>();

  /**
   * Register an event schema.
   *
   * @param schema - The event schema definition
   * @throws If the event type is already registered with a different version
   */
  register(schema: EventSchema): void {
    const existing = this._entries.get(schema.type);

    if (existing !== undefined) {
      if (existing.schema.version === schema.version) {
        // Re-registration of same version is idempotent
        return;
      }

      // Version upgrade: keep existing migrations, update schema
      this._entries.set(schema.type, {
        schema,
        migrations: existing.migrations,
      });
      return;
    }

    this._entries.set(schema.type, {
      schema,
      migrations: new Map(),
    });
  }

  /**
   * Register a migration from one version to the next.
   *
   * @param eventType - The event type to migrate
   * @param fromVersion - The source version (migration transforms fromVersion → fromVersion+1)
   * @param migration - The transformation function
   * @throws If the event type is not registered
   */
  registerMigration(
    eventType: string,
    fromVersion: number,
    migration: EventMigration,
  ): void {
    const entry = this._entries.get(eventType);
    if (entry === undefined) {
      throw new CatalogError(
        "UNKNOWN_EVENT_TYPE",
        `Cannot register migration for unknown event type "${eventType}"`,
      );
    }

    entry.migrations.set(fromVersion, migration);
  }

  /**
   * Get the schema for an event type.
   *
   * @param eventType - The event type to look up
   * @returns The schema, or undefined if not registered
   */
  getSchema(eventType: string): EventSchema | undefined {
    const entry = this._entries.get(eventType);
    return entry?.schema;
  }

  /**
   * Check if an event type is registered.
   */
  has(eventType: string): boolean {
    return this._entries.has(eventType);
  }

  /**
   * List all registered event types.
   */
  listTypes(): readonly string[] {
    return [...this._entries.keys()].sort();
  }

  /**
   * List all registered event schemas.
   */
  listSchemas(): readonly EventSchema[] {
    return [...this._entries.values()].map((e) => e.schema);
  }

  /**
   * Get all event types for a specific source subsystem.
   */
  listBySource(source: EventMetadata["source"]): readonly EventSchema[] {
    return [...this._entries.values()]
      .filter((e) => e.schema.source === source)
      .map((e) => e.schema);
  }

  /**
   * Migrate an event payload to the current schema version.
   *
   * If the event is already at the current version, returns the payload as-is.
   * If migration path is incomplete, throws CatalogError.
   *
   * @param eventType - The event type
   * @param payload - The event payload to migrate
   * @param fromVersion - The version of the stored payload
   * @returns The migrated payload at the current schema version
   * @throws CatalogError if event type unknown or migration path incomplete
   */
  migrate(
    eventType: string,
    payload: Record<string, unknown>,
    fromVersion: number,
  ): Record<string, unknown> {
    const entry = this._entries.get(eventType);
    if (entry === undefined) {
      // Unknown event type — return payload as-is (forward compatibility)
      return payload;
    }

    const targetVersion = entry.schema.version;

    if (fromVersion === targetVersion) {
      return payload;
    }

    if (fromVersion > targetVersion) {
      // Event is from a newer version than we know about.
      // Return as-is (forward compatibility).
      return payload;
    }

    // Apply migrations sequentially: fromVersion → fromVersion+1 → ... → targetVersion
    // Clone first so a failing mid-chain migration doesn't corrupt the original
    let current = structuredClone(payload);
    for (let v = fromVersion; v < targetVersion; v++) {
      const migration = entry.migrations.get(v);
      if (migration === undefined) {
        throw new CatalogError(
          "MISSING_MIGRATION",
          `Missing migration for "${eventType}" from version ${v} to ${v + 1} ` +
            `(migrating ${fromVersion} → target version ${targetVersion}). ` +
            `Hint: register it with catalog.registerMigration("${eventType}", ${v}, fn) ` +
            `before reading events stored at version ${fromVersion}.`,
        );
      }
      try {
        current = migration(current);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new CatalogError(
          "MIGRATION_FAILED",
          `Migration for "${eventType}" from version ${v} to ${v + 1} threw: ${reason}`,
        );
      }
    }

    return current;
  }

  /**
   * Upcast a stored DomainEvent to the current schema version.
   *
   * This is the primary API for reading events from the store.
   * It applies any necessary migrations and returns the event with
   * the current payload shape.
   *
   * @param event - The stored domain event
   * @param storedVersion - The schema version when the event was stored
   * @returns The event with migrated payload
   */
  upcast(event: DomainEvent, storedVersion: number): DomainEvent {
    const migratedPayload = this.migrate(
      event.type,
      event.payload as Record<string, unknown>,
      storedVersion,
    );

    if (migratedPayload === event.payload) {
      return event;
    }

    return {
      type: event.type,
      metadata: event.metadata,
      payload: migratedPayload,
    };
  }

  /**
   * Validate an event payload against its registered schema.
   *
   * @param eventType - The event type
   * @param payload - The payload to validate
   * @returns true if valid, false if invalid or unregistered
   */
  validate(eventType: string, payload: unknown): boolean {
    const entry = this._entries.get(eventType);
    if (entry === undefined) {
      return false;
    }
    return entry.schema.validate(payload);
  }

  /**
   * Get the number of registered event types.
   */
  get size(): number {
    return this._entries.size;
  }
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Stable, machine-readable codes for {@link CatalogError}.
 *
 * - `UNKNOWN_EVENT_TYPE` — an operation referenced an event type that is not
 *   registered in the catalog (e.g. registering a migration for it).
 * - `MISSING_MIGRATION` — a migration step is required to reach the target
 *   schema version but none is registered for that version hop.
 * - `MIGRATION_FAILED` — a registered migration function threw while
 *   transforming a payload.
 */
export type CatalogErrorCode =
  | "UNKNOWN_EVENT_TYPE"
  | "MISSING_MIGRATION"
  | "MIGRATION_FAILED";

/**
 * Error thrown by catalog operations.
 *
 * Carries a stable {@link CatalogErrorCode} so callers can branch on the
 * failure class without parsing the human-readable message.
 */
export class CatalogError extends Error {
  /** Stable, machine-readable failure class. */
  public readonly code: CatalogErrorCode;

  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}

// =============================================================================
// Versioned Event Helper
// =============================================================================

/**
 * Helper to create a versioned DomainEvent with schema version in metadata.
 *
 * Embeds the schema version in the payload under `_schemaVersion` so
 * it can be used during deserialization to determine which migrations
 * need to be applied.
 */
export function createVersionedEvent(
  type: string,
  metadata: EventMetadata,
  payload: Record<string, unknown>,
  schemaVersion: number,
): DomainEvent {
  return {
    type,
    metadata,
    payload: {
      ...payload,
      _schemaVersion: schemaVersion,
    },
  };
}

/**
 * Extract the schema version from a stored event's payload.
 *
 * Returns 1 if no version is embedded (backward compatibility
 * with events stored before schema versioning was introduced).
 */
export function getSchemaVersion(event: DomainEvent): number {
  const version = (event.payload as Record<string, unknown>)._schemaVersion;
  if (typeof version === "number" && Number.isInteger(version) && version > 0) {
    return version;
  }
  return 1;
}
