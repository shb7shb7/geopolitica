import {
  socket, store, onState, onClock, send, $, esc, fmt, signed, mmss, RES, flag, nation,
  countryOfTeam, aliveNations, toast, beep, storage, phaseLabel, modal,
} from './common.js';
import { WorldMap } from './worldmap.js';

const KEY = 'geopolitica:session';
let session = storage.get(KEY);
let rejoining = false;
let tab = 'market';
let lastPhase = null;
let map = null;
let seenTransition = null;
const war = { target: null, commit: 1, pay: 'gold', preview: null, previewKey: '' };
let allyType = 'peace';

const S = () => store.state;
const cfg = () => store.config;
const myCountry = () => { const me = S()?.me; return me?.country ? S().countries[me.country] : null; };

// ════════════════════════════════════════════════════════════════════════
// Session
// ════════════════════════════════════════════════════════════════════════
socket.on('connect', () => { if (session) rejoin(); });

async function rejoin() {
  rejoining = true;
  render();
  const res = await send('team:rejoin', session, { silent: true });
  rejoining = false;
  if (!res.ok) {
    storage.del(KEY);
    session = null;
    $('#join-status').textContent = 'Votre ancienne session a expiré : rejoignez à nouveau.';
  }
  render();
}

socket.on('kicked', (msg) => {
  storage.del(KEY);
  session = null;
  toast(msg, 'error', 6000);
  render();
});

const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) $('#join-code').value = urlCode.toUpperCase().slice(0, 6);

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  const res = await send('team:join', { teamName: $('#join-name').value, sessionCode: $('#join-code').value.trim().toUpperCase() });
  btn.disabled = false;
  if (res.ok) {
    session = { teamName: res.teamName, token: res.token };
    storage.set(KEY, session);
    if (urlCode) history.replaceState(null, '', '/');
  }
});

// ════════════════════════════════════════════════════════════════════════
// Rendu principal
// ════════════════════════════════════════════════════════════════════════
function show(id) {
  for (const x of ['screen-landing', 'screen-draft', 'screen-game']) $('#' + x).hidden = x !== id;
}

function render() {
  const s = S();
  if (!s || !cfg()) return;
  const me = s.me;
  if (!session || !me) {
    show('screen-landing');
    if (rejoining) $('#join-status').textContent = 'Reconnexion à votre partie…';
    else if (!$('#join-status').textContent || $('#join-status').dataset.auto) {
      $('#join-status').dataset.auto = '1';
      $('#join-status').textContent = s.phase === 'draft' ? '' : 'Les inscriptions ne sont pas ouvertes pour le moment.';
    }
    $('#overlay-pause').hidden = true;
    return;
  }
  if (s.phase === 'draft' || !me.country) {
    show('screen-draft');
    renderDraft();
    $('#overlay-pause').hidden = true;
    return;
  }
  show('screen-game');
  renderGame();
}
onState(render);

// ════════════════════════════════════════════════════════════════════════
// Draft
// ════════════════════════════════════════════════════════════════════════
const estIncome = (c) => c.oil * cfg().INCOME_PER_UNIT.oil + c.tourism * cfg().INCOME_PER_UNIT.tourism + c.agriculture * cfg().INCOME_PER_UNIT.agriculture + cfg().BASE_INCOME + Math.round(c.population * 0.05);

function renderDraft() {
  const s = S(), me = s.me;
  $('#draft-team').textContent = me.name;
  const mine = me.country && s.countries[me.country];
  if (mine) {
    $('#draft-mine').innerHTML = `<div class="card mine-banner">${flag(mine, 'flag-xl')}<div><div class="tiny good">✓ Votre nation</div><h2>${esc(mine.name)}</h2><p class="small muted">En attente du lancement par le maître du jeu…</p></div></div>`;
  } else if (s.phase !== 'draft') {
    $('#draft-mine').innerHTML = '<div class="card banner-dead">La partie a commencé sans que vous ayez choisi de nation. Demandez au maître du jeu.</div>';
  } else {
    $('#draft-mine').innerHTML = '';
  }
  $('#draft-intro').hidden = !!mine || s.phase !== 'draft';
  $('#draft-grid').innerHTML = cfg().COUNTRIES.map(c => {
    const st = s.countries[c.id];
    const taken = !!st.team;
    return `<button class="dc ${taken ? 'taken' : ''}" data-id="${c.id}" ${taken || mine ? 'disabled' : ''}>
      <div class="dc-top">${flag(c, 'flag-lg')}<span class="dc-name">${esc(c.name)}</span><b class="tier tier-${c.tier}">${c.tier}</b></div>
      <div class="dc-stats"><span>💰 ${fmt(c.gold)}</span><span>🪖 ${fmt(c.army)}</span><span>🛢️ ${fmt(c.oil)}</span><span>🏖️ ${fmt(c.tourism)}</span><span>🌿 ${fmt(c.agriculture)}</span><span>🌾 ${fmt(c.food)}</span></div>
      ${taken ? `<div class="dc-owner">${st.team === me.name ? 'Vous' : '→ ' + esc(st.team)}</div>` : ''}
    </button>`;
  }).join('');
}

