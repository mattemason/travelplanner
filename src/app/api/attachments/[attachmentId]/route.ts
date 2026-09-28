import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { stopAttachments } from "@/db/schema";
import { ownedAttachment, servesInline } from "@/lib/attachments";
import { currentUser } from "@/lib/auth";

async function owned(ctx: RouteContext<"/api/attachments/[attachmentId]">) {
  const user = await currentUser();
  if (!user) return null;
  const { attachmentId } = await ctx.params;
  if (!z.string().uuid().safeParse(attachmentId).success) return null;
  return ownedAttachment(user.id, attachmentId);
}

/** Opens PDFs and images in the browser; everything else downloads. */
export async function GET(_req: Request, ctx: RouteContext<"/api/attachments/[attachmentId]">) {
  const id = await owned(ctx);
  if (!id) return new Response("Not found", { status: 404 });
  const [file] = await getDb().select().from(stopAttachments).where(eq(stopAttachments.id, id));
  if (!file) return new Response("Not found", { status: 404 });
  const inline = servesInline(file.type);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": inline ? file.type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/attachments/[attachmentId]">) {
  const id = await owned(ctx);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  await getDb().delete(stopAttachments).where(eq(stopAttachments.id, id));
  return new Response(null, { status: 204 });
}
