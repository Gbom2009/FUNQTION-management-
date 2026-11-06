import { useState } from 'react';
import { useI18n } from '../../core/i18n';
import { euro } from '../../core/format';
import { todayStr } from '../../core/dates';
import { periodOf, shiftPeriod, type Period, type PeriodKind } from './domain/ledger';

/** Money amount: tabular, right-aligned, minus sign + arrow for money out (never colour alone). */
export function Amount({ cents, strong, signed }: { cents: number; strong?: boolean; signed?: boolean }) {
  const { lang } = useI18n();
  cents = Math.round(cents) || 0; // avoid "-0,00"
  const neg = cents < 0;
  return (
    <span className={`mono-num ${strong ? 'strong' : ''}`} style={{ whiteSpace: 'nowrap', color: signed ? (neg ? 'var(--danger)' : 'var(--ok)') : undefined }}>
      {signed && (neg ? '↓ ' : '↑ ')}{euro(cents, lang)}
    </span>
  );
}

export function usePeriod(initial: PeriodKind = 'month') {
  const [kind, setKind] = useState<PeriodKind>(initial);
  const [p, setP] = useState<Period>(periodOf(initial, todayStr()));
  return {
    kind, period: p,
    setKind: (k: PeriodKind) => { setKind(k); setP(periodOf(k, p.from)); },
    shift: (n: number) => setP(shiftPeriod(kind, p, n)),
  };
}

export function PeriodBar({ ctl }: { ctl: ReturnType<typeof usePeriod> }) {
  const { t, lang } = useI18n();
  const label = ctl.kind === 'year' ? ctl.period.key
    : ctl.kind === 'quarter' ? ctl.period.key.replace('-', ' ')
    : new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(ctl.period.from));
  return (
    <div className="row">
      <div className="chips">
        {(['month', 'quarter', 'year'] as const).map((k) => <button key={k} className="chip" aria-pressed={ctl.kind === k} onClick={() => ctl.setKind(k)}>{t(`m.period.${k}`)}</button>)}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn small" aria-label="prev" onClick={() => ctl.shift(-1)}>←</button>
        <span className="strong small" style={{ minWidth: 120, textAlign: 'center', textTransform: 'capitalize' }}>{label}</span>
        <button className="btn small" aria-label="next" onClick={() => ctl.shift(1)}>→</button>
      </div>
    </div>
  );
}

export function Stat({ label, cents, note, tone, dashed }: { label: string; cents: number; note?: string; tone?: 'danger' | 'ok' | 'warn'; dashed?: boolean }) {
  const { lang } = useI18n();
  return (
    <div className="stat">
      <div className="legend" style={{ color: tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : undefined }}>{label}</div>
      <div className="v mono-num" style={{ textDecoration: dashed ? 'underline dashed 1px' : undefined, textUnderlineOffset: 6 }}>{euro(cents, lang)}</div>
      {note && <div className="tiny muted">{note}</div>}
    </div>
  );
}

/** Tiny SVG bar chart: in vs out per month. */
export function InOutChart({ rows }: { rows: { label: string; in: number; out: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.in, r.out]));
  const w = 28; const gap = 14; const h = 120;
  return (
    <svg viewBox={`0 0 ${rows.length * (w * 2 + gap)} ${h + 18}`} width="100%" height={h + 18} role="img" aria-label="in / out">
      {rows.map((r, i) => {
        const x = i * (w * 2 + gap);
        const hi = Math.round((r.in / max) * h); const ho = Math.round((r.out / max) * h);
        return (
          <g key={r.label}>
            <rect x={x} y={h - hi} width={w} height={hi} fill="var(--ok)" opacity="0.85"><title>{r.label} in</title></rect>
            <rect x={x + w} y={h - ho} width={w} height={ho} fill="var(--fq-text-dim)" opacity="0.6"><title>{r.label} out</title></rect>
            <text x={x + w} y={h + 13} fontSize="10" textAnchor="middle" fill="var(--fq-text-dim)">{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
