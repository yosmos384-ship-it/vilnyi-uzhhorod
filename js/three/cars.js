// ЖК VILNYI (Ужгород) — procedural luxury cars (no brands, no badges) + a drivable fleet, the parked cars of the site,
// the outdoor colliders and the drive area.
// Six generic designs: a formal luxury saloon, a sport coupé, a luxury SUV, a grand tourer, an executive EV saloon and a
// mid-engined supercar.
// Bodies are analytic lofts (superellipse sections along monotone-spline side/plan profiles) so details such as
// lights, grilles, shut lines and chrome are "projected" onto the exact surface (decals) instead of floating.
// A detailed car is 8 draw calls (paint, glass, trim, lights, interior, number plates, steering wheel, 4 instanced wheels);
// far cars are two instanced meshes per model. Car frame: +z forward, +y up, driver on the left (+x), origin on the
// ground midway between the axles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BUILDINGS, B_IDS, CONTEXT_BLOCKS, PODIUM, RAMPS, PLOT, SITE_CENTER, STREETS, COURTYARD, SITE_EXTRAS, footprintOf, coresOf, localToWorld } from '../data.js';

// Optional data of site-layout.js (another task's module): the guest parking pockets around the plot. Everything here
// works without it (no pockets then); the streets always come from data.js STREETS.
let LAYOUT = null;
try { LAYOUT = await import('./site-layout.js'); } catch (e) { LAYOUT = null; }
const parkingPockets = () => (LAYOUT && Array.isArray(LAYOUT.PARKING_POCKETS) ? LAYOUT.PARKING_POCKETS : []);

export const CAR_KINDS = ['sedan', 'coupe', 'suv', 'gt', 'ev', 'super'];
export const CAR_COLOURS = {
  black: '#08090b', graphite: '#33363b', pearl: '#ebe8e1', blue: '#0f2147', champagne: '#b39a72', green: '#0d3322',
};
export const COLOUR_NAMES = Object.keys(CAR_COLOURS);
const INTERIORS = [
  { leather: '#7a4a2a', accent: '#3b2616', dark: '#141312', head: '#cfc4b2' },   // cognac + walnut
  { leather: '#d6c9b0', accent: '#8f8f93', dark: '#1a1918', head: '#e2dccf' },   // ivory + aluminium
  { leather: '#1d1c1b', accent: '#6b4a2e', dark: '#0f0f0f', head: '#2a2927' },   // black + wood
  { leather: '#4a1a1a', accent: '#2b2b2e', dark: '#121111', head: '#cbc2b3' },   // oxblood + carbon
];

// ------------------------------------------------------------------ specs (metres)
// top/sill: [z, y] from rear to front. zA windscreen base, zT1/zT2 roof front/rear, zC rear-glass base, belt bA/bC.
const SPECS = {
  sedan: {
    L: 5.22, W: 1.93, wb: 3.1, R: 0.365, tw: 0.255, yE: 0.62, kF: 16, kR: 14, nU: 11, nL: 7, lean: 0.04,
    top: [[-2.69, 0.8], [-2.64, 0.93], [-2.5, 1.0], [-2.25, 1.04], [-1.85, 1.06], [0.85, 1.01], [1.3, 0.955], [1.9, 0.875], [2.3, 0.815], [2.47, 0.775], [2.53, 0.72]],
    sill: [[-2.69, 0.45], [-2.5, 0.28], [-2.1, 0.22], [1.95, 0.22], [2.4, 0.26], [2.53, 0.34]],
    zA: 0.85, zT1: 0.02, zT2: -1.08, zC: -1.86, bA: 0.975, bC: 1.02, roof: 1.48, nG: 6, gLean: 0.3, zB: -0.45,
    cp: 0.93, haunch: [0.01, 0.018], seat: -0.2, grille: 'tall', head: 'sedan', tail: 'sedan', exh: 2, chrome: true, doors: 4,
  },
  coupe: {
    L: 4.55, W: 1.9, wb: 2.55, R: 0.35, tw: 0.27, yE: 0.54, kF: 7, kR: 10, nU: 8, nL: 5, lean: 0.07,
    top: [[-2.325, 0.72], [-2.28, 0.84], [-2.15, 0.9], [-1.95, 0.93], [0.55, 0.865], [1.0, 0.83], [1.35, 0.8], [1.75, 0.735], [2.08, 0.66], [2.225, 0.52]],
    sill: [[-2.325, 0.4], [-2.15, 0.22], [-1.8, 0.18], [1.7, 0.18], [2.1, 0.2], [2.225, 0.3]],
    zA: 0.55, zT1: -0.2, zT2: -0.62, zC: -1.98, bA: 0.845, bC: 0.905, roof: 1.27, nG: 4.5, gLean: 0.36, zB: -0.3,
    cp: 1.01, haunch: [0.006, 0.04], seat: -0.42, grille: 'intake', head: 'coupe', tail: 'bar', exh: 4, chrome: false, doors: 2,
  },
  suv: {
    L: 5.0, W: 2.0, wb: 3.0, R: 0.4, tw: 0.275, yE: 0.8, kF: 18, kR: 18, nU: 13, nL: 8, lean: 0.03,
    top: [[-2.55, 1.02], [-2.5, 1.16], [-2.4, 1.21], [-2.3, 1.235], [1.02, 1.185], [1.6, 1.13], [2.2, 1.085], [2.38, 1.02], [2.45, 0.88]],
    sill: [[-2.55, 0.56], [-2.35, 0.35], [-2.0, 0.31], [2.0, 0.31], [2.35, 0.37], [2.45, 0.5]],
    zA: 1.02, zT1: 0.36, zT2: -1.95, zC: -2.32, bA: 1.165, bC: 1.21, roof: 1.84, nG: 7, gLean: 0.22, zB: -0.32,
    cp: 0.8, haunch: [0.008, 0.01], seat: 0.02, grille: 'suv', head: 'suv', tail: 'suv', exh: 0, chrome: true, doors: 4,
  },
  gt: {
    L: 4.85, W: 1.96, wb: 2.85, R: 0.37, tw: 0.275, yE: 0.58, kF: 9, kR: 12, nU: 9, nL: 5.5, lean: 0.06,
    top: [[-2.525, 0.78], [-2.47, 0.9], [-2.3, 0.96], [-2.0, 0.99], [0.45, 0.935], [1.0, 0.905], [1.7, 0.865], [2.1, 0.825], [2.28, 0.775], [2.325, 0.7]],
    sill: [[-2.525, 0.42], [-2.3, 0.23], [-1.9, 0.2], [1.8, 0.2], [2.2, 0.23], [2.325, 0.34]],
    zA: 0.45, zT1: -0.3, zT2: -0.92, zC: -2.02, bA: 0.905, bC: 0.965, roof: 1.37, nG: 5, gLean: 0.34, zB: -0.55,
    cp: 1.01, haunch: [0.006, 0.04], seat: -0.62, grille: 'matrix', head: 'gt', tail: 'quad', exh: 2, chrome: true, doors: 2,
  },
  ev: {
    L: 5.0, W: 1.96, wb: 3.0, R: 0.36, tw: 0.265, yE: 0.58, kF: 9, kR: 11, nU: 9, nL: 6, lean: 0.06,
    top: [[-2.55, 0.84], [-2.5, 0.95], [-2.3, 1.0], [-2.05, 1.03], [1.1, 0.965], [1.5, 0.9], [2.0, 0.8], [2.35, 0.7], [2.45, 0.56]],
    sill: [[-2.55, 0.4], [-2.35, 0.24], [-2.0, 0.2], [2.0, 0.2], [2.35, 0.24], [2.45, 0.34]],
    zA: 1.1, zT1: 0.2, zT2: -0.78, zC: -2.07, bA: 0.935, bC: 1.0, roof: 1.43, nG: 5, gLean: 0.32, zB: -0.32,
    cp: 1.01, haunch: [0.012, 0.025], seat: 0.08, grille: 'closed', head: 'ev', tail: 'bar', exh: 0, chrome: false, doors: 4,
  },
  // mid-engined supercar: cab-forward, low and wide, big rear haunches, side scoops ahead of the rear wheels
  super: {
    L: 4.62, W: 2.02, wb: 2.7, R: 0.355, tw: 0.3, yE: 0.5, kF: 6, kR: 9, nU: 7, nL: 4.5, lean: 0.1,
    top: [[-2.36, 0.74], [-2.3, 0.88], [-2.12, 0.97], [-1.7, 1.02], [-1.0, 1.06], [-0.5, 1.05], [0.55, 0.9], [1.1, 0.875], [1.5, 0.845], [1.9, 0.75], [2.15, 0.6], [2.26, 0.44]],
    sill: [[-2.36, 0.33], [-2.15, 0.16], [-1.8, 0.13], [1.7, 0.13], [2.1, 0.15], [2.26, 0.24]],
    zA: 0.62, zT1: -0.05, zT2: -0.55, zC: -1.55, bA: 0.86, bC: 1.0, roof: 1.16, nG: 4, gLean: 0.42, zB: -0.75,
    cp: 1.01, haunch: [0.006, 0.055], seat: -0.36, grille: 'intake', head: 'super', tail: 'bar', exh: 2, chrome: false, doors: 2, seats: 2, scoop: true,
  },
};
for (const S of Object.values(SPECS)) {
  S.zR = S.top[0][0]; S.zF = S.top[S.top.length - 1][0];
  S.wheelX = S.W / 2 - S.tw / 2 - 0.035;
  S.Ra = S.R + 0.055;
  S.floor = S.sill[2][1] + 0.08;
  S.cushion = S.floor + (S.yE > 0.7 ? 0.32 : 0.24);
  S.eye = Math.min(S.cushion + 0.66, S.roof - 0.19);   // low roofs: a reclined seat, eyes clear of the headliner
  S.cushion = Math.min(S.cushion, S.eye - 0.6);
  S.driverX = S.W > 1.95 ? 0.4 : 0.37;
}
export function carSpec(kind) { return SPECS[kind] || SPECS.sedan; }

// ------------------------------------------------------------------ math helpers
function mono(pts) {   // monotone cubic (Fritsch–Carlson) through [x, y] pairs sorted by x
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// ------------------------------------------------------------------ analytic body model
function bodyModel(kind) {
  const S = carSpec(kind);
  const top = mono(S.top), sill = mono(S.sill);
  const belt = z => lerp(S.bC, S.bA, clamp((z - S.zC) / (S.zA - S.zC)));
  const wheelsZ = [S.wb / 2, -S.wb / 2];
  const arch = z => { let y = -1; for (const zw of wheelsZ) { const d = z - zw; if (Math.abs(d) < S.Ra) y = Math.max(y, S.R + Math.sqrt(S.Ra * S.Ra - d * d)); } return y; };
  const yb = z => Math.max(sill(z), arch(z));
  // over the cabin the body top is raised (and later cut away above the belt) so the shoulder stays wide under the glass
  const cab = z => clamp((z - S.zC) / 0.2) * clamp((S.zA - z) / 0.2);
  const ytRaw = z => top(z);
  const yt = z => { const t0 = top(z), k = cab(z); return k > 0 ? t0 + k * Math.max(0, belt(z) + 0.09 - t0) : t0; };
  // the section's widest line follows the sill only — the wheel arches are cut out of the surface afterwards (points
  // inside an arch are lifted onto it), so the flanks stay smooth over the wheels instead of rippling
  const yE = z => Math.min(yt(z) - 0.1, Math.max(S.yE, sill(z) + 0.05));
  const zMid = (S.zF + S.zR) / 2;
  const w = z => {
    const u = z > zMid ? (z - zMid) / (S.zF - zMid) : (zMid - z) / (zMid - S.zR), k = z > zMid ? S.kF : S.kR;
    return S.W / 2 * Math.pow(Math.max(0, 1 - Math.pow(clamp(u), k)), 1 / k) * (1 - 0.03 * Math.max(0, (z - zMid) / (S.zF - zMid)));
  };
  // haunches over the wheels (upper side), a faint shoulder crease
  const bump = (z, y, q) => {
    let b = 0;
    b += S.haunch[0] * Math.exp(-Math.pow((z - wheelsZ[0]) / 0.55, 2)) * clamp(1 - Math.abs(q - 0.25) * 1.6);
    b += S.haunch[1] * Math.exp(-Math.pow((z - wheelsZ[1]) / 0.6, 2)) * clamp(1 - Math.abs(q - 0.25) * 1.6);
    b += 0.011 * Math.exp(-Math.pow((q - 0.4) / 0.035, 2)) - 0.008 * Math.exp(-Math.pow((q + 0.25) / 0.12, 2));
    return 1 + b;
  };
  // section point: t in [0, 1) around (0 = right side at the equator, going up over the top), returns [x, y]
  const sec = (z, t) => {
    const th = t * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), W2 = w(z), e = yE(z);
    const A = arch(z);
    if (s >= 0) {
      const Y = Math.pow(s, 2 / S.nU), X = spow(c, 2 / S.nU);
      const y = e + (yt(z) - e) * Y;
      if (y < A) return [Math.sign(c || 1) * Math.max(0, bodyXr(z, A)), A, 1];   // lifted onto the arch, on the surface
      return [W2 * X * (1 - S.lean * Y) * bump(z, 0, Y), y, 0];
    }
    const Y = Math.pow(-s, 2 / S.nL), X = spow(c, 2 / S.nL), y = e - (e - sill(z)) * Y;
    if (y < A) return [Math.sign(c || 1) * Math.max(0, bodyXr(z, A)), A, 1];
    return [W2 * X * bump(z, 0, -Y * 0.3), y, 0];
  };
  // half width of the body at (z, y); -1 outside the section
  const bodyX = (z, y) => (y < arch(z) ? -1 : bodyXr(z, y));
  function bodyXr(z, y) {   // ignoring the wheel arches
    const t0 = yt(z), b0 = sill(z), e = yE(z), W2 = w(z);
    if (y > t0 || y < b0 || W2 <= 0) return -1;
    if (y >= e) { const q = (y - e) / (t0 - e); return W2 * Math.pow(Math.max(0, 1 - Math.pow(q, S.nU)), 1 / S.nU) * (1 - S.lean * q) * bump(z, y, q); }
    const q = (e - y) / (e - b0); return W2 * Math.pow(Math.max(0, 1 - Math.pow(q, S.nL)), 1 / S.nL) * bump(z, y, -q * 0.3);
  };
  const edgeZ = (x, y, front) => {   // outermost z of the body surface at (x, y) (bisection toward the nose/tail)
    // march in from the tip until inside (the wheel arches make the naive bisection from mid-car ambiguous)
    const end = front ? S.zF : S.zR, dir = front ? -1 : 1, ax = Math.abs(x);
    let b = end, a = null;
    for (let z = end; (z - zMid) * -dir > 0; z += dir * 0.01) { if (bodyX(z, y) >= ax) { a = z; break; } b = z; }
    if (a == null) return null;
    for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (bodyX(m, y) >= ax) a = m; else b = m; }
    return a;
  };
  // greenhouse
  const gTop = mono([[S.zC, S.bC], [S.zC + 0.35 * (S.zT2 - S.zC), S.bC + 0.64 * (S.roof - S.bC)], [S.zT2, S.roof - 0.012],
    [(S.zT1 + S.zT2) / 2, S.roof], [S.zT1, S.roof - 0.01], [S.zT1 + 0.5 * (S.zA - S.zT1), S.bA + 0.56 * (S.roof - S.bA)], [S.zA, S.bA]]);
  const gBase = z => belt(z) - 0.1;
  const gW = z => { const zz = clamp(z, S.zC + 0.2, S.zA - 0.2), b = bodyX(zz, belt(z)); return (b > 0 ? b : w(z) * 0.8) * (0.985 + 0.015 * cab(z)) - 0.012; };
  const gsec = (z, t) => {   // t in [0, 1]: 0 right base, 0.5 roof centre, 1 left base → [x, y, X]
    const th = t * Math.PI, c = Math.cos(th), s = Math.sin(th), Y = Math.pow(s, 2 / S.nG), X = spow(c, 2 / S.nG);
    return [gW(z) * X * (1 - S.gLean * Y), gBase(z) + (Math.max(gTop(z), belt(z)) - gBase(z)) * Y, X];
  };
  return { S, top, sill, belt, yb, yt, ytRaw, yE, w, sec, bodyX, edgeZ, gTop, gBase, gW, gsec, wheelsZ, zMid, cab };
}

