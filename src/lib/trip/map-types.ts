// The map types a trip can offer in the map's type menu. Shared by the map (client) and the
// trip settings (server), so it lives outside any "use client" module.

export const MAP_TYPES = [
  { id: "roadmap", label: "Map" },
  { id: "terrain", label: "Terrain" },
  { id: "hybrid", label: "Satellite" },
  { id: "list", label: "Tas topo (LIST)", group: "Off-road" },
  { id: "opentopo", label: "OpenTopoMap" },
] as const satisfies readonly { id: string; label: string; group?: string }[];

export type MapType = (typeof MAP_TYPES)[number]["id"];
export const MAP_TYPE_IDS = MAP_TYPES.map((t) => t.id) as [MapType, ...MapType[]];

/** A trip's saved choice, or every type when it hasn't chosen (or chose ones that no longer exist). */
export function tripMapTypes(saved: string[] | null | undefined): MapType[] {
  const valid = (saved ?? []).filter((id): id is MapType => (MAP_TYPE_IDS as string[]).includes(id));
  return valid.length ? MAP_TYPE_IDS.filter((id) => valid.includes(id)) : [...MAP_TYPE_IDS];
}
