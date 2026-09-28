import type { LatLng, TripData } from "./types";

/**
 * Splits a day's stops for re-routing. The start is last night's overnight (or the first
 * mappable stop) and the end is tonight's (or the last mappable stop). Stops at either
 * overnight keep their end of the day; stops without coordinates go last.
 */
export function rerouteParts(trip: TripData, dayIndex: number) {
  const day = trip.days[dayIndex];
  const prevNight = trip.days[dayIndex - 1]?.overnightPlaceId ?? null;
  const night = day.overnightPlaceId;
  const coords = (placeId: string | null): LatLng | null => {
    const p = placeId ? trip.places[placeId] : null;
    return p && p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null;
  };

  const head: string[] = [];
  const tail: string[] = [];
  const unmapped: string[] = [];
  const movable: { stopId: string; at: LatLng }[] = [];
  for (const stopId of trip.layout[day.id] ?? []) {
    const placeId = trip.stops[stopId]?.placeId ?? null;
    const at = coords(placeId);
    if (!at) unmapped.push(stopId);
    else if (placeId === prevNight) head.push(stopId);
    else if (placeId === night) tail.push(stopId);
    else movable.push({ stopId, at });
  }

  let origin = coords(prevNight);
  let destination = coords(night);
  // With no overnight on one side, the first/last movable stop stays put as that end.
  if (!origin && movable.length) {
    const first = movable.shift()!;
    head.push(first.stopId);
    origin = first.at;
  }
  if (!destination && movable.length) {
    const last = movable.pop()!;
    tail.unshift(last.stopId);
    destination = last.at;
  }

  return { head, tail, unmapped, movable, origin, destination };
}

/** Assembles the day's new order from the optimised indexes into `movable`. */
export function applyOrder(parts: ReturnType<typeof rerouteParts>, order: number[]): string[] {
  return [...parts.head, ...order.map((i) => parts.movable[i].stopId), ...parts.tail, ...parts.unmapped];
}
