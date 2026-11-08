import { useLiveQuery } from 'dexie-react-hooks';
import { strToU8, zipSync } from 'fflate';
import { db } from '../../core/db';
import { alive, nowIso, patch, save } from '../../core/repo';
import { download } from '../../core/backup';
import type { Consent, Gig, MediaAsset, MemberId, Post, PostKind, PostStats, Settings, VideoJob } from '../../core/types';
import { compressImage, sha256 } from '../money/ocr';
import { defaultFormat, draftCaption, plannedFor, videoBrief, brandOf } from './domain/promo';

const EMPTY: never[] = [];
export const useMedia = () => alive(useLiveQuery(() => db.mediaAssets.toArray(), []) ?? EMPTY) as MediaAsset[];
export const usePosts = () => alive(useLiveQuery(() => db.posts.toArray(), []) ?? EMPTY) as Post[];
export const useConsents = () => alive(useLiveQuery(() => db.consents.toArray(), []) ?? EMPTY) as Consent[];
export const useVideoJobs = () => alive(useLiveQuery(() => db.videoJobs.toArray(), []) ?? EMPTY) as VideoJob[];

const urls = new Map<string, string>();
/** Object URL for a media file (cached for the session). */
export function mediaUrl(m?: MediaAsset): string | undefined {
  if (!m) return undefined;
  if (!m.blob) return m.externalUrl;
  const key = `${m.id}:${m.updatedAt}`;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(m.blob));
  return urls.get(key);
}

function kindOf(file: File): MediaAsset['kind'] {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.includes('font') || /\.(ttf|otf|woff2?)$/i.test(file.name)) return 'font';
  if (file.type === 'image/svg+xml' || /logo/i.test(file.name)) return 'logo';
  if (file.type.startsWith('image/')) return 'photo';
  return 'doc';
}

async function imageSize(blob: Blob): Promise<{ width?: number; height?: number }> {
  if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') return {};
  const bmp = await createImageBitmap(blob).catch(() => null);
  return bmp ? { width: bmp.width, height: bmp.height } : {};
}

/** Add files to the library. Photos are scaled to 2048 px; the same file twice is stored once. */
export async function addMediaFiles(files: File[], meta: Partial<MediaAsset> = {}): Promise<{ added: number; duplicates: number; ids: string[] }> {
  let added = 0, duplicates = 0;
  const ids: string[] = [];
  for (const f of files) {
    const kind = kindOf(f);
    const blob = kind === 'photo' ? await compressImage(f, 2048, 0.86) : f;
    const hash = await sha256(blob);
    if (await db.mediaAssets.where('sha256').equals(hash).filter((m) => !m.deletedAt).count()) { duplicates++; continue; }
    const row = await save<MediaAsset>('mediaAssets', {
      kind, title: f.name.replace(/\.[^.]+$/, ''), mime: blob.type || f.type || 'application/octet-stream', blob, sizeBytes: blob.size,
      ...(await imageSize(blob)), tags: [], people: kind === 'photo' || kind === 'video' ? 'crowd_unrecognisable' : 'none',
      usage: kind === 'logo' || kind === 'font' ? 'press_ok' : 'promo_ok', sha256: hash, takenAt: f.lastModified ? new Date(f.lastModified).toISOString().slice(0, 10) : undefined,
      ...meta,
    });
    ids.push(row.id);
    added++;
  }
  return { added, duplicates, ids };
}

export async function addMediaLink(url: string, title: string, kind: MediaAsset['kind'] = 'video') {
  return save<MediaAsset>('mediaAssets', { kind, title, mime: 'text/uri-list', externalUrl: url, tags: [], people: 'none', usage: 'press_ok' });
}

export async function settings(): Promise<Partial<Settings>> { return (await db.settings.get('settings')) ?? {}; }

/** Draft a generated post for a gig, with the gig's best promo photos attached. */
export async function createDraft(gig: Gig, kind: PostKind): Promise<Post> {
  const s = await settings();
  const venue = gig.venueId ? await db.venues.get(gig.venueId) : undefined;
  const photos = (await db.mediaAssets.where('gigId').equals(gig.id).toArray()).filter((m) => !m.deletedAt && m.usage !== 'internal' && (m.kind === 'photo' || m.kind === 'video'));
  const brand = brandOf(s);
  return save<Post>('posts', {
    gigId: gig.id, kind, format: defaultFormat(kind), status: 'draft',
    plannedAt: plannedFor(kind, gig, s),
    captionNl: draftCaption({ gig, venue, settings: s, kind, lang: 'nl' }),
    captionEn: draftCaption({ gig, venue, settings: s, kind, lang: 'en' }),
    hashtags: [...brand.hashtags],
    mediaIds: photos.slice(0, kind === 'thank_you' ? 10 : 1).map((m) => m.id),
  });
}

