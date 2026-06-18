/**
 * Connector-side cryptographic staff-token verifier (sm-t2-auth hardening).
 *
 * Performs full JWT verification matching the orchestrator's signer in
 * product/orchestrator/src/auth/shared-password-authenticator.ts:
 *   - Algorithm allow-list: HS256 only (prevents alg-confusion / alg:none).
 *   - Issuer: STAFF_JWT_ISSUER  ('puma-staff')
 *   - Audience: STAFF_JWT_AUDIENCE ('puma-orchestrator')
 *   - Signature: verified against the shared STAFF_JWT_SECRET.
 *   - Expiry: jose enforces `exp` automatically.
 *
 * OPERATOR NOTE: both the orchestrator and the connector MUST share the same
 * STAFF_JWT_SECRET value. A mismatch means every mutation tool call is rejected
 * with a signature failure, even with a legitimately issued token.
 *
 * Wired at boot in product/connector/src/server/index.ts when STAFF_JWT_SECRET
 * is present in config. When absent, the connector falls back to the
 * `assertStaffTokenPresent` presence backstop in tools/deps.ts — no handler
 * change required (the seam in ToolHandlerDeps.assertStaffToken absorbs the swap).
 */

import { jwtVerify } from 'jose';
import { STAFF_JWT_ISSUER, STAFF_JWT_AUDIENCE, STAFF_JWT_ALG } from '@swoop/common';

/**
 * Build a cryptographic staff-token verifier bound to the supplied secret.
 *
 * Returns an `assertStaffToken` function compatible with the
 * `ToolHandlerDeps.assertStaffToken` seam: resolves (void) on a valid token,
 * throws on any failure (missing, blank, expired, wrong issuer, wrong audience,
 * bad signature, alg:none, etc.).
 *
 * @param secret - The raw STAFF_JWT_SECRET string (≥ 32 chars). Encoded to
 *   Uint8Array internally — jose requires a binary key for HMAC.
 */
export function buildStaffTokenVerifier(
  secret: string,
): (token: string | undefined) => Promise<void> {
  const secretKey = new TextEncoder().encode(secret);

  return async function assertStaffToken(token: string | undefined): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new Error(
        '[connector/auth] Mutation rejected: staffToken is missing or blank. ' +
          'The orchestrator must bind a valid staff JWT before calling a mutating tool.',
      );
    }

    // jwtVerify with an explicit algorithms allow-list:
    //   - Prevents alg-confusion attacks (e.g. RS256 → HS256 key confusion).
    //   - Rejects alg:none tokens entirely.
    //   - Enforces issuer + audience claims on top of signature + expiry.
    await jwtVerify(token, secretKey, {
      issuer: STAFF_JWT_ISSUER,
      audience: STAFF_JWT_AUDIENCE,
      algorithms: [STAFF_JWT_ALG],
    });
    // Resolves void on success; jwtVerify throws JoseError subtypes on any
    // failure — the caller (mutation tool body) propagates the throw, which
    // rejects the mutation before any DB write occurs.
  };
}
