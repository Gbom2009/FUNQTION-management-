import { useEffect, useState } from "react";
import { Check, Download, Loader2, Play, Trash2 } from "lucide-react";
import { useT } from "../../i18n";
import { useApp } from "../../store/app";
import { PIPER_VOICES, useVoice, type PiperVoiceId } from "../../nav/tts/store";
import { downloadVoice, loadSession, removeVoice } from "../../nav/tts/piper";
import { systemVoices, voiceScore, voicesReady } from "../../nav/tts/system";
import { say } from "../../nav/tts";
import { Segmented } from "../../ui/controls";

const SAMPLE = {
  nl: "Over 500 meter, sla linksaf naar de Dorpsstraat. Daarna de rotonde op, tweede afslag.",
  en: "In 500 meters, turn left onto Dorpsstraat. Then take the second exit at the roundabout.",
};

export function VoiceSettings() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const v = useVoice();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [busy, setBusy] = useState<PiperVoiceId | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    void voicesReady().then(() => { if (alive) setVoices(systemVoices(lang)); });
    const on = () => setVoices(systemVoices(lang));
    if (typeof speechSynthesis !== "undefined") speechSynthesis.addEventListener("voiceschanged", on);
    return () => { alive = false; if (typeof speechSynthesis !== "undefined") speechSynthesis.removeEventListener("voiceschanged", on); };
  }, [lang]);

  const test = async () => {
    setPlaying(true);
    try { await say(SAMPLE[lang], lang); } finally { setPlaying(false); }
  };

  const get = async (id: PiperVoiceId, mb: number) => {
    setBusy(id);
    try { await downloadVoice(id, mb); v.set({ engine: "piper", piperVoice: id }); }
    catch { /* error shown from store */ }
    finally { setBusy(null); }
  };

  const best = voices[0];
  const isGood = (x: SpeechSynthesisVoice) => voiceScore(x, lang) >= 30;

  return (
    <div className="space-y-4">
      <div>
        <span className="fq-label">{t("voice.engine")}</span>
        <Segmented value={v.engine} onChange={(e) => v.set({ engine: e })}
          options={[{ v: "piper", label: t("voice.engine.piper") }, { v: "system", label: t("voice.engine.system") }]} />
        <p className="mt-2 text-[12px] leading-snug text-fq-muted">
          {v.engine === "piper" ? t("voice.piperHint") : t("voice.systemHint")}
        </p>
      </div>

      {v.engine === "piper" && (
        <div className="space-y-2">
          {lang !== "nl" && <p className="text-[12px] text-fq-warn">{t("voice.piperNlOnly")}</p>}
          {PIPER_VOICES.map((pv) => {
            const have = v.downloaded.includes(pv.id);
            const on = v.piperVoice === pv.id;
            const downloading = busy === pv.id && v.status === "downloading";
            return (
              <div key={pv.id} className={`fq-card flex items-center gap-3 p-3 ${on && have ? "border-fq-primary!" : ""}`}>
                <button disabled={!have} onClick={() => { v.set({ piperVoice: pv.id }); void loadSession(pv.id).catch(() => undefined); }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${on && have ? "border-fq-primary bg-fq-primary text-[#040404]" : "border-fq-line"}`}>
                    {on && have && <Check size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-fq-strong">{pv.label}</span>
                    <span className="block text-[12px] text-fq-muted">
                      {downloading ? `${Math.round(v.progress * 100)}% · ${t("voice.downloading")}` : have ? t("voice.onDevice") : `${pv.mb + 18} MB · ${t("voice.notDownloaded")}`}
                    </span>
                  </span>
                </button>
                {have ? (
                  <button onClick={() => void removeVoice(pv.id)} aria-label={t("voice.remove")} className="flex h-11 w-11 items-center justify-center rounded-full text-fq-muted hover:text-fq-danger">
                    <Trash2 size={18} />
                  </button>
                ) : (
                  <button disabled={!!busy} onClick={() => void get(pv.id, pv.mb)} className="fq-btn h-11 min-h-0 px-3 text-[13px]">
                    {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} {t("voice.download")}
                  </button>
                )}
              </div>
            );
          })}
          {v.status === "downloading" && (
            <div className="h-2 overflow-hidden rounded-full bg-fq-line"><div className="h-full bg-fq-primary transition-[width]" style={{ width: `${v.progress * 100}%` }} /></div>
          )}
          {v.status === "loading" && <p className="text-[12px] text-fq-muted"><Loader2 size={14} className="mr-1 inline animate-spin" />{t("voice.loading")}</p>}
          {v.status === "error" && <p className="text-[12px] text-fq-danger">{t("voice.error")}: {v.error} — {t("voice.fallback")}</p>}
          {!v.downloaded.length && <p className="text-[12px] text-fq-muted">{t("voice.untilDownloaded")}</p>}
          <p className="text-[11px] text-fq-muted">{t("voice.piperCredits")}</p>
        </div>
      )}

      <div>
        <span className="fq-label">{v.engine === "piper" ? t("voice.fallbackVoice") : t("voice.systemVoice")}</span>
        <select value={v.systemVoice} onChange={(e) => v.set({ systemVoice: e.target.value })} className="fq-input">
          <option value="">{t("voice.auto")}{best ? ` — ${best.name}` : ""}</option>
          {voices.map((x) => (
            <option key={x.voiceURI} value={x.voiceURI}>{isGood(x) ? "★ " : ""}{x.name} ({x.lang}){x.localService ? "" : " · online"}</option>
          ))}
        </select>
        {!voices.length && <p className="mt-1 text-[12px] text-fq-warn">{t("drive.noVoice")}</p>}
        {voices.length > 0 && !voices.some(isGood) && <p className="mt-1 text-[12px] leading-snug text-fq-muted">{t("voice.betterSystem")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="fq-label">{t("voice.rate")} · {v.rate.toFixed(2)}×</span>
          <input type="range" min={0.8} max={1.3} step={0.05} value={v.rate} onChange={(e) => v.set({ rate: Number(e.target.value) })}
            className="h-11 w-full accent-[var(--fq-primary)]" />
        </label>
        <label>
          <span className="fq-label">{t("voice.volume")} · {Math.round(v.volume * 100)}%</span>
          <input type="range" min={0.3} max={1} step={0.05} value={v.volume} onChange={(e) => v.set({ volume: Number(e.target.value) })}
            className="h-11 w-full accent-[var(--fq-primary)]" />
        </label>
      </div>

      <button onClick={test} disabled={playing} className="fq-btn w-full">
        {playing ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />} {t("voice.test")}
      </button>
    </div>
  );
}
