import "server-only";
import { parseSharedList, type SharedList } from "./shared-list-parse";

// Reads a Google Maps list from its share link. This uses the same undocumented request the
// list's own web page makes (approach from github.com/ForceGT/gmaps-list-export, MIT). It is
// unofficial: Google can change or block it at any time, so failures are reported plainly.

// Only ever follow links on Google's own hosts: a pasted link must never make the server fetch
// anything else.
const ALLOWED_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
  "google.com.au",
  "www.google.com.au",
  "maps.google.com.au",
  "consent.google.com",
]);

export class SharedListError extends Error {}

const assertGoogle = (url: URL) => {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new SharedListError("That isn't a Google Maps link. In Google Maps, open the list, tap Share and copy the link.");
  }
};

/** Follows a share link's redirects (Google hosts only) to the list page URL. */
async function resolve(link: string): Promise<{ finalUrl: string; cookies: string }> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new SharedListError("That doesn't look like a link. Paste the list's share link from Google Maps.");
  }
  const jar = new Map<string, string>();
  for (let hop = 0; hop < 6; hop++) {
    assertGoogle(url);
    const res = await fetch(url, {
      redirect: "manual",
      // A plain user agent gets a normal redirect; a full browser one gets a JavaScript page.
      headers: { "User-Agent": "Mozilla/5.0", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      cache: "no-store",
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return { finalUrl: url.toString(), cookies: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    url = new URL(next, url);
  }
  throw new SharedListError("That link redirected too many times.");
}

/** Fetches a shared list's places from its share link (or the long list URL). */
export async function fetchSharedList(link: string): Promise<SharedList> {
  const { finalUrl, cookies } = await resolve(link);
  const decoded = decodeURIComponent(finalUrl);
  // The list id is in the final URL's data (!2s<id>) or the list path; fall back to the pasted link.
  const original = decodeURIComponent(link.trim());
  const listId =
    decoded.match(/!2s(-?[\w-]+)/)?.[1] ??
    decoded.match(/\/placelists\/list\/(-?[\w-]+)/)?.[1] ??
    original.match(/\/placelists\/list\/(-?[\w-]+)/)?.[1];
  const token = decoded.match(/token=([\w-]+)/)?.[1] ?? original.match(/token=([\w-]+)/)?.[1];
  if (!listId) {
    throw new SharedListError(
      "That link doesn't open a list. In Google Maps, open the list itself (not a single place), tap Share and copy the link.",
    );
  }

  const listPage = `https://www.google.com/maps/placelists/list/${listId}${token ? `?token=${token}` : ""}`;
  const session = crypto.randomUUID().replace(/-/g, "").slice(0, 22);
  const pb = `!2e2!3e2!4i500!6m3!1s${session}!15i204459!28e2!13s${encodeURIComponent(listPage)}!16b1`;
  const api = `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=au&pb=${pb}`;
  const res = await fetch(api, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Cookie: cookies,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new SharedListError(
      res.status === 403 || res.status === 401
        ? "Google wouldn't share that list. Make sure it's shared by link (Share → anyone with the link)."
        : `Google returned an error (${res.status}). Try again later.`,
    );
  }
  let text = await res.text();
  if (text.startsWith(")]}'")) text = text.slice(4);
  try {
    const list = parseSharedList(JSON.parse(text));
    if (!list.places.length) throw new SharedListError("That list is empty, or it isn't shared publicly.");
    return list;
  } catch (err) {
    if (err instanceof SharedListError) throw err;
    throw new SharedListError("Google's list format has changed, so this link can't be read right now.");
  }
}