$('#draft-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.dc');
  if (!b || b.disabled) return;
  const c = store.countries[b.dataset.id];
  const m = modal(`
    <div class="stack" style="text-align:center">
      <div>${flag(c, 'flag-xl')}</div>
      <h2>${esc(c.name)} <b class="tier tier-${c.tier}">${c.tier}</b></h2>
      <p class="small muted">Revenu estimé : <b class="good">+${fmt(estIncome(c))} or</b> par période · ${fmt(c.population)} M d'habitants</p>
      <p class="tiny dim">Ce choix est définitif.</p>
      <div class="row"><button class="btn grow" data-x="no">Annuler</button><button class="btn btn-gold grow" data-x="yes">Diriger cette nation</button></div>
    </div>`);
  m.el.addEventListener('click', async (ev) => {
    const x = ev.target.closest('[data-x]')?.dataset.x;
    if (x === 'no') m.close();
    if (x === 'yes') { const res = await send('team:draft', { countryId: c.id }); if (res.ok) m.close(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Partie
// ════════════════════════════════════════════════════════════════════════
function tabsFor(s, c) {
  if (s.phase === 'war') return ['war', 'news', 'rules'];
  if (s.phase === 'negotiation') return c.eliminated ? ['news', 'rules'] : ['diplomacy', 'army', 'news', 'rules'];
  return ['market', 'army', 'news', 'rules'];
}
const TAB_LABEL = { market: '📈 Marché', army: '🪖 Armée', diplomacy: '🤝 Diplomatie', war: '⚔️ Guerre', news: '📰 Journal', rules: '📖 Règles' };

function renderGame() {
  const s = S(), c = myCountry();
  if (!c) return;
  if (s.phase !== lastPhase) {
    if (s.phase === 'war') tab = 'war';
    else if (s.phase === 'negotiation') tab = 'diplomacy';
    else if (s.phase === 'prosperity' && (tab === 'war' || tab === 'diplomacy')) tab = 'market';
    lastPhase = s.phase;
  }
  const tabs = tabsFor(s, c);
  if (!tabs.includes(tab)) tab = tabs[0];

  $('#tb-nation').innerHTML = `<span class="swatch" style="background:${c.color}"></span>${flag(c)}<span>${esc(c.name)}</span>`;
  $('#tb-phase').textContent = phaseLabel(s);
  $('#overlay-pause').hidden = !s.paused;

  renderBanner(s, c);
  renderUrgent(s, c);
  renderSummary(s, c);
  renderInfo(s, c);
  $('#tabs').innerHTML = tabs.map(t => {
    const dot = (t === 'diplomacy' && s.me.proposalIn) || (t === 'war' && s.war?.team === s.me.name);
    return `<button class="tab ${t === tab ? 'active' : ''}" data-tab="${t}">${TAB_LABEL[t]}${dot ? '<span class="dot"></span>' : ''}</button>`;
  }).join('');
  for (const t of ['market', 'army', 'diplomacy', 'war', 'news', 'rules']) $('#panel-' + t).classList.toggle('active', t === tab);

  if (tab === 'market') renderMarket(s, c);
  if (tab === 'army') renderArmy(s, c);
  if (tab === 'diplomacy') renderDiplomacy(s, c);
  if (tab === 'war') renderWar(s, c);
  if (tab === 'news') renderNews(s);
  if (tab === 'rules') renderRules();
  if (store.clock) updateClock(store.clock);
}

$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]')?.dataset.tab;
  if (t) { tab = t; renderGame(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

function renderBanner(s, c) {
  let html = '';
  if (s.gameOver) {
    const winners = s.winners.map(id => s.countries[id]);
    const won = s.winners.includes(c.id);
    html = `<div class="card ${won ? 'banner-win' : 'banner-dead'}"><div style="font-size:34px">${won ? '🏆' : '🏁'}</div><h2>${won ? 'Victoire !' : 'Partie terminée'}</h2><p class="small muted">${winners.map(w => nation(w)).join(' & ')} ${winners.length > 1 ? 'remportent' : 'remporte'} Geopolitica${s.winType === 'score' ? ' à la puissance' : s.winType === 'alliance' ? ' grâce à leur pacte' : ''}.</p></div>`;
  } else if (c.eliminated) {
    const by = c.conqueredBy && s.countries[c.conqueredBy];
    html = `<div class="card banner-dead"><div style="font-size:30px">☠️</div><h2>Nation tombée</h2><p class="small muted">${by ? `Annexée par ${nation(by)}.` : 'Éliminée.'} Vous pouvez suivre la fin de la partie.</p></div>`;
  } else if (s.isTutorial) {
    html = '<div class="card banner-tuto">🎮 <b>Manche test</b> — actions illimitées, tout sera remis à zéro ensuite.</div>';
  }
  $('#banner').innerHTML = html;
}

function renderUrgent(s, c) {
  const me = s.me;
  let html = '';
  const ch = s.choice;
  if (ch && ch.opensIn === 0 && !me.choiceAnswer && !c.eliminated) {
    const warn = (opt) => {
      const missing = Object.entries(opt.cost || {}).filter(([r, n]) => (r === 'gold' ? c.treasury : c[r]) < n);
      return missing.length ? `<div class="tiny bad">⚠️ Stock insuffisant : vous perdrez tout votre stock sans aucun gain.</div>` : '';
    };
    html += `<div class="card urgent-card">
      <div class="row-between"><div class="card-title" style="margin:0">⚖️ Choix stratégique</div><span class="countdown num" data-cd="choice">${ch.secondsLeft}</span></div>
      <h2 style="margin-top:6px">${ch.icon} ${esc(ch.title)}</h2>
      <p class="small muted" style="margin:4px 0 0">${esc(ch.desc)}</p>
      <div class="choice-opts">
        ${['A', 'B'].map(k => `<button class="choice-opt" data-choice="${k}"><span class="tiny dim">Option ${k}</span><b>${esc(ch.options[k].label)}</b><span class="small muted">${esc(ch.options[k].detail)}</span>${warn(ch.options[k])}</button>`).join('')}
      </div>
      <p class="tiny dim" style="margin:8px 0 0">Sans réponse, l'option B s'applique automatiquement.</p>
    </div>`;
  }
  if (me.proposalIn) {
    const from = countryOfTeam(s, me.proposalIn.from);
    const peace = me.proposalIn.type === 'peace';
    html += `<div class="card urgent-card">
      <div class="row-between"><div class="card-title" style="margin:0">🤝 Proposition d'alliance</div><span class="countdown num" data-cd="proposal">${me.proposalIn.secondsLeft}</span></div>
      <p style="margin:8px 0">${nation(from)} vous propose une alliance <b>${peace ? 'de non-agression' : 'offensive'}</b>.</p>
      <p class="small muted" style="margin:0 0 10px">${peace ? 'Vous ne pourrez pas vous attaquer. Si vous êtes les deux derniers survivants : double victoire.' : `Vous ne pourrez pas vous attaquer et chacun gagne +${Math.round(cfg().OFFENSIVE_ALLIANCE_BONUS * 100)} % en attaque pendant toute la guerre.`}</p>
      <div class="row"><button class="btn btn-red grow" data-ally="no">Refuser</button><button class="btn btn-green grow" data-ally="yes">Accepter</button></div>
    </div>`;
  }
  $('#urgent').innerHTML = html;
}

$('#urgent').addEventListener('click', async (e) => {
  const opt = e.target.closest('[data-choice]')?.dataset.choice;
  if (opt) {
    const res = await send('team:choice', { option: opt });
    if (res.ok) { toast('Choix enregistré.', 'good'); tab = 'news'; }
  }
  const ally = e.target.closest('[data-ally]')?.dataset.ally;
  if (ally) await send('team:respondAlliance', { accept: ally === 'yes' });
});

function renderSummary(s, c) {
  const me = s.me, C = cfg();
  const alive = aliveNations(s).sort((a, b) => b.power - a.power);
  const rank = alive.findIndex(x => x.id === c.id) + 1;
  const inWar = s.phase === 'war';
  const stat = (icon, label, val, warnCls = '') => `<div class="stat ${warnCls}"><b>${icon} ${val}</b><small>${label}</small></div>`;
  const strip = inWar
    ? stat('🪖', 'Soldats', fmt(c.army)) + stat('⚔️', 'ATK', fmt(c.atk)) + stat('🛡️', 'DEF', fmt(c.def)) + stat('🏴', 'Territoires', 1 + c.territories.length)
    : stat('🛢️', 'Pétrole', fmt(c.oil)) + stat('🌾', 'Nourriture', fmt(c.food), c.food < me.foodNeed * 1.5 ? 'warn' : '') + stat('🏖️', 'Tourisme', fmt(c.tourism)) + stat('🌿', 'Agriculture', fmt(c.agriculture));
  let actions = '';
  if ((s.phase === 'prosperity' || s.phase === 'negotiation') && !c.eliminated) {
    const left = s.isTutorial ? Infinity : Math.max(0, C.ACTIONS_PER_PERIOD - me.actionsUsed);
    const pips = s.isTutorial ? '<span class="badge badge-gold">illimitées</span>' : Array.from({ length: C.ACTIONS_PER_PERIOD }, (_, i) => `<span class="pip ${i >= left ? 'used' : ''}"></span>`).join('');
    actions = `<div class="actions-line"><span>Actions</span>${pips}<span class="dim">· achats et investissements · la vente est libre</span><span class="grow"></span>${me.canUndo ? '<button class="btn btn-sm" data-undo>↩ Annuler</button>' : ''}</div>`;
  }
  $('#summary').innerHTML = `
    <div class="card sum-gold"><span class="label">Trésor</span><div class="sum-big num">${fmt(c.treasury)}</div><div class="tiny muted">${inWar ? 'or disponible pour attaquer' : `≈ +${fmt(me.expectedIncome)} or au prochain revenu`}</div></div>
    <div class="card"><span class="label">Puissance</span><div class="sum-mid num">${fmt(c.power)}</div><div class="tiny muted">${c.eliminated ? '—' : `Rang ${rank} sur ${alive.length}`}</div></div>
    <div class="stats-strip">${strip}</div>
    ${actions}`;
}

$('#summary').addEventListener('click', async (e) => {
  if (e.target.closest('[data-undo]')) { const r = await send('team:undo'); if (r.ok) toast('Achat annulé.'); }
});

function renderInfo(s) {
  let html = '';
  if (s.phase === 'prosperity' && s.periodInfo) {
    const lt = s.lastTransition;
    if (lt && !s.isTutorial && seenTransition !== `${s.period}:${lt.eventId}`) {
      html += `<div class="card happened">
        <div class="row-between"><div class="card-title" style="margin:0;color:#86efac">⚡ Ce qui vient de se passer</div><button class="btn btn-sm btn-ghost" data-dismiss="${s.period}:${lt.eventId}">✕</button></div>
        <p style="margin:6px 0 0"><b>${lt.icon} ${esc(lt.title)}</b> — <span class="muted">${esc(lt.explanation)}</span></p>
        <div class="price-changes">${lt.changes.map(ch => {
          const p = ch.from ? Math.round((ch.to - ch.from) / ch.from * 100) : 0;
          return `<span>${RES[ch.res].icon} ${RES[ch.res].name} : ${fmt(ch.from)} → <b>${fmt(ch.to)}</b> <span class="${p > 4 ? 'trend-up' : p < -4 ? 'trend-down' : 'dim'}">${p > 0 ? '+' : ''}${p} %</span></span>`;
        }).join('')}</div>
      </div>`;
    }
    if (s.periodInfo.hint) {
      html += `<div class="card hint"><div class="hint-label">Indice — ce qui arrivera au début de la prochaine période</div><div class="hint-text">${esc(s.periodInfo.hint)}</div>${s.isTutorial ? '' : `<p class="tiny dim" style="margin:6px 0 0">${esc(s.periodInfo.desc)}</p>`}</div>`;
    }
  } else if (s.phase === 'negotiation') {
    html = '<div class="card hint"><div class="hint-label">Négociation</div><div class="hint-text">Formez une alliance avant la guerre, et faites vos derniers investissements militaires.</div></div>';
  }
  $('#info').innerHTML = html;
}

$('#info').addEventListener('click', (e) => {
  const d = e.target.closest('[data-dismiss]')?.dataset.dismiss;
  if (d) { seenTransition = d; renderGame(); }
});

// ── Marché ────────────────────────────────────────────────────────────────
const qtyRow = (key, value = 10) => `<div class="qty"><button data-step="-10" aria-label="moins">−</button><input type="number" min="1" step="1" value="${value}" inputmode="numeric" data-qty="${key}"><button data-step="10" aria-label="plus">+</button></div>`;

function buildMarket() {
  const p = $('#panel-market');
  p.innerHTML = Object.entries(RES).map(([id, r]) => `
    <div class="mk-row" data-res="${id}">
      <div class="mk-head">
        <span class="mk-icon">${r.icon}</span>
        <div class="grow"><div class="mk-name">${r.name}</div><div class="tiny muted" data-f="stock"></div></div>
        <div class="mk-price"><b data-f="price"></b><div class="tiny muted" data-f="sell"></div></div>
      </div>
      <div class="mk-ctrl">
        ${qtyRow(id)}
        <button class="btn btn-sm btn-ghost" data-max>Max</button>
        <div class="mk-btns"><button class="btn btn-gold" data-buy>Acheter</button><button class="btn" data-sell>Vendre</button></div>
      </div>
      <div class="tiny dim" data-f="preview"></div>
    </div>`).join('') + '<p class="tiny dim" data-f="foot"></p>';
  p.dataset.built = '1';
}

function renderMarket(s, c) {
  const p = $('#panel-market');
  if (!p.dataset.built) buildMarket();
  const C = cfg();
  const left = s.isTutorial ? Infinity : C.ACTIONS_PER_PERIOD - s.me.actionsUsed;
  const open = s.phase === 'prosperity' && !c.eliminated && !s.paused;
  for (const id of Object.keys(RES)) {
    const row = p.querySelector(`[data-res="${id}"]`);
    const price = s.prices[id], prev = s.prevPrices[id];
    const diff = prev ? Math.round((price - prev) / prev * 100) : 0;
    const inc = C.INCOME_PER_UNIT[id];
    row.querySelector('[data-f="price"]').innerHTML = `${fmt(price)} or ${diff > 4 ? `<span class="trend-up">▲${diff} %</span>` : diff < -4 ? `<span class="trend-down">▼${-diff} %</span>` : ''}`;
    row.querySelector('[data-f="sell"]').textContent = `revente ${fmt(s.sellPrices[id])} or`;
    row.querySelector('[data-f="stock"]').textContent = `Stock ${fmt(c[id])}` + (inc ? ` · rapporte ${inc} or/unité/période` : ` · consommation ${s.me.foodNeed}/période`);
    const qty = Math.max(1, Math.floor(Number(row.querySelector('input').value) || 1));
    row.querySelector('[data-f="preview"]').textContent = `${fmt(qty)} unités : achat ${fmt(qty * price)} or · revente ${fmt(qty * s.sellPrices[id])} or · max achetable ${fmt(Math.floor(c.treasury / price))}`;
    row.querySelector('[data-buy]').disabled = !open || left <= 0 || c.treasury < price;
    row.querySelector('[data-sell]').disabled = !open || c[id] < 1;
  }
  p.querySelector('[data-f="foot"]').textContent = `Achat au prix du marché (1 action) · revente libre à ${Math.round(C.SELL_RATIO * 100)} % du prix. Les prix reviennent progressivement vers leur niveau de base.`;
}

function readQty(row) {
  const input = row.querySelector('input');
  const n = Math.floor(Number(input.value));
  if (!Number.isFinite(n) || n < 1) { input.value = 1; return 1; }
  return n;
}

$('#panel-market').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-res]');
  if (!row) return;
  const res = row.dataset.res, c = myCountry(), s = S();
  const input = row.querySelector('input');
  const step = e.target.closest('[data-step]')?.dataset.step;
  if (step) { input.value = Math.max(1, readQty(row) + Number(step)); renderMarket(s, c); return; }
  if (e.target.closest('[data-max]')) { input.value = Math.max(1, Math.floor(c.treasury / s.prices[res])); renderMarket(s, c); return; }
  if (e.target.closest('[data-buy]')) { const r = await send('team:buy', { resource: res, qty: readQty(row) }); if (r.ok) toast(`Achat : ${fmt(readQty(row))} ${RES[res].name.toLowerCase()} pour ${fmt(r.total)} or`, 'good'); }
  if (e.target.closest('[data-sell]')) { const r = await send('team:sell', { resource: res, qty: readQty(row) }); if (r.ok) toast(`Vente : +${fmt(r.total)} or`, 'good'); }
});
$('#panel-market').addEventListener('input', () => renderMarket(S(), myCountry()));

// ── Armée ─────────────────────────────────────────────────────────────────
const MIL = [
  { kind: 'soldiers', icon: '🪖', name: 'Soldats', cost: () => cfg().SOLDIER_COST, desc: () => 'Chaque soldat compte dans la force d\'attaque et de défense.' },
  { kind: 'atk', icon: '⚔️', name: 'Technologie offensive', cost: () => cfg().ATK_COST, desc: () => `+${Math.round(cfg().ATK_PER_POINT * 100)} % de force d'attaque par point.` },
  { kind: 'def', icon: '🛡️', name: 'Technologie défensive', cost: () => cfg().DEF_COST, desc: () => `+${Math.round(cfg().DEF_PER_POINT * 100)} % de force de défense par point.` },
];

function buildArmy() {
  const p = $('#panel-army');
  p.innerHTML = `
    <div class="mil-stats" data-f="stats"></div>
    <div class="card locked" data-f="locked"><div class="big">🔒</div><p>L'armée se débloque en <b>période ${cfg().MILITARY_UNLOCK_PERIOD}</b>.</p><p class="tiny dim">Profitez des premières périodes pour faire fructifier votre économie.</p></div>
    <div class="stack" data-f="open">
      ${MIL.map(m => `
        <div class="mk-row" data-kind="${m.kind}">
          <div class="mk-head"><span class="mk-icon">${m.icon}</span><div class="grow"><div class="mk-name">${m.name}</div><div class="tiny muted">${m.desc()}</div></div><div class="mk-price"><b>${fmt(m.cost())} or</b><div class="tiny muted">par unité</div></div></div>
          <div class="mk-ctrl">${qtyRow(m.kind)}<button class="btn btn-sm btn-ghost" data-max>Max</button><div class="mk-btns"><button class="btn btn-gold" data-invest>Investir</button></div></div>
          <div class="tiny dim" data-f="preview"></div>
        </div>`).join('')}
    </div>`;
  p.dataset.built = '1';
}

function renderArmy(s, c) {
  const p = $('#panel-army');
  if (!p.dataset.built) buildArmy();
  p.querySelector('[data-f="stats"]').innerHTML =
    `<div class="stat"><b>🪖 ${fmt(c.army)}</b><small>Soldats</small></div><div class="stat"><b>⚔️ ${fmt(c.atk)}</b><small>ATK</small></div><div class="stat"><b>🛡️ ${fmt(c.def)}</b><small>DEF</small></div>`;
  p.querySelector('[data-f="locked"]').hidden = s.militaryOpen;
  p.querySelector('[data-f="open"]').hidden = !s.militaryOpen;
  const left = s.isTutorial ? Infinity : cfg().ACTIONS_PER_PERIOD - s.me.actionsUsed;
  for (const m of MIL) {
    const row = p.querySelector(`[data-kind="${m.kind}"]`);
    const qty = Math.max(1, Math.floor(Number(row.querySelector('input').value) || 1));
    row.querySelector('[data-f="preview"]').textContent = `${fmt(qty)} × ${fmt(m.cost())} = ${fmt(qty * m.cost())} or · max ${fmt(Math.floor(c.treasury / m.cost()))}`;
    row.querySelector('[data-invest]').disabled = !s.militaryOpen || left <= 0 || c.treasury < m.cost() || c.eliminated || s.paused;
  }
}

$('#panel-army').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-kind]');
  if (!row) return;
  const kind = row.dataset.kind, c = myCountry();
  const m = MIL.find(x => x.kind === kind);
  const input = row.querySelector('input');
  const step = e.target.closest('[data-step]')?.dataset.step;
  if (step) { input.value = Math.max(1, readQty(row) + Number(step)); renderArmy(S(), c); return; }
  if (e.target.closest('[data-max]')) { input.value = Math.max(1, Math.floor(c.treasury / m.cost())); renderArmy(S(), c); return; }
  if (e.target.closest('[data-invest]')) { const r = await send('team:invest', { kind, qty: readQty(row) }); if (r.ok) toast(`Investissement : ${fmt(r.total)} or`, 'good'); }
});
$('#panel-army').addEventListener('input', () => renderArmy(S(), myCountry()));

