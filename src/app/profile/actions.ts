"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";

const profile = z.object({
  name: z.string().trim().max(80),
  about: z.string().trim().max(2000),
  vehicle: z.string().trim().max(120),
  lPer100km: z.number().min(1, "Fuel use looks too low").max(60, "Fuel use looks too high").nullable(),
  fuelType: z.enum(["diesel", "petrol"]).nullable(),
});

export async function saveProfile(input: z.infer<typeof profile>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  const parsed = profile.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  await getDb()
    .update(t.users)
    .set({
      name: v.name || null,
      about: v.about || null,
      vehicle: v.vehicle || null,
      fuelLPer100km: v.lPer100km,
      fuelType: v.fuelType,
    })
    .where(eq(t.users.id, user.id));
  return { ok: true };
}
