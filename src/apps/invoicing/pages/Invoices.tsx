import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section, useToast } from '../../../core/ui';
import { centsFromInput, euro, fmtDate, fmtDateTime, inputFromCents } from '../../../core/format';
import { save, softDelete } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import { download } from '../../../core/backup';
import { INVOICE_KINDS, type Invoice, type InvoiceKind, type Payment } from '../../../core/types';
import { MessageComposer, downloadBlob, TaskRow } from '../../bookings/components/parts';
import { useTasks } from '../../bookings/data';
import { invoiceState, invoiceTotals, paidAmount, type InvoiceState } from '../domain/money';
import {
  createBlankInvoice, createCreditNote, finaliseInvoice, markInvoiceSent, previewNumber, registerPayment, useInvoices, usePayments,
} from '../data';
import { DocPill, LinesEditor, TotalsView, makeInvoicePdf, pdfName } from '../components';
import { GigPicker } from './Quotes';

const STATES: (InvoiceState | 'open' | 'all')[] = ['open', 'overdue', 'draft', 'paid', 'credited', 'all'];

export function InvoiceList() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const invoices = useInvoices();
  const payments = usePayments();
  const [state, setState] = useState<(typeof STATES)[number]>('open');
  const [kind, setKind] = useState<InvoiceKind | 'all'>('all');
  const [pick, setPick] = useState(false);
  const rows = invoices.map((i) => ({ i, st: invoiceState(i, payments), tt: invoiceTotals(i), paid: paidAmount(i.id, payments) }))
    .filter((r) => state === 'all' || (state === 'open' ? ['sent', 'partially_paid', 'overdue'].includes(r.st) : r.st === state))
    .filter((r) => kind === 'all' || r.i.kind === kind)
    .sort((a, b) => (b.i.issueDate ?? '9999').localeCompare(a.i.issueDate ?? '9999') || b.i.updatedAt.localeCompare(a.i.updatedAt));
  const sum = (f: (r: (typeof rows)[number]) => boolean) => invoices.map((i) => ({ i, st: invoiceState(i, payments), tt: invoiceTotals(i), paid: paidAmount(i.id, payments) }))
    .filter(f).reduce((s, r) => s + r.tt.total - r.paid, 0);

  function exportCsv() {
    const head = ['number', 'kind', 'status', 'issueDate', 'supplyDate', 'dueDate', 'client', 'exVat', 'vat', 'total', 'paid', 'vatMode'];
    const data = rows.map(({ i, st, tt, paid }) => [i.number ?? '', i.kind, st, i.issueDate ?? '', i.supplyDate ?? '', i.dueDate ?? '', i.client.name,
      (tt.ex / 100).toFixed(2), (tt.vat / 100).toFixed(2), (tt.total / 100).toFixed(2), (paid / 100).toFixed(2), i.vatMode]);
    const csv = [head, ...data].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    download(`funqtion-facturen-${todayStr()}.csv`, '﻿' + csv, 'text/csv');
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('inv.invoices')}</h1>
          <div className="sub">{t('inv.open')}: <span className="strong">{euro(sum((r) => ['sent', 'partially_paid', 'overdue'].includes(r.st)), lang)}</span> · <span style={{ color: 'var(--danger)' }}>{t('inv.overdue')}: {euro(sum((r) => r.st === 'overdue'), lang)}</span></div>
        </div>
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as InvoiceKind | 'all')} aria-label={t('common.type')}>
            <option value="all">{t('i.allKinds')}</option>{INVOICE_KINDS.map((k) => <option key={k} value={k}>{t(`i.kind.${k}`)}</option>)}
          </select>
          <button className="btn small only-desktop" onClick={exportCsv}>{t('i.exportCsv')}</button>
          <button className="btn primary" onClick={() => setPick(true)}>+ {t('inv.invoices')}</button>
        </div>
      </div>
      <div className="scroll-x" style={{ marginBottom: 'var(--s4)' }}>
        <div className="chips">
          {STATES.map((s) => <button key={s} className="chip" aria-pressed={state === s} onClick={() => setState(s)}>{s === 'open' ? t('inv.open') : s === 'all' ? t('common.all') : t(`i.state.${s}`)}</button>)}
        </div>
      </div>
      {rows.length === 0 ? <Empty>{t('i.empty')}</Empty> : (
        <div className="list">
          {rows.map(({ i, st, tt, paid }) => (
            <Link key={i.id} to={`/invoicing/invoices/${i.id}`} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong">{i.client.name || '—'} <span className="muted small">{i.number ?? ''}</span></div>
                <div className="tiny muted">{t(`i.kind.${i.kind}`)} · {fmtDate(i.issueDate, lang)}{i.dueDate ? ` · ${t('i.dueDate')} ${fmtDate(i.dueDate, lang)}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="small strong">{euro(tt.total, lang)}</div>
                {paid > 0 && paid < tt.total && <div className="tiny muted">{t('i.openAmount')} {euro(tt.total - paid, lang)}</div>}
              </div>
              <DocPill state={st} kind="invoice" />
            </Link>
          ))}
        </div>
      )}
      {pick && <GigPicker onClose={() => setPick(false)} onPick={async (gigId) => { const inv = await createBlankInvoice(gigId); nav(`/invoicing/invoices/${inv.id}`); }} />}
    </div>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { me, settings } = useSession();
  const stored = useLiveQuery(() => db.invoices.get(id!), [id]);
  const gig = useLiveQuery(() => (stored?.gigId ? db.gigs.get(stored.gigId) : undefined), [stored?.gigId]);
  const person = useLiveQuery(() => (gig?.clientPersonId ? db.persons.get(gig.clientPersonId) : undefined), [gig?.clientPersonId]);
  const payments = usePayments().filter((p) => p.invoiceId === id);
  const related = useInvoices().filter((i) => i.id !== id && stored && ((i.creditsInvoiceId === id) || i.id === stored.creditsInvoiceId || (stored.quoteId && i.quoteId === stored.quoteId)));
  const tasks = useTasks().filter((x) => x.invoiceId === id && x.status !== 'cancelled');
  const [d, setD] = useState<Invoice | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'finalise' | 'send' | 'pay' | 'credit' | { reminder: 1 | 2 | 3 }>(null);
  useEffect(() => { if (stored && !dirty) setD(stored); }, [stored, dirty]);
  if (!d || !stored) return null;
  const draft = d.status === 'draft';
  const set = (p: Partial<Invoice>) => { setD({ ...d, ...p }); setDirty(true); };
  const st = invoiceState(stored, payments);
  const tt = invoiceTotals(d);
  const paid = paidAmount(stored.id, payments);
  const open = tt.total - paid;
  const pdf = () => makeInvoicePdf(stored, settings, paid);
  const fileName = pdfName(d.kind === 'credit_note' ? 'creditnota' : 'factuur', d.number, gig?.title);
  const l = d.language;
  const msgFields = {
    invoiceNumber: d.number ?? '', amountDue: euro(open, l), amount: euro(tt.total, l),
    dueDate: fmtDate(d.dueDate, l, { day: 'numeric', month: 'long', year: 'numeric' }), email: d.client.email ?? '',
    firstName: person?.firstName ?? d.client.attention?.split(' ')[0] ?? d.client.name.split(' ')[0],
    iban: d.seller?.iban || settings.iban || '[IBAN]', accountHolder: d.seller?.accountHolder || settings.accountHolder || settings.businessName,
  };

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="legend"><Link to="/invoicing/invoices">← {t('inv.invoices')}</Link></div>
          <h1>{t(`i.kind.${d.kind}`)} {d.number ?? ''}</h1>
          <div className="sub row"><DocPill state={st} kind="invoice" />
            {gig ? <Link to={`/bookings/gigs/${gig.id}`}>{gig.title} · {fmtDate(gig.date, lang)}</Link> : <span>{t('i.noGigDate')}</span>}
            {!draft && <span>{t('pdf.total')} <span className="strong">{euro(tt.total, lang)}</span>{paid ? ` · ${t('i.openAmount')} ${euro(open, lang)}` : ''}</span>}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={async () => downloadBlob(await pdf(), fileName)}>{t('i.pdf')}</button>
          {draft && <button className="btn primary" disabled={dirty} onClick={() => setDialog('finalise')}>{t('i.finalise')}</button>}
          {!draft && d.kind !== 'credit_note' && <button className="btn" onClick={() => setDialog('send')}>{t('i.send')}</button>}
          {!draft && d.kind !== 'credit_note' && st !== 'paid' && st !== 'credited' && <button className="btn primary" onClick={() => setDialog('pay')}>{t('i.registerPayment')}</button>}
        </div>
      </div>

      {!settings.iban && d.kind !== 'credit_note' && <div className="banner warn" style={{ marginBottom: 'var(--s4)' }}><span>!</span><div className="txt">{t('i.noIban')} <Link to="/invoicing/settings">{t('inv.goSettings')}</Link></div></div>}

      <Section title={t('q.lines')}>
        <div className="stack">
          <LinesEditor lines={d.lines} onChange={(lines) => set({ lines })} vatMode={d.vatMode} editable={draft} lang={d.language} />
          <TotalsView lines={d.lines} vatMode={d.vatMode} extra={paid ? [{ label: t('pdf.paid'), value: -paid }, { label: t('pdf.amountDue'), value: open }] : undefined} />
        </div>
      </Section>
      <div className="layout-2">
        <div>
          {!draft && (
            <Section title={t('i.payments')}>
              {payments.length === 0 ? <p className="muted small">—</p> : (
                <div className="list">{payments.map((p) => (
                  <div key={p.id} className="list-item"><span className="small" style={{ minWidth: 90 }}>{fmtDate(p.date, lang)}</span><span className="grow">{t(`i.method.${p.method}`)} {p.note ? `· ${p.note}` : ''}</span><span className="strong">{euro(p.amount, lang)}</span>
                    <button className="btn icon small ghost" aria-label={t('common.delete')} onClick={() => { if (confirm(t('common.confirmDelete'))) softDelete('payments', p.id); }}>✕</button></div>
                ))}</div>
              )}
            </Section>
          )}
          {!draft && d.kind !== 'credit_note' && (
            <Section title={t('i.reminders')} actions={<button className="btn small ghost" onClick={() => save<Invoice>('invoices', { ...stored, dunningPaused: !stored.dunningPaused })}>{stored.dunningPaused ? t('i.resumeDunning') : t('i.pauseDunning')}</button>}>
              {tasks.length === 0 ? <p className="muted small">—</p> : <div className="list">{tasks.map((x) => <TaskRow key={x.id} task={x} showLink={false} />)}</div>}
              <div className="row" style={{ marginTop: 'var(--s3)' }}>
                {([1, 2, 3] as const).map((n) => <button key={n} className="btn small" onClick={() => setDialog({ reminder: n })}>{t(`s.dun${n}` as Key)}</button>)}
              </div>
            </Section>
          )}
        </div>
        <div>
          <Section title={t('i.client')}>
            <div className="stack">
              <Field label={t('q.name')}><input disabled={!draft} value={d.client.name} onChange={(e) => set({ client: { ...d.client, name: e.target.value } })} /></Field>
              <Field label={t('q.attention')}><input disabled={!draft} value={d.client.attention ?? ''} onChange={(e) => set({ client: { ...d.client, attention: e.target.value } })} /></Field>
              <Field label={t('q.address')}><textarea rows={3} disabled={!draft} value={d.client.address ?? ''} onChange={(e) => set({ client: { ...d.client, address: e.target.value } })} /></Field>
              <Field label={t('common.email')}><input disabled={!draft} value={d.client.email ?? ''} onChange={(e) => set({ client: { ...d.client, email: e.target.value } })} /></Field>
              <div className="grid2">
                <Field label={t('i.issueDate')}><input type="date" disabled={!draft} value={d.issueDate ?? ''} onChange={(e) => set({ issueDate: e.target.value || undefined })} /></Field>
                <Field label={t('i.supplyDate')}><input type="date" disabled={!draft} value={d.supplyDate ?? ''} onChange={(e) => set({ supplyDate: e.target.value || undefined })} /></Field>
                {d.kind !== 'credit_note' && <Field label={t('i.dueDate')}><input type="date" disabled={!draft} value={d.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || undefined })} /></Field>}
                <Field label={t('q.language')}><select disabled={!draft} value={d.language} onChange={(e) => set({ language: e.target.value as 'nl' | 'en' })}><option value="nl">NL</option><option value="en">EN</option></select></Field>
              </div>
              <Field label={t('i.reference')}><input disabled={!draft} value={d.reference ?? ''} onChange={(e) => set({ reference: e.target.value })} /></Field>
              <Field label={t('i.reason')}><input disabled={!draft} value={d.reason ?? ''} onChange={(e) => set({ reason: e.target.value })} /></Field>
              <Field label={t('i.notes')}><textarea disabled={!draft} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
          </Section>
          {(related.length > 0 || stored.quoteId) && (
            <Section title={t('i.related')}>
              <div className="list">
                {stored.quoteId && <Link className="list-item" to={`/invoicing/quotes/${stored.quoteId}`}>{t('pdf.quote')}</Link>}
                {related.map((i) => <Link key={i.id} className="list-item" to={`/invoicing/invoices/${i.id}`}><span className="grow">{t(`i.kind.${i.kind}`)} {i.number ?? ''}</span><span className="small">{euro(invoiceTotals(i).total, lang)}</span></Link>)}
              </div>
            </Section>
          )}
          <Section title={t('gig.history')}>
            <div className="small muted">{stored.finalisedAt && <div>{t('i.finalised', { number: stored.number ?? '' })} · {fmtDateTime(stored.finalisedAt, lang)}</div>}
              {stored.sentAt && <div>{t('i.markedSent')} · {fmtDateTime(stored.sentAt, lang)}</div>}</div>
          </Section>
          <div className="row">
            {!draft && d.kind !== 'credit_note' && st !== 'credited' && <button className="btn small" onClick={() => setDialog('credit')}>{t('i.creditNote')}</button>}
            {draft && <button className="btn small danger" onClick={async () => { if (confirm(t('common.confirmDelete'))) { await softDelete('invoices', stored.id); nav('/invoicing/invoices'); } }}>{t('common.delete')}</button>}
          </div>
        </div>
      </div>

      {dirty && (
        <div className="savebar">
          <span className="small muted">{t('common.unsaved')}</span>
          <div className="row"><button className="btn ghost" onClick={() => { setDirty(false); setD(stored); }}>{t('common.cancel')}</button>
            <button className="btn primary" onClick={async () => { setD(await save<Invoice>('invoices', d)); setDirty(false); toast(t('common.saved')); }}>{t('common.save')}</button></div>
        </div>
      )}

      {dialog === 'finalise' && me && <FinaliseDialog inv={stored} onClose={() => setDialog(null)} onDone={() => setDialog(d.kind === 'credit_note' ? null : 'send')} />}
      {dialog === 'send' && (
        <MessageComposer kind="invoice_send" gig={gig ?? undefined} person={person ?? undefined} language={l} onClose={() => setDialog(null)}
          onSent={() => markInvoiceSent(stored)} extraFields={msgFields} pdf={{ name: fileName, make: pdf }} />
      )}
      {typeof dialog === 'object' && dialog && 'reminder' in dialog && (
        <MessageComposer kind={`reminder_${dialog.reminder}`} gig={gig ?? undefined} person={person ?? undefined} language={l} onClose={() => setDialog(null)}
          extraFields={msgFields} pdf={{ name: fileName, make: pdf }} />
      )}
      {dialog === 'pay' && <PaymentDialog inv={stored} open={open} onClose={() => setDialog(null)} />}
      {dialog === 'credit' && <CreditDialog inv={stored} onClose={() => setDialog(null)} />}
    </div>
  );
}

function FinaliseDialog({ inv, onClose, onDone }: { inv: Invoice; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const [num, setNum] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => { if (me) previewNumber(inv, me.id).then(setNum); }, [inv, me]);
  async function go() {
    if (!me) return;
    const r = await finaliseInvoice(inv, me.id);
    if (!r.ok) { setProblems(r.problems); return; }
    toast(t('i.finalised', { number: r.invoice.number ?? '' }));
    onDone();
  }
  return (
    <Modal title={t('i.finalise')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={go}>{t('i.finalise')}</button></>}>
      <p>{t('i.finaliseWarn', { number: num })}</p>
      {problems.map((p) => <div key={p} className="banner danger"><span>✕</span><div className="txt">{t(`i.problem.${p}` as Key)}</div></div>)}
      {problems.some((p) => ['seller_address', 'kvk', 'vat_id'].includes(p)) && <Link className="btn small" to="/invoicing/settings">{t('inv.goSettings')}</Link>}
    </Modal>
  );
}

function PaymentDialog({ inv, open, onClose }: { inv: Invoice; open: number; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [amount, setAmount] = useState(inputFromCents(open));
  const [date, setDate] = useState(todayStr());
  const [method, setMethod] = useState<Payment['method']>('bank');
  const [note, setNote] = useState('');
  async function go() {
    const cents = centsFromInput(amount);
    if (!cents) return;
    await registerPayment(inv, { amount: cents, date, method, note: note || undefined });
    toast(t('i.paidToast'));
    onClose();
  }
  return (
    <Modal title={t('i.registerPayment')} onClose={onClose} footer={<button className="btn primary" onClick={go}>{t('common.save')}</button>}>
      <div className="grid2">
        <Field label={t('i.amount')}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('common.date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('i.method')}>
          <select value={method} onChange={(e) => setMethod(e.target.value as Payment['method'])}>
            {(['bank', 'tikkie', 'cash', 'ideal', 'other'] as const).map((m) => <option key={m} value={m}>{t(`i.method.${m}`)}</option>)}
          </select>
        </Field>
        <Field label={t('common.notes')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CreditDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [reason, setReason] = useState('');
  return (
    <Modal title={t('i.creditNote')} onClose={onClose} footer={<button className="btn primary" disabled={!reason.trim()} onClick={async () => { const c = await createCreditNote(inv, reason.trim()); nav(`/invoicing/invoices/${c.id}`); }}>{t('i.creditNote')}</button>}>
      <Field label={t('i.creditReason')}><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="small muted">{t('i.creditFull')}</p>
    </Modal>
  );
}
