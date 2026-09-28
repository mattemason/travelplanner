/** Plain data the planner UI works with. Built on the server by loadTrip(). */

export const TAGS = [
  { key: "4wd", label: "4WD" },
  { key: "walk", label: "Walk" },
  { key: "camp", label: "Camp" },
  { key: "permit", label: "Permit" },
  { key: "book_ahead", label: "Book ahead" },
  { key: "weather", label: "Weather" },
] as const;
export type BuiltinTag = (typeof TAGS)[number]["key"];
/** A built-in tag key, or the name of one of the user's own tags. */
export type Tag = string;
export const tagLabel = (tag: string) => TAGS.find((t) => t.key === tag)?.label ?? tag;

export type LatLng = { lat: number; lng: number };

/** How you get to a stop from the previous point. Only "drive" counts as driving. */
export const ARRIVE_BY = [
  { key: "drive", label: "Drive", icon: "" },
  { key: "ferry", label: "Ferry", icon: "⛴" },
  { key: "flight", label: "Flight", icon: "✈" },
  { key: "bus", label: "Bus", icon: "🚌" },
  { key: "train", label: "Train", icon: "🚆" },
  { key: "walk", label: "Walk", icon: "🚶" },
] as const;
export type ArriveBy = (typeof ARRIVE_BY)[number]["key"];
export const arriveByLabel = (mode: ArriveBy) => {
  const m = ARRIVE_BY.find((a) => a.key === mode);
  return m ? `${m.icon ? `${m.icon} ` : ""}${m.label}` : mode;
};

export type Place = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  businessStatus: string | null;
  mapsUrl: string | null;
};

export type Stop = {
  id: string;
  placeId: string;
  name: string; // label override, or the place name
  time: string | null; // "HH:MM"
  tags: Tag[];
  categories: string[];
  notes: string;
  bookingRef: string;
  link: string;
  arriveBy: ArriveBy;
  transport: Transport; // only meaningful for ferry, flight, bus and train
};

/** Booked travel to a stop. Times are local: departAt/arriveAt "YYYY-MM-DDTHH:MM", checkInBy "HH:MM". */
export type Transport = {
  carrier?: string;
  number?: string;
  departAt?: string;
  arriveAt?: string;
  bookingRef?: string;
  checkInBy?: string;
  seat?: string;
};

/** Where you stay the night: times "HH:MM". */
export type Stay = { name?: string; checkIn?: string; checkOut?: string; bookingRef?: string; phone?: string };

/** Modes you book and ride, which get travel details. */
export const BOOKED_MODES: readonly ArriveBy[] = ["ferry", "flight", "bus", "train"];

export type Leg = { id: string; name: string; startDate: string; endDate: string; colour: string };

export type Day = {
  id: string;
  date: string; // YYYY-MM-DD
  legId: string | null;
  overnightPlaceId: string | null;
  stay: Stay;
  notes: string;
};

export type ChecklistItem = {
  id: string;
  title: string;
  category: string | null;
  dueDate: string | null;
  status: "todo" | "in_progress" | "done";
};

/** Where every stop sits: day id (or TRAY) → ordered stop ids. */
export const TRAY = "tray";
export type Layout = Record<string, string[]>;

export type TripData = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  maxDriveHours: number;
  fuelPrices: { diesel: number | null; petrol: number | null }; // $ per litre
  icon: string | null; // emoji
  coverVersion: number | null; // cover photo timestamp, for cache-busting; null = no photo
  legs: Leg[];
  days: Day[];
  places: Record<string, Place>;
  stops: Record<string, Stop>;
  layout: Layout;
  checklist: ChecklistItem[];
};

export type Segment = { durationS: number; distanceM: number; polyline: string | null };
