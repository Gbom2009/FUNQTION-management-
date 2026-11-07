import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { translate, useI18n, type Key } from '../../core/i18n';
import { useSession } from '../../core/session';
import { Field, Modal, useToast } from '../../core/ui';
import { euro, fmtDate } from '../../core/format';
import { todayStr } from '../../core/dates';
import type { Contract, ContractSignature, ContractSnapshot, ContractStatus, ContractVersion, Gig, Lang, Person } from '../../core/types';
import { MessageComposer } from '../bookings/components/parts';
import { cancelContract, cancellationQuote, contractPdfName, signClient, startAddendum, addNote, versionPdf, withdrawContract } from './data';
import { shortHash } from './domain/render';

// ---------------------------------------------------------------------------
// Status

const COLOR: Record<ContractStatus | 'awaiting' | 'addendum', string> = {
  draft: 'var(--st-enquiry)', sent: 'var(--st-quote_sent)', viewed: 'var(--st-option)', signed: 'var(--st-confirmed)', cancelled: 'var(--st-lost)',
  awaiting: 'var(--st-option)', addendum: 'var(--st-option)',
};

export function ContractPill({ c }: { c: Contract }) {
  const { t } = useI18n();
  const st = c.pendingAddendum ? 'addendum' : c.status;
  return <span className="pill" style={{ color: COLOR[st] }}>{st === 'addendum' ? t('ct.status.addendum') : t(`ct.status.${c.status}`)}</span>;
}

// ---------------------------------------------------------------------------
// Signature pad (pointer events: finger, pen or mouse)

export function SignaturePad({ onChange, label }: { onChange: (dataUrl?: string) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const { t } = useI18n();
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#141414';
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const exportPng = () => {
    // Downscale to max 600 px wide so the signature stays small in the database and the PDF.
    const c = ref.current!;
    const scale = Math.min(1, 600 / c.width);
    const out = document.createElement('canvas');
    out.width = Math.round(c.width * scale); out.height = Math.round(c.height * scale);
    out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  };
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      <canvas ref={ref} className="sigpad" aria-label={label} role="img"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); }}
        onPointerUp={() => { if (!drawing.current) return; drawing.current = false; setEmpty(false); onChange(exportPng()); }}
      />
      <div className="row between">
        <span className="tiny muted">{empty ? t('ct.sign.drawHere') : ''}</span>
        <button type="button" className="btn small ghost" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); onChange(undefined); }}>{t('ct.sign.clear')}</button>
      </div>
    </div>
  );
}

/** Photo or screenshot → small JPEG data URL (evidence of an "akkoord"). */
export async function imageToDataUrl(file: File, max = 1400): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

// ---------------------------------------------------------------------------
// Paper preview of a snapshot (what the client reads)

function Body({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => { if (bullets.length) { out.push(<ul key={`u${k}`}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>); bullets = []; } };
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('- ')) bullets.push(line.slice(2));
    else { flush(i); if (line.trim()) out.push(<p key={i}>{line}</p>); }
  });
  flush(-1);
  return <>{out}</>;
}

