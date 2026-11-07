/** Decode a Google-style encoded polyline (Valhalla uses precision 6) to [lon, lat] pairs. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let lat = 0, lon = 0, i = 0;
  const next = () => {
    let result = 0, shift = 0, b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([lon / factor, lat / factor]);
  }
  return out;
}
