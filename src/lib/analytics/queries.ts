/**
 * 매출 분석 SQL 쿼리.
 *
 * 시간대 정책: 모든 그룹핑은 Asia/Seoul 기준.
 *   `completed_at AT TIME ZONE 'Asia/Seoul'` 로 변환 후 date_trunc/extract.
 *
 * 상태 정책: COMPLETED만 매출/객단가 계산에 포함.
 *   취소(CANCELLED)는 cancellationRate 같은 보조 지표에서만 사용.
 *
 * 범위 정책: 모든 함수가 from/to(KST naive) 또는 days를 받음.
 *   from/to 우선 → 명시적 범위 / 없으면 마지막 N일.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";

/* ============================================================
 * 공통 — 범위 WHERE 절 빌더
 * ========================================================== */
export interface DateRange {
  /** Asia/Seoul naive ISO ("2026-01-01" 또는 "2026-01-01T00:00:00") */
  from?: string;
  to?: string;
  /** from/to 미지정 시 fallback */
  fallbackDays?: number;
}

function rangeClause(r: DateRange | undefined, completedCol = "completed_at"): SQL {
  // completed_at은 timestamp with time zone (UTC 저장). 비교는 KST 변환 후 일관성 위해
  // raw SQL은 'AT TIME ZONE Asia/Seoul' 적용된 좌변과, naive 우변(`timestamp without tz`) 사용.
  if (r?.from && r?.to) {
    return sql`(${sql.raw(completedCol)} AT TIME ZONE 'Asia/Seoul') >= ${r.from}::timestamp
           AND (${sql.raw(completedCol)} AT TIME ZONE 'Asia/Seoul') < (${r.to}::timestamp + interval '1 day')`;
  }
  if (r?.from) {
    return sql`(${sql.raw(completedCol)} AT TIME ZONE 'Asia/Seoul') >= ${r.from}::timestamp`;
  }
  if (r?.to) {
    return sql`(${sql.raw(completedCol)} AT TIME ZONE 'Asia/Seoul') < (${r.to}::timestamp + interval '1 day')`;
  }
  const days = r?.fallbackDays ?? 30;
  return sql`${sql.raw(completedCol)} >= (now() AT TIME ZONE 'Asia/Seoul' - make_interval(days => ${days}))`;
}

/* ============================================================
 * KPI Summary — 오늘/이번주/이번달 + 직전 동기 비교 (기간 미고정)
 * ========================================================== */
export interface KpiBucket {
  revenue: number;
  orderCount: number;
  avgTicket: number;
  cancelledCount: number;
}

export interface KpiSummary {
  today: KpiBucket;
  yesterday: KpiBucket;
  thisWeek: KpiBucket;
  lastWeek: KpiBucket;
  thisMonth: KpiBucket;
  lastMonth: KpiBucket;
  lastOrderAt: string | null;
}

