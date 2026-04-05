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

// ─── SESSION ──────────────────────────────────────────────────────────────
const MJ_PIN = process.env.MJ_PIN || String(Math.floor(1000 + Math.random() * 9000));
console.log('MJ PIN this session:', MJ_PIN);

let SESSION_CODE = generateSessionCode();
function generateSessionCode() {
  return Math.random().toString(36).substring(2,5).toUpperCase() +
         Math.random().toString(36).substring(2,5).toUpperCase();
}
const socketRegistry = new Map();
const teamSockets = new Map();

app.get('/session-info', (req, res) => {
  res.json({ sessionCode: SESSION_CODE, phase: gameState.phase });
});

// ─── COUNTRIES ───────────────────────────────────────────────────────────
const COUNTRIES = [
  // ── TIER S — Superpuissances ──────────────────────────────────────────
  { id:'usa',        flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:900, oil:200, food:250, tourism:200, agriculture:120, army:320, atk:0, def:0, militarySpent:0, population:330 },
  { id:'china',      flag:'🇨🇳', name:'Chine',        tier:'S', gold:850, oil:250, food:250, tourism:120, agriculture:180, army:290, atk:0, def:0, militarySpent:0, population:1400 },
  // ── TIER A — Puissances majeures ─────────────────────────────────────
  { id:'russia',     flag:'🇷🇺', name:'Russie',       tier:'A', gold:550, oil:520, food:170, tourism:60,  agriculture:90,  army:260, atk:0, def:0, militarySpent:0, population:145 },
  { id:'germany',    flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:650, oil:100, food:110, tourism:220, agriculture:130, army:220, atk:0, def:0, militarySpent:0, population:83 },
  { id:'qatar',      flag:'🇶🇦', name:'Qatar',        tier:'A', gold:720, oil:400, food:50,  tourism:250, agriculture:20,  army:170, atk:0, def:0, militarySpent:0, population:3 },
  { id:'france',     flag:'🇫🇷', name:'France',       tier:'A', gold:600, oil:80,  food:95, tourism:280, agriculture:160, army:215, atk:0, def:0, militarySpent:0, population:68 },
  { id:'japan',      flag:'🇯🇵', name:'Japon',        tier:'A', gold:700, oil:60,  food:150, tourism:300, agriculture:100, army:190, atk:0, def:0, militarySpent:0, population:125 },
  { id:'turkey',     flag:'🇹🇷', name:'Turquie',      tier:'A', gold:480, oil:120, food:110, tourism:200, agriculture:150, army:245, atk:0, def:0, militarySpent:0, population:85 },
  { id:'australia',  flag:'🇦🇺', name:'Australie',    tier:'A', gold:550, oil:200, food:50, tourism:180, agriculture:200, army:180, atk:0, def:0, militarySpent:0, population:26 },
  { id:'saudi',      flag:'🇸🇦', name:'Arabie S.',    tier:'A', gold:700, oil:600, food:60,  tourism:120, agriculture:20,  army:190, atk:0, def:0, militarySpent:0, population:35 },
  { id:'uk',         flag:'🇬🇧', name:'Royaume-Uni',  tier:'A', gold:640, oil:90,  food:90, tourism:260, agriculture:110, army:200, atk:0, def:0, militarySpent:0, population:67 },
  { id:'canada',     flag:'🇨🇦', name:'Canada',       tier:'A', gold:580, oil:280, food:65, tourism:200, agriculture:220, army:185, atk:0, def:0, militarySpent:0, population:38 },
  { id:'singapore',  flag:'🇸🇬', name:'Singapour',   tier:'A', gold:680, oil:30,  food:50,  tourism:320, agriculture:10,  army:140, atk:0, def:0, militarySpent:0, population:6 },
  // ── TIER B — Émergents (+15% en combat) ──────────────────────────────
  { id:'brazil',     flag:'🇧🇷', name:'Brésil',       tier:'B', gold:420, oil:160, food:240, tourism:90,  agriculture:260, army:160, atk:0, def:0, militarySpent:0, population:215 },
  { id:'india',      flag:'🇮🇳', name:'Inde',         tier:'B', gold:400, oil:100, food:250, tourism:130, agriculture:210, army:180, atk:0, def:0, militarySpent:0, population:1400 },
  { id:'mexico',     flag:'🇲🇽', name:'Mexique',      tier:'B', gold:360, oil:180, food:155, tourism:160, agriculture:180, army:150, atk:0, def:0, militarySpent:0, population:130 },
  { id:'morocco',    flag:'🇲🇦', name:'Maroc',        tier:'B', gold:300, oil:60,  food:60, tourism:170, agriculture:190, army:135, atk:0, def:0, militarySpent:0, population:37 },
  { id:'guinea',flag:'🇬🇳', name:'Guinée',   tier:'B', gold:320, oil:80,  food:85, tourism:140, agriculture:170, army:140, atk:0, def:0, militarySpent:0, population:60 },
  { id:'belgium',    flag:'🇧🇪', name:'Belgique',     tier:'A', gold:390, oil:40,  food:50, tourism:190, agriculture:120, army:130, atk:0, def:0, militarySpent:0, population:12 },
  { id:'algeria',    flag:'🇩🇿', name:'Algérie',      tier:'B', gold:310, oil:340, food:70, tourism:80,  agriculture:160, army:145, atk:0, def:0, militarySpent:0, population:45 },
  { id:'argentina',  flag:'🇦🇷', name:'Argentine',    tier:'B', gold:340, oil:140, food:70, tourism:100, agriculture:280, army:145, atk:0, def:0, militarySpent:0, population:46 },
  { id:'colombia',   flag:'🇨🇴', name:'Colombie',     tier:'B', gold:300, oil:120, food:75, tourism:130, agriculture:230, army:135, atk:0, def:0, militarySpent:0, population:51 },
  { id:'niger',      flag:'🇳🇪', name:'Niger',        tier:'B', gold:180, oil:80,  food:50, tourism:30,  agriculture:200, army:90,  atk:0, def:0, militarySpent:0, population:25 },
  { id:'thailand',   flag:'🇹🇭', name:'Thaïlande',   tier:'B', gold:360, oil:60,  food:95, tourism:240, agriculture:220, army:145, atk:0, def:0, militarySpent:0, population:70 },
  { id:'pakistan',   flag:'🇵🇰', name:'Pakistan',     tier:'B', gold:240, oil:70,  food:250, tourism:50,  agriculture:200, army:160, atk:0, def:0, militarySpent:0, population:230 },
];

function getFoodConsumption(c) { return Math.max(10, Math.min(50, Math.round(c.population / 5 + 5))); }

const BASE_PRICES = { oil:80, food:40, tourism:120, agriculture:60 };
const MEAN_REVERT_STRENGTH = 1/3;

function meanRevertPrices(current) {
  const out = {};
  for (const r of ['oil','food','tourism','agriculture']) {
    out[r] = Math.round(current[r] + (BASE_PRICES[r] - current[r]) * MEAN_REVERT_STRENGTH);
  }
  return out;
}
function applyEventMultipliers(current, ev) {
  if (!ev) return { ...current };
  return {
    oil:         Math.round(current.oil         * (ev.priceOil      || 1)),
    food:        Math.round(current.food        * (ev.priceFood     || 1)),
    tourism:     Math.round(current.tourism     * (ev.priceTourism  || 1)),
    agriculture: Math.round(current.agriculture * (ev.priceAgri     || 1)),
  };
}
// ─── Génère l'explication causale d'un event avec les vraies variations de prix ──────
function buildEventExplanation(ev, prevPrices, newPrices) {
  if (!ev || !prevPrices || !newPrices) return '';
  const NAMES = {oil:'Pétrole', food:'Nourriture', tourism:'Tourisme', agriculture:'Agriculture'};
  const ICONS = {oil:'🛢️', food:'🌾', tourism:'🏖️', agriculture:'🌿'};
  // Causal explanation from event
  let txt = ev.causalExplanation || ev.desc || '';
  // Price changes
  const changes = [];
  for (const r of ['oil','food','tourism','agriculture']) {
    const prev = prevPrices[r] || 0;
    const next = newPrices[r] || 0;
    if (prev === 0) continue;
    const pct = Math.round((next - prev) / prev * 100);
    if (Math.abs(pct) >= 5) {
      changes.push(ICONS[r] + ' ' + NAMES[r] + ' : ' + prev + ' → ' + next + ' or (' + (pct > 0 ? '+' : '') + pct + '%)');
    } else {
      changes.push(ICONS[r] + ' ' + NAMES[r] + ' : ' + next + ' or (stable)');
    }
  }
  if (changes.length > 0) {
    txt += '\n\nImpact sur les prix :\n' + changes.join('\n');
  }
  return txt;
}

