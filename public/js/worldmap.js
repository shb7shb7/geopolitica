// Carte du monde SVG : territoires colorés par équipe, drapeaux, animations d'attaque.
// Les tracés sont pré-calculés par scripts/build-assets.mjs (public/data/world.json).

const NS = 'http://www.w3.org/2000/svg';
let worldPromise = null;
const loadWorld = () => (worldPromise ||= fetch('/data/world.json').then(r => r.json()));

const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export class WorldMap {
  /**
   * @param {HTMLElement} el conteneur
   * @param {{labels?: boolean, flag?: number, onSelect?: (id: string) => void}} opts
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = { labels: true, flag: 16, ...opts };
    this.positions = {};
    this.clickable = new Set();
    this.ready = this.init();
  }

  async init() {
    const w = (this.world = await loadWorld());
    this.el.classList.add('wm');
    const svg = (this.svg = svgEl('svg', { viewBox: `0 0 ${w.w} ${w.h}`, preserveAspectRatio: 'xMidYMid meet' }));
    svg.appendChild(svgEl('rect', { class: 'wm-sea', x: 0, y: 0, width: w.w, height: w.h, rx: 12 }));
    const base = svgEl('g');
    this.paths = {};
    for (const c of w.countries) {
      const p = svgEl('path', { d: c.d, class: 'wm-c', 'data-iso': c.iso });
      base.appendChild(p);
      (this.paths[c.iso] ||= []).push(p);
    }
    svg.appendChild(base);
    this.gLinks = svg.appendChild(svgEl('g'));
    this.gMarkers = svg.appendChild(svgEl('g'));
    this.gFx = svg.appendChild(svgEl('g'));
    svg.addEventListener('click', (e) => {
      const target = e.target.closest('[data-id]');
      const id = target?.getAttribute('data-id');
      if (id && this.clickable.has(id)) this.opts.onSelect?.(id);
    });
    this.el.appendChild(svg);
  }

  /**
   * @param {object} state état public du jeu
   * @param {{current?: string, selected?: string, mine?: string, targets?: string[]}} view
   */
  async update(state, view = {}) {
    await this.ready;
    const countries = Object.values(state.countries);
    const isoToId = {};
    this.clickable = new Set(view.targets || []);

    for (const c of countries) {
      isoToId[c.iso] = c.id;
      const paths = this.paths[c.iso] || [];
      let fill = null, cls = 'wm-c';
      if (c.eliminated) {
        const owner = c.conqueredBy && state.countries[c.conqueredBy];
        if (owner && owner.color) { fill = owner.color; cls += ' is-owned'; } else cls += ' is-fallen';
      } else if (c.team && c.color) {
        fill = c.color; cls += ' is-owned';
      } else {
        cls += ' is-free';
      }
      if (this.clickable.has(c.id)) cls += ' is-target';
      if (view.selected === c.id) cls += ' is-selected';
      if (view.current && c.team === view.current && !c.eliminated) cls += ' is-current';
      for (const p of paths) {
        p.setAttribute('class', cls);
        p.setAttribute('data-id', c.id);
        p.style.fill = fill || '';
        p.style.fillOpacity = c.eliminated && fill ? '0.72' : '';
      }
    }

    // Marqueurs (drapeaux) des nations encore en jeu, écartés s'ils se chevauchent
    const alive = countries.filter(c => c.team && !c.eliminated);
    const fw = this.opts.flag, fh = fw * 0.75;
    const pts = alive.map(c => {
      const [x, y] = this.world.centers[c.iso];
      return { c, ox: x, oy: y, x, y };
    });
    const minD = fw + 3;
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < minD) {
          if (d === 0.01) { dx = 1; dy = 0; }
          const push = (minD - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }
    }

    this.gMarkers.replaceChildren();
    this.gLinks.replaceChildren();
    this.positions = {};
    for (const c of countries) this.positions[c.id] = this.world.centers[c.iso];
    for (const p of pts) {
      const { c } = p;
      this.positions[c.id] = [p.x, p.y];
      if (Math.hypot(p.x - p.ox, p.y - p.oy) > 4) {
        this.gLinks.appendChild(svgEl('line', { x1: p.ox, y1: p.oy, x2: p.x, y2: p.y, stroke: c.color, 'stroke-width': 0.8, opacity: 0.7 }));
        this.gLinks.appendChild(svgEl('circle', { cx: p.ox, cy: p.oy, r: 1.6, fill: c.color }));
      }
      const g = svgEl('g', { class: 'wm-marker' + (this.clickable.has(c.id) ? ' clickable' : ''), transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`, 'data-id': c.id });
      if (view.current && c.team === view.current) g.appendChild(svgEl('circle', { class: 'pulse', r: fw * 0.75, stroke: c.color }));
      g.appendChild(svgEl('image', { href: `/flags/${c.a2}.svg`, x: -fw / 2, y: -fh / 2, width: fw, height: fh, preserveAspectRatio: 'xMidYMid slice' }));
      const frameW = view.selected === c.id || view.mine === c.id ? 1.8 : 1.1;
      g.appendChild(svgEl('rect', { x: -fw / 2, y: -fh / 2, width: fw, height: fh, rx: 1.5, fill: 'none', stroke: view.selected === c.id ? '#fff' : c.color, 'stroke-width': frameW }));
      if (this.opts.labels) {
        const t = svgEl('text', { class: 'wm-label', y: fh / 2 + 7.5 });
        t.textContent = c.name;
        g.appendChild(t);
      }
      if (c.fortified) {
        const t = svgEl('text', { x: fw / 2 + 1, y: -fh / 2 + 4, 'font-size': 7 });
        t.textContent = '🏰';
        g.appendChild(t);
      }
      this.gMarkers.appendChild(g);
    }
  }

  /** Flèche animée de l'attaquant vers la cible, puis impact. */
  async animateAttack(fromId, toId, outcome, color = '#ef4444') {
    await this.ready;
    const a = this.positions[fromId], b = this.positions[toId];
    if (!a || !b) return;
    const [x1, y1] = a, [x2, y2] = b;
    const dx = x2 - x1, dy = y2 - y1, dist = Math.hypot(dx, dy) || 1;
    const lift = Math.min(120, dist * 0.3);
    const cx = (x1 + x2) / 2 - (dy / dist) * lift * Math.sign(dx || 1), cy = (y1 + y2) / 2 - Math.abs(dx / dist) * lift;
    const g = svgEl('g');
    const path = svgEl('path', { class: 'wm-arrow', d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, stroke: color });
    g.appendChild(path);
    this.gFx.appendChild(g);
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.5,0,.3,1)';
    path.style.strokeDashoffset = '0';
    setTimeout(() => {
      const burstColor = outcome === 'repelled' ? '#93c5fd' : outcome === 'conquest' ? '#fde68a' : '#f87171';
      for (let i = 0; i < 3; i++) {
        const c = svgEl('circle', { class: 'wm-burst', cx: x2, cy: y2, r: 10, stroke: burstColor });
        c.style.animationDelay = `${i * 0.18}s`;
        g.appendChild(c);
      }
      const icon = svgEl('text', { x: x2, y: y2 - 14, 'text-anchor': 'middle', 'font-size': 16 });
      icon.textContent = outcome === 'repelled' ? '🛡️' : outcome === 'conquest' ? '🏴' : '💥';
      g.appendChild(icon);
    }, 1100);
    setTimeout(() => { g.style.transition = 'opacity .6s'; g.style.opacity = '0'; }, 3800);
    setTimeout(() => g.remove(), 4500);
  }
}

