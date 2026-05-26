import { formatCount, formatKRW, formatPct } from "@/lib/utils";

export interface KpiCardProps {
  label: string;
  value: number | null | undefined;
  /** 비교 — 이전 동기 값 (있으면 ↗ ↘ + 변동률 표시) */
  prev?: number | null;
  format?: "krw" | "count";
  hint?: string;
}

export function KpiCard({ label, value, prev, format = "krw", hint }: KpiCardProps) {
  const fmt = format === "krw" ? formatKRW : formatCount;
  const delta =
    typeof value === "number" && typeof prev === "number" && prev > 0
      ? (value - prev) / prev
      : null;
  const up = delta !== null && delta > 0;
  const down = delta !== null && delta < 0;

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{fmt(value)}</div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        {delta !== null ? (
          <>
            <span
              className={
                up ? "text-emerald-600" : down ? "text-rose-600" : "text-muted-foreground"
              }
            >
              {up ? "↗" : down ? "↘" : "→"} {formatPct(Math.abs(delta), 1)}
            </span>
            <span>vs {hint ?? "이전 동기"}</span>
          </>
        ) : (
          <span>{hint ?? ""}</span>
        )}
      </div>
    </div>
  );
}
