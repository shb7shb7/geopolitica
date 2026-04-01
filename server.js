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
  { id:'usa',     flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:800, oil:300, food:400, army:320, population:330 },
  { id:'china',   flag:'🇨🇳', name:'Chine',        tier:'S', gold:750, oil:300, food:500, army:300, population:1400 },
  { id:'russia',  flag:'🇷🇺', name:'Russie',       tier:'A', gold:500, oil:500, food:200, army:260, population:145 },
  { id:'germany', flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:600, oil:150, food:300, army:230, population:83 },
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:680, oil:550, food:80,  army:180, population:3 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:550, oil:100, food:350, army:220, population:68 },
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:400, oil:200, food:650, army:160, population:215 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:380, oil:150, food:600, army:180, population:1400 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:320, oil:80,  food:400, army:150, population:37 },
  { id:'guinea',  flag:'🇬🇳', name:'Guinée',       tier:'B', gold:220, oil:60,  food:380, army:130, population:13 },
];

// Underdog events appear 2x in pool for higher probability
const EVENT_POOL = [
  // Standard events
  { w:1, title:'Boom économique mondial',    desc:'La croissance explose dans toutes les régions.', effect:'Tous les pays +80 or', special:'globalBonus', bonus:80 },
  { w:1, title:'Ouverture des marchés',      desc:'Les accords commerciaux facilitent les échanges.', effect:'Prix ressources −25%', priceChanges:{ oil:0.75, food:0.75 } },
  { w:1, title:'Découverte de gisements',   desc:'Nouveaux gisements pétroliers offshore.', effect:'Pays pétrole ≥300: +200 or', special:'oilBonus', threshold:300, bonus:200 },
  { w:1, title:'Guerre commerciale',         desc:'Les grandes puissances s\'affrontent sur les tarifs.', effect:'Tier S et A: −150 or', special:'tradeWar' },
  { w:1, title:'Pénurie alimentaire',        desc:'Troubles agricoles dans plusieurs régions.', effect:'Prix nourriture ×2', priceChanges:{ food:2.0 } },
  { w:1, title:'Crise pétrolière',           desc:'Les réserves mondiales s\'effondrent.', effect:'Prix pétrole ×2.5', priceChanges:{ oil:2.5 } },
  { w:1, title:'Pandémie économique',        desc:'Une crise financière paralyse les marchés.', effect:'Tous −20% trésor', special:'crisis', ratio:0.80 },
  { w:1, title:'Catastrophe naturelle',      desc:'Séismes et tsunamis ravagent des régions.', effect:'2 pays aléatoires −300 pts puissance', special:'megaQuake' },
  { w:1, title:'Course aux armements',       desc:'L\'industrie militaire tourne à plein régime.', effect:'Armée −30% coût cette période', special:'cheapArmy', armyCostMult:0.7 },
  { w:1, title:'Alliance défensive',         desc:'Des pactes de non-agression sont signés.', effect:'Attaques suspendues cette période', special:'peace' },
  { w:1, title:'Mobilisation générale',      desc:'Les nations rappellent leurs réservistes.', effect:'Armée de tous ×1.3', special:'mobilization' },
  { w:1, title:'Boom pétrolier',             desc:'Production record dans les pays exportateurs.', effect:'Pays pétrole ≥200: +150 or', special:'oilBonus2', threshold:200, bonus:150 },
  { w:1, title:'Sanctions internationales',  desc:'Le G7 impose des sanctions massives.', effect:'Tier B: −100 or · 3 plus faibles: +180 or', special:'sanctionsAndAid' },
  { w:1, title:'Traité de libre-échange',    desc:'Un accord mondial est signé.', effect:'Prix ressources −30%', priceChanges:{ oil:0.7, food:0.7 } },
  // Underdog events — weight:2 = appear ~2x more often
  { w:2, title:'Révolution des ressources',  desc:'Les nations émergentes se soulèvent contre l\'ordre mondial.', effect:'Pays < 350 pts: +220 or', special:'underdog', threshold:350, bonus:220 },
  { w:2, title:'Aide internationale FMI',    desc:'Le FMI soutient en urgence les économies fragiles.', effect:'3 nations les plus faibles: +160 or +30 armée', special:'aidFMI' },
  { w:2, title:'Marché noir mondial',        desc:'Les circuits informels explosent.', effect:'Pays < 400 pts: prix de vente ×2', special:'blackMarket' },
  { w:2, title:'Soulèvement populaire',      desc:'Les peuples opprimés prennent les armes.', effect:'Pays Tier B: armée +40 gratuit', special:'tierBArmy' },
];

