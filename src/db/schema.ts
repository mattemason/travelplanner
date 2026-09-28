/**
 * Database schema (Railway Postgres, Drizzle ORM). See SPEC.md "Data model".
 * After changing it, run `npm run db:generate` and commit the new migration in drizzle/.
 *
 * Deviations from the spec table, all additive:
 *   - stops.order is stops.position ("order" is a reserved word).
 *   - trips.seed_version records which seed file version created the trip.
 *   - route_segments also stores the encoded route polyline for drawing on the map.
 *   - place_list_items joins places to lists (a place can sit in several Google lists);
 *     places.source_list keeps the list it first came from.
 *   - route_segments caches Routes API results.
 *   - place_lists.source also allows 'manual' for seeded and hand-entered lists.
 *   - fixed_events stores a date plus optional local time, since most times aren't known yet.
 *
 * There is no row-level security: the browser never talks to the database. Every query
 * runs on the server and must be scoped to the signed-in user.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  homeRegion: text("home_region"),
  about: text("about"),
  vehicle: text("vehicle"),
  fuelLPer100km: numeric("fuel_l_per_100km", { precision: 5, scale: 2, mode: "number" }),
  fuelType: text("fuel_type"), // diesel | petrol
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  createdAt: createdAt(),
});

// One-time sign-in link tokens (Auth.js stores a hash, not the raw token).
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const trips = pgTable(
  "trips",
  {
    id: id(),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    startPoint: text("start_point"),
    endPoint: text("end_point"),
    maxDriveHoursPerDay: numeric("max_drive_hours_per_day", { precision: 4, scale: 2, mode: "number" })
      .notNull()
      .default(5),
    seedVersion: integer("seed_version"),
    dieselPrice: numeric("diesel_price", { precision: 6, scale: 3, mode: "number" }), // $ per litre
    petrolPrice: numeric("petrol_price", { precision: 6, scale: 3, mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [check("trips_dates", sql`${t.endDate} >= ${t.startDate}`)],
);

export const legs = pgTable("legs", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  travellers: text("travellers").array().notNull().default(sql`'{}'`),
  colour: text("colour").notNull(),
});

export const fixedEvents = pgTable("fixed_events", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  date: date("date").notNull(),
  time: time("time"),
  location: text("location"),
  notes: text("notes"),
});

export const places = pgTable(
  "places",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    googlePlaceId: text("google_place_id"),
    name: text("name").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    address: text("address"),
    businessStatus: text("business_status"),
    photoRef: text("photo_ref"),
    hoursJson: jsonb("hours_json"),
    sourceList: text("source_list"),
    mapsUrl: text("maps_url"),
    notes: text("notes"),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("places_user_google_place")
      .on(t.userId, t.googlePlaceId)
      .where(sql`${t.googlePlaceId} is not null`),
  ],
);

export const placeLists = pgTable(
  "place_lists",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
  },
  (t) => [check("place_lists_source", sql`${t.source} in ('takeout', 'share_link', 'csv', 'manual')`)],
);

export const placeListItems = pgTable(
  "place_list_items",
  {
    listId: uuid("list_id").notNull().references(() => placeLists.id, { onDelete: "cascade" }),
    placeId: uuid("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.listId, t.placeId] })],
);

export const days = pgTable(
  "days",
  {
    id: id(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    legId: uuid("leg_id").references(() => legs.id, { onDelete: "set null" }),
    overnightPlaceId: uuid("overnight_place_id").references(() => places.id, { onDelete: "set null" }),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("days_trip_date").on(t.tripId, t.date)],
);

// A stop with no day sits in the trip's "Not yet scheduled" tray and keeps its details.
// label overrides the place name for this stop only (the editor's Name field).
export const stops = pgTable(
  "stops",
  {
    id: id(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    dayId: uuid("day_id").references(() => days.id, { onDelete: "set null" }),
    placeId: uuid("place_id").notNull().references(() => places.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    label: text("label"),
    plannedTime: time("planned_time"),
    durationMins: integer("duration_mins"),
    // Built-in tag keys (4wd, walk, camp, permit, book_ahead, weather) or the user's own tag names.
    tags: text("tags").array().notNull().default(sql`'{}'`),
    categories: text("categories").array().notNull().default(sql`'{}'`), // names from labels
    notes: text("notes"),
    bookingRef: text("booking_ref"),
    link: text("link"),
    // How you get to this stop from the previous one. Only "drive" counts toward driving time.
    arriveBy: text("arrive_by").notNull().default("drive"),
    status: text("status").notNull().default("planned"),
  },
  (t) => [
    index("stops_trip_day_position").on(t.tripId, t.dayId, t.position),
    check("stops_status", sql`${t.status} in ('planned', 'done', 'skipped')`),
    check("stops_arrive_by", sql`${t.arriveBy} in ('drive', 'ferry', 'flight', 'walk')`),
  ],
);

// The user's own stop tags and stop categories (built-in tags aren't stored here).
export const labels = pgTable(
  "labels",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("labels_user_kind_name").on(t.userId, t.kind, t.name),
    check("labels_kind", sql`${t.kind} in ('tag', 'category')`),
  ],
);

// A checklist belongs to a user, optionally to one trip, and carries free-form tags.
export const checklists = pgTable(
  "checklists",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [index("checklists_user").on(t.userId)],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: id(),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category"),
    dueDate: date("due_date"),
    status: text("status").notNull().default("todo"),
    url: text("url"),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
  },
  (t) => [check("checklist_status", sql`${t.status} in ('todo', 'in_progress', 'done')`)],
);

export const syncRuns = pgTable("sync_runs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  diffJson: jsonb("diff_json"),
  applied: boolean("applied").notNull().default(false),
});

export const planProposals = pgTable(
  "plan_proposals",
  {
    id: id(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    promptJson: jsonb("prompt_json").notNull(),
    proposalJson: jsonb("proposal_json"),
    status: text("status").notNull().default("pending"),
  },
  (t) => [check("plan_proposals_status", sql`${t.status} in ('pending', 'accepted', 'rejected')`)],
);

export const shares = pgTable("shares", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  legFilter: uuid("leg_filter").references(() => legs.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const routeSegments = pgTable(
  "route_segments",
  {
    origin: text("origin").notNull(), // "lat,lng" rounded to 5 dp
    destination: text("destination").notNull(),
    durationS: integer("duration_s").notNull(),
    distanceM: integer("distance_m").notNull(),
    polyline: text("polyline"), // Google encoded polyline
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.origin, t.destination] })],
);

// The AI conversation about a stop (text only: [{ role, content }]); the first user turn is
// the automatic "tell me about this stop" request.
export const stopChats = pgTable("stop_chats", {
  stopId: uuid("stop_id")
    .primaryKey()
    .references(() => stops.id, { onDelete: "cascade" }),
  messages: jsonb("messages").$type<{ role: "user" | "assistant"; content: string }[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
