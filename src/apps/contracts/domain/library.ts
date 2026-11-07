import type { Clause, ClauseCategory, ContractTemplate, EventType, Rider, TemplateClause } from '../../../core/types';

// The default contract library: clauses (NL/EN, with business variants where
// the law treats consumers differently), one template per event type and two
// riders. DRAFT texts – see docs/contracts/PLAN.md §3–4. Everything here can be
// edited in the app (Contracts → Library); edits bump the clause version.
//
// Placeholders: {{gigDate}} {{venue}} {{services}} {{sets}} {{setupTime}} {{total}}
// {{vatNote}} {{depositAmount}} {{depositPct}} {{balance}} {{paymentTermDays}}
// {{overtimeRate}} {{cancellationTable}} {{termsVersion}} {{funqtionNames}}
// {{noiseLimit}} {{curfew}} {{performersCount}} and {{ref.<key>}} (article number).

type C = Omit<Clause, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'version' | 'active' | 'sort'>;

const c = (key: string, category: ClauseCategory, titleNl: string, titleEn: string, bodyNl: string, bodyEn: string, extra: Partial<C> = {}): C =>
  ({ key, category, titleNl, titleEn, bodyNl, bodyEn, ...extra });

export const DEFAULT_CLAUSES: C[] = [
  // ---- core
  c('K1', 'core', 'Documenten en rangorde', 'Documents and order of precedence',
    'Deze overeenkomst bestaat uit: (1) dit document met de bijzondere afspraken, (2) de rider (bijlage 1) en (3) de algemene voorwaarden van Team Funqtion, versie {{termsVersion}} (bijlage 2). Je hebt de algemene voorwaarden vóór ondertekening ontvangen en kunnen opslaan. Bij tegenstrijdigheid gaat het eerder genoemde document voor. Inkoop- of andere voorwaarden van de opdrachtgever gelden niet.',
    'This agreement consists of: (1) this document with the special terms, (2) the rider (annex 1) and (3) Team Funqtion\'s general terms and conditions, version {{termsVersion}} (annex 2). You received the general terms before signing and were able to save them. In case of conflict, the document listed first prevails. The client\'s purchasing or other terms do not apply.',
    { locked: true, note: 'Maakt de algemene voorwaarden van toepassing (art. 6:232–6:234 BW) en wijst voorwaarden van de klant af (art. 6:225 lid 3 BW).' }),
  c('K2', 'core', 'Partijen', 'Parties',
    'Team Funqtion bestaat uit {{funqtionNames}}, handelend onder de naam Team Funqtion. Ieder van hen mag deze overeenkomst namens beiden ondertekenen.',
    'Team Funqtion consists of {{funqtionNames}}, trading as Team Funqtion. Either of them may sign this agreement on behalf of both.',
    { locked: true }),
  c('K3', 'core', 'Geen bedenktijd', 'No cooling-off period',
    'Deze overeenkomst gaat over een optreden op een vaste datum. Er geldt daarom geen wettelijke bedenktijd van 14 dagen (art. 6:230p sub e BW). Annuleren kan wel, volgens artikel {{ref.A1}}.',
    'This agreement is for a performance on a fixed date, so the statutory 14-day cooling-off period does not apply (art. 6:230p(e) Dutch Civil Code). You can still cancel, as set out in article {{ref.A1}}.',
    { only: 'consumer', locked: true }),
  c('K4', 'core', 'Wat we doen', 'What we do',
    'Team Funqtion verzorgt op {{gigDate}} bij {{venue}}:\n{{services}}\nSpeeltijden:\n{{sets}}\nOpbouw vanaf {{setupTime}}. De muzikale invulling op het moment zelf bepaalt de DJ, met zoveel mogelijk aandacht voor jullie wensen.',
    'On {{gigDate}} at {{venue}}, Team Funqtion provides:\n{{services}}\nSet times:\n{{sets}}\nSet-up from {{setupTime}}. The DJ decides the music on the night, taking your wishes into account as much as possible.',
    { locked: true }),
  // ---- money
  c('P1', 'money', 'Prijs', 'Price',
    'De totale prijs is {{total}}. {{vatNote}} Reiskosten en de hierboven genoemde onderdelen zijn inbegrepen, tenzij anders vermeld.',
    'The total price is {{total}}. {{vatNote}} Travel costs and the items listed above are included unless stated otherwise.',
    { locked: true }),
  c('P2', 'money', 'Aanbetaling en restant', 'Deposit and balance',
    'Na ondertekening ontvang je een factuur voor de aanbetaling van {{depositAmount}} ({{depositPct}}%), te betalen binnen {{paymentTermDays}} dagen en in elk geval vóór de dag van het optreden. De datum staat pas definitief vast als de aanbetaling binnen is. Het restant van {{balance}} factureren we na het optreden, te betalen binnen {{paymentTermDays}} dagen.',
    'After signing you will receive an invoice for the deposit of {{depositAmount}} ({{depositPct}}%), payable within {{paymentTermDays}} days and in any case before the day of the performance. The date is only final once the deposit has been received. We invoice the balance of {{balance}} after the performance, payable within {{paymentTermDays}} days.',
    { locked: true }),
  c('P3', 'money', 'Verlenging', 'Overtime',
    'Wil je dat we langer spelen, dan kan dat alleen als wij beschikbaar zijn en de vergunning en de locatie het toelaten. Verlenging kost {{overtimeRate}} per begonnen half uur en komt op de eindfactuur. Een verzoek van de opdrachtgever of de contactpersoon van de dag op de avond zelf geldt als akkoord.',
    'If you would like us to play longer, that is only possible if we are available and the permit and venue allow it. Overtime costs {{overtimeRate}} per started half hour and is added to the final invoice. A request on the night from the client or the day contact counts as agreement.'),
  // ---- cancellation
  c('A1', 'cancellation', 'Annulering door jou', 'Cancellation by you',
    'Annuleren doe je schriftelijk (e-mail of WhatsApp is genoeg). Je betaalt dan een vergoeding over de totale prijs:\n{{cancellationTable}}\nWat je al hebt betaald, trekken we hiervan af; betaalde je meer, dan krijg je het verschil terug. Verplaatsen naar een andere datum binnen 12 maanden is geen annulering, als wij op die datum kunnen.',
    'Cancel in writing (e-mail or WhatsApp is fine). You then pay a fee on the total price:\n{{cancellationTable}}\nAnything you have already paid is deducted; if you paid more, you get the difference back. Moving to another date within 12 months is not a cancellation, as long as we are available on that date.',
    { locked: true, note: 'Consumenten mogen altijd opzeggen (art. 7:408 BW). De vergoeding moet je werkelijke schade redelijk benaderen; de rechter kan matigen. Daarom een zachtere staffel voor consumenten.' }),
  c('A2', 'cancellation', 'Annulering door ons', 'Cancellation by us',
    'Kunnen wij niet spelen, bijvoorbeeld door ziekte, dan zoeken we eerst in overleg met jou een goede vervanger. Lukt dat niet, dan krijg je alles terug wat je hebt betaald.',
    'If we cannot play, for example due to illness, we first look for a good replacement in consultation with you. If that does not work out, you get back everything you have paid.',
    { locked: true }),
  c('A3', 'cancellation', 'Overmacht', 'Force majeure',
    'Overmacht is iets waar geen van beide partijen iets aan kan doen, zoals extreem weer met een officiële waarschuwing (code oranje of rood), een verbod of maatregel van de overheid of een ernstig ongeval. Gaat het optreden daardoor niet door, dan zoeken we eerst samen een nieuwe datum. Lukt dat niet binnen 12 maanden, dan betaal je maximaal 50% van de prijs, verrekend met de aanbetaling.',
    'Force majeure is something neither party can do anything about, such as extreme weather with an official warning (code orange or red), a ban or measure by the authorities, or a serious accident. If the performance cannot go ahead because of it, we first look for a new date together. If that is not possible within 12 months, you pay at most 50% of the price, offset against the deposit.',
    { locked: true }),
  c('A4', 'cancellation', 'Weer bij buitenoptreden', 'Weather at outdoor events',
    'Bij regen of wind spelen we zolang het veilig is voor mensen en apparatuur. Daarover beslissen we samen met de contactpersoon van de dag. Stoppen we om veiligheidsredenen terwijl we al waren opgebouwd, dan blijft de volledige prijs verschuldigd.',
    'In rain or wind we play as long as it is safe for people and equipment. We decide this together with the day contact. If we stop for safety reasons after we had already set up, the full price remains due.'),
  // ---- liability
  c('L1', 'liability', 'Onze aansprakelijkheid', 'Our liability',
    'Zijn wij aansprakelijk voor schade, dan is dat beperkt tot de prijs van dit optreden, of tot het bedrag dat onze verzekering uitkeert als dat hoger is. Deze beperking geldt niet bij opzet of grove nalatigheid van ons, en niet bij letselschade.',
    'If we are liable for damage, our liability is limited to the price of this performance, or to the amount our insurance pays out if that is higher. This limit does not apply in case of intent or gross negligence on our part, or to personal injury.',
    { locked: true,
      bodyBizNl: 'Onze aansprakelijkheid is beperkt tot de prijs van dit optreden, of tot het bedrag dat onze verzekering uitkeert als dat hoger is. We zijn niet aansprakelijk voor indirecte schade, zoals gederfde omzet. Dit geldt niet bij opzet of bewuste roekeloosheid.',
      bodyBizEn: 'Our liability is limited to the price of this performance, or to the amount our insurance pays out if that is higher. We are not liable for indirect damage such as lost revenue. This does not apply in case of intent or wilful recklessness.',
      note: 'Aansprakelijkheidsbeperking staat voor consumenten op de grijze lijst (art. 6:237 sub f BW): nooit bij opzet/grove schuld, niet bij letsel. Sluit een AVB af.' }),
  c('L2', 'liability', 'Schade aan onze apparatuur', 'Damage to our equipment',
    'Jij bent aansprakelijk voor schade aan onze apparatuur die gasten of andere derden tijdens het feest door schuld of onvoorzichtigheid veroorzaken, zoals drank over de apparatuur of klimmen op speakers. Normale slijtage valt hier niet onder. We melden schade zo snel mogelijk, uiterlijk binnen 7 dagen, met foto\'s.',
    'You are liable for damage to our equipment that guests or other third parties cause through their fault or carelessness during the event, such as drinks spilled on the gear or climbing on speakers. Normal wear and tear is not included. We report damage as soon as possible, at the latest within 7 days, with photos.'),
  // ---- venue
  c('G1', 'venue', 'Speelplek en bereikbaarheid', 'Playing area and access',
    'Je zorgt voor een vlakke, droge en veilige speelplek zoals beschreven in de rider, en voor een plek om dichtbij te laden, te lossen en te parkeren. Geef uiterlijk 14 dagen vooraf het tijdschema en de contactpersoon van de dag door.',
    'You provide a level, dry and safe playing area as described in the rider, and a place close by to load, unload and park. Please send the schedule and the day contact at least 14 days in advance.'),
  c('G2', 'venue', 'Geluid en eindtijd', 'Sound level and end time',
    'Op de locatie geldt {{noiseLimit}} en {{curfew}}. Wij houden ons daaraan en aan het landelijke convenant tegen gehoorschade in de muzieksector. We mogen het volume verlagen of stoppen als de locatie, de vergunning of de veiligheid dat vraagt; dat geldt niet als tekortkoming van ons.',
    'At the venue, {{noiseLimit}} and {{curfew}} apply. We stick to these and to the Dutch covenant on preventing hearing damage in the music sector. We may lower the volume or stop if the venue, the permit or safety requires it; this does not count as a failure on our part.'),
  c('G3', 'venue', 'Veilige stroom', 'Safe power supply',
    'Je zorgt voor de stroomaansluitingen uit de rider, binnen 10 meter van de speelplek, op een eigen groep en goed geaard. Bij een aggregaat: voldoende vermogen, geaard en met brandstof voor de hele avond. Is de stroom niet veilig, dan sluiten we niet aan. Valt de stroom van de locatie uit, dan zijn wij daar niet verantwoordelijk voor en blijft de prijs verschuldigd.',
    'You provide the power connections listed in the rider, within 10 metres of the playing area, on a dedicated circuit and properly earthed. With a generator: enough capacity, earthed and with fuel for the whole night. If the power is not safe, we will not connect. If the venue\'s power fails, we are not responsible and the price remains due.'),
  c('G4', 'venue', 'Overkapping', 'Cover',
    'Bij een buitenoptreden zorg jij voor een stevige, verankerde overkapping die de DJ en de apparatuur beschermt tegen regen, wind en felle zon, met een droge ondergrond.',
    'For an outdoor performance, you provide a sturdy, anchored cover that protects the DJ and the equipment from rain, wind and strong sun, with a dry floor.'),
  c('G5', 'venue', 'Vergunningen en muziekrechten', 'Permits and music rights',
    'Jij regelt de benodigde vergunningen (zoals een evenementenvergunning of geluidsontheffing) en, voor zover nodig, de muziekrechten bij Buma/Stemra en Sena. Kosten of boetes doordat die ontbreken zijn voor jouw rekening.',
    'You arrange the necessary permits (such as an event permit or noise exemption) and, insofar as required, the music rights with Buma/Stemra and Sena. Costs or fines resulting from their absence are for your account.'),
  c('G6', 'venue', 'Op- en afbouw', 'Set-up and breakdown',
    'Wij hebben vanaf {{setupTime}} ongestoord toegang tot de speelplek voor opbouw en soundcheck, en na afloop voldoende tijd voor afbouw. Kunnen we later beginnen door de locatie, dan schuiven de speeltijden niet automatisch op.',
    'We have undisturbed access to the playing area from {{setupTime}} for set-up and soundcheck, and enough time afterwards to break down. If the venue delays our start, the set times do not automatically move.'),
  c('G7', 'venue', 'Veiligheid', 'Safety',
    'We mogen het optreden onderbreken of stoppen bij agressie, gevaar voor mensen of apparatuur, of als de speelplek niet veilig is. Komt dat door de gasten of de locatie, dan blijft de prijs verschuldigd.',
    'We may interrupt or stop the performance in case of aggression, danger to people or equipment, or an unsafe playing area. If this is caused by the guests or the venue, the price remains due.'),
  // ---- rights
  c('R1', 'rights', 'Foto en video voor promotie', 'Photos and video for our promotion',
    'We maken tijdens het optreden soms foto\'s en video\'s voor onze promotie, bijvoorbeeld op Instagram (@funqtionofficial). Herkenbare gasten gebruiken we alleen met toestemming, kinderen nooit herkenbaar zonder toestemming van een ouder. Liever niet? Geef dat bij het ondertekenen aan; dan filmen we alleen onszelf. Trek je later je toestemming in, dan verwijderen we het beeld.',
    'We sometimes take photos and videos during the performance for our promotion, for example on Instagram (@funqtionofficial). We only use recognisable guests with their consent, and never children recognisably without a parent\'s consent. Rather not? Say so when signing and we will only film ourselves. If you withdraw consent later, we will remove the footage.',
    { note: 'Standaard aan, klant kan bij ondertekenen weigeren (opt-out). Portretrecht (art. 21 Auteurswet) en AVG.' }),
  c('R2', 'rights', 'Jouw opnames van ons', 'Your recordings of us',
    'Jij en je gasten mogen ons filmen en fotograferen voor privégebruik. Voor zakelijk of commercieel gebruik van opnames van ons optreden of onze naam (bijvoorbeeld in een bedrijfsvideo of advertentie) vraag je eerst onze toestemming.',
    'You and your guests may film and photograph us for private use. For business or commercial use of recordings of our performance or our name (e.g. in a company video or ad), please ask our permission first.'),
  c('R3', 'rights', 'Vermelding in promotie', 'Billing in promotion',
    'De opdrachtgever vermeldt Team Funqtion in de promotie van het evenement als "Team Funqtion" en tagt @funqtionofficial op social media. Wij mogen het evenement noemen in onze eigen promotie.',
    'The client lists Team Funqtion in event promotion as "Team Funqtion" and tags @funqtionofficial on social media. We may mention the event in our own promotion.'),
  // ---- other
  c('H1', 'other', 'Catering', 'Hospitality',
    'Bij optredens langer dan vier uur zorg je voor drinken en, waar redelijk, een maaltijd voor {{performersCount}} DJ(\'s). Zie de rider.',
    'For performances longer than four hours, you provide drinks and, where reasonable, a meal for {{performersCount}} DJ(s). See the rider.'),
  c('H2', 'other', 'Exclusiviteit', 'Exclusivity',
    'Tijdens onze speeltijden treden er op het evenement geen andere DJ\'s op, tenzij dat vooraf is afgesproken.',
    'No other DJs perform at the event during our set times unless agreed in advance.'),
  c('H3', 'other', 'Muziekwensen', 'Music wishes',
    'Muziekwensen en een "niet draaien"-lijst ontvangen we graag uiterlijk zes weken voor het optreden. Speciale momenten (openingsdans, binnenkomst) spreken we vooraf door.',
    'We would like to receive music wishes and a "do not play" list at least six weeks before the performance. We discuss special moments (first dance, entrance) in advance.'),
];

