"use client";

import { useState } from "react";

export function TopBar() {
  // 프롬프트 5에서 실제 동기화 시각, 기간 탭, 새로고침 동작과 연결.
  // 지금은 셋업 단계 placeholder.
  const [tab, setTab] = useState<"today" | "week" | "month">("today");
  const tabs = [
    { key: "today", label: "오늘" },
    { key: "week", label: "이번 주" },
    { key: "month", label: "이번 달" },
  ] as const;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">데이터 갱신: —</div>
    </header>
  );
}
