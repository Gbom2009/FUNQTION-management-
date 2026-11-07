import type { Lang } from "../../i18n";
import { useVoice } from "./store";
import { loadSession, piperReady, preparePiper, speakPiper, stopPiper } from "./piper";
import { speakSystem, stopSystem } from "./system";

/**
 * One entry point for speech. Piper (neural, offline) when chosen and loaded;
 * the system voice otherwise — also as fallback if Piper fails mid-drive, so
 * an instruction is never silently dropped. Piper voices are Dutch only, so
 * English UI always uses the system voice.
 */
function usePiper(lang: Lang): boolean {
  const v = useVoice.getState();
  return v.engine === "piper" && lang === "nl" && v.downloaded.includes(v.piperVoice);
}

/** Warm up the chosen engine (call when a drive starts). */
export function warmUp(lang: Lang) {
  const v = useVoice.getState();
  if (usePiper(lang) && !piperReady()) void loadSession(v.piperVoice).catch(() => undefined);
}

export async function say(text: string, lang: Lang): Promise<void> {
  const v = useVoice.getState();
  stopAll();
  if (usePiper(lang)) {
    try {
      if (!piperReady()) await loadSession(v.piperVoice);
      await speakPiper(text, { rate: v.rate, volume: v.volume });
      return;
    } catch {
      /* fall through to the system voice */
    }
  }
  await speakSystem(text, lang, { voiceUri: v.systemVoice, rate: v.rate, volume: v.volume });
}

/** Pre-render prompts that are about to be spoken (Piper only; system TTS is instant). */
export function prepare(texts: string[], lang: Lang) {
  if (usePiper(lang)) preparePiper(texts);
}

export function stopAll() {
  stopPiper();
  stopSystem();
}
