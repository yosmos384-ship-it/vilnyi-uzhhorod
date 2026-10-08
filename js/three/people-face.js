// people-face.js — who a generated person is (traits from a seed) and the face painted on a canvas.
// Everything here is procedural: no photographs, no likeness of a real person. A seed always gives the same person.
// No three.js import: Node-importable (the painter only needs a 2D canvas context).

export function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = r => (r() + r() + r() + r() - 2) / 0.58;          // ≈ N(0, 1)
const pick = (r, list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
function weighted(r, table) { let s = 0; for (const [, w] of table) s += w; let x = r() * s; for (const [v, w] of table) { x -= w; if (x <= 0) return v; } return table[table.length - 1][0]; }
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const css = (c, a = 1) => `rgba(${Math.round(clamp(c[0]) * 255)},${Math.round(clamp(c[1]) * 255)},${Math.round(clamp(c[2]) * 255)},${a})`;
export const hex3 = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];

// ---- skin: one "depth" parameter along a natural range, with a small undertone shift -------------------------------
const SKIN_STOPS = [[0.00, hex3(0xf6dfd0)], [0.18, hex3(0xeecbb2)], [0.36, hex3(0xe0b594)], [0.52, hex3(0xcd9c77)], [0.66, hex3(0xb17f58)], [0.80, hex3(0x8c5e3e)], [0.92, hex3(0x6a442c)], [1.00, hex3(0x4b2e20)]];
export function skinColour(depth, warm = 0) {
  let i = 0; while (i < SKIN_STOPS.length - 2 && SKIN_STOPS[i + 1][0] < depth) i++;
  const [a, ca] = SKIN_STOPS[i], [b, cb] = SKIN_STOPS[i + 1], c = mix3(ca, cb, clamp((depth - a) / (b - a)));
  return [clamp(c[0] + warm * 0.02), clamp(c[1]), clamp(c[2] - warm * 0.025)];
}
const HAIR = { black: hex3(0x17120f), dark: hex3(0x2e2019), brown: hex3(0x4f3523), chestnut: hex3(0x6b4226), lightbrown: hex3(0x8a6844), blond: hex3(0xc2a06a), fair: hex3(0xd9c391), red: hex3(0x8e3f1e), grey: hex3(0x9c9a97), white: hex3(0xdcdad6), dyedRed: hex3(0x7a1f2a), dyedPlum: hex3(0x4d2a45) };
const IRIS = { brown: hex3(0x5a3a22), dark: hex3(0x33200f), hazel: hex3(0x7a6234), green: hex3(0x5f7f52), grey: hex3(0x7d8c94), blue: hex3(0x5b83ad) };

// ---- city wear ----------------------------------------------------------------------------------------------------
const NEUTRALS = [0x1b1c20, 0x2a2d33, 0x3a3f47, 0x54585f, 0x7b7f84, 0xa9a9a4, 0xd9d6cd, 0xf0eee8, 0x2b2620, 0x4a3b2e, 0x6e5a45, 0x9a8468, 0xc4b295];
const COLOURS = [0x1f2f4f, 0x2f4a6e, 0x5b7fa6, 0x23473a, 0x4f6b46, 0x6e2a2e, 0x9c3b34, 0xb86a2e, 0xc9a23a, 0x5a3b62, 0x86506e, 0xc98f96, 0x2e6f73, 0xd9c9a8, 0x8a8f3a];
const DENIM = [0x26344d, 0x34496b, 0x4a6388, 0x6f87a6, 0x1d2230, 0x2a2b2e];
const SHOES = [0x15130f, 0x241c15, 0x3b2c1f, 0xe8e6e0, 0x6b6b6b, 0x1c2433, 0x7a5a3a];
const col = (r, pal) => hex3(pick(r, pal));
const jitter = (r, c, k = 0.04) => c.map(v => clamp(v + (r() - 0.5) * 2 * k));

