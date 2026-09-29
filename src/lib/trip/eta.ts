import type { RoutePoint } from "./drive";
import type { Segment, Stop } from "./types";

/** "HH:MM" plus a drive, rounded up to the next 5 minutes; wraps past midnight. */
export function addDrive(hhmm: string, seconds: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const mins = Math.ceil((h * 60 + m + seconds / 60) / 5) * 5;
  const day = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, "0")}:${String(day % 60).padStart(2, "0")}`;
}

/**
 * Estimated arrival at each stop reached by road straight after a stop with a departure time:
 * stop id → "HH:MM". Stops with their own arrival time still get an estimate; callers prefer the set time.
 */
export function estimatedArrivals(
  route: RoutePoint[],
  stops: Record<string, Stop>,
  segOf: (from: RoutePoint, to: RoutePoint) => Segment | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1];
    const to = route[i];
    const depart = from.stopId ? stops[from.stopId]?.departTime : null;
    if (!to.stopId || !depart || to.arriveBy !== "drive") continue;
    const seg = segOf(from, to);
    if (seg) out[to.stopId] = addDrive(depart, seg.durationS);
  }
  return out;
}