// Simule les prix qui seront actifs à la PROCHAINE période.
// Formule réelle du moteur : meanRevert(currentPrices) × multiplicateurs de l'event COURANT (qui se termine)
// currentEv = event actuel qui va produire ses effets de prix au prochain changement de période
function previewNextPrices(currentPrices, currentEv) {
  const reverted = meanRevertPrices(currentPrices);
  return applyEventMultipliers(reverted, currentEv);
}
function getPassiveIncome(c, mod) {
  const oilInc  = Math.round((c.oil||0)        * 25 * (mod.oilMultiplier     || 1));
  const tourInc = Math.round((c.tourism||0)     * 25 * (mod.tourismMultiplier || 1));
  const agriInc = Math.round((c.agriculture||0) * 20 * (mod.agriMultiplier   || 1));
  const baseInc = Math.round((80 + Math.random()*60 + c.population*0.04) * (mod.baseMultiplier || 1));
  return { oilInc, tourInc, agriInc, baseInc, total: oilInc+tourInc+agriInc+baseInc };
}
function resolveCombat(att, def) {
  const tA = att.tier==='B' ? 1.15 : 1.0;
  const tD = def.tier==='B' ? 1.15 : 1.0;
  const atkMult = 1 + (att.atk||0) * 0.012;
  const defMult = 1 + (def.def||0) * 0.012;
  const cA = 1 + (att.combatBonus||0);
  const rA = 1 + Math.random()*0.18 + Math.random()*0.18;
  const rD = 1 + Math.random()*0.18 + Math.random()*0.18;
  const sA = att.army * atkMult * rA * tA * cA + (att.food||0)*0.06;
  const sD = def.army * defMult * rD * tD * 1.10 + (def.food||0)*0.06;
  return { attackerWins: sA>sD, scoreAtt:Math.round(sA), scoreDef:Math.round(sD) };
}
function calcPower(c) {
  const t = c.tier==='B' ? 1.15 : 1.0;
  const militarySpent = c.militarySpent || 0;
  const effectiveTreasury = Math.max(0, (c.treasury||0) + militarySpent);
  return Math.max(0, Math.round((
    c.army * 10 +
    effectiveTreasury * 0.25 +
    (c.oil||0) * 0.8 +
    (c.tourism||0) * 0.6 +
    (c.agriculture||0) * 0.5 +
    (c.food||0) * 1.2 +
    (c.atk||0) * 8 +
    (c.def||0) * 6
  ) * t));
}

