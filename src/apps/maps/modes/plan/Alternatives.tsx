import { Play } from "lucide-react";
import { usePlan } from "../../store/plan";
import { useApp } from "../../store/app";
import { useT } from "../../i18n";
import { formatClock, formatDistance, formatDuration } from "../../nav/format";

/** Route alternatives as tappable cards. `showStart` adds the Start button (side panel). */
export function Alternatives({ showStart = true }: { showStart?: boolean }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const { routes, selected, select, loading, error, stops, startDrive } = usePlan();

  if (stops.length < 2) return null;
  if (error) return <p className="text-[13px] text-fq-danger">{t("plan.routeError")} ({error})</p>;
  if (loading && !routes.length) return <p className="text-[13px] text-fq-muted">{t("plan.routing")}</p>;
  if (!routes.length) return null;

  const fastest = Math.min(...routes.map((r) => r.timeS));
  return (
    <div className={`space-y-2 ${loading ? "opacity-60" : ""}`}>
      {routes.length > 1 && <div className="fq-label">{t("plan.alternatives")}</div>}
      {routes.map((r, i) => {
        const tags = [r.hasHighway && t("plan.tag.highway"), r.hasToll && t("plan.tag.toll"), r.hasFerry && t("plan.tag.ferry")].filter(Boolean);
        const extra = r.timeS - fastest;
        const on = selected === i;
        return (
          <button key={r.id} onClick={() => select(i)} aria-pressed={on}
            className={`fq-card block w-full px-4 py-3 text-left transition-colors ${on ? "border-fq-primary!" : "hover:border-fq-muted"}`}>
            <div className="flex items-baseline gap-3">
              <span className={`font-display text-2xl ${on ? "text-fq-primary" : "text-fq-strong"}`}>{formatDuration(r.timeS, lang)}</span>
              <span className="text-sm text-fq-text">{formatDistance(r.lengthM, lang)}</span>
              <span className="ml-auto text-[12px] text-fq-muted">{t("plan.arrive")} {formatClock(new Date(Date.now() + r.timeS * 1000))}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-fq-muted">
              {extra > 60 ? `+${formatDuration(extra, lang)} · ` : ""}{tags.join(" · ")}
            </div>
          </button>
        );
      })}
      {showStart && (
        <button onClick={() => startDrive()} className="fq-btn fq-btn-primary mt-2 h-14 w-full text-base">
          <Play size={20} fill="currentColor" /> {t("plan.startDrive")}
        </button>
      )}
    </div>
  );
}
