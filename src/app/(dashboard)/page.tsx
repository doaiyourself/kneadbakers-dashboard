import { BarChart } from "@/components/charts/BarChart";
import { Heatmap } from "@/components/charts/Heatmap";
import { LineChart } from "@/components/charts/LineChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { withMovingAverage } from "@/lib/analytics/transforms";
import { Insights } from "@/components/dashboard/Insights";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { DEFAULT_PRESET, PERIOD_PRESETS } from "@/lib/period-presets";
import {
  getChannelMix,
  getDailySeries,
  getDaypartSeries,
  getDowSeries,
  getHourlyHeatmap,
  getMonthlySeries,
  getPaymentMethodMix,
  getRangeSummary,
  getTopProducts,
  getWeeklySeries,
} from "@/lib/analytics/queries";
import { formatCount, formatKRW, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; preset?: string };

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Search> | Search;
}) {
  const sp = await searchParams;
  // 기본: 올해 전체 (2026-01-01 ~ 오늘)
  const preset = sp?.preset;
  const presetRange = preset ? PERIOD_PRESETS.find((p) => p.id === preset) : null;
  const from = sp?.from ?? presetRange?.from ?? DEFAULT_PRESET.from;
  const to = sp?.to ?? presetRange?.to ?? DEFAULT_PRESET.to;
  const range = { from, to };

  // 직전 동기 — 비교용
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const spanDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
  const prevFrom = new Date(fromDate.getTime() - spanDays * 86400000)
    .toISOString()
    .slice(0, 10);
  const prevTo = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);
  const prevRange = { from: prevFrom, to: prevTo };

  const [summary, prevSummary, monthly, weekly, daily, heatmap, dow, daypart, top, mix, channels] =
    await Promise.all([
      getRangeSummary(range),
      getRangeSummary(prevRange),
      getMonthlySeries(range),
      getWeeklySeries(range),
      getDailySeries(range),
      getHourlyHeatmap(range),
      getDowSeries(range),
      getDaypartSeries(range),
      getTopProducts({ ...range, limit: 10 }),
      getPaymentMethodMix(range),
      getChannelMix(range),
    ]);

  const noData = summary.orderCount === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">매출 대시보드</h1>
          <p className="text-sm text-muted-foreground">
            {from} ~ {to} · {spanDays}일 · 완료 주문 기준
          </p>
        </div>
        <PeriodSelector currentFrom={from} currentTo={to} />
      </header>

      {noData ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            이 기간에 데이터가 아직 없습니다. 백필이 진행 중이라면 잠시 후 새로고침 해주세요.
          </p>
        </div>
      ) : (
        <>
          {/* 총괄 KPI */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="총 매출"
              value={summary.revenue}
              prev={prevSummary.revenue}
              hint={`직전 ${spanDays}일`}
            />
            <KpiCard
              label="총 주문 건수"
              value={summary.orderCount}
              prev={prevSummary.orderCount}
              format="count"
              hint={`직전 ${spanDays}일`}
            />
            <KpiCard
              label="평균 객단가"
              value={summary.avgTicket}
              prev={prevSummary.avgTicket}
              hint={`직전 ${spanDays}일`}
            />
            <KpiCard
              label="일평균 매출"
              value={summary.dailyAvgRevenue}
              prev={prevSummary.dailyAvgRevenue}
              hint={`영업일 ${summary.activeDays}일 기준`}
            />
          </section>

          {/* 월별 비교 */}
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="font-semibold">월별 매출</h2>
              <p className="text-xs text-muted-foreground">{monthly.length}개월 데이터</p>
            </div>
            {monthly.length > 0 ? <BarChart data={monthly} xKey="month" yKey="revenue" /> : <Empty />}
          </section>

          {/* 일별 추이 + 7일 이동평균 */}
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="font-semibold">일별 매출 추이</h2>
              <p className="text-xs text-muted-foreground">
                {daily.length}일 · 굵은 선이 7일 이동평균 (변동성 제외한 추세)
              </p>
            </div>
            {daily.length > 0 ? (
              <TrendLineChart data={withMovingAverage(daily, 7)} />
            ) : (
              <Empty />
            )}
          </section>

          {/* 운영 인사이트 */}
          <Insights from={from} to={to} />

          {/* 주별 + 요일별 2단 */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold">주별 매출</h2>
                <p className="text-xs text-muted-foreground">{weekly.length}주</p>
              </div>
              {weekly.length > 0 ? (
                <LineChart data={weekly} xKey="weekStart" yKey="revenue" height={240} />
              ) : (
                <Empty />
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold">요일별 매출</h2>
                <p className="text-xs text-muted-foreground">평균 매출 패턴</p>
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

          {/* 시간대 히트맵 + 시간대 객단가 */}
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
                <p className="text-xs text-muted-foreground">시간대별 평균 단가</p>
              </div>
              {daypart.length > 0 ? (
                <div className="space-y-2.5">
                  {daypart.map((d) => (
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
                            width: `${Math.min(100, (d.avgTicket / Math.max(...daypart.map((x) => x.avgTicket || 1))) * 100).toFixed(1)}%`,
                          }}
                        />
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {formatCount(d.orderCount)}건 · {formatKRW(d.revenue)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptySmall />
              )}
            </div>
          </section>

          {/* 상품 / 채널 / 결제수단 — 3단 */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* 상품 랭킹 */}
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm lg:col-span-2">
              <h2 className="mb-4 font-semibold">인기 상품 TOP 10</h2>
              {top.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 font-normal">상품</th>
                      <th className="py-2 text-right font-normal">수량</th>
                      <th className="py-2 text-right font-normal">매출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((p, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="py-2">
                          <div className="font-medium">{p.itemTitle || "—"}</div>
                          {p.categoryTitle && (
                            <div className="text-[11px] text-muted-foreground">
                              {p.categoryTitle}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatCount(p.quantity)}</td>
                        <td className="py-2 text-right tabular-nums">{formatKRW(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty />
              )}
            </div>

            {/* 결제수단 + 채널 */}
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                <h2 className="mb-4 font-semibold">결제수단</h2>
                {mix.length > 0 ? (
                  <ShareBars
                    items={mix.map((m) => ({
                      label: m.method,
                      revenue: m.revenue,
                      share: m.share,
                    }))}
                  />
                ) : (
                  <EmptySmall />
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                <h2 className="mb-4 font-semibold">주문 채널</h2>
                {channels.length > 0 ? (
                  <ShareBars
                    items={channels.map((c) => ({
                      label: prettyChannel(c.source),
                      revenue: c.revenue,
                      share: c.share,
                    }))}
                  />
                ) : (
                  <EmptySmall />
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ShareBars({ items }: { items: Array<{ label: string; revenue: number; share: number }> }) {
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{it.label}</span>
            <span className="tabular-nums text-muted-foreground text-xs">
              {formatKRW(it.revenue)} · {formatPct(it.share)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-amber-500"
              style={{ width: `${(it.share * 100).toFixed(1)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function prettyChannel(source: string): string {
  if (source === "POS") return "POS";
  if (source === "KIOSK") return "키오스크";
  if (source.includes("BAEMIN")) return "배달의민족";
  if (source.includes("YOGIYO")) return "요기요";
  if (source.includes("COUPANG")) return "쿠팡이츠";
  if (source.includes("PLUGIN")) return source.replace("PLUGIN_", "").replace(/SCRAPING/i, "");
  return source;
}

function Empty() {
  return (
    <div className="rounded-md border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      이 기간에 데이터가 없습니다.
    </div>
  );
}

function EmptySmall() {
  return <p className="text-xs text-muted-foreground">데이터 없음.</p>;
}
