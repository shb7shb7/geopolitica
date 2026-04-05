const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/screen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));

// ─── SESSION MANAGEMENT ────────────────────────────────────────────────────
// MJ PIN: set via env var MJ_PIN or defaults to a random 4-digit pin per boot
const MJ_PIN = process.env.MJ_PIN || String(Math.floor(1000 + Math.random() * 9000));
console.log('MJ PIN this session:', MJ_PIN);

// Session join code: 6 alphanumeric chars, regenerated each game start
let SESSION_CODE = generateSessionCode();
function generateSessionCode() {
  return Math.random().toString(36).substring(2,5).toUpperCase() +
         Math.random().toString(36).substring(2,5).toUpperCase();
}

// Track connected sockets per team for reconnection
// socketId -> { teamName, countryId, isMJ }
const socketRegistry = new Map();
// teamName -> socketId (latest)
const teamSockets = new Map();

// Expose session info endpoint
app.get('/session-info', (req, res) => {
  res.json({ sessionCode: SESSION_CODE, phase: gameState.phase });
});

const COUNTRIES = [
  { id:'usa',     flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:900, oil:200, food:400, tourism:200, agriculture:120, army:320, atk:0, def:0, militarySpent:0, population:330 },
  { id:'china',   flag:'🇨🇳', name:'Chine',        tier:'S', gold:850, oil:250, food:550, tourism:120, agriculture:180, army:290, atk:0, def:0, militarySpent:0, population:1400 },
  { id:'russia',  flag:'🇷🇺', name:'Russie',       tier:'A', gold:550, oil:520, food:220, tourism:60,  agriculture:90,  army:260, atk:0, def:0, militarySpent:0, population:145 },
  { id:'germany', flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:650, oil:100, food:300, tourism:220, agriculture:130, army:220, atk:0, def:0, militarySpent:0, population:83 },
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:720, oil:400, food:80,  tourism:250, agriculture:20,  army:170, atk:0, def:0, militarySpent:0, population:3 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:600, oil:80,  food:360, tourism:280, agriculture:160, army:215, atk:0, def:0, militarySpent:0, population:68 },
  { id:'japan',   flag:'🇯🇵', name:'Japon',        tier:'A', gold:700, oil:60,  food:280, tourism:300, agriculture:100, army:190, atk:0, def:0, militarySpent:0, population:125 },
  { id:'turkey',  flag:'🇹🇷', name:'Turquie',      tier:'A', gold:480, oil:120, food:300, tourism:200, agriculture:150, army:245, atk:0, def:0, militarySpent:0, population:85 },
  { id:'australia',flag:'🇦🇺',name:'Australie',    tier:'A', gold:550, oil:200, food:350, tourism:180, agriculture:200, army:180, atk:0, def:0, militarySpent:0, population:26 },
  { id:'saudi',   flag:'🇸🇦', name:'Arabie S.',    tier:'A', gold:700, oil:600, food:60,  tourism:120, agriculture:20,  army:190, atk:0, def:0, militarySpent:0, population:35 },
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:420, oil:160, food:620, tourism:90,  agriculture:260, army:160, atk:0, def:0, militarySpent:0, population:215 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:400, oil:100, food:580, tourism:130, agriculture:210, army:180, atk:0, def:0, militarySpent:0, population:1400 },
  { id:'mexico',  flag:'🇲🇽', name:'Mexique',      tier:'B', gold:360, oil:180, food:420, tourism:160, agriculture:180, army:150, atk:0, def:0, militarySpent:0, population:130 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:300, oil:60,  food:380, tourism:170, agriculture:190, army:135, atk:0, def:0, militarySpent:0, population:37 },
  { id:'southafrica',flag:'🇿🇦',name:'Afrique S.', tier:'B', gold:320, oil:80,  food:350, tourism:140, agriculture:170, army:140, atk:0, def:0, militarySpent:0, population:60 },
];

function getFoodConsumption(c) { return Math.max(3, Math.round(c.population / 6)); }

const BASE_PRICES = { oil:80, food:40, tourism:120, agriculture:60 };
const MEAN_REVERT_STRENGTH = 1/3; // each period, price moves 1/3 back toward base

// Mean reversion: price moves toward base, then event multiplies CURRENT price (cumulative)
function meanRevertPrices(current) {
  const out = {};
  for (const r of ['oil','food','tourism','agriculture']) {
    out[r] = Math.round(current[r] + (BASE_PRICES[r] - current[r]) * MEAN_REVERT_STRENGTH);
  }
  return out;
}

// Apply event multipliers to CURRENT prices (not base) — cumulative effect
function applyEventMultipliers(current, ev) {
  if (!ev) return { ...current };
  return {
    oil:         Math.round(current.oil         * (ev.priceOil      || 1)),
    food:        Math.round(current.food        * (ev.priceFood     || 1)),
    tourism:     Math.round(current.tourism     * (ev.priceTourism  || 1)),
    agriculture: Math.round(current.agriculture * (ev.priceAgri     || 1)),
  };
}

// For preview of next period prices: mean-revert current, then apply next event
function previewNextPrices(currentPrices, nextEv) {
  const reverted = meanRevertPrices(currentPrices);
  return applyEventMultipliers(reverted, nextEv);
}

function getPassiveIncome(c, mod) {
  const oilInc  = Math.round((c.oil||0)        * 25 * (mod.oilMultiplier     || 1));
  const tourInc = Math.round((c.tourism||0)     * 25 * (mod.tourismMultiplier || 1));
  const agriInc = Math.round((c.agriculture||0) * 20 * (mod.agriMultiplier   || 1));
  const baseInc = Math.round((80 + Math.random()*60 + c.population*0.04) * (mod.baseMultiplier || 1));
  return { oilInc, tourInc, agriInc, baseInc, total: oilInc+tourInc+agriInc+baseInc };
}

// COMBAT: army = base, atk = offensive multiplier, def = defensive multiplier
// scoreAtt = army * (1 + atk*0.01) * tierBonus * randFactor
// scoreDef = army * (1 + def*0.01) * tierBonus * 1.10 * randFactor  (defender advantage)
// Bunker removed — replaced by def stat
function resolveCombat(att, def) {
  // V5 — ATK et DEF symétriques, pas de bonus territorial fixe
  // ATK booste le score offensif de l'attaquant
  // DEF booste la résistance du défenseur (son score est plus difficile à dépasser)
  const tA = att.tier==='B' ? 1.15 : 1.0;
  const tD = def.tier==='B' ? 1.15 : 1.0;
  // coeff 0.001 : ATK/DEF progressifs — 300pts ATK = ×1.30, s'annulent si égaux
  const atkBonus = 1 + (att.atk||0) * 0.001;
  const defBonus = 1 + (def.def||0) * 0.001;
  const cA = 1 + (att.combatBonus||0);
  // Aléatoire ±110% — gros avantage = 97%, stats proches = 60%, égaux = 50%
  const rAc = Math.max(0.10, 1 + (Math.random() - 0.5) * 2.20);
  const rDc = Math.max(0.10, 1 + (Math.random() - 0.5) * 2.20);
  const rawA = att.army * tA * rAc + (att.food||0) * 0.02;
  const rawD = def.army * tD * rDc + (def.food||0) * 0.02;
  const sA = rawA * atkBonus * cA;   // ATK amplifie la puissance offensive
  const sD = rawD * defBonus;         // DEF amplifie la résistance défensive
  const attackerWins = sA > sD;
  // Calcul de l'écart relatif pour calibrer les pertes
  const margin = attackerWins ? (sA - sD) / sD : (sD - sA) / sA;
  return { attackerWins, scoreAtt:Math.round(sA), scoreDef:Math.round(sD), margin };
}

function calcCombatLosses(attackerWins, margin, attArmy, defArmy) {
  // Gagnant : [3%, 15%] — serré = 12-15%, facile = 3-5%
  // Règle : gagnant perd TOUJOURS au moins 3× moins que le perdant
  const winnerLossPct = Math.min(15, Math.max(3, 15 / (1 + margin * 4)));
  // Perdant : min 2.2× les pertes du gagnant, max 50%
  const loserLossPct  = Math.min(50, Math.max(winnerLossPct * 2.2, 20 + margin * 60));
  return {
    winnerLoss: Math.max(1, Math.round(attArmy * winnerLossPct / 100)),
    loserLoss:  Math.max(1, Math.round(defArmy  * loserLossPct  / 100)),
    winnerLossPct: Math.round(winnerLossPct),
    loserLossPct:  Math.round(loserLossPct),
  };
}

function calcPower(c) {
  const t = c.tier==='B' ? 1.15 : 1.0;
  // militarySpent tracks gold converted to ATK/DEF/Army so it doesn't penalize treasury
  const militarySpent = c.militarySpent || 0;
  const effectiveTreasury = Math.max(0, (c.treasury||0) + militarySpent);
  return Math.max(0, Math.round((
    c.army * 20 +              // armée = pilier principal (doublé)
    effectiveTreasury * 0.10 + // trésor compte moins (réduit de 0.25 → 0.10)
    (c.oil||0) * 0.8 +
    (c.tourism||0) * 0.6 +
    (c.agriculture||0) * 0.5 +
    (c.food||0) * 1.2 +
    (c.atk||0) * 15 +          // ATK valorisé (8 → 15)
    (c.def||0) * 12            // DEF valorisé (6 → 12)
  ) * t));
}

