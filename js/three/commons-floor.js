// ЖК VILNYI — one residential floor of a point tower (T14): lift hall + corridor from the plate's hall rects, flat
// entrance doors, lift fronts, the stair door, the open common balcony and, on floor 1, the entrance lobby.
//
// Everything is building-local (x right, z DOWN the sheet, z is negative inside a plate — notes/T02.md). The module
// imports only ../data.js; three.js and every shared builder come through the KIT that commons.js passes (CONTRACT §4.2).
//
// Run convention (= data.js hallEdgesOf = commons.js wallRun): { axis:'x'|'z', c, a0, a1, side }. axis 'x' is a wall
// along x at z = c; `side` points from the wall line INTO the hall. P(run, a, d) is the point at coordinate `a` along
// the wall, `d` metres from the line toward the hall.
import { plateOf, hallEdgesOf, coresOf, unitsOn, blocksOn, unitToLocal, unitYaw, floorH, isGround, floorLabel, interiorOf } from '../data.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const P = (r, a, d = 0) => (r.axis === 'x' ? [a, r.c + r.side * d] : [r.c + r.side * d, a]);
const inward = r => (r.axis === 'x' ? [0, r.side] : [r.side, 0]);
const yawOfRun = r => (r.axis === 'x' ? (r.side > 0 ? 0 : Math.PI) : (r.side > 0 ? Math.PI / 2 : -Math.PI / 2));   // object +z → into the hall
const rectOf = (r, a0, a1, d0, d1) => { const [xa, za] = P(r, a0, d0), [xb, zb] = P(r, a1, d1); return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) }; };
const hit = (p, q) => p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1;
const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const langOf = () => { try { return (typeof document !== 'undefined' && document.documentElement.lang) || 'uk'; } catch { return 'uk'; } };
const text = o => (o && (o[langOf()] || o.uk || o.en)) || '';

