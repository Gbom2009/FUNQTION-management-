// Code 128 bars as plain numbers, so the PDF builder can draw them as rectangles
// (crisp at any print size) without the zxing runtime.

export interface Bars { modules: number; bars: [number, number][] } // [x, width] in modules

/** Parse zxing/zint SVG output: one path with "M{x} {y}h{w}v{h}h-{w}Z" per bar. */
export function barsFromSvg(svg: string): Bars {
  const modules = Number(svg.match(/<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/)?.[1] ?? 0);
  const bars: [number, number][] = [];
  for (const m of svg.matchAll(/M(\d+(?:\.\d+)?) [\d.]+h(\d+(?:\.\d+)?)/g)) bars.push([Number(m[1]), Number(m[2])]);
  return { modules, bars };
}
