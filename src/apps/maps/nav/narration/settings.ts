import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../../store/storage";

/**
 * How much the voice tells you. Four levels; every topic can also be switched
 * on/off on its own (an override beats the level).
 */
export type Level = "kort" | "normaal" | "uitgebreid" | "max";
export const LEVELS: Level[] = ["kort", "normaal", "uitgebreid", "max"];

export type Topic =
  | "turnDetail"     // traffic lights, exit numbers, "richting", "en daarna direct…" in turn instructions
  | "camera"         // speed cameras (NL/BE only)
  | "zone"           // milieuzone entry + whether your car may enter
  | "zoneDetail"     // full explanation of the zone's rules
  | "speedLimit"     // limit changes
  | "rail"           // level crossings
  | "toll"
  | "roundabout"     // number of arms, cyclists around the roundabout
  | "zebra"          // zebra crossings
  | "cycle"          // cycle lanes / crossing a cycle path when turning
  | "oneway"
  | "priority"       // junctions without traffic lights
  | "stopSign"       // stop / give way
  | "tunnel"         // tunnels and bridges
  | "lights"         // junctions with traffic lights you pass straight through
  | "crossing"       // other pedestrian crossings
  | "bump"           // speed bumps / traffic calming
  | "surface"        // unpaved road
  | "lanes"          // number of lanes changes
  | "height";        // height/weight limits vs your vehicle — always on

export const TOPIC_LEVEL: Record<Topic, Level> = {
  height: "kort",
  turnDetail: "normaal", camera: "normaal", zone: "normaal", speedLimit: "normaal", rail: "normaal", toll: "normaal", roundabout: "normaal",
  zebra: "uitgebreid", cycle: "uitgebreid", oneway: "uitgebreid", priority: "uitgebreid", stopSign: "uitgebreid", tunnel: "uitgebreid",
  zoneDetail: "max", lights: "max", crossing: "max", bump: "max", surface: "max", lanes: "max",
};
export const TOPICS = Object.keys(TOPIC_LEVEL) as Topic[];

interface GuidanceState {
  level: Level;
  overrides: Partial<Record<Topic, boolean>>;
  /** multiply announcement distances (0.7 = later, 1.5 = earlier) */
  leadScale: number;
  set: (p: Partial<Pick<GuidanceState, "level" | "leadScale">>) => void;
  setTopic: (t: Topic, on: boolean | undefined) => void;
}

export const useGuidance = create<GuidanceState>()(
  persist(
    (set, get) => ({
      level: "normaal",
      overrides: {},
      leadScale: 1,
      set: (p) => set(p),
      setTopic: (t, on) => {
        const o = { ...get().overrides };
        if (on === undefined) delete o[t]; else o[t] = on;
        set({ overrides: o });
      },
    }),
    { name: "fq-guidance", storage: lazyStorage },
  ),
);

/** Is a topic on, given level + overrides? Height warnings can't be turned off. */
export function topicOn(t: Topic, level: Level, overrides: Partial<Record<Topic, boolean>>): boolean {
  if (t === "height") return true;
  if (overrides[t] !== undefined) return overrides[t]!;
  return LEVELS.indexOf(level) >= LEVELS.indexOf(TOPIC_LEVEL[t]);
}

export function enabledTopics(): (t: Topic) => boolean {
  const g = useGuidance.getState();
  return (t) => topicOn(t, g.level, g.overrides);
}
