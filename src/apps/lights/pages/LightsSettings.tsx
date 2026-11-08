import { useEffect, useState } from 'react';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section } from '../../../core/ui';
import { EVENT_TYPES, type LightSettings } from '../../../core/types';
import { lightSettings } from '../data';
import { connectMidi, midiConnected, midiSupported, onMidiChange, outputNames } from '../midi';

export default function LightsSettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSession();
  const ls = lightSettings(settings);
  const set = (c: Partial<LightSettings>) => updateSettings({ light: { ...ls, ...c } });
  const [, force] = useState(0);
  useEffect(() => onMidiChange(() => force((x) => x + 1)), []);
  return (
    <div>
      <div className="page-head"><h1>{t('lt.settings')}</h1></div>
      <Section title="MIDI">
        <p className="small muted">{t('lt.midiHelp')}</p>
        {!midiSupported() && <div className="banner danger"><span className="txt">{t('lt.midiUnsupported')}</span></div>}
        {midiSupported() && !midiConnected() && <button className="btn" onClick={() => connectMidi()}>{t('lt.connectMidi')}</button>}
        {midiConnected() && (
          <Field label={t('lt.outputLabel')}>
            <select value={ls.midiOutput ?? ''} onChange={(e) => set({ midiOutput: e.target.value || undefined })}>
              <option value="">{t('lt.firstOutput')}</option>
              {outputNames().map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        )}
      </Section>
      <Section title={t('lt.laser')}>
        <label className="check"><input type="checkbox" checked={ls.remoteEstop} onChange={(e) => set({ remoteEstop: e.target.checked })} /> {t('lt.remoteEstop')}</label>
        <p className="small muted">{t('lt.remoteEstopHelp')}</p>
      </Section>
      <Section title={t('lt.strobe')}>
        <p className="small muted">{t('lt.strobeHelp', { hz: ls.maxStrobeHz })}</p>
        <div className="chips">{EVENT_TYPES.map((e) => <button key={e} type="button" className="chip" aria-pressed={ls.strobeOff.includes(e)} onClick={() => set({ strobeOff: ls.strobeOff.includes(e) ? ls.strobeOff.filter((x) => x !== e) : [...ls.strobeOff, e] })}>{t(`event.${e}` as Key)}</button>)}</div>
      </Section>
    </div>
  );
}
