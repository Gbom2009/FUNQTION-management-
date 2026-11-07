import type { LonLat } from "../../nav/geo";

export interface GpxTrack {
  name?: string;
  points: LonLat[];
  /** epoch ms per point, when the GPX has <time> */
  times?: number[];
}

/** Parse trkpt (preferred) or rtept from a GPX string. */
export function parseGpx(xml: string): GpxTrack {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid GPX");
  let nodes = [...doc.getElementsByTagName("trkpt")];
  if (!nodes.length) nodes = [...doc.getElementsByTagName("rtept")];
  if (nodes.length < 2) throw new Error("GPX has fewer than 2 points");
  const points: LonLat[] = [];
  const times: number[] = [];
  for (const n of nodes) {
    const lat = Number(n.getAttribute("lat")), lon = Number(n.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push([lon, lat]);
    const t = n.getElementsByTagName("time")[0]?.textContent;
    if (t) times.push(Date.parse(t));
  }
  const name = doc.getElementsByTagName("name")[0]?.textContent ?? undefined;
  return { name, points, times: times.length === points.length ? times : undefined };
}
