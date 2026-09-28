import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { autocomplete } from "@/lib/google/places";
import { tripBounds } from "@/lib/trip/bounds";

const query = z.object({
  q: z.string().trim().min(2).max(120),
  session: z.string().uuid(),
  trip: z.string().uuid(),
});

// Place suggestions while typing a stop name. Signed-in trip owners only (billed API).
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ suggestions: [] });

  const [trip] = await getDb()
    .select({ id: t.trips.id })
    .from(t.trips)
    .where(and(eq(t.trips.id, parsed.data.trip), eq(t.trips.ownerId, user.id)));
  if (!trip) return Response.json({ error: "Trip not found" }, { status: 404 });

  try {
    const bias = await tripBounds(trip.id);
    return Response.json({ suggestions: await autocomplete(parsed.data.q, parsed.data.session, bias) });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Place search unavailable" }, { status: 502 });
  }
}
