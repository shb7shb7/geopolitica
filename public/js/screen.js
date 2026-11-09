import { socket, store, onState, onClock, $, esc, fmt, mmss, RES, flag, nation, countryOfTeam, aliveNations } from './common.js';
import { WorldMap } from './worldmap.js';

let view = null;
let draftMap = null, warMap = null;
let interacted = false;
let overlayBusy = false;
const reveal = { key: null, timer: null, done: false };

// Le son des vidéos n'est autorisé qu'après une interaction avec la page.
document.addEventListener('click', () => { interacted = true; $('#start-hint').classList.add('gone'); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') { interacted = true; document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
});
setTimeout(() => $('#start-hint').classList.add('gone'), 20000);

function setView(id) {
  if (view === id) return;
  view = id;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
}

const foodNeed = (c) => Math.max(store.config.FOOD_MIN, Math.min(store.config.FOOD_MAX, Math.round(c.population / 5 + 5)));

function render(s) {
  if (s.gameOver) { renderWinner(s); setView('view-winner'); renderChoice(s); return; }
  if (s.phase === 'setup') setView('view-setup');
  else if (s.phase === 'draft') { setView('view-draft'); renderDraft(s); }
  else if (s.phase === 'prosperity') { setView('view-prosperity'); renderProsperity(s); }
  else if (s.phase === 'negotiation') { setView('view-negotiation'); renderNegotiation(s); }
  else if (s.phase === 'war') { setView('view-war'); renderWar(s); }
  if (s.phase !== 'negotiation') { reveal.key = null; clearTimeout(reveal.timer); }
  renderChoice(s);
  if (store.clock) updateClock(store.clock);
}
onState(render);

// ── Inscriptions ─────────────────────────────────────────────────────────
let qrFor = null;
function renderDraft(s) {
  if (s.sessionCode !== qrFor) {
    qrFor = s.sessionCode;
    $('#qr').src = '/qr.svg?c=' + encodeURIComponent(s.sessionCode || '');
  }
  $('#join-url').textContent = location.host;
  $('#join-code').textContent = s.sessionCode || '';
  if (!draftMap) draftMap = new WorldMap($('#draft-map'), { labels: true, flag: 15 });
  draftMap.update(s);
  $('#draft-teams').innerHTML = s.teams.map(t => {
    const c = t.country && s.countries[t.country];
    return c
      ? `<span class="chip"><span class="swatch" style="background:${c.color}"></span>${flag(c)} <b>${esc(c.name)}</b> <span class="dim">${esc(t.name)}</span></span>`
      : `<span class="chip waiting">⏳ ${esc(t.name)}</span>`;
  }).join('') || '<span class="dim">Aucune équipe pour le moment…</span>';
}

// ── Prospérité ───────────────────────────────────────────────────────────
function renderProsperity(s) {
  const pi = s.periodInfo || {};
  $('#pr-badge').textContent = s.isTutorial ? 'Manche test' : `Période ${s.period} / ${s.totalPeriods}`;
  $('#pr-overline').textContent = s.isTutorial ? 'Découverte · rien ne compte' : `Année ${s.period}`;
  $('#pr-name').textContent = pi.name || '';
  $('#pr-desc').textContent = pi.desc || '';
  const lt = s.lastTransition;
  $('#pr-happened').innerHTML = lt && !s.isTutorial ? `<div class="happened">
    <h3>⚡ ${lt.icon} ${esc(lt.title)}</h3><div class="muted">${esc(lt.explanation)}</div>
    <div class="changes">${lt.changes.map(ch => {
      const p = ch.from ? Math.round((ch.to - ch.from) / ch.from * 100) : 0;
      return `<div class="chg">${RES[ch.res].icon} ${RES[ch.res].name}<b>${fmt(ch.to)}</b><span class="${p > 4 ? 'trend-up' : p < -4 ? 'trend-down' : 'dim'}">${p > 0 ? '+' : ''}${p} %</span></div>`;
    }).join('')}</div></div>` : '';
  $('#pr-hint').innerHTML = pi.hint ? `<div class="lbl">🔮 Indice pour la prochaine période</div><div class="txt">${esc(pi.hint)}</div>` : '';
  $('#pr-hint').hidden = !pi.hint;

  const alive = aliveNations(s).sort((a, b) => b.power - a.power);
  const C = store.config;
  $('#pr-lb').classList.toggle('compact', alive.length > 12);
  $('#pr-lb').innerHTML = alive.map((c, i) => {
    const used = s.actions[c.team] || 0;
    const pips = s.isTutorial ? '' : `<span class="pips">${Array.from({ length: C.ACTIONS_PER_PERIOD }, (_, k) => `<i class="${k < used ? 'used' : ''}"></i>`).join('')}</span>`;
    const hungry = c.food < foodNeed(c) * 1.5;
    return `<div class="lb-row ${i === 0 ? 'first' : ''}">
      <span class="lb-pos">${i + 1}</span>
      <div style="min-width:0"><div class="lb-name">${flag(c)}<span>${esc(c.name)}</span><span class="swatch" style="background:${c.color}"></span></div><div class="lb-sub">${esc(c.team)} · 💰 ${fmt(c.treasury)} · 🪖 ${fmt(c.army)}</div></div>
      <div><div class="lb-pw num">${fmt(c.power)}</div><div class="lb-tags">${hungry ? '<span class="badge badge-red">🍞 famine</span>' : ''}${pips}</div></div>
    </div>`;
  }).join('');
}

