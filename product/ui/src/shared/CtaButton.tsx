// product/ui/src/shared/CtaButton.tsx
//
// Clickable affordance. Two forms:
//   - href present → <a> (deep link; opens in new tab per planning/02-impl-
//     chat-surface.md §D.2 — widgets can't persist state across nav).
//   - href absent  → <button>.
//
// Dumb. No variant system, no loading state, no icons. Swoop's brand team
// customises post-M5 via the extension surface (D.t8).

import type { MouseEventHandler, ReactNode } from "react";

type Common = {
  children: ReactNode;
  className?: string;
  /** Disabled state only applies to the button variant. */
  disabled?: boolean;
  ariaLabel?: string;
};

type ButtonProps = Common & {
  href?: undefined;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
};

type LinkProps = Common & {
  href: string;
  onClick?: undefined;
  type?: undefined;
};

export type CtaButtonProps = ButtonProps | LinkProps;

const baseClass = [
  "inline-flex items-center justify-center",
  "rounded-md border border-slate-300 bg-white",
  "px-3 py-2 text-sm font-medium text-slate-900",
  "shadow-sm transition-colors",
  "hover:bg-slate-50",
  "focus:outline-none focus:ring-2 focus:ring-slate-400",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");

export function CtaButton(props: CtaButtonProps) {
  if ("href" in props && props.href) {
    const { href, children, className, ariaLabel } = props;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={[baseClass, className ?? ""].join(" ")}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }

  const { onClick, children, className, disabled, type = "button", ariaLabel } =
    props as ButtonProps;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[baseClass, className ?? ""].join(" ")}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

CtaButton.displayName = "CtaButton";
