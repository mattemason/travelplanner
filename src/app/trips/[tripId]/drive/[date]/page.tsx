import { notFound, redirect } from "next/navigation";
import { DriveMode, type DriveTarget } from "@/components/drive/drive-mode";
import { currentUser } from "@/lib/auth";
import { dayRoute } from "@/lib/trip/drive";
import { dayLabel } from "@/lib/trip/format";
import { loadTrip } from "@/lib/trip/load";

export const metadata = { title: "Drive mode" };

/** Drive mode for one day: full screen, for a tablet on the dash. */
export default async function DrivePage({ params }: PageProps<"/trips/[tripId]/drive/[date]">) {
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
  const stopIds = trip.layout[day.id] ?? [];
  // The first point is where the day starts unless it's one of today's stops (e.g. day one).
  const startsAtStop = !!route[0]?.stopId;
  const targets: DriveTarget[] = (startsAtStop ? route : route.slice(1)).map((p) => ({
    id: p.stopId ?? `night-${p.placeId}`,
    lat: p.lat,
    lng: p.lng,
    arriveBy: p.arriveBy,
    name: p.stopId ? (trip.stops[p.stopId]?.name ?? "Stop") : (day.stay.name?.trim() || trip.places[p.placeId]?.name || "Overnight"),
    badge: p.stopId ? String(stopIds.indexOf(p.stopId) + 1) : "🛏",
  }));
  const origin =
    !startsAtStop && route[0] ? { lat: route[0].lat, lng: route[0].lng, name: trip.places[route[0].placeId]?.name ?? "Start" } : null;

  return (
    <DriveMode
      tripId={trip.id}
      dayTitle={dayLabel(day.date)}
      colour={leg?.colour ?? "#1F5A7A"}
      origin={origin}
      targets={targets}
    />
  );
}
