// js/three/site-layout.js — T19 · SITE-LAYOUT (CONTRACT §4.5). Data only: no three.js, no DOM, importable in Node.
//
// Everything is in WORLD metres [x, z] (data.js frame: origin = centre of the courtyard ring, +x = вул. Грушевського side
// (true bearing 69.1°), +z = вул. Заньковецької side (159.1°), −z = 339.1°).
//
// Sources
//   · data.js (SITE): plot, towers, podium, ramps, courtyard, the 22 OSM street chains, the 36 neighbour outlines.
//   · data/surroundings.json (OpenStreetMap through W4): landmarks, river, district character — embedded here as lat/lon
//     and converted with data.js llToWorld, so they follow the geo anchor of data.js.
//   · plans.pdf p.20 / p.5 (general plan, constraints plan): bus-stop island, parking court of Грушевського 25, lay-bys, verges.
//   · plans.pdf p.3 (satellite situation scheme, georeferenced on the street junctions): the zones, the 5-storey slabs,
//     the school / kindergarten / hall outlines further out. All of these are `est: true`.
// Nothing here is measured on site: every item not drawn on the plans carries `est: true`.
import {
  SITE as DATA, SITE_CENTER as DATA_CENTER, PLOT, STREETS, CONTEXT_BLOCKS, COURTYARD, PODIUM, RAMPS, SITE_EXTRAS,
  B_IDS, BUILDINGS, platesOf, plateOf, typicalPlate, localToWorld, llToWorld, bearingOf, dirOfBearing,
} from '../data.js';

// ================================================================== small pure helpers
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const P1 = p => [r1(p[0]), r1(p[1])];
const P2 = p => [r2(p[0]), r2(p[1])];
const hyp = Math.hypot;

export function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
export function distSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return hyp(x - ax - dx * t, z - az - dz * t);
}
export function distPolyline(pts, x, z) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}
export function distPolyEdge(poly, x, z) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distSeg(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return d;
}
/** true when (x, z) is inside `poly` or closer than `m` to its boundary */
export function nearPoly(poly, x, z, m = 0) { return inPoly(poly, x, z) || (m > 0 && distPolyEdge(poly, x, z) < m); }
export function bboxOf(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, x1, z0, z1 };
}
const centroid = pts => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };
function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** polygon × polygon overlap (edges cross, or one contains a vertex of the other) */
export function polysOverlap(A, B, a = bboxOf(A), b = bboxOf(B)) {
  if (a.x1 < b.x0 || b.x1 < a.x0 || a.z1 < b.z0 || b.z1 < a.z0) return false;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  return A.some(p => inPoly(B, p[0], p[1])) || B.some(p => inPoly(A, p[0], p[1]));
}
/** polygon × polyline corridor (half-width hw) overlap */
export function polyHitsLine(poly, pts, hw, pb, lb) {
  if (pb && lb && (pb.x1 < lb.x0 - hw || pb.x0 > lb.x1 + hw || pb.z1 < lb.z0 - hw || pb.z0 > lb.z1 + hw)) return false;
  for (const p of poly) if (distPolyline(pts, p[0], p[1]) < hw) return true;
  for (const p of pts) if (inPoly(poly, p[0], p[1])) return true;
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < poly.length; j++) if (segsCross(pts[i], pts[i + 1], poly[j], poly[(j + 1) % poly.length])) return true;
  for (let j = 0; j < poly.length; j++) {                               // long polygon edge passing close to a short polyline
    const a = poly[j], b = poly[(j + 1) % poly.length];
    for (const p of pts) if (distSeg(p[0], p[1], a[0], a[1], b[0], b[1]) < hw) return true;
  }
  return false;
}
const rectPoly = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/** oriented rectangle: centre c, unit tangent t, length L along t, width W across */
export const obb = (c, t, L, W) => {
  const n = [-t[1], t[0]], a = L / 2, b = W / 2;
  return [[c[0] - t[0] * a - n[0] * b, c[1] - t[1] * a - n[1] * b], [c[0] + t[0] * a - n[0] * b, c[1] + t[1] * a - n[1] * b],
    [c[0] + t[0] * a + n[0] * b, c[1] + t[1] * a + n[1] * b], [c[0] - t[0] * a + n[0] * b, c[1] - t[1] * a + n[1] * b]];
};
// deterministic pseudo-random numbers (the layout must be identical on every load)
function rng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// polyline clipped to the square |x|, |z| ≤ R → list of polylines
function clipPolyline(pts, R) {
  const out = []; let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a[0] + R], [dx, R - a[0]], [-dz, a[1] + R], [dz, R - a[1]]]) {
      if (p === 0) { if (q < 0) ok = false; } else { const t = q / p; if (p < 0) { if (t > t1) ok = false; else if (t > t0) t0 = t; } else { if (t < t0) ok = false; else if (t < t1) t1 = t; } }
    }
    if (!ok || t1 - t0 < 1e-9) { cur = null; continue; }
    const A = [a[0] + dx * t0, a[1] + dz * t0], B = [a[0] + dx * t1, a[1] + dz * t1];
    if (!cur || t0 > 0) { cur = [A]; out.push(cur); }
    cur.push(B);
    if (t1 < 1) cur = null;
  }
  return out.filter(l => l.length > 1);
}
// arc-length access to a polyline
function measure(pts) { const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return s; }
function at(pts, cum, s) {
  s = Math.max(0, Math.min(cum[cum.length - 1], s));
  let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], l = cum[i] - cum[i - 1] || 1, k = (s - cum[i - 1]) / l;
  return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], t: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
}
function paramOf(pts, cum, x, z) {                                       // arc length of the point of the polyline nearest to (x, z)
  let best = Infinity, s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0, d = hyp(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best) { best = d; s = cum[i] + Math.sqrt(l2) * t; }
  }
  return s;
}

// ================================================================== 1 · plot, towers, courtyard (from data.js)
export const SITE_CENTER = DATA_CENTER;
const CY = COURTYARD || {};
const PB = bboxOf(PLOT);
export const SITE = { x0: r1(PB.x0 - 45), x1: r1(PB.x1 + 45), z0: r1(PB.z0 - 45), z1: r1(PB.z1 + 45) };   // paint rect = plot bbox + 45 m
export const YARD = { x: CY.center ? CY.center[0] : 0, z: CY.center ? CY.center[1] : 0 };
export const RING = { r0: CY.ring?.r0 ?? 5.9, r1: CY.ring?.r1 ?? 9.8 };                                     // ring path between r0 and r1; lawn disc + big tree inside r0
const PG = CY.playground || null;
export const PLAY = PG ? [PG.x0, PG.x1, PG.z0, PG.z1] : null;                                             // west playground (bbox)

/** ground + typical outlines of every tower, world polygons: [{ id, floors, ground, typical, all: [poly…] }] */
export const TOWERS = B_IDS.map(id => {
  const toW = o => (o || []).map(q => P2(localToWorld(id, q[0], q[1])));
  const g = plateOf(id, 1), t = typicalPlate(id);
  const seen = new Set(), all = [];
  for (const pl of platesOf(id)) { const k = JSON.stringify(pl.outline); if (!seen.has(k) && pl.outline?.length) { seen.add(k); all.push(toW(pl.outline)); } }
  return { id, floors: BUILDINGS[id].floors, ground: toW(g?.outline), typical: toW(t?.outline), all };
});
const TOWER_POLYS = TOWERS.flatMap(t => t.all);
const PODIUM_POLYS = (PODIUM || []).map(p => p.poly);
const RAMP_POLYS = (RAMPS || []).map(r => rectPoly(r.x0, r.x1, r.z0, r.z1));
const EXTRA_SOLIDS = (SITE_EXTRAS || []).filter(e => e.h > 0).map(e => e.poly);                           // ТП, gazebo
const withBB = polys => polys.map(poly => ({ poly, bb: bboxOf(poly) }));
const SOLIDS = withBB([...TOWER_POLYS, ...PODIUM_POLYS, ...RAMP_POLYS, ...EXTRA_SOLIDS]);
const nearAny = (list, x, z, m) => { for (const { poly, bb } of list) if (x > bb.x0 - m && x < bb.x1 + m && z > bb.z0 - m && z < bb.z1 + m && nearPoly(poly, x, z, m)) return true; return false; };
/** true when (x, z) is within m of a tower footprint (any plate), the podium, a ramp, the ТП or the gazebo */
export function nearBuilt(x, z, m = 0) { return nearAny(SOLIDS, x, z, m); }
export function inPlot(x, z, m = 0) { return nearPoly(PLOT, x, z, m); }

