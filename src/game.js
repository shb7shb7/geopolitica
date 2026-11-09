'use strict';
const crypto = require('crypto');
const C = require('./config');
const COUNTRY_DATA = require('./data/countries');
const { EVENTS_BY_ID, POOLS, PERIODS } = require('./data/events');

// ─── Utilitaires ─────────────────────────────────────────────────────────
class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

const RES = C.RESOURCES;
const RES_LABEL = { oil: 'pétrole', food: 'nourriture', tourism: 'tourisme', agriculture: 'agriculture', gold: 'or' };
const UNDO_FIELDS = ['treasury', 'oil', 'food', 'tourism', 'agriculture', 'army', 'atk', 'def', 'militarySpent'];
const TEAM_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316',
  '#14b8a6', '#eab308', '#6366f1', '#f43f5e', '#10b981', '#8b5cf6', '#0ea5e9', '#d946ef', '#65a30d',
  '#fb7185', '#2dd4bf', '#facc15', '#818cf8', '#fdba74', '#a3e635', '#c084fc',
];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
const now = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const newSessionCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
const newToken = () => crypto.randomBytes(18).toString('base64url');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function parseQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > C.MAX_QTY) fail(`Quantité invalide (entier entre 1 et ${fmt(C.MAX_QTY)}).`);
  return n;
}

function cleanTeamName(name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 20) fail('Le nom d\'équipe doit faire entre 2 et 20 caractères.');
  return n;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ─── Formules ────────────────────────────────────────────────────────────
function foodNeed(c) {
  return Math.max(C.FOOD_MIN, Math.min(C.FOOD_MAX, Math.round(c.population / 5 + 5)));
}

function calcPower(c) {
  const tier = c.tier === 'B' ? C.TIER_B_BONUS : 1;
  const base =
    c.army * 20 +
    Math.max(0, c.treasury + c.militarySpent) * 0.1 +
    c.oil * 0.8 + c.tourism * 0.6 + c.agriculture * 0.5 + c.food * 1.2 +
    c.atk * 15 + c.def * 12 +
    (c.territories?.length || 0) * C.TERRITORY_POWER;
  return Math.max(0, Math.round(base * tier + (c.prestige || 0)));
}

function income(c, mult = {}) {
  const m = (k) => (mult[k] ?? 1);
  const oil = Math.round(c.oil * C.INCOME_PER_UNIT.oil * m('oil'));
  const tourism = Math.round(c.tourism * C.INCOME_PER_UNIT.tourism * m('tourism'));
  const agriculture = Math.round(c.agriculture * C.INCOME_PER_UNIT.agriculture * m('agriculture'));
  const base = Math.round((C.BASE_INCOME + c.population * 0.05) * m('base'));
  return { oil, tourism, agriculture, base, total: oil + tourism + agriculture + base };
}

function strength(c, troops, kind, bonus = 0) {
  const tier = c.tier === 'B' ? C.TIER_B_BONUS : 1;
  const tech = kind === 'atk' ? 1 + c.atk * C.ATK_PER_POINT : 1 + c.def * C.DEF_PER_POINT;
  return troops * tier * tech * (1 + bonus);
}

const roll = (rng) => 1 + (rng() * 2 - 1) * C.COMBAT_VARIANCE;

function winProbability(attStrength, defStrength, samples = 4000) {
  if (defStrength <= 0) return 1;
  if (attStrength <= 0) return 0;
  let wins = 0;
  for (let i = 0; i < samples; i++) if (attStrength * roll(Math.random) > defStrength * roll(Math.random)) wins++;
  return wins / samples;
}

function combatLosses(margin, winnerTroops, loserTroops) {
  const winnerPct = Math.min(15, Math.max(3, 15 / (1 + margin * 4)));
  const loserPct = Math.min(50, Math.max(winnerPct * 2.2, 20 + margin * 60));
  return {
    winnerLoss: Math.min(winnerTroops, Math.max(1, Math.round(winnerTroops * winnerPct / 100))),
    loserLoss: Math.min(loserTroops, Math.max(1, Math.round(loserTroops * loserPct / 100))),
  };
}

// ─── État ────────────────────────────────────────────────────────────────
function initCountries() {
  const out = {};
  for (const d of COUNTRY_DATA) {
    const c = {
      id: d.id, iso: d.iso, a2: d.a2, name: d.name, tier: d.tier, population: d.population,
      treasury: d.gold, oil: d.oil, food: d.food, tourism: d.tourism, agriculture: d.agriculture, army: d.army,
      atk: 0, def: 0, prestige: 0, militarySpent: 0,
      team: null, color: null, eliminated: false, conqueredBy: null, territories: [], fortified: false, power: 0,
    };
    c.power = calcPower(c);
    out[d.id] = c;
  }
  return out;
}

function freshState() {
  return {
    version: 2,
    phase: 'setup', // setup | draft | prosperity | negotiation | war
    sessionCode: null,
    isTutorial: false,
    tutorialSnapshot: null,
    period: 0,
    sequence: [],
    prices: { ...C.BASE_PRICES },
    prevPrices: { ...C.BASE_PRICES },
    countries: initCountries(),
    teams: {},          // nom → { token, country, color, news[] }
    actions: {},        // nom → actions utilisées cette période
    undo: {},           // nom → instantané avant le dernier achat
    choice: null,       // { eventId, opensIn, secondsLeft, answers{} }
    alliances: {},      // nom → { with, type }
    proposals: {},      // destinataire → { from, to, type, secondsLeft }
    ranking: [],
    war: null,
    timer: { seconds: C.PERIOD_SECONDS, total: C.PERIOD_SECONDS, running: false },
    paused: false,
    jobs: [],           // actions différées gérées par l'horloge
    lastTransition: null,
    gameOver: false,
    winners: [],
    winType: null,
    log: [],
  };
}

// ─── Moteur ──────────────────────────────────────────────────────────────
class Game {
  constructor({ rng = Math.random, emit = () => {}, onChange = () => {} } = {}) {
    this.rng = rng;
    this.emit = emit;          // emit(event, payload, teamName?)
    this.onChange = onChange;
    this.rotation = {};        // évite de retomber sur les mêmes événements d'une partie à l'autre
    this.state = freshState();
  }

  get s() { return this.state; }
  changed() { this.onChange(); }

  // ── Journal ────────────────────────────────────────────────────────────
  log(text, type = 'event') {
    this.s.log.unshift({ text, type, time: now() });
    if (this.s.log.length > 150) this.s.log.length = 150;
  }
  news(team, text, type = 'neutral') {
    const t = team && this.s.teams[team];
    if (!t) return;
    t.news.push({ text, type, time: now() });
    if (t.news.length > 80) t.news.splice(0, t.news.length - 80);
  }
  newsAll(text, type) { for (const name of Object.keys(this.s.teams)) this.news(name, text, type); }

