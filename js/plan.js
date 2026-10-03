// Floor-plan view (CONTRACT §5, T06).
// The REAL architectural drawing of a plate is the background (plate.image, placed with image.m = SVG matrix, so the SVG
// user space is building-local metres: x right, z down the sheet — z is NEGATIVE inside a plate, bounds come from the data).
// One hot-zone per apartment = its real polygon (+ its balconies), tinted by status. 'scheme' mode / automatic fallback
// (no image, image error) draws the same floor purely from polygons. Nothing here is mirrored in RTL pages.
import { UNITS, TYPES, BUILDINGS, B_IDS, COMPASS, PLOT, PODIUM,
  unitsOn, blocksOn, plateOf, typicalPlate, footprintOf, localToWorld, money } from './data.js';
import { t, lang, unitLabelL } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const PAPER = '#f3efe6';
const NARROW_PX = 620;          // stage narrower than this → portrait ("phone") layout
const UNITS_BY_ID = new Map(UNITS.map(u => [u.id, u]));

// ---- strings that are not in the dictionaries yet (see notes/T06.md "KEYS FOR I18N") ----
const LOCAL = {
  uk: { 'plan.entrance': 'Вхід', 'plan.roomsShort': '{n}к', 'plan.m2': 'м²', 'plan.imgFail': 'Креслення недоступне — показано схему' },
  en: { 'plan.entrance': 'Entrance', 'plan.roomsShort': '{n}-rm', 'plan.m2': 'm²', 'plan.imgFail': 'Drawing unavailable — the scheme is shown' },
  ru: { 'plan.entrance': 'Вход', 'plan.roomsShort': '{n}к', 'plan.m2': 'м²', 'plan.imgFail': 'Чертёж недоступен — показана схема' },
  he: { 'plan.entrance': 'כניסה', 'plan.roomsShort': '{n} חד׳', 'plan.m2': 'מ״ר', 'plan.imgFail': 'השרטוט אינו זמין — מוצגת סכמה' },
  ro: { 'plan.entrance': 'Intrare', 'plan.roomsShort': '{n} cam.' },
  de: { 'plan.entrance': 'Eingang', 'plan.roomsShort': '{n} Zi.' },
  fr: { 'plan.entrance': 'Entrée', 'plan.roomsShort': '{n} p.' },
  it: { 'plan.entrance': 'Ingresso', 'plan.roomsShort': '{n} loc.' },
};
function tl(key, vars) {
  let s = t(key, vars);
  if (s !== key) return s;
  s = LOCAL[lang]?.[key] ?? (lang === 'uk' ? null : LOCAL.en[key]) ?? LOCAL.uk[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}

// ---- small helpers ----
const f1 = n => (Math.round(n * 100) / 100).toString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pts = arr => arr.map(p => `${f1(p[0])},${f1(p[1])}`).join(' ');
const rectPoly = r => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
const fmtNum = (n, d) => { const s = Number(n).toFixed(d); return lang === 'uk' || lang === 'ru' ? s.replace('.', ',') : s; };
const m2 = () => tl('plan.m2');
const fmtArea = (n, d = 1) => `${fmtNum(n, d)} ${m2()}`;
const roomsText = r => (r === 1 ? t('rooms.1') : t('rooms.n', { n: r }));
const pad2 = n => String(n).padStart(2, '0');
const imgUrl = src => { try { return new URL('../' + src, import.meta.url).href; } catch (e) { return src; } };
const blockLabel = bl => bl.label?.[lang] ?? (() => { const k = 'plan.block.' + bl.kind; const s = t(k); return s === k ? (bl.label?.uk ?? bl.kind) : s; })();

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function bboxOf(lists) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const poly of lists) for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return { x0, x1, z0, z1 };
}
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function distToPoly(poly, x, z) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz;
    let s = L ? ((x - a[0]) * dx + (z - a[1]) * dz) / L : 0; s = s < 0 ? 0 : s > 1 ? 1 : s;
    const q = Math.hypot(x - a[0] - s * dx, z - a[1] - s * dz); if (q < d) d = q;
  }
  return d;
}
// Label point: the point of the polygon farthest from its boundary (and from `avoid` polygons), inside `clip` if given.
function pole(poly, { clip = null, avoid = [] } = {}) {
  let bb = bboxOf([poly]);
  if (clip) bb = { x0: Math.max(bb.x0, clip.x0), x1: Math.min(bb.x1, clip.x1), z0: Math.max(bb.z0, clip.z0), z1: Math.min(bb.z1, clip.z1) };
  if (!(bb.x1 > bb.x0 && bb.z1 > bb.z0)) return null;
  const score = (x, z) => {
    if (!inPoly(poly, x, z)) return -1;
    let d = distToPoly(poly, x, z);
    if (clip) d = Math.min(d, x - clip.x0, clip.x1 - x, z - clip.z0, clip.z1 - z);
    for (const a of avoid) { if (inPoly(a, x, z)) return -1; const q = distToPoly(a, x, z); if (q < d) d = q; }
    return d;
  };
  let best = { d: -1, x: 0, z: 0 };
  const scan = (b, step) => {
    for (let x = b.x0 + step / 2; x < b.x1; x += step) for (let z = b.z0 + step / 2; z < b.z1; z += step) {
      const d = score(x, z); if (d > best.d) best = { d, x, z };
    }
  };
  const step = Math.max(0.3, Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) / 36);
  scan(bb, step);
  if (best.d < 0) return null;
  scan({ x0: best.x - step, x1: best.x + step, z0: best.z - step, z1: best.z + step }, step / 5);
  return best;
}

// ---- public: polygons ----
export function unitPoly(u) { return u.poly && u.poly.length >= 3 ? u.poly : rectPoly(u.rect); }
export function outdoorPolys(u) { return (u.outdoor || []).map(o => (o.poly && o.poly.length >= 3 ? o.poly : rectPoly(o))); }
// legacy name (one polygon): the first outdoor room, or an empty list
export function outdoorPoly(u) { return outdoorPolys(u)[0] || []; }

export function statusClass(s) { return s === 'reserved' ? 'is-res' : s === 'sold' || s === 'blocked' ? 'is-sold' : 'is-avail'; }

