import { create } from "zustand";

export type SheetSnap = "peek" | "half" | "full";

/** Layout state shared between the panels and the map (for camera padding). */
interface UiState {
  /** visible height of the bottom sheet in px (0 when there is none) */
  sheetPx: number;
  sheetSnap: SheetSnap;
  /** width of the desktop side panel in px (0 on phones) */
  panelPx: number;
  setSheetPx: (px: number) => void;
  setSheetSnap: (s: SheetSnap) => void;
  setPanelPx: (px: number) => void;
}

export const useUi = create<UiState>()((set) => ({
  sheetPx: 0,
  sheetSnap: "peek",
  panelPx: 0,
  setSheetPx: (sheetPx) => set({ sheetPx }),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  setPanelPx: (panelPx) => set({ panelPx }),
}));
