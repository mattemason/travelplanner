"use client";

import { formatDistance, formatDuration } from "@/lib/trip/drive";
import { timeLabel } from "@/lib/trip/format";
import { transportSummary } from "@/lib/trip/details";
import { arriveByLabel, BOOKED_MODES, tagLabel, type ArriveBy, type Place, type Segment, type Stop } from "@/lib/trip/types";
import { CopyIcon, GripIcon, InfoIcon, PencilIcon, TrashIcon } from "./icons";

type Props = {
  stop: Stop;
  place: Place | undefined;
  number: number | null; // null in the tray
  driveIn?: DriveIn; // drive from the previous point; undefined when there is none
  selected: boolean;
  editing: boolean;
  compact?: boolean;
  overnight?: boolean; // this stop is the day's overnight
  stayBooked?: boolean; // the overnight has a booking confirmation
  dayDate?: string; // the stop's day, so travel times on that day show without a date
  onSelect: () => void;
  onEdit: () => void;
  onInfo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

/** How the stop is reached: a drive (known, loading or no route) or another mode. */
export type DriveIn = Segment | "loading" | "none" | { mode: Exclude<ArriveBy, "drive"> };


export function StopCard(props: Props) {
  const { stop, place, number, driveIn, selected, editing, compact, overnight, stayBooked, onSelect, onEdit, onInfo, onDuplicate, onDelete, dayDate } = props;
  const travel = BOOKED_MODES.includes(stop.arriveBy) ? transportSummary(stop.transport, dayDate) : "";
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
              : "mode" in driveIn
                ? arriveByLabel(driveIn.mode)
                : `${formatDuration(driveIn.durationS)} · ${formatDistance(driveIn.distanceM)}`}
        </div>
      )}
      <div
        onClick={onSelect}
        className={`flex items-start gap-2 rounded-xl border bg-paper ${compact ? "px-2 py-2.5" : "py-3 pr-3 pl-2"} ${
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
          {travel && (
            <div className="mt-0.5 text-[13px] text-ink">
              {arriveByLabel(stop.arriveBy).split(" ")[0]} {travel}
            </div>
          )}
          {stop.notes && <div className="mt-0.5 text-[13.5px] whitespace-pre-line text-muted">{stop.notes}</div>}
          {(stop.tags.length > 0 ||
            stop.categories.length > 0 ||
            closed ||
            stop.bookingRef ||
            stop.link ||
            noMap ||
            overnight ||
            stop.attachments.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {overnight && <span className="chip border-transparent bg-ink text-paper">Overnight</span>}
              {overnight && stayBooked && <span className="chip chip-ref font-bold">Booked</span>}
              {stop.categories.map((c) => (
                <span key={`c-${c}`} className="chip border-ocean bg-paper text-ocean">
                  {c}
                </span>
              ))}
              {stop.tags.map((t) => (
                <span key={t} className="chip">
                  {tagLabel(t)}
                </span>
              ))}
              {closed && (
                <span className="chip chip-closed">
                  {place?.businessStatus === "CLOSED_PERMANENTLY" ? "Closed" : "Temporarily closed"}
                </span>
              )}
              {stop.bookingRef && <span className="chip chip-ref">Ref {stop.bookingRef}</span>}
              {stop.attachments.length > 0 && (
                <span className="chip" title={stop.attachments.map((a) => a.name).join(", ")}>
                  📎 {stop.attachments.length}
                </span>
              )}
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
          className="edit-btn grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border-[1.5px] border-line bg-paper text-ocean"
          aria-label={`About ${stop.name}`}
          title="About this stop"
          onClick={(e) => {
            e.stopPropagation();
            onInfo();
          }}
        >
          <InfoIcon />
        </button>
        <button
          type="button"
          className="edit-btn grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border-[1.5px] border-line bg-paper text-ink"
          aria-label={`Duplicate ${stop.name}`}
          title="Duplicate this stop"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
        >
          <CopyIcon />
        </button>
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
        <button
          type="button"
          className="edit-btn grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border-[1.5px] border-line bg-paper text-bad-ink"
          aria-label={`Delete ${stop.name}`}
          title="Delete this stop"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}
