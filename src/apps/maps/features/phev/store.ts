import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../../store/storage";

export type Connector = "any" | "type2" | "ccs";

interface PhevState {
  /** voice/HUD alert before entering a milieuzone */
  zoneAlerts: boolean;
  /** "switch to EV mode" hints before zones / urban stretches */
  evHints: boolean;
  /** draw milieuzone areas on the map */
  showZones: boolean;
  /** Open Charge Map layer */
  chargers: boolean;
  chargerMinKw: number;
  chargerConnector: Connector;
  set: (p: Partial<Omit<PhevState, "set">>) => void;
}

export const usePhev = create<PhevState>()(
  persist(
    (set) => ({
      zoneAlerts: true,
      evHints: true,
      showZones: true,
      chargers: false,
      chargerMinKw: 11,
      chargerConnector: "any",
      set: (p) => set(p),
    }),
    { name: "fq-phev", storage: lazyStorage },
  ),
);