export async function newPost(): Promise<Post> {
  const s = await settings();
  return save<Post>('posts', { kind: 'other', format: 'feed', status: 'idea', captionNl: '', hashtags: [...brandOf(s).hashtags], mediaIds: [] });
}

/** Gijs's rule: a post only counts as published when a person confirms it. */
export async function confirmPosted(post: Post, me: MemberId, permalink?: string) {
  return patch<Post>('posts', post.id, { status: 'published', confirmedBy: me, confirmedAt: nowIso(), permalink: permalink || post.permalink });
}

export async function addStats(post: Post, s: Omit<PostStats, 'at'>) {
  return patch<Post>('posts', post.id, { stats: [...(post.stats ?? []), { ...s, at: nowIso() }] });
}

/** Photo opt-out ticked by the client when signing the contract for this gig. */
export async function photoOptOutFor(gigId?: string): Promise<boolean> {
  if (!gigId) return false;
  const contracts = await db.contracts.where('gigId').equals(gigId).toArray();
  for (const c of contracts) {
    const sigs = await db.contractSignatures.filter((s) => s.contractId === c.id && s.party === 'client' && !s.deletedAt).toArray();
    if (sigs.some((s) => s.consents?.photoOptOut)) return true;
  }
  return false;
}

export async function addConsent(c: Omit<Consent, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'at'> & { at?: string }) {
  return save<Consent>('consents', { ...c, at: c.at ?? nowIso() });
}
export async function withdrawConsent(id: string) {
  return patch<Consent>('consents', id, { withdrawnAt: nowIso() });
}

/** ZIP with brief.json, brief.md and the media files: hand it to Claude Code with HyperFrames or Remotion. */
export async function exportVideoBrief(post: Post, tool: 'hyperframes' | 'remotion', template: string) {
  const s = await settings();
  const gig = post.gigId ? await db.gigs.get(post.gigId) : undefined;
  const venue = gig?.venueId ? await db.venues.get(gig.venueId) : undefined;
  const media = (await db.mediaAssets.bulkGet(post.mediaIds)).filter((m): m is MediaAsset => !!m);
  const brief = videoBrief(post, gig, venue, media, s, tool, template);
  const files: Record<string, Uint8Array> = {
    'brief.json': strToU8(JSON.stringify(brief, null, 2)),
    'brief.md': strToU8(`# Video brief: ${template} (${tool})\n\n${brief.instructions}\n\n## Caption\n\n${brief.caption}\n\nZie brief.json voor de details.\n`),
  };
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    if (m.blob) files[brief.media[i].file] = new Uint8Array(await m.blob.arrayBuffer());
  }
  const logo = (await db.mediaAssets.where('kind').equals('logo').toArray()).find((m) => !m.deletedAt && m.blob);
  if (logo?.blob) files['logo.png'] = new Uint8Array(await logo.blob.arrayBuffer());
  await save<VideoJob>('videoJobs', { postId: post.id, gigId: post.gigId, engine: tool, template, status: 'brief' });
  download(`video-brief-${template}-${post.id.slice(0, 6)}.zip`, zipSync(files), 'application/zip');
}

/** The rendered MP4 comes back: store it and attach it to the post. */
export async function attachRender(job: VideoJob, file: File) {
  const post = job.postId ? await db.posts.get(job.postId) : undefined;
  const res = await addMediaFiles([file], { gigId: job.gigId, usage: 'promo_ok', tags: ['render', job.template] });
  const id = res.ids[0];
  if (id) {
    await patch<VideoJob>('videoJobs', job.id, { status: 'done', outputMediaId: id });
    if (post) await patch<Post>('posts', post.id, { mediaIds: [id, ...post.mediaIds.filter((x) => x !== id)] });
  }
  return res;
}

/** Share media + caption to Instagram via the phone's share sheet (falls back to downloads). */
export async function shareToInstagram(post: Post, caption: string): Promise<'shared' | 'downloaded'> {
  const media = (await db.mediaAssets.bulkGet(post.mediaIds)).filter((m): m is MediaAsset => !!m?.blob);
  const files = media.map((m, i) => new File([m.blob!], `funqtion-${i + 1}.${(m.mime.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')}`, { type: m.mime }));
  try { await navigator.clipboard?.writeText(caption); } catch { /* not allowed */ }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (files.length && nav.canShare?.({ files })) {
    try { await navigator.share({ files, text: caption }); return 'shared'; } catch { /* cancelled */ }
  }
  for (const f of files) download(f.name, f, f.type);
  return 'downloaded';
}
