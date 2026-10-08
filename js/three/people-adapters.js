// people-adapters.js — the ONLY place of the people / police code that knows how the city agent (city-data.js) and the
// driving agent (cars.js / drive.js) expose their things. people.js and police.js talk to the two small interfaces
// defined here (PeopleCity, PeopleDrive). Also: a stub city and a fake drive for the tests. No three.js import
// (the stub's drawing helper gets THREE passed in).
//
// PeopleCity: { isPeopleCity, nodes [{x,z}], edges [{a,b,len,w,kind,busy,cross}], adj [[edge…]], crossings, pois, benches, busStops,
//   areas, roads {nodes [{x,z,edges}], edges [{a,b,len,pts,w}]}, hours(), mode(), time(), canWalk(edge,t), isOpen(poi), density(edge,h),
//   onRoad(x,z), blocked(x,z), edgesNear(x,z,r), nearestEdge(x,z,r), nearestNode(x,z), nearestRoadNode(x,z), poisNear(x,z,r) }
// PeopleDrive: { player(), traffic(cb), take(car), disable(car,on), impulse(car,ix,iz), openDoor(car,on), seat(car), object(car), on(evt,cb), off() }

const hyp = Math.hypot, clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
export function distSeg(x, z, ax, az, bx, bz) { const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz || 1, t = clamp(((x - ax) * ux + (z - az) * uz) / l2); return [hyp(x - ax - ux * t, z - az - uz * t), t]; }

// ---- shared finishing: adjacency + a grid over the pavement edges -----------------------------------------------------------------
function finish(C, cell = 40) {
  C.isPeopleCity = true;
  C.adj = C.nodes.map(() => []);
  C.edges.forEach((e, i) => { e.id = i; const A = C.nodes[e.a], B = C.nodes[e.b]; e.len = e.len || hyp(B.x - A.x, B.z - A.z) || 0.01; C.adj[e.a].push(i); C.adj[e.b].push(i); });
  const grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  C.edges.forEach((e, i) => { const A = C.nodes[e.a], B = C.nodes[e.b], n = Math.max(1, Math.ceil(e.len / (cell * 0.5))), seen = new Set(); for (let k = 0; k <= n; k++) { const t = k / n, kk = key(Math.floor((A.x + (B.x - A.x) * t) / cell), Math.floor((A.z + (B.z - A.z) * t) / cell)); if (seen.has(kk)) continue; seen.add(kk); let l = grid.get(kk); if (!l) grid.set(kk, l = []); l.push(i); } });
  const stamp = new Int32Array(C.edges.length); let run = 0;
  C.edgesNear = (x, z, r, out = []) => { out.length = 0; run++; const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = grid.get(key(i, j)); if (l) for (const e of l) if (stamp[e] !== run) { stamp[e] = run; out.push(e); } } return out; };
  const tmp = [];
  C.nearestEdge = (x, z, r = 30) => { let best = null, bd = r; for (const ei of C.edgesNear(x, z, r, tmp)) { const e = C.edges[ei], A = C.nodes[e.a], B = C.nodes[e.b], [d, t] = distSeg(x, z, A.x, A.z, B.x, B.z); if (d < bd) { bd = d; best = { edge: ei, t, d, x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t }; } } return best; };
  C.nearestNode = (x, z) => { const ne = C.nearestEdge(x, z, 80); if (!ne) return -1; const e = C.edges[ne.edge]; return ne.t < 0.5 ? e.a : e.b; };
  if (C.roads) {
    C.roads.nodes.forEach((n, i) => { n.id = i; n.edges = []; }); C.roads.edges.forEach((e, i) => { e.id = i; const A = C.roads.nodes[e.a], B = C.roads.nodes[e.b]; e.pts = e.pts || [[A.x, A.z], [B.x, B.z]]; e.len = e.len || hyp(B.x - A.x, B.z - A.z); A.edges.push(i); B.edges.push(i); });
    C.nearestRoadNode = C.nearestRoadNode || ((x, z) => { let b = -1, bd = 1e9; C.roads.nodes.forEach((n, i) => { const d = hyp(n.x - x, n.z - z); if (d < bd) { bd = d; b = i; } }); return b; });
  }
  C.poisNear = C.poisNear || ((x, z, r) => C.pois.filter(p => hyp(p.x - x, p.z - z) < r));
  return C;
}
/** How busy a pavement is at `hours` (0–24): 1 = an ordinary street at midday. `e.busy` is the place factor, `e.night` what stays open late nearby. */
export function timeFactor(hours, busy = 1, night = 0) {
  const h = ((hours % 24) + 24) % 24, bell = (c, w) => Math.exp(-((h - c) * (h - c)) / (2 * w * w));
  const day = Math.max(0.55 * bell(8.2, 1.3), bell(13, 2.6), 0.95 * bell(18, 1.9), 0.3 * bell(21, 1.2));
  const late = h >= 21 || h < 4.5 ? (h >= 23 ? 0.24 : h >= 21 ? 0.4 : h < 2 ? 0.2 : 0.1) : 0;
  const floor = busy >= 2 ? 0.1 : 0.025;                                    // almost nobody in residential streets at 01:00
  return Math.max(floor, day, late * night);
}

