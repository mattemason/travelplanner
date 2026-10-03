import "server-only";

// Actual Claude costs from Anthropic's Cost API (Admin API). Needs ANTHROPIC_ADMIN_KEY
// (sk-ant-admin01-...). Covers the whole organisation, not just this app.

export type ClaudeBilling =
  | {
      ok: true;
      days: { date: string; usd: number }[];
      lines: { description: string; model: string | null; usd: number }[];
      monthUsd: number;
      totalUsd: number;
    }
  | { ok: false; reason: "not-configured" | "error"; message?: string };

let cache: { at: number; value: ClaudeBilling } | null = null;
const TTL_MS = 10 * 60_000; // the API asks for no more than about one poll a minute

/** Daily costs for the last 31 days (USD), and a breakdown by line item. */
export async function claudeBilling(): Promise<ClaudeBilling> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return { ok: false, reason: "not-configured" };
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const end = new Date();
  end.setUTCHours(24, 0, 0, 0); // end of today (UTC), so today's partial day is included
  const start = new Date(end.getTime() - 31 * 86_400_000);
  const days = new Map<string, number>();
  const lines = new Map<string, { description: string; model: string | null; usd: number }>();
  try {
    let page: string | null = null;
    do {
      const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
      url.searchParams.set("starting_at", start.toISOString());
      url.searchParams.set("ending_at", end.toISOString());
      url.searchParams.set("limit", "31");
      url.searchParams.append("group_by[]", "description");
      if (page) url.searchParams.set("page", page);
      const res = await fetch(url, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "User-Agent": "TripPlanner/1.0 (travel.emason.com.au)" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: "error",
          message:
            res.status === 401 || res.status === 403
              ? "The admin key was rejected. Check ANTHROPIC_ADMIN_KEY."
              : `Anthropic returned ${res.status}.`,
        };
      }
      const body = (await res.json()) as {
        data: { starting_at: string; results: { amount: string; description?: string | null; model?: string | null }[] }[];
        has_more: boolean;
        next_page: string | null;
      };
      for (const bucket of body.data) {
        const date = bucket.starting_at.slice(0, 10);
        for (const r of bucket.results) {
          const usd = Number(r.amount) / 100; // amounts are in cents
          days.set(date, (days.get(date) ?? 0) + usd);
          const k = r.description ?? "Other";
          const line = lines.get(k) ?? { description: k, model: r.model ?? null, usd: 0 };
          line.usd += usd;
          lines.set(k, line);
        }
      }
      page = body.has_more ? body.next_page : null;
    } while (page);
  } catch (err) {
    console.error("Claude cost report failed", err);
    return { ok: false, reason: "error", message: "Couldn't reach Anthropic." };
  }

  const monthStart = `${new Date().toISOString().slice(0, 8)}01`;
  const sorted = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, usd]) => ({ date, usd }));
  const value: ClaudeBilling = {
    ok: true,
    days: sorted,
    lines: [...lines.values()].sort((a, b) => b.usd - a.usd),
    monthUsd: sorted.filter((d) => d.date >= monthStart).reduce((n, d) => n + d.usd, 0),
    totalUsd: sorted.reduce((n, d) => n + d.usd, 0),
  };
  cache = { at: Date.now(), value };
  return value;
}
