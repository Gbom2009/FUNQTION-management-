import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/**
 * Wide layout: side panel instead of a bottom sheet. Tablets in landscape and
 * desktops. iPad mini portrait (744 px) and every phone get the sheet.
 */
export const WIDE_QUERY = "(min-width: 900px)";
export const useWide = () => useMedia(WIDE_QUERY);

/** Short landscape screens (phone on its side, iPad mini on the mount). */
export const useLandscape = () => useMedia("(orientation: landscape) and (max-height: 600px)");