// ------------------------------------------------------------------ geometry helpers
function attr(geo, name, n, v) {   // constant-valued attribute
  const cnt = geo.attributes.position.count, a = new Float32Array(cnt * n);
  for (let i = 0; i < cnt; i++) for (let k = 0; k < n; k++) a[i * n + k] = v[k];
  geo.setAttribute(name, new THREE.BufferAttribute(a, n)); return geo;
}
const COL = new THREE.Color();
function tint(geo, hex, metal, rough) {   // colour (linear) + metal/rough attributes for the per-vertex PBR materials
  COL.set(hex); const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  attr(g, 'color', 3, [COL.r, COL.g, COL.b]); attr(g, 'mr', 2, [metal, rough]); return g;
}
function glow(geo, rgb, lk) {   // light geometry: colour + light group (0 head, 1 tail, 2 always-on accents)
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  attr(g, 'color', 3, rgb); attr(g, 'lk', 1, [lk]); return g;
}
// metallic-flake UVs projected along each vertex's dominant normal axis (a lofted (z, y) mapping streaks on the nose/tail)
function boxUV(g, k) {
  if (!g) return g;
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv || new THREE.BufferAttribute(new Float32Array(p.count * 2), 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i) * k, p.getY(i) * k);
    else if (ay >= az) uv.setXY(i, p.getX(i) * k + 0.37, p.getZ(i) * k);
    else uv.setXY(i, p.getX(i) * k + 0.71, p.getY(i) * k);
  }
  g.setAttribute('uv', uv); return g;
}
function strip(g, keep) { for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k); return g; }
function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; return g; }
  for (const key of Object.keys(g.attributes)) {
    const at = g.attributes[key], n = at.itemSize, arr = at.array;
    for (let i = 0; i < at.count; i += 3) for (let k = 0; k < n; k++) { const t = arr[(i + 1) * n + k]; arr[(i + 1) * n + k] = arr[(i + 2) * n + k]; arr[(i + 2) * n + k] = t; }
    at.needsUpdate = true;
  }
  return g;
}
// grid surface from a point function P(i, j) → [x, y, z]; faces kept where keep(i, j) → key; returns {key: geometry}
function gridSurface(ni, nj, P, classify, { wrapJ = false, uv = null } = {}) {
  const nv = ni * nj, pos = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
    const p = P(i, j), k = i * nj + j; pos.set(p, k * 3);
    if (uv) uvs.set(uv(i, j, p), k * 2);
  }
  const jmax = wrapJ ? nj : nj - 1, all = [];
  for (let i = 0; i < ni - 1; i++) for (let j = 0; j < jmax; j++) {
    const j2 = (j + 1) % nj, a = i * nj + j, b = (i + 1) * nj + j, c = (i + 1) * nj + j2, d = i * nj + j2;
    all.push(a, d, b, b, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(all); g.computeVertexNormals();
  const out = {}, idx = {};
  for (let i = 0; i < ni - 1; i++) for (let j = 0; j < jmax; j++) {
    const key = classify(i, j); if (!key) continue;
    const q = (i * jmax + j) * 6; (idx[key] ||= []).push(...all.slice(q, q + 6));
  }
  for (const [key, list] of Object.entries(idx)) out[key] = subset(g, list);
  g.dispose(); return out;
}
function subset(g, list) {   // compact sub-mesh of an indexed geometry
  const map = new Map(), keys = Object.keys(g.attributes), outs = {};
  const order = [];
  const ind = list.map(v => { if (!map.has(v)) { map.set(v, order.length); order.push(v); } return map.get(v); });
  const r = new THREE.BufferGeometry();
  for (const k of keys) {
    const a = g.attributes[k], n = a.itemSize, arr = new Float32Array(order.length * n);
    order.forEach((v, i) => { for (let c = 0; c < n; c++) arr[i * n + c] = a.array[v * n + c]; });
    r.setAttribute(k, new THREE.BufferAttribute(arr, n)); outs[k] = arr;
  }
  r.setIndex(ind); return r;
}

// n curve parameters in [0, 1] spaced evenly along the arc of fn(t) → [x, y] (blended with uniform spacing)
function arcParams(fn, n, closed) {
  const K = 1200, cum = [0]; let prev = fn(0);
  for (let k = 1; k <= K; k++) { const p = fn(k / K); cum.push(cum[k - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p; }
  const L = cum[K], out = []; let k = 0;
  for (let j = 0; j < (closed ? n : n + 1); j++) {
    const target = L * j / n; while (k < K - 1 && cum[k + 1] < target) k++;
    const f = (target - cum[k]) / ((cum[k + 1] - cum[k]) || 1), t = (k + f) / K;
    out.push(lerp(t, j / n, 0.25));
  }
  return out;
}
// 2D decal builders in a view plane (a, b); projected onto the body afterwards
let LODK = 1;   // decal tessellation multiplier (coarser for the far model)
function densify(pts, step, closed = false) {
  step *= LODK;
  const out = [], n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < k; s++) out.push([lerp(a[0], b[0], s / k), lerp(a[1], b[1], s / k)]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function ribbon2(pts, width, { closed = false, step = 0.02 } = {}) {
  const p = densify(pts, step, closed), n = p.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = p[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    pos.push(p[i][0] - dy * width / 2, p[i][1] + dx * width / 2, 0, p[i][0] + dy * width / 2, p[i][1] - dx * width / 2, 0);
  }
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
// Region fill by marching squares: interior grid cells plus the boundary cells clipped at the exact edge (found by
// bisection along each cell edge), so decals have smooth outlines instead of a staircase. Shared vertices → no cracks.
function fill2(inside, a0, a1, b0, b1, step = 0.02) {
  step *= LODK;
  const na = Math.max(1, Math.ceil((a1 - a0) / step)), nb = Math.max(1, Math.ceil((b1 - b0) / step)), pos = [], idx = [];
  const A = i => lerp(a0, a1, i / na), B = j => lerp(b0, b1, j / nb), N = nb + 1;
  const ins = new Uint8Array((na + 1) * N);
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) ins[i * N + j] = inside(A(i), B(j)) ? 1 : 0;
  const vid = new Map();
  const corner = k => { if (!vid.has(k)) { vid.set(k, pos.length / 3); pos.push(A((k / N) | 0), B(k % N), 0); } return vid.get(k); };
  const edge = (k0, k1) => {   // k0 inside, k1 outside
    const key = k0 < k1 ? k0 + ':' + k1 : k1 + ':' + k0;
    if (vid.has(key)) return vid.get(key);
    let pa = [A((k0 / N) | 0), B(k0 % N)], pb = [A((k1 / N) | 0), B(k1 % N)];
    for (let it = 0; it < 12; it++) { const m = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]; if (inside(m[0], m[1])) pa = m; else pb = m; }
    vid.set(key, pos.length / 3); pos.push((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, 0); return vid.get(key);
  };
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    const c = [i * N + j, (i + 1) * N + j, (i + 1) * N + j + 1, i * N + j + 1];
    const s = ins[c[0]] + ins[c[1]] + ins[c[2]] + ins[c[3]];
    if (!s) continue;
    if (s === 4) { const p = corner(c[0]), q = corner(c[1]), r = corner(c[2]), t = corner(c[3]); idx.push(p, q, r, p, r, t); continue; }
    const poly = [];
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      if (ins[a]) poly.push(corner(a));
      if (ins[a] !== ins[b]) poly.push(ins[a] ? edge(a, b) : edge(b, a));
    }
    for (let k = 1; k < poly.length - 1; k++) idx.push(poly[0], poly[k], poly[k + 1]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
function rrPts(a0, a1, b0, b1, r, seg = 6) {   // rounded rectangle outline
  r = Math.min(r, (a1 - a0) / 2, (b1 - b0) / 2); const out = [];
  const corner = (ca, cb, from) => { for (let i = 0; i <= seg; i++) { const t = from + i / seg * Math.PI / 2; out.push([ca + Math.cos(t) * r, cb + Math.sin(t) * r]); } };
  corner(a1 - r, b0 + r, -Math.PI / 2); corner(a1 - r, b1 - r, 0); corner(a0 + r, b1 - r, Math.PI / 2); corner(a0 + r, b0 + r, Math.PI);
  return out;
}
const inRR = (a0, a1, b0, b1, r) => (a, b) => {
  if (a < a0 || a > a1 || b < b0 || b > b1) return false;
  const ca = clamp(a, a0 + r, a1 - r), cb = clamp(b, b0 + r, b1 - r); return (a - ca) ** 2 + (b - cb) ** 2 <= r * r + 1e-9;
};
function ellPts(ca, cb, ra, rb, n = 28) { const o = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; o.push([ca + Math.cos(t) * ra, cb + Math.sin(t) * rb]); } return o; }
const inEll = (ca, cb, ra, rb) => (a, b) => ((a - ca) / ra) ** 2 + ((b - cb) / rb) ** 2 <= 1;
const mirrorA = g => { const c = g.clone(); c.scale(-1, 1, 1); flipWinding(c); return c; };
const both = g => [g, mirrorA(g)];

// project a view-plane geometry onto the body: view 'front' | 'rear' (a = x, b = y) or 'side' (a = z, b = y, sign ±1)
function project(M, geo, view, off, sign = 1) {
  const p = geo.attributes.position, bad = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i), b = p.getY(i), d = p.getZ(i);
    if (view === 'side') { const x = M.bodyX(a, b); if (x < 0) { bad[i] = 1; continue; } p.setXYZ(i, sign * (x + off + d), b, a); }
    else { const z = M.edgeZ(a, b, view === 'front'); if (z == null) { bad[i] = 1; continue; } p.setXYZ(i, a, b, z + (view === 'front' ? 1 : -1) * (off + d)); }
  }
  if (geo.index && bad.some(v => v)) {
    const a = geo.index.array, keep = [];
    for (let i = 0; i < a.length; i += 3) if (!bad[a[i]] && !bad[a[i + 1]] && !bad[a[i + 2]]) keep.push(a[i], a[i + 1], a[i + 2]);
    geo.setIndex(keep);
  }
  geo.computeVertexNormals();
  // outward winding: compare the mean normal with the view direction
  const n = geo.attributes.normal, want = view === 'front' ? [0, 0, 1] : view === 'rear' ? [0, 0, -1] : [sign, 0, 0];
  let dot = 0; const idx = geo.index ? geo.index.array : null;
  for (let i = 0; i < n.count; i++) dot += n.getX(i) * want[0] + n.getY(i) * want[1] + n.getZ(i) * want[2];
  if (dot < 0 && idx) { flipWinding(geo); geo.computeVertexNormals(); }
  return geo;
}

// ------------------------------------------------------------------ textures & materials
let FLAKE = null;
function flakeTex() {
  if (FLAKE) return FLAKE;
  // custom mip chain fading to a flat normal: mip-averaged random normals would otherwise read as big dents at a distance
  const N = 128, r = rng(77), mips = [];
  const base = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) { base[i * 2] = (r() - 0.5) * 0.9; base[i * 2 + 1] = (r() - 0.5) * 0.9; }
  for (let n = N, lvl = 0; n >= 1; n >>= 1, lvl++) {
    const d = new Uint8Array(n * n * 4), k = Math.pow(0.3, lvl), step = N / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const s = ((j * step) * N + i * step) * 2, ax = base[s] * k, ay = base[s + 1] * k, az = Math.sqrt(Math.max(0, 1 - ax * ax - ay * ay)), o = (j * n + i) * 4;
      d[o] = (ax * 0.5 + 0.5) * 255; d[o + 1] = (ay * 0.5 + 0.5) * 255; d[o + 2] = az * 255; d[o + 3] = 255;
    }
    mips.push({ data: d, width: n, height: n });
  }
  FLAKE = new THREE.DataTexture(mips[0].data, N, N); FLAKE.mipmaps = mips;
  FLAKE.wrapS = FLAKE.wrapT = THREE.RepeatWrapping; FLAKE.magFilter = THREE.LinearFilter;
  FLAKE.minFilter = THREE.LinearMipmapLinearFilter; FLAKE.generateMipmaps = false; FLAKE.needsUpdate = true;
  return FLAKE;
}
// Standard material with per-vertex metalness/roughness (attribute `mr`) — chrome, gloss black, rubber in one draw call.
function mrMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 mr;\nvarying vec2 vMR;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMR = mr;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMR;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMR.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMR.x;');
  };
  m.customProgramCacheKey = () => 'vrc-car-mr';
  return m;
}
// Unlit lights: vertex colour × uK[group] (head / tail / accents).
function lightMaterial() {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  m.userData.uK = { value: new THREE.Vector3(0.12, 0.35, 0.1) };
  m.onBeforeCompile = sh => {
    sh.uniforms.uK = m.userData.uK;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float lk;\nvarying float vLk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLk = lk;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uK;\nvarying float vLk;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vLk < 0.5 ? uK.x : (vLk < 1.5 ? uK.y : uK.z);');
  };
  m.customProgramCacheKey = () => 'vrc-car-lights';
  return m;
}
const MATS = {};
function paintMaterial(colour) {
  const key = 'paint:' + colour;
  if (MATS[key]) return MATS[key];
  const hex = CAR_COLOURS[colour] || colour || '#222';
  const pearl = colour === 'pearl', black = colour === 'black';
  const m = new THREE.MeshPhysicalMaterial({
    color: hex, metalness: pearl ? 0.08 : black ? 0.35 : 0.62, roughness: pearl ? 0.3 : black ? 0.24 : 0.36,
    clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.25,
    normalMap: pearl ? null : flakeTex(), normalScale: new THREE.Vector2(0.11, 0.11),
  });
  if (pearl) { m.iridescence = 0.28; m.iridescenceIOR = 1.45; m.iridescenceThicknessRange = [260, 480]; m.sheen = 0; }
  return (MATS[key] = m);
}
function shared() {
  if (MATS.glass) return MATS;
  // tinted privacy glass: dark and mirror-like from outside (the cabin reads only as a silhouette), clear from inside
  MATS.glass = new THREE.MeshStandardMaterial({ color: '#030507', metalness: 0.25, roughness: 0.02, transparent: true, opacity: 0.9, envMapIntensity: 2.4, side: THREE.DoubleSide, depthWrite: false });
  MATS.glassIn = new THREE.MeshStandardMaterial({ color: '#10161b', metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.08, envMapIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false });
  MATS.trim = mrMaterial({ envMapIntensity: 1.35 });
  MATS.interior = mrMaterial({ envMapIntensity: 0.8, side: THREE.DoubleSide });
  MATS.wheel = mrMaterial({ envMapIntensity: 1.3 });
  MATS.lodPaint = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 });
  MATS.lodRest = mrMaterial({ envMapIntensity: 1.3 });
  MATS.farPaint = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.28, envMapIntensity: 1.3 });
  return MATS;
}

// ------------------------------------------------------------------ wheel
const WHEEL_GEO = {};
function wheelGeometry(kind, lod) {
  const key = kind + (lod ? ':lod' : '');
  if (WHEEL_GEO[key]) return WHEEL_GEO[key];
  const S = carSpec(kind), R = S.R, tw = S.tw, Rr = R - (S.R > 0.38 ? 0.115 : 0.1), seg = lod ? 10 : 44, parts = [];
  // tyre: rounded profile revolved around the axle (lathe around y, then y → x)
  const prof = [];
  const hw = tw / 2;
  const tp = [[Rr - 0.005, -hw * 0.82], [Rr + 0.02, -hw * 0.98], [Rr + 0.06, -hw * 1.02], [R - 0.035, -hw * 0.98], [R - 0.008, -hw * 0.86], [R, -hw * 0.6],
    [R, hw * 0.6], [R - 0.008, hw * 0.86], [R - 0.035, hw * 0.98], [Rr + 0.06, hw * 1.02], [Rr + 0.02, hw * 0.98], [Rr - 0.005, hw * 0.82]];
  for (const [r, y] of (lod ? tp.filter((_, i) => i % 2 === 0 || i === tp.length - 1) : tp)) prof.push(new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(prof, seg); tyre.rotateZ(-Math.PI / 2);
  parts.push(tint(tyre, '#101012', 0, 0.86));
  // barrel + lip
  const bar = new THREE.LatheGeometry([new THREE.Vector2(Rr - 0.004, hw * 0.78), new THREE.Vector2(Rr - 0.014, hw * 0.55), new THREE.Vector2(Rr - 0.014, -hw * 0.8), new THREE.Vector2(Rr - 0.004, -hw * 0.84)], seg);
  bar.rotateZ(-Math.PI / 2); parts.push(tint(bar, '#2a2b2e', 1, 0.45));
  const lip = new THREE.LatheGeometry([new THREE.Vector2(Rr + 0.004, hw * 0.8), new THREE.Vector2(Rr + 0.012, hw * 0.86), new THREE.Vector2(Rr - 0.002, hw * 0.9), new THREE.Vector2(Rr - 0.018, hw * 0.84)], seg);
  lip.rotateZ(-Math.PI / 2); parts.push(tint(lip, '#d9dadc', 1, 0.16));
  // spokes: bevelled extrusions, dished (hub recessed), diamond-cut faces + graphite flanks
  const style = { sedan: [10, 1], coupe: [5, 2], suv: [6, 2], gt: [7, 2], ev: [5, 3], super: [7, 1] }[kind] || [10, 1];
  const [N, twin] = style, sp = [];
  const r0 = 0.07, r1 = Rr - 0.012;
  const spokeShape = (wa, wb2) => { const s = new THREE.Shape(); s.moveTo(r0, -wa / 2); s.lineTo(r1, -wb2 / 2); s.lineTo(r1, wb2 / 2); s.lineTo(r0, wa / 2); s.closePath(); return s; };
  const shapes = twin === 1 ? [[spokeShape(0.034, 0.046), 0]] : twin === 2 ? [[spokeShape(0.026, 0.036), -0.075], [spokeShape(0.026, 0.036), 0.075]] : [[spokeShape(0.07, 0.085), 0]];
  for (let k = 0; k < N; k++) for (const [shp, da] of shapes) {
    const g = new THREE.ExtrudeGeometry(shp, { depth: 0.022, bevelEnabled: !lod, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 2, steps: 1 });
    // colour: caps (group 0) bright, sides (group 1) graphite
    const ng = g.index ? g.toNonIndexed() : g; if (ng !== g) g.dispose();
    const cnt = ng.attributes.position.count, col = new Float32Array(cnt * 3), mr = new Float32Array(cnt * 2), nrm = ng.attributes.normal;
    for (let i = 0; i < cnt; i++) {
      const face = Math.abs(nrm.getZ(i)) > 0.7;
      const c = face ? [0.72, 0.73, 0.75] : [0.07, 0.075, 0.08];
      col.set(c, i * 3); mr.set(face ? [1, 0.14] : [1, 0.38], i * 2);
    }
    for (const k2 of Object.keys(ng.attributes)) if (k2 !== 'position' && k2 !== 'normal') ng.deleteAttribute(k2);
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3)); ng.setAttribute('mr', new THREE.BufferAttribute(mr, 2));
    // extrusion axis z → x (outward), radial x → y; rotate about the axle; dish: hub sits 3.5 cm inboard
    const p = ng.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const rr = p.getX(i), tt = p.getY(i), dd = p.getZ(i);
      const a = (k + 0.5) / N * Math.PI * 2 + da + (twin === 3 ? 0 : 0);
      const dish = -0.038 * Math.pow(1 - clamp((rr - r0) / (r1 - r0)), 1.6);
      const x = hw * 0.62 + dd + dish, ca = Math.cos(a), sa = Math.sin(a);
      p.setXYZ(i, x, rr * ca - tt * sa, rr * sa + tt * ca);
      const nx = nrm.getZ(i), ny = nrm.getX(i), nz = nrm.getY(i);
      nrm.setXYZ(i, nx, ny * ca - nz * sa, ny * sa + nz * ca);
    }
    sp.push(ng);
  }
  parts.push(...sp);
  // hub + centre cap (plain, no logo) + lug nuts
  const hub = new THREE.CylinderGeometry(0.075, 0.08, 0.04, lod ? 10 : 28); hub.rotateZ(Math.PI / 2); hub.translate(hw * 0.62 - 0.03, 0, 0); parts.push(tint(hub, '#b9bbbe', 1, 0.2));
  const cap = new THREE.CylinderGeometry(0.036, 0.036, 0.012, lod ? 8 : 24); cap.rotateZ(Math.PI / 2); cap.translate(hw * 0.62 - 0.006, 0, 0); parts.push(tint(cap, '#15161a', 0.6, 0.25));
  if (!lod) for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, n = new THREE.CylinderGeometry(0.009, 0.009, 0.02, 8); n.rotateZ(Math.PI / 2);
    n.translate(hw * 0.62 - 0.012, Math.cos(a) * 0.055, Math.sin(a) * 0.055); parts.push(tint(n, '#dedfe1', 1, 0.2));
  }
  const g = mergeGeometries(parts.map(q => strip(q, ['position', 'normal', 'color', 'mr'])), false);
  parts.forEach(q => q.dispose());
  g.computeBoundingSphere();
  return (WHEEL_GEO[key] = g);
}

