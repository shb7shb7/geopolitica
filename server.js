const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/screen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));

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

function getFoodConsumption(c) { return Math.max(2, Math.round(c.population / 8)); }

// Prices are FULLY determined by the announced event — no random noise
// Each event declares what prices will be next period
const BASE_PRICES = { oil:80, food:40, tourism:120, agriculture:60 };

function pricesForEvent(ev) {
  if (!ev) return { ...BASE_PRICES };
  return {
    oil:         Math.round(BASE_PRICES.oil         * (ev.priceOil      || 1)),
    food:        Math.round(BASE_PRICES.food        * (ev.priceFood     || 1)),
    tourism:     Math.round(BASE_PRICES.tourism     * (ev.priceTourism  || 1)),
    agriculture: Math.round(BASE_PRICES.agriculture * (ev.priceAgri     || 1)),
  };
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
  const tA = att.tier==='B' ? 1.15 : 1.0;
  const tD = def.tier==='B' ? 1.15 : 1.0;
  const atkMult = 1 + (att.atk||0) * 0.012; // each atk point = +1.2% offensive
  const defMult = 1 + (def.def||0) * 0.012; // each def point = +1.2% defensive
  const cA = 1 + (att.combatBonus||0);
  const rA = 1 + Math.random()*0.18 + Math.random()*0.18;
  const rD = 1 + Math.random()*0.18 + Math.random()*0.18;
  const sA = att.army * atkMult * rA * tA * cA + (att.food||0)*0.06;
  const sD = def.army * defMult * rD * tD * 1.10 + (def.food||0)*0.06;
  return { attackerWins: sA>sD, scoreAtt:Math.round(sA), scoreDef:Math.round(sD) };
}

