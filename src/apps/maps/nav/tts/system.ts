import type { Lang } from "../../i18n";

/**
 * System voices (Web Speech API). Quality differs hugely per device, so we
 * rank voices: neural/"Natural"/premium/enhanced first, then on-device ones.
 * On iPhone: Settings → Accessibility → Spoken Content → Voices → Dutch → download
 * "Xander (Enhanced)" or "Claire (Enhanced)" for a much better voice.
 */
const GOOD = /natural|neural|premium|enhanced|verbeterd|siri|wavenet|online/i;

export function voiceScore(v: Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">, lang: Lang): number {
  const want = lang === "nl" ? "nl" : "en";
  const l = v.lang.toLowerCase().replace("_", "-");
  if (!l.startsWith(want)) return -1;
  let s = 10;
  if (lang === "nl" && l === "nl-nl") s += 5;          // Dutch over Flemish by default
  if (lang === "en" && (l === "en-gb" || l === "en-us")) s += 3;
  if (GOOD.test(v.name)) s += 20;
  if (v.localService) s += 2;                          // works offline
  if (/compact|eloquence|espeak/i.test(v.name)) s -= 8; // the robotic ones
  return s;
}

export function systemVoices(lang: Lang): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices()
    .filter((v) => voiceScore(v, lang) >= 0)
    .sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang));
}

export function pickSystemVoice(lang: Lang, preferredUri: string): SpeechSynthesisVoice | null {
  const list = systemVoices(lang);
  return list.find((v) => v.voiceURI === preferredUri) ?? list[0] ?? null;
}

/** Voices load asynchronously in Chromium; resolve once they are there. */
export function voicesReady(): Promise<void> {
  if (typeof speechSynthesis === "undefined" || speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { speechSynthesis.removeEventListener("voiceschanged", done); res(); };
    speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, 2000);
  });
}

export function speakSystem(text: string, lang: Lang, opts: { voiceUri: string; rate: number; volume: number }): Promise<void> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "nl" ? "nl-NL" : "en-GB";
    const v = pickSystemVoice(lang, opts.voiceUri);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = opts.rate;
    u.volume = opts.volume;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel(); // newest instruction wins
    speechSynthesis.speak(u);
  });
}

export function stopSystem() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
