"use client";

import { useState } from "react";
import type { SearchResult } from "@/lib/google/places";
import { dayLabel } from "@/lib/trip/format";
import { TRAY, type Day } from "@/lib/trip/types";

export type { SearchResult };
type Area = { low: { lat: number; lng: number }; high: { lat: number; lng: number } };

const SHORTCUTS = ["Campgrounds", "Fuel", "Cafés", "Restaurants", "Supermarkets", "Public toilets", "Lookouts"];

type Props = {
  tripId: string;
  getArea: () => Area | null;
  results: SearchResult[] | null;
  onResults: (query: string | null, results: SearchResult[] | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compact?: boolean;
};

/** Search box for the visible map area, with one-tap shortcuts. Results are drawn by the map. */
export function MapSearch({ tripId, getArea, results, onResults, open, onOpenChange: setOpen, compact }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const run = async (q: string) => {
    const text = q.trim();
    if (text.length < 2) return;
    const area = getArea();
    if (!area) return;
    setQuery(text);
    setStatus("loading");
    try {
      const res = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip: tripId, q: text, area }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { results: found } = (await res.json()) as { results: SearchResult[] };
      onResults(text, found);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const clear = () => {
    setQuery("");
    setStatus("idle");
    onResults(null, null);
  };

  if (!open && !results) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search this map area"
        title="Search this map area"
        className="grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-paper/95 text-ink shadow hover:bg-paper"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
    );
  }

  return (
    <div className={`${compact ? "w-full" : "w-[400px]"} max-w-full rounded-xl bg-paper/95 p-2 shadow`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        className="flex gap-1.5"
      >
        <input
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !results) setOpen(false);
          }}
          placeholder="Search this area"
          aria-label="Search this map area"
          className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-soft px-2.5 py-1.5 text-[16px]"
        />
        {results ? (
          <>
            <button
              type="submit"
              className="btn btn-primary !min-h-9 !px-3"
              disabled={status === "loading"}
              title="Run this search again over the part of the map you can see now"
            >
              {status === "loading" ? "…" : "Search this area"}
            </button>
            <button
              type="button"
              onClick={() => {
                clear();
                setOpen(false);
              }}
              className="btn !min-h-9 !px-3"
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <button type="submit" className="btn btn-primary !min-h-9 !px-3" disabled={status === "loading"}>
              {status === "loading" ? "…" : "Search"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close search"
              className="cursor-pointer px-1.5 text-[20px] leading-none text-muted"
            >
              ×
            </button>
          </>
        )}
      </form>
      {!results && (
        <div className="mt-1.5 flex gap-1.5 overflow-x-auto no-scrollbar">
          {SHORTCUTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void run(s)}
              className="shrink-0 cursor-pointer rounded-full border-[1.5px] border-line bg-paper px-2.5 py-1 text-[12.5px] text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 px-0.5 text-[12.5px] text-muted" role="status">
        {status === "loading"
          ? "Searching…"
          : status === "error"
            ? "Search isn't working right now."
            : results
              ? results.length
                ? `${results.length} ${results.length === 1 ? "place" : "places"} for "${query}". Tap a pin, or move the map and search this area.`
                : `Nothing for "${query}" here. Zoom out or move the map, then search again.`
              : "Searches the part of the map you can see."}
      </p>
    </div>
  );
}

type CardProps = {
  result: SearchResult;
  days: Day[];
  defaultContainer: string;
  added: boolean;
  onAdd: (container: string) => Promise<void>;
  onClose: () => void;
};

/** Details for the tapped search result, with "Add to a day". */
export function ResultCard({ result, days, defaultContainer, added, onAdd, onClose }: CardProps) {
  const [container, setContainer] = useState(defaultContainer);
  const [adding, setAdding] = useState(false);
  const closed = result.businessStatus === "CLOSED_TEMPORARILY" || result.businessStatus === "CLOSED_PERMANENTLY";

  return (
    <div className="w-[340px] max-w-full rounded-xl bg-paper p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[20px] font-bold">{result.name}</h3>
          <p className="text-[13px] text-muted">
            {[result.type, result.rating ? `★ ${result.rating.toFixed(1)}${result.ratings ? ` (${result.ratings})` : ""}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer px-1 text-[20px] leading-none text-muted">
          ×
        </button>
      </div>
      {result.address && <p className="mt-1 text-[13px]">{result.address}</p>}
      {closed && <span className="chip chip-closed mt-1.5">{result.businessStatus === "CLOSED_PERMANENTLY" ? "Closed" : "Temporarily closed"}</span>}
      {result.mapsUrl && (
        <a href={result.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[13px] font-bold text-ocean">
          Open in Google Maps
        </a>
      )}
      <div className="mt-2.5 flex gap-2">
        <select
          value={container}
          onChange={(e) => setContainer(e.target.value)}
          aria-label="Add to"
          className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-soft px-2 py-1.5 text-[15px]"
        >
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {dayLabel(d.date)}
            </option>
          ))}
          <option value={TRAY}>Not yet scheduled</option>
        </select>
        <button
          type="button"
          className="btn btn-primary !min-h-9"
          disabled={adding || added}
          onClick={async () => {
            setAdding(true);
            try {
              await onAdd(container);
            } finally {
              setAdding(false);
            }
          }}
        >
          {added ? "Added" : adding ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
