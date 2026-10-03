// ЖК VILNYI (Uzhhorod) — facade generator for one point tower (task T11, CONTRACT §4.1).
// Pure geometry: everything is pushed into the Buf instances handed over by exterior.js (one mesh per material per
// building), so a tower costs ≤ 12 draw calls. Nothing here creates meshes, materials or textures.
//
// What is generated, all from data.js:
//   · per floor, walls along that floor's real plate outline (slanted edges as they are, rounded corners as curtain-wall
//     glass chords with a dark band at every slab);
//   · per flat, windows where its rooms meet the outline (room kind decides the window; bathrooms and halls stay solid);
//   · glazed balconies / balconies / terraces from every unit's real `outdoor` polygons, the communal stair balcony;
//   · ground floor: shopfront glazing over commercial blocks, lobby glazing + canopy at the entrance, ramp portal;
//   · set-backs: roof cap of the lower plate, terrace paving, glass rail, planters;
//   · roof: slab, parapet, LED line, lift / stair overrun, boiler house with flues, a few HVAC units.
// Every vertex carries aTag = (band code, unit index | −1 shared | −2 never hidden, window seed); see exterior.js.
import { BUILDINGS, SITE, RAMPS, floorsOf, plateOf, floorY, floorH, roofY, unitsOn } from '../data.js';

// ------------------------------------------------------------------ which buffer gets what (materials are exterior.js')
//   wall   cladding in the tower's own grey          stone  dark panels (behind balcony stacks, shop fascia) = wall × 0.5
//   crown  roof parapet                              slab   dark slab edges / balcony fascias
//   frame  window frames, mullions, slab bands of the curtain wall, posts
//   glass  windows (seed 1…9999 per flat room; 10001 shop, 20001 lobby, 30001 stair)
//   rail   glass balustrades and balcony screens     soffit timber decking and soffits
//   roof   flat roofs, paving at grade               hvac   roof plant        hedge  planting        led  parapet line
// accent and solar stay empty → 12 draw calls per tower at most.
const SHOP_KINDS = { cafe: 1, commercial: 1, supermarket: 1, playland: 1, fitness: 1, pool: 1 };
const TALL_KINDS = { supermarket: 1, fitness: 1, pool: 1 };          // double-height halls: glazing continues on floor 2
// window per room kind: min run width, target cell, pier margin each side, max width, sill height, mullion step
const WIN = {
  living:  { min: 1.5, cell: 2.9, margin: 0.4, max: 1.9, sill: 0, mull: 0.95 },
  bedroom: { min: 1.5, cell: 2.8, margin: 0.45, max: 1.3, sill: 0, mull: 0.65 },
  kitchen: { min: 1.4, cell: 2.6, margin: 0.42, max: 1.25, sill: 0.9, mull: 0.65 },
};
const WIN_DOOR = { min: 1.1, cell: 3.4, margin: 0.22, max: 3.2, sill: 0, mull: 1.05 };   // wall behind a balcony
const WALL_T = 0.3, GLASS_V = -0.14, RAIL_H = 1.1, BAND = 0.3;