export async function getKpiSummary(): Promise<KpiSummary> {
  const rows = await db.execute<{
    bucket: string;
    revenue: string | null;
    order_count: string | null;
    cancelled_count: string | null;
  }>(sql`
    WITH base AS (
      SELECT
        completed_at AT TIME ZONE 'Asia/Seoul' AS local_at,
        order_state,
        total_amount,
        cancelled_at IS NOT NULL AS is_cancelled
      FROM orders
      WHERE completed_at IS NOT NULL
    ),
    today_start AS (SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AS d),
    week_start  AS (SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AS d),
    month_start AS (SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AS d),
    buckets AS (
      SELECT 'today' AS bucket, local_at, order_state, total_amount, is_cancelled
        FROM base, today_start WHERE local_at >= d
      UNION ALL
      SELECT 'yesterday', local_at, order_state, total_amount, is_cancelled
        FROM base, today_start WHERE local_at >= d - interval '1 day' AND local_at < d
      UNION ALL
      SELECT 'thisWeek', local_at, order_state, total_amount, is_cancelled
        FROM base, week_start WHERE local_at >= d
      UNION ALL
      SELECT 'lastWeek', local_at, order_state, total_amount, is_cancelled
        FROM base, week_start WHERE local_at >= d - interval '1 week' AND local_at < d
      UNION ALL
      SELECT 'thisMonth', local_at, order_state, total_amount, is_cancelled
        FROM base, month_start WHERE local_at >= d
      UNION ALL
      SELECT 'lastMonth', local_at, order_state, total_amount, is_cancelled
        FROM base, month_start WHERE local_at >= d - interval '1 month' AND local_at < d
    )
    SELECT
      bucket,
      COALESCE(SUM(total_amount) FILTER (WHERE order_state = 'COMPLETED'), 0)::bigint AS revenue,
      COUNT(*) FILTER (WHERE order_state = 'COMPLETED')::bigint AS order_count,
      COUNT(*) FILTER (WHERE is_cancelled)::bigint AS cancelled_count
    FROM buckets
    GROUP BY bucket
  `);

  const empty: KpiBucket = { revenue: 0, orderCount: 0, avgTicket: 0, cancelledCount: 0 };
  const out: Record<string, KpiBucket> = {
    today: { ...empty },
    yesterday: { ...empty },
    thisWeek: { ...empty },
    lastWeek: { ...empty },
    thisMonth: { ...empty },
    lastMonth: { ...empty },
  };
  for (const r of rows ?? []) {
    const revenue = Number(r.revenue ?? 0);
    const orderCount = Number(r.order_count ?? 0);
    out[r.bucket] = {
      revenue,
      orderCount,
      avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
      cancelledCount: Number(r.cancelled_count ?? 0),
    };
  }

  const lastRow = await db.execute<{ last_at: string | null }>(sql`
    SELECT to_char(MAX(completed_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS last_at
    FROM orders WHERE order_state = 'COMPLETED'
  `);
  const lastOrderAt = lastRow[0]?.last_at ?? null;

  return {
    today: out.today ?? empty,
    yesterday: out.yesterday ?? empty,
    thisWeek: out.thisWeek ?? empty,
    lastWeek: out.lastWeek ?? empty,
    thisMonth: out.thisMonth ?? empty,
    lastMonth: out.lastMonth ?? empty,
    lastOrderAt,
  };
}

/* ============================================================
 * 임의 기간 요약 — Jan-Apr 같은 명시적 범위
 * ========================================================== */
export interface RangeSummary {
  revenue: number;
  orderCount: number;
  avgTicket: number;
  cancelledCount: number;
  dailyAvgRevenue: number;
  /** 활성 영업일 수 (주문 1건 이상 있었던 날) */
  activeDays: number;
}

export async function getRangeSummary(range: DateRange): Promise<RangeSummary> {
  const rows = await db.execute<{
    revenue: string | null;
    order_count: string | null;
    cancelled_count: string | null;
    active_days: string | null;
  }>(sql`
    SELECT
      COALESCE(SUM(total_amount) FILTER (WHERE order_state = 'COMPLETED'), 0)::bigint AS revenue,
      COUNT(*) FILTER (WHERE order_state = 'COMPLETED')::bigint AS order_count,
      COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL)::bigint AS cancelled_count,
      COUNT(DISTINCT (completed_at AT TIME ZONE 'Asia/Seoul')::date) FILTER (WHERE order_state = 'COMPLETED')::bigint AS active_days
    FROM orders
    WHERE completed_at IS NOT NULL AND ${rangeClause(range)}
  `);
  const r = rows[0];
  const revenue = Number(r?.revenue ?? 0);
  const orderCount = Number(r?.order_count ?? 0);
  const activeDays = Number(r?.active_days ?? 0);
  return {
    revenue,
    orderCount,
    avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    cancelledCount: Number(r?.cancelled_count ?? 0),
    activeDays,
    dailyAvgRevenue: activeDays > 0 ? Math.round(revenue / activeDays) : 0,
  };
}

/* ============================================================
 * 월별 시계열
 * ========================================================== */
export interface MonthlyPoint {
  month: string; // YYYY-MM (KST)
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getMonthlySeries(
  range: DateRange & { months?: number } = {},
): Promise<MonthlyPoint[]> {
  const r: DateRange = { ...range, fallbackDays: (range.months ?? 12) * 30 };
  const rows = await db.execute<{ month: string; revenue: string; order_count: string }>(sql`
    SELECT
      to_char(date_trunc('month', completed_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') AS month,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause(r)}
    GROUP BY 1
    ORDER BY 1
  `);
  return (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const orderCount = Number(r.order_count);
    return {
      month: r.month,
      revenue,
      orderCount,
      avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    };
  });
}

/* ============================================================
 * 주별 시계열
 * ========================================================== */
