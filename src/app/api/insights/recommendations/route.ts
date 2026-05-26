import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateInsights } from "@/lib/ai/insights";

export const dynamic = "force-dynamic";
// Claude API 호출이 길 수 있어 60초까지 허용 (Vercel Hobby 한계)
export const maxDuration = 60;

/** GET /api/insights/recommendations?windowDays=30 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("windowDays") ?? "30");
  try {
    const data = await generateInsights(Number.isFinite(days) && days > 0 ? days : 30);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[/api/insights/recommendations]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
