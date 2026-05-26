/**
 * 토스플레이스 웹훅 수신.
 *
 * 흐름:
 *   1) raw body 읽기 (서명 검증에 필요)
 *   2) HMAC-SHA256 서명 검증 (x-toss-signature)
 *   3) 멱등성: webhook_events 테이블에 x-toss-webhook-id 기준 INSERT
 *      이미 처리된 이벤트면 200 (no-op)
 *   4) 이벤트 타입 분기 — 주문/매장/카탈로그
 *   5) 주문 이벤트: payload의 orderId로 단건 fetch → UPSERT
 *
 * 인증: 미들웨어가 /api/webhooks/* 패스로 통과시킴.
 *       이 라우트에서 HMAC 서명으로 직접 검증.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { getServerEnv } from "@/lib/config";
import { syncSingleOrder, syncCatalog } from "@/lib/sync/orders";
import { TOSS_HEADER, verifyTossWebhook } from "@/lib/toss";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TossWebhookPayload {
  /** 이벤트 종류 — "order.completed", "catalog.item.updated" 등 */
  eventType?: string;
  type?: string;
  /** 주문 이벤트면 안에 orderId */
  orderId?: string;
  merchantId?: number;
  data?: {
    orderId?: string;
    itemId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function POST(req: Request) {
  const env = getServerEnv();
  if (!env.TOSS_WEBHOOK_SECRET) {
    console.error("[webhook] TOSS_WEBHOOK_SECRET 미설정");
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });
  }

  // 1) raw body
  const rawBody = await req.text();
  const headers = req.headers;
  const signature = headers.get(TOSS_HEADER.signature);
  const timestamp = headers.get(TOSS_HEADER.timestamp);
  const webhookId = headers.get(TOSS_HEADER.webhookId);
  const eventId = headers.get(TOSS_HEADER.eventId);

  // 2) 서명 검증
  const v = verifyTossWebhook({
    signature,
    timestamp,
    rawBody,
    secret: env.TOSS_WEBHOOK_SECRET,
  });
  if (!v.ok) {
    console.warn(`[webhook] 서명 검증 실패: ${v.reason}`, { webhookId });
    return NextResponse.json({ error: `signature: ${v.reason}` }, { status: 401 });
  }

  // 3) 멱등 처리 — webhook_id 가 없으면 (드물지만) 그냥 처리 후 응답
  if (!webhookId) {
    console.warn("[webhook] x-toss-webhook-id 없음, 멱등 처리 스킵");
  }

  let payload: TossWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const eventType = payload.eventType ?? payload.type ?? "unknown";
  const merchantId = payload.merchantId ?? null;
  const tossCreatedAtMs = Number(timestamp);
  const tossCreatedAt = Number.isFinite(tossCreatedAtMs)
    ? new Date(tossCreatedAtMs)
    : null;

  // 이벤트 기록 시도 — 중복이면 onConflict로 두 번째 호출은 그냥 skip
  if (webhookId) {
    try {
      const inserted = await db
        .insert(webhookEvents)
        .values({
          webhookId,
          eventId,
          eventType,
          merchantId,
          tossCreatedAt,
          payload: payload as Record<string, unknown>,
          status: "pending",
        })
        .onConflictDoNothing({ target: webhookEvents.webhookId })
        .returning({ webhookId: webhookEvents.webhookId });
      if (inserted.length === 0) {
        // 이미 처리됨
        return NextResponse.json({ ok: true, duplicate: true });
      }
    } catch (e) {
      console.error("[webhook] event row insert 실패:", e);
      // 멱등 트래킹 실패는 비치명적 — 계속 진행
    }
  }

  // 4) 이벤트 분기
  try {
    if (eventType.startsWith("order.") || payload.orderId || payload.data?.orderId) {
      const orderId = payload.orderId ?? payload.data?.orderId;
      if (orderId) {
        await syncSingleOrder(orderId, merchantId ?? undefined);
      }
    } else if (eventType.startsWith("catalog.")) {
      // 단건 fetch는 itemId 필요. 단순화: 카탈로그 변화 시 전체 재동기화 (152개라 빠름)
      await syncCatalog();
    }
    // 매장(merchant.*) 이벤트는 현재 단일 매장이라 무시

    // 처리 완료 마킹
    if (webhookId) {
      await db
        .update(webhookEvents)
        .set({ status: "processed", processedAt: new Date() })
        .where(/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
          (await import("drizzle-orm")).eq(webhookEvents.webhookId, webhookId),
        );
    }

    return NextResponse.json({ ok: true, eventType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[webhook] 처리 실패 eventType=${eventType}`, e);
    if (webhookId) {
      await db
        .update(webhookEvents)
        .set({ status: "failed", errorMessage: msg, processedAt: new Date() })
        .where(/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
          (await import("drizzle-orm")).eq(webhookEvents.webhookId, webhookId),
        );
    }
    // 토스에 5xx 주면 재시도. 일시적 DB 에러면 OK, 영구적 로직 에러면 무한 재시도 — 그래도 5xx로.
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Toss가 GET으로 health check 할 가능성 대비
export async function GET() {
  return NextResponse.json({ ok: true, message: "Toss webhook endpoint alive" });
}
