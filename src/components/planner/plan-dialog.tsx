"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { acceptPlan, rejectPlan } from "@/app/trips/[tripId]/plan-actions";
import { formatDuration } from "@/lib/trip/drive";
import { dayLabel } from "@/lib/trip/format";
import type { CheckedPlan } from "@/lib/trip/plan";
import { TRAY, type TripData } from "@/lib/trip/types";

type Proposal = CheckedPlan & { id: string; drive: Record<string, number> };
type Props = {
  trip: TripData;
  colourOf: (dayIndex: number) => string;
  onClose: () => void;
  onAccepted: (fresh: TripData, before: TripData) => void;
};

/** "Plan my trip": choose locked days and preferences, let Claude plan, review, accept or reject. */
export function PlanDialog({ trip, colourOf, onClose, onAccepted }: Props) {
  // Days with a ferry or flight start locked; they anchor the trip.
  const [locked, setLocked] = useState<Set<string>>(
    () =>
      new Set(
        trip.days
          .filter((d) => (trip.layout[d.id] ?? []).some((id) => ["ferry", "flight"].includes(trip.stops[id]?.arriveBy)))
          .map((d) => d.id),
      ),
  );
  const [preferences, setPreferences] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const plan = async () => {
    setError(null);
    setProposal(null);
    setBusy(true);
    setStatus("Starting…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`/api/trips/${trip.id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: [...locked], preferences }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't start planning. Try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { t: string; v: unknown };
          if (event.t === "status") setStatus(event.v as string);
          else if (event.t === "proposal") setProposal(event.v as Proposal);
          else if (event.t === "error") setError(event.v as string);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  const accept = async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const r = await acceptPlan(trip.id, proposal.id);
      if (!r.ok) return setError(r.error);
      onAccepted(r.trip, trip);
    } catch {
      setError("Couldn't apply the plan. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (proposal) await rejectPlan(trip.id, proposal.id).catch(() => {});
    setProposal(null);
  };

  const close = () => {
    if (proposal) void rejectPlan(trip.id, proposal.id).catch(() => {});
    onClose();
  };

  const name = (stopId: string) => trip.stops[stopId]?.name ?? "Removed stop";
  const containerOf = (stopId: string) =>
    Object.entries(trip.layout).find(([, ids]) => ids.includes(stopId))?.[0] ?? TRAY;
  const toggleLock = (dayId: string) =>
    setLocked((s) => {
      const next = new Set(s);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  const limitS = trip.maxDriveHours * 3600;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(10,20,22,0.45)]" onClick={() => !busy && close()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[22px] bg-paper min-[640px]:inset-auto min-[640px]:top-1/2 min-[640px]:left-1/2 min-[640px]:w-[720px] min-[640px]:max-w-[calc(100%-32px)] min-[640px]:-translate-x-1/2 min-[640px]:-translate-y-1/2 min-[640px]:rounded-2xl min-[640px]:shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3">
          <div>
            <h2 id="plan-title" className="text-[26px] font-bold">
              Plan my trip
            </h2>
            <p className="text-[13.5px] text-muted">
              Claude arranges your stops into days. You review the plan before anything changes.
            </p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close" className="cursor-pointer px-2 py-1 text-[22px] leading-none text-muted">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!proposal && (
            <>
              <label className="field !mt-0">
                Preferences (optional)
                <textarea
                  rows={3}
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                  disabled={busy}
                  placeholder="e.g. hard 4WD only on solo legs, a rest day after long drives, Salamanca Market is Saturdays only"
                />
              </label>
              <h3 className="mt-2 text-[20px] font-semibold">Days</h3>
              <p className="mb-2 text-[13px] text-muted">Lock days you&apos;re happy with; Claude plans around them.</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {trip.days.map((d, i) => {
                  const n = trip.layout[d.id]?.length ?? 0;
                  return (
                    <li key={d.id}>
                      <label
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-2.5 py-2"
                        style={{ "--legc": colourOf(i) } as CSSProperties}
                      >
                        <input
                          type="checkbox"
                          checked={locked.has(d.id)}
                          onChange={() => toggleLock(d.id)}
                          disabled={busy}
                          className="h-[18px] w-[18px] cursor-pointer accent-[var(--ocean)]"
                        />
                        <b className="w-1 self-stretch rounded-sm bg-[var(--legc)]" />
                        <span className="font-display text-[17px] font-semibold">{dayLabel(d.date)}</span>
                        <span className="ml-auto text-[12.5px] text-muted">
                          {locked.has(d.id) ? "Locked" : `${n} ${n === 1 ? "stop" : "stops"}`}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[13px] text-muted">
                {trip.layout[TRAY]?.length ?? 0} places in Not yet scheduled will be fitted in where they suit.
              </p>
            </>
          )}

          {status && (
            <p className="mt-4 flex items-center gap-2 text-[14px] text-muted" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ocean" aria-hidden="true" />
              {status} This usually takes under a minute.
            </p>
          )}
          {error && (
            <p role="alert" className="notice notice-bad mt-3">
              {error}
            </p>
          )}

          {proposal && (
            <div>
              <p className="text-[15px]">{proposal.summary}</p>
              {proposal.warnings.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {proposal.warnings.map((w) => (
                    <p key={w} className="notice notice-warn">
                      {w}
                    </p>
                  ))}
                </div>
              )}
              <ol className="mt-4 flex flex-col gap-3">
                {trip.days.map((d, i) => {
                  const ids = proposal.layout[d.id] ?? [];
                  const before = trip.layout[d.id] ?? [];
                  const movedOut = before.filter((id) => !ids.includes(id));
                  const s = proposal.drive[d.id] ?? 0;
                  const night = proposal.overnights[d.id];
                  return (
                    <li
                      key={d.id}
                      className="rounded-xl border border-line p-3"
                      style={{ "--legc": colourOf(i) } as CSSProperties}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 border-b-2 border-[var(--legc)] pb-1.5">
                        <span className="font-display text-[20px] font-bold">{dayLabel(d.date)}</span>
                        {locked.has(d.id) && <span className="chip">Locked</span>}
                        <span className={`text-[13px] ${s > limitS ? "font-bold text-warn-ink" : "text-muted"}`}>
                          {s ? `${formatDuration(s)} driving` : "No driving"}
                        </span>
                        {night && <span className="ml-auto text-[13px] text-muted">Overnight {name(night)}</span>}
                      </div>
                      {proposal.notes[d.id] && <p className="mt-1.5 text-[13px] text-muted italic">{proposal.notes[d.id]}</p>}
                      <ol className="mt-1.5 text-[14px]">
                        {ids.map((id, k) => (
                          <li key={id} className="flex gap-2 py-0.5">
                            <span className="w-5 text-right text-muted">{k + 1}.</span>
                            <span>{name(id)}</span>
                            {!before.includes(id) && (
                              <span className="chip chip-ref !py-0">
                                {containerOf(id) === TRAY ? "new" : "moved in"}
                              </span>
                            )}
                          </li>
                        ))}
                        {!ids.length && <li className="text-muted">No stops</li>}
                      </ol>
                      {movedOut.length > 0 && (
                        <p className="mt-1 text-[12.5px] text-muted">Moved out: {movedOut.map(name).join(", ")}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
              {proposal.leftOut.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-[20px] font-semibold">Left in Not yet scheduled</h3>
                  <ul className="text-[14px]">
                    {proposal.leftOut.map((l) => (
                      <li key={l.stopId} className="border-t border-line py-1.5">
                        <b>{name(l.stopId)}</b> <span className="text-muted">— {l.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-line px-5 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]">
          {proposal ? (
            <>
              <button type="button" className="btn flex-1" onClick={reject} disabled={busy}>
                Reject
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={accept} disabled={busy}>
                {busy ? "Applying…" : "Accept plan"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn flex-1" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={plan}
                disabled={busy || locked.size === trip.days.length}
              >
                {busy ? "Planning…" : "Plan my trip"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
