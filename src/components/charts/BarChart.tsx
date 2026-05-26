"use client";

import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatKRW } from "@/lib/utils";

export interface BarChartProps {
  data: ReadonlyArray<object>;
  xKey: string;
  yKey: string;
  yFormatter?: (v: number) => string;
  yLabel?: string;
  height?: number;
}

export function BarChart({
  data,
  xKey,
  yKey,
  yFormatter = (v) => formatKRW(v),
  yLabel = "매출",
  height = 280,
}: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data as object[]} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
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
        <Bar dataKey={yKey} fill="hsl(var(--primary, 25 95% 53%))" radius={[4, 4, 0, 0]} />
      </RBarChart>
    </ResponsiveContainer>
  );
}
