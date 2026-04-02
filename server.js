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
  { id:'qatar',   flag:'🇶🇦', name:'Qatar',        tier:'A', gold:680, oil:400, food:80,  tourism:220, agriculture:20,  army:180, population:3 },
  { id:'france',  flag:'🇫🇷', name:'France',       tier:'A', gold:550, oil:80,  food:350, tourism:250, agriculture:150, army:220, population:68 },
  { id:'brazil',  flag:'🇧🇷', name:'Brésil',       tier:'B', gold:400, oil:150, food:600, tourism:80,  agriculture:250, army:160, population:215 },
  { id:'india',   flag:'🇮🇳', name:'Inde',         tier:'B', gold:380, oil:100, food:550, tourism:120, agriculture:200, army:180, population:1400 },
  { id:'morocco', flag:'🇲🇦', name:'Maroc',        tier:'B', gold:320, oil:60,  food:400, tourism:150, agriculture:180, army:150, population:37 },
  { id:'guinea',  flag:'🇬🇳', name:'Guinée',       tier:'B', gold:220, oil:40,  food:380, tourism:40,  agriculture:200, army:130, population:13 },
];

function getFoodConsumption(c) { return Math.max(2, Math.round(c.population / 8)); }

function getPassiveIncome(c, mod) {
  const oilIncome  = Math.round((c.oil||0)         * 0.5  * (mod.oilMultiplier     || 1));
  const tourIncome = Math.round((c.tourism||0)      * 0.6  * (mod.tourismMultiplier || 1));
  const agriIncome = Math.round((c.agriculture||0)  * 0.45 * (mod.agriMultiplier   || 1));
  const baseIncome = Math.round((80 + Math.random() * 60 + c.population * 0.05) * (mod.baseMultiplier || 1));
  return { oilIncome, tourIncome, agriIncome, baseIncome, total: oilIncome + tourIncome + agriIncome + baseIncome };
}

