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
};

export type Leg = { id: string; name: string; startDate: string; endDate: string; colour: string };

export type Day = {
  id: string;
  date: string; // YYYY-MM-DD
  legId: string | null;
  overnightPlaceId: string | null;
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
  legs: Leg[];
  days: Day[];
  places: Record<string, Place>;
  stops: Record<string, Stop>;
  layout: Layout;
  checklist: ChecklistItem[];
};

export type Segment = { durationS: number; distanceM: number; polyline: string | null };
