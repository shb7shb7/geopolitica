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
  { id:'usa',     flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:800, oil:200, food:400, tourism:150, agriculture:100, army:320, population:330 },
  { id:'china',   flag:'🇨🇳', name:'Chine',        tier:'S', gold:750, oil:250, food:500, tourism:100, agriculture:150, army:300, population:1400 },
  { id:'russia',  flag:'🇷🇺', name:'Russie',       tier:'A', gold:500, oil:500, food:200, tourism:50,  agriculture:80,  army:260, population:145 },
  { id:'germany', flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:600, oil:100, food:300, tourism:200, agriculture:120, army:230, population:83 },
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:680, oil:550, food:80,  tourism:300, agriculture:20,  army:180, population:3 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:550, oil:80,  food:350, tourism:250, agriculture:150, army:220, population:68 },
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:400, oil:150, food:600, tourism:80,  agriculture:250, army:160, population:215 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:380, oil:100, food:550, tourism:120, agriculture:200, army:180, population:1400 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:320, oil:60,  food:400, tourism:150, agriculture:180, army:150, population:37 },
  { id:'guinea',  flag:'🇬🇳', name:'Guinée',       tier:'B', gold:220, oil:40,  food:380, tourism:40,  agriculture:200, army:130, population:13 },
];

// Food consumption per period — proportional to population
function getFoodConsumption(c) { return Math.max(2, Math.round(c.population / 8)); }

// Passive income per period
function getPassiveIncome(c, mod) {
  const oilIncome     = Math.round(c.oil         * 0.5  * (mod.oilMultiplier     || 1));
  const tourismIncome = Math.round(c.tourism      * 0.6  * (mod.tourismMultiplier || 1));
  const agriIncome    = Math.round(c.agriculture  * 0.45 * (mod.agriMultiplier   || 1));
  const baseIncome    = Math.round((80 + Math.random() * 60 + c.population * 0.05) * (mod.baseMultiplier || 1));
  return { oilIncome, tourismIncome, agriIncome, baseIncome, total: oilIncome + tourismIncome + agriIncome + baseIncome };
}

// Estimate combat probability (used client-side display)
function estimateCombatProbability(att, def) {
  const tierBonusAtt = att.tier === 'B' ? 1.15 : 1.0;
  const tierBonusDef = def.tier === 'B' ? 1.15 : 1.0;
  const scoreAtt = att.power * 1.20 * tierBonusAtt + att.food * 0.07;
  const scoreDef = def.power * 1.20 * tierBonusDef * 1.15 + def.food * 0.07 + (def.defense ? def.power * 0.30 : 0);
  const totalScore = scoreAtt + scoreDef;
  return Math.round((scoreAtt / totalScore) * 100);
}

// EVENTS — 3 categories, very impactful
const MARKET_EVENTS = [
  { id:'oil_mega_boom', w:1, type:'market', title:'Boom pétrolier historique', desc:'Les cours du pétrole atteignent des records absolus. Les nations productrices s\'enrichissent massivement.', effect:'Revenus pétrole ×5 cette période · Prix pétrole ×4 · Achat pétrole bloqué < 5000 pts', oilMultiplier:5, priceChanges:{oil:4.0}, blockOilBelowPower:5000 },
  { id:'tourism_boom',  w:1, type:'market', title:'Explosion du tourisme mondial', desc:'Les frontières s\'ouvrent, les voyageurs affluent. Les nations touristiques explosent leur PIB.', effect:'Revenus tourisme ×6 · Achat tourisme −50% prix', tourismMultiplier:6, priceChanges:{tourism:0.5} },
  { id:'agri_boom',     w:1, type:'market', title:'Révolution agricole', desc:'De nouvelles techniques agricoles quadruplent les rendements mondiaux.', effect:'Revenus agriculture ×5 · Nourriture +20% à tous', agriMultiplier:5, special:'agriBoost' },
  { id:'oil_crash',     w:1, type:'market', title:'Effondrement pétrolier', desc:'Le pétrole devient sans valeur du jour au lendemain. Les économies dépendantes s\'effondrent.', effect:'Pays pétrole > 200: −800 or · Revenus pétrole ×0 cette période', special:'oilCrash', oilMultiplier:0 },
  { id:'trade_open',    w:1, type:'market', title:'Traité de libre-échange mondial', desc:'Un accord historique ouvre toutes les frontières commerciales.', effect:'Prix toutes ressources −50% · Revenus de base ×2', priceChanges:{oil:0.5,food:0.5,tourism:0.5,agriculture:0.5}, baseMultiplier:2 },
  { id:'sanctions_sa',  w:1, type:'market', title:'Sanctions économiques massives', desc:'Le G20 impose des sanctions dévastatrices contre les économies dominantes.', effect:'Tier S et A: −1000 or · 3 plus faibles: +400 or', special:'sanctionsSA' },
  { id:'food_crisis',   w:1, type:'market', title:'Famine mondiale dévastatrice', desc:'Les récoltes mondiales s\'effondrent. La famine menace des milliards de personnes.', effect:'Prix nourriture ×5 · Pays < 200 nourr.: −30% puissance · Agri ×4', priceChanges:{food:5.0}, agriMultiplier:4, special:'foodCrisisPenalty' },
  { id:'goldRush',      w:1, type:'market', title:'Ruée vers l\'or', desc:'De nouveaux gisements géants sont découverts. L\'or afflue dans toutes les économies.', effect:'Revenus de base ×3 cette période', baseMultiplier:3 },
];

