"use client";

import { useEffect, useRef, useState } from "react";
import type { TripDetails } from "@/app/trips/[tripId]/actions";
import { dayCount } from "@/lib/trip/format";
import type { TripData } from "@/lib/trip/types";

// Colours offered to new legs, in order: the design's Myrtle, Lichen, Ocean, then extras.
const LEG_PALETTE = ["#2F6B4F", "#C75A1C", "#1F5A7A", "#7A4E9C", "#9C7A1F", "#A33B5E"];

type Props = {
  trip: TripData;
  focus: "trip" | "legs";
  variant: "panel" | "sheet";
  saving: boolean;
  error: string | null;
  stopsOnDays: Record<string, number>; // date → stop count, to warn before dropping days
  onSave: (details: TripDetails) => void;
  onCancel: () => void;
};

export function TripEditor({ trip, focus, variant, saving, error, stopsOnDays, onSave, onCancel }: Props) {
  const [v, setV] = useState<TripDetails>(() => ({
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    maxDriveHours: trip.maxDriveHours,
    legs: trip.legs.map((l) => ({ id: l.id, name: l.name, startDate: l.startDate, endDate: l.endDate, colour: l.colour })),
  }));
  const nameRef = useRef<HTMLInputElement>(null);
  const legsRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focus === "legs") {
      legsRef.current?.scrollIntoView({ block: "start" });
      legsRef.current?.parentElement?.querySelector<HTMLInputElement>("input")?.focus();
    } else nameRef.current?.focus();
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const setLeg = (i: number, patch: Partial<TripDetails["legs"][number]>) =>
    setV((x) => ({ ...x, legs: x.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const addLeg = () =>
    setV((x) => {
      const last = [...x.legs].sort((a, b) => a.endDate.localeCompare(b.endDate)).at(-1);
      const start = last ? nextDay(last.endDate) : x.startDate;
      const startDate = start > x.endDate ? x.endDate : start;
      const used = new Set(x.legs.map((l) => l.colour.toLowerCase()));
      const colour = LEG_PALETTE.find((c) => !used.has(c.toLowerCase())) ?? LEG_PALETTE[x.legs.length % LEG_PALETTE.length];
      return { ...x, legs: [...x.legs, { name: `Leg ${x.legs.length + 1}`, startDate, endDate: x.endDate, colour }] };
    });

  const droppedStops = Object.entries(stopsOnDays)
    .filter(([date]) => date < v.startDate || date > v.endDate)
    .reduce((n, [, count]) => n + count, 0);
  const valid = v.startDate && v.endDate && v.endDate >= v.startDate;

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) onSave({ ...v, maxDriveHours: Number(v.maxDriveHours) });
      }}
    >
      <div className="flex items-center justify-between">
        <h2 id="trip-editor-title" className="text-[28px] font-bold">
          Edit trip
        </h2>
        <button type="button" onClick={onCancel} aria-label="Close" className="cursor-pointer px-2 py-1 text-[22px] text-muted">
          ×
        </button>
      </div>

      <label className="field">
        Trip name
        <input ref={nameRef} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="field">
          Starts
          <input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} required />
        </label>
        <label className="field">
          Ends
          <input type="date" value={v.endDate} min={v.startDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} required />
        </label>
      </div>
      <p className="-mt-1.5 text-[12.5px] text-muted">
        {valid ? `${dayCount(v.startDate, v.endDate)} days.` : "Pick an end date after the start."}{" "}
        {droppedStops > 0 &&
          `${droppedStops} ${droppedStops === 1 ? "stop" : "stops"} on dropped days will move to Not yet scheduled.`}
      </p>
      <label className="field">
        Daily driving limit (hours)
        <input
          type="number"
          min={1}
          max={16}
          step={0.5}
          value={v.maxDriveHours}
          onChange={(e) => setV({ ...v, maxDriveHours: Number(e.target.value) })}
        />
      </label>

      <div>
        <h3 ref={legsRef} className="mt-5 mb-1 flex items-baseline justify-between text-[22px] font-semibold">
          Legs
          <small className="font-sans text-[12.5px] font-normal text-muted">Days take the leg that covers their date</small>
        </h3>
        {v.legs.map((leg, i) => (
          <fieldset key={leg.id ?? `new-${i}`} className="mt-2 rounded-xl border border-line p-3">
            <legend className="sr-only">Leg {i + 1}</legend>
            <div className="flex items-center gap-2">
              <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-line" title="Colour">
                <span className="absolute inset-0" style={{ background: leg.colour }} />
                <input
                  type="color"
                  value={leg.colour}
                  onChange={(e) => setLeg(i, { colour: e.target.value })}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={`Colour for ${leg.name}`}
                />
              </label>
              <input
                value={leg.name}
                onChange={(e) => setLeg(i, { name: e.target.value })}
                aria-label="Leg name"
                className="min-w-0 flex-1 rounded-[10px] border-[1.5px] border-line bg-soft px-2.5 py-2 text-[16px]"
                required
              />
              <button
                type="button"
                onClick={() => setV((x) => ({ ...x, legs: x.legs.filter((_, j) => j !== i) }))}
                className="cursor-pointer px-2 text-[13.5px] text-bad-ink underline"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="field !mb-0">
                From
                <input
                  type="date"
                  value={leg.startDate}
                  min={v.startDate}
                  max={v.endDate}
                  onChange={(e) => setLeg(i, { startDate: e.target.value })}
                  required
                />
              </label>
              <label className="field !mb-0">
                To
                <input
                  type="date"
                  value={leg.endDate}
                  min={leg.startDate}
                  max={v.endDate}
                  onChange={(e) => setLeg(i, { endDate: e.target.value })}
                  required
                />
              </label>
            </div>
          </fieldset>
        ))}
        <button type="button" className="btn btn-quiet mt-2.5" onClick={addLeg}>
          Add a leg
        </button>
      </div>

      {error && (
        <p role="alert" className="notice notice-bad mt-3">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary flex-1" disabled={saving || !valid}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );

  if (variant === "panel") return <div className="px-5 pt-4 pb-8">{form}</div>;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(10,20,22,0.45)]" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-editor-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-[22px] bg-paper px-[18px] pt-2.5 pb-[calc(18px+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-2.5 h-1 w-10 rounded bg-line" aria-hidden="true" />
        {form}
      </div>
    </>
  );
}

function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
