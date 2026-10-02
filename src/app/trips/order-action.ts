"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { trips } from "@/db/schema";
import { currentUser } from "@/lib/auth";

/** Saves the home page order of the user's trips (the ids in their new order). */
export async function reorderTrips(tripIds: string[]) {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  const ids = z.array(z.string().uuid()).max(500).parse(tripIds);
  if (!ids.length) return;
  const db = getDb();
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(inArray(trips.id, ids), eq(trips.ownerId, user.id)));
    const mine = new Set(owned.map((r) => r.id));
    let position = 0;
    for (const id of ids) {
      if (!mine.has(id)) continue;
      await tx.update(trips).set({ sortOrder: position++ }).where(eq(trips.id, id));
    }
  });
}
