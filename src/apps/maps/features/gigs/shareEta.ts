import { formatClock } from "../../nav/format";
import type { Lang } from "../../i18n";

/** Pre-written ETA message, e.g. "Onderweg met de trailer, ETA 17:42 🎧". */
export function etaMessage(eta: Date, opts: { lang: Lang; towing: boolean; venue?: string }): string {
  const clock = formatClock(eta);
  if (opts.lang === "nl") {
    const base = opts.towing ? "Onderweg met de trailer" : "Onderweg";
    return `${base}${opts.venue ? ` naar ${opts.venue}` : ""}, ETA ${clock} 🎧`;
  }
  const base = opts.towing ? "On the way with the trailer" : "On the way";
  return `${base}${opts.venue ? ` to ${opts.venue}` : ""}, ETA ${clock} 🎧`;
}

/**
 * Native share sheet where available (iOS WKWebView), otherwise copy to the
 * clipboard (WebView2 on Windows has no share sheet). Returns what happened.
 */
export async function shareText(text: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (navigator.share) { await navigator.share({ text }); return "shared"; }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "failed"; // user cancelled
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { return "failed"; }
}
