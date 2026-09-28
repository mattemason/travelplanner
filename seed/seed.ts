/**
 * Loads seed/tasmania-2027.json into Postgres for one user.
 * Re-running replaces that user's copy of the trip and its seeded places.
 *
 *   npm run seed                 (reads .env.local; replaces the trip)
 *   npm run seed -- --if-missing (runs on every start)
 *
 * --if-missing seeds when the owner has no such trip, or has one made from an older seed
 * version (meta.version). Bumping meta.version therefore REPLACES the live trip on the next
 * deploy, edits included: only bump it while the trip has no real edits.
 *
 * Needs DATABASE_URL and SEED_OWNER_EMAIL. The owner's user row is created if missing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, getPool } from "../src/db";
import * as t from "../src/db/schema";
import { parseSeed } from "../src/lib/seed-schema";

const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
const ifMissing = process.argv.includes("--if-missing");
if (!ownerEmail && !ifMissing) throw new Error("Set SEED_OWNER_EMAIL");

const seed = parseSeed(JSON.parse(readFileSync(join(__dirname, "tasmania-2027.json"), "utf8")));
const sourceList = `seed:${seed.meta.seedKey}`;
const placeName = (key: string) => seed.places.find((p) => p.key === key)!.name;

async function main() {
  if (!ownerEmail) {
    console.log("Seed skipped: SEED_OWNER_EMAIL is not set.");
    return;
  }
  const db = getDb();
  const seeded = await db.transaction(async (tx) => {
    const [owner] = await tx
      .insert(t.users)
      .values({ email: ownerEmail! })
      .onConflictDoUpdate({ target: t.users.email, set: { email: ownerEmail! } })
      .returning({ id: t.users.id });

    if (ifMissing) {
      const [existing] = await tx
        .select({ seedVersion: t.trips.seedVersion })
        .from(t.trips)
        .where(and(eq(t.trips.ownerId, owner.id), eq(t.trips.name, seed.trip.name)));
      if (existing && (existing.seedVersion ?? 0) >= seed.meta.version) return false;
    }

    // Clear any previous run: the trip cascades to days, stops, legs, events and checklist.
    await tx.delete(t.trips).where(and(eq(t.trips.ownerId, owner.id), eq(t.trips.name, seed.trip.name)));
    await tx
      .delete(t.placeLists)
      .where(and(eq(t.placeLists.userId, owner.id), eq(t.placeLists.name, seed.trip.name)));
    await tx.delete(t.places).where(and(eq(t.places.userId, owner.id), eq(t.places.sourceList, sourceList)));

    const [trip] = await tx
      .insert(t.trips)
      .values({
        ownerId: owner.id,
        name: seed.trip.name,
        startDate: seed.trip.startDate,
        endDate: seed.trip.endDate,
        startPoint: placeName(seed.trip.startPoint),
        endPoint: placeName(seed.trip.endPoint),
        maxDriveHoursPerDay: seed.trip.maxDriveHoursPerDay,
        seedVersion: seed.meta.version,
      })
      .returning({ id: t.trips.id });

    const placeRows = await tx
      .insert(t.places)
      .values(
        seed.places.map((p) => ({
          userId: owner.id,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          businessStatus: p.businessStatus ?? null,
          notes: p.notes ?? null,
          sourceList,
        })),
      )
      .returning({ id: t.places.id });
    // Postgres returns inserted rows in insert order.
    const placeId = new Map(seed.places.map((p, i) => [p.key, placeRows[i].id]));

    const [list] = await tx
      .insert(t.placeLists)
      .values({ userId: owner.id, name: seed.trip.name, source: "manual", tripId: trip.id })
      .returning({ id: t.placeLists.id });
    await tx.insert(t.placeListItems).values(placeRows.map((p) => ({ listId: list.id, placeId: p.id })));

    const legRows = await tx
      .insert(t.legs)
      .values(
        seed.legs.map((l) => ({
          tripId: trip.id,
          name: l.name,
          startDate: l.startDate,
          endDate: l.endDate,
          travellers: l.travellers,
          colour: l.colour,
        })),
      )
      .returning({ id: t.legs.id });
    const legId = new Map(seed.legs.map((l, i) => [l.key, legRows[i].id]));

    await tx.insert(t.fixedEvents).values(
      seed.fixedEvents.map((e) => ({
        tripId: trip.id,
        type: e.type,
        date: e.date,
        time: e.time,
        location: placeName(e.location),
        notes: e.notes,
      })),
    );

    const dayRows = await tx
      .insert(t.days)
      .values(
        seed.days.map((d) => ({
          tripId: trip.id,
          date: d.date,
          legId: legId.get(d.leg),
          overnightPlaceId: d.overnight ? placeId.get(d.overnight) : null,
          notes: d.notes ?? null,
        })),
      )
      .returning({ id: t.days.id });

    type SeedStop = (typeof seed.tray)[number];
    const stopRow = (s: SeedStop, dayId: string | null, position: number) => ({
      tripId: trip.id,
      dayId,
      placeId: placeId.get(s.place)!,
      position,
      plannedTime: s.time ?? null,
      tags: s.tags ?? [],
      notes: s.notes ?? null,
    });
    await tx
      .insert(t.stops)
      .values([
        ...seed.days.flatMap((d, di) => d.stops.map((s, i) => stopRow(s, dayRows[di].id, i))),
        ...seed.tray.map((s, i) => stopRow(s, null, i)),
      ]);

    const [checklist] = await tx
      .insert(t.checklists)
      .values({ userId: owner.id, tripId: trip.id, name: `${seed.trip.name} bookings`, tags: ["bookings"] })
      .returning({ id: t.checklists.id });
    await tx.insert(t.checklistItems).values(
      seed.checklist.map((c, i) => ({ checklistId: checklist.id, title: c.title, category: c.category, position: i })),
    );
    return true;
  });

  if (!seeded) {
    console.log(`Seed skipped: ${ownerEmail} already has "${seed.trip.name}".`);
    return;
  }
  const stopCount = seed.days.reduce((n, d) => n + d.stops.length, 0);
  console.log(
    `Seeded "${seed.trip.name}" for ${ownerEmail}: ${seed.days.length} days, ${stopCount} stops, ` +
      `${seed.places.length} places (${seed.tray.length} in tray), ${seed.checklist.length} checklist items.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => (ownerEmail ? getPool().end() : undefined));
