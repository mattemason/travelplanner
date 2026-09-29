import { describe, expect, it } from "vitest";
import type { RoutePoint } from "@/lib/trip/drive";
import { addDrive, estimatedArrivals } from "@/lib/trip/eta";
import type { Stop } from "@/lib/trip/types";

const stop = (id: string, departTime: string | null): Stop => ({
  id,
  placeId: id,
  name: id,
  time: null,
  departTime,
  tags: [],
  categories: [],
  notes: "",
  bookingRef: "",
  link: "",
  arriveBy: "drive",
  transport: {},
  attachments: [],
});
const pt = (stopId: string | null, arriveBy: RoutePoint["arriveBy"] = "drive"): RoutePoint => ({
  lat: 0,
  lng: 0,
  placeId: stopId ?? "start",
  stopId,
  arriveBy,
});

describe("addDrive", () => {
  it("adds the drive and rounds up to 5 minutes", () => {
    expect(addDrive("09:00", 95 * 60)).toBe("10:35");
    expect(addDrive("09:00", 92 * 60)).toBe("10:35");
    expect(addDrive("09:00", 0)).toBe("09:00");
  });
  it("wraps past midnight", () => {
    expect(addDrive("23:30", 60 * 60)).toBe("00:30");
  });
});

describe("estimatedArrivals", () => {
  const stops = { a: stop("a", "09:00"), b: stop("b", null), c: stop("c", "14:00"), d: stop("d", null) };
  const seg = { durationS: 3600, distanceM: 80_000, polyline: "" };

  it("estimates the next stop from a departure time and the drive", () => {
    const eta = estimatedArrivals([pt(null), pt("a"), pt("b"), pt("c"), pt("d")], stops, () => seg);
    expect(eta).toEqual({ b: "10:00", d: "15:00" });
  });
  it("skips ferries and stretches with no drive time yet", () => {
    expect(estimatedArrivals([pt("a"), pt("b", "ferry")], stops, () => seg)).toEqual({});
    expect(estimatedArrivals([pt("a"), pt("b")], stops, () => undefined)).toEqual({});
  });
});