function outfitFor(r, T) {
  const f = T.gender === 'f', kid = T.ageYears < 13, old = T.ageYears > 60, role = T.role;
  const O = { top: 'shirt', topCol: [0.8, 0.8, 0.8], inner: [0.92, 0.92, 0.9], open: false, sleeves: 'long', tucked: false, bottom: 'jeans', bottomCol: [0.2, 0.25, 0.35], skirtLen: 0, shoes: [0.1, 0.1, 0.1], heel: 0, legsBare: false, tie: false, hat: null, hatCol: null, band: null };
  if (role === 'police') return Object.assign(O, { top: 'uniform', topCol: hex3(0x14171f), inner: hex3(0x14171f), bottom: 'trousers', bottomCol: hex3(0x13151b), shoes: hex3(0x0c0c0d), hat: 'peaked', hatCol: hex3(0x14171f), band: hex3(0xd8dc3a), tucked: false });
  if (role === 'courier') return Object.assign(O, { top: 'jacket', topCol: pick(r, [hex3(0xd9482b), hex3(0xe2b21f), hex3(0x2aa36b)]), inner: hex3(0x222327), open: false, bottom: 'trousers', bottomCol: hex3(0x1d1e22), shoes: hex3(0x1a1a1a), hat: 'cap', hatCol: hex3(0x1d1e22) });
  if (role === 'waiter') return Object.assign(O, { top: 'shirt', topCol: hex3(0xf2f0ea), inner: hex3(0xf2f0ea), tucked: true, bottom: f && r() < 0.4 ? 'skirt' : 'trousers', skirtLen: 0.5, bottomCol: hex3(0x15161a), shoes: hex3(0x111111), apron: hex3(0x1a1b1f), legsBare: false });
  if (role === 'staff') return Object.assign(O, { top: 'shirt', topCol: jitter(r, pick(r, [hex3(0x2f6f4f), hex3(0x9c2f2f), hex3(0x2f4f8f), hex3(0xe9e6df)])), inner: hex3(0xf0eee8), sleeves: r() < 0.5 ? 'short' : 'long', bottom: 'trousers', bottomCol: hex3(0x24262b), shoes: hex3(0x1a1a1a), apron: r() < 0.6 ? hex3(0x2a2b30) : null });
  if (role === 'concierge') return Object.assign(O, { top: 'suit', topCol: hex3(0x232a40), inner: hex3(0xf6f1e6), open: true, tie: !f, bottom: f ? 'skirt' : 'trousers', skirtLen: 0.55, bottomCol: hex3(0x232a40), shoes: hex3(0x0f0f12), heel: f ? 0.04 : 0, legsBare: f });
  if (role === 'jogger') return Object.assign(O, { top: r() < 0.5 ? 'tee' : 'hoodie', topCol: jitter(r, col(r, COLOURS)), sleeves: r() < 0.5 ? 'short' : 'long', bottom: r() < 0.5 ? 'shorts' : 'leggings', bottomCol: hex3(pick(r, [0x17181c, 0x23262e, 0x2b3550])), shoes: hex3(pick(r, [0xe8e6e0, 0xd94f2b, 0x3aa0d9, 0x1a1a1a])), legsBare: true });
  // civil
  const topKinds = kid ? [['hoodie', 4], ['tee', 3], ['jacket', 3]]
    : f ? [['coat', old ? 5 : 2.5], ['jacket', 3], ['hoodie', old ? 0.4 : 1.6], ['shirt', 2], ['tee', 1.6], ['dress', old ? 1.2 : 1.8], ['suit', 0.5]]
      : [['jacket', 3.2], ['coat', old ? 3 : 1.4], ['hoodie', old ? 0.5 : 2.4], ['shirt', 2.2], ['tee', 1.8], ['suit', 1.1]];
  O.top = weighted(r, topKinds);
  const bright = r() < (f ? 0.45 : 0.28);
  O.topCol = jitter(r, col(r, O.top === 'suit' ? [0x1b1c20, 0x23283a, 0x2f3238, 0x3b352f, 0x4a4d55] : bright ? COLOURS : NEUTRALS));
  O.inner = jitter(r, col(r, O.top === 'suit' ? [0xf2f0ea, 0xdfe6f0, 0xf0e6e6] : [0xf0eee8, 0xd9d6cd, 0xe6e2d8, 0x2a2d33, 0x7b7f84, 0x9aa7b5, 0x7a3b38, 0x2f4a6e, 0xb9a887]), 0.02);
  O.open = (O.top === 'jacket' || O.top === 'coat') ? r() < 0.55 : O.top === 'suit';
  O.tie = O.top === 'suit' && !f && r() < 0.6;
  O.sleeves = (O.top === 'tee' || (O.top === 'dress' && r() < 0.5) || (O.top === 'shirt' && r() < 0.3)) ? 'short' : 'long';
  O.tucked = O.top === 'shirt' && r() < 0.45;
  if (O.top === 'dress') { O.bottom = 'dress'; O.bottomCol = O.topCol; O.skirtLen = lerp(0.42, 0.85, r()); O.legsBare = true; }
  else if (f && !kid && r() < (old ? 0.3 : 0.2)) { O.bottom = 'skirt'; O.skirtLen = lerp(0.38, 0.8, r()); O.bottomCol = jitter(r, col(r, r() < 0.6 ? NEUTRALS : COLOURS)); O.legsBare = true; }
  else if (!old && r() < 0.07 && (O.top === 'tee' || O.top === 'hoodie')) { O.bottom = 'shorts'; O.bottomCol = jitter(r, col(r, NEUTRALS)); O.legsBare = true; }
  else if (r() < 0.55) { O.bottom = 'jeans'; O.bottomCol = jitter(r, col(r, DENIM)); }
  else { O.bottom = f && r() < 0.3 ? 'leggings' : 'trousers'; O.bottomCol = jitter(r, col(r, [0x1b1c20, 0x2a2d33, 0x3a3f47, 0x4a3b2e, 0x6e5a45, 0x9a8468, 0x23283a])); }
  O.tights = O.legsBare && f && r() < 0.5 ? hex3(pick(r, [0x1a1a1c, 0x2a2420, 0x3a2f2a])) : null;
  O.shoes = col(r, SHOES); O.heel = f && !kid && (O.bottom === 'skirt' || O.bottom === 'dress' || O.top === 'suit') && r() < 0.5 ? lerp(0.025, 0.06, r()) : 0;
  if (r() < (old ? 0.22 : 0.1)) { O.hat = 'beanie'; O.hatCol = jitter(r, col(r, r() < 0.5 ? NEUTRALS : COLOURS)); }
  else if (!f && r() < 0.07) { O.hat = 'cap'; O.hatCol = jitter(r, col(r, NEUTRALS)); }
  return O;
}

