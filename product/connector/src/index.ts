// -----------------------------------------------------------------------------
// @swoop/connector — public surface.
//
// Today: handoff side-effects only. Data tools (search / get_detail /
// illustrate) land in chunk C.
//
// Consumers import from the package name:
//   import { submitHandoff, type SubmitResult } from "@swoop/connector";
// -----------------------------------------------------------------------------

export {
  sendHandoffEmail,
  preparePayloadForTemplate,
  type MailerConfig,
  type MailerDeps,
  type SendResult,
} from './handoff/mailer.js';

export {
  renderTemplate,
} from './handoff/template-renderer.js';

export {
  FsHandoffStore,
  HANDOFF_ID_PATTERN,
  type HandoffStore,
  type SaveResult,
} from './handoff/store.js';

export {
  submitHandoff,
  type SubmitDeps,
  type SubmitResult,
} from './handoff/submit.js';
