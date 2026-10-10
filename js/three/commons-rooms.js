// ЖК VILNYI — every door of the common areas opens, and behind it is the room of the drawing (task V10-doors).
//
//   import { RoomSet } from './commons-rooms.js';
//   const rs = new RoomSet(KIT, parent, { bId, floor, H });     // parent: the builder's frame (y = 0 = this level's floor)
//   rs.addRoom({ id, no, name, kind, poly, h, enclose, stair, doors… })   rs.addDoor({ id, a, b, n, h, kind, … })
//   result.rooms = rs;                                            // walk.js: rs.attach(hooks), rs.tick(worldPos)
//
// Doors: hinged leaves (single or double) that swing to the side the drawing shows, as a pivot Object3D carrying
// `userData.action = { type: 'roomDoor', onClick }` and a body mesh with `userData.solid` (false while open) and
// `userData.toggle(open)` — walk.js taps them through its generic action path and collides with closed leaves.
// Rooms: the contents (equipment, furniture, lights, signs, stairs) are built LAZILY when the visitor comes near a room
// (or opens its door) and disposed again when he is far; one merged mesh per material + chunked colliders per room.
// Enclosure (floor, ceiling, walls with door gaps) is built here only where the builder has no walls of its own (floors ≥ 1);
// the car park's rooms are walled by the drawing already.
// Everything lives in the parent's frame (metres, x/z of the plan, y up from this level's floor).
import * as THREE from 'three';
import { PLAY } from './furniture.js';

const TAU = Math.PI * 2;
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function inPoly(p, x, z) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
export const bboxOf = p => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const area2 = p => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a; };
export const areaOf = p => Math.abs(area2(p)) / 2;
const boxDist = (b, x, z) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
const rectPoly = r => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const hashStr = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// ============================================================ room kinds (from the names printed on the drawings)
// kind → what is behind the door. Used by the builders to classify a room by its drawn name.
export function kindOfName(name) {
  const n = String(name || '').toLowerCase();
  if (/укрит/.test(n)) return 'shelter';
  if (/санвуз|убир|wc/.test(n)) return 'wc';
  if (/сход/.test(n)) return 'stair';
  if (/ітп|тепл/.test(n)) return 'heat';
  if (/резервуар/.test(n)) return 'fireTank';
  if (/насосн|водопровод/.test(n)) return 'pump';
  if (/венткам|вентиляц/.test(n)) return 'vent';
  if (/щитов|камера ео|електр/.test(n)) return 'elec';
  if (/апг|аспг|спринкл/.test(n)) return 'asp';
  if (/сз|зв'яз|кл ?0|комунікац/.test(n)) return 'comms';
  if (/підлогомий|прибирал/.test(n)) return 'cleaning';
  if (/пожежний пост/.test(n)) return 'firePost';
  if (/охорон|консьєрж/.test(n)) return 'security';
  if (/колясоч|велосип/.test(n)) return 'stroller';
  if (/басейн/.test(n)) return 'pool';
  if (/резерв|комор|сховищ/.test(n)) return 'storage';
  if (/тамбур|коридор|хол/.test(n)) return 'passage';
  return 'tech';
}

// ============================================================ materials (module cache; shared, never disposed)
const MATS = {};
const sm = o => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, ...o });
const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
function tileTex(base, joint, n) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128); g.fillStyle = joint; const s = 128 / n;
  for (let i = 0; i <= n; i++) { g.fillRect(i * s - 1, 0, 2, 128); g.fillRect(0, i * s - 1, 128, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function meshTex() {   // wire mesh of storage cages / fan guards
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64); g.strokeStyle = '#c9cdd0'; g.lineWidth = 3; for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function RM(key) {
  if (MATS[key]) return MATS[key];
  const uvm = (m, s) => { m.userData.uv = s; return m; };
  const mk = {
    wall: () => sm({ color: 0xe7e5df, roughness: 0.92, emissive: glow(0xe7e5df, 0.16) }),
    wallShelter: () => sm({ color: 0xd5dbd0, roughness: 0.9, emissive: glow(0xd5dbd0, 0.17) }),
    wallTile: () => uvm(sm({ map: tileTex('#eef0ee', '#c7cdcb', 6), roughness: 0.3, emissive: glow(0xeeeeee, 0.13), emissiveMap: null }), 0.9),
    wallStair: () => sm({ color: 0xece8e0, roughness: 0.9, emissive: glow(0xece8e0, 0.2) }),
    floor: () => sm({ color: 0x8e9396, roughness: 0.42 }),
    floorShelter: () => sm({ color: 0x8d968c, roughness: 0.5 }),
    floorTile: () => uvm(sm({ map: tileTex('#b9bcbb', '#8d9190', 4), roughness: 0.4 }), 1.2),
    rubberMat: () => sm({ color: 0x1d1f21, roughness: 0.95 }),
    ceiling: () => sm({ color: 0xdedcd6, roughness: 0.95, emissive: glow(0xdedcd6, 0.14) }),
    concrete: () => sm({ color: 0xbab6ae, roughness: 0.88, emissive: glow(0xbab6ae, 0.12) }),
    tread: () => sm({ color: 0xa8a39a, roughness: 0.55, emissive: glow(0xa8a39a, 0.1) }),
    nosing: () => sm({ color: 0x2a2b2d, roughness: 0.8 }),
    steel: () => sm({ color: 0xa9abad, metalness: 0.9, roughness: 0.32 }),
    galv: () => sm({ color: 0xc3c7ca, metalness: 0.45, roughness: 0.45, emissive: glow(0xc3c7ca, 0.05) }),
    frame: () => sm({ color: 0x2b2d30, metalness: 0.5, roughness: 0.55 }),
    doorSteel: () => sm({ color: 0x5f666e, metalness: 0.35, roughness: 0.5 }),
    doorFire: () => sm({ color: 0x8d2a22, metalness: 0.3, roughness: 0.52 }),
    doorShelter: () => sm({ color: 0x56604f, metalness: 0.45, roughness: 0.45 }),
    doorTech: () => sm({ color: 0x8d9399, metalness: 0.35, roughness: 0.5 }),
    seal: () => sm({ color: 0x141516, roughness: 0.9 }),
    cabinet: () => sm({ color: 0xcfd1cc, roughness: 0.5, metalness: 0.15, emissive: glow(0xcfd1cc, 0.05) }),
    cabinetDark: () => sm({ color: 0x3d4146, roughness: 0.55, metalness: 0.3 }),
    black: () => sm({ color: 0x17181a, roughness: 0.6 }),
    screen: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.32, 0.5) }),
    red: () => sm({ color: 0xc0261e, roughness: 0.45 }),
    white: () => sm({ color: 0xf2f1ee, roughness: 0.4, emissive: glow(0xf2f1ee, 0.08) }),
    pipeRed: () => sm({ color: 0xa3261d, roughness: 0.5 }),
    pipeBlue: () => sm({ color: 0x2f5f9e, roughness: 0.5 }),
    pipeGreen: () => sm({ color: 0x2f7d4a, roughness: 0.5 }),
    pipeInsul: () => sm({ color: 0xd7d8d2, metalness: 0.55, roughness: 0.38 }),
    pipeYellow: () => sm({ color: 0xd8b42a, roughness: 0.5 }),
    tankBlue: () => sm({ color: 0x2c5aa0, roughness: 0.4 }),
    tankWhite: () => sm({ color: 0xe9e9e4, roughness: 0.4 }),
    pumpBlue: () => sm({ color: 0x1f4f8f, metalness: 0.3, roughness: 0.45 }),
    pumpGreen: () => sm({ color: 0x2d6b45, metalness: 0.3, roughness: 0.45 }),
    wood: () => sm({ color: 0x9a7048, roughness: 0.6 }),
    mattress: () => sm({ color: 0x2f415e, roughness: 0.9 }),
    blanket: () => sm({ color: 0x6b7a56, roughness: 0.95 }),
    ceramic: () => sm({ color: 0xf7f7f5, roughness: 0.14 }),
    mirror: () => sm({ color: 0x9aa3a8, metalness: 1, roughness: 0.06 }),
    yellow: () => sm({ color: 0xe2b51e, roughness: 0.5 }),
    carton: () => sm({ color: 0xa98457, roughness: 0.9 }),
    fabric1: () => sm({ color: 0x3b4b63, roughness: 0.9 }), fabric2: () => sm({ color: 0x7b4a3f, roughness: 0.9 }), fabric3: () => sm({ color: 0x5b6b4b, roughness: 0.9 }),
    tyre: () => sm({ color: 0x151515, roughness: 0.85 }),
    cage: () => { const m = sm({ map: meshTex(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 }); m.userData.uv = 0.5; return m; },
    glass: () => sm({ color: 0xc9d6d4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }),
    led: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.3, 2.15) }),
    ledWarm: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.85, 1.35) }),
    ledGreen: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 0.8) }),
    ledRed: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.3, 0.25) }),
    daylight: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.4, 2.5) }),
    signs: () => new THREE.MeshBasicMaterial({ map: signAtlas().tex, color: new THREE.Color(1.1, 1.1, 1.1), transparent: true, alphaTest: 0.1 }),
  };
  const m = mk[key](); m.name = 'vrc-rm-' + key; MATS[key] = m; return m;
}