// ============================================================ plan (pure data, no three.js)
function planFloor(K, bId, floor) {
  const plate = plateOf(bId, floor);
  if (!plate) throw new Error(`commons-floor: no plate for ${bId} floor ${floor}`);
  const { DOOR_W, DOOR_H, LIFT_W, LIFT_H, POCKET } = K;
  const ground = isGround(floor);
  const H = ground ? Math.min(3.0, floorH(bId, floor) - 0.4) : 2.6;
  const hall = plate.hall, core = coresOf(bId, floor)[0];
  const runs = hallEdgesOf(bId, floor).map((e, i) => ({ ...e, i, openings: [], zones: [], len: e.a1 - e.a0 }));
  const inHall = (x, z, m = 0) => { const t = (px, pz) => hall.some(r => inRect(r, px, pz, 0.012)); return m ? t(x - m, z - m) && t(x + m, z - m) && t(x - m, z + m) && t(x + m, z + m) : t(x, z); };
  const ext = o => (o.kind === 'lift' ? POCKET : o.w / 2);
  const runFree = (run, c, half, margin = 0.12) => c - half >= run.a0 + 0.04 && c + half <= run.a1 - 0.04 && run.openings.every(o => Math.abs(c - o.c) >= half + ext(o) + margin);
  const scanFree = (run, lo, hi, half, target, margin) => {       // free centre in [lo, hi] nearest to target
    let best = null;
    for (let a = Math.max(lo, run.a0 + half + 0.05); a <= Math.min(hi, run.a1 - half - 0.05) + 1e-6; a += 0.05)
      if (runFree(run, a, half, margin) && (best == null || Math.abs(a - target) < Math.abs(best - target))) best = a;
    return best;
  };
  const runAt = (axis, c, a, side) => runs.find(r => r.axis === axis && Math.abs(r.c - c) < 0.06 && a >= r.a0 - 0.02 && a <= r.a1 + 0.02 && (side == null || r.side === side));
  const runOfPoint = (x, z, n) => {                               // run a point with normal n (into the hall) lies on
    const axis = Math.abs(n[1]) > 0.5 ? 'x' : 'z', side = Math.sign(axis === 'x' ? n[1] : n[0]);
    return axis === 'x' ? runAt('x', z, x, side) || runAt('x', z, x) : runAt('z', x, z, side) || runAt('z', x, z);
  };
  const along = (run, x, z) => (run.axis === 'x' ? x : z);
  const warn = [];

  // ---- flats
  const units = [];
  for (const u of unitsOn(bId, floor)) {
    const [x, z] = unitToLocal(u, u.door.u, 0);
    let run = u.run && runAt(u.run.axis, u.run.c, u.doorA, u.run.side);
    if (!run) run = runOfPoint(x, z, [-u.frame.V[0], -u.frame.V[1]]);
    if (!run) {   // last resort: nearest run by distance
      let bd = 1e9;
      for (const r of runs) { const a = clamp(along(r, x, z), r.a0, r.a1), [px, pz] = P(r, a), d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; run = r; } }
      warn.push(`${u.id}: door not on a hall edge (${bd.toFixed(2)} m)`);
    }
    const a = along(run, x, z);
    // (V4) the opening is as high as the flat's real entrance door (2.10 m in the data) — with the kit's 2.20 a dark slot
    // showed above the leaf of a loaded flat; the hall's own closed leaf simply ends inside the lintel
    let dh = DOOR_H; try { const I = interiorOf(u), e = I && I.doors.find(q => q.type === 'entrance'); if (e && e.h > 1.9) dh = Math.min(DOOR_H, e.h + 0.012); } catch { dh = DOOR_H; }
    const op = { c: a, w: DOOR_W, h: dh, kind: 'door', unitId: u.id };
    run.openings.push(op); units.push({ u, run, a, x, z, op });
  }
  // ---- lifts
  const lifts = [];
  (core.lifts || []).forEach((l, i) => {
    const run = runOfPoint(l.door[0], l.door[1], l.n);
    if (!run) { warn.push(`lift ${l.id}: door not on a hall edge`); lifts.push({ l, i, run: null }); return; }
    const a = along(run, l.door[0], l.door[1]);
    run.openings.push({ c: a, w: LIFT_W, h: LIFT_H, kind: 'lift' });
    lifts.push({ l, i, run, a });
  });

  // ---- open common balcony (typical floors of B1, B3, B4): pass from the hall, stair door on the balcony
  let balcony = null;
  const bal = (plate.core && plate.core.balcony) || core.balcony;
  const stairDone = new Set();
  if (bal) {
    let best = null;
    for (const run of runs) {
      const o = -run.side, x = run.axis === 'x';
      const [lo, hi] = x ? [bal.x0, bal.x1] : [bal.z0, bal.z1];
      const cb = x ? (o < 0 ? bal.z1 : bal.z0) : (o < 0 ? bal.x1 : bal.x0), far = x ? (o < 0 ? bal.z0 : bal.z1) : (o < 0 ? bal.x0 : bal.x1);
      const gap = (cb - run.c) * o;
      if (gap < -0.3 || gap > 1.3) continue;
      const ov0 = Math.max(lo, run.a0), ov1 = Math.min(hi, run.a1);
      if (ov1 - ov0 < 1.15) continue;
      const a = scanFree(run, ov0 + 0.1, ov1 - 0.1, 0.5, (ov0 + ov1) / 2, 0.2);
      if (a == null) continue;
      if (!best || ov1 - ov0 > best.ov) best = { run, o, lo, hi, cb: gap < 0.02 ? run.c + o * 0.02 : cb, far, a, ov: ov1 - ov0 };
    }
    if (best) {
      const { run, o, lo, hi, cb, far, a } = best;
      const pass = { c: a, w: 1.0, h: 2.15, kind: 'pass' };
      run.openings.push(pass);
      const brun = { axis: run.axis, c: cb, side: o, a0: lo, a1: hi, len: hi - lo, openings: [{ ...pass }], zones: [], balcony: true };
      balcony = { rect: { x0: bal.x0, x1: bal.x1, z0: bal.z0, z1: bal.z1 }, from: run, run: brun, pass, o, far, depth: Math.abs(far - cb), stair: null };
      (core.stairs || []).forEach((st, si) => {
        if (balcony.stair) return;
        const x = run.axis === 'x', [s0, s1] = x ? [st.x0, st.x1] : [st.z0, st.z1];
        const face = x ? (o < 0 ? st.z0 : st.z1) : (o < 0 ? st.x0 : st.x1), g = (cb - face) * o;
        if (g < -0.25 || g > 1.0) return;
        const i0 = Math.max(s0 + 0.1, lo + 0.25), i1 = Math.min(s1 - 0.1, hi - 0.25);
        const sa = scanFree(brun, i0, i1, 0.5, (i0 + i1) / 2, 0.25);
        if (sa == null) return;
        const op = { c: sa, w: 0.95, h: 2.1, kind: 'service' };
        brun.openings.push(op); balcony.stair = { a: sa, op, st }; stairDone.add(si);
      });
    } else warn.push('balcony: no hall edge beside it');
  }

  // ---- service doors on hall edges: stairs without a balcony route, technical rooms (pram room, security …)
  const service = [];
  const behindIn = (run, a, rect) => { const [x, z] = P(run, a, -0.4); return inRect(rect, x, z) && !inHall(x, z); };
  const serviceDoor = (rect, hint, kind, label, trustHint) => {
    let best = null;
    const tryRun = (run, target, check) => {
      for (let a = run.a0 + 0.55; a <= run.a1 - 0.55 + 1e-6; a += 0.05) {
        if (!runFree(run, a, 0.5, 0.18) || (check && !(behindIn(run, a - 0.42, rect) && behindIn(run, a + 0.42, rect)))) continue;
        const [x, z] = P(run, a), d = Math.hypot(x - target[0], z - target[1]);
        if (!best || d < best.d) best = { run, a, d };
      }
    };
    if (trustHint) { const run = runOfPoint(hint.p[0], hint.p[1], hint.n); if (run) tryRun(run, hint.p, false); if (best && best.d > 1.6) best = null; }
    if (!best) for (const run of runs) tryRun(run, hint.p, true);
    if (!best) return null;
    const op = { c: best.a, w: 0.95, h: 2.1, kind: 'service' };
    best.run.openings.push(op);
    const rec = { run: best.run, a: best.a, op, kind, label };
    service.push(rec); return rec;
  };
  const stairs = (core.stairs || []).map((st, si) => ({ st, si })).filter(s => !stairDone.has(s.si)).sort((p, q) => (p.st.est ? 1 : 0) - (q.st.est ? 1 : 0));
  let haveStair = stairDone.size > 0;
  for (const { st } of stairs) {
    if (st.est && haveStair) continue;                            // estimated secondary stairs (basement flight) get no door
    if (serviceDoor(st, { p: st.door, n: st.n }, 'stair', null, true)) haveStair = true;
  }
  if (!haveStair && (core.stairs || []).length) warn.push('stair: no room for a door');
  const blocks = blocksOn(bId, floor);
  for (const b of blocks) if (b.kind === 'technical') serviceDoor(b, { p: [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], n: [0, 1] }, 'room', b.label, false);

  // ---- entrance (floor-1 plate)
  let entrance = null;
  if (plate.entrance) {
    const e = plate.entrance, run = runOfPoint(e.p[0], e.p[1], [-e.n[0], -e.n[1]]);
    if (run) {
      const a = along(run, e.p[0], e.p[1]);
      let w = 1.9;
      for (const o of run.openings) w = Math.min(w, 2 * (Math.abs(a - o.c) - ext(o) - 0.12));
      w = Math.min(w, 2 * (a - run.a0) - 0.1, 2 * (run.a1 - a) - 0.1);
      if (w >= 0.85) { const op = { c: a, w, h: Math.min(2.5, H - 0.3), kind: 'pass', noTrim: true }; run.openings.push(op); entrance = { p: e.p, n: e.n, t: [-e.n[1], e.n[0]], run, a, w, op }; }
      else warn.push('entrance: no room on its hall edge');
    } else warn.push('entrance: not on a hall edge');
  }

  // ---- number plate side of every flat door (the side of the door with free wall), 0 = none → plate above the door
  for (const d of units) {
    const ok = s => { const pa = d.a + s * (DOOR_W / 2 + 0.2); return pa - 0.13 >= d.run.a0 && pa + 0.13 <= d.run.a1 && d.run.openings.every(o => o === d.op || Math.abs(pa - o.c) >= ext(o) + 0.2); };
    const U = d.u.frame.U, pref = Math.sign(d.run.axis === 'x' ? U[0] : U[1]) || 1;
    d.plateSide = ok(pref) ? pref : ok(-pref) ? -pref : 0;
  }
  // ---- finishes
  const lobby = blocks.find(b => b.kind === 'lobby') || null;
  for (const run of runs) {
    const mid = P(run, (run.a0 + run.a1) / 2, 0.3);
    run.finish = ground && lobby && inRect(lobby, mid[0], mid[1], 0.3) ? 'marble' : 'fabric';
    for (const o of run.openings) if (o.kind === 'lift') run.zones.push({ a0: o.c - 1.7, a1: o.c + 1.7, mat: 'marble' });
    for (const o of run.openings) if (o.kind === 'door') run.zones.push({ a0: o.c - 0.95, a1: o.c + 0.95, mat: 'walnut' });
  }
  return { bId, floor, plate, ground, H, hall, core, runs, units, lifts, balcony, service, entrance, lobby, blocks, inHall, runFree, scanFree, ext, warn };
}

