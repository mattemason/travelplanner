import "server-only";
import { createSign } from "node:crypto";

// Actual Google Maps Platform request counts from Cloud Monitoring (the standard API request
// count, kept about six weeks). Needs GOOGLE_SERVICE_ACCOUNT_JSON: a service account key with the
// Monitoring Viewer role, in the Google Cloud project that holds the Maps API keys.

const SERVICES = ["routes.googleapis.com", "places.googleapis.com", "maps-backend.googleapis.com"];

/** Friendly names and list prices ($ per 1,000); a range where the price depends on the fields asked for. */
const METHOD_INFO: Record<string, { label: string; low: number; high: number }> = {
  ComputeRoutes: { label: "Routes: Compute Routes", low: 5, high: 10 },
  AutocompletePlaces: { label: "Places: Autocomplete", low: 0, high: 2.83 },
  GetPlace: { label: "Places: Place Details", low: 17, high: 20 },
  SearchText: { label: "Places: Text Search", low: 32, high: 35 },
};
function methodInfo(service: string, method: string) {
  const short = method.split(".").pop() ?? method;
  if (METHOD_INFO[short]) return { key: short, ...METHOD_INFO[short] };
  // google.maps.BaseMap.Javascript is a Dynamic Maps load.
  if (service === "maps-backend.googleapis.com") return { key: `maps:${short}`, label: "Maps JavaScript: map loads", low: 7, high: 7 };
  return { key: `${service}:${short}`, label: `${service.split(".")[0]}: ${short}`, low: 0, high: 0 };
}

export type GoogleMethodUsage = { key: string; label: string; month: number; last30: number; errors30: number; low: number; high: number };
export type GoogleBilling =
  | { ok: true; project: string; methods: GoogleMethodUsage[]; days: { date: string; count: number }[] }
  | { ok: false; reason: "not-configured" | "error"; message?: string };

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    // The key file's JSON, or base64 of it (easier to paste into some dashboards).
    return JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    return null;
  }
}

/** An OAuth token for the service account (a signed JWT exchanged at Google's token endpoint). */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/monitoring.read",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google rejected the service account (${res.status}).`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type Series = {
  resource: { labels: Record<string, string> };
  metric: { labels?: Record<string, string> };
  points: { interval: { startTime: string; endTime: string }; value: { int64Value?: string } }[];
};

let cache: { at: number; value: GoogleBilling } | null = null;
const TTL_MS = 10 * 60_000;

/** Request counts for the Maps APIs over the last 30 days, by method and by day. */
export async function googleBilling(): Promise<GoogleBilling> {
  const sa = serviceAccount();
  if (!sa) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? { ok: false, reason: "error", message: "GOOGLE_SERVICE_ACCOUNT_JSON isn't a valid key file." }
      : { ok: false, reason: "not-configured" };
  }
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const project = process.env.GOOGLE_CLOUD_PROJECT || sa.project_id;
  try {
    const token = await accessToken(sa);
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86_400_000);
    const series: Series[] = [];
    let pageToken = "";
    do {
      const url = new URL(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries`);
      url.searchParams.set(
        "filter",
        `metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api" AND resource.labels.service=one_of(${SERVICES.map((s) => `"${s}"`).join(",")})`,
      );
      url.searchParams.set("interval.startTime", start.toISOString());
      url.searchParams.set("interval.endTime", end.toISOString());
      url.searchParams.set("aggregation.alignmentPeriod", "86400s");
      url.searchParams.set("aggregation.perSeriesAligner", "ALIGN_SUM");
      url.searchParams.set("aggregation.crossSeriesReducer", "REDUCE_SUM");
      for (const f of ["resource.labels.service", "resource.labels.method", "metric.labels.response_code_class"]) {
        url.searchParams.append("aggregation.groupByFields", f);
      }
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        return {
          ok: false,
          reason: "error",
          message:
            res.status === 403
              ? `The service account can't read monitoring data in project "${project}". Give it the Monitoring Viewer role there.`
              : `Cloud Monitoring returned ${res.status}.`,
        };
      }
      const body = (await res.json()) as { timeSeries?: Series[]; nextPageToken?: string };
      series.push(...(body.timeSeries ?? []));
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);

    const monthStart = `${new Date().toISOString().slice(0, 8)}01`;
    const methods = new Map<string, GoogleMethodUsage>();
    const days = new Map<string, number>();
    for (const s of series) {
      const info = methodInfo(s.resource.labels.service ?? "", s.resource.labels.method ?? "");
      const m = methods.get(info.key) ?? { ...info, month: 0, last30: 0, errors30: 0 };
      const failed = (s.metric.labels?.response_code_class ?? "2xx") !== "2xx";
      for (const p of s.points) {
        const n = Number(p.value.int64Value ?? 0);
        const date = p.interval.startTime.slice(0, 10);
        m.last30 += n;
        if (failed) m.errors30 += n;
        if (date >= monthStart) m.month += n;
        days.set(date, (days.get(date) ?? 0) + n);
      }
      methods.set(info.key, m);
    }
    const value: GoogleBilling = {
      ok: true,
      project,
      methods: [...methods.values()].sort((a, b) => b.last30 - a.last30),
      days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("Google monitoring failed", err);
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : "Couldn't reach Google." };
  }
}
