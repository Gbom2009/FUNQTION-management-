import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { alive } from '../../../core/repo';
import { useI18n } from '../../../core/i18n';
import { Section, useToast } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import type { EventType, Gig, Play, RequestStat } from '../../../core/types';
import { useTracks } from '../../library/data';
import { importSeratoHistory, usePlays } from '../data';

const REACT: Record<string, number> = { fire: 1, good: 0.75, meh: 0.35, empty: 0 };

/** What was played where, how it went, and what to learn from it. */
export default function History() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const plays = usePlays();
  const tracks = useTracks();
  const gigs = (useLiveQuery(async () => alive(await db.gigs.toArray()), []) ?? []) as Gig[];
  const reqs = (useLiveQuery(async () => alive(await db.requestStats.toArray()), []) ?? []) as RequestStat[];
  const [gigId, setGigId] = useState('');
  const [type, setType] = useState<EventType | ''>('');
  const byId = new Map(tracks.map((x) => [x.id, x]));
  const gigById = new Map(gigs.map((g) => [g.id, g]));
  const name = (p: Play) => { const tr = p.trackId ? byId.get(p.trackId) : undefined; return tr ? `${tr.artist} – ${tr.title}` : `${p.rawArtist ?? ''} – ${p.rawTitle ?? '?'}`; };

  const stats = useMemo(() => {
    const filt = plays.filter((p) => p.trackId && (!type || (p.gigId && gigById.get(p.gigId)?.eventType === type)));
    const m = new Map<string, { n: number; r: number; rn: number; last: string }>();
    for (const p of filt) {
      const s = m.get(p.trackId!) ?? { n: 0, r: 0, rn: 0, last: '' };
      s.n++; if (p.reaction) { s.r += REACT[p.reaction]; s.rn++; } if (p.at > s.last) s.last = p.at;
      m.set(p.trackId!, s);
    }
    const rows = [...m].map(([id, s]) => ({ id, ...s, avg: s.rn ? s.r / s.rn : undefined }));
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    return {
      most: [...rows].sort((a, b) => b.n - a.n).slice(0, 15),
      best: rows.filter((r) => r.rn >= 2).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)).slice(0, 15),
      rediscover: rows.filter((r) => (r.avg ?? 0.6) >= 0.6 && r.last < cutoff).sort((a, b) => a.last.localeCompare(b.last)).slice(0, 15),
    };
  }, [plays, type, gigById]);

  const gigList = [...new Set(plays.map((p) => p.gigId).filter(Boolean) as string[])].map((id) => gigById.get(id)).filter(Boolean) as Gig[];
  const shown = gigId ? plays.filter((p) => p.gigId === gigId) : [];
  const topReq = useMemo(() => {
    const m = new Map<string, { label: string; votes: number; n: number; have: boolean }>();
    for (const r of reqs) { const s = m.get(r.normKey) ?? { label: `${r.artist} – ${r.title}`, votes: 0, n: 0, have: !!r.trackId }; s.votes += r.votes; s.n++; m.set(r.normKey, s); }
    return [...m.values()].sort((a, b) => b.n - a.n || b.votes - a.votes).slice(0, 15);
  }, [reqs]);
  const label = (id: string) => { const tr = byId.get(id); return tr ? `${tr.artist} – ${tr.title}` : id; };

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="page-head row between">
        <h1>{t('sets.history')}</h1>
        <button className="btn small" onClick={() => file.current?.click()}>{t('sets.importSerato')}</button>
        <input ref={file} type="file" accept=".session" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          const r = await importSeratoHistory(new Uint8Array(await f.arrayBuffer()), gigId || undefined);
          toast(t('sets.importDone', { added: r.added, matched: r.matched, skipped: r.skipped }));
        }} />
      </div>
      <p className="tiny muted">{t('sets.importHint')}</p>
      <Section title={t('sets.perGig')}>
        <select value={gigId} onChange={(e) => setGigId(e.target.value)}>
          <option value="">–</option>
          {gigs.filter((g) => g.stage === 'confirmed' || g.stage === 'played' || g.stage === 'invoiced' || g.stage === 'paid').sort((a, b) => b.date.localeCompare(a.date)).map((g) => <option key={g.id} value={g.id}>{fmtDate(g.date, lang)} · {g.title}{gigList.includes(g) ? ' ●' : ''}</option>)}
        </select>
        {shown.map((p) => <div key={p.id} className="list-item"><span className="mono-num">{new Date(p.at).toTimeString().slice(0, 5)}</span><span className="grow">{name(p)}</span><span className="tiny">{p.reaction ? t(`sets.react.${p.reaction}` as never) : ''}{p.requestId ? ' · 🙋' : ''}</span></div>)}
      </Section>
      <Section title={t('sets.stats')} actions={<select value={type} onChange={(e) => setType(e.target.value as EventType | '')}><option value="">{t('sets.allTypes')}</option>{(['wedding', 'village_festival', 'club', 'private_party', 'company'] as EventType[]).map((e) => <option key={e} value={e}>{t(`event.${e}` as never)}</option>)}</select>}>
        <div className="grid3">
          <div><div className="legend">{t('sets.most')}</div>{stats.most.map((r) => <div key={r.id} className="small">{r.n}× {label(r.id)}</div>)}</div>
          <div><div className="legend">{t('sets.best')}</div>{stats.best.map((r) => <div key={r.id} className="small">{Math.round((r.avg ?? 0) * 100)}% {label(r.id)}</div>)}</div>
          <div><div className="legend">{t('sets.rediscover')}</div>{stats.rediscover.map((r) => <div key={r.id} className="small">{label(r.id)} <span className="muted tiny">{r.last.slice(0, 10)}</span></div>)}</div>
        </div>
      </Section>
      <Section title={t('sets.topRequests')}>
        {topReq.map((r) => <div key={r.label} className="small">{r.n}× {r.label} {r.have ? '✓' : <span className="danger-text">{t('sets.notInLibrary')}</span>}</div>)}
        {!topReq.length && <p className="muted small">–</p>}
      </Section>
    </div>
  );
}
