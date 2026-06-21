/**
 * Authentication middleware.
 *
 * Supports two strategies:
 * 1. API key via X-Api-Key header → looked up in the configured key registry
 * 2. JWT bearer token via Authorization header → HMAC-SHA256 signature verify
 *
 * On success, sets `c.set("auth", authContext)`.
 * On failure, returns 401 or 403.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/api-contract.js";
import type {
  AuthContext,
  Role,
  Permission,
  ApiKeyRecord,
  JwtClaims,
} from "../types/auth.js";
import { hasPermission } from "../types/auth.js";
import { createErrorEnvelope } from "../types/error.js";

// =============================================================================
// Auth Middleware
// =============================================================================

export interface AuthConfig {
  /** Map of API key → record */
  readonly apiKeys: ReadonlyMap<string, ApiKeyRecord>;
  /** JWT HMAC secret (if JWT auth is enabled) */
  readonly jwtSecret?: string | undefined;
  /** Expected JWT issuer */
  readonly jwtIssuer?: string | undefined;
  /**
   * Optional server-side role validator for JWT claims.
   * Called after signature verification to check claims against a
   * server-side registry (e.g., verify tenant membership, check revocation).
   * Return false to reject the token.
   */
  readonly roleValidator?: ((claims: JwtClaims) => boolean) | undefined;
}

/**
 * Create authentication middleware.
 *
 * Tries X-Api-Key first, then Authorization: Bearer.
 * Returns 401 if neither is present or valid.
 */
export function authMiddleware(config: AuthConfig): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let auth: AuthContext | undefined;

    // Strategy 1: API Key
    const apiKey = c.req.header("X-Api-Key");
    if (apiKey !== undefined) {
      const record = config.apiKeys.get(apiKey);
      if (record === undefined) {
        return c.json(
          createErrorEnvelope("UNAUTHORIZED", "Invalid API key"),
          401,
        );
      }
      auth = {
        type: "api-key",
        identity: record.key,
        role: record.role,
        tenantId: record.tenantId,
      };
    }

    // Strategy 2: JWT Bearer
    if (auth === undefined) {
      const authHeader = c.req.header("Authorization");
      if (authHeader !== undefined && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        if (config.jwtSecret === undefined) {
          return c.json(
            createErrorEnvelope("UNAUTHORIZED", "JWT authentication not configured"),
            401,
          );
        }
        const claims = verifyJwt(token, config.jwtSecret, config.jwtIssuer);
        if (claims === undefined) {
          return c.json(
            createErrorEnvelope("UNAUTHORIZED", "Invalid or expired JWT"),
            401,
          );
        }
        // Server-side role validation (e.g., check revocation, tenant membership)
        if (config.roleValidator !== undefined && !config.roleValidator(claims)) {
          return c.json(
            createErrorEnvelope("UNAUTHORIZED", "JWT role rejected by server-side validator"),
            401,
          );
        }
        auth = {
          type: "jwt",
          identity: claims.sub,
          role: claims.role,
          tenantId: claims.tenantId,
        };
      }
    }

    // No auth provided
    if (auth === undefined) {
      return c.json(
        createErrorEnvelope("UNAUTHORIZED", "Authentication required"),
        401,
      );
    }

    c.set("auth", auth);
    return next();
  };
}

// =============================================================================
// Permission Guard
// =============================================================================

/**
 * Create a permission guard middleware.
 *
 * Must run AFTER authMiddleware. Returns 403 if the authenticated
 * role lacks the required permission.
 */
export function requirePermission(
  permission: Permission,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!hasPermission(auth.role, permission)) {
      return c.json(
        createErrorEnvelope(
          "FORBIDDEN",
          `Role '${auth.role}' lacks '${permission}' permission`,
        ),
        403,
      );
    }
    return next();
  };
}

// =============================================================================
// JWT Helpers
// =============================================================================

/**
 * Verify a JWT token using HMAC-SHA256.
 *
 * This is a minimal JWT verifier — no external dependencies.
 * Only supports HS256 (alg: "HS256").
 *
 * @returns Decoded claims, or undefined if invalid/expired.
 */
export function verifyJwt(
  token: string,
  secret: string,
  expectedIssuer?: string,
): JwtClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }

  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  // Verify signature using a constant-time comparison (CWE-208). A naive
  // `expectedSig !== signatureB64` short-circuits on the first differing byte,
  // leaking signature bytes via timing. Length is non-secret, so an early
  // length-mismatch reject is safe; equal-length buffers go through
  // timingSafeEqual.
  const expectedSig = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  const expectedBuf = Buffer.from(expectedSig, "utf-8");
  const providedBuf = Buffer.from(signatureB64, "utf-8");
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return undefined;
  }

  // Decode header
  try {
    const header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf-8"),
    ) as Record<string, unknown>;
    if (header["alg"] !== "HS256") {
      return undefined;
    }
  } catch {
    return undefined;
  }

  // Decode payload
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as Record<string, unknown>;

    // Validate required fields
    if (
      typeof payload["sub"] !== "string" ||
      typeof payload["role"] !== "string" ||
      typeof payload["tenantId"] !== "string" ||
      typeof payload["exp"] !== "number" ||
      typeof payload["iat"] !== "number"
    ) {
      return undefined;
    }

    // Check expiration
    if (payload["exp"] < Math.floor(Date.now() / 1000)) {
      return undefined;
    }

    // Check issuer
    if (
      expectedIssuer !== undefined &&
      payload["iss"] !== expectedIssuer
    ) {
      return undefined;
    }

    // Validate role
    const role = payload["role"] as string;
    if (role !== "admin" && role !== "operator" && role !== "viewer") {
      return undefined;
    }

    return {
      sub: payload["sub"] as string,
      role: role as Role,
      tenantId: payload["tenantId"] as string,
      iss: (payload["iss"] as string) ?? "",
      exp: payload["exp"] as number,
      iat: payload["iat"] as number,
    };
  } catch {
    return undefined;
  }
}

/**
 * Create a signed JWT for testing/bootstrapping.
 *
 * @param claims - The JWT claims
 * @param secret - HMAC-SHA256 secret
 * @returns Signed JWT string
 */
export function signJwt(
  claims: Omit<JwtClaims, "iat"> & { iat?: number },
  secret: string,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({
      ...claims,
      iat: claims.iat ?? Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");

  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}
