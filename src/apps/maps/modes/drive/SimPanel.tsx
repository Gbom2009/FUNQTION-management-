import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Segmented } from "../../ui/controls";
import { useDrive } from "../../store/drive";
import { usePlan } from "../../store/plan";
import { useT } from "../../i18n";
import { parseGpx } from "../../features/handoff/gpx";
import { simPathFromTrack } from "../../location/simulator";
import * as session from "./session";

const SPEEDS = [0.5, 1, 2, 4, 8];

/** Dev panel: fake GPS controls. Shown in Drive mode when the simulator is the location source. */
export function SimPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { simMultiplier, simNoiseM, simPaused, simSpeedMode, simFixedKmh, simBrake, set } = useDrive();
  const speedSet = (p: Partial<{ simSpeedMode: "planned" | "limit" | "fixed"; simFixedKmh: number; simBrake: boolean }>) => {
    set(p);
    session.applySimSpeeds();
  };
  const active = usePlan((s) => s.active);
  const [gpxMsg, setGpxMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const loadGpx = async (f: File) => {
    try {
      const track = parseGpx(await f.text());
      session.simLoadPath(simPathFromTrack(track.points, track.times));
      set({ simPaused: false });
      setGpxMsg(`${track.name ?? f.name} · ${track.points.length} pts`);
    } catch (e) {
      setGpxMsg(`${t("sim.gpxError")}: ${(e as Error).message}`);
    }
  };

  return (
    <section className="fq-floating pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+13rem)] right-3 z-40 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border-fq-warn! p-4 text-[13px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="uppercase tracking-widest text-fq-warn">{t("sim.title")}</span>
        <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-fq-muted" aria-label="close"><X size={18} /></button>
      </div>
      <div className="flex gap-1">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={simMultiplier === s}
            onClick={() => { set({ simMultiplier: s }); session.simSet({ multiplier: s }); }}
            className={`h-11 flex-1 rounded-xl border ${simMultiplier === s ? "border-fq-warn text-fq-warn" : "border-fq-line text-fq-text"}`}>
            {s}×
          </button>
        ))}
      </div>
      <div className="mt-3">
        <span className="fq-label">{t("sim.speed")}</span>
        <Segmented value={simSpeedMode} onChange={(v) => speedSet({ simSpeedMode: v })}
          options={[{ v: "limit", label: t("sim.speed.limit") }, { v: "planned", label: t("sim.speed.planned") }, { v: "fixed", label: t("sim.speed.fixed") }]} />
        {simSpeedMode === "fixed" && (
          <label className="mt-2 block text-fq-muted">
            {simFixedKmh} km/h
            <input type="range" min={10} max={160} step={5} value={simFixedKmh}
              onChange={(e) => speedSet({ simFixedKmh: Number(e.target.value) })} className="mt-1 w-full accent-[var(--fq-warn)]" />
          </label>
        )}
        <button aria-pressed={simBrake} onClick={() => speedSet({ simBrake: !simBrake })} className="fq-chip mt-2">
          {simBrake ? "✓ " : ""}{t("sim.brake")}
        </button>
      </div>
      <label className="mt-3 block text-fq-muted">
        {t("sim.noise")}: {simNoiseM} m
        <input type="range" min={0} max={30} value={simNoiseM}
          onChange={(e) => { const v = Number(e.target.value); set({ simNoiseM: v }); session.simSet({ noiseM: v }); }}
          className="mt-1 w-full accent-[var(--fq-warn)]" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => { session.simSet({ paused: !simPaused }); set({ simPaused: !simPaused }); }}
          className="fq-btn">{simPaused ? t("sim.play") : t("sim.pause")}</button>
        <button disabled={!active} onClick={session.simGoOffRoute}
          className="fq-btn border-fq-danger! text-fq-danger!">{t("sim.offRoute")}</button>
        <button onClick={() => file.current?.click()} className="fq-btn col-span-2">
          {t("sim.loadGpx")}
        </button>
      </div>
      <input ref={file} type="file" accept=".gpx,application/gpx+xml" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadGpx(f); e.target.value = ""; }} />
      {gpxMsg && <div className="mt-2 break-words text-[11px] text-fq-muted">{gpxMsg}</div>}
    </section>
  );
}
