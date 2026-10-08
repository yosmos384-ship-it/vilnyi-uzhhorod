// ЖК VILNYI (Ужгород) — cars on the site: the drivable fleet, the vehicle physics, the parked cars of the car park and of
// the streets, the moving traffic, the outdoor colliders and the drive area.
// The cars themselves (eight original luxury designs, three detail tiers, materials) are in car-models.js.
// Car frame: +z forward, +y up, driver on the left (+x), origin on the ground midway between the axles.
// Heading `yaw`: forward = (sin yaw, cos yaw) in world (x, z).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS, B_IDS, CONTEXT_BLOCKS, PODIUM, RAMPS, PLOT, SITE_CENTER, STREETS, COURTYARD, SITE_EXTRAS, footprintOf, coresOf, localToWorld } from '../data.js';
import { CAR_KINDS, CAR_NAMES, CAR_COLOURS, COLOUR_NAMES, INTERIORS, PLATES, PANEL_NAMES, carSpec, pickCar, rng, hashStr, createCar, createCockpit, carPanels, plateText, createCarInstances, carTier, carGeometryXForward, carStats, carMaterials } from './car-models.js';
export { CAR_KINDS, CAR_NAMES, CAR_COLOURS, COLOUR_NAMES, PANEL_NAMES, carSpec, pickCar, createCar, createCockpit, carPanels, plateText, createCarInstances, carGeometryXForward, carStats, carMaterials, rng as carRng };
void BUILDINGS;

// Optional data of site-layout.js (another task's module): the guest parking pockets, trees and lamp posts around the
// plot. Everything here works without it; the streets always come from data.js STREETS.
let LAYOUT = null;
try { LAYOUT = await import('./site-layout.js'); } catch (e) { LAYOUT = null; }
const parkingPockets = () => (LAYOUT && Array.isArray(LAYOUT.PARKING_POCKETS) ? LAYOUT.PARKING_POCKETS : []);

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const strip = (g, keep) => { for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k); return g; };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);

