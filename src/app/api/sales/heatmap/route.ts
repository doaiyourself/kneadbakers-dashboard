import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHourlyHeatmap } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

/** GET /api/sales/heatmap?days=30 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? "30");

  try {
    const data = await getHourlyHeatmap(Number.isFinite(days) && days > 0 ? days : 30);
    return NextResponse.json({ days, data });
  } catch (e) {
    console.error("[/api/sales/heatmap]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
