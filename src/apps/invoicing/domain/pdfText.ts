// JetBrains Mono has programming ligatures ("...", "--", "//", "==", "::",
// "<=", "||"). pdfmake's font engine crashes on them with the bundled woff
// ("Trying to access beyond buffer length") and the PDF never finishes. A
// zero-width no-break space (U+FEFF, invisible in this font) between two
// punctuation characters prevents the ligature
// without changing how the text looks.

const PUNCT = /([-=.:/<>|!&*+~_#?;\\^%$@])(?=[-=.:/<>|!&*+~_#?;\\^%$@])/g;
export const breakLigatures = (s: string) => s.replace(PUNCT, '$1\uFEFF');

// Keys whose string values are not visible text.
const SKIP = new Set(['svg', 'image', 'qr', 'font', 'color', 'fillColor', 'background', 'foreground', 'markerColor', 'lineColor',
  'alignment', 'style', 'pageSize', 'pageOrientation', 'widths', 'heights', 'layout', 'link', 'linkToDestination', 'id', 'type', 'decoration', 'decorationStyle', 'decorationColor', 'listType']);

/** Deep copy of a pdfmake definition with ligature-safe text. Functions (header/footer) are wrapped. */
export function safeText<T>(node: T, key?: string): T {
  if (typeof node === 'string') return (key && SKIP.has(key) ? node : breakLigatures(node)) as T;
  if (typeof node === 'function') return ((...args: unknown[]) => safeText((node as (...a: unknown[]) => unknown)(...args))) as T;
  if (Array.isArray(node)) return node.map((x) => safeText(x, key === 'widths' || key === 'heights' ? key : undefined)) as T;
  if (node && typeof node === 'object') {
    if (node instanceof Blob || ArrayBuffer.isView(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = SKIP.has(k) ? v : safeText(v, k);
    return out as T;
  }
  return node;
}
