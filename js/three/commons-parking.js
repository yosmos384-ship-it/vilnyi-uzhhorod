// ЖК VILNYI (Uzhhorod) — the shared underground car park (level −4.200) under all four towers. Task V6-parking.
//
//   export function buildTowerParking(KIT, bId) → CommonsResult      (CONTRACT §4.2, same shape as before)
//
// The level is built EXACTLY from the working drawing src/parking-plan.pdf (422-ТХ sheets 5–6, «Схема розміщення автомобілів
// в паркінгу», М 1:200) through the generated data (js/data-parking.js → PARKING / RAMPS of data.js; see notes/V6-parking.md):
// outline, every wall polygon and wall lining, 217 columns / pylons, 85 door openings (the ones on the way lift hall ↔ car
// park stand open, the rest are shut and labelled with the room number of the drawing), 179 car places + 4 motorcycle
// places with their painted lines and printed numbers, wheel stops, 76 charging stations, lane arrows, pedestrian zones,
// two ramps (0 / 10 % / 18 % / 10 %, two lanes, kerbs, pedestrian strip), the gate between the two fire compartments,
// drainage trays, the lift halls of the four towers (lift cars = KIT.Lift at the towers' own lift doors).
// NOT on the drawing and therefore generic (stated in the notes): clear height 3.0 m, beams, pipes / ducts / cable trays,
// lighting, wall colours, signs.
//
// Everything is modelled in WORLD x/z in a sub-group offset by −origin of the tower the walker is in, so the same level
// appears whichever tower's view is built. Local y = 0 is the car-park floor (root sits at floorY(bId, −1)).
// No cars are placed here: the cars module puts them into PARKING.bays (walk.js; cars.parkingCars(PARKING.bays)). Optional
// hook for a module that wants to add its own group: KIT.cars.parkingScene(PARKING, {bId, world, y}) → {group, list}.
import * as THREE from 'three';
import { BUILDINGS, B_IDS, PARKING, RAMPS, coresOf, floorY, localToWorld, worldToLocal, rampY, parkingDrivable } from '../data.js';
import { RoomSet, kindOfName, maxRect } from './commons-rooms.js';

const H = PARKING.ceiling || 3.0, SLAB = 0.3, DOOR_H = 2.1, CLEAR = (RAMPS[0] && RAMPS[0].clear) || 2.5, Y0 = PARKING.y;
const yl = y => y - Y0;                                    // world level → local y
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function inPoly(p, x, z) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
const bboxOf = p => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const area2 = p => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a; };
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ------------------------------------------------------------------ ramps: analytic surface
const RP = RAMPS.filter(r => r.poly && r.stations).map(r => {
  const z = r.axis === 'z', top = z ? r.topPoint[2] : r.topPoint[0], gate = r.stations[1].at, foot = r.stations[2].at, up = r.dirUp[z ? 1 : 0];
  return { r, z, top, gate, foot, up, a0: Math.min(top, gate), a1: Math.max(top, gate), c0: r.inner[0], c1: r.inner[1],
    yAt: at => yl(rampY(r, at)), P: (at, c) => (z ? [c, at] : [at, c]), al: (x, zz) => (z ? zz : x), ac: (x, zz) => (z ? x : zz) };
});
function rampAt(x, z, m = 0) { for (const R of RP) { const a = R.al(x, z), c = R.ac(x, z); if (a >= R.a0 - m && a <= R.a1 + m && c >= R.c0 - m && c <= R.c1 + m) return R; } return null; }
const surfY = (x, z) => { const R = rampAt(x, z); return R ? Math.max(0, R.yAt(R.al(x, z))) : 0; };            // local y of the floor / ramp surface
const topAt = (x, z) => { const R = rampAt(x, z, -0.03); if (!R) return H; const y = R.yAt(R.al(x, z)); return y < 0.02 ? H : Math.min(H, y - SLAB); };   // how high a wall may rise there

// a quad / triangle collector → one BufferGeometry
class Quads {
  constructor() { this.p = []; this.n = []; this.u = []; }
  // the winding is made to agree with the wanted normal n, so callers never care about vertex order
  tri(a, b, c, n, ua = [0, 0], ub = [1, 0], uc = [0, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    if ((uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0) { const t = b; b = c; c = t; const tu = ub; ub = uc; uc = tu; }
    this.p.push(...a, ...b, ...c); this.n.push(...n, ...n, ...n); this.u.push(...ua, ...ub, ...uc);
  }
  quad(a, b, c, d, n, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) { this.tri(a, b, c, n, uv[0], uv[1], uv[2]); this.tri(a, c, d, n, uv[0], uv[2], uv[3]); }
  get empty() { return !this.p.length; }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); return g; }
}

// ------------------------------------------------------------------ layout shared by the four towers (pure data, cached)
let LAY = null;
function layout(K) {
  if (LAY) return LAY;
  const POCKET = K.POCKET ?? 1.06, LIFT_W = K.LIFT_W ?? 1.0;
  const lifts = [];
  for (const id of B_IDS) {
    const C = coresOf(id, 1)[0]; if (!C || !C.liftDoors) continue;
    C.liftDoors.forEach((d, i) => { const n = (C.liftNormals && C.liftNormals[i]) || C.liftNormal || [0, 1]; const [x, z] = localToWorld(id, d[0], d[1]);
      lifts.push({ id, i, x, z, n, half: LIFT_W / 2 + 0.03, hw: POCKET + 0.1 }); });
  }
  // rects where the drawn walls give way to the lift front (the towers' own lift doors rule: the car must be reachable)
  const carve = lifts.map(L => { const t = [-L.n[1], L.n[0]], a = [L.x - t[0] * (L.half + 0.02) - L.n[0] * 0.75, L.z - t[1] * (L.half + 0.02) - L.n[1] * 0.75], b = [L.x + t[0] * (L.half + 0.02) + L.n[0] * 0.5, L.z + t[1] * (L.half + 0.02) + L.n[1] * 0.5];
    return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) }; });
  const carved = (x, z) => carve.some(c => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1);
  const roomOf = (x, z) => PARKING.rooms.find(r => inPoly(r.poly, x, z) && !(r.holes || []).some(h => inPoly(h, x, z))) || null;
  const halls = PARKING.rooms.filter(r => r.kind === 'hall');
  const inHall = (x, z) => halls.some(h => inPoly(h.poly, x, z) && !h.holes.some(q => inPoly(q, x, z)));
  // a free standing point per tower: in the hall, in front of the open door of the tower's lobby that is nearest to its lifts
  const spawns = {};
  for (const id of B_IDS) {
    const Ls = lifts.filter(l => l.id === id), c = Ls.length ? [Ls.reduce((s, l) => s + l.x, 0) / Ls.length, Ls.reduce((s, l) => s + l.z, 0) / Ls.length] : BUILDINGS[id].origin;
    const cand = PARKING.doors.filter(d => d.open && d.toHall && !d.fire).map(d => ({ d, dist: hyp(d.c, c) })).sort((a, b) => a.dist - b.dist);
    let sp = null;
    for (const { d } of cand.slice(0, 3)) {
      for (const s of [1, -1]) for (const off of [2.6, 2.0, 3.4, 1.5]) {
        const n = d.axis === 'x' ? [0, s] : [s, 0], x = d.c[0] + n[0] * off, z = d.c[1] + n[1] * off;
        if (inHall(x, z) && parkingDrivable(x, z, 0.55) && !PARKING.bays.some(b => Math.abs(x - b.x) < (Math.abs(b.front[0]) > 0.5 ? b.l : b.w) / 2 && Math.abs(z - b.z) < (Math.abs(b.front[0]) > 0.5 ? b.w : b.l) / 2)) { sp = { x, z, yaw: Math.atan2(n[0], n[1]), door: d, n }; break; }
      }
      if (sp) break;
    }
    if (!sp) { const b = PARKING.bays.filter(q => q.kind === 'car').sort((p, q) => hyp([p.x, p.z], c) - hyp([q.x, q.z], c))[0]; sp = { x: b.entry[0], z: b.entry[1], yaw: 0, door: null, n: [0, 1] }; }
    spawns[id] = sp;
  }
  LAY = { lifts, carve, carved, roomOf, halls, inHall, spawns };
  return LAY;
}

// ------------------------------------------------------------------ rooms behind the doors (V10-doors)
// The working drawing numbers every room but names none of them ("explication — see the AR drawings"). Names below:
// 'drawing' = printed on the working drawing; 'concept' = the name of the same place on plans.pdf p.21 (the AR concept plan
// of level −4.200, georeferenced on the axes); 'inferred' = from what is drawn (WC pans, stair flights, a vestibule).
// Rooms not listed keep the name of data/parking.json (V6). Purpose not determinable → «Технічне приміщення».
const ROOM_INFO = {
  '0102/1': ['Приміщення підлогомийної машини', 'cleaning', 'concept'], '0103': ['Венткамера підпору повітря', 'vent', 'concept'],
  '0109': ['Електрощитова будинку', 'elec', 'concept'], '0110': ['Резерв', 'storage', 'concept'], '0111': ['Приміщення СЗ', 'comms', 'concept'],
  '0112': ['Насосна пожежогасіння та водопостачання', 'pump', 'concept'], '0113': ['Резервуар пожежогасіння', 'fireTank', 'concept'],
  '0117': ['Електрощитова паркінгу', 'elec', 'concept'], '0117/1': ['Електрощитова', 'elec', 'concept'], '0121': ['Коридор', 'passage', 'concept'],
  '0122': ['Венткамера підпору повітря', 'vent', 'concept'], '0123': ['Вузол керування АСПГ', 'asp', 'concept'], '0127/1': ['Тамбур', 'passage', 'inferred'],
  '0132': ['Венткамера басейну', 'vent', 'concept'], '0135': ['Венткамера підпору повітря', 'vent', 'concept'], '0136': ['Електрощитова', 'elec', 'concept'],
  '0141': ['Приміщення КЛ 0,4 кВ', 'comms', 'concept'], '0143': ['Вузол керування АСПГ', 'asp', 'concept'], '0144': ['Венткамера підпору повітря', 'vent', 'concept'],
  '0146': ['Електрощитова', 'elec', 'concept'], '0148': ['Приміщення охорони', 'security', 'concept'], '0149': ['Приміщення прокладання комунікацій', 'comms', 'concept'],
  '0150': ['Сходова клітка', 'stair', 'drawing'],
};
// rooms numbered on the drawing but missing from the extracted polygons (world x/z): 0150, the stair between the R2 walkway and 0149
const STREET_STAIRS = new Set(['0127', '0150']);
const EXTRA_ROOMS = [{ no: '0150', nos: ['0150'], kind: 'stair', name: { uk: 'Сходова клітка', en: 'Stair' }, nameSrc: 'drawing', area: 8.98, poly: [[-23.16, 49.46], [-16.56, 49.46], [-16.56, 50.82], [-23.16, 50.82]], holes: [], inner: [-19.86, 50.14] }];
// every room gets a unique key: its number, or number·k where the drawing prints the same number twice (0128)
let ROOMS_K = null;
const roomsK = () => { if (ROOMS_K) return ROOMS_K; const all = [...EXTRA_ROOMS, ...PARKING.rooms], seen = {}; ROOMS_K = all.map(r => { seen[r.no] = (seen[r.no] || 0) + 1; return { r, key: seen[r.no] > 1 ? r.no + '·' + seen[r.no] : r.no }; }); return ROOMS_K; };
export const roomInfo = key => { const e = roomsK().find(q => q.key === key) || roomsK().find(q => (q.r.nos || []).includes(key)); if (!e) return null; const r = e.r;
  const i = ROOM_INFO[r.no]; const name = i ? i[0] : r.name.uk; return { key: e.key, no: r.no, name, kind: i ? i[1] : r.kind === 'hall' ? 'hall' : r.kind === 'liftHall' ? 'liftHall' : kindOfName(name), src: i ? i[2] : r.nameSrc, area: r.area, poly: r.poly, holes: r.holes || [], inner: r.inner }; };
