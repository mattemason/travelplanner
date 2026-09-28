"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTrip } from "@/app/trips/delete-action";

/** Deletes a trip after confirming, then goes to the home page. */
export function DeleteTripButton({ tripId, name, className = "" }: { tripId: string; name: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={`cursor-pointer text-[13px] text-bad-ink underline disabled:opacity-50 ${className}`}
      onClick={async () => {
        if (!window.confirm(`Delete "${name}"? Its days, stops, attached files and plans are deleted too. This can't be undone.`)) {
          return;
        }
        setBusy(true);
        try {
          await deleteTrip(tripId);
          router.push("/");
          router.refresh();
        } catch {
          setBusy(false);
          window.alert("Couldn't delete the trip. Try again.");
        }
      }}
    >
      {busy ? "Deleting…" : "Delete trip"}
    </button>
  );
}
