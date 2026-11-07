import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useToast } from '../../../core/ui';
import type { GearItem } from '../../../core/types';
import { findByCode, useGearItems, useGearLocations, moveItem } from '../data';
import { ancestry, descendants } from '../domain/gear';
import { Scanner, StatusPill, Thumb, feedback, useNightMode } from '../components';
import { IssueDialog } from './Items';

/** Free scanning: scan a tag → the item card with quick actions. */
export default function Scan() {
  const { t } = useI18n();
  const toast = useToast();
  const locs = useGearLocations();
  const items = useGearItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const [item, setItem] = useState<GearItem | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [issue, setIssue] = useState(false);
  const [night, setNight] = useNightMode();
  return (
    <div>
      <div className="page-head"><h1>{t('g.scan')}</h1><button className="btn small ghost" aria-pressed={night} onClick={() => setNight(!night)}>{t('g.night')}</button></div>
      <Scanner onCode={async (code) => {
        const it = await findByCode(code);
        feedback(!!it);
        setItem(it ?? null); setUnknown(it ? null : code);
      }} />
      {unknown && <div className="banner warn" style={{ marginTop: 'var(--s3)' }}><span>?</span><div className="txt">{t('g.unknownCode', { code: unknown })} <Link to={`/gear/items/new?code=${encodeURIComponent(unknown)}`}>{t('g.newItem')}</Link></div></div>}
      {item && (
        <div className="card stack scan-card" style={{ marginTop: 'var(--s3)' }}>
          <div className="row"><Thumb itemId={item.id} size={56} /><div className="grow"><div className="strong big-text">{item.name}</div><div className="small muted">{item.code} · {[item.brand, item.model].filter(Boolean).join(' ')}</div></div><StatusPill status={item.status} /></div>
          <div className="small">{t('g.location')}: {locs.find((l) => l.id === item.locationId)?.name ?? '—'}</div>
          {item.parentId && <div className="small">{t('g.inPath')}: {ancestry(item.id, items).slice(0, -1).map((id) => byId.get(id)?.name).join(' › ')}</div>}
          {item.kind === 'container' && <div className="small">{t('g.contents', { n: descendants(item.id, items).length })}: {items.filter((i) => i.parentId === item.id).map((i) => i.name).join(', ') || '—'}</div>}
          <div className="row">
            <Link className="btn primary" to={`/gear/items/${item.id}`}>{t('g.open')}</Link>
            <button className="btn" onClick={() => setIssue(true)}>{t('g.reportIssue')}</button>
            <select className="input" style={{ width: 'auto' }} value="" aria-label={t('g.moveTo')} onChange={async (e) => { if (e.target.value) { setItem(await moveItem(item, e.target.value)); toast(t('common.saved')); } }}>
              <option value="">{t('g.moveTo')}</option>{locs.filter((l) => l.type !== 'on_the_road').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
      )}
      {issue && item && <IssueDialog item={item} onClose={() => setIssue(false)} />}
    </div>
  );
}
