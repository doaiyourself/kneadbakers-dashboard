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
  const client = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    prepare: false, // Neon / pgbouncer transaction mode 호환
  });
  if (process.env.NODE_ENV !== "production") {
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
