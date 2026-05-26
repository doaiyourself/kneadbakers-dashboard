import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getKpiSummary } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await getKpiSummary();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[/api/dashboard/summary]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
