-- ============================================================
-- TimescaleDB 확장 + hypertable 변환
-- 일반 PostgreSQL에서는 확장이 없으므로 graceful skip.
-- 적용 시점: drizzle migrate가 다른 테이블을 만든 직후 1회.
-- 적용 명령(예시):
--   psql "$DATABASE_URL" -f src/lib/db/migrations/000_timescale_init.sql
-- ============================================================

-- 1) 확장 (있으면 사용, 없으면 함수 호출이 실패할 뿐 트랜잭션은 진행)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE';
    RAISE NOTICE 'TimescaleDB extension enabled';
  ELSE
    RAISE NOTICE 'TimescaleDB extension not available — skipping hypertable conversion';
  END IF;
END$$;

-- 2) orders.created_at 기준 hypertable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('orders', 'created_at', if_not_exists => TRUE, migrate_data => TRUE);
    RAISE NOTICE 'orders → hypertable on created_at';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'orders hypertable conversion skipped: %', SQLERRM;
END$$;

-- 3) payments.paid_at 기준 hypertable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('payments', 'paid_at', if_not_exists => TRUE, migrate_data => TRUE);
    RAISE NOTICE 'payments → hypertable on paid_at';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'payments hypertable conversion skipped: %', SQLERRM;
END$$;
