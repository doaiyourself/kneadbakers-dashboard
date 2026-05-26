"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatKRW } from "@/lib/utils";

export interface TrendPoint {
  date: string;
  revenue: number;
  /** 이동평균 (7일) */
  ma7?: number;
}

/**
 * 일별 매출 + 7일 이동평균 오버레이.
 * 실제 매출의 변동성과 추세선을 한 차트에서 비교.
 */
export function TrendLineChart({
  data,
  height = 280,
}: {
  data: ReadonlyArray<TrendPoint>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart data={data as TrendPoint[]} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => formatKRW(v).replace("₩", "")}
          width={60}
        />
        <Tooltip
          formatter={(v: unknown, name: unknown) => [
            formatKRW(Number(v)),
            name === "revenue" ? "일 매출" : "7일 이동평균",
          ]}
          contentStyle={{
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))",
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          formatter={(v) => (v === "revenue" ? "일 매출" : "7일 이동평균")}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="#BA7517"
          strokeWidth={1.5}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="ma7"
          stroke="#3D2E1F"
          strokeWidth={2.5}
          strokeDasharray="0"
          dot={false}
        />
      </RLineChart>
    </ResponsiveContainer>
  );
}

// withMovingAverage 는 server component에서도 호출 가능해야 하므로
// src/lib/analytics/transforms.ts 로 이전됨.
