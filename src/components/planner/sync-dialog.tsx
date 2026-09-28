"use client";

import { useEffect, useState } from "react";
import { applySync, lastSyncLink, previewSync, type SyncPreview } from "@/app/trips/[tripId]/sync-actions";
import type { TripData } from "@/lib/trip/types";

type Props = { tripId: string; onClose: () => void; onApplied: (trip: TripData, added: number) => void };
type Preview = Extract<SyncPreview, { ok: true }>;

/** Import new places from a Google Maps list share link into "Not yet scheduled". */
export function SyncDialog({ tripId, onClose, onApplied }: Props) {
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    lastSyncLink(tripId)
      .then((saved) => saved && setLink((l) => l || saved))
      .catch(() => {});
  }, [tripId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const check = async () => {
    setBusy("check");
    setError(null);
    setPreview(null);
    try {
      const r = await previewSync(tripId, link);
      if (!r.ok) return setError(r.error);
      setPreview(r);
      setChosen(new Set(r.added.map((p) => p.key)));
    } catch {
      setError("Couldn't check that list. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy("apply");
    setError(null);
    try {
      const r = await applySync(tripId, link, [...chosen]);
      if (!r.ok) return setError(r.error);
      onApplied(r.trip, r.added);
    } catch {
      setError("Couldn't add those places. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (key: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(10,20,22,0.45)]" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-[22px] bg-paper min-[640px]:inset-auto min-[640px]:top-1/2 min-[640px]:left-1/2 min-[640px]:w-[600px] min-[640px]:max-w-[calc(100%-32px)] min-[640px]:-translate-x-1/2 min-[640px]:-translate-y-1/2 min-[640px]:rounded-2xl min-[640px]:shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3">
          <div>
            <h2 id="sync-title" className="text-[26px] font-bold">
              Sync from Google
            </h2>
            <p className="text-[13.5px] text-muted">New places from a Google Maps list go to Not yet scheduled.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer px-2 py-1 text-[22px] leading-none text-muted">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void check();
            }}
          >
            <label className="field !mt-0">
              List share link
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                inputMode="url"
                autoComplete="off"
              />
            </label>
            <p className="-mt-2 mb-3 text-[12.5px] text-muted">
              In Google Maps: Saved → your list → Share → copy the link. The list must be shared by link.
            </p>
            <button type="submit" className="btn btn-primary" disabled={!link.trim() || !!busy}>
              {busy === "check" ? "Reading the list…" : "Check list"}
            </button>
          </form>

          {error && (
            <p role="alert" className="notice notice-bad mt-3">
              {error}
            </p>
          )}

          {preview && (
            <div className="mt-5">
              <p className="text-[14px] text-muted">
                <b className="text-ink">{preview.title ?? "Your list"}</b>: {preview.added.length} new,{" "}
                {preview.existing.length} already in the trip
                {preview.removed.length ? `, ${preview.removed.length} removed from the list` : ""}.
              </p>

              <section className="mt-3">
                <h3 className="flex items-baseline justify-between text-[20px] font-semibold">
                  New places
                  {preview.added.length > 1 && (
                    <button
                      type="button"
                      className="cursor-pointer font-sans text-[13px] font-bold text-ocean"
                      onClick={() =>
                        setChosen(chosen.size === preview.added.length ? new Set() : new Set(preview.added.map((p) => p.key)))
                      }
                    >
                      {chosen.size === preview.added.length ? "Select none" : "Select all"}
                    </button>
                  )}
                </h3>
                {preview.added.length ? (
                  <ul>
                    {preview.added.map((p) => (
                      <li key={p.key} className="border-t border-line">
                        <label className="flex cursor-pointer items-start gap-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={chosen.has(p.key)}
                            onChange={() => toggle(p.key)}
                            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--ocean)]"
                          />
                          <span className="min-w-0">
                            <span className="block font-bold">{p.name}</span>
                            {p.address && <span className="block text-[12.5px] text-muted">{p.address}</span>}
                            {p.note && <span className="block text-[12.5px] text-muted italic">{p.note}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-muted">Nothing new: everything on the list is already in the trip.</p>
                )}
              </section>

              {preview.removed.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-[20px] font-semibold">Removed from the list</h3>
                  <p className="text-[13px] text-muted">These stay in your trip. Delete them there if you don&apos;t want them.</p>
                  <ul className="mt-1 text-[14px]">
                    {preview.removed.map((r) => (
                      <li key={r.name} className="border-t border-line py-2">
                        {r.name}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {preview.existing.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-[14px] font-bold text-ocean">
                    {preview.existing.length} already in the trip
                  </summary>
                  <ul className="mt-1 text-[13.5px] text-muted">
                    {preview.existing.map((e) => (
                      <li key={`${e.name}-${e.stop}`} className="border-t border-line py-1.5">
                        {e.name}
                        {e.stop !== e.name ? ` (as ${e.stop})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        {preview && preview.added.length > 0 && (
          <div className="flex gap-2 border-t border-line px-5 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]">
            <button type="button" className="btn flex-1" onClick={onClose} disabled={!!busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary flex-1" onClick={apply} disabled={!chosen.size || !!busy}>
              {busy === "apply" ? "Adding…" : `Add ${chosen.size} to Not yet scheduled`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
