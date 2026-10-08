// city.js — the real Uzhhorod in 3D for the walkthrough / driving mode (V8-city). Tile-streamed around the camera / car.
// Data and every query live in ./city-data.js (© OpenStreetMap contributors, ODbL); this module only draws.
//   createCity(scene, { mode, quality }) → { group, update(dt, focus, velocity), setMode, ensureTiles, onTileReady, tileReady, stats, dispose }
// Budgets (see notes/V8-city.md): tiles of 250 m; L0 (full detail) within R0, L1 (buildings only) within R1; one far-ground
// texture for everything beyond. Per L0 tile ≤ 7 draw calls (ground, road surfaces, markings, buildings, props, shopfront atlas,
// night pools), per L1 tile 1. All tile geometry is merged per tile and material; nothing is instanced per object.
import * as THREE from 'three';
import { SHARED } from './environment.js';
import { CITY, TILE, RIVER_Y, loadCity, cityTile, tileProps, offsetLine, pointAt, isOpen, setCityClock, cityHash as hash2, signalPosts, parkSpotsNear, SIGNAL_CYCLE, SIGNAL_GREEN, SIGNAL_AMBER, SIGNAL_REDAMBER } from './city-data.js';

const hyp = Math.hypot;
const _col = new Map();
function col(hex) { let c = _col.get(hex); if (!c) { const k = new THREE.Color(hex); c = [k.r, k.g, k.b]; _col.set(hex, c); } return c; }
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ------------------------------------------------------------------ geometry buffers
class Buf {
  constructor(extra) { this.p = []; this.n = []; this.c = []; this.a = extra ? [] : null; this.b = extra > 1 ? [] : null; this.uv = extra === 'uv' ? [] : null; if (extra === 'uv') this.a = null; }
  get count() { return this.p.length / 3; }
  tri(a, b, c, n, cl, ea, eb) {                       // winding follows the given normal (double-sided Lambert flips the normal of back faces → black)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    if ((uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0) { const t = b; b = c; c = t; }
    this.v(a, n, cl, ea, eb); this.v(b, n, cl, ea, eb); this.v(c, n, cl, ea, eb); }
  v(p, n, cl, ea, eb) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(cl[0], cl[1], cl[2]); if (this.a) { const e = ea || Z4; this.a.push(e[0], e[1], e[2], e[3]); } if (this.b) { const e = eb || Z4; this.b.push(e[0], e[1], e[2], e[3]); } }
  quad(a, b, c, d, n, cl, ea, eb) { this.tri(a, b, c, n, cl, ea, eb); this.tri(a, c, d, n, cl, ea, eb); }
  geometry() {
    if (!this.p.length) return null; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.a) g.setAttribute('aA', new THREE.Float32BufferAttribute(this.a, 4)); if (this.b) g.setAttribute('aB', new THREE.Float32BufferAttribute(this.b, 4)); if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}
const Z4 = [0, 0, 0, 0], UP = [0, 1, 0];
function tmpl(geo) { const g = geo.index ? geo.toNonIndexed() : geo; const o = { p: Array.from(g.attributes.position.array), n: Array.from(g.attributes.normal.array) }; geo.dispose(); if (g !== geo) g.dispose(); return o; }
let T_BOX, T_ICO, T_CONE, T_CYL;
function templates() { if (T_BOX) return; T_BOX = tmpl(new THREE.BoxGeometry(1, 1, 1)); T_ICO = tmpl(new THREE.IcosahedronGeometry(1, 0)); T_CONE = tmpl(new THREE.ConeGeometry(1, 1, 6, 1, true)); T_CYL = tmpl(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true)); }
/** Adds a template scaled (sx, sy, sz), rotated about y by `yaw`, moved to (x, y, z). grad: darken by height (0..1). */
function addT(buf, T, x, y, z, sx, sy, sz, yaw, cl, fx, grad = 0, nup = 0) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw), P = T.p, N = T.n;
  for (let i = 0; i < P.length; i += 3) {
    const px = P[i] * sx, py = P[i + 1] * sy, pz = P[i + 2] * sz, k = grad ? 1 - grad * (0.5 - P[i + 1]) : 1;
    buf.p.push(x + px * cs + pz * sn, y + py, z - px * sn + pz * cs); if (nup) { const nx = N[i] * cs + N[i + 2] * sn, ny = N[i + 1] + nup, nz = -N[i] * sn + N[i + 2] * cs, nl = Math.hypot(nx, ny, nz) || 1; buf.n.push(nx / nl, ny / nl, nz / nl); } else buf.n.push(N[i] * cs + N[i + 2] * sn, N[i + 1], -N[i] * sn + N[i + 2] * cs);
    buf.c.push(cl[0] * k, cl[1] * k, cl[2] * k);
    if (buf.a) { const e = fx || Z4; buf.a.push(e[0], e[1], e[2], e[3]); }
  }
}
const box = (buf, x, y, z, sx, sy, sz, yaw, cl, fx) => addT(buf, T_BOX, x, y + sy / 2, z, sx, sy, sz, yaw, cl, fx);

function triangulate(poly) { try { return THREE.ShapeUtils.triangulateShape(poly.map(p => ({ x: p[0], y: p[1] })), []); } catch (e) { return []; } }
function polyAreaS(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
/** Inward offset of a CCW (area > 0) ring by d (mitred, clamped); null when it collapses. */
function insetRing(poly, d) {
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    let e1x = b[0] - a[0], e1z = b[1] - a[1], e2x = c[0] - b[0], e2z = c[1] - b[1]; const l1 = hyp(e1x, e1z) || 1, l2 = hyp(e2x, e2z) || 1; e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
    const n1x = -e1z, n1z = e1x, n2x = -e2z, n2z = e2x;           // inward normals of a CCW ring (area > 0 in x,z)
    let mx = n1x + n2x, mz = n1z + n2z; const ml = hyp(mx, mz); if (ml < 1e-5) { out.push([b[0] + n1x * d, b[1] + n1z * d]); continue; }
    mx /= ml; mz /= ml; const k = Math.min(3, 1 / Math.max(0.3, mx * n1x + mz * n1z)); out.push([b[0] + mx * d * k, b[1] + mz * d * k]);
  }
  const A0 = polyAreaS(poly), A1 = polyAreaS(out); if (!(A1 * A0 > 0) || Math.abs(A1) < 0.02 * Math.abs(A0)) return null;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; if ((out[j][0] - out[i][0]) * (poly[j][0] - poly[i][0]) + (out[j][1] - out[i][1]) * (poly[j][1] - poly[i][1]) < 0) return null; }   // an edge flipped
  return out;
}

// ------------------------------------------------------------------ palettes
const PAL = {
  house: ['#e9e4d6', '#ded6c2', '#e6d9b8', '#d4cdbf', '#efe9dc', '#cdbfa5', '#d9c4a8', '#e3d2c0', '#c9d0c2'],
  oldtown: ['#e8d9a8', '#e6c98f', '#d9b8a0', '#cfd8c0', '#e9e2cf', '#d8c7b0', '#c9d3dd', '#e3b9a0', '#f0e6c8', '#d7c08a', '#c8b9a2', '#e2cdbd'],
  panel9: ['#c9c6bd', '#bfc2c2', '#d2ccbd', '#b9b6ad', '#c7cdd0'], panel5: ['#c9b9a0', '#b9a288', '#d3c8b4', '#a8927c', '#c4c0b6', '#bcae98'],
  apartments: ['#e4e0d8', '#d9d2c4', '#cfd6da', '#e8dccb', '#bfc7cc', '#e0cfb8'], retail: ['#d8d8d6', '#c4c8cc', '#e1ddd4', '#b8bcc0', '#d9cfc0'],
  industrial: ['#b9b7b0', '#a9aeb2', '#c2bcae', '#9aa0a4', '#b3ab9c'], civic: ['#e2d8c0', '#d8cfc0', '#e6e0d2', '#cfc6b4', '#dcd3c4'],
  church: ['#efe9da', '#e9dfc6', '#f2efe6'], castle: ['#cfc3a8'], station: ['#e3d6b4'], garage: ['#9c9a94', '#8f8a82', '#a59f95', '#86888a'], shed: ['#8f8a80', '#a39c8f', '#7f7b74'], canopy: ['#d9d9d6'],
  roofTile: ['#b5593f', '#a8523a', '#c0664a', '#9c4a36', '#c97152', '#a9644c', '#7d7168', '#8f7d70'], roofFlat: ['#56585c', '#4c4f54', '#62625f', '#5a5650'], roofMetal: ['#6f7478', '#7c8388', '#59636b', '#8a8f8c'],
};
const STYLE = { house: 1, oldtown: 2, panel: 3, apartments: 4, retail: 5, industrial: 6, civic: 7, church: 8, castle: 9, garage: 10, shed: 11, station: 12, canopy: 11 };
const pick = (arr, h) => col(arr[Math.floor(h * arr.length) % arr.length]);
const ROAD_COL = { asphalt: '#3b3c40', paving: '#8c857a', cobble: '#6c675f', gravel: '#8a8272' };
const AREA_COL = { park: '#557038', forest: '#3f5a2c', grass: '#64783f', cemetery: '#5d6b45', pitch: '#4f7d46', playground: '#b08a5a', parking: '#4a4b4e', industrial: '#7b7770', rail: '#6a655d', garden: '#5f7340', dirt: '#8b7d66',
  paved: '#85817a', yard: '#727a5a', scrub: '#55683a', sand: '#b9ad90', square: '#9a9388' };
const BASE_COL = '#717657';
const FASCIA = { pharmacy: '#2f7d4f', cafe: '#6b4a34', restaurant: '#7a2f2a', fastfood: '#b5542a', bar: '#3a2f4a', grocery: '#3d6b3a', supermarket: '#2f5d7d', bakery: '#a8743a', bank: '#2c3e5a', atm: '#2c3e5a', hair: '#7a4a6a', beauty: '#8a4a70',
  hotel: '#4a3a2a', clothes: '#3a3a3a', shoes: '#4a4038', flowers: '#5a7a3a', books: '#5a4030', phone: '#30506a', hardware: '#6a5a30', post: '#8a6a1a', clinic: '#2f6f7d', dentist: '#2f6f7d', fuel: '#3a3a3a', car: '#4a4a4a' };

