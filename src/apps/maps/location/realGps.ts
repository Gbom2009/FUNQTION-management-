import type { Fix, LocationProvider } from "./provider";

/**
 * Real GPS via the webview's Geolocation API (works in WebView2 and WKWebView
 * once Info.plist has the usage strings). Phase 6 may swap in the Tauri
 * geolocation plugin for background updates — same interface.
 */
export class RealGps implements LocationProvider {
  readonly kind = "real" as const;
  private watch: number | null = null;
  private lastHeading = 0;

  start(onFix: (f: Fix) => void, onError?: (m: string) => void) {
    if (!("geolocation" in navigator)) { onError?.("Geolocation not available"); return; }
    this.watch = navigator.geolocation.watchPosition(
      (p) => {
        const c = p.coords;
        // heading is null/NaN when standing still — keep the last one
        if (c.heading !== null && !Number.isNaN(c.heading) && (c.speed ?? 0) > 0.8) this.lastHeading = c.heading;
        onFix({
          lat: c.latitude, lon: c.longitude,
          speedKmh: Math.max(0, (c.speed ?? 0) * 3.6),
          heading: this.lastHeading,
          accuracyM: c.accuracy,
          t: p.timestamp,
        });
      },
      (e) => onError?.(e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  stop() {
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
  }
}
