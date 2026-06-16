/**
 * Auth module barrel — staff-auth task.
 *
 * The StaffAuthenticator interface lives in @swoop/common (so UI or other
 * packages can import the type). The concrete implementations live here.
 */

export {
  SharedPasswordAuthenticator,
  type SharedPasswordAuthenticatorOptions,
} from './shared-password-authenticator.js';
