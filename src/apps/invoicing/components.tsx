import { useI18n } from '../../core/i18n';
import { useSession } from '../../core/session';
import { centsFromInput, euro, inputFromCents } from '../../core/format';
import { uid } from '../../core/repo';
import type { Invoice, Lang, Quote, QuoteLine, VatMode } from '../../core/types';
import { db } from '../../core/db';
import { computeTotals, countedLines, lineNet, type InvoiceState } from './domain/money';
import { packageLines, productLine, usePackages, useProducts } from './data';

const UNITS = ['hour', 'piece', 'km', 'flat'] as const;

/** Editable table of quote/invoice lines (also used read-only). */
export function LinesEditor({ lines, onChange, vatMode, editable, allowOptional, lang }: {
  lines: QuoteLine[]; onChange: (l: QuoteLine[]) => void; vatMode: VatMode; editable: boolean; allowOptional?: boolean; lang: Lang;
}) {
  const { t, lang: uiLang } = useI18n();
  const { settings } = useSession();
  const products = useProducts().filter((p) => p.active);
  const packages = usePackages().filter((p) => p.active);
  const set = (i: number, p: Partial<QuoteLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const c = [...lines];
    [c[i], c[j]] = [c[j], c[i]];
    onChange(c);
  };
  const showVat = vatMode === 'vat';
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('quote.line')}</th><th>{t('quote.qty')}</th><th>{t('quote.unit')}</th><th>{t('quote.price')}</th><th>{t('q.discountPct')}</th>
              {showVat && <th>{t('quote.vat')}</th>}
              {allowOptional && <th title={t('q.optional')}>{t('q.optional')}</th>}
              <th style={{ textAlign: 'right' }}>{t('quote.total')}</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} style={{ opacity: l.optional && !l.selected ? 0.75 : 1 }}>
                <td style={{ minWidth: 200 }}>{editable ? <input className="input" value={l.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={t('quote.line')} /> : l.description}</td>
                <td style={{ width: 76 }}>{editable ? <input className="input" inputMode="decimal" value={String(l.quantity).replace('.', ',')} onChange={(e) => set(i, { quantity: Number(e.target.value.replace(',', '.')) || 0 })} aria-label={t('quote.qty')} /> : l.quantity}</td>
                <td style={{ width: 90 }}>{editable ? (
                  <select className="input" value={l.unit} onChange={(e) => set(i, { unit: e.target.value as QuoteLine['unit'] })} aria-label={t('quote.unit')}>
                    {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
                  </select>) : t(`unit.${l.unit}`)}</td>
                <td style={{ width: 104 }}>{editable ? <input className="input" inputMode="decimal" value={inputFromCents(l.unitPrice)} onChange={(e) => set(i, { unitPrice: centsFromInput(e.target.value) ?? 0 })} aria-label={t('quote.price')} /> : euro(l.unitPrice, uiLang)}</td>
                <td style={{ width: 64 }}>{editable ? <input className="input" inputMode="numeric" value={l.discountPct ?? ''} onChange={(e) => set(i, { discountPct: e.target.value ? Number(e.target.value) : undefined })} aria-label={t('q.discountPct')} /> : (l.discountPct ? `${l.discountPct}%` : '')}</td>
                {showVat && <td style={{ width: 70 }}>{editable ? (
                  <select className="input" value={l.vatRate} onChange={(e) => set(i, { vatRate: Number(e.target.value) })} aria-label={t('quote.vat')}>
                    {[21, 9, 0].map((r) => <option key={r} value={r}>{r}%</option>)}
                  </select>) : `${l.vatRate}%`}</td>}
                {allowOptional && (
                  <td style={{ width: 90 }}>
                    <label className="check small" style={{ minHeight: 0 }}><input type="checkbox" disabled={!editable} checked={!!l.optional} onChange={(e) => set(i, { optional: e.target.checked, selected: e.target.checked ? false : undefined })} aria-label={t('q.optional')} /></label>
                    {l.optional && <label className="check tiny" style={{ minHeight: 0 }}><input type="checkbox" disabled={!editable} checked={!!l.selected} onChange={(e) => set(i, { selected: e.target.checked })} />{t('q.selected')}</label>}
                  </td>
                )}
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{euro(lineNet(l), uiLang)}</td>
                {editable && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn icon small ghost" aria-label="up" onClick={() => move(i, -1)}>↑</button>
                    <button className="btn icon small ghost" aria-label="down" onClick={() => move(i, 1)}>↓</button>
                    <button className="btn icon small" aria-label={t('common.delete')} onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value="" aria-label={t('q.addProduct')} onChange={(e) => {
            const p = products.find((x) => x.id === e.target.value);
            if (p) onChange([...lines, productLine(p, lang)]);
          }}>
            <option value="">{t('q.addProduct')}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {euro(p.price, uiLang)}/{t(`unit.${p.unit}`)}</option>)}
          </select>
          {packages.length > 0 && (
            <select className="input" style={{ width: 'auto' }} value="" aria-label={t('q.addPackage')} onChange={(e) => {
              const p = packages.find((x) => x.id === e.target.value);
              if (p) onChange([...lines, ...packageLines(p, products, lang)]);
            }}>
              <option value="">{t('q.addPackage')}</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button className="btn small" onClick={() => onChange([...lines, { id: uid(), description: '', quantity: 1, unit: 'flat', unitPrice: 0, vatRate: settings.vatMode === 'vat' ? 21 : 0 }])}>{t('q.addLine')}</button>
        </div>
      )}
    </div>
  );
}

