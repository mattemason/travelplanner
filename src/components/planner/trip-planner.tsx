"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createStop, saveLayout, updateStop, deleteStop } from "@/app/trips/[tripId]/actions";
import { dayRoute, pairKey, type RoutePoint } from "@/lib/trip/drive";
import { dateRange, dayCount, dayLabel } from "@/lib/trip/format";
import { changedContainers, containerOf, moveStop } from "@/lib/trip/layout";
import { TRAY, type Layout, type Segment, type Stop, type TripData } from "@/lib/trip/types";
import { dayWarnings } from "@/lib/trip/warnings";
import { DaySection, type DayDriveInfo } from "./day-section";
import { SidePanel } from "./side-panel";
import { SortableList } from "./sortable-list";
import { StopCard, type DriveIn } from "./stop-card";
import { StopEditor, type EditorValues } from "./stop-editor";
import { TripMap, type MapPoint } from "./trip-map";
import { legColour, useIsDesktop, usePrefersDark } from "./use-media";

type Editor = { mode: "edit"; stopId: string } | { mode: "new"; container: string };
type Undo = { label: string; layout?: Layout; stop?: Stop; createdStopId?: string };
// Segment = drive known; null = asked Google and there's no road route.
type SegCache = Record<string, Segment | null>;

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

export function TripPlanner({ initial }: { initial: TripData }) {
  const [trip, setTrip] = useState(initial);
  const [segs, setSegs] = useState<SegCache>({});
  const [activeDay, setActiveDay] = useState(0);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const isDesktop = useIsDesktop();
  const dark = usePrefersDark();

  const tripRef = useRef(trip);
  useEffect(() => {
    tripRef.current = trip;
  });

  const legById = useMemo(() => Object.fromEntries(trip.legs.map((l) => [l.id, l])), [trip.legs]);
  const colourOf = useCallback(
    (dayIndex: number) => legColour(legById[trip.days[dayIndex]?.legId ?? ""]?.colour, dark),
    [legById, trip.days, dark],
  );
  const placeName = (placeId: string | null) => (placeId ? (trip.places[placeId]?.name ?? null) : null);
  const stopLabel = (stopId: string) => trip.stops[stopId]?.name ?? "Stop";
  const containerLabel = (c: string) => {
    if (c === TRAY) return "not yet scheduled";
    const d = trip.days.find((x) => x.id === c);
    return d ? dayLabel(d.date) : "another day";
  };

  // ---- Drive times ------------------------------------------------------------------------
  const routes = useMemo(() => trip.days.map((_, i) => dayRoute(trip, i)), [trip]);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const pairs: [RoutePoint, RoutePoint][] = [];
    for (const route of routes) {
      for (let i = 1; i < route.length; i++) {
        const key = pairKey(route[i - 1], route[i]);
        if (!requested.current.has(key)) {
          requested.current.add(key);
          pairs.push([route[i - 1], route[i]]);
        }
      }
    }
    if (!pairs.length) return;
    const body = JSON.stringify({ pairs: pairs.map(([a, b]) => [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }]) });
    fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(({ segments }: { segments: Record<string, Segment> }) => {
        setSegs((prev) => {
          const next = { ...prev };
          for (const [a, b] of pairs) next[pairKey(a, b)] = segments[pairKey(a, b)] ?? null;
          return next;
        });
      })
      .catch(() => {
        // Let the next change retry these pairs.
        for (const [a, b] of pairs) requested.current.delete(pairKey(a, b));
        setToast({ text: "Couldn't load drive times. They'll retry on your next change.", error: true });
      });
  }, [routes]);

  const drives: DayDriveInfo[] = useMemo(
    () =>
      routes.map((route) => {
        const driveIn: Record<string, DriveIn> = {};
        let tail: DayDriveInfo["tail"] = null;
        let totalS = 0;
        let complete = true;
        for (let i = 1; i < route.length; i++) {
          const key = pairKey(route[i - 1], route[i]);
          const seg = segs[key];
          const d: DriveIn = seg === undefined ? "loading" : seg === null ? "none" : seg;
          if (seg) totalS += seg.durationS;
          else if (seg === undefined) complete = false;
          const to = route[i];
          if (to.stopId) driveIn[to.stopId] = d;
          else tail = { to: placeName(to.placeId) ?? "tonight's stop", drive: d };
        }
        return { driveIn, tail, totalS, complete };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routes, segs],
  );

  const warnings = useMemo(
    () => trip.days.map((d, i) => dayWarnings(trip, d.id, drives[i].complete ? drives[i].totalS : null)),
    [trip, drives],
  );

  // ---- Saving -----------------------------------------------------------------------------
  const persistLayout = useCallback(async (before: Layout, after: Layout) => {
    const changed = changedContainers(before, after);
    if (!changed.length) return;
    await saveLayout(tripRef.current.id, Object.fromEntries(changed.map((c) => [c, after[c] ?? []])));
  }, []);

  const applyLayout = useCallback(
    async (next: Layout, undoEntry: Undo | null) => {
      const before = tripRef.current.layout;
      setTrip((t) => ({ ...t, layout: next }));
      try {
        await persistLayout(before, next);
        if (undoEntry) {
          setUndo(undoEntry);
          setToast({ text: undoEntry.label });
        }
      } catch {
        setTrip((t) => ({ ...t, layout: before }));
        setToast({ text: "That change didn't save. Check your connection and try again.", error: true });
      }
    },
    [persistLayout],
  );

  const onMove = useCallback(
    (stopId: string, to: string, index: number) => {
      const before = tripRef.current.layout;
      const next = moveStop(before, stopId, to, index);
      const from = containerOf(before, stopId);
      const label =
        from === to ? `Reordered ${stopLabel(stopId)}` : `Moved ${stopLabel(stopId)} to ${containerLabel(to)}`;
      void applyLayout(next, { label, layout: before });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyLayout, trip.stops, trip.days],
  );

  const runUndo = async () => {
    if (!undo) return;
    const entry = undo;
    setUndo(null);
    setToast(null);
    try {
      if (entry.createdStopId) {
        const id = entry.createdStopId;
        await deleteStop(tripRef.current.id, id);
        setTrip((t) => {
          const layout = Object.fromEntries(Object.entries(t.layout).map(([k, ids]) => [k, ids.filter((x) => x !== id)]));
          const stops = { ...t.stops };
          delete stops[id];
          return { ...t, layout, stops };
        });
      }
      if (entry.stop) {
        const s = entry.stop;
        await updateStop(tripRef.current.id, s.id, {
          name: s.name,
          time: s.time,
          tags: s.tags,
          notes: s.notes,
          bookingRef: s.bookingRef,
          link: s.link,
        });
        setTrip((t) => ({ ...t, stops: { ...t.stops, [s.id]: s } }));
      }
      if (entry.layout) await applyLayout(entry.layout, null);
    } catch {
      setToast({ text: "Undo didn't save. Try again.", error: true });
    }
  };

  // ---- Editor -----------------------------------------------------------------------------
  const openEditor = (stopId: string) => {
    setEditorError(null);
    setEditor({ mode: "edit", stopId });
    setSelectedStop(stopId);
  };
  const openNew = (container: string) => {
    setEditorError(null);
    setEditor({ mode: "new", container });
  };
  const closeEditor = useCallback(() => {
    setEditor(null);
    setEditorError(null);
  }, []);

  const saveEditor = async (v: EditorValues) => {
    if (!editor) return;
    setSaving(true);
    setEditorError(null);
    const fields = { name: v.name, time: v.time, tags: v.tags, notes: v.notes, bookingRef: v.bookingRef, link: v.link };
    try {
      if (editor.mode === "new") {
        const position = trip.layout[v.container]?.length ?? 0;
        const { stop, place } = await createStop(trip.id, v.container, position, fields);
        setTrip((t) => ({
          ...t,
          stops: { ...t.stops, [stop.id]: stop },
          places: { ...t.places, [place.id]: place },
          layout: { ...t.layout, [v.container]: [...(t.layout[v.container] ?? []), stop.id] },
        }));
        setUndo({ label: `Added ${stop.name}`, createdStopId: stop.id });
        setToast({ text: `Added ${stop.name}${place.lat === null ? " (not found on Google Maps)" : ""}` });
      } else {
        const prevStop = trip.stops[editor.stopId];
        const prevLayout = trip.layout;
        const from = containerOf(prevLayout, editor.stopId);
        const saved = await updateStop(trip.id, editor.stopId, fields);
        setTrip((t) => ({ ...t, stops: { ...t.stops, [saved.id]: saved } }));
        if (from !== v.container) {
          const next = moveStop(prevLayout, saved.id, v.container, Number.MAX_SAFE_INTEGER);
          await applyLayout(next, null);
        }
        setUndo({ label: `Saved ${saved.name}`, stop: prevStop, layout: from !== v.container ? prevLayout : undefined });
        setToast({ text: `Saved ${saved.name}` });
      }
      closeEditor();
    } catch (err) {
      setEditorError(err instanceof Error && err.message.includes("http") ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const unscheduleEditing = () => {
    if (editor?.mode !== "edit") return;
    const id = editor.stopId;
    closeEditor();
    onMove(id, TRAY, Number.MAX_SAFE_INTEGER);
  };

  useEffect(() => {
    if (!toast || toast.error) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Scroll spy -------------------------------------------------------------------------
  const planRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const target: HTMLElement | Window = isDesktop && planRef.current ? planRef.current : window;
    const spy = () => {
      const line = isDesktop
        ? (planRef.current?.getBoundingClientRect().top ?? 0) + 80
        : (stripRef.current?.getBoundingClientRect().bottom ?? 0) + 8;
      let current = 0;
      sectionEls.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= line) current = i;
      });
      setActiveDay(current);
    };
    spy();
    target.addEventListener("scroll", spy, { passive: true });
    return () => target.removeEventListener("scroll", spy);
  }, [isDesktop]);

  // Keep the mobile day strip's active chip in view.
  useEffect(() => {
    const chip = stripRef.current?.querySelector<HTMLElement>(`[data-strip-index="${activeDay}"]`);
    chip?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeDay]);

  const goToDay = (i: number) => sectionEls.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ---- Map for the day in view ------------------------------------------------------------
  const route = routes[activeDay] ?? [];
  const dayStops = trip.layout[trip.days[activeDay]?.id] ?? [];
  const mapPoints: MapPoint[] = route.map((p) => ({
    id: p.stopId ?? `place-${p.placeId}`,
    lat: p.lat,
    lng: p.lng,
    number: p.stopId ? dayStops.indexOf(p.stopId) + 1 : null,
    name: p.stopId ? stopLabel(p.stopId) : (placeName(p.placeId) ?? ""),
  }));
  const mapRoutes = route
    .slice(1)
    .map((to, i) => segs[pairKey(route[i], to)]?.polyline)
    .filter((x): x is string => !!x);

  const selectStop = (stopId: string, dayIndex: number) => {
    setSelectedStop(stopId);
    if (dayIndex !== activeDay) setActiveDay(dayIndex);
  };

  // ---- Render -----------------------------------------------------------------------------
  const days = trip.days.map((day, i) => (
    <DaySection
      key={day.id}
      tripId={trip.id}
      day={day}
      index={i}
      leg={legById[day.legId ?? ""]}
      colour={colourOf(i)}
      stops={(trip.layout[day.id] ?? []).map((id) => trip.stops[id]).filter(Boolean)}
      places={trip.places}
      overnight={placeName(day.overnightPlaceId)}
      drive={drives[i]}
      warnings={warnings[i]}
      selectedStopId={selectedStop}
      editingStopId={editor?.mode === "edit" ? editor.stopId : null}
      compact={!isDesktop}
      sectionRef={(el) => {
        sectionEls.current[i] = el;
      }}
      onMove={onMove}
      onSelectStop={selectStop}
      onEditStop={openEditor}
      onAddStop={openNew}
    />
  ));

  const tray = (
    <SortableList container={TRAY} onMove={onMove} className="tray-list">
      {(trip.layout[TRAY] ?? []).map((id) => (
        <StopCard
          key={id}
          stop={trip.stops[id]}
          place={trip.places[trip.stops[id].placeId]}
          number={null}
          selected={selectedStop === id}
          editing={editor?.mode === "edit" && editor.stopId === id}
          compact
          onSelect={() => setSelectedStop(id)}
          onEdit={() => openEditor(id)}
        />
      ))}
    </SortableList>
  );
  const trayCount = trip.layout[TRAY]?.length ?? 0;

  const editorEl = editor && (
    <StopEditor
      key={editor.mode === "edit" ? editor.stopId : `new-${editor.container}`}
      variant={isDesktop ? "panel" : "sheet"}
      isNew={editor.mode === "new"}
      stop={editor.mode === "edit" ? trip.stops[editor.stopId] : null}
      container={editor.mode === "edit" ? (containerOf(trip.layout, editor.stopId) ?? TRAY) : editor.container}
      days={trip.days}
      saving={saving}
      error={editorError}
      onSave={saveEditor}
      onCancel={closeEditor}
      onUnschedule={unscheduleEditing}
    />
  );

  const map = (className: string, labels: boolean) =>
    MAPS_KEY ? (
      <TripMap
        points={mapPoints}
        routes={mapRoutes}
        colour={colourOf(activeDay)}
        selectedId={selectedStop}
        onSelect={setSelectedStop}
        fitKey={`${activeDay}-${mapPoints.length}`}
        className={className}
        labels={labels}
      />
    ) : (
      <div className={`grid place-items-center bg-soft text-[13px] text-muted ${className}`}>Map key not set</div>
    );

  const legend = (
    <ul className={isDesktop ? "text-[13.5px]" : "flex gap-3.5 overflow-x-auto px-[18px] pt-3 pb-1.5 text-[12.5px] text-muted no-scrollbar"}>
      {trip.legs.map((l) => (
        <li key={l.id} className={`flex items-center gap-2 ${isDesktop ? "py-0.5" : "shrink-0"}`}>
          <i className="inline-block h-[5px] w-4 rounded-sm" style={{ background: legColour(l.colour, dark) }} />
          {l.name}
          <span className={isDesktop ? "ml-auto text-[12.5px] text-muted" : ""}>
            {isDesktop ? dateRange(l.startDate, l.endDate) : `, ${dateRange(l.startDate, l.endDate)}`}
          </span>
        </li>
      ))}
    </ul>
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Link href={`/trips/${trip.id}/checklist`} className="btn">
        Checklist
      </Link>
      <button type="button" className="btn" disabled title="Coming in Phase 2">
        {isDesktop ? "Sync from Google" : "Sync"}
      </button>
      <button type="button" className="btn" disabled title="Coming in Phase 4">
        Share
      </button>
      <button type="button" className="btn btn-primary" disabled title="Coming in Phase 3">
        Build plan
      </button>
    </div>
  );

  const subtitle = `${dateRange(trip.startDate, trip.endDate)} ${trip.endDate.slice(0, 4)}, ${dayCount(trip.startDate, trip.endDate)} days`;

  const toastEl = toast && (
    <div
      role="status"
      className={`fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2.5 text-[14px] shadow-lg ${
        toast.error ? "bg-bad-bg text-bad-ink" : "bg-ink text-paper"
      }`}
    >
      <span className="truncate">{toast.text}</span>
      {undo && !toast.error && (
        <button type="button" className="cursor-pointer font-bold underline" onClick={runUndo}>
          Undo
        </button>
      )}
      <button type="button" aria-label="Dismiss" className="cursor-pointer opacity-70" onClick={() => setToast(null)}>
        ×
      </button>
    </div>
  );

  const body = isDesktop ? (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-line bg-paper px-6 py-3.5">
        <div className="min-w-0">
          <h1 className="text-[34px] font-bold">
            <Link href="/" className="hover:underline">
              {trip.name}
            </Link>
          </h1>
          <p className="text-[14px] text-muted">{subtitle}</p>
        </div>
        {actions}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_340px] xl:grid-cols-[270px_minmax(0,1fr)_400px]">
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-paper px-4 pt-[18px] pb-10" aria-label="Trip navigation">
          <h2 className="mb-2 text-[19px] font-semibold">Legs</h2>
          {legend}
          <h2 className="mt-[22px] mb-2 text-[19px] font-semibold">Days</h2>
          <nav className="flex flex-col gap-0.5" aria-label="Jump to day">
            {trip.days.map((d, i) => {
              const n = trip.layout[d.id]?.length ?? 0;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => goToDay(i)}
                  aria-current={i === activeDay}
                  style={{ "--legc": colourOf(i) } as CSSProperties}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-soft ${
                    i === activeDay ? "bg-soft shadow-[inset_0_0_0_1.5px_var(--legc)]" : ""
                  }`}
                >
                  <b className="w-1 self-stretch rounded-sm bg-[var(--legc)]" />
                  <span className="w-[76px] shrink-0 font-display text-[17px] font-semibold">{dayLabel(d.date)}</span>
                  <small className="truncate text-[12.5px] text-muted">
                    {n} {n === 1 ? "stop" : "stops"}
                    {placeName(d.overnightPlaceId) ? `, ${placeName(d.overnightPlaceId)}` : ""}
                  </small>
                </button>
              );
            })}
          </nav>
          <h2 className="mt-[22px] mb-2 flex items-baseline justify-between text-[19px] font-semibold">
            Not yet scheduled
            <small className="font-sans text-[12.5px] font-normal text-muted">{trayCount ? `${trayCount} places` : ""}</small>
          </h2>
          {tray}
          <button type="button" className="btn btn-quiet mt-1" onClick={() => openNew(TRAY)}>
            Add a place
          </button>
        </aside>

        <main ref={planRef} className="min-h-0 overflow-y-auto px-8 pb-[60vh]">
          <div className="mx-auto max-w-[760px]">
            {days}
            <p className="py-8 text-center text-[13.5px] text-muted">End of trip.</p>
          </div>
        </main>

        <aside
          className="min-h-0 overflow-y-auto border-l border-line bg-paper"
          style={{ "--legc": colourOf(activeDay) } as CSSProperties}
        >
          {editorEl ?? (
            <>
              {map("h-[290px] border-b border-line", true)}
              <SidePanel
                tripId={trip.id}
                day={trip.days[activeDay]}
                leg={legById[trip.days[activeDay]?.legId ?? ""]}
                stopCount={dayStops.length}
                overnight={placeName(trip.days[activeDay]?.overnightPlaceId ?? null)}
                driveS={drives[activeDay]?.totalS ?? 0}
                driveComplete={drives[activeDay]?.complete ?? true}
                warnings={warnings[activeDay] ?? []}
                checklist={trip.checklist}
              />
            </>
          )}
        </aside>
      </div>
    </div>
  ) : (
    <div className="bg-paper pb-[env(safe-area-inset-bottom)]">
      <header className="px-[18px] pt-[calc(10px+env(safe-area-inset-top))] pb-3">
        <h1 className="text-[32px] font-bold">
          <Link href="/">{trip.name}</Link>
        </h1>
        <p className="text-[14px] text-muted">{subtitle}</p>
        <div className="mt-3">{actions}</div>
      </header>
      {map("h-[220px] border-y border-line", false)}
      <div ref={stripRef} className="sticky top-0 z-10 border-b border-line bg-paper">
        {legend}
        <div className="flex gap-1.5 overflow-x-auto px-[18px] pt-1.5 pb-3 no-scrollbar" role="group" aria-label="Jump to day">
          {trip.days.map((d, i) => {
            const date = new Date(`${d.date}T00:00:00`);
            return (
              <button
                key={d.id}
                type="button"
                data-strip-index={i}
                onClick={() => goToDay(i)}
                aria-pressed={i === activeDay}
                aria-label={`Jump to ${dayLabel(d.date)}`}
                style={{ "--legc": colourOf(i) } as CSSProperties}
                className={`w-[52px] shrink-0 cursor-pointer overflow-hidden rounded-xl border-[1.5px] bg-paper pb-1.5 text-center ${
                  i === activeDay ? "border-[var(--legc)] shadow-[inset_0_0_0_1.5px_var(--legc)]" : "border-line"
                }`}
              >
                <b className="block h-[5px] bg-[var(--legc)]" />
                <small className="mt-[5px] block text-[11px] text-muted">
                  {date.toLocaleDateString("en-AU", { weekday: "short" })}
                </small>
                <em className="block font-display text-[22px] leading-[1.05] font-bold not-italic">{date.getDate()}</em>
              </button>
            );
          })}
        </div>
      </div>
      {days}
      <section className="px-[18px] pt-6 pb-2" aria-labelledby="tray-heading">
        <h2 id="tray-heading" className="mb-2 border-b-2 border-line pb-2 text-[22px] font-bold">
          Not yet scheduled <small className="font-sans text-[13px] font-normal text-muted">{trayCount || ""}</small>
        </h2>
        {tray}
        <button type="button" className="btn btn-quiet mt-1" onClick={() => openNew(TRAY)}>
          Add a place
        </button>
      </section>
      <p className="px-[18px] pt-6 pb-40 text-center text-[13px] text-muted">End of trip.</p>
      {editorEl}
    </div>
  );

  return (
    <APIProvider apiKey={MAPS_KEY} language="en-AU" region="AU">
      {body}
      {toastEl}
    </APIProvider>
  );
}
