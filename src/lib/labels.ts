import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";

export type LabelKind = "tag" | "category";
export type Labels = { tags: string[]; categories: string[] };

export const DEFAULT_CATEGORIES = [
  "Accommodation",
  "Campsite",
  "Tour",
  "Activity",
  "Flight",
  "Ferry",
  "Car hire",
  "Restaurant",
  "Café",
  "Fuel",
  "Supplies",
  "Hike",
  "Lookout",
  "Beach",
  "Waterfall",
  "Attraction",
];

/** The user's own tags and their categories (seeded with defaults the first time). */
export async function getLabels(userId: string): Promise<Labels> {
  const db = getDb();
  let rows = await db
    .select({ kind: t.labels.kind, name: t.labels.name })
    .from(t.labels)
    .where(eq(t.labels.userId, userId))
    .orderBy(asc(t.labels.position), asc(t.labels.name));

  if (!rows.some((r) => r.kind === "category")) {
    await db
      .insert(t.labels)
      .values(DEFAULT_CATEGORIES.map((name, position) => ({ userId, kind: "category", name, position })))
      .onConflictDoNothing();
    rows = await db
      .select({ kind: t.labels.kind, name: t.labels.name })
      .from(t.labels)
      .where(and(eq(t.labels.userId, userId)))
      .orderBy(asc(t.labels.position), asc(t.labels.name));
  }

  return {
    tags: rows.filter((r) => r.kind === "tag").map((r) => r.name),
    categories: rows.filter((r) => r.kind === "category").map((r) => r.name),
  };
}
