// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseGpx } from "./gpx";
import { makePayload, stopsFromGpx, toGpx } from "./routeCode";
import { DEFAULT_OPTIONS } from "../../nav/valhalla";

describe("GPX", () => {
  const plan = makePayload([{ name: "Thuis & co", lat: 51.5, lon: 5.6 }, { name: "Effenaar", lat: 51.44, lon: 5.48 }], DEFAULT_OPTIONS);

  it("exports stops as a route and the geometry as a track", () => {
    const xml = toGpx(plan, [[5.6, 51.5], [5.55, 51.47], [5.48, 51.44]], "Test <route>");
    expect(xml).toContain('<rtept lat="51.5" lon="5.6"><name>Thuis &amp; co</name></rtept>');
    expect(xml).toContain("Test &lt;route&gt;");
    expect(parseGpx(xml).points).toHaveLength(3);
  });

  it("re-imports the stops it exported", () => {
    const { stops, simplified } = stopsFromGpx(toGpx(plan));
    expect(simplified).toBe(false);
    expect(stops.map((s) => s.n)).toEqual(["Thuis & co", "Effenaar"]);
  });

  it("long tracks become start + end, with timestamps kept for replay", () => {
    const pts = Array.from({ length: 40 }, (_, i) =>
      `<trkpt lat="${51 + i / 100}" lon="5.5"><time>2026-01-01T10:${String(i).padStart(2, "0")}:00Z</time></trkpt>`).join("");
    const { stops, simplified } = stopsFromGpx(`<gpx><trk><name>Rit</name><trkseg>${pts}</trkseg></trk></gpx>`);
    expect(simplified).toBe(true);
    expect(stops).toHaveLength(2);
    expect(stops[1].lat).toBeCloseTo(51.39);
    expect(parseGpx(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`).times).toHaveLength(40);
  });
});
