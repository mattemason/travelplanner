"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme-boot";

// Auto follows the device; Light and Dark override it. Stored per browser and applied as
// data-theme on <html> (set before first paint by the script in the root layout).
export type Theme = "system" | "light" | "dark";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    mql.removeEventListener("change", onChange);
  };
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  const setTheme = useCallback((t: Theme) => {
    try {
      if (t === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, t);
    } catch {
      // Storage blocked: still apply for this page.
    }
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    listeners.forEach((l) => l());
  }, []);
  return [theme, setTheme];
}

/** Whether the page is currently dark, from the user's choice or the device setting. */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const t = readTheme();
      return t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    },
    () => false,
  );
}
