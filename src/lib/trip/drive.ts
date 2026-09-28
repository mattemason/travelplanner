import type { ArriveBy, LatLng, Segment, TripData } from "./types";

/** Cache key for a point: 5 dp is about 1 m, plenty for road routing. */
export const pointKey = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
export const pairKey = (a: LatLng, b: LatLng) => `${pointKey(a)}|${pointKey(b)}`;

/** A point on a day's route; arriveBy is how you get there from the previous point. */
export type RoutePoint = LatLng & { placeId: string; stopId: string | null; arriveBy: ArriveBy };

/**
 * Where the trip stays on a day: its overnight place, but only when one of that day's stops is
 * marked as it. A leftover overnight that isn't among the day's stops doesn't count.
 */
export function overnightOf(trip: TripData, dayIndex: number): string | null {
  const day = trip.days[dayIndex];
  if (!day?.overnightPlaceId) return null;
  const onDay = (trip.layout[day.id] ?? []).some((id) => trip.stops[id]?.placeId === day.overnightPlaceId);
  return onDay ? day.overnightPlaceId : null;
}

/** Where a day starts: last night's overnight, or failing that the previous day's last stop. */
export function dayStart(trip: TripData, dayIndex: number): string | null {
  if (dayIndex <= 0) return null;
  const night = overnightOf(trip, dayIndex - 1);
  if (night) return night;
  const prevStops = trip.layout[trip.days[dayIndex - 1].id] ?? [];
  return trip.stops[prevStops.at(-1) ?? ""]?.placeId ?? null;
}

/**
 * The places a day's driving passes through, in order: where the day starts (last night's
 * overnight, or yesterday's last stop), the day's stops, then tonight's overnight stop if you
 * leave it and come back. Places without coordinates are skipped, and a place that repeats
 * back to back counts once.
 */
export function dayRoute(trip: TripData, dayIndex: number): RoutePoint[] {
  const day = trip.days[dayIndex];
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
  push(dayStart(trip, dayIndex), null);
  for (const stopId of trip.layout[day.id] ?? []) {
    const stop = trip.stops[stopId];
    push(stop?.placeId ?? null, stopId, stop?.arriveBy ?? "drive");
  }
  push(overnightOf(trip, dayIndex), null);
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

/**
 * An overnight ferry or flight: the day ends at the departure point and the next day's first
 * leg leaves from it by ferry or flight. Returns how, and where to, or null for a normal night.
 */
export function overnightTravel(
  trip: TripData,
  dayIndex: number,
): { mode: "ferry" | "flight"; to: string } | null {
  const night = overnightOf(trip, dayIndex);
  if (!night || dayIndex + 1 >= trip.days.length) return null;
  const next = dayRoute(trip, dayIndex + 1);
  const [from, arrive] = next;
  if (!from || !arrive || from.placeId !== night) return null;
  if (arrive.arriveBy !== "ferry" && arrive.arriveBy !== "flight") return null;
  const name = arrive.stopId ? trip.stops[arrive.stopId]?.name : trip.places[arrive.placeId]?.name;
  return { mode: arrive.arriveBy, to: name ?? "your next stop" };
}

export const overnightTravelLabel = (t: { mode: "ferry" | "flight"; to: string }) =>
  t.mode === "ferry" ? `⛴ Overnight on the ferry to ${t.to}` : `✈ Overnight flight to ${t.to}`;
