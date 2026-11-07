import { describe, expect, it } from "vitest";
import { voiceScore } from "./system";
import { plannedPrompts, promptText, thresholds } from "../voice";
import type { FlatManeuver } from "../guidance";

const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });

describe("system voice ranking", () => {
  it("prefers neural/enhanced Dutch voices over the robotic defaults", () => {
    const list = [
      v("Microsoft Frank - Dutch (Netherlands)", "nl-NL"),
      v("Microsoft Fenna Online (Natural) - Dutch (Netherlands)", "nl-NL", false),
      v("Xander (Enhanced)", "nl-NL"),
      v("Ellen", "nl-BE"),
      v("Samantha", "en-US"),
    ];
    const ranked = [...list].sort((a, b) => voiceScore(b, "nl") - voiceScore(a, "nl")).map((x) => x.name);
    expect(ranked[0]).toBe("Xander (Enhanced)");
    expect(ranked[1]).toContain("Natural");
    expect(ranked.indexOf("Microsoft Frank - Dutch (Netherlands)")).toBeLessThan(ranked.indexOf("Ellen"));
    expect(voiceScore(v("Samantha", "en-US"), "nl")).toBe(-1);
  });
});

describe("pre-rendered prompts", () => {
  const m = { type: 10, verbalAlert: "Rechts afslaan naar de Kerkstraat.", verbalPre: "Sla rechtsaf naar de Kerkstraat.", instruction: "x" } as FlatManeuver;
  it("match what is spoken when the threshold is crossed", () => {
    const planned = plannedPrompts(m, false, "nl", false);
    const th = thresholds(false);
    expect(planned).toEqual([
      promptText(m, "far", th.far, "nl", false),
      promptText(m, "mid", th.mid, "nl", false),
      promptText(m, "now", th.now, "nl", false),
    ]);
    expect(planned[1]).toBe("Over 200 meter, rechts afslaan naar de Kerkstraat.");
  });
});