// ── Diplomatie ────────────────────────────────────────────────────────────
function renderDiplomacy(s, c) {
  const me = s.me, C = cfg();
  const ally = s.alliances[me.name];
  const allyCountry = ally && countryOfTeam(s, ally.with);
  let html = '';
  if (ally) {
    html += `<div class="card" style="border-color:rgba(34,197,94,.5)"><div class="card-title" style="color:#86efac">Alliance conclue</div><p style="margin:0">${ally.type === 'peace' ? '🕊️ Non-agression' : '⚔️ Alliance offensive'} avec ${nation(allyCountry)}.</p><p class="small muted" style="margin:6px 0 0">${ally.type === 'peace' ? 'Si vous êtes les deux derniers survivants : double victoire.' : `+${Math.round(C.OFFENSIVE_ALLIANCE_BONUS * 100)} % en attaque pendant toute la guerre.`}</p></div>`;
  } else if (me.proposalOut) {
    html += `<div class="card"><p style="margin:0">⏳ Proposition envoyée à ${nation(countryOfTeam(s, me.proposalOut.to))} — réponse attendue (<span data-cd="proposalOut">${me.proposalOut.secondsLeft}</span> s).</p></div>`;
  } else {
    html += `<div class="card">
      <div class="card-title">Type d'alliance</div>
      <div class="ally-types">
        <button class="ally-type ${allyType === 'peace' ? 'selected' : ''}" data-type="peace"><b>🕊️ Non-agression</b><div class="tiny muted">Gratuite. Interdiction de s'attaquer. Double victoire si vous êtes les deux derniers.</div></button>
        <button class="ally-type ${allyType === 'offensive' ? 'selected' : ''}" data-type="offensive"><b>⚔️ Offensive</b><div class="tiny muted">${C.OFFENSIVE_ALLIANCE_COST} or. +${Math.round(C.OFFENSIVE_ALLIANCE_BONUS * 100)} % en attaque pour les deux, toute la guerre.</div></button>
      </div>
      <p class="tiny dim" style="margin:8px 0 0">Plus vous êtes haut dans le classement, moins vous avez de partenaires possibles : le 1er ne peut proposer qu'au dernier, le 2e aux deux derniers, etc.</p>
    </div>`;
  }
  html += `<div class="card"><div class="card-title">Classement avant la guerre</div><div class="rank-list">${s.ranking.map(r => {
    const rc = s.countries[r.id];
    const isMe = r.team === me.name;
    const theirAlly = s.alliances[r.team];
    const canPropose = !ally && !me.proposalOut && me.partners.includes(r.team) && !theirAlly;
    return `<div class="rank-item ${isMe ? 'me' : ''}">
      <span class="rank-pos">${r.rank}</span>
      <div class="grow">${nation(rc)}<div class="tiny dim">${esc(r.team)} · ${fmt(r.power)} pts${theirAlly ? ` · allié à ${esc(countryOfTeam(s, theirAlly.with)?.name || '')}` : ''}</div></div>
      ${canPropose ? `<button class="btn btn-sm btn-gold" data-propose="${esc(r.team)}">Proposer</button>` : isMe ? '<span class="badge badge-gold">Vous</span>' : ''}
    </div>`;
  }).join('')}</div></div>`;
  $('#panel-diplomacy').innerHTML = html;
}

