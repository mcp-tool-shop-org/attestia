/**
 * @attestia/event-store — Snapshot Store.
 *
 * Provides interfaces and implementations for snapshot persistence.
 *
 * Snapshots are point-in-time captures of aggregate state.
 * Combined with event sourcing, they enable efficient startup:
 * 1. Load latest snapshot (if any)
 * 2. Replay only events after the snapshot version
 * 3. State is fully reconstructed
 *
 * Design principles:
 * - Snapshots are supplementary — the event log is the source of truth
 * - Snapshots can be deleted without data loss (just slower startup)
 * - Each snapshot tracks which event version it was taken at
 * - Multiple snapshots per stream are allowed; old ones are pruned via
 *   {@link SnapshotStore.prune} (or automatically when `maxSnapshotsPerStream`
 *   is configured on {@link FileSnapshotStore})
 * - Each snapshot includes a stateHash for integrity verification, and the
 *   stores verify it on load by default (fail-closed) — see `verifyOnLoad`
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import type { Telemetry, ObservabilityEvent } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";

// =============================================================================
// Types
// =============================================================================

/**
 * Compute a SHA-256 hash of the canonical JSON representation of a state.
 */
export function computeSnapshotHash(state: unknown): string {
  const canonical = canonicalize(state);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * A stored snapshot with metadata.
 */
export interface StoredSnapshot<TState = unknown> {
  /** The stream this snapshot belongs to */
  readonly streamId: string;

  /** The event version this snapshot was taken at */
  readonly version: number;

  /** The serialized aggregate state */
  readonly state: TState;

  /** When this snapshot was taken */
  readonly createdAt: string;

  /** SHA-256 hash of the canonical state (for integrity verification) */
  readonly stateHash: string;

  /** Hash algorithm used for stateHash. Default: "sha256". */
  readonly hashAlgorithm?: string;
}

/**
 * Options for saving a snapshot.
 */
export interface SaveSnapshotOptions {
  /** The stream this snapshot belongs to */
  readonly streamId: string;

  /** The event version this snapshot was taken at */
  readonly version: number;

  /** The aggregate state to snapshot */
  readonly state: unknown;
}

/**
 * Verify that a snapshot's stateHash matches its state.
 *
 * @returns true if the hash is valid, false if tampered or missing
 */
export function verifySnapshotIntegrity(snapshot: StoredSnapshot): boolean {
  if (snapshot.stateHash === undefined || snapshot.stateHash === "") {
    return false;
  }
  const expected = computeSnapshotHash(snapshot.state);
  return snapshot.stateHash === expected;
}

/**
 * Options for {@link SnapshotStore.prune}.
 */
export interface PruneOptions {
  /**
   * Number of most-recent (highest-version) snapshots to retain per stream.
   * Must be >= 1. Older snapshots beyond this count are deleted.
   */
  readonly keep: number;
}

/**
 * Result of a {@link SnapshotStore.prune} call.
 */
export interface PruneResult {
  /** Number of snapshots deleted. */
  readonly deleted: number;
  /** Number of snapshots retained. */
  readonly kept: number;
}

/**
 * Snapshot store interface.
 *
 * Provides CRUD operations for snapshots. Implementations can use
 * in-memory storage, file system, or database.
 */
export interface SnapshotStore {
  /**
   * Save a snapshot.
   *
   * Overwrites any existing snapshot for the same stream at the same version.
   */
  save(options: SaveSnapshotOptions): void;

  /**
   * Load the latest snapshot for a stream.
   *
   * @returns The most recent snapshot, or undefined if none exists
   */
  load(streamId: string): StoredSnapshot | undefined;

  /**
   * Load a snapshot at a specific version.
   *
   * @returns The snapshot at that version, or undefined if none exists
   */
  loadAtVersion(streamId: string, version: number): StoredSnapshot | undefined;

  /**
   * Delete all snapshots for a stream.
   */
  deleteAll(streamId: string): void;

  /**
   * Prune old snapshots for a stream, retaining the N highest versions.
   *
   * Snapshots are supplementary to the event log, so pruning never loses data —
   * it bounds disk use and keeps load cost from growing without limit
   * (B-LES-006). Retains the `keep` most-recent (highest-version) snapshots and
   * deletes the rest.
   *
   * @param streamId - The stream to prune.
   * @param options - Retention policy (`keep` >= 1).
   * @returns Counts of deleted and kept snapshots.
   */
  prune(streamId: string, options: PruneOptions): PruneResult;

  /**
   * Check if any snapshot exists for a stream.
   */
  hasSnapshot(streamId: string): boolean;
}

// =============================================================================
// In-Memory Implementation
// =============================================================================

/**
 * Options for {@link InMemorySnapshotStore} and {@link FileSnapshotStore}.
 */
export interface SnapshotStoreOptions {
  /**
   * Verify each snapshot's `stateHash` against its `state` on load, failing
   * closed (treating a mismatch as corruption: `load`/`loadAtVersion` return
   * `undefined` and a telemetry `warn` is emitted) (B-LES-005).
   *
   * @default true
   */
  readonly verifyOnLoad?: boolean;

  /**
   * Optional telemetry sink (B-LES-009). When provided, the store emits
   * structured {@link Telemetry} events (package `"@attestia/event-store"`) at
   * snapshot save, load hit/miss, integrity-fail, corrupt-read, and prune.
   * Emission is best-effort and never affects store behavior.
   *
   * @default NOOP_TELEMETRY (no events emitted)
   */
  readonly telemetry?: Telemetry;
}

/**
 * Shared telemetry helper: emit an event tagged with this package. Best-effort
 * — the {@link Telemetry} contract forbids `record` from throwing, but we guard
 * defensively so a misbehaving sink can never break a store operation.
 */
function emitSnapshot(
  telemetry: Telemetry,
  event: Omit<ObservabilityEvent, "package">,
): void {
  try {
    telemetry.record({ package: "@attestia/event-store", ...event });
  } catch {
    // Observability must never break the operation it observes.
  }
}

/**
 * In-memory snapshot store.
 *
 * Stores snapshots in a Map. Suitable for tests and development.
 */
export class InMemorySnapshotStore implements SnapshotStore {
  /** streamId → version-sorted snapshots */
  private readonly _snapshots = new Map<string, StoredSnapshot[]>();

  private readonly _verifyOnLoad: boolean;
  private readonly _telemetry: Telemetry;

  constructor(options?: SnapshotStoreOptions) {
    this._verifyOnLoad = options?.verifyOnLoad ?? true;
    this._telemetry = options?.telemetry ?? NOOP_TELEMETRY;
  }

  save(options: SaveSnapshotOptions): void {
    let snapshots = this._snapshots.get(options.streamId);
    if (snapshots === undefined) {
      snapshots = [];
      this._snapshots.set(options.streamId, snapshots);
    }

    // Remove existing snapshot at same version (if any)
    const existingIndex = snapshots.findIndex(
      (s) => s.version === options.version,
    );
    if (existingIndex >= 0) {
      snapshots.splice(existingIndex, 1);
    }

    const snapshot: StoredSnapshot = {
      streamId: options.streamId,
      version: options.version,
      state: options.state,
      createdAt: new Date().toISOString(),
      stateHash: computeSnapshotHash(options.state),
      hashAlgorithm: "sha256",
    };

    // Insert sorted by version
    const insertIndex = snapshots.findIndex(
      (s) => s.version > options.version,
    );
    if (insertIndex >= 0) {
      snapshots.splice(insertIndex, 0, snapshot);
    } else {
      snapshots.push(snapshot);
    }

    emitSnapshot(this._telemetry, {
      op: "snapshot.save",
      level: "info",
      outcome: "ok",
      attributes: { version: options.version },
    });
  }

  load(streamId: string): StoredSnapshot | undefined {
    const snapshots = this._snapshots.get(streamId);
    if (snapshots === undefined || snapshots.length === 0) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "debug",
        outcome: "ok",
        attributes: { hit: false },
      });
      return undefined;
    }
    // Return the last (highest version) snapshot
    return this._verified(snapshots[snapshots.length - 1]);
  }

  loadAtVersion(
    streamId: string,
    version: number,
  ): StoredSnapshot | undefined {
    const snapshots = this._snapshots.get(streamId);
    if (snapshots === undefined) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "debug",
        outcome: "ok",
        attributes: { hit: false },
      });
      return undefined;
    }
    return this._verified(snapshots.find((s) => s.version === version));
  }

  deleteAll(streamId: string): void {
    this._snapshots.delete(streamId);
  }

  prune(streamId: string, options: PruneOptions): PruneResult {
    if (!Number.isInteger(options.keep) || options.keep < 1) {
      throw new TypeError(
        `prune keep must be an integer >= 1, got ${options.keep}`,
      );
    }
    const snapshots = this._snapshots.get(streamId);
    if (snapshots === undefined || snapshots.length <= options.keep) {
      return { deleted: 0, kept: snapshots?.length ?? 0 };
    }
    // snapshots are kept version-sorted ascending; drop the oldest (front).
    const deleteCount = snapshots.length - options.keep;
    snapshots.splice(0, deleteCount);
    emitSnapshot(this._telemetry, {
      op: "snapshot.prune",
      level: "info",
      outcome: "ok",
      attributes: { deleted: deleteCount, kept: snapshots.length },
    });
    return { deleted: deleteCount, kept: snapshots.length };
  }

  hasSnapshot(streamId: string): boolean {
    const snapshots = this._snapshots.get(streamId);
    return snapshots !== undefined && snapshots.length > 0;
  }

  /**
   * Apply the fail-closed integrity check (B-LES-005): when `verifyOnLoad` is
   * on, a snapshot whose stateHash does not match its state is treated as
   * corruption — returns undefined and emits a `warn` rather than handing back a
   * tampered recovery baseline.
   */
  private _verified(
    snapshot: StoredSnapshot | undefined,
  ): StoredSnapshot | undefined {
    if (snapshot === undefined) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "debug",
        outcome: "ok",
        attributes: { hit: false },
      });
      return undefined;
    }
    if (this._verifyOnLoad && !verifySnapshotIntegrity(snapshot)) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "warn",
        outcome: "degraded",
        attributes: {
          hit: false,
          version: snapshot.version,
          code: "SNAPSHOT_INTEGRITY_FAILED",
        },
        message: `snapshot integrity check failed for stream version ${snapshot.version}; rejecting as corrupt (pass verifyOnLoad: false to override for recovery)`,
      });
      return undefined;
    }
    emitSnapshot(this._telemetry, {
      op: "snapshot.load",
      level: "debug",
      outcome: "ok",
      attributes: { hit: true, version: snapshot.version },
    });
    return snapshot;
  }
}

