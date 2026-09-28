"use client";

import { useSyncExternalStore } from "react";

function useMedia(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** 960px and wider gets the three-column planning view. */
export const useIsDesktop = () => useMedia("(min-width: 960px)", true);
export const usePrefersDark = () => useMedia("(prefers-color-scheme: dark)", false);

// Leg colours are stored as their light-mode hex; the design's dark variants are lighter.
const DARK_VARIANT: Record<string, string> = {
  "#2f6b4f": "#62B08A", // Myrtle
  "#c75a1c": "#F0894A", // Lichen
  "#1f5a7a": "#62A8D0", // Ocean
};
export const legColour = (hex: string | undefined, dark: boolean) => {
  const base = hex ?? "#1F5A7A";
  return dark ? (DARK_VARIANT[base.toLowerCase()] ?? base) : base;
};
