import type { Map, ExpressionSpecification } from "maplibre-gl";
import { PULSE_LAYER } from "./routeLayers";
import { useMapSettings } from "./settings";

/**
 * "Waveform route": bright pulses travel along the selected route like a beat.
 * Drawn as a line-gradient on its own layer (needs lineMetrics on the source).
 * - Plan mode: expressive — 4 pulses, 120 BPM throb.
 * - Drive mode: calm — one slow, faint pulse, no throb (no distraction).
 * - prefers-reduced-motion: no animation at all.
 */
type WaveMode = "drive" | "plan";
let mode: WaveMode = "plan";
export function setWaveformMode(m: WaveMode) { mode = m; }

interface Pulse { pos: number; alpha: number }

const CFG = {
  plan: { pulses: 4, periodS: 6, width: 0.05, alpha: 1, bpm: 120 },
  drive: { pulses: 1, periodS: 10, width: 0.06, alpha: 0.6, bpm: 0 },
};

/** Pulse positions (0..1 along the line) and strengths at time tS. Pure, tested. */
export function pulsesAt(tS: number, m: WaveMode): Pulse[] {
  const c = CFG[m];
  const phase = (tS / c.periodS) % 1;
  // 120 BPM throb: sharp attack, exponential decay every beat
  const beat = c.bpm ? Math.exp(-((tS % (60 / c.bpm)) / 0.14)) : 0;
  const throb = c.bpm ? 0.7 + 0.3 * beat : 1;
  return Array.from({ length: c.pulses }, (_, k) => ({
    pos: (phase + k / c.pulses) % 1,
    // waveform envelope: pulses differ in strength like a bar of music
    alpha: c.alpha * throb * (c.pulses > 1 ? [1, 0.7, 0.85, 0.6][k % 4] : 1),
  }));
}

const CORE = [255, 246, 232]; // white-hot core so it reads against the orange line

/** line-gradient stops: transparent everywhere except a soft bump around each pulse. */
export function gradientFor(pulses: Pulse[], width: number): ExpressionSpecification {
  const clear = "rgba(0,0,0,0)";
  const pts: [number, string][] = [];
  for (const p of [...pulses].sort((a, b) => a.pos - b.pos)) {
    const a = Math.max(0, Math.min(1, p.alpha));
    const c = `rgba(${CORE[0]},${CORE[1]},${CORE[2]},${a.toFixed(3)})`;
    pts.push([p.pos - width, clear], [p.pos, c], [p.pos + width, clear]);
  }
  // keep strictly ascending stops inside [0,1]
  const stops: (number | string)[] = [];
  let last = -1;
  for (const [pos, col] of [[0, clear] as [number, string], ...pts, [1, clear] as [number, string]]) {
    const q = Math.max(0, Math.min(1, pos));
    if (q <= last) continue;
    stops.push(q, col);
    last = q;
  }
  return ["interpolate", ["linear"], ["line-progress"], ...stops] as unknown as ExpressionSpecification;
}

export function startWaveform(map: Map): () => void {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let raf = 0;
  let lastFrame = 0;
  let hidden = false;
  const t0 = performance.now();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // each frame re-uploads the route gradient: 20 fps in Plan, 10 fps while driving is plenty
    if (now - lastFrame < (mode === "drive" ? 100 : 50)) return;
    lastFrame = now;
    if (!map.getLayer(PULSE_LAYER) || document.visibilityState !== "visible") return;
    if (reduce?.matches || !useMapSettings.getState().pulse) {
      if (!hidden) { map.setPaintProperty(PULSE_LAYER, "line-opacity", 0); hidden = true; }
      return;
    }
    if (hidden) { map.setPaintProperty(PULSE_LAYER, "line-opacity", 1); hidden = false; }
    const c = CFG[mode];
    map.setPaintProperty(PULSE_LAYER, "line-gradient", gradientFor(pulsesAt((now - t0) / 1000, mode), c.width));
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
