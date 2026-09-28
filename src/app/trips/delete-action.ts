"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { trips } from "@/db/schema";
import { currentUser } from "@/lib/auth";

/**
 * Deletes a trip the user owns. Days, stops (and their files), legs and plans go with it;
 * checklists are kept, unlinked from the trip.
 */
export async function deleteTrip(tripId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  const deleted = await getDb()
    .delete(trips)
    .where(and(eq(trips.id, z.string().uuid().parse(tripId)), eq(trips.ownerId, user.id)))
    .returning({ id: trips.id });
  if (!deleted.length) throw new Error("Trip not found");
}
