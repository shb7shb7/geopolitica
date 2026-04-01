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
  { id:'usa',     flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:800, oil:300, food:500, army:320, population:330 },
  { id:'china',   flag:'🇨🇳', name:'Chine',        tier:'S', gold:750, oil:300, food:600, army:300, population:1400 },
  { id:'russia',  flag:'🇷🇺', name:'Russie',       tier:'A', gold:500, oil:500, food:300, army:260, population:145 },
  { id:'germany', flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:600, oil:150, food:350, army:230, population:83 },
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:680, oil:550, food:120, army:180, population:3 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:550, oil:100, food:400, army:220, population:68 },
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:400, oil:200, food:700, army:160, population:215 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:380, oil:150, food:650, army:180, population:1400 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:320, oil:80,  food:450, army:150, population:37 },
  { id:'guinea',  flag:'🇬🇳', name:'Guinée',       tier:'B', gold:220, oil:60,  food:420, army:130, population:13 },
];

// Food consumption per period — proportional to population (in millions)
// Base: 1 unit per 8M population per period
function getFoodConsumption(c) {
  return Math.max(2, Math.round(c.population / 8));
}

// Base income per period (fixed + random)
function getBaseIncome(c) {
  return Math.round(80 + Math.random() * 60 + c.population * 0.05);
}

// Oil income per period — reduced base, but powerful during oil events
function getOilIncome(c, oilMultiplier) {
  return Math.round(c.oil * 0.35 * (oilMultiplier || 1));
}

// 3 event categories: market, choice, targeted
const MARKET_EVENTS = [
  { id:'oil_boom',    w:1, title:'Boom pétrolier mondial',     desc:'Les marchés pétroliers explosent. Les pays producteurs s\'enrichissent massivement.', effect:'Prix pétrole ×4 · Revenus pétrole ×3 cette période · Achat pétrole bloqué < 4500 pts', type:'market', priceChanges:{oil:4.0}, oilIncomeMultiplier:3, blockOilBelowPower:4500 },
  { id:'food_crisis', w:1, title:'Famine mondiale',            desc:'Les récoltes mondiales s\'effondrent. La nourriture devient une ressource rare et précieuse.', effect:'Prix nourriture ×4 · Les pays < 300 nourr. perdent 25% puissance', type:'market', priceChanges:{food:4.0}, special:'foodCrisis' },
  { id:'trade_open',  w:1, title:'Traité de libre-échange',    desc:'Un accord mondial ouvre les frontières commerciales.', effect:'Toutes ressources −40% prix · Revenus de base +100 or', type:'market', priceChanges:{oil:0.6, food:0.6}, special:'tradeBonus' },
  { id:'oil_crisis',  w:1, title:'Crise pétrolière',           desc:'Les réserves mondiales s\'effondrent brusquement.', effect:'Prix pétrole ×3 · Pays sans pétrole: −200 pts puissance', type:'market', priceChanges:{oil:3.0}, special:'oilCrisisPenalty' },
  { id:'gold_rush',   w:1, title:'Ruée vers l\'or',            desc:'De nouveaux gisements sont découverts partout dans le monde.', effect:'Revenus de base ×2.5 cette période', type:'market', special:'goldRush' },
];

const CHOICE_EVENTS = [
  { id:'embargo',     w:1, title:'Embargo international',       desc:'Le Conseil de Sécurité de l\'ONU impose un embargo. Chaque nation choisit sa réponse.', effect:'CHOIX: Sacrifier 200 pétrole (rester neutre) OU perdre 600 or de sanctions', type:'choice', choiceA:{label:'Sacrifier 200 pétrole',cost:{oil:200}}, choiceB:{label:'Payer 600 or de sanctions',cost:{treasury:600}} },
  { id:'arms_race',   w:1, title:'Course aux armements',        desc:'La menace militaire mondiale oblige les nations à choisir leur camp.', effect:'CHOIX: Investir 400 or → +80 armée OU Investir 300 nourriture → +50 armée +15% bonus combat', type:'choice', choiceA:{label:'Investissement militaire (400 or)',cost:{treasury:400},gain:{army:80}}, choiceB:{label:'Mobilisation populaire (300 nourr.)',cost:{food:300},gain:{army:50,combatBonus:0.15}} },
  { id:'famine_aid',  w:1, title:'Appel à l\'aide humanitaire', desc:'Une famine mondiale frappe les plus vulnérables. Les nations choisissent leur réponse.', effect:'CHOIX: Donner 200 nourriture (+300 pts réputation, +50 armée FMI) OU Garder ses stocks (−200 pts réputation)', type:'choice', choiceA:{label:'Donner 200 nourriture',cost:{food:200},gain:{army:50,power:300}}, choiceB:{label:'Garder ses stocks',cost:{},gain:{powerLoss:200}} },
  { id:'tech_deal',   w:1, title:'Accord technologique',        desc:'Un pacte technologique secret est proposé. Chaque nation choisit de signer ou non.', effect:'CHOIX: Payer 350 or → +60 armée +200 pts puissance tech OU Refuser (aucun effet)', type:'choice', choiceA:{label:'Signer l\'accord (350 or)',cost:{treasury:350},gain:{army:60,power:200}}, choiceB:{label:'Refuser',cost:{},gain:{}} },
  { id:'war_prep',    w:1, title:'Préparation de guerre',       desc:'Les tensions atteignent un sommet. Investissez dans votre défense ou votre attaque.', effect:'CHOIX: Bunker gratuit + +100 pts défense OU Frappe préventive: +150 armée (coût: 500 or)', type:'choice', choiceA:{label:'Défense renforcée (gratuit)',cost:{},gain:{defense:true,power:100}}, choiceB:{label:'Frappe préventive (500 or)',cost:{treasury:500},gain:{army:150}} },
];

