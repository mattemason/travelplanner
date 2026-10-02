// Drive mode: where you are on a route and what the next turn is. Pure functions, shared by
// the client and the tests.

import type { LatLng } from "./types";

/** One step of Google's driving directions; its maneuver happens at the start of the step. */
export type NavStep = {
  instruction: string; // "Turn left onto Lyell Hwy"
  maneuver: string; // Routes API maneuver, e.g. TURN_LEFT; "" for the first step
  distanceM: number;
  durationS: number;
  polyline: string; // encoded
};
export type Directions = { distanceM: number; durationS: number; polyline: string; steps: NavStep[] };

/** Decodes a Google encoded polyline. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest point on segment a–b to p (flat-earth approximation, fine at road scale). */
function project(p: LatLng, a: LatLng, b: LatLng): { t: number; dist: number } {
  const k = Math.cos(rad(p.lat));
  const ax = a.lng * k;
  const bx = b.lng * k;
  const px = p.lng * k;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p.lat - a.lat) * dy) / len2)) : 0;
  const q = { lat: a.lat + t * dy, lng: (ax + t * dx) / k };
  return { t, dist: distanceM(p, q) };
}

export type RouteShape = { points: LatLng[][]; lengths: number[][] }; // per step: points, cumulative metres

/** Decodes each step once, with running distances along it. */
export function routeShape(steps: NavStep[]): RouteShape {
  const points = steps.map((s) => decodePolyline(s.polyline));
  const lengths = points.map((pts) => {
    const out = [0];
    for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + distanceM(pts[i - 1], pts[i]));
    return out;
  });
  return { points, lengths };
}

export type Progress = {
  step: number; // the step you're driving along
  toTurnM: number; // metres to the end of that step, where the next maneuver is
  offRouteM: number; // how far you are from the route line
  remainingM: number; // to the destination
  remainingS: number; // estimated, scaling each step's time by how much of it is left
};

/**
 * Where `pos` is along the route. Looks from the current step onwards first, so a road that
 * doubles back on itself doesn't make you jump ahead or back.
 */
export function locate(steps: NavStep[], shape: RouteShape, pos: LatLng, fromStep = 0): Progress | null {
  if (!steps.length) return null;
  let best: { step: number; seg: number; t: number; dist: number } | null = null;
  const search = (lo: number, hi: number) => {
    for (let s = Math.max(0, lo); s <= Math.min(steps.length - 1, hi); s++) {
      const pts = shape.points[s];
      for (let i = 1; i < pts.length; i++) {
        const { t, dist } = project(pos, pts[i - 1], pts[i]);
        if (!best || dist < best.dist - 1) best = { step: s, seg: i, t, dist };
      }
      if (pts.length === 1 && (!best || distanceM(pos, pts[0]) < best.dist)) {
        best = { step: s, seg: 0, t: 0, dist: distanceM(pos, pts[0]) };
      }
    }
  };
  search(fromStep, fromStep + 6);
  const near = best as { dist: number } | null;
  if (!near || near.dist > 60) search(0, steps.length - 1);
  if (!best) return null;
  const b = best as { step: number; seg: number; t: number; dist: number };
  const len = shape.lengths[b.step];
  const total = len.at(-1) ?? 0;
  const along = b.seg ? len[b.seg - 1] + b.t * (len[b.seg] - len[b.seg - 1]) : 0;
  const toTurnM = Math.max(0, total - along);
  const share = total ? toTurnM / total : 0;
  const later = steps.slice(b.step + 1);
  return {
    step: b.step,
    toTurnM,
    offRouteM: b.dist,
    remainingM: toTurnM + later.reduce((n, s) => n + s.distanceM, 0),
    remainingS: share * steps[b.step].durationS + later.reduce((n, s) => n + s.durationS, 0),
  };
}

/** "800 m", "1.5 km", "12 km" */
export function spokenDistance(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} metres`;
  const km = m < 10_000 ? Math.round(m / 100) / 10 : Math.round(m / 1000);
  return `${km} ${km === 1 ? "kilometre" : "kilometres"}`;
}
export function shortDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${m < 10_000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)} km`;
}

/**
 * The prompt to speak now for the next maneuver, if any: once at about 2 km (on longer
 * stretches), once at about 300 m, and once as you reach it. `said` remembers what's been said.
 */
export function prompt(next: NavStep | undefined, toTurnM: number, stepLengthM: number, said: Set<string>, key: string): string | null {
  if (!next?.instruction) return null;
  const say = (stage: string, text: string) => {
    if (said.has(`${key}:${stage}`)) return null;
    said.add(`${key}:${stage}`);
    return text;
  };
  if (toTurnM <= 60) return say("now", next.instruction);
  if (toTurnM <= 350) return say("near", `In ${spokenDistance(toTurnM)}, ${lower(next.instruction)}`);
  if (toTurnM <= 2000 && stepLengthM > 3000) return say("far", `In ${spokenDistance(toTurnM)}, ${lower(next.instruction)}`);
  return null;
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