// ------------------------------------------------------------------ vehicle physics (arcade-realistic)
// One rigid car on a bicycle model.
//  · drive: traction-limited at launch (perf.acc, m/s²), then constant power (perf.pw, W/kg): a = min(acc, pw / v);
//    rolling + aerodynamic drag k·v² with k chosen so that drive and drag balance a little above the design's top speed
//    (perf.vmax, km/h), where a limiter holds the car — so the last km/h do not take for ever;
//  · brakes perf.brake (m/s²), engine braking off the throttle, the pull of a slope;
//  · steering: lock shrinking with speed, rate-limited, self-centring; cornering limited by grip (perf.grip m/s², more with
//    downforce perf.df at speed, less while braking or accelerating hard — the friction circle); beyond it the car understeers
//    and scrubs speed; body roll, squat and dive as a visual response;
//  · the move of one step is cut into pieces of at most SUB_STEP metres, each tested against the world, so that nothing is
//    tunnelled through at 300 km/h (83 m/s) whatever the frame rate;
//  · a rev counter model: gears by speed, rpm within the gear (for the instruments and the engine sound).
// world: { ground(x, y, z) → y | null, blocked(car, x, z, yaw, y) → bool (may fill car.contact = {point, normal, other}),
//          limit(x, y, z) → m/s (limiter of the place), drivable(x, z) → bool }
// input: { gas 0…1, brake 0…1, steer −1…1 (left +), gear?: 'D' | 'R', auto?: bool }
//   auto (keyboard): holding the brake at a standstill selects reverse and the brake key then drives backwards.
export const SUB_STEP = 0.3;
const REDLINE = { v12: 7000, v10: 8600, v8: 6800, i4: 6500, ev: 16000 };
const GEAR_TOPS = [0.15, 0.26, 0.39, 0.54, 0.7, 0.87, 1.1];   // top of each gear as a fraction of the top speed
const maxSteerOf = (P, sp) => P.lock / (1 + (sp / 9.5) ** 2);
export class CarController {
  constructor(rec) {
    this.rec = rec; this.S = carSpec(rec.kind); this.perf = this.S.perf;
    this.x = rec.x; this.y = rec.y; this.z = rec.z; this.yaw = rec.yaw;
    this.v = 0; this.steer = 0; this.pitch = rec.pitch || 0; this.roll = 0; this.spin = 0; this.bump = 0;
    this.braking = false; this.reversing = false; this.gear = 'D'; this.hit = 0; this.aLong = 0; this.aLat = 0; this.dive = 0; this.slip = 0;
    this.passive = false;     // true: nobody drives it — a parked car shoved by a crash (slides to rest against its brakes)
    this.rpm = 800; this.gearNo = 1; this.squeal = 0; this.disabled = !!rec.disabled; this.contact = null; this.impact = null; this.yawKick = 0;
    this._hold = 0; this._autoR = false;
    this.beta = 0;            // body slip angle (rad): yaw − course; ≠ 0 while the tail slides
    this.abs = false;         // the brakes are at the limit (pedal pulsing, tell-tale)
    this.hand = false;        // handbrake on
    this.mod = { power: 1, top: 1, pull: 0, grip: 1, drag: 0, cut: 0 };   // set by the damage model: less power / top speed / grip, a steering pull (rad), extra drag (m/s²), engine cutting out 0…1
    this._cutT = 0; this._cut = false;
  }
  /** top speed (m/s) and the drag coefficient that goes with it */
  get top() { return this.perf.vmax / 3.6; }
  step(dt, inp, world) {
    if (!(dt > 0)) return this;
    dt = Math.min(dt, 0.05);
    const S = this.S, P = this.perf, v = this.v, M = this.mod, top = P.vmax / 3.6 * M.top;
    const cap = Math.min(world.limit(this.x, this.y, this.z), top);
    let gas = this.passive ? 0 : clamp(+inp.gas || 0), brk = this.passive ? 0 : clamp(+inp.brake || 0); const hand = this.passive ? 1 : clamp(+inp.hand || 0); this.hand = hand > 0;
    // a badly hurt engine cuts out for a moment now and then
    if (M.cut > 0) { this._cutT -= dt; if (this._cutT <= 0) { this._cut = !this._cut && Math.random() < M.cut; this._cutT = this._cut ? 0.25 + Math.random() * 0.5 : 0.4 + Math.random() * 1.6; } } else this._cut = false;
    if (inp.gear === 'D' || inp.gear === 'R') { if (this.gear !== inp.gear && Math.abs(v) < 0.6) { this.gear = inp.gear; this._autoR = false; } }
    // keyboard convenience: brake held at rest → reverse while it stays held; any throttle → forward again
    if (inp.auto) {
      if (this.gear === 'D' && !this._autoR) { if (brk > 0 && !gas && Math.abs(v) < 0.25) { this._hold += dt; if (this._hold > 0.3) this._autoR = true; } else this._hold = 0; }
      else if (this._autoR && gas > 0 && v > -0.3) { this._autoR = false; this._hold = 0; }
    } else this._autoR = false;
    let dir = this.gear === 'R' ? -1 : 1, thr = gas, bk = brk;
    if (this._autoR) { dir = -1; thr = brk; bk = gas; }
    this.reversing = dir < 0;
    // longitudinal
    const vf = v * dir, sp0 = Math.abs(v), vmax = dir > 0 ? cap : Math.min(cap, 9);
    const pw = (P.pw || P.acc * 40) * M.power * (this._cut ? 0.05 : 1), veq = P.vmax / 3.6 * 1.2, kd = Math.max(0, (pw / veq - 0.15) / (veq * veq));
    let a = 0, aCmd = 0;
    if (thr > 0 && !this.disabled) {
      if (vf < -0.3) aCmd = P.brake * thr;                                   // rolling the wrong way: the throttle brakes first
      else aCmd = thr * Math.min(P.acc * (this._cut ? 0.1 : 1) * (0.62 + 0.38 * clamp(vf / 3 + 0.3)), pw / Math.max(vf, 1)) * (dir > 0 ? 1 : 0.5);
      a += dir * aCmd;
    }
    this.braking = bk > 0 || (thr > 0 && vf < -0.3);
    if (bk > 0 && sp0 > 0.02) { a -= Math.sign(v) * P.brake * bk; aCmd = Math.max(aCmd, P.brake * bk); }
    if (hand > 0 && sp0 > 0.02) { a -= Math.sign(v) * (P.brake * 0.42 * hand + (this.passive ? 4.5 * Math.abs(Math.sin(this.beta)) : 0)); }                                     // the handbrake works on the rear wheels only
    this.abs = bk > 0.9 && sp0 > 4;
    a -= Math.sign(v) * (0.15 + M.drag + kd * v * v + (thr || bk ? 0 : 0.45 + 0.004 * sp0));   // rolling + air drag (+ engine braking off the throttle)
    const moving = sp0 > 0.05 || thr > 0;
    if (moving) a -= 9.81 * Math.sin(this.pitch) * 0.6;                    // slope (pitch > 0 = nose up)
    let nv = v + a * dt;
    if ((v > 0 && nv < 0 && !(thr > 0 && dir < 0)) || (v < 0 && nv > 0 && !(thr > 0 && dir > 0))) nv = 0;   // brakes and drag stop the car, they do not reverse it
    if (!thr && Math.abs(nv) < 0.04 && Math.abs(Math.sin(this.pitch)) < 0.03) nv = 0;
    if (!thr && (bk > 0 || hand > 0) && Math.abs(nv) < 0.15) nv = 0;                      // held on the brake (also on a ramp)
    if (nv * dir > vmax) nv = dir * Math.max(vmax, Math.abs(v) - 5 * dt);  // the limiter (of the car, or of the place)
    nv = clamp(nv, -12, 96);
    // steering: lock shrinks with speed; the wheel is turned at a finite rate and centres itself faster
    const sp = Math.abs(nv), maxSteer = P.lock / (1 + (sp / 9.5) ** 2), target = clamp((this.passive ? 0 : +inp.steer || 0) + (sp > 1.5 && !this.passive ? M.pull / Math.max(0.2, maxSteerOf(P, sp)) : 0), -1, 1) * maxSteer;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 3.4 : 2.2 + 1.2 / (1 + sp * 0.2)) * dt;
    this.steer += clamp(target - this.steer, -rate, rate);
    let yawRate = nv * Math.tan(this.steer) / S.wb, aLat = nv * yawRate;
    // grip: more with downforce at speed, less while the tyres are busy braking or putting the power down (friction circle)
    const gripAll = P.grip * M.grip * (1 + (P.df || 0) * (sp / 80) ** 2), grip = gripAll * Math.sqrt(Math.max(0.3, 1 - (aCmd / (P.brake * 1.25)) ** 2));
    // the rear axle: locked by the handbrake, or spun up by a lot of power in a low gear, it grips far less → the tail steps out
    const powerOver = thr > 0.9 && dir > 0 && !this.disabled && P.acc > 6.8 && vf > 2 && vf < 26 && Math.abs(this.steer) > 0.08 ? 0.72 : 1;
    const gripR = gripAll * (hand > 0 ? 0.3 : 1) * powerOver;
    this.slip = 0;
    if (Math.abs(aLat) > grip) { const k = grip / Math.abs(aLat); this.slip = 1 - k; yawRate *= k; aLat *= k; nv -= Math.sign(nv) * this.slip * 3 * dt; }   // understeer + scrub
    // slide of the tail: the body turns further than the course (beta grows); with grip back it is caught again, quicker with opposite lock
    let beta = this.beta;
    if (this.passive) { /* a car shoved by another one slides the way it was pushed: beta is kept */ }
    else if (nv > 3) {
      const need = Math.abs(aLat) + (hand > 0 ? Math.abs(Math.tan(this.steer)) * nv * nv / S.wb * 0.6 : 0), over = need - gripR;
      if (over > 0 && Math.abs(this.steer) > 0.01) beta += Math.sign(this.steer) * Math.min(2.2, over / Math.max(nv, 4) * 1.5 + (hand > 0 ? 0.5 : 0.15)) * dt;
      else { const counter = Math.sign(this.steer) === -Math.sign(beta) ? Math.abs(this.steer) * 6 : 0; beta -= beta * Math.min(1, (1.8 + counter + gripR * 0.12) * dt); }
      beta = clamp(beta, -1.15, 1.15);
      if (Math.abs(beta) > 0.02) { nv -= Math.sign(nv) * Math.abs(Math.sin(beta)) * gripAll * 0.55 * dt; this.slip = Math.max(this.slip, Math.min(1, Math.abs(beta) * 1.6)); }
    } else beta *= Math.exp(-dt * 8);
    if (Math.abs(beta) < 1e-4) beta = 0;
    const dBeta = beta - this.beta; this.beta = beta;
    if (this.yawKick) { yawRate += this.yawKick; this.yawKick *= Math.exp(-dt * 4); if (Math.abs(this.yawKick) < 0.01) this.yawKick = 0; }
    this.squeal = clamp(Math.max(this.slip * 2.2 * clamp((sp - 4) / 6), bk > 0.85 && sp > 7 ? 0.55 + 0.45 * clamp(sp / 40) : 0, hand > 0 && sp > 5 ? 0.8 : 0, thr > 0.9 && vf >= 0 && vf < 6 && P.acc > 6.5 && !this.disabled && dir > 0 ? 0.5 : 0));
    // move, in pieces of at most SUB_STEP metres
    const d = clamp(nv * dt, -SUB_STEP * 28, SUB_STEP * 28), nSub = Math.max(1, Math.ceil(Math.abs(d) / SUB_STEP)), dd = d / nSub, dy = (yawRate * dt + dBeta) / nSub, sdt = dt / nSub;
    const hw = S.wb / 2, gnd = (px, pz) => (world.drivable(px, pz) ? world.ground(px, this.y, pz) : null);
    const tryMove = (yw, dist) => {
      // the body points along yw; the car travels along its course (yw − beta)
      const fx = Math.sin(yw), fz = Math.cos(yw), cx = beta ? Math.sin(yw - beta) : fx, cz = beta ? Math.cos(yw - beta) : fz, nx = this.x + cx * dist, nz = this.z + cz * dist;
      const yF = gnd(nx + fx * hw, nz + fz * hw), yR = gnd(nx - fx * hw, nz - fz * hw);
      if (yF == null || yR == null || Math.abs(yF - this.y) > 0.55 || Math.abs(yR - this.y) > 0.55) { this.contact = { point: [nx + fx * hw * Math.sign(dist || 1), this.y, nz + fz * hw * Math.sign(dist || 1)], normal: [-fx * Math.sign(dist || 1), -fz * Math.sign(dist || 1)], other: 'kerb' }; return null; }
      this.contact = null;
      if (world.blocked(this, nx, nz, yw, (yF + yR) / 2)) { if (!this.contact) this.contact = { point: [nx, this.y + 0.5, nz], normal: [-fx * Math.sign(dist || 1), -fz * Math.sign(dist || 1)], other: null }; return null; }
      return { nx, nz, yF, yR, yw };
    };
    const apply = mv => {
      this.x = mv.nx; this.z = mv.nz; this.yaw = mv.yw;
      const ty = (mv.yF + mv.yR) / 2; this.y += (ty - this.y) * clamp(sdt * 20 + Math.abs(dd) * 0.8);
      const tp = Math.atan2(mv.yF - mv.yR, S.wb); this.pitch += (tp - this.pitch) * clamp(sdt * 12 + Math.abs(dd) * 0.5);
    };
    for (let i = 0; i < nSub; i++) {
      let mv = tryMove(this.yaw + dy, dd);
      if (mv) { apply(mv); continue; }
      if (Math.abs(dd) < 1e-6) break;
      const hitV = Math.abs(nv), con = this.contact;
      // glancing contact: slide along the obstacle (deflect the heading a little, lose speed); head-on: stop with a small rebound
      const s0 = Math.sign(this.steer) || 1;
      for (const da of [0.05 * s0, -0.05 * s0, 0.11 * s0, -0.11 * s0]) {
        mv = tryMove(this.yaw + da * Math.sign(nv || 1), dd * 0.8);
        if (mv) { const loss = clamp(3.2 * sdt + Math.abs(da) * (0.6 + sp * 0.02)); nv *= 1 - loss; this.hit = Math.max(this.hit, hitV * (0.2 + loss)); this._impact(hitV * (0.15 + loss), con, false, hitV); apply(mv); break; }
      }
      if (mv) { if (Math.abs(nv) < 0.3) break; continue; }
      const turn = tryMove(this.yaw + dy, 0); if (turn) this.yaw += dy;
      if (!this.passive) this.beta = beta = 0;
      this.hit = Math.max(this.hit, hitV); this.bump = Math.min(0.05, hitV * 0.012);
      this._impact(hitV, con, true, hitV);
      nv = -Math.sign(nv) * Math.min(1.4, hitV * 0.1); if (Math.abs(nv) < 0.12) nv = 0;
      break;
    }
    this.aLong = (nv - v) / dt; this.aLat = aLat; this.v = nv;
    // body response (visual): roll out of the corner, squat / dive
    this.roll += (clamp(-aLat / 9 * P.roll * 1.6, -0.09, 0.09) - this.roll) * clamp(dt * 5);
    this.dive += (clamp(-this.aLong / 9 * P.pitch * 1.5, -0.05, 0.05) - this.dive) * clamp(dt * 5);
    this.spin += this.v / S.R * dt;
    this.bump *= Math.exp(-dt * 8);
    // rev counter: gear by speed, revs within the gear; at rest the throttle revs the engine a little
    const red = REDLINE[P.eng] || 6800, idle = P.eng === 'ev' ? 0 : 780, u = Math.abs(this.v) / top;
    let rt;
    if (P.eng === 'ev') { this.gearNo = 1; rt = u * red; }
    else {
      let g = this.gearNo - 1; const lo = k => (k > 0 ? GEAR_TOPS[k - 1] : 0);
      while (g < GEAR_TOPS.length - 1 && u > GEAR_TOPS[g] * 0.97) g++;
      while (g > 0 && u < lo(g) * 0.8) g--;
      this.gearNo = g + 1;
      rt = this.reversing ? idle + clamp(u / 0.11) * (red - idle) * 0.6 : idle + clamp((u - lo(g) * 0.45) / (GEAR_TOPS[g] - lo(g) * 0.45)) * (red * 0.96 - idle);
      if (Math.abs(this.v) < 0.5 && thr > 0 && this.disabled) rt = idle;
      rt += thr * 350;
    }
    this.rpm += (rt - this.rpm) * clamp(dt * (rt > this.rpm ? 7 : 4.5));
    if (!Number.isFinite(this.x + this.y + this.z + this.yaw + this.v)) { this.x = this.rec.x; this.y = this.rec.y; this.z = this.rec.z; this.yaw = this.rec.yaw; this.v = 0; this.steer = 0; this.pitch = 0; }
    return this;
  }
  // remembers the hardest contact of this step: { speed (m/s lost against the obstacle), hard, point, normal, other }
  _impact(speed, con, hard, before = speed) {
    if (this.impact && this.impact.speed >= speed) return;
    this.impact = { speed, hard, before, dir: Math.sign(this.v) || 1, course: this.yaw - this.beta, point: con ? con.point : [this.x, this.y + 0.5, this.z], normal: con ? con.normal : [-Math.sin(this.yaw), -Math.cos(this.yaw)], other: con ? con.other : null };
  }
  /** A push from outside (another car, an explosion…): world velocity change [vx, vz] in m/s. */
  addImpulse(vx, vz) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.v = clamp(this.v + vx * fx + vz * fz, -12, 96); this.yawKick = clamp(this.yawKick + (vx * fz - vz * fx) * 0.12, -1.5, 1.5);
  }
  get speed() { return this.v; }
  /** D / R / P as shown on the dashboard. */
  get gearShown() { return this.reversing ? 'R' : Math.abs(this.v) < 0.05 ? 'P' : 'D'; }
  get redline() { return REDLINE[this.perf.eng] || 6800; }
}

// footprint corners of a car (world x, z), `m` metres bigger all round
export function carCorners(kind, x, z, yaw, m = 0) {
  const S = carSpec(kind), c = Math.cos(yaw), s = Math.sin(yaw);
  return [[S.W / 2 + m, S.zF + m], [-S.W / 2 - m, S.zF + m], [-S.W / 2 - m, S.zR - m], [S.W / 2 + m, S.zR - m]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
}
// do two convex quads overlap? (separating axes)
export function quadsOverlap(A, B) {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const nx = P[(i + 1) % 4][1] - P[i][1], nz = P[i][0] - P[(i + 1) % 4][0];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of A) { const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, z] of B) { const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// ------------------------------------------------------------------ site geometry helpers (world x, z)
const inPoly2 = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
const polyArea = P => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return a / 2; };
const polyDist = (P, x, z) => { let d = Infinity; for (let i = 0, j = P.length - 1; i < P.length; j = i++) d = Math.min(d, segDist(x, z, P[j][0], P[j][1], P[i][0], P[i][1])); return d; };
const nearestOnPoly = (P, x, z) => {   // closest point of the outline → [qx, qz, distance]
  let best = [x, z, Infinity];
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ax = P[j][0], az = P[j][1], dx = P[i][0] - ax, dz = P[i][1] - az, L = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L);
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz); if (d < best[2]) best = [qx, qz, d];
  }
  return best;
};
const bboxOfPoly = P => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const isRectPoly = P => P.length === 4 && P.every((p, i) => { const q = P[(i + 1) % 4]; return Math.abs(p[0] - q[0]) < 0.35 || Math.abs(p[1] - q[1]) < 0.35; });
// first-floor outline of a tower in world coordinates (rotation-safe: through localToWorld)
const towerOutline = id => footprintOf(id, 1).map(([x, z]) => localToWorld(id, x, z));
// lobby entrances of the towers (world): the only openings in the street-level shells; shop entrances stay closed
function towerEntrances() {
  const out = [];
  for (const id of B_IDS) for (const c of coresOf(id, 1)) {
    if (!c || !c.entrance) continue;
    const p = localToWorld(id, c.entrance[0], c.entrance[1]), n = c.entranceNormal || [0, 1];
    const q = localToWorld(id, c.entrance[0] + n[0], c.entrance[1] + n[1]);
    out.push({ id, p, n: [q[0] - p[0], q[1] - p[1]] });
  }
  return out;
}

