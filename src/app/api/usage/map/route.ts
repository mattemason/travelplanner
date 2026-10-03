import { currentUser } from "@/lib/auth";
import { recordGoogle } from "@/lib/usage";

// The browser reports each Google map it creates (billed as a Dynamic Maps load).
export async function POST() {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  recordGoogle("maps.dynamic", { userId: user.id });
  return new Response(null, { status: 204 });
}