// ============================================================ build
/** One tower floor (floors ≥ 1, the ground floor included) → CommonsResult (CONTRACT §4.2). */
export function buildTowerFloor(KIT, bId, floor) {
  const K = KIT, { THREE, M, FACE, SKIN, WALL_T, DOOR_W, DOOR_H, LIFT_W, LIFT_H, POCKET } = K;
  const pl = planFloor(K, bId, floor);
  const { H, ground, hall, core, runs, inHall } = pl;
  const ctx = K.makeCtx(bId, floor, H);
  const { B, C, root } = ctx;
  const soft = (fn, what) => { try { return fn(); } catch (e) { pl.warn.push(`${what}: ${e && e.message}`); return null; } };   // decor must never break the floor
  const rb = (mat, r, a0, a1, y0, y1, d0, d1) => { const q = rectOf(r, a0, a1, d0, d1); B.box(mat, q.x0, q.x1, y0, y1, q.z0, q.z1); };
  const rc = (r, a0, a1, y0, y1, d0, d1) => { const q = rectOf(r, a0, a1, d0, d1); C.box(q.x0, q.x1, y0, y1, q.z0, q.z1); };
  const mat4 = K.mat4;
  if (ground) root.position.y += 0.01;   // stay clear of the site ground plane (y = 0) that runs under the footprints (as commons.js fallbackFloor does)
  // walkable rect: grown by 1 cm and cut into pieces ≤ 12 m that overlap by 4 cm, so the collider grid of the KIT never
  // leaves a hairline seam under the walker's down-ray (neither inside a long rect nor between two abutting hall rects)
  const floorRect = (x0, x1, z0, z1) => {
    const g = 0.01, alongX = x1 - x0 >= z1 - z0, lo = (alongX ? x0 : z0) - g, hi = (alongX ? x1 : z1) + g, n = Math.max(1, Math.ceil((hi - lo) / 12));
    for (let i = 0; i < n; i++) {
      const p0 = lo + (hi - lo) * i / n - (i ? 0.02 : 0), p1 = lo + (hi - lo) * (i + 1) / n + (i < n - 1 ? 0.02 : 0);
      if (alongX) C.rect(p0, p1, z0 - g, z1 + g, 0); else C.rect(x0 - g, x1 + g, p0, p1, 0);
    }
  };

  // ---- floor + ceiling per hall rect
  const floorMat = ground ? 'marbleFloor' : 'stone';
  for (const r of hall) {
    B.box(floorMat, r.x0, r.x1, -0.3, 0, r.z0, r.z1); floorRect(r.x0, r.x1, r.z0, r.z1);
    const w = r.x1 - r.x0, d = r.z1 - r.z0, s = Math.min(w, d), l = Math.max(w, d);
    if (s >= 1.5 && l >= 2.2 && K.ceilingRect) K.ceilingRect(ctx, r, w >= d, H); else B.box('plaster', r.x0, r.x1, H, H + 0.04, r.z0, r.z1);
    if (!ground && s >= 1.5 && s <= 2.7 && l >= 4.5 && K.runner) soft(() => {
      const hw = Math.min(0.6, s / 2 - 0.42);
      if (w >= d) K.runner(ctx, r.x0 + 0.5, r.x1 - 0.5, (r.z0 + r.z1) / 2 - hw, (r.z0 + r.z1) / 2 + hw, true);
      else K.runner(ctx, (r.x0 + r.x1) / 2 - hw, (r.x0 + r.x1) / 2 + hw, r.z0 + 0.5, r.z1 - 0.5, false);
    }, 'runner');
  }

  // ---- sign atlas of this floor: the floor numeral + the names of the service rooms (from the plate's block labels)
  const labels = pl.service.filter(s => s.kind === 'room').map(s => text(s.label));
  const signs = makeSigns(THREE, floorLabel(floor), labels);
  ctx.ownTex.push(signs.tex);
  const signQuad = (cell, w, h, x, y, z, yaw) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [u0, v0, du, dv] = signs.uv(cell);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
    B.add(signs.mat, g, mat4(x, y, z, yaw));
  };

  // ---- flat doors: number plates
  K.setupPlates(ctx, pl.units.map(d => String(d.u.apNo)));
  ctx.doors = pl.units.map(d => ({ unitId: d.u.id, x: d.x, z: d.z, yaw: unitYaw(d.u) }));
  const sink = { add() { return this; }, box() { return this; } };
  pl.units.forEach((d, i) => {
    const U = d.u.frame.U, cur = Math.sign(d.run.axis === 'x' ? U[0] : U[1]) || 1, s = d.plateSide || cur;
    const dd = { unitId: d.u.id, apNo: d.u.apNo, a: d.a, U: s === cur ? U : [-U[0], -U[1]] };
    const run = { axis: d.run.axis, c: d.run.c, side: d.run.side };
    if (d.plateSide) { K.placeDoor(ctx, dd, run, i); return; }
    // no free wall beside this door: keep the leaf, drop the side plate + bell, put the number above the door
    const n0 = ctx.leaves.length;
    soft(() => K.placeDoor({ ...ctx, B: sink, plateB: sink, bells: [] }, dd, run, i), 'door ' + d.u.id);
    if (ctx.leaves.length === n0) { K.placeDoor(ctx, dd, run, i); return; }
    if (ctx.plates && ctx.plateB && ctx.plateMat) soft(() => {
      const [px, pz] = P(d.run, d.a, FACE + SKIN + 0.05), yaw = yawOfRun(d.run);
      const g = new THREE.PlaneGeometry(0.17, 0.085), uv = g.attributes.uv, [u0, v0, du, dv] = ctx.plates.uv(i);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * du, v0 + uv.getY(k) * dv);
      ctx.plateB.add(ctx.plateMat, g, mat4(px, DOOR_H + 0.14, pz, yaw));
      B.add('brass', K.boxGeo(-0.093, 0.093, -0.05, 0.05, -0.012, -0.0012), mat4(px, DOOR_H + 0.14, pz, yaw));
    }, 'plate ' + d.u.id);
    // the bell push still goes beside the door when 13 cm of wall are free there (else this flat has no bell: warning)
    const fits = sd => { const pa = d.a + sd * (DOOR_W / 2 + 0.105); return pa - 0.04 >= d.run.a0 && pa + 0.04 <= d.run.a1 && d.run.openings.every(o => o === d.op || Math.abs(pa - o.c) >= pl.ext(o) + 0.1); };
    const bs = fits(cur) ? cur : fits(-cur) ? -cur : 0;
    if (bs) { const [bx, bz] = P(d.run, d.a + bs * (DOOR_W / 2 + 0.105), FACE + SKIN + 0.004); ctx.bells.push({ unitId: d.u.id, m: mat4(bx, 1.35, bz, yawOfRun(d.run)) }); }
    else {   // door in a pocket as wide as itself: the bell goes on the pocket's side wall, 22 cm in front of the door wall
      let done = false;
      for (const sd of [cur, -cur]) {
        const e = sd > 0 ? d.run.a1 : d.run.a0, aq = d.run.c + d.run.side * 0.22;
        if (done || Math.abs(e - (d.a + sd * DOOR_W / 2)) > 0.35) continue;
        const q = runs.find(q => q.axis !== d.run.axis && q.side === -sd && Math.abs(q.c - e) < 0.02 && aq - 0.05 >= q.a0 && aq + 0.05 <= q.a1 && q.openings.every(o => Math.abs(aq - o.c) >= pl.ext(o) + 0.1));
        if (!q) continue;
        const [bx, bz] = P(q, aq, FACE + SKIN + 0.004); ctx.bells.push({ unitId: d.u.id, m: mat4(bx, 1.35, bz, yawOfRun(q)) }); done = true;
      }
      if (!done) pl.warn.push(`${d.u.id}: no wall for a bell push`);
    }
  });

  // flats without a 3D interior (walk:false): same closed leaf and action, flagged so the walkthrough can answer "by plan only"
  for (const d of pl.units) if (d.u.walk === false) { const leaf = ctx.leaves.find(l => l.userData.unitId === d.u.id); if (leaf) { leaf.userData.planOnly = true; leaf.userData.action.planOnly = true; } }

  // ---- lifts
  for (const L of pl.lifts) {
    ctx.lifts.push(new K.Lift(bId, 0, L.i, floor, ground ? { rear: false } : {}));
    if (!L.run) continue;
    for (const s of [-1, 1]) {   // the wall beside the opening hides the door pocket: keep it solid
      const a0 = L.a + s * LIFT_W / 2, a1 = L.a + s * POCKET;
      rc(L.run, Math.min(a0, a1), Math.max(a0, a1), 0, LIFT_H + 0.1, -0.03, FACE + 0.03);
    }
  }
  const l0 = pl.lifts.find(L => L.run);
  if (l0) {
    const run = l0.run, mate = pl.lifts.find(L => L !== l0 && L.run === run && Math.abs(L.a - l0.a) < 3.2);
    const okAt = a => a > run.a0 + 0.12 && a < run.a1 - 0.12 && run.openings.every(o => Math.abs(a - o.c) > o.w / 2 + 0.12);
    const cand = mate ? [(l0.a + mate.a) / 2, l0.a - 0.9, l0.a + 0.9] : [l0.a + 0.9, l0.a - 0.9, l0.a + 0.75, l0.a - 0.75];
    const ca = cand.find(okAt) ?? cand[0];
    const [cx, cz] = P(run, ca, FACE + SKIN + 0.006), yaw = yawOfRun(run);
    K.callPlate(ctx, cx, 1.12, cz, yaw, { type: 'liftCall', building: bId, stair: 1 });
    const [nx, nz] = P(run, ca, FACE + SKIN + 0.008);
    rb('bronzeDark', run, ca - 0.19, ca + 0.19, 1.55, 1.93, FACE + SKIN, FACE + SKIN + 0.006);
    signQuad(0, 0.34, 0.34, nx, 1.74, nz, yaw);
  }

  // ---- service doors (closed): stairs + technical rooms
  const svcLeaf = (run, a, h) => {
    rb('walnutDoor', run, a - 0.47, a + 0.47, 0.005, h - 0.01, -0.07, -0.02);
    rb('brass', run, a + 0.3, a + 0.42, 1.0, 1.03, -0.02, 0.03);
    rc(run, a - 0.48, a + 0.48, 0, h, -0.09, -0.01);
  };
  const stairWord = (run, a) => { if (K.wordSign) soft(() => { const [wx, wz] = P(run, a, -0.017); K.wordSign(ctx, 'stairs', wx, 1.62, wz, yawOfRun(run), 0.085); }, 'stairs sign'); };
  let roomIdx = 0;
  for (const s of pl.service) {
    svcLeaf(s.run, s.a, s.op.h);
    const [sx, sz] = P(s.run, s.a, FACE + SKIN + 0.012), yaw = yawOfRun(s.run);
    if (s.kind === 'stair') { K.signPlane(ctx, 0, sx, s.op.h + 0.2, sz, yaw, 0.2, 0.2); stairWord(s.run, s.a); }
    else { roomIdx++; if (labels[roomIdx - 1]) { rb('bronzeDark', s.run, s.a - 0.4, s.a + 0.4, s.op.h + 0.085, s.op.h + 0.225, FACE + SKIN, FACE + SKIN + 0.008); signQuad(roomIdx, 0.76, 0.1, sx, s.op.h + 0.155, sz, yaw); } }
  }

  // ---- reserved floor areas (door swings, lift fronts, the way in) for the furniture
  const keeps = [];
  for (const run of runs) for (const o of run.openings) keeps.push({ ...rectOf(run, o.c - pl.ext(o) - 0.2, o.c + pl.ext(o) + 0.2, 0, o.kind === 'lift' ? 1.9 : 1.3), own: !!pl.entrance && o === pl.entrance.op });
  if (pl.entrance) keeps.push({ ...rectOf(pl.entrance.run, pl.entrance.a - 1.15, pl.entrance.a + 1.15, 0, 3.8), own: true });
  const clear = q => { if (keeps.some(k => hit(k, q))) return false; for (let x = q.x0 + 0.05; x < q.x1; x += 0.2) for (let z = q.z0 + 0.05; z < q.z1; z += 0.2) if (!inHall(x, z)) return false; return inHall(q.x1 - 0.05, q.z1 - 0.05); };
  const wallSpot = (half, depth, score, minLen = 0) => {            // free stretch of wall with clear floor in front
    let best = null;
    for (const run of runs) {
      if (run.len < Math.max(2 * half + 0.1, minLen)) continue;
      for (let a = run.a0 + half + 0.05; a <= run.a1 - half - 0.05 + 1e-6; a += 0.2) {
        if (!pl.runFree(run, a, half, 0.15) || !clear(rectOf(run, a - half, a + half, 0.02, depth))) continue;
        const [x, z] = P(run, a, depth / 2), sc = score(x, z, run, a);
        if (sc != null && (!best || sc < best.sc)) best = { run, a, sc };
      }
    }
    return best;
  };
  const scallopsOf = run => { const out = []; if (run.len >= 3.4) for (let a = run.a0 + 1.3; a < run.a1 - 0.9; a += 2.6) out.push(a); return out; };

  // ---- ground floor: entrance, intercom, concierge desk, mailboxes, seating
  if (pl.entrance) buildEntrance(K, ctx, pl, { rb, rc, soft, floorRect });
  if (ground && pl.entrance) soft(() => buildVestibule(K, ctx, pl, { rb, rc, keeps }), 'vestibule');
  if (ground && pl.entrance) soft(() => buildLobbyFurniture(K, ctx, pl, { rb, rc, soft, keeps, wallSpot }), 'lobby furniture');
  // ---- art + console opposite the lifts
  if (l0 && K.framedArt) soft(() => {
    const run = l0.run, mate = pl.lifts.find(L => L !== l0 && L.run === run), am = mate ? (l0.a + mate.a) / 2 : l0.a;
    const [lx, lz] = P(run, am);
    const opp = runs.filter(r => r.axis === run.axis && r.side === -run.side && am - 1.3 >= r.a0 && am + 1.3 <= r.a1 && (r.c - run.c) * run.side > 2.3 && (r.c - run.c) * run.side < 6)
      .sort((p, q) => Math.abs(p.c - run.c) - Math.abs(q.c - run.c))[0];
    if (!opp || !pl.runFree(opp, am, 1.2, 0.1) || !clear(rectOf(opp, am - 0.75, am + 0.75, 0.02, 0.5))) return;
    const [mx, mz] = P(opp, am, 1.0); if (!inHall((lx + mx) / 2, (lz + mz) / 2)) return;
    opp.zones.push({ a0: am - 1.2, a1: am + 1.2, mat: 'walnut' });
    const [ax, az] = P(opp, am, FACE + SKIN + 0.002), [tx, tz] = P(opp, am, 0.22), yaw = yawOfRun(opp);
    K.framedArt(ctx, ax, 1.62, az, yaw, 0.8, 1.0, (floor + BIDX(bId)) % 3);
    if (K.consoleTable) K.consoleTable(B, tx, tz, yaw, 1.3);
    const q = rectOf(opp, am - 0.65, am + 0.65, 0, 0.42); C.box(q.x0, q.x1, 0, 0.8, q.z0, q.z1); keeps.push(q);
  }, 'art');

  // ---- walls
  // (V4) a run with flat doors is no thicker than the thinnest entrance wall of those flats (real interiors: 0.07–0.38 m)
  const runT = run => { let T = null; for (const d of pl.units) { if (d.run !== run) continue; let t = null; try { const I = interiorOf(d.u), e = I && I.doors.find(q => q.type === 'entrance'); t = e ? +e.t : null; } catch { t = null; } if (t > 0) T = Math.min(T ?? 1, t - 0.012); } return T == null ? undefined : T; };
  for (const run of runs) K.wallRun(ctx, { axis: run.axis, c: run.c, side: run.side, a0: run.a0, a1: run.a1, openings: run.openings, zones: run.zones, finish: run.finish, scallops: scallopsOf(run), T: runT(run) });
  // slim bronze corner guards where the hall turns around a solid (the two wall skins leave a 4 cm notch there)
  for (const r of runs) if (r.axis === 'x') for (const [e, need] of [[r.a0, -1], [r.a1, 1]]) {
    const q = runs.find(q => q.axis === 'z' && q.side === need && Math.abs(q.c - e) < 0.02 && (Math.abs(q.a0 - r.c) < 0.02 || Math.abs(q.a1 - r.c) < 0.02));
    if (q) B.box('bronze', e, e + q.side * (FACE + SKIN + 0.004), 0, H - 0.005, r.c, r.c + r.side * (FACE + SKIN + 0.004));
  }
  if (pl.balcony) buildBalcony(K, ctx, pl, { rb, rc, svcLeaf, floorRect, stairWord });

  // ---- lights
  const dl = [];
  for (const d of pl.units) dl.push(P(d.run, d.a, 0.45));
  for (const L of pl.lifts) if (L.run) dl.push(P(L.run, L.a, 0.6));
  for (const r of hall) if (Math.min(r.x1 - r.x0, r.z1 - r.z0) >= 2.4) dl.push([(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]);
  if (K.downlights) soft(() => K.downlights(ctx, dl), 'downlights');
  if (K.floorPools) soft(() => K.floorPools(ctx, dl.map(([x, z]) => [x, z]), 1.8), 'pools');
  const spots = [];
  if (l0) { const [x, z] = P(l0.run, l0.a, 1.3); spots.push([x, z]); }
  const cents = hall.filter(r => Math.min(r.x1 - r.x0, r.z1 - r.z0) >= 1.2).map(r => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, (r.x1 - r.x0) * (r.z1 - r.z0)]);
  if (!spots.length && cents.length) spots.push(cents.sort((p, q) => q[2] - p[2])[0]);
  while (spots.length < 4 && cents.length) {   // farthest-point sampling over the hall rect centres
    let best = null, bd = 0;
    for (const c of cents) { const d = Math.min(...spots.map(s => Math.hypot(s[0] - c[0], s[1] - c[1]))); if (d > bd) { bd = d; best = c; } }
    if (!best || bd < 3) break; spots.push(best);
  }
  K.claimRig(root, spots.map(([x, z], i) => [x, H - 0.3, z, i ? 6 : 7, 0xffd4a0, ground ? 14 : 12]), ground ? 0.22 : 0.18);

  // ---- spawn: in front of lift 0, looking down the longest free line
  let spawn;
  if (l0) {
    const n = inward(l0.run); let d = 1.6;
    while (d > 0.7 && !inHall(...P(l0.run, l0.a, d), 0.3)) d -= 0.15;
    const [x, z] = P(l0.run, l0.a, d);
    let bestD = [n[0], n[1]], bl = -1;
    for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (dir[0] === -n[0] && dir[1] === -n[1]) continue;
      let len = 0; while (len < 30 && inHall(x + dir[0] * (len + 0.25), z + dir[1] * (len + 0.25))) len += 0.25;
      if (len > bl + 0.01) { bl = len; bestD = dir; }
    }
    spawn = { x, z, yaw: Math.atan2(-bestD[0], -bestD[1]) };
  } else { const r = hall.slice().sort((p, q) => (q.x1 - q.x0) * (q.z1 - q.z0) - (p.x1 - p.x0) * (p.z1 - p.z0))[0]; spawn = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, yaw: 0 }; }

  const res = K.finish(ctx, spawn);
  const dispose = res.dispose ? res.dispose.bind(res) : null;
  res.dispose = () => { if (dispose) dispose(); signs.mat.dispose(); signs.tex.dispose(); };
  res.plan = pl;                    // extra (tests, minimap): runs with openings, balcony, entrance, warnings
  if (pl.warn.length && typeof console !== 'undefined') console.debug(`commons-floor ${bId}/${floor}:`, pl.warn.join(' · '));
  return res;
}
const BIDX = bId => (String(bId).match(/\d+/) || [0])[0] | 0;

