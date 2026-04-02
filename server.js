
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
  // TIER S
  { id:'usa',     flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:900, oil:200, food:400, tourism:200, agriculture:120, army:350, population:330 },
  { id:'china',   flag:'🇨🇳', name:'Chine',        tier:'S', gold:850, oil:250, food:550, tourism:120, agriculture:180, army:320, population:1400 },
  // TIER A
  { id:'russia',  flag:'🇷🇺', name:'Russie',       tier:'A', gold:550, oil:520, food:220, tourism:60,  agriculture:90,  army:280, population:145 },
  { id:'germany', flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:650, oil:100, food:300, tourism:220, agriculture:130, army:240, population:83 },
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:720, oil:400, food:80,  tourism:250, agriculture:20,  army:180, population:3 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:600, oil:80,  food:360, tourism:280, agriculture:160, army:230, population:68 },
  { id:'japan',   flag:'🇯🇵', name:'Japon',        tier:'A', gold:700, oil:60,  food:280, tourism:300, agriculture:100, army:200, population:125 },
  { id:'turkey',  flag:'🇹🇷', name:'Turquie',      tier:'A', gold:480, oil:120, food:300, tourism:200, agriculture:150, army:260, population:85 },
  { id:'australia',flag:'🇦🇺',name:'Australie',    tier:'A', gold:550, oil:200, food:350, tourism:180, agriculture:200, army:190, population:26 },
  { id:'saudi',   flag:'🇸🇦', name:'Arabie S.',    tier:'A', gold:700, oil:600, food:60,  tourism:120, agriculture:20,  army:200, population:35 },
  // TIER B
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:420, oil:160, food:620, tourism:90,  agriculture:260, army:170, population:215 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:400, oil:100, food:580, tourism:130, agriculture:210, army:190, population:1400 },
  { id:'mexico',  flag:'🇲🇽', name:'Mexique',      tier:'B', gold:360, oil:180, food:420, tourism:160, agriculture:180, army:160, population:130 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:300, oil:60,  food:380, tourism:170, agriculture:190, army:140, population:37 },
  { id:'southafrica',flag:'🇿🇦',name:'Afrique S.', tier:'B', gold:320, oil:80,  food:350, tourism:140, agriculture:170, army:150, population:60 },
];

function getFoodConsumption(c) { return Math.max(2, Math.round(c.population / 8)); }

// Base prices — vary each period
const BASE_PRICES = { oil:80, food:40, tourism:120, agriculture:60 };

function generatePeriodPrices(eventMod) {
  const variance = () => 0.85 + Math.random() * 0.30; // ±15% random variance
  return {
    oil:         Math.round(BASE_PRICES.oil         * variance() * (eventMod?.priceOil    || 1)),
    food:        Math.round(BASE_PRICES.food        * variance() * (eventMod?.priceFood   || 1)),
    tourism:     Math.round(BASE_PRICES.tourism     * variance() * (eventMod?.priceTourism|| 1)),
    agriculture: Math.round(BASE_PRICES.agriculture * variance() * (eventMod?.priceAgri  || 1)),
  };
}

function getPassiveIncome(c, mod) {
  const oilInc  = Math.round((c.oil||0)         * 25 * (mod.oilMultiplier     || 1));
  const tourInc = Math.round((c.tourism||0)      * 25 * (mod.tourismMultiplier || 1));
  const agriInc = Math.round((c.agriculture||0)  * 20 * (mod.agriMultiplier   || 1));
  const baseInc = Math.round((80 + Math.random()*60 + c.population*0.04) * (mod.baseMultiplier || 1));
  return { oilInc, tourInc, agriInc, baseInc, total: oilInc+tourInc+agriInc+baseInc };
}

