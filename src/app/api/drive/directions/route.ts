import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { getDirections } from "@/lib/google/routes";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const body = z.object({ from: point, to: point });

// Turn-by-turn directions for drive mode. Signed-in users only: each call is a billed Routes API request.
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json({ directions: await getDirections(parsed.data.from, parsed.data.to) });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Directions unavailable" }, { status: 502 });
  }
}
