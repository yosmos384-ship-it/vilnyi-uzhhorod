// ЖК VILNYI (Ужгород) — the neighbours of the complex (T20).
// Simple massing from data.js CONTEXT_BLOCKS (world polygons): 5- and 9-storey Soviet-era slabs (silicate brick with
// balconies, panel blocks with loggias), private houses and small 1–2-storey buildings with hipped roofs, low shops and
// kiosks, sheds, ruins of the old works, the fuel station (shop + canopy with pump islands) — plus the cars parked
// along the two streets that frame the plot.
// Facades are one quad per bay carrying a cell of a procedural atlas (colour + roughness/metalness + two emissive
// "lit window" maps, dusk and night, swapped by setMode); everything else (plinths, parapets, balconies, roofs, canopy)
// is one vertex-coloured mesh. About 12 draw calls + the car instances. Works with 0…n blocks.
// Moving traffic on the two framing streets (cars.js createTraffic) is started on the first update() — by default only
// when the scene this group sits in has no traffic of its own (environment.js adds a mesh named 'traffic').
import * as THREE from 'three';
import { CONTEXT_BLOCKS } from '../data.js';
import { createCarInstances, parkedStreetCars, createTraffic, contextStyle, contextHeight, canopyLayout } from './cars.js';

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const _col = new THREE.Color(), _cc = new Map();
function C(hex, k = 1) {   // linear rgb triple of an sRGB hex colour
  let c = _cc.get(hex); if (!c) { _col.set(hex); c = [_col.r, _col.g, _col.b]; _cc.set(hex, c); }
  return k === 1 ? c : [c[0] * k, c[1] * k, c[2] * k];
}
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const polyArea = P => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return a / 2; };
const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };

// ------------------------------------------------------------------ geometry buffer (non-indexed: position, normal, colour, optional uv)
class Buf {
  constructor(uv = false) { this.p = []; this.n = []; this.c = []; this.uv = uv ? [] : null; }
  tri(a, b, c, col, ua, ub, uc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
    if (this.uv) this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  // quad a, b, c, d (in order round the face); `out` = a direction the face must look to (winding is fixed accordingly)
  quad(a, b, c, d, col, out, uvs) {
    if (out) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      if ((uy * vz - uz * vy) * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * out[2] < 0) { [b, d] = [d, b]; if (uvs) uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]; }
    }
    if (uvs) { this.tri(a, b, c, col, uvs[0], uvs[1], uvs[2]); this.tri(a, c, d, col, uvs[0], uvs[2], uvs[3]); }
    else { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  }
  // box on a wall: A = wall start, t = along the wall, n = outward; s ∈ [s0, s1] along, d ∈ [d0, d1] outward, y ∈ [y0, y1]
  box(A, t, n, s0, s1, d0, d1, y0, y1, col, k = 1) {
    const P = (s, d, y) => [A[0] + t[0] * s + n[0] * d, y, A[1] + t[1] * s + n[1] * d];
    const c = k === 1 ? col : [col[0] * k, col[1] * k, col[2] * k];
    const T = [t[0], 0, t[1]], N = [n[0], 0, n[1]], neg = v => [-v[0], -v[1], -v[2]];
    this.quad(P(s0, d1, y0), P(s1, d1, y0), P(s1, d1, y1), P(s0, d1, y1), c, N);
    this.quad(P(s0, d0, y0), P(s1, d0, y0), P(s1, d0, y1), P(s0, d0, y1), c, neg(N));
    this.quad(P(s1, d0, y0), P(s1, d1, y0), P(s1, d1, y1), P(s1, d0, y1), c, T);
    this.quad(P(s0, d0, y0), P(s0, d1, y0), P(s0, d1, y1), P(s0, d0, y1), c, neg(T));
    this.quad(P(s0, d0, y1), P(s1, d0, y1), P(s1, d1, y1), P(s0, d1, y1), c, [0, 1, 0]);
    this.quad(P(s0, d0, y0), P(s1, d0, y0), P(s1, d1, y0), P(s0, d1, y0), c, [0, -1, 0]);
  }
  // axis-aligned box
  abox(x0, x1, y0, y1, z0, z1, col, k = 1) { this.box([x0, z0], [1, 0], [0, 1], 0, x1 - x0, 0, z1 - z0, y0, y1, col, k); }
  get count() { return this.p.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
}

// ------------------------------------------------------------------ polygons
// Walls of a polygon: [{a, b, len, t, n (outward)}], ordered so that the face of a→b quad looks outwards.
function wallsOf(P0) {
  const P = polyArea(P0) > 0 ? [...P0].reverse() : P0, out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 0.05) continue;
    out.push({ a, b, len, t: [dx / len, dz / len], n: [-dz / len, dx / len] });
  }
  return out;
}
function offsetPoly(P, d) {   // outward offset by d (mitred, mitre capped)
  const sgn = polyArea(P) > 0 ? 1 : -1, n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = P[(i + n - 1) % n], c = P[i], q = P[(i + 1) % n];
    let ax = c[0] - p[0], az = c[1] - p[1], bx = q[0] - c[0], bz = q[1] - c[1]; const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    let mx = (az + bz) * sgn, mz = -(ax + bx) * sgn; const lm = Math.hypot(mx, mz);
    if (lm < 1e-6) { mx = az * sgn; mz = -ax * sgn; } else { mx /= lm; mz /= lm; }
    const cos = Math.max(0.45, mx * az * sgn - mz * ax * sgn);
    out.push([c[0] + mx * d / cos, c[1] + mz * d / cos]);
  }
  return out;
}
function longAxis(P) {   // direction of the longest edge + extents of the polygon in that frame
  let L = 0, ux = 1, uz = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const dx = P[i][0] - P[j][0], dz = P[i][1] - P[j][1], l = Math.hypot(dx, dz); if (l > L) { L = l; ux = dx / l; uz = dz / l; } }
  const vx = -uz, vz = ux; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of P) { const u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return { ux, uz, vx, vz, u0, u1, v0, v1, W: (u, v) => [u * ux + v * vx, u * uz + v * vz] };
}
function flatRoof(buf, P, y, col, uvScale = 0) {
  const tris = THREE.ShapeUtils.triangulateShape(P.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [i, j, k] of tris) {
    let a = [P[i][0], y, P[i][1]], b = [P[j][0], y, P[j][1]], c = [P[k][0], y, P[k][1]];
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, c] = [c, b];   // normal up
    if (uvScale) buf.tri(a, b, c, col, [a[0] / uvScale, a[2] / uvScale], [b[0] / uvScale, b[2] / uvScale], [c[0] / uvScale, c[2] / uvScale]);
    else buf.tri(a, b, c, col);
  }
}
// Hipped roof over any outline: eaves 0.45 m out, every eaves point runs up to the nearest point of the ridge.
function hipRoof(buf, P, yE, col, colDark) {
  const E = offsetPoly(P, 0.45), A = longAxis(P), halfW = (A.v1 - A.v0) / 2, vm = (A.v0 + A.v1) / 2;
  let ua = A.u0 + halfW * 0.9, ub = A.u1 - halfW * 0.9; if (ub < ua) ua = ub = (A.u0 + A.u1) / 2;
  const rise = Math.min(4.4, Math.max(1.4, halfW * 0.62)), yR = yE + rise;
  const R = E.map(([x, z]) => { const u = Math.max(ua, Math.min(ub, x * A.ux + z * A.uz)), [rx, rz] = A.W(u, vm); return [rx, yR, rz]; });
  const up = (a, b, c, k) => { const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); if (ny < 0) [b, c] = [c, b]; buf.tri(a, b, c, k); };
  for (let i = 0; i < E.length; i++) {
    const j = (i + 1) % E.length, a = [E[i][0], yE, E[i][1]], b = [E[j][0], yE, E[j][1]];
    const k = Math.abs((b[0] - a[0]) * A.ux + (b[2] - a[2]) * A.uz) > Math.abs((b[0] - a[0]) * A.vx + (b[2] - a[2]) * A.vz) ? col : colDark;
    up(a, b, R[j], k); if (Math.hypot(R[i][0] - R[j][0], R[i][2] - R[j][2]) > 0.01) up(a, R[j], R[i], k);
    // fascia board under the eaves
    buf.quad([E[i][0], yE - 0.22, E[i][1]], [E[j][0], yE - 0.22, E[j][1]], b, a, C('#e9e4d8', 0.9), null);
  }
  // soffit: closes the eaves from below
  flatRoofDown(buf, E, yE - 0.22, C('#d9d3c6'));
  return { ridge: [A.W((ua + ub) / 2, vm), yR], axis: A, rise };
}
function flatRoofDown(buf, P, y, col) {
  const tris = THREE.ShapeUtils.triangulateShape(P.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [i, j, k] of tris) {
    let a = [P[i][0], y, P[i][1]], b = [P[j][0], y, P[j][1]], c = [P[k][0], y, P[k][1]];
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0) [b, c] = [c, b];   // normal down
    buf.tri(a, b, c, col);
  }
}

