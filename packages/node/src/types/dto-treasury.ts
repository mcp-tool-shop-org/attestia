/**
 * Treasury request/response DTOs with Zod validation schemas.
 *
 * Covers payroll runs, distributions, and dual-gate funding requests. Mirrors
 * the style of {@link ../types/dto.ts} — each DTO has a Zod schema and a derived
 * TypeScript type, and open-ended records use {@link boundedRecord} caps.
 *
 * These schemas validate the SHAPE crossing the API boundary; the Treasury
 * domain enforces the financial invariants (balanced runs, share sums, gate
 * separation). Route handlers delegate to AttestiaService, which forwards to the
 * already-public Treasury methods.
 */

import { z } from "zod";
import { MoneySchema, PaginationQuerySchema } from "./dto.js";

// =============================================================================
// Payroll DTOs
// =============================================================================

/** A single pay component (base salary, bonus, deduction, etc.). */
export const PayComponentSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  type: z.enum([
    "base",
    "bonus",
    "deduction",
    "reimbursement",
    "commission",
    "allowance",
  ]),
  amount: MoneySchema,
  recurring: z.boolean(),
  taxable: z.boolean(),
});

export type PayComponentDto = z.infer<typeof PayComponentSchema>;

/** A pay period — the window a payroll run settles. */
export const PayPeriodSchema = z.object({
  start: z.string().min(1).max(64), // ISO 8601 date
  end: z.string().min(1).max(64), // ISO 8601 date
  label: z.string().min(1).max(128), // e.g. "2025-Q1", "2025-Jan"
});

export type PayPeriodDto = z.infer<typeof PayPeriodSchema>;

/**
 * Create a payroll run. The run is composed from payees and their pay
 * schedules already registered in the treasury; the request only carries the
 * run id and the period it settles.
 */
export const CreatePayrollRunSchema = z.object({
  id: z.string().min(1).max(128),
  period: PayPeriodSchema,
});

export type CreatePayrollRunDto = z.infer<typeof CreatePayrollRunSchema>;

// Note: approve / execute are pure actions (the id is in the URL, no body
// fields), so their routes do NOT run body validation — there is no
// PayrollRunActionSchema. See routes/treasury.ts.

export const ListPayrollRunsQuerySchema = PaginationQuerySchema;

export type ListPayrollRunsQuery = z.infer<typeof ListPayrollRunsQuerySchema>;

// =============================================================================
// Distribution DTOs
// =============================================================================

/**
 * A distribution recipient. `share` is basis points (1/10000th) for
 * proportional/milestone strategies, or a fallback numeric amount for fixed;
 * `amount` is the precision-safe payout for the fixed strategy. Mirrors the
 * Treasury domain's {@link DistributionRecipient} (one of share/amount applies
 * per strategy).
 */
export const DistributionRecipientSchema = z.object({
  payeeId: z.string().min(1).max(256),
  share: z.number().optional(),
  amount: MoneySchema.optional(),
  milestoneMet: z.boolean().optional(),
});

export type DistributionRecipientDto = z.infer<
  typeof DistributionRecipientSchema
>;

/** Create a distribution plan. */
export const CreateDistributionSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  strategy: z.enum(["proportional", "fixed", "milestone"]),
  pool: MoneySchema,
  recipients: z.array(DistributionRecipientSchema).min(1).max(10000),
});

export type CreateDistributionDto = z.infer<typeof CreateDistributionSchema>;

// Note: approve / compute / execute are pure actions (no body) — their routes
// skip body validation. See routes/treasury.ts.

export const ListDistributionsQuerySchema = PaginationQuerySchema;

export type ListDistributionsQuery = z.infer<
  typeof ListDistributionsQuerySchema
>;

// =============================================================================
// Funding Gate DTOs
// =============================================================================

/**
 * Submit a funding request (the first leg of the dual-gate flow).
 *
 * SECURITY (AUTHZ-FUNDING-SOD-BYPASS): the actor is NOT accepted from the body.
 * The requester is bound server-side to the authenticated principal
 * (`c.get("auth").identity`) in the route, so a client cannot forge a distinct
 * requester label to defeat separation of duties. A `requestedBy` field in the
 * body is therefore intentionally absent from this schema (and ignored if sent).
 */
export const SubmitFundingSchema = z.object({
  id: z.string().min(1).max(128),
  description: z.string().min(1).max(1024),
  amount: MoneySchema,
});

export type SubmitFundingDto = z.infer<typeof SubmitFundingSchema>;

/**
 * Approve a funding gate. Only an optional reason is supplied.
 *
 * SECURITY (AUTHZ-FUNDING-SOD-BYPASS): the approver is NOT accepted from the
 * body — it is bound server-side to `c.get("auth").identity`. Trusting a
 * client-chosen `approvedBy` let a single key forge two distinct approvers and
 * defeat dual control, with the forged approver recorded in the audit log.
 */
export const ApproveFundingGateSchema = z.object({
  reason: z.string().max(1024).optional(),
});

export type ApproveFundingGateDto = z.infer<typeof ApproveFundingGateSchema>;

/**
 * Reject a funding request. Only an optional reason is supplied.
 *
 * SECURITY (AUTHZ-FUNDING-SOD-BYPASS): the rejector is bound server-side to
 * `c.get("auth").identity`, not read from the body.
 */
export const RejectFundingSchema = z.object({
  reason: z.string().max(1024).optional(),
});

export type RejectFundingDto = z.infer<typeof RejectFundingSchema>;

// Note: execute is a pure action (no body) — its route skips body validation.
// See routes/treasury.ts.

export const ListFundingRequestsQuerySchema = PaginationQuerySchema;

export type ListFundingRequestsQuery = z.infer<
  typeof ListFundingRequestsQuerySchema
>;
