import { useState } from 'react';
import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Field, Section } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { EPK_SECTIONS, type Epk, type EpkLangText, type EpkSection, type Lang, type MediaAsset } from '../../../core/types';
import { useGigs, useVenues } from '../../bookings/data';
import { useMedia } from '../../promo/data';
import { Thumb } from '../../promo/components';
import { approveReview, updateEpk, useReviews } from '../data';
import { pastGigs } from '../domain/epk';

type Tab = 'text' | 'media' | 'reviews' | 'gigs' | 'site';

export default function Editor({ epk }: { epk: Epk }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('text');
  const tabs: Tab[] = ['text', 'media', 'reviews', 'gigs', 'site'];
  return (
    <div>
      <div className="page-head"><h1>{t('app.presskit')}</h1></div>
      <p className="small muted">{t('pk.help')}</p>
      <div className="tabs" role="tablist">
        {tabs.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{t(`pk.tab.${x}` as Key)}</button>)}
      </div>
      {tab === 'text' && <Texts epk={epk} />}
      {tab === 'media' && <MediaPicks epk={epk} />}
      {tab === 'reviews' && <Reviews epk={epk} />}
      {tab === 'gigs' && <Gigs epk={epk} />}
      {tab === 'site' && <Site epk={epk} />}
    </div>
  );
}

