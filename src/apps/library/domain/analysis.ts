import { camelotFromPitch } from './keys';

// Audio analysis on decoded PCM (mono Float32). Pure TypeScript so it runs in
// the webview, a worker, and the tests. Good enough to fill gaps: values that
// Serato already wrote into the file always win.

/** In-place radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Simple decimation with a box low-pass (enough for tempo and key). */
export function downsample(x: Float32Array, from: number, to: number): Float32Array {
  const f = Math.max(1, Math.round(from / to));
  const out = new Float32Array(Math.floor(x.length / f));
  for (let i = 0; i < out.length; i++) { let s = 0; for (let k = 0; k < f; k++) s += x[i * f + k]; out[i] = s / f; }
  return out;
}

/** Use the middle of the track (skip intros/outros), at most `seconds`. */
export function excerpt(x: Float32Array, rate: number, seconds: number): Float32Array {
  const n = Math.min(x.length, Math.round(seconds * rate));
  const start = Math.max(0, Math.floor((x.length - n) / 2));
  return x.subarray(start, start + n);
}

/**
 * Tempo: onset strength (positive spectral flux on short frames), then
 * autocorrelation over 60–190 BPM, folded into the DJ range [lo, hi).
 */
export function detectBpm(pcm: Float32Array, rate: number, range: [number, number] = [78, 156]): { bpm: number; confidence: number } | undefined {
  const sr = 11025;
  const x = downsample(pcm, rate, sr);
  const N = 512, H = 128;
  const frames = Math.floor((x.length - N) / H);
  if (frames < 200) return undefined;
  const onset = new Float32Array(frames);
  let prev = new Float32Array(N / 2);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = x[f * H + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    fft(re, im);
    let flux = 0;
    const cur = new Float32Array(N / 2);
    for (let k = 1; k < N / 2; k++) { cur[k] = Math.log1p(Math.hypot(re[k], im[k]) * 10); const d = cur[k] - prev[k]; if (d > 0) flux += d; }
    onset[f] = flux; prev = cur;
  }
  // remove the slow trend
  const mean = onset.reduce((a, b) => a + b, 0) / frames;
  for (let i = 0; i < frames; i++) onset[i] = Math.max(0, onset[i] - mean);
  const fps = sr / H;
  const lagOf = (bpm: number) => (60 * fps) / bpm;
  let best = 0, bestBpm = 0, total = 0;
  const scores: [number, number][] = [];
  for (let bpm = 60; bpm <= 190; bpm += 0.25) {
    const lag = lagOf(bpm);
    let s = 0;
    for (let i = 0; i + lag * 4 + 1 < frames; i++) {
      const at = (k: number) => { const p = i + lag * k; const a = Math.floor(p), t = p - a; return onset[a] * (1 - t) + onset[a + 1] * t; };
      s += onset[i] * (at(1) + 0.5 * at(2) + 0.25 * at(4));
    }
    scores.push([bpm, s]); total += s;
    if (s > best) { best = s; bestBpm = bpm; }
  }
  if (!bestBpm) return undefined;
  let bpm = bestBpm;
  while (bpm < range[0]) bpm *= 2;
  while (bpm >= range[1]) bpm /= 2;
  const avg = total / scores.length;
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.max(0, Math.min(1, (best - avg) / (best || 1))) };
}

// Key profiles (Temperley/Krumhansl-style, tuned for pop/dance).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db || 1);
}

/** Pitch-class profile of the excerpt (A4 = 440 Hz, 55–1760 Hz). */
export function chroma(pcm: Float32Array, rate: number): number[] {
  const sr = 11025;
  const x = downsample(pcm, rate, sr);
  const N = 4096, H = 2048;
  const out = new Array(12).fill(0);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let o = 0; o + N <= x.length; o += H) {
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const hz = (k * sr) / N;
      if (hz < 55 || hz > 1760) continue;
      const midi = 69 + 12 * Math.log2(hz / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      out[pc] += Math.hypot(re[k], im[k]) ** 2;
    }
  }
  const max = Math.max(...out) || 1;
  return out.map((v) => Math.sqrt(v / max));
}

export function detectKey(pcm: Float32Array, rate: number): { key: string; confidence: number } | undefined {
  const c = chroma(pcm, rate);
  if (c.every((v) => !v)) return undefined;
  const scores: { pc: number; minor: boolean; r: number }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - pc + 12) % 12]);
    scores.push({ pc, minor: false, r: correlate(c, rot(MAJOR)) }, { pc, minor: true, r: correlate(c, rot(MINOR)) });
  }
  scores.sort((a, b) => b.r - a.r);
  const [a, b] = scores;
  return { key: camelotFromPitch(a.pc, a.minor), confidence: Math.max(0, Math.min(1, (a.r - b.r) * 4)) };
}

/**
 * Highest frequency with real content (fake-320 check). An MP3 of ≥ 256 kbps
 * that stops at ~16 kHz was almost certainly made from a 128 kbps file.
 */
export function cutoffHz(pcm: Float32Array, rate: number): number {
  const N = 8192;
  const spec = new Float32Array(N / 2);
  const re = new Float32Array(N), im = new Float32Array(N);
  let count = 0;
  for (let o = 0; o + N <= pcm.length && count < 24; o += Math.max(N, Math.floor(pcm.length / 24))) {
    for (let i = 0; i < N; i++) { re[i] = pcm[o + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += Math.hypot(re[k], im[k]);
    count++;
  }
  if (!count) return 0;
  const db = Array.from(spec, (v) => 20 * Math.log10(v / count + 1e-9));
  const peak = Math.max(...db);
  for (let k = N / 2 - 1; k > 0; k--) if (db[k] > peak - 70) return Math.round((k * rate) / N);
  return 0;
}

export type Quality = 'ok' | 'low' | 'transcode_suspect' | 'broken' | 'unknown';

export function judgeQuality(p: { format: string; bitrate?: number; cutoff?: number; durationS?: number }): Quality {
  if (p.durationS !== undefined && p.durationS < 5) return 'broken';
  const lossless = ['flac', 'wav', 'aiff', 'aif', 'alac'].includes(p.format);
  if (!lossless && p.bitrate && p.bitrate < 192) return 'low';
  if (p.cutoff && p.cutoff < 16500 && (lossless || (p.bitrate ?? 0) >= 256)) return 'transcode_suspect';
  if (!p.bitrate && !lossless) return 'unknown';
  return 'ok';
}

/**
 * A suggested energy (1–10) from loudness and onset density. Only a starting
 * point: your own energy tag always wins.
 */
export function suggestEnergy(pcm: Float32Array, _rate: number, bpm?: number): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  const rmsDb = 10 * Math.log10(sum / Math.max(1, pcm.length) + 1e-9);
  const loud = Math.min(1, Math.max(0, (rmsDb + 24) / 16));      // −24 dB → 0, −8 dB → 1
  const tempo = bpm ? Math.min(1, Math.max(0, (bpm - 85) / 50)) : 0.5;
  return Math.max(1, Math.min(10, Math.round(1 + 9 * (0.6 * loud + 0.4 * tempo))));
}
