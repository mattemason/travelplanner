import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { searchInArea } from "@/lib/google/places";

const corner = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const body = z.object({
  trip: z.string().uuid(),
  q: z.string().trim().min(2).max(120),
  area: z.object({ low: corner, high: corner }),
  type: z
    .string()
    .regex(/^[a-z_]{3,40}$/)
    .optional(), // a Places type for the shortcuts, e.g. "campground"
});

// Search the visible map area (campgrounds, fuel, cafes...). Signed-in trip owners only.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });

  const [trip] = await getDb()
    .select({ id: t.trips.id })
    .from(t.trips)
    .where(and(eq(t.trips.id, parsed.data.trip), eq(t.trips.ownerId, user.id)));
  if (!trip) return Response.json({ error: "Trip not found" }, { status: 404 });

  try {
    return Response.json({ results: await searchInArea(parsed.data.q, parsed.data.area, parsed.data.type) });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Search unavailable" }, { status: 502 });
  }
}
