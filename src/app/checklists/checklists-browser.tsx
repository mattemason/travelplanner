"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TagsInput } from "@/components/checklists/tags-input";
import type { ChecklistSummary } from "@/lib/checklists";
import { shortDate } from "@/lib/trip/format";
import { createChecklist, deleteChecklist } from "./actions";

type Trip = { id: string; name: string };
type Props = { lists: ChecklistSummary[]; trips: Trip[]; initialTrip: string; initialTag: string | null };

const NO_TRIP = "none";

export function ChecklistsBrowser({ lists: initialLists, trips, initialTrip, initialTag }: Props) {
  const router = useRouter();
  const [lists, setLists] = useState(initialLists);
  const [tripFilter, setTripFilter] = useState(
    initialTrip === "all" || initialTrip === NO_TRIP || trips.some((t) => t.id === initialTrip) ? initialTrip : "all",
  );
  const [tagFilter, setTagFilter] = useState<string | null>(initialTag);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allTags = useMemo(() => [...new Set(lists.flatMap((l) => l.tags))].sort((a, b) => a.localeCompare(b)), [lists]);
  const shown = lists.filter(
    (l) =>
      (tripFilter === "all" || (tripFilter === NO_TRIP ? !l.tripId : l.tripId === tripFilter)) &&
      (!tagFilter || l.tags.includes(tagFilter)) &&
      (!query.trim() || l.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  const remove = async (l: ChecklistSummary) => {
    if (!window.confirm(`Delete "${l.name}" and its ${l.total} ${l.total === 1 ? "item" : "items"}? This can't be undone.`)) return;
    setLists((xs) => xs.filter((x) => x.id !== l.id));
    try {
      await deleteChecklist(l.id);
    } catch {
      setLists((xs) => [l, ...xs]);
      setError("That delete didn't save. Try again.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-[760px] flex-1 px-4 pt-[calc(20px+env(safe-area-inset-top))] pb-16">
      <Link href="/" className="text-[14px] text-ocean">
        ‹ Trips
      </Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[34px] font-bold">Checklists</h1>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            New checklist
          </button>
        )}
      </div>

      {creating && (
        <NewChecklist
          trips={trips}
          defaultTrip={tripFilter !== "all" && tripFilter !== NO_TRIP ? tripFilter : null}
          tagSuggestions={allTags}
          onCancel={() => setCreating(false)}
          onCreated={(id) => router.push(`/checklists/${id}`)}
        />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search checklists"
          aria-label="Search checklists"
          className="min-w-0 flex-1 rounded-[10px] border-[1.5px] border-line bg-paper px-3 py-2 text-[16px]"
        />
        <select
          value={tripFilter}
          onChange={(e) => setTripFilter(e.target.value)}
          aria-label="Filter by trip"
          className="rounded-[10px] border-[1.5px] border-line bg-paper px-2.5 py-2 text-[15px]"
        >
          <option value="all">All trips</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value={NO_TRIP}>Not linked to a trip</option>
        </select>
      </div>
      {allTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tagFilter === tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={`min-h-8 cursor-pointer rounded-full border-[1.5px] px-3 text-[13px] ${
                tagFilter === tag ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="notice notice-bad mt-3">
          {error}
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-2.5">
        {shown.map((l) => (
          <li key={l.id} className="relative rounded-xl border border-line bg-paper p-4 hover:border-muted">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[22px] font-bold">
                  <Link href={`/checklists/${l.id}`} className="after:absolute after:inset-0">
                    {l.name}
                  </Link>
                </h2>
                <p className="text-[13.5px] text-muted">
                  {l.tripName ?? "No trip"}
                  {l.nextDue ? ` · next due ${shortDate(l.nextDue)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(l)}
                className="relative z-10 cursor-pointer text-[13px] text-bad-ink underline"
              >
                Delete
              </button>
            </div>
            {l.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {l.tags.map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2.5 text-[13px] text-muted">
              <div className="h-2 flex-1 overflow-hidden rounded bg-soft">
                <i className="block h-full bg-myrtle" style={{ width: `${l.total ? (l.done / l.total) * 100 : 0}%` }} />
              </div>
              {l.done} of {l.total} done
            </div>
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="mt-6 text-center text-muted">
          {lists.length ? "No checklists match these filters." : "No checklists yet. Create one to get started."}
        </p>
      )}
    </main>
  );
}

function NewChecklist({
  trips,
  defaultTrip,
  tagSuggestions,
  onCancel,
  onCreated,
}: {
  trips: Trip[];
  defaultTrip: string | null;
  tagSuggestions: string[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [tripId, setTripId] = useState<string | null>(defaultTrip);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-4 rounded-2xl border border-line bg-paper p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          const r = await createChecklist({ name, tripId, tags });
          if (r.ok) onCreated(r.value);
          else setError(r.error);
        } catch {
          setError("Couldn't create it. Try again.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <h2 className="text-[22px] font-bold">New checklist</h2>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. Camping gear" />
      </label>
      <label className="field">
        Trip
        <select value={tripId ?? ""} onChange={(e) => setTripId(e.target.value || null)}>
          <option value="">Not linked to a trip</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        Tags
        <TagsInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
      </div>
      {error && (
        <p role="alert" className="notice notice-bad">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary flex-1" disabled={saving}>
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
