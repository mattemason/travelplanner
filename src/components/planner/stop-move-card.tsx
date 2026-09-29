"use client";

import { useState } from "react";
import { dayLabel } from "@/lib/trip/format";
import { TRAY, type Day, type Stop } from "@/lib/trip/types";

type Props = {
  stop: Stop;
  container: string; // day id or TRAY
  days: Day[];
  onMove: (to: string) => void;
  onEdit: () => void;
  onInfo: () => void;
  onClose: () => void;
};

/** The stop tapped on the All stops map: where it is now, and a quick move to another day. */
export function StopMoveCard({ stop, container, days, onMove, onEdit, onInfo, onClose }: Props) {
  const [to, setTo] = useState(container);
  const where = container === TRAY ? "Not yet scheduled" : dayLabel(days.find((d) => d.id === container)?.date ?? "");
  return (
    <div className="w-[340px] max-w-full rounded-xl bg-paper p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[20px] font-bold">{stop.name}</h3>
          <p className="text-[13px] text-muted">Currently: {where}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer px-1 text-[20px] leading-none text-muted">
          ×
        </button>
      </div>
      <div className="mt-2.5 flex gap-2">
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="Move to"
          className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-soft px-2 py-1.5 text-[15px]"
        >
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {dayLabel(d.date)}
            </option>
          ))}
          <option value={TRAY}>Not yet scheduled</option>
        </select>
        <button type="button" className="btn btn-primary !min-h-9" disabled={to === container} onClick={() => onMove(to)}>
          Move
        </button>
      </div>
      <div className="mt-2 flex gap-4 text-[13px] font-bold">
        <button type="button" className="cursor-pointer text-ocean" onClick={onEdit}>
          Edit stop
        </button>
        <button type="button" className="cursor-pointer text-ocean" onClick={onInfo}>
          About this stop
        </button>
      </div>
    </div>
  );
}
