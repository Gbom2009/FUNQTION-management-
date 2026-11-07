import { Link } from "react-router-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BarChart3, Car, Disc3, MapPin, Navigation, Play, Route as RouteIcon, Settings, Truck } from "lucide-react";
import logo from "../../assets/logo.svg";
import { useT } from "../../i18n";
import { usePlan } from "../../store/plan";
import { useApp } from "../../store/app";
import { useUi } from "../../store/ui";
import { useGigs } from "../../features/gigs/store";
import { useVehicles } from "../../features/vehicles/store";
import { leaveBy } from "../../features/gigs/leaveBy";
import { formatClock, formatDistance, formatDuration } from "../../nav/format";
import { useWide } from "../../ui/useMedia";
import { Sheet } from "../../ui/Sheet";
import { SearchBox } from "./SearchBox";
import { StopList } from "./StopList";
import { RouteOptionsPanel } from "./RouteOptionsPanel";
import { Alternatives } from "./Alternatives";
import { GigsPanel } from "./GigsPanel";
import { VenuesPanel } from "./VenuesPanel";
import { SetlistPanel } from "./SetlistPanel";
import { HandoffPanel } from "./HandoffPanel";
import { RouteInsights } from "./RouteInsights";

type Tab = "route" | "gigs" | "venues" | "setlist";
const TABS: { k: Tab; icon: typeof RouteIcon }[] = [
  { k: "route", icon: RouteIcon }, { k: "gigs", icon: Disc3 }, { k: "venues", icon: MapPin }, { k: "setlist", icon: BarChart3 },
];

/** The next upcoming gig with a computed leave-by time. */
function useNextGig() {
  const gigs = useGigs((s) => s.gigs);
  const now = Date.now();
  return gigs
    .map((g) => ({ g, leave: g.route ? leaveBy({ ...g, routeS: g.route.seconds }) : null }))
    .filter((x) => x.leave && x.leave.getTime() > now - 3 * 3_600_000)
    .sort((a, b) => a.leave!.getTime() - b.leave!.getTime())[0];
}

/** Route summary + Start — what you see with the sheet collapsed. */
function RouteSummary() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const { routes, selected, stops, loading, error, startDrive } = usePlan();
  const trailer = useVehicles((s) => s.trailers.find((x) => x.id === s.activeTrailerId));
  const r = routes[selected];
  const dest = stops[stops.length - 1];

  if (error) return <p className="py-2 text-sm text-fq-danger">{t("plan.routeError")} ({error})</p>;
  if (!r) return <p className="py-3 text-sm text-fq-muted">{loading ? t("plan.routing") : t("plan.hint")}</p>;
  return (
    <div className={loading ? "opacity-60" : ""}>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-fq-muted">{t("plan.to")} {dest?.name}</div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[34px] leading-none text-fq-primary">{formatDuration(r.timeS, lang)}</span>
            <span className="text-[15px] text-fq-text">{formatDistance(r.lengthM, lang)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-fq-muted">
            <span>{t("plan.arrive")} {formatClock(new Date(Date.now() + r.timeS * 1000))}</span>
            {stops.length > 2 && <span>· {stops.length - 1} {t("plan.stops")}</span>}
            {trailer && <span className="inline-flex items-center gap-1 text-fq-primary">· <Truck size={13} /> {trailer.name}</span>}
          </div>
        </div>
        <button onClick={() => startDrive()} className="fq-btn fq-btn-primary h-16 shrink-0 rounded-2xl px-6 text-base">
          <Play size={22} fill="currentColor" /> {t("plan.go")}
        </button>
      </div>
    </div>
  );
}

