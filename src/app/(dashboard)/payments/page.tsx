import { BarChart } from "@/components/charts/BarChart";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import {
  getCancellationStats,
  getCardAcquirerMix,
  getPaymentMethodMix,
} from "@/lib/analytics/queries";
import { DEFAULT_PRESET, PERIOD_PRESETS } from "@/lib/period-presets";
import { formatCount, formatKRW, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; preset?: string };

const METHOD_COLOR: Record<string, string> = {
  카드: "bg-amber-500",
  현금: "bg-emerald-500",
  QR결제: "bg-cyan-500",
  계좌이체: "bg-violet-500",
  선불지급수단: "bg-rose-500",
  기타: "bg-slate-400",
};

export default async function PaymentsPage({
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

  const [methods, acquirers, cancel] = await Promise.all([
    getPaymentMethodMix(range),
    getCardAcquirerMix(range),
    getCancellationStats(range),
  ]);

  const totalRevenue = methods.reduce((s, m) => s + m.revenue, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">결제 분석</h1>
          <p className="text-sm text-muted-foreground">
            {from} ~ {to} · 결제수단·카드사·취소율
          </p>
        </div>
        <PeriodSelector currentFrom={from} currentTo={to} />
      </header>

      {/* 요약 카드 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            총 결제 금액
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{formatKRW(totalRevenue)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {methods.length}개 결제수단
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            총 결제 건수
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {formatCount(cancel.totalPayments)}건
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">승인 + 취소 포함</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            취소 결제
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {formatCount(cancel.cancelledPayments)}건
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            취소율 {formatPct(cancel.cancelRate)} · {formatKRW(cancel.cancelledAmount)}
          </div>
        </div>
      </section>

      {/* 결제수단 비중 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">결제수단 비중</h2>
            <p className="text-xs text-muted-foreground">금액 기준</p>
          </div>
          {methods.length > 0 ? (
            <BarChart data={methods} xKey="method" yKey="revenue" height={240} />
          ) : (
            <Empty />
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">상세 비중</h2>
          </div>
          {methods.length > 0 ? (
            <div className="space-y-3">
              {methods.map((m) => (
                <div key={m.method}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{m.method}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatKRW(m.revenue)} · {formatCount(m.count)}건 · {formatPct(m.share)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${METHOD_COLOR[m.method] ?? "bg-slate-400"}`}
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

      {/* 카드사 분포 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">카드사별 결제</h2>
          <p className="text-xs text-muted-foreground">
            카드 결제 중 발급사(acquirer) 분포 · {acquirers.length}개 카드사
          </p>
        </div>
        {acquirers.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {acquirers.map((a) => (
              <div
                key={a.acquirer}
                className="rounded-md border border-border bg-muted/30 p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{a.acquirer}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatPct(a.share)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatKRW(a.revenue)} · {formatCount(a.count)}건
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${(a.share * 100).toFixed(1)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty />
        )}
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
