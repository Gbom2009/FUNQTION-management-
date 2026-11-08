// DMX patch logic. The DIP part is Gijs's calculator (tools/dmx-calculator/)
// per fixture, with two fixes: addresses the switches can't reach are refused
// instead of silently showing the pattern for 255, and address 0 is invalid.

export interface DipConfig {
  switches: number;      // DIP switches on the fixture (often 10)
  addressBits: number;   // how many of them set the address (8 = up to 255, 9 = up to 511)
  plusOne: boolean;      // fixture counts from 0: address = binary sum + 1
}
export const DEFAULT_DIP: DipConfig = { switches: 10, addressBits: 8, plusOne: false };

export const maxAddress = (c: DipConfig) => Math.min(512, (2 ** c.addressBits - 1) + (c.plusOne ? 1 : 0));

/** Switches → address (null when the result is not a valid DMX address). */
export function addressFromDip(bits: boolean[], c: DipConfig): number | null {
  let sum = 0;
  for (let i = 0; i < c.addressBits; i++) if (bits[i]) sum += 2 ** i;
  const a = sum + (c.plusOne ? 1 : 0);
  return a >= 1 && a <= 512 ? a : null;
}

export type DipResult = { ok: true; bits: boolean[] } | { ok: false; reason: 'range' | 'too_high'; max: number };
/** Address → switches (switch 1 first). */
export function dipFor(address: number, c: DipConfig): DipResult {
  const max = maxAddress(c);
  if (!Number.isInteger(address) || address < 1 || address > 512) return { ok: false, reason: 'range', max };
  if (address > max) return { ok: false, reason: 'too_high', max };
  const value = address - (c.plusOne ? 1 : 0);
  return { ok: true, bits: Array.from({ length: c.switches }, (_, i) => i < c.addressBits && ((value >> i) & 1) === 1) };
}
export const dipPattern = (bits: boolean[]) => bits.map((b) => (b ? '1' : '0')).join('-');

export interface PatchFixture { id: string; name: string; universe: number; address: number; channels: number }

/** First address after the last fixture on that universe where `channels` still fit. */
export function nextFreeAddress(fixtures: PatchFixture[], universe: number, channels: number): number | null {
  const used = fixtures.filter((f) => f.universe === universe).map((f) => [f.address, f.address + f.channels - 1] as const).sort((a, b) => a[0] - b[0]);
  let start = 1;
  for (const [a, b] of used) {
    if (start + channels - 1 < a) return start;
    start = Math.max(start, b + 1);
  }
  return start + channels - 1 <= 512 ? start : null;
}

/** Pairs of fixtures whose channel ranges overlap on the same universe. */
export function overlaps(fixtures: PatchFixture[]): [PatchFixture, PatchFixture][] {
  const out: [PatchFixture, PatchFixture][] = [];
  for (let i = 0; i < fixtures.length; i++) for (let j = i + 1; j < fixtures.length; j++) {
    const a = fixtures[i], b = fixtures[j];
    if (a.universe !== b.universe) continue;
    if (a.address <= b.address + b.channels - 1 && b.address <= a.address + a.channels - 1) out.push([a, b]);
  }
  return out;
}
export const endAddress = (f: Pick<PatchFixture, 'address' | 'channels'>) => f.address + f.channels - 1;