const TARGETED_EVENTS = [
  { id:'earthquake',  w:2, title:'Séisme majeur',              desc:'Un séisme dévastateur frappe [PAYS]. Leurs infrastructures sont ravagées.', effect:'[PAYS ALÉATOIRE]: −40% nourriture, −200 pts puissance', type:'targeted', targetCount:1, effects:{foodLoss:0.40, powerLoss:200} },
  { id:'sanctions',   w:1, title:'Sanctions ciblées',          desc:'Le G7 impose des sanctions massives contre les économies dominantes.', effect:'Tier S et A: −500 or · 3 nations les plus faibles: +200 or', type:'targeted', special:'sanctionsAndAid' },
  { id:'revolution',  w:2, title:'Révolution des ressources',  desc:'Les nations émergentes se soulèvent contre l\'ordre mondial établi.', effect:'Pays < 4000 pts: +250 or · Pays > 8000 pts: −200 or', type:'targeted', special:'revolution' },
  { id:'fmi_aid',     w:2, title:'Aide d\'urgence FMI',        desc:'Le FMI intervient en urgence pour soutenir les économies les plus fragiles.', effect:'3 nations les plus faibles: +200 or +40 armée', type:'targeted', special:'aidFMI' },
  { id:'oil_sanction',w:1, title:'Blocus pétrolier',           desc:'Un blocus international prive les nations riches en pétrole de leurs revenus.', effect:'Pays pétrole > 300: −300 or · Pays pétrole < 100: +200 or (compensation)', type:'targeted', special:'oilBlocus' },
  { id:'typhoon',     w:1, title:'Typhon dévastateur',         desc:'Un typhon frappe 2 nations aléatoires, détruisant leurs récoltes.', effect:'2 pays aléatoires: −50% nourriture', type:'targeted', targetCount:2, effects:{foodLoss:0.50} },
  { id:'b_army',      w:2, title:'Soulèvement populaire',      desc:'Les peuples opprimés prennent les armes pour leur liberté.', effect:'Tier B: +50 armée gratuit · Tier S: −100 armée (désertion)', type:'targeted', special:'uprising' },
];

const ALL_EVENTS = [...MARKET_EVENTS, ...CHOICE_EVENTS, ...TARGETED_EVENTS];

function weightedRandomEvent() {
  const pool = [];
  ALL_EVENTS.forEach(ev => { for(let i=0;i<(ev.w||1);i++) pool.push(ev); });
  return pool[Math.floor(Math.random() * pool.length)];
}

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",         subtitle:"Janvier — Juin · An 1",   desc:"Bienvenue dans Geopolitica. Les marchés s'ouvrent, c'est le moment d'investir. Le pétrole génère de l'or passif à chaque période — achetez-en maintenant pendant que les prix sont bas. La nourriture diminue automatiquement selon votre population. Vous disposez de 2 actions cette manche." },
  { number:2, name:"Premières Tensions",           subtitle:"Juillet — Déc · An 1",    desc:"Les intérêts divergent. Les premières frictions apparaissent. Attention: un événement peut retourner la situation en votre faveur ou vous ruiner. Diversifiez vos ressources. Les pays qui ont investi en pétrole commencent à générer des revenus passifs. 2 actions disponibles." },
  { number:3, name:"Crise Mondiale",               subtitle:"Janvier — Juin · An 2",   desc:"Une catastrophe frappe la planète. Cet événement peut être devastateur — ou une opportunité. Si l'événement est un CHOIX, vous avez 60 secondes pour décider. Pensez à votre stock de nourriture: la famine peut détruire votre armée. 2 actions disponibles — choisissez bien." },
  { number:4, name:"Course aux Armements",         subtitle:"Juillet — Déc · An 2",    desc:"La guerre approche. Investissez dans votre armée ou votre défense. Le bunker (200 or) réduit les dégâts de 30% en cas d'attaque. C'est votre avant-dernière chance de bien vous positionner économiquement. 2 actions disponibles." },
  { number:5, name:"Ultimatums",                   subtitle:"Janvier — Juin · An 3",   desc:"Les diplomates ont échoué. Sanctions, alliances, ultimatums. C'est votre dernière période pour maximiser vos ressources. Après cette période, la GUERRE commence. Attention: en guerre aucun achat n'est possible. Dépensez votre or maintenant ! 2 actions disponibles." },
  { number:6, name:"Le Monde Retient son Souffle", subtitle:"Juillet — Déc · An 3",    desc:"DERNIÈRE PÉRIODE DE PAIX. Plus aucun achat après cette manche. Convertissez votre or en armée ou en bunker. La nourriture et le pétrole comptent dans votre puissance de combat. Dans quelques instants, la guerre mondiale sera déclarée. 2 actions — dernière chance." },
];

