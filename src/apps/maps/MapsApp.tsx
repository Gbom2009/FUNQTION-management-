import { useEffect, useRef, useState } from "react";
import "./maps.css";
import { useSession } from "../../core/session";
import { AlarmClock, X } from "lucide-react";
import { MapView } from "./map/MapView";
import { PlanMode } from "./modes/plan/PlanMode";
import { DriveMode } from "./modes/drive/DriveMode";
import { SettingsMode } from "./modes/settings/SettingsMode";
import { useApp } from "./store/app";
import { usePlan } from "./store/plan";
import { useDrive } from "./store/drive";
import * as session from "./modes/drive/session";
import { keepAwake } from "./location/wakeLock";
import { isNight } from "./theme/sun";
import { HOME } from "./config/services";
import { setReminderBanner, startReminders } from "./features/gigs/reminders";

// Leave-by reminders run for the app lifetime.
startReminders();

export default function MapsApp() {
  const { mode, setMode, theme, setTheme, autoTheme, lang } = useApp();
  const active = usePlan((s) => s.active);
  const locked = useDrive((s) => s.locked);
  const source = useDrive((s) => s.source);
  const [reminder, setReminder] = useState<string | null>(null);
  useEffect(() => { setReminderBanner(setReminder); return () => setReminderBanner(() => {}); }, []);

  // Language follows the hub (Settings → Taal); changing it in Maps changes the hub too.
  const { settings, updateSettings } = useSession();
  const hubLang = useRef(settings.language);
  hubLang.current = settings.language;
  useEffect(() => {
    if (useApp.getState().lang !== settings.language) useApp.getState().setLang(settings.language);
  }, [settings.language]);
  useEffect(() => useApp.subscribe((s, prev) => {
    if (s.lang !== prev.lang && s.lang !== hubLang.current) void updateSettings({ language: s.lang });
  }), [updateSettings]);


  // ---- drive session lifecycle: one session per "Start driving" --------
  const sessionId = active?.sessionId;
  useEffect(() => {
    const a = usePlan.getState().active;
    if (a) session.start(a);
    else session.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, source]);
  // Free driving (no route): still show position/speed while in Drive mode.
  useEffect(() => {
    if (mode === "drive" && !usePlan.getState().active && source === "real") session.ensureProvider();
    if (mode !== "drive" && !usePlan.getState().active) session.stop();
  }, [mode, source]);

  useEffect(() => { keepAwake(!!active || mode === "drive"); }, [active, mode]);

  // ---- safety lock: moving → only Drive mode ----------------------------
  useEffect(() => { if (locked && mode !== "drive") setMode("drive"); }, [locked, mode, setMode]);

  // ---- automatic day/night ---------------------------------------------
  useEffect(() => {
    if (!autoTheme) return;
    const apply = () => {
      const f = useDrive.getState().fix;
      const night = isNight(new Date(), f?.lat ?? HOME[1], f?.lon ?? HOME[0]);
      const want = night ? "night" : "day";
      if (useApp.getState().theme !== want) setTheme(want);
    };
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, [autoTheme, setTheme]);

  return (
    <div className={`fq-maps overflow-hidden fq-mode-${mode}`} data-map-theme={theme} lang={lang}>
      <MapView mode={mode === "drive" ? "drive" : "plan"} />
      <div className="pointer-events-none absolute inset-0">
        {(mode === "plan" || mode === "settings") && <PlanMode />}
        {mode === "drive" && <DriveMode />}
        {mode === "settings" && <SettingsMode />}
      </div>

      {reminder && (
        <div role="alert" className="fq-floating absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border-fq-primary! px-4 py-3 text-fq-strong">
          <AlarmClock size={26} className="shrink-0 text-fq-primary" />
          <span className="flex-1 text-[15px]">{reminder}</span>
          <button onClick={() => setReminder(null)} className="flex h-11 w-11 items-center justify-center text-fq-muted" aria-label="close"><X size={20} /></button>
        </div>
      )}
    </div>
  );
}
