"use client";

import { AdvancedMarker, AdvancedMarkerAnchorPoint, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

export type MapPoint = { id: string; lat: number; lng: number; number: number | null; name: string };

type Props = {
  points: MapPoint[];
  routes: string[]; // encoded polylines
  colour: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  fitKey: string; // refit the view when this changes (e.g. the day in view)
  className?: string;
  labels?: boolean;
};

const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
const TASMANIA = { lat: -42.0, lng: 146.6 };

/** A Google map of one day: numbered, labelled pins and the drive route in the leg colour. */
export function TripMap({ points, routes, colour, selectedId, onSelect, fitKey, className, labels = true }: Props) {
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
        {routes.map((path, i) => (
          <Polyline key={`${i}-${path.slice(0, 12)}`} encodedPath={path} strokeColor={colour} strokeWeight={4} strokeOpacity={0.9} />
        ))}
        {points.map((p) => {
          const selected = p.id === selectedId;
          return (
            <AdvancedMarker
              key={p.id}
              position={p}
              title={p.name}
              zIndex={selected ? 10 : 1}
              anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
              onClick={() => onSelect(p.id)}
            >
              {/* The circle is the marker's box, so CENTER puts it on the spot; the label hangs outside. */}
              <div
                className="relative grid place-items-center rounded-full bg-paper font-bold text-ink shadow"
                style={{
                  border: `3px solid ${colour}`,
                  width: selected ? 32 : 26,
                  height: selected ? 32 : 26,
                  fontSize: 12,
                }}
              >
                {p.number ?? "•"}
                {labels && (
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
    // Refit only when the day changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}
