// ЖК VILNYI (Ужгород) — the cars as objects: eight original luxury designs, procedurally modelled (no model files, no
// brands, no badges, generic names only).
//
// How a body is made. A car body is a swept surface, not a box: its PLAN OUTLINE (rounded, bowed nose and tail, waisted
// sides) is carried up a WALL whose shape varies with height (tuck-under, shoulder crease, tumblehome, the rake of nose
// and tail, flares over the wheels); the wall turns through a fillet into the DECK (bonnet, boot) which is crowned across
// the car. The GREENHOUSE is a second swept surface between two outlines — its base on the deck and the roof edge — so the
// windscreen, the pillars and the side glass are one curved skin. Both surfaces are continuous functions P(a, b); a
// marching-squares mesher cuts them along exact curves (wheel arches, the cabin opening, the daylight opening of the
// windows, the driver's door) and every detail (lamps, grille, shut lines, chrome) is laid on the true surface with its
// true normal. Three tiers come from the same functions: 0 = full detail (the car being approached or driven),
// 1 = merged mid model, 2 = far model for the mass of parked cars and the traffic.
//
// Car frame: +z forward, +y up, +x = the driver's (left) side; origin on the ground midway between the axles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ------------------------------------------------------------------ math helpers
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x / w) * (x / w));
function mono(pts) {   // monotone cubic (Fritsch–Carlson) through [x, y] pairs sorted by x; flat outside
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), d = [], m = [];
  if (n === 1) return () => ys[0];
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
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// ------------------------------------------------------------------ the nine designs
// perf: acc = launch acceleration (m/s², traction), pw = power-to-weight (W/kg) for the constant-power part, vmax = top speed
// (km/h, held by a limiter), brake / grip (m/s²), df = extra grip from downforce at 80 m/s, lock = steering lock (rad).
// Lengths in metres. `sh` shoulder line (the top edge of the body side: wing — belt — haunch) as [z, y] from tail to nose,
// `crown` the rise of the centre line above it, `rock` the bottom edge of the side, `leanF` / `leanR` how far the nose and
// the tail stand back at each height [y, dz], `waist` the half width along the car [z, fraction of W/2].
// gh = greenhouse: zA / zC where windscreen and rear glass meet the deck on the centre line, zT1 / zT2 the roof's front and
// rear edge, bow* how far each of those lines sweeps back towards the corners, roofW the half width of the roof.
export const CAR_KINDS = ['sedan', 'gt', 'super', 'suv', 'suvc', 'cabrio', 'ev', 'offroad', 'city'];
const SPECS = {
  // large executive saloon: long bonnet, upright nose, formal three-box roof, long wheelbase
  sedan: {
    name: 'Executive S', L: 5.27, W: 1.95, H: 1.49, wb: 3.21, foh: 0.88, R: 0.365, tw: 0.265, rimR: 0.262, clr: 0.165,
    sh: [[-2.78, 0.95], [-2.55, 1.0], [-2.0, 1.03], [-1.2, 1.035], [0.0, 1.01], [0.75, 0.995], [1.4, 0.955], [2.0, 0.905], [2.38, 0.86], [2.49, 0.83]],
    crown: [[-2.78, 0.015], [-2.2, 0.03], [-1.6, 0.03], [0.9, 0.03], [1.5, 0.055], [2.2, 0.05], [2.49, 0.02]],
    rock: [[-2.78, 0.36], [-2.45, 0.27], [-2.0, 0.19], [-1.2, 0.165], [1.3, 0.165], [2.0, 0.19], [2.3, 0.21], [2.49, 0.22]],
    leanF: [[0.2, 0.09], [0.36, 0.015], [0.5, 0.0], [0.7, 0.012], [0.85, 0.055]], leanR: [[0.3, 0.1], [0.45, 0.01], [0.6, 0.0], [0.85, 0.025], [1.0, 0.075]],
    plan: { capF: 0.5, nF: 3.4, bowF: 0.11, capR: 0.46, nR: 3.6, bowR: 0.075, wf: 0.955, wr: 0.95 },
    waist: [[-1.9, 0.985], [-1.6, 1.0], [-0.6, 0.992], [0.6, 0.992], [1.6, 1.0], [1.9, 0.985]],
    flank: { tuck: 0.075, tumble: 0.05, wide: 0.5, crease: [0.8, 0.011, 0.085], scoop: [0.26, 0.012, 0.13], flare: 0.012, haunchR: 0.0 },
    fillet: { side: 0.035, nose: 0.085, tail: 0.05, rock: 0.045 },
    gh: { zA: 1.03, zC: -2.03, zT1: 0.2, zT2: -1.32, ledge: 0.03, bowA: 0.36, bowC: 0.24, capA: 0.17, capC: 0.2, roofW: 0.6, bowT1: 0.11, bowT2: 0.09, capT: 0.13, nCap: 4.2,
      roofEdge: [[-1.42, 1.428], [-1.0, 1.452], [-0.4, 1.458], [0.2, 1.435]], crown: 0.035, barrel: 0.014 },
    dlo: { zB: -0.38, q: [-1.64, -1.44], frame: 0.045, quarter: false, pano: true },
    face: { head: 'matrix', grille: 'tall', tail: 'wrap', exh: 2, chrome: true, lower: 'slots' },
    doors: 4, seats: 4, seatZ: -0.14, wheel: [10, 2, 'bright'], calliper: '#1b1c1f',
    perf: { acc: 6.4, pw: 300, vmax: 250, brake: 10.2, grip: 8.6, df: 0.08, lock: 0.6, roll: 0.045, pitch: 0.022, eng: 'v12', mass: 1.15 },
  },
  // grand-tourer coupé: front-mid engine, long bonnet, cab well back, fast roof into a short deck
  gt: {
    name: 'GT Coupé', L: 4.86, W: 1.97, H: 1.345, wb: 2.86, foh: 0.92, R: 0.365, tw: 0.285, rimR: 0.265, clr: 0.14,
    sh: [[-2.51, 0.86], [-2.3, 0.93], [-1.8, 0.985], [-1.2, 0.98], [-0.2, 0.93], [0.45, 0.905], [1.1, 0.86], [1.8, 0.775], [2.2, 0.69], [2.35, 0.64]],
    crown: [[-2.51, 0.015], [-1.9, 0.02], [0.5, 0.03], [1.2, 0.07], [2.0, 0.06], [2.35, 0.02]],
    rock: [[-2.51, 0.33], [-2.2, 0.22], [-1.75, 0.15], [-1.0, 0.14], [1.1, 0.14], [1.8, 0.155], [2.15, 0.17], [2.35, 0.18]],
    leanF: [[0.17, 0.07], [0.3, 0.01], [0.42, 0.0], [0.55, 0.05], [0.66, 0.14]], leanR: [[0.26, 0.11], [0.42, 0.01], [0.6, 0.0], [0.78, 0.03], [0.92, 0.1]],
    plan: { capF: 0.62, nF: 2.9, bowF: 0.13, capR: 0.5, nR: 3.2, bowR: 0.09, wf: 0.93, wr: 0.965 },
    waist: [[-1.75, 0.99], [-1.43, 1.0], [-0.5, 0.955], [0.5, 0.95], [1.43, 0.985], [1.75, 0.97]],
    flank: { tuck: 0.085, tumble: 0.055, wide: 0.52, crease: [0.78, 0.012, 0.09], scoop: [0.28, 0.02, 0.14], flare: 0.016, haunchR: 0.022 },
    fillet: { side: 0.05, nose: 0.11, tail: 0.06, rock: 0.045 },
    gh: { zA: 0.5, zC: -2.02, zT1: -0.36, zT2: -1.02, ledge: 0.035, bowA: 0.34, bowC: 0.3, capA: 0.18, capC: 0.24, roofW: 0.56, bowT1: 0.1, bowT2: 0.1, capT: 0.13, nCap: 4.0,
      roofEdge: [[-1.15, 1.285], [-0.8, 1.31], [-0.36, 1.295]], crown: 0.035, barrel: 0.016 },
    dlo: { zB: null, q: [-1.5, -1.06], frame: 0.04, quarter: false, pano: false, doorRear: -0.82 },
    face: { head: 'twin', grille: 'mesh', tail: 'oval', exh: 4, chrome: true, lower: 'wide' },
    doors: 2, seats: 4, seatZ: -0.62, wheel: [5, 2, 'bright'], calliper: '#9b1a14',
    perf: { acc: 8.2, pw: 440, vmax: 304, brake: 11.0, grip: 9.8, df: 0.14, lock: 0.58, roll: 0.035, pitch: 0.02, eng: 'v8', mass: 1.0 },
  },
  // low mid-engined supercar: cab forward, short pointed nose, huge rear haunches, side intakes
  super: {
    name: 'Supersport M', L: 4.6, W: 2.02, H: 1.165, wb: 2.68, foh: 1.06, R: 0.355, tw: 0.305, rimR: 0.265, clr: 0.115,
    sh: [[-2.2, 0.8], [-2.0, 0.865], [-1.4, 0.9], [-0.6, 0.83], [0.0, 0.76], [0.7, 0.71], [1.34, 0.675], [1.9, 0.56], [2.25, 0.45], [2.4, 0.4]],
    crown: [[-2.2, 0.02], [-1.5, 0.035], [0.6, 0.02], [1.3, 0.03], [2.0, 0.045], [2.4, 0.012]],
    rock: [[-2.2, 0.3], [-1.9, 0.17], [-1.5, 0.12], [-0.8, 0.115], [1.0, 0.115], [1.8, 0.125], [2.2, 0.135], [2.4, 0.14]],
    leanF: [[0.13, 0.05], [0.2, 0.0], [0.27, 0.01], [0.36, 0.1], [0.42, 0.2]], leanR: [[0.2, 0.12], [0.38, 0.02], [0.55, 0.0], [0.72, 0.02], [0.86, 0.08]],
    plan: { capF: 0.78, nF: 2.45, bowF: 0.1, capR: 0.42, nR: 3.6, bowR: 0.06, wf: 0.93, wr: 0.985 },
    waist: [[-1.7, 1.0], [-1.34, 1.0], [-0.55, 0.93], [0.3, 0.9], [1.34, 0.97], [1.6, 0.95]],
    flank: { tuck: 0.09, tumble: 0.06, wide: 0.5, crease: [0.74, 0.012, 0.09], scoop: [0.32, 0.035, 0.17], flare: 0.02, haunchR: 0.035 },
    fillet: { side: 0.07, nose: 0.1, tail: 0.055, rock: 0.04 },
    gh: { zA: 1.08, zC: -1.36, zT1: 0.12, zT2: -0.52, ledge: 0.05, bowA: 0.46, bowC: 0.2, capA: 0.2, capC: 0.22, roofW: 0.5, bowT1: 0.12, bowT2: 0.08, capT: 0.12, nCap: 3.6,
      roofEdge: [[-0.62, 1.1], [-0.25, 1.13], [0.12, 1.105]], crown: 0.03, barrel: 0.02 },
    dlo: { zB: null, q: [-0.72, -0.38], frame: 0.035, quarter: false, pano: false, doorRear: -0.52 },
    face: { head: 'blade', grille: 'none', tail: 'bar', exh: 2, chrome: false, lower: 'split', scoop: true, engineCover: true, wing: true },
    doors: 2, seats: 2, seatZ: -0.3, wheel: [5, 3, 'dark'], calliper: '#d9b21a',
    perf: { acc: 9.6, pw: 560, vmax: 330, brake: 12.0, grip: 11.0, df: 0.3, lock: 0.52, roll: 0.022, pitch: 0.014, eng: 'v10', mass: 0.85 },
  },
  // full-size luxury SUV: tall, square-shouldered, long roof, upright tail
  suv: {
    name: 'SUV Grand', L: 5.16, W: 2.03, H: 1.82, wb: 3.1, foh: 0.93, R: 0.405, tw: 0.29, rimR: 0.29, clr: 0.24,
    sh: [[-2.58, 1.16], [-2.4, 1.215], [-1.5, 1.225], [0.0, 1.2], [0.95, 1.18], [1.55, 1.13], [2.1, 1.075], [2.38, 1.03], [2.48, 0.995]],
    crown: [[-2.58, 0.01], [-1.0, 0.02], [1.0, 0.03], [1.6, 0.05], [2.2, 0.045], [2.48, 0.02]],
    rock: [[-2.58, 0.5], [-2.3, 0.36], [-1.95, 0.27], [-1.2, 0.24], [1.3, 0.24], [2.0, 0.27], [2.3, 0.31], [2.48, 0.33]],
    leanF: [[0.3, 0.12], [0.48, 0.02], [0.66, 0.0], [0.9, 0.02], [1.03, 0.065]], leanR: [[0.4, 0.14], [0.6, 0.02], [0.8, 0.0], [1.05, 0.02], [1.2, 0.05]],
    plan: { capF: 0.44, nF: 3.8, bowF: 0.1, capR: 0.36, nR: 4.2, bowR: 0.06, wf: 0.96, wr: 0.955 },
    waist: [[-1.9, 0.985], [-1.55, 1.0], [-0.6, 0.992], [0.6, 0.992], [1.55, 1.0], [1.9, 0.985]],
    flank: { tuck: 0.07, tumble: 0.045, wide: 0.48, crease: [0.83, 0.011, 0.075], scoop: [0.24, 0.012, 0.12], flare: 0.014, haunchR: 0.0 },
    fillet: { side: 0.035, nose: 0.07, tail: 0.04, rock: 0.045 },
    gh: { zA: 1.06, zC: -2.5, zT1: 0.28, zT2: -2.28, ledge: 0.03, bowA: 0.32, bowC: 0.07, capA: 0.16, capC: 0.13, roofW: 0.67, bowT1: 0.1, bowT2: 0.05, capT: 0.12, nCap: 4.6,
      roofEdge: [[-2.3, 1.735], [-1.6, 1.775], [-0.4, 1.79], [0.28, 1.76]], crown: 0.03, barrel: 0.012 },
    dlo: { zB: -0.3, zC2: -1.42, q: [-2.2, -2.06], frame: 0.05, quarter: true, pano: true },
    face: { head: 'stack', grille: 'wide', tail: 'vert', exh: 0, chrome: true, lower: 'skid', clad: 0.04, rails: true },
    doors: 4, seats: 5, seatZ: 0.02, wheel: [5, 2, 'bright'], calliper: '#1b1c1f',
    perf: { acc: 5.6, pw: 270, vmax: 250, brake: 9.2, grip: 7.6, df: 0.0, lock: 0.6, roll: 0.06, pitch: 0.03, eng: 'v8', mass: 1.35 },
  },
  // sporty SUV-coupé: high waist, roof falling in one arc to a high tail
  suvc: {
    name: 'SUV Coupé', L: 4.96, W: 2.01, H: 1.66, wb: 2.99, foh: 0.93, R: 0.4, tw: 0.3, rimR: 0.29, clr: 0.215,
    sh: [[-2.535, 1.12], [-2.35, 1.185], [-1.6, 1.185], [0.0, 1.13], [0.9, 1.1], [1.5, 1.06], [2.05, 1.0], [2.33, 0.955], [2.425, 0.925]],
    crown: [[-2.535, 0.012], [-1.0, 0.02], [0.9, 0.03], [1.5, 0.06], [2.1, 0.05], [2.425, 0.02]],
    rock: [[-2.535, 0.5], [-2.25, 0.34], [-1.9, 0.245], [-1.2, 0.215], [1.2, 0.215], [1.95, 0.245], [2.25, 0.28], [2.425, 0.3]],
    leanF: [[0.27, 0.11], [0.42, 0.02], [0.58, 0.0], [0.82, 0.03], [0.96, 0.09]], leanR: [[0.38, 0.15], [0.56, 0.03], [0.76, 0.0], [1.0, 0.03], [1.16, 0.09]],
    plan: { capF: 0.5, nF: 3.3, bowF: 0.12, capR: 0.42, nR: 3.7, bowR: 0.08, wf: 0.945, wr: 0.96 },
    waist: [[-1.85, 0.99], [-1.5, 1.0], [-0.55, 0.975], [0.55, 0.975], [1.5, 0.995], [1.85, 0.98]],
    flank: { tuck: 0.08, tumble: 0.05, wide: 0.5, crease: [0.8, 0.013, 0.085], scoop: [0.27, 0.02, 0.13], flare: 0.018, haunchR: 0.02 },
    fillet: { side: 0.045, nose: 0.09, tail: 0.05, rock: 0.045 },
    gh: { zA: 0.98, zC: -2.3, zT1: 0.08, zT2: -1.12, ledge: 0.035, bowA: 0.36, bowC: 0.22, capA: 0.17, capC: 0.2, roofW: 0.61, bowT1: 0.11, bowT2: 0.1, capT: 0.13, nCap: 4.0,
      roofEdge: [[-1.25, 1.55], [-0.85, 1.61], [-0.35, 1.63], [0.08, 1.6]], crown: 0.035, barrel: 0.015 },
    dlo: { zB: -0.36, q: [-1.72, -1.2], frame: 0.045, quarter: false, pano: true },
    face: { head: 'slim', grille: 'hex', tail: 'bar', exh: 4, chrome: false, lower: 'wide', clad: 0.035, wing: 'lip' },
    doors: 4, seats: 4, seatZ: -0.06, wheel: [5, 3, 'dark'], calliper: '#9b1a14',
    perf: { acc: 7.0, pw: 340, vmax: 262, brake: 10.0, grip: 8.6, df: 0.05, lock: 0.58, roll: 0.045, pitch: 0.025, eng: 'v8', mass: 1.25 },
  },
  // four-seat convertible, roof stowed: raked screen, clean deck with twin fairings behind the seats
  cabrio: {
    name: 'Cabriolet', L: 4.78, W: 1.94, H: 1.3, wb: 2.82, foh: 0.9, R: 0.36, tw: 0.275, rimR: 0.262, clr: 0.145,
    sh: [[-2.47, 0.86], [-2.25, 0.93], [-1.7, 0.97], [-0.9, 0.965], [0.0, 0.94], [0.6, 0.925], [1.2, 0.875], [1.8, 0.79], [2.18, 0.71], [2.31, 0.665]],
    crown: [[-2.47, 0.015], [-1.8, 0.025], [-1.0, 0.02], [0.6, 0.03], [1.2, 0.06], [2.0, 0.055], [2.31, 0.02]],
    rock: [[-2.47, 0.34], [-2.15, 0.23], [-1.75, 0.155], [-1.0, 0.145], [1.1, 0.145], [1.75, 0.16], [2.12, 0.18], [2.31, 0.19]],
    leanF: [[0.18, 0.08], [0.32, 0.012], [0.44, 0.0], [0.58, 0.04], [0.69, 0.11]], leanR: [[0.28, 0.1], [0.42, 0.01], [0.58, 0.0], [0.8, 0.025], [0.93, 0.085]],
    plan: { capF: 0.56, nF: 3.1, bowF: 0.12, capR: 0.48, nR: 3.3, bowR: 0.085, wf: 0.94, wr: 0.955 },
    waist: [[-1.75, 0.99], [-1.41, 1.0], [-0.5, 0.97], [0.5, 0.965], [1.41, 0.99], [1.75, 0.975]],
    flank: { tuck: 0.08, tumble: 0.05, wide: 0.52, crease: [0.8, 0.012, 0.085], scoop: [0.27, 0.016, 0.13], flare: 0.014, haunchR: 0.016 },
    fillet: { side: 0.045, nose: 0.1, tail: 0.06, rock: 0.045 },
    gh: { zA: 0.62, zC: -1.3, zT1: -0.2, zT2: -0.9, ledge: 0.035, bowA: 0.34, bowC: 0.1, capA: 0.18, capC: 0.2, roofW: 0.57, bowT1: 0.1, bowT2: 0.08, capT: 0.13, nCap: 4.0,
      roofEdge: [[-0.9, 1.26], [-0.2, 1.27]], crown: 0.02, barrel: 0.016 },
    dlo: { zB: null, q: [-1.2, -0.9], frame: 0.04, quarter: false, pano: false, open: true, doorRear: -0.74 },
    face: { head: 'slim', grille: 'oval', tail: 'wrap', exh: 2, chrome: true, lower: 'slots' },
    doors: 2, seats: 4, seatZ: -0.5, wheel: [10, 1, 'bright'], calliper: '#1b1c1f',
    perf: { acc: 7.0, pw: 340, vmax: 270, brake: 10.4, grip: 9.2, df: 0.08, lock: 0.58, roll: 0.04, pitch: 0.022, eng: 'v8', mass: 1.05 },
  },
  // electric fastback: cab forward, short bonnet, one arc from screen to tail, flush surfaces, closed nose
  ev: {
    name: 'E-Fastback', L: 5.0, W: 1.965, H: 1.405, wb: 3.06, foh: 0.9, R: 0.365, tw: 0.265, rimR: 0.268, clr: 0.15,
    sh: [[-2.57, 0.95], [-2.35, 1.0], [-1.7, 1.0], [-0.5, 0.965], [0.6, 0.94], [1.3, 0.9], [1.9, 0.8], [2.28, 0.7], [2.43, 0.64]],
    crown: [[-2.57, 0.012], [-1.5, 0.02], [0.9, 0.025], [1.5, 0.05], [2.1, 0.05], [2.43, 0.02]],
    rock: [[-2.57, 0.34], [-2.3, 0.24], [-1.9, 0.165], [-1.2, 0.15], [1.2, 0.15], [1.9, 0.165], [2.25, 0.18], [2.43, 0.19]],
    leanF: [[0.18, 0.06], [0.3, 0.008], [0.42, 0.0], [0.55, 0.05], [0.66, 0.14]], leanR: [[0.28, 0.12], [0.45, 0.015], [0.62, 0.0], [0.86, 0.025], [1.0, 0.09]],
    plan: { capF: 0.6, nF: 2.8, bowF: 0.12, capR: 0.5, nR: 3.1, bowR: 0.1, wf: 0.93, wr: 0.94 },
    waist: [[-1.9, 0.985], [-1.53, 1.0], [-0.6, 0.985], [0.6, 0.985], [1.53, 1.0], [1.9, 0.975]],
    flank: { tuck: 0.08, tumble: 0.055, wide: 0.5, crease: [0.84, 0.008, 0.08], scoop: [0.22, 0.018, 0.12], flare: 0.012, haunchR: 0.014 },
    fillet: { side: 0.055, nose: 0.12, tail: 0.06, rock: 0.045 },
    gh: { zA: 1.22, zC: -2.2, zT1: 0.22, zT2: -0.86, ledge: 0.035, bowA: 0.42, bowC: 0.26, capA: 0.19, capC: 0.22, roofW: 0.58, bowT1: 0.12, bowT2: 0.11, capT: 0.14, nCap: 3.8,
      roofEdge: [[-1.0, 1.325], [-0.5, 1.365], [-0.1, 1.37], [0.22, 1.345]], crown: 0.035, barrel: 0.016 },
    dlo: { zB: -0.4, q: [-1.74, -1.08], frame: 0.04, quarter: false, pano: 'full' },
    face: { head: 'bar', grille: 'none', tail: 'bar', exh: 0, chrome: false, lower: 'thin', flush: true },
    doors: 4, seats: 4, seatZ: 0.02, wheel: [5, 4, 'aero'], calliper: '#1b1c1f',
    perf: { acc: 8.8, pw: 390, vmax: 260, brake: 10.4, grip: 9.2, df: 0.08, lock: 0.58, roll: 0.03, pitch: 0.016, eng: 'ev', mass: 1.2 },
  },
  // classic-shaped off-roader: upright two-box, flat glass, exposed wheel arches, spare wheel on the tail door
  offroad: {
    name: 'Terra Classic', L: 4.62, W: 1.95, H: 1.96, wb: 2.89, foh: 0.82, R: 0.415, tw: 0.3, rimR: 0.265, clr: 0.33,
    sh: [[-2.355, 1.19], [-2.25, 1.235], [-1.0, 1.24], [0.0, 1.235], [0.84, 1.225], [1.4, 1.2], [2.0, 1.18], [2.22, 1.165], [2.265, 1.14]],
    crown: [[-2.355, 0.005], [0.8, 0.008], [1.2, 0.022], [2.1, 0.022], [2.265, 0.012]],
    rock: [[-2.355, 0.52], [-2.2, 0.44], [-1.9, 0.36], [-1.2, 0.33], [1.2, 0.33], [1.9, 0.36], [2.15, 0.44], [2.265, 0.5]],
    leanF: [[0.5, 0.05], [0.62, 0.012], [0.8, 0.0], [1.05, 0.0], [1.17, 0.015]], leanR: [[0.5, 0.05], [0.7, 0.0], [1.0, 0.0], [1.2, 0.006]],
    plan: { capF: 0.2, nF: 6.5, bowF: 0.03, capR: 0.14, nR: 8, bowR: 0.012, wf: 0.93, wr: 0.93 },
    waist: [[-1.9, 0.93], [-1.0, 0.93], [0.0, 0.93], [1.0, 0.93], [1.9, 0.93]],
    flank: { tuck: 0.025, tumble: 0.012, wide: 0.5, crease: [0.86, 0.012, 0.05], scoop: [0.2, 0.0, 0.1], flare: 0.0, haunchR: 0.0 },
    fillet: { side: 0.02, nose: 0.03, tail: 0.02, rock: 0.03 },
    gh: { zA: 0.9, zC: -2.3, zT1: 0.62, zT2: -2.24, ledge: 0.03, bowA: 0.05, bowC: 0.012, capA: 0.07, capC: 0.06, roofW: 0.76, bowT1: 0.04, bowT2: 0.012, capT: 0.06, nCap: 6.5,
      roofEdge: [[-2.24, 1.9], [-1.0, 1.93], [0.62, 1.925]], crown: 0.02, barrel: 0.003 },
    dlo: { zB: -0.2, zC2: -1.28, q: [-2.12, -2.1], frame: 0.06, quarter: true, pano: false },
    face: { head: 'round', grille: 'bars', tail: 'box', exh: 2, chrome: false, lower: 'bumper', arches: true, spare: true, steps: true, sidepipe: true, flatGlass: true },
    doors: 4, seats: 5, seatZ: 0.05, wheel: [6, 1, 'dark'], calliper: '#1b1c1f',
    perf: { acc: 5.2, pw: 215, vmax: 210, brake: 8.6, grip: 7.0, df: 0.0, lock: 0.62, roll: 0.07, pitch: 0.035, eng: 'v8', mass: 1.4 },
  },
  // premium compact: short overhangs, upright two-box, wheels at the corners — the car for the short bays
  city: {
    name: 'City Compact', L: 3.86, W: 1.73, H: 1.43, wb: 2.52, foh: 0.72, R: 0.315, tw: 0.215, rimR: 0.235, clr: 0.15,
    sh: [[-1.88, 0.9], [-1.7, 0.96], [-1.2, 0.98], [0.0, 0.95], [0.6, 0.93], [1.1, 0.89], [1.6, 0.82], [1.9, 0.76], [1.98, 0.73]],
    crown: [[-1.88, 0.012], [0.6, 0.025], [1.1, 0.05], [1.7, 0.045], [1.98, 0.02]],
    rock: [[-1.88, 0.34], [-1.65, 0.22], [-1.4, 0.16], [-0.8, 0.15], [0.8, 0.15], [1.4, 0.165], [1.8, 0.19], [1.98, 0.2]],
    leanF: [[0.18, 0.07], [0.32, 0.01], [0.45, 0.0], [0.62, 0.03], [0.76, 0.09]], leanR: [[0.3, 0.08], [0.45, 0.01], [0.62, 0.0], [0.85, 0.02], [0.97, 0.06]],
    plan: { capF: 0.42, nF: 3.0, bowF: 0.1, capR: 0.3, nR: 3.8, bowR: 0.06, wf: 0.93, wr: 0.95 },
    waist: [[-1.5, 0.99], [-1.26, 1.0], [-0.4, 0.985], [0.4, 0.985], [1.26, 1.0], [1.5, 0.985]],
    flank: { tuck: 0.065, tumble: 0.045, wide: 0.5, crease: [0.8, 0.01, 0.085], scoop: [0.26, 0.012, 0.13], flare: 0.014, haunchR: 0.008 },
    fillet: { side: 0.04, nose: 0.09, tail: 0.045, rock: 0.04 },
    gh: { zA: 0.86, zC: -1.72, zT1: 0.02, zT2: -1.3, ledge: 0.03, bowA: 0.3, bowC: 0.12, capA: 0.15, capC: 0.15, roofW: 0.56, bowT1: 0.09, bowT2: 0.06, capT: 0.11, nCap: 4.2,
      roofEdge: [[-1.3, 1.36], [-0.8, 1.395], [0.02, 1.385]], crown: 0.03, barrel: 0.013 },
    dlo: { zB: null, q: [-1.42, -1.22], frame: 0.045, quarter: false, pano: true, doorRear: -0.62 },
    face: { head: 'round', grille: 'oval', tail: 'oval', exh: 2, chrome: true, lower: 'slots' },
    doors: 2, seats: 4, seatZ: -0.2, wheel: [5, 2, 'bright'], calliper: '#9b1a14',
    perf: { acc: 5.0, pw: 150, vmax: 195, brake: 10.0, grip: 9.2, df: 0.0, lock: 0.62, roll: 0.04, pitch: 0.022, eng: 'i4', mass: 1.0 },
  },
};
SPECS.coupe = SPECS.gt;   // legacy id
for (const [kind, S] of Object.entries(SPECS)) {
  if (S.zF != null) continue;
  S.kind = kind;
  S.zF = S.wb / 2 + S.foh; S.zR = S.zF - S.L;
  S.Ra = S.R + (S.face.arches ? 0.085 : 0.04);                  // wheel-arch radius
  S.wheelX = S.W / 2 - S.tw / 2 - (S.face.arches ? -0.02 : 0.028);
  S.roof = S.H;                                                 // legacy name
  S.floor = S.clr + 0.11;
  S.seat = S.seatZ;                                             // legacy name: hip point of the front seats (z)
  S.cushion = S.floor + (S.H > 1.6 ? 0.36 : S.H > 1.3 ? 0.2 : 0.15);
  S.eye = Math.min(S.cushion + 0.68, S.H - (S.dlo.open ? 0.1 : S.H < 1.25 ? 0.21 : 0.17));
  S.cushion = Math.min(S.cushion, S.eye - 0.62);
  S.driverX = Math.min(S.W > 1.99 ? 0.4 : 0.37, (S.gh && S.gh.roofW ? S.gh.roofW : 0.6) - 0.16);   // under a narrow roof the seats stand closer together (else the A-pillar crosses the driver's view)
}
export function carSpec(kind) { return SPECS[kind] || SPECS.sedan; }
export const CAR_NAMES = Object.fromEntries(CAR_KINDS.map(k => [k, SPECS[k].name]));