function weightedRandomEvent() {
  const pool = [];
  EVENT_POOL.forEach(ev => { for(let i=0;i<(ev.w||1);i++) pool.push(ev); });
  return pool[Math.floor(Math.random() * pool.length)];
}

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",      subtitle:"Janvier — Juin · An 1",    desc:"Les marchés mondiaux s'ouvrent. Investissez et posez les bases de votre empire.",          video:"https://www.youtube.com/embed/sNBjA0d1NV0?autoplay=1&mute=1" },
  { number:2, name:"Premières Tensions",        subtitle:"Juillet — Déc · An 1",     desc:"Les intérêts divergent. Les premières frictions commerciales apparaissent.",              video:"https://www.youtube.com/embed/8n-h93i3CM0?autoplay=1&mute=1" },
  { number:3, name:"Crise Mondiale",            subtitle:"Janvier — Juin · An 2",    desc:"Une catastrophe majeure frappe la planète. Personne n'est épargné.",                      video:"https://www.youtube.com/embed/Qzz4DpCjjio?autoplay=1&mute=1" },
  { number:4, name:"Course aux Armements",      subtitle:"Juillet — Déc · An 2",     desc:"La guerre se profile. Les nations investissent massivement dans leur défense.",           video:"https://www.youtube.com/embed/JcFgm4OCKWY?autoplay=1&mute=1" },
  { number:5, name:"Ultimatums",                subtitle:"Janvier — Juin · An 3",    desc:"Les diplomates ont échoué. Sanctions, alliances de dernière minute. La guerre est proche.",video:"https://www.youtube.com/embed/eeqxFAFv5RQ?autoplay=1&mute=1" },
  { number:6, name:"Le Monde Retient son Souffle", subtitle:"Juillet — Déc · An 3", desc:"Dernière période de paix. Chaque décision compte. Les canons parleront bientôt.",        video:"https://www.youtube.com/embed/inWWhr5tnEA?autoplay=1&mute=1" },
];

const WAR_VIDEO = "https://www.youtube.com/embed/xdBRgQrWvQE?autoplay=1&mute=1";

let gameState = {
  phase:'setup', currentPeriod:0, currentEvent:null,
  countries:{}, takenCountries:{}, teams:{},
  prices:{ oil:80, food:40 },
  eventMod:{ armyCostMult:1, cheapAttack:false, peace:false, blackMarket:false },
  coalition:{ proposed:false, moroccoAccepted:false, guineaAccepted:false, active:false },
  log:[], warVideo:WAR_VIDEO, timerSeconds:0, timerRunning:false,
};

let timerInterval = null;

function initCountries() {
  gameState.countries = {};
  COUNTRIES.forEach(c => {
    gameState.countries[c.id] = { ...c, treasury:c.gold, power:calcPower({...c,treasury:c.gold}), eliminated:false, defense:false, team:null };
  });
}

function calcPower(c) {
  const tierBonus = c.tier === 'B' ? 1.15 : 1.0;
  return Math.max(0, Math.round((c.army * 18 + (c.treasury||0) * 0.25 + c.oil * 0.4 + c.food * 0.25) * tierBonus));
}

