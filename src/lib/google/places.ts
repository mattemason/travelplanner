import "server-only";

export type FoundPlace = {
  googlePlaceId: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  businessStatus: string | null;
  mapsUrl: string | null;
};

/** Best Places API (New) match for free text, biased to a rectangle. Null if none or on error. */
export async function findPlace(
  text: string,
  bias?: { low: { lat: number; lng: number }; high: { lat: number; lng: number } },
): Promise<FoundPlace | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key || !text.trim()) return null;
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.formattedAddress,places.businessStatus,places.googleMapsUri",
    },
    body: JSON.stringify({
      textQuery: text,
      maxResultCount: 1,
      ...(bias && {
        locationBias: {
          rectangle: {
            low: { latitude: bias.low.lat, longitude: bias.low.lng },
            high: { latitude: bias.high.lat, longitude: bias.high.lng },
          },
        },
      }),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`Places API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const body = (await res.json()) as {
    places?: {
      id: string;
      displayName?: { text: string };
      location?: { latitude: number; longitude: number };
      formattedAddress?: string;
      businessStatus?: string;
      googleMapsUri?: string;
    }[];
  };
  const p = body.places?.[0];
  if (!p?.location) return null;
  return {
    googlePlaceId: p.id,
    name: p.displayName?.text ?? text,
    lat: p.location.latitude,
    lng: p.location.longitude,
    address: p.formattedAddress ?? null,
    businessStatus: p.businessStatus ?? null,
    mapsUrl: p.googleMapsUri ?? null,
  };
}
