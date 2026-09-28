"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const newTrip = z
  .object({
    name: z.string().trim().min(1, "Give the trip a name").max(120),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.endDate >= v.startDate, "The trip ends before it starts.")
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 <= 180, "Trips can be up to 180 days long.");

export type NewTripState = { error: string | null; values?: { name: string; startDate: string; endDate: string } };

/** Creates an empty trip with one day per date, then opens it. */
export async function createTrip(_prev: NewTripState, form: FormData): Promise<NewTripState> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const values = {
    name: String(form.get("name") ?? ""),
    startDate: String(form.get("startDate") ?? ""),
    endDate: String(form.get("endDate") ?? ""),
  };
  const parsed = newTrip.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details.", values };
  const v = parsed.data;

  const tripId = await getDb().transaction(async (tx) => {
    const [trip] = await tx
      .insert(t.trips)
      .values({ ownerId: user.id, name: v.name, startDate: v.startDate, endDate: v.endDate })
      .returning({ id: t.trips.id });
    const dates: string[] = [];
    for (const d = new Date(`${v.startDate}T00:00:00Z`); d <= new Date(`${v.endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    await tx.insert(t.days).values(dates.map((date) => ({ tripId: trip.id, date })));
    return trip.id;
  });

  redirect(`/trips/${tripId}`);
}
