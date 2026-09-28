"use client";

import { useState } from "react";
import { dueLabel, dueSoon } from "@/components/planner/due-soon";
import { daysUntil } from "@/lib/trip/format";
import type { ChecklistItem } from "@/lib/trip/types";
import { setChecklistStatus } from "../actions";

export function ChecklistView({ tripId, items: initial }: { tripId: string; items: ChecklistItem[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const done = items.filter((i) => i.status === "done").length;

  const soonIds = new Set(dueSoon(items).map((x) => x.item.id));
  const groups = [
    { title: "Book now", items: items.filter((i) => i.status !== "done" && soonIds.has(i.id)) },
    { title: "Before you go", items: items.filter((i) => i.status !== "done" && !soonIds.has(i.id)) },
    { title: "Done", items: items.filter((i) => i.status === "done") },
  ].filter((g) => g.items.length);

  const toggle = async (item: ChecklistItem) => {
    const nextDone = item.status !== "done";
    const status: ChecklistItem["status"] = nextDone ? "done" : "todo";
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, status } : i)));
    setError(null);
    try {
      await setChecklistStatus(tripId, item.id, nextDone);
    } catch {
      setItems((all) => all.map((i) => (i.id === item.id ? item : i)));
      setError("That didn't save. Check your connection and try again.");
    }
  };

  return (
    <>
      <div className="my-4">
        <span>
          {done} of {items.length} done
        </span>
        <div className="mt-1.5 h-2 overflow-hidden rounded bg-soft">
          <i
            className="block h-full bg-myrtle transition-[width] duration-300"
            style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="notice notice-bad mb-3">
          {error}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.title} className="mb-3">
          <h2 className="mt-3.5 mb-1 text-[20px] font-semibold">{g.title}</h2>
          {g.items.map((item) => {
            const checked = item.status === "done";
            const days = item.dueDate ? daysUntil(item.dueDate) : null;
            return (
              <label key={item.id} className="flex cursor-pointer items-start gap-3 border-t border-line py-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item)}
                  className="mt-0.5 h-[22px] w-[22px] shrink-0 cursor-pointer accent-[var(--myrtle)]"
                />
                <span className={`flex-1 text-[14.5px] ${checked ? "text-muted line-through" : ""}`}>
                  {item.title}
                  {item.category && <small className="block text-[12.5px] text-muted capitalize">{item.category}</small>}
                </span>
                {!checked && (
                  <span
                    className={`text-[12px] font-bold whitespace-nowrap ${soonIds.has(item.id) && item.dueDate ? "text-warn-ink" : "text-muted"}`}
                  >
                    {dueLabel(days, item.dueDate)}
                  </span>
                )}
              </label>
            );
          })}
        </section>
      ))}
    </>
  );
}
