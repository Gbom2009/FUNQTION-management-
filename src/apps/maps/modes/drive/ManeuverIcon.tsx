/** Arrow glyph for a Valhalla maneuver type. Thick strokes for arm's-length reading. */
const ANGLE: Record<number, number> = {
  1: 0, 2: 0, 3: 0, 8: 0, 17: 0, 22: 0, 25: 0,
  9: 45, 18: 45, 20: 45, 23: 30, 37: 30,
  10: 90, 11: 135,
  16: -45, 19: -45, 21: -45, 24: -30, 38: -30,
  15: -90, 14: -135,
};

export function ManeuverIcon({ type, exit, className = "" }: { type: number; exit?: number; className?: string }) {
  const stroke = { stroke: "currentColor", strokeWidth: 9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

  if (type === 4 || type === 5 || type === 6) {
    // destination flag
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        <path d="M30 90 V14" {...stroke} />
        <path d="M30 16 H76 L64 32 L76 48 H30 Z" fill="currentColor" stroke="currentColor" strokeWidth={6} strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 26 || type === 27) {
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        <circle cx="50" cy="44" r="18" {...stroke} />
        <path d="M50 92 V62" {...stroke} />
        <path d="M63 31 L82 12 M66 12 H82 V28" {...stroke} />
        {exit ? <text x="50" y="51" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">{exit}</text> : null}
      </svg>
    );
  }
  if (type === 12 || type === 13) {
    const flip = type === 13 ? -1 : 1;
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        <g transform={flip < 0 ? "translate(100 0) scale(-1 1)" : undefined}>
          <path d="M35 92 V40 A17 17 0 0 1 69 40 V70" {...stroke} />
          <path d="M55 58 L69 72 L83 58" {...stroke} />
        </g>
      </svg>
    );
  }
  if (type === 28 || type === 29) {
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        <path d="M18 60 H82 L72 78 H28 Z" fill="currentColor" />
        <path d="M50 58 V22 L70 50 H50" {...stroke} strokeWidth={6} />
        <path d="M14 90 Q26 82 38 90 T62 90 T86 90" {...stroke} strokeWidth={5} />
      </svg>
    );
  }
  const a = ANGLE[type] ?? 0;
  // stem from bottom to the pivot, then a branch at angle `a`
  const pivot = { x: 50, y: 58 };
  const len = 38;
  const r = (a * Math.PI) / 180;
  const tip = { x: pivot.x + Math.sin(r) * len, y: pivot.y - Math.cos(r) * len };
  const head = 16;
  const l = { x: tip.x - Math.sin(r - 0.6) * head, y: tip.y + Math.cos(r - 0.6) * head };
  const rr = { x: tip.x - Math.sin(r + 0.6) * head, y: tip.y + Math.cos(r + 0.6) * head };
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <path d={`M50 94 V${pivot.y} L${tip.x} ${tip.y}`} {...stroke} />
      <path d={`M${l.x} ${l.y} L${tip.x} ${tip.y} L${rr.x} ${rr.y}`} {...stroke} />
    </svg>
  );
}
