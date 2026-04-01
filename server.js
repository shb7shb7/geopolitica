const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const COUNTRIES = [
  { id:'usa',     flag:'🇺🇸', name:'États-Unis',  tier:'S', gold:800, oil:300, food:400, army:500 },
  { id:'china',   flag:'🇨🇳', name:'Chine',        tier:'S', gold:750, oil:350, food:500, army:450 },
  { id:'russia',  flag:'🇷🇺', name:'Russie',       tier:'A', gold:500, oil:500, food:200, army:400 },
  { id:'germany', flag:'🇩🇪', name:'Allemagne',    tier:'A', gold:600, oil:150, food:300, army:300 },
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:680, oil:550, food:80,  army:200 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:550, oil:100, food:350, army:280 },
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:400, oil:200, food:600, army:150 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:400, oil:150, food:450, army:200 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:320, oil:80,  food:380, army:160 },
  { id:'guinea',  flag:'🇬🇳', name:'Guinée',       tier:'B', gold:200, oil:60,  food:300, army:90  },
];

const EVENTS = [
  { title:'Crise pétrolière', desc:'Les réserves mondiales chutent.', effect:'Prix pétrole ×2', priceChanges:{ oil:2.0 } },
  { title:'Boom technologique', desc:"L'innovation explose.", effect:'Armée −20% coût', special:'cheapArmy' },
  { title:'Sécheresse mondiale', desc:"Les récoltes s'effondrent.", effect:'Prix nourriture ×2.5', priceChanges:{ food:2.5 } },
  { title:'Sanctions économiques', desc:'Le G7 frappe fort.', effect:'Pays Tier B: −100 or', special:'sanctionB' },
  { title:'Traité de libre-échange', desc:'Accord mondial signé.', effect:'Ressources −20% prix', priceChanges:{ oil:0.8, food:0.8 } },
  { title:'Catastrophe naturelle', desc:'Séisme majeur.', effect:'Un pays perd 200 pts', special:'quake' },
  { title:'Boom pétrolier', desc:'Nouveaux gisements découverts.', effect:'Pays riches en pétrole +200 or', special:'oilBonus' },
  { title:'Tensions militaires', desc:'Conflits aux frontières.', effect:'Attaques −50% coût', special:'cheapAttack' },
  { title:'Crise financière', desc:'Marchés en chute libre.', effect:'Tous −15% trésor', special:'crisis' },
  { title:'Paix mondiale', desc:"L'ONU intervient.", effect:'Attaques suspendues cette manche', special:'peace' },
  { title:'Révolution des ressources', desc:'Les nations émergentes se soulèvent.', effect:'Pays < 300 pts: +150 or', special:'underdog' },
  { title:'Aide internationale', desc:'Le FMI soutient les économies fragiles.', effect:'3 pays les plus faibles: +100 or +50 armée', special:'aidFMI' },
  { title:'Marché noir mondial', desc:'Les circuits informels explosent.', effect:'Pays < 400 pts: prix de vente ×2 cette manche', special:'blackMarket' },
];

let gameState = {
  phase: 'setup',
  round: 0,
  countries: {},
  takenCountries: {},
  teams: {},
  prices: { oil: 80, food: 40 },
  eventMod: { armyCostMult: 1, cheapAttack: false, peace: false, blackMarket: false },
  currentEvent: null,
  log: [],
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
  if (gameState.log.length > 50) gameState.log = gameState.log.slice(0, 50);
}

function addTeamNews(teamName, text, type) {
  if (!gameState.teams[teamName]) return;
  gameState.teams[teamName].news = gameState.teams[teamName].news || [];
  gameState.teams[teamName].news.push({ text, type, time: new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) });
}

function broadcastState() {
  io.emit('state', gameState);
}

