import { getRoutes } from "../../nav/valhalla";
import { HOME } from "../../config/services";
import { useDrive } from "../../store/drive";
import { usePlan, towRouting, vehicleRouting } from "../../store/plan";
import { useApp } from "../../store/app";
import { currentTow } from "../vehicles/store";
import { translate } from "../../i18n";
import { useGigs, venueTarget, type Gig, type Venue } from "./store";
import type { Place } from "../../nav/geocode";

/** Start point for a gig: current GPS fix if we have one, else home base. */
export function origin(): Place {
  const f = useDrive.getState().fix;
  const lang = useApp.getState().lang;
  if (f) return { id: "here", name: translate(lang, "drive.here"), lat: f.lat, lon: f.lon, source: "pin" };
  return { id: "home", name: translate(lang, "gig.home"), lat: HOME[1], lon: HOME[0], source: "pin" };
}

function venuePlace(v: Venue): Place | null {
  const t = venueTarget(v);
  if (!t) return null;
  const lang = useApp.getState().lang;
  return {
    id: `venue-${v.id}`,
    name: v.loadInDoor ? `${v.name} — ${translate(lang, "venue.loadInDoor")}` : v.name,
    detail: v.address?.detail ?? v.address?.name,
    lat: t.lat, lon: t.lon, source: "pin",
  };
}

/** Compute and store the drive time for a gig with the current vehicle/trailer. */
export async function computeGigRoute(gig: Gig): Promise<void> {
  const v = useGigs.getState().venues.find((x) => x.id === gig.venueId);
  const to = v && venuePlace(v);
  if (!to) throw new Error("venue has no address");
  const from = origin();
  const tow = currentTow();
  const [r] = await getRoutes({
    stops: [from, to], options: usePlan.getState().options, language: useApp.getState().lang, tow: towRouting(tow), vehicle: vehicleRouting(),
  });
  if (!r) throw new Error("no route");
  useGigs.getState().updateGig(gig.id, {
    route: { seconds: r.timeS, meters: r.lengthM, fromName: from.name, towing: !!tow, computedAt: Date.now() },
  });
}

/** Put origin → venue into the planner (Route tab). */
export function planGig(gig: Gig): boolean {
  const v = useGigs.getState().venues.find((x) => x.id === gig.venueId);
  const to = v && venuePlace(v);
  if (!to) return false;
  const plan = usePlan.getState();
  plan.clearStops();
  usePlan.setState({ stops: [{ ...origin(), key: "o" }, { ...to, key: "d" }], planningGigId: gig.id });
  void usePlan.getState().compute();
  return true;
}
