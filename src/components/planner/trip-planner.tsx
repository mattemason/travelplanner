"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  createStop,
  deleteStop,
  rerouteDay,
  saveLayout,
  setOvernight,
  updateStop,
  updateTrip,
  type PlaceRef,
  type TripDetails,
} from "@/app/trips/[tripId]/actions";
import {
  dayRoute,
  overnightOf,
  overnightTravel,
  overnightTravelLabel,
  pairKey,
  type RoutePoint,
} from "@/lib/trip/drive";
import { fuelCost, type Vehicle } from "@/lib/trip/fuel";
import { cleanStay, transportSummary } from "@/lib/trip/details";
import { dateRange, dayCount, dayLabel } from "@/lib/trip/format";
import { changedContainers, containerOf, moveStop } from "@/lib/trip/layout";
import { TRAY, type Layout, type Segment, type Stay, type Stop, type TripData } from "@/lib/trip/types";
import { dayWarnings } from "@/lib/trip/warnings";
import { addLabel, deleteLabel, renameLabel } from "@/app/labels/actions";
import { DaySection, type DayDriveInfo } from "./day-section";
import type { LabelOps } from "./label-pickers";
import { PencilIcon } from "./icons";
import { SortableList } from "./sortable-list";
import { StopCard, type DriveIn } from "./stop-card";
import { StopEditor, type EditorValues } from "./stop-editor";
import { StopInfo } from "./stop-info";
import { googleMapsLink, hipcampLink } from "@/lib/trip/maps-link";
import { TripEditor } from "./trip-editor";
import { MapSearch, ResultCard, type SearchResult } from "./map-search";
import { TripMap, type MapBounds, type MapPoint, type MapRoute } from "./trip-map";
import { TripSummary } from "./trip-summary";
import { legColour, useIsDesktop } from "./use-media";
import { useIsDark } from "@/components/theme";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLayoutPrefs } from "./use-layout-prefs";

type Editor =
  | { mode: "edit"; stopId: string }
  | { mode: "new"; container: string }
  | { mode: "trip"; focus: "trip" | "legs" };
type Deleted = { stop: Stop; container: string; position: number };
type OvernightChange = { dayId: string; placeId: string | null; stay?: Stay };
type Undo = {
  label: string;
  layout?: Layout;
  stop?: Stop;
  createdStopId?: string;
  deleted?: Deleted;
  overnights?: OvernightChange[]; // previous overnights to restore
};
// Segment = drive known; null = asked Google and there's no road route.
type SegCache = Record<string, Segment | null>;

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";
const RESULT_COLOUR = "#6B3FA0"; // search results, distinct from the leg colours

type Labels = { tags: string[]; categories: string[] };

type PlannerProps = { initial: TripData; labels: Labels; vehicle: Vehicle };

