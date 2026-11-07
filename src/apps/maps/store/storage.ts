import { createJSONStorage } from "zustand/middleware";

/**
 * Persist storage that batches writes. zustand's persist serialises and
 * writes on *every* state change; the drive store changes several times per
 * GPS fix. Here writes are coalesced (≤ 1 per key per 800 ms) and flushed
 * when the app is hidden or closed, so nothing is lost.
 */
const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  for (const [k, v] of pending) {
    try { localStorage.setItem(k, v); } catch { /* quota / private mode */ }
  }
  pending.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}

export const lazyStorage = createJSONStorage(() => ({
  getItem: (k: string) => pending.get(k) ?? (() => { try { return localStorage.getItem(k); } catch { return null; } })(),
  setItem: (k: string, v: string) => {
    pending.set(k, v);
    timer ??= setTimeout(flush, 800);
  },
  removeItem: (k: string) => {
    pending.delete(k);
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
}));

export const flushStorage = flush;
