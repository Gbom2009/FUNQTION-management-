// Barcode/QR reading and writing with zxing-wasm, loaded on demand.
// The .wasm files are bundled with the app (not fetched from a CDN), so
// scanning and label printing work offline, in the exe and on iPhone.
import readerWasm from 'zxing-wasm/reader/zxing_reader.wasm?url';
import writerWasm from 'zxing-wasm/writer/zxing_writer.wasm?url';
import { barsFromSvg, type Bars } from './domain/barcode';

let reader: Promise<typeof import('zxing-wasm/reader')> | null = null;
let writer: Promise<typeof import('zxing-wasm/writer')> | null = null;

function getReader() {
  reader ??= import('zxing-wasm/reader').then(async (m) => {
    await m.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? readerWasm : prefix + path) }, fireImmediately: true });
    return m;
  });
  return reader;
}

function getWriter() {
  writer ??= import('zxing-wasm/writer').then(async (m) => {
    await m.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? writerWasm : prefix + path) }, fireImmediately: true });
    return m;
  });
  return writer;
}

/** Decode one QR code or Code 128 barcode from a camera frame. */
export async function decodeFrame(img: ImageData): Promise<string | null> {
  const m = await getReader();
  const r = await m.readBarcodes(img, { formats: ['QRCode', 'Code128'], tryHarder: true, maxNumberOfSymbols: 1 });
  return r.find((x) => x.isValid)?.text ?? null;
}

/** Bars of a Code 128 barcode, for drawing it in a PDF label. */
export async function code128(text: string): Promise<Bars> {
  const m = await getWriter();
  const w = await m.writeBarcode(text, { format: 'Code128', scale: 1, addQuietZones: false });
  if (w.error) throw new Error(w.error);
  return barsFromSvg(w.svg);
}

export async function code128Map(codes: string[]): Promise<Record<string, Bars>> {
  const out: Record<string, Bars> = {};
  for (const c of codes) out[c] = await code128(c);
  return out;
}
