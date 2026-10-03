// ЖК VILNYI — commercial podium, fitness / pool wing, parking-ramp portals and site extras (task T12, CONTRACT §4.1).
// Pure geometry into the buffers of exterior.js: `buildPodium(K, bufs)`. World coordinates, nothing is a floor pick target.
// Everything is generated from data.js: PODIUM (P2 supermarket block with `parts`, P3 fitness with `outside` + `pool`),
// RAMPS (`from` → `to`, `open` is a world coordinate), SITE_EXTRAS.
//
// Buffers are used with the meaning exterior.js (T10) gives them for the podium material set: wall = anthracite cladding,
// stone = darker plinth, accent = timber-look fins, slab = dark slab edges, frame = mullions, glass (seed > 10000 = shopfront,
// lit at night), rail = clear glass, soffit = lit timber soffit, roof = grey paving / concrete, hedge = planting, led = light line.
//
// A podium entry with `outside` (the fitness / pool wing of building 3) is part of that tower's ground plate, and the tower
// module already draws a one-storey glazed base on that outline. So its skin is built on the tower's own floor-1 outline
// (0.15 m in front of it) and runs the full double height up to `roofing`; the hall glazing is reflective like on the
// renders, so the pool itself (`pool`) is not visible from outside — its panes only get a cooler light at night.
//
// Optional third argument `extras` (a THREE.Group, or `K.extras`): when given, the sign texts (generic captions, no tenant
// brands) get one merged mesh of their own there (1 draw call). exterior.js does not pass it, so the site shows no signs.
import { PODIUM, RAMPS, SITE_EXTRAS, BUILDINGS, footprintOf, localToWorld, floorsOf, floorY } from '../data.js';

// ------------------------------------------------------------------ signage (generic captions, no tenant brands)
const WORDMARK = 'VILNYI';
const CAPTION = { supermarket: 'СУПЕРМАРКЕТ', playland: 'ДИТЯЧИЙ ЦЕНТР', fitness: 'ФІТНЕС · SPA', ramp: 'ПАРКІНГ' };

// ------------------------------------------------------------------ dimensions (metres)
const OFF = 0.15;            // the podium skin stands this far outside the data polygon (in front of any tower wall on the same line)
const BASE = 0.15;           // plinth strip under the glazing
const RAIL_TOP = 1.2;        // glass balustrade above the roof when the entry has no `parapet`
const MULLION = 1.6;         // CONTRACT §4.1: shopfront mullions at 1.6 m
const LONG = 3.2;            // an edge at least this long gets the bay system

// ------------------------------------------------------------------ small 2D helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = a => Math.hypot(a[0], a[1]);
function signedArea(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
function distPoly(p, poly) { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, distSeg(p, poly[i], poly[(i + 1) % poly.length])); return d; }
function bbox(poly) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; }
function centroid(poly) { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }
// Douglas–Peucker on a closed polygon (hand-read outlines wobble by ±0.3 m; rounded corners survive a 0.35 m tolerance)
function simplify(poly, tol) {
  if (poly.length < 5 || !(tol > 0)) return poly;
  let s = 0; for (let i = 1; i < poly.length; i++) if (poly[i][0] < poly[s][0]) s = i;
  const ch = [...poly.slice(s), ...poly.slice(0, s), poly[s]], keep = new Array(ch.length).fill(false);
  keep[0] = keep[ch.length - 1] = true;
  let far = 0, fd = -1; for (let i = 1; i < ch.length - 1; i++) { const d = len(sub(ch[i], ch[0])); if (d > fd) { fd = d; far = i; } }
  keep[far] = true;
  const rec = (a, b) => { let m = -1, md = tol; for (let i = a + 1; i < b; i++) { const d = distSeg(ch[i], ch[a], ch[b]); if (d > md) { md = d; m = i; } } if (m > 0) { keep[m] = true; rec(a, m); rec(m, b); } };
  rec(0, far); rec(far, ch.length - 1);
  const out = ch.filter((_, i) => keep[i]); out.pop();
  return out.length >= 3 ? out : poly;
}
function dedupe(poly) { const o = []; for (const p of poly) { const q = o[o.length - 1]; if (!q || len(sub(p, q)) > 0.02) o.push(p); } if (o.length > 1 && len(sub(o[0], o[o.length - 1])) <= 0.02) o.pop(); return o; }
// polygon offset (same construction as exterior.js offsetPoly), d > 0 = outward
function offsetPoly(poly, d) {
  const s = signedArea(poly) > 0 ? 1 : -1, n = poly.length, lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], L = len(sub(b, a)) || 1;
    const nx = s * (b[1] - a[1]) / L, nz = -s * (b[0] - a[0]) / L;
    lines.push({ p: [a[0] + nx * d, a[1] + nz * d], dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i], den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    if (Math.abs(den) < 0.05) { out.push(b.p); continue; }
    const t = ((b.p[0] - a.p[0]) * b.dir[1] - (b.p[1] - a.p[1]) * b.dir[0]) / den;
    out.push([a.p[0] + a.dir[0] * t, a.p[1] + a.dir[1] * t]);
  }
  return out;
}
// edges of a polygon with outward normals and the turn angle (degrees) at both ends
function edgesOf(poly) {
  const s = signedArea(poly) > 0 ? 1 : -1, n = poly.length, E = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], d = sub(b, a), L = len(d) || 1e-6;
    E.push({ i, a, b, L, dir: [d[0] / L, d[1] / L], n: [s * d[1] / L, -s * d[0] / L], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  }
  for (let i = 0; i < n; i++) {
    const p = E[(i + n - 1) % n], e = E[i];
    const t = Math.abs(Math.atan2(p.dir[0] * e.dir[1] - p.dir[1] * e.dir[0], p.dir[0] * e.dir[0] + p.dir[1] * e.dir[1])) * 180 / Math.PI;
    e.turnA = t; p.turnB = t;
  }
  for (const e of E) e.F = { o: e.a, U: e.dir, V: e.n };
  return E;
}
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// world footprint of the tower standing on / behind a podium: the first floor whose slab is at or above the podium roof
const _fpCache = new Map();
function worldFootprint(bId, floor) {
  const k = bId + '|' + floor; if (_fpCache.has(k)) return _fpCache.get(k);
  let fp = null;
  try { fp = footprintOf(bId, floor).map(([x, z]) => localToWorld(bId, x, z)); } catch (e) { fp = null; }
  _fpCache.set(k, fp); return fp;
}
function towerAbove(pod) {
  const bId = pod.building; if (!bId || !BUILDINGS[bId]) return null;
  const fl = floorsOf(bId); let f = fl[fl.length - 1];
  for (const g of fl) if (floorY(bId, g) >= pod.y1 - 0.6) { f = g; break; }
  return worldFootprint(bId, f);
}