// ─── EVENTS ───────────────────────────────────────────────────────────────
// IMPORTANT: P1 events n'ont pas de météo/agriculture pour éviter confusion avec P2
const EVENTS = [
  // ── MANCHE 1 — events économiques purs ──────────────────────────────────
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
    effect:'N+1 — revenus tourisme ×5 · prix tourisme ↑×2',
    tourismMultiplier:5, priceTourism:2.0 },

  { id:'gold_rush', type:'market', period:1,
    hint:'Des gisements exceptionnels sont confirmés sur trois continents. Les banques centrales injectent massivement des liquidités.',
    causalExplanation:'L\'injection massive de liquidités crée de l\'inflation → toutes les ressources coûtent plus cher, les revenus de base triplent.',
    priceJustification:{oil:'Inflation mondiale → prix ↑', food:'Inflation mondiale → prix ↑', tourism:'Inflation mondiale → prix ↑', agriculture:'Inflation mondiale → prix ↑'},
    title:'Découverte aurifère massive', desc:'L\'or afflue. Les liquidités mondiales explosent.',
    effect:'N+1 — revenus de base ×3 · toutes ressources ↑+20%',
    baseMultiplier:3, priceOil:1.2, priceFood:1.2, priceTourism:1.2, priceAgri:1.2 },

  // ── MANCHE 2 — peut avoir agri/météo ────────────────────────────────────
  { id:'agri_boom', type:'market', period:2,
    hint:'Des conditions météo exceptionnelles sur trois continents laissent présager des récoltes records cette saison.',
    causalExplanation:'Récoltes records → surplus massif sur les marchés → l\'agriculture est abondante donc moins chère, mais les revenus sont énormes.',
    priceJustification:{agriculture:'Surplus de récoltes → offre abondante → concurrence → prix ↓'},
    title:'Superproduction agricole', desc:'Récoltes records. L\'agriculture inonde les marchés.',
    effect:'N+1 — revenus agri ×5 · nourriture +25% à tous · prix agri ↓−40%',
    agriMultiplier:5, priceAgri:0.6, special:'agriBoost' },

  { id:'free_trade', type:'market', period:2,
    hint:'Les grandes économies signent un traité historique. Les barrières douanières tombent.',
    causalExplanation:'Suppression des barrières douanières → marchés inondés → concurrence accrue → toutes les ressources moins chères.',
    priceJustification:{oil:'Libre-échange → concurrence accrue → prix ↓', food:'Libre-échange → surplus alimentaires libres → prix ↓', tourism:'Frontières ouvertes → offre touristique abondante → prix ↓', agriculture:'Marchés agricoles mondiaux ouverts → prix ↓'},
    title:'Accord de libre-échange mondial', desc:'Les frontières commerciales s\'ouvrent. Tout devient accessible.',
    effect:'N+1 — toutes ressources ↓−30% · revenus passifs +15%',
    priceOil:0.7, priceFood:0.7, priceTourism:0.7, priceAgri:0.7,
    oilMultiplier:1.15, tourismMultiplier:1.15, agriMultiplier:1.15, baseMultiplier:1.15 },

  { id:'speculation', type:'market', period:2,
    hint:'Une spéculation massive s\'empare des marchés des matières premières. Les investisseurs cherchent des valeurs refuges.',
    causalExplanation:'Spéculation massive → les investisseurs achètent toutes les matières premières → demande artificielle → prix en hausse.',
    priceJustification:{oil:'Spéculation → demande artificielle → prix ↑', food:'Ruée vers les valeurs refuges alimentaires → prix ↑', agriculture:'Demande spéculative agricole → prix ↑'},
    title:'Ruée vers l\'or', desc:'Les marchés s\'emballent. Les matières premières s\'envolent.',
    effect:'N+1 — revenus de base ×2 · pétrole ↑+50% · nourriture ↑+40% · agri ↑+40%',
    baseMultiplier:2, priceOil:1.5, priceFood:1.4, priceTourism:1.0, priceAgri:1.4 },

  // ── MANCHE 3 — crises majeures + INDICE pour surprise du choix en M4 ───
  { id:'food_crisis', type:'market', period:3,
    // L'indice de M3 annonce un event marché pour M4, mais le VRAI event en M4 sera un choix (surprise)
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
    title:'Sanctions coordonnées', desc:'Le G20 frappe fort les grandes puissances.',
    effect:'N+1 — Tier S/A → −1 200 or · 4 nations les plus faibles → +400 or · toutes ressources ↑+30%',
    priceOil:1.3, priceFood:1.3, priceTourism:1.3, priceAgri:1.3, special:'sanctionsSA' },

  // ── MANCHE 4 — CHOIX (effet de surprise — l'indice M3 annonçait autre chose) ──
  { id:'embargo', type:'choice', period:4,
    hint:'Des tensions maritimes bloquent plusieurs routes commerciales stratégiques.',
    causalExplanation:'Le blocus des routes maritimes réduit l\'offre de pétrole disponible → sa rareté fait monter le prix.',
    priceJustification:{oil:'Routes bloquées → offre réduite → pétrole rare → prix ↑'},
    title:'Embargo commercial', desc:'Les routes maritimes sont coupées. Chaque nation doit choisir son camp.',
    effect:'N+1 — A: −400 pétrole (neutralité) · B: −1 000 or + 50% risque −500 pts · prix pétrole ↑×2',
    priceOil:2.0,
    choiceA:{label:'Sacrifier 400 pétrole — neutralité garantie',cost:{oil:400},gain:{}},
    choiceB:{label:'Payer 1 000 or + risque 50% de −500 pts',cost:{treasury:1000},gain:{gamble:true,powerLoss:500}} },

  { id:'scandal', type:'choice', period:4,
    hint:'Des fuites dans la presse internationale évoquent des irrégularités financières impliquant plusieurs gouvernements.',
    causalExplanation:'Le scandale financier ternit l\'image → les touristes évitent les destinations politiquement instables → prix baissent.',
    priceJustification:{tourism:'Image gouvernements ternie → touristes évitent → demande ↓ → prix ↓'},
    title:'Scandale financier', desc:'Des révélations compromettantes circulent. Avouer ou nier ?',
    effect:'N+1 — A: −300 or, −100 pts (certain) · B: 50% rien / 50% −1 200 or −400 pts · prix tourisme ↓−20%',
    priceTourism:0.8,
    choiceA:{label:'Reconnaître les faits (−300 or, −100 pts)',cost:{treasury:300},gain:{powerLoss:100}},
    choiceB:{label:'Démentir (50%: rien / 50%: −1 200 or et −400 pts)',cost:{},gain:{gamble:true,powerLoss:400,goldLoss:1200}} },

  { id:'refugees', type:'choice', period:4,
    hint:'Une instabilité régionale génère des déplacements de population massifs.',
    causalExplanation:'L\'afflux de réfugiés augmente la demande alimentaire → la nourriture se raréfie → prix en hausse.',
    priceJustification:{food:'Afflux de réfugiés → demande alimentaire en hausse → prix ↑'},
    title:'Crise humanitaire', desc:'Des millions de personnes fuient. Accueillir ou fermer les frontières ?',
    effect:'N+1 — A: −400 nourr → +400 pts, +60 armée · B: −300 pts · prix nourriture ↑+50%',
    priceFood:1.5,
    choiceA:{label:'Accueillir (−400 nourriture → +400 pts puissance, +60 armée)',cost:{food:400},gain:{power:400,army:60}},
    choiceB:{label:'Refuser (vous perdez −300 pts de puissance)',cost:{},gain:{powerLoss:300}} },

  // ── MANCHE 5 — ciblé + prix P6 (indice vague, effet surprise) ─────────────
  { id:'revolution', type:'targeted', period:5,
    // Indice vague : ne révèle pas l'event exact, juste une tension géopolitique
    hint:'Des tensions géopolitiques profondes reconfigurent les alliances mondiales. Les marchés surveillent les développements.',
    causalExplanation:'L\'instabilité sociale dans les grandes puissances fait fuir les touristes → demande touristique chute → prix baissent en période de guerre.',
    priceJustification:{tourism:'Instabilité → touristes fuient → prix ↓', oil:'Incertitude → demande énergie fluctue → prix ↑'},
    title:'Vague révolutionnaire', desc:'Les peuples renversent les élites. Les équilibres basculent. Les marchés s\'affolent.',
    effect:'Guerre — < 4 500 pts → +400 or · > 10 000 pts → −500 or · prix tourisme ↓−20% · prix pétrole ↑+30%',
    priceTourism:0.8, priceOil:1.3, special:'revolution' },

  { id:'imf', type:'targeted', period:5,
    hint:'Des signaux économiques contradictoires émergent des grandes institutions mondiales. Les analystes restent prudents.',
    causalExplanation:'Le plan FMI stabilise certains marchés mais crée des déséquilibres → les ressources stratégiques se raréfient avant la guerre.',
    priceJustification:{oil:'Tensions géopolitiques → demande énergie ↑ → prix ↑', food:'Aide alimentaire canalisée → stocks libres ↓ → prix ↑', agriculture:'Subventions détournées → offre libre ↓ → prix ↑'},
    title:'Plan FMI & Tensions', desc:'Le FMI injecte des milliards — mais les marchés restent nerveux.',
    effect:'Guerre — 4 nations les plus faibles → +350 or, +70 armée · prix pétrole ↑+25% · prix nourriture ↑+20% · prix agri ↑+20%',
    priceOil:1.25, priceFood:1.2, priceAgri:1.2, priceTourism:1.0, special:'aidFMI' },

  { id:'uprising', type:'targeted', period:5,
    hint:'Des mouvements sociaux inattendus bouleversent plusieurs économies clés. L\'issue reste incertaine.',
    causalExplanation:'Les grèves et soulèvements perturbent les chaînes d\'approvisionnement → certaines ressources se raréfient, d\'autres explosent avant la guerre.',
    priceJustification:{tourism:'Grèves → aéroports paralysés → prix ↓', oil:'Perturbations industrielles → offre réduite → prix ↑', agriculture:'Blocages logistiques → stocks agricoles tendus → prix ↑'},
    title:'Grèves et soulèvements', desc:'Les pays émergents s\'arment. Les superpuissances désertent.',
    effect:'Guerre — Tier B → +90 armée · Tier S → −180 armée · prix tourisme ↓−25% · prix pétrole ↑+40% · prix agri ↑+30%',
    priceTourism:0.75, priceOil:1.4, priceAgri:1.3, special:'uprising' },

  // ── MANCHE 6 — dernière période de paix — hint = conseil stratégique ───────
  // Pas de multiplicateurs de prix utiles (pas de P7) — le hint prépare à la guerre
  { id:'earthquake', type:'targeted', period:6,
    hint:'⚔️ DERNIÈRE PÉRIODE — La guerre est imminente ! Vendez pétrole, tourisme, agriculture. Gardez la nourriture et au moins 600 or. Recrutez des soldats, investissez en ATK et DEF maintenant.',
    causalExplanation:'Le séisme détruit des terres agricoles juste avant la guerre.',
    priceJustification:{},
    title:'Séisme majeur', desc:'Le sol tremble. Un pays est frappé sans prévenir juste avant la guerre.',
    effect:'Guerre — 1 pays aléatoire → −55% nourriture, −500 pts',
    targetCount:1, effects:{foodLoss:0.55,powerLoss:500} },

  { id:'typhoon', type:'targeted', period:6,
    hint:'⚔️ DERNIÈRE PÉRIODE — La guerre commence après ! Liquidez vos ressources économiques (sauf nourriture). Minimum 600 or en caisse. Maximisez armée, ATK et DEF — c\'est votre dernière chance.',
    causalExplanation:'Les typhons frappent plusieurs pays juste avant la guerre.',
    priceJustification:{},
    title:'Typhons dévastateurs', desc:'Deux super-tempêtes frappent les côtes. La guerre suit.',
    effect:'Guerre — 2 pays aléatoires → −60% nourriture, −300 pts',
    targetCount:2, effects:{foodLoss:0.60,powerLoss:300} },

  { id:'tourism_crisis', type:'targeted', period:6,
    hint:'⚔️ DERNIÈRE PÉRIODE — Plus aucun achat possible en guerre ! Vendez tout ce que vous pouvez maintenant. Gardez nourriture + 600 or minimum. Recrutez des soldats, investissez en ATK et DEF — c\'est maintenant ou jamais.',
    causalExplanation:'La crise du tourisme frappe certains pays juste avant la guerre.',
    priceJustification:{},
    title:'Crise du tourisme', desc:'Les touristes fuient. La guerre approche.',
    effect:'Guerre — tourisme > 200 → −500 or · tourisme < 70 → +250 or',
    special:'tourismCrisis' },
];