/** A person from a seed. opts: role ('civil' | 'police' | 'courier' | 'waiter' | 'staff' | 'concierge' | 'jogger'), gender ('f' | 'm'), age (years). */
export function makeTraits(seed, opts = {}) {
  const r = rng(Math.imul((seed >>> 0) + 0x9E37, 0x85EBCA6B) ^ 0x51ED270B);
  const T = { seed: seed >>> 0, role: opts.role || 'civil' };
  T.gender = opts.gender || (r() < 0.52 ? 'f' : 'm');
  const service = T.role !== 'civil';
  T.ageYears = opts.age ?? (T.role === 'jogger' ? 18 + r() * 35 : service ? 22 + r() * 30 : weighted(r, [[() => 6 + r() * 6, 5], [() => 13 + r() * 6, 8], [() => 19 + r() * 16, 31], [() => 35 + r() * 20, 32], [() => 55 + r() * 30, 24]])());
  const a = T.ageYears, f = T.gender === 'f';
  T.age = a < 13 ? 'child' : a < 19 ? 'teen' : a < 35 ? 'young' : a < 55 ? 'adult' : 'senior';
  const adultH = (f ? 1.655 : 1.775) + gauss(r) * 0.058;
  T.height = a < 19 ? lerp(1.16 + gauss(r) * 0.03, adultH, smooth(6, f ? 15.5 : 17.5, a)) : adultH - Math.max(0, a - 60) * 0.0016;
  T.height = clamp(T.height, 1.08, 1.98);
  T.build = clamp(gauss(r) * 0.42 + (a > 40 ? 0.18 : a < 25 ? -0.12 : 0), -1, 1);       // −1 slim … +1 heavy
  T.headH = lerp(0.2, f ? 0.221 : 0.233, smooth(5, 17, a)) + (T.height - (f ? 1.655 : 1.775)) * 0.035;
  T.kid = clamp(1 - smooth(8, 17, a));                                                 // 1 child proportions … 0 adult
  T.stoop = clamp((a - 62) / 30) * (0.5 + r() * 0.5);
  // skin, hair, eyes
  T.skinDepth = r() < 0.86 ? clamp(0.06 + Math.abs(gauss(r)) * 0.15, 0, 0.5) : lerp(0.4, 1, r());
  T.skin = skinColour(T.skinDepth, r() * 2 - 1);
  const dk = T.skinDepth;
  const hairNat = dk > 0.6 ? pick(r, ['black', 'black', 'dark']) : dk > 0.4 ? pick(r, ['black', 'dark', 'dark', 'brown']) : weighted(r, [['dark', 3], ['brown', 4], ['chestnut', 3], ['lightbrown', 3], ['blond', 2.4], ['fair', 1], ['red', 0.6], ['black', 1.2]]);
  const greyP = smooth(38, 68, a) * (f ? 0.65 : 1), grey = r() < greyP;
  T.hairName = grey ? (a > 68 && r() < 0.5 ? 'white' : 'grey') : (f && a > 22 && r() < 0.14 ? pick(r, ['dyedRed', 'dyedPlum', 'blond', 'fair']) : hairNat);
  T.hair = jitter(r, HAIR[T.hairName], 0.025);
  T.browCol = grey ? mix3(HAIR[hairNat], HAIR.grey, 0.5) : mix3(HAIR[hairNat === 'fair' || hairNat === 'blond' ? 'lightbrown' : hairNat], [0.1, 0.07, 0.05], 0.35);
  T.hairStyle = f
    ? (a < 13 ? pick(r, ['pony', 'long', 'bob', 'pony']) : a > 62 ? weighted(r, [['shortf', 4], ['bob', 4], ['bun', 2], ['medium', 1]]) : weighted(r, [['long', 5], ['pony', 3], ['bob', 2.5], ['bun', 1.6], ['medium', 1.5], ['shortf', 0.8]]))
    : (a < 13 ? pick(r, ['short', 'short', 'medium']) : weighted(r, [['short', 6], ['buzz', 2.2], ['medium', 1.3], ['balding', smooth(30, 60, a) * 4], ['bald', 0.4 + smooth(30, 60, a) * 2.2]]));
  T.fringe = (T.hairStyle === 'bob' || T.hairStyle === 'long' || T.hairStyle === 'medium') && r() < 0.4;
  T.beard = (!f && a > 20) ? weighted(r, [['none', 5], ['stubble', 2.2], ['short', 1.6], ['full', 0.8], ['moustache', 0.4]]) : 'none';
  T.iris = IRIS[dk > 0.45 ? pick(r, ['brown', 'dark', 'dark']) : weighted(r, [['brown', 3], ['hazel', 2], ['green', 1.4], ['grey', 2], ['blue', 2.6], ['dark', 1]])];
  T.glasses = r() < 0.12 + smooth(40, 70, a) * 0.28 ? pick(r, ['round', 'rect', 'rect']) : null;
  T.makeup = f && a > 16 ? clamp(r() * 1.2 - 0.25) : 0;
  T.lip = f && T.makeup > 0.45 ? mix3(pick(r, [hex3(0xa8323f), hex3(0xb5505a), hex3(0x8e3a4a), hex3(0xc0665e)]), T.skin, 0.25) : mix3(T.skin, dk > 0.5 ? hex3(0x6a3a36) : hex3(0xb0605e), dk > 0.5 ? 0.55 : 0.5);
  T.freckles = dk < 0.2 && r() < 0.12;
  // face shape numbers (all small variations around one anatomy)
  T.face = { jaw: clamp(0.5 + gauss(r) * 0.2 + (f ? -0.12 : 0.12)), eyeW: 1 + gauss(r) * 0.05, eyeH: 1 + gauss(r) * 0.1 + (f ? 0.06 : 0), eyeTilt: gauss(r) * 0.045, eyeGap: 1 + gauss(r) * 0.03,
    browH: gauss(r) * 0.0015, browArch: 0.5 + gauss(r) * 0.2, browT: (f ? 0.8 : 1.15) * (1 + gauss(r) * 0.15), noseW: 1 + gauss(r) * 0.1, noseL: 1 + gauss(r) * 0.06, mouthW: 1 + gauss(r) * 0.07, lipH: (f ? 1.12 : 0.9) * (1 + gauss(r) * 0.14),
    smile: gauss(r) * 0.5, asym: gauss(r) * 0.4 };
  T.outfit = outfitFor(r, T);
  // things carried
  const kid = a < 13;
  T.acc = { bag: null, phone: !kid && r() < 0.5, dog: false, pram: false, umbrella: false };
  if (T.role === 'civil') {
    T.acc.bag = weighted(r, kid ? [['backpack', 5], [null, 5]] : f ? [['shoulder', 4], ['hand', 1.6], ['backpack', 1.6], [null, 3]] : [['backpack', 2.4], ['shoulder', 0.8], ['hand', 0.8], [null, 6]]);
    T.acc.dog = !kid && r() < 0.035; T.acc.pram = !kid && a > 22 && a < 42 && r() < 0.03;
  } else if (T.role === 'courier') T.acc.bag = 'box';
  T.bagCol = jitter(r, col(r, [0x1b1c20, 0x2a2d33, 0x4a3b2e, 0x6e5a45, 0x6e2a2e, 0x1f2f4f, 0xc4b295]), 0.02);
  T.speed = clamp((a < 13 ? 1.2 : a > 60 ? lerp(1.2, 0.85, smooth(60, 85, a)) : 1.38) + gauss(r) * 0.13 - Math.max(0, T.build) * 0.12, 0.6, 1.75);
  T.voice = (f ? 215 : 118) * (kid ? 1.45 : 1) * (1 + gauss(r) * 0.1);
  T.temper = r();            // 0 timid … 1 hot-headed (personality rolls)
  T.jay = r() < 0.14;        // crosses on red when the road looks empty
  return T;
}