// ================================================================== buildPodium
export function buildPodium(K, bufs, extras) {
  const { THREE, Buf, box, pane, P } = K;
  extras = extras || K.extras || null;
  const opts = K.podiumOpts || {};
  const firstB = Object.keys(BUILDINGS)[0];
  const ROOF_BAND = K.ROOF_BAND != null ? K.ROOF_BAND : 99;
  const bandOf = bId => (K.bandCode ? K.bandCode(BUILDINGS[bId] ? bId : firstB, ROOF_BAND) : ROOF_BAND);
  const B = k => bufs[k] || bufs.wall;                       // a kit without one of the buffers still gets the geometry

  // own buffers for the optional extras group
  const timberBuf = bufs.timber || B('accent');
  const signs = [];                                         // { text, F, uc, y, h, v }
  let seedN = 0;

  // a triangle through Buf.quad (degenerate 4th corner)
  const tri = (buf, a, b, c, n, t) => buf.quad([a, b, c, c], n, [[a[0], a[2]], [b[0], b[2]], [c[0], c[2]], [c[0], c[2]]], t);
  // horizontal polygon cap at y (normal up or down)
  function cap(buf, poly, y, t, up = true) {
    const pts = poly.map(p => new THREE.Vector2(p[0], p[1]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) tri(buf, [poly[i][0], y, poly[i][1]], [poly[j][0], y, poly[j][1]], [poly[k][0], y, poly[k][1]], [0, up ? 1 : -1, 0], t);
  }
  // rows of quads covering { p : ok(p) } — used for lawn and ceilings. Strips run along x.
  function rows(buf, bb, rowD, step, ok, y, t, faces = 'Y') {
    const F = { o: [0, 0], U: [1, 0], V: [0, 1] };
    for (let z = bb.z0; z < bb.z1 - 1e-6; z += rowD) {
      let run = null;
      for (let x = bb.x0; x <= bb.x1 + step; x += step) {
        const good = x <= bb.x1 && ok([x + step / 2, z + rowD / 2]);
        if (good && run == null) run = x;
        if (!good && run != null) { if (x - run >= step * 1.5) box(buf, F, run, x, y - 0.02, y, z, z + rowD, t, faces); run = null; }
      }
    }
  }

  // ---------------------------------------------------------------- one podium entry
  function podium(pod) {
    const t = { b: bandOf(pod.building), u: -2, s: 0 };
    const finned = !(pod.kind === 'fitness' || pod.kind === 'pool' || pod.pool);   // timber fins on the retail block only
    const tower = towerAbove(pod);
    // wing of a tower: take the tower's own ground outline when it agrees with the site outline (within 1 m)
    let poly = pod.outside ? simplify(dedupe(pod.outside), 0.35) : dedupe(pod.poly);
    if (pod.outside && BUILDINGS[pod.building]) {
      const fp = worldFootprint(pod.building, floorsOf(pod.building)[0]);
      if (fp && fp.length >= 3 && pod.outside.every(p => inPoly(p, fp) || distPoly(p, fp) < 1)) poly = simplify(dedupe(fp), 0.2);
    }
    const y0 = pod.y0 || 0, y1 = Math.max(pod.y1, pod.roofing || 0);            // finished roof level
    const H = y1 - y0;
    const bandH = H > 8 ? 2.5 : H > 5 ? 1.15 : 0.8;          // dark upper band (carries the signs)
    const gTop = y1 - bandH;                                 // top of the glazing
    const part = (pod.parts || [])[0];
    const gH = K.LEVELS && K.LEVELS.groundH ? y0 + K.LEVELS.groundH : null;        // the towers' first slab line
    const transom = part && part.y1 > y0 + 2.5 && part.y1 < gTop - 1.5 ? part.y1 : (gH && gH < gTop - 1.2 ? gH : gTop - y0 > 5.5 ? y0 + (gTop - y0) * 0.6 : null);
    const pool = pod.pool && pod.pool.length >= 3 ? pod.pool : null;
    const railTop = pod.roofTerrace ? (pod.parapet || y1 + RAIL_TOP) : y1 + 0.45;
    const glassBuf = B('glass');
    // --- edges; an edge that runs partly along the tower is cut where the tower starts (0.25 m steps), then classified
    const nearTower = p => tower && (inPoly(p, tower) || distPoly(p, tower) < 0.55);
    const E = [];
    for (const e of edgesOf(poly)) {
      const hidAt = u => nearTower([e.a[0] + e.dir[0] * u + e.n[0] * 0.25, e.a[1] + e.dir[1] * u + e.n[1] * 0.25]);
      const cuts = [0];
      if (tower && e.L > 2) { let h = hidAt(0.1); for (let u = 0.35; u < e.L - 0.1; u += 0.25) { const g = hidAt(u); if (g !== h) { cuts.push(u - 0.12); h = g; } } }
      cuts.push(e.L);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const u0 = cuts[k], u1 = cuts[k + 1]; if (u1 - u0 < 0.3 && cuts.length > 2) { if (E.length && k) { const q = E[E.length - 1]; q.b = [e.a[0] + e.dir[0] * u1, e.a[1] + e.dir[1] * u1]; q.L += u1 - u0; q.turnB = k + 2 === cuts.length ? e.turnB : 0; } continue; }
        const a = [e.a[0] + e.dir[0] * u0, e.a[1] + e.dir[1] * u0], b = [e.a[0] + e.dir[0] * u1, e.a[1] + e.dir[1] * u1];
        E.push({ a, b, L: u1 - u0, dir: e.dir, n: e.n, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], turnA: k ? 0 : e.turnA, turnB: k + 2 === cuts.length ? e.turnB : 0, F: { o: a, U: e.dir, V: e.n },
          hid: [0.2, 0.5, 0.8].filter(f => hidAt(u0 + (u1 - u0) * f)).length >= 2 });
      }
    }
    for (const e of E) {
      const smooth = a => a > 5 && a < 42;
      if (e.hid) e.kind = 'skip';
      else if (e.L >= LONG && !(e.L < 3.3 && (smooth(e.turnA) && smooth(e.turnB)))) e.kind = 'bay';
      else if (e.L >= 0.2 && (smooth(e.turnA) || smooth(e.turnB))) e.kind = 'curve';
      else e.kind = 'solid';
    }
    // curve runs (rounded corners): consecutive curve edges; the biggest one is "the corner"
    const runs = [];
    for (let i = 0; i < E.length; i++) {
      if (E[i].kind !== 'curve' || E[(i + E.length - 1) % E.length].kind === 'curve') continue;
      const r = []; let j = i; while (E[j].kind === 'curve' && r.length < E.length) { r.push(E[j]); j = (j + 1) % E.length; }
      const turn = r.reduce((s, e) => s + e.turnB, 0) - r[r.length - 1].turnB + r[0].turnA;
      runs.push({ edges: r, L: r.reduce((s, e) => s + e.L, 0), turn });
    }
    const corner = runs.filter(r => r.edges.length >= 3 && r.turn > 50).sort((a, b) => b.L - a.L)[0] || null;
    const cornerMid = corner ? corner.edges[corner.edges.length >> 1].mid : null;
    const bays = E.filter(e => e.kind === 'bay').sort((a, b) => b.L - a.L);

    // --- shared pieces
    const upper = (e, ext) => {                              // dark band + LED line + roof kerb + balustrade
      const F = e.F;
      box(B('wall'), F, -ext, e.L + ext, gTop, y1 + 0.15, 0, OFF + 0.05, t, 'uUVyY');
      box(B('led'), F, 0, e.L, gTop - 0.02, gTop + 0.05, OFF + 0.05, OFF + 0.1, t, 'Vy');
      if (finned && e.L > 2) {                               // two thin timber lines along the band, as on the renders
        box(timberBuf, F, 0.1, e.L - 0.1, gTop + 0.32, gTop + 0.42, OFF + 0.05, OFF + 0.11, t, 'uUVyY');
        box(timberBuf, F, 0.1, e.L - 0.1, gTop + 0.6, gTop + 0.67, OFF + 0.05, OFF + 0.11, t, 'uUVyY');
      }
      if (pod.roofTerrace) {
        pane(B('rail'), F, 0, e.L, y1 + 0.15, railTop, OFF - 0.08, t);
        box(B('frame'), F, -ext, e.L + ext, railTop, railTop + 0.05, OFF - 0.12, OFF - 0.04, t, 'uUvVY');
      }
    };
    // night light: warm shop light at street level; the storey above it and the pool hall get the dimmer, cooler seed
    const seedAt = (e, u, upperRow) => {
      const p = [e.a[0] + e.dir[0] * u, e.a[1] + e.dir[1] * u];
      const cool = upperRow || (pool && (inPoly(p, pool) || distPoly(p, pool) < 3.5));
      return (cool ? 30001 : 10001) + (seedN++ % 900);
    };
    const glaze = (e, u0, u1) => {                           // panes between u0 and u1 with 1.6 m mullions and the transom
      const F = e.F, w = u1 - u0; if (w < 0.25) return;
      const n = Math.max(1, Math.round(w / MULLION)), s = w / n;
      for (let k = 0; k < n; k++) {
        const a = u0 + k * s, b = a + s;
        if (transom != null) {
          pane(glassBuf, F, a, b, y0 + BASE, transom - 0.14, OFF, { ...t, s: seedAt(e, (a + b) / 2, false) });
          pane(glassBuf, F, a, b, transom + 0.14, gTop, OFF, { ...t, s: seedAt(e, (a + b) / 2, true) });
        } else pane(glassBuf, F, a, b, y0 + BASE, gTop, OFF, { ...t, s: seedAt(e, (a + b) / 2, false) });
        if (k) box(B('frame'), F, a - 0.035, a + 0.035, y0 + BASE, gTop, OFF - 0.03, OFF + 0.07, t, 'uUV');
      }
      if (transom != null) box(B('frame'), F, u0, u1, transom - 0.14, transom + 0.14, OFF - 0.03, OFF + 0.09, t, 'VyY');
      box(B('frame'), F, u0, u1, y0, y0 + BASE, OFF - 0.03, OFF + 0.06, t, 'VY');
    };

    // --- canopy / sign placement on the bay edges
    const captions = [];
    if (CAPTION[pod.kind]) captions.push(CAPTION[pod.kind]);
    for (const p of (pod.parts || [])) if (CAPTION[p.kind] && !captions.includes(CAPTION[p.kind])) captions.push(CAPTION[p.kind]);

    E.forEach(e => {
      const F = e.F;
      if (e.kind === 'skip') {
        return;                                              // under / inside the tower: the tower's own facade
      }
      if (e.kind === 'solid') {
        box(B('wall'), F, -OFF, e.L + OFF, y0, gTop, 0, OFF + 0.05, t, 'uUV');
        upper(e, OFF + 0.05);
        return;
      }
      if (e.kind === 'curve') {
        // curved glass corner: one pane per chord, slim rings, a mullion at the joint
        const yy = transom != null ? [y0 + BASE, transom - 0.1, transom + 0.1, gTop] : [y0 + BASE, gTop];
        for (let k = 0; k + 1 < yy.length; k += 2) pane(glassBuf, F, 0, e.L, yy[k], yy[k + 1], OFF, { ...t, s: seedAt(e, e.L / 2, k > 0) });
        if (transom != null) box(B('frame'), F, 0, e.L, transom - 0.1, transom + 0.1, OFF - 0.03, OFF + 0.05, t, 'VyY');
        box(B('frame'), F, 0, e.L, y0, y0 + BASE, OFF - 0.03, OFF + 0.06, t, 'VY');
        box(B('frame'), F, -0.04, 0.04, y0 + BASE, gTop, OFF - 0.06, OFF + 0.06, t, 'uUV');
        upper(e, 0.03);
        return;
      }
      // ---- bay system
      const rank = bays.indexOf(e);
      const nb = Math.max(1, Math.round(e.L / (finned ? 4.8 : 3.2))), bw = e.L / nb;
      const pierW = finned ? 0.25 : 0.1, finW = 0.3, finGap = 0.06;
      const edgeW = finned ? 0.7 : 0.25;                     // wide dark pier at both ends of the edge
      const lim = k => k === 0 ? [-(OFF + 0.05), edgeW] : k === nb ? [e.L - edgeW, e.L + OFF + 0.05] : [k * bw - pierW, k * bw + pierW];
      for (let k = 0; k <= nb; k++) {
        const [a, b] = lim(k);
        box(B(finned ? 'wall' : 'frame'), F, a, b, y0, gTop, 0, OFF + 0.14, t, 'uUV');
        if (finned) {
          if (k > 0) box(timberBuf, F, a - finGap - finW, a - finGap, y0, gTop, OFF - 0.02, OFF + 0.4, t, 'uUV');
          if (k < nb) box(timberBuf, F, b + finGap, b + finGap + finW, y0, gTop, OFF - 0.02, OFF + 0.4, t, 'uUV');
        }
      }
      const inner = finned ? finGap + finW + 0.04 : 0;
      for (let k = 0; k < nb; k++) glaze(e, lim(k)[1] + inner, lim(k + 1)[0] - inner);
      upper(e, OFF + 0.05);

      // canopy + caption on the two longest bay edges; the bay is the second from the end nearest the rounded corner
      if (rank < 2 && nb >= 2 && rank < Math.max(1, captions.length)) {
        const nearA = cornerMid ? len(sub(cornerMid, e.a)) < len(sub(cornerMid, e.b)) : true;
        const k = nb >= 3 ? (nearA ? 1 : nb - 2) : (nearA ? 0 : nb - 1);
        const u0 = lim(k)[1] + 0.05, u1 = lim(k + 1)[0] - 0.05, cy = Math.min(y0 + 3.5, gTop - 1);
        if (rank === 0 || finned) {
          box(B('slab'), F, u0, u1, cy, cy + 0.28, OFF, OFF + 2.8, t, 'uUVY');
          box(B('soffit'), F, u0, u1, cy - 0.02, cy, OFF, OFF + 2.8, t, 'y');
          box(timberBuf, F, u0, u1, cy + 0.02, cy + 0.12, OFF + 2.8, OFF + 2.84, t, 'V');
          // entrance doors: a darker framed pair under the canopy
          const dc = (u0 + u1) / 2;
          box(B('frame'), F, dc - 1.25, dc + 1.25, cy - 0.95, cy - 0.8, OFF - 0.02, OFF + 0.1, t, 'VyY');
          for (const du of [-1.25, 0, 1.25]) box(B('frame'), F, dc + du - 0.05, dc + du + 0.05, y0, cy - 0.8, OFF - 0.02, OFF + 0.1, t, 'uUV');
        }
        const text = captions[Math.min(rank, captions.length - 1)];
        signs.push({ text, F, uc: (u0 + u1) / 2, y: gTop + bandH * (bandH > 2 ? 0.58 : 0.5), h: Math.min(1.5, bandH * 0.78), v: OFF + 0.12, maxW: Math.min(e.L - 1.5, bw * 2.4) });
      }
    });

    // wordmark on the rounded street corner: letters standing off the curved glass band
    if (corner && finned && bandH > 1.5) {
      const m = corner.edges[corner.edges.length >> 1];
      const a = corner.edges[0].a, b = corner.edges[corner.edges.length - 1].b, ch = sub(b, a), cl = len(ch) || 1;
      const U = [ch[0] / cl, ch[1] / cl], s = signedArea(poly) > 0 ? 1 : -1, V = [s * U[1], -s * U[0]];
      const d = (m.mid[0] - a[0]) * V[0] + (m.mid[1] - a[1]) * V[1];       // sagitta: the plane touches the apex of the curve
      signs.push({ text: WORDMARK, F: { o: a, U, V }, uc: cl / 2, y: gTop + bandH * 0.55, h: Math.min(2.0, bandH * 0.82), v: d + OFF + 0.3, maxW: cl * 0.8 });
    }

    // --- gate portals across recesses of the facade (the passage into the courtyard on the renders)
    {
      const n = poly.length, s = signedArea(poly) > 0 ? 1 : -1, taken = new Set();
      const PE = edgesOf(poly), longEdge = (i, step) => { for (let k = 0; k < 3; k++) { const e = PE[((i + step * k) % n + n) % n]; if (e.L > 1) return e; } return null; };
      for (let i = 0; i < n; i++) {
        if (taken.has(i)) continue;
        for (let span = 3; span <= Math.min(10, n - 3); span++) {
          const j = (i + span) % n, a = poly[i], b = poly[j], ch = sub(b, a), d = len(ch);
          if (d < 3 || d > 9) continue;
          const U = [ch[0] / d, ch[1] / d], N = [s * U[1], -s * U[0]];
          let deep = 0, ok = true;
          for (let k = 1; k < span; k++) { const q = poly[(i + k) % n], dep = -((q[0] - a[0]) * N[0] + (q[1] - a[1]) * N[1]); if (dep < -0.1) { ok = false; break; } deep = Math.max(deep, dep); }
          const ep = longEdge(i - 1, -1), en = longEdge(j, 1);
          if (!ok || deep < 3 || !ep || !en || ep.dir[0] * U[0] + ep.dir[1] * U[1] < 0.9 || en.dir[0] * U[0] + en.dir[1] * U[1] < 0.9) continue;
          if (nearTower([(a[0] + b[0]) / 2 + N[0] * 0.5, (a[1] + b[1]) / 2 + N[1] * 0.5])) continue;
          for (let k = 0; k <= span; k++) taken.add((i + k) % n);
          const F = { o: a, U, V: N }, hG = Math.min(5.4, gTop - 0.5), pw = Math.min(0.9, d * 0.14), v0 = OFF - 0.55, v1 = OFF + 0.2;
          box(B('wall'), F, 0, pw, y0, hG, v0, v1, t, 'uUvV');
          box(B('wall'), F, d - pw, d, y0, hG, v0, v1, t, 'uUvV');
          box(B('wall'), F, 0, d, hG - 1.0, hG, v0, v1, t, 'vVyY');
          box(B('led'), F, pw, d - pw, hG - 1.04, hG - 1.0, v1 - 0.12, v1 - 0.04, t, 'Vy');
          for (const y of [hG - 0.36, hG - 0.2]) box(timberBuf, F, pw * 0.5, d, y, y + 0.07, v1, v1 + 0.05, t, 'uUVyY');
          for (let k = 0; k < 4; k++) { const u = d - pw + 0.1 + k * (pw - 0.2) / 4; box(timberBuf, F, u, u + 0.08, y0, hG - 0.5 - k * 0.45, v1, v1 + 0.05, t, 'uUVY'); }
          break;
        }
      }
    }

    // --- roof: paved terrace by the tower, lawn beyond, hedge line between, glass balustrade (above)
    const roofY = y1 - 0.04;                                 // just under the tower's own terrace slabs (+y1)
    cap(B('roof'), poly, roofY, t, true);
    if (pod.roofTerrace) {
      const bb = bbox(poly), margin = tower ? (H > 8 ? 4.2 : 2.6) : 0;
      const towerD = p => (tower ? (inPoly(p, tower) ? -1 : distPoly(p, tower)) : 99);
      const lawn = p => inPoly(p, poly) && distPoly(p, poly) > 0.7 && towerD(p) > margin;
      rows(B('hedge'), bb, 0.2, 0.2, lawn, roofY + 0.06, t, 'Y');   // T32: 0.8 × 0.4 m cells gave the lawn a staircase edge from above
      // clipped hedge between the terrace and the lawn, in pieces with gaps
      const rnd = mulberry(977 + Math.round(y1 * 10));
      if (tower) {
        const ring = edgesOf(offsetPoly(tower, margin - 0.5));
        for (const g of ring) {
          for (let u = 0.3; u + 1.5 < g.L; u += 2.1 + rnd() * 0.5) {
            const c = [g.a[0] + g.dir[0] * (u + 0.75), g.a[1] + g.dir[1] * (u + 0.75)];
            if (!inPoly(c, poly) || distPoly(c, poly) < 1.4 || towerD(c) < margin - 0.9) continue;
            if (rnd() < 0.22) continue;
            box(B('hedge'), g.F, u, u + 1.5, roofY, roofY + 0.55 + rnd() * 0.25, -0.35, 0.35, t, 'uUvVY');
          }
        }
      }
      // shrubs on the lawn + one plant enclosure at the point farthest from the tower
      let best = null;
      for (let i = 0; i < 260; i++) {
        const p = [bb.x0 + rnd() * (bb.x1 - bb.x0), bb.z0 + rnd() * (bb.z1 - bb.z0)];
        if (!lawn(p) || distPoly(p, poly) < 1.6) continue;
        const sc = Math.min(distPoly(p, poly), 6) + Math.min(towerD(p), 12) * 0.5;
        if (distPoly(p, poly) > 3.2 && (!best || sc > best.sc)) best = { p, sc };
        if (i % 6 === 0) { const r = 0.45 + rnd() * 0.45, F = { o: p, U: [1, 0], V: [0, 1] }; box(B('hedge'), F, -r, r, roofY, roofY + r * 1.5, -r, r, t, 'uUvVY'); }
      }
      if (best && H > 8) {
        const F = { o: best.p, U: [1, 0], V: [0, 1] };
        box(B('hvac'), F, -2.2, 2.2, roofY, roofY + 2.1, -1.4, 1.4, t, 'uUvVY');
        for (let y = 0.35; y < 2; y += 0.3) box(B('frame'), F, -2.26, 2.26, roofY + y, roofY + y + 0.06, -1.46, 1.46, t, 'uUvV');
      }
      // small pergola on a single-level terrace roof (fitness wing)
      if (H <= 8) {
        const c = centroid(pod.outside || poly), F = { o: c, U: [1, 0], V: [0, 1] }, w = 2.6, d = 2.0, h = 2.5;
        const fits = [[-w, -d], [w, -d], [w, d], [-w, d]].every(([x, z]) => { const p = [c[0] + x, c[1] + z]; return inPoly(p, poly) && distPoly(p, poly) > 0.5; });
        if (fits) {
          for (const [x, z] of [[-w, -d], [w, -d], [w, d], [-w, d]]) box(B('frame'), F, x - 0.07, x + 0.07, roofY, roofY + h, z - 0.07, z + 0.07, t, 'uUvV');
          box(B('frame'), F, -w - 0.1, w + 0.1, roofY + h, roofY + h + 0.14, -d - 0.1, -d + 0.1, t);
          box(B('frame'), F, -w - 0.1, w + 0.1, roofY + h, roofY + h + 0.14, d - 0.1, d + 0.1, t);
          for (let x = -w; x <= w + 0.01; x += 0.52) box(timberBuf, F, x - 0.04, x + 0.04, roofY + h + 0.14, roofY + h + 0.26, -d - 0.25, d + 0.25, t);
        }
      }
    }
  }

  // ---------------------------------------------------------------- parking ramp: portal, side walls, visible deck
  function ramp(r) {
    const t = { b: bandOf(r.building), u: -2, s: 0 };
    const from = r.from || (r.axis === 'z' ? [(r.x0 + r.x1) / 2, r.top === 'min' ? r.z0 : r.z1] : [r.top === 'min' ? r.x0 : r.x1, (r.z0 + r.z1) / 2]);
    const to = r.to || (r.axis === 'z' ? [(r.x0 + r.x1) / 2, r.top === 'min' ? r.z1 : r.z0] : [r.top === 'min' ? r.x1 : r.x0, (r.z0 + r.z1) / 2]);
    const d = sub(to, from), L = len(d) || 1, V = [d[0] / L, d[1] / L], U = [V[1], -V[0]];
    const w = (r.axis === 'z' ? r.x1 - r.x0 : r.z1 - r.z0) / 2;
    const F = { o: from, U, V };
    const yTop = r.y0 || 0, yBot = r.y1 != null ? r.y1 : K.LEVELS ? K.LEVELS.parkingY : -4.2;
    const deckY = v => yTop + (yBot - yTop) * v / L - 0.08;  // 8 cm under the walkable ramp of commons-parking
    const fp = r.building ? worldFootprint(r.building, 1) : null;
    const inB = v => fp && inPoly([from[0] + V[0] * v, from[1] + V[1] * v], fp);
    let vIn = null, vOut = null;
    for (let v = 0; v <= L; v += 0.2) if (inB(v)) { if (vIn == null) vIn = v; vOut = v; }
    if (vIn == null) { vIn = 0; vOut = Math.min(L, 6); }     // free-standing ramp: a 6 m portal house
    if (vIn < 0.9) vIn = 0;
    const CEIL = Math.max(yTop, 0) + 2.9;

    // deck (sloped) and the inner faces of the side walls, in three stretches: open air · inside the building · under the yard
    B('stone').quad([P(F, -w, deckY(0), 0), P(F, w, deckY(0), 0), P(F, w, deckY(L), L), P(F, -w, deckY(L), L)], [0, 1, 0], [[0, 0], [2 * w, 0], [2 * w, L], [0, L]], t);
    const wall = (v0, v1, top) => {
      if (v1 - v0 < 0.05) return;
      for (const s of [-1, 1]) B('roof').quad([P(F, s * w, deckY(v0), v0), P(F, s * w, deckY(v1), v1), P(F, s * w, top, v1), P(F, s * w, top, v0)], [-s * U[0], 0, -s * U[1]], [[0, 0], [v1 - v0, 0], [v1 - v0, 3], [0, 3]], t);
    };
    wall(0, vIn, Math.max(yTop, 0));
    wall(vIn, vOut, CEIL);
    wall(vOut, L, Math.min(-0.02, CEIL));
    if (vOut - vIn > 0.5) box(B('soffit'), F, -w, w, CEIL - 0.02, CEIL, vIn, vOut, t, 'y');
    // dark end of the tunnel (so an open portal never shows the sky through the building)
    if (opts.rampEnd !== false) B('frame').quad([P(F, -w, yBot - 0.1, L - 0.05), P(F, w, yBot - 0.1, L - 0.05), P(F, w, Math.min(CEIL, yBot + 3.2), L - 0.05), P(F, -w, Math.min(CEIL, yBot + 3.2), L - 0.05)], [-V[0], 0, -V[1]], [[0, 0], [1, 0], [1, 1], [0, 1]], t);

    // open-air approach: low side walls with a coping
    if (vIn > 0.9) {
      const g = Math.max(yTop, 0);
      for (const s of [-1, 1]) {
        const a = s < 0 ? -w - 0.25 : w, b = s < 0 ? -w : w + 0.25;
        box(B('roof'), F, a, b, g - 0.3, g + 1.0, -0.25, vIn - 0.45, t, 'uUvVY');
        box(B('slab'), F, a - 0.04, b + 0.04, g + 1.0, g + 1.08, -0.29, vIn - 0.45, t, 'uUvVY');
      }
    }
    // canopy over the mouth with a light line and downlights (the opening itself is cut by the tower facade, lintel at +3.0)
    const v0 = vIn - 0.45, v1 = vIn - 0.02, hd = Math.min(CEIL, Math.max(yTop, 0) + 2.55, 3.0);
    box(B('slab'), F, -w - 0.55, w + 0.55, hd + 0.1, hd + 0.28, v0 - 1.5, v1, t, 'uUvY');
    box(B('soffit'), F, -w - 0.55, w + 0.55, hd + 0.08, hd + 0.1, v0 - 1.5, v1, t, 'y');
    box(B('led'), F, -w, w, hd + 0.02, hd + 0.08, v0 - 0.04, v0, t, 'vy');
    box(timberBuf, F, -w - 0.55, w + 0.55, hd + 0.15, hd + 0.23, v0 - 1.54, v0 - 1.5, t, 'v');
    // centre kerb between the lanes at the mouth
    if ((r.lanes || 1) >= 2) box(B('hvac'), F, -0.12, 0.12, deckY(vIn) + 0.08, deckY(vIn) + 0.3, Math.max(0, vIn - 0.4), vIn + 0.1, t, 'uUvY');
    signs.push({ text: CAPTION.ramp, F: { o: from, U: [-U[0], -U[1]], V: [-V[0], -V[1]] }, uc: 0, y: hd + 0.62, h: 0.42, v: -v0 + 0.03, maxW: 2 * w - 1 });
  }

  // ---------------------------------------------------------------- site extras (transformer substation, gazebo, …)
  function extra(x) {
    if (!x.poly || !(x.h > 0)) return;                       // h = 0 (paved areas) belongs to the ground painter
    const t = { b: bandOf(null), u: -2, s: 0 };
    const poly = dedupe(x.poly), E = edgesOf(poly), h = x.h;
    if (x.kind === 'gazebo') {
      const c = centroid(poly);
      for (const p of poly) { const F = { o: [p[0] + (c[0] - p[0]) * 0.08, p[1] + (c[1] - p[1]) * 0.08], U: [1, 0], V: [0, 1] }; box(B('frame'), F, -0.07, 0.07, 0, h - 0.3, -0.07, 0.07, t, 'uUvV'); }
      const out = offsetPoly(poly, 0.35);
      cap(B('slab'), out, h - 0.12, t, true); cap(B('soffit'), out, h - 0.3, t, false);
      for (const e of edgesOf(out)) box(timberBuf, e.F, 0, e.L, h - 0.3, h - 0.12, -0.04, 0, t, 'V');
      const e0 = E.slice().sort((a, b) => b.L - a.L)[0];     // a bench along the longest side
      box(timberBuf, e0.F, 0.4, e0.L - 0.4, 0.4, 0.47, -0.75, -0.3, t, 'uUvVYy');
      box(B('frame'), e0.F, 0.5, 0.58, 0, 0.4, -0.7, -0.35, t, 'uUvV'); box(B('frame'), e0.F, e0.L - 0.58, e0.L - 0.5, 0, 0.4, -0.7, -0.35, t, 'uUvV');
      return;
    }
    // closed service block: plinth, wall, dark top band, flat roof, louvred doors on the longest side
    for (const e of E) {
      if (e.L < 0.05) continue;
      box(B('stone'), e.F, -0.02, e.L + 0.02, 0, 0.4, 0, 0.04, t, 'V');
      box(B('hvac'), e.F, 0, e.L, 0.4, h - 0.45, -0.02, 0, t, 'V');
      box(B('wall'), e.F, -0.06, e.L + 0.06, h - 0.45, h, 0, 0.06, t, 'uUVy');
    }
    cap(B('roof'), offsetPoly(poly, 0.06), h, t, true);
    const e0 = E.slice().sort((a, b) => b.L - a.L)[0];
    const nd = Math.max(1, Math.min(4, Math.floor(e0.L / 2.6)));
    for (let k = 0; k < nd; k++) {
      const u = e0.L * (k + 0.5) / nd;
      box(B('frame'), e0.F, u - 0.85, u + 0.85, 0.1, 2.5, 0, 0.05, t, 'uUVY');
      for (let y = 0.5; y < 2.3; y += 0.22) box(B('slab'), e0.F, u - 0.7, u + 0.7, y, y + 0.1, 0.05, 0.08, t, 'VY');
    }
  }

  // ---------------------------------------------------------------- run (each part isolated: one bad entry never kills the rest)
  const safe = (fn, x, what) => { try { fn(x); } catch (e) { console.warn('[exterior-podium] ' + what + ' ' + (x && x.id) + ' skipped:', e); } };
  for (const pod of PODIUM || []) if (pod && pod.poly && pod.y1 > (pod.y0 || 0)) safe(podium, pod, 'podium');
  if (opts.ramps !== false) for (const r of RAMPS || []) safe(ramp, r, 'ramp');
  if (opts.extras !== false) for (const x of SITE_EXTRAS || []) safe(extra, x, 'extra');

  if (extras) { try { finishExtras(K, extras, signs); } catch (e) { console.warn('[exterior-podium] extras skipped:', e); } }
}

