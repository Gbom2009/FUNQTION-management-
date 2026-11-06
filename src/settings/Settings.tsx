import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../core/db';
import { useI18n, type Key } from '../core/i18n';
import { hashPin, useSession } from '../core/session';
import { Field, Section, useToast } from '../core/ui';
import { download, exportAll, importMerge, type BackupFile } from '../core/backup';
import { save, softDelete, uid } from '../core/repo';
import { loadDemo } from '../core/demo';
import { TEMPLATE_KINDS, type Settings as S, type Template } from '../core/types';
import { MERGE_FIELDS } from '../apps/bookings/domain/messaging';
import { runTaskSync } from '../apps/bookings/domain/taskSync';

const NUMBERS: [keyof S, Key][] = [
  ['replyHours', 'settings.replyHours'], ['quoteFollowUp1Days', 'settings.fu1'], ['quoteFollowUp2Days', 'settings.fu2'],
  ['quoteValidDays', 'settings.quoteValid'], ['optionDays', 'settings.optionDays'], ['musicWishesDays', 'settings.musicDays'],
  ['finalCheckDays', 'settings.finalDays'], ['gearCheckDays', 'settings.gearDays'], ['reviewDays', 'settings.reviewDays'],
  ['paymentCheckDays', 'settings.paymentDays'], ['rebookMonthsBefore', 'settings.rebookMonths'],
];