// greenhouse panel limits, degrees of section slope (see kindGeometry)
const GA = { ws: 0.5, a: 0.76, roof: 0.62, rail: 0.8, back: 0.48 };
// ------------------------------------------------------------------ car geometry per model
const KIND_GEO = {};
function kindGeometry(kind, lod = false) {
  const key = kind + (lod ? ':lod' : '');
  if (KIND_GEO[key]) return KIND_GEO[key];
  const M = bodyModel(kind), S = M.S;
  LODK = lod ? 2.5 : 1;
  const out = { paint: [], glass: [], trim: [], lights: [], interior: [] };
  const TR = (g, hex, m, r) => out.trim.push(tint(g, hex, m, r));
  const CHROME = '#e4e5e7', BLACK = '#060607', DARKCH = '#2c2e31';

  // ---- lower body: stations (uniform + wheel-arch edges) × superellipse ring
  // stations: smoothly graded (denser towards the nose and tail), with the nearest ones snapped onto the arch edges and
  // the cabin opening — inserting extra stations instead would leave slivers that shade as streaks
  const NI = lod ? 30 : 128, NJ = lod ? 18 : 60, grade = 0.8;
  const zs = [];
  for (let i = 0; i <= NI; i++) { const u = i / NI; zs.push(lerp(S.zR, S.zF, u - grade * Math.sin(2 * Math.PI * u) / (2 * Math.PI))); }
  for (const zk of [...M.wheelsZ.flatMap(zw => [zw - S.Ra, zw + S.Ra]), S.zA, S.zC]) {
    let bi = 1; for (let i = 1; i < NI; i++) if (Math.abs(zs[i] - zk) < Math.abs(zs[bi] - zk)) bi = i;
    zs[bi] = zk;
  }
  zs.sort((a, b) => a - b);
  const zsU = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 1e-4);
  const zRef = (S.zA + S.zC) / 2, ringT = arcParams(t => M.sec(zRef, t), NJ, true);
  const lifted = new Uint8Array(zsU.length * NJ);
  const body = gridSurface(zsU.length, NJ, (i, j) => { const z = zsU[i], [x, y, l] = M.sec(z, ringT[j]); lifted[i * NJ + j] = l; return [x, y, z]; },
    (i, j) => {
      const z = (zsU[i] + zsU[i + 1]) / 2, t = (ringT[j] + (ringT[(j + 1) % NJ] || 1)) / 2, [, y] = M.sec(z, t), j2 = (j + 1) % NJ;
      if (t > 0.655 && t < 0.845) return 'under';   // flat underside
      if (lifted[i * NJ + j] && lifted[(i + 1) * NJ + j] && lifted[i * NJ + j2] && lifted[(i + 1) * NJ + j2]) return 'under';   // arch roofs over the wheels
      if (z > S.zC && z < S.zA && y > M.belt(z) + 0.004) return null;   // cabin opening (glass sits here)
      return 'paint';
    }, { wrapJ: true, uv: (i, j, p) => [p[2] * 3.1, (p[1] + Math.abs(p[0])) * 3.1] });
  if (body.paint) { body.paint.computeVertexNormals(); out.paint.push(body.paint); }   // own normals: no bleed from the arch roofs
  if (body.under) TR(body.under, '#0c0c0d', 0, 0.7);
  // ---- greenhouse: glass / roof & pillars (paint) / B-pillar (piano black)
  const GI = lod ? 16 : 56, GJ = lod ? 12 : 40, gz0 = S.zC - 0.02, gz1 = S.zA + 0.02;
  const gzs = []; for (let i = 0; i <= GI; i++) gzs.push(lerp(gz0, gz1, i / GI));
  for (const z of [S.zT1, S.zT2, S.zB - 0.045, S.zB + 0.045]) gzs.push(z);
  gzs.sort((a, b) => a - b);
  const gt = arcParams(t => M.gsec(zRef, t), GJ, false);
  // panels by the slope of the section (0° roof … 90° side): windscreen / A-pillar / side glass, roof / rail / side glass,
  // backlight / C-pillar (or quarter glass); so pillars keep a real width whatever the greenhouse shape
  const gAng = (z, t) => { const a = M.gsec(z, Math.max(0, t - 0.004)), b = M.gsec(z, Math.min(1, t + 0.004)); return Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 57.2958; };
  const gh = gridSurface(gzs.length, gt.length, (i, j) => { const z = gzs[i], [x, y] = M.gsec(z, gt[j]); return [x, y, z]; },
    (i, j) => {
      // slope sampled at one station per zone, so the panel edges run along whole grid columns (no ragged steps)
      const z = (gzs[i] + gzs[i + 1]) / 2, tm = (gt[j] + gt[j + 1]) / 2;
      const zr = z > S.zT1 ? lerp(S.zT1, S.zA, 0.35) : z < S.zT2 ? lerp(S.zT2, S.zC, 0.35) : (S.zT1 + S.zT2) / 2;
      const th = gAng(zr, tm) / gAng(zr, 0.02);   // 0 on the roof line, 1 on the side glass
      if (z > S.zT1) return th < GA.ws ? 'glass' : th < GA.a ? 'paint' : 'glass';
      if (z < S.zT2) return th < GA.back ? 'glass' : (S.cp < 0.9 ? 'black' : 'paint');
      if (th < GA.roof) return 'roof';
      if (th < GA.rail) return 'paint';
      if (Math.abs(z - S.zB) < 0.045) return 'black';
      return 'glass';
    }, { uv: (i, j, p) => [p[2] * 3.1, (p[1] + Math.abs(p[0])) * 3.1] });
  if (gh.glass) out.glass.push(strip(gh.glass, ['position', 'normal']));
  for (const k of ['paint', 'roof']) if (gh[k]) out.paint.push(gh[k].clone());
  if (gh.black) TR(gh.black, BLACK, 0, 0.12);
  // headliner: roof + pillars again, 2 cm inside, facing in
  if (!lod) for (const k of ['paint', 'roof']) if (gh[k]) {
    const h = gh[k].clone(), p = h.attributes.position, n = h.attributes.normal;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) - n.getX(i) * 0.022, p.getY(i) - n.getY(i) * 0.022, p.getZ(i) - n.getZ(i) * 0.022);
    flipWinding(h); h.computeVertexNormals();
    out.interior.push(tint(h, '#d8d0c2', 0, 0.9));
  }
  for (const k of ['paint', 'roof']) if (gh[k]) gh[k].dispose();
  // ---- wheel-arch liners (open half-cylinders facing the axle)
  for (const zw of M.wheelsZ) {
    const n = lod ? 8 : 24, pos = [], idx = [], x0 = -S.W / 2 * 0.985, x1 = S.W / 2 * 0.985;
    for (let i = 0; i <= n; i++) {
      const a = -0.25 + (Math.PI + 0.5) * i / n, y = S.R + Math.sin(a) * (S.Ra - 0.004), z = zw + Math.cos(a) * (S.Ra - 0.004);
      pos.push(x0, y, z, x1, y, z);
    }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.computeVertexNormals();
    // normals must point toward the axle
    if (g.attributes.normal.getY(n) > 0) flipWinding(g);
    g.computeVertexNormals(); TR(g, '#050505', 0, 0.95);
  }
  // ---- decals (projected details)
  const fz = y => M.edgeZ(0, y, true), rz = y => M.edgeZ(0, y, false);
  const yNose = M.top(S.zF - 0.35), yTail = M.top(S.zR + 0.25);
  const L = (g, rgb, lk) => out.lights.push(glow(g, rgb, lk));
  const HEAD = [1.6, 1.62, 1.66], DRL = [1.5, 1.58, 1.7], TAIL = [1.0, 0.04, 0.02], LENS = [0.32, 0.02, 0.02], AMBER = [1.0, 0.45, 0.05];
  const W2 = S.W / 2;
  // front: grille per model
  const gy = S.grille === 'suv' ? yNose - 0.34 : S.grille === 'tall' ? yNose - 0.33 : S.grille === 'matrix' ? yNose - 0.3 : yNose - 0.36;
  if (S.grille === 'tall' || S.grille === 'suv' || S.grille === 'matrix') {
    const gw = S.grille === 'suv' ? 0.46 : S.grille === 'matrix' ? 0.37 : 0.3, gh2 = S.grille === 'suv' ? 0.26 : S.grille === 'matrix' ? 0.29 : 0.3;
    const b0 = gy - gh2 / 2, b1 = gy + gh2 / 2, r = S.grille === 'matrix' ? 0.08 : 0.035;
    TR(project(M, fill2(inRR(-gw, gw, b0, b1, r), -gw, gw, b0, b1, 0.02), 'front', 0.002), '#0a0a0b', 0.6, 0.35);
    TR(project(M, ribbon2(rrPts(-gw, gw, b0, b1, r, 8), 0.022, { closed: true }), 'front', 0.009), CHROME, 1, 0.1);
    if (!lod) {
      if (S.grille === 'tall') for (let x = -gw + 0.04; x < gw - 0.02; x += 0.037) TR(project(M, ribbon2([[x, b0 + 0.01], [x, b1 - 0.01]], 0.009), 'front', 0.006), CHROME, 1, 0.12);
      else if (S.grille === 'suv') for (let y = b0 + 0.045; y < b1 - 0.02; y += 0.05) TR(project(M, ribbon2([[-gw + 0.02, y], [gw - 0.02, y]], 0.012), 'front', 0.006), '#c9cacc', 1, 0.14);
      else for (let y = b0 + 0.03; y < b1 - 0.02; y += 0.032) for (let x = -gw + 0.04 + ((Math.round(y * 100) % 2) ? 0.018 : 0); x < gw - 0.03; x += 0.036)
        if (inRR(-gw, gw, b0, b1, r)(x, y)) TR(project(M, fill2(() => true, x - 0.009, x + 0.009, y - 0.009, y + 0.009, 0.018), 'front', 0.006), '#b9babc', 1, 0.15);
    }
  }
  if (S.grille === 'intake' || S.grille === 'closed' || S.grille === 'matrix') {   // lower intakes / closed panel
    const b0 = S.sill[S.sill.length - 1][1] + 0.05, b1 = b0 + (S.grille === 'intake' ? 0.17 : 0.1), aw = S.grille === 'closed' ? 0.55 : 0.62;
    if (S.grille !== 'matrix') TR(project(M, fill2(inRR(-aw, aw, b0, b1, 0.05), -aw, aw, b0, b1, 0.02), 'front', 0.002), '#08080a', 0.5, 0.4);
    else for (const sx of [-1, 1]) { const g = project(M, fill2(inRR(0.44, 0.6, b0, b1 + 0.02, 0.04), 0.44, 0.6, b0, b1 + 0.02, 0.02), 'front', 0.002); TR(sx < 0 ? mirrorA(g) : g, '#08080a', 0.5, 0.4); }   // twin lower intakes either side of the grille
    if (S.grille !== 'closed') { const g = project(M, fill2(inRR(0.62, 0.8, b0 + 0.02, b1 + 0.08, 0.04), 0.62, 0.8, b0 + 0.02, b1 + 0.08, 0.02), 'front', 0.002); TR(mirrorA(g), '#08080a', 0.5, 0.4); TR(g, '#08080a', 0.5, 0.4); }
  }
  if (S.grille === 'closed') {   // gloss-black panel bridging the headlights, thin chrome surround
    const yh = yNose - 0.1, xa = W2 - 0.47, b0 = yh - 0.075, b1 = yh + 0.035;
    TR(project(M, fill2(inRR(-xa, xa, b0, b1, 0.035), -xa, xa, b0, b1, 0.02), 'front', 0.002), '#050506', 0, 0.06);
    TR(project(M, ribbon2(rrPts(-xa, xa, b0, b1, 0.035, 6), 0.008, { closed: true }), 'front', 0.006), CHROME, 1, 0.1);
  }
  // headlights per model: dark chrome housing + LED graphics
  const hx0 = W2 - (S.head === 'suv' ? 0.42 : 0.45), hx1 = W2 - 0.1, hy = yNose - (S.head === 'gt' ? 0.14 : 0.1);
  for (const s of [-1, 1]) {
    const F = (g, off) => project(M, s < 0 ? mirrorA(g) : g, 'front', off);
    if (S.head === 'coupe') {   // upright oval lamp on the wing: dark housing, four LED dots and a light ring
      const cx = W2 - 0.3, cy = hy + 0.035, ra = 0.125, rb = 0.082;
      TR(F(fill2(inEll(cx, cy, ra, rb), cx - ra, cx + ra, cy - rb, cy + rb, 0.012), 0.003), DARKCH, 1, 0.1);
      L(F(ribbon2(ellPts(cx, cy, ra - 0.014, rb - 0.014, 36), 0.008, { closed: true }), 0.007), DRL, 2);
      for (const [dx, dy2] of [[-0.045, 0.022], [0.045, 0.022], [-0.045, -0.022], [0.045, -0.022]]) L(F(fill2(inEll(cx + dx, cy + dy2, 0.014, 0.014), cx + dx - 0.014, cx + dx + 0.014, cy + dy2 - 0.014, cy + dy2 + 0.014, 0.007), 0.006), HEAD, 0);
    } else if (S.head === 'gt') {
      for (const [cx, rr] of [[hx0 + 0.09, 0.075], [hx1 - 0.1, 0.06]]) {
        TR(F(fill2(inEll(cx, hy, rr, rr), cx - rr, cx + rr, hy - rr, hy + rr, 0.012), 0.003), DARKCH, 1, 0.12);
        L(F(ribbon2(ellPts(cx, hy, rr - 0.012, rr - 0.012, 32), 0.01, { closed: true }), 0.007), DRL, 2);
        L(F(fill2(inEll(cx, hy, rr * 0.45, rr * 0.45), cx - rr * 0.45, cx + rr * 0.45, hy - rr * 0.45, hy + rr * 0.45, 0.01), 0.006), HEAD, 0);
      }
    } else {
      const th = S.head === 'suv' ? 0.075 : S.head === 'ev' ? 0.055 : S.head === 'coupe' ? 0.07 : S.head === 'super' ? 0.05 : 0.09;
      const rise = S.head === 'coupe' ? 0.04 : S.head === 'super' ? 0.075 : 0.015;
      const inside = (a, b) => { const t = (a - hx0) / (hx1 - hx0); const b0 = hy - th / 2 + rise * t, b1 = hy + th / 2 + (S.head === 'sedan' ? 0.03 * t : S.head === 'super' ? 0.06 * t : 0.012 * t); return t >= 0 && t <= 1 && b >= b0 && b <= b1; };
      TR(F(fill2(inside, hx0, hx1, hy - th, hy + th, 0.012), 0.003), DARKCH, 1, 0.12);
      L(F(ribbon2([[hx0 + 0.02, hy + th / 2 - 0.012], [hx1 - 0.015, hy + th / 2 + 0.006]], 0.009), 0.007), DRL, 2);
      if (S.head === 'sedan') L(F(ribbon2([[hx0 + 0.03, hy - th / 2 + 0.012], [hx0 + 0.03, hy + th / 2 - 0.012]], 0.009), 0.007), DRL, 2);
      for (let k = 0; k < (S.head === 'ev' ? 5 : 3); k++) {
        const cx = lerp(hx0 + 0.07, hx1 - 0.06, k / Math.max(1, (S.head === 'ev' ? 4 : 2))), cy = hy - 0.004 + 0.012 * (cx - hx0) / (hx1 - hx0), rr = S.head === 'ev' ? 0.012 : 0.018;
        L(F(fill2(inEll(cx, cy, rr, rr), cx - rr, cx + rr, cy - rr, cy + rr, 0.006), 0.006), HEAD, 0);
      }
    }
  }
  if (S.head === 'ev') L(project(M, ribbon2([[-hx0 + 0.02, hy + 0.035], [hx0 - 0.02, hy + 0.035]], 0.007), 'front', 0.006), DRL, 2);
  // rear: tail lights
  const ty = yTail - (S.tail === 'suv' ? 0.1 : 0.085);
  const R_ = (g, off) => project(M, g, 'rear', off);
  if (S.tail === 'bar' || S.tail === 'suv') {
    const bx = W2 - 0.08, th = S.tail === 'suv' ? 0.05 : 0.035;
    L(R_(fill2(inRR(-bx, bx, ty - th / 2, ty + th / 2, th / 2), -bx, bx, ty - th / 2, ty + th / 2, 0.01), 0.004), LENS, 1);
    L(R_(ribbon2([[-bx + 0.02, ty], [bx - 0.02, ty]], 0.008), 0.007), TAIL, 1);
    for (const s of [-1, 1]) L(R_(ribbon2([[s * (bx - 0.03), ty + 0.012], [s * (bx - 0.03), ty - 0.012]], 0.012), 0.008), TAIL, 1);   // corner blocks
  } else if (S.tail === 'quad') {
    for (const s of [-1, 1]) for (const cx of [W2 - 0.2, W2 - 0.42]) {
      const x = s * cx;
      L(R_(fill2(inEll(x, ty, 0.07, 0.05), x - 0.07, x + 0.07, ty - 0.05, ty + 0.05, 0.01), 0.004), LENS, 1);
      L(R_(ribbon2(ellPts(x, ty, 0.058, 0.04, 28), 0.009, { closed: true }), 0.007), TAIL, 1);
    }
  } else {   // sedan: slim wrap-around L units
    for (const s of [-1, 1]) {
      const a0 = W2 - 0.5, a1 = W2 - 0.07, inside = (a, b) => { const t = (a - a0) / (a1 - a0); return t >= 0 && t <= 1 && b >= ty - 0.035 - 0.03 * t && b <= ty + 0.04; };
      let g = fill2(inside, a0, a1, ty - 0.07, ty + 0.04, 0.012); if (s < 0) g = mirrorA(g);
      L(R_(g, 0.004), LENS, 1);
      let r2 = ribbon2([[a0 + 0.02, ty + 0.02], [a1 - 0.02, ty + 0.02], [a1 - 0.02, ty - 0.04]], 0.009); if (s < 0) r2 = mirrorA(r2);
      L(R_(r2, 0.007), TAIL, 1);
    }
    if (S.chrome) TR(R_(ribbon2([[-(W2 - 0.52), ty + 0.005], [W2 - 0.52, ty + 0.005]], 0.012), 0.006), CHROME, 1, 0.1);
  }
  // rear diffuser + exhausts
  const dy = M.sill(S.zR + 0.35) + 0.03;
  TR(R_(fill2(() => true, -(W2 - 0.3), W2 - 0.3, dy, dy + 0.14, 0.03), 0.002), '#0b0b0c', 0.3, 0.45);
  if (S.scoop) {   // supercar: open rear mesh between the tail bar and the diffuser (engine bay vents)
    const y1 = ty - 0.075, y0 = dy + 0.16, bx = W2 - 0.2;
    TR(R_(fill2(inRR(-bx, bx, y0, y1, 0.06), -bx, bx, y0, y1, 0.02), 0.003), '#060607', 0.4, 0.5);
    if (!lod) for (let y = y0 + 0.03; y < y1 - 0.02; y += 0.035) TR(R_(ribbon2([[-bx + 0.04, y], [bx - 0.04, y]], 0.007), 0.006), '#2a2b2e', 0.8, 0.35);
  }
  if (S.exh) {
    const xs = S.exh === 4 ? [0.42, 0.56] : [0.5];
    for (const s of [-1, 1]) for (const x of xs) {
      const g = new THREE.CylinderGeometry(0.045, 0.048, 0.12, lod ? 8 : 24, 1, true); g.rotateX(Math.PI / 2); g.scale(S.exh === 4 ? 1 : 1.35, 0.8, 1);
      const zz = M.edgeZ(s * x, dy + 0.07, false) ?? S.zR; g.translate(s * x, dy + 0.07, zz + 0.02); TR(g, CHROME, 1, 0.12);
      const d = new THREE.CircleGeometry(0.04, 16); d.scale(S.exh === 4 ? 1 : 1.35, 0.8, 1); d.rotateY(Math.PI); d.translate(s * x, dy + 0.07, zz + 0.05); TR(d, '#050505', 0, 0.9);
    }
  }
  // sides: belt chrome, sill strip, shut lines, handles, mirrors
  for (const s of [-1, 1]) {
    const beltPts = []; for (let z = S.zC + 0.08; z <= S.zA - 0.05; z += 0.05) beltPts.push([z, M.belt(z) - 0.008]);
    TR(project(M, ribbon2(beltPts, 0.014), 'side', 0.004, s), S.chrome ? CHROME : BLACK, S.chrome ? 1 : 0, S.chrome ? 0.1 : 0.1);
    if (lod) continue;
    const zf = M.wheelsZ[0] - S.Ra - 0.02, zr = M.wheelsZ[1] + S.Ra + 0.02, sy = M.sill(0) + 0.075;
    if (S.chrome) TR(project(M, ribbon2([[zr + 0.02, sy], [zf - 0.02, sy]], 0.012), 'side', 0.004, s), CHROME, 1, 0.12);
    const lines = S.doors === 4 ? [zf - 0.08, S.zB + 0.03, S.zB - 0.06, zr + 0.06] : [zf - 0.08, S.zB - 0.12];
    for (const z of lines) {
      const g = []; for (let y = M.sill(z) + 0.1; y <= M.belt(z) - 0.03; y += 0.03) g.push([z + (y - 0.5) * 0.02, y]);
      TR(project(M, ribbon2(g, 0.005), 'side', 0.0015, s), '#0a0a0a', 0, 0.9);
    }
    const hy = M.belt(0) - 0.13;
    for (const z of S.doors === 4 ? [S.zB - 0.2, zr + 0.3] : [S.zB - 0.32]) TR(project(M, ribbon2([[z - 0.1, hy], [z + 0.1, hy]], 0.024), 'side', 0.006, s), S.chrome ? CHROME : '#1a1a1c', 1, 0.14);
    if (S.scoop) {   // side air intake ahead of the rear wheel: dark recess + a thin paint-coloured lip line
      const za = M.wheelsZ[1] + S.Ra + 0.05, zb2 = za + 0.5, y0 = M.sill(za) + 0.22, y1 = M.belt(za) - 0.12;
      const inside = (a, b) => { const t = (a - za) / (zb2 - za); return t >= 0 && t <= 1 && b >= y0 + 0.16 * t * t && b <= y1 - 0.02 * t; };
      TR(project(M, fill2(inside, za, zb2, y0, y1, 0.02), 'side', 0.003, s), '#070708', 0.2, 0.55);
    }
    // mirror: paint cap + black arm + glass
    const mz = S.zA - 0.17, my = M.belt(mz) + 0.1, mx = (M.bodyX(mz, M.belt(mz) - 0.02) > 0 ? M.bodyX(mz, M.belt(mz) - 0.02) : W2 - 0.1) + 0.13;
    const cap = new RoundedBoxGeometry(0.2, 0.12, 0.13, 2, 0.045); cap.rotateY(s * 0.12); cap.translate(s * mx, my, mz); out.paint.push(strip(cap, ['position', 'normal', 'uv']));
    const arm = new RoundedBoxGeometry(0.14, 0.04, 0.07, 1, 0.015); arm.translate(s * (mx - 0.1), my - 0.03, mz + 0.01); TR(arm, BLACK, 0, 0.2);
    const mg = new THREE.PlaneGeometry(0.17, 0.095); mg.translate(s * mx, my, mz - 0.066); mg.rotateY(0); TR(flipWinding(mg), '#8a9096', 1, 0.05);
    const ind = new THREE.BoxGeometry(0.1, 0.006, 0.02); ind.translate(s * (mx + 0.045), my - 0.035, mz + 0.03); L(ind, AMBER, 2);
  }
  // ---- window surround (DLO): along the A-pillar edge, the roof edge and down the C-pillar edge
  if (!lod) {
    const tAt = (z, th) => { const s0 = gAng(z, 0.02); let a = 0, b = 0.5; for (let k = 0; k < 16; k++) { const m = (a + b) / 2; if (gAng(z, m) / s0 > th) a = m; else b = m; } return (a + b) / 2; };   // right side
    const pts = [];
    const add = (z, th) => { const [x, y] = M.gsec(z, tAt(z, th)); if (y >= M.belt(z) - 0.005) pts.push([x + 0.005, y + 0.003, z]); };
    for (let z = S.zA - 0.08; z > S.zT1; z -= 0.03) add(z, GA.a);
    for (let z = S.zT1; z > S.zT2; z -= 0.04) add(z, GA.rail);
    { const [x, y] = M.gsec(S.zT2, tAt(S.zT2, GA.rail)); for (let k = 1; k <= 6; k++) { const yy = lerp(y, M.belt(S.zT2), k / 6), X = M.bodyX(S.zT2, yy); pts.push([Math.max(x, 0) * (1 - k / 6) + (X > 0 ? X : x) * (k / 6) * 0.985 + 0.004, yy, S.zT2]); } }
    if (pts.length > 3) for (const s of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(s * x, y, z)));
      TR(new THREE.TubeGeometry(curve, pts.length * 2, S.chrome ? 0.0065 : 0.005, 6, false), S.chrome ? CHROME : BLACK, S.chrome ? 1 : 0, S.chrome ? 0.1 : 0.12);
    }
  }
  // ---- interior (tub, seats, dash, console) — only in the detailed model
  let steer = null, eye = null;
  if (!lod) {
    const IN = INTERIORS[0];   // colours applied per car via vertex colours → the detailed geometry is built per interior
    out._interiorBuild = ic => interiorGeometry(M, ic);
    steer = steeringGeometry(); eye = [S.driverX, S.eye, S.seat + 0.02];
    const dh = M.belt(S.zA) - 0.02;
    const scr = (w, h, x, y, z, tilt) => {
      const g = new THREE.PlaneGeometry(w, h, 1, 2); g.rotateX(tilt); g.rotateY(Math.PI); g.translate(x, y, z);
      const c = new Float32Array(g.attributes.position.count * 3), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = (p.getY(i) - (y - h / 2)) / h; c.set([0.012 + 0.016 * k, 0.016 + 0.024 * k, 0.026 + 0.04 * k], i * 3); }
      g.deleteAttribute('uv'); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); attr(g, 'lk', 1, [2]); out.lights.push(g.toNonIndexed());
    };
    const dRear = S.seat + 0.66;
    scr(0.34, 0.12, S.driverX, dh + 0.07, dRear + 0.05, -0.3);           // driver display
    scr(0.34, 0.17, 0, dh - 0.08, dRear - 0.004, 0.0);                    // centre screen
    L(new THREE.BoxGeometry(1.2, 0.006, 0.006).translate(0, dh - 0.175, dRear - 0.004), [0.9, 0.62, 0.3], 2);   // ambient light line
    // display graphics: two dial rings + a status bar (driver), map tiles + bar (centre)
    const ringAt = (cx, cy, z, r, tilt) => { const g = new THREE.RingGeometry(r - 0.004, r, 32); g.rotateX(tilt); g.rotateY(Math.PI); g.translate(cx, cy, z); L(g, [0.95, 0.78, 0.48], 2); };
    for (const dx of [-0.085, 0.085]) {
      ringAt(S.driverX + dx, dh + 0.07, dRear + 0.048, 0.042, -0.3);
      // dial ticks + needle
      for (let k = 0; k <= 8; k++) { const g = new THREE.PlaneGeometry(0.0028, k % 2 ? 0.006 : 0.01); g.translate(0, 0.031, 0); g.rotateZ((1 - k / 4) * 2.2); g.rotateX(-0.3); g.rotateY(Math.PI); g.translate(S.driverX + dx, dh + 0.07, dRear + 0.047); L(g, [0.85, 0.86, 0.9], 2); }
      const nd = new THREE.PlaneGeometry(0.0032, 0.03); nd.translate(0, 0.014, 0); nd.rotateZ(dx < 0 ? 1.5 : 0.7); nd.rotateX(-0.3); nd.rotateY(Math.PI); nd.translate(S.driverX + dx, dh + 0.07, dRear + 0.0465); L(nd, [1.0, 0.45, 0.2], 2);
    }
    L(new THREE.PlaneGeometry(0.06, 0.008).rotateY(Math.PI).translate(S.driverX, dh + 0.045, dRear + 0.04), [0.7, 0.8, 0.95], 2);
    for (const [x, y, w, h, c] of [[-0.08, -0.06, 0.14, 0.1, [0.05, 0.075, 0.1]], [0.075, -0.045, 0.14, 0.05, [0.085, 0.075, 0.055]], [0.075, -0.1, 0.14, 0.04, [0.045, 0.06, 0.085]], [0, -0.155, 0.3, 0.012, [0.95, 0.78, 0.48]],
      [-0.08, -0.06, 0.004, 0.08, [0.95, 0.78, 0.48]], [-0.06, -0.035, 0.05, 0.004, [0.95, 0.78, 0.48]], [0.04, -0.035, 0.05, 0.006, [0.8, 0.82, 0.86]], [0.05, -0.052, 0.07, 0.004, [0.5, 0.52, 0.56]]])
      L(new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(x, dh + y, dRear - (h < 0.01 || w < 0.01 ? 0.0085 : 0.007)), c, 2);
    void IN;
  }
  // ---- final merge per material
  const merge = (list, keep) => { if (!list.length) return null; const g = mergeGeometries(list.map(q => strip(q.index ? q.toNonIndexed() : q, keep)), false); g.computeBoundingSphere(); return g; };
  const res = {
    spec: S, model: M,
    paint: boxUV(merge(out.paint, ['position', 'normal', 'uv']), 3.1),
    glass: merge(out.glass, ['position', 'normal']),
    trim: merge(out.trim, ['position', 'normal', 'color', 'mr']),
    lights: merge(out.lights, ['position', 'normal', 'color', 'lk']),
    headliner: out.interior.length ? merge(out.interior, ['position', 'normal', 'color', 'mr']) : null,
    interiorFor: out._interiorBuild || null, steering: steer, eye,
    wheel: wheelGeometry(kind, lod),
    wheelPos: [[S.wheelX, S.R, S.wb / 2, 1, 1], [-S.wheelX, S.R, S.wb / 2, -1, 1], [S.wheelX, S.R, -S.wb / 2, 1, 0], [-S.wheelX, S.R, -S.wb / 2, -1, 0]],
  };
  // static brakes (discs + callipers) inside the wheels → trim
  const br = [];
  for (const [x, y, z, s] of (lod ? [] : res.wheelPos)) {
    const d = new THREE.CylinderGeometry(S.R - 0.13, S.R - 0.13, 0.028, lod ? 10 : 30); d.rotateZ(Math.PI / 2); d.translate(x - s * 0.02, y, z); br.push(tint(d, '#7d7f82', 1, 0.42));
    const c = new RoundedBoxGeometry(0.05, 0.16, 0.1, 1, 0.015); c.translate(x - s * 0.005, y + S.R * 0.42, z - 0.1); br.push(tint(c, S.doors === 2 ? '#8a1c17' : '#1b1c1f', 0.3, 0.35));
  }
  const tb = mergeGeometries([res.trim, ...br.map(q => strip(q, ['position', 'normal', 'color', 'mr']))].filter(Boolean), false);
  res.trim.dispose(); br.forEach(q => q.dispose()); res.trim = tb;
  // LOD "rest": everything except paint in one vertex-coloured mesh
  if (lod) {
    const wheels = res.wheelPos.map(([x, y, z, s]) => { const g = res.wheel.clone(); if (s < 0) g.rotateY(Math.PI); g.translate(x, y, z); return g; });
    const gl = tint(res.glass.clone(), '#0a0e12', 0.2, 0.06);
    const li = res.lights.clone(); li.deleteAttribute('lk'); const lc = li.attributes.color; for (let i = 0; i < lc.count; i++) lc.setXYZ(i, lc.getX(i) * 0.3, lc.getY(i) * 0.3, lc.getZ(i) * 0.3);
    attr(li, 'mr', 2, [0, 0.2]);
    res.rest = mergeGeometries([res.trim, gl, li, ...wheels].map(q => strip(q.index ? q.toNonIndexed() : q, ['position', 'normal', 'color', 'mr'])), false);
    res.rest.computeBoundingSphere();
    gl.dispose(); li.dispose(); wheels.forEach(w => w.dispose());
  }
  LODK = 1;
  return (KIND_GEO[key] = res);
}

