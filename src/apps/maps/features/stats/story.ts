import logoUrl from "../../assets/logo.svg";
import type { LonLat } from "../../nav/geo";
import type { SeasonStats } from "./season";
import type { Lang } from "../../i18n";

/**
 * Instagram story export: 1080×1920 PNG in full Funqtion style — black stage,
 * logo, "FEEL THE MUSIQ", glowing route silhouette of the season, big stats.
 */
const W = 1080, H = 1920;
const ORANGE = "#f68712", WHITE = "#f0f0f0", GREY = "#8d8d8d", BG = "#040404";

/** Web-Mercator projection of all tracks into a box (keeps aspect ratio). */
export function projectTracks(tracks: LonLat[][], box: { x: number; y: number; w: number; h: number }): [number, number][][] {
  const merc = ([lon, lat]: LonLat): [number, number] => [lon, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (180 / Math.PI)];
  const pts = tracks.map((t) => t.map(merc));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of pts) for (const [x, y] of t) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (!Number.isFinite(minX)) return [];
  const sx = box.w / Math.max(maxX - minX, 1e-6), sy = box.h / Math.max(maxY - minY, 1e-6);
  const s = Math.min(sx, sy);
  const ox = box.x + (box.w - (maxX - minX) * s) / 2, oy = box.y + (box.h - (maxY - minY) * s) / 2;
  return pts.map((t) => t.map(([x, y]) => [ox + (x - minX) * s, oy + (maxY - y) * s]));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function grain(ctx: CanvasRenderingContext2D) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export async function renderStory(stats: SeasonStats, tracks: LonLat[][], lang: Lang): Promise<Blob> {
  await Promise.all([
    document.fonts.load('400 120px "Archivo Black"'),
    document.fonts.load('400 40px "JetBrains Mono"'),
    document.fonts.load('300 40px "JetBrains Mono"'),
  ]).catch(() => undefined);

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // soft orange stage light behind the silhouette
  const glow = ctx.createRadialGradient(W / 2, 860, 50, W / 2, 860, 700);
  glow.addColorStop(0, "rgba(246,135,18,0.20)");
  glow.addColorStop(1, "rgba(246,135,18,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // header: logo + wordmark
  const logo = await loadImage(logoUrl);
  ctx.drawImage(logo, 80, 90, 150, 150);
  ctx.fillStyle = WHITE;
  ctx.font = '400 54px "Archivo Black"';
  ctx.textBaseline = "alphabetic";
  ctx.fillText("TEAM FUNQTION", 260, 160);
  ctx.fillStyle = GREY;
  ctx.font = '300 30px "JetBrains Mono"';
  ctx.fillText(`SETLIST ${stats.year} · ${lang === "nl" ? "OP DE WEG" : "ON THE ROAD"}`, 262, 212);

  // route silhouette
  const lines = projectTracks(tracks, { x: 90, y: 330, w: W - 180, h: 980 });
  if (lines.length) {
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (const [width, alpha, blur] of [[18, 0.18, 30], [6, 0.9, 12], [2.5, 1, 0]] as const) {
      ctx.strokeStyle = blur ? `rgba(246,135,18,${alpha})` : "#ffe2c2";
      ctx.lineWidth = width;
      ctx.shadowColor = ORANGE;
      ctx.shadowBlur = blur;
      for (const l of lines) {
        ctx.beginPath();
        l.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = GREY;
    ctx.font = '300 34px "JetBrains Mono"';
    ctx.textAlign = "center";
    ctx.fillText(lang === "nl" ? "nog geen ritten gelogd" : "no trips logged yet", W / 2, 820);
    ctx.textAlign = "left";
  }

  // stats grid
  const cells: [string, string][] = [
    [stats.km.toLocaleString(lang === "nl" ? "nl-NL" : "en-GB"), "KM"],
    [String(stats.gigs), "GIGS"],
    [stats.towKm.toLocaleString(lang === "nl" ? "nl-NL" : "en-GB"), lang === "nl" ? "KM MET TRAILER" : "KM TOWED"],
    [stats.furthest ? `${stats.furthest.km}` : "—", lang === "nl" ? "KM VERSTE GIG" : "KM FURTHEST GIG"],
  ];
  const top = 1380;
  cells.forEach(([value, label], i) => {
    const x = 80 + (i % 2) * 470, y = top + Math.floor(i / 2) * 190;
    ctx.strokeStyle = "#363636"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 70); ctx.lineTo(x + 420, y - 70); ctx.stroke();
    ctx.fillStyle = i === 0 ? ORANGE : WHITE;
    ctx.font = '400 92px "Archivo Black"';
    ctx.fillText(value, x, y + 30);
    ctx.fillStyle = GREY;
    ctx.font = '400 26px "JetBrains Mono"';
    ctx.fillText(label, x, y + 72);
  });
  if (stats.furthest) {
    ctx.fillStyle = GREY;
    ctx.font = '300 26px "JetBrains Mono"';
    ctx.fillText(`→ ${stats.furthest.name}`.slice(0, 34), 550, top + 190 + 108);
  }

  // footer
  ctx.fillStyle = ORANGE;
  ctx.font = '400 64px "Archivo Black"';
  ctx.textAlign = "center";
  ctx.fillText("FEEL THE MUSIQ", W / 2, 1790);
  ctx.fillStyle = WHITE;
  ctx.font = '400 34px "JetBrains Mono"';
  ctx.fillText("@funqtion1", W / 2, 1850);
  ctx.textAlign = "left";

  grain(ctx);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG export failed"))), "image/png"));
}
