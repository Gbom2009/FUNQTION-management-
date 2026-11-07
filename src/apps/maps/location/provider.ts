/** A position fix. Everything nav-related consumes this, never the GPS directly. */
export interface Fix {
  lat: number;
  lon: number;
  speedKmh: number;
  /** degrees, 0 = north */
  heading: number;
  accuracyM: number;
  /** epoch ms */
  t: number;
}

export interface LocationProvider {
  start(onFix: (f: Fix) => void, onError?: (message: string) => void): void;
  stop(): void;
  readonly kind: "real" | "simulated";
}
