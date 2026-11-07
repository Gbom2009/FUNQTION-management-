import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "./storage";
import type { MapTheme } from "../theme/mapStyle";
import type { Lang } from "../i18n";

export type Mode = "plan" | "drive" | "settings";

interface AppState {
  mode: Mode;
  lang: Lang;
  theme: MapTheme;
  /** Follow sunrise/sunset (Phase 3 wires the real calculation). */
  autoTheme: boolean;
  setMode: (m: Mode) => void;
  setLang: (l: Lang) => void;
  setTheme: (t: MapTheme) => void;
  setAutoTheme: (a: boolean) => void;
}

// Phase 1: localStorage persistence. Swapped for the Tauri store plugin later.
export const useApp = create<AppState>()(
  persist(
    (set) => ({
      mode: "plan",
      lang: "nl",
      theme: "night",
      autoTheme: false,
      setMode: (mode) => set({ mode }),
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      setAutoTheme: (autoTheme) => set({ autoTheme }),
    }),
    { name: "fq-app", storage: lazyStorage, partialize: ({ lang, theme, autoTheme }) => ({ lang, theme, autoTheme }) },
  ),
);
