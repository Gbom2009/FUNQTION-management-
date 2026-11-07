import type { ManeuverArt } from "../../nav/narration/art";

/**
 * Custom vector art for junctions and roundabouts. Uses currentColor, so it
 * reads black on the orange banner and white elsewhere. Other arms are drawn
 * faint so the eye goes straight to the path you take.
 */
const C = { x: 50, y: 54 };
const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: C.x + Math.sin(a) * r, y: C.y - Math.cos(a) * r };
};

function arrowHead(deg: number, r: number, size = 13) {
  const tip = pt(deg, r);
  const l = pt(deg - 14, r - size), rr = pt(deg + 14, r - size);
  return `M${l.x.toFixed(1)} ${l.y.toFixed(1)} L${tip.x.toFixed(1)} ${tip.y.toFixed(1)} L${rr.x.toFixed(1)} ${rr.y.toFixed(1)}`;
}

export function RoundaboutArt({ art, className = "" }: { art: ManeuverArt; className?: string }) {
  const R = 21;          // ring radius
  const ARM = 47;        // arm length from centre
  const exit = art.exitAngle;
  // path round the ring: entry at 180°, counter-clockwise on screen = decreasing angle
  const sweep = ((180 - exit) % 360 + 360) % 360 || 360;
  const large = sweep > 180 ? 1 : 0;
  const s = pt(180, R), e = pt(exit, R);
  const exitOut = pt(exit, ARM - 4);
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      {/* other arms, faint */}
      {art.arms.map((a, i) => {
        const p1 = pt(a, R + 4), p2 = pt(a, ARM);
        return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="currentColor" strokeOpacity={0.3} strokeWidth={9} strokeLinecap="round" />;
      })}
      {/* the ring */}
      <circle cx={C.x} cy={C.y} r={R} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={9} />
      {/* entry arm */}
      <line x1={C.x} y1={100} x2={s.x} y2={s.y} stroke="currentColor" strokeWidth={9} strokeLinecap="round" />
      {/* our path round the ring (counter-clockwise, right-hand traffic) */}
      <path d={`M${s.x.toFixed(1)} ${s.y.toFixed(1)} A${R} ${R} 0 ${large} 0 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`} fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round" />
      {/* exit arm + arrow */}
      <line x1={e.x} y1={e.y} x2={exitOut.x} y2={exitOut.y} stroke="currentColor" strokeWidth={9} strokeLinecap="round" />
      <path d={arrowHead(exit, ARM + 2)} fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
      {/* exit number */}
      {art.exitNumber ? (
        <text x={C.x} y={C.y + 8} textAnchor="middle" fontSize={24} fontWeight={900} fill="currentColor" style={{ fontFamily: "var(--fq-font-display)" }}>
          {art.exitNumber}
        </text>
      ) : null}
    </svg>
  );
}

export function TurnArt({ art, className = "" }: { art: ManeuverArt; className?: string }) {
  const ARM = 44;
  const exitEnd = pt(art.exitAngle, ARM - 6);
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      {art.arms.map((a, i) => {
        const p = pt(a, ARM);
        return <line key={i} x1={C.x} y1={C.y} x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity={0.28} strokeWidth={11} strokeLinecap="round" />;
      })}
      {/* where we come from */}
      <line x1={C.x} y1={100} x2={C.x} y2={C.y} stroke="currentColor" strokeWidth={11} strokeLinecap="round" />
      {/* where we go */}
      <line x1={C.x} y1={C.y} x2={exitEnd.x} y2={exitEnd.y} stroke="currentColor" strokeWidth={11} strokeLinecap="round" />
      <path d={arrowHead(art.exitAngle, ARM + 3, 15)} fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function JunctionArt({ art, className }: { art: ManeuverArt; className?: string }) {
  return art.kind === "roundabout" ? <RoundaboutArt art={art} className={className} /> : <TurnArt art={art} className={className} />;
}
