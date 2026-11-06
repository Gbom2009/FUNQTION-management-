import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Check, Field, MemberChips, Modal, StagePill, useToast } from '../../../core/ui';
import { fmtDate, fmtDateLong, fmtDateTime, euro, centsFromInput, personName } from '../../../core/format';
import { addDays, toDateStr } from '../../../core/dates';
import { nowIso, patch, save } from '../../../core/repo';
import {
  INTERACTION_CHANNELS, LOST_REASONS, type AuditEntry, type Enquiry, type Gig, type InteractionChannel, type Person,
  type Stage, type Task, type TemplateKind,
} from '../../../core/types';
import { checkDate, findConflicts, type Conflict } from '../domain/conflicts';
import { checkStageChange, allowedTargets } from '../domain/pipeline';
import { fillTemplate, mailtoLink, whatsAppLink } from '../domain/messaging';
import { byId, changeStage, logInteraction, useBlocks, useGigs, useQuotes, useVenues } from '../data';
import { quoteTotals } from '../domain/pipeline';

// ---------------------------------------------------------------------------
// Availability banner (instant "is this date free?")

export function AvailabilityBanner({ date, excludeGigId }: { date?: string; excludeGigId?: string }) {
  const { t } = useI18n();
  const { memberName } = useSession();
  const gigs = useGigs().filter((g) => g.id !== excludeGigId);
  const blocks = useBlocks();
  if (!date) return null;
  const r = checkDate(date, gigs, blocks);
  const cls = { free: 'ok', tentative: 'warn', booked: 'danger', blocked: 'warn' }[r.status];
  const who = r.status === 'blocked'
    ? Array.from(new Set(r.blocks.map((b) => memberName(b.memberId)))).join(' + ')
    : r.bookedMembers.map((m) => memberName(m)).join(' + ');
  return (
    <div className={`banner ${cls}`} role="status">
      <span aria-hidden="true">{{ free: '✓', tentative: '!', booked: '✕', blocked: '◌' }[r.status]}</span>
      <div className="txt">
        <div className="strong">{t(`avail.${r.status}`, { who })}</div>
        {r.gigs.map((g) => (
          <div key={g.id} className="small"><Link to={`/bookings/gigs/${g.id}`}>{(g as Gig).title || (g as Gig).reference}</Link> · {(g as Gig).startTime}–{(g as Gig).endTime} · {t(`stage.${g.stage}`)}</div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflicts for a gig

export function useConflicts(gig: Pick<Gig, 'id' | 'date' | 'startTime' | 'endTime' | 'setupTime' | 'setupRequired' | 'performers' | 'stage'>) {
  const gigs = useGigs();
  const blocks = useBlocks();
  const { settings } = useSession();
  return useMemo(() => findConflicts(gig, gigs, blocks, settings), [gig, gigs, blocks, settings]);
}

export function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  const { t } = useI18n();
  const { memberName, settings } = useSession();
  const gigs = byId(useGigs());
  const blocks = byId(useBlocks());
  if (!conflicts.length) return null;
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      {conflicts.map((c, i) => {
        const other = c.otherGigId ? gigs.get(c.otherGigId) : undefined;
        const otherName = other ? `${other.title || other.reference} (${other.startTime}–${other.endTime})` : '';
        const block = c.blockId ? blocks.get(c.blockId) : undefined;
        return (
          <div key={i} className={`banner ${c.level === 'hard' ? 'danger' : 'warn'}`} role="alert">
            <span aria-hidden="true">{c.level === 'hard' ? '⛔' : '⚠'}</span>
            <div className="txt">
              {t(`conflict.${c.kind}` as Key, {
                who: c.member ? memberName(c.member) : '', other: otherName, gap: c.gapMinutes ?? 0, min: settings.minGapMinutes,
                note: block ? `${t(`cal.blockKind.${block.kind}`)}${block.note ? ': ' + block.note : ''}` : '',
              })}
              {other && <> · <Link to={`/bookings/gigs/${other.id}`}>{t('common.open')}</Link></>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage change dialog

export function StageDialog({ gig, to: initialTo, onClose }: { gig: Gig; to?: Stage; onClose: () => void }) {
  const { t } = useI18n();
  const { settings } = useSession();
  const toast = useToast();
  const quotes = useQuotes(gig.id);
  const targets = allowedTargets(gig.stage);
  const [to, setTo] = useState<Stage>(initialTo ?? targets[0]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [cancelledBy, setCancelledBy] = useState<'client' | 'us'>('client');
  const [fee, setFee] = useState('');
  const [optionExpires, setOptionExpires] = useState(gig.optionExpiresAt ?? toDateStr(addDays(new Date(), settings.optionDays)));
  const [override, setOverride] = useState('');
  const conflicts = useConflicts({ ...gig, stage: 'confirmed' });
  const hard = conflicts.filter((c) => c.level === 'hard');

  const needsReason = to === 'lost' || to === 'cancelled';
  const check = checkStageChange({ ...gig, optionExpiresAt: optionExpires || undefined }, to, { hasQuote: quotes.length > 0, reason: needsReason ? reason || undefined : 'n/a' });
  const blockedByConflict = to === 'confirmed' && hard.length > 0 && !override.trim();
  const disabled = check.errors.length > 0 || blockedByConflict;

  async function submit() {
    const extra: Partial<Gig> = {};
    if (to === 'cancelled') { extra.cancelledBy = cancelledBy; extra.cancellationFee = centsFromInput(fee); extra.lostNote = note; extra.lostReason = reason as Gig['lostReason']; }
    if (to === 'option' && optionExpires) extra.optionExpiresAt = optionExpires;
    if (to === 'confirmed' && hard.length) extra.conflictOverride = override;
    await changeStage(gig, { to, reason: needsReason ? reason : undefined, note: note || override || undefined, extra });
    toast(to === 'confirmed' ? `${t('stage.confirmed')}! FEEL THE MUSIQ.` : t('common.saved'));
    onClose();
  }

  return (
    <Modal title={t('stage.change')} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn primary" disabled={disabled} onClick={submit}>{t('stage.move')}: {t(`stage.${to}`)}</button>
    </>}>
      <div className="row"><StagePill stage={gig.stage} /> <span className="muted">→</span> <StagePill stage={to} /></div>
      <div className="chips" role="group" aria-label={t('stage.move')}>
        {targets.map((s) => <button key={s} type="button" className="chip" aria-pressed={to === s} onClick={() => setTo(s)}>{t(`stage.${s}`)}</button>)}
      </div>
      {needsReason && (
        <Field label={t('stage.reason')}>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">—</option>
            {LOST_REASONS.map((r) => <option key={r} value={r}>{t(`lost.${r}`)}</option>)}
          </select>
        </Field>
      )}
      {to === 'cancelled' && (
        <div className="grid2">
          <Field label={t('stage.cancelledBy')}>
            <select value={cancelledBy} onChange={(e) => setCancelledBy(e.target.value as 'client' | 'us')}>
              <option value="client">{t('stage.cancelledBy.client')}</option>
              <option value="us">{t('stage.cancelledBy.us')}</option>
            </select>
          </Field>
          <Field label={t('stage.cancellationFee')}><input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
        </div>
      )}
      {to === 'option' && (
        <Field label={t('gig.optionExpires')}><input type="date" value={optionExpires} onChange={(e) => setOptionExpires(e.target.value)} /></Field>
      )}
      {(needsReason) && <Field label={t('common.notes')}><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      {check.errors.filter((e) => e !== 'reason_required' || reason === '').map((e) => (
        <div key={e} className="banner danger"><span>✕</span><div className="txt">{t(`stage.err.${e}`)}</div></div>
      ))}
      {check.missing.length > 0 && (
        <div className="banner warn"><span>!</span><div className="txt">{t('stage.missing')} {check.missing.map((m) => t(`req.${m}`)).join(', ')}</div></div>
      )}
      {to === 'confirmed' && <ConflictList conflicts={conflicts} />}
      {to === 'confirmed' && hard.length > 0 && (
        <Field label={t('stage.override')}><input value={override} onChange={(e) => setOverride(e.target.value)} /></Field>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Message composer: templates -> WhatsApp / e-mail, logged on the timeline

export function MessageComposer({ kind, gig, person, enquiry, onClose, onSent, extraFields, pdf, language: forcedLang, title }: {
  kind?: TemplateKind; gig?: Gig; person?: Person; enquiry?: Enquiry; onClose: () => void; onSent?: () => void;
  extraFields?: Record<string, string>; pdf?: { name: string; make: () => Promise<Blob> }; language?: 'nl' | 'en'; title?: string;
}) {
  const { t, lang } = useI18n();
  const { me, settings } = useSession();
  const toast = useToast();
  const templates = (useLiveQuery(() => db.templates.toArray(), []) ?? []).filter((x) => !x.deletedAt);
  const venues = byId(useVenues());
  const quotes = useQuotes(gig?.id);
  const language = forcedLang ?? person?.language ?? lang;
  const initial = templates.find((x) => x.kind === kind && x.language === language) ?? templates.find((x) => x.kind === kind);
  const [tplId, setTplId] = useState<string>('');
  const tpl = templates.find((x) => x.id === tplId) ?? initial;
  const latestQuote = quotes.sort((a, b) => b.version - a.version)[0];
  const venue = gig?.venueId ? venues.get(gig.venueId) : undefined;
  const fields: Record<string, string> = {
    firstName: person?.firstName ?? enquiry?.contactName?.split(' ')[0] ?? '',
    gigTitle: gig?.title ?? '',
    gigDate: fmtDateLong(gig?.date ?? enquiry?.requestedDate, language) === '—' ? (enquiry?.requestedDateText ?? '') : fmtDateLong(gig?.date ?? enquiry?.requestedDate, language),
    startTime: gig?.startTime ?? '', endTime: gig?.endTime ?? '',
    venue: venue?.name ?? '', city: venue?.city ?? enquiry?.locationText ?? '',
    eventType: gig ? t(`event.${gig.eventType}`) : '',
    amount: latestQuote ? euro(quoteTotals(latestQuote.lines).total, language) : euro(gig?.agreedFee, language),
    validUntil: fmtDate(latestQuote?.validUntil, language),
    reviewLink: settings.reviewLink ?? '', sender: me?.name ?? '', series: gig?.seriesName ?? gig?.title ?? '',
    iban: settings.iban || '[IBAN]', accountHolder: settings.accountHolder || settings.legalNames || settings.businessName,
    ...extraFields,
  };
  const [body, setBody] = useState<string | null>(null);
  const text = body ?? (tpl ? fillTemplate(tpl.body, fields) : '');
  const subject = tpl?.subject ? fillTemplate(tpl.subject, fields) : '';
  const phone = person?.whatsapp || person?.phone || enquiry?.contactPhone || extraFields?.phone;
  const email = extraFields?.email || person?.email || enquiry?.contactEmail;
  const [busy, setBusy] = useState(false);
  const canShareFiles = typeof navigator !== 'undefined' && 'canShare' in navigator;

  async function sharePdf() {
    if (!pdf) return;
    setBusy(true);
    try {
      const blob = await pdf.make();
      const file = new File([blob], pdf.name, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: subject || pdf.name });
        await logged('whatsapp');
      } else {
        downloadBlob(blob, pdf.name);
      }
    } catch { /* share cancelled */ } finally { setBusy(false); }
  }
  async function downloadPdf() {
    if (!pdf) return;
    setBusy(true);
    try { downloadBlob(await pdf.make(), pdf.name); } finally { setBusy(false); }
  }

  async function logged(channel: InteractionChannel) {
    await logInteraction({ at: nowIso(), channel, direction: 'out', summary: `${tpl?.name ?? t('msg.send')}: ${text.slice(0, 160)}`,
      personId: person?.id, gigId: gig?.id, enquiryId: enquiry?.id });
    if (enquiry && enquiry.status === 'new') await patch<Enquiry>('enquiries', enquiry.id, { status: 'replied', firstResponseAt: nowIso() });
    onSent?.();
  }

  return (
    <Modal title={title ?? t('msg.send')} onClose={onClose}>
      <Field label={t('msg.template')}>
        <select value={tpl?.id ?? ''} onChange={(e) => { setTplId(e.target.value); setBody(null); }}>
          <option value="">{t('msg.noTemplate')}</option>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.language.toUpperCase()})</option>)}
        </select>
      </Field>
      <Field label={t('msg.preview')}><textarea rows={10} value={text} onChange={(e) => setBody(e.target.value)} /></Field>
      {pdf && (
        <div className="row">
          {canShareFiles && <button className="btn primary" disabled={busy} onClick={sharePdf}>{t('i.share')}</button>}
          <button className="btn" disabled={busy} onClick={downloadPdf}>{t('i.download')}</button>
          <span className="tiny muted">{t('i.mailHint')}</span>
        </div>
      )}
      <div className="row">
        <a className={`btn ${pdf ? '' : 'primary'}`} href={whatsAppLink(phone, text)} target="_blank" rel="noreferrer" onClick={() => logged('whatsapp')}>{t('msg.whatsapp')}</a>
        <a className="btn" href={mailtoLink(email, subject, text)} onClick={() => logged('email')}>{t('msg.email')}</a>
        <button className="btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); toast(t('common.copied')); } catch { /* ignore */ } }}>{t('common.copy')}</button>
      </div>
      {(phone || email) && <div className="muted small">{[phone, email].filter(Boolean).join(' · ')}</div>}
    </Modal>
  );
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------
// Timeline

export function Timeline({ gigId, personId, enquiryId }: { gigId?: string; personId?: string; enquiryId?: string }) {
  const { t, lang } = useI18n();
  const { memberName } = useSession();
  const rows = useLiveQuery(async () => {
    const all = await db.interactions.toArray();
    return all.filter((i) => !i.deletedAt && ((gigId && i.gigId === gigId) || (personId && i.personId === personId) || (enquiryId && i.enquiryId === enquiryId)))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [gigId, personId, enquiryId]) ?? [];
  const [channel, setChannel] = useState<InteractionChannel>('note');
  const [dir, setDir] = useState<'in' | 'out' | 'none'>('none');
  const [summary, setSummary] = useState('');
  async function add() {
    if (!summary.trim()) return;
    await logInteraction({ at: nowIso(), channel, direction: dir, summary: summary.trim(), gigId, personId, enquiryId });
    setSummary('');
  }
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 'var(--s2)' }}>
        <div className="chips">
          {INTERACTION_CHANNELS.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={channel === c} onClick={() => setChannel(c)}>{t(`channel.${c}` as Key)}</button>
          ))}
        </div>
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} aria-label="direction">
            <option value="none">—</option><option value="in">{t('timeline.in')}</option><option value="out">{t('timeline.out')}</option>
          </select>
          <input className="input grow" style={{ flex: 1, minWidth: 180 }} placeholder={t('timeline.summary')} value={summary}
            onChange={(e) => setSummary(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn" onClick={add}>{t('common.add')}</button>
        </div>
      </div>
      {rows.length === 0 ? <p className="muted small">{t('timeline.empty')}</p> : (
        <div>
          {rows.map((i) => (
            <div key={i.id} className="timeline-item">
              <span className="tiny muted" style={{ minWidth: 86 }}>{fmtDateTime(i.at, lang)}</span>
              <div>
                <div className="tiny muted">{t(`channel.${i.channel}` as Key)}{i.direction !== 'none' ? ` · ${t(i.direction === 'in' ? 'timeline.in' : 'timeline.out')}` : ''} · {memberName(i.createdBy)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{i.summary}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (audit log)

const FIELD_LABELS: Record<string, Key> = {
  title: 'gig.title', date: 'gig.date', startTime: 'gig.start', endTime: 'gig.end', setupTime: 'gig.setupTime',
  setupRequired: 'gig.setupRequired.short', stage: 'common.status', performers: 'gig.performers', venueId: 'gig.venue',
  agreedFee: 'gig.fee', eventType: 'gig.eventType', ownerId: 'gig.owner', expectedCrowd: 'gig.crowd',
  notesInternal: 'gig.notesInternal', notesClient: 'gig.notesClient', musicWishes: 'gig.music', setSlots: 'gig.sets',
  phone: 'common.phone', email: 'common.email', firstName: 'contacts.firstName', lastName: 'contacts.lastName', notes: 'common.notes',
};

function fmtVal(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length && typeof v[0] !== 'object' ? v.join(', ') : `[${v.length}]`;
  if (typeof v === 'object') return '…';
  if (typeof v === 'boolean') return v ? '✓' : '✕';
  return String(v);
}

export function History({ rowIds }: { rowIds: string[] }) {
  const { t, lang } = useI18n();
  const { memberName } = useSession();
  const key = rowIds.join(',');
  const entries = useLiveQuery(() => db.audit.where('rowId').anyOf(rowIds).toArray(), [key]) ?? [];
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at)) as AuditEntry[];
  if (!sorted.length) return <p className="muted small">{t('history.empty')}</p>;
  return (
    <div>
      {sorted.slice(0, 100).map((e) => (
        <div key={e.id} className="timeline-item">
          <span className="tiny muted" style={{ minWidth: 86 }}>{fmtDateTime(e.at, lang)}</span>
          <div className="small">
            {e.action === 'insert' && t('history.created', { who: memberName(e.actor) })}
            {e.action === 'delete' && t('history.deleted', { who: memberName(e.actor) })}
            {e.action === 'update' && Object.entries(e.changes).filter(([k]) => k !== 'stageChangedAt').map(([k, [a, b]]) => (
              <div key={k}>{t('history.changed', { who: memberName(e.actor), field: FIELD_LABELS[k] ? t(FIELD_LABELS[k]) : k })}: <span className="muted">{fmtVal(a)}</span> → <span className="strong">{fmtVal(b)}</span></div>
            ))}
            <span className="tiny muted"> · {e.table}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task rows

export function TaskRow({ task, showLink = true }: { task: Task; showLink?: boolean }) {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const [msg, setMsg] = useState(false);
  const gig = useLiveQuery(() => (task.gigId ? db.gigs.get(task.gigId) : undefined), [task.gigId]);
  const enquiry = useLiveQuery(() => (task.enquiryId ? db.enquiries.get(task.enquiryId) : undefined), [task.enquiryId]);
  const personId = task.personId ?? gig?.clientPersonId ?? enquiry?.personId;
  const person = useLiveQuery(() => (personId ? db.persons.get(personId) : undefined), [personId]);
  const due = task.snoozedUntil ?? task.dueAt;
  const overdue = task.status === 'open' && new Date(due) < new Date();
  const done = task.status !== 'open';
  async function complete() {
    await patch<Task>('tasks', task.id, done ? { status: 'open', completedAt: undefined, completedBy: undefined } : { status: 'done', completedAt: nowIso(), completedBy: me?.id });
  }
  async function snooze(days: number) {
    await patch<Task>('tasks', task.id, { snoozedUntil: addDays(new Date(), days).toISOString() });
  }
  const link = task.gigId ? `/bookings/gigs/${task.gigId}` : task.enquiryId ? `/bookings/enquiries/${task.enquiryId}` : task.personId ? `/bookings/contacts/person/${task.personId}` : '';
  return (
    <div className="list-item task-row" style={{ opacity: done ? 0.55 : 1 }}>
      <button className="btn icon small" aria-label={done ? t('tasks.reopen') : t('tasks.markDone')} title={done ? t('tasks.reopen') : t('tasks.markDone')} onClick={complete}
        style={{ width: 34, borderColor: done ? 'var(--ok)' : undefined, color: done ? 'var(--ok)' : undefined }}>{done ? '✓' : ''}</button>
      <div className="task-main">
        <div className="strong" style={{ textDecoration: done ? 'line-through' : undefined }}>
          {showLink && link ? <Link to={link}>{task.title}</Link> : task.title}
        </div>
        <div className="tiny" style={{ color: overdue ? 'var(--danger)' : 'var(--fq-text-dim)' }}>
          {fmtDateTime(due, lang)} {task.assignedTo && <MemberChips ids={[task.assignedTo]} />}
        </div>
      </div>
      {!done && (
        <div className="row task-actions" style={{ gap: 4 }}>
          {task.templateKind && <button className="btn small" onClick={() => setMsg(true)}>{t('tasks.sendTemplate')}</button>}
          <select className="input" style={{ width: 'auto', minHeight: 34, fontSize: 12 }} value="" aria-label={t('tasks.snooze')}
            onChange={(e) => e.target.value && snooze(Number(e.target.value))}>
            <option value="">{t('tasks.snooze')}</option>
            <option value="1">{t('tasks.snooze1')}</option><option value="3">{t('tasks.snooze3')}</option><option value="7">{t('tasks.snooze7')}</option>
          </select>
        </div>
      )}
      {msg && <MessageComposer kind={task.templateKind} gig={gig ?? undefined} person={person ?? undefined} enquiry={enquiry ?? undefined}
        onClose={() => setMsg(false)} onSent={() => patch<Task>('tasks', task.id, { status: 'done', completedAt: nowIso(), completedBy: me?.id })} />}
    </div>
  );
}

export function NewTaskButton({ gigId, personId }: { gigId?: string; personId?: string }) {
  const { t } = useI18n();
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(toDateStr(addDays(new Date(), 1)));
  const [who, setWho] = useState<Task['assignedTo']>(me?.id ?? 'both');
  async function add() {
    if (!title.trim()) return;
    await save<Task>('tasks', { title: title.trim(), kind: 'custom', dueAt: new Date(`${due}T09:00`).toISOString(), assignedTo: who, gigId, personId, status: 'open' });
    setOpen(false); setTitle('');
  }
  return (
    <>
      <button className="btn small" onClick={() => setOpen(true)}>+ {t('tasks.new')}</button>
      {open && (
        <Modal title={t('tasks.new')} onClose={() => setOpen(false)} footer={<button className="btn primary" onClick={add}>{t('common.save')}</button>}>
          <Field label={t('gig.title')}><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid2">
            <Field label={t('tasks.due')}><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label={t('tasks.assignedTo')}>
              <select value={who} onChange={(e) => setWho(e.target.value as Task['assignedTo'])}>
                <option value="gijs">Gijs</option><option value="coen">Coen</option><option value="both">{t('common.both')}</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

export function GigLine({ gig }: { gig: Gig }) {
  const { lang } = useI18n();
  const venues = byId(useVenues());
  const v = gig.venueId ? venues.get(gig.venueId) : undefined;
  return (
    <Link to={`/bookings/gigs/${gig.id}`} className="list-item">
      <div style={{ minWidth: 92 }} className="small">{fmtDate(gig.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}<div className="tiny muted">{gig.startTime}–{gig.endTime}</div></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="strong" style={{ overflowWrap: 'anywhere' }}>{gig.title || gig.reference}</div>
        <div className="tiny muted">{[v?.name, v?.city].filter(Boolean).join(', ')}</div>
      </div>
      <MemberChips ids={gig.performers} />
      <StagePill stage={gig.stage} />
    </Link>
  );
}

export { Check, personName };