function resolveCombat(att, def) {
  const tierBonusAtt = att.tier === 'B' ? 1.15 : 1.0;
  const tierBonusDef = def.tier === 'B' ? 1.15 : 1.0;
  const randAtt = 1 + (Math.random() * 0.40 + (Math.random() > 0.5 ? 0 : 0.10));
  const randDef = 1 + (Math.random() * 0.40 + (Math.random() > 0.5 ? 0 : 0.10));
  const scoreAtt = (att.power * randAtt * tierBonusAtt) + (att.food * 0.07);
  const scoreDef = (def.power * randDef * tierBonusDef * 1.15) + (def.food * 0.07);
  return { attackerWins: scoreAtt > scoreDef, scoreAtt: Math.round(scoreAtt), scoreDef: Math.round(scoreDef) };
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

function applyEvent(ev) {
  gameState.prices = { oil:80, food:40 };
  gameState.eventMod = { armyCostMult:1, cheapAttack:false, peace:false, blackMarket:false };
  if (ev.priceChanges) {
    if (ev.priceChanges.oil)  gameState.prices.oil  = Math.round(80 * ev.priceChanges.oil);
    if (ev.priceChanges.food) gameState.prices.food = Math.round(40 * ev.priceChanges.food);
  }
  if (ev.special === 'globalBonus')     Object.values(gameState.countries).forEach(c => { if(!c.eliminated){ c.treasury += ev.bonus||80; c.power=calcPower(c); }});
  if (ev.special === 'oilBonus')        Object.values(gameState.countries).forEach(c => { if(!c.eliminated && c.oil>=(ev.threshold||300)){ c.treasury += ev.bonus||200; c.power=calcPower(c); }});
  if (ev.special === 'oilBonus2')       Object.values(gameState.countries).forEach(c => { if(!c.eliminated && c.oil>=(ev.threshold||200)){ c.treasury += ev.bonus||150; c.power=calcPower(c); }});
  if (ev.special === 'tradeWar')        Object.values(gameState.countries).forEach(c => { if(!c.eliminated && (c.tier==='S'||c.tier==='A')){ c.treasury=Math.max(0,c.treasury-150); c.power=calcPower(c); }});
  if (ev.special === 'crisis')          Object.values(gameState.countries).forEach(c => { if(!c.eliminated){ c.treasury=Math.round(c.treasury*(ev.ratio||0.8)); c.power=calcPower(c); }});
  if (ev.special === 'cheapArmy')       gameState.eventMod.armyCostMult = ev.armyCostMult||0.7;
  if (ev.special === 'armyExpensive')   gameState.eventMod.armyCostMult = 1.2;
  if (ev.special === 'peace')           gameState.eventMod.peace = true;
  if (ev.special === 'blackMarket')     gameState.eventMod.blackMarket = true;
  if (ev.special === 'mobilization')    Object.values(gameState.countries).forEach(c => { if(!c.eliminated){ c.army=Math.round(c.army*1.3); c.power=calcPower(c); }});
  if (ev.special === 'tierBArmy')       Object.values(gameState.countries).forEach(c => { if(!c.eliminated && c.tier==='B'){ c.army+=40; c.power=calcPower(c); addTeamNews(c.team,'Soulèvement: +40 armée gratuit !','good'); }});
  if (ev.special === 'underdog')        Object.values(gameState.countries).forEach(c => { if(!c.eliminated && c.power<(ev.threshold||350)){ c.treasury+=ev.bonus||220; c.power=calcPower(c); addTeamNews(c.team,`Révolution: +${ev.bonus||220} or !`,'good'); }});
  if (ev.special === 'aidFMI') {
    const alive = Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3);
    alive.forEach(c => { c.treasury+=160; c.army+=30; c.power=calcPower(c); addTeamNews(c.team,'Aide FMI: +160 or +30 armée !','good'); });
  }
  if (ev.special === 'sanctionsAndAid') {
    Object.values(gameState.countries).forEach(c => { if(!c.eliminated && c.tier==='B'){ c.treasury=Math.max(0,c.treasury-100); c.power=calcPower(c); }});
    const alive = Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3);
    alive.forEach(c => { c.treasury+=180; c.power=calcPower(c); addTeamNews(c.team,'Aide compensatoire: +180 or !','good'); });
  }
  if (ev.special === 'megaQuake') {
    const alive = Object.values(gameState.countries).filter(c=>!c.eliminated);
    alive.sort(()=>Math.random()-0.5).slice(0,2).forEach(c => { c.power=Math.max(0,c.power-300); addLog(`Séisme: ${c.flag} ${c.name} −300 pts`,'event'); });
  }
}

