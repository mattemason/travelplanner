import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Created on first use, so importing this module never needs DATABASE_URL (e.g. during `next build`).
// Reused across hot reloads in dev.
const globalForDb = globalThis as unknown as { pgPool?: Pool; db?: NodePgDatabase<typeof schema> };

export function getPool(): Pool {
  if (!globalForDb.pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForDb.pgPool = new Pool({ connectionString, max: 5 });
  }
  return globalForDb.pgPool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  globalForDb.db ??= drizzle(getPool(), { schema });
  return globalForDb.db;
}
