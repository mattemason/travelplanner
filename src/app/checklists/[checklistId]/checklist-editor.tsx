"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TagsInput } from "@/components/checklists/tags-input";
import type { ChecklistDetail, ChecklistItemRow } from "@/lib/checklists";
import { daysUntil, shortDate } from "@/lib/trip/format";
import { addItem, deleteChecklist, deleteItem, setItemDone, updateChecklist, updateItem } from "../actions";

type Trip = { id: string; name: string };
// "permit" items feed the trip's "Permit needed" warnings.
const ITEM_CATEGORIES = ["booking", "permit", "pass", "gear", "other"];

export function ChecklistEditor({ list, trips, tagSuggestions }: { list: ChecklistDetail; trips: Trip[]; tagSuggestions: string[] }) {
  const router = useRouter();
  const [meta, setMeta] = useState({ name: list.name, tripId: list.tripId, tags: list.tags });
  const [saved, setSaved] = useState(meta);
  const [items, setItems] = useState(list.items);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(meta) !== JSON.stringify(saved);
  const done = items.filter((i) => i.done).length;

  const run = async (fn: () => Promise<void>, rollback?: () => void) => {
    setError(null);
    try {
      await fn();
    } catch {
      rollback?.();
      setError("That didn't save. Check your connection and try again.");
    }
  };

  const saveMeta = () =>
    run(async () => {
      const r = await updateChecklist(list.id, meta);
      if (!r.ok) throw setError(r.error);
      setSaved(meta);
    });

  const toggle = (item: ChecklistItemRow) => {
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)));
    void run(
      () => setItemDone(item.id, !item.done),
      () => setItems((xs) => xs.map((x) => (x.id === item.id ? item : x))),
    );
  };

  const remove = (item: ChecklistItemRow) => {
    const before = items;
    setItems((xs) => xs.filter((x) => x.id !== item.id));
    void run(() => deleteItem(item.id), () => setItems(before));
  };

  const open = items.filter((i) => !i.done).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const finished = items.filter((i) => i.done);

  return (
    <main className="mx-auto w-full max-w-[680px] flex-1 px-4 pt-[calc(20px+env(safe-area-inset-top))] pb-16">
      <Link href={meta.tripId ? `/checklists?trip=${meta.tripId}` : "/checklists"} className="text-[14px] text-ocean">
        ‹ Checklists
      </Link>

      <section className="mt-2 rounded-2xl border border-line bg-paper p-4">
        <label className="field !mt-0">
          Name
          <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} className="!text-[20px] !font-bold" />
        </label>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <label className="field">
            Trip
            <select value={meta.tripId ?? ""} onChange={(e) => setMeta({ ...meta, tripId: e.target.value || null })}>
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
            <TagsInput value={meta.tags} onChange={(tags) => setMeta({ ...meta, tags })} suggestions={tagSuggestions} />
          </div>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => setMeta(saved)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={saveMeta}>
              Save changes
            </button>
          </div>
        )}
      </section>

      <div className="my-4">
        <span>
          {done} of {items.length} done
        </span>
        <div className="mt-1.5 h-2 overflow-hidden rounded bg-soft">
          <i className="block h-full bg-myrtle transition-[width]" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </div>
      </div>

      {error && (
        <p role="alert" className="notice notice-bad mb-3">
          {error}
        </p>
      )}

      <AddItem
        onAdd={async (fields) => {
          const r = await addItem(list.id, fields);
          if (!r.ok) return r.error;
          setItems((xs) => [...xs, { id: r.value, ...fields, done: false, notes: "" }]);
          return null;
        }}
      />

      {[
        { title: "To do", rows: open },
        { title: "Done", rows: finished },
      ]
        .filter((g) => g.rows.length)
        .map((g) => (
          <section key={g.title} className="mt-4">
            <h2 className="mb-1 text-[20px] font-semibold">{g.title}</h2>
            <ul>
              {g.rows.map((item) =>
                editingItem === item.id ? (
                  <li key={item.id} className="border-t border-line py-2">
                    <ItemForm
                      initial={item}
                      submitLabel="Save"
                      onCancel={() => setEditingItem(null)}
                      onSubmit={async (fields) => {
                        const r = await updateItem(item.id, fields);
                        if (!r.ok) return r.error;
                        setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, ...fields } : x)));
                        setEditingItem(null);
                        return null;
                      }}
                    />
                  </li>
                ) : (
                  <li key={item.id} className="flex items-start gap-3 border-t border-line py-3">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggle(item)}
                      aria-label={`${item.done ? "Untick" : "Tick"} ${item.title}`}
                      className="mt-0.5 h-[22px] w-[22px] shrink-0 cursor-pointer accent-[var(--myrtle)]"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingItem(item.id)}
                      className={`flex-1 cursor-pointer text-left text-[15px] ${item.done ? "text-muted line-through" : ""}`}
                    >
                      {item.title}
                      {item.category && <small className="block text-[12.5px] text-muted capitalize">{item.category}</small>}
                    </button>
                    {item.dueDate && !item.done && (
                      <span
                        className={`text-[12px] font-bold whitespace-nowrap ${daysUntil(item.dueDate) <= 14 ? "text-warn-ink" : "text-muted"}`}
                      >
                        {daysUntil(item.dueDate) < 0 ? "Overdue" : shortDate(item.dueDate)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      aria-label={`Delete ${item.title}`}
                      className="cursor-pointer px-1 text-[18px] leading-none text-muted hover:text-bad-ink"
                    >
                      ×
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}

      <button
        type="button"
        className="mt-8 cursor-pointer text-[13.5px] text-bad-ink underline"
        onClick={async () => {
          if (!window.confirm(`Delete "${saved.name}" and all its items? This can't be undone.`)) return;
          await run(async () => {
            await deleteChecklist(list.id);
            router.push("/checklists");
          });
        }}
      >
        Delete this checklist
      </button>
    </main>
  );
}