export default function Settings() {
  const { t } = useI18n();
  const { settings, updateSettings, me, logout } = useSession();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)); }, []);

  const num = (k: keyof S) => (
    <input inputMode="numeric" value={String(settings[k] ?? '')} onChange={(e) => updateSettings({ [k]: Number(e.target.value) || 0 } as Partial<S>)} />
  );

  async function savePin() {
    if (!me) return;
    if (pin && !/^\d{4,8}$/.test(pin)) return;
    const salt = uid();
    await db.members.put({ ...me, pinHash: pin ? await hashPin(pin, salt) : undefined, pinSalt: pin ? salt : undefined });
    setPin('');
    toast(t('settings.pinSaved'));
  }

  async function doExport() {
    const data = await exportAll();
    download(`funqtion-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(data));
  }

  async function doImport(f: File) {
    try {
      const data = JSON.parse(await f.text()) as BackupFile;
      const r = await importMerge(data);
      toast(t('settings.importDone', { ...r }));
      runTaskSync();
    } catch {
      toast(t('settings.importError'));
    }
  }

  return (
    <div>
      <div className="page-head"><h1>{t('settings.title')}</h1></div>
      <div className="dash">
        <Section title={t('settings.general')}>
          <div className="stack">
            <Field label={t('settings.language')}>
              <select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value as S['language'] })}>
                <option value="nl">Nederlands</option><option value="en">English</option>
              </select>
            </Field>
            <Field label={t('settings.theme')}>
              <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as S['theme'] })}>
                <option value="dark">{t('settings.theme.dark')}</option><option value="light">{t('settings.theme.light')}</option><option value="auto">{t('settings.theme.auto')}</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section title={`${t('settings.profile')} · ${me?.name ?? ''}`}>
          <div className="stack">
            <Field label={t('settings.pin')}><input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
            <div className="row"><button className="btn" onClick={savePin}>{t('common.save')}</button><button className="btn ghost" onClick={logout}>{t('login.switch')}</button></div>
          </div>
        </Section>

        <Section title={t('settings.conflicts')}>
          <Field label={t('settings.minGap')}>{num('minGapMinutes')}</Field>
        </Section>

        <Section title={t('settings.business')}>
          <div className="stack">
            <Field label={t('settings.businessName')}><input value={settings.businessName} onChange={(e) => updateSettings({ businessName: e.target.value })} /></Field>
            <Field label={t('settings.vat')}>{num('defaultVatRate')}</Field>
            <Field label={t('settings.reviewLink')}><input value={settings.reviewLink ?? ''} placeholder="https://g.page/r/…" onChange={(e) => updateSettings({ reviewLink: e.target.value })} /></Field>
          </div>
        </Section>

        <Section title={t('settings.reminders')}>
          <div className="stack">
            {NUMBERS.map(([k, label]) => <Field key={k} label={t(label)}>{num(k)}</Field>)}
            <button className="btn small" onClick={() => runTaskSync()}>↻</button>
          </div>
        </Section>

        <Section title={t('settings.data')}>
          <div className="stack">
            <p className="small muted">{t('settings.shareHint')}</p>
            <div className="row">
              <button className="btn primary" onClick={doExport}>{t('settings.export')}</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>{t('settings.import')}</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
            </div>
            <p className="small" style={{ color: persisted ? 'var(--ok)' : 'var(--warning)' }}>{t('settings.storage')}: {persisted ? t('settings.persisted') : t('settings.notPersisted')}</p>
            <div><button className="btn small ghost" onClick={async () => { await loadDemo(); toast(t('settings.demoDone')); }}>{t('settings.demo')}</button></div>
          </div>
        </Section>
      </div>
      <Section title={t('settings.products')}><Link className="btn small" to="/invoicing/catalog">{t('inv.catalog')} →</Link></Section>
      <Templates />
      <p className="tiny muted">{t('settings.version')} {__APP_VERSION__} · {t('app.tagline')}</p>
    </div>
  );
}

function Templates() {
  const { t } = useI18n();
  const templates = ((useLiveQuery(() => db.templates.toArray(), []) ?? []) as Template[]).filter((x) => !x.deletedAt)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.language.localeCompare(b.language));
  const [openId, setOpenId] = useState<string | null>(null);
  const cur = templates.find((x) => x.id === openId);
  return (
    <Section title={t('settings.templates')} actions={<button className="btn small" onClick={async () => { const n = await save<Template>('templates', { name: 'Nieuw sjabloon', kind: 'custom', language: 'nl', body: '' } as Template); setOpenId(n.id); }}>+ {t('common.add')}</button>}>
      <p className="tiny muted">{t('settings.mergeFields')}: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(' ')}</p>
      <div className="layout-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' }}>
        <div className="list">
          {templates.map((x) => (
            <button key={x.id} className="list-item" style={{ textAlign: 'left', border: 0, cursor: 'pointer', boxShadow: x.id === openId ? 'inset 2px 0 0 var(--fq-accent)' : undefined }} onClick={() => setOpenId(x.id)}>
              <span className="grow">{x.name}</span><span className="tiny muted">{x.language.toUpperCase()}</span>
            </button>
          ))}
        </div>
        {cur ? (
          <div className="stack" key={cur.id}>
            <div className="grid3">
              <Field label={t('common.name')}><input defaultValue={cur.name} onBlur={(e) => save<Template>('templates', { ...cur, name: e.target.value })} /></Field>
              <Field label={t('common.type')}><select value={cur.kind} onChange={(e) => save<Template>('templates', { ...cur, kind: e.target.value as Template['kind'] })}>{TEMPLATE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
              <Field label={t('settings.language')}><select value={cur.language} onChange={(e) => save<Template>('templates', { ...cur, language: e.target.value as Template['language'] })}><option value="nl">NL</option><option value="en">EN</option></select></Field>
            </div>
            <Field label="Subject"><input defaultValue={cur.subject ?? ''} onBlur={(e) => save<Template>('templates', { ...cur, subject: e.target.value })} /></Field>
            <Field label={t('msg.preview')}><textarea rows={12} defaultValue={cur.body} onBlur={(e) => save<Template>('templates', { ...cur, body: e.target.value })} /></Field>
            <div><button className="btn small danger" onClick={() => { softDelete('templates', cur.id); setOpenId(null); }}>{t('common.delete')}</button></div>
          </div>
        ) : <div className="empty">{t('msg.template')}</div>}
      </div>
    </Section>
  );
}
