import { BarChart } from "@/components/charts/BarChart";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import {
  getChannelDailySeries,
  getChannelMix,
  getChannelTopProducts,
} from "@/lib/analytics/queries";
import { DEFAULT_PRESET, PERIOD_PRESETS } from "@/lib/period-presets";
import { formatCount, formatKRW, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; preset?: string };

/** 토스 source 코드 → 사람이 읽는 이름 */
function prettyChannel(source: string): { label: string; emoji: string; color: string } {
  if (source === "POS") return { label: "POS", emoji: "💳", color: "bg-amber-500" };
  if (source === "KIOSK") return { label: "키오스크", emoji: "🖥️", color: "bg-emerald-500" };
  if (source.includes("BAEMIN"))
    return { label: "배달의민족", emoji: "🛵", color: "bg-cyan-500" };
  if (source.includes("YOGIYO")) return { label: "요기요", emoji: "🛵", color: "bg-rose-500" };
  if (source.includes("COUPANG"))
    return { label: "쿠팡이츠", emoji: "🛵", color: "bg-orange-500" };
  if (source.includes("PLUGIN")) {
    const tag = source.replace("PLUGIN_", "").replace(/SCRAPING/i, "");
    return { label: tag || source, emoji: "🔌", color: "bg-slate-500" };
  }
  return { label: source, emoji: "📦", color: "bg-slate-400" };
}

export default async function ChannelsPage({
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

  const [channels, daily, perChannelTop] = await Promise.all([
    getChannelMix(range),
    getChannelDailySeries(range),
    getChannelTopProducts({ ...range, perChannel: 5 }),
  ]);

  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);

  // 채널별 상품 그룹화
  const topBySource: Record<string, typeof perChannelTop> = {};
  for (const r of perChannelTop) {
    if (!topBySource[r.source]) topBySource[r.source] = [];
    topBySource[r.source]!.push(r);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">채널 분석</h1>
          <p className="text-sm text-muted-foreground">
            {from} ~ {to} · 주문 채널별 매출과 패턴
          </p>
        </div>
        <PeriodSelector currentFrom={from} currentTo={to} />
      </header>

      {/* 채널 카드 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {channels.map((c) => {
          const p = prettyChannel(c.source);
          return (
            <div
              key={c.source}
              className="rounded-lg border border-border bg-card p-5 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{p.emoji}</span>
                  <div>
                    <h3 className="font-semibold">{p.label}</h3>
                    <p className="text-[10px] text-muted-foreground">{c.source}</p>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                  {formatPct(c.share)}
                </span>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">매출</span>
                  <span className="font-semibold tabular-nums">{formatKRW(c.revenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">주문</span>
                  <span className="tabular-nums">{formatCount(c.count)}건</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">객단가</span>
                  <span className="tabular-nums">{formatKRW(c.avgTicket)}</span>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${p.color}`}
                  style={{ width: `${(c.share * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </section>

      {/* 채널 비중 + 객단가 비교 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">채널별 매출 비교</h2>
            <p className="text-xs text-muted-foreground">총 {formatKRW(totalRevenue)}</p>
          </div>
          {channels.length > 0 ? (
            <BarChart
              data={channels.map((c) => ({
                ...c,
                label: prettyChannel(c.source).label,
              }))}
              xKey="label"
              yKey="revenue"
              height={240}
            />
          ) : (
            <Empty />
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">채널별 객단가</h2>
            <p className="text-xs text-muted-foreground">평균 주문 금액</p>
          </div>
          {channels.length > 0 ? (
            <BarChart
              data={channels.map((c) => ({
                ...c,
                label: prettyChannel(c.source).label,
              }))}
              xKey="label"
              yKey="avgTicket"
              yLabel="객단가"
              height={240}
            />
          ) : (
            <Empty />
          )}
        </div>
      </section>

      {/* 채널별 인기 상품 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">채널별 인기 상품 TOP 5</h2>
          <p className="text-xs text-muted-foreground">
            채널마다 어떤 상품이 많이 팔리는지 비교 — 채널별 메뉴 전략 도출
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(topBySource).map(([source, items]) => {
            const p = prettyChannel(source);
            return (
              <div key={source} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span>{p.emoji}</span>
                  <span>{p.label}</span>
                </div>
                <ol className="space-y-1 text-xs">
                  {items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">
                        <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                        {it.itemTitle}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatCount(it.quantity)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-[10px] text-muted-foreground">
        {daily.length > 0 ? `${daily.length}개 채널·일자 조합 데이터 분석됨.` : ""}
      </p>
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