$('#panel-diplomacy').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-type]')?.dataset.type;
  if (t) { allyType = t; renderGame(); return; }
  const to = e.target.closest('[data-propose]')?.dataset.propose;
  if (to) { const r = await send('team:proposeAlliance', { to, type: allyType }); if (r.ok) toast('Proposition envoyée.', 'good'); }
});

// ── Guerre ────────────────────────────────────────────────────────────────
function enemies(s, c) {
  const ally = s.alliances[s.me.name];
  return aliveNations(s).filter(x => x.id !== c.id && !(ally && x.team === ally.with));
}

function renderWar(s, c) {
  const w = s.war;
  const myTurn = w?.team === s.me.name && !w.resolving && !s.gameOver;
  const cur = w?.team && countryOfTeam(s, w.team);
  let turn = '';
  if (s.gameOver) turn = '';
  else if (!w?.started) turn = '<div class="card turn-box"><h2>⚔️ La guerre commence…</h2><p class="small muted">L\'ordre des tours est tiré au sort à chaque manche.</p></div>';
  else if (myTurn) turn = `<div class="card turn-box mine"><div class="tiny muted">Manche ${w.round}/${w.maxRounds}</div><h2>C'est votre tour !</h2><div class="countdown num" data-cd="turn">${w.turnSeconds}</div><p class="tiny muted" style="margin:0">Attaquez, fortifiez-vous ou passez.</p></div>`;
  else turn = `<div class="card turn-box"><div class="tiny muted">Manche ${w.round}/${w.maxRounds}</div><p style="margin:4px 0">Tour de ${cur ? nation(cur) : '…'}</p><div class="countdown num" data-cd="turn">${w.resolving ? '…' : w.turnSeconds}</div></div>`;
  $('#war-turn').innerHTML = turn;

  const targets = c.eliminated || s.gameOver ? [] : enemies(s, c);
  if (war.target && !targets.some(t => t.id === war.target)) { war.target = null; war.preview = null; }
  if (!map) map = new WorldMap($('#war-map'), { labels: false, flag: 18, onSelect: (id) => { war.target = id; refreshPreview(true); renderGame(); } });
  map.update(s, { current: w?.team, selected: war.target, mine: c.id, targets: targets.map(t => t.id) });

  if (c.eliminated || s.gameOver) {
    $('#war-controls').innerHTML = feedHtml(s);
    return;
  }
  const C = cfg();
  const t = war.target && s.countries[war.target];
  const hits = t ? (w?.attacksReceived?.[t.id] || 0) : 0;
  const engaged = Math.max(1, Math.round(c.army * war.commit));
  const pv = war.preview;
  const payOpts = [['gold', '💰', C.ATTACK_COSTS.gold, c.treasury], ['oil', '🛢️', C.ATTACK_COSTS.oil, c.oil], ['food', '🌾', C.ATTACK_COSTS.food, c.food]];
  const payGoldShort = war.pay === 'gold' && c.treasury < C.ATTACK_COSTS.gold;
  $('#war-controls').innerHTML = `
    <div class="card stack">
      ${t ? `<div class="target-box">${flag(t, 'flag-lg')}<div class="grow"><b>${esc(t.name)}</b> <span class="tiny dim">${esc(t.team)}</span><div class="tiny muted">🪖 ${fmt(t.army)} · 🛡️ DEF ${fmt(t.def)} · 💰 ${fmt(t.treasury)}${t.fortified ? ' · <span class="badge badge-blue">🏰 fortifiée</span>' : ''}</div></div><span class="badge ${hits ? 'badge-red' : ''}">${hits ? 'Blessée : prochain succès = annexion' : '1er assaut : pillage'}</span></div>`
        : `<div><div class="label">Cible</div><p class="small muted" style="margin:0 0 8px">Touchez une nation sur la carte ou choisissez :</p><div class="row wrap">${targets.map(x => `<button class="btn btn-sm" data-target="${x.id}">${flag(x)} ${esc(x.name)}</button>`).join('') || '<span class="dim small">Aucune cible.</span>'}</div></div>`}
      <div><div class="label">Troupes engagées · ${fmt(engaged)} soldats</div><div class="seg">${C.COMMIT_OPTIONS.map(o => `<button class="${war.commit === o ? 'on' : ''}" data-commit="${o}">${Math.round(o * 100)} %</button>`).join('')}</div></div>
      <div><div class="label">Coût de l'attaque</div><div class="seg">${payOpts.map(([k, icon, cost, have]) => `<button class="${war.pay === k ? 'on' : ''}" data-pay="${k}" ${k !== 'gold' && have < cost ? 'disabled' : ''}>${icon} ${cost}</button>`).join('')}</div>
        ${payGoldShort ? `<p class="tiny bad" style="margin:4px 0 0">Pas assez d'or : ${Math.round(C.NO_RESOURCE_SACRIFICE * 100)} % de vos soldats seront sacrifiés.</p>` : ''}</div>
      ${t ? `<div><div class="row-between tiny"><span class="good">Victoire ${pv ? pv.probability + ' %' : '…'}</span><span class="bad">Échec ${pv ? 100 - pv.probability + ' %' : '…'}</span></div><div class="odds"><i style="width:${pv ? pv.probability : 50}%"></i></div>
        <p class="tiny dim" style="margin:4px 0 0">Force estimée : vous ${pv ? fmt(pv.attStrength) : '…'} contre ${pv ? fmt(pv.defStrength) : '…'} (aléa ±${Math.round(C.COMBAT_VARIANCE * 100)} %). En cas d'échec : −25 % de votre or.</p></div>` : ''}
      <div class="war-actions">
        <button class="btn btn-red btn-lg btn-attack" data-attack ${myTurn && t ? '' : 'disabled'}>⚔️ Attaquer</button>
        <button class="btn btn-blue" data-fortify ${myTurn ? '' : 'disabled'} title="+${Math.round(C.FORTIFY_BONUS * 100)} % de défense jusqu'à votre prochain tour">🏰 Fortifier</button>
        <button class="btn" data-skip ${myTurn ? '' : 'disabled'}>Passer</button>
      </div>
    </div>
    ${feedHtml(s)}`;
  refreshPreview(false);
}

function feedHtml(s) {
  const feed = s.war?.feed || [];
  if (!feed.length) return '';
  const line = (f) => {
    const a = s.countries[f.attacker], d = f.defender && s.countries[f.defender];
    if (f.outcome === 'fortify') return `🏰 ${nation(a)} se fortifie`;
    const verb = { raid: '⚔️ pille', conquest: '🏴 annexe', repelled: '🛡️ échoue contre' }[f.outcome];
    return `${nation(a)} <span class="dim">${verb}</span> ${nation(d)}`;
  };
  return `<div class="card"><div class="card-title">Derniers combats</div>${feed.slice(0, 8).map(f => `<div class="feed-item"><span class="tiny dim">M${f.round}</span>${line(f)}</div>`).join('')}</div>`;
}

async function refreshPreview(force) {
  const s = S(), c = myCountry();
  if (!war.target || !c || s.phase !== 'war') return;
  const t = s.countries[war.target];
  const key = [war.target, war.commit, c.army, c.atk, t.army, t.def, t.fortified, JSON.stringify(s.alliances[s.me.name] || null)].join('|');
  if (!force && key === war.previewKey) return;
  war.previewKey = key;
  const res = await send('team:previewAttack', { targetId: war.target, commit: war.commit }, { silent: true });
  if (res.ok && war.previewKey === key) { war.preview = res; if (tab === 'war') renderWar(S(), myCountry()); }
}

$('#war-controls').addEventListener('click', async (e) => {
  const el = (sel) => e.target.closest(sel);
  if (el('[data-target]')) { war.target = el('[data-target]').dataset.target; war.preview = null; refreshPreview(true); renderGame(); return; }
  if (el('[data-commit]')) { war.commit = Number(el('[data-commit]').dataset.commit); war.preview = null; refreshPreview(true); renderGame(); return; }
  if (el('[data-pay]')) { war.pay = el('[data-pay]').dataset.pay; renderGame(); return; }
  if (el('[data-fortify]')) { await send('team:fortify'); return; }
  if (el('[data-skip]')) { await send('team:skipTurn'); return; }
  if (el('[data-attack]')) {
    const s = S(), t = s.countries[war.target];
    const m = modal(`<div class="stack" style="text-align:center">
      <div class="row" style="justify-content:center;gap:16px">${flag(myCountry(), 'flag-xl')}<span style="font-size:22px">⚔️</span>${flag(t, 'flag-xl')}</div>
      <h2>Attaquer ${esc(t.name)} ?</h2>
      <p class="small muted">${fmt(Math.max(1, Math.round(myCountry().army * war.commit)))} soldats engagés · chances estimées ${war.preview ? war.preview.probability + ' %' : '?'}</p>
      <div class="row"><button class="btn grow" data-x="no">Annuler</button><button class="btn btn-red grow" data-x="yes">⚔️ Lancer l'assaut</button></div></div>`);
    m.el.addEventListener('click', async (ev) => {
      const x = ev.target.closest('[data-x]')?.dataset.x;
      if (x === 'no') m.close();
      if (x === 'yes') { m.close(); await send('team:attack', { targetId: war.target, payWith: war.pay, commit: war.commit }); }
    });
  }
});