  // ── Accès ──────────────────────────────────────────────────────────────
  team(name) { return this.s.teams[name] || fail('Équipe introuvable.'); }
  countryOf(name) {
    const t = this.team(name);
    if (!t.country) fail('Choisissez d\'abord une nation.');
    return this.s.countries[t.country];
  }
  aliveCountries() { return Object.values(this.s.countries).filter(c => c.team && !c.eliminated); }
  currentEvent() { return EVENTS_BY_ID[this.s.sequence[this.s.period - 1]] || null; }
  requirePhase(...phases) { if (!phases.includes(this.s.phase)) fail('Action impossible dans cette phase.'); }
  requireNotPaused() { if (this.s.paused) fail('Partie en pause : attendez le MJ.'); }
  requireAlive(c) { if (c.eliminated) fail('Votre nation est tombée.'); }
  schedule(type, seconds, extra = {}) {
    if (type === 'startTimer') this.s.jobs = this.s.jobs.filter(j => j.type !== 'startTimer');
    this.s.jobs.push({ type, in: seconds, ...extra });
  }

  // ── Séquence d'événements ──────────────────────────────────────────────
  pickEvent(period, exclude = []) {
    const pool = POOLS[period];
    const hist = this.rotation[period] || [];
    let avail = pool.filter(id => !hist.includes(id) && !exclude.includes(id));
    if (!avail.length) avail = pool.filter(id => !exclude.includes(id));
    if (!avail.length) avail = pool;
    const id = avail[Math.floor(this.rng() * avail.length)];
    this.rotation[period] = [id, ...hist.filter(x => x !== id)].slice(0, pool.length - 1);
    return id;
  }
  generateSequence() { return Array.from({ length: C.TOTAL_PERIODS }, (_, i) => this.pickEvent(i + 1)); }

  // ════════════════════════════════════════════════════════════════════════
  // MJ : déroulé de la partie
  // ════════════════════════════════════════════════════════════════════════
  reset() {
    this.state = freshState();
    this.emit('sessionEnded', {});
    this.log('Partie réinitialisée');
  }

  openRegistrations() {
    if (this.s.phase !== 'setup' && !this.s.gameOver) fail('Une partie est en cours : faites d\'abord un reset.');
    const hadTeams = Object.keys(this.s.teams).length > 0;
    this.state = freshState();
    if (hadTeams) this.emit('sessionEnded', {});
    this.s.phase = 'draft';
    this.s.sessionCode = newSessionCode();
    this.s.sequence = this.generateSequence();
    this.log(`Inscriptions ouvertes — code ${this.s.sessionCode}`);
  }

  startTutorial() {
    this.requirePhase('draft');
    if (!this.aliveCountries().length) fail('Aucune équipe n\'a encore choisi de nation.');
    this.s.tutorialSnapshot = JSON.parse(JSON.stringify(this.s.countries));
    this.s.isTutorial = true;
    this.s.phase = 'prosperity';
    this.s.period = 0;
    this.s.actions = {}; this.s.undo = {};
    this.s.timer = { seconds: C.TUTORIAL_SECONDS, total: C.TUTORIAL_SECONDS, running: true };
    this.newsAll('🎮 Manche test : achetez, vendez, essayez l\'armée. Tout sera remis à zéro ensuite.', 'neutral');
    this.log('Manche test démarrée');
  }

  startGame() {
    const fromTutorial = this.s.isTutorial;
    if (!fromTutorial) this.requirePhase('draft');
    if (!this.aliveCountries().length) fail('Aucune équipe n\'a encore choisi de nation.');
    if (fromTutorial && this.s.tutorialSnapshot) this.s.countries = this.s.tutorialSnapshot;
    this.s.tutorialSnapshot = null;
    this.s.isTutorial = false;
    this.s.phase = 'prosperity';
    this.s.period = 1;
    this.s.prices = { ...C.BASE_PRICES };
    this.s.prevPrices = { ...C.BASE_PRICES };
    this.s.actions = {}; this.s.undo = {};
    this.s.lastTransition = null;
    if (fromTutorial) this.newsAll('✅ Manche test terminée : ressources remises à zéro.', 'neutral');
    this.beginPeriod(null);
  }

  nextPeriod() {
    this.requirePhase('prosperity');
    if (this.s.isTutorial) fail('Terminez d\'abord la manche test.');
    if (this.s.period >= C.TOTAL_PERIODS) fail('Dernière période : lancez la négociation.');
    const triggered = this.finishPeriod();
    this.s.period++;
    this.beginPeriod(triggered);
  }

