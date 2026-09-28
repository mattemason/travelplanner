import { describe, expect, it } from "vitest";
import {
  dayDrive,
  dayRoute,
  dayStart,
  formatDuration,
  overnightOf,
  overnightTravel,
  overnightTravelLabel,
  pairKey,
} from "@/lib/trip/drive";
import { changedContainers, moveStop } from "@/lib/trip/layout";
import { TRAY, type TripData } from "@/lib/trip/types";
import { dayWarnings } from "@/lib/trip/warnings";
import { applyOrder, rerouteParts } from "@/lib/trip/reroute";
import { formatCost, fuelCost } from "@/lib/trip/fuel";
import { cleanStay, staySummary, transportSummary } from "@/lib/trip/details";
import { googleMapsLink, hipcampLink } from "@/lib/trip/maps-link";

const place = (id: string, lat: number | null, lng: number | null, businessStatus: string | null = null) => ({
  id,
  name: id,
  lat,
  lng,
  businessStatus,
  mapsUrl: null,
});
const stop = (id: string, placeId: string, tags: string[] = []) => ({
  id,
  placeId,
  name: placeId,
  time: null,
  tags,
  categories: [],
  arriveBy: "drive" as const,
  transport: {},
  notes: "",
  bookingRef: "",
  link: "",
});

function trip(): TripData {
  return {
    id: "t",
    name: "Test",
    startDate: "2027-01-18",
    endDate: "2027-01-19",
    maxDriveHours: 5,
    fuelPrices: { diesel: null, petrol: null },
    icon: null,
    coverVersion: null,
    legs: [],
    days: [
      { id: "d1", date: "2027-01-18", legId: null, overnightPlaceId: "camp", stay: {}, notes: "" },
      { id: "d2", date: "2027-01-19", legId: null, overnightPlaceId: "town", stay: {}, notes: "" },
    ],
    places: {
      port: place("port", -41, 146),
      camp: place("camp", -42, 146),
      falls: place("falls", -42.5, 146.5, "CLOSED_TEMPORARILY"),
      track: place("track", null, null),
      town: place("town", -43, 147),
    },
    stops: {
      s1: stop("s1", "port"),
      s2: stop("s2", "camp", ["camp"]),
      s3: stop("s3", "falls", ["weather"]),
      s4: stop("s4", "track", ["permit"]),
      s5: stop("s5", "town"),
    },
    layout: { d1: ["s1", "s2"], d2: ["s3", "s4"], [TRAY]: ["s5"] },
    checklist: [{ id: "c1", title: "Driver pass", category: "permit", dueDate: null, status: "todo" }],
  };
}

describe("dayRoute", () => {
  it("runs from last night's overnight through the stops, skipping repeats and unmapped places", () => {
    const t = trip();
    expect(dayRoute(t, 0).map((p) => p.placeId)).toEqual(["port", "camp"]); // stop at the overnight counts once
    // d2's saved overnight (town) isn't one of its stops, so it's ignored; "track" has no coordinates
    expect(dayRoute(t, 1).map((p) => p.placeId)).toEqual(["camp", "falls"]);
  });

  it("only counts an overnight that's one of the day's stops", () => {
    const t = trip();
    expect(overnightOf(t, 0)).toBe("camp");
    expect(overnightOf(t, 1)).toBeNull(); // leftover overnight, not among d2's stops
    t.layout.d2 = ["s3", "s5"]; // now town is a stop on d2
    expect(overnightOf(t, 1)).toBe("town");
  });

  it("starts a day from yesterday's last stop when there was no overnight", () => {
    const t = trip();
    t.days[0].overnightPlaceId = null;
    expect(dayStart(t, 1)).toBe("camp"); // d1's last stop
    expect(dayStart(t, 0)).toBeNull();
  });
});

