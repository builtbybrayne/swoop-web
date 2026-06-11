// product/ui/src/shared/AttributeTable.tsx
//
// Dumb key-value grid. Originally used by the retired `item-detail` widget
// to render duration, regions, activities, budget band in a uniform layout.
//
// Post-D.t9 (2026-05-12) consumers: the four `find_options` polymorphic card
// variants — `trip-card.tsx`, `tour-card.tsx`, `hotel-card.tsx`, and
// `region-base-card.tsx` — each compose their per-type attribute rows
// (Region / Duration / From price / Accommodation for trip; +Group size
// + Day count for tour; Location / Star rating + per-night From for hotel;
// Nearby trips for region_base).
//
// Skips entries whose value is undefined/null/empty, so callers don't have
// to guard.

import type { ReactNode } from "react";

export type AttributeRow = {
  label: string;
  value: ReactNode;
};

export type AttributeTableProps = {
  rows: AttributeRow[];
  className?: string;
};

function isEmpty(value: ReactNode): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function AttributeTable({ rows, className = "" }: AttributeTableProps) {
  const visible = rows.filter((r) => !isEmpty(r.value));
  if (visible.length === 0) return null;

  return (
    <dl
      className={[
        "grid grid-cols-[max-content_1fr] items-baseline gap-x-5 gap-y-1.5",
        "border-t border-slate-100 pt-3 text-sm",
        className,
      ].join(" ")}
    >
      {visible.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            {r.label}
          </dt>
          <dd className="font-medium text-slate-800">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

AttributeTable.displayName = "AttributeTable";
