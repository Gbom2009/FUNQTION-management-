/**
 * Keep the screen on while navigating (Screen Wake Lock API — WebView2 and
 * iOS 16.4+ WKWebView). The lock drops when the app is hidden, so it is
 * re-acquired on visibilitychange. Fails silently where unsupported.
 */
let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire() {
  try {
    if (!wanted || sentinel || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => { sentinel = null; });
  } catch { /* not allowed / unsupported */ }
}

document.addEventListener("visibilitychange", () => { void acquire(); });

export function keepAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else { void sentinel?.release(); sentinel = null; }
}