type Fields = { title: string; dueDate: string | null; category: string | null };

function AddItem({ onAdd }: { onAdd: (f: Fields) => Promise<string | null> }) {
  const [key, setKey] = useState(0);
  return (
    <div className="rounded-2xl border border-line bg-paper p-3">
      <ItemForm
        key={key}
        initial={{ title: "", dueDate: null, category: null }}
        submitLabel="Add item"
        onSubmit={async (f) => {
          const err = await onAdd(f);
          if (!err) setKey((k) => k + 1); // reset the form
          return err;
        }}
      />
    </div>
  );
}

function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Fields;
  submitLabel: string;
  onSubmit: (f: Fields) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<Fields>({ title: initial.title, dueDate: initial.dueDate, category: initial.category });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setError(await onSubmit(f));
        } catch {
          setError("That didn't save. Try again.");
        } finally {
          setBusy(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel) onCancel();
      }}
    >
      <input
        value={f.title}
        onChange={(e) => setF({ ...f, title: e.target.value })}
        placeholder="New item, e.g. Book Corinna cabin"
        aria-label="Item"
        autoFocus={!!onCancel}
        required
        className="w-full rounded-[10px] border-[1.5px] border-line bg-soft px-3 py-2 text-[16px]"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="date"
          value={f.dueDate ?? ""}
          onChange={(e) => setF({ ...f, dueDate: e.target.value || null })}
          aria-label="Due date"
          className="rounded-[10px] border-[1.5px] border-line bg-soft px-2 py-1.5 text-[15px]"
        />
        <select
          value={f.category ?? ""}
          onChange={(e) => setF({ ...f, category: e.target.value || null })}
          aria-label="Category"
          className="rounded-[10px] border-[1.5px] border-line bg-soft px-2 py-1.5 text-[15px] capitalize"
        >
          <option value="">No category</option>
          {ITEM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" className="btn !min-h-9" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-primary !min-h-9" disabled={busy || !f.title.trim()}>
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-[13px] text-bad-ink">{error}</p>}
    </form>
  );
}
