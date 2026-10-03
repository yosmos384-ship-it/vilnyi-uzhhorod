// ЖК VILNYI (Ужгород) — exterior of the four point towers B1–B4 and the commercial podium (T10, EXT-CORE).
// This module owns the public API (CONTRACT §4.1), the materials, the per-floor pick volumes, highlight / hide logic and
// the shared geometry kit. The detailed geometry comes from two sibling modules that write into the buffers given to them:
//   exterior-tower.js   buildTowerFacade(K, bId, bufs)   building-local coordinates   (T11)
//   exterior-podium.js  buildPodium(K, bufs)             world coordinates            (T12)
// Both are loaded with a guarded dynamic import. When one is missing or throws, the FALLBACK is used: every tower becomes
// an extrusion of its floor outlines (wall + glass strip per bay, tagged like the real facade, so picking, floor / unit
// highlight and hiding still work) and the podium is simply absent.
// Everything is merged into one mesh per material per building. Each vertex carries aTag = (band code, unit index, window
// seed), so hiding a floor (walkthrough), highlighting a floor or units and lit windows after dark are shader uniforms.
import * as THREE from 'three';
import {
  BUILDINGS, B_IDS, UNITS, LEVELS, GEOM, SITE_CENTER, STREETS,
  floorY, floorH, roofY, floorsOf, topFloor, localToWorld, unitsOn, footprintOf, plateOf, typicalPlate, unitAtPoint, coresOf,
} from '../data.js';
import { SHARED, registerMaterial } from './environment.js';

const ROOF_BAND = 99;                                  // roof / crown / podium: never hidden, never a floor
const bandCode = (bId, band) => band + 100 * B_IDS.indexOf(bId);
const UNIT_INDEX = new Map(UNITS.map((u, i) => [u, i]));
const UNIT_BY_ID = new Map(UNITS.map(u => [u.id, u]));
const BD = GEOM.balconyDepth;
const PICK_OFF = 0.6;                                  // pick volume = floor outline pushed out by this much
const LINE_OFF = 0.3;                                  // highlight outline offset

// ------------------------------------------------------------------ palette
// Facade colours: plans.pdf p.7 (data/renders.json → facadeColours): porcelain stoneware in four greys, "each building its
// own shade", timber-look panels, dark frames. The sheet does not say which grey belongs to which tower — the assignment
// below is read off the renders (B4 lightest, B2 anthracite over the dark podium) and is an ESTIMATE.
const GREYS = { light: '#e2e2e2', mid: '#b1b0b5', blue: '#7d7b83', anthracite: '#4e4e4e' };
const TIMBER = '#876849';
export const PALETTE = {
  est: true,
  towers: { B1: GREYS.mid, B2: GREYS.anthracite, B3: GREYS.blue, B4: GREYS.light },
  podium: GREYS.anthracite, timber: TIMBER, frame: '#232426', glass: '#566573',
};
const towerTone = bId => PALETTE.towers[bId] || Object.values(GREYS)[B_IDS.indexOf(bId) % 4] || GREYS.mid;

// ------------------------------------------------------------------ view
// Aerial three-quarter view from over the street corner (Hrushevskoho × Zankovetskoi), as in the developer's renders.
function streetCornerDir() {
  try {
    const main = STREETS.filter(s => s.main), pick = id => STREETS.find(s => s.id === id);
    const A = pick('hrushevskoho') || main[0], B = pick('zankovetskoi') || main[1];
    let best = null;
    for (let i = 0; i + 1 < A.pts.length; i++) for (let j = 0; j + 1 < B.pts.length; j++) {
      const [x1, z1] = A.pts[i], [x2, z2] = A.pts[i + 1], [x3, z3] = B.pts[j], [x4, z4] = B.pts[j + 1];
      const den = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3); if (Math.abs(den) < 1e-9) continue;
      const t = ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / den, s = ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / den;
      if (t < -0.05 || t > 1.05 || s < -0.05 || s > 1.05) continue;
      const p = [x1 + (x2 - x1) * t, z1 + (z2 - z1) * t], d = Math.hypot(p[0] - SITE_CENTER[0], p[1] - SITE_CENTER[1]);
      if (!best || d < best.d) best = { p, d };
    }
    if (best && best.d > 5) return [(best.p[0] - SITE_CENTER[0]) / best.d, (best.p[1] - SITE_CENTER[1]) / best.d];
  } catch (e) { /* fall through */ }
  return [Math.SQRT1_2, Math.SQRT1_2];
}
export const DEFAULT_VIEW = (() => {
  const [dx, dz] = streetCornerDir(), t = [SITE_CENTER[0], 22, SITE_CENTER[1]];
  const r = v => Math.round(v * 10) / 10;
  return { target: t, position: [r(t[0] + dx * 150), t[1] + 95, r(t[2] + dz * 150)], fov: 36 };
})();

// ------------------------------------------------------------------ floor bands and outlines
const clampFloor = (bId, floor) => Math.max(1, Math.min(topFloor(bId), floor));
// Floor band extents (y) used by pick meshes, highlight and floorBandBox. Floor −1 = the parking level.
function bandY(bId, floor) {
  if (floor === -1) return [floorY(bId, -1), 0];
  const f = clampFloor(bId, floor), y = floorY(bId, f);
  return [y, y + floorH(bId, f)];
}