// EVENTS — each with clear but subtle hint, strong effects
const EVENTS = [
  // MARKET
  { id:'oil_boom',    type:'market', w:1,
    hint:'🛢️ L\'OPEP annonce une réduction de 40% de sa production. Les tankers se vident. Les analystes parlent du "choc pétrolier du siècle" — le pétrole va devenir une ressource rare et précieuse.',
    title:'Boom pétrolier historique', desc:'L\'OPEP réduit la production. Le baril s\'envole.', effect:'Revenus pétrole ×5 · Prix pétrole ×4 · Achat pétrole bloqué < 6000 pts', oilMultiplier:5, priceOil:4.0, blockOilBelowPower:6000 },
  { id:'tourism_boom',type:'market', w:1,
    hint:'✈️ L\'OMS déclare la fin de toutes les restrictions de voyage mondiales. Les agences de voyage enregistrent des réservations records. La saison touristique sera exceptionnelle — investissez dans le tourisme maintenant.',
    title:'Explosion du tourisme mondial', desc:'Fin des restrictions, boom des voyages mondiaux.', effect:'Revenus tourisme ×5 · Prix tourisme −40%', tourismMultiplier:5, priceTourism:0.6 },
  { id:'agri_boom',   type:'market', w:1,
    hint:'🌾 Des images satellitaires révèlent des récoltes exceptionnelles dans l\'hémisphère nord et sud simultanément. La FAO parle de "super-saison agricole". L\'agriculture va rapporter gros cette période.',
    title:'Révolution agricole mondiale', desc:'Super-saison agricole dans tous les hémisphères.', effect:'Revenus agriculture ×5 · Nourriture +25% à tous', agriMultiplier:5, special:'agriBoost' },
  { id:'oil_crash',   type:'market', w:1,
    hint:'⚡ Tesla, BYD et Toyota annoncent simultanément des voitures électriques à 8 000€. Les gouvernements subventionnent massivement la transition. Le pétrole perd de son attrait — les pays qui en ont trop vont souffrir.',
    title:'Effondrement pétrolier', desc:'La transition énergétique pulvérise la valeur du pétrole.', effect:'Pays pétrole > 200: −900 or · Revenus pétrole ×0', oilMultiplier:0, special:'oilCrash' },
  { id:'sanctions',   type:'market', w:1,
    hint:'🏛️ Une coalition de 40 pays prépare un plan de sanctions "sans précédent" contre les économies dominantes. Les ambassadeurs quittent les capitales. Les plus puissants vont payer très cher.',
    title:'Sanctions économiques massives', desc:'Le G20 punit les économies dominantes.', effect:'Tier S et A: −1200 or · 4 plus faibles: +400 or', special:'sanctionsSA' },
  { id:'food_crisis', type:'market', w:1,
    hint:'🌡️ La NASA confirme: 6 mois de sécheresse record sur 3 continents. Les prix alimentaires ont déjà doublé sur les marchés à terme. Les pays sans réserves alimentaires vont être frappés de plein fouet.',
    title:'Famine mondiale', desc:'Sécheresses record, réserves mondiales à sec.', effect:'Prix nourriture ×5 · Pays < 200 nourr.: −35% puissance · Agri ×4', priceFood:5.0, agriMultiplier:4, special:'foodCrisisPenalty' },
  { id:'goldRush',    type:'market', w:1,
    hint:'⛏️ Des prospecteurs confirment la découverte de gisements d\'or géants en Sibérie, en Amazonie et au Sahara. Les banques centrales s\'apprêtent à injecter massivement des liquidités. Les revenus de base vont exploser.',
    title:'Ruée vers l\'or', desc:'Gisements géants, injection massive de liquidités.', effect:'Revenus de base ×3', baseMultiplier:3 },
  { id:'tech_boom',   type:'market', w:1,
    hint:'💻 Un consortium tech mondial annonce une IA capable de doubler la productivité industrielle. Les nations qui adoptent vite vont voir leur économie s\'emballer. Les revenus généraux vont augmenter partout.',
    title:'Révolution technologique', desc:'L\'IA double la productivité mondiale.', effect:'Revenus de base ×2 · Prix toutes ressources −30%', baseMultiplier:2, priceOil:0.7, priceFood:0.7, priceTourism:0.7, priceAgri:0.7 },
  // CHOICE — hard dilemmas
  { id:'embargo',     type:'choice', w:1,
    hint:'🚢 Le détroit d\'Ormuz est bloqué par des tensions militaires. Les Nations Unies débattent d\'un embargo. Les pays devront choisir: sacrifier leurs ressources ou payer des pénalités massives. Préparez-vous.',
    title:'Embargo international', desc:'Le détroit d\'Ormuz fermé, l\'ONU impose un embargo.', effect:'CHOIX difficile: 400 pétrole (neutralité protège) OU 1000 or de sanctions (risque supplémentaire: 50% de perdre 500 pts)',
    choiceA:{label:'Sacrifier 400 pétrole (neutralité garantie)',cost:{oil:400},gain:{}},
    choiceB:{label:'Payer 1000 or + risque 50% de −500 pts',cost:{treasury:1000},gain:{gamble:true,powerLoss:500}} },
  { id:'arms',        type:'choice', w:1,
    hint:'🔬 Des images satellites montrent des mouvements de troupes massifs aux frontières. Les généraux recommandent une mobilisation immédiate. Vous devrez choisir entre force brute ou stratégie populaire — avec des conséquences réelles.',
    title:'Mobilisation militaire', desc:'Les frontières s\'embrasent, mobilisation générale.', effect:'CHOIX: 600 or → +150 armée (mais −200 pts popularité) OU 500 nourr → +100 armée +25% combat (mais risque famine)',
    choiceA:{label:'Investissement militaire (600 or → +150 armée, −200 pts)',cost:{treasury:600},gain:{army:150,powerLoss:200}},
    choiceB:{label:'Mobilisation populaire (500 nourr → +100 armée +25% combat)',cost:{food:500},gain:{army:100,combatBonus:0.25}} },
  { id:'corruption',  type:'choice', w:1,
    hint:'🤫 Des sources anonymes révèlent un scandale de corruption massif impliquant plusieurs gouvernements. Chaque pays doit choisir: avouer (coût limité) ou nier avec risque d\'être découvert et perdre beaucoup.',
    title:'Scandale de corruption', desc:'Le scandale éclate — avouer ou nier ?', effect:'CHOIX risqué: Avouer (−300 or, −100 pts) OU Nier (50% OK / 50% −1200 or −400 pts)',
    choiceA:{label:'Avouer (−300 or, −100 pts, coût certain)',cost:{treasury:300},gain:{powerLoss:100}},
    choiceB:{label:'Nier (50%: rien / 50%: −1200 or −400 pts)',cost:{},gain:{gamble:true,powerLoss:400,goldLoss:1200}} },
  { id:'warprep',     type:'choice', w:1,
    hint:'🔭 La CIA, le SVR et le MI6 publient simultanément des alertes de guerre imminente. Chaque nation doit arbitrer entre protection défensive ou frappe préventive. C\'est maintenant ou jamais — les deux options ont un vrai coût.',
    title:'Préparation de guerre', desc:'Guerre confirmée dans 6 mois — stratégie ?', effect:'CHOIX: Bunker +150 pts défense (coût 300 or) OU Frappe préventive +250 armée (800 or, −25% or restant)',
    choiceA:{label:'Défense renforcée (300 or → bunker +150 pts)',cost:{treasury:300},gain:{defense:true,power:150}},
    choiceB:{label:'Frappe préventive (800 or → +250 armée, −25% or restant)',cost:{treasury:800},gain:{army:250,goldPenalty:0.25}} },
  { id:'refugee',     type:'choice', w:1,
    hint:'🌊 Une crise humanitaire massive frappe les côtes: millions de réfugiés. Accepter rapporte politiquement mais coûte des ressources. Refuser préserve les stocks mais coûte en réputation. Les deux ont des conséquences concrètes.',
    title:'Crise des réfugiés', desc:'Des millions de réfugiés frappent à vos portes.', effect:'CHOIX: Accueillir (−400 nourr +400 pts armée goodwill) OU Refuser (−300 pts puissance diplomatique)',
    choiceA:{label:'Accueillir (−400 nourr, +400 pts, +60 armée)',cost:{food:400},gain:{power:400,army:60}},
    choiceB:{label:'Refuser (−300 pts puissance)',cost:{},gain:{powerLoss:300}} },
  // TARGETED
  { id:'earthquake',  type:'targeted', w:2,
    hint:'🌋 Les sismologues enregistrent des micro-séismes anormaux dans plusieurs zones tectoniques. Un "big one" est jugé probable à 70% dans les 6 prochains mois. Certains pays vont être durement frappés — aléatoirement.',
    title:'Séisme catastrophique', desc:'Le "big one" frappe sans prévenir.', effect:'1 pays aléatoire: −55% nourriture −500 pts', targetCount:1, effects:{foodLoss:0.55,powerLoss:500} },
  { id:'typhoon',     type:'targeted', w:2,
    hint:'🌀 La NOAA et Météo-France alertent: formation de super-typhons d\'une violence inédite dans l\'Atlantique et le Pacifique. Les trajectoires restent imprévisibles. 2 pays pourraient être frappés simultanément.',
    title:'Super typhon', desc:'Deux super-typhons simultanés ravagent les côtes.', effect:'2 pays aléatoires: −60% nourriture −300 pts', targetCount:2, effects:{foodLoss:0.60,powerLoss:300} },
  { id:'revolution',  type:'targeted', w:2,
    hint:'✊ Des mouvements révolutionnaires coordonnés secouent les capitales mondiales. Les marchés financiers s\'effondrent pour les puissants. Les émergents en profitent. Les riches vont perdre, les pauvres vont gagner.',
    title:'Révolution mondiale', desc:'Les peuples renversent l\'ordre établi.', effect:'Pays < 4500 pts: +400 or · Pays > 10000 pts: −500 or', special:'revolution' },
  { id:'fmi',         type:'targeted', w:2,
    hint:'🏦 Le FMI convoque une réunion d\'urgence. Des milliards vont être injectés dans les économies les plus fragiles. Si vous êtes parmi les 4 plus faibles, vous allez recevoir une aide massive — une chance de rattraper.',
    title:'Intervention FMI', desc:'Plan de sauvetage massif pour les économies fragiles.', effect:'4 nations les plus faibles: +350 or +70 armée', special:'aidFMI' },
  { id:'uprising',    type:'targeted', w:2,
    hint:'📢 Des syndicats et mouvements populaires organisent des grèves générales coordonnées. Les émergents en profitent pour s\'armer. Les superpuissances voient leur armée déserter massivement. Tier B: préparez-vous à en profiter.',
    title:'Soulèvement populaire', desc:'Les émergents s\'arment, les superpuissances désertent.', effect:'Tier B: +90 armée · Tier S: −180 armée', special:'uprising' },
  { id:'tourismCrisis',type:'targeted', w:1,
    hint:'🔒 Plusieurs attentats dans des lieux touristiques majeurs secouent le monde. Les gouvernements émettent des avis de voyage négatifs. Les pays très touristiques vont perdre massivement — les autres en bénéficieront.',
    title:'Crise du tourisme', desc:'Attentats, fermeture des frontières touristiques.', effect:'Pays tourisme > 200: −500 or · Pays tourisme < 70: +250 or', special:'tourismCrisis' },
];

