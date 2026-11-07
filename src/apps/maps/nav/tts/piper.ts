// onnxruntime-web doesn’t export its .wasm files, so reference the file directly
import ortWasmUrl from "../../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { PIPER_VOICES, useVoice, type PiperVoiceId } from "./store";

/**
 * Piper neural TTS (open source, MIT) running fully on the device in
 * WebAssembly. The voice model (~60–80 MB) and the Piper phonemizer (~18 MB)
 * are downloaded once, on request, and kept on the device — after that the
 * voice works offline. ONNX Runtime itself is bundled with the app.
 *
 * Navigation prompts are known in advance, so `prepare()` synthesises them in
 * the background; when it's time to speak there is no delay.
 */

// ONNX Runtime ships inside the app (Vite bundles its wasm, ~3.9 MB gzipped),
// so its version always matches. Only the Piper phonemizer (espeak-ng data)
// and the voice model are downloaded, once.
const RUNTIME = {
  piperWasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  piperData: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
};
const CACHE = "fq-tts-runtime-v1";

type Session = { predict(text: string, urgent?: boolean): Promise<Blob> };

/**
 * Voices newer than the library’s built-in list live in the official
 * rhasspy/piper-voices repo. The library builds URLs as `${HF_BASE}/${path}`
 * (HF_BASE = .../diffusionstudio/piper-voices/resolve/main), so a path that
 * climbs out of it lands on rhasspy’s repo; fetch() normalises the "..".
 */
let registered = false;
async function registerExtraVoices() {
  if (registered) return;
  const lib = await import("@mintplex-labs/piper-tts-web");
  const map = lib.PATH_MAP as Record<string, string>;
  for (const v of PIPER_VOICES) {
    if (v.extra && !map[v.id]) map[v.id] = `../../../../rhasspy/piper-voices/resolve/main/${v.extra}/${v.id}.onnx`;
  }
  registered = true;
}

/**
 * The official rhasspy configs of single-speaker voices have no
 * "speaker_id_map", which the library reads unconditionally. Add an empty one
 * to the copy stored on the device (OPFS), before a session is created.
 */
async function fixStoredConfig(voiceId: PiperVoiceId) {
  if (!PIPER_VOICES.find((v) => v.id === voiceId)?.extra) return;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("piper");
      const h = await dir.getFileHandle(`${voiceId}.onnx.json`);
      const cfg = JSON.parse(await (await h.getFile()).text()) as Record<string, unknown>;
      if (cfg.speaker_id_map && typeof cfg.speaker_id_map === "object") return;
      cfg.speaker_id_map = {};
      const w = await h.createWritable();
      await w.write(JSON.stringify(cfg));
      await w.close();
      return;
    } catch {
      // the library writes downloads without awaiting them — give it a moment
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
let session: Session | null = null;
let sessionVoice: PiperVoiceId | null = null;
let loading: Promise<Session> | null = null;

/** Fetch through Cache Storage (offline after the first time) and return a blob: URL. */
async function cachedUrl(url: string, onBytes?: (loaded: number) => void): Promise<string> {
  let res: Response | undefined;
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); res = await cache.match(url); } catch { /* no Cache Storage */ }
  if (!res) {
    const net = await fetch(url);
    if (!net.ok) throw new Error(`${new URL(url).pathname.split("/").pop()}: HTTP ${net.status}`);
    const blob = await readWithProgress(net, onBytes);
    res = new Response(blob, { headers: { "Content-Type": net.headers.get("Content-Type") ?? "application/octet-stream" } });
    try { await cache?.put(url, res.clone()); } catch { /* quota: still works this session */ }
  }
  return URL.createObjectURL(await res.blob());
}

async function readWithProgress(r: Response, onBytes?: (n: number) => void): Promise<Blob> {
  if (!r.body || !onBytes) return r.blob();
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes(n);
  }
  return new Blob(parts as BlobPart[]);
}

async function runtimeCached(): Promise<boolean> {
  try {
    const c = await caches.open(CACHE);
    return (await Promise.all(Object.values(RUNTIME).map((u) => c.match(u)))).every(Boolean);
  } catch { return false; }
}

/** Download voice model + runtime with progress. */
export async function downloadVoice(voiceId: PiperVoiceId, totalMb: number): Promise<void> {
  const st = useVoice.getState();
  st.set({ status: "downloading", progress: 0, error: null });
  try {
    await registerExtraVoices();
    const piper = await import("@mintplex-labs/piper-tts-web");
    // phonemizer ≈ 18 MB, model ≈ totalMb
    const total = (totalMb + 18) * 1e6;
    let runtimeBytes = 0, modelBytes = 0;
    const report = () => useVoice.getState().set({ progress: Math.min(0.99, (runtimeBytes + modelBytes) / total) });
    const before: Record<string, number> = {};
    for (const [k, u] of Object.entries(RUNTIME)) {
      const url = await cachedUrl(u, (n) => { before[k] = n; runtimeBytes = Object.values(before).reduce((a, b) => a + b, 0); report(); });
      URL.revokeObjectURL(url);
    }
    await piper.download(voiceId, (p: { loaded: number; total: number }) => { modelBytes = p.loaded; report(); });
    await fixStoredConfig(voiceId);
    const s = useVoice.getState();
    s.set({ downloaded: [...new Set([...s.downloaded, voiceId])], status: "none", progress: 1 });
    await loadSession(voiceId);
  } catch (e) {
    useVoice.getState().set({ status: "error", error: (e as Error).message });
    throw e;
  }
}