// Far model (~700 triangles): coarse loft, flat light/grille quads, simple wheels — for the mass of parked cars.
function farGeometry(kind) {
  const key = kind + ':far';
  if (KIND_GEO[key]) return KIND_GEO[key];
  const M = bodyModel(kind), S = M.S, rest = [];
  const zs = []; const NI = 16; for (let i = 0; i <= NI; i++) zs.push(lerp(S.zR, S.zF, i / NI));
  for (const zw of M.wheelsZ) for (const d of [-S.Ra, S.Ra]) zs.push(zw + d * 0.98);
  for (const u of [0.04, 0.12, 0.25]) zs.push(S.zF - u, S.zR + u);
  zs.sort((a, b) => a - b);
  const zRef = (S.zA + S.zC) / 2, ring = arcParams(t => M.sec(zRef, t), 12, true);
  const body = gridSurface(zs.length, ring.length, (i, j) => { const [x, y] = M.sec(zs[i], ring[j]); return [x, y, zs[i]]; },
    (i, j) => { const z = (zs[i] + zs[i + 1]) / 2, t = (ring[j] + (ring[(j + 1) % ring.length] || 1)) / 2; if (t > 0.655 && t < 0.845) return 'under'; if (z > S.zC && z < S.zA && M.sec(z, t)[1] > M.belt(z) + 0.004) return null; return 'paint'; }, { wrapJ: true });
  const gzs = [S.zC - 0.02, (S.zC + S.zT2) / 2, S.zT2, (S.zT1 + S.zT2) / 2, S.zT1, (S.zT1 + S.zA) / 2, S.zA + 0.02], gt = arcParams(t => M.gsec(zRef, t), 8, false);
  const gh = gridSurface(gzs.length, gt.length, (i, j) => { const [x, y] = M.gsec(gzs[i], gt[j]); return [x, y, gzs[i]]; },
    (i, j) => { const z = (gzs[i] + gzs[i + 1]) / 2, a = Math.abs(M.gsec(z, (gt[j] + gt[j + 1]) / 2)[2]); return z < S.zT1 && z > S.zT2 && a < 0.76 ? 'roof' : 'glass'; });
  const paint = mergeGeometries([body.paint, gh.roof].filter(Boolean).map(g => strip(g.toNonIndexed(), ['position', 'normal'])), false);
  if (body.under) rest.push(tint(body.under, '#0b0b0c', 0, 0.8));
  if (gh.glass) rest.push(tint(gh.glass, '#0a0e12', 0.2, 0.06));
  [body.paint, gh.roof].forEach(g => g && g.dispose());
  const W2 = S.W / 2, yNose = M.top(S.zF - 0.35), yTail = M.top(S.zR + 0.25);
  const quad = (view, a0, a1, b0, b1, hex, m, r) => { const g = new THREE.PlaneGeometry(a1 - a0, b1 - b0, 3, 1); g.translate((a0 + a1) / 2, (b0 + b1) / 2, 0); rest.push(tint(project(M, g, view, 0.006), hex, m, r)); };
  for (const s of [-1, 1]) {
    const hx0 = W2 - 0.42, hx1 = W2 - 0.12;
    quad('front', s < 0 ? -hx1 : hx0, s < 0 ? -hx0 : hx1, yNose - 0.14, yNose - 0.07, '#dfe6f0', 0.2, 0.2);
    quad('rear', s < 0 ? -(W2 - 0.08) : W2 - 0.45, s < 0 ? -(W2 - 0.45) : W2 - 0.08, yTail - 0.12, yTail - 0.07, '#5a0806', 0.1, 0.25);
  }
  if (S.grille !== 'closed' && S.grille !== 'intake') quad('front', -0.3, 0.3, yNose - 0.48, yNose - 0.22, '#141416', 0.8, 0.3);
  for (const [x, y, z, s] of [[S.wheelX, S.R, S.wb / 2, 1], [-S.wheelX, S.R, S.wb / 2, -1], [S.wheelX, S.R, -S.wb / 2, 1], [-S.wheelX, S.R, -S.wb / 2, -1]]) {
    const t = new THREE.CylinderGeometry(S.R, S.R, S.tw, 12, 1, true); t.rotateZ(Math.PI / 2); t.translate(x, y, z); rest.push(tint(t, '#121214', 0, 0.85));
    const d = new THREE.CircleGeometry(S.R - 0.09, 12); d.rotateY(s * Math.PI / 2); d.translate(x + s * S.tw * 0.45, y, z); rest.push(tint(d, '#9a9ca0', 1, 0.3));
  }
  const g = mergeGeometries(rest.map(q => strip(q.index ? q.toNonIndexed() : q, ['position', 'normal', 'color', 'mr'])), false);
  rest.forEach(q => q.dispose()); paint.computeBoundingSphere(); g.computeBoundingSphere();
  return (KIND_GEO[key] = { paint, rest: g, spec: S });
}