function weightedRandom(pool) {
  const w=[];pool.forEach(e=>{for(let i=0;i<(e.w||1);i++)w.push(e);});
  return w[Math.floor(Math.random()*w.length)];
}

function generateSequence() {
  const seq=[];for(let i=0;i<6;i++)seq.push(weightedRandom(EVENTS));
  return seq;
}

const TUTORIAL_EV = { id:'tutorial', type:'market', title:'Manche Test', desc:'Explorez librement — ressources remises à zéro après. Aucune conséquence !', effect:'Actions illimitées, tout est gratuit à essayer' };

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",          subtitle:"Janvier — Juin · An 1" },
  { number:2, name:"Premières Tensions",            subtitle:"Juillet — Déc · An 1" },
  { number:3, name:"Crise Mondiale",                subtitle:"Janvier — Juin · An 2" },
  { number:4, name:"Course aux Armements",          subtitle:"Juillet — Déc · An 2" },
  { number:5, name:"Ultimatums",                    subtitle:"Janvier — Juin · An 3" },
  { number:6, name:"Le Monde Retient son Souffle",  subtitle:"Juillet — Déc · An 3" },
];

const PERIOD_DESCS = [
  "Les marchés s'ouvrent. Regardez l'indice ci-dessous — il préfigure l'événement de la prochaine période. Achetez pétrole, tourisme ou agriculture pour générer des revenus passifs (~25 or/unité). ⚔️ Gardez 500 or pour la guerre ! 2 actions.",
  "Les intérêts divergent. Analysez l'indice attentivement — si ça parle de pétrole, achetez-en. Si ça parle de famine, stockez de la nourriture. ⚔️ Minimum 500 or en réserve. 2 actions.",
  "Catastrophe mondiale. Si un événement CHOIX arrive: vraiment dur — les deux options ont un coût réel, choisissez le moindre mal. ⚔️ Commencez à investir en armée. 2 actions.",
  "La guerre approche. Renforcez votre armée. Bunker (200 or) = −15% dommages reçus. ⚔️ Minimum 600 or en réserve (4 attaques). 2 actions.",
  "AVANT-DERNIÈRE PÉRIODE. C'est votre dernière vraie chance d'investir. Après la période 6, la GUERRE commence. ⚔️ Gardez 600 or. 2 actions.",
  "DERNIÈRE PÉRIODE DE PAIX. Plus aucun achat en guerre. ⚔️ UNE ATTAQUE COÛTE 150 OR — gardez au moins 600 or. Convertissez tout en armée ou bunker. Dernière chance absolue. 2 actions.",
];

