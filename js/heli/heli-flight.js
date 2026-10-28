// heli-flight.js — V26: flight model (assisted, arcade-realistic) + autopilot of the guided tour + manual control.
// Kinematic core: the controller asks for a velocity / climb rate / heading; acceleration, attitude (nose down when
// accelerating, bank in turns), rotor speed follow with realistic limits. Collision: ground, OSM buildings, our towers and
// the landmark models (world.heightAt) — contact = bounce + automatic climb, never stuck.
const G = 9.81, TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const hyp = Math.hypot;

export const TUNE = { cruise: 60, orbitSpan: 1.75, orbitV: 24, climb: 7, descend: 4.5, accel: 5.5, maxFwd: 72, maxSide: 22, yawRate: 1.0, clearance: 38 };

/**
 * createFlight({ world, start: { x, z, heading }, landmarks: [{ id, x, z, r, alt, hold, name }] })
 * world.heightAt(x, z, r) → highest surface; world.terrainY(x, z).
 */
export function createFlight({ world, start, landmarks, onEvent = () => {} }) {
  const s = {
    x: start.x, y: 0, z: start.z, vx: 0, vy: 0, vz: 0, yaw: start.heading, yawRate: 0, pitch: 0, roll: 0,
    rpm: 0, spool: 0, onGround: true, collective: 0, mode: 'tour', phase: 'parked', leg: -1, t: 0, phaseT: 0,
    orbit: null, visited: [], banner: null, recoverT: 0, stuckT: 0, bounces: 0, landedAt: null, holdLog: [],
  };
  const input = { col: 0, yaw: 0, pitch: 0, roll: 0 };          // manual controls, −1..1
  let accX = 0, accZ = 0;
  const ev = (type, data) => { try { onEvent(type, data); } catch (e) { console.warn('[heli] event', e); } };
  const setPhase = (p) => { if (s.phase !== p) { s.phase = p; s.phaseT = 0; ev('phase', { phase: p, leg: s.leg }); } };

  const agl = () => s.y - world.terrainY(s.x, s.z);
  /** Desired-velocity controller used by the autopilot. */
  function seek(tx, ty, tz, speed, dt, faceYaw = null, arrive = true) {
    const dx = tx - s.x, dz = tz - s.z, d = hyp(dx, dz);
    let v = speed; if (arrive) v = Math.min(speed, Math.sqrt(2 * TUNE.accel * 0.8 * Math.max(0, d - 2)) + 0.5);
    const ux = d > 0.01 ? dx / d : 0, uz = d > 0.01 ? dz / d : 0;
    const wantVx = ux * v, wantVz = uz * v;
    // terrain / building clearance ahead (look 2–6 s ahead)
    let floor = world.heightAt(s.x, s.z, 8);
    for (const k of [1.5, 3, 5]) { const ax = s.x + s.vx * k, az = s.z + s.vz * k; floor = Math.max(floor, world.heightAt(ax, az, 12)); }
    const wantY = Math.max(ty, floor + (s.phase === 'land' || s.phase === 'takeoff' ? 0 : TUNE.clearance * 0.6));
    const wantVy = clamp((wantY - s.y) * 0.6, -TUNE.descend, TUNE.climb);
    steer(wantVx, wantVy, wantVz, dt, faceYaw);
    return d;
  }
  function steer(wvx, wvy, wvz, dt, faceYaw, amax = TUNE.accel) {
    const ax = clamp((wvx - s.vx) * 1.4, -amax, amax), az = clamp((wvz - s.vz) * 1.4, -amax, amax);
    const al = hyp(ax, az), k = al > amax ? amax / al : 1;
    accX = ax * k; accZ = az * k;
    s.vx += accX * dt; s.vz += accZ * dt;
    s.vy += clamp((wvy - s.vy) * 1.5, -4, 4) * dt;
    const sp = hyp(s.vx, s.vz);
    let want = faceYaw;
    if (want == null) want = sp > 4 ? Math.atan2(s.vx, s.vz) : s.yaw;
    const e = wrap(want - s.yaw), rate = clamp(e * 1.4, -TUNE.yawRate, TUNE.yawRate);
    s.yawRate += (rate - s.yawRate) * Math.min(1, dt * 3); s.yaw = wrap(s.yaw + s.yawRate * dt);
    s.collective = clamp(0.35 + wvy / 10 + al / 20, 0, 1);
  }
  function manual(dt) {
    // body-frame wishes → world velocity; the visitor flies, the machine keeps it stable
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = -Math.cos(s.yaw), rz = Math.sin(s.yaw);
    const vf = input.pitch * (input.pitch > 0 ? TUNE.maxFwd : 18), vr = input.roll * TUNE.maxSide;
    const wvx = fx * vf + rx * vr, wvz = fz * vf + rz * vr;
    let wvy = input.col * (input.col > 0 ? TUNE.climb + 3 : TUNE.descend + 2);
    if (s.onGround && input.col <= 0.05) wvy = 0;
    const ax = clamp((wvx - s.vx) * 0.9, -TUNE.accel, TUNE.accel), az = clamp((wvz - s.vz) * 0.9, -TUNE.accel, TUNE.accel);
    accX = ax; accZ = az; if (!s.onGround || input.col > 0.05) { s.vx += ax * dt; s.vz += az * dt; } else { s.vx *= 0.8; s.vz *= 0.8; }
    s.vy += clamp((wvy - s.vy) * 1.6, -5, 5) * dt;
    const sp = hyp(s.vx, s.vz), coord = sp > 15 ? input.roll * 0.35 : 0;          // banked turn at speed
    const rate = (input.yaw + coord) * TUNE.yawRate * 1.1;
    s.yawRate += (rate - s.yawRate) * Math.min(1, dt * 4); if (!s.onGround) s.yaw = wrap(s.yaw + s.yawRate * dt); else s.yawRate = 0;
    s.collective = clamp(0.4 + input.col * 0.5, 0, 1);
  }

  // ---------------------------------------------------------------- tour logic
  function nextLeg() {
    s.leg++; s.orbit = null;
    if (s.leg >= landmarks.length) { setPhase('return'); s.banner = null; ev('tour-end', {}); return; }
    setPhase('transit'); s.banner = null; ev('leg', { leg: s.leg, lm: landmarks[s.leg] });
  }
  function tour(dt) {
    const P = s.phase;
    if (P === 'parked' || P === 'landed') { s.vx = s.vy = s.vz = 0; return; }
    if (P === 'spinup') { s.vx = s.vy = s.vz = 0; if (s.rpm > 0.985) { setPhase(s.mode === 'manual' ? 'free' : 'takeoff'); } return; }
    if (P === 'takeoff') {                                       // vertical lift-off, hover check, then climb out along the road
      const hov = s.phaseT < 4.5;
      if (hov) { steer(0, s.y < 6 ? 2.2 : 0.3, 0, dt, start.heading); }
      else { const fx = Math.sin(start.heading), fz = Math.cos(start.heading); steer(fx * Math.min(30, (s.phaseT - 4.5) * 6), 6, fz * Math.min(30, (s.phaseT - 4.5) * 6), dt, start.heading); }
      if (s.y > 60 || s.phaseT > 14) nextLeg();
      return;
    }
    if (P === 'transit') {
      const L = landmarks[s.leg];
      if (!s.plan || s.plan.L !== L) {                            // orbit direction: the one that ends nearer to the next landmark (or home)
        const N = landmarks[s.leg + 1] || { x: start.x, z: start.z }, span = Math.min(TUNE.orbitSpan * (L.hold > 10 ? 1.7 : 1), TUNE.orbitV * (L.hold > 10 ? 0.75 : 1) * L.hold / L.r);
        const vOrb = span * L.r / L.hold;
        const tang = (dir) => {                                    // tangent point from the helicopter whose orbit runs in `dir`
          const dx = s.x - L.x, dz = s.z - L.z, d = Math.max(L.r * 1.02, hyp(dx, dz)), a = Math.atan2(dx, dz), off = Math.acos(L.r / d);
          return a + dir * off;                                    // circle angle where the path touches it
        };
        const end = (dir) => { const a = tang(dir) + dir * span; return hyp(L.x + Math.sin(a) * L.r - N.x, L.z + Math.cos(a) * L.r - N.z); };
        const dir = end(1) < end(-1) ? 1 : -1;
        s.plan = { L, dir, span, vOrb };
      }
      const { dir, span, vOrb } = s.plan;
      const dx = s.x - L.x, dz = s.z - L.z, d = hyp(dx, dz) || 1;
      let a0, ex, ez;
      let now = false, band = false;
      if (d < L.r * 0.85) { band = true; a0 = Math.atan2(dx, dz) + dir * 0.6; ex = L.x + Math.sin(a0) * L.r; ez = L.z + Math.cos(a0) * L.r; }
      else if (d <= L.r * 1.12) {
        band = true;
        const sp0 = hyp(s.vx, s.vz) || 1, rad = (s.vx * dx + s.vz * dz) / d / sp0, tan = (s.vx * dz - s.vz * dx) / d / sp0 * dir;   // tangential share in the orbit's sense
        a0 = Math.atan2(dx, dz);
        if (Math.abs(rad) < 0.45 && tan > 0.5 && sp0 < s.plan.vOrb * 1.7) { ex = s.x; ez = s.z; now = true; }
        else { const aa = a0 + dir * 0.45; ex = L.x + Math.sin(aa) * L.r; ez = L.z + Math.cos(aa) * L.r; }
      }
      else { const a = Math.atan2(dx, dz), off = Math.acos(L.r / d); a0 = a + dir * off; ex = L.x + Math.sin(a0) * L.r; ez = L.z + Math.cos(a0) * L.r; }
      const ty = L.alt + world.terrainY(L.x, L.z);
      const remain = hyp(ex - s.x, ez - s.z), sp = hyp(s.vx, s.vz);
      const brake = Math.sqrt(vOrb * vOrb + 2 * TUNE.accel * 0.6 * Math.max(0, remain - 15));
      seek(ex, ty, ez, Math.min(TUNE.cruise, brake), dt, null, false);
      const late = s.phaseT > 40 && d < L.r * 1.6;                  // safety: never circle around the entry for long
      if ((remain < 35 && !band) || now || late) {
        if (late && !now) a0 = Math.atan2(dx, dz);
        const r = remain < 35 && !now && !late ? L.r : Math.max(L.r * 0.75, Math.min(L.r * 1.4, d));
        s.orbit = { a0, dir, span: span * L.r / r, t: 0, L, vOrb, r }; s.plan = null; setPhase('orbit'); s.banner = L; ev('orbit', { leg: s.leg, lm: L });
      }
      return;
    }
    if (P === 'orbit') {
      const o = s.orbit, L = o.L; o.t += dt;
      const k = Math.min(1, o.t / L.hold), a = o.a0 + o.dir * o.span * k;
      const R = o.r || L.r, px = L.x + Math.sin(a) * R, pz = L.z + Math.cos(a) * R, v = o.vOrb;
      const tvx = Math.cos(a) * o.dir * v, tvz = -Math.sin(a) * o.dir * v;
      const ty = L.alt + world.terrainY(L.x, L.z);
      const floor = world.heightAt(s.x, s.z, 10) + 22;
      // centripetal feed-forward + position correction
      const cx = -Math.sin(a) * v * v / R, cz = -Math.cos(a) * v * v / R;
      steer(tvx + (px - s.x) * 0.9 + cx * 0.6, clamp((Math.max(ty, floor) - s.y) * 0.6, -3, 4), tvz + (pz - s.z) * 0.9 + cz * 0.6, dt, Math.atan2(L.x - s.x, L.z - s.z) - o.dir * 0.9, 8);
      if (o.t >= L.hold) { s.visited.push(L.id); s.holdLog.push({ id: L.id, hold: +o.t.toFixed(2), r: L.r }); ev('orbit-done', { leg: s.leg, lm: L }); nextLeg(); }
      return;
    }
    if (P === 'return' || P === 'goland') {
      const hx = start.x, hz = start.z; const d = seek(hx, 45, hz, TUNE.cruise, dt, null, true);
      if (d < 6 && hyp(s.vx, s.vz) < 2.5) setPhase('land');
      return;
    }
    if (P === 'land') {
      const g = world.terrainY(start.x, start.z), h = s.y - g;
      const wvy = -clamp(0.6 + h * 0.18, 0.6, TUNE.descend);
      steer((start.x - s.x) * 0.8, h < 0.3 ? -0.4 : wvy, (start.z - s.z) * 0.8, dt, start.heading);
      return;
    }
  }

  // ---------------------------------------------------------------- integration + collision
  function step(dt) {
    dt = Math.min(dt, 0.05); s.t += dt; s.phaseT += dt;
    // rotor: spool up when started, down when landed
    const wantRpm = s.phase === 'parked' ? 0 : s.phase === 'landed' ? (s.phaseT > 4 ? 0 : 0.6) : 1;
    s.spool += clamp(wantRpm - s.spool, -dt / 6, dt / (s.phase === 'spinup' ? 5 : 3));
    const lead = Math.max(0, Math.min(1, s.spool * 1.1 - 0.1));
    s.rpm += clamp(lead - s.rpm, -dt / 9, dt / (s.phase === 'spinup' ? 9 : 4));
    if (s.mode === 'manual' && s.phase === 'landed' && input.col > 0.2) setPhase('free');
    if (s.mode === 'manual' && s.phase === 'free') manual(dt); else if (s.mode === 'manual' && s.phase === 'spinup') tour(dt); else if (s.mode === 'manual' && s.phase === 'landed') { s.vx = s.vz = 0; s.vy = Math.min(0, s.vy); } else tour(dt);
    const lift = s.rpm > 0.9;
    if (!lift && !s.onGround) s.vy -= G * 0.4 * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    // keep inside the world (≈ 14 km around the city)
    const R = hyp(s.x - 700, s.z + 500); if (R > 14000) { s.x = 700 + (s.x - 700) * 14000 / R; s.z = -500 + (s.z + 500) * 14000 / R; s.vx *= -0.3; s.vz *= -0.3; }
    s.y = Math.min(s.y, 1200);
    // collision: skids against ground / roofs, rotor disc against walls
    const g = world.terrainY(s.x, s.z), top = world.heightAt(s.x, s.z, 1.6);
    if (s.y < top) {
      if (top - g > 1.5 && s.y < top - 0.8) {                    // into a building: bounce up and back, recover
        s.y = top + 0.6; s.vy = Math.max(3, Math.abs(s.vy) * 0.4); s.vx *= -0.35; s.vz *= -0.35; s.bounces++; s.recoverT = 2.5; ev('bounce', { x: s.x, z: s.z });
      } else {                                                    // ground / roof contact: touchdown
        s.y = top; if (s.vy < 0) s.vy = 0; s.vx *= 0.9; s.vz *= 0.9;
      }
    }
    s.onGround = s.y <= top + 0.05;
    // rotor clearance: walls within 6 m above the skids → push away
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU, px = s.x + Math.sin(a) * 6.2, pz = s.z + Math.cos(a) * 6.2, h = world.heightAt(px, pz, 0);
      if (h - g > 2 && h > s.y + 1.2) { s.x -= Math.sin(a) * 0.35; s.z -= Math.cos(a) * 0.35; const vn = s.vx * Math.sin(a) + s.vz * Math.cos(a); if (vn > 0) { s.vx -= Math.sin(a) * vn * 1.4; s.vz -= Math.cos(a) * vn * 1.4; } if (s.recoverT <= 0) { s.recoverT = 1.5; s.bounces++; ev('bounce', { x: s.x, z: s.z, side: true }); } s.vy = Math.max(s.vy, 1.5); }
    }
    // stuck guard: inside a footprint under its roof for 0.6 s → lift above it
    if (top - g > 1.5 && s.y < top - 0.2) { s.stuckT += dt; if (s.stuckT > 0.6) { s.y = top + 3; s.vy = 2; s.stuckT = 0; ev('unstick', {}); } } else s.stuckT = 0;
    if (s.recoverT > 0) { s.recoverT -= dt; if (s.mode === 'manual') s.vy = Math.max(s.vy, 2.5); }
    if (s.phase === 'land' && s.onGround && s.y - g < 0.2) { s.landedAt = { x: s.x, z: s.z, y: s.y }; setPhase('landed'); s.vx = s.vy = s.vz = 0; ev('landed', s.landedAt); }
    // attitude (visual): nose down when accelerating forward, bank into lateral acceleration / turns
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = -Math.cos(s.yaw), rz = Math.sin(s.yaw);
    const sp = hyp(s.vx, s.vz), vF = s.vx * fx + s.vz * fz;
    const aF = accX * fx + accZ * fz, aR = accX * rx + accZ * rz, cent = sp * s.yawRate;
    const wantPitch = s.onGround ? 0 : clamp(-Math.atan2(aF, G) - vF / TUNE.maxFwd * 0.12, -0.38, 0.3);
    const wantRoll = s.onGround ? 0 : clamp(Math.atan2(aR - cent * 0.9, G), -0.55, 0.55);
    s.pitch += (wantPitch - s.pitch) * Math.min(1, dt * 2.2); s.roll += (wantRoll - s.roll) * Math.min(1, dt * 2.2);
  }

  return {
    s, input, TUNE,
    get speed() { return hyp(s.vx, s.vz); }, get agl() { return agl(); },
    start() { if (s.phase === 'parked') { setPhase('spinup'); } },
    setMode(m) {
      if (m === s.mode) return; s.mode = m;
      if (m === 'manual') { if (!['parked', 'spinup', 'landed'].includes(s.phase)) setPhase('free'); s.banner = null; }
      else {
        if (s.phase === 'landed') { s.leg = -1; s.visited = []; s.holdLog = []; setPhase('spinup'); }
        else if (s.phase === 'free' || s.phase === 'goland') { if (s.leg < 0) nextLeg(); else if (s.leg >= landmarks.length) setPhase('return'); else { setPhase('transit'); ev('leg', { leg: s.leg, lm: landmarks[s.leg] }); } }
      }
      ev('mode', { mode: m });
    },
    /** fly back to the start spot and land (from any state) */
    land() { if (s.phase === 'landed' || s.phase === 'parked') return; s.mode = 'tour'; setPhase('goland'); s.banner = null; ev('mode', { mode: 'tour' }); },
    takeoffAgain() { if (s.phase === 'landed') { s.leg = -1; s.visited = []; s.holdLog = []; setPhase('spinup'); } },
    step,
  };
}
