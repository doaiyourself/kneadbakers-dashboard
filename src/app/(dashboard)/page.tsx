import { Insights } from "@/components/dashboard/Insights";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { LineChart } from "@/components/charts/LineChart";
import {
  getDailySeries,
  getKpiSummary,
  getPaymentMethodMix,
  getTopProducts,
} from "@/lib/analytics/queries";
import { formatCount, formatKRW, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [kpi, daily, top, mix] = await Promise.all([
    getKpiSummary(),
    getDailySeries(30),
    getTopProducts(30, 8),
    getPaymentMethodMix(30),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-semibold">대시보드</h1>
        <p className="text-sm text-muted-foreground">
          {kpi.lastOrderAt ? `최신 주문: ${kpi.lastOrderAt}` : "데이터 없음"}
        </p>
      </header>

      {/* KPI 카드 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="오늘 매출"
          value={kpi.today.revenue}
          prev={kpi.yesterday.revenue}
          hint="어제"
        />
        <KpiCard
          label="오늘 주문"
          value={kpi.today.orderCount}
          prev={kpi.yesterday.orderCount}
          format="count"
          hint="어제"
        />
        <KpiCard
          label="오늘 객단가"
          value={kpi.today.avgTicket}
          prev={kpi.yesterday.avgTicket}
          hint="어제"
        />
        <KpiCard
          label="이번주 매출"
          value={kpi.thisWeek.revenue}
          prev={kpi.lastWeek.revenue}
          hint="지난주"
        />
        <KpiCard
          label="이번달 매출"
          value={kpi.thisMonth.revenue}
          prev={kpi.lastMonth.revenue}
          hint="지난달"
        />
        <KpiCard
          label="이번달 주문"
          value={kpi.thisMonth.orderCount}
          prev={kpi.lastMonth.orderCount}
          format="count"
          hint="지난달"
        />
        <KpiCard
          label="이번달 객단가"
          value={kpi.thisMonth.avgTicket}
          prev={kpi.lastMonth.avgTicket}
          hint="지난달"
        />
        <KpiCard
          label="이번달 취소"
          value={kpi.thisMonth.cancelledCount}
          prev={kpi.lastMonth.cancelledCount}
          format="count"
          hint="지난달"
        />
      </section>

      {/* 일별 매출 추이 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <h2 className="font-semibold">지난 30일 매출 추이</h2>
            <p className="text-xs text-muted-foreground">일별 완료 주문 기준</p>
          </div>
        </div>
        {daily.length > 0 ? (
          <LineChart data={daily} xKey="date" yKey="revenue" />
        ) : (
          <Empty />
        )}
      </section>

      {/* AI 운영 추천 */}
      <Insights />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 상품 랭킹 */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">인기 상품 TOP 8 (30일)</h2>
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
                        <div className="text-[11px] text-muted-foreground">{p.categoryTitle}</div>
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

        {/* 결제수단 비중 */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">결제수단 비중 (30일)</h2>
          {mix.length > 0 ? (
            <div className="space-y-3">
              {mix.map((m) => (
                <div key={m.method}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{m.method}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatKRW(m.revenue)} · {formatPct(m.share)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-amber-500"
                      style={{ width: `${(m.share * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
              ))}
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
      아직 데이터가 없습니다. 백필이 끝났는지 확인해주세요 (npm run backfill).
    </div>
  );
}