// Each event has: hint (shown N-1), title+effect (applied N)
const EVENTS = [
  // MARKET
  { id:'oil_boom',    type:'market', hint:'🛢️ Des satellites détectent une activité intense sur les champs pétroliers du Golfe. Les analystes prévoient une surproduction record...', title:'Boom pétrolier historique', desc:'Les cours du pétrole atteignent des records absolus.', effect:'Revenus pétrole ×5 · Prix pétrole ×4 · Achat pétrole bloqué < 5000 pts', oilMultiplier:5, priceChanges:{oil:4.0}, blockOilBelowPower:5000, w:1 },
  { id:'tourism_boom',type:'market', hint:'✈️ Les agences de voyage signalent une explosion des réservations mondiales. Les frontières s\'ouvrent partout. Le tourisme reprend à toute vitesse...', title:'Explosion du tourisme mondial', desc:'Les voyageurs affluent, les économies touristiques explosent.', effect:'Revenus tourisme ×6 · Prix tourisme −50%', tourismMultiplier:6, priceChanges:{tourism:0.5}, w:1 },
  { id:'agri_boom',   type:'market', hint:'🌾 Des chercheurs annoncent une percée agricole majeure. De nouvelles semences résistantes promettent des rendements exceptionnels cette saison...', title:'Révolution agricole mondiale', desc:'De nouvelles techniques quadruplent les rendements.', effect:'Revenus agriculture ×5 · Nourriture +20% à tous', agriMultiplier:5, special:'agriBoost', w:1 },
  { id:'oil_crash',   type:'market', hint:'⚡ Les énergies renouvelables gagnent du terrain à une vitesse inattendue. Les investisseurs commencent à fuir les actifs pétroliers massivement...', title:'Effondrement pétrolier mondial', desc:'Le pétrole perd toute valeur du jour au lendemain.', effect:'Pays pétrole > 200: −800 or · Revenus pétrole ×0', special:'oilCrash', oilMultiplier:0, w:1 },
  { id:'trade_open',  type:'market', hint:'🌐 Les négociateurs de l\'OMC s\'apprêtent à signer un accord commercial historique. Des rumeurs de réduction massive des tarifs douaniers circulent...', title:'Traité de libre-échange mondial', desc:'Un accord historique ouvre toutes les frontières commerciales.', effect:'Prix ressources −50% · Revenus de base ×2', priceChanges:{oil:0.5,food:0.5,tourism:0.5,agriculture:0.5}, baseMultiplier:2, w:1 },
  { id:'sanctions_sa',type:'market', hint:'🏛️ Le G20 tient une réunion d\'urgence à Genève. Des sources diplomatiques évoquent des "mesures punitives sans précédent" contre les économies dominantes...', title:'Sanctions économiques massives', desc:'Le G20 frappe fort les économies dominantes.', effect:'Tier S et A: −1000 or · 3 plus faibles: +400 or', special:'sanctionsSA', w:1 },
  { id:'food_crisis', type:'market', hint:'🌡️ La NASA publie des images alarmantes: sécheresses record sur tous les continents. Les prix alimentaires commencent à grimper sur les marchés à terme...', title:'Famine mondiale dévastatrice', desc:'Les récoltes s\'effondrent, la famine menace des milliards.', effect:'Prix nourriture ×5 · Pays < 200 nourr.: −30% puissance · Agri ×4', priceChanges:{food:5.0}, agriMultiplier:4, special:'foodCrisisPenalty', w:1 },
  { id:'goldRush',    type:'market', hint:'⛏️ Des prospecteurs signalent la découverte de gisements géants d\'or en Sibérie, en Amazonie et en Afrique sub-saharienne. Les marchés s\'emballent...', title:'Ruée vers l\'or', desc:'De nouveaux gisements géants sont découverts partout.', effect:'Revenus de base ×3 cette période', baseMultiplier:3, w:1 },
  // CHOICE
  { id:'embargo',     type:'choice', hint:'🚢 Le Conseil de Sécurité débat d\'un embargo général. Chaque nation devra choisir son camp dans les prochains mois. Préparez vos arguments...', title:'Embargo international', desc:'Le Conseil de Sécurité impose un embargo total.', effect:'CHOIX: Sacrifier 300 pétrole (neutralité) OU payer 800 or', choiceA:{label:'Sacrifier 300 pétrole (neutralité)',cost:{oil:300}}, choiceB:{label:'Payer 800 or de sanctions',cost:{treasury:800}}, w:1 },
  { id:'arms',        type:'choice', hint:'🔬 Les laboratoires militaires annoncent des avancées technologiques majeures. Les États réévaluent leurs stratégies de défense nationale...', title:'Course aux armements', desc:'Les nations doivent choisir leur stratégie militaire.', effect:'CHOIX: 500 or → +120 armée OU 400 nourr → +80 armée +20% combat', choiceA:{label:'Investissement militaire (500 or → +120 armée)',cost:{treasury:500},gain:{army:120}}, choiceB:{label:'Mobilisation populaire (400 nourr → +80 armée +20% combat)',cost:{food:400},gain:{army:80,combatBonus:0.20}}, w:1 },
  { id:'tech',        type:'choice', hint:'🤫 Une superpuissance anonyme propose discrètement un partenariat technologique militaire. Les diplomates évoquent une offre "très avantageuse mais à saisir rapidement"...', title:'Accord technologique secret', desc:'Un pacte technologique militaire est proposé.', effect:'CHOIX: 400 or → +80 armée +300 pts OU Refuser', choiceA:{label:'Signer (400 or → +80 armée +300 pts)',cost:{treasury:400},gain:{army:80,power:300}}, choiceB:{label:'Refuser (aucun effet)',cost:{},gain:{}}, w:1 },
  { id:'warprep',     type:'choice', hint:'🔭 Les services de renseignement alertent sur des mouvements de troupes aux frontières. "La guerre est probable dans 6 mois" affirment les analystes...', title:'Préparation de guerre imminente', desc:'Les renseignements confirment une guerre imminente.', effect:'CHOIX: Bunker +200 pts défense (gratuit) OU 700 or → +200 armée', choiceA:{label:'Défense renforcée (gratuit → bunker +200 pts)',cost:{},gain:{defense:true,power:200}}, choiceB:{label:'Frappe préventive (700 or → +200 armée)',cost:{treasury:700},gain:{army:200}}, w:1 },
  // TARGETED
  { id:'earthquake',  type:'targeted', hint:'🌋 Les sismologues enregistrent une activité tectonique anormale dans plusieurs zones à risque. Des experts évacuent certaines populations côtières...', title:'Séisme catastrophique', desc:'Un méga-séisme frappe sans prévenir.', effect:'1 pays aléatoire: −50% nourriture −400 pts', targetCount:1, effects:{foodLoss:0.50,powerLoss:400}, w:2 },
  { id:'typhoon',     type:'targeted', hint:'🌀 Météo-France et la NOAA signalent la formation de plusieurs super-typhons dans le Pacifique et l\'Atlantique. Trajectoires imprévisibles...', title:'Super typhon dévastateur', desc:'Des typhons d\'une violence inouïe ravagent plusieurs côtes.', effect:'2 pays aléatoires: −60% nourriture −200 pts', targetCount:2, effects:{foodLoss:0.60,powerLoss:200}, w:2 },
  { id:'revolution',  type:'targeted', hint:'✊ Des mouvements sociaux d\'ampleur inédite secouent les capitales mondiales. Les peuples opprimés réclament leur part du gâteau économique...', title:'Révolution des ressources', desc:'Les nations émergentes brisent les chaînes de l\'ordre mondial.', effect:'Pays < 4000 pts: +350 or · Pays > 9000 pts: −400 or', special:'revolution', w:2 },
  { id:'fmi',         type:'targeted', hint:'🏦 Le FMI prépare un plan de sauvetage massif pour les économies les plus fragiles. Des milliards seraient déployés dans les prochains mois...', title:'Intervention FMI d\'urgence', desc:'Le FMI déploie des ressources massives pour stabiliser les économies fragiles.', effect:'3 nations les plus faibles: +300 or +60 armée', special:'aidFMI', w:2 },
  { id:'uprising',    type:'targeted', hint:'📢 Des syndicats et mouvements populaires organisent des grèves générales dans plusieurs pays. Les gouvernements redoutent des soulèvements armés...', title:'Soulèvement populaire mondial', desc:'Les populations opprimées renversent les élites.', effect:'Tier B: +80 armée · Tier S: −150 armée (désertion)', special:'uprising', w:2 },
  { id:'tourism_c',   type:'targeted', hint:'🔒 Plusieurs attentats dans des lieux touristiques majeurs. Les gouvernements émettent des avis de voyage négatifs. L\'industrie touristique s\'inquiète...', title:'Crise du tourisme mondial', desc:'Les attentats ferment les frontières touristiques.', effect:'Pays tourisme > 150: −400 or · Pays tourisme < 60: +200 or', special:'tourismCrisis', w:1 },
];

function weightedRandom(pool) {
  const weighted = [];
  pool.forEach(ev => { for(let i=0;i<(ev.w||1);i++) weighted.push(ev); });
  return weighted[Math.floor(Math.random() * weighted.length)];
}

// Pre-generate all 6 period events + their hints shown N-1
function generatePeriodSequence() {
  const sequence = [];
  for(let i=0;i<6;i++) sequence.push(weightedRandom(EVENTS));
  return sequence;
}

const TUTORIAL_PERIOD = {
  number:0,
  name:"Manche Test — Découverte",
  subtitle:"Tutorial · Ressources remises à zéro après",
  desc:"Bienvenue dans Geopolitica ! Cette manche de test ne compte pas — vos ressources seront remises à zéro après. Explorez l'interface : achetez des ressources, consultez les onglets, regardez comment évolue votre puissance. Vous avez 2 actions. Aucune conséquence, que de la découverte !",
  hint:"ℹ️ Cette manche est une démonstration. Les ressources seront remises à zéro. Apprenez à jouer sans pression !",
};

