import type { Lang, TemplateKind } from '../../../core/types';

/** Replace {{field}} placeholders. Unknown fields are left empty. */
export function fillTemplate(body: string, fields: Record<string, string | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => fields[k] ?? '');
}

/** Normalise a (Dutch) phone number to international digits for wa.me links. */
export function toWhatsAppNumber(phone: string): string {
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return '31' + d.slice(1);
  return d;
}

export function whatsAppLink(phone: string | undefined, text: string) {
  const n = phone ? toWhatsAppNumber(phone) : '';
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string | undefined, subject: string, body: string) {
  return `mailto:${email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const MERGE_FIELDS = [
  'firstName', 'gigTitle', 'gigDate', 'startTime', 'endTime', 'venue', 'city', 'eventType', 'amount',
  'validUntil', 'reviewLink', 'sender', 'series',
] as const;

type Seed = { kind: TemplateKind; language: Lang; name: string; subject?: string; body: string };

export const DEFAULT_TEMPLATES: Seed[] = [
  { kind: 'enquiry_available', language: 'nl', name: 'Aanvraag – datum vrij', subject: 'Je aanvraag bij Team Funqtion',
    body: 'Hoi {{firstName}},\n\nDank je wel voor je aanvraag! Goed nieuws: {{gigDate}} is nog vrij bij ons. Vertel ons iets meer over het feest (locatie, aantal gasten, tijden en de muziek die jullie leuk vinden), dan sturen we je snel een voorstel.\n\nGroet,\n{{sender}} – Team Funqtion\nFEEL THE MUSIQ' },
  { kind: 'enquiry_available', language: 'en', name: 'Enquiry – date available', subject: 'Your enquiry with Team Funqtion',
    body: 'Hi {{firstName}},\n\nThanks for your enquiry! Good news: {{gigDate}} is still available. Tell us a bit more about the event (venue, guests, times and the music you love) and we will send you a proposal soon.\n\nCheers,\n{{sender}} – Team Funqtion\nFEEL THE MUSIQ' },
  { kind: 'enquiry_unavailable', language: 'nl', name: 'Aanvraag – datum bezet', subject: 'Je aanvraag bij Team Funqtion',
    body: 'Hoi {{firstName}},\n\nDank je wel voor je aanvraag! Helaas zijn we op {{gigDate}} al geboekt. Is er misschien een andere datum mogelijk? Dan denken we graag mee.\n\nGroet,\n{{sender}} – Team Funqtion' },
  { kind: 'enquiry_unavailable', language: 'en', name: 'Enquiry – date taken', subject: 'Your enquiry with Team Funqtion',
    body: 'Hi {{firstName}},\n\nThanks for your enquiry! Unfortunately we are already booked on {{gigDate}}. Is another date an option? Happy to help.\n\nCheers,\n{{sender}} – Team Funqtion' },
  { kind: 'quote_follow_up', language: 'nl', name: 'Offerte – opvolging', subject: 'Onze offerte voor {{gigDate}}',
    body: 'Hoi {{firstName}},\n\nIk wilde even checken of je onze offerte voor {{gigTitle}} op {{gigDate}} hebt ontvangen. Heb je nog vragen of wil je iets aanpassen? Laat het gerust weten. De offerte is geldig tot {{validUntil}}.\n\nGroet,\n{{sender}} – Team Funqtion' },
  { kind: 'quote_follow_up', language: 'en', name: 'Quote – follow-up', subject: 'Our quote for {{gigDate}}',
    body: 'Hi {{firstName}},\n\nJust checking whether you received our quote for {{gigTitle}} on {{gigDate}}. Any questions or changes? Let us know. The quote is valid until {{validUntil}}.\n\nCheers,\n{{sender}} – Team Funqtion' },
  { kind: 'music_wishes', language: 'nl', name: 'Muziekwensen opvragen', subject: 'Muziekwensen voor {{gigDate}}',
    body: 'Hoi {{firstName}},\n\nOver een paar weken is het zover: {{gigTitle}}! Om er een topavond van te maken horen we graag jullie muziekwensen: favoriete genres, nummers die zeker moeten komen, nummers die we beter kunnen overslaan en speciale momenten (openingsdans, binnenkomst…).\n\nGroet,\n{{sender}} – Team Funqtion' },
  { kind: 'music_wishes', language: 'en', name: 'Ask for music wishes', subject: 'Music wishes for {{gigDate}}',
    body: 'Hi {{firstName}},\n\nIn a few weeks it is time for {{gigTitle}}! To make it a great night we would love your music wishes: favourite genres, must-play tracks, do-not-play tracks and special moments (first dance, entrance…).\n\nCheers,\n{{sender}} – Team Funqtion' },
  { kind: 'final_check', language: 'nl', name: 'Laatste check', subject: 'Laatste check voor {{gigDate}}',
    body: 'Hoi {{firstName}},\n\nNog even de laatste details voor {{gigTitle}} op {{gigDate}}: we spelen van {{startTime}} tot {{endTime}} bij {{venue}}. Klopt dit nog? Wie is op de dag zelf ons aanspreekpunt, en waar kunnen we laden/lossen en parkeren?\n\nGroet,\n{{sender}} – Team Funqtion' },
  { kind: 'final_check', language: 'en', name: 'Final check', subject: 'Final check for {{gigDate}}',
    body: 'Hi {{firstName}},\n\nA quick final check for {{gigTitle}} on {{gigDate}}: we play from {{startTime}} to {{endTime}} at {{venue}}. Is that still correct? Who is our contact on the day, and where can we load in and park?\n\nCheers,\n{{sender}} – Team Funqtion' },
  { kind: 'thank_you_review', language: 'nl', name: 'Bedankt + review', subject: 'Bedankt voor {{gigTitle}}!',
    body: 'Hoi {{firstName}},\n\nBedankt dat we {{gigTitle}} mochten draaien, wat een avond! Zou je een korte review voor ons willen achterlaten? Dat helpt ons enorm: {{reviewLink}}\nEn tag ons gerust op Instagram: @funqtionofficial\n\nGroet,\n{{sender}} – Team Funqtion\nFEEL THE MUSIQ' },
  { kind: 'thank_you_review', language: 'en', name: 'Thank you + review', subject: 'Thanks for {{gigTitle}}!',
    body: 'Hi {{firstName}},\n\nThanks for having us at {{gigTitle}}, what a night! Would you leave us a short review? It helps us a lot: {{reviewLink}}\nAnd feel free to tag us on Instagram: @funqtionofficial\n\nCheers,\n{{sender}} – Team Funqtion\nFEEL THE MUSIQ' },
  { kind: 'rebook', language: 'nl', name: 'Volgend jaar weer?', subject: '{{series}} – volgend jaar weer?',
    body: 'Hoi {{firstName}},\n\nWe kijken nog steeds met plezier terug op {{series}}! Staat er voor volgend jaar al iets op de planning? We houden de datum graag voor jullie vrij.\n\nGroet,\n{{sender}} – Team Funqtion' },
  { kind: 'rebook', language: 'en', name: 'Again next year?', subject: '{{series}} – again next year?',
    body: 'Hi {{firstName}},\n\nWe still look back on {{series}} with a big smile! Are there plans for next year yet? We would love to keep the date free for you.\n\nCheers,\n{{sender}} – Team Funqtion' },
];
