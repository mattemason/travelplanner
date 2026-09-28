import { formatDuration } from "./drive";
import type { TripData } from "./types";

export type Warning = { kind: "bad" | "warn"; title: string; text: string };

/** Quiet warnings shown under a day header and in the side panel. */
export function dayWarnings(trip: TripData, dayId: string, driveS: number | null): Warning[] {
  const stops = (trip.layout[dayId] ?? []).map((id) => trip.stops[id]).filter(Boolean);
  const warnings: Warning[] = [];

  const closed = stops.filter((s) => {
    const status = trip.places[s.placeId]?.businessStatus;
    return status === "CLOSED_TEMPORARILY" || status === "CLOSED_PERMANENTLY";
  });
  if (closed.length) {
    warnings.push({
      kind: "bad",
      title: "Closed",
      text: `${joinNames(closed.map((s) => s.name))}. Check before you go.`,
    });
  }

  const limitS = trip.maxDriveHours * 3600;
  if (driveS !== null && driveS > limitS) {
    warnings.push({
      kind: "warn",
      title: "Long driving day",
      text: `${formatDuration(driveS)} of driving, over the ${trip.maxDriveHours}-hour limit.`,
    });
  }

  if (stops.some((s) => s.tags.includes("weather"))) {
    warnings.push({ kind: "warn", title: "Weather-dependent", text: "Check conditions the night before." });
  }

  if (stops.some((s) => s.tags.includes("permit"))) {
    const openPermits = trip.checklist.filter((c) => c.category === "permit" && c.status !== "done");
    if (openPermits.length) {
      warnings.push({
        kind: "warn",
        title: "Permit needed",
        text: `${joinNames(openPermits.map((c) => c.title))} isn't ticked off yet.`,
      });
    }
  }

  return warnings;
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
