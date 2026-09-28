"use client";

import { formatDistance, formatDuration } from "@/lib/trip/drive";
import { formatCost } from "@/lib/trip/fuel";
import { dayLabel } from "@/lib/trip/format";
import type { Day, Leg } from "@/lib/trip/types";
import type { DayDriveInfo } from "./day-section";

type Props = {
  days: Day[];
  legs: Leg[];
  drives: DayDriveInfo[];
  colourOf: (legColour: string) => string;
  fuelFor: (metres: number) => number | null; // estimated fuel $ for a distance
  compact?: boolean;
};

/** Whole-trip totals: distance and driving time overall and per leg, plus the longest day. */
export function TripSummary({ days, legs, drives, colourOf, fuelFor, compact }: Props) {
  const totalS = drives.reduce((n, d) => n + d.totalS, 0);
  const totalM = drives.reduce((n, d) => n + d.totalM, 0);
  const loading = drives.some((d) => !d.complete);
  const noRoute = drives.reduce((n, d) => n + d.noRoute, 0);

  const perLeg = legs.map((leg) => {
    const idx = days.flatMap((d, i) => (d.legId === leg.id ? [i] : []));
    return {
      leg,
      days: idx.length,
      s: idx.reduce((n, i) => n + drives[i].totalS, 0),
      m: idx.reduce((n, i) => n + drives[i].totalM, 0),
    };
  });
  const longest = drives.reduce((best, d, i) => (d.totalS > (drives[best]?.totalS ?? 0) ? i : best), 0);

  const note = loading
    ? "Some drive times are still loading."
    : noRoute
      ? `${noRoute} ${noRoute === 1 ? "stretch has" : "stretches have"} no road route (tracks, ferries) and aren't counted.`
      : null;

  return (
    <div className={compact ? "px-[18px] py-3" : "w-[300px] max-w-full rounded-xl bg-paper/95 px-3.5 py-3 shadow"}>
      <span className="block text-[12.5px] font-bold text-muted">Whole trip, {days.length} days</span>
      <div className="mt-1 flex gap-4">
        <div>
          <em className="block font-display text-[26px] leading-none font-bold not-italic">
            {totalM ? formatDistance(totalM) : "–"}
          </em>
          <small className="text-[12px] text-muted">distance</small>
        </div>
        <div>
          <em className="block font-display text-[26px] leading-none font-bold not-italic">
            {totalS ? formatDuration(totalS) : "–"}
          </em>
          <small className="text-[12px] text-muted">driving</small>
        </div>
        {totalM > 0 && fuelFor(totalM) !== null && (
          <div>
            <em className="block font-display text-[26px] leading-none font-bold not-italic">~{formatCost(fuelFor(totalM)!)}</em>
            <small className="text-[12px] text-muted">fuel</small>
          </div>
        )}
      </div>
      {perLeg.length > 0 && (
        <table className="mt-2.5 w-full text-[13px]">
          <caption className="sr-only">Driving per leg</caption>
          <tbody>
            {perLeg.map(({ leg, days: n, s, m }) => (
              <tr key={leg.id} className="border-t border-line">
                <th scope="row" className="py-1 text-left font-normal">
                  <span className="mr-1.5 inline-block h-[5px] w-3.5 rounded-sm align-middle" style={{ background: colourOf(leg.colour) }} />
                  {leg.name} <span className="text-muted">· {n}d</span>
                </th>
                <td className="py-1 text-right whitespace-nowrap">{s ? formatDuration(s) : "–"}</td>
                <td className="py-1 pl-2.5 text-right whitespace-nowrap text-muted">{m ? formatDistance(m) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {drives[longest]?.totalS > 0 && (
        <p className="mt-1.5 text-[12.5px] text-muted">
          Longest day: {dayLabel(days[longest].date)}, {formatDuration(drives[longest].totalS)}
        </p>
      )}
      {note && <p className="mt-1 text-[12px] text-muted">{note}</p>}
    </div>
  );
}
