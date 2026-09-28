"use client";

import { formatDistance, formatDuration } from "@/lib/trip/drive";
import { timeLabel } from "@/lib/trip/format";
import { TAGS, type Place, type Segment, type Stop } from "@/lib/trip/types";
import { GripIcon, PencilIcon } from "./icons";

type Props = {
  stop: Stop;
  place: Place | undefined;
  number: number | null; // null in the tray
  driveIn?: DriveIn; // drive from the previous point; undefined when there is none
  selected: boolean;
  editing: boolean;
  compact?: boolean;
  onSelect: () => void;
  onEdit: () => void;
};

export type DriveIn = Segment | "loading" | "none";

const tagLabel = Object.fromEntries(TAGS.map((t) => [t.key, t.label]));

export function StopCard({ stop, place, number, driveIn, selected, editing, compact, onSelect, onEdit }: Props) {
  const closed = place?.businessStatus === "CLOSED_TEMPORARILY" || place?.businessStatus === "CLOSED_PERMANENTLY";
  const noMap = place && (place.lat === null || place.lng === null);

  return (
    <li
      data-stop-id={stop.id}
      data-editing={editing}
      className="stop-card group mb-1.5 cursor-grab touch-manipulation select-none"
    >
      {driveIn !== undefined && (
        <div className="flex items-center gap-2 py-1 pl-11 text-[12.5px] text-muted" aria-label="Drive from previous">
          <span className="h-3 w-0.5 rounded bg-[var(--legc)] opacity-60" aria-hidden="true" />
          {driveIn === "loading"
            ? "Drive time…"
            : driveIn === "none"
              ? "No road route"
              : `${formatDuration(driveIn.durationS)} · ${formatDistance(driveIn.distanceM)}`}
        </div>
      )}
      <div
        onClick={onSelect}
        className={`flex items-start gap-3 rounded-xl border bg-paper ${compact ? "px-2 py-2.5" : "py-3 pr-3 pl-2"} ${
          editing
            ? "border-ocean shadow-[0_0_0_2px_var(--ocean)]"
            : selected
              ? "border-[var(--legc)]"
              : "border-line hover:border-muted"
        }`}
      >
        {!compact && (
          <span className="self-center text-muted opacity-25 group-hover:opacity-100">
            <GripIcon />
          </span>
        )}
        {number !== null && (
          <span className="mt-px grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-2 border-[var(--legc)] text-[12.5px] font-bold">
            {number}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] font-bold">
            {stop.time && <span className="mr-2 font-normal text-muted">{timeLabel(stop.time)}</span>}
            {stop.name}
          </div>
          {stop.notes && <div className="mt-0.5 text-[13.5px] whitespace-pre-line text-muted">{stop.notes}</div>}
          {(stop.tags.length > 0 || closed || stop.bookingRef || stop.link || noMap) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {stop.tags.map((t) => (
                <span key={t} className="chip">
                  {tagLabel[t]}
                </span>
              ))}
              {closed && (
                <span className="chip chip-closed">
                  {place?.businessStatus === "CLOSED_PERMANENTLY" ? "Closed" : "Temporarily closed"}
                </span>
              )}
              {stop.bookingRef && <span className="chip chip-ref">Ref {stop.bookingRef}</span>}
              {stop.link && (
                <a className="chip" href={stop.link} target="_blank" rel="noopener noreferrer">
                  Link
                </a>
              )}
              {noMap && <span className="chip">Not on map</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          className="edit-btn grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border-[1.5px] border-line bg-paper text-ink"
          aria-label={`Edit ${stop.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <PencilIcon />
        </button>
      </div>
    </li>
  );
}
