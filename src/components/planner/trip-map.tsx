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
};
export type MapRoute = { path: string; colour: string }; // encoded polyline

type Props = {
  points: MapPoint[];
  routes: MapRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  fitKey: string; // refit the view when this changes (the day in view, or whole-trip mode)
  className?: string;
  labels?: boolean;
};

const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
const TASMANIA = { lat: -42.0, lng: 146.6 };

/** A Google map of pins and drive routes: one day, or the whole trip. */
export function TripMap({ points, routes, selectedId, onSelect, fitKey, className, labels = true }: Props) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <Map
        mapId={MAP_ID}
        defaultCenter={TASMANIA}
        defaultZoom={7}
        colorScheme="FOLLOW_SYSTEM"
        gestureHandling="cooperative"
        disableDefaultUI
        zoomControl
        clickableIcons={false}
        className="h-full w-full"
      >
        {routes.map((r, i) => (
          <Polyline
            key={`${i}-${r.path.slice(0, 12)}`}
            encodedPath={r.path}
            strokeColor={r.colour}
            strokeWeight={4}
            strokeOpacity={0.9}
          />
        ))}
        {points.map((p) => {
          const selected = p.id === selectedId;
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

function FitBounds({ points, fitKey }: { points: MapPoint[]; fitKey: string }) {
  const map = useMap();
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
