// Overtime ("verlenging"), per contract P3: a request on the night from the
// client or the day contact counts as agreement; it costs the contract's rate
// per started half hour and goes on the final invoice. Calculated from the
// planned and actual end AND the logged requests, never from the clock alone.

export interface OvertimeRequest { at: string; minutes?: number; requestedBy?: string }

export interface Overtime {
  minutes: number;          // actual end − planned end (0 when on time)
  halfHours: number;        // billable started half hours (0 without a request)
  amount: number;           // cents
  requested: boolean;
  requests: OvertimeRequest[];
}

/** A few minutes over the planned end is not overtime. */
export const GRACE_MINUTES = 5;

export function overtime(plannedEnd: string | undefined, actualEnd: string | undefined, requests: OvertimeRequest[], ratePerHalfHour: number): Overtime {
  const minutes = plannedEnd && actualEnd ? Math.max(0, Math.round((Date.parse(actualEnd) - Date.parse(plannedEnd)) / 60000)) : 0;
  const requested = requests.length > 0;
  const halfHours = requested && minutes > GRACE_MINUTES ? Math.ceil((minutes - GRACE_MINUTES) / 30) : 0;
  return { minutes, halfHours, amount: halfHours * ratePerHalfHour, requested, requests };
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The invoice line for the final invoice (App 2). */
export function overtimeLine(o: Overtime, lang: 'nl' | 'en', vatRate: number, id: string) {
  const r = o.requests[0];
  const who = r?.requestedBy ? (lang === 'nl' ? ` op verzoek van ${r.requestedBy}` : ` requested by ${r.requestedBy}`) : '';
  const when = r ? (lang === 'nl' ? ` om ${hhmm(r.at)}` : ` at ${hhmm(r.at)}`) : '';
  return {
    id,
    description: lang === 'nl' ? `Verlenging, ${o.halfHours} × begonnen half uur${who}${when}` : `Overtime, ${o.halfHours} × started half hour${who}${when}`,
    quantity: o.halfHours,
    unit: 'piece' as const,
    unitPrice: o.halfHours ? Math.round(o.amount / o.halfHours) : 0,
    vatRate,
  };
}