// ============================================================ signs (Ukrainian, one atlas)
const SIGN_WORDS = [
  ['УКРИТТЯ', '#12703f', '#ffffff'], ['ПРИМІЩЕННЯ УКРИТТЯ', '#12703f', '#ffffff'], ['ВИХІД', '#12703f', '#ffffff'], ['ЗАПАСНИЙ ВИХІД', '#12703f', '#ffffff'],
  ['АПТЕЧКА', '#f4f4f2', '#c8231d'], ['ПИТНА ВОДА', '#1f5fa8', '#ffffff'], ['ФІЛЬТРОВЕНТИЛЯЦІЯ', '#f4f4f2', '#15171a'], ['ОБЕРЕЖНО! НАПРУГА', '#f2c318', '#15171a'],
  ['ВОГНЕГАСНИК', '#c8231d', '#ffffff'], ['ПОЖЕЖНИЙ КРАН', '#c8231d', '#ffffff'], ['СХОДИ', '#12703f', '#ffffff'], ['НЕ ПАЛИТИ', '#c8231d', '#ffffff'],
  ['СТОРОННІМ ВХІД ЗАБОРОНЕНО', '#f2c318', '#15171a'], ['ПАРКІНГ −1', '#15171a', '#f6f3ec'], ['ПОКРІВЛЯ', '#15171a', '#f6f3ec'],
  ['ВУЛИЦЯ', '#12703f', '#ffffff'], ['МІСЦЕ ДЛЯ ВІДПОЧИНКУ', '#f4f4f2', '#15171a'], ['ЗАПАС ВОДИ', '#1f5fa8', '#ffffff'],
  ['ВЕНТКАМЕРА', '#f4f4f2', '#15171a'], ['ЕЛЕКТРОЩИТОВА', '#f2c318', '#15171a'], ['НАСОСНА', '#f4f4f2', '#15171a'], ['ІТП', '#f4f4f2', '#15171a'],
  ...Array.from({ length: 17 }, (_, i) => ['ПОВЕРХ ' + (i + 1), '#15171a', '#f6f3ec']),
  ...[1, 2, 3, 4].map(n => ['БУДИНОК ' + n, '#15171a', '#c9a45c']),
];
let ATLAS = null;
function signAtlas() {
  if (ATLAS) return ATLAS;
  const rows = Math.ceil(SIGN_WORDS.length / 2), c = document.createElement('canvas'); c.width = 1024; c.height = 2 ** Math.ceil(Math.log2(rows * 64));
  const g = c.getContext('2d'), SANS = '"Helvetica Neue", Arial, sans-serif';
  g.clearRect(0, 0, c.width, c.height);
  SIGN_WORDS.forEach(([t, bg, fg], i) => {
    const x = (i % 2) * 512, y = ((i / 2) | 0) * 64; g.fillStyle = bg; g.fillRect(x + 2, y + 2, 508, 60); g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 2; g.strokeRect(x + 6, y + 6, 500, 52); g.globalAlpha = 1;
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 38; g.font = `700 ${fs}px ${SANS}`; while (g.measureText(t).width > 470 && fs > 14) { fs -= 2; g.font = `700 ${fs}px ${SANS}`; } g.fillText(t, x + 256, y + 33);
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  ATLAS = { tex, rows, h: c.height, uv(word) { const i = SIGN_WORDS.findIndex(w => w[0] === word); if (i < 0) return null; const u0 = (i % 2) / 2, v1 = 1 - ((i / 2) | 0) * 64 / c.height; return [u0, v1 - 64 / c.height, 0.5, 64 / c.height]; } };
  return ATLAS;
}
export const hasSign = w => SIGN_WORDS.some(s => s[0] === w);
function signGeo(word, w) {
  const at = signAtlas(), uv = at.uv(word); if (!uv) return null;
  const g = new THREE.PlaneGeometry(w, w / 8), a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * uv[2], uv[1] + a.getY(i) * uv[3]); return g;
}

// ============================================================ local drawing frame: o on a wall, n into the room, u along it
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
const M4 = (x, y, z, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(1, 1, 1));
class Drawer {
  // B: KIT.Batch, C: KIT.Colliders; the frame: origin o, inward unit normal n; u = (n.z, −n.x); local (a, y, d) → o + u·a + n·d
  constructor(B, C, o, n) { this.B = B; this.C = C; this.o = o; this.n = n; this.u = [n[1], -n[0]]; this.yaw = Math.atan2(n[0], n[1]); this.ortho = Math.abs(Math.sin(2 * this.yaw)) < 1e-3; }
  P(a, d) { return [this.o[0] + this.u[0] * a + this.n[0] * d, this.o[1] + this.u[1] * a + this.n[1] * d]; }
  // V19: a tap target with its own play (built after the room's batch: running water, flush), in the room's frame
  play(kind, a, y, d, o = {}) { if (CUR_PLAYS) { const [x, z] = this.P(a, d); CUR_PLAYS.push({ kind, x, y, z, yaw: this.yaw, o }); } }
  _mat(m) { return typeof m === 'string' ? RM(m) : m; }
  geo(m, g, a, y, d, extraYaw = 0, rx = 0, rz = 0) { const [x, z] = this.P(a, d); this.B.add(this._mat(m), g, M4(x, y, z, this.yaw + extraYaw, rx, rz)); }
  box(m, a0, a1, y0, y1, d0, d1, solid = false) {
    const g = new THREE.BoxGeometry(Math.max(1e-3, Math.abs(a1 - a0)), Math.max(1e-3, Math.abs(y1 - y0)), Math.max(1e-3, Math.abs(d1 - d0)));
    this.geo(m, g, (a0 + a1) / 2, (y0 + y1) / 2, (d0 + d1) / 2);
    if (solid) this.solid(a0, a1, y0, y1, d0, d1);
  }
  solid(a0, a1, y0, y1, d0, d1) {
    if (!this.C) return;
    if (this.ortho) { const p = this.P(a0, d0), q = this.P(a1, d1); this.C.box(Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1])); return; }
    const g = new THREE.BoxGeometry(Math.abs(a1 - a0), Math.abs(y1 - y0), Math.abs(d1 - d0)), [x, z] = this.P((a0 + a1) / 2, (d0 + d1) / 2); g.applyMatrix4(M4(x, (y0 + y1) / 2, z, this.yaw)); this.C.geoSolid(g);
  }
  cyl(m, a, d, y0, y1, r, seg = 14, solid = false) { const g = new THREE.CylinderGeometry(r, r, Math.abs(y1 - y0), seg); this.geo(m, g, a, (y0 + y1) / 2, d); if (solid) this.solid(a - r, a + r, y0, y1, d - r, d + r); }
  hcylU(m, a0, a1, y, d, r, seg = 10) { const g = new THREE.CylinderGeometry(r, r, Math.abs(a1 - a0), seg); g.rotateZ(Math.PI / 2); this.geo(m, g, (a0 + a1) / 2, y, d); }   // along u
  hcylN(m, a, y, d0, d1, r, seg = 10) { const g = new THREE.CylinderGeometry(r, r, Math.abs(d1 - d0), seg); g.rotateX(Math.PI / 2); this.geo(m, g, a, y, (d0 + d1) / 2); }   // along n
  ring(m, a, y, d, R, r, faceU = false) { const g = new THREE.TorusGeometry(R, r, 8, 24); if (faceU) g.rotateY(Math.PI / 2); this.geo(m, g, a, y, d); }        // in the (u, y) plane, or (n, y)
  sign(word, a, y, d, w = 0.9) { const g = signGeo(word, w); if (g) this.geo(RM('signs'), g, a, y, d); }
}

