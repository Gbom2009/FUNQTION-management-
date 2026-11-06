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
  'validUntil', 'reviewLink', 'sender', 'series', 'quoteNumber', 'invoiceNumber', 'amountDue', 'dueDate', 'iban',
  'accountHolder', 'depositPct',
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
  { kind: 'quote_send', language: 'nl', name: 'Offerte versturen', subject: 'Offerte {{quoteNumber}} – {{gigTitle}}',
    body: 'Hoi {{firstName}},\n\nLeuk dat jullie Team Funqtion willen boeken voor {{gigTitle}} op {{gigDate}}! In de bijlage vind je onze offerte ({{quoteNumber}}) van {{amount}}. Kies gerust extra\'s uit de offerte; die nemen we dan mee.\n\nAkkoord? Laat het ons weten door op dit bericht te reageren met "akkoord" (en welke extra\'s je wilt). Daarna sturen we de aanbetalingsfactuur van {{depositPct}}% en staat de datum vast. De offerte is geldig tot {{validUntil}}; onze algemene voorwaarden staan erin.\n\nGroet,\n{{sender}} – Team Funqtion\nFEEL THE MUSIQ' },
  { kind: 'quote_send', language: 'en', name: 'Send quote', subject: 'Quote {{quoteNumber}} – {{gigTitle}}',
    body: 'Hi {{firstName}},\n\nGreat that you want to book Team Funqtion for {{gigTitle}} on {{gigDate}}! Attached is our quote ({{quoteNumber}}) of {{amount}}. Feel free to pick extras from the quote and we will include them.\n\nHappy with it? Just reply "agreed" (and which extras you want). We will then send the deposit invoice of {{depositPct}}% and the date is yours. The quote is valid until {{validUntil}} and includes our terms and conditions.\n\nCheers,\n{{sender}} – Team Funqtion\nFEEL THE MUSIQ' },
  { kind: 'invoice_send', language: 'nl', name: 'Factuur versturen', subject: 'Factuur {{invoiceNumber}} – {{gigTitle}}',
    body: 'Hoi {{firstName}},\n\nIn de bijlage vind je factuur {{invoiceNumber}} voor {{gigTitle}}. Het bedrag van {{amountDue}} kun je uiterlijk {{dueDate}} overmaken naar {{iban}} t.n.v. {{accountHolder}}, onder vermelding van {{invoiceNumber}}.\n\nDank je wel!\n{{sender}} – Team Funqtion' },
  { kind: 'invoice_send', language: 'en', name: 'Send invoice', subject: 'Invoice {{invoiceNumber}} – {{gigTitle}}',
    body: 'Hi {{firstName}},\n\nAttached is invoice {{invoiceNumber}} for {{gigTitle}}. Please transfer {{amountDue}} by {{dueDate}} to {{iban}} in the name of {{accountHolder}}, quoting {{invoiceNumber}}.\n\nThank you!\n{{sender}} – Team Funqtion' },
  { kind: 'reminder_1', language: 'nl', name: 'Herinnering 1 – vriendelijk', subject: 'Herinnering factuur {{invoiceNumber}}',
    body: 'Hoi {{firstName}},\n\nMisschien is het er even bij ingeschoten: factuur {{invoiceNumber}} van {{amountDue}} stond open tot {{dueDate}}. Zou je het bedrag willen overmaken naar {{iban}} t.n.v. {{accountHolder}}, onder vermelding van {{invoiceNumber}}? Is het al betaald, dan kun je dit bericht negeren.\n\nGroet,\n{{sender}} – Team Funqtion' },
  { kind: 'reminder_1', language: 'en', name: 'Reminder 1 – friendly', subject: 'Reminder invoice {{invoiceNumber}}',
    body: 'Hi {{firstName}},\n\nMaybe it slipped through: invoice {{invoiceNumber}} of {{amountDue}} was due on {{dueDate}}. Could you transfer the amount to {{iban}} in the name of {{accountHolder}}, quoting {{invoiceNumber}}? If you have already paid, please ignore this message.\n\nCheers,\n{{sender}} – Team Funqtion' },
  { kind: 'reminder_2', language: 'nl', name: 'Herinnering 2 – dringend', subject: 'Tweede herinnering factuur {{invoiceNumber}}',
    body: 'Beste {{firstName}},\n\nWe hebben de betaling van factuur {{invoiceNumber}} ({{amountDue}}, vervallen op {{dueDate}}) nog niet ontvangen. We vragen je het bedrag binnen 7 dagen over te maken naar {{iban}} t.n.v. {{accountHolder}}, onder vermelding van {{invoiceNumber}}. Is er iets mis met de factuur, neem dan contact met ons op.\n\nMet vriendelijke groet,\n{{sender}} – Team Funqtion' },
  { kind: 'reminder_2', language: 'en', name: 'Reminder 2 – firm', subject: 'Second reminder invoice {{invoiceNumber}}',
    body: 'Dear {{firstName}},\n\nWe have not yet received payment of invoice {{invoiceNumber}} ({{amountDue}}, due {{dueDate}}). Please transfer the amount within 7 days to {{iban}} in the name of {{accountHolder}}, quoting {{invoiceNumber}}. If something is wrong with the invoice, please contact us.\n\nKind regards,\n{{sender}} – Team Funqtion' },
  { kind: 'reminder_3', language: 'nl', name: 'Aanmaning (14-dagenbrief)', subject: 'Aanmaning factuur {{invoiceNumber}}',
    body: 'Beste {{firstName}},\n\nOndanks eerdere herinneringen is factuur {{invoiceNumber}} van {{amountDue}} (vervallen op {{dueDate}}) nog niet betaald.\n\nWij verzoeken je dit bedrag binnen 14 dagen na ontvangst van deze aanmaning over te maken naar {{iban}} t.n.v. {{accountHolder}}, onder vermelding van {{invoiceNumber}}.\n\nBetaal je niet binnen deze termijn, dan zijn wij genoodzaakt buitengerechtelijke incassokosten in rekening te brengen volgens de wettelijke staffel (bij dit bedrag: [BEDRAG INVULLEN], minimaal € 40), vermeerderd met de wettelijke rente.\n\nMet vriendelijke groet,\n{{sender}} – Team Funqtion' },
  { kind: 'reminder_3', language: 'en', name: 'Final notice (14 days)', subject: 'Final notice invoice {{invoiceNumber}}',
    body: 'Dear {{firstName}},\n\nDespite earlier reminders, invoice {{invoiceNumber}} of {{amountDue}} (due {{dueDate}}) has not been paid.\n\nPlease transfer this amount within 14 days of receiving this notice to {{iban}} in the name of {{accountHolder}}, quoting {{invoiceNumber}}.\n\nIf payment is not received within this term, we will charge extrajudicial collection costs according to the statutory scale (for this amount: [FILL IN AMOUNT], minimum € 40), plus statutory interest.\n\nKind regards,\n{{sender}} – Team Funqtion' },
];
