import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useUi, type SheetSnap } from "../store/ui";

/**
 * Draggable bottom sheet (phones) with three snap points:
 *  peek — just the header (route summary / quick actions)
 *  half — about half the screen
 *  full — nearly the whole screen, content scrolls
 * Drag the grab handle/header; flick fast to jump a snap point. Reports its
 * visible height to the UI store so the map keeps routes out from under it.
 */
interface Props {
  header: ReactNode;
  children: ReactNode;
  /** bottom inset (px) to leave free, e.g. for a bar under the sheet */
  bottomInset?: number;
}

const TOP_GAP = 72; // keep the floating search bar visible at "full"

export function Sheet({ header, children, bottomInset = 0 }: Props) {
  const snap = useUi((s) => s.sheetSnap);
  const setSnap = useUi((s) => s.setSheetSnap);
  const setSheetPx = useUi((s) => s.setSheetPx);
  const headerRef = useRef<HTMLDivElement>(null);
  const [vh, setVh] = useState(() => window.innerHeight);
  const [headerH, setHeaderH] = useState(120);
  const [drag, setDrag] = useState<{ y0: number; h0: number; h: number; t0: number } | null>(null);

  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const heights: Record<SheetSnap, number> = {
    peek: Math.min(headerH + 2, vh * 0.5),
    half: Math.max(headerH + 120, Math.round(vh * 0.55)),
    full: vh - TOP_GAP - bottomInset,
  };
  const target = drag ? drag.h : heights[snap];
  const height = Math.max(heights.peek, Math.min(heights.full, target));

  useEffect(() => { setSheetPx(Math.round(height + bottomInset)); }, [height, bottomInset, setSheetPx]);
  useEffect(() => () => setSheetPx(0), [setSheetPx]);

  const onDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ y0: e.clientY, h0: height, h: height, t0: performance.now() });
  }, [height]);
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, h: drag.h0 + (drag.y0 - e.clientY) });
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = drag.y0 - e.clientY;
    const v = dy / Math.max(1, performance.now() - drag.t0); // px/ms, + = up
    const order: SheetSnap[] = ["peek", "half", "full"];
    let next: SheetSnap;
    if (Math.abs(dy) < 6) {
      // a tap on the handle cycles up, and from full back to peek
      next = snap === "full" ? "peek" : order[order.indexOf(snap) + 1];
    } else if (Math.abs(v) > 0.6) {
      const i = order.indexOf(snap) + (v > 0 ? 1 : -1);
      next = order[Math.max(0, Math.min(2, i))];
    } else {
      next = order.reduce((best, s) => (Math.abs(heights[s] - drag.h) < Math.abs(heights[best] - drag.h) ? s : best), "peek" as SheetSnap);
    }
    setDrag(null);
    setSnap(next);
  };

  return (
    <section
      className="pointer-events-auto absolute inset-x-0 z-20 flex flex-col rounded-t-3xl border-t border-fq-line bg-fq-bg/97 shadow-[0_-12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      style={{ height, bottom: bottomInset, transition: drag ? "none" : "height 260ms var(--fq-ease-machine)" }}
    >
      <div
        ref={headerRef}
        className="shrink-0 touch-none select-none px-4 pb-3"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        <button aria-label="sheet" onClick={(e) => e.preventDefault()} tabIndex={-1}
          className="mx-auto mb-2 mt-2 block h-1.5 w-12 rounded-full bg-fq-line" />
        {/* header content stays tappable: taps on buttons inside don't drag */}
        <div onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button,input,a,select,label")) e.stopPropagation(); }}>
          {header}
        </div>
      </div>
      <div className={`min-h-0 flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${snap === "peek" && !drag ? "overflow-hidden" : "overflow-y-auto overscroll-contain"}`}>
        {children}
      </div>
    </section>
  );
}
