'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/config');
const { Game, GameError, calcPower } = require('../src/game');

function seeded(seed = 42) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

function setup(teams = ['Alpha', 'Bravo', 'Charlie'], countries = ['france', 'usa', 'niger']) {
  const events = [];
  const g = new Game({ rng: seeded(), emit: (e, p, t) => events.push({ e, p, t }) });
  g.openRegistrations();
  const code = g.state.sessionCode;
  teams.forEach((t, i) => { g.joinTeam(t, code); g.draftCountry(t, countries[i]); });
  return { g, events };
}

const throwsGame = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));

test('quantités négatives, décimales ou absurdes refusées', () => {
  const { g } = setup();
  g.startGame();
  for (const q of [-1000, 0, 1.5, '1e9', NaN, null, 'abc', 1e7]) {
    throwsGame(() => g.buy('Alpha', 'oil', q), /Quantité/);
    throwsGame(() => g.sell('Alpha', 'oil', q), /Quantité/);
  }
  g.state.period = 5;
  throwsGame(() => g.invest('Alpha', 'soldiers', -1000), /Quantité/);
});

test('ressources inconnues refusées (plus de vente d\'or contre de l\'or)', () => {
  const { g } = setup();
  g.startGame();
  throwsGame(() => g.sell('Alpha', 'treasury', 1), /Ressource/);
  throwsGame(() => g.buy('Alpha', 'army', 1), /Ressource/);
  throwsGame(() => g.buy('Alpha', '__proto__', 1), /Ressource/);
});

test('2 actions max par période, vente libre au prix réduit', () => {
  const { g } = setup();
  g.startGame();
  g.buy('Alpha', 'food', 1);
  g.buy('Alpha', 'food', 1);
  throwsGame(() => g.buy('Alpha', 'food', 1), /actions/);
  const before = g.state.countries.france.treasury;
  g.sell('Alpha', 'food', 1);
  assert.equal(g.state.countries.france.treasury - before, Math.floor(C.BASE_PRICES.food * C.SELL_RATIO));
});

test('armée verrouillée avant la période 5', () => {
  const { g } = setup();
  g.startGame();
  throwsGame(() => g.invest('Alpha', 'soldiers', 1), /période 5/);
  g.state.period = 5;
  g.invest('Alpha', 'soldiers', 2);
  assert.equal(g.state.countries.france.army, 217);
});

test('annuler restaure exactement et rend l\'action', () => {
  const { g } = setup();
  g.startGame();
  const snap = { ...g.state.countries.france };
  g.buy('Alpha', 'oil', 3);
  g.undo('Alpha');
  assert.equal(g.state.countries.france.treasury, snap.treasury);
  assert.equal(g.state.countries.france.oil, snap.oil);
  assert.equal(g.state.actions.Alpha, 0);
  throwsGame(() => g.undo('Alpha'), /Aucune/);
});

test('une vente après un achat empêche l\'annulation (pas de duplication)', () => {
  const { g } = setup();
  g.startGame();
  g.buy('Alpha', 'oil', 1);
  g.sell('Alpha', 'oil', 1);
  throwsGame(() => g.undo('Alpha'), /Aucune/);
});

test('les pénalités de puissance persistent après recalcul', () => {
  const { g } = setup();
  g.startGame();
  // Bravo n'agit pas → −100 pts d'inactivité, qui doivent survivre au recalcul
  g.buy('Alpha', 'food', 1);
  g.buy('Charlie', 'food', 1);
  g.nextPeriod();
  const usa = g.state.countries.usa;
  assert.equal(usa.prestige, -C.INACTIVITY_PENALTY);
  assert.equal(usa.power, calcPower(usa));
  usa.power = 0;
  assert.equal(calcPower(usa) + C.INACTIVITY_PENALTY, calcPower({ ...usa, prestige: 0 }));
});

