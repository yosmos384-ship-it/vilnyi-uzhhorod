// city-data.js — the real Uzhhorod around the plot: data + logic (V8-city). NO three.js, NO DOM, Node-importable.
// Source: OpenStreetMap (© OpenStreetMap contributors, ODbL), processed by tools/build-city.mjs into js/data-city.js, which is
// imported lazily by loadCity() — nothing of the city is downloaded until the walkthrough / drive mode asks for it.
// Interface: notes/V8-city.md ("EXPORT INTERFACE"). World frame of data.js: metres, [x, z], origin = courtyard centre.
//   right of a direction (dx, dz) = (−dz, dx);   heading = atan2(dx, dz);   right-hand traffic;   ground y = 0 everywhere.

export const TILE = 250;                          // m, streaming tile of city.js
export const SIGNAL_CYCLE = 56, SIGNAL_GREEN = 22, SIGNAL_AMBER = 3, SIGNAL_REDAMBER = 2;
export const RIVER_Y = -3.2;

export const CITY = {
  ready: false, meta: null, bounds: null, boundary: [], seam: null, places: {},
  roads: [], graph: { nodes: [], edges: [] }, crossings: [], signals: [], buildings: [], pois: [], areas: [], rails: [], railCrossings: [],
  busStops: [], trees: new Float32Array(0), lamps: new Float32Array(0), hours: [], cats: [], signs: {},
};
let _promise = null; const _readyCbs = [];
export function onCityReady(cb) { if (CITY.ready) cb(CITY); else _readyCbs.push(cb); }

// ------------------------------------------------------------------ small geometry
const hyp = Math.hypot;
export function inPoly(p, x, z) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function hash2(a, b) { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export const cityHash = hash2;
/** Polyline shifted by `off` metres to the RIGHT of its direction (negative = left), mitred. */
export function offsetLine(pts, off) {
  const n = pts.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
    let d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = c[0] - b[0], d2z = c[1] - b[1];
    let l1 = hyp(d1x, d1z), l2 = hyp(d2x, d2z);
    if (l1 < 1e-6) { d1x = d2x; d1z = d2z; l1 = l2; } if (l2 < 1e-6) { d2x = d1x; d2z = d1z; l2 = l1; }
    if (l1 < 1e-6) { out[i] = [b[0], b[1]]; continue; }
    const n1x = -d1z / l1, n1z = d1x / l1, n2x = -d2z / l2, n2z = d2x / l2;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = hyp(mx, mz);
    if (ml < 1e-6) { out[i] = [b[0] + n1x * off, b[1] + n1z * off]; continue; }
    mx /= ml; mz /= ml; const k = Math.min(2.5, 1 / Math.max(0.2, mx * n1x + mz * n1z));
    out[i] = [b[0] + mx * off * k, b[1] + mz * off * k];
  }
  return out;
}
/** Point and direction at running length s of a road. */
export function pointAt(road, s) {
  const c = road.cum, p = road.pts; s = Math.max(0, Math.min(road.len, s)); let i = 1; while (i < c.length - 1 && c[i] < s) i++;
  const l = c[i] - c[i - 1] || 1, t = (s - c[i - 1]) / l, a = p[i - 1], b = p[i];
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l, seg: i - 1 };
}

// ------------------------------------------------------------------ decoding
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = new Int8Array(128).fill(-1); for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
function decInts(s) { const out = []; let v = 0, sh = 0; for (let i = 0; i < s.length; i++) { const c = B64I[s.charCodeAt(i)]; v |= (c & 31) << sh; if (c & 32) sh += 5; else { out.push(v & 1 ? -((v + 1) >>> 1) : v >>> 1); v = 0; sh = 0; } } return out; }
function decPts(s) { const a = decInts(s), out = []; let x = 0, z = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; z += a[i + 1]; out.push([x / 10, z / 10]); } return out; }

class Grid {                                      // uniform grid of ids
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  key(i, j) { return (i + 32768) * 65536 + (j + 32768); }
  add(i, j, id) { const k = this.key(i, j); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(id); }
  addBox(x0, z0, x1, z1, id) { const c = this.cell; for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) this.add(i, j, id); }
  query(x, z, r, cb) { const c = this.cell; for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) { const a = this.m.get(this.key(i, j)); if (a) for (let k = 0; k < a.length; k++) cb(a[k]); } }
}
let gRoad, gBld, gPoi, gArea, gCross, gWater; let _stamp = 0;
const tiles = new Map();
export const tileKey = (ix, iz) => ix + ':' + iz;
export const tileOf = (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)];
function tileRec(ix, iz) { const k = tileKey(ix, iz); let t = tiles.get(k); if (!t) tiles.set(k, t = { ix, iz, x0: ix * TILE, z0: iz * TILE, roads: [], bld: [], pois: [], areas: [], crossings: [], signals: [], stops: [], trees: [], rails: [], lamps: [], props: null }); return t; }
/** Contents of one streaming tile (ids / records owned by that tile), or null outside the data. */
export function cityTile(ix, iz) { return tiles.get(tileKey(ix, iz)) || null; }
export function cityTiles() { return tiles; }

export function loadCity() {
  if (_promise) return _promise;
  _promise = import('../data-city.js').then(m => { build(m.CITY_DATA); CITY.ready = true; for (const cb of _readyCbs.splice(0)) { try { cb(CITY); } catch (e) { console.warn('[city] ready callback', e); } } return CITY; });
  return _promise;
}

