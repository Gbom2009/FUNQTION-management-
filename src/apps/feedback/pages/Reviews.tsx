import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Field, Modal, Section } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { patch, nowIso } from '../../../core/repo';
import type { Review } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { addManualReview, useReviews } from '../data';
import { SCORE_KEYS } from '../domain/feedback';

export default function Reviews() {
  const { t, lang } = useI18n();
  const gigs = useGigs();
  const gigById = new Map(gigs.map((g) => [g.id, g]));
  const reviews = useReviews().filter((r) => r.receivedAt || r.rating || r.text).sort((a, b) => (b.receivedAt ?? b.createdAt).localeCompare(a.receivedAt ?? a.createdAt));
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <div className="page-head row between">
        <h1>{t('fb.nav.reviews')}</h1>
        <button className="btn small" onClick={() => setAdding(true)}>+ {t('fb.addManual')}</button>
      </div>
      <p className="small muted">{t('fb.reviewsHelp')}</p>
      <Section>
        {reviews.length ? (
          <div className="list">
            {reviews.map((r) => {
              const g = gigById.get(r.gigId);
              return (
                <div key={r.id} className="list-item stack" style={{ gap: 4 }}>
                  <div className="row between">
                    <span className="strong">{r.rating ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '—'}{r.scores?.recommend != null ? ` · ${r.scores.recommend}/10` : ''}</span>
                    <span className="tiny muted">{g ? `${fmtDate(g.date, lang)} · ${g.title}` : ''}</span>
                  </div>
                  {r.text && <div className="small">“{r.text}”{r.displayName ? ` — ${r.displayName}` : ''}</div>}
                  {r.scores && <div className="tiny muted">{SCORE_KEYS.filter((k) => r.scores?.[k]).map((k) => `${t(`fbp.score.${k}` as Key)} ${r.scores![k]}`).join(' · ')}</div>}
                  {!!r.highlights?.length && <div className="tiny muted">{r.highlights.map((h) => t(`fbp.h.${h}` as Key)).join(' · ')}</div>}
                  <div className="row tiny" style={{ flexWrap: 'wrap' }}>
                    <span style={{ color: r.mayPublish ? 'var(--ok)' : 'var(--fq-text-dim)' }}>{r.mayPublish ? (r.mayUseName ? t('fb.pubName') : t('fb.pubAnon')) : t('fb.pubNo')}</span>
                    {r.mayPublish && <label className="check"><input type="checkbox" checked={!!r.approvedAt} onChange={(e) => patch<Review>('reviews', r.id, { approvedAt: e.target.checked ? nowIso() : undefined })} /> {t('pk.approved')}</label>}
                    {r.mayPublish && r.approvedAt && <Link to="/presskit">{t('fb.toPresskit')} →</Link>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty>{t('fb.noReviews')}</Empty>}
      </Section>
      {adding && <ManualReview onClose={() => setAdding(false)} />}
    </div>
  );
}

function ManualReview({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const gigs = useGigs().filter((g) => ['played', 'invoiced', 'paid'].includes(g.stage)).sort((a, b) => b.date.localeCompare(a.date));
  const [v, setV] = useState<Partial<Review> & { gigId: string }>({ gigId: gigs[0]?.id ?? '', platform: 'google', rating: 5, mayPublish: false });
  return (
    <Modal title={t('fb.addManual')} onClose={onClose} footer={<button className="btn primary" disabled={!v.gigId} onClick={async () => { await addManualReview(v); onClose(); }}>{t('pr.save')}</button>}>
      <div className="stack">
        <Field label={t('pr.gig')}>
          <select value={v.gigId} onChange={(e) => setV({ ...v, gigId: e.target.value })}>
            {gigs.map((g) => <option key={g.id} value={g.id}>{g.date} · {g.title}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label={t('fb.platform')}>
            <select value={v.platform} onChange={(e) => setV({ ...v, platform: e.target.value as Review['platform'] })}>
              {(['google', 'instagram', 'facebook', 'website', 'other'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label={t('fb.rating')}>
            <select value={v.rating} onChange={(e) => setV({ ...v, rating: Number(e.target.value) })}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('fb.text')}><textarea rows={4} value={v.text ?? ''} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
        <Field label={t('fb.name')}><input value={v.displayName ?? ''} onChange={(e) => setV({ ...v, displayName: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={!!v.mayPublish} onChange={(e) => setV({ ...v, mayPublish: e.target.checked })} /> {t('fb.manualPermission')}</label>
        {v.mayPublish && <label className="check"><input type="checkbox" checked={!!v.mayUseName} onChange={(e) => setV({ ...v, mayUseName: e.target.checked })} /> {t('fb.manualName')}</label>}
      </div>
    </Modal>
  );
}
