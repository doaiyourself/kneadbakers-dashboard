/**
 * KNEAD Analytics — Drizzle 스키마.
 *
 * 명명 규칙:
 * - 테이블/컬럼 모두 snake_case (DB)
 * - TS 식별자는 camelCase로 export
 * - 금액(`won`)은 BIGINT지만 JS 직렬화 편의를 위해 `mode: 'number'` 사용.
 *   원화 누적이 Number.MAX_SAFE_INTEGER(9e15)를 넘을 일은 없음.
 * - 토스 orderId는 문자열, merchantId는 숫자.
 */

import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/* ============================================================
 * 1. merchants — 매장
 * ========================================================== */
export const merchants = pgTable("merchants", {
  id: bigint("id", { mode: "number" }).primaryKey(), // 토스 merchantId
  name: text("name").notNull(),
  tossAppId: text("toss_app_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ============================================================
 * 2. orders — 주문 (토스 Order 1:1)
 * ========================================================== */
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // 토스 orderId
    merchantId: bigint("merchant_id", { mode: "number" })
      .references(() => merchants.id)
      .notNull(),
    orderKey: text("order_key"),
    orderNumber: text("order_number"),
    source: text("source").notNull(), // POS / KIOSK / 배달앱 source 코드
    orderState: text("order_state").notNull(), // REQUESTED|OPENED|COMPLETED|CANCELLED|UNDEFINED
    memo: text("memo"),

    // chargePrice — BIGINT but mode:'number' for JSON-friendly serialization
    listPrice: bigint("list_price", { mode: "number" }).notNull().default(0),
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull().default(0),
    tipAmount: bigint("tip_amount", { mode: "number" }).notNull().default(0),
    serviceChargeAmount: bigint("service_charge_amount", { mode: "number" }).notNull().default(0),
    taxAmount: bigint("tax_amount", { mode: "number" }).notNull().default(0),
    supplyAmount: bigint("supply_amount", { mode: "number" }).notNull().default(0),
    taxExemptAmount: bigint("tax_exempt_amount", { mode: "number" }).notNull().default(0),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    rawPayload: jsonb("raw_payload"),
  },
  (t) => ({
    merchantCreatedIdx: index("idx_orders_merchant_created").on(
      t.merchantId,
      sql`${t.createdAt} DESC`,
    ),
    stateIdx: index("idx_orders_state").on(t.orderState),
    completedAtIdx: index("idx_orders_completed_at")
      .on(sql`${t.completedAt} DESC`)
      .where(sql`${t.completedAt} IS NOT NULL`),
  }),
);

/* ============================================================
 * 3. order_line_items — 주문 라인
 * ========================================================== */
export const orderLineItems = pgTable(
  "order_line_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: text("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    lineIndex: integer("line_index").notNull(),

    itemTitle: text("item_title").notNull(),
    itemTitleNormalized: text("item_title_normalized"),
    itemCode: text("item_code"),

    categoryTitle: text("category_title"),
    categoryCode: text("category_code"),
    categoryNormalized: text("category_normalized"),

    diningOption: text("dining_option"), // HERE|TOGO|DELIVERY|PICKUP|UNDEFINED
    quantity: bigint("quantity", { mode: "number" }).notNull().default(1),

    priceTitle: text("price_title"),
    priceType: text("price_type"), // FIXED|VARIABLE|UNIT
    unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0),
    isTaxFree: boolean("is_tax_free").default(false),
    taxInclusive: boolean("tax_inclusive").default(true),

    optionTotal: bigint("option_total", { mode: "number" }).notNull().default(0),
    discountTotal: bigint("discount_total", { mode: "number" }).notNull().default(0),
    netAmount: bigint("net_amount", { mode: "number" }).notNull().default(0),

    options: jsonb("options"),
    memo: text("memo"),
  },
  (t) => ({
    orderIdx: index("idx_lines_order").on(t.orderId),
    titleNormIdx: index("idx_lines_title_norm").on(t.itemTitleNormalized),
    categoryNormIdx: index("idx_lines_category_norm").on(t.categoryNormalized),
  }),
);

/* ============================================================
 * 4. payments — 결제 (1주문 N결제)
 * ========================================================== */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(), // 토스 paymentId
    orderId: text("order_id").references(() => orders.id),

    amount: bigint("amount", { mode: "number" }).notNull(),
    taxAmount: bigint("tax_amount", { mode: "number" }).notNull().default(0),

    method: text("method").notNull(), // 현금|카드|QR결제|계좌이체|선불지급수단|기타
    acquirer: text("acquirer"), // KB카드|삼성카드|쿠팡이츠 등
    state: text("state").notNull(), // 승인|취소

    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    rawPayload: jsonb("raw_payload"),
  },
  (t) => ({
    orderIdx: index("idx_payments_order").on(t.orderId),
    methodPaidIdx: index("idx_payments_method").on(t.method, sql`${t.paidAt} DESC`),
  }),
);

/* ============================================================
 * 5. discounts — 할인 (주문 또는 라인에 적용)
 * ========================================================== */
