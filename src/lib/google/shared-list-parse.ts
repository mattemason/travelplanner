// Parsing and diffing for Google Maps shared lists. Pure functions, no network, so they can be
// tested. The response shape comes from Google's undocumented list endpoint (see
// shared-list.ts); it can change without notice, so every field is read defensively.

export type ListPlace = {
  key: string; // stable identity: the CID when present, else rounded coordinates + name
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  cid: string | null; // Google's "cid" pair, e.g. "0x6b...:0x3c..."
  note: string | null; // the note on the list entry, if any
};

export type SharedList = { title: string | null; places: ListPlace[] };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parses the getlist response body (after Google's ")]}'" prefix is removed). */
export function parseSharedList(data: unknown): SharedList {
  const root = Array.isArray(data) ? data[0] : null;
  if (!Array.isArray(root)) throw new Error("Unexpected list response");
  const title = str(root[4]);
  const entries: unknown[] = Array.isArray(root[8]) ? root[8] : [];
  const places: ListPlace[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const info: unknown[] = Array.isArray(entry[1]) ? entry[1] : [];
    const name = str(entry[2]) ?? str(info[2]) ?? "Unnamed place";
    const coords: unknown[] = Array.isArray(info[5]) ? info[5] : [];
    const lat = num(coords[2]);
    const lng = num(coords[3]);
    const cidPair: unknown[] = Array.isArray(info[6]) ? info[6] : [];
    const cid = str(cidPair[0]) && str(cidPair[1]) ? `${cidPair[0]}:${cidPair[1]}` : null;
    const key = cid ?? `${lat?.toFixed(5)},${lng?.toFixed(5)}|${name.toLowerCase()}`;
    places.push({ key, name, address: str(info[4]), lat, lng, cid, note: str(entry[3]) });
  }
  return { title, places };
}

export type TripPlaceRef = { placeId: string; name: string; lat: number | null; lng: number | null; cid: string | null };

/** Metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const MATCH_RADIUS_M = 150;

/** The trip place a list entry already corresponds to: same CID, or within 150 m. */
export function matchPlace(p: ListPlace, tripPlaces: TripPlaceRef[]): TripPlaceRef | null {
  if (p.cid) {
    const byCid = tripPlaces.find((t) => t.cid === p.cid);
    if (byCid) return byCid;
  }
  if (p.lat === null || p.lng === null) return null;
  let best: TripPlaceRef | null = null;
  let bestD = MATCH_RADIUS_M;
  for (const t of tripPlaces) {
    if (t.lat === null || t.lng === null) continue;
    const d = distanceM({ lat: p.lat, lng: p.lng }, { lat: t.lat, lng: t.lng });
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

export type ListDiff = {
  added: ListPlace[]; // on the list, not in the trip yet
  existing: { place: ListPlace; match: TripPlaceRef }[];
  removed: TripPlaceRef[]; // came from this list before, no longer on it
};

/**
 * Compares a list with the trip. `previouslySynced` are the places imported from this list
 * last time; any that aren't on the list any more are reported as removed (never deleted).
 */
export function diffList(list: SharedList, tripPlaces: TripPlaceRef[], previouslySynced: TripPlaceRef[]): ListDiff {
  const added: ListPlace[] = [];
  const existing: ListDiff["existing"] = [];
  for (const p of list.places) {
    const match = matchPlace(p, tripPlaces);
    if (match) existing.push({ place: p, match });
    else added.push(p);
  }
  const matchedIds = new Set(existing.map((e) => e.match.placeId));
  const removed = previouslySynced.filter(
    (prev) => !matchedIds.has(prev.placeId) && !list.places.some((p) => matchPlace(p, [prev])),
  );
  return { added, existing, removed };
}
