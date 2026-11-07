import { useApp } from "../../store/app";
import { LEVELS, TOPICS, TOPIC_LEVEL, topicOn, useGuidance, type Level, type Topic } from "../../nav/narration/settings";
import { useMapSettings } from "../../map/settings";
import { Segmented, Toggle } from "../../ui/controls";
import { useT } from "../../i18n";

const TOPIC_LABEL: Record<Topic, { nl: string; en: string; hint?: { nl: string; en: string } }> = {
  turnDetail: { nl: "Rijke afslagen", en: "Rich turn instructions", hint: { nl: "verkeerslichten, afritnummer, richting, 'en daarna direct…'", en: "traffic lights, exit number, direction, 'then immediately…'" } },
  camera: { nl: "Flitsers", en: "Speed cameras", hint: { nl: "alleen in Nederland en België — elders is waarschuwen verboden", en: "NL and BE only — illegal elsewhere" } },
  zone: { nl: "Milieuzones", en: "Low-emission zones", hint: { nl: "inclusief of jouw auto erin mag", en: "including whether your car may enter" } },
  zoneDetail: { nl: "Milieuzone volledig uitgelegd", en: "Full zone explanation", hint: { nl: "regels per voertuigsoort, handhaving, boete", en: "rules, enforcement, fine" } },
  speedLimit: { nl: "Snelheidswisselingen", en: "Speed limit changes" },
  rail: { nl: "Spoorwegovergangen", en: "Level crossings" },
  toll: { nl: "Tolwegen", en: "Toll roads" },
  roundabout: { nl: "Rotonde-details", en: "Roundabout details", hint: { nl: "aantal afslagen, fietsers rond de rotonde", en: "number of exits, cyclists" } },
  zebra: { nl: "Zebrapaden", en: "Zebra crossings" },
  cycle: { nl: "Fietsstroken en fietspaden", en: "Cycle lanes and paths", hint: { nl: "bij afslaan en waar een fietsstrook begint", en: "when turning and where a lane starts" } },
  oneway: { nl: "Eenrichtingswegen", en: "One-way streets" },
  priority: { nl: "Kruispunten zonder verkeerslichten", en: "Junctions without lights", hint: { nl: "let op verkeer van rechts", en: "watch traffic from the right" } },
  stopSign: { nl: "Stop- en voorrangsborden", en: "Stop / give way" },
  tunnel: { nl: "Tunnels en doorrijhoogtes", en: "Tunnels and clearances" },
  lights: { nl: "Kruispunten met verkeerslichten (rechtdoor) en bruggen", en: "Signalled junctions (straight on) and bridges" },
  crossing: { nl: "Overige oversteekplaatsen", en: "Other crossings" },
  bump: { nl: "Verkeersdrempels", en: "Speed bumps" },
  surface: { nl: "Onverharde wegen", en: "Unpaved roads" },
  lanes: { nl: "Aantal rijstroken", en: "Number of lanes" },
  height: { nl: "Te lage doorrijhoogte / te zwaar", en: "Too low / too heavy", hint: { nl: "altijd aan — vergelijkt met jouw auto en aanhanger", en: "always on — compared with your vehicle" } },
};

const LEVEL_LABEL: Record<Level, { nl: string; en: string }> = {
  kort: { nl: "Kort", en: "Brief" }, normaal: { nl: "Normaal", en: "Normal" }, uitgebreid: { nl: "Uitgebreid", en: "Detailed" }, max: { nl: "Max", en: "Max" },
};

