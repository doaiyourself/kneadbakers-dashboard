"use client";

import useSWR from "swr";
import type { InsightsResult, Recommendation } from "@/lib/ai/insights";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KIND_STYLE: Record<Recommendation["kind"], { icon: string; bg: string }> = {
  celebrate: { icon: "🎉", bg: "bg-emerald-50 border-emerald-200" },
  increase: { icon: "📈", bg: "bg-amber-50 border-amber-200" },
  decrease: { icon: "📉", bg: "bg-slate-50 border-slate-200" },
  investigate: { icon: "🔍", bg: "bg-blue-50 border-blue-200" },
};

const PRI_STYLE: Record<Recommendation["priority"], string> = {
  고: "bg-rose-100 text-rose-700",
  중: "bg-amber-100 text-amber-700",
  저: "bg-slate-100 text-slate-600",
};

export function Insights() {
  const { data, error, isLoading } = useSWR<InsightsResult>(
    "/api/insights/recommendations?windowDays=30",
    fetcher,
    {
      // Claude 호출이 비싸서 자동 재요청 끔
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
    },
  );

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">🤖 AI 운영 추천</h2>
        <p className="mt-2 text-xs text-muted-foreground">분석 중… (Claude 호출 5-15초)</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">🤖 AI 운영 추천</h2>
        <p className="mt-2 text-xs text-rose-600">불러오기 실패. 잠시 후 다시 시도해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-semibold">🤖 AI 운영 추천</h2>
        <span className="text-[11px] text-muted-foreground">
          {data.source === "claude" ? "Claude 분석" : "Rule-based"} · {data.windowDays}일 윈도우
        </span>
      </div>

      <p className="mb-4 rounded-md bg-muted/50 p-3 text-sm leading-relaxed">{data.summary}</p>

      <ul className="space-y-2">
        {data.recommendations.map((r, i) => {
          const s = KIND_STYLE[r.kind];
          return (
            <li key={i} className={`rounded-md border px-3 py-2.5 ${s.bg}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  <span className="mr-1">{s.icon}</span>
                  {r.title}
                </h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PRI_STYLE[r.priority]}`}>
                  {r.priority}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-700">{r.detail}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
