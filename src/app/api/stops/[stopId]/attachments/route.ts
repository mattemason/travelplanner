import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { stopAttachments } from "@/db/schema";
import { MAX_FILE_BYTES, MAX_FILES_PER_STOP, ownedStop, safeFileName } from "@/lib/attachments";
import { currentUser } from "@/lib/auth";

// Upload one or more files to a stop (multipart field "files"). Returns their metadata.
export async function POST(request: Request, ctx: RouteContext<"/api/stops/[stopId]/attachments">) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { stopId } = await ctx.params;
  if (!z.string().uuid().safeParse(stopId).success || !(await ownedStop(user.id, stopId))) {
    return Response.json({ error: "Stop not found" }, { status: 404 });
  }
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return Response.json({ error: "No files uploaded" }, { status: 400 });
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) return Response.json({ error: `${tooBig.name} is over 10 MB` }, { status: 400 });

  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(stopAttachments).where(eq(stopAttachments.stopId, stopId));
  if (n + files.length > MAX_FILES_PER_STOP) {
    return Response.json({ error: `A stop can have up to ${MAX_FILES_PER_STOP} files` }, { status: 400 });
  }

  const rows = await db
    .insert(stopAttachments)
    .values(
      await Promise.all(
        files.map(async (f) => ({
          stopId,
          name: safeFileName(f.name),
          type: f.type || "application/octet-stream",
          size: f.size,
          data: Buffer.from(await f.arrayBuffer()),
        })),
      ),
    )
    .returning({ id: stopAttachments.id, name: stopAttachments.name, type: stopAttachments.type, size: stopAttachments.size });
  return Response.json({ attachments: rows });
}
