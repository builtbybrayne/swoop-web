// product/ui/src/__tests__/brand-extension-surface.test.tsx
//
// Locks in the `data-swoop-part` contract documented in HANDOVER.md.
// Swoop's in-house team uses these attributes as the selector surface for
// brand overrides; removing one silently breaks their stylesheet. Each
// assertion here mirrors a row in HANDOVER.md's selector table.
//
// Scope is intentionally narrow: we assert that the attribute is present
// on the right element, not what classes it carries. Class churn during
// development is expected; attribute churn is the breaking change.

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChromeBadge } from "../disclosure/chrome-badge";
import { OpeningScreen } from "../disclosure/opening-screen";
import { ErrorBanner } from "../errors/error-banner";
import { SearchResultsWidget } from "../widgets/search-results";
import { ItemDetailWidget } from "../widgets/item-detail";
import { InspirationWidget } from "../widgets/inspiration";
import { LeadCaptureWidget } from "../widgets/lead-capture";
import { SampleHandoff, SampleTrip } from "@swoop/common/fixtures";

afterEach(() => cleanup());

// Minimal ToolCallMessagePartProps shim. Mirrors the helper each widget
// test already carries; duplicated here so this file stays self-contained.
function toolProps<T>(overrides: Partial<Record<string, unknown>>): T {
  return {
    type: "tool-call" as const,
    toolCallId: "call_handover",
    toolName: "search",
    args: {},
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as T;
}

describe("brand extension surface (data-swoop-part contract)", () => {
  it("ChromeBadge exposes data-swoop-part=chrome-badge", () => {
    render(<ChromeBadge />);
    const badge = screen.getByTestId("chrome-badge");
    expect(badge).toHaveAttribute("data-swoop-part", "chrome-badge");
  });

  it("OpeningScreen dialog + continue + decline carry their markers", () => {
    render(
      <OpeningScreen
        status={{ state: "pending" }}
        isGranting={false}
        hasDeclined={false}
        grantConsent={() => Promise.resolve()}
        declineConsent={() => undefined}
      />,
    );
    expect(screen.getByTestId("opening-screen")).toHaveAttribute(
      "data-swoop-part",
      "opening-dialog",
    );
    expect(screen.getByTestId("opening-screen-continue")).toHaveAttribute(
      "data-swoop-part",
      "opening-continue",
    );
    expect(screen.getByTestId("opening-screen-decline")).toHaveAttribute(
      "data-swoop-part",
      "opening-decline",
    );
  });

  it("ErrorBanner carries data-swoop-part=error-banner", () => {
    render(
      <ErrorBanner
        error={{
          surface: "unreachable",
          retryable: true,
          cooloffMs: 0,
          detail: "test",
        }}
        onRetry={vi.fn()}
        onRestart={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const banner = screen.getByTestId("error-banner");
    expect(banner).toHaveAttribute("data-swoop-part", "error-banner");
  });

  it("SearchResultsWidget root carries widget + discriminator", () => {
    const result = {
      hits: [
        {
          entityType: "trip",
          id: SampleTrip.id,
          slug: SampleTrip.slug,
          title: SampleTrip.title,
          summary: SampleTrip.summary,
          score: 0.9,
          heroImageUrl: SampleTrip.heroImageUrl,
          publicUrl: "https://example.com/trip",
        },
      ],
      totalMatches: 1,
    };
    render(
      <SearchResultsWidget
        {...toolProps<React.ComponentProps<typeof SearchResultsWidget>>({
          toolName: "search",
          result,
        })}
      />,
    );
    const root = screen.getByTestId("search-results");
    expect(root).toHaveAttribute("data-swoop-part", "widget");
    expect(root).toHaveAttribute("data-swoop-widget", "search-results");
  });

  it("ItemDetailWidget root carries widget + discriminator", () => {
    const result = {
      entityType: "trip",
      record: {
        title: SampleTrip.title,
        summary: SampleTrip.summary,
      },
    };
    render(
      <ItemDetailWidget
        {...toolProps<React.ComponentProps<typeof ItemDetailWidget>>({
          toolName: "get_detail",
          result,
        })}
      />,
    );
    const root = screen.getByTestId("item-detail");
    expect(root).toHaveAttribute("data-swoop-part", "widget");
    expect(root).toHaveAttribute("data-swoop-widget", "item-detail");
  });

  it("InspirationWidget root carries widget + discriminator", () => {
    const result = {
      images: [
        {
          id: "img-1",
          url: "https://example.com/i.jpg",
          altText: "A glacier",
        },
      ],
    };
    render(
      <InspirationWidget
        {...toolProps<React.ComponentProps<typeof InspirationWidget>>({
          toolName: "illustrate",
          result,
        })}
      />,
    );
    const root = screen.getByTestId("inspiration");
    expect(root).toHaveAttribute("data-swoop-part", "widget");
    expect(root).toHaveAttribute("data-swoop-widget", "inspiration");
  });

  it("LeadCaptureWidget summary carries widget marker + lead-capture submit wrapper appears at form step", () => {
    const args = {
      verdict: SampleHandoff.verdict,
      reasonCode: SampleHandoff.reason.code,
      conversationSummary: SampleHandoff.reason.text,
      motivationAnchor: SampleHandoff.motivationAnchor,
    };
    const { container } = render(
      <LeadCaptureWidget
        {...toolProps<React.ComponentProps<typeof LeadCaptureWidget>>({
          toolName: "handoff",
          args,
          argsText: JSON.stringify(args),
          status: { type: "running" as const },
        })}
      />,
    );
    const summary = screen.getByTestId("lead-capture");
    expect(summary).toHaveAttribute("data-swoop-part", "widget");
    expect(summary).toHaveAttribute("data-swoop-widget", "lead-capture");
    expect(summary).toHaveAttribute("data-swoop-widget-state", "summary");

    // Advance to form step — the submit wrapper only exists in form state.
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    const submitWrapper = container.querySelector(
      '[data-swoop-part="lead-capture-submit"]',
    );
    expect(submitWrapper).not.toBeNull();
    // The wrapper should hold a single child button (submit).
    expect(submitWrapper?.querySelector('button[type="submit"]'))
      .not.toBeNull();
  });
});
