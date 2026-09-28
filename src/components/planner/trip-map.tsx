"use client";

import { AdvancedMarker, AdvancedMarkerAnchorPoint, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

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
  onBoundsChanged?: (bounds: MapBounds) => void;
  dark?: boolean; // the app's theme, so the map matches Light/Dark choices
  onPlaceClick?: (googlePlaceId: string) => void; // a tap on one of Google's own map icons
};

const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
const TASMANIA = { lat: -42.0, lng: 146.6 };

/** A Google map of pins and drive routes: one day, or the whole trip. */
export function TripMap(props: Props) {
  const { points, routes, selectedId, onSelect, fitKey, className, labels = true, onBoundsChanged, dark = false } = props;
  const { onPlaceClick } = props;
  return (
    <div className={`relative ${className ?? ""}`}>
      <Map
        key={dark ? "dark" : "light"} // the colour scheme is fixed when the map is created
        mapId={MAP_ID}
        defaultCenter={TASMANIA}
        defaultZoom={7}
        colorScheme={dark ? "DARK" : "LIGHT"}
        gestureHandling="cooperative"
        disableDefaultUI
        zoomControl
        clickableIcons={!!onPlaceClick}
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
                {labels && (p.badge !== null || selected) && (
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
      </Map>
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
