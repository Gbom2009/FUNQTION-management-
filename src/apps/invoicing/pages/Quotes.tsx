import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section, StagePill, useToast } from '../../../core/ui';
import { euro, fmtDate, fmtDateTime } from '../../../core/format';
import { save } from '../../../core/repo';
import { LOST_REASONS, type Quote } from '../../../core/types';
import { byId, useGigs } from '../../bookings/data';
import { MessageComposer } from '../../bookings/components/parts';
import { quoteTotals } from '../domain/money';
import {
  acceptQuote, cancellationPreview, createCancellationInvoice, createInvoiceFromQuote, createQuoteForGig, declineQuote, markQuoteSent,
  newQuoteVersion, useAllQuotes, useInvoices,
} from '../data';
import { DocPill, LinesEditor, TotalsView, makeQuotePdf, pdfName } from '../components';
import { downloadBlob } from '../../bookings/components/parts';

const STATUSES: Quote['status'][] = ['draft', 'sent', 'accepted', 'declined', 'expired', 'superseded'];

export function QuoteList() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const quotes = useAllQuotes();
  const gigs = byId(useGigs());
  const [status, setStatus] = useState<Quote['status'] | 'open'>('open');
  const [pick, setPick] = useState(false);
  const rows = quotes
    .filter((q) => (status === 'open' ? q.status === 'draft' || q.status === 'sent' : q.status === status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div>
      <div className="page-head">
        <h1>{t('inv.quotes')}</h1>
        <button className="btn primary" onClick={() => setPick(true)}>+ {t('inv.newQuote')}</button>
      </div>
      <div className="scroll-x" style={{ marginBottom: 'var(--s4)' }}>
        <div className="chips">
          {(['open', ...STATUSES] as const).map((s) => (
            <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === 'open' ? `${t('quote.status.draft')} + ${t('quote.status.sent')}` : t(`quote.status.${s}`)}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <Empty>{t('q.empty')}</Empty> : (
        <div className="list">
          {rows.map((q) => {
            const g = gigs.get(q.gigId);
            return (
              <Link key={q.id} to={`/invoicing/quotes/${q.id}`} className="list-item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong">{q.client?.name || g?.title || '—'} <span className="muted small">{q.number ?? ''} {t('q.version', { v: q.version })}</span></div>
                  <div className="tiny muted">{g ? `${g.title} · ${fmtDate(g.date, lang)}` : ''}</div>
                </div>
                <span className="small strong">{euro(quoteTotals(q).total, lang)}</span>
                <DocPill state={q.status} kind="quote" />
              </Link>
            );
          })}
        </div>
      )}
      {pick && <GigPicker onClose={() => setPick(false)} onPick={async (gigId) => { const q = await createQuoteForGig(gigId); nav(`/invoicing/quotes/${q.id}`); }} />}
    </div>
  );
}

export function GigPicker({ onClose, onPick }: { onClose: () => void; onPick: (gigId: string) => void }) {
  const { t, lang } = useI18n();
  const gigs = useGigs().filter((g) => !['lost', 'cancelled', 'paid'].includes(g.stage)).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  return (
    <Modal title={t('q.chooseGig')} onClose={onClose}>
      {gigs.length === 0 ? <Empty>{t('pipe.empty')}</Empty> : (
        <div className="list">
          {gigs.map((g) => (
            <button key={g.id} className="list-item" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => onPick(g.id)}>
              <span className="small" style={{ minWidth: 90 }}>{fmtDate(g.date, lang, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
              <span className="grow">{g.title || g.reference}</span><StagePill stage={g.stage} />
            </button>
          ))}
        </div>
      )}
      <Link className="btn small ghost" to="/bookings/gigs/new">+ {t('gig.new')}</Link>
    </Modal>
  );
}

export function QuoteEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const stored = useLiveQuery(() => db.quotes.get(id!), [id]);
  const gig = useLiveQuery(() => (stored ? db.gigs.get(stored.gigId) : undefined), [stored?.gigId]);
  const person = useLiveQuery(() => (gig?.clientPersonId ? db.persons.get(gig.clientPersonId) : undefined), [gig?.clientPersonId]);
  const invoices = useInvoices().filter((i) => i.quoteId === id);
  const [d, setD] = useState<Quote | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'send' | 'accept' | 'decline' | 'invoice' | 'cancel'>(params.get('send') ? 'send' : null);
  useEffect(() => { if (stored && !dirty) setD(stored); }, [stored, dirty]);
  if (!d || !stored) return null;
  const editable = d.status === 'draft';
  const set = (p: Partial<Quote>) => { setD({ ...d, ...p }); setDirty(true); };
  const tt = quoteTotals(d);
  const ttAll = quoteTotals(d, true);
  const lng = d.language ?? lang;

  async function persist() { const s = await save<Quote>('quotes', d!); setD(s); setDirty(false); toast(t('common.saved')); return s; }
  const pdf = () => makeQuotePdf(d!, settings);

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="legend"><Link to="/invoicing/quotes">← {t('inv.quotes')}</Link></div>
          <h1 style={{ overflowWrap: 'anywhere' }}>{t('pdf.quote')} {d.number ?? ''}</h1>
          <div className="sub row"><DocPill state={d.status} kind="quote" /><span>{t('q.version', { v: d.version })}</span>
            {gig && <Link to={`/bookings/gigs/${gig.id}`}>{gig.title} · {fmtDate(gig.date, lang)}</Link>}
            {gig && <StagePill stage={gig.stage} />}</div>
        </div>
        <div className="row">
          <button className="btn" onClick={async () => downloadBlob(await pdf(), pdfName('offerte', d.number, gig?.title))}>{t('q.preview')}</button>
          {(d.status === 'draft' || d.status === 'sent') && <button className="btn" disabled={dirty} onClick={() => setDialog('send')}>{t('q.send')}</button>}
          {(d.status === 'draft' || d.status === 'sent') && <button className="btn primary" disabled={dirty} onClick={() => setDialog('accept')}>{t('q.markAccepted')}</button>}
          {d.status === 'accepted' && <button className="btn primary" onClick={() => setDialog('invoice')}>{t('q.invoice')}</button>}
        </div>
      </div>

      {gig && <ContractBanner quote={d} gigId={gig.id} />}
      {!editable && <div className="banner info" style={{ marginBottom: 'var(--s4)' }}><span>🔒</span><div className="txt">{t('q.locked')}{' '}
        {d.status !== 'superseded' && <button className="btn small" onClick={async () => { const n = await newQuoteVersion(d); nav(`/invoicing/quotes/${n.id}`); }}>{t('quote.newVersion')}</button>}</div></div>}
      {d.status === 'accepted' && d.acceptedAt && (
        <div className="banner ok" style={{ marginBottom: 'var(--s4)' }}><span>✓</span><div className="txt">{t('q.acceptedOn', { date: fmtDateTime(d.acceptedAt, lang), name: d.acceptedBy ?? '', via: d.acceptedVia ? t(`q.via.${d.acceptedVia}`) : '' })}{d.acceptedNote ? ` – ${d.acceptedNote}` : ''}</div></div>
      )}

      <Section title={t('q.lines')}>
        <div className="stack">
          <LinesEditor lines={d.lines} onChange={(lines) => set({ lines })} vatMode={d.vatMode ?? settings.vatMode} editable={editable} allowOptional lang={lng} />
          <div className="grid3">
            <Field label={t('q.totalDiscount')}><input inputMode="numeric" disabled={!editable} value={d.discountPct ?? ''} onChange={(e) => set({ discountPct: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label={t('q.depositPct')}><input inputMode="numeric" disabled={!editable} value={d.depositPct ?? ''} onChange={(e) => set({ depositPct: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label={t('quote.validUntil')}><input type="date" disabled={!editable} value={d.validUntil ?? ''} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
          </div>
          <TotalsView lines={d.lines} vatMode={d.vatMode ?? settings.vatMode} discountPct={d.discountPct} />
          {ttAll.total !== tt.total && <p className="small muted" style={{ textAlign: 'right' }}>{t('q.totalAll')}: {euro(ttAll.total, lang)}</p>}
        </div>
      </Section>
      <div className="layout-2">
        <div>
          <Section title={t('q.intro')}>
            <div className="stack">
              <Field label={t('q.intro')}><textarea disabled={!editable} value={d.intro ?? ''} onChange={(e) => set({ intro: e.target.value })} /></Field>
              <Field label={t('q.notes')}><textarea disabled={!editable} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
          </Section>
        </div>
        <div>
          <Section title={t('q.client')}>
            <div className="stack">
              <Field label={t('q.name')}><input disabled={!editable} value={d.client?.name ?? ''} onChange={(e) => set({ client: { ...d.client!, name: e.target.value } })} /></Field>
              <Field label={t('q.attention')}><input disabled={!editable} value={d.client?.attention ?? ''} onChange={(e) => set({ client: { ...d.client!, attention: e.target.value } })} /></Field>
              <Field label={t('q.address')}><textarea rows={3} disabled={!editable} value={d.client?.address ?? ''} onChange={(e) => set({ client: { ...d.client!, address: e.target.value } })} /></Field>
              <Field label={t('common.email')}><input disabled={!editable} value={d.client?.email ?? ''} onChange={(e) => set({ client: { ...d.client!, email: e.target.value } })} /></Field>
              <Field label={t('q.language')}>
                <select disabled={!editable} value={lng} onChange={(e) => set({ language: e.target.value as 'nl' | 'en' })}><option value="nl">Nederlands</option><option value="en">English</option></select>
              </Field>
              <p className="tiny muted">{t('q.fromGig')}</p>
            </div>
          </Section>
          {invoices.length > 0 && (
            <Section title={t('inv.invoices')}>
              <div className="list">{invoices.map((i) => (
                <Link key={i.id} className="list-item" to={`/invoicing/invoices/${i.id}`}><span className="grow">{t(`i.kind.${i.kind}`)} {i.number ?? `(${t('i.state.draft')})`}</span></Link>
              ))}</div>
            </Section>
          )}
          <div className="row">
            {(d.status === 'draft' || d.status === 'sent') && <button className="btn small danger" onClick={() => setDialog('decline')}>{t('q.decline')}</button>}
            {d.status === 'accepted' && <button className="btn small danger" onClick={() => setDialog('cancel')}>{t('q.cancel')}</button>}
          </div>
        </div>
      </div>

      {dirty && (
        <div className="savebar">
          <span className="small muted">{t('common.unsaved')}</span>
          <div className="row"><button className="btn ghost" onClick={() => { setDirty(false); setD(stored); }}>{t('common.cancel')}</button><button className="btn primary" onClick={persist}>{t('common.save')}</button></div>
        </div>
      )}

      {dialog === 'send' && (
        <SendQuote quote={d} onClose={() => setDialog(null)} gig={gig ?? undefined} person={person ?? undefined} />
      )}
      {dialog === 'accept' && <AcceptDialog quote={d} onClose={() => setDialog(null)} />}
      {dialog === 'decline' && <DeclineDialog quote={d} onClose={() => setDialog(null)} />}
      {dialog === 'invoice' && <InvoiceFromQuote quote={d} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelDialog quote={d} onClose={() => setDialog(null)} />}
    </div>
  );
}

function SendQuote({ quote, gig, person, onClose }: { quote: Quote; gig?: import('../../../core/types').Gig; person?: import('../../../core/types').Person; onClose: () => void }) {
  const { me, settings } = useSession();
  const { lang } = useI18n();
  const [q, setQ] = useState<Quote | null>(null);
  useEffect(() => { if (me) markQuoteSent(quote, me.id).then(setQ); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q) return null;
  const l = q.language ?? lang;
  return (
    <MessageComposer kind="quote_send" gig={gig} person={person} language={l} onClose={onClose}
      extraFields={{ quoteNumber: q.number ?? '', amount: euro(quoteTotals(q).total, l), validUntil: fmtDate(q.validUntil, l, { day: 'numeric', month: 'long', year: 'numeric' }),
        depositPct: String(q.depositPct ?? settings.depositPct), email: q.client?.email ?? '', firstName: person?.firstName ?? q.client?.attention?.split(' ')[0] ?? q.client?.name.split(' ')[0] ?? '' }}
      pdf={{ name: pdfName('offerte', q.number, gig?.title), make: () => makeQuotePdf(q, settings) }} />
  );
}

function AcceptDialog({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const [name, setName] = useState(quote.client?.attention || quote.client?.name || '');
  const [via, setVia] = useState<NonNullable<Quote['acceptedVia']>>('whatsapp');
  const [note, setNote] = useState('');
  const optional = quote.lines.filter((l) => l.optional);
  const [sel, setSel] = useState<string[]>(optional.filter((l) => l.selected).map((l) => l.id));
  async function submit() {
    if (!me || !name.trim()) return;
    const r = await acceptQuote(quote, me.id, { name: name.trim(), via, note, selected: sel });
    toast(r === 'conflict' ? t('q.conflictWarn') : r === 'contract' ? t('q.contractNext') : t('q.confirmed'));
    onClose();
  }
  return (
    <Modal title={t('q.markAccepted')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!name.trim()} onClick={submit}>{t('q.markAccepted')}</button></>}>
      <div className="grid2">
        <Field label={t('q.acceptedBy')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('q.acceptedVia')}>
          <select value={via} onChange={(e) => setVia(e.target.value as typeof via)}>
            {(['whatsapp', 'email', 'phone', 'in_person', 'signed_pdf', 'other'] as const).map((v) => <option key={v} value={v}>{t(`q.via.${v}`)}</option>)}
          </select>
        </Field>
      </div>
      {optional.length > 0 && (
        <div className="field"><span>{t('q.chooseExtras')}</span>
          {optional.map((l) => (
            <label key={l.id} className="check"><input type="checkbox" checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} />{l.description}</label>
          ))}
        </div>
      )}
      <Field label={t('common.notes')}><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

function DeclineDialog({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal title={t('q.decline')} onClose={onClose} footer={<button className="btn primary" disabled={!reason} onClick={async () => { await declineQuote(quote, reason, note); onClose(); }}>{t('q.decline')}</button>}>
      <Field label={t('q.declineReason')}>
        <select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">—</option>{LOST_REASONS.map((r) => <option key={r} value={r}>{t(`lost.${r}`)}</option>)}</select>
      </Field>
      <Field label={t('common.notes')}><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

export function InvoiceFromQuote({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const nav = useNavigate();
  const [pct, setPct] = useState(quote.depositPct ?? settings.depositPct);
  const total = quoteTotals(quote).total;
  const go = async (kind: 'deposit' | 'final' | 'standard') => { const inv = await createInvoiceFromQuote(quote, kind, pct); nav(`/invoicing/invoices/${inv.id}`); };
  return (
    <Modal title={t('inv.invoices')} onClose={onClose}>
      <div className="card stack">
        <div className="strong">{t('q.makeDeposit')}</div>
        <div className="row"><input className="input" style={{ width: 90 }} inputMode="numeric" value={pct} onChange={(e) => setPct(Number(e.target.value) || 0)} aria-label={t('q.depositPct')} /> % = {euro(Math.round((total * pct) / 100), lang)}
          <button className="btn primary" onClick={() => go('deposit')}>{t('common.new')}</button></div>
      </div>
      <div className="card row between"><span className="strong">{t('q.makeFinal')}</span><button className="btn" onClick={() => go('final')}>{t('common.new')}</button></div>
      <div className="card row between"><span className="strong">{t('q.makeStandard')}</span><button className="btn" onClick={() => go('standard')}>{t('common.new')}</button></div>
    </Modal>
  );
}

function CancelDialog({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [pv, setPv] = useState<Awaited<ReturnType<typeof cancellationPreview>> | null>(null);
  const [cancelGig, setCancelGig] = useState(true);
  useEffect(() => { cancellationPreview(quote).then(setPv); }, [quote]);
  if (!pv) return null;
  return (
    <Modal title={t('q.cancel')} onClose={onClose} footer={<button className="btn primary" onClick={async () => { const inv = await createCancellationInvoice(quote, cancelGig); nav(`/invoicing/invoices/${inv.id}`); }}>{t('i.cancelConfirm')}</button>}>
      <p>{t('i.cancelInfo', { days: Math.max(0, pv.days), pct: pv.pct, total: euro(pv.total, lang), fee: euro(pv.fee, lang) })}</p>
      {pv.depositTotal > 0 && <p className="small">{t('i.cancelDeposit', { amount: euro(pv.depositTotal, lang) })}</p>}
      {pv.depositTotal > pv.fee && <div className="banner warn"><span>!</span><div className="txt">{t('i.cancelRefund')}</div></div>}
      <label className="check"><input type="checkbox" checked={cancelGig} onChange={(e) => setCancelGig(e.target.checked)} />{t('i.cancelGigToo')}</label>
    </Modal>
  );
}

/** App 4 link: shows whether this gig works with a contract and opens/creates it. */
function ContractBanner({ quote, gigId }: { quote: Quote; gigId: string }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const info = useLiveQuery(async () => {
    const gig = await db.gigs.get(gigId);
    if (!gig) return undefined;
    const contracts = (await db.contracts.where('gigId').equals(gigId).toArray()).filter((c) => !c.deletedAt && c.status !== 'cancelled');
    const templates = (await db.contractTemplates.toArray()).filter((x) => !x.deletedAt && x.active);
    const tpl = templates.find((x) => x.eventTypes.includes(gig.eventType)) ?? templates.find((x) => x.eventTypes.includes('other'));
    return { contract: contracts[0], flow: contracts[0]?.flow ?? tpl?.flow ?? 'none' };
  }, [gigId, quote.updatedAt]);
  if (!info || (info.flow === 'none' && !info.contract)) return null;
  const open = async () => {
    const { createContract } = await import('../../contracts/data');
    const c = info.contract ?? await createContract(gigId, { quoteId: quote.id });
    nav(`/contracts/${c.id}`);
  };
  return (
    <div className="banner info" style={{ marginBottom: 'var(--s4)' }}><span>§</span>
      <div className="txt">{info.contract ? t('q.contractExists', { number: info.contract.number, status: t(`ct.status.${info.contract.status}`) }) : t(`q.contractFlow.${info.flow as 'together' | 'after_quote'}`)}
        <div style={{ marginTop: 'var(--s2)' }}><button className="btn small" onClick={open}>{info.contract ? t('q.openContract') : t('q.makeContract')}</button></div>
      </div>
    </div>
  );
}
