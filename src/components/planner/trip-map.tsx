"use client";

import { AdvancedMarker, AdvancedMarkerAnchorPoint, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useState } from "react";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  colour: string;
  badge: string | null; // text inside the pin (stop number, day of month); null draws a small dot
  name: string; // side label and tooltip
  result?: boolean; // a map search result rather than a trip stop
};
export type MapBounds = { north: number; south: number; east: number; west: number };
/** A road route (encoded polyline) or a straight dashed line between points (ferry, flight). */
export type MapRoute =
  | { path: string; colour: string; points?: never; dashed?: false }
  | { points: { lat: number; lng: number }[]; colour: string; dashed: true; path?: never };

const DASH = [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "12px" }];

type Props = {
  points: MapPoint[];
  routes: MapRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  fitKey: string; // refit the view when this changes (the day in view, or whole-trip mode)
  className?: string;
  labels?: boolean;
  labelSelectedOnly?: boolean; // busy maps: only the tapped pin gets its name
  onBoundsChanged?: (bounds: MapBounds) => void;
  dark?: boolean; // the app's theme, so the map matches Light/Dark choices
  onPlaceClick?: (googlePlaceId: string) => void; // a tap on one of Google's own map icons
};

const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

type MapType = "roadmap" | "terrain" | "hybrid" | "list" | "opentopo";
const MAP_TYPES: { id: MapType; label: string; group?: string }[] = [
  { id: "roadmap", label: "Map" },
  { id: "terrain", label: "Terrain" },
  { id: "hybrid", label: "Satellite" },
  { id: "list", label: "Tas topo (LIST)", group: "Off-road" },
  { id: "opentopo", label: "OpenTopoMap" },
];

/**
 * Free off-road topo maps (4WD tracks, fire trails, gravel roads, contours), laid over Google's
 * map as tile overlays. Outside a layer's coverage or zoom range, Google's map shows through.
 */
type Topo = {
  url: (x: number, y: number, z: number) => string;
  maxZoom: number;
  credit: string;
  link: string;
  bounds?: { north: number; south: number; west: number; east: number }; // skip tiles outside it
};
const TOPO: Partial<Record<MapType, Topo>> = {
  // Land Tasmania's topographic basemap: Tasmania only. ArcGIS tiles are z/y/x. CC BY 3.0 AU.
  list: {
    url: (x, y, z) => `https://services.thelist.tas.gov.au/arcgis/rest/services/Basemaps/Topographic/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 18,
    bounds: { north: -39.2, south: -44.0, west: 143.5, east: 148.7 }, // blank tiles elsewhere would hide Google's map
    credit: "the LIST © State of Tasmania (CC BY 3.0 AU)",
    link: "https://www.thelist.tas.gov.au/",
  },
  // OpenStreetMap tracks with contours, all of Australia. CC BY-SA.
  opentopo: {
    url: (x, y, z) => `https://${"abc"[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`,
    maxZoom: 17,
    credit: "© OpenStreetMap contributors, SRTM · style © OpenTopoMap (CC BY-SA)",
    link: "https://opentopomap.org/about",
  },
};
const MAP_TYPE_KEY = "trip-map-type";
function savedMapType(): MapType {
  try {
    const v = typeof window === "undefined" ? null : localStorage.getItem(MAP_TYPE_KEY);
    return MAP_TYPES.some((t) => t.id === v) ? (v as MapType) : "roadmap";
  } catch {
    return "roadmap";
  }
}
const TASMANIA = { lat: -42.0, lng: 146.6 };