export async function removeVoice(voiceId: PiperVoiceId) {
  await registerExtraVoices();
  const piper = await import("@mintplex-labs/piper-tts-web");
  await piper.remove(voiceId).catch(() => undefined);
  const s = useVoice.getState();
  s.set({ downloaded: s.downloaded.filter((v) => v !== voiceId) });
  if (sessionVoice === voiceId) { session = null; sessionVoice = null; }
}

/** Create (or reuse) the inference session for a voice. */
export function loadSession(voiceId: PiperVoiceId): Promise<Session> {
  if (session && sessionVoice === voiceId) return Promise.resolve(session);
  if (loading && sessionVoice === voiceId) return loading;
  sessionVoice = voiceId;
  cache.clear();
  useVoice.getState().set({ status: "loading", error: null });
  loading = (async () => {
    await registerExtraVoices();
    if (!(await runtimeCached()) && !navigator.onLine) throw new Error("offline: runtime not downloaded");
    const [piperWasm, piperData] = await Promise.all([cachedUrl(RUNTIME.piperWasm), cachedUrl(RUNTIME.piperData)]);
    const ortWasm = new URL(ortWasmUrl, location.href).href;
    await fixStoredConfig(voiceId);
    const lib = await import("@mintplex-labs/piper-tts-web");
    const extraPaths: Record<string, string> = {};
    for (const v of PIPER_VOICES) if (v.extra) extraPaths[v.id] = (lib.PATH_MAP as Record<string, string>)[v.id];
    // inference runs in a worker so the map and HUD never freeze while a sentence is synthesised
    const s = await workerSession(voiceId, extraPaths, { onnxWasm: { wasm: ortWasm }, piperWasm, piperData });
    session = s;
    useVoice.getState().set({ status: "ready" });
    return s;
  })().catch((e) => {
    session = null; sessionVoice = null; loading = null;
    useVoice.getState().set({ status: "error", error: (e as Error).message });
    throw e;
  });
  return loading;
}

// --- worker client: one job at a time, urgent jobs first ----------------------
let worker: Worker | null = null;
let busy = false;
let nextId = 1;
const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
const urgentQ: { id: number; text: string }[] = [];
const backgroundQ: { id: number; text: string }[] = [];

function pumpWorker() {
  if (!worker || busy) return;
  const job = urgentQ.shift() ?? backgroundQ.shift();
  if (!job) return;
  busy = true;
  worker.postMessage({ type: "predict", id: job.id, text: job.text });
}

function workerSession(voiceId: string, extraPaths: Record<string, string>, wasmPaths: unknown): Promise<Session> {
  worker?.terminate();
  worker = new Worker(new URL("./piper.worker.ts", import.meta.url), { type: "module" });
  busy = false;
  urgentQ.length = 0; backgroundQ.length = 0;
  for (const p of pending.values()) p.reject(new Error("voice reloaded"));
  pending.clear();
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent<{ type: string; id?: number; blob?: Blob; message?: string }>) => {
      const m = e.data;
      if (m.type === "loaded") {
        resolve({
          predict: (text: string, urgent = false) => new Promise<Blob>((res, rej) => {
            const id = nextId++;
            pending.set(id, { resolve: res, reject: rej });
            (urgent ? urgentQ : backgroundQ).push({ id, text });
            pumpWorker();
          }),
        } as Session);
        return;
      }
      if (m.type === "result" || m.type === "error") {
        if (m.id !== undefined) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (m.type === "result" && m.blob) p?.resolve(m.blob); else p?.reject(new Error(m.message ?? "piper error"));
        } else if (m.type === "error") {
          reject(new Error(m.message));
        }
        busy = false;
        pumpWorker();
      }
    };
    worker!.onerror = (e) => reject(new Error(e.message || "piper worker failed"));
    worker!.postMessage({ type: "load", voiceId, extraPaths, wasmPaths });
  });
}

// --- synthesis cache + playback ------------------------------------------
const cache = new Map<string, Promise<Blob>>();
const MAX_CACHE = 40;

function synth(text: string, urgent = false): Promise<Blob> {
  const hit = cache.get(text);
  if (hit) { cache.delete(text); cache.set(text, hit); return hit; } // LRU touch
  if (!session) return Promise.reject(new Error("piper not ready"));
  const p = session.predict(text, urgent);
  cache.set(text, p);
  p.catch(() => cache.delete(text));
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

/** Synthesise upcoming prompts in the background (the worker does one at a time). */
const MAX_BACKGROUND = 6;
export function preparePiper(texts: string[]) {
  if (!session) return;
  for (const t of texts) {
    if (cache.has(t) || backgroundQ.length >= MAX_BACKGROUND) continue;
    void synth(t).catch(() => undefined);
  }
}

let audio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function piperReady(): boolean { return !!session; }

export async function speakPiper(text: string, opts: { rate: number; volume: number }): Promise<void> {
  const blob = await synth(text, true);
  stopPiper();
  currentUrl = URL.createObjectURL(blob);
  audio = new Audio(currentUrl);
  audio.playbackRate = opts.rate;
  (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  audio.volume = opts.volume;
  await audio.play();
  await new Promise<void>((res) => { audio!.onended = () => res(); audio!.onerror = () => res(); });
}

export function stopPiper() {
  if (audio) { audio.pause(); audio.src = ""; audio = null; }
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
}

/** iOS only plays audio after a user gesture: call this from a tap (e.g. "Start"). */
export function unlockAudio() {
  try {
    const a = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=");
    a.volume = 0;
    void a.play().catch(() => undefined);
  } catch { /* ignore */ }
}
