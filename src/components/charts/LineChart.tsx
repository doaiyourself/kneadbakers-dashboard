"use client";

import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatKRW } from "@/lib/utils";

export interface LineChartProps {
  data: ReadonlyArray<object>;
  xKey: string;
  yKey: string;
  /** y축 포맷터 — 기본 원화 */
  yFormatter?: (v: number) => string;
  /** 라벨 — 툴팁용 */
  yLabel?: string;
  height?: number;
}

export function LineChart({
  data,
  xKey,
  yKey,
  yFormatter = (v) => formatKRW(v),
  yLabel = "매출",
  height = 280,
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart data={data as object[]} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => yFormatter(Number(v)).replace("₩", "")}
          width={60}
        />
        <Tooltip
          formatter={(v: unknown) => [yFormatter(Number(v)), yLabel]}
          contentStyle={{
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))",
          }}
        />
        <Line
          type="monotone"
          dataKey={yKey}
          stroke="hsl(var(--primary, 25 95% 53%))"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </RLineChart>
    </ResponsiveContainer>
  );
}