let gameState = {
  phase:'setup', currentPeriod:0, currentEvent:null,
  countries:{}, takenCountries:{}, teams:{},
  prices:{ oil:80, food:40 },
  eventMod:{ oilIncomeMultiplier:1, baseIncomeMultiplier:1, blockOilBelowPower:0, peace:false, combatBonuses:{} },
  coalition:{ proposed:false, moroccoAccepted:false, guineaAccepted:false, active:false },
  log:[], timerSeconds:600, timerRunning:false,
  warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30,
  teamActionsThisPeriod:{},
  pendingChoiceEvent: null, // for choice events
};

let timerInterval = null;
let warTurnInterval = null;

function initCountries() {
  gameState.countries = {};
  COUNTRIES.forEach(c => {
    gameState.countries[c.id] = {
      ...c, treasury:c.gold,
      power:calcPower({...c, treasury:c.gold}),
      eliminated:false, defense:false, team:null,
      combatBonus:0,
    };
  });
}

function calcPower(c) {
  const tierBonus = c.tier === 'B' ? 1.15 : 1.0;
  return Math.max(0, Math.round((
    c.army * 10 +
    (c.treasury||0) * 0.25 +
    c.oil * 0.8 +
    c.food * 1.2
  ) * tierBonus));
}

function resolveCombat(att, def) {
  const tierBonusAtt = att.tier === 'B' ? 1.15 : 1.0;
  const tierBonusDef = def.tier === 'B' ? 1.15 : 1.0;
  const combatBonusAtt = 1 + (att.combatBonus || 0);
  const randAtt = 1 + Math.random() * 0.20 + Math.random() * 0.20;
  const randDef = 1 + Math.random() * 0.20 + Math.random() * 0.20;
  const scoreAtt = att.power * randAtt * tierBonusAtt * combatBonusAtt + att.food * 0.07;
  const scoreDef = def.power * randDef * tierBonusDef * 1.15 + def.food * 0.07 + (def.defense ? def.power * 0.30 : 0);
  return { attackerWins: scoreAtt > scoreDef, scoreAtt:Math.round(scoreAtt), scoreDef:Math.round(scoreDef) };
}

function addLog(text, type) {
  gameState.log.unshift({ text, type, time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) });
  if (gameState.log.length > 100) gameState.log = gameState.log.slice(0,100);
}

function addTeamNews(teamName, text, type) {
  if (!gameState.teams[teamName]) return;
  gameState.teams[teamName].news = gameState.teams[teamName].news || [];
  gameState.teams[teamName].news.push({ text, type, time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) });
}

function broadcast() { io.emit('state', gameState); }

function applyMarketEvent(ev) {
  gameState.prices = { oil:80, food:40 };
  gameState.eventMod = { oilIncomeMultiplier:1, baseIncomeMultiplier:1, blockOilBelowPower:0, peace:false, combatBonuses:{} };
  if (ev.priceChanges) {
    if (ev.priceChanges.oil)  gameState.prices.oil  = Math.round(80 * ev.priceChanges.oil);
    if (ev.priceChanges.food) gameState.prices.food = Math.round(40 * ev.priceChanges.food);
  }
  if (ev.oilIncomeMultiplier) gameState.eventMod.oilIncomeMultiplier = ev.oilIncomeMultiplier;
  if (ev.blockOilBelowPower)  gameState.eventMod.blockOilBelowPower  = ev.blockOilBelowPower;
  if (ev.special === 'foodCrisis') {
    Object.values(gameState.countries).forEach(c => {
      if (!c.eliminated && c.food < 300) { const loss=Math.round(c.power*0.25); c.power=Math.max(0,c.power-loss); addTeamNews(c.team,`🚨 Famine mondiale: vos stocks faibles vous coûtent −${loss} pts de puissance !`,'bad'); }
    });
  }
  if (ev.special === 'tradeBonus') { gameState.eventMod.baseIncomeMultiplier = 2.0; }
  if (ev.special === 'goldRush')   { gameState.eventMod.baseIncomeMultiplier = 2.5; }
  if (ev.special === 'oilCrisisPenalty') {
    Object.values(gameState.countries).forEach(c => {
      if (!c.eliminated && c.oil < 100) { c.power=Math.max(0,c.power-200); addTeamNews(c.team,'⛽ Crise pétrolière: manque de pétrole −200 pts de puissance !','bad'); }
    });
  }
}

