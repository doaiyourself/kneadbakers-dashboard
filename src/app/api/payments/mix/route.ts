import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPaymentMethodMix } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  try {
    const data = await getPaymentMethodMix({ from, to });
    return NextResponse.json({ from, to, data });
  } catch (e) {
    console.error("[/api/payments/mix]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
