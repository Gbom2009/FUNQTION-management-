import type { Map } from "maplibre-gl";

/**
 * Map pictograms drawn on canvas at runtime (no sprite sheet needed, crisp
 * at any pixel ratio). Shapes follow Dutch road-sign conventions where there
 * is one: red octagon = stop, inverted triangle = give way, St Andrew's
 * cross = level crossing.
 */
type Draw = (c: CanvasRenderingContext2D, s: number) => void;

const ICONS: Record<string, Draw> = {
  "fq-oneway": (c, s) => {
    c.strokeStyle = "rgba(240,240,240,0.75)"; c.lineWidth = s * 0.14; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(s * 0.3, s * 0.25); c.lineTo(s * 0.7, s * 0.5); c.lineTo(s * 0.3, s * 0.75); c.stroke();
  },
  "fq-camera": (c, s) => {
    c.fillStyle = "#e3262b"; round(c, s * 0.08, s * 0.2, s * 0.84, s * 0.62, s * 0.14); c.fill();
    c.fillStyle = "#fff"; c.beginPath(); c.arc(s * 0.5, s * 0.51, s * 0.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#e3262b"; c.beginPath(); c.arc(s * 0.5, s * 0.51, s * 0.1, 0, Math.PI * 2); c.fill();
  },
  "fq-zebra": (c, s) => {
    c.fillStyle = "#1565c0"; round(c, s * 0.06, s * 0.06, s * 0.88, s * 0.88, s * 0.12); c.fill();
    c.fillStyle = "#fff"; for (let i = 0; i < 4; i++) c.fillRect(s * (0.2 + i * 0.16), s * 0.22, s * 0.09, s * 0.56);
  },
  "fq-signal": (c, s) => {
    c.fillStyle = "#141414"; round(c, s * 0.3, s * 0.06, s * 0.4, s * 0.88, s * 0.1); c.fill();
    [["#e3262b", 0.24], ["#facc15", 0.5], ["#3ddc84", 0.76]].forEach(([col, y]) => {
      c.fillStyle = col as string; c.beginPath(); c.arc(s * 0.5, s * (y as number), s * 0.1, 0, Math.PI * 2); c.fill();
    });
  },
  "fq-rail": (c, s) => {
    c.strokeStyle = "#fff"; c.lineWidth = s * 0.26; c.lineCap = "round";
    c.beginPath(); c.moveTo(s * 0.16, s * 0.16); c.lineTo(s * 0.84, s * 0.84); c.moveTo(s * 0.84, s * 0.16); c.lineTo(s * 0.16, s * 0.84); c.stroke();
    c.strokeStyle = "#e3262b"; c.lineWidth = s * 0.14;
    c.beginPath(); c.moveTo(s * 0.16, s * 0.16); c.lineTo(s * 0.84, s * 0.84); c.moveTo(s * 0.84, s * 0.16); c.lineTo(s * 0.16, s * 0.84); c.stroke();
  },
  "fq-bump": (c, s) => {
    c.fillStyle = "#fff"; tri(c, s, false); c.fill();
    c.strokeStyle = "#e3262b"; c.lineWidth = s * 0.09; tri(c, s, false); c.stroke();
    c.fillStyle = "#141414"; c.beginPath(); c.ellipse(s * 0.5, s * 0.66, s * 0.2, s * 0.08, 0, Math.PI, 0); c.fill();
  },
  "fq-stop": (c, s) => {
    c.fillStyle = "#e3262b"; c.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; c.lineTo(s * 0.5 + Math.cos(a) * s * 0.45, s * 0.5 + Math.sin(a) * s * 0.45); }
    c.closePath(); c.fill(); c.strokeStyle = "#fff"; c.lineWidth = s * 0.06; c.stroke();
  },
  "fq-giveway": (c, s) => {
    c.fillStyle = "#fff"; tri(c, s, true); c.fill();
    c.strokeStyle = "#e3262b"; c.lineWidth = s * 0.11; tri(c, s, true); c.stroke();
  },
  "fq-height": (c, s) => {
    c.fillStyle = "#fff"; c.beginPath(); c.arc(s * 0.5, s * 0.5, s * 0.44, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#e3262b"; c.lineWidth = s * 0.1; c.stroke();
    c.fillStyle = "#141414"; c.beginPath();
    c.moveTo(s * 0.5, s * 0.16); c.lineTo(s * 0.36, s * 0.32); c.lineTo(s * 0.64, s * 0.32); c.closePath();
    c.moveTo(s * 0.5, s * 0.84); c.lineTo(s * 0.36, s * 0.68); c.lineTo(s * 0.64, s * 0.68); c.closePath(); c.fill();
  },
};

function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
}
function tri(c: CanvasRenderingContext2D, s: number, down: boolean) {
  c.beginPath();
  if (down) { c.moveTo(s * 0.1, s * 0.18); c.lineTo(s * 0.9, s * 0.18); c.lineTo(s * 0.5, s * 0.88); }
  else { c.moveTo(s * 0.5, s * 0.12); c.lineTo(s * 0.9, s * 0.82); c.lineTo(s * 0.1, s * 0.82); }
  c.closePath();
}

/** Add any of our icons the style asks for (fires again after each style reload). */
export function attachIcons(map: Map) {
  const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const make = (id: string) => {
    const draw = ICONS[id];
    if (!draw || map.hasImage(id)) return;
    const s = 48 * ratio;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    draw(cv.getContext("2d")!, s);
    const img = cv.getContext("2d")!.getImageData(0, 0, s, s);
    map.addImage(id, { width: s, height: s, data: new Uint8Array(img.data.buffer) }, { pixelRatio: ratio * 2 });
  };
  map.on("styleimagemissing", (e) => make(e.id));
  for (const id of Object.keys(ICONS)) make(id);
}

export const ICON_FOR: Record<string, string> = {
  camera: "fq-camera", zebra: "fq-zebra", signal: "fq-signal", rail: "fq-rail", bump: "fq-bump",
  stop: "fq-stop", giveway: "fq-giveway", maxheight: "fq-height", maxweight: "fq-height",
};