function interiorGeometry(M, ic) {
  const S = M.S, parts = [];
  const T = (g, hex, m, r) => parts.push(tint(g, hex, m, r));
  const rb = (w, h, d, r, x, y, z, rx = 0) => { const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
  // tub: doors + floor, facing inward
  const z0 = S.seats === 2 ? S.seat - 0.62 : Math.min(S.seat - 1.35, S.zC + 0.2), z1 = S.zA + 0.05, NI = 22, ring = [];
  const zs = []; for (let i = 0; i <= NI; i++) zs.push(lerp(z0, z1, i / NI));
  const yb = S.floor - 0.02;
  const sideX = (z, y) => { const b = M.bodyX(z, Math.max(y, M.yb(z) + 0.02)); return (b > 0 ? b : M.w(z) * 0.9) * 0.95 - 0.035; };
  // ring from right sill up the door to the window sill, over to the glass, then the mirror image
  const ys = [yb, yb + 0.12, (yb + M.belt(0)) / 2, M.belt(0) - 0.13, M.belt(0) - 0.07, M.belt(0) - 0.012];
  const P = (i, j) => {
    const z = zs[i], bz = M.belt(z), n = ys.length;
    const y0 = Math.max(yb, M.yb(z) + 0.03);
    if (j < n) { const y = j === n - 1 ? bz - 0.012 : lerp(y0, bz, (ys[j] - yb) / (M.belt(0) - yb)); return [-(sideX(z, y)), y, z]; }
    if (j === n) return [-(M.gW(z) + 0.004), bz + 0.004, z];
    if (j === n + 1) return [M.gW(z) + 0.004, bz + 0.004, z];
    const k = 2 * n + 1 - j, y = k === n - 1 ? bz - 0.012 : lerp(y0, bz, (ys[k] - yb) / (M.belt(0) - yb)); return [sideX(z, y), y, z];
  };
  void ring;
  // floor strip across (separate)
  const NJ = ys.length * 2 + 2;
  const tub = gridSurface(zs.length, NJ, (i, j) => P(i, j), (i, j) => (j === ys.length ? null : j === ys.length - 1 || j === ys.length + 1 ? 'sill' : (j === 3 || j === NJ - 5 ? 'acc' : 'side')), {});
  const fixIn = g => { g.computeVertexNormals(); const n = g.attributes.normal, p = g.attributes.position; let d = 0; for (let i = 0; i < n.count; i++) d += -n.getX(i) * Math.sign(p.getX(i)); if (d < 0) flipWinding(g); g.computeVertexNormals(); return g; };
  if (tub.side) T(fixIn(tub.side), ic.leather, 0, 0.55);
  if (tub.acc) T(fixIn(tub.acc), ic.accent, ic.accent === '#8f8f93' ? 1 : 0.1, 0.28);
  if (tub.sill) T(fixIn(tub.sill), ic.dark, 0, 0.6);
  const fw = sideX(S.seat, yb + 0.05);
  const fz0 = Math.max(z0, -S.wb / 2 + S.Ra), fz1 = Math.min(z1, S.wb / 2 - S.Ra);
  const fl = new THREE.PlaneGeometry(fw * 2, fz1 - fz0); fl.rotateX(-Math.PI / 2); fl.translate(0, yb, (fz0 + fz1) / 2); T(fl, '#1b1a19', 0, 0.95);
  // rear bulkhead / parcel shelf
  const bk = new THREE.PlaneGeometry(fw * 2, M.belt(z0) - yb); bk.translate(0, (M.belt(z0) + yb) / 2, z0); T(bk, ic.dark, 0, 0.8);
  const ps = new THREE.PlaneGeometry(fw * 2, 0.5); ps.rotateX(-Math.PI / 2); ps.translate(0, M.belt(z0) - 0.01, z0 + 0.25); T(ps, ic.dark, 0, 0.8);
  // dashboard: soft top + lower, wood/alu band, two screens (glow is in the lights mesh), vents
  const dRear = S.seat + 0.66, dFront = S.zA + 0.1, dh = M.belt(S.zA) - 0.02;
  T(rb(fw * 2 - 0.04, 0.2, dFront - dRear, 0.07, 0, dh - 0.08, (dFront + dRear) / 2), ic.dark, 0, 0.65);
  T(rb(fw * 2 - 0.06, 0.26, 0.26, 0.06, 0, dh - 0.3, dRear + 0.13), ic.leather, 0, 0.55);
  T(rb(fw * 2 - 0.06, 0.035, 0.02, 0.01, 0, dh - 0.2, dRear + 0.005), ic.accent, ic.accent === '#8f8f93' ? 1 : 0.1, 0.25);
  for (const x of [-0.55, -0.18, 0.18, 0.55]) T(rb(0.13, 0.04, 0.02, 0.008, x, dh - 0.14, dRear - 0.002), '#c8c9cb', 1, 0.2);
  // centre console + tunnel
  T(rb(0.26, 0.24, dRear + 0.1 - (S.seat - 0.35), 0.04, 0, S.floor + 0.12, (dRear + 0.1 + S.seat - 0.35) / 2), ic.dark, 0, 0.6);
  T(rb(0.24, 0.03, 0.5, 0.012, 0, S.floor + 0.25, S.seat - 0.05), ic.accent, ic.accent === '#8f8f93' ? 1 : 0.1, 0.25);
  // seats: front pair + rear pair (2+2 in coupés)
  const seat = (x, z, rear) => {
    const w = rear ? 0.5 : 0.53, cy = S.cushion - (rear ? 0.03 : 0);
    T(rb(w, 0.13, 0.52, 0.05, x, cy - 0.065, z + 0.06), ic.leather, 0, 0.5);
    for (const s of [-1, 1]) T(rb(0.07, 0.1, 0.5, 0.03, x + s * (w / 2 - 0.03), cy - 0.01, z + 0.06), ic.leather, 0, 0.5);
    const bh = Math.max(0.36, Math.min(rear ? 0.56 : 0.6, S.roof - cy - (rear ? 0.4 : 0.36))), back = rb(w - 0.02, bh, 0.13, 0.05, 0, bh / 2, 0, -0.26);
    back.translate(x, cy - 0.02, z - 0.2); T(back, ic.leather, 0, 0.5);
    if (!rear && cy + bh + 0.2 < S.roof - 0.1) { const hr = rb(0.27, 0.2, 0.11, 0.05, 0, 0, 0, -0.26); hr.translate(x, cy + bh + 0.08, z - 0.2 - Math.sin(0.26) * (bh + 0.1)); T(hr, ic.leather, 0, 0.5); }
    T(rb(w - 0.16, 0.012, 0.42, 0.005, x, cy + 0.002, z + 0.07), ic.dark, 0, 0.6);   // perforated centre panel
  };
  const dx = S.driverX;
  seat(dx, S.seat, false); seat(-dx, S.seat, false);
  const rz = S.seat - (S.doors === 2 ? 0.78 : 0.95);
  if (S.seats !== 2 && rz - 0.35 > z0) { seat(dx - 0.02, rz, true); seat(-dx + 0.02, rz, true); }
  const g = mergeGeometries(parts.map(q => strip(q, ['position', 'normal', 'color', 'mr'])), false);
  parts.forEach(q => q.dispose()); g.computeBoundingSphere();
  return g;
}
function steeringGeometry() {
  const parts = [];
  // leather rim with a flattened lower arc, slim satin spokes, a small stitched boss (no emblem)
  const rim = new THREE.TorusGeometry(0.182, 0.0165, 14, 56);
  { const p = rim.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.13) p.setY(i, -0.13 + (p.getY(i) + 0.13) * 0.55); rim.computeVertexNormals(); }
  parts.push(tint(rim, '#161413', 0, 0.5));
  const boss = new RoundedBoxGeometry(0.118, 0.088, 0.034, 3, 0.03); boss.translate(0, -0.006, 0.004); parts.push(tint(boss, '#1b1917', 0, 0.55));
  const ring = new THREE.TorusGeometry(0.02, 0.0028, 8, 28); ring.translate(0, -0.004, -0.014); parts.push(tint(ring, '#c9cacc', 1, 0.18));
  for (const a of [0, Math.PI]) {
    const sp = new RoundedBoxGeometry(0.115, 0.02, 0.012, 2, 0.005); sp.translate(0.112, 0.002, 0.004); sp.rotateZ(a); parts.push(tint(sp, '#9a9c9f', 1, 0.3));
    const pad = new RoundedBoxGeometry(0.05, 0.03, 0.012, 2, 0.005); pad.translate(0.085, 0.002, -0.004); pad.rotateZ(a); parts.push(tint(pad, '#0d0d0e', 0.2, 0.3));   // thumb keys
  }
  for (const dx of [-0.02, 0.02]) { const sp = new RoundedBoxGeometry(0.014, 0.115, 0.01, 2, 0.004); sp.translate(dx, -0.095, 0.004); parts.push(tint(sp, '#9a9c9f', 1, 0.3)); }
  const col = new THREE.CylinderGeometry(0.03, 0.04, 0.3, 12); col.rotateX(Math.PI / 2); col.translate(0, 0, 0.17); parts.push(tint(col, '#121212', 0, 0.6));
  const g = mergeGeometries(parts.map(q => strip(q, ['position', 'normal', 'color', 'mr'])), false); parts.forEach(q => q.dispose());
  g.computeBoundingSphere(); return g;
}

// ------------------------------------------------------------------ number plates (detailed model only)
// Ukrainian format: a blue strip with the flag and «UA», then two letters of the region (AO / KO — Zakarpattia), four
// digits and a two-letter series. The numbers are random and cannot be anyone's: the series uses only Latin letters that
// real Ukrainian plates never carry (D, F, G, J, L, N, R, S, U, V, W, Y, Z). One shared atlas, one small mesh per car.
const PLATES = { cols: 2, rows: 4, n: 8, W: 0.52, H: 0.112, mat: null };
function plateMaterial() {
  if (PLATES.mat !== null) return PLATES.mat;
  if (typeof document === 'undefined') return (PLATES.mat = false);
  const cw = 512, ch = 128, ph = 110, c = document.createElement('canvas'); c.width = cw * PLATES.cols; c.height = ch * PLATES.rows;
  const g = c.getContext('2d'), r = rng(2110), L = 'DFGJLNRSUVWYZ';
  g.fillStyle = '#0c0c0d'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < PLATES.n; i++) {
    const x = (i % PLATES.cols) * cw, y = Math.floor(i / PLATES.cols) * ch + (ch - ph) / 2;
    g.fillStyle = '#f4f4f1'; g.beginPath(); g.roundRect(x + 3, y + 3, cw - 6, ph - 6, 9); g.fill();
    g.strokeStyle = '#101012'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#1250a8'; g.beginPath(); g.roundRect(x + 6, y + 6, 50, ph - 12, [7, 0, 0, 7]); g.fill();
    g.fillStyle = '#2b6fd0'; g.fillRect(x + 16, y + 20, 30, 12); g.fillStyle = '#f2cf1c'; g.fillRect(x + 16, y + 32, 30, 12);
    g.fillStyle = '#ffffff'; g.font = '700 24px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UA', x + 31, y + 76);
    const pick = () => L[Math.floor(r() * L.length)], num = String(Math.floor(r() * 9000) + 1000);
    const txt = (r() < 0.75 ? 'AO' : 'KO') + ' ' + num + ' ' + pick() + pick();
    g.fillStyle = '#111113'; g.font = '700 78px "Arial Narrow", Arial, Helvetica, sans-serif'; g.fillText(txt, x + 58 + (cw - 64) / 2, y + ph / 2 + 4, cw - 84);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  PLATES.pad = (ch - ph) / 2 / ch;
  return (PLATES.mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, metalness: 0.05, emissive: new THREE.Color('#ffffff'), emissiveMap: t, emissiveIntensity: 0.08, side: THREE.DoubleSide }));
}
// front + rear plate of a model, flat, standing 6 mm off the bodywork at the height of the bumper
function plateGeometry(kind, index) {
  const i = ((index % PLATES.n) + PLATES.n) % PLATES.n, key = kind + ':plate:' + i;
  if (KIND_GEO[key]) return KIND_GEO[key];
  const M = bodyModel(kind), S = M.S, W = PLATES.W, H = PLATES.H, pos = [], uv = [], nrm = [];
  const u0 = (i % PLATES.cols) / PLATES.cols, u1 = u0 + 1 / PLATES.cols, row = Math.floor(i / PLATES.cols);
  const v1 = 1 - (row + PLATES.pad) / PLATES.rows, v0 = 1 - (row + 1 - PLATES.pad) / PLATES.rows;
  const yNose = M.top(S.zF - 0.35), yTail = M.top(S.zR + 0.25);
  const dy = M.sill(S.zR + 0.35) + 0.03, ty = yTail - (S.tail === 'suv' ? 0.1 : 0.085);
  for (const front of [true, false]) {
    const y = front ? Math.max(M.sill(S.zF - 0.25) + 0.14, yNose - 0.5) : Math.max(dy + 0.2, Math.min(ty - 0.13, (dy + 0.14 + ty - 0.05) / 2));
    let z = null;
    for (const x of [0, W / 4, W / 2]) for (const yy of [y - H / 2, y, y + H / 2]) { const e = M.edgeZ(x, yy, front); if (e != null) z = z == null ? e : front ? Math.max(z, e) : Math.min(z, e); }
    if (z == null) continue;
    z += front ? 0.006 : -0.006;
    const s = front ? 1 : -1;                                   // seen from outside, the text reads left → right
    pos.push(-s * W / 2, y - H / 2, z, s * W / 2, y - H / 2, z, s * W / 2, y + H / 2, z, -s * W / 2, y - H / 2, z, s * W / 2, y + H / 2, z, -s * W / 2, y + H / 2, z);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let k = 0; k < 6; k++) nrm.push(0, 0, s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return (KIND_GEO[key] = geo);
}

// ------------------------------------------------------------------ public: one detailed car (≤ 8 draw calls)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
export function createCar(kind = 'sedan', colour = 'black', opts = {}) {
  if (!SPECS[kind]) kind = 'sedan';
  const G = kindGeometry(kind), S = G.spec, MS = shared();
  const icIndex = opts.interior ?? (hashStr(kind + colour) % INTERIORS.length);
  const ikey = kind + ':int:' + icIndex;
  const intGeo = KIND_GEO[ikey] || (KIND_GEO[ikey] = mergeGeometries([G.interiorFor(INTERIORS[icIndex]), G.headliner].filter(Boolean), false));
  const group = new THREE.Group(); group.name = 'vrc-car-' + kind;
  const paint = paintMaterial(colour);
  const lightsMat = lightMaterial();
  const mk = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); return m; };
  const body = mk(G.paint, paint, 'paint');
  const glass = mk(G.glass, MS.glass, 'glass'); glass.renderOrder = 3;
  mk(G.trim, MS.trim, 'trim');
  mk(G.lights, lightsMat, 'lights');
  mk(intGeo, MS.interior, 'interior');
  // number plates (opts.plate: index into the plate atlas, or false for none)
  if (opts.plate !== false) { const pm = plateMaterial(); if (pm) mk(plateGeometry(kind, opts.plate ?? hashStr(kind + ':' + colour)), pm, 'plates'); }
  // steering wheel on a tilted column in front of the driver
  const steering = new THREE.Group(); steering.name = 'steering';
  steering.position.set(S.driverX, S.eye - 0.38, S.seat + 0.56); steering.rotation.x = 0.36;
  const sw = new THREE.Mesh(G.steering, MS.interior); sw.name = 'steering-wheel'; steering.add(sw); group.add(steering);
  const wheels = new THREE.InstancedMesh(G.wheel, MS.wheel, 4); wheels.name = 'wheels';
  wheels.frustumCulled = false;
  group.add(wheels);
  const state = { spin: 0, steer: 0 };
  function setWheels(spin = state.spin, steer = state.steer) {
    state.spin = spin; state.steer = steer;
    G.wheelPos.forEach(([x, y, z, s, front], i) => {
      _q.setFromEuler(_e.set(0, front ? steer : 0, 0, 'YXZ'));
      const qs = new THREE.Quaternion().setFromEuler(_e.set(spin, 0, 0));
      const qm = new THREE.Quaternion().setFromEuler(_e.set(0, s < 0 ? Math.PI : 0, 0));
      _q.multiply(qs).multiply(qm);
      _m.compose(_v.set(x, y, z), _q, _s1); wheels.setMatrixAt(i, _m);
    });
    wheels.instanceMatrix.needsUpdate = true;
    sw.rotation.z = -steer * 7.5;
  }
  setWheels(0, 0);
  const uK = lightsMat.userData.uK.value;
  let on = false;
  function setLights(v, brake = false, reverse = false) {
    on = !!v;
    uK.set(on ? 1.0 : 0.1, brake ? 2.4 : on ? 0.95 : 0.3, on ? 1.0 : 0.08);
    void reverse;
  }
  setLights(false);
  function setInside(v) { glass.material = v ? MS.glassIn : MS.glass; }
  return {
    group, wheels, steering, lights: lightsMat, setLights, setWheels, setInside, kind, colour, spec: S,
    eye: new THREE.Vector3(...G.eye), body,
    get lightsOn() { return on; },
    dispose() { lightsMat.dispose(); group.parent?.remove(group); },
  };
}