// EVENTS — moderate hints, effects primarily via price multipliers
const EVENTS = [
  // ── MANCHE 1 — MARCHÉ uniquement ────────────────────────────────────────
  { id:'oil_boom', type:'market', period:1,
    hint:'Les grandes puissances pétrolières réduisent leurs quotas de production. Les marchés à terme s\'emballent.',
    causalExplanation:'Les quotas ont été réduits → le pétrole se raréfie → les revenus pétroliers explosent.',
    priceJustification:{oil:'Offre mondiale réduite → pétrole plus rare → prix ↑'},
    title:'Choc pétrolier', desc:'La production mondiale se contracte. Le baril s\'envole.',
    effect:'N+1 — revenus pétrole ×5 · prix pétrole ↑×4 · achat pétrole bloqué si < 6 000 pts',
    oilMultiplier:5, priceOil:4.0, blockOilBelowPower:6000 },

  { id:'tourism_boom', type:'market', period:1,
    hint:'Les restrictions de voyage sont levées. Les aéroports enregistrent un afflux record de voyageurs internationaux.',
    causalExplanation:'Les restrictions levées → voyageurs affluent massivement → le tourisme devient une ressource très prisée.',
    priceJustification:{tourism:'Forte demande de voyages → tourisme rare et prisé → prix ↑'},
    title:'Boom du tourisme', desc:'Les voyages explosent. Le tourisme devient une ressource très prisée.',
    effect:'N+1 — revenus tourisme ×5 · prix tourisme ↑×2 (forte demande)',
    tourismMultiplier:5, priceTourism:2.0 },

  { id:'gold_rush', type:'market', period:1,
    hint:'Des gisements exceptionnels sont confirmés sur trois continents. Les banques centrales injectent massivement des liquidités.',
    causalExplanation:'L\'injection massive de liquidités crée de l\'inflation → toutes les ressources coûtent plus cher, les revenus de base triplent.',
    priceJustification:{oil:'Inflation mondiale → prix ↑', food:'Inflation mondiale → prix ↑', tourism:'Inflation mondiale → prix ↑', agriculture:'Inflation mondiale → prix ↑'},
    title:'Découverte aurifère massive', desc:'L\'or afflue. Les liquidités mondiales explosent.',
    effect:'N+1 — revenus de base ×3 · toutes ressources ↑+20%',
    baseMultiplier:3, priceOil:1.2, priceFood:1.2, priceTourism:1.2, priceAgri:1.2 },

  // ── MANCHE 2 — MARCHÉ uniquement ────────────────────────────────────────
  { id:'agri_boom', type:'market', period:2,
    hint:'Des conditions météo exceptionnelles sur trois continents laissent présager des récoltes records cette saison.',
    causalExplanation:'Récoltes records → surplus massif sur les marchés → l\'agriculture est abondante donc moins chère, mais les revenus sont énormes.',
    priceJustification:{agriculture:'Surplus de récoltes → offre abondante → concurrence → prix ↓'},
    title:'Superproduction agricole', desc:'Récoltes records. L\'agriculture inonde les marchés.',
    effect:'N+1 — revenus agri ×5 · nourriture +25% à tous · prix agri ↓−40% (surplus)',
    agriMultiplier:5, priceAgri:0.6, special:'agriBoost' },

  { id:'free_trade', type:'market', period:2,
    hint:'Les grandes économies signent un traité historique. Les barrières douanières tombent, les échanges commerciaux s\'accélèrent.',
    causalExplanation:'Suppression des barrières douanières → marchés inondés de produits → concurrence accrue → toutes les ressources moins chères.',
    priceJustification:{oil:'Libre-échange → concurrence accrue → prix ↓', food:'Libre-échange → surplus alimentaires libres → prix ↓', tourism:'Frontières ouvertes → offre touristique abondante → prix ↓', agriculture:'Marchés agricoles mondiaux ouverts → prix ↓'},
    title:'Accord de libre-échange mondial', desc:'Les frontières commerciales s\'ouvrent. Tout devient accessible.',
    effect:'N+1 — toutes ressources ↓−30% · revenus passifs +15%',
    priceOil:0.7, priceFood:0.7, priceTourism:0.7, priceAgri:0.7,
    oilMultiplier:1.15, tourismMultiplier:1.15, agriMultiplier:1.15, baseMultiplier:1.15 },

  { id:'speculation', type:'market', period:2,
    hint:'Une spéculation massive s\'empare des marchés des matières premières. Les investisseurs cherchent des valeurs refuges.',
    causalExplanation:'Spéculation massive → les investisseurs achètent toutes les matières premières → demande artificielle → prix en hausse partout.',
    priceJustification:{oil:'Spéculation sur matières premières → demande artificielle → prix ↑', food:'Ruée vers les valeurs refuges alimentaires → prix ↑', agriculture:'Demande spéculative agricole → prix ↑'},
    title:'Ruée vers l\'or', desc:'Les marchés s\'emballent. Les matières premières s\'envolent.',
    effect:'N+1 — revenus de base ×2 · pétrole ↑+50% · nourriture ↑+40% · agri ↑+40% · tourisme stable',
    baseMultiplier:2, priceOil:1.5, priceFood:1.4, priceTourism:1.0, priceAgri:1.4 },

  // ── MANCHE 3 — MARCHÉ uniquement ────────────────────────────────────────
  { id:'food_crisis', type:'market', period:3,
    hint:'Les satellites agricoles confirment une sécheresse étendue dans plusieurs zones céréalières. Les stocks mondiaux sont au plus bas.',
    causalExplanation:'La sécheresse a vidé les greniers mondiaux → nourriture rare et chère → l\'agriculture est très rentable cette période.',
    priceJustification:{food:'Sécheresse → stocks épuisés → nourriture rare → prix ↑', agriculture:'Famine mondiale → l\'agriculture stratégique → prix ↑'},
    title:'Crise alimentaire mondiale', desc:'Les greniers mondiaux se vident. La nourriture devient un luxe.',
    effect:'N+1 — revenus agri ×4 · pays < 200 nourr → −35% puissance · prix nourriture ↑×4 · prix agri ↑+80%',
    agriMultiplier:4, priceFood:4.0, priceAgri:1.8, special:'foodCrisisPenalty' },

  { id:'energy_shift', type:'market', period:3,
    hint:'Plusieurs constructeurs automobiles annoncent l\'abandon du moteur thermique d\'ici 5 ans. Les marchés pétroliers réagissent nerveusement.',
    causalExplanation:'L\'abandon massif du thermique annoncé → demande de pétrole s\'effondre → sa valeur chute drastiquement.',
    priceJustification:{oil:'Abandon du thermique → demande pétrole effondrée → prix ↓'},
    title:'Transition énergétique', desc:'Le pétrole perd sa valeur stratégique. Les marchés s\'effondrent.',
    effect:'N+1 — pays pétrole > 200 → −900 or · revenus pétrole ×0 · prix pétrole ↓−70%',
    oilMultiplier:0, priceOil:0.3, special:'oilCrash' },

  { id:'sanctions', type:'market', period:3,
    hint:'Une coalition diplomatique inédite prépare des mesures contre les économies dominantes. Les ambassadeurs multiplient les consultations discrètes.',
    causalExplanation:'Les sanctions perturbent les chaînes d\'approvisionnement mondiales → tout coûte plus cher à importer ou exporter.',
    priceJustification:{oil:'Perturbations commerciales → prix ↑', food:'Chaînes alimentaires perturbées → prix ↑', tourism:'Tensions → avis de voyage négatifs → prix ↑', agriculture:'Échanges bloqués → prix ↑'},
    title:'Sanctions coordonnées', desc:'Le G20 frappe fort les grandes puissances. Les petits en profitent.',
    effect:'N+1 — Tier S/A → −1 200 or · 4 nations les plus faibles → +400 or · toutes ressources ↑+30%',
    priceOil:1.3, priceFood:1.3, priceTourism:1.3, priceAgri:1.3, special:'sanctionsSA' },

  // ── MANCHE 4 — CHOIX uniquement (1 parmi ces 5) ────────────────────────
  { id:'embargo', type:'choice', period:4,
    hint:'Des tensions maritimes bloquent plusieurs routes commerciales stratégiques. Les nations exportatrices préparent des mesures de rétorsion.',
    causalExplanation:'Le blocus des routes maritimes réduit l\'offre de pétrole disponible → sa rareté fait monter le prix.',
    priceJustification:{oil:'Routes bloquées → offre réduite → pétrole rare → prix ↑'},
    title:'Embargo commercial', desc:'Les routes maritimes sont coupées. Chaque nation doit choisir son camp.',
    effect:'N+1 — A: −400 pétrole (neutralité) · B: −1 000 or + 50% risque −500 pts · prix pétrole ↑×2',
    priceOil:2.0,
    choiceA:{label:'Sacrifier 400 pétrole — neutralité garantie',cost:{oil:400},gain:{}},
    choiceB:{label:'Payer 1 000 or + risque 50% de −500 pts supplémentaires',cost:{treasury:1000},gain:{gamble:true,powerLoss:500}} },

  { id:'arms_race', type:'choice', period:4,
    hint:'Des mouvements de troupes inhabituels sont signalés aux frontières de plusieurs régions. Les états-majors renforcent leur état d\'alerte.',
    causalExplanation:'La mobilisation militaire est en cours. Vos choix stratégiques déterminent votre force pour la guerre.',
    priceJustification:{},
    title:'Mobilisation militaire', desc:'Les frontières s\'embrasent. Temps de choisir votre stratégie.',
    effect:'N+1 — A: −600 or → +150 armée, −200 pts · B: −500 nourr → +100 armée, +25% combat',
    choiceA:{label:'Achat d\'armement (−600 or → +150 armée, −200 pts popularité)',cost:{treasury:600},gain:{army:150,powerLoss:200}},
    choiceB:{label:'Mobilisation populaire (−500 nourr → +100 armée, +25% bonus combat)',cost:{food:500},gain:{army:100,combatBonus:0.25}} },

  { id:'scandal', type:'choice', period:4,
    hint:'Des fuites dans la presse internationale évoquent des irrégularités financières impliquant plusieurs gouvernements. Les bourses surveillent.',
    causalExplanation:'Le scandale financier ternit l\'image des gouvernements → les touristes évitent les destinations politiquement instables → prix touristiques baissent.',
    priceJustification:{tourism:'Image gouvernements ternie → touristes évitent → demande ↓ → prix ↓'},
    title:'Scandale financier', desc:'Des révélations compromettantes circulent. Avouer ou nier ?',
    effect:'N+1 — A: −300 or, −100 pts (certain) · B: 50% rien / 50% −1 200 or −400 pts · prix tourisme ↓−20%',
    priceTourism:0.8,
    choiceA:{label:'Reconnaître les faits (coût certain: −300 or, −100 pts)',cost:{treasury:300},gain:{powerLoss:100}},
    choiceB:{label:'Démentir (50%: rien / 50%: −1 200 or et −400 pts)',cost:{},gain:{gamble:true,powerLoss:400,goldLoss:1200}} },

  { id:'war_prep', type:'choice', period:4,
    hint:'Les services de renseignement font circuler des évaluations alarmantes sur l\'instabilité régionale. Les budgets de défense sont sous pression.',
    causalExplanation:'La menace de conflit imminent pousse les nations à choisir entre défense et frappe préventive.',
    priceJustification:{},
    title:'Alerte stratégique', desc:'La guerre est dans l\'air. Deux stratégies s\'affrontent.',
    effect:'N+1 — A: −300 or → +150 pts puissance · B: −800 or → +250 armée, −25% or restant',
    choiceA:{label:'Renforcement défensif (−300 or → +150 pts puissance)',cost:{treasury:300},gain:{power:150}},
    choiceB:{label:'Frappe préventive (−800 or → +250 armée, −25% or restant)',cost:{treasury:800},gain:{army:250,goldPenalty:0.25}} },

  { id:'refugees', type:'choice', period:4,
    hint:'Une instabilité régionale génère des déplacements de population massifs. Les organisations internationales pressent les gouvernements d\'agir.',
    causalExplanation:'L\'afflux de réfugiés augmente massivement la demande alimentaire → la nourriture se raréfie → prix en hausse.',
    priceJustification:{food:'Afflux de réfugiés → demande alimentaire en hausse → prix ↑'},
    title:'Crise humanitaire', desc:'Des millions de personnes fuient. Accueillir ou fermer les frontières ?',
    effect:'N+1 — A: −400 nourr → +400 pts, +60 armée · B: −300 pts · prix nourriture ↑+50%',
    priceFood:1.5,
    choiceA:{label:'Accueillir (−400 nourriture → +400 pts puissance, +60 armée)',cost:{food:400},gain:{power:400,army:60}},
    choiceB:{label:'Refuser (vous perdez −300 pts de puissance)',cost:{},gain:{powerLoss:300}} },

  // ── MANCHE 5 — CIBLÉ uniquement (rééquilibrage) ─────────────────────────
  { id:'revolution', type:'targeted', period:5,
    hint:'Des mouvements sociaux coordonnés gagnent du terrain dans les grandes puissances. Les marchés anticipent une redistribution des équilibres.',
    causalExplanation:'L\'instabilité sociale dans les grandes puissances fait fuir les touristes → demande touristique chute → prix baissent.',
    priceJustification:{tourism:'Instabilité sociale → touristes fuient → demande ↓ → prix ↓'},
    title:'Vague révolutionnaire', desc:'Les peuples renversent les élites. Les équilibres basculent.',
    effect:'N+1 — < 4 500 pts → +400 or · > 10 000 pts → −500 or · prix tourisme ↓−20%',
    priceTourism:0.8, special:'revolution' },

  { id:'imf', type:'targeted', period:5,
    hint:'Le FMI tient une réunion d\'urgence. Des plans de soutien massifs aux économies vulnérables sont en cours d\'élaboration.',
    causalExplanation:'Le plan FMI stabilise les marchés et injecte de l\'aide → pression à la baisse sur les prix des ressources de base.',
    priceJustification:{oil:'Plan FMI → stabilisation marchés → prix ↓', food:'Aide alimentaire → offre augmente → prix ↓', agriculture:'Subventions agricoles → offre en hausse → prix ↓', tourism:'Stabilité retrouvée → tourisme reprend → légère hausse → prix →'},
    title:'Plan FMI', desc:'Le FMI injecte des milliards dans les pays fragiles.',
    effect:'N+1 — 4 nations les plus faibles → +350 or, +70 armée · pétrole/nourr/agri ↓−15% · tourisme stable',
    priceOil:0.85, priceFood:0.85, priceAgri:0.85, priceTourism:1.0, special:'aidFMI' },

  { id:'uprising', type:'targeted', period:5,
    hint:'Des grèves générales paralysent plusieurs secteurs dans les grandes puissances. Les pays émergents profitent du chaos social pour accélérer leur développement.',
    causalExplanation:'Les grèves paralysent les aéroports et hôtels des grandes puissances → le tourisme ne fonctionne plus → sa valeur chute.',
    priceJustification:{tourism:'Grèves → aéroports et hôtels paralysés → tourisme impossible → prix ↓'},
    title:'Grèves et soulèvements', desc:'Les pays émergents s\'arment. Les superpuissances désertent.',
    effect:'N+1 — Tier B → +90 armée · Tier S → −180 armée · prix tourisme ↓−25%',
    priceTourism:0.75, special:'uprising' },

  // ── MANCHE 6 — CIBLÉ uniquement (déstabilisation pré-guerre) ───────────
  { id:'earthquake', type:'targeted', period:6,
    hint:'Des relevés sismiques anormaux sont enregistrés dans plusieurs zones tectoniques actives. Les experts évoquent un risque accru pour les semaines à venir.',
    causalExplanation:'Le séisme détruit des terres agricoles → l\'offre agricole mondiale se contracte → prix de l\'agriculture en hausse.',
    priceJustification:{agriculture:'Terres agricoles détruites → offre réduite → prix ↑'},
    title:'Séisme majeur', desc:'Le sol tremble. Un pays est frappé sans prévenir juste avant la guerre.',
    effect:'Guerre — 1 pays aléatoire → −55% nourriture, −500 pts · prix agri ↑+60%',
    priceAgri:1.6, targetCount:1, effects:{foodLoss:0.55,powerLoss:500} },

  { id:'typhoon', type:'targeted', period:6,
    hint:'Des formations tropicales d\'intensité exceptionnelle sont signalées simultanément dans l\'Atlantique et le Pacifique. Trajectoires encore imprévisibles.',
    causalExplanation:'Les typhons rompent les chaînes d\'approvisionnement alimentaires côtières → nourriture se raréfie → prix en hausse.',
    priceJustification:{food:'Chaînes alimentaires rompues → nourriture rare → prix ↑'},
    title:'Typhons dévastateurs', desc:'Deux super-tempêtes frappent les côtes. Personne n\'est à l\'abri.',
    effect:'Guerre — 2 pays aléatoires → −60% nourriture, −300 pts · prix nourriture ↑+40%',
    priceFood:1.4, targetCount:2, effects:{foodLoss:0.60,powerLoss:300} },

  { id:'tourism_crisis', type:'targeted', period:6,
    hint:'Une série d\'incidents sécuritaires dans des sites très fréquentés génère des avis de voyage restrictifs dans plusieurs pays majeurs.',
    causalExplanation:'Les attentats provoquent la fuite des touristes → la demande s\'effondre → le tourisme perd toute sa valeur commerciale.',
    priceJustification:{tourism:'Attentats → touristes fuient → demande effondrée → prix ↓'},
    title:'Crise du tourisme', desc:'Les touristes fuient. Le secteur s\'effondre. Les pays peu touristiques s\'en sortent.',
    effect:'Guerre — tourisme > 200 → −500 or · tourisme < 70 → +250 or · prix tourisme ↓−60%',
    priceTourism:0.4, special:'tourismCrisis' },
];