socket.on('attackResult', (r) => {
  const s = S();
  if (!s) return;
  const a = s.countries[r.attacker], d = s.countries[r.defender];
  map?.animateAttack(r.attacker, r.defender, r.outcome, a?.color);
  const meId = myCountry()?.id;
  if (r.attacker !== meId && r.defender !== meId) {
    toast(`${a.name} ${r.outcome === 'repelled' ? 'échoue contre' : r.outcome === 'conquest' ? 'annexe' : 'pille'} ${d.name}`);
    return;
  }
  const iAttacked = r.attacker === meId;
  const won = (r.outcome !== 'repelled') === iAttacked;
  const title = { raid: iAttacked ? 'Pillage réussi !' : 'Vous avez été pillés !', conquest: iAttacked ? 'Nation annexée !' : 'Votre nation est tombée', repelled: iAttacked ? 'Attaque repoussée' : 'Attaque repoussée !' }[r.outcome];
  const icon = { raid: '⚔️', conquest: '🏴', repelled: '🛡️' }[r.outcome];
  beep(won ? 1046 : 330, 2);
  const m = modal(`<div class="stack result-hero">
    <div class="big">${icon}</div><h2 class="${won ? 'good' : 'bad'}">${title}</h2>
    <p class="small muted">${nation(a)} ${fmt(r.scoreAtt)} contre ${fmt(r.scoreDef)} ${nation(d)}</p>
    <p class="small">Pertes : ${fmt(r.lossAtt)} soldats pour l'attaquant · ${fmt(r.lossDef)} pour le défenseur${r.loot.treasury ? ` · butin ${fmt(r.loot.treasury)} or` : ''}${r.loot.lostGold ? ` · −${fmt(r.loot.lostGold)} or de frais` : ''}</p>
    <button class="btn" data-x="ok">OK</button></div>`);
  m.el.addEventListener('click', (ev) => { if (ev.target.closest('[data-x]')) m.close(); });
  setTimeout(() => m.close(), 9000);
});

