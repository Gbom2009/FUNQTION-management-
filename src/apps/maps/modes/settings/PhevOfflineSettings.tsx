import { useEffect, useRef, useState } from "react";
import { usePhev, type Connector } from "../../features/phev/store";
import { onChargerStatus, setUserOcmKey, userOcmKey, type ChargerStatus } from "../../map/phevLayers";
import { ocmKey } from "../../features/phev/chargers";
import { deletePack, importPack, storageEstimate, useOffline, type OfflineMode } from "../../features/offline/packs";
import { useT } from "../../i18n";
import { Toggle, Segmented } from "../../ui/controls";

const mb = (n: number) => `${(n / 1e6).toFixed(n > 1e8 ? 0 : 1)} MB`;

export function PhevSettings() {
  const t = useT();
  const p = usePhev();
  const [status, setStatus] = useState<ChargerStatus>({ state: "off" });
  const [key, setKey] = useState(userOcmKey());
  useEffect(() => onChargerStatus(setStatus), []);
  const hasKey = !!ocmKey(key);
  return (
    <div>
      <Toggle checked={p.zoneAlerts} onChange={(v) => p.set({ zoneAlerts: v })} label={t("phev.zoneAlerts")} />
      <Toggle checked={p.evHints} onChange={(v) => p.set({ evHints: v })} label={t("phev.evHints")} />
      <Toggle checked={p.showZones} onChange={(v) => p.set({ showZones: v })} label={t("phev.showZones")} hint={t("phev.zonesNote")} />
      <Toggle checked={p.chargers} onChange={(v) => p.set({ chargers: v })} label={t("phev.chargers")} />
      {p.chargers && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label><span className="fq-label">{t("phev.minKw")}</span>
              <select value={p.chargerMinKw} onChange={(e) => p.set({ chargerMinKw: Number(e.target.value) })}
                className="fq-input">
                {[0, 7, 11, 22, 50].map((k) => <option key={k} value={k}>{k ? `≥ ${k} kW` : t("phev.any")}</option>)}
              </select></label>
            <label><span className="fq-label">{t("phev.connector")}</span>
              <select value={p.chargerConnector} onChange={(e) => p.set({ chargerConnector: e.target.value as Connector })}
                className="fq-input">
                <option value="any">{t("phev.any")}</option><option value="type2">Type 2</option><option value="ccs">CCS</option>
              </select></label>
          </div>
          {!hasKey || status.state === "nokey" ? (
            <div className="space-y-1">
              <p className="text-[11px] text-fq-warn">{t("phev.needKey")}</p>
              <input value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => setUserOcmKey(key)} placeholder="Open Charge Map API key"
                className="fq-input" />
            </div>
          ) : (
            <p className="text-[11px] text-fq-muted">
              {status.state === "zoom" ? t("phev.zoomIn") : status.state === "loading" ? "…" : status.state === "ok" ? `${status.count} ${t("phev.found")}` : status.state === "error" ? `${t("phev.error")} (${status.message})` : ""}
              {" · "}Open Charge Map (CC BY-SA 4.0)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function OfflineSettings() {
  const t = useT();
  const o = useOffline();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [est, setEst] = useState<{ usage?: number; quota?: number }>({});
  useEffect(() => { void storageEstimate().then(setEst); }, [o.packs]);

  const doImport = async (f: File) => {
    setBusy(true); setMsg(null);
    try { const info = await importPack(f); setMsg(`${info.name} ${t("offline.imported")}`); }
    catch (e) { setMsg(`${t("offline.importError")}: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <span className="fq-label">{t("offline.use")}</span>
      <Segmented value={o.mode} onChange={(m: OfflineMode) => o.set({ mode: m })}
        options={(["auto", "always", "never"] as OfflineMode[]).map((m) => ({ v: m, label: t(`offline.mode.${m}`) }))} />
      <div className="h-3" />
      <ul className="space-y-2">
        {o.packs.map((pk) => (
          <li key={pk.name} className={`fq-card flex items-center gap-2 p-2 ${o.activePack === pk.name ? "border-fq-primary" : "border-fq-line"}`}>
            <button onClick={() => o.set({ activePack: pk.name })} className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm text-fq-strong">{pk.name}</div>
              <div className="text-[11px] text-fq-muted">{mb(pk.sizeBytes)} · z{pk.minZoom}–{pk.maxZoom}
                {pk.bounds ? ` · ${pk.bounds.map((b) => b.toFixed(2)).join(", ")}` : ""}</div>
            </button>
            <button onClick={() => void deletePack(pk.name)} className="h-9 w-8 text-fq-muted hover:text-fq-danger" aria-label="delete">×</button>
          </li>
        ))}
      </ul>
      <button disabled={busy} onClick={() => file.current?.click()} className="fq-btn mt-2 h-10 w-full text-[12px] disabled:opacity-50">
        {busy ? "…" : `+ ${t("offline.import")}`}
      </button>
      <input ref={file} type="file" accept=".pmtiles" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
      {msg && <p className="mt-1 text-[11px] text-fq-muted">{msg}</p>}
      <p className="mt-2 text-[11px] text-fq-muted">
        {t("offline.hint")}{est.quota ? ` · ${mb(est.usage ?? 0)} / ${mb(est.quota)}` : ""}
      </p>
      <p className="mt-1 text-[11px] text-fq-muted">{t("offline.routeCache")}</p>
    </div>
  );
}
