/**
 * 토스 API 응답 → DB insert/update payload 변환.
 *
 * - 토스 시간 포맷: "2025-09-01T00:00:00" (timezone offset 없음) → Asia/Seoul로 해석 후 UTC Date 변환
 * - 누락 필드는 안전 기본값 (0, null, "")
 * - 라인 아이템 / 결제 / 할인은 별도 함수로 분리
 */
import { fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@/lib/config";
import type {
  TossLineItem,
  TossOrder,
  TossPayment,
  TossDiscount,
  TossCatalogItem,
} from "./types";
import type {
  InsertOrder,
  InsertOrderLineItem,
  InsertPayment,
  InsertDiscount,
  InsertProduct,
} from "@/lib/db/schema";

/**
 * "2025-09-01T00:00:00" 또는 "2025-09-01T00:00:00+09:00" 둘 다 받아서 Date로.
 * Offset 없으면 Asia/Seoul로 해석.
 */
export function parseTossDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // ISO에 offset이 있으면 (Z 또는 ±hh:mm) Date 생성자로 처리 가능
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  // naive → Asia/Seoul로 해석 후 UTC Date
  const d = fromZonedTime(s, TIMEZONE);
  return Number.isFinite(d.getTime()) ? d : null;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTitle(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* ============================================================
 * Order
 * ========================================================== */
export function toOrderInsert(o: TossOrder): InsertOrder {
  const cp = o.chargePrice ?? {};
  const createdAt = parseTossDate(o.createdAt) ?? new Date();
  const updatedAt = parseTossDate(o.updatedAt) ?? createdAt;
  return {
    id: o.id,
    merchantId: o.merchantId,
    orderKey: o.orderKey ?? null,
    orderNumber: o.orderNumber ?? null,
    source: o.source ?? "UNDEFINED",
    orderState: o.orderState ?? "UNDEFINED",
    memo: o.memo ?? null,
    listPrice: num(cp.listPrice),
    discountAmount: num(cp.discountAmount),
    tipAmount: num(cp.tipAmount),
    serviceChargeAmount: num(cp.serviceChargeAmount),
    taxAmount: num(cp.taxAmount),
    supplyAmount: num(cp.supplyAmount),
    taxExemptAmount: num(cp.taxExemptAmount),
    totalAmount: num(cp.totalAmount),
    createdAt,
    updatedAt,
    openedAt: parseTossDate(o.openedAt),
    completedAt: parseTossDate(o.completedAt),
    cancelledAt: parseTossDate(o.cancelledAt),
    rawPayload: o as unknown as Record<string, unknown>,
  };
}

/* ============================================================
 * Line items
 * ========================================================== */
export function toLineItemInserts(o: TossOrder): Omit<InsertOrderLineItem, "id">[] {
  const items = o.lineItems ?? [];
  return items.map((li, idx) => normalizeLineItem(o.id, idx, li));
}

function normalizeLineItem(
  orderId: string,
  idx: number,
  li: TossLineItem,
): Omit<InsertOrderLineItem, "id"> {
  const title = li.item?.title ?? "";
  const cat = li.item?.category?.title ?? null;
  const ip = li.itemPrice ?? {};
  const optionTotal = (li.optionChoices ?? []).reduce(
    (acc, oc) => acc + num(oc.priceValue) * num(oc.quantity, 1),
    0,
  );
  const discountTotal = (li.appliedDiscounts ?? []).reduce(
    (acc, d) => acc + num(d.amount),
    0,
  );
  const qty = num(li.quantity, 1);
  const unit = num(ip.priceValue);
  const netAmount = unit * qty + optionTotal - discountTotal;
  return {
    orderId,
    lineIndex: idx,
    itemTitle: title,
    itemTitleNormalized: normalizeTitle(title),
    itemCode: li.item?.code ?? null,
    categoryTitle: cat,
    categoryCode: li.item?.category?.code ?? null,
    categoryNormalized: cat ? normalizeTitle(cat) : null,
    diningOption: li.diningOption ?? "UNDEFINED",
    quantity: qty,
    priceTitle: ip.title ?? null,
    priceType: ip.priceType ?? null,
    unitPrice: unit,
    isTaxFree: !!ip.isTaxFree,
    taxInclusive: ip.taxInclusive !== false, // 명시되지 않으면 true 가정
    optionTotal,
    discountTotal,
    netAmount,
    options: li.optionChoices ? (li.optionChoices as unknown as Record<string, unknown>) : null,
    memo: li.memo ?? null,
  };
}

/* ============================================================
 * Payments
 * ========================================================== */
export function toPaymentInserts(o: TossOrder): InsertPayment[] {
  const ps = o.payments ?? [];
  return ps.map((p) => toPaymentInsert(o.id, p));
}

export function toPaymentInsert(orderId: string, p: TossPayment): InsertPayment {
  const method = mapPaymentMethod(p);
  return {
    id: p.id,
    orderId,
    amount: num(p.amount),
    taxAmount: num(p.taxAmount),
    method,
    acquirer: extractAcquirer(p),
    state: p.state === "CANCELLED" ? "취소" : "승인",
    paidAt: parseTossDate(p.approvedAt) ?? new Date(),
    cancelledAt: parseTossDate(p.cancelledAt),
    rawPayload: p as unknown as Record<string, unknown>,
  };
}

/** 토스 sourceType/paymentMethod → 한국어 분류 */
function mapPaymentMethod(p: TossPayment): string {
  const m = (p.paymentMethod ?? p.sourceType ?? "").toUpperCase();
  if (m.includes("CARD")) return "카드";
  if (m.includes("CASH")) return "현금";
  if (m.includes("QR")) return "QR결제";
  if (m.includes("ACCOUNT") || m.includes("TRANSFER")) return "계좌이체";
  if (m.includes("EASY") || m.includes("PREPAID") || m.includes("PAY")) return "선불지급수단";
  return "기타";
}

function extractAcquirer(p: TossPayment): string | null {
  if (p.van) return p.van;
  const cd = p.cardDetails as { acquirer?: string; issuer?: string } | undefined;
  if (cd?.acquirer) return cd.acquirer;
  if (cd?.issuer) return cd.issuer;
  return null;
}

/* ============================================================
 * Discounts (order-level)
 * ========================================================== */
export function toDiscountInserts(o: TossOrder): Omit<InsertDiscount, "id">[] {
  const ds = o.discounts ?? [];
  return ds.map((d) => normalizeDiscount(o.id, null, d));
}

function normalizeDiscount(
  orderId: string | null,
  lineItemId: number | null,
  d: TossDiscount,
): Omit<InsertDiscount, "id"> {
  return {
    orderId,
    lineItemId,
    title: d.title ?? "DISCOUNT",
    type: d.type ?? null,
    code: d.code ?? null,
    amount: num(d.amount),
    percentage: num(d.percentage),
    fixedAmount: num(d.fixedAmount),
    precedence: d.precedence ?? null,
  };
}

/* ============================================================
 * Catalog → products
 * ========================================================== */
export function toProductInsert(c: TossCatalogItem): Omit<InsertProduct, "id"> {
  const cat = c.category?.title ?? null;
  return {
    tossItemCode: c.id,
    title: c.title,
    titleNormalized: normalizeTitle(c.title),
    categoryTitle: cat,
    categoryNormalized: cat ? normalizeTitle(cat) : null,
    categoryOverride: null,
    basePrice: c.price?.priceValue != null ? num(c.price.priceValue) : null,
    isActive: c.enabled !== false && c.state !== "SOLD_OUT",
    tags: c.labels && c.labels.length ? c.labels : null,
    updatedAt: parseTossDate(c.updatedAt) ?? new Date(),
  };
}
