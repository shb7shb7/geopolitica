/* global io */
// Utilitaires partagés par les pages joueur, MJ et écran.

export const socket = io();
export const store = { config: null, state: null, clock: null, countries: {} };

const stateListeners = new Set();
const clockListeners = new Set();
export const onState = (fn) => stateListeners.add(fn);
export const onClock = (fn) => clockListeners.add(fn);

socket.on('config', (c) => {
  store.config = c;
  store.countries = Object.fromEntries(c.COUNTRIES.map(x => [x.id, x]));
  if (store.state) stateListeners.forEach(fn => fn(store.state));
});
socket.on('state', (s) => {
  store.state = s;
  if (store.config) stateListeners.forEach(fn => fn(s));
});
socket.on('clock', (c) => { store.clock = c; clockListeners.forEach(fn => fn(c)); });

// Bandeau de connexion perdue
let lostEl = null;
socket.on('disconnect', () => {
  if (lostEl) return;
  lostEl = document.createElement('div');
  lostEl.className = 'conn-lost';
  lostEl.textContent = 'Connexion perdue — reconnexion…';
  document.body.appendChild(lostEl);
});
socket.on('connect', () => { lostEl?.remove(); lostEl = null; });

/** Envoie une action au serveur et renvoie sa réponse. Affiche l'erreur éventuelle. */
export function send(event, payload = {}, { silent = false } = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) { if (!silent) toast('Le serveur ne répond pas.', 'error'); return resolve({ ok: false, error: 'timeout' }); }
      if (!res.ok && !silent) toast(res.error, 'error');
      resolve(res);
    });
  });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ESC[ch]);
export const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
export const signed = (n) => (n > 0 ? '+' : '') + fmt(n);
export const pct = (n) => (n > 0 ? '+' : '') + Math.round(n) + ' %';
export const mmss = (sec) => { const s = Math.max(0, sec | 0); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

export const RES = {
  oil: { icon: '🛢️', name: 'Pétrole' },
  food: { icon: '🌾', name: 'Nourriture' },
  tourism: { icon: '🏖️', name: 'Tourisme' },
  agriculture: { icon: '🌿', name: 'Agriculture' },
};

export const flag = (c, cls = '') => c ? `<img class="flag ${cls}" src="/flags/${esc(c.a2)}.svg" alt="">` : '';
export const nation = (c, cls = '') => c ? `<span class="nation">${flag(c, cls)}<span>${esc(c.name)}</span></span>` : '';
export const countryOfTeam = (state, team) => {
  const t = state.teams.find(x => x.name === team);
  return t && t.country ? state.countries[t.country] : null;
};
export const aliveNations = (state) => Object.values(state.countries).filter(c => c.team && !c.eliminated);

export function toast(msg, type = 'info', ms = 3800) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

let audioCtx = null;
export function beep(freq = 880, times = 3) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.28;
      o.frequency.value = freq; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.26);
    }
  } catch { /* audio indisponible */ }
}

export const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};

export const PHASE_LABEL = {
  setup: 'En attente', draft: 'Inscriptions', prosperity: 'Prospérité', negotiation: 'Négociation', war: 'Guerre',
};
export function phaseLabel(s) {
  if (s.gameOver) return 'Partie terminée';
  if (s.isTutorial) return 'Manche test';
  if (s.phase === 'prosperity') return `Période ${s.period}/${s.totalPeriods}`;
  return PHASE_LABEL[s.phase] || s.phase;
}

/** Ouvre une fenêtre modale ; renvoie une fonction de fermeture. */
export function modal(html, { onClose, dismissable = true } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  const close = () => { back.remove(); onClose?.(); };
  if (dismissable) back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
  return { el: back.firstElementChild, close };
}