const roomAt = (x, z) => { const e = roomsK().find(({ r }) => inPoly(r.poly, x, z) && !(r.holes || []).some(h => inPoly(h, x, z))); return e ? e.key : null; };
const inWall = (x, z) => [...PARKING.walls, ...PARKING.lining].some(w => inPoly(w.poly, x, z) && !(w.holes || []).some(h => inPoly(h, x, z)));
// every opening of the drawing: the room on each side (sampled along the wall normal), and openings that are the same leaf
// drawn through two wall layers (two openings, one swing arc) — the real door is the one whose leaf length matches its width
let DPLAN = null;
export function doorPlan() {
  if (DPLAN) return DPLAN;
  const out = PARKING.doors.map((d, i) => {
    // the room on each side: the first room polygon met within 1.2 m of the wall centre (farther = an unnumbered vestibule)
    const ax = d.axis === 'x', side = s => { for (let k = 1; k <= 12; k++) { const o = k * 0.1, r = roomAt(ax ? d.c[0] : d.c[0] + s * o, ax ? d.c[1] + s * o : d.c[1]); if (r) return r; } return null; };
    // how deep the wall material is on each side of the opening (a second wall layer / lining drawn without the opening):
    // the opening is cut through all of it (walls of the drawing that a door passes through)
    const tc = ax ? d.c[1] : d.c[0], f0 = ax ? d.z0 : d.x0, f1 = ax ? d.z1 : d.x1, at = o => (ax ? [d.c[0], o] : [o, d.c[1]]);
    const depth = (face, s) => { let last = face, t = face; for (let k = 1; k <= 45; k++) { t = face + s * k * 0.02; if (inWall(...at(t))) last = t; else if (Math.abs(t - last) > 0.09) break; } return Math.abs(last - tc) + 0.035; };
    // a door onto a ramp's walkway stands at the walkway level (only where that is within reach of a door: ≤ 2 m)
    const sn = ax ? [0, 1] : [1, 0], y0 = Math.max(0, ...[-1, 1].map(s => { const y = surfY(d.c[0] + sn[0] * s * 0.55, d.c[1] + sn[1] * s * 0.55); return y < 2.0 ? y : 0; }));
    return { i, d, id: d.id || 'D' + i, sides: [side(-1), side(1)], dupOf: null, sideN: sn, y0: y0 > 0.05 ? +y0.toFixed(3) : 0, cut: { ax, a0: ax ? d.x0 : d.z0, a1: ax ? d.x1 : d.z1, tc, e0: depth(f0, -1), e1: depth(f1, 1) } };
  });
  for (const a of out) for (const b of out) if (a.i < b.i && a.d.leafEnd && b.d.leafEnd && hyp(a.d.leafEnd, b.d.leafEnd) < 0.05) {
    const fit = q => Math.abs(hyp(q.d.hinge, q.d.leafEnd) - q.d.w), keep = fit(a) <= fit(b) ? a : b, drop = keep === a ? b : a; drop.dupOf = keep.i; }
  DPLAN = out; return out;
}
// edge parameters (0…1) where an opening's cut begins / ends along a wall edge parallel to it
function cutTs(a, b) {
  const out = [], L = hyp(a, b); if (L < 1e-6) return out;
  for (const { cut: c } of doorPlan()) { if (!c) continue;
    const ia = c.ax ? 0 : 1, ic = c.ax ? 1 : 0, du = (b[ia] - a[ia]) / L; if (Math.abs(du) < 0.9) continue;
    const across = (a[ic] + b[ic]) / 2; if (across < c.tc - c.e0 - 0.05 || across > c.tc + c.e1 + 0.05) continue;
    for (const v of [c.a0 + 0.015, c.a1 - 0.015]) { const t = (v - a[ia]) / (b[ia] - a[ia]); if (t > 1e-4 && t < 1 - 1e-4) out.push(t); } }
  return out;
}
// a wall edge parallel to an opening whose midpoint lies in the opening's cut (through every wall layer): not built
function doorCut(mx, mz, ux, uz) {
  for (const q of doorPlan()) { const c = q.cut; if (!c) continue;
    const along = c.ax ? mx : mz, across = c.ax ? mz : mx, par = c.ax ? Math.abs(ux) > 0.9 : Math.abs(uz) > 0.9;
    if (par && along > c.a0 + 0.015 && along < c.a1 - 0.015 && across > c.tc - c.e0 - 0.005 && across < c.tc + c.e1 + 0.005) return true; }
  return false;
}

