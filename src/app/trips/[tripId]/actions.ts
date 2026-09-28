"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { findPlace } from "@/lib/google/places";
import { TAGS, TRAY, type Stop } from "@/lib/trip/types";

// Every function here is reachable by direct POST: each one re-checks that the signed-in
// user owns the trip, and that every id it touches belongs to that trip.

async function ownedTrip(tripId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  const [trip] = await getDb()
    .select({ id: t.trips.id })
    .from(t.trips)
    .where(and(eq(t.trips.id, tripId), eq(t.trips.ownerId, user.id)));
  if (!trip) throw new Error("Trip not found");
  return { userId: user.id, tripId: trip.id };
}

const uuid = z.string().uuid();
const containerKey = z.union([z.literal(TRAY), uuid]);

/** Saves the order of the given containers (day id or "tray" → stop ids). */
export async function saveLayout(tripId: string, changes: Record<string, string[]>) {
  const { tripId: id } = await ownedTrip(tripId);
  const parsed = z.record(containerKey, z.array(uuid)).parse(changes);
  const db = getDb();

  const dayIds = Object.keys(parsed).filter((k) => k !== TRAY);
  const stopIds = Object.values(parsed).flat();
  const [days, stops] = await Promise.all([
    dayIds.length
      ? db.select({ id: t.days.id }).from(t.days).where(and(eq(t.days.tripId, id), inArray(t.days.id, dayIds)))
      : [],
    stopIds.length
      ? db.select({ id: t.stops.id }).from(t.stops).where(and(eq(t.stops.tripId, id), inArray(t.stops.id, stopIds)))
      : [],
  ]);
  if (days.length !== dayIds.length || stops.length !== new Set(stopIds).size) {
    throw new Error("Layout refers to days or stops outside this trip");
  }

  await db.transaction(async (tx) => {
    for (const [container, ids] of Object.entries(parsed)) {
      for (const [position, stopId] of ids.entries()) {
        await tx
          .update(t.stops)
          .set({ dayId: container === TRAY ? null : container, position })
          .where(and(eq(t.stops.id, stopId), eq(t.stops.tripId, id)));
      }
    }
  });
}

const stopFields = z.object({
  name: z.string().trim().max(200),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  tags: z.array(z.enum(TAGS.map((tag) => tag.key) as [string, ...string[]])),
  notes: z.string().max(4000),
  bookingRef: z.string().trim().max(200),
  link: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === "" || /^https?:\/\//i.test(v), "Links must start with http:// or https://"),
});
export type StopFields = z.infer<typeof stopFields>;

/** Saves the editor's fields for an existing stop. */
export async function updateStop(tripId: string, stopId: string, fields: StopFields): Promise<Stop> {
  const { tripId: id } = await ownedTrip(tripId);
  const f = stopFields.parse(fields);
  const db = getDb();
  const [stop] = await db
    .select({ placeId: t.stops.placeId, placeName: t.places.name })
    .from(t.stops)
    .innerJoin(t.places, eq(t.places.id, t.stops.placeId))
    .where(and(eq(t.stops.id, stopId), eq(t.stops.tripId, id)));
  if (!stop) throw new Error("Stop not found");

  const name = f.name || stop.placeName;
  await db
    .update(t.stops)
    .set({
      label: name === stop.placeName ? null : name,
      plannedTime: f.time,
      tags: f.tags,
      notes: f.notes || null,
      bookingRef: f.bookingRef || null,
      link: f.link || null,
    })
    .where(eq(t.stops.id, stopId));

  return {
    id: stopId,
    placeId: stop.placeId,
    name,
    time: f.time,
    tags: f.tags as Stop["tags"],
    notes: f.notes,
    bookingRef: f.bookingRef,
    link: f.link,
  };
}

/**
 * Creates a stop from the editor. The name is looked up with Google Places (biased to the
 * trip's area) so it lands on the map; if nothing matches it becomes a hand-added place.
 */
export async function createStop(tripId: string, container: string, position: number, fields: StopFields) {
  const { tripId: id, userId } = await ownedTrip(tripId);
  const f = stopFields.parse(fields);
  const target = containerKey.parse(container);
  const name = f.name || "Untitled stop";
  const db = getDb();

  if (target !== TRAY) {
    const [day] = await db
      .select({ id: t.days.id })
      .from(t.days)
      .where(and(eq(t.days.id, target), eq(t.days.tripId, id)));
    if (!day) throw new Error("Day not found");
  }

  const bias = await tripBounds(id);
  const found = f.name ? await findPlace(f.name, bias ?? undefined) : null;

  const [place] = found
    ? await db
        .insert(t.places)
        .values({ userId, sourceList: "manual", ...found })
        .onConflictDoUpdate({
          target: [t.places.userId, t.places.googlePlaceId],
          targetWhere: sql`google_place_id is not null`,
          set: { lat: found.lat, lng: found.lng, businessStatus: found.businessStatus },
        })
        .returning()
    : await db.insert(t.places).values({ userId, name, sourceList: "manual" }).returning();

  const [stop] = await db
    .insert(t.stops)
    .values({
      tripId: id,
      dayId: target === TRAY ? null : target,
      placeId: place.id,
      position,
      label: name === place.name ? null : name,
      plannedTime: f.time,
      tags: f.tags,
      notes: f.notes || null,
      bookingRef: f.bookingRef || null,
      link: f.link || null,
    })
    .returning({ id: t.stops.id });

  return {
    stop: {
      id: stop.id,
      placeId: place.id,
      name,
      time: f.time,
      tags: f.tags as Stop["tags"],
      notes: f.notes,
      bookingRef: f.bookingRef,
      link: f.link,
    } satisfies Stop,
    place: {
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      businessStatus: place.businessStatus,
      mapsUrl: place.mapsUrl,
    },
  };
}

export async function deleteStop(tripId: string, stopId: string) {
  const { tripId: id } = await ownedTrip(tripId);
  await getDb().delete(t.stops).where(and(eq(t.stops.id, uuid.parse(stopId)), eq(t.stops.tripId, id)));
}

export async function setChecklistStatus(tripId: string, itemId: string, done: boolean) {
  const { tripId: id } = await ownedTrip(tripId);
  await getDb()
    .update(t.checklistItems)
    .set({ status: done ? "done" : "todo" })
    .where(and(eq(t.checklistItems.id, uuid.parse(itemId)), eq(t.checklistItems.tripId, id)));
}

/** A rectangle around the trip's known places, padded, for biasing place search. */
async function tripBounds(tripId: string) {
  const [row] = await getDb()
    .select({
      minLat: sql<number>`min(${t.places.lat})`,
      maxLat: sql<number>`max(${t.places.lat})`,
      minLng: sql<number>`min(${t.places.lng})`,
      maxLng: sql<number>`max(${t.places.lng})`,
    })
    .from(t.stops)
    .innerJoin(t.places, eq(t.places.id, t.stops.placeId))
    .where(eq(t.stops.tripId, tripId));
  if (row?.minLat == null) return null;
  const pad = 0.3;
  return {
    low: { lat: Number(row.minLat) - pad, lng: Number(row.minLng) - pad },
    high: { lat: Number(row.maxLat) + pad, lng: Number(row.maxLng) + pad },
  };
}
