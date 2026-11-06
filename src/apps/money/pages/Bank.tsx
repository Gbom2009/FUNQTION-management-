import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section, useToast } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { save, softDelete } from '../../../core/repo';
import type { BankAccount, BankLine, Payer } from '../../../core/types';
import { useInvoices, usePayments } from '../../invoicing/data';
import { ruleKey, suggestFor } from '../domain/match';
import {
  expenseFromLine, importStatement, matchLineToExpense, matchLineToInvoice, partnerFromLine, setLineStatus, useBankAccounts, useBankLines, useBankRules,
  useCategories, useExpenses,
} from '../data';
import { Amount } from '../components';

export default function Bank() {
  const { t } = useI18n();
  const accounts = useBankAccounts();
  const lines = useBankLines();
  const [tab, setTab] = useState<'inbox' | 'all' | 'accounts'>(accounts.length ? 'inbox' : 'accounts');
  const [importing, setImporting] = useState(false);
  const unmatched = lines.filter((l) => l.status === 'unmatched').sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div>
      <div className="page-head">
        <div><h1>{t('m.bank')}</h1><div className="sub">{t('m.unmatchedCount', { n: unmatched.length })}</div></div>
        <button className="btn primary" disabled={!accounts.length} onClick={() => setImporting(true)}>{t('m.import')}</button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>{t('m.inbox')} · {unmatched.length}</button>
        <button role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>{t('m.allLines')}</button>
        <button role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>{t('m.accounts')}</button>
      </div>
      {tab === 'inbox' && (unmatched.length === 0 ? <Empty>{accounts.length ? t('m.inboxEmpty') : t('m.addAccountFirst')}</Empty> : <Inbox lines={unmatched} accounts={accounts} />)}
      {tab === 'all' && <AllLines lines={lines} accounts={accounts} />}
      {tab === 'accounts' && <Accounts />}
      {importing && <ImportDialog accounts={accounts} onClose={() => setImporting(false)} />}
    </div>
  );
}

