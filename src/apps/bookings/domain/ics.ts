import type { Gig, Venue } from '../../../core/types';
import { gigWindow, pad } from '../../../core/dates';

// Minimal iCalendar export. Only titles, venue and times: no client phone
// numbers or e-mail addresses end up in personal calendars (privacy).

const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

export function gigsToIcs(gigs: Gig[], venues: Map<string, Venue>, labels: { option: string }, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Team Funqtion//Bookings//NL', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Funqtion gigs'];
  for (const g of gigs) {
    if (g.deletedAt || !g.date || g.stage === 'lost' || g.stage === 'cancelled' || g.stage === 'enquiry') continue;
    const { start, end } = gigWindow(g);
    const v = g.venueId ? venues.get(g.venueId) : undefined;
    const prefix = g.stage === 'option' || g.stage === 'quote_sent' ? `${labels.option} – ` : '';
    const who = g.performers.map((p) => (p === 'gijs' ? 'G' : 'C')).join('+');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${g.id}@funqtion`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${prefix}${g.title}${who ? ` (${who})` : ''}`)}`,
      ...(v ? [`LOCATION:${esc([v.name, v.street, v.postcode, v.city].filter(Boolean).join(', '))}`] : []),
      `DESCRIPTION:${esc(`${g.reference}`)}`,
      `STATUS:${prefix ? 'TENTATIVE' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
