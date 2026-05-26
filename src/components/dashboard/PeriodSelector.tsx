"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PERIOD_PRESETS } from "@/lib/period-presets";

// 호환을 위해 re-export
export { PERIOD_PRESETS, DEFAULT_PRESET } from "@/lib/period-presets";
export type { PeriodPreset } from "@/lib/period-presets";

export function PeriodSelector({
  currentFrom,
  currentTo,
}: {
  currentFrom: string;
  currentTo: string;
}) {
  const sp = useSearchParams();
  const pathname = usePathname() ?? "/";
  const activePreset = PERIOD_PRESETS.find(
    (p) => p.from === currentFrom && p.to === currentTo,
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PERIOD_PRESETS.map((p) => {
        const isActive = activePreset?.id === p.id;
        const params = new URLSearchParams(sp?.toString() ?? "");
        params.set("from", p.from);
        params.set("to", p.to);
        params.delete("preset");
        return (
          <Link
            key={p.id}
            href={`${pathname}?${params.toString()}`}
            className={
              "rounded-md border px-2.5 py-1 text-xs transition-colors " +
              (isActive
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:bg-muted")
            }
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
