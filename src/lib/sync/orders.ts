/**
 * 토스 주문 동기화 — 백필/웹훅/크론 공통 로직.
 *
 * 멱등성:
 *   - orders: PK(id)로 UPSERT
 *   - order_line_items: order별 DELETE 후 INSERT (단순/정확)
 *   - payments: PK(id)로 UPSERT
 *   - discounts (order-level): DELETE + INSERT
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  discounts,
  merchants,
  orderLineItems,
  orders,
  payments,
  products,
} from "@/lib/db/schema";
import { tossClient, formatTossDateTime } from "@/lib/toss/client";
import {
  toDiscountInserts,
  toLineItemInserts,
  toOrderInsert,
  toPaymentInserts,
  toProductInsert,
} from "@/lib/toss/normalize";
import type { TossOrder } from "@/lib/toss/types";

export interface SyncResult {
  orders: number;
  lineItems: number;
  paymentsCount: number;
  discountsCount: number;
  errors: string[];
}

/** 매장이 DB에 없으면 한 번 생성 — 무해, 멱등 */
export async function ensureMerchant(merchantId: number, name = "니드 베이커스"): Promise<void> {
  await db.insert(merchants).values({ id: merchantId, name }).onConflictDoNothing();
}

/** 주문 1건을 DB에 UPSERT — 트랜잭션 1회 */
export async function upsertOrder(o: TossOrder): Promise<void> {
  const orderRow = toOrderInsert(o);
  const lineRows = toLineItemInserts(o);
  const payRows = toPaymentInserts(o);
  const discRows = toDiscountInserts(o);

  await db.transaction(async (tx) => {
    await tx
      .insert(orders)
      .values(orderRow)
      .onConflictDoUpdate({
        target: orders.id,
        set: {
          orderState: orderRow.orderState,
          orderKey: orderRow.orderKey,
          orderNumber: orderRow.orderNumber,
          source: orderRow.source,
          memo: orderRow.memo,
          listPrice: orderRow.listPrice,
          discountAmount: orderRow.discountAmount,
          tipAmount: orderRow.tipAmount,
          serviceChargeAmount: orderRow.serviceChargeAmount,
          taxAmount: orderRow.taxAmount,
          supplyAmount: orderRow.supplyAmount,
          taxExemptAmount: orderRow.taxExemptAmount,
          totalAmount: orderRow.totalAmount,
          updatedAt: orderRow.updatedAt,
          openedAt: orderRow.openedAt,
          completedAt: orderRow.completedAt,
          cancelledAt: orderRow.cancelledAt,
          rawPayload: orderRow.rawPayload,
        },
      });

    await tx.delete(orderLineItems).where(eq(orderLineItems.orderId, o.id));
    if (lineRows.length) await tx.insert(orderLineItems).values(lineRows);

    for (const p of payRows) {
      await tx
        .insert(payments)
        .values(p)
        .onConflictDoUpdate({
          target: payments.id,
          set: {
            amount: p.amount,
            taxAmount: p.taxAmount,
            method: p.method,
            acquirer: p.acquirer,
            state: p.state,
            paidAt: p.paidAt,
            cancelledAt: p.cancelledAt,
            rawPayload: p.rawPayload,
          },
        });
    }

    await tx
      .delete(discounts)
      .where(sql`${discounts.orderId} = ${o.id} AND ${discounts.lineItemId} IS NULL`);
    if (discRows.length) await tx.insert(discounts).values(discRows);
  });
}

/** 기간 범위로 토스에서 주문을 끌어와 DB에 UPSERT — backfill / cron 공통 */
export async function syncOrdersInRange(
  from: Date,
  to: Date,
  opts: { merchantId?: number } = {},
): Promise<SyncResult> {
  const client = tossClient();
  const result: SyncResult = {
    orders: 0,
    lineItems: 0,
    paymentsCount: 0,
    discountsCount: 0,
    errors: [],
  };

  for await (const o of client.iterateOrders({
    from: formatTossDateTime(from),
    to: formatTossDateTime(to),
    orderStates: ["COMPLETED", "CANCELLED", "OPENED", "REQUESTED"],
    size: 100,
    sortOrder: "ASC",
    ...opts,
  })) {
    try {
      // 응답에 들어있는 merchantId가 신뢰원본. 호출 시 override 없으면 그대로.
      await upsertOrder(opts.merchantId ? { ...o, merchantId: opts.merchantId } : o);
      result.orders++;
      result.lineItems += o.lineItems?.length ?? 0;
      result.paymentsCount += o.payments?.length ?? 0;
      result.discountsCount += o.discounts?.length ?? 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`order ${o.id}: ${msg}`);
      console.error(`[sync] order ${o.id} upsert 실패:`, e);
    }
  }

  return result;
}

/** 단일 주문 fetch + upsert — 웹훅 이벤트 처리용 */
export async function syncSingleOrder(orderId: string, merchantId?: number): Promise<void> {
  const client = tossClient();
  const o = await client.getOrder(orderId, merchantId ? { merchantId } : {});
  await upsertOrder(o);
}

/** 카탈로그(상품) 전체 동기화 */
export async function syncCatalog(): Promise<{ count: number }> {
  const client = tossClient();
  let count = 0;
  for await (const item of client.iterateCatalogItems()) {
    const p = toProductInsert(item);
    await db
      .insert(products)
      .values(p)
      .onConflictDoUpdate({
        target: products.tossItemCode,
        set: {
          title: p.title,
          titleNormalized: p.titleNormalized,
          categoryTitle: p.categoryTitle,
          categoryNormalized: p.categoryNormalized,
          basePrice: p.basePrice,
          isActive: p.isActive,
          tags: p.tags,
          updatedAt: p.updatedAt,
        },
      });
    count++;
  }
  return { count };
}