export function TotalsView({ lines, vatMode, discountPct, extra }: { lines: QuoteLine[]; vatMode: VatMode; discountPct?: number; extra?: { label: string; value: number }[] }) {
  const { t, lang } = useI18n();
  const tt = computeTotals(countedLines(lines), { vatMode, discountPct });
  return (
    <dl className="kv" style={{ justifyContent: 'end', marginLeft: 'auto', maxWidth: 360 }}>
      {tt.discount !== 0 && <><dt>{t('pdf.subtotal')}</dt><dd style={{ textAlign: 'right' }}>{euro(tt.gross, lang)}</dd><dt>{t('pdf.discount')}</dt><dd style={{ textAlign: 'right' }}>- {euro(tt.discount, lang)}</dd></>}
      {vatMode === 'vat' && tt.perRate.map((r) => (
        <span key={r.rate} style={{ display: 'contents' }}><dt>{t('pdf.exVat')} {r.rate}%</dt><dd style={{ textAlign: 'right' }}>{euro(r.base, lang)}</dd><dt>{t('pdf.vat')} {r.rate}%</dt><dd style={{ textAlign: 'right' }}>{euro(r.vat, lang)}</dd></span>
      ))}
      {vatMode !== 'vat' && <><dt>{t('pdf.vat')}</dt><dd style={{ textAlign: 'right' }}>{t('quote.noVat')}</dd></>}
      <dt className="strong">{t('pdf.total')}</dt><dd style={{ textAlign: 'right', fontFamily: 'var(--fq-font-display)', fontSize: 20 }}>{euro(tt.total, lang)}</dd>
      {extra?.map((e) => <span key={e.label} style={{ display: 'contents' }}><dt>{e.label}</dt><dd style={{ textAlign: 'right' }}>{euro(e.value, lang)}</dd></span>)}
    </dl>
  );
}

const STATE_COLOR: Record<InvoiceState | Quote['status'], string> = {
  draft: 'var(--st-enquiry)', sent: 'var(--st-quote_sent)', partially_paid: 'var(--st-option)', overdue: 'var(--danger)', paid: 'var(--st-paid)',
  credited: 'var(--st-played)', accepted: 'var(--st-confirmed)', declined: 'var(--st-lost)', expired: 'var(--st-lost)', superseded: 'var(--st-enquiry)',
};

export function DocPill({ state, kind }: { state: InvoiceState | Quote['status']; kind: 'quote' | 'invoice' }) {
  const { t } = useI18n();
  const label = kind === 'quote' ? t(`quote.status.${state as Quote['status']}`) : t(`i.state.${state as InvoiceState}`);
  return <span className="pill" style={{ color: STATE_COLOR[state] }}>{label}</span>;
}

/** Load gig + venue for a PDF and build the blob. */
export async function makeQuotePdf(q: Quote, settings: Parameters<typeof import('./domain/pdfDoc').quoteDefinition>[1]['settings']) {
  const [{ quoteDefinition }, { pdfBlob, paperLogoSvg }] = await Promise.all([import('./domain/pdfDoc'), import('./pdf')]);
  const gig = await db.gigs.get(q.gigId);
  const venue = gig?.venueId ? await db.venues.get(gig.venueId) : undefined;
  return pdfBlob(quoteDefinition(q, { settings, gig, venue, logoSvg: paperLogoSvg }));
}

export async function makeInvoicePdf(inv: Invoice, settings: Parameters<typeof import('./domain/pdfDoc').invoiceDefinition>[1]['settings'], paid: number) {
  const [{ invoiceDefinition }, { pdfBlob, paperLogoSvg }] = await Promise.all([import('./domain/pdfDoc'), import('./pdf')]);
  const gig = inv.gigId ? await db.gigs.get(inv.gigId) : undefined;
  const venue = gig?.venueId ? await db.venues.get(gig.venueId) : undefined;
  const ref = inv.creditsInvoiceId ? (await db.invoices.get(inv.creditsInvoiceId))?.number : undefined;
  return pdfBlob(invoiceDefinition(inv, { settings, gig, venue, logoSvg: paperLogoSvg, payments: paid, refNumber: ref }));
}

export const pdfName = (kind: string, number?: string, title?: string) =>
  `${kind}-${number ?? 'concept'}${title ? '-' + title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') : ''}.pdf`;
