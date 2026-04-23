// product/ui/src/disclosure/index.ts
//
// Barrel export for the tier-1 disclosure + consent surface. See
// planning/03-exec-chat-surface-t4.md.

export { OpeningScreen } from "./opening-screen";
export { ChromeBadge } from "./chrome-badge";
export { PrivacyInfoModal } from "./privacy-info-modal";
export type { PrivacyInfoModalProps } from "./privacy-info-modal";
export {
  useConsent,
  CONSENT_STORAGE_KEY,
  CONSENT_COPY_VERSION_KEY,
  DECLINE_POSTMESSAGE_TYPE,
} from "./use-consent";
export type { UseConsentResult, ConsentStatus } from "./use-consent";