// tasteful paints: [base colour, metalness, roughness, flake strength]
export const CAR_PAINTS = {
  black: ['#07080a', 0.4, 0.22, 0.06], graphite: ['#2e3136', 0.7, 0.3, 0.12], silver: ['#a9adb1', 0.85, 0.3, 0.12], pearl: ['#e9e6df', 0.1, 0.28, 0],
  blue: ['#0d2148', 0.6, 0.3, 0.11], green: ['#0c3323', 0.6, 0.3, 0.11], burgundy: ['#4a0c14', 0.6, 0.3, 0.1], champagne: ['#a8946f', 0.75, 0.32, 0.12],
  bronze: ['#5a4632', 0.75, 0.32, 0.12], white: ['#f1f1ee', 0.0, 0.3, 0], red: ['#8f0f14', 0.35, 0.28, 0.06], teal: ['#12404a', 0.65, 0.3, 0.11],
};
export const CAR_COLOURS = Object.fromEntries(Object.entries(CAR_PAINTS).map(([k, v]) => [k, v[0]]));
export const COLOUR_NAMES = Object.keys(CAR_COLOURS);
export const INTERIORS = [
  { leather: '#7a4a2a', accent: '#3b2616', dark: '#141312', head: '#cfc4b2' },   // cognac + walnut
  { leather: '#d6c9b0', accent: '#8f8f93', dark: '#1a1918', head: '#e2dccf' },   // ivory + aluminium
  { leather: '#1d1c1b', accent: '#6b4a2e', dark: '#0f0f0f', head: '#2a2927' },   // black + wood
  { leather: '#4a1a1a', accent: '#2b2b2e', dark: '#121111', head: '#cbc2b3' },   // oxblood + carbon
];
// which colours suit which design (seeded picks draw from these)
const PALETTE = {
  sedan: ['black', 'black', 'graphite', 'silver', 'pearl', 'blue', 'burgundy', 'champagne'], gt: ['green', 'blue', 'graphite', 'silver', 'burgundy', 'black', 'bronze'],
  super: ['red', 'pearl', 'graphite', 'teal', 'black', 'silver'], suv: ['black', 'pearl', 'graphite', 'bronze', 'green', 'silver', 'blue'],
  suvc: ['graphite', 'pearl', 'black', 'red', 'teal', 'silver'], cabrio: ['champagne', 'blue', 'pearl', 'burgundy', 'silver', 'green'],
  ev: ['pearl', 'silver', 'teal', 'graphite', 'white', 'blue'], offroad: ['green', 'black', 'white', 'graphite', 'bronze', 'silver'], city: ['red', 'pearl', 'teal', 'green', 'silver', 'black'],
};
const KIND_WEIGHT = [['sedan', 5], ['suv', 5], ['ev', 4], ['gt', 3], ['suvc', 4], ['cabrio', 2], ['offroad', 3], ['super', 2], ['city', 3]];
/** Deterministic pick for a parking spot (seeded): {kind, colour}. opts.fit(S) may veto a design (a bay too short, …). */
export function pickCar(r, opts = {}) {
  const pool = KIND_WEIGHT.filter(([k]) => (!opts.kinds || opts.kinds.includes(k)) && (!opts.fit || opts.fit(SPECS[k])));
  const list = pool.length ? pool : [['sedan', 1]];
  const wt = q => q[1] * (opts.weight ? opts.weight(SPECS[q[0]]) : 1);
  let t = r() * list.reduce((s, q) => s + wt(q), 0), kind = list[list.length - 1][0];
  for (const q of list) { if ((t -= wt(q)) < 0) { kind = q[0]; break; } }
  const pal = PALETTE[kind] || COLOUR_NAMES;
  return { kind, colour: pal[Math.floor(r() * pal.length)] };
}

// ------------------------------------------------------------------ marching squares over a parametric surface
// as / bs: grid lines (ascending). label(a, b) → key | null. P(a, b) → [x, y, z, nx, ny, nz].
// → { key: BufferGeometry(position, normal) } — cells of mixed labels are clipped along the exact boundary (bisection).
function msSurface(as, bs, label, P) {
  const na = as.length, nb = bs.length, L = new Array(na * nb);
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) L[i * nb + j] = label(as[i], bs[j]);
  const out = {}, vid = {};
  const bucket = k => (out[k] ||= { pos: [], nrm: [], idx: [] });
  const vert = (k, key, a, b) => {
    const m = (vid[k] ||= new Map()); let v = m.get(key);
    if (v === undefined) { const B = bucket(k), p = P(a, b); v = B.pos.length / 3; B.pos.push(p[0], p[1], p[2]); B.nrm.push(p[3], p[4], p[5]); m.set(key, v); }
    return v;
  };
  const corner = (k, i, j) => vert(k, i * nb + j, as[i], bs[j]);
  const edge = (k, i0, j0, i1, j1) => {   // (i0, j0) carries label k, (i1, j1) does not
    const key = 'e' + Math.min(i0 * nb + j0, i1 * nb + j1) + ':' + Math.max(i0 * nb + j0, i1 * nb + j1);
    const m = (vid[k] ||= new Map()); if (m.has(key)) return m.get(key);
    let a0 = as[i0], b0 = bs[j0], a1 = as[i1], b1 = bs[j1];
    for (let it = 0; it < 11; it++) { const am = (a0 + a1) / 2, bm = (b0 + b1) / 2; if (label(am, bm) === k) { a0 = am; b0 = bm; } else { a1 = am; b1 = bm; } }
    return vert(k, key, (a0 + a1) / 2, (b0 + b1) / 2);
  };
  for (let i = 0; i < na - 1; i++) for (let j = 0; j < nb - 1; j++) {
    const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], l = c.map(([p, q]) => L[p * nb + q]);
    if (l[0] === l[1] && l[1] === l[2] && l[2] === l[3]) {
      if (l[0] == null) continue;
      const B = bucket(l[0]), v = c.map(([p, q]) => corner(l[0], p, q)); B.idx.push(v[0], v[1], v[2], v[0], v[2], v[3]); continue;
    }
    for (const k of new Set(l)) {
      if (k == null) continue;
      const poly = [];
      for (let q = 0; q < 4; q++) {
        const A = c[q], Bq = c[(q + 1) % 4], la = l[q] === k, lb = l[(q + 1) % 4] === k;
        if (la) poly.push(corner(k, A[0], A[1]));
        if (la !== lb) poly.push(la ? edge(k, A[0], A[1], Bq[0], Bq[1]) : edge(k, Bq[0], Bq[1], A[0], A[1]));
      }
      const B = bucket(k); for (let q = 1; q < poly.length - 1; q++) B.idx.push(poly[0], poly[q], poly[q + 1]);
    }
  }
  const res = {};
  for (const [k, B] of Object.entries(out)) res[k] = orient(B.pos, B.nrm, B.idx);
  return res;
}
// indexed geometry with the given normals; every triangle wound to agree with them; degenerate triangles dropped
function orient(pos, nrm, idx) {
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) continue;
    const d = nx * (nrm[a] + nrm[b] + nrm[c]) + ny * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + nz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
    if (d >= 0) keep.push(idx[t], idx[t + 1], idx[t + 2]); else keep.push(idx[t], idx[t + 2], idx[t + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(keep);
  return g;
}
const lin = (a, b, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(lerp(a, b, i / n)); return o; };
const uniq = arr => { const s = [...arr].sort((p, q) => p - q), o = []; for (const v of s) if (!o.length || v - o[o.length - 1] > 1e-5) o.push(v); return o; };

// ------------------------------------------------------------------ outlines
// A half outline in plan (x ≥ 0) from the rear centre to the front centre, in three arc-length-parametrised parts:
// a ∈ [0, 1] the rear cap, [1, 2] the side, [2, 3] the front cap. cap = superellipse corner + a parabolic bow of the face.
function makeOutline({ z0R, z0F, capR, capF, nR, nF, bowR, bowF, hw }) {
  const N = 160, parts = [];
  const poly = fn => {
    const pts = []; for (let i = 0; i <= N; i++) pts.push(fn(i / N));
    const cum = [0]; for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[N] };
  };
  const Wr = hw(z0R), Wf = hw(z0F);
  // the caps are sampled in an angle that is eased at both ends (the superellipse parameter is singular there)
  const ease = t => t * t * (3 - 2 * t);
  parts.push(poly(t => { const ps = (1 - ease(t)) * Math.PI / 2, x = Wr * Math.pow(Math.cos(ps), 2 / nR); return [x, z0R - capR * Math.pow(Math.sin(ps), 2 / nR) - bowR * (1 - (x / Wr) ** 2)]; }));
  parts.push(poly(t => { const z = lerp(z0R, z0F, t); return [hw(z), z]; }));
  parts.push(poly(t => { const ph = ease(t) * Math.PI / 2, x = Wf * Math.pow(Math.cos(ph), 2 / nF); return [x, z0F + capF * Math.pow(Math.sin(ph), 2 / nF) + bowF * (1 - (x / Wf) ** 2)]; }));
  const at = (a) => {
    a = clamp(a, 0, 3); const k = Math.min(2, Math.floor(a)), p = parts[k], s = (a - k) * p.len;
    let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.cum[m] <= s) lo = m; else hi = m; }
    const f = (s - p.cum[lo]) / ((p.cum[hi] - p.cum[lo]) || 1), A = p.pts[lo], B = p.pts[hi];
    return [lerp(A[0], B[0], f), lerp(A[1], B[1], f)];
  };
  // point + outward unit normal (central difference in arc length, across part joins)
  const full = a => {
    const e = 0.004, p = at(a), q0 = at(Math.max(0, a - e)), q1 = at(Math.min(3, a + e));
    let tx = q1[0] - q0[0], tz = q1[1] - q0[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // travelling rear → front along the right-hand… (x ≥ 0) side, outward is (tz, −tx)
    return [p[0], p[1], tz, -tx];
  };
  return { at: full, len: parts.map(p => p.len), Wr, Wf };
}

