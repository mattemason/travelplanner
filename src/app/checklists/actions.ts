"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";

// Every function re-checks that the checklist (and any trip it's linked to) belongs to the
// signed-in user; these are reachable by direct POST.

const uuid = z.string().uuid();
const tags = z.array(z.string().trim().min(1).max(40)).max(20);
const details = z.object({
  name: z.string().trim().min(1, "Give the checklist a name").max(120),
  tripId: uuid.nullable(),
  tags,
});
const itemFields = z.object({
  title: z.string().trim().min(1, "Give the item a name").max(300),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  category: z.string().trim().max(40).nullable(),
});

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

async function userId() {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

async function assertTrip(uid: string, tripId: string | null) {
  if (!tripId) return;
  const [trip] = await getDb()
    .select({ id: t.trips.id })
    .from(t.trips)
    .where(and(eq(t.trips.id, tripId), eq(t.trips.ownerId, uid)));
  if (!trip) throw new Error("Trip not found");
}

async function ownedChecklist(uid: string, checklistId: string) {
  const [list] = await getDb()
    .select({ id: t.checklists.id })
    .from(t.checklists)
    .where(and(eq(t.checklists.id, uuid.parse(checklistId)), eq(t.checklists.userId, uid)));
  if (!list) throw new Error("Checklist not found");
  return list.id;
}

async function ownedItem(uid: string, itemId: string) {
  const [item] = await getDb()
    .select({ id: t.checklistItems.id })
    .from(t.checklistItems)
    .innerJoin(t.checklists, eq(t.checklists.id, t.checklistItems.checklistId))
    .where(and(eq(t.checklistItems.id, uuid.parse(itemId)), eq(t.checklists.userId, uid)));
  if (!item) throw new Error("Item not found");
  return item.id;
}

const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

export async function createChecklist(input: z.infer<typeof details>): Promise<Result<string>> {
  const uid = await userId();
  const parsed = details.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  await assertTrip(uid, parsed.data.tripId);
  const [row] = await getDb()
    .insert(t.checklists)
    .values({ userId: uid, name: parsed.data.name, tripId: parsed.data.tripId, tags: dedupe(parsed.data.tags) })
    .returning({ id: t.checklists.id });
  return { ok: true, value: row.id };
}

export async function updateChecklist(checklistId: string, input: z.infer<typeof details>): Promise<Result> {
  const uid = await userId();
  const id = await ownedChecklist(uid, checklistId);
  const parsed = details.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  await assertTrip(uid, parsed.data.tripId);
  await getDb()
    .update(t.checklists)
    .set({ name: parsed.data.name, tripId: parsed.data.tripId, tags: dedupe(parsed.data.tags) })
    .where(eq(t.checklists.id, id));
  return { ok: true, value: null };
}

/** Deletes a checklist and all its items. */
export async function deleteChecklist(checklistId: string) {
  const uid = await userId();
  const id = await ownedChecklist(uid, checklistId);
  await getDb().delete(t.checklists).where(eq(t.checklists.id, id));
}

export async function addItem(checklistId: string, input: z.infer<typeof itemFields>): Promise<Result<string>> {
  const uid = await userId();
  const id = await ownedChecklist(uid, checklistId);
  const parsed = itemFields.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const db = getDb();
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${t.checklistItems.position}), -1)` })
    .from(t.checklistItems)
    .where(eq(t.checklistItems.checklistId, id));
  const [row] = await db
    .insert(t.checklistItems)
    .values({
      checklistId: id,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate,
      category: parsed.data.category || null,
      position: Number(max) + 1,
    })
    .returning({ id: t.checklistItems.id });
  return { ok: true, value: row.id };
}

export async function updateItem(itemId: string, input: z.infer<typeof itemFields>): Promise<Result> {
  const uid = await userId();
  const id = await ownedItem(uid, itemId);
  const parsed = itemFields.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  await getDb()
    .update(t.checklistItems)
    .set({ title: parsed.data.title, dueDate: parsed.data.dueDate, category: parsed.data.category || null })
    .where(eq(t.checklistItems.id, id));
  return { ok: true, value: null };
}

export async function setItemDone(itemId: string, done: boolean) {
  const uid = await userId();
  const id = await ownedItem(uid, itemId);
  await getDb()
    .update(t.checklistItems)
    .set({ status: done ? "done" : "todo" })
    .where(eq(t.checklistItems.id, id));
}

export async function deleteItem(itemId: string) {
  const uid = await userId();
  const id = await ownedItem(uid, itemId);
  await getDb().delete(t.checklistItems).where(eq(t.checklistItems.id, id));
}