// ============================================================ equipment catalogue (w along the wall, d into the room)
// draw(D, a): the item centred at `a` along the wall, standing at the wall (d = 0 … d). H = room height.
const PIPE_COL = { heat: ['pipeRed', 'pipeBlue'], pump: ['pipeRed', 'pipeBlue'], pool: ['pipeGreen', 'pipeBlue'], asp: ['pipeRed', 'pipeRed'], tech: ['pipeInsul', 'pipeBlue'] };
const ITEMS = {
  bench: { w: 1.7, d: 0.44, draw(D, a) { D.box('wood', a - 0.85, a + 0.85, 0.42, 0.47, 0.05, 0.44); D.box('wood', a - 0.85, a + 0.85, 0.66, 0.8, 0.02, 0.06); D.box('wood', a - 0.85, a + 0.85, 0.86, 0.98, 0.02, 0.06);
    for (const s of [-0.75, 0.75]) { D.box('steel', a + s - 0.025, a + s + 0.025, 0, 0.42, 0.08, 0.12); D.box('steel', a + s - 0.025, a + s + 0.025, 0, 0.42, 0.38, 0.42); }
    D.solid(a - 0.85, a + 0.85, 0, 0.5, 0, 0.44); } },
  bunk: { w: 1.98, d: 0.86, draw(D, a, ctx) { const L = 0.98, r = ctx.rnd;
    for (const sa of [-L + 0.03, L - 0.03]) for (const sd of [0.05, 0.82]) D.box('galv', a + sa - 0.025, a + sa + 0.025, 0, 1.82, sd - 0.025, sd + 0.025);
    for (const y of [0.38, 1.22]) { D.box('galv', a - L, a + L, y, y + 0.05, 0.03, 0.84); D.box('mattress', a - L + 0.05, a + L - 0.05, y + 0.05, y + 0.17, 0.07, 0.8);
      D.box('white', a - L + 0.08, a - L + 0.48, y + 0.17, y + 0.26, 0.15, 0.72); D.box(['blanket', 'fabric1', 'fabric3'][(r() * 3) | 0], a + L - 0.6, a + L - 0.1, y + 0.17, y + 0.27, 0.1, 0.77); }
    for (let k = 0; k < 4; k++) D.box('galv', a + L - 0.05, a + L - 0.02, 0.5 + k * 0.22, 0.52 + k * 0.22, 0.86, 0.9);
    D.solid(a - L, a + L, 0, 1.85, 0, 0.88); } },
  waterTank: { w: 1.0, d: 0.72, draw(D, a) { D.box('tankBlue', a - 0.45, a + 0.45, 0.06, 1.32, 0.06, 0.68); D.box('frame', a - 0.48, a + 0.48, 0, 0.06, 0.04, 0.7);
    D.cyl('tankBlue', a, 0.37, 1.32, 1.4, 0.14); D.box('steel', a + 0.3, a + 0.36, 0.25, 0.3, 0.68, 0.78); D.sign('ПИТНА ВОДА', a, 1.62, 0.012, 0.8); D.solid(a - 0.5, a + 0.5, 0, 1.4, 0, 0.72); } },
  waterBottles: { w: 1.2, d: 0.46, draw(D, a) { ITEMS.shelf.frame(D, a, 1.2, 0.46, 4); for (const y of [0.06, 0.52, 0.98]) for (let k = 0; k < 4; k++) for (const dd of [0.13, 0.33]) D.cyl('tankBlue', a - 0.45 + k * 0.3, dd, y, y + 0.36, 0.1, 10);
    D.sign('ЗАПАС ВОДИ', a, 1.72, 0.012, 0.75); D.solid(a - 0.6, a + 0.6, 0, 1.9, 0, 0.46); } },
  firstAid: { w: 0.6, d: 0.22, wall: true, draw(D, a) { D.box('white', a - 0.27, a + 0.27, 1.15, 1.7, 0.01, 0.18, true); D.box('red', a - 0.04, a + 0.04, 1.3, 1.55, 0.18, 0.19); D.box('red', a - 0.12, a + 0.12, 1.39, 1.46, 0.18, 0.19); D.sign('АПТЕЧКА', a, 1.86, 0.012, 0.6); } },
  extinguisher: { w: 0.4, d: 0.26, draw(D, a) { D.cyl('red', a, 0.13, 0.05, 0.62, 0.09, 12); D.cyl('black', a, 0.13, 0.62, 0.7, 0.03, 8); D.box('black', a - 0.02, a + 0.02, 0.6, 0.72, 0.05, 0.2); D.box('frame', a - 0.12, a + 0.12, 0, 0.05, 0.02, 0.24); D.sign('ВОГНЕГАСНИК', a, 1.05, 0.012, 0.42); D.solid(a - 0.12, a + 0.12, 0, 0.7, 0, 0.24); } },
  fvu: { w: 1.4, d: 0.78, draw(D, a, ctx) { D.box('cabinet', a - 0.65, a + 0.65, 0.08, 1.45, 0.05, 0.75); D.box('frame', a - 0.67, a + 0.67, 0, 0.08, 0.04, 0.76);
    D.box('cabinetDark', a - 0.6, a - 0.02, 0.2, 1.35, 0.75, 0.76); D.box('cabinetDark', a + 0.02, a + 0.6, 0.2, 1.35, 0.75, 0.76); D.cyl('galv', a + 0.3, 0.4, 1.45, ctx.H, 0.17, 16); D.cyl('pumpGreen', a - 0.3, 0.4, 1.45, 1.75, 0.24, 18);
    D.ring('steel', a - 0.4, 0.95, 0.79, 0.13, 0.015); D.box('steel', a - 0.42, a - 0.38, 0.85, 1.05, 0.76, 0.8); D.sign('ФІЛЬТРОВЕНТИЛЯЦІЯ', a, Math.min(ctx.H - 0.25, 2.0), 0.012, 1.1); D.solid(a - 0.7, a + 0.7, 0, 1.8, 0, 0.78); } },
  shelf: { w: 1.2, d: 0.46, frame(D, a, w, d, n) { for (const sa of [-w / 2 + 0.02, w / 2 - 0.02]) for (const sd of [0.03, d - 0.03]) D.box('galv', a + sa - 0.02, a + sa + 0.02, 0, 1.9, sd - 0.02, sd + 0.02); for (let k = 0; k < n; k++) { const y = 0.04 + k * 0.46; D.box('galv', a - w / 2, a + w / 2, y, y + 0.02, 0.01, d); } },
    draw(D, a, ctx) { this.frame(D, a, 1.2, 0.46, 5); const r = ctx.rnd; for (let k = 0; k < 4; k++) { const y = 0.06 + k * 0.46; let x = a - 0.55; while (x < a + 0.5) { const w = 0.18 + r() * 0.25; if (x + w > a + 0.57) break; if (r() > 0.2) D.box(r() > 0.3 ? 'carton' : 'cabinetDark', x, x + w, y, y + 0.14 + r() * 0.24, 0.06, 0.4); x += w + 0.03; } }
    D.solid(a - 0.6, a + 0.6, 0, 1.9, 0, 0.46); } },
  cage: { w: 1.6, d: 1.1, draw(D, a) { const A = a - 0.8, Bb = a + 0.8; for (const [p, q] of [[A, A + 0.03], [Bb - 0.03, Bb]]) D.box('galv', p, q, 0, 2.2, 0.0, 1.1); D.box('galv', A, Bb, 2.17, 2.2, 0, 1.1);
    D.geo('cage', new THREE.PlaneGeometry(1.0, 2.15), a - 0.3, 1.08, 1.1); D.box('galv', a + 0.2, a + 0.24, 0, 2.2, 1.07, 1.11); D.box('galv', A, a + 0.22, 0, 0.04, 1.07, 1.11);
    for (const s of [A, Bb]) { const g = new THREE.PlaneGeometry(1.1, 2.15); D.geo('cage', g, s, 1.08, 0.55, Math.PI / 2); }
    D.box('carton', a - 0.6, a - 0.15, 0, 0.45, 0.15, 0.6); D.box('carton', a - 0.6, a - 0.25, 0.45, 0.75, 0.2, 0.55); D.solid(A, Bb, 0, 2.2, 0, 1.12); } },
  toilet: { w: 0.55, d: 0.72, draw(D, a) { D.box('ceramic', a - 0.18, a + 0.18, 0.15, 0.85, 0.02, 0.2); D.box('ceramic', a - 0.12, a + 0.12, 0, 0.38, 0.2, 0.6); D.box('ceramic', a - 0.19, a + 0.19, 0.36, 0.42, 0.2, 0.68); D.box('white', a - 0.19, a + 0.19, 0.42, 0.44, 0.22, 0.66); D.solid(a - 0.2, a + 0.2, 0, 0.6, 0, 0.68);
    D.box('steel', a - 0.09, a + 0.09, 0.95, 1.07, 0.2, 0.208); D.box('white', a - 0.085, a - 0.003, 0.955, 1.065, 0.208, 0.212); D.box('white', a + 0.003, a + 0.085, 0.955, 1.065, 0.208, 0.212);   // V19: dual flush plate
    D.play('flush', a, 1.01, 0.21, { w: 0.22, h: 0.16, dd: 0.06 }); } },
  // V19: a real wash basin — a ceramic rim around a recessed oval bowl with a chrome waste, the tap runs at a tap
  sink: { w: 0.6, d: 0.5, draw(D, a) {
    D.box('ceramic', a - 0.27, a + 0.27, 0.8, 0.86, 0.02, 0.1); D.box('ceramic', a - 0.27, a + 0.27, 0.8, 0.86, 0.42, 0.48);
    D.box('ceramic', a - 0.27, a - 0.21, 0.8, 0.86, 0.1, 0.42); D.box('ceramic', a + 0.21, a + 0.27, 0.8, 0.86, 0.1, 0.42);
    const bowl = new THREE.LatheGeometry([[0.001, 0], [0.12, 0.005], [0.2, 0.05], [0.215, 0.12], [0.22, 0.125]].map(([x, y]) => new THREE.Vector2(x, y)), 28); bowl.scale(1, 1, 0.75);
    D.geo('ceramic', bowl, a, 0.735, 0.26); D.cyl('steel', a, 0.26, 0.735, 0.742, 0.022, 16); D.cyl('black', a, 0.26, 0.733, 0.738, 0.03, 16);
    D.box('ceramic', a - 0.06, a + 0.06, 0.1, 0.74, 0.03, 0.15); D.box('steel', a - 0.02, a + 0.02, 0.86, 1.02, 0.06, 0.1); D.box('steel', a - 0.02, a + 0.02, 0.99, 1.02, 0.06, 0.22);
    D.box('mirror', a - 0.27, a + 0.27, 1.12, 1.75, 0.005, 0.015); D.solid(a - 0.28, a + 0.28, 0.7, 0.9, 0, 0.48);
    D.play('tap', a, 0.99, 0.2, { drop: 0.99 - 0.745, w: 0.36, h: 0.32, dd: 0.4, y0: 0.74, dc: 0.24 }); } },
  cubicle: { w: 1.0, d: 1.5, draw(D, a) { for (const s of [-0.49, 0.49]) D.box('cabinetDark', a + s - 0.015, a + s + 0.015, 0.15, 2.0, 0.0, 1.45, true); ITEMS.toilet.draw(D, a); } },
  pump: { w: 0.85, d: 0.8, draw(D, a, ctx) { const c = ctx.pipes || ['pipeRed', 'pipeBlue']; D.box('concrete', a - 0.4, a + 0.4, 0, 0.12, 0.12, 0.72); D.cyl(ctx.rnd() > 0.5 ? 'pumpBlue' : 'pumpGreen', a, 0.42, 0.12, 0.62, 0.17, 16); D.cyl('pumpBlue', a, 0.42, 0.62, 0.98, 0.12, 14);
    D.hcylU(c[0], a - 0.4, a - 0.1, 0.32, 0.42, 0.06); D.hcylU(c[0], a + 0.1, a + 0.4, 0.32, 0.42, 0.06); D.cyl(c[0], a - 0.38, 0.42, 0.32, ctx.H - 0.35, 0.055); D.cyl(c[1], a + 0.38, 0.42, 0.32, ctx.H - 0.5, 0.055);
    D.ring('red', a - 0.38, 1.2, 0.42, 0.09, 0.012, true); D.solid(a - 0.42, a + 0.42, 0, 1.0, 0.1, 0.75); } },
  pumpSet: { w: 2.1, d: 0.95, draw(D, a, ctx) { const c = ctx.pipes || ['pipeRed', 'pipeRed']; D.box('frame', a - 1.0, a + 1.0, 0, 0.14, 0.15, 0.9);
    for (const s of [-0.5, 0.5]) { D.cyl('red', a + s, 0.5, 0.14, 0.7, 0.2, 16); D.cyl('cabinetDark', a + s, 0.5, 0.7, 1.15, 0.15, 14); }
    D.hcylU(c[0], a - 1.0, a + 1.0, 1.4, 0.5, 0.08); D.hcylU(c[0], a - 1.0, a + 1.0, 0.35, 0.22, 0.08); for (const s of [-1.0, 1.0]) D.cyl(c[0], a + s, 0.5, 0.35, ctx.H - 0.3, 0.08);
    for (const s of [-0.5, 0.5]) { D.cyl(c[0], a + s, 0.5, 1.15, 1.4, 0.06); D.ring('red', a + s, 1.62, 0.5, 0.1, 0.012, true); }
    D.box('cabinet', a + 0.75, a + 1.05, 1.3, 1.9, 0.01, 0.2); D.solid(a - 1.05, a + 1.05, 0, 1.5, 0.1, 0.95); } },
  hx: { w: 0.7, d: 1.0, draw(D, a, ctx) { const c = ctx.pipes || ['pipeRed', 'pipeBlue']; D.box('cabinetDark', a - 0.32, a + 0.32, 0, 1.45, 0.08, 0.16); D.box('cabinetDark', a - 0.32, a + 0.32, 0, 1.45, 0.86, 0.94);
    D.box('steel', a - 0.26, a + 0.26, 0.15, 1.3, 0.16, 0.86); for (let k = 0; k < 4; k++) D.box('cabinetDark', a - 0.3, a + 0.3, 0.12 + k * 0.4, 0.15 + k * 0.4, 0.15, 0.87);
    for (const [s, y] of [[-0.15, 0.35], [0.15, 0.35], [-0.15, 1.15], [0.15, 1.15]]) { D.hcylN('pipeInsul', a + s, y, -0.05, 0.08, 0.06); D.cyl(y > 1 ? c[0] : c[1], a + s, 0.03, y, ctx.H - 0.4, 0.05); }
    D.solid(a - 0.33, a + 0.33, 0, 1.5, 0, 1.0); } },
  expTank: { w: 0.75, d: 0.75, draw(D, a) { for (const s of [-0.18, 0.18]) D.box('frame', a + s - 0.02, a + s + 0.02, 0, 0.2, 0.2, 0.55); D.cyl('red', a, 0.38, 0.2, 1.2, 0.3, 18); D.cyl('red', a, 0.38, 1.2, 1.3, 0.2, 14); D.solid(a - 0.32, a + 0.32, 0, 1.3, 0.05, 0.7); } },
  boiler: { w: 1.0, d: 1.0, draw(D, a, ctx) { D.cyl('pipeInsul', a, 0.5, 0.05, 2.0, 0.44, 22); D.cyl('pipeInsul', a, 0.5, 2.0, 2.08, 0.3, 18); D.cyl('pipeRed', a + 0.25, 0.5, 2.08, ctx.H - 0.3, 0.05); D.hcylN('pipeBlue', a - 0.3, 0.45, 0.1, 0.5, 0.05);
    D.box('cabinet', a - 0.12, a + 0.12, 1.1, 1.35, 0.93, 0.96); D.solid(a - 0.46, a + 0.46, 0, 2.1, 0.04, 0.96); } },
  ctrl: { w: 0.7, d: 0.28, wall: true, draw(D, a) { D.box('cabinet', a - 0.3, a + 0.3, 1.05, 1.9, 0.01, 0.26, true); D.box('cabinetDark', a - 0.005, a + 0.005, 1.08, 1.87, 0.26, 0.265);
    D.box('ledGreen', a - 0.2, a - 0.16, 1.75, 1.78, 0.26, 0.27); D.box('ledRed', a - 0.12, a - 0.08, 1.75, 1.78, 0.26, 0.27); D.box('ledWarm', a - 0.04, a, 1.75, 1.78, 0.26, 0.27); D.box('cabinetDark', a - 0.03, a + 0.03, 0.2, 1.05, 0.06, 0.12); } },
  panel: { w: 0.82, d: 0.48, draw(D, a) { D.box('cabinet', a - 0.4, a + 0.4, 0.1, 2.0, 0.02, 0.45); D.box('frame', a - 0.4, a + 0.4, 0, 0.1, 0.02, 0.45); D.box('cabinetDark', a - 0.005, a + 0.005, 0.15, 1.95, 0.45, 0.455);
    for (const s of [-0.1, 0.1]) D.box('steel', a + s - 0.01, a + s + 0.01, 1.0, 1.15, 0.45, 0.47); D.box('ledGreen', a - 0.3, a - 0.26, 1.82, 1.85, 0.45, 0.46); D.box('ledRed', a - 0.22, a - 0.18, 1.82, 1.85, 0.45, 0.46);
    D.box('yellow', a - 0.09, a + 0.09, 1.45, 1.6, 0.455, 0.46); D.solid(a - 0.41, a + 0.41, 0, 2.0, 0, 0.47); } },
  rack: { w: 0.65, d: 0.85, draw(D, a) { D.box('black', a - 0.3, a + 0.3, 0, 2.0, 0.03, 0.82); D.box('glass', a - 0.28, a + 0.28, 0.05, 1.95, 0.82, 0.83); for (let k = 0; k < 12; k++) D.box(k % 3 ? 'cabinetDark' : 'ledGreen', a - 0.24, a - 0.2 + (k % 3 ? 0.4 : 0.02), 0.25 + k * 0.13, 0.27 + k * 0.13, 0.78, 0.8); D.solid(a - 0.31, a + 0.31, 0, 2.0, 0, 0.84); } },
  ahu: { w: 2.6, d: 1.05, draw(D, a, ctx) { D.box('frame', a - 1.28, a + 1.28, 0, 0.12, 0.05, 1.0); D.box('cabinet', a - 1.25, a + 1.25, 0.12, 1.6, 0.06, 0.99);
    for (const s of [-0.62, 0, 0.62]) D.box('cabinetDark', a + s - 0.01, a + s + 0.01, 0.12, 1.6, 0.99, 1.0); for (const s of [-0.95, -0.3, 0.3, 0.95]) D.box('steel', a + s - 0.012, a + s + 0.012, 0.75, 0.95, 0.99, 1.02);
    D.box('galv', a + 0.5, a + 1.1, 1.6, ctx.H, 0.3, 0.75); D.box('galv', a - 1.1, a - 0.5, 1.6, 1.9, 0.3, 0.75); D.box('galv', a - 1.1, a - 0.5, 1.9, ctx.H, 0.02, 0.4);
    D.sign('ВЕНТКАМЕРА', a - 0.2, 1.3, 1.0, 0.9); D.solid(a - 1.3, a + 1.3, 0, 1.65, 0, 1.03); } },
  fan: { w: 1.0, d: 1.0, draw(D, a, ctx) { D.box('frame', a - 0.45, a + 0.45, 0, 0.1, 0.1, 0.9); D.hcylN('galv', a, 0.62, 0.15, 0.85, 0.42, 22); D.hcylN('cabinetDark', a, 0.62, 0.84, 0.88, 0.3, 18); D.geo('cage', new THREE.CircleGeometry(0.4, 18), a, 0.62, 0.88);
    D.box('galv', a - 0.25, a + 0.25, 1.04, ctx.H, 0.25, 0.75); D.solid(a - 0.46, a + 0.46, 0, 1.06, 0.08, 0.92); } },
  valveStation: { w: 1.2, d: 0.6, draw(D, a, ctx) { for (const s of [-0.3, 0.3]) { D.cyl('pipeRed', a + s, 0.32, 0, ctx.H, 0.085, 14); D.ring('red', a + s, 1.15, 0.45, 0.13, 0.016); D.hcylN('red', a + s, 1.15, 0.32, 0.45, 0.02); D.cyl('red', a + s, 0.32, 0.8, 1.0, 0.13, 14); D.cyl('white', a + s + 0.12, 0.35, 1.5, 1.58, 0.05, 12); }
    D.hcylU('pipeRed', a - 0.6, a + 0.6, 0.45, 0.32, 0.07); D.solid(a - 0.5, a + 0.5, 0, 1.6, 0.2, 0.55); } },
  reservoir: null,   // special: fireTank rooms
  scrubber: { w: 0.8, d: 1.25, draw(D, a) { D.box('yellow', a - 0.36, a + 0.36, 0.12, 0.95, 0.15, 1.1); D.box('black', a - 0.25, a + 0.25, 0.95, 1.05, 0.5, 0.95); D.box('black', a - 0.36, a + 0.36, 0, 0.12, 0.1, 1.2);
    D.box('steel', a - 0.03, a + 0.03, 0.95, 1.3, 1.05, 1.1); D.box('black', a - 0.2, a + 0.2, 1.25, 1.3, 1.04, 1.12); D.solid(a - 0.38, a + 0.38, 0, 1.1, 0.05, 1.22); } },
  stroller: { w: 0.62, d: 0.95, draw(D, a, ctx) { const f = ['fabric1', 'fabric2', 'fabric3'][(ctx.rnd() * 3) | 0];
    for (const s of [-0.24, 0.24]) for (const dd of [0.15, 0.78]) D.ring('tyre', a + s, 0.12, dd, 0.1, 0.025, true);
    D.box('frame', a - 0.25, a + 0.25, 0.2, 0.24, 0.15, 0.78); D.box(f, a - 0.24, a + 0.24, 0.45, 0.78, 0.22, 0.8); D.box(f, a - 0.24, a + 0.24, 0.78, 0.95, 0.62, 0.8); D.box('frame', a - 0.22, a + 0.22, 1.0, 1.03, 0.05, 0.08); D.box('frame', a - 0.22, a - 0.2, 0.24, 1.02, 0.07, 0.25); D.box('frame', a + 0.2, a + 0.22, 0.24, 1.02, 0.07, 0.25);
    D.solid(a - 0.28, a + 0.28, 0, 1.0, 0.02, 0.9); } },
  bikeRack: { w: 2.3, d: 1.75, draw(D, a) { D.box('galv', a - 1.1, a + 1.1, 0, 0.05, 0.3, 0.4);
    for (const s of [-0.75, 0, 0.75]) { const x = a + s; D.box('galv', x - 0.02, x + 0.02, 0, 0.45, 0.25, 0.45); D.ring('tyre', x, 0.34, 0.4, 0.31, 0.025, true); D.ring('tyre', x, 0.34, 1.4, 0.31, 0.025, true);
      D.box('frame', x - 0.02, x + 0.02, 0.38, 0.42, 0.42, 1.38); D.box('frame', x - 0.02, x + 0.02, 0.4, 0.9, 0.8, 0.84); D.box('black', x - 0.07, x + 0.07, 0.9, 0.95, 0.72, 0.95); D.box('frame', x - 0.25, x + 0.25, 0.95, 0.98, 1.27, 1.31); }
    D.solid(a - 1.15, a + 1.15, 0, 1.0, 0, 1.75); } },
  desk: { w: 1.5, d: 1.35, draw(D, a) { D.box('wood', a - 0.72, a + 0.72, 0.72, 0.76, 0.02, 0.72); for (const s of [-0.68, 0.68]) D.box('cabinetDark', a + s - 0.025, a + s + 0.025, 0, 0.72, 0.05, 0.69);
    for (const s of [-0.3, 0.3]) { D.box('black', a + s - 0.27, a + s + 0.27, 0.86, 1.2, 0.18, 0.21); D.box('screen', a + s - 0.25, a + s + 0.25, 0.88, 1.18, 0.211, 0.214); D.box('black', a + s - 0.02, a + s + 0.02, 0.76, 0.88, 0.17, 0.2); }
    D.box('black', a - 0.22, a + 0.22, 0.76, 0.78, 0.38, 0.52); D.box('black', a - 0.25, a + 0.25, 0.42, 0.5, 0.85, 1.25); D.box('black', a - 0.25, a + 0.25, 0.5, 1.05, 1.2, 1.25); D.cyl('frame', a, 1.05, 0, 0.42, 0.03, 8);
    D.solid(a - 0.74, a + 0.74, 0, 0.78, 0, 0.74); D.solid(a - 0.27, a + 0.27, 0, 0.6, 0.85, 1.27); } },
  locker: { w: 0.92, d: 0.52, draw(D, a) { D.box('cabinet', a - 0.45, a + 0.45, 0, 1.9, 0.02, 0.5); for (const s of [-0.15, 0.15]) D.box('cabinetDark', a + s - 0.005, a + s + 0.005, 0.05, 1.85, 0.5, 0.505); for (const s of [-0.38, -0.08, 0.22]) D.box('steel', a + s, a + s + 0.12, 1.0, 1.02, 0.5, 0.52); D.solid(a - 0.46, a + 0.46, 0, 1.9, 0, 0.52); } },
  firePanel: { w: 0.7, d: 0.2, wall: true, draw(D, a) { D.box('red', a - 0.3, a + 0.3, 1.15, 1.8, 0.01, 0.15, true); D.box('black', a - 0.22, a + 0.22, 1.5, 1.7, 0.15, 0.155); for (let k = 0; k < 6; k++) D.box(k % 2 ? 'ledGreen' : 'ledRed', a - 0.2 + k * 0.07, a - 0.17 + k * 0.07, 1.3, 1.33, 0.15, 0.16); } },
  hoseCab: { w: 0.8, d: 0.26, wall: true, draw(D, a) { D.box('red', a - 0.35, a + 0.35, 0.65, 1.55, 0.01, 0.24, true); D.box('glass', a - 0.3, a + 0.3, 0.7, 1.5, 0.24, 0.245); D.ring('red', a, 1.1, 0.13, 0.2, 0.05); D.sign('ПОЖЕЖНИЙ КРАН', a, 1.72, 0.012, 0.7); } },
  poolFilter: { w: 1.05, d: 1.05, draw(D, a, ctx) { D.cyl('tankBlue', a, 0.52, 0.15, 1.45, 0.42, 22); D.cyl('tankBlue', a, 0.52, 1.45, 1.55, 0.28, 18); for (const s of [-0.18, 0.18]) D.box('frame', a + s - 0.03, a + s + 0.03, 0, 0.15, 0.25, 0.8);
    D.hcylN('pipeGreen', a - 0.25, 0.6, 0.0, 0.2, 0.06); D.cyl('pipeGreen', a - 0.25, 0.08, 0.6, ctx.H - 0.45, 0.06); D.cyl('white', a + 0.15, 0.52, 1.55, 1.68, 0.06, 12); D.solid(a - 0.45, a + 0.45, 0, 1.6, 0.08, 0.96); } },
  chemTank: { w: 0.7, d: 0.7, draw(D, a) { D.cyl('tankWhite', a, 0.35, 0, 1.0, 0.28, 18); D.cyl('pumpBlue', a, 0.35, 1.0, 1.12, 0.08, 10); D.box('yellow', a - 0.1, a + 0.1, 0.6, 0.75, 0.63, 0.64); D.solid(a - 0.3, a + 0.3, 0, 1.12, 0.05, 0.65); } },
  tray: null,
};