const tc = (key: string, mode: TemplateClause['mode'], when?: TemplateClause['when']): TemplateClause => ({ key, mode, when });
const CORE = ['K1', 'K2', 'K3', 'K4', 'P1', 'P2'].map((k) => tc(k, 'required'));
const CANCEL = ['A1', 'A2', 'A3'].map((k) => tc(k, 'required'));

type T = Omit<ContractTemplate, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'riderId'> & { rider: 'default' | 'club' };
const tpl = (name: string, nameEn: string, eventTypes: EventType[], clientKind: T['clientKind'], flow: T['flow'], rider: T['rider'], rest: TemplateClause[]): T =>
  ({ name, nameEn, eventTypes, clientKind, flow, rider, clauses: [...CORE, ...CANCEL, tc('L1', 'required'), ...rest], active: true });

export const DEFAULT_TEMPLATES: T[] = [
  tpl('Bruiloft', 'Wedding', ['wedding'], 'consumer', 'together', 'default', [
    tc('P3', 'on'), tc('A4', 'auto', 'outdoor'), tc('L2', 'on'), tc('G1', 'on'), tc('G2', 'on'), tc('G3', 'on'), tc('G4', 'auto', 'outdoor'),
    tc('G5', 'off'), tc('G6', 'auto', 'setup'), tc('G7', 'off'), tc('R1', 'on'), tc('R2', 'on'), tc('H1', 'on'), tc('H2', 'off'), tc('H3', 'on')]),
  tpl('Privéfeest', 'Private party', ['private_party', 'other'], 'consumer', 'together', 'default', [
    tc('P3', 'on'), tc('A4', 'auto', 'outdoor'), tc('L2', 'on'), tc('G1', 'on'), tc('G2', 'on'), tc('G3', 'on'), tc('G4', 'auto', 'outdoor'),
    tc('G5', 'off'), tc('G6', 'auto', 'setup'), tc('G7', 'on'), tc('R1', 'on'), tc('R2', 'off'), tc('H1', 'on'), tc('H2', 'off'), tc('H3', 'on')]),
  tpl('Bedrijfsfeest', 'Company event', ['company'], 'business', 'after_quote', 'default', [
    tc('P3', 'on'), tc('A4', 'auto', 'outdoor'), tc('L2', 'on'), tc('G1', 'on'), tc('G2', 'on'), tc('G3', 'on'), tc('G4', 'auto', 'outdoor'),
    tc('G5', 'on'), tc('G6', 'auto', 'setup'), tc('G7', 'off'), tc('R1', 'on'), tc('R2', 'on'), tc('R3', 'off'), tc('H1', 'on'), tc('H2', 'off'), tc('H3', 'off')]),
  tpl('Dorpsfeest / festival', 'Village festival', ['village_festival', 'carnival', 'festival'], 'business', 'after_quote', 'default', [
    tc('P3', 'on'), tc('A4', 'on'), tc('L2', 'on'), tc('G1', 'on'), tc('G2', 'on'), tc('G3', 'on'), tc('G4', 'auto', 'outdoor'),
    tc('G5', 'on'), tc('G6', 'auto', 'setup'), tc('G7', 'on'), tc('R1', 'on'), tc('R2', 'off'), tc('R3', 'on'), tc('H1', 'on'), tc('H2', 'off')]),
  tpl('Clubavond', 'Club night', ['club'], 'business', 'none', 'club', [
    tc('P3', 'off'), tc('L2', 'off'), tc('G1', 'off'), tc('G2', 'on'), tc('G3', 'off'), tc('G5', 'on'), tc('G7', 'on'),
    tc('R1', 'on'), tc('R3', 'on'), tc('H1', 'on')]),
];

