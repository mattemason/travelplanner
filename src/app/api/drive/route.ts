import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { getSegments } from "@/lib/google/routes";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const body = z.object({ pairs: z.array(z.tuple([point, point])).max(200) });

// Drive time, distance and route line between pairs of points. Signed-in users only, since
// each uncached pair is a billed Routes API call.
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json({ segments: await getSegments(parsed.data.pairs) });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Drive times unavailable" }, { status: 502 });
  }
}
