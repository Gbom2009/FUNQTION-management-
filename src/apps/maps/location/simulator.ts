import type { Fix, LocationProvider } from "./provider";
import { cumulative, destination, pointAlong, project, bearing, type LonLat } from "../nav/geo";

/** A path to replay: geometry plus a target speed per vertex segment (m/s). */
export interface SimPath {
  shape: LonLat[];
  /** speed (m/s) for each segment i→i+1; defaults to 50 km/h */
  speeds?: number[];
  /** along-distances where the car should slow down for a turn */
  slowAt?: number[];
}

const TICK_MS = 250;
const ACCEL = 2.5;         // m/s²
const DECEL = 3;           // m/s²
const TURN_SPEED = 15 / 3.6;

/** Box–Muller gaussian. */
function gauss() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Fake GPS: drives along a route or GPX at its planned speeds, with
 * 0.5×–8× time warp, gaussian position noise, braking for turns, and a
 * "go off-route" mode that steers off the line to test rerouting.
 */
export class Simulator implements LocationProvider {
  readonly kind = "simulated" as const;
  multiplier = 1;
  /** brake for turns and roundabouts */
  brake = true;
  noiseM = 4;
  paused = false;

  private path: SimPath | null = null;
  private cum: number[] = [];
  private along = 0;
  private v = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onFix: ((f: Fix) => void) | null = null;
  /** off-route: free driving from `pos` along `heading` */
  private off: { pos: LonLat; heading: number; turned: number } | null = null;
  private lastPos: LonLat | null = null;

  setPath(path: SimPath, opts: { fromPosition?: LonLat } = {}) {
    this.path = path;
    this.cum = cumulative(path.shape);
    this.along = 0;
    if (opts.fromPosition && path.shape.length > 1) {
      // continue from where the car physically is (after a reroute)
      this.along = project(opts.fromPosition, path.shape, this.cum)?.along ?? 0;
    } else {
      this.v = 0;
    }
    this.off = null;
  }

/** Replace the speed profile without moving the car (speed mode / limits changed). */
  setSpeeds(speeds: number[] | undefined, slowAt?: number[]) {
    if (!this.path) return;
    this.path = { ...this.path, speeds, slowAt };
  }

  get progress() {
    const total = this.cum[this.cum.length - 1] ?? 0;
    return { along: this.along, total, offRoute: !!this.off };
  }

  goOffRoute() {
    if (!this.path || this.off) return;
    const here = pointAlong(this.path.shape, this.cum, this.along);
    this.off = { pos: here.point, heading: here.bearing, turned: 0 };
  }

  start(onFix: (f: Fix) => void) {
    this.onFix = onFix;
    this.stop();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private targetSpeed(): number {
    const p = this.path!;
    const seg = pointAlong(p.shape, this.cum, this.along).segment;
    let target = p.speeds?.[seg] ?? 50 / 3.6;
    // brake for the next turn: v² ≤ v_turn² + 2·a·d
    for (const s of this.brake ? p.slowAt ?? [] : []) {
      const d = s - this.along;
      if (d < 0) continue;
      if (d > 600) break;
      target = Math.min(target, Math.sqrt(TURN_SPEED ** 2 + 2 * DECEL * d));
      break;
    }
    return target;
  }

  private tick() {
    if (!this.path || !this.onFix) return;
    if (this.paused) {
      // A paused car is a parked car: keep reporting 0 km/h so the safety lock releases.
      this.v = 0;
      if (this.lastPos) {
        this.onFix({ lon: this.lastPos[0], lat: this.lastPos[1], speedKmh: 0, heading: 0, accuracyM: 3 + this.noiseM * 1.5, t: Date.now() });
      }
      return;
    }
    const dt = (TICK_MS / 1000) * this.multiplier;
    const total = this.cum[this.cum.length - 1] ?? 0;

    let pos: LonLat;
    let heading: number;
    if (this.off) {
      // veer off: turn 50° over the first stretch, then keep going straight
      const target = 50 / 3.6;
      this.v += Math.sign(target - this.v) * Math.min(Math.abs(target - this.v), ACCEL * dt);
      if (this.off.turned < 50) { const d = Math.min(50 - this.off.turned, 12 * dt); this.off.heading += d; this.off.turned += d; }
      this.off.pos = destination(this.off.pos, this.off.heading, this.v * dt);
      pos = this.off.pos;
      heading = (this.off.heading + 360) % 360;
    } else {
      const target = this.along >= total ? 0 : this.targetSpeed();
      const a = target > this.v ? ACCEL : DECEL;
      this.v += Math.sign(target - this.v) * Math.min(Math.abs(target - this.v), a * dt);
      this.along = Math.min(total, this.along + this.v * dt);
      const pa = pointAlong(this.path.shape, this.cum, this.along);
      pos = pa.point;
      heading = this.lastPos && this.v > 0.5 ? bearing(this.lastPos, pos) : pa.bearing;
    }
    this.lastPos = pos;

    // gaussian noise, metres → offset in a random direction
    const n = this.noiseM > 0 ? destination(pos, Math.random() * 360, Math.abs(gauss()) * this.noiseM) : pos;
    this.onFix({
      lon: n[0], lat: n[1],
      speedKmh: this.v * 3.6,
      heading: (heading + gauss() * Math.min(3, this.noiseM)) % 360,
      accuracyM: 3 + this.noiseM * 1.5,
      t: Date.now(),
    });
  }
}

/** Build a sim path from a GPX track (uses its timestamps for speed when present). */
export function simPathFromTrack(points: LonLat[], times?: number[]): SimPath {
  const cum = cumulative(points);
  const speeds = points.slice(1).map((_, i) => {
    if (times && times[i + 1] > times[i]) return Math.min(50, (cum[i + 1] - cum[i]) / ((times[i + 1] - times[i]) / 1000));
    return 50 / 3.6;
  });
  return { shape: points, speeds };
}