// ---- face frame: where things are on the head (metres, origin at the chin, y up) ------------------------------------
export function faceFrame(T) {
  const HH = T.headH, k = T.kid, F = T.face || {};
  const hw = HH * (0.325 + 0.012 * k);                                    // half width of the skull above the ears
  const ey = HH * lerp(0.475, 0.43, k), ex = hw * 0.418 * (F.eyeGap || 1);
  return { HH, hw, XE: hw * 1.12, y0: -0.014, y1: HH + 0.012, ey, ex, eyeW: hw * 0.4 * (F.eyeW || 1) * (1 + 0.1 * k), eyeH: hw * 0.152 * (F.eyeH || 1) * (1 + 0.3 * k),
    browY: ey + hw * 0.235 + (F.browH || 0), noseY: HH * lerp(0.325, 0.31, k), noseW: hw * 0.225 * (F.noseW || 1) * (1 - 0.12 * k), mouthY: HH * lerp(0.2, 0.195, k), mouthW: hw * 0.66 * (F.mouthW || 1) * (1 - 0.08 * k),
    hairY: HH * 0.8 };
}
/** Lower edge of the hair on the skull, as a height fraction v (0 chin … 1 crown) for an angle th (0 = face, π = back). */
export function hairline(T, th) {
  const a = Math.abs(th > Math.PI ? th - 2 * Math.PI : th), s = T.hairStyle, deg = a * 180 / Math.PI;
  if (s === 'balding') return 1.06;                                       // the horseshoe is 3D only (people-body.js)
  const front = s === 'balding' ? 1.06 : (T.fringe ? 0.69 : s === 'buzz' ? 0.815 : 0.8) + (T.ageYears > 45 && T.gender === 'm' ? 0.025 : 0);
  const temple = front - (T.gender === 'm' ? 0.03 : 0.07), side = s === 'long' || s === 'bob' || s === 'medium' ? 0.44 : 0.56, nape = s === 'buzz' || s === 'short' || s === 'balding' ? 0.27 : 0.22;
  if (deg < 38) return lerp(front, temple, smooth(8, 38, deg) * (T.gender === 'm' ? -0.6 : 1));          // men: slightly receding temples
  if (deg < 62) return lerp(T.gender === 'm' ? front + (front - temple) * 0.6 : temple, side + 0.07, smooth(38, 62, deg));
  if (deg < 100) return lerp(side + 0.07, side, smooth(62, 100, deg));
  return lerp(side, nape, smooth(100, 150, deg));
}