// Everything that belongs to the plate, as polygons (for the view box and the image mask).
function platePolys(plate, units, blocks) {
  const body = [plate.outline];
  for (const u of units) { body.push(unitPoly(u)); for (const o of outdoorPolys(u)) body.push(o); }
  if (plate.core?.balcony) body.push(rectPoly(plate.core.balcony));
  for (const s of plate.core?.stairs || []) body.push(rectPoly(s));
  for (const l of plate.core?.lifts || []) body.push(rectPoly(l));
  return { body: body.filter(p => p && p.length >= 3), blocks: blocks.map(b => b.poly).filter(p => p && p.length >= 3) };
}
// Extent of the drawing in local metres (image.m has no rotation; handled generally anyway).
function imageExtent(im) {
  const [a, b, c, d, e, f] = im.m;
  return bboxOf([[[e, f], [a * im.w + e, b * im.w + f], [c * im.h + e, d * im.h + f], [a * im.w + c * im.h + e, b * im.w + d * im.h + f]]]);
}
// Content box: the plate body, plus the non-residential blocks as far as the drawing (or body + 6 m) reaches.
function contentBox(plate, units, blocks) {
  const P = platePolys(plate, units, blocks);
  const c = bboxOf(P.body);
  if (P.blocks.length) {
    const lim = plate.image ? imageExtent(plate.image) : { x0: c.x0 - 6, x1: c.x1 + 6, z0: c.z0 - 6, z1: c.z1 + 6 };
    const bb = bboxOf(P.blocks);
    c.x0 = Math.min(c.x0, Math.max(bb.x0, lim.x0)); c.x1 = Math.max(c.x1, Math.min(bb.x1, lim.x1));
    c.z0 = Math.min(c.z0, Math.max(bb.z0, lim.z0)); c.z1 = Math.max(c.z1, Math.min(bb.z1, lim.z1));
  }
  if (plate.entrance?.p) {                                    // room for the entrance arrow and its label
    const [ex, ez] = plate.entrance.p, [nx, nz] = plate.entrance.n || [0, 1];
    const px = ex + nx * 4, pz = ez + nz * 4;
    c.x0 = Math.min(c.x0, px - 1.5); c.x1 = Math.max(c.x1, px + 1.5); c.z0 = Math.min(c.z0, pz); c.z1 = Math.max(c.z1, pz);
  }
  return c;
}
const northRot = () => f1(((360 - COMPASS.negZ) % 360 + 360) % 360);   // needle is drawn along −z (sheet-up); true north is rotated from it

let INSTANCE = 0;