function pickRandom(pool) {
  return pool[Math.floor(Math.random()*pool.length)];
}

// Fixed pools per period — structure determines game arc
const PERIOD_POOLS = {
  1: EVENTS.filter(e=>e.period===1),
  2: EVENTS.filter(e=>e.period===2),
  3: EVENTS.filter(e=>e.period===3),
  4: EVENTS.filter(e=>e.type==='choice'),
  5: EVENTS.filter(e=>e.period===5),
  6: EVENTS.filter(e=>e.period===6),
};

function generateSequence() {
  return [1,2,3,4,5,6].map(p=>pickRandom(PERIOD_POOLS[p]||EVENTS));
}

const TUTORIAL_EV = { id:'tutorial', type:'market', title:'Manche Test', desc:'Explorez librement — ressources remises à zéro après. Aucune conséquence !', effect:'Actions illimitées' };

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",       subtitle:"Année 1" },
  { number:2, name:"Premières Tensions",         subtitle:"Année 2" },
  { number:3, name:"Crise Mondiale",             subtitle:"Année 3" },
  { number:4, name:"Course aux Armements",       subtitle:"Année 4" },
  { number:5, name:"Ultimatums",                 subtitle:"Année 5" },
  { number:6, name:"L'Heure de Vérité",         subtitle:"Année 6" },
];