// which equipment each kind of room receives (tried in order; `more` repeats while there is room)
const PLANS = {
  shelter: { first: ['fvu', 'waterTank', 'firstAid', 'extinguisher', 'waterBottles'], more: ['bunk', 'bench'], wall: 'wallShelter', floor: 'floorShelter' },
  wc: { first: [], more: [], wall: 'wallTile', floor: 'floorTile' },
  heat: { first: ['hx', 'hx', 'boiler', 'expTank', 'ctrl'], more: ['pump'], deco: 'pipes' },
  pump: { first: ['pumpSet', 'pumpSet', 'expTank', 'ctrl', 'boiler'], more: ['pump'], deco: 'pipes' },
  fireTank: { first: [], more: [] },
  vent: { first: ['ahu', 'fan', 'ctrl'], more: ['fan'], deco: 'ducts' },
  elec: { first: ['ctrl'], more: ['panel'], deco: 'trays', mat: true },
  asp: { first: ['valveStation', 'valveStation', 'ctrl', 'extinguisher'], more: [], deco: 'pipes' },
  comms: { first: ['rack', 'rack', 'panel', 'ctrl'], more: ['rack'], deco: 'trays' },
  cleaning: { first: ['scrubber', 'shelf', 'sink'], more: ['shelf'] },
  storage: { first: ['shelf'], more: ['shelf', 'cage'] },
  security: { first: ['desk', 'locker', 'extinguisher', 'shelf'], more: [] },
  firePost: { first: ['desk', 'firePanel', 'locker', 'extinguisher', 'shelf'], more: [] },
  stroller: { first: ['bikeRack'], more: ['stroller'] },
  pool: { first: ['poolFilter', 'poolFilter', 'poolFilter', 'pump', 'pump', 'chemTank', 'chemTank', 'ctrl'], more: ['pump'], deco: 'pipes' },
  tech: { first: ['ctrl', 'shelf', 'panel', 'pump'], more: [], deco: 'pipes' },
  passage: { first: ['extinguisher'], more: [] },
};

// ============================================================ occupancy grid (keeps every room walkable while furnishing)
class Grid {
  constructor(poly, holes, cs) {
    const b = bboxOf(poly); this.b = b; this.cs = cs; this.nx = Math.max(1, Math.ceil((b.x1 - b.x0) / cs)); this.nz = Math.max(1, Math.ceil((b.z1 - b.z0) / cs));
    const N = this.nx * this.nz; this.block = new Uint8Array(N);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) { const [x, z] = this.c(i, j); this.block[j * this.nx + i] = inPoly(poly, x, z) && !(holes || []).some(h => inPoly(h, x, z)) ? 0 : 1; }
    this.dist = new Float32Array(N);
  }
  c(i, j) { return [this.b.x0 + (i + 0.5) * this.cs, this.b.z0 + (j + 0.5) * this.cs]; }
  idx(x, z) { const i = Math.floor((x - this.b.x0) / this.cs), j = Math.floor((z - this.b.z0) / this.cs); return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i; }
  // cells of a convex quad footprint
  cellsOf(q) { const bb = bboxOf(q), out = []; const i0 = Math.max(0, Math.floor((bb.x0 - this.b.x0) / this.cs)), i1 = Math.min(this.nx - 1, Math.floor((bb.x1 - this.b.x0) / this.cs)), j0 = Math.max(0, Math.floor((bb.z0 - this.b.z0) / this.cs)), j1 = Math.min(this.nz - 1, Math.floor((bb.z1 - this.b.z0) / this.cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const [x, z] = this.c(i, j); if (inPoly(q, x, z)) out.push(j * this.nx + i); } return out; }
  // distance (m) of every free cell to the nearest blocked cell (8-neighbour BFS ≈ Chebyshev, conservative)
  clearance() {
    const { nx, nz } = this, N = nx * nz, d = this.dist, q = new Int32Array(N); let h = 0, t = 0;
    for (let k = 0; k < N; k++) { if (this.block[k]) { d[k] = 0; q[t++] = k; } else d[k] = 1e9; }
    // border of the grid counts as blocked
    for (let i = 0; i < nx; i++) for (const j of [0, nz - 1]) { const k = j * nx + i; if (d[k] > 1) { d[k] = 1; q[t++] = k; } }
    for (let j = 0; j < nz; j++) for (const i of [0, nx - 1]) { const k = j * nx + i; if (d[k] > 1) { d[k] = 1; q[t++] = k; } }
    while (h < t) { const k = q[h++], i = k % nx, j = (k / nx) | 0, v = d[k] + 1; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const kk = jj * nx + ii; if (d[kk] > v) { d[kk] = v; q[t++] = kk; } } }
    return d;
  }
  // flood over cells with clearance ≥ r from `start` cell; returns Uint8Array mask
  reach(start, r) {
    const { nx, nz } = this, need = r / this.cs + 0.5, d = this.dist, seen = new Uint8Array(nx * nz); if (start < 0 || d[start] < need) return seen;
    const q = [start]; seen[start] = 1;
    while (q.length) { const k = q.pop(), i = k % nx, j = (k / nx) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const kk = jj * nx + ii; if (!seen[kk] && d[kk] >= need) { seen[kk] = 1; q.push(kk); } } }
    return seen;
  }
  nearestClear(x, z, r, maxD = 0.9) { const need = r / this.cs + 0.5; let best = -1, bd = 1e9; const k0 = this.idx(x, z); const R = Math.ceil(maxD / this.cs), i0 = Math.floor((x - this.b.x0) / this.cs), j0 = Math.floor((z - this.b.z0) / this.cs);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue; const k = j * this.nx + i; if (this.dist[k] < need) continue; const dd = di * di + dj * dj; if (dd < bd) { bd = dd; best = k; } }
    return best >= 0 ? best : (k0 >= 0 && this.dist[k0] >= need ? k0 : -1); }
}

