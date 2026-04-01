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
  { id:'usa',     flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:800, oil:300, food:400, army:500, population:330 },
  { id:'china',   flag:'🇨🇳', name:'Chine',        tier:'S', gold:750, oil:350, food:500, army:450, population:1400 },
  { id:'russia',  flag:'🇷🇺', name:'Russie',       tier:'A', gold:500, oil:500, food:200, army:400, population:145 },
  { id:'germany', flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:600, oil:150, food:300, army:300, population:83 },
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:680, oil:550, food:80,  army:200, population:3 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:550, oil:100, food:350, army:280, population:68 },
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:400, oil:200, food:600, army:150, population:215 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:400, oil:150, food:450, army:200, population:1400 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:320, oil:80,  food:380, army:160, population:37 },
  { id:'guinea',  flag:'🇬🇳', name:'Guinée',       tier:'B', gold:200, oil:60,  food:300, army:90,  population:13 },
];

// 6 périodes scénarisées, chaque période a 2-3 événements possibles tirés aléatoirement
const PERIODS = [
  {
    number: 1,
    name: "L'Ère de Croissance",
    subtitle: "Janvier — Juin · Année 1",
    description: "Les marchés mondiaux s'ouvrent. C'est le moment d'investir et de poser les bases de votre empire.",
    video: "https://www.youtube.com/embed/sNBjA0d1NV0?autoplay=1&mute=1",
    events: [
      { title:'Boom économique mondial', desc:'La croissance explose dans toutes les régions.', effect:'Tous les pays +100 or', special:'globalBonus', bonus:100 },
      { title:'Ouverture des marchés', desc:'Les accords commerciaux facilitent les échanges.', effect:'Prix ressources −25%', priceChanges:{ oil:0.75, food:0.75 } },
      { title:'Découverte de gisements', desc:'De nouveaux gisements de pétrole sont découverts.', effect:'Pays riches en pétrole +200 or', special:'oilBonus' },
    ]
  },
  {
    number: 2,
    name: "Premières Tensions",
    subtitle: "Juillet — Décembre · Année 1",
    description: "Les intérêts divergent. Les premières frictions commerciales apparaissent sur la scène internationale.",
    video: "https://www.youtube.com/embed/8n-h93i3CM0?autoplay=1&mute=1",
    events: [
      { title:'Guerre commerciale', desc:'Les grandes puissances s\'affrontent sur les tarifs douaniers.', effect:'Pays Tier S et A: −150 or', special:'tradeWar' },
      { title:'Tensions aux frontières', desc:'Des incidents militaires éclatent dans plusieurs régions.', effect:'Coût armée +20%', special:'armyExpensive' },
      { title:'Pénurie alimentaire régionale', desc:'Plusieurs régions connaissent des troubles agricoles.', effect:'Prix nourriture ×2', priceChanges:{ food:2.0 } },
    ]
  },
  {
    number: 3,
    name: "Crise Mondiale",
    subtitle: "Janvier — Juin · Année 2",
    description: "Une catastrophe majeure frappe la planète. Personne n'est épargné. Les nations doivent s'adapter ou périr.",
    video: "https://www.youtube.com/embed/Qzz4DpCjjio?autoplay=1&mute=1",
    events: [
      { title:'Crise pétrolière mondiale', desc:'Les réserves mondiales s\'effondrent brutalement.', effect:'Prix pétrole ×3 — sans pétrole: −100 puissance', special:'oilCrisis', priceChanges:{ oil:3.0 } },
      { title:'Pandémie économique', desc:'Une crise financière mondiale paralyse les marchés.', effect:'Tous −20% trésor', special:'crisis', ratio:0.80 },
      { title:'Catastrophe naturelle mondiale', desc:'Séismes et tsunamis ravagent plusieurs continents.', effect:'2 pays aléatoires perdent 300 pts de puissance', special:'megaQuake' },
    ]
  },
  {
    number: 4,
    name: "Course aux Armements",
    subtitle: "Juillet — Décembre · Année 2",
    description: "La guerre se profile. Les nations investissent massivement dans leur défense. Le monde retient son souffle.",
    video: "https://www.youtube.com/embed/JcFgm4OCKWY?autoplay=1&mute=1",
    events: [
      { title:'Boom militaire', desc:'Les industries d\'armement tournent à plein régime.', effect:'Armée −30% coût cette période', special:'cheapArmy', armyCostMult:0.7 },
      { title:'Marché noir des armes', desc:'Des circuits illégaux approvisionnent les nations fragiles.', effect:'Pays Tier B: armée gratuite +50 puissance', special:'blackMarketArmy' },
      { title:'Alliance défensive', desc:'Certaines nations forment des pactes de non-agression.', effect:'Attaques suspendues — renforcez vos défenses', special:'peace' },
    ]
  },
  {
    number: 5,
    name: "Ultimatums",
    subtitle: "Janvier — Juin · Année 3",
    description: "Les diplomates ont échoué. Les sanctions tombent. Chaque nation choisit son camp. La guerre est inévitable.",
    video: "https://www.youtube.com/embed/eeqxFAFv5RQ?autoplay=1&mute=1",
    events: [
      { title:'Sanctions internationales', desc:'Le G7 impose des sanctions massives.', effect:'Pays Tier B: −150 or · Aide FMI aux 3 plus faibles: +200 or', special:'sanctionsAndAid' },
      { title:'Révolution des ressources', desc:'Les nations émergentes se soulèvent contre l\'ordre mondial.', effect:'Pays < 400 pts: +200 or', special:'underdog', threshold:400, bonus:200 },
      { title:'Dernier accord commercial', desc:'Une fenêtre diplomatique s\'ouvre brièvement.', effect:'Toutes ressources −30% prix', priceChanges:{ oil:0.7, food:0.7 } },
    ]
  },
  {
    number: 6,
    name: "Le Monde Retient son Souffle",
    subtitle: "Juillet — Décembre · Année 3",
    description: "La dernière période de paix. Chaque décision compte. Dans quelques mois, les canons parleront.",
    video: "https://www.youtube.com/embed/inWWhr5tnEA?autoplay=1&mute=1",
    events: [
      { title:'Mobilisation générale', desc:'Les nations rappellent leurs réservistes.', effect:'Tous: armée ×1.5 — coût or divisé par 2', special:'mobilization' },
      { title:'Crise alimentaire finale', desc:'Les stocks mondiaux de nourriture atteignent un niveau critique.', effect:'Tous perdent 30% nourriture automatiquement', special:'foodCrisis' },
      { title:'Ruée vers l\'or', desc:'Les investisseurs fuient vers les valeurs refuges.', effect:'Pays avec >500 or: +150 or supplémentaire', special:'goldRush' },
    ]
  },
];

