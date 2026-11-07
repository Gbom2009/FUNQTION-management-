import { useEffect, useState } from "react";
import { AlertTriangle, Battery, Euro, Leaf, Ruler, Truck } from "lucide-react";
import { usePlan } from "../../store/plan";
import { useVehicles } from "../../features/vehicles/store";
import { combinedDims } from "../../features/vehicles/profiles";
import { effectiveHeight, rangeFor, towChecks, tripCost } from "../../features/vehicles/apply";
import { loadZones, zoneEntries } from "../../features/phev/zones";
import { rulesForZone, zoneVerdict, type Access } from "../../features/phev/zoneRules";
import { buildGeometry } from "../../nav/guidance";
import { useT } from "../../i18n";

/** What the car/trailer data means for this route — so the specs are visibly used. */
export function RouteInsights() {
  const t = useT();
  const route = usePlan((s) => s.routes[s.selected]);
  const { vehicles, trailers, activeVehicleId, activeTrailerId, licence } = useVehicles();
  const v = vehicles.find((x) => x.id === activeVehicleId);
  const tr = trailers.find((x) => x.id === activeTrailerId);
  const [zones, setZones] = useState<{ name: string; access: Access; reason: string }[]>([]);

  useEffect(() => {
    let alive = true;
    if (!route || !v) { setZones([]); return; }
    void loadZones().then((all) => {
      if (!alive) return;
      const seen = new Set<string>();
      const list = zoneEntries(buildGeometry(route), all)
        .filter((e) => { if (seen.has(e.zone.name)) return false; seen.add(e.zone.name); return true; })
        .map((e) => ({ name: e.zone.name, ...zoneVerdict(rulesForZone(e.zone.name), v) }));
      setZones(list);
    });
    return () => { alive = false; };
  }, [route, v]);

  if (!route || !v) return null;
  const km = route.lengthM / 1000;
  const towing = !!tr;
  const cost = tripCost(v, km, towing);
  const range = rangeFor(v, km, towing);
  const checks = tr ? towChecks(v, tr, licence).filter((c) => c.level !== "info") : [];
  const height = tr ? combinedDims(v, tr).heightM : effectiveHeight(v);

  let n = 0;
  const row = (icon: React.ReactNode, main: React.ReactNode, sub?: React.ReactNode, tone = "") => (
    <div key={n++} className={`flex items-start gap-3 py-2 ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0"><span className="block text-[14px]">{main}</span>{sub && <span className="block text-[12px] text-fq-muted">{sub}</span>}</span>
    </div>
  );

  return (
    <div className="fq-card divide-y divide-fq-line px-3 py-1">
      <div className="py-2 text-[11px] uppercase tracking-widest text-fq-muted">{t("ins.title")} {v.name}{tr ? ` + ${tr.name}` : ""}</div>
      {cost
        ? row(<Euro size={18} className="text-fq-primary" />, `≈ € ${cost.euro.toFixed(2).replace(".", ",")}`,
          [cost.fuelL ? `${cost.fuelL} l` : null, cost.kwh ? `${cost.kwh} kWh` : null, cost.electricKm ? `${cost.electricKm} km ${t("ins.electric")}` : null, towing ? t("ins.towFactor") : null].filter(Boolean).join(" · "))
        : row(<Euro size={18} className="text-fq-muted" />, <span className="text-fq-muted">{t("ins.noCost")}</span>)}
      {range.enough !== undefined
        ? row(<Battery size={18} className={range.enough ? "text-[#3ddc84]" : "text-fq-danger"} />,
          range.enough ? t("ins.rangeOk") : t("ins.rangeLow"),
          `${t("ins.range")} ≈ ${range.totalKm} km${range.evKm ? ` (${range.evKm} km ${t("ins.electric")})` : ""} · ${t("ins.route")} ${Math.round(km)} km`,
          range.enough ? "" : "text-fq-danger")
        : null}
      {zones.map((z) => row(
        <Leaf size={18} className={z.access === "banned" ? "text-fq-danger" : "text-[#3ddc84]"} />,
        `${z.name}: ${z.access === "allowed" ? t("ins.zoneOk") : z.access === "banned" ? t("ins.zoneBanned") : z.access === "notApplicable" ? t("ins.zoneNa") : t("ins.zoneUnknown")}`,
        z.reason, z.access === "banned" ? "text-fq-danger" : "",
      ))}
      {checks.map((c) => row(<AlertTriangle size={18} className={c.level === "error" ? "text-fq-danger" : "text-fq-warn"} />,
        (() => { let s: string = t(c.key as never); for (const [k, val] of Object.entries(c.params ?? {})) s = s.replace(`{${k}}`, String(val)); return s; })(),
        undefined, c.level === "error" ? "text-fq-danger" : "text-fq-warn"))}
      {height
        ? row(towing ? <Truck size={18} className="text-fq-muted" /> : <Ruler size={18} className="text-fq-muted" />, `${t("ins.routedHeight")} ${height} m`, t("ins.heightHint"))
        : row(<Ruler size={18} className="text-fq-muted" />, <span className="text-fq-muted">{t("ins.noHeight")}</span>)}
    </div>
  );
}
