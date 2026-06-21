/**
 * Vault budget / portfolio request DTOs with Zod validation schemas.
 *
 * Covers envelope creation + allocation. The budget and portfolio reads carry
 * no body; the list endpoint reuses the shared pagination query. Mirrors the
 * style of {@link ../types/dto.ts}.
 */

import { z } from "zod";
import { MoneySchema, PaginationQuerySchema } from "./dto.js";

// =============================================================================
// Envelope DTOs
// =============================================================================

/** Create a budget envelope. */
export const CreateEnvelopeSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  category: z.string().max(128).optional(),
});

export type CreateEnvelopeDto = z.infer<typeof CreateEnvelopeSchema>;

/** Allocate funds into an existing envelope. */
export const AllocateEnvelopeSchema = z.object({
  amount: MoneySchema,
});

export type AllocateEnvelopeDto = z.infer<typeof AllocateEnvelopeSchema>;

export const ListEnvelopesQuerySchema = PaginationQuerySchema;

export type ListEnvelopesQuery = z.infer<typeof ListEnvelopesQuerySchema>;
