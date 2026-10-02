"use client";

import Sortable from "sortablejs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { reorderTrips } from "@/app/trips/order-action";

type Props = {
  tiles: { id: string; tile: ReactNode }[];
  after?: ReactNode; // the "Plan a new trip" tile: always last, not draggable
};

/**
 * The home page's trip tiles, in the user's own order. Drag a tile (press and hold on touch)
 * to move it; the new order is saved. As in the planner, SortableJS's DOM move is undone and
 * React renders the order from state.
 */
export function TripGrid({ tiles, after }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [order, setOrder] = useState(() => tiles.map((t) => t.id));
  const [error, setError] = useState(false);
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sortable = Sortable.create(el, {
      animation: reduce ? 0 : 150,
      delay: 200,
      delayOnTouchOnly: true,
      draggable: "[data-trip-id]",
      filter: "button",
      preventOnFilter: false,
      ghostClass: "opacity-40",
      onEnd(evt) {
        const { oldIndex, newIndex } = evt;
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
        evt.item.remove();
        evt.from.insertBefore(evt.item, evt.from.children[oldIndex] ?? null);
        const next = [...orderRef.current];
        const [moved] = next.splice(oldIndex, 1);
        next.splice(Math.min(newIndex, next.length), 0, moved);
        setOrder(next);
        setError(false);
        reorderTrips(next).catch(() => setError(true));
      },
    });
    return () => sortable.destroy();
  }, []);

  const byId = new Map(tiles.map((t) => [t.id, t.tile]));
  // Trips added or removed since the page loaded: keep the known order, new ones at the end.
  const ids = [...order.filter((id) => byId.has(id)), ...tiles.map((t) => t.id).filter((id) => !order.includes(id))];

  return (
    <>
      <div ref={ref} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {ids.map((id) => (
          <div key={id} data-trip-id={id} className="flex cursor-grab touch-manipulation active:cursor-grabbing">
            {byId.get(id)}
          </div>
        ))}
        {after}
      </div>
      {error && (
        <p role="alert" className="notice notice-bad mt-3">
          Couldn&apos;t save the new order. Try again.
        </p>
      )}
    </>
  );
}
