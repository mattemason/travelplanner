"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { formatDuration } from "@/lib/trip/drive";
import { dayLabel } from "@/lib/trip/format";
import type { Day, Leg, Place, Stop } from "@/lib/trip/types";
import type { Warning } from "@/lib/trip/warnings";
import { SortableList } from "./sortable-list";
import { StopCard, type DriveIn } from "./stop-card";

export type DayDriveInfo = {
  driveIn: Record<string, DriveIn>; // stop id → drive from the previous point
  tail: { to: string; drive: DriveIn } | null; // last stop → tonight's overnight
  totalS: number;
  totalM: number;
  complete: boolean; // false while some drive times are still loading
  noRoute: number; // stretches Google has no road route for
};

type Props = {
  tripId: string;
  day: Day;
  index: number;
  leg: Leg | undefined;
  colour: string;
  stops: Stop[];
  places: Record<string, Place>;
  overnight: string | null;
  drive: DayDriveInfo;
  warnings: Warning[];
  selectedStopId: string | null;
  editingStopId: string | null;
  compact: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  onMove: (stopId: string, to: string, index: number) => void;
  onSelectStop: (stopId: string, dayIndex: number) => void;
  onEditStop: (stopId: string) => void;
  onAddStop: (dayId: string) => void;
};

export function DaySection({ sectionRef, ...p }: Props) {
  const style = { "--legc": p.colour } as CSSProperties;
  const driveText = p.drive.totalS > 0 ? `${formatDuration(p.drive.totalS)}${p.drive.complete ? "" : "+"} driving` : null;

  return (
    <section
      ref={sectionRef}
      data-day-index={p.index}
      style={style}
      className={p.compact ? "scroll-mt-[128px] px-[18px] pb-1" : "scroll-mt-0 pt-[26px]"}
      aria-labelledby={`day-${p.day.id}`}
    >
      <div
        className={`${p.compact ? "pt-[18px]" : "sticky top-0 z-[3] bg-bg pt-3"} flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-[var(--legc)] pb-2`}
      >
        <h2 id={`day-${p.day.id}`} className={`${p.compact ? "text-[22px]" : "text-[28px]"} font-bold`}>
          {dayLabel(p.day.date)}
        </h2>
        <span className="text-[13px] font-bold text-[var(--legc)]">{p.leg?.name}</span>
        {driveText && <span className="text-[13px] text-muted">{driveText}</span>}
        <span className="ml-auto text-[13.5px] text-muted">
          {p.overnight ? (
            <>
              Overnight <b className="text-ink">{p.overnight}</b>
            </>
          ) : (
            "No overnight"
          )}
        </span>
      </div>

      {p.warnings.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {p.warnings.map((w) => (
            <p key={w.title} className={`notice ${w.kind === "bad" ? "notice-bad" : "notice-warn"}`}>
              <b className="mr-1.5">{w.title}</b>
              {w.text}
            </p>
          ))}
        </div>
      )}

      <div className="mt-2">
        <SortableList container={p.day.id} onMove={p.onMove}>
          {p.stops.map((stop, i) => (
            <StopCard
              key={stop.id}
              stop={stop}
              place={p.places[stop.placeId]}
              number={i + 1}
              driveIn={p.drive.driveIn[stop.id]}
              selected={p.selectedStopId === stop.id}
              editing={p.editingStopId === stop.id}
              compact={p.compact}
              onSelect={() => p.onSelectStop(stop.id, p.index)}
              onEdit={() => p.onEditStop(stop.id)}
            />
          ))}
        </SortableList>
      </div>

      {p.drive.tail && (
        <p className="pl-11 text-[12.5px] text-muted">
          Then{" "}
          {p.drive.tail.drive === "loading"
            ? "…"
            : p.drive.tail.drive === "none"
              ? "no road route"
              : formatDuration(p.drive.tail.drive.durationS)}{" "}
          to {p.drive.tail.to}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-quiet" onClick={() => p.onAddStop(p.day.id)}>
          Add a stop
        </button>
        {p.compact && (
          <Link
            href={`/trips/${p.tripId}/day/${p.day.date}`}
            className="text-[14px] font-bold text-ocean underline-offset-2 hover:underline"
          >
            Day view ›
          </Link>
        )}
      </div>
    </section>
  );
}