const WAR_VIDEO = "https://www.youtube.com/embed/xdBRgQrWvQE?autoplay=1&mute=1";

// Coalition Maroc + Guinée
let coalitionState = { proposed: false, moroccoAccepted: false, guineaAccepted: false, active: false };

let gameState = {
  phase: 'setup',
  currentPeriod: 0,
  currentEvent: null,
  countries: {},
  takenCountries: {},
  teams: {},
  prices: { oil: 80, food: 40 },
  eventMod: { armyCostMult: 1, cheapAttack: false, peace: false, blackMarket: false },
  coalition: { proposed: false, moroccoAccepted: false, guineaAccepted: false, active: false },
  log: [],
  warVideo: WAR_VIDEO,
};

function initCountries() {
  gameState.countries = {};
  COUNTRIES.forEach(c => {
    gameState.countries[c.id] = {
      ...c,
      treasury: c.gold,
      power: calcPower({ ...c, treasury: c.gold }),
      eliminated: false,
      defense: false,
      team: null,
    };
  });
}

function calcPower(c) {
  return Math.max(0, Math.round(c.army * 20 + (c.treasury || 0) * 0.3 + c.oil * 0.5 + c.food * 0.2));
}

function addLog(text, type) {
  gameState.log.unshift({ text, type, time: new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) });
  if (gameState.log.length > 80) gameState.log = gameState.log.slice(0, 80);
}

