import { getPool } from "@/db";

// Reports whether Postgres is reachable and which migrations are applied. No user data.
export async function GET() {
  try {
    const { rows } = await getPool().query<{ hash: string; created_at: string }>(
      "select hash, created_at from drizzle.__drizzle_migrations order by created_at",
    );
    return Response.json({ ok: true, db: "up", migrations: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, db: "down", error: message }, { status: 503 });
  }
}
