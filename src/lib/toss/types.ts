/**
 * 토스플레이스 Open API 응답 타입.
 * 공식 문서 기준 — 변경 가능성 있어 unknown 캐스팅 후 zod 검증을 권장(추후).
 *
 * 참조:
 * - https://docs.tossplace.com/reference/open-api/order/order-model.html
 * - https://docs.tossplace.com/reference/open-api/payment.html
 * - https://docs.tossplace.com/reference/open-api/catalog.html
 */

/* ============================================================
 * Enums
 * ========================================================== */
export type TossOrderState =
  | "REQUESTED"
  | "OPENED"
  | "COMPLETED"
  | "CANCELLED"
  | "UNDEFINED";

export type TossSource = "POS" | "KIOSK" | string; // 토스가 미래에 추가 가능 → string 허용

export type TossDiningOption =
  | "HERE"
  | "TOGO"
  | "DELIVERY"
  | "PICKUP"
  | "UNDEFINED";

export type TossPriceType = "FIXED" | "VARIABLE" | "UNIT" | "UNDEFINED";

export type TossDiscountType =
  | "FIXED_AMOUNT"
  | "FIXED_PERCENTAGE"
  | "UNDEFINED"
  | string;

export type TossPaymentState = "APPROVED" | "CANCELLED" | string;

export type TossCatalogItemState = "ON_SALE" | "SOLD_OUT" | string;

/* ============================================================
 * Order
 * ========================================================== */
export interface TossOrderItemPrice {
  title?: string;
  priceType?: TossPriceType;
  priceUnit?: number;
  priceValue?: number;
  isTaxFree?: boolean;
  taxPercentage?: number;
  taxInclusive?: boolean;
}

export interface TossOrderItemCategory {
  title?: string;
  code?: string;
}

export interface TossOrderItem {
  title?: string;
  code?: string;
  category?: TossOrderItemCategory;
}

export interface TossOptionChoice {
  title?: string;
  code?: string;
  priceValue?: number;
  quantity?: number;
  option?: { title?: string };
}

export interface TossAppliedDiscount {
  title?: string;
  type?: TossDiscountType;
  code?: string;
  amount?: number;
  percentage?: number;
  fixedAmount?: number;
  precedence?: number;
}

export interface TossLineItem {
  diningOption?: TossDiningOption;
  quantity?: number;
  memo?: string | null;
  item?: TossOrderItem;
  itemPrice?: TossOrderItemPrice;
  optionChoices?: TossOptionChoice[];
  appliedDiscounts?: TossAppliedDiscount[];
}

export interface TossDiscount {
  title?: string;
  type?: TossDiscountType;
  code?: string;
  amount?: number;
  percentage?: number;
  fixedAmount?: number;
  precedence?: number;
}

export interface TossChargePrice {
  listPrice?: number;
  discountAmount?: number;
  tipAmount?: number;
  serviceChargeAmount?: number;
  taxAmount?: number;
  supplyAmount?: number;
  taxExemptAmount?: number;
  totalAmount?: number;
}

/** Order 응답에 임베드된 결제 (Payment API와 동일 모델로 가정) */
export interface TossPayment {
  id: string;
  orderId?: string;
  merchantId?: number;
  amount: number;
  taxAmount?: number;
  supplyAmount?: number;
  taxExemptAmount?: number;
  state: TossPaymentState;
  sourceType?: string;
  paymentMethod?: string; // 카드/현금/QR결제/계좌이체/선불지급수단/기타
  /** 카드사 (e.g. KB카드/삼성카드) — cardDetails 안에 있을 수도 있음 */
  van?: string;
  approvedAt?: string;
  cancelledAt?: string | null;
  cardDetails?: Record<string, unknown>;
  cashDetails?: Record<string, unknown>;
  accountTransferDetails?: Record<string, unknown>;
  easyPayDetails?: Record<string, unknown>;
}

export interface TossOrder {
  id: string;
  merchantId: number;
  orderKey?: string | null;
  orderNumber?: string | null;
  source: TossSource;
  orderState: TossOrderState;
  memo?: string | null;
  createdAt: string;
  updatedAt: string;
  openedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  lineItems?: TossLineItem[];
  payments?: TossPayment[];
  discounts?: TossDiscount[];
  requestedInfo?: Record<string, unknown> | null;
  chargePrice?: TossChargePrice;
}

/* ============================================================
 * Order list params
 * ========================================================== */
export interface TossOrderListParams {
  from?: string; // ISO 8601 (naive Asia/Seoul)
  to?: string;
  orderStates?: TossOrderState[];
  sources?: string[];
  page?: number; // default 1
  size?: number; // default 100, max 100 추정
  sortOrder?: "ASC" | "DESC"; // default DESC
}

/* ============================================================
 * Catalog
 * ========================================================== */
export interface TossCatalogItemPrice {
  priceValue: number;
  priceType?: TossPriceType;
}

export interface TossCatalogCategory {
  id: string;
  title: string;
  enabled?: boolean;
  order?: number;
}

export interface TossCatalogItem {
  id: string;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  price: TossCatalogItemPrice;
  category?: TossCatalogCategory | null;
  enabled?: boolean;
  state?: TossCatalogItemState;
  labels?: string[];
  options?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

/* ============================================================
 * Paginated response (공통 추정)
 * ========================================================== */
export interface TossPagedResponse<T> {
  items?: T[];
  data?: T[];
  content?: T[];
  totalCount?: number;
  totalElements?: number;
  page?: number;
  size?: number;
  hasNext?: boolean;
}

/* ============================================================
 * Webhook headers
 * ========================================================== */
export const TOSS_HEADER = {
  signature: "x-toss-signature",
  timestamp: "x-toss-timestamp",
  webhookId: "x-toss-webhook-id",
  eventId: "x-toss-event-id",
} as const;