// ------------------------------------------------------------------ public: far / parked cars as instances (2 draw calls per model)
// list: [{x, y, z, yaw, kind, colour}]. Returns {group, setHidden(i, bool), update(list?), dispose()}.
export function createCarInstances(list, { shadows = false } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-car-instances';
  const MS = shared();
  const byKind = {};
  list.forEach((c, i) => (byKind[c.kind] ||= []).push(i));
  const meshes = {};
  const hidden = new Set();
  const col = new THREE.Color();
  for (const [kind, idx] of Object.entries(byKind)) {
    const G = farGeometry(kind);
    const p = new THREE.InstancedMesh(G.paint, MS.farPaint, idx.length), r = new THREE.InstancedMesh(G.rest, MS.lodRest, idx.length);
    p.name = 'cars-' + kind + '-paint'; r.name = 'cars-' + kind + '-rest';
    p.castShadow = r.castShadow = shadows;
    idx.forEach((ci, k) => p.setColorAt(k, col.set(CAR_COLOURS[list[ci].colour] || list[ci].colour || '#222')));
    p.instanceColor.needsUpdate = true;
    meshes[kind] = { p, r, idx }; group.add(p, r);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function update() {
    for (const { p, r, idx } of Object.values(meshes)) {
      idx.forEach((ci, k) => {
        const c = list[ci];
        const m = hidden.has(ci) ? zero : _m.compose(_v.set(c.x, c.y, c.z), _q.setFromEuler(_e.set(-(c.pitch || 0), c.yaw, 0, 'YXZ')), _s1);
        p.setMatrixAt(k, m); r.setMatrixAt(k, m);
      });
      p.instanceMatrix.needsUpdate = r.instanceMatrix.needsUpdate = true;
      p.computeBoundingSphere(); r.computeBoundingSphere();
    }
  }
  update();
  return {
    group, list,
    setHidden(i, v) { if (v) hidden.add(i); else hidden.delete(i); },
    update,
    dispose() { for (const { p, r } of Object.values(meshes)) { p.dispose(); r.dispose(); } group.parent?.remove(group); },
  };
}
// A single-material, x-forward geometry (vertex colours) for foreign instanced car meshes (environment traffic).
export function carGeometryXForward(kind = 'sedan') {
  const G = farGeometry(kind);
  const p = G.paint.clone(); strip(p, ['position', 'normal']); attr(p, 'color', 3, [1, 1, 1]);
  const r = G.rest.clone(); r.deleteAttribute('mr');
  const g = mergeGeometries([p, r], false); p.dispose(); r.dispose();
  g.rotateY(Math.PI / 2); g.computeBoundingSphere(); return g;
}
/** Deterministic luxury pick for a spot (seeded): {kind, colour}. */
export function pickCar(r) {
  const kinds = ['sedan', 'sedan', 'suv', 'suv', 'gt', 'gt', 'ev', 'ev', 'coupe', 'super'];
  const cols = ['black', 'black', 'graphite', 'pearl', 'pearl', 'blue', 'champagne', 'green', 'graphite'];
  return { kind: kinds[Math.floor(r() * kinds.length)], colour: cols[Math.floor(r() * cols.length)] };
}
export { rng as carRng };

// ------------------------------------------------------------------ arcade vehicle controller
// world: { ground(x, y, z) → y | null, blocked(car, x, z, yaw, y) → bool, limit(x, y, z) → m/s, drivable(x, z) → bool }
export class CarController {
  constructor(rec) {
    this.rec = rec; this.S = carSpec(rec.kind);
    this.x = rec.x; this.y = rec.y; this.z = rec.z; this.yaw = rec.yaw;
    this.v = 0; this.steer = 0; this.pitch = rec.pitch || 0; this.roll = 0; this.spin = 0; this.bump = 0; this.braking = false; this.reversing = false;
    this.hit = 0;
  }
  step(dt, inp, world) {
    if (!(dt > 0)) return this;
    const S = this.S;
    const limit = world.limit(this.x, this.y, this.z);
    let a = 0; const v = this.v;
    const gas = clamp(inp.gas || 0), brk = clamp(inp.brake || 0);
    this.braking = false; this.reversing = false;
    if (gas > 0) {
      if (v < -0.2) { a = 7 * gas; this.braking = true; }
      else a = 3.6 * gas * (1 - clamp(v / Math.max(0.1, limit)) ** 2) + 0.4 * gas;
    }
    if (brk > 0) {
      if (v > 0.25) { a -= 8 * brk; this.braking = true; }
      else if (!gas) { a -= 2.4 * brk; this.reversing = true; }
    }
    if (!gas && !brk) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, 0.7 + 0.03 * v * v);
    if (v > limit) a = Math.min(a, -2.8);
    a -= 9.81 * Math.sin(this.pitch) * 0.55 * (Math.abs(v) > 0.05 || gas || brk ? 1 : 0);
    let nv = v + a * dt;
    nv = clamp(nv, -2.8, Math.max(limit * 1.03, 0.5));
    if (!gas && !brk && Math.abs(nv) < 0.03) nv = 0;
    if (!gas && brk && v > 0 && nv < 0) nv = 0;
    // steering: speed-dependent lock, rate-limited
    const maxSteer = 0.66 / (1 + nv * nv / 45);
    const target = clamp(inp.steer || 0, -1, 1) * maxSteer;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 3.2 : 2.3) * dt;
    this.steer += clamp(target - this.steer, -rate, rate);
    const yawRate = nv * Math.tan(this.steer) / S.wb;
    const nyaw = this.yaw + yawRate * dt;
    const d = nv * dt, fx = Math.sin(nyaw), fz = Math.cos(nyaw);
    const nx = this.x + fx * d, nz = this.z + fz * d;
    // ground under both axles
    const hw = S.wb / 2;
    const g = (px, pz) => (world.drivable(px, pz) ? world.ground(px, this.y, pz) : null);
    let ok = true, yF = g(nx + fx * hw, nz + fz * hw), yR = g(nx - fx * hw, nz - fz * hw);
    if (yF == null || yR == null || Math.abs(yF - this.y) > 0.5 || Math.abs(yR - this.y) > 0.5) ok = false;
    if (ok && world.blocked(this, nx, nz, nyaw, (yF + yR) / 2)) ok = false;
    if (!ok && Math.abs(d) > 1e-5) {
      // try turning in place (no translation) before stopping
      const yF2 = g(this.x + Math.sin(nyaw) * hw, this.z + Math.cos(nyaw) * hw), yR2 = g(this.x - Math.sin(nyaw) * hw, this.z - Math.cos(nyaw) * hw);
      if (yF2 != null && yR2 != null && !world.blocked(this, this.x, this.z, nyaw, this.y)) this.yaw = nyaw;
      this.hit = Math.abs(nv); this.v = -nv * 0.12; this.bump = Math.min(0.06, Math.abs(nv) * 0.01);
    } else {
      this.x = nx; this.z = nz; this.yaw = nyaw; this.v = nv;
      if (yF != null && yR != null) {
        const ty = (yF + yR) / 2; this.y += (ty - this.y) * clamp(dt * 18);
        const tp = Math.atan2(yF - yR, S.wb); this.pitch += (tp - this.pitch) * clamp(dt * 10);
      }
    }
    this.roll += (clamp(-yawRate * this.v * 0.012, -0.05, 0.05) - this.roll) * clamp(dt * 6);
    this.spin += this.v / S.R * dt;
    this.bump *= Math.exp(-dt * 8);
    return this;
  }
  get speed() { return this.v; }
}

// ------------------------------------------------------------------ site geometry helpers (world x, z)
const inPoly2 = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
const polyArea = P => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return a / 2; };
const polyDist = (P, x, z) => { let d = Infinity; for (let i = 0, j = P.length - 1; i < P.length; j = i++) d = Math.min(d, segDist(x, z, P[j][0], P[j][1], P[i][0], P[i][1])); return d; };
const nearestOnPoly = (P, x, z) => {   // closest point of the outline → [qx, qz, distance]
  let best = [x, z, Infinity];
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ax = P[j][0], az = P[j][1], dx = P[i][0] - ax, dz = P[i][1] - az, L = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L);
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz); if (d < best[2]) best = [qx, qz, d];
  }
  return best;
};
const bboxOfPoly = P => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const isRectPoly = P => P.length === 4 && P.every((p, i) => { const q = P[(i + 1) % 4]; return Math.abs(p[0] - q[0]) < 0.35 || Math.abs(p[1] - q[1]) < 0.35; });
// first-floor outline of a tower in world coordinates (rotation-safe: through localToWorld)
const towerOutline = id => footprintOf(id, 1).map(([x, z]) => localToWorld(id, x, z));
// lobby entrances of the towers (world): the only openings in the street-level shells; shop entrances stay closed
function towerEntrances() {
  const out = [];
  for (const id of B_IDS) for (const c of coresOf(id, 1)) {
    if (!c || !c.entrance) continue;
    const p = localToWorld(id, c.entrance[0], c.entrance[1]), n = c.entranceNormal || [0, 1];
    const q = localToWorld(id, c.entrance[0] + n[0], c.entrance[1] + n[1]);
    out.push({ id, p, n: [q[0] - p[0], q[1] - p[1]] });
  }
  return out;
}

// ------------------------------------------------------------------ neighbours: heights, styles, the fuel-station canopy
// One classification for context.js (what is drawn) and for the colliders below (what stops a car).
export function contextStyle(b) {
  const f = Math.max(1, b.floors || 1), k = b.kind;
  if (k === 'canopy') return 'canopy';
  if (k === 'fuel' || k === 'commercial' || k === 'pavilion') return 'shop';
  if (k === 'utility') return 'plain';
  if (k === 'residential' && f >= 7) return 'panel';     // 9-storey panel slabs
  if (k === 'residential' && f >= 3) return 'brick';     // 5-storey silicate-brick slabs
  return 'plaster';                                      // private houses, 1–2 storey buildings, ruins, unknown OSM outlines
}
/** Height (m) of the walls of a context block — eaves or parapet top; pitched roofs rise above it. */
export function contextHeight(b) {
  const f = Math.max(1, b.floors || 1);
  switch (contextStyle(b)) {
    case 'canopy': return 5.4;
    case 'shop': return (b.kind === 'pavilion' ? 3.0 : b.kind === 'fuel' ? 4.2 : 4.0) + (f - 1) * 3.3;
    case 'plain': return 3.0 * f;
    case 'panel': case 'brick': return 0.9 + f * 2.8 + 0.5;
    default: return b.kind === 'ruin' ? 3.6 * f : 0.4 + f * 3.0;
  }
}
/** Fuel-station canopy layout from its outline: pump islands along the long axis, a column on each, two cars filling up. */
export function canopyLayout(b) {
  const P = b.poly || [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
  let L = 0, ux = 1, uz = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const dx = P[i][0] - P[j][0], dz = P[i][1] - P[j][1], l = Math.hypot(dx, dz); if (l > L) { L = l; ux = dx / l; uz = dz / l; } }
  const vx = -uz, vz = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of P) { const u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const vm = (v0 + v1) / 2, n = Math.max(1, Math.min(4, Math.floor((u1 - u0 - 5) / 6.5) + 1)), islands = [], cars = [];
  const W = (u, v) => [u * ux + v * vx, u * uz + v * vz], yaw = Math.atan2(ux, uz);
  for (let i = 0; i < n; i++) {
    const u = (u0 + u1) / 2 + (i - (n - 1) / 2) * 6.5, [x, z] = W(u, vm);
    if (!inPoly2(P, x, z)) continue;
    islands.push({ x, z, yaw, a: W(u - 1.7, vm), b: W(u + 1.7, vm) });
    for (const s of [-1, 1]) { const [cx, cz] = W(u, vm + s * 2.35); if (inPoly2(P, cx, cz)) cars.push({ x: cx, z: cz, yaw: s > 0 ? yaw : yaw + Math.PI }); }
  }
  return { islands, cars, axis: [ux, uz], clear: 4.6, top: contextHeight(b), poly: P };
}

// ------------------------------------------------------------------ ramps of the underground car park (generic in axis / top)
const RAMP_CLEAR = 2.7;      // the deck closes over the ramp once a car fits under it
const RAMP_APPROACH = 3.2;   // level stretch in front of the portal
function rampInfo(R) {
  const ax = R.axis === 'x';
  const a0 = ax ? R.x0 : R.z0, a1 = ax ? R.x1 : R.z1, c0 = ax ? R.z0 : R.x0, c1 = ax ? R.z1 : R.x1;
  const topA = R.top === 'max' ? a1 : a0, botA = R.top === 'max' ? a0 : a1, dir = Math.sign(botA - topA) || 1, len = Math.abs(botA - topA) || 1;
  const y0 = R.y0 ?? 0, y1 = R.y1 ?? -4.2;
  const yAt = a => y0 + (y1 - y0) * clamp((a - topA) * dir / len);
  const openLen = Math.min(len, len * (y0 + RAMP_CLEAR) / Math.max(0.1, y0 - y1)), endA = topA + dir * openLen, appA = topA - dir * RAMP_APPROACH;
  const P = (a, c) => (ax ? [a, c] : [c, a]);                    // (along, across) → world [x, z]
  const rect = (aa, ab, m = 0) => { const lo = Math.min(aa, ab), hi = Math.max(aa, ab); return ax ? { x0: lo, x1: hi, z0: c0 - m, z1: c1 + m } : { x0: c0 - m, x1: c1 + m, z0: lo, z1: hi }; };
  return { R, ax, topA, botA, dir, len, c0, c1, y0, y1, yAt, endA, appA, P, hole: rect(topA, endA), cut: rect(appA, endA) };
}
export const RAMP = RAMPS[0] || null;   // LEGACY (walk.js): the first ramp; new code uses RAMPS
export { RAMPS };
export const SPIRAL_DRUM = null;        // there is no spiral ramp

// ------------------------------------------------------------------ outdoor colliders (for walking & driving outside)
// Built from data.js: the four towers (thin shells along the floor-1 outline, any angle, with a gap at each lobby entrance
// and where a car-park ramp passes through the facade), the podium volumes (same, shop entrances closed), the plot's
// free-standing structures, the ramps (inclined floor, side walls, approach), the neighbours, plus a big walkable /
// drivable ground plane with a hole over the open part of every ramp. There is no fence around the plot.
// → { group, walls, gaps, holes, dispose() }; walls / gaps / holes describe what was built (debug drawings, tests).
export function buildOutdoorColliders({ extraBoxes = [], extraOnly = false, blocks = CONTEXT_BLOCKS } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-outdoor-colliders';
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  const solids = [], floors = [], walls = [], gaps = [], holes = [];
  const box = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); solids.push(g); };
  // thin oriented box a → b
  const wall = (a, b, y0, y1, t, meta) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.03 || y1 - y0 < 0.03) return;
    const g = new THREE.BoxGeometry(L, y1 - y0, t); g.rotateY(Math.atan2(-dz, dx)); g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2); solids.push(g);
    walls.push({ ...meta, a: [a[0], a[1]], b: [b[0], b[1]], y0, y1, t });
  };
  // closed outline as walls of thickness t just inside it; `discs` [[x, z, r]] and `rects` [{x0, x1, z0, z1}] stay open
  const outline = (P, y0, y1, t, meta, discs = [], rects = []) => {
    const sgn = polyArea(P) > 0 ? 1 : -1;
    for (let i = 0; i < P.length; i++) {
      const A = P[i], B = P[(i + 1) % P.length], dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz); if (L < 1e-6) continue;
      const tx = dx / L, tz = dz / L, nx = -tz * sgn, nz = tx * sgn;                      // inward normal
      const open = [];
      for (const [cx, cz, r] of discs) {                                                 // segment ∩ disc
        const s = (cx - A[0]) * tx + (cz - A[1]) * tz, d = Math.abs((cx - A[0]) * nx + (cz - A[1]) * nz); if (d >= r) continue;
        const h = Math.sqrt(r * r - d * d); if (s + h > 0 && s - h < L) open.push([s - h, s + h]);
      }
      for (const r of rects) {                                                           // segment ∩ rect (Liang–Barsky)
        let s0 = 0, s1 = L, ok = true;
        for (const [p, q] of [[-tx, A[0] - r.x0], [tx, r.x1 - A[0]], [-tz, A[1] - r.z0], [tz, r.z1 - A[1]]]) {
          if (Math.abs(p) < 1e-9) { if (q < 0) { ok = false; break; } continue; }
          const s = q / p; if (p < 0) s0 = Math.max(s0, s); else s1 = Math.min(s1, s);
        }
        if (ok && s1 - s0 > 0.02) open.push([s0, s1]);
      }
      open.sort((p, q) => p[0] - q[0]);
      const P2 = s => [A[0] + tx * s + nx * t / 2, A[1] + tz * s + nz * t / 2];
      let cur = 0;
      for (const [g0, g1] of open) { if (g0 > cur) wall(P2(cur), P2(Math.min(L, g0)), y0, y1, t, meta); cur = Math.max(cur, g1); }
      if (cur < L) wall(P2(cur), P2(L), y0, y1, t, meta);
    }
  };
  const ramps = RAMPS.map(rampInfo);
  if (!extraOnly) {
    const ent = towerEntrances(), cuts = ramps.map(r => r.cut);
    const discsFor = (P, tol, on) => {
      const out = [];
      for (const e of ent) { const [qx, qz, d] = nearestOnPoly(P, e.p[0], e.p[1]); if (d < tol) { out.push([qx, qz, 1.0]); gaps.push({ id: e.id, on, p: [qx, qz], w: 2.0, n: e.n }); } }
      return out;
    };
    // towers: floor-1 outline, 0.3 m shells 0–4 m high, ±1.0 m open at the lobby entrance
    const towers = B_IDS.map(id => ({ id, P: towerOutline(id) }));
    for (const { id, P } of towers) outline(P, 0, 4, 0.3, { kind: 'tower', id }, discsFor(P, 0.6, id), cuts);
    // podium volumes: walls along every edge up to y1; open only where a tower lobby opens through the podium wall
    for (const p of PODIUM) if (p.poly && p.poly.length > 2) outline(p.poly, p.y0 ?? 0, p.y1 ?? 4, 0.3, { kind: 'podium', id: p.id }, discsFor(p.poly, 0.9, p.id), cuts);
    // free-standing structures on the plot (transformer …); an open gazebo keeps only its posts; paving (h 0) is skipped
    for (const e of SITE_EXTRAS || []) {
      if (!e.poly || !(e.h > 0.2)) continue;
      if (e.kind === 'gazebo' || e.kind === 'pergola') { for (const [x, z] of e.poly) { box(x - 0.1, x + 0.1, 0, e.h, z - 0.1, z + 0.1); walls.push({ kind: 'extra', id: e.id, a: [x - 0.1, z], b: [x + 0.1, z], y0: 0, y1: e.h, t: 0.2 }); } }
      else outline(e.poly, 0, e.h, 0.3, { kind: 'extra', id: e.id }, [], cuts);
    }
    // ramps: inclined floor over the whole length, a short approach where the top stands above grade, side walls along the
    // open part (full height inside a tower, a parapet outside)
    const inTower = (x, z) => towers.some(t => inPoly2(t.P, x, z) || polyDist(t.P, x, z) < 0.6);
    const quad4 = (p0, p1, p2, p3) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3)); floors.push(g); };
    for (const r of ramps) {
      const V = (a, c, y) => { const [x, z] = r.P(a, c); return [x, y, z]; };
      quad4(V(r.topA, r.c0, r.y0), V(r.topA, r.c1, r.y0), V(r.botA, r.c1, r.y1), V(r.botA, r.c0, r.y1));
      if (r.y0 > 0.02) quad4(V(r.appA, r.c0, 0), V(r.appA, r.c1, 0), V(r.topA, r.c1, r.y0), V(r.topA, r.c0, r.y0));
      const aS = r.topA - r.dir * 0.7, n = Math.max(1, Math.ceil(Math.abs(r.endA - aS)));
      for (const c of [r.c0, r.c1]) for (let i = 0; i < n; i++) {
        const a = aS + (r.endA - aS) * i / n, b = aS + (r.endA - aS) * (i + 1) / n, m = r.P((a + b) / 2, c);
        wall(r.P(a, c), r.P(b, c), Math.min(0, r.yAt(a), r.yAt(b)) - 0.3, inTower(m[0], m[1]) ? 4 : 1.1, 0.25, { kind: 'ramp', id: r.R.id });
      }
      holes.push({ id: r.R.id, ...r.hole });
    }
    // neighbours: a solid box for a plain rectangle, walls along the outline otherwise; the canopy keeps its pump islands
    for (const b of blocks) {
      const h = contextHeight(b), P = b.poly || [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
      if (contextStyle(b) === 'canopy') { for (const s of canopyLayout(b).islands) wall(s.a, s.b, 0, 1.7, 0.9, { kind: 'context', id: b.id }); continue; }
      if (isRectPoly(P)) { const r = bboxOfPoly(P); box(r.x0, r.x1, 0, h, r.z0, r.z1); walls.push({ kind: 'context', id: b.id, box: r, a: [r.x0, r.z0], b: [r.x1, r.z1], y0: 0, y1: h, t: 0 }); }
      else outline(P, 0, h, 0.4, { kind: 'context', id: b.id });
    }
  }
  for (const bx of extraBoxes) box(...bx);
  // ground: ±350 m around the site centre, with one rectangular hole per ramp (its open part)
  if (!extraOnly) {
    const [cx, cz] = SITE_CENTER, X0 = cx - 350, X1 = cx + 350, Z0 = cz - 350, Z1 = cz + 350;
    const uniq = a => [...new Set(a)].sort((p, q) => p - q);
    const xs = uniq([X0, X1, ...holes.flatMap(h => [h.x0, h.x1])]), zs = uniq([Z0, Z1, ...holes.flatMap(h => [h.z0, h.z1])]), parts = [];
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const mx = (xs[i] + xs[i + 1]) / 2, mz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some(h => mx > h.x0 && mx < h.x1 && mz > h.z0 && mz < h.z1)) continue;
      const g = new THREE.PlaneGeometry(xs[i + 1] - xs[i], zs[j + 1] - zs[j]); g.rotateX(-Math.PI / 2); g.translate(mx, 0, mz); parts.push(strip(g.toNonIndexed(), ['position']));
    }
    floors.unshift(parts.length > 1 ? mergeGeometries(parts, false) : parts[0]);
  }
  // chunk the solids so proximity queries stay cheap
  const chunk = (list, flag) => {
    const cells = new Map();
    for (const g of list) { g.computeBoundingBox(); const c = g.boundingBox.getCenter(_v); const k = Math.floor(c.x / 40) + ',' + Math.floor(c.z / 40); (cells.get(k) || cells.set(k, []).get(k)).push(g); }
    for (const l of cells.values()) {
      const g = l.length > 1 ? mergeGeometries(l.map(q => strip(q.index ? q.toNonIndexed() : q, ['position'])), false) : strip(l[0], ['position']);
      g.computeBoundingBox(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.userData[flag] = true; m.userData.collider = true; m.name = 'outdoor-' + flag; group.add(m);
    }
  };
  chunk(solids, 'solid');
  for (const g of floors) { g.computeBoundingBox(); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.userData.floor = true; m.userData.collider = true; m.name = 'outdoor-floor'; group.add(m); }
  group.updateMatrixWorld(true);
  return { group, walls, gaps, holes, dispose() { group.traverse(o => o.geometry && o.geometry.dispose()); mat.dispose(); } };
}
/** There is no lake on this site (kept for walk.js): always false. */
export const inLake = () => false;

