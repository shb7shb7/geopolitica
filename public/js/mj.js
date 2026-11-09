import { socket, store, onState, onClock, send, $, esc, fmt, mmss, RES, flag, nation, countryOfTeam, aliveNations, toast, beep, phaseLabel } from './common.js';
import { WorldMap } from './worldmap.js';

const KEY = 'geopolitica:mj';
const getToken = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const setToken = (t) => { try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch { /* indisponible */ } };
let authed = false;
let map = null;

// ── Authentification ─────────────────────────────────────────────────────
socket.on('connect', async () => {
  const token = getToken();
  if (!token) return;
  const res = await send('auth:mj', { token }, { silent: true });
  if (res.ok) enter(res.token); else setToken(null);
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await send('auth:mj', { pin: $('#pin').value });
  if (res.ok) enter(res.token);
});

function enter(token) {
  setToken(token);
  authed = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  render();
}

const S = () => store.state;
const isMjState = (s) => s && Array.isArray(s.sequence);
const act = async (event, payload, confirmMsg) => {
  if (confirmMsg && !confirm(confirmMsg)) return;
  const r = await send(event, payload);
  return r;
};

// ── Rendu ────────────────────────────────────────────────────────────────
function render() {
  const s = S();
  if (!authed || !isMjState(s) || !store.config) return;
  $('#phase').textContent = phaseLabel(s) + (s.paused ? ' · en pause' : '');
  $('#session').textContent = s.sessionCode || '';
  $('#session').title = 'Code de session à donner aux joueurs';
  $('#btn-pause').textContent = s.paused ? '▶ Reprendre' : '⏸ Pause';
  $('#btn-pause').className = 'btn btn-sm ' + (s.paused ? 'btn-green' : '');
  renderNextStep(s);
  renderPeriod(s);
  renderSequence(s);
  renderWar(s);
  renderNations(s);
  renderTools(s);
  $('#log').innerHTML = s.log.map(l => `<div class="${esc(l.type)}"><span class="dim">${esc(l.time)}</span> ${esc(l.text)}</div>`).join('');
  if (store.clock) updateClock(store.clock);
}
onState(render);