// ── Négociation ──────────────────────────────────────────────────────────
function renderNegotiation(s) {
  const ranking = s.ranking;
  const key = ranking.map(r => r.id).join(',');
  if (reveal.key !== key) {
    reveal.key = key;
    reveal.done = false;
    clearTimeout(reveal.timer);
    const order = [...ranking].reverse();
    let i = 0;
    const step = () => {
      if (i >= order.length) {
        reveal.done = true;
        $('#ng-reveal').innerHTML = `<div class="reveal-card"><div class="reveal-rank">La guerre approche</div><div class="reveal-name">Formez vos alliances</div><p class="hero-sub">Non-agression : double victoire si vous êtes les deux derniers</p></div>`;
        renderNegotiationList(store.state);
        return;
      }
      const r = order[i++];
      const c = store.state.countries[r.id];
      $('#ng-reveal').innerHTML = `<div class="reveal-card"><div class="reveal-rank">${r.rank === 1 ? '🏆 Nation la plus puissante' : `${r.rank}e sur ${ranking.length}`}</div>${flag(c, 'flag-xl')}<div class="reveal-name">${esc(c.name)}</div><div class="reveal-pw">${fmt(r.power)} pts</div><div class="muted">${esc(c.team)}</div></div>`;
      renderNegotiationList(store.state, i);
      reveal.timer = setTimeout(step, r.rank <= 3 ? 3800 : 2200);
    };
    step();
  }
  renderNegotiationList(s);
}

function renderNegotiationList(s, revealedCount) {
  const n = reveal.done ? s.ranking.length : (revealedCount ?? Number($('#ng-list').dataset.n || 0));
  $('#ng-list').dataset.n = n;
  const shown = s.ranking.slice(s.ranking.length - n);
  $('#ng-list').classList.toggle('compact', s.ranking.length > 12);
  $('#ng-list').innerHTML = shown.map(r => {
    const c = s.countries[r.id];
    const a = s.alliances[r.team];
    return `<div class="lb-row ${r.rank === 1 ? 'first' : ''}"><span class="lb-pos">${r.rank}</span><div class="lb-name">${flag(c)}<span>${esc(c.name)}</span>${a ? (a.type === 'peace' ? ' 🕊️' : ' ⚔️') : ''}</div><div class="lb-pw num">${fmt(r.power)}</div></div>`;
  }).join('');
  const seen = new Set();
  const pairs = [];
  for (const [team, a] of Object.entries(s.alliances)) {
    if (seen.has(team)) continue;
    seen.add(a.with);
    pairs.push(`<div style="padding:4px 0">${a.type === 'peace' ? '🕊️' : '⚔️'} ${nation(countryOfTeam(s, team))} &nbsp;&amp;&nbsp; ${nation(countryOfTeam(s, a.with))}</div>`);
  }
  $('#ng-alliances').innerHTML = pairs.join('') || '<span class="dim">Aucune alliance pour le moment.</span>';
}