// ─── EVENT ROTATION — garantit un event différent par manche ──────────────
const eventHistory = { 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
const HISTORY_DEPTH = 3; // évite répétition sur 3 parties

function pickWithRotation(pool, historyKey) {
  const history = eventHistory[historyKey] || [];
  let available = pool.filter(e => !history.includes(e.id));
  if (available.length === 0) available = pool;
  const chosen = available[Math.floor(Math.random() * available.length)];
  eventHistory[historyKey] = [chosen.id, ...history].slice(0, HISTORY_DEPTH);
  return chosen;
}

const PERIOD_POOLS = {
  1: EVENTS.filter(e => e.period === 1),
  2: EVENTS.filter(e => e.period === 2),
  3: EVENTS.filter(e => e.period === 3),
  4: EVENTS.filter(e => e.type === 'choice'),
  5: EVENTS.filter(e => e.period === 5),
  6: EVENTS.filter(e => e.period === 6),
};

function generateSequence() {
  const ev1 = pickWithRotation(PERIOD_POOLS[1], 1);

  // P2: différent de P1 ET hint différent
  let ev2, attempts = 0;
  do {
    const history2 = eventHistory[2] || [];
    const available2 = PERIOD_POOLS[2].filter(e => !history2.includes(e.id));
    const pool2 = available2.length > 0 ? available2 : PERIOD_POOLS[2];
    ev2 = pool2[Math.floor(Math.random() * pool2.length)];
    attempts++;
    if (attempts >= 10) break;
  } while (ev2.id === ev1.id || ev2.hint === ev1.hint);
  eventHistory[2] = [ev2.id, ...(eventHistory[2] || [])].slice(0, HISTORY_DEPTH);

  const ev3 = pickWithRotation(PERIOD_POOLS[3], 3);
  const ev4 = pickWithRotation(PERIOD_POOLS[4], 4);
  const ev5 = pickWithRotation(PERIOD_POOLS[5], 5);
  const ev6 = pickWithRotation(PERIOD_POOLS[6], 6);

  return [ev1, ev2, ev3, ev4, ev5, ev6];
}

const TUTORIAL_EV = { id:'tutorial', type:'market', title:'Manche Test', desc:'Explorez librement — ressources remises à zéro après. Aucune conséquence !', effect:'Actions illimitées' };

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",    subtitle:"Année 1" },
  { number:2, name:"Premières Tensions",      subtitle:"Année 2" },
  { number:3, name:"Crise Mondiale",          subtitle:"Année 3" },
  { number:4, name:"Course aux Armements",    subtitle:"Année 4" },
  { number:5, name:"Ultimatums",              subtitle:"Année 5" },
  { number:6, name:"L'Heure de Vérité",      subtitle:"Année 6" },
];

// Textes entre les périodes — adaptés au timing (pas de rappel guerre en P1)
const PERIOD_DESCS = [
  "Lisez l'indice en bas — il vous dit exactement quoi acheter à la prochaine période. Investissez dans pétrole, tourisme ou agriculture selon l'indice. 2 actions disponibles.",
  "Les tensions montent. L'indice est votre meilleur allié — si ça parle de pétrole, achetez du pétrole maintenant. Si ça parle de famine, stockez de la nourriture. 2 actions.",
  "Catastrophe mondiale. 2 actions.",
  "ARMÉE DISPONIBLE. Vous pouvez maintenant recruter et investir en ATK et DEF. ⚔️ Rappel : gardez au moins 600 or pour la guerre. 2 actions.",
  "AVANT-DERNIÈRE PÉRIODE. Investissez dans l'armée, ATK, DEF. Une phase de NÉGOCIATION aura lieu avant la guerre pour former des alliances. ⚔️ Gardez 600 or minimum. 2 actions.",
  "DERNIÈRE PÉRIODE DE PAIX. Plus aucun achat en guerre. ⚔️ Coût d'attaque: 150 or. Maximisez ATK et DEF. Une négociation suit avant la guerre. 2 actions.",
];

let gameState = {
  phase:'setup', currentPeriod:0, currentEvent:null, nextEvent:null, nextHint:null,
  periodSequence:[], countries:{}, takenCountries:{}, teams:{},
  prices:{...BASE_PRICES}, prevPrices:{...BASE_PRICES}, currentPrices:{...BASE_PRICES},
  eventMod:{oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0},
  coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},
  alliances:{}, pendingAllianceProposals:{}, log:[],
  timerSeconds:600, timerRunning:false,
  warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:45, warCycleOrder:[], // 45s + fair cycle
  negotiationRanking:[], attacksReceived:{}, prevEvent:null,
  teamActionsThisPeriod:{}, lastActionByTeam:{},
  pendingChoiceEvent:null, winner:null, winners:[],
  isTutorial:false, tutorialSnapshot:{}, gameOver:false,
};

let timerInterval = null;
let warTurnInterval = null;

function initCountries() {
  gameState.countries = {};
  COUNTRIES.forEach(c => {
    gameState.countries[c.id] = { ...c, treasury:c.gold, power:calcPower({...c,treasury:c.gold,militarySpent:0}),
      eliminated:false, defense:false, team:null, combatBonus:0, militarySpent:0 };
  });
}

function addLog(text,type) {
  gameState.log.unshift({text,type,time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});
  if(gameState.log.length>120) gameState.log=gameState.log.slice(0,120);
}
function addTeamNews(teamName,text,type) {
  if(!gameState.teams[teamName])return;
  gameState.teams[teamName].news=gameState.teams[teamName].news||[];
  gameState.teams[teamName].news.push({text,type,time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});
  if(gameState.teams[teamName].news.length>80)
    gameState.teams[teamName].news=gameState.teams[teamName].news.slice(-80);
}
function broadcast() { io.emit('state',gameState); }

function applyEvent(ev) {
  gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
  if(ev.oilMultiplier!==undefined)     gameState.eventMod.oilMultiplier=ev.oilMultiplier;
  if(ev.tourismMultiplier!==undefined) gameState.eventMod.tourismMultiplier=ev.tourismMultiplier;
  if(ev.agriMultiplier!==undefined)    gameState.eventMod.agriMultiplier=ev.agriMultiplier;
  if(ev.baseMultiplier!==undefined)    gameState.eventMod.baseMultiplier=ev.baseMultiplier;
  if(ev.blockOilBelowPower)            gameState.eventMod.blockOilBelowPower=ev.blockOilBelowPower;

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
    c.defense=false;c.combatBonus=0;c.power=calcPower(c);
  });
  gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};gameState.alliances={};
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
    // Émettre winner uniquement aux joueurs et screen — PAS au MJ
    io.emit('winner',{winners:gameState.winners,type:'solo'});
    addLog(`🏆 ${alive[0].flag} ${alive[0].name} remporte Geopolitica !`,'event');broadcast();
  } else if(alive.length===2){
    const t1=alive[0].team,t2=alive[1].team;
    const a1=gameState.alliances[t1],a2=gameState.alliances[t2];
    if(a1&&a1.type==='peace'&&a1.with===t2&&a2&&a2.type==='peace'&&a2.with===t1){
      gameState.gameOver=true;gameState.winners=alive;
      if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
      if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}
      io.emit('winner',{winners:gameState.winners,type:'alliance'});
      addLog(`🤝 Double victoire: ${alive[0].flag} & ${alive[1].flag} !`,'event');broadcast();
    }
  }
}

// ─── FAIR WAR TURNS — chaque équipe joue une fois avant qu'une rejoue ──────
// Order: shuffle aléatoire à chaque cycle, pas deux fois le même avant que tous aient joué
function buildNewCycle(aliveTeams) {
  // Fisher-Yates shuffle
  const arr = [...aliveTeams];
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
  return arr;
}

function startWarTurn(){
  const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  const teams=alive.map(c=>c.team);
  gameState.warCycleOrder=buildNewCycle(teams);
  gameState.warCurrentTurn=0;
  advanceWarTurn();
}