// ------------------------------------------------------------------ the body surface
function bodySurface(S) {
  const sh = mono(S.sh), crown = mono(S.crown), rock = mono(S.rock), leanF = mono(S.leanF), leanR = mono(S.leanR), waist = mono(S.waist);
  const W2 = S.W / 2, pl = S.plan, F = S.flank, zw = [S.wb / 2, -S.wb / 2];
  const z0F = S.zF - pl.capF - pl.bowF, z0R = S.zR + pl.capR + pl.bowR;
  // half width along the side; eased into the cap widths so the outline has no kink where the caps start
  const hw = z => { const k = sstep(z0R, z0R + 0.5, z) * (1 - sstep(z0F - 0.5, z0F, z)); return W2 * lerp(z > 0 ? pl.wf : pl.wr, waist(z), k); };
  const O = makeOutline({ z0R, z0F, capR: pl.capR, capF: pl.capF, nR: pl.nR, nF: pl.nF, bowR: pl.bowR, bowF: pl.bowF, hw });
  const cache = new Map();
  // per column: outline point, how much the column faces forward / rearward, wall bottom and top
  const col = a => {
    const key = Math.round(a * 1e5); let c = cache.get(key); if (c) return c;
    const [x, z, nx, nz] = O.at(a), wF = Math.pow(Math.max(0, nz), 1.6), wR = Math.pow(Math.max(0, -nz), 1.6);
    const rs = lerp(lerp(S.fillet.side, S.fillet.nose, wF), S.fillet.tail, wR), rr = S.fillet.rock;
    let yT = sh(z), yB = rock(z);
    // the top edge sits where the shoulder line passes the leaning wall (fixed point, converges in a few steps)
    for (let k = 0; k < 4; k++) { const dz = leanF(yT) * wF - leanR(yT) * wR; yT = sh(z - dz * 0.999); }
    c = { a, x, z, nx, nz, wF, wR, rs, rr, yT, yB };
    if (cache.size < 60000) cache.set(key, c);
    return c;
  };
  const tri = (x, w) => Math.max(0, 1 - Math.abs(x) / w);
  // inward offset of the wall (along the outline normal) at height y
  const inset = (c, y) => {
    const s = clamp((y - c.yB) / Math.max(0.05, c.yT - c.yB));
    let d = s < F.wide ? F.tuck * ((F.wide - s) / F.wide) ** 2.2 : F.tumble * ((s - F.wide) / (1 - F.wide)) ** 2;
    const sideW = 1 - Math.max(c.wF, c.wR);
    d -= F.crease[1] * tri(s - F.crease[0], F.crease[2]) * sideW;                       // shoulder crease (a ridge)
    d += F.scoop[1] * gauss(s - F.scoop[0], F.scoop[2]) * sideW * (1 - 0.8 * Math.max(gauss(c.z - zw[0], 0.75), gauss(c.z - zw[1], 0.75)));   // light catcher low on the doors
    for (let k = 0; k < 2; k++) {                                                        // flares round the wheel arches
      const rho = Math.hypot(c.z - zw[k], y - S.R);
      if (F.flare) d -= F.flare * gauss(Math.max(0, rho - S.Ra), 0.1) * sideW;
    }
    if (F.haunchR) d -= F.haunchR * gauss(c.z - zw[1], 0.62) * sstep(0.35, 0.8, s) * sideW;   // rear haunch
    d += leanF(y) * c.wF + leanR(y) * c.wR;
    return d;
  };
  const wall = (c, y) => { const d = inset(c, y); return [c.x - c.nx * d, y, c.z - c.nz * d]; };
  // deck edge point of a column (after the shoulder fillet) and the crown above it
  const deckEdge = c => {
    if (c.D) return c.D;
    const d = inset(c, c.yT) + c.rs, x = Math.max(0, c.x - c.nx * d), z = c.z - c.nz * d;
    const cz = crown(z) * Math.min(1, x / (O.Wf * 0.55)) ** 1.3;
    return (c.D = { x, z, y: c.yT + Math.min(0.012, cz * 0.25), cz });
  };
  const bez = (A, C, B, t) => { const u = 1 - t; return [u * u * A[0] + 2 * u * t * C[0] + t * t * B[0], u * u * A[1] + 2 * u * t * C[1] + t * t * B[1], u * u * A[2] + 2 * u * t * C[2] + t * t * B[2]]; };
  // right half: b ∈ [0, 1] floor (centre → rocker), [1, 2] rocker fillet, [2, 3] wall, [3, 4] shoulder fillet, [4, 5] deck (edge → centre)
  const half = (a, b) => {
    const c = col(a);
    if (b >= 4) { const D = deckEdge(c), v = b - 4, xi = 1 - v; return [D.x * xi, D.y + D.cz * (1 - Math.pow(xi, 2.2)), D.z]; }
    if (b >= 3) { const D = deckEdge(c), A = wall(c, c.yT - c.rs), C = wall(c, c.yT); C[1] = D.y; return bez(A, C, [D.x, D.y, D.z], b - 3); }
    if (b >= 2) return wall(c, lerp(c.yB + c.rr, c.yT - c.rs, b - 2));
    const d0 = inset(c, c.yB) + c.rr, fx = Math.max(0, c.x - c.nx * d0), fz = c.z - c.nz * d0;
    if (b >= 1) return bez([fx, c.yB, fz], wall(c, c.yB), wall(c, c.yB + c.rr), b - 1);
    return [fx * b, c.yB, fz];
  };
  const pos = (a, b) => { if (b <= 5) return half(a, b); const p = half(a, 10 - b); return [-p[0], p[1], p[2]]; };
  // position + outward normal
  const P = (a, b) => {
    const m = b > 5, bb = m ? 10 - b : b, p = half(a, bb);
    const ea = 0.006, eb = 0.012, a0 = Math.max(0, a - ea), a1 = Math.min(3, a + ea), b0 = Math.max(0, bb - eb), b1 = Math.min(5, bb + eb);
    const A0 = half(a0, bb), A1 = half(a1, bb), B0 = half(a, b0), B1 = half(a, b1);
    const ux = A1[0] - A0[0], uy = A1[1] - A0[1], uz = A1[2] - A0[2], vx = B1[0] - B0[0], vy = B1[1] - B0[1], vz = B1[2] - B0[2];
    let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux; const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { nx = 0; ny = bb > 3.5 ? 1 : bb < 1.5 ? -1 : 0; nz = bb > 3.5 || bb < 1.5 ? 0 : (a > 1.5 ? 1 : -1); } else { nx /= l; ny /= l; nz /= l; }
    return m ? [-p[0], p[1], p[2], -nx, ny, nz] : [p[0], p[1], p[2], nx, ny, nz];
  };
  // ---- charts: where is a given place of the car in (a, b)?
  const solve = (f, lo, hi) => { let flo = f(lo); for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2, fm = f(m); if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m; } return (lo + hi) / 2; };
  const bOfY = (c, y) => { const y0 = c.yB + c.rr, y1 = c.yT - c.rs; return y <= y0 ? 2 - clamp((y0 - y) / c.rr) * 0.5 : y >= y1 ? 3 + clamp((y - y1) / c.rs) * 0.5 : 2 + (y - y0) / (y1 - y0); };
  // side view (z, y) → (a, b) on the right wall
  const sideAB = (z, y) => { const a = solve(q => wall(col(q), y)[2] - z, 0.15, 2.85); return [a, bOfY(col(a), y)]; };
  // unrolled front / rear: d = distance along the outline from the centre of the nose (tail), y = height
  const frontAB = (d, y) => { const a = d <= O.len[2] ? 3 - d / O.len[2] : 2 - (d - O.len[2]) / O.len[1]; return [a, bOfY(col(a), y)]; };
  const rearAB = (d, y) => { const a = d <= O.len[0] ? d / O.len[0] : 1 + (d - O.len[0]) / O.len[1]; return [a, bOfY(col(a), y)]; };
  // plan (x ≥ 0, z) → (a, b) on the deck
  const deckA = z => solve(q => deckEdge(col(q)).z - z, 0, 3);
  const deckAB = (x, z) => { const a = deckA(z), D = deckEdge(col(a)); return [a, 5 - clamp(x / Math.max(1e-4, D.x))]; };
  const deckY = (x, z) => { const a = deckA(z), D = deckEdge(col(a)), xi = clamp(Math.abs(x) / Math.max(1e-4, D.x)); return D.y + D.cz * (1 - Math.pow(xi, 2.2)); };
  const deckHalf = z => deckEdge(col(deckA(z))).x;
  const sideX = (z, y) => { const [a, b] = sideAB(z, y); return half(a, b)[0]; };
  return { S, O, P, pos, half, col, wall, deckEdge, sideAB, frontAB, rearAB, deckAB, deckY, deckHalf, sideX, sh, rock, crown, zw, z0F, z0R };
}

// ------------------------------------------------------------------ the greenhouse surface
// a ∈ [0, 3] as for the body (rear cap, side, front cap) on two outlines: the base on the deck and the roof edge.
// right half: b ∈ [0, 1] wall (base → roof edge), [1, 2] roof-rail fillet, [2, 3] roof (edge → centre line); mirrored on [3, 6].
function greenhouseSurface(S, B) {
  const G = S.gh, roofEdge = mono(G.roofEdge), n = G.nCap;
  const baseHw = z => Math.max(0.2, B.deckHalf(clamp(z, G.zC + 0.05, G.zA - 0.05)) - G.ledge);
  const z0A = G.zA - G.bowA - G.capA, z0C = G.zC + G.bowC + G.capC;
  const Ob = makeOutline({ z0R: z0C, z0F: z0A, capR: G.capC, capF: G.capA, nR: n, nF: n, bowR: G.bowC, bowF: G.bowA, hw: baseHw });
  const t0A = G.zT1 - G.bowT1 - G.capT, t0C = G.zT2 + G.bowT2 + G.capT;
  const roofHw = z => G.roofW * (1 - 0.06 * sstep(t0C + 0.5, t0C, z) - 0.03 * sstep(t0A - 0.4, t0A, z));
  const Ot = makeOutline({ z0R: t0C, z0F: t0A, capR: G.capT, capF: G.capT, nR: n, nF: n, bowR: G.bowT2, bowF: G.bowT1, hw: roofHw });
  const rr = S.face.flatGlass ? 0.02 : 0.04, cache = new Map();
  const col = a => {
    const key = Math.round(a * 1e5); let c = cache.get(key); if (c) return c;
    const b = Ob.at(a), t = Ot.at(a);
    const yb = B.deckY(b[0], b[1]) - 0.035, yt = roofEdge(t[1]);
    const len = Math.hypot(t[0] - b[0], yt - yb, t[1] - b[1]) || 1;
    // roof edge point after the fillet (inward along the roof outline's normal) and its crown
    const Dx = Math.max(0, t[0] - t[2] * rr), Dz = t[1] - t[3] * rr;
    const face = Math.max(Math.pow(Math.max(0, b[3]), 2), Math.pow(Math.max(0, -b[3]), 2));   // 1 on the screens, 0 on the sides
    c = { a, b, t, yb, yt, len, D: { x: Dx, z: Dz, y: yt + 0.006, cz: G.crown * Math.min(1, Dx / (G.roofW * 0.6)) ** 1.3 }, face, s1: 1 - rr / len };
    if (cache.size < 60000) cache.set(key, c);
    return c;
  };
  const wall = (c, s) => {
    const k = G.barrel * (1 + 1.4 * c.face) * 4 * s * (1 - s);
    return [lerp(c.b[0], c.t[0], s) + c.b[2] * k, lerp(c.yb, c.yt, s) + k * 0.35, lerp(c.b[1], c.t[1], s) + c.b[3] * k];
  };
  const bez = (A, C, D, t) => { const u = 1 - t; return [u * u * A[0] + 2 * u * t * C[0] + t * t * D[0], u * u * A[1] + 2 * u * t * C[1] + t * t * D[1], u * u * A[2] + 2 * u * t * C[2] + t * t * D[2]]; };
  const half = (a, b) => {
    const c = col(a);
    if (b >= 2) { const v = b - 2, xi = 1 - v; return [c.D.x * xi, c.D.y + c.D.cz * (1 - Math.pow(xi, 2.2)), c.D.z]; }
    if (b >= 1) return bez(wall(c, c.s1), [c.t[0], c.yt + 0.004, c.t[1]], [c.D.x, c.D.y, c.D.z], b - 1);
    return wall(c, b * c.s1);
  };
  const P = (a, b) => {
    const m = b > 3, bb = m ? 6 - b : b, p = half(a, bb);
    const ea = 0.006, eb = 0.012, A0 = half(Math.max(0, a - ea), bb), A1 = half(Math.min(3, a + ea), bb), B0 = half(a, Math.max(0, bb - eb)), B1 = half(a, Math.min(3, bb + eb));
    const ux = A1[0] - A0[0], uy = A1[1] - A0[1], uz = A1[2] - A0[2], vx = B1[0] - B0[0], vy = B1[1] - B0[1], vz = B1[2] - B0[2];
    let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux; const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { nx = 0; ny = 1; nz = 0; } else { nx /= l; ny /= l; nz /= l; }
    return m ? [-p[0], p[1], p[2], -nx, ny, nz] : [p[0], p[1], p[2], nx, ny, nz];
  };
  // is (x, z) of the deck under the cabin? (the opening cut into the body; m = margin kept as a ledge)
  const solveA = z => { let lo = 0, hi = 3; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (Ob.at(m)[1] < z) lo = m; else hi = m; } return (lo + hi) / 2; };
  const under = (x, z, m = 0.012) => { if (z <= G.zC + m || z >= G.zA - m) return false; return Math.abs(x) < Ob.at(solveA(z))[0] - m && (Math.abs(x) < 0.01 || (z < G.zA - m && z > G.zC + m)); };
  // side view z → a on the side part / caps (for the daylight opening), and the glass height fraction at (z, y)
  return { S, G, Ob, Ot, P, half, col, wall, under, solveA, z0A, z0C, t0A, t0C };
}

// ------------------------------------------------------------------ small geometry helpers
function attr(geo, name, n, v) {
  const cnt = geo.attributes.position.count, a = new Float32Array(cnt * n);
  for (let i = 0; i < cnt; i++) for (let k = 0; k < n; k++) a[i * n + k] = v[k];
  geo.setAttribute(name, new THREE.BufferAttribute(a, n)); return geo;
}
const COL = new THREE.Color();
function strip(g, keep) { for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k); return g; }
function tint(geo, hex, metal, rough) {   // colour (linear) + metal / rough attributes for the per-vertex PBR materials
  COL.set(hex); const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  strip(g, ['position', 'normal']);
  if (!g.attributes.normal) g.computeVertexNormals();
  attr(g, 'color', 3, [COL.r, COL.g, COL.b]); attr(g, 'mr', 2, [metal, rough]); return g;
}
function glow(geo, rgb, lk) {   // light geometry: colour + light group (0 head, 1 tail / brake, 2 always-on accents, 3 reverse, 4 indicators)
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  strip(g, ['position', 'normal']);
  if (!g.attributes.normal) g.computeVertexNormals();
  attr(g, 'color', 3, rgb); attr(g, 'lk', 1, [lk]); return g;
}
function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; return g; }
  for (const key of Object.keys(g.attributes)) {
    const at = g.attributes[key], n = at.itemSize, arr = at.array;
    for (let i = 0; i < at.count; i += 3) for (let k = 0; k < n; k++) { const t = arr[(i + 1) * n + k]; arr[(i + 1) * n + k] = arr[(i + 2) * n + k]; arr[(i + 2) * n + k] = t; }
  }
  return g;
}
const mirrorX = g => { const c = g.clone(); c.scale(-1, 1, 1); flipWinding(c); return c; };
function mergeAll(list, keep) {
  const L = list.filter(Boolean); if (!L.length) return null;
  const g = mergeGeometries(L.map(q => strip(q.index ? q.toNonIndexed() : q, keep)), false);
  L.forEach(q => q.dispose()); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
// metallic-flake UVs projected along each vertex's dominant normal axis
function boxUV(g, k) {
  if (!g) return g;
  const p = g.attributes.position, n = g.attributes.normal, uv = new THREE.BufferAttribute(new Float32Array(p.count * 2), 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i) * k, p.getY(i) * k);
    else if (ay >= az) uv.setXY(i, p.getX(i) * k + 0.37, p.getZ(i) * k);
    else uv.setXY(i, p.getX(i) * k + 0.71, p.getY(i) * k);
  }
  g.setAttribute('uv', uv); return g;
}
const rrIn = (u0, u1, v0, v1, r) => (u, v) => {
  if (u < u0 || u > u1 || v < v0 || v > v1) return false;
  const rr = Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2), cu = clamp(u, u0 + rr, u1 - rr), cv = clamp(v, v0 + rr, v1 - rr); return (u - cu) ** 2 + (v - cv) ** 2 <= rr * rr + 1e-9;
};
const rrPts = (u0, u1, v0, v1, r, seg = 6) => {
  r = Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2); const out = [];
  const corner = (cu, cv, from) => { for (let i = 0; i <= seg; i++) { const t = from + i / seg * Math.PI / 2; out.push([cu + Math.cos(t) * r, cv + Math.sin(t) * r]); } };
  corner(u1 - r, v0 + r, -Math.PI / 2); corner(u1 - r, v1 - r, 0); corner(u0 + r, v1 - r, Math.PI / 2); corner(u0 + r, v0 + r, Math.PI);
  return out;
};
const ellIn = (cu, cv, ru, rv) => (u, v) => ((u - cu) / ru) ** 2 + ((v - cv) / rv) ** 2 <= 1;
const ellPts = (cu, cv, ru, rv, n = 28) => { const o = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; o.push([cu + Math.cos(t) * ru, cv + Math.sin(t) * rv]); } return o; };
const polyIn = P => (u, v) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ui, vi] = P[i], [uj, vj] = P[j]; if ((vi > v) !== (vj > v) && u < (uj - ui) * (v - vi) / (vj - vi) + ui) c = !c; } return c; };

// A chart maps drawing coordinates (u, v) onto a surface: → [x, y, z, nx, ny, nz]. Decals are drawn in a chart.
// fill: region `inside(u, v)` over [u0, u1] × [v0, v1], lifted `off` metres off the surface
function decalFill(chart, inside, u0, u1, v0, v1, step, off = 0.002) {
  const nu = Math.max(1, Math.ceil((u1 - u0) / step)), nv = Math.max(1, Math.ceil((v1 - v0) / step));
  const r = msSurface(lin(u0, u1, nu), lin(v0, v1, nv), (u, v) => (inside(u, v) ? 'k' : null), (u, v) => { const p = chart(u, v); return [p[0] + p[3] * off, p[1] + p[4] * off, p[2] + p[5] * off, p[3], p[4], p[5]]; });
  return r.k || null;
}
// line: polyline `pts` [[u, v], …] of the given width (metres, measured on the surface)
function decalLine(chart, pts, width, off = 0.003, closed = false, step = 0.03) {
  const dense = [];
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const A = pts[i], Bq = pts[(i + 1) % n], pa = chart(A[0], A[1]), pb = chart(Bq[0], Bq[1]), L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]), k = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < k; s++) dense.push([lerp(A[0], Bq[0], s / k), lerp(A[1], Bq[1], s / k)]);
  }
  if (!closed) dense.push(pts[n - 1]);
  const W = dense.map(([u, v]) => chart(u, v)), N = W.length, pos = [], nrm = [], idx = [];
  for (let i = 0; i < N; i++) {
    const p = W[i], a = W[closed ? (i - 1 + N) % N : Math.max(0, i - 1)], b = W[closed ? (i + 1) % N : Math.min(N - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let bx = p[4] * tz - p[5] * ty, by = p[5] * tx - p[3] * tz, bz = p[3] * ty - p[4] * tx; const bl = Math.hypot(bx, by, bz) || 1; bx *= width / 2 / bl; by *= width / 2 / bl; bz *= width / 2 / bl;
    const ox = p[0] + p[3] * off, oy = p[1] + p[4] * off, oz = p[2] + p[5] * off;
    pos.push(ox - bx, oy - by, oz - bz, ox + bx, oy + by, oz + bz); nrm.push(p[3], p[4], p[5], p[3], p[4], p[5]);
  }
  const M = closed ? N : N - 1;
  for (let i = 0; i < M; i++) { const a = i * 2, b = ((i + 1) % N) * 2; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  return orient(pos, nrm, idx);
}

// ------------------------------------------------------------------ wheels
const GEO = {};   // cache: kind:tier:what → geometry
function wheelGeometry(kind, tier) {
  const key = kind + ':wheel:' + tier; if (GEO[key]) return GEO[key];
  const S = carSpec(kind), R = S.R, tw = S.tw, Rr = S.rimR, hw = tw / 2, parts = [];
  const seg = tier === 0 ? 32 : tier === 1 ? 12 : 8, [N, style, finish] = S.wheel;
  // tyre: rounded shoulder, flat tread, slim sidewall (lathe around y, then y → x)
  const tp = [[Rr - 0.004, -hw * 0.8], [Rr + 0.012, -hw * 0.97], [(Rr + R) / 2, -hw * 1.03], [R - 0.03, -hw * 0.98], [R - 0.007, -hw * 0.86], [R, -hw * 0.62],
    [R, hw * 0.62], [R - 0.007, hw * 0.86], [R - 0.03, hw * 0.98], [(Rr + R) / 2, hw * 1.03], [Rr + 0.012, hw * 0.97], [Rr - 0.004, hw * 0.8]];
  const prof = (tier === 2 ? [tp[0], tp[5], tp[6], tp[11]] : tier === 1 ? [tp[0], tp[3], tp[5], tp[6], tp[8], tp[11]] : tier === 9 ? tp.filter((_, i) => i % 2 === 0 || i === tp.length - 1) : tp).map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(prof, tier === 2 ? 10 : seg); tyre.rotateZ(-Math.PI / 2); parts.push(tint(tyre, '#0d0d0e', 0, 0.88));
  const bright = finish === 'bright', FACE = bright ? '#c9cbce' : finish === 'aero' ? '#b7babd' : '#3a3c40', FLANK = bright ? '#17181a' : '#0d0d0f', xo = hw * 0.66;
  if (tier === 2) {   // far: a disc with the rim colour and a dark ring
    const d = new THREE.CircleGeometry(Rr, seg); d.rotateY(Math.PI / 2); d.translate(xo, 0, 0); parts.push(tint(d, bright ? '#8f9194' : '#34363a', 1, 0.35));
  } else {
    // barrel + lip
    const bar = new THREE.LatheGeometry([new THREE.Vector2(Rr - 0.004, hw * 0.8), new THREE.Vector2(Rr - 0.016, hw * 0.55), new THREE.Vector2(Rr - 0.016, -hw * 0.8)], seg);
    bar.rotateZ(-Math.PI / 2); if (tier === 0) parts.push(tint(bar, '#1c1d20', 1, 0.5)); else { const d = new THREE.CircleGeometry(Rr, seg); d.rotateY(Math.PI / 2); d.translate(-hw * 0.2, 0, 0); parts.push(tint(d, '#141516', 0.6, 0.5)); }
    const lip = new THREE.LatheGeometry([new THREE.Vector2(Rr + 0.003, hw * 0.8), new THREE.Vector2(Rr + 0.01, hw * 0.87), new THREE.Vector2(Rr - 0.004, hw * 0.91), new THREE.Vector2(Rr - 0.02, hw * 0.84)], seg);
    lip.rotateZ(-Math.PI / 2); parts.push(tint(lip, bright ? '#d5d6d8' : '#4a4c50', 1, 0.2));
    // spokes: bevelled extrusions, dished towards the hub; style 1 single, 2 twin, 3 Y-split, 4 aero blades
    const r0 = 0.062, r1 = Rr - 0.008, shapes = [];
    const spoke = (wa, wb, off = 0, bend = 0) => { const s = new THREE.Shape(); s.moveTo(r0, -wa / 2 + off * 0.3); s.lineTo(r1, -wb / 2 + off + bend); s.lineTo(r1, wb / 2 + off + bend); s.lineTo(r0, wa / 2 + off * 0.3); s.closePath(); return s; };
    if (style === 1) shapes.push(spoke(0.03, 0.042));
    else if (style === 2) shapes.push(spoke(0.022, 0.03, -0.034), spoke(0.022, 0.03, 0.034));
    else if (style === 3) shapes.push(spoke(0.03, 0.03, -0.062), spoke(0.03, 0.03, 0.062));
    else shapes.push(spoke(0.085, 0.13, 0, 0.03));
    for (let k = 0; k < N; k++) for (const shp of shapes) {
      const g0 = new THREE.ExtrudeGeometry(shp, { depth: style === 4 ? 0.012 : 0.024, bevelEnabled: tier === 0, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1, curveSegments: 1, steps: 1 });
      const ng = g0.index ? g0.toNonIndexed() : g0; if (ng !== g0) g0.dispose();
      const cnt = ng.attributes.position.count, col = new Float32Array(cnt * 3), mr = new Float32Array(cnt * 2), nrm = ng.attributes.normal, p = ng.attributes.position;
      const a = (k + 0.5) / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < cnt; i++) {
        const face = nrm.getZ(i) > 0.6; COL.set(face ? FACE : FLANK); col.set([COL.r, COL.g, COL.b], i * 3); mr.set(face ? [1, bright ? 0.16 : 0.3] : [1, 0.42], i * 2);
        const rr = p.getX(i), tt = p.getY(i), dd = p.getZ(i), dish = -0.04 * Math.pow(1 - clamp((rr - r0) / (r1 - r0)), 1.5);
        p.setXYZ(i, xo - 0.024 + dd + dish, rr * ca - tt * sa, rr * sa + tt * ca);
        const nx = nrm.getZ(i), ny = nrm.getX(i), nz = nrm.getY(i); nrm.setXYZ(i, nx, ny * ca - nz * sa, ny * sa + nz * ca);
      }
      strip(ng, ['position', 'normal']); ng.setAttribute('color', new THREE.BufferAttribute(col, 3)); ng.setAttribute('mr', new THREE.BufferAttribute(mr, 2)); parts.push(ng);
    }
    const hub = new THREE.CylinderGeometry(0.066, 0.075, 0.045, tier ? 10 : 24); hub.rotateZ(Math.PI / 2); hub.translate(xo - 0.046, 0, 0); parts.push(tint(hub, FACE, 1, 0.22));
    const cap = new THREE.CylinderGeometry(0.03, 0.03, 0.01, tier ? 8 : 20); cap.rotateZ(Math.PI / 2); cap.translate(xo - 0.02, 0, 0); parts.push(tint(cap, '#101114', 0.7, 0.25));
    if (tier === 0) for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, nu = new THREE.CylinderGeometry(0.008, 0.008, 0.016, 6); nu.rotateZ(Math.PI / 2); nu.translate(xo - 0.026, Math.cos(a) * 0.047, Math.sin(a) * 0.047); parts.push(tint(nu, '#dcdde0', 1, 0.22)); }
  }
  return (GEO[key] = mergeAll(parts, ['position', 'normal', 'color', 'mr']));
}

