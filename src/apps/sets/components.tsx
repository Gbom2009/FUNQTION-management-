import type { CurvePoint } from './domain/suggest';

/** Energy over the night: the plan (line) against the template target (band). */
export function EnergyCurve({ points, height = 120 }: { points: CurvePoint[]; height?: number }) {
  if (points.length < 2) return null;
  const W = 800, H = height, pad = 8;
  const maxT = Math.max(...points.map((p) => p.atMin), 1);
  const x = (m: number) => pad + ((W - 2 * pad) * m) / maxT;
  const y = (e: number) => H - pad - ((H - 2 * pad) * (e - 1)) / 9;
  const target = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.atMin).toFixed(1)},${y(p.target).toFixed(1)}`).join('');
  const plan = points.filter((p) => p.energy !== undefined);
  const line = plan.map((p, i) => `${i ? 'L' : 'M'}${x(p.atMin).toFixed(1)},${y(p.energy!).toFixed(1)}`).join('');
  return (
    <svg className="sets-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="energy curve">
      {[3, 5, 7, 9].map((e) => <line key={e} x1={pad} x2={W - pad} y1={y(e)} y2={y(e)} className="grid" />)}
      <path d={target} className="target" />
      {line && <path d={line} className="plan" />}
      {plan.map((p, i) => <circle key={i} cx={x(p.atMin)} cy={y(p.energy!)} r={3} className={`dot ${p.performer ?? ''}`} />)}
    </svg>
  );
}

export const perfLabel = (p?: string) => (p === 'gijs' ? 'Gijs' : p === 'coen' ? 'Coen' : p === 'b2b' ? 'B2B' : '–');
