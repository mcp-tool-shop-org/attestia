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
  statSync,
} from "node:fs";
import { constants } from "node:fs";
import { basename, dirname } from "node:path";
import type { DomainEvent, Telemetry, ObservabilityEvent } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
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

  /**
   * Optional telemetry sink. When provided, the store emits structured
   * {@link Telemetry} events (package `"@attestia/event-store"`) at the
   * operationally-critical points: load, integrity verify, append, and lock
   * acquisition. Emission is best-effort and never affects store behavior —
   * `record` is contractually non-throwing.
   *
   * @default NOOP_TELEMETRY (no events emitted)
   */
  readonly telemetry?: Telemetry;

  /**
   * Defensive upper bound, in bytes, on the size of the JSONL file the store
   * will read into memory on construction (B-LES-007).
   *
   * The store is a whole-file, in-memory index: `_loadFromFile` reads the entire
   * append-only log into a single string and builds in-memory indexes that hold
   * every event for the life of the instance. An append-only log only grows, so
   * a multi-GB log would otherwise OOM the process on construction with an
   * opaque V8 allocation failure. When set, the constructor `statSync`s the file
   * first and, if it exceeds this limit, fails closed with a structured
   * `EventStoreError("LOG_TOO_LARGE")` naming the actual size and the limit —
   * an actionable message instead of a crash.
   *
   * Leave unset (the default) to impose no limit and preserve current behavior.
   *
   * @default undefined (no size limit)
   */
  readonly maxLoadBytes?: number;
}

/**
 * Why a single line was skipped during load. Stable, low-cardinality codes so
 * an operator (or monitoring) can distinguish a torn/partial write from a
 * structurally invalid record without re-parsing the file by hand.
 *
 * - `parse_error`  — the line was not valid JSON (commonly a torn last line).
 * - `missing_field`— parsed, but a required field was absent or mistyped
 *   (streamId / version / globalPosition / event / appendedAt).
 */
export type LoadSkipReason = "parse_error" | "missing_field";

/**
 * One skipped line, captured for {@link JsonlEventStore.loadDiagnostics}.
 */
export interface LoadSkip {
  /** 1-based index of the line in the file (counts blank lines too). */
  readonly lineIndex: number;
  /** Stable reason code for the skip. */
  readonly reason: LoadSkipReason;
}

/**
 * Read-only summary of what happened when the store loaded its backing file.
 * Exposed via {@link JsonlEventStore.loadDiagnostics} so an operator inspecting
 * a damaged log can see exactly which lines were dropped, and why, without
 * re-parsing the file. `skips` is non-empty iff `skippedLines > 0`.
 */
export interface LoadDiagnostics {
  /** Number of events successfully loaded into memory. */
  readonly eventsLoaded: number;
  /** Number of non-empty lines skipped as corrupt/invalid. */
  readonly skippedLines: number;
  /** Per-line detail for each skipped line. */
  readonly skips: readonly LoadSkip[];
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

  /**
   * Byte size of the JSONL file as last observed by THIS store instance
   * (after load and after each successful append). Used under the append lock
   * to detect whether another writer advanced the file past our cached cursor
   * — see {@link _detectExternalAdvanceUnderLock}. `undefined` means the file
   * did not exist at construction (no baseline yet).
   */
  private _knownFileSize: number | undefined;

  /** Path to the lockfile for concurrent append protection */
  private readonly _lockPath: string;

  /** Injected telemetry sink (defaults to a no-op; never throws). */
  private readonly _telemetry: Telemetry;

  /** Optional defensive cap on file bytes read at load (B-LES-007). */
  private readonly _maxLoadBytes: number | undefined;

  /**
   * Diagnostics captured by the most recent load (B-LES-002). Surfaced via the
   * public {@link loadDiagnostics} accessor so a damaged log's dropped lines are
   * inspectable even under the default NOOP telemetry sink.
   */
  private _loadDiagnostics: LoadDiagnostics = {
    eventsLoaded: 0,
    skippedLines: 0,
    skips: [],
  };

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
    this._telemetry = options.telemetry ?? NOOP_TELEMETRY;
    this._maxLoadBytes = options.maxLoadBytes;