// ------------------------------------------------------------------ materials
function makeMaterials(st) {
  const U = st.U;
  const flat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  flat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nfloat cH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat cN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(cH(i), cH(i+vec2(1,0)), f.x), mix(cH(i+vec2(0,1)), cH(i+vec2(1,1)), f.x), f.y); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= .86 + .2 * cN(vWP.xz * 1.9) + .1 * cN(vWP.xz * .21) - .05 * cH(floor(vWP.xz * 14.));');
  };
  flat.customProgramCacheKey = () => 'city-flat';
  const decal = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -20 });
  // buildings: procedural facades. aA = (u from wall centre, v above ground, style, seed)   aB = (wall length, floor height, floors, eave height)
  const bld = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  bld.onBeforeCompile = sh => {
    sh.uniforms.uNight = SHARED.uNight; sh.uniforms.uLitK = U.uLitK; sh.uniforms.uShop = U.uShop;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aA; attribute vec4 aB; varying vec4 vA; varying vec4 vB;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvA = aA; vB = aB;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vA; varying vec4 vB; uniform float uNight; uniform float uLitK; uniform float uShop;\nvec3 cEmis;\n' + GLSL_FACADE)
      .replace('#include <color_fragment>', '#include <color_fragment>\ncEmis = vec3(0.); if (vA.z > .5) diffuseColor.rgb = facade(diffuseColor.rgb);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cEmis;');
  };
  bld.customProgramCacheKey = () => 'city-bld';
  // props: aA = (glow, signal code, day-only, 0)
  const props = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  props.onBeforeCompile = sh => {
    sh.uniforms.uNight = SHARED.uNight; sh.uniforms.uTime = SHARED.uTime; sh.uniforms.uTerrace = U.uTerrace;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aA; varying float vGlow; uniform float uNight; uniform float uTime; uniform float uTerrace;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = aA.x * uNight;
        if (aA.y > .5) { float lamp = mod(aA.y, 4.), grp = mod(floor(aA.y / 4.), 2.), off = floor(aA.y / 8.);
          float ph = mod(uTime + off + grp * ${(SIGNAL_CYCLE / 2).toFixed(1)}, ${SIGNAL_CYCLE.toFixed(1)});
          float on = lamp > 2.5 ? step(ph, ${SIGNAL_GREEN.toFixed(1)}) : lamp > 1.5 ? (step(${SIGNAL_GREEN.toFixed(1)}, ph) * step(ph, ${(SIGNAL_GREEN + SIGNAL_AMBER).toFixed(1)}) + step(${(SIGNAL_CYCLE - SIGNAL_REDAMBER).toFixed(1)}, ph)) : step(${(SIGNAL_GREEN + SIGNAL_AMBER).toFixed(1)}, ph);
          vGlow = on > .5 ? 2.2 : -0.85; }
        if (aA.z > .5 && uTerrace < .5) transformed *= 0.;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vGlow < 0.) diffuseColor.rgb *= 1. + vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (vGlow > 0.) totalEmissiveRadiance += vColor.rgb * vGlow;');
  };
  props.customProgramCacheKey = () => 'city-props';
  const water = new THREE.MeshStandardMaterial({ color: '#31503f', roughness: 0.12, metalness: 0.0 });
  water.onBeforeCompile = sh => {
    sh.uniforms.uTime = SHARED.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform float uTime;\nfloat wH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat wN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(wH(i), wH(i+vec2(1,0)), f.x), mix(wH(i+vec2(0,1)), wH(i+vec2(1,1)), f.x), f.y); }')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ vec2 q = vWP.xz * .35 + vec2(uTime * .25, uTime * .06); float e = .35; float h0 = wN(q) + .5 * wN(q * 2.3 - uTime * .2); float hx = wN(q + vec2(e, 0.)) + .5 * wN((q + vec2(e, 0.)) * 2.3 - uTime * .2); float hz = wN(q + vec2(0., e)) + .5 * wN((q + vec2(0., e)) * 2.3 - uTime * .2);\n vec3 wn = normalize(vec3((h0 - hx) * .22, 1., (h0 - hz) * .22)); normal = normalize((viewMatrix * vec4(wn, 0.)).xyz); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= .8 + .35 * wN(vWP.xz * .05);');
  };
  water.customProgramCacheKey = () => 'city-water';
  water.userData.envBase = 1.3;
  const pool = new THREE.MeshBasicMaterial({ map: st.radial, color: new THREE.Color('#ffb467'), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -30, fog: true });
  return { flat, decal, bld, props, water, pool };
}
const GLSL_FACADE = `
float fH(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 facade(vec3 wall){
  float u = vA.x, v = vA.y, st = floor(vA.z + .5), seed = vA.w, len = vB.x, fh = vB.y, floors = vB.z, H = vB.w;
  vec3 c = wall; float fi = floor(v / fh), fv = v - fi * fh;
  float bw = 3.2, ww = 1.3, wh = 1.4, sill = 0.9; vec3 frame = vec3(.86, .85, .8); float litP = .32;
  if (st == 1.) { bw = 3.5; ww = 1.25; wh = 1.3; sill = .95; frame = fH(vec2(seed, 3.)) > .5 ? vec3(.9, .9, .88) : vec3(.3, .2, .14); litP = .4; }
  else if (st == 2.) { bw = 2.7; ww = 1.05; wh = fh * .52; sill = fh * .24; frame = vec3(.93, .91, .84); litP = .34; }
  else if (st == 3.) { bw = 3.2; ww = 1.5; wh = 1.4; sill = .85; frame = vec3(.9, .9, .9); litP = .42; }
  else if (st == 4.) { bw = 3.3; ww = 1.8; wh = 1.5; sill = .8; frame = vec3(.25, .26, .28); litP = .38; }
  else if (st == 5.) { bw = 4.; ww = 3.6; wh = 2.4; sill = .45; frame = vec3(.2, .21, .23); litP = .0; }
  else if (st == 6.) { bw = 3.4; ww = 3.; wh = 1.1; sill = max(1.5, H * .58); frame = vec3(.35, .37, .4); litP = .08; fh = 100.; fi = 0.; fv = v; floors = 1.; }
  else if (st == 7.) { bw = 3.; ww = 1.5; wh = fh * .52; sill = fh * .26; frame = vec3(.9, .88, .82); litP = .12; }
  else if (st == 8.) { bw = 5.2; ww = 1.1; wh = max(2.5, H * .45); sill = 2.4; frame = vec3(.75, .72, .65); litP = .1; fh = 100.; fi = 0.; fv = v; floors = 1.; }
  else if (st == 9.) { bw = 6.; ww = .8; wh = 1.2; sill = fh * .45; frame = vec3(.55, .5, .42); litP = .06; }
  else if (st == 10.) { bw = 3.3; ww = 2.5; wh = 2.05; sill = 0.05; frame = vec3(.3, .3, .3); litP = 0.; }
  else if (st == 12.) { bw = 3.4; ww = 1.6; wh = fh * .6; sill = fh * .2; frame = vec3(.93, .91, .84); litP = .5; }
  else if (st == 11.) { return c * (.92 + .1 * fH(vec2(floor(u * 3.), seed))); }
  // plinth, floor bands, cornice
  if (st != 10. && st != 6.) c *= v < .55 ? .78 : 1.;
  if (st == 2. || st == 12. || st == 7.) { if (fi < .5 && v > .55) c *= .93 - .04 * step(.5, fract(v * 2.2)); if (fv < .14 && fi > .5) c *= 1.1; if (v > H - .55) c = c * 1.12 + .03; }
  if (st == 3.) { float sx = abs(fract(u / bw + .5) - .5) * bw, sy = min(fv, fh - fv); if (sx < .035 || sy < .03) c *= .8; if (v > H - .7) c *= .85; }
  if (st == 6.) c *= .95 + .05 * step(.5, fract(u * 2.5));
  if (st == 9.) c *= .9 + .16 * fH(floor(vec2(u * 1.6, v * 2.5)));
  if (fi >= floors) return c;
  float nb = max(1., floor((len - 1.2) / bw)), usable = nb * bw, uu = u + usable * .5;
  if (uu < 0. || uu > usable || len < 2.2) return c;
  float bi = floor(uu / bw), fu = uu - bi * bw - bw * .5;
  float rnd = fH(vec2(bi * 1.7 + seed, fi * 3.1 + seed * .37));
  if (st == 3. || st == 4.) {                        // balconies / loggias in every third bay
    if (mod(bi + floor(seed * 7.), 3.) < .5 && fi > .5) { ww = bw * .78; if (abs(fu) < ww * .5 && fv < 1.05 && fv > .08) { vec3 pc = st == 3. ? mix(vec3(.72, .74, .72), vec3(.55, .62, .7), step(.5, fH(vec2(seed, 9.)))) : vec3(.5, .56, .6); return pc * (.9 + .15 * rnd); } sill = .08; wh = fh - .5; }
  }
  if (st == 5.) { if (fi > .5) { ww = 1.6; wh = 1.3; sill = 1.; bw = 4.; } }
  if (st == 1. && fi < .5 && bi == floor(nb * .5) && nb > 2.5 && fH(vec2(seed, 5.)) > .4) { ww = 1.; wh = 2.05; sill = .12; }   // a door
  float ax = abs(fu), y0 = fv - sill;
  bool inW = ax < ww * .5 && y0 > 0. && y0 < wh;
  if (st == 8. || st == 12.) { float r = ww * .5, cy = wh - r; if (y0 > cy) inW = inW && length(vec2(fu, y0 - cy)) < r; }
  if (st == 2. && !inW) { if (ax < ww * .5 + .16 && y0 > -.14 && y0 < wh + .22) c = mix(c, vec3(.95, .93, .86), .55); return c; }
  if (!inW) return c;
  if (st == 10.) { return vec3(.36, .38, .4) * (.8 + .25 * fH(vec2(bi, seed))) * (.94 + .06 * step(.5, fract(y0 * 5.))); }
  float fr = .07; bool isFrame = ax > ww * .5 - fr || y0 < fr || y0 > wh - fr || abs(fu) < .028 || (st != 5. && abs(y0 - wh * .68) < .025) || (st == 5. && fi < .5 && abs(fract(fu / 1.8 + .5) - .5) * 1.8 < .03);
  if (isFrame) return frame;
  vec3 glass = mix(vec3(.13, .17, .22), vec3(.32, .4, .48), .35 + .4 * y0 / wh) * (.8 + .4 * rnd);
  float lit = step(rnd, litP * uLitK);
  if (st == 5. && fi < .5) lit = uShop;
  if (lit > .5) { vec3 warm = mix(vec3(1., .78, .45), vec3(.95, .9, .75), fH(vec2(rnd, 4.))); float k = uNight * (.3 + .4 * fH(vec2(bi, fi + seed))); cEmis = warm * k * (.75 + .25 * step(.3, fract(fu * 1.3 + y0)));
    glass = mix(glass, warm * .6, .5 * uNight); }
  return glass;
}`;

