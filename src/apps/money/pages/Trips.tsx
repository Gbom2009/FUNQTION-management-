import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section } from '../../../core/ui';
import { euro, fmtDate } from '../../../core/format';
import { save, softDelete } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import { download } from '../../../core/backup';
import type { Gig, MemberId, Trip } from '../../../core/types';
import { byId, useGigs, useVenues } from '../../bookings/data';
import { tripCost, tripKm, tripSuggestions, within } from '../domain/ledger';
import { saveTripForGig, useTrips } from '../data';
import { PeriodBar, usePeriod } from '../components';

export default function Trips() {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const ctl = usePeriod('year');
  const trips = useTrips();
  const gigs = useGigs();
  const venues = byId(useVenues());
  const [forGig, setForGig] = useState<Gig | null>(null);
  const [manual, setManual] = useState(false);
  const todo = tripSuggestions(gigs, trips).sort((a, b) => b.date.localeCompare(a.date));
  const rows = trips.filter((x) => within(x.date, ctl.period)).sort((a, b) => b.date.localeCompare(a.date));
  const km = rows.reduce((s, x) => s + tripKm(x), 0);
  const cost = rows.reduce((s, x) => s + tripCost(x, settings.mileageRate), 0);

  function exportLog() {
    const head = ['datum', 'bestuurder', 'van', 'naar', 'doel', 'km_enkel', 'retour', 'km_totaal', 'vergoeding_eur', 'parkeren_eur'];
    const data = rows.slice().reverse().map((x) => [x.date, x.driver, x.from, x.to, x.purpose, x.km, x.roundTrip ? 'ja' : 'nee', tripKm(x),
      (Math.round(tripKm(x) * settings.mileageRate) / 100).toFixed(2), ((x.parking ?? 0) / 100).toFixed(2)]);
    const csv = [head, ...data].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    download(`rittenregistratie-${ctl.period.key}.csv`, '﻿' + csv, 'text/csv');
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>{t('m.trips')}</h1><div className="sub">{Math.round(km)} km · {euro(cost, lang)} ({euro(settings.mileageRate, lang)}/km)</div></div>
        <div className="row"><PeriodBar ctl={ctl} /><button className="btn" onClick={() => setManual(true)}>+ {t('m.addTrip')}</button><button className="btn small" onClick={exportLog}>{t('m.exportLog')}</button></div>
      </div>
      {todo.length > 0 && (
        <Section title={t('m.tripsFromGigs')}>
          <div className="list">{todo.slice(0, 10).map((g) => {
            const v = g.venueId ? venues.get(g.venueId) : undefined;
            return (
              <button key={g.id} className="list-item" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setForGig(g)}>
                <span className="small" style={{ minWidth: 80 }}>{fmtDate(g.date, lang, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                <span className="grow">{g.title} <span className="muted small">{v ? `→ ${[v.name, v.city].filter(Boolean).join(', ')}` : ''}</span></span>
                <span className="btn small">{t('m.confirmKm')}</span>
              </button>
            );
          })}</div>
        </Section>
      )}
      {rows.length === 0 ? <Empty>{t('m.noTrips')}</Empty> : (
        <div className="list">{rows.map((x) => (
          <div key={x.id} className="list-item">
            <span className="small" style={{ minWidth: 70 }}>{fmtDate(x.date, lang, { day: 'numeric', month: 'short' })}</span>
            <div className="grow" style={{ minWidth: 0 }}><div className="strong">{x.to}</div><div className="tiny muted">{x.driver === 'gijs' ? 'Gijs' : 'Coen'} · {x.from} · {x.purpose}</div></div>
            <span className="small mono-num">{tripKm(x)} km</span>
            <span className="small mono-num">{euro(tripCost(x, settings.mileageRate), lang)}</span>
            <button className="btn icon small ghost" aria-label={t('common.delete')} onClick={() => softDelete('trips', x.id)}>✕</button>
          </div>
        ))}</div>
      )}
      {forGig && <GigTripDialog gig={forGig} onClose={() => setForGig(null)} />}
      {manual && <ManualTrip onClose={() => setManual(false)} />}
    </div>
  );
}

function home(s: { homeGijs?: string; homeCoen?: string }, m: MemberId) {
  return (m === 'gijs' ? s.homeGijs : s.homeCoen) || 'Thuis';
}

export function GigTripDialog({ gig, onClose }: { gig: Gig; onClose: () => void }) {
  const { t } = useI18n();
  const { settings } = useSession();
  const venue = byId(useVenues()).get(gig.venueId ?? '');
  const [driver, setDriver] = useState<MemberId>(gig.performers[0] ?? gig.ownerId);
  const known = venue?.distanceKm?.[driver];
  const [km, setKm] = useState<string>(known ? String(known) : '');
  const [round, setRound] = useState(true);
  const [parking, setParking] = useState('');
  const kmN = Number(km.replace(',', '.')) || 0;
  return (
    <Modal title={`${t('m.trip')}: ${gig.title}`} onClose={onClose} footer={<button className="btn primary" disabled={!kmN} onClick={async () => {
      await saveTripForGig(gig, venue, driver, kmN, round, home(settings, driver), parking ? Math.round(Number(parking.replace(',', '.')) * 100) : undefined); onClose();
    }}>{t('common.save')}</button>}>
      <div className="field"><span>{t('m.driver')}</span><div className="chips">{(['gijs', 'coen'] as MemberId[]).map((m) => <button key={m} className="chip" aria-pressed={driver === m} onClick={() => { setDriver(m); const k = venue?.distanceKm?.[m]; if (k) setKm(String(k)); }}>{m === 'gijs' ? 'Gijs' : 'Coen'}</button>)}</div></div>
      <p className="small muted">{home(settings, driver)} → {venue ? [venue.name, venue.street, venue.city].filter(Boolean).join(', ') : '—'}</p>
      <div className="grid2">
        <Field label={t('m.kmOneWay')} hint={known ? t('m.kmKnown') : t('m.kmHint')}><input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} autoFocus /></Field>
        <Field label={t('m.parking')}><input inputMode="decimal" value={parking} onChange={(e) => setParking(e.target.value)} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} />{t('m.roundTrip')}</label>
    </Modal>
  );
}

