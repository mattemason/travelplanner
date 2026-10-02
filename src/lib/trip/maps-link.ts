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

// Google Maps directions links. With no origin, Google starts from where you are now, which is
// what you want when you tap Navigate on the road. They open the Google Maps app when installed.
const DIRECTIONS = "https://www.google.com/maps/dir/?api=1&travelmode=driving";
const ll = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Turn-by-turn from your location to one point. */
export const navigateTo = (p: { lat: number; lng: number }) => `${DIRECTIONS}&destination=${ll(p)}`;

/** Google allows up to 9 stops on the way (3 in a phone's browser, without the app). */
export const NAV_MAX_WAYPOINTS = 9;

/** Turn-by-turn from your location through a day's points, in order; null when there are none. */
export function navigateRoute(points: { lat: number; lng: number }[]): string | null {
  if (!points.length) return null;
  const via = points.slice(0, -1).slice(0, NAV_MAX_WAYPOINTS);
  const url = `${DIRECTIONS}&destination=${ll(points[points.length - 1])}`;
  return via.length ? `${url}&waypoints=${encodeURIComponent(via.map(ll).join("|"))}` : url;
}