// ---- footpaths: COURTYARD.paths + one link from each tower entrance to the path network
const basePaths = (CY.paths || []).map(p => [p.pts.map(P2), p.w]);
const circles = PG ? (PG.circles || []) : [];
export const PLAZAS = [[YARD.x, YARD.z, RING.r1], ...circles.map(c => [c.c[0], c.c[1], c.r])];             // roundabout first, then the rubber play / sport circles
function onPath(paths, x, z, m) {
  for (const [pts, w] of paths) if (distPolyline(pts, x, z) < w / 2 + m) return true;
  return PLAZAS.some(([px, pz, r]) => hyp(x - px, z - pz) < r + m);
}
export const ENTRANCES = B_IDS.map(id => {                                // tower entrances (world), all from the courtyard
  const e = plateOf(id, 1)?.entrance; if (!e) return null;
  return { building: id, p: P2(localToWorld(id, e.p[0], e.p[1])), n: e.n };
}).filter(Boolean);
const links = ENTRANCES.map(e => {
  let d = 0.5, hit = false;
  for (; d < 25; d += 0.25) {
    const x = e.p[0] + e.n[0] * d, z = e.p[1] + e.n[1] * d;
    if (onPath(basePaths, x, z, 0)) { hit = true; break; }
    if (d > 1.5 && nearBuilt(x, z, 0.3)) break;
  }
  d = hit ? d + 1 : Math.min(d, 6);
  return [[e.p, P2([e.p[0] + e.n[0] * d, e.p[1] + e.n[1] * d])], 2.4];
});
export const PATHS = [...basePaths, ...links];
/** true when (x, z) is on a footpath, the ring or a plaza (margin m) */
export function nearPath(x, z, m = 0) { return onPath(PATHS, x, z, m); }

// ---- courtyard details straight from the plans (data.js COURTYARD), for whoever dresses the yard
export const YARD_DETAILS = {
  poly: CY.poly || [], y: CY.y ?? 0, ring: RING,
  lawnPolys: CY.lawns || [],                                              // [0] = disc inside the ring, [1] = strip west of the plot
  playground: PG, terraces: CY.terraces || [], steps: CY.steps || [], pergolas: CY.pergolas || [], hedges: CY.hedges || [],
  driveways: CY.driveways || [], entrances: CY.entrances || [],
  extras: SITE_EXTRAS || [],
};
const HARD = withBB([                                                      // paved / built surfaces of the yard that are not lawn
  ...(CY.paths || []).map(p => p.poly).filter(Boolean), ...(CY.terraces || []), ...(CY.steps || []).map(s => s.poly),
  ...(CY.driveways || []).map(d => d.poly),
]);
const PERG = (CY.pergolas || []).map(p => p.p);

// ---- lawns: the general plan (p.20) is green wherever the yard is not built, paved or a path. The free area is cut into
// rectangles (largest first) on a 0.5 m grid, so every rectangle is clear of towers, podium, ramps, ТП, paths, plazas,
// terraces, steps and driveways by construction.
const LAWN_CELL = 0.5, LAWN_MIN_SIDE = 2.5, LAWN_MIN_AREA = 14, LAWN_MAX = 48;
function cutLawns() {
  const C = LAWN_CELL, nx = Math.ceil((PB.x1 - PB.x0) / C), nz = Math.ceil((PB.z1 - PB.z0) / C);
  const cx = i => PB.x0 + (i + 0.5) * C, cz = j => PB.z0 + (j + 0.5) * C;
  // raster masks: 1 = blocked. Polygons are filled cell by cell inside their bbox, then grown by the clearance.
  const mask = () => new Uint8Array(nx * nz);
  const fill = (m, poly, bb = bboxOf(poly)) => {
    const i0 = Math.max(0, Math.floor((bb.x0 - PB.x0) / C)), i1 = Math.min(nx - 1, Math.ceil((bb.x1 - PB.x0) / C));
    const j0 = Math.max(0, Math.floor((bb.z0 - PB.z0) / C)), j1 = Math.min(nz - 1, Math.ceil((bb.z1 - PB.z0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!m[j * nx + i] && inPoly(poly, cx(i), cz(j))) m[j * nx + i] = 1;
  };
  const grow = (m, dist) => {                                              // blocked ∪ every cell closer than dist to a blocked cell
    const k = Math.ceil(dist / C + 0.5), o = new Uint8Array(m), d2 = (dist / C + 0.71) ** 2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!m[j * nx + i]) continue;
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1 && m[j * nx + i - 1] && m[j * nx + i + 1] && m[(j - 1) * nx + i] && m[(j + 1) * nx + i]) continue;   // interior cell
      for (let b = -k; b <= k; b++) for (let a = -k; a <= k; a++) {
        const ii = i + a, jj = j + b;
        if (a * a + b * b <= d2 && ii >= 0 && ii < nx && jj >= 0 && jj < nz) o[jj * nx + ii] = 1;
      }
    }
    return o;
  };
  let out0 = mask(); for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!inPoly(PLOT, cx(i), cz(j))) out0[j * nx + i] = 1;
  for (let i = 0; i < nx; i++) { out0[i] = 1; out0[(nz - 1) * nx + i] = 1; } for (let j = 0; j < nz; j++) { out0[j * nx] = 1; out0[j * nx + nx - 1] = 1; }
  const mPlot = grow(out0, 0.8);
  const solid = mask(); for (const q of SOLIDS) fill(solid, q.poly, q.bb);
  const mSolid = grow(solid, 0.9);
  const hard = mask(); for (const q of HARD) fill(hard, q.poly, q.bb);
  const mHard = grow(hard, 0.35);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (mPlot[k] || mSolid[k] || mHard[k]) continue;
    const x = cx(i), z = cz(j);
    if (nearPath(x, z, 0.4) || PERG.some(p => hyp(x - p[0], z - p[1]) < 3)) continue;
    free[k] = 1;
  }
  const out = [], minSide = Math.ceil(LAWN_MIN_SIDE / LAWN_CELL), h = new Int32Array(nx), stS = new Int32Array(nx + 2), stH = new Int32Array(nx + 2);
  for (let n = 0; n < LAWN_MAX; n++) {
    let best = null, bestA = 0; h.fill(0);
    for (let j = 0; j < nz; j++) {                                        // largest rectangle of free cells (histogram + stack)
      for (let i = 0; i < nx; i++) h[i] = free[j * nx + i] ? h[i] + 1 : 0;
      let sp = 0;
      for (let i = 0; i <= nx; i++) {
        const cur = i < nx ? h[i] : 0; let start = i;
        while (sp && stH[sp - 1] >= cur) {
          sp--; const s = stS[sp], hh = stH[sp], w = i - s;
          if (w >= minSide && hh >= minSide && w * hh > bestA) { bestA = w * hh; best = { i0: s, i1: i, j0: j - hh + 1, j1: j + 1 }; }
          start = s;
        }
        stS[sp] = start; stH[sp] = cur; sp++;
      }
    }
    if (!best || bestA * LAWN_CELL * LAWN_CELL < LAWN_MIN_AREA) break;
    for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) free[j * nx + i] = 0;
    const x0 = PB.x0 + best.i0 * LAWN_CELL, x1 = PB.x0 + best.i1 * LAWN_CELL, z0 = PB.z0 + best.j0 * LAWN_CELL, z1 = PB.z0 + best.j1 * LAWN_CELL;
    out.push([r2(x0), r2(x1), r2(z0), r2(z1), r1(Math.min(3, Math.min(x1 - x0, z1 - z0) * 0.3))]);
  }
  return out;
}
export const LAWNS = cutLawns();                                           // [[x0, x1, z0, z1, corner radius], …]
export const SITE_LOTS = [];                                               // no open-air car park on the plot (155 places underground)

