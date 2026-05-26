import Link from "next/link";
import { BarChart } from "@/components/charts/BarChart";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import {
  getCategoryRollup,
  getProductPairs,
  getProductSales,
} from "@/lib/analytics/queries";
import { DEFAULT_PRESET, PERIOD_PRESETS } from "@/lib/period-presets";
import { formatCount, formatKRW, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; preset?: string; category?: string };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Search> | Search;
}) {
  const sp = await searchParams;
  const preset = sp?.preset;
  const presetRange = preset ? PERIOD_PRESETS.find((p) => p.id === preset) : null;
  const from = sp?.from ?? presetRange?.from ?? DEFAULT_PRESET.from;
  const to = sp?.to ?? presetRange?.to ?? DEFAULT_PRESET.to;
  const category = sp?.category;
  const range = { from, to };

  const [categories, products, pairs] = await Promise.all([
    getCategoryRollup(range),
    getProductSales({ ...range, category, limit: 200 }),
    getProductPairs({ ...range, limit: 15 }),
  ]);

  const totalRev = products.reduce((s, p) => s + p.revenue, 0);
  const totalQty = products.reduce((s, p) => s + p.quantity, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">상품 분석</h1>
          <p className="text-sm text-muted-foreground">
            {from} ~ {to} · {products.length}개 상품 · 완료 주문 기준
          </p>
        </div>
        <PeriodSelector currentFrom={from} currentTo={to} />
      </header>

      {/* 카테고리 비중 + 차트 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-semibold">카테고리별 매출</h2>
          <span className="text-xs text-muted-foreground">{categories.length}개 카테고리</span>
        </div>
        {categories.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BarChart
              data={categories.slice(0, 12)}
              xKey="category"
              yKey="revenue"
              height={260}
            />
            <div className="space-y-2.5">
              {categories.slice(0, 8).map((c) => {
                const isActive = category === c.category;
                const params = new URLSearchParams({ from, to });
                if (!isActive) params.set("category", c.category);
                return (
                  <Link
                    key={c.category}
                    href={`/products?${params.toString()}`}
                    className={
                      "block rounded-md border p-3 transition-colors " +
                      (isActive
                        ? "border-foreground bg-foreground/5"
                        : "border-border hover:bg-muted")
                    }
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span className="font-medium">{c.category}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatKRW(c.revenue)} · {formatPct(c.share)}
                      </span>
                    </div>
                    <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${(c.share * 100).toFixed(1)}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.productCount}개 상품 · {formatCount(c.quantity)}개 판매
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          <Empty />
        )}
      </section>

      {/* 카테고리 필터 안내 */}
      {category && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span>
            필터: <strong>{category}</strong>
          </span>
          <Link
            href={`/products?from=${from}&to=${to}`}
            className="text-xs text-muted-foreground underline"
          >
            전체 보기
          </Link>
        </div>
      )}

      {/* 카니발리제이션 — 자주 묶이는 상품 쌍 */}
      {pairs.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">자주 묶이는 상품 조합</h2>
            <p className="text-xs text-muted-foreground">
              같은 주문에서 동시 주문된 쌍 TOP 15 · 세트/사이드 추천에 활용
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {pairs.map((p, i) => (
              <div
                key={i}
                className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium leading-tight">
                    {p.productA} <span className="text-muted-foreground">+</span> {p.productB}
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {p.coOrders}회
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 전체 상품 테이블 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-semibold">상품 전체 랭킹</h2>
          <span className="text-xs text-muted-foreground">
            총 {formatCount(totalQty)}개 · {formatKRW(totalRev)}
          </span>
        </div>
        {products.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 font-normal">#</th>
                  <th className="py-2 font-normal">상품</th>
                  <th className="py-2 font-normal">카테고리</th>
                  <th className="py-2 text-right font-normal">판매수량</th>
                  <th className="py-2 text-right font-normal">주문수</th>
                  <th className="py-2 text-right font-normal">평균단가</th>
                  <th className="py-2 text-right font-normal">매출</th>
                  <th className="py-2 text-right font-normal">비중</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr
                    key={`${p.itemTitle}-${p.categoryTitle ?? ""}`}
                    className="border-b border-border/40 last:border-0 hover:bg-muted/30"
                  >
                    <td className="py-2 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="py-2 font-medium">{p.itemTitle || "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {p.categoryTitle || "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatCount(p.quantity)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {formatCount(p.orderCount)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatKRW(p.avgPrice)}</td>
                    <td className="py-2 text-right tabular-nums">{formatKRW(p.revenue)}</td>
                    <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {totalRev > 0 ? formatPct(p.revenue / totalRev) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