// css/plan.css is linked by index.html; if a page forgot it, load it from here so the plan never shows unstyled.
let cssChecked = false;
function ensureCss() {
  if (cssChecked || typeof document === 'undefined') return; cssChecked = true;
  try {
    if (document.querySelector('link[href*="plan.css"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../css/plan.css', import.meta.url).href;
    document.head.appendChild(l);
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------
const inPolyPt = (p, x, z) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
export function createPlan(host, opts = {}) {
  const { onSelect = () => {}, onHover = () => {}, statusOf = u => u.status, matches = () => true,
    numberOf = u => u.apNo ?? u.index } = opts;
  const uid = 'pl' + (++INSTANCE);
  ensureCss();
  host.classList.add('plan');
  host.innerHTML = '';
  const stage = document.createElement('div'); stage.className = 'plan-stage'; host.appendChild(stage);
  const svg = el('svg', { class: 'plan-svg', viewBox: '0 0 16 10', role: 'group', direction: 'ltr' }, stage);
  const defs = el('defs', {}, svg);
  { // hatches (per instance ids: a pattern inside a hidden svg does not paint in every browser)
    const h1 = el('pattern', { id: uid + '-hs', width: 0.9, height: 0.9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 0.9, class: 'pl-hatch-line' }, h1);
    const h2 = el('pattern', { id: uid + '-hr', width: 0.7, height: 0.7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' }, defs);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 0.7, class: 'pl-hatch-res' }, h2);
    const bl = el('filter', { id: uid + '-soft', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
    el('feGaussianBlur', { stdDeviation: 0.3 }, bl);
  }
  const maskEl = el('mask', { id: uid + '-mask', maskUnits: 'userSpaceOnUse' }, defs);
  const root = el('g', {}, svg);
  const card = document.createElement('div'); card.className = 'plan-card'; card.hidden = true; host.appendChild(card);
  const msg = document.createElement('p'); msg.className = 'plan-msg'; msg.hidden = true; msg.setAttribute('role', 'status'); host.appendChild(msg);
  const tools = document.createElement('div'); tools.className = 'plan-tools';
  tools.innerHTML = `<button type="button" class="icon-btn" data-z="in"><span aria-hidden="true">+</span></button>
    <button type="button" class="icon-btn" data-z="out"><span aria-hidden="true">−</span></button>
    <button type="button" class="icon-btn" data-z="reset"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
    <button type="button" class="icon-btn pl-mode-btn" data-z="mode" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 11h9M13 5v14M13 15h7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>`;
  host.appendChild(tools);

  let cur = null;                 // { b, f }
  let selected = null;
  let unitEls = new Map();
  let labels = [];                // [{ g, x, z, lim, base, hide }]  screen-constant labels
  let BOUNDS = { x: 0, y: 0, w: 16, h: 10 };
  let view = { ...BOUNDS };
  let wantMode = 'real';          // what the visitor asked for
  let imgFailed = new Set();      // image urls that failed to load
  let narrow = false, drawnW = 0, selRing = null;

  const stageW = () => stage.clientWidth || svg.getBoundingClientRect().width || 1000;
  const plate = () => (cur ? plateOf(cur.b, cur.f) : null);
  const hasImage = p => !!(p && p.image && p.image.src && !imgFailed.has(p.image.src));
  const modeNow = () => (wantMode === 'real' && hasImage(plate()) ? 'real' : 'scheme');

  function labelTools() {
    const L = { in: 'finder.zoomIn', out: 'finder.zoomOut', reset: 'finder.zoomReset', mode: 'plan.mode' };
    const m = modeNow();
    tools.querySelectorAll('button').forEach(b => {
      let s = t(L[b.dataset.z]);
      if (b.dataset.z === 'mode') {
        s = `${s}: ${t('plan.mode.' + m)}`;
        b.setAttribute('aria-pressed', String(m === 'scheme'));
        b.disabled = !hasImage(plate());
      }
      b.setAttribute('aria-label', s); b.title = s;
    });
    if (cur) svg.setAttribute('aria-label', `${t('ul.building')} ${BUILDINGS[cur.b]?.no ?? cur.b} · ${t('unit.floor', { n: cur.f })}`);
  }
  function applyMode() {
    const m = modeNow();
    host.classList.toggle('is-real', m === 'real');
    host.classList.toggle('is-scheme', m === 'scheme');
    const p = plate(); const failed = !!(p && p.image && imgFailed.has(p.image.src));
    msg.hidden = !failed; if (failed) msg.textContent = tl('plan.imgFail');
    labelTools();
  }

  // ---- view box for the current plate ----
  function computeBounds(p, units, blocks) {
    const pxW = stageW(); narrow = pxW < NARROW_PX; drawnW = pxW;
    const c = contentBox(p, units, blocks);
    const cw = c.x1 - c.x0, ch = c.z1 - c.z0;
    if (narrow) {
      const pad = 0.9;
      let w = cw + 2 * pad; const k = w / pxW; const top = 58 * k, bot = 54 * k;
      let h = ch + 2 * pad + top + bot;
      if (w / h < 0.62) w = h * 0.62;                       // never taller than ~1.6 × the width
      return { x: (c.x0 + c.x1) / 2 - w / 2, y: c.z0 - pad - top, w, h, c, top, bot, pad };
    }
    const pad = 2.2;
    const h = ch + 2 * pad;
    const NW = 11;                                          // free column on the left carries title, north, scale
    const w = Math.max(h * 1.6, cw + 2 * pad + NW + 2.5);   // + room for the tools at the right
    return { x: c.x0 - pad - NW - (w - NW - cw - 2 * pad) / 2, y: c.z0 - pad, w, h, c, top: 0, bot: 0, pad };
  }

  // screen-constant label: a <g> at (x, z) whose content is designed in CSS px and scaled to metres
  function addLabel(parent, cls, x, z, lim) {
    const g = el('g', { class: cls }, parent);
    labels.push({ g, x, z, lim: lim ?? Infinity, hide: cls.indexOf('pl-tag') < 0 });
    return g;
  }
  function rescaleLabels() {
    const r = svg.getBoundingClientRect(); const k = view.w / (r.width || stageW());   // metres per CSS px
    const boost = (narrow ? 0.94 : 1.12) * Math.pow(BOUNDS.w / view.w, 0.3);   // labels grow a little when zoomed in
    for (const L of labels) {
      const s = Math.min(k * boost, L.lim);
      L.g.setAttribute('transform', `translate(${f1(L.x)} ${f1(L.z)}) scale(${(Math.round(s * 1e4) / 1e4)})`);
      if (L.hide) L.g.classList.toggle('is-small', s < k * 0.62);          // an unreadable label is dropped until the visitor zooms in
    }
  }

  function drawCoreScheme(g, p) {
    const c = p.core; if (!c) return;
    const cg = el('g', { class: 'pl-core' }, g);
    if (c.balcony) el('rect', { x: c.balcony.x0, y: c.balcony.z0, width: c.balcony.x1 - c.balcony.x0, height: c.balcony.z1 - c.balcony.z0, class: 'pl-core-balc' }, cg);
    for (const s of c.stairs || []) {
      el('rect', { x: s.x0, y: s.z0, width: s.x1 - s.x0, height: s.z1 - s.z0, class: 'pl-stair-box' }, cg);
      const alongX = (s.x1 - s.x0) >= (s.z1 - s.z0); let d = '';
      if (alongX) {
        const mid = (s.z0 + s.z1) / 2; for (let x = s.x0 + 1.2; x <= s.x1 - 1.2 + 1e-6; x += 0.3) d += `M${f1(x)} ${f1(s.z0)}V${f1(s.z1)}`;
        el('path', { d, class: 'pl-tread' }, cg); el('line', { x1: s.x0 + 1.2, y1: mid, x2: s.x1 - 1.2, y2: mid, class: 'pl-stair-mid' }, cg);
      } else {
        const mid = (s.x0 + s.x1) / 2; for (let z = s.z0 + 1.2; z <= s.z1 - 1.2 + 1e-6; z += 0.3) d += `M${f1(s.x0)} ${f1(z)}H${f1(s.x1)}`;
        el('path', { d, class: 'pl-tread' }, cg); el('line', { x1: mid, y1: s.z0 + 1.2, x2: mid, y2: s.z1 - 1.2, class: 'pl-stair-mid' }, cg);
      }
    }
    for (const l of c.lifts || []) {
      el('rect', { x: l.x0, y: l.z0, width: l.x1 - l.x0, height: l.z1 - l.z0, class: 'pl-lift' }, cg);
      el('path', { d: `M${l.x0} ${l.z0}L${l.x1} ${l.z1}M${l.x1} ${l.z0}L${l.x0} ${l.z1}`, class: 'pl-lift-x' }, cg);
      if (l.door && l.n) { const tx = -l.n[1] * 0.5, tz = l.n[0] * 0.5; el('line', { x1: l.door[0] - tx, y1: l.door[1] - tz, x2: l.door[0] + tx, y2: l.door[1] + tz, class: 'pl-lift-door' }, cg); }
    }
  }

  function draw(reset) {
    root.innerHTML = ''; maskEl.innerHTML = ''; unitEls = new Map(); labels = []; selRing = null;
    if (!cur) return;
    const { b, f } = cur; const p = plateOf(b, f);
    const units = unitsOn(b, f), blocks = blocksOn(b, f);
    if (!p) { applyMode(); return; }
    const B = computeBounds(p, units, blocks);
    BOUNDS = { x: B.x, y: B.y, w: B.w, h: B.h };
    svg.style.aspectRatio = `${f1(B.w)} / ${f1(B.h)}`;
    if (reset || !(view.w > 0) || view.w > BOUNDS.w) view = { ...BOUNDS };
    const k0 = B.w / drawnW;                                  // metres per px at full view
    const P = platePolys(p, units, blocks);
    const clip = { x0: B.c.x0, x1: B.c.x1, z0: B.c.z0, z1: B.c.z1 };

    // paper
    const paper = el('g', { class: 'pl-paper' }, root);
    el('rect', { x: f1(B.x - B.w), y: f1(B.y - B.h), width: f1(B.w * 3), height: f1(B.h * 3) }, paper);

    // real drawing, cut to the plate (+0.95 m) so that cropped sheet annotations around it do not show
    if (p.image && p.image.src && !imgFailed.has(p.image.src)) {
      const im = p.image, ex = imageExtent(im);
      maskEl.setAttribute('x', f1(ex.x0)); maskEl.setAttribute('y', f1(ex.z0));
      maskEl.setAttribute('width', f1(ex.x1 - ex.x0)); maskEl.setAttribute('height', f1(ex.z1 - ex.z0));
      const mg = el('g', { filter: `url(#${uid}-soft)`, fill: '#fff', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linejoin': 'round' }, maskEl);
      for (const poly of [...P.body, ...P.blocks]) el('polygon', { points: pts(poly) }, mg);
      // the mask lives on a wrapper: a mask on the <image> itself would be read in the image's own (pixel) space
      const wrap = el('g', { class: 'pl-imgwrap', mask: `url(#${uid}-mask)` }, root);
      const img = el('image', { class: 'pl-img', x: 0, y: 0, width: im.w, height: im.h, preserveAspectRatio: 'none',
        transform: `matrix(${im.m.join(' ')})` }, wrap);
      img.addEventListener('error', () => { imgFailed.add(im.src); if (plate() === p) draw(false); });
      img.addEventListener('load', () => img.classList.add('is-loaded'));
      img.setAttribute('href', imgUrl(im.src));
    }

    // schematic layer (polygons only)
    const sch = el('g', { class: 'pl-scheme' }, root);
    el('polygon', { points: pts(p.outline), class: 'pl-slab' }, sch);
    for (const h of p.hall || []) el('rect', { x: h.x0, y: h.z0, width: f1(h.x1 - h.x0), height: f1(h.z1 - h.z0), class: 'pl-corr' }, sch);
    drawCoreScheme(sch, p);

    // non-residential blocks: outline in both modes, label in both modes
    const bg = el('g', { class: 'pl-blocks' }, root);
    const lg = el('g', { class: 'pl-labels' }, null);
    const unitPolysAll = units.flatMap(u => [unitPoly(u), ...outdoorPolys(u)]);
    const solids = [...(p.core?.lifts || []), ...(p.core?.stairs || [])].map(rectPoly);
    const byArea = [...blocks].sort((a, c2) => (c2.x1 - c2.x0) * (c2.z1 - c2.z0) - (a.x1 - a.x0) * (a.z1 - a.z0));
    for (const bl of byArea) {
      if (!bl.poly || bl.poly.length < 3) continue;
      const g = el('g', { class: `pl-block pl-block-${bl.kind}` }, bg);
      el('polygon', { points: pts(bl.poly), class: 'pl-block-body' }, g);
      const name = blockLabel(bl);
      const tt = el('title', {}, g); tt.textContent = bl.area ? `${name} · ${fmtArea(bl.area, 0)}` : name;
      const minor = bl.kind === 'technical' && (bl.area || 0) < 10;
      if (minor) continue;
      const others = blocks.filter(o => o !== bl && o.poly && (o.x1 - o.x0) * (o.z1 - o.z0) < (bl.x1 - bl.x0) * (bl.z1 - bl.z0)).map(o => o.poly);
      const at = pole(bl.poly, { clip, avoid: [...unitPolysAll, ...solids, ...others] });
      if (!at) continue;
      // T32: the sheets print the building title ("Будинок №1") in the middle of the lobby — exactly where this label landed.
      // The lobby label goes 1.5 m lower (onto the printed room name, which says the same) when that is still inside the room.
      if (bl.kind === 'lobby' && inPolyPt(bl.poly, at.x, at.z + 1.5)) at.z += 1.5;
      const big = bl.kind !== 'technical' && bl.kind !== 'lobby' && bl.kind !== 'parkingRamp';
      const wpx = name.length * (big ? 7.4 : 6.2) + 18;
      const L = addLabel(lg, `pl-lbl pl-lbl-block${big ? ' big' : ''}`, at.x, at.z, at.d / (wpx * 0.36));
      const hpx = big && bl.area ? 36 : 20;
      el('rect', { x: f1(-wpx / 2), y: -hpx / 2, width: f1(wpx), height: hpx, rx: 4, class: 'pl-lbl-bg' }, L);
      const tx = el('text', { x: 0, y: big && bl.area ? -3 : 4, 'text-anchor': 'middle', class: 'pl-lbl-t' }, L); tx.textContent = name;
      if (big && bl.area) { const ta = el('text', { x: 0, y: 11, 'text-anchor': 'middle', class: 'pl-lbl-s' }, L); ta.textContent = fmtArea(bl.area, 0); }
    }

    // apartments: one hot-zone each
    const ug = el('g', { class: 'pl-units' }, root);
    for (const u of units) {
      const T = TYPES[u.type] || { total: u.area };
      const st = statusOf(u), sc = statusClass(st);
      const g = el('g', { class: `pl-unit r${u.rooms} ${sc}`, 'data-id': u.id, tabindex: 0, role: 'button' }, ug);
      g.setAttribute('aria-label', ariaFor(u, st));
      const poly = unitPoly(u), outs = outdoorPolys(u);
      for (const o of outs) el('polygon', { points: pts(o), class: 'pl-out' }, g);
      el('polygon', { points: pts(poly), class: 'pl-body' }, g);
      if (sc !== 'is-avail') {
        const fill = `url(#${uid}-${sc === 'is-res' ? 'hr' : 'hs'})`;
        el('polygon', { points: pts(poly), class: 'pl-body-hatch', style: `fill:${fill}` }, g);
      }
      const at = pole(poly) || { x: u.tag?.[0] ?? u.center[0], z: u.tag?.[1] ?? u.center[1], d: 1.5 };
      const areaT = fmtArea(T.total, 1);
      // number and room count are two separate texts: one mixed-direction run would be reordered in Hebrew
      const numT = String(numberOf(u)), roomT = tl('plan.roomsShort', { n: u.rooms });
      const nW = numT.length * 8.3, rW = roomT.length * 5.4, gap = 3.5;
      const tw = Math.max(48, Math.max(nW + gap + rW, areaT.length * 5) + 12);
      const tag = addLabel(g, 'pl-tag', at.x, at.z, at.d / (tw / 2 + 1));
      el('rect', { x: f1(-tw / 2), y: -16.5, width: f1(tw), height: 33, rx: 5, class: 'pl-tag-bg' }, tag);
      const split = -(nW + gap + rW) / 2 + nW;
      const n1 = el('text', { x: f1(split), y: -1.5, 'text-anchor': 'end', class: 'pl-num' }, tag);
      n1.textContent = numT;
      const rs = el('text', { x: f1(split + gap), y: -1.5, 'text-anchor': 'start', class: 'pl-rooms' }, tag); rs.textContent = roomT;
      const a1 = el('text', { x: 0, y: 11.5, 'text-anchor': 'middle', class: 'pl-area' }, tag);
      a1.textContent = areaT;
      unitEls.set(u.id, g);
    }
    selRing = el('polygon', { class: 'pl-selring', points: '' }, root);

    // core, hall, entrance labels + block labels above the hot-zones (they never catch the pointer)
    const grouped = list => {                                  // adjacent shafts / flights share one label
      const groups = [];
      for (const l of list || []) {
        const g2 = groups.find(q => l.x0 < q.x1 + 1 && l.x1 > q.x0 - 1 && l.z0 < q.z1 + 1 && l.z1 > q.z0 - 1);
        if (g2) { g2.x0 = Math.min(g2.x0, l.x0); g2.x1 = Math.max(g2.x1, l.x1); g2.z0 = Math.min(g2.z0, l.z0); g2.z1 = Math.max(g2.z1, l.z1); }
        else groups.push({ x0: l.x0, x1: l.x1, z0: l.z0, z1: l.z1 });
      }
      return groups;
    };
    for (const q of grouped(p.core?.lifts)) coreLabel(lg, t('plan.lift'), q);
    for (const q of grouped(p.core?.stairs)) coreLabel(lg, t('plan.stairs'), q);
    if (p.entrance?.p) {
      const [ex, ez] = p.entrance.p, [nx, nz] = p.entrance.n || [0, 1];
      const a = Math.atan2(-nz, -nx) * 180 / Math.PI;       // arrow points INTO the building
      const eg = el('g', { class: 'pl-entry', transform: `translate(${f1(ex + nx * 1.5)} ${f1(ez + nz * 1.5)}) rotate(${f1(a)})` }, lg);
      el('path', { d: 'M-0.9 -0.75L0.7 0L-0.9 0.75Z' }, eg);
      const L = addLabel(lg, 'pl-lbl pl-lbl-entry', ex + nx * 3.1, ez + nz * 3.1, 0.2);
      const name = tl('plan.entrance'); const wpx = name.length * 6.2 + 14;
      el('rect', { x: f1(-wpx / 2), y: -10, width: f1(wpx), height: 20, rx: 4, class: 'pl-lbl-bg' }, L);
      const tx = el('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'pl-lbl-t' }, L); tx.textContent = name;
    }
    root.appendChild(lg);

    // notes: title, count, north, scale
    const ng = el('g', { class: 'pl-notes' }, root);
    const u0 = k0;                                            // 1 CSS px at full view, in metres
    const avail = units.filter(u => statusOf(u) === 'available').length;
    const rtl = document.documentElement.dir === 'rtl';
    const tAttr = rtl ? { direction: 'rtl', 'text-anchor': 'end' } : { 'text-anchor': 'start' };   // physical left edge at x in both directions
    const tx0 = B.x + 14 * u0, ty0 = B.y + (narrow ? 24 : 34) * u0;
    const titleText = `${t('ul.building')} ${BUILDINGS[b]?.no ?? b} · ${t('unit.floor', { n: f })}`;
    const subText = units.length ? t('plan.count', { n: units.length, a: avail }) : '';
    const room = narrow ? drawnW - 14 - 190 : Infinity;        // px left of the tools row on a phone
    const fsT = narrow ? Math.max(12, Math.min(17, room / (titleText.length * 0.5))) : 22;
    const fsS = narrow ? Math.max(8, Math.min(11, room / (subText.length * 0.7 || 1))) : 11;
    const title = el('text', { x: f1(tx0), y: f1(ty0), class: 'pl-title', style: `font-size:${f1(fsT * u0)}px`, ...tAttr }, ng);
    title.textContent = titleText;
    if (subText) {
      const sub = el('text', { x: f1(tx0), y: f1(ty0 + (narrow ? 17 : 20) * u0), class: 'pl-sub', style: `font-size:${f1(fsS * u0)}px`, ...tAttr }, ng);
      sub.textContent = subText;
    }
    const nr = 15 * u0;
    const nx = narrow ? B.x + B.w - 30 * u0 : B.x + 30 * u0;
    const ny = narrow ? B.y + B.h - 30 * u0 : B.y + B.h - 74 * u0;
    const north = el('g', { class: 'pl-north', transform: `translate(${f1(nx)} ${f1(ny)})` }, ng);
    el('circle', { cx: 0, cy: 0, r: f1(nr), class: 'pl-north-ring' }, north);
    const needle = el('g', { transform: `rotate(${northRot()}) scale(${f1(nr)})` }, north);
    el('path', { d: 'M0 -1.25L0.38 0.3L0 0.06L-0.38 0.3Z', class: 'pl-north-needle' }, needle);
    el('path', { d: 'M0 1.2L0.36 -0.26L0 -0.05L-0.36 -0.26Z', class: 'pl-north-tail' }, needle);
    { const a = (360 - COMPASS.negZ) * Math.PI / 180;        // the letter sits beyond the needle tip
      const nt = el('text', { x: f1(Math.sin(a) * nr * 1.75), y: f1(-Math.cos(a) * nr * 1.75 + 4 * u0), 'text-anchor': 'middle', class: 'pl-north-t', style: `font-size:${f1(11 * u0)}px` }, north);
      nt.textContent = t('plan.north'); }
    const sx = B.x + 14 * u0, sy = B.y + B.h - 14 * u0, tk = 4 * u0;
    const sc = el('g', { class: 'pl-scale' }, ng);
    el('path', { d: `M${f1(sx)} ${f1(sy)}h5M${f1(sx)} ${f1(sy - tk)}v${f1(tk * 2)}M${f1(sx + 5)} ${f1(sy - tk)}v${f1(tk * 2)}M${f1(sx + 2.5)} ${f1(sy - tk * 0.6)}v${f1(tk * 1.2)}`, class: 'pl-scale-line', style: `stroke-width:${f1(1.2 * u0)}px` }, sc);
    const s0 = el('text', { x: f1(sx), y: f1(sy - 8 * u0), class: 'pl-scale-t', 'text-anchor': 'middle', style: `font-size:${f1(10 * u0)}px` }, sc); s0.textContent = '0';
    const s5 = el('text', { x: f1(sx + 5), y: f1(sy - 8 * u0), class: 'pl-scale-t', 'text-anchor': 'middle', style: `font-size:${f1(10 * u0)}px` }, sc); s5.textContent = `5\u00A0${t('plan.m')}`;

    applyMode();
    setView(view);
    if (selected) markSelected();
    applyMatches();
  }

  function coreLabel(lg, name, r) {
    const w = r.x1 - r.x0, h = r.z1 - r.z0; const wpx = name.length * 6.2 + 12;
    const L = addLabel(lg, 'pl-lbl pl-lbl-core', (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, Math.min(w / (wpx * 0.8), h / 16));
    el('rect', { x: f1(-wpx / 2), y: -9, width: f1(wpx), height: 18, rx: 4, class: 'pl-lbl-bg' }, L);
    const tx = el('text', { x: 0, y: 3.6, 'text-anchor': 'middle', class: 'pl-lbl-t' }, L); tx.textContent = name;
  }

  function ariaFor(u, st) {
    const T = TYPES[u.type] || { total: u.area };
    const face = (u.facings || [u.facing]).filter(Boolean).map(x => t('face.' + x)).join(' / ');
    return [unitLabelL(u), roomsText(u.rooms), fmtArea(T.total, 2), money(u.price), face, t('status.' + st)].filter(Boolean).join(' · ');
  }

  function applyMatches() {
    for (const [id, g] of unitEls) g.classList.toggle('is-dim', !matches(UNITS_BY_ID.get(id)));
  }

  // ---- hover card ----
  function showCard(u, clientX, clientY) {
    const T = TYPES[u.type] || { total: u.area }; const st = statusOf(u);
    const face = (u.facings || [u.facing]).filter(Boolean).map(x => esc(t('face.' + x))).join(' / ');
    card.innerHTML = `<div class="pc-top"><span class="pc-id">${esc(unitLabelL(u))}</span><span class="pc-st ${statusClass(st)}">${esc(t('status.' + st))}</span></div>
      <div class="pc-rooms"><i class="dot r${u.rooms}"></i>${esc(roomsText(u.rooms))}</div>
      <div class="pc-price" dir="ltr">${esc(money(u.price))}</div>
      <div class="pc-meta"><span dir="ltr">${esc(fmtArea(T.total, 2))}</span><span dir="ltr">${esc(money(u.ppm))}/${esc(m2())}</span><span>${face}</span></div>`;
    card.hidden = false;
    const hr = host.getBoundingClientRect(); const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = clientX - hr.left + 16, y = clientY - hr.top + 16;
    if (x + cw > hr.width - 8) x = clientX - hr.left - cw - 16;
    if (y + ch > hr.height - 8) y = clientY - hr.top - ch - 16;
    card.style.left = Math.max(8, x) + 'px'; card.style.top = Math.max(8, y) + 'px';
  }
  function hideCard() { card.hidden = true; }

  // ---- pointer interaction: pan/zoom + click ----
  const pointers = new Map(); let drag = null; let moved = 0; let pinch = null;
  function setView(v) {
    const minW = BOUNDS.w / 6;
    v.w = Math.min(BOUNDS.w, Math.max(minW, v.w)); v.h = v.w * BOUNDS.h / BOUNDS.w;
    v.x = Math.min(BOUNDS.x + BOUNDS.w - v.w, Math.max(BOUNDS.x, v.x));
    v.y = Math.min(BOUNDS.y + BOUNDS.h - v.h, Math.max(BOUNDS.y, v.y));
    view = v; svg.setAttribute('viewBox', `${f1(v.x)} ${f1(v.y)} ${f1(v.w)} ${f1(v.h)}`);
    const zoomed = v.w < BOUNDS.w - 0.01;
    stage.classList.toggle('is-zoomed', zoomed);
    rescaleLabels();
  }
  function toSvg(cx, cy) { const r = svg.getBoundingClientRect(); return [view.x + (cx - r.left) / r.width * view.w, view.y + (cy - r.top) / r.height * view.h]; }
  function zoomAt(k, cx, cy) {
    const [sx, sy] = cx == null ? [view.x + view.w / 2, view.y + view.h / 2] : toSvg(cx, cy);
    const nw = view.w / k; const nh = nw * BOUNDS.h / BOUNDS.w;
    setView({ x: sx - (sx - view.x) * nw / view.w, y: sy - (sy - view.y) * nh / view.h, w: nw, h: nh });
  }
  tools.addEventListener('click', e => {
    const z = e.target.closest('button')?.dataset.z; if (!z) return;
    if (z === 'in') zoomAt(1.5); else if (z === 'out') zoomAt(1 / 1.5);
    else if (z === 'mode') setMode(modeNow() === 'real' ? 'scheme' : 'real');
    else setView({ ...BOUNDS });
  });
  svg.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey) && view.w >= BOUNDS.w - 0.01) return; // let the page scroll unless zooming
    e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
  }, { passive: false });
  svg.addEventListener('dblclick', e => {
    if (e.target.closest?.('.pl-unit')) return;
    e.preventDefault(); if (view.w < BOUNDS.w - 0.01) setView({ ...BOUNDS }); else zoomAt(2, e.clientX, e.clientY);
  });
  svg.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]); moved = 0;
    if (pointers.size === 2) {
      const [a, b2] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b2[0], a[1] - b2[1]), w: view.w, mid: [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2] };
      drag = null;
    } else if (view.w < BOUNDS.w - 0.01 || e.pointerType === 'mouse') {
      drag = { x: e.clientX, y: e.clientY, v: { ...view } };
    }
  });
  svg.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b2] = [...pointers.values()]; const d = Math.hypot(a[0] - b2[0], a[1] - b2[1]);
      // target width = start width scaled by finger distance; zoomAt takes a factor relative to the current width
      zoomAt(view.w * d / (pinch.w * pinch.d), pinch.mid[0], pinch.mid[1]);
      moved = 99; hideCard(); return;
    }
    if (drag && pointers.size === 1) {
      const r = svg.getBoundingClientRect(); const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved > 4 && view.w < BOUNDS.w - 0.01) { setView({ ...view, x: drag.v.x - dx / r.width * view.w, y: drag.v.y - dy / r.height * view.h }); hideCard(); }
    }
    if (e.pointerType === 'mouse' && !pointers.size) {
      const g = e.target.closest?.('.pl-unit');
      if (g) { const u = UNITS_BY_ID.get(g.dataset.id); showCard(u, e.clientX, e.clientY); hover(u); }
      else { hideCard(); hover(null); }
    }
  });
  const endPtr = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
  svg.addEventListener('pointerup', endPtr); svg.addEventListener('pointercancel', endPtr);
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hideCard(); hover(null); } });
  svg.addEventListener('click', e => {
    if (moved > 6) return;
    const g = e.target.closest('.pl-unit'); if (!g) return;
    select(g.dataset.id); onSelect(UNITS_BY_ID.get(g.dataset.id));
  });
  svg.addEventListener('keydown', e => {
    const g = e.target.closest?.('.pl-unit');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.dataset.id); onSelect(UNITS_BY_ID.get(g.dataset.id)); return; }
    if (g && e.key.startsWith('Arrow')) {                    // move the focus to the nearest apartment in that direction
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      const from = UNITS_BY_ID.get(g.dataset.id); let best = null, bd = Infinity;
      for (const id of unitEls.keys()) {
        if (id === from.id) continue; const u = UNITS_BY_ID.get(id);
        const dx = u.center[0] - from.center[0], dz = u.center[1] - from.center[1];
        const along = dx * dir[0] + dz * dir[1], across = Math.abs(dx * dir[1] - dz * dir[0]);
        if (along < 0.5) continue; const d = along + across * 2; if (d < bd) { bd = d; best = id; }
      }
      if (best) { e.preventDefault(); unitEls.get(best).focus(); }
      return;
    }
    if (e.key === '+' || e.key === '=') zoomAt(1.4); if (e.key === '-') zoomAt(1 / 1.4);
    if (e.key === '0' || e.key === 'Escape') setView({ ...BOUNDS });
  });
  svg.addEventListener('focusin', e => {
    const g = e.target.closest?.('.pl-unit'); if (!g) return;
    const r = g.getBoundingClientRect(); const u = UNITS_BY_ID.get(g.dataset.id);
    if (g.matches(':focus-visible')) showCard(u, r.right, r.top + r.height / 2);
    hover(u);
  });
  svg.addEventListener('focusout', () => { hideCard(); hover(null); });
  let lastHover = null;
  function hover(u) { const id = u?.id || null; if (id === lastHover) return; lastHover = id; onHover(u || null); }

  function markSelected() {
    for (const [id, g] of unitEls) { const on = id === selected; g.classList.toggle('is-sel', on); g.setAttribute('aria-pressed', String(on)); }
    if (selRing) { const u = selected && unitEls.has(selected) ? UNITS_BY_ID.get(selected) : null; selRing.setAttribute('points', u ? pts(unitPoly(u)) : ''); }
  }
  function select(id) { selected = id || null; markSelected(); }
  function setMode(m) { wantMode = m === 'scheme' ? 'scheme' : 'real'; applyMode(); }

  // keep labels at their screen size, and switch the layout when the stage crosses the phone width
  let roT = 0;
  const onResize = () => {
    const w = stageW(); if (!cur || !w) return;
    if ((w < NARROW_PX) !== narrow || Math.abs(w - drawnW) / (drawnW || 1) > 0.06) draw(true); else rescaleLabels();
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(onResize, 60); }).observe(stage);
  else window.addEventListener('resize', onResize);

  applyMode();
  return {
    show(b, f) { cur = { b, f }; hideCard(); draw(true); },
    refresh() { draw(false); },
    applyMatches,
    select,
    setMode,
    get mode() { return modeNow(); },
    get current() { return cur ? { ...cur } : null; },
  };
}