// ── Guerre ───────────────────────────────────────────────────────────────
function renderWar(s) {
  const w = s.war;
  const cur = w?.team && countryOfTeam(s, w.team);
  $('#war-ticker').innerHTML = `
    <span class="title">⚔️ Guerre mondiale</span>
    ${w?.started ? `<span class="badge badge-red big-badge">Manche ${w.round}/${w.maxRounds}</span>` : ''}
    <span class="grow"></span>
    ${cur ? `<span class="cur">${flag(cur, 'flag-lg')} ${esc(cur.name)}</span><span class="cd num" data-cd="turn">${w.resolving ? '…' : w.turnSeconds}</span>` : ''}
    <span class="order">${(w?.order || []).map((t, i) => { const c = countryOfTeam(s, t); return c ? flag(c, i === w.index ? 'now' : i < w.index || c.eliminated ? 'done' : '') : ''; }).join('')}</span>`;
  if (!warMap) warMap = new WorldMap($('#war-map'), { labels: true, flag: 18 });
  warMap.update(s, { current: w?.team });

  const all = Object.values(s.countries).filter(c => c.team || c.conqueredBy);
  const alive = all.filter(c => !c.eliminated).sort((a, b) => b.power - a.power);
  const dead = all.filter(c => c.eliminated);
  $('#war-nations').classList.toggle('compact', all.length > 10);
  $('#war-nations').innerHTML = [...alive, ...dead].map(c => {
    const by = c.conqueredBy && s.countries[c.conqueredBy];
    const hits = w?.attacksReceived?.[c.id] || 0;
    return `<div class="lb-row ${c.eliminated ? 'dead' : ''} ${w?.team && c.team === w.team ? 'turn' : ''}">
      <span class="swatch" style="background:${(by || c).color || '#555'};width:12px;height:12px"></span>
      <div style="min-width:0"><div class="lb-name">${flag(c)}<span>${esc(c.name)}</span>${!c.eliminated && hits ? ' <span class="badge badge-red">blessée</span>' : ''}${c.fortified ? ' 🏰' : ''}</div>
      <div class="lb-sub">${c.eliminated ? (by ? `annexée par ${esc(by.name)}` : 'éliminée') : `🪖 ${fmt(c.army)} · 🏴 ${1 + c.territories.length}`}</div></div>
      <div class="lb-pw num">${c.eliminated ? '' : fmt(c.power)}</div></div>`;
  }).join('');

  const feed = w?.feed || [];
  $('#war-feed').innerHTML = feed.slice(0, 7).map(f => {
    const a = s.countries[f.attacker], d = f.defender && s.countries[f.defender];
    if (f.outcome === 'fortify') return `<div class="feed-line">🏰 ${nation(a)} <span class="dim">se fortifie</span></div>`;
    const verb = { raid: '⚔️ pille', conquest: '🏴 annexe', repelled: '🛡️ repoussé par' }[f.outcome];
    return `<div class="feed-line">${nation(a)} <span class="dim">${verb}</span> ${nation(d)}</div>`;
  }).join('') || '<span class="dim small">Aucun combat pour le moment.</span>';
}

socket.on('attackResult', (r) => {
  const s = store.state;
  if (!s) return;
  const a = s.countries[r.attacker], d = s.countries[r.defender];
  warMap?.animateAttack(r.attacker, r.defender, r.outcome, a.color);
  setTimeout(() => {
    const el = $('#battle');
    const title = { raid: 'Pillage !', conquest: 'Annexion !', repelled: 'Attaque repoussée !' }[r.outcome];
    const icon = { raid: '⚔️', conquest: '🏴', repelled: '🛡️' }[r.outcome];
    el.className = 'battle ' + (r.outcome === 'repelled' ? 'def' : 'ok');
    el.innerHTML = `<div style="font-size:44px">${icon}</div><h2>${title}</h2>
      <div class="vs">${flag(a)}<span style="font-size:30px">⚔️</span>${flag(d)}</div>
      <div class="scores"><b>${esc(a.name)}</b> ${fmt(r.scoreAtt)} &nbsp;contre&nbsp; ${fmt(r.scoreDef)} <b>${esc(d.name)}</b></div>
      <div class="small muted" style="margin-top:6px">Pertes : ${fmt(r.lossAtt)} / ${fmt(r.lossDef)} soldats${r.loot.treasury ? ` · butin ${fmt(r.loot.treasury)} or` : ''}</div>`;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 4200);
  }, 1300);
});

