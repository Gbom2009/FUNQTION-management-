import { useEffect, useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section, useToast } from '../../../core/ui';
import { save, uid } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import { download } from '../../../core/backup';
import { GEAR_CATEGORIES, type GearCategory, type GearItem, type LabelPreset, type LabelType, type Paint } from '../../../core/types';
import { useGearItems } from '../data';
import { defaultLabelType } from '../domain/gear';
import { DEFAULT_PRESETS, PAINT, barcodeArt, barcodeSafe, colors, logoArt, presetFor, presetWarnings, presetsFrom, qrArt } from '../domain/labelArt';
import logoSvg from '../../../../public/logo.svg?raw';

const SIZES: LabelType[] = ['qr_large', 'qr_small', 'barcode'];
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export default function Labels() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'print' | 'design'>('print');
  return (
    <div>
      <div className="page-head"><h1>{t('g.labels')}</h1></div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'print'} onClick={() => setTab('print')}>{t('g.lbl.print')}</button>
        <button role="tab" aria-selected={tab === 'design'} onClick={() => setTab('design')}>{t('g.lbl.design')}</button>
      </div>
      {tab === 'print' ? <PrintLabels /> : <DesignLabels />}
    </div>
  );
}

function usePresets() {
  const { settings, updateSettings } = useSession();
  const presets = presetsFrom(settings.gearLabelPresets);
  const store = (list: LabelPreset[]) => updateSettings({ gearLabelPresets: list });
  return { presets, store };
}

// ---------------------------------------------------------------------------
// Print: a design per item (or for a selection), then one PDF

function PrintLabels() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings } = useSession();
  const { presets } = usePresets();
  const items = useGearItems().filter((i) => i.status !== 'disposed').sort((a, b) => a.code.localeCompare(b.code));
  const [cat, setCat] = useState<GearCategory | ''>('');
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const presetOf = (i: GearItem) => presetFor(i, defaultLabelType(i), presets);
  const visible = items.filter((i) => !cat || i.category === cat);
  const chosen = items.filter((i) => sel.includes(i.id));
  const setPreset = (list: GearItem[], p: LabelPreset) => Promise.all(list.map((i) => save<GearItem>('gearItems', { ...i, labelPreset: p.id, labelType: p.size })));
  async function make() {
    setBusy(true);
    try {
      const [{ labelSheets }, { pdfBlob }, zx] = await Promise.all([import('../domain/pdfDocs'), import('../../invoicing/pdf'), import('../zxing')]);
      const sections = presets.map((preset) => ({ preset, items: chosen.filter((i) => presetOf(i).id === preset.id) })).filter((s) => s.items.length);
      const qr: Record<string, { size: number; dark: boolean[] }> = {};
      const bars: Record<string, Awaited<ReturnType<typeof zx.code128>>> = {};
      for (const s of sections) for (const it of s.items) {
        if (s.preset.size === 'barcode') bars[it.code] = await zx.code128(it.code);
        else qr[it.code] = await zx.qrMatrix(it.code, s.preset.logo);
      }
      const owner = `${t('g.propertyOf')} ${settings.businessName}${settings.bizPhone ? ` · ${settings.bizPhone}` : ''}`;
      download(`funqtion-labels-${todayStr()}.pdf`, await pdfBlob(labelSheets(sections, owner, { qr, bars, logoSvg })), 'application/pdf');
    } catch (e) {
      toast(String(e));
    } finally { setBusy(false); }
  }
  const counts = presets.map((p) => [p, chosen.filter((i) => presetOf(i).id === p.id).length] as const).filter(([, n]) => n);
  const options = SIZES.map((size) => (
    <optgroup key={size} label={t(`g.label.${size}`)}>{presets.filter((p) => p.size === size).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
  ));
  return (
    <>
      <div className="row" style={{ margin: 'var(--s3) 0', flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value as GearCategory | '')} aria-label={t('g.category')}><option value="">{t('g.allCategories')}</option>{GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{t(`g.cat.${c}`)}</option>)}</select>
        <button className="chip" onClick={() => setSel([...new Set([...sel, ...visible.map((i) => i.id)])])}>{t('g.selectVisible')}</button>
        <button className="chip" onClick={() => setSel([])}>{t('g.selectNone')}</button>
        <span className="grow" />
        <button className="btn primary" disabled={!chosen.length || busy} onClick={make}>{t('g.makePdf', { n: chosen.length })}</button>
      </div>
      <p className="small muted">{t('g.labelsHint3')}</p>
      {chosen.length > 0 && (
        <div className="card row" style={{ margin: 'var(--s3) 0', flexWrap: 'wrap' }}>
          <span className="small grow">{t('g.selectedN', { n: chosen.length })} · {counts.map(([p, n]) => `${p.name} ${n}`).join(' · ')}</span>
          <select className="input" style={{ width: 'auto' }} value="" aria-label={t('g.setAllTo')} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) setPreset(chosen, p); }}>
            <option value="">{t('g.setAllTo')}</option>{options}
          </select>
        </div>
      )}
      <div className="list">{visible.map((i) => (
        <div key={i.id} className="list-item" style={{ minHeight: 48 }}>
          <label className="check grow" style={{ minHeight: 0 }}><input type="checkbox" checked={sel.includes(i.id)} onChange={(e) => setSel(e.target.checked ? [...sel, i.id] : sel.filter((x) => x !== i.id))} />
            <span className="mono">{i.code}</span> {i.name}{i.kind === 'counted' ? <span className="tiny muted"> ({t('g.oneLabelForGroup')})</span> : null}</label>
          <select className="input" style={{ width: 'auto', maxWidth: 190 }} value={presetOf(i).id} aria-label={t('g.labelType')} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) setPreset([i], p); }}>{options}</select>
        </div>
      ))}</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Design: edit designs with a live preview