// ------------------------------------------------------------------ extras group: sign texts (1 mesh)
function finishExtras(K, group, signs) {
  const { THREE, Buf } = K;
  const mats = {};
  const add = (name, geo, mat, shadow) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.name = 'podium-' + name; m.castShadow = shadow; m.receiveShadow = shadow; group.add(m); return m; };

  // sign atlas: one canvas row per distinct text
  if (signs.length && typeof document !== 'undefined') {
    const texts = [...new Set(signs.map(s => s.text))], RH = 128, CW = 1024;
    const cv = document.createElement('canvas'); cv.width = CW; cv.height = Math.max(128, 2 ** Math.ceil(Math.log2(texts.length * RH)));
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const font = px => `700 ${px}px Montserrat, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    const row = {};
    texts.forEach((tx, i) => {
      const spaced = tx.split('').join(' ');           // a little letter-spacing
      let px = 92; g.font = font(px); let w = g.measureText(spaced).width;
      if (w > CW - 24) { px = Math.floor(px * (CW - 24) / w); g.font = font(px); w = g.measureText(spaced).width; }
      g.fillText(spaced, 12, i * RH + RH / 2 + 4);
      row[tx] = { u0: 6 / CW, u1: (w + 18) / CW, v0: 1 - ((i + 1) * RH - 6) / cv.height, v1: 1 - (i * RH + 6) / cv.height, aspect: (w + 12) / (RH - 12), fill: px / 92 };
    });
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
    mats.sign = new THREE.MeshStandardMaterial({ color: '#e9b061', roughness: 0.45, metalness: 0.3, alphaMap: tex, alphaTest: 0.45, emissive: '#ffb04e', emissiveIntensity: 0.12, side: THREE.DoubleSide });
    const buf = new Buf(), P = K.P, t = { b: 0, u: -2, s: 0 };
    for (const s of signs) {
      const r = row[s.text]; let h = s.h, w = h * r.aspect;
      if (s.maxW && w > s.maxW) { w = s.maxW; h = w / r.aspect; }
      const F = s.F, a = s.uc - w / 2, b = s.uc + w / 2;
      // seen from outside (looking along −V) the reader's right is [V.z, −V.x]; flip the text when U runs the other way
      const flip = F.U[0] * F.V[1] - F.U[1] * F.V[0] < 0, ua = flip ? r.u1 : r.u0, ub = flip ? r.u0 : r.u1;
      buf.quad([P(F, a, s.y - h / 2, s.v), P(F, b, s.y - h / 2, s.v), P(F, b, s.y + h / 2, s.v), P(F, a, s.y + h / 2, s.v)], [F.V[0], 0, F.V[1]], [[ua, r.v0], [ub, r.v0], [ub, r.v1], [ua, r.v1]], t);
    }
    add('sign', buf.geometry(), mats.sign, false);
  }

  // night: follow environment's SHARED.uGlow (or K.SHARED, or group.userData.glow when set by hand)
  let shared = K.SHARED || null;
  if (!shared) import('./environment.js').then(m => { shared = m.SHARED || null; }).catch(() => {});
  let last = -1;
  const sync = () => {
    const ud = group.userData.glow;
    const gl = typeof ud === 'number' ? ud : shared && shared.uGlow ? +shared.uGlow.value || 0 : 0;
    if (gl === last) return; last = gl;
    if (mats.sign) mats.sign.emissiveIntensity = 0.12 + 2.6 * gl;
  };
  const first = group.children.find(c => c.name && c.name.startsWith('podium-'));
  if (first) first.onBeforeRender = sync;
  group.userData.podiumMaterials = mats;
  group.userData.disposePodium = () => { for (const m of Object.values(mats)) { if (m.alphaMap) m.alphaMap.dispose(); m.dispose(); } for (const c of group.children) if (c.name && c.name.startsWith('podium-')) c.geometry.dispose(); };
}