// ------------------------------------------------------------------ interior
function steeringGeometry() {
  const parts = [];
  const rim = new THREE.TorusGeometry(0.182, 0.0165, 12, 48);
  { const p = rim.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.13) p.setY(i, -0.13 + (p.getY(i) + 0.13) * 0.55); rim.computeVertexNormals(); }
  parts.push(tint(rim, '#161413', 0, 0.5));
  const boss = new RoundedBoxGeometry(0.118, 0.088, 0.034, 3, 0.03); boss.translate(0, -0.006, 0.004); parts.push(tint(boss, '#1b1917', 0, 0.55));
  const ring = new THREE.TorusGeometry(0.02, 0.0028, 8, 24); ring.translate(0, -0.004, -0.014); parts.push(tint(ring, '#c9cacc', 1, 0.18));
  for (const a of [0, Math.PI]) {
    const sp = new RoundedBoxGeometry(0.115, 0.02, 0.012, 2, 0.005); sp.translate(0.112, 0.002, 0.004); sp.rotateZ(a); parts.push(tint(sp, '#9a9c9f', 1, 0.3));
    const pad = new RoundedBoxGeometry(0.05, 0.03, 0.012, 2, 0.005); pad.translate(0.085, 0.002, -0.004); pad.rotateZ(a); parts.push(tint(pad, '#0d0d0e', 0.2, 0.3));
  }
  for (const dx of [-0.02, 0.02]) { const sp = new RoundedBoxGeometry(0.014, 0.115, 0.01, 2, 0.004); sp.translate(dx, -0.095, 0.004); parts.push(tint(sp, '#9a9c9f', 1, 0.3)); }
  const col = new THREE.CylinderGeometry(0.03, 0.04, 0.3, 12); col.rotateX(Math.PI / 2); col.translate(0, 0, 0.17); parts.push(tint(col, '#121212', 0, 0.6));
  return mergeAll(parts, ['position', 'normal', 'color', 'mr']);
}
// cabin: tub (floor, door cards, rear bulkhead), dashboard with a cowl, console, seats. → { main, door } (door = the driver's door card)
function interiorGeometry(S, B, GH, ic, door) {
  const main = [], dparts = [];
  const T = (g, hex, m, r, bin = main) => bin.push(tint(g, hex, m, r));
  const rb = (w, h, d, r, x, y, z, rx = 0) => { const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.2, h / 2.2, d / 2.2)); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
  const G = S.gh, yb = S.floor, two = S.seats === 2;
  const z1 = Math.min(GH.z0A + 0.12, S.wb / 2 - S.Ra + 0.25), zRearSeat = S.seat - (S.doors === 2 ? 0.8 : 0.95);
  const z0 = two ? S.seat - 0.55 : Math.max(G.zC + (S.dlo.open ? 0.02 : 0.25), zRearSeat - 0.42);
  const belt = z => B.sh(clamp(z, G.zC, G.zA));
  const sideX = (z, y) => Math.min(B.sideX(clamp(z, B.z0R + 0.2, B.z0F - 0.2), clamp(y, S.clr + 0.12, belt(z) - 0.02)) - 0.05, B.deckHalf(z) - G.ledge - 0.006);
  // door cards: a wall 5 cm inside the outer skin, floor to belt, with an armrest ledge and a trim band
  const zs = lin(z0, z1, 18), fr = [0, 0.3, 0.52, 0.6, 0.74, 0.9, 1];
  for (const sg of [1, -1]) {
    const pos = [], idx = [], nv = fr.length;
    for (const z of zs) { const b = belt(z) - 0.012, y0 = Math.max(yb, Math.abs(z - S.wb / 2) < S.Ra + 0.04 || Math.abs(z + S.wb / 2) < S.Ra + 0.04 ? S.R + S.Ra * 0.8 : yb); for (const f of fr) { const y = lerp(Math.min(y0, b - 0.2), b, f); pos.push(sg * (sideX(z, y) - (f > 0.5 && f < 0.7 ? 0.035 : 0)), y, z); } }
    for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < nv - 1; j++) { const a = i * nv + j, b2 = (i + 1) * nv + j; idx.push(a, b2, b2 + 1, a, b2 + 1, a + 1); }
    const mk = (pred, hex, m, r) => {
      const sub = []; for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < nv - 1; j++) if (pred(j, (zs[i] + zs[i + 1]) / 2)) { const q = (i * (nv - 1) + j) * 6; sub.push(...idx.slice(q, q + 6)); }
      if (!sub.length) return null;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(sub); const ng = g.toNonIndexed(); g.dispose(); ng.computeVertexNormals();
      // normals must face the cabin
      const nn = ng.attributes.normal; let d = 0; for (let i = 0; i < nn.count; i++) d += -nn.getX(i) * sg; if (d < 0) { flipWinding(ng); ng.computeVertexNormals(); }
      return tint(ng, hex, m, r);
    };
    const inDoor = z => sg > 0 && door && z > door.z0 && z < door.z1;
    for (const [pred, hex, m, r] of [[j => j < 2 || j === 5, ic.leather, 0, 0.55], [j => j === 2 || j === 3, ic.dark, 0, 0.6], [j => j === 4, ic.accent, ic.accent === '#8f8f93' ? 1 : 0.1, 0.28]]) {
      const a = mk((j, z) => pred(j) && !inDoor(z), hex, m, r), d = mk((j, z) => pred(j) && inDoor(z), hex, m, r);
      if (a) main.push(a); if (d) dparts.push(d);
    }
  }
  const fw = sideX(S.seat, yb + 0.1);
  const fl = new THREE.PlaneGeometry(fw * 2 + 0.06, z1 - z0 + 0.1); fl.rotateX(-Math.PI / 2); fl.translate(0, yb, (z0 + z1) / 2); T(fl, '#1b1a19', 0, 0.95);
  // rear bulkhead + shelf (or, behind two seats, the firewall of the engine bay)
  const bh = belt(z0) - yb; const bk = new THREE.PlaneGeometry(fw * 2 + 0.04, bh); bk.translate(0, yb + bh / 2, z0); T(bk, ic.dark, 0, 0.8);
  if (!S.dlo.open) { const ps = new THREE.PlaneGeometry(fw * 2, Math.max(0.1, z0 - G.zC)); ps.rotateX(-Math.PI / 2); ps.translate(0, belt(z0) - 0.015, (z0 + G.zC) / 2 + 0.05); T(ps, ic.dark, 0, 0.85); }
  // dashboard: cowl top under the screen, a soft upper roll, a trim band, the lower dash
  const dRear = S.seat + 0.68, dh = belt(GH.z0A) - 0.035, dTopZ = G.zA - 0.05;
  { const n = 14, pos = [], idx = [];
    for (let i = 0; i <= n; i++) { const x = lerp(-fw, fw, i / n), zf = Math.min(dTopZ, GH.Ob.at(clamp(2 + (1 - Math.abs(x) / Math.max(0.3, GH.Ob.Wf)) * 0.999, 2, 3))[1] - 0.03); pos.push(x, dh, dRear + 0.02, x, dh - 0.01, Math.max(dRear + 0.1, zf)); }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); if (g.attributes.normal.getY(0) < 0) flipWinding(g); g.computeVertexNormals(); T(g, ic.dark, 0, 0.75); }
  T(rb(fw * 2 - 0.02, 0.11, 0.2, 0.05, 0, dh - 0.045, dRear + 0.085), ic.dark, 0, 0.6);
  T(rb(fw * 2 - 0.05, 0.3, 0.24, 0.06, 0, dh - 0.25, dRear + 0.14), ic.leather, 0, 0.55);
  T(rb(fw * 2 - 0.05, 0.03, 0.02, 0.008, 0, dh - 0.115, dRear + 0.0), ic.accent, ic.accent === '#8f8f93' ? 1 : 0.1, 0.25);
  for (const x of [-fw + 0.16, -0.19, 0.19, fw - 0.16]) T(rb(0.13, 0.04, 0.02, 0.008, x, dh - 0.07, dRear - 0.012), '#c8c9cb', 1, 0.2);
  // instrument binnacle
  T(rb(0.4, 0.03, 0.14, 0.012, S.driverX, dh + 0.158, dRear + 0.09), ic.dark, 0, 0.6);   // hood over the instruments
  // centre console + tunnel
  const cz0 = two ? z0 + 0.02 : S.seat - 0.4;
  T(rb(0.25, 0.25, dRear + 0.1 - cz0, 0.04, 0, S.floor + 0.125, (dRear + 0.1 + cz0) / 2), ic.dark, 0, 0.6);
  T(rb(0.22, 0.02, 0.46, 0.008, 0, S.floor + 0.256, S.seat - 0.02), ic.accent, ic.accent === '#8f8f93' ? 1 : 0.1, 0.25);
  T(rb(0.05, 0.05, 0.09, 0.02, 0, S.floor + 0.285, S.seat + 0.2), '#c8c9cb', 1, 0.22);                 // gear selector
  // pedals in the driver's footwell (two-pedal cars): a wide brake, a floor-hinged accelerator, a foot rest on the left
  { const pz = Math.min(z1 - 0.12, S.seat + 0.92), px = S.driverX;
    T(rb(0.105, 0.065, 0.014, 0.006, px + 0.01, S.floor + 0.185, pz, -0.55), '#c8c9cb', 1, 0.3); T(rb(0.02, 0.16, 0.02, 0.006, px + 0.01, S.floor + 0.27, pz + 0.05, -0.3), '#141414', 0, 0.6);
    T(rb(0.06, 0.17, 0.014, 0.006, px - 0.135, S.floor + 0.1, pz, -0.7), '#c8c9cb', 1, 0.3); T(rb(0.07, 0.2, 0.02, 0.006, px + 0.2, S.floor + 0.1, pz, -0.8), '#1c1c1c', 0, 0.7); }
  // seats: sculpted from rounded boxes — cushion with bolsters, reclined back with shoulder wings, integrated headrest
  const seat = (x, z, rear) => {
    const w = rear ? 0.5 : 0.52, cy = S.cushion - (rear ? 0.02 : 0), rec = S.H < 1.25 ? 0.42 : S.H < 1.42 ? 0.32 : 0.24;
    T(rb(w, 0.13, 0.5, 0.05, x, cy - 0.065, z + 0.07), ic.leather, 0, 0.5);
    for (const s of [-1, 1]) T(rb(0.075, 0.1, 0.48, 0.035, x + s * (w / 2 - 0.03), cy - 0.01, z + 0.07), ic.leather, 0, 0.5);
    const bh2 = clamp(S.eye - cy - 0.1, 0.42, rear ? 0.56 : 0.62), back = rb(w - 0.03, bh2, 0.12, 0.05, 0, bh2 / 2, 0, -rec); back.translate(x, cy - 0.02, z - 0.19); T(back, ic.leather, 0, 0.5);
    for (const s of [-1, 1]) { const wg = rb(0.07, bh2 * 0.7, 0.13, 0.03, s * (w / 2 - 0.045), bh2 * 0.45, 0.035, -rec); wg.translate(x, cy - 0.02, z - 0.19); T(wg, ic.leather, 0, 0.5); }
    const hr = rb(0.25, 0.19, 0.1, 0.05, 0, bh2 + 0.08, 0.0, -rec); hr.translate(x, cy - 0.02, z - 0.19); T(hr, ic.leather, 0, 0.5);
    T(rb(w - 0.17, 0.012, 0.4, 0.005, x, cy + 0.002, z + 0.08), ic.dark, 0, 0.62);
  };
  const dx = S.driverX; seat(dx, S.seat, false); seat(-dx, S.seat, false);
  if (!two && zRearSeat - 0.3 > z0) { seat(dx - 0.03, zRearSeat, true); seat(-dx + 0.03, zRearSeat, true); }
  return { main: mergeAll(main, ['position', 'normal', 'color', 'mr']), door: mergeAll(dparts, ['position', 'normal', 'color', 'mr']) };
}

// ------------------------------------------------------------------ the car, per design and tier
const TIER = [
  { ca: [16, 48, 20], wall: 13, fil: 3, deck: 8, floor: 1, rock: 2, ga: [11, 22, 13], gw: 8, gf: 3, gr: 5 },
  { ca: [6, 16, 8], wall: 5, fil: 2, deck: 3, floor: 1, rock: 1, ga: [4, 7, 5], gw: 3, gf: 1, gr: 2 },
  { ca: [3, 8, 4], wall: 3, fil: 1, deck: 2, floor: 1, rock: 1, ga: [2, 3, 3], gw: 2, gf: 1, gr: 1 },
];
const CHROME = '#e2e3e5', BLACK = '#060607', DARKCH = '#2a2c2f', PLASTIC = '#121314';
const HEAD = [1.7, 1.72, 1.76], DRL = [1.5, 1.6, 1.75], TAIL = [1.0, 0.045, 0.02], LENS = [0.3, 0.02, 0.02], AMBER = [1.0, 0.45, 0.05], REV = [1.4, 1.4, 1.45];

