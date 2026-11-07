import { useMemo, useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Modal, useToast } from '../../../core/ui';
import { CROWD_TYPES, TRACK_SOURCES, type CrowdType, type Track, type TrackFile } from '../../../core/types';
import { keyScore } from '../domain/keys';
import { addStreamTrack, useLocations, useTrackFiles, useTracks } from '../data';
import { Art, EnergyBar, fmtDur, KeyChip, SourceBadge } from '../components';
import TrackEditor from './TrackEditor';

export interface TrackFilter {
  q: string;
  crowd?: CrowdType;
  energyMin: number;
  energyMax: number;
  bpmMin?: number;
  bpmMax?: number;
  compatibleWith?: string;   // Camelot key
  source?: Track['source'];
  status?: Track['status'];
  locationId?: string;
}
export const EMPTY_FILTER: TrackFilter = { q: '', energyMin: 1, energyMax: 10 };

/** Pure filter used by the collection and the set planner. */
export function filterTracks(tracks: Track[], f: TrackFilter, filesByTrack?: Map<string, TrackFile[]>): Track[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return tracks.filter((t) => {
    if (t.status === 'retired') return false;
    if (words.length) {
      const hay = `${t.artist} ${t.title} ${t.mix ?? ''} ${t.genre ?? ''} ${t.label ?? ''} ${t.comment ?? ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (f.crowd && !t.crowd.includes(f.crowd)) return false;
    if ((f.energyMin > 1 || f.energyMax < 10) && (t.energy === undefined || t.energy < f.energyMin || t.energy > f.energyMax)) return false;
    if (f.bpmMin && (!t.bpm || t.bpm < f.bpmMin)) return false;
    if (f.bpmMax && (!t.bpm || t.bpm > f.bpmMax)) return false;
    if (f.compatibleWith && keyScore(f.compatibleWith, t.key) < 0.85) return false;
    if (f.source && t.source !== f.source) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.locationId && !filesByTrack?.get(t.id)?.some((x) => x.locationId === f.locationId && !x.missing)) return false;
    return true;
  });
}

export function sortTracks(list: Track[], by: 'artist' | 'title' | 'bpm' | 'key' | 'energy' | 'added') {
  const s = [...list];
  const cmp: Record<typeof by, (a: Track, b: Track) => number> = {
    artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    title: (a, b) => a.title.localeCompare(b.title),
    bpm: (a, b) => (a.bpm ?? 999) - (b.bpm ?? 999),
    key: (a, b) => (parseInt(a.key ?? '99') - parseInt(b.key ?? '99')) || (a.key ?? '').localeCompare(b.key ?? ''),
    energy: (a, b) => (b.energy ?? 0) - (a.energy ?? 0),
    added: (a, b) => b.createdAt.localeCompare(a.createdAt),
  };
  return s.sort(cmp[by]);
}

const PAGE = 150;

export default function Collection({ statusOnly }: { statusOnly?: Track['status'] }) {
  const { t } = useI18n();
  const tracks = useTracks();
  const files = useTrackFiles();
  const locs = useLocations();
  const [f, setF] = useState<TrackFilter>({ ...EMPTY_FILTER, status: statusOnly });
  const [sort, setSort] = useState<'artist' | 'title' | 'bpm' | 'key' | 'energy' | 'added'>(statusOnly ? 'added' : 'artist');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Track | null>(null);
  const [stream, setStream] = useState(false);
  const byTrack = useMemo(() => { const m = new Map<string, TrackFile[]>(); for (const x of files) m.set(x.trackId, [...(m.get(x.trackId) ?? []), x]); return m; }, [files]);
  const locName = new Map(locs.map((l) => [l.id, l.name]));
  const list = useMemo(() => sortTracks(filterTracks(tracks, f, byTrack), sort), [tracks, f, byTrack, sort]);
  const up = (p: Partial<TrackFilter>) => { setF({ ...f, ...p }); setLimit(PAGE); };

  return (
    <div>
      <div className="page-head row between">
        <h1>{statusOnly === 'inbox' ? t('lib.inbox') : t('lib.collection')}</h1>
        <span className="muted small">{list.length} / {tracks.length}</span>
      </div>
      <div className="lib-filters">
        <input className="grow" placeholder={t('lib.search')} value={f.q} onChange={(e) => up({ q: e.target.value })} />
        <select value={f.crowd ?? ''} onChange={(e) => up({ crowd: (e.target.value || undefined) as CrowdType })}>
          <option value="">{t('lib.allCrowds')}</option>{CROWD_TYPES.map((c) => <option key={c} value={c}>{t(`lib.crowd.${c}` as never)}</option>)}
        </select>
        <input inputMode="numeric" placeholder="BPM ≥" style={{ width: 80 }} value={f.bpmMin ?? ''} onChange={(e) => up({ bpmMin: Number(e.target.value) || undefined })} />
        <input inputMode="numeric" placeholder="BPM ≤" style={{ width: 80 }} value={f.bpmMax ?? ''} onChange={(e) => up({ bpmMax: Number(e.target.value) || undefined })} />
        <input placeholder={t('lib.fitsKey')} style={{ width: 90 }} value={f.compatibleWith ?? ''} onChange={(e) => up({ compatibleWith: e.target.value.toUpperCase() || undefined })} />
        <select value={`${f.energyMin}-${f.energyMax}`} onChange={(e) => { const [a, b] = e.target.value.split('-').map(Number); up({ energyMin: a, energyMax: b }); }}>
          <option value="1-10">{t('lib.anyEnergy')}</option><option value="1-3">E1–3</option><option value="4-6">E4–6</option><option value="7-8">E7–8</option><option value="9-10">E9–10</option>
        </select>
        <select value={f.source ?? ''} onChange={(e) => up({ source: (e.target.value || undefined) as Track['source'] })}>
          <option value="">{t('lib.anySource')}</option>{TRACK_SOURCES.map((s) => <option key={s} value={s}>{t(`lib.source.${s}` as never)}</option>)}
        </select>
        <select value={f.locationId ?? ''} onChange={(e) => up({ locationId: e.target.value || undefined })}>
          <option value="">{t('lib.anyLocation')}</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          {(['artist', 'title', 'bpm', 'key', 'energy', 'added'] as const).map((s) => <option key={s} value={s}>{t(`lib.sort.${s}` as never)}</option>)}
        </select>
        <button className="btn small ghost" onClick={() => setStream(true)}>+ {t('lib.addStream')}</button>
      </div>
      {!tracks.length ? <Empty>{t('lib.empty')}</Empty> : (
        <div className="lib-table" role="table">
          {list.slice(0, limit).map((tr) => {
            const fs = byTrack.get(tr.id) ?? [];
            const where = [...new Set(fs.filter((x) => !x.missing).map((x) => locName.get(x.locationId) ?? '?'))];
            const bad = fs.find((x) => x.quality !== 'ok' && x.quality !== 'unknown');
            return (
              <button key={tr.id} className="lib-row" role="row" onClick={() => setOpen(tr)}>
                <Art id={tr.artworkId} />
                <span className="lib-main"><span className="strong">{tr.title}{tr.mix ? <span className="muted"> ({tr.mix})</span> : null}</span><span className="muted small">{tr.artist}</span></span>
                <span className="mono-num lib-bpm">{tr.bpm ? Math.round(tr.bpm) : '–'}</span>
                <KeyChip k={tr.key} />
                <EnergyBar e={tr.energy} />
                <span className="lib-tags tiny">{[...tr.crowd.map((c) => t(`lib.crowd.${c}` as never)), ...tr.flags.map((x) => t(`lib.flag.${x}` as never))].join(' · ')}</span>
                <span className="tiny muted lib-where">{tr.stream ? '☁ ' + tr.stream.service : where.join(', ') || t('lib.noFiles')}</span>
                <span className="lib-icons"><SourceBadge s={tr.source} />{bad ? <span className="danger-text" title={t(`lib.q.${bad.quality}` as never)}>!</span> : null}<span className="tiny muted">{fmtDur(tr.durationS)}</span></span>
              </button>
            );
          })}
          {list.length > limit && <button className="btn ghost" onClick={() => setLimit(limit + PAGE * 2)}>{t('lib.more', { n: list.length - limit })}</button>}
        </div>
      )}
      {open && <TrackEditor track={open} onClose={() => setOpen(null)} />}
      {stream && <StreamModal onClose={() => setStream(false)} />}
    </div>
  );
}

function StreamModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { me } = useSession();
  const [p, setP] = useState({ artist: '', title: '', mix: '', service: 'Beatport', bpm: '', key: '' });
  const f = (k: keyof typeof p, label: string) => <label className="field"><span>{label}</span><input value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>;
  return (
    <Modal title={t('lib.addStream')} onClose={onClose} footer={<button className="btn primary" disabled={!p.artist || !p.title} onClick={async () => {
      await addStreamTrack({ ...p, mix: p.mix || undefined, bpm: Number(p.bpm) || undefined, key: p.key || undefined }, me?.id ?? 'gijs');
      toast(t('common.saved')); onClose();
    }}>{t('common.save')}</button>}>
      <p className="tiny muted">{t('lib.streamHint')}</p>
      {f('artist', t('lib.artist'))}{f('title', t('lib.title'))}{f('mix', t('lib.mix'))}
      <label className="field"><span>{t('lib.service')}</span>
        <select value={p.service} onChange={(e) => setP({ ...p, service: e.target.value })}>{['Beatport', 'Beatsource', 'SoundCloud', 'TIDAL', 'Apple Music', 'Spotify'].map((s) => <option key={s}>{s}</option>)}</select>
      </label>
      <div className="grid2">{f('bpm', 'BPM')}{f('key', t('lib.key'))}</div>
    </Modal>
  );
}