function applyTargetedEvent(ev) {
  if (ev.special === 'sanctionsAndAid') {
    Object.values(gameState.countries).forEach(c => {
      if (!c.eliminated && (c.tier==='S'||c.tier==='A')) { c.treasury=Math.max(0,c.treasury-500); c.power=calcPower(c); addTeamNews(c.team,'⚠️ Sanctions G7: −500 or !','bad'); }
    });
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3);
    alive.forEach(c=>{ c.treasury+=200; c.power=calcPower(c); addTeamNews(c.team,'🤝 Aide compensatoire FMI: +200 or !','good'); });
  }
  if (ev.special === 'revolution') {
    Object.values(gameState.countries).forEach(c => {
      if (!c.eliminated) {
        if (c.power < 4000) { c.treasury+=250; c.power=calcPower(c); addTeamNews(c.team,'✊ Révolution: +250 or !','good'); }
        if (c.power > 8000) { c.treasury=Math.max(0,c.treasury-200); c.power=calcPower(c); addTeamNews(c.team,'✊ Révolution mondiale: −200 or (pression populaire)','bad'); }
      }
    });
  }
  if (ev.special === 'aidFMI') {
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3);
    alive.forEach(c=>{ c.treasury+=200; c.army+=40; c.power=calcPower(c); addTeamNews(c.team,'🏦 Aide FMI urgence: +200 or +40 armée !','good'); });
  }
  if (ev.special === 'oilBlocus') {
    Object.values(gameState.countries).forEach(c => {
      if (!c.eliminated) {
        if (c.oil > 300) { c.treasury=Math.max(0,c.treasury-300); c.power=calcPower(c); addTeamNews(c.team,'🚢 Blocus pétrolier: −300 or !','bad'); }
        else if (c.oil < 100) { c.treasury+=200; c.power=calcPower(c); addTeamNews(c.team,'🚢 Compensation blocus: +200 or !','good'); }
      }
    });
  }
  if (ev.special === 'uprising') {
    Object.values(gameState.countries).forEach(c => {
      if (!c.eliminated) {
        if (c.tier==='B') { c.army+=50; c.power=calcPower(c); addTeamNews(c.team,'✊ Soulèvement: +50 armée gratuit !','good'); }
        if (c.tier==='S') { c.army=Math.max(0,c.army-100); c.power=calcPower(c); addTeamNews(c.team,'✊ Désertion: −100 armée (soulèvement populaire)','bad'); }
      }
    });
  }
  // Targeted random countries
  if (ev.effects) {
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated);
    const targets=alive.sort(()=>Math.random()-0.5).slice(0,ev.targetCount||1);
    targets.forEach(c=>{
      if (ev.effects.foodLoss) { const loss=Math.round(c.food*ev.effects.foodLoss); c.food=Math.max(0,c.food-loss); c.power=calcPower(c); addTeamNews(c.team,`🌋 ${ev.title}: −${loss} nourriture !`,'bad'); addLog(`${ev.title}: ${c.flag} ${c.name} −${loss} nourr`,'event'); }
      if (ev.effects.powerLoss) { c.power=Math.max(0,c.power-ev.effects.powerLoss); addTeamNews(c.team,`🌋 ${ev.title}: −${ev.effects.powerLoss} pts puissance !`,'bad'); }
    });
  }
}

function applyPeriodTransition() {
  gameState.eventMod = { oilIncomeMultiplier:1, baseIncomeMultiplier:1, blockOilBelowPower:0, peace:false, combatBonuses:{} };
  gameState.prices = { oil:80, food:40 };
  Object.values(gameState.countries).forEach(c => {
    if (c.eliminated) return;
    // Food consumption — proportional to population
    const foodNeeded = getFoodConsumption(c);
    if (c.food >= foodNeeded) {
      c.food -= foodNeeded;
      addTeamNews(c.team, `🍞 Consommation: −${foodNeeded} nourriture (population ${c.population}M)`, 'neutral');
    } else {
      const deficit = foodNeeded - c.food;
      c.food = 0;
      // Power loss proportional to deficit AND population
      const powerLoss = Math.round(deficit * (c.population / 10) * 2);
      c.power = Math.max(0, c.power - powerLoss);
      addTeamNews(c.team, `⚠️ FAMINE ! Manque de ${deficit} nourriture pour ${c.population}M habitants — −${powerLoss} pts puissance !`, 'bad');
      addLog(`Famine: ${c.flag} ${c.name} −${powerLoss} pts`, 'event');
    }
    // Oil income — reduced base, multiplied during oil events
    const oilIncome = getOilIncome(c, gameState.eventMod.oilIncomeMultiplier);
    if (oilIncome > 0) { c.treasury += oilIncome; addTeamNews(c.team, `🛢️ Revenus pétroliers: +${oilIncome} or`, 'good'); }
    // Base income — higher, scales with country size
    const baseInc = Math.round(getBaseIncome(c) * (gameState.eventMod.baseIncomeMultiplier || 1));
    c.treasury += baseInc;
    addTeamNews(c.team, `💰 Revenus de base: +${baseInc} or`, 'good');
    c.defense = false;
    c.combatBonus = 0;
    c.power = calcPower(c);
  });
  gameState.teamActionsThisPeriod = {};
}

function startServerTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  gameState.timerSeconds = seconds; gameState.timerRunning = true;
  timerInterval = setInterval(() => {
    if (gameState.timerSeconds > 0) { gameState.timerSeconds--; io.emit('timer',{seconds:gameState.timerSeconds,running:true}); }
    else { clearInterval(timerInterval); timerInterval=null; gameState.timerRunning=false; io.emit('timer',{seconds:0,running:false,ended:true}); }
  }, 1000);
}
function pauseServerTimer() { if(timerInterval){clearInterval(timerInterval);timerInterval=null;} gameState.timerRunning=false; io.emit('timer',{seconds:gameState.timerSeconds,running:false}); }
function resetServerTimer(s) { pauseServerTimer(); gameState.timerSeconds=s||600; io.emit('timer',{seconds:gameState.timerSeconds,running:false}); }

function startWarTurn() {
  const alive = Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  gameState.warTurnOrder = alive.map(c=>c.team);
  gameState.warCurrentTurn = 0;
  advanceWarTurn();
}
function advanceWarTurn() {
  if (warTurnInterval) clearInterval(warTurnInterval);
  gameState.warTurnOrder = Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated).map(c=>c.team);
  if (gameState.warCurrentTurn >= gameState.warTurnOrder.length) gameState.warCurrentTurn = 0;
  if (gameState.warTurnOrder.length === 0) return;
  const team = gameState.warTurnOrder[gameState.warCurrentTurn];
  gameState.warTurnSeconds = 30;
  io.emit('warTurn',{team,seconds:30,turnIndex:gameState.warCurrentTurn,total:gameState.warTurnOrder.length});
  addLog(`Tour de ${team}`, 'event');
  broadcast();
  warTurnInterval = setInterval(() => {
    gameState.warTurnSeconds--;
    io.emit('warTurnTimer',{seconds:gameState.warTurnSeconds,team});
    if (gameState.warTurnSeconds <= 0) { clearInterval(warTurnInterval); addTeamNews(team,'⏰ Temps écoulé — tour passé !','bad'); gameState.warCurrentTurn++; advanceWarTurn(); }
  }, 1000);
}
function nextWarTurn() { if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;} gameState.warCurrentTurn++; advanceWarTurn(); }

