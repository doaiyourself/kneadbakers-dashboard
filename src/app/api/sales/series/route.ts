import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDailySeries, getMonthlySeries, getWeeklySeries } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales/series?period=monthly|weekly|daily&n=12
 * - monthly: n개월 (기본 12)
 * - weekly:  n주 (기본 12)
 * - daily:   n일 (기본 30)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "monthly";
  const n = Number(url.searchParams.get("n") ?? "");

  try {
    if (period === "monthly") {
      const months = Number.isFinite(n) && n > 0 ? n : 12;
      const data = await getMonthlySeries(months);
      return NextResponse.json({ period, data });
    }
    if (period === "weekly") {
      const weeks = Number.isFinite(n) && n > 0 ? n : 12;
      const data = await getWeeklySeries(weeks);
      return NextResponse.json({ period, data });
    }
    if (period === "daily") {
      const days = Number.isFinite(n) && n > 0 ? n : 30;
      const data = await getDailySeries(days);
      return NextResponse.json({ period, data });
    }
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  } catch (e) {
    console.error("[/api/sales/series]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