// ---- sign atlas: cell 0 = floor numeral (square), cells 1… = room names (wide strips)
function makeSigns(THREE, numeral, labels) {
  const W = 512, rows = Math.max(1, labels.length), Hh = Math.max(256, 2 ** Math.ceil(Math.log2(192 + 64 * rows)));
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  g.fillStyle = '#141312'; g.fillRect(0, 0, W, Hh);
  const SANS = '"Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(216,180,106,0.7)'; g.lineWidth = 3; g.strokeRect(8, 8, 176, 176);
  g.fillStyle = '#e9cf93'; g.font = `600 ${numeral.length > 1 ? 104 : 128}px ${SANS}`; g.fillText(numeral, 96, 102);
  labels.forEach((t, i) => {
    const y = 192 + i * 64; g.strokeStyle = 'rgba(216,180,106,0.6)'; g.lineWidth = 2; g.strokeRect(4, y + 4, 480, 56);
    g.fillStyle = '#efe3c8'; let px = 34; g.font = `500 ${px}px ${SANS}`;
    while (px > 16 && g.measureText(t).width > 456) { px -= 2; g.font = `500 ${px}px ${SANS}`; }
    g.fillText(t, 244, y + 33);
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.15, 1.15, 1.15) }); mat.name = 'vrc-floor-signs';
  const uv = i => (i === 0 ? [0, 1 - 192 / Hh, 192 / W, 192 / Hh] : [0, 1 - (192 + i * 64) / Hh, 488 / W, 64 / Hh]);
  return { tex, mat, uv };
}

