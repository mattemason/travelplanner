import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

// Reuse one pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { pgPool?: Pool };
const pool = globalForDb.pgPool ?? new Pool({ connectionString, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