export function buildCar(kind, tier = 0) {
  if (!SPECS[kind]) kind = 'sedan';
  const key = SPECS[kind].kind + ':car:' + tier; if (GEO[key]) return GEO[key];
  const S = carSpec(kind), B = bodySurface(S), GH = greenhouseSurface(S, B), T = TIER[tier], G = S.gh, D = S.dlo, Fc = S.face, W2 = S.W / 2, zw = B.zw;
  const out = { paint: [], glass: [], trim: [], lights: [], dpaint: [], dglass: [], dtrim: [] };
  const thin = g => { g.computeBoundingBox(); const b = g.boundingBox, d = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].sort((p, q) => p - q); return d[1] < 0.035; };
  const TR = (g, hex, m, r, bin = out.trim) => { if (!g) return; if (tier === 2 && thin(g)) { g.dispose(); return; } bin.push(tint(g, hex, m, r)); };
  const LT = (g, rgb, lk) => { if (g) out.lights.push(glow(g, rgb, lk)); };
  // ---- the driver's door (detail tier): a region of the body side that becomes its own mesh
  const zArchF = zw[0] - S.Ra, zArchR = zw[1] + S.Ra;
  const baseA = z => { const a = GH.solveA(z); return GH.Ob.at(a); };
  const zAside = GH.z0A;                                                    // where the A-pillar meets the body side
  const doorZ1 = Math.min(zArchF - 0.1, zAside + 0.22), doorZ0 = D.zB != null ? D.zB : (D.doorRear ?? -0.7);
  const door = tier === 0 ? { z0: doorZ0, z1: doorZ1 } : null;
  const cladY = z => (Fc.clad ? B.rock(z) + 0.1 + Fc.clad : -1);
  // ---- body
  {
    const as = uniq([...lin(0, 1, T.ca[0]), ...lin(1, 2, T.ca[1]), ...lin(2, 3, T.ca[2])]);
    const hb = uniq([...lin(0, 1, T.floor), ...lin(1, 2, T.rock), ...lin(2, 3, T.wall), 2 + S.flank.crease[0], ...lin(3, 4, T.fil), ...lin(4, 5, T.deck)]);
    const bs = uniq([...hb, ...hb.map(b => 10 - b)]);
    const label = (a, b) => {
      const bb = b > 5 ? 10 - b : b, p = B.half(a, bb), x = p[0], y = p[1], z = p[2];
      for (let k = 0; k < 2; k++) {
        const dz = z - zw[k];
        if (bb < 3.02 && Math.abs(dz) < S.Ra) {
          if (bb >= 1 ? Math.hypot(dz, y - S.R) < S.Ra : x > S.wheelX - S.tw / 2 - 0.06) return null;                 // wheel arch / the floor over the wheel
        }
      }
      if (bb < 1.6) return 'under';
      if (bb >= 4) { if (GH.under(x, z, 0.012)) return GH.under(x, z, 0.05) ? null : 'ledge'; return 'paint'; }
      if (bb >= 2 && y < cladY(z) && bb < 3) return 'clad';
      if (Fc.clad && bb >= 2 && bb < 3) for (let k = 0; k < 2; k++) if (Math.hypot(z - zw[k], y - S.R) < S.Ra + Fc.clad) return 'clad';
      if (door && b < 5 && bb >= 2 && bb < 3.55 && z > door.z0 && z < door.z1) return 'door';
      return 'paint';
    };
    const r = msSurface(as, bs, label, B.P);
    if (r.paint) out.paint.push(r.paint);
    if (r.door) out.dpaint.push(r.door);
    TR(r.under, '#0a0a0b', 0, 0.8); TR(r.ledge, BLACK, 0, 0.3); TR(r.clad, PLASTIC, 0, 0.62);
  }
  // ---- greenhouse
  let aPil = 2.5; { let lo = 2, hi = 3; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (GH.Ob.at(m)[3] < 0.55) lo = m; else hi = m; } aPil = (lo + hi) / 2; }
  const wPil = (D.pillar ?? (Fc.flatGlass ? 0.05 : 0.058)) / GH.Ob.len[2];
  const ghLabel = (a, b) => {
    const m = b > 3, bb = m ? 6 - b : b, c = GH.col(a), p = GH.half(a, bb), z = p[2];
    const open = !!D.open, fr = D.frame / c.len;
    if (bb >= 2) {                                                          // roof
      if (open) return null;
      if (D.pano) { const x = p[0], e = D.pano === 'full' ? 0.07 : 0.11; if (x < c.D.x - e + 0.001 && x < G.roofW - e && z < G.zT1 - 0.16 && z > (D.pano === 'full' ? G.zT2 + 0.12 : Math.max(G.zT2 + 0.2, G.zT1 - 1.35))) return 'pano'; }
      return 'paint';
    }
    if (bb >= 1) return open && a < 2.02 ? null : 'paint';                  // roof rail / screen header
    const s = bb * c.s1;
    if (a >= 2) {                                                           // front cap: screen, A-pillar, start of the side glass
      if (a > aPil + wPil) return s < 0.05 || s > 1 - fr * 0.9 ? 'black' : 'glass';   // the pillar: a band of fixed width where the outline turns from the side to the screen
      if (a > aPil - wPil) return Fc.blackPillars ? 'black' : 'paint';
      if (open) return null;
      return s > 1 - fr ? 'paint' : (door && !m && z > door.z0 && z < door.z1 ? 'dglass' : 'glass');
    }
    if (open) return null;
    if (a >= 1) {                                                           // side
      if (s > 1 - fr) return 'paint';
      const zq = lerp(D.q[0], D.q[1], s);
      if (z < zq) {                                                         // behind the rear edge of the door glass
        if (D.quarter && z > D.q[0] - 5) { const z2 = D.zC2; if (z < z2 - 0.05 && z > G.zC + 0.3 + 0.14 * s) return s < 0.06 ? 'paint' : 'glass'; if (z >= z2 - 0.05 && z < z2 + 0.05) return 'black'; if (z >= z2 + 0.05) return 'glass'; }
        return 'paint';
      }
      if (D.zB != null && Math.abs(z - D.zB) < 0.045) return 'black';
      if (D.zC2 != null && !D.quarter && Math.abs(z - D.zC2) < 0.04) return 'black';
      return door && !m && z > door.z0 && z < door.z1 ? 'dglass' : 'glass';
    }
    // rear cap: C-pillar round to the rear screen
    const nzr = -c.b[3], pC = D.pC || [0.3, 0.72];
    if (nzr > pC[1]) return s < 0.06 || s > 1 - fr ? 'black' : 'glass';
    if (D.quarter && nzr < pC[0] * 0.5 && s < 1 - fr && s > 0.06) return 'glass';
    return 'paint';
  };
  {
    const as = uniq([...lin(0, 1, T.ga[0]), ...lin(1, 2, T.ga[1]), ...lin(2, 3, T.ga[2])]);
    const hb = uniq([...lin(0, 1, T.gw), ...lin(1, 2, T.gf), ...lin(2, 3, T.gr)]), bs = uniq([...hb, ...hb.map(b => 6 - b)]);
    const r = msSurface(as, bs, ghLabel, GH.P);
    if (r.paint) out.paint.push(r.paint);
    if (r.glass) out.glass.push(r.glass);
    if (r.dglass) out.dglass.push(r.dglass);
    TR(r.black, BLACK, 0.1, 0.08); TR(r.pano, '#050607', 0.3, 0.04);
    if (tier === 0 && !D.open) for (const k of ['paint']) if (r[k]) {       // headliner: the roof again, 2 cm inside, facing in
      const h = r[k].clone(), p = h.attributes.position, n = h.attributes.normal;
      for (let i = 0; i < p.count; i++) { p.setXYZ(i, p.getX(i) - n.getX(i) * 0.02, p.getY(i) - n.getY(i) * 0.02, p.getZ(i) - n.getZ(i) * 0.02); n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); }
      flipWinding(h); out.headliner = tint(h, '#2f2d2b', 0, 0.95);   // anthracite roof lining and pillar trims (a pale pillar glares in the driver's eye)
    }
  }
  // ---- charts for the details
  const mir = p => [-p[0], p[1], p[2], -p[3], p[4], p[5]];
  const front = (d, y) => { const [a, b] = B.frontAB(Math.abs(d), y), p = B.P(a, b); return d < 0 ? mir(p) : p; };
  const rear = (d, y) => { const [a, b] = B.rearAB(Math.abs(d), y), p = B.P(a, b); return d < 0 ? mir(p) : p; };
  const side = sg => (z, y) => { const [a, b] = B.sideAB(z, y), p = B.P(a, b); return sg < 0 ? mir(p) : p; };
  const deck = (x, z) => { const [a, b] = B.deckAB(Math.abs(x), z), p = B.P(a, b); return x < 0 ? mir(p) : p; };
  const fine = tier === 0, mid = tier === 1, st = fine ? 1 : mid ? 3 : 7;
  const Lf = B.O.len[2], Lr = B.O.len[0];
  // heights of the faces
  const cF = B.col(3), cR = B.col(0), yNose = cF.yT, yChin = cF.yB, yTail = cR.yT, yVal = cR.yB;
  const both = (fn) => { fn(1); fn(-1); };
  // ================= front =================
  {
    const hy = yNose - (Fc.head === 'round' ? 0.2 : Fc.head === 'blade' ? 0.05 : Fc.head === 'stack' ? 0.16 : 0.115), halfF = Lf * 0.98;
    // grille
    let gw = 0, gy0 = 0, gy1 = 0;
    if (Fc.grille === 'tall') { gw = 0.36; gy1 = yNose - 0.085; gy0 = gy1 - 0.3; }
    else if (Fc.grille === 'wide') { gw = 0.5; gy1 = yNose - 0.1; gy0 = gy1 - 0.33; }
    else if (Fc.grille === 'mesh') { gw = 0.4; gy1 = yNose - 0.13; gy0 = yChin + 0.11; }
    else if (Fc.grille === 'hex') { gw = 0.47; gy1 = yNose - 0.12; gy0 = yChin + 0.2; }
    else if (Fc.grille === 'oval') { gw = 0.4; gy1 = yNose - 0.14; gy0 = yChin + 0.13; }
    else if (Fc.grille === 'bars') { gw = 0.43; gy1 = yNose - 0.1; gy0 = gy1 - 0.33; }
    if (gw) {
      const r = Fc.grille === 'oval' || Fc.grille === 'mesh' ? 0.12 : Fc.grille === 'hex' ? 0.07 : 0.03;
      const shape = Fc.grille === 'hex' ? polyIn([[-gw, gy1], [gw, gy1], [gw * 0.9, (gy0 + gy1) / 2], [gw * 0.62, gy0], [-gw * 0.62, gy0], [-gw * 0.9, (gy0 + gy1) / 2]]) : Fc.grille === 'oval' ? ellIn(0, (gy0 + gy1) / 2, gw, (gy1 - gy0) / 2) : rrIn(-gw, gw, gy0, gy1, r);
      TR(decalFill(front, shape, -gw, gw, gy0, gy1, 0.022 * st, 0.0025), '#070708', 0.5, 0.42);
      if (Fc.chrome || Fc.grille === 'bars') {
        const pts = Fc.grille === 'oval' ? ellPts(0, (gy0 + gy1) / 2, gw, (gy1 - gy0) / 2, 40) : rrPts(-gw, gw, gy0, gy1, r, 6);
        if (Fc.grille !== 'hex') TR(decalLine(front, pts, 0.02, 0.006, true, 0.03 * st), Fc.grille === 'bars' ? '#3a3c40' : CHROME, 1, Fc.grille === 'bars' ? 0.35 : 0.1);
      }
      if (fine) {
        if (Fc.grille === 'tall') for (let x = -gw + 0.04; x < gw - 0.02; x += 0.04) TR(decalLine(front, [[x, gy0 + 0.012], [x, gy1 - 0.012]], 0.011, 0.005), CHROME, 1, 0.12);
        else if (Fc.grille === 'wide') for (let y = gy0 + 0.05; y < gy1 - 0.03; y += 0.055) TR(decalLine(front, [[-gw + 0.02, y], [gw - 0.02, y]], 0.016, 0.005), '#c6c7c9', 1, 0.14);
        else if (Fc.grille === 'bars') for (let k = -3; k <= 3; k++) TR(decalLine(front, [[k * 0.1, gy0 + 0.02], [k * 0.1, gy1 - 0.02]], 0.03, 0.005), '#1d1e20', 0.4, 0.4);
        else { const cy = (gy0 + gy1) / 2; for (let y = gy0 + 0.035; y < gy1 - 0.02; y += 0.045) { const hwy = Fc.grille === 'oval' ? gw * Math.sqrt(Math.max(0, 1 - ((y - cy) / ((gy1 - gy0) / 2)) ** 2)) - 0.03 : Fc.grille === 'hex' ? gw * 0.72 : gw - 0.05; if (hwy > 0.05) TR(decalLine(front, [[-hwy, y], [hwy, y]], 0.008, 0.005), '#3b3d41', 1, 0.3); } }
      }
    }
    // lower intakes
    const ly0 = yChin + 0.035, ly1 = yChin + (Fc.lower === 'thin' ? 0.1 : Fc.lower === 'split' ? 0.2 : 0.16);
    if (Fc.lower === 'slots' || Fc.lower === 'wide' || Fc.lower === 'thin') {
      const cw = Fc.lower === 'slots' ? 0.3 : Fc.lower === 'thin' ? 0.62 : gw ? 0 : 0.55;
      if (cw && !(gw && gy0 < ly1 + 0.03)) TR(decalFill(front, rrIn(-cw, cw, ly0, ly1, 0.03), -cw, cw, ly0, ly1, 0.03 * st, 0.0025), '#070708', 0.4, 0.45);
      if (Fc.lower !== 'thin') both(sg => { const u0 = Math.max(cw, gw) + 0.09, u1 = Math.min(halfF - 0.1, u0 + 0.36); const P4 = [[u0, ly0], [u1, ly0 + 0.02], [u1 - 0.02, ly1 + 0.05], [u0, ly1 + 0.01]].map(([u, v]) => [sg * u, v]); TR(decalFill(front, polyIn(P4), Math.min(sg * u0, sg * u1), Math.max(sg * u0, sg * u1), ly0, ly1 + 0.05, 0.025 * st, 0.0025), '#070708', 0.4, 0.45); });
    } else if (Fc.lower === 'split') {
      both(sg => { const P4 = [[0.12, ly0], [0.74, ly0 + 0.015], [0.8, ly1 + 0.03], [0.12, ly1 - 0.02]].map(([u, v]) => [sg * u, v]); TR(decalFill(front, polyIn(P4), sg > 0 ? 0.12 : -0.8, sg > 0 ? 0.8 : -0.12, ly0, ly1 + 0.03, 0.025 * st, 0.0025), '#070708', 0.4, 0.45); });
      TR(decalLine(front, [[-0.86, yChin + 0.012], [0.86, yChin + 0.012]], 0.03, 0.01), '#0c0c0d', 0.3, 0.4);     // splitter lip
    } else if (Fc.lower === 'skid') {
      TR(decalFill(front, rrIn(-0.55, 0.55, ly0 - 0.02, ly0 + 0.1, 0.03), -0.55, 0.55, ly0 - 0.02, ly0 + 0.1, 0.03 * st, 0.0025), '#070708', 0.4, 0.45);
      TR(decalLine(front, [[-0.42, ly0 - 0.005], [0.42, ly0 - 0.005]], 0.04, 0.006), '#b9bbbe', 1, 0.3);
      both(sg => TR(decalFill(front, rrIn(Math.min(sg * 0.66, sg * 0.92), Math.max(sg * 0.66, sg * 0.92), ly0 + 0.02, ly0 + 0.15, 0.03), Math.min(sg * 0.66, sg * 0.92), Math.max(sg * 0.66, sg * 0.92), ly0 + 0.02, ly0 + 0.15, 0.025 * st, 0.0025), '#070708', 0.4, 0.45));
    }
    // headlights
    both(sg => {
      const F = (u, v) => front(sg * u, v);
      if (Fc.head === 'matrix') {       // wide rectangular unit, an L-shaped running light, three projector lenses
        const u0 = gw + 0.06, u1 = u0 + 0.4, v0 = hy - 0.045, v1 = hy + 0.05;
        const sh = (u, v) => { const t = (u - u0) / (u1 - u0); return t >= 0 && t <= 1 && v >= v0 + 0.02 * t && v <= v1 + 0.025 * t && rrIn(u0, u1, v0 - 0.02, v1 + 0.04, 0.025)(u, v); };
        TR(decalFill(F, sh, u0, u1, v0, v1 + 0.03, 0.013 * st, 0.0025), '#0b0c0e', 0.9, 0.08);
        LT(decalLine(F, [[u0 + 0.018, v0 + 0.02], [u0 + 0.018, v1 - 0.012], [u1 - 0.02, v1 + 0.008]], 0.011, 0.005), DRL, 2);
        if (!mid || true) for (let k = 0; k < 3; k++) { const cu = u0 + 0.1 + k * 0.105, cv = hy - 0.006 + 0.016 * k / 2; LT(decalFill(F, ellIn(cu, cv, 0.026, 0.022), cu - 0.026, cu + 0.026, cv - 0.022, cv + 0.022, 0.011 * st, 0.004), HEAD, 0); }
      } else if (Fc.head === 'twin') {  // two round lamps under an oval cover
        const cu = gw + 0.27, ru = 0.2, rv = 0.085;
        TR(decalFill(F, ellIn(cu, hy, ru, rv), cu - ru, cu + ru, hy - rv, hy + rv, 0.014 * st, 0.0025), '#0b0c0e', 0.9, 0.08);
        for (const [du, r] of [[-0.085, 0.058], [0.075, 0.046]]) { LT(decalLine(F, ellPts(cu + du, hy, r, r, 22), 0.009, 0.005, true, 0.02 * st), DRL, 2); LT(decalFill(F, ellIn(cu + du, hy, r * 0.5, r * 0.5), cu + du - r * 0.5, cu + du + r * 0.5, hy - r * 0.5, hy + r * 0.5, 0.012 * st, 0.004), HEAD, 0); }
      } else if (Fc.head === 'blade') { // a thin blade rising along the wing
        const u0 = 0.36, u1 = Math.min(halfF + 0.22, 1.0), sh = (u, v) => { const t = (u - u0) / (u1 - u0); return t >= 0 && t <= 1 && v >= hy - 0.06 + 0.1 * t && v <= hy - 0.02 + 0.12 * t + 0.02 * Math.sin(t * Math.PI); };
        TR(decalFill(F, sh, u0, u1, hy - 0.07, hy + 0.14, 0.012 * st, 0.0025), '#0b0c0e', 0.9, 0.08);
        LT(decalLine(F, [[u0 + 0.03, hy - 0.035], [(u0 + u1) / 2, hy + 0.025], [u1 - 0.03, hy + 0.075]], 0.012, 0.005), DRL, 2);
        for (let k = 0; k < 2; k++) { const t = 0.3 + k * 0.3, cu = lerp(u0, u1, t), cv = hy - 0.04 + 0.11 * t; LT(decalFill(F, ellIn(cu, cv, 0.022, 0.012), cu - 0.022, cu + 0.022, cv - 0.012, cv + 0.012, 0.008 * st, 0.004), HEAD, 0); }
      } else if (Fc.head === 'stack') { // tall unit: slim running light on top, twin lenses below
        const u0 = gw + 0.05, u1 = Math.min(halfF + 0.06, u0 + 0.36), v0 = hy - 0.07, v1 = hy + 0.1;
        TR(decalFill(F, rrIn(u0, u1, v0, v1, 0.03), u0, u1, v0, v1, 0.014 * st, 0.0025), '#0b0c0e', 0.9, 0.08);
        LT(decalLine(F, [[u0 + 0.02, v1 - 0.022], [u1 - 0.02, v1 - 0.022]], 0.014, 0.005), DRL, 2);
        LT(decalLine(F, [[u0 + 0.02, v1 - 0.022], [u0 + 0.02, v0 + 0.02]], 0.01, 0.005), DRL, 2);
        for (let k = 0; k < 2; k++) { const cu = u0 + 0.12 + k * 0.12, cv = hy - 0.005; LT(decalFill(F, ellIn(cu, cv, 0.036, 0.036), cu - 0.036, cu + 0.036, cv - 0.036, cv + 0.036, 0.014 * st, 0.004), HEAD, 0); }
      } else if (Fc.head === 'round') { // classic round lamp with a light ring + a small indicator beside it
        const cu = gw + 0.17, r = 0.1;
        TR(decalFill(F, ellIn(cu, hy, r, r), cu - r, cu + r, hy - r, hy + r, 0.014 * st, 0.004), '#0b0c0e', 0.9, 0.08);
        TR(decalLine(F, ellPts(cu, hy, r, r, 24), 0.014, 0.006, true, 0.02 * st), '#9a9c9f', 1, 0.25);
        LT(decalLine(F, ellPts(cu, hy, r - 0.022, r - 0.022, 22), 0.009, 0.007, true, 0.02 * st), DRL, 2);
        LT(decalFill(F, ellIn(cu, hy, 0.045, 0.045), cu - 0.045, cu + 0.045, hy - 0.045, hy + 0.045, 0.014 * st, 0.006), HEAD, 0);
        LT(decalFill(F, rrIn(cu + 0.14, cu + 0.23, hy + 0.03, hy + 0.07, 0.012), cu + 0.14, cu + 0.23, hy + 0.03, hy + 0.07, 0.014 * st, 0.004), AMBER.map(v => v * 0.5), 2);
      } else {                          // 'slim' and 'bar': a thin horizontal unit; 'bar' joins both sides across the nose
        const u0 = Fc.head === 'bar' ? 0.02 : gw + 0.07, u1 = Math.min(halfF + 0.18, (Fc.head === 'bar' ? 0.5 : gw + 0.07) + 0.44), th = Fc.head === 'bar' ? 0.03 : 0.036;
        const sh = (u, v) => { const t = (u - u0) / (u1 - u0); return t >= 0 && t <= 1 && Math.abs(v - (hy + 0.03 * t * t)) <= th * (Fc.head === 'bar' ? 0.55 + 0.6 * sstep(0.45, 0.8, t) : 1); };
        TR(decalFill(F, sh, u0, u1, hy - 0.06, hy + 0.09, 0.011 * st, 0.0025), '#0b0c0e', 0.9, 0.08);
        LT(decalLine(F, [[u0 + (Fc.head === 'bar' ? 0 : 0.02), hy + (Fc.head === 'bar' ? 0 : 0.018)], [(u0 + u1) / 2, hy + 0.0075 + (Fc.head === 'bar' ? 0 : 0.018)], [u1 - 0.025, hy + 0.03 + (Fc.head === 'bar' ? 0 : 0.016)]], Fc.head === 'bar' ? 0.01 : 0.009, 0.005), DRL, 2);
        for (let k = 0; k < 3; k++) { const t = 0.62 + k * 0.12, cu = lerp(u0, u1, t), cv = hy + 0.03 * t * t - (Fc.head === 'bar' ? 0.008 : 0.01); LT(decalFill(F, ellIn(cu, cv, 0.018, 0.012), cu - 0.018, cu + 0.018, cv - 0.012, cv + 0.012, 0.008 * st, 0.004), HEAD, 0); }
      }
    });
  }
  // ================= rear =================
  {
    const ty = yTail - (Fc.tail === 'vert' || Fc.tail === 'box' ? 0.2 : 0.095), halfR = Lr * 0.98;
    if (Fc.tail === 'bar') {            // full-width light bar
      const bx = halfR + 0.16, th = 0.03;
      LT(decalFill(rear, rrIn(-bx, bx, ty - th, ty + th, th), -bx, bx, ty - th, ty + th, 0.014 * st, 0.0025), LENS, 1);
      LT(decalLine(rear, [[-bx + 0.03, ty], [0, ty], [bx - 0.03, ty]], 0.012, 0.005), TAIL, 1);
      both(sg => LT(decalLine(rear, [[sg * (bx - 0.22), ty - 0.013], [sg * (bx - 0.04), ty - 0.013]], 0.008, 0.005), AMBER.map(v => v * 0.25), 4));
    } else if (Fc.tail === 'oval') {
      both(sg => { const cu = sg * (halfR - 0.12), ru = 0.22, rv = 0.055; LT(decalFill(rear, ellIn(cu, ty, ru, rv), cu - ru, cu + ru, ty - rv, ty + rv, 0.014 * st, 0.0025), LENS, 1); LT(decalLine(rear, ellPts(cu, ty, ru - 0.02, rv - 0.016, 30), 0.011, 0.005, true, 0.025 * st), TAIL, 1); });
    } else if (Fc.tail === 'vert') {    // tall units up the corners
      both(sg => { const u0 = halfR - 0.02, u1 = halfR + 0.2, a0 = Math.min(sg * u0, sg * u1), a1 = Math.max(sg * u0, sg * u1); LT(decalFill(rear, rrIn(a0, a1, ty - 0.2, ty + 0.16, 0.035), a0, a1, ty - 0.2, ty + 0.16, 0.02 * st, 0.0025), LENS, 1);
        LT(decalLine(rear, [[sg * (u0 + 0.035), ty - 0.17], [sg * (u0 + 0.035), ty + 0.13], [sg * (u1 - 0.03), ty + 0.13]], 0.014, 0.005), TAIL, 1); LT(decalLine(rear, [[sg * (u1 - 0.05), ty - 0.16], [sg * (u1 - 0.05), ty + 0.05]], 0.012, 0.005), TAIL, 1); });
    } else if (Fc.tail === 'box') {     // small square lamps low on the corners
      both(sg => { const u0 = halfR - 0.06, u1 = halfR + 0.1, a0 = Math.min(sg * u0, sg * u1), a1 = Math.max(sg * u0, sg * u1); LT(decalFill(rear, rrIn(a0, a1, ty - 0.13, ty + 0.09, 0.02), a0, a1, ty - 0.13, ty + 0.09, 0.02 * st, 0.004), LENS, 1);
        LT(decalFill(rear, rrIn(a0 + 0.02, a1 - 0.02, ty - 0.02, ty + 0.07, 0.012), a0, a1, ty - 0.02, ty + 0.07, 0.02 * st, 0.006), TAIL, 1); LT(decalFill(rear, rrIn(a0 + 0.02, a1 - 0.02, ty - 0.11, ty - 0.04, 0.012), a0, a1, ty - 0.11, ty - 0.04, 0.02 * st, 0.006), AMBER.map(v => v * 0.3), 4); });
    } else {                            // 'wrap': slim units wrapping round the corners, a chrome strip between them
      both(sg => { const u0 = halfR - 0.42, u1 = halfR + 0.24, sh = (u, v) => { const t = (sg * u - u0) / (u1 - u0); return t >= 0 && t <= 1 && v >= ty - 0.04 + 0.02 * t && v <= ty + 0.04 - 0.012 * t; };
        LT(decalFill(rear, sh, Math.min(sg * u0, sg * u1), Math.max(sg * u0, sg * u1), ty - 0.05, ty + 0.05, 0.012 * st, 0.0025), LENS, 1);
        LT(decalLine(rear, [[sg * (u0 + 0.025), ty + 0.018], [sg * (u1 - 0.03), ty + 0.012]], 0.009, 0.005), TAIL, 1); LT(decalLine(rear, [[sg * (u0 + 0.025), ty - 0.015], [sg * (u1 - 0.06), ty - 0.004]], 0.009, 0.005), TAIL, 1); });
      if (Fc.chrome) TR(decalLine(rear, [[-(halfR - 0.45), ty], [halfR - 0.45, ty]], 0.014, 0.005), CHROME, 1, 0.1);
    }
    // reversing lights + rear fog strip, diffuser, exhausts
    both(sg => LT(decalFill(rear, rrIn(Math.min(sg * 0.3, sg * 0.42), Math.max(sg * 0.3, sg * 0.42), yVal + 0.2, yVal + 0.225, 0.008), Math.min(sg * 0.3, sg * 0.42), Math.max(sg * 0.3, sg * 0.42), yVal + 0.2, yVal + 0.225, 0.012 * st, 0.004), REV, 3));
    const dy = yVal + 0.03, dw = halfR - 0.08;
    if (Fc.tail !== 'box') TR(decalFill(rear, rrIn(-dw, dw, dy, dy + 0.15, 0.04), -dw, dw, dy, dy + 0.15, 0.03 * st, 0.0025), '#0a0a0b', 0.3, 0.5);
    if (Fc.exh && !Fc.sidepipe) {
      const xs = Fc.exh === 4 ? [0.43, 0.57] : [0.5];
      both(sg => { for (const x of xs) { const p = rear(sg * x, dy + 0.075); const g = new THREE.CylinderGeometry(0.042, 0.045, 0.1, fine ? 20 : 8, 1, true); g.rotateX(Math.PI / 2); g.scale(Fc.exh === 4 ? 1 : 1.5, 0.8, 1); g.translate(p[0], p[1], p[2] + 0.02); TR(g, CHROME, 1, 0.12);
        const d = new THREE.CircleGeometry(0.04, fine ? 14 : 8); d.scale(Fc.exh === 4 ? 1 : 1.5, 0.8, 1); d.rotateY(Math.PI); d.translate(p[0], p[1], p[2] + 0.045); TR(d, '#040404', 0, 0.9); } });
    }
    if (Fc.scoop && fine) { const y1 = ty - 0.06, y0 = dy + 0.18, bx = halfR - 0.2; TR(decalFill(rear, rrIn(-bx, bx, y0, y1, 0.05), -bx, bx, y0, y1, 0.03, 0.003), '#060607', 0.4, 0.5); for (let y = y0 + 0.03; y < y1 - 0.02; y += 0.036) TR(decalLine(rear, [[-bx + 0.04, y], [bx - 0.04, y]], 0.007, 0.006), '#2a2b2e', 0.8, 0.35); }
    if (Fc.spare) {                     // spare wheel in a hard cover on the tail door
      const p = rear(0, 0.98), cz = p[2] - 0.12;
      const cov = new THREE.CylinderGeometry(S.R + 0.01, S.R + 0.01, 0.22, fine ? 32 : 12); cov.rotateX(Math.PI / 2); cov.translate(0, 1.0, cz); out.paint.push(strip(cov.toNonIndexed(), ['position', 'normal']));
      const ring = new THREE.TorusGeometry(S.R + 0.012, 0.012, 6, fine ? 32 : 12); ring.translate(0, 1.0, cz - 0.1); TR(ring, '#b9bbbe', 1, 0.25);
    }
  }
  // ================= sides =================
  both(sg => {
    const Sd = side(sg), isDoorSide = sg > 0 && door;
    const bin = (z) => (isDoorSide && z > door.z0 && z < door.z1 ? out.dtrim : out.trim);
    const beltY = z => B.sh(z);
    // sill strip / rocker blade
    const zf = zArchF - 0.03, zr = zArchR + 0.03;
    if (fine || mid) {
      if (Fc.steps) { const g = new RoundedBoxGeometry(0.16, 0.035, zf - zr - 0.1, 2, 0.012); g.translate(sg * (W2 * 0.93 + 0.06), S.clr + 0.05, (zf + zr) / 2); TR(g, '#18191b', 0.3, 0.5); }
      else if (!Fc.clad) TR(decalLine(Sd, [[zr + 0.02, B.rock(0) + 0.075], [zf - 0.02, B.rock(0) + 0.075]], Fc.chrome ? 0.014 : 0.03, 0.004), Fc.chrome ? CHROME : '#0c0c0d', Fc.chrome ? 1 : 0.2, Fc.chrome ? 0.12 : 0.45);
    }
    if (Fc.arches) {                    // bolt-on arch extensions
      for (const z0 of zw) { const n = fine ? 22 : 9, pos = [], idx = []; for (let i = 0; i <= n; i++) { const a = -0.12 + (Math.PI + 0.24) * i / n, c = Math.cos(a), s = Math.sin(a), x0 = W2 * 0.93 - 0.01; for (const [r, x] of [[S.Ra - 0.005, x0], [S.Ra + 0.03, x0 + 0.075], [S.Ra + 0.075, x0 + 0.075], [S.Ra + 0.09, x0]]) pos.push(sg * x, S.R + s * r, z0 + c * r); }
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 4; idx.push(a, b, b + 1, a, b + 1, a + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); const ng = g.toNonIndexed(); g.dispose(); ng.computeVertexNormals();
        const nn = ng.attributes.normal; let d = 0; for (let i = 0; i < nn.count; i++) d += nn.getX(i) * sg; if (d < 0) { flipWinding(ng); ng.computeVertexNormals(); } TR(ng, PLASTIC, 0, 0.6); }
    }
    if (!fine) return;
    // shut lines
    const shut = (z, y0, y1, lean = 0.02, target = null) => { const pts = []; for (let y = y0; y <= y1 + 1e-6; y += 0.04) pts.push([z + (y - 0.5) * lean, y]); TR(decalLine(Sd, pts, 0.006, 0.0018), '#050505', 0, 0.9, target || out.trim); };
    const yb0 = z => B.rock(z) + 0.07, yb1 = z => beltY(z) - 0.012;
    if (!isDoorSide) { shut(doorZ1, yb0(doorZ1), yb1(doorZ1)); shut(doorZ0, yb0(doorZ0), yb1(doorZ0)); }
    if (S.doors === 4) { const zRearDoor = Math.max(zArchR + 0.02, D.q[0] + 0.1); const pts = []; for (let y = yb1(zRearDoor); y >= S.R + 0.2; y -= 0.04) pts.push([zRearDoor - 0.02, y]); for (let a = 0.5; a <= 1.5; a += 0.12) pts.push([zw[1] + Math.cos(a) * (S.Ra + 0.035), S.R + Math.sin(a) * (S.Ra + 0.035)]); const cut = pts.filter(p => p[0] > zw[1] + 0.02 || p[1] > S.R + S.Ra); TR(decalLine(Sd, cut.slice(0, Math.max(2, cut.findIndex(p => p[0] < zRearDoor - 0.6) > 0 ? cut.findIndex(p => p[0] < zRearDoor - 0.6) : cut.length)), 0.006, 0.0018), '#050505', 0, 0.9); }
    // door handles (flush bars)
    const hy = z => beltY(z) - 0.115;
    const handle = z => { const b = bin(z); if (Fc.flush) TR(decalFill(Sd, rrIn(z - 0.1, z + 0.1, hy(z) - 0.014, hy(z) + 0.014, 0.012), z - 0.1, z + 0.1, hy(z) - 0.014, hy(z) + 0.014, 0.012, 0.0022), '#0a0a0b', 0.6, 0.2, b); else { const p = Sd(z, hy(z)); const g = new RoundedBoxGeometry(0.03, 0.026, 0.19, 2, 0.011); g.translate(p[0] + sg * 0.012, p[1], p[2]); TR(g, Fc.chrome ? CHROME : '#141516', Fc.chrome ? 1 : 0.5, Fc.chrome ? 0.12 : 0.3, b); } };
    handle(doorZ0 + 0.16); if (S.doors === 4) handle(Math.max(zArchR + 0.3, D.q[0] + 0.32));
    // fuel / charge flap on the right rear wing
    if (sg < 0) { const fz = zw[1] + 0.05, fy = S.R + S.Ra + 0.14; if (fy + 0.09 < beltY(fz)) TR(decalLine(Sd, rrPts(fz - 0.08, fz + 0.08, fy - 0.07, fy + 0.07, 0.03, 4), 0.005, 0.0018, true), '#060606', 0, 0.9); }
    // side intake (mid-engined) / front wing vent
    if (Fc.scoop) { const za = zArchR + 0.06, zb = za + 0.62, y0 = B.rock(za) + 0.2, y1 = beltY(za) - 0.1; const sh = (z, y) => { const t = (z - za) / (zb - za); return t >= 0 && t <= 1 && y >= y0 + 0.2 * t * t && y <= y1 - 0.1 * t; }; TR(decalFill(Sd, sh, za, zb, y0, y1, 0.02, 0.0025), '#060607', 0.2, 0.55); }
    else if (S.doors === 2 || Fc.grille === 'tall') { const vz = zArchF - 0.12 - 0.02, vy = S.R + 0.12; TR(decalFill(Sd, rrIn(vz - 0.2, vz, vy, vy + 0.045, 0.02), vz - 0.2, vz, vy, vy + 0.045, 0.015, 0.0025), Fc.chrome ? CHROME : '#0a0a0b', Fc.chrome ? 1 : 0.4, 0.15, bin(vz - 0.1)); }
    if (Fc.sidepipe) { const g = new THREE.CylinderGeometry(0.035, 0.035, 0.5, 14); g.rotateX(Math.PI / 2); g.translate(sg * (W2 * 0.93 - 0.02), S.clr + 0.0, zArchR + 0.38); TR(g, '#b9bbbe', 1, 0.2); }
    // mirror: sculpted cap on a blade stalk, mirror glass, indicator strip
    {
      const mz = zAside + 0.06, mb = bin(mz), pb = isDoorSide && mz > door.z0 && mz < door.z1 ? out.dpaint : out.paint;
      const my = beltY(mz) + (S.H > 1.6 ? 0.13 : 0.09), mx = B.deckHalf(mz) - 0.02;
      const cap = new THREE.SphereGeometry(1, 18, 12); cap.scale(0.118, 0.07, 0.085); const cp = cap.attributes.position;
      for (let i = 0; i < cp.count; i++) { if (cp.getZ(i) < -0.015) cp.setZ(i, -0.015 + (cp.getZ(i) + 0.015) * 0.2); if (cp.getY(i) < -0.035) cp.setY(i, -0.035 + (cp.getY(i) + 0.035) * 0.4); }   // flat towards the glass, flat underside
      cap.computeVertexNormals(); cap.rotateY(sg * 0.2); cap.translate(sg * (mx + 0.15), my + 0.035, mz); pb.push(strip(cap.toNonIndexed(), ['position', 'normal']));
      const arm = new RoundedBoxGeometry(0.16, 0.035, 0.085, 2, 0.014); arm.rotateZ(sg * 0.3); arm.translate(sg * (mx + 0.045), my - 0.012, mz + 0.012); TR(arm, BLACK, 0.2, 0.25, mb);
      const mg = new THREE.CircleGeometry(1, 16); mg.scale(0.1, 0.056, 1); mg.rotateY(Math.PI + sg * 0.2); mg.translate(sg * (mx + 0.15), my + 0.037, mz - 0.019); TR(mg, '#9aa1a8', 1, 0.04, mb);
      if (sg > 0) out.mirrorPos = [mx + 0.15, my + 0.037, mz - 0.019];
      const ind = new THREE.BoxGeometry(0.09, 0.006, 0.012); ind.rotateY(sg * 0.2); ind.translate(sg * (mx + 0.19), my + 0.02, mz + 0.078); out.lights.push(glow(ind, AMBER.map(v => v * 0.3), 4));
    }
  });
  // ================= deck & roof details =================
  if (fine) {
    // bonnet shut line (U shape) and power-dome creases are part of the surface; here: the bonnet's edge lines
    const zb0 = Math.min(G.zA - G.bowA - 0.02, GH.z0A + 0.1), zNose = B.z0F + S.plan.capF * 0.55;
    both(sg => { const pts = []; for (let z = zb0; z <= zNose; z += 0.08) pts.push([sg * (B.deckHalf(z) - 0.035 - 0.02 * sstep(zb0, zNose, z)), z]); if (pts.length > 2) TR(decalLine(deck, pts, 0.005, 0.0016), '#050505', 0, 0.9); });
    if (!D.open && !Fc.spare && S.H < 1.7) {      // boot lid / tailgate line across the tail
      const zt = Math.max(S.zR + 0.2, G.zC - 0.08); if (zt < G.zC - 0.02) { const pts = []; const hwz = B.deckHalf(zt) - 0.04; for (let x = -hwz; x <= hwz + 1e-6; x += 0.08) pts.push([x, zt - 0.06 * (1 - (x / hwz) ** 2) + 0.06]); TR(decalLine(deck, pts, 0.005, 0.0016), '#050505', 0, 0.9); }
    }
    if (Fc.engineCover) {                         // louvred glass cover over a mid engine
      const z0 = S.zR + 0.42, z1 = G.zC - 0.02, hwc = 0.42;
      TR(decalFill(deck, (x, z) => Math.abs(x) < hwc * (0.72 + 0.28 * (z - z0) / (z1 - z0)) && z > z0 && z < z1, -hwc, hwc, z0, z1, 0.035, 0.003), '#060708', 0.4, 0.08);
      for (let z = z0 + 0.08; z < z1 - 0.04; z += 0.09) { const hx = hwc * (0.72 + 0.28 * (z - z0) / (z1 - z0)) - 0.03; TR(decalLine(deck, [[-hx, z], [hx, z]], 0.012, 0.0045), '#1c1d20', 0.6, 0.3); }
    }
    if (Fc.rails) both(sg => { const pts = []; for (let z = G.zT2 + 0.2; z <= G.zT1 - 0.25; z += 0.25) pts.push(new THREE.Vector3(sg * (G.roofW - 0.05), mono(G.roofEdge)(z) + 0.05, z)); pts[0].y -= 0.035; pts[pts.length - 1].y -= 0.035; TR(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.014, 6, false), '#c4c6c9', 1, 0.2); });
    if (!D.open && S.H < 1.9) { const zf2 = G.zT2 + 0.12, fy = mono(G.roofEdge)(zf2) + G.crown; const fin = new THREE.ConeGeometry(0.03, 0.05, 8); fin.scale(0.6, 1, 2.6); fin.translate(0, fy + 0.02, zf2); out.paint.push(strip(fin.toNonIndexed(), ['position', 'normal'])); }
    if (Fc.wing === true) {                       // low fixed wing on two blades
      const wz = S.zR + 0.2, wy = B.deckY(0, wz) + 0.1;
      const blade = new RoundedBoxGeometry(S.W * 0.78, 0.022, 0.2, 2, 0.01); blade.rotateX(-0.12); blade.translate(0, wy, wz); out.paint.push(strip(blade.toNonIndexed(), ['position', 'normal']));
      for (const s of [-1, 1]) { const st2 = new RoundedBoxGeometry(0.022, 0.1, 0.12, 1, 0.008); st2.translate(s * 0.52, wy - 0.05, wz + 0.02); TR(st2, BLACK, 0.2, 0.3); }
    }
  }
  if (D.open) {
    // screen frame header, twin fairings behind the rear seats, a roll bar hint
    for (const s of [-1, 1]) { const f = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); f.scale(0.2, 0.085, 0.42); f.translate(s * S.driverX, B.deckY(S.driverX, G.zC - 0.2) - 0.012, G.zC - 0.3); out.paint.push(strip(f.toNonIndexed(), ['position', 'normal'])); }
  }
  // dashboard displays (they glow: light group 2): the driver's instruments with two dials, the centre screen
  if (fine) {
    const dRear = S.seat + 0.68, dh = B.sh(clamp(GH.z0A, G.zC, G.zA)) - 0.035;
    const pl = (w2, h2, x, y, z, tilt, rgb, grad = 0) => {
      const g = new THREE.PlaneGeometry(w2, h2, 1, 1); g.rotateX(tilt); g.rotateY(Math.PI); g.translate(x, y, z);
      const ng = g.toNonIndexed(); g.dispose(); strip(ng, ['position', 'normal']); const p = ng.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const k = 1 + grad * (p.getY(i) - y) / h2; c.set([rgb[0] * k, rgb[1] * k, rgb[2] * k], i * 3); }
      ng.setAttribute('color', new THREE.BufferAttribute(c, 3)); attr(ng, 'lk', 1, [2]); out.lights.push(ng);
    };
    const dx = S.driverX, y0 = dh + 0.085, z0 = dRear + 0.03, tl = -0.22, GOLD = [0.95, 0.78, 0.48];
    pl(0.33, 0.115, dx, y0, z0, tl, [0.02, 0.028, 0.045], 0.8);
    for (const s of [-1, 1]) {
      const ring = new THREE.RingGeometry(0.036, 0.04, 28); ring.rotateX(tl); ring.rotateY(Math.PI); ring.translate(dx + s * 0.088, y0, z0 - 0.002); LT(ring, GOLD, 2);
      for (let k = 0; k <= 6; k++) { const g = new THREE.PlaneGeometry(0.0026, 0.008); g.translate(0, 0.03, 0); g.rotateZ((1 - k / 3) * 2.1); g.rotateX(tl); g.rotateY(Math.PI); g.translate(dx + s * 0.088, y0, z0 - 0.003); LT(g, [0.85, 0.86, 0.9], 2); }
      const nd = new THREE.PlaneGeometry(0.003, 0.03); nd.translate(0, 0.014, 0); nd.rotateZ(s < 0 ? 1.4 : 0.6); nd.rotateX(tl); nd.rotateY(Math.PI); nd.translate(dx + s * 0.088, y0, z0 - 0.004); LT(nd, [1.0, 0.45, 0.2], 2);
    }
    pl(0.07, 0.008, dx, y0 - 0.03, z0 - 0.003, tl, [0.7, 0.8, 0.95]);
    // centre screen: map tiles, a route line, a status bar
    const cy = dh - 0.0, cz = dRear - 0.022;
    pl(0.32, 0.17, 0, cy, cz, -0.12, [0.018, 0.024, 0.036], 0.6);
    pl(0.13, 0.1, 0.085, cy + 0.02, cz - 0.004, -0.12, [0.05, 0.075, 0.1]); pl(0.13, 0.045, -0.08, cy + 0.045, cz - 0.004, -0.12, [0.085, 0.075, 0.055]); pl(0.13, 0.04, -0.08, cy - 0.005, cz - 0.004, -0.12, [0.045, 0.06, 0.085]);
    pl(0.3, 0.01, 0, cy - 0.068, cz - 0.004, -0.12, GOLD); pl(0.004, 0.07, 0.085, cy + 0.02, cz - 0.006, -0.12, GOLD); pl(0.05, 0.004, 0.065, cy + 0.04, cz - 0.006, -0.12, GOLD);
    LT(new THREE.BoxGeometry(1.1, 0.005, 0.005).translate(0, dh - 0.135, dRear - 0.012), [0.9, 0.62, 0.3], 2);   // ambient light line
  }
  // belt mouldings + window surround (chrome or gloss black)
  if (!D.open && (fine || mid)) {
    const beltPts = sg => { const pts = []; for (let z = Math.max(D.q[0] - (D.quarter ? 0.9 : 0), G.zC + 0.2); z <= zAside + 0.15; z += 0.12) { const pb = baseA(z); pts.push(new THREE.Vector3(sg * (pb[0] + 0.006), B.deckY(pb[0], z) + 0.004, z)); } return pts; };
    both(sg => { const pts = beltPts(sg); if (pts.length < 3) return; const whole = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.0075, 5, false); TR(whole, Fc.chrome ? CHROME : BLACK, Fc.chrome ? 1 : 0.1, 0.1); });
  }
  // ---- wheel-arch liners, brakes
  for (const z0 of zw) {
    const n = tier === 0 ? 20 : tier === 1 ? 8 : 5, pos = [], idx = [], x0 = -(B.sideX(z0, S.R + S.Ra + 0.03) - 0.012), x1 = -x0;
    for (let i = 0; i <= n; i++) { const a = -0.3 + (Math.PI + 0.6) * i / n; pos.push(x0, S.R + Math.sin(a) * (S.Ra - 0.004), z0 + Math.cos(a) * (S.Ra - 0.004), x1, S.R + Math.sin(a) * (S.Ra - 0.004), z0 + Math.cos(a) * (S.Ra - 0.004)); }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(n) > 0) flipWinding(g); g.computeVertexNormals(); TR(g, '#040404', 0, 0.95);
  }
  const wheelPos = [[S.wheelX, S.R, zw[0], 1, 1], [-S.wheelX, S.R, zw[0], -1, 1], [S.wheelX, S.R, zw[1], 1, 0], [-S.wheelX, S.R, zw[1], -1, 0]];
  if (tier === 0) for (const [x, y, z, s] of wheelPos) {
    const d = new THREE.CylinderGeometry(S.rimR - 0.035, S.rimR - 0.035, 0.03, 28); d.rotateZ(Math.PI / 2); d.translate(x - s * 0.01, y, z); TR(d, '#85878a', 1, 0.4);
    const c = new RoundedBoxGeometry(0.06, 0.17, 0.11, 1, 0.018); c.translate(x - s * 0.0, y + (S.rimR - 0.1) * 0.75, z - (S.rimR - 0.1) * 0.66); c.rotateX(0); TR(c, S.calliper, 0.3, 0.35);
  }
  // ---- assemble
  const KP = ['position', 'normal'];
  const res = { spec: S, tier, wheel: wheelGeometry(S.kind, tier), wheelPos, B, GH };
  if (tier === 0) {
    const door0 = door ? { ...door } : null;
    const steer = steeringGeometry();
    res.paint = boxUV(mergeAll(out.paint, KP), 3.1);
    res.glass = mergeAll(out.glass, KP);
    res.trim = mergeAll(out.trim, ['position', 'normal', 'color', 'mr']);
    res.lights = mergeAll(out.lights, ['position', 'normal', 'color', 'lk']);
    res.headliner = out.headliner || null;
    res.steering = steer; res.eye = [S.driverX, S.eye, S.seat + 0.02]; res.mirrorPos = out.mirrorPos || [S.W / 2 + 0.1, S.eye - 0.12, S.seat + 0.75];
    if (door0) {
      const hx = B.sideX(door0.z1, (B.rock(door0.z1) + B.sh(door0.z1)) / 2) - 0.03;
      door0.hinge = [hx, 0, door0.z1];
      const sh = g => { if (g) g.translate(-hx, 0, -door0.z1); return g; };
      door0.paint = sh(boxUV(mergeAll(out.dpaint, KP), 3.1)); door0.glass = sh(mergeAll(out.dglass, KP)); door0.trim = out.dtrim.length ? mergeAll(out.dtrim, ['position', 'normal', 'color', 'mr']) : null;
      if (door0.trim) sh(door0.trim);
      res.door = door0;
    }
    res.interiorFor = ic => { const I = interiorGeometry(S, B, GH, ic, door0); if (I.door && door0) I.door.translate(-door0.hinge[0], 0, -door0.hinge[2]); return I; };
  } else {
    // merged models: paint (instance colour) + everything else in one vertex-coloured mesh
    const wheels = wheelPos.map(([x, y, z, s]) => { const g = res.wheel.clone(); if (s < 0) g.rotateY(Math.PI); g.translate(x, y, z); return g; });
    const gl = out.glass.map(g => tint(g, '#0a0e12', 0.25, 0.05));
    const li = out.lights.map(g => { const c = g.attributes.color, lk = g.attributes.lk.getX(0), k = lk === 2 ? 0.75 : lk === 0 ? 0.5 : lk === 1 ? 0.45 : 0.3; for (let i = 0; i < c.count; i++) c.setXYZ(i, Math.min(1, c.getX(i) * k), Math.min(1, c.getY(i) * k), Math.min(1, c.getZ(i) * k)); g.deleteAttribute('lk'); attr(g, 'mr', 2, [0, 0.25]); return g; });
    res.paint = mergeAll(out.paint, KP);
    res.rest = mergeAll([...out.trim, ...gl, ...li, ...wheels], ['position', 'normal', 'color', 'mr']);
  }
  return (GEO[key] = res);
}

