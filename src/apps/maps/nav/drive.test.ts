import { describe, expect, it, vi } from "vitest";
import { PromptPlanner, promptText, spokenDistance } from "./voice";
import { effectiveLimit, isSpeeding, segmentAt, encodePolyline } from "./speed";
import { decodePolyline } from "./polyline";
import { sunTimes, isNight } from "../theme/sun";
import { Simulator } from "../location/simulator";
import { destination, type LonLat } from "./geo";
import type { FlatManeuver } from "./guidance";
import type { Fix } from "../location/provider";

describe("PromptPlanner", () => {
  it("motorway: 2 km, 500 m, 100 m — each once", () => {
    const p = new PromptPlanner();
    const seen: (string | null)[] = [];
    for (let d = 3000; d >= 0; d -= 50) seen.push(p.check(1, d, true));
    expect(seen.filter(Boolean)).toEqual(["far", "mid", "now"]);
  });
  it("town thresholds are shorter", () => {
    const p = new PromptPlanner();
    expect(p.check(1, 600, false)).toBeNull();
    expect(p.check(1, 480, false)).toBe("far");
    expect(p.check(1, 190, false)).toBe("mid");
    expect(p.check(1, 35, false)).toBe("now");
  });
  it("skips 'far' when the maneuver appears already close, but still says mid/now", () => {
    const p = new PromptPlanner();
    expect(p.check(2, 300, false)).toBeNull();
    expect(p.check(2, 150, false)).toBe("mid");
    expect(p.check(2, 30, false)).toBe("now");
  });
  it("big jumps (8× sim) only fire the closest stage", () => {
    const p = new PromptPlanner();
    expect(p.check(3, 2500, true)).toBeNull();
    expect(p.check(3, 80, true)).toBe("now");
    expect(p.check(3, 20, true)).toBeNull();
  });
});

describe("voice text", () => {
  const m = { type: 15, verbalAlert: "Links afslaan naar Dorpsstraat.", verbalPre: "Sla linksaf naar Dorpsstraat.", instruction: "x" } as FlatManeuver;
  it("rounds spoken distances", () => {
    expect(spokenDistance(480, "nl")).toBe("500 meter");
    expect(spokenDistance(180, "nl")).toBe("200 meter");
    expect(spokenDistance(1980, "nl")).toBe("2 kilometer");
    expect(spokenDistance(1480, "nl")).toBe("1,5 kilometer");
    expect(spokenDistance(1480, "en")).toBe("1.5 kilometers");
  });
  it("far prompt is 'Over X, …', now prompt is the pre-transition line", () => {
    expect(promptText(m, "mid", 200, "nl", false)).toBe("Over 200 meter, links afslaan naar Dorpsstraat.");
    expect(promptText(m, "now", 30, "nl", false)).toBe("Sla linksaf naar Dorpsstraat.");
  });
  it("adds Funqtion flavour only on final arrival", () => {
    const dest = { type: 4, verbalPre: "Aangekomen op je bestemming.", instruction: "x" } as FlatManeuver;
    expect(promptText(dest, "now", 10, "nl", true)).toBe("Aangekomen op je bestemming. Feel the musiq!");
    expect(promptText(dest, "now", 10, "nl", false)).toBe("Aangekomen op je bestemming.");
  });
});

describe("speed limits", () => {
  const segs = [{ from: 0, to: 5, limitKmh: 30 }, { from: 5, to: 12, limitKmh: 50 }, { from: 12, to: 20, limitKmh: 100 }];
  it("finds the segment for a shape index", () => {
    expect(segmentAt(segs, 0)?.limitKmh).toBe(30);
    expect(segmentAt(segs, 7)?.limitKmh).toBe(50);
    expect(segmentAt(segs, 19)?.limitKmh).toBe(100);
    expect(segmentAt([], 3)).toBeUndefined();
  });
  it("effective limit is the lower of posted and tow cap", () => {
    expect(effectiveLimit(100, 90)).toBe(90);
    expect(effectiveLimit(50, 90)).toBe(50);
    expect(effectiveLimit(undefined, 80)).toBe(80);
    expect(effectiveLimit(70)).toBe(70);
  });
  it("speeding has a small tolerance", () => {
    expect(isSpeeding(52, 50)).toBe(false);
    expect(isSpeeding(54, 50)).toBe(true);
    expect(isSpeeding(140)).toBe(false);
  });
  it("polyline encode round-trips", () => {
    const pts: LonLat[] = [[5.6386, 51.5097], [5.4697, 51.4416], [-0.1, -33.9]];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });
});

describe("sun", () => {
  it("Aarle-Rixtel midsummer: sunrise ~03:20 UTC, sunset ~20:00 UTC", () => {
    const s = sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 51.51, 5.64)!;
    expect(s.sunrise.getUTCHours() * 60 + s.sunrise.getUTCMinutes()).toBeGreaterThan(3 * 60 + 5);
    expect(s.sunrise.getUTCHours() * 60 + s.sunrise.getUTCMinutes()).toBeLessThan(3 * 60 + 35);
    expect(s.sunset.getUTCHours() * 60 + s.sunset.getUTCMinutes()).toBeGreaterThan(19 * 60 + 50);
    expect(s.sunset.getUTCHours() * 60 + s.sunset.getUTCMinutes()).toBeLessThan(20 * 60 + 15);
  });
  it("night at 23:00 UTC in winter, day at noon", () => {
    expect(isNight(new Date(Date.UTC(2026, 11, 1, 23)), 51.51, 5.64)).toBe(true);
    expect(isNight(new Date(Date.UTC(2026, 11, 1, 12)), 51.51, 5.64)).toBe(false);
  });
});

describe("Simulator", () => {
  it("drives along the path, accelerating, with fixes near the line", () => {
    vi.useFakeTimers();
    const A: LonLat = [5.6, 51.5];
    const shape = Array.from({ length: 21 }, (_, i) => destination(A, 90, i * 100));
    const sim = new Simulator();
    sim.noiseM = 0;
    sim.multiplier = 4;
    sim.setPath({ shape, speeds: new Array(20).fill(20) });
    const fixes: Fix[] = [];
    sim.start((f) => fixes.push(f));
    vi.advanceTimersByTime(10_000);
    sim.stop();
    vi.useRealTimers();
    expect(fixes.length).toBe(40);
    expect(fixes[0].speedKmh).toBeLessThan(fixes[39].speedKmh);
    expect(Math.abs(fixes[39].lat - 51.5)).toBeLessThan(1e-4);
    expect(fixes[39].heading).toBeGreaterThan(80);
    expect(sim.progress.along).toBeGreaterThan(400);
  });
  it("goes off-route on command", () => {
    vi.useFakeTimers();
    const A: LonLat = [5.6, 51.5];
    const shape = Array.from({ length: 21 }, (_, i) => destination(A, 90, i * 100));
    const sim = new Simulator();
    sim.noiseM = 0;
    sim.setPath({ shape });
    let last: Fix | null = null;
    sim.start((f) => { last = f; });
    vi.advanceTimersByTime(5000);
    sim.goOffRoute();
    vi.advanceTimersByTime(20_000);
    sim.stop();
    vi.useRealTimers();
    // veered right (south of the eastbound line) by well over 40 m
    expect(51.5 - last!.lat).toBeGreaterThan(0.0005);
  });
});