function ImportDialog({ accounts, onClose }: { accounts: BankAccount[]; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  async function onFile(f: File) {
    setBusy(true);
    try {
      const r = await importStatement(accountId, await f.text());
      toast(r.lines.length ? t('m.importDone', { format: r.format, inserted: r.inserted, duplicates: r.duplicates }) : t('m.importNothing'));
      if (r.lines.length) onClose();
    } catch { toast(t('m.importNothing')); } finally { setBusy(false); }
  }
  return (
    <Modal title={t('m.import')} onClose={onClose}>
      <Field label={t('m.account')}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </Field>
      <p className="small muted">{t('m.importHint')}</p>
      <button className="btn primary" disabled={busy || !accountId} onClick={() => fileRef.current?.click()}>{t('m.chooseFile')}</button>
      <input ref={fileRef} type="file" accept=".csv,.txt,.xml,.tab,text/csv,text/xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </Modal>
  );
}

function Inbox({ lines, accounts }: { lines: BankLine[]; accounts: BankAccount[] }) {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const toast = useToast();
  const invoices = useInvoices();
  const payments = usePayments();
  const expenses = useExpenses();
  const rules = useBankRules();
  const cats = useCategories().filter((c) => c.active && c.kind === 'expense');
  const [idx, setIdx] = useState(0);
  const [remember, setRemember] = useState(true);
  const [catId, setCatId] = useState('');
  const l = lines[Math.min(idx, lines.length - 1)];
  const acc = accounts.find((a) => a.id === l.accountId);
  const sugg = useMemo(() => suggestFor(l, { invoices, payments, expenses, rules }), [l, invoices, payments, expenses, rules]);
  const rk = ruleKey(l.counterparty || l.description);
  const ruleCat = sugg.find((s) => s.type === 'rule' && s.rule.action === 'expense');
  const effectiveCat = catId || (ruleCat && ruleCat.type === 'rule' ? ruleCat.rule.categoryId ?? '' : '');
  const done = () => { setCatId(''); toast(t('common.saved')); };
  const owner: Payer = acc?.owner ?? 'business';

  return (
    <div className="layout-2">
      <Section>
        <div className="stack">
          <div className="row between"><span className="tiny muted">{idx + 1} / {lines.length} · {acc?.name}</span>
            <div className="row" style={{ gap: 4 }}><button className="btn small" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>←</button><button className="btn small" disabled={idx >= lines.length - 1} onClick={() => setIdx(idx + 1)}>→</button></div></div>
          <div className="hero-card" style={{ borderColor: l.amount > 0 ? 'var(--ok)' : 'var(--fq-rule-color)' }}>
            <div className="row between"><span className="small">{fmtDate(l.date, lang)}</span><span style={{ fontSize: 22 }}><Amount cents={l.amount} signed strong /></span></div>
            <div className="big" style={{ fontSize: 20 }}>{l.counterparty || '—'}</div>
            <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{l.description}</div>
            {l.counterIban && <div className="tiny muted">{l.counterIban}</div>}
          </div>
          {sugg.filter((s) => s.type !== 'rule').slice(0, 3).map((s, i) => (
            <button key={i} className="card link row between" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={async () => {
              if (s.type === 'invoice') await matchLineToInvoice(l, s.invoice, acc);
              if (s.type === 'expense') await matchLineToExpense(l, s.expense);
              done();
            }}>
              <span>{s.type === 'invoice' ? `✓ ${t('m.payInvoice')} ${s.invoice.number} · ${s.invoice.client.name}` : s.type === 'expense' ? `✓ ${t('m.linkExpense')} ${s.expense.supplier} · ${fmtDate(s.expense.date, lang)}` : ''}</span>
              <Amount cents={s.type === 'invoice' ? s.open : s.type === 'expense' ? -s.expense.amount : 0} />
            </button>
          ))}
          {l.amount < 0 && (
            <div className="card stack">
              <div className="strong small">{t('m.newExpenseFromLine')}</div>
              <div className="chips">{cats.map((c) => <button key={c.id} className="chip" aria-pressed={effectiveCat === c.id} onClick={() => setCatId(c.id)}>{c.icon} {lang === 'en' ? c.nameEn : c.name}</button>)}</div>
              <button className="btn primary" disabled={!effectiveCat} onClick={async () => {
                const c = cats.find((x) => x.id === effectiveCat);
                await expenseFromLine(l, acc, effectiveCat, ruleCat && ruleCat.type === 'rule' ? ruleCat.rule.businessPct ?? c?.defaultBusinessPct : c?.defaultBusinessPct, remember ? rk : undefined);
                done();
              }}>{t('m.createExpense')}</button>
            </div>
          )}
          <div className="row">
            <button className="btn small" onClick={async () => { await setLineStatus(l, 'private', remember ? rk : undefined); done(); }}>{t('m.private')}</button>
            <button className="btn small" onClick={async () => { await setLineStatus(l, 'transfer', remember ? rk : undefined); done(); }}>{t('m.transfer')}</button>
            <button className="btn small" onClick={async () => { await setLineStatus(l, 'ignored'); done(); }}>{t('m.ignore')}</button>
            {owner !== 'business' ? null : (
              <>
                <button className="btn small" onClick={async () => { await partnerFromLine(l, acc, l.amount > 0 ? 'contribution' : 'withdrawal', 'gijs'); done(); }}>{l.amount > 0 ? t('m.contribution') : t('m.withdrawal')} Gijs</button>
                <button className="btn small" onClick={async () => { await partnerFromLine(l, acc, l.amount > 0 ? 'contribution' : 'withdrawal', 'coen'); done(); }}>{l.amount > 0 ? t('m.contribution') : t('m.withdrawal')} Coen</button>
              </>
            )}
          </div>
          <label className="check small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{t('m.remember', { key: rk })}</label>
        </div>
      </Section>
      <Section title={t('m.howItWorks')}>
        <p className="small muted">{t('m.inboxHelp', { business: settings.businessName })}</p>
      </Section>
    </div>
  );
}

function AllLines({ lines, accounts }: { lines: BankLine[]; accounts: BankAccount[] }) {
  const { t, lang } = useI18n();
  const [acc, setAcc] = useState(accounts[0]?.id ?? '');
  const rows = lines.filter((l) => !acc || l.accountId === acc).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);
  return (
    <div className="stack">
      <select className="input" style={{ maxWidth: 300 }} value={acc} onChange={(e) => setAcc(e.target.value)} aria-label={t('m.account')}>
        <option value="">{t('common.all')}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {rows.length === 0 ? <Empty>{t('common.empty')}</Empty> : (
        <div className="list">{rows.map((l) => (
          <div key={l.id} className="list-item">
            <span className="small" style={{ minWidth: 70 }}>{fmtDate(l.date, lang, { day: 'numeric', month: 'short' })}</span>
            <div className="grow" style={{ minWidth: 0 }}><div className="strong">{l.counterparty || '—'}</div><div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</div></div>
            <span className="pill" style={{ color: l.status === 'matched' ? 'var(--ok)' : l.status === 'unmatched' ? 'var(--fq-accent)' : 'var(--fq-text-dim)' }}>{t(`m.status.${l.status}`)}</span>
            <Amount cents={l.amount} signed />
            {l.status !== 'unmatched' && l.status !== 'matched' && <button className="btn icon small ghost" title={t('m.undo')} onClick={() => setLineStatus(l, 'unmatched')}>↺</button>}
          </div>
        ))}</div>
      )}
    </div>
  );
}