// ------------------------------------------------------------------ small 2D helpers (x, z)
function area2(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function inPoly(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function distToRing(p, x, z) {
  let m = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
    m = Math.min(m, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return m;
}
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function hash(n) { n = (n | 0) + 0x7ed55d16; n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0); }
const rectPoly = r => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
const _oPoly = new WeakMap();
function outdoorPoly(o) {            // 40 outdoor rooms carry only a rect
  if (o.poly && o.poly.length >= 3) return o.poly;
  let p = _oPoly.get(o); if (!p) { p = rectPoly(o); _oPoly.set(o, p); } return p;
}
// drop duplicate and collinear vertices (extraction splits straight edges; arcs keep their chords)
function simplify(poly) {
  let p = poly.filter((q, i) => { const r = poly[(i + 1) % poly.length]; return Math.hypot(r[0] - q[0], r[1] - q[1]) > 0.02; });
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const cr = ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) / (l1 * l2);
      const dt = ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) / (l1 * l2);
      if (dt > 0 && Math.abs(cr) < 0.03) continue;            // < 1.7° turn: collinear
      out.push(b);
    }
    if (out.length === p.length || out.length < 3) break; p = out;
  }
  return p;
}
// outline → edges with frames. Edge frame: o = start, U = along, V = outward normal (so box() 'V' faces outwards).
function ringOf(outline) {
  const pts = simplify(outline), n = pts.length, s = area2(pts) > 0 ? 1 : -1;
  const edges = pts.map((a, i) => {
    const b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), U = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const N = [s * U[1], -s * U[0]];
    return { i, a, b, L, U, N, F: { o: a, U, V: N }, att: [] };
  });
  const turn = i => { const p = edges[(i + n - 1) % n].U, q = edges[i].U; return Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1]))) * 180 / Math.PI; };
  // arc chord = short edge that turns gently at both ends (a 90° jog is a wall, not a curve)
  for (const e of edges) { const t0 = turn(e.i), t1 = turn((e.i + 1) % n); e.arc = e.L < 2.6 && t0 > 2.5 && t0 < 50 && t1 > 2.5 && t1 < 50 && Math.max(t0, t1) > 7; }
  return { pts, edges };
}
// ear clipping fallback when THREE.ShapeUtils is not in the kit
function earClip(p) {
  const idx = p.map((_, i) => i), tris = [], s = area2(p) > 0 ? 1 : -1;
  let guard = p.length * p.length + 10;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = p[i0], b = p[i1], c = p[i2];
      if (s * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) <= 1e-9) continue;
      let ok = true;
      for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inPoly([a, b, c], p[j][0], p[j][1])) { ok = false; break; } }
      if (!ok) continue;
      tris.push([i0, i1, i2]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// fallbacks for a partial kit (same maths as exterior.js L89–104)
const _P = (F, u, y, v) => [F.o[0] + F.U[0] * u + F.V[0] * v, y, F.o[1] + F.U[1] * u + F.V[1] * v];
function _box(buf, F, u0, u1, y0, y1, v0, v1, t, faces = 'uUyYvV') {
  const U3 = [F.U[0], 0, F.U[1]], V3 = [F.V[0], 0, F.V[1]], neg = a => [-a[0], -a[1], -a[2]];
  const du = u1 - u0, dy = y1 - y0, dv = v1 - v0;
  for (const f of faces) {
    if (f === 'U' || f === 'u') { const u = f === 'U' ? u1 : u0; buf.quad([_P(F, u, y0, v0), _P(F, u, y0, v1), _P(F, u, y1, v1), _P(F, u, y1, v0)], f === 'U' ? U3 : neg(U3), [[0, 0], [dv, 0], [dv, dy], [0, dy]], t); }
    if (f === 'V' || f === 'v') { const v = f === 'V' ? v1 : v0; buf.quad([_P(F, u0, y0, v), _P(F, u1, y0, v), _P(F, u1, y1, v), _P(F, u0, y1, v)], f === 'V' ? V3 : neg(V3), [[0, 0], [du, 0], [du, dy], [0, dy]], t); }
    if (f === 'Y' || f === 'y') { const y = f === 'Y' ? y1 : y0; buf.quad([_P(F, u0, y, v0), _P(F, u1, y, v0), _P(F, u1, y, v1), _P(F, u0, y, v1)], [0, f === 'Y' ? 1 : -1, 0], [[0, 0], [du, 0], [du, dv], [0, dv]], t); }
  }
}
function _pane(buf, F, u0, u1, y0, y1, v, t) {
  buf.quad([_P(F, u0, y0, v), _P(F, u1, y0, v), _P(F, u1, y1, v), _P(F, u0, y1, v)], [F.V[0], 0, F.V[1]], [[0, 0], [1, 0], [1, 1], [0, 1]], t);
}

// ================================================================== buildTowerFacade
// K = { THREE, Buf, box, pane, P, bandCode, unitIndex: Map(unit → index), rand, LEVELS, ROOF_BAND }
// bufs = { wall, slab, stone, accent, crown, frame, glass, rail, soffit, roof, hvac, solar, hedge, led }
export function buildTowerFacade(K, bId, bufs) {
  const B = BUILDINGS[bId]; if (!B) return;
  const box = K.box || _box, pane = K.pane || _pane, P = K.P || _P;
  const any = bufs.wall || Object.values(bufs)[0];
  const buf = k => bufs[k] || any;
  const clad = buf('wall'), dark = buf('stone'), crown = buf('crown'), frame = buf('frame'), glass = buf('glass'), rail = buf('rail');
  const soffit = buf('soffit'), slab = buf('slab'), roofB = buf('roof'), hvac = buf('hvac'), led = buf('led'), hedge = buf('hedge');
  const bandCode = K.bandCode || ((id, band) => band + 100 * Object.keys(BUILDINGS).indexOf(id));
  const ROOF_BAND = K.ROOF_BAND ?? 99;
  const uIdx = u => { const i = K.unitIndex ? K.unitIndex.get(u) : undefined; return i == null ? -1 : i; };
  const seedOf = (uid, ri) => 1 + hash(uid * 131 + ri * 17 + 7) % 9000;      // deterministic per (flat, room)
  const tris = pts => {
    const T = K.THREE;
    if (T && T.ShapeUtils && T.Vector2) { try { return T.ShapeUtils.triangulateShape(pts.map(p => new T.Vector2(p[0], p[1])), []); } catch (e) { /* fall through */ } }
    return earClip(pts);
  };
  // horizontal polygon at height y, facing up (dir = 1) or down (−1)
  function cap(b, pts, y, dir, tag) {
    for (const [i, j, k] of tris(pts)) {
      const a = pts[i], c = pts[j], d = pts[k];
      b.quad([[a[0], y, a[1]], [c[0], y, c[1]], [d[0], y, d[1]], [d[0], y, d[1]]], [0, dir, 0], [[a[0], a[1]], [c[0], c[1]], [d[0], d[1]], [d[0], d[1]]], tag);
    }
  }
  const wall = (b, F, u0, u1, y0, y1, tag) => { if (u1 - u0 > 0.01 && y1 - y0 > 0.01) box(b, F, u0, u1, y0, y1, -WALL_T, 0, tag, 'V'); };
  // framed glazing set back in the wall: one lit pane + frame + mullions
  function glazing(F, a, b, ya, yb, tag, seed, mull) {
    const v = GLASS_V, fr = 0.06, v1 = v + 0.05;
    pane(glass, F, a, b, ya, yb, v, { b: tag.b, u: tag.u, s: seed });
    box(frame, F, a, b, ya, ya + fr, v, v1, tag, 'V'); box(frame, F, a, b, yb - fr, yb, v, v1, tag, 'V');
    box(frame, F, a, a + fr, ya, yb, v, v1, tag, 'V'); box(frame, F, b - fr, b, ya, yb, v, v1, tag, 'V');
    const nm = Math.max(1, Math.round((b - a) / mull));
    for (let m = 1; m < nm; m++) { const x = a + (b - a) * m / nm; box(frame, F, x - 0.025, x + 0.025, ya, yb, v, v1, tag, 'V'); }
  }
  // curtain wall flush with the facade: dark band at the slab, glass cells, mullions. seedFn(cell) → window seed
  function curtain(F, u0, u1, y0, yT, tag, seedFn, step, opt = {}) {
    const top = opt.top ?? BAND, bot = opt.bot ?? 0.06, w = u1 - u0; if (w < 0.05) return;
    box(opt.bandBuf || frame, F, u0, u1, yT - top, yT, -WALL_T, 0, tag, 'V');
    box(frame, F, u0, u1, y0, y0 + bot, -WALL_T, 0, tag, 'V');
    const n = Math.max(1, Math.round(w / step));
    for (let c = 0; c < n; c++) {
      const a = u0 + w * c / n, b = u0 + w * (c + 1) / n;
      const ya = y0 + bot, yb = yT - top, t = { b: tag.b, u: tag.u, s: seedFn(c) };
      if (opt.uv) {                        // one continuous "window" over several chords of a rounded corner
        const ua = opt.uv[0] + (opt.uv[1] - opt.uv[0]) * c / n, ub = opt.uv[0] + (opt.uv[1] - opt.uv[0]) * (c + 1) / n;
        glass.quad([P(F, a, ya, -0.05), P(F, b, ya, -0.05), P(F, b, yb, -0.05), P(F, a, yb, -0.05)], [F.V[0], 0, F.V[1]], [[ua, 0], [ub, 0], [ub, 1], [ua, 1]], t);
      } else pane(glass, F, a, b, ya, yb, -0.05, t);
      if (c > 0 || opt.m0) box(frame, F, a - 0.035, a + 0.035, y0 + bot, yT - top, -0.05, 0, tag, 'V');
    }
    if (opt.m1) box(frame, F, u1 - 0.035, u1 + 0.035, y0 + bot, yT - top, -0.05, 0, tag, 'V');
  }

  // ---------------- per-plate cache: ring, balcony attachment intervals
  const rings = new Map();
  function ringFor(plate) {
    let r = rings.get(plate.id); if (r) return r;
    r = ringOf(plate.outline); r.outline = plate.outline;
    for (const u of plate.units) for (const o of u.outdoor || []) {
      if (o.kind === 'terrace') continue;
      const p = outdoorPoly(o), c = centroid(p);
      if (inPoly(plate.outline, c[0], c[1])) continue;          // inset loggia: part of the facade itself
      for (const e of r.edges) {
        if (e.arc) continue;
        let lo = Infinity, hi = -Infinity, cnt = 0;
        for (const q of p) {
          const d = (q[0] - e.a[0]) * e.N[0] + (q[1] - e.a[1]) * e.N[1]; if (Math.abs(d) > 0.75) continue;
          const s = (q[0] - e.a[0]) * e.U[0] + (q[1] - e.a[1]) * e.U[1]; lo = Math.min(lo, s); hi = Math.max(hi, s); cnt++;
        }
        if (cnt < 2 || hi - lo < 0.8) continue;
        lo = Math.max(0, lo - 0.12); hi = Math.min(e.L, hi + 0.12);
        if (hi - lo > 0.8) e.att.push([lo, hi]);
      }
    }
    rings.set(plate.id, r); return r;
  }
  const ground = plateOf(bId, floorsOf(bId)[0]);
  const ramp = (RAMPS || []).find(r => r.building === bId) || null;

  // ---------------- one floor
  function buildFloor(f) {
    const plate = plateOf(bId, f); if (!plate || !plate.outline || plate.outline.length < 3) return;
    const ring = ringFor(plate), code = bandCode(bId, f);
    const y0 = floorY(bId, f), H = floorH(bId, f), yT = y0 + H;
    const units = unitsOn(bId, f);
    const rooms = new Map(units.map(u => [u, (plate.units.find(p => p.slot === u.index) || {}).list || []]));
    const shared = { b: code, u: -1, s: 0 }, fixed = { b: code, u: -2, s: 0 };
    const tagOf = u => ({ b: code, u: uIdx(u), s: 0 });
    const isGround = f === floorsOf(bId)[0];
    const blocks = plate.blocks || [];
    const lowBlocks = !isGround && y0 < 6.5 && ground ? (ground.blocks || []).filter(k => TALL_KINDS[k.kind]) : [];
    const core = plate.core || {};

    // entrance: edge + position along it
    let ent = null;
    if (isGround && plate.entrance) {
      const [ex, ez] = plate.entrance.p; let best = 0.7;
      for (const e of ring.edges) {
        const s = (ex - e.a[0]) * e.U[0] + (ez - e.a[1]) * e.U[1], d = Math.abs((ex - e.a[0]) * e.N[0] + (ez - e.a[1]) * e.N[1]);
        if (!e.arc && s > -0.3 && s < e.L + 0.3 && d < best) { best = d; ent = { e, s: Math.max(2.4, Math.min(e.L - 2.4, s)) }; }
      }
      if (ent && ent.e.L < 4.8) ent.s = ent.e.L / 2;
    }

    function roomAt(u, x, z) {
      let best = -1, ba = Infinity; const list = rooms.get(u) || [];
      for (let i = 0; i < list.length; i++) {
        const r = list[i], b = r.b; if (!b || r.kind === 'loggia' || r.kind === 'balcony' || r.kind === 'terrace') continue;
        if (x < b[0] - 0.35 || x > b[2] + 0.35 || z < b[1] - 0.35 || z > b[3] + 0.35) continue;
        const a = (b[2] - b[0]) * (b[3] - b[1]); if (a < ba) { ba = a; best = i; }
      }
      return best;
    }
    // who owns the facade at distance s along edge e
    function ownerAt(e, s) {
      if (ent && ent.e === e && Math.abs(s - ent.s) < 2.3) return { k: 'ent', type: 'ent' };
      const px = e.a[0] + e.U[0] * s, pz = e.a[1] + e.U[1] * s;
      for (const d of [0.5, 1.0]) {
        const x = px - e.N[0] * d, z = pz - e.N[1] * d;
        for (const u of units) for (const o of u.outdoor || []) if (inPoly(outdoorPoly(o), x, z)) return { k: 'L' + u.index, type: 'log', unit: u };
      }
      for (const d of [0.9, 1.6, 0.5]) {
        const x = px - e.N[0] * d, z = pz - e.N[1] * d;
        for (const u of units) if (u.poly && inPoly(u.poly, x, z)) {
          const ri = roomAt(u, x, z), att = e.att.some(a => s > a[0] && s < a[1]);
          return { k: 'U' + u.index + ':' + ri + (att ? 'a' : ''), type: 'flat', unit: u, ri, att };
        }
      }
      const x = px - e.N[0] * 0.9, z = pz - e.N[1] * 0.9;
      for (const st of core.stairs || []) if (x > st.x0 - 0.6 && x < st.x1 + 0.6 && z > st.z0 - 0.6 && z < st.z1 + 0.6) return { k: 'S', type: 'stair' };
      for (let i = 0; i < blocks.length; i++) if (blocks[i].poly && inPoly(blocks[i].poly, x, z)) return { k: 'B' + i, type: 'block', block: blocks[i] };
      for (let i = 0; i < lowBlocks.length; i++) if (lowBlocks[i].poly && inPoly(lowBlocks[i].poly, x, z)) return { k: 'T' + i, type: 'block', block: lowBlocks[i], upper: true };
      return { k: 'N', type: 'none' };
    }
    function runsOf(e) {
      const n = Math.max(1, Math.ceil(e.L / 0.25)), runs = [];
      let ps = e.L * 0.5 / n, cur = { s0: 0, o: ownerAt(e, ps) };
      for (let i = 1; i < n; i++) {
        const s = e.L * (i + 0.5) / n, o = ownerAt(e, s);
        if (o.k !== cur.o.k) {
          let lo = ps, hi = s;
          for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (ownerAt(e, m).k === cur.o.k) lo = m; else hi = m; }
          cur.s1 = (lo + hi) / 2; runs.push(cur); cur = { s0: cur.s1, o };
        }
        ps = s;
      }
      cur.s1 = e.L; runs.push(cur);
      // party walls and corner thickness: an unowned sliver goes to its owned neighbours
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i]; if (r.o.type !== 'none' || r.s1 - r.s0 >= 1.0) continue;
        const p = runs[i - 1], q = runs[i + 1], po = p && p.o.type !== 'none', qo = q && q.o.type !== 'none';
        if (po && qo) { const m = (r.s0 + r.s1) / 2; p.s1 = m; q.s0 = m; } else if (po) p.s1 = r.s1; else if (qo) q.s0 = r.s0; else continue;
        runs.splice(i, 1); i--;
      }
      // slivers of another room of the same flat join the neighbour
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i]; if (r.o.type !== 'flat' || r.s1 - r.s0 >= 0.7) continue;
        const p = runs[i - 1], q = runs[i + 1];
        const same = x => x && x.o.type === 'flat' && x.o.unit === r.o.unit && x.o.att === r.o.att;
        if (same(p)) p.s1 = r.s1; else if (same(q)) q.s0 = r.s0; else continue;
        runs.splice(i, 1); i--;
      }
      return runs;
    }

    function flatRun(F, u0, u1, o) {
      const tag = tagOf(o.unit), w = u1 - u0, list = rooms.get(o.unit) || [];
      const kind = o.ri >= 0 ? list[o.ri].kind : 'living';
      const wb = o.att ? dark : clad, spec = o.att ? WIN_DOOR : WIN[kind];
      if (!spec || w < spec.min) { wall(wb, F, u0, u1, y0, yT, tag); return; }
      const n = Math.max(1, Math.round(w / spec.cell)), cell = w / n, ww = Math.min(cell - 2 * spec.margin, spec.max);
      const ya = y0 + spec.sill, yb = y0 + Math.min(2.7, H - 0.42), seed = seedOf(tag.u, o.ri);
      let c = u0;
      for (let k = 0; k < n; k++) {
        const a = u0 + cell * k + (cell - ww) / 2, b = a + ww;
        box(wb, F, c, a, y0, yT, -WALL_T, 0, tag, k ? 'VuU' : 'VU');
        box(wb, F, a, b, yb, yT, -WALL_T, 0, tag, 'Vy');
        if (spec.sill > 0) box(wb, F, a, b, y0, ya, -WALL_T, 0, tag, 'VY');
        glazing(F, a, b, ya, yb, tag, seed, spec.mull);
        c = b;
      }
      box(wb, F, c, u1, y0, yT, -WALL_T, 0, tag, 'Vu');
    }
    function shopRun(F, u0, u1, seed, upper) {
      if (u1 - u0 < 0.9) { wall(clad, F, u0, u1, y0, yT, shared); return; }
      curtain(F, u0, u1, y0, yT, shared, () => seed, 1.9, upper ? { m0: 1, m1: 1 } : { top: 0.75, bot: 0.12, bandBuf: dark, m0: 1, m1: 1 });
    }
    function rampRun(e, u0, u1) {
      const ax = ramp ? (ramp.axis === 'x' ? [1, 0] : [0, 1]) : null;
      if (!ax || Math.abs(e.N[0] * ax[0] + e.N[1] * ax[1]) < 0.7 || u1 - u0 < 2.5) { wall(clad, e.F, u0, u1, y0, yT, shared); return; }
      const hd = Math.min(3.0, H - 0.5);                         // portal: lintel + dark recess
      box(clad, e.F, u0, u1, y0 + hd, yT, -WALL_T, 0, shared, 'Vy');
      box(frame, e.F, u0, u1, y0, y0 + hd, -3.4, -3.2, shared, 'V');
      box(dark, e.F, u0 - 0.02, u0, y0, y0 + hd, -3.2, 0, shared, 'U'); box(dark, e.F, u1, u1 + 0.02, y0, y0 + hd, -3.2, 0, shared, 'u');
      box(dark, e.F, u0, u1, y0 + hd, y0 + hd + 0.02, -3.2, 0, shared, 'y');
    }

    // ---- walls, windows, curtain wall
    // rounded corners first: owner per chord, then runs of chords with one owner share one window (uv 0…1 over the run)
    const arcO = new Map(), arcUV = new Map(), NE = ring.edges.length;
    for (const e of ring.edges) {
      if (!e.arc) continue;
      const mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[1] + e.b[1]) / 2;
      let o = null;
      for (const d of [0.9, 1.6, 2.4, 0.5]) { const t = ownerAtArc(mx - e.N[0] * d, mz - e.N[1] * d); if (t) { o = t; break; } }
      arcO.set(e, o);
    }
    const sameArc = (p, q) => p.arc && q.arc && (arcO.get(p) || {}).unit && (arcO.get(p) || {}).unit === (arcO.get(q) || {}).unit && arcO.get(p).ri === arcO.get(q).ri;
    for (const e of ring.edges) {
      if (!e.arc || arcUV.has(e) || sameArc(ring.edges[(e.i + NE - 1) % NE], e)) continue;       // e starts a run
      const run = [e]; let tot = e.L;
      for (let n = ring.edges[(e.i + 1) % NE]; run.length < NE && sameArc(run[run.length - 1], n) && n !== e; n = ring.edges[(n.i + 1) % NE]) { run.push(n); tot += n.L; }
      let acc = 0; for (const r of run) { arcUV.set(r, [acc / tot, (acc + r.L) / tot]); acc += r.L; }
    }
    for (const e of ring.edges) {
      if (e.arc) {
        const o = arcO.get(e);
        const next = ring.edges[(e.i + 1) % ring.edges.length];
        const opt = { m0: 1, m1: next.arc ? 0 : 1, uv: arcUV.get(e) };
        if (o && o.unit) { const tag = tagOf(o.unit), seed = seedOf(tag.u, o.ri); curtain(e.F, 0, e.L, y0, yT, tag, () => seed, 9, opt); }
        else if (o && o.block && SHOP_KINDS[o.block.kind]) curtain(e.F, 0, e.L, y0, yT, shared, () => 10001, 9, o.upper ? opt : { ...opt, top: 0.75, bot: 0.12, bandBuf: dark });
        else if (o && o.block && o.block.kind === 'lobby') curtain(e.F, 0, e.L, y0, yT, shared, () => 20001, 9, opt);
        else wall(clad, e.F, 0, e.L, y0, yT, shared);
        continue;
      }
      if (e.L < 1.2) { const o = ownerAt(e, e.L / 2); wall(clad, e.F, 0, e.L, y0, yT, o.unit ? tagOf(o.unit) : shared); continue; }
      for (const r of runsOf(e)) {
        const o = r.o, u0 = r.s0, u1 = r.s1;
        if (o.type === 'flat') flatRun(e.F, u0, u1, o);
        else if (o.type === 'log') {            // inset glazed balcony: curtain wall of that flat
          const tag = tagOf(o.unit), seed = seedOf(tag.u, 90);
          curtain(e.F, u0, u1, y0, yT, tag, () => seed, 1.25, { m0: 1, m1: 1 });
        } else if (o.type === 'ent') {
          curtain(e.F, u0, u1, y0, yT, shared, () => 20001, 1.5, { top: Math.max(0.45, H - 3.0), bot: 0.05, bandBuf: dark, m0: 1, m1: 1 });
        } else if (o.type === 'stair') {
          if (u1 - u0 < 1.2) wall(clad, e.F, u0, u1, y0, yT, shared);
          else { const m = Math.min(0.5, (u1 - u0) * 0.15); wall(clad, e.F, u0, u0 + m, y0, yT, shared); wall(clad, e.F, u1 - m, u1, y0, yT, shared); curtain(e.F, u0 + m, u1 - m, y0, yT, shared, () => 30001, 1.2, { m0: 1, m1: 1 }); }
        } else if (o.type === 'block') {
          const k = o.block.kind;
          if (SHOP_KINDS[k]) shopRun(e.F, u0, u1, 10001, o.upper);
          else if (k === 'lobby') shopRun(e.F, u0, u1, 20001, false);
          else if (k === 'parkingRamp') rampRun(e, u0, u1);
          else wall(clad, e.F, u0, u1, y0, yT, shared);
        } else wall(clad, e.F, u0, u1, y0, yT, shared);
      }
    }
    function ownerAtArc(x, z) {
      for (const u of units) for (const o of u.outdoor || []) if (inPoly(outdoorPoly(o), x, z)) return { unit: u, ri: 90 };
      for (const u of units) if (u.poly && inPoly(u.poly, x, z)) return { unit: u, ri: roomAt(u, x, z) };
      for (const k of blocks) if (k.poly && inPoly(k.poly, x, z)) return { block: k };
      for (const k of lowBlocks) if (k.poly && inPoly(k.poly, x, z)) return { block: k, upper: true };
      return null;
    }

    // ---- entrance canopy
    if (ent) {
      const F = ent.e.F, s = ent.s, yc = y0 + Math.min(3.0, H - 0.45);
      box(slab, F, s - 2.7, s + 2.7, yc, yc + 0.2, 0, 2.4, shared, 'VuUY');
      box(soffit, F, s - 2.7, s + 2.7, yc, yc + 0.2, 0, 2.4, shared, 'y');
      for (const d of [-0.95, 0.95]) box(frame, F, s + d - 0.04, s + d + 0.04, y0, yc, -0.05, 0.03, shared, 'VuU');   // door leaves
    }

    // ---- set-back: roof of the plate below, soffit of an overhang
    const below = isGround ? null : plateOf(bId, f - 1);
    if (below && below.id !== plate.id) {
      const rb = ringFor(below);
      cap(roofB, rb.pts, y0 - 0.03, 1, fixed);
      cap(soffit, ring.pts, y0 - 0.01, -1, fixed);
      // parapet glass where the lower plate sticks out and no terrace covers it
      for (const e of rb.edges) {
        const mx = (e.a[0] + e.b[0]) / 2 + e.N[0] * 0.05, mz = (e.a[1] + e.b[1]) / 2 + e.N[1] * 0.05;
        if (inPoly(plate.outline, mx, mz) || distToRing(plate.outline, mx, mz) < 0.45) continue;
        if (units.some(u => (u.outdoor || []).some(o => inPoly(outdoorPoly(o), mx - e.N[0] * 0.5, mz - e.N[1] * 0.5)))) continue;
        pane(rail, e.F, 0, e.L, y0, y0 + RAIL_H, -0.06, fixed);
        box(frame, e.F, 0, e.L, y0 + RAIL_H, y0 + RAIL_H + 0.05, -0.1, -0.02, fixed, 'VY');
      }
    }

    // ---- balconies, glazed balconies, terraces
    const up = isGround || f >= floorsOf(bId).length ? null : unitsOn(bId, f + 1);
    function outdoor(p, kind, tag) {
      const c = centroid(p);
      if (kind !== 'terrace' && inPoly(plate.outline, c[0], c[1])) return;       // inset: handled as curtain wall
      const s = area2(p) > 0 ? 1 : -1, n = p.length, onGround = isGround;
      const yTop = y0 + (onGround ? 0.1 : 0.02);
      cap(onGround ? roofB : soffit, p, yTop, 1, tag);           // paving at grade, timber decking above
      if (!onGround && kind !== 'terrace') cap(soffit, p, y0 - 0.3, -1, tag);
      const lid = kind === 'loggia' && !(up && up.some(u => (u.outdoor || []).some(o => inPoly(outdoorPoly(o), c[0], c[1]))));
      const yL = yT - 0.3;
      if (lid) { cap(slab, p, yL + 0.12, 1, tag); cap(soffit, p, yL, -1, tag); }
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
        const U = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], N = [s * U[1], -s * U[0]], F = { o: a, U, V: N };
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (inPoly(plate.outline, mx, mz) || distToRing(plate.outline, mx, mz) < 0.32) continue;     // against the wall
        if (onGround) {
          box(roofB, F, 0, L, y0, yTop, -0.02, 0, tag, 'V');
          if (L > 0.8) box(hedge, F, 0.1, L - 0.1, y0, y0 + 0.9, -0.55, -0.05, fixed, 'VvYuU');
          continue;
        }
        if (kind !== 'terrace') box(slab, F, 0, L, y0 - 0.3, yTop + 0.1, -0.02, 0, tag, 'V');
        if (lid) box(slab, F, 0, L, yL, yL + 0.12, -0.02, 0, tag, 'V');
        if (kind === 'loggia') {
          pane(rail, F, 0, L, yTop, yL, -0.05, tag);
          box(frame, F, 0, L, y0 + RAIL_H, y0 + RAIL_H + 0.05, -0.09, -0.01, tag, 'V');
          const nm = Math.max(1, Math.round(L / 1.6));
          for (let m = 0; m <= nm; m++) { const x = L * m / nm; box(frame, F, x - 0.04, x + 0.04, yTop, yL, -0.09, 0, tag, m === 0 ? 'VU' : m === nm ? 'Vu' : 'V'); }
        } else {
          pane(rail, F, 0, L, yTop, y0 + RAIL_H, -0.05, tag);
          box(frame, F, 0, L, y0 + RAIL_H, y0 + RAIL_H + 0.05, -0.09, -0.01, tag, 'VY');
          if (kind === 'terrace' && L > 1.2) {                       // planter with greenery inside the rail
            box(slab, F, 0.15, L - 0.15, yTop, yTop + 0.4, -0.6, -0.14, fixed, 'VvuU');
            box(hedge, F, 0.18, L - 0.18, yTop + 0.4, yTop + 0.78, -0.57, -0.17, fixed, 'VvYuU');
          }
        }
      }
    }
    for (const u of units) for (const o of u.outdoor || []) outdoor(outdoorPoly(o), o.kind, tagOf(u));
    if (!isGround && core.balcony) outdoor(rectPoly(core.balcony), 'balcony', shared);       // communal stair balcony
  }

  // ---------------- roof
  function buildRoof() {
    const fl = floorsOf(bId), plate = plateOf(bId, fl[fl.length - 1]); if (!plate) return;
    const ring = ringFor(plate), yR = roofY(bId), sb = SITE.buildings[bId] || {};
    const yP = Math.max(yR + 0.6, sb.parapet ?? B.parapetY ?? yR + 1.1), yTop = Math.max(yR + 3, sb.top ?? B.topY ?? yR + 3.4);
    const tag = { b: bandCode(bId, ROOF_BAND), u: -2, s: 0 };
    cap(roofB, ring.pts, yR, 1, tag);
    for (const e of ring.edges) {
      if (e.arc) {                         // the corner curtain wall runs up as a glass parapet
        box(frame, e.F, 0, e.L, yR, yR + 0.08, -WALL_T, 0, tag, 'V');
        pane(rail, e.F, 0, e.L, yR + 0.08, yP, -0.05, tag);
        box(frame, e.F, 0, e.L, yP - 0.06, yP, -0.1, 0, tag, 'VY');
      } else {
        box(crown, e.F, 0, e.L, yR, yP, -WALL_T, 0, tag, 'VvY');
        if (e.L > 1.2) box(led, e.F, 0.1, e.L - 0.1, yP - 0.2, yP - 0.14, 0, 0.02, tag, 'V');
      }
    }
    const AX = { o: [0, 0], U: [1, 0], V: [0, 1] };
    const solid = (b, x0, x1, z0, z1, ya, yb) => box(b, AX, x0, x1, ya, yb, z0, z1, tag, 'uUvVY');
    const fits = (x0, x1, z0, z1, m) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].every(q => inPoly(ring.pts, q[0], q[1]) && distToRing(ring.pts, q[0], q[1]) > m);
    const core = plate.core || {}, taken = [];
    const put = (b, r, h, m = 0.5) => {
      let { x0, x1, z0, z1 } = r;
      for (let k = 0; k < 8 && !fits(x0, x1, z0, z1, m); k++) {      // shrink towards its centre until it is on the roof
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; x0 = cx + (x0 - cx) * 0.9; x1 = cx + (x1 - cx) * 0.9; z0 = cz + (z0 - cz) * 0.9; z1 = cz + (z1 - cz) * 0.9;
      }
      solid(b, x0, x1, z0, z1, yR, yR + h); taken.push({ x0, x1, z0, z1 });
    };
    const hLift = Math.min(yTop - yR, 4.5);
    for (const l of core.lifts || []) put(hvac, { x0: l.x0 - 0.25, x1: l.x1 + 0.25, z0: l.z0 - 0.25, z1: l.z1 + 0.25 }, hLift);
    for (const s of core.stairs || []) put(hvac, s, Math.min(3.2, hLift));
    // boiler house 6 × 4 × 3 m beside the core (autonomous roof heating), flues up to the top mark
    const all = [...(core.lifts || []), ...(core.stairs || [])];
    if (all.length) {
      const cb = { x0: Math.min(...all.map(r => r.x0)), x1: Math.max(...all.map(r => r.x1)), z0: Math.min(...all.map(r => r.z0)), z1: Math.max(...all.map(r => r.z1)) };
      const cx = (cb.x0 + cb.x1) / 2, cz = (cb.z0 + cb.z1) / 2;
      const free = r => !taken.some(t => r.x0 < t.x1 + 0.3 && r.x1 > t.x0 - 0.3 && r.z0 < t.z1 + 0.3 && r.z1 > t.z0 - 0.3);
      const cand = [];
      for (const [w, d] of [[6, 4], [4, 6]]) {
        cand.push({ x0: cb.x1 + 0.8, x1: cb.x1 + 0.8 + w, z0: cz - d / 2, z1: cz + d / 2 }, { x0: cb.x0 - 0.8 - w, x1: cb.x0 - 0.8, z0: cz - d / 2, z1: cz + d / 2 },
          { x0: cx - w / 2, x1: cx + w / 2, z0: cb.z1 + 0.8, z1: cb.z1 + 0.8 + d }, { x0: cx - w / 2, x1: cx + w / 2, z0: cb.z0 - 0.8 - d, z1: cb.z0 - 0.8 });
      }
      const bh = cand.find(r => fits(r.x0, r.x1, r.z0, r.z1, 1.6) && free(r));
      if (bh) {
        solid(hvac, bh.x0, bh.x1, bh.z0, bh.z1, yR, yR + 3); taken.push(bh);
        const fx = bh.x0 + 0.6, fz = (bh.z0 + bh.z1) / 2, hf = Math.max(4.2, yTop - yR);
        for (const d of [-0.5, 0.5]) solid(hvac, fx - 0.2, fx + 0.2, fz + d - 0.2, fz + d + 0.2, yR + 3, yR + hf);
        // louvred screen wall beside the boiler house
        solid(hvac, bh.x1 - 2.2, bh.x1 - 0.4, bh.z0 + 0.5, bh.z0 + 1.7, yR + 3, yR + 3.7);
      }
      // a few roof units, deterministic
      const rnd = K.rand ? K.rand(7700 + (B.no || 1) * 31) : (() => { let i = 0; return () => (hash(B.no * 97 + i++) % 1000) / 1000; })();
      const xs = ring.pts.map(q => q[0]), zs = ring.pts.map(q => q[1]);
      const bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs);
      for (let k = 0, placed = 0; k < 40 && placed < 4; k++) {
        const x = bx0 + (bx1 - bx0) * rnd(), z = bz0 + (bz1 - bz0) * rnd(), r = { x0: x - 0.75, x1: x + 0.75, z0: z - 0.5, z1: z + 0.5 };
        if (!fits(r.x0, r.x1, r.z0, r.z1, 2.2) || !free(r)) continue;
        solid(hvac, r.x0, r.x1, r.z0, r.z1, yR + 0.25, yR + 1.3); taken.push(r); placed++;
      }
    }
  }

  for (const f of floorsOf(bId)) buildFloor(f);
  buildRoof();
}

export default buildTowerFacade;
