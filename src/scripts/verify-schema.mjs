import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
console.log("Tables:", tables.map(t => t.tablename).join(", "));
const userCount = await sql`SELECT COUNT(*)::int AS n FROM users`;
console.log("Users:", userCount[0].n);
await sql.end();