// ================================================================== 2 · streets
const CLIP = 400;                                                          // streets are traced inside |x|, |z| ≤ 400 m
export const T_ROADS = [];
for (const s of STREETS || []) {
  const parts = clipPolyline(s.pts, CLIP);
  parts.forEach((pts, k) => {
    pts = pts.map(P1);
    const cum = measure(pts);
    if (cum[cum.length - 1] < 15) return;
    const main = !!s.main;
    T_ROADS.push({
      id: k ? `${s.id}~${k + 1}` : s.id, street: s.id, name: s.name, w: s.w, main,
      cls: main ? 'tertiary' : 'residential', lanes: 2, oneway: false,
      kerb: s.w / 2,                                                       // kerb offset from the centre line
      pave: main ? { gap: 1.5, w: 2.5 } : { gap: 0.8, w: 1.5 },            // verge between kerb and pavement, pavement width (est.)
      pts, len: r1(cum[cum.length - 1]), est: s.est !== false, src: 'osm',
    });
  });
}
for (const id of ['hrushevskoho', 'zankovetskoi']) { const r = T_ROADS.find(q => q.id === id); if (r) r.src = 'plans p.20 along the plot, osm beyond'; }
const RD = T_ROADS.map(r => ({ r, cum: measure(r.pts), bb: bboxOf(r.pts) }));
const rd = id => RD.find(q => q.r.id === id) || null;
/** distance from (x, z) to the nearest carriageway edge (negative = on a carriageway); `skip` = road id to ignore */
export function roadGap(x, z, skip) {
  let g = Infinity;
  for (const { r, bb } of RD) {
    if (r.id === skip) continue;
    const m = r.w / 2 + Math.min(g, 60);
    if (x < bb.x0 - m || x > bb.x1 + m || z < bb.z0 - m || z > bb.z1 + m) continue;
    g = Math.min(g, distPolyline(r.pts, x, z) - r.w / 2);
  }
  return g;
}
export function onRoad(x, z, m = 0) { return roadGap(x, z) < m; }

const HR = rd('hrushevskoho'), ZA = rd('zankovetskoi');
// the junction at the south-east corner of the plot
const jp = (() => {
  if (!HR || !ZA) return null;
  let best = null;
  for (const p of HR.r.pts) { const d = distPolyline(ZA.r.pts, p[0], p[1]); if (!best || d < best.d) best = { d, p }; }
  return best.p;
})();
export const JUNCTION = jp ? { p: jp, roads: ['hrushevskoho', 'zankovetskoi'], arms: 4, signals: false, est: true } : null;

// ---- pedestrian crossings (not drawn on the plans → est.): the four arms of the junction + one by the bus stop
export const CROSSINGS = [];
function crossing(id, R, s, note) {
  const q = at(R.r.pts, R.cum, s);
  CROSSINGS.push({ id, road: R.r.id, c: P1(q.p), along: P2(q.t), across: P2([-q.t[1], q.t[0]]), len: R.r.w, w: 4, est: true, note });
}
if (jp) {
  const sH = paramOf(HR.r.pts, HR.cum, jp[0], jp[1]), sZ = paramOf(ZA.r.pts, ZA.cum, jp[0], jp[1]);
  crossing('x-hrushevskoho-n', HR, sH - 14, 'north arm of the junction');
  crossing('x-hrushevskoho-s', HR, sH + 14, 'south arm of the junction');
  crossing('x-zankovetskoi-e', ZA, sZ - 15, 'east arm of the junction');
  crossing('x-zankovetskoi-w', ZA, sZ + 15, 'west arm of the junction');
}

