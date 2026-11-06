import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section, MemberChips } from '../../../core/ui';
import { centsFromInput, euro, fmtDate } from '../../../core/format';
import { save, softDelete } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import type { Asset, HourEntry, MemberId, PartnerEntry } from '../../../core/types';
import { bookValue, depreciationBetween, gigProfit, hoursFor, MEMBERS, partnerBalances, periodOf } from '../domain/ledger';
import { useAssets, useHours, useLedger, usePartnerEntries } from '../data';
import { Amount } from '../components';

const LINKS: { to: string; key: Key; icon: string }[] = [
  { to: '/money/gigs', key: 'm.perGig', icon: '🎧' },
  { to: '/money/partners', key: 'm.partners', icon: '🤝' },
  { to: '/money/reports', key: 'm.reports', icon: '📊' },
  { to: '/money/assets', key: 'm.assets', icon: '🎛' },
  { to: '/money/hours', key: 'm.hours', icon: '⏱' },
  { to: '/money/settings', key: 'nav.settings', icon: '⚙' },
];

export function MoreMenu() {
  const { t } = useI18n();
  return (
    <div>
      <div className="page-head"><h1>{t('nav.more')}</h1></div>
      <div className="list">{LINKS.map((l) => <Link key={l.to} to={l.to} className="list-item"><span>{l.icon}</span><span className="grow strong">{t(l.key)}</span>→</Link>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function GigProfits() {
  const { t, lang } = useI18n();
  const d = useLedger();
  const [year, setYear] = useState(todayStr().slice(0, 4));
  if (!d) return null;
  const gigs = d.gigs.filter((g) => !g.deletedAt && g.date.startsWith(year) && ['confirmed', 'played', 'invoiced', 'paid', 'cancelled'].includes(g.stage));
  const rows = gigs.map((g) => ({ g, p: gigProfit(d, g) })).filter((r) => r.p.revenueEx || r.p.directCosts || r.p.travel).sort((a, b) => b.p.margin - a.p.margin);
  const years = Array.from(new Set(d.gigs.map((g) => g.date.slice(0, 4)).filter(Boolean))).sort().reverse();
  const byType = new Map<string, { margin: number; hours: number; n: number }>();
  for (const r of rows) { const x = byType.get(r.g.eventType) ?? { margin: 0, hours: 0, n: 0 }; x.margin += r.p.margin; x.hours += r.p.hours; x.n++; byType.set(r.g.eventType, x); }
  return (
    <div>
      <div className="page-head"><h1>{t('m.perGig')}</h1>
        <select className="input" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(e.target.value)} aria-label={t('pipe.filterYear')}>{(years.length ? years : [year]).map((y) => <option key={y}>{y}</option>)}</select></div>
      {rows.length === 0 ? <Empty>{t('m.noGigProfit')}</Empty> : (
        <>
          <div className="table-wrap" style={{ marginBottom: 'var(--s4)' }}>
            <table className="tbl">
              <thead><tr><th>{t('common.date')}</th><th>Gig</th><th>{t('gig.performers')}</th><th style={{ textAlign: 'right' }}>{t('m.revenue')}</th><th style={{ textAlign: 'right' }}>{t('m.directCosts')}</th><th style={{ textAlign: 'right' }}>{t('m.travel')}</th><th style={{ textAlign: 'right' }}>{t('m.margin')}</th><th style={{ textAlign: 'right' }}>{t('m.perHour')}</th></tr></thead>
              <tbody>{rows.map(({ g, p }) => (
                <tr key={g.id}>
                  <td>{fmtDate(g.date, lang, { day: 'numeric', month: 'short' })}</td><td><Link to={`/bookings/gigs/${g.id}`}>{g.title}</Link><div className="tiny muted">{t(`event.${g.eventType}`)}</div></td>
                  <td><MemberChips ids={g.performers} /></td>
                  <td style={{ textAlign: 'right' }}><Amount cents={p.revenueEx} /></td><td style={{ textAlign: 'right' }}><Amount cents={-p.directCosts} /></td>
                  <td style={{ textAlign: 'right' }}><Amount cents={-p.travel} /><div className="tiny muted">{Math.round(p.km)} km</div></td>
                  <td style={{ textAlign: 'right' }}><Amount cents={p.margin} strong /></td><td style={{ textAlign: 'right' }}>{euro(p.perHour, lang)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Section title={t('m.byEventType')}>
            <dl className="kv">{[...byType.entries()].map(([k, v]) => <span key={k} style={{ display: 'contents' }}><dt>{t(`event.${k}` as Key)} ({v.n}×)</dt><dd>{euro(v.margin, lang)} · {euro(v.hours ? Math.round(v.margin / v.hours) : 0, lang)}/{t('unit.hour')}</dd></span>)}</dl>
          </Section>
        </>
      )}
    </div>
  );
}

/** Compact card for the App 1 gig page. */
export function GigProfitCard({ gigId }: { gigId: string }) {
  const { t, lang } = useI18n();
  const d = useLedger();
  const g = d?.gigs.find((x) => x.id === gigId);
  if (!d || !g) return null;
  const p = gigProfit(d, g);
  return (
    <Section title={t('m.gigResult')} actions={<Link className="btn small ghost" to="/money/gigs">{t('app.accounting')} →</Link>}>
      <dl className="kv">
        <dt>{t('m.revenue')}</dt><dd><Amount cents={p.revenueEx} /></dd>
        <dt>{t('m.directCosts')}</dt><dd><Amount cents={-p.directCosts} /></dd>
        <dt>{t('m.travel')} ({Math.round(p.km)} km)</dt><dd><Amount cents={-p.travel} /></dd>
        <dt className="strong">{t('m.margin')}</dt><dd><Amount cents={p.margin} strong /> <span className="tiny muted">· {euro(p.perHour, lang)}/{t('unit.hour')}</span></dd>
      </dl>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function Partners() {
  const { t, lang } = useI18n();
  const { memberName } = useSession();
  const d = useLedger();
  const entries = usePartnerEntries();
  const [dialog, setDialog] = useState<null | Partial<PartnerEntry>>(null);
  if (!d) return null;
  const today = todayStr();
  const b = partnerBalances(d, today);
  return (
    <div>
      <div className="page-head"><h1>{t('m.partners')}</h1>
        <div className="row">
          <button className="btn" onClick={() => setDialog({ kind: 'withdrawal', memberId: 'gijs', date: today })}>+ {t('m.entry')}</button>
          {b.settle && <button className="btn primary" onClick={() => setDialog({ kind: 'settlement', memberId: b.settle!.from, toMemberId: b.settle!.to, amount: b.settle!.amount, date: today })}>{t('m.settleNow')}</button>}
          {b.payout && <button className="btn primary" onClick={async () => {
            if (!confirm(t('m.payoutConfirm'))) return;
            for (const m of MEMBERS) if (b.payout![m] > 0) await save<PartnerEntry>('partnerEntries', { memberId: m, date: today, kind: 'withdrawal', amount: b.payout![m], note: t('m.payout') });
          }}>{t('m.payout')}</button>}
        </div>
      </div>
      <div className="banner info" style={{ marginBottom: 'var(--s4)' }}><span>⇄</span><div className="txt strong">{b.payout ? t('m.payoutLine', { gijs: euro(b.payout.gijs, lang), coen: euro(b.payout.coen, lang) }) : b.settle ? t('m.settleLine', { from: memberName(b.settle.from), to: memberName(b.settle.to), amount: euro(b.settle.amount, lang) }) : t('m.settled')}</div></div>
      <div className="grid2" style={{ marginBottom: 'var(--s4)' }}>
        {MEMBERS.map((m) => {
          const p = b.partners[m];
          return (
            <Section key={m} title={memberName(m)}>
              <dl className="kv">
                <dt>{t('m.entitlement')}</dt><dd><Amount cents={p.entitlement} /></dd>
                <dt>{t('m.paidForBusiness')}</dt><dd><Amount cents={p.paid} /></dd>
                <dt>{t('m.receivedPrivately')}</dt><dd><Amount cents={-p.received} /></dd>
                <dt className="strong">{t('m.stillToReceive')}</dt><dd><Amount cents={p.balance} strong /></dd>
              </dl>
            </Section>
          );
        })}
      </div>
      <p className="small muted">{t('m.partnerHelp', { business: euro(b.businessCash, lang) })}</p>
      <Section title={t('m.entries')}>
        {entries.length === 0 ? <p className="muted small">—</p> : (
          <div className="list">{entries.sort((a, c) => c.date.localeCompare(a.date)).map((e) => (
            <div key={e.id} className="list-item"><span className="small" style={{ minWidth: 80 }}>{fmtDate(e.date, lang)}</span>
              <span className="grow">{t(`m.kind.${e.kind}`)} · {memberName(e.memberId)}{e.toMemberId ? ` → ${memberName(e.toMemberId)}` : ''} {e.note ? <span className="muted small">· {e.note}</span> : null}</span>
              <Amount cents={e.amount} /><button className="btn icon small ghost" aria-label={t('common.delete')} onClick={() => softDelete('partnerEntries', e.id)}>✕</button></div>
          ))}</div>
        )}
      </Section>
      {dialog && <PartnerEntryDialog initial={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function PartnerEntryDialog({ initial, onClose }: { initial: Partial<PartnerEntry>; onClose: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState(initial);
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount / 100).replace('.', ',') : '');
  return (
    <Modal title={t('m.entry')} onClose={onClose} footer={<button className="btn primary" disabled={!centsFromInput(amount)} onClick={async () => {
      await save<PartnerEntry>('partnerEntries', { ...(d as PartnerEntry), amount: centsFromInput(amount)!, toMemberId: d.kind === 'settlement' ? (d.memberId === 'gijs' ? 'coen' : 'gijs') : undefined }); onClose();
    }}>{t('common.save')}</button>}>
      <div className="chips">{(['withdrawal', 'contribution', 'settlement'] as const).map((k) => <button key={k} className="chip" aria-pressed={d.kind === k} onClick={() => setD({ ...d, kind: k })}>{t(`m.kind.${k}`)}</button>)}</div>
      <p className="small muted">{t(`m.kindHelp.${d.kind ?? 'withdrawal'}` as Key)}</p>
      <div className="grid2">
        <Field label={d.kind === 'settlement' ? t('m.payerPerson') : t('m.person')}><select value={d.memberId} onChange={(e) => setD({ ...d, memberId: e.target.value as MemberId })}><option value="gijs">Gijs</option><option value="coen">Coen</option></select></Field>
        <Field label={t('i.amount')}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('common.date')}><input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
        <Field label={t('common.notes')}><input value={d.note ?? ''} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function Assets() {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const assets = useAssets();
  const [edit, setEdit] = useState<Partial<Asset> | null>(null);
  const today = todayStr();
  const year = periodOf('year', today);
  const kiaTotal = assets.filter((a) => a.purchaseDate.startsWith(year.key)).reduce((s, a) => s + a.cost, 0);
  return (
    <div>
      <div className="page-head"><div><h1>{t('m.assets')}</h1><div className="sub">{t('m.assetSub', { min: euro(settings.assetMinCents, lang) })}</div></div>
        <button className="btn primary" onClick={() => setEdit({ purchaseDate: today, cost: 0, residual: 0, lifeYears: 5, businessPct: 100, paidBy: 'business', name: '' })}>+ {t('m.addAsset')}</button></div>
      {assets.length === 0 ? <Empty>{t('m.noAssets')}</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{t('common.name')}</th><th>{t('m.purchased')}</th><th style={{ textAlign: 'right' }}>{t('m.cost')}</th><th style={{ textAlign: 'right' }}>{t('m.deprThisYear')}</th><th style={{ textAlign: 'right' }}>{t('m.bookValue')}</th><th /></tr></thead>
            <tbody>{assets.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)).map((a) => (
              <tr key={a.id} className="link" onClick={() => setEdit(a)}>
                <td>{a.name}{a.disposedAt && <span className="pill" style={{ marginLeft: 6 }}>{t('m.disposed')}</span>}</td><td>{fmtDate(a.purchaseDate, lang)}</td>
                <td style={{ textAlign: 'right' }}><Amount cents={a.cost} /></td><td style={{ textAlign: 'right' }}><Amount cents={depreciationBetween(a, year.from, year.to)} /></td>
                <td style={{ textAlign: 'right' }}><Amount cents={bookValue(a, today)} strong /></td><td>›</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 'var(--s3)' }}>{t('m.kiaNote', { amount: euro(kiaTotal, lang), year: year.key })}</p>
      {edit && <AssetDialog initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AssetDialog({ initial, onClose }: { initial: Partial<Asset>; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [d, setD] = useState(initial);
  const [cost, setCost] = useState(initial.cost ? String(initial.cost / 100).replace('.', ',') : '');
  const [res, setRes] = useState(initial.residual ? String(initial.residual / 100).replace('.', ',') : '');
  const a = { ...d, cost: centsFromInput(cost) ?? 0, residual: centsFromInput(res) ?? 0 } as Asset;
  const y0 = Number((d.purchaseDate ?? todayStr()).slice(0, 4));
  return (
    <Modal title={d.id ? d.name ?? '' : t('m.addAsset')} onClose={onClose} footer={<>
      {d.id && <button className="btn danger" onClick={async () => { await softDelete('assets', d.id!); onClose(); }}>{t('common.delete')}</button>}
      <button className="btn primary" disabled={!d.name || !a.cost} onClick={async () => { await save<Asset>('assets', a); onClose(); }}>{t('common.save')}</button></>}>
      <div className="grid2">
        <Field label={t('common.name')}><input value={d.name ?? ''} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label={t('m.purchased')}><input type="date" value={d.purchaseDate} onChange={(e) => setD({ ...d, purchaseDate: e.target.value })} /></Field>
        <Field label={t('m.costEx')}><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label={t('m.residual')}><input inputMode="decimal" value={res} onChange={(e) => setRes(e.target.value)} /></Field>
        <Field label={t('m.lifeYears')}><input inputMode="numeric" value={d.lifeYears ?? 5} onChange={(e) => setD({ ...d, lifeYears: Number(e.target.value) || 5 })} /></Field>
        <Field label={t('m.businessPct')}><input inputMode="numeric" value={d.businessPct ?? 100} onChange={(e) => setD({ ...d, businessPct: Number(e.target.value) || 0 })} /></Field>
        <Field label={t('m.paidBy')}><select value={d.paidBy} onChange={(e) => setD({ ...d, paidBy: e.target.value as Asset['paidBy'] })}><option value="business">{t('m.payer.business')}</option><option value="gijs">Gijs</option><option value="coen">Coen</option></select></Field>
        <Field label={t('m.serial')}><input value={d.serial ?? ''} onChange={(e) => setD({ ...d, serial: e.target.value })} /></Field>
        <Field label={t('m.disposedAt')}><input type="date" value={d.disposedAt ?? ''} onChange={(e) => setD({ ...d, disposedAt: e.target.value || undefined })} /></Field>
      </div>
      {a.cost > 0 && (
        <table className="tbl"><thead><tr><th>{t('pipe.filterYear')}</th><th style={{ textAlign: 'right' }}>{t('m.depreciation')}</th><th style={{ textAlign: 'right' }}>{t('m.bookValue')}</th></tr></thead>
          <tbody>{Array.from({ length: (d.lifeYears ?? 5) + 1 }, (_, i) => y0 + i).map((y) => {
            const dep = depreciationBetween(a, `${y}-01-01`, `${y}-12-31`);
            return dep ? <tr key={y}><td>{y}</td><td style={{ textAlign: 'right' }}>{euro(dep, lang)}</td><td style={{ textAlign: 'right' }}>{euro(bookValue(a, `${y}-12-31`), lang)}</td></tr> : null;
          })}</tbody></table>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

const KINDS = ['prep', 'promo', 'admin', 'travel', 'training', 'gig', 'other'] as const;

export function Hours() {
  const { t, lang } = useI18n();
  const { me, memberName } = useSession();
  const d = useLedger();
  const entries = useHours();
  const [kind, setKind] = useState<HourEntry['kind']>('prep');
  const [hrs, setHrs] = useState('1');
  const [date, setDate] = useState(todayStr());
  const year = todayStr().slice(0, 4);
  if (!d) return null;
  return (
    <div>
      <div className="page-head"><h1>{t('m.hours')}</h1></div>
      <p className="small muted" style={{ marginBottom: 'var(--s4)' }}>{t('m.hoursHelp')}</p>
      <div className="grid2" style={{ marginBottom: 'var(--s4)' }}>
        {MEMBERS.map((m: MemberId) => {
          const h = hoursFor(m, year, entries, d.gigs);
          const pct = Math.min(100, Math.round((h.total / 1225) * 100));
          return (
            <Section key={m} title={`${memberName(m)} · ${year}`}>
              <div className="v strong" style={{ fontSize: 24 }}>{h.total} / 1.225 {t('unit.hour')}</div>
              <div style={{ height: 8, border: 'var(--fq-rule)', margin: 'var(--s2) 0' }} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--fq-accent)' }} /></div>
              <div className="tiny muted">{Object.entries(h.byKind).map(([k, v]) => `${t(`m.hk.${k}` as Key)} ${Math.round(v * 10) / 10}`).join(' · ')}</div>
            </Section>
          );
        })}
      </div>
      <Section title={t('m.logHours')}>
        <div className="stack">
          <div className="chips">{KINDS.map((k) => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`m.hk.${k}`)}</button>)}</div>
          <div className="row">
            <input className="input" type="date" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('common.date')} />
            {['0.5', '1', '2', '4'].map((h) => <button key={h} className="chip" aria-pressed={hrs === h} onClick={() => setHrs(h)}>{h.replace('.', ',')} {t('unit.hour')}</button>)}
            <button className="btn primary" onClick={() => me && save<HourEntry>('hours', { memberId: me.id, date, hours: Number(hrs), kind })}>{t('common.add')}</button>
          </div>
        </div>
      </Section>
      <Section title={t('m.entries')}>
        <div className="list">{entries.filter((h) => h.date.startsWith(year)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map((h) => (
          <div key={h.id} className="list-item"><span className="small" style={{ minWidth: 80 }}>{fmtDate(h.date, lang)}</span><span className="grow">{memberName(h.memberId)} · {t(`m.hk.${h.kind}`)}</span><span>{h.hours} {t('unit.hour')}</span>
            <button className="btn icon small ghost" aria-label={t('common.delete')} onClick={() => softDelete('hours', h.id)}>✕</button></div>
        ))}</div>
      </Section>
    </div>
  );
}

export { Amount };