// ------------------------------------------------------------------ neighbours: heights, styles, the fuel-station canopy
// One classification for context.js (what is drawn) and for the colliders below (what stops a car).
export function contextStyle(b) {
  const f = Math.max(1, b.floors || 1), k = b.kind;
  if (k === 'canopy') return 'canopy';
  if (k === 'fuel' || k === 'commercial' || k === 'pavilion') return 'shop';
  if (k === 'utility') return 'plain';
  if (k === 'residential' && f >= 7) return 'panel';     // 9-storey panel slabs
  if (k === 'residential' && f >= 3) return 'brick';     // 5-storey silicate-brick slabs
  return 'plaster';                                      // private houses, 1–2 storey buildings, ruins, unknown OSM outlines
}
/** Height (m) of the walls of a context block — eaves or parapet top; pitched roofs rise above it. */
export function contextHeight(b) {
  const f = Math.max(1, b.floors || 1);
  switch (contextStyle(b)) {
    case 'canopy': return 5.4;
    case 'shop': return (b.kind === 'pavilion' ? 3.0 : b.kind === 'fuel' ? 4.2 : 4.0) + (f - 1) * 3.3;
    case 'plain': return 3.0 * f;
    case 'panel': case 'brick': return 0.9 + f * 2.8 + 0.5;
    default: return b.kind === 'ruin' ? 3.6 * f : 0.4 + f * 3.0;
  }
}
/** Fuel-station canopy layout from its outline: pump islands along the long axis, a column on each, two cars filling up. */
export function canopyLayout(b) {
  const P = b.poly || [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
  let L = 0, ux = 1, uz = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const dx = P[i][0] - P[j][0], dz = P[i][1] - P[j][1], l = Math.hypot(dx, dz); if (l > L) { L = l; ux = dx / l; uz = dz / l; } }
  const vx = -uz, vz = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of P) { const u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const vm = (v0 + v1) / 2, n = Math.max(1, Math.min(4, Math.floor((u1 - u0 - 5) / 6.5) + 1)), islands = [], cars = [];
  const W = (u, v) => [u * ux + v * vx, u * uz + v * vz], yaw = Math.atan2(ux, uz);
  for (let i = 0; i < n; i++) {
    const u = (u0 + u1) / 2 + (i - (n - 1) / 2) * 6.5, [x, z] = W(u, vm);
    if (!inPoly2(P, x, z)) continue;
    islands.push({ x, z, yaw, a: W(u - 1.7, vm), b: W(u + 1.7, vm) });
    for (const s of [-1, 1]) { const [cx, cz] = W(u, vm + s * 2.35); if (inPoly2(P, cx, cz)) cars.push({ x: cx, z: cz, yaw: s > 0 ? yaw : yaw + Math.PI }); }
  }
  return { islands, cars, axis: [ux, uz], clear: 4.6, top: contextHeight(b), poly: P };
}

// ------------------------------------------------------------------ ramps of the underground car park
// One description for both shapes of the data: the car-park drawing's ramps (RAMPS[].centerline — 3D points from the
// car-park floor up to the street — with `width`), or the older rectangle (axis / top / y0 / y1).
// → { R, id, pts: [[x, y, z], …] from the TOP down to the foot, hw, y0, y1, open: index of the last point of the open
//     (unroofed) part, app: the level approach point in front of the portal, hole / cut rectangles, dirTop: unit (x, z)
//     pointing out of the ramp at its top }
const RAMP_CLEAR = 2.7;      // the deck closes over the ramp once a car fits under it
const RAMP_APPROACH = 3.2;   // level stretch in front of the portal
const RAMP_CACHE = new WeakMap();
export function rampModel(R) {
  const hit = RAMP_CACHE.get(R); if (hit) return hit;
  let pts, hw;
  if (Array.isArray(R.centerline) && R.centerline.length > 1) {
    pts = R.centerline.map(p => [p[0], p[1], p[2]]); if (pts[0][1] < pts[pts.length - 1][1]) pts.reverse();
    hw = (R.width || (R.lanes || 2) * (R.laneW || 2.8) + 1.5) / 2;
  } else {
    const ax = R.axis === 'x', a0 = ax ? R.x0 : R.z0, a1 = ax ? R.x1 : R.z1, c = ax ? (R.z0 + R.z1) / 2 : (R.x0 + R.x1) / 2;
    const topA = R.top === 'max' ? a1 : a0, botA = R.top === 'max' ? a0 : a1, y0 = R.y0 ?? 0, y1 = R.y1 ?? -4.2;
    const P = (a, y) => (ax ? [a, y, c] : [c, y, a]);
    pts = [P(topA, y0), P(botA, y1)]; hw = (ax ? R.z1 - R.z0 : R.x1 - R.x0) / 2;
  }
  // densify so that a curved or broken profile is followed closely
  const dense = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.ceil(L / 1.5)); for (let k = 1; k <= n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, a[2] + (b[2] - a[2]) * k / n]); }
  pts = dense;
  const y0 = pts[0][1], y1 = pts[pts.length - 1][1];
  let dx = pts[0][0] - pts[1][0], dz = pts[0][2] - pts[1][2]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  let open = 1; while (open < pts.length - 1 && pts[open][1] > y0 - RAMP_CLEAR) open++;
  if (R.enclosedTo != null && (R.axis === 'x' || R.axis === 'z')) { const k = R.axis === 'x' ? 0 : 2, dirA = Math.sign(pts[pts.length - 1][k] - pts[0][k]) || 1; open = 1; while (open < pts.length - 1 && (pts[open][k] - R.enclosedTo) * dirA < 0) open++; }   // the drawing says where the roof starts
  const app = [pts[0][0] + dx * RAMP_APPROACH, 0, pts[0][2] + dz * RAMP_APPROACH];
  // left / right edge points of the slab at point i
  const edge = i => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let tx = b[0] - a[0], tz = b[2] - a[2]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return [[pts[i][0] - tz * hw, pts[i][2] + tx * hw], [pts[i][0] + tz * hw, pts[i][2] - tx * hw]]; };
  const box = (list, m = 0) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of list) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m }; };
  const openPts = []; for (let i = 0; i <= open; i++) openPts.push(...edge(i));
  const appE = [[app[0] - dz * hw, app[2] + dx * hw], [app[0] + dz * hw, app[2] - dx * hw]];
  const res = { R, id: R.id, pts, hw, y0, y1, open, app, edge, dirTop: [dx, dz], hole: box(openPts), cut: box([...openPts, ...appE]), all: box(pts.flatMap((_, i) => edge(i))) };
  RAMP_CACHE.set(R, res); return res;
}
/** Height of the ramp surface under (x, z), or null when the point is not on a ramp (within `m` of its slab). */
export function rampY(x, z, m = 0) {
  for (const R of RAMPS) {
    const r = rampModel(R);
    if (x < r.all.x0 - m - 4 || x > r.all.x1 + m + 4 || z < r.all.z0 - m - 4 || z > r.all.z1 + m + 4) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1], ux = b[0] - a[0], uz = b[2] - a[2], L2 = ux * ux + uz * uz || 1, t = ((x - a[0]) * ux + (z - a[2]) * uz) / L2;
      if (t < -0.02 || t > 1.02) continue;
      const d = Math.abs((x - a[0]) * uz - (z - a[2]) * ux) / Math.sqrt(L2); if (d <= r.hw + m) return a[1] + (b[1] - a[1]) * clamp(t);
    }
  }
  return null;
}
export const RAMP = RAMPS[0] || null;   // LEGACY (walk.js): the first ramp; new code uses RAMPS
export { RAMPS };
export const SPIRAL_DRUM = null;        // there is no spiral ramp

/** How far the street data reaches from the site centre (m) — read at run time, the city model grows between versions. */
export function streetExtent(roads = STREETS, center = SITE_CENTER, { min = 330, max = 2600 } = {}) {
  let r = 0; for (const st of roads || []) for (const p of st.pts || []) r = Math.max(r, Math.hypot(p[0] - center[0], p[1] - center[1]));
  return Math.max(min, Math.min(max, r));
}