// ------------------------------------------------------------------ canvas painting (far ground + tile ground)
function pathPoly(g, p) { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.closePath(); }
function pathLine(g, p) { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); }
const GEOM_CLS = new Set(['secondary', 'tertiary', 'residential', 'living', 'pedestrian']);
const isGeomRoad = r => GEOM_CLS.has(r.cls) || !!r.bridge;
/** Paints the ground of a world rectangle into a 2D context already transformed to world metres. far: also roads of every class and footprints. */
function paintGround(g, x0, z0, x1, z1, far, ppm) {
  g.fillStyle = BASE_COL; g.fillRect(x0, z0, x1 - x0, z1 - z0);
  const m = 40, hit = bb => bb[2] >= x0 - m && bb[0] <= x1 + m && bb[3] >= z0 - m && bb[1] <= z1 + m;
  const areas = [], blds = [], roads = [];
  if (far) { for (const a of CITY.areas) areas.push(a); for (const r of CITY.roads) if (!r.near) roads.push(r); for (const b of CITY.buildings) blds.push(b); }
  else { const seenA = new Set(), i0 = Math.floor((x0 - m) / TILE), i1 = Math.floor((x1 + m) / TILE), j0 = Math.floor((z0 - m) / TILE), j1 = Math.floor((z1 + m) / TILE);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const T = cityTile(i, j); if (!T) continue; for (const id of T.areas) if (!seenA.has(id)) { seenA.add(id); if (hit(CITY.areas[id].bb)) areas.push(CITY.areas[id]); }
      for (const id of T.bld) if (hit(CITY.buildings[id].bb)) blds.push(CITY.buildings[id]); for (const id of T.roads) if (!CITY.roads[id].near) roads.push(CITY.roads[id]); }
    areas.sort((a, b) => a.id - b.id); }
  // aprons: paved ground around the bigger buildings (old-town courts, estates), paths to house doors
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (!far) for (const b of blds) { if (b.near) continue; const k = b.kind; if (k === 'shed' || k === 'canopy') continue; g.strokeStyle = k === 'house' ? '#7d7c68' : k === 'oldtown' || k === 'church' || k === 'castle' || k === 'station' ? '#8f897e' : k === 'garage' || k === 'industrial' ? '#6f6c66' : '#7f7d74';
    g.lineWidth = k === 'house' ? 3 : k === 'oldtown' ? 16 : k === 'garage' ? 9 : 8; pathPoly(g, b.poly); g.stroke(); }
  for (const a of areas) { if (a.kind === 'water') continue; g.fillStyle = AREA_COL[a.kind] || BASE_COL; pathPoly(g, a.poly); g.fill();
    if (!far && a.kind === 'pitch') { g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 0.35; g.stroke(); }
    if (!far && a.kind === 'parking') { g.strokeStyle = 'rgba(230,230,225,.35)'; g.lineWidth = 0.3; g.stroke(); } }
  if (!far) { g.strokeStyle = 'rgba(235,235,228,.8)'; g.lineWidth = 0.12; g.lineCap = 'butt';             // bay lines of the car parks
    for (const sp of parkSpotsNear((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) * 0.75)) { if (sp.lot === undefined) continue; const fx = Math.sin(sp.heading), fz = Math.cos(sp.heading), rx = fz, rz = -fx;
      for (const e of [-1.3, 1.3]) { g.beginPath(); g.moveTo(sp.x + rx * e - fx * 2.5, sp.z + rz * e - fz * 2.5); g.lineTo(sp.x + rx * e + fx * 2.5, sp.z + rz * e + fz * 2.5); g.stroke(); } }
    g.lineCap = 'round'; }
  // roads painted on the ground: far = all of them; near = the small ones (service roads, footways, paths) — the streets are geometry
  const order = ['track', 'path', 'steps', 'footway', 'service', 'living', 'pedestrian', 'residential', 'tertiary', 'secondary'];
  for (const cls of order) for (const r of roads) { if (r.cls !== cls) continue; if (!far && isGeomRoad(r)) continue; if (r.tunnel && !r.car) continue;
    if (far && ppm * r.w < 0.5 && !r.car) continue;
    g.strokeStyle = r.cls === 'footway' || r.cls === 'steps' ? '#a09a8e' : r.cls === 'path' ? '#94896f' : r.cls === 'track' ? '#857b66' : ROAD_COL[r.surface] || ROAD_COL.asphalt;
    if (far && (r.swL || r.swR)) { g.strokeStyle = '#9d9a92'; g.lineWidth = r.w + r.swL + r.swR; pathLine(g, r.pts); g.stroke(); g.strokeStyle = ROAD_COL[r.surface] || ROAD_COL.asphalt; }
    g.lineWidth = Math.max(r.w, far ? 1.2 / ppm : 0); pathLine(g, r.pts); g.stroke(); }
  for (const r of CITY.rails) { if (!far && !hit([Math.min(...r.pts.map(p => p[0])), Math.min(...r.pts.map(p => p[1])), Math.max(...r.pts.map(p => p[0])), Math.max(...r.pts.map(p => p[1]))])) continue; if (!far) continue; g.strokeStyle = '#5c5750'; g.lineWidth = Math.max(3.2, 1.2 / ppm); pathLine(g, r.pts); g.stroke(); }
  if (far) for (const b of blds) { if (b.near) continue; g.fillStyle = b.roof === 'flat' ? '#5c5e61' : '#7d4b3a'; pathPoly(g, b.poly); g.fill(); }
  // water: holes (the river lies below, with its embankments)
  g.globalCompositeOperation = 'destination-out';
  for (const a of areas) { if (a.kind !== 'water') continue; pathPoly(g, a.poly); g.fill(); }
  { const s = CITY.seam, k = far ? 2 : 0.6; g.fillRect(s.x0 + k, s.z0 + k, s.x1 - s.x0 - 2 * k, s.z1 - s.z0 - 2 * k); }     // the hand-tuned plot scene shows through
  g.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------------ sign / shopfront atlas
const FONT = '"Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif';
function fitText(g, text, maxW, px, weight = '700') { let s = px; do { g.font = `${weight} ${s}px ${FONT}`; if (g.measureText(text).width <= maxW) break; s -= 1; } while (s > 7); return s; }
function drawFront(g, x, y, w, h, poi, sx) {         // an OPEN shopfront: fascia with the business type (+ own name), lit glazing, door
  const fasc = Math.round(h * 0.24), base = FASCIA[poi.cat] || '#3d4148';
  g.fillStyle = '#d9d4c8'; g.fillRect(x, y, w, h);
  g.fillStyle = base; g.fillRect(x, y, w, fasc); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w, 2);
  g.save(); g.translate(x + w / 2, y); g.scale(sx, 1); const tw = (w - 12) / sx;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f6f3ea';
  const type = (poi.sign || '').toUpperCase();
  if (poi.name && type) { fitText(g, type, tw, fasc * 0.5); g.fillText(type, 0, fasc * 0.32); g.fillStyle = 'rgba(246,243,234,.85)'; fitText(g, poi.name, tw, fasc * 0.34, '500'); g.fillText(poi.name, 0, fasc * 0.74); }
  else { const t = type || poi.name; fitText(g, t, tw, fasc * 0.62); g.fillText(t, 0, fasc * 0.52); }
  g.restore();
  // glazing with a warm interior
  const gy = y + fasc + 3, gh = h - fasc - 3 - Math.round(h * 0.06), doorW = Math.min(w * 0.3, 44 * sx), dx = x + (hash2(poi.id, 4) < 0.5 ? 6 : w - doorW - 6);
  const gr = g.createLinearGradient(0, gy, 0, gy + gh); gr.addColorStop(0, '#ffe7b0'); gr.addColorStop(0.55, '#e8c078'); gr.addColorStop(1, '#a8834a');
  g.fillStyle = '#2a2c30'; g.fillRect(x + 3, gy - 1, w - 6, gh + 2); g.fillStyle = gr; g.fillRect(x + 5, gy + 1, w - 10, gh - 2);
  g.fillStyle = 'rgba(90,60,30,.55)'; for (let i = 0; i < 5; i++) { const bx = x + 8 + (w - 16) * hash2(poi.id, i + 20), bw = 6 + 16 * hash2(poi.id, i + 30), bh = gh * (0.25 + 0.4 * hash2(poi.id, i + 40)); g.fillRect(bx, gy + gh - bh, bw, bh); }
  g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(x + w * 0.2, gy); g.lineTo(x + w * 0.42, gy); g.lineTo(x + w * 0.22, gy + gh); g.lineTo(x + w * 0.0 + 5, gy + gh); g.closePath(); g.fill();
  g.fillStyle = '#2a2c30'; for (let mx = x + w / 3; mx < x + w - 8; mx += w / 3) g.fillRect(mx - 1, gy, 2, gh);
  // door + «ВІДЧИНЕНО»
  g.fillStyle = '#23252a'; g.fillRect(dx, gy - 1, doorW, h - (gy - y) + 1); g.fillStyle = '#f3d9a0'; g.fillRect(dx + 3, gy + 2, doorW - 6, gh - 6); g.fillStyle = '#23252a'; g.fillRect(dx + doorW - 9, gy + gh * 0.5, 3, 12);
  const pw = doorW - 10, ph = Math.max(9, h * 0.085); g.fillStyle = '#1f7a3d'; g.fillRect(dx + 5, gy + gh * 0.24, pw, ph); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(dx + 5 + pw / 2, gy + gh * 0.24 + ph / 2 + 0.5); g.scale(sx, 1); fitText(g, 'ВІДЧИНЕНО', (pw - 2) / sx, ph * 0.72); g.fillText('ВІДЧИНЕНО', 0, 0); g.restore();
  g.fillStyle = '#6d6a63'; g.fillRect(x, y + h - Math.round(h * 0.06), w, Math.round(h * 0.06));
}
function drawClosed(g, x, y, w, h) {                 // generic closed glazing: shutters + «ЗАЧИНЕНО»
  g.fillStyle = '#1b1e23'; g.fillRect(x, y, w, h); for (let yy = y + 2; yy < y + h - 6; yy += 4) { g.fillStyle = '#3a3e45'; g.fillRect(x + 3, yy, w - 6, 2); }
  const pw = w * 0.42, ph = h * 0.16; g.fillStyle = '#8c1f1f'; g.fillRect(x + w / 2 - pw / 2, y + h * 0.42, pw, ph); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'ЗАЧИНЕНО', pw - 6, ph * 0.7); g.fillText('ЗАЧИНЕНО', x + w / 2, y + h * 0.42 + ph / 2 + 0.5);
  g.fillStyle = '#55524c'; g.fillRect(x, y + h - 5, w, 5);
}
function drawPlate(g, x, y, w, h, uk, en) {          // street-name plate: Ukrainian + transliteration
  g.fillStyle = '#f4f4f0'; g.fillRect(x, y, w, h); g.fillStyle = '#17408a'; g.fillRect(x + 2, y + 2, w - 4, h - 4); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, uk, w - 14, h * 0.44); g.fillText(uk, x + w / 2, y + h * 0.36); g.fillStyle = 'rgba(255,255,255,.85)'; fitText(g, en, w - 14, h * 0.26, '500'); g.fillText(en, x + w / 2, y + h * 0.76);
}
function drawGeneric(g, kind, x, y, s) {             // generic road signs in a square cell
  g.clearRect(x, y, s, s); const cx = x + s / 2, cy = y + s / 2;
  if (kind.startsWith('v')) { g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, s * 0.48, 0, 7); g.fill(); g.strokeStyle = '#c8201c'; g.lineWidth = s * 0.11; g.beginPath(); g.arc(cx, cy, s * 0.41, 0, 7); g.stroke(); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(s * 0.42)}px ${FONT}`; g.fillText(kind.slice(1), cx, cy + s * 0.03); }
  else if (kind === 'ped') { g.fillStyle = '#1c4fa0'; g.fillRect(x + 1, y + 1, s - 2, s - 2); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx, y + s * 0.14); g.lineTo(x + s * 0.88, y + s * 0.86); g.lineTo(x + s * 0.12, y + s * 0.86); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, y + s * 0.42, s * 0.055, 0, 7); g.fill(); g.fillRect(cx - s * 0.035, y + s * 0.47, s * 0.07, s * 0.18); g.lineWidth = s * 0.045; g.strokeStyle = '#111'; g.beginPath(); g.moveTo(cx, y + s * 0.64); g.lineTo(cx - s * 0.1, y + s * 0.8); g.moveTo(cx, y + s * 0.64); g.lineTo(cx + s * 0.1, y + s * 0.8); g.moveTo(x + s * 0.3, y + s * 0.83); g.lineTo(x + s * 0.7, y + s * 0.83); g.stroke(); }
  else if (kind === 'bus') { g.fillStyle = '#1c4fa0'; g.fillRect(x + 1, y + 1, s - 2, s - 2); g.fillStyle = '#fff'; g.fillRect(x + s * 0.14, y + s * 0.14, s * 0.72, s * 0.72); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(s * 0.6)}px ${FONT}`; g.fillText('А', cx, cy + s * 0.04); }
}
const GENERIC = ['v20', 'v30', 'v40', 'v50', 'v60', 'ped', 'bus'];

