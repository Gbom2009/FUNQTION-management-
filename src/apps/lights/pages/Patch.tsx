import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Empty, Field, Modal, Section } from '../../../core/ui';
import { save, softDelete } from '../../../core/repo';
import type { LightFixture } from '../../../core/types';
import { useGearItems } from '../../gear/data';
import { useFixtures } from '../data';
import { DEFAULT_DIP, dipFor, dipPattern, endAddress, maxAddress, nextFreeAddress, overlaps, type DipConfig } from '../domain/dmx';
import { esc } from '../../presskit/domain/epk';

/** The rig: DMX addresses per fixture, Gijs's DIP calculator built in. */
export default function Patch() {
  const { t } = useI18n();
  const fixtures = useFixtures().sort((a, b) => a.universe - b.universe || a.address - b.address);
  const [edit, setEdit] = useState<Partial<LightFixture> | null>(null);
  const clash = overlaps(fixtures);
  return (
    <div>
      <div className="page-head row between">
        <h1>{t('lt.nav.patch')}</h1>
        <div className="row">
          <button className="btn small ghost" disabled={!fixtures.length} onClick={() => printSheet(fixtures, t('lt.nav.patch'))}>{t('lt.print')}</button>
          <button className="btn small" onClick={() => setEdit({ controller: 'soundswitch', universe: 1, channels: 8, address: nextFreeAddress(fixtures, 1, 8) ?? 1, dip: DEFAULT_DIP })}>+ {t('lt.newFixture')}</button>
        </div>
      </div>
      <p className="small muted">{t('lt.patchHelp')}</p>
      {clash.map(([a, b]) => <div key={a.id + b.id} className="banner danger"><span className="txt">{t('lt.overlap', { a: a.name, b: b.name })}</span></div>)}
      <Section>
        {fixtures.length ? (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>{t('lt.fixture')}</th><th>{t('lt.controller')}</th><th>U</th><th>{t('lt.address')}</th><th>{t('lt.channels')}</th><th>DIP</th></tr></thead>
            <tbody>
              {fixtures.map((f) => {
                const d = dipFor(f.address, f.dip ?? DEFAULT_DIP);
                return (
                  <tr key={f.id} onClick={() => setEdit(f)} style={{ cursor: 'pointer' }}>
                    <td>{f.name}{f.isLaser ? ' ⚠' : ''}</td><td>{f.controller === 'soundswitch' ? 'SoundSwitch' : 'Daslight'}</td><td>{f.universe}</td>
                    <td className="mono-num">{f.address}–{endAddress(f)}</td><td>{f.channels}{f.mode ? ` (${f.mode})` : ''}</td>
                    <td className="mono">{d.ok ? dipPattern(d.bits) : <span className="danger-text">{t('lt.dipTooHigh', { max: d.max })}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <Empty>{t('lt.noFixtures')}</Empty>}
      </Section>
      {edit && <FixtureModal f={edit} all={fixtures} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Switches({ address, dip }: { address: number; dip: DipConfig }) {
  const { t } = useI18n();
  const r = dipFor(address, dip);
  if (!r.ok) return <div className="banner danger"><span className="txt">{r.reason === 'too_high' ? t('lt.dipTooHigh', { max: r.max }) : t('lt.dipRange')}</span></div>;
  return (
    <div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {r.bits.map((on, i) => (
          <div key={i} className="stack" style={{ gap: 2, alignItems: 'center', opacity: i < dip.addressBits ? 1 : 0.35 }}>
            <div style={{ width: 26, height: 46, border: 'var(--fq-rule)', position: 'relative', background: 'var(--fq-surface-inset)' }}>
              <div style={{ position: 'absolute', left: 2, right: 2, height: 20, top: on ? 2 : 22, background: on ? 'var(--fq-accent)' : 'var(--fq-machine-grey)' }} />
            </div>
            <span className="tiny">{i + 1}</span>
          </div>
        ))}
      </div>
      <div className="tiny muted">{t('lt.dipHelp', { pattern: dipPattern(r.bits) })}</div>
    </div>
  );
}

function FixtureModal({ f, all, onClose }: { f: Partial<LightFixture>; all: LightFixture[]; onClose: () => void }) {
  const { t } = useI18n();
  const gear = useGearItems().filter((g) => ['lighting', 'lasers', 'effects', 'dmx'].includes(g.category));
  const [v, setV] = useState<Partial<LightFixture>>(f);
  const dip = v.dip ?? DEFAULT_DIP;
  const others = all.filter((x) => x.id !== v.id);
  const free = nextFreeAddress(others, v.universe ?? 1, v.channels ?? 1);
  const clash = overlaps([...others, { id: 'this', name: v.name ?? '', universe: v.universe ?? 1, address: v.address ?? 1, channels: v.channels ?? 1 }]).filter(([a, b]) => a.id === 'this' || b.id === 'this');
  return (
    <Modal title={v.name || t('lt.newFixture')} onClose={onClose} footer={<>
      {v.id && <button className="btn ghost danger-text" onClick={async () => { await softDelete('lightFixtures', v.id!); onClose(); }}>{t('pr.delete')}</button>}
      <button className="btn primary" disabled={!v.name?.trim() || !v.address || !v.channels} onClick={async () => { await save<LightFixture>('lightFixtures', { ...(v as LightFixture), name: v.name!.trim() }); onClose(); }}>{t('pr.save')}</button>
    </>}>
      <div className="stack">
        <div className="grid2">
          <Field label={t('lt.fixture')}><input value={v.name ?? ''} placeholder={t('lt.fixturePh')} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label={t('lt.gearItem')}>
            <select value={v.gearItemId ?? ''} onChange={(e) => { const g = gear.find((x) => x.id === e.target.value); setV({ ...v, gearItemId: e.target.value || undefined, name: v.name || g?.name, isLaser: g?.category === 'lasers' || v.isLaser, controller: g?.category === 'lasers' ? 'daslight' : v.controller }); }}>
              <option value="">—</option>
              {gear.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid4">
          <Field label={t('lt.controller')}><select value={v.controller} onChange={(e) => setV({ ...v, controller: e.target.value as LightFixture['controller'] })}><option value="soundswitch">SoundSwitch</option><option value="daslight">Daslight</option></select></Field>
          <Field label={t('lt.universe')}><select value={v.universe} onChange={(e) => setV({ ...v, universe: Number(e.target.value) })}><option value={1}>1</option><option value={2}>2</option></select></Field>
          <Field label={t('lt.channels')}><input inputMode="numeric" value={v.channels ?? ''} onChange={(e) => setV({ ...v, channels: Math.max(1, Math.min(512, Number(e.target.value) || 1)) })} /></Field>
          <Field label={t('lt.mode')}><input value={v.mode ?? ''} placeholder="14ch" onChange={(e) => setV({ ...v, mode: e.target.value })} /></Field>
        </div>
        <Field label={t('lt.address')} hint={free ? t('lt.nextFree', { n: free }) : t('lt.universeFull')}>
          <div className="row">
            <input inputMode="numeric" value={v.address ?? ''} onChange={(e) => setV({ ...v, address: Number(e.target.value) || 0 })} style={{ maxWidth: 120 }} />
            {free && free !== v.address && <button type="button" className="btn small ghost" onClick={() => setV({ ...v, address: free })}>{t('lt.useFree', { n: free })}</button>}
          </div>
        </Field>
        {clash.length > 0 && <div className="banner danger"><span className="txt">{t('lt.overlapThis', { names: clash.map(([a, b]) => (a.id === 'this' ? b.name : a.name)).join(', ') })}</span></div>}
        <div className="grid3">
          <Field label={t('lt.dipSwitches')}><input inputMode="numeric" value={dip.switches} onChange={(e) => setV({ ...v, dip: { ...dip, switches: Math.max(1, Math.min(12, Number(e.target.value) || 10)) } })} /></Field>
          <Field label={t('lt.dipBits')}><select value={dip.addressBits} onChange={(e) => setV({ ...v, dip: { ...dip, addressBits: Number(e.target.value) } })}><option value={8}>8 (1–255)</option><option value={9}>9 (1–511)</option></select></Field>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={dip.plusOne} onChange={(e) => setV({ ...v, dip: { ...dip, plusOne: e.target.checked } })} /> {t('lt.plusOne')}</label>
        </div>
        <div className="tiny muted">{t('lt.maxAddr', { max: maxAddress(dip) })}</div>
        <Switches address={v.address ?? 0} dip={dip} />
        <label className="check"><input type="checkbox" checked={!!v.isLaser} onChange={(e) => setV({ ...v, isLaser: e.target.checked })} /> {t('lt.isLaser')}</label>
        <Field label={t('pr.note')}><input value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function printSheet(fixtures: LightFixture[], title: string) {
  const rows = fixtures.map((f) => {
    const d = dipFor(f.address, f.dip ?? DEFAULT_DIP);
    return `<tr><td>${esc(f.name)}</td><td>${f.controller === 'soundswitch' ? 'SoundSwitch' : 'Daslight'}</td><td>${f.universe}</td><td>${f.address}–${endAddress(f)}</td><td>${f.channels}${f.mode ? ` (${esc(f.mode)})` : ''}</td><td style="font-family:monospace">${d.ok ? dipPattern(d.bits) : '—'}</td></tr>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:12px/1.4 ui-monospace,monospace;margin:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;text-align:left}th{background:#eee}</style><h1>Team Funqtion · ${esc(title)}</h1><p>DIP: 1 = ON, switch 1 eerst.</p><table><tr><th>Apparaat</th><th>Programma</th><th>Universe</th><th>Adres</th><th>Kanalen</th><th>DIP</th></tr>${rows}</table><p>FEEL THE MUSIQ</p><script>print()</script>`);
  w.document.close();
}
