(() => {
  'use strict';

  // ------------------------------------------------------------------ data
  const DATA = JSON.parse(document.getElementById('graph-data').textContent);
  const $ = (s) => document.querySelector(s);
  const TAU = Math.PI * 2;
  const FONT = getComputedStyle(document.body).fontFamily;

  const TYPE = {
    root: { name: 'Claude Code', color: '#ffffff', r: 13 },
    group: { name: 'Groups', color: '#8790a8', r: 7 },
    instructions: { name: 'CLAUDE.md', color: '#f6c453', r: 7 },
    settings: { name: 'Settings', color: '#b8c2d6', r: 5.5 },
    project: { name: 'Projects', color: '#eaf0fa', r: 6.5 },
    index: { name: 'Memory index', color: '#ffe6b0', r: 5.5 },
    memory: { name: 'Memory', color: '#c4a7ff', r: 2.8 },
    skill: { name: 'Skills', color: '#a68aff', r: 3.2 },
    agent: { name: 'Agents', color: '#36d3c9', r: 4.2 },
    command: { name: 'Commands', color: '#ff7a5c', r: 3.4 },
    hook: { name: 'Hook events', color: '#ff4f8b', r: 4.6 },
    script: { name: 'Hook scripts', color: '#d48aa6', r: 3 },
    mcp: { name: 'MCP servers', color: '#5d8dff', r: 4.6 },
    plugin: { name: 'Plugins', color: '#ec7cf7', r: 5 },
    doc: { name: 'Docs', color: '#8d96aa', r: 2.8 },
    ghost: { name: 'Unwritten links', color: '#6b7386', r: 2.4 },
  };
  const MEMORY = {
    user: { name: 'Memory · user', color: '#ff8fb1' },
    feedback: { name: 'Memory · feedback', color: '#ffb05e' },
    project: { name: 'Memory · project', color: '#9fe870' },
    reference: { name: 'Memory · reference', color: '#74c7ff' },
  };
  const ORDER = [
    'instructions', 'memory:user', 'memory:feedback', 'memory:project', 'memory:reference', 'memory', 'index',
    'skill', 'agent', 'command', 'hook', 'script', 'mcp', 'plugin', 'project', 'settings', 'doc', 'ghost', 'group', 'root',
  ];
  const LINK = {
    contains: { color: '#8d98b8', a: 0.1, w: 0.7 },
    mention: { color: '#9aa6c6', a: 0.09, w: 0.6 },
    uses: { color: '#c48dff', a: 0.22, w: 0.8 },
    link: { color: '#b3bfe0', a: 0.24, w: 0.75 },
  };
  const OUT_WORD = { link: 'links to', mention: 'mentions', uses: 'uses', contains: 'contains' };
  const IN_WORD = { link: 'linked from', mention: 'mentioned by', uses: 'used by', contains: 'part of' };

  const keyOf = (n) => (n.type === 'memory' && MEMORY[n.sub] ? 'memory:' + n.sub : n.type);
  const colorOfKey = (k) => (k.startsWith('memory:') ? MEMORY[k.slice(7)].color : (TYPE[k] || {}).color || '#9aa3b5');
  const nameOfKey = (k) => (k.startsWith('memory:') ? MEMORY[k.slice(7)].name : (TYPE[k] || {}).name || k);
  const norm = (s) => String(s).toLowerCase().trim().replace(/\.md$/, '').replace(/[\s_]+/g, '-');

  const nodes = DATA.nodes.map((d, i) => ({
    ...d, i, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null,
    deg: 0, vdeg: 0, hl: 1, pop: 1, visible: true, out: [], inn: [],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [];
  for (const l of DATA.links) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t || s === t) continue;
    const L = { s, t, kind: LINK[l.kind] ? l.kind : 'link', label: l.label, seed: hashFloat(l.source + l.target) };
    links.push(L);
    s.out.push(L);
    t.inn.push(L);
    s.deg++;
    t.deg++;
  }
  const nameIndex = new Map();
  for (const n of nodes) {
    n.key = keyOf(n);
    n.color = colorOfKey(n.key);
    n.r = radiusOf(n);
    n.time = Date.parse(n.created || '') || null;
    n.haystack = [n.label, n.path, n.sub, n.desc, n.project].filter(Boolean).join(' ').toLowerCase();
    const k = norm(n.label);
    if (!nameIndex.has(k) || n.type === 'memory') nameIndex.set(k, n);
    if (n.type === 'memory') nameIndex.set(k.replace(/^(?:user|feedback|project|reference)-/, ''), n);
  }

  function radiusOf(n) {
    const base = (TYPE[n.type] || {}).r || 3.4;
    const hub = n.type === 'root' || n.type === 'group';
    let r = base + Math.sqrt(n.deg) * (hub ? 0.75 : 0.5);
    if (n.type === 'project' && n.sessions) r += Math.log2(1 + n.sessions) * 0.8;
    return Math.min(r, 26);
  }

  function hashFloat(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  }

  // ------------------------------------------------------------------ settings
  const DEFAULTS = {
    repel: 80, linkDist: 34, linkStrength: 0.7, center: 0.045,
    showLabels: true, showContains: true, showMentions: true, showGhosts: true, showOrphans: true, particles: true,
    hidden: [],
  };
  const STORE_KEY = 'claude-constellation:v1';
  const S = { ...DEFAULTS, ...loadSettings() };
  S.hidden = new Set(S.hidden || []);
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }
  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...S, hidden: [...S.hidden] }));
    } catch {
      /* storage can be blocked; settings stay for this visit */
    }
  }

  // ------------------------------------------------------------------ state
  const canvas = $('#sky');
  const ctx = canvas.getContext('2d');
  let W = innerWidth;
  let H = innerHeight;
  let dpr = Math.min(devicePixelRatio || 1, 2);
  const cam = { x: 0, y: 0, k: 0.4 };
  let camAnim = null;
  let autoFit = true;
  let hover = null;
  let selected = null;
  let focusDepth = 0;
  let searchSet = null;
  let focusAmt = 0;
  let needsRender = true;
  let visNodes = [];
  let visLinks = [];
  let neighborCache = { node: null, set: null };
  const sim = { alpha: 1, alphaMin: 0.003, alphaDecay: 1 - Math.pow(0.003, 1 / 300), alphaTarget: 0, velocityDecay: 0.42 };
  const timelapse = { active: false, t0: 0, times: [], idx: 0, dur: 14000, endAt: 0 };

  // ------------------------------------------------------------------ visibility
  function computeVisible() {
    let allowed = null;
    if (focusDepth && selected) allowed = neighborhood(selected, focusDepth);
    for (const n of nodes) {
      let v = !S.hidden.has(n.key);
      if (v && !S.showGhosts && n.type === 'ghost') v = false;
      if (v && allowed && !allowed.has(n)) v = false;
      if (v && timelapse.active && n.time && n.time > timelapse.cursor) v = false;
      n.visible = v;
      n.vdeg = 0;
    }
    visLinks = links.filter(
      (l) => l.s.visible && l.t.visible && (S.showContains || l.kind !== 'contains') && (S.showMentions || l.kind !== 'mention'),
    );
    for (const l of visLinks) {
      l.s.vdeg++;
      l.t.vdeg++;
    }
    if (!S.showOrphans) {
      for (const n of nodes) if (n.visible && n.vdeg === 0 && n.type !== 'root' && n !== selected) n.visible = false;
    }
    visNodes = nodes.filter((n) => n.visible);
    for (const n of visNodes) {
      const hub = n.type === 'root' || n.type === 'group' || n.type === 'project';
      n.charge = -S.repel * (hub ? 2.6 : n.type === 'ghost' ? 0.5 : 1) * (0.7 + Math.min(n.vdeg, 30) / 40);
    }
    neighborCache.node = null;
    needsRender = true;
  }

  function neighborhood(start, depth) {
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const n of frontier) {
        for (const l of n.out) if (!seen.has(l.t)) { seen.add(l.t); next.push(l.t); }
        for (const l of n.inn) if (!seen.has(l.s)) { seen.add(l.s); next.push(l.s); }
      }
      frontier = next;
    }
    return seen;
  }

  // ------------------------------------------------------------------ layout seed
  function seedLayout(shuffle = 0) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const root = nodes.find((n) => n.type === 'root') || nodes[0];
    if (!root) return;
    const placed = new Set([root]);
    root.x = 0;
    root.y = 0;
    root.ang = shuffle * 1.7;
    const queue = [root];
    while (queue.length) {
      const p = queue.shift();
      const kids = [];
      for (const l of p.out) if (!placed.has(l.t) && l.kind === 'contains') kids.push(l.t);
      for (const l of p.out) if (!placed.has(l.t) && !kids.includes(l.t)) kids.push(l.t);
      for (const l of p.inn) if (!placed.has(l.s) && !kids.includes(l.s)) kids.push(l.s);
      kids.forEach((c, k) => {
        placed.add(c);
        if (p === root) {
          const a = p.ang + (k / Math.max(kids.length, 1)) * TAU;
          c.ang = a;
          c.x = Math.cos(a) * 320;
          c.y = Math.sin(a) * 320;
        } else {
          const a = k * golden + hashFloat(c.id + shuffle) * 0.4;
          const d = 30 + Math.sqrt(k) * 16;
          const ox = Math.cos(p.ang) * 60;
          const oy = Math.sin(p.ang) * 60;
          c.ang = p.ang + (hashFloat(c.id) - 0.5) * 0.8;
          c.x = p.x + ox + Math.cos(a) * d;
          c.y = p.y + oy + Math.sin(a) * d;
        }
        queue.push(c);
      });
    }
    let i = 0;
    for (const n of nodes) {
      if (placed.has(n)) continue;
      const r = 700 + 14 * Math.sqrt(i);
      const a = i * golden;
      n.x = r * Math.cos(a);
      n.y = r * Math.sin(a);
      i++;
    }
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }
  }

  // ------------------------------------------------------------------ forces
  function tick() {
    sim.alpha += (sim.alphaTarget - sim.alpha) * sim.alphaDecay;
    const alpha = sim.alpha;
    const ls = S.linkStrength;
    for (let i = 0; i < visLinks.length; i++) {
      const l = visLinks[i];
      const s = l.s;
      const t = l.t;
      let dx = t.x + t.vx - s.x - s.vx;
      let dy = t.y + t.vy - s.y - s.vy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const want = S.linkDist * (l.kind === 'contains' ? 1.15 : l.kind === 'mention' ? 1.9 : 1) + s.r + t.r;
      const kk = l.kind === 'mention' ? 0.3 : l.kind === 'contains' ? 1 : 0.8;
      const f = ((d - want) / d) * alpha * ls * kk / Math.max(1, Math.min(s.vdeg, t.vdeg));
      dx *= f;
      dy *= f;
      const b = s.vdeg / (s.vdeg + t.vdeg || 1);
      t.vx -= dx * b;
      t.vy -= dy * b;
      s.vx += dx * (1 - b);
      s.vy += dy * (1 - b);
    }
    manyBody(alpha);
    const c = S.center * alpha;
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i];
      n.vx -= n.x * c;
      n.vy -= n.y * c;
    }
    const decay = 1 - sim.velocityDecay;
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i];
      if (n.fx != null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= decay;
      n.vy *= decay;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  // Barnes–Hut quadtree, pooled to keep the garbage collector quiet.
  const pool = [];
  let poolUsed = 0;
  const THETA2 = 0.81;
  const DMIN2 = 4;
  function quad(x0, y0, s) {
    let q = pool[poolUsed];
    if (!q) {
      q = { kids: [null, null, null, null] };
      pool.push(q);
    }
    poolUsed++;
    q.x0 = x0;
    q.y0 = y0;
    q.s = s;
    q.kids[0] = q.kids[1] = q.kids[2] = q.kids[3] = null;
    q.leaf = null;
    q.extra = null;
    q.split = false;
    q.cx = 0;
    q.cy = 0;
    q.q = 0;
    q.w = 0;
    return q;
  }
  function childFor(q, n) {
    const h = q.s / 2;
    const right = n.x >= q.x0 + h;
    const down = n.y >= q.y0 + h;
    const i = (right ? 1 : 0) | (down ? 2 : 0);
    return q.kids[i] || (q.kids[i] = quad(q.x0 + (right ? h : 0), q.y0 + (down ? h : 0), h));
  }
  function insert(q, n) {
    let depth = 0;
    for (;;) {
      if (!q.split) {
        if (!q.leaf) {
          q.leaf = n;
          return;
        }
        if (depth > 28) {
          (q.extra || (q.extra = [])).push(n);
          return;
        }
        const p = q.leaf;
        q.leaf = null;
        q.split = true;
        insertDeep(childFor(q, p), p, depth + 1);
      }
      q = childFor(q, n);
      depth++;
    }
  }
  function insertDeep(q, n, depth) {
    for (;;) {
      if (!q.split) {
        if (!q.leaf) {
          q.leaf = n;
          return;
        }
        if (depth > 28) {
          (q.extra || (q.extra = [])).push(n);
          return;
        }
        const p = q.leaf;
        q.leaf = null;
        q.split = true;
        insertDeep(childFor(q, p), p, depth + 1);
      }
      q = childFor(q, n);
      depth++;
    }
  }
  function accumulate(q) {
    let cq = 0;
    let w = 0;
    let cx = 0;
    let cy = 0;
    if (q.split) {
      for (let i = 0; i < 4; i++) {
        const c = q.kids[i];
        if (!c) continue;
        accumulate(c);
        if (c.w) {
          cq += c.q;
          w += c.w;
          cx += c.cx * c.w;
          cy += c.cy * c.w;
        }
      }
    } else {
      if (q.leaf) {
        const a = Math.abs(q.leaf.charge);
        cq += q.leaf.charge;
        w += a;
        cx += q.leaf.x * a;
        cy += q.leaf.y * a;
      }
      if (q.extra) {
        for (const n of q.extra) {
          const a = Math.abs(n.charge);
          cq += n.charge;
          w += a;
          cx += n.x * a;
          cy += n.y * a;
        }
      }
    }
    q.q = cq;
    q.w = w;
    if (w) {
      q.cx = cx / w;
      q.cy = cy / w;
    }
  }
  function pointForce(p, n, alpha) {
    if (p === n) return;
    let dx = p.x - n.x;
    let dy = p.y - n.y;
    if (dx === 0) dx = (Math.random() - 0.5) * 1e-3;
    if (dy === 0) dy = (Math.random() - 0.5) * 1e-3;
    let l = dx * dx + dy * dy;
    if (l < DMIN2) l = Math.sqrt(DMIN2 * l);
    const f = (p.charge * alpha) / l;
    n.vx += dx * f;
    n.vy += dy * f;
  }
  function applyForce(q, n, alpha) {
    if (!q.w) return;
    if (q.split) {
      const dx = q.cx - n.x;
      const dy = q.cy - n.y;
      let l = dx * dx + dy * dy;
      if ((q.s * q.s) / THETA2 < l) {
        if (l < DMIN2) l = Math.sqrt(DMIN2 * l);
        const f = (q.q * alpha) / l;
        n.vx += dx * f;
        n.vy += dy * f;
        return;
      }
      for (let i = 0; i < 4; i++) if (q.kids[i]) applyForce(q.kids[i], n, alpha);
      return;
    }
    if (q.leaf) pointForce(q.leaf, n, alpha);
    if (q.extra) for (const p of q.extra) pointForce(p, n, alpha);
  }
  function manyBody(alpha) {
    const N = visNodes.length;
    if (N < 2) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < N; i++) {
      const n = visNodes[i];
      if (n.x < x0) x0 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.x > x1) x1 = n.x;
      if (n.y > y1) y1 = n.y;
    }
    poolUsed = 0;
    const root = quad(x0 - 1, y0 - 1, Math.max(x1 - x0, y1 - y0) + 2);
    for (let i = 0; i < N; i++) insert(root, visNodes[i]);
    accumulate(root);
    for (let i = 0; i < N; i++) applyForce(root, visNodes[i], alpha);
  }

  function reheat(a = 0.4) {
    sim.alpha = Math.max(sim.alpha, a);
    needsRender = true;
  }

  // ------------------------------------------------------------------ camera
  const panelWidth = () => (!$('#panel').hidden && W > 760 ? 396 : 0);
  function toScreen(x, y) {
    return [(x - cam.x) * cam.k + W / 2, (y - cam.y) * cam.k + H / 2];
  }
  function toWorld(sx, sy) {
    return [(sx - W / 2) / cam.k + cam.x, (sy - H / 2) / cam.k + cam.y];
  }
  function fitTarget(list = visNodes) {
    if (!list.length) return { x: 0, y: 0, k: 1 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of list) {
      x0 = Math.min(x0, n.x - n.r);
      y0 = Math.min(y0, n.y - n.r);
      x1 = Math.max(x1, n.x + n.r);
      y1 = Math.max(y1, n.y + n.r);
    }
    const pw = panelWidth();
    const padX = W < 760 ? 24 : 70;
    const top = W < 760 ? 120 : 80;
    const availW = Math.max(120, W - pw - padX * 2);
    const availH = Math.max(120, H - top - 60);
    const k = Math.max(0.03, Math.min(2.4, Math.min(availW / (x1 - x0 || 1), availH / (y1 - y0 || 1))));
    const cx = (x0 + x1) / 2 + pw / 2 / k;
    const cy = (y0 + y1) / 2 - (top - 60) / 2 / k;
    return { x: cx, y: cy, k };
  }
  function flyTo(target, ms = 650) {
    camAnim = { from: { ...cam }, to: target, t0: performance.now(), ms };
    needsRender = true;
  }
  function zoomAt(sx, sy, factor) {
    const [wx, wy] = toWorld(sx, sy);
    const k = Math.max(0.03, Math.min(8, cam.k * factor));
    cam.k = k;
    cam.x = wx - (sx - W / 2) / k;
    cam.y = wy - (sy - H / 2) / k;
    camAnim = null;
    needsRender = true;
  }
  function userTookCamera() {
    autoFit = false;
    hideHint();
  }

  // ------------------------------------------------------------------ sprites
  const glowCache = new Map();
  function glow(color) {
    let c = glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, hexA(color, 0.55));
    grad.addColorStop(0.22, hexA(color, 0.28));
    grad.addColorStop(0.55, hexA(color, 0.07));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    glowCache.set(color, c);
    return c;
  }
  function hexA(hex, a) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }

  let starTiles = null;
  function buildStars() {
    const make = (count, seed, maxR, maxA) => {
      const size = Math.round(640 * dpr);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      let s = seed;
      const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < count; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = (0.25 + rnd() * maxR) * dpr;
        const a = 0.08 + rnd() * maxA;
        const tint = rnd();
        g.fillStyle = tint < 0.15 ? `rgba(180,200,255,${a})` : tint < 0.22 ? `rgba(255,214,190,${a})` : `rgba(255,255,255,${a})`;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
      return { canvas: c, size, pattern: ctx.createPattern(c, 'repeat') };
    };
    starTiles = [make(140, 7, 0.55, 0.35), make(40, 99, 0.9, 0.5)];
  }
  function drawStars() {
    if (!starTiles) buildStars();
    const speeds = [0.025, 0.07];
    starTiles.forEach((t, i) => {
      const ox = (-cam.x * cam.k * speeds[i] * dpr) % t.size;
      const oy = (-cam.y * cam.k * speeds[i] * dpr) % t.size;
      ctx.setTransform(1, 0, 0, 1, ox, oy);
      ctx.fillStyle = t.pattern;
      ctx.globalAlpha = 1;
      ctx.fillRect(-ox, -oy, canvas.width, canvas.height);
    });
  }

  // ------------------------------------------------------------------ highlight
  function focusNode() {
    return hover || selected;
  }
  function neighbors(n) {
    if (neighborCache.node === n) return neighborCache.set;
    const set = new Set([n]);
    for (const l of n.out) if (l.t.visible) set.add(l.t);
    for (const l of n.inn) if (l.s.visible) set.add(l.s);
    neighborCache = { node: n, set };
    return set;
  }
  function updateHighlights() {
    const f = focusNode();
    const nb = f ? neighbors(f) : null;
    let moving = false;
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i];
      let target = 1;
      if (nb) target = nb.has(n) ? 1 : 0.1;
      else if (searchSet) target = searchSet.has(n) ? 1 : 0.1;
      const d = target - n.hl;
      if (Math.abs(d) > 0.004) {
        n.hl += d * 0.2;
        moving = true;
      } else n.hl = target;
      if (n.pop < 1) {
        n.pop = Math.min(1, n.pop + (1 - n.pop) * 0.12 + 0.004);
        moving = true;
      }
    }
    const ft = nb || searchSet ? 1 : 0;
    if (Math.abs(ft - focusAmt) > 0.004) {
      focusAmt += (ft - focusAmt) * 0.2;
      moving = true;
    } else focusAmt = ft;
    return moving;
  }

  // ------------------------------------------------------------------ render
  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStars();

    const k = cam.k;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (W / 2 - cam.x * k), dpr * (H / 2 - cam.y * k));
    const [vx0, vy0] = toWorld(-40, -40);
    const [vx1, vy1] = toWorld(W + 40, H + 40);
    const inView = (x, y, m) => x + m > vx0 && x - m < vx1 && y + m > vy0 && y - m < vy1;
    const lineScale = Math.pow(Math.min(Math.max(k, 0.35), 2.5), 0.5) / k;

    // links, batched by kind
    ctx.lineCap = 'round';
    const f = focusNode();
    for (const kind of ['contains', 'mention', 'uses', 'link']) {
      const st = LINK[kind];
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < visLinks.length; i++) {
        const l = visLinks[i];
        if (l.kind !== kind) continue;
        const { s, t } = l;
        if ((s.x < vx0 && t.x < vx0) || (s.x > vx1 && t.x > vx1) || (s.y < vy0 && t.y < vy0) || (s.y > vy1 && t.y > vy1)) continue;
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = st.a * (1 - 0.75 * focusAmt) * (kind === 'contains' && !S.showContains ? 0 : 1);
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.w * lineScale;
      ctx.stroke();
    }

    // highlighted links around the focused node
    if (f && f.visible) {
      const fl = [];
      for (const l of f.out) if (l.t.visible) fl.push(l);
      for (const l of f.inn) if (l.s.visible) fl.push(l);
      for (const l of fl) {
        const other = l.s === f ? l.t : l.s;
        const g = ctx.createLinearGradient(l.s.x, l.s.y, l.t.x, l.t.y);
        g.addColorStop(0, hexA(l.s.color, 0.85));
        g.addColorStop(1, hexA(l.t.color, 0.85));
        ctx.globalAlpha = Math.max(focusAmt, 0.2) * Math.min(1, other.hl + 0.2);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.15 * lineScale * (l.kind === 'mention' ? 0.8 : 1);
        ctx.beginPath();
        ctx.moveTo(l.s.x, l.s.y);
        ctx.lineTo(l.t.x, l.t.y);
        ctx.stroke();
      }
      if (S.particles) {
        const time = now / 1000;
        ctx.globalCompositeOperation = 'lighter';
        for (const l of fl) {
          const dx = l.t.x - l.s.x;
          const dy = l.t.y - l.s.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = 70 / len;
          const p = (time * speed + l.seed) % 1;
          const x = l.s.x + dx * p;
          const y = l.s.y + dy * p;
          ctx.globalAlpha = 0.9 * focusAmt * Math.sin(p * Math.PI);
          ctx.fillStyle = l.t.color;
          ctx.beginPath();
          ctx.arc(x, y, 1.7 / Math.sqrt(k), 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // glows, added light
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i];
      const r = n.r * (0.35 + 0.65 * n.pop);
      const R = r * (n.type === 'root' ? 6 : n.type === 'ghost' ? 2.2 : 3.6);
      if (!inView(n.x, n.y, R)) continue;
      const boost = n === f ? 1.6 : n.type === 'root' ? 1.3 : n.type === 'ghost' ? 0.35 : 1;
      ctx.globalAlpha = Math.min(1, n.hl * n.pop * 0.85 * boost);
      ctx.drawImage(glow(n.color), n.x - R, n.y - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // cores
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i];
      const r = n.r * (0.35 + 0.65 * n.pop);
      if (!inView(n.x, n.y, r + 4)) continue;
      const a = n.hl * n.pop;
      ctx.globalAlpha = a;
      if (n.type === 'ghost') {
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1.1 / k;
        ctx.setLineDash([2.2 / k, 2.2 / k]);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      if (n.type === 'group') {
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1.4 / k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(1.2, r * 0.28), 0, TAU);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, TAU);
      ctx.fill();
      if (n.type === 'root') {
        ctx.strokeStyle = '#ffffff';
        for (const [m, al] of [[1.9, 0.18], [2.9, 0.08]]) {
          ctx.globalAlpha = a * al;
          ctx.lineWidth = 1 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * m, 0, TAU);
          ctx.stroke();
        }
      } else if (n.type === 'project') {
        ctx.globalAlpha = a * 0.45;
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1 / k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3.2, 0, TAU);
        ctx.stroke();
      } else if (n.type === 'instructions' || n.type === 'index') {
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = 'rgba(20,16,4,0.55)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.42, 0, TAU);
        ctx.fill();
      }
    }

    // focus rings
    for (const n of [selected, hover]) {
      if (!n || !n.visible) continue;
      const pulse = n === selected ? 1 + Math.sin(now / 420) * 0.08 : 1;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4 / k;
      ctx.beginPath();
      ctx.arc(n.x, n.y, (n.r + 3.5 / Math.sqrt(k)) * pulse, 0, TAU);
      ctx.stroke();
    }

    // labels in screen space for crisp text
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const nb = f ? neighbors(f) : null;
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i];
      const [sx, sy] = toScreen(n.x, n.y);
      if (sx < -150 || sx > W + 150 || sy < -40 || sy > H + 40) continue;
      const hub = n.type === 'root' || n.type === 'group';
      let la;
      if (hub) la = 1;
      else if (n.type === 'project') la = Math.min(1, Math.max(0, (n.r * k - 2.2) / 2.5));
      else la = Math.min(1, Math.max(0, (n.r * k - 5) / 3.5));
      if (!S.showLabels && !hub) la = 0;
      if (nb) la = nb.has(n) ? Math.max(la, n === f || nb.size < 60 ? 1 : 0.85) : la * 0.12;
      else if (searchSet) la = searchSet.has(n) ? Math.max(la, searchSet.size < 40 ? 1 : la) : la * 0.15;
      if (n === selected) la = 1;
      la *= n.pop * (hub ? Math.max(n.hl, 0.25) : 1);
      if (la < 0.04) continue;
      const y = sy + n.r * k * (n.type === 'root' ? 1.9 : 1) + 5;
      let text = n.label;
      if (text.length > 38) text = text.slice(0, 36) + '…';
      if (hub) {
        ctx.font = n.type === 'root' ? `650 13px ${FONT}` : `650 10.5px ${FONT}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = n.type === 'root' ? '0.04em' : '0.14em';
        text = n.type === 'root' ? text : text.toUpperCase();
      } else {
        ctx.font = `${n === f || n === selected ? 600 : 500} 11px ${FONT}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      }
      ctx.globalAlpha = la;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(4,5,10,0.85)';
      ctx.strokeText(text, sx, y);
      ctx.fillStyle = hub ? (n.type === 'root' ? '#ffffff' : '#aab2c6') : n === f || n === selected ? '#ffffff' : '#d9dde8';
      ctx.fillText(text, sx, y);
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ loop
  function frame(now) {
    requestAnimationFrame(frame);
    let active = false;

    if (timelapse.active) stepTimelapse(now);

    if (sim.alpha > sim.alphaMin || sim.alphaTarget > 0) {
      tick();
      active = true;
    }

    if (camAnim) {
      const p = Math.min(1, (now - camAnim.t0) / camAnim.ms);
      const e = 1 - Math.pow(1 - p, 3);
      const { from, to } = camAnim;
      const kk = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      cam.k = kk;
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      if (p >= 1) camAnim = null;
      active = true;
    } else if (autoFit && (sim.alpha > 0.01 || timelapse.active)) {
      const t = fitTarget();
      const lerp = 0.07;
      cam.x += (t.x - cam.x) * lerp;
      cam.y += (t.y - cam.y) * lerp;
      cam.k = Math.exp(Math.log(cam.k) + (Math.log(t.k) - Math.log(cam.k)) * lerp);
      active = true;
    }

    if (updateHighlights()) active = true;
    if (focusNode() && S.particles) active = true;
    if (selected) active = true; // pulse ring

    if (active || needsRender) {
      render(now);
      needsRender = false;
    }
  }

  // ------------------------------------------------------------------ time-lapse
  function startTimelapse() {
    const times = nodes.map((n) => n.time).filter(Boolean).sort((a, b) => a - b);
    if (times.length < 3) return;
    focusDepth = 0;
    timelapse.active = true;
    timelapse.times = times;
    timelapse.t0 = performance.now();
    timelapse.cursor = times[0] - 1;
    timelapse.endAt = 0;
    for (const n of nodes) if (n.time) n.pop = 0;
    computeVisible();
    reheat(0.8);
    autoFit = true;
    $('#timeline').hidden = false;
    $('#btn-time').classList.add('on');
    hideHint();
  }
  function stopTimelapse() {
    timelapse.active = false;
    for (const n of nodes) n.pop = Math.max(n.pop, 0.01);
    computeVisible();
    reheat(0.2);
    $('#btn-time').classList.remove('on');
    setTimeout(() => {
      if (!timelapse.active) $('#timeline').hidden = true;
    }, 1600);
  }
  function stepTimelapse(now) {
    const { times } = timelapse;
    const p = Math.min(1, (now - timelapse.t0) / timelapse.dur);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const idx = Math.min(times.length - 1, Math.floor(e * (times.length - 1)));
    const cursor = times[idx];
    if (cursor !== timelapse.cursor) {
      const prev = timelapse.cursor;
      timelapse.cursor = cursor;
      for (const n of nodes) {
        if (!n.time || n.time <= prev || n.time > cursor) continue;
        const anchor = [...n.inn.map((l) => l.s), ...n.out.map((l) => l.t)].find((m) => m.visible);
        if (anchor) {
          const a = hashFloat(n.id) * TAU;
          n.x = anchor.x + Math.cos(a) * 12;
          n.y = anchor.y + Math.sin(a) * 12;
          n.vx = n.vy = 0;
        }
        n.pop = 0;
      }
      computeVisible();
      sim.alpha = Math.max(sim.alpha, 0.35);
    }
    $('#time-label').textContent = new Date(cursor).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    $('#timeline .bar i').style.width = `${(p * 100).toFixed(1)}%`;
    if (p >= 1) stopTimelapse();
  }

  // ------------------------------------------------------------------ picking + input
  function pick(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    let best = null;
    let bestD = Infinity;
    const slack = 5 / cam.k;
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i];
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = Math.max(n.r, 3 / cam.k) + slack;
      if (d < reach && d - n.r < bestD) {
        best = n;
        bestD = d - n.r;
      }
    }
    return best;
  }

  const pointers = new Map();
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    closeFloating();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: cam.k };
      userTookCamera();
      return;
    }
    const hit = pick(e.offsetX, e.offsetY);
    if (hit) {
      drag = { type: 'node', node: hit, sx: e.offsetX, sy: e.offsetY, moved: false };
    } else {
      drag = { type: 'pan', sx: e.offsetX, sy: e.offsetY, cx: cam.x, cy: cam.y, moved: false };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (drag && drag.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (drag.k0 * (d / drag.d0)) / cam.k);
      return;
    }
    if (drag && drag.type === 'node') {
      if (!drag.moved && Math.hypot(e.offsetX - drag.sx, e.offsetY - drag.sy) > 3) {
        drag.moved = true;
        canvas.classList.add('dragging');
        sim.alphaTarget = 0.25;
        reheat(0.25);
        userTookCamera();
      }
      if (drag.moved) {
        const [wx, wy] = toWorld(e.offsetX, e.offsetY);
        drag.node.fx = wx;
        drag.node.fy = wy;
      }
      return;
    }
    if (drag && drag.type === 'pan') {
      const dx = e.offsetX - drag.sx;
      const dy = e.offsetY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 3) {
        drag.moved = true;
        canvas.classList.add('dragging');
        userTookCamera();
        camAnim = null;
      }
      if (drag.moved) {
        cam.x = drag.cx - dx / cam.k;
        cam.y = drag.cy - dy / cam.k;
        needsRender = true;
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const hit = pick(e.offsetX, e.offsetY);
      if (hit !== hover) {
        hover = hit;
        canvas.classList.toggle('over-node', Boolean(hit));
        needsRender = true;
      }
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (!drag) return;
    if (drag.type === 'pinch') {
      if (pointers.size === 0) drag = null;
      return;
    }
    if (drag.type === 'node') {
      drag.node.fx = null;
      drag.node.fy = null;
      sim.alphaTarget = 0;
      if (!drag.moved) select(drag.node);
    } else if (drag.type === 'pan' && !drag.moved && e.type === 'pointerup') {
      select(null);
    }
    canvas.classList.remove('dragging');
    drag = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (hover && !drag) {
      hover = null;
      canvas.classList.remove('over-node');
      needsRender = true;
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      userTookCamera();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0017));
      zoomAt(e.offsetX, e.offsetY, factor);
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', (e) => {
    if (!pick(e.offsetX, e.offsetY)) fit();
  });

  function fit() {
    autoFit = false;
    flyTo(fitTarget());
  }

  // ------------------------------------------------------------------ selection + panel
  function select(n, { fly = false } = {}) {
    selected = n;
    neighborCache.node = null;
    if (!n && focusDepth) {
      focusDepth = 0;
      computeVisible();
      reheat(0.3);
    }
    renderPanel(n);
    if (n && fly) {
      autoFit = false;
      flyTo({ x: n.x + panelWidth() / 2 / Math.max(cam.k, 1.2), y: n.y, k: Math.max(cam.k, 1.2) });
    }
    needsRender = true;
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function typeLabel(n) {
    if (n.type === 'memory') return n.sub ? `Memory · ${n.sub}` : 'Memory';
    const base = { instructions: 'Instructions', group: 'Group', root: 'Root', ghost: 'Unwritten link', script: 'Hook script', hook: 'Hook event', mcp: 'MCP server', index: 'Memory index' }[n.type];
    const name = base || (TYPE[n.type] ? TYPE[n.type].name.replace(/s$/, '') : n.type);
    return n.sub && n.type !== 'memory' ? `${name} · ${n.sub}` : name;
  }

  function renderPanel(n) {
    const panel = $('#panel');
    if (!n) {
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    const kids = [];
    kids.push(h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => select(null) }, '×'));
    kids.push(h('span', { class: 'chip', style: `--c:${n.color}` }, h('i', { class: 'dot', style: `--c:${n.color}` }), typeLabel(n)));
    kids.push(h('h2', null, n.label));
    if (n.path) {
      const btn = h('button', { type: 'button', title: 'Copy path' }, 'copy');
      btn.addEventListener('click', () => {
        const done = () => {
          btn.textContent = 'copied';
          setTimeout(() => (btn.textContent = 'copy'), 1200);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(n.path).then(done, () => {});
      });
      kids.push(h('div', { class: 'path' }, h('code', null, n.path), btn));
    }
    if (n.desc) kids.push(h('p', { class: 'desc' }, n.desc));

    const meta = { ...(n.meta || {}) };
    if (n.project && n.type !== 'index') meta.project = n.project;
    if (n.modified) meta.modified = fmtDate(n.modified);
    if (n.created && n.created !== n.modified) meta.created = fmtDate(n.created);
    if (n.bytes) meta.size = fmtBytes(n.bytes);
    meta.connections = String(n.deg);
    const rows = Object.entries(meta).filter(([, v]) => v != null && v !== '');
    if (rows.length) kids.push(h('dl', null, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, String(v))])));

    kids.push(h('h4', null, 'Local graph'));
    const seg = h('div', { class: 'seg', role: 'group' });
    [['All', 0], ['1 hop', 1], ['2 hops', 2]].forEach(([label, d]) => {
      seg.append(
        h('button', {
          type: 'button',
          class: focusDepth === d ? 'on' : '',
          onclick: () => {
            focusDepth = d;
            computeVisible();
            reheat(0.6);
            renderPanel(n);
            autoFit = false;
            setTimeout(() => flyTo(fitTarget()), d ? 450 : 0);
          },
        }, label),
      );
    });
    kids.push(seg);

    const groups = new Map();
    for (const l of n.out) addConn(groups, OUT_WORD[l.kind], l.t, l.label);
    for (const l of n.inn) addConn(groups, IN_WORD[l.kind], l.s, l.label);
    for (const [word, list] of groups) {
      kids.push(h('h4', null, `${word} · ${list.length}`));
      const wrap = h('div', { class: 'conn' });
      list.sort((a, b) => b.node.deg - a.node.deg);
      list.slice(0, 40).forEach(({ node, label }) => {
        wrap.append(
          h('button', { type: 'button', title: node.path || node.label, onclick: () => select(node, { fly: true }) },
            h('i', { class: 'dot', style: `--c:${node.color}` }),
            h('span', null, node.label),
            label ? h('em', null, label) : null),
        );
      });
      if (list.length > 40) wrap.append(h('span', { class: 'more' }, `+${list.length - 40} more`));
      kids.push(wrap);
    }

    if (n.preview) {
      kids.push(h('h4', null, 'Preview'));
      const md = h('div', { class: 'md' });
      md.innerHTML = renderMarkdown(n.preview);
      md.addEventListener('click', (e) => {
        const el = e.target.closest('.wl');
        if (!el) return;
        const target = nameIndex.get(norm(el.dataset.name || ''));
        if (target) select(target, { fly: true });
      });
      kids.push(md);
    } else if (DATA.meta && DATA.meta.redacted && !['root', 'group'].includes(n.type)) {
      kids.push(h('p', { class: 'note' }, 'Content left out. This page was made with --redact.'));
    }
    panel.replaceChildren(...kids);
    panel.hidden = false;
    panel.scrollTop = 0;
  }

  function addConn(groups, word, node, label) {
    if (!groups.has(word)) groups.set(word, []);
    groups.get(word).push({ node, label });
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtBytes(b) {
    return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
  }

  // Safe markdown: escape everything first, then add a few inline styles.
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function inline(s) {
    let out = esc(s);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, name, alias) => {
      const known = nameIndex.has(norm(name.replace(/&#39;/g, "'")));
      return `<span class="wl${known ? '' : ' missing'}" data-name="${name}">${alias || name}</span>`;
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="ml" title="$2">$1</span>');
    return out;
  }
  function renderMarkdown(src) {
    const lines = src.split('\n');
    const out = [];
    let inCode = false;
    let code = [];
    let list = false;
    let para = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    };
    const closeList = () => {
      if (list) out.push('</ul>');
      list = false;
    };
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        if (inCode) {
          out.push(`<pre>${esc(code.join('\n'))}</pre>`);
          code = [];
          inCode = false;
        } else {
          flushPara();
          closeList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        code.push(line);
        continue;
      }
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      const lm = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
      if (hm) {
        flushPara();
        closeList();
        out.push(`<h5>${inline(hm[2])}</h5>`);
      } else if (lm) {
        flushPara();
        if (!list) out.push('<ul>');
        list = true;
        out.push(`<li>${inline(lm[1])}</li>`);
      } else if (!line.trim()) {
        flushPara();
        closeList();
      } else {
        closeList();
        para.push(line.trim());
      }
    }
    if (inCode) out.push(`<pre>${esc(code.join('\n'))}</pre>`);
    flushPara();
    closeList();
    return out.join('');
  }

  // ------------------------------------------------------------------ search
  const q = $('#q');
  const results = $('#results');
  let resultList = [];
  let active = 0;
  function runSearch() {
    const v = q.value.trim().toLowerCase();
    if (!v) {
      searchSet = null;
      results.hidden = true;
      needsRender = true;
      return;
    }
    const scored = [];
    for (const n of nodes) {
      if (!n.visible) continue;
      const lbl = n.label.toLowerCase();
      let score = -1;
      if (lbl === v) score = 100;
      else if (lbl.startsWith(v)) score = 80;
      else if (lbl.includes(v)) score = 60;
      else if (n.haystack.includes(v)) score = 30;
      if (score >= 0) scored.push([score + Math.min(n.deg, 30) / 10, n]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    searchSet = new Set(scored.map((s) => s[1]));
    resultList = scored.slice(0, 9).map((s) => s[1]);
    active = 0;
    drawResults();
    needsRender = true;
  }
  function drawResults() {
    results.replaceChildren();
    if (!resultList.length) {
      results.append(h('li', { class: 'none' }, 'No match'));
    } else {
      resultList.forEach((n, i) => {
        results.append(
          h('li', {
            role: 'option',
            'aria-selected': i === active ? 'true' : 'false',
            onmousedown: (e) => {
              e.preventDefault();
              choose(n);
            },
          },
          h('i', { class: 'dot', style: `--c:${n.color}` }),
          h('span', { class: 'r-label' }, n.label),
          h('span', { class: 'r-type' }, typeLabel(n))),
        );
      });
      const more = searchSet.size - resultList.length;
      if (more > 0) results.append(h('li', { class: 'none' }, `${more} more stars light up on the map`));
    }
    results.hidden = false;
  }
  function choose(n) {
    results.hidden = true;
    q.blur();
    select(n, { fly: true });
  }
  q.addEventListener('input', runSearch);
  q.addEventListener('focus', () => {
    if (q.value.trim()) runSearch();
  });
  q.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 120));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!resultList.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + resultList.length) % resultList.length;
      drawResults();
    } else if (e.key === 'Enter') {
      if (resultList[active]) choose(resultList[active]);
    } else if (e.key === 'Escape') {
      q.value = '';
      runSearch();
      q.blur();
    }
  });

  // ------------------------------------------------------------------ legend
  function renderLegend() {
    const counts = new Map();
    for (const n of nodes) counts.set(n.key, (counts.get(n.key) || 0) + 1);
    const keys = [...counts.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    const legend = $('#legend');
    const anyHidden = keys.some((k) => S.hidden.has(k));
    const head = h('h3', null, 'Stars',
      anyHidden ? h('button', { type: 'button', onclick: () => { S.hidden.clear(); afterFilter(); } }, 'Show all') : null,
      h('button', {
        type: 'button',
        class: 'toggle-legend',
        onclick: (e) => {
          legend.classList.toggle('collapsed');
          e.currentTarget.textContent = legend.classList.contains('collapsed') ? 'Show' : 'Hide';
        },
      }, W < 760 && (!legend.dataset.init || legend.classList.contains('collapsed')) ? 'Show' : 'Hide'));
    const ul = h('ul');
    for (const k of keys) {
      if (k === 'root') continue;
      ul.append(
        h('li', null,
          h('button', {
            type: 'button',
            class: S.hidden.has(k) ? 'off' : '',
            title: 'Click to hide or show. Alt-click to show only this kind.',
            onclick: (e) => {
              if (e.altKey) {
                const only = keys.filter((x) => x !== k && x !== 'root' && x !== 'group');
                const already = only.every((x) => S.hidden.has(x)) && !S.hidden.has(k);
                S.hidden = new Set(already ? [] : only);
              } else if (S.hidden.has(k)) S.hidden.delete(k);
              else S.hidden.add(k);
              afterFilter();
            },
          },
          h('i', { class: 'dot', style: `--c:${colorOfKey(k)}` }),
          h('span', { class: 'l-name' }, nameOfKey(k)),
          h('span', { class: 'l-count' }, counts.get(k).toLocaleString()))),
      );
    }
    legend.replaceChildren(head, ul);
    if (W < 760 && !legend.dataset.init) {
      legend.classList.add('collapsed');
      legend.dataset.init = '1';
    }
  }
  function afterFilter() {
    saveSettings();
    computeVisible();
    reheat(0.5);
    renderLegend();
    if (searchSet) runSearch();
  }

  // ------------------------------------------------------------------ settings ui
  const settingsEl = $('#settings');
  const btnSettings = $('#btn-settings');
  function bindSettings() {
    for (const key of ['repel', 'linkDist', 'linkStrength', 'center']) {
      const input = $(`#s-${key}`);
      const out = input.parentElement.querySelector('output');
      input.value = S[key];
      out.textContent = S[key];
      input.addEventListener('input', () => {
        S[key] = Number(input.value);
        out.textContent = input.value;
        if (key === 'repel') computeVisible();
        reheat(0.5);
        saveSettings();
      });
    }
    for (const key of ['showLabels', 'showContains', 'showMentions', 'showGhosts', 'showOrphans', 'particles']) {
      const input = $(`#t-${key}`);
      input.checked = Boolean(S[key]);
      input.addEventListener('change', () => {
        S[key] = input.checked;
        saveSettings();
        if (key !== 'showLabels' && key !== 'particles') {
          computeVisible();
          reheat(0.5);
        }
        needsRender = true;
      });
    }
    btnSettings.addEventListener('click', () => {
      settingsEl.hidden = !settingsEl.hidden;
      btnSettings.setAttribute('aria-expanded', String(!settingsEl.hidden));
    });
    $('#btn-relayout').addEventListener('click', () => {
      seedLayout(Math.floor(Math.random() * 1000) + 1);
      sim.alpha = 1;
      autoFit = true;
      needsRender = true;
    });
    $('#btn-reset').addEventListener('click', () => {
      Object.assign(S, { ...DEFAULTS, hidden: new Set() });
      saveSettings();
      for (const key of ['repel', 'linkDist', 'linkStrength', 'center']) {
        $(`#s-${key}`).value = S[key];
        $(`#s-${key}`).parentElement.querySelector('output').textContent = S[key];
      }
      for (const key of ['showLabels', 'showContains', 'showMentions', 'showGhosts', 'showOrphans', 'particles']) $(`#t-${key}`).checked = S[key];
      afterFilter();
    });
    $('#btn-fit').addEventListener('click', fit);
    $('#btn-time').addEventListener('click', () => (timelapse.active ? stopTimelapse() : startTimelapse()));
  }
  function closeFloating() {
    if (!settingsEl.hidden) {
      settingsEl.hidden = true;
      btnSettings.setAttribute('aria-expanded', 'false');
    }
  }

  // ------------------------------------------------------------------ keys
  addEventListener('keydown', (e) => {
    const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    if (typing) return;
    if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      q.focus();
      q.select();
    } else if (e.key === 'Escape') {
      if (!settingsEl.hidden) closeFloating();
      else select(null);
    } else if (e.key === 'f' || e.key === 'F') fit();
    else if (e.key === 't' || e.key === 'T') timelapse.active ? stopTimelapse() : startTimelapse();
  });

  // ------------------------------------------------------------------ hint
  let hintTimer = setTimeout(hideHint, 9000);
  function hideHint() {
    clearTimeout(hintTimer);
    $('#hint').classList.add('gone');
  }

  // ------------------------------------------------------------------ boot
  function resize() {
    W = innerWidth;
    H = innerHeight;
    const nd = Math.min(devicePixelRatio || 1, 2);
    if (nd !== dpr) starTiles = null;
    dpr = nd;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    needsRender = true;
  }
  addEventListener('resize', resize);

  function stats() {
    const m = DATA.meta || {};
    const c = m.counts || {};
    const parts = [
      `${nodes.length.toLocaleString()} stars`,
      `${links.length.toLocaleString()} links`,
    ];
    if (c.project) parts.push(`${c.project} projects`);
    if (m.sessions) parts.push(`${m.sessions.toLocaleString()} sessions`);
    if (m.generated) parts.push(fmtDate(m.generated));
    if (m.anonymized) parts.push('anonymized');
    else if (m.redacted) parts.push('redacted');
    $('#stats').textContent = parts.join(' · ');
  }

  resize();
  stats();
  if (!nodes.length) $('#empty').hidden = false;
  bindSettings();
  seedLayout();
  computeVisible();
  renderLegend();
  const t0 = fitTarget();
  cam.x = t0.x;
  cam.y = t0.y;
  cam.k = t0.k * 1.6;
  requestAnimationFrame(frame);
})();