// ---------------------------------------------------------------------------------------------
// Key plan (string) for the unit sheet: the four towers on the plot with this one highlighted (left) and the floor of the
// apartment with the apartment picked out (right). Both parts share the sheet orientation and one north arrow.
export function keyPlanSVG(unit) {
  ensureCss();
  const b = unit.building, f = unit.floor;
  const p = plateOf(b, f) || typicalPlate(b);
  const us = unitsOn(b, f);
  const W = 300, H = 120, G = 6;
  const fit = (bb, x, y, w, h) => {                           // uniform fit of a metre box into a px box, centred
    const s = Math.min(w / (bb.x1 - bb.x0), h / (bb.z1 - bb.z0));
    const tx = x + (w - (bb.x1 - bb.x0) * s) / 2 - bb.x0 * s, ty = y + (h - (bb.z1 - bb.z0) * s) / 2 - bb.z0 * s;
    return { s, tr: `translate(${f1(tx)} ${f1(ty)}) scale(${(Math.round(s * 1e4) / 1e4)})`, at: (px, pz) => [tx + px * s, ty + pz * s] };
  };
  let s = `<svg class="keyplan" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('unit.keyplan'))}" direction="ltr">`;

  // left: the plot
  const towers = B_IDS.map(id => ({ id, poly: footprintOf(id).map(q => localToWorld(id, q[0], q[1])) })).filter(x => x.poly.length >= 3);
  const sb = bboxOf([PLOT, ...towers.map(x => x.poly)]);
  const S = fit(sb, G, G, 104, H - 2 * G);
  s += `<g transform="${S.tr}"><polygon points="${pts(PLOT)}" class="kp-plot"/>`;
  for (const pd of PODIUM || []) if (pd.poly?.length >= 3) s += `<polygon points="${pts(pd.poly)}" class="kp-pod"/>`;
  for (const x of towers) s += `<polygon points="${pts(x.poly)}" class="kp-b${x.id === b ? ' on' : ''}"/>`;
  s += `</g>`;
  for (const x of towers) {
    const bb = bboxOf([x.poly]); const [cx, cy] = S.at((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2);
    s += `<text x="${f1(cx)}" y="${f1(cy + 3.4)}" text-anchor="middle" class="kp-bt${x.id === b ? ' on' : ''}">${esc(BUILDINGS[x.id]?.no ?? x.id)}</text>`;
  }
  s += `<path d="M${G + 110} ${G + 6}V${H - G - 6}" class="kp-sep"/>`;

  // right: the floor
  const polys = [p.outline, ...us.flatMap(u => [unitPoly(u), ...outdoorPolys(u)])];
  const F = fit(bboxOf(polys), G + 122, G, W - 2 * G - 122 - 26, H - 2 * G);
  s += `<g transform="${F.tr}"><polygon points="${pts(p.outline)}" class="kp-slab"/>`;
  for (const c of p.hall || []) s += `<rect x="${c.x0}" y="${c.z0}" width="${f1(c.x1 - c.x0)}" height="${f1(c.z1 - c.z0)}" class="kp-corr"/>`;
  for (const c of [...(p.core?.lifts || []), ...(p.core?.stairs || [])]) s += `<rect x="${c.x0}" y="${c.z0}" width="${f1(c.x1 - c.x0)}" height="${f1(c.z1 - c.z0)}" class="kp-core"/>`;
  for (const u of us) {
    const on = u.id === unit.id;
    if (!on) s += `<polygon points="${pts(unitPoly(u))}" class="kp-u"/>`;
  }
  for (const o of outdoorPolys(unit)) s += `<polygon points="${pts(o)}" class="kp-u on out"/>`;
  s += `<polygon points="${pts(unitPoly(unit))}" class="kp-u on"/></g>`;

  // north
  s += `<g transform="translate(${W - G - 10} ${G + 14})"><circle r="8" class="kp-n"/><path d="M0 -10L3 2 0 .4-3 2Z" class="kp-nn" transform="rotate(${northRot()})"/>`;
  s += `<text y="24" text-anchor="middle" class="kp-nt">${esc(t('plan.north'))}</text></g>`;
  s += `</svg>`;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Plan of ONE apartment (string) for the top of the unit sheet: the crop of the real drawing around the flat (+1.2 m), the
// rest veiled, the flat outlined in gold. Under the drawing lies a plain scheme built from the room boxes of the plate
// data, so the sheet still shows a plan while the image loads or if it fails. `{ mode: 'scheme' }` forces the scheme.
// Without room boxes (building 2) the scheme is the outline of the flat with its room count and area. Returns '' only
// when the unit has no plate or no outline.
export function unitPlanSVG(unit, { mode = 'real', pad = 1.2 } = {}) {
  ensureCss();
  const p = plateOf(unit.building, unit.floor); if (!p) return '';
  const src = p.units?.find(x => x.slot === unit.index);
  const rooms = (src?.list || []).filter(r => Array.isArray(r.b) && r.b.length === 4);
  const im = mode === 'real' && p.image && p.image.src ? p.image : null;
  const poly = unitPoly(unit), outs = outdoorPolys(unit);
  if (!poly || poly.length < 3) return '';
  const bb = bboxOf([poly, ...outs]);
  let x = bb.x0 - pad, y = bb.z0 - pad, w = bb.x1 - bb.x0 + 2 * pad, h = bb.z1 - bb.z0 + 2 * pad;
  if (w / h < 0.8) { const nw = h * 0.8; x -= (nw - w) / 2; w = nw; }       // keep the picture from getting too tall
  if (w / h > 1.9) { const nh = w / 1.9; y -= (nh - h) / 2; h = nh; }
  const u0 = w / 420;                                                         // ≈ 1 CSS px in metres at a 420 px wide sheet
  const id = 'up-' + String(unit.id).replace(/[^\w-]/g, '');
  const T = TYPES[unit.type] || { total: unit.area };
  const aria = `${t('unit.plan')} · ${unitLabelL(unit)} · ${roomsText(unit.rooms)} · ${fmtArea(T.total, 2)}`;
  const shape = [poly, ...outs].map(q => 'M' + q.map(c => `${f1(c[0])} ${f1(c[1])}`).join('L') + 'Z').join('');
  let s = `<svg class="unitplan${im ? '' : ' is-scheme'}" viewBox="${f1(x)} ${f1(y)} ${f1(w)} ${f1(h)}" role="img" aria-label="${esc(aria)}" direction="ltr">`;
  s += `<defs><clipPath id="${id}-c"><path d="${shape}"/></clipPath></defs>`;
  s += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" class="up-paper"/>`;
  // scheme from the room boxes (largest first, so that a niche lies on top of the room it is cut from)
  if (rooms.length) {
    s += `<g class="up-scheme" clip-path="url(#${id}-c)">`;
    const sorted = [...rooms].sort((a, c) => (c.b[2] - c.b[0]) * (c.b[3] - c.b[1]) - (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]));
    for (const r of sorted) s += `<rect x="${r.b[0]}" y="${r.b[1]}" width="${f1(r.b[2] - r.b[0])}" height="${f1(r.b[3] - r.b[1])}" class="up-room up-${esc(r.kind)}"/>`;
    s += `</g>`;
    // labels: designed in px inside a scaled group (tiny user-unit font sizes render with broken spacing); each label sits in
    // the part of its box that no smaller room covers
    sorted.forEach((r, i) => {
      const over = sorted.slice(i + 1).map(o => o.b);
      const free = (px, pz) => {
        let d = Math.min(px - r.b[0], r.b[2] - px, pz - r.b[1], r.b[3] - pz);
        for (const o of over) {
          if (px > o[0] && px < o[2] && pz > o[1] && pz < o[3]) return -1;
          const q = Math.hypot(Math.max(o[0] - px, 0, px - o[2]), Math.max(o[1] - pz, 0, pz - o[3])); if (q < d) d = q;
        }
        return d;
      };
      let best = { d: -1, x: (r.b[0] + r.b[2]) / 2, z: (r.b[1] + r.b[3]) / 2 };
      for (let a = 1; a < 12; a++) for (let c = 1; c < 12; c++) {
        const px = r.b[0] + (r.b[2] - r.b[0]) * a / 12, pz = r.b[1] + (r.b[3] - r.b[1]) * c / 12;
        if (!inPoly(poly, px, pz) && !outs.some(o => inPoly(o, px, pz))) continue;
        const d = free(px, pz); if (d > best.d) best = { d, x: px, z: pz };
      }
      if (best.d <= 0) return;
      let x0 = r.b[0], x1 = r.b[2];                                  // free width on the label's line
      for (const o of over) if (best.z > o[1] - 0.25 && best.z < o[3] + 0.25) { if (o[2] <= best.x) x0 = Math.max(x0, o[2]); else if (o[0] >= best.x) x1 = Math.min(x1, o[0]); }
      const half = Math.min(best.x - x0, x1 - best.x);
      const name = t(r.nk || 'room.other'); const area = fmtArea(r.area, 2);
      let k = Math.min(u0, (2 * half) / (name.length * 6.6 + 6), (2 * best.d) / 24);
      if (k >= u0 * 0.6) {
        s += `<g class="up-lbl" transform="translate(${f1(best.x)} ${f1(best.z)}) scale(${Math.round(k * 1e4) / 1e4})"><text y="-1.5" text-anchor="middle" class="up-rt">${esc(name)}</text><text y="11" text-anchor="middle" class="up-ra">${esc(area)}</text></g>`;
      } else {
        k = Math.min(u0, (2 * half) / (area.length * 5.6 + 4), (2 * best.d) / 11);
        if (k >= u0 * 0.5) s += `<g class="up-lbl" transform="translate(${f1(best.x)} ${f1(best.z)}) scale(${Math.round(k * 1e4) / 1e4})"><text y="3.5" text-anchor="middle" class="up-ra">${esc(area)}</text></g>`;
      }
    });
  } else {
    // no room boxes in the data (building 2): the outline of the flat with its room count and area
    s += `<path d="${shape}" class="up-room up-plain"/>`;
    const at = pole(poly) || { x: (bb.x0 + bb.x1) / 2, z: (bb.z0 + bb.z1) / 2, d: 1 };
    const name = roomsText(unit.rooms);
    const k = Math.min(u0 * 1.25, (2 * at.d) / (name.length * 6.6 + 6));
    s += `<g class="up-lbl" transform="translate(${f1(at.x)} ${f1(at.z)}) scale(${Math.round(k * 1e4) / 1e4})"><text y="-1.5" text-anchor="middle" class="up-rt">${esc(name)}</text><text y="11" text-anchor="middle" class="up-ra">${esc(fmtArea(T.total, 2))}</text></g>`;
  }
  if (im) {
    s += `<image class="up-img" href="${esc(imgUrl(im.src))}" x="0" y="0" width="${im.w}" height="${im.h}" preserveAspectRatio="none" transform="matrix(${im.m.join(' ')})"/>`;
    s += `<path class="up-veil" fill-rule="evenodd" d="M${f1(x)} ${f1(y)}h${f1(w)}v${f1(h)}h${f1(-w)}Z${shape}"/>`;
  }
  for (const o of outs) s += `<polygon points="${pts(o)}" class="up-out"/>`;
  s += `<polygon points="${pts(poly)}" class="up-line"/>`;
  // north + 1 m scale
  const nr = 11 * u0, nx = x + w - 20 * u0, ny = y + 22 * u0;
  s += `<g class="up-north" transform="translate(${f1(nx)} ${f1(ny)})"><circle r="${f1(nr)}" class="up-nring"/><path d="M0 -1.3L0.4 0.3 0 0.06-0.4 0.3Z" class="up-nn" transform="rotate(${northRot()}) scale(${f1(nr)})"/></g>`;
  const sx = x + 12 * u0, sy = y + h - 12 * u0;
  s += `<path class="up-scale" stroke-width="${f1(1.2 * u0)}" d="M${f1(sx)} ${f1(sy)}h2M${f1(sx)} ${f1(sy - 3 * u0)}v${f1(6 * u0)}M${f1(sx + 2)} ${f1(sy - 3 * u0)}v${f1(6 * u0)}M${f1(sx + 1)} ${f1(sy - 2 * u0)}v${f1(4 * u0)}"/>`;
  s += `<g transform="translate(${f1(sx + 2 + 6 * u0)} ${f1(sy + 3.5 * u0)}) scale(${Math.round(u0 * 1e4) / 1e4})"><text class="up-scale-t">2\u00A0${esc(t('plan.m'))}</text></g>`;
  s += `</svg>`;
  return s;
}
