// Web MIDI output (Chrome/Edge on the DJ laptop). Daslight and SoundSwitch
// listen to a virtual MIDI port: the IAC driver on a Mac, loopMIDI on Windows.
// Safari has no Web MIDI; the desktop app gets native MIDI later.

type Out = { name?: string | null; send: (data: number[]) => void };
type Access = { outputs: Map<string, Out>; onstatechange: ((e: unknown) => void) | null };

let access: Access | null = null;
const listeners = new Set<() => void>();

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export async function connectMidi(): Promise<{ ok: boolean; error?: string }> {
  if (!midiSupported()) return { ok: false, error: 'unsupported' };
  try {
    access = (await (navigator as unknown as { requestMIDIAccess: () => Promise<Access> }).requestMIDIAccess()) ;
    access.onstatechange = () => listeners.forEach((l) => l());
    listeners.forEach((l) => l());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export const midiConnected = () => !!access;
export function outputNames(): string[] {
  return access ? [...access.outputs.values()].map((o) => o.name ?? '?') : [];
}
export function onMidiChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Send to the named output (or the only one). Returns false when nothing could be sent. */
export function sendMidi(output: string | undefined, bytes: number[]): boolean {
  if (!access || !bytes.length) return false;
  const outs = [...access.outputs.values()];
  const o = outs.find((x) => x.name === output) ?? (outs.length === 1 ? outs[0] : undefined);
  if (!o) return false;
  try { o.send(bytes); return true; } catch { return false; }
}