io.on('connection', (socket) => {
  socket.emit('state', gameState);

  socket.on('mj:startDraft', () => {
    initCountries();
    gameState.phase = 'draft';
    gameState.round = 0;
    addLog('Draft démarré', 'event');
    broadcastState();
  });

  socket.on('mj:startProsperity', () => {
    gameState.phase = 'prosperity';
    gameState.round = 1;
    addLog('Phase de Prospérité démarrée', 'event');
    broadcastState();
  });

  socket.on('mj:startWar', () => {
    gameState.phase = 'war';
    addLog('⚔️ PHASE DE GUERRE DÉMARRÉE', 'attack');
    broadcastState();
  });

  socket.on('mj:drawEvent', () => {
    const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    gameState.currentEvent = ev;
    gameState.eventMod = { armyCostMult:1, cheapAttack:false, peace:false, blackMarket:false };
    gameState.prices = { oil:80, food:40 };

    if (ev.priceChanges) {
      if (ev.priceChanges.oil)  gameState.prices.oil  = Math.round(80 * ev.priceChanges.oil);
      if (ev.priceChanges.food) gameState.prices.food = Math.round(40 * ev.priceChanges.food);
    }
    if (ev.special === 'cheapArmy')   gameState.eventMod.armyCostMult = 0.8;
    if (ev.special === 'cheapAttack') gameState.eventMod.cheapAttack = true;
    if (ev.special === 'peace')       gameState.eventMod.peace = true;

    if (ev.special === 'crisis') {
      Object.values(gameState.countries).forEach(c => {
        if (!c.eliminated) { c.treasury = Math.round(c.treasury * 0.85); c.power = calcPower(c); }
      });
    }
    if (ev.special === 'sanctionB') {
      Object.values(gameState.countries).forEach(c => {
        if (!c.eliminated && c.tier === 'B') { c.treasury = Math.max(0, c.treasury - 100); c.power = calcPower(c); }
      });
    }
    if (ev.special === 'oilBonus') {
      Object.values(gameState.countries).forEach(c => {
        if (!c.eliminated && c.oil >= 300) { c.treasury += 200; c.power = calcPower(c); }
      });
      addLog('Boom pétrolier: pays riches en pétrole +200 or', 'event');
    }
    if (ev.special === 'quake') {
      const alive = Object.values(gameState.countries).filter(c => !c.eliminated);
      if (alive.length > 0) {
        const vic = alive[Math.floor(Math.random() * alive.length)];
        vic.power = Math.max(0, vic.power - 200);
        addLog(`Séisme: ${vic.flag} ${vic.name} −200 pts`, 'event');
      }
    }
    if (ev.special === 'underdog') {
      Object.values(gameState.countries).forEach(c => {
        if (!c.eliminated && c.power < 300) {
          c.treasury += 150;
          c.power = calcPower(c);
          addTeamNews(c.team, 'Révolution des ressources : +150 or reçus !', 'good');
        }
      });
      addLog('Révolution : pays faibles +150 or', 'event');
    }
    if (ev.special === 'aidFMI') {
      const alive = Object.values(gameState.countries)
        .filter(c => !c.eliminated)
        .sort((a, b) => a.power - b.power)
        .slice(0, 3);
      alive.forEach(c => {
        c.treasury += 100;
        c.army += 3;
        c.power = calcPower(c);
        addTeamNews(c.team, 'Aide FMI : +100 or et +3 bataillons reçus !', 'good');
      });
      addLog('Aide FMI : 3 pays les plus faibles secourus', 'event');
    }
    if (ev.special === 'blackMarket') {
      gameState.eventMod.blackMarket = true;
      Object.values(gameState.countries).forEach(c => {
        if (!c.eliminated && c.power < 400) {
          addTeamNews(c.team, 'Marché noir : vos ressources se vendent ×2 cette manche !', 'good');
        }
      });
      addLog('Marché noir : petits pays vendent ×2', 'event');
    }

    addLog('Événement: ' + ev.title, 'event');
    broadcastState();
  });

  socket.on('mj:nextRound', () => {
    gameState.round++;
    gameState.prices = { oil:80, food:40 };
    gameState.eventMod = { armyCostMult:1, cheapAttack:false, peace:false, blackMarket:false };
    gameState.currentEvent = null;
    Object.values(gameState.countries).forEach(c => {
      if (!c.eliminated) {
        c.defense = false;
        c.treasury += Math.round(Math.random() * 50 + 30);
        c.power = calcPower(c);
      }
    });
    addLog('Manche ' + gameState.round + ' démarrée', 'event');
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
      addLog(`${att.flag} ${att.name} GAGNE vs ${def.flag} ${def.name}`, 'attack');
      addTeamNews(att.team, `Victoire ! +${goldGain} or, +${oilGain} pétrole, +${foodGain} nourr. pillés sur ${def.flag} ${def.name}`, 'good');
      addTeamNews(def.team, `Défaite contre ${att.flag} ${att.name} — pertes: −${goldGain} or`, 'bad');
    } else {
      const loss = Math.round(att.treasury * 0.3);
      att.treasury = Math.max(0, att.treasury - loss);
      att.power = calcPower(att);
      addLog(`${att.flag} ${att.name} ÉCHOUE vs ${def.flag} ${def.name}`, 'attack');
      addTeamNews(att.team, `Attaque échouée contre ${def.flag} ${def.name} — −${loss} or`, 'bad');
      addTeamNews(def.team, `Vous avez repoussé l'attaque de ${att.flag} ${att.name} !`, 'good');
    }
    broadcastState();
  });

  socket.on('mj:eliminate', ({ countryId }) => {
    const c = gameState.countries[countryId];
    if (!c) return;
    c.eliminated = true;
    addLog(`${c.flag} ${c.name} est éliminé !`, 'eliminated');
    addTeamNews(c.team, 'Votre nation a été conquise. Vous êtes éliminé(e).', 'bad');
    broadcastState();
  });

  socket.on('mj:bonus', ({ countryId, amount }) => {
    const c = gameState.countries[countryId];
    if (!c) return;
    c.treasury += amount;
    c.power = calcPower(c);
    addLog(`${amount > 0 ? '+' : ''}${amount} or → ${c.flag} ${c.name}`, amount > 0 ? 'economy' : 'attack');
    broadcastState();
  });

  socket.on('mj:reset', () => {
    gameState = {
      phase:'setup', round:0, countries:{}, takenCountries:{}, teams:{},
      prices:{ oil:80, food:40 },
      eventMod:{ armyCostMult:1, cheapAttack:false, peace:false, blackMarket:false },
      currentEvent:null, log:[],
    };
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
    addTeamNews(teamName, `Achat: +${qty} ${resource} pour ${total} or`, 'good');
    broadcastState();
  });

  socket.on('team:sellResource', ({ teamName, resource, qty }) => {
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const c = gameState.countries[team.country];
    if (c[resource] < qty) { socket.emit('error', 'Stock insuffisant !'); return; }
    const price = gameState.prices[resource] || 80;
    const mult = (gameState.eventMod.blackMarket && c.power < 400) ? 2 : 1;
    const total = price * qty * mult;
    c[resource] -= qty; c.treasury += total; c.power = calcPower(c);
    addTeamNews(teamName, `Vente: −${qty} ${resource} pour +${total} or${mult === 2 ? ' (×2 marché noir !)' : ''}`, 'good');
    broadcastState();
  });

  socket.on('team:recruitArmy', ({ teamName, qty, type }) => {
    const team = gameState.teams[teamName];
    if (!team || !team.country) return;
    const c = gameState.countries[team.country];
    const mult     = gameState.eventMod.armyCostMult || 1;
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
    addTeamNews(teamName, 'Bunker activé — dommages réduits de 30% cette manche', 'neutral');
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
    addLog(`${c.flag} ${c.name} déclare une attaque sur ${target.flag} ${target.name}`, 'attack');
    addTeamNews(teamName, `Attaque déclarée sur ${target.flag} ${target.name} — en attente du MJ`, 'bad');
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Geopolitica running on port ${PORT}`));
