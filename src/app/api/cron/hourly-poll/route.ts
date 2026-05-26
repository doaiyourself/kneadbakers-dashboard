/**
 * 시간당 주문 폴링 — Vercel Cron이 매시 실행.
 *
 * 웹훅 누락분 복구 안전망:
 *   - 직전 90분 (살짝 겹쳐서 boundary 안전)
 *   - 모든 주문을 UPSERT (멱등)
 *
 * 인증: Vercel Cron은 `Authorization: Bearer ${CRON_SECRET}` 자동 전달.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncJobs } from "@/lib/db/schema";
import { getServerEnv } from "@/lib/config";
import { ensureMerchant, syncOrdersInRange } from "@/lib/sync/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const env = getServerEnv();
  const auth = req.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const merchantId = env.TOSS_MERCHANT_ID ? Number(env.TOSS_MERCHANT_ID) : undefined;
  if (!merchantId) {
    return NextResponse.json({ error: "TOSS_MERCHANT_ID 미설정" }, { status: 500 });
  }

  const to = new Date();
  const from = new Date(to.getTime() - 90 * 60 * 1000); // 90 minutes

  // sync_jobs 기록 시작
  const [job] = await db
    .insert(syncJobs)
    .values({
      jobType: "hourly_poll",
      rangeFrom: from,
      rangeTo: to,
      status: "running",
    })
    .returning({ id: syncJobs.id });

  try {
    await ensureMerchant(merchantId);
    const result = await syncOrdersInRange(from, to, { merchantId });

    if (job)
      await db
        .update(syncJobs)
        .set({
          finishedAt: new Date(),
          fetchedCount: result.orders,
          upsertedCount: result.orders,
          status: result.errors.length ? "failed" : "succeeded",
          errorMessage: result.errors.length ? result.errors.slice(0, 3).join("; ") : null,
        })
        .where(sql`${syncJobs.id} = ${job.id}`);

    return NextResponse.json({
      ok: true,
      from: from.toISOString(),
      to: to.toISOString(),
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (job)
      await db
        .update(syncJobs)
        .set({
          finishedAt: new Date(),
          status: "failed",
          errorMessage: msg,
        })
        .where(sql`${syncJobs.id} = ${job.id}`);
    console.error("[cron/hourly-poll]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