// ── Journal & règles ──────────────────────────────────────────────────────
function renderNews(s) {
  const news = [...(s.me.news || [])].reverse();
  $('#panel-news').innerHTML = news.length
    ? news.map(n => `<div class="news ${n.type}"><time>${esc(n.time)}</time>${esc(n.text)}</div>`).join('')
    : '<p class="muted small">Aucune actualité pour le moment.</p>';
}

function renderRules() {
  const p = $('#panel-rules');
  if (p.dataset.built) return;
  const C = cfg();
  const P = (n) => Math.round(n * 100) + ' %';
  p.innerHTML = `<div class="card rules">
    <h3>🎯 Objectif</h3><p>Être la dernière nation debout à la fin de la guerre. Deux alliés en non-agression qui survivent seuls partagent la victoire. Après ${C.WAR_MAX_ROUNDS} manches de guerre, la nation la plus puissante l'emporte.</p>
    <h3>📅 Déroulé</h3><ul><li>${C.TOTAL_PERIODS} périodes de paix, puis une négociation, puis la guerre.</li><li>Chaque période affiche un <b>indice</b> : il annonce l'événement qui frappera au <b>début de la période suivante</b> (prix, revenus, bonus ou malus).</li><li>En période 4, un <b>choix stratégique</b> s'impose à tous (option B automatique sans réponse).</li></ul>
    <h3>💰 Économie</h3><ul><li>${C.ACTIONS_PER_PERIOD} actions par période : chaque achat ou investissement militaire en consomme une. La vente est libre, à ${P(C.SELL_RATIO)} du prix.</li><li>Revenus à chaque nouvelle période : pétrole ${C.INCOME_PER_UNIT.oil} or/unité, tourisme ${C.INCOME_PER_UNIT.tourism}, agriculture ${C.INCOME_PER_UNIT.agriculture}, plus un revenu de base.</li><li>Chaque période consomme de la nourriture (selon la population). Une famine coûte des points de puissance.</li><li>Une période sans aucune action coûte ${C.INACTIVITY_PENALTY} points.</li></ul>
    <h3>🪖 Armée (dès la période ${C.MILITARY_UNLOCK_PERIOD})</h3><ul><li>Soldat : ${C.SOLDIER_COST} or · ATK : ${C.ATK_COST} or (+${P(C.ATK_PER_POINT)} d'attaque) · DEF : ${C.DEF_COST} or (+${P(C.DEF_PER_POINT)} de défense).</li><li>Tier B : +${P(C.TIER_B_BONUS - 1)} en combat.</li></ul>
    <h3>🤝 Négociation</h3><ul><li>Non-agression (gratuite) : impossible de s'attaquer, double victoire si vous êtes les deux derniers.</li><li>Offensive (${C.OFFENSIVE_ALLIANCE_COST} or) : impossible de s'attaquer, +${P(C.OFFENSIVE_ALLIANCE_BONUS)} en attaque toute la guerre.</li><li>Le 1er du classement ne peut proposer qu'au dernier, le 2e aux deux derniers, etc.</li></ul>
    <h3>⚔️ Guerre</h3><ul><li>Chacun son tour (${C.WAR_TURN_SECONDS} s) : attaquer, se fortifier (+${P(C.FORTIFY_BONUS)} de défense jusqu'à son prochain tour) ou passer.</li><li>Une attaque coûte ${C.ATTACK_COSTS.gold} or, ${C.ATTACK_COSTS.oil} pétrole ou ${C.ATTACK_COSTS.food} nourriture. Sans or, ${P(C.NO_RESOURCE_SACRIFICE)} de vos soldats sont sacrifiés.</li><li>Force = soldats engagés × technologie × tier × aléa (±${P(C.COMBAT_VARIANCE)}).</li><li>1er assaut réussi : pillage de ${P(C.FIRST_ASSAULT_LOOT)} des réserves. Assaut suivant réussi : <b>annexion</b> (tout le butin, la moitié des soldats se rallient, le territoire change de couleur).</li><li>Attaque repoussée : l'attaquant perd 25 % de son or.</li></ul>
  </div>`;
  p.dataset.built = '1';
}