function advanceWarTurn(){
  if(warTurnInterval)clearInterval(warTurnInterval);
  if(gameState.gameOver)return;

  // Rebuild alive list
  const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated).map(c=>c.team);
  // Remove eliminated from cycle
  gameState.warCycleOrder=gameState.warCycleOrder.filter(t=>alive.includes(t));

  // If current index past end, start new cycle
  if(gameState.warCurrentTurn>=gameState.warCycleOrder.length){
    // New cycle — re-randomize with all alive teams
    gameState.warCycleOrder=buildNewCycle(alive);
    gameState.warCurrentTurn=0;
  }
  if(gameState.warCycleOrder.length===0)return;

  const team=gameState.warCycleOrder[gameState.warCurrentTurn];
  gameState.warTurnSeconds=45; // 45 secondes par tour
  gameState.warTurnOrder=gameState.warCycleOrder; // pour compatibilité client
  io.emit('warTurn',{team,seconds:45,turnIndex:gameState.warCurrentTurn,total:gameState.warCycleOrder.length});
  addLog(`Tour de ${team} (${gameState.warCurrentTurn+1}/${gameState.warCycleOrder.length})`,'event');broadcast();
  warTurnInterval=setInterval(()=>{
    if(gameState.gameOver){clearInterval(warTurnInterval);return;}
    gameState.warTurnSeconds--;io.emit('warTurnTimer',{seconds:gameState.warTurnSeconds,team});
    if(gameState.warTurnSeconds<=0){clearInterval(warTurnInterval);addTeamNews(team,'⏰ Tour passé !','bad');gameState.warCurrentTurn++;advanceWarTurn();}
  },1000);
}
function nextWarTurn(){if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}gameState.warCurrentTurn++;advanceWarTurn();}

