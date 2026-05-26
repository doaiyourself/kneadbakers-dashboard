/**
 * 대시보드 기간 preset.
 * 서버/클라이언트 양쪽에서 import 가능하도록 "use client" 없음.
 */

export interface PeriodPreset {
  id: string;
  label: string;
  from: string;
  to: string;
}

/** 오늘 (KST 기준) — yyyy-MM-dd */
function todayKst(): string {
  const now = new Date();
  const d = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return d.toISOString().slice(0, 10);
}

export const PERIOD_PRESETS: PeriodPreset[] = [
  { id: "2026-all", label: "올해 전체", from: "2026-01-01", to: todayKst() },
  { id: "2026-q1", label: "1~4월", from: "2026-01-01", to: "2026-04-30" },
  { id: "2026-q1-only", label: "1분기", from: "2026-01-01", to: "2026-03-31" },
  { id: "2026-jan", label: "1월", from: "2026-01-01", to: "2026-01-31" },
  { id: "2026-feb", label: "2월", from: "2026-02-01", to: "2026-02-28" },
  { id: "2026-mar", label: "3월", from: "2026-03-01", to: "2026-03-31" },
  { id: "2026-apr", label: "4월", from: "2026-04-01", to: "2026-04-30" },
  { id: "2026-may", label: "5월", from: "2026-05-01", to: "2026-05-31" },
];

export const DEFAULT_PRESET: PeriodPreset = PERIOD_PRESETS[0]!;