io.on('connection', (socket) => {
  socket.emit('state', gameState);
  socket.emit('periods', PERIODS);
  socket.emit('timer',{seconds:gameState.timerSeconds,running:gameState.timerRunning});

  socket.on('mj:startDraft', () => {
    initCountries(); gameState.phase='draft'; gameState.currentPeriod=0;
    gameState.coalition={proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false};
    gameState.teamActionsThisPeriod={};
    resetServerTimer(600); addLog('Draft démarré','event'); broadcast();
  });

  socket.on('mj:startProsperity', () => {
    gameState.phase='prosperity'; gameState.currentPeriod=1; gameState.currentEvent=null;
    gameState.teamActionsThisPeriod={};
    const period=PERIODS[0]; const ev=weightedRandomEvent();
    gameState.currentEvent={...ev,periodName:period.name,periodSubtitle:period.subtitle,periodDesc:period.desc,periodNumber:period.number};
    if (ev.type==='market') applyMarketEvent(ev);
    else if (ev.type==='targeted') applyTargetedEvent(ev);
    else if (ev.type==='choice') { gameState.pendingChoiceEvent=ev; io.emit('choiceEvent',ev); }
    resetServerTimer(600);
    addLog(`Période 1 — ${period.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,`📅 Période 1 — ${period.name}\n${period.desc}\n\n⚡ ${ev.title} (${ev.type==='choice'?'CHOIX REQUIS':ev.type==='targeted'?'CIBLÉ':'MARCHÉ'}): ${ev.effect}`,'neutral'); });
    broadcast();
  });

  socket.on('mj:nextPeriod', () => {
    if (gameState.currentPeriod >= 6) return;
    applyPeriodTransition();
    gameState.currentPeriod++;
    const period=PERIODS[gameState.currentPeriod-1]; const ev=weightedRandomEvent();
    gameState.currentEvent={...ev,periodName:period.name,periodSubtitle:period.subtitle,periodDesc:period.desc,periodNumber:period.number};
    gameState.pendingChoiceEvent=null;
    if (ev.type==='market') applyMarketEvent(ev);
    else if (ev.type==='targeted') applyTargetedEvent(ev);
    else if (ev.type==='choice') { gameState.pendingChoiceEvent=ev; io.emit('choiceEvent',ev); }
    resetServerTimer(600);
    addLog(`Période ${gameState.currentPeriod} — ${period.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,`📅 Période ${gameState.currentPeriod} — ${period.name}\n${period.desc}\n\n⚡ ${ev.title} (${ev.type==='choice'?'CHOIX REQUIS — 60 secondes !':ev.type==='targeted'?'CIBLÉ':'MARCHÉ'}): ${ev.effect}`,'neutral'); });
    broadcast();
  });

  socket.on('mj:startWar', () => {
    gameState.phase='war'; gameState.currentEvent=null; gameState.pendingChoiceEvent=null;
    gameState.teamActionsThisPeriod={};
    gameState.coalition={proposed:true,moroccoAccepted:false,guineaAccepted:false,active:false};
    resetServerTimer(600);
    addLog('⚔️ GUERRE MONDIALE DÉMARRÉE','attack');
    if(gameState.countries.morocco?.team) addTeamNews(gameState.countries.morocco.team,'🤝 Coalition proposée avec la Guinée !','neutral');
    if(gameState.countries.guinea?.team)  addTeamNews(gameState.countries.guinea.team,'🤝 Coalition proposée avec le Maroc !','neutral');
    Object.values(gameState.countries).forEach(c=>{ if(c.team&&c.id!=='morocco'&&c.id!=='guinea') addTeamNews(c.team,'⚔️ La guerre est déclarée ! Aucun achat possible. Attendez votre tour pour attaquer.','bad'); });
    broadcast();
    setTimeout(()=>startWarTurn(),3000);
  });

  socket.on('mj:timerStart', ({seconds})=>startServerTimer(seconds||gameState.timerSeconds));
  socket.on('mj:timerPause', ()=>pauseServerTimer());
  socket.on('mj:timerReset', ({seconds})=>resetServerTimer(seconds));
  socket.on('mj:nextWarTurn', ()=>nextWarTurn());
  socket.on('mj:startWarTurns', ()=>startWarTurn());

  // CHOICE EVENT RESPONSE
  socket.on('team:choiceResponse', ({teamName, choice}) => {
    const ev = gameState.pendingChoiceEvent; if (!ev) return;
    const team=gameState.teams[teamName]; if (!team||!team.country) return;
    const c=gameState.countries[team.country];
    const chosen = choice==='A' ? ev.choiceA : ev.choiceB;
    let success=true; let msg='';
    // Apply costs
    if (chosen.cost) {
      if (chosen.cost.treasury && c.treasury < chosen.cost.treasury) { socket.emit('error',`Pas assez d'or ! (${chosen.cost.treasury} requis)`); return; }
      if (chosen.cost.oil && c.oil < chosen.cost.oil) { socket.emit('error',`Pas assez de pétrole ! (${chosen.cost.oil} requis)`); return; }
      if (chosen.cost.food && c.food < chosen.cost.food) { socket.emit('error',`Pas assez de nourriture ! (${chosen.cost.food} requis)`); return; }
      if (chosen.cost.treasury) { c.treasury-=chosen.cost.treasury; msg+=`−${chosen.cost.treasury} or`; }
      if (chosen.cost.oil)      { c.oil-=chosen.cost.oil; msg+=` −${chosen.cost.oil} pétrole`; }
      if (chosen.cost.food)     { c.food-=chosen.cost.food; msg+=` −${chosen.cost.food} nourriture`; }
    }
    // Apply gains
    if (chosen.gain) {
      if (chosen.gain.army)    { c.army+=chosen.gain.army; msg+=` +${chosen.gain.army} armée`; }
      if (chosen.gain.power)   { c.power+=chosen.gain.power; msg+=` +${chosen.gain.power} pts`; }
      if (chosen.gain.powerLoss) { c.power=Math.max(0,c.power-chosen.gain.powerLoss); msg+=` −${chosen.gain.powerLoss} pts`; }
      if (chosen.gain.defense) { c.defense=true; msg+=` +bunker`; }
      if (chosen.gain.combatBonus) { c.combatBonus=(c.combatBonus||0)+chosen.gain.combatBonus; msg+=` +${Math.round(chosen.gain.combatBonus*100)}% combat`; }
    }
    c.power=calcPower(c);
    addTeamNews(teamName,`✅ Choix "${chosen.label}": ${msg}`,'good');
    addLog(`${c.flag} ${c.name} choisit: ${chosen.label}`,'event');
    broadcast();
  });

  socket.on('team:acceptCoalition', ({teamName})=>{
    const c=Object.values(gameState.countries).find(c=>c.team===teamName); if(!c) return;
    if(c.id==='morocco') gameState.coalition.moroccoAccepted=true;
    if(c.id==='guinea')  gameState.coalition.guineaAccepted=true;
    if(gameState.coalition.moroccoAccepted&&gameState.coalition.guineaAccepted){
      gameState.coalition.active=true;
      const morocco=gameState.countries.morocco,guinea=gameState.countries.guinea;
      morocco.treasury+=guinea.treasury; morocco.oil+=guinea.oil; morocco.food+=guinea.food; morocco.army+=guinea.army;
      morocco.power=calcPower(morocco); guinea.treasury=0; guinea.oil=0; guinea.food=0; guinea.army=0; guinea.power=morocco.power;
      addLog('🤝 Coalition Maroc-Guinée activée !','event');
      addTeamNews(morocco.team,'✅ Coalition active ! Ressources fusionnées.','good');
      addTeamNews(guinea.team,'✅ Coalition active !','good');
    } else addTeamNews(teamName,"✅ Accepté — en attente de l'autre équipe...",'neutral');
    broadcast();
  });
  socket.on('team:refuseCoalition', ({teamName})=>{
    gameState.coalition.proposed=false;
    addTeamNews(gameState.countries.morocco?.team,'❌ Coalition refusée.','bad');
    addTeamNews(gameState.countries.guinea?.team,'❌ Coalition refusée.','bad');
    broadcast();
  });

  socket.on('team:declareAttack', ({teamName, targetId, payWith})=>{
    if(gameState.phase!=='war'){ socket.emit('error',"La guerre n'a pas commencé !"); return; }
    if(gameState.eventMod.peace){ socket.emit('error','Paix mondiale — attaques suspendues !'); return; }
    const currentTurnTeam=gameState.warTurnOrder[gameState.warCurrentTurn];
    if(currentTurnTeam!==teamName){ socket.emit('error',"Ce n'est pas votre tour !"); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const att=gameState.countries[team.country]; const def=gameState.countries[targetId];
    if(!att||!def||att.eliminated||def.eliminated) return;
    // Payment options: gold (150), oil (200), food (300)
    const costs = { gold:150, oil:200, food:300 };
    const payResource = payWith || 'gold';
    const cost = costs[payResource] || 150;
    const resourceKey = payResource==='gold' ? 'treasury' : payResource;
    if(att[resourceKey]<cost){ socket.emit('error',`Pas assez de ${payResource==='gold'?'or':payResource} ! (${cost} requis)`); return; }
    att[resourceKey]-=cost; att.power=calcPower(att);
    const result=resolveCombat(att,def);
    const armyLossAtt=Math.round(att.army*(result.attackerWins?0.12:0.28));
    const armyLossDef=Math.round(def.army*(result.attackerWins?0.35:0.10));
    if(result.attackerWins){
      att.treasury+=def.treasury; att.oil+=def.oil; att.food+=def.food; att.army+=def.army;
      att.army=Math.max(0,att.army-armyLossAtt);
      def.treasury=0; def.oil=0; def.food=0; def.army=0;
      att.power=calcPower(att); def.power=calcPower(def);
      addLog(`💥 ${att.flag} ${att.name} écrase ${def.flag} ${def.name} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`🏆 VICTOIRE vs ${def.flag} ${def.name} ! Toutes leurs ressources pillées. −${armyLossAtt} armée`,'good');
      addTeamNews(def.team,`💀 DÉFAITE vs ${att.flag} ${att.name} — tout pillé. −${armyLossDef} armée`,'bad');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:true,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
      if(def.army<=0&&def.treasury<=0){ def.eliminated=true; addLog(`☠️ ${def.flag} ${def.name} éliminé !`,'eliminated'); addTeamNews(def.team,'☠️ Votre nation est anéantie.','bad'); if(gameState.coalition.active&&(def.id==='morocco'||def.id==='guinea')){ gameState.countries.morocco.eliminated=true; gameState.countries.guinea.eliminated=true; } }
    } else {
      const goldLoss=Math.round(att.treasury*0.35); att.treasury=Math.max(0,att.treasury-goldLoss);
      att.army=Math.max(0,att.army-armyLossAtt); def.army=Math.max(0,def.army-armyLossDef);
      att.power=calcPower(att); def.power=calcPower(def);
      addLog(`🛡️ ${def.flag} ${def.name} repousse ${att.flag} ${att.name} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`❌ Échec vs ${def.flag} ${def.name} — −${goldLoss} or, −${armyLossAtt} armée`,'bad');
      addTeamNews(def.team,`🛡️ Repoussé ${att.flag} ${att.name} ! −${armyLossDef} armée pertes défensives`,'good');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:false,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
    }
    broadcast();
    setTimeout(()=>nextWarTurn(),2000);
  });

  socket.on('team:skipTurn', ({teamName})=>{
    if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName) return;
    addTeamNews(teamName,'Tour passé.','neutral'); nextWarTurn(); broadcast();
  });

  socket.on('team:buyResource', ({teamName, resource, qty})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun achat en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    const actions=gameState.teamActionsThisPeriod[teamName]||0;
    if(actions>=2){ socket.emit('error','2 actions déjà utilisées cette période !'); return; }
    if(resource==='oil'&&gameState.eventMod.blockOilBelowPower>0&&c.power<gameState.eventMod.blockOilBelowPower){ socket.emit('error',`Achat pétrole bloqué (boom pétrolier actif, réservé aux > ${gameState.eventMod.blockOilBelowPower} pts) !`); return; }
    const price=gameState.prices[resource]||80; const total=price*qty;
    if(c.treasury<total){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=total; c[resource]+=qty; c.power=calcPower(c);
    gameState.teamActionsThisPeriod[teamName]=(actions)+1;
    addTeamNews(teamName,`✅ Achat: +${qty} ${resource} pour ${total} or (action ${actions+1}/2 utilisée)`,'good');
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
    if(actions>=2){ socket.emit('error','2 actions déjà utilisées cette période !'); return; }
    const mult=gameState.eventMod.armyCostMult||1;
    const costPer=type==='tech'?300:150; const powerPer=type==='tech'?50:20;
    const cost=Math.round(costPer*qty*mult);
    if(c.treasury<cost){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=cost; if(type!=='tech') c.army+=qty; c.power+=qty*powerPer;
    gameState.teamActionsThisPeriod[teamName]=(actions)+1;
    addTeamNews(teamName,`✅ Recrutement: +${qty*powerPer} puissance pour ${cost} or (action ${actions+1}/2 utilisée)`,'good');
    broadcast();
  });

  socket.on('team:buyDefense', ({teamName})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun achat en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    const actions=gameState.teamActionsThisPeriod[teamName]||0;
    if(actions>=2){ socket.emit('error','2 actions déjà utilisées cette période !'); return; }
    if(c.treasury<200){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=200; c.defense=true;
    gameState.teamActionsThisPeriod[teamName]=(actions)+1;
    addTeamNews(teamName,'🛡️ Bunker activé ! −30% dommages reçus. (action utilisée)','good');
    io.emit('defenseActivated',{countryId:c.id,teamName});
    broadcast();
  });

  socket.on('mj:eliminate', ({countryId})=>{
    const c=gameState.countries[countryId]; if(!c) return;
    c.eliminated=true;
    if(gameState.coalition.active&&(countryId==='morocco'||countryId==='guinea')){ gameState.countries.morocco.eliminated=true; gameState.countries.guinea.eliminated=true; }
    addLog(`☠️ ${c.flag} ${c.name} éliminé !`,'eliminated');
    addTeamNews(c.team,'Votre nation a été conquise.','bad'); broadcast();
  });

  socket.on('mj:bonus', ({countryId, amount})=>{
    const c=gameState.countries[countryId]; if(!c) return;
    c.treasury+=amount; c.power=calcPower(c);
    addLog(`${amount>0?'+':''}${amount} or → ${c.flag} ${c.name}`,amount>0?'economy':'attack'); broadcast();
  });

  socket.on('mj:reset', ()=>{
    if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
    if(warTurnInterval){clearInterval(warTurnInterval);warTurnInterval=null;}
    gameState={ phase:'setup', currentPeriod:0, currentEvent:null, countries:{}, takenCountries:{}, teams:{}, prices:{oil:80,food:40}, eventMod:{oilIncomeMultiplier:1,baseIncomeMultiplier:1,blockOilBelowPower:0,peace:false,combatBonuses:{}}, coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false}, log:[], timerSeconds:600, timerRunning:false, warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30, teamActionsThisPeriod:{}, pendingChoiceEvent:null };
    broadcast(); io.emit('timer',{seconds:600,running:false});
  });

  socket.on('team:join', ({teamName})=>{ if(!gameState.teams[teamName]) gameState.teams[teamName]={country:null,news:[]}; broadcast(); });
  socket.on('team:draftCountry', ({teamName, countryId})=>{
    if(gameState.takenCountries[countryId]){ socket.emit('error','Ce pays est déjà pris !'); return; }
    gameState.takenCountries[countryId]=teamName; gameState.teams[teamName].country=countryId; gameState.countries[countryId].team=teamName;
    addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} choisi par ${teamName}`,'event'); broadcast();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Geopolitica running on port ${PORT}`));
