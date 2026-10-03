// ЖК VILNYI (Ужгород) — shared building spaces, core module (T13 COMMONS-CORE).
// This file holds the shared KIT (textures, materials, geometry batching, colliders, walls, door leaves, lift cars and
// shafts, signage, intercom, mailboxes, concierge, lighting) and the public API. The geometry of one floor's common parts
// lives in commons-floor.js (buildTowerFloor) and the underground car park in commons-parking.js (buildTowerParking); both
// receive the KIT, so there are no circular imports. They are loaded with a dynamic import: when one is missing or throws,
// buildFloorCommons() builds a plain fallback floor here (hall rects + walls from hallEdgesOf + doors + lifts).
//
// Frames: the returned `group` sits at the building origin (y = 0) and holds a child (`root`) at y = floorY(bId, floor);
// all coordinates are building-local (x right, z DOWN the plan sheet — z is negative inside a plate, see data.js).
// Lift groups are building-local with absolute y (they are children of `group`). Every tower is a point tower with ONE
// core; a lift faces the hall along its own normal (two lifts of a core may face opposite ways). Floor 1 is the ground
// floor, −1 the car park; levels are per building (floorY(bId, f)).
// Static geometry is merged per material; collisions use invisible, chunked collider meshes (userData.solid / .floor).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BUILDINGS, B_IDS, LEVELS, PROJECT, PARKING, floorY, floorH, liftFloors, topFloor, isGround, floorLabel,
  coresOf, hallEdgesOf, plateOf, unitsOn, unitToLocal, unitYaw, localToWorld, worldToLocal,
} from '../data.js';

const TAU = Math.PI * 2;
const DOOR_W = 0.95, DOOR_H = 2.2;          // apartment entrance opening
const LIFT_W = 1.0, LIFT_H = 2.2, POCKET = 1.06; // landing opening, half-width of the door pocket in the wall
const CAR_DEPTH = 1.05;                     // car centre behind the landing door line (walk.js relies on this)
const WALL_T = 0.14, FACE = 0.02, SKIN = 0.018;