// Polygon offset outward by d (each edge moved along its outward normal, neighbours intersected). Works for the slanted and
// arc-sampled outlines: near-collinear neighbours just take the moved vertex.
function offsetPoly(poly, d) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; area += x0 * z1 - x1 * z0; }
  const s = area > 0 ? 1 : -1;       // area > 0 ⇔ clockwise in (x, z) seen from above → outward = (dz, -dx)
  const n = poly.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n], L = Math.hypot(x1 - x0, z1 - z0) || 1e-9;
    const nx = s * (z1 - z0) / L, nz = -s * (x1 - x0) / L;
    lines.push({ p: [x0 + nx * d, z0 + nz * d], dir: [(x1 - x0) / L, (z1 - z0) / L], n: [nx, nz] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i];
    const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    if (Math.abs(den) < 0.05) { out.push(b.p); continue; }
    const t = ((b.p[0] - a.p[0]) * b.dir[1] - (b.p[1] - a.p[1]) * b.dir[0]) / den;
    const q = [a.p[0] + a.dir[0] * t, a.p[1] + a.dir[1] * t];
    // a very sharp corner would shoot the mitre far away: cap it
    out.push(Math.hypot(q[0] - b.p[0], q[1] - b.p[1]) > 4 * Math.abs(d) + 0.5 ? b.p : q);
  }
  return { pts: out, outward: lines.map(l => l.n) };
}

// Per (building, plate) caches — all floors served by one plate share them.
const _plateKey = (bId, floor) => { const p = plateOf(bId, floor) || typicalPlate(bId); return bId + '/' + (p ? p.id : '?'); };
const _pickPoly = new Map(), _edges = new Map();
function pickPolyOf(bId, floor) {
  const k = _plateKey(bId, floor);
  if (!_pickPoly.has(k)) { const fp = footprintOf(bId, floor); _pickPoly.set(k, fp.length >= 3 ? offsetPoly(fp, PICK_OFF).pts : []); }
  return _pickPoly.get(k);
}
// Facade edges of a floor: frames { o, U, V, L } with o = edge start, U along the edge, V = outward normal (kit helper).
function edgesOf(bId, floor) {
  const k = _plateKey(bId, floor);
  if (!_edges.has(k)) {
    const fp = footprintOf(bId, floor), out = fp.length >= 3 ? offsetPoly(fp, 0).outward : [];
    _edges.set(k, fp.map((p, i) => {
      const q = fp[(i + 1) % fp.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      return { o: p, U: L > 1e-6 ? [(q[0] - p[0]) / L, (q[1] - p[1]) / L] : [1, 0], V: out[i], L, i };
    }).filter(e => e.L > 1e-4));
  }
  return _edges.get(k);
}

export function floorBandBox(bId, floor) {
  const box = new THREE.Box3();
  if (!BUILDINGS[bId]) return box;
  const [y0, y1] = bandY(bId, floor);
  for (const [x, z] of pickPolyOf(bId, floor === -1 ? 1 : clampFloor(bId, floor))) {
    const [wx, wz] = localToWorld(bId, x, z);
    box.expandByPoint(new THREE.Vector3(wx, y0, wz)); box.expandByPoint(new THREE.Vector3(wx, y1, wz));
  }
  return box;
}

// ------------------------------------------------------------------ geometry buffer (kit)
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.a = []; this.i = []; }
  quad(q, n, uv, t) {
    let [a, b, c, d] = q;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) { [b, d] = [d, b]; uv = [uv[0], uv[3], uv[2], uv[1]]; }
    const k = this.p.length / 3;
    for (const v of [a, b, c, d]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.a.push(t.b, t.u, t.s); }
    for (const w of uv) this.uv.push(w[0], w[1]);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  // Horizontal polygon cap (any simple polygon [[x, z], …] in the buffer's frame) at height y; up = +1 / −1. UVs are metres.
  cap(poly, y, t, up = 1) {
    if (!poly || poly.length < 3) return;
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const k = this.p.length / 3;
    for (const [x, z] of poly) { this.p.push(x, y, z); this.n.push(0, up, 0); this.a.push(t.b, t.u, t.s); this.uv.push(x, z); }
    for (const [a, b, c] of tris) {
      const A = poly[a], B = poly[b], C = poly[c];
      const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);      // y of (B−A) × (C−A)
      if (ny * up >= 0) this.i.push(k + a, k + b, k + c); else this.i.push(k + a, k + c, k + b);
    }
  }
  get empty() { return !this.i.length; }
  geometry() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTag', new THREE.Float32BufferAttribute(this.a, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}