export function GuidanceSettings() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const g = useGuidance();
  return (
    <div className="space-y-4">
      <div>
        <span className="fq-label">{t("guide.level")}</span>
        <Segmented value={g.level} onChange={(level) => g.set({ level })} options={LEVELS.map((l) => ({ v: l, label: LEVEL_LABEL[l][lang] }))} />
        <p className="mt-2 text-[12px] leading-snug text-fq-muted">{t(`guide.level.${g.level}` as never)}</p>
      </div>
      <div className="divide-y divide-fq-line">
        {TOPICS.map((tp) => {
          const lab = TOPIC_LABEL[tp];
          const on = topicOn(tp, g.level, g.overrides);
          const overridden = g.overrides[tp] !== undefined;
          return (
            <div key={tp} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Toggle checked={on} onChange={(v) => g.setTopic(tp, v)} label={lab[lang]}
                  hint={<>{lab.hint?.[lang]}{lab.hint ? " · " : ""}{t("guide.from")} {LEVEL_LABEL[TOPIC_LEVEL[tp]][lang]}{overridden ? ` · ${t("guide.custom")}` : ""}</>} />
              </div>
              {overridden && tp !== "height" && (
                <button onClick={() => g.setTopic(tp, undefined)} className="h-10 shrink-0 px-2 text-[11px] text-fq-primary">{t("guide.reset")}</button>
              )}
            </div>
          );
        })}
      </div>
      <label className="block">
        <span className="fq-label">{t("guide.lead")} · {g.leadScale.toFixed(1)}×</span>
        <input type="range" min={0.6} max={2} step={0.1} value={g.leadScale} onChange={(e) => g.set({ leadScale: Number(e.target.value) })}
          className="h-11 w-full accent-[var(--fq-primary)]" />
        <span className="block text-[11px] text-fq-muted">{t("guide.leadHint")}</span>
      </label>
    </div>
  );
}

export function MapDisplaySettings() {
  const t = useT();
  const s = useMapSettings();
  return (
    <div className="space-y-4">
      <div>
        <span className="fq-label">{t("map.layers")}</span>
        <Toggle checked={s.routeDetails} onChange={(v) => s.set({ routeDetails: v })} label={t("map.routeDetails")} hint={t("map.routeDetailsHint")} />
        <Toggle checked={s.cycleLanes} onChange={(v) => s.set({ cycleLanes: v })} label={t("map.cycleLanes")} />
        <Toggle checked={s.oneway} onChange={(v) => s.set({ oneway: v })} label={t("map.oneway")} />
        <Toggle checked={s.pois} onChange={(v) => s.set({ pois: v })} label={t("map.pois")} hint={t("map.poisHint")} />
        <Toggle checked={s.houseNumbers} onChange={(v) => s.set({ houseNumbers: v })} label={t("map.houseNumbers")} />
        <Toggle checked={s.buildings3d} onChange={(v) => s.set({ buildings3d: v })} label={t("map.buildings3d")} />
        <Toggle checked={s.pulse} onChange={(v) => s.set({ pulse: v })} label={t("map.pulse")} />
      </div>
      <div>
        <span className="fq-label">{t("map.camera")}</span>
        <Segmented value={String(s.tilt)} onChange={(v) => s.set({ tilt: Number(v) })}
          options={[{ v: "0", label: "2D" }, { v: "35", label: "35°" }, { v: "55", label: "55°" }, { v: "70", label: "70°" }]} />
        <Toggle checked={s.headingUp} onChange={(v) => s.set({ headingUp: v })} label={t("map.headingUp")} hint={t("map.headingUpHint")} />
        <Toggle checked={s.autoZoom} onChange={(v) => s.set({ autoZoom: v })} label={t("map.autoZoom")} />
        {s.autoZoom && (
          <label className="block">
            <span className="fq-label">{t("map.zoomBias")} · {s.zoomBias > 0 ? "+" : ""}{s.zoomBias.toFixed(1)}</span>
            <input type="range" min={-1.5} max={1.5} step={0.25} value={s.zoomBias} onChange={(e) => s.set({ zoomBias: Number(e.target.value) })}
              className="h-11 w-full accent-[var(--fq-primary)]" />
          </label>
        )}
      </div>
      <div>
        <span className="fq-label">{t("map.hud")}</span>
        <Segmented value={s.etaMode} onChange={(v) => s.set({ etaMode: v })}
          options={[{ v: "arrival", label: t("map.eta.arrival") }, { v: "remaining", label: t("map.eta.remaining") }]} />
        <div className="h-2" />
        <Segmented value={s.bannerSize} onChange={(v) => s.set({ bannerSize: v })}
          options={[{ v: "normal", label: t("map.banner.normal") }, { v: "large", label: t("map.banner.large") }]} />
        <Toggle checked={s.showThen} onChange={(v) => s.set({ showThen: v })} label={t("map.showThen")} />
      </div>
    </div>
  );
}
