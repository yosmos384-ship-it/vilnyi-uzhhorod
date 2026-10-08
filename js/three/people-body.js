// people-body.js — the parametric human: skeleton, lofted body / head / hair / clothing geometry, rig and poses.
// One builder makes every tier: the near tier is a SkinnedMesh (vertex colours × the face canvas), the mid / far tiers
// are instanced "template" bodies whose limbs are swung in the vertex shader and whose colours come from a palette row.
// Person frame: metres, y up, feet at y = 0, facing +z, the person's left is +x.
import * as THREE from 'three';
import { rng, clamp, lerp, smooth, mix3, makeTraits, faceFrame, hairline, paintFace } from './people-face.js';
export { makeTraits, paintFace, rng };

export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
// palette slots (instanced tiers: one texel each; near tier: resolved to vertex colours)
export const SLOT = { skin: 0, top: 1, bottom: 2, hair: 3, shoes: 4, fore: 5, shin: 6, inner: 7, hat: 8, bag: 9, band: 10, dark: 11, lip: 12, thigh: 13, white: 14, upper: 15 };
export const PAL_W = 16;
// variant channels of the template body: [hair, lower, top, accessory]
export const HAIR_ID = { bald: 0, buzz: 1, short: 1, shortf: 1, balding: 1, medium: 2, bob: 2, long: 3, bun: 4, pony: 5 };
export const HAT_ID = { beanie: 6, cap: 7, peaked: 7 };
export const LOWER_ID = { trousers: 0, jeans: 0, leggings: 0, shorts: 0, skirt: 1, dress: 1, long: 2 };
export const TOP_ID = { tee: 0, shirt: 0, dress: 0, uniform: 1, suit: 1, jacket: 1, hoodie: 3, coat: 2 };
export const ACC_ID = { none: 0, backpack: 1, shoulder: 2, hand: 3, box: 4 };

// ---- skeleton -------------------------------------------------------------------------------------------------------
export function skeleton(T) {
  const H = T.height, C = H - T.headH, s = H / 1.75, f = T.gender === 'f', k = T.kid || 0, b = T.build || 0;
  const legK = 1 - 0.07 * k + (f ? 0.008 : 0);
  const y = { ankle: 0.052 * C, knee: 0.325 * C * legK, hip: 0.6 * C * legK, chin: C, top: H };
  y.pelvis = y.hip + 0.045 * C; y.waist = y.hip + 0.135 * C; y.chest = y.hip + 0.245 * C; y.shoulder = 0.944 * C; y.neck = 0.972 * C; y.head = C + 0.014;
  const shX = s * (f ? 0.156 : 0.181) * (1 + 0.05 * b) * (1 - 0.1 * k), hipX = s * (f ? 0.083 : 0.08) * (1 + 0.06 * Math.max(0, b));
  const armU = 0.168 * H * (1 - 0.04 * k), armF = 0.147 * H * (1 - 0.04 * k);
  y.elbow = y.shoulder - armU; y.wrist = y.elbow - armF;
  const bulk = Math.max(0, b) * 0.03 + (f ? 0.008 : 0);
  const J = BONES.map(() => [0, 0, 0]);
  J[B.hips] = [0, y.pelvis, 0]; J[B.spine] = [0, y.waist, 0]; J[B.chest] = [0, y.chest, 0]; J[B.neck] = [0, y.neck, -0.008 * s]; J[B.head] = [0, y.head, 0];
  for (const [sd, sg] of [['L', 1], ['R', -1]]) {
    J[B['arm' + sd]] = [sg * shX, y.shoulder, -0.008 * s]; J[B['fore' + sd]] = [sg * (shX + 0.022 * s + bulk), y.elbow, -0.004 * s]; J[B['hand' + sd]] = [sg * (shX + 0.038 * s + bulk * 1.5), y.wrist, 0.012 * s];
    J[B['thigh' + sd]] = [sg * hipX, y.hip, 0]; J[B['shin' + sd]] = [sg * hipX * 0.9, y.knee, 0]; J[B['foot' + sd]] = [sg * hipX * 0.82, y.ankle, -0.005];
  }
  return { J, y, s, shX, hipX, armU, armF, legU: y.hip - y.knee, legL: y.knee - y.ankle, legLen: y.hip, C, H };
}

// ---- mesh builder -----------------------------------------------------------------------------------------------------
class Builder {
  constructor() { this.p = []; this.c = []; this.uv = []; this.sk = []; this.va = []; this.idx = []; this.vr = [-1, 0]; }
  v(x, y, z, slot, shade, sk, u = -1, w = -1) { this.p.push(x, y, z); this.c.push(slot, shade); this.uv.push(u, w); this.sk.push(sk[0], sk[1], sk[2]); this.va.push(this.vr[0], this.vr[1]); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  get n() { return this.p.length / 3; }
}
const sp = (v, pw) => pw === 2 ? v : Math.sign(v) * Math.pow(Math.abs(v), 2 / pw);
const val = (q, ...a) => typeof q === 'function' ? q(...a) : q;
/** Loft closed rings. ring: { c: [x, y, z], rx, rz, pow, plane: 'xz' | 'xy', slot, shade, sk, fn(th, p) }.
 *  slot / shade / sk may be functions of (th, x, y, z). caps: 'a', 'b', 'ab' (fan to the ring centre, optional bulge). */
function loft(M, rings, n, { caps = '', bulge = 0, th0 = 0, angles = null } = {}) {
  const first = M.n, rows = [];
  if (angles) n = angles.length;
  for (const R of rings) {
    const row = [];
    for (let k = 0; k < n; k++) {
      const th = angles ? angles[k] : th0 + k / n * Math.PI * 2, sn = sp(Math.sin(th), R.pow || 2), cs = sp(Math.cos(th), R.pow || 2);
      let p = R.plane === 'xy' ? [R.c[0] + R.rx * sn, R.c[1] + R.rz * cs, R.c[2]] : [R.c[0] + R.rx * sn, R.c[1], R.c[2] + R.rz * cs];
      if (R.fn) p = R.fn(th, p) || p;
      row.push(M.v(p[0], p[1], p[2], val(R.slot, th, p), val(R.shade ?? 1, th, p), val(R.sk, th, p)));
    }
    rows.push(row);
  }
  const i0 = M.idx.length;
  for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k < n; k++) { const a = rows[i][k], b = rows[i][(k + 1) % n], c = rows[i + 1][(k + 1) % n], d = rows[i + 1][k]; M.tri(a, b, c); M.tri(a, c, d); }
  const cap = (R, row, dir, flip) => { const cz = M.v(R.c[0] + dir[0] * bulge, R.c[1] + dir[1] * bulge, R.c[2] + dir[2] * bulge, val(R.slot, 0, R.c), val(R.shade ?? 1, 0, R.c) * 0.92, val(R.sk, 0, R.c)); for (let k = 0; k < n; k++) flip ? M.tri(cz, row[(k + 1) % n], row[k]) : M.tri(cz, row[k], row[(k + 1) % n]); };
  const A = rings[0], Z = rings[rings.length - 1], d = [Z.c[0] - A.c[0], Z.c[1] - A.c[1], Z.c[2] - A.c[2]], dl = Math.hypot(...d) || 1; d[0] /= dl; d[1] /= dl; d[2] /= dl;
  if (caps.includes('a')) cap(A, rows[0], [-d[0], -d[1], -d[2]], true);
  if (caps.includes('b')) cap(Z, rows[rows.length - 1], d, false);
  // outward winding: the first triangle's normal must point away from the axis
  if (rings.length > 1) {
    const P = M.p, a = M.idx[i0] * 3, b = M.idx[i0 + 1] * 3, c = M.idx[i0 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (P[a] + P[b] + P[c]) / 3 - (A.c[0] + rings[1].c[0]) / 2, my = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - (A.c[1] + rings[1].c[1]) / 2, mz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - (A.c[2] + rings[1].c[2]) / 2;
    if (nx * mx + ny * my + nz * mz < 0) for (let i = i0; i < M.idx.length; i += 3) { const t = M.idx[i + 1]; M.idx[i + 1] = M.idx[i + 2]; M.idx[i + 2] = t; }
  }
  return { first, rows };
}
const ball = (M, c, rx, ry, rz, n, m, slot, shade, sk) => { const rings = []; for (let i = 1; i < m; i++) { const a = i / m * Math.PI; rings.push({ c: [c[0], c[1] + ry * Math.cos(a), c[2]], rx: rx * Math.sin(a), rz: rz * Math.sin(a), slot, shade, sk }); } return loft(M, rings, n, { caps: 'ab', bulge: ry * (1 - Math.cos(Math.PI / m)) }); };
const boxy = (M, c, hx, hy, hz, slot, shade, sk, pw = 6, n = 8) => n <= 4 ? loft(M, [{ c: [c[0], c[1] - hy, c[2]], rx: hx * 1.2, rz: hz * 1.2, pow: 2, slot, shade: shade * 0.9, sk }, { c: [c[0], c[1] + hy, c[2]], rx: hx * 1.2, rz: hz * 1.2, pow: 2, slot, shade, sk }], 4, { caps: 'ab', th0: Math.PI / 4 }) : loft(M, [{ c: [c[0], c[1] - hy, c[2]], rx: hx * 0.96, rz: hz * 0.96, pow: pw, slot, shade: shade * 0.9, sk }, { c: [c[0], c[1] - hy * 0.6, c[2]], rx: hx, rz: hz, pow: pw, slot, shade, sk }, { c: [c[0], c[1] + hy * 0.6, c[2]], rx: hx, rz: hz, pow: pw, slot, shade, sk }, { c: [c[0], c[1] + hy, c[2]], rx: hx * 0.94, rz: hz * 0.94, pow: pw, slot, shade, sk }], n, { caps: 'ab', th0: Math.PI / n });

// ---- head shape ---------------------------------------------------------------------------------------------------------
//               v      w     zF      zB
const HEAD = [[0.00, 0.3, 0.335, 0.09], [0.045, 0.47, 0.388, -0.02], [0.13, 0.64, 0.408, -0.15], [0.22, 0.77, 0.414, -0.26], [0.33, 0.88, 0.416, -0.35], [0.47, 0.96, 0.406, -0.41],
  [0.58, 1.0, 0.422, -0.435], [0.72, 1.0, 0.405, -0.435], [0.85, 0.9, 0.335, -0.39], [0.94, 0.66, 0.2, -0.28], [1.0, 0.16, -0.01, -0.09]];
function headRow(T, v) {
  let i = 0; while (i < HEAD.length - 2 && HEAD[i + 1][0] < v) i++;
  const a = HEAD[i], b = HEAD[i + 1], t = clamp((v - a[0]) / (b[0] - a[0])), u = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
  const F = faceFrame(T), jaw = 0.93 + 0.13 * (T.face?.jaw ?? 0.5) - 0.05 * (T.kid || 0), jk = 1 - (1 - jaw) * (1 - smooth(0.1, 0.42, v));
  let w = lerp(a[1], b[1], u);
  if (v > 0.6) w = Math.sqrt(Math.max(0.02, 1 - Math.pow((v - 0.6) / 0.405, 2.3)));                 // round crown
  return { w: w * jk * F.hw, zF: lerp(a[2], b[2], u) * F.HH, zB: lerp(a[3], b[3], u) * F.HH };
}
/** Point on the skull: v 0 chin … 1 crown, th 0 = face, grows towards the person's left. out = offset along the outward direction. */
function headPt(T, v, th, out = 0) {
  const R = headRow(T, v), HH = T.headH, zc = (R.zF + R.zB) / 2, d = (R.zF - R.zB) / 2, cs = Math.cos(th), sn = Math.sin(th);
  let x = R.w * sp(sn, 2.25), y = v * HH, z = zc + d * sp(cs, cs > 0 ? 2.5 : 2.1);
  if (cs > 0.25 && v < 0.72) {                                              // relief of the face: brow ridge, eye sockets, cheek-bones, mouth mound, chin
    const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th), m = T.gender === 'm' ? 1 : 0.45, k = 1 - 0.55 * (T.kid || 0), g = (q, c, w) => Math.exp(-((q - c) * (q - c)) / (2 * w * w)), F = T.face || {};
    const ev = lerp(0.475, 0.43, T.kid || 0);
    let r = 0.0085 * m * k * g(v, ev + 0.105, 0.032) * g(a, 0.3, 0.42)                                 // brow ridge
      - (0.008 + 0.005 * m) * k * g(v, ev, 0.04) * g(a, 0.37, 0.2)                                                     // eye sockets
      - 0.006 * g(v, ev + 0.02, 0.05) * g(a, 0, 0.12)                                                   // root of the nose
      + 0.011 * g(v, 0.36, 0.06) * g(a, 0.72, 0.26)                                                     // cheek-bones
      + 0.011 * g(v, 0.2, 0.04) * g(a, 0, 0.36)                                                         // mouth mound
      - 0.007 * g(v, 0.125, 0.025) * g(a, 0, 0.4)                                                       // under the lower lip
      + (0.008 + 0.012 * m * (F.jaw ?? 0.5)) * k * g(v, 0.055, 0.04) * g(a, 0, 0.42)                     // chin
      - 0.004 * g(v, 0.27, 0.07) * g(a, 0.62, 0.2) * (T.ageYears > 55 ? 1.6 : 1);                        // hollow under the cheek-bone
    z += r * HH / 0.23 * smooth(0.25, 0.55, cs);
  }
  if (out) { const cx = 0, cy = 0.56 * HH, cz = -0.012 * HH / 0.23; let nx = x - cx, ny = (y - cy) * 0.9, nz = z - cz; const l = Math.hypot(nx, ny, nz) || 1; x += nx / l * out; y += ny / l * out; z += nz / l * out; }
  return [x, y, z];
}