// ---- neighbours (data.js CONTEXT_BLOCKS + 2 OSM outlines it does not carry)
const KIND = { fuel: 'fuel-station', canopy: 'fuel-canopy', pavilion: 'bus-shelter', house: 'private-house', commercial: 'commercial', utility: 'utility', ruin: 'ruin' };
const N_INFO = {                                                            // what is known about single outlines (plans p.5/p.20 abbreviations, OSM tags, W4 notes)
  N1: { name: { uk: 'АЗС WOG', en: 'WOG fuel station' }, tone: 'white-green', roof: 'flat', no: '48' },
  N2: { name: { uk: 'АЗС WOG — навіс', en: 'WOG forecourt canopy' }, tone: 'white-green', roof: 'flat', h: 5.5 },
  N4: { kind: 'residential-low', tone: 'plaster-beige', roof: 'pitched', no: '2г' },
  N5: { kind: 'shed', tone: 'metal-grey', roof: 'flat' },
  N6: { tone: 'brick-weathered', roof: 'none', no: '44' },
  N8: { tone: 'silicate-brick', roof: 'flat', no: '25' },
  N9: { tone: 'plaster-grey', roof: 'flat', note: '1-storey shop annex in front of No. 25' },
  N10: { sub: 'cafe', tone: 'plaster-grey', roof: 'flat' },
  N11: { h: 2.8, tone: 'metal-grey', roof: 'flat' },
  N12: { tone: 'silicate-brick', roof: 'flat', no: '6', note: '9-storey block, вул. Заньковецької 6' },
  O1: { kind: 'outbuilding' }, O2: { kind: 'residential-low', tone: 'plaster-beige', roof: 'pitched' },
  O3: { name: { uk: 'ТЦ «Палладіум»', en: 'Palladium shopping centre' }, tone: 'glass-grey', roof: 'flat' },
  O4: { kind: 'commercial', tone: 'plaster-grey', roof: 'flat' },
  O6: { kind: 'residential-low', tone: 'plaster-beige', roof: 'pitched' }, O10: { kind: 'private-house' },
  O11: { kind: 'commercial', tone: 'plaster-white', roof: 'flat' }, O12: { kind: 'private-house' }, O13: { kind: 'private-house' }, O14: { kind: 'outbuilding' },
  O16: { kind: 'residential-low', tone: 'plaster-white', roof: 'flat', note: '3-storey mixed-use, No. 48а' },
  // O20 / O21: two OSM outlines of one property (No. 53а) that overlap each other. O20 (building=residential, 22 × 9.5 m, no levels
  // tag) is kept as a 2-storey house (est.); O21 keeps only its east wing, the part O20 does not cover.
  O20: { kind: 'residential-low', fl: 2, tone: 'plaster-beige', roof: 'pitched', no: '53а', note: 'storeys not tagged in OSM (est.)' },
  O21: { kind: 'residential-low', tone: 'plaster-beige', roof: 'pitched', poly: [[198.9, -27.9], [222.7, -28.3], [223, -15], [198.9, -14.9]], note: 'east wing only (the west part duplicates O20 in OSM)' },
};
const DROP = new Set(['N7']);                                              // the existing transformer west of the plot is relocated into the plot (ТП) — plans p.5 «Перенос ТП»
const EXTRA_OSM = [                                                        // OSM outlines within 130 m that CONTEXT_BLOCKS does not carry (lat, lon)
  { id: 'X1', kind: 'outbuilding', floors: 1, ll: [[48.61044, 22.27645], [48.61046, 22.27652], [48.61038, 22.27657], [48.61036, 22.2765]], note: 'garage (OSM building=garage)' },
  { id: 'X2', kind: 'private-house', floors: 2, no: '1', ll: [[48.61034, 22.27599], [48.61038, 22.27609], [48.61027, 22.27617], [48.61024, 22.27607]], note: 'house No. 1, 2 levels (OSM)' },
];
function pushOut(poly) {                                                   // keep a neighbour outline off the plot (plan-read outlines touch the boundary by < 1 m)
  let adj = false;
  const out = poly.map(p => {
    if (!inPoly(PLOT, p[0], p[1])) return p;
    let best = null;
    for (let i = 0, j = PLOT.length - 1; i < PLOT.length; j = i++) {
      const a = PLOT[j], b = PLOT[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)), q = [a[0] + dx * t, a[1] + dz * t], d = hyp(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, q };
    }
    if (best.d > 3) return p;
    adj = true;
    const k = (best.d + 0.15) / (best.d || 1);
    return P2([p[0] + (best.q[0] - p[0]) * k, p[1] + (best.q[1] - p[1]) * k]);
  });
  return { poly: out, adj };
}
const TONES_HOUSE = ['plaster-white', 'plaster-cream', 'plaster-yellow', 'plaster-beige', 'brick-red'];
const ROOFS_HOUSE = ['tile-red', 'tile-red', 'tile-red', 'tile-orange', 'tile-brown', 'slate-grey', 'metal-grey'];   // red tile dominates on the satellite view
function neighbour(c) {
  const info = N_INFO[c.id] || {}, fl = info.fl || c.floors || 1;
  if (info.poly) c = { ...c, poly: info.poly };
  let kind = info.kind || KIND[c.kind] || (c.kind === 'residential' ? (fl >= 4 ? 'residential-slab' : 'residential-low') : 'other');
  const bb = bboxOf(c.poly), area = (bb.x1 - bb.x0) * (bb.z1 - bb.z0);
  if (kind === 'other') kind = area < 60 ? 'outbuilding' : 'other';
  const rr = rng('n' + c.id);
  const house = kind === 'private-house';
  const h = info.h ?? (kind === 'residential-slab' ? fl * 2.9 + 1.2 : kind === 'fuel-canopy' ? 5.5 : house ? fl * 3 + 0.4 : kind === 'ruin' ? fl * 3 : fl * 3.3 + 0.6);
  const { poly, adj } = pushOut(c.poly);
  return {
    id: c.id, poly, c: P1(centroid(poly)), fl, h: r1(h), kind, sub: info.sub || null,
    tone: info.tone || (house ? TONES_HOUSE[Math.floor(rr() * TONES_HOUSE.length)] : kind === 'residential-slab' ? 'silicate-brick' : kind === 'outbuilding' || kind === 'utility' ? 'plaster-grey' : 'plaster-beige'),
    roof: info.roof || (house ? 'pitched' : kind === 'residential-slab' ? 'flat' : 'flat'),
    roofTone: house || info.roof === 'pitched' ? ROOFS_HOUSE[Math.floor(rr() * ROOFS_HOUSE.length)] : null,
    name: info.name || null, no: info.no || c.no || null, label: c.name || null, note: info.note || null,
    src: c.src || 'osm', est: c.est !== false, adj,
  };
}
export const NEIGHBOURS = [
  ...(CONTEXT_BLOCKS || []).filter(c => !DROP.has(c.id) && !inPoly(PLOT, ...centroid(c.poly))).map(neighbour),   // outlines OSM still shows on the plot never get here
  ...EXTRA_OSM.map(e => neighbour({ id: e.id, poly: e.ll.map(q => P1(llToWorld(q[0], q[1]))), floors: e.floors, kind: e.kind === 'private-house' ? 'house' : 'other', no: e.no, src: 'osm', est: false }))
    .map((n, i) => ({ ...n, kind: EXTRA_OSM[i].kind, note: EXTRA_OSM[i].note })),
].filter(n => !(CONTEXT_BLOCKS || []).some(c => c.id !== n.id && n.id[0] === 'X' && polysOverlap(c.poly, n.poly)));
// OSM outlines sit on the geo anchor (±10 m), the two main streets on the plan axes: an OSM outline that ends up on a carriageway
// is slid straight back from that street until it stands 1.5 m behind the kerb, together with the outlines attached to it.
{
  const touching = (a, b) => a.poly.some(p => b.poly.some(q => hyp(p[0] - q[0], p[1] - q[1]) < 0.5));
  for (const nb of NEIGHBOURS) {
    if (nb.src !== 'osm' || nb.kind === 'bus-shelter') continue;
    let worst = null;
    for (const { r, cum } of RD) for (const p of nb.poly) {
      const d = distPolyline(r.pts, p[0], p[1]) - r.w / 2 - 1.5;
      if (d < 0 && (!worst || d < worst.d)) { const a = at(r.pts, cum, paramOf(r.pts, cum, p[0], p[1])); worst = { d, p, a }; }
    }
    if (!worst || worst.d < -6) continue;
    let n = [-worst.a.t[1], worst.a.t[0]]; if ((nb.c[0] - worst.a.p[0]) * n[0] + (nb.c[1] - worst.a.p[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const k = -worst.d + 0.05, group = [nb];
    for (let i = 0; i < group.length; i++) for (const o of NEIGHBOURS) if (!group.includes(o) && o.src === 'osm' && touching(group[i], o)) group.push(o);
    for (const g of group) { g.poly = g.poly.map(p => P2([p[0] + n[0] * k, p[1] + n[1] * k])); g.c = P1(centroid(g.poly)); g.adj = true; g.moved = r1(k); }
  }
}
const NB = NEIGHBOURS.map(n => ({ poly: n.poly, bb: bboxOf(n.poly) }));
export function nearNeighbour(x, z, m = 0) { return nearAny(NB, x, z, m); }

// ---- bus stop (pavilion «автобусна зупинка» on the island east of вул. Грушевського, plans p.5 / p.20)
export const BUS_STOP = (() => {
  const sh = NEIGHBOURS.find(n => n.kind === 'bus-shelter'); if (!sh || !HR) return null;
  const s = paramOf(HR.r.pts, HR.cum, sh.c[0], sh.c[1]), q = at(HR.r.pts, HR.cum, s);
  let n = [-q.t[1], q.t[0]]; if ((sh.c[0] - q.p[0]) * n[0] + (sh.c[1] - q.p[1]) * n[1] < 0) n = [-n[0], -n[1]];
  const k = HR.r.w / 2, edge = (ss, off) => { const a = at(HR.r.pts, HR.cum, ss); return P1([a.p[0] + n[0] * off, a.p[1] + n[1] * off]); };
  const platform = [edge(s - 16, k + 0.3), edge(s - 8, k + 0.3), edge(s, k + 0.3), edge(s + 8, k + 0.3), edge(s + 14, k + 0.3), edge(s + 14, k + 3.6), edge(s, k + 3.6), edge(s - 16, k + 3.6)];
  return {
    id: 'hrushevskoho-25', label: { uk: 'Автобусна зупинка', en: 'Bus stop' }, name: null,   // the official stop name is not known
    road: 'hrushevskoho', side: 'east', p: P1([q.p[0] + n[0] * (k + 0.3), q.p[1] + n[1] * (k + 0.3)]), dir: P2(n), along: P2(q.t),
    shelter: sh.id, shelterPoly: sh.poly, platform, routes: ['24'], routesNote: 'only route 24 is documented on this street (Suspilne, 27.08.2025)',
    src: 'plans p.5 / p.20', est: true,
  };
})();
{ // one more crossing: from the plot's pedestrian entrance on вул. Грушевського to the bus-stop platform
  const pe = (CY.entrances || []).find(e => e.kind === 'pedestrian' && HR && distPolyline(HR.r.pts, e.p[0], e.p[1]) < 25);
  if (pe && BUS_STOP) crossing('x-bus-stop', HR, paramOf(HR.r.pts, HR.cum, pe.p[0], pe.p[1]), 'plot entrance ↔ bus stop');
}

// ---- parking pockets around the plot (outside it)
const paved1 = (SITE_EXTRAS || []).find(e => e.kind === 'paved');
export const PARKING_POCKETS = [
  { id: 'pp-hrushevskoho-25', kind: 'parking', label: { uk: 'Стоянка перед будинком № 25', en: 'Parking court of No. 25' },
    poly: [[80.5, -32], [97.3, -32], [97.3, 47], [93.5, 51.5], [82, 50], [80.4, 45]],
    rows: [{ from: [94.8, -25], to: [94.8, 27], n: 20, bay: [2.6, 5], dir: [1, 0] }], access: 'hrushevskoho', src: 'plans p.20 (asphalt «Бр» behind the bus-stop islands)', est: true },
  ...(paved1 ? [{ id: 'pp-fuel-forecourt', kind: 'forecourt', label: { uk: 'Майданчик АЗС', en: 'Fuel station forecourt' }, poly: paved1.poly, rows: [], access: 'zankovetskoi', src: 'plans p.20', est: true }] : []),
].map(p => ({ ...p, poly: p.poly.map(P1) }));

// ================================================================== 3 · zones — all est. Each Z_* is a LIST of polygons (environment.js accepts a list or one polygon).
const Z = pts => pts.map(P1);
export const Z_TRACED = [Z([[-CLIP - 10, -CLIP - 10], [CLIP + 10, -CLIP - 10], [CLIP + 10, CLIP + 10], [-CLIP - 10, CLIP + 10]])];   // every street inside is traced: no generic grid
// former service / industrial strip north-west and west of the plot (sheds, ruin, fuel station, the construction field): no houses
const IND_NW = Z([[-170, 62], [-162, 0], [-154, -66], [-146, -130], [-134, -220], [-124, -300], [38, -300], [40, -256], [42, -163], [44, -106], [48, -62], [50, -45], [-46, -45], [-46, 62]]);
// 5-storey slab quarter east and south-east of the junction (Грушевського 25–29, Заньковецької 38…)
const MID_SE = Z([[96, -66], [122, -66], [124, -8], [226, -8], [226, 22], [400, 18], [400, 400], [118, 400], [111, 330], [95, 180], [85, 110], [96, 74]]);
export const Z_GREEN = [];                                                 // no park within 400 m (Боздоський парк is 1.4 km NNW, Парк Перемоги 0.8 km E)
export const ZONES = [
  { id: 'ind-nw', kind: 'industrial', poly: IND_NW, est: true },
  // asphalt court between вул. Грушевського and No. 25 (bus-stop islands, parking bays — plans p.20): listed as a no-houses zone so that
  // the engine does not put generated private houses on it
  { id: 'court-e', kind: 'industrial', sub: 'paved-court', poly: Z([[69, -40], [97.6, -40], [97.6, 48], [94, 53], [84, 54], [77, 49]]), est: true },
  { id: 'mid-se', kind: 'mid-rise', poly: MID_SE, est: true },
  { id: 'mid-w', kind: 'mid-rise', poly: Z([[-410, -345], [-136, -338], [-146, -220], [-158, -128], [-345, -122], [-345, 68], [-410, 70]]), est: true },
  { id: 'mid-sw', kind: 'mid-rise', poly: Z([[-410, 96], [-306, 93], [-262, 410], [-410, 410]]), est: true },
  { id: 'low-s', kind: 'low-rise', poly: Z([[-300, 93], [56, 80], [64, 130], [70, 180], [86, 330], [92, 410], [-262, 410]]), est: true },
  { id: 'low-ne', kind: 'low-rise', poly: Z([[62, -338], [410, -348], [410, -96], [112, -82], [66, -80], [64, -160]]), est: true },
  { id: 'low-e', kind: 'low-rise', poly: Z([[126, -66], [410, -83], [410, 16], [228, 20], [228, -10], [126, -10]]), est: true },
  { id: 'low-w', kind: 'low-rise', poly: Z([[-343, -120], [-162, -126], [-172, 62], [-343, 66]]), est: true },
  { id: 'low-n', kind: 'low-rise', poly: Z([[-122, -366], [410, -378], [410, -410], [-122, -410]]), est: true },
];
export const Z_IND = ZONES.filter(z => z.kind === 'industrial').map(z => z.poly);    // no houses
export const Z_MID = ZONES.filter(z => z.kind === 'mid-rise').map(z => z.poly);      // estate ground between the apartment blocks: no private houses
const LOW = ZONES.filter(z => z.kind === 'low-rise').map(z => ({ poly: z.poly, bb: bboxOf(z.poly) }));

// ---- large non-residential buildings further out (outlines traced on the satellite scheme, plans p.3) — all est.
export const HALLS = [
  { id: 'zakarpatgaz', kind: 'office', name: { uk: 'Закарпатгаз', en: 'Zakarpatgaz office' }, poly: [[-232.8, -177.4], [-195.7, -169.5], [-200.7, -143.2], [-238.1, -150.5]], h: 10.5, roof: '#6b6f73', note: '3 storeys (OSM)' },
  { id: 'kapushanska-hall', kind: 'commercial', name: null, poly: [[-206.9, -330.6], [-165.5, -324.2], [-176.5, -262.5], [-215.2, -267.9]], h: 9, roof: '#5f6468' },
  { id: 'malibu-hall', kind: 'hall', name: null, poly: [[-139, -508.6], [-114, -503.4], [-112.2, -427.5], [-139.2, -429]], h: 7, roof: '#4e5560', note: 'long shed north of вул. Капушанська' },
  { id: 'kindergarten-8', kind: 'kindergarten', name: { uk: 'ЗДО № 8', en: 'Kindergarten No. 8' }, poly: [[219, 200], [280, 223], [259, 276], [197, 252]], h: 7, roof: '#7d8388' },
  { id: 'lyceum-12', kind: 'school', name: { uk: 'Ліцей № 12', en: 'Lyceum No. 12' }, poly: [[423, 132], [489, 148], [478, 262], [404, 235]], h: 10, roof: '#6a7076' },
  { id: 'school-w', kind: 'school', name: null, poly: [[-570, -70], [-478, -35], [-500, 28], [-592, -7]], h: 10, roof: '#6f7479', note: 'school-like complex with a sports court (name not confirmed)' },
].map(h => ({ ...h, poly: h.poly.map(P1), est: true, src: 'plans p.3 (satellite)' }));
const HB = withBB(HALLS.map(h => h.poly));

// ---- apartment blocks around (not the ones already in NEIGHBOURS): 9-storey blocks = OSM centres (data.js SITE.midrise),
// 5-storey slabs = traced on the satellite scheme. Length, width and bearing are est.
const SLABS_SAT = [
  { id: 'm-e1', w: [452, 54], L: 125, W: 13, b: 72, fl: 5 },               // вул. Заньковецької, north side, second slab
  { id: 'm-s2', w: [236, 132], L: 112, W: 13, b: 19, fl: 5 },
  { id: 'm-s3', w: [345, 131], L: 108, W: 13, b: 18, fl: 5 },
  { id: 'm-r4', w: [480, 294], L: 90, W: 13, b: 73, fl: 5 },
  { id: 'm-b1', w: [232, 327], L: 150, W: 13, b: 77, fl: 5 },
  { id: 'm-b2', w: [225, 379], L: 142, W: 13, b: 75, fl: 5 },
  { id: 'm-v1', w: [348, 380], L: 96, W: 13, b: 153, fl: 5 },
];
const B_FIX = {                                                             // bearings read on the satellite scheme (plans p.3)
  '353|236': { b: 151, L: 105 },                                            // stepped 9-storey block east of the kindergarten
  '-408|-157': { b: 70 }, '-386|-231': { b: 70 }, '-441|-289': { b: 70 }, '-493|-115': { b: 70 },   // slabs west of вул. Достоєвського run WSW–ENE
};
function slabPoly(m) { const d = dirOfBearing(m.b); return obb(m.w, d, m.L, m.W); }
export const MIDRISE = (() => {
  const out = [];
  for (const m of DATA.midrise || []) {
    const [x, z] = m.w;
    if (Math.abs(x) > 560 || Math.abs(z) > 560 || nearNeighbour(x, z, 12) || inPoly(PLOT, x, z)) continue;   // the block opposite the plot is NEIGHBOURS N12
    let b = 69, L = 66, near = null;
    for (const q of RD) { const d = distPolyline(q.r.pts, x, z); if (!near || d < near.d) near = { d, q }; }
    if (near && near.d < 120) { const a = at(near.q.r.pts, near.q.cum, paramOf(near.q.r.pts, near.q.cum, x, z)); b = Math.round(bearingOf(a.t[0], a.t[1]) % 180); }
    const fix = B_FIX[Math.round(x) + '|' + Math.round(z)]; if (fix) { b = fix.b; L = fix.L || L; }
    out.push({ id: `m-9-${out.length + 1}`, w: P1([x, z]), L, W: 14, b, fl: m.floors || 9, roof: null, src: 'osm centre', est: true });
  }
  for (const s of SLABS_SAT) out.push({ ...s, roof: null, src: 'plans p.3 (satellite)', est: true });
  // slide a block sideways off a carriageway / neighbour if its estimated box touches one (centres are ±15 m)
  for (const m of out) {
    const d = dirOfBearing(m.b), n = [-d[1], d[0]];
    const done = out.slice(0, out.indexOf(m));
    const bad = () => { const p = slabPoly(m), bb = bboxOf(p); return RD.some(q => polyHitsLine(p, q.r.pts, q.r.w / 2 + 3, bb, q.bb)) || NEIGHBOURS.some(nb => polysOverlap(p, nb.poly)) || HALLS.some(h => polysOverlap(p, h.poly)) || done.some(o => !o.clash && polysOverlap(p, slabPoly(o))); };
    if (!bad()) continue;
    const w0 = m.w, cand = [];
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) if (i || j) cand.push([hyp(i, j) * 3, i * 3, j * 3]);
    cand.sort((a, b) => a[0] - b[0]);
    let ok = false;
    for (const [dist, i, j] of cand) { m.w = P1([w0[0] + n[0] * i + d[0] * j, w0[1] + n[1] * i + d[1] * j]); if (!bad()) { ok = true; m.moved = r1(dist); break; } }
    if (!ok) { m.w = w0; m.clash = true; }
  }
  return out.filter(m => !m.clash).map(m => ({ ...m, poly: slabPoly(m).map(P1) }));
})();
const MB = withBB(MIDRISE.map(m => m.poly));

// ================================================================== 4 · green patches, trees, lamps, pavements (outside the plot)
export const GREEN_PATCHES = [
  ...(CY.lawns && CY.lawns[1] ? [{ id: 'g-west-strip', kind: 'lawn', poly: CY.lawns[1], src: 'plans p.20', est: false }] : []),
  { id: 'g-fuel-island', kind: 'island', poly: [[-79, 57], [-60.5, 57], [-59.6, 60.2], [-80, 60.2]], src: 'plans p.20', est: true },
  { id: 'g-bus-island-n', kind: 'island', poly: [[70, -26.5], [79, -26.5], [79.5, -18.5], [70.5, -18]], src: 'plans p.20', est: true },
  { id: 'g-bus-island-s', kind: 'island', poly: [[72.6, 0.8], [76.6, 0.8], [77, 8.4], [73.4, 8.8]], src: 'plans p.20', est: true },
  { id: 'g-island-2', kind: 'island', poly: [[75.2, 19.5], [79, 19.5], [79.5, 45.5], [81, 49.5], [92, 50.2], [92, 52.2], [84, 53.2], [79.5, 51], [76.3, 45]], src: 'plans p.20', est: true },
  { id: 'g-verge-s-w', kind: 'verge', poly: [[-94, 73.4], [-31, 73], [-31, 78.2], [-94, 78.8]], src: 'plans p.20', est: true },
  { id: 'g-verge-s-e', kind: 'verge', poly: [[-16, 73], [54, 72.6], [55, 79.5], [-16, 80]], src: 'plans p.20', est: true },
  { id: 'g-pitch', kind: 'pitch', name: { uk: 'Стадіон «Автомобіліст»', en: 'Avtomobilist pitch' }, poly: [[-209, -497.7], [-163.3, -461.4], [-222.4, -380.5], [-270.9, -417.8]], src: 'plans p.3 (satellite) + OSM leisure=pitch', est: true, trees: false },
].map(g => ({ trees: true, ...g, poly: g.poly.map(P1) }));
const PKB = withBB(PARKING_POCKETS.map(p => p.poly));
const BUSB = BUS_STOP ? withBB([BUS_STOP.platform]) : [];
const vehEntr = (CY.entrances || []).filter(e => e.kind === 'vehicle').map(e => e.p);
const pedEntr = (CY.entrances || []).filter(e => e.kind === 'pedestrian').map(e => e.p);

/** a point outside the plot is free for a tree / lamp when it is clear of carriageways, buildings, the plot, parking, the bus platform */
function freeOutside(x, z, m) {
  if (roadGap(x, z) < m) return false;
  if (inPlot(x, z, 0.6) || nearNeighbour(x, z, m + 1) || nearAny(HB, x, z, m + 1) || nearAny(MB, x, z, m + 1)) return false;
  if (nearAny(PKB, x, z, 0.5) || nearAny(BUSB, x, z, 0.5)) return false;
  for (const c of CROSSINGS) if (hyp(x - c.c[0], z - c.c[1]) < c.len / 2 + 5) return false;
  for (const p of vehEntr) if (hyp(x - p[0], z - p[1]) < 9) return false;
  for (const p of pedEntr) if (hyp(x - p[0], z - p[1]) < 4) return false;
  return true;
}

// ---- trees
// yard trees: positions from the general plan (COURTYARD.trees). The three trees of the lay-by island south of the plot stand
// on the modelled kerb of вул. Заньковецької (its carriageway is ≈1.5 m wider in data.js than on p.20) → moved ≈0.8 m north.
const yardTrees = (CY.trees || []).map((t, i) => {
  let p = t.p.slice(), moved = false;
  const r = t.r || 1.5;
  if (!inPoly(PLOT, p[0], p[1])) {
    for (let k = 0; k < 12 && roadGap(p[0], p[1]) < 0.7; k++) {             // step the trunk clear of the modelled kerb
      let near = null; for (const q of RD) { const d = distPolyline(q.r.pts, p[0], p[1]); if (!near || d < near.d) near = { d, q }; }
      const a = at(near.q.r.pts, near.q.cum, paramOf(near.q.r.pts, near.q.cum, p[0], p[1])), dx = p[0] - a.p[0], dz = p[1] - a.p[1], l = hyp(dx, dz) || 1;
      p = [p[0] + dx / l * 0.25, p[1] + dz / l * 0.25]; moved = true;
    }
  }
  return { id: `t-yard-${i + 1}`, p: P2(p), r, h: t.r >= 3 ? 12 : 7, kind: inPoly(PLOT, p[0], p[1]) ? 'yard' : 'street', src: 'plans p.20', est: !!t.est || moved, moved };
}).filter(t => !nearBuilt(t.p[0], t.p[1], 0.3) && !(t.kind === 'street' && nearNeighbour(t.p[0], t.p[1], 1)));

// street tree rows along the two main streets and вул. Капушанська (the satellite view shows continuous rows; positions est.)
export const TREE_ROWS = [];
const streetTrees = [];
function treeRow(R, side, off, step, r) {
  const n = R.cum[R.cum.length - 1], rr = rng('row' + R.r.id + side);
  let run = null, k = 0;
  for (let s = step / 2; s < n; s += step) {
    const a = at(R.r.pts, R.cum, s + (rr() - 0.5) * 1.5), nx = -a.t[1] * side, nz = a.t[0] * side;
    const p = [a.p[0] + nx * off, a.p[1] + nz * off];
    if (!(Math.abs(p[0]) < CLIP && Math.abs(p[1]) < CLIP && freeOutside(p[0], p[1], 1.2))) { run = null; continue; }
    if (!run) { run = { id: `row-${R.r.id}-${side > 0 ? 'a' : 'b'}-${TREE_ROWS.length + 1}`, road: R.r.id, side, off, step, pts: [], est: true }; TREE_ROWS.push(run); }
    run.pts.push(P1(p));
    streetTrees.push({ id: `t-${R.r.id}-${side > 0 ? 'a' : 'b'}-${++k}`, p: P1(p), r: r1(r * (0.85 + rr() * 0.3)), h: r1(7 + rr() * 4), kind: 'street', row: run.id, src: 'est', est: true });
  }
}
for (const R of RD) if (R.r.main) for (const side of [1, -1]) treeRow(R, side, R.r.w / 2 + 2.2, 13, 2.2);
for (let i = TREE_ROWS.length - 1; i >= 0; i--) if (TREE_ROWS[i].pts.length < 2) TREE_ROWS.splice(i, 1);

// a few trees on the green patches (not the pitch)
const patchTrees = [];
for (const g of GREEN_PATCHES) {
  if (!g.trees) continue;
  const bb = bboxOf(g.poly), rr = rng('patch' + g.id), want = Math.max(1, Math.min(6, Math.round((bb.x1 - bb.x0) * (bb.z1 - bb.z0) / 90)));
  for (let k = 0, tries = 0; k < want && tries < 60; tries++) {
    const x = bb.x0 + rr() * (bb.x1 - bb.x0), z = bb.z0 + rr() * (bb.z1 - bb.z0);
    if (!inPoly(g.poly, x, z) || distPolyEdge(g.poly, x, z) < 1.2 || roadGap(x, z) < 2.2 || nearNeighbour(x, z, 2.5) || inPlot(x, z, 1.5) || nearAny(PKB, x, z, 0.5)) continue;
    if (patchTrees.some(t => hyp(t.p[0] - x, t.p[1] - z) < 5) || yardTrees.some(t => hyp(t.p[0] - x, t.p[1] - z) < 4)) continue;
    patchTrees.push({ id: `t-${g.id}-${++k}`, p: P1([x, z]), r: r1(1.6 + rr() * 0.9), h: r1(6 + rr() * 4), kind: 'patch', patch: g.id, src: 'est', est: true });
  }
}
// T32: self-seeded trees on the unused land north and west of the plot (plans p.20 draws scattered vegetation marks there;
// positions est.). Without them the field next to towers 3 and 4 read as an empty, unfinished area from above.
const wildTrees = [];
{
  const rr = rng('wild-nw'), AREAS = [[-150, -47, -44, 22, 30], [-120, 46, -118, -56, 34], [-150, -47, -118, -44, 14]];   // [x0, x1, z0, z1, n]
  let k = 0;
  for (const [x0, x1, z0, z1, n] of AREAS) for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
    const x = x0 + rr() * (x1 - x0), z = z0 + rr() * (z1 - z0);
    if (!freeOutside(x, z, 3) || nearNeighbour(x, z, 4) || inPlot(x, z, 3)) continue;
    if (wildTrees.some(t => hyp(t.p[0] - x, t.p[1] - z) < 5.5) || patchTrees.some(t => hyp(t.p[0] - x, t.p[1] - z) < 5) || streetTrees.some(t => hyp(t.p[0] - x, t.p[1] - z) < 5)) continue;
    wildTrees.push({ id: `t-wild-${++k}`, p: P1([x, z]), r: r1(1.5 + rr() * 1.4), h: r1(5 + rr() * 6), kind: 'patch', patch: 'wild-nw', src: 'est', est: true }); i++;
  }
}
const farFromYard = t => !yardTrees.some(y => hyp(y.p[0] - t.p[0], y.p[1] - t.p[1]) < 4.5);
/** all single trees: yard (plans), street rows and patches (est.). Garden trees of the private houses are in HOUSE_LOTS. */
export const TREES = [...yardTrees, ...streetTrees.filter(farFromYard), ...patchTrees, ...wildTrees];

// ---- street lamps: one side, alternating runs are not modelled; main streets h 9 m every 32 m, side streets h 7 m every 42 m
export const LAMPS = [];
for (const R of RD) {
  const main = R.r.main, step = main ? 32 : 42, off = R.r.w / 2 + 0.9, n = R.cum[R.cum.length - 1];
  const side = R.r.id.startsWith('hrushevskoho') ? 1 : -1;                  // вул. Грушевського: plot side (west) is −n → lamps on the plot side
  let k = 0;
  for (let s = step / 2; s < n; s += step) {
    const a = at(R.r.pts, R.cum, s);
    for (const sg of [side, -side]) {                                       // preferred side first, the other one if blocked
      const nx = -a.t[1] * sg, nz = a.t[0] * sg, p = [a.p[0] + nx * off, a.p[1] + nz * off];
      if (Math.abs(p[0]) > CLIP || Math.abs(p[1]) > CLIP) break;
      if (roadGap(p[0], p[1]) < 0.6 || nearNeighbour(p[0], p[1], 1) || inPlot(p[0], p[1], 0.3) || nearAny(BUSB, p[0], p[1], 0) || nearAny(MB, p[0], p[1], 1) || nearAny(HB, p[0], p[1], 1)) continue;
      if (CROSSINGS.some(c => hyp(p[0] - c.c[0], p[1] - c.c[1]) < c.len / 2 + 1.5)) continue;
      LAMPS.push({ id: `l-${R.r.id}-${++k}`, p: P1(p), dir: P2([-nx, -nz]), h: main ? 9 : 7, arm: main ? 2 : 1.2, road: R.r.id, main, est: true });
      break;
    }
  }
}

// ---- pavements along the streets (centre lines of the pavement strips). Along the plot the plan pavements are in PATHS.
export const SIDEWALKS = [];
for (const R of RD) {
  const pv = R.r.pave, off = R.r.w / 2 + pv.gap + pv.w / 2, n = R.cum[R.cum.length - 1];
  for (const side of [1, -1]) {
    let run = null;
    for (let s = 0; s <= n + 1e-6; s += 8) {
      const a = at(R.r.pts, R.cum, Math.min(s, n)), p = [a.p[0] - a.t[1] * side * off, a.p[1] + a.t[0] * side * off];
      const ok = Math.abs(p[0]) <= CLIP + 1 && Math.abs(p[1]) <= CLIP + 1 && !inPlot(p[0], p[1], 2.5) && !nearNeighbour(p[0], p[1], pv.w / 2) && !nearAny(PKB, p[0], p[1], 0) && roadGap(p[0], p[1], R.r.id) > -R.r.w;
      if (!ok) { run = null; continue; }
      if (!run) { run = { id: `sw-${R.r.id}-${side > 0 ? 'a' : 'b'}-${SIDEWALKS.length + 1}`, road: R.r.id, side, w: pv.w, off: r2(off), pts: [], est: true }; SIDEWALKS.push(run); }
      run.pts.push(P1(p));
    }
  }
}
for (let i = SIDEWALKS.length - 1; i >= 0; i--) if (SIDEWALKS[i].pts.length < 2) SIDEWALKS.splice(i, 1);

// ================================================================== 5 · private-house lots with gardens (low-rise fabric) — est.
const WALLS = TONES_HOUSE, ROOF_T = ROOFS_HOUSE;
const inLow = (x, z) => { for (const { poly, bb } of LOW) if (x >= bb.x0 && x <= bb.x1 && z >= bb.z0 && z <= bb.z1 && inPoly(poly, x, z)) return true; return false; };
function samples(poly) {                                                   // corners, edge thirds, centre
  const out = [centroid(poly)];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; out.push(a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (b[0] - a[0]) * 2 / 3, a[1] + (b[1] - a[1]) * 2 / 3]); }
  return out;
}
export const HOUSE_LOTS = (() => {
  const lots = [];
  const lotBB = [], FIXED = [...NB, ...HB, ...MB, ...PKB, ...withBB(GREEN_PATCHES.map(g => g.poly)), { poly: PLOT, bb: PB }];
  const blockedBy = (poly, ownRoad) => {
    const bb = bboxOf(poly);
    if (bb.x0 < -CLIP || bb.x1 > CLIP || bb.z0 < -CLIP || bb.z1 > CLIP) return true;
    for (const q of RD) if (polyHitsLine(poly, q.r.pts, q.r.w / 2 + (q.r.id === ownRoad ? 1.2 : 2.2), bb, q.bb)) return true;
    for (const o of FIXED) if (polysOverlap(poly, o.poly, bb, o.bb)) return true;
    for (let i = 0; i < lots.length; i++) if (polysOverlap(poly, lots[i].poly, bb, lotBB[i])) return true;
    return false;
  };
  // (a) lots of the private houses OSM / the plans really show (NEIGHBOURS kind 'private-house'): boundary est., house real
  for (const nb of NEIGHBOURS) {
    if (nb.kind !== 'private-house') continue;
    let near = null; for (const q of RD) { const d = distPolyline(q.r.pts, nb.c[0], nb.c[1]); if (!near || d < near.d) near = { d, q }; }
    if (!near || near.d > 60) continue;
    const a = at(near.q.r.pts, near.q.cum, paramOf(near.q.r.pts, near.q.cum, nb.c[0], nb.c[1]));
    let n = [-a.t[1], a.t[0]]; if ((nb.c[0] - a.p[0]) * n[0] + (nb.c[1] - a.p[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const proj = nb.poly.map(p => [(p[0] - a.p[0]) * a.t[0] + (p[1] - a.p[1]) * a.t[1], (p[0] - a.p[0]) * n[0] + (p[1] - a.p[1]) * n[1]]);
    const u0 = Math.min(...proj.map(p => p[0])) - 2.5, u1 = Math.max(...proj.map(p => p[0])) + 2.5, v1 = Math.max(...proj.map(p => p[1]));
    const front = Math.min(near.q.r.w / 2 + 2.6, Math.min(...proj.map(p => p[1])) - 0.5);
    let poly = null, depth = 0;
    for (const extra of [14, 10, 6, 3, 1.5]) {                             // deepest garden that fits
      depth = v1 + extra - front;
      const c = [a.p[0] + a.t[0] * (u0 + u1) / 2 + n[0] * (front + depth / 2), a.p[1] + a.t[1] * (u0 + u1) / 2 + n[1] * (front + depth / 2)];
      const cand = obb(c, a.t, u1 - u0, depth).map(P1);
      const others = NEIGHBOURS.filter(o => o !== nb), bb = bboxOf(cand);
      if (bb.x0 < -CLIP || bb.x1 > CLIP || bb.z0 < -CLIP || bb.z1 > CLIP) continue;
      if (RD.some(q => polyHitsLine(cand, q.r.pts, q.r.w / 2 + 0.8, bb, q.bb)) || polysOverlap(cand, PLOT, bb, PB) || others.some(o => polysOverlap(cand, o.poly)) || lots.some((l, i) => polysOverlap(cand, l.poly, bb, lotBB[i]))) continue;
      poly = cand; break;
    }
    if (!poly) continue;
    const rr = rng('lot' + nb.id), trees = [];
    for (let k = 0, tries = 0; k < 2 && tries < 30; tries++) {
      const u = u0 + 1.5 + rr() * (u1 - u0 - 3), v = front + 1.5 + rr() * (depth - 3), x = a.p[0] + a.t[0] * u + n[0] * v, z = a.p[1] + a.t[1] * u + n[1] * v;
      if (nearNeighbour(x, z, 2.6) || roadGap(x, z) < 2.6 || trees.some(t => hyp(t[0] - x, t[1] - z) < 4)) continue;
      trees.push([r1(x), r1(z), r1(1.6 + rr() * 1.2)]); k++;
    }
    lotBB.push(bboxOf(poly));
    lots.push({ id: `lot-${nb.id}`, poly, c: P1(centroid(poly)), yaw: r2(Math.atan2(a.t[0], a.t[1])), road: near.q.r.id, houseId: nb.id, house: null, garden: { trees }, src: nb.src, est: true });
  }
  // (b) generated lots along the streets of the low-rise zones (single row on each side)
  for (const R of RD) {
    const n = R.cum[R.cum.length - 1], rr = rng('lots' + R.r.id);
    for (const side of [1, -1]) {
      let s = 9 + rr() * 6;
      while (s < n - 9) {
        const f = 16 + rr() * 6, depth = 26 + rr() * 9, a = at(R.r.pts, R.cum, s + f / 2), nrm = [-a.t[1] * side, a.t[0] * side];
        const front = R.r.w / 2 + R.r.pave.gap + R.r.pave.w + 0.6;
        const c = [a.p[0] + nrm[0] * (front + depth / 2), a.p[1] + nrm[1] * (front + depth / 2)];
        if (!inLow(c[0], c[1])) { s += 12; continue; }
        const poly = obb(c, a.t, f - 0.6, depth).map(P1);
        const okZone = samples(poly).every(p => inLow(p[0], p[1]));
        if (!okZone || blockedBy(poly, R.r.id)) { s += okZone ? 4 : 12; continue; }
        const hw = 8 + rr() * 3.5, hd = 7.5 + rr() * 3, set = 4.5 + rr() * 3.5, lat = (rr() - 0.5) * Math.max(0, f - 2.6 - hw) * 0.7;
        const hc = [a.p[0] + nrm[0] * (front + set + hd / 2) + a.t[0] * lat, a.p[1] + nrm[1] * (front + set + hd / 2) + a.t[1] * lat];
        const fl = rr() < 0.3 ? 2 : 1, trees = [], nt = 1 + Math.floor(rr() * 2.6);
        for (let k = 0, tries = 0; k < nt && tries < 20; tries++) {
          const u = (rr() - 0.5) * (f - 5), v = front + set + hd + 3 + rr() * Math.max(1, depth - set - hd - 6), x = a.p[0] + a.t[0] * u + nrm[0] * v, z = a.p[1] + a.t[1] * u + nrm[1] * v;
          if (trees.some(t => hyp(t[0] - x, t[1] - z) < 4.2)) continue;
          trees.push([r1(x), r1(z), r1(1.7 + rr() * 1.4)]); k++;
        }
        lotBB.push(bboxOf(poly));
        lots.push({
          id: `lot-${R.r.id}-${side > 0 ? 'a' : 'b'}-${lots.length + 1}`, poly, c: P1(c), yaw: r2(Math.atan2(a.t[0], a.t[1])), road: R.r.id, houseId: null,
          house: { c: P1(hc), w: r1(hw), d: r1(hd), yaw: r2(Math.atan2(a.t[0], a.t[1])), poly: obb(hc, a.t, hw, hd).map(P1), fl, h: fl * 3 + 0.4,
            roof: rr() < 0.62 ? 'gable' : 'hip', tone: WALLS[Math.floor(rr() * WALLS.length)], roofTone: ROOF_T[Math.floor(rr() * ROOF_T.length)] },
          garden: { trees }, src: 'est', est: true,
        });
        s += f;
      }
    }
  }
  return lots;
})();

// ================================================================== 6 · landmarks and the far skyline
const LM = (id, kind, uk, en, lat, lon, extra = {}) => ({ id, kind, name: { uk, en }, p: P1(llToWorld(lat, lon)), ...extra });
/** named points within ±600 m (labels, night lights, map pins) — positions from OSM */
export const LANDMARKS_NEAR = [
  LM('palladium', 'commercial', 'ТЦ «Палладіум»', 'Palladium shopping centre', 48.61218, 22.27732, { neighbour: 'O3' }),
  LM('wog', 'fuel', 'АЗС WOG', 'WOG fuel station', 48.61079, 22.27598, { neighbour: 'N1' }),
  LM('zankovetskoi-6', 'residential', 'вул. Заньковецької, 6', '9-storey block, Zankovetskoi 6', 48.61067, 22.27736, { neighbour: 'N12' }),
  LM('hrafit', 'residential', 'ЖК «Графіт»', 'Hrafit residential complex', 48.61018, 22.2755),
  LM('zakarpatgaz', 'office', 'Закарпатгаз', 'Zakarpatgaz office', 48.61227, 22.27351, { hall: 'zakarpatgaz' }),
  LM('fuel-kapushanska', 'fuel', 'АЗС AViA / Amic', 'AViA and Amic fuel stations', 48.61507, 22.27697),
  LM('kindergarten-8', 'kindergarten', 'ЗДО № 8', 'Kindergarten No. 8', 48.61023, 22.281, { hall: 'kindergarten-8' }),
  LM('lyceum-12', 'school', 'Ліцей № 12', 'Lyceum No. 12', 48.61068, 22.28382, { hall: 'lyceum-12' }),
  LM('avtomobilist', 'pitch', 'Стадіон «Автомобіліст»', 'Avtomobilist pitch', 48.61429, 22.27209, { patch: 'g-pitch' }),
].filter(l => Math.abs(l.p[0]) <= 600 && Math.abs(l.p[1]) <= 600);
// river Uzh centre line (OSM waterway, lat/lon, every 2nd–3rd vertex within 2.7 km)
const RIVER_LL = [[48.6175, 22.3077], [48.618, 22.3048], [48.6203, 22.3009], [48.6218, 22.2975], [48.6229, 22.2934], [48.6234, 22.29], [48.623, 22.2874], [48.6218, 22.2837],
  [48.6201, 22.2793], [48.62, 22.2782], [48.6202, 22.2739], [48.6219, 22.2723], [48.6242, 22.272], [48.6267, 22.2687], [48.6268, 22.2661], [48.6231, 22.2622], [48.62, 22.2591], [48.6184, 22.2555], [48.6153, 22.2545]];
const polar = ([lat, lon]) => { const [x, z] = llToWorld(lat, lon), cx = DATA.geo?.world?.[0] ?? 0, cz = DATA.geo?.world?.[1] ?? 0, b = Math.round(bearingOf(x - cx, z - cz)); return { bearing: b, dist: Math.round(hyp(x - cx, z - cz)), dir: P2(dirOfBearing(b)) }; };
const far = (id, uk, en, bearing, dist, extra = {}) => ({ id, name: { uk, en }, bearing, dist, dir: P2(dirOfBearing(bearing)), ...extra });
/**
 * Far skyline hints, polar from the plot centre (true bearing °, distance m; `dir` = world unit vector [dx, dz]).
 * Hills: general geography of Uzhhorod (lowland meets the Carpathian foothills) — NOT measured, artistic guidance.
 */
export const SKYLINE = {
  est: true, flat: true, elevationM: 115,
  hills: [
    { id: 'foothills-n', from: 330, to: 20, dist: 6000, rel: 0.55, tone: 'blue-green', note: 'wooded foothills beyond the Uzh' },
    { id: 'foothills-ne', from: 20, to: 70, dist: 5000, rel: 1, tone: 'blue-green', note: 'Carpathian foothills, the highest part of the backdrop' },
    { id: 'foothills-e', from: 70, to: 100, dist: 6000, rel: 0.6, tone: 'blue-green', note: 'ridge fading out to the east' },
  ].map(h => ({ ...h, dirFrom: P2(dirOfBearing(h.from)), dirTo: P2(dirOfBearing(h.to)), dirMid: P2(dirOfBearing(h.from + (((h.to - h.from) % 360 + 360) % 360) / 2)) })),
  plain: { from: 100, to: 330, note: 'open Transcarpathian lowland to the south and west (flat horizon)' },
  river: { ...far('uzh', 'Уж', 'Uzh', 4, 969), flow: 'east → west', widthM: 60, widthEst: true, est: false,
    course: RIVER_LL.map(polar),                                           // OSM centre line, upstream (east) → downstream (west), polar from the plot centre
    note: 'north of the site, not visible from the ground; visible from the upper floors looking north' },
  oldTown: far('castle', 'Ужгородський замок, старе місто', 'Uzhhorod Castle, old town', 62, 2475, { note: 'castle hill' }),
  far: [
    far('bozdosh', 'Боздоський парк', 'Bozdosh Park', 332, 1360, { kind: 'forest-park' }),
    far('avanhard', 'Стадіон «Авангард»', 'Avanhard Stadium', 2, 1385, { kind: 'stadium' }),
    far('peremohy', 'Парк Перемоги', 'Peremohy Park', 90, 804, { kind: 'park' }),
  ],
  tallest: 9,                                                              // nothing above 9 storeys is tagged within 600 m
};

// ================================================================== 7 · one object with everything (debug picture, checks)
export function layoutDump() {
  return {
    SITE_CENTER, SITE, YARD, RING, PLAY, PLOT, TOWERS, PODIUM: PODIUM_POLYS, RAMPS: RAMP_POLYS, EXTRAS: EXTRA_SOLIDS,
    LAWNS, PATHS, PLAZAS, SITE_LOTS, ENTRANCES, YARD_DETAILS,
    T_ROADS, JUNCTION, CROSSINGS, BUS_STOP, SIDEWALKS, LAMPS, PARKING_POCKETS,
    Z_TRACED, Z_IND, Z_MID, Z_GREEN, ZONES, HALLS, MIDRISE, NEIGHBOURS, HOUSE_LOTS,
    GREEN_PATCHES, TREE_ROWS, TREES, LANDMARKS_NEAR, SKYLINE,
  };
}