function addTeamNews(teamName, text, type) {
  if (!gameState.teams[teamName]) return;
  gameState.teams[teamName].news = gameState.teams[teamName].news || [];
  gameState.teams[teamName].news.push({ text, type, time: new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) });
}

function broadcastState() {
  io.emit('state', gameState);
}

function applyEvent(ev) {
  gameState.prices = { oil: 80, food: 40 };
  gameState.eventMod = { armyCostMult: 1, cheapAttack: false, peace: false, blackMarket: false };

  if (ev.priceChanges) {
    if (ev.priceChanges.oil)  gameState.prices.oil  = Math.round(80 * ev.priceChanges.oil);
    if (ev.priceChanges.food) gameState.prices.food = Math.round(40 * ev.priceChanges.food);
  }
  if (ev.special === 'globalBonus') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated) { c.treasury += ev.bonus || 100; c.power = calcPower(c); }});
  }
  if (ev.special === 'oilBonus') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated && c.oil >= 300) { c.treasury += 200; c.power = calcPower(c); }});
  }
  if (ev.special === 'tradeWar') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated && (c.tier === 'S' || c.tier === 'A')) { c.treasury = Math.max(0, c.treasury - 150); c.power = calcPower(c); }});
  }
  if (ev.special === 'armyExpensive') { gameState.eventMod.armyCostMult = 1.2; }
  if (ev.special === 'cheapArmy') { gameState.eventMod.armyCostMult = ev.armyCostMult || 0.7; }
  if (ev.special === 'peace') { gameState.eventMod.peace = true; }
  if (ev.special === 'oilCrisis') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated && c.oil < 100) { c.power = Math.max(0, c.power - 100); }});
  }
  if (ev.special === 'crisis') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated) { c.treasury = Math.round(c.treasury * (ev.ratio || 0.8)); c.power = calcPower(c); }});
  }
  if (ev.special === 'megaQuake') {
    const alive = Object.values(gameState.countries).filter(c => !c.eliminated);
    const shuffled = alive.sort(() => Math.random() - 0.5).slice(0, 2);
    shuffled.forEach(c => { c.power = Math.max(0, c.power - 300); addLog(`Séisme: ${c.flag} ${c.name} −300 pts`, 'event'); });
  }
  if (ev.special === 'blackMarketArmy') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated && c.tier === 'B') { c.power += 50; addTeamNews(c.team, 'Marché noir: +50 puissance gratuite !', 'good'); }});
  }
  if (ev.special === 'sanctionsAndAid') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated && c.tier === 'B') { c.treasury = Math.max(0, c.treasury - 150); c.power = calcPower(c); }});
    const alive = Object.values(gameState.countries).filter(c => !c.eliminated).sort((a,b) => a.power - b.power).slice(0, 3);
    alive.forEach(c => { c.treasury += 200; c.power = calcPower(c); addTeamNews(c.team, 'Aide FMI: +200 or reçus !', 'good'); });
  }
  if (ev.special === 'underdog') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated && c.power < (ev.threshold || 400)) { c.treasury += ev.bonus || 200; c.power = calcPower(c); addTeamNews(c.team, `Révolution: +${ev.bonus || 200} or !`, 'good'); }});
  }
  if (ev.special === 'mobilization') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated) { c.army = Math.round(c.army * 1.5); c.power = calcPower(c); }});
    gameState.eventMod.armyCostMult = 0.5;
  }
  if (ev.special === 'foodCrisis') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated) { c.food = Math.round(c.food * 0.7); c.power = calcPower(c); }});
  }
  if (ev.special === 'goldRush') {
    Object.values(gameState.countries).forEach(c => { if (!c.eliminated && c.treasury > 500) { c.treasury += 150; c.power = calcPower(c); }});
  }
}