// ------------------------------------------------------------------ facade atlases
// An atlas is NC columns (bay kinds, some in several variants) × NR rows (floors; each row has its own lit windows).
// A bay quad maps one column and `floors` consecutive rows (wrapping), so a wall of any length and height is made of cells.
// ORM canvas: G = roughness, B = metalness (glass smooth and mirror-ish, walls matte).
const WARM = ['#ffcf8a', '#ffd9a0', '#ffc070', '#fff0d6', '#ffb760', '#ffe2b0', '#cfe0ff'];
function win(R, rnd, x0, y0, x1, y1, { frame = '#f2f0ea', fw = 0.06, mull = 1, transom = 0, lit = [0.44, 0.2], k = 1, dark = false } = {}) {
  R('m', x0, y0, x1, y1, frame);
  R('m', x0 + fw, y0 + fw, x1 - fw, y1 - fw, dark ? '#15171a' : '#2a3540');
  if (!dark) R('m', x0 + fw, y0 + (y1 - y0) * 0.5, x1 - fw, y1 - fw, '#3c4b5c');
  for (let i = 1; i <= mull; i++) { const x = x0 + (x1 - x0) * i / (mull + 1); R('m', x - fw / 2, y0, x + fw / 2, y1, frame); }
  if (transom) R('m', x0, y0 + (y1 - y0) * transom - fw / 2, x1, y0 + (y1 - y0) * transom + fw / 2, frame);
  if (dark) return;
  R('o', x0 + fw, y0 + fw, x1 - fw, y1 - fw, 'rgb(0,34,150)');
  const r = rnd(), hue = WARM[Math.floor(rnd() * WARM.length)], a = (0.55 + 0.45 * rnd()) * k, curtain = rnd() < 0.4;
  for (const [t, thr] of [['d', lit[0]], ['n', lit[1]]]) {
    if (r >= thr) continue;
    R(t, x0 + fw, y0 + fw, x1 - fw, y1 - fw, rgba(hue, a));
    R(t, x0 + fw, y0 + fw, x1 - fw, y0 + (y1 - y0) * 0.3, 'rgba(70,35,5,0.4)');
    if (curtain) R(t, x0 + fw, y0 + fw, x0 + (x1 - x0) * 0.34, y1 - fw, 'rgba(0,0,0,0.5)');
    for (let i = 1; i <= mull; i++) { const x = x0 + (x1 - x0) * i / (mull + 1); R(t, x - fw / 2, y0, x + fw / 2, y1, 'rgba(0,0,0,0.8)'); }
  }
}
const STYLES = {
  // 5-storey silicate-brick slab: windows with a white sill, balcony doors (the balcony itself is geometry), stair windows
  brick: {
    bay: 3.2, fh: 2.8, plinth: 0.9, rows: 8, seed: 31, cols: ['W', 'W', 'B', 'B', 'S', 'G', 'K', 'W'], wall: '#cdc8bc',
    base(g, W, H, rnd, px) {
      for (let y = 0; y < H; y += px * 0.15) { g.fillStyle = 'rgba(70,60,45,0.07)'; g.fillRect(0, y, W, 1); }
      for (let i = 0; i < W * H / 90; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(60,50,40,0.07)' : 'rgba(255,255,255,0.07)'; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 5, 1.5); }
    },
    cell(kind, R, rnd) {
      R('m', 0, 0, 3.2, 0.07, 'rgba(120,112,98,0.5)');                                  // floor-slab course
      if (kind === 'W') { R('m', 0.82, 0.83, 2.38, 0.9, '#e6e2d8'); win(R, rnd, 0.9, 0.9, 2.3, 2.35, { mull: 1, transom: 0.72 }); }
      else if (kind === 'K') { R('m', 1.07, 0.83, 2.13, 0.9, '#e6e2d8'); win(R, rnd, 1.15, 0.9, 2.05, 2.35, { mull: 0, transom: 0.72 }); }
      else if (kind === 'B') { win(R, rnd, 0.55, 0.12, 1.3, 2.35, { mull: 0, transom: 0.8 }); win(R, rnd, 1.3, 0.9, 2.6, 2.35, { mull: 1 }); }
      else if (kind === 'S') { R('m', 1.0, 1.42, 2.2, 1.5, '#e6e2d8'); win(R, rnd, 1.05, 1.5, 2.15, 2.6, { mull: 1, lit: [0.85, 0.7], k: 0.5, frame: '#d9d5cb' }); }
    },
  },
  // 9-storey panel slab: panel joints, tile-faced panels, loggias with a solid parapet (some glazed in by the owners)
  panel: {
    bay: 3.2, fh: 2.8, plinth: 0.9, rows: 8, seed: 47, cols: ['W', 'W', 'L', 'L', 'S', 'G', 'K', 'L'], wall: '#c3bfb4',
    base(g, W, H, rnd, px) {
      for (let i = 0; i < W * H / 60; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(50,50,45,0.06)' : 'rgba(255,255,255,0.06)'; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
    },
    cell(kind, R, rnd) {
      R('m', 0, 0, 3.2, 0.06, '#8d897f'); R('m', 0, 0, 0.05, 2.8, '#8d897f');             // panel joints
      if (kind === 'W') win(R, rnd, 0.85, 0.85, 2.35, 2.35, { mull: 1, transom: 0.72 });
      else if (kind === 'K') win(R, rnd, 1.1, 0.85, 2.1, 2.35, { mull: 0, transom: 0.72 });
      else if (kind === 'S') win(R, rnd, 1.1, 1.3, 2.1, 2.55, { mull: 0, lit: [0.85, 0.7], k: 0.5, frame: '#d2cec4' });
      else if (kind === 'L') {
        R('m', 0.22, 0.1, 2.98, 2.7, '#57534c'); R('o', 0.22, 0.1, 2.98, 2.7, 'rgb(0,240,0)');   // the recess, in shade
        win(R, rnd, 0.45, 0.14, 1.2, 2.3, { mull: 0, frame: '#c9c5bb' }); win(R, rnd, 1.25, 0.9, 2.75, 2.3, { mull: 1, frame: '#c9c5bb' });
        const p = ['#b79a62', '#8496a3', '#c9c3b4', '#a9806a', '#9aa58a'][Math.floor(rnd() * 5)];
        R('m', 0.22, 0.1, 2.98, 1.1, p); R('m', 0.22, 1.06, 2.98, 1.12, 'rgba(255,255,255,0.35)');   // parapet panel + rail
        for (const t of ['d', 'n']) R(t, 0.22, 0.1, 2.98, 1.12, 'rgb(0,0,0)');
        if (rnd() < 0.45) {                                                               // glazed-in loggia
          R('m', 0.22, 1.12, 2.98, 2.7, 'rgba(150,170,185,0.5)'); R('o', 0.22, 1.12, 2.98, 2.7, 'rgb(0,60,120)');
          for (const x of [0.22, 0.9, 1.6, 2.3, 2.92]) R('m', x, 1.12, x + 0.06, 2.7, '#e8e6e0');
          R('m', 0.22, 2.64, 2.98, 2.7, '#e8e6e0');
        }
      }
    },
  },
  // plastered 1–2-storey houses and small buildings; H = empty opening (ruins)
  plaster: {
    bay: 3.0, fh: 3.0, plinth: 0.4, rows: 4, seed: 59, cols: ['W', 'W', 'V', 'G', 'W', 'H', 'H', 'G'], wall: '#ebe6da',
    base(g, W, H, rnd) {
      for (let i = 0; i < W * H / 70; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(80,70,50,0.05)' : 'rgba(255,255,255,0.06)'; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 3, 2); }
    },
    cell(kind, R, rnd) {
      if (kind === 'W') { R('m', 0.82, 0.78, 2.18, 0.86, '#d8d2c4'); win(R, rnd, 0.9, 0.86, 2.1, 2.3, { mull: 1, lit: [0.5, 0.22] }); }
      else if (kind === 'V') { R('m', 0.52, 0.78, 2.48, 0.86, '#d8d2c4'); win(R, rnd, 0.6, 0.86, 2.4, 2.3, { mull: 2, lit: [0.5, 0.22] }); }
      else if (kind === 'H') { win(R, rnd, 0.7, 0.8, 2.3, 2.45, { mull: 0, dark: true, frame: '#8c857a', fw: 0.09 }); R('m', 0, 0, 3.0, 0.35, 'rgba(60,50,40,0.25)'); }
    },
  },
  // low shops, kiosks, the fuel-station shop: glazed front under a fascia band
  shop: {
    bay: 3.0, fh: 4.0, plinth: 0, rows: 4, seed: 71, cols: ['F', 'F', 'F', 'E', 'G', 'G', 'F', 'E'], wall: '#d9d6cf',
    base(g, W, H, rnd) {
      for (let i = 0; i < W * H / 120; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(60,60,60,0.05)' : 'rgba(255,255,255,0.05)'; g.fillRect(rnd() * W, rnd() * H, 3, 2); }
    },
    cell(kind, R, rnd) {
      R('m', 0, 0, 3.0, 0.3, '#77736c'); R('m', 0, 3.0, 3.0, 3.85, '#4a4d52'); R('m', 0, 3.85, 3.0, 4.0, '#b9b6af');   // plinth, fascia, coping
      if (kind === 'G') { R('m', 1.48, 0.3, 1.52, 3.0, 'rgba(0,0,0,0.18)'); return; }
      R('m', 0.35, 3.22, 2.65, 3.64, ['#c8c2b2', '#8d5a3c', '#3f6a58', '#c9a23f', '#54627a'][Math.floor(rnd() * 5)]);  // blank sign board
      const o = { frame: '#2f3236', fw: 0.07, lit: [0.86, 0.34], k: 1.15 };
      if (kind === 'F') win(R, rnd, 0.12, 0.3, 2.88, 2.95, { ...o, mull: 1 });
      else { win(R, rnd, 0.12, 0.3, 0.95, 2.95, { ...o, mull: 0 }); win(R, rnd, 1.0, 0.06, 2.0, 2.95, { ...o, mull: 1, transom: 0.78 }); win(R, rnd, 2.05, 0.3, 2.88, 2.95, { ...o, mull: 0 }); }
    },
  },
};
function makeAtlas(S, low) {
  const NC = S.cols.length, NR = S.rows, px = low ? 64 : 128;
  const mk = k => { const c = document.createElement('canvas'); c.width = NC * px * k; c.height = NR * px * k; return c; };
  const cv = { m: mk(1), o: mk(0.5), d: mk(0.5), n: mk(0.5) }, K = { m: px, o: px / 2, d: px / 2, n: px / 2 }, G = {};
  for (const k of Object.keys(cv)) G[k] = cv[k].getContext('2d');
  const rnd = mulberry32(S.seed);
  G.m.fillStyle = S.wall; G.m.fillRect(0, 0, cv.m.width, cv.m.height); S.base(G.m, cv.m.width, cv.m.height, rnd, px / S.fh);
  G.o.fillStyle = 'rgb(0,228,0)'; G.o.fillRect(0, 0, cv.o.width, cv.o.height);
  for (const k of ['d', 'n']) { G[k].fillStyle = '#000'; G[k].fillRect(0, 0, cv[k].width, cv[k].height); }
  for (let row = 0; row < NR; row++) for (let col = 0; col < NC; col++) {
    const R = (t, x0, y0, x1, y1, fill) => {
      const g = G[t], k = K[t]; g.fillStyle = fill;
      const X0 = (col + x0 / S.bay) * k, X1 = (col + x1 / S.bay) * k, Y1 = (NR - row - y1 / S.fh) * k, Y0 = (NR - row - y0 / S.fh) * k;
      g.fillRect(X0, Y1, X1 - X0, Y0 - Y1);
    };
    S.cell(S.cols[col], R, rnd);
  }
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = low ? 4 : 8; return t; };
  return { map: tex(cv.m, true), orm: tex(cv.o, false), emDusk: tex(cv.d, true), emNight: tex(cv.n, true), eps: 0.6 / cv.m.width };
}
function roofTexture(low) {
  const S = low ? 128 : 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), rnd = mulberry32(5);
  g.fillStyle = '#77756f'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < S * S / 14; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'; g.fillRect(rnd() * S, rnd() * S, 2, 2); }
  for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(${40 + rnd() * 30 | 0},${40 + rnd() * 30 | 0},${40 + rnd() * 30 | 0},0.22)`; g.fillRect(rnd() * S, rnd() * S, S * (0.1 + rnd() * 0.25), S * (0.06 + rnd() * 0.2)); }   // bitumen patches
  g.strokeStyle = 'rgba(30,30,30,0.25)'; g.lineWidth = 1; for (let x = 0; x < S; x += S / 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }                            // roll seams
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = low ? 2 : 4; return t;
}
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 1; return t;
}

// Tones of the place: silicate brick and weathered panels, pale plaster in warm whites, ochre, peach and soft green,
// roofs in terracotta, brown and graphite metal tile.
const TINTS = {
  brick: ['#ffffff', '#f6efe2', '#efe6dc', '#fbf3ea', '#e9e4dc'],
  panel: ['#ffffff', '#f4f1ea', '#ecebe6', '#f3ece0'],
  plaster: ['#ffffff', '#fbf0d2', '#f6dfc4', '#e9eed9', '#f1e6d6', '#e4e8ec', '#f7e9b9'],
  shop: ['#ffffff', '#f3f1ec', '#e9ecef'],
  ruin: ['#b9a99a', '#a99a8c', '#c0b2a2'],
};
const ROOFS = [['#9a4f39', '#84422f'], ['#6f4a3a', '#5e3e30'], ['#4c4f55', '#3f4247'], ['#a8563b', '#8f4731'], ['#7a3f33', '#69352b']];

// ------------------------------------------------------------------ main
// createContext({ shadows, lowDetail, blocks?, traffic? }) → { group, setMode, update, dispose, materials, podium: null, cars, poles, blocks, mode, traffic }
//   traffic option: 'auto' (default, see above) | true | false;  .traffic = the createTraffic() instance or null
//   cars  = { list: [{x, y, z, yaw, kind, colour, deck: false, src}], instances } | null — walk.js moves them into its fleet
//   poles = [] (no light poles of its own; kept for walk.js)
export function createContext({ shadows = false, lowDetail = false, blocks = CONTEXT_BLOCKS, traffic = 'auto' } = {}) {
  const low = !!lowDetail;
  const group = new THREE.Group(); group.name = 'vrc-context';
  const textures = [], materials = [];
  const T = t => (textures.push(t), t);
  const M = m => (materials.push(m), m);
  const add = (mesh, cast = true) => { mesh.castShadow = shadows && cast; mesh.receiveShadow = shadows; group.add(mesh); return mesh; };
  let mode = null;
  const list = (blocks || []).filter(b => b && (b.poly ? b.poly.length > 2 : [b.x0, b.x1, b.z0, b.z1].every(Number.isFinite)));
  if (!list.length) {
    return { group, setMode(m) { mode = m; }, update() {}, dispose() { group.parent?.remove(group); }, materials, podium: null, cars: null, poles: [], blocks: [], traffic: null, get mode() { return mode; } };
  }

  const con = new Buf();          // vertex-coloured: plinths, parapets, balconies, pitched roofs, sheds, canopy
  const roof = new Buf(true);     // flat roofs (bitumen texture)
  const glow = new Buf();         // lit soffits and lamps (emissive after dusk)
  const fac = {};                 // style → Buf with uv
  const atl = {};                 // style → atlas
  const pools = [];               // [x, z, r] light pools on the ground
  const info = [];
  const facade = style => (fac[style] ||= new Buf(true));

  // one wall of a block as bay quads; `kinds(i, nb)` → bay kind
  function wallQuads(style, w, y0, floors, h, tint, rnd, kinds) {
    const S = STYLES[style], A = (atl[style] ||= makeAtlas(S, low)), buf = facade(style), NC = S.cols.length;
    const nb = Math.max(1, Math.round(w.len / S.bay)), bw = w.len / nb, out = [];
    for (let i = 0; i < nb; i++) {
      const kind = kinds(i, nb), cand = []; S.cols.forEach((k, c) => { if (k === kind) cand.push(c); });
      const c = cand.length ? cand[Math.floor(rnd() * cand.length)] : S.cols.indexOf('G'), k0 = Math.floor(rnd() * S.rows);
      // a bay much narrower than the cell shows only the middle of a blank cell (no squeezed windows)
      const f = Math.min(1, bw / S.bay), narrow = f < 0.72, cc = narrow ? S.cols.indexOf('G') : c;
      const u0 = (cc + (narrow ? 0.5 - f / 2 : 0)) / NC + A.eps, u1 = (cc + (narrow ? 0.5 + f / 2 : 1)) / NC - A.eps, v0 = k0 / S.rows, v1 = (k0 + floors) / S.rows;
      const a = [w.a[0] + w.t[0] * bw * i, w.a[1] + w.t[1] * bw * i], b = [w.a[0] + w.t[0] * bw * (i + 1), w.a[1] + w.t[1] * bw * (i + 1)];
      buf.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y0 + h, b[1]], [a[0], y0 + h, a[1]], tint, [w.n[0], 0, w.n[1]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      out.push({ kind: narrow ? 'G' : kind, s0: bw * i, s1: bw * (i + 1) });
    }
    return out;
  }
  const vquad = (w, s0, s1, d, y0, y1, col) => {   // vertical quad standing d in front of a wall
    const P = (s, y) => [w.a[0] + w.t[0] * s + w.n[0] * d, y, w.a[1] + w.t[1] * s + w.n[1] * d];
    con.quad(P(s0, y0), P(s1, y0), P(s1, y1), P(s0, y1), col, [w.n[0], 0, w.n[1]]);
  };

  for (const b of list) {
    const P = b.poly || [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
    const style = contextStyle(b), H = contextHeight(b), floors = Math.max(1, b.floors || 1), rnd = mulberry32(hashStr(String(b.id || '') + style));
    const walls = wallsOf(P), per = walls.reduce((m, w) => m + w.len, 0), longest = walls.reduce((m, w) => (w.len > m.len ? w : m), walls[0]);
    const ruin = b.kind === 'ruin';
    info.push({ id: b.id, style, h: H, floors, kind: b.kind });
    if (!walls.length) continue;

    if (style === 'brick' || style === 'panel') {
      // ---- Soviet-era slab: plinth, bays (stair bay with an entrance every section), balconies / loggias, flat roof
      const S = STYLES[style], y0 = S.plinth, h = floors * S.fh, top = y0 + h, tint = C(TINTS[style][Math.floor(rnd() * TINTS[style].length)]);
      const pat = style === 'brick' ? 'WBWKSKWB' : 'WLWKSLWL', balc = ['#c9b58a', '#9aa7ad', '#d6d0c2', '#b58d75', '#a7b096'];
      const front = walls.filter(w => w.len >= 14).sort((p, q) => q.len - p.len);
      for (const w of walls) {
        const long = w.len >= 14, off = Math.floor(rnd() * pat.length), yard = long && front.indexOf(w) % 2 === 0;
        const bays = wallQuads(style, w, y0, floors, h, tint, rnd, (i, nb) => (long ? (!yard && pat[(i + off) % pat.length] === 'S' ? 'K' : pat[(i + off) % pat.length]) : style === 'brick' && nb >= 3 && i === (nb >> 1) ? 'W' : 'G'));
        vquad(w, 0, w.len, 0.04, 0, y0, C('#857f74'));                                                  // plinth
        con.box(w.a, w.t, w.n, -0.05, w.len + 0.05, -0.28, 0.06, top, top + 0.5, C('#b9b4a8'));         // parapet
        con.box(w.a, w.t, w.n, -0.1, w.len + 0.1, -0.33, 0.11, top + 0.5, top + 0.56, C('#8e8a80'));    // metal coping
        for (const bay of bays) {
          if (bay.kind === 'B') {
            const pc = C(balc[Math.floor(rnd() * balc.length)]), s0 = bay.s0 + 0.3, s1 = bay.s1 - 0.3;
            for (let k = 1; k < floors; k++) {
              if (low && k % 2 === 0) continue;
              const y = y0 + k * S.fh;
              con.box(w.a, w.t, w.n, s0, s1, 0, 0.95, y - 0.12, y + 0.02, C('#aaa59a'));                 // slab
              con.box(w.a, w.t, w.n, s0, s1, 0.89, 0.95, y + 0.02, y + 1.02, pc);                        // front panel
              if (!low) { con.box(w.a, w.t, w.n, s0, s0 + 0.05, 0, 0.9, y + 0.02, y + 1.02, pc, 0.9); con.box(w.a, w.t, w.n, s1 - 0.05, s1, 0, 0.9, y + 0.02, y + 1.02, pc, 0.9); }
              if (!low && rnd() < 0.42) {                                                               // glazed in by the owner
                con.box(w.a, w.t, w.n, s0, s1, 0.9, 0.94, y + 1.02, y + 2.45, C('#8fa0ab'), 0.9);
                con.box(w.a, w.t, w.n, s0, s1, 0, 0.98, y + 2.45, y + 2.52, C('#dcdad4'));
                for (const s of [s0, (s0 + s1) / 2 - 0.03, s1 - 0.06]) con.box(w.a, w.t, w.n, s, s + 0.06, 0.88, 0.96, y + 1.02, y + 2.45, C('#eceae4'));
              }
            }
          } else if (bay.kind === 'S') {
            const m = (bay.s0 + bay.s1) / 2;                                                            // entrance: door, canopy, lamp
            con.box(w.a, w.t, w.n, m - 0.75, m + 0.75, 0, 0.08, 0.1, 2.25, C('#4b3f36'));
            con.box(w.a, w.t, w.n, m - 1.5, m + 1.5, 0, 1.5, 2.6, 2.74, C('#a39e93'));
            if (!low) for (const s of [m - 1.45, m + 1.33]) con.box(w.a, w.t, w.n, s, s + 0.12, 1.3, 1.42, 0, 2.6, C('#6d6a64'));
            glow.box(w.a, w.t, w.n, m - 0.18, m + 0.18, 0.08, 0.2, 2.35, 2.47, C('#fff1d6'));
            pools.push([w.a[0] + w.t[0] * m + w.n[0] * 1.6, w.a[1] + w.t[1] * m + w.n[1] * 1.6, 3.2]);
          }
        }
        // panel slabs: a thin shadow line under every loggia row is in the texture; brick slabs get nothing more
      }
      flatRoof(roof, P, top + 0.06, C('#ffffff'), 9);
      // stair heads / lift machine rooms along the yard side
      const yardW = front[0];
      if (yardW) {
        const n = Math.max(1, Math.round(yardW.len / 24)), hh = style === 'panel' ? 3.0 : 1.7, hw = style === 'panel' ? 2.6 : 1.7;
        for (let i = 0; i < n; i++) {
          const s = yardW.len * (i + 0.5) / n, x = yardW.a[0] + yardW.t[0] * s - yardW.n[0] * 4.2, z = yardW.a[1] + yardW.t[1] * s - yardW.n[1] * 4.2;
          if (!inPoly(P, x, z)) continue;
          con.box([x, z], yardW.t, yardW.n, -hw, hw, -1.9, 1.9, top, top + hh, C('#aeaaa0'));
          con.box([x, z], yardW.t, yardW.n, -hw - 0.15, hw + 0.15, -2.05, 2.05, top + hh, top + hh + 0.14, C('#7f7c75'));
        }
      }
    } else if (style === 'plaster') {
      // ---- private houses and small plastered buildings (hipped roof), larger ones and ruins with a flat roof
      const S = STYLES.plaster, y0 = ruin ? 0 : S.plinth, h = H - y0;
      const bb = longAxis(P), area = Math.abs(polyArea(P));
      const pitched = !ruin && floors <= 2 && area < 430 && P.length <= 8;
      const tint = C((ruin ? TINTS.ruin : TINTS.plaster)[Math.floor(rnd() * (ruin ? TINTS.ruin : TINTS.plaster).length)]);
      for (const w of walls) {
        wallQuads('plaster', w, y0, floors, h, tint, rnd, (i, nb) => {
          if (w.len < 2.4) return 'G';
          const r = rnd(); return ruin ? (r < 0.62 ? 'H' : 'G') : r < 0.5 ? 'W' : r < 0.68 ? 'V' : 'G';
        });
        if (y0 > 0) vquad(w, 0, w.len, 0.03, 0, y0, C('#8b857a'));
        if (!pitched) { con.box(w.a, w.t, w.n, -0.04, w.len + 0.04, -0.22, 0.05, H, H + (ruin ? 0.12 : 0.3), C(ruin ? '#8a8177' : '#cfcabd')); }
      }
      if (pitched) {
        const rc = ROOFS[Math.floor(rnd() * ROOFS.length)], r = hipRoof(con, P, H, C(rc[0]), C(rc[1]));
        // chimney beside the ridge, front door with a small porch roof on the longest wall
        const [cx, cz] = r.ridge[0], ch = r.ridge[1] + 0.5, ox = r.axis.vx * 1.1, oz = r.axis.vz * 1.1;
        con.abox(cx + ox - 0.3, cx + ox + 0.3, H, ch, cz + oz - 0.3, cz + oz + 0.3, C('#9b6b55'));
        con.abox(cx + ox - 0.36, cx + ox + 0.36, ch, ch + 0.08, cz + oz - 0.36, cz + oz + 0.36, C('#5c5b58'));
        const m = longest.len * (0.3 + 0.4 * rnd());
        con.box(longest.a, longest.t, longest.n, m - 0.5, m + 0.5, 0, 0.07, y0, y0 + 2.1, C('#5a4636'));
        con.box(longest.a, longest.t, longest.n, m - 1.0, m + 1.0, 0, 1.1, y0 + 2.3, y0 + 2.42, C(rc[1]));
        con.box(longest.a, longest.t, longest.n, m - 0.9, m + 0.9, 0, 1.0, 0, y0, C('#9a958a'));
        glow.box(longest.a, longest.t, longest.n, m - 0.1, m + 0.1, 0.07, 0.17, y0 + 2.12, y0 + 2.24, C('#ffe9c4'));
        if (floors <= 2) pools.push([longest.a[0] + longest.t[0] * m + longest.n[0] * 1.3, longest.a[1] + longest.t[1] * m + longest.n[1] * 1.3, 2.4]);
      } else flatRoof(roof, P, H + 0.02, C(ruin ? '#9d968c' : '#ffffff'), 9);
      void bb; void per;
    } else if (style === 'shop') {
      // ---- low commercial buildings, kiosks, the fuel-station shop
      const tint = C(TINTS.shop[Math.floor(rnd() * TINTS.shop.length)]);
      const street = walls.filter(w => w.len > 4).sort((p, q) => q.len - p.len).slice(0, b.kind === 'fuel' ? 4 : 2);
      for (const w of walls) {
        const glazed = street.includes(w);
        wallQuads('shop', w, 0, floors, H, tint, rnd, (i, nb) => (w.len < 3 || !glazed ? 'G' : i === (nb >> 1) ? 'E' : rnd() < 0.78 ? 'F' : 'G'));
        con.box(w.a, w.t, w.n, -0.04, w.len + 0.04, -0.2, 0.04, H, H + 0.25, C('#8f8c86'));
        if (glazed && !low) con.box(w.a, w.t, w.n, 0.2, w.len - 0.2, 0, 0.7, H * 0.76, H * 0.76 + 0.08, C('#55585c'));   // canopy over the shop front
        if (glazed) { const n = Math.max(1, Math.round(w.len / 9)); for (let i = 0; i < n; i++) { const s = w.len * (i + 0.5) / n; pools.push([w.a[0] + w.t[0] * s + w.n[0] * 2, w.a[1] + w.t[1] * s + w.n[1] * 2, 4]); } }
      }
      flatRoof(roof, P, H + 0.02, C('#ffffff'), 9);
      if (!low) { const A = longAxis(P), [x, z] = A.W((A.u0 + A.u1) / 2, (A.v0 + A.v1) / 2); if (inPoly(P, x, z)) con.abox(x - 0.8, x + 0.8, H, H + 0.9, z - 0.6, z + 0.6, C('#a3a6a8')); }
    } else if (style === 'canopy') {
      // ---- fuel-station canopy: roof slab on columns over the pump islands, lit soffit
      const L = canopyLayout(b), y1 = L.top, yc = L.clear;
      for (const w of walls) {
        vquad(w, 0, w.len, 0, yc, y1, C('#eef0ef')); vquad(w, 0, w.len, 0.012, yc + 0.18, yc + 0.34, C('#2f6b4f'));
        const Q = (s, y) => [w.a[0] + w.t[0] * s, y, w.a[1] + w.t[1] * s];
        con.quad(Q(0, yc), Q(w.len, yc), Q(w.len, y1), Q(0, y1), C('#dfe1e0'), [-w.n[0], 0, -w.n[1]]);
      }
      flatRoof(con, P, y1, C('#c9cbca'));
      flatRoofDown(glow, P, yc, C('#f4f7fb'));
      for (const s of L.islands) {
        const t = L.axis, n = [-t[1], t[0]];
        con.box([s.x, s.z], t, n, -1.7, 1.7, -0.45, 0.45, 0, 0.16, C('#b7b3aa'));                       // island kerb
        con.box([s.x, s.z], t, n, -0.2, 0.2, -0.2, 0.2, 0.16, yc, C('#e6e8e8'));                         // column
        for (const d of [-1.05, 1.05]) {                                                               // pumps
          con.box([s.x, s.z], t, n, d - 0.35, d + 0.35, -0.28, 0.28, 0.16, 1.75, C('#e9ebea'));
          con.box([s.x, s.z], t, n, d - 0.36, d + 0.36, -0.29, 0.29, 1.3, 1.6, C('#2f6b4f'));
          glow.box([s.x, s.z], t, n, d - 0.2, d + 0.2, -0.295, 0.295, 0.95, 1.22, C('#cfe3ff', 0.6));
        }
        pools.push([s.x, s.z, 7]);
      }
    } else {
      // ---- sheds, substations and other utility boxes: plain walls, flat roof
      const col = C(['#9c988f', '#8b8f8c', '#a59f93'][Math.floor(rnd() * 3)]);
      for (const w of walls) {
        vquad(w, 0, w.len, 0, 0, H, col);
        con.box(w.a, w.t, w.n, -0.06, w.len + 0.06, -0.12, 0.12, H, H + 0.1, C('#6f6c66'));
        if (w === longest) con.box(w.a, w.t, w.n, w.len / 2 - 0.6, w.len / 2 + 0.6, 0, 0.05, 0, Math.min(2.2, H - 0.3), C('#5d6266'));
      }
      flatRoof(roof, P, H + 0.02, C('#b9b6ae'), 9);
    }
  }

  // ---------------- meshes
  const facadeMats = [];
  for (const [style, buf] of Object.entries(fac)) {
    if (!buf.count) continue;
    const tx = atl[style]; for (const k of ['map', 'orm', 'emDusk', 'emNight']) T(tx[k]);
    const mat = M(new THREE.MeshStandardMaterial({
      map: tx.map, roughnessMap: tx.orm, metalnessMap: tx.orm, roughness: 1, metalness: 0.55, vertexColors: true,
      emissive: new THREE.Color('#ffffff'), emissiveMap: tx.emDusk, emissiveIntensity: 0, envMapIntensity: 0.8,
    }));
    mat.userData.em = { dusk: tx.emDusk, night: tx.emNight };
    facadeMats.push(mat);
    add(new THREE.Mesh(buf.geometry(), mat)).name = 'context-facade-' + style;
  }
  if (roof.count) {
    const rm = M(new THREE.MeshStandardMaterial({ map: T(roofTexture(low)), vertexColors: true, roughness: 0.85, metalness: 0.05 }));
    add(new THREE.Mesh(roof.geometry(), rm), false).name = 'context-roofs';
  }
  if (con.count) {
    const cm = M(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }));
    add(new THREE.Mesh(con.geometry(), cm)).name = 'context-concrete';
  }
  let glowMat = null;
  if (glow.count) {
    glowMat = M(new THREE.MeshStandardMaterial({ color: '#c9ccd0', vertexColors: true, roughness: 0.7, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, side: THREE.DoubleSide }));
    // emissive follows the vertex colour (lamps warm, canopy soffit cool white)
    glowMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif'); };
    glowMat.customProgramCacheKey = () => 'vrc-context-glow';
    add(new THREE.Mesh(glow.geometry(), glowMat), false).name = 'context-glow';
  }
  // light pools on the ground under the lamps and the canopy (dusk / night)
  let poolMat = null, poolMesh = null;
  if (pools.length) {
    poolMat = M(new THREE.MeshBasicMaterial({ map: T(radialTexture()), color: new THREE.Color('#ffb66e'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 }));
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    poolMesh = new THREE.InstancedMesh(pg, poolMat, pools.length); const o = new THREE.Object3D();
    pools.forEach(([x, z, r], i) => { o.position.set(x, 0.05, z); o.scale.set(r * 2, 1, r * 2); o.updateMatrix(); poolMesh.setMatrixAt(i, o.matrix); });
    poolMesh.computeBoundingSphere(); poolMesh.renderOrder = 2; poolMesh.name = 'context-light-pools'; group.add(poolMesh);
  }

  // ---------------- cars parked along the framing streets and at the fuel station (cars.js far models)
  let cars = null;
  try {
    const cl = parkedStreetCars({ blocks: list });
    if (cl.length) { const inst = createCarInstances(cl, { shadows }); inst.group.name = 'context-cars'; group.add(inst.group); cars = { list: cl, instances: inst }; }
  } catch (e) { console.warn('[context] parked cars', e); }

  // ---------------- modes
  let moving = null, trafficTried = traffic === false;
  const MODE = {
    day: { win: 0, map: 'dusk', glow: 0, pool: 0 },
    dusk: { win: 1.0, map: 'dusk', glow: 1.6, pool: 0.2 },
    night: { win: 1.25, map: 'night', glow: 2.2, pool: 0.28 },
  };
  function setMode(m) {
    const P = MODE[m] || MODE.dusk; mode = MODE[m] ? m : 'dusk';
    for (const fm of facadeMats) { fm.emissiveMap = fm.userData.em[P.map]; fm.emissiveIntensity = P.win; }
    if (glowMat) glowMat.emissiveIntensity = P.glow;
    if (poolMat) { poolMat.opacity = P.pool; poolMesh.visible = P.pool > 0; }
    if (moving) moving.setMode(mode);
  }
  setMode('dusk');

  // ---------------- moving traffic (lazy: decided on the first update, when the host scene is complete)
  function startTraffic() {
    trafficTried = true;
    try {
      if (traffic !== true) { let top = group; while (top.parent) top = top.parent; if (top !== group && top.getObjectByName('traffic')) return; }
      moving = createTraffic({ shadows, density: low ? 1 / 150 : 1 / 90 });
      moving.setMode(mode); group.add(moving.group);
    } catch (e) { console.warn('[context] traffic', e); moving = null; }
  }
  function update(dt /* , camera */) {
    if (!trafficTried) startTraffic();
    if (moving && dt > 0) moving.update(dt);
  }

  function dispose() {
    group.parent?.remove(group);
    if (cars) cars.instances.dispose();   // shared car geometry stays cached in cars.js
    if (moving) { moving.dispose(); moving = null; }
    group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  }

  return { group, setMode, update, dispose, materials, podium: null, cars, poles: [], blocks: info, get mode() { return mode; }, get traffic() { return moving; } };
}
