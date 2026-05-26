"use client";

import { formatCount, formatKRW } from "@/lib/utils";

export interface HeatmapCell {
  dow: number;
  hour: number;
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export interface HeatmapProps {
  cells: HeatmapCell[];
  /** 시간 범위 — 영업시간만 표시 (기본 7-23) */
  hourFrom?: number;
  hourTo?: number;
  /** 색칠 기준 metric */
  metric?: "revenue" | "orderCount";
}

export function Heatmap({
  cells,
  hourFrom = 7,
  hourTo = 23,
  metric = "revenue",
}: HeatmapProps) {
  // 매트릭스 [dow][hour] = cell
  const matrix: Record<string, HeatmapCell> = {};
  let max = 0;
  for (const c of cells) {
    matrix[`${c.dow}-${c.hour}`] = c;
    const v = metric === "revenue" ? c.revenue : c.orderCount;
    if (v > max) max = v;
  }

  const hours = Array.from({ length: hourTo - hourFrom + 1 }, (_, i) => hourFrom + i);
  const dows = [1, 2, 3, 4, 5, 6, 0]; // 월~일

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-[11px]">
        <thead>
          <tr>
            <th className="w-8" />
            {hours.map((h) => (
              <th
                key={h}
                className="px-1 py-1 text-center font-normal text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dows.map((d) => (
            <tr key={d}>
              <th className="w-8 pr-2 text-right font-medium text-muted-foreground">
                {DOW[d]}
              </th>
              {hours.map((h) => {
                const cell = matrix[`${d}-${h}`];
                const v = cell ? (metric === "revenue" ? cell.revenue : cell.orderCount) : 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <td
                    key={h}
                    title={
                      cell
                        ? `${DOW[d]} ${h}시\n매출 ${formatKRW(cell.revenue)}\n주문 ${formatCount(cell.orderCount)}건`
                        : `${DOW[d]} ${h}시 — 데이터 없음`
                    }
                    className="aspect-square min-w-[28px] rounded text-center text-[10px] tabular-nums"
                    style={{
                      backgroundColor:
                        intensity > 0
                          ? `hsl(25, 95%, ${Math.max(40, 95 - intensity * 50)}%)`
                          : "hsl(var(--muted))",
                      color: intensity > 0.5 ? "white" : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {cell && cell.orderCount > 0 ? cell.orderCount : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-muted-foreground">
        셀 숫자: 주문 건수. 색 진하기: {metric === "revenue" ? "매출" : "주문 건수"} 비중.
      </div>
    </div>
  );
}
