// product/ui/src/widgets/find-someone-who.tsx
//
// =============================================================================
// Conversational moment — Mirror (Interest → Strong Consideration).
//
// The visitor revealed a persona signal — solo, post-divorce, photographer,
// retiring, first big trip. The right answer is rarely a brochure; it's a
// story about *someone with a similar shape* who did this trip and loved it.
// The Mirror moment is about being *seen*, not being *shown*.
//
// The visitor sees: below Sonnet's framing prose, one to three story
// vignettes. Each vignette renders the customer's own story prose (the
// load-bearing text) with a small italicised persona summary above it
// — labelled with a quiet "Someone like…" preface so the *match* is
// legible. Optional region tag, optional image, deep-link to the source
// where present. Visually distinct from Inspire's panel: the persona
// summary is the affordance that signals "Mirror, not Inspire".
//
// What the visitor does next: reads. Maybe quotes back to the agent
// ("the W-trail solo one sounds like me"). A few click through to the
// blog source. The persona summary is what makes the visitor feel the
// conversation has *seen* them.
//
// Persona-summary visual treatment (HITL Q3 — executor's call per
// `planning/03-exec-chat-surface-t9.md` §"HITL ratification record"):
// chosen the plan's recommended option — italic block above the story
// prose with a quiet "Someone like…" preface. Rationale: the preface
// makes the *match* explicit (the load-bearing affordance vs Inspire);
// italic keeps it visually quiet; not a header so it doesn't dominate
// the prose. Logged as decision D.27 in the execution log.
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_someone_who`" + the
// conversational-moment calibration in
// `product/cms/prompts/tools/find_someone_who/description.md`.
// =============================================================================

import type { z } from "zod";
import { FindSomeoneWhoOutputSchema } from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";

// Schema-inferred shape — see note in find-inspiring.tsx.
type ParsedStory = z.infer<
  typeof FindSomeoneWhoOutputSchema
>["stories"][number];
import { Card, ImageBlock } from "../shared";
import { decodeHtmlEntities } from "./text-utils";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  WidgetSilentPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

const SHELL_CTX = {
  widgetType: "find-someone-who",
  toolName: "find_someone_who",
} as const;

export function FindSomeoneWhoWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Looking for similar travellers…",
  );
  if (gate) return gate;

  const parsed = safeParse(
    FindSomeoneWhoOutputSchema,
    props.result,
    SHELL_CTX,
  );
  if (!parsed.ok) {
    return <WidgetMalformedPlaceholder {...SHELL_CTX} debug={parsed.debug} />;
  }
  const { stories } = parsed.data;

  // Empty result is the agent's job to handle in prose, not a widget surface.
  // Prod: silent. Dev: indicator names the tool + reason.
  // Per crosscut plan 03-exec-crosscut-brave-pare-widget-user-copy-fix.md.
  if (stories.length === 0) {
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason="empty result"
        hint={{ stories: 0 }}
      />
    );
  }

  return (
    <section
      data-testid="find-someone-who"
      data-swoop-part="widget"
      data-swoop-widget="find-someone-who"
      aria-label="Customer stories matching your situation"
      className="my-2 flex w-full flex-col gap-3"
    >
      {stories.map((story) => (
        <StoryVignette key={story.id} story={story} />
      ))}
    </section>
  );
}

FindSomeoneWhoWidget.displayName = "FindSomeoneWhoWidget";

// -----------------------------------------------------------------------------
// StoryVignette — image (when present) + persona-summary preface + story prose
// + region tag + deep-link.
// -----------------------------------------------------------------------------

function StoryVignette({ story }: { story: ParsedStory }) {
  return (
    <Card className="overflow-hidden">
      <div data-swoop-part="find-someone-who-vignette" className="contents">
        {story.image ? (
          <ImageBlock
            src={story.image.canonicalUrl}
            alt={story.image.altText ?? ""}
          />
        ) : null}
        <div className="flex flex-col gap-3 p-4">
          {/* Persona-summary preface — the load-bearing Mirror affordance. */}
          <p
            data-testid="find-someone-who-persona"
            className="text-xs italic leading-relaxed text-slate-500"
          >
            <span className="not-italic font-semibold uppercase tracking-[0.08em] text-swoop-deep">
              Someone like…
            </span>{" "}
            {story.personaSummary}
          </p>
          <p
            data-testid="find-someone-who-story"
            className="text-sm leading-relaxed text-slate-800"
          >
            {decodeHtmlEntities(story.text)}
          </p>
          <div className="flex items-center justify-between gap-2 pt-1">
            {story.region ? (
              <span
                data-testid="find-someone-who-region"
                className="rounded-full bg-swoop-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-swoop-deep"
              >
                {story.region}
              </span>
            ) : (
              <span aria-hidden="true" />
            )}
            {story.canonicalUrl ? (
              <a
                href={story.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="find-someone-who-link"
                className="text-xs font-semibold text-swoop-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-swoop-accent"
              >
                Read the full story →
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
