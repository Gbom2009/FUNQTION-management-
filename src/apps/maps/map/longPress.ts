import type { Map, MapMouseEvent, MapTouchEvent, LngLat } from "maplibre-gl";

/**
 * Long-press (touch, 550 ms without moving) or right-click (desktop) on the
 * map → callback with the coordinate. Returns a cleanup function.
 */
export function onLongPress(map: Map, cb: (at: LngLat) => void, ms = 550): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; start = null; };

  const down = (e: MapTouchEvent) => {
    if (e.originalEvent.touches.length !== 1) return cancel();
    start = { x: e.point.x, y: e.point.y };
    const at = e.lngLat;
    timer = setTimeout(() => { timer = null; navigator.vibrate?.(20); cb(at); }, ms);
  };
  const move = (e: MapTouchEvent) => {
    if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel();
  };
  const ctx = (e: MapMouseEvent) => { e.preventDefault(); cb(e.lngLat); };

  map.on("touchstart", down);
  map.on("touchmove", move);
  map.on("touchend", cancel);
  map.on("touchcancel", cancel);
  map.on("movestart", cancel);
  map.on("contextmenu", ctx);
  return () => {
    cancel();
    map.off("touchstart", down);
    map.off("touchmove", move);
    map.off("touchend", cancel);
    map.off("touchcancel", cancel);
    map.off("movestart", cancel);
    map.off("contextmenu", ctx);
  };
}
