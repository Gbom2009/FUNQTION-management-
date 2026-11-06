// Browser PDF generation. Loaded on demand so pdfmake (~1 MB) is not part of
// the main bundle. Fonts are inlined, so this works offline and in the exe.
import pdfMake from 'pdfmake/build/pdfmake';
import monoLight from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-300-normal.woff?inline';
import monoRegular from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?inline';
import display from '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff?inline';
import logoSvg from '../../../public/logo.svg?raw';
import { paperLogo } from './domain/pdfDoc';

const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

let ready = false;
function setup() {
  if (ready) return;
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = {
    'mono-300.woff': b64(monoLight), 'mono-400.woff': b64(monoRegular), 'display.woff': b64(display),
  };
  (pdfMake as unknown as { fonts: Record<string, Record<string, string>> }).fonts = {
    Mono: { normal: 'mono-300.woff', bold: 'mono-400.woff', italics: 'mono-300.woff', bolditalics: 'mono-400.woff' },
    Display: { normal: 'display.woff', bold: 'display.woff', italics: 'display.woff', bolditalics: 'display.woff' },
  };
  ready = true;
}

export const paperLogoSvg = paperLogo(logoSvg);

export function pdfBlob(definition: unknown): Promise<Blob> {
  setup();
  return new Promise((resolve) => {
    (pdfMake.createPdf(definition as never) as unknown as { getBlob: (cb: (b: Blob) => void) => void }).getBlob(resolve);
  });
}
