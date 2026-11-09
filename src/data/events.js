// Chaque période tire un événement dans son pool.
// Pendant la période N, les joueurs ne voient que l'INDICE de l'événement.
// L'événement se déclenche au début de la période N+1 (prix, revenus, effets spéciaux).
// Exception : les événements à CHOIX se jouent pendant la période elle-même.
//
// prices : multiplicateurs de prix · income : multiplicateurs de revenus (oil, tourism, agriculture, base)
// video : fichier joué sur l'écran projeté au début de la période de l'événement

const EVENTS = [
  // ── Période 1 ─────────────────────────────────────────────────────────
  {
    id: 'oil_boom', period: 1, type: 'market', icon: '🛢️', video: 'oil_boom.mp4',
    title: 'Choc pétrolier',
    desc: 'La production mondiale se contracte. Le baril s\'envole.',
    hint: 'Les grandes puissances pétrolières réduisent leurs quotas de production. Les marchés à terme s\'emballent.',
    explanation: 'Quotas réduits → pétrole rare → prix et revenus pétroliers explosent.',
    effect: 'Revenus pétrole ×5 · prix pétrole ×4',
    prices: { oil: 4 }, income: { oil: 5 },
  },
  {
    id: 'tourism_boom', period: 1, type: 'market', icon: '🏖️',
    title: 'Boom du tourisme',
    desc: 'Les voyages explosent. Le tourisme devient une ressource très prisée.',
    hint: 'Les restrictions de voyage sont levées. Les aéroports enregistrent un afflux record de voyageurs.',
    explanation: 'Restrictions levées → voyageurs en masse → le tourisme rapporte gros.',
    effect: 'Revenus tourisme ×5 · prix tourisme ×2',
    prices: { tourism: 2 }, income: { tourism: 5 },
  },
  {
    id: 'gold_rush', period: 1, type: 'market', icon: '💰',
    title: 'Découverte aurifère massive',
    desc: 'L\'or afflue. Les liquidités mondiales explosent.',
    hint: 'Des gisements exceptionnels sont confirmés sur trois continents. Les banques centrales injectent massivement des liquidités.',
    explanation: 'Liquidités massives → inflation → tout coûte plus cher, mais les revenus de base triplent.',
    effect: 'Revenus de base ×3 · toutes ressources +20 %',
    prices: { oil: 1.2, food: 1.2, tourism: 1.2, agriculture: 1.2 }, income: { base: 3 },
  },

  // ── Période 2 ─────────────────────────────────────────────────────────
  {
    id: 'agri_boom', period: 2, type: 'market', icon: '🌾',
    title: 'Superproduction agricole',
    desc: 'Récoltes records. L\'agriculture inonde les marchés.',
    hint: 'Des conditions météo exceptionnelles sur trois continents laissent présager des récoltes records.',
    explanation: 'Récoltes records → surplus → l\'agriculture est moins chère mais rapporte énormément.',
    effect: 'Revenus agriculture ×5 · +25 % de nourriture pour tous · prix agriculture −40 %',
    prices: { agriculture: 0.6 }, income: { agriculture: 5 }, special: 'agriBoost',
  },
  {
    id: 'free_trade', period: 2, type: 'market', icon: '🤝', video: 'free_trade.mp4',
    title: 'Accord de libre-échange mondial',
    desc: 'Les frontières commerciales s\'ouvrent. Le tourisme explose.',
    hint: 'Les grandes économies négocient un traité historique. Les barrières douanières pourraient tomber.',
    explanation: 'Barrières levées → voyageurs en masse → tourisme très prisé, autres ressources en légère baisse.',
    effect: 'Revenus tourisme ×3 · revenus de base ×1,15 · prix tourisme ×2 · autres ressources −20 %',
    prices: { tourism: 2, oil: 0.8, food: 0.8, agriculture: 0.8 }, income: { tourism: 3, base: 1.15 },
  },
  {
    id: 'speculation', period: 2, type: 'market', icon: '📈',
    title: 'Spéculation sur les matières premières',
    desc: 'Les marchés s\'emballent. Les matières premières s\'envolent.',
    hint: 'Les investisseurs fuient les marchés financiers et cherchent des valeurs refuges tangibles.',
    explanation: 'Spéculation → demande artificielle → pétrole, nourriture et agriculture s\'envolent.',
    effect: 'Revenus de base ×2 · pétrole +50 % · nourriture +40 % · agriculture +40 %',
    prices: { oil: 1.5, food: 1.4, agriculture: 1.4 }, income: { base: 2 },
  },

  // ── Période 3 ─────────────────────────────────────────────────────────
  {
    id: 'food_crisis', period: 3, type: 'market', icon: '🌵', video: 'food_crisis.mp4',
    title: 'Crise alimentaire mondiale',
    desc: 'Les greniers mondiaux se vident. La nourriture devient un luxe.',
    hint: 'Les satellites confirment une sécheresse étendue sur plusieurs zones céréalières. Les stocks mondiaux sont au plus bas.',
    explanation: 'Sécheresse → stocks épuisés → nourriture hors de prix, l\'agriculture devient très rentable.',
    effect: 'Revenus agriculture ×4 · nations sous 200 de nourriture : −35 % de puissance · nourriture ×4 · agriculture +80 %',
    prices: { food: 4, agriculture: 1.8 }, income: { agriculture: 4 }, special: 'foodCrisis',
  },
  {
    id: 'energy_shift', period: 3, type: 'market', icon: '⚡',
    title: 'Transition énergétique',
    desc: 'Le pétrole perd sa valeur stratégique. Les marchés s\'effondrent.',
    hint: 'Plusieurs constructeurs automobiles annoncent l\'abandon du moteur thermique. Les marchés pétroliers sont nerveux.',
    explanation: 'Abandon du thermique → demande de pétrole effondrée → sa valeur chute.',
    effect: 'Revenus pétrole nuls · nations avec plus de 200 pétrole : −20 % d\'or · prix pétrole −70 %',
    prices: { oil: 0.3 }, income: { oil: 0 }, special: 'oilCrash',
  },
  {
    id: 'sanctions', period: 3, type: 'market', icon: '⚠️',
    title: 'Sanctions coordonnées',
    desc: 'Le G20 frappe fort les grandes puissances.',
    hint: 'Une coalition diplomatique inédite prépare des mesures contre les économies dominantes.',
    explanation: 'Sanctions → chaînes d\'approvisionnement perturbées → tout coûte plus cher.',
    effect: 'Tier S et A : −15 % d\'or · les 4 nations les plus faibles : +1 500 or · toutes ressources +30 %',
    prices: { oil: 1.3, food: 1.3, tourism: 1.3, agriculture: 1.3 }, special: 'sanctions',
  },

  // ── Période 4 : choix stratégiques (joués pendant la période) ─────────
  {
    id: 'embargo', period: 4, type: 'choice', icon: '🚢',
    title: 'Embargo commercial',
    desc: 'Les routes maritimes sont coupées. Chaque nation doit choisir son camp.',
    hint: 'Les routes maritimes étant bloquées, le pétrole va se raréfier.',
    explanation: 'Routes bloquées → offre de pétrole réduite → prix en hausse.',
    effect: 'Choix A ou B · prix pétrole ×2 à la période suivante',
    prices: { oil: 2 },
    choices: {
      A: { label: 'Rester neutre', detail: '−400 pétrole', cost: { oil: 400 } },
      B: { label: 'Payer le passage', detail: '−1 000 or · 50 % de risque de −500 pts', cost: { gold: 1000 }, risk: { chance: 0.5, prestige: -500 } },
    },
  },
  {
    id: 'scandal', period: 4, type: 'choice', icon: '📰',
    title: 'Scandale financier',
    desc: 'Des révélations compromettantes circulent. Avouer ou nier ?',
    hint: 'Le scandale ternit l\'image des gouvernements : les touristes risquent de bouder.',
    explanation: 'Image ternie → touristes plus rares → prix du tourisme en baisse.',
    effect: 'Choix A ou B · prix tourisme −20 % à la période suivante',
    prices: { tourism: 0.8 },
    choices: {
      A: { label: 'Reconnaître les faits', detail: '−300 or · −100 pts', cost: { gold: 300 }, prestige: -100 },
      B: { label: 'Démentir', detail: '50 % : rien · 50 % : −1 200 or et −400 pts', risk: { chance: 0.5, gold: -1200, prestige: -400 } },
    },
  },
  {
    id: 'refugees', period: 4, type: 'choice', icon: '🌍', video: 'refugees.mp4',
    title: 'Crise humanitaire',
    desc: 'Des millions de personnes fuient. Accueillir ou fermer les frontières ?',
    hint: 'L\'afflux de réfugiés va faire grimper la demande alimentaire.',
    explanation: 'Afflux de réfugiés → demande alimentaire en hausse → prix de la nourriture en hausse.',
    effect: 'Choix A ou B · prix nourriture +50 % à la période suivante',
    prices: { food: 1.5 },
    choices: {
      A: { label: 'Accueillir', detail: '−400 nourriture → +400 pts · +60 soldats', cost: { food: 400 }, prestige: 400, army: 60 },
      B: { label: 'Fermer les frontières', detail: '−300 pts', prestige: -300 },
    },
  },

  // ── Période 5 ─────────────────────────────────────────────────────────
  {
    id: 'revolution', period: 5, type: 'targeted', icon: '✊',
    title: 'Vague révolutionnaire',
    desc: 'Les peuples renversent les élites. Les équilibres basculent.',
    hint: 'Des tensions sociales profondes grondent dans les pays les plus inégalitaires.',
    explanation: 'Instabilité → touristes en fuite, énergie sous tension.',
    effect: 'Moitié la plus faible : +1 000 or · top 3 : −10 % d\'or · tourisme −20 % · pétrole +30 %',
    prices: { tourism: 0.8, oil: 1.3 }, special: 'revolution',
  },
  {
    id: 'imf', period: 5, type: 'targeted', icon: '🏦',
    title: 'Plan du FMI',
    desc: 'Le FMI injecte des milliards dans les économies fragiles.',
    hint: 'Les grandes institutions financières préparent un plan de soutien massif aux économies en difficulté.',
    explanation: 'Plan FMI → aide ciblée, ressources stratégiques sous tension.',
    effect: 'Les 4 nations les plus faibles : +1 500 or et +70 soldats · pétrole +25 % · nourriture +20 % · agriculture +20 %',
    prices: { oil: 1.25, food: 1.2, agriculture: 1.2 }, special: 'imf',
  },
  {
    id: 'uprising', period: 5, type: 'targeted', icon: '🪧', video: 'uprising.mp4',
    title: 'Grèves et soulèvements',
    desc: 'Les pays émergents s\'arment. Les superpuissances voient leurs troupes déserter.',
    hint: 'Des mouvements sociaux inattendus secouent les armées des grandes puissances.',
    explanation: 'Grèves → logistique paralysée, armées déstabilisées.',
    effect: 'Tier B : +15 % de soldats · Tier S : −20 % de soldats · tourisme −25 % · pétrole +40 % · agriculture +30 %',
    prices: { tourism: 0.75, oil: 1.4, agriculture: 1.3 }, special: 'uprising',
  },

  // ── Période 6 : se déclenche juste avant la négociation ──────────────
  {
    id: 'earthquake', period: 6, type: 'targeted', icon: '🌋',
    title: 'Séisme majeur',
    desc: 'Le sol tremble. Une nation est frappée sans prévenir.',
    hint: 'Les sismologues enregistrent une activité anormale le long de plusieurs failles majeures.',
    explanation: 'Le séisme détruit des terres agricoles juste avant la guerre.',
    effect: '1 nation au hasard : −55 % de nourriture et −500 pts',
    special: 'disaster', disaster: { count: 1, foodLoss: 0.55, prestige: -500 },
  },
  {
    id: 'typhoon', period: 6, type: 'targeted', icon: '🌀', video: 'typhoon.mp4',
    title: 'Typhons dévastateurs',
    desc: 'Deux super-tempêtes frappent les côtes.',
    hint: 'Les météorologues suivent deux systèmes dépressionnaires qui s\'intensifient au-dessus des océans.',
    explanation: 'Les typhons ravagent les réserves de deux nations.',
    effect: '2 nations au hasard : −60 % de nourriture et −300 pts',
    special: 'disaster', disaster: { count: 2, foodLoss: 0.6, prestige: -300 },
  },
  {
    id: 'tourism_crisis', period: 6, type: 'targeted', icon: '✈️',
    title: 'Crise du tourisme',
    desc: 'Les touristes fuient les grandes destinations.',
    hint: 'Les compagnies aériennes signalent une vague d\'annulations sans précédent.',
    explanation: 'Les destinations touristiques majeures perdent leurs visiteurs.',
    effect: 'Tourisme > 200 : −15 % d\'or · tourisme < 70 : +1 000 or',
    special: 'tourismCrisis',
  },
];

const PERIODS = [
  { number: 1, name: 'L\'Ère de Croissance', desc: 'Investissez selon l\'indice : il annonce l\'événement qui frappera au début de la prochaine période.' },
  { number: 2, name: 'Premières Tensions',   desc: 'Les tensions montent. Suivez l\'indice et surveillez vos réserves de nourriture.' },
  { number: 3, name: 'Crise Mondiale',       desc: 'Une crise majeure se prépare. Diversifiez pour encaisser le choc.' },
  { number: 4, name: 'Choix Stratégiques',   desc: 'Un dilemme va s\'imposer à toutes les nations. Pesez le coût de chaque option.' },
  { number: 5, name: 'Course aux Armements', desc: 'L\'armée est débloquée : recrutez des soldats, investissez en ATK et DEF.' },
  { number: 6, name: 'L\'Heure de Vérité',   desc: 'Dernière période de paix. Viennent ensuite la négociation puis la guerre : gardez de l\'or pour attaquer.' },
];

const EVENTS_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));
const POOLS = {};
for (const e of EVENTS) (POOLS[e.period] = POOLS[e.period] || []).push(e.id);

module.exports = { EVENTS, EVENTS_BY_ID, POOLS, PERIODS };