// ============================================================ swinging doors
let DOOR_SEQ = 0;
export class SwingDoor {
  // spec: { id, a: [x, z] hinge jamb, b: [x, z] other jamb, n: [nx, nz] side the leaf swings to, y0 = 0, h = 2.1, wallT = 0.2,
  //         kind: 'steel'|'fire'|'shelter'|'tech'|'walnut', double: bool, open: bool, rooms: [from, to], label, go: fn | null }
  constructor(set, spec) {
    this.set = set; this.spec = spec; this.id = spec.id || 'door-' + (++DOOR_SEQ); this.open = false; this.anim = null;
    const T = THREE, K = set.K, a = spec.a, b = spec.b, n = spec.n, L = hyp(a, b), y0 = spec.y0 || 0, h = spec.h || 2.1;
    this.c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; this.n = n; this.w = L; this.y0 = y0; this.h = h;
    // sides: [room id on the −sideN side, room id on the +sideN side] (sideN: unit normal of the wall; default: the swing side)
    this.sideN = spec.sideN || n; this.sides = spec.sides || [null, spec.into || (spec.rooms || [])[0] || null];
    const kind = spec.kind || 'steel', thick = kind === 'shelter' ? 0.1 : kind === 'walnut' ? 0.05 : 0.06;
    const body = kind === 'walnut' ? K.M('walnutDoor') : RM(kind === 'fire' ? 'doorFire' : kind === 'shelter' ? 'doorShelter' : kind === 'tech' ? 'doorTech' : 'doorSteel');
    const hw = kind === 'walnut' ? K.M('brass') : RM('steel');
    const leaves = spec.double ? [[a, b, L / 2], [b, a, L / 2]] : [[a, b, L]];
    const off = Math.max(0, (spec.wallT ?? 0.2) / 2 - thick / 2 - 0.01);       // the leaf hangs at the face of the wall on its swing side
    this.leaves = [];
    for (const [p, q, len] of leaves) {
      const u = [(q[0] - p[0]) / hyp(p, q), (q[1] - p[1]) / hyp(p, q)];
      const pivot = new T.Object3D(); pivot.name = 'vrc-room-door'; pivot.position.set(p[0] + n[0] * off, y0, p[1] + n[1] * off);
      const phi0 = Math.atan2(-u[1], u[0]);                                    // local +x → u
      // rotation.y = +π/2 maps (x, z) → (z, −x): u → (u.z, −u.x); open with the sign whose image points along n
      const s = (u[1] * n[0] + -u[0] * n[1]) > 0 ? 1 : -1;
      pivot.rotation.y = phi0;
      const key = `${kind}|${len.toFixed(2)}|${h.toFixed(2)}|${spec.double ? 1 : 0}`;
      const [gb, gh] = set.leafGeo(key, () => leafGeometry(kind, len - 0.012, h - 0.012, thick));
      const mb = new T.Mesh(gb, body), mh = new T.Mesh(gh, hw);
      mb.name = 'vrc-room-door-leaf'; mh.name = 'vrc-room-door-hw';
      mb.position.z = 0; mh.position.z = 0;
      pivot.add(mb); pivot.add(mh);
      pivot.userData.action = { type: 'roomDoor', id: this.id, onClick: () => this.click() };
      const tog = open => this.toggle(open);
      mb.userData.toggle = tog; pivot.userData.toggle = tog; mb.userData.roomDoor = this.id; mb.userData.sharedGeo = mh.userData.sharedGeo = true;
      mb.userData.solid = true;
      this.leaves.push({ pivot, mb, mh, phi0, s });
      set.doorGroup.add(pivot);
    }
    if (spec.open) this.toggle(true, true);
  }
  get busy() { return !!this.anim; }
  inwardFor(r) { const id = r && (r.id ?? r), s = this.sides[1] === id ? 1 : this.sides[0] === id ? -1 : 1; return [this.sideN[0] * s, this.sideN[1] * s]; }
  click() { if (this.spec.go) { this.toggle(true); setTimeout(() => { try { this.spec.go(); } catch (e) { console.warn('[rooms] go', e); } }, 260); return; } return this.toggle(); }
  toggle(want, instant = false) {
    want = want == null ? !this.open : !!want;
    if (want === this.open && !this.anim) return Promise.resolve();
    if (!want && this.set.playerNear(this.c, 0.62)) return Promise.resolve();                 // never close a leaf onto the visitor
    if (want) this.set.onDoorOpen(this);
    this.open = want;
    for (const l of this.leaves) l.mb.userData.solid = !want;
    const to = want ? 1 : 0;
    if (instant) { this._apply(to); this.k = to; this.anim = null; return Promise.resolve(); }
    const from = this.k ?? (want ? 0 : 1), t0 = performance.now(), ms = 650;
    return new Promise(res => {
      const step = () => { const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; this.k = from + (to - from) * e; this._apply(this.k);
        if (k < 1 && !this.set.disposed) this.anim = requestAnimationFrame(step); else { this.anim = null; res(); } };
      if (this.anim) cancelAnimationFrame(this.anim); step();
    });
  }
  _apply(k) { for (const l of this.leaves) { l.pivot.rotation.y = l.phi0 + l.s * k * 1.55; l.pivot.updateMatrixWorld(true); } }
}
// leaf geometry: local x from 0 (hinge) to len, y from 0 to h, z centred (thickness t). Two geometries: body, hardware.
function leafGeometry(kind, len, h, t) {
  const T = THREE, body = [], hw = [], bx = (arr, x0, x1, y0, y1, z0, z1) => { const g = new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); arr.push(g); };
  bx(body, 0.006, len, 0.008, h, -t / 2, t / 2);
  const hx = len - 0.1;
  for (const s of [-1, 1]) {
    if (kind === 'shelter') {   // steel protective door: wheel + two lever clamps on each face, hinges
      const z = s * (t / 2 + 0.04), w = new T.TorusGeometry(0.17, 0.014, 6, 20); w.translate(len / 2, 1.2, z); hw.push(w);
      for (let k = 0; k < 3; k++) { const sp = new T.BoxGeometry(0.34, 0.018, 0.018); sp.rotateZ(k * Math.PI / 3); sp.translate(len / 2, 1.2, z); hw.push(sp); }
      bx(hw, len / 2 - 0.03, len / 2 + 0.03, 1.17, 1.23, s > 0 ? t / 2 : z, s > 0 ? z : -t / 2);
      for (const y of [0.45, 1.75]) { bx(hw, hx - 0.03, hx + 0.03, y - 0.13, y + 0.13, s > 0 ? t / 2 : -t / 2 - 0.05, s > 0 ? t / 2 + 0.05 : -t / 2); bx(hw, hx - 0.16, hx + 0.02, y + 0.09, y + 0.13, s > 0 ? t / 2 + 0.03 : -t / 2 - 0.06, s > 0 ? t / 2 + 0.06 : -t / 2 - 0.03); }
      bx(hw, 0.02, len - 0.02, 0.02, 0.05, s * t / 2 - 0.004, s * t / 2 + 0.004);
    } else {   // lever handle + escutcheon
      bx(hw, hx - 0.018, hx + 0.018, 0.92, 1.12, s > 0 ? t / 2 : -t / 2 - 0.008, s > 0 ? t / 2 + 0.008 : -t / 2);
      bx(hw, hx - 0.14, hx + 0.015, 1.02, 1.045, s > 0 ? t / 2 + 0.045 : -t / 2 - 0.065, s > 0 ? t / 2 + 0.065 : -t / 2 - 0.045);
      bx(hw, hx - 0.012, hx + 0.012, 1.02, 1.045, s > 0 ? t / 2 + 0.008 : -t / 2 - 0.05, s > 0 ? t / 2 + 0.05 : -t / 2 - 0.008);
      if (kind === 'fire' && s > 0) bx(hw, 0.08, 0.5, h - 0.09, h - 0.04, t / 2, t / 2 + 0.05);   // closer
    }
  }
  for (const y of [0.25, h - 0.3]) bx(hw, -0.012, 0.012, y, y + 0.12, -t / 2 - 0.01, t / 2 + 0.01);   // hinges
  const merge = arr => { const g = mergeBoxes(arr); arr.forEach(x => x.dispose()); return g; };
  return [merge(body), merge(hw)];
}
function mergeBoxes(list) {   // tiny merge (position, normal, uv; indexed → non-indexed)
  const T = THREE, pos = [], nor = [], uv = [];
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); } if (g !== g0) g.dispose(); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

// ============================================================ the set of doors + rooms of one commons level
export class RoomSet {
  constructor(KIT, parent, opts = {}) {
    this.K = KIT; this.parent = parent; this.bId = opts.bId; this.floor = opts.floor; this.H = opts.H || 2.6;
    this.rooms = []; this.doors = []; this.hooks = null; this.disposed = false; this.player = null; this.geos = new Map();
    this.doorGroup = new THREE.Group(); this.doorGroup.name = 'vrc-room-doors'; parent.add(this.doorGroup);
    this.near = opts.near ?? 9; this.far = opts.far ?? 22; this._v = new THREE.Vector3(); this.stats = { built: 0, dropped: 0 };
  }
  leafGeo(key, make) { if (!this.geos.has(key)) this.geos.set(key, make()); return this.geos.get(key); }
  // room: { id, no, name, kind, poly, holes?, h, y0 = 0, enclose = false, inner?: [x, z], stair?: {...}, wallMat?, levels? }
  addRoom(spec) {
    const r = { ...spec, kind: spec.kind || kindOfName(spec.name), doors: [], group: null, built: false };
    r.bbox = bboxOf(r.poly); r.area = areaOf(r.poly); r.y0 = r.y0 || 0; r.h = r.h || this.H;
    if (r.stair) { r.ylo = -(r.stair.down || 0) - 0.3; r.yhi = (r.stair.up || 0) + r.h; } else { r.ylo = r.y0; r.yhi = r.y0 + r.h; }
    this.rooms.push(r); return r;
  }
  addDoor(spec) {
    const d = new SwingDoor(this, spec); d.rooms = (spec.rooms || d.sides).filter(Boolean).map(id => this.rooms.find(r => r.id === id) || null);
    for (const r of d.rooms) if (r) r.doors.push(d);
    d.label = spec.label || null; d.into = spec.into ? this.rooms.find(r => r.id === spec.into) || null : d.rooms.find(r => r) || null;
    this.doors.push(d); return d;
  }
  roomById(id) { return this.rooms.find(r => r.id === id) || null; }
  // ---- walk.js interface
  attach(hooks) { this.hooks = hooks || null; if (this.hooks) for (const r of this.rooms) if (r.built && this.hooks.add) this.hooks.add(r.group); }
  tick(worldPos) {
    if (this.disposed || !worldPos) return;
    const p = this.parent.worldToLocal(this._v.copy(worldPos)); this.player = [p.x, p.y, p.z];
    for (const r of this.rooms) {
      const dy = p.y < r.ylo ? r.ylo - p.y : p.y > r.yhi ? p.y - r.yhi : 0, d = Math.hypot(boxDist(r.bbox, p.x, p.z), dy);
      if (!r.built && d < this.near) this.build(r);
      else if (r.built && d > this.far && !r.keep) this.drop(r);
    }
  }
  inStair(worldPos) { const p = this.parent.worldToLocal(this._v.copy(worldPos)); return this.rooms.some(r => r.stair && p.x > r.stair.rect.x0 && p.x < r.stair.rect.x1 && p.z > r.stair.rect.z0 && p.z < r.stair.rect.z1); }
  playerNear(c, r) { const p = this.player; return !!p && Math.hypot(p[0] - c[0], p[2] - c[1]) < r && Math.abs(p[1] - 0) < 3; }
  onDoorOpen(d) { for (const r of d.rooms || []) if (r && !r.built) this.build(r); }
  open(id, on = true, instant = false) { const d = typeof id === 'object' ? id : this.doors.find(q => q.id === id); return d ? d.toggle(on, instant) : Promise.resolve(); }
  list() {
    return this.doors.map(d => ({ id: d.id, c: d.c, n: d.n, w: d.w, y0: d.y0, h: d.h, open: d.open, kind: d.spec.kind, double: !!d.spec.double, go: !!d.spec.go, label: d.label,
      rooms: (d.rooms || []).map(r => r && { id: r.id, no: r.no, name: r.name, kind: r.kind, area: +r.area.toFixed(2), built: r.built }), into: d.into && d.into.id }));
  }
  // where a visitor stands after coming up / down the stairs (building-local of the commons + y), or null
  arrival(from) {
    const st = this.rooms.filter(r => r.stair); if (!st.length) return null;
    let r = st[0]; if (from && from.tower) r = st.find(q => q.tower === from.tower) || r;
    if (!r.built) this.build(r); r.keep = true; setTimeout(() => { r.keep = false; }, 4000);
    const s = r.stairInfo; if (!s) return null;
    this.parent.updateMatrixWorld(true);
    const p = this.parent.localToWorld(new THREE.Vector3(s.arrive[0], s.arriveY || 0, s.arrive[1])), q = this.parent.localToWorld(new THREE.Vector3(s.arrive[0] + s.arriveLook[0], s.arriveY || 0, s.arrive[1] + s.arriveLook[1]));
    // world position of the feet + walk.js yaw (forward = (−sin yaw, −cos yaw))
    return { world: [p.x, p.y, p.z], yaw: Math.atan2(-(q.x - p.x), -(q.z - p.z)), room: r.id };
  }
  build(r) {
    if (r.built || this.disposed) return;
    try { r.group = buildRoom(this, r); } catch (e) { console.warn('[rooms] build', r.id, e); r.group = new THREE.Group(); }
    r.group.name = 'vrc-room-' + r.id; for (const d of r.landDoors || []) for (const l of d.leaves) r.group.add(l.pivot);
    this.parent.add(r.group); r.group.updateMatrixWorld(true); r.built = true; this.stats.built++;
    if (this.hooks && this.hooks.add) try { this.hooks.add(r.group); } catch (e) { console.warn('[rooms] register', e); }
  }
  drop(r) {
    if (!r.built) return;
    if (this.hooks && this.hooks.remove) try { this.hooks.remove(r.group); } catch (e) { console.warn('[rooms] unregister', e); }
    if (r.group.parent) r.group.parent.remove(r.group);
    r.group.traverse(o => { if (o.isMesh && o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); });
    r.group = null; r.built = false; this.stats.dropped++;
  }
  goTo(bId, floor, from) { if (this.hooks && this.hooks.goTo) return this.hooks.goTo(bId, floor, from); }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const d of this.doors) if (d.anim) cancelAnimationFrame(d.anim);
    for (const r of this.rooms) if (r.built) { r.group.traverse(o => { if (o.isMesh && o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); }); }
    for (const [gb, gh] of this.geos.values()) { gb.dispose(); gh.dispose(); }
  }
}

