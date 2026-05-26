/**
 * 일일 reconcile — 매일 새벽 4시 (KST) Vercel Cron 실행.
 *
 * 어제 하루치를 통째로 재조회:
 *   - 시간당 폴링·웹훅이 모두 놓친 변경 (예: 늦은 수정/취소) 캐치업
 *   - 카탈로그 변경 반영
 *
 * 인증: Vercel Cron은 `Authorization: Bearer ${CRON_SECRET}` 자동 전달.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncJobs } from "@/lib/db/schema";
import { getServerEnv } from "@/lib/config";
import { ensureMerchant, syncCatalog, syncOrdersInRange } from "@/lib/sync/orders";

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

  // 어제 자정(KST) ~ 오늘 자정(KST)
  const now = new Date();
  const kstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const todayMidnight = new Date(
    kstNow.getFullYear(),
    kstNow.getMonth(),
    kstNow.getDate(),
    0,
    0,
    0,
  );
  // KST 자정 → UTC: 9시간 빼기
  const todayMidnightUtc = new Date(todayMidnight.getTime() - 9 * 3600 * 1000);
  const yesterdayMidnightUtc = new Date(todayMidnightUtc.getTime() - 24 * 3600 * 1000);

  const [job] = await db
    .insert(syncJobs)
    .values({
      jobType: "daily_reconcile",
      rangeFrom: yesterdayMidnightUtc,
      rangeTo: todayMidnightUtc,
      status: "running",
    })
    .returning({ id: syncJobs.id });

  try {
    await ensureMerchant(merchantId);
    const orderResult = await syncOrdersInRange(yesterdayMidnightUtc, todayMidnightUtc, {
      merchantId,
    });
    const catalogResult = await syncCatalog();

    if (job)
      await db
        .update(syncJobs)
        .set({
          finishedAt: new Date(),
          fetchedCount: orderResult.orders,
          upsertedCount: orderResult.orders,
          status: orderResult.errors.length ? "failed" : "succeeded",
          errorMessage: orderResult.errors.length
            ? orderResult.errors.slice(0, 3).join("; ")
            : null,
        })
        .where(sql`${syncJobs.id} = ${job.id}`);

    return NextResponse.json({
      ok: true,
      from: yesterdayMidnightUtc.toISOString(),
      to: todayMidnightUtc.toISOString(),
      orders: orderResult,
      catalog: catalogResult,
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
    console.error("[cron/daily-reconcile]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