// ------------------------------------------------------------------ outdoor colliders (for walking & driving outside)
// Built from data.js: the four towers (thin shells along the floor-1 outline, any angle, with a gap at each lobby entrance
// and where a car-park ramp passes through the facade), the podium volumes (same, shop entrances closed), the plot's
// free-standing structures, the ramps (inclined floor, side walls, approach), the neighbours, plus a big walkable /
// drivable ground plane with a hole over the open part of every ramp. There is no fence around the plot.
// → { group, walls, gaps, holes, dispose() }; walls / gaps / holes describe what was built (debug drawings, tests).
export function buildOutdoorColliders({ extraBoxes = [], extraOnly = false, blocks = CONTEXT_BLOCKS } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-outdoor-colliders';
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  const solids = [], floors = [], walls = [], gaps = [], holes = [];
  const box = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); solids.push(g); };
  // thin oriented box a → b
  const wall = (a, b, y0, y1, t, meta) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.03 || y1 - y0 < 0.03) return;
    const g = new THREE.BoxGeometry(L, y1 - y0, t); g.rotateY(Math.atan2(-dz, dx)); g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2); solids.push(g);
    walls.push({ ...meta, a: [a[0], a[1]], b: [b[0], b[1]], y0, y1, t });
  };
  // closed outline as walls of thickness t just inside it; `discs` [[x, z, r]] and `rects` [{x0, x1, z0, z1}] stay open
  const outline = (P, y0, y1, t, meta, discs = [], rects = []) => {
    const sgn = polyArea(P) > 0 ? 1 : -1;
    for (let i = 0; i < P.length; i++) {
      const A = P[i], B = P[(i + 1) % P.length], dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz); if (L < 1e-6) continue;
      const tx = dx / L, tz = dz / L, nx = -tz * sgn, nz = tx * sgn;                      // inward normal
      const open = [];
      for (const [cx, cz, r] of discs) {                                                 // segment ∩ disc
        const s = (cx - A[0]) * tx + (cz - A[1]) * tz, d = Math.abs((cx - A[0]) * nx + (cz - A[1]) * nz); if (d >= r) continue;
        const h = Math.sqrt(r * r - d * d); if (s + h > 0 && s - h < L) open.push([s - h, s + h]);
      }
      for (const r of rects) {                                                           // segment ∩ rect (Liang–Barsky)
        let s0 = 0, s1 = L, ok = true;
        for (const [p, q] of [[-tx, A[0] - r.x0], [tx, r.x1 - A[0]], [-tz, A[1] - r.z0], [tz, r.z1 - A[1]]]) {
          if (Math.abs(p) < 1e-9) { if (q < 0) { ok = false; break; } continue; }
          const s = q / p; if (p < 0) s0 = Math.max(s0, s); else s1 = Math.min(s1, s);
        }
        if (ok && s1 - s0 > 0.02) open.push([s0, s1]);
      }
      open.sort((p, q) => p[0] - q[0]);
      const P2 = s => [A[0] + tx * s + nx * t / 2, A[1] + tz * s + nz * t / 2];
      let cur = 0;
      for (const [g0, g1] of open) { if (g0 > cur) wall(P2(cur), P2(Math.min(L, g0)), y0, y1, t, meta); cur = Math.max(cur, g1); }
      if (cur < L) wall(P2(cur), P2(L), y0, y1, t, meta);
    }
  };
  const ramps = RAMPS.map(rampModel);
  if (!extraOnly) {
    const ent = towerEntrances(), cuts = ramps.map(r => r.cut);
    const discsFor = (P, tol, on) => {
      const out = [];
      for (const e of ent) { const [qx, qz, d] = nearestOnPoly(P, e.p[0], e.p[1]); if (d < tol) { out.push([qx, qz, 1.0]); gaps.push({ id: e.id, on, p: [qx, qz], w: 2.0, n: e.n }); } }
      return out;
    };
    // towers: floor-1 outline, 0.3 m shells 0–4 m high, ±1.0 m open at the lobby entrance
    const towers = B_IDS.map(id => ({ id, P: towerOutline(id) }));
    for (const { id, P } of towers) outline(P, 0, 4, 0.3, { kind: 'tower', id }, discsFor(P, 0.6, id), cuts);
    // podium volumes: walls along every edge up to y1; open only where a tower lobby opens through the podium wall
    for (const p of PODIUM) if (p.poly && p.poly.length > 2) outline(p.poly, p.y0 ?? 0, p.y1 ?? 4, 0.3, { kind: 'podium', id: p.id }, discsFor(p.poly, 0.9, p.id), cuts);
    // free-standing structures on the plot (transformer …); an open gazebo keeps only its posts; paving (h 0) is skipped
    for (const e of SITE_EXTRAS || []) {
      if (!e.poly || !(e.h > 0.2)) continue;
      if (e.kind === 'gazebo' || e.kind === 'pergola') { for (const [x, z] of e.poly) { box(x - 0.1, x + 0.1, 0, e.h, z - 0.1, z + 0.1); walls.push({ kind: 'extra', id: e.id, a: [x - 0.1, z], b: [x + 0.1, z], y0: 0, y1: e.h, t: 0.2 }); } }
      else outline(e.poly, 0, e.h, 0.3, { kind: 'extra', id: e.id }, [], cuts);
    }
    // ramps: inclined floor over the whole length, a short approach where the top stands above grade, side walls along the
    // open part (full height inside a tower, a parapet outside)
    const inTower = (x, z) => towers.some(t => inPoly2(t.P, x, z) || polyDist(t.P, x, z) < 0.6);
    const quad4 = (p0, p1, p2, p3) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3)); floors.push(g); };
    for (const r of ramps) {
      for (let i = 0; i + 1 < r.pts.length; i++) { const [l0, r0] = r.edge(i), [l1, r1] = r.edge(i + 1), ya = r.pts[i][1], yb = r.pts[i + 1][1]; quad4([l0[0], ya, l0[1]], [r0[0], ya, r0[1]], [r1[0], yb, r1[1]], [l1[0], yb, l1[1]]); }
      const [lt, rt] = r.edge(0), [dx, dz] = r.dirTop, A = RAMP_APPROACH;
      if (r.y0 > 0.02) quad4([lt[0] + dx * A, 0, lt[1] + dz * A], [rt[0] + dx * A, 0, rt[1] + dz * A], [rt[0], r.y0, rt[1]], [lt[0], r.y0, lt[1]]);
      // side walls along the open part (full height inside a tower, a parapet outside), starting a little in front of the portal
      for (const k of [0, 1]) {
        const e0 = r.edge(0)[k]; let prev = [e0[0], e0[1]], py = r.y0;
        for (let i = 0; i <= r.open; i++) { const e = r.edge(i)[k], m = [(prev[0] + e[0]) / 2, (prev[1] + e[1]) / 2]; if (r.pts[i][1] > r.y0 - 0.02 && py > r.y0 - 0.02 && i > 0) { prev = e; py = r.pts[i][1]; continue; }   // the level run-out in front of the portal has no walls
          wall(prev, e, Math.min(0, py, r.pts[i][1]) - 0.3, inTower(m[0], m[1]) ? 4 : 1.1, 0.25, { kind: 'ramp', id: r.id }); prev = e; py = r.pts[i][1]; }
      }
      holes.push({ id: r.id, ...r.hole });
    }
    // neighbours: a solid box for a plain rectangle, walls along the outline otherwise; the canopy keeps its pump islands
    for (const b of blocks) {
      const h = contextHeight(b), P = b.poly || [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
      if (contextStyle(b) === 'canopy') { for (const s of canopyLayout(b).islands) wall(s.a, s.b, 0, 1.7, 0.9, { kind: 'context', id: b.id }); continue; }
      if (isRectPoly(P)) { const r = bboxOfPoly(P); box(r.x0, r.x1, 0, h, r.z0, r.z1); walls.push({ kind: 'context', id: b.id, box: r, a: [r.x0, r.z0], b: [r.x1, r.z1], y0: 0, y1: h, t: 0 }); }
      else outline(P, 0, h, 0.4, { kind: 'context', id: b.id });
    }
  }
  for (const bx of extraBoxes) box(...bx);
  // ground: as far as the streets of the data reach (at least ±350 m) around the site centre, with one rectangular hole per ramp (its open part)
  if (!extraOnly) {
    const [cx, cz] = SITE_CENTER, GE = Math.max(350, streetExtent() + 80), X0 = cx - GE, X1 = cx + GE, Z0 = cz - GE, Z1 = cz + GE;
    const uniq = a => [...new Set(a)].sort((p, q) => p - q);
    const xs = uniq([X0, X1, ...holes.flatMap(h => [h.x0, h.x1])]), zs = uniq([Z0, Z1, ...holes.flatMap(h => [h.z0, h.z1])]), parts = [];
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const mx = (xs[i] + xs[i + 1]) / 2, mz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some(h => mx > h.x0 && mx < h.x1 && mz > h.z0 && mz < h.z1)) continue;
      const g = new THREE.PlaneGeometry(xs[i + 1] - xs[i], zs[j + 1] - zs[j]); g.rotateX(-Math.PI / 2); g.translate(mx, 0, mz); parts.push(strip(g.toNonIndexed(), ['position']));
    }
    floors.unshift(parts.length > 1 ? mergeGeometries(parts, false) : parts[0]);
  }
  // chunk the solids so proximity queries stay cheap
  const chunk = (list, flag) => {
    const cells = new Map();
    for (const g of list) { g.computeBoundingBox(); const c = g.boundingBox.getCenter(_v); const k = Math.floor(c.x / 40) + ',' + Math.floor(c.z / 40); (cells.get(k) || cells.set(k, []).get(k)).push(g); }
    for (const l of cells.values()) {
      const g = l.length > 1 ? mergeGeometries(l.map(q => strip(q.index ? q.toNonIndexed() : q, ['position'])), false) : strip(l[0], ['position']);
      g.computeBoundingBox(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.userData[flag] = true; m.userData.collider = true; m.name = 'outdoor-' + flag; group.add(m);
    }
  };
  chunk(solids, 'solid');
  for (const g of floors) { g.computeBoundingBox(); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.userData.floor = true; m.userData.collider = true; m.name = 'outdoor-floor'; group.add(m); }
  group.updateMatrixWorld(true);
  return { group, walls, gaps, holes, dispose() { group.traverse(o => o.geometry && o.geometry.dispose()); mat.dispose(); } };
}
/** There is no lake on this site (kept for walk.js): always false. */
export const inLake = () => false;

// The plot as drawn on the plans (data.js PLOT).
function sitePolys() { return [PLOT]; }
/** Is (x, z) on the site or within m metres of it (the streets that frame it)? */
export function nearPlot(x, z, m = 0) {
  for (const P of sitePolys()) if (inPoly2(P, x, z) || (m > 0 && polyDist(P, x, z) < m)) return true;
  return false;
}

// ------------------------------------------------------------------ the streets that frame the plot
const PARK_STRIP = 2.2;      // width of the kerbside parking strip on the carriageway
const plotDist = (x, z) => (inPoly2(PLOT, x, z) ? 0 : polyDist(PLOT, x, z));
// Streets of `roads` that run along the plot (data.js: вул. Грушевського, вул. Заньковецької — found by geometry, not by id):
// → [{ st, S: samples every 0.5 m beside the plot [x, z, tx, tz, s], hw, side, lat }]
//   side: 1 = cars park on the plot side (the pavement between kerb and plot is wide), −1 = on the far side;
//   lat:  +1 when that parking kerb is on the right-hand normal (−tz, tx) of the polyline direction, −1 on the left.
function framingStreets(roads = STREETS) {
  const out = [];
  for (const st of roads || []) {
    const pts = st.pts; if (!pts || pts.length < 2) continue;
    const S = []; let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      if (segDist(SITE_CENTER[0], SITE_CENTER[1], ax, az, bx, bz) < 260) for (let d = 0; d < L; d += 0.5) { const x = ax + tx * d, z = az + tz * d; if (plotDist(x, z) < 34) S.push([x, z, tx, tz, s + d]); }
      s += L;
    }
    if (S.length < 120) continue;                                             // under 60 m beside the plot: not a street that frames it
    const hw = (st.w || 6) / 2, near = S.reduce((m, q) => (plotDist(q[0], q[1]) < plotDist(m[0], m[1]) ? q : m), S[0]);
    const gap = plotDist(near[0], near[1]) - hw;                              // pavement width between kerb and plot
    const side = gap >= 6 ? 1 : -1;
    // +1 when the plot lies on the right-hand normal (−tz, tx) of the polyline direction
    const toPlot = q => (plotDist(q[0] - q[3], q[1] + q[2]) < plotDist(q[0] + q[3], q[1] - q[2]) ? 1 : -1);
    out.push({ st, S, hw, side, toPlot, near, lat: toPlot(near) * side });
  }
  return out;
}

