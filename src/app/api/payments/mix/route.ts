import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPaymentMethodMix } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  try {
    const data = await getPaymentMethodMix(Number.isFinite(days) && days > 0 ? days : 30);
    return NextResponse.json({ days, data });
  } catch (e) {
    console.error("[/api/payments/mix]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