describe("dayDrive", () => {
  it("totals cached segments and reports when some are missing", () => {
    const t = trip();
    t.layout.d2 = ["s3", "s5"]; // camp → falls → town
    const route = dayRoute(t, 1);
    const cache = { [pairKey(route[0], route[1])]: { durationS: 3600, distanceM: 80_000, polyline: null } };
    const drive = dayDrive(route, cache);
    expect(drive.totalS).toBe(3600);
    expect(drive.complete).toBe(false);
  });
});

describe("moveStop", () => {
  it("moves a stop between days and out of the tray", () => {
    const t = trip();
    const moved = moveStop(t.layout, "s3", "d1", 1);
    expect(moved.d1).toEqual(["s1", "s3", "s2"]);
    expect(moved.d2).toEqual(["s4"]);
    const scheduled = moveStop(moved, "s5", "d2", 99);
    expect(scheduled.d2).toEqual(["s4", "s5"]);
    expect(scheduled[TRAY]).toEqual([]);
    expect(changedContainers(t.layout, scheduled).sort()).toEqual(["d1", "d2", TRAY].sort());
  });
});

describe("dayWarnings", () => {
  it("flags closed places, weather days, open permits and long drives", () => {
    const titles = dayWarnings(trip(), "d2", 6 * 3600).map((w) => w.title);
    expect(titles).toEqual(["Closed", "Long driving day", "Weather-dependent", "Permit needed"]);
  });

  it("stays quiet on a normal day", () => {
    expect(dayWarnings(trip(), "d1", 2 * 3600)).toEqual([]);
  });

  it("drops the permit warning once the permit is ticked off", () => {
    const t = trip();
    t.checklist[0].status = "done";
    expect(dayWarnings(t, "d2", 0).map((w) => w.title)).not.toContain("Permit needed");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(55 * 60)).toBe("55 min");
    expect(formatDuration(4 * 3600 + 15 * 60)).toBe("4h 15m");
    expect(formatDuration(2 * 3600)).toBe("2h");
  });
});

describe("rerouteParts", () => {
  it("fixes the overnight ends, moves the rest, and puts unmapped stops last", () => {
    const t = trip();
    t.layout.d2 = ["s4", "s3", "s5", "s2"]; // track (unmapped), falls, town (tonight), camp (last night)
    const parts = rerouteParts(t, 1);
    expect(parts.head).toEqual(["s2"]);
    expect(parts.tail).toEqual(["s5"]);
    expect(parts.unmapped).toEqual(["s4"]);
    expect(parts.movable.map((m) => m.stopId)).toEqual(["s3"]);
    expect(parts.origin).toEqual({ lat: -42, lng: 146 });
    expect(applyOrder(parts, [0])).toEqual(["s2", "s3", "s5", "s4"]);
  });

  it("uses the first and last stops as the ends when there are no overnights", () => {
    const t = trip();
    t.days[0].overnightPlaceId = null;
    t.stops.s6 = stop("s6", "falls");
    t.stops.s7 = stop("s7", "town");
    t.layout.d1 = ["s1", "s6", "s7", "s5"];
    const parts = rerouteParts(t, 0);
    expect(parts.head).toEqual(["s1"]);
    expect(parts.tail).toEqual(["s5"]);
    expect(applyOrder(parts, [1, 0])).toEqual(["s1", "s7", "s6", "s5"]);
  });
});

describe("fuelCost", () => {
  it("costs distance at the vehicle's consumption and the trip's price for its fuel", () => {
    const v = { lPer100km: 12, fuelType: "diesel" as const };
    // 250 km at 12 L/100km = 30 L; at $2.10/L = $63
    expect(fuelCost(250_000, v, { diesel: 2.1, petrol: 1.9 })).toBeCloseTo(63);
  });
  it("is unknown without a vehicle or a price for its fuel", () => {
    expect(fuelCost(100_000, { lPer100km: null, fuelType: "diesel" }, { diesel: 2, petrol: 2 })).toBeNull();
    expect(fuelCost(100_000, { lPer100km: 10, fuelType: "petrol" }, { diesel: 2, petrol: null })).toBeNull();
  });
  it("formats dollars", () => {
    expect(formatCost(63.4)).toBe("$63");
    expect(formatCost(142.6)).toBe("$143");
    expect(formatCost(4.25)).toBe("$4.25");
  });
});