const CHOICE_EVENTS = [
  { id:'embargo',   w:1, type:'choice', title:'Embargo international',      desc:'Le Conseil de Sécurité impose un embargo total. Chaque nation doit choisir sa réponse.', effect:'CHOIX: Sacrifier 300 pétrole (neutralité) OU payer 800 or de sanctions', choiceA:{label:'Sacrifier 300 pétrole (neutralité)',cost:{oil:300}}, choiceB:{label:'Payer 800 or de sanctions',cost:{treasury:800}} },
  { id:'arms',      w:1, type:'choice', title:'Course aux armements',        desc:'Les nations doivent choisir entre puissance militaire brute ou mobilisation populaire.', effect:'CHOIX: 500 or → +120 armée OU 400 nourriture → +80 armée +20% combat', choiceA:{label:'Investissement militaire (500 or)',cost:{treasury:500},gain:{army:120}}, choiceB:{label:'Mobilisation populaire (400 nourr.)',cost:{food:400},gain:{army:80,combatBonus:0.20}} },
  { id:'aid',       w:1, type:'choice', title:'Appel humanitaire mondial',   desc:'La communauté internationale appelle à l\'aide. Les nations choisissent leur camp.', effect:'CHOIX: Donner 300 nourr. (+500 pts puissance FMI) OU Garder (−300 pts pression)', choiceA:{label:'Donner 300 nourriture (+500 pts)',cost:{food:300},gain:{power:500}}, choiceB:{label:'Refuser (−300 pts)',cost:{},gain:{powerLoss:300}} },
  { id:'tech',      w:1, type:'choice', title:'Accord technologique secret',  desc:'Un pacte technologique militaire est proposé par une superpuissance anonyme.', effect:'CHOIX: Payer 400 or → +80 armée +300 pts OU Refuser (aucun effet)', choiceA:{label:'Signer (400 or → +80 armée +300 pts)',cost:{treasury:400},gain:{army:80,power:300}}, choiceB:{label:'Refuser',cost:{},gain:{}} },
  { id:'spy',       w:1, type:'choice', title:'Réseau d\'espionnage révélé',  desc:'Un vaste réseau d\'espionnage est découvert. Les nations coupables sont identifiées.', effect:'CHOIX: Avouer (−200 pts) OU Nier (si pris → −600 pts, 50% de chance)', choiceA:{label:'Avouer (−200 pts, certain)',cost:{},gain:{powerLoss:200}}, choiceB:{label:'Nier (50%: −600 pts ou 0)',cost:{},gain:{gamble:true,powerLoss:600}} },
  { id:'warprep',   w:1, type:'choice', title:'Préparation de guerre imminente', desc:'Les renseignements indiquent une guerre dans 6 mois. Choisissez votre stratégie.', effect:'CHOIX: Bunker + +200 pts défense (gratuit) OU Frappe préventive +200 armée (700 or)', choiceA:{label:'Défense renforcée (gratuit)',cost:{},gain:{defense:true,power:200}}, choiceB:{label:'Frappe préventive (700 or → +200 armée)',cost:{treasury:700},gain:{army:200}} },
];

const TARGETED_EVENTS = [
  { id:'earthquake', w:2, type:'targeted', title:'Séisme catastrophique',     desc:'Un méga-séisme frappe sans prévenir.', effect:'1 pays aléatoire: −50% nourriture −400 pts puissance', targetCount:1, effects:{foodLoss:0.50, powerLoss:400} },
  { id:'typhoon',    w:2, type:'targeted', title:'Super typhon dévastateur',   desc:'Un typhon d\'une violence inouïe ravage plusieurs côtes.', effect:'2 pays aléatoires: −60% nourriture −200 pts', targetCount:2, effects:{foodLoss:0.60, powerLoss:200} },
  { id:'revolution', w:2, type:'targeted', title:'Révolution des ressources',  desc:'Les nations émergentes brisent les chaînes de l\'ordre mondial.', effect:'Pays < 4000 pts: +350 or · Pays > 9000 pts: −400 or', special:'revolution' },
  { id:'fmi',        w:2, type:'targeted', title:'Intervention FMI d\'urgence', desc:'Le FMI déploie des ressources massives pour stabiliser les économies fragiles.', effect:'3 nations les plus faibles: +300 or +60 armée', special:'aidFMI' },
  { id:'oilblocus',  w:1, type:'targeted', title:'Blocus pétrolier total',      desc:'Les routes maritimes pétrolières sont bloquées.', effect:'Pays pétrole > 300: −500 or · Pays pétrole < 80: +300 or', special:'oilBlocus' },
  { id:'uprising',   w:2, type:'targeted', title:'Soulèvement populaire mondial', desc:'Les populations opprimées renversent les élites.', effect:'Tier B: +80 armée gratuit · Tier S: −150 armée (désertion)', special:'uprising' },
  { id:'tourism_c',  w:1, type:'targeted', title:'Crise du tourisme mondial',   desc:'Les attentats et crises ferment les frontières touristiques.', effect:'Pays tourisme > 150: −400 or · Pays tourisme < 60: +200 or (report)', special:'tourismCrisis' },
];

const ALL_EVENTS = [...MARKET_EVENTS, ...CHOICE_EVENTS, ...TARGETED_EVENTS];

