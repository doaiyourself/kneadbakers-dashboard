"use client";

import { useEffect, useState } from "react";

/**
 * 상단 바 — 매장명/현재 시각 표시.
 * 기간 선택은 페이지 헤더의 PeriodSelector가 담당.
 */
export function TopBar() {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    function tick() {
      const d = new Date();
      const k = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
      const pad = (n: number) => n.toString().padStart(2, "0");
      setNow(
        `${k.getFullYear()}-${pad(k.getMonth() + 1)}-${pad(k.getDate())} ${pad(k.getHours())}:${pad(k.getMinutes())}`,
      );
    }
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 pl-16 md:px-6 md:pl-6">
      <div className="text-sm font-medium">니드 베이커스</div>
      <div className="text-[10px] text-muted-foreground tabular-nums sm:text-xs">
        {now} <span className="hidden sm:inline">KST</span>
      </div>
    </header>
  );
}