// ============================================================ build one room (contents; enclosure where asked)
let CUR_PLAYS = null;
const PLAY_M = { collider: null };
// V19: the WC's basins run and its toilets flush at a tap (furniture.js water play; idle = no per-frame cost)
function buildPlays(g, plays, r) {
  if (!PLAY_M.collider) { PLAY_M.collider = new THREE.MeshBasicMaterial({ visible: false }); PLAY_M.collider.name = 'collider'; }
  for (const p of plays) {
    const dyn = PLAY.playGroup(g, 'play-' + p.kind); dyn.position.set(p.x, 0, p.z); dyn.rotation.y = p.yaw;
    let px = null;
    if (p.kind === 'tap') { const out = PLAY.waterOutlet(dyn, PLAY_M, 'wcSink', 'tap', { x: 0, y: p.y, z: 0, drop: p.o.drop, ring: 0.05 }); px = out.proxy(p.o.w, p.o.h, p.o.dd, 0, p.o.y0, p.o.dc - 0.2); }
    else if (p.kind === 'flush') {
      let busy = 0; const flush = () => { if (performance.now() < busy) return Promise.resolve(); busy = performance.now() + 5000; px.userData.open = px.userData._open = true; PLAY.sfx('flush'); setTimeout(() => { px.userData.open = px.userData._open = false; }, 3800); return Promise.resolve(); };
      px = PLAY.playProxy(dyn, PLAY_M, 'wcToilet', 'flush', p.o.w, p.o.h, p.o.dd, 0, p.y - p.o.h / 2, 0, flush);
    }
    if (px) { const tg = px.userData.toggle; px.userData.action = { type: 'play', part: px.userData.playPart, room: r.id, onClick: () => tg() }; }
  }
}
function buildRoom(set, r) {
  const K = set.K, g = new THREE.Group(), B = new K.Batch(), C = new K.Colliders(6), plan = PLANS[r.kind] || PLANS.tech;
  const plays = []; CUR_PLAYS = plays;
  const H = r.h, ctx = { H, rnd: rng(hashStr(r.id)), pipes: PIPE_COL[r.kind] || null };
  if (r.enclose) enclose(set, r, B, C, plan);
  else if (r.ceil && !r.stair) {   // own ceiling under the level's ceiling (rooms under a ramp: the ramp hole of the hall ceiling must not show)
    const sh = new THREE.Shape(r.poly.map(([x, z]) => new THREE.Vector2(x, z))), cg = new THREE.ShapeGeometry(sh); cg.rotateX(Math.PI / 2); cg.translate(0, H - 0.012, 0); B.add(RM('ceiling'), cg); }
  if (r.stair) buildStair(set, r, B, C);
  else if (r.kind === 'fireTank') reservoir(r, B, C, ctx);
  else furnish(set, r, B, C, plan, ctx);
  lights(r, B, plan);
  CUR_PLAYS = null;
  B.flush(g); C.flush(g);
  if (plays.length) try { buildPlays(g, plays, r); } catch (e) { console.warn('[rooms] plays', e); }
  return g;
}

// floor, ceiling and walls of a room whose builder has none (floors ≥ 1): the room rect/poly, door gaps, thresholds
function enclose(set, r, B, C, plan) {
  const T = THREE, wm = RM(r.wallMat || plan.wall || (r.stair ? 'wallStair' : 'wall')), y0 = r.stair ? r.ylo : 0, y1 = r.stair ? r.yhi : r.h, WT = 0.12;
  const poly = r.poly, n = poly.length, ccw = area2(poly) > 0;
  if (!r.stair) {
    const sh = new T.Shape(poly.map(([x, z]) => new T.Vector2(x, -z))), fg = new T.ShapeGeometry(sh); fg.rotateX(-Math.PI / 2); B.add(RM(plan.floor || 'floor'), fg.clone()); fg.translate(0, 0.0, 0); C.geoFloor(fg);
    const cg = new T.ShapeGeometry(new T.Shape(poly.map(([x, z]) => new T.Vector2(x, z)))); cg.rotateX(Math.PI / 2); cg.translate(0, r.h, 0); B.add(RM('ceiling'), cg);
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], L = hyp(a, b); if (L < 0.02) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; let nn = ccw ? [-u[1], u[0]] : [u[1], -u[0]];     // inward normal (z down the sheet: check by sampling)
    const mid = [(a[0] + b[0]) / 2 + nn[0] * 0.05, (a[1] + b[1]) / 2 + nn[1] * 0.05]; if (!inPoly(poly, mid[0], mid[1])) nn = [-nn[0], -nn[1]];
    const D = new Drawer(B, C, a, nn); const uu = D.u, sgn = uu[0] * u[0] + uu[1] * u[1] > 0 ? 1 : -1;     // D.u may run the other way along the edge
    const A = s => s * sgn;                                                                                   // edge parameter → D's a
    // door gaps on this wall: doors whose centre lies within 0.8 m of the wall line, between its ends
    const gaps = [];
    for (const d of r.doors) {
      if (d.spec.go) continue;
      const rel = [d.c[0] - a[0], d.c[1] - a[1]], s = rel[0] * u[0] + rel[1] * u[1], off = rel[0] * nn[0] + rel[1] * nn[1];
      if (s < -0.1 || s > L + 0.1 || off > 0.85 || off < -0.9) continue;
      gaps.push({ s0: s - d.w / 2 - 0.02, s1: s + d.w / 2 + 0.02, y0: d.y0, y1: d.y0 + d.h + 0.02, off, d });
    }
    gaps.sort((p, q) => p.s0 - q.s0);
    // wall body: full height pieces between gaps, lintels / sills around gaps (gaps are vertical windows [y0, y1])
    let s = 0;
    const piece = (s0, s1, ya, yb) => { if (s1 - s0 < 0.005 || yb - ya < 0.005) return; D.box(wm, A(s0), A(s1), ya, yb, 0, WT, true); };
    for (const gp of gaps) { piece(s, Math.max(s, gp.s0), y0, y1); const p0 = Math.max(s, gp.s0), p1 = Math.min(L, gp.s1); piece(p0, p1, y0, gp.y0); piece(p0, p1, gp.y1, y1); s = Math.max(s, gp.s1); }
    piece(s, L, y0, y1);
    // threshold tunnel from the door line to this wall line when the door stands off the wall (hall wall ≠ room wall)
    for (const gp of gaps) {
      { const s0 = gp.s0 + 0.03, s1 = gp.s1 - 0.03, d0 = Math.min(-Math.max(0, -gp.off), 0) - 0.3;   // threshold through the wall(s): walkable floor
        C.rect(...xzRect(D, A(s0), A(s1), d0, WT + 0.12), gp.y0); D.box(RM(plan.floor || 'floor'), A(s0), A(s1), gp.y0 - 0.05, gp.y0 - 0.003, Math.max(d0, -0.05), WT + 0.02); }
      const out = -gp.off; if (out < 0.04) continue;                // door stands off the room wall (hall wall ≠ room wall): floor + cheeks + lintel between
      const s0 = gp.s0 + 0.02, s1 = gp.s1 - 0.02;
      D.box(RM(plan.floor || 'floor'), A(s0), A(s1), gp.y0 - 0.2, gp.y0 - 0.002, -out - 0.05, WT + 0.02); C.rect(...xzRect(D, A(s0), A(s1), -out - 0.06, WT + 0.04), gp.y0);
      for (const [e0, e1] of [[s0 - 0.12, s0], [s1, s1 + 0.12]]) D.box(wm, A(e0), A(e1), gp.y0, gp.y1, -out - 0.02, 0, true);
      D.box(wm, A(s0 - 0.12), A(s1 + 0.12), gp.y1, gp.y1 + 0.3, -out - 0.02, 0);
    }
  }
}
const xzRect = (D, a0, a1, d0, d1) => { const p = D.P(a0, d0), q = D.P(a1, d1); return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])]; };

// ceiling LED panels (+ emergency light and exit sign over each door inside)
function lights(r, B, plan) {
  const T = THREE, H = r.h, top = r.stair ? null : H;
  if (top != null) {
    const n = Math.max(1, Math.round(r.area / 10)), b = r.bbox, cols = Math.max(1, Math.round(Math.sqrt(n * (b.x1 - b.x0) / Math.max(0.5, b.z1 - b.z0)))), rows = Math.max(1, Math.ceil(n / cols));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const x = b.x0 + (b.x1 - b.x0) * (i + 0.5) / cols, z = b.z0 + (b.z1 - b.z0) * (j + 0.5) / rows; if (!inPoly(r.poly, x, z)) continue;
      const lg = new T.BoxGeometry(r.kind === 'wc' ? 0.3 : 1.2, 0.04, 0.3); B.add(RM(r.kind === 'shelter' || r.kind === 'wc' || r.kind === 'security' ? 'ledWarm' : 'led'), lg, M4(x, top - 0.03, z, (b.x1 - b.x0) >= (b.z1 - b.z0) ? 0 : Math.PI / 2)); }
  }
  for (const d of r.doors) {
    if (d.spec.go || r.stair) continue;
    const nn = d.inwardFor(r);
    const D = new Drawer(B, null, [d.c[0] + nn[0] * 0.13, d.c[1] + nn[1] * 0.13], nn);
    if (d.h + 0.42 >= H) continue;
    const other = (d.sides || []).find(id => id && id !== r.id), toOut = !other;           // the other side is a hall / lift hall / the floor's corridor
    if (r.kind === 'shelter' || (r.kind === 'passage' && toOut)) D.sign('ВИХІД', 0, d.h + 0.25, 0.0, 0.7);
    else if (r.kind !== 'passage') D.box('ledGreen', -0.12, 0.12, d.h + 0.18, d.h + 0.3, 0, 0.03);
  }
}