function weightedRandomEvent() {
  const pool = [];
  ALL_EVENTS.forEach(ev => { for(let i=0;i<(ev.w||1);i++) pool.push(ev); });
  return pool[Math.floor(Math.random() * pool.length)];
}

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",          subtitle:"Janvier — Juin · An 1",   desc:"Les marchés s'ouvrent. Investissez dans vos 3 sources de revenus: pétrole (×0.5), tourisme (×0.6) et agriculture (×0.45) par unité par période. Plus vous achetez maintenant, plus vous générez de l'or chaque manche. 2 actions disponibles." },
  { number:2, name:"Premières Tensions",            subtitle:"Juillet — Déc · An 1",    desc:"Les intérêts divergent. Si l'événement est un CHOIX, vous avez 60 secondes pour décider. Les conséquences sont immédiates et massives. Vérifiez vos stocks de nourriture — la famine peut détruire votre armée. 2 actions." },
  { number:3, name:"Crise Mondiale",                subtitle:"Janvier — Juin · An 2",   desc:"Catastrophe mondiale. Cet événement peut être dévastateur. Certaines nations perdront des centaines de points. D'autres feront fortune. Vos choix d'investissement des 2 premières périodes déterminent votre résilience. 2 actions." },
  { number:4, name:"Course aux Armements",          subtitle:"Juillet — Déc · An 2",    desc:"La guerre approche. Renforcez votre armée — elle pèse dans le calcul de puissance mais aussi dans les combats. Un bunker (200 or) réduit les dégâts de 30%. Votre puissance déterminera vos chances au combat. 2 actions." },
  { number:5, name:"Ultimatums",                    subtitle:"Janvier — Juin · An 3",   desc:"AVANT-DERNIÈRE PÉRIODE. C'est votre dernière vraie chance d'investir. En guerre, plus aucun achat. Transformez votre or en puissance maintenant. Les alliances seront disponibles dès le début de la guerre. 2 actions." },
  { number:6, name:"Le Monde Retient son Souffle",  subtitle:"Juillet — Déc · An 3",    desc:"DERNIÈRE PÉRIODE DE PAIX. Dépensez tout. La guerre commence après cette manche. La puissance se calcule avec Armée×10 + Trésor×0.25 + Pétrole×0.8 + Tourisme×0.6 + Agriculture×0.5 + Nourriture×1.2. Optimisez. 2 actions — dernière chance absolue." },
];

let gameState = {
  phase:'setup', currentPeriod:0, currentEvent:null,
  countries:{}, takenCountries:{}, teams:{},
  prices:{ oil:80, food:40, tourism:120, agriculture:60 },
  eventMod:{ oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0, peace:false },
  coalition:{ proposed:false, moroccoAccepted:false, guineaAccepted:false, active:false },
  alliances:{}, // { teamA: {type:'peace'|'offensive', with:teamB, expires:turnIndex} }
  log:[], timerSeconds:600, timerRunning:false,
  warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30,
  teamActionsThisPeriod:{},
  pendingChoiceEvent:null,
  winner:null,
};

let timerInterval=null, warTurnInterval=null;

function initCountries() {
  gameState.countries = {};
  COUNTRIES.forEach(c => {
    gameState.countries[c.id] = { ...c, treasury:c.gold, power:calcPower({...c,treasury:c.gold}), eliminated:false, defense:false, team:null, combatBonus:0 };
  });
}

function calcPower(c) {
  const tierBonus = c.tier === 'B' ? 1.15 : 1.0;
  return Math.max(0, Math.round((
    c.army * 10 +
    (c.treasury||0) * 0.25 +
    (c.oil||0) * 0.8 +
    (c.tourism||0) * 0.6 +
    (c.agriculture||0) * 0.5 +
    (c.food||0) * 1.2
  ) * tierBonus));
}

function resolveCombat(att, def) {
  const tierBonusAtt = att.tier==='B' ? 1.15 : 1.0;
  const tierBonusDef = def.tier==='B' ? 1.15 : 1.0;
  const combatBonusAtt = 1 + (att.combatBonus||0);
  const randAtt = 1 + Math.random()*0.20 + Math.random()*0.20;
  const randDef = 1 + Math.random()*0.20 + Math.random()*0.20;
  const scoreAtt = att.power * randAtt * tierBonusAtt * combatBonusAtt + att.food*0.07;
  const scoreDef = def.power * randDef * tierBonusDef * 1.15 + def.food*0.07 + (def.defense ? def.power*0.30 : 0);
  return { attackerWins: scoreAtt>scoreDef, scoreAtt:Math.round(scoreAtt), scoreDef:Math.round(scoreDef) };
}

function addLog(text, type) {
  gameState.log.unshift({ text, type, time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) });
  if(gameState.log.length>100) gameState.log=gameState.log.slice(0,100);
}
function addTeamNews(teamName, text, type) {
  if(!gameState.teams[teamName]) return;
  gameState.teams[teamName].news=gameState.teams[teamName].news||[];
  gameState.teams[teamName].news.push({ text, type, time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) });
}
function broadcast() { io.emit('state', gameState); }