    // Ensure parent directory exists
    const dir = dirname(this._filePath);
    mkdirSync(dir, { recursive: true });

    // Load existing events from file (timed for observability)
    const loadStart = Date.now();
    const { eventsLoaded, skippedLines, skips } = this._loadFromFile();
    this._loadDiagnostics = { eventsLoaded, skippedLines, skips };
    // B-LES-002: skipping lines on load means records were silently dropped from
    // tamper-evident history — a material event, not routine. Escalate to "warn"
    // / "degraded" so it is visible even when a host maps levels to log streams,
    // and carry a stable code plus the recovery hint pointing at loadDiagnostics.
    const droppedLines = skippedLines > 0;
    this._emit({
      op: "load",
      level: droppedLines ? "warn" : "info",
      outcome: droppedLines ? "degraded" : "ok",
      durationMs: Date.now() - loadStart,
      attributes: {
        eventsLoaded,
        skippedLines,
        ...(droppedLines ? { code: "LOAD_LINES_SKIPPED" } : {}),
      },
      message: droppedLines
        ? `loaded ${eventsLoaded} event(s) from ${basename(this._filePath)}; SKIPPED ${skippedLines} corrupt line(s) — inspect store.loadDiagnostics for the dropped line indices and reasons`
        : `loaded ${eventsLoaded} event(s) from ${basename(this._filePath)}`,
    });

