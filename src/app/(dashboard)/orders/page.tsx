import Link from "next/link";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { listOrders } from "@/lib/analytics/queries";
import { DEFAULT_PRESET, PERIOD_PRESETS } from "@/lib/period-presets";
import { formatCount, formatKRW } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = {
  from?: string;
  to?: string;
  preset?: string;
  source?: string;
  state?: string;
  q?: string;
  page?: string;
};

const PAGE_SIZE = 50;

function channelLabel(source: string): string {
  if (source === "POS") return "POS";
  if (source === "KIOSK") return "키오스크";
  if (source.includes("BAEMIN")) return "배민";
  if (source.includes("YOGIYO")) return "요기요";
  if (source.includes("COUPANG")) return "쿠팡";
  if (source.includes("PLUGIN")) return source.replace("PLUGIN_", "").replace(/SCRAPING/i, "");
  return source;
}

const STATE_STYLE: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
  OPENED: "bg-amber-100 text-amber-700",
  REQUESTED: "bg-blue-100 text-blue-700",
  UNDEFINED: "bg-slate-100 text-slate-600",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Search> | Search;
}) {
  const sp = await searchParams;
  const preset = sp?.preset;
  const presetRange = preset ? PERIOD_PRESETS.find((p) => p.id === preset) : null;
  const from = sp?.from ?? presetRange?.from ?? DEFAULT_PRESET.from;
  const to = sp?.to ?? presetRange?.to ?? DEFAULT_PRESET.to;
  const source = sp?.source;
  const state = sp?.state;
  const q = sp?.q;
  const page = Math.max(1, Number(sp?.page ?? "1"));
  const offset = (page - 1) * PAGE_SIZE;

  const { items, total } = await listOrders({
    from,
    to,
    source,
    orderState: state,
    search: q,
    limit: PAGE_SIZE,
    offset,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    if (source) params.set("source", source);
    if (state) params.set("state", state);
    if (q) params.set("q", q);
    params.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    return `/orders?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">주문 조회</h1>
          <p className="text-sm text-muted-foreground">
            {from} ~ {to} · 총 {formatCount(total)}건
          </p>
        </div>
        <PeriodSelector currentFrom={from} currentTo={to} />
      </header>

      {/* 필터 */}
      <form
        action="/orders"
        method="GET"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm"
      >
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="주문ID 또는 주문번호 검색…"
          className="flex-1 min-w-[180px] rounded-md border border-border bg-background px-3 py-1.5 text-xs"
        />
        <select
          name="source"
          defaultValue={source ?? ""}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="">전체 채널</option>
          <option value="POS">POS</option>
          <option value="KIOSK">키오스크</option>
          <option value="PLUGIN_BAEMINSCRAPING">배달의민족</option>
          <option value="PLUGIN_YOGIYOSCRAPING">요기요</option>
          <option value="PLUGIN_COUPANGEATSSCRAPING">쿠팡이츠</option>
        </select>
        <select
          name="state"
          defaultValue={state ?? ""}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="">전체 상태</option>
          <option value="COMPLETED">완료</option>
          <option value="CANCELLED">취소</option>
          <option value="OPENED">진행중</option>
          <option value="REQUESTED">요청</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          검색
        </button>
        {(q || source || state) && (
          <Link
            href={`/orders?from=${from}&to=${to}`}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            초기화
          </Link>
        )}
      </form>

      {/* 테이블 */}
      <section className="rounded-lg border border-border bg-card shadow-sm">
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-normal">시각 (KST)</th>
                  <th className="px-4 py-2.5 font-normal">채널</th>
                  <th className="px-4 py-2.5 font-normal">상태</th>
                  <th className="px-4 py-2.5 font-normal">주문번호</th>
                  <th className="px-4 py-2.5 text-right font-normal">라인</th>
                  <th className="px-4 py-2.5 font-normal">결제수단</th>
                  <th className="px-4 py-2.5 text-right font-normal">금액</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 tabular-nums text-xs text-muted-foreground">
                      {o.completedAt ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs">{channelLabel(o.source)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATE_STYLE[o.orderState] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {o.orderState}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{o.orderNumber ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {o.lineCount}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {o.paymentMethods.length > 0 ? o.paymentMethods.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {formatKRW(o.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            조건에 맞는 주문이 없습니다.
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs">
            <span className="text-muted-foreground">
              {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} / {formatCount(total)}건
            </span>
            <div className="flex gap-1">
              <PageLink
                href={buildHref({ page: String(Math.max(1, page - 1)) })}
                disabled={page === 1}
                label="← 이전"
              />
              <span className="px-3 py-1 tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <PageLink
                href={buildHref({ page: String(Math.min(totalPages, page + 1)) })}
                disabled={page >= totalPages}
                label="다음 →"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled)
    return (
      <span className="cursor-not-allowed rounded-md border border-border px-3 py-1 text-muted-foreground opacity-50">
        {label}
      </span>
    );
  return (
    <Link href={href} className="rounded-md border border-border px-3 py-1 hover:bg-muted">
      {label}
    </Link>
  );
}
