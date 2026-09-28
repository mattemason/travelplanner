import type { Place } from "./types";

/** Opens a place in Google Maps: its saved Maps link, else its coordinates, else a name search. */
export function googleMapsLink(place: Place | undefined, fallbackName: string): string {
  if (place?.mapsUrl) return place.mapsUrl;
  const query = place?.lat != null && place.lng != null ? `${place.lat},${place.lng}` : (place?.name ?? fallbackName);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Hipcamp's search centred on a place (needs coordinates); null when the place isn't on the map. */
export function hipcampLink(place: Place | undefined, name: string): string | null {
  if (place?.lat == null || place.lng == null) return null;
  const params = new URLSearchParams({ q: name, lat: place.lat.toFixed(4), lng: place.lng.toFixed(4) });
  return `https://www.hipcamp.com/en-AU/search?${params}`;
}
