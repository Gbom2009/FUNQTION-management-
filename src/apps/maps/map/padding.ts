import { useUi } from "../store/ui";

/** Camera padding that keeps routes clear of the search bar, sheet or side panel. */
export function uiPadding() {
  const { sheetPx, panelPx } = useUi.getState();
  if (panelPx) return { top: 60, bottom: 60, left: panelPx + 40, right: 60 };
  // never pad more than the map has room for
  const bottom = Math.min(sheetPx + 30, window.innerHeight * 0.6);
  return { top: 110, bottom, left: 48, right: 48 };
}