export const discounts = pgTable("discounts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
  lineItemId: bigint("line_item_id", { mode: "number" }).references(() => orderLineItems.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  type: text("type"), // FIXED_AMOUNT|FIXED_PERCENTAGE 등
  code: text("code"),
  amount: bigint("amount", { mode: "number" }).notNull().default(0),
  percentage: doublePrecision("percentage").default(0),
  fixedAmount: bigint("fixed_amount", { mode: "number" }).default(0),
  precedence: integer("precedence"),
});

/* ============================================================
 * 6. products — 카탈로그 마스터
 * ========================================================== */
export const products = pgTable("products", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tossItemCode: text("toss_item_code").unique(),
  title: text("title").notNull(),
  titleNormalized: text("title_normalized").notNull(),
  categoryTitle: text("category_title"),
  categoryNormalized: text("category_normalized"),
  categoryOverride: text("category_override"), // 수동 교정
  basePrice: bigint("base_price", { mode: "number" }),
  isActive: boolean("is_active").default(true),
  tags: text("tags").array(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ============================================================
 * 7. webhook_events — 웹훅 이벤트 (멱등성, 감사)
 * ========================================================== */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    webhookId: text("webhook_id").primaryKey(), // x-toss-webhook-id
    eventId: text("event_id"),
    deliveryId: text("delivery_id"),
    eventType: text("event_type").notNull(),
    merchantId: bigint("merchant_id", { mode: "number" }),
    tossCreatedAt: timestamp("toss_created_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: text("status").default("pending").notNull(), // pending|processed|failed|duplicate
    errorMessage: text("error_message"),
    payload: jsonb("payload").notNull(),
  },
  (t) => ({
    statusReceivedIdx: index("idx_webhook_status").on(t.status, t.receivedAt),
  }),
);

/* ============================================================
 * 8. sync_jobs — 동기화 잡 로그
 * ========================================================== */
export const syncJobs = pgTable("sync_jobs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobType: text("job_type").notNull(), // hourly_poll|daily_reconcile|backfill
  rangeFrom: timestamp("range_from", { withTimezone: true }),
  rangeTo: timestamp("range_to", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  fetchedCount: integer("fetched_count").default(0).notNull(),
  upsertedCount: integer("upserted_count").default(0).notNull(),
  status: text("status").default("running").notNull(), // running|succeeded|failed
  errorMessage: text("error_message"),
});

/* ============================================================
 * 9. users — 점주/매니저/직원 (카카오 + Google OAuth)
 *
 * - kakao_id 또는 google_id로 식별. 같은 사람이 두 provider를 동시에 link 가능(이메일 매칭).
 * - 둘 다 NULL인 row는 만들어지지 않도록 애플리케이션 레벨에서 보장.
 * - email은 provider가 제공 안 할 수 있어 nullable. UNIQUE는 유지(NULL은 충돌 없음).
 * - 접근 권한: OWNER_KAKAO_EMAILS/IDS, OWNER_GOOGLE_EMAILS 화이트리스트로 owner 자동 부여,
 *   그 외 등록되지 않은 로그인은 거부(자동 가입 X — 매출 데이터 보호).
 * - 추가 사용자는 owner가 settings에서 명시 등록.
 * ========================================================== */
export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kakaoId: text("kakao_id").unique(),
  googleId: text("google_id").unique(),
  email: text("email").unique(),
  name: text("name"),
  imageUrl: text("image_url"),
  role: text("role").default("staff").notNull(), // owner|manager|staff
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ============================================================
 * Relations
 * ========================================================== */
export const merchantsRelations = relations(merchants, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  merchant: one(merchants, { fields: [orders.merchantId], references: [merchants.id] }),
  lineItems: many(orderLineItems),
  payments: many(payments),
  discounts: many(discounts),
}));

export const orderLineItemsRelations = relations(orderLineItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderLineItems.orderId], references: [orders.id] }),
  discounts: many(discounts),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const discountsRelations = relations(discounts, ({ one }) => ({
  order: one(orders, { fields: [discounts.orderId], references: [orders.id] }),
  lineItem: one(orderLineItems, {
    fields: [discounts.lineItemId],
    references: [orderLineItems.id],
  }),
}));

/* ============================================================
 * Insert/Select types
 * ========================================================== */
export type Merchant = typeof merchants.$inferSelect;
export type InsertMerchant = typeof merchants.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type InsertOrderLineItem = typeof orderLineItems.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export type Discount = typeof discounts.$inferSelect;
export type InsertDiscount = typeof discounts.$inferInsert;

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;

export type SyncJob = typeof syncJobs.$inferSelect;
export type InsertSyncJob = typeof syncJobs.$inferInsert;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type UserRole = "owner" | "manager" | "staff";
export type OrderState = "REQUESTED" | "OPENED" | "COMPLETED" | "CANCELLED" | "UNDEFINED";
export type DiningOption = "HERE" | "TOGO" | "DELIVERY" | "PICKUP" | "UNDEFINED";
