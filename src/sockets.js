'use strict';
const crypto = require('crypto');
const C = require('./config');
const COUNTRY_DATA = require('./data/countries');
const { GameError, safeEqual } = require('./game');

// Limite les essais de PIN : 8 échecs par IP → blocage 5 minutes.
const MAX_PIN_FAILS = 8;
const PIN_LOCK_MS = 5 * 60 * 1000;

function clientIp(socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || socket.handshake.address;
}

module.exports = function attachSockets(io, game, { mjPin }) {
  const mjTokens = new Set();
  const pinFails = new Map(); // ip → { count, until }

  // ── Diffusion des vues ─────────────────────────────────────────────────
  let pending = false;
  function broadcast() {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      const pub = game.publicView();
      io.to('public').emit('state', pub);
      for (const name of Object.keys(game.state.teams)) io.to(teamRoom(name)).emit('state', { ...pub, me: game.meView(name) });
      io.to('mj').emit('state', game.mjView(pub));
    });
  }
  const teamRoom = (name) => 'team:' + name;

  async function demoteTeamSockets(name, reason) {
    const sockets = name ? await io.in(teamRoom(name)).fetchSockets() : (await io.fetchSockets()).filter(s => s.data.role === 'team');
    for (const s of sockets) {
      s.emit('kicked', reason);
      s.leave(teamRoom(s.data.team));
      s.data.role = 'public';
      s.data.team = null;
      s.join('public');
    }
    broadcast();
  }

  game.emit = (event, payload, team) => {
    if (event === 'sessionEnded') return void demoteTeamSockets(null, 'La partie a été réinitialisée.');
    if (event === 'teamKicked') return void demoteTeamSockets(payload.team, 'Le MJ vous a retiré de la partie.');
    if (team) io.to(teamRoom(team)).emit(event, payload);
    else io.emit(event, payload);
  };
  game.onChange = broadcast;

  const publicConfig = {
    ...C,
    COUNTRIES: COUNTRY_DATA.map(({ id, iso, a2, name, tier, gold, oil, food, tourism, agriculture, army, population }) =>
      ({ id, iso, a2, name, tier, gold, oil, food, tourism, agriculture, army, population })),
  };

  io.on('connection', (socket) => {
    socket.data.role = 'public';
    socket.join('public');
    socket.emit('config', publicConfig);
    socket.emit('state', game.publicView());

    // Enregistre un handler sécurisé : payload validé, rôle vérifié, erreurs capturées.
    const on = (event, role, fn) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') { ack = payload; payload = {}; }
        if (!payload || typeof payload !== 'object') payload = {};
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          if (role === 'mj' && socket.data.role !== 'mj') throw new GameError('Accès réservé au MJ.');
          if (role === 'team' && socket.data.role !== 'team') throw new GameError('Rejoignez d\'abord une partie.');
          const result = fn(payload);
          reply({ ok: true, ...(result || {}) });
          if (role !== null) broadcast();
        } catch (err) {
          if (!(err instanceof GameError)) console.error(`[${event}]`, err);
          reply({ ok: false, error: err instanceof GameError ? err.message : 'Erreur serveur.' });
        }
      });
    };

    const bindTeam = (name) => {
      if (socket.data.role === 'team') socket.leave(teamRoom(socket.data.team));
      socket.leave('public');
      socket.leave('mj');
      socket.data.role = 'team';
      socket.data.team = name;
      socket.join(teamRoom(name));
      broadcast();
    };

    // ── Authentification ─────────────────────────────────────────────────
    on('auth:mj', null, ({ pin, token }) => {
      const ip = clientIp(socket);
      const f = pinFails.get(ip);
      if (f && f.until > Date.now()) throw new GameError('Trop d\'essais. Réessayez dans quelques minutes.');
      let ok = false;
      if (token && mjTokens.has(String(token))) ok = true;
      else if (pin !== undefined && safeEqual(String(pin).trim(), mjPin)) ok = true;
      if (!ok) {
        if (pin !== undefined) {
          const count = (f && f.until <= Date.now() ? 0 : f?.count || 0) + 1;
          pinFails.set(ip, { count, until: count >= MAX_PIN_FAILS ? Date.now() + PIN_LOCK_MS : 0 });
        }
        throw new GameError(token && pin === undefined ? 'Session MJ expirée.' : 'PIN incorrect.');
      }
      pinFails.delete(ip);
      const newToken = token && mjTokens.has(String(token)) ? String(token) : crypto.randomBytes(18).toString('base64url');
      mjTokens.add(newToken);
      socket.leave('public');
      if (socket.data.role === 'team') socket.leave(teamRoom(socket.data.team));
      socket.data.role = 'mj';
      socket.join('mj');
      broadcast();
      return { token: newToken };
    });

    on('team:join', null, ({ teamName, sessionCode }) => {
      const res = game.joinTeam(teamName, sessionCode);
      bindTeam(res.teamName);
      return res;
    });

    on('team:rejoin', null, ({ teamName, token }) => {
      game.verifyTeam(String(teamName ?? ''), String(token ?? ''));
      bindTeam(teamName);
      return { teamName };
    });

    on('team:leave', null, () => {
      if (socket.data.role === 'team') socket.leave(teamRoom(socket.data.team));
      socket.data.role = 'public';
      socket.data.team = null;
      socket.join('public');
      socket.emit('state', game.publicView());
    });

    // ── MJ ───────────────────────────────────────────────────────────────
    on('mj:openRegistrations', 'mj', () => game.openRegistrations());
    on('mj:reset', 'mj', () => game.reset());
    on('mj:startTutorial', 'mj', () => game.startTutorial());
    on('mj:startGame', 'mj', () => game.startGame());
    on('mj:nextPeriod', 'mj', () => game.nextPeriod());
    on('mj:startNegotiation', 'mj', () => game.startNegotiation());
    on('mj:startWar', 'mj', () => game.startWar());
    on('mj:pause', 'mj', () => game.pause());
    on('mj:resume', 'mj', () => game.resume());
    on('mj:timerStart', 'mj', () => game.timerStart());
    on('mj:timerPause', 'mj', () => game.timerPause());
    on('mj:timerSet', 'mj', ({ seconds }) => game.timerSet(seconds));
    on('mj:selectEvent', 'mj', ({ period, eventId }) => game.selectEvent(period, String(eventId)));
    on('mj:rerollEvents', 'mj', () => game.rerollEvents());
    on('mj:kickTeam', 'mj', ({ teamName }) => game.kickTeam(String(teamName ?? '')));
    on('mj:eliminate', 'mj', ({ countryId }) => game.eliminate(String(countryId ?? '')));
    on('mj:bonus', 'mj', ({ countryId, amount }) => game.bonus(String(countryId ?? ''), amount));
    on('mj:nextWarTurn', 'mj', () => game.mjNextTurn());
    on('mj:endWar', 'mj', () => game.endWarByScore());

    // ── Équipes : l'équipe vient toujours de la socket, jamais du client ─
    const me = () => socket.data.team;
    on('team:draft', 'team', ({ countryId }) => game.draftCountry(me(), String(countryId ?? '')));
    on('team:buy', 'team', ({ resource, qty }) => game.buy(me(), String(resource ?? ''), qty));
    on('team:sell', 'team', ({ resource, qty }) => game.sell(me(), String(resource ?? ''), qty));
    on('team:invest', 'team', ({ kind, qty }) => game.invest(me(), String(kind ?? ''), qty));
    on('team:undo', 'team', () => game.undo(me()));
    on('team:choice', 'team', ({ option }) => game.answerChoice(me(), option));
    on('team:proposeAlliance', 'team', ({ to, type }) => game.proposeAlliance(me(), String(to ?? ''), type));
    on('team:respondAlliance', 'team', ({ accept }) => game.respondAlliance(me(), !!accept));
    on('team:attack', 'team', ({ targetId, payWith, commit }) => ({ result: game.attack(me(), { targetId: String(targetId ?? ''), payWith, commit }) }));
    on('team:fortify', 'team', () => game.fortify(me()));
    on('team:skipTurn', 'team', () => game.skipTurn(me()));
    // Lecture seule : pas de rediffusion
    socket.on('team:previewAttack', (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        if (socket.data.role !== 'team') throw new GameError('Rejoignez d\'abord une partie.');
        const p = payload && typeof payload === 'object' ? payload : {};
        ack({ ok: true, ...game.attackPreview(me(), String(p.targetId ?? ''), p.commit) });
      } catch (err) {
        ack({ ok: false, error: err instanceof GameError ? err.message : 'Erreur serveur.' });
      }
    });
  });

  return { broadcast };
};
