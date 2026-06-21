/**
 * Request/Response DTOs with Zod validation schemas.
 *
 * Each DTO has a Zod schema and a derived TypeScript type.
 * Route handlers use these for body/query validation.
 */

import { z } from "zod";

// =============================================================================
// Bounded open-ended records (A-NODE-005)
// =============================================================================

/**
 * Caps for open-ended `z.record(z.unknown())` payloads. Plain
 * `z.record(z.unknown())` accepts unbounded key counts and arbitrarily nested
 * values, which (combined with buffered JSON parsing) is a memory-amplification
 * vector. These caps bound entry count and serialized size while staying well
 * above any legitimate payload.
 */
export const MAX_RECORD_ENTRIES = 1000;
export const MAX_RECORD_SERIALIZED_BYTES = 256 * 1024; // 256 KiB

/**
 * A bounded replacement for `z.record(z.unknown())`.
 *
 * Accepts an arbitrary object value (preserving the previous permissive shape
 * for callers) but rejects records with too many top-level entries or whose
 * JSON serialization exceeds {@link MAX_RECORD_SERIALIZED_BYTES}. The
 * serialized-size check also bounds nesting depth indirectly (deeply nested or
 * sprawling structures blow the byte budget first).
 */
export function boundedRecord(
  maxEntries: number = MAX_RECORD_ENTRIES,
  maxBytes: number = MAX_RECORD_SERIALIZED_BYTES,
): z.ZodType<Record<string, unknown>> {
  return z
    .record(z.unknown())
    .refine((rec) => Object.keys(rec).length <= maxEntries, {
      message: `Record has too many entries (max ${maxEntries})`,
    })
    .refine(
      (rec) => {
        try {
          return Buffer.byteLength(JSON.stringify(rec), "utf-8") <= maxBytes;
        } catch {
          // Non-serializable (e.g. circular) — reject.
          return false;
        }
      },
      { message: `Record exceeds maximum serialized size (${maxBytes} bytes)` },
    ) as z.ZodType<Record<string, unknown>>;
}

// =============================================================================
// Shared Schemas
// =============================================================================

export const MoneySchema = z.object({
  amount: z.string().min(1),
  currency: z.string().min(1),
  decimals: z.number().int().min(0).max(18),
});

export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// =============================================================================
// Intent DTOs
// =============================================================================

export const DeclareIntentSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum([
    "transfer",
    "swap",
    "allocate",
    "deallocate",
    "bridge",
    "stake",
    "unstake",
  ]),
  description: z.string().min(1).max(1024),
  params: z.object({
    fromChainId: z.string().optional(),
    toChainId: z.string().optional(),
    fromAddress: z.string().optional(),
    toAddress: z.string().optional(),
    amount: MoneySchema.optional(),
    receiveToken: z.string().optional(),
    extra: boundedRecord().optional(),
  }),
  envelopeId: z.string().optional(),
});

export type DeclareIntentDto = z.infer<typeof DeclareIntentSchema>;

export const ApproveIntentSchema = z.object({
  reason: z.string().optional(),
});

export type ApproveIntentDto = z.infer<typeof ApproveIntentSchema>;

export const RejectIntentSchema = z.object({
  reason: z.string().min(1),
});

export type RejectIntentDto = z.infer<typeof RejectIntentSchema>;

export const ExecuteIntentSchema = z.object({
  chainId: z.string().min(1),
  txHash: z.string().min(1),
});

export type ExecuteIntentDto = z.infer<typeof ExecuteIntentSchema>;

export const VerifyIntentSchema = z.object({
  matched: z.boolean(),
  discrepancies: z.array(z.string()).optional(),
});

export type VerifyIntentDto = z.infer<typeof VerifyIntentSchema>;

export const ListIntentsQuerySchema = PaginationQuerySchema.extend({
  status: z.string().optional(),
});

export type ListIntentsQuery = z.infer<typeof ListIntentsQuerySchema>;

// =============================================================================
// Event DTOs
// =============================================================================

export const ListEventsQuerySchema = PaginationQuerySchema.extend({
  afterPosition: z.coerce.number().int().min(0).optional(),
});

export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const ListStreamEventsQuerySchema = PaginationQuerySchema.extend({
  afterVersion: z.coerce.number().int().min(0).optional(),
});

export type ListStreamEventsQuery = z.infer<typeof ListStreamEventsQuerySchema>;

// =============================================================================
// Verification DTOs
// =============================================================================

export const ReplayVerifySchema = z.object({
  ledgerSnapshot: boundedRecord(),
  registrumSnapshot: boundedRecord(),
  expectedHash: z.string().optional(),
});

export type ReplayVerifyDto = z.infer<typeof ReplayVerifySchema>;

export const HashVerifySchema = z.object({
  ledgerSnapshot: boundedRecord(),
  registrumSnapshot: boundedRecord(),
  expectedHash: z.string().min(1),
});

export type HashVerifyDto = z.infer<typeof HashVerifySchema>;

// =============================================================================
// Reconciliation DTOs
// =============================================================================

export const ReconcileSchema = z.object({
  intents: z.array(
    z.object({
      id: z.string().max(256),
      status: z.string().max(64),
      kind: z.string().max(128),
      amount: MoneySchema.optional(),
      envelopeId: z.string().max(256).optional(),
      chainId: z.string().max(128).optional(),
      txHash: z.string().max(256).optional(),
      declaredAt: z.string().max(64),
      correlationId: z.string().max(256).optional(),
    }),
  ).max(10000),
  ledgerEntries: z.array(
    z.object({
      id: z.string().max(256),
      accountId: z.string().max(256),
      type: z.enum(["debit", "credit"]),
      money: MoneySchema,
      timestamp: z.string().max(64),
      intentId: z.string().max(256).optional(),
      txHash: z.string().max(256).optional(),
      correlationId: z.string().max(256),
    }),
  ).max(10000),
  chainEvents: z.array(
    z.object({
      chainId: z.string().max(128),
      txHash: z.string().max(256),
      from: z.string().max(256),
      to: z.string().max(256),
      amount: z.string().max(128),
      decimals: z.number(),
      symbol: z.string().max(32),
      timestamp: z.string().max(64),
    }),
  ).max(10000),
  scope: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      intentId: z.string().optional(),
      chainId: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export type ReconcileDto = z.infer<typeof ReconcileSchema>;