// ---- the real city (city-data.js) ----------------------------------------------------------------------------------------------------
const CLS_BUSY = { pedestrian: 3, primary: 1.5, secondary: 1.3, tertiary: 1.0, residential: 0.55, living: 0.5, service: 0.25, footway: 0.7, path: 0.6, track: 0.15 };
export function fromCityData(mod, { signalTime = null } = {}) {
  const CITY = mod.CITY, G = mod.sidewalkGraph, idx = new Map();
  const C = { src: mod, nodes: [], edges: [], crossings: CITY.crossings || [], pois: CITY.pois || [], benches: [], areas: CITY.areas || [], busStops: (CITY.busStops || []).map(b => ({ x: b.x, z: b.z, yaw: b.heading || 0, name: b.name })) };
  G.nodes.forEach((n, i) => { idx.set(n.id, i); C.nodes.push({ x: n.x, z: n.z, crossing: n.crossing ?? -1 }); });
  G.nodes.forEach((n, i) => { for (const l of n.links || []) { const j = idx.get(l); if (j == null || j <= i) continue; const m = G.nodes[j], cross = n.crossing >= 0 && n.crossing === m.crossing ? CITY.crossings[n.crossing] : null; C.edges.push({ a: i, b: j, w: cross ? (cross.w || 3) : 1.9, kind: cross ? 'cross' : 'pave', cross, busy: null, night: null }); } });
  const busyOf = e => {
    const A = C.nodes[e.a], B = C.nodes[e.b], x = (A.x + B.x) / 2, z = (A.z + B.z) / 2; let b = 0.6, kind = e.kind;
    try { const ar = mod.areaAt?.(x, z); if (ar && ar.kind === 'water') b = 0; else { const ra = mod.roadAt?.(x, z, 14); if (ra) { b = CLS_BUSY[ra.road.cls] ?? 0.6; if (ra.road.cls === 'footway' || ra.road.cls === 'path') kind = e.kind === 'cross' ? 'cross' : 'path'; if (ra.road.cls === 'pedestrian') { kind = 'plaza'; e.w = Math.max(e.w, Math.min(6, (ra.road.w || 4) * 0.8)); } } if (ar && ar.gather) { b = Math.max(b, 2.4); } else if (ar && ar.kind === 'park') { b = Math.max(b, 1.0); e.park = true; } }
      let night = 0, shops = 0; for (const p of mod.poisNear?.(x, z, 28) || []) { shops++; if (p.h24 || p.cat === 'bar' || p.cat === 'restaurant' || p.cat === 'fastfood' || p.cat === 'fuel') night = 1; } e.night = night; b *= 1 + Math.min(1, shops * 0.12);
    } catch (err) { e.night = 0; }
    e.busy = b; if (e.kind !== 'cross') e.kind = kind; return b;
  };
  C.hours = () => { const c = mod.cityClock(); return c.h + (c.m || 0) / 60; };
  C.mode = () => mod.cityClock().mode;
  let t0 = 0; C.time = signalTime || (() => t0); C.advance = dt => { t0 += dt; };
  C.canWalk = (e, t) => { const c = e.cross; if (!c || c.signal == null || c.signal < 0) return true; return mod.pedState ? mod.pedState(c.signal, t, c.road) === 'walk' || mod.pedState(c.signal, t, c.road) === true : mod.signalState(c.signal, t, c.road) === 'red'; };
  C.hasSignal = e => !!(e.cross && e.cross.signal != null && e.cross.signal >= 0);
  C.isOpen = p => { try { return !!mod.isOpen(p); } catch (e) { return true; } };
  C.density = (e, h) => { const b = e.busy == null ? busyOf(e) : e.busy; return b * timeFactor(h, b, e.night || 0); };
  C.onRoad = (x, z) => { const r = mod.roadAt(x, z, 12); return !!(r && r.on && r.road.car); };
  C.blocked = (x, z) => !!(mod.buildingAt ? mod.buildingAt(x, z) : false) || !!(mod.inWater && mod.inWater(x, z));
  C.poisNear = (x, z, r) => mod.poisNear(x, z, r);
  // road graph for the police: the drivable edges only
  const RN = CITY.graph.nodes, rid = new Map(); C.roads = { nodes: [], edges: [] };
  RN.forEach(n => { rid.set(n.id, C.roads.nodes.length); C.roads.nodes.push({ x: n.x, z: n.z }); });
  for (const r of CITY.roads) if (r.car) C.roads.edges.push({ a: rid.get(r.a), b: rid.get(r.b), len: r.len, pts: r.pts, w: r.w, oneway: r.oneway, speed: r.speed });
  C.nearestRoadNode = (x, z) => { if (mod.nearestNode) { const n = mod.nearestNode(x, z); const id = typeof n === 'object' && n ? n.id : n; if (rid.has(id)) return rid.get(id); } let b = -1, bd = 1e9; C.roads.nodes.forEach((n, i) => { const d = hyp(n.x - x, n.z - z); if (d < bd && n.edges && n.edges.length) { bd = d; b = i; } }); return b; };
  return finish(C);
}
/** Whatever the host passes as `city` → PeopleCity. Accepts: a PeopleCity, the city-data.js module namespace (after loadCity()), or nothing (→ null). */
export function cityAdapter(city, opts) {
  if (!city) return null;
  if (city.isPeopleCity) return city;
  if (city.sidewalkGraph && city.CITY) return fromCityData(city, opts);
  if (city.nodes && city.edges) return finish(city);
  throw new Error('people: unknown city object');
}

