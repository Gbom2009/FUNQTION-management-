import { describe, expect, it } from 'vitest';
import { addressFromDip, dipFor, dipPattern, maxAddress, nextFreeAddress, overlaps, DEFAULT_DIP } from './dmx';
import { bpmFromTaps, duplicateMidi, laserGate, laserHours, midiBytes, nextMoment, visibleScenes, type CueLike } from './live';

describe('DIP switches (Gijs\'s calculator)', () => {
  it('matches the original for normal addresses', () => {
    const r = dipFor(11, DEFAULT_DIP);
    expect(r.ok && dipPattern(r.bits)).toBe('1-1-0-1-0-0-0-0-0-0');
    expect(addressFromDip([true, true, false, true], DEFAULT_DIP)).toBe(11);
  });
  it('supports fixtures that count from 0', () => {
    const c = { ...DEFAULT_DIP, plusOne: true };
    const r = dipFor(11, c);
    expect(r.ok && dipPattern(r.bits).slice(0, 7)).toBe('0-1-0-1');
    expect(maxAddress(c)).toBe(256);
  });
  it('refuses addresses the switches cannot reach (the old version showed 255)', () => {
    expect(dipFor(300, DEFAULT_DIP)).toEqual({ ok: false, reason: 'too_high', max: 255 });
    const nine = { ...DEFAULT_DIP, addressBits: 9 };
    const r = dipFor(300, nine);
    expect(r.ok && r.bits[8]).toBe(true);
    expect(dipFor(0, DEFAULT_DIP)).toMatchObject({ ok: false, reason: 'range' });
  });
  it('treats all switches off as invalid (address 0)', () => {
    expect(addressFromDip([], DEFAULT_DIP)).toBeNull();
    expect(addressFromDip([], { ...DEFAULT_DIP, plusOne: true })).toBe(1);
  });
});

describe('patch', () => {
  const f = (id: string, address: number, channels: number, universe = 1) => ({ id, name: id, universe, address, channels });
  it('finds the next free address, also in gaps', () => {
    expect(nextFreeAddress([], 1, 8)).toBe(1);
    expect(nextFreeAddress([f('a', 1, 8), f('b', 9, 14)], 1, 8)).toBe(23);
    expect(nextFreeAddress([f('a', 1, 8), f('b', 20, 14)], 1, 8)).toBe(9);
    expect(nextFreeAddress([f('a', 1, 8), f('b', 20, 14)], 1, 12)).toBe(34);
    expect(nextFreeAddress([f('a', 1, 508)], 1, 8)).toBeNull();
    expect(nextFreeAddress([f('a', 1, 8)], 2, 8)).toBe(1);
  });
  it('flags overlapping channels on the same universe only', () => {
    const o = overlaps([f('bar', 1, 14), f('par', 10, 8), f('laser', 1, 10, 2)]);
    expect(o.map(([a, b]) => `${a.id}/${b.id}`)).toEqual(['bar/par']);
  });
});

describe('MIDI', () => {
  it('encodes notes, CC and program changes', () => {
    expect(midiBytes({ type: 'note', channel: 1, number: 60, value: 127 })).toEqual([0x90, 60, 127]);
    expect(midiBytes({ type: 'note', channel: 2, number: 60, value: 127 }, 'release')).toEqual([0x81, 60, 0]);
    expect(midiBytes({ type: 'cc', channel: 16, number: 7, value: 200 })).toEqual([0xbf, 7, 127]);
    expect(midiBytes({ type: 'pc', channel: 1, number: 5, value: 0 })).toEqual([0xc0, 5]);
  });
  it('finds the same message mapped twice', () => {
    const m = { type: 'note' as const, channel: 1, number: 60, value: 127 };
    const d = duplicateMidi([{ id: 'a', controller: 'soundswitch', midi: m }, { id: 'b', controller: 'soundswitch', midi: m }, { id: 'c', controller: 'daslight', midi: m }]);
    expect(d.map(([a, b]) => a.id + b.id)).toEqual(['ab']);
  });
});

describe('tap tempo', () => {
  it('reads 128 BPM and ignores an old pause', () => {
    const iv = 60000 / 128;
    const taps = [0, 5000, 5000 + iv, 5000 + 2 * iv, 5000 + 3 * iv, 5000 + 4 * iv];
    expect(bpmFromTaps(taps)).toBe(128);
    expect(bpmFromTaps([0, 500])).toBeNull();
  });
});

describe('laser gate', () => {
  const all = { aboveHeads: true, noReflections: true, safetyCable: true, venueOk: true };
  it('needs the checklist and, without a remote e-stop, an operator at the key', () => {
    expect(laserGate({ checks: {}, remoteEstop: false, operatorAtKey: false, crowdScan: false }).blocks).toEqual(['checklist', 'operator_at_key']);
    expect(laserGate({ checks: all, remoteEstop: false, operatorAtKey: true, crowdScan: false }).allowed).toBe(true);
    expect(laserGate({ checks: all, remoteEstop: true, operatorAtKey: false, crowdScan: false }).allowed).toBe(true);
  });
  it('blocks audience scanning without e-stop, permission and a measurement', () => {
    const g = laserGate({ checks: all, remoteEstop: false, operatorAtKey: true, crowdScan: true, crowdPermission: 'Lisa' });
    expect(g.blocks).toEqual(['crowd_without_estop', 'crowd_not_measured']);
    expect(laserGate({ checks: all, remoteEstop: true, operatorAtKey: false, crowdScan: true, crowdPermission: 'Lisa', crowdMeasured: true }).allowed).toBe(true);
  });
  it('adds up laser hours from the log', () => {
    expect(laserHours([{ at: '2026-12-12T20:00:00Z', event: 'laser_on' }, { at: '2026-12-12T21:30:00Z', event: 'estop' }, { at: '2026-12-12T22:00:00Z', event: 'laser_on' }, { at: '2026-12-12T22:30:00Z', event: 'show_end' }])).toBe(2);
  });
});

describe('live screen', () => {
  const cue = (id: string, p: Partial<CueLike>): CueLike => ({ id, kind: 'scene', eventTypes: [], sections: [], ...p });
  it('shows scenes for the event and section, without strobe where it is off', () => {
    const cues = [cue('warm', { sections: ['warmup'], order: 2 }), cue('peak', { sections: ['peak'] }), cue('strobe', { strobe: true }), cue('carn', { eventTypes: ['carnival'] }), cue('all', { order: 1 }), cue('bo', { kind: 'blackout' })];
    expect(visibleScenes(cues, 'wedding', 'warmup', ['wedding']).map((c) => c.id)).toEqual(['all', 'warm']);
    expect(visibleScenes(cues, 'carnival', 'peak', ['wedding']).map((c) => c.id)).toEqual(['peak', 'strobe', 'carn', 'all']);
  });
  it('announces the next moment within the hour', () => {
    const now = new Date('2026-12-12T20:50:00');
    const steps = [{ kind: 'moment', label: 'Eerste dans', plannedAt: new Date('2026-12-12T21:00:00').toISOString() }, { kind: 'moment', label: 'Taart', plannedAt: new Date('2026-12-12T23:00:00').toISOString() }, { kind: 'setup', label: 'x', plannedAt: new Date('2026-12-12T20:55:00').toISOString() }];
    expect(nextMoment(steps, now)).toEqual({ label: 'Eerste dans', inMin: 10 });
  });
});
