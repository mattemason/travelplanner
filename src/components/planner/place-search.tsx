"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";

export type Suggestion = { placeId: string; main: string; secondary: string };

type Props = {
  tripId: string;
  session: string;
  value: string;
  onChange: (text: string) => void;
  onPick: (s: Suggestion) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
};

/** Name field that searches Google Places as you type (combobox pattern). */
export function PlaceSearch({ tripId, session, value, onChange, onPick, inputRef }: Props) {
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const skipNext = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) return; // too short to search; hidden at render time
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const params = new URLSearchParams({ q, session, trip: tripId });
        const res = await fetch(`/api/places/autocomplete?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const { suggestions } = (await res.json()) as { suggestions: Suggestion[] };
        setResults(suggestions);
        setActive(suggestions.length ? 0 : -1);
        setOpen(true);
        setStatus("idle");
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStatus("error");
          setOpen(true);
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [value, session, tripId]);

  const pick = (s: Suggestion) => {
    skipNext.current = true; // don't search again for the name we just filled in
    onPick(s);
    setOpen(false);
    setResults([]);
  };

  const showList = open && value.trim().length >= 2;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        autoComplete="off"
        placeholder="Start typing a place, e.g. Cockle Creek"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!showList || !results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            e.stopPropagation(); // Enter picks the suggestion instead of saving the form
            pick(results[active]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-paper py-1 font-normal shadow-lg"
        >
          {status === "error" ? (
            <li className="px-3 py-2.5 text-[14px] text-bad-ink">Place search isn&apos;t working right now.</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2.5 text-[14px] text-muted">No matches. Save to add it without a map location.</li>
          ) : (
            results.map((s, i) => (
              <li
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 ${i === active ? "bg-soft" : ""}`}
              >
                <span className="block text-[15px] font-bold text-ink">{s.main}</span>
                {s.secondary && <span className="block text-[12.5px] text-muted">{s.secondary}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
