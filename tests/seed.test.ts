import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSeed } from "@/lib/seed-schema";

const seed = parseSeed(JSON.parse(readFileSync(join(__dirname, "../seed/tasmania-2027.json"), "utf8")));

describe("Tasmania 2027 seed", () => {
  it("has 17 consecutive days from 18 Jan to 3 Feb", () => {
    expect(seed.days).toHaveLength(17);
    expect(seed.days[0].date).toBe("2027-01-18");
    expect(seed.days.at(-1)!.date).toBe("2027-02-03");
    seed.days.slice(1).forEach((day, i) => {
      const gap = Date.parse(day.date) - Date.parse(seed.days[i].date);
      expect(gap).toBe(86_400_000);
    });
  });

  it("has three legs that match each day's leg", () => {
    expect(seed.legs.map((l) => l.name)).toEqual(["Solo 1", "Family", "Solo 2"]);
    for (const day of seed.days) {
      const leg = seed.legs.find((l) => l.key === day.leg)!;
      expect(day.date >= leg.startDate && day.date <= leg.endDate).toBe(true);
    }
  });

  it("anchors the ferry and family flights", () => {
    expect(seed.fixedEvents.map((e) => `${e.type} ${e.date}`)).toEqual([
      "ferry_arrive 2027-01-18",
      "flight_in 2027-01-21",
      "flight_out 2027-01-26",
      "ferry_depart 2027-02-03",
    ]);
  });

  it("flags Montezuma Falls and Tasmans Arch as temporarily closed", () => {
    const closed = seed.places.filter((p) => p.businessStatus === "CLOSED_TEMPORARILY").map((p) => p.name);
    expect(closed.sort()).toEqual(["Montezuma Falls", "Tasmans Arch"]);
  });

  it("puts Peppermint Campground in the tray, unscheduled", () => {
    expect(seed.tray).toContain("peppermint-campground");
    const scheduled = new Set(seed.days.flatMap((d) => d.stops.map((s) => s.place)));
    seed.tray.forEach((key) => expect(scheduled.has(key)).toBe(false));
  });

  it("seeds the nine checklist items", () => {
    expect(seed.checklist).toHaveLength(9);
  });
});
