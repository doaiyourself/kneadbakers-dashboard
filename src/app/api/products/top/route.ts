import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTopProducts } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  try {
    const data = await getTopProducts({
      from,
      to,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    });
    return NextResponse.json({ from, to, data });
  } catch (e) {
    console.error("[/api/products/top]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
