/**
 * @attestia/event-store — File-based JSONL EventStore implementation.
 *
 * Stores events as one JSON object per line in a `.jsonl` file.
 *
 * Crash safety:
 * - Each append flushes to disk via fsync before returning
 * - Partial writes (torn pages) are detected and skipped on load
 * - The file is the source of truth; in-memory state is derived
 *
 * Hash chain:
 * - Each event includes `hash` and `previousHash` fields
 * - `hash = sha256(canonicalize(event) + previousHash)`
 * - Tampering with any event breaks the chain from that point forward
 * - Legacy events (from older files without hashes) are loaded but not chain-verified
 *
 * Properties:
 * - Durable: events survive process restart
 * - Append-only: file is never truncated or rewritten
 * - Tamper-evident: hash chain detects modifications
 * - O(1) append (single write + fsync)
 * - O(n) load on startup (sequential read of all lines)
 * - Synchronous subscription dispatch
 *
 * File format:
 * Each line is a JSON object with the StoredEvent shape:
 * {"event":{...},"streamId":"...","version":1,"globalPosition":1,"appendedAt":"...","hash":"...","previousHash":"..."}
 */

import {
  openSync,
  closeSync,
  appendFileSync,
  readFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { constants } from "node:fs";
import { basename, dirname } from "node:path";
import type { DomainEvent } from "@attestia/types";
import type {
  AppendOptions,
  AppendResult,
  EventHandler,
  EventStore,
  EventStoreIntegrityResult,
  ReadAllOptions,
  ReadOptions,
  StoredEvent,
  Subscription,
} from "./types.js";
import { EventStoreError } from "./types.js";
import { computeEventHash, GENESIS_HASH, verifyHashChain } from "./hash-chain.js";

/**
 * Options for creating a JsonlEventStore.
 */
export interface JsonlEventStoreOptions {
  /** Path to the JSONL file */
  readonly filePath: string;

  /**
   * Verify the hash chain after loading the file (fail-closed).
   *
   * When true (the default), the constructor runs full chain verification on
   * the loaded events and throws an `EventStoreError("INTEGRITY_VIOLATION")`
   * if any tampering, head-truncation, or chain break is detected — the store
   * refuses to open on a corrupt log rather than silently serving bad data.
   *
   * Set to false only for deliberate recovery/inspection of a known-damaged
   * file. `verifyIntegrity()` can still be called manually afterwards.
   *
   * @default true
   */
  readonly verifyOnLoad?: boolean;
}

/**
 * Serialized form of a StoredEvent in the JSONL file.
 * Same shape as StoredEvent — validated on load.
 * Hash fields are optional for backward compatibility with pre-chain files.
 */
interface JsonlRecord {
  event: {
    type: string;
    metadata: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
  streamId: string;
  version: number;
  globalPosition: number;
  appendedAt: string;
  hash?: string;
  previousHash?: string;
}

/**
 * File-based JSONL event store.
 *
 * Events are persisted as newline-delimited JSON objects.
 * The in-memory index is rebuilt from the file on construction.
 */
export class JsonlEventStore implements EventStore {
  private readonly _filePath: string;

  /** Per-stream event storage (rebuilt from file on load) */
  private readonly _streams = new Map<string, StoredEvent[]>();

  /** Global event log (rebuilt from file on load) */
  private readonly _globalLog: StoredEvent[] = [];

  /** Per-stream subscribers */
  private readonly _streamSubscribers = new Map<
    string,
    Set<EventHandler>
  >();

  /** Global subscribers */
  private readonly _globalSubscribers = new Set<EventHandler>();

  /** Next global position */
  private _nextGlobalPosition = 1;

  /** Hash of the last event in the chain (for linking new appends) */
  private _lastHash: string = GENESIS_HASH;

  /** Path to the lockfile for concurrent append protection */
  private readonly _lockPath: string;

  /**
   * Create a new JsonlEventStore.
   *
   * If the file exists, events are loaded from it.
   * If the file does not exist, it will be created on first append.
   * The parent directory is created if it doesn't exist.
   */
  constructor(options: JsonlEventStoreOptions) {
    this._filePath = options.filePath;
    this._lockPath = this._filePath + ".lock";

    // Ensure parent directory exists
    const dir = dirname(this._filePath);
    mkdirSync(dir, { recursive: true });

    // Load existing events from file
    this._loadFromFile();

    // Fail-closed: unless explicitly opted out, verify the hash chain on load
    // so a tampered or truncated log refuses to open rather than silently
    // serving corrupt history.
    const verifyOnLoad = options.verifyOnLoad ?? true;
    if (verifyOnLoad) {
      const result = verifyHashChain(this._globalLog);
      if (!result.valid) {
        const first = result.errors[0];
        const detail = first !== undefined
          ? ` First violation at position ${first.position}: ${first.reason}.`
          : "";
        // Surface only the BASENAME in the client-relevant message, never the
        // absolute server-side path — baking an absolute FS path into an error
        // string is a latent disclosure if any caller logs/serializes
        // err.message to a client. The integrity signal (violation position +
        // reason) is preserved; operators get the full path via err.filePath
        // (non-enumerable, so it is not serialized) and the server logs.
        const error = new EventStoreError(
          "INTEGRITY_VIOLATION",
          `Hash chain verification failed while loading "${basename(this._filePath)}" (${result.errors.length} error(s)).${detail} Refusing to open a tampered log. Pass verifyOnLoad: false to override for recovery.`,
        );
        Object.defineProperty(error, "filePath", {
          value: this._filePath,
          enumerable: false,
          writable: false,
          configurable: true,
        });
        throw error;
      }
    }
  }

  // ─── Append ─────────────────────────────────────────────────────────

  append(
    streamId: string,
    events: readonly DomainEvent[],
    options?: AppendOptions,
  ): AppendResult {
    this._validateStreamId(streamId);

    if (events.length === 0) {
      throw new EventStoreError(
        "EMPTY_APPEND",
        "Cannot append zero events",
        streamId,
      );
    }

    // Get current stream state
    let stream = this._streams.get(streamId);
    const currentVersion = stream !== undefined ? stream.length : 0;

    // Concurrency check
    const expectedVersion = options?.expectedVersion;
    if (expectedVersion !== undefined && expectedVersion !== "any") {
      if (expectedVersion === "no_stream") {
        if (currentVersion !== 0) {
          throw new EventStoreError(
            "CONCURRENCY_CONFLICT",
            `Stream "${streamId}" already exists (version ${currentVersion}), expected no_stream`,
            streamId,
          );
        }
      } else {
        if (currentVersion !== expectedVersion) {
          throw new EventStoreError(
            "CONCURRENCY_CONFLICT",
            `Stream "${streamId}" is at version ${currentVersion}, expected ${expectedVersion}`,
            streamId,
          );
        }
      }
    }

    // Create stream if needed
    if (stream === undefined) {
      stream = [];
      this._streams.set(streamId, stream);
    }

    // Acquire file lock to prevent concurrent append races
    this._acquireLock();
    try {
      // Build stored events with hash chain.
      //
      // CRITICAL (fail-closed durability): compute positions and chain hashes
      // into LOCAL variables only. Instance fields (_nextGlobalPosition,
      // _lastHash) and the in-memory logs are committed exclusively AFTER
      // _writeAndSync succeeds. If the write throws (ENOSPC/EIO), this method
      // exits without having mutated any shared state, so the next append
      // produces a contiguous, chain-valid sequence rather than a gapped /
      // forked one.
      const fromVersion = currentVersion + 1;
      const storedEvents: StoredEvent[] = [];
      const appendedAt = new Date().toISOString();
      let lines = "";

      // Local cursors — never touch instance state until the write commits.
      let nextGlobalPosition = this._nextGlobalPosition;
      let lastHash = this._lastHash;

      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        const version = fromVersion + i;
        const globalPosition = nextGlobalPosition++;

        const base: StoredEvent = {
          event: {
            type: event.type,
            metadata: event.metadata,
            payload: event.payload,
          },
          streamId,
          version,
          globalPosition,
          appendedAt,
        };

        const previousHash = lastHash;
        const hash = computeEventHash(base, previousHash);

        const hashed = Object.assign(base, { hash, previousHash }) as StoredEvent;
        lastHash = hash;

        storedEvents.push(hashed);
        lines += JSON.stringify(hashed) + "\n";
      }

      // Write to file atomically (all lines in one write + fsync).
      // If this throws, no instance state has been mutated above.
      this._writeAndSync(lines);

      // Write succeeded — NOW commit in-memory state. From here on there are no
      // throwing operations, so partial commits are impossible.
      this._nextGlobalPosition = nextGlobalPosition;
      this._lastHash = lastHash;
      for (const stored of storedEvents) {
        stream.push(stored);
        this._globalLog.push(stored);
      }

      // Dispatch to subscribers
      this._dispatch(streamId, storedEvents);

      return {
        streamId,
        fromVersion,
        toVersion: fromVersion + events.length - 1,
        count: events.length,
      };
    } finally {
      this._releaseLock();
    }
  }

  // ─── Read ───────────────────────────────────────────────────────────

  read(streamId: string, options?: ReadOptions): readonly StoredEvent[] {
    this._validateStreamId(streamId);

    const stream = this._streams.get(streamId);
    if (stream === undefined) {
      return [];
    }

    const direction = options?.direction ?? "forward";
    const fromVersion = options?.fromVersion ?? 1;
    const maxCount = options?.maxCount;

    if (fromVersion < 1) {
      throw new EventStoreError(
        "INVALID_VERSION",
        `fromVersion must be >= 1, got ${fromVersion}`,
        streamId,
      );
    }

    let result: StoredEvent[];

    if (direction === "forward") {
      result = stream.filter((e) => e.version >= fromVersion);
    } else {
      result = stream.filter((e) => e.version <= fromVersion).reverse();
    }

    if (maxCount !== undefined && maxCount >= 0) {
      result = result.slice(0, maxCount);
    }

    return result;
  }

  readAll(options?: ReadAllOptions): readonly StoredEvent[] {
    const direction = options?.direction ?? "forward";
    const fromPosition = options?.fromPosition ?? 1;
    const maxCount = options?.maxCount;

    let result: StoredEvent[];

    if (direction === "forward") {
      result = this._globalLog.filter(
        (e) => e.globalPosition >= fromPosition,
      );
    } else {
      result = this._globalLog
        .filter((e) => e.globalPosition <= fromPosition)
        .reverse();
    }

    if (maxCount !== undefined && maxCount >= 0) {
      result = result.slice(0, maxCount);
    }

    return result;
  }

  // ─── Subscriptions ──────────────────────────────────────────────────

  subscribe(streamId: string, handler: EventHandler): Subscription {
    this._validateStreamId(streamId);

    let subscribers = this._streamSubscribers.get(streamId);
    if (subscribers === undefined) {
      subscribers = new Set();
      this._streamSubscribers.set(streamId, subscribers);
    }
    subscribers.add(handler);

    return {
      unsubscribe: () => {
        subscribers.delete(handler);
        if (subscribers.size === 0) {
          this._streamSubscribers.delete(streamId);
        }
      },
    };
  }

  subscribeAll(handler: EventHandler): Subscription {
    this._globalSubscribers.add(handler);

    return {
      unsubscribe: () => {
        this._globalSubscribers.delete(handler);
      },
    };
  }

  // ─── Query ──────────────────────────────────────────────────────────

  streamExists(streamId: string): boolean {
    const stream = this._streams.get(streamId);
    return stream !== undefined && stream.length > 0;
  }

  streamVersion(streamId: string): number {
    const stream = this._streams.get(streamId);
    return stream !== undefined ? stream.length : 0;
  }

  globalPosition(): number {
    return this._nextGlobalPosition - 1;
  }

  // ─── File Path ──────────────────────────────────────────────────────

  /**
   * Get the file path this store writes to.
   * Useful for testing and debugging.
   */
  get filePath(): string {
    return this._filePath;
  }

  // ─── Integrity ──────────────────────────────────────────────────────

  /**
   * Verify the hash chain integrity of all events in the store.
   */
  verifyIntegrity(): EventStoreIntegrityResult {
    return verifyHashChain(this._globalLog);
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private _validateStreamId(streamId: string): void {
    if (streamId.length === 0) {
      throw new EventStoreError(
        "INVALID_STREAM_ID",
        "Stream ID must be a non-empty string",
      );
    }
  }

  /**
   * Load events from the JSONL file into memory.
   *
   * Tolerates partial/corrupt lines at the end of the file
   * (which can happen on unclean shutdown).
   *
   * Preserves hash/previousHash fields if present in the file
   * (for chain verification). Legacy files without these fields
   * are loaded normally — chain verification starts from the first
   * hashed event.
   */
  private _loadFromFile(): void {
    if (!existsSync(this._filePath)) {
      return;
    }

    const content = readFileSync(this._filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      let record: JsonlRecord;
      try {
        record = JSON.parse(trimmed) as JsonlRecord;
      } catch {
        // Corrupt/partial line — skip (crash safety)
        continue;
      }

      // Validate minimum required fields
      if (
        typeof record.streamId !== "string" ||
        typeof record.version !== "number" ||
        typeof record.globalPosition !== "number" ||
        record.event === undefined
      ) {
        continue;
      }

      // Build the stored event, preserving hash fields if present
      const base: StoredEvent = {
        event: {
          type: record.event.type,
          metadata: record.event.metadata as unknown as StoredEvent["event"]["metadata"],
          payload: record.event.payload,
        },
        streamId: record.streamId,
        version: record.version,
        globalPosition: record.globalPosition,
        appendedAt: record.appendedAt,
      };

      // Preserve hash chain fields from the file
      const stored = (record.hash !== undefined && record.previousHash !== undefined)
        ? Object.assign(base, { hash: record.hash, previousHash: record.previousHash }) as StoredEvent
        : base;

      // Track the last hash for continuing the chain on new appends
      if (record.hash !== undefined) {
        this._lastHash = record.hash;
      }

      // Add to stream index
      let stream = this._streams.get(stored.streamId);
      if (stream === undefined) {
        stream = [];
        this._streams.set(stored.streamId, stream);
      }
      stream.push(stored);

      // Add to global log
      this._globalLog.push(stored);

      // Track next global position
      if (stored.globalPosition >= this._nextGlobalPosition) {
        this._nextGlobalPosition = stored.globalPosition + 1;
      }
    }
  }

  /**
   * Acquire an exclusive lockfile for concurrent append protection.
   * Uses O_CREAT | O_EXCL to atomically create the lockfile — if it
   * already exists, another process holds the lock.
   *
   * Retries with a short spin-wait for up to 5 seconds before giving up.
   */
  private _acquireLock(): void {
    const maxWaitMs = 5_000;
    const spinMs = 5;
    const deadline = Date.now() + maxWaitMs;

    while (true) {
      try {
        // O_CREAT | O_EXCL | O_WRONLY — atomic create-or-fail
        const fd = openSync(this._lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        // Write PID for debugging stale locks
        writeFileSync(fd, String(process.pid), "utf-8");
        closeSync(fd);
        return;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw err;
        }
        if (Date.now() >= deadline) {
          throw new EventStoreError(
            "LOCK_TIMEOUT",
            `Failed to acquire lock on ${this._lockPath} within ${maxWaitMs}ms — another process may be writing`,
          );
        }
        // Spin-wait (synchronous to match the synchronous append API)
        const end = Date.now() + spinMs;
        while (Date.now() < end) {
          // busy wait
        }
      }
    }
  }

  /**
   * Release the lockfile.
   */
  private _releaseLock(): void {
    try {
      unlinkSync(this._lockPath);
    } catch {
      // Lock file already removed — not critical
    }
  }

  /**
   * Write data to the JSONL file and fsync for durability.
   */
  private _writeAndSync(data: string): void {
    const fd = openSync(this._filePath, "a");
    try {
      appendFileSync(fd, data, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  private _dispatch(streamId: string, events: readonly StoredEvent[]): void {
    const streamSubs = this._streamSubscribers.get(streamId);
    if (streamSubs !== undefined) {
      for (const handler of streamSubs) {
        for (const event of events) {
          try {
            handler(event);
          } catch {
            // One misbehaving subscriber must not block others
          }
        }
      }
    }

    for (const handler of this._globalSubscribers) {
      for (const event of events) {
        try {
          handler(event);
        } catch {
          // One misbehaving subscriber must not block others
        }
      }
    }
  }
}