export interface WeeklyPoint {
  weekStart: string; // YYYY-MM-DD (월요일)
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getWeeklySeries(
  range: DateRange & { weeks?: number } = {},
): Promise<WeeklyPoint[]> {
  const r: DateRange = { ...range, fallbackDays: (range.weeks ?? 12) * 7 };
  const rows = await db.execute<{ week_start: string; revenue: string; order_count: string }>(sql`
    SELECT
      to_char(date_trunc('week', completed_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS week_start,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause(r)}
    GROUP BY 1
    ORDER BY 1
  `);
  return (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const orderCount = Number(r.order_count);
    return {
      weekStart: r.week_start,
      revenue,
      orderCount,
      avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    };
  });
}

/* ============================================================
 * 일별 시계열
 * ========================================================== */
export interface DailyPoint {
  date: string; // YYYY-MM-DD (KST)
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getDailySeries(
  range: DateRange & { days?: number } = {},
): Promise<DailyPoint[]> {
  const r: DateRange = { ...range, fallbackDays: range.days ?? 30 };
  const rows = await db.execute<{ date: string; revenue: string; order_count: string }>(sql`
    SELECT
      to_char(date_trunc('day', completed_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS date,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause(r)}
    GROUP BY 1
    ORDER BY 1
  `);
  return (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const orderCount = Number(r.order_count);
    return {
      date: r.date,
      revenue,
      orderCount,
      avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    };
  });
}

/* ============================================================
 * 시간대 히트맵 (요일 × 시간)
 * ========================================================== */
export interface HeatmapCell {
  dow: number;
  hour: number;
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getHourlyHeatmap(
  range: DateRange & { days?: number } = {},
): Promise<HeatmapCell[]> {
  const r: DateRange = { ...range, fallbackDays: range.days ?? 30 };
  const rows = await db.execute<{
    dow: string;
    hour: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      EXTRACT(dow FROM (completed_at AT TIME ZONE 'Asia/Seoul'))::int AS dow,
      EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul'))::int AS hour,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause(r)}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  return (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const orderCount = Number(r.order_count);
    return {
      dow: Number(r.dow),
      hour: Number(r.hour),
      revenue,
      orderCount,
      avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    };
  });
}

/* ============================================================
 * 요일별 매출 (요일 비교용)
 * ========================================================== */