// ------------------------------------------------------------------ textures & materials
let FLAKE = null;
function flakeTex() {
  if (FLAKE) return FLAKE;
  // custom mip chain fading to a flat normal: mip-averaged random normals would otherwise read as dents at a distance
  const N = 128, r = rng(77), mips = [], base = new Float32Array(N * N * 2);
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
// Standard material with per-vertex metalness / roughness (attribute `mr`) — chrome, gloss black, rubber in one draw call.
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
// Unlit lamps: vertex colour × the level of its group (0 head, 1 tail / brake, 2 running lights & displays, 3 reverse, 4 indicators —
// the left-hand ones (x > 0) and the right-hand ones have a level each).
function lightMaterial() {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  m.userData.uK = { value: [0.12, 0.3, 0.1, 0.06, 0.25, 0.25] };
  m.onBeforeCompile = sh => {
    sh.uniforms.uK = m.userData.uK;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float lk;\nvarying float vLk;\nvarying float vSideX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLk = lk;\nvSideX = position.x;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uK[6];\nvarying float vLk;\nvarying float vSideX;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vLk < 0.5 ? uK[0] : (vLk < 1.5 ? uK[1] : (vLk < 2.5 ? uK[2] : (vLk < 3.5 ? uK[3] : (vSideX > 0.0 ? uK[4] : uK[5]))));');
  };
  m.customProgramCacheKey = () => 'vrc-car-lights6';
  return m;
}
const MATS = {};
const paintOf = colour => CAR_PAINTS[colour] || [colour || '#222', 0.6, 0.3, 0.1];
function paintMaterial(colour) {
  const key = 'paint:' + colour; if (MATS[key]) return MATS[key];
  const [hex, metal, rough, flake] = paintOf(colour), pearl = colour === 'pearl';
  // metallic base under a clear coat; the flake normal map breaks up the base reflection only (the coat stays mirror-smooth)
  const m = new THREE.MeshPhysicalMaterial({ color: hex, metalness: metal, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.25,
    normalMap: flake ? flakeTex() : null, normalScale: new THREE.Vector2(flake, flake) });
  if (pearl) { m.iridescence = 0.3; m.iridescenceIOR = 1.45; m.iridescenceThicknessRange = [260, 480]; }
  return (MATS[key] = m);
}
function shared() {
  if (MATS.glass) return MATS;
  // lightly tinted glass: the cabin shows through; from inside it is almost clear
  MATS.glass = new THREE.MeshPhysicalMaterial({ color: '#0b1114', metalness: 0.0, roughness: 0.03, transparent: true, opacity: 0.62, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
  MATS.glassIn = new THREE.MeshStandardMaterial({ color: '#10161b', metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.07, envMapIntensity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  MATS.trim = mrMaterial({ envMapIntensity: 1.3 });
  MATS.interior = mrMaterial({ envMapIntensity: 0.7, side: THREE.DoubleSide });
  MATS.wheel = mrMaterial({ envMapIntensity: 1.3 });
  MATS.midPaint = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2 });
  MATS.rest = mrMaterial({ envMapIntensity: 1.2 });
  MATS.farPaint = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.26, envMapIntensity: 1.3 });
  return MATS;
}
/** Shared car materials (for hosts that need to register them with their environment / light mode). */
export function carMaterials() { const M = shared(); return [M.glass, M.glassIn, M.trim, M.interior, M.wheel, M.midPaint, M.rest, M.farPaint, ...Object.entries(MATS).filter(([k]) => k.startsWith('paint:')).map(q => q[1])]; }

// ------------------------------------------------------------------ number plates (detailed model only)
// Ukrainian format: a blue strip with the flag and «UA», then two letters of the region (AO / KO — Zakarpattia), four
// digits and a two-letter series. The numbers are random and cannot be anyone's: the series uses only Latin letters that
// real Ukrainian plates never carry (D, F, G, J, L, N, R, S, U, V, W, Y, Z). One shared atlas, one small mesh per car.
export const PLATES = { cols: 2, rows: 8, n: 16, W: 0.52, H: 0.112, mat: null, texts: [] };
/** The registration shown on plate `index` of the atlas (fictional series), e.g. 'AO 4821 DJ'. */
export function plateText(index) { plateMaterial(); const i = ((index % PLATES.n) + PLATES.n) % PLATES.n; return PLATES.texts[i] || ''; }
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
    const txt = (r() < 0.75 ? 'AO' : 'KO') + ' ' + num + ' ' + pick() + pick(); PLATES.texts[i] = txt;
    g.fillStyle = '#111113'; g.font = '700 78px "Arial Narrow", Arial, Helvetica, sans-serif'; g.fillText(txt, x + 58 + (cw - 64) / 2, y + ph / 2 + 4, cw - 84);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  PLATES.pad = (ch - ph) / 2 / ch;
  return (PLATES.mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, metalness: 0.05, emissive: new THREE.Color('#ffffff'), emissiveMap: t, emissiveIntensity: 0.08, side: THREE.DoubleSide }));
}
// front + rear plate of a model, laid on the bodywork at bumper height
function plateGeometry(kind, index) {
  const i = ((index % PLATES.n) + PLATES.n) % PLATES.n, key = kind + ':plate:' + i;
  if (GEO[key]) return GEO[key];
  const G0 = buildCar(kind, 0), S = G0.spec, B = G0.B, W = PLATES.W, H = PLATES.H, pos = [], uv = [], nrm = [];
  const u0 = (i % PLATES.cols) / PLATES.cols, u1 = u0 + 1 / PLATES.cols, row = Math.floor(i / PLATES.cols);
  const v1 = 1 - (row + PLATES.pad) / PLATES.rows, v0 = 1 - (row + 1 - PLATES.pad) / PLATES.rows;
  const cF = B.col(3), cR = B.col(0);
  for (const front of [true, false]) {
    const c = front ? cF : cR, yLo = c.yB + 0.11, y = front ? (S.face.grille === 'tall' || S.face.grille === 'wide' || S.face.grille === 'bars' ? yLo + 0.03 : S.face.lower === 'split' ? yLo + 0.12 : yLo + 0.1) : (S.face.spare ? c.yB + 0.12 : Math.min(c.yT - 0.3, c.yB + 0.3));
    const ab = d => (front ? B.frontAB(d, y) : B.rearAB(d, y));
    const pc = B.P(...ab(0)), pe = B.P(...ab(W / 2));
    const z = front ? Math.max(pc[2], pe[2]) + 0.008 : Math.min(pc[2], pe[2]) - 0.008, s = front ? 1 : -1, tilt = clamp(pc[4], -0.5, 0.5) * 0.5;
    const yb = y - H / 2, yt = y + H / 2, zb = z + s * tilt * H / 2 * (front ? 1 : -1) * 0, zt = z;
    pos.push(-s * W / 2, yb, zb, s * W / 2, yb, zb, s * W / 2, yt, zt, -s * W / 2, yb, zb, s * W / 2, yt, zt, -s * W / 2, yt, zt);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let k = 0; k < 6; k++) nrm.push(0, 0, s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return (GEO[key] = geo);
}

// ------------------------------------------------------------------ public: one detailed car
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
/** A full-detail car: group + setWheels(spin, steer) + setLights(on, brake, reverse, blink) + setDoor(0…1) + setInside(bool).
 *  Draw calls: paint, glass, trim, lamps, cabin, plates, steering wheel, 4 instanced wheels + the driver's door (≤ 4). */
export function createCar(kind = 'sedan', colour = 'black', opts = {}) {
  if (!SPECS[kind]) kind = 'sedan';
  const G = buildCar(kind, 0), S = G.spec, MS = shared();
  const icIndex = opts.interior ?? (hashStr(kind + colour) % INTERIORS.length);
  const ikey = S.kind + ':int:' + icIndex;
  let I = GEO[ikey];
  if (!I) { const raw = G.interiorFor(INTERIORS[icIndex]); I = GEO[ikey] = { main: mergeGeometries([raw.main, G.headliner].filter(Boolean), false), door: raw.door }; I.main.computeBoundingSphere(); }
  const group = new THREE.Group(); group.name = 'vrc-car-' + S.kind;
  const paint = paintMaterial(colour), lightsMat = lightMaterial();
  const mk = (geo, mat, name, parent = group) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); parent.add(m); return m; };
  const body = mk(G.paint, paint, 'paint');
  const glasses = [mk(G.glass, MS.glass, 'glass')];
  mk(G.trim, MS.trim, 'trim'); mk(G.lights, lightsMat, 'lights'); mk(I.main, MS.interior, 'interior');
  if (opts.plate !== false) { const pm = plateMaterial(); if (pm) mk(plateGeometry(S.kind, opts.plate ?? hashStr(kind + ':' + colour)), pm, 'plates'); }
  // the driver's door on its hinge
  let doorG = null;
  if (G.door) {
    doorG = new THREE.Group(); doorG.name = 'door'; doorG.position.set(G.door.hinge[0], 0, G.door.hinge[2]); group.add(doorG);
    mk(G.door.paint, paint, 'door-paint', doorG); glasses.push(mk(G.door.glass, MS.glass, 'door-glass', doorG)); mk(G.door.trim, MS.trim, 'door-trim', doorG); mk(I.door, MS.interior, 'door-card', doorG);
  }
  for (const g of glasses) if (g) g.renderOrder = 3;
  const steering = new THREE.Group(); steering.name = 'steering';
  // the wheel sits where the instruments show above its rim (a tall cabin has them low under the screen)
  const dashY = G.B.sh(clamp(G.GH.z0A, S.gh.zC, S.gh.zA)) - 0.035 + 0.085;
  steering.position.set(S.driverX, Math.min(S.eye - 0.34, S.eye - 0.483 * (S.eye - dashY) - 0.235), S.seat + 0.5); steering.rotation.x = 0.4;
  const sw = new THREE.Mesh(G.steering, MS.interior); sw.name = 'steering-wheel'; steering.add(sw); group.add(steering);
  const wheels = new THREE.InstancedMesh(G.wheel, MS.wheel, 4); wheels.name = 'wheels'; wheels.frustumCulled = false; group.add(wheels);
  const state = { spin: 0, steer: 0, door: 0 };
  const api = {};
  function setWheels(spin = state.spin, steer = state.steer) {
    state.spin = spin; state.steer = steer;
    G.wheelPos.forEach(([x, y, z, s, front], i) => {
      const wb = api.wheelBend ? api.wheelBend[i] : null;                     // a wheel knocked out of line by a crash (car-damage.js)
      _q.setFromEuler(_e.set(0, (front ? steer : 0) + (wb ? wb.toe : 0), wb ? wb.camber * (s < 0 ? 1 : -1) : 0, 'YXZ')); _q2.setFromEuler(_e.set(spin, 0, 0)); _q3.setFromEuler(_e.set(0, s < 0 ? Math.PI : 0, 0));
      _q.multiply(_q2).multiply(_q3); _m.compose(_v.set(x, y - (wb ? wb.drop : 0), z), _q, _s1); wheels.setMatrixAt(i, _m);
    });
    wheels.instanceMatrix.needsUpdate = true;
    sw.rotation.z = -steer * 7.5;
  }
  const uK = lightsMat.userData.uK.value;
  let on = false;
  // blink = both sides (hazards) or the left side when blinkR is given; blinkR = the right side
  function setLights(v, brake = false, reverse = false, blink = false, blinkR = null) {
    on = !!v;
    uK[0] = on ? 1.0 : 0.1; uK[1] = brake ? 2.6 : on ? 0.9 : 0.28; uK[2] = on ? 1.0 : 0.5; uK[3] = reverse ? 1.6 : 0.07; uK[4] = blink ? 2.2 : 0.25; uK[5] = (blinkR == null ? blink : blinkR) ? 2.2 : 0.25;
  }
  setLights(false);
  let cockpit = null;
  // inside = the visitor sits in this car: clear glass, and the live cockpit (instruments, centre screen, mirrors, wipers)
  function setInside(v, opts) {
    for (const g of glasses) if (g) g.material = v ? MS.glassIn : MS.glass;
    if (v && !cockpit) { try { cockpit = createCockpit(S, opts); group.add(cockpit.group); } catch (e) { console.warn('[cars] cockpit', e); cockpit = null; } }
    if (cockpit) cockpit.group.visible = !!v;
  }
  function setDoor(t) { state.door = clamp(t); if (doorG) { doorG.rotation.y = -state.door * 1.12; doorG.updateMatrixWorld(true); } }
  Object.defineProperties(api, Object.getOwnPropertyDescriptors({
    group, wheels, steering, lights: lightsMat, setLights, setWheels, setInside, setDoor, kind: S.kind, colour, spec: S, name: S.name,
    eye: new THREE.Vector3(...G.eye), body, door: doorG, hinge: G.door ? G.door.hinge : null, plate: opts.plate === false ? null : plateText(opts.plate ?? hashStr(kind + ':' + colour)),
    get cockpit() { return cockpit; }, /** live cockpit of the driven car (created by setInside(true)); also usable from the chase view */ ensureCockpit(o) { if (!cockpit) { setInside(true, o); setInside(false); } return cockpit; },
    panels: () => carPanels(S.kind),
    get lightsOn() { return on; }, get doorOpen() { return state.door; },
    wheelBend: null, damageRev: 0,
    dispose() { lightsMat.dispose(); if (cockpit) cockpit.dispose(); group.traverse(o => { if (o.userData && (o.userData.dmgBase || /^dmg-/.test(o.name || ''))) o.geometry.dispose(); }); group.parent?.remove(group); },
  }));
  setWheels(0, 0);
  return api;
}


