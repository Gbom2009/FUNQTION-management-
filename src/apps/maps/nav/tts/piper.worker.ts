/// <reference lib="webworker" />
/**
 * Piper inference off the main thread. Synthesising one sentence takes
 * 1–2 s of CPU; on the UI thread that froze the map and HUD. Here it runs in
 * the background while the app stays smooth.
 *
 * The phonemizer is Emscripten code that only recognises a worker via
 * `importScripts` (absent in module workers), so we shim it before loading.
 */
const g = self as unknown as { importScripts?: () => void };
if (typeof g.importScripts !== "function") g.importScripts = () => {};

type Msg =
  | { type: "load"; voiceId: string; extraPaths: Record<string, string>; wasmPaths: { onnxWasm: unknown; piperWasm: string; piperData: string } }
  | { type: "predict"; id: number; text: string };

let session: { predict(text: string): Promise<Blob> } | null = null;
// one job at a time: inference is CPU-bound, interleaving only slows both
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  chain = chain.then(async () => {
    try {
      if (m.type === "load") {
        const lib = await import("@mintplex-labs/piper-tts-web");
        Object.assign(lib.PATH_MAP as Record<string, string>, m.extraPaths);
        (lib.TtsSession as unknown as { _instance: unknown })._instance = null;
        session = await lib.TtsSession.create({ voiceId: m.voiceId, wasmPaths: m.wasmPaths as never });
        self.postMessage({ type: "loaded" });
      } else if (m.type === "predict") {
        if (!session) throw new Error("no voice loaded");
        const blob = await session.predict(m.text);
        self.postMessage({ type: "result", id: m.id, blob });
      }
    } catch (err) {
      self.postMessage({ type: "error", id: (m as { id?: number }).id, message: String((err as Error)?.message ?? err) });
    }
  });
};