// ---- furnishing along the walls, keeping every door connected to the most open spot of the room
function furnish(set, r, B, C, plan, ctx) {
  const poly = r.poly, holes = r.holes || [], A = r.area, cs = A > 60 ? 0.15 : 0.1, CLR = 0.27;
  const G = new Grid(poly, holes, cs);
  G.clearance();
  const doorPts = r.doors.filter(d => !d.spec.go).map(d => { const v = d.inwardFor(r); return { d, p: [d.c[0] + v[0] * 0.5, d.c[1] + v[1] * 0.5], inward: v }; });
  const doorCells = doorPts.map(q => G.nearestClear(q.p[0], q.p[1], CLR, 1.0)).filter(k => k >= 0);
  // the most open spot = target that must stay reachable
  let core = -1, cd = -1; for (let k = 0; k < G.dist.length; k++) if (G.dist[k] < 1e8 && G.dist[k] > cd) { cd = G.dist[k]; core = k; }
  const free0 = (() => { if (!doorCells.length) return 0; const m = G.reach(doorCells[0], CLR); let c = 0; for (const v of m) c += v; return c; })();
  const ok = () => {
    G.clearance(); if (!doorCells.length) return true;
    const m = G.reach(doorCells[0], CLR); if (!m[doorCells[0]]) return false;
    for (const k of doorCells) if (!m[k]) return false;
    let c = 0; for (const v of m) c += v; return c >= Math.min(free0, Math.max(free0 * 0.35, 1.2 / (cs * cs)));
  };
  if (doorCells.length && !G.reach(doorCells[0], CLR)[doorCells[0]]) return;     // too tight to put anything in
  // wall edges (with inward normals), longest first
  const edges = [];
  for (const ring of [poly]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = hyp(a, b); if (L < 0.5) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; let nn = [-u[1], u[0]]; const m = [(a[0] + b[0]) / 2 + nn[0] * 0.06, (a[1] + b[1]) / 2 + nn[1] * 0.06]; if (!inPoly(poly, m[0], m[1])) nn = [-nn[0], -nn[1]];
    edges.push({ a, b, L, u, n: nn });
  }
  edges.sort((p, q) => q.L - p.L);
  const keepOut = doorPts.map(q => ({ p: [q.p[0] - q.inward[0] * 0.5, q.p[1] - q.inward[1] * 0.5], r: Math.max(0.95, q.d.w / 2 + 0.45) }));
  const placeItem = (key) => {
    const it = ITEMS[key]; if (!it) return false;
    const cands = [];
    for (const e of edges) {
      if (e.L < it.w + 0.1) continue;
      const D = new Drawer(null, null, e.a, e.n), sg = D.u[0] * e.u[0] + D.u[1] * e.u[1] > 0 ? 1 : -1;
      for (let s = it.w / 2 + 0.06; s <= e.L - it.w / 2 - 0.06 + 1e-6; s += 0.15) {
        const a = s * sg, quad = [D.P(a - it.w / 2, 0.01), D.P(a + it.w / 2, 0.01), D.P(a + it.w / 2, it.d), D.P(a - it.w / 2, it.d)];
        const c = D.P(a, it.d / 2); let dd = 1e9; for (const k of keepOut) dd = Math.min(dd, hyp(c, k.p) - k.r - Math.max(it.w, it.d) / 2);
        if (dd < 0) continue;
        cands.push({ e, D, a, quad, score: -dd });
      }
    }
    cands.sort((p, q) => p.score - q.score);
    for (const cd0 of cands.slice(0, 60)) {
      const { quad } = cd0;
      if (!quad.every(([x, z]) => inPoly(poly, x, z) && !holes.some(h => inPoly(h, x, z)))) continue;
      const cells = G.cellsOf(quad); if (!cells.length || cells.some(k => G.block[k])) continue;
      cells.forEach(k => { G.block[k] = 2; });
      if (!ok()) { cells.forEach(k => { G.block[k] = 0; }); continue; }
      const D = new Drawer(B, C, cd0.e.a, cd0.e.n);
      it.draw(D, cd0.a, ctx);
      return true;
    }
    return false;
  };
  if (r.kind === 'wc') {   // WC: one closet per 1.2 m of the longest wall in a large WC (cubicles), a basin row; small WC: pan + basin
    const big = A > 8;
    if (big) { let n = 0; while (n < 10 && placeItem('cubicle')) n++; let m = 0; while (m < 4 && placeItem('sink')) m++; }
    else { placeItem('toilet'); placeItem('sink'); }
  } else {
    for (const k of plan.first) placeItem(k);
    if (plan.more.length) { let n = 0, i = 0, fails = 0; while (n < 40 && fails < plan.more.length) { if (placeItem(plan.more[i % plan.more.length])) { n++; fails = 0; } else fails++; i++; } }
  }
  void core;
  // overhead services along the walls (no collisions: above head height)
  const H = r.h;
  for (const e of edges.slice(0, 4)) {
    if (e.L < 1.2) continue;
    const D = new Drawer(B, null, e.a, e.n), sg = D.u[0] * e.u[0] + D.u[1] * e.u[1] > 0 ? 1 : -1, a0 = 0.05 * sg, a1 = (e.L - 0.05) * sg;
    if (plan.deco === 'pipes') { const c = ctx.pipes || ['pipeInsul', 'pipeBlue']; D.hcylU(c[0], Math.min(a0, a1), Math.max(a0, a1), H - 0.32, 0.14, 0.06); D.hcylU(c[1], Math.min(a0, a1), Math.max(a0, a1), H - 0.5, 0.14, 0.045); }
    if (plan.deco === 'trays' || r.kind === 'tech') { D.box('galv', a0, a1, H - 0.28, H - 0.24, 0.05, 0.4); for (let k = 0; k < 5; k++) D.hcylU('black', Math.min(a0, a1), Math.max(a0, a1), H - 0.225, 0.1 + k * 0.06, 0.018, 6); }
    if (plan.deco === 'ducts') D.box('galv', a0, a1, H - 0.45, H - 0.05, 0.05, 0.55);
  }
  if (plan.mat) { const b = r.bbox; const q = new THREE.BoxGeometry(Math.max(0.5, b.x1 - b.x0 - 1.0), 0.008, Math.max(0.5, b.z1 - b.z0 - 1.0)); B.add(RM('rubberMat'), q, M4((b.x0 + b.x1) / 2, 0.004, (b.z0 + b.z1) / 2)); }
  // shelter: signage + emergency lights on the walls
  if (r.kind === 'shelter') for (const e of edges.slice(0, 2)) { const D = new Drawer(B, null, e.a, e.n), sg = D.u[0] * e.u[0] + D.u[1] * e.u[1] > 0 ? 1 : -1; D.sign('УКРИТТЯ', e.L / 2 * sg, Math.min(H - 0.3, 2.25), 0.015, 1.1); D.box('ledGreen', (e.L / 2 + 0.8) * sg - 0.1, (e.L / 2 + 0.8) * sg + 0.1, 2.05, 2.11, 0.01, 0.05); }
}

// fire-water reservoir room: the tank fills the room except an access strip at the door (rail, ladder, hatch)
function reservoir(r, B, C, ctx) {
  const b = r.bbox, d = r.doors[0]; if (!d) return;
  const n = d.inwardFor(r), strip = 0.95;
  // tank = room bbox minus the strip in front of the door
  let x0 = b.x0 + 0.1, x1 = b.x1 - 0.1, z0 = b.z0 + 0.1, z1 = b.z1 - 0.1;
  if (Math.abs(n[0]) > 0.5) { if (n[0] > 0) x0 = Math.max(x0, d.c[0] + strip); else x1 = Math.min(x1, d.c[0] - strip); } else { if (n[1] > 0) z0 = Math.max(z0, d.c[1] + strip); else z1 = Math.min(z1, d.c[1] - strip); }
  if (x1 - x0 < 0.4 || z1 - z0 < 0.4) return;
  B.box(RM('pipeInsul'), x0, x1, 0, ctx.H - 0.35, z0, z1); C.box(x0, x1, 0, ctx.H - 0.35, z0, z1);
  B.box(RM('cabinetDark'), x0 - 0.02, x1 + 0.02, 0.6, 0.66, z0 - 0.02, z1 + 0.02); B.box(RM('cabinetDark'), x0 - 0.02, x1 + 0.02, 1.6, 1.66, z0 - 0.02, z1 + 0.02);
  const fx = Math.abs(n[0]) > 0.5 ? (n[0] > 0 ? x0 : x1) : (x0 + x1) / 2, fz = Math.abs(n[0]) > 0.5 ? (z0 + z1) / 2 : (n[1] > 0 ? z0 : z1);
  const D = new Drawer(B, C, [fx, fz], [-n[0], -n[1]]);
  for (let k = 0; k < 8; k++) D.box('galv', -0.22, 0.22, 0.3 + k * 0.28, 0.32 + k * 0.28, 0.02, 0.06);
  for (const a of [-0.22, 0.22]) D.box('galv', a - 0.015, a + 0.015, 0, ctx.H - 0.35, 0.02, 0.06);
  D.cyl('white', 0.6, 0.06, 1.1, 1.3, 0.08, 14); D.box('pipeBlue', 0.55, 0.65, 0.4, 1.1, 0.0, 0.08); D.sign('ЗАПАС ВОДИ', 0, 2.05, 0.01, 0.8);
}

