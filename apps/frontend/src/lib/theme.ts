import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "dbforge_theme";
const listeners = new Set<() => void>();
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let pref: ThemePref = readPref();

export function resolveTheme(p: ThemePref = pref): "light" | "dark" {
  if (p === "system") return media && !media.matches ? "light" : "dark";
  return p;
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme();
}

const notify = () => listeners.forEach((l) => l());

export function setThemePref(p: ThemePref): void {
  pref = p;
  try { localStorage.setItem(KEY, p); } catch { /* storage unavailable */ }
  applyTheme();
  notify();
}

media?.addEventListener("change", () => {
  if (pref === "system") { applyTheme(); notify(); }
});

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => pref);
  const resolved = useSyncExternalStore(subscribe, () => resolveTheme(pref));
  return { pref: current, resolved, setPref: setThemePref };
}