const PERIOD_DESCS = [
  "Les marchés s'ouvrent. Lisez l'indice en bas — il vous dit exactement quoi acheter la prochaine fois. Investissez dans pétrole, tourisme ou agriculture. ⚔️ Gardez 600 or pour la guerre. L'armée sera disponible à la manche 5. 2 actions.",
  "Les tensions montent. L'indice est votre meilleur allié — si ça parle de pétrole, achetez du pétrole maintenant. Si ça parle de famine, stockez de la nourriture. ⚔️ Réserve minimum 600 or. 2 actions.",
  "Catastrophe mondiale. Événement CHOIX: les deux options ont un coût réel, choisissez le moindre mal. ⚔️ L'armée sera disponible dès la prochaine période. 2 actions.",
  "ARMÉE DISPONIBLE. Vous pouvez maintenant recruter et investir en Attaque et Défense. La guerre approche — préparez-vous. ⚔️ Gardez 600 or. 2 actions.",
  "AVANT-DERNIÈRE PÉRIODE. Armée, Attaque, Défense — investissez maintenant. Une phase de NÉGOCIATION aura lieu avant la guerre pour former des alliances. ⚔️ Gardez 600 or. 2 actions.",
  "DERNIÈRE PÉRIODE DE PAIX. Plus aucun achat en guerre. Une phase de négociation suit. ⚔️ Coût d'attaque: 150 or. Maximisez votre Attaque et Défense. 2 actions.",
];

let gameState = {
  phase:'setup', currentPeriod:0, currentEvent:null, nextEvent:null, nextHint:null,
  periodSequence:[], countries:{}, takenCountries:{}, teams:{},
  prices: { ...BASE_PRICES }, prevPrices: { ...BASE_PRICES }, currentPrices: { ...BASE_PRICES },
  eventMod:{oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0},
  coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},
  alliances:{}, pendingAllianceProposals:{},
  log:[], timerSeconds:600, timerRunning:false,
  warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30, negotiationRanking:[],
  teamActionsThisPeriod:{}, lastActionByTeam:{},
  pendingChoiceEvent:null, winner:null, winners:[],
  isTutorial:false, tutorialSnapshot:{}, gameOver:false, negotiationRanking:[], prevEvent:null,
};

let timerInterval=null, warTurnInterval=null;

function initCountries() {
  gameState.countries={};
  COUNTRIES.forEach(c=>{
    gameState.countries[c.id]={ ...c, treasury:c.gold, power:calcPower({...c,treasury:c.gold,militarySpent:0}),
      eliminated:false, defense:false, team:null, combatBonus:0, militarySpent:0 };
  });
}

function addLog(text,type){
  gameState.log.unshift({text,type,time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});
  if(gameState.log.length>120)gameState.log=gameState.log.slice(0,120);
}
function addTeamNews(teamName,text,type){
  if(!gameState.teams[teamName])return;
  gameState.teams[teamName].news=gameState.teams[teamName].news||[];
  gameState.teams[teamName].news.push({text,type,time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});
  if(gameState.teams[teamName].news.length>80)
    gameState.teams[teamName].news=gameState.teams[teamName].news.slice(-80);
}
function broadcast(){io.emit('state',gameState);}

function applyEvent(ev) {
  gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
  if(ev.oilMultiplier!==undefined)     gameState.eventMod.oilMultiplier=ev.oilMultiplier;
  if(ev.tourismMultiplier!==undefined) gameState.eventMod.tourismMultiplier=ev.tourismMultiplier;
  if(ev.agriMultiplier!==undefined)    gameState.eventMod.agriMultiplier=ev.agriMultiplier;
  if(ev.baseMultiplier!==undefined)    gameState.eventMod.baseMultiplier=ev.baseMultiplier;
  if(ev.blockOilBelowPower)            gameState.eventMod.blockOilBelowPower=ev.blockOilBelowPower;
  // Prices for THIS period are set by the event that was announced last period
  // (already set in applyPeriodTransition / startProsperity)

  if(ev.special==='oilCrash')         Object.values(gameState.countries).forEach(c=>{if(!c.eliminated&&c.oil>200){c.treasury=Math.max(0,c.treasury-900);c.power=calcPower(c);addTeamNews(c.team,'💥 Effondrement pétrolier: −900 or !','bad');}});
  if(ev.special==='agriBoost')        Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){c.food=Math.round(c.food*1.25);c.power=calcPower(c);addTeamNews(c.team,'🌾 Super-saison: +25% nourriture !','good');}});
  if(ev.special==='foodCrisisPenalty')Object.values(gameState.countries).forEach(c=>{if(!c.eliminated&&c.food<200){const l=Math.round(c.power*0.35);c.power=Math.max(0,c.power-l);addTeamNews(c.team,`🚨 Famine: stocks trop faibles — −${l} pts !`,'bad');}});
  if(ev.special==='sanctionsSA'){
    Object.values(gameState.countries).forEach(c=>{if(!c.eliminated&&(c.tier==='S'||c.tier==='A')){c.treasury=Math.max(0,c.treasury-1200);c.power=calcPower(c);addTeamNews(c.team,'⚠️ Sanctions G20: −1200 or !','bad');}});
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,4);
    alive.forEach(c=>{c.treasury+=400;c.power=calcPower(c);addTeamNews(c.team,'💰 Aide compensatoire: +400 or !','good');});
  }
  if(ev.special==='revolution')       Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){if(c.power<4500){c.treasury+=400;c.power=calcPower(c);addTeamNews(c.team,'✊ Révolution: +400 or !','good');}if(c.power>10000){c.treasury=Math.max(0,c.treasury-500);c.power=calcPower(c);addTeamNews(c.team,'✊ Révolution: −500 or !','bad');}}});
  if(ev.special==='aidFMI'){
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,4);
    alive.forEach(c=>{c.treasury+=350;c.army+=70;c.power=calcPower(c);addTeamNews(c.team,'🏦 FMI: +350 or +70 armée !','good');});
  }
  if(ev.special==='uprising')         Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){if(c.tier==='B'){c.army+=90;c.power=calcPower(c);addTeamNews(c.team,'✊ Soulèvement: +90 armée !','good');}if(c.tier==='S'){c.army=Math.max(0,c.army-180);c.power=calcPower(c);addTeamNews(c.team,'✊ Désertion: −180 armée !','bad');}}});
  if(ev.special==='tourismCrisis')    Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){if(c.tourism>200){c.treasury=Math.max(0,c.treasury-500);c.power=calcPower(c);addTeamNews(c.team,'✈️ Crise tourisme: −500 or !','bad');}else if(c.tourism<70){c.treasury+=250;c.power=calcPower(c);addTeamNews(c.team,'✈️ Report touristes: +250 or !','good');}}});
  if(ev.effects){
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated);
    alive.sort(()=>Math.random()-0.5).slice(0,ev.targetCount||1).forEach(c=>{
      if(ev.effects.foodLoss){const l=Math.round(c.food*ev.effects.foodLoss);c.food=Math.max(0,c.food-l);c.power=calcPower(c);addTeamNews(c.team,`🌋 ${ev.title}: −${l} nourriture !`,'bad');addLog(`${ev.title}: ${c.flag} −${l} nourr`,'event');}
      if(ev.effects.powerLoss){c.power=Math.max(0,c.power-ev.effects.powerLoss);addTeamNews(c.team,`🌋 ${ev.title}: −${ev.effects.powerLoss} pts !`,'bad');}
    });
  }
}

function applyPeriodTransition() {
  gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
  Object.values(gameState.countries).forEach(c=>{
    if(c.eliminated)return;
    const need=getFoodConsumption(c);
    if(c.food>=need){c.food-=need;addTeamNews(c.team,`🍞 Consommation: −${need} nourriture (pop. ${c.population}M)`,'neutral');}
    else{const def=need-c.food;c.food=0;const loss=Math.round(def*(c.population/10)*2);c.power=Math.max(0,c.power-loss);addTeamNews(c.team,`⚠️ FAMINE ! −${def} nourr → −${loss} pts !`,'bad');addLog(`Famine: ${c.flag} −${loss} pts`,'event');}
    const inc=getPassiveIncome(c,gameState.eventMod);
    c.treasury+=inc.total;
    addTeamNews(c.team,`💰 Revenus: Pétrole +${inc.oilInc} | Tourisme +${inc.tourInc} | Agriculture +${inc.agriInc} | Base +${inc.baseInc} = +${inc.total} or`,'good');
    const used=(gameState.teamActionsThisPeriod[c.team]||0);
    if(used===0&&c.team&&!gameState.isTutorial){c.power=Math.max(0,c.power-100);addTeamNews(c.team,'😴 Inactivité: −100 pts de puissance !','bad');}
    // Reset bunker each period (1 tour only, handled server-side)
    c.defense=false;
    c.combatBonus=0;
    c.power=calcPower(c);
  });
  gameState.teamActionsThisPeriod={};
  gameState.lastActionByTeam={};
  gameState.alliances={};
}

function startServerTimer(s){
  if(timerInterval)clearInterval(timerInterval);
  if(gameState.gameOver)return;
  gameState.timerSeconds=s;gameState.timerRunning=true;
  timerInterval=setInterval(()=>{
    if(gameState.gameOver){clearInterval(timerInterval);timerInterval=null;gameState.timerRunning=false;return;}
    if(gameState.timerSeconds>0){gameState.timerSeconds--;io.emit('timer',{seconds:gameState.timerSeconds,running:true});}
    else{clearInterval(timerInterval);timerInterval=null;gameState.timerRunning=false;io.emit('timer',{seconds:0,running:false,ended:true});}
  },1000);
}
function pauseServerTimer(){if(timerInterval){clearInterval(timerInterval);timerInterval=null;}gameState.timerRunning=false;io.emit('timer',{seconds:gameState.timerSeconds,running:false});}
function resetServerTimer(s){pauseServerTimer();gameState.timerSeconds=s||600;io.emit('timer',{seconds:gameState.timerSeconds,running:false});}

