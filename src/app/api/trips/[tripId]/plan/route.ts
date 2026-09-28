import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getDb } from "@/db";
import { planProposals } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getSegments } from "@/lib/google/routes";
import { getProfile } from "@/lib/profile";
import { dayRoute, formatDuration, pairKey } from "@/lib/trip/drive";
import { dayLabel } from "@/lib/trip/format";
import { loadTrip } from "@/lib/trip/load";
import { applyPlanTo, buildPlanRequest, checkPlan, planSchema, type CheckedPlan } from "@/lib/trip/plan";
import type { TripData } from "@/lib/trip/types";

// "Plan my trip": Claude proposes a day-by-day plan from the trip's own stops, the server checks
// it (locked days, every stop once, real drive times from Google) and saves it as a pending
// proposal. Nothing changes in the trip until the user accepts. Streams newline-delimited JSON:
// {"t":"status"} progress, then {"t":"proposal"} or {"t":"error"}.

const MODEL = process.env.PLAN_BUILDER_MODEL || "claude-opus-5";
const body = z.object({
  locked: z.array(z.string().uuid()).max(400),
  preferences: z.string().max(2000),
});

/** Real driving seconds per day (drive stretches only), from the Routes API. */
async function driveTimes(trip: TripData): Promise<Record<string, number>> {
  const routes = trip.days.map((_, i) => dayRoute(trip, i));
  const pairs = routes.flatMap((r) =>
    r.slice(1).flatMap((to, i) => (to.arriveBy === "drive" ? [[r[i], to] as [typeof to, typeof to]] : [])),
  );
  const segs = await getSegments(pairs);
  return Object.fromEntries(
    trip.days.map((d, i) => [
      d.id,
      routes[i].slice(1).reduce((n, to, j) => n + (to.arriveBy === "drive" ? (segs[pairKey(routes[i][j], to)]?.durationS ?? 0) : 0), 0),
    ]),
  );
}

export async function POST(request: Request, ctx: RouteContext<"/api/trips/[tripId]/plan">) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI isn't set up yet" }, { status: 503 });
  const { tripId } = await ctx.params;
  if (!z.string().uuid().safeParse(tripId).success) return Response.json({ error: "Trip not found" }, { status: 404 });
  const trip = await loadTrip(user.id, tripId);
  if (!trip) return Response.json({ error: "Trip not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });

  const locked = new Set(parsed.data.locked.filter((id) => trip.days.some((d) => d.id === id)));
  const profile = await getProfile(user.id);
  const vehicle = profile?.vehicle ? `${profile.vehicle}${profile.fuelType ? ` (${profile.fuelType})` : ""}` : null;
  const req = buildPlanRequest(trip, locked, { preferences: parsed.data.preferences, vehicle });
  const system = await readFile(join(process.cwd(), "prompts", "plan-builder.md"), "utf8");

  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: JSON.stringify(req.context) }];
      try {
        let plan: CheckedPlan | null = null;
        let drive: Record<string, number> = {};
        const limitS = trip.maxDriveHours * 3600;

        for (let attempt = 0; attempt < 2; attempt++) {
          emit({ t: "status", v: attempt === 0 ? "Claude is planning your trip…" : "Revising days that are over your driving limit…" });
          const response = client.beta.messages.stream(
            {
              model: MODEL,
              max_tokens: 32000,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              system,
              messages,
              output_config: { format: betaZodOutputFormat(planSchema) },
            },
            { signal: request.signal },
          );
          const final = await response.finalMessage();
          if (final.stop_reason === "refusal") throw new Error("Claude declined to plan this trip.");
          if (final.stop_reason === "max_tokens") throw new Error("The plan was too long to finish. Lock more days and try again.");
          if (!final.parsed_output) throw new Error("Claude's plan couldn't be read. Try again.");

          plan = checkPlan(trip, locked, req, final.parsed_output);
          emit({ t: "status", v: "Checking real drive times…" });
          drive = await driveTimes(applyPlanTo(trip, plan));
          const over = trip.days.filter((d) => !locked.has(d.id) && drive[d.id] > limitS);
          if (!over.length || attempt === 1) break;

          // One retry with the real figures, as the spec asks.
          messages.push({ role: "assistant", content: final.content });
          messages.push({
            role: "user",
            content: `Real drive times from Google put these days over the ${trip.maxDriveHours}-hour limit: ${over
              .map((d) => `${d.date} (${formatDuration(drive[d.id])})`)
              .join(", ")}. Revise the plan so every unlocked day is within the limit: move stops to other days or leave some out, and keep everything else the same where you can.`,
          });
        }
        if (!plan) throw new Error("No plan came back. Try again.");

        const overDays = trip.days.filter((d) => !locked.has(d.id) && drive[d.id] > limitS);
        const warnings = [
          ...plan.warnings,
          ...overDays.map((d) => `${dayLabel(d.date)} is still ${formatDuration(drive[d.id])} of driving, over your limit.`),
        ];

        const [row] = await getDb()
          .insert(planProposals)
          .values({
            tripId: trip.id,
            promptJson: { context: req.context, locked: [...locked], preferences: parsed.data.preferences, model: MODEL },
            proposalJson: { ...plan, warnings, drive },
          })
          .returning({ id: planProposals.id });

        emit({ t: "proposal", v: { id: row.id, ...plan, warnings, drive } });
      } catch (err) {
        if (!request.signal.aborted) {
          console.error("Plan failed", err);
          const message =
            err instanceof Anthropic.RateLimitError
              ? "Claude is busy right now. Try again in a minute."
              : err instanceof Anthropic.APIError
                ? "Claude couldn't make a plan right now. Try again."
                : err instanceof Error
                  ? err.message
                  : "Something went wrong. Try again.";
          emit({ t: "error", v: message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
