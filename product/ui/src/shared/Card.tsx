// product/ui/src/shared/Card.tsx
//
// Generic card wrapper used across the widgets. Deliberately dumb — no domain
// knowledge, no Swoop branding, no interaction behaviour beyond an optional
// click handler. Swoop's in-house team replaces the surface styling
// post-M5 via the extension surface documented in D.t8.
//
// Accessibility: if an `onClick` is passed, the root becomes a button-shaped
// element (role + tabIndex + keyboard handler). Without it, it's a plain
// container.

import type { ReactNode, KeyboardEvent, CSSProperties } from "react";

export type CardProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  /** Accessible label when onClick is present. */
  ariaLabel?: string;
};

export function Card({ children, onClick, className, style, ariaLabel }: CardProps) {
  const interactive = typeof onClick === "function";

  const baseClasses = [
    "flex flex-col overflow-hidden",
    "rounded-lg border border-slate-200 bg-white",
    "shadow-sm transition-shadow",
    interactive ? "cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-400" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      className={baseClasses}
      style={style}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? ariaLabel : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

Card.displayName = "Card";
