import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { DayMap, type DayMapPoint, type DayMapRoute } from "@/components/planner/day-map";
import { currentUser } from "@/lib/auth";
import { getSegments } from "@/lib/google/routes";
import { estimatedArrivals } from "@/lib/trip/eta";
import { NAV_MAX_WAYPOINTS, navigateRoute, navigateTo } from "@/lib/trip/maps-link";
import {
  dayRoute,
  dayStart,
  formatDistance,
  formatDuration,
  overnightOf,
  overnightTravel,
  overnightTravelLabel,
  pairKey,
} from "@/lib/trip/drive";
import { dayLabel, timeLabel } from "@/lib/trip/format";
import { loadTrip } from "@/lib/trip/load";
import { arriveByLabel, BOOKED_MODES, tagLabel, type Segment } from "@/lib/trip/types";
import { staySummary, transportSummary } from "@/lib/trip/details";
import { dayWarnings } from "@/lib/trip/warnings";


export default async function DayViewPage({ params }: PageProps<"/trips/[tripId]/day/[date]">) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { tripId, date } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(tripId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const trip = await loadTrip(user.id, tripId);
  if (!trip) notFound();
  const index = trip.days.findIndex((d) => d.date === date);
  if (index < 0) notFound();

  const day = trip.days[index];
  const leg = trip.legs.find((l) => l.id === day.legId);
  const route = dayRoute(trip, index);
  let segments: Record<string, Segment> = {};
  try {
    // Only drive stretches are routed; ferries and flights aren't driving.
    segments = await getSegments(
      route.slice(1).flatMap((to, i) => (to.arriveBy === "drive" ? [[route[i], to] as [typeof to, typeof to]] : [])),
    );
  } catch (err) {
    console.error(err);
  }
  const segBefore = (stopId: string) => {
    const i = route.findIndex((p) => p.stopId === stopId);
    return i > 0 ? (segments[pairKey(route[i - 1], route[i])] ?? null) : undefined;
  };
  const totalS = route
    .slice(1)
    .reduce((n, to, i) => n + (to.arriveBy === "drive" ? (segments[pairKey(route[i], to)]?.durationS ?? 0) : 0), 0);
  const stops = (trip.layout[day.id] ?? []).map((id) => trip.stops[id]);
  const eta = estimatedArrivals(route, trip.stops, (a, b) => segments[pairKey(a, b)]);
  // Map: numbered stops, the day's start/overnight as plain pins, road routes or dashed crossings.
  const mapPoints: DayMapPoint[] = route.map((p) => ({
    id: p.stopId ?? `place-${p.placeId}`,
    lat: p.lat,
    lng: p.lng,
    badge: p.stopId ? String(stops.findIndex((s) => s.id === p.stopId) + 1) : "•",
    name: p.stopId ? (trip.stops[p.stopId]?.name ?? "") : (trip.places[p.placeId]?.name ?? ""),
  }));
  const mapRoutes: DayMapRoute[] = route.slice(1).flatMap((to, i): DayMapRoute[] => {
    if (to.arriveBy !== "drive") return [{ points: [{ lat: route[i].lat, lng: route[i].lng }, { lat: to.lat, lng: to.lng }] }];
    const path = segments[pairKey(route[i], to)]?.polyline;
    return path ? [{ path }] : [];
  });
  const warnings = dayWarnings(trip, day.id, totalS || null);
  const travel = overnightTravel(trip, index);
  const overnight = travel
    ? overnightTravelLabel(travel)
    : overnightOf(trip, index)
      ? day.stay.name?.trim() || trip.places[overnightOf(trip, index)!]?.name
      : null;
  const prevOvernight = trip.places[dayStart(trip, index) ?? ""]?.name ?? null;
  const weatherStops = stops.filter((s) => s.tags.includes("weather"));

  return (
    <main
      className="mx-auto w-full max-w-[640px] flex-1 bg-paper pt-[calc(10px+env(safe-area-inset-top))] pb-16 sm:my-6 sm:rounded-2xl"
      style={{ "--legc": leg?.colour ?? "var(--ocean)" } as CSSProperties}
    >
      <div className="px-[18px] pb-3">
        <Link href={`/trips/${trip.id}`} className="text-[14px] text-ocean">
          ‹ {trip.name}
        </Link>
        <h1 className="mt-0.5 text-[32px] font-bold">{dayLabel(day.date)}</h1>
        <p className="text-[14px] text-muted">
          <span className="font-bold text-[var(--legc)]">{leg?.name}</span>
          {prevOvernight && overnight ? `, ${prevOvernight} to ${overnight}` : ""}
        </p>
      </div>

      <div className="mb-3">
        <DayMap points={mapPoints} routes={mapRoutes} legHex={leg?.colour ?? "#1F5A7A"} mapTypes={trip.mapTypes} />
      </div>

      <div className="flex gap-2 px-[18px] pb-3">
        <Stat value={totalS ? formatDuration(totalS) : "–"} label="driving" />
        <Stat value={String(stops.length)} label={stops.length === 1 ? "stop" : "stops"} />
        <Stat value={overnight ?? "–"} label="tonight" />
      </div>
      {navigateRoute(route.slice(1)) && (
        <div className="px-[18px] pb-3">
          <a href={navigateRoute(route.slice(1))!} target="_blank" rel="noopener noreferrer" className="btn btn-primary w-full">
            Navigate this day in Google Maps
          </a>
          {route.length - 2 > NAV_MAX_WAYPOINTS && (
            <p className="mt-1 text-[12.5px] text-muted">Google takes up to {NAV_MAX_WAYPOINTS} stops on the way, so later stops are left off.</p>
          )}
        </div>
      )}
      {!travel && staySummary(day.stay) && (
        <p className="px-[18px] pb-3 text-[13.5px] text-muted">Stay: {staySummary(day.stay)}</p>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 px-[18px] pb-2">
          {warnings.map((w) => (
            <p key={w.title} className={`notice ${w.kind === "bad" ? "notice-bad" : "notice-warn"}`}>
              <b className="block text-[14px]">{w.title}</b>
              {w.text}
            </p>
          ))}
        </div>
      )}

      <ol className="px-[18px] pb-2">
        {stops.map((stop) => {
          const place = trip.places[stop.placeId];
          const seg = segBefore(stop.id);
          const nav =
            place?.lat != null && place.lng != null
              ? navigateTo({ lat: place.lat, lng: place.lng })
              : null;
          return (
            <li key={stop.id}>
              {seg !== undefined && (
                <div className="relative py-1 pl-16 text-[13px] text-muted">
                  <span className="absolute top-[-6px] bottom-[-6px] left-[52px] w-[3px] rounded bg-[var(--legc)]" />
                  {stop.arriveBy !== "drive" ? (
                    <b className="text-ink">{arriveByLabel(stop.arriveBy)}</b>
                  ) : seg ? (
                    <>
                      <b className="text-ink">{formatDuration(seg.durationS)}</b>, {formatDistance(seg.distanceM)}
                      {stop.tags.includes("4wd") ? ", 4WD" : ""}
                    </>
                  ) : (
                    "No road route"
                  )}
                </div>
              )}
              <div className="relative py-3 pl-16">
                <span className="absolute top-3.5 left-0 font-display text-[17px] font-semibold">
                  {stop.time ? timeLabel(stop.time) : eta[stop.id] ? `~${timeLabel(eta[stop.id])}` : ""}
                </span>
                <span className="absolute top-[18px] left-[47px] h-3 w-3 rounded-full border-[3px] border-[var(--legc)] bg-paper" />
                <div className="font-bold">{stop.name}</div>
                {(stop.tags.length > 0 || stop.categories.length > 0 || place?.businessStatus?.startsWith("CLOSED")) && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {stop.categories.map((c) => (
                      <span key={`c-${c}`} className="chip border-ocean bg-paper text-ocean">
                        {c}
                      </span>
                    ))}
                    {stop.tags.map((t) => (
                      <span key={t} className="chip">
                        {tagLabel(t)}
                      </span>
                    ))}
                    {place?.businessStatus?.startsWith("CLOSED") && (
                      <span className="chip chip-closed">Temporarily closed</span>
                    )}
                  </div>
                )}
                {stop.notes && <p className="mt-1 mb-1.5 text-[13.5px] whitespace-pre-line text-muted">{stop.notes}</p>}
                {BOOKED_MODES.includes(stop.arriveBy) && transportSummary(stop.transport, day.date) && (
                  <p className="text-[13px] text-ink">{transportSummary(stop.transport, day.date)}</p>
                )}
                {stop.bookingRef && <p className="text-[13px] text-good-ink">Ref {stop.bookingRef}</p>}
                {nav && (
                  <a
                    href={nav}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block rounded-full border-[1.5px] border-line px-3 py-1 text-[13px] font-bold text-ocean"
                  >
                    Navigate
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {weatherStops.length > 0 && (
        <div className="mx-[18px] mt-2 rounded-[14px] border-[1.5px] border-dashed border-line px-3.5 py-3">
          <h2 className="text-[20px] font-semibold">If the weather turns</h2>
          <p className="mt-1 mb-2.5 text-[13.5px] text-muted">
            {weatherStops.map((s) => s.name).join(", ")} depend{weatherStops.length === 1 ? "s" : ""} on conditions. Check
            the forecast and road reports the night before.
          </p>
          <button type="button" className="btn" disabled title="Coming in Phase 3">
            Re-plan from here
          </button>
        </div>
      )}
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-soft px-2.5 py-2">
      <em className="block truncate font-display text-[22px] leading-[1.1] font-bold not-italic">{value}</em>
      <small className="text-[12px] text-muted">{label}</small>
    </div>
  );
}
