// Applies pending SQL migrations in ./drizzle. Runs on Railway before each deploy
// (railway.json preDeployCommand), inside the private network where DATABASE_URL resolves.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
} finally {
  await pool.end();
}
