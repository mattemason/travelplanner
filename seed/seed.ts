/**
 * Loads seed/tasmania-2027.json into Supabase for one user.
 * Re-running replaces that user's copy of the trip and its seeded places.
 *
 *   npm run seed            (reads .env.local)
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SEED_OWNER_EMAIL.
 * The owner is created as a confirmed auth user if they don't exist yet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseSeed } from "../src/lib/seed-schema";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.SEED_OWNER_EMAIL;
if (!url || !serviceKey || !ownerEmail) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SEED_OWNER_EMAIL");
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const seed = parseSeed(JSON.parse(readFileSync(join(__dirname, "tasmania-2027.json"), "utf8")));
const sourceList = `seed:${seed.meta.seedKey}`;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

async function findOrCreateOwner(email: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const ownerId = await findOrCreateOwner(ownerEmail!);

  // Clear any previous run: the trip cascades to days, stops, legs, events and checklist.
  must(await db.from("trips").delete().eq("owner_id", ownerId).eq("name", seed.trip.name), "delete trip");
  must(await db.from("place_lists").delete().eq("user_id", ownerId).eq("name", seed.trip.name), "delete list");
  must(await db.from("places").delete().eq("user_id", ownerId).eq("source_list", sourceList), "delete places");

  const trip = must(
    await db
      .from("trips")
      .insert({
        owner_id: ownerId,
        name: seed.trip.name,
        start_date: seed.trip.startDate,
        end_date: seed.trip.endDate,
        start_point: seed.places.find((p) => p.key === seed.trip.startPoint)!.name,
        end_point: seed.places.find((p) => p.key === seed.trip.endPoint)!.name,
        max_drive_hours_per_day: seed.trip.maxDriveHoursPerDay,
      })
      .select("id")
      .single(),
    "insert trip",
  );

  const places = must(
    await db
      .from("places")
      .insert(
        seed.places.map((p) => ({
          user_id: ownerId,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          business_status: p.businessStatus ?? null,
          notes: p.notes ?? null,
          source_list: sourceList,
        })),
      )
      .select("id, name"),
    "insert places",
  );
  const placeId = new Map(seed.places.map((p) => [p.key, places.find((r) => r.name === p.name)!.id]));

  const list = must(
    await db
      .from("place_lists")
      .insert({ user_id: ownerId, name: seed.trip.name, source: "manual", trip_id: trip.id })
      .select("id")
      .single(),
    "insert list",
  );
  must(
    await db.from("place_list_items").insert(places.map((p) => ({ list_id: list.id, place_id: p.id }))),
    "insert list items",
  );

  const legs = must(
    await db
      .from("legs")
      .insert(
        seed.legs.map((l) => ({
          trip_id: trip.id,
          name: l.name,
          start_date: l.startDate,
          end_date: l.endDate,
          travellers: l.travellers,
          colour: l.colour,
        })),
      )
      .select("id, name"),
    "insert legs",
  );
  const legId = new Map(seed.legs.map((l) => [l.key, legs.find((r) => r.name === l.name)!.id]));

  must(
    await db.from("fixed_events").insert(
      seed.fixedEvents.map((e) => ({
        trip_id: trip.id,
        type: e.type,
        date: e.date,
        time: e.time,
        location: seed.places.find((p) => p.key === e.location)!.name,
        notes: e.notes,
      })),
    ),
    "insert fixed events",
  );

  const days = must(
    await db
      .from("days")
      .insert(
        seed.days.map((d) => ({
          trip_id: trip.id,
          date: d.date,
          leg_id: legId.get(d.leg),
          overnight_place_id: d.overnight ? placeId.get(d.overnight) : null,
          notes: d.notes ?? null,
        })),
      )
      .select("id, date"),
    "insert days",
  );
  const dayId = new Map(days.map((d) => [d.date, d.id]));

  must(
    await db.from("stops").insert(
      seed.days.flatMap((d) =>
        d.stops.map((s, i) => ({
          day_id: dayId.get(d.date),
          place_id: placeId.get(s.place),
          position: i,
          tags: s.tags ?? [],
          notes: s.notes ?? null,
        })),
      ),
    ),
    "insert stops",
  );

  must(
    await db.from("checklist_items").insert(
      seed.checklist.map((c, i) => ({ trip_id: trip.id, title: c.title, category: c.category, position: i })),
    ),
    "insert checklist",
  );

  const stopCount = seed.days.reduce((n, d) => n + d.stops.length, 0);
  console.log(
    `Seeded "${seed.trip.name}" for ${ownerEmail}: ${days.length} days, ${stopCount} stops, ` +
      `${places.length} places (${seed.tray.length} in tray), ${seed.checklist.length} checklist items.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