    // Fail-closed: unless explicitly opted out, verify the hash chain on load
    // so a tampered or truncated log refuses to open rather than silently
    // serving corrupt history.
    const verifyOnLoad = options.verifyOnLoad ?? true;
    if (verifyOnLoad) {
      const verifyStart = Date.now();
      const result = verifyHashChain(this._globalLog);
      this._emit({
        op: "verify",
        level: result.valid ? "info" : "error",
        outcome: result.valid ? "ok" : "failed",
        durationMs: Date.now() - verifyStart,
        attributes: { valid: result.valid, errorCount: result.errors.length },
        message: result.valid
          ? `hash chain verified (${this._globalLog.length} event(s))`
          : `hash chain verification failed with ${result.errors.length} error(s)`,
      });
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
    const appendStart = Date.now();
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
      // A-ES-001: the lock serializes the write syscall, but our chain cursor
      // (_lastHash / _nextGlobalPosition) was cached at construction and is NOT
      // re-derived under the lock. If another writer advanced the file since we
      // loaded, appending from the stale cursor would duplicate a
      // globalPosition and fork the chain. Detect the advance and fail closed
      // BEFORE computing any chain links.
      this._detectExternalAdvanceUnderLock();

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
      const bytesWritten = this._writeAndSync(lines);

      // Write succeeded — NOW commit in-memory state. From here on there are no
      // throwing operations, so partial commits are impossible.
      this._nextGlobalPosition = nextGlobalPosition;
      this._lastHash = lastHash;
      // Advance our file-size baseline to include the bytes we just wrote, so
      // the NEXT append's external-advance check (A-ES-001) compares against
      // the post-write size rather than re-flagging our own write.
      this._knownFileSize = (this._knownFileSize ?? 0) + bytesWritten;
      for (const stored of storedEvents) {
        stream.push(stored);
        this._globalLog.push(stored);
      }

      // Dispatch to subscribers
      this._dispatch(streamId, storedEvents);

      // Emit after the durable commit + dispatch so globalPosition reflects the
      // committed head. durationMs covers validation → write+fsync → commit.
      this._emit({
        op: "append",
        level: "info",
        outcome: "ok",
        durationMs: Date.now() - appendStart,
        attributes: {
          count: events.length,
          globalPosition: this._nextGlobalPosition - 1,
        },
      });

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

  /**
   * Diagnostics from the most recent load (B-LES-002).
   *
   * When a backing file has torn or structurally-invalid lines, those lines are
   * silently dropped to keep the store openable after an unclean shutdown. This
   * accessor exposes exactly which lines were dropped and why, so an operator
   * inspecting a damaged log does not have to re-parse the file by hand. It is
   * always populated (empty `skips` on a clean load) and is the recovery target
   * referenced by the `LOAD_LINES_SKIPPED` telemetry event.
   */
  get loadDiagnostics(): LoadDiagnostics {
    return this._loadDiagnostics;
  }

  // ─── Integrity ──────────────────────────────────────────────────────

  /**
   * Verify the hash chain integrity of all events in the store.
   */
  verifyIntegrity(): EventStoreIntegrityResult {
    return verifyHashChain(this._globalLog);
  }

  // ─── Internal ───────────────────────────────────────────────────────

  /**
   * Emit a telemetry event tagged with this package. Best-effort: the
   * {@link Telemetry} contract forbids `record` from throwing, but we guard
   * defensively so a misbehaving sink can never break a store operation.
   */
  private _emit(event: Omit<ObservabilityEvent, "package">): void {
    try {
      this._telemetry.record({ package: "@attestia/event-store", ...event });
    } catch {
      // Observability must never break the operation it observes.
    }
  }

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
   *
   * @returns load statistics for observability: number of events loaded, the
   *   number of non-empty lines skipped (corrupt JSON or missing fields), and
   *   per-skip detail (line index + stable reason) for {@link loadDiagnostics}.
   */
  private _loadFromFile(): {
    eventsLoaded: number;
    skippedLines: number;
    skips: LoadSkip[];
  } {
    let eventsLoaded = 0;
    let skippedLines = 0;
    const skips: LoadSkip[] = [];

    if (!existsSync(this._filePath)) {
      this._knownFileSize = undefined;
      return { eventsLoaded, skippedLines, skips };
    }

    // B-LES-007: defensive size guard. The store reads the whole file into
    // memory and indexes every event; an append-only log only grows. Without
    // this check, a log larger than available memory OOM-crashes construction
    // with an opaque V8 allocation error. When maxLoadBytes is set, stat the
    // file first and fail closed with an actionable, structured error.
    if (this._maxLoadBytes !== undefined) {
      let sizeOnDisk: number;
      try {
        sizeOnDisk = statSync(this._filePath).size;
      } catch {
        sizeOnDisk = 0; // Unstattable — fall through to the read path.
      }
      if (sizeOnDisk > this._maxLoadBytes) {
        this._emit({
          op: "load",
          level: "error",
          outcome: "failed",
          attributes: {
            code: "LOG_TOO_LARGE",
            sizeBytes: sizeOnDisk,
            maxLoadBytes: this._maxLoadBytes,
          },
          message: `event log "${basename(this._filePath)}" is ${sizeOnDisk} bytes, exceeding maxLoadBytes ${this._maxLoadBytes}`,
        });
        throw new EventStoreError(
          "LOG_TOO_LARGE",
          `Event log "${basename(this._filePath)}" is ${sizeOnDisk} bytes, which exceeds the configured maxLoadBytes limit of ${this._maxLoadBytes}. The JSONL store loads the entire log into memory; refusing to load to avoid an out-of-memory crash. Raise maxLoadBytes if this size is expected, or migrate to a snapshot-based recovery path.`,
        );
      }
    }

    const content = readFileSync(this._filePath, "utf-8");
    // Record the byte size we just read so a later append can detect whether
    // the file advanced underneath us (A-ES-001). Using Buffer.byteLength keeps
    // this correct for multi-byte UTF-8 content rather than .length (code units).
    this._knownFileSize = Buffer.byteLength(content, "utf-8");
    const lines = content.split("\n");

    // 1-based line index, incremented for EVERY line (including blanks) so the
    // index reported in diagnostics matches what an operator sees in an editor.
    let lineIndex = 0;
    for (const line of lines) {
      lineIndex++;
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      let record: JsonlRecord;
      try {
        record = JSON.parse(trimmed) as JsonlRecord;
      } catch {
        // Corrupt/partial line — skip (crash safety)
        skippedLines++;
        skips.push({ lineIndex, reason: "parse_error" });
        continue;
      }

      // Validate minimum required fields. appendedAt is included (B-LES-008):
      // it feeds the hash chain (hash-chain.ts), so a missing/mistyped
      // appendedAt that survives load surfaces later as a confusing "hash
      // mismatch" instead of the truthful "malformed record". Catch it here.
      if (
        typeof record.streamId !== "string" ||
        typeof record.version !== "number" ||
        typeof record.globalPosition !== "number" ||
        typeof record.appendedAt !== "string" ||
        record.event === undefined
      ) {
        skippedLines++;
        skips.push({ lineIndex, reason: "missing_field" });
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

      eventsLoaded++;
    }

    return { eventsLoaded, skippedLines, skips };
  }

  /**
   * Acquire an exclusive lockfile for concurrent append protection.
   * Uses O_CREAT | O_EXCL to atomically create the lockfile — if it
   * already exists, another process holds the lock.
   *
   * Retries with a short spin-wait for up to 5 seconds before giving up.
   *
   * Guarantees and limits:
   * - GUARANTEED: only one holder of the lock performs the write syscall at a
   *   time, so two processes never interleave bytes in the JSONL file.
   * - NOT guaranteed by the lock alone: that this instance's cached chain
   *   cursor (`_lastHash` / `_nextGlobalPosition`) reflects writes made by
   *   OTHER processes while this instance held nothing. The cursor is cached at
   *   load and only advanced by this instance's own appends. `append()` closes
   *   that gap by calling {@link _detectExternalAdvanceUnderLock} under the
   *   lock and failing closed with CONCURRENCY_CONFLICT if the file grew (see
   *   A-ES-001) — the lock plus that check together prevent forked chains.
   *
   * Stale-lock recovery (B-LES-001): a writer that crashes between acquire and
   * release (kill -9, power loss, unhandled throw) leaves the lockfile behind,
   * which would otherwise deadlock every future append with a permanent
   * LOCK_TIMEOUT — turning one crashed writer into a total write outage. To
   * recover, on EEXIST we read the PID written in the lockfile and probe it with
   * `process.kill(pid, 0)`: if the holder is provably dead (ESRCH) we break the
   * stale lock ONCE and retry the atomic acquire. The break is fail-SAFE:
   * - We only break on a definitively-dead PID. A live holder (kill succeeds),
   *   a permission-denied probe (EPERM — process exists, owned by another user),
   *   or an unreadable/empty/non-numeric PID file keeps the current fail-closed
   *   timeout behavior. We never break a lock we cannot prove is abandoned.
   * - The break itself races: two acquirers can both observe the same dead PID.
   *   We resolve that with the SAME atomic O_CREAT|O_EXCL used for normal
   *   acquisition — after unlinking the stale file, only the acquirer whose
   *   re-create wins proceeds; the loser sees EEXIST again (now held by a LIVE
   *   PID, the winner) and falls back to the timeout path. PID reuse is handled
   *   by this re-acquire: even if a dead PID was recycled, the worst case is we
   *   decline to break (treat as live) — never a false break of a live writer.
   * - We break at most ONCE per acquire call (guarded by `brokeStaleLock`), so a
   *   pathological churn cannot loop us unbounded; a second stale lock within
   *   one acquire falls through to the normal timeout.
   */
  private _acquireLock(): void {
    const maxWaitMs = 5_000;
    const spinMs = 5;
    const lockStart = Date.now();
    const deadline = lockStart + maxWaitMs;
    let contended = false;
    let brokeStaleLock = false;

    while (true) {
      try {
        // O_CREAT | O_EXCL | O_WRONLY — atomic create-or-fail
        const fd = openSync(this._lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        // Write PID for debugging stale locks
        writeFileSync(fd, String(process.pid), "utf-8");
        closeSync(fd);
        this._emit({
          op: "lock.acquire",
          // Promote to debug-with-attribute only when we actually waited; an
          // uncontended acquire is the common case and stays low-noise.
          level: "debug",
          outcome: "ok",
          durationMs: Date.now() - lockStart,
          attributes: { contended, brokeStaleLock },
        });
        return;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw err;
        }
        contended = true;

        // Stale-lock recovery: if the lockfile is held by a provably-dead PID,
        // break it once and retry the atomic acquire. Guarded so we attempt the
        // break at most once per call.
        if (!brokeStaleLock && this._tryBreakStaleLock()) {
          brokeStaleLock = true;
          // Loop immediately and re-attempt the atomic O_CREAT|O_EXCL. The
          // re-create is the race resolver: only one acquirer wins it.
          continue;
        }

        if (Date.now() >= deadline) {
          const holderPid = this._readLockPid();
          const pidDetail = holderPid !== undefined ? ` (held by PID ${holderPid})` : "";
          this._emit({
            op: "lock.acquire",
            level: "error",
            outcome: "failed",
            durationMs: Date.now() - lockStart,
            attributes: {
              contended,
              code: "LOCK_TIMEOUT",
              ...(holderPid !== undefined ? { holderPid } : {}),
            },
            message: `lock acquisition timed out after ${maxWaitMs}ms on ${basename(this._lockPath)}${pidDetail}`,
          });
          // Operability (B-LES-001): tell the operator exactly how to recover.
          // The message names the holder PID (when readable), the absolute
          // lockfile path, and the explicit manual-recovery step — so a stuck
          // append is a 1-second fix, not a mystery to be reverse-engineered.
          const recovery = holderPid !== undefined
            ? `The lockfile names PID ${holderPid}. If that process is NOT running, the lock is stale: delete "${this._lockPath}" to recover. (A dead-PID lock is normally broken automatically; a persisting one means the PID is still alive or the file is unreadable.)`
            : `Could not read a PID from the lockfile. If no writer is running, delete "${this._lockPath}" to recover.`;
          throw new EventStoreError(
            "LOCK_TIMEOUT",
            `Failed to acquire lock on ${this._lockPath} within ${maxWaitMs}ms — another process may be writing. ${recovery}`,
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
   * Read the PID recorded in the lockfile, if any.
   *
   * @returns the integer PID, or `undefined` if the file is missing, empty, or
   *   does not contain a parseable positive integer (e.g. a torn write).
   */
  private _readLockPid(): number | undefined {
    let raw: string;
    try {
      raw = readFileSync(this._lockPath, "utf-8");
    } catch {
      // Lockfile vanished or is unreadable — caller treats as "unknown".
      return undefined;
    }
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      return undefined;
    }
    return pid;
  }

  /**
   * Attempt to break a stale lockfile whose holder PID is provably dead.
   *
   * Reads the PID and probes it with `process.kill(pid, 0)` (sends no signal,
   * only checks existence/permission):
   * - ESRCH → the process does not exist → the lock is stale → unlink it and
   *   return true so the caller retries the atomic acquire.
   * - kill succeeds, EPERM (exists, other-owner), or an unreadable/invalid PID
   *   → keep the lock (fail-closed) and return false.
   *
   * The unlink is best-effort and the subsequent re-acquire is the real race
   * resolver, so two processes both breaking the same stale lock is safe: at
   * most one wins the re-create.
   *
   * @returns true if a stale lock was broken (caller should retry), else false.
   */
  private _tryBreakStaleLock(): boolean {
    const pid = this._readLockPid();
    if (pid === undefined) {
      // No readable PID — refuse to break (could be a torn write by a live
      // writer mid-acquire). Fail-closed.
      return false;
    }

    // Never break our own lock via this path; a self-held lock is not stale.
    if (pid === process.pid) {
      return false;
    }

    let alive: boolean;
    try {
      // Signal 0 performs error checking without sending a signal.
      process.kill(pid, 0);
      alive = true;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        alive = false; // No such process — provably dead.
      } else {
        // EPERM (process exists, owned by another user) or any other error:
        // treat as alive / indeterminate and DO NOT break.
        alive = true;
      }
    }

    if (alive) {
      return false;
    }

    // Provably-dead holder: break the stale lock. Unlink is best-effort; the
    // atomic re-create the caller performs next is what actually resolves the
    // race between concurrent breakers.
    try {
      unlinkSync(this._lockPath);
    } catch {
      // Already removed by a concurrent breaker — fine, the re-acquire decides.
    }
    this._emit({
      op: "lock.break_stale",
      level: "warn",
      outcome: "degraded",
      attributes: { stalePid: pid, code: "LOCK_STALE_BROKEN" },
      message: `broke stale lock on ${basename(this._lockPath)} held by dead PID ${pid}`,
    });
    return true;
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
   * Detect, under the held append lock, whether another writer advanced the
   * on-disk file past the state THIS instance has cached.
   *
   * The lockfile serializes the write syscall, but `_lastHash` /
   * `_nextGlobalPosition` are cached at construction (or after our own last
   * append) and are NOT re-derived from disk under the lock. If a second
   * process appended in between, computing chain links from our stale cursor
   * would write a record that duplicates a globalPosition and forks the chain
   * (A-ES-001). We therefore compare the current file size to the size we last
   * observed: any growth means the file advanced externally.
   *
   * On detection we fail closed with CONCURRENCY_CONFLICT rather than writing a
   * forked record. This instance's in-memory view is stale; the caller should
   * discard it and re-open the store (a fresh load re-derives the cursor from
   * the now-current file). We deliberately do NOT attempt an in-place tail
   * reload here — reconciling externally-authored events into the per-stream /
   * global in-memory indexes mid-append is error-prone, and failing closed is
   * the safe, auditable behavior for a tamper-evident log.
   *
   * @throws EventStoreError("CONCURRENCY_CONFLICT") if the file advanced.
   */
  private _detectExternalAdvanceUnderLock(): void {
    let currentSize: number | undefined;
    try {
      currentSize = statSync(this._filePath).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // File does not exist on disk. If we believed it did (we have a cached
        // size), it was removed/truncated underneath us — treat as an external
        // change rather than silently recreating a divergent file.
        if (this._knownFileSize !== undefined) {
          throw new EventStoreError(
            "CONCURRENCY_CONFLICT",
            `Event log "${basename(this._filePath)}" disappeared since this store was opened — another process may have removed or replaced it. Re-open the store to continue.`,
          );
        }
        return;
      }
      throw err;
    }

    const baseline = this._knownFileSize ?? 0;
    if (currentSize > baseline) {
      this._emit({
        op: "append",
        level: "error",
        outcome: "failed",
        attributes: { code: "CONCURRENCY_CONFLICT", baseline, currentSize },
        message: `external append detected on ${basename(this._filePath)}: file grew from ${baseline} to ${currentSize} bytes since this store loaded`,
      });
      throw new EventStoreError(
        "CONCURRENCY_CONFLICT",
        `Event log "${basename(this._filePath)}" was modified by another writer since this store was opened (file grew from ${baseline} to ${currentSize} bytes). Refusing to append from a stale chain cursor, which would fork the hash chain. Re-open the store to continue.`,
      );
    }
  }

  /**
   * Write data to the JSONL file and fsync for durability.
   *
   * @returns the number of bytes appended, so the caller can advance the
   *   cached {@link _knownFileSize} cursor without a follow-up stat.
   */
  private _writeAndSync(data: string): number {
    const byteLength = Buffer.byteLength(data, "utf-8");
    const fd = openSync(this._filePath, "a");
    try {
      appendFileSync(fd, data, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return byteLength;
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