function applyPeriodTransition() {
  Object.values(gameState.countries).forEach(c => {
    if (c.eliminated) return;
    // Nourriture consommée selon population
    const foodNeeded = Math.max(1, Math.round(c.population / 60));
    if (c.food >= foodNeeded) {
      c.food -= foodNeeded;
    } else {
      const deficit = foodNeeded - c.food;
      c.food = 0;
      const powerLoss = Math.round(deficit * 8);
      c.power = Math.max(0, c.power - powerLoss);
      addTeamNews(c.team, `⚠️ Famine ! Manque de nourriture — −${powerLoss} pts de puissance`, 'bad');
    }
    // Revenus pétrole passif
    const oilIncome = Math.round(c.oil * 0.35);
    c.treasury += oilIncome;
    if (oilIncome > 0) addTeamNews(c.team, `💰 Revenus pétroliers: +${oilIncome} or`, 'good');
    // Revenu de base
    c.treasury += Math.round(Math.random() * 40 + 20);
    c.defense = false;
    c.power = calcPower(c);
  });
}

// Server-side timer
function startServerTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  gameState.timerSeconds = seconds;
  gameState.timerRunning = true;
  timerInterval = setInterval(() => {
    if (gameState.timerSeconds > 0) {
      gameState.timerSeconds--;
      io.emit('timer', { seconds: gameState.timerSeconds, running: true });
    } else {
      clearInterval(timerInterval); timerInterval = null;
      gameState.timerRunning = false;
      io.emit('timer', { seconds: 0, running: false, ended: true });
    }
  }, 1000);
}

function pauseServerTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  gameState.timerRunning = false;
  io.emit('timer', { seconds: gameState.timerSeconds, running: false });
}

function resetServerTimer(seconds) {
  pauseServerTimer();
  gameState.timerSeconds = seconds || 600;
  io.emit('timer', { seconds: gameState.timerSeconds, running: false });
}

