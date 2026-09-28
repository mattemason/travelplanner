import { z } from "zod";
import { overnightOf } from "./drive";
import { tagLabel, TRAY, type Layout, type TripData } from "./types";

// Plan builder: turns the trip into a compact request for Claude, and checks what comes back.
// Claude only ever rearranges stops that already exist (by short alias); it can't add places.

/** What Claude must return (enforced with structured outputs). */
export const planSchema = z.object({
  summary: z.string().describe("Two or three sentences on the shape of the plan and any trade-offs."),
  days: z
    .array(
      z.object({
        date: z.string().describe("YYYY-MM-DD, one entry per trip day"),
        stop_ids: z.array(z.string()).describe("Stop aliases in visiting order"),
        overnight_stop_id: z.string().nullable().describe("Alias of the stop where they sleep, from this day's stops"),
        note: z.string().describe("One short line on the day, or empty"),
      }),
    )
    .describe("Every trip day, in date order"),
  unscheduled: z
    .array(z.object({ stop_id: z.string(), reason: z.string().describe("One line on why it was left out") }))
    .describe("Stops deliberately left out of the plan"),
  warnings: z.array(z.string()).describe("Anything the traveller should check"),
});
export type PlanOutput = z.infer<typeof planSchema>;

export type PlanRequest = {
  aliases: Record<string, string>; // alias → stop id
  context: unknown; // what's sent to Claude
};

const round = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

/** The trip as Claude sees it. Locked days are included so it can plan around them. */
export function buildPlanRequest(
  trip: TripData,
  locked: Set<string>,
  opts: { preferences: string; vehicle: string | null },
): PlanRequest {
  const aliases: Record<string, string> = {};
  const aliasOf = new Map<string, string>();
  Object.keys(trip.stops).forEach((id, i) => {
    const a = `s${i + 1}`;
    aliases[a] = id;
    aliasOf.set(id, a);
  });

  const legName = (legId: string | null) => trip.legs.find((l) => l.id === legId)?.name ?? null;
  const stops = Object.values(trip.stops).map((s) => {
    const place = trip.places[s.placeId];
    return {
      id: aliasOf.get(s.id),
      name: s.name,
      lat: round(place?.lat ?? null),
      lng: round(place?.lng ?? null),
      tags: s.tags.map(tagLabel),
      categories: s.categories,
      arrive_by: s.arriveBy,
      planned_time: s.time,
      closed: place?.businessStatus?.startsWith("CLOSED") ? place.businessStatus : undefined,
      notes: s.notes ? s.notes.slice(0, 240) : undefined,
    };
  });

  const days = trip.days.map((d, i) => {
    const night = overnightOf(trip, i);
    const nightStop = (trip.layout[d.id] ?? []).find((id) => trip.stops[id]?.placeId === night);
    return {
      date: d.date,
      leg: legName(d.legId),
      locked: locked.has(d.id),
      stop_ids: (trip.layout[d.id] ?? []).map((id) => aliasOf.get(id)),
      overnight_stop_id: nightStop ? aliasOf.get(nightStop) : null,
      note: d.notes || undefined,
    };
  });

  return {
    aliases,
    context: {
      trip: {
        name: trip.name,
        start: trip.startDate,
        end: trip.endDate,
        max_drive_hours_per_day: trip.maxDriveHours,
        vehicle: opts.vehicle,
      },
      legs: trip.legs.map((l) => ({ name: l.name, start: l.startDate, end: l.endDate })),
      days,
      not_yet_scheduled: (trip.layout[TRAY] ?? []).map((id) => aliasOf.get(id)),
      stops,
      preferences: opts.preferences.trim() || undefined,
    },
  };
}

export type CheckedPlan = {
  layout: Layout; // day id (and TRAY) → stop ids
  overnights: Record<string, string | null>; // day id → overnight stop id
  notes: Record<string, string>; // day id → Claude's note
  leftOut: { stopId: string; reason: string }[];
  summary: string;
  warnings: string[];
  problems: string[]; // what the server had to correct
};

/**
 * Checks Claude's plan against the rules: known stops only, each used once, locked days exactly
 * as they were, overnights from the day's own stops. Anything it forgot goes back where it was.
 */
export function checkPlan(trip: TripData, locked: Set<string>, req: PlanRequest, out: PlanOutput): CheckedPlan {
  const problems: string[] = [];
  const used = new Set<string>();
  const layout: Layout = { [TRAY]: [] };
  const overnights: Record<string, string | null> = {};
  const notes: Record<string, string> = {};
  const byDate = new Map(out.days.map((d) => [d.date, d]));
  const resolve = (alias: string) => req.aliases[alias] ?? null;

  // Locked days first, exactly as they are.
  for (const [i, day] of trip.days.entries()) {
    if (!locked.has(day.id)) continue;
    layout[day.id] = [...(trip.layout[day.id] ?? [])];
    layout[day.id].forEach((id) => used.add(id));
    const night = overnightOf(trip, i);
    overnights[day.id] = layout[day.id].find((id) => trip.stops[id]?.placeId === night) ?? null;
    const proposed = byDate.get(day.date);
    if (proposed && proposed.stop_ids.join() !== layout[day.id].map((id) => Object.keys(req.aliases).find((a) => req.aliases[a] === id)).join()) {
      problems.push(`Kept ${day.date} as it was (it's locked).`);
    }
  }

  for (const day of trip.days) {
    if (locked.has(day.id)) continue;
    const proposed = byDate.get(day.date);
    const ids: string[] = [];
    for (const alias of proposed?.stop_ids ?? []) {
      const id = resolve(alias);
      if (!id) {
        problems.push(`Ignored an unknown stop "${alias}".`);
        continue;
      }
      if (used.has(id)) {
        problems.push(`${trip.stops[id].name} was used twice; kept the first.`);
        continue;
      }
      used.add(id);
      ids.push(id);
    }
    layout[day.id] = ids;
    const night = proposed?.overnight_stop_id ? resolve(proposed.overnight_stop_id) : null;
    overnights[day.id] = night && ids.includes(night) ? night : null;
    if (proposed?.note?.trim()) notes[day.id] = proposed.note.trim();
  }

  const leftOut: CheckedPlan["leftOut"] = [];
  for (const u of out.unscheduled) {
    const id = resolve(u.stop_id);
    if (!id || used.has(id)) continue;
    used.add(id);
    layout[TRAY].push(id);
    leftOut.push({ stopId: id, reason: u.reason });
  }

  // Anything Claude forgot stays where it was (or in the tray if its day was replanned).
  for (const id of Object.keys(trip.stops)) {
    if (used.has(id)) continue;
    problems.push(`${trip.stops[id].name} was missing from the plan; left in Not yet scheduled.`);
    layout[TRAY].push(id);
    leftOut.push({ stopId: id, reason: "Not placed by the plan." });
  }

  return { layout, overnights, notes, leftOut, summary: out.summary, warnings: out.warnings, problems };
}

/** The trip with a checked plan applied (for drive-time checks and previews). */
export function applyPlanTo(trip: TripData, plan: CheckedPlan): TripData {
  return {
    ...trip,
    layout: plan.layout,
    days: trip.days.map((d) => {
      const nightStop = plan.overnights[d.id];
      return { ...d, overnightPlaceId: nightStop ? (trip.stops[nightStop]?.placeId ?? null) : null };
    }),
  };
}
