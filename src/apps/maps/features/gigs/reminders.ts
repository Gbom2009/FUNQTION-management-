import { useGigs, type Gig } from "./store";
import { leaveBy } from "./leaveBy";
import { translate } from "../../i18n";
import { useApp } from "../../store/app";
import { formatClock } from "../../nav/format";

/**
 * Leave-by reminders: 15 minutes before and at leave-by time.
 * Uses the Web Notification API while the app is running, with an in-app
 * banner as fallback. Reliable background notifications on iOS need the
 * Tauri notification plugin (Phase 6) — noted in README.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
const MAX_DELAY = 2 ** 31 - 1; // setTimeout limit (~24.8 days)
let banner: ((text: string) => void) | null = null;

export function setReminderBanner(fn: (text: string) => void) { banner = fn; }

function notify(text: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Funqtion Maps", { body: text, icon: "/favicon.svg" });
    }
  } catch { /* not available in this webview */ }
  banner?.(text);
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

function schedule(g: Gig) {
  timers.get(g.id)?.forEach(clearTimeout);
  timers.delete(g.id);
  if (!g.route) return;
  const leave = leaveBy({ ...g, routeS: g.route.seconds });
  if (!leave) return;
  const lang = useApp.getState().lang;
  const now = Date.now();
  const list: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, text: string) => {
    const delay = ms - now;
    if (delay > 0 && delay < MAX_DELAY) list.push(setTimeout(() => notify(text), delay));
  };
  const clock = formatClock(leave);
  at(leave.getTime() - 15 * 60_000, translate(lang, "gig.notify.soon").replace("{gig}", g.title).replace("{time}", clock));
  at(leave.getTime(), translate(lang, "gig.notify.now").replace("{gig}", g.title));
  timers.set(g.id, list);
}

/** Keep timers in sync with the gig list. Call once at startup. */
export function startReminders() {
  const sync = () => {
    const gigs = useGigs.getState().gigs;
    for (const id of [...timers.keys()]) if (!gigs.some((g) => g.id === id)) { timers.get(id)?.forEach(clearTimeout); timers.delete(id); }
    gigs.forEach(schedule);
  };
  sync();
  useGigs.subscribe((s, prev) => { if (s.gigs !== prev.gigs) sync(); });
}