test('les multiplicateurs de revenus s\'appliquent bien (bug du choc pétrolier)', () => {
  const { g } = setup();
  g.state.sequence[0] = 'oil_boom';
  g.startGame();
  ['Alpha', 'Bravo', 'Charlie'].forEach(t => g.buy(t, 'food', 1));
  const before = g.state.countries.usa.treasury;
  g.nextPeriod();
  const usa = g.state.countries.usa;
  // 200 pétrole × 25 × 5 = 25 000 or rien que pour le pétrole
  assert.ok(usa.treasury - before >= 25000, `revenu trop faible : ${usa.treasury - before}`);
  assert.equal(g.state.prices.oil, Math.round(80 * 4));
});

test('événement à choix : réponse appliquée une seule fois, B automatique sinon', () => {
  const { g } = setup();
  g.state.sequence[3] = 'refugees';
  g.startGame();
  for (let p = 1; p < 4; p++) { ['Alpha', 'Bravo', 'Charlie'].forEach(t => g.buy(t, 'food', 1)); g.nextPeriod(); }
  assert.equal(g.state.choice.eventId, 'refugees');
  throwsGame(() => g.answerChoice('Alpha', 'A'), /pas encore ouvert/);
  g.state.choice.opensIn = 0;
  g.state.countries.france.food = 1000;
  const army = g.state.countries.france.army;
  g.answerChoice('Alpha', 'A');
  assert.equal(g.state.countries.france.army, army + 60);
  throwsGame(() => g.answerChoice('Alpha', 'A'), /déjà répondu/);
  const prestigeUsa = g.state.countries.usa.prestige;
  g.state.choice.secondsLeft = 1;
  g.tick();
  assert.equal(g.state.choice, null);
  assert.equal(g.state.countries.usa.prestige, prestigeUsa - 300);
});

test('déroulé complet : 6 périodes, négociation, guerre jusqu\'à la victoire', () => {
  const { g, events } = setup();
  g.startGame();
  for (let p = 1; p <= 6; p++) {
    if (g.state.choice) g.state.choice.opensIn = 0;
    ['Alpha', 'Bravo', 'Charlie'].forEach(t => g.buy(t, 'food', 1));
    if (p < 6) g.nextPeriod(); else g.startNegotiation();
  }
  assert.equal(g.state.phase, 'negotiation');
  assert.equal(g.state.ranking.length, 3);
  g.startWar();
  for (let i = 0; i < C.WAR_START_DELAY; i++) g.tick();
  assert.ok(g.state.war.started);
  // On fait gagner l'équipe en cours à chaque fois en lui donnant une armée écrasante
  let guard = 0;
  while (!g.state.gameOver && guard++ < 100) {
    const team = g.state.war.team;
    const me = g.countryOf(team);
    me.army = 1e6;
    const target = g.aliveCountries().find(c => c.team !== team);
    g.attack(team, { targetId: target.id, payWith: 'gold', commit: 1 });
    if (!g.state.gameOver) throwsGame(() => g.attack(team, { targetId: target.id }), /pas votre tour/); // plus d'attaques multiples
    for (let i = 0; i < C.ATTACK_RESOLVE_DELAY; i++) g.tick();
  }
  assert.ok(g.state.gameOver);
  assert.equal(g.state.winners.length, 1);
  const winner = g.state.countries[g.state.winners[0]];
  assert.equal(winner.territories.length, 2);
  assert.ok(events.some(e => e.e === 'winner'));
});

test('premier assaut = pillage, second = annexion', () => {
  const { g } = setup(['Aa', 'Bb', 'Cc'], ['france', 'usa', 'niger']);
  g.startGame(); g.state.phase = 'negotiation';
  g.startWar(); g.warBegin();
  const team = g.state.war.team;
  const me = g.countryOf(team);
  const target = g.aliveCountries().find(c => c.team !== team);
  me.army = 1e6;
  const r1 = g.attack(team, { targetId: target.id });
  assert.equal(r1.outcome, 'raid');
  assert.equal(target.eliminated, false);
  g.state.war.resolving = false; // on rejoue le tour pour le test
  const r2 = g.attack(team, { targetId: target.id });
  assert.equal(r2.outcome, 'conquest');
  assert.equal(target.eliminated, true);
  assert.equal(target.conqueredBy, me.id);
});

