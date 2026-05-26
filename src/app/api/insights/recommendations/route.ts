import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateInsights } from "@/lib/ai/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/insights/recommendations?from=...&to=...&windowDays=30 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const windowDays = Number(url.searchParams.get("windowDays") ?? "30");
  try {
    const data = await generateInsights({
      from,
      to,
      fallbackDays: Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 30,
    });
    return NextResponse.json(data);
  } catch (e) {
    console.error("[/api/insights/recommendations]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
