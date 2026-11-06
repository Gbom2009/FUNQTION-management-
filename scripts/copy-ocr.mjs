// Copies the on-device OCR engine (Tesseract) and Dutch language data into
// public/ocr so receipt scanning works offline, in the exe and on the phone.
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
mkdirSync(out, { recursive: true });
const files = [
  [join(dirname(require.resolve('tesseract.js/package.json')), 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(dirname(require.resolve('tesseract.js-core/package.json')), 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(dirname(require.resolve('@tesseract.js-data/nld/package.json')), '4.0.0', 'nld.traineddata.gz'), 'nld.traineddata.gz'],
];
for (const [src, name] of files) {
  if (!existsSync(src)) throw new Error(`OCR asset missing: ${src}`);
  copyFileSync(src, join(out, name));
}
console.log(`OCR assets copied to ${out}`);
