import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Section, useToast } from '../../../core/ui';
import { fmtDate, fmtDateTime } from '../../../core/format';
import { addDays, toDateStr } from '../../../core/dates';
import { useGigs } from '../../bookings/data';
import { importAll, usePortals } from '../data';

export default function PortalList() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { me } = useSession();
  const [paste, setPaste] = useState('');
  const portals = new Map(usePortals().map((p) => [p.gigId, p]));
  const from = toDateStr(addDays(new Date(), -60));
  const gigs = useGigs().filter((g) => g.date >= from && ['quote_sent', 'option', 'confirmed', 'played', 'invoiced', 'paid'].includes(g.stage)).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div>
      <div className="page-head"><h1>{t('app.portal')}</h1></div>
      <p className="small muted">{t('po.help')}</p>
      <Section title={t('fb.paste')}>
        <textarea rows={3} value={paste} placeholder="FQ1:…" onChange={(e) => setPaste(e.target.value)} style={{ width: '100%' }} />
        <button className="btn primary" disabled={!paste.includes('FQ1:') || !me} onClick={async () => {
          const r = await importAll(paste, me!.id);
          setPaste('');
          toast(t('po.imported', { w: r.wishes.wishes, c: r.wishes.contacts, f: r.feedback.imported + r.feedback.updated }) + (r.wishes.late.length ? ` · ${t('po.late')}` : ''));
        }}>{t('fb.read')}</button>
      </Section>
      <Section title={t('po.gigs')}>
        {gigs.length ? (
          <div className="list">
            {gigs.map((g) => {
              const p = portals.get(g.id);
              const fromClient = g.musicWishes.filter((w) => w.by === 'client').length;
              return (
                <Link key={g.id} to={`/portal/${g.id}`} className="list-item row between" style={{ textDecoration: 'none' }}>
                  <div>
                    <div className="strong">{g.title}</div>
                    <div className="tiny muted">{fmtDate(g.date, lang)} · {t(`stage.${g.stage}` as Key)}{fromClient ? ` · ${t('po.clientWishes', { n: fromClient })}` : ''}</div>
                  </div>
                  <span className="tiny muted">{p?.sentAt ? t('po.sentAt', { at: fmtDateTime(p.sentAt, lang) }) : t('po.notSent')}</span>
                </Link>
              );
            })}
          </div>
        ) : <Empty>{t('po.noGigs')}</Empty>}
      </Section>
    </div>
  );
}
