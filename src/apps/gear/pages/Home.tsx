import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Section, StagePill, useToast } from '../../../core/ui';
import { euro, fmtDate } from '../../../core/format';
import { todayStr } from '../../../core/dates';
import { useGigs } from '../../bookings/data';
import { allConflicts, getOrCreatePackList, importGearCsv, useGearItems, useIssues, useLogs, usePackLists, usePlans, useRentals, useSafetyTests } from '../data';
import { insuranceTotals, maintenanceDue, progress, safetyDue, type GearConflict } from '../domain/gear';
import starterCsv from '../../../../docs/gear-inventory/gear-list.csv?raw';

export default function GearHome() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { settings } = useSession();
  const items = useGearItems();
  const lists = usePackLists();
  const issues = useIssues();
  const plans = usePlans();
  const logs = useLogs();
  const tests = useSafetyTests();
  const rentals = useRentals();
  const today = todayStr();
  const gigs = useGigs().filter((g) => g.date >= today && ['option', 'quote_sent', 'confirmed'].includes(g.stage)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const outGigs = lists.filter((l) => l.status === 'out' || l.status === 'loading');
  const [conflicts, setConflicts] = useState<GearConflict[]>([]);
  useEffect(() => { allConflicts().then(setConflicts); }, [lists, items]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const broken = items.filter((i) => i.status === 'out_of_service' || i.status === 'in_repair');
  const missing = items.filter((i) => i.status === 'missing');
  const due = maintenanceDue(plans, items, logs, today).filter((d) => d.overdue);
  const safety = settings.gearSafetyTests ? safetyDue(items, tests, settings, today).filter((d) => d.overdue) : [];
  const overdueRentals = rentals.filter((r) => !r.returnedAt && r.until < today);
  const totals = insuranceTotals(items);

  if (!items.length) {
    return (
      <div>
        <div className="page-head"><h1>{t('app.gear')}</h1></div>
        <Empty>
          <p>{t('g.emptyIntro')}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={async () => { const r = await importGearCsv(starterCsv); toast(t('g.imported', { n: r.added })); }}>{t('g.importStarter')}</button>
            <Link className="btn" to="/gear/items/new">+ {t('g.newItem')}</Link>
          </div>
          <p className="tiny muted">{t('g.starterHint')}</p>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head"><h1>{t('app.gear')}</h1><Link className="btn primary" to="/gear/scan">{t('g.scan')}</Link></div>
      {!settings.gearInsurer && totals.replacement > 0 && (
        <div className="banner warn" style={{ marginBottom: 'var(--s4)' }}><span>!</span><div className="txt">{t('g.uninsured', { amount: euro(totals.replacement, lang) })} <Link to="/gear/insurance">{t('g.insurance')} →</Link></div></div>
      )}
      <div className="layout-2">
        <div>
          {outGigs.length > 0 && (
            <Section title={t('g.onTheRoad')}>
              <div className="list">{outGigs.map((l) => {
                const g = gigs.find((x) => x.id === l.gigId);
                const p = progress(l.lines, 'back');
                return <Link key={l.id} className="list-item" to={`/gear/gigs/${l.gigId}?mode=back`}><span className="grow strong">{g?.title ?? t('g.gig')}</span><span className="small">{p.done}/{p.lines}</span><span className="btn small primary">{t('g.unload')}</span></Link>;
              })}</div>
            </Section>
          )}
          <Section title={t('g.nextGigs')}>
            {gigs.length === 0 ? <p className="muted small">{t('g.noGigs')}</p> : (
              <div className="list">
                {gigs.map((g) => {
                  const l = lists.find((x) => x.gigId === g.id);
                  const p = l ? progress(l.lines, 'out') : null;
                  return (
                    <button key={g.id} className="list-item" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={async () => { await getOrCreatePackList(g.id); nav(`/gear/gigs/${g.id}`); }}>
                      <span className="small" style={{ minWidth: 86 }}>{fmtDate(g.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span className="grow"><span className="strong">{g.title}</span><br /><span className="tiny muted">{l ? `${t(`g.list.${l.status}`)} · ${p!.lines} ${t('g.lines')}` : t('g.noList')}</span></span>
                      <StagePill stage={g.stage} />
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        </div>
        <div>
          <Section title={t('g.attention')}>
            <div className="stack" style={{ gap: 'var(--s2)' }}>
              {conflicts.map((c) => (
                <div key={c.itemId} className="banner danger"><span>!</span><div className="txt small">{t('g.conflict', { name: byId.get(c.itemId)?.name ?? '', need: c.need, have: c.have })}</div></div>
              ))}
              {missing.map((i) => <Link key={i.id} className="banner danger" to={`/gear/items/${i.id}`}><span>!</span><div className="txt small">{t('g.missingItem', { code: i.code, name: i.name })}</div></Link>)}
              {broken.length > 0 && <Link className="banner warn" to="/gear/care"><span>⏸</span><div className="txt small">{t('g.brokenN', { n: broken.length })}</div></Link>}
              {due.length > 0 && <Link className="banner warn" to="/gear/care"><span>🔧</span><div className="txt small">{t('g.dueN', { n: due.length })}</div></Link>}
              {safety.length > 0 && <Link className="banner warn" to="/gear/care"><span>⚡</span><div className="txt small">{t('g.safetyN', { n: safety.length })}</div></Link>}
              {overdueRentals.map((r) => <Link key={r.id} className="banner warn" to="/gear/rentals"><span>↩</span><div className="txt small">{t('g.rentalOverdue', { party: r.party, date: fmtDate(r.until, lang) })}</div></Link>)}
              {!conflicts.length && !missing.length && !broken.length && !due.length && !safety.length && !overdueRentals.length && <p className="small muted">{t('g.allGood')}</p>}
            </div>
          </Section>
          <Section title={t('g.register')}>
            <dl className="kv">
              <dt>{t('g.items')}</dt><dd>{totals.count}</dd>
              <dt>{t('g.value')}</dt><dd>{euro(totals.replacement, lang)}</dd>
              <dt>{t('g.issuesOpen')}</dt><dd>{issues.filter((i) => i.status === 'open' || i.status === 'in_repair').length}</dd>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
