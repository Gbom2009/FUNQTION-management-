import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GearItem, PackLine } from '../../../core/types';
import { ancestry, applyScan, defaultLabelType, descendants, generateLines, progress, treeLines, wouldCycle } from './gear';
import { barsFromSvg } from './barcode';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const item = (id: string, p: Partial<GearItem> = {}): GearItem => ({
  ...base, id, code: `FQ-${id.padStart(4, '0')}`, kind: 'unique', name: id, category: 'decks', quantity: 1, owner: 'gijs', status: 'available',
  transport: 'car', electrical: 'class1', usageHours: 0, usageGigs: 0, ...p,
});
// Flight case (case) → XDJ-AZ (az) + power cable (pc); the rack holds a sub-case with a DMX box.
const items = [
  item('case', { kind: 'container', category: 'cases', name: 'Flightcase XDJ-AZ' }), item('az', { parentId: 'case', name: 'XDJ-AZ' }), item('pc', { parentId: 'case', category: 'power', name: 'Stroomkabel' }),
  item('rack', { kind: 'container', category: 'cases' }), item('sub', { kind: 'container', category: 'cases', parentId: 'rack' }), item('dmx', { parentId: 'sub', category: 'dmx' }),
];
const line = (itemId: string, p: Partial<PackLine> = {}): PackLine => ({ id: `l-${itemId}`, itemId, qty: 1, source: 'kit', reason: '', out: 0, back: 0, ...p });

describe('gear tree', () => {
  it('finds everything inside a case at any depth, and refuses loops', () => {
    expect(descendants('case', items).sort()).toEqual(['az', 'pc']);
    expect(descendants('rack', items).sort()).toEqual(['dmx', 'sub']);
    expect(ancestry('dmx', items)).toEqual(['rack', 'sub', 'dmx']);
    expect(wouldCycle('rack', 'dmx', items)).toBe(true);
    expect(wouldCycle('rack', 'rack', items)).toBe(true);
    expect(wouldCycle('az', 'rack', items)).toBe(false);
  });
  it('puts the contents of a case on the packing list with it', () => {
    const kits = [{ ...base, id: 'k', role: 'standard' as const, name: 'Standaard set', lines: [{ itemId: 'case', qty: 1 }, { itemId: 'rack', qty: 1 }] }];
    const lines = generateLines({ gig: { setupRequired: true, setting: '' }, products: [], kits, items }, 'standard', (() => { let n = 0; return () => `x${n++}`; })());
    expect(lines.map((l) => l.itemId).sort()).toEqual(['az', 'case', 'dmx', 'pc', 'rack', 'sub']);
    expect(lines.find((l) => l.itemId === 'az')!.reason).toBe('in Flightcase XDJ-AZ');
    expect(treeLines(lines, items).map((r) => `${'  '.repeat(r.depth)}${r.line.itemId}`)).toEqual(['case', '  pc', '  az', 'rack', '  sub', '    dmx']);
  });
  it('loading in group mode: scanning the case ticks everything in it', () => {
    const list = ['case', 'az', 'pc'].map((id) => line(id));
    const r = applyScan(list, items[0], descendants('case', items), 'out', true);
    expect(r.lines.every((l) => l.out === 1)).toBe(true);
  });
  it('unloading in each mode: scanning the case ticks only the case; every piece must be scanned', () => {
    const list = ['case', 'az', 'pc'].map((id) => line(id, { out: 1 }));
    let r = applyScan(list, items[0], descendants('case', items), 'back', false);
    expect(r.lines.map((l) => l.back)).toEqual([1, 0, 0]);
    expect(progress(r.lines, 'back')).toMatchObject({ done: 1, lines: 3 });
    r = applyScan(r.lines, items[1], [], 'back', false);
    r = applyScan(r.lines, items[2], [], 'back', false);
    expect(progress(r.lines, 'back')).toMatchObject({ done: 3, lines: 3 });
  });
  it('items marked "not taken" are skipped by a case scan, but scanning them yourself takes them after all', () => {
    const list = [line('case'), line('az'), line('pc', { skip: true })];
    let r = applyScan(list, items[0], descendants('case', items), 'out', true);
    expect(r.lines.find((l) => l.itemId === 'pc')).toMatchObject({ out: 0, skip: true });
    expect(progress(r.lines, 'out')).toMatchObject({ done: 2, lines: 2 });
    r = applyScan(r.lines, items[2], [], 'out', true);
    expect(r.lines.find((l) => l.itemId === 'pc')).toMatchObject({ out: 1, skip: false });
  });
  it('taking only the controller without its case', () => {
    const list = ['case', 'az', 'pc'].map((id) => line(id));
    const r = applyScan(list, items[1], [], 'out', true);
    expect(r.lines.map((l) => l.out)).toEqual([0, 1, 0]);
  });
  it('suggests barcodes for cables and big QR codes for cases', () => {
    expect(defaultLabelType(items[2])).toBe('barcode');
    expect(defaultLabelType(items[0])).toBe('qr_large');
    expect(defaultLabelType(items[1])).toBe('qr_small');
  });
});

describe('barcodes (zxing-wasm, local wasm files)', () => {
  it('writes Code 128, turns it into PDF bars, and reads the redrawn bars back', async () => {
    const W = await import('zxing-wasm/writer');
    const R = await import('zxing-wasm/reader');
    await W.prepareZXingModule({ overrides: { wasmBinary: readFileSync('node_modules/zxing-wasm/dist/writer/zxing_writer.wasm') as unknown as ArrayBuffer }, fireImmediately: true });
    await R.prepareZXingModule({ overrides: { wasmBinary: readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') as unknown as ArrayBuffer }, fireImmediately: true });
    for (const code of ['FQ-0001', 'FQ-0042', 'FQ-1234']) {
      const w = await W.writeBarcode(code, { format: 'Code128', scale: 1, addQuietZones: false });
      const b = barsFromSvg(w.svg);
      expect(b.bars.length).toBeGreaterThan(10);
      // Redraw exactly what the PDF draws (3 px per module, quiet zone) and read it.
      const scale = 3; const quiet = 12; const h = 40;
      const width = (b.modules + quiet * 2) * scale;
      const data = new Uint8ClampedArray(width * h * 4).fill(255);
      for (const [x, bw] of b.bars) for (let y = 0; y < h; y++) for (let px = (x + quiet) * scale; px < (x + bw + quiet) * scale; px++) { const o = (y * width + px) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
      const read = await R.readBarcodes({ data, width, height: h, colorSpace: 'srgb' } as ImageData, { formats: ['Code128'] });
      expect(read[0]?.text).toBe(code);
    }
    const q = await W.writeBarcode('FQ-0042', { format: 'QRCode', scale: 4 });
    const back = await R.readBarcodes(new Uint8Array(await q.image!.arrayBuffer()), { formats: ['QRCode', 'Code128'] });
    expect(back[0]?.text).toBe('FQ-0042');
  });
});