// ============================================================ small utils
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function hash2(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// periodic value noise (period px, py lattice cells) → tileable textures
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const mx = a => ((a % px) + px) % px, my = a => ((a % py) + py) % py;
  const a = hash2(mx(xi), my(yi), seed), b = hash2(mx(xi + 1), my(yi), seed);
  const c = hash2(mx(xi), my(yi + 1), seed), d = hash2(mx(xi + 1), my(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(u, v, px, py, seed, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(u * px * f, v * py * f, px * f, py * f, seed + o * 31); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texOf(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; return t;
}
function pixelCanvas(w, h, fn) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const col = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    fn(x / w, y / h, col); const i = (y * w + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}
const SERIF = '"Cormorant Garamond", "Bodoni Moda", Didot, Georgia, "Times New Roman", serif';
const SANS = '"Manrope", "Inter Tight", "Helvetica Neue", Arial, sans-serif';

// ============================================================ textures (cached for the session)
const TEX = {};
function cached(key, make) { return TEX[key] || (TEX[key] = make()); }

const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const texMarble = (dark = false) => cached(dark ? 'nero' : 'marble', () => texOf(pixelCanvas(768, 768, (u, v, c) => {
  const sd = dark ? 71 : 11;
  const w = fbm(u, v, 2, 2, sd, 5), w2 = fbm(u, v, 6, 6, sd + 2, 4);
  const a = 1 - Math.abs(Math.sin(TAU * (u + v) + w * 7 + w2 * 0.9));
  const core = sstep(0.972, 1, a), soft = sstep(0.8, 1, a);
  const a2 = 1 - Math.abs(Math.sin(TAU * (2 * u - v) + w * 4 + w2 * 2.2));
  const thin = sstep(0.988, 1, a2) * (0.35 + w2 * 0.8);
  const cloud = fbm(u, v, 4, 4, sd + 6, 5) - 0.5;
  if (dark) {
    const b = 16 + cloud * 14 + soft * 7; const k = clamp(core * 0.75 + thin * 0.6);
    c[0] = mix(b, 200, k); c[1] = mix(b, 196, k); c[2] = mix(b + 2, 188, k);
  } else {
    let r = 240 + cloud * 10, g = 237 + cloud * 10, bl = 231 + cloud * 11;
    const h = soft * 0.22; r = mix(r, 206, h); g = mix(g, 196, h); bl = mix(bl, 178, h);           // warm halo
    const k = clamp(core * 0.62 + thin * 0.5); r = mix(r, 138, k); g = mix(g, 136, k); bl = mix(bl, 134, k);   // grey vein
    c[0] = r; c[1] = g; c[2] = bl;
  }
})));
const texStone = () => cached('stone', () => {   // large-format porcelain, 2 × 2 tiles of 1.2 m (texture = 2.4 m)
  const c = pixelCanvas(512, 512, (u, v, c) => {
    const n = fbm(u, v, 5, 5, 5, 5) - 0.5, s = hash2((u * 512) | 0, (v * 512) | 0, 9) - 0.5;
    const t = Math.sin(TAU * (2 * u + v) + fbm(u, v, 6, 6, 21, 4) * 9); const vein = Math.pow(1 - Math.abs(t), 30) * 0.35;
    const b = 196 + n * 16 + s * 5 - vein * 34; c[0] = b; c[1] = b - 6; c[2] = b - 15;
  });
  const g = c.getContext('2d'); g.fillStyle = 'rgba(96,86,74,0.9)';
  for (const p of [0, 256]) { g.fillRect(p, 0, 1.5, 512); g.fillRect(0, p, 512, 1.5); }
  return texOf(c);
});
const texWalnut = () => cached('walnut', () => texOf(pixelCanvas(512, 512, (u, v, c) => {
  const w = fbm(u, v, 4, 1, 3, 4), w2 = fbm(u, v, 32, 2, 7, 3);
  const r = 0.5 + 0.5 * Math.sin(TAU * 41 * u + w * 5 + w2 * 1.5);
  const fleck = hash2((u * 512) | 0, (v * 48) | 0, 4) - 0.5;
  const k = clamp(Math.pow(r, 1.6) * 0.5 + w * 0.35 + fleck * 0.08);
  c[0] = mix(64, 112, k); c[1] = mix(41, 74, k); c[2] = mix(27, 48, k);
  if (Math.abs(u * 2 - Math.round(u * 2)) < 0.003) { c[0] *= 0.4; c[1] *= 0.4; c[2] *= 0.4; }
})));
const texFabric = () => cached('fabric', () => texOf(pixelCanvas(256, 256, (u, v, c) => {
  const x = (u * 256) | 0, y = (v * 256) | 0;
  const row = hash2(0, y, 3) - 0.5, col = hash2(x, 0, 5) - 0.5, p = hash2(x, y, 7) - 0.5;
  const n = fbm(u, v, 4, 4, 9, 3) - 0.5;
  const b = 172 + row * 9 + col * 5 + p * 7 + n * 12;
  c[0] = b; c[1] = b - 9; c[2] = b - 22;
})));
const texConcrete = () => cached('concrete', () => texOf(pixelCanvas(512, 512, (u, v, c) => {
  const n = fbm(u, v, 6, 6, 41, 5) - 0.5, s = hash2((u * 512) | 0, (v * 512) | 0, 43);
  const b = 168 + n * 18 + (s > 0.99 ? -30 : (s - 0.5) * 6); c[0] = b; c[1] = b - 1; c[2] = b - 4;
})));
const texEpoxy = () => cached('epoxy', () => texOf(pixelCanvas(512, 512, (u, v, c) => {
  const n = fbm(u, v, 4, 4, 51, 5) - 0.5, s = hash2((u * 512) | 0, (v * 512) | 0, 53) - 0.5;
  const b = 104 + n * 20 + s * 5; c[0] = b - 4; c[1] = b + 4; c[2] = b + 3;
})));
const texCarpet = () => cached('carpet', () => {        // runner: u along the length (2.6 m), v across (0..1)
  const c = pixelCanvas(512, 256, (u, v, c) => {
    const x = (u * 512) | 0, y = (v * 256) | 0, p = hash2(x, y, 61) - 0.5, n = fbm(u, v, 8, 4, 63, 3) - 0.5;
    // subtle lattice pattern
    const du = Math.abs(((u * 8 + v * 4) % 1) - 0.5), dv = Math.abs(((u * 8 - v * 4 + 10) % 1) - 0.5);
    const lat = (Math.min(du, dv) < 0.03) ? 9 : 0;
    const b = 34 + p * 10 + n * 8 + lat; c[0] = b + 2; c[1] = b + 4; c[2] = b + 8;
  });
  const g = c.getContext('2d');
  for (const [y, h, col] of [[10, 5, '#a8854a'], [20, 2, '#8c6c3a'], [241, 5, '#a8854a'], [234, 2, '#8c6c3a']]) { g.fillStyle = col; g.fillRect(0, y, 512, h); }
  return texOf(c);
});
const texGlow = () => cached('glow', () => {            // cove gradient across the tray (bright at both edges)
  const c = canvas(8, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.18, '#8a7a66'); gr.addColorStop(0.5, '#3a342c'); gr.addColorStop(0.82, '#8a7a66'); gr.addColorStop(1, '#ffffff');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256); return texOf(c, { repeat: false });
});
const texScallop = () => cached('scallop', () => {      // wall-wash from a downlight (additive decal)
  const c = canvas(128, 256), g = c.getContext('2d');
  const img = g.createImageData(128, 256), d = img.data;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {
    const u = (x - 63.5) / 64, v = y / 256;               // v=0 top (at the light)
    const top = Math.pow(clamp(1 - Math.abs(u) / (0.22 + v * 0.9)), 1.6);
    const fall = Math.pow(1 - v, 1.4) * clamp(v * 9);
    const a = clamp(top * fall * 1.1); const i = (y * 128 + x) * 4;
    d[i] = 255 * a; d[i + 1] = 214 * a; d[i + 2] = 160 * a; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return texOf(c, { repeat: false });
});
const texPool = () => cached('pool', () => {
  const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,214,160,1)'); gr.addColorStop(0.45, 'rgba(160,120,80,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return texOf(c, { repeat: false });
});
// Ambient-occlusion ramp (alpha): dark at v = 0 (the corner), gone by v = 1 — for wall/floor and wall/ceiling junctions.
const texAO = () => cached('ao', () => {
  const c = canvas(4, 128), g = c.getContext('2d'), img = g.createImageData(4, 128);
  for (let y = 0; y < 128; y++) { const t = y / 127, a = Math.pow(1 - t, 2.2) * (0.55 + 0.45 * (1 - t)); for (let x = 0; x < 4; x++) { const i = (y * 4 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255); img.data[i + 3] = 255; } }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.flipY = false; t.anisotropy = 8; return t;
});
const texBrushed = () => cached('brushed', () => texOf(pixelCanvas(64, 512, (u, v, c) => {
  const y = (v * 512) | 0, s = hash2(3, y, 91) * 0.55 + hash2((u * 4) | 0, y, 93) * 0.25 + fbm(u, v, 1, 16, 95, 3) * 0.2;
  const b = 236 + (s - 0.5) * 18; c[0] = b; c[1] = b; c[2] = b;
})));
// ---- finish textures: 'grand' (Calacatta Oro, ivory silk, navy carpet) and 'stone' (travertine, oak slats, limewash)
const texCalacatta = () => cached('calacatta', () => texOf(pixelCanvas(1024, 1024, (u, v, c) => {
  const w = fbm(u, v, 2, 2, 131, 5), w2 = fbm(u, v, 5, 5, 133, 4), cloud = fbm(u, v, 3, 3, 137, 4) - 0.5;
  const a = 1 - Math.abs(Math.sin(TAU * (0.7 * u + v) + w * 8.5 + w2 * 1.4));
  const core = sstep(0.965, 1, a), halo = sstep(0.72, 1, a);
  const a2 = 1 - Math.abs(Math.sin(TAU * (2 * u - 1 * v) + w * 5 + w2 * 3));
  const thin = sstep(0.985, 1, a2) * (0.25 + w2 * 0.9);
  let r = 247 + cloud * 6, g = 245 + cloud * 6, b = 240 + cloud * 7;
  const gh = halo * 0.38; r = mix(r, 214, gh); g = mix(g, 186, gh); b = mix(b, 132, gh);            // golden halo (Oro)
  const k = clamp(core * 0.8 + thin * 0.55); r = mix(r, 112, k); g = mix(g, 106, k); b = mix(b, 98, k);
  c[0] = r; c[1] = g; c[2] = b;
})));
const texTravertine = (floor = false) => cached(floor ? 'travF' : 'trav', () => {   // vein-cut travertine: horizontal bands + pores, 1.2 m slabs
  const c = pixelCanvas(512, 512, (u, v, c) => {
    const band = fbm(u * 0.15, v, 1, 9, floor ? 151 : 141, 4), fine = fbm(u, v, 3, 24, 143, 3) - 0.5;
    const s = 0.5 + 0.5 * Math.sin(TAU * v * 7 + band * 6);
    const pore = hash2((u * 160) | 0, (v * 512) | 0, 147) > 0.987 ? 1 : 0;
    let r = 224 + (s - 0.5) * 18 + fine * 10, g = 207 + (s - 0.5) * 17 + fine * 9, b = 178 + (s - 0.5) * 16 + fine * 8;
    if (pore) { r -= 46; g -= 44; b -= 40; }
    c[0] = r; c[1] = g; c[2] = b;
  });
  const g = c.getContext('2d'); g.fillStyle = 'rgba(150,128,98,0.85)';
  for (const p of [0, 256]) { g.fillRect(p, 0, 1.2, 512); g.fillRect(0, p, 512, 1.2); }
  return texOf(c);
});
const texOakSlat = () => cached('oakSlat', () => texOf(pixelCanvas(512, 512, (u, v, c) => {   // 1 m: 20 vertical oak slats with dark gaps
  const n = 20, x = u * n, i = Math.floor(x), f = x - i;
  const tone = hash2(i, 3, 161) - 0.5;
  const grain = 0.5 + 0.5 * Math.sin(TAU * (u * 160 + fbm(u * 4, v, 2, 3, 163 + i, 3) * 3));
  const fl = fbm(u * 8, v * 2, 4, 2, 167, 3) - 0.5;
  let r = 200 + tone * 26 + (grain - 0.5) * 16 + fl * 18, g = 162 + tone * 22 + (grain - 0.5) * 13 + fl * 15, b = 116 + tone * 18 + (grain - 0.5) * 10 + fl * 11;
  const edge = Math.min(f, 1 - f);
  if (edge < 0.11) { r = 46; g = 36; b = 28; } else if (edge < 0.16) { const k = 0.82; r *= k; g *= k; b *= k; }
  c[0] = r; c[1] = g; c[2] = b;
})));
const texOakFlat = () => cached('oakFlat', () => texOf(pixelCanvas(512, 512, (u, v, c) => {
  const w = fbm(u, v, 4, 1, 171, 4), r0 = 0.5 + 0.5 * Math.sin(TAU * 38 * u + w * 5);
  const k = clamp(Math.pow(r0, 1.5) * 0.45 + w * 0.4);
  c[0] = mix(178, 214, k); c[1] = mix(140, 176, k); c[2] = mix(98, 128, k);
})));
const texLimewash = () => cached('limewash', () => texOf(pixelCanvas(512, 512, (u, v, c) => {
  const n = fbm(u, v, 3, 3, 181, 5) - 0.5, m = fbm(u, v, 9, 9, 183, 3) - 0.5;
  const b = 222 + n * 34 + m * 9; c[0] = b + 5; c[1] = b - 3; c[2] = b - 16;
})));
const texSilk = () => cached('silk', () => texOf(pixelCanvas(256, 256, (u, v, c) => {   // ivory silk wallcovering (horizontal slub)
  const y = (v * 256) | 0, slub = hash2(0, y, 191) - 0.5, s2 = fbm(u, v, 2, 32, 193, 3) - 0.5, p = hash2((u * 256) | 0, y, 197) - 0.5;
  const b = 232 + slub * 7 + s2 * 10 + p * 3; c[0] = b + 2; c[1] = b - 3; c[2] = b - 14;
})));
const texBasalt = () => cached('basalt', () => texOf(pixelCanvas(512, 512, (u, v, c) => {
  const n = fbm(u, v, 6, 6, 201, 5) - 0.5, s = hash2((u * 512) | 0, (v * 512) | 0, 203);
  const b = 44 + n * 12 + (s > 0.97 ? 14 : 0); c[0] = b; c[1] = b - 1; c[2] = b - 2;
})));
const texCarpetV = (key, base, border, accent, lattice) => cached('carpet-' + key, () => {
  const c = pixelCanvas(512, 256, (u, v, c) => {
    const x = (u * 512) | 0, y = (v * 256) | 0, p = hash2(x, y, 211) - 0.5, n = fbm(u, v, 8, 4, 213, 3) - 0.5;
    const du = Math.abs(((u * 8 + v * 4) % 1) - 0.5), dv = Math.abs(((u * 8 - v * 4 + 10) % 1) - 0.5);
    const lat = (Math.min(du, dv) < 0.03) ? lattice : 0;
    c[0] = base[0] + p * 10 + n * 9 + lat; c[1] = base[1] + p * 10 + n * 9 + lat; c[2] = base[2] + p * 10 + n * 9 + lat;
  });
  const g = c.getContext('2d');
  for (const [y, h, col] of [[10, 6, border], [21, 2, accent], [240, 6, border], [233, 2, accent]]) { g.fillStyle = col; g.fillRect(0, y, 512, h); }
  return texOf(c);
});
function gold(g, x0, y0, x1, y1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, '#8a6a33'); gr.addColorStop(0.3, '#e9cf8e'); gr.addColorStop(0.5, '#b8924f'); gr.addColorStop(0.75, '#f3dca0'); gr.addColorStop(1, '#8f6d34');
  return gr;
}
// The brand mark of ЖК VILNYI, traced from the project logo (assets/brand/vilnyi-logo-new.svg: two folded planes on a
// base line — the emblem left of the wordmark), drawn in code so no image file is needed. Logo units are normalised to
// the emblem centre and 64 units per 1, so the mark fits a box of about ±1.07·s × ±0.98·s around (cx, cy).
const MARK = [
  [[0.189, 0.977], [-0.438, 0.975], [-1.066, 0.047], [-1.063, -0.977]],   // left plane
  [[0.302, 0.893], [-0.144, 0.471], [0.218, -0.374], [1.065, -0.892]],    // right plane
  [[-0.438, 0.888], [0.642, 0.888], [0.642, 0.977], [-0.438, 0.977]],     // base line
];
function drawMark(g, cx, cy, s, fill) {
  g.fillStyle = fill;
  for (const pts of MARK) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, cx + x * s, cy + y * s)); g.closePath(); g.fill(); }
}
const BRAND = [(PROJECT.brand && PROJECT.brand[0]) || 'VILNYI', (PROJECT.brand && PROJECT.brand[1]) || ''];   // ['VILNYI', 'УЖГОРОД']
const spaced = (s, n = 2) => [...s].join(' '.repeat(n));
const texWordmark = () => cached('wordmark', () => {
  const c = canvas(2048, 512);
  const draw = () => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 2048, 512);
    drawMark(g, 1024, 112, 100, gold(g, 900, 10, 1150, 220));
    g.fillStyle = gold(g, 0, 220, 2048, 420); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `500 200px ${SERIF}`;
    if ('letterSpacing' in g) g.letterSpacing = '34px';
    g.fillText(BRAND[0], 1024, 330);
    g.font = `500 74px ${SERIF}`; if ('letterSpacing' in g) g.letterSpacing = '36px';
    g.fillText(BRAND[1], 1024, 462);
    const hw = g.measureText(BRAND[1]).width / 2 + 60;
    g.fillRect(1024 - hw - 210, 460, 210, 4); g.fillRect(1024 + hw, 460, 210, 4);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  };
  draw();
  const t = texOf(c, { repeat: false });
  try { if (document.fonts && document.fonts.load) document.fonts.load(`500 150px "Cormorant Garamond"`, BRAND.join(' ')).then(f => { if (f && f.length) { draw(); t.needsUpdate = true; } }).catch(() => {}); } catch { /* optional */ }
  return t;
});
const texArt = (k) => cached('art' + k, () => {   // abstract canvases: black / gold / warm stone
  const c = canvas(512, 640), g = c.getContext('2d'), r = rng(101 + k * 7);
  const bgs = [['#1b1a18', '#2e2a25'], ['#d8cfc0', '#b9ab95'], ['#23282a', '#3c4441']][k % 3];
  const gr = g.createLinearGradient(0, 0, 512, 640); gr.addColorStop(0, bgs[0]); gr.addColorStop(1, bgs[1]); g.fillStyle = gr; g.fillRect(0, 0, 512, 640);
  for (let i = 0; i < 9; i++) {
    g.globalAlpha = 0.25 + r() * 0.55;
    g.fillStyle = [gold(g, 0, 0, 512, 640), '#f1e8d6', '#0e0d0c', '#8a6a3c', '#c8b28a'][(i + k) % 5];
    g.beginPath();
    const x = r() * 512, y = r() * 640, rad = 40 + r() * 200;
    if (i % 3 === 0) g.arc(x, y, rad, r() * TAU, r() * TAU + 2 + r() * 3);
    else { g.moveTo(x, y); g.bezierCurveTo(r() * 512, r() * 640, r() * 512, r() * 640, r() * 512, r() * 640); g.lineWidth = 6 + r() * 30; g.strokeStyle = g.fillStyle; g.stroke(); continue; }
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * 512, r() * 640, 2, 2); }
  return texOf(c, { repeat: false });
});
const texMailbox = () => cached('mailbox', () => {    // bronze mailbox wall: 8 × 6 doors
  const c = canvas(1024, 640), g = c.getContext('2d');
  g.fillStyle = '#2a2018'; g.fillRect(0, 0, 1024, 640);
  const cw = 1024 / 8, ch = 640 / 6;
  for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) {
    const x = i * cw + 5, y = j * ch + 5;
    const gr = g.createLinearGradient(x, y, x + cw, y + ch); gr.addColorStop(0, '#9c7a4c'); gr.addColorStop(0.5, '#c8a468'); gr.addColorStop(1, '#8a6a40');
    g.fillStyle = gr; g.fillRect(x, y, cw - 10, ch - 10);
    g.fillStyle = '#3a2c1d'; g.fillRect(x + 14, y + 16, cw - 38, 8);          // slot
    g.fillStyle = '#2d2318'; g.beginPath(); g.arc(x + cw - 28, y + ch - 30, 7, 0, TAU); g.fill();   // lock
    g.fillStyle = '#3a2c1d'; g.font = `600 20px ${SANS}`; g.fillText(String(j * 8 + i + 1), x + 14, y + ch - 24);
  }
  return texOf(c, { repeat: false });
});
// language-neutral pictograms: 0 stairs, 1 lift, 2 P, 3 arrow →, 4 EV bolt, 5 child (kindergarten), 6 lounge (amenity), 7 exit arrow up
const texSigns = () => cached('signs', () => {
  const c = canvas(1024, 128), g = c.getContext('2d');
  g.fillStyle = '#141312'; g.fillRect(0, 0, 1024, 128);
  const W = '#efe3c8', G = '#d8b46a';
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < 8; i++) {
    const x = i * 128; g.save(); g.translate(x, 0);
    g.strokeStyle = 'rgba(216,180,106,0.6)'; g.lineWidth = 2; g.strokeRect(6, 6, 116, 116);
    g.strokeStyle = W; g.fillStyle = W; g.lineWidth = 7;
    if (i === 0) { g.beginPath(); g.moveTo(22, 102); for (let s = 0; s < 4; s++) { g.lineTo(22 + s * 21, 102 - (s + 1) * 19); g.lineTo(43 + s * 21, 102 - (s + 1) * 19); } g.stroke(); g.beginPath(); g.arc(88, 30, 8, 0, TAU); g.fill(); }
    if (i === 1) { g.strokeRect(34, 20, 60, 88); g.beginPath(); g.moveTo(64, 20); g.lineTo(64, 108); g.stroke(); g.fillStyle = G; g.beginPath(); g.moveTo(46, 52); g.lineTo(55, 38); g.lineTo(55, 52); g.fill(); g.beginPath(); g.moveTo(73, 76); g.lineTo(82, 76); g.lineTo(73, 90); g.fill(); g.beginPath(); g.moveTo(46, 44); g.lineTo(55, 32); g.lineTo(55, 44); g.closePath(); g.fill(); }
    if (i === 2) { g.fillStyle = '#1f4f8a'; g.fillRect(14, 14, 100, 100); g.fillStyle = W; g.font = `700 88px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', 64, 68); }
    if (i === 3) { g.beginPath(); g.moveTo(20, 64); g.lineTo(104, 64); g.moveTo(76, 36); g.lineTo(104, 64); g.lineTo(76, 92); g.stroke(); }
    if (i === 4) { g.fillStyle = '#58c27d'; g.beginPath(); g.moveTo(72, 14); g.lineTo(36, 70); g.lineTo(62, 70); g.lineTo(54, 114); g.lineTo(92, 54); g.lineTo(66, 54); g.closePath(); g.fill(); }
    if (i === 5) { g.beginPath(); g.arc(64, 34, 13, 0, TAU); g.fill(); g.beginPath(); g.moveTo(64, 50); g.lineTo(64, 84); g.moveTo(40, 58); g.lineTo(88, 58); g.moveTo(64, 84); g.lineTo(48, 110); g.moveTo(64, 84); g.lineTo(80, 110); g.stroke(); g.fillStyle = G; g.beginPath(); g.arc(100, 32, 12, 0, TAU); g.fill(); }
    if (i === 6) { g.beginPath(); g.moveTo(22, 94); g.lineTo(34, 60); g.lineTo(80, 60); g.lineTo(96, 40); g.moveTo(34, 60); g.lineTo(34, 104); g.moveTo(80, 60); g.lineTo(88, 104); g.stroke(); g.beginPath(); g.arc(58, 34, 10, 0, TAU); g.fill(); }
    if (i === 7) { g.fillStyle = '#2f8a4c'; g.fillRect(14, 14, 100, 100); g.strokeStyle = W; g.beginPath(); g.moveTo(64, 100); g.lineTo(64, 30); g.moveTo(40, 54); g.lineTo(64, 30); g.lineTo(88, 54); g.stroke(); }
    g.restore();
  }
  return texOf(c, { repeat: false });
});
// Car operating panel (COP) key faces: brushed stainless discs with engraved labels in one atlas of 128 px cells, 8 per row.
// Keys: −1 (car park), 1…N (N = the tallest tower; a lift shows only the floors of its own building), then door-open,
// door-close and the alarm bell.
const TOP_ALL = Math.max(1, ...B_IDS.map(topFloor));
const KEY_LIST = [-1, ...Array.from({ length: TOP_ALL }, (_, i) => i + 1), 'open', 'close', 'bell'];
const KEY_COLS = 8, KEY_ROWS = Math.max(4, Math.ceil(KEY_LIST.length / KEY_COLS));
const keyCell = k => KEY_LIST.indexOf(k);
const keyXY = i => [(i % KEY_COLS) * 128 + 64, ((i / KEY_COLS) | 0) * 128 + 64];
const keyUV = cell => [(cell % KEY_COLS) / KEY_COLS, 1 - (((cell / KEY_COLS) | 0) + 1) / KEY_ROWS, 1 / KEY_COLS, 1 / KEY_ROWS];   // [u0, v0, du, dv]
const keyCanvas = () => canvas(KEY_COLS * 128, KEY_ROWS * 128);
const texKeys = () => cached('keys', () => {
  const c = keyCanvas(), g = c.getContext('2d');
  KEY_LIST.forEach((k, i) => {
    const [cx, cy] = keyXY(i);
    const gr = g.createRadialGradient(cx - 22, cy - 26, 6, cx, cy, 70);
    gr.addColorStop(0, '#f1eee8'); gr.addColorStop(0.55, '#c9c5bd'); gr.addColorStop(1, '#8f8b84');
    g.fillStyle = gr; g.fillRect(cx - 64, cy - 64, 128, 128);
    for (let j = 0; j < 90; j++) { g.fillStyle = `rgba(255,255,255,${0.04 + (j % 5) * 0.012})`; g.fillRect(cx - 64, cy - 64 + j * 1.43, 128, 0.6); }   // brushed lines
    // engraving = dark glyph with a light lower-right lip
    const glyph = (col, dx, dy) => {
      g.save(); g.translate(cx + dx, cy + dy); g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
      if (typeof k === 'number') {
        const t = floorLabel(k);
        g.font = `600 ${t.length > 1 ? 58 : 66}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 0, 4);
      } else if (k === 'open' || k === 'close') {
        const s = k === 'open' ? 1 : -1; g.lineWidth = 5;
        g.beginPath(); g.moveTo(0, -30); g.lineTo(0, 30); g.stroke();
        for (const side of [-1, 1]) { g.beginPath(); const tip = side * (s > 0 ? 40 : 8), base = side * (s > 0 ? 12 : 36); g.moveTo(tip, 0); g.lineTo(base, -17); g.lineTo(base, 17); g.closePath(); g.fill(); }
      } else {   // bell
        g.beginPath(); g.moveTo(-28, 20); g.quadraticCurveTo(-24, 14, -22, -4); g.quadraticCurveTo(-20, -30, 0, -32); g.quadraticCurveTo(20, -30, 22, -4); g.quadraticCurveTo(24, 14, 28, 20); g.closePath(); g.fill();
        g.beginPath(); g.arc(0, 27, 7, 0, TAU); g.fill(); g.beginPath(); g.arc(0, -35, 4, 0, TAU); g.fill();
      }
      g.restore();
    };
    glyph('rgba(255,255,255,0.75)', 1.6, 1.8); glyph(k === 'bell' ? '#7a2a1c' : '#23201c', 0, 0);
  });
  return texOf(c, { repeat: false });
});
// Backlight mask for the keys (same atlas cells): the engraved glyph glows warm, everything else black.
const texKeysGlow = () => cached('keysGlow', () => {
  const c = keyCanvas(), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  KEY_LIST.forEach((k, i) => {
    const [cx, cy] = keyXY(i);
    g.save(); g.translate(cx, cy); g.fillStyle = k === 'bell' ? '#ff9a7a' : '#fff'; g.strokeStyle = g.fillStyle; g.shadowColor = g.fillStyle; g.shadowBlur = 6;
    if (typeof k === 'number') {
      const t = floorLabel(k);
      g.font = `600 ${t.length > 1 ? 58 : 66}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 0, 4);
    } else if (k === 'open' || k === 'close') {
      const s = k === 'open' ? 1 : -1; g.lineWidth = 5;
      g.beginPath(); g.moveTo(0, -30); g.lineTo(0, 30); g.stroke();
      for (const side of [-1, 1]) { g.beginPath(); const tip = side * (s > 0 ? 40 : 8), base = side * (s > 0 ? 12 : 36); g.moveTo(tip, 0); g.lineTo(base, -17); g.lineTo(base, 17); g.closePath(); g.fill(); }
    } else { g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.lineWidth = 6; g.stroke(); }
    g.restore();
  });
  return texOf(c, { repeat: false });
});
// Pressed keys: warm backlit face, bright glyph (same atlas cells)
const texKeysLit = () => cached('keysLit', () => {
  const c = keyCanvas(), g = c.getContext('2d');
  KEY_LIST.forEach((k, i) => {
    const [cx, cy] = keyXY(i);
    const gr = g.createRadialGradient(cx, cy, 4, cx, cy, 70);
    gr.addColorStop(0, '#5a3a14'); gr.addColorStop(0.7, '#3a240c'); gr.addColorStop(1, '#c8893a');
    g.fillStyle = gr; g.fillRect(cx - 64, cy - 64, 128, 128);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(texKeysGlow().image, cx - 64, cy - 64, 128, 128, cx - 64, cy - 64, 128, 128);
    g.globalCompositeOperation = 'source-over';
  });
  return texOf(c, { repeat: false });
});
// Gold VILNYI emblem for the lift operating panel (the brand mark + engraved wordmark), transparent background
const texCopLogo = () => cached('copLogo', () => {
  const c = canvas(512, 150), g = c.getContext('2d');
  g.shadowColor = 'rgba(255,190,90,0.9)'; g.shadowBlur = 8;
  drawMark(g, 108, 72, 58, '#e8c27a');
  g.fillStyle = '#e8c27a'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `600 56px ${SERIF}`; g.fillText(spaced(BRAND[0], 1), 205, 80);
  return texOf(c, { repeat: false });
});
// Lift-lobby wall wash: warm light grazing down the wall from a ceiling cove (additive, u across, v = 0 at the bottom)
const texWash = () => cached('wash', () => {
  const c = canvas(8, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgb(255,214,160)'); gr.addColorStop(0.08, 'rgb(190,150,104)'); gr.addColorStop(0.35, 'rgb(84,64,42)'); gr.addColorStop(0.75, 'rgb(22,16,10)'); gr.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256); return texOf(c, { repeat: false });
});
// Entrance video intercom: the whole fascia (camera surround, speaker grille, screen, keypad, concierge key) is one unlit
// quad so it reads in any light; `open` = the "door released" state (green screen + green status LED).
const texIntercom = (open = false) => cached(open ? 'icomOpen' : 'icom', () => {
  const W = 384, H = 1056, c = canvas(W, H);
  const draw = () => {
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#17171c'); bg.addColorStop(0.5, '#09090c'); bg.addColorStop(1, '#14141a');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = gold(g, 0, 0, W, H); g.lineWidth = 6; g.strokeRect(7, 7, W - 14, H - 14);
    // camera surround (the lens itself is real geometry) + two IR dots
    g.lineWidth = 4; g.beginPath(); g.arc(192, 92, 50, 0, TAU); g.stroke();
    g.fillStyle = '#050506'; g.beginPath(); g.arc(192, 92, 44, 0, TAU); g.fill();
    for (const x of [96, 288]) { g.fillStyle = '#6a1a14'; g.beginPath(); g.arc(x, 92, 6, 0, TAU); g.fill(); }
    // speaker grille
    g.fillStyle = '#34343c';
    for (let r = 0; r < 5; r++) for (let k = 0; k < 9; k++) g.fillRect(70 + k * 28, 170 + r * 14, 20, 6);
    // screen
    const sx = 34, sy = 262, sw = 316, sh = 236;
    const sg = g.createLinearGradient(0, sy, 0, sy + sh);
    if (open) { sg.addColorStop(0, '#0d3323'); sg.addColorStop(1, '#23744b'); } else { sg.addColorStop(0, '#0e1a2b'); sg.addColorStop(1, '#22395a'); }
    g.fillStyle = sg; g.fillRect(sx, sy, sw, sh);
    g.lineWidth = 2; g.strokeStyle = 'rgba(230,201,135,0.7)'; g.strokeRect(sx, sy, sw, sh);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (open) {   // open padlock + tick
      g.strokeStyle = '#eafff2'; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.arc(170, 338, 30, Math.PI, TAU * 0.96); g.stroke();
      g.fillStyle = '#eafff2'; g.fillRect(150, 350, 88, 70);
      g.strokeStyle = '#1b6a43'; g.lineWidth = 8; g.beginPath(); g.moveTo(172, 386); g.lineTo(190, 402); g.lineTo(218, 368); g.stroke();
      g.strokeStyle = 'rgba(234,255,242,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(96, 458); g.lineTo(288, 458); g.stroke();
    } else {
      drawMark(g, 192, sy + 74, 44, gold(g, 140, sy + 30, 250, sy + 120));
      g.fillStyle = gold(g, 60, 0, 330, 0);
      g.font = `500 46px ${SERIF}`; if ('letterSpacing' in g) g.letterSpacing = '9px'; g.fillText(BRAND[0], 196, sy + 150);
      g.font = `500 19px ${SERIF}`; if ('letterSpacing' in g) g.letterSpacing = '8px'; g.fillText(BRAND[1], 196, sy + 194);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
    }
    // status LED
    g.shadowColor = open ? '#5dff9a' : '#ff5a48'; g.shadowBlur = 16; g.fillStyle = open ? '#7dffb0' : '#ff6a55';
    g.beginPath(); g.arc(336, 524, 7, 0, TAU); g.fill(); g.shadowBlur = 0;
    // keypad: backlit numerals in fine brass rings
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    g.font = `600 40px ${SANS}`;
    keys.forEach((k, i) => {
      const x = 84 + (i % 3) * 108, y = 580 + ((i / 3) | 0) * 92;
      const rg = g.createRadialGradient(x, y - 8, 4, x, y, 40); rg.addColorStop(0, '#2b2b33'); rg.addColorStop(1, '#141418');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, 38, 0, TAU); g.fill();
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(214,178,110,0.85)'; g.stroke();
      g.shadowColor = '#ffd9a0'; g.shadowBlur = 10; g.fillStyle = '#fff3dc'; g.fillText(k, x, y + (k === '*' ? 9 : 2)); g.shadowBlur = 0;
    });
    // concierge key: a brass pill with a service bell
    const py = 946, ph = 74, px0 = 62, px1 = 322;
    g.fillStyle = gold(g, px0, py, px1, py + ph);
    g.beginPath(); g.arc(px0 + ph / 2, py + ph / 2, ph / 2, Math.PI / 2, Math.PI * 1.5); g.arc(px1 - ph / 2, py + ph / 2, ph / 2, -Math.PI / 2, Math.PI / 2); g.closePath(); g.fill();
    g.fillStyle = '#20160a';
    g.beginPath(); g.arc(192, py + 50, 22, Math.PI, TAU); g.closePath(); g.fill();
    g.fillRect(162, py + 52, 60, 6); g.beginPath(); g.arc(192, py + 23, 5, 0, TAU); g.fill();
  };
  draw();
  const t = texOf(c, { repeat: false });
  try { if (!open && document.fonts && document.fonts.load) document.fonts.load(`500 46px "Cormorant Garamond"`, BRAND.join(' ')).then(f => { if (f && f.length) { draw(); t.needsUpdate = true; } }).catch(() => {}); } catch { /* optional */ }
  return t;
});
// Ukrainian signage words (the signs of the building itself are Ukrainian in every UI language): one atlas of
// 512 × 128 cells, 2 per row — cream capitals on a dark plate with a fine gold rule, matching the pictograms.
const WORDS = { floor: 'Поверх', lift: 'Ліфт', stairs: 'Сходи', parking: 'Паркінг', concierge: 'Консьєрж', exit: 'Вихід', shelter: 'Укриття', mail: 'Пошта' };
const WORD_KEYS = Object.keys(WORDS);
function drawWordPlate(g, x, y, w, h, text) {
  g.fillStyle = '#141312'; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(216,180,106,0.6)'; g.lineWidth = 2; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
  g.fillStyle = '#efe3c8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const t = text.toUpperCase(); let px = Math.round(h * 0.5);
  g.font = `600 ${px}px ${SANS}`; if ('letterSpacing' in g) g.letterSpacing = Math.round(px * 0.14) + 'px';
  const tw = g.measureText(t).width; if (tw > w - 44) { px = Math.floor(px * (w - 44) / tw); g.font = `600 ${px}px ${SANS}`; if ('letterSpacing' in g) g.letterSpacing = Math.round(px * 0.14) + 'px'; }
  g.fillText(t, x + w / 2, y + h / 2 + px * 0.04);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
const texWords = () => cached('words', () => {
  const c = canvas(1024, 512);
  const draw = () => { const g = c.getContext('2d'); WORD_KEYS.forEach((k, i) => drawWordPlate(g, (i % 2) * 512, ((i / 2) | 0) * 128, 512, 128, WORDS[k])); };
  draw();
  const t = texOf(c, { repeat: false });
  try { if (document.fonts && document.fonts.load) document.fonts.load(`600 64px "Manrope"`, 'Поверх').then(f => { if (f && f.length) { draw(); t.needsUpdate = true; } }).catch(() => {}); } catch { /* optional */ }
  return t;
});
// The operating panel is a tall black-glass column on the front return wall (beside the doors, facing the back of the
// car), read and tapped from the back of the car. Floor keys come from liftFloors(bId): 2 columns up to 12 keys, 3 columns
// above; rows[0] is the BOTTOM row (−1 first), the top row holds the highest floors; below them door-open / door-close
// and the alarm key.
function panelLayout(bId) {
  const fl = liftFloors(bId), cols = fl.length > 12 ? 3 : 2, rows = [];
  for (let i = 0; i < fl.length; i += cols) rows.push(fl.slice(i, i + cols));
  return { cols, rows };
}
const KEY_PV = 0.118;                                   // vertical pitch of the floor keys (m)
const KEY_GEOM = { 2: { R: 0.043, ph: 0.128 }, 3: { R: 0.036, ph: 0.09 } };   // key radius / horizontal pitch per column count
const KEY_R2 = 0.036, KEY_R3 = 0.03;                    // door keys, alarm key
// the lift stop nearest to `floor` for this building (−1, 1…N; there is no floor 0)
function liftStop(bId, floor) {
  const fl = liftFloors(bId); floor = Math.round(+floor) || 0;
  if (fl.includes(floor)) return floor;
  return floor < 1 ? (floor < 0 ? fl[0] : 1) : fl[fl.length - 1];
}

function plateAtlas(entries) {   // brass number plates; returns {tex, uv(i)} with 8 × 8 cells of 128 × 64
  const c = canvas(1024, 512), g = c.getContext('2d');
  entries.forEach((txt, i) => {
    const x = (i % 8) * 128, y = ((i / 8) | 0) * 64;
    g.fillStyle = gold(g, x, y, x + 128, y + 64); g.fillRect(x, y, 128, 64);
    g.strokeStyle = 'rgba(60,40,15,0.55)'; g.lineWidth = 2; g.strokeRect(x + 5, y + 5, 118, 54);
    g.fillStyle = '#2a1d0f'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let px = 36; g.font = `600 ${px}px ${SERIF}`;
    const tw = g.measureText(String(txt)).width; if (tw > 104) { px = Math.max(12, Math.floor(px * 104 / tw)); g.font = `600 ${px}px ${SERIF}`; }
    g.fillText(String(txt), x + 64, y + 34);
  });
  const tex = texOf(c, { repeat: false });
  return { tex, uv: i => [(i % 8) / 8, 1 - (((i / 8) | 0) + 1) / 8, 1 / 8, 1 / 8] };
}

// ============================================================ materials (shared)
// Building finishes: every common area (lobby, lift halls, corridors, lift cars, parking lift lobbies) is built from the same
// material keys; a finish swaps the factories behind those keys (and a few signature pieces, see chandelier/wallRun).
export const COMMON_FINISHES = [
  { id: 'classic', name: { uk: 'Сигнатурний', en: 'Signature', he: 'סיגנצ׳ר' } },      // Calacatta + walnut + brushed bronze (original)
  { id: 'grand', name: { uk: 'Гранд-мармур', en: 'Grand Marble', he: 'שיש מלכותי' } },  // Calacatta Oro + polished brass + crystal + dark walnut
  { id: 'stone', name: { uk: 'Камінь і дуб', en: 'Stone & Oak', he: 'אבן ואלון' } },    // travertine + oak slats + linear LED + dark bronze
];
const FINISH_IDS = COMMON_FINISHES.map(f => f.id);
/** The building finish that suits an apartment style by default (the walk HUD can override it). */
export function finishForStyle(styleId) { return styleId === 'monaco' ? 'grand' : styleId === 'kyoto' ? 'stone' : 'classic'; }
let FIN = 'classic';
const Sm = (o, uv) => { const m = new THREE.MeshStandardMaterial(o); if (uv) m.userData.uv = uv; return m; };
const FIN_MATS = {
  grand: {
    marble: () => Sm({ map: texCalacatta(), roughness: 0.06, envMapIntensity: 1.15 }, 3.0),
    marbleFloor: () => Sm({ map: texCalacatta(), roughness: 0.08, envMapIntensity: 1.1 }, 2.4),
    stone: () => Sm({ map: texCalacatta(), roughness: 0.1, envMapIntensity: 1.0 }, 1.6),
    nero: () => Sm({ map: texMarble(true), roughness: 0.06, envMapIntensity: 1.2 }, 1.8),
    walnut: () => Sm({ map: texWalnut(), color: 0x9c8478, roughness: 0.16, envMapIntensity: 1.1 }, 1.0),     // lacquered dark walnut
    walnutDoor: () => Sm({ map: texWalnut(), color: 0x8a7268, roughness: 0.14, envMapIntensity: 1.2 }),
    fabric: () => Sm({ map: texSilk(), roughness: 0.62, envMapIntensity: 0.8 }, 0.7),
    plaster: () => Sm({ color: 0xf3ede2, roughness: 0.9, envMapIntensity: 0.8 }),
    bronze: () => Sm({ color: 0xd9b46c, metalness: 1, roughness: 0.14, envMapIntensity: 1.2 }),              // polished brass
    bronzeDark: () => Sm({ color: 0x8a6a3a, metalness: 1, roughness: 0.24 }),
    brass: () => Sm({ color: 0xe2bd72, metalness: 1, roughness: 0.12 }),
    carpet: () => Sm({ map: texCarpetV('navy', [24, 31, 52], '#c9a35a', '#8f7240', 8), roughness: 1, envMapIntensity: 0.5 }),
    velvet: () => Sm({ color: 0x1d3a35, roughness: 0.8, envMapIntensity: 0.6 }),                                // emerald velvet
    velvetSand: () => Sm({ color: 0xe6dccb, roughness: 0.88, envMapIntensity: 0.6 }),
    rug: () => Sm({ color: 0x2a3550, roughness: 1, envMapIntensity: 0.5 }),
    tray: () => Sm({ color: 0xf0e8da, roughness: 0.95, emissive: 0xffd08a, emissiveIntensity: 1.05, emissiveMap: texGlow() }),
    bronzeCar: () => Sm({ color: 0xd2ae70, metalness: 1, roughness: 0.1, envMapIntensity: 1.5, emissive: 0x5a3e1c, emissiveIntensity: 0.5 }),
    carFrame: () => Sm({ color: 0x2a1d16, metalness: 0.3, roughness: 0.2, envMapIntensity: 1.2, emissive: 0x160d07, emissiveIntensity: 0.6 }),
    moulding: () => Sm({ color: 0xf6f0e4, roughness: 0.35, envMapIntensity: 0.9 }),
  },
  stone: {
    marble: () => Sm({ map: texTravertine(), roughness: 0.42, envMapIntensity: 0.85 }, 2.4),
    marbleFloor: () => Sm({ map: texTravertine(true), roughness: 0.3, envMapIntensity: 0.8 }, 2.4),
    stone: () => Sm({ map: texTravertine(true), color: 0xe9e4dc, roughness: 0.34, envMapIntensity: 0.8 }, 2.4),
    nero: () => Sm({ map: texBasalt(), roughness: 0.4, envMapIntensity: 0.8 }, 1.6),
    walnut: () => Sm({ map: texOakSlat(), roughness: 0.6, envMapIntensity: 0.7 }, 1.0),                         // oak slat cladding
    walnutDoor: () => Sm({ map: texOakFlat(), roughness: 0.5, envMapIntensity: 0.8 }),
    fabric: () => Sm({ map: texLimewash(), roughness: 0.95, envMapIntensity: 0.7 }, 1.6),
    plaster: () => Sm({ color: 0xefeae2, roughness: 0.95, envMapIntensity: 0.8 }),
    bronze: () => Sm({ color: 0x5c4634, metalness: 1, roughness: 0.38, map: texBrushed() }, 0.9),                 // dark bronze satin
    bronzeDark: () => Sm({ color: 0x2c231c, metalness: 0.85, roughness: 0.45 }),
    brass: () => Sm({ color: 0x7a5d42, metalness: 1, roughness: 0.32 }),
    carpet: () => Sm({ map: texCarpetV('oat', [168, 156, 136], '#3a3430', '#6c625a', -6), roughness: 1, envMapIntensity: 0.5 }),
    velvet: () => Sm({ color: 0x6d6f52, roughness: 0.95, envMapIntensity: 0.6 }),                                // olive bouclé
    velvetSand: () => Sm({ color: 0xe8e0d0, roughness: 0.97, envMapIntensity: 0.6 }),
    rug: () => Sm({ color: 0xb7aa94, roughness: 1, envMapIntensity: 0.5 }),
    leather: () => Sm({ color: 0x8a5a36, roughness: 0.5, envMapIntensity: 0.8 }),
    tray: () => Sm({ color: 0xece6dc, roughness: 0.95, emissive: 0xffe2bc, emissiveIntensity: 0.9, emissiveMap: texGlow() }),
    bronzeCar: () => Sm({ map: texOakSlat(), roughness: 0.55, envMapIntensity: 1.0, emissive: 0x3a2814, emissiveIntensity: 0.35 }, 1.0),
    carFrame: () => Sm({ color: 0x2c231c, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.1, emissive: 0x140e09, emissiveIntensity: 0.6 }),
    moulding: () => Sm({ color: 0x2c231c, metalness: 0.85, roughness: 0.45 }),
  },
};
const MAT = {};
function M(key) {
  const ov = FIN_MATS[FIN] && FIN_MATS[FIN][key], mkey = ov ? FIN + ':' + key : key;
  if (MAT[mkey]) return MAT[mkey];
  if (ov) { const m = ov(); m.name = 'vrc-' + key; MAT[mkey] = m; return m; }
  const S = Sm;
  const mk = {
    moulding: () => S({ color: 0xece6dc, roughness: 0.6 }),
    crystal: () => S({ color: 0xffffff, metalness: 0.1, roughness: 0.02, envMapIntensity: 2.6, emissive: 0xfff0d6, emissiveIntensity: 0.55, transparent: true, opacity: 0.88 }),
    stone: () => S({ map: texStone(), roughness: 0.2, metalness: 0, envMapIntensity: 0.9 }, 2.4),
    marble: () => S({ map: texMarble(), roughness: 0.1, envMapIntensity: 1.0 }, 2.8),
    marbleFloor: () => S({ map: texMarble(), roughness: 0.14, envMapIntensity: 0.9 }, 2.4),
    nero: () => S({ map: texMarble(true), roughness: 0.12, envMapIntensity: 1.0 }, 1.8),
    walnut: () => S({ map: texWalnut(), roughness: 0.42, envMapIntensity: 0.8 }, 1.0),
    walnutDoor: () => S({ map: texWalnut(), roughness: 0.36, envMapIntensity: 0.9 }),
    fabric: () => S({ map: texFabric(), roughness: 0.92, envMapIntensity: 0.7 }, 0.6),
    plaster: () => S({ color: 0xece6dc, roughness: 0.95, envMapIntensity: 0.8 }),
    plasterW: () => S({ color: 0xe3ddd2, roughness: 0.9, envMapIntensity: 0.8 }),
    tray: () => S({ color: 0xe9e2d6, roughness: 0.95, emissive: 0xffd49a, emissiveIntensity: 0.95, emissiveMap: texGlow() }),
    bronze: () => S({ color: 0xb48e5e, metalness: 1, roughness: 0.26, map: texBrushed() }, 0.9),
    bronzeDark: () => S({ color: 0x4a3626, metalness: 0.9, roughness: 0.38 }),
    brass: () => S({ color: 0xd2ac66, metalness: 1, roughness: 0.22 }),
    carpet: () => S({ map: texCarpet(), roughness: 1, envMapIntensity: 0.5 }),
    glass: () => S({ color: 0xc9d6d4, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.3 }),
    frosted: () => S({ color: 0xefe6d6, roughness: 0.5, emissive: 0xffdcb0, emissiveIntensity: 0.45, emissiveMap: texGlow() }),
    blackGlass: () => S({ color: 0x0b0a09, roughness: 0.06, metalness: 0.3, envMapIntensity: 1.2 }),
    mirror: () => S({ color: 0x9a8e80, metalness: 1, roughness: 0.04, envMapIntensity: 1.3 }),
    // car walls: brushed bronze that also picks up the LED ceiling (a little self-glow so it never reads black)
    bronzeCar: () => S({ color: 0xa27a52, metalness: 0.8, roughness: 0.26, map: texBrushed(), envMapIntensity: 1.35, emissive: 0x4a3018, emissiveIntensity: 0.55 }, 0.9),
    carFrame: () => S({ color: 0x5a4230, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.2, emissive: 0x24170c, emissiveIntensity: 0.6 }),
    velvet: () => S({ color: 0x2f3c3a, roughness: 0.85, envMapIntensity: 0.6 }),
    velvetSand: () => S({ color: 0xb49a78, roughness: 0.9, envMapIntensity: 0.6 }),
    rug: () => S({ color: 0x8e7f6c, roughness: 1, envMapIntensity: 0.5 }),
    leaf: () => S({ color: 0x46613a, roughness: 0.7, side: THREE.DoubleSide }),
    leaf2: () => S({ color: 0x7d8f62, roughness: 0.7, side: THREE.DoubleSide }),
    pot: () => S({ color: 0x2a2724, roughness: 0.55 }),
    led: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.85, 1.35) }),
    ledSoft: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.1, 0.78) }),
    ledCool: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.3, 2.2) }),
    ledDim: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.05, 0.75) }),
    bulb: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 2.4, 1.6) }),
    wordmark: () => { const m = new THREE.MeshStandardMaterial({ map: texWordmark(), transparent: true, metalness: 0.85, roughness: 0.28, alphaTest: 0.02, emissive: 0x8a6528, emissiveMap: texWordmark(), emissiveIntensity: 0.8 }); return m; },
    signs: () => new THREE.MeshBasicMaterial({ map: texSigns(), color: new THREE.Color(1.15, 1.15, 1.15) }),
    words: () => new THREE.MeshBasicMaterial({ map: texWords(), color: new THREE.Color(1.15, 1.15, 1.15) }),
    // reception desk: the brand mark glows from behind a dark onyx inset
    wordmarkLit: () => new THREE.MeshBasicMaterial({ map: texWordmark(), color: new THREE.Color(1.9, 1.6, 1.15), transparent: true, alphaTest: 0.02, depthWrite: false }),
    onyx: () => S({ color: 0x17130f, roughness: 0.18, metalness: 0.1, envMapIntensity: 1.1, emissive: 0x3a2610, emissiveIntensity: 0.55 }),
    leather: () => S({ color: 0x6a4329, roughness: 0.45, envMapIntensity: 0.8 }),
    // concierge figure: one vertex-coloured material for all her parts (skin, suit, blouse, hair) → 5 draw calls
    figure: () => S({ vertexColors: true, roughness: 0.58, metalness: 0, envMapIntensity: 0.75 }),
    // backlit keys: the engraved glyph always glows softly (legible in any light), much brighter when pressed
    // unlit so the engraved numbers read in any light / on any GPU (iOS rendered the lit version black)
    keyFace: () => new THREE.MeshBasicMaterial({ map: texKeys(), color: 0xf2efe8 }),
    keyFaceLit: () => new THREE.MeshBasicMaterial({ map: texKeysLit(), color: 0xffffff }),
    copLogo: () => new THREE.MeshBasicMaterial({ map: texCopLogo(), transparent: true, depthWrite: false }),
    keyRing: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.66, 0.3) }),   // idle halo (dim amber)
    callFace: () => S({ color: 0xe4e0d8, metalness: 0.6, roughness: 0.28, map: texBrushed(), emissive: 0x6a5238, emissiveIntensity: 0.35 }),
    callFaceLit: () => S({ color: 0xfff0d0, metalness: 0.3, roughness: 0.3, emissive: 0xffc46a, emissiveIntensity: 1.6 }),
    glyph: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.45, 0.8) }),
    brassPlate: () => S({ color: 0xd2ac66, metalness: 0.85, roughness: 0.24, emissive: 0x3a2812, emissiveIntensity: 1 }),
    ledCar: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.85, 2.1) }),
    ledCarDot: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.1, 2.9) }),
    wash: () => new THREE.MeshBasicMaterial({ map: texWash(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.32, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    keyRingLit: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 0.95) }),
    keyRingRed: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.5, 0.3) }),
    btn: () => S({ color: 0xcaa566, metalness: 1, roughness: 0.25 }),
    btnLit: () => S({ color: 0xffe2a0, metalness: 0.5, roughness: 0.3, emissive: 0xffc062, emissiveIntensity: 2.2 }),
    mailbox: () => S({ map: texMailbox(), metalness: 0.7, roughness: 0.35 }),
    art0: () => S({ map: texArt(0), roughness: 0.8 }), art1: () => S({ map: texArt(1), roughness: 0.8 }), art2: () => S({ map: texArt(2), roughness: 0.8 }),
    concrete: () => S({ map: texConcrete(), roughness: 0.92 }, 2.0),
    ceilingP: () => S({ color: 0x9d9b96, roughness: 0.95 }),
    concreteLight: () => S({ map: texConcrete(), color: 0xd8d4cc, roughness: 0.9 }, 2.0),
    epoxy: () => S({ map: texEpoxy(), roughness: 0.32, envMapIntensity: 0.7 }, 4.0),
    paint: () => S({ color: 0xf2efe6, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    paintYellow: () => S({ color: 0xe0b12a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    paintGreen: () => S({ color: 0x2d6a4a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    hazard: () => S({ color: 0x1b1b1b, roughness: 0.7 }),
    tyre: () => S({ color: 0x151515, roughness: 0.8 }),
    pipeRed: () => S({ color: 0x7c2620, roughness: 0.55 }),
    steel: () => S({ color: 0xa6a8aa, metalness: 1, roughness: 0.35 }),
    // entrance intercom: unlit fascia (idle / door released) on a brushed-bronze totem
    icomFace: () => new THREE.MeshBasicMaterial({ map: texIntercom(false), color: 0xe2e2e2 }),
    icomFaceOpen: () => new THREE.MeshBasicMaterial({ map: texIntercom(true), color: 0xf2f2f2 }),
    // apartment bell push: ivory button in a glowing ring (ring colour = per-instance, lit while pressed)
    bellCap: () => S({ color: 0xf4eee0, roughness: 0.3, envMapIntensity: 0.9, emissive: 0x4a3a22, emissiveIntensity: 0.5 }),
    bellRing: () => new THREE.MeshBasicMaterial({ color: 0xffffff }),
    white: () => S({ color: 0xf4f2ee, roughness: 0.4 }),
    daylight: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 2.6) }),
    decal: () => new THREE.MeshBasicMaterial({ map: texScallop(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }),
    pool: () => new THREE.MeshBasicMaterial({ map: texPool(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.22 }),
    poolCool: () => new THREE.MeshBasicMaterial({ map: texPool(), color: 0xbcd0ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.3 }),
    hidden: () => new THREE.MeshBasicMaterial({ visible: false }),
    // cheap baked "SSAO": translucent black ramps hugging the room's corners (no post-processing)
    aoFloor: () => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: texAO(), transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    aoCeil: () => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: texAO(), transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    aoWall: () => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: texAO(), transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };
  const m = mk[key](); m.name = 'vrc-' + key; MAT[key] = m; return m;
}

// ============================================================ geometry batching
function boxGeo(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g;
}
// UVs in metres from the dominant normal axis (box-projection), scaled by the material's tile size.
function worldUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / s; uv[i * 2 + 1] = v / s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function clean(g) {
  let n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  n.morphAttributes = {};
  return n;
}
function flipWinding(g) {   // non-indexed: swap the 2nd/3rd vertex of every triangle (after a mirroring scale)
  for (const att of Object.values(g.attributes)) {
    const n = att.itemSize, arr = att.array;
    for (let t = 0; t < att.count; t += 3) for (let k = 0; k < n; k++) { const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k; const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp; }
    att.needsUpdate = true;
  }
}
// (There are no mirrored blocks in this project: Batch / Colliders take no mirror plane; extra constructor arguments of
// the old signatures are ignored.)
class Batch {
  constructor() { this.parts = new Map(); }
  add(mat, geo, matrix) {
    if (typeof mat === 'string') mat = M(mat);
    let g = clean(geo);
    if (matrix) g.applyMatrix4(matrix);
    if (mat.userData.uv) worldUV(g, mat.userData.uv);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  box(mat, x0, x1, y0, y1, z0, z1) { return this.add(mat, boxGeo(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1))); }
  flush(parent, ud = {}) {
    const out = [];
    for (const [mat, list] of this.parts) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) list.forEach(g => g.dispose());
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mat); Object.assign(mesh.userData, ud); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      if (mat.transparent) mesh.renderOrder = 2;
      parent.add(mesh); out.push(mesh);
    }
    this.parts.clear(); return out;
  }
}
// Invisible colliders, chunked spatially so walk.js's proximity filter stays cheap.
class Colliders {
  constructor(cell = 14) { this.cell = typeof cell === 'number' && cell > 0 ? cell : 14; this.solid = new Map(); this.floor = new Map(); }
  _k(x, z) { return Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell); }
  _put(map, k, g) { if (!map.has(k)) map.set(k, []); map.get(k).push(g); }
  box(x0, x1, y0, y1, z0, z1) {
    const [a0, a1] = [Math.min(x0, x1), Math.max(x0, x1)], [b0, b1] = [Math.min(z0, z1), Math.max(z0, z1)];
    // split long walls across cells
    const n = Math.max(1, Math.ceil(Math.max(a1 - a0, b1 - b0) / this.cell));
    for (let i = 0; i < n; i++) {
      const s0 = i / n, s1 = (i + 1) / n;
      const cx0 = a1 - a0 >= b1 - b0 ? mix(a0, a1, s0) : a0, cx1 = a1 - a0 >= b1 - b0 ? mix(a0, a1, s1) : a1;
      const cz0 = a1 - a0 >= b1 - b0 ? b0 : mix(b0, b1, s0), cz1 = a1 - a0 >= b1 - b0 ? b1 : mix(b0, b1, s1);
      this._put(this.solid, this._k((cx0 + cx1) / 2, (cz0 + cz1) / 2), clean(boxGeo(cx0, cx1, Math.min(y0, y1), Math.max(y0, y1), cz0, cz1)));
    }
  }
  rect(x0, x1, z0, z1, y = 0) {
    const [a0, a1] = [Math.min(x0, x1), Math.max(x0, x1)], [b0, b1] = [Math.min(z0, z1), Math.max(z0, z1)];
    const nx = Math.max(1, Math.ceil((a1 - a0) / this.cell)), nz = Math.max(1, Math.ceil((b1 - b0) / this.cell));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      // T32: pieces overlap by 2 cm on inner seams — a down-ray exactly on a seam used to miss the floor (notes/T14.md dev. 7)
      const x_0 = mix(a0, a1, i / nx) - (i ? 0.02 : 0), x_1 = mix(a0, a1, (i + 1) / nx), z_0 = mix(b0, b1, j / nz) - (j ? 0.02 : 0), z_1 = mix(b0, b1, (j + 1) / nz);
      const g = new THREE.PlaneGeometry(x_1 - x_0, z_1 - z_0); g.rotateX(-Math.PI / 2); g.translate((x_0 + x_1) / 2, y, (z_0 + z_1) / 2);
      this._put(this.floor, this._k((x_0 + x_1) / 2, (z_0 + z_1) / 2), clean(g));
    }
  }
  geoSolid(g) { g = clean(g); g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); this._put(this.solid, this._k(c.x, c.z), g); }
  geoFloor(g) { g = clean(g); g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); this._put(this.floor, this._k(c.x, c.z), g); }
  flush(parent) {
    for (const [map, flag] of [[this.solid, 'solid'], [this.floor, 'floor']]) for (const list of map.values()) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false); if (list.length > 1) list.forEach(g => g.dispose());
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, M('hidden')); m.userData[flag] = true; m.userData.collider = true; m.name = 'vrc-' + flag;
      m.matrixAutoUpdate = false; parent.add(m);
    }
    this.solid.clear(); this.floor.clear();
  }
}

// Instanced copies of one geometry: one InstancedMesh.
function instanced(parent, geo, mat, matrices, colors) {
  if (!matrices.length) return null;
  if (typeof mat === 'string') mat = M(mat);
  const im = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors) { colors.forEach((c, i) => im.setColorAt(i, c)); im.instanceColor.needsUpdate = true; }
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); if (im.computeBoundingBox) im.computeBoundingBox();
  parent.add(im); return im;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function mat4(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0) { return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, 0)), _s.set(sx, sy, sz)); }

// A flat ramp quad: corner edge p0→p1, extending by vector w (the ramp fades along w). uv.y = 0 on the edge.
function aoQuad(B, mat, p0, p1, w) {
  const q = [p0, p1, [p1[0] + w[0], p1[1] + w[1], p1[2] + w[2]], [p0[0] + w[0], p0[1] + w[1], p0[2] + w[2]]];
  const pos = [], uv = [], U = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...q[i]); uv.push(...U[i]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  B.add(mat, g);
}

// ============================================================ lights (one shared rig → constant light count)
const RIG = { group: null, pts: [], hemi: null, car: null, carOwner: null };
function lightRig() {
  if (RIG.group) return RIG;
  RIG.group = new THREE.Group(); RIG.group.name = 'vrc-commons-lights';
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffd4a0, 0, 11, 2); RIG.pts.push(l); RIG.group.add(l); }
  RIG.hemi = new THREE.HemisphereLight(0xfff1dc, 0x3b342c, 0); RIG.group.add(RIG.hemi);
  RIG.car = new THREE.PointLight(0xffdcb0, 0, 4.2, 2); RIG.group.add(RIG.car);
  return RIG;
}
function claimRig(root, spots, hemi = 0.12) {
  const R = lightRig(); root.add(R.group);
  R.pts.forEach((l, i) => { const s = spots[i]; if (s) { l.position.set(s[0], s[1], s[2]); l.intensity = s[3] ?? 7; l.color.setHex(s[4] ?? 0xffd4a0); l.distance = s[5] ?? 11; } else l.intensity = 0; });
  R.hemi.intensity = hemi; R.car.intensity = 0; R.carOwner = null;
}

// ============================================================ walls
// A wall run along axis 'x' (constant z = c) or 'z' (constant x = c). `side` (+1/-1) points from the wall line into
// the room being finished; d = distance from the line toward the room. Body d ∈ [-WALL_T, FACE].
function wallRun(ctx, s) {
  const { B, C } = ctx;
  const H = s.H ?? ctx.H;
  const P = (a, d) => s.axis === 'x' ? [a, s.c + s.side * d] : [s.c + s.side * d, a];
  const box = (mat, a0, a1, y0, y1, d0, d1) => { const [x0, z0] = P(a0, d0), [x1, z1] = P(a1, d1); B.box(mat, x0, x1, y0, y1, z0, z1); };
  const col = (a0, a1, y0, y1, d0, d1) => { const [x0, z0] = P(a0, d0), [x1, z1] = P(a1, d1); C.box(x0, x1, y0, y1, z0, z1); };
  const ops = (s.openings || []).map(o => ({ ...o, a0: o.c - o.w / 2, a1: o.c + o.w / 2 })).filter(o => o.a1 > s.a0 && o.a0 < s.a1).sort((p, q) => p.a0 - q.a0);
  // body gaps: lifts also leave a door pocket
  const gaps = ops.map(o => o.kind === 'lift' ? [o.c - POCKET, o.c + POCKET, LIFT_H + 0.1] : [o.a0, o.a1, o.h]);
  let a = s.a0;
  const solidSeg = (a0, a1) => { if (a1 - a0 < 0.005) return; if (!s.noBody) box(s.body || 'plaster', a0, a1, 0, H, -WALL_T, FACE); col(a0, a1, 0, H, -WALL_T, FACE + 0.03); };
  for (const [g0, g1, h] of gaps) {
    solidSeg(a, Math.max(a, g0));
    if (h < H && !s.noBody) box(s.body || 'plaster', g0, g1, h, H, -WALL_T, FACE);
    if (h < H) col(g0, g1, h, H, -WALL_T, FACE);
    a = Math.max(a, g1);
  }
  solidSeg(a, s.a1);
  // contact darkening where the wall meets the floor (and the ceiling on typical floors); faded across openings
  if (!s.noAO) {
    const d0 = FACE + SKIN + 0.001, P3 = (a, d, y) => { const [x, z] = P(a, d); return [x, y, z]; };
    const inw = s.axis === 'x' ? [0, 0, s.side] : [s.side, 0, 0];
    const floorW = 0.34, ceilW = 0.3, ceil = ctx.floor >= 1 && s.H == null;
    let aa = s.a0;
    const run = (a0, a1) => {
      if (a1 - a0 < 0.05) return;
      aoQuad(B, 'aoFloor', P3(a0, d0, 0.003), P3(a1, d0, 0.003), inw.map(v => v * floorW));
      if (ceil) aoQuad(B, 'aoCeil', P3(a1, d0, H - 0.003), P3(a0, d0, H - 0.003), inw.map(v => v * ceilW));
      if (ceil) aoQuad(B, 'aoWall', P3(a0, d0 + 0.001, H - 0.004), P3(a1, d0 + 0.001, H - 0.004), [0, -0.22, 0]);
    };
    for (const o of ops) { run(aa, Math.min(o.a0, s.a1)); if (o.kind !== 'lift' && ceil) aoQuad(B, 'aoCeil', P3(o.a1, d0, H - 0.003), P3(o.a0, d0, H - 0.003), inw.map(v => v * ceilW)); aa = Math.max(aa, o.a1); }
    run(aa, s.a1);
  }
  // finish overlays by zone (painter's algorithm over [a0,a1])
  const zones = [{ a0: s.a0, a1: s.a1, mat: s.finish || 'fabric' }, ...(s.zones || [])];
  const cuts = new Set([s.a0, s.a1]); zones.forEach(z => { cuts.add(clamp(z.a0, s.a0, s.a1)); cuts.add(clamp(z.a1, s.a0, s.a1)); });
  ops.forEach(o => { cuts.add(clamp(o.a0, s.a0, s.a1)); cuts.add(clamp(o.a1, s.a0, s.a1)); });
  const pts = [...cuts].sort((p, q) => p - q);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1]; if (p1 - p0 < 0.004) continue;
    const mid = (p0 + p1) / 2;
    let zone = zones[0]; for (const z of zones) if (mid > z.a0 && mid < z.a1) zone = z;
    const op = ops.find(o => mid > o.a0 && mid < o.a1);
    const skirt = zone.skirt ?? (zone.mat !== 'marble' && zone.mat !== 'nero');
    const y0 = op ? op.h : (skirt ? 0.1 : 0);
    if (y0 < H) box(zone.mat, p0, p1, y0, H - 0.005, FACE, FACE + SKIN);
    if (!op && skirt) box('bronzeDark', p0, p1, 0, 0.1, FACE, FACE + 0.026);
    if (!op && zone.mat === 'fabric') {
      if (FIN === 'grand') {   // boiserie: chair rail + picture-frame mouldings with a hairline of brass
        const D0 = FACE + SKIN, D1 = D0 + 0.012, t = 0.028;
        box('moulding', p0, p1, 0.9, 0.95, D0, D0 + 0.02); box('brass', p0, p1, 0.947, 0.952, D0, D0 + 0.021);
        const n = Math.max(1, Math.round((p1 - p0) / 1.25)), pw = (p1 - p0) / n;
        if (pw > 0.42) for (let k = 0; k < n; k++) {
          const a0 = p0 + k * pw + 0.14, a1 = p0 + (k + 1) * pw - 0.14;
          for (const [y0, y1] of [[0.26, 0.74], [1.12, H - 0.32]]) {
            if (y1 - y0 < 0.3) continue;
            box('moulding', a0, a1, y0, y0 + t, D0, D1); box('moulding', a0, a1, y1 - t, y1, D0, D1);
            box('moulding', a0, a0 + t, y0, y1, D0, D1); box('moulding', a1 - t, a1, y0, y1, D0, D1);
          }
        }
      } else if (FIN !== 'stone') box('bronze', p0, p1, 0.93, 0.945, FACE, FACE + SKIN + 0.004);
    }
  }
  // opening trims
  for (const o of ops) {
    if (o.kind === 'pass' || o.noTrim) {
      for (const e of [o.a0, o.a1]) box('bronzeDark', e - 0.012, e + 0.012, 0, o.h, -WALL_T, FACE + 0.02);
      if (o.h < H) box('bronzeDark', o.a0, o.a1, o.h - 0.012, o.h + 0.012, -WALL_T, FACE + 0.02);
      continue;
    }
    const t = o.kind === 'lift' ? 0.07 : 0.045, p = o.kind === 'lift' ? 0.05 : 0.032;
    const mat = o.kind === 'lift' ? 'bronze' : 'bronze';
    box(mat, o.a0 - t, o.a0, 0, o.h + t, FACE, FACE + p); box(mat, o.a1, o.a1 + t, 0, o.h + t, FACE, FACE + p);
    box(mat, o.a0 - t, o.a1 + t, o.h, o.h + t, FACE, FACE + p);
    if (o.kind === 'door' || o.kind === 'service') {   // jamb reveals + threshold
      box('bronzeDark', o.a0, o.a0 + 0.012, 0, o.h, -WALL_T, FACE); box('bronzeDark', o.a1 - 0.012, o.a1, 0, o.h, -WALL_T, FACE);
      box('bronzeDark', o.a0, o.a1, o.h - 0.012, o.h, -WALL_T, FACE);
      box('nero', o.a0, o.a1, 0, 0.008, -WALL_T, FACE + 0.01);
    }
    if (o.kind === 'lift') box('bronze', o.a0, o.a1, 0, 0.012, -0.12, FACE + 0.04);   // landing sill
  }
  // scallop decals on solid wall stretches
  if (s.scallops) {
    for (const a of s.scallops) {
      if (ops.some(o => a > o.a0 - 0.35 && a < o.a1 + 0.35)) continue;
      const [x, z] = P(a, FACE + SKIN + 0.004);
      const g = new THREE.PlaneGeometry(0.9, 1.7); g.translate(0, H - 0.02 - 0.85, 0);
      const yaw = s.axis === 'x' ? (s.side > 0 ? 0 : Math.PI) : (s.side > 0 ? Math.PI / 2 : -Math.PI / 2);
      ctx.B.add('decal', g, mat4(x, 0, z, yaw));
    }
  }
  return { P, box, col };
}

// door leaf (individual mesh, closed); handle as child
const _leafGeo = {};
function doorLeaf(unitId, x, z, alongX, yaw, handleSide) {
  const w = DOOR_W - 0.01;
  const g = _leafGeo.leaf || (_leafGeo.leaf = (() => { const b = new THREE.BoxGeometry(w, DOOR_H - 0.01, 0.05); worldUV(b, 1.0); return b; })());
  const leaf = new THREE.Mesh(g, M('walnutDoor'));
  leaf.position.set(x, (DOOR_H - 0.01) / 2, z); leaf.rotation.y = yaw;
  leaf.userData = { action: { type: 'aptDoor', unitId }, doorLeaf: true, unitId, solid: true };
  leaf.name = 'vrc-door-' + unitId;
  const hg = _leafGeo.handle || (_leafGeo.handle = (() => {
    const parts = [boxGeo(-0.012, 0.012, -0.03, 0.03, 0.025, 0.06), boxGeo(-0.14, 0.012, -0.011, 0.011, 0.05, 0.072),
      boxGeo(-0.012, 0.012, -0.03, 0.03, -0.06, -0.025), boxGeo(-0.14, 0.012, -0.011, 0.011, -0.072, -0.05),
      boxGeo(-0.02, 0.02, 0.35, 0.39, 0.025, 0.03)].map(clean);    // + peephole ring
    return mergeGeometries(parts, false);
  })());
  // lever + peephole + brass inlay lines as one child mesh; mirrored per handle side
  const key = 'trim' + handleSide;
  const tg = _leafGeo[key] || (_leafGeo[key] = (() => {
    const hgC = hg.clone(); hgC.applyMatrix4(new THREE.Matrix4().makeScale(handleSide, 1, 1)); hgC.translate(handleSide * (w / 2 - 0.08), 1.02 - (DOOR_H - 0.01) / 2, 0);
    const inl = [0.55, 0.0, -0.55].flatMap(y => [clean(boxGeo(-w / 2 + 0.1, w / 2 - 0.1, y - 0.004, y + 0.004, 0.024, 0.029)), clean(boxGeo(-w / 2 + 0.1, w / 2 - 0.1, y - 0.004, y + 0.004, -0.029, -0.024))]);
    if (handleSide < 0) flipWinding(hgC);
    return mergeGeometries([hgC, ...inl], false);
  })());
  leaf.add(new THREE.Mesh(tg, M('brass')));
  return leaf;
}

// ============================================================ Lift
const LIFT_REGISTRY = new Set();
let _audio = null;
function chime() {
  try {
    const ua = navigator.userActivation;
    if (!ua || !ua.hasBeenActive) return;            // only after a user gesture
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    _audio = _audio || new AC();
    if (_audio.state === 'suspended') _audio.resume().catch(() => {});
    const t0 = _audio.currentTime + 0.02;
    [[1318.5, 0], [987.8, 0.28]].forEach(([f, dt]) => {
      const o = _audio.createOscillator(), g = _audio.createGain(), o2 = _audio.createOscillator(), g2 = _audio.createGain();
      o.type = 'sine'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2.01;
      g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.09, t0 + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dt + 1.3);
      g2.gain.setValueAtTime(0, t0 + dt); g2.gain.linearRampToValueAtTime(0.02, t0 + dt + 0.01); g2.gain.exponentialRampToValueAtTime(0.0003, t0 + dt + 0.6);
      o.connect(g).connect(_audio.destination); o2.connect(g2).connect(_audio.destination);
      o.start(t0 + dt); o2.start(t0 + dt); o.stop(t0 + dt + 1.4); o2.stop(t0 + dt + 0.7);
    });
  } catch { /* audio is optional */ }
}
const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function tween(ms, fn) {
  return new Promise(res => {
    const t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
}
// ============================================================ painted figures
// The people in the building (the visitor's reflection in the lift mirror, the concierge) are painted in code with
// canvas 2D — frontal fashion-illustration portraits in metres, y up, for a 1.74 m woman with her eyes at 1.61 m —
// and shown on cards. (Blurs use the shadow trick, not ctx.filter, so Safari paints the same picture.)
const PAINT = (() => {
  const lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  // smooth closed/open curve through points (Catmull-Rom → Bézier)
  function curve(g, pts, closed = true, move = true) {
    const n = pts.length, P = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    if (move) g.moveTo(pts[0][0], pts[0][1]);
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) g.closePath();
  }
  const sym = half => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];   // half: top centre → bottom centre
  function sample(pts, t) {   // Catmull-Rom sample of an open polyline, t ∈ [0, 1]
    const n = pts.length - 1, f = Math.min(n - 1e-6, Math.max(0, t * n)), i = Math.floor(f), u = f - i;
    const P = k => pts[Math.max(0, Math.min(n, k))], p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u);
    return [c(0), c(1)];
  }
  // Blurred fill without ctx.filter (Safari): draw the shape far off-canvas and keep only its shadow.
  function soft(g, S, path, color, blur) {
    const OFF = 6000;
    g.save(); g.shadowColor = color; g.shadowBlur = blur * S; g.shadowOffsetX = OFF; g.shadowOffsetY = 0;
    g.translate(-OFF / S, 0); g.fillStyle = '#000'; g.beginPath(); path(); g.fill(); g.restore();
  }
  const ellipse = (g, x, y, rx, ry, rot = 0) => { g.ellipse(x, y, rx, ry, rot, 0, TAU); };
  function limb(g, ax, ay, ra, bx, by, rb) {   // tapered capsule path
    const a = Math.atan2(by - ay, bx - ax), nx = -Math.sin(a), ny = Math.cos(a);
    g.moveTo(ax + nx * ra, ay + ny * ra); g.lineTo(bx + nx * rb, by + ny * rb);
    g.arc(bx, by, rb, a + Math.PI / 2, a - Math.PI / 2, true); g.lineTo(ax - nx * ra, ay - ny * ra);
    g.arc(ax, ay, ra, a - Math.PI / 2, a + Math.PI / 2, true); g.closePath();
  }
  function rr(g, x, y, w, h, r) { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function lg(g, x0, y0, x1, y1, stops) { const r = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([t, c]) => r.addColorStop(t, c)); return r; }
  function rg(g, x, y, r0, r1, stops) { const r = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([t, c]) => r.addColorStop(t, c)); return r; }

  const SKIN = { hi: '#fbe3d0', lt: '#f3cfb6', mid: '#e7b999', sh: 'rgba(168,104,74,', deep: 'rgba(120,66,46,' };
  const HAIRS = {
    blonde: { base: '#d8b46e', dark: '#9f7a3c', deep: '#7a5a28', light: '#f2dc9e', hi: '#fff4cf', brow: '#8b6b45' },
    brunette: { base: '#4a2f1f', dark: '#2c1a10', deep: '#1c100a', light: '#7a5236', hi: '#b98a5e', brow: '#3a2416' },
  };

  // ---- strands inside a lock bounded by two guide polylines (root → tip)
  function lock(g, S, outer0, inner0, H, seed, n = 90, wave = 0.006, curl = 0, shade = 1) {
    // curl: the whole lock undulates (big soft waves), growing from the root to the tip
    const wv = (pts, ph, k) => pts.map(([x, y], i) => { const t = i / (pts.length - 1); return [x + Math.sin(t * 10.5 + ph) * curl * k * Math.min(1, t * 1.8), y]; });
    const dense = pts => { const o = []; for (let i = 0; i <= 28; i++) o.push(sample(pts, i / 28)); return o; };
    const outer = wv(dense(outer0), seed, 1), inner = wv(dense(inner0), seed + 0.6, 0.55);
    const poly = []; const N = 40;
    for (let i = 0; i <= N; i++) poly.push(sample(outer, i / N));
    for (let i = N; i >= 0; i--) poly.push(sample(inner, i / N));
    const ys = poly.map(p => p[1]), y1 = Math.max(...ys), y0 = Math.min(...ys);
    g.beginPath(); g.moveTo(poly[0][0], poly[0][1]); for (const p of poly) g.lineTo(p[0], p[1]); g.closePath();
    g.fillStyle = lg(g, 0, y1, 0, y0, [[0, H.base], [0.1, H.hi], [0.2, H.light], [0.36, H.base], [0.55, H.dark], [0.7, H.light], [0.82, H.base], [1, H.light]]);
    g.fill();
    g.save(); g.clip();
    const r = rng(seed);
    for (let k = 0; k < n; k++) {
      const u = r(), ph = r() * TAU, amp = wave * (0.4 + r()), fr = 5 + r() * 4;
      const tone = r(), col = tone < 0.3 ? H.dark : tone < 0.55 ? H.base : tone < 0.86 ? H.light : H.hi;
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, a = sample(outer, t), b = sample(inner, t);
        const w = Math.sin(t * fr + ph) * amp * Math.min(1, t * 2.2);
        const x = lerp(a[0], b[0], u) + w, y = lerp(a[1], b[1], u);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokeStyle = col; g.globalAlpha = (tone < 0.3 ? 0.4 : 0.5) * shade; g.lineWidth = 0.0009 + r() * 0.0022; g.lineCap = 'round'; g.stroke();
    }
    g.globalAlpha = 1; g.restore();
  }

  function eye(g, S, cx, cy, d0, iris) {   // d0 = +1 right of the face (viewer), −1 left
    const K = 1.17; g.save(); g.translate(cx, cy); g.scale(d0 * K, K); cx = 0; cy = 0; const d = 1;
    const ix = cx - d * 0.0152, ox = cx + d * 0.016, iy = cy - 0.0016, oy = cy + 0.0024;
    const shape = () => { g.moveTo(ix, iy); g.bezierCurveTo(cx - d * 0.008, cy + 0.0092, cx + d * 0.007, cy + 0.0098, ox, oy); g.bezierCurveTo(cx + d * 0.009, cy - 0.0062, cx - d * 0.005, cy - 0.0066, ix, iy); g.closePath(); };
    soft(g, S, () => ellipse(g, cx + d * 0.002, cy + 0.008, 0.021, 0.009), SKIN.sh + '0.3)', 0.006);   // socket
    soft(g, S, () => ellipse(g, cx + d * 0.006, cy + 0.009, 0.012, 0.004), 'rgba(150,100,90,0.3)', 0.004);   // a touch of eye shadow
    g.beginPath(); shape(); g.fillStyle = '#f7f3ee'; g.fill();
    g.save(); g.beginPath(); shape(); g.clip();
    const ex = cx + d * 0.0004, ey = cy + 0.0012, R = 0.0074;
    g.beginPath(); ellipse(g, ex, ey, R, R); g.fillStyle = rg(g, ex, ey - 0.002, 0.001, R, [[0, iris[0]], [0.68, iris[1]], [0.92, iris[2]], [1, iris[2]]]); g.fill();
    g.beginPath(); ellipse(g, ex, ey, 0.003, 0.003); g.fillStyle = '#120c08'; g.fill();
    soft(g, S, () => g.rect(cx - 0.02, cy + 0.0052, 0.04, 0.01), 'rgba(40,24,16,0.6)', 0.003);   // lid shadow on the eyeball
    g.beginPath(); ellipse(g, ex - d0 * 0.0026, ey + 0.0026, 0.0016, 0.0013); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    g.beginPath(); ellipse(g, ex + d0 * 0.0026, ey - 0.002, 0.0008, 0.0007); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
    g.restore();
    // upper lash line with a soft wing + a few lashes, faint lower line
    g.beginPath(); g.moveTo(ix, iy + 0.0004); g.bezierCurveTo(cx - d * 0.008, cy + 0.0102, cx + d * 0.007, cy + 0.011, ox + d * 0.0036, oy + 0.0034);
    g.bezierCurveTo(cx + d * 0.008, cy + 0.0082, cx - d * 0.007, cy + 0.0078, ix, iy + 0.0004); g.fillStyle = '#24160f'; g.fill();
    for (let k = 0; k < 5; k++) { const t = 0.45 + k * 0.13, bx = lerp(ix, ox, t), by = cy + 0.0085 - Math.abs(t - 0.55) * 0.006;
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + d * 0.001, by + 0.0016, bx + d * (0.0016 + k * 0.0003), by + 0.0022); g.strokeStyle = 'rgba(36,22,15,0.8)'; g.lineWidth = 0.0007; g.lineCap = 'round'; g.stroke(); }
    g.beginPath(); g.moveTo(ox, oy); g.bezierCurveTo(cx + d * 0.009, cy - 0.0066, cx - d * 0.004, cy - 0.007, ix + d * 0.004, iy - 0.0016);
    g.strokeStyle = 'rgba(70,40,28,0.45)'; g.lineWidth = 0.0007; g.stroke();
    g.beginPath(); g.moveTo(ix + d * 0.003, cy + 0.0092); g.bezierCurveTo(cx - d * 0.004, cy + 0.0148, cx + d * 0.008, cy + 0.0148, ox + d * 0.001, cy + 0.0094);
    g.strokeStyle = SKIN.deep + '0.36)'; g.lineWidth = 0.0008; g.stroke();
    g.restore();
  }

  function face(g, S, H, o) {
    const iris = o.iris || ['#9cc0d6', '#4f7f9f', '#27445a'];
    const half = [[0, 1.74], [0.04, 1.735], [0.0635, 1.708], [0.0722, 1.662], [0.0718, 1.616], [0.067, 1.58], [0.0575, 1.553], [0.042, 1.533], [0.021, 1.522], [0, 1.5195]];
    const outline = () => curve(g, sym(half));
    g.beginPath(); outline();
    g.fillStyle = lg(g, 0, 1.75, 0, 1.5, [[0, SKIN.lt], [0.45, SKIN.lt], [1, SKIN.mid]]); g.fill();
    g.save(); g.beginPath(); outline(); g.clip();
    // form: darker toward the jaw sides, brighter centre plane
    for (const d of [-1, 1]) soft(g, S, () => ellipse(g, d * 0.088, 1.585, 0.03, 0.1), SKIN.sh + '0.42)', 0.02);
    soft(g, S, () => ellipse(g, 0, 1.672, 0.03, 0.018), 'rgba(255,240,226,0.5)', 0.02);          // forehead light
    soft(g, S, () => ellipse(g, 0, 1.534, 0.016, 0.008), 'rgba(255,238,224,0.4)', 0.008);        // chin light
    for (const d of [-1, 1]) {
      soft(g, S, () => ellipse(g, d * 0.044, 1.588, 0.02, 0.013), 'rgba(226,120,108,0.26)', 0.014);   // blush
      soft(g, S, () => ellipse(g, d * 0.038, 1.602, 0.012, 0.007), 'rgba(255,236,220,0.45)', 0.008); // cheekbone light
    }
    // nose: bridge light, side shade, tip, nostrils
    soft(g, S, () => ellipse(g, 0.0095, 1.596, 0.0035, 0.018), SKIN.sh + '0.22)', 0.005);
    soft(g, S, () => ellipse(g, -0.001, 1.598, 0.0028, 0.018), 'rgba(255,240,228,0.5)', 0.004);
    soft(g, S, () => ellipse(g, 0, 1.579, 0.0052, 0.0042), 'rgba(255,238,226,0.6)', 0.004);
    soft(g, S, () => ellipse(g, 0, 1.5695, 0.012, 0.0028), SKIN.sh + '0.4)', 0.004);
    for (const d of [-1, 1]) {
      g.beginPath(); ellipse(g, d * 0.0066, 1.5728, 0.003, 0.0016, d * 0.35); g.fillStyle = SKIN.deep + '0.6)'; g.fill();
      g.beginPath(); g.moveTo(d * 0.0114, 1.5805); g.quadraticCurveTo(d * 0.0138, 1.5745, d * 0.0096, 1.5715); g.strokeStyle = SKIN.deep + '0.3)'; g.lineWidth = 0.0008; g.stroke();
    }
    // eyes + brows
    for (const d of [-1, 1]) {
      eye(g, S, d * 0.0325, 1.612, d, iris);
      g.beginPath(); g.moveTo(d * 0.0135, 1.638); g.bezierCurveTo(d * 0.028, 1.6445, d * 0.044, 1.6475, d * 0.0605, 1.6385);
      g.bezierCurveTo(d * 0.045, 1.6438, d * 0.028, 1.6398, d * 0.0138, 1.634); g.closePath(); g.fillStyle = H.brow; g.globalAlpha = 0.9; g.fill(); g.globalAlpha = 1;
    }
    // lips
    const my = 1.5505, mw = 0.0255;
    soft(g, S, () => ellipse(g, 0, my - 0.0105, 0.016, 0.003), SKIN.sh + '0.35)', 0.004);       // under the lower lip
    const cy2 = my + 0.0026;   // corners lifted: a gentle smile
    g.beginPath(); g.moveTo(-mw, cy2); g.bezierCurveTo(-0.015, my + 0.0066, -0.0065, my + 0.0092, -0.003, my + 0.0078); g.quadraticCurveTo(0, my + 0.006, 0.003, my + 0.0078);
    g.bezierCurveTo(0.0065, my + 0.0092, 0.015, my + 0.0066, mw, cy2); g.bezierCurveTo(0.012, my - 0.0006, -0.012, my - 0.0006, -mw, cy2); g.closePath();
    g.fillStyle = o.lipTop || '#b8545c'; g.fill();
    g.beginPath(); g.moveTo(-mw, cy2); g.bezierCurveTo(-0.012, my - 0.0004, 0.012, my - 0.0004, mw, cy2); g.bezierCurveTo(0.017, my - 0.0112, -0.017, my - 0.0112, -mw, cy2); g.closePath();
    g.fillStyle = lg(g, 0, my, 0, my - 0.01, [[0, o.lip || '#cf6c72'], [1, o.lipTop || '#b8545c']]); g.fill();
    soft(g, S, () => ellipse(g, 0.001, my - 0.004, 0.008, 0.0018), 'rgba(255,228,224,0.7)', 0.0024);
    g.beginPath(); g.moveTo(-mw - 0.0012, cy2 + 0.0006); g.bezierCurveTo(-0.012, my - 0.0004, 0.012, my - 0.0004, mw + 0.0012, cy2 + 0.0006); g.strokeStyle = 'rgba(96,36,40,0.75)'; g.lineWidth = 0.0009; g.lineCap = 'round'; g.stroke();
    for (const d of [-1, 1]) soft(g, S, () => ellipse(g, d * (mw + 0.003), my + 0.0036, 0.003, 0.003), SKIN.sh + '0.35)', 0.003);
    g.restore();
  }

  // Standing / seated woman, frontal. Heights for a 1.74 m woman (eye 1.62). o: { hair, outfit, arms }
  function paintWoman(g, S, o) {
    const H = HAIRS[o.hair === 'bun' ? 'brunette' : 'blonde'];
    const gown = o.outfit === 'gown';
    // ---------- hair behind the body
    if (o.hair === 'long') {
      const back = sym([[0, 1.778], [0.052, 1.773], [0.098, 1.738], [0.116, 1.68], [0.12, 1.6], [0.128, 1.52], [0.146, 1.44], [0.158, 1.36], [0.154, 1.28], [0.13, 1.225], [0.09, 1.21], [0.058, 1.25], [0, 1.31]]);
      g.beginPath(); curve(g, back); g.fillStyle = lg(g, 0, 1.78, 0, 1.22, [[0, H.dark], [0.3, H.deep], [1, H.dark]]); g.fill();
    } else {
      g.beginPath(); curve(g, sym([[0, 1.764], [0.045, 1.758], [0.078, 1.728], [0.086, 1.675], [0.08, 1.62], [0.06, 1.58], [0, 1.57]])); g.fillStyle = H.deep; g.fill();
      // low chignon peeking out behind the neck on one side
      g.beginPath(); ellipse(g, 0.052, 1.538, 0.04, 0.036, 0.3); g.fillStyle = rg(g, 0.06, 1.55, 0.004, 0.045, [[0, H.light], [0.5, H.base], [1, H.deep]]); g.fill();
    }
    // ---------- body skin: neck, shoulders, chest (the outfit covers the rest)
    const torso = sym([[0, 1.53], [0.034, 1.53], [0.037, 1.49], [0.043, 1.468], [0.085, 1.45], [0.145, 1.432], [0.178, 1.412], [0.19, 1.37], [0.172, 1.3], [0.16, 1.2], [0, 1.18]]);
    g.beginPath(); curve(g, torso); g.fillStyle = lg(g, 0, 1.52, 0, 1.2, [[0, SKIN.mid], [0.25, SKIN.lt], [1, SKIN.mid]]); g.fill();
    g.save(); g.beginPath(); curve(g, torso); g.clip();
    soft(g, S, () => ellipse(g, 0, 1.512, 0.05, 0.03), SKIN.sh + '0.6)', 0.014);                 // shadow of the chin on the neck
    for (const d of [-1, 1]) {
      soft(g, S, () => ellipse(g, d * 0.047, 1.47, 0.008, 0.035), SKIN.sh + '0.25)', 0.008);    // neck sides
      // collarbones: a light ridge with a soft shade below
      soft(g, S, () => { g.moveTo(d * 0.014, 1.434); g.quadraticCurveTo(d * 0.07, 1.452, d * 0.135, 1.432); g.quadraticCurveTo(d * 0.07, 1.444, d * 0.014, 1.428); }, 'rgba(255,238,224,0.5)', 0.004);
      soft(g, S, () => { g.moveTo(d * 0.016, 1.424); g.quadraticCurveTo(d * 0.07, 1.438, d * 0.13, 1.422); g.quadraticCurveTo(d * 0.07, 1.428, d * 0.016, 1.416); }, SKIN.sh + '0.3)', 0.005);
      soft(g, S, () => ellipse(g, d * 0.165, 1.402, 0.02, 0.016), 'rgba(255,238,224,0.45)', 0.012);   // shoulder light
    }
    soft(g, S, () => ellipse(g, 0, 1.436, 0.008, 0.006), SKIN.sh + '0.35)', 0.004);              // notch between the collarbones
    soft(g, S, () => ellipse(g, 0, 1.36, 0.05, 0.03), 'rgba(255,240,228,0.35)', 0.02);           // chest light
    if (gown) soft(g, S, () => ellipse(g, 0, 1.285, 0.0035, 0.03), SKIN.sh + '0.3)', 0.007);     // a discreet hint of shape above the neckline
    g.restore();
    // ---------- arms
    // one smooth contour per arm: shoulder → elbow → wrist toward the centre (hands meet in front of the hips)
    const armPath = (d, pad = 0) => curve(g, [[0.146 - pad, 1.335], [0.168, 1.408 + pad], [0.196 + pad, 1.385], [0.203 + pad, 1.29], [0.202 + pad, 1.18], [0.194 + pad, 1.11], [0.15 + pad, 1.04], [0.082, 0.948 - pad],
      [0.05, 0.975], [0.064, 1.0 + pad], [0.118 - pad, 1.068], [0.15 - pad, 1.135], [0.146 - pad, 1.24]].map(([x, y]) => [d * x, y]));
    const arm = d => {
      g.beginPath(); armPath(d); g.fillStyle = lg(g, d * 0.13, 0, d * 0.21, 0, [[0, SKIN.mid], [0.5, SKIN.lt], [1, SKIN.mid]]); g.fill();
      g.save(); g.beginPath(); armPath(d); g.clip();
      soft(g, S, () => curve(g, [[0.14, 1.33], [0.152, 1.24], [0.156, 1.135], [0.12, 1.06], [0.06, 0.99], [0.04, 1.0], [0.1, 1.09], [0.13, 1.16], [0.125, 1.3]].map(([x, y]) => [d * x, y])), SKIN.sh + '0.42)', 0.01);
      soft(g, S, () => ellipse(g, d * 0.186, 1.3, 0.008, 0.07), 'rgba(255,240,228,0.5)', 0.008);
      soft(g, S, () => ellipse(g, d * 0.176, 1.12, 0.016, 0.01), SKIN.sh + '0.22)', 0.008);
      g.restore();
      return [d * 0.066, 0.962];
    };
    // ---------- outfit
    if (gown) {
      // floor-length black satin column gown: thin straps, V neckline, fitted waist, soft flare at the hem
      const C = o.cloth;
      const dress = sym([[0, 1.262], [0.045, 1.336], [0.074, 1.352], [0.112, 1.345], [0.146, 1.322], [0.159, 1.272], [0.146, 1.2], [0.126, 1.105], [0.14, 1.02], [0.17, 0.93], [0.172, 0.78], [0.15, 0.5], [0.16, 0.2], [0.2, 0.012], [0, 0.0]]);
      const path = () => { const p = dress; g.moveTo(p[0][0], p[0][1]); g.lineTo(p[1][0], p[1][1]); curve(g, p.slice(1, p.length - 1), false, false); g.lineTo(p[p.length - 1][0], p[p.length - 1][1]); g.closePath(); };
      for (const d of [-1, 1]) { g.beginPath(); g.moveTo(d * 0.078, 1.452); g.lineTo(d * 0.09, 1.45); g.lineTo(d * 0.1, 1.345); g.lineTo(d * 0.07, 1.35); g.closePath(); g.fillStyle = C[1]; g.fill(); }
      g.beginPath(); path(); g.fillStyle = lg(g, -0.18, 0, 0.18, 0, [[0, C[2]], [0.3, C[1]], [0.5, C[0]], [0.7, C[1]], [1, C[2]]]); g.fill();
      g.save(); g.beginPath(); path(); g.clip();
      // satin: long soft highlights following the body, deep folds in the skirt
      for (const d of [-1, 1]) {
        soft(g, S, () => ellipse(g, d * 0.084, 1.272, 0.03, 0.03), C[3] + '0.2)', 0.03);
        soft(g, S, () => ellipse(g, d * 0.1, 0.96, 0.016, 0.1), C[3] + '0.22)', 0.024);
        soft(g, S, () => ellipse(g, d * 0.07, 0.55, 0.01, 0.3), C[3] + '0.2)', 0.018);
        soft(g, S, () => ellipse(g, d * 0.13, 0.3, 0.008, 0.25), 'rgba(0,0,0,0.6)', 0.012);
        soft(g, S, () => ellipse(g, d * 0.132, 1.13, 0.012, 0.09), 'rgba(0,0,0,0.55)', 0.012);
      }
      soft(g, S, () => ellipse(g, 0, 1.2, 0.01, 0.07), 'rgba(0,0,0,0.5)', 0.014);
      soft(g, S, () => ellipse(g, 0.0, 0.45, 0.006, 0.42), 'rgba(0,0,0,0.55)', 0.014);
      soft(g, S, () => ellipse(g, 0.03, 0.75, 0.01, 0.2), C[3] + '0.25)', 0.014);
      soft(g, S, () => ellipse(g, 0, 1.105, 0.13, 0.012), 'rgba(0,0,0,0.5)', 0.01);
      g.restore();
      // neckline edge catch-light
      g.beginPath(); g.moveTo(-0.074, 1.352); g.lineTo(-0.045, 1.336); g.lineTo(0, 1.262); g.lineTo(0.045, 1.336); g.lineTo(0.074, 1.352); g.strokeStyle = C[3] + '0.5)'; g.lineWidth = 0.0014; g.lineJoin = 'round'; g.stroke();
      // arms over the gown, hands holding a small gold clutch
      const wl = arm(-1), wr = arm(1);
      g.beginPath(); rr(g, -0.085, 0.885, 0.17, 0.085, 0.012); g.fillStyle = lg(g, -0.085, 0.97, 0.085, 0.885, [[0, '#f0d79a'], [0.45, '#c9a25a'], [1, '#8f6c30']]); g.fill();
      g.beginPath(); rr(g, -0.085, 0.885, 0.17, 0.085, 0.012); g.strokeStyle = 'rgba(90,62,20,0.6)'; g.lineWidth = 0.0012; g.stroke();
      g.beginPath(); g.moveTo(-0.08, 0.948); g.lineTo(0.08, 0.948); g.strokeStyle = 'rgba(255,240,200,0.6)'; g.lineWidth = 0.001; g.stroke();
      for (const [d, [wx, wy]] of [[-1, wl], [1, wr]]) {
        // hand: palm over the clutch edge, fingers wrapping the front
        g.beginPath(); ellipse(g, wx - d * 0.012, wy - 0.022, 0.026, 0.03, d * 0.5); g.fillStyle = SKIN.lt; g.fill();
        for (let k = 0; k < 4; k++) { g.beginPath(); limb(g, wx - d * (0.02 + k * 0.004), wy - 0.036 + k * 0.011, 0.0072, wx - d * (0.058 - k * 0.002), wy - 0.05 + k * 0.012, 0.006); g.fillStyle = k % 2 ? SKIN.lt : SKIN.hi; g.fill();
          g.strokeStyle = SKIN.sh + '0.35)'; g.lineWidth = 0.0007; g.stroke(); }
      }
    } else {
      // fitted blazer over an ivory silk top with a modest V; structured shoulders, notch lapels, one button
      const C = o.cloth, T = o.top;
      g.beginPath(); g.moveTo(-0.1, 1.4); g.lineTo(0, 1.305); g.lineTo(0.1, 1.4); g.lineTo(0.11, 1.1); g.lineTo(-0.11, 1.1); g.closePath();
      g.fillStyle = lg(g, -0.1, 0, 0.1, 0, [[0, T[1]], [0.5, T[0]], [1, T[1]]]); g.fill();
      soft(g, S, () => ellipse(g, 0, 1.24, 0.008, 0.05), 'rgba(120,100,80,0.22)', 0.01);
      g.beginPath(); g.moveTo(-0.1, 1.4); g.lineTo(0, 1.305); g.lineTo(0.1, 1.4); g.strokeStyle = 'rgba(150,130,100,0.5)'; g.lineWidth = 0.0012; g.stroke();
      const outer = [[0.095, 1.458], [0.15, 1.442], [0.188, 1.416], [0.199, 1.365], [0.182, 1.3], [0.164, 1.2], [0.144, 1.1], [0.156, 1.0], [0.18, 0.9], [0.182, 0.84]];
      const jp = () => { for (const d of [-1, 1]) { g.moveTo(d * 0.082, 1.445); g.lineTo(d * 0.095, 1.458); curve(g, outer.map(([x, y]) => [d * x, y]), false, false); g.lineTo(0, 0.84); g.lineTo(0, 1.17); g.lineTo(d * 0.012, 1.17); g.lineTo(d * 0.058, 1.3); g.closePath(); } };
      g.beginPath(); jp(); g.fillStyle = lg(g, -0.2, 0, 0.2, 0, [[0, C[2]], [0.28, C[1]], [0.5, C[0]], [0.72, C[1]], [1, C[2]]]); g.fill();
      g.save(); g.beginPath(); jp(); g.clip();
      for (const d of [-1, 1]) {
        soft(g, S, () => ellipse(g, d * 0.09, 1.275, 0.04, 0.04), C[3] + '0.22)', 0.02);            // soft form light
        soft(g, S, () => ellipse(g, d * 0.142, 1.13, 0.012, 0.1), 'rgba(0,0,0,0.5)', 0.012);         // waist shade
        soft(g, S, () => ellipse(g, d * 0.158, 1.424, 0.028, 0.009), C[3] + '0.3)', 0.01);             // shoulder line
      }
      soft(g, S, () => ellipse(g, 0.004, 1.0, 0.004, 0.16), 'rgba(0,0,0,0.6)', 0.006);                // front closure
      g.restore();
      // lapels
      for (const d of [-1, 1]) {
        g.beginPath(); g.moveTo(d * 0.082, 1.44); g.lineTo(d * 0.058, 1.3); g.lineTo(d * 0.012, 1.17); g.lineTo(d * 0.06, 1.25); g.lineTo(d * 0.112, 1.33); g.lineTo(d * 0.1, 1.365); g.lineTo(d * 0.122, 1.39); g.lineTo(d * 0.1, 1.452); g.closePath();
        g.fillStyle = lg(g, d * 0.02, 1.2, d * 0.12, 1.42, [[0, C[1]], [1, C[0]]]); g.fill(); g.strokeStyle = C[3] + '0.28)'; g.lineWidth = 0.0011; g.lineJoin = 'round'; g.stroke();
      }
      g.beginPath(); ellipse(g, 0.004, 1.13, 0.0085, 0.0085); g.fillStyle = rg(g, 0.002, 1.133, 0.001, 0.009, [[0, '#f6e2a6'], [1, '#9c7a3a']]); g.fill();
      // small gold brand pin on the lapel
      g.beginPath(); g.moveTo(0.078, 1.352); g.lineTo(0.1, 1.362); g.lineTo(0.09, 1.35); g.lineTo(0.104, 1.34); g.lineTo(0.084, 1.343); g.closePath(); g.fillStyle = '#e8c27a'; g.fill();
      if (o.arms !== 'none') for (const d of (o.arms === 'both' ? [-1, 1] : [o.arms === 'left' ? -1 : 1])) armSleeve(g, S, o, d);
    }
    // ---------- head
    g.beginPath(); g.moveTo(-0.036, 1.54); g.lineTo(0.036, 1.54); g.lineTo(0.04, 1.47); g.lineTo(-0.04, 1.47); g.closePath();   // neck (re-drawn above collars)
    if (!gown) { g.fillStyle = lg(g, 0, 1.52, 0, 1.47, [[0, SKIN.mid], [1, SKIN.lt]]); g.fill(); soft(g, S, () => ellipse(g, 0, 1.512, 0.036, 0.022), SKIN.sh + '0.55)', 0.012); }
    for (const d of [-1, 1]) { g.beginPath(); ellipse(g, d * 0.0745, 1.612, 0.008, 0.019, d * 0.12); g.fillStyle = SKIN.mid; g.fill(); }   // ears (mostly under hair)
    face(g, S, H, o);
    // ---------- hair in front
    if (o.hair === 'long') {
      const Ro = [[-0.02, 1.766], [0.048, 1.762], [0.094, 1.724], [0.108, 1.652], [0.112, 1.572], [0.122, 1.492], [0.14, 1.412], [0.15, 1.332], [0.142, 1.262], [0.112, 1.206]];
      const Ri = [[-0.02, 1.712], [0.014, 1.703], [0.044, 1.68], [0.0625, 1.64], [0.0695, 1.582], [0.074, 1.502], [0.078, 1.422], [0.086, 1.342], [0.094, 1.272], [0.1, 1.216]];
      const Lo = [[-0.02, 1.768], [-0.068, 1.757], [-0.102, 1.718], [-0.113, 1.652], [-0.116, 1.572], [-0.126, 1.492], [-0.142, 1.412], [-0.152, 1.332], [-0.144, 1.262], [-0.114, 1.206]];
      const Li = [[-0.02, 1.714], [-0.034, 1.706], [-0.052, 1.682], [-0.0635, 1.64], [-0.0705, 1.582], [-0.075, 1.502], [-0.079, 1.422], [-0.088, 1.342], [-0.096, 1.272], [-0.102, 1.216]];
      // soft shadow of the hair on the face / shoulders
      for (const [Oq, Iq] of [[Ro, Ri], [Lo, Li]]) soft(g, S, () => { for (let i = 0; i <= 20; i++) { const p = sample(Iq, i / 20); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } for (let i = 20; i >= 0; i--) { const p = sample(Oq, i / 20); g.lineTo(p[0], p[1]); } }, 'rgba(110,70,40,0.35)', 0.008);
      lock(g, S, Ro, Ri, H, 11, 150, 0.004, 0.02);
      lock(g, S, Lo, Li, H, 29, 150, 0.004, 0.02);
      // crown sheen
      soft(g, S, () => { g.moveTo(-0.02, 1.768); g.lineTo(-0.017, 1.768); g.lineTo(-0.019, 1.714); g.lineTo(-0.022, 1.714); }, 'rgba(110,80,30,0.7)', 0.003);   // the parting
    } else {
      // sleek side-parted hair swept back into a low chignon
      const Ro = [[-0.022, 1.764], [0.04, 1.76], [0.078, 1.726], [0.087, 1.672], [0.085, 1.618], [0.079, 1.582]];
      const Ri = [[-0.022, 1.71], [0.012, 1.702], [0.042, 1.682], [0.0615, 1.65], [0.0705, 1.612], [0.073, 1.586]];
      const Lo = [[-0.022, 1.766], [-0.058, 1.757], [-0.084, 1.724], [-0.089, 1.672], [-0.086, 1.618], [-0.08, 1.582]];
      const Li = [[-0.022, 1.712], [-0.034, 1.706], [-0.052, 1.688], [-0.066, 1.652], [-0.0725, 1.612], [-0.0745, 1.586]];
      for (const [Oq, Iq] of [[Ro, Ri], [Lo, Li]]) soft(g, S, () => { for (let i = 0; i <= 20; i++) { const p = sample(Iq, i / 20); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } for (let i = 20; i >= 0; i--) { const p = sample(Oq, i / 20); g.lineTo(p[0], p[1]); } }, 'rgba(60,30,20,0.35)', 0.007);
      lock(g, S, Ro, Ri, H, 5, 80, 0.0015);
      lock(g, S, Lo, Li, H, 7, 70, 0.0015);
      soft(g, S, () => { g.moveTo(-0.022, 1.766); g.lineTo(-0.019, 1.766); g.lineTo(-0.021, 1.712); g.lineTo(-0.024, 1.712); }, 'rgba(20,10,6,0.7)', 0.003);
      soft(g, S, () => { g.moveTo(0.0, 1.742); g.quadraticCurveTo(0.045, 1.74, 0.07, 1.7); g.quadraticCurveTo(0.04, 1.728, 0.0, 1.742); }, 'rgba(200,150,110,0.45)', 0.006);
    }
    // ---------- jewellery
    for (const d of [-1, 1]) { g.beginPath(); ellipse(g, d * 0.0765, 1.588, 0.0042, 0.0042); g.fillStyle = rg(g, d * 0.0755, 1.5895, 0.0005, 0.0045, [[0, '#fff6d8'], [0.5, '#e6c476'], [1, '#9a7732']]); g.fill();
      if (gown) { g.beginPath(); ellipse(g, d * 0.0768, 1.574, 0.003, 0.0075); g.fillStyle = '#e6c476'; g.fill(); } }
    g.beginPath(); g.moveTo(-0.042, 1.462); g.quadraticCurveTo(0, gown ? 1.372 : 1.392, 0.042, 1.462); g.strokeStyle = 'rgba(214,176,98,0.95)'; g.lineWidth = 0.0011; g.stroke();
    g.beginPath(); ellipse(g, 0, gown ? 1.412 : 1.422, 0.0048, 0.0062); g.fillStyle = rg(g, -0.001, gown ? 1.414 : 1.424, 0.0005, 0.006, [[0, '#fff6d8'], [0.5, '#e6c476'], [1, '#9a7732']]); g.fill();
  }

  // blazer sleeve hanging at the side, forearm resting toward the lap (d = ±1)
  function armSleeve(g, S, o, d) {
    const C = o.cloth, sx = d * 0.168, sy = 1.385, ex = d * 0.19, ey = 1.12, wx = d * 0.1, wy = 0.94;
    g.beginPath(); limb(g, sx, sy, 0.044, ex, ey, 0.038); g.fillStyle = lg(g, sx - 0.05, 0, sx + 0.05, 0, [[0, C[2]], [0.5, C[0]], [1, C[2]]]); g.fill();
    g.beginPath(); limb(g, ex, ey, 0.038, wx, wy, 0.032); g.fillStyle = lg(g, 0, ey, 0, wy, [[0, C[1]], [1, C[2]]]); g.fill();
    g.save(); g.beginPath(); limb(g, sx, sy, 0.044, ex, ey, 0.038); g.clip(); soft(g, S, () => limb(g, sx - d * 0.05, sy, 0.02, ex - d * 0.05, ey, 0.02), 'rgba(0,0,0,0.45)', 0.012); g.restore();
  }

  // The waving arm of the concierge as two sprites, drawn pointing down from their pivots (shoulder / elbow at the origin).
  function paintArmUpper(g, S, o) {
    const C = o.cloth;
    g.beginPath(); limb(g, 0, 0, 0.044, 0, -0.265, 0.038); g.fillStyle = lg(g, -0.05, 0, 0.05, 0, [[0, C[2]], [0.5, C[0]], [1, C[2]]]); g.fill();
  }
  function paintArmFore(g, S, o) {
    const C = o.cloth, T = o.top;
    g.beginPath(); limb(g, 0, 0, 0.038, 0, -0.2, 0.031); g.fillStyle = lg(g, -0.045, 0, 0.045, 0, [[0, C[2]], [0.5, C[0]], [1, C[2]]]); g.fill();
    g.beginPath(); rr(g, -0.03, -0.228, 0.06, 0.02, 0.004); g.fillStyle = T[0]; g.fill();          // cuff of the silk top
    // open hand, palm to the visitor, fingers toward −y
    const hy = -0.262;
    g.beginPath(); rr(g, -0.034, hy - 0.04, 0.068, 0.085, 0.022); g.fillStyle = lg(g, -0.034, 0, 0.034, 0, [[0, SKIN.mid], [0.5, SKIN.hi], [1, SKIN.mid]]); g.fill();
    const fl = [0.046, 0.054, 0.05, 0.04];
    for (let k = 0; k < 4; k++) { const fx = -0.0255 + k * 0.017, a = (k - 1.5) * 0.07; g.beginPath(); limb(g, fx, hy - 0.034, 0.0086, fx + Math.sin(a) * fl[k], hy - 0.034 - Math.cos(a) * fl[k], 0.0074); g.fillStyle = lg(g, fx - 0.008, 0, fx + 0.008, 0, [[0, SKIN.mid], [0.5, SKIN.hi], [1, SKIN.mid]]); g.fill(); }
    g.beginPath(); limb(g, 0.03, hy + 0.012, 0.0105, 0.062, hy - 0.022, 0.0078); g.fillStyle = SKIN.lt; g.fill();   // thumb
    soft(g, S, () => ellipse(g, 0, hy - 0.004, 0.018, 0.02), SKIN.sh + '0.18)', 0.008);
  }
  const FIG_STYLES = {
    mirror: { hair: 'long', outfit: 'gown', cloth: ['#3b3a40', '#18171b', '#060607', 'rgba(210,205,220,'] },
    concierge: { hair: 'bun', outfit: 'blazer', arms: 'left', cloth: ['#2d3550', '#1a2036', '#0c0f1c', 'rgba(170,185,230,'], top: ['#fbf6ea', '#d9cfbb'], iris: ['#b08a5c', '#6e4a2a', '#2e1c10'], lip: '#c7656b', lipTop: '#aa4f58' },
  };
  return { paintWoman, paintArmUpper, paintArmFore, FIG_STYLES };
})();
// kind → { tex, w, y0, y1 }: the painted card (width, bottom and top in the figure's metres), cached
const FIG_CARDS = { mirror: [0.5, 0, 1.8, 1000, 'mirror', 'paintWoman'], concierge: [0.5, 0.84, 1.8, 900, 'concierge', 'paintWoman'],
  armU: [0.11, -0.32, 0.055, 900, 'concierge', 'paintArmUpper'], armF: [0.22, -0.37, 0.05, 900, 'concierge', 'paintArmFore'] };
function figCard(kind) {
  const [w, y0, y1, S, style, fn] = FIG_CARDS[kind];
  const tex = cached('fig:' + kind, () => {
    const c = canvas(Math.round(w * S), Math.round((y1 - y0) * S)), g = c.getContext('2d');
    g.setTransform(S, 0, 0, -S, c.width / 2, y1 * S);
    PAINT[fn](g, S, PAINT.FIG_STYLES[style]);
    const t = texOf(c, { repeat: false }); t.anisotropy = 4; return t;
  });
  return { tex, w, y0, y1 };
}

const _mirM = new THREE.Matrix4();
// the triangles of a geometry that reach in front of the plane x = xm (null if none)
function frontOf(geo, xm) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, keep = [];
  for (let i = 0; i < p.count; i += 3) if (Math.min(p.getX(i), p.getX(i + 1), p.getX(i + 2)) < xm) keep.push(i);
  if (!keep.length) return null;
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) {
    const n = a.itemSize, arr = new a.array.constructor(keep.length * 3 * n);
    keep.forEach((i, j) => arr.set(a.array.subarray(i * n, (i + 3) * n), j * 3 * n));
    out.setAttribute(k, new THREE.BufferAttribute(arr, n, a.normalized));
  }
  return out;
}
// The visitor in the lift mirror: a standing woman in an evening gown. The card lies in the z–y plane (parallel to
// the glass) at the mirrored camera position; it is the last thing drawn inside the mirror window, so it can blend
// softly (premultiplied) without sorting against anything.
const REFL = { eye: 1.612, neck: 1.47 };
function makeReflection(st) {
  const { tex, w, y0, y1 } = figCard('mirror'), R = REFL;
  const g = new THREE.PlaneGeometry(w, y1 - y0, 6, 18); g.rotateY(Math.PI / 2); g.translate(0, (y0 + y1) / 2, 0);
  const base = g.attributes.position.array.slice(), pos = g.attributes.position;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xf2ece4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, ...st });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'vrc-lift-reflection';
  const s = { yaw: 0, t0: Math.random() * 10 };
  return {
    mesh,
    // cp / cd: camera position and view direction in car-local coordinates; xm: mirror plane
    place(cp, cd, xm) {
      mesh.visible = xm - cp.x < 3.2;
      if (!mesh.visible) return;
      const t = performance.now() / 1000 + s.t0, br = Math.sin(t * 1.5), sw = Math.sin(t * 0.43);
      // she turns with the visitor: looking along the car instead of into the glass shows her turned a little away
      const off = clamp(Math.atan2(cd.z, Math.max(0.05, cd.x)), -1.2, 1.2);
      s.yaw += (off * 0.4 - s.yaw) * 0.1;
      mesh.position.set(cp.x, cp.y - R.eye, cp.z + sw * 0.005);
      mesh.rotation.set(sw * 0.005, s.yaw, 0);
      // idle: breathing lifts chest and shoulders a few millimetres, the head tilts a touch
      const tilt = Math.sin(t * 0.31 + 1) * 0.02 + s.yaw * 0.06;
      for (let i = 0; i < pos.count; i++) {
        const y = base[i * 3 + 1], z = base[i * 3 + 2];
        const k = sstep(1.0, 1.36, y), hk = sstep(R.neck - 0.04, R.neck + 0.06, y);
        let ny = y + 0.004 * br * k, nz = z * (1 + 0.008 * br * k * (1 - hk));
        if (hk > 0) { const dy = ny - R.neck; nz -= dy * tilt * hk; ny += z * tilt * hk * 0.5; }
        pos.setY(i, ny); pos.setZ(i, nz);
      }
      pos.needsUpdate = true;
      mesh.updateMatrix(); mesh.updateMatrixWorld(true);
    },
  };
}

// Car interior (lift-local frame: +z = liftNormal, z = 0 on the landing wall line, x across the door):
const CAR = { x: 0.8, zf: -0.18, zb: -1.9, h: 2.45 };
const CAR_LUX = 4.5;   // the one shared car light (candela), moved to whichever car is active
// Shaft built around a landing (lift frame): inner face of the side walls at ±SHAFT_X, back wall ends SHAFT_Z behind the door line.
const SHAFT_X = CAR.x + 0.08, SHAFT_Z = 0.26 - CAR.zb;

export class Lift {
  // One landing of one lift of a tower. bId: building; core: always 0 (one core per tower; the argument is kept for the
  // old signature and ignored); doorIndex: index into coresOf(bId)[0].liftDoors; floor: landing floor of this instance,
  // one of liftFloors(bId) (the car starts here; −1 uses the floor-1 core projected down). The lift serves
  // liftFloors(bId) = −1, 1…N at the real levels floorY(bId, f). opts.decor: static, not registered. (opts.rear of the
  // base site — through-cars — does not exist here and is ignored.)
  constructor(bId, core, doorIndex, floor = 1, opts = {}) {
    if (!BUILDINGS[bId]) bId = B_IDS[0];
    floor = liftStop(bId, floor);
    this.bId = bId; this.core = 0;
    const C = coresOf(bId, floor === -1 ? 1 : floor)[0];
    doorIndex = clamp(doorIndex | 0, 0, Math.max(0, C.liftDoors.length - 1));
    this.stair = C.stair; this.doorIndex = doorIndex; this.floor = floor; this.homeFloor = floor;
    this.doorsOpen = false; this.moving = false; this.rear = false; this.target = null;
    this.occupied = false;          // set by the walker while someone stands in the car (keeps it visible with doors shut)
    this.carDepth = CAR_DEPTH;
    this.floors = liftFloors(bId);  // the stops of this lift
    // every lift has its own normal (from the shaft INTO the hall): the two lifts of a core may face opposite ways
    const [dx, dz] = C.liftDoors[doorIndex], [nx, nz] = (C.liftNormals && C.liftNormals[doorIndex]) || C.liftNormal;
    this.door = [dx, dz]; this.normal = [nx, nz];
    this._shaftH = clamp(floorH(bId, floor) - 0.2, 2.6, 3.4);
    this.group = new THREE.Group(); this.group.name = `vrc-lift-${bId}-${C.stair}-${doorIndex}`;
    const frame = new THREE.Group(); frame.position.set(dx, 0, dz); frame.rotation.y = Math.atan2(nx, nz); this.group.add(frame);
    this.frame = frame;
    this.landing = new THREE.Group(); this.landing.position.y = floorY(bId, floor); frame.add(this.landing);
    this.car = new THREE.Group(); this.car.position.y = floorY(bId, floor); frame.add(this.car); this.car.visible = false;
    // indicator (shared by landing + car)
    this.ind = canvas(256, 96); this.indTex = texOf(this.ind, { repeat: false });
    this.indMat = new THREE.MeshBasicMaterial({ map: this.indTex, color: new THREE.Color(2.3, 2.3, 2.3) });
    this._drawInd(floor, 0);
    this._buildLanding(opts);
    this._buildCar();
    if (!opts.decor) LIFT_REGISTRY.add(this);
    if (BUILD.lifts) BUILD.lifts.push(this);
    this._openP = null; this._closeP = null;
  }
  get y() { return this.car.position.y; }
  _drawInd(f, dir) {
    const g = this.ind.getContext('2d');
    g.fillStyle = '#070605'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#f3c978'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // caption in Ukrainian above the number: "ПОВЕРХ" (car park: "ПАРКІНГ")
    g.font = `600 15px ${SANS}`; if ('letterSpacing' in g) g.letterSpacing = '4px';
    g.fillText((f === -1 ? WORDS.parking : WORDS.floor).toUpperCase(), 152, 15);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.font = `600 60px ${SANS}`;
    g.shadowColor = 'rgba(255,190,90,0.8)'; g.shadowBlur = 12;
    g.fillText(floorLabel(f), 150, 60);
    if (dir) { g.beginPath(); if (dir > 0) { g.moveTo(58, 34); g.lineTo(82, 66); g.lineTo(34, 66); } else { g.moveTo(58, 80); g.lineTo(82, 48); g.lineTo(34, 48); } g.closePath(); g.fill(); }
    g.shadowBlur = 0; this.indTex.needsUpdate = true; this._indF = f; this._indD = dir;
  }
  _panelPair(parent, z, dir) {   // two door panels (left/right) at depth z; dir: +1 faces +z
    const g = new THREE.BoxGeometry(0.53, LIFT_H - 0.01, 0.035); g.translate(0, (LIFT_H - 0.01) / 2, 0);
    worldUV(g, 1);
    const L = new THREE.Mesh(g, M('bronze')), R = new THREE.Mesh(g, M('bronze'));
    L.position.set(-0.26, 0.002, z); R.position.set(0.26, 0.002, z);
    for (const p of [L, R]) { p.userData.solid = true; p.userData.dynamic = true; parent.add(p); }
    // vertical reveal line where panels meet
    return [L, R, g];
  }
  _buildLanding() {
    const b = new Batch(), sh = this._shaftH, X = SHAFT_X, zB = -SHAFT_Z;
    // shaft (only near this landing; the shaft above/below is never seen): side walls hug the car, a return closes the
    // back of the door pockets, thin caps end the pockets inside the hall wall
    for (const s of [-1, 1]) {
      b.box('plasterW', s * X, s * (X + 0.1), -0.3, sh, -WALL_T - 0.02, zB);
      b.box('plasterW', s * X, s * (POCKET + 0.04), -0.3, sh, -WALL_T - 0.1, -WALL_T - 0.02);
      b.box('plasterW', s * POCKET, s * (POCKET + 0.04), -0.3, sh, 0.02, -WALL_T - 0.02);
    }
    b.box('plasterW', -X - 0.1, X + 0.1, -0.3, sh, zB, zB + 0.1);
    b.box('nero', -0.5, 0.5, -0.02, 0.012, -0.1, 0.02);           // threshold into the car
    // indicator housing above the opening (hall side)
    b.box('blackGlass', -0.2, 0.2, LIFT_H + 0.11, LIFT_H + 0.27, FACE + SKIN, FACE + SKIN + 0.01);
    b.flush(this.landing);
    this._geos = [];
    const ig = new THREE.PlaneGeometry(0.34, 0.13); this._geos.push(ig);
    const ind = new THREE.Mesh(ig, this.indMat); ind.position.set(0, LIFT_H + 0.19, FACE + SKIN + 0.012); this.landing.add(ind);
    const [L, R, g] = this._panelPair(this.landing, -0.055); this._geos.push(g);
    this.landDoors = [L, R];
  }
  _buildCar() {
    const b = new Batch(), s = new Batch(), fl = new Batch();
    const { x, zf, zb, h } = CAR;
    // floor & ceiling
    b.box('nero', -x, x, -0.06, 0, zb - 0.1, zf + 0.08);
    b.box('carFrame', -x - 0.04, x + 0.04, h, h + 0.05, zb - 0.06, zf + 0.02);
    // soft contact darkening along the car walls (floor) and around the LED ceiling
    const xi = x - 0.012, fy = 0.003;
    aoQuad(b, 'aoFloor', [-xi, fy, zb], [-xi, fy, zf], [0.22, 0, 0]); aoQuad(b, 'aoFloor', [xi, fy, zb], [xi, fy, zf], [-0.22, 0, 0]);
    aoQuad(b, 'aoFloor', [-xi, fy, zb + 0.012], [xi, fy, zb + 0.012], [0, 0, 0.22]);
    aoQuad(b, 'aoCeil', [-xi, h - 0.053, zb], [-xi, h - 0.053, zf], [0.12, 0, 0]); aoQuad(b, 'aoCeil', [xi, h - 0.053, zb], [xi, h - 0.053, zf], [-0.12, 0, 0]);
    // LED ceiling: glowing panel framed in bronze with dot grid
    b.box('bronze', -x + 0.02, x - 0.02, h - 0.05, h, zb + 0.02, zf - 0.02);
    b.box('ledCar', -x + 0.14, x - 0.14, h - 0.052, h - 0.05, zb + 0.14, zf - 0.14);
    // perimeter light slot (cove) between the bronze frame and the car walls + a strip over the door header
    for (const sx of [-1, 1]) b.box('ledCarDot', sx * (x - 0.035), sx * (x - 0.02), h - 0.056, h - 0.05, zb + 0.03, zf - 0.03);
    for (const zz of [zb + 0.025, zf - 0.035]) b.box('ledCarDot', -x + 0.03, x - 0.03, h - 0.056, h - 0.05, zz, zz + 0.012);
    for (let i = 1; i < 4; i++) { const xx = -x + 0.14 + (i / 4) * (2 * x - 0.28); b.box('brass', xx - 0.01, xx + 0.01, h - 0.09, h - 0.052, zb + 0.14, zf - 0.14); }
    for (let i = 1; i < 4; i++) { const zz = zb + 0.14 + (i / 4) * (zf - zb - 0.28); b.box('brass', -x + 0.14, x - 0.14, h - 0.09, h - 0.052, zz - 0.01, zz + 0.01); }
    b.box('brass', -x + 0.13, x - 0.13, h - 0.09, h - 0.052, zb + 0.13, zb + 0.15); b.box('brass', -x + 0.13, x - 0.13, h - 0.09, h - 0.052, zf - 0.15, zf - 0.13);
    b.box('brass', -x + 0.13, -x + 0.15, h - 0.09, h - 0.052, zb + 0.13, zf - 0.13); b.box('brass', x - 0.15, x - 0.13, h - 0.09, h - 0.052, zb + 0.13, zf - 0.13);
    // side walls: brushed bronze panels with dark reveals
    for (const sx of [-1, 1]) {
      const xi = sx * x, xo = sx * (x + 0.04);
      s.box('carFrame', xi, xo, 0, h, zb - 0.04, zf);
      for (const [z0, z1] of [[zb, zb + 0.56], [zb + 0.58, zb + 1.14], [zb + 1.16, zf]]) b.box('bronzeCar', xi, xi - sx * 0.012, 0.12, h - 0.06, z0 + 0.005, z1 - 0.005);
      b.box('carFrame', xi, xi - sx * 0.02, 0, 0.12, zb, zf);   // kick
    }
    // mirror on the left (+x) wall, framed
    const MR = { x: x - 0.018, y0: 0.95, y1: h - 0.14, z0: zb + 0.12, z1: zf - 0.12 };   // the glass itself: _buildMirror()
    b.box('carFrame', x - 0.012, x - 0.016, MR.y0, MR.y1, MR.z0, MR.z1);
    b.box('bronze', x - 0.012, x - 0.03, 0.92, 0.95, zb + 0.1, zf - 0.1);
    b.box('bronze', x - 0.012, x - 0.024, MR.y1, MR.y1 + 0.02, zb + 0.1, zf - 0.1);
    for (const zz of [MR.z0 - 0.02, MR.z1]) b.box('bronze', x - 0.012, x - 0.024, MR.y0, MR.y1, zz, zz + 0.02);
    // handrails (+x wall and back)
    const rail = (x0, x1, z0, z1) => { b.box('brass', x0, x1, 0.9, 0.94, z0, z1); };
    rail(x - 0.09, x - 0.05, zb + 0.15, zf - 0.15);
    for (const zz of [zb + 0.2, zf - 0.2]) b.box('brass', x - 0.09, x - 0.012, 0.905, 0.935, zz - 0.015, zz + 0.015);
    rail(-x + 0.15, x - 0.15, zb + 0.05, zb + 0.09);
    // front return walls + header (doors between)
    for (const sx of [-1, 1]) { s.box('carFrame', sx * 0.5, sx * x, 0, h, zf, zf + 0.04); b.box('bronzeCar', sx * 0.505, sx * (x - 0.005), 0.12, h - 0.06, zf - 0.012, zf); }
    s.box('carFrame', -0.5, 0.5, LIFT_H, h, zf, zf + 0.04);
    // back: a second pair of doors in a bronze wall (decor: there are no rear landings in these towers, they stay shut)
    for (const sx of [-1, 1]) { s.box('carFrame', sx * 0.5, sx * x, 0, h, zb - 0.04, zb); b.box('bronzeCar', sx * 0.505, sx * (x - 0.005), 0.12, h - 0.06, zb, zb + 0.012); }
    s.box('carFrame', -0.5, 0.5, LIFT_H, h, zb - 0.04, zb);
    // operating panel (COP) on the front return wall beside the doors (−x side), facing the back of the car:
    // a tall black-glass column in a brass frame. zs = its face; the visitor reads it from `this.stand` at the back.
    const P = this.panel = { xc: -0.652, zs: zf - 0.028, y0: 0.7, y1: 1.885, hw: 0.138 };
    this.stand = { x: 0.14, z: zb + 0.42, look: [-0.24, 1.5, zf] };   // car-local standing spot + look-at point
    b.box('blackGlass', P.xc - P.hw, P.xc + P.hw, P.y0, P.y1, P.zs, zf - 0.012);
    for (const [y0, y1, x0, x1] of [[P.y0 - 0.008, P.y0, -P.hw - 0.008, P.hw + 0.008], [P.y1, P.y1 + 0.008, -P.hw - 0.008, P.hw + 0.008],
      [P.y0, P.y1, -P.hw - 0.008, -P.hw], [P.y0, P.y1, P.hw, P.hw + 0.008]]) b.box('brass', P.xc + x0, P.xc + x1, y0, y1, P.zs - 0.003, zf - 0.012);
    // soft LED edge-light behind the COP plate
    b.box('ledSoft', P.xc - P.hw - 0.012, P.xc + P.hw + 0.012, P.y0 - 0.012, P.y1 + 0.012, zf - 0.0135, zf - 0.0115);
    // screen bezel + hairline between the floor keys and the door keys
    b.box('bronzeDark', P.xc - 0.108, P.xc + 0.108, 1.686, 1.776, P.zs - 0.002, P.zs);
    b.box('brass', P.xc - 0.115, P.xc + 0.115, 0.9395, 0.9425, P.zs - 0.002, P.zs);
    // interior indicator above the door
    b.box('blackGlass', -0.22, 0.22, LIFT_H + 0.06, LIFT_H + 0.22, zf - 0.012, zf - 0.02);
    const shell = b.flush(this.car);
    const walls = s.flush(this.car, { solid: true });
    fl.add('hidden', (() => { const g = new THREE.PlaneGeometry(2 * x, zf - zb + 0.3); g.rotateX(-Math.PI / 2); g.translate(0, 0, (zf + zb) / 2 + 0.08); return g; })());
    fl.flush(this.car, { floor: true });
    const ci = new THREE.Mesh(this._geos[0], this.indMat); ci.rotation.y = Math.PI; ci.position.set(0, LIFT_H + 0.14, zf - 0.022); this.car.add(ci);
    // small VILNYI emblem (gold brand mark + wordmark) above the floor screen
    { const lg = new THREE.PlaneGeometry(0.21, 0.0615); lg.rotateY(Math.PI); this._geos.push(lg);
      const lm = new THREE.Mesh(lg, M('copLogo')); lm.position.set(P.xc, 1.828, P.zs - 0.0025); this.car.add(lm); }
    // floor screen on the panel (same live indicator texture)
    const sg = new THREE.PlaneGeometry(0.2, 0.075); sg.rotateY(Math.PI); this._geos.push(sg);
    const scr = new THREE.Mesh(sg, this.indMat); scr.position.set(P.xc, 1.731, P.zs - 0.0025); this.car.add(scr);
    // keys: stainless face (engraved label from the atlas), brass rim, halo ring that lights up, generous invisible hit pad.
    // Key groups are built facing +x and turned to face the back of the car (−z); pressing pushes them into the wall (+z).
    const mkGeos = (R, hw, hh) => {
      const rimG = new THREE.CylinderGeometry(R + 0.0015, R + 0.0025, 0.006, 40); rimG.rotateZ(Math.PI / 2);
      const ringG = new THREE.TorusGeometry(R + 0.0035, 0.0024, 8, 48); ringG.rotateY(Math.PI / 2);
      const hitG = new THREE.BoxGeometry(0.003, hh, hw);   // thin: a thick pad would shadow its neighbours when seen at an angle
      this._geos.push(rimG, ringG, hitG); return { rimG, ringG, hitG, R };
    };
    const lay = this.layout = panelLayout(this.bId), KG = KEY_GEOM[lay.cols], nR = lay.rows.length;
    const pv = nR > 1 ? Math.min(KEY_PV, 0.59 / (nR - 1)) : KEY_PV, yMid = 1.305;   // the key field is centred on 1.305 m
    const GF = mkGeos(Math.min(KG.R, pv * 0.37), KG.ph, pv), GD = mkGeos(KEY_R2, 0.128, 0.11), GA = mkGeos(KEY_R3, 0.2, 0.1);
    this.buttons = new Map();
    const ids = { building: this.bId, stair: this.stair, core: this.core, doorIndex: this.doorIndex };
    const addKey = (k, G, xk, y) => {
      const g = new THREE.Group(); g.position.set(xk, y, P.zs); g.rotation.y = Math.PI / 2;
      const fg = new THREE.CircleGeometry(G.R, 40); fg.rotateY(Math.PI / 2);
      const [cu, cv, du, dv] = keyUV(keyCell(k)), uv = fg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + uv.getX(i) * du, cv + uv.getY(i) * dv);
      this._geos.push(fg);
      const rim = new THREE.Mesh(G.rimG, M('brass')); rim.position.x = 0.003;
      const face = new THREE.Mesh(fg, M('keyFace')); face.position.x = 0.0062;
      const ring = new THREE.Mesh(G.ringG, M('keyRing')); ring.position.x = 0.0012;
      const hit = new THREE.Mesh(G.hitG, M('hidden')); hit.position.x = 0.008;
      g.add(rim, face, ring, hit);
      g.userData.action = typeof k === 'number' ? { type: 'liftButton', floor: k, ...ids }
        : k === 'bell' ? { type: 'liftAlarm', ...ids } : { type: 'liftDoor', open: k === 'open', ...ids };
      g.name = 'vrc-lift-key-' + (typeof k === 'number' ? floorLabel(k) : k);
      this.car.add(g); this.buttons.set(k, { g, face, ring, z0: P.zs });
    };
    // seen from the back of the car the viewer's right is −x: ascending numbers run left → right, bottom → top
    lay.rows.forEach((row, ri) => row.forEach((k, ci) => addKey(k, GF, P.xc + ((lay.cols - 1) / 2 - ci) * KG.ph, yMid + (ri - (nR - 1) / 2) * pv)));
    ['open', 'close'].forEach((k, ci) => addKey(k, GD, P.xc + (0.5 - ci) * 0.128, 0.876));
    addKey('bell', GA, P.xc, 0.77);
    // doors
    const [L, R] = this._panelPair(this.car, zf + 0.06);
    const [L2, R2] = this._panelPair(this.car, zb - 0.06);
    this.carDoors = [L, R]; this.rearDoors = [L2, R2];
    this._shell = [...shell, ...walls];
    this._buildMirror(MR);
  }
  // A real mirror without a second render pass: the glass is a stencil window onto a reflected copy of the car
  // (same geometry and materials under a −x scale, so it costs ~20 draw calls and no extra lights or programs), with
  // the visitor's reflection — a photographic figure on a soft-edged card — standing at the mirrored camera position.
  // Order (all in the opaque queue, after the real scene): 10 stencil window · 11 backdrop, resets depth inside the
  // window · 12 reflected car · 13 the figure · 14 depth back to the glass, so later transparent passes stay in front.
  _buildMirror(MR) {
    const ref = 1 + Math.max(0, B_IDS.indexOf(this.bId)) * 4 + this.doorIndex;   // one stencil value per lift shaft of the complex
    const mats = this._mirMats = [], geos = this._geos;
    const st = { stencilWrite: true, stencilRef: ref, stencilFunc: THREE.EqualStencilFunc };
    const w = MR.z1 - MR.z0, hh = MR.y1 - MR.y0, zc = (MR.z0 + MR.z1) / 2, yc = (MR.y0 + MR.y1) / 2;
    const pg = new THREE.PlaneGeometry(w, hh); pg.rotateY(-Math.PI / 2); geos.push(pg);
    const mk = (m, order, parent = this.car) => { const o = new THREE.Mesh(pg, m); o.position.set(MR.x, yc, zc); o.renderOrder = order; mats.push(m); parent.add(o); return o; };
    const win = mk(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: ref, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp }), 10);
    mk(new THREE.MeshBasicMaterial({ colorWrite: false, depthFunc: THREE.AlwaysDepth, ...st }), 14);
    // backdrop: what the reflection shows beyond the reflected car (through its open doors): a warm dim void
    const bg = new THREE.BoxGeometry(2.0, 3.2, 5.2); geos.push(bg);
    const bm = new THREE.MeshBasicMaterial({ color: 0x8a7a66, side: THREE.BackSide, depthFunc: THREE.AlwaysDepth, ...st }); mats.push(bm);
    const back = new THREE.Mesh(bg, bm); back.position.set(MR.x + 1.0, 1.25, (CAR.zf + CAR.zb) / 2); back.renderOrder = 11; this.car.add(back);
    // the reflected car
    const mir = this.mirror = new THREE.Group(); mir.name = 'vrc-lift-mirror'; mir.scale.x = -1; mir.position.x = 2 * MR.x; this.car.add(mir);
    const cache = new Map();
    const sten = m => { let c = cache.get(m); if (!c) { c = m.clone(); Object.assign(c, st); c.name = m.name + '-mir'; cache.set(m, c); mats.push(c); } return c; };
    const copy = o => { const c = new THREE.Mesh(o.geometry, sten(o.material)); c.position.copy(o.position); c.rotation.copy(o.rotation); c.renderOrder = 12; mir.add(c); return c; };
    // (whatever lies behind the glass — the mirror wall itself — must not show up in front of it once reflected)
    for (const o of this._shell) if (!o.material.transparent) {
      const cg = frontOf(o.geometry, MR.x - 0.0005);
      if (cg) { geos.push(cg); copy(o).geometry = cg; }
    }
    this._mirDoors = [...this.carDoors, ...this.rearDoors].map(o => [o, copy(o)]);
    // key faces + floor screen of the reflected operating panel (one merged mesh + one quad)
    const kf = [];
    for (const { g, face } of this.buttons.values()) { g.updateMatrix(); face.updateMatrix(); kf.push(face.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(g.matrix, face.matrix))); }
    const kg = mergeGeometries(kf, false); kf.forEach(g => g.dispose()); geos.push(kg);
    const km = new THREE.Mesh(kg, sten(M('keyFace'))); km.renderOrder = 12; mir.add(km);
    // the visitor's reflection
    const fig = this.reflection = makeReflection(st); mats.push(fig.mesh.material); geos.push(fig.mesh.geometry);
    fig.mesh.renderOrder = 13; mir.add(fig.mesh);
    const cp = new THREE.Vector3(), cd = new THREE.Vector3();
    // the reflected car is only submitted while the glass is on screen (decided one frame late: both hooks run mid-frame)
    mir.visible = false;
    this._shell[0].onBeforeRender = () => { mir.visible = !!this._mirSeen; this._mirSeen = false; };
    win.onBeforeRender = (r, sc, cam) => {
      this._mirSeen = true; mir.visible = true;
      this.car.worldToLocal(cp.setFromMatrixPosition(cam.matrixWorld));
      cam.getWorldDirection(cd).transformDirection(_mirM.copy(this.car.matrixWorld).invert());
      fig.place(cp, cd, MR.x);
    };
  }
  _setDoors(k, rearToo) {
    const off = 0.26 + 0.505 * k;
    const sets = [this.carDoors];
    if (this.floor === this.homeFloor) sets.push(this.landDoors.slice(0, 2));
    if (rearToo) sets.push(this.rearDoors);
    for (const [L, R] of sets) { L.position.x = -off; R.position.x = off; }
    if (this._mirDoors) for (const [o, c] of this._mirDoors) c.position.x = o.position.x;
  }
  _solid(on) {
    const all = [...this.carDoors, ...this.rearDoors, ...this.landDoors];
    for (const p of all) p.userData.solid = true;
    if (!on) {
      for (const p of this.carDoors) p.userData.solid = false;
      if (this.floor === this.homeFloor) for (const p of this.landDoors.slice(0, 2)) p.userData.solid = false;
    }
  }
  _rearNow() { return this.rear && this.floor === this.homeFloor; }
  _carLight(on) {
    const R = lightRig();
    if (on) R.carOwner = this; else if (R.carOwner !== this) return;
    if (!R.group.parent) return;
    if (!on) { R.car.intensity = 0; R.carOwner = null; return; }
    this.car.updateMatrixWorld(true); R.group.parent.updateMatrixWorld(true);
    const v = this.car.localToWorld(new THREE.Vector3(0, CAR.h - 0.35, (CAR.zf + CAR.zb) / 2));
    R.group.worldToLocal(v); R.car.position.copy(v); R.car.intensity = CAR_LUX;
  }
  async open() {
    if (this.doorsOpen) return;
    if (this._openP) return this._openP;
    if (this._closeP) await this._closeP;
    this.car.visible = true; this._carLight(true);
    const rear = this._rearNow();
    this._openP = tween(1100, k => this._setDoors(ease(k), rear)).then(() => { this.doorsOpen = true; this._solid(false); this._openP = null; });
    return this._openP;
  }
  async close() {
    if (this._openP) await this._openP;
    if (!this.doorsOpen) return;
    if (this._closeP) return this._closeP;
    this._solid(true);
    const rear = this._rearNow();
    this._closeP = tween(1000, k => this._setDoors(1 - ease(k), rear)).then(() => {
      this.doorsOpen = false; this._closeP = null;
      if (!this.moving && !this.occupied) { this.car.visible = false; this._carLight(false); }
    });
    return this._closeP;
  }
  _twin(floor) {
    for (const L of LIFT_REGISTRY) if (L !== this && L.bId === this.bId && L.core === this.core && L.doorIndex === this.doorIndex && L.homeFloor === floor && L.group.parent) return L;
    return null;
  }
  // Ride to `floor` (clamped to this lift's stops, liftFloors(bId)). onTick(y) receives the car floor's absolute
  // building-local y every frame; the ride ends exactly at floorY(bId, floor).
  // If the destination floor's commons (a twin Lift) already exists, its doors are left for the caller to open
  // (walk.js does that after swapping commons); otherwise this car's doors open on arrival.
  async travelTo(floor, onTick) {
    floor = liftStop(this.bId, floor);
    if (this.moving) return;
    if (floor === this.floor) { await this.open(); return; }
    this.moving = true; this.target = floor; this._lightButton(floor, true);
    this.car.visible = true;
    await this.close();
    this.car.visible = true;
    const stops = this.floors, ys = stops.map(f => floorY(this.bId, f));
    const y0 = floorY(this.bId, this.floor), y1 = floorY(this.bId, floor), n = Math.abs(stops.indexOf(floor) - stops.indexOf(this.floor));
    const dur = Math.min(6000, Math.max(1800, 1200 * n)), dir = Math.sign(y1 - y0);
    const acc = Math.min(0.3, 1100 / dur);   // trapezoidal velocity: accelerate / cruise / decelerate
    const prof = k => { const vmax = 1 / (1 - acc); if (k < acc) return 0.5 * vmax * k * k / acc; if (k > 1 - acc) { const r = 1 - k; return 1 - 0.5 * vmax * r * r / acc; } return vmax * (k - acc / 2); };
    this._drawInd(this.floor, dir);
    await new Promise(r => setTimeout(r, 250));
    await tween(dur, k => {
      const y = y0 + (y1 - y0) * prof(k);
      this.car.position.y = y; this._carLight(true);
      let near = this.floor, bd = 1e9; for (let i = 0; i < stops.length; i++) { const d = Math.abs(ys[i] - y); if (d < bd) { bd = d; near = stops[i]; } }
      if (near !== this._indF) this._drawInd(near, dir);
      if (onTick) try { onTick(y); } catch (e) { console.warn(e); }
    });
    this.car.position.y = y1; if (onTick) try { onTick(y1); } catch (e) { console.warn(e); }
    this.floor = floor; this.moving = false; this.target = null;
    this._drawInd(floor, 0); this._lightButton(floor, false);
    chime();
    await new Promise(r => setTimeout(r, 350));
    if (!this._twin(floor)) await this.open();
  }
  // Key feedback: the halo ring glows (red for the alarm) and the stainless face picks up a warm tint.
  _lightButton(k, on) {
    const b = this.buttons && this.buttons.get(k); if (!b) return;
    b.ring.material = on ? M(k === 'bell' ? 'keyRingRed' : 'keyRingLit') : M('keyRing');
    b.face.material = on ? M('keyFaceLit') : M('keyFace');
    b.lit = !!on;
  }
  /** Press a key: short push-in travel + light. Floor keys stay lit until the car arrives; door/alarm keys flash. */
  press(k, holdMs = 0) {
    const b = this.buttons && this.buttons.get(k); if (!b) return;
    this._lightButton(k, true);
    const z0 = b.z0;
    tween(170, t => { b.g.position.z = z0 + 0.0035 * Math.sin(Math.PI * t); b.g.updateMatrixWorld(true); });
    if (holdMs) { clearTimeout(b._t); b._t = setTimeout(() => { if (this.target !== k) this._lightButton(k, false); }, holdMs); }
  }
  dispose() {
    LIFT_REGISTRY.delete(this);
    if (RIG.carOwner === this) { RIG.car.intensity = 0; RIG.carOwner = null; }
    this.group.traverse(o => { if (o.isMesh && o.geometry && !this._geos.includes(o.geometry)) o.geometry.dispose(); });
    this._geos.forEach(g => g.dispose());
    if (this._mirMats) this._mirMats.forEach(m => m.dispose());
    this.indTex.dispose(); this.indMat.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
// ============================================================ shared pieces
function callPlate(ctx, x, y, z, yaw, act) {   // brass hall-call plate with up/down keys (one action mesh); keys light when pressed
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
  const plate = new THREE.Mesh(ctx.geo('callPlate', () => new THREE.BoxGeometry(0.13, 0.28, 0.012)), M('brassPlate'));
  plate.userData.action = act; plate.name = 'vrc-lift-call';
  const bg = ctx.geo('callBtn', () => { const c = new THREE.CylinderGeometry(0.027, 0.027, 0.01, 32); c.rotateX(Math.PI / 2); return c; });
  const rg = ctx.geo('callRing', () => new THREE.TorusGeometry(0.031, 0.0026, 8, 40));
  const keys = [];
  for (const dy of [0.052, -0.052]) {
    const b = new THREE.Mesh(bg, M('callFace')); b.position.set(0, dy, 0.009); b.userData.dir = dy > 0 ? 1 : -1;
    const r = new THREE.Mesh(rg, M('keyRing')); r.position.set(0, dy, 0.0065);
    plate.add(b, r); keys.push([b, r]);
  }
  // engraved-look arrows (tiny dark triangles on the key faces)
  const tri = ctx.geo('callTri', () => { const s = new THREE.Shape(); s.moveTo(0, 0.011); s.lineTo(0.011, -0.008); s.lineTo(-0.011, -0.008); s.closePath(); return new THREE.ShapeGeometry(s); });
  for (const [b] of keys) { const t = new THREE.Mesh(tri, M('glyph')); t.position.set(0, 0, 0.0052); if (b.userData.dir < 0) t.rotation.z = Math.PI; b.add(t); }
  plate.userData.light = (on, which) => {
    for (const [b, r] of keys) {
      const lit = on && (!which || which === b || which.parent === b || which === r);
      b.material = M(lit ? 'callFaceLit' : 'callFace'); r.material = M(lit ? 'keyRingLit' : 'keyRing');
    }
  };
  // soft backlight halo on the wall around the plate (the plate floats 1 cm off a glowing edge)
  const halo = new THREE.Mesh(ctx.geo('callHalo', () => new THREE.PlaneGeometry(0.16, 0.31)), M('ledSoft')); halo.position.z = -0.0052;
  g.add(halo, plate); ctx.root.add(g); return g;
}
// Lift-lobby cove: a linear LED slot where the lift wall meets the ceiling + a warm wash grazing down the wall.
// Wall along x at surface z = zs, facing `dir` (±1 in z); gaps = [[a0, a1, top]] openings the wash must skip below `top`.
const WASH_H = 2.3;
function coveWall(B, a0, a1, zs, dir, H, gaps = []) {
  B.box('led', a0, a1, H - 0.032, H - 0.018, zs, zs + dir * 0.045);
  B.box('bronzeDark', a0, a1, H - 0.018, H, zs, zs + dir * 0.055);
  const yaw = dir > 0 ? 0 : Math.PI, zp = zs + dir * 0.003, yb = H - WASH_H;
  const quad = (x0, x1, y0, y1) => {
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return;
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0); g.translate(0, (y0 + y1) / 2, 0);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i), clamp((p.getY(i) - yb) / WASH_H));
    B.add('wash', g, mat4((x0 + x1) / 2, 0, zp, yaw));
  };
  const gs = gaps.map(([g0, g1, t]) => [Math.max(a0, g0), Math.min(a1, g1), t]).filter(([g0, g1]) => g1 > g0).sort((p, q) => p[0] - q[0]);
  let a = a0;
  for (const [g0, g1, t] of gs) { quad(a, g0, Math.max(0, yb), H - 0.032); quad(g0, g1, Math.max(t + 0.02, yb), H - 0.032); a = Math.max(a, g1); }
  quad(a, a1, Math.max(0, yb), H - 0.032);
}
const opGaps = ops => ops.map(o => [o.c - o.w / 2 - 0.08, o.c + o.w / 2 + 0.08, o.kind === 'lift' ? LIFT_H + 0.3 : o.h + 0.06]);
function framedArt(ctx, x, y, z, yaw, w, h, k) {   // canvas in a slim bronze frame + picture light
  const b = new Batch();
  b.box('bronze', -w / 2 - 0.035, w / 2 + 0.035, -h / 2 - 0.035, h / 2 + 0.035, 0, 0.03);
  b.add('art' + (k % 3), new THREE.PlaneGeometry(w, h).translate(0, 0, 0.032));
  b.box('brass', -w * 0.3, w * 0.3, h / 2 + 0.07, h / 2 + 0.1, 0.02, 0.12);
  b.add('pool', new THREE.PlaneGeometry(w * 1.4, h * 0.9).translate(0, h * 0.22, 0.034));
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; b.flush(g); ctx.root.add(g); return g;
}
function consoleTable(B, x, z, yaw, len = 1.4) {   // walnut console on bronze legs with a sculptural vase
  const m = mat4(x, 0, z, yaw);
  const add = (mat, g) => B.add(mat, g, m);
  add('walnut', boxGeo(-len / 2, len / 2, 0.76, 0.8, -0.18, 0.18));
  for (const sx of [-1, 1]) add('bronze', boxGeo(sx * (len / 2 - 0.06) - 0.015, sx * (len / 2 - 0.06) + 0.015, 0, 0.76, -0.15, 0.15));
  add('bronze', boxGeo(-len / 2 + 0.06, len / 2 - 0.06, 0.1, 0.12, -0.02, 0.02));
  const vase = new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.12, 0.08], [0.1, 0.25], [0.05, 0.34], [0.045, 0.42], [0.06, 0.45]].map(([a, b]) => new THREE.Vector2(a, b)), 28);
  vase.translate(-len * 0.22, 0.8, 0); add('nero', vase);
  const bowl = new THREE.SphereGeometry(0.12, 24, 12, 0, TAU, Math.PI / 2, Math.PI / 2); bowl.scale(1, 0.45, 1); bowl.rotateX(Math.PI); bowl.translate(len * 0.22, 0.86, 0); add('brass', bowl);
}
function plant(B, x, z, s = 1) {   // tall planter with a sculpted olive-like crown
  const m = mat4(x, 0, z, 0, s, s, s);
  const pot = new THREE.CylinderGeometry(0.25, 0.19, 0.64, 32); pot.translate(0, 0.32, 0); B.add('pot', pot, m);
  B.add('brass', new THREE.TorusGeometry(0.25, 0.008, 6, 40).rotateX(Math.PI / 2).translate(0, 0.64, 0), m);
  const r = rng((x * 100 + z * 7) | 0);
  const trunk = new THREE.CylinderGeometry(0.018, 0.035, 1.25, 7); trunk.translate(0, 1.15, 0); B.add('bronzeDark', trunk, m);
  for (let b = 0; b < 6; b++) {
    const a = r() * TAU, cx = Math.cos(a) * (0.12 + r() * 0.2), cz = Math.sin(a) * (0.12 + r() * 0.2), cy = 1.45 + r() * 0.55;
    const br = new THREE.CylinderGeometry(0.006, 0.012, Math.hypot(cx, cy - 1.3, cz), 5); br.translate(0, Math.hypot(cx, cy - 1.3, cz) / 2, 0);
    br.rotateX(Math.PI / 2); br.lookAt(new THREE.Vector3(cx, cy - 1.3, cz)); B.add('bronzeDark', br.translate(0, 1.3, 0), m);
    for (let i = 0; i < 26; i++) {
      const lg = new THREE.PlaneGeometry(0.075, 0.022); lg.rotateY(r() * TAU); lg.rotateX((r() - 0.5) * 1.2);
      lg.translate(cx + (r() - 0.5) * 0.3, cy + (r() - 0.5) * 0.22, cz + (r() - 0.5) * 0.3); B.add(i % 3 ? 'leaf' : 'leaf2', lg, m);
    }
  }
}
function rbox(x0, x1, y0, y1, z0, z1, r = 0.05) { const g = new RoundedBoxGeometry(x1 - x0, y1 - y0, z1 - z0, 3, Math.min(r, (x1 - x0) / 2.1, (y1 - y0) / 2.1, (z1 - z0) / 2.1)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; }
function armchair(B, x, z, yaw, mat = 'velvet') {   // tub lounge chair: rounded shell, loose seat cushion, bronze sled base
  const m = mat4(x, 0, z, yaw);
  B.add(mat, rbox(-0.4, 0.4, 0.14, 0.44, -0.37, 0.37, 0.08), m);
  B.add(mat, rbox(-0.41, 0.41, 0.36, 0.8, -0.42, -0.24, 0.08), m);
  B.add(mat, rbox(-0.43, -0.29, 0.3, 0.64, -0.42, 0.36, 0.06), m); B.add(mat, rbox(0.29, 0.43, 0.3, 0.64, -0.42, 0.36, 0.06), m);
  B.add('velvetSand', rbox(-0.29, 0.29, 0.42, 0.53, -0.24, 0.34, 0.05), m);
  B.add('velvetSand', rbox(-0.26, 0.26, 0.5, 0.78, -0.25, -0.13, 0.06), m);
  for (const sx of [-1, 1]) { B.add('bronze', boxGeo(sx * 0.33 - 0.012, sx * 0.33 + 0.012, 0.0, 0.14, -0.34, 0.34), m); B.add('bronze', boxGeo(sx * 0.33 - 0.012, sx * 0.33 + 0.012, 0.0, 0.02, -0.36, 0.36), m); }
}
function receptionChair(B, x, z, yaw) {   // counter-height swivel chair: bronze star base, foot ring, cognac leather
  const m = mat4(x, 0, z, yaw);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.3, g = boxGeo(-0.018, 0.018, 0.03, 0.06, 0, 0.3); g.rotateY(a); B.add('bronzeDark', g, m);
    const w = new THREE.SphereGeometry(0.028, 10, 8); w.translate(Math.sin(a) * 0.29, 0.028, Math.cos(a) * 0.29); B.add('pot', w, m);
  }
  B.add('brass', new THREE.CylinderGeometry(0.024, 0.03, 0.52, 16).translate(0, 0.32, 0), m);
  const ring = new THREE.TorusGeometry(0.21, 0.011, 8, 40); ring.rotateX(Math.PI / 2); ring.translate(0, 0.37, 0.02); B.add('brass', ring, m);
  B.add('leather', rbox(-0.24, 0.24, 0.57, 0.66, -0.22, 0.24, 0.04), m);
  B.add('leather', rbox(-0.22, 0.22, 0.76, 1.1, -0.3, -0.23, 0.035), m);
  B.add('bronzeDark', boxGeo(-0.02, 0.02, 0.58, 0.8, -0.27, -0.24), m);
}

// ---- the concierge: a seated young woman (fitted navy blazer over an ivory silk top, hair in a low chignon). Her
// upper body is a painted card (see PAINT) that breathes, tilts her head, nods and turns toward the visitor; the waving
// arm is two more cards; the lower body (pencil skirt, legs, heels) stays 3D for the views from beside the desk. 4 draw calls.
const FIG = { skin: 0xe7bfa2, legs: 0xd9ab8d, suit: 0x161b2c, satin: 0x2c303c, blouse: 0xf5f2ec, hair: 0x3b2618,
  eye: 0x2a1c14, lip: 0xb5676b, gold: 0xd8b26c, shoe: 0x121212 };
const _fc = new THREE.Color(), _V = (x, y, z) => new THREE.Vector3(x, y, z), _UP = new THREE.Vector3(0, 1, 0);
function tinted(g, hex) {
  const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  _fc.set(hex); const cnt = n.attributes.position.count, col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) { col[i * 3] = _fc.r; col[i * 3 + 1] = _fc.g; col[i * 3 + 2] = _fc.b; }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3)); return n;
}
function ell(rx, ry, rz, x, y, z, ws = 22, hs = 14) { const g = new THREE.SphereGeometry(1, ws, hs); g.scale(rx, ry, rz); g.translate(x, y, z); return g; }
function limb(a, b, ra, rb = ra, seg = 14) {   // tapered capsule from a to b
  const d = new THREE.Vector3().subVectors(b, a), L = d.length(), q = new THREE.Quaternion().setFromUnitVectors(_UP, d.clone().normalize());
  const parts = [new THREE.CylinderGeometry(rb, ra, L, seg, 1, true).translate(0, L / 2, 0), new THREE.SphereGeometry(ra, seg, 8), new THREE.SphereGeometry(rb, seg, 8).translate(0, L, 0)];
  const g = mergeGeometries(parts.map(p => { const n = p.toNonIndexed(); p.dispose(); n.deleteAttribute('uv'); return n; }), false);
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z); return g;
}
function figMesh(list, pivot) {
  const g = mergeGeometries(list.map(([geo, c]) => tinted(geo, c)), false);
  g.translate(-pivot.x, -pivot.y, -pivot.z); g.computeBoundingSphere(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, M('figure')); m.position.copy(pivot); return m;
}
function headShape(sx, sy, sz, cx, cy, cz) {   // one smooth skull: jaw tapers to a soft chin, no overlapping shells
  const g = new THREE.SphereGeometry(1, 36, 28), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) { const t = y * y; x *= 1 - 0.34 * t; z *= 1 - 0.1 * t; if (z > 0 && y < -0.3) z += 0.09 * (-y - 0.3); }
    if (y > 0.2 && z < 0) z *= 1 + 0.06 * (y - 0.2);   // a little more crown at the back
    p.setXYZ(i, x * sx + cx, y * sy + cy, z * sz + cz);
  }
  g.computeVertexNormals(); return g;
}
const FIG_MATS = {};
function makeConcierge(x, z, yaw, bId, stair = 1, ws = 1) {   // faces [sin yaw, cos yaw]; ws: which arm waves (+1: +x side, −1: −x side)
  const S = 0.66, F = FIG;   // seat top
  const root = new THREE.Group(); root.name = 'vrc-concierge';
  root.position.set(x, 0, z); root.rotation.y = yaw;
  root.userData.action = { type: 'concierge', building: bId, stair };
  root.userData.dynamic = true;
  // lower body: pencil skirt to the knee, legs, heels resting on the chair's foot ring
  const lower = [[ell(0.162, 0.1, 0.152, 0, S + 0.08, -0.03), F.suit]];
  for (const sx of [-1, 1]) {
    lower.push([limb(_V(sx * 0.078, S + 0.08, -0.02), _V(sx * 0.066, S + 0.075, 0.355), 0.074, 0.058), F.suit]);
    lower.push([ell(0.047, 0.05, 0.05, sx * 0.064, S + 0.066, 0.378), F.legs]);
    lower.push([limb(_V(sx * 0.064, S + 0.055, 0.392), _V(sx * 0.056, 0.375, 0.29), 0.041, 0.029), F.legs]);
    lower.push([ell(0.032, 0.027, 0.092, sx * 0.056, 0.358, 0.34), F.shoe]);
    lower.push([limb(_V(sx * 0.056, 0.352, 0.265), _V(sx * 0.056, 0.29, 0.26), 0.008, 0.006, 6), F.shoe]);
  }
  const legs = figMesh(lower, _V(0, 0, 0)); legs.userData.solid = true; root.add(legs);
  // upper body: the painted card (blazer, face, hair) + her waving arm as two more cards hinged at shoulder and elbow.
  // The card swivels toward the visitor like someone turning on a swivel chair; cut-out edges are smoothed by MSAA
  // (alpha to coverage), so the cards write depth and need no sorting.
  const DY = S - 0.88, B = figCard('concierge');   // figure metres → seated: her hips come down to the seat
  const cardMat = t => FIG_MATS[t.uuid] || (FIG_MATS[t.uuid] = new THREE.MeshBasicMaterial({ name: 'vrc-figure-card', map: t, color: 0xf4efe8, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true }));
  const up = new THREE.Group(); up.position.set(0, DY, 0.02); up.scale.x = ws; root.add(up);   // ws = −1: the other arm waves
  const bg = new THREE.PlaneGeometry(B.w, B.y1 - B.y0, 6, 12); bg.translate(0, (B.y0 + B.y1) / 2, 0);
  const base = bg.attributes.position.array.slice(), pos = bg.attributes.position;
  const body = new THREE.Mesh(bg, cardMat(B.tex)); body.name = 'vrc-concierge-body'; up.add(body);
  const sprite = (kind, z) => { const c = figCard(kind), g = new THREE.PlaneGeometry(c.w, c.y1 - c.y0); g.translate(0, (c.y0 + c.y1) / 2, z); return new THREE.Mesh(g, cardMat(c.tex)); };
  const upper = new THREE.Group(); upper.position.set(0.168, 1.385, 0); up.add(upper); upper.add(sprite('armU', 0.004));
  const fore = new THREE.Group(); fore.position.set(0, -0.265, 0); upper.add(fore); fore.add(sprite('armF', 0.008));
  const hc = 1.61 + DY, NECK = 1.47;

  const st = { t: Math.random() * 10, hy: 0, hp: 0, wave: 0, nod: 0 };
  const v = new THREE.Vector3();
  return {
    group: root, bId, stair, height: hc,
    greet() { if (st.wave <= 0) st.wave = 2.6; st.nod = 0.9; },
    // viewer: world-space eye position (or null). Returns the horizontal distance to her (m).
    update(dt, viewer) {
      st.t += dt; const t = st.t;
      let ty = Math.sin(t * 0.21) * 0.16 + Math.sin(t * 0.57 + 1) * 0.05 - 0.06, tp = 0.03, d = Infinity;   // idle: calm glances around
      if (viewer) {
        root.worldToLocal(v.copy(viewer)); d = Math.hypot(v.x, v.z);
        if (d < 6 && v.z > -0.4) { ty = Math.atan2(v.x, v.z); tp = -Math.atan2(v.y - hc, Math.max(0.6, d)) * 0.5; }
      }
      const k = 1 - Math.exp(-dt * 3.2);
      st.hy += (clamp(ty, -1.0, 1.0) - st.hy) * k; st.hp += (tp - st.hp) * k;
      up.rotation.y = st.hy;
      let nod = 0;
      if (st.nod > 0) { st.nod = Math.max(0, st.nod - dt); nod = Math.sin(Math.PI * (1 - st.nod / 0.9)); }
      // breathing, a small tilt of the head, the nod (the head dips and foreshortens a little)
      const b = Math.sin(t * 1.65), tilt = Math.sin(t * 0.37) * 0.03 + ws * st.hy * 0.04, dip = clamp(st.hp, -0.2, 0.3) * 0.25 + nod * 0.085;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const ck = sstep(1.02, 1.36, y), hk = sstep(NECK - 0.04, NECK + 0.05, y);
        let nx = x * (1 + 0.007 * b * ck * (1 - hk)), ny = y + 0.004 * b * ck;
        if (hk > 0) { const dy = y - NECK; nx += dy * tilt * hk; ny -= (dy * dip + x * tilt * 0.6) * hk; }
        pos.setX(i, nx); pos.setY(i, ny);
      }
      pos.needsUpdate = true;
      upper.position.y = 1.385 + 0.004 * b;
      let e = 0;
      if (st.wave > 0) { st.wave = Math.max(0, st.wave - dt); const p = 1 - st.wave / 2.6; e = sstep(0, 0.22, p) * (1 - sstep(0.76, 1, p)); }
      // rest: the arm hangs, forearm toward her lap (behind the desk); wave: elbow out, forearm up, hand swinging
      upper.rotation.z = 0.06 + 0.5 * e;
      fore.rotation.z = -0.5 + e * (0.5 + 2.45 + 0.3 * Math.sin(t * 9.5));
      return d;
    },
  };
}
function roundTable(B, x, z, r = 0.42, h = 0.42) {
  const top = new THREE.CylinderGeometry(r, r, 0.04, 40); top.translate(x, h, z); B.add('nero', top);
  const base = new THREE.CylinderGeometry(0.05, r * 0.6, h - 0.02, 24); base.translate(x, (h - 0.02) / 2, z); B.add('bronze', base);
}
function chandelier(ctx, x, y, z, R = 0.9, span = 3) {
  if (FIN === 'grand') return crystalChandelier(ctx, x, y, z, R * 1.15);
  if (FIN === 'stone') return linearPendant(ctx, x, y, z, span);
  return ringChandelier(ctx, x, y, z, R);
}
// Grand Marble: tiered crystal chandelier — brass hoops hung with faceted prisms, candle bulbs, a cascading centre.
function crystalChandelier(ctx, x, y, z, R) {
  const b = new Batch(), drops = [], prisms = [], candles = [];
  const tiers = [[R, y + 0.12], [R * 0.78, y - 0.12], [R * 0.52, y - 0.34], [R * 0.26, y - 0.52]];
  tiers.forEach(([r, yy], i) => {
    const t = new THREE.TorusGeometry(r, 0.014, 8, 80); t.rotateX(Math.PI / 2); t.translate(x, yy, z); b.add('brass', t);
    const n = Math.round(r * 46);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + i * 0.21, cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r, L = 2 + (k % 3);
      for (let j = 0; j < L; j++) drops.push(mat4(cx, yy - 0.05 - j * 0.055, cz, a, 1, 1, 1));
      prisms.push(mat4(cx, yy - 0.06 - L * 0.055, cz, a, 1, 1, 1));
    }
    if (i < 2) { const nc = i ? 8 : 12; for (let k = 0; k < nc; k++) { const a = (k / nc) * TAU + i * 0.26; candles.push([x + Math.cos(a) * r, yy, z + Math.sin(a) * r]); } }
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; b.add('brass', boxGeo(-0.004, 0.004, yy, y + 0.6, -0.004, 0.004).translate(x + Math.cos(a) * r * 0.98, 0, z + Math.sin(a) * r * 0.98)); }
  });
  for (let j = 0; j < 14; j++) drops.push(mat4(x, y + 0.08 - j * 0.06, z, j * 0.7, 1.3, 1, 1.3));   // centre cascade
  for (const [cx, cy, cz] of candles) {
    b.add('moulding', new THREE.CylinderGeometry(0.014, 0.016, 0.1, 10).translate(cx, cy + 0.05, cz));
    b.add('bulb', new THREE.SphereGeometry(0.02, 10, 8).scale(1, 1.6, 1).translate(cx, cy + 0.125, cz));
  }
  b.add('brass', new THREE.CylinderGeometry(0.02, 0.02, ctx.H - y, 10).translate(x, (ctx.H + y) / 2, z));
  b.add('brass', new THREE.CylinderGeometry(0.16, 0.12, 0.06, 32).translate(x, ctx.H - 0.03, z));
  b.flush(ctx.root);
  instanced(ctx.root, ctx.geo('crystalDrop', () => new THREE.OctahedronGeometry(0.019, 0).scale(1, 1.5, 1)), 'crystal', drops);
  instanced(ctx.root, ctx.geo('crystalPrism', () => new THREE.ConeGeometry(0.022, 0.09, 6).rotateX(Math.PI)), 'crystal', prisms);
  instanced(ctx.root, ctx.geo('dropGlow', () => new THREE.SphereGeometry(0.008, 6, 4)), 'bulb', drops.filter((_, i) => i % 4 === 0));
}
// Stone & Oak: three suspended linear LED bars in dark bronze (light line underneath, soft uplight on top).
function linearPendant(ctx, x, y, z, span) {
  const b = new Batch(), L = Math.max(1.4, Math.min(2.6, span - 1.2));
  for (const dz of [-0.5, 0, 0.5]) {
    const yy = y + 0.1 - Math.abs(dz) * 0.0, zz = z + dz;
    b.add('bronze', rbox(x - L / 2, x + L / 2, yy, yy + 0.06, zz - 0.035, zz + 0.035, 0.012));
    b.box('ledCar', x - L / 2 + 0.03, x + L / 2 - 0.03, yy - 0.003, yy, zz - 0.022, zz + 0.022);
    b.box('ledDim', x - L / 2 + 0.05, x + L / 2 - 0.05, yy + 0.06, yy + 0.062, zz - 0.012, zz + 0.012);
    for (const s of [-1, 1]) b.box('bronzeDark', x + s * (L / 2 - 0.15) - 0.002, x + s * (L / 2 - 0.15) + 0.002, yy + 0.06, ctx.H, zz - 0.002, zz + 0.002);
  }
  for (const dz of [-0.5, 0, 0.5]) b.add('bronze', boxGeo(x - L / 2 + 0.1, x + L / 2 - 0.1, ctx.H - 0.015, ctx.H, z + dz - 0.03, z + dz + 0.03));
  b.flush(ctx.root);
}
function ringChandelier(ctx, x, y, z, R = 0.9) {   // three bronze rings with glowing glass drops (instanced)
  const b = new Batch();
  const mats = [];
  [[R, y], [R * 0.72, y - 0.22], [R * 0.44, y - 0.42]].forEach(([r, yy], i) => {
    const t = new THREE.TorusGeometry(r, 0.012, 8, 72); t.rotateX(Math.PI / 2); t.translate(x, yy, z); b.add('brass', t);
    const n = Math.round(r * 44);
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU + i * 0.3; mats.push(mat4(x + Math.cos(a) * r, yy - 0.08 - (k % 3) * 0.06, z + Math.sin(a) * r, 0, 0.45, 0.8, 0.45)); }
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; b.add('brass', boxGeo(-0.004, 0.004, yy, y + 0.6, -0.004, 0.004).translate(x + Math.cos(a) * r, 0, z + Math.sin(a) * r)); }
  });
  b.add('bronze', new THREE.CylinderGeometry(0.12, 0.12, 0.04, 32).translate(x, ctx.H - 0.02, z));
  b.flush(ctx.root);
  instanced(ctx.root, ctx.geo('drop', () => new THREE.SphereGeometry(0.03, 10, 8)), 'bulb', mats);
}

// ============================================================ floor geometry helpers
// the doors as walk.js sees them: true building-local positions
const trueDoors = units => units.map(u => { const [x, z] = unitToLocal(u, u.door.u, 0); return { unitId: u.id, x, z, yaw: unitYaw(u) }; });
// Place a door leaf + number plate + bell push for a flat door on a wall run.
// d = { unitId, apNo, a (coordinate along the run), U (unit.frame.U) }, run = { axis, c, side }, plateIdx = index of the
// label passed to setupPlates. The leaf stands 4.5 cm behind the wall line: at unitToLocal(u, u.door.u, 0) − side·0.045.
function placeDoor(ctx, d, run, plateIdx) {
  const alongX = run.axis === 'x';
  const dd = -0.045;   // leaf centre depth (recessed in the reveal)
  const [x, z] = alongX ? [d.a, run.c + run.side * dd] : [run.c + run.side * dd, d.a];
  const yaw = alongX ? (run.side > 0 ? 0 : Math.PI) : (run.side > 0 ? Math.PI / 2 : -Math.PI / 2);
  // handle on the side toward increasing u (hinge at u-side lower); plate on the handle side
  const Ux = d.U[0], Uz = d.U[1];
  // local +x of the leaf in building frame:
  const lx = Math.cos(yaw), lz = -Math.sin(yaw);
  const hs = Math.sign(lx * Ux + lz * Uz) || 1;
  const leaf = doorLeaf(d.unitId, x, z, alongX, yaw, hs);
  ctx.root.add(leaf); ctx.leaves.push(leaf);
  // brass plate beside the door (handle side), 1.5 m high
  const pa = d.a + hs * (alongX ? lx : lz) * (DOOR_W / 2 + 0.2);
  const [px, pz] = alongX ? [pa, run.c + run.side * (FACE + SKIN + 0.004)] : [run.c + run.side * (FACE + SKIN + 0.004), pa];
  const g = new THREE.PlaneGeometry(0.17, 0.085);
  if (ctx.plates && ctx.plateB) {   // (setupPlates was called)
    const [u0, v0, du, dv] = ctx.plates.uv(plateIdx); const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
    ctx.plateB.add(ctx.plateMat, g, mat4(px, 1.52, pz, yaw));
  }
  ctx.B.add('brass', boxGeo(-0.093, 0.093, -0.05, 0.05, -0.006, -0.0012), mat4(px, 1.52, pz, yaw));   // backing just behind the plate quad (no z-fight)
  // bell push under the number plate (instanced per floor, see buildBells)
  ctx.bells.push({ unitId: d.unitId, m: mat4(px, 1.35, pz, yaw) });
}
// Bell pushes of one floor: brass plate (the tap target), glowing ring and ivory button — three InstancedMeshes.
const BELL_IDLE = new THREE.Color(0.8, 0.3, 0.035), BELL_LIT = new THREE.Color(4.2, 2.0, 0.4);   // linear: soft amber / bright gold
function buildBells(ctx) {
  const list = ctx.bells; if (!list || !list.length) return null;
  const mats = list.map(b => b.m), ids = list.map(b => b.unitId);
  const mk = (geo, mat) => {
    const im = new THREE.InstancedMesh(geo, M(mat), mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox();
    im.name = 'vrc-doorbell'; ctx.root.add(im); return im;
  };
  const plate = mk(ctx.geo('bellPlate', () => rbox(-0.034, 0.034, -0.052, 0.052, 0, 0.007, 0.006)), 'brass');
  const ring = mk(ctx.geo('bellRing', () => new THREE.TorusGeometry(0.0212, 0.0042, 10, 44).translate(0, 0, 0.0082)), 'bellRing');
  const cap = mk(ctx.geo('bellCap', () => { const c = new THREE.CylinderGeometry(0.0122, 0.0136, 0.009, 28); c.rotateX(Math.PI / 2); c.translate(0, 0, 0.0115); return c; }), 'bellCap');
  mats.forEach((_, i) => ring.setColorAt(i, BELL_IDLE)); ring.instanceColor.needsUpdate = true;
  plate.userData.action = { type: 'doorbell', building: ctx.bId, floor: ctx.floor };
  plate.userData.bellUnits = ids;
  const push = new THREE.Matrix4().makeTranslation(0, 0, -0.0045), tmp = new THREE.Matrix4(), timers = new Map();
  const set = (i, on) => {
    cap.setMatrixAt(i, on ? tmp.copy(mats[i]).multiply(push) : mats[i]); cap.instanceMatrix.needsUpdate = true;
    ring.setColorAt(i, on ? BELL_LIT : BELL_IDLE); ring.instanceColor.needsUpdate = true;
  };
  return {
    mesh: plate, units: ids,
    /** press the button of `unitId` in (travel + lit ring) for `ms`; returns false when that door is not on this floor */
    press(unitId, ms = 900) {
      const i = ids.indexOf(unitId); if (i < 0 || !plate.parent) return false;
      set(i, true); clearTimeout(timers.get(i));
      timers.set(i, setTimeout(() => { timers.delete(i); if (plate.parent) set(i, false); }, ms));
      return true;
    },
    dispose() { for (const t of timers.values()) clearTimeout(t); timers.clear(); },
  };
}
// Video intercom totem outside the entrance. `yaw` turns the fascia: it faces the direction [sin yaw, cos yaw]
// (pass Math.atan2(n[0], n[1]) with n = the OUTWARD normal of the entrance; default π = facing −z as in the base site).
// Body, trims and lens are baked; the fascia is one individually placed quad carrying the tap action.
function intercomTotem(ctx, c, x, z, yaw = Math.PI) {
  const { B, C } = ctx, T = mat4(x, 0, z, yaw), stair = (c && c.stair) || 1;
  B.add('bronzeDark', boxGeo(-0.17, 0.17, 0, 0.022, -0.085, 0.085), T);                    // foot plate
  B.add('bronze', rbox(-0.125, 0.125, 0.022, 1.58, -0.05, 0.05, 0.012), T);               // brushed-bronze body (follows the finish)
  B.add('brass', boxGeo(-0.127, 0.127, 1.58, 1.592, -0.052, 0.052), T);                   // brass cap
  B.add('led', boxGeo(-0.1, 0.1, 1.5455, 1.5495, 0.05, 0.0515), T);                         // light line over the fascia
  for (const s of [-1, 1]) B.add('brass', boxGeo(s * 0.108 - 0.003, s * 0.108 + 0.003, 0.08, 0.9, 0.05, 0.0525), T);   // inlay lines
  B.add('brass', boxGeo(-0.102, 0.102, 0.955, 1.535, 0.05, 0.0535), T);                   // fascia bezel
  B.add('blackGlass', new THREE.SphereGeometry(0.017, 20, 12, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 1.4607, 0.0545), T);   // lens
  B.add('brass', new THREE.TorusGeometry(0.0185, 0.0028, 8, 32).translate(0, 1.4607, 0.0555), T);
  const sn = Math.sin(yaw), cs = Math.cos(yaw), hx = 0.14 * Math.abs(cs) + 0.07 * Math.abs(sn), hz = 0.14 * Math.abs(sn) + 0.07 * Math.abs(cs);
  C.box(x - hx, x + hx, 0, 1.6, z - hz, z + hz);
  const face = new THREE.Mesh(ctx.geo('icomFace', () => new THREE.PlaneGeometry(0.19, 0.5225)), M('icomFace'));
  face.position.set(x + sn * 0.0545, 1.245, z + cs * 0.0545); face.rotation.y = yaw; face.name = 'vrc-intercom';
  face.userData.action = { type: 'intercom', building: ctx.bId, stair };
  ctx.root.add(face);
  const rec = { stair, x, z, face, setOpen(on) { face.material = M(on ? 'icomFaceOpen' : 'icomFace'); } };
  (ctx.intercoms ||= []).push(rec);
  return rec;
}

function ceilingRect(ctx, r, alongX, H, trayW = 1.05) {
  const { B } = ctx; const t = trayW / 2, rise = 0.14;
  if (alongX) {
    const zc = (r.z0 + r.z1) / 2;
    B.box('plaster', r.x0, r.x1, H, H + 0.04, r.z0, zc - t); B.box('plaster', r.x0, r.x1, H, H + 0.04, zc + t, r.z1);
    const g = new THREE.PlaneGeometry(r.x1 - r.x0 - 0.2, trayW); g.rotateX(Math.PI / 2); g.translate((r.x0 + r.x1) / 2, H + rise, zc);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 20, uv.getY(i));
    B.add('tray', g);
    B.box('plaster', r.x0, r.x1, H, H + rise, zc - t - 0.03, zc - t); B.box('plaster', r.x0, r.x1, H, H + rise, zc + t, zc + t + 0.03);
    B.box('plaster', r.x0, r.x0 + 0.1, H, H + rise, zc - t, zc + t); B.box('plaster', r.x1 - 0.1, r.x1, H, H + rise, zc - t, zc + t);
  } else {
    const xc = (r.x0 + r.x1) / 2;
    B.box('plaster', r.x0, xc - t, H, H + 0.04, r.z0, r.z1); B.box('plaster', xc + t, r.x1, H, H + 0.04, r.z0, r.z1);
    const g = new THREE.PlaneGeometry(trayW, r.z1 - r.z0 - 0.2); g.rotateX(Math.PI / 2); g.rotateY(0); g.translate(xc, H + rise, (r.z0 + r.z1) / 2);
    // gradient across x: swap uv axes
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const a = uv.getX(i), b2 = uv.getY(i); uv.setXY(i, b2 * 20, a); }
    B.add('tray', g);
    B.box('plaster', xc - t - 0.03, xc - t, H, H + rise, r.z0, r.z1); B.box('plaster', xc + t, xc + t + 0.03, H, H + rise, r.z0, r.z1);
    B.box('plaster', xc - t, xc + t, H, H + rise, r.z0, r.z0 + 0.1); B.box('plaster', xc - t, xc + t, H, H + rise, r.z1 - 0.1, r.z1);
  }
}
function runner(ctx, x0, x1, z0, z1, alongX) {
  const L = alongX ? x1 - x0 : z1 - z0, W = alongX ? z1 - z0 : x1 - x0;
  const g = new THREE.PlaneGeometry(alongX ? L : W, alongX ? W : L); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0.006, (z0 + z1) / 2);
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const u = alongX ? (p.getX(i) - x0) / 2.6 : (p.getZ(i) - z0) / 2.6;
    const v = alongX ? (p.getZ(i) - z0) / W : (p.getX(i) - x0) / W;
    uv.setXY(i, u, v);
  }
  ctx.B.add('carpet', g);
  // bronze edge strips
  if (alongX) { ctx.B.box('bronzeDark', x0, x1, 0, 0.009, z0 - 0.02, z0); ctx.B.box('bronzeDark', x0, x1, 0, 0.009, z1, z1 + 0.02); }
  else { ctx.B.box('bronzeDark', x0 - 0.02, x0, 0, 0.009, z0, z1); ctx.B.box('bronzeDark', x1, x1 + 0.02, 0, 0.009, z0, z1); }
}
function downlights(ctx, pts) {
  const m = pts.map(([x, z]) => mat4(x, ctx.H - 0.001, z));
  instanced(ctx.root, ctx.geo('dl', () => new THREE.CylinderGeometry(0.035, 0.035, 0.004, 20)), 'bulb', m);
  instanced(ctx.root, ctx.geo('dlr', () => new THREE.TorusGeometry(0.045, 0.008, 6, 24).rotateX(Math.PI / 2)), 'bronze', m.map(q => q.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.004, 0))));
}
function floorPools(ctx, pts, s = 1.5, mat = 'pool') {
  const g = ctx.geo('poolG', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  instanced(ctx.root, g, mat, pts.map(([x, z, k]) => mat4(x, 0.012, z, 0, (k || 1) * s, 1, (k || 1) * s)));
}

function endWindow(ctx, axis, c, side, a0, a1, H = ctx.H) {   // tall window with bronze frame at a corridor end
  const { B, C } = ctx;
  const P = (a, d) => axis === 'x' ? [c + side * d, a] : [a, c + side * d];
  const bx = (mat, aa0, aa1, y0, y1, d0, d1) => { const [x0, z0] = P(aa0, d0), [x1, z1] = P(aa1, d1); B.box(mat, x0, x1, y0, y1, z0, z1); };
  const m = (a0 + a1) / 2, hw = Math.min(0.75, (a1 - a0) / 2 - 0.2);
  bx('plaster', a0, m - hw, 0, H, -0.3, FACE); bx('plaster', m + hw, a1, 0, H, -0.3, FACE);
  bx('plaster', m - hw, m + hw, 0, 0.45, -0.3, FACE); bx('plaster', m - hw, m + hw, H - 0.1, H, -0.3, FACE);
  bx('walnut', a0, m - hw, 0.1, H, FACE, FACE + SKIN); bx('walnut', m + hw, a1, 0.1, H, FACE, FACE + SKIN);
  bx('glass', m - hw, m + hw, 0.45, H - 0.1, -0.2, -0.19);
  bx('bronze', m - hw - 0.05, m - hw, 0.4, H - 0.05, -0.25, FACE + 0.03); bx('bronze', m + hw, m + hw + 0.05, 0.4, H - 0.05, -0.25, FACE + 0.03);
  bx('bronze', m - hw, m + hw, 0.4, 0.45, -0.25, FACE + 0.06); bx('bronze', m - hw, m + hw, H - 0.1, H - 0.05, -0.25, FACE + 0.03);
  bx('bronze', m - 0.015, m + 0.015, 0.45, H - 0.1, -0.21, -0.17);
  const [x0, z0] = P(a0, -0.3), [x1, z1] = P(a1, FACE + 0.03); C.box(x0, x1, 0, H, z0, z1);
  // upholstered bench under the window
  const [bxa, bza] = P(m - 0.7, 0.2), [bxb, bzb] = P(m + 0.7, 0.62);
  B.box('velvetSand', bxa, bxb, 0.28, 0.46, bza, bzb); B.box('bronze', bxa, bxb, 0.08, 0.28, bza + (axis === 'x' ? 0 : 0.03 * side), bzb - (axis === 'x' ? 0 : 0.03 * side));
  C.box(bxa, bxb, 0, 0.5, bza, bzb);
}
function signPlane(ctx, idx, x, y, z, yaw, w = 0.26, h = 0.26) {
  const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (idx + uv.getX(i)) / 8, uv.getY(i));
  ctx.signB.add('signs', g, mat4(x, y, z, yaw));
}
// A word plate from the Ukrainian signage atlas (key of WORDS: 'floor' | 'lift' | 'stairs' | 'parking' | 'concierge' |
// 'exit' | 'shelter' | 'mail'); h = plate height, width = 4 h. The plate faces [sin yaw, cos yaw].
function wordSign(ctx, key, x, y, z, yaw, h = 0.12) {
  const i = Math.max(0, WORD_KEYS.indexOf(key)), g = new THREE.PlaneGeometry(h * 4, h), uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, ((i % 2) + uv.getX(k)) / 2, 1 - (((i / 2) | 0) + 1 - uv.getY(k)) / 4);
  ctx.signB.add('words', g, mat4(x, y, z, yaw));
}
// "ПОВЕРХ N" (car park: "ПАРКІНГ −1") plate for this floor — its own small texture, one mesh. `text` overrides the wording.
function floorSign(ctx, x, y, z, yaw, h = 0.14, text) {
  const t = text || (ctx.floor === -1 ? `${WORDS.parking} ${floorLabel(-1)}` : `${WORDS.floor} ${floorLabel(ctx.floor)}`);
  const c = canvas(512, 128); drawWordPlate(c.getContext('2d'), 0, 0, 512, 128, t);
  const tex = texOf(c, { repeat: false }); ctx.ownTex.push(tex);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.15, 1.15, 1.15) }); (ctx.ownMat ||= []).push(mat);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(h * 4, h), mat); m.position.set(x, y, z); m.rotation.y = yaw; m.name = 'vrc-floor-sign';
  ctx.root.add(m); return m;
}

// ---- wall-run helpers (same convention as data.js hallEdgesOf): the yaw of something hung on a run facing the hall,
// the point at coordinate `a` along the run `d` metres toward the hall, and the hall edge a point lies on.
const runYaw = r => (r.axis === 'x' ? (r.side > 0 ? 0 : Math.PI) : (r.side > 0 ? Math.PI / 2 : -Math.PI / 2));
const runPoint = (r, a, d = 0) => (r.axis === 'x' ? [a, r.c + r.side * d] : [r.c + r.side * d, a]);
function edgeAt(edges, p, n = null, tol = 0.04) {   // n: optional normal pointing INTO the hall → { edge, a } | null
  for (const e of edges) {
    const a = e.axis === 'x' ? p[0] : p[1], c = e.axis === 'x' ? p[1] : p[0];
    if (Math.abs(c - e.c) > tol || a < e.a0 - 0.01 || a > e.a1 + 0.01) continue;
    if (n) { const s = e.axis === 'x' ? n[1] : n[0]; if (Math.sign(s) !== e.side) continue; }
    return { edge: e, a };
  }
  return null;
}
// Closed service door (stairs, technical rooms) in a 'service' opening of a wall run: leaf + pull + pictogram above it
// + (optional) a word plate on the leaf. The opening itself is passed to wallRun by the caller.
function serviceDoor(ctx, run, a, { w = 0.95, h = 2.2, sign = 0, word = 'stairs' } = {}) {
  const yaw = runYaw(run), [x, z] = runPoint(run, a, -0.045);
  const leaf = new THREE.Mesh(ctx.geo(`svcDoor:${w}:${h}`, () => { const g = new THREE.BoxGeometry(w - 0.01, h - 0.01, 0.05); worldUV(g, 1); return g; }), M('walnutDoor'));
  leaf.position.set(x, (h - 0.01) / 2, z); leaf.rotation.y = yaw; leaf.userData.solid = true; leaf.name = 'vrc-service-door';
  ctx.root.add(leaf);
  const T = mat4(x, 0, z, yaw);
  ctx.B.add('brass', boxGeo(w / 2 - 0.13, w / 2 - 0.1, 0.9, 1.25, 0.025, 0.06), T);     // pull
  if (sign != null && h + 0.34 < (ctx.H || 9)) { const [sx, sz] = runPoint(run, a, FACE + SKIN + 0.01); signPlane(ctx, sign, sx, h + 0.19, sz, yaw, 0.2, 0.2); }
  if (word) { const [wx, wz] = runPoint(run, a, -0.045 + 0.027); wordSign(ctx, word, wx, 1.62, wz, yaw, 0.085); }
  return leaf;
}
// Automatic sliding entrance (two glass leaves in brass frames) on the line through (x, z) with OUTWARD normal n.
// w = clear opening width (each leaf w / 2), h = leaf height. The leaves are children of a pivot whose local x runs
// along the door line, so a leaf slides along its own x: position.x = userData.baseX + userData.dir · open · travel.
// Returns (and records in ctx.autoDoors) { x, z, n, leaves, open: 0, travel, stair: 1, blocker, w, h }.
function slidingEntrance(ctx, o) {
  const n = o.n || [0, 1], w = Math.max(0.7, o.w ?? 1.9), h = o.h ?? 2.5, DW = w / 2, yaw = Math.atan2(n[0], n[1]);
  const pivot = new THREE.Group(); pivot.name = 'vrc-entrance'; pivot.position.set(o.x, 0, o.z); pivot.rotation.y = yaw; ctx.root.add(pivot);
  if (o.frame !== false) {   // posts, header and the threshold mat (baked)
    const T = mat4(o.x, 0, o.z, yaw);
    for (const s of [-1, 1]) ctx.B.add('bronze', boxGeo(s * DW - 0.04 + s * 0.04, s * DW + 0.04 + s * 0.04, 0, h + 0.11, -0.03, 0.16), T);   // outside the leaves' track
    ctx.B.add('bronze', boxGeo(-DW - 0.08, DW + 0.08, h, h + 0.11, -0.03, 0.16), T);
    ctx.B.add('nero', boxGeo(-DW, DW, 0, 0.004, -0.6, 0.6), T);
  }
  const key = `${DW.toFixed(3)}:${h}`;
  const leafGeo = ctx.geo('slideLeaf:' + key, () => clean(boxGeo(-DW / 2, DW / 2, 0.02, h - 0.02, -0.008, 0.008)));
  const frameGeo = ctx.geo('slideFrame:' + key, () => mergeGeometries([
    clean(boxGeo(-DW / 2, DW / 2, 0.02, 0.08, -0.02, 0.02)), clean(boxGeo(-DW / 2, DW / 2, h - 0.08, h - 0.02, -0.02, 0.02)),
    clean(boxGeo(-DW / 2, -DW / 2 + 0.05, 0.02, h - 0.02, -0.02, 0.02)), clean(boxGeo(DW / 2 - 0.05, DW / 2, 0.02, h - 0.02, -0.02, 0.02)),
    clean(boxGeo(-0.014, 0.014, 0.6, 1.9, 0.02, 0.05)), clean(boxGeo(-0.014, 0.014, 0.6, 1.9, -0.05, -0.02)),
  ], false));
  const leaves = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.name = 'lobby-slide-door';
    const pane = new THREE.Mesh(leafGeo, M('glass')); pane.renderOrder = 2; g.add(pane);
    g.add(new THREE.Mesh(frameGeo, M('brass')));
    g.position.set(s * DW / 2, 0, -0.06); g.userData.baseX = g.position.x; g.userData.dir = s;
    pivot.add(g); leaves.push(g);
  }
  // closed leaves block the way (walk.js clears userData.solid while they stand open)
  const blocker = new THREE.Mesh(ctx.geo('slideBlock:' + key, () => new THREE.BoxGeometry(w, h, 0.1)), M('hidden'));
  blocker.position.set(0, h / 2, -0.06); blocker.userData.solid = true; blocker.name = 'lobby-door-block'; pivot.add(blocker);
  const rec = { x: o.x, z: o.z, n: [n[0], n[1]], leaves, open: 0, travel: DW - 0.06, stair: 1, blocker, w, h };
  (ctx.autoDoors ||= []).push(rec);
  return rec;
}
// Bronze mailbox wall hung on a wall surface at (x, z), facing [sin yaw, cos yaw]; w × 1.2 m, centre 1.2 m high.
function mailboxWall(ctx, x, z, yaw, w = 1.9) {
  const T = mat4(x, 0, z, yaw), sn = Math.abs(Math.sin(yaw)), cs = Math.abs(Math.cos(yaw));
  ctx.B.add('bronzeDark', boxGeo(-w / 2 - 0.05, w / 2 + 0.05, 0.55, 1.85, 0, 0.06), T);
  ctx.B.add('mailbox', new THREE.PlaneGeometry(w, 1.2), mat4(x + Math.sin(yaw) * 0.062, 1.2, z + Math.cos(yaw) * 0.062, yaw));
  const hx = (w / 2 + 0.05) * cs + 0.12 * sn, hz = (w / 2 + 0.05) * sn + 0.12 * cs;
  ctx.C.box(x - hx, x + hx, 0, 2, z - hz, z + hz);
}
// Concierge desk with the seated concierge: centre of the desk FRONT at (x, z), the front faces [sin yaw, cos yaw];
// footprint 2.5 m along the front × 1.5 m behind it (needs a lobby of about 3 × 4 m). Calacatta front with a backlit
// onyx inset carrying the brand mark, walnut returns, nero ledge, a "КОНСЬЄРЖ" plate. Records her in ctx.concierges.
function conciergeDesk(ctx, x, z, yaw = 0) {
  const { B, C } = ctx, T = mat4(x, 0, z, yaw - Math.PI / 2);   // desk-local: +x = front, z along the desk
  const add = (mat, g) => B.add(mat, g, T), bx = (mat, x0, x1, y0, y1, z0, z1) => add(mat, boxGeo(Math.min(x0, x1), Math.max(x0, x1), y0, y1, Math.min(z0, z1), Math.max(z0, z1)));
  const z0 = -1.2, z1 = 1.2, TOP = 1.0, WT = 0.9;
  add('marble', rbox(-0.07, 0, 0.08, TOP, z0, z1, 0.012));                        // front slab
  add('walnut', rbox(-0.62, -0.05, 0.08, TOP, z0 - 0.05, z0, 0.01));              // returns
  add('walnut', rbox(-0.62, -0.05, 0.08, TOP, z1, z1 + 0.05, 0.01));
  add('walnut', rbox(-0.62, -0.5, 0.08, WT - 0.02, z0, z1, 0.01));                // modesty panel (her knees stay free)
  add('nero', rbox(-0.36, 0.07, TOP, TOP + 0.045, z0 - 0.06, z1 + 0.06, 0.015));  // ledge
  add('walnut', rbox(-0.84, -0.3, WT, WT + 0.03, z0 + 0.02, z1 - 0.02, 0.01));    // work top
  bx('bronze', -0.58, -0.04, 0, 0.08, z0 + 0.02, z1 - 0.02);                      // recessed plinth
  bx('led', -0.035, -0.03, 0.075, 0.082, z0 + 0.04, z1 - 0.04);                   // plinth glow on the floor
  bx('led', -0.33, 0.05, TOP - 0.006, TOP - 0.002, z0 - 0.04, z1 + 0.04);         // under-ledge glow line
  // backlit inset: bronze reveal, onyx field, glowing mark, a soft halo line top + bottom
  const iz = 0.92, iy0 = 0.26, iy1 = 0.8;
  bx('bronze', 0, 0.012, iy0 - 0.03, iy1 + 0.03, -iz - 0.03, iz + 0.03);
  bx('onyx', 0.012, 0.018, iy0, iy1, -iz, iz);
  add('wordmarkLit', new THREE.PlaneGeometry(1.7, 0.425).rotateY(Math.PI / 2).translate(0.0195, (iy0 + iy1) / 2, 0));
  for (const y of [iy0 + 0.012, iy1 - 0.016]) bx('ledSoft', 0.0185, 0.019, y, y + 0.004, -iz + 0.06, iz - 0.06);
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  wordSign(ctx, 'concierge', x + sn * 0.004, 0.915, z + cs * 0.004, yaw, 0.075);
  // her things: slim screen, brass task lamp, a leather folio
  const sm = new THREE.Matrix4().multiplyMatrices(T, mat4(-0.62, 0, z1 - 0.62, -Math.PI / 2 - 0.35));
  B.add('blackGlass', boxGeo(-0.27, 0.27, WT + 0.13, WT + 0.46, -0.012, 0.012), sm);
  B.add('bronzeDark', boxGeo(-0.27, 0.27, WT + 0.13, WT + 0.46, -0.022, -0.012), sm);
  B.add('brass', boxGeo(-0.02, 0.02, WT + 0.03, WT + 0.2, -0.05, -0.03), sm);
  B.add('brass', boxGeo(-0.09, 0.09, WT + 0.03, WT + 0.04, -0.12, 0.03), sm);
  add('brass', new THREE.CylinderGeometry(0.055, 0.07, 0.02, 24).translate(-0.5, WT + 0.04, z0 + 0.28));
  add('brass', new THREE.CylinderGeometry(0.007, 0.007, 0.34, 8).translate(-0.5, WT + 0.21, z0 + 0.28));
  add('velvetSand', new THREE.CylinderGeometry(0.065, 0.11, 0.13, 24, 1, true).translate(-0.5, WT + 0.41, z0 + 0.28));
  add('bulb', new THREE.CircleGeometry(0.055, 16).rotateX(Math.PI / 2).translate(-0.5, WT + 0.355, z0 + 0.28));
  add('leather', rbox(-0.5, -0.36, WT + 0.03, WT + 0.045, -0.52, -0.3, 0.004));
  // the concierge on a counter-height swivel chair, facing the visitors
  const P2 = (lx, lz) => { const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(T); return [v.x, v.z]; };
  const [cx, cz] = P2(-1.04, 0);
  receptionChair(B, cx, cz, yaw);
  const box = (lx0, lx1, lz0, lz1, hgt) => { const [ax, az] = P2(lx0, lz0), [bx2, bz2] = P2(lx1, lz1); C.box(Math.min(ax, bx2), Math.max(ax, bx2), 0, hgt, Math.min(az, bz2), Math.max(az, bz2)); };
  box(-0.84, 0.08, z0 - 0.06, z1 + 0.06, TOP + 0.05); box(-1.4, -0.68, -0.34, 0.34, 1.0);
  const cg = makeConcierge(cx, cz, yaw, ctx.bId, 1, 1);
  ctx.root.add(cg.group); (ctx.concierges ||= []).push(cg);
  return cg;
}

// ============================================================ context
// While a builder runs, everything it creates is tracked so that a throw can be cleaned up (see runBuilder).
const BUILD = { lifts: null, ctxs: null };
function makeCtx(bId, floor, H) {
  const group = new THREE.Group(); group.name = `vrc-commons-${bId}-${floor}`;
  const root = new THREE.Group(); root.position.y = floorY(bId, floor); group.add(root);
  const geos = new Map();
  const ctx = {
    bId, floor, H, group, root, mz: null, B: new Batch(), C: new Colliders(), signB: new Batch(),
    leaves: [], lifts: [], doors: [], ownTex: [], ownMat: [], bells: [], autoDoors: [], intercoms: [], concierges: [],
    geo(key, make) { if (!geos.has(key)) geos.set(key, make()); return geos.get(key); },
    _geos: geos,
  };
  if (BUILD.ctxs) BUILD.ctxs.push(ctx);
  return ctx;
}
function finish(ctx, spawn) {
  ctx.B.flush(ctx.root); ctx.C.flush(ctx.root); ctx.signB.flush(ctx.root);
  if (ctx.plateB) ctx.plateB.flush(ctx.root);
  const bells = buildBells(ctx);
  for (const L of ctx.lifts) ctx.group.add(L.group);
  ctx.group.updateMatrixWorld(true);
  // true door positions: a builder that did not fill ctx.doors gets them from the data (every unit of the floor)
  if ((!Array.isArray(ctx.doors) || !ctx.doors.length) && ctx.floor >= 1) { try { ctx.doors = trueDoors(unitsOn(ctx.bId, ctx.floor)); } catch { ctx.doors = []; } }
  const { group, lifts, doors } = ctx;
  let disposed = false;
  return {
    group, lifts, spawn, doors, bId: ctx.bId, floor: ctx.floor, finish: FIN, styleId: FIN, autoDoors: ctx.autoDoors || [],
    // doorbells of this floor ({mesh, units, press(unitId)}), the corridor leaf of a unit, the entrance intercoms
    // ([{stair, x, z (building-local), face, setOpen(on)}], ground floor only)
    bells, leafOf: unitId => ctx.leaves.find(l => l.userData.unitId === unitId) || null, intercoms: ctx.intercoms || [], concierges: ctx.concierges || [], parkedCars: ctx.parkedCars || [], carInstances: ctx.carInstances || null,
    dispose() {
      if (disposed) return; disposed = true;
      if (bells) bells.dispose();
      if (RIG.group && RIG.group.parent === ctx.root) { ctx.root.remove(RIG.group); }
      for (const L of lifts) L.dispose();
      for (const L of ctx.decor || []) L.dispose();
      if (ctx.carInstances && ctx.carInstances.dispose) ctx.carInstances.dispose();   // shared car geometry stays cached in cars.js
      const keep = new Set(Object.values(_leafGeo));
      group.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.geometry && !keep.has(o.geometry)) o.geometry.dispose(); });
      for (const g of ctx._geos.values()) g.dispose();
      for (const t of ctx.ownTex) t.dispose();
      for (const m of ctx.ownMat || []) m.dispose();
      if (ctx.plateMat) ctx.plateMat.dispose();
      if (group.parent) group.parent.remove(group);
    },
  };
}
function setupPlates(ctx, labels) {
  ctx.plates = plateAtlas(labels); ctx.ownTex.push(ctx.plates.tex);
  ctx.plateMat = new THREE.MeshStandardMaterial({ map: ctx.plates.tex, metalness: 0.9, roughness: 0.3 });
  ctx.plateB = new Batch();
}

// ============================================================ fallback builders (plain, no decor)
// Used when commons-floor.js / commons-parking.js is missing or throws: the hall rects as a stone floor with a plain
// ceiling, walls from hallEdgesOf with the flat doors, the lifts, the stair door and (floor 1) the sliding entrance.
function fallbackFloor(bId, floor) {
  const plate = plateOf(bId, floor); if (!plate) throw new Error(`commons: no plate for ${bId} floor ${floor}`);
  const ground = isGround(floor), H = Math.max(2.4, Math.min(ground ? 3.0 : 2.6, floorH(bId, floor) - 0.4));
  const ctx = makeCtx(bId, floor, H), { B, C, root } = ctx;
  if (ground) root.position.y += 0.01;   // stay clear of the site ground plane (y = 0) that runs under the footprints
  const units = unitsOn(bId, floor), core = coresOf(bId, floor)[0], edges = hallEdgesOf(bId, floor), hall = plate.hall || [];
  ctx.doors = trueDoors(units);
  setupPlates(ctx, units.map(u => String(u.apNo)));
  for (const r of hall) {
    B.box(ground ? 'marbleFloor' : 'stone', r.x0, r.x1, -0.3, 0, r.z0, r.z1); C.rect(r.x0, r.x1, r.z0, r.z1, 0);
    B.box('plaster', r.x0, r.x1, H, H + 0.04, r.z0, r.z1);
    const w = r.x1 - r.x0, d = r.z1 - r.z0, xc = (r.x0 + r.x1) / 2, zc = (r.z0 + r.z1) / 2;   // one light line along the rect
    if (Math.min(w, d) > 0.9 && Math.max(w, d) > 1.6) { if (w >= d) B.box('ledSoft', r.x0 + 0.5, r.x1 - 0.5, H - 0.006, H, zc - 0.03, zc + 0.03); else B.box('ledSoft', xc - 0.03, xc + 0.03, H - 0.006, H, r.z0 + 0.5, r.z1 - 0.5); }
  }
  // openings per hall edge
  const ops = new Map(edges.map(e => [e, []])), zones = new Map(edges.map(e => [e, []]));
  const free = (e, a, hw) => a - hw >= e.a0 - 0.02 && a + hw <= e.a1 + 0.02 && !ops.get(e).some(o => Math.abs(o.c - a) < (o.kind === 'lift' ? POCKET : o.w / 2) + hw + 0.1);
  const liftAt = core.liftDoors.map((d, i) => edgeAt(edges, d, core.liftNormals[i]) || edgeAt(edges, d));
  for (const h of liftAt) if (h) { ops.get(h.edge).push({ c: h.a, w: LIFT_W, h: LIFT_H, kind: 'lift' }); zones.get(h.edge).push({ a0: h.a - 1.7, a1: h.a + 1.7, mat: 'marble' }); }
  const unitEdge = units.map(u => edges.find(e => e.axis === u.run.axis && Math.abs(e.c - u.run.c) < 0.04 && e.side === u.run.side && u.doorA > e.a0 - 0.01 && u.doorA < e.a1 + 0.01) || null);
  units.forEach((u, i) => { if (unitEdge[i]) ops.get(unitEdge[i]).push({ c: u.doorA, w: DOOR_W, h: DOOR_H, kind: 'door' }); });
  let ent = null;
  if (ground && plate.entrance) {
    const n = plate.entrance.n, h = edgeAt(edges, plate.entrance.p, [-n[0], -n[1]]) || edgeAt(edges, plate.entrance.p);
    const w = h ? Math.min(1.9, h.edge.a1 - h.edge.a0 - 0.1) : 0;
    if (h && w >= 0.7) {
      const a = clamp(h.a, h.edge.a0 + w / 2 + 0.05, h.edge.a1 - w / 2 - 0.05);
      ops.get(h.edge).push({ c: a, w, h: 2.5, kind: 'pass', noTrim: true });
      ent = { edge: h.edge, a, w, n };
    }
  }
  const stairDoors = [];
  for (const s of core.stairs || []) {
    if (!s.door || stairDoors.some(q => Math.hypot(q.p[0] - s.door[0], q.p[1] - s.door[1]) < 0.6)) continue;
    const h = edgeAt(edges, s.door);
    if (h && free(h.edge, h.a, 0.475)) { ops.get(h.edge).push({ c: h.a, w: 0.95, h: 2.2, kind: 'service' }); stairDoors.push({ ...h, p: s.door }); }
  }
  for (const e of edges) wallRun(ctx, { axis: e.axis, c: e.c, side: e.side, a0: e.a0, a1: e.a1, openings: ops.get(e), zones: zones.get(e) });
  // flat doors (closed leaves + number plates + bell pushes), the stair door
  units.forEach((u, i) => placeDoor(ctx, { unitId: u.id, apNo: u.apNo, a: u.doorA, U: u.frame.U }, u.run, i));
  for (const s of stairDoors) serviceDoor(ctx, s.edge, s.a);
  // lifts, hall-call plates and the floor sign
  core.liftDoors.forEach((_, i) => ctx.lifts.push(new Lift(bId, 0, i, floor)));
  const liftEdges = [...new Set(liftAt.filter(Boolean).map(h => h.edge))];
  liftEdges.forEach((e, k) => {
    const as = liftAt.filter(h => h && h.edge === e).map(h => h.a).sort((p, q) => p - q);
    let a = as.length > 1 && as[1] - as[0] >= 1.6 ? (as[0] + as[1]) / 2 : as[0] + 0.9;
    if (as.length < 2 && a > e.a1 - 0.15) a = as[0] - 0.9;
    const yaw = runYaw(e), [px, pz] = runPoint(e, a, FACE + SKIN + 0.006);
    callPlate(ctx, px, 1.12, pz, yaw, { type: 'liftCall', building: bId, stair: 1 });
    if (k === 0) { const [sx, sz] = runPoint(e, a, FACE + SKIN + 0.004); floorSign(ctx, sx, 1.62, sz, yaw, 0.1); }
  });
  // ground floor: sliding entrance + video intercom outside it
  if (ent) {
    const [x, z] = runPoint(ent.edge, ent.a, 0), n = ent.n, t = [-n[1], n[0]], dx = ent.w / 2 + 0.42;
    slidingEntrance(ctx, { x, z, n, w: ent.w, h: 2.5 });
    intercomTotem(ctx, core, x + n[0] * 0.11 + t[0] * dx, z + n[1] * 0.11 + t[1] * dx, Math.atan2(n[0], n[1]));
  }
  // lights: up to four points over the largest hall rects
  const area = r => (r.x1 - r.x0) * (r.z1 - r.z0);
  const big = [...hall].sort((p, q) => area(q) - area(p)).slice(0, 4);
  claimRig(root, big.map(r => [(r.x0 + r.x1) / 2, H - 0.35, (r.z0 + r.z1) / 2, 6.5, 0xffd4a0, 12]), 0.22);
  // spawn: just inside the entrance (floor 1), else in front of lift 0, else the middle of the largest rect
  const inHall = (x, z) => hall.some(r => x > r.x0 + 0.2 && x < r.x1 - 0.2 && z > r.z0 + 0.2 && z < r.z1 - 0.2);
  let spawn = null;
  if (ent) { const [x, z] = runPoint(ent.edge, ent.a, 0), n = ent.n; for (const d of [1.3, 0.9, 0.6]) if (!spawn && inHall(x - n[0] * d, z - n[1] * d)) spawn = { x: x - n[0] * d, z: z - n[1] * d, yaw: Math.atan2(n[0], n[1]) }; }
  if (!spawn && core.liftDoors[0]) { const d0 = core.liftDoors[0], n = core.liftNormals[0]; for (const d of [1.6, 1.2, 0.8]) if (!spawn && inHall(d0[0] + n[0] * d, d0[1] + n[1] * d)) spawn = { x: d0[0] + n[0] * d, z: d0[1] + n[1] * d, yaw: Math.atan2(-n[0], -n[1]) }; }
  if (!spawn) { const r = big[0] || { x0: 0, x1: 0, z0: 0, z1: 0 }; spawn = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, yaw: 0 }; }
  return finish(ctx, spawn);
}
// Car park fallback: one slab under the whole parking outline (world coordinates in a sub-group), perimeter walls and
// the lifts of all four towers behind a marble wall stub each. No bays, ramps or cars.
function fallbackParking(bId) {
  const H = 3.1, ctx = makeCtx(bId, -1, H), { root } = ctx, me = BUILDINGS[bId];
  const W = new THREE.Group(); W.name = 'vrc-parking-world'; W.rotation.y = -(me.rotY || 0);
  { const [ox, oz] = worldToLocal(bId, 0, 0); W.position.set(ox, 0, oz); } root.add(W);
  const wb = new Batch(), wc = new Colliders(16), { x0, x1, z0, z1 } = PARKING;
  wb.box('epoxy', x0, x1, -0.3, 0, z0, z1); wc.rect(x0, x1, z0, z1, 0);
  wb.box('ceilingP', x0, x1, H, H + 0.3, z0, z1);
  for (const [a, b, c, d] of [[x0 - 0.3, x0, z0, z1], [x1, x1 + 0.3, z0, z1], [x0, x1, z0 - 0.3, z0], [x0, x1, z1, z1 + 0.3]]) { wb.box('concreteLight', a, b, 0, H, c, d); wc.box(a, b, 0, H, c, d); }
  wb.flush(W); wc.flush(W);
  let spawn = null;
  for (const id of B_IDS) {
    const core = coresOf(id, 1)[0]; if (!core) continue;
    const G = new THREE.Group(); G.name = 'vrc-parking-core-' + id;
    if (id !== bId) { const [wx, wz] = localToWorld(id, 0, 0), [lx, lz] = worldToLocal(bId, wx, wz); G.position.set(lx, 0, lz); G.rotation.y = (BUILDINGS[id].rotY || 0) - (me.rotY || 0); }
    root.add(G);
    const sub = { ...ctx, root: G, B: new Batch(), C: new Colliders(), signB: new Batch() };
    core.liftDoors.forEach((d, i) => {
      const n = core.liftNormals[i], run = n[0] ? { axis: 'z', c: d[0], side: Math.sign(n[0]) } : { axis: 'x', c: d[1], side: Math.sign(n[1]) }, a = n[0] ? d[1] : d[0];
      wallRun(sub, { ...run, a0: a - 1.3, a1: a + 1.3, openings: [{ c: a, w: LIFT_W, h: LIFT_H, kind: 'lift' }], finish: 'marble', H: 2.7, noAO: true });
      for (const [u0, u1, w0, w1] of [[-SHAFT_X - 0.1, -SHAFT_X, -SHAFT_Z, -WALL_T], [SHAFT_X, SHAFT_X + 0.1, -SHAFT_Z, -WALL_T], [-SHAFT_X, SHAFT_X, -SHAFT_Z, -SHAFT_Z + 0.1]]) {   // shaft enclosure
        const [xa, za] = runPoint(run, a + u0, w0), [xb, zb] = runPoint(run, a + u1, w1); sub.C.box(xa, xb, 0, H, za, zb);
      }
      const yaw = runYaw(run), [px, pz] = runPoint(run, a + 0.9, FACE + SKIN + 0.006);
      callPlate(sub, px, 1.12, pz, yaw, { type: 'liftCall', building: id, stair: 1 });
      if (i === 0) { const [sx, sz] = runPoint(run, a + 0.9, FACE + SKIN + 0.004); wordSign(sub, 'parking', sx, 1.62, sz, yaw, 0.09); }
      const L = new Lift(id, 0, i, -1);
      if (id !== bId) { L.group.position.copy(G.position); L.group.rotation.y = G.rotation.y; }
      ctx.lifts.push(L);
      if (id === bId && !spawn) spawn = { x: d[0] + n[0] * 2.2, z: d[1] + n[1] * 2.2, yaw: Math.atan2(n[0], n[1]) };   // facing the lift
    });
    sub.B.flush(G); sub.C.flush(G); sub.signB.flush(G);
  }
  if (!spawn) { const [x, z] = worldToLocal(bId, (x0 + x1) / 2, (z0 + z1) / 2); spawn = { x, z, yaw: 0 }; }
  claimRig(root, [[spawn.x, 2.5, spawn.z, 6, 0xffd9ae, 12]], 0.5);
  return finish(ctx, spawn);
}

// ============================================================ KIT for commons-floor.js / commons-parking.js (CONTRACT §4.2)
export const COMMONS_KIT = {
  THREE, M, Batch, Colliders, Lift,
  makeCtx, finish, setupPlates, wallRun, placeDoor, callPlate, signPlane,
  ceilingRect, runner, downlights, floorPools,
  framedArt, consoleTable, plant, armchair, intercomTotem, makeConcierge, slidingEntrance,
  claimRig, instanced, mat4, boxGeo,
  DOOR_W, DOOR_H, LIFT_W, LIFT_H, POCKET, WALL_T, FACE, SKIN, CAR_DEPTH,
  // ---- extras beyond the contract list (see notes/T13.md)
  wordSign, floorSign, serviceDoor, mailboxWall, conciergeDesk, receptionChair, roundTable, chandelier, coveWall, opGaps, endWindow,
  rbox, clean, worldUV, aoQuad, mergeGeometries, trueDoors, runYaw, runPoint, edgeAt, liftStop, canvas, texOf,
  WORDS, SANS, SERIF, SHAFT_X, SHAFT_Z,
  get finishId() { return FIN; },   // the building finish being built: 'classic' | 'grand' | 'stone'
  cars: null,                       // { createCarInstances, carSpec, pickCar, carRng } from cars.js, or null when cars.js failed to load
};
const KIT = COMMONS_KIT;

// ============================================================ sub-modules (dynamic, optional)
const SUB = { floor: null, parking: null };
const STATUS = { floor: 'pending', parking: 'pending', cars: 'pending', errors: {} };
/** What is loaded: { floor, parking, cars: 'ok' | 'missing' | 'disabled' | 'injected' | 'pending', errors: { key: message } }. */
export function commonsStatus() { return { floor: STATUS.floor, parking: STATUS.parking, cars: STATUS.cars, errors: { ...STATUS.errors } }; }
/** Tests / tools: replace (function) or switch off (null) a builder at run time. `undefined` leaves it as it is. */
export function setCommonsBuilders({ floor, parking } = {}) {
  if (floor !== undefined) { SUB.floor = typeof floor === 'function' ? floor : null; STATUS.floor = SUB.floor ? 'injected' : 'disabled'; }
  if (parking !== undefined) { SUB.parking = typeof parking === 'function' ? parking : null; STATUS.parking = SUB.parking ? 'injected' : 'disabled'; }
}
async function loadSub(key, url, fnName) {
  // a test page may set globalThis.__VRC_COMMONS_SUBS__ = { floor: <url> | false, parking: <url> | false, cars: false } before importing this module
  const ov = (globalThis.__VRC_COMMONS_SUBS__ || {})[key];
  if (ov === false) { STATUS[key] = 'disabled'; return null; }
  try {
    const m = await import(typeof ov === 'string' ? ov : url);
    if (fnName && typeof m[fnName] !== 'function') throw new Error(`${url} has no export ${fnName}`);
    STATUS[key] = 'ok'; return m;
  } catch (e) {
    STATUS[key] = 'missing'; STATUS.errors[key] = String((e && e.message) || e);
    console.warn(`[commons] ${url} not available — ${key === 'cars' ? 'no parked cars' : 'using the fallback builder'}:`, STATUS.errors[key]);
    return null;
  }
}
/** Resolves (never rejects) when the optional sub-modules have been tried. Awaited at the end of this module. */
export const commonsReady = Promise.all([
  loadSub('floor', './commons-floor.js', 'buildTowerFloor').then(m => { if (m) SUB.floor = m.buildTowerFloor; }),
  loadSub('parking', './commons-parking.js', 'buildTowerParking').then(m => { if (m) SUB.parking = m.buildTowerParking; }),
  loadSub('cars', './cars.js', 'createCarInstances').then(m => { if (m) KIT.cars = { createCarInstances: m.createCarInstances, carSpec: m.carSpec, pickCar: m.pickCar, carRng: m.carRng }; }),
]).then(() => commonsStatus());

// Run a builder; when it throws (or returns nothing usable) dispose whatever it created and re-throw.
function runBuilder(fn) {
  BUILD.lifts = []; BUILD.ctxs = [];
  try {
    const res = fn();
    if (!res || typeof res.then === 'function' || !res.group || !res.group.isObject3D || !Array.isArray(res.lifts)) throw new Error('builder returned no CommonsResult');
    return res;
  } catch (e) {
    for (const L of BUILD.lifts) { try { L.dispose(); } catch { /* best effort */ } }
    for (const c of BUILD.ctxs) {
      try {
        if (RIG.group && RIG.group.parent) { let p = RIG.group.parent; while (p && p !== c.group) p = p.parent; if (p) RIG.group.parent.remove(RIG.group); }
        for (const b of [c.B, c.signB, c.plateB]) if (b && b.parts) { for (const l of b.parts.values()) l.forEach(g => g.dispose()); b.parts.clear(); }
        const keep = new Set(Object.values(_leafGeo));
        c.group.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.geometry && !keep.has(o.geometry)) o.geometry.dispose(); });
        for (const g of c._geos.values()) g.dispose();
        for (const t of c.ownTex) t.dispose();
        for (const m of c.ownMat || []) m.dispose();
        if (c.plateMat) c.plateMat.dispose();
        if (c.carInstances && c.carInstances.dispose) c.carInstances.dispose();
      } catch { /* best effort */ }
    }
    throw e;
  } finally { BUILD.lifts = BUILD.ctxs = null; }
}

// ============================================================ public API
/**
 * The common parts of one floor of a tower: floor ≥ 1 → lift hall + corridor (floor 1 with the entrance), −1 → the car park.
 * styleId: a building finish id from COMMON_FINISHES ('classic' | 'grand' | 'stone'); anything else → 'classic'.
 * Unknown building → the first one; the floor is clamped to liftFloors(bId) (there is no floor 0).
 * Synchronous. Delegates to commons-floor.js / commons-parking.js; when that module is missing or throws, the plain
 * fallback floor is built instead (result.fallback === true). Throws only when the fallback fails too (walk.js then
 * uses its own _fallbackCommons).
 */
export function buildFloorCommons(bId, floor, styleId = 'classic') {
  if (!BUILDINGS[bId]) bId = B_IDS[0];
  floor = liftStop(bId, floor);
  const finishId = FINISH_IDS.includes(styleId) ? styleId : 'classic';
  let res = null, fallback = false;
  FIN = finishId;
  try {
    const fn = floor === -1 ? SUB.parking : SUB.floor;
    if (fn) {
      try { res = runBuilder(() => (floor === -1 ? fn(KIT, bId) : fn(KIT, bId, floor))); }
      catch (e) { console.warn(`[commons] ${floor === -1 ? 'buildTowerParking' : 'buildTowerFloor'}(${bId}${floor === -1 ? '' : ', ' + floor}) failed — fallback floor`, e); res = null; }
    }
    if (!res) { fallback = true; res = runBuilder(() => (floor === -1 ? fallbackParking(bId) : fallbackFloor(bId, floor))); }
  } finally { FIN = 'classic'; }
  res.bId = bId; res.floor = floor; res.styleId = finishId; res.finish = finishId; res.fallback = fallback;
  for (const k of ['lifts', 'doors', 'autoDoors', 'intercoms', 'concierges', 'parkedCars']) if (!Array.isArray(res[k])) res[k] = [];
  if (res.bells === undefined) res.bells = null;
  if (res.carInstances === undefined) res.carInstances = null;
  if (typeof res.leafOf !== 'function') res.leafOf = () => null;
  if (typeof res.dispose !== 'function') res.dispose = () => {};
  return res;
}
export { CAR_DEPTH };

await commonsReady;   // importers get the module with the sub-modules already tried (buildFloorCommons stays synchronous)