export function SnapshotView({ s, signatures = [], summaryOnly, highlight }: { s: ContractSnapshot; signatures?: ContractSignature[]; summaryOnly?: boolean; highlight?: boolean }) {
  const lang: Lang = s.language;
  const t = (k: Key, p?: Record<string, string | number>) => translate(lang, k, p);
  const d = fmtDate(s.event.date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const cancelNr = s.clauses.find((c) => c.key === 'A1')?.nr;
  return (
    <article className={`paper${highlight ? ' draft' : ''}`} lang={lang}>
      <header className="paper-head">
        <div>
          <div className="paper-title">{s.addendum ? t('ct.pdf.addendum') : t('ct.pdf.title')}</div>
          <div className="paper-dim">{s.number}{s.addendum ? ` · ${s.addendum.label}` : ''}</div>
        </div>
        <div className="paper-parties">
          <div><div className="paper-label">{t('ct.pdf.funqtion')}</div><strong>{s.funqtion.name}</strong>{s.funqtion.legalNames && <div>{s.funqtion.legalNames}</div>}{s.funqtion.address && <div className="pre">{s.funqtion.address}</div>}</div>
          <div><div className="paper-label">{t('ct.pdf.client')}</div><strong>{s.client.name || '—'}</strong>{s.client.attention && <div>{s.client.attention}</div>}{s.client.address && <div className="pre">{s.client.address}</div>}{s.client.email && <div className="paper-dim">{s.client.email}</div>}</div>
        </div>
      </header>
      <section className="paper-summary">
        <div className="paper-label">{t('ct.pdf.summary')}</div>
        <dl>
          <dt>{t('ct.pdf.event')}</dt><dd>{s.event.title}</dd>
          <dt>{t('ct.pdf.date')}</dt><dd>{d}</dd>
          <dt>{t('ct.pdf.times')}</dt><dd>{s.event.sets.map((x) => `${x.start}–${x.end}`).join(', ')}</dd>
          <dt>{t('ct.pdf.venue')}</dt><dd>{[s.event.venueName, s.event.venueAddress].filter(Boolean).join(', ') || '—'}</dd>
          <dt>{t('ct.pdf.price')}</dt><dd><strong>{euro(s.price.total, lang)}</strong></dd>
          <dt>{t('ct.pdf.deposit')}</dt><dd>{euro(s.price.depositAmount, lang)} ({s.price.depositPct}%)</dd>
          {cancelNr && <><dt>{t('ct.pdf.cancellation')}</dt><dd>{t('ct.pdf.seeArticle', { nr: cancelNr })}</dd></>}
        </dl>
      </section>
      {!summaryOnly && s.addendum && (
        <section>
          <p>{t('ct.pdf.addendumIntro', { parent: s.addendum.parentLabel, hash: shortHash(s.addendum.parentHash) })}</p>
          {s.addendum.reason && <p><span className="paper-dim">{t('ct.addendum.reason')}:</span> {s.addendum.reason}</p>}
          {s.addendum.changes.length === 0 ? <p className="paper-dim">{t('ct.addendum.noChanges')}</p> : (
            <table className="paper-table"><thead><tr><th>{t('ct.diff.field')}</th><th>{t('ct.diff.old')}</th><th>{t('ct.diff.new')}</th></tr></thead>
              <tbody>{s.addendum.changes.map((c) => <tr key={c.field}><td><strong>{t(`ct.diff.${c.field}` as Key)}</strong></td><td className="paper-dim">{c.old || '—'}</td><td>{c.new || '—'}</td></tr>)}</tbody></table>
          )}
          {s.specialTerms && <><h4>{t('ct.special')}</h4><Body text={s.specialTerms} /></>}
          <p>{t('ct.pdf.restUnchanged', { parent: s.addendum.parentLabel })}</p>
        </section>
      )}
      {!summaryOnly && !s.addendum && (
        <>
          {s.intro && <p>{s.intro}</p>}
          <section>
            <div className="paper-label">{t('ct.pdf.whatWeAgree')}</div>
            <table className="paper-table">
              <tbody>
                {s.services.map((x, i) => <tr key={i}><td>{x.description}</td><td className="r">{x.qty}</td><td className="r">{euro(x.amount, lang)}</td></tr>)}
                <tr className="total"><td>{t('pdf.total')}</td><td /><td className="r">{euro(s.price.total, lang)}</td></tr>
              </tbody>
            </table>
            {s.extras.length > 0 && <><div className="paper-dim small">{t('ct.pdf.extras')}</div>
              <ul>{s.extras.map((x) => <li key={x.id}>{x.description} (+ {euro(x.amount, lang)})</li>)}</ul></>}
            <p className="paper-dim small">{s.price.vatNote}</p>
          </section>
          {s.specialTerms && <section><h4>{t('ct.special')}</h4><Body text={s.specialTerms} /></section>}
          <section>
            <div className="paper-label">{t('ct.pdf.articles')}</div>
            {s.clauses.map((c) => <div key={c.key} className="paper-article"><h4><span className="nr">{c.nr}</span>{c.title}</h4><Body text={c.body} /></div>)}
          </section>
          {s.rider && (
            <details>
              <summary>{t('ct.pdf.annex1')} · {s.rider.name}</summary>
              <h4>{t('ct.rider.technical')}</h4><ul>{s.rider.technical.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h4>{t('ct.rider.hospitality')}</h4><ul>{s.rider.hospitality.map((x, i) => <li key={i}>{x}</li>)}</ul>
              {s.rider.venueNotes.length > 0 && <><h4>{t('ct.rider.venueNotes')}</h4><ul>{s.rider.venueNotes.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            </details>
          )}
          {s.terms.text && (
            <details>
              <summary>{t('ct.pdf.annex2')} · {t('ct.pdf.termsVersion', { version: s.terms.version })}</summary>
              <pre className="paper-terms">{s.terms.text}</pre>
            </details>
          )}
        </>
      )}
      {signatures.length > 0 && (
        <section className="paper-sigs">
          {[...signatures].sort((a, b) => (a.party === 'client' ? 0 : 1) - (b.party === 'client' ? 0 : 1)).map((x) => (
            <div key={x.id}>
              <div className="paper-label">{x.party === 'client' ? t('ct.pdf.forClient') : t('ct.pdf.forFunqtion')}</div>
              {x.imageDataUrl ? <img src={x.imageDataUrl} alt={x.name} /> : <em className="paper-dim">{t(`ct.method.${x.method}`)}</em>}
              <div>{x.name}</div>
              <div className="paper-dim small">{new Date(x.signedAt).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Dialogs

export function SendComposer({ c, v, gig, person, kind, onClose }: { c: Contract; v: ContractVersion; gig?: Gig; person?: Person; kind: 'contract_send' | 'contract_reminder' | 'contract_signed'; onClose: () => void }) {
  const { me } = useSession();
  const s = v.snapshot;
  const l = s.language;
  return (
    <MessageComposer kind={kind} gig={gig} person={person} language={l} onClose={onClose}
      extraFields={{ contractNumber: c.number, signBy: fmtDate(c.signBy, l, { day: 'numeric', month: 'long', year: 'numeric' }), amount: euro(s.price.total, l),
        depositPct: String(s.price.depositPct), email: s.client.email ?? '', sender: me?.name ?? '',
        firstName: person?.firstName ?? s.client.attention?.split(' ')[0] ?? s.client.name.split(' ')[0] ?? '' }}
      pdf={{ name: contractPdfName(c, v, v.status === 'signed'), make: () => versionPdf(v) }} />
  );
}

export function AkkoordDialog({ c, v, onClose }: { c: Contract; v: ContractVersion; onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const s = v.snapshot;
  const [name, setName] = useState(s.client.attention || s.client.name);
  const [method, setMethod] = useState<'reply_akkoord' | 'signed_pdf'>('reply_akkoord');
  const [channel, setChannel] = useState<NonNullable<ContractSignature['channel']>>('whatsapp');
  const [when, setWhen] = useState(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const [extras, setExtras] = useState<string[]>([]);
  const [photoOptOut, setPhotoOptOut] = useState(false);
  const [evidence, setEvidence] = useState<string>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!me || !name.trim()) return;
    setBusy(true);
    try {
      const r = await signClient(c, v, { name: name.trim(), method, channel: method === 'reply_akkoord' ? channel : undefined, evidenceDataUrl: evidence, note: note || undefined,
        photoOptOut, selectedExtras: extras, signedAt: new Date(when).toISOString() }, me.id);
      toast(r.conflict ? t('q.conflictWarn') : r.complete ? t('ct.toast.signed') : t('ct.toast.clientSigned'));
      onClose();
    } finally { setBusy(false); }
  }
  return (
    <Modal title={t('ct.recordAkkoord')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>{t('ct.recordAkkoord')}</button></>}>
      <p className="small muted">{t('ct.akkoordHint', { label: v.label, hash: shortHash(v.contentHash) })}</p>
      <div className="chips">
        <button className="chip" aria-pressed={method === 'reply_akkoord'} onClick={() => setMethod('reply_akkoord')}>{t('ct.method.reply_akkoord')}</button>
        <button className="chip" aria-pressed={method === 'signed_pdf'} onClick={() => setMethod('signed_pdf')}>{t('ct.method.signed_pdf')}</button>
      </div>
      <div className="grid2">
        <Field label={t('ct.sig.name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {method === 'reply_akkoord' && (
          <Field label={t('ct.sig.channel')}>
            <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              {(['whatsapp', 'email', 'phone', 'in_person', 'other'] as const).map((x) => <option key={x} value={x}>{t(`ct.channel.${x}`)}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('ct.sig.signedAt')}><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      </div>
      {s.extras.length > 0 && (
        <div className="field"><span>{t('q.chooseExtras')}</span>
          {s.extras.map((x) => <label key={x.id} className="check"><input type="checkbox" checked={extras.includes(x.id)} onChange={(e) => setExtras(e.target.checked ? [...extras, x.id] : extras.filter((y) => y !== x.id))} />{x.description} (+{euro(x.amount, s.language)})</label>)}
        </div>
      )}
      <label className="check"><input type="checkbox" checked={photoOptOut} onChange={(e) => setPhotoOptOut(e.target.checked)} />{t('ct.sig.photoOptOut')}</label>
      <Field label={method === 'signed_pdf' ? t('ct.evidencePdf') : t('ct.evidence')} hint={t('ct.evidenceHint')}>
        <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setEvidence(await imageToDataUrl(f)); }} />
      </Field>
      {evidence && <img src={evidence} alt="" style={{ maxWidth: 200, border: '1px solid var(--fq-rule-color)' }} />}
      <Field label={t('common.notes')}><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ct.notePlaceholder')} /></Field>
    </Modal>
  );
}

export function CancelDialog({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [by, setBy] = useState<NonNullable<Contract['cancelledBy']>>('client');
  const [date, setDate] = useState(todayStr());
  const [reason, setReason] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [pre, setPre] = useState<Awaited<ReturnType<typeof cancellationQuote>> | null>(null);
  const [invoice, setInvoice] = useState(true);
  useEffect(() => { cancellationQuote(c, date).then((p) => { setPre(p); setPct(by === 'client' ? p.pct : by === 'us' ? 0 : Math.min(50, p.pct)); }); }, [c, date, by]);
  if (!pre || pct == null) return null;
  const fee = Math.round((pre.total * pct) / 100);
  return (
    <Modal title={t('ct.cancel')} onClose={onClose} footer={<button className="btn primary danger" disabled={!reason.trim()} onClick={async () => {
      const inv = await cancelContract(c, { by, date, reason: reason.trim(), pct, createInvoice: invoice && pct > 0 });
      onClose();
      if (inv) nav(`/invoicing/invoices/${inv.id}`);
    }}>{t('ct.cancelConfirm')}</button>}>
      <div className="chips">
        {(['client', 'us', 'force_majeure'] as const).map((x) => <button key={x} className="chip" aria-pressed={by === x} onClick={() => setBy(x)}>{t(`ct.cancelBy.${x}`)}</button>)}
      </div>
      <div className="grid2">
        <Field label={t('ct.cancelDate')} hint={t('ct.cancelDateHint')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('s.scalePct')}><input inputMode="numeric" value={pct} onChange={(e) => setPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} /></Field>
      </div>
      <p className="small">{t('ct.cancelInfo', { days: Math.max(0, pre.days), pct: pre.pct, total: euro(pre.total, lang), fee: euro(fee, lang) })}</p>
      {by === 'us' && <div className="banner warn"><span>!</span><div className="txt">{t('ct.cancelUsHint')}</div></div>}
      {by === 'force_majeure' && <div className="banner info"><span>i</span><div className="txt">{t('ct.cancelFmHint')}</div></div>}
      <Field label={t('stage.reason')}><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {pct > 0 && <label className="check"><input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} />{t('ct.cancelInvoice')}</label>}
    </Modal>
  );
}

export function AddendumDialog({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <Modal title={t('ct.addendum.start')} onClose={onClose} footer={<button className="btn primary" disabled={!reason.trim()} onClick={async () => { await startAddendum(c, reason.trim()); onClose(); }}>{t('ct.addendum.start')}</button>}>
      <p className="small">{t('ct.addendum.hint')}</p>
      <Field label={t('ct.addendum.reason')}><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('ct.addendum.reasonPlaceholder')} /></Field>
    </Modal>
  );
}

export function NoteDialog({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  return (
    <Modal title={t('ct.addNote')} onClose={onClose} footer={<button className="btn primary" disabled={!text.trim()} onClick={async () => { await addNote(c, text.trim()); onClose(); }}>{t('common.save')}</button>}>
      <p className="small muted">{t('ct.noteHint')}</p>
      <Field label={t('common.notes')}><textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </Modal>
  );
}

export function WithdrawDialog({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <Modal title={t('ct.withdraw')} onClose={onClose} footer={<button className="btn primary danger" disabled={!reason.trim()} onClick={async () => { await withdrawContract(c, reason.trim()); onClose(); }}>{t('ct.withdraw')}</button>}>
      <p className="small">{t('ct.withdrawHint')}</p>
      <Field label={t('stage.reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
