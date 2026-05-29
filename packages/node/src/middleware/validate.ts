/**
 * Zod validation middleware.
 *
 * Validates request body against a Zod schema.
 * Returns 400 with error envelope on validation failure.
 */

import type { MiddlewareHandler } from "hono";
import type { ZodSchema, ZodError } from "zod";
import type { AppEnv } from "../types/api-contract.js";
import { createErrorEnvelope } from "../types/error.js";

/**
 * Validate JSON request body against a Zod schema.
 *
 * On success, sets `validatedBody` in context variables.
 * On failure, returns 400 with structured validation errors.
 */
export function validateBody<T>(
  schema: ZodSchema<T>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        createErrorEnvelope("VALIDATION_ERROR", "Invalid JSON in request body"),
        400,
      );
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json(
        createErrorEnvelope(
          "VALIDATION_ERROR",
          "Request body validation failed",
          "Check the listed field issues and resubmit with a valid body.",
          { issues: formatZodErrors(result.error) },
        ),
        400,
      );
    }

    c.set("validatedBody", result.data);
    return next();
  };
}

function formatZodErrors(
  error: ZodError,
): readonly { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
