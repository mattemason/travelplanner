"use client";

import { AdvancedMarker, AdvancedMarkerAnchorPoint, APIProvider, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsDark } from "@/components/theme";
import { navigateTo } from "@/lib/trip/maps-link";
import { formatDuration } from "@/lib/trip/drive";
import { timeLabel } from "@/lib/trip/format";
import {
  distanceM,
  locate,
  prompt,
  routeShape,
  shortDistance,
  type Directions,
  type Progress,
} from "@/lib/trip/navigation";
import { arriveByLabel, type ArriveBy, type LatLng } from "@/lib/trip/types";

export type DriveTarget = LatLng & { id: string; name: string; arriveBy: ArriveBy; badge: string };
type Props = {
  tripId: string;
  dayTitle: string;
  colour: string;
  origin: (LatLng & { name: string }) | null; // where the day starts, when that isn't a stop
  targets: DriveTarget[];
};
type Fix = LatLng & { accuracy: number; heading: number | null };
type Leg = Directions | "loading" | "error" | null; // null: no road route

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
const ARRIVE_M = 80; // this close to a stop counts as arrived
const REROUTE_GAP_MS = 20_000;

/** Drive mode: today's stops one after another, with your position, the next turn and spoken prompts. */
export function DriveMode(props: Props) {
  const { tripId, dayTitle, colour, origin, targets } = props;
  const dark = useIsDark();
  const [started, setStarted] = useState(false);
  const [target, setTarget] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [legs, setLegs] = useState<Record<number, Leg>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [following, setFollowing] = useState(true);
  const [voice, setVoice] = useState(true);
  const [showStops, setShowStops] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const current = targets[target];
  const leg = legs[target];
  const dir = leg && typeof leg === "object" ? leg : null;
  const shape = useMemo(() => (dir ? routeShape(dir.steps) : null), [dir]);

  // Everything the GPS callback needs, kept current without re-subscribing to the GPS.
  const live = useRef({ target, arrived, dir, shape, voice, legs, current });
  useEffect(() => {
    live.current = { target, arrived, dir, shape, voice, legs, current };
  });
  const said = useRef(new Set<string>());
  const stepRef = useRef(0);
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const routeGen = useRef(0);

  const speak = (text: string) => {
    if (!live.current.voice || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-AU";
    const v = speechSynthesis.getVoices().find((x) => x.lang === "en-AU") ?? speechSynthesis.getVoices().find((x) => x.lang.startsWith("en"));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  };

  const fetchLeg = async (i: number, from: LatLng): Promise<Leg> => {
    const to = targets[i];
    try {
      const res = await fetch("/api/drive/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng } }),
      });
      if (!res.ok) return "error";
      return ((await res.json()) as { directions: Directions | null }).directions;
    } catch {
      return "error";
    }
  };

  /** Fresh directions from where you are to the current stop. */
  const reroute = async (from: LatLng) => {
    const i = live.current.target;
    lastReroute.current = Date.now();
    offCount.current = 0;
    const fresh = await fetchLeg(i, from);
    if (fresh === "error") return; // keep the old route (likely no signal)
    routeGen.current++;
    stepRef.current = 0;
    setLegs((l) => ({ ...l, [i]: fresh }));
  };

  /** Each GPS fix: arrival, progress along the route, going off route, and what to say. */
  const onFix = (f: Fix) => {
    setFix(f);
    setNow(Date.now());
    const { target: i, arrived: done, dir: d, shape: sh, current: t, legs: ls } = live.current;
    if (!t || done) return;
    if (distanceM(f, t) < ARRIVE_M) {
      setArrived(true);
      setProgress(null);
      speak(`You've arrived at ${t.name}.`);
      return;
    }
    if (t.arriveBy !== "drive") return;
    if (!d || !sh) {
      // No route yet (or it failed with no signal): try from here, now and then.
      if (ls[i] !== "loading" && Date.now() - lastReroute.current > REROUTE_GAP_MS) void reroute(f);
      return;
    }
    const p = locate(d.steps, sh, f, stepRef.current);
    if (!p) return;
    stepRef.current = p.step;
    setProgress(p);
    if (p.offRouteM > Math.max(60, f.accuracy)) {
      offCount.current++;
      if (offCount.current >= 3 && Date.now() - lastReroute.current > REROUTE_GAP_MS && navigator.onLine) {
        speak("Recalculating.");
        void reroute(f);
      }
      return;
    }
    offCount.current = 0;
    const stepLen = sh.lengths[p.step].at(-1) ?? 0;
    const text = prompt(d.steps[p.step + 1], p.toTurnM, stepLen, said.current, `${i}-${routeGen.current}-${p.step}`);
    if (text) speak(text);
  };
  const onFixRef = useRef(onFix);
  useEffect(() => {
    onFixRef.current = onFix;
  });

  // GPS and keeping the screen awake, once started.
  useEffect(() => {
    if (!started) return;
    let lock: WakeLockSentinel | null = null;
    const wake = () => {
      if (document.visibilityState === "visible" && "wakeLock" in navigator) {
        navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
      }
    };
    wake();
    document.addEventListener("visibilitychange", wake);
    const watch = navigator.geolocation?.watchPosition(
      (p) => {
        setGeoError(null);
        onFixRef.current({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: p.coords.heading,
        });
      },
      (e) =>
        setGeoError(
          e.code === e.PERMISSION_DENIED
            ? "Location is blocked. Allow it for this site in Settings › Safari › Location."
            : "Can't find your location yet.",
        ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
    return () => {
      document.removeEventListener("visibilitychange", wake);
      void lock?.release();
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
    };
  }, [started]);

  // Load the day's planned legs up front, so drive mode still has them when the signal drops.
  const prefetched = useRef(false);
  const start = () => {
    setStarted(true);
    speak(`Drive mode on. Heading to ${current?.name ?? "your first stop"}.`);
    if (prefetched.current) return;
    prefetched.current = true;
    void (async () => {
      for (let i = target; i < targets.length; i++) {
        const from = i === 0 ? origin : targets[i - 1];
        if (!from || targets[i].arriveBy !== "drive") continue;
        setLegs((l) => (l[i] ? l : { ...l, [i]: "loading" }));
        const got = await fetchLeg(i, from);
        setLegs((l) => (l[i] && l[i] !== "loading" ? l : { ...l, [i]: got }));
      }
    })();
  };

  const goTo = (i: number) => {
    if (i < 0 || i >= targets.length) return;
    setTarget(i);
    setArrived(false);
    setProgress(null);
    setShowStops(false);
    stepRef.current = 0;
    offCount.current = 0;
    lastReroute.current = 0;
    speak(`Heading to ${targets[i].name}.`);
  };

  const next = targets[target + 1];
  const remainingM = progress?.remainingM ?? dir?.distanceM ?? null;
  const remainingS = progress?.remainingS ?? dir?.durationS ?? null;
  const step = dir && progress ? dir.steps[progress.step + 1] : undefined;
  const after = dir && progress ? dir.steps[progress.step + 2] : undefined;
  const offRoute = !!progress && !!fix && progress.offRouteM > Math.max(60, fix.accuracy);
  const etaLabel =
    remainingS !== null ? timeLabel(new Date(now + remainingS * 1000).toTimeString().slice(0, 5)) : null;

  if (!MAPS_KEY) return <p className="p-6">Maps aren&apos;t set up.</p>;

  return (
    <APIProvider apiKey={MAPS_KEY} language="en-AU" region="AU">
      <div className="fixed inset-0 bg-paper">
        <Map
          key={dark ? "dark" : "light"}
          mapId={MAP_ID}
          colorScheme={dark ? "DARK" : "LIGHT"}
          defaultCenter={current ?? origin ?? { lat: -42, lng: 146.6 }}
          defaultZoom={13}
          disableDefaultUI
          zoomControl
          gestureHandling="greedy"
          clickableIcons={false}
          onDragstart={() => setFollowing(false)}
          className="h-full w-full"
        >
          {/* Later planned legs, faint; the leg you're on, bold with an outline. */}
          {Object.entries(legs).map(([k, l]) =>
            Number(k) > target && l && typeof l === "object" ? (
              <Polyline key={`p${k}`} encodedPath={l.polyline} strokeColor={colour} strokeOpacity={0.45} strokeWeight={4} />
            ) : null,
          )}
          {dir && (
            <>
              <Polyline key={`o${target}-${dir.polyline.slice(0, 24)}`} encodedPath={dir.polyline} strokeColor="#ffffff" strokeWeight={13} strokeOpacity={0.95} zIndex={1} />
              <Polyline key={`r${target}-${dir.polyline.slice(0, 24)}`} encodedPath={dir.polyline} strokeColor={colour} strokeWeight={8} zIndex={2} />
            </>
          )}
          {targets.map((t, i) => (
            <AdvancedMarker key={t.id} position={t} zIndex={i === target ? 20 : 5} anchorPoint={AdvancedMarkerAnchorPoint.CENTER} onClick={() => goTo(i)}>
              <span
                className="grid place-items-center rounded-full border-[3px] bg-paper font-bold text-ink shadow"
                style={{ borderColor: colour, width: i === target ? 34 : 26, height: i === target ? 34 : 26, fontSize: 13, opacity: i < target ? 0.5 : 1 }}
              >
                {t.badge}
              </span>
            </AdvancedMarker>
          ))}
          {fix && (
            <AdvancedMarker position={fix} zIndex={30} anchorPoint={AdvancedMarkerAnchorPoint.CENTER}>
              <span className="relative grid h-6 w-6 place-items-center">
                {fix.heading !== null && !Number.isNaN(fix.heading) && (
                  <span
                    className="absolute -top-3 h-0 w-0 border-x-[7px] border-b-[12px] border-x-transparent border-b-[#1a73e8]"
                    style={{ transform: `rotate(${fix.heading}deg)`, transformOrigin: "50% 24px" }}
                  />
                )}
                <span className="h-5 w-5 rounded-full border-[3px] border-white bg-[#1a73e8] shadow-[0_0_0_6px_rgba(26,115,232,0.25)]" />
              </span>
            </AdvancedMarker>
          )}
          <Follow to={following ? fix : null} />
        </Map>

        {/* Top: the next turn, or what's happening. */}
        <div className="pointer-events-none absolute top-[calc(12px+env(safe-area-inset-top))] right-3 left-3 flex justify-center">
          <div className="pointer-events-auto w-full max-w-[640px] rounded-2xl bg-ink p-4 text-paper shadow-2xl">
            {!started ? (
              <p className="text-[18px] font-semibold">Drive mode · {dayTitle}</p>
            ) : arrived ? (
              <div>
                <p className="text-[24px] font-bold">Arrived at {current?.name}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {next ? (
                    <button type="button" className="btn btn-primary" onClick={() => goTo(target + 1)}>
                      Continue to {next.name}
                    </button>
                  ) : (
                    <p className="text-[16px] opacity-90">That&apos;s the last stop for today.</p>
                  )}
                </div>
              </div>
            ) : current && current.arriveBy !== "drive" ? (
              <div>
                <p className="text-[22px] font-bold">
                  {arriveByLabel(current.arriveBy)} to {current.name}
                </p>
                <p className="mt-1 opacity-85">No driving directions for this part.</p>
                <button type="button" className="btn btn-primary mt-3" onClick={() => setArrived(true)}>
                  I&apos;ve arrived
                </button>
              </div>
            ) : geoError && !fix ? (
              <p className="text-[18px]">{geoError}</p>
            ) : !fix ? (
              <p className="text-[18px]">Finding your location…</p>
            ) : offRoute ? (
              <p className="text-[22px] font-bold">Off route · recalculating when there&apos;s signal…</p>
            ) : step && progress ? (
              <div className="flex items-center gap-4">
                <ManeuverIcon maneuver={step.maneuver} />
                <div className="min-w-0">
                  <p className="font-display text-[40px] leading-none font-bold">{shortDistance(progress.toTurnM)}</p>
                  <p className="mt-1 text-[20px] leading-snug font-semibold">{step.instruction}</p>
                  {after && progress.toTurnM < 1500 && after.instruction && (
                    <p className="mt-1 text-[14px] opacity-75">Then {after.instruction.charAt(0).toLowerCase() + after.instruction.slice(1)}</p>
                  )}
                </div>
              </div>
            ) : progress ? (
              <p className="text-[22px] font-bold">
                {shortDistance(progress.toTurnM)} to {current?.name}
              </p>
            ) : leg === "loading" ? (
              <p className="text-[18px]">Getting directions…</p>
            ) : leg === null ? (
              <p className="text-[18px]">Google has no road route to {current?.name}. Open it in Google Maps or follow the map.</p>
            ) : (
              <p className="text-[18px]">Directions will load when there&apos;s signal.</p>
            )}
          </div>
        </div>

        {/* Bottom: where you're heading, and controls. */}
        <div className="absolute right-3 bottom-[calc(12px+env(safe-area-inset-bottom))] left-3 flex justify-center">
          <div className="w-full max-w-[640px] rounded-2xl bg-paper p-3 shadow-2xl">
            {started ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-bold">
                    {current ? `${current.badge}. ${current.name}` : "No stops today"}
                  </p>
                  <p className="text-[14px] text-muted">
                    {remainingM !== null && `${shortDistance(remainingM)}`}
                    {remainingS !== null && ` · ${formatDuration(remainingS)}`}
                    {etaLabel && ` · arrive ${etaLabel}`}
                    {fix && fix.accuracy > 200 && " · location is rough"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!following && fix && (
                    <button type="button" className="btn" onClick={() => setFollowing(true)}>
                      Re-centre
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => setVoice((v) => !v)} aria-pressed={voice}>
                    {voice ? "🔊 Voice on" : "🔇 Voice off"}
                  </button>
                  <button type="button" className="btn" onClick={() => setShowStops((s) => !s)} aria-expanded={showStops}>
                    Stops
                  </button>
                  {current && (
                    <a className="btn" href={navigateTo(current)} target="_blank" rel="noopener noreferrer">
                      Google Maps
                    </a>
                  )}
                  <Link className="btn btn-quiet" href={`/trips/${tripId}`}>
                    Exit
                  </Link>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[15px]">
                  {targets.length} {targets.length === 1 ? "stop" : "stops"} today, starting with <b>{current?.name ?? "nothing yet"}</b>.
                </p>
                <ul className="mt-2 list-disc pl-5 text-[13.5px] text-muted">
                  <li>Keep this screen open: the iPad stops sharing your location when it locks or you switch apps.</li>
                  <li>A Wi-Fi-only iPad has no GPS, so your position may be rough. Cellular iPads (or a phone hotspot) work best.</li>
                  <li>The day&apos;s directions load now, so they&apos;re still here if you lose signal.</li>
                </ul>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn btn-primary flex-1" onClick={start} disabled={!targets.length}>
                    Start driving
                  </button>
                  <Link className="btn" href={`/trips/${tripId}`}>
                    Back
                  </Link>
                </div>
              </div>
            )}
            {started && showStops && (
              <ol className="mt-3 max-h-[40dvh] overflow-y-auto border-t border-line pt-2">
                {targets.map((t, i) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => goTo(i)}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left ${i === target ? "bg-soft font-bold" : i < target ? "text-muted" : ""}`}
                    >
                      <span className="w-6 text-right">{t.badge}</span>
                      <span className="flex-1 truncate">{t.name}</span>
                      <span className="text-[12.5px] text-muted">{i < target ? "Done" : i === target ? "Now" : t.arriveBy === "drive" ? "" : arriveByLabel(t.arriveBy)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </APIProvider>
  );
}

/** Keeps the map centred on you while following. */
function Follow({ to }: { to: LatLng | null }) {
  const map = useMap();
  const zoomed = useRef(false);
  useEffect(() => {
    if (!map || !to) return;
    map.panTo(to);
    if (!zoomed.current) {
      map.setZoom(15);
      zoomed.current = true;
    }
  }, [map, to]);
  return null;
}

const TURN_ANGLE: Record<string, number> = {
  TURN_SLIGHT_LEFT: -45,
  TURN_SHARP_LEFT: -135,
  TURN_LEFT: -90,
  UTURN_LEFT: -180,
  TURN_SLIGHT_RIGHT: 45,
  TURN_SHARP_RIGHT: 135,
  TURN_RIGHT: 90,
  UTURN_RIGHT: 180,
  RAMP_LEFT: -40,
  RAMP_RIGHT: 40,
  FORK_LEFT: -30,
  FORK_RIGHT: 30,
};

/** A big arrow for the next maneuver. */
function ManeuverIcon({ maneuver }: { maneuver: string }) {
  if (maneuver.startsWith("ROUNDABOUT")) {
    return (
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <circle cx="12" cy="10" r="4" />
        <path d="M12 22v-8" />
        <path d={maneuver.endsWith("LEFT") ? "M8 10H3m0 0 2.5-2.5M3 10l2.5 2.5" : "M16 10h5m0 0-2.5-2.5M21 10l-2.5 2.5"} />
      </svg>
    );
  }
  if (maneuver === "FERRY" || maneuver === "FERRY_TRAIN") return <span className="text-[48px]">⛴</span>;
  const angle = TURN_ANGLE[maneuver] ?? 0;
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <g transform={`rotate(${angle} 12 14)`}>
        <path d="M12 21V6" />
        <path d="m6 11 6-6 6 6" />
      </g>
    </svg>
  );
}