function ManualTrip({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { settings, me } = useSession();
  const [d, setD] = useState<Partial<Trip>>({ date: todayStr(), driver: me?.id ?? 'gijs', from: home(settings, me?.id ?? 'gijs'), to: '', purpose: '', km: 0, roundTrip: true, source: 'manual' });
  return (
    <Modal title={t('m.addTrip')} onClose={onClose} footer={<button className="btn primary" disabled={!d.km || !d.to} onClick={async () => { await save<Trip>('trips', d as Trip); onClose(); }}>{t('common.save')}</button>}>
      <div className="grid2">
        <Field label={t('common.date')}><input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
        <Field label={t('m.driver')}><select value={d.driver} onChange={(e) => setD({ ...d, driver: e.target.value as MemberId })}><option value="gijs">Gijs</option><option value="coen">Coen</option></select></Field>
        <Field label={t('common.from')}><input value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} /></Field>
        <Field label={t('common.to')}><input value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} /></Field>
        <Field label={t('m.purpose')}><input value={d.purpose} placeholder={t('m.purposeHint')} onChange={(e) => setD({ ...d, purpose: e.target.value })} /></Field>
        <Field label={t('m.kmOneWay')}><input inputMode="decimal" value={d.km || ''} onChange={(e) => setD({ ...d, km: Number(e.target.value.replace(',', '.')) || 0 })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={!!d.roundTrip} onChange={(e) => setD({ ...d, roundTrip: e.target.checked })} />{t('m.roundTrip')}</label>
    </Modal>
  );
}
