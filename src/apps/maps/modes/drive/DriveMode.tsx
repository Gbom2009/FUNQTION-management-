import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowUpToLine, Camera, Euro, FlaskConical, Footprints, Mountain, OctagonX, TrainFront, Leaf, LocateFixed, Map as MapIcon, MoreHorizontal, Share2, SkipForward,
  Truck, Volume2, VolumeX, X, Zap,
} from "lucide-react";
import { useT } from "../../i18n";
import { usePlan } from "../../store/plan";
import { useApp } from "../../store/app";
import { useDrive } from "../../store/drive";
import { formatClock, formatDistance, formatDuration } from "../../nav/format";
import { isSpeeding } from "../../nav/speed";
import { buildGeometry } from "../../nav/guidance";
import { stopSpeaking } from "../../nav/voice";
import { ManeuverIcon } from "./ManeuverIcon";
import { JunctionArt } from "./JunctionArt";
import { SimPanel } from "./SimPanel";
import * as session from "./session";
import { etaMessage, shareText } from "../../features/gigs/shareEta";
import { useGigs } from "../../features/gigs/store";
import { useMapSettings } from "../../map/settings";

/** Maneuver distance the way a HUD should show it: coarse when far, fine when close. */
function hudDistance(m: number, lang: "nl" | "en") {
  if (m < 100) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return formatDistance(m, lang);
}

/** Small pictogram per road-detail topic. */
function RoadIcon({ topic }: { topic: string }) {
  const cls = "h-7 w-7 shrink-0";
  switch (topic) {
    case "camera": return <Camera className={`${cls} text-fq-danger`} />;
    case "rail": return <TrainFront className={cls} />;
    case "zebra": return <Footprints className={cls} />;
    case "height": return <ArrowUpToLine className={cls} />;
    case "stopSign": return <OctagonX className={`${cls} text-fq-danger`} />;
    case "toll": return <Euro className={cls} />;
    case "tunnel": return <Mountain className={cls} />;
    default: return <AlertTriangle className={cls} />;
  }
}

/** Round floating button, 60 px — big enough with a glove on, at arm's length. */
function RoundBtn({ onClick, label, pressed, children, disabled }: {
  onClick: () => void; label: string; pressed?: boolean; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={pressed} disabled={disabled}
      className="fq-icon-btn h-[60px]! w-[60px]! disabled:opacity-40">
      {children}
    </button>
  );
}

/**
 * Drive mode — glanceable, 60–64 px targets, no logo. Portrait (iPhone) and
 * landscape (iPad mini on the mount): the banner sits top-left in landscape so
 * the road ahead stays visible.
 */