function DesignLabels() {
  const { t } = useI18n();
  const toast = useToast();
  const { presets, store } = usePresets();
  const [id, setId] = useState(presets[1]?.id ?? presets[0].id);
  const current = presets.find((p) => p.id === id) ?? presets[0];
  const [d, setD] = useState<LabelPreset>(current);
  useEffect(() => setD(current), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const builtIn = DEFAULT_PRESETS.some((x) => x.id === d.id);
  const set = (p: Partial<LabelPreset>) => setD({ ...d, ...p });
  const paint = (k: 'background' | 'symbol', label: string) => (
    <div className="field"><span>{label}</span>
      <div className="chips">{(['black', 'white', 'orange'] as Paint[]).map((c) => (
        <button key={c} className="chip" aria-pressed={d[k] === c} onClick={() => set({ [k]: c } as Partial<LabelPreset>)}><span className="swatch" style={{ background: PAINT[c] }} />{t(`g.paint.${c}`)}</button>
      ))}</div>
    </div>
  );
  const toggle = (k: 'patch' | 'logo' | 'showCode' | 'showName' | 'showOwner' | 'showTagline', label: string) => (
    <label className="check"><input type="checkbox" checked={!!d[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<LabelPreset>)} />{label}</label>
  );
  const warnings = presetWarnings(d);
  return (
    <div className="layout-2" style={{ marginTop: 'var(--s4)' }}>
      <div>
        <Section title={t('g.lbl.preview')}>
          <LabelPreview preset={d} />
          <div className="row" style={{ marginTop: 'var(--s3)', gap: 'var(--s4)', flexWrap: 'wrap' }}>
            <LabelPreview preset={d} code="FQ-0103" name="Kabeltas" small />
          </div>
          {warnings.map((w) => <div key={w} className={`banner ${w === 'invisible' ? 'danger' : 'warn'}`} style={{ marginTop: 'var(--s2)' }}><span>!</span><div className="txt small">{t(`g.lblWarn.${w}`)}</div></div>)}
        </Section>
        <Section title={t('g.lbl.designs')}>
          <div className="list">{presets.map((p) => (
            <button key={p.id} className="list-item" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} aria-pressed={p.id === id} onClick={() => setId(p.id)}>
              <span className="swatch big" style={{ background: PAINT[p.background], borderColor: PAINT[p.symbol] }} />
              <span className="grow"><span className="strong">{p.name}</span><br /><span className="tiny muted">{t(`g.label.${p.size}`)}{DEFAULT_PRESETS.some((x) => x.id === p.id) ? '' : ` · ${t('g.lbl.own')}`}</span></span>
              {p.id === id && <span className="pill">✎</span>}
            </button>
          ))}</div>
        </Section>
      </div>
      <Section title={t('g.lbl.edit')}>
        <div className="stack">
          <div className="grid2">
            <Field label={t('g.name')}><input value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label={t('g.lbl.size')}><select value={d.size} onChange={(e) => set({ size: e.target.value as LabelType })}>{SIZES.map((s) => <option key={s} value={s}>{t(`g.lblSize.${s}`)}</option>)}</select></Field>
          </div>
          {paint('background', t('g.lbl.background'))}
          {paint('symbol', d.size === 'barcode' ? t('g.lbl.bars') : t('g.lbl.modules'))}
          {toggle('patch', t('g.lbl.patch'))}
          {d.size === 'barcode' && (barcodeSafe(d).patch !== d.patch || barcodeSafe(d).symbol !== d.symbol) && <p className="tiny muted">{t('g.lbl.barcodeSafe')}</p>}
          {d.size !== 'barcode' && (
            <div className="field"><span>{t('g.lbl.shape')}</span>
              <div className="chips">{(['square', 'rounded', 'dots'] as const).map((m) => <button key={m} className="chip" aria-pressed={d.modules === m} onClick={() => set({ modules: m })}>{t(`g.shape.${m}`)}</button>)}</div>
            </div>
          )}
          {toggle('logo', d.size === 'barcode' ? t('g.lbl.logoSide') : t('g.lbl.logoMiddle'))}
          {d.size !== 'barcode' && (
            <div className="field"><span>{t('g.lbl.frame')}</span>
              <div className="chips">{(['none', 'brackets', 'line'] as const).map((f) => <button key={f} className="chip" aria-pressed={d.frame === f} onClick={() => set({ frame: f })}>{t(`g.frame.${f}`)}</button>)}</div>
            </div>
          )}
          {d.size === 'barcode' && (
            <div className="grid2">
              <div className="field"><span>{t('g.lbl.repeat')}</span><div className="chips">{([1, 2, 3] as const).map((n) => <button key={n} className="chip" aria-pressed={d.repeat === n} onClick={() => set({ repeat: n })}>{n}×</button>)}</div></div>
              <div className="field"><span>{t('g.lbl.barHeight')}</span><div className="chips">{(['low', 'mid', 'high'] as const).map((h) => <button key={h} className="chip" aria-pressed={d.barHeight === h} onClick={() => set({ barHeight: h })}>{t(`g.bh.${h}`)}</button>)}</div></div>
            </div>
          )}
          <div className="field"><span>{t('g.lbl.text')}</span>
            {toggle('showCode', t('g.lbl.showCode'))}{toggle('showName', t('g.lbl.showName'))}{toggle('showOwner', t('g.lbl.showOwner'))}{toggle('showTagline', 'FEEL THE MUSIQ')}
          </div>
          <Field label={t('g.lbl.customText')}><input value={d.customText ?? ''} placeholder="@funqtionofficial" onChange={(e) => set({ customText: e.target.value || undefined })} /></Field>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={!d.name.trim()} onClick={async () => { await store(presets.map((p) => (p.id === d.id ? d : p))); toast(t('common.saved')); }}>{t('common.save')}</button>
            <button className="btn" onClick={async () => { const copy = { ...d, id: `custom_${uid().slice(0, 8)}`, name: `${d.name} (${t('g.lbl.copy')})` }; await store([...presets, copy]); setId(copy.id); }}>{t('g.lbl.duplicate')}</button>
            {builtIn
              ? <button className="btn ghost" onClick={async () => { const orig = DEFAULT_PRESETS.find((x) => x.id === d.id)!; await store(presets.map((p) => (p.id === d.id ? orig : p))); setD(orig); }}>{t('g.lbl.reset')}</button>
              : <button className="btn danger" onClick={async () => { await store(presets.filter((p) => p.id !== d.id)); setId(presets[0].id); }}>{t('common.delete')}</button>}
          </div>
          <p className="tiny muted">{t('g.lbl.saveHint')}</p>
        </div>
      </Section>
    </div>
  );
}

