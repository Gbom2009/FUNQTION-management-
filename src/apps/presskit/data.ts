import { useLiveQuery } from 'dexie-react-hooks';
import { strToU8, zipSync } from 'fflate';
import { db } from '../../core/db';
import { alive, nowIso, patch, save } from '../../core/repo';
import { download } from '../../core/backup';
import type { Epk, EpkPublish, Review } from '../../core/types';
import { todayStr } from '../../core/dates';
import { defaultEpk, EPK_ID, planPublish, sitemap, type EpkInput } from './domain/epk';
import { epkPdf } from './domain/pdf';

const EMPTY: never[] = [];
export const useEpk = () => useLiveQuery(() => db.epk.get(EPK_ID), []);
export const useReviews = () => alive(useLiveQuery(() => db.reviews.toArray(), []) ?? EMPTY) as Review[];
export const usePublishes = () => (alive(useLiveQuery(() => db.epkPublishes.toArray(), []) ?? EMPTY) as EpkPublish[]).sort((a, b) => b.at.localeCompare(a.at));

export async function ensureEpk(): Promise<Epk> {
  return (await db.epk.get(EPK_ID)) ?? save<Epk>('epk', { ...defaultEpk(), id: EPK_ID });
}
export const updateEpk = (c: Partial<Epk>) => patch<Epk>('epk', EPK_ID, c);

export async function epkInput(): Promise<EpkInput> {
  const epk = await ensureEpk();
  return {
    epk,
    media: alive(await db.mediaAssets.toArray()),
    reviews: alive(await db.reviews.toArray()),
    gigs: alive(await db.gigs.toArray()),
    venues: alive(await db.venues.toArray()),
  };
}

const LOGO_ZIP = 'presskit/funqtion-logos.zip';
const PDF = 'presskit/funqtion-presskit-{lang}.pdf';

async function dataUrl(b: Blob): Promise<string> {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
}

export async function makePdf(input: EpkInput, lang: 'nl' | 'en'): Promise<Blob> {
  const { pdfBlob, paperLogoSvg } = await import('../invoicing/pdf');
  const photos = await Promise.all(input.epk.photoIds.slice(0, 2).map((id) => input.media.find((m) => m.id === id)).filter((m) => m?.blob && /jpe?g|png/.test(m.mime)).map((m) => dataUrl(m!.blob!)));
  return pdfBlob(epkPdf(input, lang, { logoSvg: paperLogoSvg, photos }));
}

/**
 * Everything for funqtion-site in one ZIP: unpack it in the root of that repo
 * (it only adds presskit/, en/presskit/, sitemap.xml and robots.txt) and push.
 */
export async function publishZip(): Promise<{ files: string[]; version: number }> {
  const input = await epkInput();
  const plan = planPublish(input, { logoZip: 'funqtion-logos.zip', pdf: 'funqtion-presskit-{lang}.pdf' });
  const files: Record<string, Uint8Array> = {};
  for (const [path, html] of Object.entries(plan.pages)) files[path] = strToU8(html);
  for (const p of plan.photos) files[`presskit/media/${p.file}`] = new Uint8Array(await p.m.blob!.arrayBuffer());
  if (plan.logos.length) {
    const logos: Record<string, Uint8Array> = {};
    for (const l of plan.logos) logos[l.file] = new Uint8Array(await l.m.blob!.arrayBuffer());
    files[LOGO_ZIP] = zipSync(logos);
  }
  for (const lang of ['nl', 'en'] as const) files[PDF.replace('{lang}', lang)] = new Uint8Array(await (await makePdf(input, lang)).arrayBuffer());
  files['sitemap.xml'] = strToU8(sitemap(input.epk.siteBase, todayStr()));
  files['robots.txt'] = strToU8(`User-agent: *\nAllow: /\n\nSitemap: ${input.epk.siteBase.replace(/\/?$/, '/')}sitemap.xml\n`);
  const version = (input.epk.version ?? 0) + 1;
  const names = Object.keys(files).sort();
  download(`funqtion-site-presskit-v${version}.zip`, zipSync(files, { level: 6 }), 'application/zip');
  await save<EpkPublish>('epkPublishes', { at: nowIso(), version, files: names, snapshot: JSON.stringify(input.epk) });
  await updateEpk({ version, publishedAt: nowIso() });
  return { files: names, version };
}

/** Restore the texts and picks of an earlier version (the next publish writes them out again). */
export async function restorePublish(p: EpkPublish) {
  const old = JSON.parse(p.snapshot) as Epk;
  const { id: _id, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, version: _v, publishedAt: _p, ...rest } = old;
  await updateEpk(rest);
}

export async function approveReview(r: Review, approve: boolean) {
  return patch<Review>('reviews', r.id, { approvedAt: approve ? nowIso() : undefined });
}
