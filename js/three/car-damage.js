// ЖК VILNYI (Ужгород) — crash damage of the cars of the driving mode.
// Two halves:
//  1. the MODEL (no three.js needed — runs in Node): a damage record per car, fed with impacts
//       const d = newDamage();  const res = addImpact(d, spec, { point: [lx, ly, lz], dir: [dx, dz], speed, scrape });
//       damageMods(d, spec) → what the physics feels ({ power, top, pull, grip, drag, cut } → CarController.mod)
//     Car frame as everywhere: +z forward, +x the driver's side (left), origin on the ground between the axles.
//     Levels: 0 none · 1 scratched · 2 light (dents) · 3 medium · 4 heavy · 5 wrecked (the engine is dead).
//     A car is wrecked only by one hard crash (≈ 95 km/h or more against something solid) or by heavy damage piling up.
//  2. the LOOK: applyDamage(car, d) bends the full-detail model of car-models.js createCar() — crumpled panels around every
//     contact (vertex displacement with a crumple noise, normals rebuilt there), a hanging bumper, dead lamps, cracked or
//     knocked-out glass, scratches as small decals, bent wheels; createCarFx() gives smoke, steam and sparks.
//     The far / mid instanced tiers stay undamaged (a car shows its damage from ≈ 25 m).
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const DAMAGE_LEVELS = ['none', 'scratched', 'light', 'medium', 'heavy', 'wrecked'];
export const WRECK_KMH = 95;

// ------------------------------------------------------------------ 1. the model
export function newDamage() {
  return { zones: { front: 0, rear: 0, left: 0, right: 0 }, wheels: [0, 0, 0, 0], engine: 0, level: 0, dead: false, hits: 0, worst: 0, rev: 0,
    dents: [], scratches: [], glass: { front: 0, rear: 0, left: 0, right: 0 }, lamps: { fl: 0, fr: 0, rl: 0, rr: 0 }, bumper: { front: 0, rear: 0 } };
}
/** how much one impact adds to its zone: 0 … 1.2 (30 km/h ≈ 0.15, 70 ≈ 0.6, 95 ≈ 0.97) */
export const impactSeverity = kmh => clamp(Math.pow(Math.max(0, kmh) / 100, 1.6) * 1.05, 0, 1.2);
export function zoneOf(spec, lx, lz) {
  const zc = (spec.zF + spec.zR) / 2, hl = (spec.zF - spec.zR) / 2, hw = spec.W / 2;
  return Math.abs(lz - zc) / hl >= Math.abs(lx) / hw ? (lz >= zc ? 'front' : 'rear') : (lx >= 0 ? 'left' : 'right');
}
const engineEnd = spec => (spec.kind === 'super' ? 'rear' : 'front');
/** One impact. point = contact in the car frame, dir = unit (x, z) in the car frame along which the obstacle pushes INTO the car
 *  (default: towards the middle of the car), speed = m/s lost against the obstacle, scrape = a glancing contact.
 *  → { zone, kmh, add, level, levelBefore, died, glass, lamp, scratchOnly } */