let gameState = {
  phase:'setup', currentPeriod:0, currentEvent:null, nextHint:null,
  periodSequence:[], countries:{}, takenCountries:{}, teams:{},
  prices:{ oil:80, food:40, tourism:120, agriculture:60 },
  eventMod:{ oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0 },
  coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},
  alliances:{}, pendingAllianceProposals:{},
  log:[], timerSeconds:600, timerRunning:false,
  warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30,
  teamActionsThisPeriod:{}, lastActionByTeam:{},
  pendingChoiceEvent:null, winner:null, winners:[], // support double winner
  isTutorial:false, tutorialSnapshot:{}, gameOver:false,
};

let timerInterval=null, warTurnInterval=null;

function initCountries() {
  gameState.countries={};
  COUNTRIES.forEach(c=>{
    gameState.countries[c.id]={...c,treasury:c.gold,power:calcPower({...c,treasury:c.gold}),eliminated:false,defense:false,team:null,combatBonus:0};
  });
}

function calcPower(c) {
  const t=c.tier==='B'?1.15:c.tier==='S'?1.0:1.0;
  return Math.max(0,Math.round((c.army*10+(c.treasury||0)*0.25+(c.oil||0)*0.8+(c.tourism||0)*0.6+(c.agriculture||0)*0.5+(c.food||0)*1.2)*t));
}

function resolveCombat(att,def) {
  const tA=att.tier==='B'?1.15:1.0, tD=def.tier==='B'?1.15:1.0;
  const cA=1+(att.combatBonus||0);
  const rA=1+Math.random()*0.20+Math.random()*0.20;
  const rD=1+Math.random()*0.20+Math.random()*0.20;
  const sA=att.power*rA*tA*cA+(att.food||0)*0.07;
  const sD=def.power*rD*tD*1.15+(def.food||0)*0.07+(def.defense?def.power*0.15:0); // bunker reduced to 0.15
  return {attackerWins:sA>sD,scoreAtt:Math.round(sA),scoreDef:Math.round(sD)};
}

function addLog(text,type){gameState.log.unshift({text,type,time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});if(gameState.log.length>120)gameState.log=gameState.log.slice(0,120);}
function addTeamNews(teamName,text,type){if(!gameState.teams[teamName])return;gameState.teams[teamName].news=gameState.teams[teamName].news||[];gameState.teams[teamName].news.push({text,type,time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});}
function broadcast(){io.emit('state',gameState);}

function applyEvent(ev) {
  gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
  const priceEv={priceOil:ev.priceOil||1,priceFood:ev.priceFood||1,priceTourism:ev.priceTourism||1,priceAgri:ev.priceAgri||1};
  if(ev.oilMultiplier!==undefined)     gameState.eventMod.oilMultiplier=ev.oilMultiplier;
  if(ev.tourismMultiplier!==undefined) gameState.eventMod.tourismMultiplier=ev.tourismMultiplier;
  if(ev.agriMultiplier!==undefined)    gameState.eventMod.agriMultiplier=ev.agriMultiplier;
  if(ev.baseMultiplier!==undefined)    gameState.eventMod.baseMultiplier=ev.baseMultiplier;
  if(ev.blockOilBelowPower)            gameState.eventMod.blockOilBelowPower=ev.blockOilBelowPower;
  gameState.prices=generatePeriodPrices(priceEv);
  if(ev.special==='oilCrash')       Object.values(gameState.countries).forEach(c=>{if(!c.eliminated&&c.oil>200){c.treasury=Math.max(0,c.treasury-900);c.power=calcPower(c);addTeamNews(c.team,'💥 Effondrement pétrolier: −900 or !','bad');}});
  if(ev.special==='agriBoost')      Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){c.food=Math.round(c.food*1.25);c.power=calcPower(c);addTeamNews(c.team,'🌾 Super-saison: +25% nourriture !','good');}});
  if(ev.special==='foodCrisisPenalty') Object.values(gameState.countries).forEach(c=>{if(!c.eliminated&&c.food<200){const l=Math.round(c.power*0.35);c.power=Math.max(0,c.power-l);addTeamNews(c.team,`🚨 Famine: stocks trop faibles — −${l} pts !`,'bad');}});
  if(ev.special==='sanctionsSA')    {Object.values(gameState.countries).forEach(c=>{if(!c.eliminated&&(c.tier==='S'||c.tier==='A')){c.treasury=Math.max(0,c.treasury-1200);c.power=calcPower(c);addTeamNews(c.team,'⚠️ Sanctions G20: −1200 or !','bad');}});const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,4);alive.forEach(c=>{c.treasury+=400;c.power=calcPower(c);addTeamNews(c.team,'💰 Aide compensatoire: +400 or !','good');});}
  if(ev.special==='revolution')     Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){if(c.power<4500){c.treasury+=400;c.power=calcPower(c);addTeamNews(c.team,'✊ Révolution: +400 or !','good');}if(c.power>10000){c.treasury=Math.max(0,c.treasury-500);c.power=calcPower(c);addTeamNews(c.team,'✊ Révolution: −500 or !','bad');}}});
  if(ev.special==='aidFMI')         {const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,4);alive.forEach(c=>{c.treasury+=350;c.army+=70;c.power=calcPower(c);addTeamNews(c.team,'🏦 FMI: +350 or +70 armée !','good');});}
  if(ev.special==='uprising')       Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){if(c.tier==='B'){c.army+=90;c.power=calcPower(c);addTeamNews(c.team,'✊ Soulèvement: +90 armée !','good');}if(c.tier==='S'){c.army=Math.max(0,c.army-180);c.power=calcPower(c);addTeamNews(c.team,'✊ Désertion: −180 armée !','bad');}}});
  if(ev.special==='tourismCrisis')  Object.values(gameState.countries).forEach(c=>{if(!c.eliminated){if(c.tourism>200){c.treasury=Math.max(0,c.treasury-500);c.power=calcPower(c);addTeamNews(c.team,'✈️ Crise tourisme: −500 or !','bad');}else if(c.tourism<70){c.treasury+=250;c.power=calcPower(c);addTeamNews(c.team,'✈️ Report touristes: +250 or !','good');}}});
  if(ev.effects){const alive=Object.values(gameState.countries).filter(c=>!c.eliminated);alive.sort(()=>Math.random()-0.5).slice(0,ev.targetCount||1).forEach(c=>{if(ev.effects.foodLoss){const l=Math.round(c.food*ev.effects.foodLoss);c.food=Math.max(0,c.food-l);c.power=calcPower(c);addTeamNews(c.team,`🌋 ${ev.title}: −${l} nourriture !`,'bad');addLog(`${ev.title}: ${c.flag} −${l} nourr`,'event');}if(ev.effects.powerLoss){c.power=Math.max(0,c.power-ev.effects.powerLoss);addTeamNews(c.team,`🌋 ${ev.title}: −${ev.effects.powerLoss} pts !`,'bad');}});}
}

