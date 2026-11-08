import { useI18n } from '../../core/i18n';
import type { MediaAsset, Post } from '../../core/types';
import { mediaUrl } from './data';
import { postState, type PostState } from './domain/promo';

const COLOR: Record<PostState, string> = {
  idea: 'var(--st-enquiry)', draft: 'var(--st-option)', ready: 'var(--st-quote_sent)', due: 'var(--danger)', published: 'var(--st-confirmed)', skipped: 'var(--fq-text-dim)',
};

export function PostPill({ post }: { post: Post }) {
  const { t } = useI18n();
  const s = postState(post);
  return <span className="pill" style={{ color: COLOR[s], borderColor: COLOR[s] }}>{t(`pr.state.${s}` as never)}</span>;
}

export function Thumb({ m, size = 96 }: { m?: MediaAsset; size?: number }) {
  if (!m) return <div className="thumb" style={{ width: size, height: size }} />;
  const url = mediaUrl(m);
  const style = { width: size, height: size, objectFit: 'cover' as const, display: 'block', border: 'var(--fq-rule)' };
  if (m.kind === 'video' && m.blob) return <video src={url} style={style} muted playsInline preload="metadata" />;
  if ((m.kind === 'photo' || m.kind === 'logo') && url) return <img src={url} alt={m.title} style={style} loading="lazy" />;
  return <div className="thumb tiny muted" style={{ ...style, display: 'grid', placeItems: 'center', padding: 4, textAlign: 'center', overflow: 'hidden' }}>{m.kind}<br />{m.title}</div>;
}