// ---- the painter --------------------------------------------------------------------------------------------------
/** Paint the face of T on a canvas (front projection of the head; chin at the bottom). The bottom-left 24 px block is
 *  pure white: body vertices take their colour from the vertex colours through it. */
export function paintFace(cv, T) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, F = faceFrame(T), f = T.gender === 'f', a = T.ageYears, r = rng(T.seed ^ 0xFACE);
  const skin = T.skin, dk = T.skinDepth, sh = mix3(skin, [skin[0] * 0.5, skin[1] * 0.36, skin[2] * 0.32], 0.75), hi = mix3(skin, [1, 0.96, 0.9], 0.3);
  const blush = mix3(skin, [0.86, 0.36, 0.36], dk > 0.5 ? 0.18 : 0.42), fa = T.face;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.fillStyle = css(skin); g.fillRect(0, 0, W, H);
  const sx = W / (2 * F.XE), sy = H / (F.y1 - F.y0);
  g.setTransform(sx, 0, 0, -sy, W / 2, H * F.y1 / (F.y1 - F.y0));
  g.lineCap = 'round'; g.lineJoin = 'round';
  const blob = (x, y, rx, ry, c, al, rot = 0) => { g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.scale(rx, ry); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, css(c, al)); gr.addColorStop(0.55, css(c, al * 0.55)); gr.addColorStop(1, css(c, 0)); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, 6.2832); g.fill(); g.restore(); };
  const line = (pts, w, c, al) => { g.strokeStyle = css(c, al); g.lineWidth = w; g.beginPath(); g.moveTo(pts[0], pts[1]); if (pts.length === 6) g.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]); else if (pts.length === 8) g.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); else for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke(); };
  const hw = F.hw, HH = F.HH, old = smooth(36, 78, a), kid = T.kid;

  // skin mottling (very soft), then the broad forms: sides of the face fall away, forehead and cheek-bones catch light
  for (let i = 0; i < 26; i++) blob((r() * 2 - 1) * hw, r() * HH, hw * (0.1 + r() * 0.2), hw * (0.1 + r() * 0.2), r() < 0.5 ? sh : blush, 0.035 + old * 0.035);
  for (const s of [-1, 1]) { blob(s * hw * 1.1, HH * 0.42, hw * 0.42, HH * 0.52, sh, 0.34); blob(s * hw * 0.8, HH * 0.12, hw * 0.5, HH * 0.2, sh, 0.3 + (1 - fa.jaw) * 0.12); }
  blob(0, HH * 0.7, hw * 0.75, HH * 0.14, hi, 0.2); blob(0, -0.004, hw * 0.9, HH * 0.07, sh, 0.5);
  for (const s of [-1, 1]) { blob(s * hw * 0.52, F.noseY + HH * 0.035, hw * 0.3, HH * 0.085, blush, 0.2 + T.makeup * 0.14 + kid * 0.12); blob(s * hw * 0.56, F.ey - HH * 0.085, hw * 0.24, HH * 0.04, hi, 0.2); }
  blob(0, HH * 0.075, hw * 0.3, HH * 0.05, hi, 0.16);
  if (T.freckles) for (let i = 0; i < 70; i++) { const x = (r() * 2 - 1) * hw * 0.62, y = F.noseY + (r() - 0.25) * HH * 0.16; g.fillStyle = css(mix3(skin, [0.55, 0.32, 0.2], 0.6), 0.25 + r() * 0.25); g.beginPath(); g.arc(x, y, 0.0005 + r() * 0.0006, 0, 6.2832); g.fill(); }

  // ---- eyes
  const ey = F.ey, ew = F.eyeW / 2, eh = F.eyeH / 2;
  for (const s of [-1, 1]) {
    const cx = s * F.ex, tilt = fa.eyeTilt, yo = ey + (s > 0 ? fa.asym * 0.0006 : 0);
    blob(cx - s * hw * 0.03, yo + eh * 1.4, ew * 1.75, eh * 3.4, sh, 0.26 + old * 0.12);                                  // socket under the brow
    blob(cx - s * ew * 1.15, yo + eh * 0.4, ew * 0.6, eh * 2.8, sh, 0.32);                                              // inner corner, side of the nose
    if (T.makeup > 0.3) blob(cx + s * ew * 0.15, yo + eh * 1.5, ew * 1.25, eh * 1.6, mix3(sh, [0.25, 0.16, 0.2], 0.5), 0.26 * T.makeup);
    const xi = cx - s * ew, xo = cx + s * ew, yi = yo - tilt * ew - eh * 0.2, yo2 = yo + tilt * ew + eh * 0.12;      // inner, outer corners
    const eye = () => { g.beginPath(); g.moveTo(xi, yi); g.bezierCurveTo(cx - s * ew * 0.45, yo + eh * 1.28, cx + s * ew * 0.45, yo + eh * 1.22, xo, yo2); g.bezierCurveTo(cx + s * ew * 0.45, yo - eh * 0.98, cx - s * ew * 0.4, yo - eh * 1.02, xi, yi); g.closePath(); };
    g.save(); eye(); g.clip();
    g.fillStyle = css(mix3([0.93, 0.92, 0.9], sh, 0.1 + old * 0.1)); g.fillRect(cx - ew * 1.2, yo - eh * 2, ew * 2.4, eh * 4);
    blob(xi, yi, ew * 0.45, eh * 1.4, [0.78, 0.5, 0.48], 0.5); blob(xo, yo2, ew * 0.4, eh * 1.4, [0.7, 0.55, 0.52], 0.3);
    const ir = Math.min(ew * 0.44, eh * 1.22), ix = cx + s * ew * 0.02, iy = yo + eh * 0.12;
    const ig = g.createRadialGradient(ix, iy, 0, ix, iy, ir); const ic = T.iris;
    ig.addColorStop(0, css([0.02, 0.02, 0.02])); ig.addColorStop(0.36, css([0.02, 0.02, 0.02])); ig.addColorStop(0.42, css(mix3(ic, [0.9, 0.75, 0.45], 0.25))); ig.addColorStop(0.8, css(ic)); ig.addColorStop(0.93, css(mix3(ic, [0, 0, 0], 0.65))); ig.addColorStop(1, css(mix3(ic, [0, 0, 0], 0.8), 0.6));
    g.fillStyle = ig; g.beginPath(); g.arc(ix, iy, ir, 0, 6.2832); g.fill();
    const lg = g.createLinearGradient(0, yo + eh * 1.25, 0, yo + eh * 0.1); lg.addColorStop(0, 'rgba(20,10,8,0.6)'); lg.addColorStop(1, 'rgba(20,10,8,0)'); g.fillStyle = lg; g.fillRect(cx - ew * 1.2, yo - eh * 0.2, ew * 2.4, eh * 1.6);   // shadow of the upper lid
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(ix + ir * 0.34, iy + ir * 0.34, ir * 0.17, 0, 6.2832); g.fill();
    g.restore();
    const lash = mix3(T.browCol, [0.05, 0.03, 0.03], 0.75);
    line([xi, yi, cx - s * ew * 0.45, yo + eh * 1.28, cx + s * ew * 0.45, yo + eh * 1.22, xo, yo2], eh * (0.3 + T.makeup * 0.3 + (f ? 0.1 : 0)), lash, 0.92);        // upper lash line
    if (f) line([xo, yo2, xo + s * ew * 0.16, yo2 + eh * 0.34], eh * (0.2 + T.makeup * 0.22), lash, 0.75);
    line([xi, yi, cx - s * ew * 0.4, yo - eh * 1.02, cx + s * ew * 0.45, yo - eh * 0.98, xo, yo2], eh * 0.12, mix3(sh, lash, 0.35), 0.5);
    line([xi + s * ew * 0.12, yi + eh * 1.3, cx, yo + eh * 2.15, xo - s * ew * 0.05, yo2 + eh * 1.05], eh * 0.2, sh, 0.55 + old * 0.2);                            // lid crease
    blob(cx, yo - eh * 1.9, ew * 0.95, eh * 0.95, mix3(sh, [0.35, 0.25, 0.35], 0.25), 0.12 + old * 0.3);                                                          // under the eye
    if (old > 0.2) { line([xi + s * ew * 0.2, yo - eh * 1.7, cx, yo - eh * 2.5, xo - s * ew * 0.1, yo - eh * 1.5], eh * 0.14, sh, old * 0.6);
      for (let i = 0; i < 3; i++) line([xo + s * ew * 0.14, yo2 + eh * (0.5 - i * 0.6), xo + s * ew * (0.5 + 0.1 * i), yo2 + eh * (1.0 - i * 1.1)], eh * 0.1, sh, old * 0.6); }
    // brow: many short hairs along an arch
    const by = F.browY + (s > 0 ? fa.asym * 0.0008 : 0), bt = hw * 0.058 * fa.browT * (1 - 0.3 * kid), n = 42;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), x = cx + s * ew * lerp(-1.22, 1.42, u), arch = Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.62) * fa.browArch * hw * 0.085 - (u > 0.75 ? (u - 0.75) * hw * 0.2 : 0);
      const th = bt * (u < 0.15 ? 0.6 + u * 2.6 : 1 - Math.max(0, u - 0.55) * 1.6), y = by + arch + (r() - 0.5) * th * 0.7;
      line([x, y - th * 0.5, x + s * hw * 0.03, y + th * 0.5], hw * 0.012, T.browCol, (f ? 0.5 : 0.62) * (0.55 + r() * 0.45));
    }
  }
  // glabella / forehead
  if (old > 0.15) { for (const s of [-1, 1]) line([s * hw * 0.07, F.browY - hw * 0.02, s * hw * 0.085, F.browY + hw * 0.16], hw * 0.012, sh, old * 0.6);
    for (let i = 0; i < 3; i++) { const y = F.browY + HH * (0.075 + i * 0.045); line([-hw * 0.5, y - hw * 0.02, 0, y + hw * (0.03 + r() * 0.02), hw * 0.5, y - hw * 0.02], hw * 0.011, sh, old * (0.6 - i * 0.1)); } }

  // ---- nose: light on the ridge and tip, shadow on the flanks, wings, nostrils
  const ny = F.noseY, nw = F.noseW;
  blob(0, lerp(ny, ey, 0.55), nw * 0.45, (ey - ny) * 0.62, hi, 0.34); blob(0, ny + HH * 0.03, nw * 0.6, HH * 0.03, hi, 0.4);
  for (const s of [-1, 1]) {
    blob(s * nw * 0.92, lerp(ny, ey, 0.5), nw * 0.42, (ey - ny) * 0.55, sh, 0.3);
    line([s * nw * 0.62, ny + HH * 0.052, s * nw * 1.18, ny + HH * 0.04, s * nw * 1.12, ny + HH * 0.004, s * nw * 0.66, ny - HH * 0.004], hw * 0.02, sh, 0.1 + old * 0.1);
    g.fillStyle = css(mix3(sh, [0.12, 0.05, 0.05], 0.7), 0.72); g.beginPath(); g.ellipse(s * nw * 0.44, ny + HH * 0.003, nw * 0.3, HH * 0.0105, s * 0.35, 0, 6.2832); g.fill();
  }
  blob(0, ny - HH * 0.02, nw * 1.0, HH * 0.02, sh, 0.3);
  line([-nw * 0.14, ny - HH * 0.02, -nw * 0.12, F.mouthY + HH * 0.04], hw * 0.02, sh, 0.09); line([nw * 0.14, ny - HH * 0.02, nw * 0.12, F.mouthY + HH * 0.04], hw * 0.02, sh, 0.09);
  // nasolabial folds
  for (const s of [-1, 1]) line([s * nw * 1.22, ny + HH * 0.02, s * F.mouthW * 0.66, lerp(ny, F.mouthY, 0.5), s * F.mouthW * 0.64, F.mouthY - HH * 0.012], hw * (0.03 - 0.008 * old), sh, 0.03 + old * old * 0.6);
  if (old > 0.35) for (const s of [-1, 1]) line([s * F.mouthW * 0.56, F.mouthY - HH * 0.02, s * F.mouthW * 0.62, F.mouthY - HH * 0.075], hw * 0.016, sh, old * 0.5);

  // ---- beard / stubble (under the mouth paint)
  if (T.beard !== 'none') {
    const bc = mix3(T.hair, [0.12, 0.1, 0.09], T.hairName === 'grey' || T.hairName === 'white' ? 0 : 0.3), full = T.beard === 'full' ? 1 : T.beard === 'short' ? 0.75 : T.beard === 'stubble' ? 0.32 : 0;
    if (full) { g.save(); g.beginPath(); g.moveTo(-hw * 1.2, ey - HH * 0.03); g.quadraticCurveTo(-hw * 0.8, F.mouthY + HH * 0.06, -F.mouthW * 0.62, F.mouthY + HH * 0.035); g.lineTo(-nw * 1.2, ny - HH * 0.012); g.lineTo(nw * 1.2, ny - HH * 0.012); g.lineTo(F.mouthW * 0.62, F.mouthY + HH * 0.035); g.quadraticCurveTo(hw * 0.8, F.mouthY + HH * 0.06, hw * 1.2, ey - HH * 0.03); g.lineTo(hw * 1.3, -0.02); g.lineTo(-hw * 1.3, -0.02); g.closePath(); g.clip();
      g.fillStyle = css(bc, full * 0.62); g.fillRect(-hw * 1.4, -0.03, hw * 2.8, HH);
      for (let i = 0; i < 900; i++) { const x = (r() * 2 - 1) * hw * 1.15, y = -0.012 + r() * HH * 0.48; g.fillStyle = css(r() < 0.5 ? bc : mix3(bc, [0, 0, 0], 0.5), full * (0.3 + r() * 0.5)); g.fillRect(x, y, 0.0006 + r() * 0.0006, 0.0012 + r() * 0.0016); }
      g.restore(); }
    if (T.beard === 'moustache' || full > 0.5) { for (let i = 0; i < 160; i++) { const x = (r() * 2 - 1) * F.mouthW * 0.6, y = lerp(F.mouthY + HH * 0.012, ny - HH * 0.014, r()); line([x, y + HH * 0.012, x + Math.sign(x) * hw * 0.03, y - HH * 0.012], hw * 0.014, bc, 0.6); } }
  }
  // ---- mouth
  const my = F.mouthY, mw = F.mouthW / 2, lh = HH * 0.03 * fa.lipH, sm = fa.smile * HH * 0.006, lip = T.lip;
  blob(0, my - lh * 1.9, mw * 0.75, lh * 0.9, sh, 0.4);                                                                          // under the lower lip
  g.fillStyle = css(mix3(lip, sh, 0.3)); g.beginPath(); g.moveTo(-mw, my + sm); g.bezierCurveTo(-mw * 0.5, my + lh * 0.75, -mw * 0.16, my + lh * 1.05, 0, my + lh * 0.72); g.bezierCurveTo(mw * 0.16, my + lh * 1.05, mw * 0.5, my + lh * 0.75, mw, my + sm); g.quadraticCurveTo(0, my - lh * 0.12, -mw, my + sm); g.fill();
  g.fillStyle = css(lip); g.beginPath(); g.moveTo(-mw, my + sm); g.quadraticCurveTo(0, my - lh * 0.1, mw, my + sm); g.bezierCurveTo(mw * 0.55, my - lh * 1.25, -mw * 0.55, my - lh * 1.25, -mw, my + sm); g.fill();
  blob(0, my - lh * 0.55, mw * 0.5, lh * 0.36, [1, 0.95, 0.92], 0.3 + T.makeup * 0.15);
  line([-mw, my + sm, -mw * 0.4, my - lh * 0.1, mw * 0.4, my - lh * 0.1, mw, my + sm], lh * 0.2, mix3(lip, [0.15, 0.05, 0.05], 0.75), 0.85);
  for (const s of [-1, 1]) blob(s * mw * 1.05, my + sm, mw * 0.14, lh * 0.5, sh, 0.5);

  // the side and top edges of the picture return to the plain skin colour: the back of the head continues from the edge columns
  for (const sgn of [-1, 1]) { const lg = g.createLinearGradient(sgn * F.XE * 0.8, 0, sgn * F.XE, 0); lg.addColorStop(0, css(skin, 0)); lg.addColorStop(0.75, css(skin, 1)); lg.addColorStop(1, css(skin, 1)); g.fillStyle = lg; g.fillRect(sgn > 0 ? F.XE * 0.8 : -F.XE, F.y0, F.XE * 0.2, F.y1 - F.y0); }
  { const lg = g.createLinearGradient(0, HH * 0.9, 0, F.y1); lg.addColorStop(0, css(skin, 0)); lg.addColorStop(0.7, css(skin, 1)); lg.addColorStop(1, css(skin, 1)); g.fillStyle = lg; g.fillRect(-F.XE, HH * 0.9, F.XE * 2, F.y1 - HH * 0.9); }
  // ---- hair seen from the front (the 3D hair sits on top of this; it closes the gap at the hair edge)
  if (T.hairStyle !== 'bald') {
    const hc = T.hair, n = 40;
    const edge = i => { const x = lerp(-1, 1, i / n) * F.XE, th = Math.asin(clamp(x / (hw * 1.02), -1, 1)); return [x, hairline(T, th) * HH]; };
    g.beginPath(); g.moveTo(-F.XE, F.y1 + 0.01); for (let i = 0; i <= n; i++) { const [x, y] = edge(i); g.lineTo(x, y + (r() - 0.5) * 0.002); } g.lineTo(F.XE, F.y1 + 0.01); g.closePath();
    g.fillStyle = css(hc, T.hairStyle === 'buzz' ? 0.8 : 1); g.fill();
    for (let i = 0; i <= n; i++) { const [x, y] = edge(i); blob(x, y - 0.002, hw * 0.09, HH * 0.02, hc, T.hairStyle === 'balding' ? 0.2 : 0.45); }
  } else blob(0, HH * 0.9, hw * 0.6, HH * 0.1, hi, 0.3);
  // ---- glasses
  if (T.glasses) {
    const gy = ey + eh * 0.2, lw = ew * 1.42, lhh = eh * (T.glasses === 'round' ? 3.2 : 2.5), fc = [0.07, 0.06, 0.06];
    for (const s of [-1, 1]) { const cx = s * F.ex; g.beginPath(); if (T.glasses === 'round') g.ellipse(cx, gy, lw, lhh, 0, 0, 6.2832); else g.roundRect(cx - lw, gy - lhh, lw * 2, lhh * 2, lhh * 0.45);
      g.fillStyle = 'rgba(190,210,225,0.1)'; g.fill(); g.strokeStyle = css(fc, 0.95); g.lineWidth = hw * 0.03; g.stroke();
      line([cx - s * lw * 0.6, gy + lhh * 0.55, cx - s * lw * 0.2, gy + lhh * 0.75], hw * 0.02, [1, 1, 1], 0.3);
      line([cx + s * lw, gy + lhh * 0.3, s * hw * 0.99, gy + lhh * 0.42], hw * 0.03, fc, 0.95); }
    line([-F.ex + lw, gy + lhh * 0.3, 0, gy + lhh * 0.62, F.ex - lw, gy + lhh * 0.3], hw * 0.028, fc, 0.95);
  }
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, H - 24, 24, 24);
  return cv;
}
