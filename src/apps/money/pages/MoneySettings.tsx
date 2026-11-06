import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section } from '../../../core/ui';
import { BackupPanel } from '../../../core/ui/BackupPanel';
import { centsFromInput, inputFromCents } from '../../../core/format';
import { save } from '../../../core/repo';
import type { Category, SplitRule } from '../../../core/types';
import { useCategories } from '../data';

export default function MoneySettings() {
  const { t, lang } = useI18n();
  const { settings, updateSettings } = useSession();
  const cats = useCategories();
  const rules = [...settings.splitRules].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const setRules = (r: SplitRule[]) => updateSettings({ splitRules: r });
  const setRule = (i: number, p: Partial<SplitRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div>
      <div className="page-head"><h1>{t('m.settings')}</h1></div>
      <Section title={t('m.backupTitle')}><BackupPanel /></Section>
      <div className="dash">
        <Section title={t('m.split')}>
          <div className="stack">
            <p className="small muted">{t('m.splitHelp')}</p>
            {rules.map((r, i) => (
              <div key={i} className="card stack">
                <div className="grid2">
                  <Field label={t('m.validFrom')}><input type="date" value={r.validFrom} onChange={(e) => setRule(i, { validFrom: e.target.value || '2000-01-01' })} /></Field>
                  <Field label={t('m.splitMethod')}>
                    <select value={r.method} onChange={(e) => setRule(i, { method: e.target.value as SplitRule['method'] })}>
                      <option value="fixed">{t('m.split.fixed')}</option><option value="by_lineup">{t('m.split.by_lineup')}</option>
                    </select>
                  </Field>
                  <Field label={t('m.gijsPct')} hint={`Coen ${100 - r.gijsPct}%`}><input inputMode="numeric" value={r.gijsPct} onChange={(e) => setRule(i, { gijsPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>
                  {r.method === 'by_lineup' && <Field label={t('m.soloPct')}><input inputMode="numeric" value={r.soloPct} onChange={(e) => setRule(i, { soloPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>}
                </div>
                {rules.length > 1 && <div><button className="btn small danger" onClick={() => setRules(rules.filter((_, j) => j !== i))}>{t('common.delete')}</button></div>}
              </div>
            ))}
            <div><button className="btn small" onClick={() => setRules([...rules, { ...rules[rules.length - 1], validFrom: new Date().toISOString().slice(0, 10) }])}>+ {t('m.newRule')}</button></div>
          </div>
        </Section>
        <Section title={t('m.trips')}>
          <div className="stack">
            <Field label={t('m.mileageRate')}><input inputMode="decimal" value={inputFromCents(settings.mileageRate)} onChange={(e) => updateSettings({ mileageRate: centsFromInput(e.target.value) ?? 0 })} /></Field>
            <Field label={t('m.homeGijs')}><input key={settings.homeGijs} defaultValue={settings.homeGijs ?? ''} onBlur={(e) => updateSettings({ homeGijs: e.target.value })} /></Field>
            <Field label={t('m.homeCoen')}><input key={settings.homeCoen} defaultValue={settings.homeCoen ?? ''} onBlur={(e) => updateSettings({ homeCoen: e.target.value })} /></Field>
          </div>
        </Section>
        <Section title={t('m.taxAside')}>
          <div className="stack">
            <Field label={t('m.taxPct')} hint={t('m.taxPctHint')}><input inputMode="numeric" value={settings.taxSetAsidePct} onChange={(e) => updateSettings({ taxSetAsidePct: Number(e.target.value) || 0 })} /></Field>
            <Field label={t('m.assetMin')}><input inputMode="decimal" value={inputFromCents(settings.assetMinCents)} onChange={(e) => updateSettings({ assetMinCents: centsFromInput(e.target.value) ?? 45000 })} /></Field>
            <p className="tiny muted">{t('s.vatMode')}: {t(`s.vatMode.${settings.vatMode}`)} ({t('m.changeIn')})</p>
          </div>
        </Section>
      </div>
      <Section title={t('m.categories')} actions={<button className="btn small" onClick={() => save<Category>('categories', { key: `custom-${Date.now()}`, name: '', nameEn: '', kind: 'expense', deductiblePct: 100, defaultVatRate: 21, defaultBusinessPct: 100, active: true, icon: '•' })}>+ {t('common.add')}</button>}>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th /><th>{t('common.name')}</th><th>{t('c.nameEn')}</th><th>{t('m.deductiblePct')}</th><th>{t('m.businessPct')}</th><th>{t('m.vatRate')}</th><th>{t('m.accountCode')}</th><th>{t('m.active')}</th></tr></thead>
            <tbody>{cats.map((c) => {
              const upd = (p: Partial<Category>) => save<Category>('categories', { ...c, ...p });
              return (
                <tr key={c.id}>
                  <td style={{ width: 48 }}><input className="input" defaultValue={c.icon} onBlur={(e) => upd({ icon: e.target.value })} aria-label="icon" /></td>
                  <td><input className="input" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && upd({ name: e.target.value })} aria-label={t('common.name')} /></td>
                  <td><input className="input" defaultValue={c.nameEn} onBlur={(e) => e.target.value !== c.nameEn && upd({ nameEn: e.target.value })} aria-label={t('c.nameEn')} /></td>
                  <td style={{ width: 80 }}><input className="input" inputMode="numeric" defaultValue={c.deductiblePct} onBlur={(e) => upd({ deductiblePct: Number(e.target.value) || 0 })} aria-label={t('m.deductiblePct')} /></td>
                  <td style={{ width: 80 }}><input className="input" inputMode="numeric" defaultValue={c.defaultBusinessPct} onBlur={(e) => upd({ defaultBusinessPct: Number(e.target.value) || 0 })} aria-label={t('m.businessPct')} /></td>
                  <td style={{ width: 80 }}><select className="input" value={c.defaultVatRate} onChange={(e) => upd({ defaultVatRate: Number(e.target.value) })} aria-label={t('m.vatRate')}>{[21, 9, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
                  <td style={{ width: 90 }}><input className="input" defaultValue={c.accountCode ?? ''} onBlur={(e) => upd({ accountCode: e.target.value })} aria-label={t('m.accountCode')} /></td>
                  <td><input type="checkbox" checked={c.active} onChange={(e) => upd({ active: e.target.checked })} aria-label={t('m.active')} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <span hidden>{lang}</span>
      </Section>
    </div>
  );
}