const PERIODS = [
  { number:1, name:"L'Ère de Croissance",          subtitle:"Janvier — Juin · An 1",   desc:"Les marchés s'ouvrent. Regardez l'indice de la prochaine période — il vous guide sur ce qu'il faut acheter. Achetez pétrole (×0.5/u), tourisme (×0.6/u) ou agriculture (×0.45/u) pour générer des revenus passifs. ⚔️ RAPPEL GUERRE: gardez au moins 450 or pour la phase de combat (3 attaques à 150 or). 2 actions." },
  { number:2, name:"Premières Tensions",            subtitle:"Juillet — Déc · An 1",    desc:"Les intérêts divergent. Lisez attentivement l'indice en bas — il préfigure l'événement de la prochaine manche. Si l'indice parle de pétrole, achetez-en. Si ça parle de famine, stockez de la nourriture. ⚔️ Gardez 450 or minimum pour la guerre. 2 actions." },
  { number:3, name:"Crise Mondiale",                subtitle:"Janvier — Juin · An 2",   desc:"Catastrophe mondiale. Si un événement CHOIX arrive, vous avez 60 secondes. La puissance se calcule avec toutes vos ressources — diversifiez. Plus que 3 périodes avant la guerre. ⚔️ Commencez à vous préparer militairement. 2 actions." },
  { number:4, name:"Course aux Armements",          subtitle:"Juillet — Déc · An 2",    desc:"La guerre approche. Renforcez votre armée. Bunker (200 or) = −30% dommages reçus. Lisez l'indice de la prochaine manche — les deux dernières périodes sont cruciales pour votre position de départ en guerre. ⚔️ Minimum 450 or en réserve ! 2 actions." },
  { number:5, name:"Ultimatums",                    subtitle:"Janvier — Juin · An 3",   desc:"AVANT-DERNIÈRE PÉRIODE. Regardez l'indice de la prochaine manche — c'est votre dernière chance d'optimiser. Après la période 6, la GUERRE commence. Convertissez vos ressources en puissance. ⚔️ Gardez 600 or (4 attaques). 2 actions." },
  { number:6, name:"Le Monde Retient son Souffle",  subtitle:"Juillet — Déc · An 3",    desc:"DERNIÈRE PÉRIODE DE PAIX. Plus aucun achat en guerre. ⚔️ UNE ATTAQUE COÛTE 150 OR — gardez au moins 450 or. Achetez de l'armée ou un bunker si vous ne l'avez pas. Vos décisions maintenant déterminent votre survie en guerre. Dernière chance absolue. 2 actions." },
];

let gameState = {
  phase:'setup', currentPeriod:0, currentEvent:null, nextHint:null,
  periodSequence:[], // pre-generated events
  countries:{}, takenCountries:{}, teams:{},
  prices:{ oil:80, food:40, tourism:120, agriculture:60 },
  eventMod:{ oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0, peace:false },
  coalition:{ proposed:false, moroccoAccepted:false, guineaAccepted:false, active:false },
  alliances:{}, pendingAllianceProposals:{},
  log:[], timerSeconds:600, timerRunning:false,
  warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30,
  teamActionsThisPeriod:{},
  pendingChoiceEvent:null,
  winner:null,
  isTutorial:false,
  tutorialResources:{}, // snapshot before tutorial
};

let timerInterval=null, warTurnInterval=null;

function initCountries() {
  gameState.countries = {};
  COUNTRIES.forEach(c => {
    gameState.countries[c.id] = { ...c, treasury:c.gold, power:calcPower({...c,treasury:c.gold}), eliminated:false, defense:false, team:null, combatBonus:0 };
  });
}

function calcPower(c) {
  const tierBonus = c.tier==='B' ? 1.15 : 1.0;
  return Math.max(0, Math.round((c.army*10 + (c.treasury||0)*0.25 + (c.oil||0)*0.8 + (c.tourism||0)*0.6 + (c.agriculture||0)*0.5 + (c.food||0)*1.2) * tierBonus));
}

