import type { Lang } from "../i18n";

/** 1483 s → "25 min", 5400 s → "1 u 30" (nl) / "1 h 30" (en). */
export function formatDuration(seconds: number, lang: Lang = "nl"): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hu = lang === "nl" ? "u" : "h";
  return m ? `${h} ${hu} ${String(m).padStart(2, "0")}` : `${h} ${hu}`;
}

/** 18241 m → "18,2 km" (nl) / "18.2 km" (en); 450 m → "450 m"; ≥100 km no decimals. */
export function formatDistance(meters: number, lang: Lang = "nl"): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  const s = km >= 100 ? String(Math.round(km)) : km.toFixed(1);
  return `${lang === "nl" ? s.replace(".", ",") : s} km`;
}

/** Clock time of arrival, e.g. "17:42". */
export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
