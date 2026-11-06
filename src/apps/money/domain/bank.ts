// Bank statement import: ING, Rabobank, ABN AMRO (TXT), bunq, Revolut
// (personal + Business), CAMT.053 XML, and a generic CSV fallback.
// Output is a normalised list of lines; amounts in signed cents.

export interface ParsedLine {
  date: string;          // yyyy-mm-dd
  amount: number;        // cents, + in / − out
  counterparty: string;
  counterIban?: string;
  description: string;
}

export interface ParseResult {
  format: 'ing' | 'rabobank' | 'abnamro' | 'bunq' | 'revolut' | 'revolut_business' | 'camt053' | 'generic';
  lines: ParsedLine[];
  skipped: number;
}

/** RFC-4180-ish CSV parser with delimiter detection. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] ?? '';
  const delim = [';', ',', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** "1.234,56" / "-1234.56" / "+12,30" → cents */
export function toCents(v: string): number {
  let s = v.trim().replace(/\s|€|EUR/g, '');
  if (!s) return 0;
  const neg = s.startsWith('-');
  s = s.replace(/^[+-]/, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Math.round(Number(s) * 100);
  return neg ? -n : n;
}

export function toIsoDate(v: string): string {
  const s = v.trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

const norm = (h: string) => h.trim().toLowerCase();

function pick(header: string[], row: string[], ...names: string[]) {
  for (const n of names) {
    const i = header.findIndex((h) => norm(h) === n);
    if (i >= 0) return row[i] ?? '';
  }
  return '';
}

export function parseStatement(text: string): ParseResult {
  if (/<Document[\s>][\s\S]*camt\.053/i.test(text) || /<BkToCstmrStmt>/.test(text)) return { format: 'camt053', ...parseCamt(text) };
  const rows = parseCsv(text);
  if (!rows.length) return { format: 'generic', lines: [], skipped: 0 };
  const header = rows[0].map(norm);
  const body = rows.slice(1);
  const has = (...n: string[]) => n.every((x) => header.includes(x));
  const lines: ParsedLine[] = [];
  let skipped = 0;
  let format: ParseResult['format'] = 'generic';

  if (has('datum', 'naam / omschrijving', 'af bij')) {
    format = 'ing';
    for (const r of body) {
      const amt = toCents(pick(header, r, 'bedrag (eur)', 'bedrag'));
      lines.push({ date: toIsoDate(pick(header, r, 'datum')), amount: /af/i.test(pick(header, r, 'af bij')) ? -Math.abs(amt) : Math.abs(amt),
        counterparty: pick(header, r, 'naam / omschrijving'), counterIban: pick(header, r, 'tegenrekening') || undefined,
        description: [pick(header, r, 'mededelingen'), pick(header, r, 'mutatiesoort')].filter(Boolean).join(' · ') });
    }
  } else if (has('iban/bban', 'volgnr', 'bedrag')) {
    format = 'rabobank';
    for (const r of body) {
      lines.push({ date: toIsoDate(pick(header, r, 'datum')), amount: toCents(pick(header, r, 'bedrag')),
        counterparty: pick(header, r, 'naam tegenpartij'), counterIban: pick(header, r, 'tegenrekening iban/bban') || undefined,
        description: ['omschrijving-1', 'omschrijving-2', 'omschrijving-3'].map((k) => pick(header, r, k)).filter(Boolean).join(' ') });
    }
  } else if (has('date started (utc)', 'state') || has('date completed (utc)', 'state')) {
    format = 'revolut_business';
    for (const r of body) {
      if (!/completed/i.test(pick(header, r, 'state'))) { skipped++; continue; }
      const total = pick(header, r, 'total amount') || pick(header, r, 'amount');
      lines.push({ date: toIsoDate(pick(header, r, 'date completed (utc)') || pick(header, r, 'date started (utc)')), amount: toCents(total),
        counterparty: pick(header, r, 'description') || pick(header, r, 'payer'), counterIban: pick(header, r, 'beneficiary iban') || undefined,
        description: [pick(header, r, 'reference'), pick(header, r, 'type')].filter(Boolean).join(' · ') });
    }
  } else if (has('type', 'product', 'started date', 'amount', 'state')) {
    format = 'revolut';
    for (const r of body) {
      if (!/completed/i.test(pick(header, r, 'state'))) { skipped++; continue; }
      const amt = toCents(pick(header, r, 'amount')) - Math.abs(toCents(pick(header, r, 'fee')));
      lines.push({ date: toIsoDate(pick(header, r, 'completed date') || pick(header, r, 'started date')), amount: amt,
        counterparty: pick(header, r, 'description'), description: pick(header, r, 'type') });
    }
  } else if (has('date', 'amount', 'counterparty') || has('datum', 'bedrag', 'tegenrekening', 'naam')) {
    format = 'bunq';
    for (const r of body) {
      lines.push({ date: toIsoDate(pick(header, r, 'date', 'datum')), amount: toCents(pick(header, r, 'amount', 'bedrag')),
        counterparty: pick(header, r, 'name', 'naam'), counterIban: pick(header, r, 'counterparty', 'tegenrekening') || undefined,
        description: pick(header, r, 'description', 'omschrijving') });
    }
  } else if (rows[0].length >= 8 && /^\d{6,}$/.test(rows[0][0].trim()) && /^\d{8}$/.test(rows[0][2].trim())) {
    // ABN AMRO TXT: account, currency, date, start, end, value date, amount, description (no header)
    format = 'abnamro';
    for (const r of rows) {
      const desc = r.slice(7).join(' ').replace(/\s+/g, ' ').trim();
      const name = desc.match(/\/NAME\/([^/]+)\//)?.[1] ?? desc.match(/Naam:\s*([^\s].*?)(?:\s{2,}|Omschrijving:|IBAN:|$)/)?.[1] ?? desc.slice(0, 40);
      const iban = desc.match(/\/IBAN\/([A-Z]{2}\d{2}[A-Z0-9]+)\//)?.[1] ?? desc.match(/IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9]+)/)?.[1];
      lines.push({ date: toIsoDate(r[2]), amount: toCents(r[6]), counterparty: name.trim(), counterIban: iban, description: desc });
    }
  } else {
    // Generic: find columns by common names.
    const find = (...n: string[]) => header.findIndex((h) => n.some((x) => h.includes(x)));
    const di = find('date', 'datum', 'boekdatum');
    const ai = find('amount', 'bedrag');
    const ni = find('name', 'naam', 'tegenpartij', 'counterparty', 'payee', 'description', 'omschrijving');
    const de = find('description', 'omschrijving', 'mededeling', 'memo', 'reference');
    if (di < 0 || ai < 0) return { format, lines: [], skipped: body.length };
    for (const r of body) lines.push({ date: toIsoDate(r[di] ?? ''), amount: toCents(r[ai] ?? ''), counterparty: (r[ni] ?? '').trim(), description: (r[de] ?? '').trim() });
  }
  return { format, lines: lines.filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && l.amount !== 0), skipped };
}

function tag(xml: string, path: string[]): string {
  let cur = xml;
  for (const p of path) {
    const m = cur.match(new RegExp(`<${p}(?:\\s[^>]*)?>([\\s\\S]*?)</${p}>`));
    if (!m) return '';
    cur = m[1];
  }
  return cur.trim();
}

function parseCamt(xml: string): { lines: ParsedLine[]; skipped: number } {
  const lines: ParsedLine[] = [];
  for (const m of xml.matchAll(/<Ntry>([\s\S]*?)<\/Ntry>/g)) {
    const e = m[1];
    const amt = toCents(tag(e, ['Amt']));
    const credit = tag(e, ['CdtDbtInd']) === 'CRDT';
    const party = credit ? 'Dbtr' : 'Cdtr';
    const name = tag(e, ['RltdPties', party, 'Nm']) || tag(e, ['RltdPties', party, 'Pty', 'Nm']);
    const iban = tag(e, ['RltdPties', `${party}Acct`, 'Id', 'IBAN']);
    const desc = tag(e, ['RmtInf', 'Ustrd']) || tag(e, ['AddtlNtryInf']);
    lines.push({ date: toIsoDate(tag(e, ['BookgDt', 'Dt']) || tag(e, ['ValDt', 'Dt'])), amount: credit ? Math.abs(amt) : -Math.abs(amt),
      counterparty: name, counterIban: iban || undefined, description: desc });
  }
  return { lines, skipped: 0 };
}

/** Stable hash for duplicate detection (same line imported twice). */
export async function lineHash(accountId: string, l: ParsedLine, occurrence: number) {
  const s = `${accountId}|${l.date}|${l.amount}|${l.counterparty}|${l.description}|${occurrence}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