function applyPeriodTransition() {
  gameState.eventMod={oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0};
  Object.values(gameState.countries).forEach(c=>{
    if(c.eliminated)return;
    // Food consumption
    const need=getFoodConsumption(c);
    if(c.food>=need){c.food-=need;addTeamNews(c.team,`🍞 Consommation: −${need} nourriture (pop. ${c.population}M)`,'neutral');}
    else{const def=need-c.food;c.food=0;const loss=Math.round(def*(c.population/10)*2);c.power=Math.max(0,c.power-loss);addTeamNews(c.team,`⚠️ FAMINE ! −${def} nourriture → −${loss} pts !`,'bad');addLog(`Famine: ${c.flag} −${loss} pts`,'event');}
    // Passive income
    const inc=getPassiveIncome(c,gameState.eventMod);
    c.treasury+=inc.total;
    addTeamNews(c.team,`💰 Revenus: Pétrole +${inc.oilInc} | Tourisme +${inc.tourInc} | Agriculture +${inc.agriInc} | Base +${inc.baseInc} = +${inc.total} or`,'good');
    // Inactivity penalty
    const used=(gameState.teamActionsThisPeriod[c.team]||0);
    if(used===0&&c.team&&!gameState.isTutorial){c.power=Math.max(0,c.power-100);addTeamNews(c.team,'😴 Inactivité: aucune action cette période — −100 pts de puissance !','bad');}
    c.defense=false;c.combatBonus=0;c.power=calcPower(c);
  });
  // New prices with variance
  gameState.prices=generatePeriodPrices({});
  gameState.teamActionsThisPeriod={};
  gameState.lastActionByTeam={};
  gameState.alliances={};
}

function startServerTimer(s){if(timerInterval)clearInterval(timerInterval);if(gameState.gameOver)return;gameState.timerSeconds=s;gameState.timerRunning=true;timerInterval=setInterval(()=>{if(gameState.gameOver){clearInterval(timerInterval);timerInterval=null;gameState.timerRunning=false;return;}if(gameState.timerSeconds>0){gameState.timerSeconds--;io.emit('timer',{seconds:gameState.timerSeconds,running:true});}else{clearInterval(timerInterval);timerInterval=null;gameState.timerRunning=false;io.emit('timer',{seconds:0,running:false,ended:true});}},1000);}
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
    // Check if both have a non-aggression pact
    const t1=alive[0].team,t2=alive[1].team;
    const a1=gameState.alliances[t1],a2=gameState.alliances[t2];
    if(a1&&a1.type==='peace'&&a1.with===t2&&a2&&a2.type==='peace'&&a2.with===t1){
      gameState.gameOver=true;gameState.winners=alive;
      if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
      if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}
      io.emit('winner',{winners:gameState.winners,type:'alliance'});
      addLog(`🤝 ${alive[0].flag} ${alive[1].flag} — Double victoire par alliance de non-agression !`,'event');broadcast();
    }
  }
}

function startWarTurn(){const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);gameState.warTurnOrder=alive.map(c=>c.team);gameState.warCurrentTurn=0;advanceWarTurn();}
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
  warTurnInterval=setInterval(()=>{if(gameState.gameOver){clearInterval(warTurnInterval);return;}gameState.warTurnSeconds--;io.emit('warTurnTimer',{seconds:gameState.warTurnSeconds,team});if(gameState.warTurnSeconds<=0){clearInterval(warTurnInterval);addTeamNews(team,'⏰ Tour passé !','bad');gameState.warCurrentTurn++;advanceWarTurn();}},1000);
}
function nextWarTurn(){if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}gameState.warCurrentTurn++;advanceWarTurn();}

