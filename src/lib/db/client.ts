import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getServerEnv } from "@/lib/config";

/**
 * 서버 전역 단일 connection pool.
 * Next.js dev 환경 HMR에서 모듈 재평가 시 연결이 누수되지 않도록 globalThis에 보관.
 *
 * `db`는 lazy proxy — 첫 호출 시점에 env를 읽고 연결을 만든다.
 * 그 덕에 `DATABASE_URL`이 없는 환경(typecheck, 빌드)에서도 모듈을 import할 수 있다.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kneadPg: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __kneadDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function getClient() {
  if (globalThis.__kneadPg) return globalThis.__kneadPg;
  const env = getServerEnv();
  const isProd = process.env.NODE_ENV === "production";
  const client = postgres(env.DATABASE_URL, {
    // Vercel serverless: 인스턴스가 동시에 여러 개 뜨므로 인스턴스당 connection 수는 낮게.
    // dev: HMR로 모듈 재평가될 때 누수 방지 + 디버깅 편의로 조금 더 허용.
    max: isProd ? 3 : 10,
    idle_timeout: isProd ? 10 : 20,
    connect_timeout: 15,
    // Supabase pooler / Neon 등 pgbouncer transaction mode 호환 위해 prepared statement 비활성.
    prepare: false,
    // Supabase pooler는 SSL 필수. URL에 sslmode가 없을 때를 위해 명시.
    ssl: "require",
    // 빌드/typecheck 같이 DATABASE_URL이 더미일 때 모듈 import 시 연결 시도 안 함.
    // — postgres-js는 lazy 연결이라 fetch 시점에만 dial. 추가 옵션 불필요.
  });
  // dev에서만 globalThis로 캐싱 — prod serverless에서는 각 인스턴스가 자체 풀.
  if (!isProd) {
    globalThis.__kneadPg = client;
  }
  return client;
}

export function getDb() {
  if (globalThis.__kneadDb) return globalThis.__kneadDb;
  const db = drizzle(getClient(), { schema, logger: process.env.NODE_ENV !== "production" });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__kneadDb = db;
  }
  return db;
}

/**
 * Lazy proxy: 실제 db 인스턴스 호출 시점에 연결을 만든다.
 * 사용처는 `db.select()...` 형태로 그대로 쓰면 됨.
 */
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