/** A Google map of pins and drive routes: one day, or the whole trip. */
export function TripMap(props: Props) {
  const { points, routes, selectedId, onSelect, fitKey, className, labels = true, onBoundsChanged, dark = false } = props;
  const { onPlaceClick, labelSelectedOnly = false } = props;
  const [mapType, setMapType] = useState<MapType>(savedMapType);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const chooseType = (t: MapType) => {
    setMapType(t);
    setTypeMenuOpen(false);
    try {
      localStorage.setItem(MAP_TYPE_KEY, t);
    } catch {
      // private mode: the choice lasts for this page only
    }
  };
  return (
    <div className={`relative ${className ?? ""}`}>
      <Map
        mapTypeId={TOPO[mapType] ? "roadmap" : mapType}
        key={dark ? "dark" : "light"} // the colour scheme is fixed when the map is created
        mapId={MAP_ID}
        defaultCenter={TASMANIA}
        defaultZoom={7}
        colorScheme={dark ? "DARK" : "LIGHT"}
        gestureHandling="cooperative"
        disableDefaultUI
        zoomControl
        clickableIcons={!!onPlaceClick && !TOPO[mapType]} // Google's place icons stay off non-Google maps
        onClick={(e) => {
          if (!e.detail.placeId || !onPlaceClick) return;
          e.stop(); // show our card instead of Google's default popup
          onPlaceClick(e.detail.placeId);
        }}
        className="h-full w-full"
        onCameraChanged={(e) => onBoundsChanged?.(e.detail.bounds)}
      >
        {routes.map((r, i) =>
          r.dashed ? (
            <Polyline
              key={`d${i}-${r.points.map((p) => p.lat).join()}`}
              path={r.points}
              strokeColor={r.colour}
              strokeOpacity={0}
              icons={DASH.map((d) => ({ ...d, icon: { ...d.icon, strokeColor: r.colour } }))}
            />
          ) : (
            <Polyline
              key={`${i}-${r.path.slice(0, 12)}`}
              encodedPath={r.path}
              strokeColor={r.colour}
              strokeWeight={4}
              strokeOpacity={0.9}
            />
          ),
        )}
        {points.map((p) => {
          const selected = p.id === selectedId;
          if (p.result) {
            return (
              <AdvancedMarker
                key={p.id}
                position={p}
                title={p.name}
                zIndex={selected ? 20 : 5}
                anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM_CENTER}
                onClick={() => onSelect(p.id)}
              >
                <div className="relative flex flex-col items-center">
                  <span
                    className="grid place-items-center rounded-full border-2 border-white shadow-md"
                    style={{ width: selected ? 30 : 24, height: selected ? 30 : 24, background: p.colour }}
                  >
                    <span className="h-2 w-2 rounded-full bg-white" />
                  </span>
                  <span className="-mt-0.5 h-2 w-0.5" style={{ background: p.colour }} />
                  {selected && (
                    <span className="absolute top-0 left-full ml-1.5 rounded bg-paper/95 px-1 font-display text-[14px] font-semibold whitespace-nowrap text-ink shadow">
                      {p.name}
                    </span>
                  )}
                </div>
              </AdvancedMarker>
            );
          }
          const size = p.badge === null ? (selected ? 14 : 10) : selected ? 32 : 26;
          return (
            <AdvancedMarker
              key={p.id}
              position={p}
              title={p.name}
              zIndex={selected ? 10 : p.badge === null ? 1 : 2}
              anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
              onClick={() => onSelect(p.id)}
            >
              {/* The circle is the marker's box, so CENTER puts it on the spot; the label hangs outside. */}
              <div
                className="relative grid place-items-center rounded-full bg-paper font-bold text-ink shadow"
                style={{
                  border: `${p.badge === null ? 2.5 : 3}px solid ${p.colour}`,
                  width: size,
                  height: size,
                  fontSize: 12,
                }}
              >
                {p.badge}
                {labels && (labelSelectedOnly ? selected : p.badge !== null || selected) && (
                  <span
                    className="absolute top-1/2 left-full ml-1.5 -translate-y-1/2 rounded bg-paper/85 px-1 font-display text-[14px] font-semibold whitespace-nowrap text-ink"
                    style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {p.name}
                  </span>
                )}
              </div>
            </AdvancedMarker>
          );
        })}
        <FitBounds points={points} fitKey={fitKey} />
        <TopoLayer type={mapType} />
      </Map>
      {TOPO[mapType] && (
        <a
          href={TOPO[mapType].link}
          target="_blank"
          rel="noreferrer"
          className="absolute right-14 bottom-[18px] max-w-[60%] truncate rounded bg-paper/85 px-1 text-[10px] text-muted"
        >
          {TOPO[mapType].credit}
        </a>
      )}
      {/* Map type: plain map, terrain or satellite (with labels). Remembered on this device. */}
      <div className="absolute bottom-7 left-2.5">
        {typeMenuOpen && (
          <div role="menu" className="absolute bottom-full left-0 mb-1.5 flex flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-lg">
            {MAP_TYPES.map((t) => [
              t.group && (
                <span key={`g-${t.group}`} className="border-t border-line px-3.5 pt-2 pb-0.5 text-[11px] font-bold tracking-wide text-muted uppercase">
                  {t.group}
                </span>
              ),
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={mapType === t.id}
                onClick={() => chooseType(t.id)}
                className={`cursor-pointer px-3.5 py-2 text-left text-[14px] whitespace-nowrap ${
                  mapType === t.id ? "bg-soft font-semibold text-ink" : "text-muted"
                }`}
              >
                {t.label}
              </button>,
            ])}
          </div>
        )}
        <button
          type="button"
          onClick={() => setTypeMenuOpen((o) => !o)}
          aria-label="Map type"
          aria-expanded={typeMenuOpen}
          title="Map type"
          className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-paper/95 text-ink shadow"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 20h18L14.5 8l-4 6.5L8 11z" />
            <circle cx="17" cy="5" r="1.8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function FitBounds({ points: all, fitKey }: { points: MapPoint[]; fitKey: string }) {
  const map = useMap();
  // Search results never move the map: you searched the area you were looking at.
  const points = all.filter((p) => !p.result);
  useEffect(() => {
    if (!map || !points.length) return;
    if (points.length === 1) {
      map.panTo(points[0]);
      map.setZoom(11);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
    // Refit only when the view changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

/** Lays an off-road topo map's tiles over the Google map while that map type is chosen. */
function TopoLayer({ type }: { type: MapType }) {
  const map = useMap();
  useEffect(() => {
    const layer = TOPO[type];
    if (!map || !layer) return;
    const tiles = new google.maps.ImageMapType({
      getTileUrl: ({ x, y }, z) => {
        const n = 2 ** z;
        if (y < 0 || y >= n) return null;
        const tx = ((x % n) + n) % n;
        const b = layer.bounds;
        if (b && (tileLng(tx + 1, n) < b.west || tileLng(tx, n) > b.east || tileLat(y, n) < b.south || tileLat(y + 1, n) > b.north))
          return null;
        return layer.url(tx, y, z);
      },
      tileSize: new google.maps.Size(256, 256),
      maxZoom: layer.maxZoom,
      name: type,
    });
    map.overlayMapTypes.push(tiles);
    return () => {
      const i = map.overlayMapTypes.getArray().indexOf(tiles);
      if (i >= 0) map.overlayMapTypes.removeAt(i);
    };
  }, [map, type]);
  return null;
}

// Web Mercator tile edges, in degrees.
const tileLng = (x: number, n: number) => (x / n) * 360 - 180;
const tileLat = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
