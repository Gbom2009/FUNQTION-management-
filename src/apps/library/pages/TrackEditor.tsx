import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { alive, save, softDelete } from '../../../core/repo';
import { useI18n } from '../../../core/i18n';
import { Chips, Modal, useToast } from '../../../core/ui';
import { CROWD_TYPES, MOODS, TRACK_FLAGS, TRACK_SOURCES, type CueNote, type MusicLocation, type Track, type TrackFile } from '../../../core/types';
import { toCamelot } from '../domain/keys';
import { cleanFields } from '../domain/names';
import { newCueId, writeTags } from '../data';
import { Art, fmtDur, KeyChip, sourceFor } from '../components';

/** Edit one track: tags, our tags, cue notes, source, its files and play history. */
export default function TrackEditor({ track, onClose }: { track: Track; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<Track>(track);
  const files = (useLiveQuery(() => db.trackFiles.where('trackId').equals(track.id).toArray(), [track.id]) ?? []).filter((f) => !f.deletedAt);
  const locs = new Map(((useLiveQuery(() => db.musicLocations.toArray(), []) ?? []) as MusicLocation[]).map((l) => [l.id, l]));
  const plays = useLiveQuery(async () => alive(await db.plays.where('trackId').equals(track.id).toArray()), [track.id]) ?? [];
  const up = (p: Partial<Track>) => setD({ ...d, ...p });
  const toggle = <K extends 'crowd' | 'moods' | 'flags'>(k: K, v: Track[K][number]) => up({ [k]: (d[k] as string[]).includes(v) ? (d[k] as string[]).filter((x) => x !== v) : [...(d[k] as string[]), v] } as Partial<Track>);
  const suggestion = cleanFields({ artist: track.artist, title: track.mix ? `${track.title} (${track.mix})` : track.title }, files[0]?.path ?? '');
  const differs = suggestion.artist !== d.artist || suggestion.title !== d.title || (suggestion.mix ?? '') !== (d.mix ?? '');

  const doSave = async (writeFiles: boolean) => {
    const saved = await save<Track>('musicTracks', { ...d, status: d.status === 'inbox' ? 'ok' : d.status });
    if (writeFiles) {
      let n = 0;
      for (const f of files.filter((x) => !x.missing)) {
        const loc = locs.get(f.locationId);
        const src = loc ? await sourceFor(loc) : null;
        if (src && (await writeTags(saved, f as TrackFile, src)) === 'ok') n++;
      }
      toast(t('lib.tagsWritten', { n }));
    } else toast(t('common.saved'));
    onClose();
  };

  const cue = (c: CueNote, p: Partial<CueNote>) => up({ cueNotes: d.cueNotes.map((x) => (x.id === c.id ? { ...x, ...p } : x)) });

  return (
    <Modal title={`${track.artist} – ${track.title}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={() => void softDelete('musicTracks', track.id).then(onClose)}>{t('lib.retire')}</button>
      <button className="btn" onClick={() => void doSave(false)}>{t('common.save')}</button>
      <button className="btn primary" disabled={!files.some((f) => !f.missing && f.format === 'mp3')} onClick={() => void doSave(true)}>{t('lib.saveAndWrite')}</button>
    </>}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Art id={track.artworkId} size={72} />
        <div className="grow tiny muted">
          {fmtDur(d.durationS)} · {d.bpm ?? '–'} BPM · <KeyChip k={d.key} />{d.keyConfidence !== undefined && d.keyConfidence < 0.3 ? ` (${t('lib.unsure')})` : ''}
          {track.hotCues?.length ? <div>{t('lib.hotCues')}: {track.hotCues.map((c) => `${String.fromCharCode(65 + c.index)} ${fmtDur(c.atMs / 1000)}${c.name ? ` ${c.name}` : ''}`).join(' · ')}</div> : null}
        </div>
      </div>
      {differs && (
        <div className="banner"><div className="txt">{t('lib.suggest')}: <strong>{suggestion.artist} – {suggestion.title}{suggestion.mix ? ` (${suggestion.mix})` : ''}</strong></div>
          <button className="btn small" onClick={() => up({ artist: suggestion.artist, title: suggestion.title, mix: suggestion.mix })}>{t('lib.apply')}</button></div>
      )}
      <div className="grid2">
        <label className="field"><span>{t('lib.artist')}</span><input value={d.artist} onChange={(e) => up({ artist: e.target.value })} /></label>
        <label className="field"><span>{t('lib.title')}</span><input value={d.title} onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="field"><span>{t('lib.mix')}</span><input value={d.mix ?? ''} onChange={(e) => up({ mix: e.target.value || undefined })} placeholder="Extended Mix" /></label>
        <label className="field"><span>{t('lib.genre')}</span><input value={d.genre ?? ''} onChange={(e) => up({ genre: e.target.value || undefined })} /></label>
        <label className="field"><span>BPM</span><input inputMode="decimal" value={d.bpm ?? ''} onChange={(e) => up({ bpm: Number(e.target.value.replace(',', '.')) || undefined })} /></label>
        <label className="field"><span>{t('lib.key')}</span><input value={d.key ?? ''} onChange={(e) => up({ key: toCamelot(e.target.value) ?? e.target.value })} placeholder="8A / Am" /></label>
        <label className="field"><span>{t('lib.label')}</span><input value={d.label ?? ''} onChange={(e) => up({ label: e.target.value || undefined })} /></label>
        <label className="field"><span>{t('lib.year')}</span><input inputMode="numeric" value={d.year ?? ''} onChange={(e) => up({ year: Number(e.target.value) || undefined })} /></label>
      </div>
      <label className="field"><span>{t('lib.energy')}: {d.energy ?? '–'}</span><input type="range" min={1} max={10} value={d.energy ?? 5} onChange={(e) => up({ energy: Number(e.target.value) })} /></label>
      <Chips multi label={t('lib.crowd')} value={d.crowd} onChange={(v) => toggle('crowd', v)} options={CROWD_TYPES.map((c) => ({ value: c, label: t(`lib.crowd.${c}` as never) }))} />
      <Chips multi label={t('lib.mood')} value={d.moods} onChange={(v) => toggle('moods', v)} options={MOODS.map((c) => ({ value: c, label: t(`lib.mood.${c}` as never) }))} />
      <Chips multi label={t('lib.flags')} value={d.flags} onChange={(v) => toggle('flags', v)} options={TRACK_FLAGS.map((c) => ({ value: c, label: t(`lib.flag.${c}` as never) }))} />
      <Chips label={t('lib.vocal')} value={d.vocal ?? ('' as never)} onChange={(v) => up({ vocal: v })} options={(['vocal', 'instrumental', 'acapella'] as const).map((v) => ({ value: v, label: t(`lib.vocal.${v}` as never) }))} />
      <label className="field"><span>{t('lib.rating')}</span>
        <div className="row">{[1, 2, 3, 4, 5].map((r) => <button key={r} className="chip" aria-pressed={(d.rating ?? 0) >= r} onClick={() => up({ rating: d.rating === r ? undefined : r })}>★</button>)}</div>
      </label>
      <label className="field"><span>{t('lib.comment')}</span><input value={d.comment ?? ''} onChange={(e) => up({ comment: e.target.value || undefined })} /></label>

      <div className="field"><span>{t('lib.cueNotes')}</span>
        {d.cueNotes.map((c) => (
          <div key={c.id} className="row">
            <select value={c.kind} onChange={(e) => cue(c, { kind: e.target.value as CueNote['kind'] })}>
              {(['drop', 'mix_in', 'mix_out', 'break', 'vocal_in', 'warning', 'tip'] as const).map((k) => <option key={k} value={k}>{t(`lib.cue.${k}` as never)}</option>)}
            </select>
            <input style={{ width: 70 }} placeholder="1:04" value={c.atS !== undefined ? fmtDur(c.atS) : ''} onChange={(e) => { const m = /^(\d+):(\d{1,2})$/.exec(e.target.value); cue(c, { atS: m ? Number(m[1]) * 60 + Number(m[2]) : undefined }); }} />
            <input className="grow" value={c.text} onChange={(e) => cue(c, { text: e.target.value })} placeholder={t('lib.cueHint')} />
            <button className="btn small ghost" onClick={() => up({ cueNotes: d.cueNotes.filter((x) => x.id !== c.id) })}>✕</button>
          </div>
        ))}
        <button className="btn small ghost" onClick={() => up({ cueNotes: [...d.cueNotes, { id: newCueId(), kind: 'tip', text: '' }] })}>+ {t('lib.cueNote')}</button>
      </div>

      <div className="grid2">
        <label className="field"><span>{t('lib.source')}</span>
          <select value={d.source} onChange={(e) => up({ source: e.target.value as Track['source'] })}>{TRACK_SOURCES.map((s) => <option key={s} value={s}>{t(`lib.source.${s}` as never)}</option>)}</select>
        </label>
        <label className="field"><span>{t('lib.sourceNote')}</span><input value={d.sourceNote ?? d.sourceUrl ?? ''} onChange={(e) => up(/^https?:/.test(e.target.value) ? { sourceUrl: e.target.value, sourceNote: undefined } : { sourceNote: e.target.value || undefined })} /></label>
      </div>
      {d.stream && <p className="small">☁ {t('lib.streamOnly', { service: d.stream.service })}</p>}

      <div className="field"><span>{t('lib.files')}</span>
        {files.map((f) => (
          <div key={f.id} className="small">{f.missing ? '✕ ' : ''}{locs.get(f.locationId)?.name ?? '?'} · {f.path} · {f.format.toUpperCase()} {f.bitrate ? `${f.bitrate} kbps` : ''} · <span className={f.quality === 'ok' ? '' : 'danger-text'}>{t(`lib.q.${f.quality}` as never)}</span></div>
        ))}
        {!files.length && <span className="muted small">{d.stream ? '☁' : t('lib.noFiles')}</span>}
      </div>
      {plays.length > 0 && <p className="tiny muted">{t('lib.playedTimes', { n: plays.length })}</p>}
    </Modal>
  );
}