// ============================================================ stair well: flights up and down from the landing, rails, landings
// r.stair = { rect: {x0,x1,z0,z1}, up: rise to the landing above (0 = none), down: drop to the landing below (0 = none),
//             mid: rise of the first flight up (default up/2), upper / lower: { label, go } for the landing doors, walls: 'all'|'above',
//             wallsFrom: y from which own walls stand (car park: its ceiling), straight: bool }
function buildStair(set, r, B, C) {
  const S = r.stair, R0 = S.rect, R = r.enclose ? { x0: R0.x0 + 0.12, x1: R0.x1 - 0.12, z0: R0.z0 + 0.12, z1: R0.z1 - 0.12 } : R0, ax = (R.x1 - R.x0) >= (R.z1 - R.z0) ? 'x' : 'z', L = ax === 'x' ? R.x1 - R.x0 : R.z1 - R.z0, W = ax === 'x' ? R.z1 - R.z0 : R.x1 - R.x0;
  // the landing is at the way in: prefer the door from a corridor / lobby / hall over doors of technical rooms
  const rank = d => { const o = (d.sides || []).find(id => id && id !== r.id), orm = o && set.roomById(o); return !o ? 0 : orm && orm.kind === 'passage' ? 1 : 2; };
  const door = (S.mainDoor && r.doors.find(d => d.id === S.mainDoor)) || r.doors.filter(d => !d.spec.go && !(d.y0 > 0.5)).sort((p, q) => rank(p) - rank(q))[0] || null, dc = door ? door.c : [(R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2];
  const along = p => (ax === 'x' ? p[0] : p[1]), lo = ax === 'x' ? R.x0 : R.z0, hi = ax === 'x' ? R.x1 : R.z1;
  const nearLo = S.landAt ? S.landAt === 'lo' : Math.abs(along(dc) - lo) <= Math.abs(along(dc) - hi);
  const sDir = nearLo ? 1 : -1, s0 = nearLo ? lo : hi;                      // s = 0 at the landing end
  const t0 = ax === 'x' ? R.z0 : R.x0;                                      // t across, from t0
  const P = (s, t) => (ax === 'x' ? [s0 + sDir * s, t0 + t] : [t0 + t, s0 + sDir * s]);
  const box = (m, sa, sb, y0, y1, ta, tb, solid = false) => { const p = P(sa, ta), q = P(sb, tb), x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), z0 = Math.min(p[1], q[1]), z1 = Math.max(p[1], q[1]); B.box(typeof m === 'string' ? RM(m) : m, x0, x1, y0, y1, z0, z1); if (solid) C.box(x0, x1, y0, y1, z0, z1); };
  const frect = (sa, sb, ta, tb, y) => { const p = P(sa, ta), q = P(sb, tb); C.rect(Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1]), y); };
  const up = S.up || 0, down = S.down || 0, straight = S.straight || W < 2.1;
  const doorS = door ? Math.abs(along(dc) - s0) : 0, doorOnEnd = door && Math.abs(door.n[ax === 'x' ? 0 : 1]) > 0.5;
  const DL = straight ? Math.max(1.2, Math.min(Math.max(2.2, L - 2.4), doorOnEnd ? 1.2 : doorS + (door ? door.w / 2 : 0.5) + 0.3)) : Math.max(1.25, Math.min(L * 0.38, doorOnEnd ? 1.25 : doorS + (door ? door.w / 2 : 0.5) + 0.3));
  const DM = S.dm ? Math.max(1.1, Math.min(L * 0.45, S.dm)) : straight ? 1.1 : 1.15, run = Math.max(1.2, L - DL - DM), g = 0.08;
  const laneA = straight ? [0.05, W - 0.05] : [0.05, W / 2 - g], laneB = straight ? null : [W / 2 + g, W - 0.05];
  const info = { ax, L, W, DL, DM, run, lanes: [laneA, laneB] };
  // a flight from (sa, ya) to (sb, yb) in lane [ta, tb]: steps, soffit, floor collider, rails
  const flight = (sa, ya, sb, yb, lane, wallSide) => {
    const rise = yb - ya, n = Math.max(2, Math.round(Math.abs(rise) / 0.165)), rh = rise / n, len = sb - sa, td = len / n, [ta, tb] = lane;
    for (let k = 0; k < n; k++) {
      const s1 = sa + td * k, s2 = sa + td * (k + 1), yTop = ya + rh * (k + (rise > 0 ? 1 : 0)), yBot = Math.min(ya + rh * k, ya + rh * (k + 1)) - 0.22;
      box('concrete', Math.min(s1, s2), Math.max(s1, s2), yBot, yTop - 0.03, ta, tb); box('tread', Math.min(s1, s2), Math.max(s1, s2), yTop - 0.03, yTop, ta, tb);
      const nose = rise > 0 ? s1 : s2; box('nosing', nose - 0.025 * Math.sign(len), nose + 0.025 * Math.sign(len), yTop - 0.004, yTop + 0.002, ta + 0.02, tb - 0.02);
    }
    // floor collider: slope through the step tops
    const T = THREE, pa = P(sa, ta), pb = P(sa, tb), pc = P(sb, tb), pd = P(sb, ta), y0 = ya + (rise > 0 ? rh * 0.5 : 0), y1 = yb - (rise > 0 ? 0 : rh * 0.5);
    const fg = new T.BufferGeometry(); fg.setAttribute('position', new T.Float32BufferAttribute([pa[0], y0, pa[1], pb[0], y0, pb[1], pc[0], y1, pc[1], pa[0], y0, pa[1], pc[0], y1, pc[1], pd[0], y1, pd[1]], 3)); fg.computeVertexNormals(); C.geoFloor(fg);
    // handrails (0.9 m over the pitch line): wall side on brackets, well side on balusters
    const rail = (t, posts) => { const nseg = Math.max(1, Math.round(Math.abs(len) / 0.5));
      for (let k = 0; k < nseg; k++) { const f0 = k / nseg, f1 = (k + 1) / nseg, sA = sa + len * f0, sB = sa + len * f1, yA = ya + rise * f0 + 0.9, yB = ya + rise * f1 + 0.9, p = P(sA, t), q = P(sB, t);
        const dx = q[0] - p[0], dz = q[1] - p[1], dy = yB - yA, l = Math.hypot(dx, dy, dz), cg = new T.CylinderGeometry(0.022, 0.022, l, 8);
        cg.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx / l, dy / l, dz / l))); cg.translate((p[0] + q[0]) / 2, (yA + yB) / 2, (p[1] + q[1]) / 2); B.add(RM('steel'), cg);
        if (posts) { const yb0 = ya + rise * f0 + (rise > 0 ? rh : 0); box('steel', sA - 0.015, sA + 0.015, yb0, yA, t - 0.015, t + 0.015); }
        else if (k % 2 === 0) box('steel', sA - 0.012, sA + 0.012, yA - 0.07, yA, t - 0.012, t + 0.012); } };
    rail(wallSide === 'lo' ? ta + 0.06 : tb - 0.06, false);
    if (!straight) rail(wallSide === 'lo' ? tb - 0.03 : ta + 0.03, true);
  };
  const H = r.h, yTop = up ? up + H : H, yBot = down ? -down - 0.25 : -0.25;
  const mid = S.mid ?? up / 2;
  // landings: slab + floor collider
  const landing = (sa, sb, y, ta = 0, tb = W) => { box('tread', sa, sb, y - 0.03, y, ta, tb); box('concrete', sa, sb, y - 0.22, y - 0.03, ta, tb); frect(sa, sb, ta, tb, y); };
  if (!S.baseFloor) landing(0, DL, 0);
  if (straight) {     // one straight flight up to a landing (no steeper than ~35°)
    if (up) { const rs_ = Math.min(mid || up, run * 0.7); flight(DL, 0, DL + run, rs_, laneA, 'lo'); landing(DL + run, L, rs_); S._top = rs_; }
  } else {
    if (up) { flight(DL, 0, DL + run, mid, laneA, 'lo'); landing(DL + run, L, mid); flight(DL + run, mid, DL, up, laneB, 'hi'); landing(0, DL, up); }
    if (down) { flight(DL, 0, DL + run, -down / 2, laneB, 'hi'); landing(DL + run, L, -down / 2); flight(DL + run, -down / 2, DL, -down, laneA, 'lo'); landing(0, DL, -down); }
    // the well between the lanes: a wall nobody climbs over (collider) + its visible capping
    const wy0 = down ? -down : 0, wy1 = up ? up + 1.1 : 1.1;
    { const p = P(DL, W / 2 - g), q = P(DL + run, W / 2 + g); C.box(Math.min(p[0], q[0]), Math.max(p[0], q[0]), wy0, wy1, Math.min(p[1], q[1]), Math.max(p[1], q[1])); }
    // guard rails where a landing meets a lane with no flight at that level
    const guard = (y, lane) => { box('steel', DL - 0.02, DL + 0.02, y + 0.98, y + 1.02, lane[0], lane[1]); for (let t = lane[0] + 0.05; t < lane[1]; t += 0.12) box('steel', DL - 0.01, DL + 0.01, y, y + 0.98, t - 0.01, t + 0.01);
      const p = P(DL - 0.03, lane[0]), q = P(DL + 0.03, lane[1]); C.box(Math.min(p[0], q[0]), Math.max(p[0], q[0]), y, y + 1.1, Math.min(p[1], q[1]), Math.max(p[1], q[1])); };
    if (up) guard(up, laneA); else guard(0, laneA);
    if (down) guard(-down, laneB);
    else if (up) {   // nothing goes down: the space under the second flight is closed off at the landing
      box('wallStair', DL, DL + 0.12, 0, Math.max(0.5, up - 0.3), laneB[0] - 0.02, laneB[1] + 0.05, true);
    }
  }
  // side and end walls of the run (keep the visitor on the flights where the drawn walls stand back from them)
  if (S.walls === 'above') {
    const y0 = S.wallsFrom ?? H;
    // a door of the well that opens above the car-park ceiling (0150 → ramp walkway) keeps its opening in these walls
    const highs = r.doors.filter(d => !d.spec.go && d.y0 > 0.5).map(d => { const sv = (along(d.c) - s0) * sDir, tv = (ax === 'x' ? d.c[1] : d.c[0]) - t0; return { s: sv, t: tv, w: d.w, top: d.y0 + d.h }; });
    for (const [sa, sb, ta, tb] of [[0, L, -0.12, 0], [0, L, W, W + 0.12], [-0.12, 0, -0.12, W + 0.12], [L, L + 0.12, -0.12, W + 0.12]]) {
      const alongS = sb - sa > 0.5, edge = alongS ? (ta + tb) / 2 : (sa + sb) / 2, gaps = highs.filter(h => Math.abs((alongS ? h.t : h.s) - edge) < 0.7).map(h => alongS ? [h.s - h.w / 2 - 0.05, h.s + h.w / 2 + 0.05, h.top] : null).filter(Boolean);
      if (!gaps.length) { box('wallStair', sa, sb, y0, yTop, ta, tb, true); continue; }
      let a = sa; for (const [g0, g1, gy] of gaps.sort((p, q) => p[0] - q[0])) { if (g0 > a) box('wallStair', a, g0, y0, yTop, ta, tb, true); if (yTop > gy) box('wallStair', Math.max(a, g0), g1, Math.max(y0, gy), yTop, ta, tb, true); a = Math.max(a, g1); }
      if (a < sb) box('wallStair', a, sb, y0, yTop, ta, tb, true);
    }
    for (const [ta, tb] of [[-0.05, 0.02], [W - 0.02, W + 0.05]]) {
      const gs = highs.filter(h => Math.abs(h.t - (ta + tb) / 2) < 0.7).map(h => [h.s - h.w / 2 - 0.05, h.s + h.w / 2 + 0.05]).sort((p, q) => p[0] - q[0]);
      let a = DL; for (const [g0, g1] of [...gs, [L, L]]) { const b2 = Math.min(L, g0); if (b2 > a + 0.01) { const p = P(a, ta), q = P(b2, tb); C.box(Math.min(p[0], q[0]), Math.max(p[0], q[0]), 0, y0, Math.min(p[1], q[1]), Math.max(p[1], q[1])); } a = Math.max(a, g1); }
    }
    { const p = P(L - 0.02, 0), q = P(L + 0.04, W); C.box(Math.min(p[0], q[0]), Math.max(p[0], q[0]), 0, y0, Math.min(p[1], q[1]), Math.max(p[1], q[1])); }
  }
  box('ceiling', -0.12, L + 0.12, yTop, yTop + 0.1, -0.12, W + 0.12);
  if (down) box('concrete', 0, L, yBot - 0.1, yBot, 0, W);
  // lights: one wall lamp per landing level
  const lamps = [[DL / 2, (up || 0) + 2.3], [DL / 2, 2.3], [L - DM / 2, (mid || 0) + 2.3]]; if (down) lamps.push([DL / 2, -down + 2.3], [L - DM / 2, -down / 2 + 2.3]);
  for (const [s, y] of lamps) { if (y > yTop - 0.05) continue; box('ledWarm', s - 0.2, s + 0.2, y, y + 0.06, W - 0.04, W - 0.01); }
  // doors of the landings above / below: on the same wall as this floor's door, one storey up / down
  // the point of the well's wall in front of a door (the door may stand off the well, on the hall line)
  const onWall = (c, v) => (Math.abs(v[0]) > 0.5 ? [v[0] > 0 ? R.x0 : R.x1, Math.min(R.z1 - 0.5, Math.max(R.z0 + 0.5, c[1]))] : [Math.min(R.x1 - 0.5, Math.max(R.x0 + 0.5, c[0])), v[1] > 0 ? R.z0 : R.z1]);
  const landDoor = (y, spec, at = null) => {
    if (!spec) return;
    const dn = at ? at.dn : door ? door.inwardFor(r) : (ax === 'x' ? [sDir, 0] : [0, sDir]), p = at ? at.p : door ? onWall(door.c, dn) : P(0, W / 2);
    const half = door ? door.w / 2 : 0.45, tt = [dn[1], -dn[0]], a = [p[0] - tt[0] * half, p[1] - tt[1] * half], bb = [p[0] + tt[0] * half, p[1] + tt[1] * half];
    const id = r.id + (y > 0 ? '-up' : y < 0 ? '-down' : '-exit');
    let d = (r.landDoors || []).find(q => q.id === id);
    if (!d) { d = set.addDoor({ id, a, b: bb, n: dn, sideN: dn, sides: [null, r.id], y0: y, h: 2.1, wallT: 0.08, kind: door ? door.spec.kind : 'steel', rooms: [r.id], into: null, label: spec.label, go: spec.go }); d.extra = true; (r.landDoors ||= []).push(d); for (const l of d.leaves) set.doorGroup.remove(l.pivot); }
    const D = new Drawer(B, null, [p[0] + dn[0] * 0.02, p[1] + dn[1] * 0.02], dn);
    D.box('frame', -half - 0.05, -half, y, y + 2.15, 0, 0.04); D.box('frame', half, half + 0.05, y, y + 2.15, 0, 0.04); D.box('frame', -half - 0.05, half + 0.05, y + 2.1, y + 2.15, 0, 0.04);
    if (spec.label && hasSign(spec.label)) D.sign(spec.label, 0, y + 2.42, 0.01, 0.9);
    if (spec.sub && hasSign(spec.sub)) D.sign(spec.sub, 0, y + 2.56, 0.01, 0.9);
    // (the leaf hangs inside the well — it comes and goes with the room group: a tap takes the visitor to that floor)
  };
  if (S.upper) { if (straight) { if (up) landDoor(S._top ?? (mid || up), S.upper, { p: P(L, W / 2), dn: ax === 'x' ? [-sDir, 0] : [0, -sDir] }); } else if (up) landDoor(up, S.upper); }
  if (down && S.lower && !straight) landDoor(-down, S.lower);
  // arrival spot: on the landing, 0.9 m in from this floor's door, looking into the well
  const iv = door ? door.inwardFor(r) : (ax === 'x' ? [sDir, 0] : [0, sDir]), pw = door ? onWall(door.c, iv) : null, ap = pw ? [pw[0] + iv[0] * 0.7, pw[1] + iv[1] * 0.7] : P(DL / 2, W / 2);
  info.arrive = ap; info.arriveY = 0; info.arriveLook = [-iv[0], -iv[1]];
  const lc = lane => (lane[0] + lane[1]) / 2;
  info.routes = {};
  if (up) info.routes.up = { pts: [P(DL * 0.5, lc(laneA)), P(DL - 0.15, lc(laneA)), P(L - DM / 2, lc(laneA))], y: straight ? (S._top ?? (mid || up)) : mid };
  if (up && !straight) info.routes.up2 = { pts: [P(L - DM / 2, lc(laneB)), P(DL + 0.15, lc(laneB)), P(DL * 0.5, lc(laneB))], y: up };
  if (down && !straight) info.routes.down = { pts: [P(DL * 0.5, lc(laneB)), P(DL - 0.15, lc(laneB)), P(L - DM / 2, lc(laneB))], y: -down / 2 };
  if (down && !straight) info.routes.down2 = { pts: [P(L - DM / 2, lc(laneA)), P(DL + 0.15, lc(laneA)), P(DL * 0.5, lc(laneA))], y: -down };
  r.stairInfo = info;
}

// largest axis-aligned rectangle inside a polygon (grid + histogram), {x0, x1, z0, z1} or null
export function maxRect(poly, holes = [], cs = 0.1) {
  const b = bboxOf(poly), nx = Math.max(1, Math.ceil((b.x1 - b.x0) / cs)), nz = Math.max(1, Math.ceil((b.z1 - b.z0) / cs)), h = new Int32Array(nx);
  let best = null, ba = 0;
  for (let j = 0; j < nz; j++) {
    const z = b.z0 + (j + 0.5) * cs;
    for (let i = 0; i < nx; i++) { const x = b.x0 + (i + 0.5) * cs; h[i] = inPoly(poly, x, z) && !holes.some(q => inPoly(q, x, z)) ? h[i] + 1 : 0; }
    const st = [];
    for (let i = 0; i <= nx; i++) {
      const hi = i < nx ? h[i] : 0; let start = i;
      while (st.length && st[st.length - 1][1] >= hi) { const [s0, hh] = st.pop(), a = hh * (i - s0); if (a > ba) { ba = a; best = { x0: b.x0 + s0 * cs, x1: b.x0 + i * cs, z0: b.z0 + (j + 1 - hh) * cs, z1: b.z0 + (j + 1) * cs }; } start = s0; }
      st.push([start, hi]);
    }
  }
  return best;
}
