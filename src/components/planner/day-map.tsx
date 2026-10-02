"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { useState } from "react";
import { useIsDark } from "@/components/theme";
import type { MapType } from "@/lib/trip/map-types";
import { TripMap } from "./trip-map";
import { legColour } from "./use-media";

export type DayMapPoint = { id: string; lat: number; lng: number; badge: string | null; name: string };
export type DayMapRoute = { path: string } | { points: { lat: number; lng: number }[] };

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

/** One day's stops and route on a Google map, for the day view. */
type Props = { points: DayMapPoint[]; routes: DayMapRoute[]; legHex: string; mapTypes: readonly MapType[] };

export function DayMap({ points, routes, legHex, mapTypes }: Props) {
  const dark = useIsDark();
  const [selected, setSelected] = useState<string | null>(null);
  const colour = legColour(legHex, dark);
  if (!MAPS_KEY || !points.length) return null;
  return (
    <APIProvider apiKey={MAPS_KEY} language="en-AU" region="AU">
      <TripMap
        points={points.map((p) => ({ ...p, colour }))}
        routes={routes.map((r) =>
          "path" in r ? { path: r.path, colour } : { points: r.points, colour, dashed: true as const },
        )}
        selectedId={selected}
        onSelect={setSelected}
        fitKey="day"
        dark={dark}
        labels
        mapTypes={mapTypes}
        className="h-[260px] border-y border-line"
      />
    </APIProvider>
  );
}
