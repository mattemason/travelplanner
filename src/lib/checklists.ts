import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";

export type ChecklistSummary = {
  id: string;
  name: string;
  tripId: string | null;
  tripName: string | null;
  tags: string[];
  total: number;
  done: number;
  nextDue: string | null;
};

export type ChecklistItemRow = {
  id: string;
  title: string;
  category: string | null;
  dueDate: string | null;
  done: boolean;
  notes: string;
};

export type ChecklistDetail = Omit<ChecklistSummary, "total" | "done" | "nextDue"> & { items: ChecklistItemRow[] };

/** Every checklist the user owns, newest first, with progress. */
export async function listChecklists(userId: string): Promise<ChecklistSummary[]> {
  const rows = await getDb()
    .select({
      id: t.checklists.id,
      name: t.checklists.name,
      tripId: t.checklists.tripId,
      tripName: t.trips.name,
      tags: t.checklists.tags,
      total: sql<number>`count(${t.checklistItems.id})::int`,
      done: sql<number>`count(${t.checklistItems.id}) filter (where ${t.checklistItems.status} = 'done')::int`,
      nextDue: sql<string | null>`min(${t.checklistItems.dueDate}) filter (where ${t.checklistItems.status} <> 'done')`,
    })
    .from(t.checklists)
    .leftJoin(t.trips, eq(t.trips.id, t.checklists.tripId))
    .leftJoin(t.checklistItems, eq(t.checklistItems.checklistId, t.checklists.id))
    .where(eq(t.checklists.userId, userId))
    .groupBy(t.checklists.id, t.trips.name)
    .orderBy(desc(t.checklists.createdAt));
  return rows.map((r) => ({ ...r, nextDue: r.nextDue ? String(r.nextDue).slice(0, 10) : null }));
}

export async function getChecklist(userId: string, id: string): Promise<ChecklistDetail | null> {
  const db = getDb();
  const [list] = await db
    .select({
      id: t.checklists.id,
      name: t.checklists.name,
      tripId: t.checklists.tripId,
      tripName: t.trips.name,
      tags: t.checklists.tags,
    })
    .from(t.checklists)
    .leftJoin(t.trips, eq(t.trips.id, t.checklists.tripId))
    .where(and(eq(t.checklists.id, id), eq(t.checklists.userId, userId)));
  if (!list) return null;
  const items = await db
    .select()
    .from(t.checklistItems)
    .where(eq(t.checklistItems.checklistId, id))
    .orderBy(asc(t.checklistItems.position), asc(t.checklistItems.title));
  return {
    ...list,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      category: i.category,
      dueDate: i.dueDate,
      done: i.status === "done",
      notes: i.notes ?? "",
    })),
  };
}
