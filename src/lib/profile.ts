import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import type { FuelType, Vehicle } from "@/lib/trip/fuel";

export type Profile = {
  name: string;
  email: string;
  about: string;
  vehicle: string;
  lPer100km: number | null;
  fuelType: FuelType | null;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const [u] = await getDb().select().from(t.users).where(eq(t.users.id, userId));
  if (!u) return null;
  return {
    name: u.name ?? "",
    email: u.email,
    about: u.about ?? "",
    vehicle: u.vehicle ?? "",
    lPer100km: u.fuelLPer100km,
    fuelType: u.fuelType === "diesel" || u.fuelType === "petrol" ? u.fuelType : null,
  };
}

export const vehicleOf = (p: Profile | null): Vehicle => ({
  lPer100km: p?.lPer100km ?? null,
  fuelType: p?.fuelType ?? null,
});
