import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { getProfile } from "@/lib/profile";
import { dayLabel, timeLabel } from "@/lib/trip/format";
import { tagLabel } from "@/lib/trip/types";

// Stable instructions: kept separate from the per-stop context so they read the same every call.
const INSTRUCTIONS = `You are a well-travelled local guide helping someone plan a road trip. They're asking about one stop on their itinerary, often on a phone, so keep every answer short.

Answer only what they asked. Aim for under 150 words: one or two plain sentences that answer the question, then at most five short bullet points if a list helps. Use **bold** for the key word at the start of a bullet. No headings, no preamble, no closing summary, no offers of further help.

Search the web only when the question needs current or specific facts, such as closures, track or road conditions, opening hours, fees, or booking rules. Search first and don't narrate it; the reader only sees your text. When something changes often, say to confirm it closer to the date. If you can't verify something, say so briefly rather than guessing.

Use the trip context below (dates, leg, vehicle, notes) when it changes the answer, for example flagging 4WD-only access or a closure on their dates. Write in plain Australian English.`;

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