// ------------------------------------------------------------------ parked cars of this site
// Kerbside cars on the streets that frame the plot (Hrushevskoho, Zankovetskoi): one side of each street — the plot side
// where the pavement between kerb and plot is wide, the far side otherwise — so two lanes stay free. Clear of the vehicle
// and pedestrian entrances, the junctions and the bus-stop pavilion. Plus the cars in the guest parking pockets around the
// plot (site-layout.js PARKING_POCKETS rows, when that module is there) and the cars filling up at the fuel station.
// Right-hand traffic: a parked car faces the way its lane runs. → [{x, y: 0, z, yaw, kind, colour, src, street? | pocket?}]
export function parkedStreetCars({ seed = 4242, occupancy = 0.74, slot = 6.3, blocks = CONTEXT_BLOCKS, roads = STREETS, pockets = parkingPockets() } = {}) {
  const r = rng(seed), out = [];
  const lineD = (pts, x, z) => { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; };
  const entrances = (COURTYARD && COURTYARD.entrances) || [];
  const pavilions = blocks.filter(b => b.kind === 'pavilion').map(b => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]);
  for (const { st, S, hw, side, toPlot } of framingStreets(roads)) {
    const ents = entrances.map(e => { let b = null; for (const q of S) { const d = Math.hypot(q[0] - e.p[0], q[1] - e.p[1]); if (!b || d < b[0]) b = [d, q[4]]; } return b && b[0] < 30 ? { s: b[1], m: e.kind === 'vehicle' ? 14 : 4 } : null; }).filter(Boolean);   // room to swing in and out of a gateway
    const others = roads.filter(o => o !== st && o.pts && o.pts.length > 1);
    let sPrev = -Infinity;
    for (const q of S) {
      if (q[4] - sPrev < slot) continue;
      const lat = toPlot(q) * side, nx = -q[3] * lat, nz = q[2] * lat;         // unit vector towards the chosen kerb
      const x = q[0] + nx * (hw - PARK_STRIP / 2 - 0.02), z = q[1] + nz * (hw - PARK_STRIP / 2 - 0.02);
      if (!nearPlot(x, z, 15.5) || plotDist(x, z) < 2) continue;
      if (ents.some(e => Math.abs(q[4] - e.s) < e.m)) continue;
      if (others.some(o => lineD(o.pts, x, z) < (o.w || 6) / 2 + 9)) continue;
      if (pavilions.some(p => Math.hypot(x - p[0], z - p[1]) < 13)) continue;
      if (blocks.some(b => b.poly && (inPoly2(b.poly, x, z) || polyDist(b.poly, x, z) < 1.6))) continue;
      sPrev = q[4];
      if (hashStr(st.id + ':' + out.length + ':' + Math.round(q[4]) + ':' + seed) / 4294967296 > occupancy) continue;
      // the kerb is on the right of a parked car (right of heading d is (−dz, dx)) → it faces along the polyline when lat = 1
      const dx = q[2] * lat, dz = q[3] * lat;
      out.push({ x: x + (r() - 0.5) * 0.12, y: 0, z: z + (r() - 0.5) * 0.12, yaw: Math.atan2(dx, dz) + (r() - 0.5) * 0.04, ...pickCar(r), deck: false, src: 'street', street: st.id });
    }
  }
  // guest parking pockets: rows of bays {from, to, n, bay: [w, d], dir: nose direction}; a bay touching a building stays empty
  for (const pk of pockets || []) for (const row of pk.rows || []) {
    const n = row.n | 0; if (n < 1 || !row.from || !row.to) continue;
    const [fx, fz] = row.from, [tx, tz] = row.to, d = row.dir || [1, 0], dl = Math.hypot(d[0], d[1]) || 1, ux = d[0] / dl, uz = d[1] / dl;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, x = fx + (tx - fx) * f, z = fz + (tz - fz) * f;
      if (hashStr(pk.id + ':' + i + ':' + seed) / 4294967296 > occupancy) continue;
      if (blocks.some(b => b.poly && [[0, 0], [2.6, 1], [2.6, -1], [-2.6, 1], [-2.6, -1]].some(([a, c]) => inPoly2(b.poly, x + ux * a - uz * c, z + uz * a + ux * c)))) continue;
      out.push({ x: x + (r() - 0.5) * 0.1, y: 0, z: z + (r() - 0.5) * 0.1, yaw: Math.atan2(ux, uz) + (r() - 0.5) * 0.03 + (r() < 0.2 ? Math.PI : 0), ...pickCar(r), deck: false, src: 'pocket', pocket: pk.id });
    }
  }
  for (const b of blocks) if (contextStyle(b) === 'canopy') {
    const cars = canopyLayout(b).cars; if (!cars.length) continue;
    const pick = new Set([Math.floor(r() * cars.length), Math.floor(r() * cars.length)]);
    for (const i of pick) out.push({ x: cars[i].x, y: 0, z: cars[i].z, yaw: cars[i].yaw, ...pickCar(r), deck: false, src: 'fuel' });
  }
  return out;
}

