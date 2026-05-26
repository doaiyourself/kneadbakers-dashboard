import { BarChart } from "@/components/charts/BarChart";
import { Heatmap } from "@/components/charts/Heatmap";
import { LineChart } from "@/components/charts/LineChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import {
  getDailySeries,
  getDaypartSeries,
  getDowSeries,
  getHourlyHeatmap,
  getMonthlySeries,
  getWeeklySeries,
} from "@/lib/analytics/queries";
import { withMovingAverage } from "@/lib/analytics/transforms";
import { DEFAULT_PRESET, PERIOD_PRESETS } from "@/lib/period-presets";
import { formatCount, formatKRW } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; preset?: string };

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Search> | Search;
}) {
  const sp = await searchParams;
  const preset = sp?.preset;
  const presetRange = preset ? PERIOD_PRESETS.find((p) => p.id === preset) : null;
  const from = sp?.from ?? presetRange?.from ?? DEFAULT_PRESET.from;
  const to = sp?.to ?? presetRange?.to ?? DEFAULT_PRESET.to;
  const range = { from, to };

  const [monthly, weekly, daily, heatmap, dow, daypart] = await Promise.all([
    getMonthlySeries(range),
    getWeeklySeries(range),
    getDailySeries(range),
    getHourlyHeatmap(range),
    getDowSeries(range),
    getDaypartSeries(range),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">매출 분석</h1>
          <p className="text-sm text-muted-foreground">
            {from} ~ {to} · 월별·주별·시간대별 매출 패턴
          </p>
        </div>
        <PeriodSelector currentFrom={from} currentTo={to} />
      </header>

      {/* 월별 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">월별 매출</h2>
          <p className="text-xs text-muted-foreground">{monthly.length}개월 데이터</p>
        </div>
        {monthly.length > 0 ? <BarChart data={monthly} xKey="month" yKey="revenue" /> : <Empty />}
      </section>

      {/* 일별 + 이동평균 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">일별 매출 + 7일 이동평균</h2>
          <p className="text-xs text-muted-foreground">{daily.length}일 · 굵은 선이 추세</p>
        </div>
        {daily.length > 0 ? <TrendLineChart data={withMovingAverage(daily, 7)} /> : <Empty />}
      </section>

      {/* 주별 + 요일별 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">주별 매출</h2>
            <p className="text-xs text-muted-foreground">월요일 시작 · {weekly.length}주</p>
          </div>
          {weekly.length > 0 ? (
            <LineChart data={weekly} xKey="weekStart" yKey="revenue" height={240} />
          ) : (
            <Empty />
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">요일별 매출 패턴</h2>
            <p className="text-xs text-muted-foreground">기간 합계</p>
          </div>
          {dow.length > 0 ? (
            <BarChart
              data={dow.map((d) => ({ ...d, label: DOW_LABEL[d.dow] }))}
              xKey="label"
              yKey="revenue"
              height={240}
            />
          ) : (
            <Empty />
          )}
        </div>
      </section>

      {/* 시간대 + 시간대 객단가 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <div className="mb-4">
            <h2 className="font-semibold">시간대 매출 히트맵</h2>
            <p className="text-xs text-muted-foreground">요일 × 시간 · 영업시간 7-23시</p>
          </div>
          {heatmap.length > 0 ? <Heatmap cells={heatmap} metric="revenue" /> : <Empty />}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">시간대 객단가</h2>
          </div>
          {daypart.length > 0 ? (
            <div className="space-y-2.5">
              {daypart.map((d) => {
                const maxTicket = Math.max(...daypart.map((x) => x.avgTicket || 1));
                return (
                  <div key={d.daypart}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">{d.daypart}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {formatKRW(d.avgTicket)}
                      </span>
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-amber-500"
                        style={{
                          width: `${Math.min(100, (d.avgTicket / maxTicket) * 100).toFixed(1)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatCount(d.orderCount)}건 · {formatKRW(d.revenue)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty />
          )}
        </div>
      </section>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-md border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      이 기간에 데이터가 없습니다.
    </div>
  );
}
