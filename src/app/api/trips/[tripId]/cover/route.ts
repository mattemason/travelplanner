import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { trips } from "@/db/schema";
import { currentUser } from "@/lib/auth";

// A trip's cover photo: GET serves it, POST replaces it (multipart "file"), DELETE removes it.
// The browser resizes photos before upload, so 1.5 MB is plenty.
const MAX_BYTES = 1_500_000;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function owned(ctx: RouteContext<"/api/trips/[tripId]/cover">) {
  const user = await currentUser();
  if (!user) return null;
  const { tripId } = await ctx.params;
  if (!z.string().uuid().safeParse(tripId).success) return null;
  const [trip] = await getDb()
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.ownerId, user.id)));
  return trip?.id ?? null;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/trips/[tripId]/cover">) {
  const id = await owned(ctx);
  if (!id) return new Response(null, { status: 404 });
  const [row] = await getDb().select({ cover: trips.cover, type: trips.coverType }).from(trips).where(eq(trips.id, id));
  if (!row?.cover || !row.type) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.cover), {
    headers: {
      "Content-Type": row.type,
      // URLs carry ?v=<updated time>, so a cached copy is never stale.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/trips/[tripId]/cover">) {
  const id = await owned(ctx);
  if (!id) return Response.json({ error: "Trip not found" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No image uploaded" }, { status: 400 });
  if (!TYPES.has(file.type)) return Response.json({ error: "Use a JPEG, PNG or WebP image" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That image is too large" }, { status: 400 });
  const updatedAt = new Date();
  await getDb()
    .update(trips)
    .set({ cover: Buffer.from(await file.arrayBuffer()), coverType: file.type, coverUpdatedAt: updatedAt })
    .where(eq(trips.id, id));
  return Response.json({ version: updatedAt.getTime() });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/trips/[tripId]/cover">) {
  const id = await owned(ctx);
  if (!id) return Response.json({ error: "Trip not found" }, { status: 404 });
  await getDb().update(trips).set({ cover: null, coverType: null, coverUpdatedAt: null }).where(eq(trips.id, id));
  return new Response(null, { status: 204 });
}
