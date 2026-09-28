"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { findNear } from "@/lib/google/places";
import { fetchSharedList, SharedListError } from "@/lib/google/shared-list";
import { diffList, type ListPlace, type TripPlaceRef } from "@/lib/google/shared-list-parse";
import { loadTrip } from "@/lib/trip/load";

// Sync from a Google Maps list share link: preview the changes, then add the chosen new places
// to the trip's "Not yet scheduled" tray. Nothing already in the trip is changed or removed.

const link = z.string().trim().min(10).max(2000);

async function owned(tripId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  const [trip] = await getDb()
    .select({ id: t.trips.id })
    .from(t.trips)
    .where(and(eq(t.trips.id, z.string().uuid().parse(tripId)), eq(t.trips.ownerId, user.id)));
  if (!trip) throw new Error("Trip not found");
  return { userId: user.id, tripId: trip.id };
}

/** Places on the trip's stops, for matching list entries against. */
async function tripPlaces(tripId: string): Promise<TripPlaceRef[]> {
  return getDb()
    .selectDistinct({
      placeId: t.places.id,
      name: t.places.name,
      lat: t.places.lat,
      lng: t.places.lng,
      cid: t.places.googleCid,
    })
    .from(t.stops)
    .innerJoin(t.places, eq(t.places.id, t.stops.placeId))
    .where(eq(t.stops.tripId, tripId));
}

/** The trip's share-link list, if it has been synced before. */
async function syncedList(tripId: string) {
  const [list] = await getDb()
    .select()
    .from(t.placeLists)
    .where(and(eq(t.placeLists.tripId, tripId), eq(t.placeLists.source, "share_link")))
    .orderBy(desc(t.placeLists.lastSyncedAt))
    .limit(1);
  return list ?? null;
}

async function previouslySynced(listId: string | null): Promise<TripPlaceRef[]> {
  if (!listId) return [];
  return getDb()
    .select({ placeId: t.places.id, name: t.places.name, lat: t.places.lat, lng: t.places.lng, cid: t.places.googleCid })
    .from(t.placeListItems)
    .innerJoin(t.places, eq(t.places.id, t.placeListItems.placeId))
    .where(eq(t.placeListItems.listId, listId));
}

export type SyncPreview =
  | {
      ok: true;
      title: string | null;
      added: Pick<ListPlace, "key" | "name" | "address" | "note">[];
      existing: { name: string; stop: string }[];
      removed: { name: string }[];
    }
  | { ok: false; error: string };

/** The link this trip last synced from, to pre-fill the box. */
export async function lastSyncLink(tripId: string): Promise<string | null> {
  const { tripId: id } = await owned(tripId);
  return (await syncedList(id))?.sourceUrl ?? null;
}

export async function previewSync(tripId: string, shareLink: string): Promise<SyncPreview> {
  const { tripId: id } = await owned(tripId);
  try {
    const list = await fetchSharedList(link.parse(shareLink));
    const prior = await syncedList(id);
    const diff = diffList(list, await tripPlaces(id), await previouslySynced(prior?.id ?? null));
    return {
      ok: true,
      title: list.title,
      added: diff.added.map(({ key, name, address, note }) => ({ key, name, address, note })),
      existing: diff.existing.map((e) => ({ name: e.place.name, stop: e.match.name })),
      removed: diff.removed.map((r) => ({ name: r.name })),
    };
  } catch (err) {
    if (err instanceof SharedListError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) return { ok: false, error: "Paste the list's share link." };
    console.error("Sync preview failed", err);
    return { ok: false, error: "Couldn't read that list right now. Try again later." };
  }
}

/** Adds the chosen new places to the tray (re-reading the list on the server) and returns the trip. */
export async function applySync(tripId: string, shareLink: string, keys: string[]) {
  const { tripId: id, userId } = await owned(tripId);
  const chosen = new Set(z.array(z.string().max(300)).max(500).parse(keys));
  let list;
  try {
    list = await fetchSharedList(link.parse(shareLink));
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof SharedListError ? err.message : "Couldn't read that list right now.",
    };
  }
  const title = list.title ?? "Google Maps list";
  const prior = await syncedList(id);
  const diff = diffList(list, await tripPlaces(id), await previouslySynced(prior?.id ?? null));
  const toAdd = diff.added.filter((p) => chosen.has(p.key));

  // Match each new place to its Google Places entry for an exact spot and closure status.
  const found = await Promise.all(
    toAdd.map((p) =>
      p.lat !== null && p.lng !== null ? findNear(p.name, p.lat, p.lng).catch(() => null) : Promise.resolve(null),
    ),
  );

  await getDb().transaction(async (tx) => {
    const [listRow] = prior
      ? await tx
          .update(t.placeLists)
          .set({ name: title, sourceUrl: shareLink.trim(), lastSyncedAt: new Date() })
          .where(eq(t.placeLists.id, prior.id))
          .returning()
      : await tx
          .insert(t.placeLists)
          .values({ userId, tripId: id, name: title, source: "share_link", sourceUrl: shareLink.trim(), lastSyncedAt: new Date() })
          .returning();

    const [{ trayMax }] = await tx
      .select({ trayMax: sql<number>`coalesce(max(${t.stops.position}), -1)` })
      .from(t.stops)
      .where(and(eq(t.stops.tripId, id), isNull(t.stops.dayId)));

    const newPlaceIds: string[] = [];
    for (const [i, p] of toAdd.entries()) {
      const g = found[i];
      const values = {
        userId,
        name: g?.name ?? p.name,
        lat: g?.lat ?? p.lat,
        lng: g?.lng ?? p.lng,
        address: g?.address ?? p.address,
        businessStatus: g?.businessStatus ?? null,
        mapsUrl: g?.mapsUrl ?? null,
        googlePlaceId: g?.googlePlaceId ?? null,
        googleCid: p.cid,
        sourceList: title,
        lastEnrichedAt: g ? new Date() : null,
      };
      const [place] = g
        ? await tx
            .insert(t.places)
            .values(values)
            .onConflictDoUpdate({
              target: [t.places.userId, t.places.googlePlaceId],
              targetWhere: sql`google_place_id is not null`,
              set: { googleCid: p.cid, businessStatus: values.businessStatus, lastEnrichedAt: values.lastEnrichedAt },
            })
            .returning({ id: t.places.id })
        : await tx.insert(t.places).values(values).returning({ id: t.places.id });
      newPlaceIds.push(place.id);
      await tx.insert(t.stops).values({
        tripId: id,
        dayId: null,
        placeId: place.id,
        position: Number(trayMax) + 1 + i,
        label: p.name !== values.name ? p.name : null, // keep the list's name if Google's differs
        notes: p.note,
      });
    }

    // Remember everything on the list (new and already-in-trip) as coming from it.
    const onList = [...new Set([...newPlaceIds, ...diff.existing.map((e) => e.match.placeId)])];
    if (onList.length) {
      await tx
        .insert(t.placeListItems)
        .values(onList.map((placeId) => ({ listId: listRow.id, placeId })))
        .onConflictDoNothing();
    }
    // Places that left the list stay in the trip but no longer count as part of it.
    if (diff.removed.length) {
      await tx.delete(t.placeListItems).where(
        and(
          eq(t.placeListItems.listId, listRow.id),
          inArray(
            t.placeListItems.placeId,
            diff.removed.map((r) => r.placeId),
          ),
        ),
      );
    }
  });

  const trip = await loadTrip(userId, id);
  if (!trip) throw new Error("Trip not found");
  return { ok: true as const, added: toAdd.length, trip };
}