function checkWinner(){
  if(gameState.gameOver)return;
  const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  if(alive.length===0)return;
  if(alive.length===1){
    gameState.gameOver=true;gameState.winners=[alive[0]];
    if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
    if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}
    io.emit('winner',{winners:gameState.winners,type:'solo'});
    addLog(`🏆 ${alive[0].flag} ${alive[0].name} remporte Geopolitica !`,'event');broadcast();
  } else if(alive.length===2){
    const t1=alive[0].team,t2=alive[1].team;
    const a1=gameState.alliances[t1],a2=gameState.alliances[t2];
    // Double victoire si les deux derniers ont un pacte de non-agression actif entre eux
    const hasMutualPeace = a1&&a1.type==='peace'&&a1.with===t2 && a2&&a2.type==='peace'&&a2.with===t1;
    if(hasMutualPeace){
      gameState.gameOver=true;gameState.winners=alive;
      if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
      if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}
      io.emit('winner',{winners:gameState.winners,type:'alliance'});
      addLog(`🤝 Double victoire par pacte de non-agression: ${alive[0].flag} & ${alive[1].flag} !`,'event');
      broadcast();
    }
  }
}

function startWarTurn(){
  const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  gameState.warTurnOrder=alive.map(c=>c.team);gameState.warCurrentTurn=0;advanceWarTurn();
}
function advanceWarTurn(){
  if(warTurnInterval)clearInterval(warTurnInterval);
  if(gameState.gameOver)return;
  gameState.warTurnOrder=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated).map(c=>c.team);
  if(gameState.warCurrentTurn>=gameState.warTurnOrder.length)gameState.warCurrentTurn=0;
  if(gameState.warTurnOrder.length===0)return;
  const team=gameState.warTurnOrder[gameState.warCurrentTurn];
  gameState.warTurnSeconds=30;
  io.emit('warTurn',{team,seconds:30,turnIndex:gameState.warCurrentTurn,total:gameState.warTurnOrder.length});
  addLog(`Tour de ${team}`,'event');broadcast();
  warTurnInterval=setInterval(()=>{
    if(gameState.gameOver){clearInterval(warTurnInterval);return;}
    gameState.warTurnSeconds--;io.emit('warTurnTimer',{seconds:gameState.warTurnSeconds,team});
    if(gameState.warTurnSeconds<=0){clearInterval(warTurnInterval);addTeamNews(team,'⏰ Tour passé !','bad');gameState.warCurrentTurn++;advanceWarTurn();}
  },1000);
}
function nextWarTurn(){if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}gameState.warCurrentTurn++;advanceWarTurn();}

