"use client";

import Sortable from "sortablejs";
import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  container: string; // day id or "tray"
  onMove: (stopId: string, toContainer: string, toIndex: number) => void;
  className?: string;
  children: ReactNode;
};

/**
 * A drop zone shared by every day and the tray. SortableJS moves the DOM node itself; on
 * drop we put the node back where React rendered it and report the move, so React stays the
 * only thing that decides where stops live.
 */
export function SortableList({ container, onMove, className, children }: Props) {
  const ref = useRef<HTMLOListElement>(null);
  const onMoveRef = useRef(onMove);

  useEffect(() => {
    onMoveRef.current = onMove;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sortable = Sortable.create(el, {
      group: "trip",
      animation: reduce ? 0 : 150,
      delay: 180, // press and hold on touch, so a normal swipe still scrolls
      delayOnTouchOnly: true,
      filter: ".edit-btn, a",
      preventOnFilter: false,
      draggable: "[data-stop-id]",
      scroll: true,
      scrollSensitivity: 80,
      scrollSpeed: 14,
      onEnd(evt) {
        const stopId = evt.item.dataset.stopId;
        const to = (evt.to as HTMLElement).dataset.container;
        if (!stopId || !to || evt.newIndex === undefined || evt.oldIndex === undefined) return;
        if (evt.from === evt.to && evt.newIndex === evt.oldIndex) return;
        // Undo Sortable's DOM move; React re-renders the list from state.
        evt.item.remove();
        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex] ?? null);
        onMoveRef.current(stopId, to, evt.newIndex);
      },
    });
    return () => sortable.destroy();
  }, []);

  return (
    <ol ref={ref} data-container={container} className={`stop-list ${className ?? ""}`}>
      {children}
    </ol>
  );
}
