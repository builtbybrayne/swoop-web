// product/ui/src/disclosure/__tests__/chrome-badge.test.tsx
//
// Covers the persistent D.t4 chrome badge + its privacy-info modal hook-up.

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChromeBadge } from "../chrome-badge";

afterEach(() => cleanup());

describe("<ChromeBadge />", () => {
  it("renders as a button with an AI-disclosure affordance", () => {
    render(<ChromeBadge />);
    const badge = screen.getByTestId("chrome-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.tagName).toBe("BUTTON");
    expect(badge).toHaveAttribute("aria-haspopup", "dialog");
    expect(badge).toHaveTextContent(/AI assistant/i);
  });

  it("click opens the privacy info modal; Close dismisses it", async () => {
    render(<ChromeBadge />);
    const badge = screen.getByTestId("chrome-badge");
    fireEvent.click(badge);

    await waitFor(() => {
      expect(screen.getByTestId("privacy-info-modal")).toBeInTheDocument();
    });
    expect(badge).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByTestId("privacy-info-modal-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("privacy-info-modal")).not.toBeInTheDocument();
    });
  });

  it("Esc closes the modal", async () => {
    render(<ChromeBadge />);
    fireEvent.click(screen.getByTestId("chrome-badge"));
    await waitFor(() => {
      expect(screen.getByTestId("privacy-info-modal")).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("privacy-info-modal")).not.toBeInTheDocument();
    });
  });

  it("click outside the dialog closes the modal", async () => {
    render(<ChromeBadge />);
    fireEvent.click(screen.getByTestId("chrome-badge"));
    const backdrop = await screen.findByTestId("privacy-info-modal");
    fireEvent.click(backdrop);
    await waitFor(() => {
      expect(screen.queryByTestId("privacy-info-modal")).not.toBeInTheDocument();
    });
  });
});
