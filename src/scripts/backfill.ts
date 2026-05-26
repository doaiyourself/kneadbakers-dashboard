/**
 * 토스플레이스 30일치(기본) 백필 — 분석 dashboard용 초기 데이터 적재.
 *
 * 실행:
 *   npm run backfill                  # 지난 30일
 *   npm run backfill -- --days 90     # 지난 90일
 *   npm run backfill -- --from 2026-04-01 --to 2026-05-01  # 명시 구간
 *
 * 멱등: orders/payments는 PK 기준 UPSERT, line_items/discounts는 order별 DELETE → INSERT.
 * 카탈로그도 한 번에 동기화 (products 테이블).
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db/client";
import {
  discounts,
  merchants,
  orderLineItems,
  orders,
  payments,
  products,
} from "../lib/db/schema";
import { formatTossDateTime, tossClient } from "../lib/toss/client";
import {
  toDiscountInserts,
  toLineItemInserts,
  toOrderInsert,
  toPaymentInserts,
  toProductInsert,
} from "../lib/toss/normalize";

interface Args {
  days: number;
  from?: Date;
  to?: Date;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let days = 30;
  let from: Date | undefined;
  let to: Date | undefined;
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const v = a[i + 1];
    if (v === undefined) continue;
    if (k === "--days") {
      days = Number(v);
      i++;
    } else if (k === "--from") {
      from = new Date(v);
      i++;
    } else if (k === "--to") {
      to = new Date(v);
      i++;
    }
  }
  return { days, from, to };
}

async function ensureMerchant(merchantId: number) {
  await db
    .insert(merchants)
    .values({ id: merchantId, name: "니드 베이커스" })
    .onConflictDoNothing();
  console.log(`✓ merchants ensured (id=${merchantId})`);
}

async function backfillOrders(from: Date, to: Date, merchantId: number) {
  const client = tossClient();
  let count = 0;
  let lineCount = 0;
  let payCount = 0;
  let discCount = 0;
  let lastLogAt = Date.now();
  const startedAt = Date.now();

  console.log(`\n주문 백필 시작: ${from.toISOString()} → ${to.toISOString()}`);

  for await (const o of client.iterateOrders({
    from: formatTossDateTime(from),
    to: formatTossDateTime(to),
    orderStates: ["COMPLETED", "CANCELLED", "OPENED", "REQUESTED"],
    size: 100,
    sortOrder: "ASC",
  })) {
    // merchantId 보정 (응답에 들어있는 값으로 신뢰)
    const orderRow = toOrderInsert({ ...o, merchantId });
    const lineRows = toLineItemInserts({ ...o, merchantId });
    const payRows = toPaymentInserts({ ...o, merchantId });
    const discRows = toDiscountInserts({ ...o, merchantId });

    await db.transaction(async (tx) => {
      // orders — UPSERT by id
      await tx.insert(orders).values(orderRow).onConflictDoUpdate({
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

      // line items — DELETE + INSERT (간단/정확)
      await tx.delete(orderLineItems).where(eq(orderLineItems.orderId, o.id));
      if (lineRows.length) await tx.insert(orderLineItems).values(lineRows);

      // payments — UPSERT
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

      // discounts (order-level) — DELETE + INSERT
      await tx
        .delete(discounts)
        .where(sql`${discounts.orderId} = ${o.id} AND ${discounts.lineItemId} IS NULL`);
      if (discRows.length) await tx.insert(discounts).values(discRows);
    });

    count += 1;
    lineCount += lineRows.length;
    payCount += payRows.length;
    discCount += discRows.length;
    if (Date.now() - lastLogAt > 2000) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  …${count} orders / ${lineCount} lines / ${payCount} payments  (${elapsed}s)`);
      lastLogAt = Date.now();
    }
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n✓ 주문 백필 완료: ${count} orders / ${lineCount} lines / ${payCount} payments / ${discCount} discounts  (${elapsed}s)`,
  );
}

async function backfillCatalog() {
  const client = tossClient();
  let count = 0;
  console.log("\n카탈로그 백필 시작");
  const startedAt = Date.now();
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
    count += 1;
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`✓ 카탈로그 ${count}개 동기화  (${elapsed}s)`);
}

async function main() {
  const env = process.env;
  if (!env.TOSS_MERCHANT_ID) throw new Error("TOSS_MERCHANT_ID env 없음");
  const merchantId = Number(env.TOSS_MERCHANT_ID);
  const args = parseArgs();
  const to = args.to ?? new Date();
  const from = args.from ?? new Date(to.getTime() - args.days * 24 * 3600 * 1000);

  console.log(`[backfill] merchant=${merchantId}, ${from.toISOString()} → ${to.toISOString()}`);

  await ensureMerchant(merchantId);
  await backfillOrders(from, to, merchantId);
  await backfillCatalog();
  console.log("\n끝.");
  process.exit(0);
}

main().catch((e) => {
  console.error("backfill 실패:", e);
  process.exit(1);
});