// ════════════════════════════════════════════════════════════════════════
// Horloge & événements temps réel
// ════════════════════════════════════════════════════════════════════════
function updateClock(clk) {
  const s = S();
  if (!s || !s.me) return;
  const el = $('#tb-timer');
  if (s.phase === 'war' && clk.war?.team) {
    el.textContent = clk.war.resolving ? '…' : mmss(clk.war.seconds);
    el.classList.toggle('urgent', !clk.war.resolving && clk.war.seconds <= 10 && clk.war.team === s.me.name);
  } else if ((s.phase === 'prosperity' || s.phase === 'negotiation') && !s.gameOver) {
    el.textContent = mmss(clk.timer.seconds);
    el.classList.toggle('urgent', clk.timer.running && clk.timer.seconds <= 60);
  } else {
    el.textContent = '';
  }
  const set = (key, v, urgentAt) => document.querySelectorAll(`[data-cd="${key}"]`).forEach(x => { x.textContent = v; x.classList.toggle('urgent', Number(v) <= urgentAt); });
  if (clk.choice) set('choice', clk.choice.secondsLeft, 15);
  if (clk.war) set('turn', clk.war.resolving ? '…' : clk.war.seconds, 10);
}
onClock(updateClock);

socket.on('transition', ({ kind, period, seconds }) => {
  if (!S()?.me?.country) return;
  const text = kind === 'period' ? `Période ${period}` : kind === 'negotiation' ? 'Phase de négociation' : 'La guerre est déclarée';
  $('#transition-text').textContent = text;
  const ov = $('#overlay-transition');
  const bar = $('#transition-bar');
  ov.hidden = false;
  bar.style.transition = 'none'; bar.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `width ${seconds}s linear`; bar.style.width = '100%'; }));
  clearTimeout(ov._t);
  ov._t = setTimeout(() => { ov.hidden = true; }, seconds * 1000);
});
$('#overlay-transition').addEventListener('click', () => { $('#overlay-transition').hidden = true; });

socket.on('choiceOpen', () => { if (S()?.me?.country) { beep(660, 2); navigator.vibrate?.(200); } });
socket.on('allianceProposal', () => { beep(740, 2); navigator.vibrate?.(200); });
socket.on('allianceAnswer', ({ accepted }) => toast(accepted ? 'Alliance acceptée !' : 'Alliance refusée.', accepted ? 'good' : 'error'));
socket.on('allianceExpired', () => toast('Proposition expirée.'));
socket.on('warTurn', ({ team }) => { if (team === S()?.me?.name) { beep(988, 3); navigator.vibrate?.([200, 100, 200]); } });
socket.on('timerEnded', () => { if (S()?.me?.country && S().phase !== 'war') { beep(523, 3); toast('⏰ Temps écoulé !'); } });
socket.on('winner', () => beep(1175, 4));