// ------------------------------------------------------------------ moving traffic on the streets that frame the plot
// Lane centre lines for right-hand traffic: one per direction on each framing street (вул. Грушевського, вул. Заньковецької),
// following the street polyline inside `radius` of the site. The two lanes share the carriageway left free by the kerbside
// parking strip (parkedStreetCars), so a moving car never touches a parked one.
// → [{ id, street, dir: 1 | −1 (along / against the polyline), order, w, off, pts: [[x, z], …], cum, L }]
export function trafficPaths({ roads = STREETS, radius = 330, center = SITE_CENTER, step = 3 } = {}) {
  const out = [];
  const fr = framingStreets(roads), used = new Set(fr.map(f => f.st));
  // the other through roads inside the radius: two lanes on the whole carriageway (nobody parks at their kerbs here)
  const more = (roads || []).filter(st => st.main && !used.has(st) && st.pts && st.pts.length > 1).map(st => {
    let near = st.pts[0], bd = Infinity;
    for (let i = 0; i + 1 < st.pts.length; i++) for (let k = 0; k <= 8; k++) { const q = [st.pts[i][0] + (st.pts[i + 1][0] - st.pts[i][0]) * k / 8, st.pts[i][1] + (st.pts[i + 1][1] - st.pts[i][1]) * k / 8], d = Math.hypot(q[0] - center[0], q[1] - center[1]); if (d < bd) { bd = d; near = q; } }
    return { st, lat: 0, near };
  });
  [...fr, ...more].forEach(({ st, lat, near }, order) => {
    const w = st.w || 6, pts = st.pts, C = [];
    for (let i = 0; i + 1 < pts.length; i++) {                                 // centre line, resampled
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1e-6) continue;
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) C.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
      if (i + 2 === pts.length) C.push([bx, bz]);
    }
    // the run inside the radius that passes the plot
    let k0 = 0, bd = Infinity; C.forEach((c, i) => { const d = Math.hypot(c[0] - near[0], c[1] - near[1]); if (d < bd) { bd = d; k0 = i; } });
    const inside = c => Math.hypot(c[0] - center[0], c[1] - center[1]) < radius - 8;
    if (!inside(C[k0])) return;
    let a = k0, b = k0; while (a > 0 && inside(C[a - 1])) a--; while (b + 1 < C.length && inside(C[b + 1])) b++;
    const run = C.slice(a, b + 1); if (run.length < 4) return;
    const free = lat ? Math.max(5.2, w - PARK_STRIP) : w, c0 = -lat * (w - free) / 2;   // centre of the free carriageway, along the right-hand normal
    for (const dir of [1, -1]) {
      const off = c0 + dir * free / 4, P = run.map((c, i) => {
        const p = run[Math.max(0, i - 1)], q = run[Math.min(run.length - 1, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        return [c[0] - (q[1] - p[1]) / l * off, c[1] + (q[0] - p[0]) / l * off];
      });
      if (dir < 0) P.reverse();
      const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      out.push({ id: st.id + (dir > 0 ? ':a' : ':b'), street: st.id, dir, order, w, off, pts: P, cum, L: cum[cum.length - 1] });
    }
  });
  return out;
}
// Cars driving along trafficPaths(): each keeps its lane and its distance to the car ahead; where two streets cross, the
// cars of the later street in the list give way (a simulation rule, not a statement about the real junction).
// They are scenery: far models (2 draw calls per model), no colliders, head / tail light points after dusk.
// → { group, cars: [{x, y, z, yaw, kind, colour, path, s, v}], paths, update(dt), setMode(mode), dispose() }
export function createTraffic({ paths = trafficPaths(), density = 1 / 90, count = null, seed = 911, shadows = false, speed = [8.5, 12.5] } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-traffic';
  const r = rng(seed), cars = [], total = paths.reduce((m, p) => m + p.L, 0) || 1;
  paths.forEach((p, pi) => {
    const n = count != null ? Math.round(count * p.L / total) : Math.max(1, Math.round(p.L * density));
    for (let i = 0; i < n; i++) { const v0 = speed[0] + r() * (speed[1] - speed[0]); cars.push({ id: 'traffic:' + cars.length, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, ...pickCar(r), path: pi, s: (i + 0.15 + 0.7 * r()) / n * p.L, v: v0, v0, k: 0, go: false, driver: null, disabled: false, taken: false, push: 0 }); }
  });
  // crossings of lanes of different streets → per path [{s, other, so}]
  const conf = paths.map(() => []);
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const A = paths[i], B = paths[j]; if (A.street === B.street) continue;
    for (let a = 0; a + 1 < A.pts.length; a++) for (let b = 0; b + 1 < B.pts.length; b++) {
      const [x1, z1] = A.pts[a], [x2, z2] = A.pts[a + 1], [x3, z3] = B.pts[b], [x4, z4] = B.pts[b + 1];
      if (Math.max(x1, x2) < Math.min(x3, x4) || Math.max(x3, x4) < Math.min(x1, x2) || Math.max(z1, z2) < Math.min(z3, z4) || Math.max(z3, z4) < Math.min(z1, z2)) continue;
      const d = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3); if (Math.abs(d) < 1e-9) continue;
      const t = ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / d, u = ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / d;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      const sa = A.cum[a] + (A.cum[a + 1] - A.cum[a]) * t, sb = B.cum[b] + (B.cum[b + 1] - B.cum[b]) * u;
      conf[i].push({ s: sa, other: j, so: sb }); conf[j].push({ s: sb, other: i, so: sa });
    }
  }
  const stopS = paths.map((p, i) => { const c = conf[i].filter(q => paths[q.other].order < p.order); return c.length ? Math.min(...c.map(q => q.s)) - 8 : null; });
  const place = c => {
    const p = paths[c.path], s = clamp(c.s, 0, p.L); let k = Math.min(c.k, p.cum.length - 2);
    while (k > 0 && p.cum[k] > s) k--; while (k < p.cum.length - 2 && p.cum[k + 1] < s) k++;
    c.k = k;
    const a = p.pts[k], b = p.pts[k + 1], l = p.cum[k + 1] - p.cum[k] || 1, f = (s - p.cum[k]) / l;
    c.x = a[0] + (b[0] - a[0]) * f; c.z = a[1] + (b[1] - a[1]) * f;
    // heading blended over the neighbouring segments so the car turns smoothly through the vertices
    const q = p.pts[Math.min(p.pts.length - 1, k + 2)], o = p.pts[Math.max(0, k - 1)], g = f, hx = (b[0] - a[0]) * (1 - Math.abs(g - 0.5)) + (g > 0.5 ? q[0] - b[0] : a[0] - o[0]) * Math.abs(g - 0.5), hz = (b[1] - a[1]) * (1 - Math.abs(g - 0.5)) + (g > 0.5 ? q[1] - b[1] : a[1] - o[1]) * Math.abs(g - 0.5);
    c.yaw = Math.atan2(hx, hz); c.vx = Math.sin(c.yaw) * c.v; c.vz = Math.cos(c.yaw) * c.v;
  };
  cars.forEach(place);
  const inst = cars.length ? createCarInstances(cars, { shadows }) : null;
  if (inst) { inst.group.name = 'vrc-traffic-cars'; group.add(inst.group); }
  // head (warm white) and tail (red) lights
  let lights = null, lp = null, tex = null;
  if (cars.length && typeof document !== 'undefined') {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(cv);
    lp = new Float32Array(cars.length * 12); const lc = new Float32Array(cars.length * 12);
    cars.forEach((_, i) => lc.set([1, 0.92, 0.8, 1, 0.92, 0.8, 1, 0.08, 0.04, 1, 0.08, 0.04], i * 12));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    lights = new THREE.Points(lg, new THREE.PointsMaterial({ size: 1.5, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    lights.name = 'vrc-traffic-lights'; lights.frustumCulled = false; lights.visible = false; group.add(lights);
  }
  const sync = () => {
    if (inst) inst.update();
    if (lights) {
      cars.forEach((c, i) => {
        const S = carSpec(c.kind), fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx, hw = S.W / 2 - 0.28;
        const ax = c.x + fx * (S.zF - 0.05), az = c.z + fz * (S.zF - 0.05), bx = c.x + fx * (S.zR + 0.05), bz = c.z + fz * (S.zR + 0.05);
        const ly = c.taken ? -500 : 0;
        lp.set([ax + rx * hw, 0.68 + ly, az + rz * hw, ax - rx * hw, 0.68 + ly, az - rz * hw, bx + rx * hw, 0.86 + ly, bz + rz * hw, bx - rx * hw, 0.86 + ly, bz - rz * hw], i * 12);
      });
      lights.geometry.attributes.position.needsUpdate = true;
    }
  };
  sync();
  const byPath = paths.map((_, i) => cars.filter(c => c.path === i));
  // things standing or driving on the road that the traffic must not run into (the visitor's car, cars left on the lane):
  // [{x, z, kind?}] → per path the position along it, when the thing is within the lane
  let obstacles = [], obsS = paths.map(() => []);
  function setObstacles(list) {
    obstacles = list || [];
    obsS = paths.map(p => {
      const out = [];
      for (const o of obstacles) {
        let best = null;
        for (let k = 0; k + 1 < p.pts.length; k++) {
          const a = p.pts[k], b = p.pts[k + 1]; if (Math.abs(a[0] - o.x) > 12 && Math.abs(b[0] - o.x) > 12) continue; if (Math.abs(a[1] - o.z) > 12 && Math.abs(b[1] - o.z) > 12) continue;
          const ux = b[0] - a[0], uz = b[1] - a[1], L2 = ux * ux + uz * uz || 1, t = clamp(((o.x - a[0]) * ux + (o.z - a[1]) * uz) / L2), d = Math.hypot(o.x - a[0] - ux * t, o.z - a[1] - uz * t);
          if (d < 2.9 && (!best || d < best[0])) best = [d, p.cum[k] + Math.sqrt(L2) * t];
        }
        if (best) out.push(best[1]);
      }
      return out;
    });
  }
  // does the footprint `quad` (world corners) touch a moving car? (they are solid for the visitor's car)
  function hits(quad, cx, cz) {
    for (const c of cars) { if (c.taken || Math.abs(c.x - cx) > 6 || Math.abs(c.z - cz) > 6) continue; if (quadsOverlap(quad, carCorners(c.kind, c.x, c.z, c.yaw, 0.05))) return c; }
    return null;
  }
  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi], list = byPath[pi].sort((a, b) => a.s - b.s), ss = stopS[pi];
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i], lead = list[i + 1];
        let gap = lead ? lead.s - c.s - 6.2 : Infinity;                      // bumper-to-bumper distance kept: ≈ 1.2 m + braking room
        for (const so of obsS[pi]) if (so > c.s + 1.5 && so - c.s - 7 < gap) gap = Math.max(0, so - c.s - 7);
        if (ss != null && c.s <= ss + 0.5 && c.s > ss - 45) {
          // give way: stop at the line while a car of the other street is at or near the crossing
          const busy = conf[pi].some(q => paths[q.other].order < p.order && byPath[q.other].some(o => o.s > q.so - 46 && o.s < q.so + 9));
          if (busy) gap = Math.min(gap, ss - c.s);
        }
        const vt = c.disabled ? 0 : Math.min(c.v0, Math.sqrt(2 * 2.4 * Math.max(0, gap)));
        c.v += clamp(vt - c.v, -7 * dt, 3 * dt);
        if (c.push) { c.v = Math.max(0, c.v + c.push); c.push = 0; }                // a shove from outside (addCarImpulse), along the lane
        if (c.v < 0.02 && vt === 0) c.v = 0;
        c.s += c.v * dt;
        if (lead && c.s > lead.s - 5.2) c.s = lead.s - 5.2;
        for (const so of obsS[pi]) if (so > c.s + 1.5 && c.s > so - 5.6) { c.s = Math.max(c.s - c.v * dt, Math.min(c.s, so - 5.6)); c.v = 0; }
        if (c.s > p.L) { c.s = p.L; c.v = Math.min(c.v, 2); }
      }
      // the front car leaves at the end of the lane and comes back in at its start once there is room
      const head = list[list.length - 1];
      if (head && head.s >= p.L && (list[0] === head || list[0].s > 16) && !obsS[pi].some(so => so < 14)) { head.s = 0; head.k = 0; head.v = head.v0 * 0.8; }
      for (const c of list) place(c);
    }
    sync();
  }
  // a traffic car leaves the simulation (the visitor takes it over; the fleet draws and drives it from then on)
  function take(c) {
    if (!c || c.taken) return null;
    c.taken = true; const i = cars.indexOf(c), l = byPath[c.path], k = l.indexOf(c); if (k >= 0) l.splice(k, 1);
    if (inst && i >= 0) { inst.setHidden(i, true); inst.update(); }
    sync();
    return { id: c.id, kind: c.kind, colour: c.colour, x: c.x, y: c.y, z: c.z, yaw: c.yaw, v: c.v, driver: c.driver };
  }
  return {
    group, cars, paths, conflicts: conf, update, setObstacles, hits, take,
    /** cb(car) for every car still in the traffic: {id, x, y, z, yaw, v, vx, vz, kind, colour, driver, disabled} */
    forEach(cb) { for (const c of cars) if (!c.taken) cb(c); },
    setMode(m) { if (lights) lights.visible = m === 'dusk' || m === 'night'; },
    dispose() { if (inst) inst.dispose(); if (lights) { lights.geometry.dispose(); lights.material.dispose(); } if (tex) tex.dispose(); group.parent?.remove(group); },
  };
}
/** Cars for the bays of the car park (world; bay.yaw = heading of a car standing in the bay with its nose to the aisle).
 *  Most full-size bays are taken (about two thirds of all places), by a fixed seed. Rules: nothing in motorcycle,
 *  wheelchair or micro-car (class A) bays; of two dependent ("blocked") bays at most one is used, so every car can drive out;
 *  the design must fit the bay (length, width, clear height); every car stands nose-out or nose-in at random.
 *  Old bay lists ({x, z, yaw} only) work too. → [{x, y, z, yaw, kind, colour, bay}] — what fleet.add() takes. */
export function parkingCars(bays, { occupancy = 0.97, seed = 20261006, y = RAMPS[0]?.y1 ?? -4.2 } = {}) {
  const r = rng(seed), out = [], used = new Set();
  for (const b of bays || []) {
    // four independent draws per bay, from the bay's own number → the same car stays in a bay whatever happens to other bays
    const key = seed + ':' + (b.id ?? out.length + ':' + Math.round(b.x * 10) + ':' + Math.round(b.z * 10)), u = k => hashStr(key + ':' + k) / 4294967296, roll = u('a'), rk = u('b'), rc = u('c'), rf = u('d'); void r;
    if (b.kind === 'moto' || b.accessible || b.cls === 'A' || !(roll < occupancy * (b.cls === 'AOMK' ? 0.8 : 1))) continue;                  // class A = micro-car places: none of these designs is that small
    if ((b.blockedBy != null && used.has(b.blockedBy)) || (b.blocks != null && used.has(b.blocks))) continue;
    const mc = b.maxCar || {}, maxL = Math.min((mc.l ?? 9) + 0.36, (b.l ?? b.L ?? 9) + 0.02), maxW = Math.min((mc.w ?? 9) + 0.18, (b.w ?? b.W ?? 9) - 0.2), maxH = Math.min(mc.h ?? 9, b.h ?? 9);
    const q = [rk, rc], rr = () => (q.length ? q.shift() : r());
    // a charging place takes any car, but the electric model stands there far more often than elsewhere
    const fits = S => S.L <= maxL && S.W <= maxW && S.H <= maxH, evHere = b.ev && (rf * 7.31) % 1 < 0.3 && fits(carSpec('ev'));
    const pick = evHere ? pickCar(rr, { kinds: ['ev'] }) : pickCar(rr, { fit: fits, weight: S => (S.L / Math.min(maxL, 5.6)) ** 6 });   // a big bay mostly holds a big car
    const S = carSpec(pick.kind); if (S.L > maxL || S.W > maxW || S.H > maxH) continue;
    if (b.id != null) used.add(b.id);
    // centred in the bay along its length (origin of a car is midway between the axles, not the middle of the body)
    const yaw = b.yaw + (rf < 0.42 ? Math.PI : 0), off = -(S.zF + S.zR) / 2;
    out.push({ x: b.x + Math.sin(yaw) * off, y: b.y ?? y, z: b.z + Math.cos(yaw) * off, yaw, ...pick, bay: b.id ?? null });
  }
  return out;
}
export const carsForBays = parkingCars;   // older name

