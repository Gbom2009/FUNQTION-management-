import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section, useToast } from '../../../core/ui';
import { patch, softDelete } from '../../../core/repo';
import { POST_FORMATS, POST_KINDS, type Post, type PostStats } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { addStats, attachRender, confirmPosted, exportVideoBrief, mediaUrl, newPost, photoOptOutFor, shareToInstagram, useConsents, useMedia } from '../data';
import { blockers, CAPTION_MAX, fullCaption, parseTags, postState } from '../domain/promo';
import { PostPill, Thumb } from '../components';

const toLocal = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function PostEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  useEffect(() => {
    if (id === 'new') newPost().then((p) => nav(`/promo/posts/${p.id}`, { replace: true }));
  }, [id, nav]);
  const post = useLiveQuery(() => (id && id !== 'new' ? db.posts.get(id) : undefined), [id]);
  if (!post) return <p className="muted">…</p>;
  return <Editor post={post} />;
}

function Editor({ post }: { post: Post }) {
  const { t } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const gigs = useGigs().sort((a, b) => b.date.localeCompare(a.date));
  const media = useMedia();
  const consents = useConsents();
  const [optOut, setOptOut] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tagText, setTagText] = useState(post.hashtags.map((h) => `#${h}`).join(' '));
  const gig = gigs.find((g) => g.id === post.gigId);
  useEffect(() => { photoOptOutFor(post.gigId).then(setOptOut); }, [post.gigId]);

  const set = (c: Partial<Post>) => patch<Post>('posts', post.id, c);
  const problems = blockers({ post, gig, media, consents, photoOptOut: optOut });
  const caption = fullCaption(post, 'nl');
  const items = post.mediaIds.map((mid) => media.find((m) => m.id === mid)).filter(Boolean) as typeof media;
  const state = postState(post);

  return (
    <div>
      <div className="page-head row between">
        <h1>{t(`pr.kind.${post.kind}` as Key)}</h1>
        <PostPill post={post} />
      </div>

      <div className="layout-2">
        <div className="stack">
          <Section title={t('pr.post')}>
            <div className="grid2">
              <Field label={t('pr.kindLabel')}>
                <select value={post.kind} onChange={(e) => set({ kind: e.target.value as Post['kind'] })}>
                  {POST_KINDS.map((k) => <option key={k} value={k}>{t(`pr.kind.${k}` as Key)}</option>)}
                </select>
              </Field>
              <Field label={t('pr.formatLabel')}>
                <select value={post.format} onChange={(e) => set({ format: e.target.value as Post['format'] })}>
                  {POST_FORMATS.map((k) => <option key={k} value={k}>{t(`pr.format.${k}` as Key)}</option>)}
                </select>
              </Field>
              <Field label={t('pr.gig')}>
                <select value={post.gigId ?? ''} onChange={(e) => set({ gigId: e.target.value || undefined })}>
                  <option value="">—</option>
                  {gigs.map((g) => <option key={g.id} value={g.id}>{g.date} · {g.title}</option>)}
                </select>
              </Field>
              <Field label={t('pr.plannedAt')} hint={t('pr.plannedHint')}>
                <input type="datetime-local" value={toLocal(post.plannedAt)} onChange={(e) => set({ plannedAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
              </Field>
            </div>
            <Field label={t('pr.captionNl')} hint={`${caption.length}/${CAPTION_MAX}`}>
              <textarea rows={6} value={post.captionNl} onChange={(e) => set({ captionNl: e.target.value })} />
            </Field>
            <Field label={t('pr.captionEn')}>
              <textarea rows={4} value={post.captionEn ?? ''} onChange={(e) => set({ captionEn: e.target.value })} />
            </Field>
            <Field label={t('pr.hashtags')} hint={`${post.hashtags.length}/30`}>
              <input value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={() => set({ hashtags: parseTags(tagText) })} />
            </Field>
            <Field label={t('pr.note')}>
              <input value={post.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </Section>

          <Section title={t('pr.media')} actions={<button className="btn small" onClick={() => setPicking(true)}>{t('pr.pickMedia')}</button>}>
            {items.length ? (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {items.map((m, i) => (
                  <div key={m.id} className="stack" style={{ gap: 4 }}>
                    <Thumb m={m} />
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn icon small ghost" aria-label={t('pr.moveLeft')} disabled={i === 0} onClick={() => { const ids = [...post.mediaIds]; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; set({ mediaIds: ids }); }}>←</button>
                      <button className="btn icon small ghost" aria-label={t('pr.remove')} onClick={() => set({ mediaIds: post.mediaIds.filter((x) => x !== m.id) })}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <Empty>{t('pr.noMedia')}</Empty>}
          </Section>

          <Section title={t('pr.video')}>
            <p className="small muted">{t('pr.videoHelp')}</p>
            <VideoBrief post={post} />
          </Section>
        </div>

        <div className="stack">
          <Section title={t('pr.preview')}>
            <div className="card" style={{ maxWidth: 360 }}>
              <div className="row tiny"><strong>@funqtionofficial</strong></div>
              {items[0] && <div style={{ margin: 'var(--s2) 0', aspectRatio: post.format === 'reel' || post.format === 'story' ? '9 / 16' : '4 / 5', overflow: 'hidden', background: 'var(--fq-surface-inset)' }}>
                {items[0].kind === 'video'
                  ? <video src={mediaUrl(items[0])} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline controls />
                  : <img src={mediaUrl(items[0])} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>}
              {items.length > 1 && <div className="tiny muted">1 / {items.length}</div>}
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{caption}</div>
            </div>
          </Section>

          <Section title={t('pr.checks')}>
            {problems.length
              ? <div className="stack">{problems.map((b) => <div key={b} className="banner warn"><span className="txt">{t(`pr.block.${b}` as Key)}</span></div>)}</div>
              : <div className="banner ok"><span className="txt">{t('pr.checksOk')}</span></div>}
          </Section>

          <Section title={t('pr.actions')}>
            <div className="stack">
              {post.status !== 'published' && (post.status === 'ready'
                ? <button className="btn" onClick={() => set({ status: 'draft' })}>{t('pr.backToDraft')}</button>
                : <button className="btn" disabled={!post.plannedAt} onClick={() => set({ status: 'ready' })}>{t('pr.markReady')}</button>)}
              <button className="btn" onClick={async () => { await navigator.clipboard?.writeText(caption).catch(() => undefined); toast(t('pr.copied')); }}>{t('pr.copyCaption')}</button>
              <button className="btn" disabled={!items.length} onClick={async () => toast(t((await shareToInstagram(post, caption)) === 'shared' ? 'pr.shared' : 'pr.downloaded'))}>{t('pr.share')}</button>
              {post.status !== 'published' && <button className="btn primary" disabled={problems.length > 0} onClick={() => setConfirming(true)}>{t('pr.confirmPosted')}</button>}
              {post.status === 'published' && <button className="btn" onClick={() => setStatsOpen(true)}>{t('pr.addStats')}</button>}
              {post.status !== 'published' && <button className="btn ghost" onClick={() => set({ status: 'skipped' })}>{t('pr.skip')}</button>}
              <button className="btn ghost danger-text" onClick={async () => { await softDelete('posts', post.id); nav('/promo'); }}>{t('pr.delete')}</button>
            </div>
            {state === 'published' && post.confirmedAt && <p className="tiny muted">{t('pr.confirmedBy', { who: post.confirmedBy ?? '', at: new Date(post.confirmedAt).toLocaleString() })}</p>}
            {post.permalink && <p className="tiny"><a href={post.permalink} target="_blank" rel="noreferrer">{post.permalink}</a></p>}
          </Section>
        </div>
      </div>

      {picking && <MediaPicker post={post} gigId={post.gigId} onClose={() => setPicking(false)} />}
      {confirming && me && <ConfirmModal post={post} onClose={() => setConfirming(false)} onDone={async (link) => { await confirmPosted(post, me.id, link); setConfirming(false); toast(t('pr.postedSaved')); }} />}
      {statsOpen && <StatsModal post={post} onClose={() => setStatsOpen(false)} />}
    </div>
  );
}

function MediaPicker({ post, gigId, onClose }: { post: Post; gigId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [onlyGig, setOnlyGig] = useState(!!gigId);
  const media = useMedia().filter((m) => ['photo', 'video', 'logo'].includes(m.kind) && (!onlyGig || m.gigId === gigId))
    .sort((a, b) => (b.takenAt ?? b.createdAt).localeCompare(a.takenAt ?? a.createdAt));
  const toggle = (id: string) => patch<Post>('posts', post.id, { mediaIds: post.mediaIds.includes(id) ? post.mediaIds.filter((x) => x !== id) : [...post.mediaIds, id] });
  return (
    <Modal title={t('pr.pickMedia')} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t('pr.done')}</button>}>
      {gigId && <label className="check"><input type="checkbox" checked={onlyGig} onChange={(e) => setOnlyGig(e.target.checked)} /> {t('pr.onlyThisGig')}</label>}
      {media.length ? (
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 'var(--s3)' }}>
          {media.map((m) => (
            <button key={m.id} className="btn ghost" style={{ padding: 2, outline: post.mediaIds.includes(m.id) ? '2px solid var(--fq-accent)' : 'none' }} aria-pressed={post.mediaIds.includes(m.id)} onClick={() => toggle(m.id)}>
              <Thumb m={m} size={88} />
            </button>
          ))}
        </div>
      ) : <Empty>{t('pr.noMediaYet')}</Empty>}
    </Modal>
  );
}

function ConfirmModal({ post, onClose, onDone }: { post: Post; onClose: () => void; onDone: (link?: string) => void }) {
  const { t } = useI18n();
  const [link, setLink] = useState(post.permalink ?? '');
  return (
    <Modal title={t('pr.confirmPosted')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('pr.cancel')}</button><button className="btn primary" onClick={() => onDone(link.trim() || undefined)}>{t('pr.yesPosted')}</button></>}>
      <p>{t('pr.confirmText')}</p>
      <Field label={t('pr.permalink')}><input value={link} placeholder="https://www.instagram.com/p/…" onChange={(e) => setLink(e.target.value)} /></Field>
    </Modal>
  );
}

function StatsModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const { t } = useI18n();
  const last = post.stats?.[post.stats.length - 1];
  const [v, setV] = useState<Omit<PostStats, 'at'>>({ reach: last?.reach, views: last?.views, likes: last?.likes, comments: last?.comments, saves: last?.saves, shares: last?.shares });
  const keys = ['reach', 'views', 'likes', 'comments', 'saves', 'shares'] as const;
  return (
    <Modal title={t('pr.addStats')} onClose={onClose} footer={<button className="btn primary" onClick={async () => { await addStats(post, v); onClose(); }}>{t('pr.save')}</button>}>
      <div className="grid2">
        {keys.map((k) => (
          <Field key={k} label={t(`pr.stat.${k}` as Key)}>
            <input inputMode="numeric" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value === '' ? undefined : Number(e.target.value) || 0 })} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function VideoBrief({ post }: { post: Post }) {
  const { t } = useI18n();
  const toast = useToast();
  const [tool, setTool] = useState<'hyperframes' | 'remotion'>('hyperframes');
  const [template, setTemplate] = useState(post.kind === 'thank_you' ? 'thank_you' : post.kind === 'tonight' ? 'tonight' : 'countdown');
  const file = useRef<HTMLInputElement>(null);
  const jobs = useLiveQuery(() => db.videoJobs.where('postId').equals(post.id).toArray(), [post.id]) ?? [];
  const open = jobs.find((j) => j.status === 'brief' && !j.deletedAt);
  return (
    <div className="stack">
      <div className="grid2">
        <Field label={t('pr.tool')}>
          <select value={tool} onChange={(e) => setTool(e.target.value as typeof tool)}>
            <option value="hyperframes">HyperFrames</option>
            <option value="remotion">Remotion</option>
          </select>
        </Field>
        <Field label={t('pr.template')}>
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {['countdown', 'tonight', 'thank_you', 'aftermovie'].map((x) => <option key={x} value={x}>{t(`pr.tpl.${x}` as Key)}</option>)}
          </select>
        </Field>
      </div>
      <button className="btn" onClick={async () => { await exportVideoBrief(post, tool, template); toast(t('pr.briefSaved')); }}>{t('pr.exportBrief')}</button>
      {open && (
        <>
          <button className="btn" onClick={() => file.current?.click()}>{t('pr.attachRender')}</button>
          <input ref={file} type="file" accept="video/*,image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            await attachRender(open, f);
            toast(t('pr.renderAttached'));
          }} />
        </>
      )}
    </div>
  );
}