export function TripPlanner({ initial, labels: initialLabels, vehicle }: PlannerProps) {
  const [trip, setTrip] = useState(initial);
  const [labels, setLabels] = useState(initialLabels);
  const [segs, setSegs] = useState<SegCache>({});
  const [activeDay, setActiveDay] = useState(0);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<"day" | "trip">("day");
  const [rerouting, setRerouting] = useState<string | null>(null);
  const [infoStop, setInfoStop] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchResult[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState<string | null>(null);
  const [tapped, setTapped] = useState<SearchResult | null>(null); // a Google map icon the user tapped
  const [addedResults, setAddedResults] = useState<Set<string>>(() => new Set());
  const boundsRef = useRef<MapBounds | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const isDesktop = useIsDesktop();
  const [prefs, setPrefs] = useLayoutPrefs();
  const dark = useIsDark();

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
  const nightTravel = (dayIndex: number) => {
    const t = overnightTravel(trip, dayIndex);
    if (!t) return null;
    // Add the sailing/flight times from the arrival stop's travel details, if entered.
    const next = trip.days[dayIndex + 1];
    const arrival = next && trip.stops[(trip.layout[next.id] ?? [])[0]];
    const times = arrival?.transport
      ? transportSummary(
          { departAt: arrival.transport.departAt, arriveAt: arrival.transport.arriveAt, bookingRef: arrival.transport.bookingRef },
          trip.days[dayIndex].date,
        )
      : "";
    return times ? `${overnightTravelLabel(t)} · ${times}` : overnightTravelLabel(t);
  };
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
        if (route[i].arriveBy !== "drive") continue; // ferries and flights aren't routed
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
        let totalM = 0;
        let complete = true;
        let noRoute = 0;
        for (let i = 1; i < route.length; i++) {
          const arriveBy = route[i].arriveBy;
          if (arriveBy !== "drive") {
            if (route[i].stopId) driveIn[route[i].stopId!] = { mode: arriveBy };
            continue;
          }
          const seg = segs[pairKey(route[i - 1], route[i])];
          const d = seg === undefined ? ("loading" as const) : seg === null ? ("none" as const) : seg;
          if (seg) {
            totalS += seg.durationS;
            totalM += seg.distanceM;
          } else if (seg === undefined) complete = false;
          else noRoute++;
          const to = route[i];
          if (to.stopId) driveIn[to.stopId] = d;
          else tail = { to: trip.places[to.placeId]?.name ?? "tonight's stop", drive: d };
        }
        return { driveIn, tail, totalS, totalM, complete, noRoute };
      }),
    [routes, segs, trip.places],
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

  const reroute = async (dayId: string) => {
    const label = containerLabel(dayId);
    setRerouting(dayId);
    try {
      const before = tripRef.current.layout;
      const result = await rerouteDay(tripRef.current.id, dayId);
      if (!result.changed) {
        setToast({ text: result.reason ?? `${label} is already in the fastest order.` });
        return;
      }
      await applyLayout({ ...before, [dayId]: result.order }, { label: `Re-routed ${label}`, layout: before });
    } catch {
      setToast({ text: "Re-route didn't work. Try again.", error: true });
    } finally {
      setRerouting(null);
    }
  };

  /** Copies a stop (same place and details) to just after itself, with undo. */
  const duplicateStop = async (stopId: string) => {
    const original = tripRef.current.stops[stopId];
    const container = containerOf(tripRef.current.layout, stopId);
    if (!original || !container) return;
    try {
      const position = tripRef.current.layout[container]?.length ?? 0;
      const { stop, place } = await createStop(tripRef.current.id, container, position, fieldsOf(original), {
        kind: "existing",
        placeId: original.placeId,
      });
      setTrip((t) => ({
        ...t,
        stops: { ...t.stops, [stop.id]: stop },
        places: { ...t.places, [place.id]: place },
        layout: { ...t.layout, [container]: [...(t.layout[container] ?? []), stop.id] },
      }));
      // It was saved at the end of the day; move it up to sit right after the original.
      const current = { ...tripRef.current.layout, [container]: [...(tripRef.current.layout[container] ?? []), stop.id] };
      tripRef.current = { ...tripRef.current, layout: current };
      const index = current[container].indexOf(stopId) + 1;
      await applyLayout(moveStop(current, stop.id, container, index), null);
      setUndo({ label: `Duplicated ${stop.name}`, createdStopId: stop.id });
      setToast({ text: `Duplicated ${stop.name}` });
    } catch {
      setToast({ text: "Couldn't duplicate that stop. Try again.", error: true });
    }
  };

  const removeFromState = (id: string) =>
    setTrip((t) => {
      const layout = Object.fromEntries(Object.entries(t.layout).map(([k, ids]) => [k, ids.filter((x) => x !== id)]));
      const stops = { ...t.stops };
      delete stops[id];
      return { ...t, layout, stops };
    });

  /** Saves overnight changes and returns the previous values, for undo. */
  const applyOvernights = async (changes: OvernightChange[]): Promise<OvernightChange[]> => {
    const prev: OvernightChange[] = [];
    for (const c of changes) {
      const day = tripRef.current.days.find((d) => d.id === c.dayId);
      const stay = c.placeId ? (c.stay ?? day?.stay ?? {}) : {};
      if (!day || (day.overnightPlaceId === c.placeId && JSON.stringify(day.stay) === JSON.stringify(stay))) continue;
      prev.push({ dayId: c.dayId, placeId: day.overnightPlaceId, stay: day.stay });
      await setOvernight(tripRef.current.id, c.dayId, c.placeId, stay);
      const patch = (d: TripData["days"][number]) =>
        d.id === c.dayId ? { ...d, overnightPlaceId: c.placeId, stay: cleanStay(stay) } : d;
      setTrip((t) => ({ ...t, days: t.days.map(patch) }));
      tripRef.current = { ...tripRef.current, days: tripRef.current.days.map(patch) };
    }
    return prev;
  };

  const fieldsOf = (s: Stop) => ({
    name: s.name,
    time: s.time,
    tags: s.tags,
    categories: s.categories,
    arriveBy: s.arriveBy,
    transport: s.transport,
    notes: s.notes,
    bookingRef: s.bookingRef,
    link: s.link,
  });

  const runUndo = async () => {
    if (!undo) return;
    const entry = undo;
    setUndo(null);
    setToast(null);
    try {
      if (entry.createdStopId) {
        await deleteStop(tripRef.current.id, entry.createdStopId);
        removeFromState(entry.createdStopId);
      }
      if (entry.deleted) {
        // Recreate the deleted stop in its old spot with the same place and details.
        const { stop: old, container, position } = entry.deleted;
        const { stop, place } = await createStop(tripRef.current.id, container, position, fieldsOf(old), {
          kind: "existing",
          placeId: old.placeId,
        });
        const t = tripRef.current;
        const ids = [...(t.layout[container] ?? [])];
        ids.splice(Math.min(position, ids.length), 0, stop.id);
        const next = { ...t.layout, [container]: ids };
        setTrip((x) => ({ ...x, stops: { ...x.stops, [stop.id]: stop }, places: { ...x.places, [place.id]: place } }));
        await applyLayout(next, null);
      }
      if (entry.stop) {
        const s = entry.stop;
        await updateStop(tripRef.current.id, s.id, fieldsOf(s), { kind: "existing", placeId: s.placeId });
        setTrip((t) => ({ ...t, stops: { ...t.stops, [s.id]: s } }));
      }
      if (entry.layout) await applyLayout(entry.layout, null);
      if (entry.overnights) await applyOvernights(entry.overnights);
    } catch {
      setToast({ text: "Undo didn't save. Try again.", error: true });
    }
  };

  // ---- Tags and categories -----------------------------------------------------------------
  const labelOps = (kind: "tag" | "category"): LabelOps => {
    const field = kind === "tag" ? "tags" : "categories";
    // Mirror a rename/delete onto the stops on screen (the server updated the database).
    const rewrite = (fn: (values: string[]) => string[]) =>
      setTrip((t) => ({
        ...t,
        stops: Object.fromEntries(Object.entries(t.stops).map(([id, st]) => [id, { ...st, [field]: fn(st[field]) }])),
      }));
    return {
      add: async (name) => {
        const r = await addLabel(kind, name);
        if (r.ok) setLabels(r.labels);
        return r;
      },
      rename: async (from, to) => {
        const r = await renameLabel(kind, from, to);
        if (r.ok) {
          setLabels(r.labels);
          rewrite((vals) => vals.map((v) => (v === from ? to.trim() : v)));
        }
        return r;
      },
      remove: async (name) => {
        const r = await deleteLabel(kind, name);
        if (r.ok) {
          setLabels(r.labels);
          rewrite((vals) => vals.filter((v) => v !== name));
        }
        return r;
      },
    };
  };

  // ---- Editors ----------------------------------------------------------------------------
  const openEditor = (stopId: string) => {
    setEditorError(null);
    setEditor({ mode: "edit", stopId });
    setSelectedStop(stopId);
  };
  const openNew = (container: string) => {
    setEditorError(null);
    setEditor({ mode: "new", container });
  };
  const openTripEditor = (focus: "trip" | "legs") => {
    setEditorError(null);
    setEditor({ mode: "trip", focus });
  };
  const closeEditor = useCallback(() => {
    setEditor(null);
    setEditorError(null);
  }, []);

  const saveEditor = async (v: EditorValues) => {
    if (!editor || editor.mode === "trip") return;
    setSaving(true);
    setEditorError(null);
    const fields = {
      name: v.name,
      time: v.time,
      tags: v.tags,
      categories: v.categories,
      arriveBy: v.arriveBy,
      transport: v.transport,
      notes: v.notes,
      bookingRef: v.bookingRef,
      link: v.link,
    };
    try {
      if (editor.mode === "new") {
        const ref: PlaceRef = v.picked
          ? { kind: "google", googlePlaceId: v.picked.placeId, session: v.picked.session }
          : { kind: "manual" };
        const position = trip.layout[v.container]?.length ?? 0;
        const { stop, place } = await createStop(trip.id, v.container, position, fields, ref);
        setTrip((t) => ({
          ...t,
          stops: { ...t.stops, [stop.id]: stop },
          places: { ...t.places, [place.id]: place },
          layout: { ...t.layout, [v.container]: [...(t.layout[v.container] ?? []), stop.id] },
        }));
        const overnights =
          v.overnight && v.container !== TRAY
            ? await applyOvernights([{ dayId: v.container, placeId: place.id, stay: v.stay }])
            : [];
        setUndo({ label: `Added ${stop.name}`, createdStopId: stop.id, overnights });
        setToast({ text: `Added ${stop.name}${place.lat === null ? " (no map location)" : ""}` });
      } else {
        const prevStop = trip.stops[editor.stopId];
        const prevLayout = trip.layout;
        const from = containerOf(prevLayout, editor.stopId);
        const ref: PlaceRef | undefined = v.picked
          ? { kind: "google", googlePlaceId: v.picked.placeId, session: v.picked.session }
          : undefined;
        const { stop: saved, place } = await updateStop(trip.id, editor.stopId, fields, ref);
        // Attachments are managed separately; keep the stop's current list.
        setTrip((t) => ({
          ...t,
          stops: { ...t.stops, [saved.id]: { ...saved, attachments: t.stops[saved.id]?.attachments ?? [] } },
          places: { ...t.places, [place.id]: place },
        }));
        if (from !== v.container) {
          await applyLayout(moveStop(prevLayout, saved.id, v.container, Number.MAX_SAFE_INTEGER), null);
        }
        // Overnight: tick sets the (new) day's overnight to this place; unticking, or moving the
        // stop off its day, clears the old day's overnight if it was this stop.
        const fromDay = trip.days.find((d) => d.id === from);
        const wasOvernight = !!fromDay && fromDay.overnightPlaceId === prevStop.placeId;
        const changes: OvernightChange[] = [];
        if (wasOvernight && fromDay && (from !== v.container || !v.overnight)) changes.push({ dayId: fromDay.id, placeId: null });
        if (v.overnight && v.container !== TRAY) changes.push({ dayId: v.container, placeId: place.id, stay: v.stay });
        const overnights = await applyOvernights(changes);
        setUndo({
          label: `Saved ${saved.name}`,
          stop: prevStop,
          layout: from !== v.container ? prevLayout : undefined,
          overnights,
        });
        setToast({ text: `Saved ${saved.name}` });
      }
      closeEditor();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setEditorError(/http|Google Maps/.test(msg) ? msg : "Couldn't save. Try again.");
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

  /** Deletes a stop after asking; Undo in the toast brings it back. */
  const deleteStopById = async (id: string) => {
    const stop = trip.stops[id];
    if (!stop) return;
    const files = stop.attachments.length;
    const warning = files
      ? ` Its ${files} attached ${files === 1 ? "file" : "files"} will be deleted too and can't be restored.`
      : " You can undo straight after.";
    if (!window.confirm(`Delete "${stop.name}"?${warning}`)) return;
    const container = containerOf(trip.layout, id) ?? TRAY;
    const position = trip.layout[container]?.indexOf(id) ?? 0;
    if (editor?.mode === "edit" && editor.stopId === id) closeEditor();
    removeFromState(id);
    try {
      await deleteStop(trip.id, id);
      setUndo({ label: `Deleted ${stop.name}`, deleted: { stop, container, position } });
      setToast({ text: `Deleted ${stop.name}` });
    } catch {
      setTrip((t) => ({
        ...t,
        stops: { ...t.stops, [id]: stop },
        layout: { ...t.layout, [container]: moveStop(t.layout, id, container, position)[container] },
      }));
      setToast({ text: "That delete didn't save. Try again.", error: true });
    }
  };

  const deleteEditing = () => {
    if (editor?.mode === "edit") void deleteStopById(editor.stopId);
  };

  const saveTrip = async (details: TripDetails) => {
    setSaving(true);
    setEditorError(null);
    try {
      const result = await updateTrip(trip.id, details);
      if (!result.ok) {
        setEditorError(result.error);
        return;
      }
      sectionEls.current = [];
      setTrip(result.trip);
      setActiveDay((i) => Math.min(i, result.trip.days.length - 1));
      setUndo(null);
      setToast({ text: "Trip saved" });
      closeEditor();
    } catch {
      setEditorError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
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

  // ---- Map: the day in view, or the whole trip --------------------------------------------
  const routeLines = (dayIndex: number): MapRoute[] => {
    const r = routes[dayIndex] ?? [];
    return r.slice(1).flatMap((to, i): MapRoute[] => {
      if (to.arriveBy !== "drive") {
        // Ferries, flights and walks: a dashed straight line, not a road route.
        return [{ points: [r[i], to], colour: colourOf(dayIndex), dashed: true }];
      }
      const path = segs[pairKey(r[i], to)]?.polyline;
      return path ? [{ path, colour: colourOf(dayIndex) }] : [];
    });
  };
  const route = routes[activeDay] ?? [];
  const activeDayId = trip.days[activeDay]?.id;
  const dayStops = trip.layout[activeDayId ?? ""] ?? [];
  const dayIndexOfPoint = new Map<string, number>(); // map point id → day index, for whole-trip clicks

  let mapPoints: MapPoint[];
  let mapRoutes: MapRoute[];
  if (mapMode === "day") {
    mapPoints = route.map((p) => ({
      id: p.stopId ?? `place-${p.placeId}`,
      lat: p.lat,
      lng: p.lng,
      colour: colourOf(activeDay),
      badge: p.stopId ? String(dayStops.indexOf(p.stopId) + 1) : "•",
      name: p.stopId ? stopLabel(p.stopId) : (placeName(p.placeId) ?? ""),
    }));
    mapRoutes = routeLines(activeDay);
  } else {
    // Whole trip: every route in its leg colour, a dot per stop, and a pin per night's stop
    // showing the date, so the shape of the trip reads at a glance.
    mapPoints = [];
    mapRoutes = trip.days.flatMap((_, i) => routeLines(i));
    const seen = new Set<string>();
    trip.days.forEach((day, i) => {
      const nightId = overnightOf(trip, i);
      const night = nightId ? trip.places[nightId] : null;
      for (const stopId of trip.layout[day.id] ?? []) {
        const stop = trip.stops[stopId];
        const place = trip.places[stop?.placeId ?? ""];
        if (!place || place.lat === null || place.lng === null || place.id === night?.id || seen.has(place.id)) continue;
        seen.add(place.id);
        dayIndexOfPoint.set(stopId, i);
        mapPoints.push({ id: stopId, lat: place.lat, lng: place.lng, colour: colourOf(i), badge: null, name: stop.name });
      }
      if (night && night.lat !== null && night.lng !== null) {
        const id = `night-${day.id}`;
        dayIndexOfPoint.set(id, i);
        mapPoints.push({
          id,
          lat: night.lat,
          lng: night.lng,
          colour: colourOf(i),
          badge: String(new Date(`${day.date}T00:00:00`).getDate()),
          name: `${dayLabel(day.date)}: ${nightTravel(i) ?? night.name}`,
        });
      }
    });
  }

  for (const r of [...(search ?? []), ...(tapped && !search?.some((s) => s.placeId === tapped.placeId) ? [tapped] : [])]) {
    mapPoints.push({ id: `result:${r.placeId}`, lat: r.lat, lng: r.lng, colour: RESULT_COLOUR, badge: null, name: r.name, result: true });
  }

  const getArea = () => {
    const b = boundsRef.current;
    return b ? { low: { lat: b.south, lng: b.west }, high: { lat: b.north, lng: b.east } } : null;
  };

  const addResult = async (r: SearchResult, container: string) => {
    try {
      const position = tripRef.current.layout[container]?.length ?? 0;
      const fields = {
        name: r.name,
        time: null,
        tags: [],
        categories: [],
        arriveBy: "drive" as const,
        transport: {},
        notes: "",
        bookingRef: "",
        link: "",
      };
      const { stop, place } = await createStop(trip.id, container, position, fields, {
        kind: "google",
        googlePlaceId: r.placeId,
      });
      setTrip((t) => ({
        ...t,
        stops: { ...t.stops, [stop.id]: stop },
        places: { ...t.places, [place.id]: place },
        layout: { ...t.layout, [container]: [...(t.layout[container] ?? []), stop.id] },
      }));
      setAddedResults((s) => new Set(s).add(r.placeId));
      setUndo({ label: `Added ${stop.name} to ${containerLabel(container)}`, createdStopId: stop.id });
      setToast({ text: `Added ${stop.name} to ${containerLabel(container)}` });
    } catch {
      setToast({ text: "Couldn't add that place. Try again.", error: true });
    }
  };

  const onSearchResults = (_query: string | null, results: SearchResult[] | null) => {
    setSearch(results);
    setSelectedResult(null);
  };

  const mapSearch = (compact: boolean) => (
    <MapSearch
      tripId={trip.id}
      getArea={getArea}
      results={search}
      onResults={onSearchResults}
      open={searchOpen}
      onOpenChange={setSearchOpen}
      compact={compact}
    />
  );
  const pickedResult =
    search?.find((r) => r.placeId === selectedResult) ?? (tapped?.placeId === selectedResult ? tapped : null);

  const onPlaceClick = async (googlePlaceId: string) => {
    try {
      const res = await fetch(`/api/places/${encodeURIComponent(googlePlaceId)}`);
      const body = (await res.json().catch(() => ({}))) as { result?: SearchResult; error?: string };
      if (!res.ok || !body.result) throw new Error(body.error ?? "Couldn't load that place.");
      setTapped(body.result);
      setSelectedResult(body.result.placeId);
    } catch (err) {
      setToast({ text: (err as Error).message, error: true });
    }
  };
  const resultCard = pickedResult && (
    <ResultCard
      key={pickedResult.placeId}
      result={pickedResult}
      days={trip.days}
      defaultContainer={activeDayId ?? TRAY}
      added={addedResults.has(pickedResult.placeId)}
      onAdd={(container) => addResult(pickedResult, container)}
      onClose={() => {
        setSelectedResult(null);
        setTapped(null);
      }}
    />
  );

  const onMapSelect = (id: string) => {
    if (id.startsWith("result:")) {
      setSelectedResult(id.slice("result:".length));
      return;
    }
    setSelectedStop(id);
    const dayIndex = dayIndexOfPoint.get(id);
    if (mapMode === "trip" && dayIndex !== undefined) goToDay(dayIndex);
  };

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
      overnight={overnightOf(trip, i) ? day.stay.name?.trim() || placeName(overnightOf(trip, i)) : null}
      overnightTravel={nightTravel(i)}
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
      onInfoStop={setInfoStop}
      onDuplicateStop={duplicateStop}
      onDeleteStop={deleteStopById}
      onAddStop={openNew}
      onReroute={reroute}
      rerouting={rerouting === day.id}
      fuelCost={fuelCost(drives[i].totalM, vehicle, trip.fuelPrices)}
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
          onInfo={() => setInfoStop(id)}
          onDuplicate={() => duplicateStop(id)}
          onDelete={() => deleteStopById(id)}
        />
      ))}
    </SortableList>
  );
  const trayCount = trip.layout[TRAY]?.length ?? 0;

  const stopsOnDays = Object.fromEntries(trip.days.map((d) => [d.date, trip.layout[d.id]?.length ?? 0]));
  const variant = isDesktop ? "panel" : "sheet";
  const editorEl =
    editor &&
    (editor.mode === "trip" ? (
      <TripEditor
        key={`trip-${editor.focus}`}
        trip={trip}
        focus={editor.focus}
        variant={variant}
        saving={saving}
        error={editorError}
        stopsOnDays={stopsOnDays}
        onSave={saveTrip}
        onCancel={closeEditor}
        onCoverChange={(coverVersion) => setTrip((t) => ({ ...t, coverVersion }))}
      />
    ) : (
      <StopEditor
        key={editor.mode === "edit" ? editor.stopId : `new-${editor.container}`}
        tripId={trip.id}
        variant={variant}
        isNew={editor.mode === "new"}
        stop={editor.mode === "edit" ? trip.stops[editor.stopId] : null}
        container={editor.mode === "edit" ? (containerOf(trip.layout, editor.stopId) ?? TRAY) : editor.container}
        isOvernight={
          editor.mode === "edit" &&
          trip.days.some(
            (d) => d.overnightPlaceId === trip.stops[editor.stopId]?.placeId && trip.layout[d.id]?.includes(editor.stopId),
          )
        }
        stay={
          editor.mode === "edit"
            ? (trip.days.find(
                (d) => d.overnightPlaceId === trip.stops[editor.stopId]?.placeId && trip.layout[d.id]?.includes(editor.stopId),
              )?.stay ?? {})
            : {}
        }
        days={trip.days}
        labels={labels}
        tagOps={labelOps("tag")}
        categoryOps={labelOps("category")}
        saving={saving}
        error={editorError}
        onSave={saveEditor}
        onCancel={closeEditor}
        onUnschedule={unscheduleEditing}
        onDelete={deleteEditing}
        onAttachmentsChange={(attachments) => {
          if (editor.mode !== "edit") return;
          const id = editor.stopId;
          setTrip((t) => ({ ...t, stops: { ...t.stops, [id]: { ...t.stops[id], attachments } } }));
        }}
      />
    ));

  const map = (className: string, labels: boolean) =>
    MAPS_KEY ? (
      <TripMap
        points={mapPoints}
        routes={mapRoutes}
        dark={dark}
        selectedId={selectedResult ? `result:${selectedResult}` : selectedStop}
        onSelect={onMapSelect}
        onPlaceClick={onPlaceClick}
        onBoundsChanged={(b) => {
          boundsRef.current = b;
        }}
        // Refit when the day, its stops or the view mode change; never for search results.
        fitKey={
          mapMode === "trip"
            ? `trip-${isDesktop}`
            : `${activeDay}-${mapPoints.filter((p) => !p.result).length}-${isDesktop}`
        }
        className={className}
        labels={labels}
      />
    ) : (
      <div className={`grid place-items-center bg-soft text-[13px] text-muted ${className}`}>Map key not set</div>
    );

  const modeSwitch = (
    <div role="group" aria-label="Map shows" className="flex rounded-full bg-paper/95 p-1 shadow">
      {(["day", "trip"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mapMode === m}
          onClick={() => setMapMode(m)}
          className={`min-h-8 cursor-pointer rounded-full px-3 text-[13px] font-bold ${
            mapMode === m ? "bg-ink text-paper" : "text-ink"
          }`}
        >
          {m === "day" ? "This day" : "Whole trip"}
        </button>
      ))}
    </div>
  );

  const summary = (compact: boolean) => (
    <TripSummary
      days={trip.days}
      legs={trip.legs}
      drives={drives}
      fuelFor={(metres) => fuelCost(metres, vehicle, trip.fuelPrices)}
      colourOf={(hex) => legColour(hex, dark)}
      compact={compact}
    />
  );

  const editButton = (label: string, onClick: () => void, className = "") => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[9px] border-[1.5px] border-line bg-paper text-ink hover:border-muted ${className}`}
    >
      <PencilIcon />
    </button>
  );

  const legend = (
    <ul
      className={
        isDesktop ? "text-[13.5px]" : "flex items-center gap-3.5 overflow-x-auto px-[18px] pt-3 pb-1.5 text-[12.5px] text-muted no-scrollbar"
      }
    >
      {trip.legs.map((l) => (
        <li key={l.id} className={`flex items-center gap-2 ${isDesktop ? "py-0.5" : "shrink-0"}`}>
          <i className="inline-block h-[5px] w-4 rounded-sm" style={{ background: legColour(l.colour, dark) }} />
          {l.name}
          <span className={isDesktop ? "ml-auto text-[12.5px] text-muted" : ""}>
            {isDesktop ? dateRange(l.startDate, l.endDate) : `, ${dateRange(l.startDate, l.endDate)}`}
          </span>
        </li>
      ))}
      {!isDesktop && (
        <li className="shrink-0">
          <button type="button" onClick={() => openTripEditor("legs")} className="cursor-pointer font-bold text-ocean">
            Edit legs
          </button>
        </li>
      )}
    </ul>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <ThemeToggle />
      <Link href={`/checklists?trip=${trip.id}`} className="btn">
        Checklists
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
  const title = (size: string) => (
    <div className="flex items-center gap-2">
      {trip.icon && (
        <span className="text-[0.8em] leading-none" aria-hidden="true">
          {trip.icon}
        </span>
      )}
      <h1 className={`${size} font-bold`}>
        <Link href="/" className="hover:underline">
          {trip.name}
        </Link>
      </h1>
      {editButton("Edit trip name and dates", () => openTripEditor("trip"))}
    </div>
  );

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

  const activeLeg = legById[trip.days[activeDay]?.legId ?? ""];

  const body = isDesktop ? (
    <div className="flex h-dvh flex-col">
      {prefs.header && (
        <header className="flex items-center justify-between gap-6 border-b border-line bg-paper px-6 py-3.5">
          <div className="min-w-0">
            {title("text-[34px]")}
            <p className="text-[14px] text-muted">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setPrefs({ header: false })}
              aria-label="Hide top bar"
              title="Hide top bar"
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-muted hover:bg-soft hover:text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
          </div>
        </header>
      )}
      <div
        className={`grid min-h-0 flex-1 ${
          prefs.rail
            ? "grid-cols-[240px_minmax(340px,1fr)_minmax(0,2fr)] xl:grid-cols-[270px_minmax(360px,1fr)_minmax(0,2fr)]"
            : "grid-cols-[minmax(340px,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(380px,1fr)_minmax(0,2.2fr)]"
        }`}
      >
        {prefs.rail && (
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-paper px-4 pt-[18px] pb-10" aria-label="Trip navigation">
          <button
            type="button"
            onClick={() => setPrefs({ rail: false })}
            className="mb-3 flex cursor-pointer items-center gap-1 text-[13px] font-bold text-muted hover:text-ink"
          >
            <span aria-hidden="true">«</span> Hide sidebar
          </button>
          <h2 className="mb-2 flex items-center justify-between text-[19px] font-semibold">
            Legs
            <button
              type="button"
              onClick={() => openTripEditor("legs")}
              className="cursor-pointer rounded-full border-[1.5px] border-line px-2.5 py-0.5 font-sans text-[12.5px] font-bold text-ink hover:border-muted"
            >
              Edit
            </button>
          </h2>
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
                    {nightTravel(i)
                      ? `, ${overnightTravel(trip, i)!.mode === "ferry" ? "⛴ on the ferry" : "✈ overnight flight"}`
                      : placeName(overnightOf(trip, i))
                        ? `, ${placeName(overnightOf(trip, i))}`
                        : ""}
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
        )}

        <main
          ref={planRef}
          className="min-h-0 overflow-y-auto px-5 pb-[60vh]"
          style={{ "--plan-top": !prefs.rail || !prefs.header ? "49px" : "0px" } as CSSProperties}
        >
          {(!prefs.rail || !prefs.header) && (
            <div className="sticky top-0 z-[4] -mx-5 flex flex-wrap items-center gap-2 border-b border-line bg-bg/95 px-5 py-2 backdrop-blur">
              {!prefs.header && (
                <span className="mr-auto flex min-w-0 items-center gap-1.5 font-display text-[20px] font-bold">
                  {trip.icon && <span aria-hidden="true">{trip.icon}</span>}
                  <span className="truncate">{trip.name}</span>
                </span>
              )}
              {!prefs.rail && (
                <button type="button" className="btn !min-h-8 !px-3 !text-[13px]" onClick={() => setPrefs({ rail: true })}>
                  <span aria-hidden="true">»</span> Show sidebar
                </button>
              )}
              {!prefs.header && (
                <button type="button" className="btn !min-h-8 !px-3 !text-[13px]" onClick={() => setPrefs({ header: true })}>
                  Show top bar
                </button>
              )}
            </div>
          )}
          {days}
          <p className="py-8 text-center text-[13.5px] text-muted">End of trip.</p>
        </main>

        <aside className="relative min-h-0 border-l border-line" style={{ "--legc": colourOf(activeDay) } as CSSProperties}>
          {map("h-full w-full", true)}
          <div className="absolute top-3 left-3 flex flex-col items-start gap-2">
            {modeSwitch}
            {mapMode === "trip"
              ? summary(false)
              : trip.days[activeDay] && (
                  <div className="pointer-events-none rounded-xl bg-paper/95 px-3 py-2 shadow">
                    <span className="block text-[12.5px] font-bold text-[var(--legc)]">{activeLeg?.name}</span>
                    <span className="font-display text-[22px] leading-none font-bold">
                      {dayLabel(trip.days[activeDay].date)}
                    </span>
                  </div>
                )}
          </div>
          <div className="absolute top-3 right-3 max-w-[calc(100%-24px)]">{mapSearch(false)}</div>
          {resultCard && <div className="absolute bottom-8 left-3 max-w-[calc(100%-24px)]">{resultCard}</div>}
          {editorEl && (
            <div className="absolute inset-y-0 right-0 z-10 w-[420px] max-w-full overflow-y-auto border-l border-line bg-paper shadow-xl">
              {editorEl}
            </div>
          )}
        </aside>
      </div>
    </div>
  ) : (
    <div className="bg-paper pb-[env(safe-area-inset-bottom)]">
      <header className="px-[18px] pt-[calc(10px+env(safe-area-inset-top))] pb-3">
        {title("text-[32px]")}
        <p className="text-[14px] text-muted">{subtitle}</p>
        <div className="mt-3">{actions}</div>
      </header>
      <div className="relative">
        {map(`${mapMode === "trip" || search ? "h-[320px]" : "h-[220px]"} border-y border-line`, false)}
        <div className="absolute top-2.5 right-2.5">{modeSwitch}</div>
        {!searchOpen && <div className="absolute top-2.5 left-2.5">{mapSearch(true)}</div>}
      </div>
      {(searchOpen || resultCard) && (
        <div className="flex flex-col gap-2 border-b border-line bg-soft px-[18px] py-2.5">
          {searchOpen && mapSearch(true)}
          {resultCard}
        </div>
      )}
      {mapMode === "trip" && <div className="border-b border-line">{summary(true)}</div>}
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
      {infoStop && trip.stops[infoStop] && (
        <StopInfo
          stopId={infoStop}
          stopName={trip.stops[infoStop].name}
          mapsUrl={googleMapsLink(trip.places[trip.stops[infoStop].placeId], trip.stops[infoStop].name)}
          hipcampUrl={hipcampLink(trip.places[trip.stops[infoStop].placeId], trip.stops[infoStop].name)}
          onClose={() => setInfoStop(null)}
        />
      )}
    </APIProvider>
  );
}
