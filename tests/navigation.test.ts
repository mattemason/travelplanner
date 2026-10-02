import { describe, expect, it } from "vitest";
import { decodePolyline, distanceM, locate, prompt, routeShape, shortDistance, spokenDistance, type NavStep } from "@/lib/trip/navigation";

// Google's documented example polyline.
const EXAMPLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

// A straight east-west road split into two steps, along latitude -42.
function encode(points: { lat: number; lng: number }[]): string {
  let out = "";
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}
const a = { lat: -42, lng: 147 };
const b = { lat: -42, lng: 147.1 };
const c = { lat: -42, lng: 147.2 };
const steps: NavStep[] = [
  { instruction: "Head east", maneuver: "DEPART", distanceM: distanceM(a, b), durationS: 600, polyline: encode([a, b]) },
  { instruction: "Turn left onto Lyell Hwy", maneuver: "TURN_LEFT", distanceM: distanceM(b, c), durationS: 600, polyline: encode([b, c]) },
];

describe("decodePolyline", () => {
  it("decodes Google's example", () => {
    expect(decodePolyline(EXAMPLE)).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
});

describe("locate", () => {
  const shape = routeShape(steps);
  it("finds the step and the distance to the next turn", () => {
    const p = locate(steps, shape, { lat: -42.0001, lng: 147.05 })!;
    expect(p.step).toBe(0);
    expect(p.toTurnM).toBeGreaterThan(4000);
    expect(p.toTurnM).toBeLessThan(4300);
    expect(p.offRouteM).toBeLessThan(20);
    expect(p.remainingM).toBeCloseTo(p.toTurnM + steps[1].distanceM, 0);
    expect(p.remainingS).toBeCloseTo(300 + 600, -1);
  });
  it("notices when you're off the route", () => {
    expect(locate(steps, shape, { lat: -41.99, lng: 147.15 })!.offRouteM).toBeGreaterThan(1000);
  });
});

describe("prompts", () => {
  it("speaks each stage once", () => {
    const said = new Set<string>();
    expect(prompt(steps[1], 1800, 8000, said, "0")).toBe("In 1.8 kilometres, turn left onto Lyell Hwy");
    expect(prompt(steps[1], 1700, 8000, said, "0")).toBeNull();
    expect(prompt(steps[1], 300, 8000, said, "0")).toBe("In 300 metres, turn left onto Lyell Hwy");
    expect(prompt(steps[1], 40, 8000, said, "0")).toBe("Turn left onto Lyell Hwy");
  });
  it("formats distances", () => {
    expect(spokenDistance(320)).toBe("300 metres");
    expect(spokenDistance(1000)).toBe("1 kilometre");
    expect(shortDistance(840)).toBe("840 m");
    expect(shortDistance(15400)).toBe("15 km");
  });
});
