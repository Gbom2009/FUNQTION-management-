import { useRef, useState } from "react";
import { db } from "../../../../core/db";
import type { Gig as SuiteGig, Venue as SuiteVenue } from "../../../../core/types";
import { useT } from "../../i18n";
import {
  applyFqImport, FQ_EXPORT_SNIPPET, parseFqExport, suggestGig, suggestVenue,
  type FqExport, type ImportResult,
} from "../../features/shared/importFq";

/** Settings → "Importeer FQ-maps-gegevens": paste or load the old app's data, confirm matches, import. */
export function ImportFqSettings() {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [data, setData] = useState<FqExport | null>(null);
  const [suite, setSuite] = useState<{ venues: SuiteVenue[]; gigs: SuiteGig[] }>({ venues: [], gigs: [] });
  const [venues, setVenues] = useState<Record<string, string>>({});
  const [gigs, setGigs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);

  const read = async (s: string) => {
    setErr(null); setDone(null);
    try {
      const d = parseFqExport(s);
      const sv = (await db.venues.toArray()).filter((v) => !v.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
      const sg = (await db.gigs.toArray()).filter((g) => !g.deletedAt).sort((a, b) => a.date.localeCompare(b.date));
      const vm = Object.fromEntries(d.venues.map((v) => [v.id, suggestVenue(v, sv)]));
      setSuite({ venues: sv, gigs: sg });
      setVenues(vm);
      setGigs(Object.fromEntries(d.gigs.map((g) => [g.id, suggestGig(g, sg, vm)])));
      setData(d);
    } catch {
      setData(null);
      setErr(t("import.invalid"));
    }
  };

  const run = async () => {
    if (!data) return;
    setBusy(true);
    try { setDone(await applyFqImport({ data, venues, gigs })); setData(null); setText(""); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-fq-muted">{t("import.intro")}</p>
      <code className="block select-all break-all rounded-lg bg-fq-bg p-2 text-[11px] text-fq-text">{FQ_EXPORT_SNIPPET}</code>
      {!data && (
        <>
          <textarea rows={4} className="fq-input" placeholder={t("import.paste")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <button className="fq-btn flex-1" disabled={!text.trim()} onClick={() => void read(text)}>{t("import.check")}</button>
            <button className="fq-btn flex-1" onClick={() => file.current?.click()}>{t("import.file")}</button>
          </div>
          <input ref={file} type="file" accept=".json,application/json,text/plain" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(await f.text()); }} />
        </>
      )}
      {err && <div className="text-fq-danger">{err}</div>}

      {data && (
        <div className="space-y-3">
          <div className="text-fq-strong">
            {data.venues.length} {t("import.venues")} · {data.gigs.length} {t("import.gigs")} · {data.trips.length} {t("import.trips")} · {data.vehicles.length + data.trailers.length} {t("import.vehicles")}
          </div>
          {data.venues.length > 0 && <span className="fq-label">{t("import.venueMatch")}</span>}
          {data.venues.map((v) => (
            <label key={v.id} className="grid grid-cols-2 items-center gap-2">
              <span className="truncate text-fq-strong">{v.name}</span>
              <select className="fq-input" value={venues[v.id] ?? ""} onChange={(e) => setVenues({ ...venues, [v.id]: e.target.value })}>
                <option value="">{t("import.newVenue")}</option>
                <option value="skip">{t("import.skip")}</option>
                {suite.venues.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
              </select>
            </label>
          ))}
          {data.gigs.length > 0 && <span className="fq-label">{t("import.gigMatch")}</span>}
          {data.gigs.map((g) => (
            <label key={g.id} className="grid grid-cols-2 items-center gap-2">
              <span className="truncate text-fq-strong">{g.date} · {g.title}</span>
              <select className="fq-input" value={gigs[g.id] ?? ""} onChange={(e) => setGigs({ ...gigs, [g.id]: e.target.value })}>
                <option value="">{t("import.skip")}</option>
                {suite.gigs.filter((s) => s.date === g.date || s.id === gigs[g.id]).concat(suite.gigs.filter((s) => s.date !== g.date && s.id !== gigs[g.id]))
                  .map((s) => <option key={s.id} value={s.id}>{s.date} · {s.title}</option>)}
              </select>
            </label>
          ))}
          <p className="text-[11px] text-fq-muted">{t("import.note")}</p>
          <div className="flex gap-2">
            <button className="fq-btn fq-btn-primary flex-1" disabled={busy} onClick={() => void run()}>{busy ? "…" : t("import.run")}</button>
            <button className="fq-btn" onClick={() => setData(null)}>{t("import.cancel")}</button>
          </div>
        </div>
      )}

      {done && (
        <div className="text-fq-strong">
          {t("import.done")} {done.venuesNew + done.venuesUpdated} {t("import.venues")}, {done.gigs} {t("import.gigs")}, {done.trips} {t("import.trips")}
          {done.tripsSkipped ? ` (${done.tripsSkipped} ${t("import.dupes")})` : ""}, {done.vehicles} {t("import.vehicles")}.
        </div>
      )}
    </div>
  );
}
