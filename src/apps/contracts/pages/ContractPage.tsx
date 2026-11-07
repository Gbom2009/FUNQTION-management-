import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section, StagePill, useToast } from '../../../core/ui';
import { centsFromInput, euro, fmtDate, fmtDateTime, inputFromCents } from '../../../core/format';
import { save } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import type { Contract, ContractVersion } from '../../../core/types';
import { downloadBlob } from '../../bookings/components/parts';
import {
  contractPdfName, countersign, draftPdf, dropAddendum, finishIfComplete, freezeVersion, liveSnapshot, reopenDraft, useEvents, useRiders, useSignatures, useVersions,
  versionPdf, type LiveContract,
} from '../data';
import { AddendumDialog, AkkoordDialog, CancelDialog, ContractPill, NoteDialog, SendComposer, SnapshotView, WithdrawDialog } from '../components';
import { daysUntil, shortHash } from '../domain/render';

type Dialog = null | 'send' | 'remind' | 'copy' | 'akkoord' | 'cancel' | 'addendum' | 'note' | 'withdraw';

export default function ContractPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { me, settings } = useSession();
  const c = useLiveQuery(() => db.contracts.get(id!), [id]);
  const gig = useLiveQuery(() => (c ? db.gigs.get(c.gigId) : undefined), [c?.gigId]);
  const quote = useLiveQuery(() => (c?.quoteId ? db.quotes.get(c.quoteId) : undefined), [c?.quoteId]);
  const person = useLiveQuery(() => (gig?.clientPersonId ? db.persons.get(gig.clientPersonId) : undefined), [gig?.clientPersonId]);
  const deposit = useLiveQuery(() => (c?.depositInvoiceId ? db.invoices.get(c.depositInvoiceId) : undefined), [c?.depositInvoiceId]);
  const versions = useVersions(c?.id);
  const sigs = useSignatures(c?.id);
  const events = useEvents(c?.id);
  const [live, setLive] = useState<LiveContract | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogVersion, setDialogVersion] = useState<ContractVersion | null>(null);
  const current = versions.find((v) => v.id === c?.currentVersionId);
  const signedV = versions.find((v) => v.id === c?.signedVersionId);
  const editing = !!c && c.status !== 'cancelled' && (c.status === 'draft' || (!!c.pendingAddendum && !(current?.kind === 'addendum' && current.status === 'sent')));
  const awaiting = !!c && !editing && current?.status === 'sent';
  // Recompute the live preview whenever the contract, the gig, the quote or the settings change.
  useEffect(() => { if (c && editing) liveSnapshot(c).then(setLive); }, [c, editing, gig?.updatedAt, quote?.updatedAt, settings]);
  if (!c || !me) return null;

  const patch = (p: Partial<Contract>) => save<Contract>('contracts', { ...c, ...p });
  const shown = editing ? live?.snapshot : (current ?? signedV)?.snapshot;
  const shownSigs = sigs.filter((x) => x.versionId === (editing ? '' : (current ?? signedV)?.id));
  const clientSigned = awaiting && current && sigs.some((x) => x.versionId === current.id && x.party === 'client');
  const blocking = live?.warnings.filter((w) => w.blocking) ?? [];

  async function freeze(then: 'send' | 'sign') {
    try {
      const v = await freezeVersion(c!, me!.id);
      if (then === 'send') { setDialogVersion(v); setDialog('send'); } else nav(`/contracts/${c!.id}/sign`);
    } catch (e) {
      toast((e as Error).message === 'blocked' ? t('ct.blocked') : String(e));
    }
  }
  const openDialog = (d: Dialog, v?: ContractVersion) => { setDialogVersion(v ?? current ?? signedV ?? null); setDialog(d); };

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="legend"><Link to="/contracts">← {t('app.contracts')}</Link></div>
          <h1 style={{ overflowWrap: 'anywhere' }}>{c.kind === 'theirs' ? t('ct.theirs') : t('ct.contract')} {c.number}</h1>
          <div className="sub row">
            <ContractPill c={c} />
            {gig && <Link to={`/bookings/gigs/${gig.id}`}>{gig.title} · {fmtDate(gig.date, lang)}</Link>}
            {gig && <StagePill stage={gig.stage} />}
            {quote && <Link to={`/invoicing/quotes/${quote.id}`}>{t('pdf.quote')} {quote.number ?? ''} v{quote.version} · {t(`quote.status.${quote.status}`)}</Link>}
          </div>
        </div>
        <div className="row">
          {editing && <button className="btn" onClick={async () => downloadBlob(await draftPdf(c), contractPdfName(c))}>{t('q.preview')}</button>}
          {editing && c.kind === 'ours' && <button className="btn" disabled={blocking.length > 0} onClick={() => freeze('sign')}>{t('ct.signHere')}</button>}
          {editing && c.kind === 'ours' && <button className="btn primary" disabled={blocking.length > 0} onClick={() => freeze('send')}>{t('ct.send')}</button>}
          {editing && c.kind === 'theirs' && <button className="btn primary" onClick={async () => { const v = await freezeVersion(c, me.id); openDialog('akkoord', v); }}>{t('ct.recordTheirs')}</button>}
          {awaiting && current && !clientSigned && <button className="btn primary" onClick={() => openDialog('akkoord')}>{t('ct.recordAkkoord')}</button>}
          {awaiting && current && !clientSigned && c.kind === 'ours' && <Link className="btn" to={`/contracts/${c.id}/sign`}>{t('ct.signHere')}</Link>}
          {awaiting && clientSigned && current && <button className="btn primary" onClick={async () => { await countersign(c, current, me.id); const r = await finishIfComplete(c.id, current.id, me.id); toast(r.conflict ? t('q.conflictWarn') : t('ct.toast.signed')); }}>{t('ct.countersign')}</button>}
          {!editing && (signedV || current) && <button className="btn" onClick={async () => { const v = (awaiting ? current : signedV) ?? current!; downloadBlob(await versionPdf(v), contractPdfName(c, v, v.status === 'signed')); }}>{t('i.download')}</button>}
        </div>
      </div>

      {c.status === 'cancelled' && <div className="banner danger" style={{ marginBottom: 'var(--s4)' }}><span>✕</span><div className="txt">{t('ct.cancelledOn', { date: fmtDateTime(c.cancelledAt, lang), reason: c.cancellationReason ?? '' })}{c.cancellationFee ? ` · ${euro(c.cancellationFee, lang)}` : ''}</div></div>}
      {awaiting && c.signBy && (
        <div className={`banner ${daysUntil(c.signBy, todayStr()) < 0 ? 'danger' : 'warn'}`} style={{ marginBottom: 'var(--s4)' }}>
          <span>⏳</span>
          <div className="txt">{daysUntil(c.signBy, todayStr()) < 0 ? t('ct.expired', { date: fmtDate(c.signBy, lang) }) : t('ct.awaiting', { label: current?.label ?? '', date: fmtDate(c.signBy, lang) })}
            <div className="row" style={{ marginTop: 'var(--s2)' }}>
              <button className="btn small" onClick={() => openDialog('remind')}>{t('ct.remind')}</button>
              <button className="btn small ghost" onClick={async () => { await reopenDraft(c); }}>{t('ct.edit')}</button>
              <label className="row small">{t('ct.signBy')} <input type="date" className="input" style={{ width: 'auto' }} value={c.signBy} onChange={(e) => patch({ signBy: e.target.value })} /></label>
            </div>
          </div>
        </div>
      )}
      {c.status === 'signed' && !c.pendingAddendum && (
        <div className="banner ok" style={{ marginBottom: 'var(--s4)' }}><span>✓</span>
          <div className="txt">{t('ct.signedBanner', { date: fmtDateTime(c.signedAt, lang), label: signedV?.label ?? '' })}
            {deposit && <> · <Link to={`/invoicing/invoices/${deposit.id}`}>{t('ct.depositInvoice')}: {deposit.number ?? t('i.state.draft')}</Link></>}
            <div className="row" style={{ marginTop: 'var(--s2)' }}>
              <button className="btn small" onClick={() => openDialog('copy', signedV)}>{t('ct.sendCopy')}</button>
              <button className="btn small" onClick={() => setDialog('addendum')}>{t('ct.addendum.start')}</button>
              <button className="btn small ghost" onClick={() => setDialog('note')}>{t('ct.addNote')}</button>
              <button className="btn small danger" onClick={() => setDialog('cancel')}>{t('ct.cancel')}</button>
            </div>
          </div>
        </div>
      )}
      {c.pendingAddendum && (
        <div className="banner warn" style={{ marginBottom: 'var(--s4)' }}><span>±</span>
          <div className="txt">{t('ct.addendum.pending', { reason: c.pendingAddendum.reason })}
            <div className="row" style={{ marginTop: 'var(--s2)' }}><button className="btn small ghost" onClick={() => dropAddendum(c)}>{t('ct.addendum.drop')}</button></div>
          </div>
        </div>
      )}

      <div className="layout-2">
        <div>{shown ? <SnapshotView s={shown} signatures={shownSigs} summaryOnly={c.kind === 'theirs'} highlight={editing} /> : null}</div>
        <div className="stack">
          {editing && live && <EditorPanel c={c} live={live} patch={patch} />}
          {!editing && (
            <Section title={t('ct.versions')}>
              <div className="list">
                {versions.map((v) => (
                  <div key={v.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                    <span className="grow"><strong>{v.label}</strong> <span className="tiny muted">{fmtDateTime(v.frozenAt, lang)} · sha256 {shortHash(v.contentHash)}</span></span>
                    <span className="pill">{t(`ct.vstatus.${v.status}`)}</span>
                    <button className="btn small ghost" onClick={async () => downloadBlob(await versionPdf(v), contractPdfName(c, v, v.status === 'signed'))}>PDF</button>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {sigs.length > 0 && (
            <Section title={t('ct.signatures')}>
              <div className="list">
                {sigs.map((x) => (
                  <div key={x.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                    <span className="grow"><strong>{x.name}</strong> <span className="tiny muted">{x.party === 'client' ? t('ct.pdf.client') : t('ct.pdf.funqtion')} · {t(`ct.method.${x.method}`)}{x.channel ? ` (${t(`ct.channel.${x.channel}`)})` : ''}</span></span>
                    <span className="tiny">{fmtDateTime(x.signedAt, lang)} · {versions.find((v) => v.id === x.versionId)?.label}</span>
                    {x.consents.photoOptOut && <span className="pill">{t('ct.sig.photoNo')}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}
          <Section title={t('ct.timeline')}>
            <div className="list">
              {[...events].reverse().map((e) => (
                <div key={e.id} className="list-item"><span className="tiny muted" style={{ minWidth: 120 }}>{fmtDateTime(e.at, lang)}</span><span className="grow small">{t(`ct.event.${e.type}`)}{e.note && e.type !== 'deposit_invoice' ? ` – ${e.note}` : ''}</span></div>
              ))}
            </div>
          </Section>
          {c.status !== 'cancelled' && c.status !== 'signed' && <div><button className="btn small danger" onClick={() => setDialog('withdraw')}>{t('ct.withdraw')}</button></div>}
          {c.status === 'signed' && <p className="tiny muted">{t('ct.legalNote')}</p>}
        </div>
      </div>

      {dialog === 'send' && dialogVersion && <SendComposer c={c} v={dialogVersion} gig={gig} person={person} kind="contract_send" onClose={() => setDialog(null)} />}
      {dialog === 'remind' && dialogVersion && <SendComposer c={c} v={dialogVersion} gig={gig} person={person} kind="contract_reminder" onClose={() => setDialog(null)} />}
      {dialog === 'copy' && dialogVersion && <SendComposer c={c} v={dialogVersion} gig={gig} person={person} kind="contract_signed" onClose={() => setDialog(null)} />}
      {dialog === 'akkoord' && dialogVersion && <AkkoordDialog c={c} v={dialogVersion} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelDialog c={c} onClose={() => setDialog(null)} />}
      {dialog === 'addendum' && <AddendumDialog c={c} onClose={() => setDialog(null)} />}
      {dialog === 'note' && <NoteDialog c={c} onClose={() => setDialog(null)} />}
      {dialog === 'withdraw' && <WithdrawDialog c={c} onClose={() => setDialog(null)} />}
    </div>
  );
}

function EditorPanel({ c, live, patch }: { c: Contract; live: LiveContract; patch: (p: Partial<Contract>) => Promise<Contract> }) {
  const { t } = useI18n();
  const riders = useRiders().filter((r) => r.active);
  const [special, setSpecial] = useState(c.specialTerms ?? '');
  useEffect(() => setSpecial(c.specialTerms ?? ''), [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCat = new Map<string, typeof live.states>();
  for (const st of live.states) byCat.set(st.clause.category, [...(byCat.get(st.clause.category) ?? []), st]);
  return (
    <>
      {live.warnings.length > 0 && (
        <Section title={t('ct.checks')}>
          <div className="stack" style={{ gap: 'var(--s2)' }}>
            {live.warnings.map((w, i) => (
              <div key={i} className={`banner ${w.blocking ? 'danger' : 'warn'}`}><span>!</span><div className="txt small">{t(`ct.warn.${w.key}`, { detail: w.detail ?? '' })}</div></div>
            ))}
          </div>
        </Section>
      )}
      {c.pendingAddendum && live.snapshot.addendum && (
        <Section title={t('ct.addendum.changes')}>
          {live.snapshot.addendum.changes.length === 0 ? <p className="small muted">{t('ct.addendum.noChangesYet')}</p> : (
            <div className="list">{live.snapshot.addendum.changes.map((x) => <div key={x.field} className="list-item small"><strong>{t(`ct.diff.${x.field}` as Key)}</strong><span className="grow muted">{x.old || '—'} → {x.new || '—'}</span></div>)}</div>
          )}
        </Section>
      )}
      <Section title={t('ct.settingsForThis')}>
        <div className="stack">
          <div className="chips" role="group" aria-label={t('ct.clientKind')}>
            {(['consumer', 'business'] as const).map((k) => <button key={k} className="chip" aria-pressed={c.clientKind === k} onClick={() => patch({ clientKind: k })}>{t(`ct.kind.${k}`)}</button>)}
          </div>
          <p className="tiny muted">{t('ct.clientKindHint')}</p>
          <div className="grid2">
            <Field label={t('q.language')}><select value={c.language} onChange={(e) => patch({ language: e.target.value as 'nl' | 'en' })}><option value="nl">Nederlands</option><option value="en">English</option></select></Field>
            <Field label={t('ct.overtimeRate')}><input inputMode="decimal" defaultValue={inputFromCents(c.overtimeRate)} key={c.overtimeRate} onBlur={(e) => patch({ overtimeRate: centsFromInput(e.target.value) ?? 0 })} /></Field>
          </div>
          <Field label={t('ct.flow')} hint={t(`ct.flowHint.${c.flow}`)}>
            <select value={c.flow} onChange={(e) => patch({ flow: e.target.value as Contract['flow'] })}>
              <option value="together">{t('ct.flow.together')}</option><option value="after_quote">{t('ct.flow.after_quote')}</option>
            </select>
          </Field>
          {c.kind === 'ours' && (
            <Field label={t('ct.rider')}><select value={c.riderId ?? ''} onChange={(e) => patch({ riderId: e.target.value || undefined })}>
              <option value="">—</option>{riders.map((r) => <option key={r.id} value={r.id}>{r.name} (v{r.version})</option>)}
            </select></Field>
          )}
          {c.kind === 'theirs' && <Field label={t('ct.theirsTitle')}><input defaultValue={c.title ?? ''} onBlur={(e) => patch({ title: e.target.value })} /></Field>}
          <Field label={t('ct.special')} hint={t('ct.specialHint')}><textarea rows={4} value={special} onChange={(e) => setSpecial(e.target.value)} onBlur={() => special !== (c.specialTerms ?? '') && patch({ specialTerms: special })} /></Field>
        </div>
      </Section>
      {c.kind === 'ours' && (
        <Section title={t('ct.clauses')}>
          <div className="stack" style={{ gap: 'var(--s3)' }}>
            {[...byCat.entries()].map(([cat, list]) => (
              <div key={cat}>
                <div className="legend">{t(`ct.cat.${cat as 'core'}`)}</div>
                {list.map((st) => (
                  <label key={st.clause.key} className="check" title={st.clause.note}>
                    <input type="checkbox" checked={st.on} disabled={st.locked} onChange={(e) => patch({ clauseOverrides: { ...c.clauseOverrides, [st.clause.key]: e.target.checked } })} />
                    <span>{st.clause.key} · {c.language === 'en' ? st.clause.titleEn : st.clause.titleNl}{st.locked ? ' 🔒' : ''}{!st.inTemplate ? <span className="tiny muted"> ({t('ct.notInTemplate')})</span> : null}</span>
                  </label>
                ))}
              </div>
            ))}
            <Link className="small" to="/contracts/library">{t('ct.editLibrary')}</Link>
          </div>
        </Section>
      )}
    </>
  );
}
