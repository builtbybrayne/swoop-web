// product/ui/src/disclosure/legal-copy.ts
//
// Build-time loader for the six legal-copy markdown files in
// `product/cms/legal/`. Each file carries YAML frontmatter (copyVersion,
// lastReviewed, purpose, plus surface-specific labels) and a markdown body.
//
// Vite's `?raw` query loads the file as a string at build time. We then run a
// minimal frontmatter splitter — no external dep — to expose typed copy
// records. The body is held as a markdown string; the privacy-info modal is
// the only consumer that needs to render the body, and it does so via
// `react-markdown` (already a UI dep for D.t2's `<utter>` rendering).
//
// Why a tiny home-grown parser rather than `gray-matter` or similar:
//   - Frontmatter shape is fully under our control — only flat string values,
//     no nested objects, no arrays. The 30-line parser below covers it.
//   - One fewer dep in the UI bundle. Privacy-info.md is the largest body
//     and it's still under 3kb.
//
// If frontmatter ever needs nested structure, switch to `gray-matter`. The
// surface contract (the exported records) doesn't have to change.
//
// References:
//   - planning/02-impl-handoff-and-compliance.md §2.6
//   - planning/02-impl-chat-surface.md §2.4
//   - planning/03-exec-chat-surface-t4.md (this module is what the
//     E.t5-tagged placeholder TODOs in chrome-badge / opening-screen /
//     privacy-info-modal eventually fed into)

import disclosureOpeningRaw from "../../../cms/legal/disclosure-opening.md?raw";
import disclosureChromeRaw from "../../../cms/legal/disclosure-chrome.md?raw";
import consentHandoffRaw from "../../../cms/legal/consent-handoff.md?raw";
import consentMarketingRaw from "../../../cms/legal/consent-marketing.md?raw";
import privacyInfoRaw from "../../../cms/legal/privacy-info.md?raw";
import retentionRaw from "../../../cms/legal/retention.md?raw";

/**
 * Required fields present on every legal-copy file. Surface-specific fields
 * extend this — see the per-surface types below.
 */
interface BaseFrontmatter {
  copyVersion: string;
  lastReviewed: string;
  purpose: string;
}

interface ParsedFile<F extends BaseFrontmatter> {
  frontmatter: F;
  body: string;
}

/** Splits a markdown file's YAML frontmatter from its body. */
function splitFrontmatter(raw: string): { yaml: string; body: string } {
  // Normalise CRLF → LF so the regex behaves identically on Windows.
  const normalised = raw.replace(/\r\n/g, "\n");
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(
      "legal-copy: missing or malformed YAML frontmatter (file must start with --- ... ---)",
    );
  }
  return { yaml: match[1] ?? "", body: (match[2] ?? "").trim() };
}

/**
 * Minimal YAML-ish parser for our frontmatter dialect: one `key: value` per
 * line, value is the rest of the line trimmed, optional surrounding quotes
 * stripped. No nesting, arrays, or block scalars. Good enough for the flat
 * shape we author and brittle in a useful way: anything fancier here throws
 * loudly rather than silently mis-parsing.
 */
function parseFlatYaml(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = yaml.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`legal-copy: invalid frontmatter line: ${rawLine}`);
    }
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding single or double quotes, if present in a matched pair.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function requireFields<K extends string>(
  fm: Record<string, string>,
  keys: readonly K[],
  filename: string,
): Record<K, string> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const v = fm[k];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(
        `legal-copy: ${filename} missing required frontmatter field "${k}"`,
      );
    }
    out[k] = v;
  }
  return out as Record<K, string>;
}

const BASE_KEYS = ["copyVersion", "lastReviewed", "purpose"] as const;

function parseFile<F extends BaseFrontmatter>(
  raw: string,
  filename: string,
  extraKeys: readonly (keyof F)[] = [],
): ParsedFile<F> {
  const { yaml, body } = splitFrontmatter(raw);
  const flat = parseFlatYaml(yaml);
  // Cast through `unknown` — `extraKeys` may be typed `keyof F`, which is
  // wider than `string` for legitimate string-keyed shapes.
  const allKeys = [...BASE_KEYS, ...(extraKeys as readonly string[])];
  const validated = requireFields(flat, allKeys, filename) as unknown as F;
  return { frontmatter: validated, body };
}

// ---------------------------------------------------------------------------
// Per-surface frontmatter shapes
// ---------------------------------------------------------------------------

interface DisclosureOpeningFrontmatter extends BaseFrontmatter {
  heading: string;
  continueLabel: string;
  declineLabel: string;
  privacyLinkLabel: string;
  declinedHeading: string;
  declinedBody: string;
  grantingLabel: string;
  errorPrefix: string;
}

interface DisclosureChromeFrontmatter extends BaseFrontmatter {
  badgeLabel: string;
  badgeInfoLabel: string;
  ariaLabel: string;
}

interface ConsentTickboxFrontmatter extends BaseFrontmatter {
  label: string;
}

interface PrivacyInfoFrontmatter extends BaseFrontmatter {
  heading: string;
  closeLabel: string;
  ariaCloseLabel: string;
}

type RetentionFrontmatter = BaseFrontmatter & { heading: string };

