import { useEffect, useState } from "react";
import { useGigs, type Gig } from "../../features/gigs/store";
import { leaveBy, urgency } from "../../features/gigs/leaveBy";
import { computeGigRoute, planGig } from "../../features/gigs/gigRoute";
import { etaMessage, shareText } from "../../features/gigs/shareEta";
import { requestNotificationPermission } from "../../features/gigs/reminders";
import { formatClock, formatDistance, formatDuration } from "../../nav/format";
import { useApp } from "../../store/app";
import { useT } from "../../i18n";

const field = "fq-input";
const label = "fq-label";

function GigCard({ gig, onPlanned }: { gig: Gig; onPlanned: () => void }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const { venues, updateGig, removeGig } = useGigs();
  const venue = venues.find((v) => v.id === gig.venueId);
  const [edit, setEdit] = useState(!gig.venueId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);

  const leave = gig.route ? leaveBy({ ...gig, routeS: gig.route.seconds }) : null;
  const u = leave ? urgency(leave) : null;
  const color = u === "late" ? "text-fq-danger" : u === "now" || u === "soon" ? "text-fq-warn" : "text-fq-primary";

  const compute = async () => {
    setBusy(true); setMsg(null);
    try { await computeGigRoute(useGigs.getState().gigs.find((g) => g.id === gig.id)!); void requestNotificationPermission(); }
    catch (e) { setMsg(`${t("gig.routeError")} (${(e as Error).message})`); }
    finally { setBusy(false); }
  };

  const share = async () => {
    if (!gig.route) return;
    const eta = new Date(Math.max(Date.now(), leave?.getTime() ?? Date.now()) + gig.route.seconds * 1000);
    const r = await shareText(etaMessage(eta, { lang, towing: gig.route.towing, venue: venue?.name }));
    setMsg(r === "copied" ? t("share.copied") : r === "failed" ? t("share.failed") : null);
  };

  return (
    <article className="fq-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-fq-strong">{gig.title}</div>
          <div className="truncate text-[11px] text-fq-muted">
            {gig.date} · {t("gig.loadIn")} {gig.loadIn}{venue ? ` · ${venue.name}` : ""}
          </div>
        </div>
        <button onClick={() => setEdit(!edit)} className="h-8 px-2 text-[12px] text-fq-muted hover:text-fq-strong">
          {edit ? t("gig.done") : t("gig.edit")}
        </button>
      </div>

      {leave && (
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-[11px] uppercase tracking-widest text-fq-muted">{t("gig.leaveBy")}</span>
          <span className={`font-display text-3xl ${color}`}>{formatClock(leave)}</span>
          {u === "late" && <span className="text-[12px] text-fq-danger">{t("gig.late")}</span>}
        </div>
      )}
      {gig.route && (
        <div className="text-[11px] text-fq-muted">
          {formatDuration(gig.route.seconds, lang)} · {formatDistance(gig.route.meters, lang)} {t("gig.from")} {gig.route.fromName}
          {gig.route.towing ? ` · ${t("tow.badge")}` : ""} · +{gig.trafficMarginPct}% · {gig.setupBufferMin} min {t("gig.setup")}
        </div>
      )}

      {edit && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="col-span-2">
            <span className={label}>{t("gig.title")}</span>
            <input className={field} value={gig.title} onChange={(e) => updateGig(gig.id, { title: e.target.value })} />
          </label>
          <label className="col-span-2">
            <span className={label}>{t("gig.venue")}</span>
            <select className={field} value={gig.venueId ?? ""} onChange={(e) => updateGig(gig.id, { venueId: e.target.value || undefined, route: undefined })}>
              <option value="">—</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label><span className={label}>{t("gig.date")}</span>
            <input type="date" className={field} value={gig.date} onChange={(e) => updateGig(gig.id, { date: e.target.value })} /></label>
          <label><span className={label}>{t("gig.loadIn")}</span>
            <input type="time" className={field} value={gig.loadIn} onChange={(e) => updateGig(gig.id, { loadIn: e.target.value })} /></label>
          <label><span className={label}>{t("gig.setup")} (min)</span>
            <input type="number" min={0} step={15} className={field} value={gig.setupBufferMin}
              onChange={(e) => updateGig(gig.id, { setupBufferMin: Number(e.target.value) || 0 })} /></label>
          <label><span className={label}>{t("gig.traffic")} (%)</span>
            <input type="number" min={0} max={100} step={5} className={field} value={gig.trafficMarginPct}
              onChange={(e) => updateGig(gig.id, { trafficMarginPct: Number(e.target.value) || 0 })} /></label>
          <label className="col-span-2"><span className={label}>{t("gig.notes")}</span>
            <textarea rows={2} className={field} value={gig.notes ?? ""} onChange={(e) => updateGig(gig.id, { notes: e.target.value })} /></label>
          <button onClick={() => removeGig(gig.id)} className="col-span-2 h-9 text-[12px] text-fq-muted hover:text-fq-danger">{t("gig.delete")}</button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={!venue || busy} onClick={compute}
          className="fq-btn h-10 px-3 text-[12px] disabled:opacity-40">{busy ? "…" : gig.route ? t("gig.recompute") : t("gig.compute")}</button>
        <button disabled={!venue} onClick={() => { if (planGig(gig)) onPlanned(); }}
          className="fq-btn h-10 px-3 text-[12px] text-fq-primary! disabled:opacity-40">{t("gig.plan")}</button>
        <button disabled={!gig.route} onClick={share} className="fq-btn h-10 px-3 text-[12px] disabled:opacity-40">{t("share.eta")}</button>
      </div>
      {!venue && <div className="mt-2 text-[11px] text-fq-muted">{t("gig.needVenue")}</div>}
      {msg && <div className="mt-2 text-[11px] text-fq-muted">{msg}</div>}
    </article>
  );
}

export function GigsPanel({ onPlanned }: { onPlanned: () => void }) {
  const t = useT();
  const { gigs, addGig } = useGigs();
  const sorted = [...gigs].sort((a, b) => `${a.date} ${a.loadIn}`.localeCompare(`${b.date} ${b.loadIn}`));
  return (
    <div className="space-y-3">
      {sorted.map((g) => <GigCard key={g.id} gig={g} onPlanned={onPlanned} />)}
      {!gigs.length && <p className="text-[13px] text-fq-muted">{t("gig.empty")}</p>}
      <button onClick={() => addGig()} className="fq-btn h-12 w-full text-sm">+ {t("gig.add")}</button>
      <p className="text-[11px] text-fq-muted">{t("gig.notifyNote")}</p>
    </div>
  );
}
