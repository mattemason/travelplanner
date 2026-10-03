"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

/** Reports each Google map created (a billed map load) for the admin usage page. Render inside <Map>. */
export function CountMapLoad() {
  const map = useMap();
  useEffect(() => {
    if (map) void fetch("/api/usage/map", { method: "POST", keepalive: true }).catch(() => {});
  }, [map]);
  return null;
}