/** HTML replica of a printed label, with the same QR/barcode SVG as the PDF. */
export function LabelPreview({ preset, code = 'FQ-0042', name = 'XDJ-AZ', small }: { preset: LabelPreset; code?: string; name?: string; small?: boolean }) {
  const { t } = useI18n();
  const { settings } = useSession();
  const [art, setArt] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const zx = await import('../zxing');
      const svg = preset.size === 'barcode' ? barcodeArt(await zx.code128(code), preset) : qrArt(await zx.qrMatrix(code, preset.logo), preset, logoSvg);
      if (alive) setArt(svg);
    })().catch(() => setArt(null));
    return () => { alive = false; };
  }, [preset, code]);
  const c = colors(preset);
  const big = preset.size === 'qr_large';
  const w = preset.size === 'qr_small' ? 182 : 374; // ≈ mm × 3.78 (48 / 99 mm)
  const h = preset.size === 'qr_large' ? 144 : preset.size === 'qr_small' ? 95 : 80;
  const scale = small ? 0.7 : 1;
  const lines = (
    <div className="lbl-text" style={{ color: c.text }}>
      {preset.showCode && <div className="lbl-code" style={{ color: c.accent, fontSize: big ? 22 : 13 }}>{code}</div>}
      {preset.showName && <div style={{ fontSize: big ? 12 : 9 }}>{name}</div>}
      {preset.showOwner && <div style={{ fontSize: 8, opacity: 0.75, marginTop: 6 }}>{t('g.propertyOf')} {settings.businessName}</div>}
      {preset.customText && <div style={{ fontSize: 9 }}>{preset.customText}</div>}
      {preset.showTagline && <div style={{ fontSize: 8, color: c.accent, letterSpacing: '0.15em', marginTop: 4 }}>FEEL THE MUSIQ</div>}
    </div>
  );
  return (
    <div className="lbl-preview" style={{ background: c.bg, width: w * scale, height: h * scale, fontSize: `${scale}em` }} aria-label={preset.name}>
      {preset.size === 'barcode' ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {preset.logo && <img src={svgUrl(logoArt(preset, logoSvg))} alt="" style={{ width: 26 * scale, height: 26 * scale }} />}
          {Array.from({ length: preset.repeat }, (_, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              {art && <img src={svgUrl(art)} alt={code} style={{ height: 40 * scale, width: `${(300 / preset.repeat) * scale}px` }} />}
              {preset.showCode && <div style={{ color: c.accent, fontSize: 9 * scale }}>{code}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10 * scale, alignItems: 'flex-start' }}>
          {art && <img src={svgUrl(art)} alt={code} style={{ width: (big ? 122 : 74) * scale, height: (big ? 122 : 74) * scale }} />}
          {lines}
        </div>
      )}
      {preset.size === 'barcode' && <div style={{ color: c.text, fontSize: 8 * scale }}>{preset.showName ? name : ''}</div>}
    </div>
  );
}
