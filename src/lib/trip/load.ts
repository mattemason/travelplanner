import "server-only";
import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { TRAY, type Stop, type TripData } from "./types";

/** The trip if `userId` owns it, else null. */
export async function loadTrip(userId: string, tripId: string): Promise<TripData | null> {
  const db = getDb();
  // Every trip column except the cover photo bytes, which are served separately.
  const tripColumns = Object.fromEntries(
    Object.entries(getTableColumns(t.trips)).filter(([name]) => name !== "cover"),
  ) as Omit<ReturnType<typeof getTableColumns<typeof t.trips>>, "cover">;
  const [trip] = await db
    .select(tripColumns)
    .from(t.trips)
    .where(and(eq(t.trips.id, tripId), eq(t.trips.ownerId, userId)));
  if (!trip) return null;

  const [legs, days, stops, checklist] = await Promise.all([
    db.select().from(t.legs).where(eq(t.legs.tripId, trip.id)).orderBy(asc(t.legs.startDate)),
    db.select().from(t.days).where(eq(t.days.tripId, trip.id)).orderBy(asc(t.days.date)),
    db.select().from(t.stops).where(eq(t.stops.tripId, trip.id)).orderBy(asc(t.stops.position)),
    db
      .select({
        id: t.checklistItems.id,
        title: t.checklistItems.title,
        category: t.checklistItems.category,
        dueDate: t.checklistItems.dueDate,
        status: t.checklistItems.status,
      })
      .from(t.checklistItems)
      .innerJoin(t.checklists, eq(t.checklists.id, t.checklistItems.checklistId))
      .where(and(eq(t.checklists.tripId, trip.id), eq(t.checklists.userId, userId)))
      .orderBy(asc(t.checklists.createdAt), asc(t.checklistItems.position)),
  ]);

  const placeIds = [
    ...new Set([...stops.map((s) => s.placeId), ...days.flatMap((d) => (d.overnightPlaceId ? [d.overnightPlaceId] : []))]),
  ];
  const places = placeIds.length
    ? await db
        .select()
        .from(t.places)
        .where(and(eq(t.places.userId, userId), inArray(t.places.id, placeIds)))
    : [];
  const placeById = new Map(places.map((p) => [p.id, p]));
  const files = stops.length
    ? await db
        .select({
          id: t.stopAttachments.id,
          stopId: t.stopAttachments.stopId,
          name: t.stopAttachments.name,
          type: t.stopAttachments.type,
          size: t.stopAttachments.size,
        })
        .from(t.stopAttachments)
        .where(inArray(t.stopAttachments.stopId, stops.map((s) => s.id)))
        .orderBy(asc(t.stopAttachments.createdAt))
    : [];

  const layout: TripData["layout"] = { [TRAY]: [] };
  for (const d of days) layout[d.id] = [];
  for (const s of stops) (layout[s.dayId ?? TRAY] ??= []).push(s.id);

  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    maxDriveHours: trip.maxDriveHoursPerDay,
    fuelPrices: { diesel: trip.dieselPrice, petrol: trip.petrolPrice },
    icon: trip.icon,
    coverVersion: trip.coverUpdatedAt ? trip.coverUpdatedAt.getTime() : null,
    legs: legs.map((l) => ({ id: l.id, name: l.name, startDate: l.startDate, endDate: l.endDate, colour: l.colour })),
    days: days.map((d) => ({
      id: d.id,
      date: d.date,
      legId: d.legId,
      overnightPlaceId: d.overnightPlaceId,
      stay: d.stay ?? {},
      notes: d.notes ?? "",
    })),
    places: Object.fromEntries(
      places.map((p) => [
        p.id,
        { id: p.id, name: p.name, lat: p.lat, lng: p.lng, businessStatus: p.businessStatus, mapsUrl: p.mapsUrl },
      ]),
    ),
    stops: Object.fromEntries(
      stops.map((s) => [
        s.id,
        {
          id: s.id,
          placeId: s.placeId,
          name: s.label ?? placeById.get(s.placeId)?.name ?? "Untitled stop",
          time: s.plannedTime ? s.plannedTime.slice(0, 5) : null,
          tags: s.tags,
          categories: s.categories,
          notes: s.notes ?? "",
          bookingRef: s.bookingRef ?? "",
          link: s.link ?? "",
          arriveBy: s.arriveBy as Stop["arriveBy"],
          transport: s.transport ?? {},
          attachments: files
            .filter((f) => f.stopId === s.id)
            .map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size })),
        },
      ]),
    ),
    layout,
    checklist: checklist.map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      dueDate: c.dueDate,
      status: c.status as "todo" | "in_progress" | "done",
    })),
  };
}

/** The ids of trips `userId` owns, oldest first. */
export async function listTrips(userId: string) {
  return getDb()
    .select({ id: t.trips.id, name: t.trips.name, startDate: t.trips.startDate, endDate: t.trips.endDate })
    .from(t.trips)
    .where(eq(t.trips.ownerId, userId))
    .orderBy(asc(t.trips.startDate));
}
