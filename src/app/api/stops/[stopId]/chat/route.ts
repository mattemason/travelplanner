import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { stopChats } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { stopContext } from "@/lib/stop-info";

// AI briefing and follow-up chat about one stop. The Anthropic key stays on the server; each
// request re-checks that the signed-in user owns the stop. Replies stream back as plain text.

type ChatMessage = { role: "user" | "assistant"; content: string };

const MODEL = process.env.STOP_INFO_MODEL || "claude-opus-5";
const FIRST_QUESTION = "Tell me about this stop.";
const MAX_MESSAGES = 40;

const body = z.object({
  message: z.string().trim().min(1).max(2000).optional(), // omitted = the automatic first briefing
  reset: z.boolean().optional(), // start the conversation over
});

async function load(stopId: string): Promise<ChatMessage[]> {
  const [row] = await getDb().select().from(stopChats).where(eq(stopChats.stopId, stopId));
  return row?.messages ?? [];
}

/** The saved conversation, without the hidden first question. */
export async function GET(_req: Request, ctx: RouteContext<"/api/stops/[stopId]/chat">) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { stopId } = await ctx.params;
  if (!z.string().uuid().safeParse(stopId).success || !(await stopContext(user.id, stopId))) {
    return Response.json({ error: "Stop not found" }, { status: 404 });
  }
  return Response.json({ messages: (await load(stopId)).slice(1) });
}

export async function POST(request: Request, ctx: RouteContext<"/api/stops/[stopId]/chat">) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI isn't set up yet" }, { status: 503 });
  const { stopId } = await ctx.params;
  if (!z.string().uuid().safeParse(stopId).success) return Response.json({ error: "Stop not found" }, { status: 404 });
  const context = await stopContext(user.id, stopId);
  if (!context) return Response.json({ error: "Stop not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });

  const history = parsed.data.reset ? [] : await load(stopId);
  const messages: ChatMessage[] = [...history];
  if (!messages.length) messages.push({ role: "user", content: FIRST_QUESTION });
  if (parsed.data.message) messages.push({ role: "user", content: parsed.data.message });
  else if (messages.at(-1)?.role !== "user") {
    return Response.json({ messages: messages.slice(1) }); // nothing new to answer
  }
  if (messages.length > MAX_MESSAGES) {
    return Response.json({ error: "This conversation is full. Start over to ask more." }, { status: 400 });
  }

  // Keys that aren't scoped to a workspace need the workspace named on every request.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      const send = (text: string) => {
        reply += text;
        controller.enqueue(encoder.encode(text));
      };
      try {
        // Server tools can pause a long turn (pause_turn); resume it a few times.
        const turn: Anthropic.Beta.BetaMessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = client.beta.messages.stream(
            {
              model: MODEL,
              max_tokens: 16000,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default", // if a safety check declines, retry on a fallback model
              system: context.system,
              messages: turn,
              tools: [
                {
                  type: "web_search_20260209",
                  name: "web_search",
                  max_uses: 4,
                  user_location: { type: "approximate", country: "AU" },
                },
              ],
            },
            { signal: request.signal },
          );
          for await (const event of response) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") send(event.delta.text);
          }
          const final = await response.finalMessage();
          if (final.stop_reason === "refusal") {
            send("\n\nSorry, I can't help with that one. Try asking another way.");
            break;
          }
          if (final.stop_reason !== "pause_turn") break;
          turn.push({ role: "assistant", content: final.content });
        }

        if (reply.trim()) {
          const saved = [...messages, { role: "assistant" as const, content: reply }];
          await getDb()
            .insert(stopChats)
            .values({ stopId, messages: saved })
            .onConflictDoUpdate({ target: stopChats.stopId, set: { messages: saved, updatedAt: new Date() } });
        }
        controller.close();
      } catch (err) {
        if (request.signal.aborted) return controller.close();
        console.error("Stop chat failed", err);
        const text =
          err instanceof Anthropic.RateLimitError
            ? "Claude is busy right now. Try again in a minute."
            : err instanceof Anthropic.AuthenticationError
              ? "The Anthropic API key isn't valid. Check ANTHROPIC_API_KEY in Railway."
              : err instanceof Anthropic.BadRequestError && /workspace/i.test(err.message)
                ? "The Anthropic API key needs a workspace. Use a key created inside a workspace, or set ANTHROPIC_WORKSPACE_ID in Railway."
                : "Something went wrong getting an answer. Try again.";
        controller.enqueue(encoder.encode(`${reply ? "\n\n" : ""}⚠ ${text}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
