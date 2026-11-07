import { ChevronLeft, Car, FlaskConical, HardDriveDownload, Layers, MessageSquareText, Palette, Volume2, Zap } from "lucide-react";
import { useApp } from "../../store/app";
import { useT } from "../../i18n";
import { useDrive } from "../../store/drive";
import { useVehicles } from "../../features/vehicles/store";
import { useVoice } from "../../nav/tts/store";
import { Section, Segmented, Toggle } from "../../ui/controls";
import { VehiclesSettings } from "./VehiclesSettings";
import { OfflineSettings, PhevSettings } from "./PhevOfflineSettings";
import { VoiceSettings } from "./VoiceSettings";
import { GuidanceSettings, MapDisplaySettings } from "./GuidanceSettings";
import { useGuidance } from "../../nav/narration/settings";

/** Settings: full-screen page on phones, centred column on wide screens. */
export function SettingsMode() {
  const t = useT();
  const { lang, setLang, theme, setTheme, autoTheme, setAutoTheme, setMode } = useApp();
  const { source, devTools, set } = useDrive();
  const vehicle = useVehicles((s) => s.vehicles.find((v) => v.id === s.activeVehicleId));
  const trailer = useVehicles((s) => s.trailers.find((x) => x.id === s.activeTrailerId));
  const engine = useVoice((s) => s.engine);
  const level = useGuidance((s) => s.level);

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 overflow-y-auto bg-fq-bg">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-fq-line bg-fq-bg/95 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <button onClick={() => setMode("plan")} aria-label={t("settings.back")}
          className="flex h-12 w-12 items-center justify-center rounded-full text-fq-strong hover:bg-fq-surface">
          <ChevronLeft size={26} />
        </button>
        <h1 className="font-display text-2xl tracking-[-0.03em] text-fq-strong">{t("mode.settings")}</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-3 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3">
        <Section icon={<Palette size={20} />} title={t("settings.general")} defaultOpen
          summary={`${lang === "nl" ? "Nederlands" : "English"} · ${autoTheme ? t("settings.auto") : t(`settings.theme.${theme}`)}`}>
          <div>
            <span className="fq-label">{t("settings.language")}</span>
            <Segmented value={lang} onChange={setLang} options={[{ v: "nl", label: "Nederlands" }, { v: "en", label: "English" }]} />
          </div>
          <div>
            <span className="fq-label">{t("settings.theme")}</span>
            <Segmented value={theme} onChange={(v) => { setAutoTheme(false); setTheme(v); }}
              options={[{ v: "night", label: t("settings.theme.night") }, { v: "day", label: t("settings.theme.day") }]} />
            <Toggle checked={autoTheme} onChange={setAutoTheme} label={t("settings.autoTheme")} />
          </div>
        </Section>

        <Section icon={<MessageSquareText size={20} />} title={t("guide.title")} summary={t(`guide.levelName.${level}` as never)}>
          <GuidanceSettings />
        </Section>

        <Section icon={<Layers size={20} />} title={t("map.title")} summary={t("map.summary")}>
          <MapDisplaySettings />
        </Section>

        <Section icon={<Volume2 size={20} />} title={t("voice.title")}
          summary={engine === "piper" ? t("voice.engine.piper") : t("voice.engine.system")}>
          <VoiceSettings />
        </Section>

        <Section icon={<Car size={20} />} title={t("settings.vehicles")}
          summary={`${vehicle?.name ?? "—"}${trailer ? ` + ${trailer.name}` : ""}`}>
          <VehiclesSettings />
        </Section>

        <Section icon={<Zap size={20} />} title={t("phev.title")} summary={t("phev.summary")}>
          <PhevSettings />
        </Section>

        <Section icon={<HardDriveDownload size={20} />} title={t("offline.title")} summary={t("offline.summary")}>
          <OfflineSettings />
        </Section>

        <Section icon={<FlaskConical size={20} />} title={t("settings.developer")}
          summary={source === "sim" ? t("settings.source.sim") : t("settings.source.real")}>
          <div>
            <span className="fq-label">{t("settings.source")}</span>
            <Segmented value={source} onChange={(v) => set({ source: v })}
              options={[{ v: "real", label: t("settings.source.real") }, { v: "sim", label: t("settings.source.sim") }]} />
          </div>
          <Toggle checked={devTools} onChange={(v) => set({ devTools: v })} label={t("settings.devTools")} />
        </Section>

        <p className="px-2 pt-2 text-center text-[11px] text-fq-muted">
          Funqtion Maps {__APP_VERSION__} · {t("tagline")}<br />
          © OpenStreetMap · OpenFreeMap · PDOK · Photon · Valhalla
        </p>
      </div>
    </div>
  );
}