// ------------------------------------------------------------------ where a car may go above ground
// The streets (data.js STREETS — Hrushevskoho, Zankovetskoi and the district around them — plus every street the
// environment paves: its 'road-strips' mesh, one quad per segment, each lengthened a little so that cut pieces meet),
// widened by the pavement, out to `radius` from the site centre; on the plot only the two driveways that lead from the
// streets to the car-park ramps, the ramps themselves and their approaches (the courtyard is car-free); the paved
// forecourt of the fuel station; the guest parking pockets of site-layout.js with a way in from their street.
// Houses and gardens stay out of bounds. 1 m raster → O(1) test.
// `margin` is used only when the data has no driveways: then the whole plot, dilated by it, is drivable.
export function createDriveArea(envGroup, { margin = 14, sidewalk = 0.25, extend = 22, radius = null, center = SITE_CENTER, lane = 1.6, pockets = parkingPockets(), blocks = CONTEXT_BLOCKS, cellSize = 0.5 } = {}) {
  if (radius == null) radius = streetExtent(STREETS, center);              // the whole street network of the data (no fixed extent)
  const span = 2 * (radius + 40), CS = Math.max(cellSize, span / 8192), X0 = center[0] - radius - 40, Z0 = center[1] - radius - 40, N = Math.ceil(span / CS);
  // one bit per cell (a byte array of this size would be tens of MB once the city grows)
  const bits = new Uint8Array(Math.ceil(N * N / 8));
  const gget = k => (bits[k >> 3] >> (k & 7)) & 1, gset = k => { bits[k >> 3] |= 1 << (k & 7); }, gclr = k => { bits[k >> 3] &= ~(1 << (k & 7)); };
  const cell = (x, z) => { const i = Math.floor((x - X0) / CS), j = Math.floor((z - Z0) / CS); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  const fillPoly = (P, m) => {
    const b = bboxOfPoly(P);
    for (let z = Math.floor((b.z0 - m) / CS) * CS; z <= b.z1 + m; z += CS) for (let x = Math.floor((b.x0 - m) / CS) * CS; x <= b.x1 + m; x += CS) {
      const k = cell(x + CS / 2, z + CS / 2); if (k < 0 || gget(k)) continue;
      if (inPoly2(P, x + CS / 2, z + CS / 2) || (m > 0 && polyDist(P, x + CS / 2, z + CS / 2) < m)) gset(k);
    }
  };
  const fillSeg = (sx, sz, ex, ez, hw) => {
    for (let z = Math.floor((Math.min(sz, ez) - hw) / CS) * CS; z <= Math.max(sz, ez) + hw; z += CS) for (let x = Math.floor((Math.min(sx, ex) - hw) / CS) * CS; x <= Math.max(sx, ex) + hw; x += CS) {
      const k = cell(x + CS / 2, z + CS / 2); if (k < 0 || gget(k)) continue;
      if (segDist(x + CS / 2, z + CS / 2, sx, sz, ex, ez) < hw && Math.hypot(x + CS / 2 - center[0], z + CS / 2 - center[1]) < radius) gset(k);
    }
  };
  // the site
  const drives = ((COURTYARD && COURTYARD.driveways) || []).filter(d => d.poly && d.poly.length > 2);
  if (drives.length) for (const d of drives) fillPoly(d.poly, lane);
  else for (const P of sitePolys()) fillPoly(P, margin);
  for (const R of RAMPS) { const q = rampModel(R).all, c = rampModel(R).cut; for (const b of [q, c]) fillPoly([[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]], 0.6); }   // the whole ramp + its approach (below, the car-park walls bound the car)
  // the gateways: from each vehicle entrance of the plot across the pavement to the carriageway of its street
  const nearestStreet = (x, z) => { let best = null; for (const st of STREETS) { const pts = st.pts || []; for (let i = 0; i + 1 < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz); if (!best || d < best.d) best = { d, q: [qx, qz] }; } } return best; };
  for (const e of (COURTYARD && COURTYARD.entrances) || []) if (e.kind === 'vehicle' && e.p) { const n = nearestStreet(e.p[0], e.p[1]); if (n && n.d < 40) fillSeg(e.p[0], e.p[1], n.q[0], n.q[1], 3.4); }
  for (const d of drives) { let far = null; for (const p of d.poly) { const n = nearestStreet(p[0], p[1]); if (n && n.d < 14 && (!far || n.d < far.d)) far = { ...n, p }; } if (far) fillSeg(far.p[0], far.p[1], far.q[0], far.q[1], 3.2); }
  for (const e of SITE_EXTRAS || []) if (e.kind === 'paved' && e.poly) fillPoly(e.poly, 0);
  // guest parking pockets beside the streets: the paved court + a way in from its street at both ends (clear of buildings)
  for (const pk of pockets || []) {
    if (!pk.poly || pk.poly.length < 3 || !(pk.rows && pk.rows.length)) continue;
    fillPoly(pk.poly, 0);
    const st = STREETS.find(q => q.id === pk.access); if (!st || !st.pts) continue;
    const links = [];
    for (const [x, z] of pk.poly) {
      let best = null, s = 0;
      for (let i = 0; i + 1 < st.pts.length; i++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
        if (!best || d < best.d) best = { d, q: [qx, qz], s: s + Math.sqrt(L2) * t };
        s += Math.sqrt(L2);
      }
      if (!best || best.d > 45) continue;
      let free = true;
      for (let k = 0; k <= 12 && free; k++) { const px = x + (best.q[0] - x) * k / 12, pz = z + (best.q[1] - z) * k / 12; if (blocks.some(b => b.poly && (inPoly2(b.poly, px, pz) || polyDist(b.poly, px, pz) < 3.4))) free = false; }
      if (free) links.push({ p: [x, z], ...best });
    }
    if (!links.length) continue;
    links.sort((a, b) => a.s - b.s);
    for (const l of new Set([links[0], links[links.length - 1]])) fillSeg(l.p[0], l.p[1], l.q[0], l.q[1], 3.2);
  }
  // the streets of data.js
  for (const st of STREETS) {
    const pts = st.pts || [], hw = (st.w || 6) / 2 + sidewalk;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      if (segDist(center[0], center[1], ax, az, bx, bz) > radius + hw) continue;
      fillSeg(ax, az, bx, bz, hw);
    }
  }
  // street quads of the environment
  const strips = envGroup && envGroup.getObjectByName && envGroup.getObjectByName('road-strips');
  if (strips && strips.geometry && strips.geometry.attributes.position) {
    const p = strips.geometry.attributes.position;
    for (let q = 0; q + 3 < p.count; q += 4) {
      // quad: p+n, p−n, q−n, q+n → centre line a→b and half width
      const ax = (p.getX(q) + p.getX(q + 1)) / 2, az = (p.getZ(q) + p.getZ(q + 1)) / 2, bx = (p.getX(q + 2) + p.getX(q + 3)) / 2, bz = (p.getZ(q + 2) + p.getZ(q + 3)) / 2;
      const hw = Math.hypot(p.getX(q) - p.getX(q + 1), p.getZ(q) - p.getZ(q + 1)) / 2 + sidewalk;
      if (Math.hypot((ax + bx) / 2 - center[0], (az + bz) / 2 - center[1]) > radius) continue;
      const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
      // the lengthening only counts inside the radius (no driving off into the suburbs along a cut street)
      fillSeg(ax - ux * extend, az - uz * extend, bx + ux * extend, bz + uz * extend, hw);
    }
  }
  // trees and lamp posts that stand in a drivable place (driveways, the parking court) are solid
  const posts = [];
  for (const t of (LAYOUT && Array.isArray(LAYOUT.TREES) ? LAYOUT.TREES : [])) if (t && t.p) posts.push([t.p[0], t.p[1], 0.45]);
  for (const l of (LAYOUT && Array.isArray(LAYOUT.LAMPS) ? LAYOUT.LAMPS : [])) if (l && l.p) posts.push([l.p[0], l.p[1], 0.3]);
  let carved = 0;
  for (const [x, z, r] of posts) for (let dz = -r; dz <= r; dz += CS) for (let dx = -r; dx <= r; dx += CS) { const k = cell(x + dx, z + dz); if (k >= 0 && gget(k)) { gclr(k); carved++; } }
  return {
    test(x, z) { const k = cell(x, z); return k >= 0 && ((bits[k >> 3] >> (k & 7)) & 1) === 1; },
    // how far (x, z) is from the edge of the model: 0 inside, → 1 at the limit where the streets stop
    edge(x, z) { return clamp((Math.hypot(x - center[0], z - center[1]) - (radius - 34)) / 26); },
    bits, origin: [X0, Z0], size: N, cell: CS, center: [center[0], center[1]], radius, carved,
  };
}