// =============================================================================
// File-Based Implementation
// =============================================================================

/**
 * File-based snapshot store.
 *
 * Stores each snapshot as a JSON file in a directory structure:
 *   <baseDir>/<streamId>/<version>.json
 *
 * Suitable for development and small-scale production use.
 */

/**
 * Options for {@link FileSnapshotStore}. Extends the shared snapshot-store
 * options with a file-specific auto-prune control.
 */
export interface FileSnapshotStoreOptions extends SnapshotStoreOptions {
  /**
   * When set, {@link FileSnapshotStore.save} automatically prunes the stream to
   * at most this many most-recent snapshots after each save (B-LES-006). Bounds
   * disk use and keeps load cost from growing without limit. Must be >= 1.
   *
   * @default undefined (no auto-prune; call {@link FileSnapshotStore.prune}
   *   manually)
   */
  readonly maxSnapshotsPerStream?: number;
}

export class FileSnapshotStore implements SnapshotStore {
  private readonly _baseDir: string;
  private readonly _verifyOnLoad: boolean;
  private readonly _telemetry: Telemetry;
  private readonly _maxSnapshotsPerStream: number | undefined;

  /**
   * @param baseDir - Directory the snapshots are stored under.
   * @param options - Optional behavior: `verifyOnLoad` (default true; fail
   *   closed on a stateHash mismatch), `telemetry` (default NOOP), and
   *   `maxSnapshotsPerStream` (when set, `save` auto-prunes to this many).
   */
  constructor(baseDir: string, options?: FileSnapshotStoreOptions) {
    this._baseDir = baseDir;
    this._verifyOnLoad = options?.verifyOnLoad ?? true;
    this._telemetry = options?.telemetry ?? NOOP_TELEMETRY;
    const max = options?.maxSnapshotsPerStream;
    if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
      throw new TypeError(
        `maxSnapshotsPerStream must be an integer >= 1, got ${max}`,
      );
    }
    this._maxSnapshotsPerStream = max;
    mkdirSync(this._baseDir, { recursive: true });
  }

  save(options: SaveSnapshotOptions): void {
    const dir = this._streamDir(options.streamId);
    mkdirSync(dir, { recursive: true });

    const snapshot: StoredSnapshot = {
      streamId: options.streamId,
      version: options.version,
      state: options.state,
      createdAt: new Date().toISOString(),
      stateHash: computeSnapshotHash(options.state),
      hashAlgorithm: "sha256",
    };

    const filePath = this._snapshotPath(options.streamId, options.version);
    const serialized = JSON.stringify(snapshot, null, 2);

    // B-LES-004: write atomically — temp file + fsync + rename — so a crash or
    // disk-full mid-write can never leave a torn JSON file at the canonical
    // snapshot path (which would silently fall back to full event replay on next
    // load). rename() is atomic for same-directory targets on POSIX and NTFS.
    const tmpPath = `${filePath}.tmp`;
    const fd = openSync(tmpPath, "w");
    try {
      writeFileSync(fd, serialized, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, filePath);

    emitSnapshot(this._telemetry, {
      op: "snapshot.save",
      level: "info",
      outcome: "ok",
      attributes: {
        version: options.version,
        bytes: Buffer.byteLength(serialized, "utf-8"),
      },
    });

    // B-LES-006: optional auto-prune so a long-lived stream's snapshot
    // directory cannot grow without bound.
    if (this._maxSnapshotsPerStream !== undefined) {
      this.prune(options.streamId, { keep: this._maxSnapshotsPerStream });
    }
  }

  load(streamId: string): StoredSnapshot | undefined {
    const versions = this._listVersions(streamId);
    if (versions.length === 0) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "debug",
        outcome: "ok",
        attributes: { hit: false },
      });
      return undefined;
    }

    // Latest version is the highest number
    const latestVersion = versions[versions.length - 1]!;
    return this._readSnapshot(streamId, latestVersion);
  }

  loadAtVersion(
    streamId: string,
    version: number,
  ): StoredSnapshot | undefined {
    return this._readSnapshot(streamId, version);
  }

  deleteAll(streamId: string): void {
    const dir = this._streamDir(streamId);
    if (!existsSync(dir)) {
      return;
    }

    const files = readdirSync(dir);
    for (const file of files) {
      unlinkSync(join(dir, file));
    }
  }

  prune(streamId: string, options: PruneOptions): PruneResult {
    if (!Number.isInteger(options.keep) || options.keep < 1) {
      throw new TypeError(
        `prune keep must be an integer >= 1, got ${options.keep}`,
      );
    }
    const versions = this._listVersions(streamId); // ascending
    if (versions.length <= options.keep) {
      return { deleted: 0, kept: versions.length };
    }
    const toDelete = versions.slice(0, versions.length - options.keep);
    let deleted = 0;
    for (const version of toDelete) {
      try {
        unlinkSync(this._snapshotPath(streamId, version));
        deleted++;
      } catch {
        // Already gone (concurrent prune / manual cleanup) — count only real
        // deletions so the result reflects what this call removed.
      }
    }
    const kept = versions.length - deleted;
    emitSnapshot(this._telemetry, {
      op: "snapshot.prune",
      level: "info",
      outcome: "ok",
      attributes: { deleted, kept },
    });
    return { deleted, kept };
  }

  hasSnapshot(streamId: string): boolean {
    const versions = this._listVersions(streamId);
    return versions.length > 0;
  }

  /** Get the base directory for this store */
  get baseDir(): string {
    return this._baseDir;
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private _streamDir(streamId: string): string {
    // Use hash to avoid sanitization collisions (e.g. "a:b" vs "a/b")
    const safe = createHash("sha256").update(streamId).digest("hex").slice(0, 32);
    return join(this._baseDir, safe);
  }

  private _snapshotPath(streamId: string, version: number): string {
    return join(this._streamDir(streamId), `${version}.json`);
  }

  private _listVersions(streamId: string): number[] {
    const dir = this._streamDir(streamId);
    if (!existsSync(dir)) {
      return [];
    }

    const files = readdirSync(dir);
    const versions: number[] = [];

    for (const file of files) {
      const match = file.match(/^(\d+)\.json$/);
      if (match !== null) {
        versions.push(Number(match[1]));
      }
    }

    return versions.sort((a, b) => a - b);
  }

  private _readSnapshot(
    streamId: string,
    version: number,
  ): StoredSnapshot | undefined {
    const filePath = this._snapshotPath(streamId, version);
    if (!existsSync(filePath)) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "debug",
        outcome: "ok",
        attributes: { hit: false, version },
      });
      return undefined;
    }

    let parsed: Record<string, unknown>;
    try {
      const content = readFileSync(filePath, "utf-8");
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // B-LES-009: a corrupt/torn snapshot file that fails to parse is silently
      // discarded (fallback to replay) — make it observable so the broken
      // checkpoint layer is not invisible.
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "warn",
        outcome: "degraded",
        attributes: { hit: false, version, code: "SNAPSHOT_PARSE_FAILED" },
        message: `snapshot file for version ${version} failed to parse; discarding (falling back to event replay)`,
      });
      return undefined;
    }

    // Validate required fields
    if (
      typeof parsed.streamId !== "string" ||
      typeof parsed.version !== "number" ||
      typeof parsed.stateHash !== "string" ||
      parsed.state === undefined
    ) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "warn",
        outcome: "degraded",
        attributes: { hit: false, version, code: "SNAPSHOT_MALFORMED" },
        message: `snapshot file for version ${version} is missing required fields; discarding`,
      });
      return undefined;
    }

    const snapshot = parsed as unknown as StoredSnapshot;

    // B-LES-005: fail closed on a tampered/corrupted-but-parseable snapshot.
    // Without this, a snapshot whose state was altered (but still valid JSON
    // with the required fields) would be silently adopted as the recovery
    // baseline, and subsequent events would chain against bad state invisibly.
    if (this._verifyOnLoad && !verifySnapshotIntegrity(snapshot)) {
      emitSnapshot(this._telemetry, {
        op: "snapshot.load",
        level: "warn",
        outcome: "degraded",
        attributes: {
          hit: false,
          version,
          code: "SNAPSHOT_INTEGRITY_FAILED",
        },
        message: `snapshot integrity check failed for version ${version}; rejecting as corrupt (pass verifyOnLoad: false to override for recovery)`,
      });
      return undefined;
    }

    emitSnapshot(this._telemetry, {
      op: "snapshot.load",
      level: "debug",
      outcome: "ok",
      attributes: { hit: true, version },
    });
    return snapshot;
  }
}