// ---- entrance: automatic sliding doors in the hall edge on the facade, mat, intercom post outside
function buildEntrance(K, ctx, pl, { rb, rc, soft, floorRect }) {
  const { THREE, M, FACE, SKIN, WALL_T } = K, { B, C, root } = ctx, e = pl.entrance, run = e.run, n = e.n;
  const [x, z] = P(run, e.a), h = e.op.h;
  // threshold: the floor runs through the wall and 0.6 m outside (no gap between the hall and the ground outside)
  { const q = rectOf(run, e.a - e.w / 2, e.a + e.w / 2, -0.75, 0.05); B.box('stone', q.x0, q.x1, -0.3, -0.001, q.z0, q.z1); floorRect(q.x0, q.x1, q.z0, q.z1); }
  let rec = null;
  if (K.slidingEntrance) rec = soft(() => K.slidingEntrance(ctx, { x, z, n: [n[0], n[1]], w: e.w, h }), 'slidingEntrance');   // brings its posts, header and mat
  if (!rec) {   // own portal frame + leaves
    for (const s of [-1, 1]) rb('bronze', run, e.a + s * e.w / 2 - 0.04, e.a + s * e.w / 2 + 0.04, 0, h + 0.08, -WALL_T - 0.02, FACE + 0.03);
    rb('bronze', run, e.a - e.w / 2 - 0.04, e.a + e.w / 2 + 0.04, h, h + 0.08, -WALL_T - 0.02, FACE + 0.03);
    rb('nero', run, e.a - e.w / 2, e.a + e.w / 2, 0, 0.004, -0.7, 0.6);
    rec = ownSliding(K, ctx, e, h);
  }
  if (K.wordSign && h + 0.32 < pl.H) soft(() => { const [sx, sz] = P(run, e.a, FACE + SKIN + 0.006); K.wordSign(ctx, 'exit', sx, h + 0.2, sz, yawOfRun(run), 0.1); }, 'exit sign');
  ctx.autoDoors ||= [];
  if (rec && !ctx.autoDoors.includes(rec)) ctx.autoDoors.push(rec);
  // intercom post: 1.0 m along the tangent t = [−n.z, n.x], 0.35 m out; the fascia faces outward
  const side = e.w < 1.5 ? e.w / 2 + 0.55 : 1.0;
  const ix = x + e.t[0] * side + n[0] * 0.35, iz = z + e.t[1] * side + n[1] * 0.35;
  if (K.intercomTotem) soft(() => K.intercomTotem(ctx, pl.core, ix, iz, Math.atan2(n[0], n[1])), 'intercom');
  if (!(ctx.intercoms && ctx.intercoms.length)) {   // minimal stand-in so walk.js still finds an intercom
    const face = new THREE.Mesh(ctx.geo('icomFaceT14', () => new THREE.PlaneGeometry(0.19, 0.52)), M('blackGlass'));
    face.position.set(ix + n[0] * 0.056, 1.245, iz + n[1] * 0.056); face.rotation.y = Math.atan2(n[0], n[1]); face.name = 'vrc-intercom';
    face.userData.action = { type: 'intercom', building: pl.bId, stair: 1 };
    B.box('bronze', ix - 0.12, ix + 0.12, 0, 1.58, iz - 0.12, iz + 0.12); B.box('bronze', ix - 0.05 - Math.abs(n[1]) * 0.075, ix + 0.05 + Math.abs(n[1]) * 0.075, 0, 1.58, iz - 0.05 - Math.abs(n[0]) * 0.075, iz + 0.05 + Math.abs(n[0]) * 0.075);
    C.box(ix - 0.14, ix + 0.14, 0, 1.6, iz - 0.14, iz + 0.14); root.add(face);
    (ctx.intercoms ||= []).push({ stair: 1, x: ix, z: iz, face, setOpen() {} });
  }
}
function ownSliding(K, ctx, e, h) {   // fallback when the KIT has no slidingEntrance: two glass leaves + a blocker
  const { THREE, M } = K, [x, z] = P(e.run, e.a), DW = e.w / 2, yaw = Math.atan2(e.n[0], e.n[1]);
  const g = new THREE.Group(); g.name = 'vrc-entrance'; g.position.set(x - e.n[0] * 0.03, 0, z - e.n[1] * 0.03); g.rotation.y = yaw; ctx.root.add(g);
  const leaves = [];
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group(); leaf.name = 'lobby-slide-door';
    const pane = new THREE.Mesh(ctx.geo('slideLeafT14' + DW.toFixed(2), () => new THREE.BoxGeometry(DW, h - 0.04, 0.016).translate(0, h / 2, 0)), M('glass')); pane.renderOrder = 2; leaf.add(pane);
    leaf.position.set(s * DW / 2, 0, 0); leaf.userData.baseX = leaf.position.x; leaf.userData.dir = s; g.add(leaf); leaves.push(leaf);
  }
  const blocker = new THREE.Mesh(ctx.geo('slideBlockT14' + DW.toFixed(2), () => new THREE.BoxGeometry(2 * DW, h, 0.1)), M('hidden'));
  blocker.position.set(0, h / 2, 0); blocker.userData.solid = true; blocker.name = 'lobby-door-block'; g.add(blocker);
  return { x, z, n: [e.n[0], e.n[1]], leaves, open: 0, travel: DW - 0.06, stair: 1, blocker };
}

