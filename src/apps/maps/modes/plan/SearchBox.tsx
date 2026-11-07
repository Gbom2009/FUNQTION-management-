import { useEffect, useRef, useState } from "react";
import { search, searchPhoton, type Place } from "../../nav/geocode";
import { usePlan } from "../../store/plan";
import { origin } from "../../features/gigs/gigRoute";
import { useApp } from "../../store/app";
import { useT } from "../../i18n";
import { Loader2, MapPin, Search, X } from "lucide-react";

const DEBOUNCE_MS = 400;

/** Address/venue search. Adds a stop by default; pass onPick to use it elsewhere (venue address). */
/**
 * `variant="bar"`: the floating pill at the top of the map (phone + panel).
 * `leading`/`trailing`: extra controls inside the pill (logo, settings).
 */
export function SearchBox({ onPick, placeholder, variant = "inline", leading, trailing, onFocusChange }: {
  onPick?: (p: Place) => void; placeholder?: string; variant?: "inline" | "bar";
  leading?: React.ReactNode; trailing?: React.ReactNode; onFocusChange?: (focused: boolean) => void;
} = {}) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const addStop = usePlan((s) => s.addStop);
  // Phone pattern: the first search is the destination; start from here (or home).
  const choose = onPick ?? ((p: Place) => {
    if (!usePlan.getState().stops.length) addStop(origin());
    addStop(p);
  });
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [source, setSource] = useState<"pdok" | "photon" | "none">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrl.current?.abort();
    if (q.trim().length < 3) { setResults([]); setSource("none"); setError(null); return; }
    const c = new AbortController();
    ctrl.current = c;
    const id = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await search(q, lang, c.signal);
        if (c.signal.aborted) return;
        setResults(r.places); setSource(r.source); setError(r.places.length ? null : r.error ?? null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!c.signal.aborted) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(id); c.abort(); };
  }, [q, lang]);

  const morePhoton = async () => {
    setBusy(true);
    try {
      const extra = await searchPhoton(q, lang);
      setResults((cur) => [...cur, ...extra.filter((e) => !cur.some((c) => c.id === e.id))]);
      setSource("photon");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const pick = (p: Place) => { choose(p); setQ(""); setResults([]); setOpen(false); };

  const showList = open && (results.length > 0 || !!error || (q.trim().length >= 3 && !busy));
  const bar = variant === "bar";

  return (
    <div className="relative">
      <div className={`fq-searchbar flex items-center gap-1 ${bar ? "fq-floating h-14 rounded-full pl-1.5 pr-1.5" : "fq-input px-0 pl-3"}`}>
        {leading ?? <Search size={20} className={`shrink-0 text-fq-muted ${bar ? "ml-2.5" : ""}`} />}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); onFocusChange?.(true); }}
          onBlur={() => { setOpen(false); onFocusChange?.(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) pick(results[0]); if (e.key === "Escape") setOpen(false); }}
          placeholder={placeholder ?? t("plan.search")}
          aria-label={t("plan.search")}
          enterKeyHint="search"
          className="h-full min-w-0 flex-1 select-text bg-transparent px-2 text-[16px] text-fq-strong outline-none placeholder:text-fq-muted"
        />
        {busy && <Loader2 size={18} className="shrink-0 animate-spin text-fq-primary" />}
        {q && !busy && (
          <button onClick={() => { setQ(""); setResults([]); }} aria-label="clear" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fq-muted">
            <X size={18} />
          </button>
        )}
        {trailing}
      </div>
      {showList && (
        <ul className="fq-floating absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-[min(60vh,420px)] overflow-auto rounded-2xl py-1">
          {results.map((p) => (
            <li key={p.id}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-fq-surface focus-visible:bg-fq-surface">
                <MapPin size={18} className="shrink-0 text-fq-primary" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-fq-strong">{p.name}</span>
                  {p.detail && <span className="block truncate text-[12px] text-fq-muted">{p.detail}</span>}
                </span>
              </button>
            </li>
          ))}
          {!busy && results.length === 0 && !error && (
            <li className="px-4 py-3 text-[14px] text-fq-muted">{t("plan.noResults")}</li>
          )}
          {error && <li className="px-4 py-3 text-[13px] text-fq-danger">{t("plan.searchError")} ({error})</li>}
          {source === "pdok" && (
            <li>
              <button onMouseDown={(e) => e.preventDefault()} onClick={morePhoton} className="block w-full px-4 py-3 text-left text-[13px] text-fq-primary hover:bg-fq-surface">
                {t("plan.morePhoton")}
              </button>
            </li>
          )}
          <li className="px-4 pb-2 pt-1 text-[10px] text-fq-muted">
            {source === "photon" ? "Photon · © OpenStreetMap" : source === "pdok" ? "PDOK Locatieserver" : ""}
          </li>
        </ul>
      )}
    </div>
  );
}
