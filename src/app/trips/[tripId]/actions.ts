"use server";

import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { placeDetails } from "@/lib/google/places";
import { loadTrip } from "@/lib/trip/load";
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

const placeRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("google"), googlePlaceId: z.string().min(10).max(300), session: z.string().uuid().optional() }),
  z.object({ kind: z.literal("existing"), placeId: uuid }),
  z.object({ kind: z.literal("manual") }),
]);
export type PlaceRef = z.infer<typeof placeRef>;

/**
 * Creates a stop. The place is the Google result picked in the editor, an existing place
 * (undoing a delete), or a hand-added place with no map location.
 */
export async function createStop(
  tripId: string,
  container: string,
  position: number,
  fields: StopFields,
  ref: PlaceRef,
) {
  const { tripId: id, userId } = await ownedTrip(tripId);
  const f = stopFields.parse(fields);
  const where = placeRef.parse(ref);
  const target = containerKey.parse(container);
  const db = getDb();

  if (target !== TRAY) {
    const [day] = await db
      .select({ id: t.days.id })
      .from(t.days)
      .where(and(eq(t.days.id, target), eq(t.days.tripId, id)));
    if (!day) throw new Error("Day not found");
  }

  let place: typeof t.places.$inferSelect | undefined;
  if (where.kind === "google") {
    const found = await placeDetails(where.googlePlaceId, where.session);
    if (!found) throw new Error("That place couldn't be found on Google Maps. Search again.");
    [place] = await db
      .insert(t.places)
      .values({ userId, sourceList: "manual", ...found, lastEnrichedAt: new Date() })
      .onConflictDoUpdate({
        target: [t.places.userId, t.places.googlePlaceId],
        targetWhere: sql`google_place_id is not null`,
        set: { lat: found.lat, lng: found.lng, businessStatus: found.businessStatus, lastEnrichedAt: new Date() },
      })
      .returning();
  } else if (where.kind === "existing") {
    [place] = await db
      .select()
      .from(t.places)
      .where(and(eq(t.places.id, where.placeId), eq(t.places.userId, userId)));
    if (!place) throw new Error("Place not found");
  } else {
    [place] = await db
      .insert(t.places)
      .values({ userId, name: f.name || "Untitled stop", sourceList: "manual" })
      .returning();
  }

  const name = f.name || place.name;
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const tripDetails = z
  .object({
    name: z.string().trim().min(1, "Give the trip a name").max(120),
    startDate: isoDate,
    endDate: isoDate,
    maxDriveHours: z.number().min(1).max(16),
    legs: z
      .array(
        z.object({
          id: uuid.optional(),
          name: z.string().trim().min(1, "Every leg needs a name").max(60),
          startDate: isoDate,
          endDate: isoDate,
          colour: z.string().regex(/^#[0-9a-f]{6}$/i),
        }),
      )
      .max(12),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (v.endDate < v.startDate) issue("The trip ends before it starts.");
    if (dayDiff(v.startDate, v.endDate) > 180) issue("Trips can be up to 180 days long.");
    const legs = [...v.legs].sort((a, b) => a.startDate.localeCompare(b.startDate));
    legs.forEach((l, i) => {
      if (l.endDate < l.startDate) issue(`${l.name} ends before it starts.`);
      if (l.startDate < v.startDate || l.endDate > v.endDate) issue(`${l.name} falls outside the trip dates.`);
      if (i > 0 && l.startDate <= legs[i - 1].endDate) issue(`${legs[i - 1].name} and ${l.name} overlap.`);
    });
  });
export type TripDetails = z.infer<typeof tripDetails>;

/**
 * Saves the trip's name, dates, driving limit and legs. Days are added or removed to match the
 * dates; stops on removed days move to the tray with their details. Each day's leg is the leg
 * whose dates cover it. Returns the reloaded trip.
 */
export async function updateTrip(tripId: string, details: TripDetails) {
  const { tripId: id, userId } = await ownedTrip(tripId);
  const parsed = tripDetails.safeParse(details);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the dates." };
  const v = parsed.data;
  const wanted = datesBetween(v.startDate, v.endDate);

  await getDb().transaction(async (tx) => {
    await tx
      .update(t.trips)
      .set({ name: v.name, startDate: v.startDate, endDate: v.endDate, maxDriveHoursPerDay: v.maxDriveHours })
      .where(eq(t.trips.id, id));

    // Days: move stops off removed days into the tray, then add the new dates.
    const existing = await tx.select({ id: t.days.id, date: t.days.date }).from(t.days).where(eq(t.days.tripId, id));
    const removed = existing.filter((d) => !wanted.includes(d.date));
    if (removed.length) {
      const orphaned = await tx
        .select({ id: t.stops.id })
        .from(t.stops)
        .innerJoin(t.days, eq(t.days.id, t.stops.dayId))
        .where(inArray(t.stops.dayId, removed.map((d) => d.id)))
        .orderBy(t.days.date, t.stops.position);
      const [{ trayMax }] = await tx
        .select({ trayMax: sql<number>`coalesce(max(${t.stops.position}), -1)` })
        .from(t.stops)
        .where(and(eq(t.stops.tripId, id), isNull(t.stops.dayId)));
      for (const [i, s] of orphaned.entries()) {
        await tx.update(t.stops).set({ dayId: null, position: Number(trayMax) + 1 + i }).where(eq(t.stops.id, s.id));
      }
      await tx.delete(t.days).where(inArray(t.days.id, removed.map((d) => d.id)));
    }
    const have = new Set(existing.map((d) => d.date));
    const added = wanted.filter((d) => !have.has(d));
    if (added.length) await tx.insert(t.days).values(added.map((date) => ({ tripId: id, date })));

    // Legs: delete the ones dropped, update or add the rest.
    const current = await tx.select({ id: t.legs.id }).from(t.legs).where(eq(t.legs.tripId, id));
    const keep = new Set(v.legs.flatMap((l) => (l.id ? [l.id] : [])));
    if ([...keep].some((legId) => !current.some((c) => c.id === legId))) throw new Error("Leg not in this trip");
    const drop = current.filter((c) => !keep.has(c.id)).map((c) => c.id);
    if (drop.length) await tx.delete(t.legs).where(inArray(t.legs.id, drop));
    const legIds: { id: string; startDate: string; endDate: string }[] = [];
    for (const l of v.legs) {
      const values = { name: l.name, startDate: l.startDate, endDate: l.endDate, colour: l.colour };
      if (l.id) {
        await tx.update(t.legs).set(values).where(and(eq(t.legs.id, l.id), eq(t.legs.tripId, id)));
        legIds.push({ id: l.id, ...values });
      } else {
        const [row] = await tx.insert(t.legs).values({ tripId: id, ...values }).returning({ id: t.legs.id });
        legIds.push({ id: row.id, ...values });
      }
    }

    // Each day belongs to the leg covering its date.
    await tx.update(t.days).set({ legId: null }).where(eq(t.days.tripId, id));
    for (const l of legIds) {
      await tx
        .update(t.days)
        .set({ legId: l.id })
        .where(and(eq(t.days.tripId, id), gte(t.days.date, l.startDate), lte(t.days.date, l.endDate)));
    }
  });

  const trip = await loadTrip(userId, id);
  if (!trip) throw new Error("Trip not found");
  return { ok: true as const, trip };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
