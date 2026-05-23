-- ============================================================
-- 집계 매테리얼라이즈드 뷰
-- - 일별/시간×요일/상품×일 집계를 미리 산출해 대시보드 응답 시간 단축
-- - 적용 시점: 다른 마이그레이션이 모두 적용된 다음
-- - 갱신: 매일 새벽 4시 daily-reconcile cron 끝에 REFRESH (또는 수동)
--
-- 적용 명령:
--   psql "$DATABASE_URL" -f src/lib/db/migrations/999_materialized_views.sql
--
-- 갱신 명령:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY hourly_heatmap;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY product_daily_sales;
-- ============================================================

-- 일별 매출 (source별)
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_sales AS
SELECT
  date_trunc('day', created_at AT TIME ZONE 'Asia/Seoul') AS day,
  source,
  COUNT(*) FILTER (WHERE order_state = 'COMPLETED')          AS order_count,
  COUNT(*) FILTER (WHERE order_state = 'CANCELLED')          AS cancel_count,
  COALESCE(SUM(total_amount) FILTER (WHERE order_state = 'COMPLETED'), 0) AS revenue,
  COALESCE(AVG(total_amount) FILTER (WHERE order_state = 'COMPLETED'), 0)::bigint AS avg_ticket
FROM orders
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS daily_sales_day_source_idx
  ON daily_sales (day, source);

-- 시간×요일 히트맵
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_heatmap AS
SELECT
  EXTRACT(DOW  FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS day_of_week,
  EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS hour_of_day,
  COUNT(*)            AS order_count,
  SUM(total_amount)   AS revenue
FROM orders
WHERE order_state = 'COMPLETED'
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS hourly_heatmap_dow_hour_idx
  ON hourly_heatmap (day_of_week, hour_of_day);

-- 상품별 일 매출
CREATE MATERIALIZED VIEW IF NOT EXISTS product_daily_sales AS
SELECT
  date_trunc('day', o.created_at AT TIME ZONE 'Asia/Seoul') AS day,
  li.item_title_normalized,
  li.category_normalized,
  SUM(li.quantity)   AS units_sold,
  SUM(li.net_amount) AS revenue
FROM order_line_items li
JOIN orders o ON o.id = li.order_id
WHERE o.order_state = 'COMPLETED'
  AND li.item_title_normalized IS NOT NULL
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS product_daily_sales_day_item_idx
  ON product_daily_sales (day, item_title_normalized, category_normalized);
