// product/ui/src/shared/AttributeTable.tsx
//
// Dumb key-value grid. Used by item-detail to render duration, regions,
// activities, budget band in a uniform layout. Skips entries whose value is
// undefined/null/empty, so callers don't have to guard.

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
        "grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm",
        className,
      ].join(" ")}
    >
      {visible.map((r) => (
        <div key={r.label} className="contents">
          <dt className="font-medium text-slate-500">{r.label}</dt>
          <dd className="text-slate-800">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

AttributeTable.displayName = "AttributeTable";