function Texts({ epk }: { epk: Epk }) {
  const { t } = useI18n();
  const setLang = (lang: Lang, c: Partial<EpkLangText>) => updateEpk({ [lang]: { ...epk[lang], ...c } } as Partial<Epk>);
  const toggle = (s: EpkSection) => updateEpk({ sections: epk.sections.includes(s) ? epk.sections.filter((x) => x !== s) : EPK_SECTIONS.filter((x) => x === s || epk.sections.includes(x)) });
  const move = (s: EpkSection, d: -1 | 1) => {
    const arr = [...epk.sections]; const i = arr.indexOf(s); const j = i + d;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]]; updateEpk({ sections: arr });
  };
  return (
    <>
      <div className="grid2">
        {(['nl', 'en'] as const).map((lang) => (
          <Section key={lang} title={lang === 'nl' ? 'Nederlands' : 'English'}>
            <Field label={t('pk.seoTitle')}><input value={epk[lang].seoTitle} onChange={(e) => setLang(lang, { seoTitle: e.target.value })} /></Field>
            <Field label={t('pk.bioShort')} hint={`${epk[lang].bioShort.length}/300`}><textarea rows={3} value={epk[lang].bioShort} onChange={(e) => setLang(lang, { bioShort: e.target.value })} /></Field>
            <Field label={t('pk.bioLong')}><textarea rows={8} value={epk[lang].bioLong} onChange={(e) => setLang(lang, { bioLong: e.target.value })} /></Field>
            <Field label={t('pk.quote')}><input value={epk[lang].quote ?? ''} onChange={(e) => setLang(lang, { quote: e.target.value })} /></Field>
            <Field label={t('pk.rider')} hint={t('pk.riderHint')}><textarea rows={4} value={epk[lang].riderSummary} onChange={(e) => setLang(lang, { riderSummary: e.target.value })} /></Field>
          </Section>
        ))}
      </div>
      <Section title={t('pk.sections')}>
        <div className="list">
          {[...epk.sections, ...EPK_SECTIONS.filter((s) => !epk.sections.includes(s))].map((s) => (
            <div key={s} className="list-item row between">
              <label className="check"><input type="checkbox" checked={epk.sections.includes(s)} onChange={() => toggle(s)} /> {t(`pk.sec.${s}` as Key)}</label>
              {epk.sections.includes(s) && <div className="row" style={{ gap: 4 }}>
                <button className="btn icon small ghost" aria-label={t('pk.up')} onClick={() => move(s, -1)}>↑</button>
                <button className="btn icon small ghost" aria-label={t('pk.down')} onClick={() => move(s, 1)}>↓</button>
              </div>}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function MediaPicks({ epk }: { epk: Epk }) {
  const { t } = useI18n();
  const media = useMedia();
  const pick = (field: 'photoIds' | 'logoIds' | 'mixIds' | 'videoIds', filter: (m: MediaAsset) => boolean, label: Key, help?: Key) => {
    const list = media.filter(filter);
    const sel = epk[field];
    const toggle = (id: string) => updateEpk({ [field]: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] } as Partial<Epk>);
    return (
      <Section title={t(label)}>
        {help && <p className="small muted">{t(help)}</p>}
        {list.length ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {list.map((m) => (
              <button key={m.id} className="btn ghost stack" style={{ padding: 2, gap: 2, outline: sel.includes(m.id) ? '2px solid var(--fq-accent)' : 'none' }} aria-pressed={sel.includes(m.id)} onClick={() => toggle(m.id)}>
                {m.blob ? <Thumb m={m} size={96} /> : <span className="small" style={{ padding: 'var(--s2)' }}>{m.title}</span>}
                {m.blob && m.usage !== 'press_ok' && <span className="tiny" style={{ color: 'var(--warning)' }}>{t('pk.notPress')}</span>}
              </button>
            ))}
          </div>
        ) : <Empty>{t('pk.noneInLibrary')}</Empty>}
      </Section>
    );
  };
  return (
    <>
      {pick('photoIds', (m) => m.kind === 'photo' && !!m.blob, 'pk.photos', 'pk.photosHelp')}
      {pick('logoIds', (m) => m.kind === 'logo' && !!m.blob, 'pk.logos')}
      {pick('mixIds', (m) => !!m.externalUrl && m.kind === 'audio', 'pk.mixes', 'pk.linksHelp')}
      {pick('videoIds', (m) => !!m.externalUrl && m.kind === 'video', 'pk.videos', 'pk.linksHelp')}
    </>
  );
}

function Reviews({ epk }: { epk: Epk }) {
  const { t, lang } = useI18n();
  const gigs = new Map(useGigs().map((g) => [g.id, g]));
  const reviews = useReviews().filter((r) => r.text?.trim()).sort((a, b) => (b.receivedAt ?? b.createdAt).localeCompare(a.receivedAt ?? a.createdAt));
  const sel = epk.reviewIds;
  return (
    <Section title={t('pk.reviews')}>
      <p className="small muted">{t('pk.reviewsHelp')}</p>
      {reviews.length ? (
        <div className="list">
          {reviews.map((r) => {
            const g = gigs.get(r.gigId);
            const allowed = !!r.mayPublish;
            return (
              <div key={r.id} className="list-item stack" style={{ gap: 4 }}>
                <div className="small">“{r.text}”{r.rating ? ` · ${'★'.repeat(r.rating)}` : ''}</div>
                <div className="tiny muted">{g ? `${fmtDate(g.date, lang)} · ${g.title}` : ''}{r.displayName ? ` · ${r.displayName}${r.mayUseName ? '' : ` (${t('pk.noName')})`}` : ''}</div>
                {!allowed ? <div className="tiny" style={{ color: 'var(--warning)' }}>{t('pk.noPermission')}</div> : (
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <label className="check"><input type="checkbox" checked={!!r.approvedAt} onChange={(e) => approveReview(r, e.target.checked)} /> {t('pk.approved')}</label>
                    <label className="check"><input type="checkbox" disabled={!r.approvedAt} checked={sel.includes(r.id)} onChange={() => updateEpk({ reviewIds: sel.includes(r.id) ? sel.filter((x) => x !== r.id) : [...sel, r.id] })} /> {t('pk.onPage')}</label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <Empty>{t('pk.noReviews')}</Empty>}
    </Section>
  );
}

function Gigs({ epk }: { epk: Epk }) {
  const { t, lang } = useI18n();
  const gigs = useGigs();
  const venues = useVenues();
  const all = pastGigs(gigs, venues, []);
  return (
    <Section title={t('pk.pastGigs')}>
      <p className="small muted">{t('pk.gigsHelp', { n: all.privateCount })}</p>
      {all.list.length ? (
        <div className="list">
          {all.list.map((g) => {
            const id = g.id;
            const hidden = epk.hiddenGigIds.includes(id);
            return (
              <label key={id} className="list-item check">
                <input type="checkbox" checked={!hidden} onChange={() => updateEpk({ hiddenGigIds: hidden ? epk.hiddenGigIds.filter((x) => x !== id) : [...epk.hiddenGigIds, id] })} />
                <span>{fmtDate(g.date, lang)} · {g.title}{g.city ? `, ${g.city}` : ''}</span>
              </label>
            );
          })}
        </div>
      ) : <Empty>{t('pk.noGigs')}</Empty>}
    </Section>
  );
}

function Site({ epk }: { epk: Epk }) {
  const { t } = useI18n();
  return (
    <Section title={t('pk.tab.site')}>
      <Field label={t('pk.siteBase')} hint={t('pk.siteBaseHint')}><input value={epk.siteBase} onChange={(e) => updateEpk({ siteBase: e.target.value.trim() })} /></Field>
      <Field label={t('pk.bookingEmail')}><input value={epk.bookingEmail} onChange={(e) => updateEpk({ bookingEmail: e.target.value.trim() })} /></Field>
      <Field label="Instagram" hint={t('pk.instaHint')}><input value={epk.instagram} onChange={(e) => updateEpk({ instagram: e.target.value.trim() })} /></Field>
    </Section>
  );
}
