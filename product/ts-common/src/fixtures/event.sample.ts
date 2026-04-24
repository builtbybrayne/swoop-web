// -----------------------------------------------------------------------------
// Event fixtures — one per event kind.
//
// Per planning/03-exec-observability-a.md (F-a). Round-tripped through
// EventSchema by `__tests__/fixtures.test.ts` so any schema/fixture drift is
// caught at test time.
// -----------------------------------------------------------------------------

import type { Event } from "../events.js";

// A.t2 — kept for back-compat.
export const SampleEventHandoffSubmitted: Event = {
  eventType: "handoff.submitted",
  eventVersion: 1,
  timestamp: "2026-04-22T09:07:23.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: 6,
  actor: "agent",
  payload: {
    handoffId: "handoff_puma_demo_001",
    verdict: "qualified",
    consentConversationGranted: true,
    consentHandoffGranted: true,
    consentMarketingGranted: false,
    emailDeliveryStatus: "sent",
  },
};

// F-a additions ------------------------------------------------------------

export const SampleEventConsentGranted: Event = {
  eventType: "consent.granted",
  eventVersion: 1,
  timestamp: "2026-04-22T09:00:05.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: null,
  actor: "ui",
  payload: {
    tier: "conversation",
    copyVersion: "consent-conversation/v1",
  },
};

export const SampleEventConsentDeclined: Event = {
  eventType: "consent.declined",
  eventVersion: 1,
  timestamp: "2026-04-22T09:00:07.000Z",
  sessionId: "sess_puma_demo_002",
  turnIndex: null,
  actor: "ui",
  payload: {
    tier: "marketing",
    copyVersion: "consent-handoff/v1",
  },
};

export const SampleEventToolFailed: Event = {
  eventType: "tool.failed",
  eventVersion: 1,
  timestamp: "2026-04-22T09:02:31.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: 2,
  actor: "connector",
  payload: {
    toolName: "search",
    toolCallId: "call_search_17",
    errorCategory: "upstream",
    latencyMs: 430,
  },
};

export const SampleEventHandoffTriggered: Event = {
  eventType: "handoff.triggered",
  eventVersion: 1,
  timestamp: "2026-04-22T09:06:58.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: 5,
  actor: "agent",
  payload: {
    verdict: "qualified",
    widgetToken: "widget_tok_abc123",
  },
};

export const SampleEventSkillLoaded: Event = {
  eventType: "skill.loaded",
  eventVersion: 1,
  timestamp: "2026-04-22T09:01:14.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: 1,
  actor: "agent",
  payload: {
    skillName: "w-trek-deep-knowledge",
    triggerContext: "visitor asked about November departures on the W Trek",
  },
};

export const SampleEventUiWidgetRendered: Event = {
  eventType: "ui.widget_rendered",
  eventVersion: 1,
  timestamp: "2026-04-22T09:02:40.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: 2,
  actor: "ui",
  payload: {
    widgetType: "search-results",
    toolName: "search",
    turnIndex: 2,
  },
};

export const SampleEventUiConversationOpened: Event = {
  eventType: "ui.conversation_opened",
  eventVersion: 1,
  timestamp: "2026-04-22T09:00:02.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: null,
  actor: "ui",
  payload: {
    source: "nav-button",
    uaCategory: "desktop",
  },
};

export const SampleEventUiConversationClosed: Event = {
  eventType: "ui.conversation_closed",
  eventVersion: 1,
  timestamp: "2026-04-22T09:10:01.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: 6,
  actor: "ui",
  payload: {
    closeReason: "explicit_close",
    finalState: "post-handoff",
  },
};

export const SampleEventSessionExpired: Event = {
  eventType: "session.expired",
  eventVersion: 1,
  timestamp: "2026-04-23T09:00:02.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: null,
  actor: "system",
  payload: {
    cause: "idle_timeout",
  },
};

export const SampleEventWarmPoolHit: Event = {
  eventType: "warm_pool.hit",
  eventVersion: 1,
  timestamp: "2026-04-22T09:00:01.000Z",
  sessionId: "sess_puma_demo_003",
  turnIndex: null,
  actor: "system",
  payload: {
    poolSizeAtClaim: 3,
    waitTimeMs: 12,
  },
};

export const SampleEventWarmPoolMiss: Event = {
  eventType: "warm_pool.miss",
  eventVersion: 1,
  timestamp: "2026-04-22T09:00:01.000Z",
  sessionId: "sess_puma_demo_004",
  turnIndex: null,
  actor: "system",
  payload: {
    poolSizeAtClaim: 0,
  },
};

/**
 * Back-compat alias. Existing consumers import `SampleEvent`; new tests use
 * the named fixtures above.
 */
export const SampleEvent = SampleEventHandoffSubmitted;