function calcPower(c) {
  const t = c.tier==='B' ? 1.15 : 1.0;
  // militarySpent tracks gold converted to ATK/DEF/Army so it doesn't penalize treasury
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

// EVENTS — moderate hints, effects primarily via price multipliers
const EVENTS = [
  // ── MARKET ─────────────────────────────────────────────────────────────
  { id:'oil_boom',    type:'market', w:1,
    hint:'🛢️ Les grandes puissances pétrolières réduisent leurs quotas de production. Les marchés à terme s'emballent — les analystes prévoient une tension durable sur l'offre mondiale.',
    title:'Choc pétrolier',       desc:'La production mondiale se contracte. Le baril s'envole.',
    effect:'Revenus pétrole ×5 · Prix pétrole ×4 (N+1) · Pétrole bloqué < 6000 pts',
    oilMultiplier:5, priceOil:4.0, blockOilBelowPower:6000 },

  { id:'tourism_boom',type:'market', w:1,
    hint:'✈️ Les restrictions sanitaires mondiales sont officiellement levées. Les aéroports signalent un retour massif du trafic international pour la prochaine saison.',
    title:'Saison touristique record', desc:'Le monde voyage de nouveau. L'industrie touristique rebondit.',
    effect:'Revenus tourisme ×5 · Prix tourisme −40% (N+1)',
    tourismMultiplier:5, priceTourism:0.6 },

  { id:'agri_boom',   type:'market', w:1,
    hint:'🌾 Des conditions météo exceptionnelles sur trois continents laissent présager des récoltes bien au-dessus des moyennes historiques cette année.',
    title:'Superproduction agricole', desc:'Conditions climatiques idéales, récoltes records partout.',
    effect:'Revenus agriculture ×5 · Nourriture +25% (N) · Prix agri −50% (N+1)',
    agriMultiplier:5, priceAgri:0.5, special:'agriBoost' },

  { id:'oil_crash',   type:'market', w:1,
    hint:'⚡ Plusieurs constructeurs automobiles annoncent simultanément l'abandon du moteur thermique d'ici 5 ans. Les marchés pétroliers réagissent nervosement.',
    title:'Transition énergétique', desc:'Le pétrole perd sa valeur stratégique en quelques semaines.',
    effect:'Pays pétrole > 200: −900 or (N) · Revenus pétrole ×0 · Prix pétrole −70% (N+1)',
    oilMultiplier:0, priceOil:0.3, special:'oilCrash' },

  { id:'sanctions',   type:'market', w:1,
    hint:'🏛️ Une coalition diplomatique inédite prépare des mesures coordonnées contre les économies les plus dominantes. Les ambassadeurs multiplient les consultations discrètes.',
    title:'Sanctions coordonnées',   desc:'Le G20 adopte des mesures punitives contre les grandes puissances.',
    effect:'Tier S et A: −1200 or (N) · 4 plus faibles: +400 or · Prix ressources +30% (N+1)',
    priceOil:1.3, priceFood:1.3, priceTourism:1.3, priceAgri:1.3, special:'sanctionsSA' },

  { id:'food_crisis', type:'market', w:1,
    hint:'🌡️ Les satellites agricoles confirment une sécheresse étendue dans plusieurs zones de production céréalière. Les stocks mondiaux sont au plus bas depuis une décennie.',
    title:'Crise alimentaire mondiale', desc:'Les greniers mondiaux se vident. La nourriture devient un luxe.',
    effect:'Pays < 200 nourr.: −35% puissance (N) · Prix nourriture ×4 (N+1) · Agri ×4',
    priceFood:4.0, agriMultiplier:4, special:'foodCrisisPenalty' },

  { id:'goldRush',    type:'market', w:1,
    hint:'⛏️ Des gisements exceptionnels sont confirmés simultanément sur trois continents. Les banques centrales envisagent une révision de leurs réserves stratégiques.',
    title:'Découverte aurifère massive', desc:'L'or afflue, les liquidités explosent.',
    effect:'Revenus de base ×3 · Prix toutes ressources +20% (N+1)',
    baseMultiplier:3, priceOil:1.2, priceFood:1.2, priceTourism:1.2, priceAgri:1.2 },

  { id:'tech_boom',   type:'market', w:1,
    hint:'💻 Un consortium technologique annonce une rupture dans la chaîne logistique mondiale. Les coûts de production industrielle pourraient chuter drastiquement selon les experts.',
    title:'Révolution industrielle 4.0', desc:'La productivité mondiale double. Les marchés s'enflamment.',
    effect:'Revenus de base ×2 · Prix toutes ressources −30% (N+1)',
    baseMultiplier:2, priceOil:0.7, priceFood:0.7, priceTourism:0.7, priceAgri:0.7 },

  // ── CHOICE ──────────────────────────────────────────────────────────────
  { id:'embargo',     type:'choice', w:1,
    hint:'🚢 Des tensions maritimes bloquent plusieurs routes commerciales stratégiques. Les nations exportatrices préparent des mesures de rétorsion.',
    title:'Embargo commercial',    desc:'Les routes maritimes sont coupées. Chaque nation doit choisir.',
    effect:'CHOIX: Sacrifier 400 pétrole (neutralité) OU Payer 1000 or + risque 50% de −500 pts · Prix pétrole ×2 (N+1)',
    priceOil:2.0,
    choiceA:{label:'Sacrifier 400 pétrole — neutralité garantie',cost:{oil:400},gain:{}},
    choiceB:{label:'Payer 1000 or + risque: 50% de −500 pts supplémentaires',cost:{treasury:1000},gain:{gamble:true,powerLoss:500}} },

  { id:'arms',        type:'choice', w:1,
    hint:'🔬 Des mouvements de troupes inhabituels sont signalés aux frontières de plusieurs régions. Les états-majors renforcent leur état d'alerte.',
    title:'Mobilisation militaire', desc:'Les frontières s'embrasent. Temps de choisir sa stratégie.',
    effect:'CHOIX: 600 or → +150 armée, −200 pts · OU 500 nourr → +100 armée, +25% combat · Prix armement ×1 (N+1)',
    choiceA:{label:'Achat d'armement (600 or → +150 armée, −200 pts popularité)',cost:{treasury:600},gain:{army:150,powerLoss:200}},
    choiceB:{label:'Mobilisation populaire (500 nourr → +100 armée, +25% bonus combat)',cost:{food:500},gain:{army:100,combatBonus:0.25}} },

  { id:'corruption',  type:'choice', w:1,
    hint:'🤫 Des fuites dans la presse internationale évoquent des irrégularités financières impliquant plusieurs gouvernements. Les bourses surveillent la situation.',
    title:'Scandale financier',    desc:'Des révélations compromettantes circulent. Avouer ou nier ?',
    effect:'CHOIX: Avouer (−300 or, −100 pts, certain) · OU Nier (50% rien / 50% −1200 or −400 pts) · Prix tourisme −20% (N+1)',
    priceTourism:0.8,
    choiceA:{label:'Reconnaître les faits (coût certain: −300 or, −100 pts)',cost:{treasury:300},gain:{powerLoss:100}},
    choiceB:{label:'Démentir (50% chance: rien / 50% chance: −1200 or et −400 pts)',cost:{},gain:{gamble:true,powerLoss:400,goldLoss:1200}} },

  { id:'warprep',     type:'choice', w:1,
    hint:'🔭 Les services de renseignement font circuler des évaluations alarmantes sur l'instabilité régionale. Les budgets de défense sont sous pression.',
    title:'Alerte stratégique',    desc:'La guerre est dans l'air. Deux stratégies s'affrontent.',
    effect:'CHOIX: 300 or → +150 pts puissance · OU 800 or → +250 armée · Prix armement ×1.5 (N+1)',
    choiceA:{label:'Renforcement défensif (300 or → +150 pts puissance)',cost:{treasury:300},gain:{power:150}},
    choiceB:{label:'Frappe préventive (800 or → +250 armée, −25% or restant)',cost:{treasury:800},gain:{army:250,goldPenalty:0.25}} },

  { id:'refugee',     type:'choice', w:1,
    hint:'🌊 Une instabilité régionale croissante génère des déplacements de population massifs. Les organisations internationales pressent les gouvernements d'agir.',
    title:'Crise humanitaire',     desc:'Des millions de réfugiés frappent à vos portes.',
    effect:'CHOIX: Accueillir (−400 nourr → +400 pts, +60 armée) · OU Refuser (−300 pts) · Prix nourriture +50% (N+1)',
    priceFood:1.5,
    choiceA:{label:'Accueillir (−400 nourriture → +400 pts puissance, +60 armée)',cost:{food:400},gain:{power:400,army:60}},
    choiceB:{label:'Refuser (vous perdez −300 pts de puissance)',cost:{},gain:{powerLoss:300}} },

  // ── TARGETED ────────────────────────────────────────────────────────────
  { id:'earthquake',  type:'targeted', w:2,
    hint:'🌋 Des relevés sismiques anormaux sont enregistrés dans plusieurs zones tectoniques actives. Les experts évoquent un risque accru pour les semaines à venir.',
    title:'Séisme majeur',        desc:'Le sol tremble. Un pays est frappé sans prévenir.',
    effect:'1 pays aléatoire: −55% nourriture, −500 pts · Prix agri +60% (N+1)',
    priceAgri:1.6, targetCount:1, effects:{foodLoss:0.55,powerLoss:500} },

  { id:'typhoon',     type:'targeted', w:2,
    hint:'🌀 Les stations météo signalent des formations tropicales d'intensité exceptionnelle dans l'Atlantique et le Pacifique simultanément. Les trajectoires restent incertaines.',
    title:'Typhons dévastateurs',  desc:'Deux super-tempêtes frappent les côtes simultanément.',
    effect:'2 pays aléatoires: −60% nourriture, −300 pts · Prix nourriture +40% (N+1)',
    priceFood:1.4, targetCount:2, effects:{foodLoss:0.60,powerLoss:300} },

  { id:'revolution',  type:'targeted', w:2,
    hint:'✊ Des mouvements sociaux coordonnés gagnent du terrain dans plusieurs pays développés. Les marchés anticipent une redistribution des équilibres économiques.',
    title:'Vague révolutionnaire',  desc:'Les peuples renversent les élites mondiales.',
    effect:'< 4500 pts: +400 or (N) · > 10000 pts: −500 or · Prix ressources de luxe −20% (N+1)',
    priceTourism:0.8, special:'revolution' },

  { id:'fmi',         type:'targeted', w:2,
    hint:'🏦 Le FMI tient une réunion d'urgence. Des plans de soutien massifs aux économies vulnérables sont en cours d'élaboration selon des sources proches du dossier.',
    title:'Plan FMI',              desc:'Le Fonds Monétaire International sauve les économies fragiles.',
    effect:'4 nations les plus faibles: +350 or, +70 armée · Prix ressources bas −15% (N+1)',
    priceOil:0.85, priceFood:0.85, priceAgri:0.85, special:'aidFMI' },

  { id:'uprising',    type:'targeted', w:2,
    hint:'📢 Des grèves générales paralysent plusieurs secteurs industriels dans les grandes puissances. Les pays émergents profitent du chaos social pour accélérer leur développement.',
    title:'Grèves et soulèvements', desc:'Le monde du travail se rebelle. Les émergents en profitent.',
    effect:'Tier B: +90 armée (N) · Tier S: −180 armée · Prix tourisme −25% (N+1)',
    priceTourism:0.75, special:'uprising' },

  { id:'tourismCrisis',type:'targeted', w:1,
    hint:'🔒 Une série d'incidents sécuritaires dans des sites très fréquentés génère des avis de voyage restrictifs dans plusieurs pays touristiques majeurs.',
    title:'Crise du tourisme',     desc:'Attentats et fermetures font chuter le tourisme mondial.',
    effect:'Tourisme > 200: −500 or (N) · Tourisme < 70: +250 or · Prix tourisme ×2 (N+1)',
    priceTourism:2.0, special:'tourismCrisis' },
];

function weightedRandom(pool) {
  const w=[];pool.forEach(e=>{for(let i=0;i<(e.w||1);i++)w.push(e);});
  return w[Math.floor(Math.random()*w.length)];
}
function generateSequence() {
  const seq=[];for(let i=0;i<6;i++)seq.push(weightedRandom(EVENTS));
  return seq;
}

const TUTORIAL_EV = { id:'tutorial', type:'market', title:'Manche Test', desc:'Explorez librement — ressources remises à zéro après. Aucune conséquence !', effect:'Actions illimitées' };

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",          subtitle:"Janvier — Juin · An 1" },
  { number:2, name:"Premières Tensions",            subtitle:"Juillet — Déc · An 1" },
  { number:3, name:"Crise Mondiale",                subtitle:"Janvier — Juin · An 2" },
  { number:4, name:"Course aux Armements",          subtitle:"Juillet — Déc · An 2" },
  { number:5, name:"Ultimatums",                    subtitle:"Janvier — Juin · An 3" },
  { number:6, name:"Le Monde Retient son Souffle",  subtitle:"Juillet — Déc · An 3" },
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
  prices: { ...BASE_PRICES }, prevPrices: { ...BASE_PRICES },
  eventMod:{oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0},
  coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},
  alliances:{}, pendingAllianceProposals:{},
  log:[], timerSeconds:600, timerRunning:false,
  warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30,
  teamActionsThisPeriod:{}, lastActionByTeam:{},
  pendingChoiceEvent:null, winner:null, winners:[],
  isTutorial:false, tutorialSnapshot:{}, gameOver:false,
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
    if(a1&&a1.type==='peace'&&a1.with===t2&&a2&&a2.type==='peace'&&a2.with===t1){
      gameState.gameOver=true;gameState.winners=alive;
      if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
      if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}
      io.emit('winner',{winners:gameState.winners,type:'alliance'});
      addLog(`🤝 Double victoire: ${alive[0].flag} & ${alive[1].flag} !`,'event');broadcast();
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
  socket.emit('state',gameState);
  socket.emit('timer',{seconds:gameState.timerSeconds,running:gameState.timerRunning});
  if(gameState.winners&&gameState.winners.length>0)socket.emit('winner',{winners:gameState.winners,type:gameState.winners.length>1?'alliance':'solo'});
  Object.entries(gameState.pendingAllianceProposals).forEach(([to,p])=>{if(p)socket.emit('allianceProposal',p);});

  socket.on('mj:startDraft',()=>{
    initCountries();gameState.phase='draft';gameState.currentPeriod=0;
    gameState.coalition={proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false};
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    gameState.alliances={};gameState.pendingAllianceProposals={};
    gameState.winner=null;gameState.winners=[];gameState.isTutorial=false;gameState.gameOver=false;
    gameState.nextHint=null;gameState.nextEvent=null;
    gameState.periodSequence=generateSequence();
    gameState.prices={...BASE_PRICES};gameState.prevPrices={...BASE_PRICES};
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
    Object.values(gameState.countries).forEach(c=>{if(gameState.tutorialSnapshot[c.id]){const s=gameState.tutorialSnapshot[c.id];c.oil=s.oil;c.food=s.food;c.tourism=s.tourism;c.agriculture=s.agriculture;c.army=s.army;c.atk=s.atk;c.def=s.def;c.treasury=s.treasury;c.militarySpent=s.militarySpent||0;c.defense=false;c.combatBonus=0;c.power=calcPower(c);}});
    gameState.isTutorial=false;gameState.teamActionsThisPeriod={};
    addLog('Tutorial terminé — ressources remises à zéro','event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'✅ Tutorial terminé ! Ressources remises à zéro. La vraie partie commence !','neutral');});broadcast();
  });

  socket.on('mj:startProsperity',()=>{
    gameState.phase='prosperity';gameState.currentPeriod=1;gameState.isTutorial=false;
    gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    const p=PERIODS[0];const ev=gameState.periodSequence[0]||weightedRandom(EVENTS);
    // Prices for period 1 = base (no previous event)
    gameState.prevPrices={...BASE_PRICES};
    gameState.prices={...BASE_PRICES};
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[0],periodNumber:1};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='market'||ev.type==='targeted')applyEvent(ev);
    else if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    const nev=gameState.periodSequence[1];
    gameState.nextEvent=nev||null;
    gameState.nextHint=nev?.hint||null;
    // Pre-set prices for NEXT period based on next event
    const nextPrices=nev?pricesForEvent(nev):{...BASE_PRICES};
    gameState.currentEvent.nextPrices=nextPrices;
    gameState.currentEvent.nextHint=gameState.nextHint;
    resetServerTimer(600);addLog(`Période 1 — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`📅 Période 1 — ${p.name}\n${PERIOD_DESCS[0]}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}\n\n🔮 Ce qui va arriver en Période 2:\n${gameState.nextHint||'(aucun indice)'}`, 'neutral');});
    broadcast();
  });

  socket.on('mj:nextPeriod',()=>{
    if(gameState.currentPeriod>=6)return;
    // Prices for this new period = prices announced by PREVIOUS event
    const prevEv=gameState.periodSequence[gameState.currentPeriod-1]; // was the current period
    const thisEv=gameState.periodSequence[gameState.currentPeriod];   // will be new period
    gameState.prevPrices={...gameState.prices};
    gameState.prices=prevEv?pricesForEvent(prevEv):{...BASE_PRICES};
    applyPeriodTransition();
    gameState.currentPeriod++;
    const p=PERIODS[gameState.currentPeriod-1];const ev=thisEv||weightedRandom(EVENTS);
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[gameState.currentPeriod-1],periodNumber:gameState.currentPeriod};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='market'||ev.type==='targeted')applyEvent(ev);
    else if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    const nev=gameState.periodSequence[gameState.currentPeriod];
    gameState.nextEvent=nev||null;
    const nextPrices=gameState.currentPeriod<6?(nev?pricesForEvent(nev):{...BASE_PRICES}):{...BASE_PRICES};
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
    addLog('💬 Phase de négociation — Alliances avant la guerre','event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'💬 PHASE DE NÉGOCIATION\nLa guerre commence bientôt. Proposez des alliances maintenant dans l\'onglet "Attaquer". Une alliance active au début de la guerre peut changer tout !','neutral');});
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

  socket.on('team:proposeAlliance',({fromTeam,toTeam,allianceType})=>{
    if(gameState.phase!=='war'&&gameState.phase!=='negotiation'){socket.emit('error','Alliances disponibles en phase de négociation ou guerre !');return;}
    const cost=allianceType==='offensive'?100:0;
    const team=gameState.teams[fromTeam];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    const fromCountry=Object.values(gameState.countries).find(cc=>cc.team===fromTeam);
    if(cost>0&&c.treasury<cost){socket.emit('error','Pas assez d\'or !');return;}
    const proposal={from:fromTeam,fromCountry:fromCountry?{flag:fromCountry.flag,name:fromCountry.name}:null,to:toTeam,type:allianceType,cost,expires:Date.now()+30000};
    gameState.pendingAllianceProposals[toTeam]=proposal;
    io.emit('allianceProposal',proposal);
    const toCountry=Object.values(gameState.countries).find(cc=>cc.team===toTeam);
    addTeamNews(toTeam,`🤝 ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam} vous propose une alliance ${allianceType==='offensive'?'offensive (+15% combat)':'de non-agression'}. Répondez !`,'neutral');
    setTimeout(()=>{if(gameState.pendingAllianceProposals[toTeam]===proposal){delete gameState.pendingAllianceProposals[toTeam];io.emit('allianceExpired',{to:toTeam});addTeamNews(fromTeam,`❌ Alliance avec ${toCountry?.name||toTeam} — pas de réponse`,'bad');}},30000);
  });

  socket.on('team:respondAlliance',({fromTeam,toTeam,accepted,allianceType})=>{
    delete gameState.pendingAllianceProposals[toTeam];
    const fromCountry=Object.values(gameState.countries).find(c=>c.team===fromTeam);
    const toCountry=Object.values(gameState.countries).find(c=>c.team===toTeam);
    if(!accepted){addTeamNews(fromTeam,`❌ Alliance refusée par ${toCountry?.flag||''} ${toCountry?.name||toTeam}`,'bad');io.emit('allianceExpired',{to:toTeam});broadcast();return;}
    const cost=allianceType==='offensive'?100:0;
    const propTeam=gameState.teams[fromTeam];if(propTeam?.country){const pc=gameState.countries[propTeam.country];if(cost>0)pc.treasury=Math.max(0,pc.treasury-cost);}
    const turnIdx=gameState.warCurrentTurn;
    gameState.alliances[fromTeam]={type:allianceType,with:toTeam,withCountryName:toCountry?.name||toTeam,withCountryFlag:toCountry?.flag||'',expires:turnIdx+(gameState.warTurnOrder.length||10)};
    gameState.alliances[toTeam]  ={type:allianceType,with:fromTeam,withCountryName:fromCountry?.name||fromTeam,withCountryFlag:fromCountry?.flag||'',expires:turnIdx+(gameState.warTurnOrder.length||10)};
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
    if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName){socket.emit('error',"Ce n'est pas votre tour !");return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const att=gameState.countries[team.country];const def=gameState.countries[targetId];
    if(!att||!def||att.eliminated||def.eliminated)return;
    const myAlliance=gameState.alliances[teamName];
    if(myAlliance&&myAlliance.type==='peace'&&myAlliance.with===def.team){socket.emit('error','Pacte de non-agression actif — attaque impossible !');return;}
    const costs={gold:150,oil:200,food:300};const pr=payWith||'gold';
    const cost=costs[pr]||150;const rk=pr==='gold'?'treasury':pr;
    if(att[rk]<cost){socket.emit('error',`Pas assez de ${pr==='gold'?'or':pr} ! (${cost} requis)`);return;}
    att[rk]-=cost;att.power=calcPower(att);
    if(myAlliance&&myAlliance.type==='offensive')att.combatBonus=(att.combatBonus||0)+0.15;
    const result=resolveCombat(att,def);
    const lA=Math.round(att.army*(result.attackerWins?0.12:0.28));
    const lD=Math.round(def.army*(result.attackerWins?0.35:0.10));
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
    delete gameState.alliances[teamName];
    broadcast();checkWinner();
    if(!gameState.gameOver)setTimeout(()=>nextWarTurn(),2000);
  });

  socket.on('team:skipTurn',({teamName})=>{if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName)return;addTeamNews(teamName,'Tour passé.','neutral');nextWarTurn();broadcast();});

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
    if(timerInterval)clearInterval(timerInterval);if(warTurnInterval)clearInterval(warTurnInterval);timerInterval=null;warTurnInterval=null;
    gameState={phase:'setup',currentPeriod:0,currentEvent:null,nextEvent:null,nextHint:null,periodSequence:[],countries:{},takenCountries:{},teams:{},prices:{...BASE_PRICES},prevPrices:{...BASE_PRICES},eventMod:{oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0},coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},alliances:{},pendingAllianceProposals:{},log:[],timerSeconds:600,timerRunning:false,warTurnOrder:[],warCurrentTurn:0,warTurnSeconds:30,teamActionsThisPeriod:{},lastActionByTeam:{},pendingChoiceEvent:null,winner:null,winners:[],isTutorial:false,tutorialSnapshot:{},gameOver:false};
    broadcast();io.emit('timer',{seconds:600,running:false});
  });
  socket.on('team:join',({teamName})=>{if(!gameState.teams[teamName])gameState.teams[teamName]={country:null,news:[]};broadcast();});
  socket.on('team:draftCountry',({teamName,countryId})=>{if(gameState.takenCountries[countryId]){socket.emit('error','Déjà pris !');return;}gameState.takenCountries[countryId]=teamName;gameState.teams[teamName].country=countryId;gameState.countries[countryId].team=teamName;addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} → ${teamName}`,'event');broadcast();});
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Geopolitica running on port ${PORT}`));
