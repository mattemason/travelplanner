"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getLabels, type LabelKind, type Labels } from "@/lib/labels";
import { TAGS } from "@/lib/trip/types";

// The user's own stop tags and categories. Renaming or deleting one updates every stop of
// theirs that uses it. Built-in tags (4WD, Weather...) can't be added, renamed or deleted.

const kind = z.enum(["tag", "category"]);
const name = z.string().trim().min(1, "Give it a name").max(40, "Keep it under 40 characters");

async function userId() {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

const isBuiltinTag = (n: string) =>
  TAGS.some((tag) => tag.key.toLowerCase() === n.toLowerCase() || tag.label.toLowerCase() === n.toLowerCase());

type Result = { ok: true; labels: Labels } | { ok: false; error: string };

export async function addLabel(k: LabelKind, n: string): Promise<Result> {
  const uid = await userId();
  const parsedKind = kind.parse(k);
  const parsed = name.safeParse(n);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (parsedKind === "tag" && isBuiltinTag(parsed.data)) return { ok: false, error: "That's already a built-in tag." };
  const db = getDb();
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${t.labels.position}), -1)` })
    .from(t.labels)
    .where(and(eq(t.labels.userId, uid), eq(t.labels.kind, parsedKind)));
  await db
    .insert(t.labels)
    .values({ userId: uid, kind: parsedKind, name: parsed.data, position: Number(max) + 1 })
    .onConflictDoNothing();
  return { ok: true, labels: await getLabels(uid) };
}

export async function renameLabel(k: LabelKind, from: string, to: string): Promise<Result> {
  const uid = await userId();
  const parsedKind = kind.parse(k);
  const parsed = name.safeParse(to);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const next = parsed.data;
  if (next === from) return { ok: true, labels: await getLabels(uid) };
  if (parsedKind === "tag" && isBuiltinTag(next)) return { ok: false, error: "That's already a built-in tag." };

  const db = getDb();
  const existing = await db
    .select({ id: t.labels.id })
    .from(t.labels)
    .where(and(eq(t.labels.userId, uid), eq(t.labels.kind, parsedKind), eq(t.labels.name, next)));
  if (existing.length) return { ok: false, error: `There's already one called ${next}.` };

  await db.transaction(async (tx) => {
    await tx
      .update(t.labels)
      .set({ name: next })
      .where(and(eq(t.labels.userId, uid), eq(t.labels.kind, parsedKind), eq(t.labels.name, from)));
    const column = parsedKind === "tag" ? t.stops.tags : t.stops.categories;
    await tx
      .update(t.stops)
      .set(parsedKind === "tag" ? { tags: sql`array_replace(${column}, ${from}, ${next})` } : { categories: sql`array_replace(${column}, ${from}, ${next})` })
      .where(and(inArray(t.stops.tripId, ownedTripIds(uid)), sql`${from} = any(${column})`));
  });
  return { ok: true, labels: await getLabels(uid) };
}

export async function deleteLabel(k: LabelKind, n: string): Promise<Result> {
  const uid = await userId();
  const parsedKind = kind.parse(k);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(t.labels)
      .where(and(eq(t.labels.userId, uid), eq(t.labels.kind, parsedKind), eq(t.labels.name, n)));
    const column = parsedKind === "tag" ? t.stops.tags : t.stops.categories;
    await tx
      .update(t.stops)
      .set(parsedKind === "tag" ? { tags: sql`array_remove(${column}, ${n})` } : { categories: sql`array_remove(${column}, ${n})` })
      .where(and(inArray(t.stops.tripId, ownedTripIds(uid)), sql`${n} = any(${column})`));
  });
  return { ok: true, labels: await getLabels(uid) };
}

const ownedTripIds = (uid: string) => getDb().select({ id: t.trips.id }).from(t.trips).where(eq(t.trips.ownerId, uid));