  startNegotiation() {
    this.requirePhase('prosperity');
    if (this.s.isTutorial || this.s.period < C.TOTAL_PERIODS) fail('La négociation arrive après la dernière période.');
    const triggered = this.finishPeriod();
    const s = this.s;
    s.phase = 'negotiation';
    s.alliances = {}; s.proposals = {};
    const alive = this.aliveCountries().sort((a, b) => b.power - a.power);
    s.ranking = alive.map((c, i) => ({ rank: i + 1, id: c.id, team: c.team, power: c.power }));
    const seconds = this.transitionSeconds(triggered, null);
    s.timer = { seconds: C.PERIOD_SECONDS, total: C.PERIOD_SECONDS, running: false };
    this.schedule('startTimer', seconds);
    this.emit('transition', { kind: 'negotiation', seconds, triggered: this.eventSummary(triggered), video: this.videoFor(triggered, null) });
    for (const r of s.ranking) {
      const n = this.allowedPartners(r.team).length;
      this.news(r.team, `🕊️ Négociation — vous êtes ${r.rank}e sur ${s.ranking.length}. ${n ? `${n} nation(s) peuvent recevoir votre proposition d'alliance.` : 'Aucune alliance possible à votre rang : attendez les propositions.'} Dernier réarmement possible (2 actions).`, 'neutral');
    }
    this.log('Phase de négociation');
  }

  startWar() {
    this.requirePhase('negotiation');
    const s = this.s;
    s.phase = 'war';
    s.proposals = {};
    s.actions = {}; s.undo = {};
    s.timer = { seconds: 0, total: 0, running: false };
    s.jobs = s.jobs.filter(j => j.type !== 'startTimer');
    s.war = { started: false, round: 0, order: [], index: 0, team: null, turnSeconds: 0, resolving: false, attacksReceived: {}, feed: [] };
    this.schedule('warBegin', C.WAR_START_DELAY);
    this.emit('transition', { kind: 'war', seconds: C.WAR_START_DELAY, nations: this.aliveCountries().length });
    this.newsAll('⚔️ La guerre est déclarée ! À votre tour : attaquer, vous fortifier ou passer.', 'bad');
    this.log('⚔️ Guerre déclarée', 'attack');
  }

  pause() { if (this.s.paused) return; this.s.paused = true; this.log('⏸️ Pause'); }
  resume() { if (!this.s.paused) return; this.s.paused = false; this.log('▶️ Reprise'); }

  timerStart() { if (this.s.timer.seconds > 0) this.s.timer.running = true; }
  timerPause() { this.s.timer.running = false; }
  timerSet(seconds) {
    const n = Number(seconds);
    if (!Number.isInteger(n) || n < 10 || n > 3600) fail('Durée invalide (10 s à 60 min).');
    this.s.timer = { seconds: n, total: n, running: false };
  }

  selectEvent(period, eventId) {
    const p = Number(period);
    if (!POOLS[p] || !POOLS[p].includes(eventId)) fail('Événement invalide pour cette période.');
    if (!this.s.sequence.length) fail('Aucune séquence en cours.');
    if (p < this.s.period) fail('Cette période est passée.');
    if (p === this.s.period && this.s.phase === 'prosperity' && !this.s.isTutorial) {
      if (this.s.choice && Object.keys(this.s.choice.answers).length) fail('Des équipes ont déjà répondu au choix en cours.');
      const ev = EVENTS_BY_ID[eventId];
      this.s.choice = ev.type === 'choice' ? { eventId, opensIn: 0, secondsLeft: C.CHOICE_SECONDS, answers: {} } : null;
      if (this.s.choice) this.emit('choiceOpen', {});
    }
    this.s.sequence[p - 1] = eventId;
    this.log(`✏️ P${p} → ${EVENTS_BY_ID[eventId].title}`);
  }

  rerollEvents() {
    if (!this.s.sequence.length) fail('Aucune séquence en cours.');
    const from = this.s.isTutorial ? 1 : this.s.period + 1;
    for (let p = from; p <= C.TOTAL_PERIODS; p++) this.s.sequence[p - 1] = this.pickEvent(p, [this.s.sequence[p - 1]]);
    this.log('🔀 Événements à venir régénérés');
  }

  kickTeam(name) {
    const t = this.team(name);
    const s = this.s;
    if (t.country) {
      const c = s.countries[t.country];
      c.team = null; c.color = null;
      if (s.phase !== 'draft') c.eliminated = true;
    }
    for (const [to, p] of Object.entries(s.proposals)) if (p.from === name || to === name) delete s.proposals[to];
    const ally = s.alliances[name];
    if (ally) delete s.alliances[ally.with];
    delete s.alliances[name];
    delete s.teams[name];
    this.emit('teamKicked', { team: name });
    this.log(`🚪 ${name} retirée de la partie`);
    if (s.war?.team === name) this.endTurn();
    this.checkWinner();
  }

  eliminate(countryId) {
    const c = this.s.countries[countryId];
    if (!c || !c.team || c.eliminated) fail('Nation invalide.');
    c.eliminated = true;
    this.news(c.team, '☠️ Votre nation a été éliminée par le MJ.', 'bad');
    this.log(`☠️ ${c.name} éliminée par le MJ`, 'eliminated');
    if (this.s.war?.team === c.team) this.endTurn();
    this.checkWinner();
  }

  bonus(countryId, amount) {
    const c = this.s.countries[countryId];
    const n = Number(amount);
    if (!c || !c.team) fail('Nation invalide.');
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 1e6) fail('Montant invalide.');
    c.treasury = Math.max(0, c.treasury + n);
    c.power = calcPower(c);
    this.news(c.team, `${n > 0 ? '🎁' : '💸'} Le MJ vous ${n > 0 ? 'accorde' : 'retire'} ${fmt(Math.abs(n))} or.`, n > 0 ? 'good' : 'bad');
    this.log(`${n > 0 ? '+' : ''}${fmt(n)} or → ${c.name}`, n > 0 ? 'economy' : 'attack');
  }

  endWarByScore() {
    if (this.s.phase !== 'war' || this.s.gameOver) fail('Aucune guerre en cours.');
    const ranked = this.aliveCountries().sort((a, b) => b.power - a.power);
    this.declareWinners(ranked.slice(0, 1), 'score');
  }

  // ════════════════════════════════════════════════════════════════════════
  // Périodes
  // ════════════════════════════════════════════════════════════════════════
  transitionSeconds(triggered, current) {
    return this.videoFor(triggered, current) ? C.VIDEO_TRANSITION_SECONDS : C.TRANSITION_SECONDS;
  }
  videoFor(triggered, current) {
    if (triggered && triggered.type !== 'choice' && triggered.video) return triggered.video;
    if (current && current.type === 'choice' && current.video) return current.video;
    return null;
  }
  eventSummary(ev) {
    return ev ? { id: ev.id, icon: ev.icon, title: ev.title, desc: ev.desc, explanation: ev.explanation, type: ev.type } : null;
  }

  beginPeriod(triggered) {
    const s = this.s;
    const ev = this.currentEvent();
    const p = PERIODS[s.period - 1];
    const seconds = this.transitionSeconds(triggered, ev);
    s.timer = { seconds: C.PERIOD_SECONDS, total: C.PERIOD_SECONDS, running: false };
    this.schedule('startTimer', seconds);
    s.choice = ev.type === 'choice' ? { eventId: ev.id, opensIn: seconds, secondsLeft: C.CHOICE_SECONDS, answers: {} } : null;
    this.emit('transition', {
      kind: 'period', period: s.period, seconds, name: p.name, desc: p.desc, hint: ev.hint,
      triggered: this.eventSummary(triggered),
      choice: ev.type === 'choice' ? this.eventSummary(ev) : null,
      video: this.videoFor(triggered, ev),
    });
    let msg = `📅 Période ${s.period} — ${p.name}\n${p.desc}`;
    if (triggered && s.lastTransition) msg += `\n\n⚡ ${triggered.title} : ${triggered.explanation}`;
    if (ev.type === 'choice') msg += `\n\n⚖️ Dilemme à venir : ${ev.title}.`;
    msg += `\n\n🔮 Indice : ${ev.hint}`;
    this.newsAll(msg, 'neutral');
    this.log(`Période ${s.period} — ${p.name} (${ev.icon} ${ev.title})`);
  }

  finishPeriod() {
    const ev = this.currentEvent();
    this.resolveChoice();
    this.applyTransition(ev);
    return ev;
  }

  applyTransition(ev) {
    const s = this.s;
    const before = { ...s.prices };
    for (const r of RES) {
      const reverted = s.prices[r] + (C.BASE_PRICES[r] - s.prices[r]) * C.MEAN_REVERT;
      s.prices[r] = Math.max(1, Math.round(reverted * (ev.prices?.[r] ?? 1)));
    }
    s.prevPrices = before;
    if (ev.type !== 'choice') this.applySpecial(ev);

    for (const c of this.aliveCountries()) {
      const need = foodNeed(c);
      if (c.food >= need) {
        c.food -= need;
      } else {
        const deficit = need - c.food;
        c.food = 0;
        const loss = deficit * C.FAMINE_LOSS_PER_UNIT;
        c.prestige -= loss;
        this.news(c.team, `⚠️ Famine : il manquait ${deficit} nourriture → −${fmt(loss)} pts.`, 'bad');
        this.log(`Famine : ${c.name} −${fmt(loss)} pts`);
      }
      if (ev.special === 'foodCrisis' && c.food < 200) {
        const loss = Math.round(calcPower(c) * 0.35);
        c.prestige -= loss;
        this.news(c.team, `🚨 Crise alimentaire : stocks sous 200 → −${fmt(loss)} pts.`, 'bad');
      }
      const inc = income(c, ev.income);
      c.treasury += inc.total;
      this.news(c.team, `💰 Revenus : +${fmt(inc.total)} or (pétrole ${fmt(inc.oil)} · tourisme ${fmt(inc.tourism)} · agriculture ${fmt(inc.agriculture)} · base ${fmt(inc.base)}) · nourriture −${need}`, 'good');
      if (!(s.actions[c.team] > 0)) {
        c.prestige -= C.INACTIVITY_PENALTY;
        this.news(c.team, `😴 Aucune action cette période : −${C.INACTIVITY_PENALTY} pts.`, 'bad');
      }
      c.power = calcPower(c);
    }
    s.actions = {}; s.undo = {};
    s.lastTransition = {
      eventId: ev.id, icon: ev.icon, title: ev.title, explanation: ev.explanation,
      changes: RES.map(r => ({ res: r, from: before[r], to: s.prices[r] })),
    };
    this.log(`⚡ ${ev.title} se déclenche`);
  }