export function addImpact(d, spec, { point, dir = null, speed = 0, scrape = false, mass = 1 } = {}) {
  const hw = spec.W / 2, zc = (spec.zF + spec.zR) / 2;
  let [lx, ly, lz] = point || [0, 0.5, spec.zF];
  lx = clamp(lx, -hw, hw); lz = clamp(lz, spec.zR, spec.zF); ly = clamp(ly == null ? 0.5 : ly, 0.25, Math.max(0.6, spec.H * 0.62));
  const zone = zoneOf(spec, lx, lz), kmh = Math.abs(speed) * 3.6 * Math.sqrt(clamp(mass, 0.2, 1.5)), before = d.level;
  let add = impactSeverity(kmh) * (scrape ? 0.35 : 1);
  if (kmh < 18) add = Math.min(add, Math.max(0, 0.055 - d.zones[zone]));   // light bumps only scratch, however many
  let dx, dz; if (dir && Math.hypot(dir[0], dir[1]) > 1e-3) { const l = Math.hypot(dir[0], dir[1]); dx = dir[0] / l; dz = dir[1] / l; } else { const l = Math.hypot(lx, lz - zc) || 1; dx = -lx / l; dz = -(lz - zc) / l; }
  // the push always goes into the body (never pulls a panel outwards)
  if (zone === 'front' && dz > -0.2) { dz = -1; dx *= 0.3; } if (zone === 'rear' && dz < 0.2) { dz = 1; dx *= 0.3; } if (zone === 'left' && dx > -0.2) { dx = -1; dz *= 0.3; } if (zone === 'right' && dx < 0.2) { dx = 1; dz *= 0.3; }
  { const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
  d.hits++; d.rev++; d.worst = Math.max(d.worst, kmh);
  const res = { zone, kmh, add, level: before, levelBefore: before, died: false, glass: false, lamp: false, scratchOnly: false };
  if (kmh < 2) { d.rev--; d.hits--; return res; }
  // scratches at every contact
  d.scratches.push({ p: [lx, ly, lz], n: Math.round(clamp(3 + kmh * 0.22, 3, 16) * (scrape ? 1.6 : 1)), len: clamp(0.05 + kmh * 0.0016, 0.05, 0.16), r: clamp(0.14 + kmh * 0.004, 0.14, 0.6), seed: (d.hits * 7919) >>> 0 });
  if (d.scratches.length > 28) d.scratches.shift();
  if (kmh < 8) { res.scratchOnly = true; add = Math.min(add, 0.012); }
  else {
    const dent = { p: [lx, ly, lz], d: [dx, 0, dz], r: clamp(0.26 + add * 0.85, 0.26, 1.05), depth: clamp(0.012 + add * 0.34, 0.012, 0.4), seed: (d.hits * 104729) >>> 0 };
    d.dents.push(dent);
    if (d.dents.length > 18) { let k = 0; for (let i = 1; i < d.dents.length - 1; i++) if (d.dents[i].depth < d.dents[k].depth) k = i; d.dents.splice(k, 1); }
  }
  d.zones[zone] = clamp(d.zones[zone] + add);
  const end = zone === 'front' || zone === 'rear';
  if (end && kmh >= 35 && !scrape) {
    const k = zone === 'front' ? 'f' : 'r';
    if (lx > 0.18 || kmh >= 55) { d.lamps[k + 'l'] = 1; res.lamp = true; } if (lx < -0.18 || kmh >= 55) { d.lamps[k + 'r'] = 1; res.lamp = true; }
  }
  if (!scrape && kmh >= 48) { const g = kmh >= 78 ? 2 : 1; if (g > d.glass[zone]) { d.glass[zone] = g; res.glass = true; } if (kmh >= 110) for (const z of ['front', 'rear', 'left', 'right']) if (!d.glass[z]) d.glass[z] = 1; }
  if (end && d.zones[zone] >= 0.5 && !d.bumper[zone]) d.bumper[zone] = lx >= 0 ? 1 : -1;
  // a wheel near the contact is knocked out of line by a real blow
  if (add >= 0.28) { const wx = spec.W / 2 - 0.15, wz = spec.wb / 2; [[wx, wz], [-wx, wz], [wx, -wz], [-wx, -wz]].forEach(([x, z], i) => { if (Math.hypot(lx - x, lz - z) < 1.15) d.wheels[i] = clamp(d.wheels[i] + add * 0.8); }); }
  const ee = engineEnd(spec);
  d.engine = clamp(Math.max(d.engine, d.zones[ee], (d.zones.left + d.zones.right) * 0.3 + d.zones[ee === 'front' ? 'rear' : 'front'] * 0.15));
  const sum = d.zones.front + d.zones.rear + d.zones.left + d.zones.right;
  if (!d.dead && ((kmh >= WRECK_KMH && !scrape) || d.engine >= 0.95 || sum >= 2.4)) { d.dead = true; d.engine = 1; res.died = true; }
  d.level = damageLevel(d); res.level = d.level;
  return res;
}
export function damageLevel(d) {
  if (!d) return 0; if (d.dead) return 5;
  const m = Math.max(d.zones.front, d.zones.rear, d.zones.left, d.zones.right);
  return m >= 0.7 ? 4 : m >= 0.3 ? 3 : m >= 0.06 ? 2 : d.scratches.length ? 1 : 0;
}
/** what the damage does to the driving (CarController.mod) */
export function damageMods(d, spec) {
  if (!d) return { power: 1, top: 1, pull: 0, grip: 1, drag: 0, cut: 0 };
  const e = d.engine, w = d.wheels, wm = Math.max(...w); void spec;
  return { power: 1 - 0.55 * Math.pow(e, 1.5), top: Math.max(0.4, 1 - 0.5 * e), cut: e > 0.55 ? clamp((e - 0.55) * 1.4, 0, 0.6) : 0,
    pull: (w[0] - w[1]) * 0.07 + (w[2] - w[3]) * 0.02, grip: 1 - 0.3 * wm, drag: 0.5 * (w[0] + w[1] + w[2] + w[3]) + (d.bumper.front || d.bumper.rear ? 0.4 : 0) };
}

// ------------------------------------------------------------------ 2. the look
function hash3(x, y, z, s) { let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(s, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1; }
function vnoise(x, y, z, s) {   // value noise −1 … 1
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), u), L(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), u), v), L(L(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), u), L(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), u), v), w);
}
const srand = seed => { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

// the geometry of a model is shared by every car of its kind: a damaged car gets its own copy (once)
function own(mesh) {
  if (!mesh || !mesh.geometry) return null; const u = mesh.userData;
  if (!u.dmgBase) { const src = mesh.geometry; u.dmgShared = src; mesh.geometry = src.clone(); u.dmgBase = new Float32Array(src.attributes.position.array); u.dmgNrm = src.attributes.normal ? new Float32Array(src.attributes.normal.array) : null; u.dmgCol = src.attributes.color ? new Float32Array(src.attributes.color.array) : null; }
  return mesh.geometry;
}
function restore(mesh) { const u = mesh && mesh.userData; if (!u || !u.dmgBase) return; mesh.geometry.dispose(); mesh.geometry = u.dmgShared; delete u.dmgBase; delete u.dmgNrm; delete u.dmgCol; delete u.dmgShared; }

// move the vertices of one mesh: dents, then the hanging bumper. off = where the mesh's origin sits in the car frame.
function deform(mesh, spec, d, off, panelOf, maxDepth) {
  const g = own(mesh); if (!g) return;
  const base = mesh.userData.dmgBase, P = g.attributes.position.array, n = base.length / 3, W = new Float32Array(n), D = new Float32Array(n * 3);
  for (const dent of d.dents) {
    const [px, py, pz] = dent.p, [ddx, , ddz] = dent.d, r2 = dent.r * dent.r, s = dent.seed | 0, dep = Math.min(dent.depth, maxDepth);
    for (let i = 0; i < n; i++) {
      const x = base[i * 3] + off[0], y = base[i * 3 + 1] + off[1], z = base[i * 3 + 2] + off[2];
      const ax = x - px, az = z - pz; if (ax > dent.r || ax < -dent.r || az > dent.r || az < -dent.r) continue;
      const ay = (y - py) * 0.75, q = ax * ax + ay * ay + az * az; if (q >= r2) continue;
      let w = 1 - q / r2; w *= w;
      const n1 = vnoise(x * 9, y * 9, z * 9, s), n2 = vnoise(x * 17 + 5, y * 17, z * 17, s + 1), n3 = vnoise(x * 17, y * 17 + 9, z * 17, s + 2);
      const k = dep * w * (1 + 0.45 * n1), c = dep * 0.3 * w;
      D[i * 3] += ddx * k + n2 * c * Math.abs(ddz); D[i * 3 + 1] += n3 * c * 0.7 - dep * 0.08 * w; D[i * 3 + 2] += ddz * k + n2 * c * Math.abs(ddx);
      if (w > W[i]) W[i] = w;
    }
  }
  // a bumper torn from its mounts on one side hangs down there
  for (const end of ['front', 'rear']) {
    const side = d.bumper[end]; if (!side) continue;
    const pid = end === 'front' ? 0 : 10, drop = 0.1 + 0.08 * d.zones[end], pivot = -side * (spec.W / 2 - 0.12);
    for (let i = 0; i < n; i++) {
      const x = base[i * 3] + off[0], y = base[i * 3 + 1] + off[1], z = base[i * 3 + 2] + off[2];
      if (end === 'front' ? z < spec.zF - 0.5 : z > spec.zR + 0.5) continue;
      if (panelOf(x, y, z) !== pid) continue;
      const t = clamp(Math.abs(x - pivot) / (spec.W - 0.24));
      D[i * 3 + 1] -= drop * t; D[i * 3 + 2] += (end === 'front' ? 1 : -1) * 0.05 * t; if (W[i] < 0.34) W[i] = 0.34;
    }
  }
  for (let i = 0; i < n; i++) {
    let x = D[i * 3], y = D[i * 3 + 1], z = D[i * 3 + 2]; const l = Math.hypot(x, y, z);
    if (l > maxDepth * 1.25) { const k = maxDepth * 1.25 / l; x *= k; y *= k; z *= k; }
    P[i * 3] = base[i * 3] + x; P[i * 3 + 1] = Math.max(base[i * 3 + 1] + y, Math.min(base[i * 3 + 1], 0.12 - off[1])); P[i * 3 + 2] = base[i * 3 + 2] + z;
  }
  g.attributes.position.needsUpdate = true;
  // normals: rebuilt where the skin moved (averaged over the vertices that share a place, so smooth panels stay smooth)
  const nb = mesh.userData.dmgNrm;
  if (nb) {
    const N = g.attributes.normal.array, acc = new Map(), key = i => Math.round(base[i * 3] * 500) + ',' + Math.round(base[i * 3 + 1] * 500) + ',' + Math.round(base[i * 3 + 2] * 500);
    N.set(nb);
    for (let t = 0; t + 2 < n; t += 3) {
      if (!(W[t] > 0 || W[t + 1] > 0 || W[t + 2] > 0)) continue;
      const a = t * 3, ux = P[a + 3] - P[a], uy = P[a + 4] - P[a + 1], uz = P[a + 5] - P[a + 2], vx = P[a + 6] - P[a], vy = P[a + 7] - P[a + 1], vz = P[a + 8] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (let j = 0; j < 3; j++) { if (!(W[t + j] > 0)) continue; const k = key(t + j); let e = acc.get(k); if (!e) acc.set(k, (e = [0, 0, 0])); e[0] += fx; e[1] += fy; e[2] += fz; }
    }
    for (let i = 0; i < n; i++) {
      if (!(W[i] > 0)) continue; const e = acc.get(key(i)); if (!e) continue; const l = Math.hypot(e[0], e[1], e[2]); if (l < 1e-12) continue;
      const k = Math.min(1, W[i] * 4), x = nb[i * 3] * (1 - k) + e[0] / l * k, y = nb[i * 3 + 1] * (1 - k) + e[1] / l * k, z = nb[i * 3 + 2] * (1 - k) + e[2] / l * k, m = Math.hypot(x, y, z) || 1;
      N[i * 3] = x / m; N[i * 3 + 1] = y / m; N[i * 3 + 2] = z / m;
    }
    g.attributes.normal.needsUpdate = true;
  }
  g.computeBoundingSphere(); g.computeBoundingBox();
  return W;
}
// which pane a glass vertex belongs to
function paneOf(spec, x, z) { const G = spec.gh; return z > G.zT1 + 0.02 ? 'front' : z < G.zT2 - 0.02 ? 'rear' : x >= 0 ? 'left' : 'right'; }

let CRACK_TEX = null;
function crackTexture() {
  if (CRACK_TEX) return CRACK_TEX;
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d'), r = srand(77);
  g.clearRect(0, 0, 512, 512);
  for (const [cx, cy, R] of [[200, 250, 330], [395, 150, 190]]) {
    const hz = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5); hz.addColorStop(0, 'rgba(235,240,245,.55)'); hz.addColorStop(0.25, 'rgba(235,240,245,.2)'); hz.addColorStop(1, 'rgba(235,240,245,0)'); g.fillStyle = hz; g.fillRect(0, 0, 512, 512);
    const rays = []; const nr = 15 + Math.floor(r() * 6);
    for (let i = 0; i < nr; i++) { let a = (i + r() * 0.7) / nr * Math.PI * 2, x = cx, y = cy; const pts = [[x, y]], L = R * (0.45 + r() * 0.75); for (let s = 0; s < L; s += 16) { a += (r() - 0.5) * 0.3; x += Math.cos(a) * 16; y += Math.sin(a) * 16; pts.push([x, y]); } rays.push(pts); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pts of rays) { g.strokeStyle = 'rgba(245,248,250,.9)'; g.lineWidth = 1.5; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.strokeStyle = 'rgba(20,24,28,.35)'; g.lineWidth = 0.8; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0] + 1.3, p[1] + 1.3) : g.moveTo(p[0] + 1.3, p[1] + 1.3))); g.stroke(); }
    for (let ring = 1; ring <= 6; ring++) { g.strokeStyle = `rgba(245,248,250,${0.8 - ring * 0.08})`; g.lineWidth = 1.1; for (let i = 0; i < rays.length; i++) { if (r() < 0.25) continue; const a = rays[i], b = rays[(i + 1) % rays.length], k = Math.min(a.length, b.length) - 1, j = Math.min(k, Math.round(ring * 1.4 + r())); if (j < 1) continue; g.beginPath(); g.moveTo(a[j][0], a[j][1]); g.lineTo(b[j][0], b[j][1]); g.stroke(); } }
  }
  CRACK_TEX = new THREE.CanvasTexture(cv); CRACK_TEX.colorSpace = THREE.SRGBColorSpace; CRACK_TEX.wrapS = CRACK_TEX.wrapT = THREE.MirroredRepeatWrapping; CRACK_TEX.anisotropy = 4;
  return CRACK_TEX;
}
let CRACK_MAT = null, SCR_MAT = null;
const crackMat = () => CRACK_MAT || (CRACK_MAT = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: '#c9ced3' }));
const scratchMat = () => SCR_MAT || (SCR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide }));