function applyEvent(ev) {
  // Reset mods
  gameState.eventMod = { oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0, peace:false };
  gameState.prices = { oil:80, food:40, tourism:120, agriculture:60 };

  if(ev.priceChanges) {
    if(ev.priceChanges.oil)         gameState.prices.oil         = Math.round(80  * ev.priceChanges.oil);
    if(ev.priceChanges.food)        gameState.prices.food        = Math.round(40  * ev.priceChanges.food);
    if(ev.priceChanges.tourism)     gameState.prices.tourism     = Math.round(120 * ev.priceChanges.tourism);
    if(ev.priceChanges.agriculture) gameState.prices.agriculture = Math.round(60  * ev.priceChanges.agriculture);
  }
  if(ev.oilMultiplier     !== undefined) gameState.eventMod.oilMultiplier     = ev.oilMultiplier;
  if(ev.tourismMultiplier !== undefined) gameState.eventMod.tourismMultiplier = ev.tourismMultiplier;
  if(ev.agriMultiplier    !== undefined) gameState.eventMod.agriMultiplier    = ev.agriMultiplier;
  if(ev.baseMultiplier    !== undefined) gameState.eventMod.baseMultiplier    = ev.baseMultiplier;
  if(ev.blockOilBelowPower)             gameState.eventMod.blockOilBelowPower = ev.blockOilBelowPower;

  if(ev.special==='oilCrash')      Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated&&c.oil>200){ c.treasury=Math.max(0,c.treasury-800); c.power=calcPower(c); addTeamNews(c.team,'💥 Effondrement pétrolier: −800 or !','bad'); }});
  if(ev.special==='agriBoost')     Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ c.food=Math.round(c.food*1.20); c.power=calcPower(c); addTeamNews(c.team,'🌾 Révolution agricole: +20% nourriture !','good'); }});
  if(ev.special==='foodCrisisPenalty') Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated&&c.food<200){ const loss=Math.round(c.power*0.30); c.power=Math.max(0,c.power-loss); addTeamNews(c.team,`🚨 Famine: stocks trop faibles — −${loss} pts puissance !`,'bad'); }});
  if(ev.special==='sanctionsSA')   { Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated&&(c.tier==='S'||c.tier==='A')){ c.treasury=Math.max(0,c.treasury-1000); c.power=calcPower(c); addTeamNews(c.team,'⚠️ Sanctions G20: −1000 or !','bad'); }}); const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3); alive.forEach(c=>{ c.treasury+=400; c.power=calcPower(c); addTeamNews(c.team,'💰 Compensation sanctions: +400 or !','good'); }); }
  if(ev.special==='revolution')    Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ if(c.power<4000){ c.treasury+=350; c.power=calcPower(c); addTeamNews(c.team,'✊ Révolution: +350 or !','good'); } if(c.power>9000){ c.treasury=Math.max(0,c.treasury-400); c.power=calcPower(c); addTeamNews(c.team,'✊ Révolution: −400 or (pression populaire)','bad'); } }});
  if(ev.special==='aidFMI')        { const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3); alive.forEach(c=>{ c.treasury+=300; c.army+=60; c.power=calcPower(c); addTeamNews(c.team,'🏦 FMI urgence: +300 or +60 armée !','good'); }); }
  if(ev.special==='oilBlocus')     Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ if(c.oil>300){ c.treasury=Math.max(0,c.treasury-500); c.power=calcPower(c); addTeamNews(c.team,'🚢 Blocus pétrolier: −500 or !','bad'); } else if(c.oil<80){ c.treasury+=300; c.power=calcPower(c); addTeamNews(c.team,'🚢 Compensation blocus: +300 or !','good'); } }});
  if(ev.special==='uprising')      Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ if(c.tier==='B'){ c.army+=80; c.power=calcPower(c); addTeamNews(c.team,'✊ Soulèvement: +80 armée !','good'); } if(c.tier==='S'){ c.army=Math.max(0,c.army-150); c.power=calcPower(c); addTeamNews(c.team,'✊ Désertion: −150 armée !','bad'); } }});
  if(ev.special==='tourismCrisis') Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ if(c.tourism>150){ c.treasury=Math.max(0,c.treasury-400); c.power=calcPower(c); addTeamNews(c.team,'✈️ Crise tourisme: −400 or !','bad'); } else if(c.tourism<60){ c.treasury+=200; c.power=calcPower(c); addTeamNews(c.team,'✈️ Report touristes: +200 or !','good'); } }});
  // Targeted random
  if(ev.effects) {
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated);
    const targets=alive.sort(()=>Math.random()-0.5).slice(0,ev.targetCount||1);
    targets.forEach(c=>{ if(ev.effects.foodLoss){ const loss=Math.round(c.food*ev.effects.foodLoss); c.food=Math.max(0,c.food-loss); c.power=calcPower(c); addTeamNews(c.team,`🌋 ${ev.title}: −${loss} nourriture !`,'bad'); addLog(`${ev.title}: ${c.flag} −${loss} nourr`,'event'); } if(ev.effects.powerLoss){ c.power=Math.max(0,c.power-ev.effects.powerLoss); addTeamNews(c.team,`🌋 ${ev.title}: −${ev.effects.powerLoss} pts !`,'bad'); }});
  }
}

function applyPeriodTransition() {
  gameState.eventMod = { oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0, peace:false };
  gameState.prices = { oil:80, food:40, tourism:120, agriculture:60 };
  Object.values(gameState.countries).forEach(c => {
    if(c.eliminated) return;
    // Food consumption
    const foodNeeded = getFoodConsumption(c);
    if(c.food>=foodNeeded){ c.food-=foodNeeded; addTeamNews(c.team,`🍞 Consommation: −${foodNeeded} nourriture (pop. ${c.population}M)`,'neutral'); }
    else { const deficit=foodNeeded-c.food; c.food=0; const powerLoss=Math.round(deficit*(c.population/10)*2); c.power=Math.max(0,c.power-powerLoss); addTeamNews(c.team,`⚠️ FAMINE ! Manque ${deficit} nourriture pour ${c.population}M hab — −${powerLoss} pts !`,'bad'); addLog(`Famine: ${c.flag} −${powerLoss} pts`,'event'); }
    // Passive income
    const inc = getPassiveIncome(c, gameState.eventMod);
    c.treasury += inc.total;
    addTeamNews(c.team,`💰 Revenus: +${inc.oilIncome} pétrole | +${inc.tourismIncome} tourisme | +${inc.agriIncome} agri | +${inc.baseIncome} base = +${inc.total} or total`,'good');
    c.defense=false; c.combatBonus=0; c.power=calcPower(c);
  });
  gameState.teamActionsThisPeriod={};
  gameState.alliances={};
}