// ---- stub city for the tests: a street grid with pavements, signalled crossings, a square, a park, shops, a bus stop ---------------------
export function makeStubCity({ nx = 4, nz = 3, pitch = 72, road = 8, pave = 3.2, hours = 13, seed = 5 } = {}) {
  const C = { nodes: [], edges: [], crossings: [], pois: [], benches: [], busStops: [], areas: [], roads: { nodes: [], edges: [] }, stub: { nx, nz, pitch, road, pave, blocks: [], signals: [] } };
  let rs = seed; const rnd = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
  const off = road / 2 + pave / 2, X0 = -(nx * pitch) / 2, Z0 = -(nz * pitch) / 2;
  const N = (x, z) => C.nodes.push({ x, z }) - 1, E = (a, b, o = {}) => C.edges.push({ a, b, w: pave - 0.5, kind: 'pave', busy: 1, night: 0, ...o }) - 1;
  // junction (i, j) at (X0 + i * pitch, Z0 + j * pitch), i 0..nx, j 0..nz; block (i, j) between junctions
  const corner = {};                                                           // key "i,j,q" (q 0..3: SW, SE, NE, NW corner of block i,j)
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x0 = X0 + i * pitch + off, x1 = X0 + (i + 1) * pitch - off, z0 = Z0 + j * pitch + off, z1 = Z0 + (j + 1) * pitch - off;
    const plaza = i === 1 && j === 1, park = i === 2 && j === 0, busy = j === 1 ? 2.2 : j === 0 ? 1 : 0.5;
    const cs = [N(x0, z0), N(x1, z0), N(x1, z1), N(x0, z1)]; cs.forEach((n, q) => corner[i + ',' + j + ',' + q] = n);
    const mids = [N((x0 + x1) / 2, z0), N(x1, (z0 + z1) / 2), N((x0 + x1) / 2, z1), N(x0, (z0 + z1) / 2)];
    for (let q = 0; q < 4; q++) { const b = (q === 0 && j === 1) || (q === 2 && j === 0) ? 2.6 : busy; E(cs[q], mids[q], { busy: b, night: j <= 1 ? 1 : 0 }); E(mids[q], cs[(q + 1) % 4], { busy: b, night: j <= 1 ? 1 : 0 }); }
    C.stub.blocks.push({ i, j, x0: x0 + pave / 2, x1: x1 - pave / 2, z0: z0 + pave / 2, z1: z1 - pave / 2, kind: plaza ? 'plaza' : park ? 'park' : 'built' });
    if (plaza || park) {
      const c = N((x0 + x1) / 2, (z0 + z1) / 2); for (const m of mids) E(m, c, { kind: plaza ? 'plaza' : 'path', busy: plaza ? 3 : 1.2, w: plaza ? 8 : 2.2, park, night: plaza ? 1 : 0 });
      if (park) { const ring = []; for (let k = 0; k < 8; k++) ring.push(N((x0 + x1) / 2 + Math.cos(k * 0.785) * (x1 - x0) * 0.32, (z0 + z1) / 2 + Math.sin(k * 0.785) * (z1 - z0) * 0.32)); for (let k = 0; k < 8; k++) E(ring[k], ring[(k + 1) % 8], { kind: 'path', busy: 1.4, w: 2.2, park: true }); E(mids[0], ring[6], { kind: 'path', park: true, w: 2 }); E(mids[2], ring[2], { kind: 'path', park: true, w: 2 }); }
      C.areas.push({ kind: plaza ? 'square' : 'park', gather: plaza ? 1 : 0, c: [(x0 + x1) / 2, (z0 + z1) / 2], poly: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, r = (x1 - x0) * (plaza ? 0.3 : 0.4); C.benches.push({ x: (x0 + x1) / 2 + Math.cos(a) * r, z: (z0 + z1) / 2 + Math.sin(a) * r, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) }); }
    } else {
      // shop fronts on the south (z0) and north (z1) sides
      const cats = ['grocery', 'cafe', 'pharmacy', 'bar', 'bakery', 'clothes', 'bank', 'supermarket', 'restaurant', 'hair'];
      for (const [zz, nzn, mi] of [[z0, -1, 0], [z1, 1, 2]]) for (let k = 0; k < 3; k++) {
        const cat = cats[Math.floor(rnd() * cats.length)], x = x0 + (x1 - x0) * (0.2 + 0.3 * k), h24 = cat === 'supermarket' && rnd() < 0.5 ? 1 : 0;
        const openH = cat === 'bar' ? [17, 26] : cat === 'restaurant' ? [11, 23] : cat === 'cafe' ? [8, 21] : cat === 'bank' ? [9, 17] : [8, 20];
        const wallZ = zz - nzn * pave / 2;          // the block's wall behind the pavement (nzn: outward normal of that wall)
        C.pois.push({ id: C.pois.length, x, z: wallZ + nzn * 0.25, nx: 0, nz: nzn, cat, h24, terrace: cat === 'cafe' || cat === 'restaurant' ? 1 : 0, openH, pave: [x, zz], wallZ });
      }
    }
  }
  // crossings: across the N–S road at junction column i (between blocks i−1 and i), and across the E–W road at junction row j
  const sig = (i, j) => { const id = i * 100 + j; if (!C.stub.signals.some(s => s.id === id)) C.stub.signals.push({ id, x: X0 + i * pitch, z: Z0 + j * pitch, cycle: 36, offset: (i * 7 + j * 13) % 36 }); return id; };
  for (let i = 1; i < nx; i++) for (let j = 0; j < nz; j++) for (const q of [[1, 0], [2, 3]]) {         // SE of block i−1 ↔ SW of block i (near junction i,j); NE ↔ NW (near junction i,j+1)
    const a = corner[(i - 1) + ',' + j + ',' + q[0]], b = corner[i + ',' + j + ',' + q[1]], jj = q[0] === 1 ? j : j + 1, signal = (jj > 0 && jj < nz) ? sig(i, jj) : -1;
    const cr = { id: C.crossings.length, a, b, signal, axis: 'x', x: (C.nodes[a].x + C.nodes[b].x) / 2, z: C.nodes[a].z, len: road, w: 3, zebra: 1 }; C.crossings.push(cr); E(a, b, { kind: 'cross', cross: cr, w: 3, busy: 1.2 });
  }
  for (let j = 1; j < nz; j++) for (let i = 0; i < nx; i++) for (const q of [[3, 0], [2, 1]]) {         // NW of block j−1 ↔ SW of block j (near junction i,j); NE ↔ SE (near junction i+1,j)
    const a = corner[i + ',' + (j - 1) + ',' + q[0]], b = corner[i + ',' + j + ',' + q[1]], ii = q[0] === 3 ? i : i + 1, signal = (ii > 0 && ii < nx) ? sig(ii, j) : -1;
    const cr = { id: C.crossings.length, a, b, signal, axis: 'z', x: C.nodes[a].x, z: (C.nodes[a].z + C.nodes[b].z) / 2, len: road, w: 3, zebra: 1 }; C.crossings.push(cr); E(a, b, { kind: 'cross', cross: cr, w: 3, busy: 1.2 });
  }
  // road graph
  const rn = {}; for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) rn[i + ',' + j] = C.roads.nodes.push({ x: X0 + i * pitch, z: Z0 + j * pitch }) - 1;
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) { if (i < nx) C.roads.edges.push({ a: rn[i + ',' + j], b: rn[(i + 1) + ',' + j], w: road }); if (j < nz) C.roads.edges.push({ a: rn[i + ',' + j], b: rn[i + ',' + (j + 1)], w: road }); }
  C.busStops.push({ x: X0 + 1.5 * pitch + 10, z: Z0 + pitch + off - 0.4, yaw: Math.PI, name: 'stub' });
  let t0 = 0, hrs = hours;
  C.hours = () => hrs; C.setHours = h => { hrs = h; }; C.mode = () => hrs >= 20.5 || hrs < 5.5 ? 'night' : hrs >= 18.5 || hrs < 7 ? 'dusk' : 'day';
  C.time = () => t0; C.advance = dt => { t0 += dt; };
  // signal: first half of the cycle the N–S road (crossed by 'x' crossings) has green → walkers may cross the E–W road ('z' crossings)
  C.signalPhase = (id, t) => { const s = C.stub.signals.find(q => q.id === id); if (!s) return 0; return ((t + s.offset) % s.cycle) / s.cycle; };
  C.canWalk = (e, t) => { const c = e.cross; if (!c || c.signal < 0) return true; const p = C.signalPhase(c.signal, t); return c.axis === 'z' ? p < 0.42 : (p >= 0.5 && p < 0.92); };
  C.hasSignal = e => !!(e.cross && e.cross.signal >= 0);
  C.isOpen = p => { if (p.h24) return true; const h = hrs, [a, b] = p.openH || [8, 20]; return (h >= a && h < b) || (h + 24 >= a && h + 24 < b); };
  C.density = (e, h) => e.busy * timeFactor(h, e.busy, e.night && C.pois.some(p => C.isOpen(p) && (p.cat === 'bar' || p.h24 || p.cat === 'restaurant') && Math.abs(p.x - (C.nodes[e.a].x + C.nodes[e.b].x) / 2) < 40 && Math.abs(p.z - (C.nodes[e.a].z + C.nodes[e.b].z) / 2) < 40) ? 1 : 0);
  C.onRoad = (x, z) => { const u = ((x - X0) % pitch + pitch) % pitch, v = ((z - Z0) % pitch + pitch) % pitch; return Math.min(u, pitch - u) < road / 2 || Math.min(v, pitch - v) < road / 2; };
  C.blocked = (x, z) => C.stub.blocks.some(b => b.kind === 'built' && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  /** Draw the stub (roads, pavements, zebras, blocks, shop doors, signal posts) for the dev page. → { group, update(t) } */
  C.draw = (THREE) => {
    const g = new THREE.Group(); g.name = 'stub-city'; const W = nx * pitch + 40, D = nz * pitch + 40;
    const mk = (w, d, col, x, z, y = 0, h = 0) => { const m = new THREE.Mesh(h ? new THREE.BoxGeometry(w, h, d) : new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: col })); if (!h) m.rotation.x = -Math.PI / 2; m.position.set(x, h ? y + h / 2 : y, z); g.add(m); return m; };
    mk(W, D, 0x3d3f43, 0, 0, 0.001);
    for (const b of C.stub.blocks) { mk(b.x1 - b.x0 + 2 * pave, b.z1 - b.z0 + 2 * pave, 0x9a968e, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0.012); if (b.kind === 'built') mk(b.x1 - b.x0, b.z1 - b.z0, [0xcbbfa8, 0xb9a48c, 0xd8d2c4, 0xa9b0b4][(b.i * 3 + b.j) % 4], (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0, 9 + ((b.i * 5 + b.j * 3) % 4) * 3); else mk(b.x1 - b.x0, b.z1 - b.z0, b.kind === 'park' ? 0x55703f : 0xb7b1a6, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0.02); }
    for (const c of C.crossings) for (let k = -3; k <= 3; k++) c.axis === 'x' ? mk(0.5, 3, 0xe6e6e0, c.x + k * 1.05, c.z, 0.01) : mk(3, 0.5, 0xe6e6e0, c.x, c.z + k * 1.05, 0.01);
    for (const p of C.pois) { const m = mk(2.2, 0.12, 0x202225, p.x, p.wallZ + p.nz * 0.07, 0, 2.6); m.userData.poi = p; mk(2.6, 0.14, C.isOpen(p) ? 0xf2d27a : 0x5a5a5a, p.x, p.wallZ + p.nz * 0.08, 2.7, 0.5); }
    for (const p of C.pois) if (p.terrace) for (let k = -1; k <= 1; k++) { const cx = p.x + k * 1.9 * p.nz, cz = p.z + p.nz * 1.7; mk(0.7, 0.7, 0xd8d2c4, cx, cz, 0.7, 0.05); mk(0.07, 0.07, 0x444444, cx, cz, 0, 0.7); for (const e of [-0.62, 0.62]) mk(0.4, 0.4, 0x6a5038, cx + e * p.nz, cz, 0, 0.45); }
    for (const b of C.benches) { const m = mk(1.6, 0.5, 0x6b4a2e, b.x, b.z, 0, 0.45); m.rotation.y = b.yaw; }
    const posts = C.stub.signals.map(s => { const m = mk(0.5, 0.5, 0x00ff00, s.x + road / 2 + 0.4, s.z + road / 2 + 0.4, 0, 3.2); m.material = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); return [s, m]; });
    return { group: g, update(t) { for (const [s, m] of posts) { const p = C.signalPhase(s.id, t); m.material.color.setHex(p < 0.42 ? 0x22cc44 : p < 0.5 ? 0xddaa22 : p < 0.92 ? 0xcc2222 : 0xddaa22); } } };
  };
  return finish(C);
}