// ------------------------------------------------------------------ body panels (for damage, next wave)
// The painted skin of the full-detail tier is one mesh (+ the driver's door); every vertex of it belongs to a named panel,
// found from where it lies on the car: 0 front bumper, 1 bonnet, 2 left front wing, 3 right front wing, 4 left doors,
// 5 right doors, 6 roof / pillars, 7 left rear wing, 8 right rear wing, 9 boot, 10 rear bumper. (Left = +x, the driver's side.)
// → { names, of(x, y, z) → index, attribute: Uint8Array per vertex of buildCar(kind, 0).paint, ranges: per panel the bounding box }
// A deformer can move the vertices of one panel only (CPU or a vertex-shader uniform per panel) without splitting the mesh.
export const PANEL_NAMES = ['bumperF', 'bonnet', 'wingFL', 'wingFR', 'doorL', 'doorR', 'roof', 'wingRL', 'wingRR', 'boot', 'bumperR', 'glass'];
const PANELS = {};
export function carPanels(kind) {
  const S = carSpec(kind); if (PANELS[S.kind]) return PANELS[S.kind];
  const G0 = buildCar(S.kind, 0), B = G0.B, G = S.gh, zw = [S.wb / 2, -S.wb / 2];
  const belt = z => B.sh(clamp(z, S.zR + 0.05, S.zF - 0.05));
  const of = (x, y, z) => {
    if (z > S.zF - 0.34 && y < belt(z) - 0.12) return 0;
    if (z < S.zR + 0.34 && y < belt(z) - 0.14) return 10;
    if (y > belt(z) + 0.05 && z < G.zA && z > G.zC) return 6;
    if (z >= G.zA - 0.02 && Math.abs(x) < S.W / 2 - 0.16 && y > belt(z) - 0.09) return 1;
    if (z <= G.zC + 0.02 && Math.abs(x) < S.W / 2 - 0.16 && y > belt(z) - 0.09) return 9;
    if (z > zw[0] - S.Ra - 0.12) return x > 0 ? 2 : 3;
    if (z < zw[1] + S.Ra + 0.12) return x > 0 ? 7 : 8;
    return x > 0 ? 4 : 5;
  };
  const p = G0.paint.attributes.position, attribute = new Uint8Array(p.count), ranges = PANEL_NAMES.map(() => null);
  for (let i = 0; i < p.count; i++) { const k = of(p.getX(i), p.getY(i), p.getZ(i)); attribute[i] = k; const r = ranges[k] || (ranges[k] = { x0: 9, x1: -9, y0: 9, y1: -9, z0: 9, z1: -9, n: 0 }); r.n++; r.x0 = Math.min(r.x0, p.getX(i)); r.x1 = Math.max(r.x1, p.getX(i)); r.y0 = Math.min(r.y0, p.getY(i)); r.y1 = Math.max(r.y1, p.getY(i)); r.z0 = Math.min(r.z0, p.getZ(i)); r.z1 = Math.max(r.z1, p.getZ(i)); }
  return (PANELS[S.kind] = { names: PANEL_NAMES, of, attribute, ranges });
}