function Accounts() {
  const { t } = useI18n();
  const accounts = useBankAccounts();
  const [d, setD] = useState<Partial<BankAccount>>({ name: '', bank: 'Revolut', owner: 'business', active: true });
  return (
    <div className="dash">
      <Section title={t('m.accounts')}>
        {accounts.length === 0 ? <p className="muted small">{t('m.noAccounts')}</p> : (
          <div className="list">{accounts.map((a) => (
            <div key={a.id} className="list-item"><div className="grow"><div className="strong">{a.name}</div><div className="tiny muted">{a.bank} · {a.ibanMasked ?? ''} · {a.owner === 'business' ? t('m.payer.business') : a.owner === 'gijs' ? 'Gijs' : 'Coen'}</div></div>
              <button className="btn icon small" aria-label={t('common.delete')} onClick={() => { if (confirm(t('common.confirmDelete'))) softDelete('bankAccounts', a.id); }}>✕</button></div>
          ))}</div>
        )}
      </Section>
      <Section title={t('m.addAccount')}>
        <div className="stack">
          <Field label={t('common.name')}><input value={d.name} placeholder="Revolut Business" onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label={t('m.bankName')}>
            <select value={d.bank} onChange={(e) => setD({ ...d, bank: e.target.value })}>
              {['Revolut', 'ING', 'Rabobank', 'ABN AMRO', 'bunq', 'Knab', 'ASN/SNS/RegioBank', 'Triodos', 'Anders'].map((b) => <option key={b}>{b}</option>)}
            </select>
          </Field>
          <Field label={t('m.ibanLast4')}><input value={d.ibanMasked ?? ''} placeholder="NL…1234" onChange={(e) => setD({ ...d, ibanMasked: e.target.value })} /></Field>
          <Field label={t('m.accountOwner')}>
            <select value={d.owner} onChange={(e) => setD({ ...d, owner: e.target.value as Payer })}>
              <option value="business">{t('m.payer.business')}</option><option value="gijs">Gijs ({t('m.privateAccount')})</option><option value="coen">Coen ({t('m.privateAccount')})</option>
            </select>
          </Field>
          <button className="btn primary" disabled={!d.name} onClick={async () => { await save<BankAccount>('bankAccounts', d as BankAccount); setD({ name: '', bank: 'Revolut', owner: 'business', active: true }); }}>{t('common.add')}</button>
        </div>
      </Section>
    </div>
  );
}
