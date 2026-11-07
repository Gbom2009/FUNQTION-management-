import { useEffect, useMemo, useState } from "react";
import { useTrips } from "../../features/stats/tripLog";
import { useGigs } from "../../features/gigs/store";
import { seasonStats, seasonYears } from "../../features/stats/season";
import { loadTracks } from "../../features/stats/tracks";
import { renderStory } from "../../features/stats/story";
import { saveFile } from "../../features/handoff/files";
import { setHeatmap } from "../../map/heatmap";
import { HOME } from "../../config/services";
import { useApp } from "../../store/app";
import { useT } from "../../i18n";
import { formatDuration } from "../../nav/format";
import type { LonLat } from "../../nav/geo";

/** "Setlist" — trip log, season stats, heatmap of driven roads, story export. */
export function SetlistPanel() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const { trips, remove } = useTrips();
  const { gigs, venues } = useGigs();
  const years = seasonYears(trips, gigs);
  const [year, setYear] = useState(years[0]);
  const [withSim, setWithSim] = useState(false);
  const [tracks, setTracks] = useState<LonLat[][]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const list = useMemo(
    () => trips.filter((tr) => new Date(tr.startedAt).getFullYear() === year && (withSim || !tr.simulated)),
    [trips, year, withSim],
  );
  const stats = seasonStats(list, gigs, venues, year, HOME);

  useEffect(() => {
    let cancelled = false;
    void loadTracks(list.map((x) => x.id)).then((m) => {
      if (cancelled) return;
      const all = [...m.values()];
      setTracks(all);
      setHeatmap(all);
    });
    return () => { cancelled = true; };
  }, [list]);
  useEffect(() => () => setHeatmap(null), []);

  const exportStory = async () => {
    setBusy(true); setMsg(null);
    try {
      const png = await renderStory(stats, tracks, lang);
      const r = await saveFile(`funqtion-setlist-${year}.png`, png, "image/png");
      if (r === "failed") setMsg(t("share.failed"));
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };

  const cell = (v: string | number, l: string, hi = false) => (
    <div className="border-t border-fq-line pt-1">
      <div className={`font-display text-2xl ${hi ? "text-fq-primary" : "text-fq-strong"}`}>{v}</div>
      <div className="text-[10px] uppercase tracking-widest text-fq-muted">{l}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="fq-input w-auto">
          {years.map((y) => <option key={y} value={y}>{t("stats.season")} {y}</option>)}
        </select>
        <label className="ml-auto flex items-center gap-2 text-[11px] text-fq-muted">
          <input type="checkbox" checked={withSim} onChange={(e) => setWithSim(e.target.checked)} className="h-4 w-4 accent-[var(--fq-primary)]" />
          {t("stats.includeSim")}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cell(stats.km, "km", true)}
        {cell(stats.gigs, t("stats.gigs"))}
        {cell(stats.towKm, t("stats.towKm"))}
        {cell(stats.furthest ? `${stats.furthest.km} km` : "—", stats.furthest ? `${t("stats.furthest")} · ${stats.furthest.name}` : t("stats.furthest"))}
        {cell(stats.trips, t("stats.trips"))}
        {cell(`${stats.hours} u`, t("stats.hours"))}
      </div>
      <button disabled={busy} onClick={exportStory} className="fq-btn fq-btn-primary h-14 w-full">
        {busy ? "…" : t("stats.story")}
      </button>
      {msg && <div className="text-[11px] text-fq-danger">{msg}</div>}
      <p className="text-[11px] text-fq-muted">{t("stats.heatmapHint")}</p>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-widest text-fq-muted">{t("stats.log")}</div>
        {!list.length && <p className="text-[13px] text-fq-muted">{t("stats.empty")}</p>}
        <ul className="divide-y divide-fq-line">
          {list.map((tr) => {
            const gig = gigs.find((g) => g.id === tr.gigId);
            return (
              <li key={tr.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-fq-strong">{gig?.title ?? tr.destination ?? "—"}</div>
                  <div className="truncate text-[11px] text-fq-muted">
                    {new Date(tr.startedAt).toLocaleDateString(lang === "nl" ? "nl-NL" : "en-GB")} · {tr.km} km · {formatDuration((tr.endedAt - tr.startedAt) / 1000, lang)}
                    {tr.vehicle ? ` · ${tr.vehicle}` : ""}{tr.trailer ? ` · 🚚 ${tr.trailer}` : ""}{tr.simulated ? " · SIM" : ""}
                  </div>
                </div>
                <button onClick={() => remove(tr.id)} className="h-9 w-8 text-fq-muted hover:text-fq-danger" aria-label="remove">×</button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
