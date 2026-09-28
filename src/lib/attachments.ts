import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as t from "@/db/schema";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_STOP = 20;

// Only these open in the browser; anything else downloads, so an uploaded HTML or SVG file
// can never run as a page on our domain.
const INLINE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"]);
export const servesInline = (type: string) => INLINE_TYPES.has(type);

/** The stop's id if `userId` owns its trip. */
export async function ownedStop(userId: string, stopId: string) {
  const [row] = await getDb()
    .select({ id: t.stops.id })
    .from(t.stops)
    .innerJoin(t.trips, eq(t.trips.id, t.stops.tripId))
    .where(and(eq(t.stops.id, stopId), eq(t.trips.ownerId, userId)));
  return row?.id ?? null;
}

/** The attachment's id if `userId` owns the trip it belongs to. */
export async function ownedAttachment(userId: string, attachmentId: string) {
  const [row] = await getDb()
    .select({ id: t.stopAttachments.id })
    .from(t.stopAttachments)
    .innerJoin(t.stops, eq(t.stops.id, t.stopAttachments.stopId))
    .innerJoin(t.trips, eq(t.trips.id, t.stops.tripId))
    .where(and(eq(t.stopAttachments.id, attachmentId), eq(t.trips.ownerId, userId)));
  return row?.id ?? null;
}

/** A safe download file name: no path separators, quotes or control characters. */
export const safeFileName = (name: string) =>
  name.replace(/[\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 150) || "attachment";
