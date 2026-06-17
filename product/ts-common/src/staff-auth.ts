// -----------------------------------------------------------------------------
// StaffAuthenticator — interface for staff authentication (staff-auth task).
//
// Staff members need to authenticate so they can author "memories" for the
// agent. This interface is a clean swap seam: the v1 SharedPasswordAuthenticator
// (orchestrator) verifies a single shared password; a later GoogleOidcAuthenticator
// drops in with NO caller changes — mirroring the HandoffStore interface→impl
// pattern in @swoop/connector.
//
// The interface lives in @swoop/common so both the orchestrator (impl) and any
// future consumer that only needs the type contract can import without pulling
// in Node.js-only crypto / jwt deps.
// -----------------------------------------------------------------------------

/**
 * Credentials supplied by the staff member to authenticate. Shape depends on
 * the implementation:
 *   - SharedPasswordAuthenticator  → { password, name }
 *   - GoogleOidcAuthenticator      → { idToken }  (future)
 *
 * Typed as a discriminated union so callers can narrow per-impl without any
 * `as` casts.
 */
export type StaffCredentials =
  | {
      readonly kind: "password";
      /** The shared staff password. */
      readonly password: string;
      /** Staff member's name for attribution (stored in the JWT claim). */
      readonly name: string;
    }
  | {
      readonly kind: "oidc";
      /** Google OIDC id_token (future impl). */
      readonly idToken: string;
    };

/**
 * Result of a successful `authenticate()` call. The JWT is self-contained and
 * signed; the orchestrator only stores it in the response, never in a DB.
 */
export interface StaffAuthResult {
  /** Signed JWT to return to the client. */
  readonly token: string;
  /** Staff member's display name, taken from the credential payload. */
  readonly name: string;
  /** ISO-8601 expiry — informational, the JWT `exp` is authoritative. */
  readonly expiresAt: string;
}

/**
 * Result of `verify()` — discriminated on `ok`.
 */
export type StaffVerifyResult =
  | {
      readonly ok: true;
      /** Staff member's name extracted from the JWT `name` claim. */
      readonly name: string;
    }
  | {
      readonly ok: false;
      /**
       * Machine-readable reason. Callers treat all failures identically
       * (downgrade to visitor session); the code aids debugging only.
       */
      readonly reason: "invalid" | "expired" | "malformed";
    };

/**
 * Staff authenticator — the interface every implementation must satisfy.
 *
 * One implementation exists today (`SharedPasswordAuthenticator`). A later
 * `GoogleOidcAuthenticator` swaps in by implementing this interface;
 * `BuildServerDeps` adds it as an optional dep and callers change zero lines.
 */
export interface StaffAuthenticator {
  /**
   * Validate the supplied credentials and issue a signed JWT on success.
   * Returns `null` when the credential is wrong (wrong password, future:
   * id_token audience mismatch), so the caller can return a generic 401
   * without leaking which check failed. Network failures (future OIDC
   * introspection) throw — callers catch and 500.
   */
  authenticate(credentials: StaffCredentials): Promise<StaffAuthResult | null>;

  /**
   * Validate a previously-issued JWT string. Returns the decoded claims on
   * success or a failure reason on any error (expired, tampered, malformed).
   * Never throws — callers treat failure as "visitor session" gracefully.
   */
  verify(token: string): Promise<StaffVerifyResult>;
}