function renderNextStep(s) {
  const C = store.config;
  const nations = aliveNations(s);
  const teamsNoNation = s.teams.filter(t => !t.country);
  let title = '', desc = '', actions = '', warns = [];
  const btn = (event, label, cls = 'btn-gold', confirmMsg = '') => `<button class="btn ${cls}" data-act="${event}" ${confirmMsg ? `data-confirm="${esc(confirmMsg)}"` : ''}>${label}</button>`;

  if (s.gameOver) {
    const w = s.winners.map(id => s.countries[id]);
    title = '🏆 Partie terminée';
    desc = `Victoire de ${w.map(x => nation(x)).join(' & ') || 'personne'}${s.winType === 'score' ? ' (à la puissance)' : s.winType === 'alliance' ? ' (pacte de non-agression)' : ''}.`;
    actions = btn('mj:openRegistrations', 'Nouvelle partie', 'btn-gold', 'Démarrer une nouvelle partie ? Les équipes actuelles seront déconnectées.');
  } else if (s.phase === 'setup') {
    title = 'Préparer la partie';
    desc = 'Ouvrez les inscriptions : un code de session sera généré et affiché sur l\'écran de projection.';
    actions = btn('mj:openRegistrations', 'Ouvrir les inscriptions');
  } else if (s.phase === 'draft') {
    title = `Inscriptions — ${nations.length} nation(s) choisie(s)`;
    desc = `Les joueurs rejoignent avec le code <b class="session">${esc(s.sessionCode)}</b> sur ${esc(location.origin)} puis choisissent leur nation.`;
    if (teamsNoNation.length) warns.push(`${teamsNoNation.length} équipe(s) sans nation : ${teamsNoNation.map(t => esc(t.name)).join(', ')}`);
    actions = btn('mj:startTutorial', '🎮 Manche test', 'btn') + btn('mj:startGame', 'Lancer la période 1 →', 'btn-gold', teamsNoNation.length ? 'Des équipes n\'ont pas de nation. Lancer quand même ?' : '');
  } else if (s.isTutorial) {
    title = 'Manche test en cours';
    desc = 'Les équipes découvrent l\'interface. Tout sera remis à zéro au lancement.';
    actions = btn('mj:startGame', 'Terminer le test et lancer la période 1 →');
  } else if (s.phase === 'prosperity') {
    const idle = nations.filter(c => !(s.actions[c.team] > 0));
    if (idle.length) warns.push(`Sans action cette période (−${C.INACTIVITY_PENALTY} pts) : ${idle.map(c => esc(c.name)).join(', ')}`);
    if (s.choice) warns.push(`Choix stratégique : ${s.choice.answered}/${nations.length} réponses${s.choice.opensIn > 0 ? ` (ouverture dans ${s.choice.opensIn} s)` : ''}`);
    title = `Période ${s.period}/${s.totalPeriods} — ${esc(s.periodInfo?.name || '')}`;
    if (s.period < s.totalPeriods) {
      desc = `Passer à la période suivante déclenche l'événement <b>${esc(s.currentEvent?.title || '')}</b>, verse les revenus et consomme la nourriture.`;
      actions = btn('mj:nextPeriod', `Passer à la période ${s.period + 1} →`, 'btn-gold', `Passer à la période ${s.period + 1} ?`);
    } else {
      desc = `Dernière période. La négociation déclenche <b>${esc(s.currentEvent?.title || '')}</b> et verse les derniers revenus.`;
      actions = btn('mj:startNegotiation', 'Lancer la négociation →', 'btn-blue', 'Lancer la négociation ?');
    }
  } else if (s.phase === 'negotiation') {
    const allied = Object.keys(s.alliances).length / 2;
    title = 'Négociation';
    desc = `${allied} alliance(s) conclue(s). Les équipes peuvent encore investir dans l'armée.`;
    actions = btn('mj:startWar', '⚔️ Déclarer la guerre', 'btn-red', 'Déclarer la guerre ?');
  } else if (s.phase === 'war') {
    title = s.war?.started ? `Guerre — manche ${s.war.round}/${s.war.maxRounds}` : 'Guerre — cinématique en cours';
    desc = `${nations.length} nations en vie. Tours de ${C.WAR_TURN_SECONDS} s. Après ${C.WAR_MAX_ROUNDS} manches, la plus puissante gagne.`;
    actions = btn('mj:nextWarTurn', 'Tour suivant →', 'btn') + btn('mj:endWar', '🏁 Terminer (victoire à la puissance)', 'btn-red', 'Terminer la guerre maintenant ? La nation la plus puissante gagne.');
  }
  $('#next-step').innerHTML = `<div class="card-title">Prochaine étape</div><div class="step-title">${title}</div><div class="small muted">${desc}</div>${warns.length ? `<ul class="warn-list">${warns.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}<div class="step-actions">${actions}</div>`;
}

$('#next-step').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act, {}, b.dataset.confirm);
});

const TYPE = { market: ['Marché', 'ev-market'], choice: ['Choix', 'ev-choice'], targeted: ['Ciblé', 'ev-targeted'] };

function renderPeriod(s) {
  const card = $('#period-card');
  const ev = s.currentEvent;
  if (s.phase !== 'prosperity' || s.isTutorial || !ev) { card.hidden = true; return; }
  card.hidden = false;
  const [tl, tc] = TYPE[ev.type];
  const np = s.nextPrices;
  let answers = '';
  if (s.choiceAnswers) {
    answers = `<div class="small" style="margin-top:8px">Réponses : ${aliveNations(s).map(c => `${flag(c)} ${s.choiceAnswers[c.team] ? `<b>${s.choiceAnswers[c.team]}</b>` : '<span class="dim">…</span>'}`).join(' · ')}</div>`;
  }
  card.innerHTML = `
    <div class="card-title">Événement de la période</div>
    <div class="row wrap"><span class="ev-pill ${tc}">${tl}</span><b style="font-size:16px">${ev.icon} ${esc(ev.title)}</b></div>
    <p class="small" style="margin:6px 0">${esc(ev.effect)}</p>
    <p class="small muted" style="margin:0">🔮 Indice montré aux joueurs : « ${esc(ev.hint)} »</p>
    ${answers}
    ${np ? `<div class="tiny dim" style="margin-top:10px">Prix au début de la prochaine période :</div><div class="prices">${Object.keys(RES).map(r => {
      const cur = s.prices[r], next = np[r];
      const p = Math.round((next - cur) / cur * 100);
      return `<div class="price-box">${RES[r].icon} ${RES[r].name}<b>${fmt(cur)} → ${fmt(next)}</b><span class="${p > 4 ? 'bad' : p < -4 ? 'good' : 'dim'}">${p > 0 ? '+' : ''}${p} %</span></div>`;
    }).join('')}</div>` : ''}`;
}

function renderSequence(s) {
  const card = $('#sequence-card');
  if (!s.sequence.length || s.phase === 'war' || s.phase === 'negotiation' || s.gameOver) { card.hidden = true; return; }
  card.hidden = false;
  if (card.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return; // ne pas fermer un menu ouvert
  const cur = s.isTutorial ? 0 : s.period;
  card.innerHTML = `<div class="row-between"><div class="card-title" style="margin:0">Séquence des événements</div><button class="btn btn-sm" id="reroll">🔀 Régénérer la suite</button></div>
    <p class="tiny dim" style="margin:4px 0 8px">Visible uniquement par vous. Modifiable pour la période en cours et les suivantes.</p>
    ${s.sequence.map((ev, i) => {
      const p = i + 1;
      const past = p < cur;
      const [tl, tc] = TYPE[ev.type];
      const control = past ? `<span class="small">${ev.icon} ${esc(ev.title)}</span>`
        : `<select class="select" data-period="${p}">${s.pools[p].map(o => `<option value="${o.id}" ${o.id === ev.id ? 'selected' : ''}>${o.icon} ${esc(o.title)}</option>`).join('')}</select>`;
      return `<div class="seq-row ${past ? 'past' : ''} ${p === cur ? 'current' : ''}"><span class="seq-p">P${p}</span><span class="ev-pill ${tc}">${tl}</span>${control}</div>`;
    }).join('')}`;
}

$('#sequence-card').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-period]');
  if (sel) { act('mj:selectEvent', { period: Number(sel.dataset.period), eventId: sel.value }); sel.blur(); }
});
$('#sequence-card').addEventListener('click', (e) => {
  if (e.target.closest('#reroll')) act('mj:rerollEvents', {}, 'Tirer de nouveaux événements pour les périodes à venir ?');
});

function renderWar(s) {
  const card = $('#war-card');
  if (s.phase !== 'war' && s.phase !== 'negotiation') { card.hidden = true; return; }
  card.hidden = false;
  const w = s.war;
  let info = '';
  if (s.phase === 'negotiation') {
    const pairs = [];
    const seen = new Set();
    for (const [team, a] of Object.entries(s.alliances)) {
      if (seen.has(team)) continue;
      seen.add(a.with);
      pairs.push(`${a.type === 'peace' ? '🕊️' : '⚔️'} ${nation(countryOfTeam(s, team))} & ${nation(countryOfTeam(s, a.with))}`);
    }
    info = pairs.length ? pairs.join('<br>') : '<span class="dim small">Aucune alliance pour le moment.</span>';
  } else if (w) {
    const cur = w.team && countryOfTeam(s, w.team);
    info = `<div class="row-between"><div>Tour de ${cur ? nation(cur) : '—'} <span class="dim small">(${w.index + 1}/${w.order.length})</span></div><div class="big-timer num" data-cd="turn" style="font-size:28px">${w.turnSeconds}</div></div>
      <div class="dots">${w.order.map((t, i) => { const c = countryOfTeam(s, t); return c ? `<span title="${esc(c.name)}" style="opacity:${i < w.index || c.eliminated ? .3 : 1}">${flag(c)}</span>` : ''; }).join('')}</div>`;
  }
  $('#war-info').innerHTML = info;
  if (!map) map = new WorldMap($('#mj-map'), { labels: true, flag: 16 });
  map.update(s, { current: w?.team });
}

socket.on('attackResult', (r) => {
  const s = S();
  if (!authed || !s) return;
  map?.animateAttack(r.attacker, r.defender, r.outcome, s.countries[r.attacker]?.color);
});

function renderNations(s) {
  const list = Object.values(s.countries).filter(c => c.team || c.conqueredBy).sort((a, b) => (a.eliminated - b.eliminated) || b.power - a.power);
  if (!list.length) { $('#nations').innerHTML = '<p class="dim small">Aucune nation choisie.</p>'; return; }
  const showActions = s.phase === 'prosperity' || s.phase === 'negotiation';
  $('#nations').innerHTML = `<div style="overflow-x:auto"><table class="nat-table"><thead><tr>
    <th>Nation</th><th>Équipe</th><th class="r">Puissance</th><th class="r">Or</th><th class="r">🪖</th><th class="r">ATK/DEF</th><th class="r">🌾</th>${showActions ? '<th class="r">Act.</th>' : ''}</tr></thead><tbody>
    ${list.map(c => `<tr class="${c.eliminated ? 'dead' : ''} ${s.war?.team && c.team === s.war.team ? 'turn' : ''}">
      <td><span class="swatch" style="background:${c.color || '#555'}"></span> ${nation(c)} <b class="tier tier-${c.tier}">${c.tier}</b></td>
      <td class="dim">${esc(c.team || '')}</td>
      <td class="r"><b>${fmt(c.power)}</b>${s.prestige[c.id] ? ` <span class="tiny ${s.prestige[c.id] > 0 ? 'good' : 'bad'}">(${s.prestige[c.id] > 0 ? '+' : ''}${fmt(s.prestige[c.id])})</span>` : ''}</td>
      <td class="r">${fmt(c.treasury)}</td><td class="r">${fmt(c.army)}</td><td class="r">${c.atk}/${c.def}</td><td class="r">${fmt(c.food)}</td>
      ${showActions ? `<td class="r">${s.isTutorial ? '∞' : `${s.actions[c.team] || 0}/${store.config.ACTIONS_PER_PERIOD}`}</td>` : ''}
    </tr>`).join('')}</tbody></table></div>
    <p class="tiny dim" style="margin:6px 0 0">Entre parenthèses : bonus et malus de puissance (événements, famine, inactivité, choix).</p>`;
}

function renderTools(s) {
  const nSel = $('#tool-nation'), tSel = $('#tool-team');
  if (document.activeElement === nSel || document.activeElement === tSel) return;
  const curN = nSel.value, curT = tSel.value;
  nSel.innerHTML = '<option value="">Choisir une nation…</option>' + aliveNations(s).map(c => `<option value="${c.id}">${esc(c.name)} — ${esc(c.team)}</option>`).join('');
  tSel.innerHTML = '<option value="">Choisir une équipe…</option>' + s.teams.map(t => `<option value="${esc(t.name)}">${esc(t.name)}${t.country ? ' — ' + esc(s.countries[t.country].name) : ''}</option>`).join('');
  nSel.value = curN; tSel.value = curT;
}

// ── Boutons fixes ────────────────────────────────────────────────────────
$('#btn-pause').onclick = () => act(S().paused ? 'mj:resume' : 'mj:pause');
$('#btn-reset').onclick = () => act('mj:reset', {}, 'Tout réinitialiser ? La partie en cours sera perdue.');
$('#t-start').onclick = () => act('mj:timerStart');
$('#t-pause').onclick = () => act('mj:timerPause');
$('#t-set').onclick = () => act('mj:timerSet', { seconds: Math.round(Number($('#t-min').value) * 60) });
const amount = () => Math.abs(Math.round(Number($('#tool-amount').value) || 0));
$('#tool-plus').onclick = () => { const id = $('#tool-nation').value; if (!id) return toast('Choisissez une nation.'); act('mj:bonus', { countryId: id, amount: amount() }); };
$('#tool-minus').onclick = () => { const id = $('#tool-nation').value; if (!id) return toast('Choisissez une nation.'); act('mj:bonus', { countryId: id, amount: -amount() }); };
$('#tool-elim').onclick = () => { const id = $('#tool-nation').value; if (!id) return toast('Choisissez une nation.'); act('mj:eliminate', { countryId: id }, `Éliminer ${store.countries[id].name} ?`); };
$('#tool-kick').onclick = () => { const t = $('#tool-team').value; if (!t) return toast('Choisissez une équipe.'); act('mj:kickTeam', { teamName: t }, `Retirer l'équipe « ${t} » ?`); };

// ── Horloge ──────────────────────────────────────────────────────────────
function updateClock(clk) {
  if (!authed) return;
  const t = clk.timer;
  const el = $('#timer');
  el.textContent = mmss(t.seconds);
  el.classList.toggle('urgent', t.running && t.seconds <= 60);
  $('#timer-bar').style.width = t.total ? `${(t.seconds / t.total) * 100}%` : '0%';
  if (clk.war) document.querySelectorAll('[data-cd="turn"]').forEach(x => { x.textContent = clk.war.resolving ? '…' : clk.war.seconds; });
}
onClock(updateClock);
socket.on('timerEnded', () => { if (authed) { beep(523, 3); toast('⏰ Temps écoulé !'); } });
