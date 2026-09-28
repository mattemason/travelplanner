import type { ArriveBy, LatLng, Segment, TripData } from "./types";

/** Cache key for a point: 5 dp is about 1 m, plenty for road routing. */
export const pointKey = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
export const pairKey = (a: LatLng, b: LatLng) => `${pointKey(a)}|${pointKey(b)}`;

/** A point on a day's route; arriveBy is how you get there from the previous point. */
export type RoutePoint = LatLng & { placeId: string; stopId: string | null; arriveBy: ArriveBy };

/**
 * The places a day's driving passes through, in order: last night's overnight, the day's
 * stops, then tonight's overnight. Places without coordinates are skipped, and a place that
 * repeats back to back (a stop at the overnight) counts once.
 */
export function dayRoute(trip: TripData, dayIndex: number): RoutePoint[] {
  const day = trip.days[dayIndex];
  const prev = trip.days[dayIndex - 1];
  const points: RoutePoint[] = [];
  const push = (placeId: string | null, stopId: string | null, arriveBy: ArriveBy = "drive") => {
    if (!placeId) return;
    const place = trip.places[placeId];
    if (!place || place.lat === null || place.lng === null) return;
    const last = points.at(-1);
    if (last && last.placeId === placeId) {
      if (stopId && !last.stopId) last.stopId = stopId;
      return;
    }
    points.push({ lat: place.lat, lng: place.lng, placeId, stopId, arriveBy });
  };
  push(prev?.overnightPlaceId ?? null, null);
  for (const stopId of trip.layout[day.id] ?? []) {
    const stop = trip.stops[stopId];
    push(stop?.placeId ?? null, stopId, stop?.arriveBy ?? "drive");
  }
  push(day.overnightPlaceId, null);
  return points;
}

export type DayDrive = {
  segments: { from: RoutePoint; to: RoutePoint; segment: Segment | null }[];
  totalS: number;
  totalM: number;
  complete: boolean; // false while some segments haven't loaded
};

export function dayDrive(route: RoutePoint[], cache: Record<string, Segment>): DayDrive {
  const segments = route
    .slice(1)
    .map((to, i) => ({ from: route[i], to }))
    .filter(({ to }) => to.arriveBy === "drive")
    .map(({ from, to }) => ({ from, to, segment: cache[pairKey(from, to)] ?? null }));
  return {
    segments,
    totalS: segments.reduce((n, s) => n + (s.segment?.durationS ?? 0), 0),
    totalM: segments.reduce((n, s) => n + (s.segment?.distanceM ?? 0), 0),
    complete: segments.every((s) => s.segment),
  };
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const formatDistance = (metres: number) =>
  metres < 10_000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 1000)} km`;