/** Bend the detailed model `car` (car-models.js createCar) to the damage record `d` (null / level 0 → as new). Idempotent. */
export function applyDamage(car, d, panelOf = null) {
  if (!car || !car.group) return;
  const S = car.spec, G = car.group, byName = n => G.getObjectByName(n), door = car.door;
  const meshes = [['paint', G, [0, 0, 0], 0.42], ['trim', G, [0, 0, 0], 0.42], ['lights', G, [0, 0, 0], 0.42], ['glass', G, [0, 0, 0], 0.3], ['plates', G, [0, 0, 0], 0.42]];
  const hinge = car.hinge || [0, 0, 0];
  if (door) for (const n of ['door-paint', 'door-trim', 'door-glass']) meshes.push([n, door, [hinge[0], 0, hinge[2]], 0.16]);
  for (const k of ['cracks', 'scratches']) { const m = G.userData['dmg_' + k]; if (m) { m.parent && m.parent.remove(m); m.geometry.dispose(); G.userData['dmg_' + k] = null; } }
  car.wheelBend = null;
  if (!d || (!d.dents.length && !d.scratches.length)) { for (const [n, par] of meshes) restore(par.getObjectByName(n)); car.damageRev = d ? d.rev : 0; if (car.setWheels) car.setWheels(); return; }
  panelOf = panelOf || (car.panels ? car.panels().of : () => -1);
  for (const [n, par, off, maxD] of meshes) { const m = par.getObjectByName(n); if (m) deform(m, S, d, off, panelOf, maxD); }
  // lamps: a broken one is dark
  const lm = byName('lights');
  if (lm && lm.userData.dmgCol) {
    const g = lm.geometry, C = g.attributes.color.array, b = lm.userData.dmgBase, c0 = lm.userData.dmgCol, zm = (S.zF + S.zR) / 2; C.set(c0);
    for (let i = 0; i < C.length / 3; i++) { const x = b[i * 3], z = b[i * 3 + 2], k = (z > zm ? 'f' : 'r') + (x >= 0 ? 'l' : 'r'); if (d.lamps[k] && Math.abs(x) > 0.12) { C[i * 3] = c0[i * 3] * 0.03; C[i * 3 + 1] = c0[i * 3 + 1] * 0.03; C[i * 3 + 2] = c0[i * 3 + 2] * 0.03; } }
    g.attributes.color.needsUpdate = true;
  }
  // glass: cracked panes get the crack picture laid over them, knocked-out panes disappear
  const cp = [], cu = [];
  for (const [n, par] of [['glass', G], ['door-glass', door]]) {
    const m = par && par.getObjectByName(n); if (!m || !m.userData.dmgBase) continue;
    const P = m.geometry.attributes.position.array, b = m.userData.dmgBase, ox = n === 'glass' ? 0 : hinge[0], oz = n === 'glass' ? 0 : hinge[2];
    for (let t = 0; t + 8 < P.length; t += 9) {
      const cx = (b[t] + b[t + 3] + b[t + 6]) / 3 + ox, cz = (b[t + 2] + b[t + 5] + b[t + 8]) / 3 + oz, pane = paneOf(S, cx, cz), lv = d.glass[pane];
      if (lv >= 2) { for (let j = 3; j < 9; j++) P[t + j] = P[t + j % 3]; continue; }
      if (lv === 1) for (let j = 0; j < 3; j++) {
        const x = P[t + j * 3] + ox, y = P[t + j * 3 + 1], z = P[t + j * 3 + 2] + oz; cp.push(x, y, z);
        if (pane === 'front' || pane === 'rear') cu.push(x / S.W * 0.9 + 0.5, (y - 0.8) / Math.max(0.3, S.H - 0.8) * 0.9); else cu.push((z - S.zR) / S.L * 1.6, (y - 0.8) / Math.max(0.3, S.H - 0.8) * 0.9);
      }
    }
    m.geometry.attributes.position.needsUpdate = true;
  }
  if (cp.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2)); const m = new THREE.Mesh(g, crackMat()); m.name = 'dmg-cracks'; m.renderOrder = 4; m.matrixAutoUpdate = false; G.add(m); G.userData.dmg_cracks = m; }
  // scratches: short strokes of bare metal / primer on the skin around each contact
  const pm = byName('paint');
  if (pm && d.scratches.length) {
    const P = pm.geometry.attributes.position.array, N = pm.geometry.attributes.normal.array, n = P.length / 3, sp = [], sc = [], sn = [];
    for (const s of d.scratches) {
      const r = srand(s.seed + 11), near = [];
      for (let i = 0; i < n; i += 3) { const ax = P[i * 3] - s.p[0], ay = (P[i * 3 + 1] - s.p[1]) * 0.8, az = P[i * 3 + 2] - s.p[2]; if (ax * ax + ay * ay + az * az < s.r * s.r) near.push(i); }
      if (!near.length) continue;
      for (let k = 0; k < s.n; k++) {
        const i = near[Math.floor(r() * near.length)], f = [r(), r()]; if (f[0] + f[1] > 1) { f[0] = 1 - f[0]; f[1] = 1 - f[1]; }
        const A = i * 3, x = P[A] + (P[A + 3] - P[A]) * f[0] + (P[A + 6] - P[A]) * f[1], y = P[A + 1] + (P[A + 4] - P[A + 1]) * f[0] + (P[A + 7] - P[A + 1]) * f[1], z = P[A + 2] + (P[A + 5] - P[A + 2]) * f[0] + (P[A + 8] - P[A + 2]) * f[1];
        const nx = N[A], ny = N[A + 1], nz = N[A + 2];
        // along the surface, roughly horizontal (a scrape runs along the car), a little off line each
        let tx = -nz, ty = 0, tz = nx; if (Math.hypot(tx, tz) < 0.3) { tx = 0; tz = 1; } const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl; ty = (r() - 0.5) * 0.5;
        const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx, hl = s.len * (0.4 + r() * 0.9) / 2, hwd = 0.0016 + r() * 0.003, o = 0.0025;
        const c = r() < 0.6 ? [0.5, 0.52, 0.54] : r() < 0.5 ? [0.09, 0.09, 0.1] : [0.74, 0.75, 0.76];
        const q = (a, b2) => [x + nx * o + tx * a * hl + bx * b2 * hwd, y + ny * o + ty * a * hl + by * b2 * hwd, z + nz * o + tz * a * hl + bz * b2 * hwd];
        for (const [a, b2] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { sp.push(...q(a, b2)); sc.push(...c); sn.push(nx, ny, nz); }
      }
    }
    if (sp.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3)); const m = new THREE.Mesh(g, scratchMat()); m.name = 'dmg-scratches'; m.matrixAutoUpdate = false; G.add(m); G.userData.dmg_scratches = m; }
  }
  // wheels knocked out of line: toe and camber per wheel (car-models.js setWheels reads car.wheelBend)
  if (d.wheels.some(w => w > 0.05)) car.wheelBend = d.wheels.map((w, i) => ({ toe: w * 0.22 * (i % 2 ? -1 : 1), camber: w * 0.2, drop: w * 0.03 }));
  if (car.setWheels) car.setWheels();
  car.damageRev = d.rev;
}
/** give back the shared geometry of a car that is thrown away or repaired */
export function clearDamage(car) { applyDamage(car, null); }