// ─── SOCKET HANDLERS ─────────────────────────────────────────────────────
io.on('connection',(socket)=>{
  socket.emit('sessionInfo', { sessionCode: SESSION_CODE });

  socket.on('auth:mj', ({pin}, cb) => {
    if(String(pin) === String(MJ_PIN)) {
      socketRegistry.set(socket.id, { isMJ: true });
      socket.join('mj');
      if(typeof cb==='function') cb({ ok: true });
      socket.emit('state', gameState);
      socket.emit('timer', {seconds:gameState.timerSeconds, running:gameState.timerRunning});
      // MJ ne reçoit PAS le winner event — juste le state qui contient gameOver
    } else {
      if(typeof cb==='function') cb({ ok: false, error: 'PIN incorrect' });
    }
  });

  socket.on('mj:kickTeam',({teamName})=>{
    const team=gameState.teams[teamName];if(!team)return;
    if(team.country){const c=gameState.countries[team.country];if(c){c.team=null;c.eliminated=false;}delete gameState.takenCountries[team.country];}
    delete gameState.teams[teamName];teamSockets.delete(teamName);
    const sid=Array.from(socketRegistry.entries()).find(([k,v])=>v.teamName===teamName)?.[0];
    if(sid){socketRegistry.delete(sid);const s=io.sockets.sockets.get(sid);if(s)s.emit('kicked','Vous avez été retiré de la partie par le MJ.');}
    addLog(`${teamName} retiré — pays libéré`,'event');broadcast();
  });

  socket.on('auth:rejoin', ({teamName, sessionCode}, cb) => {
    if(String(sessionCode) !== String(SESSION_CODE)) {
      if(typeof cb==='function') cb({ ok: false, error: 'Code de session invalide' }); return;
    }
    const team = gameState.teams[teamName];
    if(!team) { if(typeof cb==='function') cb({ ok: false, error: 'Équipe introuvable' }); return; }
    teamSockets.set(teamName, socket.id);
    socketRegistry.set(socket.id, { teamName, countryId: team.country, isMJ: false });
    if(typeof cb==='function') cb({ ok: true, team, countryId: team.country });
    socket.emit('state', gameState);
    socket.emit('timer', {seconds:gameState.timerSeconds, running:gameState.timerRunning});
    // Envoyer winner uniquement si la partie est terminée et ce n'est pas MJ
    if(gameState.winners&&gameState.winners.length>0)
      socket.emit('winner', {winners:gameState.winners, type:gameState.winners.length>1?'alliance':'solo'});
    Object.entries(gameState.pendingAllianceProposals).forEach(([to,p])=>{
      if(p&&p.to===teamName) socket.emit('allianceProposal',p);
    });
    if(gameState.phase==='war'&&gameState.warCycleOrder.length>0){
      const curTeam=gameState.warCycleOrder[gameState.warCurrentTurn];
      socket.emit('warTurn',{team:curTeam,seconds:gameState.warTurnSeconds,turnIndex:gameState.warCurrentTurn,total:gameState.warCycleOrder.length});
    }
  });

  socket.on('disconnect', () => { socketRegistry.delete(socket.id); });

  socket.on('mj:startDraft',()=>{
    if(gameState.phase==='setup'||gameState.gameOver){
      SESSION_CODE = generateSessionCode();
      console.log('New session code:', SESSION_CODE);
    }
    io.emit('sessionInfo', { sessionCode: SESSION_CODE });
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

  // Tutorial + Période 1 en une seule commande (MJ peut décider de lancer directement)
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
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'🎮 MANCHE TEST — Explorez librement ! Achetez, vendez, testez. Ressources remises à zéro après.','neutral');});
    broadcast();
  });

  // "Terminer tutorial et lancer P1" en un clic
  socket.on('mj:endTutorialAndStart',()=>{
    // Remettre les ressources à zéro
    Object.values(gameState.countries).forEach(c=>{
      const s=gameState.tutorialSnapshot[c.id];
      if(!s)return;
      c.oil=s.oil;c.food=s.food;c.tourism=s.tourism;c.agriculture=s.agriculture;
      c.army=s.army;c.atk=s.atk||0;c.def=s.def||0;c.treasury=s.treasury;
      c.militarySpent=s.militarySpent||0;c.defense=false;c.combatBonus=0;c.power=calcPower(c);
    });
    // Lancer directement la période 1
    gameState.prices={...BASE_PRICES};gameState.prevPrices={...BASE_PRICES};gameState.currentPrices={...BASE_PRICES};
    gameState.prevEvent=null;gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
    gameState.phase='prosperity';gameState.currentPeriod=1;gameState.isTutorial=false;
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};gameState.tutorialSnapshot={};
    const p=PERIODS[0];const ev=gameState.periodSequence[0];
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[0],periodNumber:1,hideEventFromPlayers:true};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    const nev=gameState.periodSequence[1];
    gameState.nextEvent=nev||null;gameState.nextHint=ev?.hint||null; // hint de l'event COURANT (celui qui cause les prix P+1)
    const nextPrices=previewNextPrices(gameState.prices,ev);
    gameState.currentEvent.nextPrices=nextPrices;gameState.currentEvent.nextHint=gameState.nextHint;
    io.emit('periodTransition', {period: 1, duration: 18000});
    resetServerTimer(600);addLog(`Période 1 — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`📅 Période 1 — ${p.name}\n${PERIOD_DESCS[0]}\n\n🔮 Indice pour la prochaine période :\n${gameState.nextHint||'(aucun indice)'}`, 'neutral');});
    broadcast();
  });

  // Ancien endTutorial conservé pour compatibilité
  socket.on('mj:endTutorial',()=>{
    Object.values(gameState.countries).forEach(c=>{
      const s=gameState.tutorialSnapshot[c.id];if(!s)return;
      c.oil=s.oil;c.food=s.food;c.tourism=s.tourism;c.agriculture=s.agriculture;
      c.army=s.army;c.atk=s.atk||0;c.def=s.def||0;c.treasury=s.treasury;
      c.militarySpent=s.militarySpent||0;c.defense=false;c.combatBonus=0;c.power=calcPower(c);
    });
    gameState.isTutorial=false;gameState.phase='draft';gameState.currentPeriod=0;
    gameState.currentEvent=null;gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    gameState.tutorialSnapshot={};gameState.prices={...BASE_PRICES};
    gameState.prevPrices={...BASE_PRICES};gameState.currentPrices={...BASE_PRICES};
    gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
    addLog('Tutorial terminé — ressources remises à zéro','event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'✅ Tutorial terminé ! La vraie partie commence — attendez le MJ.','neutral');});
    broadcast();
  });

  socket.on('mj:startProsperity',()=>{
    if(Object.keys(gameState.tutorialSnapshot||{}).length>0){
      Object.values(gameState.countries).forEach(c=>{
        if(gameState.tutorialSnapshot[c.id]){
          const s=gameState.tutorialSnapshot[c.id];
          c.oil=s.oil;c.food=s.food;c.tourism=s.tourism;c.agriculture=s.agriculture;
          c.army=s.army;c.atk=s.atk||0;c.def=s.def||0;c.treasury=s.treasury;
          c.militarySpent=s.militarySpent||0;c.defense=false;c.combatBonus=0;c.power=calcPower(c);
        }
      });
    }
    gameState.prices={...BASE_PRICES};gameState.prevPrices={...BASE_PRICES};gameState.currentPrices={...BASE_PRICES};
    gameState.prevEvent=null;gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
    gameState.phase='prosperity';gameState.currentPeriod=1;gameState.isTutorial=false;
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    const p=PERIODS[0];const ev=gameState.periodSequence[0];
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[0],periodNumber:1,hideEventFromPlayers:true};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    const nev=gameState.periodSequence[1];
    gameState.nextEvent=nev||null;gameState.nextHint=ev?.hint||null; // hint de l'event COURANT (celui qui cause les prix P+1)
    const nextPrices=previewNextPrices(gameState.prices,ev);
    gameState.currentEvent.nextPrices=nextPrices;gameState.currentEvent.nextHint=gameState.nextHint;
    io.emit('periodTransition', {period: 1, duration: 18000});
    resetServerTimer(600);addLog(`Période 1 — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`📅 Période 1 — ${p.name}\n${PERIOD_DESCS[0]}\n\n🔮 Indice pour la prochaine période :\n${gameState.nextHint||'(aucun indice)'}`, 'neutral');});
    broadcast();
  });

  socket.on('mj:nextPeriod',()=>{
    if(gameState.currentPeriod>=6)return;
    // prevEv = event qui SE TERMINE (période courante) — ses multiplicateurs s'appliquent maintenant
    const prevEv=gameState.periodSequence[gameState.currentPeriod-1];
    gameState.prevPrices={...gameState.prices};
    gameState.prevEvent=prevEv||null;
    const reverted=meanRevertPrices(gameState.currentPrices||gameState.prices);
    const newPrices=applyEventMultipliers(reverted,prevEv);
    gameState.currentPrices={...newPrices};
    gameState.prices={...newPrices};
    // Appliquer les effets de l'event QUI VIENT DE SE TERMINER (prevEv) AVANT les revenus :
    // eventMod (multiplicateurs de revenus) + effets spéciaux (agriBoost, oilCrash, etc.)
    if(prevEv&&(prevEv.type==='market'||prevEv.type==='targeted'))applyEvent(prevEv);
    // Maintenant calculer les revenus avec le bon eventMod
    applyPeriodTransition();
    gameState.currentPeriod++;
    // ev = event de la NOUVELLE période courante (affiché, indice donné, effets au prochain tour)
    const ev=gameState.periodSequence[gameState.currentPeriod-1];
    const p=PERIODS[gameState.currentPeriod-1];
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[gameState.currentPeriod-1],periodNumber:gameState.currentPeriod};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    // nev = event de la période SUIVANTE (pour donner l'indice aux joueurs)
    const nev=gameState.periodSequence[gameState.currentPeriod]||null;
    gameState.nextEvent=nev||null;
    const nextPrices=gameState.currentPeriod<6?previewNextPrices(gameState.prices,ev):{...BASE_PRICES};
    gameState.nextHint=gameState.currentPeriod<6?(ev?.hint||null):'⚔️ La GUERRE commence après cette période. Négociation avant la guerre. Gardez au moins 600 or.'; // hint de l'event COURANT (celui qui cause les prix P+1)
    gameState.currentEvent.nextPrices=nextPrices;gameState.currentEvent.nextHint=gameState.nextHint;
    // Stocker les prix AVANT et APRÈS pour l'explication causale
    gameState.currentEvent.prevPricesSnapshot = {...gameState.prevPrices};
    gameState.currentEvent.newPricesSnapshot = {oil:gameState.prices.oil,food:gameState.prices.food,tourism:gameState.prices.tourism,agriculture:gameState.prices.agriculture};
    // Stocker l'explication causale dans l'event pour affichage MJ
    gameState.currentEvent.causalFromPrev = prevEv ? buildEventExplanation(prevEv, gameState.prevPrices, gameState.prices) : null;
    gameState.currentEvent.prevEvTitle = prevEv ? prevEv.title : null;
    // Construire l'explication pour les joueurs : ce que l'indice précédent a causé
    const causalExpl = buildEventExplanation(prevEv, gameState.prevPrices, gameState.prices);
    const prevEvTitle = prevEv ? prevEv.title : null;
    // Signal aux joueurs : cinématique en cours, afficher overlay loading
    io.emit('periodTransition', {period: gameState.currentPeriod, duration: 18000});
    resetServerTimer(600);addLog(`Période ${gameState.currentPeriod} — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team){
      let msg = `📅 Période ${gameState.currentPeriod} — ${p.name}\n${PERIOD_DESCS[gameState.currentPeriod-1]}`;
      if(prevEvTitle && causalExpl) {
        msg += `\n\n📊 L'indice "${prevEvTitle}" a provoqué :\n${causalExpl}`;
      }
      if(gameState.nextHint) {
        msg += `\n\n🔮 Indice pour la prochaine période :\n${gameState.nextHint}`;
      } else {
        msg += `\n\n🔮 ${gameState.currentPeriod>=6?'La guerre commence après cette période !':'(aucun indice)'}`;
      }
      addTeamNews(c.team, msg, 'neutral');
    }});
    broadcast();
  });

  socket.on('mj:startNegotiation',()=>{
    gameState.phase='negotiation';gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    gameState.alliances={};gameState.pendingAllianceProposals={};
    const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated).sort((a,b)=>b.power-a.power);
    const N=alive.length;
    gameState.negotiationRanking=alive.map((c,i)=>({rank:i+1,id:c.id,flag:c.flag,name:c.name,power:c.power,team:c.team,tier:c.tier,atk:c.atk||0,def:c.def||0,army:c.army,treasury:c.treasury}));
    addLog('Phase de negociation','event');
    alive.forEach((c,i)=>{
      const myRank=i+1;
      const canProposeTo=alive.slice(N-myRank).map(cc=>cc.flag+' '+cc.name).join(', ');
      addTeamNews(c.team,'💬 NÉGOCIATION rang '+myRank+'/'+N+' — vous pouvez proposer une alliance à : '+canProposeTo,'neutral');
    });
    broadcast();
  });

  socket.on('mj:startWar',()=>{
    gameState.phase='war';gameState.currentEvent=null;gameState.pendingChoiceEvent=null;
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    gameState.pendingAllianceProposals={};
    gameState.coalition={proposed:true,moroccoAccepted:false,guineaAccepted:false,active:false};
    gameState.attacksReceived={};
    resetServerTimer(600);addLog('⚔️ GUERRE MONDIALE DÉMARRÉE','attack');
    if(gameState.countries.morocco?.team)addTeamNews(gameState.countries.morocco.team,'🤝 Coalition africaine proposée avec la Guinée !','neutral');
    if(gameState.countries.guinea?.team)addTeamNews(gameState.countries.guinea.team,'🤝 Coalition africaine proposée avec le Maroc !','neutral');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'⚔️ GUERRE ! Aucun achat. Attendez votre tour. Attaque = 150 or / 200 pétrole / 300 nourriture.','bad');});
    broadcast();setTimeout(()=>startWarTurn(),3000);
  });

  socket.on('mj:timerStart',({seconds})=>startServerTimer(seconds||gameState.timerSeconds));
  socket.on('mj:timerPause',()=>pauseServerTimer());
  socket.on('mj:timerReset',({seconds})=>resetServerTimer(seconds));
  socket.on('mj:nextWarTurn',()=>nextWarTurn());
  socket.on('mj:startWarTurns',()=>startWarTurn());

  // ── CHOICE RESPONSE — pénalité partielle si pas assez de ressources ──────
  socket.on('team:choiceResponse',({teamName,choice})=>{
    const ev=gameState.pendingChoiceEvent;if(!ev)return;
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    const chosen=choice==='A'?ev.choiceA:ev.choiceB;
    let partialPenalty=false;let msg='';

    if(chosen.cost){
      // Vérification des ressources — si insuffisant: prendre tout + pénalité, pas de gain
      if(chosen.cost.treasury&&c.treasury<chosen.cost.treasury){
        const taken=c.treasury;c.treasury=0;
        msg+=`⚠️ Ressources insuffisantes — tout pris (${taken} or au lieu de ${chosen.cost.treasury}). Aucun gain. `;
        partialPenalty=true;
      } else if(chosen.cost.treasury) { c.treasury-=chosen.cost.treasury; }

      if(chosen.cost.oil&&c.oil<chosen.cost.oil){
        const taken=c.oil;c.oil=0;
        msg+=`⚠️ Pétrole insuffisant — tout pris (${taken} au lieu de ${chosen.cost.oil}). Aucun gain. `;
        partialPenalty=true;
      } else if(chosen.cost.oil) { c.oil-=chosen.cost.oil; }

      if(chosen.cost.food&&c.food<chosen.cost.food){
        const taken=c.food;c.food=0;
        msg+=`⚠️ Nourriture insuffisante — tout pris (${taken} au lieu de ${chosen.cost.food}). Aucun gain. `;
        partialPenalty=true;
      } else if(chosen.cost.food) { c.food-=chosen.cost.food; }
    }

    if(!partialPenalty&&chosen.gain){
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
    addTeamNews(teamName,partialPenalty?`⚠️ Choix "${chosen.label}" — ressources insuffisantes ! ${msg}`:`✅ Choix "${chosen.label}": ${msg}`,'good');
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

  // ── ALLIANCES — négociation uniquement ───────────────────────────────────
  socket.on('team:proposeAlliance',({fromTeam,toTeam,allianceType,targetId})=>{
    if(gameState.phase!=='negotiation'){socket.emit('error','Les alliances ne sont disponibles que pendant la phase de Négociation !');return;}
    const cost=allianceType==='offensive'?100:0;
    const team=gameState.teams[fromTeam];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    const fromCountry=Object.values(gameState.countries).find(cc=>cc.team===fromTeam);

    // Vérification rang
    const aliveN=Object.values(gameState.countries).filter(cc=>cc.team&&!cc.eliminated).sort((a,b)=>b.power-a.power);
    const NN=aliveN.length;
    const fromRank=aliveN.findIndex(cc=>cc.team===fromTeam)+1;
    const toRank=aliveN.findIndex(cc=>cc.team===toTeam)+1;
    const minAllowedRank=NN-fromRank+1;
    if(toRank<minAllowedRank){
      const canTo=aliveN.slice(NN-fromRank).map(cc=>cc.flag+' '+cc.name).join(', ');
      socket.emit('error','Rang '+fromRank+'/'+NN+' — alliance uniquement possible avec : '+canTo);return;
    }

    if(cost>0&&c.treasury<cost){socket.emit('error','Pas assez d\'or !');return;}
    const proposal={from:fromTeam,fromCountry:fromCountry?{flag:fromCountry.flag,name:fromCountry.name}:null,to:toTeam,type:allianceType,cost,targetId:targetId||null,expires:Date.now()+30000};
    gameState.pendingAllianceProposals[toTeam]=proposal;
    io.emit('allianceProposal',proposal);
    const toCountry=Object.values(gameState.countries).find(cc=>cc.team===toTeam);
    addTeamNews(toTeam,`🤝 ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam} vous propose une alliance ${allianceType==='offensive'?'offensive (+15% combat)':'de non-agression'}. Répondez !`,'neutral');
    setTimeout(()=>{if(gameState.pendingAllianceProposals[toTeam]===proposal){delete gameState.pendingAllianceProposals[toTeam];io.emit('allianceExpired',{to:toTeam});addTeamNews(fromTeam,`❌ Alliance avec ${toCountry?.name||toTeam} — pas de réponse`,'bad');}},30000);
  });

  socket.on('team:respondAlliance',({fromTeam,toTeam,accepted,allianceType})=>{
    const proposal=gameState.pendingAllianceProposals[toTeam];
    if(!proposal||proposal.from!==fromTeam){socket.emit('error','Proposition expirée ou introuvable');return;}
    delete gameState.pendingAllianceProposals[toTeam];

    const fromC=Object.values(gameState.countries).find(c=>c.team===fromTeam);
    const toC=Object.values(gameState.countries).find(c=>c.team===toTeam);

    if(accepted){
      if(proposal.cost>0){const fc=gameState.countries[gameState.teams[fromTeam]?.country];if(fc)fc.treasury=Math.max(0,fc.treasury-proposal.cost);}
      const agreedTarget=proposal.targetId||null;
      const turnIdx=gameState.warCurrentTurn;
      gameState.alliances[fromTeam]={type:proposal.type,with:toTeam,withCountryName:toC?.name||toTeam,withCountryFlag:toC?.flag||'',targetId:agreedTarget,expires:turnIdx+(gameState.warTurnOrder.length||10)};
      gameState.alliances[toTeam]  ={type:proposal.type,with:fromTeam,withCountryName:fromC?.name||fromTeam,withCountryFlag:fromC?.flag||'',targetId:agreedTarget,expires:turnIdx+(gameState.warTurnOrder.length||10)};
      addTeamNews(fromTeam,`✅ ${toC?.flag||''} ${toC?.name||toTeam} a ACCEPTÉ l'alliance !`,'good');
      addTeamNews(toTeam,`✅ Vous avez accepté l'alliance avec ${fromC?.flag||''} ${fromC?.name||fromTeam}`,'good');
      // Notification riche pour les deux parties
      const fromSid=teamSockets.get(fromTeam);const toSid=teamSockets.get(toTeam);
      if(fromSid){const s=io.sockets.sockets.get(fromSid);if(s)s.emit('allianceAccepted',{by:toTeam,byCountry:{flag:toC?.flag||'',name:toC?.name||toTeam},type:proposal.type,youAccepted:false});}
      if(toSid){const s=io.sockets.sockets.get(toSid);if(s)s.emit('allianceAccepted',{by:fromTeam,byCountry:{flag:fromC?.flag||'',name:fromC?.name||fromTeam},type:proposal.type,youAccepted:true});}
      addLog(`🤝 Alliance ${proposal.type}: ${fromC?.flag||''} ${fromC?.name||fromTeam} & ${toC?.flag||''} ${toC?.name||toTeam}`,'event');
    } else {
      addTeamNews(fromTeam,`❌ ${toC?.flag||''} ${toC?.name||toTeam} a refusé votre alliance.`,'bad');
      const fromSid=teamSockets.get(fromTeam);
      if(fromSid){const s=io.sockets.sockets.get(fromSid);if(s)s.emit('allianceRefused',{by:toTeam,byCountry:{flag:toC?.flag||'',name:toC?.name||toTeam}});}
    }
    broadcast();checkWinner();
  });

  socket.on('team:acceptCoalition',({teamName})=>{
    const c=Object.values(gameState.countries).find(cc=>cc.team===teamName);if(!c)return;
    if(c.id==='morocco')gameState.coalition.moroccoAccepted=true;
    if(c.id==='guinea')gameState.coalition.guineaAccepted=true;
    if(gameState.coalition.moroccoAccepted&&gameState.coalition.guineaAccepted){
      gameState.coalition.active=true;
      ['morocco','guinea'].forEach(id=>{const cc=gameState.countries[id];if(cc&&cc.team){cc.tourism=Math.round(cc.tourism*1.25);cc.oil=Math.round(cc.oil*1.25);cc.power=calcPower(cc);addTeamNews(cc.team,'🤝 Coalition africaine activée ! +25% ressources','good');}});
    }
    broadcast();
  });
  socket.on('team:refuseCoalition',({teamName})=>{gameState.coalition.proposed=false;broadcast();});

  // ── ATTACK ───────────────────────────────────────────────────────────────
  socket.on('team:declareAttack',({teamName,targetId,payWith})=>{
    if(gameState.phase!=='war'){socket.emit('error',"Pas encore en guerre !");return;}
    if(gameState.gameOver){socket.emit('error','La partie est terminée !');return;}
    const currentTurnTeam=gameState.warCycleOrder[gameState.warCurrentTurn];
    if(currentTurnTeam!==teamName){socket.emit('error',"Ce n\'est pas votre tour !");return;}
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
    const lA=Math.round(att.army*(result.attackerWins?0.12:0.28));
    const lD=Math.round(def.army*(result.attackerWins?0.35:0.10));

    // FIRST-BLOOD PROTECTION
    const defId=def.id;
    gameState.attacksReceived=gameState.attacksReceived||{};
    gameState.attacksReceived[defId]=(gameState.attacksReceived[defId]||0)+1;
    const isFirstAttack=gameState.attacksReceived[defId]===1;

    if(result.attackerWins){
      if(isFirstAttack){
        const r=0.50;
        const pG=Math.round(def.treasury*r),pO=Math.round((def.oil||0)*r),pF=Math.round((def.food||0)*r);
        const pT=Math.round((def.tourism||0)*r*0.5),pA=Math.round((def.agriculture||0)*r*0.5);
        att.treasury+=pG;att.oil+=pO;att.food+=pF;att.tourism+=pT;att.agriculture+=pA;
        def.treasury=Math.max(0,def.treasury-pG);def.oil=Math.max(0,def.oil-pO);
        def.food=Math.max(0,def.food-pF);def.tourism=Math.max(0,def.tourism-pT);def.agriculture=Math.max(0,def.agriculture-pA);
        att.army=Math.max(0,att.army-lA);def.army=Math.max(0,def.army-lD);
        const powerLoss=Math.round(def.power*0.30);def.power=Math.max(1,def.power-powerLoss);att.power=calcPower(att);
        addLog(`⚔️ ${att.flag} 1er assaut sur ${def.flag} — pillage partiel !`,'attack');
        addTeamNews(att.team,`⚔️ PREMIER ASSAUT vs ${def.flag} ${def.name} ! 50% ressources pillées. −${lA} armée. Attaquez encore !`,'good');
        addTeamNews(def.team,`💥 PREMIER ASSAUT de ${att.flag} ${att.name} ! −50% ressources, −${powerLoss} pts, −${lD} armée. VOUS SURVIVEZ !`,'bad');
        io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:true,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef,firstBlood:true});
      } else {
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
      }
    } else {
      const gL=Math.round(att.treasury*0.35);att.treasury=Math.max(0,att.treasury-gL);
      att.army=Math.max(0,att.army-lA);def.army=Math.max(0,def.army-lD);
      att.power=calcPower(att);def.power=calcPower(def);
      addLog(`🛡️ ${def.flag} repousse ${att.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`❌ Échec vs ${def.flag} ${def.name} — −${gL} or, −${lA} armée`,'bad');
      addTeamNews(def.team,`🛡️ Repoussé ${att.flag} ! −${lD} armée pertes défensives`,'good');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:false,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
    }
    delete gameState.alliances[teamName];
    broadcast();checkWinner();
    if(!gameState.gameOver)setTimeout(()=>nextWarTurn(),5000);
  });

  socket.on('team:skipTurn',({teamName})=>{
    const currentTurnTeam=gameState.warCycleOrder[gameState.warCurrentTurn];
    if(currentTurnTeam!==teamName)return;
    addTeamNews(teamName,'Tour passé.','neutral');nextWarTurn();broadcast();
  });

  // ── MARKET ACTIONS ───────────────────────────────────────────────────────
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
    if(type==='tech')c.atk=(c.atk||0)+Math.round(qty*0.5);
    c.militarySpent=(c.militarySpent||0)+cost;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`✅ Recrutement: +${qty*armyPer} armée pour ${cost} or${gameState.isTutorial?' (tutorial)':''}`,'good');
    socket.emit('actionFeedback',{type:'army',qty:qty*armyPer,total:cost});broadcast();
  });

  socket.on('team:buyAtk',({teamName,qty})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun achat en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(gameState.currentPeriod<5&&!gameState.isTutorial){socket.emit('error','Investissement militaire disponible à partir de la manche 5 !');return;}
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    const cost=qty*200;if(c.treasury<cost){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c.treasury-=cost;c.atk=(c.atk||0)+qty;c.militarySpent=(c.militarySpent||0)+cost;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`⚔️ Investissement offensif: +${qty} ATK pour ${cost} or`,'good');
    socket.emit('actionFeedback',{type:'atk',qty,total:cost});broadcast();
  });

  socket.on('team:buyDef',({teamName,qty})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun achat en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(gameState.currentPeriod<5&&!gameState.isTutorial){socket.emit('error','Investissement militaire disponible à partir de la manche 5 !');return;}
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    const cost=qty*200;if(c.treasury<cost){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army,atk:c.atk||0,def:c.def||0,militarySpent:c.militarySpent||0};
    c.treasury-=cost;c.def=(c.def||0)+qty;c.militarySpent=(c.militarySpent||0)+cost;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`🛡️ Investissement défensif: +${qty} DEF pour ${cost} or`,'good');
    socket.emit('actionFeedback',{type:'def',qty,total:cost});broadcast();
  });

  socket.on('mj:eliminate',({countryId})=>{const c=gameState.countries[countryId];if(!c)return;c.eliminated=true;addLog(`☠️ ${c.flag} éliminé !`,'eliminated');addTeamNews(c.team,'Votre nation a été conquise.','bad');broadcast();checkWinner();});
  socket.on('mj:bonus',({countryId,amount})=>{const c=gameState.countries[countryId];if(!c)return;c.treasury+=amount;c.power=calcPower(c);addLog(`${amount>0?'+':''}${amount} or → ${c.flag}`,amount>0?'economy':'attack');broadcast();});

  socket.on('mj:reset',()=>{
    SESSION_CODE = generateSessionCode();
    console.log('Session reset, new code:', SESSION_CODE);
    io.emit('sessionInfo', { sessionCode: SESSION_CODE });
    socketRegistry.clear();teamSockets.clear();
    if(timerInterval)clearInterval(timerInterval);if(warTurnInterval)clearInterval(warTurnInterval);timerInterval=null;warTurnInterval=null;
    gameState={phase:'setup',currentPeriod:0,currentEvent:null,nextEvent:null,nextHint:null,periodSequence:[],countries:{},takenCountries:{},teams:{},prices:{...BASE_PRICES},prevPrices:{...BASE_PRICES},currentPrices:{...BASE_PRICES},eventMod:{oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0},coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},alliances:{},pendingAllianceProposals:{},log:[],timerSeconds:600,timerRunning:false,warTurnOrder:[],warCurrentTurn:0,warTurnSeconds:45,warCycleOrder:[],negotiationRanking:[],attacksReceived:{},prevEvent:null,teamActionsThisPeriod:{},lastActionByTeam:{},pendingChoiceEvent:null,winner:null,winners:[],isTutorial:false,tutorialSnapshot:{},gameOver:false};
    broadcast();io.emit('timer',{seconds:600,running:false});
  });

  socket.on('team:join',({teamName, sessionCode}, cb)=>{
    if(String(sessionCode) !== String(SESSION_CODE)){if(typeof cb==='function') cb({ok:false,error:'Code de session invalide.'});return;}
    if(gameState.phase!=='draft'){if(typeof cb==='function') cb({ok:false,error:'La partie est déjà en cours.'});return;}
    if(gameState.teams[teamName]){if(typeof cb==='function') cb({ok:false,error:'Ce nom est déjà pris.'});return;}
    gameState.teams[teamName]={country:null,news:[]};
    teamSockets.set(teamName, socket.id);
    socketRegistry.set(socket.id, {teamName, countryId:null, isMJ:false});
    if(typeof cb==='function') cb({ok:true});
    broadcast();
  });

  socket.on('team:draftCountry',({teamName,countryId})=>{
    if(gameState.phase!=='draft'){socket.emit('error','Le draft est terminé.');return;}
    if(gameState.takenCountries[countryId]){socket.emit('error','Déjà pris !');return;}
    gameState.takenCountries[countryId]=teamName;
    gameState.teams[teamName].country=countryId;
    gameState.countries[countryId].team=teamName;
    addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} → ${teamName}`,'event');
    // Notifier que le pays est choisi (sera affiché sur screen)
    io.emit('countryDrafted',{teamName,countryId,flag:gameState.countries[countryId].flag,name:gameState.countries[countryId].name});
    broadcast();
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Geopolitica running on port ${PORT}`));