type R = Omit<Rider, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & { key: 'default' | 'club' };
const ri = (id: string, nl: string, en: string) => ({ id, nl, en });

export const DEFAULT_RIDERS: R[] = [
  { key: 'default', name: 'Standaard rider', version: 1, active: true,
    technical: [
      ri('t1', 'Speelplek: minimaal 3 × 2 meter, vlak, droog en veilig.', 'Playing area: at least 3 × 2 metres, level, dry and safe.'),
      ri('t2', 'Stroom: 2 × 230 V / 16 A, geaard, op aparte groepen, binnen 10 meter. Niet op dezelfde groep als koffiemachines, frituur of andere catering.', 'Power: 2 × 230 V / 16 A, earthed, on separate circuits, within 10 metres. Not on the same circuit as coffee machines, fryers or other catering equipment.'),
      ri('t3', 'Een stevige tafel van circa 180 × 80 cm, minimaal 90 cm hoog (als we geen eigen DJ-booth meenemen).', 'A sturdy table of about 180 × 80 cm, at least 90 cm high (if we do not bring our own DJ booth).'),
      ri('t4', 'Buiten: een verankerde overkapping, dicht aan de achterkant en aan de weerkant.', 'Outdoors: an anchored cover, closed at the back and on the weather side.'),
      ri('t5', 'Laden en lossen: auto tot binnen 25 meter, geen trappen of een lift.', 'Load-in: vehicle access within 25 metres, no stairs or a lift available.'),
    ],
    hospitality: [
      ri('h1', 'Drinken tijdens het optreden voor {{performersCount}} personen (water en fris; alcohol pas na de set).', 'Drinks during the performance for {{performersCount}} people (water and soft drinks; alcohol only after the set).'),
      ri('h2', 'Een warme maaltijd bij optredens langer dan 4 uur of bij opbouw vóór 18:00.', 'A hot meal for performances over 4 hours, or with set-up before 18:00.'),
      ri('h3', 'Gratis parkeerplek dichtbij de laadplek.', 'Free parking close to the load-in.'),
      ri('h4', 'Een afsluitbare plek voor flightcases en tassen.', 'A lockable spot for flight cases and bags.'),
    ] },
  { key: 'club', name: 'Club rider (alleen DJ)', version: 1, active: true,
    technical: [
      ri('t1', '2 × Pioneer CDJ-3000 (of gelijkwaardig) met link-kabel en een DJM-mixer (DJM-900NXS2/A9).', '2 × Pioneer CDJ-3000 (or equivalent) with link cable and a DJM mixer (DJM-900NXS2/A9).'),
      ri('t2', 'Een goede booth-monitor die de DJ zelf kan regelen.', 'A good booth monitor the DJ can control.'),
      ri('t3', 'Minimaal één vrij stopcontact (230 V) in de booth voor laptop/verlichting.', 'At least one free socket (230 V) in the booth for a laptop/light.'),
    ],
    hospitality: [
      ri('h1', 'Drinken voor {{performersCount}} personen tijdens de set.', 'Drinks for {{performersCount}} people during the set.'),
      ri('h2', 'Gastenlijst: 2 plekken per DJ.', 'Guest list: 2 spots per DJ.'),
      ri('h3', 'Parkeerplek of parkeervergoeding.', 'Parking or a parking allowance.'),
    ] },
];