// ---- the body -------------------------------------------------------------------------------------------------------------
const LOD = [
  { tn: 14, ln: 8, hn: 18, hv: [0, 0.045, 0.09, 0.13, 0.18, 0.22, 0.28, 0.33, 0.4, 0.47, 0.53, 0.58, 0.65, 0.72, 0.79, 0.85, 0.9, 0.94, 0.975], hm: 6, detail: 2 },
  { tn: 8, ln: 5, hn: 8, hv: [0, 0.1, 0.22, 0.38, 0.58, 0.76, 0.9, 0.975], hm: 3, detail: 1 },
  { tn: 5, ln: 3, hn: 5, hv: [0.02, 0.45, 0.88], hm: 1, detail: 0 },
];
/** Build the body of T into a Builder. `tmpl`: template mode — every variant part is emitted and tagged. */
function buildBody(T, lod = 0, tmpl = false) {
  const L = LOD[lod], M = new Builder(), K = skeleton(T), { J, y, s } = K, O = T.outfit, f = T.gender === 'f', b = T.build, kid = T.kid || 0, S = SLOT;
  const bp = Math.max(0, b), HH = T.headH, F = faceFrame(T), det = L.detail;
  const one = bi => [bi, bi, 0], keepR = R => R.filter(q => (q.lv || 0) <= 2 - lod);
  const chain = (yy, yj, bl, up, lo) => { const w = smooth(yj + bl, yj - bl, yy); return w <= 0 ? one(up) : w >= 1 ? one(lo) : [up, lo, w]; };
  const variant = (ch, mask, fn) => { if (tmpl) M.vr = [ch, mask]; fn(); M.vr = [-1, 0]; };
  const has = (ch, id, mask) => tmpl || (mask >> id & 1) === 1;
  const g = { tee: 0.004, shirt: 0.007, dress: 0.004, hoodie: 0.017, jacket: 0.015, coat: 0.021, suit: 0.012, uniform: 0.015 }[tmpl ? 'shirt' : O.top] ?? 0.006;
  const topId = tmpl ? 0 : TOP_ID[O.top] ?? 0, lowerId = tmpl ? 0 : (O.bottom === 'skirt' || O.bottom === 'dress') ? (O.skirtLen > 0.62 ? 2 : 1) : 0;
  const hairId = tmpl ? 0 : HAIR_ID[T.hairStyle] ?? 1, hatId = tmpl ? 0 : (O.hat ? HAT_ID[O.hat] : 0), accId = tmpl ? 0 : ACC_ID[T.acc?.bag || 'none'] ?? 0;

  // -- torso
  const wk = s * (1 + 0.1 * b) * (1 - 0.06 * kid), dk = s * (1 + 0.1 * b + 0.22 * bp);
  const hipW = (f ? 0.172 : 0.162) * wk + g * 0.5, hipD = (f ? 0.108 : 0.102) * dk + g * 0.5, waistW = (f ? 0.122 : 0.142) * wk * (1 + 0.16 * bp) + g, waistD = (f ? 0.09 : 0.098) * dk * (1 + 0.2 * bp) + g;
  const chestW = (f ? 0.142 : 0.16) * wk + g, chestD = (f ? 0.1 : 0.112) * dk + g, bust = f && !kid ? (0.022 + 0.014 * bp) * s * (1 - kid) : 0.006 * s, belly = bp * 0.035 * s;
  const neckR = (f ? 0.049 : 0.06) * s * (1 + 0.08 * bp) * (1 - 0.08 * kid), sh = K.shX;
  const tucked = !tmpl && O.tucked, hemY = tmpl ? y.hip + 0.02 * s : tucked || O.bottom === 'dress' ? y.waist - 0.01 : O.top === 'tee' || O.top === 'shirt' ? y.hip + 0.035 * s : y.hip - 0.01 * s;
  const openF = !tmpl && O.open, vneck = !tmpl && (O.top === 'tee' || O.top === 'dress' || openF || O.top === 'shirt');
  const torsoSlot = yy => (th, p) => {
    const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th);
    if (yy < hemY) return S.bottom;
    if (!tmpl && O.apron && a < 0.95 && yy < y.chest + 0.04 * s) return S.band;
    if (openF && a < 0.19) return (!tmpl && O.tie && a < 0.01 && yy > y.waist) ? S.dark : S.inner;
    if (!tmpl && O.band && yy > y.chest - 0.02 * s && yy < y.chest + 0.05 * s) return S.band;
    return S.top;
  };
  const tsk = yy => yy < y.waist - 0.05 * s ? chain(yy, y.pelvis + 0.03 * s, 0.05 * s, B.hips, B.spine) : chain(yy, y.chest - 0.03 * s, 0.055 * s, B.spine, B.chest);
  const bustFn = (amt, yy) => (th, p) => { const cs = Math.cos(th); if (cs > 0) p[2] += amt * Math.pow(cs, 1.2) * (0.55 + 0.75 * Math.abs(Math.sin(th * 1.0))); return p; };
  const TR = [];
  const tr = (yy, w, d, zc, pw, extra = {}) => TR.push({ c: [0, yy, zc], rx: w, rz: d, pow: pw, slot: torsoSlot(yy), sk: tsk(yy), shade: 1, ...extra });
  tr(y.hip - 0.062 * s, 0.085 * wk, 0.07 * dk, 0, 2.2, { shade: 0.82, lv: 1 });
  tr(y.hip - 0.02 * s, hipW * 0.97, hipD, -0.006 * s, 2.5);
  tr(y.hip + 0.04 * s, hipW, hipD * 1.02, -0.008 * s + belly * 0.5, 2.5, { lv: 2 });
  tr(y.waist, waistW, waistD, belly, 2.5);
  tr(lerp(y.waist, y.chest, 0.6), lerp(waistW, chestW, 0.6), lerp(waistD, chestD, 0.7), belly * 0.6 + 0.004 * s, 2.5, { lv: 2 });
  tr(y.chest + 0.035 * s, chestW, chestD, 0.008 * s, 2.5, { fn: bustFn(bust, 0) });
  tr(y.shoulder - 0.05 * s, chestW * 1.04, chestD * 0.96, 0.002 * s, 2.5, { fn: bustFn(bust * 0.45, 0), shade: (th) => 1 - 0.14 * Math.pow(Math.abs(Math.sin(th)), 4), lv: 1 });
  tr(y.shoulder + 0.006 * s, sh + 0.02 * s + g, 0.08 * dk + g, -0.008 * s, 2.3);
  tr(y.shoulder + 0.03 * s, sh * 0.62 + g, 0.068 * dk + g, -0.01 * s, 2.2, { lv: 1 });
  tr(y.neck + 0.004 * s, neckR * 1.5 + g * 0.6, neckR * 1.3 + g * 0.6, -0.01 * s, 2.1, { lv: 2 });
  tr(y.neck + 0.02 * s, neckR * 1.16 + g * 0.5, neckR * 1.12 + g * 0.5, -0.008 * s, 2, { slot: (th) => { const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th); return vneck && a < 0.7 ? (openF ? S.inner : S.skin) : S.top; } });
  { let i = 1; while (i < TR.length - 1 && TR[i].c[1] < hemY) i++; const A0 = TR[i - 1], A1 = TR[i], t = clamp((hemY - A0.c[1]) / (A1.c[1] - A0.c[1])), mk = (yy, add) => ({ ...A0, fn: null, c: [0, yy, lerp(A0.c[2], A1.c[2], t)], rx: lerp(A0.rx, A1.rx, t) + add, rz: lerp(A0.rz, A1.rz, t) + add, slot: torsoSlot(yy), sk: tsk(yy), shade: add ? 0.9 : 1, lv: 1 });
    if (lod < 2 && hemY > TR[0].c[1] + 0.01) TR.splice(i, 0, mk(hemY - 0.004, 0), mk(hemY + 0.003, tucked ? 0 : 0.005)); }
  const TA = lod === 0 ? [0, 0.17, 0.215, 0.62, 1.1, 1.57, 2.1, 2.65] : null, tAngles = TA ? [...TA, Math.PI, ...TA.slice(1).reverse().map(a => 2 * Math.PI - a)] : null;
  loft(M, keepR(TR), L.tn, { caps: 'ab', angles: tAngles });
  // neck
  if (lod < 2) loft(M, [{ c: [0, y.neck - 0.012 * s, -0.01 * s], rx: neckR * 1.02, rz: neckR, slot: S.skin, sk: one(B.chest), shade: 0.93 }, { c: [0, lerp(y.neck, y.chin, 0.55), -0.006 * s], rx: neckR * 0.95, rz: neckR * 0.95, slot: S.skin, sk: [B.neck, B.head, 0.4], shade: 0.88 }, { c: [0, y.chin + HH * 0.16, -0.012 * s], rx: neckR * 0.98, rz: neckR, slot: S.skin, sk: one(B.head), shade: 0.9 }], Math.max(5, L.ln), {});
  // hood (hoodie), collar of a coat: a soft roll behind the neck
  const roll = () => loft(M, [{ c: [0, y.shoulder + 0.0 * s, -0.05 * s], rx: sh * 0.62, rz: 0.06 * s, slot: S.top, sk: one(B.chest), shade: 0.9 }, { c: [0, y.neck + 0.02 * s, -0.062 * s], rx: sh * 0.5, rz: 0.058 * s, slot: S.top, sk: one(B.chest), shade: 0.82 }, { c: [0, y.neck + 0.05 * s, -0.066 * s], rx: sh * 0.3, rz: 0.035 * s, slot: S.top, sk: one(B.chest), shade: 0.78 }], Math.max(5, L.ln), { caps: 'ab' });
  if (lod < 2 && has(2, topId, 1 << 3)) variant(2, 1 << 3, roll);

  // -- arms
  for (const [sd, sg] of [['L', 1], ['R', -1]]) {
    const up = B['arm' + sd], fo = B['fore' + sd], ha = B['hand' + sd], A = J[up], E = J[fo], Wr = J[ha];
    const ga = Math.min(g, 0.016), rU = (f ? 0.042 : 0.049) * s * (1 + 0.12 * b) * (1 - 0.08 * kid) + ga, rE = (f ? 0.033 : 0.039) * s * (1 + 0.08 * b) + ga, rW = (f ? 0.024 : 0.028) * s + (O && O.sleeves === 'long' && !tmpl ? ga * 0.9 : ga * 0.5);
    const short = !tmpl && O.sleeves === 'short', cutY = lerp(A[1], E[1], 0.55);
    const at = t => [lerp(A[0], E[0], t), lerp(A[1], E[1], t), lerp(A[2], E[2], t)], at2 = t => [lerp(E[0], Wr[0], t), lerp(E[1], Wr[1], t), lerp(E[2], Wr[2], t)];
    const R = [];
    const ar = (c, r, slot, sk, shade = 1, lv = 0) => R.push({ c, rx: r, rz: r * 1.04, slot, sk, shade, lv });
    const skU = yy => chain(yy, E[1], 0.045 * s, up, fo), usl = yy => short && yy < cutY ? S.fore : S.upper;
    ar([A[0] - sg * rU * 0.42, A[1] + rU * 0.56, A[2]], rU * 0.5, S.upper, [B.chest, up, 0.6], 1, 1);
    ar([A[0] - sg * rU * 0.1, A[1] + rU * 0.22, A[2]], rU * 0.96, S.upper, [B.chest, up, 0.85]);
    ar(at(0.1), rU * 1.06, S.upper, one(up), 1, 2);
    ar(at(0.24), rU * 1.04, S.upper, one(up), 1, 1);
    if (short) { ar(at(0.55), lerp(rU, rE, 0.5) + 0.004, S.upper, one(up)); ar(at(0.565), lerp(rU, rE, 0.52) - ga, S.fore, one(up)); } else ar(at(0.5), lerp(rU, rE, 0.42), S.upper, one(up), 1, 2);
    ar(at(0.86), rE * 1.04 - (short ? ga : 0), usl(at(0.86)[1]), skU(at(0.86)[1]), 1, 1);
    ar(at(1.0), rE - (short ? ga : 0), S.fore, skU(E[1]));
    ar(at2(0.16), rE * 1.03 - (short ? ga : 0), S.fore, skU(at2(0.16)[1]), 1, 1);
    ar(at2(0.6), lerp(rE, rW, 0.6) - (short ? ga * 0.7 : 0), S.fore, one(fo), 1, 2);
    ar(at2(1.0), rW, S.fore, one(fo), 0.92);
    loft(M, keepR(R), L.ln, { caps: 'ab' });
    // hand: palm faces the thigh (thin in x, wide in z)
    const hs = s * (f ? 0.94 : 1.03) * (1 - 0.06 * kid), hx = Wr[0], hy = Wr[1], hz = Wr[2];
    if (det >= 2) {
      loft(M, [{ c: [hx, hy + 0.012, hz], rx: 0.019 * hs, rz: 0.025 * hs, slot: S.skin, sk: one(ha) }, { c: [hx, hy - 0.035 * hs, hz + 0.004], rx: 0.016 * hs, rz: 0.041 * hs, pow: 2.6, slot: S.skin, sk: one(ha) },
        { c: [hx - sg * 0.002, hy - 0.085 * hs, hz + 0.008], rx: 0.014 * hs, rz: 0.04 * hs, pow: 3, slot: S.skin, sk: one(ha) }, { c: [hx - sg * 0.008, hy - 0.135 * hs, hz + 0.016], rx: 0.012 * hs, rz: 0.035 * hs, pow: 3, slot: S.skin, sk: one(ha), shade: 0.95 },
        { c: [hx - sg * 0.018, hy - 0.172 * hs, hz + 0.02], rx: 0.009 * hs, rz: 0.027 * hs, pow: 2.6, slot: S.skin, sk: one(ha), shade: 0.9 }], det >= 2 ? 8 : 5, { caps: 'b', bulge: 0.008 });
      if (det >= 2) loft(M, [{ c: [hx, hy - 0.03 * hs, hz + 0.036 * hs], rx: 0.012 * hs, rz: 0.013 * hs, slot: S.skin, sk: one(ha) }, { c: [hx - sg * 0.004, hy - 0.07 * hs, hz + 0.052 * hs], rx: 0.011 * hs, rz: 0.011 * hs, slot: S.skin, sk: one(ha) }, { c: [hx - sg * 0.008, hy - 0.105 * hs, hz + 0.058 * hs], rx: 0.008 * hs, rz: 0.008 * hs, slot: S.skin, sk: one(ha), shade: 0.92 }], 5, { caps: 'ab', bulge: 0.006 });
    } else loft(M, [{ c: [hx, hy, hz], rx: 0.02 * hs, rz: 0.032 * hs, slot: S.skin, sk: one(ha) }, { c: [hx, hy - 0.09 * hs, hz + 0.008], rx: 0.017 * hs, rz: 0.04 * hs, slot: S.skin, sk: one(ha), lv: 1 }, { c: [hx, hy - 0.165 * hs, hz + 0.016], rx: 0.011 * hs, rz: 0.028 * hs, slot: S.skin, sk: one(ha) }].filter(q => (q.lv || 0) <= 2 - lod), L.ln, { caps: 'b' });
  }

  // -- legs and shoes
  const wide = tmpl ? 1.14 : { jeans: 1.13, trousers: 1.2, leggings: 1.03, shorts: 1.16, skirt: 1.0, dress: 1.0 }[O.bottom] ?? 1.1, bare = !tmpl && O.legsBare;
  for (const [sd, sg] of [['L', 1], ['R', -1]]) {
    const th = B['thigh' + sd], shn = B['shin' + sd], ft = B['foot' + sd], Hp = J[th], Kn = J[shn], An = J[ft];
    const lk = s * (1 + 0.13 * b) * (1 - 0.1 * kid), rT = (f ? 0.084 : 0.08) * lk, rK = (f ? 0.05 : 0.053) * lk, rC = (f ? 0.051 : 0.055) * lk, rA = (f ? 0.031 : 0.035) * s;
    const wU = bare && O.bottom !== 'shorts' ? 1 : wide, wL = bare ? 1 : wide, hemR = bare ? 0 : (wide - 1) * 0.08 + 0.012;
    const at = t => [lerp(Hp[0], Kn[0], t), lerp(Hp[1], Kn[1], t), lerp(Hp[2], Kn[2], t)], at2 = t => [lerp(Kn[0], An[0], t), lerp(Kn[1], An[1], t), lerp(Kn[2], An[2], t)];
    const R = [], lr = (c, r, slot, sk, shade = 1, dz = 0, lv = 0) => R.push({ c: [c[0], c[1], c[2] + dz], rx: r, rz: r * 1.06, slot, sk, shade, lv });
    const skK = yy => chain(yy, Kn[1], 0.05 * s, th, shn);
    lr([Hp[0] - sg * 0.012 * s, Hp[1] + rT * 0.75, Hp[2]], rT * 0.62, !tmpl && Hp[1] + rT * 0.75 > hemY ? S.top : S.thigh, [B.hips, th, 0.6], 1, 0, 1);
    lr([Hp[0] + sg * 0.004 * s, Hp[1] + rT * 0.2, Hp[2]], rT * wU, !tmpl && Hp[1] + rT * 0.2 > hemY + 0.004 ? S.top : S.thigh, [B.hips, th, 0.85]);
    lr(at(0.14), rT * wU * 1.01, S.thigh, one(th), 1, 0, 2);
    lr(at(0.5), lerp(rT, rK, 0.52) * wU, S.thigh, one(th), 1, 0, 1);
    if (!tmpl && O.bottom === 'shorts') { lr(at(0.62), lerp(rT, rK, 0.62) * wU, S.thigh, one(th)); lr(at(0.635), lerp(rT, rK, 0.66), S.shin, one(th)); }
    lr(at(0.88), rK * 1.06 * (O && O.bottom === 'shorts' && !tmpl ? 1 : wU), tmpl ? S.shin : (O.bottom === 'shorts' ? S.shin : S.thigh), skK(at(0.88)[1]), 1, 0, 1);
    lr(at(1.0), rK * wL, S.shin, skK(Kn[1]), 1, 0.004 * s);
    lr(at2(0.14), rK * 0.98 * wL, S.shin, skK(at2(0.14)[1]), 1, 0, 1);
    lr(at2(0.36), Math.max(rC, bare ? 0 : rK * 0.9 * wL), S.shin, one(shn), 1, bare ? -0.008 * s : 0);
    lr(at2(0.72), Math.max(lerp(rC, rA, 0.75), bare ? 0 : rA + hemR), S.shin, one(shn), 1, 0, 2);
    lr(at2(0.97), rA + hemR, S.shin, one(shn), 0.9);
    loft(M, keepR(R), L.ln, { caps: 'ab' });
    // shoe: rings in the x-y plane from heel to toe
    const fs = s * (f ? 0.93 : 1.02) * (1 - 0.05 * kid), ax = An[0], heel = tmpl ? 0 : O.heel || 0, fw = 0.046 * fs, sl = S.shoes, fk = one(ft);
    const shoe = (z, w, h, y0 = 0, shade = 1, lv = 0) => ({ plane: 'xy', c: [ax, y0 + h / 2, z * fs + An[2]], rx: w, rz: h / 2, pow: 3, slot: sl, sk: fk, shade, lv });
    { const sn = det >= 2 ? 6 : det === 1 ? 5 : 4; loft(M, keepR([shoe(-0.075, fw * 0.6, 0.05 + heel, 0, 0.85, 1), shoe(-0.055, fw * 0.92, 0.075 + heel), shoe(0.0, fw, 0.082 + heel * 0.6, heel * 0.25, 1, 2), shoe(0.07, fw * 1.06, 0.06, 0, 1, 1), shoe(0.135, fw * 1.0, 0.045), shoe(0.175, fw * 0.62, 0.032, 0, 0.9, 2)]), sn, { caps: 'ab', bulge: 0.01, th0: Math.PI / sn }); }
  }

  // -- skirt / dress / coat tails: a shell from the hips down, carried by the pelvis and (towards the hem) the thighs
  const shell = (len, slot, flare, thick, openFront) => {
    const y0 = y.hip + 0.05 * s, y1 = y.hip - len, R = [];
    const sN = det >= 2 ? 3 : det === 1 ? 2 : 1;
    for (let i = 0; i <= sN; i++) { const t = i / sN, yy = lerp(y0, y1, t), w = hipW + thick + flare * t * (0.6 + 0.4 * t), d = hipD + thick + flare * 0.8 * t;
      R.push({ c: [0, yy, -0.006 * s], rx: w, rz: d, pow: 2.4, shade: i === sN ? 0.86 : 1 - 0.04 * i,
        slot: openFront ? ((th) => { const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th); return a < 0.22 ? S.bottom : slot; }) : slot,
        sk: (th, p) => { const side = p[0] > 0.02 ? B.thighL : p[0] < -0.02 ? B.thighR : B.hips; return side === B.hips ? one(B.hips) : [B.hips, side, t * 0.55 * Math.min(1, Math.abs(p[0]) / (hipW * 0.6))]; } }); }
    loft(M, R, Math.max(5, L.tn), { caps: 'b' });
  };
  const skLen = tmpl ? 0 : (O.skirtLen || 0.5) * (y.hip - y.ankle) * 0.95;
  if (lod === 2) variant(1, 0b110, () => shell((y.hip - y.knee) * 1.05, S.bottom, 0.05 * s, 0.006, false));
  else if (has(1, lowerId, 1 << 1)) variant(1, 1 << 1, () => shell(tmpl ? (y.hip - y.knee) * 0.92 : skLen, S.bottom, 0.035 * s + (tmpl ? 0.02 : (O.skirtLen - 0.4) * 0.06), 0.006, false));
  if (lod < 2 && has(1, lowerId, 1 << 2)) variant(1, 1 << 2, () => shell(tmpl ? (y.hip - y.ankle) * 0.72 : skLen, S.bottom, 0.07 * s, 0.006, false));
  if (has(2, topId, 1 << 2)) variant(2, 1 << 2, () => shell((y.hip - y.knee) * (tmpl ? 0.8 : lerp(0.55, 1.05, (T.seed % 97) / 97)), S.top, 0.02 * s, g + 0.004, !tmpl && O.open));
  if (!tmpl && O.apron) { M.vr = [-1, 0]; const R = []; for (let i = 0; i <= 2; i++) { const t = i / 2; R.push({ c: [0, lerp(y.hip + 0.05 * s, y.knee + 0.1 * s, t), 0.03 * s], rx: hipW * 0.82, rz: hipD * 0.78 + 0.012, pow: 2.6, slot: S.band, sk: one(B.hips), shade: 0.95 }); } loft(M, R, L.tn, { caps: 'b' }); }

  // -- head
  const hy0 = y.chin, hz0 = 0.012 * s, hk = one(B.head), XE = F.XE;
  const hpt = (v, th, out = 0) => { const p = headPt(T, v, th, out); return [p[0], p[1] + hy0, p[2] + hz0]; };
  const faceUV = det >= 2 && !tmpl;
  {
    const rows = [];
    for (const v of L.hv) { const row = []; for (let k = 0; k < L.hn; k++) { const th = k / L.hn * Math.PI * 2, p = hpt(v, th), front = Math.cos(th) > -0.02;
      if (faceUV) row.push(M.v(p[0], p[1], p[2], S.white, front ? 1 : 0.94, hk, front ? clamp(p[0] / XE * 0.5 + 0.5, 0.004, 0.996) : (p[0] > 0 ? 0.996 : 0.004), clamp((p[1] - hy0 - F.y0) / (F.y1 - F.y0), 0.1, 0.996)));
      else row.push(M.v(p[0], p[1], p[2], S.skin, faceUV ? 0.84 : (front ? 1 : 0.9), hk)); } rows.push(row); }
    const n = L.hn; for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k < n; k++) { const a = rows[i][k], bb = rows[i][(k + 1) % n], c = rows[i + 1][(k + 1) % n], d = rows[i + 1][k]; M.tri(a, bb, c); M.tri(a, c, d); }
    const top = hpt(1, 0), tc = M.v(0, top[1], hz0 - 0.012, S.skin, 0.9, hk), last = rows[rows.length - 1]; for (let k = 0; k < n; k++) M.tri(tc, last[k], last[(k + 1) % n]);
    const bc = M.v(0, hy0 - 0.002, hz0 + HH * 0.15, S.skin, 0.8, hk); for (let k = 0; k < n; k++) M.tri(bc, rows[0][(k + 1) % n], rows[0][k]);
  }
  const zf = v => headPt(T, v, 0)[2] + hz0, vOf = yy => yy / HH, fy = yy => yy + hy0;
  if (det >= 2) {
    // nose: a small faceted wedge, textured by the same front projection as the face
    const ny = F.noseY, ey = F.ey, nw = F.noseW, Ln = (T.face?.noseL || 1) * s * (1 - 0.25 * kid) * (f ? 0.74 : 0.92), my = lerp(ey, ny, 0.52);
    const P = (x, yy, dz) => { const uvx = clamp(x / XE * 0.5 + 0.5, 0, 1), uvy = (yy - F.y0) / (F.y1 - F.y0); const zz = headPt(T, vOf(yy), Math.asin(clamp(x / (F.hw * 1.0), -1, 1)) * 0.9)[2] + hz0; return faceUV ? M.v(x, fy(yy), zz + dz, S.white, 1, hk, uvx, uvy) : M.v(x, fy(yy), zz + dz, S.skin, 1, hk); };
    const Tp = P(0, ey + 0.007, 0.0035), Mi = P(0, my, 0.0135 * Ln), Pt = P(0, ny + 0.011, 0.0255 * Ln), Bs = P(0, ny - 0.007, 0.004), Bm = P(0, ny + 0.0005, 0.016 * Ln);
    for (const sg of [1, -1]) {
      const TL = P(sg * nw * 0.5, ey + 0.006, 0.0005), SL = P(sg * nw * 0.82, my, 0.001), AL = P(sg * nw * 1.0, ny + 0.026, 0.0005), WL = P(sg * nw * 1.12, ny + 0.004, 0.0035), WB = P(sg * nw * 0.7, ny - 0.005, 0.002), NL = P(sg * nw * 0.62, ny + 0.009, 0.0165 * Ln), XL = P(sg * nw * 1.02, ny + 0.012, 0.0085 * Ln);
      const t3 = (a, bq, c) => { const q = M.p, A = [q[a * 3], q[a * 3 + 1], q[a * 3 + 2]], Bv = [q[bq * 3], q[bq * 3 + 1], q[bq * 3 + 2]], C = [q[c * 3], q[c * 3 + 1], q[c * 3 + 2]], ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2], nx = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz = ux * vy - uy * vx, cx = (A[0] + Bv[0] + C[0]) / 3, cy = (A[1] + Bv[1] + C[1]) / 3 - fy(lerp(ny, ey, 0.4)), cz = (A[2] + Bv[2] + C[2]) / 3 - (zf(vOf(ny)) - 0.012); if (nx * cx + ny2 * cy + nz * cz >= 0) M.tri(a, bq, c); else M.tri(a, c, bq); };   // wound so that it faces away from the inside of the nose
      t3(Tp, Mi, TL); t3(TL, Mi, SL); t3(Mi, NL, SL); t3(Mi, Pt, NL); t3(SL, NL, XL); t3(SL, XL, AL); t3(AL, XL, WL); t3(NL, Bm, XL); t3(NL, Pt, Bm); t3(XL, Bm, WB); t3(XL, WB, WL); t3(Bm, Bs, WB);
    }
    // ears
    for (const sg of [1, -1]) { const R = headRow(T, 0.42), ex = sg * (R.w * 0.985), ez = (R.zF + R.zB) / 2 - 0.016 * s + hz0, rings = [];
      for (let i = 0; i <= 4; i++) { const a = i / 4, yy = lerp(0.32, 0.53, a) * HH, rr = Math.sin(lerp(0.25, 2.75, a)) * (0.7 + 0.3 * a); rings.push({ c: [ex + sg * 0.004 * rr, fy(yy), ez - 0.004 * a], rx: 0.0075 * rr + 0.001, rz: 0.0155 * rr * s + 0.002, slot: S.skin, shade: 0.9, sk: hk, fn: (th, p) => { p[0] += sg * 0.006 * Math.max(0, -Math.cos(th)) * rr; return p; } }); }
      loft(M, rings, 6, { caps: 'ab' }); }
  } else if (det === 1) {
    // mid tier: a nose stub and dark eye / brow marks so the head reads as a face
    loft(M, [{ c: [0, fy(F.ey), zf(0.47) - 0.004], rx: 0.009, rz: 0.006, slot: S.skin, sk: hk, shade: 0.92 }, { c: [0, fy(F.noseY), zf(0.33) + 0.006], rx: 0.015, rz: 0.016, slot: S.skin, sk: hk, shade: 0.95 }], 4, { caps: 'b' });
    for (const sg of [1, -1]) { const x = sg * F.ex, z = zf(0.47) - 0.006, e = F.eyeW * 0.6, a = M.v(x - e, fy(F.ey - 0.004), z, S.dark, 1, hk), b2 = M.v(x + e, fy(F.ey - 0.004), z, S.dark, 1, hk), c = M.v(x + e, fy(F.ey + 0.011), z + 0.001, S.dark, 1, hk), d = M.v(x - e, fy(F.ey + 0.011), z + 0.001, S.dark, 1, hk); M.tri(a, b2, c); M.tri(a, c, d); }
    { const z = zf(0.2) + 0.0015, e = F.mouthW * 0.42, a = M.v(-e, fy(F.mouthY - 0.004), z, S.lip, 1, hk), b2 = M.v(e, fy(F.mouthY - 0.004), z, S.lip, 1, hk), c = M.v(e, fy(F.mouthY + 0.004), z, S.lip, 1, hk), d = M.v(-e, fy(F.mouthY + 0.004), z, S.lip, 1, hk); M.tri(a, b2, c); M.tri(a, c, d); }
  }

  // -- hair
  const hairT = tmpl ? 0.014 : { buzz: 0.003, short: 0.009, balding: 0.006, shortf: 0.016, medium: 0.017, bob: 0.014, long: 0.013, bun: 0.009, pony: 0.009, bald: 0 }[T.hairStyle] ?? 0.012;
  const capShell = (line, thick, slot, upper = null, shadeK = 1) => {
    const n = L.hn, m = L.hm, rows = [];
    for (let j = -1; j <= m; j++) { const row = []; for (let k = 0; k < n; k++) { const th = k / n * Math.PI * 2, lo = line(th), hi = upper ? Math.max(lo, upper(th)) : 0.985, t = Math.max(0, j) / m, v = lerp(lo, hi, t);
      const nz = det >= 2 && j > 0 ? 0.88 + 0.24 * (((k * 2654435761 + j * 40503 + T.seed * 97) >>> 0) % 1000) / 1000 : 1, out = j < 0 || hi - lo < 0.021 ? -0.004 : thick * nz * (j === 0 ? 0.55 : upper && j === m ? 0.3 : 1), p = hpt(v, th, out);
      row.push(M.v(p[0], p[1], p[2], slot, shadeK * (j <= 0 ? 0.86 : 0.94 + 0.1 * t) * (det >= 2 ? 0.96 + 0.08 * ((k * 7 + j * 3) % 5) / 5 : 1), hk)); } rows.push(row); }
    for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k < n; k++) { const a = rows[i][k], bb = rows[i][(k + 1) % n], c = rows[i + 1][(k + 1) % n], d = rows[i + 1][k]; M.tri(a, bb, c); M.tri(a, c, d); }
    if (!upper) { const p = hpt(1, 0, thick), tc = M.v(0, p[1], hz0 - 0.012, slot, shadeK * 1.05, hk), last = rows[rows.length - 1]; for (let k = 0; k < n; k++) M.tri(tc, last[k], last[(k + 1) % n]); }
  };
  const hl = th => hairline(T, th);
  const tmplLine = th => { const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th) * 180 / Math.PI; return a < 40 ? 0.8 : a < 100 ? lerp(0.8, 0.52, smooth(40, 100, a)) : lerp(0.52, 0.25, smooth(100, 150, a)); };
  const line = tmpl ? tmplLine : hl;
  if (tmpl) variant(0, lod === 2 ? 0b11111110 : 0b111110, () => capShell(line, hairT, S.hair));
  else if (T.hairStyle === 'balding') capShell(th => { const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th) * 180 / Math.PI; return lerp(0.7, hairline({ ...T, hairStyle: 'short' }, th), smooth(64, 78, a)); }, hairT, S.hair, () => 0.7);
  else if (hairId) capShell(line, hairT, S.hair);
  const bell = (vEnd, wide, thick) => {                       // hair falling behind the ears / on the neck and shoulders
    const R = [], steps = det >= 2 ? 6 : 2;
    for (let i = 0; i <= steps; i++) { const t = i / steps, v = lerp(0.7, vEnd, t), hr = headRow(T, clamp(v, 0.18, 0.7)), below = v < 0.1, w = hr.w + thick + (below ? wide * smooth(0.1, vEnd, v) : 0) + wide * 0.4 * Math.sin(t * Math.PI);
      const zb = hr.zB - thick - (below ? 0.01 * smooth(0.1, vEnd, v) : 0), zfr = below ? -0.012 * s : lerp(hr.zF * 0.2, 0.004, smooth(0.7, 0.4, v));
      R.push({ c: [0, hy0 + v * HH, hz0 + (zb + zfr) / 2], rx: w * (i === steps ? 0.82 : 1), rz: (zfr - zb) / 2, pow: 2.15, slot: S.hair, shade: (th) => (0.9 + 0.12 * Math.abs(Math.sin(th * 5))) * (1 - 0.1 * t), sk: v > -0.05 ? hk : [B.head, B.chest, smooth(-0.05, vEnd, v) * 0.8] }); }
    loft(M, R, L.hn >= 16 ? 14 : Math.max(5, L.hn), { caps: 'b' });
  };
  if (has(0, hairId, 1 << 2)) variant(0, 1 << 2, () => bell(tmpl ? -0.02 : T.hairStyle === 'bob' ? -0.03 : 0.08, 0.008, hairT + 0.004));
  if (has(0, hairId, 1 << 3)) variant(0, 1 << 3, () => bell(tmpl ? -0.85 : -0.55 - ((T.seed >> 3) % 7) * 0.09, 0.012, hairT + 0.002));
  if (lod < 2 && has(0, hairId, 1 << 4)) variant(0, 1 << 4, () => { const p = hpt(0.74, Math.PI, 0.028); ball(M, p, 0.04 * s, 0.038 * s, 0.036 * s, Math.max(5, L.ln), det >= 2 ? 5 : 3, S.hair, 0.92, hk); });
  if (lod < 2 && has(0, hairId, 1 << 5)) variant(0, 1 << 5, () => { const p = hpt(0.7, Math.PI, 0.012), R = [], pN = det >= 2 ? 4 : 2; for (let i = 0; i <= pN; i++) { const t = i / pN; R.push({ c: [0, p[1] - t * HH * 1.05, p[2] - 0.022 * Math.sin(t * 2.2) - 0.008], rx: lerp(0.026, 0.012, t) * s, rz: lerp(0.024, 0.01, t) * s, slot: S.hair, shade: 0.95 - 0.1 * t, sk: t < 0.35 ? hk : [B.head, B.chest, (t - 0.35) * 0.9] }); } loft(M, R, Math.max(5, L.ln), { caps: 'ab', bulge: 0.01 }); });
  // -- hats
  const hatLine = th => { const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th) * 180 / Math.PI; return a < 60 ? 0.735 : lerp(0.735, 0.5, smooth(60, 150, a)); };
  if (lod < 2 && has(0, hatId, 1 << 6)) variant(0, 1 << 6, () => { capShell(hatLine, hairT + 0.011, S.hat); if (det < 2) return; const R = [0.7, 0.76].map((v, i) => { const hr = headRow(T, v); return { c: [0, hy0 + (v + (i ? 0.0 : -0.03)) * HH, hz0 + (hr.zF + hr.zB) / 2], rx: hr.w + hairT + 0.016, rz: (hr.zF - hr.zB) / 2 + hairT + 0.016, pow: 2.2, slot: S.hat, shade: 0.88, sk: hk }; }); loft(M, R, L.hn, {}); });
  if (lod < 2 && has(0, hatId, 1 << 7)) variant(0, 1 << 7, () => {
    const peaked = !tmpl && O.hat === 'peaked', flat = th => 0.75;
    if (peaked && det >= 2) { const R = [[0.74, 0.008, 0.9], [0.86, 0.012, 0.95], [0.99, 0.034, 1], [1.03, 0.03, 1.05]].map(([v, o, shd]) => { const hr = headRow(T, Math.min(v, 0.8)); return { c: [0, hy0 + v * HH, hz0 + (hr.zF + hr.zB) / 2 + (v > 0.9 ? 0.008 : 0)], rx: hr.w + o, rz: (hr.zF - hr.zB) / 2 + o, pow: 2.2, slot: S.hat, shade: shd, sk: hk }; }); loft(M, R, L.hn, { caps: 'b' });
      const hr = headRow(T, 0.78); loft(M, [0.76, 0.8].map(v => ({ c: [0, hy0 + v * HH, hz0 + (hr.zF + hr.zB) / 2], rx: hr.w + 0.0095, rz: (hr.zF - hr.zB) / 2 + 0.0095, pow: 2.2, slot: S.band, shade: 1, sk: hk })), L.hn, {}); }
    else capShell(flat, hairT + 0.009, S.hat);
    const zv = zf(0.76); loft(M, [{ c: [0, hy0 + 0.755 * HH, zv + 0.022], rx: F.hw * 0.86, rz: 0.058, pow: 2.4, slot: peaked ? S.dark : S.hat, shade: 0.8, sk: hk }, { c: [0, hy0 + 0.765 * HH, zv + 0.02], rx: F.hw * 0.84, rz: 0.056, pow: 2.4, slot: peaked ? S.dark : S.hat, shade: 0.95, sk: hk }], Math.max(6, L.ln), { caps: 'ab' });
  });

  // -- things carried
  const ck = one(B.chest);
  if (has(3, accId, 1 << 1)) variant(3, 1 << 1, () => { boxy(M, [0, lerp(y.waist, y.shoulder, 0.52), -(chestD + 0.07 * s)], 0.135 * s, 0.2 * s, 0.07 * s, S.bag, 1, ck, 4, det >= 2 ? 8 : 4); if (false) for (const sg of [1, -1]) loft(M, [{ c: [sg * sh * 0.62, y.shoulder + 0.012 * s + g, -0.02], rx: 0.024 * s, rz: 0.075 * s + g, pow: 3, slot: S.bag, sk: ck, shade: 0.85 }, { c: [sg * sh * 0.72, y.chest + 0.02, 0.0], rx: 0.02 * s, rz: chestD + 0.014, pow: 3, slot: S.bag, sk: ck, shade: 0.85 }], 6, {}); });
  if (lod < 2 && has(3, accId, 1 << 2)) variant(3, 1 << 2, () => { boxy(M, [-(hipW + 0.05 * s), y.hip + 0.03 * s, -0.01], 0.045 * s, 0.11 * s, 0.14 * s, S.bag, 1, [B.hips, B.spine, 0.3], 4, det >= 2 ? 8 : 4);
    if (det >= 2) { const R = [], N = 6; for (let i = 0; i <= N; i++) { const t = i / N; R.push({ c: [lerp(-(hipW + 0.035 * s), sh * 0.5, t), lerp(y.hip + 0.13 * s, y.shoulder + 0.016 * s + g, t), 0], rx: 0.016 * s, rz: lerp(hipD, chestD, t) * (0.9 + 0.25 * Math.sin(t * Math.PI)) + g + 0.012, pow: 3, slot: S.bag, sk: ck, shade: 0.8 }); } loft(M, R, 6, {}); } });
  if (lod < 2 && has(3, accId, 1 << 3)) variant(3, 1 << 3, () => { const Wr = J[B.handR]; boxy(M, [Wr[0] - 0.012, Wr[1] - 0.29 * s, Wr[2] + 0.02], 0.05 * s, 0.11 * s, 0.16 * s, S.bag, 1, one(B.handR), 4, det >= 2 ? 8 : 4); if (det >= 2) loft(M, [{ c: [Wr[0] - 0.012, Wr[1] - 0.19 * s, Wr[2] + 0.02], rx: 0.008, rz: 0.07 * s, pow: 3, slot: S.bag, sk: one(B.handR), shade: 0.8 }, { c: [Wr[0] - 0.012, Wr[1] - 0.1 * s, Wr[2] + 0.02], rx: 0.008, rz: 0.035 * s, pow: 3, slot: S.bag, sk: one(B.handR), shade: 0.8 }], 6, { caps: 'b' }); });
  if (has(3, accId, 1 << 4)) variant(3, 1 << 4, () => boxy(M, [0, lerp(y.waist, y.shoulder, 0.7), -(chestD + 0.2 * s)], 0.2 * s, 0.21 * s, 0.19 * s, S.bag, 1, ck, 8, det >= 2 ? 8 : 4));
  if (!tmpl && T.acc?.phoneInHand && det >= 1) { const Wr = J[B.handL]; boxy(M, [Wr[0] - 0.02, Wr[1] - 0.09, Wr[2] + 0.03], 0.005, 0.07, 0.036, S.dark, 1, one(B.handL), 5, 4); }
  return { M, K };
}