export function DriveMode() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const setMode = useApp((s) => s.setMode);
  const active = usePlan((s) => s.active);
  const endDrive = usePlan((s) => s.endDrive);
  const {
    fix, guidance: g, limitKmh, postedKmh, capKmh, towWarning, zoneNotice, roadNotice, muted, follow, rerouting, rerouteError,
    arrived, gpsError, locked, source, devTools, set,
  } = useDrive();
  const gig = useGigs((s) => s.gigs.find((x) => x.id === active?.gigId));
  const { etaMode, showThen, bannerSize } = useMapSettings();
  const big = bannerSize === "large";
  const [more, setMore] = useState(false);
  const [showSim, setShowSim] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const towing = !!active?.tow;

  const flash = (m: string | null) => { setToast(m); if (m) setTimeout(() => setToast(null), 3000); };
  const share = async () => {
    if (!g) return;
    const dest = gig ? useGigs.getState().venues.find((v) => v.id === gig.venueId)?.name : active?.stops[active.stops.length - 1]?.name;
    const r = await shareText(etaMessage(new Date(Date.now() + g.remainingS * 1000), { lang, towing, venue: dest }));
    flash(r === "copied" ? t("share.copied") : r === "failed" ? t("share.failed") : null);
  };

  // The HUD only needs maneuver text — derive the geometry cheaply from the active route.
  const [geo, setGeo] = useState(() => (active ? buildGeometry(active.route) : null));
  useEffect(() => { setGeo(active ? buildGeometry(active.route) : null); }, [active?.route]);
  useEffect(() => { if (locked) setMore(false); }, [locked]);

  const next = g && geo && g.next >= 0 ? geo.maneuvers[g.next] : null;
  const after = g && geo && g.next >= 0 ? geo.maneuvers[g.next + 1] : null;
  const speed = Math.round(fix?.speedKmh ?? 0);
  const speeding = isSpeeding(fix?.speedKmh ?? 0, limitKmh);
  const multiStop = (active?.stops.length ?? 0) > 2;
  const nextStop = active && g ? active.stops[g.leg + 1] : null;
  const end = () => { session.stop(); endDrive(); setMode("plan"); };
  const toggleMute = () => { if (!muted) stopSpeaking(); set({ muted: !muted }); };

  const notices = (
    <div className="mt-2 flex flex-col gap-2">
      {towWarning && !arrived && (
        <div className="fq-floating flex items-center gap-2 rounded-2xl border-fq-warn! px-4 py-3 text-[17px] text-fq-warn">
          <AlertTriangle size={22} className="shrink-0" />
          {towWarning.kind === "sharp" ? t("tow.warn.sharp") : towWarning.kind === "narrow" ? t("tow.warn.narrow") : `${t("tow.warn.descent")} ${towWarning.gradePct}%`}
        </div>
      )}
      {roadNotice && !arrived && (
        <div className={`fq-floating flex items-center gap-3 rounded-2xl px-4 py-3 text-[17px] ${roadNotice.topic === "height" ? "border-fq-danger! text-fq-danger" : roadNotice.topic === "camera" ? "border-fq-danger! text-fq-strong" : "text-fq-strong"}`}>
          <RoadIcon topic={roadNotice.topic} />
          <span className="flex-1">{t(`road.${roadNotice.topic}` as never)}</span>
          <span className="font-display text-xl">{hudDistance(roadNotice.dist, lang)}</span>
        </div>
      )}
      {zoneNotice && !arrived && (
        <div className={`fq-floating flex items-center gap-2 rounded-2xl px-4 py-3 text-[17px] ${zoneNotice.kind === "ev" ? "border-[#3ddc84]! text-[#3ddc84]" : "text-fq-strong"}`}>
          {zoneNotice.kind === "ev" ? <Zap size={22} className="shrink-0" /> : <Leaf size={22} className="shrink-0 text-[#3ddc84]" />}
          {zoneNotice.text}
        </div>
      )}
      {(rerouting || (rerouteError && !rerouting)) && (
        <div className={`fq-floating rounded-2xl px-4 py-2.5 text-[15px] ${rerouting ? "text-fq-warn" : "text-fq-danger"}`}>
          {rerouting ? t("drive.rerouting") : t("drive.rerouteFailed")}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* --- maneuver banner ("Next drop") ---------------------------------- */}
      <div className="pointer-events-none absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 landscape:right-auto landscape:w-[min(26rem,48vw)] md:right-auto md:w-[28rem]">
        <section className="pointer-events-auto overflow-hidden rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
          {!active ? (
            <div className="bg-fq-bg/95 px-5 py-4">
              <div className="text-[12px] uppercase tracking-widest text-fq-primary">{t("drive.nextDrop")}</div>
              <div className="mt-1 text-lg text-fq-strong">{fix ? t("drive.freeDrive") : gpsError ? `${t("drive.gpsError")}: ${gpsError}` : t("drive.waitingGps")}</div>
            </div>
          ) : arrived ? (
            <div className="flex items-center gap-4 bg-fq-primary px-5 py-4 text-[#040404]">
              <ManeuverIcon type={4} className="h-14 w-14 shrink-0" />
              <div className="min-w-0">
                <div className="font-display text-3xl leading-none">{t("drive.arrived")}</div>
                <div className="mt-1 truncate text-[15px]">{active.stops[active.stops.length - 1]?.name}</div>
              </div>
            </div>
          ) : next && g ? (
            <>
              <div className="flex items-center gap-4 bg-fq-primary px-4 py-3.5 text-[#040404]">
                {(() => {
                  const art = session.maneuverArtAt(g.next);
                  return art
                    ? <JunctionArt art={art} className="h-[80px] w-[80px] shrink-0" />
                    : <ManeuverIcon type={next.type} exit={next.roundaboutExit} className="h-[72px] w-[72px] shrink-0" />;
                })()}
                <div className="min-w-0 flex-1">
                  <div className={`font-display leading-none tracking-[-0.02em] ${big ? "text-[60px]" : "text-[46px]"}`}>{hudDistance(g.distToNext, lang)}</div>
                  <div className={`mt-1 line-clamp-2 leading-snug ${big ? "text-[24px]" : "text-[19px]"}`}>{next.streetNames[0] ?? next.instruction}</div>
                </div>
              </div>
              {showThen && after && after.along - next.along < 400 && (
                <div className="flex items-center gap-2 bg-[#b9640d] px-5 py-2 text-[15px] text-[#040404]">
                  {t("drive.then")} <ManeuverIcon type={after.type} className="h-6 w-6" /> <span className="truncate">{after.streetNames[0] ?? ""}</span>
                </div>
              )}
            </>
          ) : (
            <div className="bg-fq-bg/95 px-5 py-4 text-lg text-fq-muted">{gpsError ? `${t("drive.gpsError")}: ${gpsError}` : t("drive.waitingGps")}</div>
          )}
        </section>
        <div className="pointer-events-auto">{notices}</div>
      </div>

      {/* --- right rail: mute + recenter ------------------------------------- */}
      <div className={`pointer-events-auto absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-3 transition-[bottom] portrait:top-auto portrait:translate-y-0 ${more ? "portrait:bottom-[calc(env(safe-area-inset-bottom)+19rem)]" : "portrait:bottom-[calc(env(safe-area-inset-bottom)+12rem)]"}`}>
        <RoundBtn onClick={toggleMute} label={muted ? t("drive.unmute") : t("drive.mute")} pressed={muted}>
          {muted ? <VolumeX size={26} /> : <Volume2 size={26} />}
        </RoundBtn>
        {!follow && (
          <RoundBtn onClick={() => set({ follow: true })} label={t("drive.recenter")}>
            <LocateFixed size={26} className="text-fq-primary" />
          </RoundBtn>
        )}
      </div>

      {/* --- speed + limit (+ tow cap) --------------------------------------- */}
      <div className={`pointer-events-auto absolute left-3 z-20 flex items-end gap-2 transition-[bottom] ${more ? "bottom-[calc(env(safe-area-inset-bottom)+14rem)]" : "bottom-[calc(env(safe-area-inset-bottom)+7rem)]"}`}>
        <div className={`flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full border-2 bg-fq-bg/92 shadow-lg backdrop-blur ${speeding ? "border-fq-danger" : "border-fq-line"}`}>
          <span className={`font-display text-[34px] leading-none ${speeding ? "text-fq-danger" : "text-fq-strong"}`}>{speed}</span>
          <span className="text-[11px] text-fq-muted">km/h</span>
        </div>
        {limitKmh !== undefined && (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-[6px] border-[#e3262b] bg-white font-display text-2xl text-[#040404] shadow-lg"
            aria-label={`${t("drive.limit")} ${limitKmh}`}
            title={towing && postedKmh !== undefined && postedKmh !== limitKmh ? `${t("tow.posted")} ${postedKmh}` : undefined}>
            {limitKmh}
          </div>
        )}
        {towing && (
          <div className="flex h-12 items-center gap-1.5 rounded-full border border-fq-primary bg-fq-bg/92 px-3 text-fq-primary shadow-lg" title={active?.tow?.trailer.name}>
            <Truck size={18} />
            {capKmh !== undefined && <span className="font-display text-lg leading-none">{capKmh}</span>}
          </div>
        )}
      </div>

      {/* --- bottom bar ------------------------------------------------------ */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-fq-line bg-fq-bg/96 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3">
          <button onClick={active ? end : () => setMode("plan")} aria-label={active ? t("drive.end") : t("drive.toPlan")}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-fq-surface text-fq-danger">
            <X size={30} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            {active && g && !arrived ? (
              <>
                <div className="font-display text-[34px] leading-none text-fq-primary">
                  {etaMode === "arrival" ? formatClock(new Date(Date.now() + g.remainingS * 1000)) : formatDuration(g.remainingS, lang)}
                </div>
                <div className="mt-1 truncate text-[15px] text-fq-text">
                  {etaMode === "arrival" ? formatDuration(g.remainingS, lang) : `${t("drive.eta")} ${formatClock(new Date(Date.now() + g.remainingS * 1000))}`} · {formatDistance(g.remainingM, lang)}
                  {multiStop && nextStop ? <span className="text-fq-muted"> · {t("drive.toStop")} {formatDistance(g.legRemainingM, lang)}</span> : null}
                </div>
              </>
            ) : (
              <div className="text-[15px] text-fq-muted">{arrived ? t("drive.arrived") : active ? t("drive.waitingGps") : t("drive.freeDrive")}</div>
            )}
          </div>
          <button onClick={() => setMore(!more)} aria-label={t("drive.more")} aria-expanded={more}
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${more ? "bg-fq-primary text-[#040404]" : "bg-fq-surface text-fq-strong"}`}>
            <MoreHorizontal size={30} />
          </button>
        </div>

        {more && (
          <div className="mx-auto mt-3 grid max-w-3xl grid-cols-4 gap-2 px-3">
            <button onClick={share} disabled={locked || !active || !g} className="fq-btn h-[72px] flex-col gap-1 rounded-2xl px-1 text-[12px]">
              <Share2 size={24} /> {t("share.eta")}
            </button>
            <button onClick={() => { session.skipStop(); setMore(false); }} disabled={!multiStop || arrived} className="fq-btn h-[72px] flex-col gap-1 rounded-2xl px-1 text-[12px]">
              <SkipForward size={24} /> {t("drive.nextStop")}
            </button>
            <button onClick={() => setMode("plan")} disabled={locked} className="fq-btn h-[72px] flex-col gap-1 rounded-2xl px-1 text-[12px]">
              <MapIcon size={24} /> {t("drive.toPlan")}
            </button>
            <button onClick={() => setShowSim(!showSim)} disabled={!(source === "sim" && devTools)} aria-pressed={showSim}
              className="fq-btn h-[72px] flex-col gap-1 rounded-2xl px-1 text-[12px]">
              <FlaskConical size={24} /> {t("sim.title")}
            </button>
            {locked && <p className="col-span-4 text-center text-[12px] text-fq-muted">🔒 {t("drive.lockedMsg")}</p>}
          </div>
        )}
      </div>

      {toast && (
        <div className="fq-floating pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 rounded-2xl px-5 py-3 text-[15px] text-fq-strong">{toast}</div>
      )}

      {source === "sim" && devTools && showSim && <SimPanel onClose={() => setShowSim(false)} />}
    </>
  );
}
