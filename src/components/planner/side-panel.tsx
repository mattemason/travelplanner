"use client";

import Link from "next/link";
import { formatDuration } from "@/lib/trip/drive";
import { dayLabel } from "@/lib/trip/format";
import type { ChecklistItem, Day, Leg } from "@/lib/trip/types";
import type { Warning } from "@/lib/trip/warnings";
import { dueLabel, dueSoon } from "./due-soon";

type Props = {
  tripId: string;
  day: Day;
  leg: Leg | undefined;
  stopCount: number;
  overnight: string | null;
  driveS: number;
  driveComplete: boolean;
  warnings: Warning[];
  checklist: ChecklistItem[];
};

export function SidePanel(p: Props) {
  const due = dueSoon(p.checklist).slice(0, 4);
  return (
    <div className="px-5 pt-[18px] pb-8">
      <span className="text-[13px] font-bold text-[var(--legc)]">{p.leg ? `${p.leg.name} leg` : ""}</span>
      <h2 className="text-[30px] font-bold">{dayLabel(p.day.date)}</h2>

      <div className="my-3.5 grid grid-cols-3 gap-2">
        <Stat value={String(p.stopCount)} label={p.stopCount === 1 ? "stop" : "stops"} />
        <Stat value={p.overnight ?? "–"} label="overnight" />
        <Stat value={p.driveS ? `${formatDuration(p.driveS)}${p.driveComplete ? "" : "+"}` : "–"} label="driving" />
      </div>

      {p.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {p.warnings.map((w) => (
            <p key={w.title} className={`notice ${w.kind === "bad" ? "notice-bad" : "notice-warn"}`}>
              <b className="mr-1.5">{w.title}</b>
              {w.text}
            </p>
          ))}
        </div>
      )}

      <h3 className="mt-[22px] mb-2 flex items-baseline justify-between text-[19px] font-semibold">
        Due soon
        <Link href={`/trips/${p.tripId}/checklist`} className="font-sans text-[13px] font-bold text-ocean">
          Checklist ›
        </Link>
      </h3>
      {due.length ? (
        <ul>
          {due.map(({ item, days }) => (
            <li key={item.id} className="flex justify-between gap-2.5 border-t border-line py-2.5 text-[14px]">
              <span>{item.title}</span>
              <span className="text-[12.5px] font-bold whitespace-nowrap text-warn-ink">
                {dueLabel(days, item.dueDate)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">Nothing due in the next 14 days.</p>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-soft px-[11px] py-[9px]">
      <em className="block truncate font-display text-[21px] leading-[1.1] font-bold not-italic" title={value}>
        {value}
      </em>
      <small className="text-[12px] text-muted">{label}</small>
    </div>
  );
}
