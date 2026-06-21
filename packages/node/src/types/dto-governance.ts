/**
 * Governance request DTOs with Zod validation schemas.
 *
 * Covers the per-tenant multi-sig governance store: add/remove signer and
 * change quorum. The current-policy read carries no body. Mirrors the style of
 * {@link ../types/dto.ts}.
 *
 * Governance mutations are privileged (require the "admin" permission), so the
 * route layer guards them with `requirePermission("admin")` rather than
 * "write".
 */

import { z } from "zod";

// =============================================================================
// Signer DTOs
// =============================================================================

/**
 * Add a signer to the governance policy. `address` is an XRPL r-address;
 * `publicKey` (hex), when present, is cryptographically bound to the address by
 * the domain (it must derive to `address`, or the domain rejects it).
 */
export const AddSignerSchema = z.object({
  address: z.string().min(1).max(256),
  label: z.string().min(1).max(256),
  weight: z.number().int().min(1).max(1_000_000).optional(),
  publicKey: z.string().min(1).max(256).optional(),
});

export type AddSignerDto = z.infer<typeof AddSignerSchema>;

/** Remove a signer from the governance policy. */
export const RemoveSignerSchema = z.object({
  address: z.string().min(1).max(256),
});

export type RemoveSignerDto = z.infer<typeof RemoveSignerSchema>;

// =============================================================================
// Quorum DTO
// =============================================================================

/** Change the quorum threshold (total signer weight required to approve). */
export const ChangeQuorumSchema = z.object({
  quorum: z.number().int().min(1).max(1_000_000),
});

export type ChangeQuorumDto = z.infer<typeof ChangeQuorumSchema>;