function build(D) {
  CITY.meta = D.meta; CITY.boundary = D.boundary; CITY.seam = D.seam; CITY.places = D.places; CITY.hours = D.hours; CITY.cats = D.cats;
  CITY.signs = Object.fromEntries(D.cats.map((c, i) => [c, D.signs[i]]));
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of D.boundary) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  CITY.bounds = { x0: x0 - 70, x1: x1 + 70, z0: z0 - 70, z1: z1 + 70 };
  // graph nodes
  const nd = decInts(D.nodes), gn = []; { let x = 0, z = 0; for (let i = 0; i < nd.length; i += 2) { x += nd[i]; z += nd[i + 1]; gn.push({ id: gn.length, x: x / 10, z: z / 10, edges: [], signal: -1, deg: 0 }); } }
  // roads
  gRoad = new Grid(50);
  const roads = D.roads.map((r, id) => {
    const A = gn[r[0]], B = gn[r[1]], pts = [[A.x, A.z]]; const d = decInts(r[12]); let px = Math.round(A.x * 10), pz = Math.round(A.z * 10);
    for (let i = 0; i < d.length; i += 2) { px += d[i]; pz += d[i + 1]; pts.push([px / 10, pz / 10]); } pts.push([B.x, B.z]);
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const f = r[8], nm = D.roadNames[r[3]], cls = D.cls[r[2]];
    const road = { id, name: { uk: nm[0], en: nm[1] }, cls, car: !!(f & 64), lanesF: r[4], lanesB: r[5], lanes: r[4] + r[5], oneway: f & 1, w: r[6] / 10, speed: r[7], bridge: (f >> 1) & 1, tunnel: (f >> 2) & 1, round: (f >> 3) & 1,
      lit: (f >> 4) & 1, near: (f >> 5) & 1, surface: D.surf[r[11]], swL: r[9] / 10, swR: r[10] / 10, a: r[0], b: r[1], pts, cum, len: cum[cum.length - 1], steps: cls === 'steps' ? 1 : 0, _q: 0 };
    A.edges.push(id); B.edges.push(id);
    for (let i = 0; i < pts.length - 1; i++) gRoad.addBox(Math.min(pts[i][0], pts[i + 1][0]) - 1, Math.min(pts[i][1], pts[i + 1][1]) - 1, Math.max(pts[i][0], pts[i + 1][0]) + 1, Math.max(pts[i][1], pts[i + 1][1]) + 1, id);
    const m = pointAt({ cum, pts, len: cum[cum.length - 1] }, cum[cum.length - 1] / 2); road.mid = [m.x, m.z];
    tileRec(...tileOf(m.x, m.z)).roads.push(id);
    return road;
  });
  for (const n of gn) { n.deg = n.edges.length; n.carDeg = n.edges.filter(e => roads[e].car && roads[e].cls !== 'service').length; }
  CITY.roads = roads; CITY.graph = { nodes: gn, edges: roads };
  // buildings
  gBld = new Grid(60);
  CITY.buildings = D.bld.map((b, id) => {
    const poly = decPts(b[6]); let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9, sx = 0, sz = 0; for (const [x, z] of poly) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); sx += x; sz += z; }
    const c = [(bx0 + bx1) / 2, (bz0 + bz1) / 2]; let r = 0; for (const [x, z] of poly) r = Math.max(r, hyp(x - c[0], z - c[1]));
    const o = { id, poly, h: b[1] / 10, fl: b[2], kind: D.bk[b[0]], roof: D.roofs[b[3]], name: D.names[b[4]], near: b[5], c, r, bb: [bx0, bz0, bx1, bz1], pois: null };
    gBld.addBox(bx0, bz0, bx1, bz1, id); tileRec(...tileOf(c[0], c[1])).bld.push(id); return o;
  });
  // areas
  gArea = new Grid(125); gWater = new Grid(125);
  CITY.areas = D.areas.map((a, id) => {
    const poly = decPts(a[2]); let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9, sx = 0, sz = 0; for (const [x, z] of poly) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); sx += x; sz += z; }
    const kind = D.ak[a[0]], o = { id, kind, name: D.names[a[1]], poly, c: [sx / poly.length, sz / poly.length], bb: [bx0, bz0, bx1, bz1], gather: kind === 'park' || kind === 'square' || kind === 'playground' ? 1 : 0 };
    (kind === 'water' ? gWater : gArea).addBox(bx0, bz0, bx1, bz1, id);
    for (let i = Math.floor(bx0 / TILE); i <= Math.floor(bx1 / TILE); i++) for (let j = Math.floor(bz0 / TILE); j <= Math.floor(bz1 / TILE); j++) tileRec(i, j).areas.push(id);
    return o;
  });
  // POIs
  gPoi = new Grid(60);
  CITY.pois = D.pois.map((p, id) => {
    const cat = D.cats[p[5]], o = { id, x: p[0] / 10, z: p[1] / 10, nx: p[2] / 100, nz: p[3] / 100, b: p[4], kind: p[10], cat, sign: D.signs[p[5]], name: D.names[p[6]], hours: D.hours[p[7]], h24: p[8] & 1, terrace: (p[8] >> 1) & 1, defaultHours: (p[8] >> 2) & 1, fw: p[9] / 10 };
    const l = hyp(o.nx, o.nz) || 1; o.nx /= l; o.nz /= l;
    gPoi.add(Math.floor(o.x / 60), Math.floor(o.z / 60), id); tileRec(...tileOf(o.x, o.z)).pois.push(id);
    if (o.b >= 0) { const b = CITY.buildings[o.b]; (b.pois || (b.pois = [])).push(id); }
    return o;
  });
  // crossings, signals, stops
  gCross = new Grid(60);
  CITY.signals = D.signals.map((s, id) => {
    const arms = []; for (let i = 0; i < s[4].length; i += 3) { const road = roads[s[4][i]], e = s[4][i + 1], end = e === 0 ? 'a' : e === 1 ? 'b' : '';
      const node = s[2] >= 0 ? gn[s[2]] : null; let heading = 0, stop = [s[0] / 10, s[1] / 10];
      if (end) { const back = Math.min(road.len * 0.45, 9); const q = pointAt(road, end === 'a' ? back : road.len - back), sg = end === 'a' ? -1 : 1; heading = Math.atan2(q.dx * sg, q.dz * sg); stop = [q.x, q.z]; }
      arms.push({ road: road.id, end, heading, group: s[4][i + 2], stop }); void node; }
    const o = { id, x: s[0] / 10, z: s[1] / 10, node: s[2], cycle: SIGNAL_CYCLE, offset: s[3], arms };
    if (o.node >= 0) gn[o.node].signal = id; tileRec(...tileOf(o.x, o.z)).signals.push(id); return o;
  });
  CITY.crossings = D.crossings.map((c, id) => { const road = roads[c[2]], o = { id, x: c[0] / 10, z: c[1] / 10, road: c[2], heading: c[3] / 100, len: road.w, w: road.cls === 'secondary' ? 4 : 3.2, zebra: c[4], signal: c[5] };
    gCross.add(Math.floor(o.x / 60), Math.floor(o.z / 60), id); tileRec(...tileOf(o.x, o.z)).crossings.push(id); return o; });
  CITY.busStops = D.stops.map((s, id) => { const o = { id, x: s[0] / 10, z: s[1] / 10, road: s[2], heading: s[3] / 100, name: D.names[s[4]] }; tileRec(...tileOf(o.x, o.z)).stops.push(id); return o; });
  CITY.rails = D.rails.map((r, id) => { const pts = decPts(r[1]), o = { id, pts, bridge: r[0] & 1, narrow: (r[0] >> 1) & 1, tracks: 1 };
    const seen = new Set(); for (let i = 0; i < pts.length - 1; i++) { const n = Math.max(1, Math.ceil(hyp(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / 100)); for (let k = 0; k <= n; k++) { const t = tileOf(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n), key = tileKey(...t); if (!seen.has(key)) { seen.add(key); tileRec(...t).rails.push(id); } } }
    return o; });
  CITY.railCrossings = decPts(D.railX);
  const tr = decInts(D.trees); CITY.trees = new Float32Array(tr.length); for (let i = 0; i < tr.length; i += 3) { CITY.trees[i] = tr[i] / 10; CITY.trees[i + 1] = tr[i + 1] / 10; CITY.trees[i + 2] = tr[i + 2]; tileRec(...tileOf(tr[i] / 10, tr[i + 1] / 10)).trees.push(i); }
  const lp = decPts(D.lamps); CITY.lamps = new Float32Array(lp.length * 3); lp.forEach((p, i) => { const r = roadAt0(p[0], p[1], 25, true); CITY.lamps[i * 3] = p[0]; CITY.lamps[i * 3 + 1] = p[1]; CITY.lamps[i * 3 + 2] = r ? Math.atan2(r.p[0] - p[0], r.p[1] - p[1]) : 0; tileRec(...tileOf(p[0], p[1])).lamps.push(i * 3); });
}

