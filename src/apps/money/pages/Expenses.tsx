import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Eq, Field, Section, useToast } from '../../../core/ui';
import { centsFromInput, fmtDate, inputFromCents } from '../../../core/format';
import { addDays, parseDate, todayStr, toDateStr } from '../../../core/dates';
import { save, softDelete } from '../../../core/repo';
import type { Asset, Expense, Payer, Receipt } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { parseReceiptText, type ReceiptGuess } from '../domain/receipt';
import { compressImage, ocrImage } from '../ocr';
import { knownSuppliers, saveExpense, storeReceipt, supplierMemory, useCategories, useExpenses } from '../data';
import { Amount, PeriodBar, usePeriod } from '../components';
import { within } from '../domain/ledger';

export function ExpenseList() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const ctl = usePeriod('month');
  const expenses = useExpenses();
  const cats = new Map(useCategories().map((c) => [c.id, c]));
  const [onlyMissing, setOnlyMissing] = useState(params.get('missing') === '1');
  const [q, setQ] = useState('');
  const rows = expenses.filter((e) => (onlyMissing ? e.status === 'missing_receipt' : within(e.date, ctl.period)))
    .filter((e) => !q || `${e.supplier} ${e.description ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((s, e) => s + Math.round(e.amount * e.businessPct / 100), 0);
  return (
    <div>
      <div className="page-head">
        <div><h1>{t('m.expenses')}</h1><div className="sub">{t('m.total')}: <Amount cents={total} strong /></div></div>
        <div className="row">
          {!onlyMissing && <PeriodBar ctl={ctl} />}
          <Link className="btn primary" to="/money/expenses/new">📷 {t('m.receipt')}</Link>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 'var(--s4)' }}>
        <label className="check small"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />{t('m.onlyMissing')}</label>
        <input className="input" style={{ maxWidth: 260 }} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
      </div>
      {rows.length === 0 ? <Empty>{t('m.noExpenses')}</Empty> : (
        <div className="list">
          {rows.map((e) => {
            const c = cats.get(e.categoryId);
            return (
              <Link key={e.id} to={`/money/expenses/${e.id}`} className="list-item">
                <span className="small" style={{ minWidth: 70 }}>{fmtDate(e.date, 'nl', { day: 'numeric', month: 'short' })}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong" style={{ overflowWrap: 'anywhere' }}>{e.supplier}</div>
                  <div className="tiny muted">{c?.icon} {c?.name}{e.businessPct < 100 ? ` · ${e.businessPct}%` : ''} · {e.paidBy === 'business' ? t('m.payer.business') : e.paidBy === 'gijs' ? 'Gijs' : 'Coen'}</div>
                </div>
                <span title={e.status === 'missing_receipt' ? t('m.missingReceipt') : t('m.hasReceipt')} style={{ color: e.status === 'missing_receipt' ? 'var(--warning)' : 'var(--ok)' }}>{e.status === 'missing_receipt' ? '⚠' : '🧾'}</span>
                {e.bankLineId && <span className="tiny muted" title={t('m.matched')}>🏦</span>}
                <Amount cents={-e.amount} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function lastPayer(): Payer | null {
  try { return localStorage.getItem('fq.paidBy') as Payer | null; } catch { return null; }
}

type Draft = Partial<Expense> & { amountText: string; vatText: string };

export function ExpenseEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { me, settings } = useSession();
  const cats = useCategories().filter((c) => c.active && c.kind === 'expense');
  const gigs = useGigs();
  const stored = useLiveQuery(() => (isNew ? undefined : db.expenses.get(id!)), [id]);
  const receipts = (useLiveQuery(async (): Promise<(Receipt | undefined)[]> => (stored?.receiptIds?.length ? db.receipts.bulkGet(stored.receiptIds) : []), [stored?.receiptIds?.join()]) ?? []).filter(Boolean) as Receipt[];
  const fileRef = useRef<HTMLInputElement>(null);
  const [d, setD] = useState<Draft | null>(isNew ? { date: todayStr(), supplier: '', amountText: '', vatText: '', vatRate: 21, businessPct: 100, paidBy: lastPayer() || me?.id || 'business', receiptIds: [] } : null);
  const [newReceipts, setNewReceipts] = useState<Receipt[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [ocr, setOcr] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [guess, setGuess] = useState<ReceiptGuess | null>(null);
  useEffect(() => {
    if (stored && !d) setD({ ...stored, amountText: inputFromCents(stored.amount), vatText: inputFromCents(stored.vatAmount) });
  }, [stored, d]);
  useEffect(() => {
    const r = newReceipts[0] ?? receipts[0];
    if (!r || !r.mime.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(r.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [newReceipts, receipts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearGigs = useMemo(() => {
    if (!d?.date) return [];
    const from = toDateStr(addDays(parseDate(d.date), -3)); const to = toDateStr(addDays(parseDate(d.date), 3));
    return gigs.filter((g) => g.date >= from && g.date <= to && g.stage !== 'lost');
  }, [gigs, d?.date]);

  if (!d) return null;
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const cat = cats.find((c) => c.id === d.categoryId);
  const amount = centsFromInput(d.amountText) ?? 0;
  const assetSuggest = amount - (centsFromInput(d.vatText) ?? 0) >= settings.assetMinCents && !d.assetId;
  const low = (k: keyof ReceiptGuess['confidence']) => (guess && guess.confidence[k] > 0 && guess.confidence[k] < 0.6 ? { borderColor: 'var(--warning)' } : undefined);

  async function onFile(f: File) {
    const blob = await compressImage(f);
    const r = await storeReceipt(blob, f.name);
    setNewReceipts((x) => [r, ...x]);
    if (!blob.type.startsWith('image/')) return;
    setOcr('busy');
    try {
      const text = await ocrImage(blob);
      await save<Receipt>('receipts', { ...r, ocrText: text });
      const g = parseReceiptText(text, await knownSuppliers());
      setGuess(g);
      const mem = g.supplier ? await supplierMemory(g.supplier) : undefined;
      setD((cur) => cur && ({
        ...cur,
        supplier: cur.supplier || g.supplier || '',
        date: g.date ?? cur.date,
        amountText: cur.amountText || (g.total ? inputFromCents(g.total) : ''),
        vatRate: g.vatRate ?? mem?.vatRate ?? cur.vatRate,
        vatText: cur.vatText || (g.vatAmount != null ? inputFromCents(g.vatAmount) : ''),
        categoryId: cur.categoryId ?? mem?.categoryId,
        businessPct: mem?.businessPct ?? cur.businessPct,
      }));
      setOcr('done');
    } catch { setOcr('error'); }
  }

  async function onSupplierBlur() {
    if (!d || d.categoryId || !d.supplier) return;
    const mem = await supplierMemory(d.supplier);
    if (mem) set({ categoryId: mem.categoryId, vatRate: mem.vatRate, businessPct: mem.businessPct, reverseCharge: mem.reverseCharge });
  }

  async function persist(andNew = false) {
    if (!d || !d.categoryId || !amount || !d.supplier?.trim()) { toast(t('m.fillRequired')); return; }
    try { localStorage.setItem('fq.paidBy', d.paidBy ?? 'business'); } catch { /* ignore */ }
    const { amountText: _a, vatText, ...rest } = d;
    const vat = centsFromInput(vatText) ?? (d.vatRate ? Math.round((amount * d.vatRate) / (100 + d.vatRate)) : 0);
    const e = await saveExpense({ ...(rest as Expense), supplier: d.supplier.trim(), amount, vatAmount: vat, receiptIds: [...new Set([...(d.receiptIds ?? []), ...newReceipts.map((r) => r.id)])] });
    toast(t('common.saved'));
    if (andNew) { setD({ date: todayStr(), supplier: '', amountText: '', vatText: '', vatRate: 21, businessPct: 100, paidBy: d.paidBy, receiptIds: [] }); setNewReceipts([]); setGuess(null); setOcr('idle'); }
    else nav(isNew ? '/money/expenses' : `/money/expenses/${e.id}`, { replace: true });
    return e;
  }

  async function makeAsset() {
    const e = await persist();
    if (!e) return;
    const a = await save<Asset>('assets', { name: e.description || e.supplier, purchaseDate: e.date, cost: e.amount - (settings.vatMode === 'vat' ? e.vatAmount : 0), residual: 0, lifeYears: 5, businessPct: e.businessPct, paidBy: e.paidBy, expenseId: e.id });
    await save<Expense>('expenses', { ...e, assetId: a.id });
    nav(`/money/assets?id=${a.id}`);
  }

  return (
    <div>
      <div className="page-head">
        <div><div className="legend"><Link to="/money/expenses">← {t('m.expenses')}</Link></div><h1>{isNew ? t('m.newExpense') : d.supplier}</h1></div>
      </div>
      <div className="layout-2">
        <div>
          <Section>
            <div className="stack">
              <div className="row">
                <button className="btn primary" onClick={() => fileRef.current?.click()}>📷 {t('m.takePhoto')}</button>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
                {ocr === 'busy' && <span className="small"><Eq /> {t('m.reading')}</span>}
                {ocr === 'done' && <span className="small" style={{ color: 'var(--ok)' }}>✓ {t('m.readDone')}</span>}
                {ocr === 'error' && <span className="small" style={{ color: 'var(--warning)' }}>{t('m.readError')}</span>}
              </div>
              <div className="grid2">
                <Field label={t('m.amount')}><input inputMode="decimal" value={d.amountText} style={low('total')} onChange={(e) => set({ amountText: e.target.value })} /></Field>
                <Field label={t('common.date')}><input type="date" value={d.date ?? ''} style={low('date')} onChange={(e) => set({ date: e.target.value })} /></Field>
                <Field label={t('m.supplier')}><input value={d.supplier ?? ''} style={low('supplier')} onChange={(e) => set({ supplier: e.target.value })} onBlur={onSupplierBlur} /></Field>
                <div className="grid2">
                  <Field label={t('m.vatRate')}>
                    <select value={d.vatRate ?? 21} onChange={(e) => { const r = Number(e.target.value); set({ vatRate: r, vatText: amount ? inputFromCents(Math.round((amount * r) / (100 + r))) : d.vatText }); }}>
                      {[21, 9, 0].map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </Field>
                  <Field label={t('m.vatAmount')}><input inputMode="decimal" value={d.vatText} style={low('vat')} onChange={(e) => set({ vatText: e.target.value })} /></Field>
                </div>
              </div>
              <div className="field"><span>{t('m.category')}</span>
                <div className="chips">
                  {cats.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={d.categoryId === c.id}
                    onClick={() => set({ categoryId: c.id, businessPct: d.businessPct === 100 ? c.defaultBusinessPct : d.businessPct, vatRate: d.vatRate ?? c.defaultVatRate })}>{c.icon} {lang === 'en' ? c.nameEn : c.name}</button>)}
                </div>
                {cat && cat.deductiblePct < 100 && <small className="muted tiny">{t('m.partlyDeductible', { pct: cat.deductiblePct })}</small>}
              </div>
              <div className="field"><span>{t('m.paidBy')}</span>
                <div className="chips">
                  {(['business', 'gijs', 'coen'] as Payer[]).map((p) => <button key={p} type="button" className="chip" aria-pressed={d.paidBy === p} onClick={() => set({ paidBy: p })}>{p === 'business' ? t('m.payer.business') : p === 'gijs' ? 'Gijs' : 'Coen'}</button>)}
                </div>
              </div>
              {nearGigs.length > 0 && (
                <div className="field"><span>{t('m.linkGig')}</span>
                  <div className="chips">
                    <button type="button" className="chip" aria-pressed={!d.gigId} onClick={() => set({ gigId: undefined })}>—</button>
                    {nearGigs.map((g) => <button key={g.id} type="button" className="chip" aria-pressed={d.gigId === g.id} onClick={() => set({ gigId: g.id })}>{fmtDate(g.date, lang, { day: 'numeric', month: 'short' })} {g.title}</button>)}
                  </div>
                </div>
              )}
              <div className="grid2">
                <Field label={t('m.businessPct')}><input inputMode="numeric" value={d.businessPct ?? 100} onChange={(e) => set({ businessPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>
                <Field label={t('c.description')}><input value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
              </div>
              <label className="check small"><input type="checkbox" checked={!!d.reverseCharge} onChange={(e) => set({ reverseCharge: e.target.checked })} />{t('m.reverseCharge')}</label>
              <Field label={t('common.notes')}><textarea value={d.note ?? ''} onChange={(e) => set({ note: e.target.value })} /></Field>
              {assetSuggest && <div className="banner info"><span>ℹ</span><div className="txt">{t('m.assetHint')} <button className="btn small" onClick={makeAsset}>{t('m.makeAsset')}</button></div></div>}
              {d.assetId && <Link className="small" to={`/money/assets?id=${d.assetId}`}>{t('m.isAsset')} →</Link>}
            </div>
          </Section>
          <div className="savebar">
            {!isNew && <button className="btn small danger" onClick={async () => { if (confirm(t('common.confirmDelete'))) { await softDelete('expenses', id!); nav('/money/expenses'); } }}>{t('common.delete')}</button>}
            <div className="row" style={{ marginLeft: 'auto' }}>
              {isNew && <button className="btn" onClick={() => persist(true)}>{t('m.saveAndNew')}</button>}
              <button className="btn primary" onClick={() => persist()}>{t('common.save')}</button>
            </div>
          </div>
        </div>
        <Section title={t('m.receiptImage')}>
          {preview ? <img src={preview} alt={t('m.receiptImage')} style={{ width: '100%', border: 'var(--fq-rule)' }} />
            : (newReceipts[0] ?? receipts[0]) ? <p className="small">📄 {(newReceipts[0] ?? receipts[0]).name ?? 'PDF'}</p>
            : <Empty>{t('m.noReceipt')}</Empty>}
          {guess && <p className="tiny muted" style={{ marginTop: 'var(--s2)' }}>{t('m.ocrHint')}</p>}
        </Section>
      </div>
    </div>
  );
}