io.on('connection',(socket)=>{
  socket.emit('state',gameState);
  socket.emit('timer',{seconds:gameState.timerSeconds,running:gameState.timerRunning});
  if(gameState.winners&&gameState.winners.length>0)socket.emit('winner',{winners:gameState.winners,type:gameState.winners.length>1?'alliance':'solo'});
  Object.entries(gameState.pendingAllianceProposals).forEach(([to,p])=>{if(p)socket.emit('allianceProposal',p);});

  socket.on('mj:startDraft',()=>{initCountries();gameState.phase='draft';gameState.currentPeriod=0;gameState.coalition={proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false};gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};gameState.alliances={};gameState.pendingAllianceProposals={};gameState.winner=null;gameState.winners=[];gameState.isTutorial=false;gameState.gameOver=false;gameState.nextHint=null;gameState.periodSequence=generateSequence();gameState.prices=generatePeriodPrices({});resetServerTimer(600);addLog('Draft démarré','event');broadcast();});

  socket.on('mj:startTutorial',()=>{
    gameState.phase='prosperity';gameState.currentPeriod=0;gameState.isTutorial=true;gameState.teamActionsThisPeriod={};gameState.tutorialSnapshot={};
    Object.values(gameState.countries).forEach(c=>{if(c.team)gameState.tutorialSnapshot[c.id]={...c};});
    const hint=gameState.periodSequence[0]?.hint||'Regardez bien les indices — ils vous donnent un avantage stratégique énorme !';
    gameState.currentEvent={...TUTORIAL_EV,periodName:'Manche Test — Découverte',periodSubtitle:'Tutorial · Ressources remises à zéro après',periodDesc:'Bienvenue ! Cette manche ne compte pas. Explorez librement: achetez, vendez, essayez le bunker. Les ressources seront remises à zéro. 2 actions normales lors des vraies périodes.',periodNumber:0};
    gameState.nextHint=hint;gameState.prices=generatePeriodPrices({});resetServerTimer(300);
    addLog('Manche Test démarrée (5 min)','event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`🎮 MANCHE TEST\nExplorez librement — tout sera remis à zéro !\n\n🔮 Indice de la vraie Période 1:\n${hint}`,'neutral');});
    broadcast();
  });

  socket.on('mj:endTutorial',()=>{
    Object.values(gameState.countries).forEach(c=>{if(gameState.tutorialSnapshot[c.id]){const s=gameState.tutorialSnapshot[c.id];c.oil=s.oil;c.food=s.food;c.tourism=s.tourism;c.agriculture=s.agriculture;c.army=s.army;c.treasury=s.treasury;c.defense=false;c.combatBonus=0;c.power=calcPower(c);}});
    gameState.isTutorial=false;gameState.teamActionsThisPeriod={};
    addLog('Manche Test terminée — ressources remises à zéro','event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,'✅ Tutorial terminé ! Ressources remises à zéro. La vraie partie commence !','neutral');});broadcast();
  });

  socket.on('mj:startProsperity',()=>{
    gameState.phase='prosperity';gameState.currentPeriod=1;gameState.isTutorial=false;gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};
    const p=PERIODS[0];const ev=gameState.periodSequence[0]||weightedRandom(EVENTS);
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[0],periodNumber:1};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='market'||ev.type==='targeted')applyEvent(ev);
    else if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    const nev=gameState.periodSequence[1];gameState.nextHint=nev?.hint||null;
    resetServerTimer(600);addLog(`Période 1 — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`📅 Période 1 — ${p.name}\n${PERIOD_DESCS[0]}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}\n\n🔮 Indice Période 2:\n${gameState.nextHint||'(aucun indice)'}`, 'neutral');});
    broadcast();
  });

  socket.on('mj:nextPeriod',()=>{
    if(gameState.currentPeriod>=6)return;
    applyPeriodTransition();gameState.currentPeriod++;
    const p=PERIODS[gameState.currentPeriod-1];const ev=gameState.periodSequence[gameState.currentPeriod-1]||weightedRandom(EVENTS);
    gameState.currentEvent={...ev,periodName:p.name,periodSubtitle:p.subtitle,periodDesc:PERIOD_DESCS[gameState.currentPeriod-1],periodNumber:gameState.currentPeriod};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='market'||ev.type==='targeted')applyEvent(ev);
    else if(ev.type==='choice'){gameState.pendingChoiceEvent=ev;io.emit('choiceEvent',ev);}
    const nev=gameState.periodSequence[gameState.currentPeriod];
    gameState.nextHint=gameState.currentPeriod<6?(nev?.hint||null):'⚔️ La GUERRE commence après cette période. Gardez au moins 600 or pour attaquer (150 or/attaque). Bunker = −15% dégâts reçus (200 or).';
    resetServerTimer(600);addLog(`Période ${gameState.currentPeriod} — ${p.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{if(c.team)addTeamNews(c.team,`📅 Période ${gameState.currentPeriod} — ${p.name}\n${PERIOD_DESCS[gameState.currentPeriod-1]}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}\n\n🔮 Indice ${gameState.currentPeriod<6?`Période ${gameState.currentPeriod+1}`:'GUERRE'}:\n${gameState.nextHint||'(aucun indice)'}`,'neutral');});
    broadcast();
  });

  socket.on('mj:startWar',()=>{
    gameState.phase='war';gameState.currentEvent=null;gameState.pendingChoiceEvent=null;gameState.teamActionsThisPeriod={};gameState.lastActionByTeam={};gameState.alliances={};gameState.pendingAllianceProposals={};
    gameState.coalition={proposed:true,moroccoAccepted:false,guineaAccepted:false,active:false};
    resetServerTimer(600);addLog('⚔️ GUERRE MONDIALE DÉMARRÉE','attack');
    if(gameState.countries.morocco?.team)addTeamNews(gameState.countries.morocco.team,'🤝 Coalition proposée avec le Maroc/Guinée !','neutral');
    if(gameState.countries.southafrica?.team)addTeamNews(gameState.countries.southafrica.team,'🤝 Coalition possible avec les pays africains !','neutral');
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
      if(chosen.gain.defense){c.defense=true;msg+=`+bunker `;}
      if(chosen.gain.combatBonus){c.combatBonus=(c.combatBonus||0)+chosen.gain.combatBonus;msg+=`+${Math.round(chosen.gain.combatBonus*100)}% combat `;}
      if(chosen.gain.goldPenalty){const penalty=Math.round(c.treasury*chosen.gain.goldPenalty);c.treasury=Math.max(0,c.treasury-penalty);msg+=`−${penalty} or (pénalité) `;}
      if(chosen.gain.gamble){
        if(chosen.gain.goldLoss){if(Math.random()<0.5){const gL=chosen.gain.goldLoss;c.treasury=Math.max(0,c.treasury-gL);c.power=Math.max(0,c.power-(chosen.gain.powerLoss||0));msg+=`DÉCOUVERT: −${gL} or −${chosen.gain.powerLoss||0} pts `;}else{msg+=`Non découvert (chance !) `;}}
        else{if(Math.random()<0.5){c.power=Math.max(0,c.power-(chosen.gain.powerLoss||0));msg+=`DÉCOUVERT: −${chosen.gain.powerLoss||0} pts `;}else{msg+=`Non découvert (chance !) `;}}
      }
    }
    c.power=calcPower(c);
    addTeamNews(teamName,`✅ Choix "${chosen.label}": ${msg}`,'good');
    addLog(`${c.flag} choisit: ${chosen.label}`,'event');broadcast();
  });

  // UNDO last action
  socket.on('team:undoAction',({teamName})=>{
    if(gameState.phase==='war'){socket.emit('error','Impossible d\'annuler en phase de guerre !');return;}
    const last=gameState.lastActionByTeam[teamName];if(!last){socket.emit('error','Aucune action à annuler !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    // Reverse the action
    c.treasury=last.treasury;c.oil=last.oil;c.food=last.food;c.tourism=last.tourism;c.agriculture=last.agriculture;c.army=last.army;c.power=calcPower(c);
    const actions=gameState.teamActionsThisPeriod[teamName]||0;
    if(actions>0)gameState.teamActionsThisPeriod[teamName]=actions-1;
    gameState.lastActionByTeam[teamName]=null;
    addTeamNews(teamName,'↩️ Dernière action annulée (Ctrl+Z)','neutral');
    socket.emit('actionUndone');broadcast();
  });

  socket.on('team:proposeAlliance',({fromTeam,toTeam,allianceType})=>{
    if(gameState.phase!=='war'){socket.emit('error','Alliances disponibles en guerre seulement !');return;}
    const cost=allianceType==='offensive'?100:0;
    const team=gameState.teams[fromTeam];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    const fromCountry=Object.values(gameState.countries).find(cc=>cc.team===fromTeam);
    if(cost>0&&c.treasury<cost){socket.emit('error','Pas assez d\'or !');return;}
    const proposal={from:fromTeam,fromCountry:fromCountry?{flag:fromCountry.flag,name:fromCountry.name}:null,to:toTeam,type:allianceType,cost,expires:Date.now()+30000};
    gameState.pendingAllianceProposals[toTeam]=proposal;
    io.emit('allianceProposal',proposal);
    const toCountry=Object.values(gameState.countries).find(cc=>cc.team===toTeam);
    addTeamNews(toTeam,`🤝 ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam} propose une alliance ${allianceType==='offensive'?'offensive (+15% combat, 100 or)':'de non-agression (gratuite)'}. Répondez rapidement !`,'neutral');
    setTimeout(()=>{if(gameState.pendingAllianceProposals[toTeam]===proposal){delete gameState.pendingAllianceProposals[toTeam];io.emit('allianceExpired',{to:toTeam});addTeamNews(fromTeam,`❌ Alliance avec ${toCountry?.name||toTeam} — pas de réponse (expirée)`,'bad');}},30000);
  });

  socket.on('team:respondAlliance',({fromTeam,toTeam,accepted,allianceType})=>{
    delete gameState.pendingAllianceProposals[toTeam];
    const fromCountry=Object.values(gameState.countries).find(c=>c.team===fromTeam);
    const toCountry=Object.values(gameState.countries).find(c=>c.team===toTeam);
    if(!accepted){addTeamNews(fromTeam,`❌ Alliance refusée par ${toCountry?.flag||''} ${toCountry?.name||toTeam}`,'bad');io.emit('allianceExpired',{to:toTeam});broadcast();return;}
    const cost=allianceType==='offensive'?100:0;
    const propTeam=gameState.teams[fromTeam];if(propTeam&&propTeam.country){const pc=gameState.countries[propTeam.country];if(cost>0)pc.treasury=Math.max(0,pc.treasury-cost);}
    const turnIdx=gameState.warCurrentTurn;
    gameState.alliances[fromTeam]={type:allianceType,with:toTeam,withCountryName:toCountry?.name||toTeam,withCountryFlag:toCountry?.flag||'',expires:turnIdx+gameState.warTurnOrder.length};
    gameState.alliances[toTeam]={type:allianceType,with:fromTeam,withCountryName:fromCountry?.name||fromTeam,withCountryFlag:fromCountry?.flag||'',expires:turnIdx+gameState.warTurnOrder.length};
    addTeamNews(fromTeam,`✅ Alliance ${allianceType} avec ${toCountry?.flag||''} ${toCountry?.name||toTeam} — 1 tour !`,'good');
    addTeamNews(toTeam,`✅ Alliance ${allianceType} avec ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam} — 1 tour !`,'good');
    addLog(`🤝 Alliance ${allianceType}: ${fromCountry?.flag||''} ${fromCountry?.name||fromTeam} & ${toCountry?.flag||''} ${toCountry?.name||toTeam}`,'event');
    broadcast();checkWinner();
  });

  socket.on('team:acceptCoalition',({teamName})=>{
    const c=Object.values(gameState.countries).find(c=>c.team===teamName);if(!c)return;
    if(c.id==='morocco')gameState.coalition.moroccoAccepted=true;
    if(c.id==='southafrica')gameState.coalition.guineaAccepted=true;
    if(gameState.coalition.moroccoAccepted&&gameState.coalition.guineaAccepted){
      gameState.coalition.active=true;
      const m=gameState.countries.morocco,s=gameState.countries.southafrica;
      if(m&&s){const bG=Math.round(s.treasury*0.25),bO=Math.round(s.oil*0.25),bF=Math.round(s.food*0.25),bA=Math.round(s.army*0.25);m.treasury+=bG;m.oil+=bO;m.food+=bF;m.army+=bA;m.power=calcPower(m);s.power=calcPower(s);addLog('🤝 Coalition Maroc-Afrique du Sud: +25% ressources !','event');}
    }else addTeamNews(teamName,"✅ Accepté — en attente...",'neutral');
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
      att.army=Math.max(0,att.army-lA);
      def.treasury=0;def.oil=0;def.food=0;def.army=0;def.tourism=0;def.agriculture=0;
      att.power=calcPower(att);def.power=calcPower(def);
      addLog(`💥 ${att.flag} écrase ${def.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`🏆 VICTOIRE vs ${def.flag} ${def.name} ! Toutes ressources pillées. −${lA} armée`,'good');
      addTeamNews(def.team,`💀 DÉFAITE vs ${att.flag} ${att.name} — tout pillé. −${lD} armée`,'bad');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:true,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
      if(def.army<=0&&def.treasury<=0){def.eliminated=true;addLog(`☠️ ${def.flag} ${def.name} éliminé !`,'eliminated');addTeamNews(def.team,'☠️ Nation anéantie.','bad');}
    }else{
      const gL=Math.round(att.treasury*0.35);att.treasury=Math.max(0,att.treasury-gL);
      att.army=Math.max(0,att.army-lA);def.army=Math.max(0,def.army-lD);
      att.power=calcPower(att);def.power=calcPower(def);
      addLog(`🛡️ ${def.flag} repousse ${att.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`❌ Échec vs ${def.flag} ${def.name} — −${gL} or, −${lA} armée`,'bad');
      addTeamNews(def.team,`🛡️ Repoussé ${att.flag} ! −${lD} armée défensives`,'good');
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
    if(resource==='oil'&&!gameState.isTutorial&&(gameState.eventMod.blockOilBelowPower||0)>0&&c.power<gameState.eventMod.blockOilBelowPower){socket.emit('error',`Achat pétrole bloqué (boom actif) !`);return;}
    const price=gameState.prices[resource]||80;const total=price*qty;
    if(c.treasury<total){socket.emit('error',"Pas assez d'or !");return;}
    // Save snapshot for undo
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army};
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
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army};
    c[resource]-=qty;c.treasury+=total;c.power=calcPower(c);
    addTeamNews(teamName,`💰 Vente: −${qty} ${resource} → +${total} or`,'good');
    socket.emit('actionFeedback',{type:'sell',resource,qty,total});broadcast();
  });

  socket.on('team:recruitArmy',({teamName,qty,type})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun recrutement en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    const costPer=type==='tech'?300:150;const powerPer=type==='tech'?50:20;const armyPer=type==='tech'?0:1;
    const cost=Math.round(costPer*qty);if(c.treasury<cost){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army};
    c.treasury-=cost;c.army+=qty*armyPer;c.power=calcPower(c);
    // Also boost power directly for tech
    if(type==='tech')c.power+=qty*powerPer;
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`✅ Recrutement: +${qty*armyPer} armée / +${qty*powerPer} pts pour ${cost} or${gameState.isTutorial?' (tutorial)':''}`,'good');
    socket.emit('actionFeedback',{type:'army',qty:qty*armyPer,power:qty*powerPer,total:cost});broadcast();
  });

  socket.on('team:buyDefense',({teamName})=>{
    if(gameState.phase==='war'){socket.emit('error','Aucun achat en guerre !');return;}
    const team=gameState.teams[teamName];if(!team||!team.country)return;
    const c=gameState.countries[team.country];
    if(!gameState.isTutorial){const actions=gameState.teamActionsThisPeriod[teamName]||0;if(actions>=2){socket.emit('error','2 actions déjà utilisées !');return;}}
    if(c.treasury<200){socket.emit('error',"Pas assez d'or !");return;}
    gameState.lastActionByTeam[teamName]={treasury:c.treasury,oil:c.oil,food:c.food,tourism:c.tourism,agriculture:c.agriculture,army:c.army};
    c.treasury-=200;c.defense=true;c.power=calcPower(c);
    if(!gameState.isTutorial)gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,'🛡️ Bunker activé ! (−15% dégâts reçus)','good');
    io.emit('defenseActivated',{countryId:c.id,teamName});
    socket.emit('actionFeedback',{type:'defense',total:200});broadcast();
  });

  socket.on('mj:eliminate',({countryId})=>{const c=gameState.countries[countryId];if(!c)return;c.eliminated=true;addLog(`☠️ ${c.flag} éliminé !`,'eliminated');addTeamNews(c.team,'Votre nation a été conquise.','bad');broadcast();checkWinner();});
  socket.on('mj:bonus',({countryId,amount})=>{const c=gameState.countries[countryId];if(!c)return;c.treasury+=amount;c.power=calcPower(c);addLog(`${amount>0?'+':''}${amount} or → ${c.flag}`,amount>0?'economy':'attack');broadcast();});
  socket.on('mj:reset',()=>{if(timerInterval)clearInterval(timerInterval);if(warTurnInterval)clearInterval(warTurnInterval);timerInterval=null;warTurnInterval=null;gameState={phase:'setup',currentPeriod:0,currentEvent:null,nextHint:null,periodSequence:[],countries:{},takenCountries:{},teams:{},prices:{oil:80,food:40,tourism:120,agriculture:60},eventMod:{oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0},coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false},alliances:{},pendingAllianceProposals:{},log:[],timerSeconds:600,timerRunning:false,warTurnOrder:[],warCurrentTurn:0,warTurnSeconds:30,teamActionsThisPeriod:{},lastActionByTeam:{},pendingChoiceEvent:null,winner:null,winners:[],isTutorial:false,tutorialSnapshot:{},gameOver:false};broadcast();io.emit('timer',{seconds:600,running:false});});
  socket.on('team:join',({teamName})=>{if(!gameState.teams[teamName])gameState.teams[teamName]={country:null,news:[]};broadcast();});
  socket.on('team:draftCountry',({teamName,countryId})=>{if(gameState.takenCountries[countryId]){socket.emit('error','Déjà pris !');return;}gameState.takenCountries[countryId]=teamName;gameState.teams[teamName].country=countryId;gameState.countries[countryId].team=teamName;addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} → ${teamName}`,'event');broadcast();});
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Geopolitica running on port ${PORT}`));
