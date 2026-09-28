import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { getProfile } from "@/lib/profile";
import { dayLabel, timeLabel } from "@/lib/trip/format";
import { tagLabel } from "@/lib/trip/types";

// Stable instructions: kept separate from the per-stop context so they read the same every call.
const INSTRUCTIONS = `You are a well-travelled local guide helping someone plan a road trip. They've asked about one stop on their itinerary.

For the first answer, give a practical briefing they can read in a minute or two:
- What the place is and why it's worth the stop, in two or three sentences.
- The main things to do or see there, and how long to allow.
- Practical details: access and road conditions (say plainly if it needs a 4WD or is unsealed), permits, passes or bookings, fees, facilities (toilets, water, fuel, phone signal), and seasonal or weather considerations for their travel dates.
- Anything that suits how they travel, based on their profile and the trip details.

Use web search to check current information that changes, such as closures, track conditions, opening hours, fees and booking rules, and say when something should be confirmed closer to the date. If you can't verify something, say so rather than guessing.

Do your searching first and don't narrate it: the reader only sees your text, so start straight in with the briefing itself rather than saying what you're about to check.

Write in plain Australian English. Use short headings and bullet points, and keep it tight. For follow-up questions, answer the question directly without repeating the briefing.`;

export type StopContext = { stopName: string; system: string };

/** Everything Claude should know about a stop, if `userId` owns it. */
export async function stopContext(userId: string, stopId: string): Promise<StopContext | null> {
  const db = getDb();
  const [row] = await db
    .select({ stop: t.stops, place: t.places, trip: t.trips, day: t.days, leg: t.legs })
    .from(t.stops)
    .innerJoin(t.trips, eq(t.trips.id, t.stops.tripId))
    .innerJoin(t.places, eq(t.places.id, t.stops.placeId))
    .leftJoin(t.days, eq(t.days.id, t.stops.dayId))
    .leftJoin(t.legs, eq(t.legs.id, t.days.legId))
    .where(and(eq(t.stops.id, stopId), eq(t.trips.ownerId, userId)));
  if (!row) return null;

  const profile = await getProfile(userId);
  const { stop, place, trip, day, leg } = row;
  const stopName = stop.label ?? place.name;

  let overnight: string | null = null;
  if (day?.overnightPlaceId) {
    const [night] = await db.select({ name: t.places.name }).from(t.places).where(eq(t.places.id, day.overnightPlaceId));
    overnight = night?.name ?? null;
  }

  const lines = [
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `Trip: ${trip.name}, ${trip.startDate} to ${trip.endDate}`,
    day ? `This stop is on ${dayLabel(day.date)} (${day.date})${leg ? `, during the "${leg.name}" leg` : ""}.` : `This stop isn't scheduled on a day yet.`,
    leg?.travellers?.length ? `Travellers on this leg: ${leg.travellers.join(", ")}` : null,
    overnight ? `Overnight that day: ${overnight}` : null,
    ``,
    `Stop: ${stopName}${stopName !== place.name ? ` (Google Maps place: ${place.name})` : ""}`,
    place.address ? `Address: ${place.address}` : null,
    place.lat !== null && place.lng !== null ? `Coordinates: ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}` : `No map location saved.`,
    place.businessStatus && place.businessStatus !== "OPERATIONAL" ? `Google lists it as: ${place.businessStatus}` : null,
    stop.plannedTime ? `Planned arrival: ${timeLabel(stop.plannedTime.slice(0, 5))}` : null,
    stop.arriveBy !== "drive" ? `They get here by ${stop.arriveBy}, not by road.` : null,
    stop.categories.length ? `Categories: ${stop.categories.join(", ")}` : null,
    stop.tags.length ? `Tags: ${stop.tags.map(tagLabel).join(", ")}` : null,
    stop.notes ? `Their notes: ${stop.notes}` : null,
    stop.bookingRef ? `They have a booking (ref ${stop.bookingRef}).` : null,
    ``,
    profile?.about ? `About the traveller: ${profile.about}` : null,
    profile?.vehicle ? `Vehicle: ${profile.vehicle}${profile.fuelType ? ` (${profile.fuelType})` : ""}` : null,
  ].filter((l): l is string => l !== null);

  return { stopName, system: `${INSTRUCTIONS}\n\n<trip_context>\n${lines.join("\n")}\n</trip_context>` };
}
