import { describe, expect, it } from "vitest";
import { diffList, parseSharedList, type TripPlaceRef } from "@/lib/google/shared-list-parse";

// Shaped like Google's getlist response: data[0][4] is the title, data[0][8] the entries;
// entry[1][4] address, entry[1][5][2..3] lat/lng, entry[1][6] the CID pair, entry[2] name.
const entry = (name: string, lat: number, lng: number, cid: [string, string] | null, address = "Somewhere TAS") => [
  null,
  [null, null, `${name}, ${address}`, null, address, [null, null, lat, lng], cid, "/g/abc"],
  name,
  "",
];
const response = [[null, null, null, null, "Tasmania", null, null, null, [
  entry("Montezuma Falls", -41.8585, 145.4815, ["0x1", "0x2"]),
  entry("Cape Raoul Track", -43.2006, 147.7738, ["0x3", "0x4"]),
  entry("Dropped pin", -42.0, 146.0, null),
]]];

const trip: TripPlaceRef[] = [
  { placeId: "a", name: "Montezuma Falls", lat: -41.8590, lng: 145.4810, cid: null }, // ~70 m away
  { placeId: "b", name: "Hobart", lat: -42.8821, lng: 147.3272, cid: null },
];

describe("parseSharedList", () => {
  it("reads the title and each place's name, address, coordinates and CID", () => {
    const list = parseSharedList(response);
    expect(list.title).toBe("Tasmania");
    expect(list.places).toHaveLength(3);
    expect(list.places[0]).toMatchObject({
      name: "Montezuma Falls",
      address: "Somewhere TAS",
      lat: -41.8585,
      lng: 145.4815,
      cid: "0x1:0x2",
    });
    expect(list.places[2].cid).toBeNull();
  });

  it("rejects a response that isn't a list", () => {
    expect(() => parseSharedList({ nope: true })).toThrow();
  });
});

describe("diffList", () => {
  it("splits places into new and already-in-trip, matching nearby places", () => {
    const d = diffList(parseSharedList(response), trip, []);
    expect(d.existing.map((e) => e.match.placeId)).toEqual(["a"]);
    expect(d.added.map((p) => p.name)).toEqual(["Cape Raoul Track", "Dropped pin"]);
  });

  it("matches by CID even when the coordinates differ", () => {
    const d = diffList(parseSharedList(response), [{ placeId: "c", name: "x", lat: 0, lng: 0, cid: "0x3:0x4" }], []);
    expect(d.existing.map((e) => e.place.name)).toEqual(["Cape Raoul Track"]);
  });

  it("reports previously synced places that have left the list", () => {
    const gone: TripPlaceRef = { placeId: "old", name: "The Neck Lookout", lat: -43.3, lng: 147.3, cid: "0x9:0x9" };
    const d = diffList(parseSharedList(response), [...trip, gone], [gone]);
    expect(d.removed.map((r) => r.name)).toEqual(["The Neck Lookout"]);
  });
});
