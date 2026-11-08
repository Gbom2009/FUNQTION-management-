import { useState } from 'react';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section, useToast } from '../../../core/ui';
import { save, softDelete } from '../../../core/repo';
import { EVENT_TYPES, type LightCue } from '../../../core/types';
import { fire, lightSettings, markTested, seedCues, useCues } from '../data';
import { describe, duplicateMidi, SECTIONS } from '../domain/live';
import { connectMidi, midiConnected } from '../midi';

const blank = (): Partial<LightCue> => ({ label: '', kind: 'scene', controller: 'soundswitch', midi: { type: 'note', channel: 1, number: 60, value: 127 }, eventTypes: [], sections: [], colour: '#f68712' });

/** Our buttons → MIDI messages that SoundSwitch (lights) and Daslight (laser) learn. */
export default function Cues() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings } = useSession();
  const cues = useCues();
  const [edit, setEdit] = useState<Partial<LightCue> | null>(null);
  const dups = duplicateMidi(cues);
  const testAll = async () => {
    if (!midiConnected()) await connectMidi();
    let ok = 0;
    for (const c of cues.filter((x) => x.kind !== 'laser' || x.laserRole === 'off')) {
      if ((await fire(c, undefined)) === 'sent') { ok++; await markTested(c); }
      if (c.hold) await fire(c, undefined, 'release');
      await new Promise((r) => setTimeout(r, 400));
    }
    toast(t('lt.testedAll', { n: ok, of: cues.length }));
  };
  return (
    <div>
      <div className="page-head row between">
        <h1>{t('lt.nav.cues')}</h1>
        <div className="row">
          {!cues.length && <button className="btn small" onClick={async () => toast(t('lt.seeded', { n: await seedCues() }))}>{t('lt.seed')}</button>}
          <button className="btn small ghost" onClick={testAll}>{t('lt.testAll')}</button>
          <button className="btn small" onClick={() => setEdit(blank())}>+ {t('lt.newCue')}</button>
        </div>
      </div>
      <p className="small muted">{t('lt.cuesHelp')}</p>
      <p className="tiny muted">{t('lt.output', { name: lightSettings(settings).midiOutput ?? t('lt.firstOutput') })}</p>
      {dups.map(([a, b]) => <div key={a.id + b.id} className="banner warn"><span className="txt">{t('lt.dup', { a: a.label, b: b.label })}</span></div>)}
      <Section>
        {cues.length ? (
          <div className="list">
            {cues.map((c) => (
              <div key={c.id} className="list-item row between">
                <button className="btn ghost" style={{ textAlign: 'left', justifyContent: 'flex-start', flex: 1 }} onClick={() => setEdit(c)}>
                  <span className="swatch" style={{ background: c.colour ?? 'transparent', width: 14, height: 14, display: 'inline-block', marginRight: 8, border: 'var(--fq-rule)' }} />
                  <span>
                    <span className="strong">{c.label}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{t(`lt.kind.${c.kind}` as Key)} · {c.controller === 'soundswitch' ? 'SoundSwitch' : 'Daslight'} · {c.midi ? describe(c.midi) : t('lt.unmapped')}{c.testedAt ? ' · ✓' : ''}</span>
                  </span>
                </button>
                <button className="btn small ghost" onPointerDown={async () => { const r = await fire(c, undefined); if (r === 'sent') await markTested(c); else toast(t(r === 'laser_blocked' ? 'lt.laserBlocked' : r === 'no_mapping' ? 'lt.unmapped' : 'lt.noMidi')); }} onPointerUp={() => c.hold && void fire(c, undefined, 'release')}>{t('lt.test')}</button>
              </div>
            ))}
          </div>
        ) : <Empty>{t('lt.noCues')}</Empty>}
      </Section>
      <Section title={t('lt.howToMap')}>
        <ol className="small" style={{ paddingLeft: '1.2em' }}>
          <li>{t('lt.map1')}</li><li>{t('lt.map2')}</li><li>{t('lt.map3')}</li><li>{t('lt.map4')}</li>
        </ol>
      </Section>
      {edit && <CueModal cue={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CueModal({ cue, onClose }: { cue: Partial<LightCue>; onClose: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState<Partial<LightCue>>(cue);
  const m = v.midi ?? { type: 'note' as const, channel: 1, number: 60, value: 127 };
  const setMidi = (c: Partial<typeof m>) => setV({ ...v, midi: { ...m, ...c } });
  const toggle = <T extends string>(arr: T[] | undefined, x: T) => ((arr ?? []).includes(x) ? (arr ?? []).filter((y) => y !== x) : [...(arr ?? []), x]);
  return (
    <Modal title={v.label || t('lt.newCue')} onClose={onClose} footer={<>
      {v.id && <button className="btn ghost danger-text" onClick={async () => { await softDelete('lightCues', v.id!); onClose(); }}>{t('pr.delete')}</button>}
      <button className="btn primary" disabled={!v.label?.trim()} onClick={async () => { await save<LightCue>('lightCues', { ...(v as LightCue), label: v.label!.trim(), testedAt: undefined }); onClose(); }}>{t('pr.save')}</button>
    </>}>
      <div className="stack">
        <Field label={t('lt.label')}><input value={v.label ?? ''} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        <div className="grid2">
          <Field label={t('lt.kindLabel')}>
            <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as LightCue['kind'], controller: e.target.value === 'laser' ? 'daslight' : v.controller })}>
              {(['scene', 'moment', 'blackout', 'laser'] as const).map((k) => <option key={k} value={k}>{t(`lt.kind.${k}` as Key)}</option>)}
            </select>
          </Field>
          <Field label={t('lt.controller')}>
            <select value={v.controller} onChange={(e) => setV({ ...v, controller: e.target.value as LightCue['controller'] })}>
              <option value="soundswitch">SoundSwitch</option><option value="daslight">Daslight</option>
            </select>
          </Field>
        </div>
        {v.kind === 'laser' && <Field label={t('lt.laserRole')}><select value={v.laserRole ?? 'on'} onChange={(e) => setV({ ...v, laserRole: e.target.value as 'on' | 'off' })}><option value="on">{t('lt.laserOn')}</option><option value="off">{t('lt.laserOff')}</option></select></Field>}
        <div className="grid4">
          <Field label="MIDI"><select value={m.type} onChange={(e) => setMidi({ type: e.target.value as typeof m.type })}><option value="note">Note</option><option value="cc">CC</option><option value="pc">Program</option></select></Field>
          <Field label={t('lt.channel')}><input inputMode="numeric" value={m.channel} onChange={(e) => setMidi({ channel: Number(e.target.value) || 1 })} /></Field>
          <Field label={t('lt.number')}><input inputMode="numeric" value={m.number} onChange={(e) => setMidi({ number: Number(e.target.value) || 0 })} /></Field>
          <Field label={t('lt.value')}><input inputMode="numeric" value={m.value} onChange={(e) => setMidi({ value: Number(e.target.value) || 0 })} /></Field>
        </div>
        <div className="tiny muted">{describe(m)}</div>
        <div className="grid2">
          <Field label={t('lt.colour')}><input type="color" value={v.colour ?? '#f68712'} onChange={(e) => setV({ ...v, colour: e.target.value })} /></Field>
          <Field label={t('lt.order')}><input inputMode="numeric" value={v.order ?? 0} onChange={(e) => setV({ ...v, order: Number(e.target.value) || 0 })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!v.hold} onChange={(e) => setV({ ...v, hold: e.target.checked })} /> {t('lt.hold')}</label>
        <label className="check"><input type="checkbox" checked={!!v.strobe} onChange={(e) => setV({ ...v, strobe: e.target.checked })} /> {t('lt.isStrobe')}</label>
        {v.kind !== 'laser' && <label className="check"><input type="checkbox" checked={!!v.usesLaser} onChange={(e) => setV({ ...v, usesLaser: e.target.checked })} /> {t('lt.usesLaser')}</label>}
        <div className="field"><span>{t('lt.sections')}</span><div className="chips">{SECTIONS.map((s) => <button key={s} type="button" className="chip" aria-pressed={(v.sections ?? []).includes(s)} onClick={() => setV({ ...v, sections: toggle(v.sections, s) })}>{t(`lt.sec.${s}` as Key)}</button>)}</div></div>
        <div className="field"><span>{t('lt.eventTypes')}</span><div className="chips">{EVENT_TYPES.map((s) => <button key={s} type="button" className="chip" aria-pressed={(v.eventTypes ?? []).includes(s)} onClick={() => setV({ ...v, eventTypes: toggle(v.eventTypes, s) })}>{t(`event.${s}` as Key)}</button>)}</div></div>
      </div>
    </Modal>
  );
}
