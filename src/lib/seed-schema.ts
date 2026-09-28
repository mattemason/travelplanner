import { z } from "zod";

export const STOP_TAGS = ["4wd", "walk", "camp", "permit", "book_ahead", "weather"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const place = z.object({
  key: z.string(),
  name: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  businessStatus: z.enum(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]).optional(),
  manual: z.boolean().optional(),
  notes: z.string().optional(),
});

const stop = z.object({
  place: z.string(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  tags: z.array(z.enum(STOP_TAGS)).optional(),
  notes: z.string().optional(),
});

export const seedSchema = z.object({
  meta: z.object({ seedKey: z.string(), version: z.number().int().positive(), notes: z.string() }),
  trip: z.object({
    name: z.string(),
    startDate: isoDate,
    endDate: isoDate,
    startPoint: z.string(),
    endPoint: z.string(),
    maxDriveHoursPerDay: z.number().positive(),
  }),
  legs: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      startDate: isoDate,
      endDate: isoDate,
      travellers: z.array(z.string()),
      colour: z.string().regex(/^#[0-9a-f]{6}$/i),
    }),
  ),
  fixedEvents: z.array(
    z.object({
      type: z.string(),
      date: isoDate,
      time: z.string().nullable(),
      location: z.string(),
      notes: z.string(),
    }),
  ),
  places: z.array(place),
  days: z.array(
    z.object({
      date: isoDate,
      leg: z.string(),
      overnight: z.string().nullable(),
      notes: z.string().optional(),
      stops: z.array(stop),
    }),
  ),
  tray: z.array(stop),
  checklist: z.array(z.object({ title: z.string(), category: z.string() })),
});

export type Seed = z.infer<typeof seedSchema>;

/** Parses the seed and checks that every reference points at something real. */
export function parseSeed(raw: unknown): Seed {
  const seed = seedSchema.parse(raw);
  const placeKeys = new Set(seed.places.map((p) => p.key));
  const legKeys = new Set(seed.legs.map((l) => l.key));
  const problems: string[] = [];

  const checkPlace = (key: string | null, where: string) => {
    if (key !== null && !placeKeys.has(key)) problems.push(`${where}: unknown place "${key}"`);
  };

  if (placeKeys.size !== seed.places.length) problems.push("duplicate place keys");
  checkPlace(seed.trip.startPoint, "trip.startPoint");
  checkPlace(seed.trip.endPoint, "trip.endPoint");
  seed.fixedEvents.forEach((e) => checkPlace(e.location, `fixedEvent ${e.type}`));
  seed.tray.forEach((s) => checkPlace(s.place, "tray"));
  for (const day of seed.days) {
    if (!legKeys.has(day.leg)) problems.push(`${day.date}: unknown leg "${day.leg}"`);
    checkPlace(day.overnight, `${day.date} overnight`);
    day.stops.forEach((s) => checkPlace(s.place, `${day.date} stop`));
  }

  if (problems.length) throw new Error(`Invalid seed:\n${problems.join("\n")}`);
  return seed;
}