// ── Victoire ─────────────────────────────────────────────────────────────
let winnerKey = null;
function renderWinner(s) {
  const key = s.winners.join(',');
  if (key === winnerKey) return;
  winnerKey = key;
  const winners = s.winners.map(id => s.countries[id]);
  $('#win-flags').innerHTML = winners.map(w => flag(w)).join('');
  $('#win-title').textContent = winners.length > 1 ? `${winners.map(w => w.name).join(' & ')} — double victoire !` : winners[0] ? `${winners[0].name} remporte Geopolitica !` : 'Fin de la partie';
  $('#win-sub').textContent = s.winType === 'alliance' ? 'Un pacte de non-agression honoré jusqu\'au bout' : s.winType === 'score' ? 'La nation la plus puissante à la fin de la guerre' : 'Dernier empire debout';
  const ranked = Object.values(s.countries).filter(c => c.team || c.conqueredBy).sort((a, b) => (a.eliminated - b.eliminated) || b.power - a.power);
  $('#win-lb').innerHTML = ranked.slice(0, 10).map((c, i) => `<div class="lb-row ${i === 0 ? 'first' : ''} ${c.eliminated ? 'dead' : ''}"><span class="lb-pos">${i + 1}</span><div class="lb-name">${flag(c)}<span>${esc(c.name)}</span> <span class="dim small">${esc(c.team || '')}</span></div><div class="lb-pw num">${c.eliminated ? '☠️' : fmt(c.power)}</div></div>`).join('');
  const colors = ['#d4af5a', '#f87171', '#4ade80', '#60a5fa', '#f59e0b', '#a78bfa'];
  $('#confetti').innerHTML = Array.from({ length: 90 }, () => `<i style="left:${Math.random() * 100}%;background:${colors[Math.floor(Math.random() * colors.length)]};animation-duration:${3 + Math.random() * 5}s;animation-delay:${Math.random() * 4}s"></i>`).join('');
}