test('pacte de non-agression : impossible d\'attaquer son allié', () => {
  const { g } = setup();
  g.startGame(); g.state.phase = 'prosperity'; g.state.period = 6;
  ['Alpha', 'Bravo', 'Charlie'].forEach(t => g.buy(t, 'food', 1));
  g.startNegotiation();
  const last = g.state.ranking[g.state.ranking.length - 1].team;
  const first = g.state.ranking[0].team;
  g.proposeAlliance(last, first, 'peace');
  g.respondAlliance(first, true);
  g.startWar(); g.warBegin();
  // On force le tour de "last"
  g.state.war.team = last;
  const target = g.countryOf(first);
  throwsGame(() => g.attack(last, { targetId: target.id }), /allié/);
});

test('rang : le leader ne peut proposer qu\'au dernier', () => {
  const { g } = setup();
  g.startGame(); g.state.period = 6;
  ['Alpha', 'Bravo', 'Charlie'].forEach(t => g.buy(t, 'food', 1));
  g.startNegotiation();
  const [first, second, third] = g.state.ranking.map(r => r.team);
  assert.deepEqual(g.allowedPartners(first), [third]);
  throwsGame(() => g.proposeAlliance(first, second, 'peace'), /rang/);
});

test('draft : une seule nation par équipe, nation unique', () => {
  const { g } = setup(['Alpha'], ['france']);
  throwsGame(() => g.draftCountry('Alpha', 'usa'), /déjà choisi/);
  g.joinTeam('Bravo', g.state.sessionCode);
  throwsGame(() => g.draftCountry('Bravo', 'france'), /déjà prise/);
  throwsGame(() => g.draftCountry('Bravo', 'atlantis'), /inconnue/);
  throwsGame(() => g.draftCountry('Ghost', 'usa'), /introuvable/);
});

test('noms d\'équipe nettoyés, doublons et mauvais code refusés', () => {
  const g = new Game();
  g.openRegistrations();
  const { teamName, token } = g.joinTeam('  <img src=x>  Les  Bleus ', g.state.sessionCode);
  assert.equal(teamName, 'img src=x Les Bleus');
  throwsGame(() => g.joinTeam('IMG SRC=X LES BLEUS', g.state.sessionCode), /déjà pris/);
  throwsGame(() => g.joinTeam('Autre', 'WRONG1'), /Code/);
  g.verifyTeam(teamName, token);
  throwsGame(() => g.verifyTeam(teamName, 'mauvais'), /Session/);
});

test('vue publique : pas de jetons, pas d\'événements futurs, pas de prix futurs', () => {
  const { g } = setup();
  g.startGame();
  const pub = JSON.stringify(g.publicView());
  for (const t of Object.values(g.state.teams)) assert.ok(!pub.includes(t.token));
  assert.ok(!pub.includes('"sequence"'));
  assert.ok(!pub.includes('nextPrices'));
  const me = JSON.stringify(g.meView('Alpha'));
  assert.ok(!me.includes(g.state.teams.Alpha.token));
  const mj = JSON.stringify(g.mjView());
  for (const t of Object.values(g.state.teams)) assert.ok(!mj.includes(t.token));
});

test('sauvegarde : rechargement en pause', () => {
  const { g } = setup();
  g.startGame();
  const copy = new Game();
  assert.ok(copy.load(JSON.parse(JSON.stringify(g.serialize()))));
  assert.equal(copy.state.phase, 'prosperity');
  assert.equal(copy.state.paused, true);
});