// ------------------------------------------------------------------ builder
export function buildTowerParking(KIT, bId) {
  const T = KIT.THREE || THREE;
  const Lay = layout(KIT);
  const ctx = KIT.makeCtx(bId, -1, H);
  const rotY = BUILDINGS[bId].rotY || 0;
  const W = new T.Group(); W.name = 'vrc-parking-world'; W.rotation.y = -rotY;
  { const [ox, oz] = worldToLocal(bId, 0, 0); W.position.set(ox, 0, oz); } ctx.root.add(W);
  const B = new KIT.Batch(), C = new KIT.Colliders(16), topB = new KIT.Batch();     // topB: everything overhead (userData.ceiling)
  const wctx = { ...ctx, root: W, B, C, signB: new KIT.Batch() };
  const ownMat = ctx.ownMat || (ctx.ownMat = []), ownTex = ctx.ownTex || (ctx.ownTex = []), ownGeo = [];
  const mat4 = KIT.mat4, FACE = KIT.FACE ?? 0.02, WALL_T = KIT.WALL_T ?? 0.14, LIFT_H = KIT.LIFT_H ?? 2.2;
  const SANS = KIT.SANS || 'Arial, Helvetica, sans-serif';
  const canvas = (w, h) => (KIT.canvas ? KIT.canvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
  const tex = (c, repeat = false) => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping; ownTex.push(t); return t; };
  const own = m => { ownMat.push(m); return m; };
  const KM = key => { try { const m = KIT.M(key); if (m) return m; } catch (e) { /* unknown key */ } return null; };

  // ---------------------------------------------------------------- materials (own: the car park has its own, lighter palette)
  const noise = (g, w, h, n, a, r = rng(7)) => { for (let i = 0; i < n; i++) { const v = r() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${a * r()})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); } };
  const std = (o, name) => { const m = new T.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o }); m.name = 'vrc-pk-' + name; return own(m); };
  const basic = (o, name) => { const m = new T.MeshBasicMaterial(o); m.name = 'vrc-pk-' + name; return own(m); };
  const MT = {};
  { // sealed epoxy floor (aisles), cool mid grey
    const c = canvas(256, 256), g = c.getContext('2d'); g.fillStyle = '#8d9296'; g.fillRect(0, 0, 256, 256);
    const r = rng(11); for (let i = 0; i < 26; i++) { const x = r() * 256, y = r() * 256, rad = 30 + r() * 70, gr = g.createRadialGradient(x, y, 0, x, y, rad); const v = r() < 0.5 ? 0 : 255; gr.addColorStop(0, `rgba(${v},${v},${v},0.06)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
    noise(g, 256, 256, 2600, 0.07);
    MT.floor = std({ map: tex(c, true), roughness: 0.36, envMapIntensity: 0.6 }, 'floor');
  }
  MT.bay = std({ vertexColors: true, roughness: 0.42, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, 'bay');
  MT.paint = std({ color: 0xf4f3ee, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: T.DoubleSide }, 'paint');
  MT.paintGreen = std({ color: 0x1f9a55, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: T.DoubleSide }, 'paintGreen');
  { // pedestrian zone / safety island: yellow diagonal hatching (the yellow fields of the drawing)
    const c = canvas(64, 64), g = c.getContext('2d'); g.fillStyle = '#e9b91e'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#f7d657'; g.lineWidth = 9;
    for (let k = -64; k < 128; k += 32) { g.beginPath(); g.moveTo(k, 64); g.lineTo(k + 64, 0); g.stroke(); }
    MT.ped = std({ map: tex(c, true), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: T.DoubleSide }, 'ped');
  }
  const wallTex = (band, stripe) => { const c = canvas(64, 512), g = c.getContext('2d');      // v = 0 floor … 1 ceiling (3.0 m)
    g.fillStyle = '#e9e8e3'; g.fillRect(0, 0, 64, 512); const yb = 512 - 512 * 1.15 / H; g.fillStyle = band; g.fillRect(0, yb, 64, 512 - yb);
    g.fillStyle = stripe; g.fillRect(0, yb - 512 * 0.09 / H, 64, 512 * 0.09 / H); g.fillStyle = '#2b2d30'; g.fillRect(0, 512 - 512 * 0.1 / H, 64, 512 * 0.1 / H);
    noise(g, 64, 512, 900, 0.05, rng(3)); return tex(c, true); };
  MT.wallW = std({ map: wallTex('#5d6b68', '#1f9a55'), roughness: 0.85 }, 'wallW');      // west hall (compartment 1, charging places): green line
  MT.wallE = std({ map: wallTex('#59626d', '#c9a45c'), roughness: 0.85 }, 'wallE');      // east hall (compartment 2): brass line
  { const c = canvas(64, 512), g = c.getContext('2d'), q = 512 / H; g.fillStyle = '#ece8df'; g.fillRect(0, 0, 64, 512); g.fillStyle = '#b9ad9a'; g.fillRect(0, 512 - 1.05 * q, 64, 1.05 * q);
    g.fillStyle = '#8a6a3a'; g.fillRect(0, 512 - 1.09 * q, 64, 0.04 * q); g.fillStyle = '#5a5248'; g.fillRect(0, 512 - 0.1 * q, 64, 0.1 * q); noise(g, 64, 512, 600, 0.04, rng(13));
    MT.wallIn = std({ map: tex(c, true), roughness: 0.85 }, 'wallIn'); }                 // inside the cores: warm white over a taupe wainscot
  { const c = canvas(64, 512), g = c.getContext('2d'); g.fillStyle = '#dedcd6'; g.fillRect(0, 0, 64, 512); const q = 512 / H;
    g.fillStyle = '#4a4f55'; g.fillRect(0, 512 - 1.15 * q, 64, 1.15 * q); g.fillStyle = '#e9b91e'; g.fillRect(0, 512 - 1.4 * q, 64, 0.25 * q);
    g.fillStyle = '#15171a'; for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(k * 16 - 16, 512 - 1.15 * q); g.lineTo(k * 16 - 8, 512 - 1.15 * q); g.lineTo(k * 16, 512 - 1.4 * q); g.lineTo(k * 16 - 8, 512 - 1.4 * q); g.fill(); }
    noise(g, 64, 512, 700, 0.05, rng(5)); MT.column = std({ map: tex(c, true), roughness: 0.8 }, 'column'); }
  MT.ceiling = std({ color: 0xd9d9d6, roughness: 0.95 }, 'ceiling');
  MT.beam = std({ color: 0xcfcfcb, roughness: 0.95 }, 'beam');
  MT.cap = std({ color: 0x3a3d41, roughness: 0.95 }, 'cap');                              // cut face of the walls in top / cut-away views
  MT.concrete = KM('concreteLight') || std({ color: 0xcfcbc3, roughness: 0.9 }, 'concrete');
  { const c = canvas(64, 64), g = c.getContext('2d'); g.fillStyle = '#6c7074'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#595d61'; for (let k = 0; k < 64; k += 8) g.fillRect(0, k, 64, 3); noise(g, 64, 64, 500, 0.08, rng(9));
    MT.ramp = std({ map: tex(c, true), roughness: 0.9 }, 'ramp'); }      // anti-slip ribs across the ramp
  { const c = canvas(64, 16), g = c.getContext('2d'); g.fillStyle = '#e9b91e'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#17181a'; for (let k = -16; k < 80; k += 32) { g.beginPath(); g.moveTo(k, 16); g.lineTo(k + 16, 16); g.lineTo(k + 32, 0); g.lineTo(k + 16, 0); g.fill(); }
    MT.hazard = std({ map: tex(c, true), roughness: 0.7 }, 'hazard'); }
  { const c = canvas(32, 32), g = c.getContext('2d'); g.fillStyle = '#2a2c2f'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#0c0d0e'; for (let k = 2; k < 32; k += 8) g.fillRect(k, 3, 4, 26);
    MT.grate = std({ map: tex(c, true), roughness: 0.5, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'grate'); }
  MT.rubber = std({ color: 0x17181a, roughness: 0.9 }, 'rubber');
  MT.steel = KM('steel') || std({ color: 0xa6a8aa, metalness: 1, roughness: 0.35 }, 'steel');
  MT.galv = std({ color: 0xc3c7ca, metalness: 0.25, roughness: 0.5 }, 'galv');
  MT.pipeRed = std({ color: 0xa3261d, roughness: 0.5 }, 'pipeRed');
  MT.door = std({ color: 0x5b6168, roughness: 0.55, metalness: 0.35 }, 'door');
  MT.doorFire = std({ color: 0x8d2a22, roughness: 0.55, metalness: 0.3 }, 'doorFire');
  MT.frame = std({ color: 0x2b2d30, roughness: 0.6, metalness: 0.5 }, 'frame');
  MT.white = std({ color: 0xf4f2ee, roughness: 0.4 }, 'white');
  MT.stone = KM('stone') || std({ color: 0xcfc8bb, roughness: 0.3 }, 'stone');
  MT.marble = KM('marble') || std({ color: 0xe9e4da, roughness: 0.2 }, 'marble');
  // the LED lines are the light of the level: emissive STANDARD materials (the panorama renderer turns emissive materials named
  // coldLed / led into real light sources; an unlit MeshBasicMaterial would stay dark there)
  MT.led = std({ color: 0x000000, roughness: 1, emissive: new T.Color(1, 1, 0.96), emissiveIntensity: 2.4 }, 'coldLed');
  MT.ledWarm = std({ color: 0x000000, roughness: 1, emissive: new T.Color(1, 0.87, 0.7), emissiveIntensity: 2.3 }, 'ledWarm');
  MT.ledGreen = basic({ color: new T.Color(0.3, 2.2, 0.8) }, 'indicator');
  const hidden = KM('hidden') || basic({ visible: false }, 'hidden');
  const box = (m, x0, x1, y0, y1, z0, z1) => B.box(m, x0, x1, y0, y1, z0, z1);
  const solidBox = (m, x0, x1, y0, y1, z0, z1) => { box(m, x0, x1, y0, y1, z0, z1); C.box(x0, x1, y0, y1, z0, z1); };
  // an oriented box: centre (x, z), half sizes hu (along yaw direction d = (sin, cos)) and hv, from y0 to y1
  const obox = (m, x, z, yaw, hu, hv, y0, y1, solid = false) => {
    const g = new T.BoxGeometry(hv * 2, y1 - y0, hu * 2); g.applyMatrix4(mat4(x, (y0 + y1) / 2, z, yaw)); B.add(m, g);
    if (solid) { if (Math.abs(Math.sin(2 * yaw)) < 1e-3) { const a = Math.abs(Math.sin(yaw)) > 0.5; C.box(x - (a ? hu : hv), x + (a ? hu : hv), y0, y1, z - (a ? hv : hu), z + (a ? hv : hu)); } else { const c = new T.BoxGeometry(hv * 2, y1 - y0, hu * 2); c.applyMatrix4(mat4(x, (y0 + y1) / 2, z, yaw)); C.geoSolid(c); } }
  };

  // ---------------------------------------------------------------- rooms behind the doors (contents built lazily by commons-rooms.js)
  const RS = new RoomSet(KIT, W, { bId, floor: -1, H, near: 9, far: 24 });
  const DP = doorPlan(), stairRects = [], highDoors = DP.filter(q => q.dupOf == null && q.y0 > 0.5);
  const towerNear = p => { let best = null; for (const L of Lay.lifts) { const d = hyp([L.x, L.z], p); if (!best || d < best.d) best = { d, id: L.id }; } return best; };
  { const ids = new Set(); for (const q of DP) if (q.dupOf == null) for (const no of q.sides) if (no) ids.add(no);
    for (const no of ids) {
      const info = roomInfo(no); if (!info || info.kind === 'hall' || info.kind === 'liftHall') continue;
      const spec = { id: no, no: info.no, name: info.name, kind: info.kind, src: info.src, poly: info.poly, holes: info.holes, h: H, inner: info.inner, ceil: true };
      if (info.kind === 'stair') {
        const rect = maxRect(info.poly, info.holes, 0.1);
        const high = DP.find(q => q.dupOf == null && q.sides.includes(no) && q.y0 > 0.5);
        if (rect && high) {     // a stair between the car-park floor and a door that opens at a higher level (0150: the R2 ramp walkway)
          const ax = rect.x1 - rect.x0 >= rect.z1 - rect.z0, a = ax ? high.d.c[0] : high.d.c[1], lo = ax ? rect.x0 : rect.z0, hi = ax ? rect.x1 : rect.z1, atHi = Math.abs(a - hi) < Math.abs(a - lo);
          const main = DP.find(q => q.dupOf == null && q !== high && q.sides.includes(no) && q.y0 < 0.05);
          const far = (atHi ? hi - Math.min(ax ? high.d.x0 : high.d.z0, ax ? high.d.x1 : high.d.z1) : Math.max(ax ? high.d.x0 : high.d.z0, ax ? high.d.x1 : high.d.z1) - lo) + 0.3;
          spec.stair = { rect, up: high.y0, mid: high.y0, straight: true, landAt: atHi ? 'lo' : 'hi', mainDoor: main && main.id, dm: far, walls: 'above', wallsFrom: H, baseFloor: true, upper: null };
          stairRects.push(rect);
        } else if (rect && rect.x1 - rect.x0 > 1.2 && rect.z1 - rect.z0 > 1.2) {
          // 0127 and 0150 are the separate evacuation stairs with their own exit to the street (plans: «Сходи С1 … own exit on the facade»)
          const tw = towerNear(info.inner || [(rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2]), tower = tw && tw.d < 16 && !STREET_STAIRS.has(no) ? tw.id : null, up = floorY(tower || bId, 1) - Y0;
          spec.tower = tower;
          // flights up from −4.200 to the drawn landing −2.850 and on to ±0.000, where the door of the tower's ground floor is
          spec.stair = { rect, up, mid: 1.35, walls: 'above', wallsFrom: H, baseFloor: true,
            upper: tower ? { label: 'ПОВЕРХ 1', sub: 'БУДИНОК ' + BUILDINGS[tower].no, go: () => RS.goTo(tower, 1, { from: -1, tower }) }
              : { label: 'ВИХІД', sub: 'ВУЛИЦЯ', go: () => RS.goTo((tw && tw.id) || bId, 'outside', { from: -1 }) } };
          stairRects.push(rect);
        }
      }
      RS.addRoom(spec);
    } }

  // ---------------------------------------------------------------- floor slab, ceiling (holes where a ramp tunnel rises through it)
  const poly = PARKING.poly;
  const holeOf = R => {       // the stretch where the tunnel roof (ramp + clear height) is above the hall ceiling
    let a = R.foot; const step = R.up * 0.05; while ((R.up < 0 ? a > R.top : a < R.top) && R.yAt(a) + CLEAR < H) a += step;
    const b = R.top + R.up * 0.02; return { a0: Math.min(a, b), a1: Math.max(a, b), aStart: a };
  };
  const holes = RP.map(R => ({ R, ...holeOf(R) }));
  {
    const sh = new T.Shape(poly.map(([x, z]) => new T.Vector2(x, -z)));
    const g = new T.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 5, p.getZ(i) / 5);
    B.add(MT.floor, g.clone()); C.geoFloor(g);
    const sc = new T.Shape(poly.map(([x, z]) => new T.Vector2(x, z)));
    for (const h of holes) { const q = [h.R.P(h.a0, h.R.c0), h.R.P(h.a0, h.R.c1), h.R.P(h.a1, h.R.c1), h.R.P(h.a1, h.R.c0)]; if (area2(q) > 0) q.reverse(); sc.holes.push(new T.Path(q.map(([x, z]) => new T.Vector2(x, z)))); }
    for (const r of stairRects) { const q = [[r.x0, r.z0], [r.x0, r.z1], [r.x1, r.z1], [r.x1, r.z0]]; if (area2(q) > 0) q.reverse(); sc.holes.push(new T.Path(q.map(([x, z]) => new T.Vector2(x, z)))); }      // stair wells rise through
    const gc = new T.ShapeGeometry(sc); gc.rotateX(Math.PI / 2); gc.translate(0, H, 0); topB.add(MT.ceiling, gc);
  }

  // ---------------------------------------------------------------- walls and wall lining exactly as drawn (edge by edge), wall tops
  const zoneMat = (x, z) => { const r = Lay.roomOf(x, z); return r && r.kind !== 'hall' && r.kind !== 'ramp' ? MT.wallIn : (x < PARKING.fireGate.a[0] ? MT.wallW : MT.wallE); };
  const WQ = new Map(), wq = m => { if (!WQ.has(m)) WQ.set(m, new Quads()); return WQ.get(m); };
  const nearRamp = (x0, z0, x1, z1) => RP.some(R => { const b = bboxOf(R.r.poly); return Math.max(x0, x1) > b.x0 - 0.5 && Math.min(x0, x1) < b.x1 + 0.5 && Math.max(z0, z1) > b.z0 - 0.5 && Math.min(z0, z1) < b.z1 + 0.5; });
  const pylons = [];      // wall polygons that stand ON a ramp (the pylons of the central divider) — rebuilt on the slope below
  const wallRing = (ring, inMat) => {
    const n = ring.length;
    // which side of the ring is air: test beside the longest edge
    let flip = false; { let bi = 0, bl = 0; for (let i = 0; i < n; i++) { const l = hyp(ring[i], ring[(i + 1) % n]); if (l > bl) { bl = l; bi = i; } }
      const a = ring[bi], b = ring[(bi + 1) % n], nx = (b[1] - a[1]) / bl, nz = -(b[0] - a[0]) / bl; flip = inMat((a[0] + b[0]) / 2 + nx * 0.03, (a[1] + b[1]) / 2 + nz * 0.03); }
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], L = hyp(a, b); if (L < 0.012) continue;
      let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L; if (flip) { nx = -nx; nz = -nz; }
      const split = nearRamp(a[0], a[1], b[0], b[1]) || Lay.carve.some(c => Math.max(a[0], b[0]) > c.x0 - 0.1 && Math.min(a[0], b[0]) < c.x1 + 0.1 && Math.max(a[1], b[1]) > c.z0 - 0.1 && Math.min(a[1], b[1]) < c.z1 + 0.1);
      // pieces: breaks where a door's cut begins / ends along this edge (V10), then ≤ 8 m (0.25 m near ramps / lift fronts)
      const ts = [0, 1, ...cutTs(a, b)].sort((p, q) => p - q), parts = [];
      for (let w = 0; w + 1 < ts.length; w++) { const t0 = ts[w], t1 = ts[w + 1]; if (t1 - t0 < 1e-4) continue; const m = Math.max(1, Math.ceil(L * (t1 - t0) / (split ? 0.25 : 8))); for (let j = 0; j < m; j++) parts.push([t0 + (t1 - t0) * j / m, t0 + (t1 - t0) * (j + 1) / m]); }
      for (const [ta, tb] of parts) {
        const p = [a[0] + (b[0] - a[0]) * ta, a[1] + (b[1] - a[1]) * ta], q = [a[0] + (b[0] - a[0]) * tb, a[1] + (b[1] - a[1]) * tb], mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        if (Lay.carved(mx, mz) || doorCut(mx, mz, (b[0] - a[0]) / L, (b[1] - a[1]) / L)) continue;
        const h = split ? topAt(mx, mz) : H; if (h < 0.05) continue;
        const m = zoneMat(mx + nx * 0.12, mz + nz * 0.12), u0 = (ta * L) / 2.4, u1 = (tb * L) / 2.4;
        // normal: the ring runs so that (nx, nz) points out of the wall material
        wq(m).quad([q[0], 0, q[1]], [p[0], 0, p[1]], [p[0], h, p[1]], [q[0], h, q[1]], [nx, 0, nz], [[u1, 0], [u0, 0], [u0, h / H], [u1, h / H]]);
        const cq = new Quads(); cq.quad([q[0], 0, q[1]], [p[0], 0, p[1]], [p[0], h, p[1]], [q[0], h, q[1]], [nx, 0, nz]); C.geoSolid(cq.geo());
      }
    }
  };
  const capShape = (w) => { const s = new T.Shape(w.poly.map(([x, z]) => new T.Vector2(x, -z))); for (const h of w.holes || []) s.holes.push(new T.Path(h.map(([x, z]) => new T.Vector2(x, -z)))); const g = new T.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return g; };
  for (const w of [...PARKING.walls, ...PARKING.lining]) {
    const bb = bboxOf(w.poly), R = rampAt((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2);
    if (R && R.ac(bb.x0, bb.z0) > R.c0 + 0.4 && R.ac(bb.x1, bb.z1) < R.c1 - 0.4 && R.yAt(R.al((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2)) > 0.02) { pylons.push({ bb, R }); continue; }
    const inMat = (x, z) => inPoly(w.poly, x, z) && !(w.holes || []).some(h => inPoly(h, x, z));
    wallRing(w.poly, inMat);
    for (const h of w.holes || []) wallRing(h, inMat);
    { // wall tops (seen in cut-away / top views); none where a ramp passes over the wall
      const g0 = capShape(w), g = g0.index ? g0.toNonIndexed() : g0, pos = g.attributes.position, keep = [];
      for (let i = 0; i < pos.count; i += 3) { const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3; if (topAt(cx, cz) > H - 0.01 && !Lay.carved(cx, cz)) for (let k = 0; k < 3; k++) keep.push(pos.getX(i + k), H - 0.004, pos.getZ(i + k)); }
      if (keep.length) { const cg = new T.BufferGeometry(); cg.setAttribute('position', new T.Float32BufferAttribute(keep, 3)); cg.setAttribute('normal', new T.Float32BufferAttribute(new Float32Array(keep.length).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); cg.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(keep.length / 3 * 2), 2)); B.add(MT.cap, cg); }
      if (g !== g0) g0.dispose(); g.dispose(); }
  }
  for (const [m, q] of WQ) if (!q.empty) B.add(m, q.geo());

  // ---------------------------------------------------------------- columns and pylons exactly where drawn (bands, corner guards)
  {
    const unit = ctx.geo('pkCol', () => { const g = new T.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setY(i, p.getY(i)); return g; });
    const guard = ctx.geo('pkGuard', () => { const g = new T.BoxGeometry(0.09, 1.0, 0.09); g.translate(0, 0.5, 0); const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getY(i) * 4, uv.getY(i) > 0.5 ? 1 : 0); return g; });
    const cm = [], gm = [];
    for (const c of PARKING.columns) {
      const [x, z] = c.c; if (PARKING.walls.some(w => inPoly(w.poly, x, z) && !w.holes.some(h => inPoly(h, x, z)))) continue;      // drawn inside a wall: the wall is the structure
      const R = rampAt(x, z); if (R && R.yAt(R.al(x, z)) > 0.02) { pylons.push({ bb: bboxOf(c.poly), R }); continue; }
      const h = topAt(x, z); if (h < 0.3) continue;
      const yaw = -c.rot, hu = c.d / 2, hv = c.w / 2;
      cm.push(new T.Matrix4().compose(new T.Vector3(x, 0, z), new T.Quaternion().setFromEuler(new T.Euler(0, yaw, 0)), new T.Vector3(c.w, h, c.d)));
      if (Math.abs(Math.sin(2 * yaw)) < 1e-3) C.box(x - (Math.abs(Math.cos(yaw)) > 0.5 ? hv : hu), x + (Math.abs(Math.cos(yaw)) > 0.5 ? hv : hu), 0, h, z - (Math.abs(Math.cos(yaw)) > 0.5 ? hu : hv), z + (Math.abs(Math.cos(yaw)) > 0.5 ? hu : hv));
      else { const g = new T.BoxGeometry(c.w, h, c.d); g.applyMatrix4(mat4(x, h / 2, z, yaw)); C.geoSolid(g); }
      if (c.kind === 'red' && Lay.inHall(x, z)) for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const cx = Math.cos(yaw), sx = Math.sin(yaw), u = su * (hv + 0.012), v = sv * (hu + 0.012); gm.push(mat4(x + u * cx + v * sx, 0, z - u * sx + v * cx, yaw)); }
    }
    KIT.instanced(W, unit, MT.column, cm); KIT.instanced(W, guard, MT.hazard, gm);
  }

  // ---------------------------------------------------------------- doors: every drawn opening with a leaf that opens (V10); lintels; plates
  const plates = [];        // { x, y, z, n, text, sub }
  const PASS = new Set(['hall', 'liftHall', 'passage', 'shelter', 'stair', 'wc']);
  for (const q of DP) {
    const d = q.d, ax = d.axis === 'x', x0 = d.x0, x1 = d.x1, z0 = d.z0, z1 = d.z1, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, top = topAt(cx, cz);
    if (top < 1.2) continue;
    const yd = q.y0 || 0, dh = yd > 0.5 ? DOOR_H : Math.min(DOOR_H, top - 0.05), tc = ax ? cz : cx;      // wall centre line; yd: sill (a door onto the ramp walkway)
    { const c = q.cut, e0 = Math.max(c.e0, (ax ? z1 - z0 : x1 - x0) / 2), e1 = Math.max(c.e1, (ax ? z1 - z0 : x1 - x0) / 2);
      if (ax) { if (top > yd + dh + 0.02) box(MT.wallIn, x0, x1, yd + dh, top, tc - e0, tc + e1); if (yd > 0.02) { solidBox(MT.wallIn, x0, x1, 0, yd - 0.01, tc - e0, tc + e1); box(MT.concrete, x0, x1, yd - 0.01, yd, tc - e0 - 0.05, tc + e1 + 0.05); C.rect(x0, x1, tc - e0 - 0.15, tc + e1 + 0.15, yd); } for (const [p0, p1] of [[x0 - 0.02, x0], [x1, x1 + 0.02]]) solidBox(MT.wallIn, p0, p1, yd, yd + dh, tc - e0, tc + e1); }
      else { if (top > yd + dh + 0.02) box(MT.wallIn, tc - e0, tc + e1, yd + dh, top, z0, z1); if (yd > 0.02) { solidBox(MT.wallIn, tc - e0, tc + e1, 0, yd - 0.01, z0, z1); box(MT.concrete, tc - e0 - 0.05, tc + e1 + 0.05, yd - 0.01, yd, z0, z1); C.rect(tc - e0 - 0.15, tc + e1 + 0.15, z0, z1, yd); } for (const [p0, p1] of [[z0 - 0.02, z0], [z1, z1 + 0.02]]) solidBox(MT.wallIn, tc - e0, tc + e1, yd, yd + dh, p0, p1); } }
    if (q.dupOf != null) continue;   // second layer of a double wall: the leaf belongs to the other opening of the same swing
    // frame
    if (ax) { box(MT.frame, x0, x0 + 0.05, yd, yd + dh, z0 - 0.015, z1 + 0.015); box(MT.frame, x1 - 0.05, x1, yd, yd + dh, z0 - 0.015, z1 + 0.015); box(MT.frame, x0, x1, yd + dh - 0.05, yd + dh, z0 - 0.015, z1 + 0.015); }
    else { box(MT.frame, x0 - 0.015, x1 + 0.015, yd, yd + dh, z0, z0 + 0.05); box(MT.frame, x0 - 0.015, x1 + 0.015, yd, yd + dh, z1 - 0.05, z1); box(MT.frame, x0 - 0.015, x1 + 0.015, yd + dh - 0.05, yd + dh, z0, z1); }
    // the leaf (or two): hinged where the drawing hinges it, swinging to the side of its drawn arc; open as drawn or shut
    const infos = q.sides.map(no => no && roomInfo(no));
    const shelter = infos.some(i => i && i.kind === 'shelter'), tech = infos.some(i => i && !PASS.has(i.kind));
    const kind = d.fire ? 'fire' : shelter ? 'shelter' : tech ? 'tech' : 'steel';
    const jA = ax ? [x0 + 0.05, tc] : [tc, z0 + 0.05], jB = ax ? [x1 - 0.05, tc] : [tc, z1 - 0.05];
    const hb = d.hinge ? hyp(d.hinge, jB) < hyp(d.hinge, jA) : false;
    let n;
    if (d.leafEnd) n = ax ? [0, Math.sign(d.leafEnd[1] - cz) || 1] : [Math.sign(d.leafEnd[0] - cx) || 1, 0];
    else { const hs = infos.findIndex(i => !i || i.kind === 'hall'), sg = hs === 0 ? 1 : -1; n = ax ? [0, sg] : [sg, 0]; }      // undrawn swing: into the room
    const sides = q.sides.map(no => (no && RS.roomById(no) ? no : null));
    RS.addDoor({ id: q.id, a: hb ? jB : jA, b: hb ? jA : jB, n, sideN: q.sideN, sides, y0: q.y0, h: dh, wallT: ax ? z1 - z0 : x1 - x0, kind, double: d.w > 1.7, open: !!d.open,
      label: q.sides.filter(no => no && infos[q.sides.indexOf(no)] && !PASS.has(infos[q.sides.indexOf(no)].kind)).join(' / ') || null });
    // a plate over the door on each face: the room behind it, as numbered on the drawing (+ its name)
    for (const s of [-1, 1]) {
      const target = q.sides[s < 0 ? 0 : 1], rm = infos[s < 0 ? 0 : 1]; if (!target || !rm || rm.kind === 'hall' || q.sides[0] === q.sides[1]) continue;
      const nn = ax ? [0, -s] : [-s, 0], off = Math.max((ax ? (z1 - z0) : (x1 - x0)) / 2, -s > 0 ? q.cut.e1 : q.cut.e0) + 0.012;   // on the face of the lintel (cut through every layer)
      plates.push({ x: ax ? cx : cx + nn[0] * off, y: Math.min(yd + dh + 0.22, Math.max(top, yd + dh + 0.4) - 0.16), z: ax ? cz + nn[1] * off : cz, n: nn, text: rm.no, sub: rm.name, w: d.open ? 0.9 : 0.62, lintel: true });
    }
  }

  // ---------------------------------------------------------------- bays: surface tint, every painted line of the drawing, numbers, symbols
  // painted markings lie on the ramp only where the sheet draws the ramp itself (between its break line and the foot);
  // beyond the break line the sheet shows the level below the ramp, so the markings there are on the floor
  const decalY = (x, z, e) => { const R = rampAt(x, z); if (!R) return e; const a = R.al(x, z), cut = R.r.cut; return ((R.up < 0 ? a >= cut : a <= cut) ? Math.max(0, R.yAt(a)) : 0) + e; };
  {
    const q = new Quads(), cols = [];
    const tint = b => (b.kind === 'moto' ? [0.36, 0.37, 0.38] : b.accessible ? [0.16, 0.33, 0.62] : b.sec === 2 ? [0.25, 0.31, 0.3] : [0.27, 0.29, 0.33]);
    for (const b of PARKING.bays) { const p = b.poly, m = 0.05, c = tint(b), y = 0.002;
      q.quad([p[0][0] + m, y, p[0][1] + m], [p[3][0] + m, y, p[3][1] - m], [p[2][0] - m, y, p[2][1] - m], [p[1][0] - m, y, p[1][1] + m], [0, 1, 0]); for (let k = 0; k < 6; k++) cols.push(...c); }
    const g = q.geo(); g.setAttribute('color', new T.Float32BufferAttribute(cols, 3)); const mesh = new T.Mesh(g, MT.bay); mesh.name = 'vrc-pk-bays'; mesh.matrixAutoUpdate = false; W.add(mesh); ownGeo.push(g);
    // lines (0.10 m, as the 1.44 pt pen of the 1:200 sheet)
    const lq = new Quads(), hw = 0.05;
    for (const [ax_, az, bx, bz] of PARKING.bayLines) { const L = Math.hypot(bx - ax_, bz - az); if (L < 0.03) continue; const ux = (bx - ax_) / L, uz = (bz - az) / L, nx = -uz * hw, nz = ux * hw, ex = ux * hw, ez = uz * hw;
      const n = Math.max(1, rampAt((ax_ + bx) / 2, (az + bz) / 2, 0.3) ? Math.ceil(L / 0.6) : 1);
      for (let j = 0; j < n; j++) { const s0 = j / n, s1 = (j + 1) / n, p0 = [ax_ + (bx - ax_) * s0 - (j ? 0 : ex), az + (bz - az) * s0 - (j ? 0 : ez)], p1 = [ax_ + (bx - ax_) * s1 + (j === n - 1 ? ex : 0), az + (bz - az) * s1 + (j === n - 1 ? ez : 0)];
        const y0 = decalY(p0[0], p0[1], 0.005), y1 = decalY(p1[0], p1[1], 0.005);
        lq.quad([p0[0] + nx, y0, p0[1] + nz], [p0[0] - nx, y0, p0[1] - nz], [p1[0] - nx, y1, p1[1] - nz], [p1[0] + nx, y1, p1[1] + nz], [0, 1, 0]); } }
    B.add(MT.paint, lq.geo());
  }
  { // numbers exactly as printed (position and reading direction of the label on the sheet), one atlas
    const N = PARKING.bays.length, cols = 12, rows = Math.ceil(N / cols), cw = 168, chh = 64, cv = canvas(cols * cw, rows * chh), g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = '#f6f5f0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 50px ${SANS}`;
    PARKING.bays.forEach((b, i) => g.fillText(b.id, (i % cols) * cw + cw / 2, ((i / cols) | 0) * chh + chh / 2 + 2));
    const m = own(new T.MeshStandardMaterial({ map: tex(cv), transparent: true, alphaTest: 0.35, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: T.DoubleSide })); m.name = 'vrc-pk-numbers';
    const q = new Quads(), hw = 0.74, hh = 0.28;
    PARKING.bays.forEach((b, i) => { const d = b.labelDir, up = [d[1], -d[0]], c = b.label, y = 0.007, u0 = (i % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - ((i / cols) | 0) / rows, v0 = v1 - 1 / rows;
      const P = (a, e) => [c[0] + d[0] * a * hw + up[0] * e * hh, y, c[1] + d[1] * a * hw + up[1] * e * hh];
      q.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [0, 1, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]); });
    B.add(m, q.geo());
  }
  // pictograms (one atlas, 4 cells): 0 wheelchair, 1 charging plug, 2 speed limit 5, 3 height limit 2.0 m
  let pictoMat = null;
  {
    const cv = canvas(512, 128), g = cv.getContext('2d');
    g.fillStyle = '#1b56a8'; g.fillRect(4, 4, 120, 120); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(10, 10, 108, 108); g.fillStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.arc(58, 30, 9, 0, 7); g.fill(); g.beginPath(); g.moveTo(58, 44); g.lineTo(60, 72); g.lineTo(84, 72); g.lineTo(94, 100); g.stroke(); g.beginPath(); g.moveTo(60, 56); g.lineTo(80, 56); g.stroke(); g.beginPath(); g.arc(56, 82, 22, 0.5, 4.6); g.stroke();
    g.fillStyle = '#1f9a55'; g.beginPath(); g.arc(192, 64, 58, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 8; g.beginPath(); g.arc(192, 64, 50, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(172, 52, 40, 26); g.fillRect(178, 34, 8, 20); g.fillRect(198, 34, 8, 20); g.fillRect(188, 78, 8, 22);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(320, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#d22a22'; g.lineWidth = 14; g.beginPath(); g.arc(320, 64, 50, 0, 7); g.stroke(); g.fillStyle = '#15171a'; g.font = `700 64px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('5', 320, 68);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(448, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#d22a22'; g.lineWidth = 14; g.beginPath(); g.arc(448, 64, 50, 0, 7); g.stroke(); g.fillStyle = '#15171a'; g.font = `700 34px ${SANS}`; g.fillText('2,0 м', 448, 66);
    g.beginPath(); g.moveTo(448, 22); g.lineTo(440, 34); g.lineTo(456, 34); g.fill(); g.beginPath(); g.moveTo(448, 106); g.lineTo(440, 94); g.lineTo(456, 94); g.fill();
    pictoMat = own(new T.MeshStandardMaterial({ map: tex(cv), transparent: true, alphaTest: 0.4, roughness: 0.55, emissive: 0x000000, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, side: T.DoubleSide })); pictoMat.name = 'vrc-pk-picto';
  }
  const pictoQ = new Quads(), pictoWQ = new Quads();
  const pictoFloor = (i, x, z, s, yaw = 0) => { const c = Math.cos(yaw), sn = Math.sin(yaw), y = decalY(x, z, 0.009), P = (a, e) => [x + (a * c + e * sn) * s / 2, y, z + (-a * sn + e * c) * s / 2];
    pictoQ.quad(P(-1, 1), P(1, 1), P(1, -1), P(-1, -1), [0, 1, 0], [[i / 4, 0], [(i + 1) / 4, 0], [(i + 1) / 4, 1], [i / 4, 1]]); };
  const pictoWall = (i, x, y, z, n, s) => { const t = [n[1], -n[0]], P = (a, e) => [x + t[0] * a * s / 2, y + e * s / 2, z + t[1] * a * s / 2];
    pictoWQ.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [n[0], 0, n[1]], [[i / 4, 0], [(i + 1) / 4, 0], [(i + 1) / 4, 1], [i / 4, 1]]); };
  for (const b of PARKING.bays) if (b.accessible) pictoFloor(0, b.x - b.front[0] * b.l * 0.08, b.z - b.front[1] * b.l * 0.08, 1.15, Math.atan2(b.front[0], b.front[1]) + Math.PI);
  for (const e of PARKING.evMarks) pictoFloor(1, e[0], e[1], 1.1, 0);
  { // wheel stops as drawn, charging stations (wall boxes on posts, 0.11 × 0.18 × 0.315 m per the legend)
    for (const b of PARKING.bays) if (b.stop) { const s = b.stop; box(MT.hazard, s.x0, s.x1, 0, 0.1, s.z0, s.z1); }
    const post = ctx.geo('pkChPost', () => { const g = new T.BoxGeometry(0.07, 1.42, 0.07); g.translate(0, 0.71, 0); return g; });
    const cab = ctx.geo('pkChBox', () => { const g = new T.BoxGeometry(0.2, 0.33, 0.12); g.translate(0, 1.26, 0); return g; });
    const dot = ctx.geo('pkChDot', () => { const g = new T.BoxGeometry(0.21, 0.035, 0.13); g.translate(0, 1.36, 0); return g; });
    const ms = PARKING.chargers.map(c => { const p = c.box || c.p; return mat4(p[0], 0, p[1], 0); });
    KIT.instanced(W, post, MT.frame, ms); KIT.instanced(W, cab, MT.white, ms); KIT.instanced(W, dot, MT.ledGreen, ms);
    for (const c of PARKING.chargers) { const p = c.box || c.p; C.box(p[0] - 0.1, p[0] + 0.1, 0, 1.45, p[1] - 0.07, p[1] + 0.07); }
  }
  { // lane arrows as drawn (position and direction of travel), white
    const q = new Quads();
    for (const a of PARKING.arrows) { const [dx, dz] = a.dir, nx = -dz, nz = dx, c = a.c, y = decalY(c[0], c[1], 0.006), P = (u, v) => [c[0] + dx * u + nx * v, y, c[1] + dz * u + nz * v];
      q.quad(P(-1.15, -0.09), P(-1.15, 0.09), P(0.35, 0.09), P(0.35, -0.09), [0, 1, 0]); q.tri(P(0.35, -0.42), P(0.35, 0.42), P(1.15, 0), [0, 1, 0]); }
    B.add(MT.paint, q.geo());
  }
  { // pedestrian zones (yellow fields of the drawing) with the green arrows drawn on them
    for (const zn of PARKING.ped.zones) { const p = zn.poly; if (p.length < 3) continue; const s = new T.Shape(p.map(([x, z]) => new T.Vector2(x, -z))), g = new T.ShapeGeometry(s); g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < pos.count; i++) { pos.setY(i, decalY(pos.getX(i), pos.getZ(i), 0.004)); uv.setXY(i, pos.getX(i) / 0.8, pos.getZ(i) / 0.8); }
      B.add(MT.ped, g); }
    const q = new Quads();
    const head = (c, d, tip, y) => { const n = [-d[1], d[0]], P = (u, v) => [c[0] + d[0] * u + n[0] * v, y, c[1] + d[1] * u + n[1] * v]; q.tri(P(tip - 0.42, -0.36), P(tip - 0.42, 0.36), P(tip, 0), [0, 1, 0]); };
    for (const a of PARKING.ped.arrows) {
      const c = a.c, y = decalY(c[0], c[1], 0.008);
      if (a.kind === 'corner') { const p = [c[0], c[1]]; q.quad([p[0] - 0.25, y, p[1] - 0.25], [p[0] - 0.25, y, p[1] + 0.25], [p[0] + 0.25, y, p[1] + 0.25], [p[0] + 0.25, y, p[1] - 0.25], [0, 1, 0]); continue; }
      const d = a.dir, n = [-d[1], d[0]], L = (a.len || 1.2) / 2, P = (u, v) => [c[0] + d[0] * u + n[0] * v, y, c[1] + d[1] * u + n[1] * v];
      if (a.kind === 'one') { q.quad(P(-L, -0.1), P(-L, 0.1), P(L - 0.4, 0.1), P(L - 0.4, -0.1), [0, 1, 0]); head(c, d, L, y); }
      else { q.quad(P(-L + 0.4, -0.1), P(-L + 0.4, 0.1), P(L - 0.4, 0.1), P(L - 0.4, -0.1), [0, 1, 0]); head(c, d, L, y); head(c, [-d[0], -d[1]], L, y); }
    }
    if (!q.empty) B.add(MT.paintGreen, q.geo());
  }
  for (const t of [...PARKING.trays]) { const y = 0.004; const q = new Quads(), w = t.x1 - t.x0, d = t.z1 - t.z0; q.quad([t.x0, y, t.z0], [t.x0, y, t.z1], [t.x1, y, t.z1], [t.x1, y, t.z0], [0, 1, 0], [[0, 0], [0, d / 0.25], [w / 0.25, d / 0.25], [w / 0.25, 0]]); B.add(MT.grate, q.geo()); }

  // ---------------------------------------------------------------- lobbies and lift halls: stone floor, warm light
  const warm = [];
  for (const r of PARKING.rooms) if (r.kind === 'lobby' || r.kind === 'liftHall') {
    if (r.area > 150) continue;
    const s = new T.Shape(r.poly.map(([x, z]) => new T.Vector2(x, -z))), g = new T.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, 0.006, 0);
    const pos = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 1.2, pos.getZ(i) / 1.2);
    const m = own(MT.stone.clone()); m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.name = 'vrc-pk-lobbyfloor'; B.add(m, g);
    warm.push(r.inner);
  }

  // ---------------------------------------------------------------- lift fronts (marble portal at each lift door) + the cars
  const byB = {};
  for (const L of Lay.lifts) {
    const t = [-L.n[1], L.n[0]];
    const nrect = (t0, t1, d0, d1) => { const a = [L.x + t[0] * t0 + L.n[0] * d0, L.z + t[1] * t0 + L.n[1] * d0], b = [L.x + t[0] * t1 + L.n[0] * d1, L.z + t[1] * t1 + L.n[1] * d1]; return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) }; };
    for (const [t0, t1, y0, y1] of [[-L.hw, -L.half, 0, H], [L.half, L.hw, 0, H], [-L.half, L.half, LIFT_H, H]]) {
      const r = nrect(t0, t1, -WALL_T, FACE); if (y0 === 0) solidBox(MT.marble, r.x0, r.x1, y0, y1, r.z0, r.z1); else box(MT.marble, r.x0, r.x1, y0, y1, r.z0, r.z1);
    }
    (byB[L.id] ||= []).push(L);
    try {
      const Lf = new KIT.Lift(L.id, 0, L.i, -1);
      if (L.id !== bId && Lf.group) { const [wx, wz] = localToWorld(L.id, 0, 0), [lx, lz] = worldToLocal(bId, wx, wz); Lf.group.position.set(lx, 0, lz); Lf.group.rotation.y = (BUILDINGS[L.id].rotY || 0) - rotY; }
      ctx.lifts.push(Lf);
    } catch (e) { console.warn('[parking] lift', L.id, L.i, e); const r = nrect(-L.half, L.half, -0.1, 0); solidBox(MT.steel, r.x0, r.x1, 0, LIFT_H, r.z0, r.z1); }
  }

  // ---------------------------------------------------------------- ramps: slab on the drawn profile, kerbs, pedestrian strip, tunnel, gates
  const rampFloors = [];
  for (const R of RP) {
    const r = R.r, st = r.stations, P3 = (at, c, y) => { const p = R.P(at, c); return [p[0], y, p[1]]; };
    const lat = R.z ? [1, 0] : [0, 1], nUp = [0, 1, 0];
    // a strip between two stations across [c0, c1] with its own thickness below
    const fq = new Quads(), sq = new Quads();
    const seg = [];        // [at0, at1] pieces of the sloped part, from the foot to the top (+ a 1.2 m level lip beyond the top)
    for (let i = 2; i < 5; i++) seg.push([st[i].at, st[i + 1].at]);
    seg.push([R.top, R.top + R.up * 1.2]);
    const strip = (q, a0, a1, c0, c1, dy = 0, uvw = 1.2) => { const y0 = R.yAt(a0) + dy, y1 = R.yAt(a1) + dy, L = Math.abs(a1 - a0), w = Math.abs(c1 - c0);
      const A = P3(a0, c0, y0), Bp = P3(a0, c1, y0), Cc = P3(a1, c1, y1), D = P3(a1, c0, y1);
      const sl = Math.hypot(L, y1 - y0) || 1e-6, n = [(R.z ? 0 : -(y1 - y0) / sl * Math.sign(a1 - a0)), L / sl, (R.z ? -(y1 - y0) / sl * Math.sign(a1 - a0) : 0)];
      q.quad(A, Bp, Cc, D, n, [[0, 0], [w / uvw, 0], [w / uvw, sl / uvw], [0, sl / uvw]]); };
    const under = (q, a0, a1, c0, c1) => { const y0 = R.yAt(a0) - SLAB, y1 = R.yAt(a1) - SLAB; const A = P3(a0, c0, y0), Bp = P3(a0, c1, y0), Cc = P3(a1, c1, y1), D = P3(a1, c0, y1);
      q.quad(A, Bp, Cc, D, [0, -1, 0]); };
    for (const [a0, a1] of seg) { strip(fq, a0, a1, R.c0, R.c1); under(sq, a0, a1, R.c0 - 0.3, R.c1 + 0.3); }
    const fg = fq.geo(); B.add(MT.ramp, fg.clone());
    { const m = new T.Mesh(fg, hidden); m.visible = false; m.userData.floor = true; m.userData.collider = true; m.userData.ramp = r.id; m.name = 'vrc-floor-ramp-' + r.id; m.matrixAutoUpdate = false; W.add(m); ownGeo.push(fg); rampFloors.push(m); }
    B.add(MT.concrete, sq.geo());
    // kerbs along the walls, the divider island with its pylons, the pedestrian strip (yellow, as drawn)
    const kq = new Quads(), pq = new Quads();
    const kerb = (c0, c1, aFrom, aTo, h = 0.15) => { const n = Math.max(1, Math.ceil(Math.abs(aTo - aFrom) / 2));
      for (let j = 0; j < n; j++) { const a0 = aFrom + (aTo - aFrom) * j / n, a1 = aFrom + (aTo - aFrom) * (j + 1) / n; strip(kq, a0, a1, c0, c1, h, 0.6);
        for (const c of [c0, c1]) { const y0 = R.yAt(a0), y1 = R.yAt(a1), A = P3(a0, c, y0), Bp = P3(a1, c, y1), Cc = P3(a1, c, y1 + h), D = P3(a0, c, y0 + h); const s = c === Math.min(c0, c1) ? -1 : 1; kq.quad(A, Bp, Cc, D, [lat[0] * s, 0, lat[1] * s], [[0, 0], [2, 0], [2, 1], [0, 1]]); } } };
    const kTop = R.top + R.up * 1.2, kFoot = st[1].at;
    kerb(R.c0, r.kerbs.outer, kFoot, kTop);
    kerb(r.kerbs.div[0], r.kerbs.div[1], r.kerbs.divEnd, kTop, 0.18);
    { const n = Math.ceil(Math.abs(kTop - kFoot) / 1.5); for (let j = 0; j < n; j++) { const a0 = kFoot + (kTop - kFoot) * j / n, a1 = kFoot + (kTop - kFoot) * (j + 1) / n; strip(pq, a0, a1, r.pedStrip[0], r.pedStrip[1], 0.006, 0.8); } }
    B.add(MT.hazard, kq.geo()); B.add(MT.ped, pq.geo());
    // side walls of the tunnel: above the hall ceiling where the drawn walls stand, from the slab down where the ramp passes overhead
    const roofY = a => Math.max(H, R.yAt(a) + CLEAR), drawn = a => (R.up < 0 ? a >= r.enclosedTo - 0.05 : a <= r.enclosedTo + 0.05) && (R.up < 0 ? a <= R.gate + 0.01 : a >= R.gate - 0.01);
    const n = Math.ceil(Math.abs(kTop - R.foot) / 1.0), tq = new Quads(), rq = new Quads();
    for (let j = 0; j < n; j++) {
      const a0 = R.foot + (kTop - R.foot) * j / n, a1 = R.foot + (kTop - R.foot) * (j + 1) / n, am = (a0 + a1) / 2;
      const yb = drawn(am) ? H : Math.max(0, R.yAt(am) - SLAB), yt = roofY(am) + SLAB;
      if (yt - yb > 0.02) for (const [c, s] of [[R.c0, -1], [R.c1, 1]]) {
        // pieces along the wall; where a door opens onto the walkway (V10: 0150 → R2) the wall starts above that door
        const lo = Math.min(a0, a1), hi = Math.max(a0, a1), cuts = [];
        for (const q of highDoors) { const qa = R.al(q.d.c[0], q.d.c[1]), qc = R.ac(q.d.c[0], q.d.c[1]); if (Math.abs(qc - c) < 0.9 && qa + q.d.w / 2 > lo && qa - q.d.w / 2 < hi) cuts.push([Math.max(lo, qa - q.d.w / 2 - 0.05), Math.min(hi, qa + q.d.w / 2 + 0.05), q.y0 + DOOR_H]); }
        const pieces = []; let a = lo; for (const [c0, c1, y] of cuts.sort((p, q) => p[0] - q[0])) { if (c0 > a) pieces.push([a, c0, yb]); pieces.push([c0, c1, Math.max(yb, y)]); a = c1; } if (a < hi) pieces.push([a, hi, yb]);
        for (const [pa, pb, y0w] of pieces) { if (yt - y0w < 0.02) continue;
          const p0 = R.P(pa, s < 0 ? c - 0.3 : c), p1 = R.P(pb, s < 0 ? c : c + 0.3);
          box(MT.concrete, Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), y0w, yt, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]));
          C.box(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), y0w, yt, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])); }
      }
      if (roofY(am) > H + 0.001) { const y0 = roofY(a0), y1 = roofY(a1), A = P3(a0, R.c0, y0), Bp = P3(a0, R.c1, y0), Cc = P3(a1, R.c1, y1), D = P3(a1, R.c0, y1);
        rq.quad(A, Bp, Cc, D, [0, -1, 0], [[0, 0], [3, 0], [3, 1], [0, 1]]);
        if (j % 3 === 1) { const p = R.P(am, (r.laneUp[0] + r.laneUp[1]) / 2), p2 = R.P(am, (r.laneDown[0] + r.laneDown[1]) / 2), y = roofY(am) - 0.04; for (const q of [p, p2]) topB.add(MT.led, new T.BoxGeometry(R.z ? 0.12 : 1.4, 0.04, R.z ? 1.4 : 0.12), mat4(q[0], y, q[1])); } }
    }
    if (!rq.empty) topB.add(MT.ceiling, rq.geo());
    void tq;
    // pylons of the divider standing on the slope
    for (const py of pylons) if (py.R === R) { const b = py.bb, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, a = R.al(cx, cz), y0 = R.yAt(a) - 0.2, y1 = roofY(a); solidBox(MT.concrete, b.x0, b.x1, y0, y1, b.z0, b.z1); box(MT.hazard, b.x0 - 0.01, b.x1 + 0.01, R.yAt(a) + 0.18, R.yAt(a) + 0.5, b.z0 - 0.01, b.z1 + 0.01); }
    // gate at the foot
    const G = r.gate, gy = 2.5;
    if (G.kind === 'swing2') {       // two leaves, drawn open against the walls
      for (const hinge of [G.a, G.b]) { const p = R.P(R.gate, R.ac(hinge[0], hinge[1])), q = R.P(R.gate + R.up * G.leaf, R.ac(hinge[0], hinge[1]));
        const x0 = Math.min(p[0], q[0]) - (R.z ? 0.03 : 0), x1 = Math.max(p[0], q[0]) + (R.z ? 0.03 : 0), z0 = Math.min(p[1], q[1]) - (R.z ? 0 : 0.03), z1 = Math.max(p[1], q[1]) + (R.z ? 0 : 0.03);
        for (let k = 0; k < 9; k++) { const f = k / 8; if (R.z) box(MT.frame, x0, x1, 0.12, gy, z0 + (z1 - z0) * f - 0.02, z0 + (z1 - z0) * f + 0.02); else box(MT.frame, x0 + (x1 - x0) * f - 0.02, x0 + (x1 - x0) * f + 0.02, 0.12, gy, z0, z1); }
        for (const yy of [0.12, 1.3, gy]) box(MT.frame, x0, x1, yy - 0.03, yy + 0.03, z0, z1); }
    } else {                         // sectional gate: the panel is up under the ceiling, guide rails at the sides
      const p0 = R.P(R.gate, R.ac(G.a[0], G.a[1])), p1 = R.P(R.gate, R.ac(G.b[0], G.b[1])), q0 = G.box[0], q1 = G.box[1];
      box(MT.galv, Math.min(q0[0], q1[0]), Math.max(q0[0], q1[0]), H - 0.22, H - 0.16, Math.min(q0[1], q1[1]), Math.max(q0[1], q1[1]));
      for (const p of [p0, p1]) solidBox(MT.frame, p[0] - 0.06, p[0] + 0.06, 0, H, p[1] - 0.06, p[1] + 0.06);
      box(MT.hazard, Math.min(p0[0], p1[0]) - 0.06, Math.max(p0[0], p1[0]) + 0.06, H - 0.32, H - 0.02, Math.min(p0[1], p1[1]) - 0.06, Math.max(p0[1], p1[1]) + 0.06);
    }
    // barrier at the foot of the lane that goes up (boom raised), portal frame with signs at the top
    { const p = R.P(r.kerbs.divEnd - R.up * 0.55, (r.kerbs.div[0] + r.kerbs.div[1]) / 2); solidBox(MT.white, p[0] - 0.16, p[0] + 0.16, 0, 1.05, p[1] - 0.16, p[1] + 0.16);
      for (let k = 0; k < 6; k++) box(k % 2 ? MT.white : MT.pipeRed, p[0] - 0.04, p[0] + 0.04, 1.05 + k * 0.3, 1.05 + (k + 1) * 0.3, p[1] - 0.04, p[1] + 0.04); }
    { const yT = R.yAt(R.top), a = R.top + R.up * 1.2; for (const c of [R.c0 - 0.3, R.c1]) { const p0 = R.P(a, c), p1 = R.P(a + R.up * 0.35, c + 0.3); box(MT.frame, Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), yT, yT + CLEAR + 0.4, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])); }
      const p0 = R.P(a, R.c0 - 0.3), p1 = R.P(a + R.up * 0.35, R.c1 + 0.3); box(MT.hazard, Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), yT + CLEAR, yT + CLEAR + 0.4, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])); }
  }
  for (const t of PARKING.ramps.map(r => r.tray).filter(Boolean)) { const y = 0.004, q = new Quads(), w = t.x1 - t.x0, d = t.z1 - t.z0; q.quad([t.x0, y, t.z0], [t.x0, y, t.z1], [t.x1, y, t.z1], [t.x1, y, t.z0], [0, 1, 0], [[0, 0], [0, d / 0.25], [w / 0.25, d / 0.25], [w / 0.25, 0]]); B.add(MT.grate, q.geo()); }
  { // the gate between the two fire compartments: two leaves standing open (as drawn), red portal, plaques
    const F = PARKING.fireGate, x = F.a[0], s = F.opensTo[0] || 1;
    for (const z of [F.a[1], F.b[1]]) { solidBox(MT.doorFire, Math.min(x, x + s * F.leaf), Math.max(x, x + s * F.leaf), 0.05, 2.6, z - 0.04, z + 0.04); box(MT.frame, Math.min(x, x + s * F.leaf) - 0.01, Math.max(x, x + s * F.leaf) + 0.01, 1.25, 1.35, z - 0.05, z + 0.05); }
    box(MT.doorFire, x - 0.22, x + 0.22, 2.6, H, F.a[1] - 0.25, F.b[1] + 0.25);
    for (const z of [F.a[1] - 0.14, F.b[1] + 0.14]) box(MT.hazard, x - 0.24, x + 0.24, 0, 2.6, z - 0.12, z + 0.12);
  }

  // ---------------------------------------------------------------- overhead: beams on the column lines, light lines on the aisle axes, pipes / trays / ducts
  const inHole = (x, z) => holes.some(h => { const a = h.R.al(x, z), c = h.R.ac(x, z); return a > h.a0 - 0.4 && a < h.a1 + 0.4 && c > h.R.c0 - 0.5 && c < h.R.c1 + 0.5; });
  {
    const cols = PARKING.columns.filter(c => c.kind === 'red').map(c => c.c), done = new Set();
    const line = (k, o) => { const groups = new Map(); for (const c of cols) { const key = Math.round(c[k] / 0.3); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); }
      for (const g of groups.values()) { if (g.length < 3) continue; g.sort((a, b) => a[o] - b[o]);
        for (let i = 0; i + 1 < g.length; i++) { const a = g[i], b = g[i + 1], L = b[o] - a[o]; if (L < 1.2 || L > 8.7) continue; const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2; if (inHole(mx, mz) || !Lay.inHall(mx, mz)) continue;
          const id = k + ':' + Math.round(mx * 5) + ':' + Math.round(mz * 5); if (done.has(id)) continue; done.add(id);
          const c = (a[k] + b[k]) / 2; if (k === 0) topB.box(MT.beam, c - 0.2, c + 0.2, H - 0.35, H, a[1], b[1]); else topB.box(MT.beam, a[0], b[0], H - 0.35, H, c - 0.2, c + 0.2); } } };
    line(0, 1); line(1, 0);
  }
  const leds = [], pools = [], rowSigns = [];
  {
    const pipeQ = (m, rad, a, b, y) => { const L = hyp(a, b); if (L < 0.2) return; const g = new T.CylinderGeometry(rad, rad, L, 8); g.rotateZ(Math.PI / 2); topB.add(m, g, mat4((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, Math.atan2(-(b[1] - a[1]), b[0] - a[0]))); };
    for (const A of PARKING.aisles) {
      const pts = A.pts; let acc = 0, total = 0; for (let i = 0; i + 1 < pts.length; i++) total += hyp(pts[i], pts[i + 1]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], L = hyp(a, b); if (L < 0.3) continue; const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]], yaw = Math.atan2(d[0], d[1]);
        // a continuous LED line on the aisle axis (1.2 m profiles with 0.3 m gaps)
        for (let s = 0.4; s + 1.2 < L; s += 1.5) { const x = a[0] + d[0] * (s + 0.6), z = a[1] + d[1] * (s + 0.6); if (inHole(x, z) || !Lay.inHall(x, z) || rampAt(x, z, 0.3)) continue; leds.push(mat4(x, H - 0.045, z, yaw)); if (((acc + s) / 1.5 | 0) % 3 === 0) pools.push([x, z]); }
        if (total > 9) {
          const off = (p, k) => [p[0] + n[0] * k, p[1] + n[1] * k], ok = (p, q) => Lay.inHall((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) && Lay.inHall(p[0], p[1]) && Lay.inHall(q[0], q[1]) && !inHole((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) && !rampAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0.5) && !rampAt(p[0], p[1], 0.5) && !rampAt(q[0], q[1], 0.5);
          const p1 = off(a, 1.25), q1 = off(b, 1.25); if (ok(p1, q1)) { pipeQ(MT.pipeRed, 0.055, p1, q1, H - 0.42); for (let s = 1; s < L; s += 3) { const x = p1[0] + d[0] * s, z = p1[1] + d[1] * s; topB.box(MT.steel, x - 0.012, x + 0.012, H - 0.37, H, z - 0.012, z + 0.012); topB.box(MT.steel, x - 0.03, x + 0.03, H - 0.56, H - 0.5, z - 0.03, z + 0.03); } }
          const p2 = off(a, -1.3), q2 = off(b, -1.3); if (ok(p2, q2)) { const g = new T.BoxGeometry(0.34, 0.07, L); topB.add(MT.galv, g, mat4((p2[0] + q2[0]) / 2, H - 0.3, (p2[1] + q2[1]) / 2, yaw)); pipeQ(MT.rubber, 0.022, off(a, -1.22), off(b, -1.22), H - 0.25); pipeQ(MT.rubber, 0.022, off(a, -1.38), off(b, -1.38), H - 0.25); }
          if (total > 26 && !A.oneWay) { const p3 = off(a, 2.25), q3 = off(b, 2.25); if (ok(p3, q3) && L > 2) { const g = new T.BoxGeometry(0.62, 0.34, L); topB.add(MT.galv, g, mat4((p3[0] + q3[0]) / 2, H - 0.2, (p3[1] + q3[1]) / 2, yaw));
            for (let s = 1.2; s < L; s += 2.4) { const x = p3[0] + d[0] * s, z = p3[1] + d[1] * s; topB.add(MT.frame, new T.BoxGeometry(0.66, 0.38, 0.05), mat4(x, H - 0.2, z, yaw)); } } }
        }
        acc += L;
      }
      // a hanging row sign at the start of the aisle: the place numbers reached from it
      const mine = PARKING.bays.filter(b => b.aisle === A.id && b.kind === 'car'); if (mine.length >= 4 && total > 8) { const lo = mine.reduce((m, b) => (b.no < m.no ? b : m)), hi = mine.reduce((m, b) => (b.no > m.no ? b : m)), d = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], L = Math.hypot(...d);
        rowSigns.push({ x: pts[0][0] + d[0] / L * 2.2, z: pts[0][1] + d[1] / L * 2.2, n: [-d[0] / L, -d[1] / L], text: `МІСЦЯ ${lo.id} – ${hi.id}` }); }
    }
    { const im = KIT.instanced(W, ctx.geo('pkLed', () => new T.BoxGeometry(0.09, 0.05, 1.2)), MT.led, leds); if (im) im.userData.ceiling = true; }
    try { KIT.floorPools(wctx, pools, 4.4, 'poolCool'); } catch (e) { /* optional */ }
    try { KIT.floorPools(wctx, warm.map(p => [p[0], p[1]]), 2.6, 'pool'); } catch (e) { /* optional */ }
    { const wl = warm.map(p => mat4(p[0], H - 0.03, p[1])), im = KIT.instanced(W, ctx.geo('pkPanel', () => new T.BoxGeometry(0.6, 0.03, 0.6)), MT.ledWarm, wl); if (im) im.userData.ceiling = true; }
  }

  // ---------------------------------------------------------------- signs (Ukrainian, one atlas) + door plates (one atlas)
  const WORDS = ['ЛІФТ', 'ВИХІД', 'УКРИТТЯ', 'СХОДИ', 'ВИЇЗД', "В'ЇЗД", 'ПАРКІНГ −1', 'ВІДСІК №1', 'ВІДСІК №2', 'ЗАРЯДКА ЕЛЕКТРОМОБІЛІВ', ...B_IDS.map(id => 'БУДИНОК ' + BUILDINGS[id].no), ...new Set(rowSigns.map(r => r.text))];
  const GREEN = new Set(['ВИХІД', 'УКРИТТЯ', 'СХОДИ', 'ВИЇЗД', 'ЗАРЯДКА ЕЛЕКТРОМОБІЛІВ']);
  const sQ = new Quads(), sBack = new KIT.Batch();
  {
    const rowsN = Math.ceil(WORDS.length / 2), cv = canvas(1024, rowsN * 64), g = cv.getContext('2d');
    WORDS.forEach((t, i) => { const x = (i % 2) * 512, y = ((i / 2) | 0) * 64; g.fillStyle = GREEN.has(t) ? '#12703f' : '#15171a'; g.fillRect(x, y, 512, 64); g.fillStyle = GREEN.has(t) ? '#0e5a32' : '#c9a45c'; g.fillRect(x, y + 58, 512, 6);
      g.fillStyle = '#f6f3ec'; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 40; g.font = `700 ${fs}px ${SANS}`; while (g.measureText(t).width > 480 && fs > 18) { fs -= 2; g.font = `700 ${fs}px ${SANS}`; } g.fillText(t, x + 256, y + 30); });
    const sMat = basic({ map: tex(cv), color: new T.Color(1.2, 1.2, 1.2) }, 'wayfinding');
    var sign = (label, x, y, z, n, w = 1.6) => { const i = WORDS.indexOf(label); if (i < 0) return; const h = w / 8, t = [n[1], -n[0]], P = (a, e) => [x + t[0] * a * w / 2 + n[0] * 0.026, y + e * h / 2, z + t[1] * a * w / 2 + n[1] * 0.026];
      const u0 = (i % 2) / 2, u1 = u0 + 0.5, v1 = 1 - ((i / 2) | 0) / rowsN, v0 = v1 - 1 / rowsN; sQ.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [n[0], 0, n[1]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      const g2 = new T.BoxGeometry(w + 0.06, h + 0.06, 0.04); sBack.add(MT.frame, g2, mat4(x, y, z, Math.atan2(n[0], n[1]))); };
    var hang = (label, x, z, n, w = 2.0) => { const y = H - 0.55; for (const s of [-1, 1]) sign(label, x, y, z, [n[0] * s, n[1] * s], w); const t = [n[1], -n[0]]; for (const s of [-1, 1]) sBack.add(MT.steel, new T.BoxGeometry(0.02, 0.5, 0.02), mat4(x + t[0] * s * w * 0.4, H - 0.27, z + t[1] * s * w * 0.4)); };
    var flushSigns = () => { if (!sQ.empty) { const m = new T.Mesh(sQ.geo(), sMat); m.name = 'vrc-pk-signs'; m.matrixAutoUpdate = false; W.add(m); ownGeo.push(m.geometry); } sBack.flush(W); };
  }
  for (const rs of rowSigns) if (Lay.inHall(rs.x, rs.z) && !inHole(rs.x, rs.z)) hang(rs.text, rs.x, rs.z, rs.n, 2.4);
  for (const L of Lay.lifts) sign('ЛІФТ', L.x + L.n[0] * (FACE + 0.02), LIFT_H + 0.22, L.z + L.n[1] * (FACE + 0.02), L.n, 0.9);
  for (const id of Object.keys(byB)) {       // one call plate per tower beside its first lift, the tower's name over it
    const L = byB[id][0], t = [-L.n[1], L.n[0]], k = Math.min(L.hw - 0.12, L.half + 0.32), px = L.x + t[0] * k + L.n[0] * (FACE + 0.02), pz = L.z + t[1] * k + L.n[1] * (FACE + 0.02);
    try { KIT.callPlate(wctx, px, 1.12, pz, Math.atan2(L.n[0], L.n[1]), { type: 'liftCall', building: id, stair: 1 }); } catch (e) { console.warn('[parking] call plate', e); }
    sign('БУДИНОК ' + BUILDINGS[id].no, L.x + L.n[0] * (FACE + 0.02), LIFT_H + 0.48, L.z + L.n[1] * (FACE + 0.02), L.n, 1.3);
  }
  // at every open door between a hall and a tower's lobby: «БУДИНОК N» + «ЛІФТ» on the hall side, «ВИХІД» inside
  const towerOf = p => { let best = null; for (const L of Lay.lifts) { const d = hyp([L.x, L.z], p); if (!best || d < best.d) best = { d, id: L.id }; } return best && best.d < 30 ? best.id : null; };
  for (const d of PARKING.doors) if (d.open) {
    const ax = d.axis === 'x', off = (ax ? d.z1 - d.z0 : d.x1 - d.x0) / 2 + 0.03;
    for (const s of [-1, 1]) { const n = ax ? [0, s] : [s, 0], p = [d.c[0] + n[0] * off, d.c[1] + n[1] * off], q = [d.c[0] + n[0] * 0.9, d.c[1] + n[1] * 0.9], hall = Lay.inHall(q[0], q[1]);
      if (d.fire) { sign(q[0] < PARKING.fireGate.a[0] ? 'ВІДСІК №2' : 'ВІДСІК №1', p[0], DOOR_H + 0.22, p[1], n, 1.1); continue; }
      if (!d.toHall) continue;
      if (hall) { const id = towerOf(d.c); if (id) { sign('БУДИНОК ' + BUILDINGS[id].no, p[0], DOOR_H + 0.42, p[1], n, 1.3); sign('ЛІФТ', p[0], DOOR_H + 0.2, p[1], n, 0.9); } }
      else sign('ВИХІД', p[0], DOOR_H + 0.2, p[1], n, 0.9); }
  }
  { const F = PARKING.fireGate, x = F.a[0]; sign('ВІДСІК №1', x + 0.23, 2.8, F.p[1], [1, 0], 2.2); sign('ВІДСІК №2', x - 0.23, 2.8, F.p[1], [-1, 0], 2.2); }
  for (const R of RP) {
    const r = R.r, c = (r.kerbs.outer + r.kerbs.ped) / 2, dn = R.z ? [0, -R.up] : [-R.up, 0];       // dn = direction of travel going down
    { const p = R.P(R.gate - R.up * 0.02, c); sign('ВИЇЗД', p[0], H - 0.2, p[1], dn, 2.4); }                                    // over the foot, read from the hall
    { const p = R.P(R.gate - R.up * 5.5, c); if (Lay.inHall(p[0], p[1])) hang('ВИЇЗД', p[0], p[1], dn, 2.2); }
    if (PARKING.shelter) { const p = R.P(R.gate - R.up * 3.4, r.pedStrip[1] > r.kerbs.ped ? r.pedStrip[0] - 1.6 : r.pedStrip[1] + 1.6); if (Lay.inHall(p[0], p[1])) hang('УКРИТТЯ', p[0], p[1], dn, 1.8); }
    { const a = R.top + R.up * 1.55, yT = R.yAt(R.top) + CLEAR + 0.2, p = R.P(a, c); sign('ПАРКІНГ −1', p[0], yT, p[1], [-dn[0], -dn[1]], 2.6);
      const p5 = R.P(a, R.c0 + 0.6), p2 = R.P(a, R.c1 - 0.6), up = [-dn[0], -dn[1]]; pictoWall(2, p5[0] + up[0] * 0.03, yT, p5[1] + up[1] * 0.03, up, 0.38); pictoWall(3, p2[0] + up[0] * 0.03, yT, p2[1] + up[1] * 0.03, up, 0.38); }
    { const p = R.P(R.gate - R.up * 0.4, R.c1 - 0.01), n = R.z ? [-1, 0] : [0, -1]; pictoWall(2, p[0], 1.9, p[1], n, 0.5); }
  }
  for (const d of PARKING.doors) if (!d.open && d.toHall) {       // shelter rooms are reached through these doors
    const rm = PARKING.rooms.find(r => d.rooms.includes(r.no) && r.kind === 'shelter'); if (!rm) continue;
    const ax = d.axis === 'x', off = (ax ? d.z1 - d.z0 : d.x1 - d.x0) / 2 + 0.03; for (const s of [-1, 1]) { const n = ax ? [0, s] : [s, 0], q = [d.c[0] + n[0] * 0.9, d.c[1] + n[1] * 0.9]; if (Lay.inHall(q[0], q[1])) sign('УКРИТТЯ', d.c[0] + n[0] * off, DOOR_H + 0.2, d.c[1] + n[1] * off, n, 1.1); }
  }
  { // «ЗАРЯДКА ЕЛЕКТРОМОБІЛІВ» over the aisles of the west hall
    const ev = PARKING.aisles.filter(a => PARKING.bays.some(b => b.aisle === a.id && b.charger)).slice(0, 4);
    for (const a of ev) { const m = a.pts[a.pts.length >> 1], p = a.pts[Math.max(0, (a.pts.length >> 1) - 1)], d = [m[0] - p[0], m[1] - p[1]], L = Math.hypot(...d) || 1; if (Lay.inHall(m[0], m[1]) && !inHole(m[0], m[1])) hang('ЗАРЯДКА ЕЛЕКТРОМОБІЛІВ', m[0], m[1], [d[0] / L, d[1] / L], 2.6); }
  }
  if (!pictoQ.empty) { const m = new T.Mesh(pictoQ.geo(), pictoMat); m.name = 'vrc-pk-picto'; m.matrixAutoUpdate = false; W.add(m); ownGeo.push(m.geometry); }
  if (!pictoWQ.empty) { const pm = own(pictoMat.clone()); pm.side = T.FrontSide; pm.polygonOffset = false; pm.name = 'vrc-pk-picto-wall'; const m = new T.Mesh(pictoWQ.geo(), pm); m.name = 'vrc-pk-picto-wall'; m.matrixAutoUpdate = false; W.add(m); ownGeo.push(m.geometry); }
  flushSigns();
  if (plates.length) {       // room plates: number of the drawing + name
    const uniq = [...new Map(plates.map(p => [p.text + '|' + p.sub, p])).values()], cols = 6, rows = Math.ceil(uniq.length / cols), cw = 256, chh = 96, cv = canvas(cols * cw, rows * chh), g = cv.getContext('2d');
    uniq.forEach((p, i) => { const x = (i % cols) * cw, y = ((i / cols) | 0) * chh; g.fillStyle = '#f1efe9'; g.fillRect(x, y, cw, chh); g.fillStyle = '#15171a'; g.fillRect(x, y, cw, 6); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 44px ${SANS}`; g.fillText(p.text, x + cw / 2, y + 38); let fs = 20; g.font = `500 ${fs}px ${SANS}`; while (g.measureText(p.sub).width > cw - 16 && fs > 10) { fs -= 1; g.font = `500 ${fs}px ${SANS}`; } g.fillStyle = '#4a4f55'; g.fillText(p.sub, x + cw / 2, y + 76); });
    const pm = basic({ map: tex(cv), color: new T.Color(1.05, 1.05, 1.05) }, 'roomplates'), q = new Quads();
    for (const p of plates) { const i = uniq.findIndex(u => u.text === p.text && u.sub === p.sub), w = p.w, h = w * chh / cw, t = [p.n[1], -p.n[0]], P = (a, e) => [p.x + t[0] * a * w / 2 + p.n[0] * 0.012, p.y + e * h / 2, p.z + t[1] * a * w / 2 + p.n[1] * 0.012];
      const u0 = (i % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - ((i / cols) | 0) / rows, v0 = v1 - 1 / rows; q.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [p.n[0], 0, p.n[1]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]); }
    const m = new T.Mesh(q.geo(), pm); m.name = 'vrc-pk-plates'; m.matrixAutoUpdate = false; W.add(m); ownGeo.push(m.geometry);
  }

  B.flush(W); C.flush(W); wctx.signB.flush(W);
  for (const m of topB.flush(W, { ceiling: true }) || []) m.userData.ceiling = true;

  // ---------------------------------------------------------------- cars: placed by the cars module (hook), none here
  ctx.parkedCars = []; ctx.carInstances = null;
  try {
    const cars = KIT.cars;
    // optional hook (not used today: walk.js / cars.js put the cars into PARKING.bays themselves with cars.parkingCars(PARKING.bays))
    if (cars && typeof cars.parkingScene === 'function') { const r = cars.parkingScene(PARKING, { bId, world: W, y: 0, floorY: floorY(bId, -1) }); if (r) { if (r.group && !r.group.parent) W.add(r.group); ctx.parkedCars = r.list || r.cars || []; ctx.carInstances = r.instances || r.carInstances || null; } }
  } catch (e) { console.warn('[parking] cars hook', e); }

  // ---------------------------------------------------------------- light: an even fill (the level is lit by its LED lines) + the shared rig near the walker
  // V11: the even fill (sky 0xffffff / ground 0xdcdcda, 0.62) is folded into the rig's hemisphere light below (0.22 + 0.62, colours
  // weighted in linear light = the same light as the two lights it replaces) — a separate HemisphereLight changed the scene's light
  // count and recompiled every shader program (≈ 60) on the way into the car park.
  const FILL = 0.62, RIGH = 0.22, hemiCol = { sky: new T.Color(0xfff1dc).multiplyScalar(RIGH).add(new T.Color(0xffffff).multiplyScalar(FILL)).multiplyScalar(1 / (FILL + RIGH)),
    ground: new T.Color(0x3b342c).multiplyScalar(RIGH).add(new T.Color(0xdcdcda).multiplyScalar(FILL)).multiplyScalar(1 / (FILL + RIGH)) };
  const sp = Lay.spawns[bId], loc = (x, z) => worldToLocal(bId, x, z);
  const spots = [];
  { const [x, z] = loc(sp.x, sp.z); spots.push([x, 2.5, z, 6, 0xf2f4ff, 22]); }
  if (sp.door) { const [x, z] = loc(sp.door.c[0] - sp.n[0] * 2.2, sp.door.c[1] - sp.n[1] * 2.2); spots.push([x, 2.4, z, 5, 0xffe6c4, 9]); }
  for (const L of (byB[bId] || []).slice(0, 1)) { const [x, z] = loc(L.x + L.n[0] * 1.4, L.z + L.n[1] * 1.4); spots.push([x, 2.4, z, 5, 0xffe6c4, 9]); }
  { const [x, z] = loc(sp.x + sp.n[0] * 9, sp.z + sp.n[1] * 9); spots.push([x, 2.5, z, 5, 0xf2f4ff, 22]); }
  try { KIT.claimRig(ctx.root, spots.slice(0, 4), RIGH + FILL, hemiCol); } catch (e) { console.warn('[parking] lights', e); }

  const [spx, spz] = loc(sp.x, sp.z);
  const res = KIT.finish(ctx, { x: spx, z: spz, yaw: sp.yaw - rotY });
  res.parking = {
    places: PARKING.places, motoPlaces: PARKING.motoPlaces,
    bays: PARKING.bays.map(b => ({ id: b.id, no: b.id, x: b.x, z: b.z, yaw: b.yaw, axis: Math.abs(b.front[0]) > 0.5 ? 'x' : 'z', length: b.l, width: b.w, dir: b.front, kind: b.kind, cls: b.cls, accessible: b.accessible, ev: b.ev })),
    spawns: Object.fromEntries(Object.entries(Lay.spawns).map(([k, s]) => [k, { x: s.x, z: s.z, yaw: s.yaw }])), world: W, ceiling: H, rampFloors,
    stands: panoStands(Lay),
  };
  if (res.parkedCars == null) res.parkedCars = ctx.parkedCars;
  if (res.carInstances === undefined) res.carInstances = ctx.carInstances || null;
  res.rooms = RS;          // V10: doors that open + lazily built rooms (walk.js: rooms.attach / rooms.tick)
  const d0 = res.dispose ? res.dispose.bind(res) : () => {};
  res.dispose = () => { RS.dispose(); d0(); for (const m of ownMat) m.dispose(); for (const g of ownGeo) g.dispose(); for (const t of ownTex) t.dispose(); };
  return res;
}

// Stand points for the "360° real" panoramas of the car park (world x/z, ≤ 12): one per lift lobby door (hall side), one per
// main aisle section, the fire gate and the two ramp feet. Used by pano-work/export.html.
export function panoStands(Lay = LAY) {
  const out = [], far = (p, d) => out.every(o => Math.hypot(o.x - p[0], o.z - p[1]) > d);
  const add = (id, p, kind, name) => { if (parkingDrivable(p[0], p[1], 0.45)) out.push({ id, x: +p[0].toFixed(2), z: +p[1].toFixed(2), kind, name }); };
  if (Lay) for (const id of B_IDS) { const s = Lay.spawns[id]; if (s) add('lobby-' + id, [s.x, s.z], 'lobby', 'Ліфтовий хол, будинок ' + BUILDINGS[id].no); }
  { const F = PARKING.fireGate; add('gate', [F.p[0] + 3.2, F.p[1]], 'gate', 'Ворота між відсіками'); }
  for (const r of RAMPS) if (r.foot) { const d = r.dirUp; add('ramp-' + r.id, [r.foot[0] - d[0] * 7.5, r.foot[2] - d[1] * 7.5], 'ramp', 'Рампа ' + r.id.slice(1)); }
  const As = PARKING.aisles.map(a => { let L = 0; for (let i = 0; i + 1 < a.pts.length; i++) L += Math.hypot(a.pts[i + 1][0] - a.pts[i][0], a.pts[i + 1][1] - a.pts[i][1]); return { a, L }; }).sort((p, q) => q.L - p.L);
  for (const { a, L } of As) { if (out.length >= 12 || L < 14) break; let acc = 0, mid = null; for (let i = 0; i + 1 < a.pts.length && !mid; i++) { const l = Math.hypot(a.pts[i + 1][0] - a.pts[i][0], a.pts[i + 1][1] - a.pts[i][1]); if (acc + l >= L / 2) { const t = (L / 2 - acc) / l; mid = [a.pts[i][0] + (a.pts[i + 1][0] - a.pts[i][0]) * t, a.pts[i][1] + (a.pts[i + 1][1] - a.pts[i][1]) * t]; } acc += l; }
    if (mid && far(mid, 11)) add('aisle-' + a.id, mid, 'aisle', 'Проїзд ' + a.id); }
  return out.slice(0, 12);
}
