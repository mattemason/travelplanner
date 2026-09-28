import { currentUser } from "@/lib/auth";
import { placeAsResult } from "@/lib/google/places";

// Details for a Google map icon the user tapped. Signed-in users only (billed API).
export async function GET(_req: Request, ctx: RouteContext<"/api/places/[placeId]">) {
  if (!(await currentUser())) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { placeId } = await ctx.params;
  try {
    const result = await placeAsResult(placeId);
    return result ? Response.json({ result }) : Response.json({ error: "Place not found" }, { status: 404 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Place details unavailable" }, { status: 502 });
  }
}
