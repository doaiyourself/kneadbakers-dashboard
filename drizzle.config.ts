import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// .env.local 우선, 없으면 .env 로드. drizzle-kit은 자동 env 로딩이 없음.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn(
    "\n[drizzle.config] DATABASE_URL 이 비어 있습니다. .env.local 확인 또는 DATABASE_URL=... npm run db:push 형태로 실행하세요.\n",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dbCredentials: { url: url ?? "postgres://localhost:5432/__missing__" },
  strict: true,
  verbose: true,
  casing: "snake_case",
});