// point in a frame {o:[x,z], U:[x,z], V:[x,z]} at (u, y, v)
const P = (F, u, y, v) => [F.o[0] + F.U[0] * u + F.V[0] * v, y, F.o[1] + F.U[1] * u + F.V[1] * v];
// Axis box in a frame. faces: 'U' +u, 'u' -u, 'Y' +y, 'y' -y, 'V' +v, 'v' -v. UVs are metres from the box corner.
function box(buf, F, u0, u1, y0, y1, v0, v1, t, faces = 'uUyYvV') {
  const U3 = [F.U[0], 0, F.U[1]], V3 = [F.V[0], 0, F.V[1]], neg = a => [-a[0], -a[1], -a[2]];
  const du = u1 - u0, dy = y1 - y0, dv = v1 - v0;
  for (const f of faces) {
    if (f === 'U' || f === 'u') { const u = f === 'U' ? u1 : u0; buf.quad([P(F, u, y0, v0), P(F, u, y0, v1), P(F, u, y1, v1), P(F, u, y1, v0)], f === 'U' ? U3 : neg(U3), [[0, 0], [dv, 0], [dv, dy], [0, dy]], t); }
    if (f === 'V' || f === 'v') { const v = f === 'V' ? v1 : v0; buf.quad([P(F, u0, y0, v), P(F, u1, y0, v), P(F, u1, y1, v), P(F, u0, y1, v)], f === 'V' ? V3 : neg(V3), [[0, 0], [du, 0], [du, dy], [0, dy]], t); }
    if (f === 'Y' || f === 'y') { const y = f === 'Y' ? y1 : y0; buf.quad([P(F, u0, y, v0), P(F, u1, y, v0), P(F, u1, y, v1), P(F, u0, y, v1)], [0, f === 'Y' ? 1 : -1, 0], [[0, 0], [du, 0], [du, dv], [0, dv]], t); }
  }
}
// glass pane facing +v at plane v, uv 0..1
function pane(buf, F, u0, u1, y0, y1, v, t) {
  buf.quad([P(F, u0, y0, v), P(F, u1, y0, v), P(F, u1, y1, v), P(F, u0, y1, v)], [F.V[0], 0, F.V[1]], [[0, 0], [1, 0], [1, 1], [0, 1]], t);
}
function rand(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Buffer keys = material keys (CONTRACT §4.1). What each one looks like is in MATERIAL_KEYS / notes/T10.md.
const BUF_KEYS = ['wall', 'slab', 'stone', 'accent', 'crown', 'frame', 'glass', 'rail', 'soffit', 'roof', 'hvac', 'solar', 'hedge', 'led'];
const newBufs = () => Object.fromEntries(BUF_KEYS.map(k => [k, new Buf()]));

// The kit handed to exterior-tower.js and exterior-podium.js. The first ten names are the contract; the rest are extras.
const K = {
  THREE, Buf, box, pane, P, bandCode, unitIndex: UNIT_INDEX, rand, LEVELS, ROOF_BAND,
  // extras
  BUF_KEYS, PALETTE, BD,
  offsetPoly,                                             // (poly, d) → { pts, outward }
  edgesOf,                                                // (bId, floor) → [{ o, U, V, L, i }]  frames of the outline edges, V outward
  bandY,                                                  // (bId, floor) → [y0, y1]
  tag: (bId, band, unit = null, seed = 0) => ({ b: bandCode(bId, band), u: unit == null ? -1 : typeof unit === 'number' ? unit : (UNIT_INDEX.get(unit) ?? -1), s: seed }),
  roofTag: (bId, seed = 0) => ({ b: bandCode(BUILDINGS[bId] ? bId : B_IDS[0], ROOF_BAND), u: -2, s: seed }),
};
Object.freeze(K);

// ------------------------------------------------------------------ sibling modules (guarded)
// Loaded once at module evaluation. A missing file, a link error or a hang (import cycle) all end in `null` → fallback.
async function loadSibling(path, fn) {
  try {
    const mod = await Promise.race([import(path), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
    if (typeof mod[fn] !== 'function') throw new Error(fn + ' is not exported');
    return mod[fn];
  } catch (e) { console.warn('[exterior] ' + path + ' unavailable → fallback:', e?.message || e); return null; }
}
const [TOWER_FN, PODIUM_FN] = await Promise.all([
  loadSibling('./exterior-tower.js', 'buildTowerFacade'),
  loadSibling('./exterior-podium.js', 'buildPodium'),
]);

// ------------------------------------------------------------------ materials
const GH = LEVELS.groundH.toFixed(3), TH = LEVELS.typicalH.toFixed(3);
const GLSL_EXT_HEAD = /* glsl */`
uniform vec4 uHideB; uniform vec4 uHideU; uniform vec2 uHi; uniform sampler2D uUnitTex; uniform float uGlow; uniform float uLit; uniform float uTime; uniform vec3 uGold;
varying vec3 vTag; varying vec2 vUvE; varying vec3 vEW; varying vec3 vEN;
float ex_h(float n){ return fract(sin(mod(n, 4096.) * 12.9898 + floor(n / 4096.) * 1.618) * 43758.5453); }
bool ex_hidden(){
  vec4 db = abs(uHideB - vTag.x);
  if (db.x < .5 && (uHideU.x < -.5 || abs(vTag.y - uHideU.x) < .5)) return true;
  if (db.y < .5 && (uHideU.y < -.5 || abs(vTag.y - uHideU.y) < .5)) return true;
  if (db.z < .5 && (uHideU.z < -.5 || abs(vTag.y - uHideU.z) < .5)) return true;
  if (db.w < .5 && (uHideU.w < -.5 || abs(vTag.y - uHideU.w) < .5)) return true;
  return false;
}
`;
function extMaterial(kind, params, envBase, EXT_U) {
  const m = new (params.transmission ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)(params);
  m.userData.envBase = envBase;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, EXT_U, { uGlow: SHARED.uGlow, uLit: SHARED.uLit, uTime: SHARED.uTime });
    sh.defines = Object.assign(sh.defines || {}, { ['EXT_' + kind.toUpperCase()]: '' });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTag; varying vec3 vTag; varying vec2 vUvE; varying vec3 vEW; varying vec3 vEN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTag = aTag; vUvE = uv; vEW = (modelMatrix * vec4(position, 1.)).xyz; vEN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_EXT_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (ex_hidden()) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float exVert = 1. - abs(vEN.y);
        float exAlong = dot(vEW.xz, vec2(-vEN.z, vEN.x));          // metres along a vertical surface
        float exFy = (vEW.y - ${GH}) / ${TH};                       // floor-relative height (typical floors)
        #if defined(EXT_WALL) || defined(EXT_STONE) || defined(EXT_ACCENT) || defined(EXT_CROWN) || defined(EXT_SLAB)
          float exN = fract(sin(dot(floor(vEW.xz * 2.2) + floor(vEW.y * 2.2), vec2(12.99, 78.23))) * 43758.55);
          diffuseColor.rgb *= .975 + .05 * exN;
        #endif
        #if defined(EXT_WALL) || defined(EXT_CROWN) || defined(EXT_STONE)
          // porcelain-stoneware panel joints (1.2 m wide panels, a joint at every floor line and at mid-storey), anti-aliased
          {
            float fa = max(fwidth(exAlong), 1e-4), fy = max(fwidth(exFy), 1e-4);
            float dA = abs(fract(exAlong / 1.2 + .5) - .5) * 1.2, dY = abs(fract(exFy * 2. + .5) - .5) * ${TH} * .5;
            float j = max(1. - smoothstep(.01, .01 + fa * 1.5, dA), 1. - smoothstep(.01, .01 + fy * 2.4, dY));
            diffuseColor.rgb *= 1. - .15 * j * step(.5, exVert);
          }
        #endif
        #ifdef EXT_ACCENT
          // timber-look boards: 0.14 m vertical planks with a slight tone change per plank
          {
            float pl = floor(exAlong / .14), fa = max(fwidth(exAlong), 1e-4);
            float dA = abs(fract(exAlong / .14 + .5) - .5) * .14;
            diffuseColor.rgb *= (.9 + .2 * fract(sin(pl * 91.7) * 4375.85)) * (1. - .3 * (1. - smoothstep(.004, .004 + fa * 1.5, dA)) * step(.5, exVert));
          }
        #endif
        #ifdef EXT_SOLAR
          {
            vec2 c = vec2(abs(fract(vUvE.x / 1.02 + .5) - .5) * 1.02, abs(fract(vUvE.y / .8 + .5) - .5) * .8);
            vec2 cc = vec2(abs(fract(vUvE.x / .17 + .5) - .5) * .17, abs(fract(vUvE.y / .16 + .5) - .5) * .16);
            float g = max(1. - smoothstep(.015, .03, min(c.x, c.y)), .35 * (1. - smoothstep(.004, .012, min(cc.x, cc.y))));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.75, .78, .8), g * .8);
          }
        #endif
        #ifdef EXT_GLASS
          float exCur = 0.;
          {
            float sd0 = floor(vTag.z + .5);
            if (sd0 > .5 && sd0 < 10000.) {
              float c3 = ex_h(sd0 + 41.), side0 = min(vUvE.x, 1. - vUvE.x);
              exCur = c3 > .55 ? 1. - smoothstep(.1, .2, side0) : c3 < .22 ? .55 : c3 > .45 ? 1. - smoothstep(.3, .34, vUvE.x) : 0.;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.86, .82, .74), exCur * .9);
            }
          }
        #endif`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        #ifdef EXT_GLASS
          metalnessFactor *= 1. - exCur * .8;
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifdef EXT_GLASS
          roughnessFactor = mix(roughnessFactor, .75, exCur);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float hiF = (abs(vTag.x - uHi.x) < .5 || abs(vTag.x - uHi.y) < .5) ? 1. : 0.;
          float hiU = 0.;
          if (vTag.y > -.5) { float ui = floor(vTag.y + .5); hiU = texture2D(uUnitTex, vec2((mod(ui, 64.) + .5) / 64., (floor(ui / 64.) + .5) / 32.)).r; }
          float vert = 1. - abs(vEN.y);
          #if defined(EXT_WALL) || defined(EXT_STONE) || defined(EXT_ACCENT) || defined(EXT_CROWN) || defined(EXT_SLAB)
            // warm grazing uplight at the plinth + a faint city-light wash after dark
            totalEmissiveRadiance += vec3(1., .64, .34) * uGlow * vert * .5 * exp(-max(vEW.y, 0.) * .38);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1., .8, .58) * uGlow * .07;
            // soft wall-washer scallops thrown down from every soffit / ceiling downlight (period ≈ one bay)
            {
              float t = fract(exFy), sc = pow(max(0., cos(exAlong * 6.2832 / 2.6)), 3.);
              float fall = smoothstep(.15, .97, t) * (1. - smoothstep(.97, 1., t));
              float w = sc * fall * fall * step(${GH} + .1, vEW.y) * step(.5, vert);
              totalEmissiveRadiance += vec3(1., .66, .38) * uGlow * .45 * w * diffuseColor.rgb;
            }
          #endif
          #ifdef EXT_GLASS
            float sd = floor(vTag.z + .5);   // integer seed; varyings are not exact, so round before hashing
            if (sd > 10000.) {             // special glazing: 1xxxx shop, 2xxxx lobby, 3xxxx stair
              vec3 wc = sd > 30000. ? vec3(1., .9, .78) : vec3(1., .74, .46);
              // T32: shop / lobby panes were 1.9–2.3 × uGlow and tone-mapped to plain white boxes; now about the level of a lit flat
              float k = sd > 30000. ? .24 : sd > 20000. ? .46 : .38;
              totalEmissiveRadiance += wc * k * mix(.4, 1., smoothstep(0., 1., vUvE.y)) * (uGlow * 1.5 + .03);
            } else if (sd > .5) {          // seed 0 = glazing that never lights up (balcony screens, spandrels)
              float r1 = ex_h(sd), r2 = ex_h(sd + 17.), r3 = ex_h(sd + 41.);
              float lit = step(1. - uLit, r1);
              vec3 wc = mix(vec3(1., .46, .16), vec3(1., .7, .4), r2 * r2);
              float ceilG = mix(.4, 1., smoothstep(.15, 1., vUvE.y));
              float side = min(vUvE.x, 1. - vUvE.x);
              float curtain = r3 > .55 ? .45 + .55 * smoothstep(.02, .2, side) : 1.;
              float sheer = r3 < .22 ? .55 : 1.;
              totalEmissiveRadiance += wc * lit * (.4 + .6 * r2) * ceilG * curtain * sheer * uGlow * 1.3;
              totalEmissiveRadiance += vec3(.9, .65, .4) * .02 * uGlow;
            }
          #endif
          #ifdef EXT_SOFFIT
            float on = step(.45, ex_h(floor(vTag.y + .5) + 3.7)) + step(vTag.y, -.5) * .6;
            vec2 sp = vec2((fract(vUvE.x / 2.2) - .5) * 2.2, vUvE.y - .8);
            float dd = length(sp);
            totalEmissiveRadiance += vec3(1., .7, .42) * uGlow * on * (smoothstep(.13, .05, dd) * 10. + smoothstep(1.5, 0., dd) * .55);
          #endif
          #ifdef EXT_LED
            totalEmissiveRadiance += vec3(1., .72, .42) * (uGlow * 5. + .02);
          #endif
          totalEmissiveRadiance += uGold * (hiF * .5 + hiU * (.6 + .3 * sin(uTime * 3.2)));
        }`);
  };
  m.customProgramCacheKey = () => 'vr-ext-' + kind;
  return registerMaterial(m);
}

const PICK_MAT = new THREE.MeshBasicMaterial({ visible: false });

function mergeBoxes(parts) {
  const pos = [], nor = [], idx = [];
  for (const g of parts) {
    const k = pos.length / 3; const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + k);
    g.dispose();
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}

// ================================================================== fallback tower (CONTRACT §8)
// Each floor band = the floor's outline extruded: a wall quad per bay, a glass strip on bays owned by a flat (tagged with
// the unit, so setUnitHighlight works), a dark slab edge under every floor, caps wherever the plate changes.
function buildFallbackTower(bId, bufs) {
  const rnd = rand(7001 + 97 * B_IDS.indexOf(bId));
  const winSeed = () => 1 + Math.floor(rnd() * 9000);
  const floors = floorsOf(bId);
  for (const f of floors) {
    const [y0, y1] = bandY(bId, f), H = y1 - y0;
    for (const e of edgesOf(bId, f)) {
      const nb = Math.max(1, Math.ceil(e.L / 3.4)), w = e.L / nb;
      for (let k = 0; k < nb; k++) {
        const a = k * w, b = a + w, m = (a + b) / 2;
        const px = e.o[0] + e.U[0] * m - e.V[0] * 0.8, pz = e.o[1] + e.U[1] * m - e.V[1] * 0.8;
        let owner = null; try { owner = unitAtPoint(bId, f, px, pz); } catch (err) { owner = null; }
        const t = K.tag(bId, f, owner);
        box(bufs.wall, e, a, b, y0, y1, -0.3, 0, t, 'V');
        if (owner) {
          const t2 = { ...t, s: winSeed() };
          if (e.L < 1.6) pane(bufs.glass, e, a, b, y0 + 0.35, y1 - 0.1, 0.04, t2);                 // arc chords: curved glass corner
          else if (w > 1.1) pane(bufs.glass, e, a + 0.3, b - 0.3, y0 + 0.35 + (f === 1 ? 0.3 : 0), y1 - 0.35, 0.04, t2);
        } else if (f === 1 && w > 1.1) {
          pane(bufs.glass, e, a + 0.2, b - 0.2, y0 + 0.3, y1 - 0.6, 0.04, { ...t, s: 10001 });      // ground floor premises / lobby
        }
      }
      box(bufs.slab, e, 0, e.L, y0, y0 + Math.min(0.3, H), 0.06, 0.07, K.tag(bId, f), 'V');        // slab edge
    }
    // cap where the plate above is a different one (set-backs), tagged as roof so it never disappears with a floor
    const next = f < floors[floors.length - 1] ? plateOf(bId, f + 1) : null;
    if (next && next !== plateOf(bId, f)) bufs.roof.cap(footprintOf(bId, f), y1, K.roofTag(bId));
  }
  buildRoof(bId, bufs);
}

// Roof on the top plate outline: slab, parapet with a LED line, lift overrun over the core. Used by the fallback, and by
// the integrated path only when exterior-tower.js left the roof buffers empty.
function buildRoof(bId, bufs) {
  const B = BUILDINGS[bId], top = topFloor(bId), ry = roofY(bId), t = K.roofTag(bId);
  const py = Number.isFinite(B.parapetY) && B.parapetY > ry ? B.parapetY : ry + 1.1;
  bufs.roof.cap(footprintOf(bId, top), ry, t);
  for (const e of edgesOf(bId, top)) {
    box(bufs.crown, e, 0, e.L, ry, py, -0.25, 0, t, 'vV');
    box(bufs.crown, e, 0, e.L, py - 0.02, py, -0.25, 0, t, 'Y');
    box(bufs.led, e, 0, e.L, py - 0.14, py - 0.06, 0.012, 0.02, t, 'V');
  }
  const c = coresOf(bId, top)[0];
  if (c && Number.isFinite(c.x0)) {
    const ty = Number.isFinite(B.topY) && B.topY > py ? B.topY : ry + 3.4;
    box(bufs.hvac, { o: [c.x0, c.z0], U: [1, 0], V: [0, 1] }, 0, c.x1 - c.x0, ry, ty, 0, c.z1 - c.z0, t, 'uUYvV');
  }
}

// ================================================================== createComplex
// opts.modules: false → force the fallback (no sibling module is called); { tower, podium } → inject builders (tests).
export function createComplex(opts = {}) {
  const group = new THREE.Group(); group.name = 'vrc-complex';
  const towerFn = opts.modules === false ? null : (opts.modules?.tower ?? TOWER_FN);
  const podiumFn = opts.modules === false ? null : (opts.modules?.podium ?? PODIUM_FN);
  const unitTexData = new Uint8Array(64 * 32 * 4);
  const unitTex = new THREE.DataTexture(unitTexData, 64, 32, THREE.RGBAFormat);
  unitTex.magFilter = unitTex.minFilter = THREE.NearestFilter; unitTex.needsUpdate = true;
  // hide / highlight state of this complex, shared by all its materials
  const EXT_U = {
    uHideB: { value: new THREE.Vector4(-999, -999, -999, -999) },
    uHideU: { value: new THREE.Vector4(-1, -1, -1, -1) },
    uHi: { value: new THREE.Vector2(-999, -999) },
    uUnitTex: { value: unitTex },
    uGold: { value: new THREE.Color('#e0a84e') },
  };
  const mat = (kind, params, envBase = 0.9) => extMaterial(kind, params, envBase, EXT_U);
  const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

  // Shared by all towers and the podium. Day / dusk / night come from environment.js through SHARED (uGlow, uLit, env map).
  const COMMON = {
    slab: mat('slab', { color: '#2f3033', roughness: 0.7 }, 0.6),                          // dark slab / balcony edges
    accent: mat('accent', { color: PALETTE.timber, roughness: 0.7 }, 0.5),                 // timber-look fins and panels
    frame: mat('frame', { color: PALETTE.frame, roughness: 0.4, metalness: 0.6 }, 1),      // window frames, mullions
    glass: mat('glass', { color: PALETTE.glass, roughness: 0.06, metalness: 0.9 }, 0.9),
    rail: mat('rail', { color: '#b7c7cb', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }, 1),
    soffit: mat('soffit', { color: '#9a7b5b', roughness: 0.85 }, 0.5),                     // timber-look soffits
    roof: mat('roof', { color: '#8d8f90', roughness: 0.95 }, 0.4),
    hvac: mat('hvac', { color: '#a3a6a7', roughness: 0.5, metalness: 0.4 }, 0.8),   // T32: was #c4c6c6 — roof plant read as white placeholder cubes from above
    solar: mat('solar', { color: '#1a2438', roughness: 0.18, metalness: 0.5 }, 1.2),
    hedge: mat('hedge', { color: '#3c5a27', roughness: 0.95 }, 0.3),
    led: mat('led', { color: '#1a1814', roughness: 0.5 }, 0.2),
  };
  // Per tower: its own grey for the cladding, a darker plinth and a slightly darker crown.
  const toneSet = hex => ({
    ...COMMON,
    wall: mat('wall', { color: hex, roughness: 0.62 }, 0.6),
    stone: mat('stone', { color: shade(hex, 0.5), roughness: 0.55 }, 0.7),
    crown: mat('crown', { color: shade(hex, 0.8), roughness: 0.5, metalness: 0.15 }, 0.9),
  });
  const MB = Object.fromEntries(B_IDS.map(id => [id, toneSet(towerTone(id))]));
  const MP = toneSet(PALETTE.podium);
  const allMats = new Set([...Object.values(COMMON), ...Object.values(MP), ...B_IDS.flatMap(id => Object.values(MB[id]))]);

  const meshesOf = (bufs, M, prefix, parent) => {
    for (const k of BUF_KEYS) {
      const g = bufs[k] && bufs[k].geometry ? bufs[k].geometry() : null; if (!g) continue;
      const mesh = new THREE.Mesh(g, M[k]); mesh.name = `${prefix}-${k}`;
      mesh.castShadow = k !== 'rail' && k !== 'led'; mesh.receiveShadow = k !== 'rail';
      if (k === 'rail') mesh.renderOrder = 4;
      mesh.onBeforeRender = (r, s, cam) => refreshHide(cam);
      parent.add(mesh);
    }
  };

  const buildings = {}, pickables = [], info = { tower: {}, podium: 'none' };
  const pickGeo = new Map();
  for (const bId of B_IDS) {
    let bufs = null;
    if (towerFn) {
      try {
        bufs = newBufs(); towerFn(K, bId, bufs);
        if (bufs.wall.empty && bufs.glass.empty) throw new Error('no facade geometry');
        if (bufs.roof.empty && bufs.crown.empty) buildRoof(bId, bufs);
        info.tower[bId] = 'module';
      } catch (e) { console.warn(`[exterior] buildTowerFacade(${bId}) failed → fallback:`, e?.message || e); bufs = null; }
    }
    if (!bufs) {
      bufs = newBufs();
      try { buildFallbackTower(bId, bufs); info.tower[bId] = 'fallback'; }
      catch (e) { console.warn(`[exterior] fallback tower ${bId} failed:`, e?.message || e); info.tower[bId] = 'none'; }
    }
    const bg = new THREE.Group(); bg.name = 'bldg-' + bId;
    const b = BUILDINGS[bId]; bg.position.set(b.origin[0], 0, b.origin[1]); bg.rotation.y = b.rotY;
    meshesOf(bufs, MB[bId], bId, bg);
    // invisible pick volumes, one per floor ≥ 1, extruded from that floor's outline (unit-height geometry per plate)
    for (const f of floorsOf(bId)) {
      const poly = pickPolyOf(bId, f); if (poly.length < 3) continue;
      const key = _plateKey(bId, f);
      if (!pickGeo.has(key)) {
        const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        g.rotateX(-Math.PI / 2); pickGeo.set(key, g);
      }
      const [y0, y1] = bandY(bId, f);
      const pm = new THREE.Mesh(pickGeo.get(key), PICK_MAT); pm.visible = false; pm.name = `pick-${bId}-${f}`;
      pm.position.y = y0 + 0.01; pm.scale.y = y1 - y0 - 0.02;
      pm.userData.action = { type: 'floor', building: bId, floor: f };
      bg.add(pm); pickables.push(pm);
    }
    group.add(bg); buildings[bId] = bg;
  }

  // ---------------- podium, ramps, extras (world coordinates; not under bldg-*, so never a floor pick target)
  const podium = new THREE.Group(); podium.name = 'vrc-podium';
  if (podiumFn) {
    try { const bufs = newBufs(); podiumFn(K, bufs); meshesOf(bufs, MP, 'podium', podium); info.podium = podium.children.length ? 'module' : 'empty'; }
    catch (e) { console.warn('[exterior] buildPodium failed → no podium:', e?.message || e); podium.clear(); info.podium = 'none'; }
  }
  group.add(podium);
  group.updateMatrixWorld(true);

  // ---------------- floor highlight outlines (gold lines + glowing ribbon around the floor band).
  // Two sets: the selected floor (strong gold) and a lighter "hover / finger-down" preview, so a preview never hides the
  // current selection. The loop is rebuilt from the floor's own outline, cached per plate.
  function makeOutline(name, lineHex, lineBoost, ribHex, ribOpacity) {
    const root = new THREE.Group(); root.name = name; root.visible = false;
    const per = new Map();
    const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(lineHex).multiplyScalar(lineBoost), toneMapped: false, fog: false });
    const ribMat = new THREE.MeshBasicMaterial({ color: ribHex, transparent: true, opacity: ribOpacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const build = (bId, floor) => {
      const poly = offsetPoly(footprintOf(bId, floor), LINE_OFF).pts;
      const parts = [];
      for (let i = 0; i < poly.length; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; const L = Math.hypot(x1 - x0, z1 - z0);
        const g = new THREE.BoxGeometry(L + 0.24, 0.26, 0.26); g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); parts.push(g);
      }
      const loop = mergeBoxes(parts);
      const bot = new THREE.Mesh(loop, lineMat), top = new THREE.Mesh(loop, lineMat);
      const rp = [], ri = [];
      poly.forEach(([x, z], i) => { rp.push(x, 0, z, x, 1, z); const k = i * 2, n = ((i + 1) % poly.length) * 2; ri.push(k, n, k + 1, k + 1, n, n + 1); });
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setIndex(ri);
      const rib = new THREE.Mesh(rg, ribMat);
      const og = new THREE.Group(); og.name = name + '-' + _plateKey(bId, floor); og.add(bot, top, rib); og.userData = { bot, top, rib };
      og.traverse(o => { o.renderOrder = 6; o.raycast = () => {}; });   // never intercept picking
      root.add(og); return og;
    };
    group.add(root);
    // place on (bId, floor) or hide (floor == null)
    root.userData.set = (bId, floor) => {
      if (floor == null || !BUILDINGS[bId] || floor < 1 || floor > topFloor(bId)) { root.visible = false; return; }
      const key = _plateKey(bId, floor);
      if (!per.has(key)) per.set(key, build(bId, floor));
      const [y0, y1] = bandY(bId, floor), b = BUILDINGS[bId];
      root.position.set(b.origin[0], 0, b.origin[1]); root.rotation.y = b.rotY;
      for (const [k, og] of per) og.visible = k === key;
      const { bot, top, rib } = per.get(key).userData;
      bot.position.y = y0 + 0.05; top.position.y = y1 - 0.05; rib.position.y = y0; rib.scale.y = y1 - y0;
      root.visible = true;
    };
    return root;
  }
  const outline = makeOutline('floor-outline', '#ffd28a', 1.6, '#e0a84e', 0.32);
  const hoverOutline = makeOutline('floor-hover', '#fff1d0', 1.25, '#f3d9a4', 0.2);

  // ---------------- hide logic
  // A hidden floor band disappears completely while the camera is in the hall / outside; when the camera stands inside a
  // flat's 3D box (or on its balcony) only that flat's part of the facade is removed.
  const hidden = {};                // bId -> [floors]
  let lastCam = null, lastKey = '';
  const camLocal = new THREE.Vector3();
  function refreshHide(cam, force) {
    if (!cam) return;
    const key = cam.position.x.toFixed(2) + ',' + cam.position.y.toFixed(2) + ',' + cam.position.z.toFixed(2);
    if (!force && key === lastKey && cam === lastCam) return;
    lastKey = key; lastCam = cam;
    const B = EXT_U.uHideB.value, U = EXT_U.uHideU.value;
    const codes = [], units = [];
    for (const [bId, floors] of Object.entries(hidden)) {
      if (!floors || !floors.length) continue;
      const b = BUILDINGS[bId], c = Math.cos(b.rotY), s = Math.sin(b.rotY);
      const dx = cam.position.x - b.origin[0], dz = cam.position.z - b.origin[1];
      camLocal.set(dx * c - dz * s, cam.position.y, dx * s + dz * c);
      for (const f of floors) {
        let found = -1;
        for (const u of unitsOn(bId, f)) {
          const ox = camLocal.x - u.frame.o[0], oz = camLocal.z - u.frame.o[1];
          const uu = ox * u.frame.U[0] + oz * u.frame.U[1], vv = ox * u.frame.V[0] + oz * u.frame.V[1];
          if (uu > -0.05 && uu < u.width + 0.05 && vv > -0.2 && vv < u.depth + BD + 1.2) { found = UNIT_INDEX.get(u); break; }
        }
        codes.push(bandCode(bId, f)); units.push(found);
      }
    }
    B.set(codes[0] ?? -999, codes[1] ?? -999, codes[2] ?? -999, codes[3] ?? -999);
    U.set(units[0] ?? -1, units[1] ?? -1, units[2] ?? -1, units[3] ?? -1);
  }
  function setHiddenFloors(bId, floors) {
    if (!BUILDINGS[bId]) return;
    hidden[bId] = (floors || []).filter(f => f != null && f >= 1 && f <= topFloor(bId));
    refreshHide(lastCam, true);
    if (!lastCam) { // no render yet: hide whole bands until a camera is known
      const codes = []; for (const [id, fl] of Object.entries(hidden)) for (const f of fl || []) codes.push(bandCode(id, f));
      EXT_U.uHideB.value.set(codes[0] ?? -999, codes[1] ?? -999, codes[2] ?? -999, codes[3] ?? -999);
      EXT_U.uHideU.value.set(-1, -1, -1, -1);
    }
  }
  function setHiddenFloor(bId, floor) { setHiddenFloors(bId, floor == null ? [] : [floor]); }

  function highlightFloor(bId, floor) {
    if (floor == null || !BUILDINGS[bId] || floor < 1 || floor > topFloor(bId)) { EXT_U.uHi.value.set(-999, -999); outline.userData.set(null); return; }
    EXT_U.uHi.value.set(bandCode(bId, floor), -999);
    outline.userData.set(bId, floor);
  }
  // Lighter preview band (mouse hover / finger down on the 3D view); null hides it.
  function hoverFloor(bId, floor) { hoverOutline.userData.set(bId, floor); }
  function setUnitHighlight(ids) {
    unitTexData.fill(0);
    if (ids && ids.length) for (const id of ids) {
      const u = UNIT_BY_ID.get(id); if (!u) continue;
      const i = UNIT_INDEX.get(u); if (i >= 64 * 32) continue;
      unitTexData[i * 4] = 255;
    }
    unitTex.needsUpdate = true;
  }

  function dispose() {
    group.removeFromParent();
    group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of allMats) { SHARED.mats.delete(m); m.dispose(); }
    for (const o of [outline, hoverOutline]) o.traverse(x => x.material && x.material.dispose());
    unitTex.dispose();
  }

  return { group, buildings, podium, pickables, highlightFloor, hoverFloor, setHiddenFloor, setHiddenFloors, setUnitHighlight, dispose, info };
}