// ---- vestibule: a glass wind lobby inside the entrance (two wings, an inner screen with an open 1.6 m portal, a glass
// roof) — only in a lobby that is ≥ 4.5 m wide and ≥ 7 m deep there, and only when no door opens into its footprint.
function buildVestibule(K, ctx, pl, { rb, rc, keeps }) {
  const e = pl.entrance, run = e.run, a = e.a, inHall = pl.inHall, HALF = 1.3, DV = 2.5, OW = 0.8, hv = Math.min(e.op.h + 0.1, pl.H - 0.3);
  for (let d = 0.3; d <= 7; d += 0.35) if (!inHall(...P(run, a, d))) return;                       // depth
  const reach = s => { let t = 0; while (t < 8 && inHall(...P(run, a + s * (t + 0.1), DV)) && inHall(...P(run, a + s * (t + 0.1), DV + 0.9))) t += 0.1; return t; };
  const L = reach(-1), R = reach(1);
  if (L + R < 4.5 || L < HALF + 0.9 || R < HALF + 0.9) return;                                    // width, and a way round both wings
  const start = s => { for (let d = 0; d < DV - 0.6; d += 0.05) if (inHall(...P(run, a + s * (HALF - 0.1), d)) && inHall(...P(run, a + s * (HALF + 0.1), d))) return d; return null; };
  const d0 = [start(-1), start(1)]; if (d0[0] == null || d0[1] == null) return;
  const foot = rectOf(run, a - HALF - 0.15, a + HALF + 0.15, Math.min(d0[0], d0[1]) + 0.05, DV + 0.9);
  if (keeps.some(k => !k.own && hit(k, foot))) return;                                                       // a door / lift front opens into it
  const glass = (a0, a1, dA, dB) => {
    rb('glass', run, a0, a1, 0.07, hv, dA, dB); rb('bronze', run, a0 - 0.012, a1 + 0.012, 0, 0.07, dA - 0.012, dB + 0.012);
    rc(run, a0 - 0.03, a1 + 0.03, 0, hv, dA - 0.03, dB + 0.03);
  };
  [-1, 1].forEach((s, i) => {                                                                      // wings
    const wa = a + s * HALF; glass(wa - 0.008, wa + 0.008, d0[i] + 0.04, DV);
    rb('bronze', run, wa - 0.03, wa + 0.03, 0, hv + 0.06, DV - 0.03, DV + 0.03);                   // corner post
    rb('bronze', run, wa - 0.025, wa + 0.025, hv, hv + 0.06, d0[i] + 0.04, DV);                    // top rail
    glass(Math.min(wa, a + s * OW), Math.max(wa, a + s * OW), DV - 0.008, DV + 0.008);             // inner screen panel
    rb('bronze', run, a + s * OW - 0.025, a + s * OW + 0.025, 0, hv + 0.06, DV - 0.03, DV + 0.03); // portal post
  });
  rb('bronze', run, a - HALF, a + HALF, hv, hv + 0.06, DV - 0.03, DV + 0.03);                      // header
  rb('glass', run, a - HALF, a + HALF, hv + 0.06, hv + 0.072, Math.max(d0[0], d0[1]) + 0.04, DV);  // roof
  rb('rug', run, a - 0.95, a + 0.95, 0.004, 0.012, 0.75, DV - 0.25);                               // dirt-trap mat
  keeps.push(rectOf(run, a - HALF - 0.25, a + HALF + 0.25, 0, DV + 1.3));
  pl.vestibule = { run, a, half: HALF, depth: DV };
}

