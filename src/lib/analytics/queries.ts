/**
 * 매출 분석 SQL 쿼리.
 *
 * 시간대 정책: 모든 그룹핑은 Asia/Seoul 기준.
 *   `completed_at AT TIME ZONE 'Asia/Seoul'` 로 변환 후 date_trunc/extract.
 *
 * 상태 정책: COMPLETED만 매출/객단가 계산에 포함.
 *   취소(CANCELLED)는 cancellationRate 같은 보조 지표에서만 사용.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/* ============================================================
 * KPI Summary — 오늘/이번주/이번달 + 직전 동기 비교
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
  /** 최근 주문 시각 (Asia/Seoul) — "데이터 신선도" 체크용 */
  lastOrderAt: string | null;
}

/**
 * 6개 구간의 KPI를 한 번에 계산. 전부 KST.
 * - 오늘: KST 자정부터
 * - 어제: 어제 자정 ~ 오늘 자정
 * - 이번주: 이번 월요일부터 (date_trunc('week', ...)는 월요일 시작)
 * - 지난주: 직전 월요일 ~ 이번 월요일
 * - 이번달 / 지난달: date_trunc('month', ...) 동일 패턴
 */
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
 * 월별 시계열
 * ========================================================== */
export interface MonthlyPoint {
  /** YYYY-MM (KST) */
  month: string;
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getMonthlySeries(months = 12): Promise<MonthlyPoint[]> {
  const rows = await db.execute<{
    month: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      to_char(date_trunc('month', completed_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') AS month,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED'
      AND completed_at >= (now() AT TIME ZONE 'Asia/Seoul' - make_interval(months => ${months}))
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
 * 주별 시계열 (월요일 시작)
 * ========================================================== */
export interface WeeklyPoint {
  /** YYYY-MM-DD — 그 주의 월요일 */
  weekStart: string;
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getWeeklySeries(weeks = 12): Promise<WeeklyPoint[]> {
  const rows = await db.execute<{
    week_start: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      to_char(date_trunc('week', completed_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS week_start,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED'
      AND completed_at >= (now() AT TIME ZONE 'Asia/Seoul' - make_interval(weeks => ${weeks}))
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
 * 일별 시계열 (지난 N일)
 * ========================================================== */
export interface DailyPoint {
  date: string; // YYYY-MM-DD (KST)
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getDailySeries(days = 30): Promise<DailyPoint[]> {
  const rows = await db.execute<{
    date: string;
    revenue: string;
    order_count: string;
  }>(sql`
    SELECT
      to_char(date_trunc('day', completed_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS date,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS order_count
    FROM orders
    WHERE order_state = 'COMPLETED'
      AND completed_at >= (now() AT TIME ZONE 'Asia/Seoul' - make_interval(days => ${days}))
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
 *   - dow: 0(일) ~ 6(토). PostgreSQL EXTRACT(dow ...) 동일.
 *   - hour: 0~23
 * ========================================================== */
export interface HeatmapCell {
  dow: number;
  hour: number;
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export async function getHourlyHeatmap(days = 30): Promise<HeatmapCell[]> {
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
    WHERE order_state = 'COMPLETED'
      AND completed_at >= (now() AT TIME ZONE 'Asia/Seoul' - make_interval(days => ${days}))
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
 * 결제수단 비중
 * ========================================================== */
export interface PaymentMethodSlice {
  method: string;
  revenue: number;
  count: number;
  share: number; // 0~1
}

export async function getPaymentMethodMix(days = 30): Promise<PaymentMethodSlice[]> {
  const rows = await db.execute<{ method: string; revenue: string; cnt: string }>(sql`
    SELECT
      p.method,
      COALESCE(SUM(p.amount), 0)::bigint AS revenue,
      COUNT(*)::bigint AS cnt
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE o.order_state = 'COMPLETED'
      AND p.state = '승인'
      AND p.paid_at >= (now() AT TIME ZONE 'Asia/Seoul' - make_interval(days => ${days}))
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

export async function getTopProducts(days = 30, limit = 20): Promise<ProductRanking[]> {
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
    WHERE o.order_state = 'COMPLETED'
      AND o.completed_at >= (now() AT TIME ZONE 'Asia/Seoul' - make_interval(days => ${days}))
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
