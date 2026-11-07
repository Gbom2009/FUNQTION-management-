import { useMemo, useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Section, useToast } from '../../../core/ui';
import { save } from '../../../core/repo';
import type { Track } from '../../../core/types';
import { findDupes } from '../domain/dupes';
import { useLocations, useTrackFiles, useTracks } from '../data';
import TrackEditor from './TrackEditor';

/** Duplicates, missing files, low quality, unknown source, keys we're unsure about. */
export default function Problems() {
  const { t } = useI18n();
  const toast = useToast();
  const tracks = useTracks();
  const files = useTrackFiles();
  const locs = new Map(useLocations().map((l) => [l.id, l.name]));
  const [open, setOpen] = useState<Track | null>(null);
  const byId = new Map(tracks.map((x) => [x.id, x]));
  const dupes = useMemo(() => findDupes(tracks.filter((x) => x.status !== 'retired'), files), [tracks, files]);
  const missing = files.filter((f) => f.missing);
  const lowQ = files.filter((f) => !f.missing && (f.quality === 'low' || f.quality === 'transcode_suspect' || f.quality === 'broken'));
  const unsure = tracks.filter((x) => x.keyConfidence !== undefined && x.keyConfidence < 0.3);
  const noBpm = tracks.filter((x) => !x.stream && (!x.bpm || !x.key));
  const unknown = tracks.filter((x) => x.source === 'unknown');
  const label = (id: string) => { const x = byId.get(id); return x ? `${x.artist} – ${x.title}${x.mix ? ` (${x.mix})` : ''}` : id; };
  const row = (trackId: string, extra: string) => (
    <button key={trackId + extra} className="list-item" onClick={() => { const x = byId.get(trackId); if (x) setOpen(x); }}>
      <span className="grow">{label(trackId)}</span><span className="tiny muted">{extra}</span>
    </button>
  );

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="page-head"><h1>{t('lib.problems')}</h1></div>
      <Section title={`${t('lib.dupes')} (${dupes.length})`}>
        {dupes.slice(0, 100).map((g, i) => (
          <div key={i} className="card stack" style={{ gap: 'var(--s1)' }}>
            <div className="tiny muted">{t(`lib.dupe.${g.kind}` as never)}</div>
            {g.trackIds.map((id) => row(id, files.filter((f) => f.trackId === id).map((f) => `${f.format.toUpperCase()} ${f.bitrate ?? ''}${f.id === g.keepFileId ? ' ✓' : ''}`).join(', ')))}
            <button className="btn small" onClick={async () => {
              const keepTrack = files.find((f) => f.id === g.keepFileId)?.trackId;
              for (const id of g.trackIds) if (id !== keepTrack) { const x = byId.get(id); if (x) await save<Track>('musicTracks', { ...x, status: 'retired' }); }
              toast(t('lib.dupeResolved'));
            }}>{t('lib.keepBest')}</button>
          </div>
        ))}
        {!dupes.length && <p className="muted small">{t('lib.none')}</p>}
      </Section>
      <Section title={`${t('lib.missingFiles')} (${missing.length})`}>
        {missing.slice(0, 200).map((f) => row(f.trackId, `${locs.get(f.locationId) ?? '?'} · ${f.path}`))}
        {!missing.length && <p className="muted small">{t('lib.none')}</p>}
        {missing.length > 0 && <p className="tiny muted">{t('lib.missingHint')}</p>}
      </Section>
      <Section title={`${t('lib.lowQuality')} (${lowQ.length})`}>
        {lowQ.slice(0, 200).map((f) => row(f.trackId, `${t(`lib.q.${f.quality}` as never)} · ${f.format.toUpperCase()} ${f.bitrate ?? ''} kbps${f.cutoffHz ? ` · ${Math.round(f.cutoffHz / 100) / 10} kHz` : ''}`))}
        {!lowQ.length && <p className="muted small">{t('lib.none')}</p>}
      </Section>
      <Section title={`${t('lib.noAnalysis')} (${noBpm.length})`}>
        {noBpm.slice(0, 100).map((x) => row(x.id, `${x.bpm ?? '–'} · ${x.key ?? '–'}`))}
        {unsure.slice(0, 50).map((x) => row(x.id, `${x.key} ${t('lib.unsure')}`))}
      </Section>
      <Section title={`${t('lib.unknownSource')} (${unknown.length})`}>
        <p className="tiny muted">{t('lib.unknownSourceHint')}</p>
        {unknown.slice(0, 50).map((x) => row(x.id, ''))}
      </Section>
      {open && <TrackEditor track={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
