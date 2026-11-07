import { useState } from "react";
import { AlertTriangle, Car, Check, ChevronDown, Info, Plus, Trash2, Truck } from "lucide-react";
import { useVehicles } from "../../features/vehicles/store";
import { NL_TOW_DEFAULTS, combinedDims, type Licence, type Trailer, type Vehicle } from "../../features/vehicles/profiles";
import { TRAILER_GROUPS, VEHICLE_GROUPS, type Field, type Group } from "../../features/vehicles/schema";
import { towChecks } from "../../features/vehicles/apply";
import { useApp } from "../../store/app";
import { useT } from "../../i18n";
import { Segmented } from "../../ui/controls";

/** One input rendered from the schema. Empty number = undefined (not filled in). */
function FieldInput<T>({ f, value, onChange, lang }: { f: Field<T>; value: unknown; onChange: (v: unknown) => void; lang: "nl" | "en" }) {
  const label = f.label[lang];
  const hint = f.use?.[lang];
  const wrap = (input: React.ReactNode) => (
    <label className={f.wide ? "col-span-2" : ""}>
      <span className="mb-1 block text-[12px] text-fq-muted">{label}{f.unit ? ` (${f.unit})` : ""}</span>
      {input}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-fq-muted/80">→ {hint}</span>}
    </label>
  );
  if (f.type === "bool") {
    return (
      <button type="button" aria-pressed={!!value} onClick={() => onChange(!value)} className={`fq-chip justify-center ${f.wide ? "col-span-2" : ""}`}>
        {value ? <Check size={16} /> : null} {label}
      </button>
    );
  }
  if (f.type === "select") {
    return wrap(
      <select className="fq-input" value={value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(undefined);
          const opt = f.options!.find((o) => String(o.v) === raw);
          onChange(opt ? opt.v : raw);
        }}>
        <option value="">—</option>
        {f.options!.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.label[lang]}</option>)}
      </select>,
    );
  }
  if (f.type === "color") return wrap(<input type="color" className="fq-input h-12 p-1" value={(value as string) ?? "#f68712"} onChange={(e) => onChange(e.target.value)} />);
  if (f.type === "textarea") return wrap(<textarea className="fq-input" rows={3} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />);
  if (f.type === "number") {
    return wrap(
      <input type="number" inputMode="decimal" className="fq-input" step={f.step} min={f.min} max={f.max} value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />,
    );
  }
  return wrap(<input className="fq-input" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />);
}

