import type { FlatManeuver } from "./guidance";
import { DESTINATION_TYPES } from "./guidance";
import type { Lang } from "../i18n";
import { say, stopAll } from "./tts";

/**
 * Voice prompt planning (pure, tested) + speech output (Web Speech API).
 * Motorway: 2 km / 500 m / 100 m. Elsewhere: 500 m / 200 m / 40 m.
 */
export type Stage = "far" | "mid" | "now";
const STAGES: Stage[] = ["far", "mid", "now"];

export function thresholds(fast: boolean): Record<Stage, number> {
  return fast ? { far: 2000, mid: 500, now: 100 } : { far: 500, mid: 200, now: 40 };
}

/** Spoken distance, rounded the way people say it. */
export function spokenDistance(m: number, lang: Lang): string {
  if (m >= 950) {
    const km = Math.round(m / 500) / 2; // nearest 0.5 km
    const s = Number.isInteger(km) ? String(km) : (lang === "nl" ? String(km).replace(".", ",") : String(km));
    return lang === "nl" ? `${s} kilometer` : `${s} kilometer${km === 1 ? "" : "s"}`;
  }
  const r = m >= 300 ? Math.round(m / 100) * 100 : Math.round(m / 50) * 50;
  return lang === "nl" ? `${r} meter` : `${r} meters`;
}

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function promptText(m: FlatManeuver, stage: Stage, distM: number, lang: Lang, finalStop: boolean): string {
  const dest = DESTINATION_TYPES.has(m.type);
  if (stage === "now" || dest && distM < 60) {
    const base = m.verbalPre ?? m.instruction;
    // Funqtion flavour only on final arrival — instructions stay unambiguous.
    return dest && finalStop ? `${base} ${lang === "nl" ? "Feel the musiq!" : "Feel the musiq!"}` : base;
  }
  const alert = m.verbalAlert ?? m.verbalPre ?? m.instruction;
  const prefix = lang === "nl" ? `Over ${spokenDistance(distM, lang)}` : `In ${spokenDistance(distM, lang)}`;
  return `${prefix}, ${lcFirst(alert)}`;
}

/**
 * Decides when to speak. Call on every guidance update; returns the stage to
 * announce (or null). Each (maneuver, stage) is spoken once. If we first see
 * a maneuver already inside several thresholds, only the closest stage fires.
 */
export class PromptPlanner {
  private done = new Set<string>();
  /** distance at which we first saw each maneuver — skip "far" if the segment is too short */
  private firstSeen = new Map<number, number>();

  check(index: number, distM: number, fast: boolean): Stage | null {
    if (index < 0) return null;
    if (!this.firstSeen.has(index)) this.firstSeen.set(index, distM);
    const th = thresholds(fast);
    let hit: Stage | null = null;
    for (const s of STAGES) if (distM <= th[s]) hit = s; // closest applicable stage
    if (!hit) return null;
    const key = `${index}:${hit}`;
    if (this.done.has(key)) return null;
    // mark this and all earlier stages as done
    for (const s of STAGES) { this.done.add(`${index}:${s}`); if (s === hit) break; }
    // If this maneuver was already inside the "far" zone when it became next
    // (short gap after the previous turn), skip "far" — "mid"/"now" still come.
    if (hit === "far" && (this.firstSeen.get(index) ?? Infinity) < th.far) return null;
    return hit;
  }

  reset() { this.done.clear(); this.firstSeen.clear(); }
}

// --- speech output -------------------------------------------------------
// Delegates to the TTS module (Piper neural voice or the best system voice).
export { prepare as preparePrompts, warmUp as warmUpVoice } from "./tts";

export function speak(text: string, lang: Lang) { void say(text, lang); }
export function stopSpeaking() { stopAll(); }

/** The texts this maneuver will produce, for pre-rendering (thresholds, not live distances). */
export function plannedPrompts(m: FlatManeuver, fast: boolean, lang: Lang, finalStop: boolean): string[] {
  const th = thresholds(fast);
  return (["far", "mid", "now"] as Stage[]).map((s) => promptText(m, s, th[s], lang, finalStop));
}
