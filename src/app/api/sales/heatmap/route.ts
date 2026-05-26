import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHourlyHeatmap } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

/** GET /api/sales/heatmap?days=30&from=...&to=... */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const days = Number(url.searchParams.get("days") ?? "30");

  try {
    const data = await getHourlyHeatmap({
      from,
      to,
      days: Number.isFinite(days) && days > 0 ? days : 30,
    });
    return NextResponse.json({ from, to, days, data });
  } catch (e) {
    console.error("[/api/sales/heatmap]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