function Editor<T extends { id: string }>({ item, groups, onChange }: { item: T; groups: Group<T>[]; onChange: (p: Partial<T>) => void }) {
  const lang = useApp((s) => s.lang);
  const [open, setOpen] = useState<string>(groups[0].id);
  const rec = item as unknown as Record<string, unknown>;
  const filled = (g: Group<T>) => g.fields.filter((f) => rec[f.key] !== undefined && rec[f.key] !== "").length;
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.id} className="rounded-xl border border-fq-line">
          <button type="button" onClick={() => setOpen(open === g.id ? "" : g.id)} className="flex min-h-12 w-full items-center gap-2 px-3 text-left">
            <span className="flex-1 text-[14px] text-fq-strong">{g.title[lang]}</span>
            <span className="text-[11px] text-fq-muted">{filled(g)}/{g.fields.length}</span>
            <ChevronDown size={18} className={`text-fq-muted transition-transform ${open === g.id ? "rotate-180" : ""}`} />
          </button>
          {open === g.id && (
            <div className="grid grid-cols-2 gap-3 px-3 pb-3">
              {g.fields.map((f) => (
                <FieldInput key={f.key} f={f} lang={lang} value={rec[f.key]} onChange={(v) => onChange({ [f.key]: v } as Partial<T>)} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Checks({ v, t }: { v: Vehicle; t: Trailer }) {
  const tr = useT();
  const licence = useVehicles((s) => s.licence);
  const checks = towChecks(v, t, licence);
  if (!checks.length) return <p className="flex items-center gap-2 text-[12px] text-[#3ddc84]"><Check size={16} /> {tr("check.ok")}</p>;
  return (
    <ul className="space-y-1.5">
      {checks.map((c, i) => {
        let text: string = tr(c.key as never);
        for (const [k, val] of Object.entries(c.params ?? {})) text = text.replace(`{${k}}`, String(val));
        return (
          <li key={i} className={`flex gap-2 text-[12px] leading-snug ${c.level === "error" ? "text-fq-danger" : c.level === "warn" ? "text-fq-warn" : "text-fq-muted"}`}>
            {c.level === "info" ? <Info size={15} className="mt-px shrink-0" /> : <AlertTriangle size={15} className="mt-px shrink-0" />} {text}
          </li>
        );
      })}
      <li className="text-[11px] text-fq-muted">{tr("check.disclaimer")}</li>
    </ul>
  );
}

export function VehiclesSettings() {
  const t = useT();
  const s = useVehicles();
  const [openV, setOpenV] = useState<string | null>(null);
  const [openT, setOpenT] = useState<string | null>(null);
  const activeV = s.vehicles.find((v) => v.id === s.activeVehicleId);

  return (
    <div className="space-y-5">
      <div>
        <div className="fq-label">{t("vehicle.vehicles")}</div>
        <div className="space-y-2">
          {s.vehicles.map((v) => {
            const on = v.id === s.activeVehicleId;
            return (
              <div key={v.id} className={`rounded-2xl border p-3 ${on ? "border-fq-primary" : "border-fq-line"}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: v.color ?? "var(--fq-bg)" }}>
                    <Car size={20} className={v.color ? "text-[#040404]" : "text-fq-primary"} />
                  </span>
                  <button onClick={() => setOpenV(openV === v.id ? null : v.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] text-fq-strong">{v.name}</span>
                    <span className="block truncate text-[12px] text-fq-muted">
                      {[v.fuel, v.euroClass !== undefined ? `Euro ${v.euroClass}` : null, v.heightM ? `${v.heightM} m` : null].filter(Boolean).join(" · ") || t("vehicle.tapToFill")}
                    </span>
                  </button>
                  <button aria-pressed={on} onClick={() => s.setActiveVehicle(v.id)} className="fq-btn h-10 min-h-0 px-3 text-[12px]">
                    {on ? t("vehicle.active") : t("vehicle.use")}
                  </button>
                </div>
                {openV === v.id && (
                  <div className="mt-3 space-y-3">
                    <Editor item={v} groups={VEHICLE_GROUPS} onChange={(p) => s.updateVehicle(v.id, p)} />
                    {s.vehicles.length > 1 && (
                      <button onClick={() => s.removeVehicle(v.id)} className="fq-chip text-fq-muted!"><Trash2 size={16} /> {t("vehicle.remove")}</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={s.addVehicle} className="fq-btn w-full"><Plus size={18} /> {t("vehicle.add")}</button>
        </div>
      </div>

      <div>
        <div className="fq-label">{t("vehicle.trailers")}</div>
        <div className="space-y-2">
          {s.trailers.map((tr) => {
            const on = tr.id === s.activeTrailerId;
            const dims = activeV ? combinedDims(activeV, tr) : null;
            return (
              <div key={tr.id} className={`rounded-2xl border p-3 ${on ? "border-fq-primary" : "border-fq-line"}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fq-bg"><Truck size={20} className="text-fq-primary" /></span>
                  <button onClick={() => setOpenT(openT === tr.id ? null : tr.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] text-fq-strong">{tr.name}</span>
                    <span className="block truncate text-[12px] text-fq-muted">
                      {[tr.type, tr.weightKg ? `${tr.weightKg} kg` : null, tr.heightM ? `${tr.heightM} m` : null].filter(Boolean).join(" · ") || t("vehicle.tapToFill")}
                    </span>
                  </button>
                  <button aria-pressed={on} onClick={() => s.setActiveTrailer(on ? null : tr.id)} className="fq-btn h-10 min-h-0 px-3 text-[12px]">
                    {on ? t("vehicle.attached") : t("vehicle.attach")}
                  </button>
                </div>
                {openT === tr.id && (
                  <div className="mt-3 space-y-3">
                    <Editor item={tr} groups={TRAILER_GROUPS} onChange={(p) => s.updateTrailer(tr.id, p)} />
                    {activeV && (
                      <div className="rounded-xl bg-fq-bg p-3">
                        <div className="mb-1.5 text-[12px] text-fq-strong">{activeV.name} + {tr.name}</div>
                        {dims && <p className="mb-2 text-[12px] text-fq-muted">{t("tow.routing")}: {dims.lengthM} × {dims.widthM} × {dims.heightM} m · {dims.weightT} t</p>}
                        <Checks v={activeV} t={tr} />
                      </div>
                    )}
                    <button onClick={() => s.removeTrailer(tr.id)} className="fq-chip text-fq-muted!"><Trash2 size={16} /> {t("vehicle.remove")}</button>
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={s.addTrailer} className="fq-btn w-full"><Plus size={18} /> {t("vehicle.addTrailer")}</button>
        </div>
      </div>

      <div>
        <div className="fq-label">{t("vehicle.licence")}</div>
        <Segmented value={s.licence} onChange={(l: Licence) => s.setLicence(l)}
          options={[{ v: "B", label: "B" }, { v: "B96", label: "B + 96" }, { v: "BE", label: "BE" }]} />
      </div>

      <div>
        <div className="fq-label">{t("tow.caps")}</div>
        <div className="grid grid-cols-3 gap-2">
          {(["motorway", "rural", "urban"] as const).map((k) => (
            <label key={k}>
              <span className="mb-1 block text-[12px] text-fq-muted">{t(`tow.${k}`)}</span>
              <input type="number" inputMode="numeric" step={5} className="fq-input" value={s.towCaps[k]}
                onChange={(e) => s.setTowCaps({ [k]: e.target.value === "" ? NL_TOW_DEFAULTS[k] : Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-fq-warn">⚠ {t("tow.verify")}</p>
      </div>
    </div>
  );
}
