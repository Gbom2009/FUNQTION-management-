// Turn raw OCR text of a (Dutch) receipt or invoice into suggested fields.
// Heuristics only: the user always confirms. Each field carries a confidence
// so the UI can highlight what to check.

export interface ReceiptGuess {
  total?: number;      // cents incl. VAT
  date?: string;       // yyyy-mm-dd
  vatRate?: number;
  vatAmount?: number;  // cents
  supplier?: string;
  confidence: { total: number; date: number; vat: number; supplier: number };
}

const AMOUNT = /(?<![\d.,])-?(?:€\s?)?(\d{1,3}(?:[.\s]\d{3})+|\d+)[.,](\d{2})(?!\d)/g;

export function parseAmounts(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const whole = m[1].replace(/[.\s]/g, '');
    const neg = m[0].trim().startsWith('-');
    out.push((neg ? -1 : 1) * (Number(whole) * 100 + Number(m[2])));
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mrt: 3, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const validDate = (y: number, m: number, d: number) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

export function parseDate(text: string): string | undefined {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (validDate(y, +m[2], +m[1])) return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = text.toLowerCase().match(/\b(\d{1,2})\s+(jan|feb|mrt|mar|apr|mei|may|jun|jul|aug|sep|okt|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/);
  if (m && validDate(+m[3], MONTHS[m[2]], +m[1])) return `${m[3]}-${pad(MONTHS[m[2]])}-${pad(+m[1])}`;
  return undefined;
}

const TOTAL_WORDS = /\b(totaal|total|te betalen|totaalbedrag|bedrag|amount due|grand total|betaald|pin|contant|to pay)\b/i;
const SUBTOTAL = /\b(subtotaal|subtotal|excl|exclusief)\b/i;
const VAT_WORDS = /\b(btw|b\.t\.w|vat|bt w|omzetbelasting)\b/i;

export function parseReceiptText(text: string, knownSuppliers: string[] = []): ReceiptGuess {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const guess: ReceiptGuess = { confidence: { total: 0, date: 0, vat: 0, supplier: 0 } };

  // Total: amounts on "totaal"-like lines (not subtotal), else the largest amount.
  const totals: number[] = [];
  for (const l of lines) if (TOTAL_WORDS.test(l) && !SUBTOTAL.test(l) && !VAT_WORDS.test(l)) totals.push(...parseAmounts(l).filter((a) => a > 0));
  const all = lines.flatMap((l) => parseAmounts(l)).filter((a) => a > 0);
  if (totals.length) { guess.total = Math.max(...totals); guess.confidence.total = 0.8; }
  else if (all.length) { guess.total = Math.max(...all); guess.confidence.total = 0.4; }

  const date = parseDate(text);
  if (date) { guess.date = date; guess.confidence.date = 0.8; }

  // VAT: a line mentioning btw/vat (or a rate). OCR often misreads "21%" as "214" or "21 °",
  // so the rate is also derived from the amounts on the line (vat ÷ base ≈ 21% or 9%).
  for (const l of lines) {
    const hasWord = VAT_WORDS.test(l);
    const rateMatch = l.match(/\b(21|9)\s?[%4°o]?(?=\s|$)/i) ?? l.match(/\b(21|9)\s?%/);
    if (!hasWord && !/\b(21|9)\s?%/.test(l)) continue;
    const amts = parseAmounts(l).filter((x) => x > 0);
    let rate: number | undefined;
    if (amts.length >= 2) {
      const vat = Math.min(...amts);
      const big = Math.max(...amts);
      for (const r of [21, 9]) {
        const asBase = (vat / big) * 100;              // (base, vat)
        const asTotal = (vat / (big - vat)) * 100;      // (total, vat)
        if (Math.abs(asBase - r) < 1.2 || Math.abs(asTotal - r) < 1.2) { rate = r; break; }
      }
      if (rate != null) { guess.vatRate = rate; guess.vatAmount = vat; guess.confidence.vat = 0.8; break; }
    }
    if (rateMatch) {
      guess.vatRate = Number(rateMatch[1]);
      if (amts.length === 1) { guess.vatAmount = amts[0]; guess.confidence.vat = 0.6; }
      else guess.confidence.vat = 0.5;
      break;
    }
  }
  if (guess.vatRate == null) {
    const r = text.match(/\b(21|9)\s?%/);
    if (r) { guess.vatRate = Number(r[1]); guess.confidence.vat = 0.4; }
  }
  if (guess.vatRate != null && guess.vatAmount == null && guess.total) {
    guess.vatAmount = Math.round((guess.total * guess.vatRate) / (100 + guess.vatRate));
    guess.confidence.vat = Math.min(guess.confidence.vat || 0.4, 0.5);
  }

  // Supplier: a known supplier mentioned anywhere, else the first line with letters.
  const lower = text.toLowerCase();
  const known = knownSuppliers.find((s) => s.length > 2 && lower.includes(s.toLowerCase()));
  if (known) { guess.supplier = known; guess.confidence.supplier = 0.9; }
  else {
    const first = lines.find((l) => /[a-z]{3,}/i.test(l) && !/^(kassabon|bon|receipt|factuur|invoice)\b/i.test(l));
    if (first) { guess.supplier = first.replace(/[^\p{L}\p{N}&.' -]/gu, '').trim().slice(0, 40); guess.confidence.supplier = 0.4; }
  }
  return guess;
}