// ---- lobby: concierge desk (+ figure), mailbox wall, two armchairs — each only where there is room
function buildLobbyFurniture(K, ctx, pl, { rb, rc, soft, keeps, wallSpot }) {
  const { THREE, M, FACE, SKIN } = K, { B, C } = ctx, e = pl.entrance, lob = pl.lobby;
  const tgt = [e.p[0] - e.n[0] * 3.6, e.p[1] - e.n[1] * 3.6];
  const near = (x, z) => Math.hypot(x - tgt[0], z - tgt[1]) + (lob && !inRect(lob, x, z, 0.2) ? 6 : 0);
  // concierge desk: needs a 2.6 m wall and 2.9 m of depth (seat between the wall and the desk, way past in front)
  const big = pl.hall.some(r => Math.min(r.x1 - r.x0, r.z1 - r.z0) >= 3 && Math.max(r.x1 - r.x0, r.z1 - r.z0) >= 4);
  const desk = big ? wallSpot(1.3, 2.7, (x, z) => { const d = near(x, z); return d < 14 ? d : null; }) : null;
  if (desk) {
    const { run, a } = desk, yaw = yawOfRun(run), TOP = 1.05, WT = 0.74;
    rb('marble', run, a - 1.1, a + 1.1, 0.08, TOP, 1.5, 1.57);                      // front slab
    for (const s of [-1, 1]) rb('walnut', run, a + s * 1.1 - 0.025, a + s * 1.1 + 0.025, 0.08, TOP, 0.98, 1.57);   // returns
    rb('walnut', run, a - 1.08, a + 1.08, WT, WT + 0.03, 0.98, 1.5);               // work top
    rb('nero', run, a - 1.16, a + 1.16, TOP, TOP + 0.045, 1.28, 1.64);             // transaction ledge
    rb('bronze', run, a - 1.06, a + 1.06, 0, 0.08, 1.02, 1.53);                    // recessed plinth
    rb('led', run, a - 1.04, a + 1.04, 0.074, 0.08, 1.572, 1.578);                 // plinth glow
    rb('bronze', run, a - 0.92, a + 0.92, 0.27, 0.83, 1.57, 1.582); rb('onyx', run, a - 0.89, a + 0.89, 0.3, 0.8, 1.582, 1.588);
    soft(() => { const [wx, wz] = P(run, a, 1.5895); B.add('wordmarkLit', new THREE.PlaneGeometry(1.6, 0.4), K.mat4(wx, 0.55, wz, yaw)); }, 'desk mark');
    soft(() => { const [wx, wz] = P(run, a, FACE + SKIN + 0.004); B.add('wordmark', new THREE.PlaneGeometry(2.2, 0.55), K.mat4(wx, 2.05, wz, yaw)); }, 'wordmark');
    run.zones.push({ a0: a - 1.5, a1: a + 1.5, mat: 'marble' });
    rc(run, a - 1.16, a + 1.16, 0, TOP + 0.05, 0.98, 1.64);
    const [cx, cz] = P(run, a, 0.6);
    let cg = null;
    if (K.makeConcierge) cg = soft(() => K.makeConcierge(cx, cz, yaw, pl.bId, 1, 1), 'concierge');
    if (cg && cg.group) { ctx.root.add(cg.group); (ctx.concierges ||= []).push(cg); }
    rb('leather', run, a - 0.24, a + 0.24, 0.42, 0.5, 0.36, 0.84); rb('bronze', run, a - 0.03, a + 0.03, 0, 0.42, 0.57, 0.63);   // her seat
    rc(run, a - 0.3, a + 0.3, 0, 1.0, 0.3, 0.9);
    keeps.push(rectOf(run, a - 1.3, a + 1.3, 0, 2.7));
    pl.desk = { run, a };
  }
  // mailboxes: brass doors on a free 2.2 m stretch of wall
  const mail = wallSpot(1.1, 1.0, (x, z) => near(x, z), 2.3);
  if (mail) {
    const { run, a } = mail, yaw = yawOfRun(run), d0 = FACE + SKIN;
    rb('bronzeDark', run, a - 1.0, a + 1.0, 0.55, 1.85, d0, d0 + 0.06);
    soft(() => { const [mx, mz] = P(run, a, d0 + 0.062); B.add('mailbox', new THREE.PlaneGeometry(1.9, 1.2), K.mat4(mx, 1.2, mz, yaw)); }, 'mailbox');
    rc(run, a - 1.0, a + 1.0, 0, 2, 0, 0.12);
    if (K.wordSign) soft(() => { const [sx, sz] = P(run, a, d0 + 0.006); K.wordSign(ctx, 'mail', sx, 1.98, sz, yaw, 0.09); }, 'mail sign');
    keeps.push(rectOf(run, a - 1.1, a + 1.1, 0, 1.0));
    pl.mail = { run, a };
  }
  // seating
  const seat = K.armchair ? wallSpot(1.25, 1.9, (x, z) => near(x, z), 2.6) : null;
  if (seat) soft(() => {
    const { run, a } = seat, yaw = yawOfRun(run);
    for (const s of [-1, 1]) { const [x, z] = P(run, a + s * 0.68, 0.62); K.armchair(B, x, z, yaw - s * 0.28); }
    const [tx, tz] = P(run, a, 0.55);
    B.add('nero', new THREE.CylinderGeometry(0.2, 0.2, 0.03, 28).translate(tx, 0.47, tz)); B.add('bronze', new THREE.CylinderGeometry(0.025, 0.14, 0.45, 16).translate(tx, 0.23, tz));
    rb('rug', run, a - 1.2, a + 1.2, 0.004, 0.012, 0.12, 1.5);
    rc(run, a - 1.1, a + 1.1, 0, 0.8, 0.1, 1.05);
    keeps.push(rectOf(run, a - 1.25, a + 1.25, 0, 1.9));
    pl.seat = { run, a };
  }, 'seating');
}

