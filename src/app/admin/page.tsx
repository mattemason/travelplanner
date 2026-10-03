import { desc, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { apiUsage, places, routeSegments, stopAttachments, stops, trips, users } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { ProviderBilling } from "./provider-billing";
import { CLAUDE_FEATURES, GOOGLE_SKUS, isAdmin, type GoogleSku } from "@/lib/usage";

export const metadata = { title: "Admin" };

const PERIODS = {
  month: { label: "This month", since: sql`date_trunc('month', now())` },
  "30d": { label: "Last 30 days", since: sql`now() - interval '30 days'` },
  all: { label: "All time", since: sql`'epoch'::timestamptz` },
} as const;
type Period = keyof typeof PERIODS;

const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString("en-AU");

/** Admin: API usage and estimated costs, plus a few app totals. */
export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (!isAdmin(user.email)) notFound();
  const sp = await searchParams;
  const period: Period = typeof sp.period === "string" && sp.period in PERIODS ? (sp.period as Period) : "month";
  const since = PERIODS[period].since;
  const db = getDb();

  const bySku = (from: typeof since) =>
    db
      .select({
        service: apiUsage.service,
        sku: apiUsage.sku,
        calls: sql<number>`coalesce(sum(${apiUsage.units}), 0)::int`,
        rows: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)::float`,
        errors: sql<number>`(count(*) filter (where not ${apiUsage.ok}))::int`,
        avgMs: sql<number | null>`avg(${apiUsage.ms}) filter (where ${apiUsage.ok})`,
      })
      .from(apiUsage)
      .where(gte(apiUsage.at, from))
      .groupBy(apiUsage.service, apiUsage.sku);

  const [rows, monthRows, daily, claude, recent, counts] = await Promise.all([
    bySku(since),
    bySku(PERIODS.month.since),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${apiUsage.at} at time zone 'Australia/Hobart'), 'YYYY-MM-DD')`,
        service: apiUsage.service,
        cost: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)::float`,
        calls: sql<number>`coalesce(sum(${apiUsage.units}), 0)::int`,
      })
      .from(apiUsage)
      .where(gte(apiUsage.at, sql`now() - interval '30 days'`))
      .groupBy(sql`1`, apiUsage.service),
    db
      .select({
        sku: apiUsage.sku,
        input: sql<number>`coalesce(sum((${apiUsage.detail}->>'input')::int), 0)::int`,
        output: sql<number>`coalesce(sum((${apiUsage.detail}->>'output')::int), 0)::int`,
        cacheRead: sql<number>`coalesce(sum((${apiUsage.detail}->>'cacheRead')::int), 0)::int`,
        searches: sql<number>`coalesce(sum((${apiUsage.detail}->>'searches')::int), 0)::int`,
      })
      .from(apiUsage)
      .where(sql`${apiUsage.service} = 'claude' and ${apiUsage.at} >= ${since}`)
      .groupBy(apiUsage.sku),
    db
      .select({
        at: apiUsage.at,
        service: apiUsage.service,
        sku: apiUsage.sku,
        units: apiUsage.units,
        cost: apiUsage.costUsd,
        ok: apiUsage.ok,
        ms: apiUsage.ms,
        detail: apiUsage.detail,
      })
      .from(apiUsage)
      .where(sql`${apiUsage.sku} <> 'routes.cache'`)
      .orderBy(desc(apiUsage.at))
      .limit(40),
    db
      .select({
        users: sql<number>`(select count(*) from ${users})::int`,
        trips: sql<number>`(select count(*) from ${trips})::int`,
        stops: sql<number>`(select count(*) from ${stops})::int`,
        places: sql<number>`(select count(*) from ${places})::int`,
        routes: sql<number>`(select count(*) from ${routeSegments})::int`,
        files: sql<number>`(select count(*) from ${stopAttachments})::int`,
        fileBytes: sql<number>`(select coalesce(sum(${stopAttachments.size}), 0) from ${stopAttachments})::float`,
      })
      .from(sql`(select 1) as one`),
  ]);

  // This month's estimated bill: Google after each SKU's monthly free allowance, plus Claude.
  const googleMonth = monthRows.filter((r) => r.service === "google" && r.sku in GOOGLE_SKUS);
  const googleBill = googleMonth.reduce((n, r) => {
    const s = GOOGLE_SKUS[r.sku as GoogleSku];
    return n + (Math.max(0, r.calls - s.free) * s.per1000) / 1000;
  }, 0);
  const googleList = googleMonth.reduce((n, r) => n + r.cost, 0);
  const claudeMonth = monthRows.filter((r) => r.service === "claude").reduce((n, r) => n + r.cost, 0);

  const google = Object.entries(GOOGLE_SKUS).map(([sku, s]) => {
    const r = rows.find((x) => x.service === "google" && x.sku === sku);
    const m = monthRows.find((x) => x.service === "google" && x.sku === sku);
    return { sku, ...s, calls: r?.calls ?? 0, cost: r?.cost ?? 0, errors: r?.errors ?? 0, avgMs: r?.avgMs ?? null, monthCalls: m?.calls ?? 0 };
  });
  const cacheHits = rows.find((r) => r.sku === "routes.cache")?.calls ?? 0;
  const routeCalls = google.find((g) => g.sku === "routes.essentials")?.calls ?? 0;
  const claudeRows = Object.entries(CLAUDE_FEATURES).map(([sku, label]) => {
    const r = rows.find((x) => x.service === "claude" && x.sku === sku);
    const t = claude.find((x) => x.sku === sku);
    return { sku, label, calls: r?.rows ?? 0, cost: r?.cost ?? 0, errors: r?.errors ?? 0, ...t };
  });
  const periodGoogle = google.reduce((n, g) => n + g.cost, 0);
  const periodClaude = claudeRows.reduce((n, c) => n + c.cost, 0);

  // Last 30 days, one bar per day.
  const days = lastDays(30).map((d) => {
    const g = daily.find((x) => x.day === d && x.service === "google")?.cost ?? 0;
    const c = daily.find((x) => x.day === d && x.service === "claude")?.cost ?? 0;
    return { d, g, c };
  });
  const maxDay = Math.max(0.01, ...days.map((d) => d.g + d.c));
  const c = counts[0];

  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 pt-[calc(20px+env(safe-area-inset-top))] pb-20 sm:px-6">
      <Link href="/" className="text-[14px] text-ocean">
        ‹ Trips
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[40px] leading-none font-bold">Admin</h1>
        <nav className="flex gap-1.5" aria-label="Period">
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <Link
              key={p}
              href={`/admin?period=${p}`}
              aria-current={p === period ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-[13.5px] font-bold ${p === period ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
            >
              {PERIODS[p].label}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mt-2 text-[14px] text-muted">
        Estimates at list price in US dollars, logged as calls are made (from 3 Oct 2026). The real bills are in{" "}
        <a className="font-bold text-ocean" href="https://console.cloud.google.com/billing" target="_blank" rel="noreferrer">
          Google Cloud billing
        </a>{" "}
        and the{" "}
        <a className="font-bold text-ocean" href="https://platform.claude.com/usage" target="_blank" rel="noreferrer">
          Claude Console
        </a>
        .
      </p>

      <section className="mt-5 grid gap-3 sm:grid-cols-4">
        <Card label="Estimated bill this month" value={usd(googleBill + claudeMonth)} note="Google after free allowances, plus Claude" />
        <Card label="Google this month" value={usd(googleBill)} note={`${usd(googleList)} before free allowances`} />
        <Card label="Claude this month" value={usd(claudeMonth)} note="Tokens and web searches" />
        <Card
          label="Drive-time cache"
          value={cacheHits + routeCalls ? `${Math.round((cacheHits / (cacheHits + routeCalls)) * 100)}%` : "–"}
          note={`${num(cacheHits)} served from cache, ${PERIODS[period].label.toLowerCase()}`}
        />
      </section>

      <Suspense fallback={<p className="mt-8 text-[14px] text-muted">Loading usage from Anthropic and Google…</p>}>
        <ProviderBilling />
      </Suspense>

      <section className="mt-8">
        <h2 className="text-[24px] font-bold">Logged by the app: daily cost, last 30 days</h2>
        <div className="mt-3 flex h-40 items-end gap-[3px] rounded-xl border border-line bg-paper p-3" role="img" aria-label="Daily estimated cost bars">
          {days.map((d) => (
            <div key={d.d} className="flex h-full flex-1 flex-col justify-end" title={`${d.d}: Google ${usd(d.g)}, Claude ${usd(d.c)}`}>
              <div className="rounded-t-sm bg-[#C2662D]" style={{ height: `${(d.c / maxDay) * 100}%` }} />
              <div className="bg-ocean" style={{ height: `${(d.g / maxDay) * 100}%` }} />
            </div>
          ))}
        </div>
        <p className="mt-1.5 flex gap-4 text-[12.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm bg-ocean" /> Google (list price)
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#C2662D]" /> Claude
          </span>
          <span className="ml-auto">Tallest day {usd(maxDay)}</span>
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-[24px] font-bold">
          Google Maps Platform <small className="font-sans text-[14px] font-normal text-muted">{usd(periodGoogle)} at list price</small>
        </h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-paper">
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <Th>SKU</Th>
                <Th right>Calls</Th>
                <Th right>List cost</Th>
                <Th right>Free this month</Th>
                <Th right>$ / 1,000</Th>
                <Th right>Errors</Th>
                <Th right>Avg time</Th>
              </tr>
            </thead>
            <tbody>
              {google.map((g) => (
                <tr key={g.sku} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <b>{g.label.split(": ")[1]}</b> <span className="text-muted">· {g.label.split(": ")[0]}</span>
                    <div className="text-[12px] text-muted">{g.use}</div>
                  </td>
                  <Td>{num(g.calls)}</Td>
                  <Td>{usd(g.cost)}</Td>
                  <Td>
                    <span className={g.monthCalls > g.free ? "font-bold text-bad-ink" : ""}>
                      {num(g.monthCalls)} / {num(g.free)}
                    </span>
                  </Td>
                  <Td>${g.per1000.toFixed(2)}</Td>
                  <Td>{g.errors ? <span className="font-bold text-bad-ink">{g.errors}</span> : "–"}</Td>
                  <Td>{g.avgMs ? `${Math.round(g.avgMs)} ms` : "–"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted">
          Autocomplete followed by a pick is billed by Google as one session, so the autocomplete figure is an upper bound.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-[24px] font-bold">
          Claude <small className="font-sans text-[14px] font-normal text-muted">{usd(periodClaude)}</small>
        </h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-paper">
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <Th>Feature</Th>
                <Th right>Responses</Th>
                <Th right>Input tokens</Th>
                <Th right>Cached input</Th>
                <Th right>Output tokens</Th>
                <Th right>Web searches</Th>
                <Th right>Cost</Th>
              </tr>
            </thead>
            <tbody>
              {claudeRows.map((r) => (
                <tr key={r.sku} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-bold">{r.label}</td>
                  <Td>{num(r.calls)}</Td>
                  <Td>{num(r.input ?? 0)}</Td>
                  <Td>{num(r.cacheRead ?? 0)}</Td>
                  <Td>{num(r.output ?? 0)}</Td>
                  <Td>{num(r.searches ?? 0)}</Td>
                  <Td>{usd(r.cost)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted">Opus 5 at $5 / $25 per million tokens in / out; web search $10 per 1,000.</p>
      </section>

      <section className="mt-8">
        <h2 className="text-[24px] font-bold">Recent calls</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-paper">
          <table className="w-full text-[13px]">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <Th>When</Th>
                <Th>Call</Th>
                <Th right>Cost</Th>
                <Th right>Time</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted">
                    {r.at.toLocaleString("en-AU", { timeZone: "Australia/Hobart", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.service === "google" ? (GOOGLE_SKUS[r.sku as GoogleSku]?.label ?? r.sku) : (CLAUDE_FEATURES[r.sku as keyof typeof CLAUDE_FEATURES] ?? r.sku)}
                    {r.service === "claude" && r.detail && (
                      <span className="text-muted">
                        {" "}
                        · {num(Number(r.detail.input ?? 0))} in / {num(Number(r.detail.output ?? 0))} out
                        {Number(r.detail.searches) ? ` · ${r.detail.searches} searches` : ""}
                      </span>
                    )}
                  </td>
                  <Td>{usd(r.cost)}</Td>
                  <Td>{r.ms ? `${num(r.ms)} ms` : "–"}</Td>
                  <td className="px-3 py-1.5">{r.ok ? <span className="text-good-ink">OK</span> : <b className="text-bad-ink">Error</b>}</td>
                </tr>
              ))}
              {!recent.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted">
                    No calls logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[24px] font-bold">App</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Card label="Users" value={num(c.users)} />
          <Card label="Trips" value={num(c.trips)} />
          <Card label="Stops" value={num(c.stops)} note={`${num(c.places)} places`} />
          <Card label="Attachments" value={num(c.files)} note={`${(c.fileBytes / 1_048_576).toFixed(1)} MB stored`} />
        </div>
        <p className="mt-2 text-[12.5px] text-muted">{num(c.routes)} drive routes cached (kept 30 days, as Google&apos;s terms allow).</p>
      </section>
    </main>
  );
}

/** The last n dates in Hobart time, oldest first, as YYYY-MM-DD. */
function lastDays(n: number): string[] {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) =>
    new Date(now - (n - 1 - i) * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Hobart" }),
  );
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="text-[12.5px] font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-display text-[30px] leading-none font-bold">{value}</p>
      {note && <p className="mt-1 text-[12.5px] text-muted">{note}</p>}
    </div>
  );
}
const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3 py-2 font-bold whitespace-nowrap ${right ? "text-right" : ""}`}>{children}</th>
);
const Td = ({ children }: { children: React.ReactNode }) => <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{children}</td>;