// ---------------------------------------------------------------------------
// Parse all six at module load. Any malformed file throws here — surfacing
// authoring mistakes the moment Vite picks the file up rather than at first
// render.
// ---------------------------------------------------------------------------

const disclosureOpening = parseFile<DisclosureOpeningFrontmatter>(
  disclosureOpeningRaw,
  "disclosure-opening.md",
  [
    "heading",
    "continueLabel",
    "declineLabel",
    "privacyLinkLabel",
    "declinedHeading",
    "declinedBody",
    "grantingLabel",
    "errorPrefix",
  ],
);

const disclosureChrome = parseFile<DisclosureChromeFrontmatter>(
  disclosureChromeRaw,
  "disclosure-chrome.md",
  ["badgeLabel", "badgeInfoLabel", "ariaLabel"],
);

const consentHandoff = parseFile<ConsentTickboxFrontmatter>(
  consentHandoffRaw,
  "consent-handoff.md",
  ["label"],
);

const consentMarketing = parseFile<ConsentTickboxFrontmatter>(
  consentMarketingRaw,
  "consent-marketing.md",
  ["label"],
);

const privacyInfo = parseFile<PrivacyInfoFrontmatter>(
  privacyInfoRaw,
  "privacy-info.md",
  ["heading", "closeLabel", "ariaCloseLabel"],
);

const retention = parseFile<RetentionFrontmatter>(
  retentionRaw,
  "retention.md",
  ["heading"],
);

// ---------------------------------------------------------------------------
// Public surface — frozen records. Body strings are markdown; consumers that
// render them (privacy-info modal) hand them to `react-markdown`.
// ---------------------------------------------------------------------------

export interface DisclosureOpeningCopy {
  copyVersion: string;
  heading: string;
  body: string;
  privacyLinkLabel: string;
  continueLabel: string;
  declineLabel: string;
  declinedHeading: string;
  declinedBody: string;
  grantingLabel: string;
  errorPrefix: string;
}

export interface DisclosureChromeCopy {
  copyVersion: string;
  badgeLabel: string;
  badgeInfoLabel: string;
  ariaLabel: string;
}

export interface ConsentTickboxCopy {
  copyVersion: string;
  label: string;
}

export interface PrivacyInfoCopy {
  copyVersion: string;
  heading: string;
  body: string;
  closeLabel: string;
  ariaCloseLabel: string;
}

export interface RetentionCopy {
  copyVersion: string;
  heading: string;
  body: string;
}

export const DisclosureOpening: Readonly<DisclosureOpeningCopy> = Object.freeze({
  copyVersion: disclosureOpening.frontmatter.copyVersion,
  heading: disclosureOpening.frontmatter.heading,
  body: disclosureOpening.body,
  privacyLinkLabel: disclosureOpening.frontmatter.privacyLinkLabel,
  continueLabel: disclosureOpening.frontmatter.continueLabel,
  declineLabel: disclosureOpening.frontmatter.declineLabel,
  declinedHeading: disclosureOpening.frontmatter.declinedHeading,
  declinedBody: disclosureOpening.frontmatter.declinedBody,
  grantingLabel: disclosureOpening.frontmatter.grantingLabel,
  errorPrefix: disclosureOpening.frontmatter.errorPrefix,
});

export const DisclosureChrome: Readonly<DisclosureChromeCopy> = Object.freeze({
  copyVersion: disclosureChrome.frontmatter.copyVersion,
  badgeLabel: disclosureChrome.frontmatter.badgeLabel,
  badgeInfoLabel: disclosureChrome.frontmatter.badgeInfoLabel,
  ariaLabel: disclosureChrome.frontmatter.ariaLabel,
});

export const ConsentHandoff: Readonly<ConsentTickboxCopy> = Object.freeze({
  copyVersion: consentHandoff.frontmatter.copyVersion,
  label: consentHandoff.frontmatter.label,
});

export const ConsentMarketing: Readonly<ConsentTickboxCopy> = Object.freeze({
  copyVersion: consentMarketing.frontmatter.copyVersion,
  label: consentMarketing.frontmatter.label,
});

export const PrivacyInfo: Readonly<PrivacyInfoCopy> = Object.freeze({
  copyVersion: privacyInfo.frontmatter.copyVersion,
  heading: privacyInfo.frontmatter.heading,
  body: privacyInfo.body,
  closeLabel: privacyInfo.frontmatter.closeLabel,
  ariaCloseLabel: privacyInfo.frontmatter.ariaCloseLabel,
});

export const Retention: Readonly<RetentionCopy> = Object.freeze({
  copyVersion: retention.frontmatter.copyVersion,
  heading: retention.frontmatter.heading,
  body: retention.body,
});

/**
 * The disclosureCopyVersion the orchestrator records on consent grant.
 * Sourced from the opening-screen file because that's the surface the
 * visitor explicitly sees and consents to. The other files share the same
 * version today, but they're free to drift independently — this export is
 * the single load-bearing pin for the consent audit trail.
 *
 * `useConsent.refreshSession()` reads this so the new audit-trail entry
 * after a "New conversation" restart is consistent with what the visitor
 * originally saw, even if the orchestrator's POST /session reply happens
 * to advertise a newer version.
 */
export const DISCLOSURE_COPY_VERSION: string = DisclosureOpening.copyVersion;
