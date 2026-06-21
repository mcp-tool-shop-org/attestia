/**
 * Tests for constant-time JWT HMAC signature comparison (A-NODE-003, CWE-208).
 *
 * The signature check must not short-circuit on the first differing byte (which
 * leaks the signature via timing). We verify behaviorally that:
 * - a valid signature still verifies,
 * - a tampered signature of the SAME length is rejected (the equal-length path
 *   that timingSafeEqual guards),
 * - a signature of a DIFFERENT length is rejected (the safe early length check).
 */

import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "../../src/middleware/auth.js";
import type { JwtClaims } from "../../src/types/auth.js";

const SECRET = "constant-time-test-secret";

function futureClaims(): Omit<JwtClaims, "iat"> {
  return {
    sub: "user-1",
    role: "operator",
    tenantId: "tenant-1",
    iss: "attestia",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

describe("verifyJwt constant-time signature compare (A-NODE-003)", () => {
  it("verifies a correctly signed token", () => {
    const token = signJwt(futureClaims(), SECRET);
    const claims = verifyJwt(token, SECRET, "attestia");
    expect(claims).toBeDefined();
    expect(claims?.sub).toBe("user-1");
  });

  it("rejects a token whose signature is tampered but the SAME length", () => {
    const token = signJwt(futureClaims(), SECRET);
    const [h, p, sig] = token.split(".") as [string, string, string];

    // Flip the first character to a different valid base64url char, keeping
    // the signature length identical. Pre-fix `!==` would reject this too, but
    // the post-fix timingSafeEqual path MUST also reject it (and requires equal
    // length, which this preserves).
    const firstChar = sig[0] === "A" ? "B" : "A";
    const tamperedSig = firstChar + sig.slice(1);
    expect(tamperedSig.length).toBe(sig.length);

    const tampered = `${h}.${p}.${tamperedSig}`;
    expect(verifyJwt(tampered, SECRET, "attestia")).toBeUndefined();
  });

  it("rejects a token whose signature length differs (safe early reject)", () => {
    const token = signJwt(futureClaims(), SECRET);
    const [h, p, sig] = token.split(".") as [string, string, string];

    // timingSafeEqual throws on unequal-length buffers; the implementation must
    // reject on length mismatch BEFORE calling it, never crash.
    const shorter = `${h}.${p}.${sig.slice(0, sig.length - 2)}`;
    const longer = `${h}.${p}.${sig}XY`;
    expect(verifyJwt(shorter, SECRET, "attestia")).toBeUndefined();
    expect(verifyJwt(longer, SECRET, "attestia")).toBeUndefined();
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = signJwt(futureClaims(), "a-different-secret");
    expect(verifyJwt(token, SECRET, "attestia")).toBeUndefined();
  });
});