function startServerTimer(s){ if(timerInterval)clearInterval(timerInterval); gameState.timerSeconds=s; gameState.timerRunning=true; timerInterval=setInterval(()=>{ if(gameState.timerSeconds>0){ gameState.timerSeconds--; io.emit('timer',{seconds:gameState.timerSeconds,running:true}); } else { clearInterval(timerInterval);timerInterval=null;gameState.timerRunning=false;io.emit('timer',{seconds:0,running:false,ended:true}); }},1000); }
function pauseServerTimer(){ if(timerInterval){clearInterval(timerInterval);timerInterval=null;} gameState.timerRunning=false; io.emit('timer',{seconds:gameState.timerSeconds,running:false}); }
function resetServerTimer(s){ pauseServerTimer(); gameState.timerSeconds=s||600; io.emit('timer',{seconds:gameState.timerSeconds,running:false}); }

function checkWinner() {
  const alive = Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  if(alive.length===1 && gameState.phase==='war') {
    gameState.winner = alive[0];
    io.emit('winner', alive[0]);
    addLog(`🏆 ${alive[0].flag} ${alive[0].name} remporte Geopolitica !`,'event');
    broadcast();
  }
}

function startWarTurn() {
  const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  gameState.warTurnOrder=alive.map(c=>c.team);
  gameState.warCurrentTurn=0;
  advanceWarTurn();
}
function advanceWarTurn() {
  if(warTurnInterval)clearInterval(warTurnInterval);
  gameState.warTurnOrder=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated).map(c=>c.team);
  if(gameState.warCurrentTurn>=gameState.warTurnOrder.length) gameState.warCurrentTurn=0;
  if(gameState.warTurnOrder.length===0) return;
  const team=gameState.warTurnOrder[gameState.warCurrentTurn];
  gameState.warTurnSeconds=30;
  io.emit('warTurn',{team,seconds:30,turnIndex:gameState.warCurrentTurn,total:gameState.warTurnOrder.length});
  addLog(`Tour de ${team}`,'event'); broadcast();
  warTurnInterval=setInterval(()=>{ gameState.warTurnSeconds--; io.emit('warTurnTimer',{seconds:gameState.warTurnSeconds,team}); if(gameState.warTurnSeconds<=0){ clearInterval(warTurnInterval); addTeamNews(team,'⏰ Tour passé !','bad'); gameState.warCurrentTurn++; advanceWarTurn(); }},1000);
}
function nextWarTurn(){ if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;} gameState.warCurrentTurn++; advanceWarTurn(); }

