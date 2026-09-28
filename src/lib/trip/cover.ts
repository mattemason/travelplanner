/** URL of a trip's cover photo, versioned so browsers never show a stale copy; null if none. */
export const coverUrl = (tripId: string, version: number | null) =>
  version ? `/api/trips/${tripId}/cover?v=${version}` : null;