function resolveCombat(att, def) {
  const tA=att.tier==='B'?1.15:1.0, tD=def.tier==='B'?1.15:1.0;
  const cA=1+(att.combatBonus||0);
  const rA=1+Math.random()*0.20+Math.random()*0.20;
  const rD=1+Math.random()*0.20+Math.random()*0.20;
  const sA=att.power*rA*tA*cA+att.food*0.07;
  const sD=def.power*rD*tD*1.15+def.food*0.07+(def.defense?def.power*0.30:0);
  return { attackerWins:sA>sD, scoreAtt:Math.round(sA), scoreDef:Math.round(sD) };
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
  gameState.prices = { oil:80, food:40, tourism:120, agriculture:60 };
  gameState.eventMod = { oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0, peace:false };
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
  if(ev.special==='oilCrash')     Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated&&c.oil>200){ c.treasury=Math.max(0,c.treasury-800); c.power=calcPower(c); addTeamNews(c.team,'💥 Effondrement pétrolier: −800 or !','bad'); }});
  if(ev.special==='agriBoost')    Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ c.food=Math.round(c.food*1.20); c.power=calcPower(c); addTeamNews(c.team,'🌾 Révolution agricole: +20% nourriture !','good'); }});
  if(ev.special==='foodCrisisPenalty') Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated&&c.food<200){ const l=Math.round(c.power*0.30); c.power=Math.max(0,c.power-l); addTeamNews(c.team,`🚨 Famine: stocks faibles — −${l} pts !`,'bad'); }});
  if(ev.special==='sanctionsSA')  { Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated&&(c.tier==='S'||c.tier==='A')){ c.treasury=Math.max(0,c.treasury-1000); c.power=calcPower(c); addTeamNews(c.team,'⚠️ Sanctions G20: −1000 or !','bad'); }}); const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3); alive.forEach(c=>{ c.treasury+=400; c.power=calcPower(c); addTeamNews(c.team,'💰 Compensation sanctions: +400 or !','good'); }); }
  if(ev.special==='revolution')   Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ if(c.power<4000){ c.treasury+=350; c.power=calcPower(c); addTeamNews(c.team,'✊ Révolution: +350 or !','good'); } if(c.power>9000){ c.treasury=Math.max(0,c.treasury-400); c.power=calcPower(c); addTeamNews(c.team,'✊ Révolution: −400 or !','bad'); } }});
  if(ev.special==='aidFMI')       { const alive=Object.values(gameState.countries).filter(c=>!c.eliminated).sort((a,b)=>a.power-b.power).slice(0,3); alive.forEach(c=>{ c.treasury+=300; c.army+=60; c.power=calcPower(c); addTeamNews(c.team,'🏦 FMI: +300 or +60 armée !','good'); }); }
  if(ev.special==='uprising')     Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ if(c.tier==='B'){ c.army+=80; c.power=calcPower(c); addTeamNews(c.team,'✊ Soulèvement: +80 armée !','good'); } if(c.tier==='S'){ c.army=Math.max(0,c.army-150); c.power=calcPower(c); addTeamNews(c.team,'✊ Désertion: −150 armée !','bad'); } }});
  if(ev.special==='tourismCrisis') Object.values(gameState.countries).forEach(c=>{ if(!c.eliminated){ if(c.tourism>150){ c.treasury=Math.max(0,c.treasury-400); c.power=calcPower(c); addTeamNews(c.team,'✈️ Crise tourisme: −400 or !','bad'); } else if(c.tourism<60){ c.treasury+=200; c.power=calcPower(c); addTeamNews(c.team,'✈️ Report touristes: +200 or !','good'); } }});
  if(ev.effects) {
    const alive=Object.values(gameState.countries).filter(c=>!c.eliminated);
    alive.sort(()=>Math.random()-0.5).slice(0,ev.targetCount||1).forEach(c=>{ if(ev.effects.foodLoss){ const l=Math.round(c.food*ev.effects.foodLoss); c.food=Math.max(0,c.food-l); c.power=calcPower(c); addTeamNews(c.team,`🌋 ${ev.title}: −${l} nourriture !`,'bad'); addLog(`${ev.title}: ${c.flag} −${l} nourr`,'event'); } if(ev.effects.powerLoss){ c.power=Math.max(0,c.power-ev.effects.powerLoss); addTeamNews(c.team,`🌋 ${ev.title}: −${ev.effects.powerLoss} pts !`,'bad'); }});
  }
}

function applyPeriodTransition() {
  gameState.eventMod = { oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1, blockOilBelowPower:0, peace:false };
  gameState.prices = { oil:80, food:40, tourism:120, agriculture:60 };
  Object.values(gameState.countries).forEach(c => {
    if(c.eliminated) return;
    const foodNeeded=getFoodConsumption(c);
    if(c.food>=foodNeeded){ c.food-=foodNeeded; addTeamNews(c.team,`🍞 Consommation: −${foodNeeded} nourriture (pop. ${c.population}M)`,'neutral'); }
    else { const deficit=foodNeeded-c.food; c.food=0; const loss=Math.round(deficit*(c.population/10)*2); c.power=Math.max(0,c.power-loss); addTeamNews(c.team,`⚠️ FAMINE ! Manque ${deficit} nourr. pour ${c.population}M hab — −${loss} pts !`,'bad'); addLog(`Famine: ${c.flag} −${loss} pts`,'event'); }
    const inc=getPassiveIncome(c, gameState.eventMod);
    c.treasury+=inc.total;
    addTeamNews(c.team,`💰 Revenus: +${inc.oilIncome} pétrole | +${inc.tourIncome} tourisme | +${inc.agriIncome} agri | +${inc.baseIncome} base = +${inc.total} or`,'good');
    c.defense=false; c.combatBonus=0; c.power=calcPower(c);
  });
  gameState.teamActionsThisPeriod={};
  gameState.alliances={};
}

function startServerTimer(s){ if(timerInterval)clearInterval(timerInterval); gameState.timerSeconds=s; gameState.timerRunning=true; timerInterval=setInterval(()=>{ if(gameState.timerSeconds>0){ gameState.timerSeconds--; io.emit('timer',{seconds:gameState.timerSeconds,running:true}); } else { clearInterval(timerInterval);timerInterval=null;gameState.timerRunning=false;io.emit('timer',{seconds:0,running:false,ended:true}); }},1000); }
function pauseServerTimer(){ if(timerInterval){clearInterval(timerInterval);timerInterval=null;} gameState.timerRunning=false; io.emit('timer',{seconds:gameState.timerSeconds,running:false}); }
function resetServerTimer(s){ pauseServerTimer(); gameState.timerSeconds=s||600; io.emit('timer',{seconds:gameState.timerSeconds,running:false}); }

function checkWinner() {
  const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  if(alive.length===1&&gameState.phase==='war'){ gameState.winner=alive[0]; io.emit('winner',alive[0]); addLog(`🏆 ${alive[0].flag} ${alive[0].name} remporte Geopolitica !`,'event'); broadcast(); }
}

