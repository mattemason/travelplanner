import { dayLabel, timeLabel } from "./format";
import type { ArriveBy, Stay, Transport } from "./types";

const clean = <T extends Record<string, string | undefined>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v && v.trim())) as T;

/** Drops empty fields so "no details" stores as {}. */
export const cleanTransport = (t: Transport): Transport => clean(t);
export const cleanStay = (s: Stay): Stay => clean(s);

const NUMBER_LABEL: Partial<Record<ArriveBy, string>> = {
  flight: "Flight number",
  ferry: "Sailing / voyage",
  bus: "Service number",
  train: "Service number",
};
export const numberLabel = (mode: ArriveBy) => NUMBER_LABEL[mode] ?? "Service number";
export const carrierLabel = (mode: ArriveBy) => (mode === "flight" ? "Airline" : "Operator");
export const seatLabel = (mode: ArriveBy) => (mode === "ferry" ? "Cabin / berth" : "Seat");

/** "Mon 3:30pm" from "2027-02-03T15:30", or just the time when it's on `sameDay`. */
function when(iso: string | undefined, sameDay?: string): string | null {
  if (!iso) return null;
  const [date, time] = iso.split("T");
  const t = timeLabel(time?.slice(0, 5) ?? null);
  if (!date || date === sameDay) return t || null;
  const day = dayLabel(date);
  return t ? `${day} ${t}` : day;
}

/** One line for a booked trip, e.g. "Spirit of Tasmania SOT1 · departs 7:30pm · arrives Tue 19 Jan 6:00am · Ref ABC". */
export function transportSummary(t: Transport, dayDate?: string): string {
  const parts = [
    [t.carrier, t.number].filter(Boolean).join(" ") || null,
    t.checkInBy ? `check in by ${timeLabel(t.checkInBy)}` : null,
    when(t.departAt, dayDate) ? `departs ${when(t.departAt, dayDate)}` : null,
    when(t.arriveAt, dayDate) ? `arrives ${when(t.arriveAt, dayDate)}` : null,
    t.seat ? t.seat : null,
    t.bookingRef ? `Ref ${t.bookingRef}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** e.g. "in 2:00pm · out 10:00am · Ref XYZ · 03 6123 4567" */
export function staySummary(s: Stay): string {
  return [
    s.checkIn ? `in ${timeLabel(s.checkIn)}` : null,
    s.checkOut ? `out ${timeLabel(s.checkOut)}` : null,
    s.bookingRef ? `Ref ${s.bookingRef}` : null,
    s.phone || null,
  ]
    .filter(Boolean)
    .join(" · ");
}
