"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createTrip, type NewTripState } from "./actions";

export function NewTripForm() {
  const [state, action, pending] = useActionState<NewTripState, FormData>(createTrip, { error: null });
  const [start, setStart] = useState(state.values?.startDate ?? "");

  return (
    <form action={action} className="mt-4 rounded-2xl border border-line bg-paper p-4">
      <label className="field !mt-0">
        Trip name
        <input name="name" required maxLength={120} defaultValue={state.values?.name} placeholder="e.g. Victorian High Country" />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="field">
          Starts
          <input name="startDate" type="date" required defaultValue={state.values?.startDate} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          Ends
          <input name="endDate" type="date" required min={start || undefined} defaultValue={state.values?.endDate} />
        </label>
      </div>
      {state.error && (
        <p role="alert" className="notice notice-bad mt-2">
          {state.error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Link href="/" className="btn flex-1">
          Cancel
        </Link>
        <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
          {pending ? "Creating…" : "Create trip"}
        </button>
      </div>
    </form>
  );
}