io.on('connection', (socket) => {
  socket.emit('state', gameState);
  socket.emit('periods', PERIODS);
  socket.emit('timer',{seconds:gameState.timerSeconds,running:gameState.timerRunning});
  if(gameState.winner) socket.emit('winner', gameState.winner);

  socket.on('mj:startDraft', ()=>{ initCountries(); gameState.phase='draft'; gameState.currentPeriod=0; gameState.coalition={proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false}; gameState.teamActionsThisPeriod={}; gameState.alliances={}; gameState.winner=null; resetServerTimer(600); addLog('Draft démarré','event'); broadcast(); });

  socket.on('mj:startProsperity', ()=>{
    gameState.phase='prosperity'; gameState.currentPeriod=1; gameState.currentEvent=null; gameState.teamActionsThisPeriod={};
    const period=PERIODS[0]; const ev=weightedRandomEvent();
    gameState.currentEvent={...ev,periodName:period.name,periodSubtitle:period.subtitle,periodDesc:period.desc,periodNumber:period.number};
    if(ev.type==='market'||ev.type==='targeted') applyEvent(ev);
    else if(ev.type==='choice'){ gameState.pendingChoiceEvent=ev; io.emit('choiceEvent',ev); }
    resetServerTimer(600); addLog(`Période 1 — ${period.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,`📅 Période 1 — ${period.name}\n${period.desc}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}`,'neutral'); });
    broadcast();
  });

  socket.on('mj:nextPeriod', ()=>{
    if(gameState.currentPeriod>=6) return;
    applyPeriodTransition(); gameState.currentPeriod++;
    const period=PERIODS[gameState.currentPeriod-1]; const ev=weightedRandomEvent();
    gameState.currentEvent={...ev,periodName:period.name,periodSubtitle:period.subtitle,periodDesc:period.desc,periodNumber:period.number};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='market'||ev.type==='targeted') applyEvent(ev);
    else if(ev.type==='choice'){ gameState.pendingChoiceEvent=ev; io.emit('choiceEvent',ev); }
    resetServerTimer(600); addLog(`Période ${gameState.currentPeriod} — ${period.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,`📅 Période ${gameState.currentPeriod} — ${period.name}\n${period.desc}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}`,'neutral'); });
    broadcast();
  });

  socket.on('mj:startWar', ()=>{
    gameState.phase='war'; gameState.currentEvent=null; gameState.pendingChoiceEvent=null;
    gameState.teamActionsThisPeriod={}; gameState.alliances={};
    gameState.coalition={proposed:true,moroccoAccepted:false,guineaAccepted:false,active:false};
    resetServerTimer(600); addLog('⚔️ GUERRE MONDIALE DÉMARRÉE','attack');
    if(gameState.countries.morocco?.team) addTeamNews(gameState.countries.morocco.team,'🤝 Proposition de coalition avec la Guinée — répondez !','neutral');
    if(gameState.countries.guinea?.team)  addTeamNews(gameState.countries.guinea.team,'🤝 Proposition de coalition avec le Maroc — répondez !','neutral');
    Object.values(gameState.countries).forEach(c=>{ if(c.team&&c.id!=='morocco'&&c.id!=='guinea') addTeamNews(c.team,'⚔️ GUERRE DÉCLARÉE ! Aucun achat possible. Alliances disponibles. Attendez votre tour.','bad'); });
    broadcast();
    setTimeout(()=>startWarTurn(),3000);
  });

  socket.on('mj:timerStart', ({seconds})=>startServerTimer(seconds||gameState.timerSeconds));
  socket.on('mj:timerPause', ()=>pauseServerTimer());
  socket.on('mj:timerReset', ({seconds})=>resetServerTimer(seconds));
  socket.on('mj:nextWarTurn', ()=>nextWarTurn());
  socket.on('mj:startWarTurns', ()=>startWarTurn());

  // CHOICE EVENT
  socket.on('team:choiceResponse', ({teamName, choice})=>{
    const ev=gameState.pendingChoiceEvent; if(!ev) return;
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    const chosen=choice==='A'?ev.choiceA:ev.choiceB;
    if(chosen.cost){
      if(chosen.cost.treasury&&c.treasury<chosen.cost.treasury){ socket.emit('error',`Pas assez d'or ! (${chosen.cost.treasury} requis)`); return; }
      if(chosen.cost.oil&&c.oil<chosen.cost.oil){ socket.emit('error',`Pas assez de pétrole ! (${chosen.cost.oil} requis)`); return; }
      if(chosen.cost.food&&c.food<chosen.cost.food){ socket.emit('error',`Pas assez de nourriture ! (${chosen.cost.food} requis)`); return; }
      if(chosen.cost.treasury){ c.treasury-=chosen.cost.treasury; }
      if(chosen.cost.oil){ c.oil-=chosen.cost.oil; }
      if(chosen.cost.food){ c.food-=chosen.cost.food; }
    }
    let msg='';
    if(chosen.gain){
      if(chosen.gain.army){ c.army+=chosen.gain.army; msg+=`+${chosen.gain.army} armée `; }
      if(chosen.gain.power){ c.power+=chosen.gain.power; msg+=`+${chosen.gain.power} pts `; }
      if(chosen.gain.powerLoss){ c.power=Math.max(0,c.power-chosen.gain.powerLoss); msg+=`−${chosen.gain.powerLoss} pts `; }
      if(chosen.gain.defense){ c.defense=true; msg+=`+bunker `; }
      if(chosen.gain.combatBonus){ c.combatBonus=(c.combatBonus||0)+chosen.gain.combatBonus; msg+=`+${Math.round(chosen.gain.combatBonus*100)}% combat `; }
      if(chosen.gain.gamble){ if(Math.random()<0.5){ c.power=Math.max(0,c.power-chosen.gain.powerLoss); msg+=`−${chosen.gain.powerLoss} pts (découvert !) `; } else msg+=`Rien (non découvert) `; }
    }
    c.power=calcPower(c);
    addTeamNews(teamName,`✅ Choix "${chosen.label}": ${msg}`,'good');
    addLog(`${c.flag} choisit: ${chosen.label}`,'event');
    broadcast();
  });

  // ALLIANCES
  socket.on('team:proposeAlliance', ({fromTeam, toTeam, allianceType})=>{
    if(gameState.phase!=='war'){ socket.emit('error','Les alliances ne sont disponibles qu\'en guerre !'); return; }
    const cost = allianceType==='offensive' ? 100 : 0;
    const team=gameState.teams[fromTeam]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    if(cost>0&&c.treasury<cost){ socket.emit('error','Pas assez d\'or pour cette alliance !'); return; }
    io.emit('allianceProposal',{from:fromTeam,to:toTeam,type:allianceType,cost});
    addTeamNews(toTeam,`🤝 Alliance proposée par ${fromTeam} (type: ${allianceType==='offensive'?'offensive — +15% combat':'pacte de non-agression'}) — répondez !`,'neutral');
  });

  socket.on('team:respondAlliance', ({fromTeam, toTeam, accepted, allianceType})=>{
    if(!accepted){ addTeamNews(fromTeam,`❌ Alliance refusée par ${toTeam}`,'bad'); return; }
    const cost=allianceType==='offensive'?100:0;
    // Deduct cost from proposer
    const propTeam=gameState.teams[fromTeam]; if(propTeam&&propTeam.country){ const pc=gameState.countries[propTeam.country]; if(cost>0) pc.treasury=Math.max(0,pc.treasury-cost); }
    const turnIndex=gameState.warCurrentTurn;
    gameState.alliances[fromTeam]={type:allianceType,with:toTeam,expires:turnIndex+gameState.warTurnOrder.length};
    gameState.alliances[toTeam]={type:allianceType,with:fromTeam,expires:turnIndex+gameState.warTurnOrder.length};
    addTeamNews(fromTeam,`✅ Alliance ${allianceType} avec ${toTeam} — 1 tour !`,'good');
    addTeamNews(toTeam,`✅ Alliance ${allianceType} avec ${fromTeam} — 1 tour !`,'good');
    addLog(`🤝 Alliance ${allianceType}: ${fromTeam} & ${toTeam}`,'event');
    broadcast();
  });

  // COALITION
  socket.on('team:acceptCoalition', ({teamName})=>{
    const c=Object.values(gameState.countries).find(c=>c.team===teamName); if(!c) return;
    if(c.id==='morocco') gameState.coalition.moroccoAccepted=true;
    if(c.id==='guinea')  gameState.coalition.guineaAccepted=true;
    if(gameState.coalition.moroccoAccepted&&gameState.coalition.guineaAccepted){
      gameState.coalition.active=true;
      // Capped coalition — +25% bonus, no full merge
      const morocco=gameState.countries.morocco, guinea=gameState.countries.guinea;
      const bonusGold=Math.round(guinea.treasury*0.25), bonusOil=Math.round(guinea.oil*0.25);
      const bonusFood=Math.round(guinea.food*0.25), bonusArmy=Math.round(guinea.army*0.25);
      morocco.treasury+=bonusGold; morocco.oil+=bonusOil; morocco.food+=bonusFood; morocco.army+=bonusArmy;
      morocco.power=calcPower(morocco); guinea.power=calcPower(guinea);
      addLog('🤝 Coalition Maroc-Guinée: +25% ressources partagées !','event');
      addTeamNews(morocco.team,`✅ Coalition active ! Bonus: +${bonusGold} or, +${bonusOil} pétrole, +${bonusFood} nourr, +${bonusArmy} armée`,'good');
      addTeamNews(guinea.team,'✅ Coalition active ! Vous combattez avec le Maroc (ressources partagées à 25%).','good');
    } else addTeamNews(teamName,"✅ Accepté — en attente de l'autre équipe...",'neutral');
    broadcast();
  });
  socket.on('team:refuseCoalition', ({teamName})=>{ gameState.coalition.proposed=false; addTeamNews(gameState.countries.morocco?.team,'❌ Coalition refusée.','bad'); addTeamNews(gameState.countries.guinea?.team,'❌ Coalition refusée.','bad'); broadcast(); });

  // ATTACK
  socket.on('team:declareAttack', ({teamName, targetId, payWith})=>{
    if(gameState.phase!=='war'){ socket.emit('error',"La guerre n'a pas commencé !"); return; }
    const currentTurnTeam=gameState.warTurnOrder[gameState.warCurrentTurn];
    if(currentTurnTeam!==teamName){ socket.emit('error',"Ce n'est pas votre tour !"); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const att=gameState.countries[team.country]; const def=gameState.countries[targetId];
    if(!att||!def||att.eliminated||def.eliminated) return;
    // Check alliance
    const myAlliance=gameState.alliances[teamName];
    if(myAlliance&&myAlliance.type==='peace'&&myAlliance.with===def.team){ socket.emit('error','Pacte de non-agression actif — vous ne pouvez pas attaquer cette nation !'); return; }
    // Payment
    const costs={gold:150,oil:200,food:300}; const payResource=payWith||'gold';
    const cost=costs[payResource]||150; const resourceKey=payResource==='gold'?'treasury':payResource;
    if(att[resourceKey]<cost){ socket.emit('error',`Pas assez de ${payResource==='gold'?'or':payResource} ! (${cost} requis)`); return; }
    att[resourceKey]-=cost; att.power=calcPower(att);
    // Alliance offensive bonus
    const offAlliance=gameState.alliances[teamName];
    if(offAlliance&&offAlliance.type==='offensive') att.combatBonus=(att.combatBonus||0)+0.15;
    const result=resolveCombat(att,def);
    const armyLossAtt=Math.round(att.army*(result.attackerWins?0.12:0.28));
    const armyLossDef=Math.round(def.army*(result.attackerWins?0.35:0.10));
    if(result.attackerWins){
      att.treasury+=def.treasury; att.oil+=def.oil; att.food+=def.food; att.army+=def.army;
      att.tourism+=Math.round(def.tourism*0.5); att.agriculture+=Math.round(def.agriculture*0.5);
      att.army=Math.max(0,att.army-armyLossAtt);
      def.treasury=0; def.oil=0; def.food=0; def.army=0; def.tourism=0; def.agriculture=0;
      att.power=calcPower(att); def.power=calcPower(def);
      addLog(`💥 ${att.flag} ${att.name} écrase ${def.flag} ${def.name} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`🏆 VICTOIRE vs ${def.flag} ${def.name} ! Toutes ressources pillées. −${armyLossAtt} armée`,'good');
      addTeamNews(def.team,`💀 DÉFAITE vs ${att.flag} ${att.name} — tout pillé. −${armyLossDef} armée`,'bad');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:true,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
      if(def.army<=0&&def.treasury<=0){ def.eliminated=true; addLog(`☠️ ${def.flag} ${def.name} éliminé !`,'eliminated'); addTeamNews(def.team,'☠️ Votre nation est anéantie.','bad'); if(gameState.coalition.active&&(def.id==='morocco'||def.id==='guinea')){ gameState.countries.morocco.eliminated=true; gameState.countries.guinea.eliminated=true; } }
    } else {
      const goldLoss=Math.round(att.treasury*0.35); att.treasury=Math.max(0,att.treasury-goldLoss);
      att.army=Math.max(0,att.army-armyLossAtt); def.army=Math.max(0,def.army-armyLossDef);
      att.power=calcPower(att); def.power=calcPower(def);
      addLog(`🛡️ ${def.flag} repousse ${att.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`❌ Échec vs ${def.flag} ${def.name} — −${goldLoss} or, −${armyLossAtt} armée`,'bad');
      addTeamNews(def.team,`🛡️ Repoussé ${att.flag} ! −${armyLossDef} armée pertes défensives`,'good');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:false,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
    }
    // Expire alliance after use
    delete gameState.alliances[teamName];
    broadcast(); checkWinner();
    setTimeout(()=>nextWarTurn(),2000);
  });

  socket.on('team:skipTurn', ({teamName})=>{ if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName) return; addTeamNews(teamName,'Tour passé.','neutral'); nextWarTurn(); broadcast(); });

  socket.on('team:buyResource', ({teamName, resource, qty})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun achat en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    const actions=gameState.teamActionsThisPeriod[teamName]||0;
    if(actions>=2){ socket.emit('error','2 actions déjà utilisées cette période !'); return; }
    if(resource==='oil'&&(gameState.eventMod.blockOilBelowPower||0)>0&&c.power<gameState.eventMod.blockOilBelowPower){ socket.emit('error',`Achat pétrole bloqué (boom actif, réservé > ${gameState.eventMod.blockOilBelowPower} pts) !`); return; }
    const price=gameState.prices[resource]||80; const total=price*qty;
    if(c.treasury<total){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=total; c[resource]+=qty; c.power=calcPower(c);
    gameState.teamActionsThisPeriod[teamName]=(actions)+1;
    addTeamNews(teamName,`✅ Achat: +${qty} ${resource} pour ${total} or (action ${actions+1}/2)`,'good');
    broadcast();
  });

  socket.on('team:sellResource', ({teamName, resource, qty})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucune vente en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    if(c[resource]<qty){ socket.emit('error','Stock insuffisant !'); return; }
    const price=gameState.prices[resource]||80; const total=price*qty;
    c[resource]-=qty; c.treasury+=total; c.power=calcPower(c);
    addTeamNews(teamName,`💰 Vente: −${qty} ${resource} → +${total} or`,'good');
    broadcast();
  });

  socket.on('team:recruitArmy', ({teamName, qty, type})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun recrutement en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    const actions=gameState.teamActionsThisPeriod[teamName]||0;
    if(actions>=2){ socket.emit('error','2 actions déjà utilisées !'); return; }
    const costPer=type==='tech'?300:150; const powerPer=type==='tech'?50:20;
    const cost=Math.round(costPer*qty); if(c.treasury<cost){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=cost; if(type!=='tech') c.army+=qty; c.power+=qty*powerPer;
    gameState.teamActionsThisPeriod[teamName]=(actions)+1;
    addTeamNews(teamName,`✅ Recrutement: +${qty*powerPer} pts pour ${cost} or (action ${actions+1}/2)`,'good');
    broadcast();
  });

  socket.on('team:buyDefense', ({teamName})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun achat en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    const actions=gameState.teamActionsThisPeriod[teamName]||0;
    if(actions>=2){ socket.emit('error','2 actions déjà utilisées !'); return; }
    if(c.treasury<200){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=200; c.defense=true;
    gameState.teamActionsThisPeriod[teamName]=(actions)+1;
    addTeamNews(teamName,'🛡️ Bunker activé ! (action utilisée)','good');
    io.emit('defenseActivated',{countryId:c.id,teamName});
    broadcast();
  });

  socket.on('mj:eliminate', ({countryId})=>{ const c=gameState.countries[countryId]; if(!c) return; c.eliminated=true; if(gameState.coalition.active&&(countryId==='morocco'||countryId==='guinea')){ gameState.countries.morocco.eliminated=true; gameState.countries.guinea.eliminated=true; } addLog(`☠️ ${c.flag} ${c.name} éliminé !`,'eliminated'); addTeamNews(c.team,'Votre nation a été conquise.','bad'); broadcast(); checkWinner(); });
  socket.on('mj:bonus', ({countryId, amount})=>{ const c=gameState.countries[countryId]; if(!c) return; c.treasury+=amount; c.power=calcPower(c); addLog(`${amount>0?'+':''}${amount} or → ${c.flag} ${c.name}`,amount>0?'economy':'attack'); broadcast(); });
  socket.on('mj:reset', ()=>{ if(timerInterval)clearInterval(timerInterval); if(warTurnInterval)clearInterval(warTurnInterval); timerInterval=null; warTurnInterval=null; gameState={ phase:'setup', currentPeriod:0, currentEvent:null, countries:{}, takenCountries:{}, teams:{}, prices:{oil:80,food:40,tourism:120,agriculture:60}, eventMod:{oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0,peace:false}, coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false}, alliances:{}, log:[], timerSeconds:600, timerRunning:false, warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30, teamActionsThisPeriod:{}, pendingChoiceEvent:null, winner:null }; broadcast(); io.emit('timer',{seconds:600,running:false}); });
  socket.on('team:join', ({teamName})=>{ if(!gameState.teams[teamName]) gameState.teams[teamName]={country:null,news:[]}; broadcast(); });
  socket.on('team:draftCountry', ({teamName, countryId})=>{ if(gameState.takenCountries[countryId]){ socket.emit('error','Déjà pris !'); return; } gameState.takenCountries[countryId]=teamName; gameState.teams[teamName].country=countryId; gameState.countries[countryId].team=teamName; addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} → ${teamName}`,'event'); broadcast(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Geopolitica running on port ${PORT}`));
