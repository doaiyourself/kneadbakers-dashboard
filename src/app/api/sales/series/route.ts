import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDailySeries, getMonthlySeries, getWeeklySeries } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales/series?period=monthly|weekly|daily&from=...&to=...&n=...
 * - from/to (YYYY-MM-DD) 우선
 * - 없으면 n (개월/주/일) — 기본 monthly=12, weekly=12, daily=30
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "monthly";
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const n = Number(url.searchParams.get("n") ?? "");

  try {
    if (period === "monthly") {
      const data = await getMonthlySeries({
        from,
        to,
        months: Number.isFinite(n) && n > 0 ? n : 12,
      });
      return NextResponse.json({ period, data });
    }
    if (period === "weekly") {
      const data = await getWeeklySeries({
        from,
        to,
        weeks: Number.isFinite(n) && n > 0 ? n : 12,
      });
      return NextResponse.json({ period, data });
    }
    if (period === "daily") {
      const data = await getDailySeries({
        from,
        to,
        days: Number.isFinite(n) && n > 0 ? n : 30,
      });
      return NextResponse.json({ period, data });
    }
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  } catch (e) {
    console.error("[/api/sales/series]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