io.on('connection',(socket)=>{
  // Send session info immediately so client knows the code
  socket.emit('sessionInfo', { sessionCode: SESSION_CODE, mjPin: null });

  // ── Auth handlers ──────────────────────────────────────────────────────
  socket.on('auth:mj', ({pin}, cb) => {
    if(String(pin) === String(MJ_PIN)) {
      socketRegistry.set(socket.id, { isMJ: true });
      socket.join('mj');
      if(typeof cb==='function') cb({ ok: true });
      socket.emit('state', gameState);
      socket.emit('timer', {seconds:gameState.timerSeconds, running:gameState.timerRunning});
      if(gameState.winners&&gameState.winners.length>0)
        socket.emit('winner', {winners:gameState.winners, type:gameState.winners.length>1?'alliance':'solo'});
    } else {
      if(typeof cb==='function') cb({ ok: false, error: 'PIN incorrect' });
    }
  });

  socket.on('mj:kickTeam',({teamName})=>{
    const team=gameState.teams[teamName];
    if(!team)return;
    if(team.country){
      const c=gameState.countries[team.country];
      if(c){c.team=null;c.eliminated=false;}
      delete gameState.takenCountries[team.country];
    }
    delete gameState.teams[teamName];
    teamSockets.delete(teamName);
    const sid=Array.from(socketRegistry.entries()).find(([k,v])=>v.teamName===teamName)?.[0];
    if(sid){socketRegistry.delete(sid);const s=io.sockets.sockets.get(sid);if(s)s.emit('kicked','Vous avez été retiré de la partie par le MJ.');}
    addLog(`${teamName} retiré — pays libéré`,'event');
    broadcast();
  });

  socket.on('auth:rejoin', ({teamName, sessionCode}, cb) => {
    if(String(sessionCode) !== String(SESSION_CODE)) {
      if(typeof cb==='function') cb({ ok: false, error: 'Code de session invalide' }); return;
    }
    const team = gameState.teams[teamName];
    if(!team) { if(typeof cb==='function') cb({ ok: false, error: 'Équipe introuvable' }); return; }
    // Update socket mapping
    teamSockets.set(teamName, socket.id);
    socketRegistry.set(socket.id, { teamName, countryId: team.country, isMJ: false });
    if(typeof cb==='function') cb({ ok: true, team, countryId: team.country });
    socket.emit('state', gameState);
    socket.emit('timer', {seconds:gameState.timerSeconds, running:gameState.timerRunning});
    if(gameState.winners&&gameState.winners.length>0)
      socket.emit('winner', {winners:gameState.winners, type:gameState.winners.length>1?'alliance':'solo'});
    Object.entries(gameState.pendingAllianceProposals).forEach(([to,p])=>{
      if(p&&p.to===teamName) socket.emit('allianceProposal',p);
    });
  });

  socket.on('disconnect', () => {
    socketRegistry.delete(socket.id);
  });

  Object.entries(gameState.pendingAllianceProposals).forEach(([to,p])=>{if(p)socket.emit('allianceProposal',p);});

  socket.on('mj:startDraft',()=>{
    // Only generate new session code if starting fresh (not re-launching draft after tutorial)
    if(gameState.phase==='setup'||gameState.gameOver){
      SESSION_CODE = generateSessionCode();
      console.log('New session code:', SESSION_CODE);
    }
    io.emit('sessionInfo', { sessionCode: SESSION_CODE });
    // Fresh start — clear all previous session data
    socketRegistry.forEach((v, k) => { if(!v.isMJ) socketRegistry.delete(k); });
    teamSockets.clear();
    initCountries();gameState.phase='draft';gameState.currentPeriod=0;
    gameState.coalition={proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false};
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    gameState.alliances={};gameState.pendingAllianceProposals={};
    gameState.winner=null;gameState.winners=[];gameState.isTutorial=false;gameState.gameOver=false;
    gameState.nextHint=null;gameState.nextEvent=null;
    gameState.periodSequence=generateSequence();
    gameState.prices={...BASE_PRICES};gameState.prevPrices={...BASE_PRICES};gameState.currentPrices={...BASE_PRICES};
    resetServerTimer(600);addLog('Draft démarré','event');broadcast();
  });

  socket.on('mj:startTutorial',()=>{
    gameState.phase='prosperity';gameState.currentPeriod=0;gameState.isTutorial=true;
    gameState.teamActionsThisPeriod={};gameState.tutorialSnapshot={};
    Object.values(gameState.countries).forEach(c=>{if(c.team)gameState.tutorialSnapshot[c.id]={...c};});
    const firstRealEv=gameState.periodSequence[0];
    const hint=firstRealEv?.hint||'Lisez attentivement les indices — ils vous donnent un avantage décisif !';
    gameState.currentEvent={...TUTORIAL_EV,periodName:'Manche Test — Découverte',periodSubtitle:'Tutorial · Ressources remises à zéro après',periodDesc:'Cette manche ne compte pas. Explorez librement: achetez, vendez. Les ressources seront remises à zéro.',periodNumber:0};
    gameState.nextHint=hint;gameState.nextEvent=firstRealEv;
    resetServerTimer(300);
    addLog('Manche Test démarrée (5 min)','event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`🎮 MANCHE TEST — Explorez librement !\n\n🔮 Ce qui va arriver en Période 1:\n${hint}`,'neutral');});
    broadcast();
  });

    socket.on('mj:endTutorial',()=>{
    Object.values(gameState.countries).forEach(c=>{
      const s=gameState.tutorialSnapshot[c.id];
      if(!s)return;
      c.oil=s.oil;c.food=s.food;c.tourism=s.tourism;c.agriculture=s.agriculture;
      c.army=s.army;c.atk=s.atk||0;c.def=s.def||0;c.treasury=s.treasury;
      c.militarySpent=s.militarySpent||0;c.defense=false;c.combatBonus=0;c.power=calcPower(c);
    });
    gameState.isTutorial=false;
    gameState.phase='draft'; // retour au draft — MJ voit "Lancer Période 1 →"
    gameState.currentPeriod=0;
    gameState.currentEvent=null;
    gameState.teamActionsThisPeriod={};
    gameState.lastActionByTeam={};
    gameState.tutorialSnapshot={};
    gameState.prices={...BASE_PRICES};
    gameState.prevPrices={...BASE_PRICES};
    gameState.currentPrices={...BASE_PRICES};
    gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
    addLog('Tutorial terminé — ressources remises à zéro','event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'✅ Tutorial terminé ! La vraie partie commence — attendez le MJ.','neutral');});
    broadcast();
  });

  socket.on('mj:startProsperity',()=>{
    // Restore snapshot: year 1 starts clean as if tutorial never happened
    if(Object.keys(gameState.tutorialSnapshot).length>0){
      Object.values(gameState.countries).forEach(c=>{
        if(gameState.tutorialSnapshot[c.id]){
          const s=gameState.tutorialSnapshot[c.id];
          c.oil=s.oil;c.food=s.food;c.tourism=s.tourism;c.agriculture=s.agriculture;
          c.army=s.army;c.atk=s.atk||0;c.def=s.def||0;c.treasury=s.treasury;
          c.militarySpent=s.militarySpent||0;c.defense=false;c.combatBonus=0;c.power=calcPower(c);
        }
      });
    }
    // Year 1: use BASE_PRICES (no event has happened yet, no price variation)
    gameState.prices={...BASE_PRICES};
    gameState.prevPrices={...BASE_PRICES};
    gameState.currentPrices={...BASE_PRICES};
    gameState.prevEvent=null; // no causal explanation for year 1
    gameState.eventMod={}; // no revenue multipliers carry over from tutorial
    gameState.phase='prosperity';gameState.currentPeriod=1;gameState.isTutorial=false;
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    const p=PERIODS[0];const ev=gameState.periodSequence[0]||weightedRandom(EVENTS);
    // Prices for period 1 = BASE (no event applied yet — event announced here, effects in period 2)
    gameState.prevPrices={...BASE_PRICES};
    gameState.currentPrices={...BASE_PRICES};
    gameState.prices={...BASE_PRICES};
    gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[0],periodNumber:1};
    gameState.pendingChoiceEvent=null;
    // DO NOT applyEvent here — period 1 event is announced only, effects apply in period 2
    if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    const nev=gameState.periodSequence[1];
    gameState.nextEvent=nev||null;
    gameState.nextHint=nev?.hint||null;
    // Pre-set prices for NEXT period based on next event
    const nextPrices=previewNextPrices(gameState.prices,nev);
    gameState.currentEvent.nextPrices=nextPrices;
    gameState.currentEvent.nextHint=gameState.nextHint;
    resetServerTimer(600);addLog(`Période 1 — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`📅 Période 1 — ${p.name}\n${PERIOD_DESCS[0]}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}\n\n🔮 Ce qui va arriver en Période 2:\n${gameState.nextHint||'(aucun indice)'}`, 'neutral');});
    broadcast();
  });

  socket.on('mj:nextPeriod',()=>{
    if(gameState.currentPeriod>=6)return;
    // Prices for this new period = prices announced by PREVIOUS event
    // Event announced last period = periodSequence[currentPeriod-1] (0-based)
    // e.g. from period 1 (currentPeriod=1): periodSequence[0] = real year-1 event
    const thisEv=gameState.periodSequence[gameState.currentPeriod-1];
    gameState.prevPrices={...gameState.prices};
    // prevEvent = the real event taking effect NOW (explains why prices changed)
    gameState.prevEvent = thisEv || null;
    // Step 1: mean-revert current prices toward base
    const reverted = meanRevertPrices(gameState.currentPrices || gameState.prices);
    // Step 2: apply THIS period's event multipliers to reverted prices (cumulative)
    const newPrices = applyEventMultipliers(reverted, thisEv);
    gameState.currentPrices = {...newPrices};
    gameState.prices = {...newPrices};
    applyPeriodTransition();
    gameState.currentPeriod++;
    const p=PERIODS[gameState.currentPeriod-1];const ev=thisEv||weightedRandom(EVENTS);
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[gameState.currentPeriod-1],periodNumber:gameState.currentPeriod};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='market'||ev.type==='targeted')applyEvent(ev);
    else if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    // Next event to announce = periodSequence[currentPeriod-1] (after increment, currentPeriod is already N+1)
    const nev=gameState.periodSequence[gameState.currentPeriod-1];
    gameState.nextEvent=nev||null;
    const nextPrices=gameState.currentPeriod<6?previewNextPrices(gameState.prices, nev):{...BASE_PRICES};
    gameState.nextHint=gameState.currentPeriod<6?(nev?.hint||null):'⚔️ La GUERRE commence après cette période. Une phase de négociation aura lieu pour former des alliances. Gardez au moins 600 or.';
    gameState.currentEvent.nextPrices=nextPrices;
    gameState.currentEvent.nextHint=gameState.nextHint;
    resetServerTimer(600);addLog(`Période ${gameState.currentPeriod} — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`📅 Période ${gameState.currentPeriod} — ${p.name}\n${PERIOD_DESCS[gameState.currentPeriod-1]}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}\n\n🔮 Ce qui va arriver ensuite:\n${gameState.nextHint||'(aucun indice)'}`,'neutral');});
    broadcast();
  });

  // Phase de négociation (entre prospérité et guerre)
  socket.on('mj:startNegotiation',()=>{
    gameState.phase='negotiation';
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    gameState.alliances={};gameState.pendingAllianceProposals={};
    const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated).sort((a,b)=>b.power-a.power);
    const N=alive.length;
    gameState.negotiationRanking=alive.map((c,i)=>({rank:i+1,id:c.id,flag:c.flag,name:c.name,power:c.power,team:c.team,tier:c.tier,atk:c.atk||0,def:c.def||0,army:c.army,treasury:c.treasury}));
    addLog('Phase de negociation','event');
    alive.forEach((c,i)=>{
      const myRank=i+1;
      const canProposeTo=alive.slice(N-myRank).map(cc=>cc.flag+' '+cc.name).join(', ');
      addTeamNews(c.team,'NEGOCIATION rang '+myRank+'/'+N+' — alliance possible avec : '+canProposeTo,'neutral');
    });
    broadcast();
  });


  socket.on('mj:startWar',()=>{
    gameState.phase='war';gameState.currentEvent=null;gameState.pendingChoiceEvent=null;
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    gameState.pendingAllianceProposals={};
    gameState.coalition={proposed:true,moroccoAccepted:false,guineaAccepted:false,active:false};
    resetServerTimer(600);addLog('⚔️ GUERRE MONDIALE DÉMARRÉE','attack');
    if(gameState.countries.morocco?.team)addTeamNews(gameState.countries.morocco.team,'🤝 Coalition africaine proposée avec l\'Afrique du Sud !','neutral');
    if(gameState.countries.southafrica?.team)addTeamNews(gameState.countries.southafrica.team,'🤝 Coalition africaine proposée avec le Maroc !','neutral');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'⚔️ GUERRE ! Aucun achat. Attendez votre tour. Attaque = 150 or / 200 pétrole / 300 nourriture.','bad');});
    broadcast();setTimeout(()=>startWarTurn(),3000);
  });

  socket.on('mj:timerStart',({seconds})=>startServerTimer(seconds||gameState.timerSeconds));
  socket.on('mj:timerPause',()=>pauseServerTimer());
  socket.on('mj:timerReset',({seconds})=>resetServerTimer(seconds));
  socket.on('mj:nextWarTurn',()=>nextWarTurn());
  socket.on('mj:startWarTurns',()=>startWarTurn());

  socket.on('team:choiceResponse',({teamName,choice})=>{
    const ev=gameState.pendingChoiceEvent;if(!ev)return;
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    const chosen=choice==='A'?ev.choiceA:ev.choiceB;
    if(chosen.cost){
      if(chosen.cost.treasury&&c.treasury<chosen.cost.treasury){socket.emit('error',`Pas assez d'or ! (${chosen.cost.treasury} requis)`);return;}
      if(chosen.cost.oil&&c.oil<chosen.cost.oil){socket.emit('error',`Pas assez de pétrole ! (${chosen.cost.oil} requis)`);return;}
      if(chosen.cost.food&&c.food<chosen.cost.food){socket.emit('error',`Pas assez de nourriture ! (${chosen.cost.food} requis)`);return;}
      if(chosen.cost.treasury)c.treasury-=chosen.cost.treasury;
      if(chosen.cost.oil)c.oil-=chosen.cost.oil;
      if(chosen.cost.food)c.food-=chosen.cost.food;
    }
    let msg='';
    if(chosen.gain){
      if(chosen.gain.army){c.army+=chosen.gain.army;msg+=`+${chosen.gain.army} armée `;}
      if(chosen.gain.power){c.power+=chosen.gain.power;msg+=`+${chosen.gain.power} pts `;}
      if(chosen.gain.powerLoss){c.power=Math.max(0,c.power-chosen.gain.powerLoss);msg+=`−${chosen.gain.powerLoss} pts `;}
      if(chosen.gain.defense){c.defense=true;msg+=`+défense `;}
      if(chosen.gain.combatBonus){c.combatBonus=(c.combatBonus||0)+chosen.gain.combatBonus;msg+=`+${Math.round(chosen.gain.combatBonus*100)}% combat `;}
      if(chosen.gain.goldPenalty){const penalty=Math.round(c.treasury*chosen.gain.goldPenalty);c.treasury=Math.max(0,c.treasury-penalty);msg+=`−${penalty} or (pénalité) `;}
      if(chosen.gain.gamble){
        if(chosen.gain.goldLoss){
          if(Math.random()<0.5){const gL=chosen.gain.goldLoss;c.treasury=Math.max(0,c.treasury-gL);c.power=Math.max(0,c.power-(chosen.gain.powerLoss||0));msg+=`DÉCOUVERT: −${gL} or −${chosen.gain.powerLoss||0} pts `;}
          else{msg+=`Non découvert (chance !) `;}
        } else {
          if(Math.random()<0.5){c.power=Math.max(0,c.power-(chosen.gain.powerLoss||0));msg+=`DÉCOUVERT: −${chosen.gain.powerLoss||0} pts `;}
          else{msg+=`Non découvert (chance !) `;}
        }
      }
    }
    c.power=calcPower(c);
    addTeamNews(teamName,`✅ Choix "${chosen.label}": ${msg}`,'good');
    addLog(`${c.flag} choisit: ${chosen.label}`,'event');broadcast();
  });

  socket.on('team:undoAction',({teamName})=>{
    if(gameState.phase==='war'){socket.emit('error','Impossible d\'annuler en guerre !');return;}
    const last=gameState.lastActionByTeam[teamName];if(!last){socket.emit('error','Aucune action à annuler !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    c.treasury=last.treasury;c.oil=last.oil;c.food=last.food;c.tourism=last.tourism;c.agriculture=last.agriculture;c.army=last.army;c.atk=last.atk||0;c.def=last.def||0;c.militarySpent=last.militarySpent||0;c.power=calcPower(c);
    const actions=gameState.teamActionsThisPeriod[teamName]||0;
    if(actions>0)gameState.teamActionsThisPeriod[teamName]=actions-1;
    gameState.lastActionByTeam[teamName]=null;
    addTeamNews(teamName,'↩️ Dernière action annulée','neutral');
    socket.emit('actionUndone');broadcast();
  });

  socket.on('team:proposeAlliance',({fromTeam,toTeam,allianceType,targetId})=>{
    if(gameState.phase!=='war'&&gameState.phase!=='negotiation'){socket.emit('error','Alliances disponibles en phase de négociation ou guerre !');return;}
    const cost=allianceType==='offensive'?100:0;
    const team=gameState.teams[fromTeam];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    const fromCountry=Object.values(gameState.countries).find(cc=>cc.team===fromTeam);
    // Bloquer si l'un ou l'autre a déjà une alliance active
    if(gameState.alliances[fromTeam]){socket.emit('error','Vous avez déjà une alliance active — impossible d\'en proposer une autre !');return;}
    if(gameState.alliances[toTeam]){const tc=Object.values(gameState.countries).find(cc=>cc.team===toTeam);socket.emit('error',`${tc?.name||toTeam} a déjà une alliance active !`);return;}
    // Bloquer si la cible a déjà une proposition en attente
    if(gameState.pendingAllianceProposals[toTeam]){socket.emit('error','Cette nation a déjà une proposition d\'alliance en attente !');return;}
    if(gameState.phase==='negotiation'){
      const aliveN=Object.values(gameState.countries).filter(cc=>cc.team&&!cc.eliminated).sort((a,b)=>b.power-a.power);
      const NN=aliveN.length;
      const fromRank=aliveN.findIndex(cc=>cc.team===fromTeam)+1;
      const toRank=aliveN.findIndex(cc=>cc.team===toTeam)+1;
      const minAllowedRank=NN-fromRank+1;
      if(toRank<minAllowedRank){
        const canTo=aliveN.slice(NN-fromRank).map(cc=>cc.flag+' '+cc.name).join(', ');
        socket.emit('error','Rang '+fromRank+'/'+NN+' — alliance uniquement possible avec : '+canTo);return;
      }
    }
    if(cost>0&&c.treasury<cost){socket.emit('error','Pas assez d\'or !');return;}
    const proposal={from:fromTeam,fromCountry:fromCountry?{flag:fromCountry.flag,name:fromCountry.name}:null,to:toTeam,type:allianceType,cost,targetId:targetId||null,expires:Date.now()+30000};
    gameState.pendingAllianceProposals[toTeam]=proposal;
    io.emit('allianceProposal',proposal);
    const toCountry=Object.values(gameState.countries).find(cc=>cc.team===toTeam);
    addTeamNews(toTeam,`🤝 ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam} vous propose une alliance ${allianceType==='offensive'?'offensive (+15% combat)':'de non-agression'}. Répondez !`,'neutral');
    setTimeout(()=>{if(gameState.pendingAllianceProposals[toTeam]===proposal){delete gameState.pendingAllianceProposals[toTeam];io.emit('allianceExpired',{to:toTeam});addTeamNews(fromTeam,`❌ Alliance avec ${toCountry?.name||toTeam} — pas de réponse`,'bad');}},30000);
  });

  socket.on('team:respondAlliance',({fromTeam,toTeam,accepted,allianceType,targetId})=>{
    // Save proposer's targetId before deleting proposal
    const proposerTargetId=gameState.pendingAllianceProposals[toTeam]?.targetId||null;
    delete gameState.pendingAllianceProposals[toTeam];
    const fromCountry=Object.values(gameState.countries).find(c=>c.team===fromTeam);
    const toCountry=Object.values(gameState.countries).find(c=>c.team===toTeam);
    if(!accepted){
      addTeamNews(fromTeam,`❌ Alliance refusée par ${toCountry?.flag||''} ${toCountry?.name||toTeam}`,'bad');
      io.emit('allianceExpired',{to:toTeam});broadcast();return;
    }
    // Vérifier qu'aucun des deux n'a d'alliance entre temps (race condition)
    if(gameState.alliances[fromTeam]||gameState.alliances[toTeam]){
      const blocker=gameState.alliances[fromTeam]?fromCountry:toCountry;
      addTeamNews(toTeam,`❌ Alliance impossible — ${blocker?.name||'un pays'} a déjà une alliance active`,'bad');
      addTeamNews(fromTeam,`❌ Alliance annulée — ${blocker?.name||'un pays'} a déjà une alliance active`,'bad');
      io.emit('allianceExpired',{to:toTeam});broadcast();return;
    }
    // Notify proposer that alliance was accepted
    const fromSocket=teamSockets.get(fromTeam);
    const fromSock=fromSocket?io.sockets.sockets.get(fromSocket):null;
    if(fromSock)fromSock.emit('allianceAccepted',{by:toTeam,byCountry:toCountry?{flag:toCountry.flag,name:toCountry.name}:null,type:allianceType});
    addTeamNews(fromTeam,`✅ Alliance ${allianceType==='offensive'?'offensive':'de non-agression'} ACCEPTÉE par ${toCountry?.flag||''} ${toCountry?.name||toTeam} !`,'good');
    addTeamNews(toTeam,`✅ Alliance ${allianceType==='offensive'?'offensive':'de non-agression'} confirmée avec ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam}`,'good');
    const cost=allianceType==='offensive'?100:0;
    const propTeam=gameState.teams[fromTeam];if(propTeam?.country){const pc=gameState.countries[propTeam.country];if(cost>0)pc.treasury=Math.max(0,pc.treasury-cost);}
    const turnIdx=gameState.warCurrentTurn;
    // proposerTargetId = target chosen by the proposer (fromTeam)
    // targetId = target chosen by the receiver (toTeam) — sent in response
    const receiverTargetId=targetId||proposerTargetId||null; // fallback to same target if receiver didn't specify
    // Each team's targetId = their own chosen target for the offensive bonus
    gameState.alliances[fromTeam]={type:allianceType,with:toTeam,withCountryName:toCountry?.name||toTeam,withCountryFlag:toCountry?.flag||'',targetId:proposerTargetId,expires:turnIdx+(gameState.warTurnOrder.length||10)};
    gameState.alliances[toTeam]  ={type:allianceType,with:fromTeam,withCountryName:fromCountry?.name||fromTeam,withCountryFlag:fromCountry?.flag||'',targetId:receiverTargetId,expires:turnIdx+(gameState.warTurnOrder.length||10)};
    addTeamNews(fromTeam,`✅ Alliance ${allianceType} avec ${toCountry?.flag||''} ${toCountry?.name||toTeam} !`,'good');
    addTeamNews(toTeam,`✅ Alliance ${allianceType} avec ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam} !`,'good');
    addLog(`🤝 Alliance ${allianceType}: ${fromCountry?.flag||''} ${fromCountry?.name} & ${toCountry?.flag||''} ${toCountry?.name}`,'event');
    broadcast();checkWinner();
  });

  socket.on('team:acceptCoalition',({teamName})=>{
    const c=Object.values(gameState.countries).find(c=>c.team===teamName);if(!c)return;
    if(c.id==='morocco')gameState.coalition.moroccoAccepted=true;
    if(c.id==='southafrica')gameState.coalition.guineaAccepted=true;
    if(gameState.coalition.moroccoAccepted&&gameState.coalition.guineaAccepted){
      gameState.coalition.active=true;
      const m=gameState.countries.morocco,s=gameState.countries.southafrica;
      if(m&&s){const bG=Math.round(s.treasury*0.25),bO=Math.round(s.oil*0.25),bF=Math.round(s.food*0.25),bA=Math.round(s.army*0.25);m.treasury+=bG;m.oil+=bO;m.food+=bF;m.army+=bA;m.power=calcPower(m);s.power=calcPower(s);addLog('🤝 Coalition Maroc-Afrique du Sud active !','event');}
    } else addTeamNews(teamName,"✅ Accepté — en attente...",'neutral');
    broadcast();
  });
  socket.on('team:refuseCoalition',({teamName})=>{gameState.coalition.proposed=false;broadcast();});

  socket.on('team:declareAttack',({teamName,targetId,payWith})=>{
    if(gameState.phase!=='war'){socket.emit('error',"Pas encore en guerre !");return;}
    if(gameState.gameOver){socket.emit('error','La partie est terminée !');return;}
    if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName){socket.emit('error',"Ce n\'est pas votre tour !");return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const att=gameState.countries[team.country];const def=gameState.countries[targetId];
    if(!att||!def||att.eliminated||def.eliminated)return;
    const myAlliance=gameState.alliances[teamName];
    if(myAlliance&&myAlliance.type==='peace'&&myAlliance.with===def.team){socket.emit('error','Pacte de non-agression actif — attaque impossible !');return;}
    const costs={gold:150,oil:200,food:300};const pr=payWith||'gold';
    const cost=costs[pr]||150;const rk=pr==='gold'?'treasury':pr;
    let armyPenalty=0;
    if(att[rk]<cost){
      if(pr!=='gold'){socket.emit('error',`Pas assez de ${pr} ! (${cost} requis)`);return;}
      armyPenalty=Math.max(5,Math.round((att.army||0)*0.10));
      if((att.army||0)<5){socket.emit('error','Pas assez de ressources pour attaquer !');return;}
      addTeamNews(teamName,'Attaque sans or — sacrifice de '+armyPenalty+' soldats','bad');
    } else { att[rk]-=cost; }
    if(armyPenalty>0){att.army=Math.max(0,(att.army||0)-armyPenalty);}
    att.power=calcPower(att);
    const offBonus=(myAlliance&&myAlliance.type==='offensive'&&(!myAlliance.targetId||myAlliance.targetId===targetId))?0.15:0;
    if(offBonus>0)att.combatBonus=(att.combatBonus||0)+offBonus;
    const result=resolveCombat(att,def);
    const losses = calcCombatLosses(result.attackerWins, result.margin, att.army, def.army);
    const lA = result.attackerWins ? losses.winnerLoss : losses.loserLoss;
    const lD = result.attackerWins ? losses.loserLoss  : losses.winnerLoss;
    if(result.attackerWins){
      att.treasury+=def.treasury;att.oil+=def.oil;att.food+=def.food;att.army+=def.army;
      att.tourism+=Math.round(def.tourism*0.5);att.agriculture+=Math.round(def.agriculture*0.5);
      att.atk+=Math.round((def.atk||0)*0.3);att.def+=Math.round((def.def||0)*0.3);
      att.militarySpent=(att.militarySpent||0)+Math.round((def.militarySpent||0)*0.3);
      att.army=Math.max(0,att.army-lA);
      def.treasury=0;def.oil=0;def.food=0;def.army=0;def.tourism=0;def.agriculture=0;def.atk=0;def.def=0;def.militarySpent=0;
      att.power=calcPower(att);def.power=calcPower(def);
      addLog(`💥 ${att.flag} écrase ${def.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`🏆 VICTOIRE vs ${def.flag} ${def.name} ! Toutes ressources pillées. −${lA} armée`,'good');
      addTeamNews(def.team,`💀 DÉFAITE vs ${att.flag} ${att.name} — tout pillé. −${lD} armée`,'bad');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:true,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
      if(def.army<=0&&def.treasury<=0){def.eliminated=true;addLog(`☠️ ${def.flag} ${def.name} éliminé !`,'eliminated');addTeamNews(def.team,'☠️ Nation anéantie.','bad');}
    } else {
      const gL=Math.round(att.treasury*0.35);att.treasury=Math.max(0,att.treasury-gL);
      att.army=Math.max(0,att.army-lA);def.army=Math.max(0,def.army-lD);
      att.power=calcPower(att);def.power=calcPower(def);
      addLog(`🛡️ ${def.flag} repousse ${att.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`❌ Échec vs ${def.flag} ${def.name} — −${gL} or, −${lA} armée`,'bad');
      addTeamNews(def.team,`🛡️ Repoussé ${att.flag} ! −${lD} armée pertes défensives`,'good');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:false,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
    }
    // Supprimer uniquement l'alliance offensive après usage (pas le pacte de non-agression)
    if(gameState.alliances[teamName]?.type==='offensive'){
      delete gameState.alliances[teamName];
    }
    broadcast();checkWinner();
    if(!gameState.gameOver)setTimeout(()=>nextWarTurn(),2000);
  });

  socket.on('team:skipTurn',({teamName})=>{if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName)return;addTeamNews(teamName,'Tour passé.','neutral');nextWarTurn();broadcast();checkWinner();});

  socket.on('team:buyResource',({teamName,resource,qty})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun achat en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    if(resource==='oil'&&!gameState.isTutorial&&(gameState.eventMod.blockOilBelowPower||0)>0&&c.power<gameState.eventMod.blockOilBelowPower){socket.emit('error','Achat pétrole bloqué (boom actif) !');return;}
    const price=gameState.prices[resource]||80;const total=price*qty;
    if(c.treasury<total){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c.treasury-=total;c[resource]+=qty;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`✅ Achat: +${qty} ${resource} pour ${total} or${gameState.isTutorial?' (tutorial)':''}`,'good');
    socket.emit('actionFeedback',{type:'buy',resource,qty,total});broadcast();
  });

  socket.on('team:sellResource',({teamName,resource,qty})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucune vente en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(c[resource]<qty){socket.emit('error','Stock insuffisant !');return;}
    const price=gameState.prices[resource]||80;const total=price*qty;
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c[resource]-=qty;c.treasury+=total;c.power=calcPower(c);
    addTeamNews(teamName,`💰 Vente: −${qty} ${resource} → +${total} or`,'good');
    socket.emit('actionFeedback',{type:'sell',resource,qty,total});broadcast();
  });

  socket.on('team:recruitArmy',({teamName,qty,type})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun recrutement en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(gameState.currentPeriod<5&&!gameState.isTutorial){socket.emit('error','L\'armée est disponible à partir de la manche 5 !');return;}
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    const costPer=type==='tech'?300:150;const armyPer=type==='tech'?0:1;
    const cost=Math.round(costPer*qty);if(c.treasury<cost){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c.treasury-=cost;c.army+=qty*armyPer;
    if(type==='tech')c.atk=(c.atk||0)+Math.round(qty*0.5); // tech gives ATK bonus
    c.militarySpent=(c.militarySpent||0)+cost;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`✅ Recrutement: +${qty*armyPer} armée / ${type==='tech'?`+${Math.round(qty*0.5)} ATK`:''} pour ${cost} or${gameState.isTutorial?' (tutorial)':''}`,'good');
    socket.emit('actionFeedback',{type:'army',qty:qty*armyPer,total:cost});broadcast();
  });

  // Buy ATK (offensive multiplier) — available from period 4
  socket.on('team:buyAtk',({teamName,qty})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun achat en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(gameState.currentPeriod<5&&!gameState.isTutorial){socket.emit('error','L\'investissement militaire est disponible à partir de la manche 5 !');return;}
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    const cost=qty*200; // 200 or per ATK point
    if(c.treasury<cost){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c.treasury-=cost;c.atk=(c.atk||0)+qty;c.militarySpent=(c.militarySpent||0)+cost;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`⚔️ Investissement offensif: +${qty} ATK pour ${cost} or`,'good');
    socket.emit('actionFeedback',{type:'atk',qty,total:cost});broadcast();
  });

  // Buy DEF (defensive multiplier) — available from period 4
  socket.on('team:buyDef',({teamName,qty})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun achat en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(gameState.currentPeriod<5&&!gameState.isTutorial){socket.emit('error','L\'investissement militaire est disponible à partir de la manche 5 !');return;}
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    const cost=qty*200; // 200 or per DEF point
    if(c.treasury<cost){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c.treasury-=cost;c.def=(c.def||0)+qty;c.militarySpent=(c.militarySpent||0)+cost;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`🛡️ Investissement défensif: +${qty} DEF pour ${cost} or`,'good');
    socket.emit('actionFeedback',{type:'def',qty,total:cost});broadcast();
  });

  socket.on('team:buyDefense',({teamName})=>{
    // Kept for backward compat but now only available manches 4+
    if(gameState.phase==='war'){socket.emit('error','Aucun achat en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(gameState.currentPeriod<5&&!gameState.isTutorial){socket.emit('error','Disponible à partir de la manche 5 !');return;}
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    if(c.treasury<200){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c.treasury-=200;c.def=(c.def||0)+5; // bunker = +5 DEF points
    c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,'🛡️ Bunker: +5 DEF pour 200 or (valable ce tour seulement si guerre)','good');
    socket.emit('actionFeedback',{type:'defense',total:200});broadcast();
  });

  socket.on('mj:eliminate',({countryId})=>{const c=gameState.countries[countryId];if(!c)return;c.eliminated=true;addLog(`☠️ ${c.flag} éliminé !`,'eliminated');addTeamNews(c.team,'Votre nation a été conquise.','bad');broadcast();checkWinner();});
  socket.on('mj:bonus',({countryId,amount})=>{const c=gameState.countries[countryId];if(!c)return;c.treasury+=amount;c.power=calcPower(c);addLog(`${amount>0?'+':''}${amount} or → ${c.flag}`,amount>0?'economy':'attack');broadcast();});
  socket.on('mj:reset',()=>{
    SESSION_CODE = generateSessionCode();
    console.log('Session reset, new code:', SESSION_CODE);
    io.emit('sessionInfo', { sessionCode: SESSION_CODE });
    // Clean up all session data — no stale entries accumulate
    socketRegistry.clear();
    teamSockets.clear();
    if(timerInterval)clearInterval(timerInterval);if(warTurnInterval)clearInterval(warTurnInterval);timerInterval=null;warTurnInterval=null;
    gameState={phase:'setup',currentPeriod:0,currentEvent:null,nextEvent:null,nextHint:null,periodSequence:[],countries:{},takenCountries:{},teams:{},prices:{...BASE_PRICES},prevPrices:{...BASE_PRICES},currentPrices:{...BASE_PRICES},eventMod:{oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0},coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},alliances:{},pendingAllianceProposals:{},log:[],timerSeconds:600,timerRunning:false,warTurnOrder:[],warCurrentTurn:0,warTurnSeconds:30,teamActionsThisPeriod:{},lastActionByTeam:{},pendingChoiceEvent:null,winner:null,winners:[],isTutorial:false,tutorialSnapshot:{},gameOver:false,negotiationRanking:[]};
    broadcast();io.emit('timer',{seconds:600,running:false});
  });
  socket.on('team:join',({teamName, sessionCode}, cb)=>{
    if(String(sessionCode) !== String(SESSION_CODE)){
      if(typeof cb==='function') cb({ok:false,error:'Code de session invalide. Demandez le bon code au MJ.'});return;
    }
    if(gameState.phase!=='draft'){if(typeof cb==='function') cb({ok:false,error:'La partie est déjà en cours — impossible de rejoindre maintenant.'});return;}
    if(gameState.teams[teamName]){
      if(typeof cb==='function') cb({ok:false,error:'Ce nom est déjà pris. Choisissez un autre nom.'});return;
    }
    gameState.teams[teamName]={country:null,news:[]};
    teamSockets.set(teamName, socket.id);
    socketRegistry.set(socket.id, {teamName, countryId:null, isMJ:false});
    if(typeof cb==='function') cb({ok:true});
    broadcast();
  });
  socket.on('team:draftCountry',({teamName,countryId})=>{if(gameState.phase!=='draft'){socket.emit('error','Le draft est terminé.');return;}if(gameState.takenCountries[countryId]){socket.emit('error','Déjà pris !');return;}gameState.takenCountries[countryId]=teamName;gameState.teams[teamName].country=countryId;gameState.countries[countryId].team=teamName;addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} → ${teamName}`,'event');broadcast();});
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Geopolitica running on port ${PORT}`));
