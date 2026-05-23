import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
console.log("URL host:", url?.match(/@([^/:]+)/)?.[1]);
console.log("URL port:", url?.match(/:(\d+)\/postgres/)?.[1]);
console.log("URL user:", url?.match(/\/\/([^:]+):/)?.[1]);
try {
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
  const r = await sql`SELECT NOW() AS now, current_database() AS db, current_user AS u`;
  console.log("OK:", r[0]);
  await sql.end();
  process.exit(0);
} catch (e) {
  console.error("FAIL code:", e.code ?? "(no code)");
  console.error("FAIL message:", e.message ?? e);
  process.exit(1);
}
