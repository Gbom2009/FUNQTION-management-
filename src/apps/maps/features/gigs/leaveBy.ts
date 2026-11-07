/**
 * Leave-by maths (pure, tested).
 * leave-by = load-in − setup buffer − drive time × (1 + traffic margin)
 */
export interface LeaveByInput {
  /** local date "YYYY-MM-DD" */
  date: string;
  /** local time "HH:MM" */
  loadIn: string;
  setupBufferMin: number;
  /** planned drive time in seconds */
  routeS: number;
  /** extra % on top of the drive time for traffic */
  trafficMarginPct: number;
}

/** Parse local date + time into a Date (device time zone). */
export function localDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const out = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  return Number.isNaN(out.getTime()) ? null : out;
}

export function leaveBy(i: LeaveByInput): Date | null {
  const loadIn = localDateTime(i.date, i.loadIn);
  if (!loadIn) return null;
  const driveMs = i.routeS * 1000 * (1 + Math.max(0, i.trafficMarginPct) / 100);
  const bufferMs = Math.max(0, i.setupBufferMin) * 60_000;
  // round down to the whole minute — never tell someone to leave later than needed
  const ms = loadIn.getTime() - bufferMs - driveMs;
  return new Date(Math.floor(ms / 60_000) * 60_000);
}

export type Urgency = "later" | "soon" | "now" | "late";

/** How urgent leaving is, relative to now. */
export function urgency(leave: Date, now: Date = new Date()): Urgency {
  const min = (leave.getTime() - now.getTime()) / 60_000;
  if (min < 0) return "late";
  if (min <= 5) return "now";
  if (min <= 60) return "soon";
  return "later";
}
