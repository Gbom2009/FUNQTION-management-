import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section, StagePill, useToast } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { nowIso } from '../../../core/repo';
import type { GearItem, KitRole, MemberId, PackLine, PackList } from '../../../core/types';
import {
  addLine, allConflicts, finishLoading, finishReturn, getOrCreatePackList, regenerate, savePackList, scanInto, useGearItems, useGearLocations, type MissingAction,
} from '../data';
import { Scanner, StatusPill, feedback, useNightMode } from '../components';
import { loadByTransport, progress, trailerPayload, treeLines, type GearConflict } from '../domain/gear';

type Mode = 'edit' | 'out' | 'back';
const SETUPS = ['standard', 'dj_controller', 'dj_usb', 'dj_light'] as const satisfies readonly KitRole[];
export const LASER_CHECKS = ['aboveHeads', 'estop', 'noReflections', 'safetyCable', 'venueOk'] as const;

export default function PackPage() {
  const { gigId } = useParams();
  const [params, setParams] = useSearchParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const { me, members, settings, updateSettings } = useSession();
  const gig = useLiveQuery(() => db.gigs.get(gigId!), [gigId]);
  const venue = useLiveQuery(() => (gig?.venueId ? db.venues.get(gig.venueId) : undefined), [gig?.venueId]);
  const stored = useLiveQuery(() => db.packLists.where('gigId').equals(gigId!).first(), [gigId]);
  const items = useGearItems();
  const locs = useGearLocations();
  const [night, setNight] = useNightMode();
  const [conflicts, setConflicts] = useState<GearConflict[]>([]);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [trailer, setTrailer] = useState({ empty: false, hitchLock: false });
  useEffect(() => { if (gigId && stored === undefined) getOrCreatePackList(gigId); }, [gigId, stored]);
  useEffect(() => { allConflicts().then((c) => setConflicts(c.filter((x) => x.gigIds.includes(gigId!)))); }, [stored, gigId]);
  if (!gig || !stored || !me) return null;
  const list = stored;
  const mode: Mode = (params.get('mode') as Mode) || (list.status === 'out' ? 'back' : list.status === 'loading' ? 'out' : 'edit');
  const setMode = (m: Mode) => setParams(m === 'edit' ? {} : { mode: m });
  const byId = new Map(items.map((i) => [i.id, i]));
  const phase = mode === 'back' ? 'back' : 'out';
  const prog = progress(list.lines, phase);
  const load = loadByTransport(list.lines, items);
  const payload = trailerPayload(settings);
  const hasLaser = list.lines.some((l) => byId.get(l.itemId)?.category === 'lasers');
  const save = (p: Partial<PackList>) => savePackList({ ...list, ...p });
  const setLine = (id: string, p: Partial<PackLine>) => save({ lines: list.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });

  const scanKey = phase === 'out' ? 'gearLoadScan' : 'gearUnloadScan';
  const group = settings[scanKey] === 'group';
  async function onScan(code: string) {
    const r = await scanInto(list, code, phase, group);
    const name = r.item ? `${r.item.code} ${r.item.name}` : code;
    if (r.outcome.kind === 'ticked') { feedback(true); setLast({ ok: true, text: `✓ ${name}${r.outcome.lineIds.length > 1 ? ` (+${r.outcome.lineIds.length - 1})` : ''}` }); }
    else if (r.outcome.kind === 'already') { feedback(true); setLast({ ok: true, text: t('g.already', { name }) }); }
    else if (r.outcome.kind === 'not_on_list' && r.item && phase === 'out') {
      feedback(false);
      if (window.confirm(t('g.notOnListAdd', { name }))) { const l = await addLine(list, r.item.id, 1, t('g.addedAtLoading')); await scanInto(l, code, 'out', group); }
    } else if (r.outcome.kind === 'blocked') { feedback(false); setLast({ ok: false, text: t('g.blocked', { name, status: t(`g.status.${r.outcome.reason}`) }) }); }
    else { feedback(false); setLast({ ok: false, text: r.outcome.kind === 'unknown' ? t('g.unknownCode', { code }) : t('g.notOnList', { name }) }); }
  }

  // Tree per transport: a case with what's in it (indented), grouped by where the top case travels.
  const visible = list.lines.filter((l) => mode === 'edit' || phase === 'out' || l.out > 0);
  const tree = treeLines(visible, items);
  const groups: { key: string; title: string; rows: { line: PackLine; depth: number }[] }[] = [];
  for (const tr of ['car', 'trailer'] as const) {
    const rows: { line: PackLine; depth: number }[] = [];
    let rootTr: string | undefined;
    for (const r of tree) {
      if (r.depth === 0) rootTr = byId.get(r.line.itemId)?.transport ?? 'trailer';
      if (rootTr === tr) rows.push(r);
    }
    if (rows.length) groups.push({ key: tr, title: tr === 'car' ? t('g.inCar') : t('g.inTrailer'), rows });
  }
  const open = list.lines.filter((l) => (phase === 'out' ? !l.skip && l.out < l.qty : l.out > 0 && l.back < l.out));

  return (
    <div className={mode !== 'edit' ? 'pack-live' : ''}>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="legend"><Link to="/gear">← {t('app.gear')}</Link> · <Link to={`/bookings/gigs/${gig.id}`}>{t('g.gig')}</Link></div>
          <h1 style={{ overflowWrap: 'anywhere' }}>{gig.title}</h1>
          <div className="sub row"><span>{fmtDate(gig.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })} · {gig.setupTime ?? gig.startTime}–{gig.endTime}</span>{venue && <span>{venue.name}</span>}<StagePill stage={gig.stage} /><span className="pill">{t(`g.list.${list.status}`)}</span></div>
        </div>
        <div className="pack-counter" aria-live="polite"><span>{phase === 'out' ? prog.done : prog.done}</span>/{prog.lines}</div>
      </div>

      <div className="tabs" role="tablist">
        {(['edit', 'out', 'back'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} disabled={m === 'back' && list.status !== 'out' && list.status !== 'done'} onClick={() => setMode(m)}>{t(`g.mode.${m}`)}</button>)}
        <button aria-pressed={night} onClick={() => setNight(!night)} style={{ marginLeft: 'auto' }}>{t('g.night')}</button>
      </div>

      {conflicts.length > 0 && conflicts.map((c) => <div key={c.itemId} className="banner danger" style={{ marginBottom: 'var(--s2)' }}><span>!</span><div className="txt small">{t('g.conflict', { name: byId.get(c.itemId)?.name ?? '', need: c.need, have: c.have })}</div></div>)}

      {mode === 'edit' && (
        <Section title={t('g.setup')}>
          <div className="chips">{SETUPS.map((s) => <button key={s} className="chip" aria-pressed={list.setup === s} onClick={async () => { await regenerate(list, s); }}>{t(`g.setup.${s}`)}</button>)}</div>
          <p className="tiny muted">{venue?.houseSound ? t('g.houseSoundHint') : t('g.setupHint')}</p>
          <div className="grid2" style={{ marginTop: 'var(--s3)' }}>
            <Field label={t('g.gigPhone')} hint={t('g.gigPhoneHint')}><select value={list.phone ?? ''} onChange={(e) => save({ phone: (e.target.value || undefined) as MemberId | undefined })}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            <Field label={t('g.addItem')}><select value="" onChange={async (e) => { if (e.target.value) await addLine(list, e.target.value, 1); }}><option value="">+ …</option>
              {items.filter((i) => i.status !== 'disposed' && !list.lines.some((l) => l.itemId === i.id)).sort((a, b) => a.name.localeCompare(b.name)).map((i) => <option key={i.id} value={i.id}>{i.code} {i.name}</option>)}</select></Field>
          </div>
          <div className="row" style={{ marginTop: 'var(--s3)' }}>
            <button className="btn small ghost" onClick={() => regenerate(list)}>{t('g.regenerate')}</button>
            {list.status === 'draft' && <button className="btn small primary" onClick={() => save({ status: 'confirmed' })}>{t('g.confirmList')}</button>}
            <button className="btn small" onClick={() => window.print()}>{t('g.print')}</button>
          </div>
        </Section>
      )}

      {mode !== 'edit' && list.status !== 'done' && (
        <Section>
          <div className="chips" style={{ marginBottom: 'var(--s2)' }} role="group" aria-label={t('g.scanMode')}>
            <button className="chip" aria-pressed={group} onClick={() => updateSettings({ [scanKey]: 'group' } as Partial<typeof settings>)}>{t('g.scanMode.group')}</button>
            <button className="chip" aria-pressed={!group} onClick={() => updateSettings({ [scanKey]: 'each' } as Partial<typeof settings>)}>{t('g.scanMode.each')}</button>
          </div>
          <p className="tiny muted" style={{ marginBottom: 'var(--s2)' }}>{group ? t('g.scanMode.groupHint') : t('g.scanMode.eachHint')}</p>
          <Scanner compact onCode={onScan} />
          {last && <div className={`scan-last ${last.ok ? 'ok' : 'bad'}`} role="status">{last.text}</div>}
        </Section>
      )}

      {groups.map((g) => (
        <Section key={g.key} title={`${g.title} · ${g.rows.filter((r) => !r.line.skip).length}`}>
          <div className="pack-lines">
            {g.rows.map(({ line: l, depth }) => {
              const it = byId.get(l.itemId);
              if (!it) return null;
              const target = phase === 'out' ? l.qty : l.out;
              const done = !l.skip && (phase === 'out' ? l.out : l.back) >= target;
              const blocked = mode !== 'back' && ['out_of_service', 'in_repair', 'lent', 'missing', 'disposed'].includes(it.status);
              const canSkip = mode === 'edit' || (mode === 'out' && l.out === 0);
              return (
                <div key={l.id} className={`pack-line${done && mode !== 'edit' ? ' done' : ''}${blocked ? ' blocked' : ''}${l.skip ? ' skipped' : ''}`} style={{ paddingLeft: `calc(var(--s3) + ${depth * 22}px)` }}>
                  {depth > 0 && <span className="tree-mark" aria-hidden="true">└</span>}
                  {mode !== 'edit' && !l.skip ? (
                    <button className="pack-tick" aria-pressed={done} aria-label={it.name} onClick={() => setLine(l.id, phase === 'out' ? { out: done ? 0 : l.qty } : { back: done ? 0 : l.out, missing: undefined })}>{done ? '✓' : ''}</button>
                  ) : <span className="pack-tick static">{l.skip ? '–' : l.qty > 1 ? `${l.qty}×` : ''}</span>}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="pack-name">{it.name}</div>
                    <div className="tiny muted"><span className="mono">{it.code}</span> · {l.skip ? t('g.notTaken') : (l.reason || t(`g.src.${l.source}`))}{depth === 0 && it.homeLocationId ? ` · ${locs.find((x) => x.id === it.homeLocationId)?.name ?? ''}` : ''}</div>
                  </div>
                  {blocked && <StatusPill status={it.status} />}
                  {it.kind === 'counted' && mode === 'edit' && !l.skip && (
                    <span className="row"><button className="btn icon small" onClick={() => setLine(l.id, { qty: Math.max(1, l.qty - 1) })}>−</button><span className="mono">{l.qty}</span><button className="btn icon small" onClick={() => setLine(l.id, { qty: l.qty + 1 })}>+</button></span>
                  )}
                  {it.kind === 'counted' && mode !== 'edit' && !l.skip && <span className="mono small">{phase === 'out' ? l.out : l.back}/{target}</span>}
                  {canSkip && <button className="btn small ghost" aria-pressed={!!l.skip} onClick={() => setLine(l.id, { skip: !l.skip })}>{l.skip ? t('g.take') : t('g.dontTake')}</button>}
                  {mode === 'edit' && <button className="btn icon small ghost" aria-label={t('common.delete')} onClick={() => save({ lines: list.lines.filter((x) => x.id !== l.id) })}>✕</button>}
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      <div className="layout-2">
        <div>
          {hasLaser && <LaserCheck list={list} save={save} />}
        </div>
        <div>
          <Section title={t('g.load')}>
            <dl className="kv">
              <dt>{t('g.inTrailer')}</dt><dd className={load.trailerKg > payload ? 'danger-text' : ''}>{load.trailerKg} kg / {payload} kg</dd>
              <dt>{t('g.inCar')}</dt><dd>{load.carKg} kg</dd>
              {load.unknownWeight > 0 && <><dt>{t('g.noWeight')}</dt><dd>{load.unknownWeight}</dd></>}
            </dl>
            <p className="tiny muted">{settings.gearTrailerEmptyKg ? t('g.payloadHint', { max: settings.gearTrailerMaxKg, empty: settings.gearTrailerEmptyKg }) : t('g.payloadUnknown', { max: settings.gearTrailerMaxKg })}</p>
          </Section>
        </div>
      </div>

      {mode === 'out' && list.status !== 'out' && list.status !== 'done' && (
        <div className="savebar">
          <span className="small">{open.length ? t('g.stillOpen', { n: open.length }) : t('g.allLoaded')}</span>
          <button className="btn primary" onClick={async () => {
            if (open.length && !window.confirm(t('g.leaveWithout', { n: open.length }))) return;
            await finishLoading(list); toast(t('g.loadedToast')); setMode('back');
          }}>{t('g.doneLoading')}</button>
        </div>
      )}
      {mode === 'back' && list.status === 'out' && (
        <Section title={t('g.returnTitle')}>
          {open.length > 0 && (
            <div className="stack" style={{ gap: 'var(--s2)', marginBottom: 'var(--s4)' }}>
              {open.map((l) => {
                const it = byId.get(l.itemId) as GearItem;
                return (
                  <div key={l.id} className="missing-row">
                    <div className="strong danger-text">! {it?.code} {it?.name}{l.out > 1 ? ` (${l.back}/${l.out})` : ''}</div>
                    <div className="chips">{(['later', 'venue', 'lost', 'broken'] as MissingAction[]).map((a) => <button key={a} className="chip" aria-pressed={l.missing === a} onClick={() => setLine(l.id, { missing: a })}>{t(`g.missing.${a}`)}</button>)}</div>
                  </div>
                );
              })}
            </div>
          )}
          <label className="check"><input type="checkbox" checked={trailer.empty} onChange={(e) => setTrailer({ ...trailer, empty: e.target.checked })} />{t('g.trailerEmpty')}</label>
          <label className="check"><input type="checkbox" checked={trailer.hitchLock} onChange={(e) => setTrailer({ ...trailer, hitchLock: e.target.checked })} />{t('g.hitchLock')}</label>
          <div className="row" style={{ marginTop: 'var(--s3)' }}>
            <button className="btn primary" disabled={open.some((l) => !l.missing)} onClick={async () => { await finishReturn(list, me.id, trailer); toast(t('g.returnedToast')); }}>{t('g.doneReturn')}</button>
            {open.some((l) => !l.missing) && <span className="tiny muted">{t('g.chooseMissing')}</span>}
          </div>
        </Section>
      )}
      {list.status === 'done' && <div className="banner ok"><span>✓</span><div className="txt">{t('g.allBack', { date: list.returnedAt ? fmtDate(list.returnedAt.slice(0, 10), lang) : '' })}</div></div>}
    </div>
  );
}

function LaserCheck({ list, save }: { list: PackList; save: (p: Partial<PackList>) => Promise<PackList> }) {
  const { t } = useI18n();
  const laser = list.laser ?? { checks: {}, crowdScan: false };
  const set = (p: Partial<NonNullable<PackList['laser']>>) => save({ laser: { ...laser, ...p, at: nowIso() } });
  return (
    <Section title={t('g.laserTitle')}>
      <p className="tiny muted">{t('g.laserIntro')}</p>
      {LASER_CHECKS.map((k) => (
        <label key={k} className="check"><input type="checkbox" checked={!!laser.checks[k]} onChange={(e) => set({ checks: { ...laser.checks, [k]: e.target.checked } })} />{t(`g.laser.${k}`)}</label>
      ))}
      <label className="check"><input type="checkbox" checked={laser.crowdScan} onChange={(e) => set({ crowdScan: e.target.checked })} />{t('g.laser.crowdScan')}</label>
      {laser.crowdScan && (
        <>
          <div className="banner danger"><span>!</span><div className="txt small">{t('g.laser.crowdWarn')}</div></div>
          <Field label={t('g.laser.permissionBy')}><input defaultValue={laser.permissionBy ?? ''} onBlur={(e) => set({ permissionBy: e.target.value })} placeholder={t('g.laser.permissionPlaceholder')} /></Field>
        </>
      )}
    </Section>
  );
}