  applySpecial(ev) {
    const alive = this.aliveCountries();
    alive.forEach(c => { c.power = calcPower(c); });
    const byPower = [...alive].sort((a, b) => a.power - b.power);
    const weakest = (n) => byPower.slice(0, n);
    const loseGold = (c, pct, why) => { const l = Math.round(c.treasury * pct); c.treasury -= l; this.news(c.team, `${why} : −${fmt(l)} or.`, 'bad'); };
    const gainGold = (c, n, why) => { c.treasury += n; this.news(c.team, `${why} : +${fmt(n)} or.`, 'good'); };

    switch (ev.special) {
      case 'agriBoost':
        alive.forEach(c => { const g = Math.round(c.food * 0.25); c.food += g; this.news(c.team, `🌾 Superproduction : +${fmt(g)} nourriture.`, 'good'); });
        break;
      case 'oilCrash':
        alive.filter(c => c.oil > 200).forEach(c => loseGold(c, 0.2, '💥 Effondrement pétrolier'));
        break;
      case 'sanctions':
        alive.filter(c => c.tier === 'S' || c.tier === 'A').forEach(c => loseGold(c, 0.15, '⚠️ Sanctions du G20'));
        weakest(4).forEach(c => gainGold(c, 1500, '💰 Aide compensatoire'));
        break;
      case 'revolution':
        byPower.slice(0, Math.floor(byPower.length / 2)).forEach(c => gainGold(c, 1000, '✊ Révolution populaire'));
        byPower.slice(-3).forEach(c => loseGold(c, 0.1, '✊ Les élites vacillent'));
        break;
      case 'imf':
        weakest(4).forEach(c => { c.treasury += 1500; c.army += 70; this.news(c.team, '🏦 Plan du FMI : +1 500 or et +70 soldats.', 'good'); });
        break;
      case 'uprising':
        alive.forEach(c => {
          if (c.tier === 'B') { const g = Math.round(c.army * 0.15); c.army += g; this.news(c.team, `✊ Soulèvement : +${fmt(g)} soldats.`, 'good'); }
          if (c.tier === 'S') { const l = Math.round(c.army * 0.2); c.army -= l; this.news(c.team, `✊ Désertions : −${fmt(l)} soldats.`, 'bad'); }
        });
        break;
      case 'tourismCrisis':
        alive.forEach(c => {
          if (c.tourism > 200) loseGold(c, 0.15, '✈️ Crise du tourisme');
          else if (c.tourism < 70) gainGold(c, 1000, '✈️ Report des touristes');
        });
        break;
      case 'disaster': {
        const d = ev.disaster;
        shuffle(alive, this.rng).slice(0, d.count).forEach(c => {
          const l = Math.round(c.food * d.foodLoss);
          c.food -= l;
          c.prestige += d.prestige;
          this.news(c.team, `${ev.icon} ${ev.title} : −${fmt(l)} nourriture et ${fmt(d.prestige)} pts.`, 'bad');
          this.log(`${ev.icon} ${ev.title} frappe ${c.name}`);
        });
        break;
      }
      default: break;
    }
    alive.forEach(c => { c.power = calcPower(c); });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Événements à choix
  // ════════════════════════════════════════════════════════════════════════
  answerChoice(team, option) {
    this.requireNotPaused();
    const ch = this.s.choice;
    if (!ch) fail('Aucun choix en cours.');
    if (ch.opensIn > 0) fail('Le choix n\'est pas encore ouvert.');
    if (ch.answers[team]) fail('Vous avez déjà répondu.');
    if (option !== 'A' && option !== 'B') fail('Option invalide.');
    const c = this.countryOf(team);
    this.requireAlive(c);
    this.applyChoice(c, option, false);
  }

  applyChoice(c, option, auto) {
    const ch = this.s.choice;
    const ev = EVENTS_BY_ID[ch.eventId];
    const opt = ev.choices[option];
    const parts = [];
    let partial = false;
    for (const [res, amount] of Object.entries(opt.cost || {})) {
      const field = res === 'gold' ? 'treasury' : res;
      if (c[field] < amount) {
        parts.push(`stock de ${RES_LABEL[res]} insuffisant : ${fmt(c[field])} perdu`);
        c[field] = 0;
        partial = true;
      } else {
        c[field] -= amount;
        parts.push(`−${fmt(amount)} ${RES_LABEL[res]}`);
      }
    }
    if (partial) {
      parts.push('aucun gain');
    } else {
      if (opt.prestige) { c.prestige += opt.prestige; parts.push(`${opt.prestige > 0 ? '+' : ''}${fmt(opt.prestige)} pts`); }
      if (opt.army) { c.army += opt.army; parts.push(`+${opt.army} soldats`); }
      if (opt.risk) {
        if (this.rng() < opt.risk.chance) {
          if (opt.risk.gold) c.treasury = Math.max(0, c.treasury + opt.risk.gold);
          if (opt.risk.prestige) c.prestige += opt.risk.prestige;
          parts.push(`pas de chance : ${[opt.risk.gold && `${fmt(opt.risk.gold)} or`, opt.risk.prestige && `${fmt(opt.risk.prestige)} pts`].filter(Boolean).join(' et ')}`);
        } else {
          parts.push('vous vous en sortez sans dommage');
        }
      }
    }
    ch.answers[c.team] = option;
    delete this.s.undo[c.team];
    c.power = calcPower(c);
    this.news(c.team, `${auto ? '⏰ Pas de réponse : option B appliquée. ' : ''}${ev.icon} ${ev.title} — « ${opt.label} » : ${parts.join(' · ')}.`, partial || auto ? 'bad' : 'neutral');
    this.log(`${c.name} : ${ev.title} → ${option}${auto ? ' (auto)' : ''}`);
  }

  resolveChoice() {
    const ch = this.s.choice;
    if (!ch) return;
    for (const c of this.aliveCountries()) if (!ch.answers[c.team]) this.applyChoice(c, 'B', true);
    this.s.choice = null;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Équipes
  // ════════════════════════════════════════════════════════════════════════
  joinTeam(rawName, code) {
    if (this.s.phase !== 'draft') fail('Les inscriptions sont fermées.');
    if (String(code ?? '').trim().toUpperCase() !== this.s.sessionCode) fail('Code de session invalide.');
    const name = cleanTeamName(rawName);
    if (Object.keys(this.s.teams).some(n => n.toLowerCase() === name.toLowerCase())) fail('Ce nom est déjà pris.');
    if (Object.keys(this.s.teams).length >= COUNTRY_DATA.length) fail('La partie est complète.');
    const token = newToken();
    this.s.teams[name] = { token, country: null, color: null, news: [] };
    this.log(`👥 ${name} a rejoint la partie`);
    return { teamName: name, token };
  }

  verifyTeam(name, token) {
    const t = this.s.teams[name];
    if (!t || !token || !safeEqual(t.token, token)) fail('Session introuvable ou expirée.');
    return name;
  }

  draftCountry(team, countryId) {
    this.requirePhase('draft');
    const t = this.team(team);
    if (t.country) fail('Vous avez déjà choisi une nation.');
    const c = this.s.countries[countryId];
    if (!c) fail('Nation inconnue.');
    if (c.team) fail('Cette nation est déjà prise.');
    const used = new Set(Object.values(this.s.teams).map(x => x.color));
    const color = TEAM_COLORS.find(col => !used.has(col)) || TEAM_COLORS[0];
    c.team = team; c.color = color;
    t.country = c.id; t.color = color;
    this.news(team, `🏳️ Vous dirigez désormais : ${c.name}.`, 'good');
    this.log(`${c.name} → ${team}`);
    this.emit('countryDrafted', { team, countryId: c.id });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Économie
  // ════════════════════════════════════════════════════════════════════════
  tradeCountry(team) {
    this.requireNotPaused();
    if (this.s.phase !== 'prosperity') fail('Le marché est fermé.');
    const c = this.countryOf(team);
    this.requireAlive(c);
    return c;
  }
  militaryCountry(team) {
    this.requireNotPaused();
    const s = this.s;
    if (s.phase !== 'prosperity' && s.phase !== 'negotiation') fail('Les achats militaires sont fermés.');
    if (s.phase === 'prosperity' && !s.isTutorial && s.period < C.MILITARY_UNLOCK_PERIOD) fail(`L'armée se débloque en période ${C.MILITARY_UNLOCK_PERIOD}.`);
    const c = this.countryOf(team);
    this.requireAlive(c);
    return c;
  }
  requireAction(team) {
    if (this.s.isTutorial) return;
    if ((this.s.actions[team] || 0) >= C.ACTIONS_PER_PERIOD) fail(`Vos ${C.ACTIONS_PER_PERIOD} actions sont déjà utilisées.`);
  }
  spendAction(team, c) {
    this.s.undo[team] = Object.fromEntries(UNDO_FIELDS.map(f => [f, c[f]]));
    if (!this.s.isTutorial) this.s.actions[team] = (this.s.actions[team] || 0) + 1;
  }
  sellPrice(resource) { return Math.max(1, Math.floor(this.s.prices[resource] * C.SELL_RATIO)); }

  buy(team, resource, qty) {
    const c = this.tradeCountry(team);
    if (!RES.includes(resource)) fail('Ressource inconnue.');
    const n = parseQty(qty);
    this.requireAction(team);
    const total = this.s.prices[resource] * n;
    if (c.treasury < total) fail(`Pas assez d'or : ${fmt(total)} requis.`);
    const snapshot = { ...c };
    c.treasury -= total;
    c[resource] += n;
    this.spendAction(team, snapshot);
    c.power = calcPower(c);
    this.news(team, `🛒 Achat : +${fmt(n)} ${RES_LABEL[resource]} pour ${fmt(total)} or.`, 'good');
    return { total };
  }

  sell(team, resource, qty) {
    const c = this.tradeCountry(team);
    if (!RES.includes(resource)) fail('Ressource inconnue.');
    const n = parseQty(qty);
    if (c[resource] < n) fail('Stock insuffisant.');
    const total = this.sellPrice(resource) * n;
    c[resource] -= n;
    c.treasury += total;
    delete this.s.undo[team];
    c.power = calcPower(c);
    this.news(team, `💱 Vente : −${fmt(n)} ${RES_LABEL[resource]} pour ${fmt(total)} or.`, 'good');
    return { total };
  }

  invest(team, kind, qty) {
    const c = this.militaryCountry(team);
    const n = parseQty(qty);
    this.requireAction(team);
    const unit = { soldiers: C.SOLDIER_COST, atk: C.ATK_COST, def: C.DEF_COST }[kind];
    if (!unit) fail('Investissement inconnu.');
    const total = unit * n;
    if (c.treasury < total) fail(`Pas assez d'or : ${fmt(total)} requis.`);
    const snapshot = { ...c };
    c.treasury -= total;
    c.militarySpent += total;
    if (kind === 'soldiers') c.army += n; else c[kind] += n;
    this.spendAction(team, snapshot);
    c.power = calcPower(c);
    const label = { soldiers: 'soldats', atk: 'ATK', def: 'DEF' }[kind];
    this.news(team, `🪖 Investissement : +${fmt(n)} ${label} pour ${fmt(total)} or.`, 'good');
    return { total };
  }

  undo(team) {
    this.requireNotPaused();
    this.requirePhase('prosperity', 'negotiation');
    const snap = this.s.undo[team];
    if (!snap) fail('Aucune action à annuler.');
    const c = this.countryOf(team);
    Object.assign(c, snap);
    c.power = calcPower(c);
    if (!this.s.isTutorial) this.s.actions[team] = Math.max(0, (this.s.actions[team] || 0) - 1);
    delete this.s.undo[team];
    this.news(team, '↩️ Dernier achat annulé.', 'neutral');
  }

  // ════════════════════════════════════════════════════════════════════════
  // Diplomatie
  // ════════════════════════════════════════════════════════════════════════
  // Rang r peut proposer aux r dernières nations du classement : les leaders ont peu d'options.
  allowedPartners(team) {
    const r = this.s.ranking;
    const me = r.find(x => x.team === team);
    if (!me) return [];
    const minRank = r.length - me.rank + 1;
    return r.filter(x => x.rank >= minRank && x.team !== team && this.s.teams[x.team] && !this.s.countries[x.id].eliminated).map(x => x.team);
  }

  proposeAlliance(from, to, type) {
    this.requireNotPaused();
    this.requirePhase('negotiation');
    const s = this.s;
    if (type !== 'peace' && type !== 'offensive') fail('Type d\'alliance invalide.');
    const me = this.countryOf(from);
    this.requireAlive(me);
    this.team(to);
    if (from === to) fail('Choisissez une autre nation.');
    if (s.alliances[from]) fail('Vous avez déjà une alliance.');
    if (s.alliances[to]) fail('Cette nation a déjà une alliance.');
    if (!this.allowedPartners(from).includes(to)) fail('Votre rang ne vous permet pas de proposer à cette nation.');
    if (s.proposals[to]) fail('Cette nation examine déjà une autre proposition.');
    if (Object.values(s.proposals).some(p => p.from === from)) fail('Vous avez déjà une proposition en attente.');
    if (type === 'offensive' && me.treasury < C.OFFENSIVE_ALLIANCE_COST) fail(`Il faut ${C.OFFENSIVE_ALLIANCE_COST} or pour une alliance offensive.`);
    s.proposals[to] = { from, to, type, secondsLeft: C.PROPOSAL_SECONDS };
    this.news(to, `🤝 ${me.name} vous propose une alliance ${type === 'peace' ? 'de non-agression' : 'offensive'}.`, 'neutral');
    this.emit('allianceProposal', { from, type }, to);
  }

  respondAlliance(to, accept) {
    this.requireNotPaused();
    this.requirePhase('negotiation');
    const s = this.s;
    const p = s.proposals[to];
    if (!p) fail('Proposition expirée.');
    delete s.proposals[to];
    const from = s.teams[p.from] && this.s.countries[s.teams[p.from].country];
    const me = this.countryOf(to);
    if (!from) fail('Cette équipe a quitté la partie.');
    if (!accept) {
      this.news(p.from, `❌ ${me.name} a refusé votre alliance.`, 'bad');
      this.emit('allianceAnswer', { accepted: false, by: to }, p.from);
      return;
    }
    if (s.alliances[p.from] || s.alliances[to]) fail('Une des deux nations est déjà alliée.');
    if (p.type === 'offensive') {
      if (from.treasury < C.OFFENSIVE_ALLIANCE_COST) fail(`${from.name} n'a plus assez d'or.`);
      from.treasury -= C.OFFENSIVE_ALLIANCE_COST;
      from.power = calcPower(from);
    }
    s.alliances[p.from] = { with: to, type: p.type };
    s.alliances[to] = { with: p.from, type: p.type };
    const label = p.type === 'peace' ? 'de non-agression' : 'offensive';
    this.news(p.from, `✅ ${me.name} accepte votre alliance ${label} !`, 'good');
    this.news(to, `✅ Alliance ${label} conclue avec ${from.name}.`, 'good');
    this.emit('allianceAnswer', { accepted: true, by: to, type: p.type }, p.from);
    this.log(`🤝 Alliance ${label} : ${from.name} & ${me.name}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Guerre
  // ════════════════════════════════════════════════════════════════════════
  warBegin() {
    const w = this.s.war;
    if (!w || w.started) return;
    w.started = true;
    this.newRound();
  }

  newRound() {
    const w = this.s.war;
    w.round++;
    if (w.round > C.WAR_MAX_ROUNDS) {
      this.log(`Fin des ${C.WAR_MAX_ROUNDS} manches : victoire à la puissance`);
      const ranked = this.aliveCountries().sort((a, b) => b.power - a.power);
      return this.declareWinners(ranked.slice(0, 1), 'score');
    }
    w.order = shuffle(this.aliveCountries().map(c => c.team), this.rng);
    w.index = 0;
    this.log(`Manche ${w.round}/${C.WAR_MAX_ROUNDS}`);
    this.startTurn();
  }

  startTurn() {
    const s = this.s, w = s.war;
    if (!w || s.gameOver) return;
    while (w.index < w.order.length) {
      const t = s.teams[w.order[w.index]];
      if (t && t.country && !s.countries[t.country].eliminated) break;
      w.index++;
    }
    if (w.index >= w.order.length) return this.newRound();
    const team = w.order[w.index];
    const c = this.countryOf(team);
    c.fortified = false;
    w.team = team;
    w.turnSeconds = C.WAR_TURN_SECONDS;
    w.resolving = false;
    this.news(team, '⚔️ C\'est votre tour !', 'neutral');
    this.emit('warTurn', { team });
  }

  endTurn() {
    const w = this.s.war;
    if (!w || !w.started || this.s.gameOver) return;
    this.s.jobs = this.s.jobs.filter(j => j.type !== 'endTurn');
    w.index++;
    this.startTurn();
  }

  requireMyTurn(team) {
    this.requireNotPaused();
    const s = this.s, w = s.war;
    if (s.phase !== 'war' || !w) fail('Pas encore en guerre.');
    if (s.gameOver) fail('La partie est terminée.');
    if (!w.started) fail('La guerre n\'a pas encore commencé.');
    if (w.team !== team || w.resolving) fail('Ce n\'est pas votre tour.');
    return w;
  }

  attackPreview(team, targetId, commit) {
    const att = this.countryOf(team);
    const def = this.s.countries[targetId];
    if (!def || !def.team || def.eliminated || def.id === att.id) fail('Cible invalide.');
    const ratio = C.COMMIT_OPTIONS.includes(Number(commit)) ? Number(commit) : 1;
    const engaged = Math.max(0, Math.round(att.army * ratio));
    const attBonus = this.s.alliances[team]?.type === 'offensive' ? C.OFFENSIVE_ALLIANCE_BONUS : 0;
    const a = strength(att, engaged, 'atk', attBonus);
    const d = strength(def, def.army, 'def', def.fortified ? C.FORTIFY_BONUS : 0);
    return {
      probability: Math.round(winProbability(a, d) * 100),
      attStrength: Math.round(a), defStrength: Math.round(d), engaged,
      firstAssault: !(this.s.war?.attacksReceived?.[def.id] > 0),
      allied: this.s.alliances[team]?.with === def.team,
    };
  }

  attack(team, { targetId, payWith, commit } = {}) {
    const w = this.requireMyTurn(team);
    const s = this.s;
    const att = this.countryOf(team);
    const def = s.countries[targetId];
    if (!def || !def.team || def.eliminated || def.id === att.id) fail('Cible invalide.');
    if (s.alliances[team]?.with === def.team) fail('Vous êtes allié avec cette nation.');
    if (att.army < 1) fail('Vous n\'avez plus de soldats.');

    const pay = ['gold', 'oil', 'food'].includes(payWith) ? payWith : 'gold';
    const field = pay === 'gold' ? 'treasury' : pay;
    const cost = C.ATTACK_COSTS[pay];
    let sacrificed = 0;
    if (att[field] >= cost) {
      att[field] -= cost;
    } else {
      if (pay !== 'gold') fail(`Pas assez de ${RES_LABEL[pay]} (${cost} requis).`);
      sacrificed = Math.max(5, Math.round(att.army * C.NO_RESOURCE_SACRIFICE));
      if (att.army <= sacrificed) fail('Ni or ni troupes suffisantes pour attaquer.');
      att.army -= sacrificed;
    }

    const ratio = C.COMMIT_OPTIONS.includes(Number(commit)) ? Number(commit) : 1;
    const engaged = Math.max(1, Math.round(att.army * ratio));
    const attBonus = s.alliances[team]?.type === 'offensive' ? C.OFFENSIVE_ALLIANCE_BONUS : 0;
    const scoreAtt = strength(att, engaged, 'atk', attBonus) * roll(this.rng);
    const scoreDef = strength(def, def.army, 'def', def.fortified ? C.FORTIFY_BONUS : 0) * roll(this.rng);
    const success = scoreAtt > scoreDef;
    const margin = success ? (scoreAtt - scoreDef) / Math.max(1, scoreDef) : (scoreDef - scoreAtt) / Math.max(1, scoreAtt);
    const losses = combatLosses(margin, success ? engaged : def.army, success ? def.army : engaged);
    const lossAtt = success ? losses.winnerLoss : losses.loserLoss;
    const lossDef = success ? losses.loserLoss : losses.winnerLoss;
    att.army = Math.max(0, att.army - lossAtt);
    def.army = Math.max(0, def.army - lossDef);

    const first = !(w.attacksReceived[def.id] > 0);
    w.attacksReceived[def.id] = (w.attacksReceived[def.id] || 0) + 1;
    let outcome, loot = {};

    if (success && first) {
      outcome = 'raid';
      const r = C.FIRST_ASSAULT_LOOT;
      loot = {
        treasury: Math.round(def.treasury * r), oil: Math.round(def.oil * r), food: Math.round(def.food * r),
        tourism: Math.round(def.tourism * r / 2), agriculture: Math.round(def.agriculture * r / 2),
      };
      for (const [k, v] of Object.entries(loot)) { att[k] += v; def[k] -= v; }
      def.prestige -= Math.round(calcPower(def) * 0.3);
    } else if (success) {
      outcome = 'conquest';
      loot = {
        treasury: def.treasury, oil: def.oil, food: def.food,
        tourism: Math.round(def.tourism / 2), agriculture: Math.round(def.agriculture / 2),
        army: Math.round(def.army / 2), atk: Math.round(def.atk * 0.3), def: Math.round(def.def * 0.3),
      };
      for (const [k, v] of Object.entries(loot)) att[k] += v;
      Object.assign(def, { treasury: 0, oil: 0, food: 0, tourism: 0, agriculture: 0, army: 0, atk: 0, def: 0, militarySpent: 0 });
      def.eliminated = true;
      def.conqueredBy = att.id;
      for (const id of def.territories) s.countries[id].conqueredBy = att.id;
      att.territories.push(def.id, ...def.territories);
      def.territories = [];
      const ally = s.alliances[def.team];
      if (ally) { delete s.alliances[ally.with]; delete s.alliances[def.team]; }
    } else {
      outcome = 'repelled';
      const l = Math.round(att.treasury * 0.25);
      att.treasury -= l;
      loot = { lostGold: l };
    }
    att.power = calcPower(att);
    def.power = calcPower(def);

    const result = {
      round: w.round, attacker: att.id, defender: def.id, outcome,
      scoreAtt: Math.round(scoreAtt), scoreDef: Math.round(scoreDef),
      engaged, lossAtt, lossDef, sacrificed, loot,
    };
    w.feed.unshift(result);
    if (w.feed.length > 30) w.feed.length = 30;
    w.resolving = true;

    const lootTxt = `${fmt(loot.treasury || 0)} or, ${fmt(loot.oil || 0)} pétrole, ${fmt(loot.food || 0)} nourriture`;
    if (outcome === 'raid') {
      this.news(att.team, `⚔️ Premier assaut réussi sur ${def.name} ! Butin : ${lootTxt}. Pertes : ${fmt(lossAtt)} soldats. Un second assaut l'annexera.`, 'good');
      this.news(def.team, `💥 ${att.name} vous a pillé : −${lootTxt}, −${fmt(lossDef)} soldats. Vous survivez, mais le prochain assaut réussi sera fatal.`, 'bad');
      this.log(`⚔️ ${att.name} pille ${def.name}`, 'attack');
    } else if (outcome === 'conquest') {
      this.news(att.team, `🏴 ${def.name} est annexée ! Butin : ${lootTxt} et ${fmt(loot.army)} soldats ralliés.`, 'good');
      this.news(def.team, `☠️ ${att.name} a annexé votre nation.`, 'bad');
      this.log(`🏴 ${att.name} annexe ${def.name}`, 'eliminated');
    } else {
      this.news(att.team, `🛡️ ${def.name} a repoussé votre attaque : −${fmt(lossAtt)} soldats, −${fmt(loot.lostGold)} or de frais de guerre.`, 'bad');
      this.news(def.team, `🛡️ Vous avez repoussé ${att.name} ! Pertes : ${fmt(lossDef)} soldats.`, 'good');
      this.log(`🛡️ ${def.name} repousse ${att.name}`, 'attack');
    }
    this.emit('attackResult', result);
    this.checkWinner();
    if (!s.gameOver) this.schedule('endTurn', C.ATTACK_RESOLVE_DELAY, { key: `${w.round}:${w.index}` });
    return result;
  }

  fortify(team) {
    const w = this.requireMyTurn(team);
    const c = this.countryOf(team);
    c.fortified = true;
    w.resolving = true;
    w.feed.unshift({ round: w.round, attacker: c.id, outcome: 'fortify' });
    this.news(team, `🏰 Fortifié : +${Math.round(C.FORTIFY_BONUS * 100)} % de défense jusqu'à votre prochain tour.`, 'good');
    this.log(`🏰 ${c.name} se fortifie`);
    this.schedule('endTurn', 2, { key: `${w.round}:${w.index}` });
  }

  skipTurn(team) {
    this.requireMyTurn(team);
    this.news(team, 'Tour passé.', 'neutral');
    this.endTurn();
  }

  mjNextTurn() {
    if (this.s.phase !== 'war' || !this.s.war?.started || this.s.gameOver) fail('Aucun tour en cours.');
    this.endTurn();
  }

  checkWinner() {
    if (this.s.gameOver || this.s.phase !== 'war') return;
    const alive = this.aliveCountries();
    if (alive.length === 1) return this.declareWinners(alive, 'solo');
    if (alive.length === 2) {
      const [a, b] = alive;
      const al = this.s.alliances[a.team];
      if (al && al.type === 'peace' && al.with === b.team) return this.declareWinners(alive, 'alliance');
    }
  }

  declareWinners(list, type) {
    const s = this.s;
    s.gameOver = true;
    s.winners = list.map(c => c.id);
    s.winType = type;
    s.jobs = [];
    if (s.war) { s.war.team = null; s.war.resolving = false; }
    s.timer.running = false;
    const names = list.map(c => c.name).join(' & ');
    this.log(`🏆 Victoire : ${names || 'personne'}`, 'event');
    this.newsAll(`🏆 Fin de la partie — victoire de ${names || 'personne'} !`, 'neutral');
    this.emit('winner', { winners: s.winners, type });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Horloge : appelée chaque seconde par le serveur
  // ════════════════════════════════════════════════════════════════════════
  tick() {
    const s = this.s;
    if (s.paused) return;
    let dirty = false;

    if (s.jobs.length) {
      const due = [];
      for (const j of s.jobs) { j.in--; if (j.in <= 0) due.push(j); }
      if (due.length) {
        s.jobs = s.jobs.filter(j => j.in > 0);
        for (const j of due) this.runJob(j);
        dirty = true;
      }
    }

    if (s.timer.running) {
      s.timer.seconds = Math.max(0, s.timer.seconds - 1);
      if (s.timer.seconds === 0) { s.timer.running = false; this.emit('timerEnded', {}); dirty = true; }
    }

    const ch = s.choice;
    if (ch) {
      if (ch.opensIn > 0) {
        ch.opensIn--;
        if (ch.opensIn === 0) { this.emit('choiceOpen', {}); dirty = true; }
      } else if (ch.secondsLeft > 0) {
        ch.secondsLeft--;
        if (ch.secondsLeft === 0) { this.resolveChoice(); dirty = true; }
      }
    }

    const w = s.war;
    if (w && w.started && w.team && !w.resolving && !s.gameOver) {
      w.turnSeconds--;
      if (w.turnSeconds <= 0) {
        this.news(w.team, '⏰ Temps écoulé : tour passé.', 'bad');
        this.endTurn();
        dirty = true;
      }
    }

    for (const [to, p] of Object.entries(s.proposals)) {
      if (--p.secondsLeft <= 0) {
        delete s.proposals[to];
        const c = s.teams[to] && s.countries[s.teams[to].country];
        this.news(p.from, `⌛ ${c ? c.name : to} n'a pas répondu à votre proposition.`, 'bad');
        this.emit('allianceExpired', {}, to);
        dirty = true;
      }
    }

    this.emit('clock', this.clock());
    if (dirty) this.changed();
  }

  runJob(j) {
    const s = this.s;
    if (j.type === 'startTimer') {
      if ((s.phase === 'prosperity' || s.phase === 'negotiation') && !s.gameOver && s.timer.seconds > 0) s.timer.running = true;
    } else if (j.type === 'warBegin') {
      if (s.phase === 'war') this.warBegin();
    } else if (j.type === 'endTurn') {
      if (s.war && `${s.war.round}:${s.war.index}` === j.key) this.endTurn();
    }
  }

  clock() {
    const s = this.s;
    return {
      timer: s.timer,
      war: s.war ? { team: s.war.team, seconds: s.war.turnSeconds, resolving: s.war.resolving } : null,
      choice: s.choice ? { opensIn: s.choice.opensIn, secondsLeft: s.choice.secondsLeft } : null,
      paused: s.paused,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Vues : ce que chaque rôle a le droit de voir
  // ════════════════════════════════════════════════════════════════════════
  publicChoice() {
    const ch = this.s.choice;
    if (!ch) return null;
    const ev = EVENTS_BY_ID[ch.eventId];
    return {
      eventId: ev.id, icon: ev.icon, title: ev.title, desc: ev.desc,
      options: { A: { label: ev.choices.A.label, detail: ev.choices.A.detail, cost: ev.choices.A.cost || {} }, B: { label: ev.choices.B.label, detail: ev.choices.B.detail, cost: ev.choices.B.cost || {} } },
      opensIn: ch.opensIn, secondsLeft: ch.secondsLeft, answered: Object.keys(ch.answers).length,
    };
  }

  publicView() {
    const s = this.s;
    const ev = this.currentEvent();
    const p = PERIODS[s.period - 1];
    let periodInfo = null;
    if (s.isTutorial) periodInfo = { name: 'Manche test', desc: 'Découvrez l\'interface : actions illimitées, tout sera remis à zéro.', hint: EVENTS_BY_ID[s.sequence[0]]?.hint || null };
    else if (s.phase === 'prosperity' && p) periodInfo = { name: p.name, desc: p.desc, hint: ev?.hint || null, isChoice: ev?.type === 'choice' };

    const countries = {};
    for (const c of Object.values(s.countries)) {
      const { prestige, militarySpent, ...pub } = c; // eslint-disable-line no-unused-vars
      countries[c.id] = pub;
    }
    const w = s.war;
    return {
      phase: s.phase, isTutorial: s.isTutorial, period: s.period, totalPeriods: C.TOTAL_PERIODS,
      sessionCode: s.phase === 'draft' ? s.sessionCode : null,
      periodInfo,
      lastTransition: s.phase === 'prosperity' ? s.lastTransition : null,
      prices: s.prices, prevPrices: s.prevPrices,
      sellPrices: Object.fromEntries(RES.map(r => [r, this.sellPrice(r)])),
      militaryOpen: s.isTutorial || s.phase === 'negotiation' || (s.phase === 'prosperity' && s.period >= C.MILITARY_UNLOCK_PERIOD),
      countries,
      teams: Object.entries(s.teams).map(([name, t]) => ({ name, country: t.country, color: t.color })),
      actions: s.actions,
      alliances: s.alliances,
      ranking: s.ranking,
      war: w ? {
        started: w.started, round: w.round, maxRounds: C.WAR_MAX_ROUNDS, order: w.order, index: w.index,
        team: w.team, turnSeconds: w.turnSeconds, resolving: w.resolving, attacksReceived: w.attacksReceived, feed: w.feed.slice(0, 12),
      } : null,
      timer: s.timer, paused: s.paused,
      choice: this.publicChoice(),
      gameOver: s.gameOver, winners: s.winners, winType: s.winType,
    };
  }

  meView(name) {
    const s = this.s;
    const t = s.teams[name];
    if (!t) return null;
    const inc = s.proposals[name];
    const out = Object.values(s.proposals).find(p => p.from === name);
    return {
      name, country: t.country, color: t.color,
      news: t.news.slice(-60),
      actionsUsed: s.actions[name] || 0,
      canUndo: !!s.undo[name],
      choiceAnswer: s.choice?.answers[name] || null,
      proposalIn: inc ? { from: inc.from, type: inc.type, secondsLeft: inc.secondsLeft } : null,
      proposalOut: out ? { to: out.to, type: out.type, secondsLeft: out.secondsLeft } : null,
      partners: s.phase === 'negotiation' ? this.allowedPartners(name) : [],
      foodNeed: t.country ? foodNeed(s.countries[t.country]) : 0,
      expectedIncome: t.country ? income(s.countries[t.country]).total : 0,
    };
  }

  mjView(pub = this.publicView()) {
    const s = this.s;
    const ev = this.currentEvent();
    let nextPrices = null;
    if (ev && s.phase === 'prosperity' && !s.isTutorial) {
      nextPrices = {};
      for (const r of RES) nextPrices[r] = Math.max(1, Math.round((s.prices[r] + (C.BASE_PRICES[r] - s.prices[r]) * C.MEAN_REVERT) * (ev.prices?.[r] ?? 1)));
    }
    const summary = (id) => { const e = EVENTS_BY_ID[id]; return { id, icon: e.icon, title: e.title, type: e.type, effect: e.effect, hint: e.hint }; };
    return {
      ...pub,
      sessionCode: s.sessionCode,
      sequence: s.sequence.map(summary),
      pools: Object.fromEntries(Object.entries(POOLS).map(([p, ids]) => [p, ids.map(summary)])),
      currentEvent: ev ? summary(ev.id) : null,
      nextPrices,
      choiceAnswers: s.choice?.answers || null,
      lastTransition: s.lastTransition,
      prestige: Object.fromEntries(Object.values(s.countries).filter(c => c.team).map(c => [c.id, c.prestige])),
      teamsDetail: Object.entries(s.teams).map(([name, t]) => ({ name, country: t.country, color: t.color })),
      log: s.log.slice(0, 80),
    };
  }

  // ── Sauvegarde ─────────────────────────────────────────────────────────
  serialize() { return { state: this.s, rotation: this.rotation }; }

  load(data) {
    if (!data || !data.state || data.state.version !== 2) return false;
    this.state = data.state;
    this.rotation = data.rotation || {};
    const s = this.s;
    s.timer.running = false;
    if (['prosperity', 'negotiation', 'war'].includes(s.phase) && !s.gameOver) s.paused = true;
    return true;
  }
}

module.exports = { Game, GameError, calcPower, income, foodNeed, strength, winProbability, combatLosses, safeEqual };
