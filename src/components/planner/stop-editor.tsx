"use client";

import { useEffect, useRef, useState } from "react";
import { PlaceSearch, type Suggestion } from "./place-search";
import { dayLabel } from "@/lib/trip/format";
import { TAGS, TRAY, type Day, type Stop, type Tag } from "@/lib/trip/types";

export type EditorValues = {
  name: string;
  container: string; // day id or "tray"
  time: string | null;
  tags: Tag[];
  notes: string;
  bookingRef: string;
  link: string;
  picked: (Suggestion & { session: string }) | null; // new stops: the Google place chosen
};

type Props = {
  tripId: string;
  variant: "panel" | "sheet";
  isNew: boolean;
  stop: Stop | null; // null for a new stop
  container: string;
  days: Day[];
  saving: boolean;
  error: string | null;
  onSave: (values: EditorValues) => void;
  onCancel: () => void;
  onUnschedule: () => void;
  onDelete: () => void;
};

export function StopEditor(props: Props) {
  const { tripId, variant, isNew, stop, container, days, saving, error, onSave, onCancel, onUnschedule, onDelete } = props;
  const [session] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<EditorValues>(() => ({
    name: stop?.name ?? "",
    container,
    time: stop?.time ?? null,
    tags: stop?.tags ?? [],
    notes: stop?.notes ?? "",
    bookingRef: stop?.bookingRef ?? "",
    link: stop?.link ?? "",
    picked: null,
  }));
  const nameRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof EditorValues>(key: K, value: EditorValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    if (!saving) onSave(values);
  };

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        // Enter in a single-line field saves; textareas keep Enter for new lines.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h2 id="editor-title" className="text-[28px] font-bold">
          {isNew ? "New stop" : "Edit stop"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="cursor-pointer rounded-lg px-2 py-1 text-[22px] leading-none text-muted"
        >
          ×
        </button>
      </div>

      <label className="field">
        {isNew ? "Place" : "Name"}
        <PlaceSearch
          tripId={tripId}
          session={session}
          inputRef={nameRef}
          value={values.name}
          onChange={(text) => setValues((v) => ({ ...v, name: text, picked: null }))}
          onPick={(sug) => setValues((v) => ({ ...v, name: sug.main, picked: { ...sug, session } }))}
        />
      </label>
      <p className={`-mt-2 text-[12.5px] ${values.picked ? "text-good-ink" : "text-muted"}`}>
        {values.picked
          ? `${isNew ? "On the map" : "Moves to"}: ${values.picked.main}${values.picked.secondary ? `, ${values.picked.secondary}` : ""}`
          : isNew
            ? values.name.trim()
              ? "Pick a match to put it on the map, or save to add it without a location."
              : "Search Google Maps and pick the right place."
            : "Pick a match to move this stop to that place, or just edit the name."}
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="field">
          Day
          <select value={values.container} onChange={(e) => set("container", e.target.value)}>
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {dayLabel(d.date)}
              </option>
            ))}
            <option value={TRAY}>Not yet scheduled</option>
          </select>
        </label>
        <label className="field">
          Arrival time
          <input type="time" value={values.time ?? ""} onChange={(e) => set("time", e.target.value || null)} />
        </label>
      </div>

      <div className="field">
        Tags
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {TAGS.map((t) => {
            const on = values.tags.includes(t.key);
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                onClick={() => set("tags", on ? values.tags.filter((x) => x !== t.key) : [...values.tags, t.key])}
                className={`min-h-9 cursor-pointer rounded-full border-[1.5px] px-3 text-[13px] font-normal ${
                  on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="field">
        Notes
        <textarea
          rows={4}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Tides, fuel, who's driving, anything useful"
        />
      </label>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="field">
          Booking reference
          <input value={values.bookingRef} onChange={(e) => set("bookingRef", e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          Link
          <input type="url" value={values.link} onChange={(e) => set("link", e.target.value)} placeholder="https://" />
        </label>
      </div>

      {error && (
        <p role="alert" className="notice notice-bad mt-2">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary flex-1" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {!isNew && (
        <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
          {container !== TRAY && (
            <button type="button" onClick={onUnschedule} className="cursor-pointer text-[13.5px] text-ink underline">
              Move to not yet scheduled
            </button>
          )}
          <button type="button" onClick={onDelete} className="cursor-pointer text-[13.5px] text-bad-ink underline">
            Delete stop
          </button>
        </div>
      )}
      <p className="mt-3.5 text-[12px] text-muted">Esc closes without saving.</p>
    </form>
  );

  if (variant === "panel") return <div className="px-5 pt-4 pb-8">{form}</div>;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(10,20,22,0.45)]" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-[22px] bg-paper px-[18px] pt-2.5 pb-[calc(18px+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-2.5 h-1 w-10 rounded bg-line" aria-hidden="true" />
        {form}
      </div>
    </>
  );
}
