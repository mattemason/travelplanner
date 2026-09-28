"use client";

import { useCallback, useSyncExternalStore } from "react";

// Desktop layout choices (hidden sidebar / top bar), remembered per browser.
export type LayoutPrefs = { rail: boolean; header: boolean };
const KEY = "trip-planner.layout";
const DEFAULTS: LayoutPrefs = { rail: true, header: true };
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: LayoutPrefs } | null = null;

function read(): LayoutPrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked (private mode, settings); fall back to defaults.
  }
  if (cached && cached.raw === raw) return cached.value;
  let value = DEFAULTS;
  try {
    if (raw) value = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LayoutPrefs>) };
  } catch {
    value = DEFAULTS;
  }
  cached = { raw, value };
  return value;
}

export function useLayoutPrefs(): [LayoutPrefs, (patch: Partial<LayoutPrefs>) => void] {
  const prefs = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
    () => DEFAULTS,
  );
  const update = useCallback((patch: Partial<LayoutPrefs>) => {
    const next = { ...read(), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      cached = { raw: JSON.stringify(next), value: next }; // still apply for this session
    }
    listeners.forEach((l) => l());
  }, []);
  return [prefs, update];
}