// ------------------------------------------------------------------ smoke, steam, sparks
// One pool for the whole scene: smoke / steam puffs (soft dark or pale sprites) and sparks (bright, additive).
// fx.smoke(x, y, z, kind 'smoke' | 'steam', k) · fx.sparks(x, y, z, n, [vx, vy, vz]) · fx.update(dt, light 0…1) · fx.dispose()
export function createCarFx({ max = 220, maxSparks = 160 } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-car-fx';
  const mk = (n, additive) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3).fill(-9999), col = new Float32Array(n * 4), size = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('acol', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('asize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute vec4 acol; attribute float asize; varying vec4 vC; uniform float uScale; void main(){ vC = acol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(420.0, asize * uScale / max(0.3, -mv.z)); }',
      fragmentShader: additive ? 'varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vC.rgb * a * vC.a * 2.0, a * vC.a); }' : 'varying vec4 vC; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; float a = smoothstep(1.0, 0.25, d) * vC.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb, a); }' });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 5; group.add(p);
    return { n, pos, col, size, g, m, p, life: new Float32Array(n), age: new Float32Array(n).fill(1e9), vel: new Float32Array(n * 3), kind: new Uint8Array(n), next: 0, live: 0 };
  };
  const SM = mk(max, false), SP = mk(maxSparks, true);
  SM.p.name = 'car-smoke'; SP.p.name = 'car-sparks';
  const put = (Sx, x, y, z, vx, vy, vz, life, size, kind) => { const i = Sx.next; Sx.next = (i + 1) % Sx.n; Sx.pos[i * 3] = x; Sx.pos[i * 3 + 1] = y; Sx.pos[i * 3 + 2] = z; Sx.vel[i * 3] = vx; Sx.vel[i * 3 + 1] = vy; Sx.vel[i * 3 + 2] = vz; Sx.life[i] = life; Sx.age[i] = 0; Sx.size[i] = size; Sx.kind[i] = kind; };
  let light = 1;
  return {
    group,
    smoke(x, y, z, kind = 'smoke', k = 1) { const r = Math.random; put(SM, x + (r() - 0.5) * 0.3, y, z + (r() - 0.5) * 0.3, (r() - 0.5) * 0.5, 0.7 + r() * 0.8 * k, (r() - 0.5) * 0.5, 1.6 + r() * 1.6, 0.35 + r() * 0.3, kind === 'steam' ? 1 : 0); },
    sparks(x, y, z, n = 8, v = [0, 0, 0]) { const r = Math.random; for (let i = 0; i < n; i++) put(SP, x, y, z, v[0] * 0.5 + (r() - 0.5) * 5, 1 + r() * 3.5, v[2] * 0.5 + (r() - 0.5) * 5, 0.25 + r() * 0.45, 0.05 + r() * 0.05, 2); },
    update(dt, lightK = 1, pixelScale = 600) {
      light = lightK;
      for (const Sx of [SM, SP]) {
        let live = 0;
        Sx.m.uniforms.uScale.value = pixelScale;
        for (let i = 0; i < Sx.n; i++) {
          if (Sx.age[i] > Sx.life[i]) { if (Sx.pos[i * 3 + 1] > -9000) { Sx.pos[i * 3 + 1] = -9999; Sx.col[i * 4 + 3] = 0; } continue; }
          live++; Sx.age[i] += dt; const t = Sx.age[i] / Sx.life[i], k = Sx.kind[i];
          if (k === 2) { Sx.vel[i * 3 + 1] -= 9.8 * dt; if (Sx.pos[i * 3 + 1] < -4.15 && Sx.vel[i * 3 + 1] < 0) Sx.vel[i * 3 + 1] *= -0.35; }
          else { Sx.vel[i * 3] *= 1 - dt * 0.6; Sx.vel[i * 3 + 2] *= 1 - dt * 0.6; Sx.size[i] += dt * (k === 1 ? 0.75 : 0.55); }
          Sx.pos[i * 3] += Sx.vel[i * 3] * dt; Sx.pos[i * 3 + 1] += Sx.vel[i * 3 + 1] * dt; Sx.pos[i * 3 + 2] += Sx.vel[i * 3 + 2] * dt;
          const c = Sx.col, a = i * 4;
          if (k === 2) { c[a] = 1; c[a + 1] = 0.62 - 0.3 * t; c[a + 2] = 0.2; c[a + 3] = 1 - t * t; }
          else { const b = k === 1 ? 0.82 * (0.35 + 0.65 * light) : 0.1 + 0.08 * light; c[a] = c[a + 1] = c[a + 2] = b; c[a + 3] = (k === 1 ? 0.3 : 0.55) * Math.min(1, t * 6) * (1 - t); }
        }
        Sx.g.attributes.position.needsUpdate = Sx.g.attributes.acol.needsUpdate = Sx.g.attributes.asize.needsUpdate = true; Sx.live = live;
      }
      return SM.live + SP.live;
    },
    get live() { return SM.live + SP.live; },
    dispose() { for (const Sx of [SM, SP]) { Sx.g.dispose(); Sx.m.dispose(); } group.parent && group.parent.remove(group); },
  };
}
