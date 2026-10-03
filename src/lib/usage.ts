import "server-only";
import { getDb } from "@/db";
import { apiUsage } from "@/db/schema";

// Logs each paid API call with an estimated cost, for the admin page. Estimates use list
// prices (USD); the real bill is in Google Cloud and the Claude Console.

/** Google Maps Platform SKUs this app uses: list price per 1,000 and the monthly free allowance. */
export const GOOGLE_SKUS = {
  "routes.essentials": { label: "Routes: Compute Routes Essentials", per1000: 5, free: 10_000, use: "Drive times, drive mode directions" },
  "routes.pro": { label: "Routes: Compute Routes Pro", per1000: 10, free: 5_000, use: "Re-route (waypoint optimisation)" },
  "places.autocomplete": { label: "Places: Autocomplete Requests", per1000: 2.83, free: 10_000, use: "Place search as you type" },
  "places.details.pro": { label: "Places: Place Details Pro", per1000: 17, free: 5_000, use: "Picking a search suggestion" },
  "places.details.enterprise": { label: "Places: Place Details Enterprise", per1000: 20, free: 1_000, use: "Tapping Google's map icons" },
  "places.text.pro": { label: "Places: Text Search Pro", per1000: 32, free: 5_000, use: "Matching places from shared lists" },
  "places.text.enterprise": { label: "Places: Text Search Enterprise", per1000: 35, free: 1_000, use: "Search on the map" },
  "maps.dynamic": { label: "Maps JavaScript: Dynamic Maps", per1000: 7, free: 10_000, use: "Each map shown" },
} as const;
export type GoogleSku = keyof typeof GOOGLE_SKUS;

export const CLAUDE_FEATURES = {
  "claude.stop_info": "Stop info chat",
  "claude.plan": "Plan my trip",
} as const;
export type ClaudeFeature = keyof typeof CLAUDE_FEATURES;

/** $ per million tokens by model family; unknown models are priced as Opus 5. */
const CLAUDE_PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /opus-5-5/, input: 4, output: 20 },
  { match: /opus/, input: 5, output: 25 },
  { match: /fable|mythos/, input: 10, output: 50 },
  { match: /sonnet/, input: 3, output: 15 },
  { match: /haiku/, input: 1, output: 5 },
];
const WEB_SEARCH_PER_1000 = 10;

export type ClaudeUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

/** Estimated $ for one Claude response: tokens at list price, cache writes 1.25x, reads 0.1x, plus web searches. */
export function claudeCost(model: string, u: ClaudeUsage): number {
  const p = CLAUDE_PRICES.find((x) => x.match.test(model)) ?? CLAUDE_PRICES[1];
  const tokens =
    (u.input_tokens ?? 0) * p.input +
    (u.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
    (u.cache_read_input_tokens ?? 0) * p.input * 0.1 +
    (u.output_tokens ?? 0) * p.output;
  return tokens / 1_000_000 + ((u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_PER_1000) / 1000;
}

type Entry = { ok?: boolean; ms?: number; units?: number; userId?: string | null; detail?: Record<string, unknown> };

function insert(service: "google" | "claude", sku: string, costUsd: number, e: Entry) {
  // Fire and forget: usage logging must never slow down or break the feature itself.
  void getDb()
    .insert(apiUsage)
    .values({
      service,
      sku,
      units: e.units ?? 1,
      costUsd,
      ok: e.ok ?? true,
      ms: e.ms ?? null,
      userId: e.userId ?? null,
      detail: e.detail ?? null,
    })
    .catch((err) => console.error("Usage log failed", err));
}

/** Records Google calls (at list price, before the free allowance). */
export function recordGoogle(sku: GoogleSku, e: Entry = {}) {
  insert("google", sku, ((e.units ?? 1) * GOOGLE_SKUS[sku].per1000) / 1000, e);
}

/** Records one Claude response with its token usage. */
export function recordClaude(feature: ClaudeFeature, model: string, usage: ClaudeUsage, e: Entry = {}) {
  insert("claude", feature, claudeCost(model, usage), {
    ...e,
    detail: {
      model,
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      searches: usage.server_tool_use?.web_search_requests ?? 0,
      ...e.detail,
    },
  });
}

/** Times a Google call and records it, whether it succeeds or throws. */
export async function trackGoogle<T>(sku: GoogleSku, call: () => Promise<T>, okOf: (r: T) => boolean = () => true): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await call();
    recordGoogle(sku, { ms: Date.now() - t0, ok: okOf(r) });
    return r;
  } catch (err) {
    recordGoogle(sku, { ms: Date.now() - t0, ok: false });
    throw err;
  }
}

/** Who can see /admin: ADMIN_EMAILS (comma-separated), or else the owner the seed trip was made for. */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || process.env.SEED_OWNER_EMAIL || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** fetch() for a billed Google endpoint: records the call (with status and time) under its SKU. */
export async function gfetch(sku: GoogleSku, url: string | URL, init?: RequestInit): Promise<Response> {
  return trackGoogle(sku, () => fetch(url, init), (r) => r.ok);
}

/** Drive times served from our 30-day cache instead of a billed Routes call. */
export function recordRouteCacheHits(n: number) {
  if (n > 0) insert("google", "routes.cache", 0, { units: n });
}
