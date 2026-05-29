/**
 * Structured reconciliation discrepancies (D4-B-002).
 *
 * Historically a reconciliation mismatch was carried only as free-form prose
 * in `string[]` — readable by humans, opaque to machines. A consumer that
 * wanted to alert on "currency mismatches only", route AMOUNT_MISMATCH to a
 * different runbook than MISSING_CHAIN, or chart discrepancy counts by class
 * had to regex the prose. That is brittle and breaks the moment wording
 * changes.
 *
 * A {@link Discrepancy} is the machine-readable companion: a stable `code`
 * (the class of problem), a `dimension` (what aspect of the records disagreed),
 * optional `expected` / `actual` values (already formatted, decimal-safe
 * strings — never raw bigints), and the same human `message` the prose carried.
 * Matchers emit these alongside (not instead of) the prose `string[]`, so every
 * existing consumer keeps working while new consumers get structure for free.
 *
 * Design rules (inherited from `@attestia/types`):
 * - `code` and `dimension` are low-cardinality enums (safe as metric labels).
 * - `expected` / `actual` are formatted display strings, not raw values.
 * - `message` is the human-readable detail; it is NOT a metric label.
 */

/**
 * The class of a reconciliation discrepancy. Stable, low-cardinality, and safe
 * to use as a metric label or alert-routing key. The list is open by design
 * (the `(string & {})` arm) so a future matcher can introduce a new code
 * without a breaking type change to consumers that switch on the known ones.
 */
export type DiscrepancyCode =
  | "AMOUNT_MISMATCH"     // both sides present, amounts differ
  | "CURRENCY_MISMATCH"   // both sides present, currencies/symbols differ
  | "DECIMALS_MISMATCH"   // amounts agree in value but decimal bases differ
  | "MISSING_LEDGER"      // intent/chain side exists but no ledger entry
  | "MISSING_CHAIN"       // intent/ledger side exists but no on-chain event
  | "MISSING_INTENT"      // ledger/chain side exists but no declared intent
  // Open enum: a new matcher may emit a code not yet enumerated here.
  | (string & {});

/**
 * Which aspect of the two records disagreed. Coarser than {@link DiscrepancyCode}
 * (many codes share a dimension) and useful for high-level rollups, e.g.
 * "how many discrepancies were about money vs. about a record being absent".
 */
export type DiscrepancyDimension =
  | "amount"
  | "currency"
  | "decimals"
  | "presence";

/**
 * A single structured reconciliation discrepancy.
 *
 * `expected` / `actual` are present when the discrepancy compares two concrete
 * values (an AMOUNT_MISMATCH carries both formatted amounts; a CURRENCY_MISMATCH
 * carries both symbols). They are omitted for presence problems where one side
 * simply does not exist.
 */
export interface Discrepancy {
  /** The class of problem (stable, low-cardinality). */
  readonly code: DiscrepancyCode;
  /** Which aspect disagreed (coarse rollup axis). */
  readonly dimension: DiscrepancyDimension;
  /** The expected value, formatted for display (decimal-safe string). */
  readonly expected?: string;
  /** The actual/observed value, formatted for display (decimal-safe string). */
  readonly actual?: string;
  /** Human-readable detail. Mirrors the legacy prose discrepancy string. */
  readonly message: string;
}

/**
 * Build a {@link Discrepancy}, omitting `expected` / `actual` when not provided
 * so the object stays clean under `exactOptionalPropertyTypes`. The returned
 * `message` is also what callers push onto the legacy prose `string[]`, keeping
 * the two representations in lockstep.
 */
export function makeDiscrepancy(
  code: DiscrepancyCode,
  dimension: DiscrepancyDimension,
  message: string,
  values?: { expected?: string; actual?: string },
): Discrepancy {
  return {
    code,
    dimension,
    message,
    ...(values?.expected !== undefined ? { expected: values.expected } : {}),
    ...(values?.actual !== undefined ? { actual: values.actual } : {}),
  };
}

/**
 * Aggregate a flat list of discrepancies into per-{@link DiscrepancyCode} counts.
 * The result is a plain record suitable for emitting as metric series or
 * rendering in a summary. Codes that never occur are simply absent (no zero
 * entries), so the map size reflects the distinct classes actually seen.
 */
export function countByCode(
  discrepancies: readonly Discrepancy[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const d of discrepancies) {
    counts[d.code] = (counts[d.code] ?? 0) + 1;
  }
  return counts;
}
