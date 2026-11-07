import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { useI18n } from '../../core/i18n';
import type { GearItem, GearStatus } from '../../core/types';
import { normaliseCode } from './domain/gear';

// ---------------------------------------------------------------------------
// Feedback you don't have to look at: a short tick for a good scan, a low tone for a problem.

let audio: AudioContext | null = null;
export function feedback(ok: boolean) {
  try {
    audio = audio ?? new AudioContext();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = ok ? 1320 : 220; o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.12; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.25));
  } catch { /* no audio */ }
  try { navigator.vibrate?.(ok ? 40 : [80, 60, 80]); } catch { /* iOS: no vibration API */ }
}

// ---------------------------------------------------------------------------
// QR scanner: BarcodeDetector where the browser has it, jsQR elsewhere (iPhone Safari).

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export function Scanner({ onCode, compact }: { onCode: (code: string) => void; compact?: boolean }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [typed, setTyped] = useState('');
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const cb = useRef(onCode);
  cb.current = onCode;
  const track = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let lock: { release: () => Promise<void> } | null = null;
    const canvas = document.createElement('canvas');
    let detector: Detector | null = null;
    let jsqr: typeof import('jsqr').default | null = null;
    const emit = (raw: string) => {
      const code = normaliseCode(raw) ?? raw;
      const now = Date.now();
      if (code === last.current.code && now - last.current.at < 2500) return;
      last.current = { code, at: now };
      cb.current(code);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((x) => x.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        track.current = stream.getVideoTracks()[0];
        const caps = (track.current.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch(caps.torch ? false : null);
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) detector = new BD({ formats: ['qr_code'] });
        else jsqr = (await import('jsqr')).default;
        try { lock = await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not allowed */ }
        const tick = async () => {
          if (stopped || !v.videoWidth) return;
          try {
            if (detector) {
              const r = await detector.detect(v);
              if (r[0]?.rawValue) emit(r[0].rawValue);
            } else if (jsqr) {
              const scale = Math.min(1, 720 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
              const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const r = jsqr(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
              if (r?.data) emit(r.data);
            }
          } catch { /* frame not ready */ }
        };
        timer = window.setInterval(tick, 180);
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError' ? t('g.scan.denied') : t('g.scan.noCamera'));
      }
    })();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((x) => x.stop());
      lock?.release().catch(() => undefined);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTorch() {
    if (!track.current || torch == null) return;
    try { await track.current.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setTorch(null); }
  }

  return (
    <div className={`scanner${compact ? ' compact' : ''}`}>
      {!error && <div className="scanner-view"><video ref={video} playsInline muted /><div className="scanner-frame" aria-hidden="true" /></div>}
      {error && <div className="banner warn"><span>!</span><div className="txt">{error}</div></div>}
      <div className="row scanner-bar">
        <form className="row grow" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { cb.current(normaliseCode(typed) ?? typed.trim()); setTyped(''); } }}>
          <input className="input grow" inputMode="numeric" placeholder={t('g.scan.type')} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t('g.scan.type')} />
          <button className="btn">OK</button>
        </form>
        {torch != null && <button className="btn" aria-pressed={torch} onClick={toggleTorch}>{t('g.scan.torch')}</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI bits

const STATUS_COLOR: Record<GearStatus, string> = {
  available: 'var(--ok)', out: 'var(--st-quote_sent)', out_of_service: 'var(--danger)', in_repair: 'var(--warning)', lent: 'var(--st-option)',
  missing: 'var(--danger)', disposed: 'var(--fq-text-dim)',
};
const STATUS_ICON: Record<GearStatus, string> = { available: '✓', out: '↗', out_of_service: '⏸', in_repair: '🔧', lent: '↗', missing: '!', disposed: '✕' };

export function StatusPill({ status }: { status: GearStatus }) {
  const { t } = useI18n();
  return <span className="pill" style={{ color: STATUS_COLOR[status] }}>{STATUS_ICON[status]} {t(`g.status.${status}`)}</span>;
}

export function OwnerChip({ owner }: { owner: GearItem['owner'] }) {
  const { t } = useI18n();
  if (owner === 'gijs' || owner === 'coen') return <span className={`member ${owner}`} title={owner}>{owner === 'gijs' ? 'G' : 'C'}</span>;
  return <span className="tiny muted">{t(`g.owner.${owner}`)}</span>;
}

/** First photo of an item as a thumbnail (object URL, revoked on unmount). */
export function Thumb({ itemId, size = 44 }: { itemId: string; size?: number }) {
  const photo = useLiveQuery(() => db.gearPhotos.where('itemId').equals(itemId).first(), [itemId]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!photo?.blob || photo.deletedAt) { setUrl(undefined); return; }
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return url ? <img className="thumb" src={url} alt="" width={size} height={size} /> : <span className="thumb empty" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function useNightMode() {
  const [night, setNight] = useState(() => { try { return localStorage.getItem('fq-night') === '1'; } catch { return false; } });
  useEffect(() => {
    document.body.classList.toggle('night', night);
    try { localStorage.setItem('fq-night', night ? '1' : '0'); } catch { /* private mode */ }
    return () => document.body.classList.remove('night');
  }, [night]);
  return [night, setNight] as const;
}
