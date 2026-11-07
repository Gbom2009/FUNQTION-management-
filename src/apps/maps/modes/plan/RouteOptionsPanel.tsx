import { Check } from "lucide-react";
import { usePlan } from "../../store/plan";
import { Segmented } from "../../ui/controls";
import { useT } from "../../i18n";
import type { RouteOptions } from "../../nav/valhalla";
import { useVehicles } from "../../features/vehicles/store";
import { combinedDims } from "../../features/vehicles/profiles";

export function RouteOptionsPanel() {
  const t = useT();
  const { options, setOption } = usePlan();
  const { vehicles, trailers, activeVehicleId, activeTrailerId, setActiveVehicle, setActiveTrailer, towCaps } = useVehicles();
  const v = vehicles.find((x) => x.id === activeVehicleId);
  const tr = trailers.find((x) => x.id === activeTrailerId);
  const dims = v && tr ? combinedDims(v, tr) : null;
  const sel = "fq-input text-[15px]";
  const toggles: { k: keyof RouteOptions; label: string }[] = [
    { k: "avoidMotorways", label: t("plan.opt.avoidMotorways") },
    { k: "avoidTolls", label: t("plan.opt.avoidTolls") },
    { k: "avoidFerries", label: t("plan.opt.avoidFerries") },
  ];
  return (
    <div className="space-y-3">
      <span className="fq-label">{t("plan.options")}</span>
      <Segmented value={options.shortest ? "short" : "fast"} onChange={(v) => setOption("shortest", v === "short")}
        options={[{ v: "fast", label: t("plan.opt.fastest") }, { v: "short", label: t("plan.opt.shortest") }]} />
      <div className="flex flex-wrap gap-2">
        {toggles.map(({ k, label }) => (
          <button key={k} aria-pressed={options[k] as boolean} onClick={() => setOption(k, !options[k])} className="fq-chip">
            {options[k] && <Check size={16} />} {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select aria-label={t("vehicle.vehicle")} className={sel} value={activeVehicleId} onChange={(e) => setActiveVehicle(e.target.value)}>
          {vehicles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select aria-label={t("plan.opt.trailer")} className={`${sel} ${tr ? "border-fq-primary text-fq-primary" : ""}`} value={activeTrailerId ?? ""}
          onChange={(e) => setActiveTrailer(e.target.value || null)}>
          <option value="">{t("vehicle.noTrailer")}</option>
          {trailers.map((x) => <option key={x.id} value={x.id}>🚚 {x.name}</option>)}
        </select>
      </div>
      {dims && (
        <div className="text-[11px] leading-snug text-fq-muted">
          {t("tow.routing")}: {dims.lengthM} × {dims.widthM} × {dims.heightM} m · {dims.weightT} t · max {towCaps.motorway} km/h
          {dims.estimated.length > 0 && <span className="text-fq-warn"> · {t("tow.estimated")}</span>}
        </div>
      )}
    </div>
  );
}