export interface DowSlice {
  dow: number;
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getDowSeries(range: DateRange = {}): Promise<DowSlice[]> {
  const rows = await db.execute<{
    dow: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      EXTRACT(dow FROM (completed_at AT TIME ZONE 'Asia/Seoul'))::int AS dow,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause({ ...range, fallbackDays: 30 })}
    GROUP BY 1
    ORDER BY 1
  `);
  return (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const orderCount = Number(r.order_count);
    return {
      dow: Number(r.dow),
      revenue,
      orderCount,
      avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    };
  });
}

/* ============================================================
 * 결제수단 비중
 * ========================================================== */
export interface PaymentMethodSlice {
  method: string;
  revenue: number;
  count: number;
  share: number;
}

export async function getPaymentMethodMix(range: DateRange = {}): Promise<PaymentMethodSlice[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const rows = await db.execute<{ method: string; revenue: string; cnt: string }>(sql`
    SELECT
      p.method,
      COALESCE(SUM(p.amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS cnt
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE o.order_state = 'COMPLETED'
      AND p.state = '승인'
      AND ${rangeClause(r, "o.completed_at")}
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  const items = (rows ?? []).map((r) => ({
    method: r.method,
    revenue: Number(r.revenue),
    count: Number(r.cnt),
    share: 0,
  }));
  const total = items.reduce((s, x) => s + x.revenue, 0);
  return items.map((x) => ({ ...x, share: total > 0 ? x.revenue / total : 0 }));
}

/* ============================================================
 * 상품 랭킹
 * ========================================================== */
export interface ProductRanking {
  itemTitle: string;
  categoryTitle: string | null;
  quantity: number;
  revenue: number;
}

export async function getTopProducts(
  range: DateRange & { limit?: number } = {},
): Promise<ProductRanking[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const limit = range.limit ?? 20;
  const rows = await db.execute<{
    item_title: string;
    category_title: string | null;
    quantity: string;
    revenue: string;
  }>(sql`
    SELECT
      l.item_title,
      l.category_title,
      SUM(l.quantity)::bigint AS quantity,
      SUM(l.net_amount)::bigint AS revenue
    FROM order_line_items l
    JOIN orders o ON o.id = l.order_id
    WHERE o.order_state = 'COMPLETED' AND ${rangeClause(r, "o.completed_at")}
    GROUP BY 1, 2
    ORDER BY revenue DESC
    LIMIT ${limit}
  `);
  return (rows ?? []).map((r) => ({
    itemTitle: r.item_title,
    categoryTitle: r.category_title,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
  }));
}

/* ============================================================
 * 상품 전체 — 카테고리 필터 가능, 정렬 옵션 지원
 * ========================================================== */
export interface ProductSales {
  itemTitle: string;
  categoryTitle: string | null;
  quantity: number;
  revenue: number;
  avgPrice: number;
  /** 이 상품을 포함한 주문 건수 (distinct orders) */
  orderCount: number;
}

export async function getProductSales(
  range: DateRange & { category?: string; limit?: number } = {},
): Promise<ProductSales[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const limit = range.limit ?? 500;
  const categoryFilter = range.category
    ? sql`AND l.category_title = ${range.category}`
    : sql``;
  const rows = await db.execute<{
    item_title: string;
    category_title: string | null;
    quantity: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      l.item_title,
      l.category_title,
      SUM(l.quantity)::bigint AS quantity,
      SUM(l.net_amount)::bigint AS revenue,
      COUNT(DISTINCT l.order_id)::bigint AS order_count
    FROM order_line_items l
    JOIN orders o ON o.id = l.order_id
    WHERE o.order_state = 'COMPLETED'
      AND ${rangeClause(r, "o.completed_at")}
      ${categoryFilter}
    GROUP BY 1, 2
    ORDER BY revenue DESC
    LIMIT ${limit}
  `);
  return (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const quantity = Number(r.quantity);
    return {
      itemTitle: r.item_title,
      categoryTitle: r.category_title,
      quantity,
      revenue,
      avgPrice: quantity > 0 ? Math.round(revenue / quantity) : 0,
      orderCount: Number(r.order_count),
    };
  });
}

/* ============================================================
 * 카테고리 롤업 — 카테고리별 매출 비중
 * ========================================================== */
export interface CategoryRollup {
  category: string;
  quantity: number;
  revenue: number;
  productCount: number;
  share: number;
}

export async function getCategoryRollup(range: DateRange = {}): Promise<CategoryRollup[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const rows = await db.execute<{
    category: string;
    quantity: string;
    revenue: string;
    product_count: string;
  }>(sql`
    SELECT
      COALESCE(NULLIF(l.category_title, ''), '미분류') AS category,
      SUM(l.quantity)::bigint AS quantity,
      SUM(l.net_amount)::bigint AS revenue,
      COUNT(DISTINCT l.item_title)::bigint AS product_count
    FROM order_line_items l
    JOIN orders o ON o.id = l.order_id
    WHERE o.order_state = 'COMPLETED'
      AND ${rangeClause(r, "o.completed_at")}
    GROUP BY 1
    ORDER BY revenue DESC
  `);
  const items = (rows ?? []).map((r) => ({
    category: r.category,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
    productCount: Number(r.product_count),
    share: 0,
  }));
  const total = items.reduce((s, x) => s + x.revenue, 0);
  return items.map((x) => ({ ...x, share: total > 0 ? x.revenue / total : 0 }));
}

/* ============================================================
 * 카니발리제이션 — 같은 주문에서 자주 묶이는 상품 쌍
 * (a.title < b.title 로 중복 제거. self pair 제외.)
 * ========================================================== */
export interface ProductPair {
  productA: string;
  productB: string;
  coOrders: number;
  /** 두 상품 중 더 자주 팔린 상품 기준의 동시구매 비율 */
  liftA?: number;
}

export async function getProductPairs(
  range: DateRange & { limit?: number } = {},
): Promise<ProductPair[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const limit = range.limit ?? 30;
  const rows = await db.execute<{
    product_a: string;
    product_b: string;
    co_orders: string;
  }>(sql`
    SELECT a.item_title AS product_a, b.item_title AS product_b, COUNT(*)::bigint AS co_orders
    FROM order_line_items a
    JOIN order_line_items b ON a.order_id = b.order_id AND a.item_title < b.item_title
    JOIN orders o ON o.id = a.order_id
    WHERE o.order_state = 'COMPLETED' AND ${rangeClause(r, "o.completed_at")}
    GROUP BY 1, 2
    HAVING COUNT(*) >= 5
    ORDER BY co_orders DESC
    LIMIT ${limit}
  `);
  return (rows ?? []).map((r) => ({
    productA: r.product_a,
    productB: r.product_b,
    coOrders: Number(r.co_orders),
  }));
}

/* ============================================================
 * 시간대별 객단가 (오전 vs 오후)
 * ========================================================== */
export interface DaypartSlice {
  daypart: string; // 새벽/오전/점심/오후/저녁
  startHour: number;
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getDaypartSeries(range: DateRange = {}): Promise<DaypartSlice[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const rows = await db.execute<{
    daypart: string;
    start_hour: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      CASE
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 7  THEN '새벽 (0-6)'
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 11 THEN '오전 (7-10)'
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 14 THEN '점심 (11-13)'
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 18 THEN '오후 (14-17)'
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 22 THEN '저녁 (18-21)'
        ELSE '심야 (22-23)'
      END AS daypart,
      CASE
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 7  THEN 0
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 11 THEN 7
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 14 THEN 11
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 18 THEN 14
        WHEN EXTRACT(hour FROM (completed_at AT TIME ZONE 'Asia/Seoul')) < 22 THEN 18
        ELSE 22
      END AS start_hour,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause(r)}
    GROUP BY 1, 2
    ORDER BY 2
  `);
  return (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const orderCount = Number(r.order_count);
    return {
      daypart: r.daypart,
      startHour: Number(r.start_hour),
      revenue,
      orderCount,
      avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    };
  });
}

/* ============================================================
 * 채널(source)별 매출
 * ========================================================== */
export interface ChannelSlice {
  source: string;
  revenue: number;
  count: number;
  share: number;
  avgTicket: number;
}

export async function getChannelMix(range: DateRange = {}): Promise<ChannelSlice[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const rows = await db.execute<{ source: string; revenue: string; cnt: string }>(sql`
    SELECT
      source,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS cnt
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause(r)}
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  const items = (rows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const count = Number(r.cnt);
    return {
      source: r.source,
      revenue,
      count,
      share: 0,
      avgTicket: count > 0 ? Math.round(revenue / count) : 0,
    };
  });
  const total = items.reduce((s, x) => s + x.revenue, 0);
  return items.map((x) => ({ ...x, share: total > 0 ? x.revenue / total : 0 }));
}

/* ============================================================
 * 채널 × 일별 매출 (스택 차트용)
 * ========================================================== */
export interface ChannelDailyPoint {
  date: string;
  source: string;
  revenue: number;
  orderCount: number;
}

export async function getChannelDailySeries(range: DateRange = {}): Promise<ChannelDailyPoint[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const rows = await db.execute<{
    date: string;
    source: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      to_char(date_trunc('day', completed_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS date,
      source,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED' AND ${rangeClause(r)}
    GROUP BY 1, 2
    ORDER BY 1
  `);
  return (rows ?? []).map((r) => ({
    date: r.date,
    source: r.source,
    revenue: Number(r.revenue),
    orderCount: Number(r.order_count),
  }));
}

/* ============================================================
 * 채널별 인기 상품
 * ========================================================== */
export interface ChannelTopProduct {
  source: string;
  itemTitle: string;
  quantity: number;
  revenue: number;
}

export async function getChannelTopProducts(
  range: DateRange & { perChannel?: number } = {},
): Promise<ChannelTopProduct[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const perChannel = range.perChannel ?? 5;
  const rows = await db.execute<{
    source: string;
    item_title: string;
    quantity: string;
    revenue: string;
    rank: string;
  }>(sql`
    SELECT * FROM (
      SELECT
        o.source,
        l.item_title,
        SUM(l.quantity)::bigint AS quantity,
        SUM(l.net_amount)::bigint AS revenue,
        ROW_NUMBER() OVER (PARTITION BY o.source ORDER BY SUM(l.net_amount) DESC) AS rank
      FROM order_line_items l
      JOIN orders o ON o.id = l.order_id
      WHERE o.order_state = 'COMPLETED' AND ${rangeClause(r, "o.completed_at")}
      GROUP BY o.source, l.item_title
    ) ranked
    WHERE rank <= ${perChannel}
    ORDER BY source, rank
  `);
  return (rows ?? []).map((r) => ({
    source: r.source,
    itemTitle: r.item_title,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
  }));
}

/* ============================================================
 * 카드사(acquirer)별 결제
 * ========================================================== */
export interface CardAcquirerSlice {
  acquirer: string;
  revenue: number;
  count: number;
  share: number;
}

export async function getCardAcquirerMix(range: DateRange = {}): Promise<CardAcquirerSlice[]> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const rows = await db.execute<{ acquirer: string | null; revenue: string; cnt: string }>(sql`
    SELECT
      COALESCE(NULLIF(p.acquirer, ''), '기타') AS acquirer,
      COALESCE(SUM(p.amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS cnt
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE o.order_state = 'COMPLETED'
      AND p.state = '승인'
      AND p.method = '카드'
      AND ${rangeClause(r, "o.completed_at")}
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  const items = (rows ?? []).map((r) => ({
    acquirer: r.acquirer ?? "기타",
    revenue: Number(r.revenue),
    count: Number(r.cnt),
    share: 0,
  }));
  const total = items.reduce((s, x) => s + x.revenue, 0);
  return items.map((x) => ({ ...x, share: total > 0 ? x.revenue / total : 0 }));
}

/* ============================================================
 * 결제 취소율
 * ========================================================== */
export interface CancellationStats {
  totalPayments: number;
  cancelledPayments: number;
  cancelRate: number;
  cancelledAmount: number;
}

export async function getCancellationStats(range: DateRange = {}): Promise<CancellationStats> {
  const r: DateRange = { ...range, fallbackDays: 30 };
  const rows = await db.execute<{
    total: string;
    cancelled: string;
    cancelled_amount: string;
  }>(sql`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE p.state = '취소')::bigint AS cancelled,
      COALESCE(SUM(p.amount) FILTER (WHERE p.state = '취소'), 0)::bigint AS cancelled_amount
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE ${rangeClause(r, "o.completed_at")}
  `);
  const r0 = rows[0];
  const total = Number(r0?.total ?? 0);
  const cancelled = Number(r0?.cancelled ?? 0);
  return {
    totalPayments: total,
    cancelledPayments: cancelled,
    cancelRate: total > 0 ? cancelled / total : 0,
    cancelledAmount: Number(r0?.cancelled_amount ?? 0),
  };
}

/* ============================================================
 * 주문 페이지 — 검색/필터
 * ========================================================== */
export interface OrderListItem {
  id: string;
  orderNumber: string | null;
  source: string;
  orderState: string;
  totalAmount: number;
  completedAt: string | null;
  paymentMethods: string[];
  lineCount: number;
}

export async function listOrders(
  opts: DateRange & {
    source?: string;
    orderState?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: OrderListItem[]; total: number }> {
  const r: DateRange = { ...opts, fallbackDays: 7 };
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const sourceFilter = opts.source ? sql`AND o.source = ${opts.source}` : sql``;
  const stateFilter = opts.orderState ? sql`AND o.order_state = ${opts.orderState}` : sql``;
  const searchFilter = opts.search
    ? sql`AND (o.id ILIKE ${"%" + opts.search + "%"} OR o.order_number ILIKE ${"%" + opts.search + "%"})`
    : sql``;

  const rows = await db.execute<{
    id: string;
    order_number: string | null;
    source: string;
    order_state: string;
    total_amount: string;
    completed_at: string | null;
    methods: string[];
    line_count: string;
  }>(sql`
    SELECT
      o.id,
      o.order_number,
      o.source,
      o.order_state,
      o.total_amount::bigint,
      to_char(o.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS completed_at,
      ARRAY(
        SELECT DISTINCT p.method FROM payments p WHERE p.order_id = o.id
      ) AS methods,
      (SELECT COUNT(*)::int FROM order_line_items l WHERE l.order_id = o.id) AS line_count
    FROM orders o
    WHERE 1=1
      AND ${rangeClause(r)}
      ${sourceFilter}
      ${stateFilter}
      ${searchFilter}
    ORDER BY o.completed_at DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}
  `);

  const totalRow = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::bigint AS n FROM orders o
    WHERE ${rangeClause(r)}
      ${sourceFilter}
      ${stateFilter}
      ${searchFilter}
  `);

  return {
    items: (rows ?? []).map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      source: r.source,
      orderState: r.order_state,
      totalAmount: Number(r.total_amount),
      completedAt: r.completed_at,
      paymentMethods: r.methods ?? [],
      lineCount: Number(r.line_count),
    })),
    total: Number(totalRow[0]?.n ?? 0),
  };
}
