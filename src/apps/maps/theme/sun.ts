/**
 * Sunrise/sunset (NOAA simplified algorithm, ±2 min at NL latitudes).
 * Used for the automatic day/night map theme.
 */
const rad = Math.PI / 180;

export function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } | null {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 864e5);
  const γ = (2 * Math.PI / 365) * (day - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(γ) - 0.032077 * Math.sin(γ)
    - 0.014615 * Math.cos(2 * γ) - 0.040849 * Math.sin(2 * γ));
  const decl = 0.006918 - 0.399912 * Math.cos(γ) + 0.070257 * Math.sin(γ) - 0.006758 * Math.cos(2 * γ)
    + 0.000907 * Math.sin(2 * γ) - 0.002697 * Math.cos(3 * γ) + 0.00148 * Math.sin(3 * γ);
  const cosH = (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null; // polar day/night
  const ha = Math.acos(cosH) / rad;
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const rise = 720 - 4 * (lon + ha) - eqTime;
  const set = 720 - 4 * (lon - ha) - eqTime;
  return { sunrise: new Date(midnight + rise * 60000), sunset: new Date(midnight + set * 60000) };
}

export function isNight(now: Date, lat: number, lon: number): boolean {
  const s = sunTimes(now, lat, lon);
  if (!s) return false;
  return now < s.sunrise || now > s.sunset;
}
