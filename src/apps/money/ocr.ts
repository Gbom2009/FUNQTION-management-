// On-device OCR (Tesseract, Dutch). Assets live in /ocr (copied at build time),
// so this works offline and photos never leave the device. Loaded on demand.
import type { Worker } from 'tesseract.js';

let worker: Promise<Worker> | null = null;

function getWorker() {
  if (!worker) {
    worker = import('tesseract.js').then(({ createWorker }) => {
      const base = new URL('ocr/', document.baseURI).href;
      return createWorker('nld', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
        langPath: base.replace(/\/$/, ''),
        gzip: true,
        workerBlobURL: false,
      });
    });
    worker.catch(() => { worker = null; });
  }
  return worker;
}

export async function ocrImage(blob: Blob): Promise<string> {
  const w = await getWorker();
  const { data } = await w.recognize(blob);
  return data.text;
}

/** Downscale a photo to max 1600 px JPEG (~200–400 KB) for storage and OCR. */
export async function compressImage(file: Blob, max = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', quality));
}

export async function sha256(blob: Blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