// ---- driving side --------------------------------------------------------------------------------------------------------------------------
const num = (...a) => { for (const v of a) if (typeof v === 'number' && isFinite(v)) return v; return 0; };
/** Normalised view of any car object of the driving code: { x, z, y, yaw, vx, vz, speed (m/s), kind, ref }. */
export function carState(car, out = {}) {
  if (!car) return null;
  const p = car.pos || car.position || car.group?.position || car;
  out.ref = car; out.x = num(car.x, p.x); out.z = num(car.z, p.z); out.y = num(car.y, p.y); out.yaw = num(car.yaw, car.heading, car.group?.rotation?.y);
  const v = car.vel || car.velocity; let sp = num(car.speed, car.v, car.speedKmh != null ? car.speedKmh / 3.6 : undefined);
  if (v && typeof v === 'object') { out.vx = num(v.x, v[0]); out.vz = num(v.z, v[2] ?? v[1]); sp = sp || hyp(out.vx, out.vz); } else { out.vx = Math.sin(out.yaw) * sp; out.vz = Math.cos(out.yaw) * sp; }
  out.speed = sp; out.kind = car.kind || car.spec?.kind || 'sedan'; out.L = num(car.L, car.spec?.L) || 4.8; out.W = num(car.W, car.spec?.W) || 1.9; return out;
}
/** PeopleDrive from the driving code's hooks (notes/V6-cars.md). `carSpec` (car-models.js) is optional: seat positions come from it. */
export function driveAdapter(drive, { carSpec = null, target = (typeof window !== 'undefined' ? window : null) } = {}) {
  if (!drive) drive = {};
  if (drive.isPeopleDrive) return drive;
  const subs = [], ps = {};
  const A = { isPeopleDrive: true, raw: drive,
    player() { const c = drive.getPlayerCar?.(); return c ? carState(c, ps) : null; },
    traffic(cb) { drive.forEachTrafficCar?.(cb); },
    take(car) { return drive.takeTrafficCar?.(car); },
    disable(car, on = true) { return drive.setCarDisabled?.(car, on); },
    impulse(car, ix, iz) { return drive.addCarImpulse?.(car, ix, iz); },
    openDoor(car, on = true) { return drive.openCarDoor?.(car, on); },
    object(car) { return car && (car.group || car.object3d || car.mesh || null); },
    seat(car) { const S = carSpec ? carSpec(car.kind || 'sedan') : null; return S ? { x: S.driverX ?? 0.37, y: (S.cushion ?? 0.3) + 0.08, z: S.seatZ ?? -0.1, door: (S.W ?? 1.9) / 2, L: S.L, W: S.W, H: S.H } : { x: 0.37, y: 0.4, z: -0.1, door: 0.95, L: 4.8, W: 1.9, H: 1.45 }; },
    on(evt, cb) { if (typeof drive.on === 'function') { drive.on(evt, cb); subs.push(() => drive.off?.(evt, cb)); } else if (target) { const h = e => cb(e.detail ?? e); target.addEventListener(evt, h); subs.push(() => target.removeEventListener(evt, h)); } },
    off() { subs.splice(0).forEach(f => f()); } };
  return A;
}
/** A fake of the driving hooks for the tests: one player car, traffic cars on the stub road grid. meshFor(car) may return an Object3D. */
export function makeFakeDrive({ city = null, traffic = 0, seed = 3, meshFor = null } = {}) {
  let rs = seed; const rnd = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
  const L = {}, emit = (evt, d) => (L[evt] || []).forEach(cb => cb(d));
  const mk = (kind, x, z, yaw) => { const c = { kind, x, y: 0, z, yaw, v: 0, vx: 0, vz: 0, driver: null, disabled: false, taken: false, group: null }; if (meshFor) { c.group = meshFor(c); } return c; };
  const D = { player: null, cars: [], log: [],
    on(evt, cb) { (L[evt] = L[evt] || []).push(cb); }, off(evt, cb) { L[evt] = (L[evt] || []).filter(f => f !== cb); }, emit,
    getPlayerCar: () => D.player, forEachTrafficCar: cb => { for (const c of D.cars) if (!c.taken) cb(c); },
    takeTrafficCar(car) { car.taken = true; D.player = car; D.log.push(['take', car]); return car; },
    setCarDisabled(car, on) { car.disabled = on; D.log.push(['disable', on]); }, addCarImpulse(car, ix, iz) { car.vx += ix; car.vz += iz; const f = Math.sin(car.yaw) * car.vx + Math.cos(car.yaw) * car.vz; car.v = Math.max(0, f); D.log.push(['impulse', ix, iz]); },
    openCarDoor(car, on) { car.doorOpen = on; D.log.push(['door', on]); },
    setPlayer(kind, x, z, yaw) { D.player = mk(kind, x, z, yaw); return D.player; },
    addTraffic(kind, x, z, yaw, v = 0) { const c = mk(kind, x, z, yaw); c.v = v; c.cruise = v; D.cars.push(c); return c; },
    update(dt) {
      for (const c of [D.player, ...D.cars]) { if (!c) continue; if (c !== D.player && !c.taken) { c.v += clamp((c.stopped ? 0 : c.cruise || 0) - c.v, -6 * dt, 2.5 * dt); if (city && c.loop) { const P = c.loop; c.x += Math.sin(c.yaw) * c.v * dt; c.z += Math.cos(c.yaw) * c.v * dt; if (hyp(c.x - P.cx, c.z - P.cz) > P.r) { c.yaw += Math.PI; } } else { c.x += Math.sin(c.yaw) * c.v * dt; c.z += Math.cos(c.yaw) * c.v * dt; } }
        c.vx = Math.sin(c.yaw) * c.v; c.vz = Math.cos(c.yaw) * c.v; if (c.group) { c.group.position.set(c.x, c.y, c.z); c.group.rotation.y = c.yaw; } }
      if (D.player) emit('drive:tick', { car: D.player, pos: { x: D.player.x, y: 0, z: D.player.z }, vel: { x: D.player.vx, y: 0, z: D.player.vz }, speedKmh: D.player.v * 3.6, heading: D.player.yaw });
    },
    /** move the player car kinematically (tests): v m/s along its heading, steer rad/s */
    drivePlayer(dt, v, steer = 0) { const c = D.player; c.v = v; c.yaw += steer * dt; c.x += Math.sin(c.yaw) * v * dt; c.z += Math.cos(c.yaw) * v * dt; },
  };
  void rnd; return D;
}