// ── Choix stratégique en surimpression ───────────────────────────────────
function renderChoice(s) {
  const ch = s.choice;
  const el = $('#choice-overlay');
  if (!ch || ch.opensIn > 0 || overlayBusy || s.gameOver) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="choice-box">
    <div class="overline">⚖️ Choix stratégique — toutes les nations</div>
    <h1>${ch.icon} ${esc(ch.title)}</h1>
    <p class="period-desc">${esc(ch.desc)}</p>
    <div class="opts">${['A', 'B'].map(k => `<div class="opt"><div class="k">${k}</div><b>${esc(ch.options[k].label)}</b><span>${esc(ch.options[k].detail)}</span></div>`).join('')}</div>
    <div class="row" style="justify-content:center;gap:30px"><span class="scr-timer num" data-cd="choice">${ch.secondsLeft}</span><span class="hero-sub">${ch.answered} / ${aliveNations(s).length} réponses</span></div>
  </div>`;
}

// ── Transitions : vidéo puis cinématique ─────────────────────────────────
// Une nouvelle transition annule celle en cours (vidéo ou cinématique).
let transitionSeq = 0;
let cancelVideo = null, cancelCinematic = null;

function playVideo(src, maxSeconds) {
  return new Promise((resolve) => {
    const ov = $('#video-overlay'), v = $('#video'), bar = $('#video-bar');
    let done = false;
    const finish = () => { if (done) return; done = true; cancelVideo = null; clearTimeout(guard); v.pause(); v.removeAttribute('src'); v.load(); bar.style.width = '0%'; ov.hidden = true; resolve(); };
    cancelVideo = finish;
    const guard = setTimeout(finish, maxSeconds * 1000);
    v.muted = !interacted;
    v.src = src;
    v.onended = finish;
    v.onerror = finish;
    v.ontimeupdate = () => { if (v.duration) bar.style.width = `${(v.currentTime / v.duration) * 100}%`; };
    $('#video-skip').onclick = finish;
    ov.hidden = false;
    v.play().catch(() => { v.muted = true; v.play().catch(finish); });
  });
}

let cinTimer = null;
function showCinematic(opts, seconds) {
  const el = $('#cinematic');
  el.className = 'cinematic ' + (opts.theme || '');
  $('#cin-overline').textContent = opts.overline || '';
  $('#cin-title').textContent = opts.title || '';
  $('#cin-sub').textContent = opts.sub || '';
  $('#cin-event').innerHTML = opts.event || '';
  $('#cin-hint').innerHTML = opts.hint || '';
  el.hidden = false;
  // relance les animations
  el.querySelectorAll('.cin-content > *').forEach(n => { n.style.animation = 'none'; n.getBoundingClientRect(); n.style.animation = ''; });
  const bar = $('#cin-bar');
  bar.style.transition = 'none'; bar.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `width ${seconds}s linear`; bar.style.width = '100%'; }));
  clearTimeout(cinTimer);
  return new Promise((resolve) => {
    const end = () => { clearTimeout(cinTimer); cancelCinematic = null; el.hidden = true; resolve(); };
    cancelCinematic = end;
    cinTimer = setTimeout(end, seconds * 1000);
    $('#cin-skip').onclick = end;
  });
}

socket.on('transition', async (t) => {
  const seq = ++transitionSeq;
  cancelVideo?.();
  cancelCinematic?.();
  overlayBusy = true;
  $('#choice-overlay').hidden = true;
  const start = Date.now();
  if (t.video) await playVideo('/media/' + t.video, Math.max(10, t.seconds - 12));
  if (seq !== transitionSeq) return;
  const left = Math.max(8, t.seconds - (Date.now() - start) / 1000);
  const trig = t.triggered;
  const eventHtml = trig ? `⚡ <b>${trig.icon} ${esc(trig.title)}</b> — ${esc(trig.explanation)}` : '';
  if (t.kind === 'period') {
    await showCinematic({
      overline: `Période ${t.period} · Année ${t.period}`, title: t.name, sub: t.desc,
      event: t.choice ? `${eventHtml ? eventHtml + '<br><br>' : ''}⚖️ <b>Dilemme :</b> ${t.choice.icon} ${esc(t.choice.title)}` : eventHtml,
      hint: t.hint ? `🔮 <b>Indice :</b> ${esc(t.hint)}` : '',
    }, left);
  } else if (t.kind === 'negotiation') {
    await showCinematic({ theme: 'negotiation', overline: 'Avant la guerre', title: 'Négociation', sub: 'Dernière chance de former des alliances.', event: eventHtml }, left);
  } else if (t.kind === 'war') {
    await showCinematic({ theme: 'war', overline: 'Alerte mondiale', title: 'La guerre est déclarée', sub: `${t.nations} nations. Une seule régnera.`, event: '⚔️ Chaque nation joue à son tour : attaquer, se fortifier ou passer.' }, left);
  }
  if (seq !== transitionSeq) return;
  overlayBusy = false;
  if (store.state) renderChoice(store.state);
});

// ── Horloge ──────────────────────────────────────────────────────────────
function updateClock(clk) {
  const t = clk.timer;
  for (const id of ['#pr-timer', '#ng-timer']) {
    const el = $(id);
    el.textContent = mmss(t.seconds);
    el.classList.toggle('urgent', t.running && t.seconds <= 60);
  }
  $('#pr-bar').style.width = t.total ? `${(t.seconds / t.total) * 100}%` : '0%';
  if (clk.choice) document.querySelectorAll('[data-cd="choice"]').forEach(x => { x.textContent = clk.choice.secondsLeft; });
  if (clk.war) document.querySelectorAll('[data-cd="turn"]').forEach(x => { x.textContent = clk.war.resolving ? '…' : clk.war.seconds; x.classList.toggle('urgent', !clk.war.resolving && clk.war.seconds <= 10); });
}
onClock(updateClock);
