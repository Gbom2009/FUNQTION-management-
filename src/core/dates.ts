// Local-time date helpers. Dates are stored as yyyy-mm-dd and times as HH:mm
// in the user's local zone (Europe/Amsterdam for Team Funqtion), which keeps
// gigs that run past midnight simple: endTime < startTime means "next day".

export const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function at(date: string, time: string): Date {
  const d = parseDate(date);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  d.setHours(h || 0, mi || 0, 0, 0);
  return d;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Start/end of a gig window. With setup the window starts at the setup time. */
export function gigWindow(g: { date: string; startTime: string; endTime: string; setupTime?: string }) {
  const start = at(g.date, g.startTime || '20:00');
  let end = at(g.date, g.endTime || '23:59');
  if (end <= start) end = addDays(end, 1);
  let busyFrom = start;
  if (g.setupTime) {
    busyFrom = at(g.date, g.setupTime);
    if (busyFrom > start) busyFrom = addDays(busyFrom, -1);
  }
  return { start, end, busyFrom };
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export function monthMatrix(year: number, month: number): Date[] {
  // Monday-first 6x7 grid
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