describe("non-drive stretches", () => {
  it("leaves ferry and flight stretches out of the day's driving", () => {
    const t = trip();
    t.stops.s5 = { ...t.stops.s5, arriveBy: "ferry" };
    t.layout.d2 = ["s3", "s5"]; // falls, then the ferry to town
    const route = dayRoute(t, 1);
    expect(route.map((p) => p.arriveBy)).toEqual(["drive", "drive", "ferry"]);
    const cache = {
      [pairKey(route[0], route[1])]: { durationS: 3600, distanceM: 90_000, polyline: null },
      [pairKey(route[1], route[2])]: { durationS: 40_000, distanceM: 450_000, polyline: null },
    };
    const drive = dayDrive(route, cache);
    expect(drive.totalS).toBe(3600);
    expect(drive.totalM).toBe(90_000);
    expect(drive.complete).toBe(true);
  });
});

describe("overnightTravel", () => {
  it("spots an overnight ferry from the day's overnight to the next day's first stop", () => {
    const t = trip();
    // d1 ends at camp; d2's first stop (falls) is reached by ferry from camp
    t.stops.s3 = { ...t.stops.s3, arriveBy: "ferry" };
    expect(overnightTravel(t, 0)).toEqual({ mode: "ferry", to: "falls" });
    expect(overnightTravelLabel({ mode: "ferry", to: "falls" })).toBe("⛴ Overnight on the ferry to falls");
  });
  it("is a normal night when the next day starts by road", () => {
    expect(overnightTravel(trip(), 0)).toBeNull();
  });
});

describe("travel and stay details", () => {
  it("summarises a booked ferry, showing the date only when it isn't the day's", () => {
    const line = transportSummary(
      {
        carrier: "Spirit of Tasmania",
        number: "SOT2",
        checkInBy: "17:30",
        departAt: "2027-01-18T19:30",
        arriveAt: "2027-01-19T06:00",
        bookingRef: "ABC123",
      },
      "2027-01-19",
    );
    expect(line).toBe(
      "Spirit of Tasmania SOT2 · check in by 5:30pm · departs Mon 18 Jan 7:30pm · arrives 6:00am · Ref ABC123",
    );
  });
  it("summarises a stay and drops empty fields", () => {
    expect(staySummary({ checkIn: "14:00", checkOut: "10:00", bookingRef: "XYZ" })).toBe("in 2:00pm · out 10:00am · Ref XYZ");
    expect(cleanStay({ checkIn: "", phone: " ", bookingRef: "R1" })).toEqual({ bookingRef: "R1" });
  });
});

describe("googleMapsLink", () => {
  it("prefers the saved Maps link, then coordinates, then the name", () => {
    const base = { id: "p", name: "Stanley", lat: -40.76, lng: 145.29, businessStatus: null, mapsUrl: null };
    expect(googleMapsLink({ ...base, mapsUrl: "https://maps.google.com/?cid=1" }, "x")).toBe("https://maps.google.com/?cid=1");
    expect(googleMapsLink(base, "x")).toBe("https://www.google.com/maps/search/?api=1&query=-40.76%2C145.29");
    expect(googleMapsLink({ ...base, lat: null, lng: null }, "x")).toBe("https://www.google.com/maps/search/?api=1&query=Stanley");
  });
});

describe("hipcampLink", () => {
  it("searches Hipcamp around the place, or gives up without coordinates", () => {
    const base = { id: "p", name: "Sawtell", lat: -30.37071, lng: 153.09581, businessStatus: null, mapsUrl: null };
    expect(hipcampLink(base, "Sawtell")).toBe("https://www.hipcamp.com/en-AU/search?q=Sawtell&lat=-30.3707&lng=153.0958");
    expect(hipcampLink({ ...base, lat: null, lng: null }, "Sawtell")).toBeNull();
  });
});