// ---- palette of a person (16 colours, sRGB 0..1) ----------------------------------------------------------------------------
export function paletteOf(T) {
  const O = T.outfit, P = new Array(PAL_W).fill(null).map(() => [1, 1, 1]), S = SLOT;
  const legs = O.legsBare ? (O.tights || T.skin) : O.bottomCol;
  P[S.skin] = T.skin; P[S.top] = O.topCol; P[S.upper] = O.topCol; P[S.bottom] = O.bottomCol; P[S.hair] = T.hair; P[S.shoes] = O.shoes;
  P[S.fore] = O.sleeves === 'short' ? T.skin : O.topCol; P[S.shin] = legs; P[S.thigh] = (O.bottom === 'skirt' || O.bottom === 'dress') ? legs : O.bottomCol;
  P[S.inner] = O.inner; P[S.hat] = O.hatCol || T.hair; P[S.bag] = T.bagCol || [0.15, 0.15, 0.16]; P[S.band] = O.band || O.apron || O.topCol; P[S.dark] = [0.09, 0.07, 0.07]; P[S.lip] = mix3(T.lip, T.skin, 0.35); P[S.white] = [1, 1, 1];
  return P;
}
/** Variant ids of a person for the instanced tiers: [hair, lower, top, accessory]. */
export function variantsOf(T) {
  const O = T.outfit;
  return [O.hat ? HAT_ID[O.hat] : (HAIR_ID[T.hairStyle] ?? 1), (O.bottom === 'skirt' || O.bottom === 'dress') ? (O.skirtLen > 0.62 ? 2 : 1) : 0, TOP_ID[O.top] ?? 0, ACC_ID[T.acc?.bag || 'none'] ?? 0];
}
const lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

