"use server";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { loadTrip } from "@/lib/trip/load";
import type { CheckedPlan } from "@/lib/trip/plan";
import { TRAY } from "@/lib/trip/types";

// Accept or reject a saved plan proposal. Accepting applies the checked layout and overnights;
// rejecting changes nothing in the trip.

async function ownedProposal(tripId: string, proposalId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  const [row] = await getDb()
    .select({ id: t.planProposals.id, status: t.planProposals.status, plan: t.planProposals.proposalJson })
    .from(t.planProposals)
    .innerJoin(t.trips, eq(t.trips.id, t.planProposals.tripId))
    .where(
      and(
        eq(t.planProposals.id, z.string().uuid().parse(proposalId)),
        eq(t.planProposals.tripId, z.string().uuid().parse(tripId)),
        eq(t.trips.ownerId, user.id),
      ),
    );
  if (!row) throw new Error("Plan not found");
  return { userId: user.id, row };
}

export async function acceptPlan(tripId: string, proposalId: string) {
  const { userId, row } = await ownedProposal(tripId, proposalId);
  if (row.status !== "pending") return { ok: false as const, error: "This plan was already used or rejected." };
  const plan = row.plan as CheckedPlan;
  const db = getDb();

  await db.transaction(async (tx) => {
    const days = await tx.select({ id: t.days.id }).from(t.days).where(eq(t.days.tripId, tripId));
    const dayIds = new Set(days.map((d) => d.id));
    const stops = await tx.select({ id: t.stops.id, placeId: t.stops.placeId }).from(t.stops).where(eq(t.stops.tripId, tripId));
    const placeOf = new Map(stops.map((s) => [s.id, s.placeId]));

    // Stops deleted since the plan was made are skipped; stops added since stay where they are.
    for (const [container, ids] of Object.entries(plan.layout)) {
      if (container !== TRAY && !dayIds.has(container)) continue;
      let position = 0;
      for (const stopId of ids) {
        if (!placeOf.has(stopId)) continue;
        await tx
          .update(t.stops)
          .set({ dayId: container === TRAY ? null : container, position: position++ })
          .where(and(eq(t.stops.id, stopId), eq(t.stops.tripId, tripId)));
      }
    }
    for (const [dayId, stopId] of Object.entries(plan.overnights)) {
      if (!dayIds.has(dayId)) continue;
      const placeId = stopId ? (placeOf.get(stopId) ?? null) : null;
      const [day] = await tx.select({ overnight: t.days.overnightPlaceId }).from(t.days).where(eq(t.days.id, dayId));
      if (day?.overnight === placeId) continue; // unchanged: keep its stay details
      await tx.update(t.days).set({ overnightPlaceId: placeId, stay: null }).where(eq(t.days.id, dayId));
    }
    await tx.update(t.planProposals).set({ status: "accepted" }).where(eq(t.planProposals.id, row.id));
    // Other pending proposals for this trip are now out of date.
    await tx
      .update(t.planProposals)
      .set({ status: "rejected" })
      .where(and(eq(t.planProposals.tripId, tripId), eq(t.planProposals.status, "pending"), ne(t.planProposals.id, row.id)));
  });

  const trip = await loadTrip(userId, tripId);
  if (!trip) throw new Error("Trip not found");
  return { ok: true as const, trip };
}

export async function rejectPlan(tripId: string, proposalId: string) {
  const { row } = await ownedProposal(tripId, proposalId);
  if (row.status === "pending") {
    await getDb().update(t.planProposals).set({ status: "rejected" }).where(eq(t.planProposals.id, row.id));
  }
}
