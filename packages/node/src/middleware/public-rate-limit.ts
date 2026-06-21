/**
 * Public rate limiting middleware — token bucket per IP address.
 *
 * Stricter than the authenticated rate limiter.
 * Uses IP address as the bucket key. No auth context required — runs before
 * auth middleware.
 *
 * IP source (A-NODE-004): `X-Forwarded-For` is spoofable by any client, so it
 * is only trusted when the deployment explicitly opts in via a trusted-proxy
 * flag (the service really does sit behind a reverse proxy that overwrites the
 * header). Otherwise the socket/connection remote address is used so an
 * attacker cannot evade the per-IP limit by rotating a forged header.
 */

import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { AppEnv } from "../types/api-contract.js";
import { createErrorEnvelope } from "../types/error.js";
import { TokenBucketStore } from "./rate-limit.js";
import type { RateLimitConfig } from "./rate-limit.js";

// =============================================================================
// Default Config
// =============================================================================

/**
 * Default public rate limit: 10 requests per minute, burst of 5.
 * Much stricter than authenticated API rate limits.
 */
export const PUBLIC_RATE_LIMIT_DEFAULT: RateLimitConfig = {
  rpm: 10,
  burst: 5,
};

// =============================================================================
// Options
// =============================================================================

export interface PublicRateLimitOptions {
  /**
   * Trust the `X-Forwarded-For` header for the client IP.
   *
   * Default: false. Only enable this when the service genuinely runs behind a
   * trusted reverse proxy that sets/overwrites `X-Forwarded-For`. When false,
   * the header is ignored entirely and the socket remote address is used, so a
   * direct client cannot spoof its bucket key to bypass the limit.
   */
  readonly trustProxy?: boolean;
}

// =============================================================================
// IP Extraction
// =============================================================================

/**
 * Resolve the socket/connection remote address for the request.
 *
 * Falls back to a stable "unknown" key when the runtime does not expose a
 * remote address (e.g. the in-memory `app.request()` path used by tests).
 */
function socketRemoteAddress(c: Parameters<MiddlewareHandler<AppEnv>>[0]): string {
  try {
    const info = getConnInfo(c);
    const address = info.remote.address;
    if (address) return address;
  } catch {
    // Runtime without socket access (tests / non-node adapters) — fall through.
  }
  return "unknown";
}

/**
 * Extract the client IP used as the rate-limit bucket key.
 *
 * - When `trustProxy` is true: use the first hop of `X-Forwarded-For` if
 *   present, else the socket remote address.
 * - When `trustProxy` is false (default): ignore `X-Forwarded-For` entirely and
 *   use the socket remote address. This prevents header-spoofing evasion.
 */
function extractClientIp(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      // X-Forwarded-For can be "client, proxy1, proxy2" — take first hop.
      const first = forwarded.split(",")[0];
      if (first && first.trim() !== "") return first.trim();
    }
  }
  return socketRemoteAddress(c);
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Create public rate limiting middleware.
 *
 * Does NOT require auth context — uses IP address as the bucket key.
 * Returns 429 with Retry-After header when the bucket is empty.
 */
export function publicRateLimitMiddleware(
  store: TokenBucketStore,
  options?: PublicRateLimitOptions,
): MiddlewareHandler<AppEnv> {
  const trustProxy = options?.trustProxy ?? false;
  return async (c, next) => {
    const ip = extractClientIp(c, trustProxy);
    const result = store.consume(ip);

    c.header("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        createErrorEnvelope(
          "RATE_LIMITED",
          `Public rate limit exceeded. Retry after ${retryAfterSec} seconds.`,
        ),
        429,
      );
    }

    return next();
  };
}
