import "server-only";

// Places API (New). Autocomplete and details share a session token, so Google bills a
// search-then-pick as one session.

export type Bounds = { low: { lat: number; lng: number }; high: { lat: number; lng: number } };

export type Suggestion = { placeId: string; main: string; secondary: string };

export type FoundPlace = {
  googlePlaceId: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  businessStatus: string | null;
  mapsUrl: string | null;
};

const key = () => {
  const k = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!k) throw new Error("GOOGLE_MAPS_SERVER_KEY is not set");
  return k;
};

const rectangle = (b: Bounds) => ({
  rectangle: {
    low: { latitude: b.low.lat, longitude: b.low.lng },
    high: { latitude: b.high.lat, longitude: b.high.lng },
  },
});

export async function autocomplete(input: string, sessionToken: string, bias: Bounds | null): Promise<Suggestion[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key() },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ["au"],
      languageCode: "en-AU",
      ...(bias && { locationBias: rectangle(bias) }),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Places autocomplete ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        text?: { text: string };
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
      };
    }[];
  };
  return (body.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    if (!p) return [];
    return [
      {
        placeId: p.placeId,
        main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      },
    ];
  });
}

export async function placeDetails(placeId: string, sessionToken?: string): Promise<FoundPlace | null> {
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return null;
  const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
  url.searchParams.set("languageCode", "en-AU");
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": key(),
      "X-Goog-FieldMask": "id,displayName,location,formattedAddress,businessStatus,googleMapsUri",
    },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Place details ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const p = (await res.json()) as {
    id: string;
    displayName?: { text: string };
    location?: { latitude: number; longitude: number };
    formattedAddress?: string;
    businessStatus?: string;
    googleMapsUri?: string;
  };
  if (!p.location) return null;
  return {
    googlePlaceId: p.id,
    name: p.displayName?.text ?? "Unnamed place",
    lat: p.location.latitude,
    lng: p.location.longitude,
    address: p.formattedAddress ?? null,
    businessStatus: p.businessStatus ?? null,
    mapsUrl: p.googleMapsUri ?? null,
  };
}

export type SearchResult = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  type: string | null;
  rating: number | null;
  ratings: number | null;
  businessStatus: string | null;
  mapsUrl: string | null;
};

/** Places matching free text ("campgrounds", "fuel") inside a rectangle, best matches first. */
export async function searchInArea(query: string, area: Bounds): Promise<SearchResult[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key(),
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.location",
        "places.formattedAddress",
        "places.primaryTypeDisplayName",
        "places.rating",
        "places.userRatingCount",
        "places.businessStatus",
        "places.googleMapsUri",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery: query,
      locationRestriction: rectangle(area),
      pageSize: 20,
      languageCode: "en-AU",
      regionCode: "AU",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Places text search ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    places?: {
      id: string;
      displayName?: { text: string };
      location?: { latitude: number; longitude: number };
      formattedAddress?: string;
      primaryTypeDisplayName?: { text: string };
      rating?: number;
      userRatingCount?: number;
      businessStatus?: string;
      googleMapsUri?: string;
    }[];
  };
  return (body.places ?? []).flatMap((p) =>
    p.location
      ? [
          {
            placeId: p.id,
            name: p.displayName?.text ?? "Unnamed place",
            lat: p.location.latitude,
            lng: p.location.longitude,
            address: p.formattedAddress ?? null,
            type: p.primaryTypeDisplayName?.text ?? null,
            rating: p.rating ?? null,
            ratings: p.userRatingCount ?? null,
            businessStatus: p.businessStatus ?? null,
            mapsUrl: p.googleMapsUri ?? null,
          },
        ]
      : [],
  );
}