// ------------------------------------------------------------------ fleet: every drivable car, LOD-managed
// Records {id, kind, colour, x, y, z, yaw, src}. Near the camera the closest cars are detailed createCar()s,
// the rest are drawn as instances; underground cars are only drawn when the camera is below grade (or at the ramp).
// A car the visitor has driven keeps its place for the whole page session (also when the walkthrough is closed and opened
// again): its pose is remembered by the record's id.
const SESSION_POSES = new Map();
export function createFleet({ maxDetailed = 4, detailRadius = 24, farRadius = 230, midRadius = 36, maxMid = 10, underRadius = 75 } = {}) {
  const group = new THREE.Group(); group.name = 'vrc-fleet';
  const colliders = new THREE.Group(); colliders.name = 'vrc-fleet-colliders'; colliders.visible = false; group.add(colliders);
  const colMat = new THREE.MeshBasicMaterial({ visible: false });
  const colGeo = {};
  const records = [], sources = new Set();
  const detailed = new Map();   // id → car
  const inst = {};              // kind → {p, r, cap}
  let dirty = true, lastCam = new THREE.Vector3(1e9, 0, 0), lastT = 0, active = new Set(), focus = null;
  const col = new THREE.Color();
  function colliderFor(rec) {
    const S = carSpec(rec.kind);
    if (!colGeo[rec.kind]) { const g = new THREE.BoxGeometry(S.W - 0.04, 1.35, S.L - 0.06); g.translate(0, 0.72, (S.zF + S.zR) / 2); colGeo[rec.kind] = g; }
    const m = new THREE.Mesh(colGeo[rec.kind], colMat); m.userData.solid = true; m.userData.carId = rec.id; m.name = 'car-collider';
    colliders.add(m); return m;
  }
  function place(rec) {
    const c = rec.collider; c.position.set(rec.x, rec.y, rec.z); c.rotation.set(0, rec.yaw, 0); c.updateMatrix(); c.updateMatrixWorld(true);
  }
  // footprint overlap of two parked cars (2-D separating axes, 5 cm clearance)
  const corners = (kind, x, z, yaw) => carCorners(kind, x, z, yaw, 0.025);
  const sat = (A, B) => {
    for (const P of [A, B]) for (let i = 0; i < 4; i++) {
      const nx = P[(i + 1) % 4][1] - P[i][1], nz = P[i][0] - P[(i + 1) % 4][0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of A) { const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const [x, z] of B) { const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 < b0 || b1 < a0) return false;
    }
    return true;
  };
  const clashes = (kind, x, y, z, yaw) => {
    const A = corners(kind, x, z, yaw);
    for (const r of records) if (Math.abs(r.y - y) < 1.5 && Math.abs(r.x - x) < 7 && Math.abs(r.z - z) < 7 && sat(A, corners(r.kind, r.x, r.z, r.yaw))) return true;
    return false;
  };
  // add parked cars; a car that would overlap one already there is nudged along its own axis (≤ 35 cm) or left out,
  // and `accept(c)` may veto a spot (e.g. one inside a wall). Returns the added records (rec.index = index in `list`).
  function add(list, src, accept = null) {
    if (src && sources.has(src)) return [];
    if (src) sources.add(src);
    const out = [];
    list.forEach((c, index) => {
      const kind = carSpec(c.kind).kind, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      let x = c.x, z = c.z, ok = false;
      for (const d of [0, 0.15, -0.15, 0.35, -0.35]) { x = c.x + fx * d; z = c.z + fz * d; if (!clashes(kind, x, c.y, z, c.yaw) && (!accept || accept({ ...c, kind, x, z }))) { ok = true; break; } }
      if (!ok) return;
      const rec = { id: c.id || (c.bay != null ? 'bay:' + c.bay : (src || 'car') + ':' + index), kind, colour: c.colour || 'black', x, y: c.y, z, yaw: c.yaw, pitch: 0, src, index, bay: c.bay ?? null, home: { x, y: c.y, z, yaw: c.yaw }, driver: c.driver ?? null, disabled: false };
      const sp = SESSION_POSES.get(rec.id); if (sp && sp.kind === kind) { Object.assign(rec, { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: sp.pitch || 0, moved: true }); }
      rec.collider = colliderFor(rec); place(rec); records.push(rec); out.push(rec);
    });
    dirty = true; return out;
  }
  function ensureInst(key, need) {   // key = kind + ':mid' | ':far'
    const I = inst[key];
    if (I && I.cap >= need) return I;
    if (I) { group.remove(I.p, I.r); I.p.dispose(); I.r.dispose(); }
    const [kind, tier] = key.split(':'), G = carTier(kind, tier === 'mid' ? 1 : 2), cap = Math.max(8, Math.ceil(need * 1.3));
    const p = new THREE.InstancedMesh(G.paint, G.paintMat, cap), r = new THREE.InstancedMesh(G.rest, G.restMat, cap);
    p.name = 'fleet-' + key + '-paint'; r.name = 'fleet-' + key + '-rest';
    p.setColorAt(0, col.set('#fff')); p.count = r.count = 0;
    group.add(p, r); return (inst[key] = { p, r, cap });
  }
  const underground = rec => rec.y < -1.2;
  const nearRamp = p => RAMPS.some(R => p.x > R.x0 - 30 && p.x < R.x1 + 30 && p.z > R.z0 - 30 && p.z < R.z1 + 30);
  function update(camera, force = false) {
    const cp = camera.getWorldPosition(_v).clone();
    const now = performance.now();
    if (!force && !dirty && now - lastT < 280 && cp.distanceToSquared(lastCam) < 4) return;
    lastT = now; lastCam.copy(cp);
    const camUnder = cp.y < -0.4, ramp = cp.y < 3 && nearRamp(cp);   // V11: the ramp exception only for an eye near grade (from a flat upstairs the car park is never visible)
    const vis = [];
    for (const r of records) {
      const u = underground(r);
      if (u && !camUnder && !ramp && r !== focus) continue;
      if (!u && camUnder && !ramp && r !== focus) continue;
      const d = Math.hypot(r.x - cp.x, r.y - cp.y, r.z - cp.z);
      if (d > (u ? underRadius : farRadius) && r !== focus) continue;
      vis.push([d, r]);
    }
    vis.sort((a, b) => a[0] - b[0]);
    const want = new Set();
    if (focus) want.add(focus);
    // detailed models go to the nearest cars the camera is looking at (those behind it count as three times as far)
    const fwd = camera.getWorldDirection(_v);
    const det = vis.filter(([d]) => d < detailRadius).map(([d, r]) => [d > 3 && ((r.x - cp.x) * fwd.x + (r.y + 0.7 - cp.y) * fwd.y + (r.z - cp.z) * fwd.z) < d * 0.3 ? d * 3 : d, r]).sort((a, b) => a[0] - b[0]);
    for (const [d, r] of det) { if (want.size >= maxDetailed || d > detailRadius) break; want.add(r); }
    // detailed cars
    for (const [id, car] of detailed) if (![...want].some(r => r.id === id)) { car.group.visible = false; }
    for (const r of want) {
      let car = detailed.get(r.id);
      if (!car) { car = createCar(r.kind, r.colour, { interior: hashStr(r.id) % INTERIORS.length, plate: hashStr(r.id + '#') % PLATES.n }); detailed.set(r.id, car); group.add(car.group); car.setLights(false); }
      car.group.visible = true; syncCar(r, car);
    }
    // evict stale detailed cars
    if (detailed.size > maxDetailed * 3) for (const [id, car] of detailed) if (!car.group.visible) { car.dispose(); detailed.delete(id); if (detailed.size <= maxDetailed * 2) break; }
    active = want;
    // instances
    const per = {}; let mid = 0;
    for (const [d, r] of vis) if (!want.has(r)) { const t = d < midRadius && mid < maxMid ? (mid++, 'mid') : 'far'; (per[r.kind + ':' + t] ||= []).push(r); }
    for (const kind of Object.keys({ ...inst, ...per })) {
      const list = per[kind] || [];
      const I = ensureInst(kind, list.length);
      list.forEach((r, k) => {
        _m.compose(_v.set(r.x, r.y, r.z), _q.setFromEuler(_e.set(-(r.pitch || 0), r.yaw, 0, 'YXZ')), _s1);
        I.p.setMatrixAt(k, _m); I.r.setMatrixAt(k, _m); I.p.setColorAt(k, col.set(CAR_COLOURS[r.colour] || r.colour));
      });
      I.p.count = I.r.count = list.length;
      I.p.instanceMatrix.needsUpdate = I.r.instanceMatrix.needsUpdate = true;
      if (I.p.instanceColor) I.p.instanceColor.needsUpdate = true;
      if (list.length) { I.p.computeBoundingSphere(); I.r.computeBoundingSphere(); }
      I.p.visible = I.r.visible = list.length > 0;
    }
    dirty = false;
  }
  function syncCar(r, car) {
    car.group.position.set(r.x, r.y, r.z);
    car.group.rotation.set(-(r.pitch || 0), r.yaw, r.roll || 0, 'YXZ');
    car.group.updateMatrixWorld(true);
  }
  // ray vs car boxes (OBB) → {rec, distance}
  function raycast(ray, far = 15) {
    let best = null;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const r of records) {
      const dx = r.x - ray.origin.x, dz = r.z - ray.origin.z; if (dx * dx + dz * dz > (far + 4) ** 2) continue;
      if (Math.abs(r.y - ray.origin.y) > 6) continue;
      const S = carSpec(r.kind), c = Math.cos(-r.yaw), s = Math.sin(-r.yaw);
      const ox = ray.origin.x - r.x, oy = ray.origin.y - r.y, oz = ray.origin.z - r.z;
      o.set(ox * c + oz * s, oy, -ox * s + oz * c);
      d.set(ray.direction.x * c + ray.direction.z * s, ray.direction.y, -ray.direction.x * s + ray.direction.z * c);
      const mn = [-S.W / 2, 0.1, S.zR], mx = [S.W / 2, S.roof, S.zF], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      let t0 = 0, t1 = far;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < mn[k] || oo[k] > mx[k]) { t0 = Infinity; break; } continue; }
        let a = (mn[k] - oo[k]) / dd[k], b = (mx[k] - oo[k]) / dd[k]; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 < far && (!best || t0 < best.distance)) best = { rec: r, distance: t0 };
    }
    return best;
  }
  // distance from p (world) to the car's footprint rectangle
  function distTo(r, p) {
    const S = carSpec(r.kind), c = Math.cos(-r.yaw), s = Math.sin(-r.yaw), ox = p.x - r.x, oz = p.z - r.z;
    const lx = ox * c + oz * s, lz = -ox * s + oz * c;
    const qx = Math.max(Math.abs(lx) - S.W / 2, 0), qz = Math.max(lz - S.zF, S.zR - lz, 0);
    return Math.hypot(qx, qz);
  }
  // look = [dx, dz] (unit, optional): between two cars standing side by side the one the visitor faces wins
  function nearest(p, maxD = 2, look = null) {
    let best = null;
    for (const r of records) {
      if (Math.abs(r.y - p.y) > 1.2) continue; const d = distTo(r, p); if (!(d < maxD)) continue;
      let sc = d; if (look) { const ox = r.x - p.x, oz = r.z - p.z, L = Math.hypot(ox, oz) || 1; sc -= 0.9 * Math.max(0, (ox * look[0] + oz * look[1]) / L); }
      if (!best || sc < best.sc) best = { rec: r, d, sc };
    }
    return best;
  }
  // one more car at run time (a traffic car taken over by the visitor): no clash test, the pose is the caller's
  function addOne(c) {
    const kind = carSpec(c.kind).kind, rec = { id: c.id || 'car:' + records.length, kind, colour: c.colour || 'black', x: c.x, y: c.y || 0, z: c.z, yaw: c.yaw, pitch: 0, src: c.src || 'taken', index: records.length, bay: null, home: { x: c.x, y: c.y || 0, z: c.z, yaw: c.yaw }, driver: c.driver ?? null, disabled: false, moved: true };
    rec.collider = colliderFor(rec); place(rec); records.push(rec); dirty = true; return rec;
  }
  return {
    group, colliders, records, add, addOne, update, raycast, nearest, distTo,
    byId(id) { return records.find(r => r.id === id) || null; },
    carOf(rec) { return detailed.get(rec.id) || null; },
    setFocus(rec) { focus = rec; dirty = true; },
    moved(rec) { place(rec); const car = detailed.get(rec.id); if (car) syncCar(rec, car); dirty = true; if (Math.hypot(rec.x - rec.home.x, rec.z - rec.home.z) > 0.05 || Math.abs(rec.yaw - rec.home.yaw) > 0.01) { rec.moved = true; SESSION_POSES.set(rec.id, { kind: rec.kind, x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, pitch: rec.pitch || 0 }); } else if (rec.moved) { rec.moved = false; SESSION_POSES.delete(rec.id); } },
    /** the cars the visitor has left somewhere (for the traffic to keep clear of) */
    get movedCars() { return records.filter(r => r.moved); },
    markDirty() { dirty = true; },
    get active() { return active; },
    dispose() {
      for (const car of detailed.values()) car.dispose();
      for (const I of Object.values(inst)) { I.p.dispose(); I.r.dispose(); }
      for (const g of Object.values(colGeo)) g.dispose();
      colMat.dispose(); group.parent?.remove(group);
    },
  };
}