// ---- open common balcony: way through the facade wall, slab, cheeks, rail and the stair door
function buildBalcony(K, ctx, pl, { rb, rc, svcLeaf, floorRect, stairWord }) {
  const { FACE, SKIN, WALL_T } = K, { B, C } = ctx, b = pl.balcony, H = pl.H, hr = b.from, br = b.run, r = b.rect;
  const len = Math.abs(br.c - hr.c), ps = b.pass, a0 = ps.c - ps.w / 2, a1 = ps.c + ps.w / 2;
  // way through the wall (hall line → balcony line), in the hall run's frame: d < 0 is outward
  rb('stone', hr, a0, a1, -0.3, 0, -len - 0.02, 0.02);
  { const q = rectOf(hr, a0, a1, -len - 0.05, 0.05); floorRect(q.x0, q.x1, q.z0, q.z1); }
  for (const [e0, e1] of [[a0 - 0.1, a0], [a1, a1 + 0.1]]) { rb('plasterW', hr, e0, e1, 0, H, -len, 0); rc(hr, e0, e1, 0, H, -len, 0); }
  rb('plasterW', hr, a0, a1, ps.h, H, -len, 0);
  // balcony slab + soffit of the balcony above
  B.box('concreteLight', r.x0, r.x1, -0.2, 0, r.z0, r.z1); floorRect(r.x0, r.x1, r.z0, r.z1);
  B.box('plaster', r.x0, r.x1, H, H + 0.05, r.z0, r.z1);
  // the facade wall of the balcony (outside finish), with the pass and the stair door
  K.wallRun(ctx, { axis: br.axis, c: br.c, side: br.side, a0: br.a0, a1: br.a1, openings: br.openings, finish: 'plasterW', noAO: true });
  if (b.stair) {
    svcLeaf(br, b.stair.a, b.stair.op.h);
    const [sx, sz] = P(br, b.stair.a, FACE + SKIN + 0.012);
    K.signPlane(ctx, 0, sx, b.stair.op.h + 0.2, sz, yawOfRun(br), 0.2, 0.2); if (stairWord) stairWord(br, b.stair.a);
    // the door reveal is closed behind the leaf (the stair itself is not modelled)
    rb('plasterW', br, b.stair.a - 0.5, b.stair.a + 0.5, 0, b.stair.op.h, -WALL_T - 0.04, -WALL_T);
  }
  // cheeks at both ends (full height: nothing behind the facade line can be seen from the balcony), rail in front
  const D = b.depth;
  for (const [e0, e1] of [[br.a0, br.a0 + 0.12], [br.a1 - 0.12, br.a1]]) { rb('plasterW', br, e0, e1, 0, H, 0, D); rc(br, e0, e1, 0, H, 0, D); }
  rb('glass', br, br.a0 + 0.12, br.a1 - 0.12, 0.08, 1.12, D - 0.07, D - 0.055);
  rb('bronzeDark', br, br.a0 + 0.12, br.a1 - 0.12, 0, 0.08, D - 0.09, D - 0.03);
  rb('bronze', br, br.a0 + 0.12, br.a1 - 0.12, 1.12, 1.17, D - 0.095, D - 0.03);
  const n = Math.max(1, Math.round((br.len - 0.24) / 1.3));
  for (let i = 1; i < n; i++) { const a = br.a0 + 0.12 + (br.len - 0.24) * i / n; rb('bronzeDark', br, a - 0.02, a + 0.02, 0.08, 1.12, D - 0.085, D - 0.04); }
  rc(br, br.a0, br.a1, 0, H, D - 0.1, D);   // nobody climbs over the rail
}
