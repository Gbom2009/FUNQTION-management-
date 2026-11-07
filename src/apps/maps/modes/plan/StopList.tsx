import { useRef, useState } from "react";
import { ArrowUpDown, GripVertical, Trash2, X } from "lucide-react";
import { usePlan } from "../../store/plan";
import { useT } from "../../i18n";

/**
 * Stop list with drag-to-reorder. Pointer events (not HTML5 DnD) so it works
 * with touch in WKWebView. Drag by the ≡ handle.
 */
export function StopList() {
  const t = useT();
  const { stops, moveStop, removeStop, reverseStops, clearStops } = usePlan();
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; dy: number; y0: number } | null>(null);

  if (!stops.length) return <p className="text-[13px] text-fq-muted">{t("plan.hint")}</p>;

  const indexAt = (clientY: number) => {
    const rows = [...(list.current?.children ?? [])] as HTMLElement[];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length - 1;
  };

  return (
    <div>
      <ol ref={list} className="fq-card relative overflow-hidden">
        {stops.map((s, i) => {
          const dragging = drag?.from === i;
          const label = i === 0 ? "A" : i === stops.length - 1 ? "▼" : String(i);
          return (
            <li key={s.key}
              style={dragging ? { transform: `translateY(${drag.dy}px)`, zIndex: 10 } : undefined}
              className={`relative flex min-h-14 items-center gap-2 border-b border-fq-line bg-fq-surface px-1 last:border-b-0 ${dragging ? "opacity-90 shadow-lg" : ""} ${drag && drag.over === i && !dragging ? "border-t-2 border-t-fq-primary" : ""}`}>
              <button
                aria-label={t("plan.dragStop")}
                className="flex h-12 w-10 shrink-0 cursor-grab touch-none items-center justify-center text-fq-muted active:cursor-grabbing"
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  setDrag({ from: i, over: i, dy: 0, y0: e.clientY });
                }}
                onPointerMove={(e) => {
                  if (!drag) return;
                  setDrag({ ...drag, dy: e.clientY - drag.y0, over: indexAt(e.clientY) });
                }}
                onPointerUp={() => { if (drag) moveStop(drag.from, drag.over); setDrag(null); }}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") { e.preventDefault(); moveStop(i, i - 1); }
                  if (e.key === "ArrowDown") { e.preventDefault(); moveStop(i, i + 1); }
                }}
              ><GripVertical size={20} /></button>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] ${i === stops.length - 1 && i > 0 ? "bg-fq-primary text-[#040404]" : i === 0 ? "bg-fq-strong text-fq-bg" : "border border-fq-strong text-fq-strong"}`}>
                {label}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fq-strong">{s.name}</div>
                {s.detail && <div className="truncate text-[11px] text-fq-muted">{s.detail}</div>}
              </div>
              <button onClick={() => removeStop(s.key)} aria-label={t("plan.removeStop")}
                className="flex h-12 w-12 shrink-0 items-center justify-center text-fq-muted hover:text-fq-danger"><X size={20} /></button>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex gap-2">
        {stops.length >= 2 && <button onClick={reverseStops} className="fq-chip"><ArrowUpDown size={16} /> {t("plan.reverse")}</button>}
        <button onClick={clearStops} className="fq-chip text-fq-muted!"><Trash2 size={16} /> {t("plan.clear")}</button>
      </div>
    </div>
  );
}