// ------------------------------------------------------------------ the live cockpit of the driven car
// Added to ONE car at a time (the one the visitor sits in): the instrument cluster (speedometer and rev counter with needles,
// digital km/h, gear, indicator / light tell-tales) and the centre screen (radio) are canvases laid over the static displays
// of the model; the rear-view mirror and both door mirrors are quads that show one shared picture (a wide view to the rear —
// the host renders it into a small target every few frames and hands the texture over; without it a neutral still);
// two wiper arms on the windscreen. 4 draw calls.
// → { group, draw(state), setMirrorMap(texture | null), mirrorCamera(camera), setWipers(t 0…1), dispose() }
// state: { kmh, rpm, redline, gear ('P' | 'R' | 'D'), gearNo, ev, lights, left, right, limit, radio: { on, name, freq, status, volume, muted }, labels: { radio, off, connecting, noSignal, kmh }, clock }
export function createCockpit(kind, { size = 1 } = {}) {
  const S = typeof kind === 'string' ? carSpec(kind) : kind, G0 = buildCar(S.kind, 0), B = G0.B, GH = G0.GH, G = S.gh;
  const dRear = S.seat + 0.68, dh = B.sh(clamp(GH.z0A, G.zC, G.zA)) - 0.035, dx = S.driverX;
  const group = new THREE.Group(); group.name = 'vrc-cockpit';
  const own = [];
  const canvasPlane = (w, h, x, y, z, tilt, cw, ch, name) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(cw * size); cv.height = Math.round(ch * size);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true;
    const g = new THREE.PlaneGeometry(w, h); g.rotateX(tilt); g.rotateY(Math.PI); g.translate(x, y, z);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); m.name = name; m.matrixAutoUpdate = false; m.renderOrder = 2; group.add(m); own.push(g, m.material, tex);
    return { cv, ctx: cv.getContext('2d'), tex, mesh: m };
  };
  const CL = canvasPlane(0.33, 0.115, dx, dh + 0.085, dRear + 0.03 - 0.007, -0.22, 736, 256, 'cockpit-cluster');
  const SC = canvasPlane(0.32, 0.17, 0, dh, dRear - 0.022 - 0.02, -0.12, 640, 340, 'cockpit-screen');   // 2 cm proud of the static screen (its tiles are stepped)
  // ---- mirrors: one geometry, three quads with their own part of the shared picture
  const eye = new THREE.Vector3(...G0.eye);
  const mpos = [], muv = [], hpos = [];
  const quad = (c, w, h, u0, u1, v0, v1) => {
    // the quad faces the driver's eye turned half-way towards straight back (a real mirror shows what is behind, not the driver)
    const n = eye.clone().sub(c).normalize(); n.add(new THREE.Vector3(0, 0, -1)).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(n).normalize(), up = n.clone().cross(right).normalize();   // right = towards −x for a quad facing −z
    const P = (a, b) => c.clone().addScaledVector(right, a * w / 2).addScaledVector(up, b * h / 2);
    const A = P(-1, -1), Bq = P(1, -1), C = P(1, 1), D = P(-1, 1);            // A is on the +x side (right points to −x … see above)
    for (const q of [A, Bq, C, A, C, D]) mpos.push(q.x, q.y, q.z);
    // larger car-x ↔ larger u (the camera that looks back has +x on its right)
    const ua = right.x < 0 ? u1 : u0, ub = right.x < 0 ? u0 : u1;
    muv.push(ua, v0, ub, v0, ub, v1, ua, v0, ub, v1, ua, v1);
    // a dark housing just behind the glass
    const k = 0.012; for (const q of [P(-1.08, -1.14), P(1.08, -1.14), P(1.08, 1.14), P(-1.08, -1.14), P(1.08, 1.14), P(-1.08, 1.14)]) hpos.push(q.x - n.x * k, q.y - n.y * k, q.z - n.z * k);
  };
  const my = Math.min(S.eye + 0.13, S.H - 0.165), mz = Math.min(G.zT1 + 0.12, G0.eye[2] + 0.62);
  quad(new THREE.Vector3(0, my, mz), 0.24, 0.064, 0.3, 0.7, 0.3, 0.8);
  const sm = G0.mirrorPos;
  quad(new THREE.Vector3(sm[0], sm[1], sm[2] - 0.004), 0.185, 0.1, 0.7, 1.0, 0.12, 0.92);
  quad(new THREE.Vector3(-sm[0], sm[1], sm[2] - 0.004), 0.185, 0.1, 0.0, 0.3, 0.12, 0.92);
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(mpos, 3)); mg.setAttribute('uv', new THREE.Float32BufferAttribute(muv, 2));
  // neutral still for hosts that render no mirror picture: sky above a grey road
  const still = (() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32; const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 32); gr.addColorStop(0, '#8fa3b8'); gr.addColorStop(0.48, '#c9d2da'); gr.addColorStop(0.52, '#4a4d52'); gr.addColorStop(1, '#2a2c30'); g.fillStyle = gr; g.fillRect(0, 0, 64, 32); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const mirrorMat = new THREE.MeshBasicMaterial({ map: still, side: THREE.DoubleSide, color: '#d6dadd' });
  const mirrors = new THREE.Mesh(mg, mirrorMat); mirrors.name = 'cockpit-mirrors'; mirrors.matrixAutoUpdate = false; mirrors.renderOrder = 2; group.add(mirrors);
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hpos.slice(0, 18), 3));   // housing of the inside mirror only (the door mirrors have their caps)
  { const stalk = new THREE.BoxGeometry(0.02, Math.max(0.03, S.H - 0.06 - my), 0.02).toNonIndexed(); stalk.translate(0, (my + S.H - 0.06) / 2 + 0.02, mz + 0.03); const a = new Float32Array(hpos.slice(0, 18).length + stalk.attributes.position.array.length); a.set(hpos.slice(0, 18)); a.set(stalk.attributes.position.array, 18); hg.setAttribute('position', new THREE.BufferAttribute(a, 3)); stalk.dispose(); }
  const housing = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: '#0b0b0c', side: THREE.DoubleSide })); housing.name = 'cockpit-mirror-housing'; housing.matrixAutoUpdate = false; if (!S.dlo.open) group.add(housing);
  own.push(mg, mirrorMat, still, hg, housing.material);
  // ---- wipers: two arms lying along the bottom of the windscreen; they swing in its plane
  const rake = Math.atan2(S.H - 0.05 - (dh + 0.04), Math.max(0.2, G.zA - G.zT1)), wl = Math.min(0.56, S.W * 0.27);
  const wipers = new THREE.Group(); wipers.name = 'cockpit-wipers'; group.add(wipers);
  const wmat = new THREE.MeshBasicMaterial({ color: '#070708' }); const wgeo = new THREE.BoxGeometry(wl, 0.008, 0.01); wgeo.translate(wl / 2, 0, 0); own.push(wmat, wgeo);
  const arms = [];
  for (const px of [-0.06, -(S.W * 0.31)]) {
    const piv = new THREE.Group(); piv.position.set(px, dh + 0.075, G.zA - 0.1 - Math.abs(px) * 0.12); piv.rotation.set(-(Math.PI / 2 - rake), 0, 0); wipers.add(piv);
    const arm = new THREE.Mesh(wgeo, wmat); arm.position.z = -0.02; piv.add(arm); arms.push(arm);
  }
  function setWipers(t) { const a = 0.06 + 1.36 * clamp(t); for (const arm of arms) arm.rotation.z = a; }
  setWipers(0);
  // ---- drawing
  const F = '"Manrope", "Inter Tight", Arial, Helvetica, sans-serif';
  let lastKey = '', lastScr = '';
  function dial(g, cx, cy, R, frac, { max, step, label, red = 1, unit }) {
    const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, A = f => a0 + (a1 - a0) * f;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    if (red < 1) { g.strokeStyle = '#d83a2c'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R - 2, A(red), a1); g.stroke(); }
    g.strokeStyle = '#d9b46a'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R - 2, a0, A(clamp(frac))); g.stroke();
    const n = Math.round(max / step); g.fillStyle = '#e8e9ee'; g.font = `600 ${Math.round(R * 0.2)}px ${F}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= n; i++) {
      const a = A(i / n), c = Math.cos(a), s = Math.sin(a);
      g.strokeStyle = '#e8e9ee'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx + c * (R - 5), cy + s * (R - 5)); g.lineTo(cx + c * (R - 16), cy + s * (R - 16)); g.stroke();
      if (n <= 7 || i % 2 === 0) g.fillText(String(label(i * step)), cx + c * (R - 31), cy + s * (R - 31));
    }
    const a = A(clamp(frac, 0, 1.02)); g.strokeStyle = '#ff5a2a'; g.lineWidth = 4.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); g.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); g.stroke();
    g.fillStyle = '#16181d'; g.beginPath(); g.arc(cx, cy, 11, 0, 7); g.fill(); g.strokeStyle = '#d9b46a'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#9aa0ab'; g.font = `600 ${Math.round(R * 0.15)}px ${F}`; g.fillText(unit, cx, cy + R * 0.52);
  }
  const vDial = Math.ceil((S.perf.vmax + 25) / 40) * 40;
  // warning lamps (plain pictograms, drawn — no fonts or symbols of any maker)
  const lamp = (g, x, y, kind, col, on) => {
    g.save(); g.translate(x, y); g.strokeStyle = g.fillStyle = on ? col : 'rgba(255,255,255,.08)'; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (kind === 'engine') { g.beginPath(); g.moveTo(-11, -4); g.lineTo(-5, -4); g.lineTo(-2, -8); g.lineTo(7, -8); g.lineTo(7, -4); g.lineTo(12, -4); g.lineTo(12, 7); g.lineTo(7, 7); g.lineTo(4, 10); g.lineTo(-7, 10); g.lineTo(-7, 5); g.lineTo(-11, 5); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(-14, -2); g.lineTo(-14, 4); g.moveTo(0, -11); g.lineTo(6, -11); g.stroke(); }
    else if (kind === 'abs') { g.beginPath(); g.arc(0, 0, 12, 0, 7); g.stroke(); g.font = `700 10px ${F}`; g.fillText('ABS', 0, 1); }
    else if (kind === 'hand') { g.beginPath(); g.arc(0, 0, 10, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 14.5, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(0, 0, 14.5, Math.PI - 0.9, Math.PI + 0.9); g.stroke(); g.font = `700 13px ${F}`; g.fillText('P', 0, 1); }
    else if (kind === 'hazard') { g.beginPath(); g.moveTo(0, -12); g.lineTo(13, 10); g.lineTo(-13, 10); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, -4); g.lineTo(6, 6); g.lineTo(-6, 6); g.closePath(); g.stroke(); }
    else if (kind === 'fuel') { g.strokeRect(-7, -10, 11, 20); g.fillRect(-5, -8, 7, 6); g.beginPath(); g.moveTo(4, -4); g.lineTo(9, -1); g.lineTo(9, 8); g.stroke(); }
    else if (kind === 'door') { g.strokeRect(-6, -11, 12, 22); g.beginPath(); g.moveTo(6, -8); g.lineTo(14, -2); g.lineTo(6, 3); g.stroke(); }
    else if (kind === 'temp') { g.beginPath(); g.moveTo(0, -11); g.lineTo(0, 4); g.stroke(); g.beginPath(); g.arc(0, 7, 4, 0, 7); g.fill(); g.beginPath(); g.moveTo(3, -8); g.lineTo(8, -8); g.moveTo(3, -3); g.lineTo(8, -3); g.moveTo(-12, 12); g.quadraticCurveTo(-6, 8, 0, 12); g.quadraticCurveTo(6, 16, 12, 12); g.stroke(); }
    g.restore();
  };
  const bar = (g, x, y, w, frac, lo, hi, warn) => {
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w, 6); g.fillStyle = warn ? '#ff7a3a' : '#d9b46a'; g.fillRect(x, y, w * clamp(frac), 6);
    for (let i = 0; i <= 4; i++) { g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(x + w * i / 4 - 0.5, y - 3, 1.5, 3); }
    g.fillStyle = '#9aa0ab'; g.font = `600 13px ${F}`; g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillText(lo, x - 14, y + 8); g.textAlign = 'right'; g.fillText(hi, x + w + 14, y + 8); g.textAlign = 'center';
  };
  let lastMap = '';
  function draw(st) {
    const kmh = Math.round(st.kmh || 0), W0 = st.warn || {}, wk = (W0.engine ? 1 : 0) | (W0.abs ? 2 : 0) | (W0.hand ? 4 : 0) | (W0.hazard ? 8 : 0) | (W0.fuel ? 16 : 0) | (W0.door ? 32 : 0) | (W0.temp ? 64 : 0);
    const key = [kmh, Math.round((st.rpm || 0) / 60), st.gear, st.gearNo, st.lights ? 1 : 0, st.left ? 1 : 0, st.right ? 1 : 0, st.limit || 0, st.disabled ? 1 : 0, Math.round((st.fuel ?? 0.7) * 50), Math.round((st.temp ?? 0.5) * 20), wk, st.night ? 1 : 0, st.odo != null ? Math.round(st.odo * 10) : ''].join('|');
    if (key !== lastKey) {
      lastKey = key;
      const g = CL.ctx, W = CL.cv.width, H = CL.cv.height; g.save(); g.scale(W / 736, H / 256);
      const bg = g.createLinearGradient(0, 0, 0, 256); bg.addColorStop(0, '#07090d'); bg.addColorStop(1, '#10141c'); g.fillStyle = bg; g.fillRect(0, 0, 736, 256);
      dial(g, 138, 126, 108, kmh / vDial, { max: vDial, step: 40, label: v => v, unit: (st.labels && st.labels.kmh) || 'km/h' });
      if (S.perf.eng === 'ev') dial(g, 598, 126, 108, (st.rpm || 0) / (st.redline || 16000), { max: 100, step: 20, label: v => v, unit: '% kW' });
      else { const red = st.redline || 7000, top = Math.ceil(red / 1000) + 1; dial(g, 598, 126, 108, (st.rpm || 0) / (top * 1000), { max: top, step: 1, label: v => v, red: red / (top * 1000), unit: '×1000 rpm' }); }
      // fuel (or battery) under the speedometer, coolant temperature under the rev counter
      bar(g, 86, 240, 104, st.fuel ?? 0.7, S.perf.eng === 'ev' ? '0' : 'E', S.perf.eng === 'ev' ? '100' : 'F', (st.fuel ?? 0.7) < 0.12);
      bar(g, 546, 240, 104, st.temp ?? 0.5, 'C', 'H', (st.temp ?? 0.5) > 0.85);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillStyle = '#f4f1e8'; g.font = `700 82px ${F}`; g.fillText(String(kmh), 368, 142);
      g.fillStyle = '#9aa0ab'; g.font = `600 19px ${F}`; g.fillText((st.labels && st.labels.kmh) || 'km/h', 368, 166);
      g.fillStyle = '#d9b46a'; g.font = `700 28px ${F}`; g.fillText(st.gear === 'D' && st.gearNo && S.perf.eng !== 'ev' ? 'D' + st.gearNo : (st.gear || 'P'), 368, 200);
      if (st.odo != null) { g.fillStyle = '#7d838d'; g.font = `600 14px ${F}`; g.fillText(st.odo.toFixed(1) + ' km', 368, 248); }
      // tell-tales: indicators, lights, the limit of the place
      const arrow = (x, dir, on) => { g.fillStyle = on ? '#39d353' : 'rgba(255,255,255,.1)'; g.beginPath(); g.moveTo(x + dir * 20, 36); g.lineTo(x, 18); g.lineTo(x, 29); g.lineTo(x - dir * 18, 29); g.lineTo(x - dir * 18, 43); g.lineTo(x, 43); g.lineTo(x, 54); g.closePath(); g.fill(); };
      arrow(300, -1, st.left); arrow(436, 1, st.right);
      g.fillStyle = st.lights ? '#4da3ff' : 'rgba(255,255,255,.1)'; g.beginPath(); g.arc(368, 36, 11, -Math.PI / 2, Math.PI / 2); g.closePath(); g.fill(); for (let i = -1; i <= 1; i++) g.fillRect(346, 34 + i * 8, 12, 3);
      if (st.limit) { g.fillStyle = '#f5f2ea'; g.beginPath(); g.arc(452, 190, 17, 0, 7); g.fill(); g.strokeStyle = '#c8231e'; g.lineWidth = 4.5; g.stroke(); g.fillStyle = '#111'; g.font = `700 17px ${F}`; g.textBaseline = 'middle'; g.fillText(String(st.limit), 452, 191); g.textBaseline = 'alphabetic'; }
      // warning lamps
      lamp(g, 262, 222, 'engine', '#ffb020', W0.engine || st.disabled); lamp(g, 300, 222, 'abs', '#ffb020', W0.abs); lamp(g, 336, 222, 'hand', '#ff3b30', W0.hand); lamp(g, 400, 222, 'hazard', '#ff3b30', W0.hazard);
      lamp(g, 434, 222, 'door', '#ff3b30', W0.door); lamp(g, 468, 222, 'temp', '#ff3b30', W0.temp); lamp(g, 228, 222, 'fuel', '#ffb020', W0.fuel);
      if (st.night) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, 736, 256); }      // instrument lighting dimmed for the dark
      g.restore(); CL.tex.needsUpdate = true;
    }
    const r = st.radio || {}, mp = st.map || null, skey = [r.on ? 1 : 0, r.name, r.freq, r.status, Math.round((r.volume || 0) * 20), r.muted ? 1 : 0, st.clock, st.car, st.night ? 1 : 0, st.msg || ''].join('|');
    const mkey = mp ? [Math.round(mp.x / 1.5), Math.round(mp.z / 1.5), Math.round(mp.yaw * 40), mp.roads ? mp.roads.length : 0, mp.rev || 0].join('|') : '';
    if (skey !== lastScr || mkey !== lastMap) {
      lastScr = skey; lastMap = mkey;
      const g = SC.ctx, W = SC.cv.width, H = SC.cv.height, L = st.labels || {}; g.save(); g.scale(W / 512, H / 272);
      const bg = g.createLinearGradient(0, 0, 512, 272); bg.addColorStop(0, '#0a0e16'); bg.addColorStop(1, '#141b28'); g.fillStyle = bg; g.fillRect(0, 0, 512, 272);
      // right half: the moving map, heading up
      const MX = 262, MW = 238, MY = 12, MH = 248, cx = MX + MW / 2, cy = MY + MH * 0.66;
      g.save(); g.beginPath(); g.rect(MX, MY, MW, MH); g.clip(); g.fillStyle = '#1b2430'; g.fillRect(MX, MY, MW, MH);
      if (mp) {
        const k = mp.scale || 0.95, c = Math.cos(mp.yaw), s2 = Math.sin(mp.yaw), tx = (X, Z) => [cx - ((X - mp.x) * c - (Z - mp.z) * s2) * k, cy - ((X - mp.x) * s2 + (Z - mp.z) * c) * k];
        g.lineCap = 'round'; g.lineJoin = 'round';
        for (const pass of [0, 1]) for (const rd of mp.roads || []) {
          const pts = rd.pts || rd, w = Math.max(2.4, (rd.w || 7) * k); g.strokeStyle = pass ? (rd.main ? '#f1e2b8' : '#c5cbd3') : '#0d1218'; g.lineWidth = pass ? w : w + 2.5;
          g.beginPath(); for (let i = 0; i < pts.length; i++) { const [u, v] = tx(pts[i][0], pts[i][1]); if (i) g.lineTo(u, v); else g.moveTo(u, v); } g.stroke();
        }
        for (const m of mp.marks || []) { const [u, v] = tx(m.x, m.z); g.fillStyle = m.col || '#d9b46a'; g.beginPath(); g.arc(u, v, m.r || 4, 0, 7); g.fill(); if (m.label) { g.fillStyle = '#f4f1e8'; g.font = `600 11px ${F}`; g.textAlign = 'center'; g.fillText(m.label, u, v - 7); } }
      }
      g.fillStyle = '#4da3ff'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy - 11); g.lineTo(cx + 8, cy + 8); g.lineTo(cx, cy + 3); g.lineTo(cx - 8, cy + 8); g.closePath(); g.fill(); g.stroke();
      g.restore(); g.strokeStyle = 'rgba(217,180,106,.5)'; g.lineWidth = 1.5; g.strokeRect(MX, MY, MW, MH);
      if (mp && mp.street) { g.fillStyle = 'rgba(8,10,14,.72)'; g.fillRect(MX, MY + MH - 26, MW, 26); g.fillStyle = '#f4f1e8'; g.font = `600 14px ${F}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(mp.street, cx, MY + MH - 8, MW - 12); }
      // left half: the radio
      const RX = 131;
      g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = '#9aa0ab'; g.font = `600 15px ${F}`; g.fillText(((L.radio || 'RADIO') + (r.on ? ' · FM' : '')).toUpperCase(), 14, 30);
      g.textAlign = 'right'; g.fillText(st.clock || '', 250, 30);
      g.fillStyle = '#d9b46a'; g.fillRect(14, 40, 236, 2);
      g.textAlign = 'center';
      if (st.msg) { g.fillStyle = '#ff7a59'; g.font = `600 17px ${F}`; g.fillText(st.msg, RX, 258, 236); }
      if (!r.on) { g.fillStyle = '#6f7682'; g.font = `600 21px ${F}`; g.fillText(L.off || 'Radio off', RX, 132, 236); }
      else {
        g.fillStyle = '#f4f1e8'; g.font = `700 30px ${F}`; const nm = String(r.name || ''), parts = nm.split(' · ');
        if (parts.length > 1 || g.measureText(nm).width > 236) { g.font = `700 24px ${F}`; g.fillText(parts[0], RX, 96, 236); g.fillStyle = '#c9ccd3'; g.font = `600 16px ${F}`; g.fillText(parts.slice(1).join(' · '), RX, 118, 236); } else g.fillText(nm, RX, 106, 236);
        g.fillStyle = '#d9b46a'; g.font = `600 21px ${F}`; g.fillText(r.freq || '', RX, 148);
        g.fillStyle = r.status === 'playing' ? '#39d353' : r.status === 'error' ? '#ff7a59' : '#9aa0ab'; g.font = `600 15px ${F}`;
        g.fillText(r.status === 'playing' ? '▶ ' + (L.live || 'LIVE') : r.status === 'error' ? (L.noSignal || 'No signal') : (L.connecting || 'Connecting…'), RX, 176, 236);
      }
      // volume bar + previous / next marks
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(56, 214, 150, 7); g.fillStyle = r.muted ? '#ff7a59' : '#d9b46a'; g.fillRect(56, 214, 150 * clamp(r.volume || 0), 7);
      g.fillStyle = '#e8e9ee'; g.font = `700 19px ${F}`; g.textAlign = 'left'; g.fillText('◀◀', 12, 225); g.textAlign = 'right'; g.fillText('▶▶', 250, 225);
      if (st.night) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, 0, 512, 272); }
      g.restore(); SC.tex.needsUpdate = true;
    }
  }
  draw({});
  // where the picture of the mirrors is taken from: behind the tail, at eye height, looking straight back (car frame → world by the caller)
  const mirrorPose = { pos: new THREE.Vector3(0, Math.min(S.eye, 1.25), S.zR - 0.15), fov: 38, aspect: 4 };
  return {
    group, draw, setWipers, mirrorPose, cluster: CL, screen: SC, mirrors,
    setMirrorMap(tex) { mirrorMat.map = tex || still; mirrorMat.color.set(tex ? '#e4e8ea' : '#d6dadd'); mirrorMat.needsUpdate = true; },
    dispose() { for (const o of own) o.dispose && o.dispose(); group.parent?.remove(group); },
  };
}

// ------------------------------------------------------------------ public: merged cars as instances (2 draw calls per model)
// list: [{x, y, z, yaw, pitch?, kind, colour}]. opts.tier 1 = mid model, 2 = far model (default).
export function createCarInstances(list, { shadows = false, tier = 2 } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-car-instances';
  const MS = shared(), byKind = {}, meshes = {}, hidden = new Set(), col = new THREE.Color();
  list.forEach((c, i) => (byKind[SPECS[c.kind] ? SPECS[c.kind].kind : 'sedan'] ||= []).push(i));
  for (const [kind, idx] of Object.entries(byKind)) {
    const G = buildCar(kind, tier === 1 ? 1 : 2);
    const p = new THREE.InstancedMesh(G.paint, tier === 1 ? MS.midPaint : MS.farPaint, idx.length), r = new THREE.InstancedMesh(G.rest, MS.rest, idx.length);
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
    group, list, setHidden(i, v) { if (v) hidden.add(i); else hidden.delete(i); }, update,
    dispose() { for (const { p, r } of Object.values(meshes)) { p.dispose(); r.dispose(); } group.parent?.remove(group); },
  };
}
/** Geometry + materials of a merged tier, for hosts that manage their own instanced meshes (the fleet). */
export function carTier(kind, tier) { const G = buildCar(kind, tier), MS = shared(); return { paint: G.paint, rest: G.rest, paintMat: tier === 1 ? MS.midPaint : MS.farPaint, restMat: MS.rest, spec: G.spec }; }
/** A single-material, x-forward geometry (vertex colours) for foreign instanced car meshes (environment traffic). */
export function carGeometryXForward(kind = 'sedan') {
  const G = buildCar(kind, 2);
  const p = G.paint.clone(); strip(p, ['position', 'normal']); attr(p, 'color', 3, [1, 1, 1]);
  const r = G.rest.clone(); r.deleteAttribute('mr');
  const g = mergeGeometries([p.index ? p.toNonIndexed() : p, r], false); p.dispose(); r.dispose();
  g.rotateY(Math.PI / 2); g.computeBoundingSphere(); return g;
}
/** Triangle / draw-call numbers of a design per tier (for the notes and the tests). */
export function carStats(kind) {
  const tri = g => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
  const d = buildCar(kind, 0), I = d.interiorFor(INTERIORS[0]);
  const t0 = tri(d.paint) + tri(d.glass) + tri(d.trim) + tri(d.lights) + tri(d.headliner) + tri(I.main) + tri(I.door) + tri(d.steering) + 4 * tri(d.wheel) + (d.door ? tri(d.door.paint) + tri(d.door.glass) + tri(d.door.trim) : 0) + 4;
  const m = buildCar(kind, 1), f = buildCar(kind, 2);
  return { kind, name: d.spec.name, detail: Math.round(t0), mid: tri(m.paint) + tri(m.rest), far: tri(f.paint) + tri(f.rest) };
}