// ------------------------------------------------------------------ the city
export async function createCity(scene, opts = {}) {
  await loadCity(); templates(); parkSpotsNear(0, 0, 1);       // builds the parking-spot index now (load time), not inside a tile step
  const LOW = opts.quality ? opts.quality === 'low' : (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const R0_FULL = opts.r0 || (LOW ? 230 : 320), R1 = opts.r1 || (LOW ? 620 : 900), KEEP = 90;
  let R0 = opts.detail === 'far' ? -1 : R0_FULL;      // 'far' = buildings + the far ground texture only (balcony views of the walkthrough)
  const GROUND_PX = LOW ? 256 : 512, FRAME_MS = opts.frameMs || (LOW ? 5 : 6), ATLAS_K = LOW ? 0.5 : 1, MAX_FRONTS = LOW ? 40 : 110;
  const group = new THREE.Group(); group.name = 'vrc-city';
  const st = { U: { uLitK: { value: 1 }, uShop: { value: 0 }, uTerrace: { value: 1 } }, radial: null };
  { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); st.radial = new THREE.CanvasTexture(c); }
  const M = makeMaterials(st);
  if (SHARED.envMap) { M.water.envMap = SHARED.envMap; } SHARED.mats.add(M.water);
  let mode = opts.mode || SHARED.mode || 'day', disposed = false;
  const tilesLive = new Map(), readyCbs = [], waiters = [];
  const counters = { built: 0, dropped: 0, buildMs: 0, maxStepMs: 0, steps: 0, byStep: {} };

  // ---- far ground (one texture for the whole data box) + skirt + river
  const B = CITY.bounds;
  const far = (() => {
    const W = B.x1 - B.x0, H = B.z1 - B.z0, px = LOW ? 1024 : 2048, ppm = px / Math.max(W, H), cw = Math.round(W * ppm), ch = Math.round(H * ppm);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
    g.setTransform(ppm, 0, 0, ppm, -B.x0 * ppm, -B.z0 * ppm); paintGround(g, B.x0, B.z0, B.x1, B.z1, true, ppm);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = false;
    const geo = new THREE.PlaneGeometry(W, H); geo.rotateX(-Math.PI / 2); geo.translate((B.x0 + B.x1) / 2, -0.05, (B.z0 + B.z1) / 2);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'city-far-ground'; mesh.renderOrder = -2; group.add(mesh);
    // skirt beyond the data box
    const S = 9000, sb = new Buf(), c0 = col(BASE_COL), y = -0.06;
    const rect = (x0, z0, x1, z1) => sb.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], UP, c0);
    rect(-S, -S, S, B.z0); rect(-S, B.z1, S, S); rect(-S, B.z0, B.x0, B.z1); rect(B.x1, B.z0, S, B.z1);
    const sm = new THREE.Mesh(sb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true })); sm.name = 'city-skirt'; group.add(sm);
    return { mesh, tex, sm };
  })();
  (() => {                                            // water + embankments (all of it: 26 polygons)
    const wb = new Buf(), bb = new Buf(), cw = col('#ffffff'), stone = col('#8d8a80'), slope = col('#6f745c'), bed = col('#4a4f40');
    for (const a of CITY.areas) { if (a.kind !== 'water') continue; const poly = polyAreaS(a.poly) > 0 ? a.poly : a.poly.slice().reverse();
      const big = (a.bb[2] - a.bb[0]) * (a.bb[3] - a.bb[1]) > 4000, y = big ? RIVER_Y : -0.9;
      for (const t of triangulate(poly)) wb.tri([poly[t[0]][0], y, poly[t[0]][1]], [poly[t[2]][0], y, poly[t[2]][1]], [poly[t[1]][0], y, poly[t[1]][1]], UP, cw);
      const outer = insetRing(poly, -1.3) || poly, inner = insetRing(poly, big ? 5.5 : 1.5) || poly, n = poly.length;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n;
        bb.quad([outer[i][0], 0.06, outer[i][1]], [outer[j][0], 0.06, outer[j][1]], [poly[j][0], 0.06, poly[j][1]], [poly[i][0], 0.06, poly[i][1]], UP, stone);
        const dx = poly[j][0] - poly[i][0], dz = poly[j][1] - poly[i][1], l = hyp(dx, dz) || 1, nn = [-dz / l * 0.5, 0.86, dx / l * 0.5];
        bb.quad([poly[i][0], 0.06, poly[i][1]], [poly[j][0], 0.06, poly[j][1]], [inner[j][0], y - 0.4, inner[j][1]], [inner[i][0], y - 0.4, inner[i][1]], nn, big ? slope : bed); } }
    const g1 = wb.geometry(); if (g1) { const m = new THREE.Mesh(g1, M.water); m.name = 'city-water'; group.add(m); }
    const g2 = bb.geometry(); if (g2) { const m = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.name = 'city-banks'; group.add(m); far.banks = m; }
  })();

  // ---- junction trims: where the pavements and markings of a road stop before a junction
  const trimCache = new Map();
  function trims(r) {                                 // → { a: [left, right], b: [left, right], cornersA, cornersB }
    let t = trimCache.get(r.id); if (t) return t; t = { a: [0, 0], b: [0, 0], corners: [] };
    for (const end of ['a', 'b']) {
      const node = CITY.graph.nodes[r[end]]; const arms = [];
      for (const eid of node.edges) { const e = CITY.roads[eid]; if (!isGeomRoad(e)) continue; for (const en of e.a === e.b ? ['a', 'b'] : [e.a === node.id ? 'a' : 'b']) { const p0 = en === 'a' ? e.pts[0] : e.pts[e.pts.length - 1], p1 = en === 'a' ? e.pts[1] : e.pts[e.pts.length - 2]; const l = hyp(p1[0] - p0[0], p1[1] - p0[1]) || 1; arms.push({ e, en, ux: (p1[0] - p0[0]) / l, uz: (p1[1] - p0[1]) / l, phi: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) }); } }
      if (arms.length < 2) continue; arms.sort((p, q) => p.phi - q.phi);
      const me = arms.findIndex(a => a.e === r && a.en === end); if (me < 0) continue;
      const calc = (i, j, sideOut) => {               // arm i, its +90° neighbour j (sideOut = +1) or −90° neighbour (−1)
        const A = arms[i], Bm = arms[j]; let th = (sideOut > 0 ? Bm.phi - A.phi : A.phi - Bm.phi); while (th <= 0) th += Math.PI * 2; if (th > Math.PI - 0.3 || th < 0.2) return 0;
        const h1 = A.e.w / 2, h2 = Bm.e.w / 2, s = Math.sin(th), c = Math.cos(th); return Math.max(0, Math.min(22, A.e.len * 0.45, (h2 + h1 * c) / s));
      };
      const nxt = (me + 1) % arms.length, prv = (me + arms.length - 1) % arms.length;
      const dR = calc(me, nxt, 1), dL = calc(me, prv, -1);        // outward: +90° side = right of the outward direction
      // outward right = right of a→b at end a, left of a→b at end b
      if (end === 'a') { t.a[1] = dR; t.a[0] = dL; } else { t.b[0] = dR; t.b[1] = dL; }
      // corner patch between me (its +90° side) and nxt (its −90° side) — owned by the arm with the smaller road id (or by me when equal)
      if (dR > 0 && arms.length >= 2) { const A = arms[me], Bm = arms[nxt]; const own = A.e.id < Bm.e.id || (A.e.id === Bm.e.id && end === 'a');
        if (own) { const swA = end === 'a' ? A.e.swR : A.e.swL, swB = Bm.en === 'a' ? Bm.e.swL : Bm.e.swR; if (swA > 0 && swB > 0) {
          const rAx = -A.uz, rAz = A.ux, lBx = Bm.uz, lBz = -Bm.ux, ix = node.x + A.ux * dR + rAx * A.e.w / 2, iz = node.z + A.uz * dR + rAz * A.e.w / 2;
          t.corners.push([[ix, iz], [ix + rAx * swA, iz + rAz * swA], [ix + rAx * swA + lBx * swB, iz + rAz * swA + lBz * swB], [ix + lBx * swB, iz + lBz * swB]]); } } }
    }
    trimCache.set(r.id, t); return t;
  }
  /** Part of a road axis between running lengths s0..s1. */
  function sub(r, s0, s1) { const out = []; if (s1 - s0 < 0.05) return out; const a = pointAt(r, s0), b = pointAt(r, s1); out.push([a.x, a.z]); for (let i = a.seg + 1; i <= b.seg; i++) if (r.cum[i] > s0 + 0.02 && r.cum[i] < s1 - 0.02) out.push(r.pts[i]); out.push([b.x, b.z]); return out; }

  // ---- tile builders (each returns nothing; they fill T.parts)
  function buildGround(T) {
    const px = GROUND_PX, ppm = px / TILE, c = document.createElement('canvas'); c.width = c.height = px; const g = c.getContext('2d');
    g.setTransform(ppm, 0, 0, ppm, -T.x0 * ppm, -T.z0 * ppm); paintGround(g, T.x0, T.z0, T.x0 + TILE, T.z0 + TILE, false, ppm);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.flipY = false;
    const geo = new THREE.PlaneGeometry(TILE, TILE); geo.rotateX(-Math.PI / 2); geo.translate(TILE / 2, 0, TILE / 2); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    mat.onBeforeCompile = M.flat.onBeforeCompile; mat.customProgramCacheKey = () => 'city-ground';
    const m = new THREE.Mesh(geo, mat); m.name = 'tile-ground'; m.renderOrder = -1; T.detail.add(m); T.own.push(tex, mat, geo);
  }
  function buildRoads(T) {
    const D = T.data, sb = new Buf(), db = new Buf(), ox = T.x0, oz = T.z0;
    const white = col('#e9e9e2'), pave = col('#a19e95'), kerbC = col('#b9b6ae'), railC = col('#55606a'), deckC = col('#77746d'), pierC = col('#8a877f');
    const P = (p, y) => [p[0] - ox, y, p[1] - oz];
    const strip = (buf, L, R, y, c) => { for (let i = 0; i < L.length - 1; i++) buf.quad(P(L[i], y), P(R[i], y), P(R[i + 1], y), P(L[i + 1], y), UP, c); };
    const wallStrip = (buf, L, y0, y1, c, flip) => { for (let i = 0; i < L.length - 1; i++) { const dx = L[i + 1][0] - L[i][0], dz = L[i + 1][1] - L[i][1], l = hyp(dx, dz) || 1, n = flip ? [dz / l, 0, -dx / l] : [-dz / l, 0, dx / l]; buf.quad(P(L[i], y0), P(L[i + 1], y0), P(L[i + 1], y1), P(L[i], y1), n, c); } };
    for (const id of D.roads) {
      const r = CITY.roads[id]; if (r.near || !isGeomRoad(r) || r.tunnel) continue;
      const rank = r.cls === 'secondary' ? 4 : r.cls === 'tertiary' ? 3 : r.cls === 'residential' ? 2 : 1, y = 0.03 + rank * 0.003, c = col(ROAD_COL[r.surface] || ROAD_COL.asphalt), hw = r.w / 2;
      const L = offsetLine(r.pts, -hw), R = offsetLine(r.pts, hw); strip(sb, L, R, y, c);
      for (const e of [0, r.pts.length - 1]) { const p = r.pts[e]; for (let k = 0; k < 8; k++) { const a0 = k / 8 * 6.2832, a1 = (k + 1) / 8 * 6.2832; sb.tri(P(p, y), P([p[0] + Math.cos(a0) * hw, p[1] + Math.sin(a0) * hw], y), P([p[0] + Math.cos(a1) * hw, p[1] + Math.sin(a1) * hw], y), UP, c); } }
      const tr = trims(r), py = 0.15;
      // pavements with kerbs
      for (const side of [1, -1]) { const sw = side > 0 ? r.swR : r.swL; if (sw <= 0) continue; const s0 = tr.a[side > 0 ? 1 : 0], s1 = r.len - tr.b[side > 0 ? 1 : 0]; const ax = sub(r, s0, s1); if (ax.length < 2) continue;
        const k = offsetLine(ax, hw * side), o = offsetLine(ax, (hw + sw) * side); strip(sb, k, o, py, pave); wallStrip(sb, k, y, py, kerbC, side > 0); }
      for (const q of tr.corners) sb.quad(P(q[0], py), P(q[1], py), P(q[2], py), P(q[3], py), UP, pave);
      // bridges: parapets, deck fascia, piers
      if (r.bridge) { const off = hw + Math.max(r.swL, r.swR, 0), over = r.pts.some(p => CITY.areas.some(a => a.kind === 'water' && p[0] > a.bb[0] && p[0] < a.bb[2] && p[1] > a.bb[1] && p[1] < a.bb[3]));
        for (const side of [1, -1]) { const o = offsetLine(r.pts, off * side), o2 = offsetLine(r.pts, (off + 0.25) * side); wallStrip(sb, o, py, py + 1.05, railC, side < 0); wallStrip(sb, o2, -1.0, py + 1.05, deckC, side > 0); strip(sb, o, o2, py + 1.05, railC);
          if (!(side > 0 ? r.swR : r.swL)) strip(sb, offsetLine(r.pts, hw * side), o, py, deckC); }
        if (over && r.len > 30) for (let s = 14; s < r.len - 10; s += 26) { const q = pointAt(r, s); box(sb, q.x - ox, RIVER_Y - 0.6, q.z - oz, 1.4, -RIVER_Y + 0.4, off * 2 - 0.6, Math.atan2(q.dx, q.dz) + Math.PI / 2, pierC); } }
      // markings on the asphalt streets
      if (r.car && r.surface === 'asphalt' && (r.cls === 'secondary' || r.cls === 'tertiary') && r.len > 12) {
        const m0 = Math.max(tr.a[0], tr.a[1]) + 0.6, m1 = r.len - Math.max(tr.b[0], tr.b[1]) - 0.6, n = r.lanesF + r.lanesB, lw = Math.min(3.5, r.w / Math.max(1, n)), Pk = n * lw, my = y + 0.012;
        const line = (off, wd, dash, gap, s0 = m0, s1 = m1) => { if (s1 - s0 < 1) return; if (!dash) { const ax = sub(r, s0, s1); strip(db, offsetLine(ax, off - wd / 2), offsetLine(ax, off + wd / 2), my, white); return; }
          for (let s = s0 + gap / 2; s + dash < s1; s += dash + gap) { const ax = sub(r, s, s + dash); strip(db, offsetLine(ax, off - wd / 2), offsetLine(ax, off + wd / 2), my, white); } };
        if (!r.oneway && n >= 2) { const cOff = -Pk / 2 + r.lanesB * lw; if (n >= 4) { line(cOff - 0.12, 0.1, 0, 0); line(cOff + 0.12, 0.1, 0, 0); } else { const sol = Math.min(18, (m1 - m0) * 0.25); line(cOff, 0.12, 0, 0, m0, m0 + sol); line(cOff, 0.12, 0, 0, m1 - sol, m1); line(cOff, 0.12, 3, 6, m0 + sol, m1 - sol); } }
        for (let k = 1; k < r.lanesF; k++) line(Pk / 2 - k * lw, 0.1, 2, 6); for (let k = 1; k < r.lanesB; k++) line(-Pk / 2 + k * lw, 0.1, 2, 6);
        if (r.cls === 'secondary') { line(hw - 0.25, 0.1, 0, 0); line(-hw + 0.25, 0.1, 0, 0); }
        // stop lines at signals
        for (const end of ['a', 'b']) { const nd = CITY.graph.nodes[r[end]]; if (nd.signal < 0) continue; const nl = end === 'b' ? r.lanesF : r.lanesB; if (!nl) continue; const s = end === 'a' ? m0 + 0.3 : m1 - 0.7; if (s < 0 || s + 0.4 > r.len) continue; const ax = sub(r, s, s + 0.4);
          const o0 = end === 'b' ? (r.oneway ? -Pk / 2 : -Pk / 2 + r.lanesB * lw) : -Pk / 2, o1 = end === 'b' ? Pk / 2 : -Pk / 2 + r.lanesB * lw; strip(db, offsetLine(ax, o0), offsetLine(ax, o1), my, white); }
      }
    }
    // zebra crossings
    for (const id of D.crossings) { const c = CITY.crossings[id]; if (!c.zebra) continue; const r = CITY.roads[c.road]; if (r.near || r.surface !== 'asphalt') continue; const wx = Math.sin(c.heading), wz = Math.cos(c.heading), tx = wz, tz = -wx, n = Math.max(3, Math.floor(c.len / 1.0)), y = 0.062;
      for (let k = 0; k < n; k++) { const o = -c.len / 2 + (k + 0.5) * c.len / n, cx = c.x + wx * o - ox, cz = c.z + wz * o - oz, hl = c.w / 2, hs = 0.25;
        db.quad([cx - tx * hl - wx * hs, y, cz - tz * hl - wz * hs], [cx + tx * hl - wx * hs, y, cz + tz * hl - wz * hs], [cx + tx * hl + wx * hs, y, cz + tz * hl + wz * hs], [cx - tx * hl + wx * hs, y, cz - tz * hl + wz * hs], UP, white); } }
    // railway: ballast + rails (bridges with girders)
    const ball = col('#6d675e'), steel = col('#3b3d40');
    for (const id of D.rails) { const r = CITY.rails[id]; const gauge = r.narrow ? 0.38 : 0.76, bw = r.narrow ? 1.1 : 1.7;
      const pts = r.pts; const inT = p => p[0] >= T.x0 - 1 && p[0] < T.x0 + TILE + 1 && p[1] >= T.z0 - 1 && p[1] < T.z0 + TILE + 1;
      const Lb = offsetLine(pts, -bw), Rb = offsetLine(pts, bw), L1 = offsetLine(pts, -gauge - 0.05), L2 = offsetLine(pts, -gauge + 0.05), R1 = offsetLine(pts, gauge - 0.05), R2 = offsetLine(pts, gauge + 0.05);
      for (let i = 0; i < pts.length - 1; i++) { const mid = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; if (!inT(mid)) continue;
        sb.quad(P(Lb[i], 0.045), P(Rb[i], 0.045), P(Rb[i + 1], 0.045), P(Lb[i + 1], 0.045), UP, ball);
        db.quad(P(L1[i], 0.075), P(L2[i], 0.075), P(L2[i + 1], 0.075), P(L1[i + 1], 0.075), UP, steel); db.quad(P(R1[i], 0.075), P(R2[i], 0.075), P(R2[i + 1], 0.075), P(R1[i + 1], 0.075), UP, steel);
        if (r.bridge) { for (const Ln of [offsetLine([pts[i], pts[i + 1]], -bw - 0.3), offsetLine([pts[i], pts[i + 1]], bw + 0.3)]) { wallStrip(sb, Ln, -1.2, 2.6, col('#4b5a52'), false); wallStrip(sb, Ln, -1.2, 2.6, col('#4b5a52'), true); } } } }
    const g1 = sb.geometry(); if (g1) { const m = new THREE.Mesh(g1, M.flat); m.name = 'tile-roads'; T.detail.add(m); T.own.push(g1); }
    const g2 = db.geometry(); if (g2) { const m = new THREE.Mesh(g2, M.decal); m.name = 'tile-markings'; T.detail.add(m); T.own.push(g2); }
  }

  function roofOf(buf, b, poly, h, rc, seed, ox, oz) {
    const P = (p, y) => [p[0] - ox, y, p[1] - oz], ZR = [0, 0, 0, 0];
    const cap = (pl, y, c) => { for (const t of triangulate(pl)) buf.tri(P(pl[t[0]], y), P(pl[t[2]], y), P(pl[t[1]], y), UP, c, ZR, ZR); };
    if (b.roof === 'flat' || poly.length < 3) { cap(poly, h, rc); if (b.kind === 'panel' || b.kind === 'apartments' || b.kind === 'civic' || b.kind === 'retail') { const ins = insetRing(poly, 0.35); if (ins) cap(ins, h + 0.02, shade(rc, 0.82)); } return h; }
    let minD = 1e9; { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; const a = poly[0], bq = poly[1]; let ux = bq[0] - a[0], uz = bq[1] - a[1]; const l = hyp(ux, uz) || 1; ux /= l; uz /= l; for (const p of poly) { const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux; x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v); } minD = Math.min(x1 - x0, z1 - z0); }
    const steep = b.kind === 'church' ? 1.25 : b.kind === 'oldtown' || b.kind === 'castle' || b.kind === 'station' ? 0.72 : 0.62;
    if (poly.length === 4) {                           // true gable / hip on a quadrilateral
      const e = [0, 1, 2, 3].map(i => hyp(poly[(i + 1) % 4][0] - poly[i][0], poly[(i + 1) % 4][1] - poly[i][1])); const longFirst = e[0] + e[2] >= e[1] + e[3];
      const q = longFirst ? poly : [poly[1], poly[2], poly[3], poly[0]];           // q0→q1 is a long side
      const m01 = [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2], m30 = [(q[3][0] + q[0][0]) / 2, (q[3][1] + q[0][1]) / 2];
      const wid = hyp(q[2][0] - q[1][0], q[2][1] - q[1][1]), len = hyp(m01[0] - m30[0], m01[1] - m30[1]) || 1, rise = Math.min(b.kind === 'church' ? 9 : 5.5, wid / 2 * steep), inset = b.roof === 'hip' ? Math.min(len * 0.45, wid / 2) : 0;
      const dx = (m01[0] - m30[0]) / len, dz = (m01[1] - m30[1]) / len, r0 = [m30[0] + dx * inset, m30[1] + dz * inset], r1 = [m01[0] - dx * inset, m01[1] - dz * inset], y1 = h + rise;
      const nrm = (a, bb, c) => { const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } const l = hyp(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
      const face = (pts, c) => { const n = nrm(pts[0], pts[1], pts[2]); if (pts.length === 4) { buf.tri(pts[0], pts[1], pts[2], n, c, ZR, ZR); buf.tri(pts[0], pts[2], pts[3], n, c, ZR, ZR); } else buf.tri(pts[0], pts[1], pts[2], n, c, ZR, ZR); };
      face([P(q[0], h), P(q[1], h), P(r1, y1), P(r0, y1)], rc); face([P(q[2], h), P(q[3], h), P(r0, y1), P(r1, y1)], shade(rc, 0.9));
      const wc = b.roof === 'hip' ? shade(rc, 0.95) : buf._wall;
      face([P(q[1], h), P(q[2], h), P(r1, y1)], wc); face([P(q[3], h), P(q[0], h), P(r0, y1)], wc);
      return y1;
    }
    let d = Math.max(0.6, Math.min(minD * 0.42, 6)), ins = null; for (let k = 0; k < 3 && !ins; k++) { ins = insetRing(poly, d); if (!ins) d *= 0.5; }
    if (!ins) { cap(poly, h, rc); return h; }
    const rise = Math.min(b.kind === 'church' ? 8 : 5, d * steep * 1.15), y1 = h + rise, n = poly.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = poly[j][0] - poly[i][0], dz = poly[j][1] - poly[i][1], l = hyp(dx, dz) || 1, k = hyp(d, rise), nn = [dz / l * rise / k, d / k, -dx / l * rise / k];
      buf.quad(P(poly[i], h), P(poly[j], h), P(ins[j], y1), P(ins[i], y1), nn, i % 2 ? rc : shade(rc, 0.92), ZR, ZR); }
    cap(ins, y1, shade(rc, 0.85)); return y1;
  }
  function addBuilding(buf, b, ox, oz) {
    const hs = hash2(b.id, 17), h2 = hash2(b.id, 29), style = STYLE[b.kind] || 11, poly = b.poly;
    let wc = b.kind === 'panel' ? pick(b.fl >= 7 ? PAL.panel9 : PAL.panel5, hs) : pick(PAL[b.kind] || PAL.shed, hs);
    const sloped = b.roof !== 'flat', rc = sloped ? (b.kind === 'church' ? col(h2 < 0.5 ? '#5f7f6a' : '#6a5a50') : b.kind === 'industrial' || b.kind === 'garage' || b.kind === 'shed' ? pick(PAL.roofMetal, h2) : pick(PAL.roofTile, h2)) : (b.kind === 'industrial' || b.kind === 'garage' || b.kind === 'retail' ? pick(PAL.roofMetal, h2) : pick(PAL.roofFlat, h2));
    const H = b.h, fh = b.kind === 'church' ? 100 : Math.max(2.4, (H - (b.kind === 'house' ? 0.4 : 0.7)) / Math.max(1, b.fl));
    buf._wall = wc;
    if (b.kind === 'canopy') { const y0 = H - 0.45, n = poly.length; for (const t of triangulate(poly)) { buf.tri([poly[t[0]][0] - ox, H, poly[t[0]][1] - oz], [poly[t[2]][0] - ox, H, poly[t[2]][1] - oz], [poly[t[1]][0] - ox, H, poly[t[1]][1] - oz], UP, wc, Z4, Z4); buf.tri([poly[t[0]][0] - ox, y0, poly[t[0]][1] - oz], [poly[t[1]][0] - ox, y0, poly[t[1]][1] - oz], [poly[t[2]][0] - ox, y0, poly[t[2]][1] - oz], [0, -1, 0], shade(wc, 0.7), Z4, Z4); }
      for (let i = 0; i < n; i++) { const a = poly[i], c = poly[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], l = hyp(dx, dz) || 1; buf.quad([a[0] - ox, y0, a[1] - oz], [c[0] - ox, y0, c[1] - oz], [c[0] - ox, H, c[1] - oz], [a[0] - ox, H, a[1] - oz], [dz / l, 0, -dx / l], shade(wc, 0.85), Z4, Z4);
        if (n <= 8 || i % Math.ceil(n / 6) === 0) { const cx = a[0] + (b.c[0] - a[0]) * 0.12, cz = a[1] + (b.c[1] - a[1]) * 0.12; for (let k = 0; k < T_BOX.p.length; k += 3) { buf.p.push(cx - ox + T_BOX.p[k] * 0.3, (T_BOX.p[k + 1] + 0.5) * y0, cz - oz + T_BOX.p[k + 2] * 0.3); buf.n.push(T_BOX.n[k], T_BOX.n[k + 1], T_BOX.n[k + 2]); buf.c.push(wc[0] * 0.8, wc[1] * 0.8, wc[2] * 0.8); buf.a.push(0, 0, 0, 0); buf.b.push(0, 0, 0, 0); } } }
      return; }
    const n = poly.length;
    for (let i = 0; i < n; i++) { const a = poly[i], c = poly[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], l = hyp(dx, dz); if (l < 0.05) continue; const nn = [dz / l, 0, -dx / l], seed = hs * 10 + i * 0.37, eb = [l, fh, b.fl, H];
      const A0 = [a[0] - ox, 0, a[1] - oz], C0 = [c[0] - ox, 0, c[1] - oz], C1 = [c[0] - ox, H, c[1] - oz], A1 = [a[0] - ox, H, a[1] - oz];
      const k = 0.94 + 0.08 * hash2(b.id, i), w2 = shade(wc, k);
      buf.v(A0, nn, w2, [-l / 2, 0, style, seed], eb); buf.v(C0, nn, w2, [l / 2, 0, style, seed], eb); buf.v(C1, nn, w2, [l / 2, H, style, seed], eb);
      buf.v(A0, nn, w2, [-l / 2, 0, style, seed], eb); buf.v(C1, nn, w2, [l / 2, H, style, seed], eb); buf.v(A1, nn, w2, [-l / 2, H, style, seed], eb); }
    const top = roofOf(buf, b, poly, H, rc, hs, ox, oz);
    // towers: churches (one or two), castle bastions, station centre block
    const tower = (cx, cz, s, th, spire, yaw, c2, r2) => { const hx = s / 2; const q = [[-hx, -hx], [hx, -hx], [hx, hx], [-hx, hx]].map(([x, z]) => [cx + x * Math.cos(yaw) + z * Math.sin(yaw), cz - x * Math.sin(yaw) + z * Math.cos(yaw)]);
      for (let i = 0; i < 4; i++) { const a = q[i], c = q[(i + 1) % 4], dx = c[0] - a[0], dz = c[1] - a[1], l = s, nn = [dz / l, 0, -dx / l], eb = [l, 100, 1, th], sd = hs * 3 + i; const A0 = [a[0] - ox, 0, a[1] - oz], C0 = [c[0] - ox, 0, c[1] - oz], C1 = [c[0] - ox, th, c[1] - oz], A1 = [a[0] - ox, th, a[1] - oz];
        buf.v(A0, nn, c2, [-l / 2, 0, 8, sd], eb); buf.v(C0, nn, c2, [l / 2, 0, 8, sd], eb); buf.v(C1, nn, c2, [l / 2, th, 8, sd], eb); buf.v(A0, nn, c2, [-l / 2, 0, 8, sd], eb); buf.v(C1, nn, c2, [l / 2, th, 8, sd], eb); buf.v(A1, nn, c2, [-l / 2, th, 8, sd], eb);
        const k = hyp(hx, spire), sn = [nn[0] * spire / k, hx / k, nn[2] * spire / k]; buf.tri([a[0] - ox, th, a[1] - oz], [c[0] - ox, th, c[1] - oz], [cx - ox, th + spire, cz - oz], sn, r2, Z4, Z4); } };
    if (b.kind === 'church' || b.kind === 'castle' || b.kind === 'station') {
      let best = 0, bl = 0; for (let i = 0; i < n; i++) { const l = hyp(poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]); if (l > bl) { bl = l; best = i; } }
      const a = poly[best], c = poly[(best + 1) % n], ux = (c[0] - a[0]) / bl, uz = (c[1] - a[1]) / bl, yaw = Math.atan2(-uz, ux); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const p of poly) { const u = (p[0] - b.c[0]) * ux + (p[1] - b.c[1]) * uz, v = -(p[0] - b.c[0]) * uz + (p[1] - b.c[1]) * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const W = v1 - v0, at = (u, v) => [b.c[0] + ux * u - uz * v, b.c[1] + uz * u + ux * v];
      if (b.kind === 'church') { const s = Math.max(3, Math.min(7, W * 0.42)), th = Math.max(H * 1.7, top + 4), r2 = col('#4f6f5e'); const two = /собор|катедр/i.test(b.name) && W > 14; const end = hash2(b.id, 3) < 0.5 ? u0 + s * 0.6 : u1 - s * 0.6;
        if (two) { tower(...at(end, v0 + s * 0.6), s, th, s * 1.5, yaw, shade(wc, 0.97), r2); tower(...at(end, v1 - s * 0.6), s, th, s * 1.5, yaw, shade(wc, 0.97), r2); } else if (W > 5) tower(...at(end, (v0 + v1) / 2), s, th, s * 1.7, yaw, shade(wc, 0.97), r2); }
      else if (b.kind === 'castle') { const s = Math.min(11, W * 0.2 + 4), r2 = col('#7a4434'); for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) tower(...at(u * 0.96, v * 0.96 + (v0 + v1) * 0.02), s, H + 3, 4, yaw, shade(wc, 0.92), r2); }
      else { const s = Math.min(12, W * 0.9), r2 = col('#6e3d30'); tower(...at((u0 + u1) / 2, (v0 + v1) / 2), s, top + 2.5, 3, yaw, wc, r2); }
    }
  }
  function buildBuildings(T, from, to) {
    const D = T.data, buf = T.bbuf || (T.bbuf = new Buf(2));
    for (let i = from; i < Math.min(to, D.bld.length); i++) { const b = CITY.buildings[D.bld[i]]; if (b.near) continue; try { addBuilding(buf, b, T.x0, T.z0); } catch (e) { /* one bad footprint must not stop the tile */ } }
    if (to >= D.bld.length) { const g = buf.geometry(); T.bbuf = null; if (g) { const m = new THREE.Mesh(g, M.bld); m.name = 'tile-buildings'; T.group.add(m); T.own.push(g); T.tris += g.attributes.position.count / 3; } }
  }

  function buildProps(T) {
    const D = T.data, buf = new Buf(1), pools = [], ox = T.x0, oz = T.z0, pr = tileProps(T.ix, T.iz);
    const trunk = col('#4a3b2e'), pole = col('#3d4144'), head = col('#ffd9a0');
    for (const [x, z, h, kind] of pr.trees) { const hh = hash2(x * 10 | 0, z * 10 | 0), yaw = hh * 6.28;
      if (kind === 1) { addT(buf, T_CYL, x - ox, h * 0.12, z - oz, 0.18, h * 0.24, 0.18, 0, trunk); addT(buf, T_CONE, x - ox, h * 0.6, z - oz, h * 0.22, h * 0.8, h * 0.22, yaw, col(hh < 0.5 ? '#3d5f38' : '#45683c'), null, 0.35, 0.9); }
      else { const cr = kind === 2 ? h * 0.36 : h * 0.33, g = col(['#4f6b2f', '#587436', '#466328', '#5e7a3a', '#6a8040'][Math.floor(hh * 5)]); addT(buf, T_CYL, x - ox, h * 0.25, z - oz, 0.16 + h * 0.012, h * 0.5, 0.16 + h * 0.012, 0, trunk);
        addT(buf, T_ICO, x - ox, h * 0.66, z - oz, cr, h * 0.36, cr, yaw, g, null, 0.3, 1.1);
        if (!LOW) { addT(buf, T_ICO, x - ox + Math.cos(yaw) * cr * 0.55, h * 0.56, z - oz + Math.sin(yaw) * cr * 0.55, cr * 0.72, h * 0.25, cr * 0.72, yaw + 1, shade(g, 0.92), null, 0.3, 1.1); addT(buf, T_ICO, x - ox - Math.cos(yaw + 0.9) * cr * 0.5, h * 0.74, z - oz - Math.sin(yaw + 0.9) * cr * 0.5, cr * 0.66, h * 0.24, cr * 0.66, yaw + 2, shade(g, 1.08), null, 0.25, 1.1); } } }
    // garden fences (generated, see tileProps): sheet metal / timber / concrete / mesh, with posts
    const FC = [col('#5d6f4f'), col('#7a5a3c'), col('#a9a69c'), col('#6f5647')];
    for (const [x1, z1, x2, z2, h, style] of pr.fences) { const dx = x2 - x1, dz = z2 - z1, l = hyp(dx, dz) || 1, yaw = Math.atan2(dx, dz), c = FC[style] || FC[0];
      box(buf, (x1 + x2) / 2 - ox, 0.08, (z1 + z2) / 2 - oz, 0.06, h - 0.08, l, yaw, c); if (!LOW) { box(buf, x1 - ox, 0, z1 - oz, 0.14, h + 0.1, 0.14, yaw, shade(c, 0.7)); box(buf, (x1 + x2) / 2 - ox, 0, (z1 + z2) / 2 - oz, 0.12, h + 0.06, 0.12, yaw, shade(c, 0.7)); } }
    for (const [x, z, hd, h] of pr.lamps) { const dx = Math.sin(hd), dz = Math.cos(hd), arm = h > 6 ? 1.6 : 0.5;
      box(buf, x - ox, 0, z - oz, 0.14, h, 0.14, 0, pole); box(buf, x - ox + dx * arm / 2, h - 0.1, z - oz + dz * arm / 2, 0.08, 0.08, arm, hd, pole); box(buf, x - ox + dx * arm, h - 0.22, z - oz + dz * arm, 0.3, 0.14, 0.55, hd, head, [3.2, 0, 0, 0]);
      pools.push([x + dx * arm, z + dz * arm, h > 6 ? 11 : 7]); }
    // traffic lights
    const lampC = [null, col('#ff2a1a'), col('#ffb000'), col('#19e06a')], dark = col('#17191b');
    for (const id of D.signals) { const s = CITY.signals[id];
      for (const [px, pz, hd, ai] of signalPosts(s)) { const a = s.arms[ai];
        const fx = -Math.sin(hd), fz = -Math.cos(hd);              // the head faces the approaching traffic
        box(buf, px - ox, 0, pz - oz, 0.12, 3.5, 0.12, 0, pole); box(buf, px - ox, 2.5, pz - oz, 0.34, 1.0, 0.3, hd, dark);
        for (let k = 1; k <= 3; k++) box(buf, px - ox + fx * 0.16, 3.5 - 0.02 - k * 0.3, pz - oz + fz * 0.16, 0.2, 0.2, 0.06, hd, lampC[k], [0, k + 4 * a.group + 8 * s.offset, 0, 0]); } }
    // bus shelters
    const glass = col('#8fa6b0'), roofC = col('#4d5357');
    for (const id of D.stops) { const s = CITY.busStops[id], hd = s.heading, bx = -Math.cos(hd), bz = Math.sin(hd);       // back = away from the road (right of travel)
      const cx = s.x + bx * 0.9 - ox, cz = s.z + bz * 0.9 - oz; box(buf, cx, 2.3, cz, 1.5, 0.1, 4, hd, roofC); box(buf, cx + bx * 0.7, 0.2, cz + bz * 0.7, 0.05, 2.1, 3.8, hd, glass);
      for (const e of [-1.9, 1.9]) box(buf, cx + Math.sin(hd) * e, 0, cz + Math.cos(hd) * e, 0.08, 2.3, 0.08, 0, pole); box(buf, cx + bx * 0.3, 0.42, cz + bz * 0.3, 0.4, 0.06, 2.6, hd, col('#7a5a3a')); }
    // kiosks for businesses without a building, awnings and terraces
    const wood = col('#6a5038'), tableC = col('#d8d2c4');
    for (const id of D.pois) { const p = CITY.pois[id]; const tx = p.nz, tz = -p.nx;
      if (p.b < 0 && p.cat !== 'church' && p.cat !== 'atm') { const cx = p.x - p.nx * 1.3 - ox, cz = p.z - p.nz * 1.3 - oz, yaw = Math.atan2(p.nx, p.nz); box(buf, cx, 0, cz, 3.2, 2.5, 2.4, yaw, col('#c9c6bc')); box(buf, cx, 2.5, cz, 3.6, 0.14, 2.8, yaw, roofC); }
      if (p.fw > 0 && (p.cat === 'cafe' || p.cat === 'bakery' || p.cat === 'flowers' || p.cat === 'grocery' || p.cat === 'restaurant') && hash2(p.id, 8) < 0.6) { const ac = col(['#8a2f2a', '#2f5a3a', '#c9b98a', '#2a3f5a'][Math.floor(hash2(p.id, 9) * 4)]), w = p.fw * 0.94, a = [p.x - ox - tx * w / 2, p.z - oz - tz * w / 2], b2 = [p.x - ox + tx * w / 2, p.z - oz + tz * w / 2];
        buf.quad([a[0], 2.75, a[1]], [b2[0], 2.75, b2[1]], [b2[0] + p.nx * 1.1, 2.35, b2[1] + p.nz * 1.1], [a[0] + p.nx * 1.1, 2.35, a[1] + p.nz * 1.1], [p.nx * 0.34, 0.94, p.nz * 0.34], ac); }
      if (p.terrace && p.b >= 0) for (let k = -1; k <= 1; k++) { if (Math.abs(k) * 1.9 > p.fw / 2 + 1.5) continue; const cx = p.x + p.nx * 1.7 + tx * k * 1.9 - ox, cz = p.z + p.nz * 1.7 + tz * k * 1.9 - oz, fl = [0, 0, 1, 0], yaw = Math.atan2(p.nx, p.nz);
        box(buf, cx, 0.7, cz, 0.7, 0.05, 0.7, yaw, tableC, fl); box(buf, cx, 0, cz, 0.07, 0.7, 0.07, 0, pole, fl); for (const e of [-0.62, 0.62]) { box(buf, cx + tx * e, 0, cz + tz * e, 0.4, 0.45, 0.4, yaw, wood, fl); box(buf, cx + tx * e * 1.3, 0.45, cz + tz * e * 1.3, 0.06, 0.4, 0.4, yaw, wood, fl); } }
    }
    // poles of the street-name plates and road signs (their faces are in the atlas mesh)
    for (const s of T.signPoles || []) box(buf, s[0] - ox, 0, s[1] - oz, 0.07, s[2], 0.07, 0, pole);
    const g = buf.geometry(); if (g) { const m = new THREE.Mesh(g, M.props); m.name = 'tile-props'; T.detail.add(m); T.own.push(g); T.tris += g.attributes.position.count / 3; }
    if (pools.length) { const pos = [], uv = []; for (const [x, z, r] of pools) { const X = x - ox, Zz = z - oz, y = 0.2; pos.push(X - r, y, Zz - r, X - r, y, Zz + r, X + r, y, Zz + r, X - r, y, Zz - r, X + r, y, Zz + r, X + r, y, Zz - r); uv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0); }
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); const m = new THREE.Mesh(pg, M.pool); m.name = 'tile-pools'; m.renderOrder = 4; m.visible = SHARED.uNight.value > 0; T.detail.add(m); T.own.push(pg); T.pools = m; }
  }

  function buildFronts(T) {
    const D = T.data, ox = T.x0, oz = T.z0;
    // what goes into the atlas
    const fronts = []; for (const id of D.pois) { const p = CITY.pois[id]; if (p.cat === 'church' || !(p.fw > 0 || p.b < 0)) continue; fronts.push(p); } if (fronts.length > MAX_FRONTS) fronts.length = MAX_FRONTS;
    const plates = [], signs = []; T.signPoles = [];
    for (const id of D.roads) { const r = CITY.roads[id]; if (r.near || !r.name.uk || !(r.car || r.cls === 'pedestrian') || r.cls === 'service' || r.len < 25) continue;
      for (const end of ['a', 'b']) { const nd = CITY.graph.nodes[r[end]]; if (nd.carDeg < 3 && !(r.cls === 'pedestrian' && nd.deg >= 3)) continue; if (hash2(r.id, end === 'a' ? 1 : 2) > (r.cls === 'residential' ? 0.5 : 0.8)) continue; if (plates.length >= 22) break;
        const tr = trims(r), back = Math.min(r.len * 0.4, Math.max(tr[end][0], tr[end][1]) + 2.5), q = pointAt(r, end === 'a' ? back : r.len - back), side = end === 'a' ? 1 : -1, off = r.w / 2 + (r.swR || 1) + 0.25;
        plates.push({ x: q.x - q.dz * off * side, z: q.z + q.dx * off * side, hd: Math.atan2(q.dx, q.dz), r }); }
      if (r.car && r.cls !== 'residential' && r.speed !== 50 && r.len > 60 && signs.length < 10) { const q = pointAt(r, 12), off = r.w / 2 + 0.9; signs.push({ x: q.x - q.dz * off, z: q.z + q.dx * off, hd: Math.atan2(q.dx, q.dz) + Math.PI, kind: 'v' + (GENERIC.includes('v' + r.speed) ? r.speed : 40) }); } }
    for (const id of D.crossings) { const c = CITY.crossings[id]; const r = CITY.roads[c.road]; if (!c.zebra || r.near || signs.length >= 26 || c.signal >= 0) continue; const q = pointAt(r, Math.max(0, Math.min(r.len, (roadS(r, c.x, c.z)))));
      for (const side of [1, -1]) { const off = r.w / 2 + 0.8; signs.push({ x: c.x - q.dz * off * side - q.dx * 2.2 * side, z: c.z + q.dx * off * side - q.dz * 2.2 * side, hd: Math.atan2(q.dx * side, q.dz * side) + Math.PI, kind: 'ped' }); } }
    for (const id of D.stops) { const s = CITY.busStops[id]; signs.push({ x: s.x + Math.sin(s.heading) * 2.6, z: s.z + Math.cos(s.heading) * 2.6, hd: s.heading + Math.PI, kind: 'bus' }); }
    if (!fronts.length && !plates.length && !signs.length) return;
    // atlas layout: row 0 generic signs + the closed glazing; then shopfront cells; then plates
    const cw = Math.round(256 * ATLAS_K), chh = Math.round(128 * ATLAS_K), ph = Math.round(64 * ATLAS_K), gs = Math.round(64 * ATLAS_K);
    const need = gs + Math.ceil(fronts.length / 4) * chh + Math.ceil(plates.length / 4) * ph; let AW = cw * 4, AH = 256; while (AH < need) AH *= 2;
    let cols = 4; if (AH > AW * 2) { AW *= 2; cols = 8; AH = 256; const need2 = gs + Math.ceil(fronts.length / 8) * chh + Math.ceil(plates.length / 8) * ph; while (AH < need2) AH *= 2; }
    const c = document.createElement('canvas'); c.width = AW; c.height = AH; const g = c.getContext('2d'); g.fillStyle = '#2a2c30'; g.fillRect(0, 0, AW, AH);
    GENERIC.forEach((k, i) => drawGeneric(g, k, i * gs, 0, gs)); const closedX = GENERIC.length * gs + 2, closedW = gs * 2 - 4; drawClosed(g, closedX, 0, closedW, gs);
    const buf = new Buf('uv'); const white = [1, 1, 1];
    const quad = (x, z, y0, y1, hw, rx, rz, nx, nz, u0, v0, u1, v1, dbl) => {        // a vertical quad centred on (x,z); (rx,rz) = viewer's right
      const a = [x - rx * hw - ox, y0, z - rz * hw - oz], b2 = [x + rx * hw - ox, y0, z + rz * hw - oz], c2 = [x + rx * hw - ox, y1, z + rz * hw - oz], d = [x - rx * hw - ox, y1, z - rz * hw - oz], n = [nx, 0, nz];
      const U0 = u0 / AW, U1 = u1 / AW, V0 = v0 / AH, V1 = v1 / AH;                                                 // flipY = false: v grows downwards in the canvas
      const push = (p, u, v) => { buf.p.push(p[0], p[1], p[2]); buf.n.push(n[0], n[1], n[2]); buf.c.push(1, 1, 1); buf.uv.push(u, v); };
      push(a, U0, V1); push(b2, U1, V1); push(c2, U1, V0); push(a, U0, V1); push(c2, U1, V0); push(d, U0, V0);
      if (dbl) { push(b2, U0, V1); push(a, U1, V1); push(d, U1, V0); push(b2, U0, V1); push(d, U1, V0); push(c2, U0, V0); }
    };
    void white;
    T.fronts = [];
    fronts.forEach((p, i) => { const cx = (i % cols) * cw, cy = gs + Math.floor(i / cols) * chh, fw = p.fw > 0 ? p.fw : 3;
      drawFront(g, cx + 1, cy + 1, cw - 2, chh - 2, p, Math.min(2.6, Math.max(1, (cw / chh) * 3.3 / fw)));
      const b = p.b >= 0 ? CITY.buildings[p.b] : null, hgt = Math.min(3.3, (b ? b.h : 2.5) - 0.15), e = p.b >= 0 ? 0.07 : -0.08, x = p.x + p.nx * e, z = p.z + p.nz * e, rx = p.nz, rz = -p.nx, fy = hgt * 0.76;
      const vSplit = cy + 1 + (chh - 2) * 0.24;
      quad(x, z, fy, hgt, fw / 2, rx, rz, p.nx, p.nz, cx + 1, cy + 1, cx + cw - 1, vSplit);                          // fascia (always the business's own)
      const k0 = buf.uv.length; quad(x, z, 0.02, fy, fw / 2, rx, rz, p.nx, p.nz, cx + 1, vSplit, cx + cw - 1, cy + chh - 1);    // glazing: open = own cell, closed = the generic shutters
      T.fronts.push({ p, k0, open: [(cx + 1) / AW, vSplit / AH, (cx + cw - 1) / AW, (cy + chh - 1) / AH], closed: [closedX / AW, 0, (closedX + closedW) / AW, gs / AH] }); });
    const py0 = gs + Math.ceil(fronts.length / cols) * chh;
    plates.forEach((s, i) => { const cx = (i % cols) * cw, cy = py0 + Math.floor(i / cols) * ph; drawPlate(g, cx + 1, cy + 1, cw - 2, ph - 2, s.r.name.uk, s.r.name.en); const rx = Math.sin(s.hd), rz = Math.cos(s.hd);
      quad(s.x, s.z, 2.55, 2.85, 0.62, rx, rz, -rz, rx, cx + 1, cy + 1, cx + cw - 1, cy + ph - 1, true); T.signPoles.push([s.x, s.z, 2.9]); });
    for (const s of signs) { const i = GENERIC.indexOf(s.kind); if (i < 0) continue; const rx = Math.cos(s.hd), rz = -Math.sin(s.hd); quad(s.x, s.z, 2.2, 2.85, 0.325, rx, rz, Math.sin(s.hd), Math.cos(s.hd), i * gs, 0, (i + 1) * gs, gs, false); T.signPoles.push([s.x, s.z, 2.85]); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.flipY = false;
    const geo = buf.geometry(); if (!geo) { tex.dispose(); return; }
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: frontGlow(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(geo, mat); m.name = 'tile-fronts'; T.detail.add(m); T.own.push(geo, mat, tex); T.frontMesh = m; T.frontMat = mat; applyOpen(T);
  }
  function roadS(r, x, z) { let best = 0, bd = 1e9; for (let i = 0; i < r.pts.length - 1; i++) { const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = hyp(x - a[0] - dx * t, z - a[1] - dz * t); if (d < bd) { bd = d; best = r.cum[i] + Math.sqrt(l2) * t; } } return best; }
  const frontGlow = () => (mode === 'day' ? 0.22 : mode === 'dusk' ? 0.85 : 1.0);
  function applyOpen(T) {                               // open / closed glazing by the city clock
    if (!T.frontMesh || !T.fronts) return; const uv = T.frontMesh.geometry.attributes.uv, A = uv.array;
    for (const f of T.fronts) { const r = isOpen(f.p) ? f.open : f.closed, k = f.k0, [u0, v0, u1, v1] = r; A[k] = u0; A[k + 1] = v1; A[k + 2] = u1; A[k + 3] = v1; A[k + 4] = u1; A[k + 5] = v0; A[k + 6] = u0; A[k + 7] = v1; A[k + 8] = u1; A[k + 9] = v0; A[k + 10] = u0; A[k + 11] = v0; }
    uv.needsUpdate = true; if (T.frontMat) T.frontMat.emissiveIntensity = frontGlow();
  }

  // ---- streaming
  function newTile(ix, iz) {
    const data = cityTile(ix, iz); if (!data) return null;
    const g = new THREE.Group(); g.position.set(ix * TILE, 0, iz * TILE); g.name = `tile ${ix}:${iz}`; const detail = new THREE.Group(); detail.name = 'detail'; g.add(detail);
    const T = { ix, iz, x0: ix * TILE, z0: iz * TILE, data, group: g, detail, own: [], level: -1, want: -1, steps: null, tris: 0, detailOwnFrom: 0, done1: false, done0: false };
    group.add(g); tilesLive.set(ix + ':' + iz, T); return T;
  }
  function* stepsL1(T) { const n = T.data.bld.length, CH = LOW ? 10 : 16; for (let i = 0; i < Math.max(1, n); i += CH) { buildBuildings(T, i, i + CH >= n ? Infinity : i + CH); yield; } T.done1 = true; T.detailOwnFrom = T.own.length; }
  function* stepsL0(T) { T.step = 'ground'; buildGround(T); yield; T.step = 'roads'; buildRoads(T); yield; T.step = 'fronts'; buildFronts(T); yield; T.step = 'propsData'; tileProps(T.ix, T.iz); yield; T.step = 'props'; buildProps(T); yield; T.step = 'bld'; T.done0 = true; }
  function dropDetail(T) { for (let i = T.detailOwnFrom; i < T.own.length; i++) T.own[i].dispose && T.own[i].dispose(); T.own.length = T.detailOwnFrom; T.detail.clear(); T.done0 = false; T.fronts = null; T.frontMesh = null; T.frontMat = null; T.pools = null; T.signPoles = null; }
  function dropTile(T) { for (const o of T.own) o.dispose && o.dispose(); group.remove(T.group); tilesLive.delete(T.ix + ':' + T.iz); counters.dropped++; }
  const queue = [];
  let lastFx = 1e9, lastFz = 1e9, fx = 0, fz = 0;
  function plan(x, z, force) {
    if (!force && hyp(x - lastFx, z - lastFz) < 20) return; lastFx = x; lastFz = z;
    const i0 = Math.floor((x - R1) / TILE), i1 = Math.floor((x + R1) / TILE), j0 = Math.floor((z - R1) / TILE), j1 = Math.floor((z + R1) / TILE);
    const dist = (ix, iz) => { const cx = Math.max(ix * TILE, Math.min(x, ix * TILE + TILE)), cz = Math.max(iz * TILE, Math.min(z, iz * TILE + TILE)); return hyp(cx - x, cz - z); };
    for (let ix = i0; ix <= i1; ix++) for (let iz = j0; iz <= j1; iz++) { const d = dist(ix, iz); if (d > R1) continue; let T = tilesLive.get(ix + ':' + iz); if (!T) T = newTile(ix, iz); if (!T) continue; T.want = Math.max(T.pin || -1, d <= R0 ? 0 : 1); }
    for (const T of [...tilesLive.values()]) { const d = dist(T.ix, T.iz); T.d = d;
      if (d > R1 + KEEP && !(T.pin >= 0)) { dropTile(T); continue; }
      if (d > R0 + KEEP && T.done0 && !(T.pin === 0)) { dropDetail(T); T.want = 1; T.steps0 = null; }
      else if (d <= R0) T.want = 0; }
    queue.length = 0; for (const T of tilesLive.values()) if (!T.done1 || (T.want === 0 && !T.done0)) queue.push(T);
  }
  function work(budgetMs) {
    const t0 = performance.now(); let did = 0;
    while (queue.length) {
      // nearest first; detail of the nearest tiles before far buildings
      let bi = 0, bs = 1e18; for (let i = 0; i < queue.length; i++) { const T = queue[i]; const dx = T.x0 + TILE / 2 - fx, dz = T.z0 + TILE / 2 - fz, s = hyp(dx, dz) + (!T.done1 ? 0 : 120); if (s < bs) { bs = s; bi = i; } }
      const T = queue[bi]; if (!tilesLive.has(T.ix + ':' + T.iz)) { queue.splice(bi, 1); continue; }
      const ts = performance.now();
      if (!T.done1) { if (!T.steps1) T.steps1 = stepsL1(T); T.steps1.next(); if (T.done1) { counters.built++; if (T.want !== 0) fire(T); } }
      else if (T.want === 0 && !T.done0) { if (!T.steps0) T.steps0 = stepsL0(T); T.steps0.next(); if (T.done0) { T.steps0 = null; fire(T); } }
      if (T.done1 && (T.want !== 0 || T.done0)) queue.splice(bi, 1);
      const dt = performance.now() - ts; counters.buildMs += dt; counters.steps++; if (dt > counters.maxStepMs) counters.maxStepMs = dt; { const k = T.step || 'bld'; if (!(counters.byStep[k] >= dt)) counters.byStep[k] = Math.round(dt); } did++;
      if (performance.now() - t0 >= budgetMs) break;
    }
    if (did && waiters.length) checkWaiters();
    return did;
  }
  function fire(T) { for (const cb of readyCbs) { try { cb({ ix: T.ix, iz: T.iz, x0: T.x0, z0: T.z0, size: TILE, group: T.group, level: T.done0 ? 0 : 1 }); } catch (e) { console.warn('[city] onTileReady', e); } } }
  function tilesIn(x, z, r) { const out = []; for (let ix = Math.floor((x - r) / TILE); ix <= Math.floor((x + r) / TILE); ix++) for (let iz = Math.floor((z - r) / TILE); iz <= Math.floor((z + r) / TILE); iz++) if (cityTile(ix, iz)) out.push([ix, iz]); return out; }
  function checkWaiters() { for (let i = waiters.length - 1; i >= 0; i--) { const w = waiters[i]; if (w.list.every(([ix, iz]) => { const T = tilesLive.get(ix + ':' + iz); return T && T.done1 && T.done0; })) { waiters.splice(i, 1); for (const [ix, iz] of w.list) { const T = tilesLive.get(ix + ':' + iz); if (T) T.pin = -1; } w.resolve(); } } }

  const api = {
    group, city: CITY,
    /** dt seconds; focus = Vector3 / camera / {x, z}; velocity (optional Vector3, m/s) → tiles ahead come first. */
    update(dt, focus, velocity) {
      if (disposed) return; const p = focus && focus.position ? focus.position : focus; if (!p) return;
      const la = velocity ? 1.6 : 0; fx = p.x + (velocity ? velocity.x * la : 0); fz = p.z + (velocity ? velocity.z * la : 0);
      plan(fx, fz, false); if (queue.length) work(FRAME_MS);
    },
    setMode(m) { mode = m; setCityClock({ mode: m }); st.U.uLitK.value = m === 'day' ? 0 : m === 'dusk' ? 1.25 : 0.55; st.U.uShop.value = m === 'night' ? 0.15 : 1; st.U.uTerrace.value = m === 'night' ? 0 : 1;
      M.pool.opacity = m === 'night' ? 0.62 : m === 'dusk' ? 0.4 : 0; for (const T of tilesLive.values()) { applyOpen(T); if (T.pools) T.pools.visible = m !== 'day'; } },
    /** Builds every tile touching the circle to full detail; resolves when done (work continues in update(); pass sync = true to finish now). */
    ensureTiles(x, z, r = 250, sync = false) {
      const list = tilesIn(x, z, r); for (const [ix, iz] of list) { const T = tilesLive.get(ix + ':' + iz) || newTile(ix, iz); if (T) { T.pin = 0; T.want = 0; if (!queue.includes(T) && !(T.done1 && T.done0)) queue.push(T); } }
      if (sync) { fx = x; fz = z; let guard = 0; while (queue.some(T => T.pin === 0) && guard++ < 5000) work(50); for (const [ix, iz] of list) { const T = tilesLive.get(ix + ':' + iz); if (T) T.pin = -1; } return Promise.resolve(); }
      return new Promise(resolve => { waiters.push({ list, resolve }); checkWaiters(); });
    },
    /** 'full' (streets, signs, shopfronts, props near the focus) | 'far' (building volumes only — cheap, for views from above). */
    setDetail(d) { const r = d === 'far' ? -1 : R0_FULL; if (r !== R0) { R0 = r; lastFx = 1e9; } }, get detail() { return R0 < 0 ? 'far' : 'full'; },
    onTileReady(cb) { readyCbs.push(cb); return () => { const i = readyCbs.indexOf(cb); if (i >= 0) readyCbs.splice(i, 1); }; },
    tileReady(x, z) { const T = tilesLive.get(Math.floor(x / TILE) + ':' + Math.floor(z / TILE)); return !!(T && T.done0); },
    stats() { let l0 = 0, l1 = 0, tris = 0, calls = 3; for (const T of tilesLive.values()) { if (T.done0) l0++; else if (T.done1) l1++; tris += T.tris; calls += T.group.children.length - 1 + T.detail.children.length; } return { tiles: tilesLive.size, l0, l1, calls, buildingTris: tris, queue: queue.length, ...counters, r0: R0, r1: R1 }; },
    dispose() { disposed = true; for (const T of [...tilesLive.values()]) dropTile(T); far.tex.dispose(); far.mesh.geometry.dispose(); far.mesh.material.dispose(); far.sm.geometry.dispose(); far.sm.material.dispose(); group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const k of Object.keys(M)) M[k].dispose(); SHARED.mats.delete(M.water); st.radial.dispose(); if (group.parent) group.parent.remove(group); },
  };
  api.setMode(mode);
  if (scene) scene.add(group);
  return api;
}