// ------------------------------------------------------------------ roads
function roadAt0(x, z, maxDist, carOnly) {
  if (!gRoad) return null; let best = null, bestScore = 1e9; const stamp = ++_stamp, roads = CITY.roads;
  gRoad.query(x, z, maxDist, id => {
    const r = roads[id]; if (r._q === stamp) return; r._q = stamp; if (carOnly && !r.car) return;
    const p = r.pts; for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; let t = l2 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + dx * t, pz = a[1] + dz * t, d = hyp(x - px, z - pz); if (d > maxDist) continue;
      const score = Math.max(0, d - r.w / 2) + d * 0.01 + (r.car ? 0 : 0.4);
      if (score < bestScore) { bestScore = score; const l = Math.sqrt(l2) || 1; best = { road: r, seg: i, t, s: r.cum[i] + l * t, d: ((x - px) * -dz + (z - pz) * dx) / l, dist: d, p: [px, pz], heading: Math.atan2(dx, dz) }; }
    }
  });
  if (best) { const r = best.road, ad = Math.abs(best.d); best.on = best.dist <= r.w / 2 + 0.01; const sw = best.d > 0 ? r.swR : r.swL; best.sidewalk = !best.on && sw > 0 && ad <= r.w / 2 + sw + 0.3; }
  return best;
}
/** Nearest road to a point. → { road, seg, t, s, d (signed, + = right of a→b), dist, on, sidewalk, p, heading } | null */
export function roadAt(x, z, maxDist = 30, opts) { return roadAt0(x, z, maxDist, !!(opts && opts.car)); }
export function roadsNear(x, z, r) { const out = []; if (!gRoad) return out; const stamp = ++_stamp, roads = CITY.roads; gRoad.query(x, z, r, id => { const rd = roads[id]; if (rd._q !== stamp) { rd._q = stamp; out.push(rd); } }); return out; }
/** Lane centre offset (m, + = right of a→b) of lane `lane` (0 = kerb side) in direction dir (+1 a→b, −1 b→a). */
export function laneOffset(road, dir, lane = 0) {
  const n = Math.max(1, road.lanesF + road.lanesB), lw = Math.min(3.5, road.w / n), P = n * lw;
  if (road.oneway) { const k = Math.min(lane, road.lanesF - 1); return P / 2 - (k + 0.5) * lw; }
  if (dir >= 0) return P / 2 - (Math.min(lane, Math.max(0, road.lanesF - 1)) + 0.5) * lw;
  return -P / 2 + (Math.min(lane, Math.max(0, road.lanesB - 1)) + 0.5) * lw;
}
/** Centre line of a lane in travel direction. */
export function laneLine(road, dir = 1, lane = 0) { const l = offsetLine(road.pts, laneOffset(road, dir, lane)); return dir >= 0 ? l : l.reverse(); }
/** Best lane for a vehicle at (x, z) heading `heading` (rad). */
export function nearestLane(x, z, heading = 0, maxDist = 30) {
  if (!gRoad) return null; let best = null, bs = 1e9; const hx = Math.sin(heading), hz = Math.cos(heading);
  for (const r of roadsNear(x, z, maxDist)) {
    if (!r.car) continue; const p = r.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = hyp(dx, dz); if (l < 1e-6) continue; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / (l * l); t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + dx * t, pz = a[1] + dz * t, ux = dx / l, uz = dz / l;
      for (const dir of [1, -1]) {
        const nl = dir > 0 ? r.lanesF : r.lanesB; if (!nl) continue; const cos = (ux * hx + uz * hz) * dir;
        for (let k = 0; k < nl; k++) { const off = laneOffset(r, dir, k), lx = px - uz * off, lz = pz + ux * off, d = hyp(x - lx, z - lz); if (d > maxDist) continue; const sc = d + (1 - cos) * 9;
          if (sc < bs) { bs = sc; best = { road: r, dir, lane: k, p: [lx, lz], heading: Math.atan2(ux * dir, uz * dir), d, s: r.cum[i] + l * t, speed: r.speed }; } }
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------ buildings / POIs / areas
export function buildingsNear(x, z, r) { const out = []; if (!gBld) return out; const B = CITY.buildings, stamp = ++_stamp; gBld.query(x, z, r, id => { const b = B[id]; if (b._q === stamp) return; b._q = stamp; if (hyp(b.c[0] - x, b.c[1] - z) <= r + b.r) out.push(b); }); return out; }
export function buildingAt(x, z) { for (const b of buildingsNear(x, z, 0.5)) if (inPoly(b.poly, x, z)) return b; return null; }
export function poisNear(x, z, r) { const out = []; if (!gPoi) return out; const P = CITY.pois; gPoi.query(x, z, r, id => { const p = P[id]; if (hyp(p.x - x, p.z - z) <= r) out.push(p); }); return out; }
export function crossingsNear(x, z, r) { const out = []; if (!gCross) return out; const C = CITY.crossings; gCross.query(x, z, r, id => { const c = C[id]; if (hyp(c.x - x, c.z - z) <= r) out.push(c); }); return out; }
export function inWater(x, z) { if (!gWater) return false; let hit = false; const A = CITY.areas; gWater.query(x, z, 0, id => { if (!hit && inPoly(A[id].poly, x, z)) hit = true; }); return hit; }
/** Area under a point: water first, then the smallest other area. */
export function areaAt(x, z) { if (!gArea) return null; const A = CITY.areas; let w = null; gWater.query(x, z, 0, id => { if (!w && inPoly(A[id].poly, x, z)) w = A[id]; }); if (w) return w;
  let best = null; gArea.query(x, z, 0, id => { const a = A[id]; if (x < a.bb[0] || x > a.bb[2] || z < a.bb[1] || z > a.bb[3]) return; if (inPoly(a.poly, x, z) && (!best || id > best.id)) best = a; }); return best; }
export function insideCity(x, z) { return CITY.boundary.length > 2 && inPoly(CITY.boundary, x, z); }
/** Nearest point inside the soft boundary. */
export function clampToCity(x, z) { const B = CITY.boundary; if (B.length < 3 || inPoly(B, x, z)) return [x, z]; let best = null, bd = 1e18;
  for (let i = 0; i < B.length; i++) { const a = B[i], b = B[(i + 1) % B.length], dx = b[0] - a[0], dz = b[1] - a[1]; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t; const px = a[0] + dx * t, pz = a[1] + dz * t, d = (x - px) ** 2 + (z - pz) ** 2; if (d < bd) { bd = d; best = [px, pz]; } }
  return best; }
/** Ground height: 0 everywhere; the river bed is below (bridges stay at 0). */
export function groundHeight() { return 0; }

// ------------------------------------------------------------------ signals
/** State of a signal for traffic arriving on `road` (group 0 when omitted): 'green' | 'amber' | 'red' | 'redamber'. */
export function signalState(id, t, road) {
  const s = CITY.signals[id]; if (!s) return 'green'; let g = 0;
  if (road !== undefined && road !== null) { const rid = typeof road === 'object' ? road.id : road; const arm = s.arms.find(a => a.road === rid); if (arm) g = arm.group; }
  return phaseState(signalPhase(t, s.offset, g));
}
export function signalPhase(t, offset, group) { const c = SIGNAL_CYCLE; return (((t + offset + group * (c / 2)) % c) + c) % c; }
export function phaseState(ph) { return ph < SIGNAL_GREEN ? 'green' : ph < SIGNAL_GREEN + SIGNAL_AMBER ? 'amber' : ph < SIGNAL_CYCLE - SIGNAL_REDAMBER ? 'red' : 'redamber'; }
/** Pedestrian light of a crossing over `road`: 'walk' while that road has red (with a 2 s clearance at both ends). */
export function pedState(id, t, road) { const s = CITY.signals[id]; if (!s) return 'walk'; let g = 0; const rid = typeof road === 'object' && road ? road.id : road; const arm = s.arms.find(a => a.road === rid); if (arm) g = arm.group;
  const ph = signalPhase(t, s.offset, g); return ph > SIGNAL_GREEN + SIGNAL_AMBER + 2 && ph < SIGNAL_CYCLE - SIGNAL_REDAMBER - 4 ? 'walk' : 'stop'; }

// ------------------------------------------------------------------ clock / opening hours
const CLOCKS = { day: [13, 0], dusk: [19, 30], night: [1, 0] };
const _clock = { mode: 'day', h: 13, m: 0, min: 780, dow: 2 };
export function cityClock() { return _clock; }
export function setCityClock(c = {}) {
  if (c.mode && CLOCKS[c.mode]) { _clock.mode = c.mode; _clock.h = CLOCKS[c.mode][0]; _clock.m = CLOCKS[c.mode][1]; }
  if (typeof c.h === 'number') { _clock.h = c.h; _clock.m = c.m || 0; }
  if (typeof c.dow === 'number') _clock.dow = ((c.dow % 7) + 7) % 7;
  _clock.min = _clock.h * 60 + _clock.m; return _clock;
}
export function isOpen(poi, clock = _clock) {
  const wk = poi && poi.hours; if (!wk) return false; const t = clock.min, d = wk[clock.dow], y = wk[(clock.dow + 6) % 7];
  if (d && t >= d[0] && t < d[1]) return true;
  return !!(y && y[1] > 1440 && t < y[1] - 1440);
}

// ------------------------------------------------------------------ generated street furniture per tile (deterministic)
/** Trees and lamps of one tile, generated from the data: { trees: [[x, z, h, kind]], lamps: [[x, z, heading, h]] } (kind 0 leafy, 1 conifer, 2 small). */
export function tileProps(ix, iz) {
  const T = cityTile(ix, iz); if (!T) return { trees: [], lamps: [], fences: [] }; if (T.props) return T.props;
  const trees = [], lamps = [], roads = CITY.roads, seam = CITY.seam;
  const inSeam = (x, z) => x > seam.x0 - 2 && x < seam.x1 + 2 && z > seam.z0 - 2 && z < seam.z1 + 2;
  const free = (x, z, m) => { if (inSeam(x, z) || !insideCity(x, z) || inWater(x, z)) return false; const r = roadAt0(x, z, 12, false); if (r && r.dist < r.road.w / 2 + m) return false; for (const b of buildingsNear(x, z, m + 1)) { if (inPoly(b.poly, x, z)) return false; for (let k = 0; k < b.poly.length; k++) { const a = b.poly[k], c = b.poly[(k + 1) % b.poly.length], dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz || 1; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; if (hyp(x - a[0] - dx * t, z - a[1] - dz * t) < m) return false; } } return true; };
  for (const i of T.trees) trees.push([CITY.trees[i], CITY.trees[i + 1], CITY.trees[i + 2], 0]);
  for (const i of T.lamps) lamps.push([CITY.lamps[i], CITY.lamps[i + 1], CITY.lamps[i + 2], 8]);
  for (const id of T.roads) {
    const r = roads[id]; if (r.near || r.tunnel) continue;
    const main = r.cls === 'secondary' || r.cls === 'tertiary';
    if (r.lit && r.len > 16 && (r.car || r.cls === 'pedestrian')) {                    // street lamps
      const step = main ? 34 : r.cls === 'pedestrian' ? 26 : 44, off = r.cls === 'pedestrian' ? r.w / 2 - 0.6 : r.w / 2 + 0.55, n = Math.max(1, Math.round(r.len / step)), s0 = r.len / n / 2;
      for (let k = 0; k < n; k++) { const s = s0 + k * r.len / n; const q = pointAt(r, s), side = main || r.cls === 'pedestrian' ? (k + id) % 2 ? 1 : -1 : (id % 2 ? 1 : -1);
        const x = q.x - q.dz * off * side, z = q.z + q.dx * off * side; if (inSeam(x, z)) continue; lamps.push([x, z, Math.atan2(q.dz * side, -q.dx * side), main ? 9 : r.cls === 'pedestrian' ? 4.5 : 7]); }
    }
    if (main && !r.bridge && !r.round && r.len > 30) {                                 // street trees behind the pavement
      for (const side of [1, -1]) { const sw = side > 0 ? r.swR : r.swL, off = r.w / 2 + sw + 1.3; for (let s = 9 + hash2(id, side) * 8; s < r.len - 9; s += 15 + hash2(id, s | 0) * 5) { const q = pointAt(r, s), x = q.x - q.dz * off * side, z = q.z + q.dx * off * side; if (free(x, z, 1.4)) trees.push([x, z, 8 + hash2(x | 0, z | 0) * 5, 0]); } }
    }
  }
  const B = CITY.buildings;
  for (const id of T.bld) { const b = B[id]; if (b.kind !== 'house' || b.near) continue; const h = hash2(id, 77); if (h > 0.72) continue;        // garden trees of the private houses
    const r = roadAt0(b.c[0], b.c[1], 45, true); let dx = hash2(id, 3) - 0.5, dz = hash2(id, 5) - 0.5; if (r) { dx = b.c[0] - r.p[0]; dz = b.c[1] - r.p[1]; } const l = hyp(dx, dz) || 1, d = b.r + 3 + h * 6;
    const x = b.c[0] + dx / l * d + (hash2(id, 9) - 0.5) * 6, z = b.c[1] + dz / l * d + (hash2(id, 11) - 0.5) * 6; if (free(x, z, 1.6)) trees.push([x, z, 5 + h * 5, h < 0.12 ? 1 : 2]); }
  const A = CITY.areas, x0 = T.x0, z0 = T.z0;
  for (const id of T.areas) { const a = A[id]; const step = a.kind === 'forest' ? 8.5 : a.kind === 'park' ? 13 : a.kind === 'cemetery' ? 17 : a.kind === 'scrub' ? 11 : a.kind === 'garden' ? 12 : 0; if (!step) continue;
    const i0 = Math.ceil(Math.max(a.bb[0], x0) / step), i1 = Math.floor(Math.min(a.bb[2], x0 + TILE - 0.01) / step), j0 = Math.ceil(Math.max(a.bb[1], z0) / step), j1 = Math.floor(Math.min(a.bb[3], z0 + TILE - 0.01) / step);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const h = hash2(i * 7 + id, j * 13); if (a.kind === 'park' && h > 0.62) continue; const x = i * step + (hash2(i, j) - 0.5) * step * 0.8, z = j * step + (hash2(j, i + 99) - 0.5) * step * 0.8;
      if (x < x0 || x >= x0 + TILE || z < z0 || z >= z0 + TILE || !inPoly(a.poly, x, z) || !free(x, z, 1.5)) continue; trees.push([x, z, a.kind === 'scrub' || a.kind === 'garden' ? 3.5 + h * 2 : 9 + h * 8, a.kind === 'forest' && h < 0.25 ? 1 : a.kind === 'scrub' || a.kind === 'garden' ? 2 : 0]); } }
  // garden fences of the private houses along their street (generated; one run per house, a gate gap in the middle)
  const fences = [], runs = new Map();
  for (const id of T.bld) { const b = B[id]; if (b.kind !== 'house' || b.near) continue; const r = roadAt0(b.c[0], b.c[1], 38, true); if (!r) continue; const rd = r.road;
    if (rd.near || rd.bridge || rd.tunnel || rd.round || !(rd.cls === 'residential' || rd.cls === 'tertiary' || rd.cls === 'living') || rd.len < 30) continue;
    const side = r.d > 0 ? 1 : -1, off = rd.w / 2 + (side > 0 ? rd.swR : rd.swL) + 0.7; if (r.dist - b.r * 0.6 < off + 1 || r.dist > 34) continue;
    const half = Math.min(11, b.r + 3.5), s0 = Math.max(7, r.s - half), s1 = Math.min(rd.len - 7, r.s + half); if (s1 - s0 < 4) continue;
    const k = rd.id + ':' + side; let a = runs.get(k); if (!a) runs.set(k, a = []); a.push([s0, s1, id, rd, side, off]); }
  for (const a of runs.values()) { a.sort((p, q) => p[0] - q[0]); let end = -1;
    for (const [s0r, s1, id, rd, side, off] of a) { const s0 = Math.max(s0r, end); if (s1 - s0 < 3) continue; end = s1; const style = Math.floor(hash2(id, 41) * 4), h = 1.35 + hash2(id, 43) * 0.5, gate = s0 + (s1 - s0) * (0.3 + 0.4 * hash2(id, 47));
      for (const [u0, u1] of [[s0, gate - 1.6], [gate + 1.6, s1]]) { if (u1 - u0 < 1.2) continue; const n = Math.max(1, Math.ceil((u1 - u0) / 7)); let prev = null;
        for (let i = 0; i <= n; i++) { const q = pointAt(rd, u0 + (u1 - u0) * i / n), x = q.x - q.dz * off * side, z = q.z + q.dx * off * side; if (prev && !inSeam(x, z) && !buildingAtRaw(x, z) && !buildingAtRaw((x + prev[0]) / 2, (z + prev[1]) / 2)) fences.push([prev[0], prev[1], x, z, h, style]); prev = [x, z]; } } } }
  return (T.props = { trees, lamps, fences });
}
function buildingAtRaw(x, z) { for (const b of buildingsNear(x, z, 0.3)) if (inPoly(b.poly, x, z)) return b; return null; }
function propsNear(key, x, z, r) { const out = []; for (let i = Math.floor((x - r) / TILE); i <= Math.floor((x + r) / TILE); i++) for (let j = Math.floor((z - r) / TILE); j <= Math.floor((z + r) / TILE); j++) for (const p of tileProps(i, j)[key]) if (hyp(p[0] - x, p[1] - z) <= r) out.push(p); return out; }
/** Tree trunks ([x, z, height, kind]) / lamp posts ([x, z, heading, height]) within r — obstacles for cars and people. */
export function treesNear(x, z, r) { return CITY.ready ? propsNear('trees', x, z, r) : []; }
export function lampsNear(x, z, r) { return CITY.ready ? propsNear('lamps', x, z, r) : []; }

// ------------------------------------------------------------------ colliders (for the driving / people code)
/** Solid things of one 250 m tile. Kerbs are NOT colliders (0.12 m, drivable over); the ground is y = 0.
 *  → { polys: [{ id, poly (building footprint [[x,z]…]), h, kind }],
 *      walls: [[x1, z1, x2, z2, h, kind ('fence' | 'parapet' | 'shelter')]…]   thin vertical walls,
 *      posts: [[x, z, r, h, kind ('tree' | 'lamp' | 'signal' | 'post')]…]  vertical cylinders }
 *  Water is not a collider: test inWater(x, z) (the river surface is RIVER_Y below the banks). */
export function tileColliders(ix, iz) {
  const T = cityTile(ix, iz); if (!T) return { polys: [], walls: [], posts: [] }; if (T.coll) return T.coll;
  const pr = tileProps(ix, iz), polys = [], walls = [], posts = [];
  for (const id of T.bld) { const b = CITY.buildings[id]; if (b.kind === 'canopy') { for (let i = 0; i < b.poly.length; i += Math.max(1, Math.ceil(b.poly.length / 6))) { const a = b.poly[i]; posts.push([a[0] + (b.c[0] - a[0]) * 0.12, a[1] + (b.c[1] - a[1]) * 0.12, 0.25, b.h, 'post']); } continue; } polys.push({ id, poly: b.poly, h: b.h, kind: b.kind }); }
  for (const f of pr.fences) walls.push([f[0], f[1], f[2], f[3], f[4], 'fence']);
  for (const t of pr.trees) posts.push([t[0], t[1], 0.16 + t[2] * 0.012, t[2], 'tree']);
  for (const l of pr.lamps) posts.push([l[0], l[1], 0.09, l[3], 'lamp']);
  for (const id of T.roads) { const r = CITY.roads[id]; if (!r.bridge || r.near || r.tunnel) continue; const off = r.w / 2 + Math.max(r.swL, r.swR, 0) + 0.12;
    for (const side of [1, -1]) { const o = offsetLine(r.pts, off * side); for (let i = 0; i < o.length - 1; i++) walls.push([o[i][0], o[i][1], o[i + 1][0], o[i + 1][1], 1.2, 'parapet']); } }
  for (const id of T.signals || []) { const sg = CITY.signals[id]; for (const p of signalPosts(sg)) posts.push([p[0], p[1], 0.08, 3.5, 'signal']); }
  for (const id of T.stops || []) { const st = CITY.busStops[id], hd = st.heading, bx = -Math.cos(hd), bz = Math.sin(hd), cx = st.x + bx * 1.6, cz = st.z + bz * 1.6; walls.push([cx - Math.sin(hd) * 1.9, cz - Math.cos(hd) * 1.9, cx + Math.sin(hd) * 1.9, cz + Math.cos(hd) * 1.9, 2.3, 'shelter']); }
  return (T.coll = { polys, walls, posts });
}
/** Where the traffic-light posts of a signal stand: [[x, z, heading, armIndex]…] (city.js draws them from this). */
export function signalPosts(sg) {
  const out = [];
  sg.arms.forEach((a, k) => { const r = CITY.roads[a.road]; if (!r) return; let px, pz, hd;
    if (a.end) { hd = a.heading; const rx = -Math.cos(hd), rz = Math.sin(hd), back = Math.min(r.len * 0.45, Math.max(6, r.w * 0.9)), q = pointAt(r, a.end === 'a' ? back : r.len - back); px = q.x + rx * (r.w / 2 + 0.7); pz = q.z + rz * (r.w / 2 + 0.7); }
    else { const q = pointAt(r, r.len / 2); hd = Math.atan2(q.dx, q.dz); px = sg.x - q.dz * (r.w / 2 + 0.7) - q.dx * 3; pz = sg.z + q.dx * (r.w / 2 + 0.7) - q.dz * 3; }
    out.push([px, pz, hd, k]); });
  return out;
}
function tilesIn(x, z, r, fn) { for (let i = Math.floor((x - r) / TILE); i <= Math.floor((x + r) / TILE); i++) for (let j = Math.floor((z - r) / TILE); j <= Math.floor((z + r) / TILE); j++) fn(i, j); }
/** Colliders whose geometry may touch the circle (x, z, r) — same shape as tileColliders. Cheap enough to call every frame for r ≲ 30 m. */
export function collidersNear(x, z, r) {
  const out = { polys: [], walls: [], posts: [] }; if (!CITY.ready) return out;
  for (const b of buildingsNear(x, z, r)) if (b.kind !== 'canopy') out.polys.push({ id: b.id, poly: b.poly, h: b.h, kind: b.kind });
  tilesIn(x, z, r, (i, j) => { const c = tileColliders(i, j);
    for (const w of c.walls) { const dx = w[2] - w[0], dz = w[3] - w[1], l2 = dx * dx + dz * dz || 1; let t = ((x - w[0]) * dx + (z - w[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; if (hyp(x - w[0] - dx * t, z - w[1] - dz * t) <= r) out.walls.push(w); }
    for (const p of c.posts) if (hyp(p[0] - x, p[1] - z) <= r + p[2]) out.posts.push(p); });
  return out;
}
/** Everything around a point in one call (spatial index helper for the other modules). */
export function cityNear(x, z, r) {
  if (!CITY.ready) return { roads: [], buildings: [], pois: [], crossings: [], signals: [], busStops: [], parkSpots: [], trees: [], lamps: [], colliders: { polys: [], walls: [], posts: [] }, area: null, water: false, inside: false };
  const roads = roadsNear(x, z, r), sig = new Set(); for (const rd of roads) for (const n of [rd.a, rd.b]) { const nd = CITY.graph.nodes[n]; if (nd.signal >= 0 && hyp(nd.x - x, nd.z - z) <= r) sig.add(nd.signal); }
  return { roads, buildings: buildingsNear(x, z, r), pois: poisNear(x, z, r), crossings: crossingsNear(x, z, r), signals: [...sig].map(i => CITY.signals[i]),
    busStops: CITY.busStops.filter(b => hyp(b.x - x, b.z - z) <= r), parkSpots: parkSpotsNear(x, z, r), trees: treesNear(x, z, r), lamps: lampsNear(x, z, r),
    colliders: collidersNear(x, z, r), area: areaAt(x, z), water: inWater(x, z), inside: insideCity(x, z) };
}

// ------------------------------------------------------------------ kerb-side parking spots
let _spots = null, gSpot = null;
function buildSpots() {
  _spots = []; gSpot = new Grid(100);
  for (const r of CITY.roads) {
    if (!r.car || r.near || r.bridge || r.round || r.tunnel || r.len < 44 || r.w < 5.6 || !(r.cls === 'residential' || r.cls === 'tertiary')) continue;
    const nA = CITY.graph.nodes[r.a], nB = CITY.graph.nodes[r.b], m0 = nA.carDeg > 1 ? 15 : 5, m1 = nB.carDeg > 1 ? 15 : 5;
    const xs = crossingsNear(r.mid[0], r.mid[1], r.len / 2 + 10).filter(c => c.road === r.id);
    for (const side of r.oneway ? [1] : [1, -1]) {
      if ((side > 0 ? r.swR : r.swL) <= 0 && r.cls === 'tertiary') continue;
      if (hash2(r.id, side * 31) < 0.3) continue;                                    // some kerbs stay empty
      const off = (r.w / 2 - 1.05) * side;
      for (let s = m0 + 3; s < r.len - m1 - 3; s += 6.1) { const q = pointAt(r, s), x = q.x - q.dz * off, z = q.z + q.dx * off; if (xs.some(c => hyp(c.x - q.x, c.z - q.z) < 9)) continue;
        const id = _spots.length; _spots.push({ id, x, z, heading: Math.atan2(q.dx * side, q.dz * side), road: r.id, side, use: hash2(id, 5) < 0.42 ? 1 : 0 }); gSpot.add(Math.floor(x / 100), Math.floor(z / 100), id); }
    }
  }
  // car parks (OSM amenity=parking polygons): rows of 2.5 × 5 m bays along the longest side, 6 m aisles. Generated layout.
  for (const a of CITY.areas) { if (a.kind !== 'parking' || a.poly.length < 3) continue; const P = a.poly, n = P.length; let bi = 0, bl = 0; for (let i = 0; i < n; i++) { const l = hyp(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]); if (l > bl) { bl = l; bi = i; } }
    if (bl < 8) continue; const ux = (P[(bi + 1) % n][0] - P[bi][0]) / bl, uz = (P[(bi + 1) % n][1] - P[bi][1]) / bl; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of P) { const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    if ((u1 - u0) * (v1 - v0) > 40000) continue; let row = 0, cnt = 0;
    for (let v = v0 + 2.9; v < v1 - 2.6 && cnt < 160; row++) { const flip = row % 2;
      for (let u = u0 + 1.7; u < u1 - 1.5 && cnt < 160; u += 2.6) { const x = ux * u - uz * v, z = uz * u + ux * v; let ok = true;
        for (const [du, dv] of [[-1.15, -2.4], [1.15, -2.4], [1.15, 2.4], [-1.15, 2.4]]) { const cx = x + ux * du - uz * dv, cz = z + uz * du + ux * dv; if (!inPoly(P, cx, cz) || buildingAtRaw(cx, cz)) { ok = false; break; } }
        if (!ok) continue; const id = _spots.length; _spots.push({ id, x, z, heading: Math.atan2(-uz, ux) + (flip ? Math.PI : 0), road: -1, side: 0, lot: a.id, use: hash2(id, 5) < 0.5 ? 1 : 0 }); gSpot.add(Math.floor(x / 100), Math.floor(z / 100), id); cnt++; }
      v += flip ? 5.4 : 11.4; } }
}
/** Kerb-side places for parked cars: { id, x, z, heading, road, side, use (1 = occupied by default) }. */
export function parkSpotsNear(x, z, r) { if (!CITY.ready) return []; if (!_spots) buildSpots(); const out = []; gSpot.query(x, z, r, id => { const s = _spots[id]; if (hyp(s.x - x, s.z - z) <= r) out.push(s); }); return out; }
Object.defineProperty(CITY, 'parkSpots', { get() { if (!CITY.ready) return []; if (!_spots) buildSpots(); return _spots; }, enumerable: true });

// ------------------------------------------------------------------ pavements + pedestrian graph
let _sw = null, _sg = null;
function buildSidewalks() {
  _sw = []; const nodes = [], G = CITY.graph.nodes; const atNode = G.map(() => []);
  const gN = new Grid(60);
  const addNode = (x, z) => { const id = nodes.length; nodes.push({ id, x, z, links: [], crossing: -1 }); gN.add(Math.floor(x / 60), Math.floor(z / 60), id); return id; };
  const link = (a, b) => { if (a === b || a < 0 || b < 0) return; if (!nodes[a].links.includes(b)) nodes[a].links.push(b); if (!nodes[b].links.includes(a)) nodes[b].links.push(a); };
  const runNodes = new Map();                         // road id → { '1': [node ids along], '-1': […], '0': […] }
  for (const r of CITY.roads) {
    const sides = r.car ? [[1, r.swR], [-1, r.swL]].filter(s => s[1] > 0) : [[0, r.w]];
    if (r.car && !sides.length && (r.cls === 'service' || r.cls === 'living' || r.cls === 'track' || r.cls === 'residential')) sides.push([0, Math.min(2, r.w)]);   // people walk on the carriageway of small roads
    const rec = {}; runNodes.set(r.id, rec);
    for (const [side, w] of sides) {
      const off = side ? (r.w / 2 + w / 2) * side : 0, line = side ? offsetLine(r.pts, off) : r.pts;
      const sw = { id: _sw.length, road: r.id, side, w, pts: line }; _sw.push(sw);
      const cut = side ? Math.min(r.len * 0.3, r.w / 2 + 3) : 0, ids = [], n = Math.max(1, Math.ceil((r.len - 2 * cut) / 35));
      for (let k = 0; k <= n; k++) { const q = pointAt(r, cut + (r.len - 2 * cut) * k / n); const id = addNode(q.x - q.dz * off, q.z + q.dx * off); if (ids.length) link(ids[ids.length - 1], id); ids.push(id); }
      rec[side] = ids; atNode[r.a].push({ id: ids[0], road: r, side }); atNode[r.b].push({ id: ids[ids.length - 1], road: r, side });
    }
  }
  for (let g = 0; g < G.length; g++) {                // junctions: link the pavement ends around the node; across a carriageway = crossing link
    const L = atNode[g]; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j]; link(a.id, b.id);
      if (a.road === b.road && a.side && b.side && a.side !== b.side) { const xs = crossingsNear(G[g].x, G[g].z, 22).filter(c => c.road === a.road.id); nodes[a.id].crossing = nodes[b.id].crossing = xs.length ? xs[0].id : -2; } }
  }
  for (const c of CITY.crossings) {                   // mid-block crossings
    const rec = runNodes.get(c.road); if (!rec || !rec[1] || !rec[-1]) continue; const r = CITY.roads[c.road], off = r.w / 2 + 1;
    const ux = Math.sin(c.heading), uz = Math.cos(c.heading); const pair = [];
    for (const side of [1, -1]) { const x = c.x + ux * off * side, z = c.z + uz * off * side; const id = addNode(x, z); nodes[id].crossing = c.id; pair.push(id);
      let best = -1, bd = 1e9; for (const k of [...rec[1], ...rec[-1]]) { const d = hyp(nodes[k].x - x, nodes[k].z - z); if (d < bd) { bd = d; best = k; } }
      const sideIds = rec[1].includes(best) ? rec[1] : rec[-1]; const sorted = sideIds.map(k => [hyp(nodes[k].x - x, nodes[k].z - z), k]).sort((p, q) => p[0] - q[0]); link(id, sorted[0][1]); if (sorted[1]) link(id, sorted[1][1]); }
    link(pair[0], pair[1]);
  }
  _sg = { nodes,
    nearest(x, z, r = 80) { let best = -1, bd = 1e9; gN.query(x, z, r, id => { const d = hyp(nodes[id].x - x, nodes[id].z - z); if (d < bd) { bd = d; best = id; } }); return best; },
    near(x, z, r) { const out = []; gN.query(x, z, r, id => { if (hyp(nodes[id].x - x, nodes[id].z - z) <= r) out.push(id); }); return out; },
    path(from, to, maxNodes = 4000) {               // A* over the pavement graph
      if (from < 0 || to < 0) return []; const T = nodes[to], open = [[0, from]], came = new Map([[from, -1]]), g = new Map([[from, 0]]); let seen = 0;
      while (open.length && seen++ < maxNodes) { let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i; const cur = open.splice(bi, 1)[0][1];
        if (cur === to) { const out = []; for (let k = to; k >= 0; k = came.get(k)) out.push(k); return out.reverse(); }
        const N = nodes[cur], gc = g.get(cur); for (const nb of N.links) { const M = nodes[nb], ng = gc + hyp(M.x - N.x, M.z - N.z); if (!g.has(nb) || ng < g.get(nb)) { g.set(nb, ng); came.set(nb, cur); open.push([ng + hyp(T.x - M.x, T.z - M.z), nb]); } } }
      return [];
    } };
}
Object.defineProperty(CITY, 'sidewalks', { get() { if (!CITY.ready) return []; if (!_sw) buildSidewalks(); return _sw; }, enumerable: true });
/** Pedestrian graph over pavements, footways, squares' paths and crossings: { nodes, nearest(x,z), near(x,z,r), path(a,b) }. Built on first use. */
export const sidewalkGraph = {
  get nodes() { if (!CITY.ready) return []; if (!_sg) buildSidewalks(); return _sg.nodes; },
  nearest(x, z, r) { if (!CITY.ready) return -1; if (!_sg) buildSidewalks(); return _sg.nearest(x, z, r); },
  near(x, z, r) { if (!CITY.ready) return []; if (!_sg) buildSidewalks(); return _sg.near(x, z, r); },
  path(a, b, m) { if (!CITY.ready) return []; if (!_sg) buildSidewalks(); return _sg.path(a, b, m); },
};

// ------------------------------------------------------------------ routing for vehicles (A* over the car graph)
/** Route between two graph nodes for cars, honouring one-ways: → [{ road, dir }] or []. */
export function routeCar(fromNode, toNode, maxNodes = 6000) {
  const G = CITY.graph.nodes, R = CITY.roads; if (!G[fromNode] || !G[toNode]) return []; const T = G[toNode];
  const open = [[0, fromNode]], came = new Map([[fromNode, null]]), g = new Map([[fromNode, 0]]); let seen = 0;
  while (open.length && seen++ < maxNodes) { let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i; const cur = open.splice(bi, 1)[0][1];
    if (cur === toNode) { const out = []; for (let k = toNode; came.get(k); k = came.get(k).from) out.push({ road: R[came.get(k).road], dir: came.get(k).dir }); return out.reverse(); }
    const gc = g.get(cur); for (const eid of G[cur].edges) { const r = R[eid]; if (!r.car) continue; const dir = r.a === cur ? 1 : -1; if (dir < 0 && r.b !== cur) continue; if ((dir > 0 ? r.lanesF : r.lanesB) < 1) continue;
      const nb = dir > 0 ? r.b : r.a, ng = gc + r.len * (50 / Math.max(10, r.speed)); if (!g.has(nb) || ng < g.get(nb)) { g.set(nb, ng); came.set(nb, { from: cur, road: eid, dir }); open.push([ng + hyp(T.x - G[nb].x, T.z - G[nb].z), nb]); } } }
  return [];
}
export function nearestNode(x, z, carOnly = true) { const r = roadAt0(x, z, 200, carOnly); if (!r) return -1; const G = CITY.graph.nodes, a = G[r.road.a], b = G[r.road.b]; return hyp(a.x - x, a.z - z) < hyp(b.x - x, b.z - z) ? r.road.a : r.road.b; }
