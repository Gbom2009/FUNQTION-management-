import { usePlan } from "../../store/plan";
import { useVehicles, currentTow } from "../vehicles/store";
import { bitsToOptions, makePayload, type HandoffPayload, type HandoffTrailer } from "./routeCode";

/** Current plan → handoff payload (stops, options, car + trailer). */
export function currentPayload(): HandoffPayload {
  const p = usePlan.getState();
  const tow = currentTow();
  const v = useVehicles.getState();
  const vehicle = v.vehicles.find((x) => x.id === v.activeVehicleId)?.name;
  const trailer: HandoffTrailer | undefined = tow
    ? { name: tow.trailer.name, l: tow.trailer.lengthM, w: tow.trailer.widthM, h: tow.trailer.heightM, kg: tow.trailer.weightKg }
    : undefined;
  return makePayload(p.stops, p.options, vehicle, trailer);
}

/** Load a received plan: same stops, options and trailer profile → identical route. */
export function applyPayload(pl: HandoffPayload) {
  const v = useVehicles.getState();
  if (pl.vehicle) {
    const match = v.vehicles.find((x) => x.name === pl.vehicle);
    if (match) v.setActiveVehicle(match.id);
  }
  if (pl.trailer) {
    let t = v.trailers.find((x) => x.name === pl.trailer!.name);
    if (!t) {
      v.addTrailer();
      t = useVehicles.getState().trailers.at(-1)!;
    }
    // take the sender's dimensions so routing is identical
    v.updateTrailer(t.id, { name: pl.trailer.name, lengthM: pl.trailer.l, widthM: pl.trailer.w, heightM: pl.trailer.h, weightKg: pl.trailer.kg });
    v.setActiveTrailer(t.id);
  } else {
    v.setActiveTrailer(null);
  }
  usePlan.getState().clearStops();
  usePlan.setState({
    options: bitsToOptions(pl.o),
    stops: pl.stops.map((s, i) => ({ id: `h-${i}`, key: `h${i}-${Date.now().toString(36)}`, name: s.n || `Stop ${i + 1}`, lat: s.lat, lon: s.lon, source: "pin" as const })),
  });
  void usePlan.getState().compute();
}