// The plot as drawn on the plans (data.js PLOT).
function sitePolys() { return [PLOT]; }
/** Is (x, z) on the site or within m metres of it (the streets that frame it)? */
export function nearPlot(x, z, m = 0) {
  for (const P of sitePolys()) if (inPoly2(P, x, z) || (m > 0 && polyDist(P, x, z) < m)) return true;
  return false;
}

// ------------------------------------------------------------------ the streets that frame the plot
const PARK_STRIP = 2.2;      // width of the kerbside parking strip on the carriageway
const plotDist = (x, z) => (inPoly2(PLOT, x, z) ? 0 : polyDist(PLOT, x, z));
// Streets of `roads` that run along the plot (data.js: вул. Грушевського, вул. Заньковецької — found by geometry, not by id):
// → [{ st, S: samples every 0.5 m beside the plot [x, z, tx, tz, s], hw, side, lat }]
//   side: 1 = cars park on the plot side (the pavement between kerb and plot is wide), −1 = on the far side;
//   lat:  +1 when that parking kerb is on the right-hand normal (−tz, tx) of the polyline direction, −1 on the left.
function framingStreets(roads = STREETS) {
  const out = [];
  for (const st of roads || []) {
    const pts = st.pts; if (!pts || pts.length < 2) continue;
    const S = []; let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      if (segDist(SITE_CENTER[0], SITE_CENTER[1], ax, az, bx, bz) < 260) for (let d = 0; d < L; d += 0.5) { const x = ax + tx * d, z = az + tz * d; if (plotDist(x, z) < 34) S.push([x, z, tx, tz, s + d]); }
      s += L;
    }
    if (S.length < 120) continue;                                             // under 60 m beside the plot: not a street that frames it
    const hw = (st.w || 6) / 2, near = S.reduce((m, q) => (plotDist(q[0], q[1]) < plotDist(m[0], m[1]) ? q : m), S[0]);
    const gap = plotDist(near[0], near[1]) - hw;                              // pavement width between kerb and plot
    const side = gap >= 6 ? 1 : -1;
    // +1 when the plot lies on the right-hand normal (−tz, tx) of the polyline direction
    const toPlot = q => (plotDist(q[0] - q[3], q[1] + q[2]) < plotDist(q[0] + q[3], q[1] - q[2]) ? 1 : -1);
    out.push({ st, S, hw, side, toPlot, near, lat: toPlot(near) * side });
  }
  return out;
}

// ------------------------------------------------------------------ parked cars of this site
// Kerbside cars on the streets that frame the plot (Hrushevskoho, Zankovetskoi): one side of each street — the plot side
// where the pavement between kerb and plot is wide, the far side otherwise — so two lanes stay free. Clear of the vehicle
// and pedestrian entrances, the junctions and the bus-stop pavilion. Plus the cars in the guest parking pockets around the
// plot (site-layout.js PARKING_POCKETS rows, when that module is there) and the cars filling up at the fuel station.
// Right-hand traffic: a parked car faces the way its lane runs. → [{x, y: 0, z, yaw, kind, colour, src, street? | pocket?}]
export function parkedStreetCars({ seed = 4242, occupancy = 0.74, slot = 6.3, blocks = CONTEXT_BLOCKS, roads = STREETS, pockets = parkingPockets() } = {}) {
  const r = rng(seed), out = [];
  const lineD = (pts, x, z) => { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; };
  const entrances = (COURTYARD && COURTYARD.entrances) || [];
  const pavilions = blocks.filter(b => b.kind === 'pavilion').map(b => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]);
  for (const { st, S, hw, side, toPlot } of framingStreets(roads)) {
    const ents = entrances.map(e => { let b = null; for (const q of S) { const d = Math.hypot(q[0] - e.p[0], q[1] - e.p[1]); if (!b || d < b[0]) b = [d, q[4]]; } return b && b[0] < 30 ? { s: b[1], m: e.kind === 'vehicle' ? 8 : 4 } : null; }).filter(Boolean);
    const others = roads.filter(o => o !== st && o.pts && o.pts.length > 1);
    let sPrev = -Infinity;
    for (const q of S) {
      if (q[4] - sPrev < slot) continue;
      const lat = toPlot(q) * side, nx = -q[3] * lat, nz = q[2] * lat;         // unit vector towards the chosen kerb
      const x = q[0] + nx * (hw - PARK_STRIP / 2 - 0.02), z = q[1] + nz * (hw - PARK_STRIP / 2 - 0.02);
      if (!nearPlot(x, z, 15.5) || plotDist(x, z) < 2) continue;
      if (ents.some(e => Math.abs(q[4] - e.s) < e.m)) continue;
      if (others.some(o => lineD(o.pts, x, z) < (o.w || 6) / 2 + 9)) continue;
      if (pavilions.some(p => Math.hypot(x - p[0], z - p[1]) < 13)) continue;
      if (blocks.some(b => b.poly && (inPoly2(b.poly, x, z) || polyDist(b.poly, x, z) < 1.6))) continue;
      sPrev = q[4];
      if (hashStr(st.id + ':' + out.length + ':' + Math.round(q[4]) + ':' + seed) / 4294967296 > occupancy) continue;
      // the kerb is on the right of a parked car (right of heading d is (−dz, dx)) → it faces along the polyline when lat = 1
      const dx = q[2] * lat, dz = q[3] * lat;
      out.push({ x: x + (r() - 0.5) * 0.12, y: 0, z: z + (r() - 0.5) * 0.12, yaw: Math.atan2(dx, dz) + (r() - 0.5) * 0.04, ...pickCar(r), deck: false, src: 'street', street: st.id });
    }
  }
  // guest parking pockets: rows of bays {from, to, n, bay: [w, d], dir: nose direction}; a bay touching a building stays empty
  for (const pk of pockets || []) for (const row of pk.rows || []) {
    const n = row.n | 0; if (n < 1 || !row.from || !row.to) continue;
    const [fx, fz] = row.from, [tx, tz] = row.to, d = row.dir || [1, 0], dl = Math.hypot(d[0], d[1]) || 1, ux = d[0] / dl, uz = d[1] / dl;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, x = fx + (tx - fx) * f, z = fz + (tz - fz) * f;
      if (hashStr(pk.id + ':' + i + ':' + seed) / 4294967296 > occupancy) continue;
      if (blocks.some(b => b.poly && [[0, 0], [2.6, 1], [2.6, -1], [-2.6, 1], [-2.6, -1]].some(([a, c]) => inPoly2(b.poly, x + ux * a - uz * c, z + uz * a + ux * c)))) continue;
      out.push({ x: x + (r() - 0.5) * 0.1, y: 0, z: z + (r() - 0.5) * 0.1, yaw: Math.atan2(ux, uz) + (r() - 0.5) * 0.03 + (r() < 0.2 ? Math.PI : 0), ...pickCar(r), deck: false, src: 'pocket', pocket: pk.id });
    }
  }
  for (const b of blocks) if (contextStyle(b) === 'canopy') {
    const cars = canopyLayout(b).cars; if (!cars.length) continue;
    const pick = new Set([Math.floor(r() * cars.length), Math.floor(r() * cars.length)]);
    for (const i of pick) out.push({ x: cars[i].x, y: 0, z: cars[i].z, yaw: cars[i].yaw, ...pickCar(r), deck: false, src: 'fuel' });
  }
  return out;
}

// ------------------------------------------------------------------ moving traffic on the streets that frame the plot
// Lane centre lines for right-hand traffic: one per direction on each framing street (вул. Грушевського, вул. Заньковецької),
// following the street polyline inside `radius` of the site. The two lanes share the carriageway left free by the kerbside
// parking strip (parkedStreetCars), so a moving car never touches a parked one.
// → [{ id, street, dir: 1 | −1 (along / against the polyline), order, w, off, pts: [[x, z], …], cum, L }]
export function trafficPaths({ roads = STREETS, radius = 330, center = SITE_CENTER, step = 3 } = {}) {
  const out = [];
  framingStreets(roads).forEach(({ st, lat, near }, order) => {
    const w = st.w || 6, pts = st.pts, C = [];
    for (let i = 0; i + 1 < pts.length; i++) {                                 // centre line, resampled
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue;
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) C.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
      if (i + 2 === pts.length) C.push([bx, bz]);
    }
    // the run inside the radius that passes the plot
    let k0 = 0, bd = Infinity; C.forEach((c, i) => { const d = Math.hypot(c[0] - near[0], c[1] - near[1]); if (d < bd) { bd = d; k0 = i; } });
    const inside = c => Math.hypot(c[0] - center[0], c[1] - center[1]) < radius - 8;
    if (!inside(C[k0])) return;
    let a = k0, b = k0; while (a > 0 && inside(C[a - 1])) a--; while (b + 1 < C.length && inside(C[b + 1])) b++;
    const run = C.slice(a, b + 1); if (run.length < 4) return;
    const free = Math.max(5.2, w - PARK_STRIP), c0 = -lat * (w - free) / 2;   // centre of the free carriageway, along the right-hand normal
    for (const dir of [1, -1]) {
      const off = c0 + dir * free / 4, P = run.map((c, i) => {
        const p = run[Math.max(0, i - 1)], q = run[Math.min(run.length - 1, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        return [c[0] - (q[1] - p[1]) / l * off, c[1] + (q[0] - p[0]) / l * off];
      });
      if (dir < 0) P.reverse();
      const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      out.push({ id: st.id + (dir > 0 ? ':a' : ':b'), street: st.id, dir, order, w, off, pts: P, cum, L: cum[cum.length - 1] });
    }
  });
  return out;
}
// Cars driving along trafficPaths(): each keeps its lane and its distance to the car ahead; where two streets cross, the
// cars of the later street in the list give way (a simulation rule, not a statement about the real junction).
// They are scenery: far models (2 draw calls per model), no colliders, head / tail light points after dusk.
// → { group, cars: [{x, y, z, yaw, kind, colour, path, s, v}], paths, update(dt), setMode(mode), dispose() }
export function createTraffic({ paths = trafficPaths(), density = 1 / 90, count = null, seed = 911, shadows = false, speed = [8.5, 12.5] } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-traffic';
  const r = rng(seed), cars = [], total = paths.reduce((m, p) => m + p.L, 0) || 1;
  paths.forEach((p, pi) => {
    const n = count != null ? Math.round(count * p.L / total) : Math.max(1, Math.round(p.L * density));
    for (let i = 0; i < n; i++) { const v0 = speed[0] + r() * (speed[1] - speed[0]); cars.push({ x: 0, y: 0, z: 0, yaw: 0, ...pickCar(r), path: pi, s: (i + 0.15 + 0.7 * r()) / n * p.L, v: v0, v0, k: 0, go: false }); }
  });
  // crossings of lanes of different streets → per path [{s, other, so}]
  const conf = paths.map(() => []);
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const A = paths[i], B = paths[j]; if (A.street === B.street) continue;
    for (let a = 0; a + 1 < A.pts.length; a++) for (let b = 0; b + 1 < B.pts.length; b++) {
      const [x1, z1] = A.pts[a], [x2, z2] = A.pts[a + 1], [x3, z3] = B.pts[b], [x4, z4] = B.pts[b + 1];
      if (Math.max(x1, x2) < Math.min(x3, x4) || Math.max(x3, x4) < Math.min(x1, x2) || Math.max(z1, z2) < Math.min(z3, z4) || Math.max(z3, z4) < Math.min(z1, z2)) continue;
      const d = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3); if (Math.abs(d) < 1e-9) continue;
      const t = ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / d, u = ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / d;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      const sa = A.cum[a] + (A.cum[a + 1] - A.cum[a]) * t, sb = B.cum[b] + (B.cum[b + 1] - B.cum[b]) * u;
      conf[i].push({ s: sa, other: j, so: sb }); conf[j].push({ s: sb, other: i, so: sa });
    }
  }
  const stopS = paths.map((p, i) => { const c = conf[i].filter(q => paths[q.other].order < p.order); return c.length ? Math.min(...c.map(q => q.s)) - 8 : null; });
  const place = c => {
    const p = paths[c.path], s = clamp(c.s, 0, p.L); let k = Math.min(c.k, p.cum.length - 2);
    while (k > 0 && p.cum[k] > s) k--; while (k < p.cum.length - 2 && p.cum[k + 1] < s) k++;
    c.k = k;
    const a = p.pts[k], b = p.pts[k + 1], l = p.cum[k + 1] - p.cum[k] || 1, f = (s - p.cum[k]) / l;
    c.x = a[0] + (b[0] - a[0]) * f; c.z = a[1] + (b[1] - a[1]) * f;
    // heading blended over the neighbouring segments so the car turns smoothly through the vertices
    const q = p.pts[Math.min(p.pts.length - 1, k + 2)], o = p.pts[Math.max(0, k - 1)], g = f, hx = (b[0] - a[0]) * (1 - Math.abs(g - 0.5)) + (g > 0.5 ? q[0] - b[0] : a[0] - o[0]) * Math.abs(g - 0.5), hz = (b[1] - a[1]) * (1 - Math.abs(g - 0.5)) + (g > 0.5 ? q[1] - b[1] : a[1] - o[1]) * Math.abs(g - 0.5);
    c.yaw = Math.atan2(hx, hz);
  };
  cars.forEach(place);
  const inst = cars.length ? createCarInstances(cars, { shadows }) : null;
  if (inst) { inst.group.name = 'vrc-traffic-cars'; group.add(inst.group); }
  // head (warm white) and tail (red) lights
  let lights = null, lp = null, tex = null;
  if (cars.length && typeof document !== 'undefined') {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(cv);
    lp = new Float32Array(cars.length * 12); const lc = new Float32Array(cars.length * 12);
    cars.forEach((_, i) => lc.set([1, 0.92, 0.8, 1, 0.92, 0.8, 1, 0.08, 0.04, 1, 0.08, 0.04], i * 12));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    lights = new THREE.Points(lg, new THREE.PointsMaterial({ size: 1.5, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    lights.name = 'vrc-traffic-lights'; lights.frustumCulled = false; lights.visible = false; group.add(lights);
  }
  const sync = () => {
    if (inst) inst.update();
    if (lights) {
      cars.forEach((c, i) => {
        const S = carSpec(c.kind), fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx, hw = S.W / 2 - 0.28;
        const ax = c.x + fx * (S.zF - 0.05), az = c.z + fz * (S.zF - 0.05), bx = c.x + fx * (S.zR + 0.05), bz = c.z + fz * (S.zR + 0.05);
        lp.set([ax + rx * hw, 0.68, az + rz * hw, ax - rx * hw, 0.68, az - rz * hw, bx + rx * hw, 0.86, bz + rz * hw, bx - rx * hw, 0.86, bz - rz * hw], i * 12);
      });
      lights.geometry.attributes.position.needsUpdate = true;
    }
  };
  sync();
  const byPath = paths.map((_, i) => cars.filter(c => c.path === i));
  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi], list = byPath[pi].sort((a, b) => a.s - b.s), ss = stopS[pi];
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i], lead = list[i + 1];
        let gap = lead ? lead.s - c.s - 6.2 : Infinity;                      // bumper-to-bumper distance kept: ≈ 1.2 m + braking room
        if (ss != null && c.s <= ss + 0.5 && c.s > ss - 45) {
          // give way: stop at the line while a car of the other street is at or near the crossing
          const busy = conf[pi].some(q => paths[q.other].order < p.order && byPath[q.other].some(o => o.s > q.so - 46 && o.s < q.so + 9));
          if (busy) gap = Math.min(gap, ss - c.s);
        }
        const vt = Math.min(c.v0, Math.sqrt(2 * 2.4 * Math.max(0, gap)));
        c.v += clamp(vt - c.v, -7 * dt, 3 * dt);
        if (c.v < 0.02 && vt === 0) c.v = 0;
        c.s += c.v * dt;
        if (lead && c.s > lead.s - 5.2) c.s = lead.s - 5.2;
        if (c.s > p.L) { c.s = p.L; c.v = Math.min(c.v, 2); }
      }
      // the front car leaves at the end of the lane and comes back in at its start once there is room
      const head = list[list.length - 1];
      if (head && head.s >= p.L && (list[0] === head || list[0].s > 16)) { head.s = 0; head.k = 0; head.v = head.v0 * 0.8; }
      for (const c of list) place(c);
    }
    sync();
  }
  return {
    group, cars, paths, conflicts: conf, update,
    setMode(m) { if (lights) lights.visible = m === 'dusk' || m === 'night'; },
    dispose() { if (inst) inst.dispose(); if (lights) { lights.geometry.dispose(); lights.material.dispose(); } if (tex) tex.dispose(); group.parent?.remove(group); },
  };
}
/** Cars for a list of parking bays [{x, y?, z, yaw}] (world; yaw = heading of a car standing in the bay), seeded:
 *  the same record shape commons-parking returns as `parkedCars` and fleet.add() takes. */