io.on('connection', (socket) => {
  socket.emit('state', gameState);
  socket.emit('periods', PERIODS);
  socket.emit('timer', { seconds: gameState.timerSeconds, running: gameState.timerRunning });

  socket.on('mj:startDraft', () => {
    initCountries();
    gameState.phase = 'draft'; gameState.currentPeriod = 0;
    gameState.coalition = { proposed:false, moroccoAccepted:false, guineaAccepted:false, active:false };
    resetServerTimer(600);
    addLog('Draft démarré', 'event');
    broadcast();
  });

  socket.on('mj:startProsperity', () => {
    gameState.phase = 'prosperity'; gameState.currentPeriod = 1; gameState.currentEvent = null;
    const period = PERIODS[0];
    const ev = weightedRandomEvent();
    gameState.currentEvent = { ...ev, periodName:period.name, periodSubtitle:period.subtitle, periodDesc:period.desc, periodVideo:period.video, periodNumber:period.number };
    applyEvent(ev);
    resetServerTimer(600);
    addLog(`Période 1 — ${period.name}`, 'event');
    broadcast();
  });

  socket.on('mj:nextPeriod', () => {
    if (gameState.currentPeriod >= 6) return;
    applyPeriodTransition();
    gameState.currentPeriod++;
    const period = PERIODS[gameState.currentPeriod - 1];
    const ev = weightedRandomEvent();
    gameState.currentEvent = { ...ev, periodName:period.name, periodSubtitle:period.subtitle, periodDesc:period.desc, periodVideo:period.video, periodNumber:period.number };
    applyEvent(ev);
    resetServerTimer(600);
    addLog(`Période ${gameState.currentPeriod} — ${period.name}`, 'event');
    broadcast();
  });

  socket.on('mj:startWar', () => {
    gameState.phase = 'war'; gameState.currentEvent = null;
    gameState.coalition = { proposed:true, moroccoAccepted:false, guineaAccepted:false, active:false };
    resetServerTimer(600);
    addLog('⚔️ PHASE DE GUERRE DÉMARRÉE', 'attack');
    if (gameState.countries.morocco?.team) addTeamNews(gameState.countries.morocco.team, '🤝 Coalition proposée avec la Guinée ! Acceptez-vous ?', 'neutral');
    if (gameState.countries.guinea?.team)  addTeamNews(gameState.countries.guinea.team,  '🤝 Coalition proposée avec le Maroc ! Acceptez-vous ?', 'neutral');
    broadcast();
  });

  socket.on('mj:timerStart', ({ seconds }) => startServerTimer(seconds || gameState.timerSeconds));
  socket.on('mj:timerPause', () => pauseServerTimer());
  socket.on('mj:timerReset', ({ seconds }) => resetServerTimer(seconds));

  socket.on('team:acceptCoalition', ({ teamName }) => {
    const c = Object.values(gameState.countries).find(c => c.team === teamName);
    if (!c) return;
    if (c.id === 'morocco') gameState.coalition.moroccoAccepted = true;
    if (c.id === 'guinea')  gameState.coalition.guineaAccepted  = true;
    if (gameState.coalition.moroccoAccepted && gameState.coalition.guineaAccepted) {
      gameState.coalition.active = true;
      const morocco = gameState.countries.morocco;
      const guinea  = gameState.countries.guinea;
      morocco.treasury += guinea.treasury; morocco.oil += guinea.oil;
      morocco.food += guinea.food; morocco.army += guinea.army;
      morocco.power = calcPower(morocco);
      guinea.treasury = 0; guinea.oil = 0; guinea.food = 0; guinea.army = 0; guinea.power = morocco.power;
      addLog('🤝 Coalition Maroc-Guinée activée !', 'event');
      addTeamNews(morocco.team, '✅ Coalition active ! Ressources fusionnées.', 'good');
      addTeamNews(guinea.team,  '✅ Coalition active ! Ressources gérées par le Maroc.', 'good');
    } else {
      addTeamNews(teamName, '✅ Vous avez accepté — en attente de l\'autre équipe...', 'neutral');
    }
    broadcast();
  });

  socket.on('team:refuseCoalition', ({ teamName }) => {
    gameState.coalition.proposed = false;
    addTeamNews(gameState.countries.morocco?.team, '❌ Coalition refusée.', 'bad');
    addTeamNews(gameState.countries.guinea?.team,  '❌ Coalition refusée.', 'bad');
    broadcast();
  });

  socket.on('team:declareAttack', ({ teamName, targetId }) => {
    if (gameState.phase !== 'war') { socket.emit('error', "La guerre n'a pas commencé !"); return; }
    if (gameState.eventMod.peace)  { socket.emit('error', 'Paix mondiale — attaques suspendues !'); return; }
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const att = gameState.countries[team.country];
    const def = gameState.countries[targetId];
    if (!att || !def || att.eliminated || def.eliminated) return;
    const cost = 150;
    if (att.treasury < cost) { socket.emit('error', "Pas assez d'or ! (150 or requis)"); return; }
    att.treasury -= cost; att.power = calcPower(att);

    // Auto-resolve combat
    const result = resolveCombat(att, def);
    const armyLossAtt = Math.round(att.army * (result.attackerWins ? 0.12 : 0.28));
    const armyLossDef = Math.round(def.army * (result.attackerWins ? 0.35 : 0.10));

    if (result.attackerWins) {
      // Attaquant gagne — prend TOUTES les ressources du défenseur
      att.treasury += def.treasury; att.oil += def.oil; att.food += def.food; att.army += def.army;
      att.army -= armyLossAtt;
      def.treasury = 0; def.oil = 0; def.food = 0; def.army = 0;
      att.power = calcPower(att); def.power = calcPower(def);
      const msg = `⚔️ ${att.flag} ${att.name} écrase ${def.flag} ${def.name} ! (${result.scoreAtt} vs ${result.scoreDef}) — toutes les ressources pillées !`;
      addLog(msg, 'attack');
      addTeamNews(att.team, `🏆 VICTOIRE contre ${def.flag} ${def.name} ! Vous avez pillé toutes leurs ressources. Pertes armée: −${armyLossAtt}`, 'good');
      addTeamNews(def.team, `💀 DÉFAITE contre ${att.flag} ${att.name} — toutes vos ressources ont été pillées. Pertes armée: −${armyLossDef}`, 'bad');
      // Broadcast attack animation
      io.emit('attackAnimation', { attackerId:att.id, defenderId:def.id, success:true, scoreAtt:result.scoreAtt, scoreDef:result.scoreDef });
      // Auto-eliminate if no army left
      if (def.army <= 0 && def.treasury <= 0) {
        def.eliminated = true;
        addLog(`☠️ ${def.flag} ${def.name} est anéanti et éliminé !`, 'eliminated');
        addTeamNews(def.team, '☠️ Votre nation est anéantie. Vous êtes éliminé(e).', 'bad');
        if (gameState.coalition.active && (def.id === 'morocco' || def.id === 'guinea')) {
          gameState.countries.morocco.eliminated = true;
          gameState.countries.guinea.eliminated  = true;
        }
      }
    } else {
      // Défenseur gagne — attaquant perd 35% ressources
      const goldLoss = Math.round(att.treasury * 0.35);
      const oilLoss  = Math.round(att.oil * 0.20);
      att.treasury = Math.max(0, att.treasury - goldLoss);
      att.oil      = Math.max(0, att.oil - oilLoss);
      att.army     = Math.max(0, att.army - armyLossAtt);
      def.army     = Math.max(0, def.army - armyLossDef);
      att.power = calcPower(att); def.power = calcPower(def);
      const msg = `🛡️ ${def.flag} ${def.name} repousse ${att.flag} ${att.name} ! (${result.scoreAtt} vs ${result.scoreDef})`;
      addLog(msg, 'attack');
      addTeamNews(att.team, `❌ ÉCHEC de l'attaque contre ${def.flag} ${def.name} — pertes: −${goldLoss} or, −${armyLossAtt} armée`, 'bad');
      addTeamNews(def.team, `🛡️ Vous avez repoussé ${att.flag} ${att.name} ! Pertes défensives: −${armyLossDef} armée`, 'good');
      io.emit('attackAnimation', { attackerId:att.id, defenderId:def.id, success:false, scoreAtt:result.scoreAtt, scoreDef:result.scoreDef });
    }
    broadcast();
  });

  socket.on('mj:eliminate', ({ countryId }) => {
    const c = gameState.countries[countryId];
    if (!c) return;
    c.eliminated = true;
    if (gameState.coalition.active && (countryId === 'morocco' || countryId === 'guinea')) {
      gameState.countries.morocco.eliminated = true;
      gameState.countries.guinea.eliminated  = true;
    }
    addLog(`☠️ ${c.flag} ${c.name} est éliminé !`, 'eliminated');
    addTeamNews(c.team, 'Votre nation a été conquise.', 'bad');
    broadcast();
  });

  socket.on('mj:bonus', ({ countryId, amount }) => {
    const c = gameState.countries[countryId];
    if (!c) return;
    c.treasury += amount; c.power = calcPower(c);
    addLog(`${amount>0?'+':''}${amount} or → ${c.flag} ${c.name}`, amount>0?'economy':'attack');
    broadcast();
  });

  socket.on('mj:reset', () => {
    if (timerInterval) clearInterval(timerInterval); timerInterval = null;
    gameState = { phase:'setup', currentPeriod:0, currentEvent:null, countries:{}, takenCountries:{}, teams:{}, prices:{oil:80,food:40}, eventMod:{armyCostMult:1,cheapAttack:false,peace:false,blackMarket:false}, coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false}, log:[], warVideo:WAR_VIDEO, timerSeconds:600, timerRunning:false };
    broadcast();
    io.emit('timer', { seconds:600, running:false });
  });

  socket.on('team:join', ({ teamName }) => {
    if (!gameState.teams[teamName]) gameState.teams[teamName] = { country:null, news:[] };
    broadcast();
  });

  socket.on('team:draftCountry', ({ teamName, countryId }) => {
    if (gameState.takenCountries[countryId]) { socket.emit('error', 'Ce pays est déjà pris !'); return; }
    gameState.takenCountries[countryId] = teamName;
    gameState.teams[teamName].country = countryId;
    gameState.countries[countryId].team = teamName;
    addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} choisi par ${teamName}`, 'event');
    broadcast();
  });

  socket.on('team:buyResource', ({ teamName, resource, qty }) => {
    const team = gameState.teams[teamName]; if (!team||!team.country) return;
    const c = gameState.countries[team.country];
    const price = gameState.prices[resource] || 80;
    const total = price * qty;
    if (c.treasury < total) { socket.emit('error', "Pas assez d'or !"); return; }
    c.treasury -= total; c[resource] += qty; c.power = calcPower(c);
    addTeamNews(teamName, `Achat: +${qty} ${resource} pour ${total} or`, 'good');
    broadcast();
  });

  socket.on('team:sellResource', ({ teamName, resource, qty }) => {
    const team = gameState.teams[teamName]; if (!team||!team.country) return;
    const c = gameState.countries[team.country];
    if (c[resource] < qty) { socket.emit('error', 'Stock insuffisant !'); return; }
    const price = gameState.prices[resource] || 80;
    const mult = (gameState.eventMod.blackMarket && c.power < 400) ? 2 : 1;
    const total = price * qty * mult;
    c[resource] -= qty; c.treasury += total; c.power = calcPower(c);
    addTeamNews(teamName, `Vente: −${qty} ${resource} pour +${total} or${mult===2?' (×2 marché noir !)':''}`, 'good');
    broadcast();
  });

  socket.on('team:recruitArmy', ({ teamName, qty, type }) => {
    const team = gameState.teams[teamName]; if (!team||!team.country) return;
    const c = gameState.countries[team.country];
    const mult = gameState.eventMod.armyCostMult || 1;
    const costPer  = type === 'tech' ? 300 : 150;
    const powerPer = type === 'tech' ? 50  : 20;
    const armyPer  = type === 'tech' ? 0   : qty;
    const cost = Math.round(costPer * qty * mult);
    if (c.treasury < cost) { socket.emit('error', "Pas assez d'or !"); return; }
    c.treasury -= cost; c.army += armyPer; c.power += qty * powerPer;
    addTeamNews(teamName, `Recrutement: +${qty*powerPer} puissance pour ${cost} or`, 'good');
    broadcast();
  });

  socket.on('team:buyDefense', ({ teamName }) => {
    const team = gameState.teams[teamName]; if (!team||!team.country) return;
    const c = gameState.countries[team.country];
    if (c.treasury < 200) { socket.emit('error', "Pas assez d'or !"); return; }
    c.treasury -= 200; c.defense = true;
    addTeamNews(teamName, 'Bunker activé — dommages reçus réduits', 'neutral');
    broadcast();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Geopolitica running on port ${PORT}`));
