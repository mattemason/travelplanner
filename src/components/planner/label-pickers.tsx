"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TAGS } from "@/lib/trip/types";

export type LabelResult = { ok: true } | { ok: false; error: string };
export type LabelOps = {
  add: (name: string) => Promise<LabelResult>;
  rename: (from: string, to: string) => Promise<LabelResult>;
  remove: (name: string) => Promise<LabelResult>;
};

/** Rename and delete rows for a user-defined list (categories or custom tags). */
function ListEditor({ names, ops, noun }: { names: string[]; ops: LabelOps; noun: string }) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (p: Promise<LabelResult>) => {
    setBusy(true);
    setError(null);
    const r = await p.catch(() => ({ ok: false as const, error: "That didn't save. Try again." }));
    setBusy(false);
    if (!r.ok) setError(r.error);
    return r.ok;
  };

  if (!names.length) return <p className="px-1 py-2 text-[13px] text-muted">No {noun}s yet.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {names.map((n) => (
        <div key={n} className="flex items-center gap-1.5">
          <input
            value={editing[n] ?? n}
            onChange={(e) => setEditing({ ...editing, [n]: e.target.value })}
            aria-label={`Rename ${n}`}
            className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-soft px-2 py-1 text-[15px] font-normal text-ink"
          />
          {editing[n] !== undefined && editing[n] !== n && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await run(ops.rename(n, editing[n])))
                  setEditing((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== n)));
              }}
              className="cursor-pointer text-[13px] font-bold text-ocean"
            >
              Save
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete "${n}"? It's removed from every stop that uses it.`)) void run(ops.remove(n));
            }}
            className="cursor-pointer text-[13px] text-bad-ink underline"
          >
            Delete
          </button>
        </div>
      ))}
      {error && <p className="text-[12.5px] text-bad-ink">{error}</p>}
    </div>
  );
}

/** Small "add a new one" field. */
function AddField({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => Promise<LabelResult> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    const r = await onAdd(value.trim()).catch(() => ({ ok: false as const, error: "That didn't save. Try again." }));
    setBusy(false);
    if (r.ok) setValue("");
    else setError(r.error);
  };
  return (
    <div>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation(); // don't save the whole stop
              void submit();
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-soft px-2 py-1 text-[15px] font-normal text-ink"
        />
        <button type="button" disabled={busy || !value.trim()} onClick={submit} className="btn !min-h-8 !px-3 !text-[13px]">
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-[12.5px] font-normal text-bad-ink">{error}</p>}
    </div>
  );
}

type CategoryProps = { options: string[]; selected: string[]; onChange: (next: string[]) => void; ops: LabelOps };

/** Categories: a dropdown of checkboxes (one or many), plus add, rename and delete. */
export function CategoryPicker({ options, selected, onChange, ops }: CategoryProps) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (c: string) => onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="flex min-h-[42px] w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border-[1.5px] border-line bg-soft px-2.5 py-1.5 text-left font-normal text-ink"
      >
        <span className="flex flex-wrap gap-1">
          {selected.length ? (
            selected.map((c) => (
              <span key={c} className="chip border-ocean text-ocean">
                {c}
              </span>
            ))
          ) : (
            <span className="text-[15px] text-muted">Choose categories</span>
          )}
        </span>
        <span aria-hidden="true" className="text-muted">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={listId}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-paper p-2 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {managing ? (
            <ListEditor names={options} ops={ops} noun="category" />
          ) : (
            <fieldset>
              <legend className="sr-only">Categories</legend>
              {options.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[15px] font-normal text-ink hover:bg-soft">
                  <input
                    type="checkbox"
                    checked={selected.includes(c)}
                    onChange={() => toggle(c)}
                    className="h-[18px] w-[18px] cursor-pointer accent-[var(--ocean)]"
                  />
                  {c}
                </label>
              ))}
            </fieldset>
          )}
          <div className="mt-2 border-t border-line pt-2">
            <AddField
              placeholder="New category"
              onAdd={async (n) => {
                const r = await ops.add(n);
                if (r.ok && !selected.includes(n)) onChange([...selected, n]);
                return r;
              }}
            />
            <button
              type="button"
              onClick={() => setManaging(!managing)}
              className="mt-2 cursor-pointer text-[13px] font-bold text-ocean"
            >
              {managing ? "Done editing" : "Edit list"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type TagProps = { custom: string[]; selected: string[]; onChange: (next: string[]) => void; ops: LabelOps };

/** Tags: the built-in ones plus the user's own, toggled as chips; add, rename and delete own tags. */
export function TagPicker({ custom, selected, onChange, ops }: TagProps) {
  const [managing, setManaging] = useState(false);
  const all = [...TAGS.map((t) => ({ key: t.key as string, label: t.label as string })), ...custom.map((c) => ({ key: c, label: c }))];
  // Keep any tag already on the stop visible, even if it's since been removed from the list.
  for (const s of selected) if (!all.some((a) => a.key === s)) all.push({ key: s, label: s });

  return (
    <div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Tags">
        {all.map((t) => {
          const on = selected.includes(t.key);
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((x) => x !== t.key) : [...selected, t.key])}
              className={`min-h-9 cursor-pointer rounded-full border-[1.5px] px-3 text-[13px] font-normal ${
                on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2">
        <AddField
          placeholder="New tag"
          onAdd={async (n) => {
            const r = await ops.add(n);
            if (r.ok && !selected.includes(n)) onChange([...selected, n]);
            return r;
          }}
        />
      </div>
      {custom.length > 0 && (
        <button type="button" onClick={() => setManaging(!managing)} className="mt-1.5 cursor-pointer text-[13px] font-bold text-ocean">
          {managing ? "Done editing tags" : "Edit my tags"}
        </button>
      )}
      {managing && (
        <div className="mt-1.5 rounded-xl border border-line p-2">
          <ListEditor names={custom} ops={ops} noun="tag" />
        </div>
      )}
    </div>
  );
}
