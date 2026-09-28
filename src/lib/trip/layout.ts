import type { Layout } from "./types";

/** Moves a stop to `toIndex` in container `to`, returning a new layout. */
export function moveStop(layout: Layout, stopId: string, to: string, toIndex: number): Layout {
  const next: Layout = {};
  for (const [key, ids] of Object.entries(layout)) next[key] = ids.filter((id) => id !== stopId);
  const target = next[to] ?? [];
  const index = Math.max(0, Math.min(toIndex, target.length));
  next[to] = [...target.slice(0, index), stopId, ...target.slice(index)];
  return next;
}

export function containerOf(layout: Layout, stopId: string): string | null {
  for (const [key, ids] of Object.entries(layout)) if (ids.includes(stopId)) return key;
  return null;
}

/** The containers whose order differs between two layouts. */
export function changedContainers(before: Layout, after: Layout): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => (before[k] ?? []).join() !== (after[k] ?? []).join());
}