function startWarTurn() {
  const alive=Object.values(gameState.countries).filter(c=>c.team&&!c.eliminated);
  gameState.warTurnOrder=alive.map(c=>c.team); gameState.warCurrentTurn=0; advanceWarTurn();
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
  socket.emit('timer',{seconds:gameState.timerSeconds,running:gameState.timerRunning});
  if(gameState.winner) socket.emit('winner',gameState.winner);
  // Send pending alliance proposals for reconnecting clients
  Object.entries(gameState.pendingAllianceProposals).forEach(([to, proposal]) => {
    if(proposal) socket.emit('allianceProposal', proposal);
  });

  socket.on('mj:startDraft', ()=>{
    initCountries(); gameState.phase='draft'; gameState.currentPeriod=0;
    gameState.coalition={proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false};
    gameState.teamActionsThisPeriod={}; gameState.alliances={}; gameState.pendingAllianceProposals={};
    gameState.winner=null; gameState.isTutorial=false; gameState.nextHint=null;
    gameState.periodSequence=generatePeriodSequence();
    resetServerTimer(600); addLog('Draft démarré','event'); broadcast();
  });

  socket.on('mj:startTutorial', ()=>{
    gameState.phase='prosperity'; gameState.currentPeriod=0; gameState.isTutorial=true;
    gameState.teamActionsThisPeriod={};
    // Save snapshot to restore after tutorial
    gameState.tutorialResources={};
    Object.values(gameState.countries).forEach(c=>{ if(c.team) gameState.tutorialResources[c.id]={...c}; });
    const tutEv={ id:'tutorial', type:'market', title:'Manche Test', desc:TUTORIAL_PERIOD.desc, effect:'Explorez librement — ressources remises à zéro après', oilMultiplier:1, tourismMultiplier:1, agriMultiplier:1, baseMultiplier:1 };
    gameState.currentEvent={ ...tutEv, periodName:TUTORIAL_PERIOD.name, periodSubtitle:TUTORIAL_PERIOD.subtitle, periodDesc:TUTORIAL_PERIOD.desc, periodNumber:0 };
    gameState.nextHint=gameState.periodSequence[0]?.hint||null;
    resetServerTimer(300); // 5 min tutorial
    addLog('Manche Test démarrée (5 min)','event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,`🎮 MANCHE TEST — Explorez l'interface !\n${TUTORIAL_PERIOD.desc}\n\n🔮 Indice de la vraie période 1:\n${gameState.nextHint||''}`, 'neutral'); });
    broadcast();
  });

  socket.on('mj:endTutorial', ()=>{
    // Restore resources to initial values
    Object.values(gameState.countries).forEach(c=>{
      if(gameState.tutorialResources[c.id]){
        const snap=gameState.tutorialResources[c.id];
        c.oil=snap.oil; c.food=snap.food; c.tourism=snap.tourism; c.agriculture=snap.agriculture;
        c.army=snap.army; c.treasury=snap.treasury; c.defense=false; c.combatBonus=0; c.power=calcPower(c);
      }
    });
    gameState.isTutorial=false; gameState.teamActionsThisPeriod={};
    addLog('Manche Test terminée — ressources remises à zéro','event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,'✅ Manche test terminée ! Vos ressources ont été remises à zéro. La vraie partie commence !','neutral'); });
    broadcast();
  });

  socket.on('mj:startProsperity', ()=>{
    gameState.phase='prosperity'; gameState.currentPeriod=1; gameState.currentEvent=null;
    gameState.teamActionsThisPeriod={}; gameState.isTutorial=false;
    const period=PERIODS[0];
    const ev=gameState.periodSequence[0]||weightedRandom(EVENTS);
    gameState.currentEvent={...ev,periodName:period.name,periodSubtitle:period.subtitle,periodDesc:period.desc,periodNumber:period.number};
    if(ev.type==='market'||ev.type==='targeted') applyEvent(ev);
    else if(ev.type==='choice'){ gameState.pendingChoiceEvent=ev; io.emit('choiceEvent',ev); }
    // Next hint (period 2's event hint)
    const nextEv=gameState.periodSequence[1];
    gameState.nextHint=nextEv?.hint||null;
    resetServerTimer(600);
    addLog(`Période 1 — ${period.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,`📅 Période 1 — ${period.name}\n${period.desc}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}\n\n🔮 Indice période 2:\n${gameState.nextHint||'(aucun indice)'}`,'neutral'); });
    broadcast();
  });

  socket.on('mj:nextPeriod', ()=>{
    if(gameState.currentPeriod>=6) return;
    applyPeriodTransition();
    gameState.currentPeriod++;
    const period=PERIODS[gameState.currentPeriod-1];
    const ev=gameState.periodSequence[gameState.currentPeriod-1]||weightedRandom(EVENTS);
    gameState.currentEvent={...ev,periodName:period.name,periodSubtitle:period.subtitle,periodDesc:period.desc,periodNumber:period.number};
    gameState.pendingChoiceEvent=null;
    if(ev.type==='market'||ev.type==='targeted') applyEvent(ev);
    else if(ev.type==='choice'){ gameState.pendingChoiceEvent=ev; io.emit('choiceEvent',ev); }
    const nextEv=gameState.periodSequence[gameState.currentPeriod]; // hint for N+1
    gameState.nextHint=gameState.currentPeriod<6?(nextEv?.hint||null):'⚔️ La prochaine étape est la GUERRE. Gardez au moins 450 or pour attaquer (150 or/attaque).';
    resetServerTimer(600);
    addLog(`Période ${gameState.currentPeriod} — ${period.name} [${ev.type.toUpperCase()}]`,'event');
    Object.values(gameState.countries).forEach(c=>{ if(c.team) addTeamNews(c.team,`📅 Période ${gameState.currentPeriod} — ${period.name}\n${period.desc}\n\n⚡ ${ev.title} [${ev.type==='choice'?'CHOIX — 60s !':ev.type}]: ${ev.effect}\n\n🔮 Indice ${gameState.currentPeriod<6?`période ${gameState.currentPeriod+1}`:'GUERRE'}:\n${gameState.nextHint||'(aucun indice)'}`,'neutral'); });
    broadcast();
  });

  socket.on('mj:startWar', ()=>{
    gameState.phase='war'; gameState.currentEvent=null; gameState.pendingChoiceEvent=null;
    gameState.teamActionsThisPeriod={}; gameState.alliances={}; gameState.pendingAllianceProposals={};
    gameState.coalition={proposed:true,moroccoAccepted:false,guineaAccepted:false,active:false};
    resetServerTimer(600);
    addLog('⚔️ GUERRE MONDIALE DÉMARRÉE','attack');
    if(gameState.countries.morocco?.team) addTeamNews(gameState.countries.morocco.team,'🤝 Coalition proposée avec la Guinée !','neutral');
    if(gameState.countries.guinea?.team)  addTeamNews(gameState.countries.guinea.team,'🤝 Coalition proposée avec le Maroc !','neutral');
    Object.values(gameState.countries).forEach(c=>{ if(c.team&&c.id!=='morocco'&&c.id!=='guinea') addTeamNews(c.team,'⚔️ GUERRE ! Aucun achat. Attendez votre tour. Attaque = 150 or (ou 200 pétrole/300 nourr).','bad'); });
    broadcast();
    setTimeout(()=>startWarTurn(),3000);
  });

  socket.on('mj:timerStart', ({seconds})=>startServerTimer(seconds||gameState.timerSeconds));
  socket.on('mj:timerPause', ()=>pauseServerTimer());
  socket.on('mj:timerReset', ({seconds})=>resetServerTimer(seconds));
  socket.on('mj:nextWarTurn', ()=>nextWarTurn());
  socket.on('mj:startWarTurns', ()=>startWarTurn());

  socket.on('team:choiceResponse', ({teamName, choice})=>{
    const ev=gameState.pendingChoiceEvent; if(!ev) return;
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    const chosen=choice==='A'?ev.choiceA:ev.choiceB;
    if(chosen.cost){
      if(chosen.cost.treasury&&c.treasury<chosen.cost.treasury){ socket.emit('error',`Pas assez d'or ! (${chosen.cost.treasury} requis)`); return; }
      if(chosen.cost.oil&&c.oil<chosen.cost.oil){ socket.emit('error',`Pas assez de pétrole ! (${chosen.cost.oil} requis)`); return; }
      if(chosen.cost.food&&c.food<chosen.cost.food){ socket.emit('error',`Pas assez de nourriture ! (${chosen.cost.food} requis)`); return; }
      if(chosen.cost.treasury) c.treasury-=chosen.cost.treasury;
      if(chosen.cost.oil)      c.oil     -=chosen.cost.oil;
      if(chosen.cost.food)     c.food    -=chosen.cost.food;
    }
    let msg='';
    if(chosen.gain){
      if(chosen.gain.army){ c.army+=chosen.gain.army; msg+=`+${chosen.gain.army} armée `; }
      if(chosen.gain.power){ c.power+=chosen.gain.power; msg+=`+${chosen.gain.power} pts `; }
      if(chosen.gain.powerLoss){ c.power=Math.max(0,c.power-chosen.gain.powerLoss); msg+=`−${chosen.gain.powerLoss} pts `; }
      if(chosen.gain.defense){ c.defense=true; msg+=`+bunker `; }
      if(chosen.gain.combatBonus){ c.combatBonus=(c.combatBonus||0)+chosen.gain.combatBonus; msg+=`+${Math.round(chosen.gain.combatBonus*100)}% combat `; }
      if(chosen.gain.gamble){ if(Math.random()<0.5){ c.power=Math.max(0,c.power-chosen.gain.powerLoss); msg+=`−${chosen.gain.powerLoss} pts (découvert !) `; } else msg+=`Non découvert `; }
    }
    c.power=calcPower(c);
    addTeamNews(teamName,`✅ Choix "${chosen.label}": ${msg}`,'good');
    addLog(`${c.flag} choisit: ${chosen.label}`,'event'); broadcast();
  });

  // ALLIANCES — persistent proposal system
  socket.on('team:proposeAlliance', ({fromTeam, toTeam, allianceType})=>{
    if(gameState.phase!=='war'){ socket.emit('error','Alliances disponibles en guerre seulement !'); return; }
    const cost=allianceType==='offensive'?100:0;
    const team=gameState.teams[fromTeam]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    if(cost>0&&c.treasury<cost){ socket.emit('error','Pas assez d\'or pour cette alliance !'); return; }
    const proposal={from:fromTeam,to:toTeam,type:allianceType,cost,expires:Date.now()+30000};
    gameState.pendingAllianceProposals[toTeam]=proposal;
    io.emit('allianceProposal',proposal);
    addTeamNews(toTeam,`🤝 Alliance proposée par ${fromTeam} (${allianceType==='offensive'?'offensive — +15% combat, 100 or':'non-agression — gratuite'}). Répondez dans votre onglet Attaquer !`,'neutral');
    // Auto-expire after 30s
    setTimeout(()=>{
      if(gameState.pendingAllianceProposals[toTeam]===proposal){
        delete gameState.pendingAllianceProposals[toTeam];
        io.emit('allianceExpired',{to:toTeam});
        addTeamNews(fromTeam,`❌ Alliance avec ${toTeam} — pas de réponse (expirée)`,'bad');
      }
    },30000);
  });

  socket.on('team:respondAlliance', ({fromTeam, toTeam, accepted, allianceType})=>{
    delete gameState.pendingAllianceProposals[toTeam];
    if(!accepted){ addTeamNews(fromTeam,`❌ Alliance refusée par ${toTeam}`,'bad'); io.emit('allianceExpired',{to:toTeam}); broadcast(); return; }
    const cost=allianceType==='offensive'?100:0;
    const propTeam=gameState.teams[fromTeam];
    if(propTeam&&propTeam.country){ const pc=gameState.countries[propTeam.country]; if(cost>0) pc.treasury=Math.max(0,pc.treasury-cost); }
    const turnIndex=gameState.warCurrentTurn;
    gameState.alliances[fromTeam]={type:allianceType,with:toTeam,expires:turnIndex+gameState.warTurnOrder.length};
    gameState.alliances[toTeam]  ={type:allianceType,with:fromTeam,expires:turnIndex+gameState.warTurnOrder.length};
    addTeamNews(fromTeam,`✅ Alliance ${allianceType} avec ${toTeam} — 1 tour !`,'good');
    addTeamNews(toTeam,`✅ Alliance ${allianceType} avec ${fromTeam} — 1 tour !`,'good');
    addLog(`🤝 Alliance ${allianceType}: ${fromTeam} & ${toTeam}`,'event'); broadcast();
  });

  socket.on('team:acceptCoalition', ({teamName})=>{
    const c=Object.values(gameState.countries).find(c=>c.team===teamName); if(!c) return;
    if(c.id==='morocco') gameState.coalition.moroccoAccepted=true;
    if(c.id==='guinea')  gameState.coalition.guineaAccepted=true;
    if(gameState.coalition.moroccoAccepted&&gameState.coalition.guineaAccepted){
      gameState.coalition.active=true;
      const morocco=gameState.countries.morocco, guinea=gameState.countries.guinea;
      const bG=Math.round(guinea.treasury*0.25),bO=Math.round(guinea.oil*0.25),bF=Math.round(guinea.food*0.25),bA=Math.round(guinea.army*0.25);
      morocco.treasury+=bG; morocco.oil+=bO; morocco.food+=bF; morocco.army+=bA; morocco.power=calcPower(morocco); guinea.power=calcPower(guinea);
      addLog('🤝 Coalition Maroc-Guinée: +25% ressources !','event');
      addTeamNews(morocco.team,`✅ Coalition ! Bonus: +${bG} or, +${bO} pétrole, +${bF} nourr, +${bA} armée`,'good');
      addTeamNews(guinea.team,'✅ Coalition active ! Combattez avec le Maroc.','good');
    } else addTeamNews(teamName,"✅ Accepté — en attente...",'neutral');
    broadcast();
  });
  socket.on('team:refuseCoalition', ({teamName})=>{ gameState.coalition.proposed=false; addTeamNews(gameState.countries.morocco?.team,'❌ Coalition refusée.','bad'); addTeamNews(gameState.countries.guinea?.team,'❌ Coalition refusée.','bad'); broadcast(); });

  socket.on('team:declareAttack', ({teamName, targetId, payWith})=>{
    if(gameState.phase!=='war'){ socket.emit('error',"La guerre n'a pas commencé !"); return; }
    if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName){ socket.emit('error',"Ce n'est pas votre tour !"); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const att=gameState.countries[team.country]; const def=gameState.countries[targetId];
    if(!att||!def||att.eliminated||def.eliminated) return;
    const myAlliance=gameState.alliances[teamName];
    if(myAlliance&&myAlliance.type==='peace'&&myAlliance.with===def.team){ socket.emit('error','Pacte de non-agression actif — attaque impossible !'); return; }
    const costs={gold:150,oil:200,food:300}; const pr=payWith||'gold';
    const cost=costs[pr]||150; const rk=pr==='gold'?'treasury':pr;
    if(att[rk]<cost){ socket.emit('error',`Pas assez de ${pr==='gold'?'or':pr} ! (${cost} requis)`); return; }
    att[rk]-=cost; att.power=calcPower(att);
    if(myAlliance&&myAlliance.type==='offensive') att.combatBonus=(att.combatBonus||0)+0.15;
    const result=resolveCombat(att,def);
    const lA=Math.round(att.army*(result.attackerWins?0.12:0.28));
    const lD=Math.round(def.army*(result.attackerWins?0.35:0.10));
    if(result.attackerWins){
      att.treasury+=def.treasury; att.oil+=def.oil; att.food+=def.food; att.army+=def.army;
      att.tourism+=Math.round(def.tourism*0.5); att.agriculture+=Math.round(def.agriculture*0.5);
      att.army=Math.max(0,att.army-lA); def.treasury=0; def.oil=0; def.food=0; def.army=0; def.tourism=0; def.agriculture=0;
      att.power=calcPower(att); def.power=calcPower(def);
      addLog(`💥 ${att.flag} écrase ${def.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`🏆 VICTOIRE vs ${def.flag} ! Toutes ressources pillées. −${lA} armée`,'good');
      addTeamNews(def.team,`💀 DÉFAITE vs ${att.flag} — tout pillé. −${lD} armée`,'bad');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:true,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
      if(def.army<=0&&def.treasury<=0){ def.eliminated=true; addLog(`☠️ ${def.flag} éliminé !`,'eliminated'); addTeamNews(def.team,'☠️ Nation anéantie.','bad'); if(gameState.coalition.active&&(def.id==='morocco'||def.id==='guinea')){ gameState.countries.morocco.eliminated=true; gameState.countries.guinea.eliminated=true; } }
    } else {
      const gL=Math.round(att.treasury*0.35); att.treasury=Math.max(0,att.treasury-gL);
      att.army=Math.max(0,att.army-lA); def.army=Math.max(0,def.army-lD);
      att.power=calcPower(att); def.power=calcPower(def);
      addLog(`🛡️ ${def.flag} repousse ${att.flag} ! (${result.scoreAtt} vs ${result.scoreDef})`,'attack');
      addTeamNews(att.team,`❌ Échec vs ${def.flag} — −${gL} or, −${lA} armée`,'bad');
      addTeamNews(def.team,`🛡️ Repoussé ${att.flag} ! −${lD} armée pertes défensives`,'good');
      io.emit('attackAnimation',{attackerId:att.id,defenderId:def.id,success:false,scoreAtt:result.scoreAtt,scoreDef:result.scoreDef});
    }
    delete gameState.alliances[teamName];
    broadcast(); checkWinner();
    setTimeout(()=>nextWarTurn(),2000);
  });

  socket.on('team:skipTurn', ({teamName})=>{ if(gameState.warTurnOrder[gameState.warCurrentTurn]!==teamName) return; addTeamNews(teamName,'Tour passé.','neutral'); nextWarTurn(); broadcast(); });

  socket.on('team:buyResource', ({teamName, resource, qty})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun achat en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    if(!gameState.isTutorial){
      const actions=gameState.teamActionsThisPeriod[teamName]||0;
      if(actions>=2){ socket.emit('error','2 actions déjà utilisées cette période !'); return; }
      if(resource==='oil'&&(gameState.eventMod.blockOilBelowPower||0)>0&&c.power<gameState.eventMod.blockOilBelowPower){ socket.emit('error',`Achat pétrole bloqué (boom actif) !`); return; }
    }
    const price=gameState.prices[resource]||80; const total=price*qty;
    if(c.treasury<total){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=total; c[resource]+=qty; c.power=calcPower(c);
    if(!gameState.isTutorial) gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`✅ Achat: +${qty} ${resource} pour ${total} or${gameState.isTutorial?' (tutorial)':''}`,'good');
    broadcast();
  });

  socket.on('team:sellResource', ({teamName, resource, qty})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucune vente en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    if(c[resource]<qty){ socket.emit('error','Stock insuffisant !'); return; }
    const price=gameState.prices[resource]||80; const total=price*qty;
    c[resource]-=qty; c.treasury+=total; c.power=calcPower(c);
    addTeamNews(teamName,`💰 Vente: −${qty} ${resource} → +${total} or`,'good'); broadcast();
  });

  socket.on('team:recruitArmy', ({teamName, qty, type})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun recrutement en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    if(!gameState.isTutorial){
      const actions=gameState.teamActionsThisPeriod[teamName]||0;
      if(actions>=2){ socket.emit('error','2 actions déjà utilisées !'); return; }
    }
    const costPer=type==='tech'?300:150; const powerPer=type==='tech'?50:20;
    const cost=Math.round(costPer*qty); if(c.treasury<cost){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=cost; if(type!=='tech') c.army+=qty; c.power+=qty*powerPer;
    if(!gameState.isTutorial) gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,`✅ Recrutement: +${qty*powerPer} pts pour ${cost} or${gameState.isTutorial?' (tutorial)':''}`,'good'); broadcast();
  });

  socket.on('team:buyDefense', ({teamName})=>{
    if(gameState.phase==='war'){ socket.emit('error','Aucun achat en guerre !'); return; }
    const team=gameState.teams[teamName]; if(!team||!team.country) return;
    const c=gameState.countries[team.country];
    if(!gameState.isTutorial){ const actions=gameState.teamActionsThisPeriod[teamName]||0; if(actions>=2){ socket.emit('error','2 actions déjà utilisées !'); return; } }
    if(c.treasury<200){ socket.emit('error',"Pas assez d'or !"); return; }
    c.treasury-=200; c.defense=true;
    if(!gameState.isTutorial) gameState.teamActionsThisPeriod[teamName]=(gameState.teamActionsThisPeriod[teamName]||0)+1;
    addTeamNews(teamName,'🛡️ Bunker activé !','good'); io.emit('defenseActivated',{countryId:c.id,teamName}); broadcast();
  });

  socket.on('mj:eliminate', ({countryId})=>{ const c=gameState.countries[countryId]; if(!c) return; c.eliminated=true; if(gameState.coalition.active&&(countryId==='morocco'||countryId==='guinea')){ gameState.countries.morocco.eliminated=true; gameState.countries.guinea.eliminated=true; } addLog(`☠️ ${c.flag} éliminé !`,'eliminated'); addTeamNews(c.team,'Votre nation a été conquise.','bad'); broadcast(); checkWinner(); });
  socket.on('mj:bonus', ({countryId, amount})=>{ const c=gameState.countries[countryId]; if(!c) return; c.treasury+=amount; c.power=calcPower(c); addLog(`${amount>0?'+':''}${amount} or → ${c.flag}`,amount>0?'economy':'attack'); broadcast(); });
  socket.on('mj:reset', ()=>{ if(timerInterval)clearInterval(timerInterval); if(warTurnInterval)clearInterval(warTurnInterval); timerInterval=null; warTurnInterval=null; gameState={ phase:'setup', currentPeriod:0, currentEvent:null, nextHint:null, periodSequence:[], countries:{}, takenCountries:{}, teams:{}, prices:{oil:80,food:40,tourism:120,agriculture:60}, eventMod:{oilMultiplier:1,tourismMultiplier:1,agriMultiplier:1,baseMultiplier:1,blockOilBelowPower:0,peace:false}, coalition:{proposed:false,moroccoAccepted:false,guineaAccepted:false,active:false}, alliances:{}, pendingAllianceProposals:{}, log:[], timerSeconds:600, timerRunning:false, warTurnOrder:[], warCurrentTurn:0, warTurnSeconds:30, teamActionsThisPeriod:{}, pendingChoiceEvent:null, winner:null, isTutorial:false, tutorialResources:{} }; broadcast(); io.emit('timer',{seconds:600,running:false}); });
  socket.on('team:join', ({teamName})=>{ if(!gameState.teams[teamName]) gameState.teams[teamName]={country:null,news:[]}; broadcast(); });
  socket.on('team:draftCountry', ({teamName, countryId})=>{ if(gameState.takenCountries[countryId]){ socket.emit('error','Déjà pris !'); return; } gameState.takenCountries[countryId]=teamName; gameState.teams[teamName].country=countryId; gameState.countries[countryId].team=teamName; addLog(`${gameState.countries[countryId].flag} ${gameState.countries[countryId].name} → ${teamName}`,'event'); broadcast(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Geopolitica running on port ${PORT}`));