function applyPeriodTransition() {
  // Consommation nourriture par habitant
  Object.values(gameState.countries).forEach(c => {
    if (c.eliminated) return;
    const foodNeeded = Math.round(c.population / 50);
    if (c.food >= foodNeeded) {
      c.food -= foodNeeded;
    } else {
      const deficit = foodNeeded - c.food;
      c.food = 0;
      const powerLoss = deficit * 10;
      c.power = Math.max(0, c.power - powerLoss);
      addTeamNews(c.team, `Famine ! Manque de nourriture — −${powerLoss} puissance militaire`, 'bad');
    }
    // Revenus pétrole
    const oilIncome = Math.round(c.oil * 0.3);
    c.treasury += oilIncome;
    // Revenu de base
    c.treasury += Math.round(Math.random() * 40 + 20);
    c.power = calcPower(c);
  });
}

io.on('connection', (socket) => {
  socket.emit('state', gameState);
  socket.emit('periods', PERIODS);

  socket.on('mj:startDraft', () => {
    initCountries();
    gameState.phase = 'draft';
    gameState.currentPeriod = 0;
    gameState.coalition = { proposed: false, moroccoAccepted: false, guineaAccepted: false, active: false };
    addLog('Draft démarré', 'event');
    broadcastState();
  });

  socket.on('mj:startProsperity', () => {
    gameState.phase = 'prosperity';
    gameState.currentPeriod = 1;
    gameState.currentEvent = null;
    // Afficher la période 1
    const period = PERIODS[0];
    const ev = period.events[Math.floor(Math.random() * period.events.length)];
    gameState.currentEvent = { ...ev, periodName: period.name, periodSubtitle: period.subtitle, periodDesc: period.description, periodVideo: period.video, periodNumber: period.number };
    applyEvent(ev);
    addLog(`Période 1 — ${period.name}`, 'event');
    broadcastState();
  });

  socket.on('mj:nextPeriod', () => {
    if (gameState.currentPeriod >= 6) return;
    applyPeriodTransition();
    gameState.currentPeriod++;
    gameState.eventMod = { armyCostMult: 1, cheapAttack: false, peace: false, blackMarket: false };
    const period = PERIODS[gameState.currentPeriod - 1];
    const ev = period.events[Math.floor(Math.random() * period.events.length)];
    gameState.currentEvent = { ...ev, periodName: period.name, periodSubtitle: period.subtitle, periodDesc: period.description, periodVideo: period.video, periodNumber: period.number };
    applyEvent(ev);
    addLog(`Période ${gameState.currentPeriod} — ${period.name}`, 'event');
    broadcastState();
  });

  socket.on('mj:startWar', () => {
    gameState.phase = 'war';
    gameState.currentEvent = null;
    // Proposer la coalition Maroc + Guinée
    gameState.coalition = { proposed: true, moroccoAccepted: false, guineaAccepted: false, active: false };
    addLog('⚔️ PHASE DE GUERRE DÉMARRÉE', 'attack');
    addTeamNews(gameState.countries.morocco?.team, '🤝 Coalition proposée avec la Guinée ! Acceptez-vous ?', 'neutral');
    addTeamNews(gameState.countries.guinea?.team, '🤝 Coalition proposée avec le Maroc ! Acceptez-vous ?', 'neutral');
    broadcastState();
  });

  socket.on('team:acceptCoalition', ({ teamName }) => {
    const c = Object.values(gameState.countries).find(c => c.team === teamName);
    if (!c) return;
    if (c.id === 'morocco') gameState.coalition.moroccoAccepted = true;
    if (c.id === 'guinea')  gameState.coalition.guineaAccepted  = true;
    if (gameState.coalition.moroccoAccepted && gameState.coalition.guineaAccepted) {
      gameState.coalition.active = true;
      // Fusionner ressources
      const morocco = gameState.countries.morocco;
      const guinea  = gameState.countries.guinea;
      morocco.treasury += guinea.treasury; morocco.oil += guinea.oil;
      morocco.food += guinea.food; morocco.army += guinea.army;
      morocco.power = calcPower(morocco);
      guinea.treasury = 0; guinea.oil = 0; guinea.food = 0; guinea.army = 0;
      guinea.power = morocco.power;
      addLog('🤝 Coalition Maroc-Guinée activée ! Ressources fusionnées.', 'event');
      addTeamNews(morocco.team, '✅ Coalition active ! Ressources de la Guinée fusionnées avec les vôtres.', 'good');
      addTeamNews(guinea.team,  '✅ Coalition active ! Vos ressources sont gérées par le Maroc.', 'good');
    } else {
      addTeamNews(teamName, '✅ Vous avez accepté la coalition. En attente de l\'autre équipe...', 'neutral');
    }
    broadcastState();
  });

  socket.on('team:refuseCoalition', ({ teamName }) => {
    gameState.coalition.proposed = false;
    addLog(`Coalition refusée par ${teamName}`, 'event');
    addTeamNews(gameState.countries.morocco?.team, '❌ Coalition refusée. Vous combattez seul.', 'bad');
    addTeamNews(gameState.countries.guinea?.team,  '❌ Coalition refusée. Vous combattez seul.', 'bad');
    broadcastState();
  });

  socket.on('mj:resolveAttack', ({ attackerId, defenderId, success }) => {
    const att = gameState.countries[attackerId];
    const def = gameState.countries[defenderId];
    if (!att || !def) return;
    if (success) {
      const goldGain = Math.round(def.treasury * 0.4);
      const oilGain  = Math.round(def.oil * 0.4);
      const foodGain = Math.round(def.food * 0.4);
      att.treasury += goldGain; att.oil += oilGain; att.food += foodGain;
      def.treasury = Math.max(0, def.treasury - goldGain);
      def.oil      = Math.max(0, def.oil - oilGain);
      def.food     = Math.max(0, def.food - foodGain);
      att.power = calcPower(att); def.power = calcPower(def);
      // Si coalition active, sync guinea power
      if (gameState.coalition.active) {
        if (att.id === 'morocco' || att.id === 'guinea') gameState.countries.guinea.power = att.power;
        if (def.id === 'morocco' || def.id === 'guinea') gameState.countries.guinea.power = def.power;
      }
      addLog(`${att.flag} ${att.name} GAGNE vs ${def.flag} ${def.name}`, 'attack');
      addTeamNews(att.team, `Victoire ! +${goldGain} or, +${oilGain} pétrole sur ${def.flag} ${def.name}`, 'good');
      addTeamNews(def.team, `Défaite contre ${att.flag} ${att.name} — −${goldGain} or`, 'bad');
    } else {
      const loss = Math.round(att.treasury * 0.3);
      att.treasury = Math.max(0, att.treasury - loss);
      att.power = calcPower(att);
      addLog(`${att.flag} ${att.name} ÉCHOUE vs ${def.flag} ${def.name}`, 'attack');
      addTeamNews(att.team, `Attaque échouée contre ${def.flag} ${def.name} — −${loss} or`, 'bad');
      addTeamNews(def.team, `Vous avez repoussé ${att.flag} ${att.name} !`, 'good');
    }
    broadcastState();
  });

  socket.on('mj:eliminate', ({ countryId }) => {
    const c = gameState.countries[countryId];
    if (!c) return;
    c.eliminated = true;
    if (gameState.coalition.active && (countryId === 'morocco' || countryId === 'guinea')) {
      gameState.countries.morocco.eliminated = true;
      gameState.countries.guinea.eliminated  = true;
      addTeamNews(gameState.countries.morocco.team, 'La coalition a été vaincue.', 'bad');
      addTeamNews(gameState.countries.guinea.team,  'La coalition a été vaincue.', 'bad');
    }
    addLog(`${c.flag} ${c.name} est éliminé !`, 'eliminated');
    addTeamNews(c.team, 'Votre nation a été conquise. Vous êtes éliminé(e).', 'bad');
    broadcastState();
  });

  socket.on('mj:bonus', ({ countryId, amount }) => {
    const c = gameState.countries[countryId];
    if (!c) return;
    c.treasury += amount; c.power = calcPower(c);
    addLog(`${amount > 0 ? '+' : ''}${amount} or → ${c.flag} ${c.name}`, amount > 0 ? 'economy' : 'attack');
    broadcastState();
  });

  socket.on('mj:reset', () => {
    gameState = { phase:'setup', currentPeriod:0, currentEvent:null, countries:{}, takenCountries:{}, teams:{}, prices:{ oil:80, food:40 }, eventMod:{ armyCostMult:1, cheapAttack:false, peace:false, blackMarket:false }, coalition:{ proposed:false, moroccoAccepted:false, guineaAccepted:false, active:false }, log:[], warVideo:WAR_VIDEO };
    broadcastState();
  });

  socket.on('team:join', ({ teamName }) => {
    if (!gameState.teams[teamName]) gameState.teams[teamName] = { country:null, news:[] };
    broadcastState();
  });

  socket.on('team:draftCountry', ({ teamName, countryId }) => {
    if (gameState.takenCountries[countryId]) { socket.emit('error', 'Ce pays est déjà pris !'); return; }
    gameState.takenCountries[countryId] = teamName;
    gameState.teams[teamName].country = countryId;
    gameState.countries[countryId].team = teamName;
    addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} choisi par ${teamName}`, 'event');
    broadcastState();
  });

  socket.on('team:buyResource', ({ teamName, resource, qty }) => {
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const c = gameState.countries[team.country];
    const price = gameState.prices[resource] || 80;
    const total = price * qty;
    if (c.treasury < total) { socket.emit('error', "Pas assez d'or !"); return; }
    c.treasury -= total; c[resource] += qty; c.power = calcPower(c);
    if (gameState.coalition.active && team.country === 'guinea') {
      gameState.countries.morocco.treasury = c.treasury;
      gameState.countries.morocco[resource] = c[resource];
      gameState.countries.morocco.power = c.power;
    }
    addTeamNews(teamName, `Achat: +${qty} ${resource} pour ${total} or`, 'good');
    broadcastState();
  });

  socket.on('team:sellResource', ({ teamName, resource, qty }) => {
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const c = gameState.countries[team.country];
    if (c[resource] < qty) { socket.emit('error', 'Stock insuffisant !'); return; }
    const price = gameState.prices[resource] || 80;
    const total = price * qty;
    c[resource] -= qty; c.treasury += total; c.power = calcPower(c);
    addTeamNews(teamName, `Vente: −${qty} ${resource} pour +${total} or`, 'good');
    broadcastState();
  });

  socket.on('team:recruitArmy', ({ teamName, qty, type }) => {
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const c = gameState.countries[team.country];
    const mult = gameState.eventMod.armyCostMult || 1;
    const costPer  = type === 'tech' ? 300 : 150;
    const powerPer = type === 'tech' ? 50  : 20;
    const cost = Math.round(costPer * qty * mult);
    if (c.treasury < cost) { socket.emit('error', "Pas assez d'or !"); return; }
    c.treasury -= cost;
    if (type !== 'tech') c.army += qty;
    c.power += qty * powerPer;
    addTeamNews(teamName, `Recrutement: +${qty * powerPer} puissance pour ${cost} or`, 'good');
    broadcastState();
  });

  socket.on('team:buyDefense', ({ teamName }) => {
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const c = gameState.countries[team.country];
    if (c.treasury < 200) { socket.emit('error', "Pas assez d'or !"); return; }
    c.treasury -= 200; c.defense = true;
    addTeamNews(teamName, 'Bunker activé — dommages réduits de 30%', 'neutral');
    broadcastState();
  });

  socket.on('team:declareAttack', ({ teamName, targetId }) => {
    if (gameState.phase !== 'war') { socket.emit('error', "La guerre n'a pas encore commencé !"); return; }
    if (gameState.eventMod.peace) { socket.emit('error', 'Paix mondiale — attaques suspendues !'); return; }
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const c = gameState.countries[team.country];
    const cost = Math.round(200 * (gameState.eventMod.cheapAttack ? 0.5 : 1));
    if (c.treasury < cost) { socket.emit('error', "Pas assez d'or !"); return; }
    c.treasury -= cost; c.power = calcPower(c);
    const target = gameState.countries[targetId];
    addLog(`${c.flag} ${c.name} attaque ${target.flag} ${target.name}`, 'attack');
    addTeamNews(teamName, `Attaque déclarée sur ${target.flag} ${target.name} — en attente du MJ`, 'bad');
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Geopolitica running on port ${PORT}`));
