import "server-only";
import { and, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { routeSegments } from "@/db/schema";
import type { LatLng, Segment } from "@/lib/trip/types";
import { pairKey, pointKey } from "@/lib/trip/drive";
import type { Directions } from "@/lib/trip/navigation";
import { gfetch, recordRouteCacheHits } from "@/lib/usage";

// Google's terms limit how long Maps content may be cached; keep route results for 30 days.
const CACHE_DAYS = 30;
const MAX_CONCURRENT = 4;

/** Drive time, distance and route line for each pair, from cache or the Routes API. */
export async function getSegments(pairs: [LatLng, LatLng][]): Promise<Record<string, Segment>> {
  const unique = new Map(pairs.map(([a, b]) => [pairKey(a, b), [a, b] as [LatLng, LatLng]]));
  if (!unique.size) return {};

  const db = getDb();
  const cached = await db
    .select()
    .from(routeSegments)
    .where(
      and(
        inArray(
          sql`${routeSegments.origin} || '|' || ${routeSegments.destination}`,
          [...unique.keys()],
        ),
        gt(routeSegments.fetchedAt, sql`now() - make_interval(days => ${CACHE_DAYS})`),
      ),
    );

  const result: Record<string, Segment> = {};
  for (const row of cached) {
    result[`${row.origin}|${row.destination}`] = {
      durationS: row.durationS,
      distanceM: row.distanceM,
      polyline: row.polyline,
    };
  }

  const missing = [...unique].filter(([key]) => !result[key]);
  recordRouteCacheHits(cached.length);
  for (let i = 0; i < missing.length; i += MAX_CONCURRENT) {
    const batch = missing.slice(i, i + MAX_CONCURRENT);
    const fetched = await Promise.all(batch.map(([, [a, b]]) => computeRoute(a, b)));
    const rows = batch.flatMap(([key, [a, b]], j) => {
      const seg = fetched[j];
      if (!seg) return [];
      result[key] = seg;
      return [{ origin: pointKey(a), destination: pointKey(b), ...seg, fetchedAt: new Date() }];
    });
    if (rows.length) {
      await db
        .insert(routeSegments)
        .values(rows)
        .onConflictDoUpdate({
          target: [routeSegments.origin, routeSegments.destination],
          set: {
            durationS: sql`excluded.duration_s`,
            distanceM: sql`excluded.distance_m`,
            polyline: sql`excluded.polyline`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    }
  }
  return result;
}

const latLng = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

/**
 * The fastest order to visit `stops` between a fixed start and end, as indexes into `stops`.
 * Null when Google can't find a drivable route through them all.
 */
export async function optimiseOrder(origin: LatLng, destination: LatLng, stops: LatLng[]): Promise<number[] | null> {
  if (stops.length < 2) return stops.map((_, i) => i);
  if (stops.length > 25) throw new Error("Too many stops to optimise (25 max)");
  const res = await gfetch("routes.pro", "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": serverKey(),
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex",
    },
    body: JSON.stringify({
      origin: latLng(origin),
      destination: latLng(destination),
      intermediates: stops.map(latLng),
      travelMode: "DRIVE",
      optimizeWaypointOrder: true,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { routes?: { optimizedIntermediateWaypointIndex?: number[] }[] };
  const order = body.routes?.[0]?.optimizedIntermediateWaypointIndex;
  return order && order.length === stops.length ? order : null;
}

function serverKey() {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_SERVER_KEY is not set");
  return key;
}

async function computeRoute(a: LatLng, b: LatLng): Promise<Segment | null> {
  const key = serverKey();
  const res = await gfetch("routes.essentials", "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode: "DRIVE",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    // An API or key problem, not "no route": fail so the caller retries instead of caching it.
    throw new Error(`Routes API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }[];
  };
  const route = body.routes?.[0];
  if (!route?.duration) return null; // no drivable route (e.g. off-road track)
  return {
    durationS: Number.parseInt(route.duration, 10),
    distanceM: route.distanceMeters ?? 0,
    polyline: route.polyline?.encodedPolyline ?? null,
  };
}

/** Turn-by-turn driving directions from a to b, for drive mode. Not cached: `a` is usually where you are. */
export async function getDirections(a: LatLng, b: LatLng): Promise<Directions | null> {
  const res = await gfetch("routes.essentials", "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": serverKey(),
      "X-Goog-FieldMask": [
        "routes.duration",
        "routes.distanceMeters",
        "routes.polyline.encodedPolyline",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.staticDuration",
        "routes.legs.steps.polyline.encodedPolyline",
        "routes.legs.steps.navigationInstruction",
      ].join(","),
    },
    body: JSON.stringify({
      origin: latLng(a),
      destination: latLng(b),
      travelMode: "DRIVE",
      languageCode: "en-AU",
      units: "METRIC",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  type Step = {
    distanceMeters?: number;
    staticDuration?: string;
    polyline?: { encodedPolyline?: string };
    navigationInstruction?: { maneuver?: string; instructions?: string };
  };
  const body = (await res.json()) as {
    routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string }; legs?: { steps?: Step[] }[] }[];
  };
  const route = body.routes?.[0];
  if (!route?.duration) return null;
  return {
    distanceM: route.distanceMeters ?? 0,
    durationS: Number.parseInt(route.duration, 10),
    polyline: route.polyline?.encodedPolyline ?? "",
    steps: (route.legs ?? []).flatMap((leg) =>
      (leg.steps ?? []).map((s) => ({
        instruction: s.navigationInstruction?.instructions ?? "",
        maneuver: s.navigationInstruction?.maneuver ?? "",
        distanceM: s.distanceMeters ?? 0,
        durationS: Number.parseInt(s.staticDuration ?? "0", 10),
        polyline: s.polyline?.encodedPolyline ?? "",
      })),
    ),
  };
}