// ---- near tier: SkinnedMesh ---------------------------------------------------------------------------------------------------
const UVW = 10 / 256;
export function bodyGeometry(T, lod = 0) {
  const { M, K } = buildBody(T, lod, false), n = M.n, P = paletteOf(T).map(c => c.map(lin));
  const col = new Float32Array(n * 3), uv = new Float32Array(n * 2), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = P[M.c[i * 2]] || P[0], sh = M.c[i * 2 + 1]; col[i * 3] = c[0] * sh; col[i * 3 + 1] = c[1] * sh; col[i * 3 + 2] = c[2] * sh;
    const u = M.uv[i * 2]; uv[i * 2] = u < 0 ? UVW : u; uv[i * 2 + 1] = u < 0 ? UVW : M.uv[i * 2 + 1];
    si[i * 4] = M.sk[i * 3]; si[i * 4 + 1] = M.sk[i * 3 + 1]; sw[i * 4] = 1 - M.sk[i * 3 + 2]; sw[i * 4 + 1] = M.sk[i * 3 + 2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(M.p, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(M.idx); geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, T.height / 2, 0), T.height * 0.75); geo.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, T.height, 0.5));
  return { geo, K, tris: M.idx.length / 3, verts: n };
}
export function makeRig(K) {
  const bones = BONES.map(n => { const b = new THREE.Bone(); b.name = n; return b; });
  BONES.forEach((_, i) => { const p = PARENT[i], a = K.J[i], q = p < 0 ? [0, 0, 0] : K.J[p]; bones[i].position.set(a[0] - q[0], a[1] - q[1], a[2] - q[2]); if (p >= 0) bones[p].add(bones[i]); });
  bones[0].updateMatrixWorld(true);
  return { bones, skeleton: new THREE.Skeleton(bones), K, hipY: K.J[0][1] };
}
let _faceMat = null;
export function faceTexture(T, size = 256, canvas = null) {
  const cv = canvas || document.createElement('canvas'); cv.width = cv.height = size; paintFace(cv, T);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; return tex;
}
/** A complete near-tier figure: { mesh (SkinnedMesh; add it to the scene), rig, T, pose (Float32Array), apply(), dispose() }. */
export function makeFigure(T, { lod = 0, faceSize = 256 } = {}) {
  const { geo, K, tris } = bodyGeometry(T, lod), rig = makeRig(K), tex = faceTexture(T, faceSize);
  const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  const mesh = new THREE.SkinnedMesh(geo, mat); mesh.name = 'vrc-person'; mesh.add(rig.bones[0]); mesh.bind(rig.skeleton); mesh.frustumCulled = false;
  const pose = newPose();
  return { mesh, rig, T, K, tris, pose, apply() { applyPose(rig, pose); }, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); rig.skeleton.dispose(); mesh.parent?.remove(mesh); } };
}

