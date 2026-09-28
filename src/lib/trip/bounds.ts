import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import type { Bounds } from "@/lib/google/places";

/** A rectangle around the trip's mapped places, padded, for biasing place search. */
export async function tripBounds(tripId: string): Promise<Bounds | null> {
  const [row] = await getDb()
    .select({
      minLat: sql<number>`min(${t.places.lat})`,
      maxLat: sql<number>`max(${t.places.lat})`,
      minLng: sql<number>`min(${t.places.lng})`,
      maxLng: sql<number>`max(${t.places.lng})`,
    })
    .from(t.stops)
    .innerJoin(t.places, eq(t.places.id, t.stops.placeId))
    .where(eq(t.stops.tripId, tripId));
  if (row?.minLat == null) return null;
  const pad = 0.3;
  return {
    low: { lat: Number(row.minLat) - pad, lng: Number(row.minLng) - pad },
    high: { lat: Number(row.maxLat) + pad, lng: Number(row.maxLng) + pad },
  };
}
