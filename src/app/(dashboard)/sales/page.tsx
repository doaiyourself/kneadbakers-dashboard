import { BarChart } from "@/components/charts/BarChart";
import { Heatmap } from "@/components/charts/Heatmap";
import { LineChart } from "@/components/charts/LineChart";
import {
  getHourlyHeatmap,
  getMonthlySeries,
  getWeeklySeries,
} from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const [monthly, weekly, heatmap] = await Promise.all([
    getMonthlySeries(12),
    getWeeklySeries(12),
    getHourlyHeatmap(30),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-semibold">매출 분석</h1>
        <p className="text-sm text-muted-foreground">월별 · 주별 · 시간대별 매출 패턴</p>
      </header>

      {/* 월별 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">월별 매출 (최근 12개월)</h2>
          <p className="text-xs text-muted-foreground">
            {monthly.length}개월 데이터 · COMPLETED 주문 기준
          </p>
        </div>
        {monthly.length > 0 ? (
          <BarChart data={monthly} xKey="month" yKey="revenue" />
        ) : (
          <Empty />
        )}
      </section>

      {/* 주별 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">주별 매출 (최근 12주, 월요일 시작)</h2>
        </div>
        {weekly.length > 0 ? (
          <LineChart data={weekly} xKey="weekStart" yKey="revenue" />
        ) : (
          <Empty />
        )}
      </section>

      {/* 시간대 히트맵 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">시간대 매출 히트맵 (최근 30일)</h2>
          <p className="text-xs text-muted-foreground">요일 × 시간 — 영업시간 7-23시 표시</p>
        </div>
        {heatmap.length > 0 ? <Heatmap cells={heatmap} metric="revenue" /> : <Empty />}
      </section>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-md border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      아직 데이터가 없습니다.
    </div>
  );
}
