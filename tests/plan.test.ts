import { describe, expect, it } from "vitest";
import { applyPlanTo, buildPlanRequest, checkPlan, type PlanOutput } from "@/lib/trip/plan";
import { TRAY, type TripData } from "@/lib/trip/types";

const place = (id: string, lat: number, lng: number) => ({ id, name: id, lat, lng, businessStatus: null, mapsUrl: null });
const stop = (id: string, placeId: string) => ({
  id,
  placeId,
  name: placeId,
  time: null,
  departTime: null,
  tags: [],
  categories: [],
  arriveBy: "drive" as const,
  transport: {},
  attachments: [],
  notes: "",
  bookingRef: "",
  link: "",
});

function trip(): TripData {
  return {
    id: "t",
    name: "Test",
    startDate: "2027-01-01",
    endDate: "2027-01-02",
    maxDriveHours: 5,
    mapTypes: ["roadmap"],
    fuelPrices: { diesel: null, petrol: null },
    icon: null,
    coverVersion: null,
    legs: [],
    days: [
      { id: "d1", date: "2027-01-01", legId: null, overnightPlaceId: "b", stay: {}, notes: "" },
      { id: "d2", date: "2027-01-02", legId: null, overnightPlaceId: null, stay: {}, notes: "" },
    ],
    places: { a: place("a", -41, 146), b: place("b", -42, 146), c: place("c", -43, 147), d: place("d", -42.5, 147) },
    stops: { s_a: stop("s_a", "a"), s_b: stop("s_b", "b"), s_c: stop("s_c", "c"), s_d: stop("s_d", "d") },
    layout: { d1: ["s_a", "s_b"], d2: [], [TRAY]: ["s_c", "s_d"] },
    checklist: [],
  };
}

describe("plan builder", () => {
  it("sends stops as short aliases with the locked flags", () => {
    const t = trip();
    const req = buildPlanRequest(t, new Set(["d1"]), { preferences: "go slow", vehicle: null });
    const ctx = req.context as { days: { locked: boolean; stop_ids: string[]; overnight_stop_id: string | null }[] };
    expect(ctx.days[0]).toMatchObject({ locked: true, stop_ids: ["s1", "s2"], overnight_stop_id: "s2" });
    expect(req.aliases.s3).toBe("s_c");
  });

  it("keeps locked days, drops unknown and duplicate stops, and parks forgotten ones", () => {
    const t = trip();
    const req = buildPlanRequest(t, new Set(["d1"]), { preferences: "", vehicle: null });
    const out: PlanOutput = {
      summary: "ok",
      days: [
        { date: "2027-01-01", stop_ids: ["s3"], overnight_stop_id: "s3", note: "" }, // tries to change a locked day
        { date: "2027-01-02", stop_ids: ["s3", "s3", "s99"], overnight_stop_id: "s1", note: "Long day" },
      ],
      unscheduled: [],
      warnings: [],
    };
    const plan = checkPlan(t, new Set(["d1"]), req, out);
    expect(plan.layout.d1).toEqual(["s_a", "s_b"]);
    expect(plan.overnights.d1).toBe("s_b");
    expect(plan.layout.d2).toEqual(["s_c"]);
    expect(plan.overnights.d2).toBeNull(); // s1 isn't on d2
    expect(plan.layout[TRAY]).toEqual(["s_d"]); // forgotten
    expect(plan.notes.d2).toBe("Long day");
    expect(plan.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("applies overnights as the chosen stop's place", () => {
    const t = trip();
    const req = buildPlanRequest(t, new Set(), { preferences: "", vehicle: null });
    const plan = checkPlan(t, new Set(), req, {
      summary: "",
      days: [
        { date: "2027-01-01", stop_ids: ["s1"], overnight_stop_id: "s1", note: "" },
        { date: "2027-01-02", stop_ids: ["s2", "s3", "s4"], overnight_stop_id: "s4", note: "" },
      ],
      unscheduled: [],
      warnings: [],
    });
    const applied = applyPlanTo(t, plan);
    expect(applied.days.map((d) => d.overnightPlaceId)).toEqual(["a", "d"]);
    expect(applied.layout[TRAY]).toEqual([]);
  });
});
