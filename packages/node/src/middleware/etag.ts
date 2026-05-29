/**
 * ETag utilities for optimistic concurrency on intent state transitions.
 *
 * Generates ETags from entity state and validates If-Match headers.
 */

import { createHash } from "node:crypto";
import type { Context } from "hono";
import { createErrorEnvelope } from "../types/error.js";

/**
 * Compute an ETag for a JSON-serializable object.
 */
export function computeETag(obj: unknown): string {
  const json = JSON.stringify(obj);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return `"${hash}"`;
}

/**
 * Check If-Match header against current entity ETag.
 * Returns error response if mismatch, or undefined to continue.
 */
export function checkIfMatch(
  c: Context,
  entity: unknown,
): Response | undefined {
  const ifMatch = c.req.header("If-Match");
  if (ifMatch === undefined) {
    return undefined;
  }

  const currentETag = computeETag(entity);
  if (ifMatch !== currentETag) {
    return c.json(
      createErrorEnvelope(
        "PRECONDITION_FAILED",
        "If-Match header does not match current entity state",
        "Re-fetch the resource to get its current ETag, then retry with that value in If-Match.",
        { currentETag },
      ),
      412,
    );
  }

  return undefined;
}

/**
 * Set ETag header on the response for the given entity.
 */
export function setETag(c: Context, entity: unknown): void {
  c.header("ETag", computeETag(entity));
}
