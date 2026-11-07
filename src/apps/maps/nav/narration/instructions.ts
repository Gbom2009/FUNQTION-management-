import type { FlatManeuver } from "../guidance";
import { DESTINATION_TYPES } from "../guidance";
import { promptText, type Stage } from "../voice";
import type { TurnContext } from "./events";
import type { Topic } from "./settings";
import type { Lang } from "../../i18n";

/**
 * Richer turn instructions. Starts from Valhalla's Dutch sentence (good
 * grammar) and adds what a co-driver would say: "bij de verkeerslichten",
 * exit number + direction, roundabout size, "en daarna direct rechtsaf",
 * cycle lane / bike path / one-way on the road you turn into.
 */
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const uc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Valhalla’s Dutch is correct but stiff ("links afslaan en X ingaan").
 * Rewrite the common patterns the way a Dutch co-driver says it.
 */
export function polishNl(text: string): string {
  let t = text;
  // "links afslaan en Kerkstraat ingaan" → "linksaf, de Kerkstraat in"
  t = t.replace(/\b(scherp |flauw )?(links|rechts) afslaan en (.+?) ingaan\b/gi, (_m, adv: string | undefined, dir: string, street: string) =>
    `${adv ?? ""}${dir.toLowerCase()}af, de ${street} in`);
  // "links afslaan naar Kanaaldijk" → "linksaf naar de Kanaaldijk" (streets only: names with a street suffix)
  t = t.replace(/\b([Ss]cherp |[Ff]lauw )?([Ll]inks|[Rr]echts) afslaan naar ([A-Z][\w\u00C0-\u017F-]*(?:straat|weg|laan|dijk|plein|singel|kade|gracht|baan|dreef|steeg|pad|hof|ring))\b/g,
    (_m, adv: string | undefined, dir: string, street: string) => `${adv ?? ""}${dir.toLowerCase()}af naar de ${street}`);
  // remaining "links afslaan" → "linksaf"
  t = t.replace(/\b(links|rechts) afslaan\b/gi, (_m, dir: string) => `${dir.toLowerCase()}af`);
  // sentence starts uppercase again
  return t.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()).replace(/^./, (c) => uc(c));
}
const TURNS = new Set([9, 10, 11, 14, 15, 16, 12, 13]);

export function richInstruction(
  m: FlatManeuver, stage: Stage, distM: number, lang: Lang, finalStop: boolean,
  ctx: TurnContext | undefined, next: FlatManeuver | undefined, on: (t: Topic) => boolean,
): string {
  let base = promptText(m, stage, distM, lang, finalStop);
  if (!on("turnDetail") || !ctx || DESTINATION_TYPES.has(m.type)) return lang === "nl" ? polishNl(base) : base;
  const nl = lang === "nl";
  const extra: string[] = [];

  // "Bij de verkeerslichten, sla linksaf…" — only for real turns, only when it's close
  if (ctx.signal && TURNS.has(m.type) && stage !== "far") {
    const lights = nl ? "bij de verkeerslichten" : "at the traffic lights";
    if (stage === "now") {
      base = `${nl ? "Bij de verkeerslichten" : "At the traffic lights"}, ${lc(base)}`;
    } else {
      // "Over 200 meter, rechts afslaan…" → "Over 200 meter, bij de verkeerslichten, rechts afslaan…"
      const i = base.indexOf(", ");
      base = i > 0 ? `${base.slice(0, i)}, ${lights}${base.slice(i)}` : `${base} (${lights})`;
    }
  }
  // motorway exits: number + direction, if Valhalla's sentence doesn't already say it
  if (m.sign && (m.type === 20 || m.type === 21 || m.type === 18 || m.type === 19 || m.type === 23 || m.type === 24)) {
    if (m.sign.exitNumber && !base.includes(m.sign.exitNumber)) extra.push(nl ? `Afrit ${m.sign.exitNumber}.` : `Exit ${m.sign.exitNumber}.`);
    if (m.sign.toward && !base.toLowerCase().includes(m.sign.toward.toLowerCase().split(" / ")[0])) extra.push(nl ? `Richting ${m.sign.toward}.` : `Toward ${m.sign.toward}.`);
  }
  if (m.type === 26 && on("roundabout")) {
    if (ctx.roundaboutArms && stage !== "now") extra.push(nl ? `De rotonde heeft ${ctx.roundaboutArms} afslagen.` : `The roundabout has ${ctx.roundaboutArms} exits.`);
    if (ctx.crossesBikePath) extra.push(nl ? "Let op fietsers rond de rotonde." : "Watch for cyclists around the roundabout.");
  }
  if (stage !== "far") {
    if (on("cycle") && TURNS.has(m.type)) {
      if (ctx.crossesBikePath) extra.push(nl ? "Je kruist een fietspad, let op fietsers." : "You cross a cycle path, watch for cyclists.");
      else if (ctx.cycleOnNext) extra.push(nl ? `${ctx.nextStreet ? `De ${ctx.nextStreet}` : "Die weg"} heeft een fietsstrook.` : "That road has a cycle lane.");
    }
    if (on("oneway") && ctx.onewayNext) extra.push(nl ? "Dat is een eenrichtingsweg." : "That's a one-way street.");
    // only say it when YOU must give way — having priority needs no comment at every turn
    if ((on("priority") || on("stopSign")) && ctx.priority === "give" && stage === "now") extra.push(nl ? "Verleen voorrang." : "Give way.");
  }
  // chain a maneuver that follows right after
  if (next && stage !== "far" && next.along - m.along < 150 && !DESTINATION_TYPES.has(next.type)) {
    const s = next.verbalSuccinct ?? next.verbalPre;
    if (s) extra.push(nl ? `En daarna direct ${lc(s)}` : `Then immediately ${lc(s)}`);
  }
  const out = [base, ...extra].join(" ");
  return nl ? polishNl(out) : out;
}