export function carsForBays(bays, { occupancy = 0.7, seed = 155, y = RAMPS[0]?.y1 ?? -4.2 } = {}) {
  const r = rng(seed), out = [];
  for (const b of bays) { if (r() > occupancy) { r(); r(); continue; } out.push({ x: b.x, y: b.y ?? y, z: b.z, yaw: b.yaw + (r() < 0.25 ? Math.PI : 0), ...pickCar(r) }); }
  return out;
}

// ------------------------------------------------------------------ where a car may go above ground
// The streets (data.js STREETS — Hrushevskoho, Zankovetskoi and the district around them — plus every street the
// environment paves: its 'road-strips' mesh, one quad per segment, each lengthened a little so that cut pieces meet),
// widened by the pavement, out to `radius` from the site centre; on the plot only the two driveways that lead from the
// streets to the car-park ramps, the ramps themselves and their approaches (the courtyard is car-free); the paved
// forecourt of the fuel station; the guest parking pockets of site-layout.js with a way in from their street.
// Houses and gardens stay out of bounds. 1 m raster → O(1) test.
// `margin` is used only when the data has no driveways: then the whole plot, dilated by it, is drivable.
export function createDriveArea(envGroup, { margin = 14, sidewalk = 2.2, extend = 22, radius = 330, center = SITE_CENTER, lane = 1.6, pockets = parkingPockets(), blocks = CONTEXT_BLOCKS } = {}) {
  const X0 = center[0] - radius - 40, Z0 = center[1] - radius - 40, N = Math.ceil(2 * (radius + 40));
  const grid = new Uint8Array(N * N);
  const cell = (x, z) => { const i = Math.floor(x - X0), j = Math.floor(z - Z0); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  const fillPoly = (P, m) => {
    const b = bboxOfPoly(P);
    for (let z = Math.floor(b.z0 - m); z <= b.z1 + m; z++) for (let x = Math.floor(b.x0 - m); x <= b.x1 + m; x++) {
      const k = cell(x + 0.5, z + 0.5); if (k < 0 || grid[k]) continue;
      if (inPoly2(P, x + 0.5, z + 0.5) || (m > 0 && polyDist(P, x + 0.5, z + 0.5) < m)) grid[k] = 1;
    }
  };
  const fillSeg = (sx, sz, ex, ez, hw) => {
    for (let z = Math.floor(Math.min(sz, ez) - hw); z <= Math.max(sz, ez) + hw; z++) for (let x = Math.floor(Math.min(sx, ex) - hw); x <= Math.max(sx, ex) + hw; x++) {
      const k = cell(x + 0.5, z + 0.5); if (k < 0 || grid[k]) continue;
      if (segDist(x + 0.5, z + 0.5, sx, sz, ex, ez) < hw && Math.hypot(x + 0.5 - center[0], z + 0.5 - center[1]) < radius) grid[k] = 1;
    }
  };
  // the site
  const drives = ((COURTYARD && COURTYARD.driveways) || []).filter(d => d.poly && d.poly.length > 2);
  if (drives.length) for (const d of drives) fillPoly(d.poly, lane);
  else for (const P of sitePolys()) fillPoly(P, margin);
  for (const R of RAMPS) { const q = rampInfo(R).cut; fillPoly([[q.x0, q.z0], [q.x1, q.z0], [q.x1, q.z1], [q.x0, q.z1]], 0.6); }   // approach + open part; further down walk.js takes over (y < −1)
  for (const e of SITE_EXTRAS || []) if (e.kind === 'paved' && e.poly) fillPoly(e.poly, 0);
  // guest parking pockets beside the streets: the paved court + a way in from its street at both ends (clear of buildings)
  for (const pk of pockets || []) {
    if (!pk.poly || pk.poly.length < 3 || !(pk.rows && pk.rows.length)) continue;
    fillPoly(pk.poly, 0);
    const st = STREETS.find(q => q.id === pk.access); if (!st || !st.pts) continue;
    const links = [];
    for (const [x, z] of pk.poly) {
      let best = null, s = 0;
      for (let i = 0; i + 1 < st.pts.length; i++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
        if (!best || d < best.d) best = { d, q: [qx, qz], s: s + Math.sqrt(L2) * t };
        s += Math.sqrt(L2);
      }
      if (!best || best.d > 45) continue;
      let free = true;
      for (let k = 0; k <= 12 && free; k++) { const px = x + (best.q[0] - x) * k / 12, pz = z + (best.q[1] - z) * k / 12; if (blocks.some(b => b.poly && (inPoly2(b.poly, px, pz) || polyDist(b.poly, px, pz) < 3.4))) free = false; }
      if (free) links.push({ p: [x, z], ...best });
    }
    if (!links.length) continue;
    links.sort((a, b) => a.s - b.s);
    for (const l of new Set([links[0], links[links.length - 1]])) fillSeg(l.p[0], l.p[1], l.q[0], l.q[1], 3.2);
  }
  // the streets of data.js
  for (const st of STREETS) {
    const pts = st.pts || [], hw = (st.w || 6) / 2 + sidewalk;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      if (segDist(center[0], center[1], ax, az, bx, bz) > radius + hw) continue;
      fillSeg(ax, az, bx, bz, hw);
    }
  }
  // street quads of the environment
  const strips = envGroup && envGroup.getObjectByName && envGroup.getObjectByName('road-strips');
  if (strips && strips.geometry && strips.geometry.attributes.position) {
    const p = strips.geometry.attributes.position;
    for (let q = 0; q + 3 < p.count; q += 4) {
      // quad: p+n, p−n, q−n, q+n → centre line a→b and half width
      const ax = (p.getX(q) + p.getX(q + 1)) / 2, az = (p.getZ(q) + p.getZ(q + 1)) / 2, bx = (p.getX(q + 2) + p.getX(q + 3)) / 2, bz = (p.getZ(q + 2) + p.getZ(q + 3)) / 2;
      const hw = Math.hypot(p.getX(q) - p.getX(q + 1), p.getZ(q) - p.getZ(q + 1)) / 2 + sidewalk;
      if (Math.hypot((ax + bx) / 2 - center[0], (az + bz) / 2 - center[1]) > radius) continue;
      const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
      // the lengthening only counts inside the radius (no driving off into the suburbs along a cut street)
      fillSeg(ax - ux * extend, az - uz * extend, bx + ux * extend, bz + uz * extend, hw);
    }
  }
  return {
    test(x, z) { const k = cell(x, z); return k >= 0 && grid[k] === 1; },
    grid, origin: [X0, Z0], size: N, center: [center[0], center[1]], radius,
  };
}

// ------------------------------------------------------------------ fleet: every drivable car, LOD-managed
// Records {id, kind, colour, x, y, z, yaw, src}. Near the camera the closest cars are detailed createCar()s,
// the rest are drawn as instances; underground cars are only drawn when the camera is below grade (or at the ramp).
export function createFleet({ maxDetailed = 6, detailRadius = 30, farRadius = 230, midRadius = 40, maxMid = 14, underRadius = 75 } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-fleet';
  const colliders = new THREE.Group(); colliders.name = 'vrc-fleet-colliders'; colliders.visible = false; group.add(colliders);
  const colMat = new THREE.MeshBasicMaterial({ visible: false });
  const colGeo = {};
  const records = [], sources = new Set(), MS = shared();
  const detailed = new Map();   // id → car
  const inst = {};              // kind → {p, r, cap}
  let dirty = true, lastCam = new THREE.Vector3(1e9, 0, 0), lastT = 0, active = new Set(), focus = null;
  const col = new THREE.Color();
  function colliderFor(rec) {
    const S = carSpec(rec.kind);
    if (!colGeo[rec.kind]) { const g = new THREE.BoxGeometry(S.W - 0.04, 1.35, S.L - 0.06); g.translate(0, 0.72, (S.zF + S.zR) / 2); colGeo[rec.kind] = g; }
    const m = new THREE.Mesh(colGeo[rec.kind], colMat); m.userData.solid = true; m.userData.carId = rec.id; m.name = 'car-collider';
    colliders.add(m); return m;
  }
  function place(rec) {
    const c = rec.collider; c.position.set(rec.x, rec.y, rec.z); c.rotation.set(0, rec.yaw, 0); c.updateMatrix(); c.updateMatrixWorld(true);
  }
  // footprint overlap of two parked cars (2-D separating axes, 5 cm clearance)
  const corners = (kind, x, z, yaw) => { const S = carSpec(kind), c = Math.cos(yaw), s = Math.sin(yaw), m = 0.025; return [[S.W / 2 + m, S.zF + m], [-S.W / 2 - m, S.zF + m], [-S.W / 2 - m, S.zR - m], [S.W / 2 + m, S.zR - m]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]); };
  const sat = (A, B) => {
    for (const P of [A, B]) for (let i = 0; i < 4; i++) {
      const nx = P[(i + 1) % 4][1] - P[i][1], nz = P[i][0] - P[(i + 1) % 4][0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of A) { const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const [x, z] of B) { const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 < b0 || b1 < a0) return false;
    }
    return true;
  };
  const clashes = (kind, x, y, z, yaw) => {
    const A = corners(kind, x, z, yaw);
    for (const r of records) if (Math.abs(r.y - y) < 1.5 && Math.abs(r.x - x) < 7 && Math.abs(r.z - z) < 7 && sat(A, corners(r.kind, r.x, r.z, r.yaw))) return true;
    return false;
  };
  // add parked cars; a car that would overlap one already there is nudged along its own axis (≤ 35 cm) or left out,
  // and `accept(c)` may veto a spot (e.g. one inside a wall). Returns the added records (rec.index = index in `list`).
  function add(list, src, accept = null) {
    if (src && sources.has(src)) return [];
    if (src) sources.add(src);
    const out = [];
    list.forEach((c, index) => {
      const kind = SPECS[c.kind] ? c.kind : 'sedan', fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      let x = c.x, z = c.z, ok = false;
      for (const d of [0, 0.15, -0.15, 0.35, -0.35]) { x = c.x + fx * d; z = c.z + fz * d; if (!clashes(kind, x, c.y, z, c.yaw) && (!accept || accept({ ...c, kind, x, z }))) { ok = true; break; } }
      if (!ok) return;
      const rec = { id: (src || 'car') + ':' + records.length, kind, colour: c.colour || 'black', x, y: c.y, z, yaw: c.yaw, pitch: 0, src, index };
      rec.collider = colliderFor(rec); place(rec); records.push(rec); out.push(rec);
    });
    dirty = true; return out;
  }
  function ensureInst(key, need) {   // key = kind + ':mid' | ':far'
    const I = inst[key];
    if (I && I.cap >= need) return I;
    if (I) { group.remove(I.p, I.r); I.p.dispose(); I.r.dispose(); }
    const [kind, tier] = key.split(':'), G = tier === 'mid' ? kindGeometry(kind, true) : farGeometry(kind), cap = Math.max(8, Math.ceil(need * 1.3));
    const p = new THREE.InstancedMesh(G.paint, tier === 'mid' ? MS.lodPaint : MS.farPaint, cap), r = new THREE.InstancedMesh(G.rest, MS.lodRest, cap);
    p.name = 'fleet-' + key + '-paint'; r.name = 'fleet-' + key + '-rest';
    p.setColorAt(0, col.set('#fff')); p.count = r.count = 0;
    group.add(p, r); return (inst[key] = { p, r, cap });
  }
  const underground = rec => rec.y < -1.2;
  const nearRamp = p => RAMPS.some(R => p.x > R.x0 - 30 && p.x < R.x1 + 30 && p.z > R.z0 - 30 && p.z < R.z1 + 30);
  function update(camera, force = false) {
    const cp = camera.getWorldPosition(_v).clone();
    const now = performance.now();
    if (!force && !dirty && now - lastT < 280 && cp.distanceToSquared(lastCam) < 4) return;
    lastT = now; lastCam.copy(cp);
    const camUnder = cp.y < -0.4, ramp = nearRamp(cp);
    const vis = [];
    for (const r of records) {
      const u = underground(r);
      if (u && !camUnder && !ramp && r !== focus) continue;
      if (!u && camUnder && !ramp && r !== focus) continue;
      const d = Math.hypot(r.x - cp.x, r.y - cp.y, r.z - cp.z);
      if (d > (u ? underRadius : farRadius) && r !== focus) continue;
      vis.push([d, r]);
    }
    vis.sort((a, b) => a[0] - b[0]);
    const want = new Set();
    if (focus) want.add(focus);
    // detailed models go to the nearest cars the camera is looking at (those behind it count as three times as far)
    const fwd = camera.getWorldDirection(_v);
    const det = vis.filter(([d]) => d < detailRadius).map(([d, r]) => [d > 3 && ((r.x - cp.x) * fwd.x + (r.y + 0.7 - cp.y) * fwd.y + (r.z - cp.z) * fwd.z) < d * 0.3 ? d * 3 : d, r]).sort((a, b) => a[0] - b[0]);
    for (const [d, r] of det) { if (want.size >= maxDetailed || d > detailRadius) break; want.add(r); }
    // detailed cars
    for (const [id, car] of detailed) if (![...want].some(r => r.id === id)) { car.group.visible = false; }
    for (const r of want) {
      let car = detailed.get(r.id);
      if (!car) { car = createCar(r.kind, r.colour, { interior: hashStr(r.id) % INTERIORS.length, plate: hashStr(r.id + '#') % PLATES.n }); detailed.set(r.id, car); group.add(car.group); car.setLights(false); }
      car.group.visible = true; syncCar(r, car);
    }
    // evict stale detailed cars
    if (detailed.size > maxDetailed * 3) for (const [id, car] of detailed) if (!car.group.visible) { car.dispose(); detailed.delete(id); if (detailed.size <= maxDetailed * 2) break; }
    active = want;
    // instances
    const per = {}; let mid = 0;
    for (const [d, r] of vis) if (!want.has(r)) { const t = d < midRadius && mid < maxMid ? (mid++, 'mid') : 'far'; (per[r.kind + ':' + t] ||= []).push(r); }
    for (const kind of Object.keys({ ...inst, ...per })) {
      const list = per[kind] || [];
      const I = ensureInst(kind, list.length);
      list.forEach((r, k) => {
        _m.compose(_v.set(r.x, r.y, r.z), _q.setFromEuler(_e.set(-(r.pitch || 0), r.yaw, 0, 'YXZ')), _s1);
        I.p.setMatrixAt(k, _m); I.r.setMatrixAt(k, _m); I.p.setColorAt(k, col.set(CAR_COLOURS[r.colour] || r.colour));
      });
      I.p.count = I.r.count = list.length;
      I.p.instanceMatrix.needsUpdate = I.r.instanceMatrix.needsUpdate = true;
      if (I.p.instanceColor) I.p.instanceColor.needsUpdate = true;
      if (list.length) { I.p.computeBoundingSphere(); I.r.computeBoundingSphere(); }
      I.p.visible = I.r.visible = list.length > 0;
    }
    dirty = false;
  }
  function syncCar(r, car) {
    car.group.position.set(r.x, r.y, r.z);
    car.group.rotation.set(-(r.pitch || 0), r.yaw, r.roll || 0, 'YXZ');
    car.group.updateMatrixWorld(true);
  }
  // ray vs car boxes (OBB) → {rec, distance}
  function raycast(ray, far = 15) {
    let best = null;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const r of records) {
      const dx = r.x - ray.origin.x, dz = r.z - ray.origin.z; if (dx * dx + dz * dz > (far + 4) ** 2) continue;
      if (Math.abs(r.y - ray.origin.y) > 6) continue;
      const S = carSpec(r.kind), c = Math.cos(-r.yaw), s = Math.sin(-r.yaw);
      const ox = ray.origin.x - r.x, oy = ray.origin.y - r.y, oz = ray.origin.z - r.z;
      o.set(ox * c + oz * s, oy, -ox * s + oz * c);
      d.set(ray.direction.x * c + ray.direction.z * s, ray.direction.y, -ray.direction.x * s + ray.direction.z * c);
      const mn = [-S.W / 2, 0.1, S.zR], mx = [S.W / 2, S.roof, S.zF], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      let t0 = 0, t1 = far;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < mn[k] || oo[k] > mx[k]) { t0 = Infinity; break; } continue; }
        let a = (mn[k] - oo[k]) / dd[k], b = (mx[k] - oo[k]) / dd[k]; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 < far && (!best || t0 < best.distance)) best = { rec: r, distance: t0 };
    }
    return best;
  }
  // distance from p (world) to the car's footprint rectangle
  function distTo(r, p) {
    const S = carSpec(r.kind), c = Math.cos(-r.yaw), s = Math.sin(-r.yaw), ox = p.x - r.x, oz = p.z - r.z;
    const lx = ox * c + oz * s, lz = -ox * s + oz * c;
    const qx = Math.max(Math.abs(lx) - S.W / 2, 0), qz = Math.max(lz - S.zF, S.zR - lz, 0);
    return Math.hypot(qx, qz);
  }
  function nearest(p, maxD = 2) {
    let best = null;
    for (const r of records) { if (Math.abs(r.y - p.y) > 1.2) continue; const d = distTo(r, p); if (d < maxD && (!best || d < best.d)) best = { rec: r, d }; }
    return best;
  }
  return {
    group, colliders, records, add, update, raycast, nearest, distTo,
    carOf(rec) { return detailed.get(rec.id) || null; },
    setFocus(rec) { focus = rec; dirty = true; },
    moved(rec) { place(rec); const car = detailed.get(rec.id); if (car) syncCar(rec, car); dirty = true; },
    markDirty() { dirty = true; },
    get active() { return active; },
    dispose() {
      for (const car of detailed.values()) car.dispose();
      for (const I of Object.values(inst)) { I.p.dispose(); I.r.dispose(); }
      for (const g of Object.values(colGeo)) g.dispose();
      colMat.dispose(); group.parent?.remove(group);
    },
  };
}