// ---- poses ------------------------------------------------------------------------------------------------------------------------
// pose vector: 0 hipY 1 lean 2 roll 3 yaw 4 spine 5 chestYaw 6 chestRoll 7 headYaw 8 headPitch | arm L 9 swing 10 out 11 elbow 12 twist | arm R 13..16 |
// leg L 17 hip 18 out 19 knee 20 foot | leg R 21..24 | 25 hipZ | 26 handL 27 handR
export const POSE_N = 28;
export const newPose = () => new Float32Array(POSE_N);
export function applyPose(rig, P) {
  const b = rig.bones;
  b[0].position.y = rig.hipY + P[0]; b[0].position.z = P[25]; b[0].rotation.set(P[1], P[3], P[2]);
  b[1].rotation.set(P[4] * 0.5, P[5] * 0.4, P[6] * 0.5); b[2].rotation.set(P[4] * 0.5, P[5] * 0.6, P[6] * 0.5);
  b[3].rotation.set(P[8] * 0.35, P[7] * 0.4, 0); b[4].rotation.set(P[8] * 0.65, P[7] * 0.6, 0);
  b[5].rotation.set(-P[9], -P[12], P[10]); b[6].rotation.set(-P[11], 0, 0); b[7].rotation.set(-P[26], 0, 0);
  b[8].rotation.set(-P[13], P[16], -P[14]); b[9].rotation.set(-P[15], 0, 0); b[10].rotation.set(-P[27], 0, 0);
  b[11].rotation.set(-P[17], 0, P[18]); b[12].rotation.set(P[19], 0, 0); b[13].rotation.set(P[20], 0, 0);
  b[14].rotation.set(-P[21], 0, -P[22]); b[15].rotation.set(P[23], 0, 0); b[16].rotation.set(P[24], 0, 0);
}
export const blendPose = (out, a, b, t) => { for (let i = 0; i < POSE_N; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; };
/** Walk / run cycle. ph: phase (2π = two steps), amp: 0.3 slow … 1 walk … 1.7 run. K: skeleton(T). */
export function poseWalk(P, ph, amp, K, o = {}) {
  P.fill(0);
  const run = clamp(amp - 1.05, 0, 0.7) / 0.7, a = Math.min(amp, 1.25), s = Math.sin(ph), c = Math.cos(ph), sw = (0.46 + 0.16 * run) * a;
  const knee = (x) => (0.1 + 0.05 * run) + (0.82 + 0.5 * run) * a * Math.pow(Math.max(0, Math.cos(x - 0.5)), 1.6);
  P[17] = sw * s + 0.04 + 0.1 * run; P[21] = -sw * s + 0.04 + 0.1 * run; P[19] = knee(ph); P[23] = knee(ph + Math.PI);
  P[20] = -(P[17] - P[19]) * 0.55 + 0.3 * a * Math.max(0, -s) * Math.max(0, c); P[24] = -(P[21] - P[23]) * 0.55 + 0.3 * a * Math.max(0, s) * Math.max(0, -c);
  P[0] = -(K ? K.legLen : 0.9) * (0.018 + 0.02 * run) * a * (1 - Math.cos(2 * ph)) * 0.5 - (K ? K.legLen : 0.9) * 0.012 * a;
  P[1] = 0.03 + 0.12 * run + (o.stoop || 0) * 0.12; P[4] = 0.03 + (o.stoop || 0) * 0.3; P[3] = 0.07 * a * s; P[5] = -0.16 * a * s; P[2] = 0.03 * a * c; P[8] = (o.stoop || 0) * -0.2;
  const as = (0.34 + 0.35 * run) * a, el = 0.16 + 1.25 * run;
  P[9] = -as * s; P[13] = as * s; P[10] = 0.05; P[14] = 0.05; P[11] = el + 0.22 * a * Math.max(0, -s); P[15] = el + 0.22 * a * Math.max(0, s);
  return P;
}
const POSES = {
  stand: P => { P[10] = -0.02; P[14] = -0.02; P[11] = 0.12; P[15] = 0.12; P[18] = 0.03; P[22] = 0.03; },
  phone: P => { P[10] = 0.06; P[11] = 0.12; P[13] = 0.55; P[14] = 0.02; P[15] = 1.75; P[16] = 0.5; P[8] = 0.38; P[4] = 0.08; P[18] = 0.03; P[22] = 0.03; },
  film: P => { P[9] = 1.05; P[10] = 0.1; P[11] = 0.95; P[12] = 0.3; P[13] = 1.05; P[14] = 0.1; P[15] = 0.95; P[16] = 0.3; P[8] = -0.05; },
  talk: P => { P[10] = 0.06; P[11] = 0.2; P[13] = 0.35; P[14] = 0.12; P[15] = 1.2; P[16] = 0.2; },
  sit: P => { P[0] = -1; P[17] = 1.48; P[21] = 1.48; P[19] = 1.5; P[23] = 1.5; P[18] = 0.06; P[22] = 0.06; P[9] = 0.35; P[13] = 0.35; P[11] = 0.75; P[15] = 0.75; P[10] = 0.05; P[14] = 0.05; P[1] = -0.06; P[4] = 0.1; },
  drive: P => { P[0] = -1; P[17] = 1.3; P[21] = 1.3; P[19] = 0.85; P[23] = 0.85; P[18] = 0.1; P[22] = 0.1; P[9] = 0.95; P[13] = 0.95; P[11] = 0.75; P[15] = 0.75; P[10] = 0.1; P[14] = 0.1; P[12] = 0.25; P[16] = 0.25; P[1] = -0.22; P[4] = 0.1; P[8] = 0.12; },
  angry: P => { P[13] = 2.1; P[14] = 0.35; P[15] = 1.0; P[10] = 0.2; P[11] = 0.4; P[1] = 0.08; P[8] = -0.1; },
  shout: P => { P[9] = 0.5; P[13] = 0.5; P[10] = 0.75; P[14] = 0.75; P[11] = 0.9; P[15] = 0.9; P[8] = -0.18; P[1] = 0.06; },
  hands: P => { P[9] = 0.2; P[13] = 0.2; P[10] = 2.5; P[14] = 2.5; P[11] = 0.35; P[15] = 0.35; },                      // hands up
  cower: P => { P[9] = 1.6; P[13] = 1.6; P[11] = 2.0; P[15] = 2.0; P[10] = 0.2; P[14] = 0.2; P[4] = 0.5; P[8] = 0.4; P[17] = 0.5; P[21] = 0.5; P[19] = 0.9; P[23] = 0.9; P[0] = -0.12; },
  stumble: P => { P[1] = 0.45; P[4] = 0.3; P[9] = 1.0; P[13] = 0.7; P[10] = 0.5; P[14] = 0.6; P[11] = 0.5; P[15] = 0.6; P[17] = 0.7; P[19] = 0.5; P[21] = -0.35; P[23] = 0.4; P[0] = -0.06; },
  lieBack: P => { P[9] = 0.15; P[13] = -0.1; P[10] = 0.9; P[14] = 0.6; P[11] = 0.5; P[15] = 0.9; P[17] = 0.12; P[21] = -0.05; P[18] = 0.22; P[22] = 0.14; P[19] = 0.5; P[23] = 0.1; P[7] = 0.6; P[20] = 0.6; P[24] = 0.6; },
  lieFront: P => { P[9] = 2.4; P[13] = 0.4; P[10] = 0.5; P[14] = 0.7; P[11] = 1.0; P[15] = 0.6; P[17] = -0.1; P[21] = 0.25; P[18] = 0.15; P[22] = 0.25; P[19] = 0.2; P[23] = 0.8; P[7] = -1.0; P[20] = 0.8; P[24] = 0.8; },
  kneel: P => { P[0] = -0.42; P[1] = 0.35; P[17] = 1.2; P[19] = 1.9; P[21] = 0.1; P[23] = 1.6; P[9] = 0.6; P[11] = 0.3; P[13] = 0.3; P[15] = 0.5; P[4] = 0.25; P[24] = 0.9; },
  wave: P => { P[13] = 0.3; P[14] = 2.3; P[15] = 0.9; P[10] = 0.06; P[11] = 0.12; },
  pull: P => { P[9] = 1.25; P[13] = 1.25; P[11] = 0.5; P[15] = 0.5; P[10] = 0.1; P[14] = 0.1; P[1] = 0.25; P[17] = 0.45; P[19] = 0.5; P[21] = -0.3; P[23] = 0.15; P[0] = -0.05; },
  push: P => { P[9] = 0.85; P[13] = 0.85; P[11] = 0.9; P[15] = 0.9; P[10] = 0.08; P[14] = 0.08; },
};
export const POSE_NAMES = Object.keys(POSES);
/** Static pose by name into P (K scales the seat drop). */
export function poseStatic(P, name, K) {
  P.fill(0); (POSES[name] || POSES.stand)(P);
  if (name === 'sit' || name === 'drive') P[0] = -(K ? K.legU * (name === 'drive' ? 0.82 : 0.96) : 0.42);          // hips come down by the thigh length (seat height = shin + sole)
  else P[0] *= K ? K.H / 1.75 : 1;
  return P;
}

// ---- standalone person for interiors (concierge, staff): makePerson({ role, seed, pose }) ------------------------------------------
/** → THREE.Group facing +z (rotate with .rotation.y = yaw; faces [sin yaw, cos yaw]). userData: { traits, figure, update(t), dispose() }. */
export function makePerson({ role = 'civil', seed = 1, pose = 'stand', gender, age, wave = false, seat = 0 } = {}) {
  const T = makeTraits(seed, { role, gender, age }), fig = makeFigure(T), g = new THREE.Group(); g.name = 'vrc-person-' + role;
  const base = poseStatic(newPose(), pose, fig.K), wv = poseStatic(newPose(), 'wave', fig.K);
  if (pose === 'sit' && seat) fig.mesh.position.y = seat - (fig.K.y.hip + base[0] - fig.K.legU * 0.0) + 0.0;
  g.add(fig.mesh); fig.pose.set(base); fig.apply();
  g.userData = { traits: T, figure: fig, dynamic: true,
    update(t) { const P = fig.pose; P.set(base); P[7] = 0.12 * Math.sin(t * 0.4); P[4] += 0.012 * Math.sin(t * 1.4); if (wave) { const k = smooth(0, 0.4, wave === true ? 1 : wave); P[13] = lerp(P[13], wv[13], k); P[14] = lerp(P[14], wv[14], k); P[15] = wv[15] * k + 0.35 * Math.sin(t * 9) * k; } fig.apply(); },
    setWave(v) { wave = v; }, dispose() { fig.dispose(); } };
  return g;
}

// ---- mid / far tiers: one template body, instanced; limbs swung in the vertex shader -------------------------------------------------
const LIMB_OF = [0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4], LOW_OF = [0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1];
export const TEMPLATE_TRAITS = (() => { const T = makeTraits(7, { role: 'civil', gender: 'f', age: 30 }); T.height = 1.72; T.build = 0; T.headH = 0.228; T.kid = 0; T.stoop = 0; T.hairStyle = 'short'; T.fringe = false; T.acc = { bag: null };
  T.outfit = { top: 'shirt', bottom: 'trousers', sleeves: 'long', open: false, tucked: false, skirtLen: 0.5, heel: 0, legsBare: false, hat: null }; T.gender = 'x'; return T; })();
/** Template geometry of tier `lod` (1 mid, 2 far). userData.piv = [shoulderY, elbowY, hipY, kneeY], userData.K. */
export function templateGeometry(lod = 1) {
  const T = TEMPLATE_TRAITS, { M, K } = buildBody(T, lod, true), n = M.n;
  const col = new Float32Array(n * 3), slot = new Float32Array(n), limb = new Float32Array(n * 4), va = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const sh = M.c[i * 2 + 1]; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = sh; slot[i] = M.c[i * 2];
    const b0 = M.sk[i * 3], b1 = M.sk[i * 3 + 1], w = M.sk[i * 3 + 2], l0 = LIMB_OF[b0], l1 = LIMB_OF[b1];
    let seg = 0, lw = 0, low = 0;
    if (l0 && l1) { seg = l0; lw = 1; low = LOW_OF[b0] * (1 - w) + LOW_OF[b1] * w; } else if (l1) { seg = l1; lw = w; low = LOW_OF[b1] * w; } else if (l0) { seg = l0; lw = 1 - w; }
    limb[i * 4] = seg; limb[i * 4 + 1] = lw; limb[i * 4 + 2] = low; va[i * 2] = M.va[i * 2]; va[i * 2 + 1] = M.va[i * 2 + 1];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(M.p, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1)); geo.setAttribute('aLimb', new THREE.BufferAttribute(limb, 4)); geo.setAttribute('aVar', new THREE.BufferAttribute(va, 2));
  geo.setIndex(M.idx); geo.computeVertexNormals();
  geo.userData = { piv: [K.y.shoulder, K.y.elbow, K.y.hip, K.y.knee], K, tris: M.idx.length / 3, height: T.height };
  return geo;
}
// GLSL: the same gait as poseWalk() (swing / elbow / hip / knee only) and a few static poses. pose ids:
export const POSE_ID = { walk: 0, stand: 0, sit: 1, phone: 2, film: 3, hands: 3, shout: 3, lie: 4, drive: 5, talk: 6, angry: 7, cower: 3, kneel: 1, stumble: 0, wave: 7, pull: 5, push: 5 };
const VS_HEAD = `
attribute float aSlot; attribute vec4 aLimb; attribute vec2 aVar; attribute vec4 iA; attribute vec4 iV;
uniform sampler2D uPal; uniform vec4 uPiv; uniform float uLegU;
vec2 pRot(vec2 yz, float a) { float c = cos(a), s = sin(a); return vec2(yz.x * c - yz.y * s, yz.x * s + yz.y * c); }
float pA1 = 0.0, pA2 = 0.0, pDy = 0.0, pVis = 1.0;
void pAngles() {
  float seg = aLimb.x, side = (seg < 1.5 || (seg > 2.5 && seg < 3.5)) ? 1.0 : -1.0, ph = iA.x, amp = iA.y, pose = iA.z;
  bool arm = seg < 2.5;
  if (pose < 0.5) {
    float run = clamp((amp - 1.05) / 0.7, 0.0, 1.0), a = min(amp, 1.25), s = sin(ph) * side;
    pDy = -uLegU * 2.0 * ((0.018 + 0.02 * run) * a * (1.0 - cos(2.0 * ph)) * 0.5 + 0.012 * a);
    if (seg > 0.5) {
      if (arm) { pA1 = (0.34 + 0.35 * run) * a * s; pA2 = -(0.14 + 1.25 * run + 0.22 * a * max(0.0, -s)); }
      else { float x = ph + (side > 0.0 ? 0.0 : 3.14159265); pA1 = -((0.46 + 0.16 * run) * a * s + (0.04 + 0.1 * run) * step(0.01, amp)); pA2 = step(0.01, amp) * ((0.1 + 0.05 * run) + (0.82 + 0.5 * run) * a * pow(max(0.0, cos(x - 0.5)), 1.6)); }
    }
  } else if (pose < 1.5) { pDy = -uLegU * 0.96; if (seg > 0.5) { if (arm) { pA1 = -0.35; pA2 = -0.75; } else { pA1 = -1.48; pA2 = 1.5; } } }
  else if (pose < 2.5) { if (seg > 0.5 && arm) { if (side < 0.0) { pA1 = -0.55; pA2 = -1.75; } else pA2 = -0.12; } }
  else if (pose < 3.5) { if (seg > 0.5 && arm) { pA1 = -1.05; pA2 = -0.95; } }
  else if (pose < 4.5) { if (seg > 0.5) { if (arm) { pA1 = side * 0.4; pA2 = -0.7; } else { pA1 = -0.12 * side; pA2 = 0.35 + 0.2 * side; } } }
  else if (pose < 5.5) { pDy = -uLegU * 0.82; if (seg > 0.5) { if (arm) { pA1 = -0.95; pA2 = -0.75; } else { pA1 = -1.3; pA2 = 0.85; } } }
  else if (pose < 6.5) { if (seg > 0.5 && arm) { if (side < 0.0) { pA1 = -0.35 - 0.1 * sin(ph * 3.0); pA2 = -1.2; } else pA2 = -0.2; } }
  else { if (seg > 0.5 && arm) { if (side < 0.0) { pA1 = -2.1 - 0.25 * sin(ph * 6.0); pA2 = -1.0; } else pA2 = -0.4; } }
  if (aVar.x > -0.5) { float id = iV[int(aVar.x + 0.5)]; pVis = mod(floor(aVar.y / exp2(id) + 0.001), 2.0); }
}
vec3 pBend(vec3 p, float isPos) {
  float seg = aLimb.x; if (seg < 0.5) return p;
  bool arm = seg < 2.5; float y1 = arm ? uPiv.x : uPiv.z, y2 = arm ? uPiv.y : uPiv.w;
  vec2 q = vec2(p.y - y2 * isPos, p.z); q = pRot(q, pA2 * aLimb.z); p.y = q.x + y2 * isPos; p.z = q.y;
  q = vec2(p.y - y1 * isPos, p.z); q = pRot(q, pA1 * aLimb.y); p.y = q.x + y1 * isPos; p.z = q.y;
  return p;
}`;
/** Material of the instanced tiers. palTex: DataTexture PAL_W × rows (sRGB bytes). */
export function instancedMaterial(palTex, geo) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPal = { value: palTex }; sh.uniforms.uPiv = { value: new THREE.Vector4(...geo.userData.piv) }; sh.uniforms.uLegU = { value: geo.userData.K.legU };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VS_HEAD)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n pAngles(); objectNormal = pBend(objectNormal, 0.0);\n vec3 pc = texelFetch(uPal, ivec2(int(aSlot + 0.5), int(iA.w + 0.5)), 0).rgb; vColor.rgb *= pow(pc, vec3(2.2));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed = pBend(transformed, 1.0); transformed.y += pDy; transformed *= pVis;`);
  };
  mat.customProgramCacheKey = () => 'vrc-people-inst';
  return mat;
}