/** No route yet: greeting + shortcuts. */
function QuickStart({ onTab }: { onTab: (t: Tab) => void }) {
  const t = useT();
  const setMode = useApp((s) => s.setMode);
  const next = useNextGig();
  const vehicle = useVehicles((s) => s.vehicles.find((v) => v.id === s.activeVehicleId));
  return (
    <div>
      <div className="mb-2 font-display text-xl tracking-[-0.02em] text-fq-strong">{t("plan.where")}</div>
      {next && (
        <button onClick={() => onTab("gigs")} className="fq-card mb-2 flex w-full items-center gap-3 px-3 py-2.5 text-left">
          <Disc3 size={22} className="shrink-0 text-fq-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-fq-strong">{next.g.title}</span>
            <span className="block text-[12px] text-fq-muted">{next.g.date} · {t("gig.leaveBy").toLowerCase()} <b className="font-normal text-fq-primary">{formatClock(next.leave!)}</b></span>
          </span>
        </button>
      )}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <button onClick={() => onTab("gigs")} className="fq-chip"><Disc3 size={16} /> {t("plan.tab.gigs")}</button>
        <button onClick={() => onTab("venues")} className="fq-chip"><MapPin size={16} /> {t("plan.tab.venues")}</button>
        <button onClick={() => onTab("setlist")} className="fq-chip"><BarChart3 size={16} /> {t("plan.tab.setlist")}</button>
        <button onClick={() => setMode("drive")} className="fq-chip"><Navigation size={16} /> {t("plan.freeDrive")}</button>
        {vehicle && <span className="fq-chip text-fq-muted!"><Car size={16} /> {vehicle.name}</span>}
      </div>
    </div>
  );
}

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const t = useT();
  return (
    <div role="tablist" className="fq-card grid grid-cols-4 gap-1 p-1">
      {TABS.map(({ k, icon: Icon }) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] transition-colors ${tab === k ? "bg-fq-bg text-fq-primary" : "text-fq-muted"}`}>
          <Icon size={18} />
          {t(`plan.tab.${k}`)}
        </button>
      ))}
    </div>
  );
}

function TabContent({ tab, setTab, wide }: { tab: Tab; setTab: (t: Tab) => void; wide: boolean }) {
  return (
    <div className="space-y-4">
      {tab === "route" && (
        <>
          <StopList />
          <RouteOptionsPanel />
          <Alternatives showStart={wide} />
          <RouteInsights />
          <HandoffPanel />
        </>
      )}
      {tab === "gigs" && <GigsPanel onPlanned={() => { setTab("route"); useUi.getState().setSheetSnap("peek"); }} />}
      {tab === "venues" && <VenuesPanel />}
      {tab === "setlist" && <SetlistPanel />}
    </div>
  );
}

function PickBanner() {
  const t = useT();
  const picking = useGigs((s) => s.picking);
  if (!picking) return null;
  return (
    <div className="fq-floating pointer-events-auto flex items-center gap-3 rounded-2xl border-fq-primary! px-4 py-3 text-[14px] text-fq-primary">
      <MapPin size={20} className="shrink-0" />
      <span className="flex-1">{picking.field === "loadInDoor" ? t("venue.pickDoorHint") : t("venue.pickParkingHint")}</span>
      <button onClick={() => useGigs.getState().finishPicking(null)} className="fq-btn h-10 min-h-0 px-3 text-[13px]">{t("venue.cancel")}</button>
    </div>
  );
}

/**
 * Plan mode.
 * Phone: floating search pill on top + draggable bottom sheet (peek shows the
 * route and a big Start button). Tablet/desktop: left side panel.
 * The logo lives here (and on the splash) only.
 */
export function PlanMode() {
  const t = useT();
  const wide = useWide();
  const setMode = useApp((s) => s.setMode);
  const [tab, setTab] = useState<Tab>("route");
  const hasStops = usePlan((s) => s.stops.length > 0);
  const hasRoute = usePlan((s) => s.routes.length > 0);
  const picking = useGigs((s) => s.picking);
  const setSnap = useUi((s) => s.setSheetSnap);
  const setPanelPx = useUi((s) => s.setPanelPx);
  const panel = useRef<HTMLDivElement>(null);

  // Collapse the sheet while picking a pin, so the map is reachable.
  useEffect(() => { if (picking) setSnap("peek"); }, [picking, setSnap]);
  // A fresh route: show it (peek = summary + Start).
  useEffect(() => { if (hasRoute) setSnap("peek"); }, [hasRoute, setSnap]);

  useLayoutEffect(() => {
    if (!wide || !panel.current) { setPanelPx(0); return; }
    const el = panel.current;
    const ro = new ResizeObserver(() => setPanelPx(el.offsetWidth + 16));
    ro.observe(el);
    return () => { ro.disconnect(); setPanelPx(0); };
  }, [wide, setPanelPx]);

  const openTab = (k: Tab) => { setTab(k); setSnap("half"); };
  const settingsBtn = (
    <button onClick={() => setMode("settings")} aria-label={t("mode.settings")}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fq-text hover:bg-fq-surface">
      <Settings size={22} />
    </button>
  );
  // The logo leads back to the Funqtion Hub.
  const logoMark = (
    <Link to="/" aria-label={t("hub.back")} className="shrink-0">
      <img src={logo} alt="Team Funqtion" className="h-10 w-10 rounded-full bg-[#040404] p-1" />
    </Link>
  );

  if (wide) {
    return (
      <div ref={panel} className="pointer-events-none absolute bottom-4 left-4 top-4 flex w-[420px] flex-col gap-3">
        <div className="pointer-events-auto fq-floating flex items-center gap-3 rounded-2xl px-4 py-3">
          <Link to="/" aria-label={t("hub.back")} className="shrink-0">
            <img src={logo} alt="Team Funqtion" className="h-11 w-11 rounded-full bg-[#040404] p-1" />
          </Link>
          <div className="flex-1 leading-tight">
            <div className="font-display text-lg tracking-[-0.03em] text-fq-strong">FUNQTION MAPS</div>
            <div className="text-[11px] text-fq-primary">{t("tagline")}</div>
          </div>
          {settingsBtn}
        </div>
        <div className="pointer-events-auto"><SearchBox variant="bar" /></div>
        <PickBanner />
        <section className="pointer-events-auto fq-floating flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl p-4">
          {hasStops ? <RouteSummary /> : <QuickStart onTab={setTab} />}
          <Tabs tab={tab} setTab={setTab} />
          <TabContent tab={tab} setTab={setTab} wide />
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="pointer-events-auto absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 space-y-2">
        <SearchBox variant="bar" leading={logoMark} trailing={settingsBtn}
          onFocusChange={(f) => { if (f) setSnap("peek"); }} />
        <PickBanner />
      </div>
      <Sheet header={hasStops ? <RouteSummary /> : <QuickStart onTab={openTab} />}>
        <div className="space-y-4 pt-1">
          <Tabs tab={tab} setTab={setTab} />
          <TabContent tab={tab} setTab={setTab} wide={false} />
        </div>
      </Sheet>
    </>
  );
}
