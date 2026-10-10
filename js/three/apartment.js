// ЖК VILNYI — procedural, fully furnished apartment interiors.
// V3: a unit with a real interior (data.js interiorOf(unit) — the room polygons, doors, windows and fixtures of the
// architectural plans) is built from that data: see "REAL INTERIOR" near the end of this file (notes/V3-builder.md).
// What follows first is the earlier fitted-box planner. It is the FALLBACK: used for a unit without an interior, when
// opts.box is set, and when the real-interior path throws.
// buildApartment(unit, styleId) → group in UNIT-LOCAL coords (x = u along the entrance wall 0..width, z = v from the
// entrance wall into the flat 0..depth, y = 0 at the floor surface). The plan is generated from TYPES[unit.type].plan
// (the unit's real room list with areas) and fitted into the unit's own box width × depth:
//   · windows only on the unit's facade sides (unit.frontFacade → the v = depth wall, unit.sideFacades → the side walls);
//   · a flat whose only facade is a side wall is planned in a frame turned by 90° (plan.rot = 'L' | 'R': that side wall
//     becomes the window wall, the entrance comes in through a side wall) and the result is turned back, so every
//     returned coordinate is unit-local again;
//   · the outdoor space (glazed balcony / balcony / terrace) is built on the side it really is on (unit.outdoor).
// Everything static is baked (merged by material) → roughly one draw call per material. Collisions use invisible boxes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TYPES, GEOM, LEVELS, ROOM_DEFAULTS, interiorOf, plateOf, unitsOn, unitToLocal } from '../data.js';
import { getMaterials, tickTv } from './materials.js';
import { F, FX } from './furniture.js';
import { collectInteractables } from './interact.js';

const CH = LEVELS.ceiling;            // clear ceiling height (2.8)
const BD = GEOM.balconyDepth;         // depth of a balcony / glazed balcony (1.5)
const PW = 0.1, CW = 0.15, FW = 0.2, TW = 0.1;   // side wall, entrance wall, front facade depth, partitions
const DOOR_W = 0.82, DOOR_H = 2.1, ENTRY_W = 1.0, ENTRY_H = 2.2;
const OUTDOOR = new Set(['balcony', 'loggia', 'terrace']);
const PI = Math.PI, HALF = PI / 2;
const KEEP_UV = /\.(rug|art\d|leaf2?|rattanShade|washi|ao|aoSoft|shade|glow|glowFaint|daylight|lampGlow|coldGlow)$/;

// ------------------------------------------------------------------ baking (merge by material)
const nonIndexed = new WeakMap();
function flat(g) { let n = nonIndexed.get(g); if (!n) { n = g.index ? g.toNonIndexed() : g; nonIndexed.set(g, n); } return n; }
const _n3 = new THREE.Matrix3();
// Bake core: writes list[i0..i1) (pairs of matrix, geometry) straight into one
// preallocated buffer set with inlined matrix math (the bake is the bulk of the build time).
function mergeInto(list, i0, i1, worldUV, color) {
  let n = 0;
  for (let i = i0; i < i1; i += 2) n += flat(list[i + 1]).attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = color ? new Float32Array(n * 3).fill(1) : null;
  let o = 0, minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = i0; i < i1; i += 2) {
    const s = flat(list[i + 1]), e = list[i].elements, P = s.attributes.position.array, N = s.attributes.normal ? s.attributes.normal.array : null;
    const U = s.attributes.uv ? s.attributes.uv.array : null, C = s.attributes.color ? s.attributes.color.array : null, cnt = s.attributes.position.count;
    const ne = _n3.getNormalMatrix(list[i]).elements;
    const a0 = e[0], a1 = e[4], a2 = e[8], a3 = e[12], b0 = e[1], b1 = e[5], b2 = e[9], b3 = e[13], c0 = e[2], c1 = e[6], c2 = e[10], c3 = e[14];
    const n0 = ne[0], n1 = ne[3], n2 = ne[6], m0 = ne[1], m1 = ne[4], m2 = ne[7], k0 = ne[2], k1 = ne[5], k2 = ne[8];
    for (let j = 0; j < cnt; j++, o++) {
      const x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2];
      const X = a0 * x + a1 * y + a2 * z + a3, Y = b0 * x + b1 * y + b2 * z + b3, Z = c0 * x + c1 * y + c2 * z + c3;
      pos[o * 3] = X; pos[o * 3 + 1] = Y; pos[o * 3 + 2] = Z;
      if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y; if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z;
      let nx = 0, ny = 1, nz = 0;
      if (N) {
        const p = N[j * 3], q = N[j * 3 + 1], r = N[j * 3 + 2];
        nx = n0 * p + n1 * q + n2 * r; ny = m0 * p + m1 * q + m2 * r; nz = k0 * p + k1 * q + k2 * r;
        const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1); nx *= l; ny *= l; nz *= l;
      }
      nor[o * 3] = nx; nor[o * 3 + 1] = ny; nor[o * 3 + 2] = nz;
      if (worldUV) {
        const ax = nx < 0 ? -nx : nx, ay = ny < 0 ? -ny : ny, az = nz < 0 ? -nz : nz;
        if (ay >= ax && ay >= az) { uv[o * 2] = X; uv[o * 2 + 1] = Z; }
        else if (ax >= az) { uv[o * 2] = Z; uv[o * 2 + 1] = Y; }
        else { uv[o * 2] = X; uv[o * 2 + 1] = Y; }
      } else if (U) { uv[o * 2] = U[j * 2]; uv[o * 2 + 1] = U[j * 2 + 1]; }
      if (col && C) { col[o * 3] = C[j * 3]; col[o * 3 + 1] = C[j * 3 + 1]; col[o * 3 + 2] = C[j * 3 + 2]; }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
  out.boundingSphere = out.boundingBox.getBoundingSphere(new THREE.Sphere());
  return out;
}
// Merge every static mesh under `src` into one mesh per material (added to `dst`). Meshes flagged userData.keep
// (colliders, the entrance door) are re-parented to `dst` with their transform preserved.
function bake(src, dst) {
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const buckets = new Map(), keep = [];
  src.traverse(o => {
    if (o.userData.keep) { keep.push(o); return; }
    if (!o.isMesh || !o.visible) return;
    let skip = false; for (let p = o.parent; p && p !== src; p = p.parent) if (p.userData.keep) skip = true;
    if (skip) return;
    let b = buckets.get(o.material); if (!b) buckets.set(o.material, b = []);
    b.push(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), o.geometry);
  });
  const meshes = [];
  for (const [mat, list] of buckets) {
    const worldUV = !KEEP_UV.test(mat.name || ''), color = !!mat.vertexColors;
    // split very large buckets so no single buffer gets unwieldy
    const CHUNK = 800;
    for (let i = 0; i < list.length; i += CHUNK * 2) {
      const merged = mergeInto(list, i, Math.min(list.length, i + CHUNK * 2), worldUV, color);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'baked:' + (mat.name || '?');
      mesh.matrixAutoUpdate = false;
      if (mat.transparent) mesh.renderOrder = 2;
      dst.add(mesh); meshes.push(mesh);
    }
  }
  for (const o of keep) {
    o.updateMatrixWorld(true);
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    o.parent && o.parent.remove(o);
    m.decompose(o.position, o.quaternion, o.scale);
    dst.add(o);
  }
  return meshes;
}

// ------------------------------------------------------------------ openable joinery (doors, drawers, appliances, curtains)
// furniture.js marks movers (userData.mover: a door leaf / drawer / appliance door / curtain panel with everything that
// moves with it) and compartments (userData.compartment.build: contents built on the first opening). Here all movers are
// pulled out of the static bake into ONE dynamic batch per material — the closed state costs a handful of draw calls no
// matter how many fronts there are — and each gets an invisible box proxy that carries the click contract of the
// walkthrough: userData.action = {type:'aptDoor', unitId, part:'cabinet'|'curtain'|'curtainSwitch'|…} + userData.toggle(open)
// → Promise. Animating a mover rewrites only its vertex range (a few hundred vertices) in the batch buffers.
// spec.type: 'slide' {dir, dist} | 'hinge' {axis, angle} | 'scale' {s:[sx,sy,sz] at t = 1, about the mover origin}.
// spec.group: movers sharing a group open / close together, each after its own delay (spec.dOpen / spec.dClose, ms):
//   a curtain's sheer + blackout layers and its wall switch; a dishwasher door followed by its sliding racks.
// spec.proxy === false: no click proxy of its own (it follows its group). A compartment placed INSIDE a mover is
// carried by it (dish racks: the plates ride out with the rack).
const _mT = new THREE.Matrix4(), _mM = new THREE.Matrix4(), _v3 = new THREE.Vector3(), _n3b = new THREE.Matrix3(), _bx = new THREE.Box3();
function buildMovers(ctx, sg, root) {
  const { m, unit } = ctx;
  sg.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(sg.matrixWorld).invert();
  const comps = new Map(), movers = [];
  sg.traverse(o => {
    const ud = o.userData;
    if (ud.compartment) {
      let carrier = null; for (let p = o.parent; p; p = p.parent) if (p.userData.mover) { carrier = p; break; }
      comps.set(o, { M: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), build: ud.compartment.build, group: null, users: [], carrierObj: carrier, carrier: null });
    }
    if (ud.mover) { for (let p = o.parent; p; p = p.parent) if (p.userData.mover) return; movers.push(o); }
  });
  if (!movers.length) return null;
  const buckets = new Map();
  const MV = movers.map((o, i) => {
    const B = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), invO = new THREE.Matrix4().copy(o.matrixWorld).invert();
    const box = new THREE.Box3();
    o.traverse(c => {
      if (!c.isMesh || !c.visible || c.material.userData.decal) return;
      const L = new THREE.Matrix4().multiplyMatrices(invO, c.matrixWorld);
      let b = buckets.get(c.material); if (!b) buckets.set(c.material, b = []);
      b.push({ i, L, geo: c.geometry });
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      box.union(_bx.copy(c.geometry.boundingBox).applyMatrix4(L));
    });
    const spec = o.userData.mover;
    let piece = spec.tag; for (let p = o.parent; !piece && p; p = p.parent) piece = p.userData.piece;
    const comp = spec.comp ? comps.get(spec.comp) || null : null;
    const mv = { spec, piece, B, Binv: new THREE.Matrix4().copy(B).invert(), box, t: 0, open: false, anim: null, ranges: [], comp, proxy: null, ud: {}, carry: [], obj: o };
    if (comp) comp.users.push(mv);
    return mv;
  });
  for (const c of comps.values()) if (c.carrierObj) { c.carrier = MV.find(mv => mv.obj === c.carrierObj) || null; if (c.carrier) c.carrier.carry.push(c); }
  movers.forEach(o => o.parent && o.parent.remove(o));
  MV.forEach(mv => { mv.obj = null; });
  // one batch mesh per material
  const batches = [];
  for (const [mat, list] of buckets) {
    list.sort((a, b) => a.i - b.i);
    let n = 0; for (const e of list) n += flat(e.geo).attributes.position.count;
    const color = !!mat.vertexColors, worldUV = !KEEP_UV.test(mat.name || '');
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), lp = new Float32Array(n * 3), ln = new Float32Array(n * 3);
    const col = color ? new Float32Array(n * 3).fill(1) : null;
    const bi = batches.length;
    let o = 0;
    for (const e of list) {
      const s = flat(e.geo), P = s.attributes.position.array, N = s.attributes.normal ? s.attributes.normal.array : null;
      const U = s.attributes.uv ? s.attributes.uv.array : null, C = s.attributes.color ? s.attributes.color.array : null, cnt = s.attributes.position.count;
      const E = e.L.elements, nm = _n3b.getNormalMatrix(e.L).elements, start = o;
      for (let j = 0; j < cnt; j++, o++) {
        const x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2];
        lp[o * 3] = E[0] * x + E[4] * y + E[8] * z + E[12]; lp[o * 3 + 1] = E[1] * x + E[5] * y + E[9] * z + E[13]; lp[o * 3 + 2] = E[2] * x + E[6] * y + E[10] * z + E[14];
        if (N) {
          const p = N[j * 3], q = N[j * 3 + 1], r = N[j * 3 + 2];
          let nx = nm[0] * p + nm[3] * q + nm[6] * r, ny = nm[1] * p + nm[4] * q + nm[7] * r, nz = nm[2] * p + nm[5] * q + nm[8] * r;
          const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1); ln[o * 3] = nx * l; ln[o * 3 + 1] = ny * l; ln[o * 3 + 2] = nz * l;
        } else ln[o * 3 + 1] = 1;
        if (U && !worldUV) { uv[o * 2] = U[j * 2]; uv[o * 2 + 1] = U[j * 2 + 1]; }
        if (col && C) { col[o * 3] = C[j * 3]; col[o * 3 + 1] = C[j * 3 + 1]; col[o * 3 + 2] = C[j * 3 + 2]; }
      }
      const r = MV[e.i].ranges, last = r[r.length - 1];
      if (last && last.b === bi && last.end === start) last.end = o; else r.push({ b: bi, start, end: o });
    }
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), na = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa); geo.setAttribute('normal', na); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'movers:' + (mat.name || '?'); mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    if (mat.transparent) mesh.renderOrder = 2;
    root.add(mesh);
    batches.push({ geo, pos, nor, uv, lp, ln, worldUV, pa, na, mesh, ready: false });
  }
  const pose = (mv) => {
    const sp = mv.spec, t = mv.t;
    if (sp.type === 'slide') _mT.makeTranslation(sp.dir[0] * sp.dist * t, sp.dir[1] * sp.dist * t, sp.dir[2] * sp.dist * t);
    else if (sp.type === 'scale') _mT.makeScale(1 + (sp.s[0] - 1) * t, 1 + (sp.s[1] - 1) * t, 1 + (sp.s[2] - 1) * t);
    else if (sp.axis === 'x') _mT.makeRotationX(sp.angle * t); else _mT.makeRotationY(sp.angle * t);
    _mM.multiplyMatrices(mv.B, _mT);
    const e = _mM.elements, nm = _n3b.getNormalMatrix(_mM).elements;
    for (const r of mv.ranges) {
      const bt = batches[r.b], P = bt.pos, N = bt.nor, lp = bt.lp, ln = bt.ln;
      for (let j = r.start; j < r.end; j++) {
        const x = lp[j * 3], y = lp[j * 3 + 1], z = lp[j * 3 + 2];
        P[j * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[j * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[j * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const a = ln[j * 3], b = ln[j * 3 + 1], c = ln[j * 3 + 2];
        let nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
        if (sp.type === 'scale') { const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1); nx *= l; ny *= l; nz *= l; }
        N[j * 3] = nx; N[j * 3 + 1] = ny; N[j * 3 + 2] = nz;
      }
      // upload only the moved range (the batch of a material can hold dozens of fronts)
      if (bt.ready) { bt.pa.addUpdateRange(r.start * 3, (r.end - r.start) * 3); bt.na.addUpdateRange(r.start * 3, (r.end - r.start) * 3); }
      bt.pa.needsUpdate = true; bt.na.needsUpdate = true;
    }
    for (const c of mv.carry) if (c.group) { c.group.matrix.multiplyMatrices(_mM, mv.Binv); c.group.matrixWorldNeedsUpdate = true; }
    if (mv.proxy) {
      const bx = mv.box, px = mv.proxy;
      bx.getCenter(_v3);
      px.matrix.multiplyMatrices(_mM, _mT.makeTranslation(_v3.x, _v3.y, _v3.z));
      bx.getSize(_v3); px.matrix.scale(_v3.set(Math.max(0.02, _v3.x), Math.max(0.02, _v3.y), Math.max(0.02, _v3.z)));
      px.matrixWorldNeedsUpdate = true;
    }
  };
  // closed pose + world-projected UVs (the bake's projection, frozen at the closed pose so the veneer moves with the door)
  for (const mv of MV) pose(mv);
  for (const bt of batches) {
    if (bt.worldUV) {
      const P = bt.pos, N = bt.nor, U = bt.uv;
      for (let j = 0; j < P.length / 3; j++) {
        const ax = Math.abs(N[j * 3]), ay = Math.abs(N[j * 3 + 1]), az = Math.abs(N[j * 3 + 2]);
        if (ay >= ax && ay >= az) { U[j * 2] = P[j * 3]; U[j * 2 + 1] = P[j * 3 + 2]; }
        else if (ax >= az) { U[j * 2] = P[j * 3 + 2]; U[j * 2 + 1] = P[j * 3 + 1]; }
        else { U[j * 2] = P[j * 3]; U[j * 2 + 1] = P[j * 3 + 1]; }
      }
    }
    // partial uploads only after the first full upload of the buffer; `watch` lets the apartment see each frame
    bt.mesh.onBeforeRender = (r, sc, cam) => { bt.ready = true; if (bt.watch) bt.watch(cam); };
  }
  // compartments: contents baked on first use, visible only while one of their doors is open (interior LED "on")
  const showComp = (c) => {
    if (!c.group) {
      const tmp = new THREE.Group(), inner = new THREE.Group();
      inner.matrixAutoUpdate = false; inner.matrix.copy(c.M); tmp.add(inner);
      try { c.build(inner, m); } catch (err) { console.warn('[apartment] contents', err); }
      c.group = new THREE.Group(); c.group.name = 'contents';
      bake(tmp, c.group);
      c.group.traverse(o => { if (o.isMesh) o.raycast = NO_RAYCAST; });
      c.group.matrixAutoUpdate = false;
      root.add(c.group);
      if (c.carrier) pose(c.carrier);
      c.group.updateMatrixWorld(true);
    }
    c.group.visible = true;
  };
  const hideComp = (c) => { if (c && c.group && c.users.every(u => u.t <= 0 && !u.open)) c.group.visible = false; };
  if (!COLMAT) { COLMAT = new THREE.MeshBasicMaterial({ visible: false }); COLMAT.name = 'collider'; }
  let disposed = false;
  // raw toggle of one mover; `delay` (ms) holds the start of the motion (sequenced groups)
  const toggle = (mv, open, instant = false, delay = 0) => {
    const want = open === undefined ? !mv.open : !!open;
    const ud = mv.ud;
    if (want === mv.open) return mv.anim ? mv.anim.promise : Promise.resolve();
    if (instant) {
      if (mv.anim) { mv.anim.cancel = true; mv.anim = null; }
      mv.open = want; ud._open = want; ud.open = want; ud._anim = false;
      if (want && mv.comp) showComp(mv.comp);
      mv.t = want ? 1 : 0; pose(mv); if (!want) hideComp(mv.comp);
      return Promise.resolve();
    }
    mv.open = want; ud._open = want; ud.open = want;
    if (want) {
      if (mv.spec.excl) for (const o of MV) if (o !== mv && o.open && o.spec.excl === mv.spec.excl) toggle(o, false);
      if (mv.comp) showComp(mv.comp);
    }
    if (mv.anim) mv.anim.cancel = true;
    const from = mv.t, to = want ? 1 : 0, dur = (mv.spec.dur || 600) * Math.max(0.35, Math.abs(to - from)), t0 = performance.now() + delay;
    const me = { cancel: false }; ud._anim = true;
    me.promise = new Promise(res => {
      const step = () => {
        if (me.cancel || disposed) return res();
        const k = Math.max(0, Math.min(1, (performance.now() - t0) / dur)), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        mv.t = from + (to - from) * e; pose(mv);
        if (k < 1) requestAnimationFrame(step);
        else { mv.anim = null; ud._anim = false; if (!want) hideComp(mv.comp); res(); }
      };
      step();
    });
    mv.anim = me;
    return me.promise;
  };
  // groups: one state, every member after its own delay
  const groups = new Map();
  for (const mv of MV) {
    const id = mv.spec.group; if (!id) continue;
    let g = groups.get(id);
    if (!g) groups.set(id, g = { id, mvs: [], open: false, promise: null, curtain: !!mv.spec.curtain, listeners: [] });
    g.mvs.push(mv); mv.group = g;
  }
  for (const g of groups.values()) {
    g.toggle = (open, o = {}) => {
      const want = open === undefined ? !g.open : !!open;
      if (want === g.open) return g.promise || Promise.resolve();
      g.open = want;
      for (const mv of g.mvs) if (mv.proxy) { mv.proxy.userData.open = want; }
      const p = g.promise = Promise.all(g.mvs.map(mv => toggle(mv, want, !!o.instant, o.instant ? 0 : (want ? mv.spec.dOpen : mv.spec.dClose) || 0)))
        .then(() => { if (g.promise === p) g.promise = null; });
      for (const f of g.listeners) { try { f(want); } catch { /* listener */ } }
      return p;
    };
  }
  const proxies = [];
  for (const mv of MV) {
    if (mv.spec.proxy === false) continue;
    const px = new THREE.Mesh(UBOX, COLMAT);
    const sp = mv.spec, door = sp.door || null, part = door ? 'balconyDoor' : sp.curtain ? (sp.part || 'curtain') : (sp.part || 'cabinet');
    px.name = door ? 'balcony-door' : sp.curtain ? 'curtain-' + part : sp.tag === 'lightSwitch' ? 'light-switch' : sp.tag === 'window' ? 'window-sash' : 'cabinet-front'; px.matrixAutoUpdate = false;
    px.userData.action = door ? { type: 'aptDoor', unitId: unit.id, part, door } : sp.curtain ? { type: 'aptDoor', unitId: unit.id, part, curtain: sp.group } : { type: 'aptDoor', unitId: unit.id, part };
    px.userData.cabinet = !door && !sp.curtain && !sp.idoor; px.userData.open = false;
    if (sp.idoor) { px.name = 'interior-door'; px.userData.interiorDoor = sp.idoor; px.userData.action.door = sp.idoor; }
    if (sp.curtain) { px.userData.curtain = sp.group; px.userData.motion = 'curtain'; }
    if (door) px.userData.balconyDoor = door;
    px.userData.piece = mv.piece || 'cabinet'; if (!sp.curtain) px.userData.motion = sp.type === 'slide' ? 'slide' : 'hinge';
    mv.ud = px.userData;
    px.userData.toggle = mv.group ? (open) => mv.group.toggle(open) : (open) => toggle(mv, open);
    px.userData._leafToggle = (open, instant) => toggle(mv, open, instant);
    mv.proxy = px; root.add(px); pose(mv);
    // closed-pose centre and outward facing (unit-local), e.g. to frame a camera on it
    const c = mv.box.getCenter(new THREE.Vector3()).applyMatrix4(mv.B), f = new THREE.Vector3(0, 0, 1).transformDirection(mv.B);
    px.userData.center = [c.x, c.y, c.z]; px.userData.front = [f.x, f.y, f.z];
    proxies.push(px);
  }
  return {
    proxies, count: MV.length, batches: batches.length, groups,
    onFrame: (fn) => { if (batches[0]) batches[0].watch = fn; },
    closeAll: () => {
      const ps = [], done = new Set();
      for (const mv of MV) {
        if (!mv.open || mv.spec.door || mv.spec.curtain || mv.spec.idoor || mv.spec.keep || mv.spec.tag === 'lightSwitch') continue;
        if (mv.group) { if (!done.has(mv.group)) { done.add(mv.group); ps.push(mv.group.toggle(false)); } }
        else ps.push(toggle(mv, false));
      }
      return Promise.all(ps);
    },
    dispose() {
      disposed = true;
      for (const bt of batches) bt.geo.dispose();
      for (const c of comps.values()) if (c.group) c.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    },
  };
}

// Balcony doors: group the leaf proxies of each door (a french pair opens together) and switch the opening's collider.
// The collider's userData.solid is true while closed; every change fires window 'vrc:colliders-changed' so the
// walkthrough can refresh its collider lists.
const NO_RAYCAST = () => {}, MESH_RAYCAST = THREE.Mesh.prototype.raycast;
function wireBalconyDoors(ctx, movers, key = 'balconyDoor') {
  const { unit } = ctx, out = [], part = key === 'balconyDoor' ? 'balconyDoor' : 'door';
  const fire = (d) => {
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vrc:colliders-changed', { detail: { unitId: unit.id, door: d.id, open: d.open, collider: d.collider } })); } catch { /* no DOM */ }
  };
  for (const d of ctx.balconyDoors) {
    d.proxies = movers ? movers.proxies.filter(p => p.userData[key] === d.id) : [];
    if (!d.proxies.length) continue;
    d.toggle = (open, o = {}) => {
      const want = open === undefined ? !d.open : !!open;
      if (want === d.open) return d.promise || Promise.resolve();
      d.open = want;
      for (const px of d.proxies) px.userData.open = px.userData._open = want;
      if (d.collider) d.collider.userData.open = d.collider.userData._open = want;
      // open: passable at once (the leaf clears the opening within ~1 s); close: blocks at once so nobody gets shut in
      if (d.collider) { d.collider.userData.solid = !want; d.collider.raycast = want ? NO_RAYCAST : MESH_RAYCAST; }
      fire(d);
      const p = d.promise = Promise.all(d.proxies.map(px => px.userData._leafToggle(want, !!o.instant))).then(() => { if (d.promise === p) d.promise = null; });
      return p;
    };
    for (const px of d.proxies) {
      px.userData.toggle = (open) => d.toggle(open);
      px.userData.doorKind = d.kind; px.userData.motion = d.kind === 'slide' ? 'slide' : 'hinge';
      px.userData.doorCollider = d.collider;
    }
    // the closed door's collider is also its tap target (it sits in front of the leaves); once open it is
    // neither solid nor pickable, so taps / glides pass through the opening and the moved leaves take the taps
    if (d.collider) {
      const cu = d.collider.userData;
      cu.doorProxies = d.proxies;
      cu.action = { type: 'aptDoor', unitId: unit.id, part, door: d.id };
      cu.toggle = (open) => d.toggle(open);
      cu.open = false; cu.doorKind = d.kind; cu.motion = d.kind === 'slide' ? 'slide' : 'hinge';
    }
    out.push(d);
  }
  return out;
}

// ------------------------------------------------------------------ small builders (unit-local)
const UBOX = new THREE.BoxGeometry(1, 1, 1);
function box(p, mat, u0, y0, v0, u1, y1, v1) {
  const o = new THREE.Mesh(UBOX, mat);
  o.position.set((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
  o.scale.set(Math.max(1e-4, u1 - u0), Math.max(1e-4, y1 - y0), Math.max(1e-4, v1 - v0));
  p.add(o); return o;
}
let COLMAT = null;
function collider(p, u0, y0, v0, u1, y1, v1, kind = 'solid') {
  if (!COLMAT) { COLMAT = new THREE.MeshBasicMaterial({ visible: false }); COLMAT.name = 'collider'; }
  const o = new THREE.Mesh(UBOX, COLMAT);
  o.position.set((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
  o.scale.set(u1 - u0, y1 - y0, v1 - v0);
  o.userData.keep = true; o.userData.collider = true;
  if (kind === 'floor') o.userData.floor = true; else o.userData.solid = true;
  o.name = 'col-' + kind;
  p.add(o); return o;
}
const PLANE = new THREE.PlaneGeometry(1, 1);
// horizontal rectangle at height y, facing up (dir=1) or down (dir=-1)
function hrect(p, mat, u0, v0, u1, v1, y, dir = 1) {
  const o = new THREE.Mesh(PLANE, mat);
  o.rotation.x = dir > 0 ? -HALF : HALF;
  o.position.set((u0 + u1) / 2, y, (v0 + v1) / 2);
  o.scale.set(u1 - u0, v1 - v0, 1);
  p.add(o); return o;
}
// place a furniture group: (u, v) position, rotation so that its front (+z) faces `face` ('+v','-v','+u','-u' or radians)
const FACE = { '+v': 0, '-v': PI, '+u': HALF, '-u': -HALF };
let CUR_M = null;                     // materials of the apartment being built (for the contact-shadow decals)
function put(p, obj, u, v, face = '+v', y = 0) {
  obj.position.set(u, y, v);
  obj.rotation.y = typeof face === 'number' ? face : FACE[face];
  p.add(obj);
  const sb = obj.userData.solidBox;
  // baked contact shadow: a soft dark footprint just above the floor (above rugs too)
  const ao = obj.userData.ao || (sb && !obj.userData.noSolid ? { w: sb.w, d: sb.d, x: sb.x, z: sb.z } : null);
  if (ao && CUR_M) {
    // two layers: a tight contact shadow and a broad soft penumbra (bounce light occluded by the piece)
    FX.fxFlat(obj, CUR_M.ao, ao.cell || 'rect', ao.x || 0, 0.013, ao.z || 0, ao.w + 0.22, ao.d + 0.22);
    if (!obj.userData.noSoftAO) FX.fxFlat(obj, CUR_M.aoSoft, 'soft', ao.x || 0, 0.012, ao.z || 0, ao.w * 1.25 + 0.9, ao.d * 1.25 + 0.9);
  }
  if (sb && !obj.userData.noSolid) {
    const c = collider(obj, -sb.w / 2 + (sb.x || 0), 0.02, -sb.d / 2 + (sb.z || 0), sb.w / 2 + (sb.x || 0), Math.min(sb.h, 1.9), sb.d / 2 + (sb.z || 0));
    c.name = 'col-furniture';
  }
  return obj;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rectPoly = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
function polyArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; }
function polyCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; const f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f; }
  a /= 2; return a ? [cx / (6 * a), cy / (6 * a)] : poly[0];
}


// ================================================================== PLAN
// The plan is made in a CANONICAL frame: the main window wall is the front (v = D), interior shell faces are ul = 0.1,
// ur = W − 0.1 (side walls), vc = 0.15 (back wall), vF = D − 0.2 (front facade inner face). For most flats that IS the
// unit frame (entrance on the back wall). A flat whose only facade is a side wall is turned (P.rot): its entrance then
// sits on a canonical side wall. Partition lines are wall CENTRES (walls 0.1 thick); clearRect() insets a room rect.
//
// Layout modes (chosen from the box and the room list):
//   simple  no bedroom: back band (hall + bathrooms + kitchen) and the living room on the window wall
//   strip   bedrooms and the living side by side on the window wall, a corridor strip in front of the back band
//   merged  the same for shallow boxes: the back band itself is the corridor, bathrooms at its ends (en-suite doors)
//   enf     narrow deep boxes: back band, then the open kitchen-living across the width, bedrooms on the window wall
// Bedrooms that do not fit even so are left out (P.dropped) — see notes/T16.md.
const BED_MIN = 2.25, LIV_MIN = 2.6, LIV_OK = 3.0, STRIP = 1.3;
const NK = { living: 'room.living', kitchen: 'room.kitchen', hall: 'room.hall', bedroom: 'room.bedroom', bath: 'room.bath', dressing: 'room.dressing', storage: 'room.storage', loggia: 'room.glazedBalcony', balcony: 'room.balcony', terrace: 'room.terrace' };
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const gapDoor = (c, w = DOOR_W, h = DOOR_H) => [c - w / 2, c + w / 2, h];

// Normalised room list of the unit's type (TYPES[…].plan, see data.js) with the i18n key of every room name.
function planType(unit) {
  const T = TYPES[unit.type];
  if (!T) throw new Error('apartment: unknown type ' + unit.type);
  const nk = new Map();
  for (const r of T.list || []) if (r && r.nk && !nk.has(r.name)) nk.set(r.name, r.nk);
  const list = (T.plan || T.list || []).filter(r => r && !(r.level > 0) && r.area > 0)
    .map(r => ({ kind: r.kind, name: r.name, area: +r.area, nk: r.nk || nk.get(r.name) || NK[r.kind] || 'room.other' }));
  return { T, list };
}

function planUnit(unit) {
  const { T, list } = planType(unit);
  const sf = unit.sideFacades || {};
  const UW = Math.max(3, +unit.width || 3), UD = Math.max(3, +unit.depth || 4.5);
  const du0 = clamp(Number.isFinite(+(unit.door || {}).u) ? +unit.door.u : UW / 2, 0, UW);
  // A flat whose only facade is a side wall is planned turned towards it — as long as its entrance is near the far
  // (back) end of the entrance wall, where the hall then is. An entrance further along that wall cannot be served
  // that way: the flat stays unturned, its front wall solid (P.front = false), windows in the side wall only.
  let rot = unit.frontFacade === false && (sf.left || sf.right) ? (sf.left ? 'L' : 'R') : 0, front = true;
  if (rot && (rot === 'L' ? UW - du0 : du0) > Math.min(2.0, UW - 2.9)) { rot = 0; front = false; }
  const W = rot ? UD : UW, D = rot ? UW : UD;
  const ul = PW, ur = W - PW, vc = rot ? PW : CW, vF = D - FW;        // (turned: the back wall is a party wall)
  const du = du0, eh = ENTRY_W / 2 + 0.005;
  const entry = !rot ? { wall: 'back', p: clamp(du, eh, W - eh) }
    : { wall: rot === 'L' ? 'left' : 'right', p: clamp(rot === 'L' ? UW - du : du, vc + eh, vF - 1.6) };
  const glaze = rot ? { left: false, right: false } : { left: !!sf.left, right: !!sf.right };
  const P = { W, D, UW, UD, rot, front, ul, ur, vc, vF, entry, glaze, T, list, levels: [], dropped: [], notes: [], duplex: false };
  P.outdoor = outdoorOf(unit, P);
  P.levels.push(planLevel(P));
  P.vb = P.levels[0].zones.vb;
  return P;
}

// The outdoor room of the plan (the first one of the type) and the side of the box it is really on: the unit's
// outdoor rects are projected into the unit frame and the facade side they lie beyond is taken.
function outdoorOf(unit, P) {
  const od = P.list.find(r => OUTDOOR.has(r.kind));
  if (!od) return null;
  const { UW, UD, rot } = P, sf = unit.sideFacades || {}, fr = unit.frame;
  const recs = Array.isArray(unit.outdoor) ? unit.outdoor : [];
  const rec = recs.find(o => o.kind === od.kind && Math.abs((o.area || 0) - od.area) < 0.06) || recs.find(o => o.kind === od.kind) || recs[0] || null;
  let bx = null;
  if (rec && fr && fr.o && fr.U && fr.V) {
    const pts = rec.poly && rec.poly.length >= 3 ? rec.poly : [[rec.x0, rec.z0], [rec.x1, rec.z0], [rec.x1, rec.z1], [rec.x0, rec.z1]];
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of pts) {
      const u = (x - fr.o[0]) * fr.U[0] + (z - fr.o[1]) * fr.U[1], v = (x - fr.o[0]) * fr.V[0] + (z - fr.o[1]) * fr.V[1];
      a = Math.min(a, u); b = Math.max(b, u); c = Math.min(c, v); d = Math.max(d, v);
    }
    if ([a, b, c, d].every(Number.isFinite)) bx = [a, b, c, d];
  }
  const sides = [];
  if (!rot && P.front) sides.push('front');
  if (sf.left) sides.push('left');
  if (sf.right) sides.push('right');
  if (!sides.length) sides.push('front');
  let side = sides[0];
  if (bx && sides.length > 1) {
    const cu = (bx[0] + bx[1]) / 2, cv = (bx[2] + bx[3]) / 2, beyond = { front: cv - UD, left: -cu, right: cu - UW };
    side = sides.reduce((s, k) => beyond[k] > beyond[s] ? k : s, sides[0]);
  }
  // canonical side + span along that wall
  let cs = side, len, a0, a1;
  if (!rot) { len = side === 'front' ? UW : UD; [a0, a1] = bx ? (side === 'front' ? [bx[0], bx[1]] : [bx[2], bx[3]]) : [0, len]; }
  else { cs = 'front'; len = UD; [a0, a1] = bx ? (rot === 'L' ? [bx[2], bx[3]] : [UD - bx[3], UD - bx[2]]) : [0, len]; }
  a0 = clamp(a0, 0, len); a1 = clamp(a1, 0, len);
  if (a1 - a0 < 0.6) { a0 = 0; a1 = len; }                // the real space lies off the box: take the whole side
  const depth = od.kind === 'terrace' ? clamp(od.area / Math.max(2.4, a1 - a0), BD, 3.0) : BD;
  return { kind: od.kind, name: od.name, nk: od.nk, area: od.area, side: cs, unitSide: side, a0, a1, real: a1 - a0, depth };
}

// Scale widths to `total`, keeping each >= its minimum where possible.
function fitWidths(want, total, mins) {
  const n = want.length, min = i => Array.isArray(mins) ? mins[i] : mins;
  let w = want.slice();
  const fixed = new Set();
  for (let it = 0; it <= n; it++) {
    const free = w.reduce((s, x, i) => s + (fixed.has(i) ? 0 : x), 0), rest = total - [...fixed].reduce((s, i) => s + min(i), 0);
    w = w.map((x, i) => fixed.has(i) ? min(i) : x * rest / (free || 1));
    const low = w.findIndex((x, i) => x < min(i) - 1e-6 && !fixed.has(i));
    if (low < 0 || fixed.size >= n - 1) break;
    fixed.add(low);
  }
  return w;
}
function mergeGaps(g) {
  g = g.filter(x => x[1] - x[0] > 0.05).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const x of g) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 0.02) { l[1] = Math.max(l[1], x[1]); l[2] = Math.max(l[2], x[2]); } else out.push([...x]); }
  return out;
}
function clearRect(P, r) {
  const [u0, v0, u1, v1] = r.rect, e = 1e-6;
  return [u0 <= P.ul + e ? P.ul : u0 + TW / 2, v0 <= P.vc + e ? P.vc : v0 + TW / 2, u1 >= P.ur - e ? P.ur : u1 - TW / 2, v1 >= P.vF - e ? P.vF : v1 - TW / 2];
}

function planLevel(P) {
  const { W, D, ul, ur, vc, vF, list, entry, glaze } = P;
  const L = { lv: 0, y: 0, rooms: [], wallsU: [], wallsV: [], doors: [], facade: [], sideBays: [], zones: {} };
  const inside = list.filter(r => !OUTDOOR.has(r.kind));
  const living = inside.find(r => r.kind === 'living') || { kind: 'living', name: 'Житлова кімната', nk: 'room.room', area: 14 };
  const kitchen = inside.find(r => r.kind === 'kitchen') || null;
  const hallData = inside.find(r => r.kind === 'hall') || { kind: 'hall', name: 'Хол', nk: 'room.hall', area: 4 };
  const bedsAll = inside.filter(r => r.kind === 'bedroom').sort((a, b) => b.area - a.area);
  const svcAll = inside.filter(r => r.kind === 'bath' || r.kind === 'dressing' || r.kind === 'storage')
    .sort((a, b) => (a.kind === 'bath' ? 0 : 1) - (b.kind === 'bath' ? 0 : 1) || b.area - a.area).slice(0, 6);
  const Wi = ur - ul, Di = vF - vc, narrow = W < 3.4;

  // ---------------- structure: how many bedrooms fit, and how
  let nb = bedsAll.length, mode = 'simple';
  for (; nb > 0; nb--) {
    const rowOK = Wi >= LIV_MIN + nb * BED_MIN - 1e-6 && Di >= 3.9, enfOK = Wi >= nb * 2.2 - 1e-6 && Di >= 5.85;
    // a deep box that would give bedrooms like corridors (under 2.5 m wide, over 4.6 m deep) is better served by the
    // enfilade — when a glazed side wall gives the living across the width its own windows
    const slivers = rowOK && enfOK && (glaze.left || glaze.right) && (Wi - LIV_OK) / nb < 2.5 && Di - 2.3 - STRIP > 4.6 && Wi / nb >= 2.9;
    if (rowOK && !slivers) { mode = Di >= 5.65 ? 'strip' : 'merged'; break; }
    if (enfOK) { mode = 'enf'; break; }
  }
  const beds = bedsAll.slice(0, nb);
  for (const b of bedsAll.slice(nb)) P.dropped.push(b);

  // ---------------- depths, window wall and back band — solved for the regular band depth and for a deeper band
  // (1.95 m: a bathroom is at least 1.5 × 1.9 clear, so in a shallower band it has to be 2 m wide), best score wins
  const hallMin = narrow ? 1.2 : 1.3, KMIN = 2.3, rowMode = mode === 'strip' || mode === 'merged';
  const od = P.outdoor, hasBath = svcAll.some(r => r.kind === 'bath');
  const sMax = r => r.kind === 'bath' ? 2.9 : r.kind === 'dressing' ? 2.4 : 2.0;
  // which side the living should be on (real side): next to its balcony, else the glazed corner, else away from the door
  let pref = null;
  if (od && od.side !== 'front') pref = od.side;
  else if (od && od.a1 - od.a0 < 0.8 * W) pref = (od.a0 + od.a1) / 2 > W / 2 ? 'right' : 'left';
  else if (glaze.right !== glaze.left) pref = glaze.right ? 'right' : 'left';
  const solve = (deep) => {
    // depths: back band bd, corridor strip sd, open living across the width lm (enf), front rooms fd
    let bd, sd = 0, lm = 0, ep = entry.p;
    if (mode === 'simple') bd = clamp(Di - 3.3, 1.55, 2.3);
    else if (mode === 'strip') { sd = STRIP; bd = clamp(Di - sd - 3.3, 1.55, 2.3); }
    else if (mode === 'merged') bd = clamp(Di - 3.0, 1.55, 1.9);
    else bd = clamp(Di - 5.2, 1.55, 2.3);
    if (deep) {
      if (bd >= 1.95 || Di - sd - 1.95 < (mode === 'enf' ? 4.3 : mode === 'merged' ? 2.45 : mode === 'strip' ? 2.75 : 2.2)) return null;
      bd = 1.95;
    }
    if (entry.wall !== 'back') { bd = Math.max(bd, Math.min(ep + 0.62 - vc, Di - 1.4)); ep = clamp(ep, vc + ENTRY_W / 2 + 0.005, vc + bd - 0.56); }
    if (mode === 'enf') lm = clamp((Di - bd) * 0.45, 1.9, 3.4);
    const fd = Di - bd - sd - lm, vb = vc + bd, vs = vb + sd, vm = vb + lm;
    // window wall (x-space: bedrooms from the low end, the living at the high end)
    let bw = [], cR = ul;
    if (rowMode) {
      const want = beds.map(b => clamp(b.area / fd, 2.4, 4.6)), lw = Math.max(3.0, (living.area + (kitchen ? kitchen.area * 0.6 : 0)) / (fd + sd));
      const ws = fitWidths([...want, lw], Wi, [...beds.map(() => BED_MIN), Wi >= LIV_OK + nb * BED_MIN ? LIV_OK : LIV_MIN]);
      bw = ws.slice(0, nb); cR = ul + bw.reduce((p, q) => p + q, 0);
    } else if (mode === 'enf') bw = fitWidths(beds.map(b => b.area), Wi, 2.2);
    const bedX = []; { let x = ul; for (const w of bw) { bedX.push([x, x + w]); x += w; } }
    const livX = rowMode ? [cR, ur] : [ul, ur];
    // back band: [services][hall][services][kitchen]; every split is tried on both mirrorings.
    // relax = 1: where the door position leaves no room for a regular bathroom it gets a slimmer one rather than none
    let relax = 0;
    const ehOf = () => ENTRY_W / 2 + [0.12, 0.05, 0.02][relax], hallMinOf = () => relax ? Math.min(hallMin, 1.15) : hallMin;
    const sMin = r => r.kind === 'bath' ? (bd >= 1.95 ? [1.6, 1.35, 1.2][relax] : [2.0, 1.7, 1.6][relax]) : r.kind === 'dressing' ? 1.2 : 1.0;
    const sWant = r => clamp(r.area / (bd - 0.1), sMin(r), sMax(r));
    const feasible = (flip, lw, rw, kw) => {
      const h0 = ul + lw, h1 = ur - rw - kw, eh = ehOf();
      if (h1 - h0 < hallMinOf() - 1e-6) return false;
      if (entry.wall === 'back') {
        const xd = flip ? W - ep : ep;
        if (lw > 0 && h0 > xd - eh + 1e-6) return false;
        if (rw + kw > 0 && h1 < xd + eh - 1e-6) return false;
      } else {
        const lo = (entry.wall === 'left') !== flip;
        if (lo ? lw > 0 : rw + kw > 0) return false;
      }
      if (kw > 0 && kw > livX[1] - livX[0] + 1e-6) return false;
      if (mode === 'merged') {
        for (const [b0, b1] of bedX) if (overlap(h0, h1, b0 + 0.1, b1 - 0.1) < 0.92) return false;
        if (!(kw > 0 && rw === 0) && overlap(h0, h1, cR, ur) < 1.0) return false;
      }
      return true;
    };
    let best = null;
    const n = svcAll.length, total = 3 ** n;
    for (const rx of [0, 1, 2]) {
      if (rx && best && (!hasBath || best.baths > 0)) break;
      relax = rx;
      for (const flip of [false, true]) for (let code = 0; code < total; code++) for (const kb of kitchen ? [1, 0] : [0]) {
        const Ls = [], Rs = []; let c = code, sc = -rx;
        for (let i = 0; i < n; i++) { const d = c % 3; c = (c - d) / 3; const r = svcAll[i]; if (d === 0) Ls.push(r); else if (d === 1) Rs.push(r); else sc -= r.kind === 'bath' ? 12 : 5; }
        const lw = Ls.reduce((p, r) => p + sMin(r), 0), rw = Rs.reduce((p, r) => p + sMin(r), 0), kw = kb ? KMIN : 0;
        if (!feasible(flip, lw, rw, kw)) continue;
        if (kb) sc += 3;
        const h0 = ul + lw, h1 = ur - rw - kw;
        if (rowMode && beds.length) { if (pref) sc += (flip ? 'left' : 'right') === pref ? 4 : 0; else if (entry.wall === 'back') sc += (flip ? W - ep : ep) < W / 2 ? 1 : 0; }
        else if (kb && pref) sc += (flip ? 'left' : 'right') === pref ? 0.5 : 0;
        // living across the whole width with a glazed side wall: keep the service rooms (and with them the kitchen
        // run in front of them) off that wall
        if (!rowMode && ((glaze[flip ? 'right' : 'left'] && !Ls.length) || (glaze[flip ? 'left' : 'right'] && !Rs.length))) sc += 1.5;
        if (mode === 'strip' && overlap(h0, h1, ul, cR) >= 0.95) sc += 1;                      // the hall opens straight onto the bedroom corridor
        sc -= 0.3 * (Math.max(0, Ls.length - 1) + Math.max(0, Rs.length - 1));                // rooms entered from a room
        if (Ls.some(r => r.kind === 'bath') || Rs.some(r => r.kind === 'bath')) sc += 0.5;
        sc += Math.min(1, h1 - h0 - hallMinOf()) * 0.2 - (flip ? 0.01 : 0);
        if (!best || sc > best.sc + 1e-9) best = { sc, flip, Ls, Rs, kb, relax: rx, baths: [...Ls, ...Rs].filter(r => r.kind === 'bath').length };
      }
    }
    if (!best) best = { sc: -99, flip: false, Ls: [], Rs: [], kb: 0, relax: 0, baths: 0 };      // (cannot happen for W ≥ 3: the hall alone always fits)
    relax = best.relax;
    return { sc: best.sc - (deep ? 0.6 : 0), bd, sd, lm, fd, vb, vs, vm, bw, cR, bedX, livX, best, ep, feasible, sMin, sWant, hallMinOf };
  };
  const S = [solve(false), solve(true)].filter(Boolean).sort((p, q) => q.sc - p.sc)[0];
  const { bd, sd, lm, fd, vb, vs, vm, bw, cR, bedX, livX, best, feasible, sMin, sWant, hallMinOf } = S;
  entry.p = S.ep;
  void fd;
  if (best.relax) P.notes.push('bathroom below 1.5 × 1.9 m (door position in a narrow box)');
  const { flip, kb } = best;
  for (const r of svcAll) if (!best.Ls.includes(r) && !best.Rs.includes(r)) P.dropped.push(r);
  // the room next to the hall is a bathroom where there is one
  const adjLast = (a) => a.slice().sort((p, q) => (p.kind === 'bath' ? 1 : 0) - (q.kind === 'bath' ? 1 : 0) || p.area - q.area);
  const Ls = adjLast(best.Ls).map(r => ({ r, w: sMin(r) })), Rs = adjLast(best.Rs).reverse().map(r => ({ r, w: sMin(r) }));
  let kw = kb ? KMIN : 0;
  {
    // grow from the minimum widths towards the widths the real areas ask for, while the hall keeps its own
    const sum = a => a.reduce((p, it) => p + it.w, 0);
    const hallWant = clamp(hallData.area / bd, hallMinOf(), 3.4), kWant = kb ? clamp(Math.max(2.7, kitchen.area / Math.max(1, bd - 0.75)), KMIN, Math.min(4.2, livX[1] - livX[0])) : 0;
    for (let it = 0; it < 400; it++) {
      let grown = false;
      const tryGrow = (get, set, want) => {
        const w0 = get(); if (w0 >= want - 1e-6) return;
        set(Math.min(want, w0 + 0.05));
        if (feasible(flip, sum(Ls), sum(Rs), kw) && ur - sum(Rs) - kw - ul - sum(Ls) >= hallWant - 1e-6) grown = true; else set(w0);
      };
      tryGrow(() => kw, v => { kw = v; }, kWant);
      for (const it2 of [...Ls, ...Rs]) tryGrow(() => it2.w, v => { it2.w = v; }, sWant(it2.r));
      if (!grown) break;
    }
  }

  // ---------------- emit (x-space → real u through X / R4 / the wall and door helpers)
  const X = x => flip ? W - x : x, sgn = flip ? -1 : 1;
  const R4 = (x0, v0, x1, v1) => flip ? [W - x1, v0, W - x0, v1] : [x0, v0, x1, v1];
  const polyX = pts => {
    const out = [];
    for (const [x, v] of pts) { const p = [X(x), v], q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push(p); }
    if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-6 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
    return out;
  };
  const room = (r, x0, v0, x1, v1, extra = {}) => {
    const rect = R4(x0, v0, x1, v1);
    const o = { kind: r.kind, name: r.name, nk: r.nk || NK[r.kind] || 'room.other', area: r.area, level: 0, rect, poly: rectPoly(...rect), ...extra };
    L.rooms.push(o); return o;
  };
  const wU = (v, x0, x1, gaps = []) => { if (x1 - x0 > 0.02) L.wallsU.push({ v, u0: Math.min(X(x0), X(x1)), u1: Math.max(X(x0), X(x1)), gaps: mergeGaps(gaps.map(([a, b, h]) => flip ? [W - b, W - a, h] : [a, b, h])) }); };
  const wV = (x, v0, v1, gaps = []) => { if (v1 - v0 > 0.02) L.wallsV.push({ u: X(x), v0, v1, gaps: mergeGaps(gaps) }); };
  // doors: `into` = the side the leaf opens to (±v for a wall along u, ±x for a wall along v), hinge towards the
  // higher (+1) / lower (−1) coordinate along the wall
  const doorU = (v, x, into, hx) => L.doors.push({ axis: 'u', c: v, p: X(x), into, hinge: into * hx * sgn });
  const doorV = (x, v, intoX, hv) => { const into = intoX * sgn; L.doors.push({ axis: 'v', c: X(x), p: v, into, hinge: -into * hv }); };
  const side = lo => (lo !== flip) ? 'left' : 'right';      // real name of the low-x / high-x side
  const sideU = lo => (lo !== flip) ? 'u0' : 'u1';

  // ---- back band rooms
  const svc = [];
  let x = ul;
  Ls.forEach((it, i) => { const r = room(it.r, x, vc, x + it.w, vb, { band: true }); r.x0 = x; r.x1 = x + it.w; r.adj = i === Ls.length - 1 ? 'hi' : null; svc.push(r); x += it.w; });
  const h0 = x, h1 = ur - kw - Rs.reduce((s, it) => s + it.w, 0);
  x = h1;
  Rs.forEach((it, i) => { const r = room(it.r, x, vc, x + it.w, vb, { band: true }); r.x0 = x; r.x1 = x + it.w; r.adj = i === 0 ? 'lo' : null; svc.push(r); x += it.w; });
  const kitchenRoom = kb ? room(kitchen, ur - kw, vc, ur, vb, { back: true, band: true, tall: flip ? 'right' : 'left' }) : null;
  const inward = bd >= 1.95;                                   // leaves swing into a deep room, out of a shallow one
  const dv = clamp(vb - 0.62, vc + 0.5, vb - 0.5);
  for (let i = 0; i < svc.length; i++) {
    const r = svc[i];
    const inw = inward && r.x1 - r.x0 >= 1.5;                     // (a slim room: the leaf swings out into the hall)
    if (r.adj === 'hi') { wV(r.x1, vc, vb - 0.05, [gapDoor(dv)]); doorV(r.x1, dv, inw ? -1 : 1, 1); r.door = { wall: side(false), u: X(r.x1), v: dv }; }
    else if (r.adj === 'lo') { wV(r.x0, vc, vb - 0.05, [gapDoor(dv)]); doorV(r.x0, dv, inw ? 1 : -1, 1); r.door = { wall: side(true), u: X(r.x0), v: dv }; }
    // partition towards the next band room (another service room or the kitchen)
    const nx = svc[i + 1];
    if (r.adj !== 'hi' && r.x1 < ur - 1e-6 && (nx ? Math.abs(nx.x0 - r.x1) < 1e-6 : true)) wV(r.x1, vc, vb - 0.05);
  }
  // rooms not next to the hall are entered through the front wall of the band (corridor / living / en-suite)
  const frontGaps = [], ensuite = bedX.map(() => []);
  for (const r of svc) {
    if (r.adj) continue;
    let lo = r.x0 + 0.5, hi = r.x1 - 0.5, into = inward || mode === 'strip' ? -1 : 1;
    if (mode === 'merged') {
      const fr = [...bedX.map((b, i) => ({ a: b[0], b: b[1], i })), { a: cR, b: ur, i: -1 }].sort((p, q) => overlap(r.x0, r.x1, q.a, q.b) - overlap(r.x0, r.x1, p.a, p.b))[0];
      lo = Math.max(lo, fr.a + 0.55); hi = Math.min(hi, fr.b - 0.55);
      if (fr.i >= 0) ensuite[fr.i].push(0);
      r.frontRoom = fr.i;
    }
    const xdoor = hi >= lo ? clamp((r.x0 + r.x1) / 2, lo, hi) : (r.x0 + r.x1) / 2;
    if (r.frontRoom >= 0) ensuite[r.frontRoom][ensuite[r.frontRoom].length - 1] = xdoor;
    frontGaps.push(gapDoor(xdoor)); doorU(vb, xdoor, into, 1);
    r.door = { wall: 'front', u: X(xdoor), v: vb };
  }

  // ---- hall (+ the bedroom corridor)
  let strip = null, hallPoly = null;
  if (mode === 'strip') {
    if (overlap(h0, h1, ul, cR) >= 0.9) hallPoly = polyX([[h0, vc], [h1, vc], [h1, vb], [cR, vb], [cR, vs], [ul, vs], [ul, vb], [h0, vb]]);
    else strip = room({ kind: 'hall', name: 'Коридор', nk: 'room.corridor', area: +((cR - ul) * sd).toFixed(1) }, ul, vb, cR, vs, { strip: true });
  }
  const hall = room(hallData, h0, vc, h1, vb, { entry: true, ...(hallPoly ? { poly: hallPoly } : {}) });
  const stripRect = mode === 'strip' ? R4(ul, vb, cR, vs) : null;

  // ---- bedrooms
  const bedRooms = [], bv0 = mode === 'strip' ? vs : mode === 'merged' ? vb : vm;
  const bedGaps = [];
  beds.forEach((b, i) => {
    const [b0, b1] = bedX[i];
    let dx = b0 + 0.6;
    if (mode === 'merged') {
      const lo = Math.max(h0, b0 + 0.1) + 0.46, hi = Math.min(h1, b1 - 0.1) - 0.46;
      dx = hi >= lo ? clamp(dx, lo, hi) : clamp((Math.max(h0, b0) + Math.min(h1, b1)) / 2, b0 + 0.55, b1 - 0.55);
    } else if (mode === 'enf') {
      // doors of two bedrooms meet at the partition between them; a single bedroom is entered at the end nearer the hall
      dx = nb > 1 ? (i === 0 ? b1 - 0.6 : b0 + 0.6) : (h0 + h1) / 2 <= (b0 + b1) / 2 ? b0 + 0.6 : b1 - 0.6;
    }
    const lowSide = dx - b0 <= b1 - dx;
    bedGaps.push(gapDoor(dx)); doorU(bv0, dx, 1, lowSide ? -1 : 1);
    const r = room(b, b0, bv0, b1, vF, { doorU: X(dx), doorSide: sideU(lowSide), backDoors: [X(dx), ...ensuite[i].map(X)] });
    bedRooms.push(r);
    if (i > 0) wV(b0, bv0 + 0.05, vF);
  });
  if (rowMode && nb) wV(cR, bv0 + 0.05, vF);                    // bedroom | living
  if (mode === 'strip') wU(vs, ul, cR + 0.05, bedGaps);
  if (mode === 'enf') wU(vm, ul, ur, bedGaps);

  // ---- front wall of the back band
  let hallLiv = null;                      // the opening from the hall straight into the living, [x0, x1]
  {
    const g = [...frontGaps];
    if (mode === 'simple' || mode === 'enf') { hallLiv = [h0, h1]; g.push([h0, h1, 99]); }
    else if (mode === 'strip') {
      // the hall opens onto the bedroom corridor (which runs into the living); only a hall that does not reach the
      // corridor opens into the living itself — the wall kept this way is the living's kitchen wall
      if (overlap(h0, h1, ul, cR) >= 0.9) g.push([Math.max(h0, ul), Math.min(h1, cR), 99]);
      else if (overlap(h0, h1, cR, ur) >= 0.9) { hallLiv = [Math.max(h0, cR + 0.05), h1]; g.push([...hallLiv, 2.45]); }
    } else {
      g.push(...bedGaps);
      if (overlap(h0, h1, cR, ur) >= 0.9) { hallLiv = [Math.max(h0, cR + 0.05), h1]; g.push([...hallLiv, 2.45]); }
    }
    if (kitchenRoom) g.push([ur - kw + 0.05, ur, 2.4]);
    wU(vb, ul, ur, g);
    L.backWallGaps = mergeGaps(g.map(([a, b, h]) => flip ? [W - b, W - a, h] : [a, b, h]));
  }

  // ---- living (+ kitchenette when the kitchen is not in the band)
  const lv1 = mode === 'enf' ? vm : vF, [l0, l1] = livX, ldep = lv1 - vb;
  let kitFront = null, livPoly = null;
  if (kitchen && !kitchenRoom) {
    // candidates: a run along the living's back wall (the front wall of the band, on a stretch no opening leads
    // into) or along one of its side walls (not a glazed one, not across the mouth of the hall)
    const blocked = mergeGaps([...(hallLiv ? [[hallLiv[0], hallLiv[1], 0]] : []), ...frontGaps.map(q => [q[0] - 0.25, q[1] + 0.25, 0]), ...(rowMode && nb ? [[cR - 0.1, cR + 1.0, 0]] : [])]);
    const free = []; let s = l0;
    for (const [a, b] of blocked) { if (b <= l0 || a >= l1) continue; if (a - s > 0.02) free.push([s, Math.min(a, l1)]); s = Math.max(s, b); }
    if (l1 - s > 0.02) free.push([s, l1]);
    free.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
    const wantLen = clamp(kitchen.area / 1.25, 1.5, 3.6), shallow = ldep < 3.4 && mode !== 'enf', loPart = rowMode && nb > 0;
    const cands = [], f = free[0];
    if (f && ldep >= 1.4) { const len = Math.min(wantLen, f[1] - f[0]); if (len >= 1.2 - 1e-6) cands.push({ back: true, len, sc: (len >= 1.5 ? 0 : -6) + (shallow ? 0 : 3) + len }); }
    for (const lo of [false, true]) {
      const gl = lo ? (!loPart && !!glaze[side(true)]) : !!glaze[side(false)];
      const odHere = !!od && od.side === side(lo) && !(lo && loPart);                       // the balcony door will be in that wall
      const hallAt = blocked.some(([a, b]) => lo ? (!(loPart && mode === 'strip') && overlap(a, b, l0, l0 + 0.75) > 0.2) : overlap(a, b, l1 - 0.75, l1) > 0.2);   // an opening / a door in that corner
      const k0 = lo && loPart && mode === 'strip' ? vs + 0.1 : hallAt ? vb + 1.0 : vb;
      const doorNear = mode === 'enf' && bedRooms.some(r => Math.abs(r.doorU - X(lo ? l0 : l1)) < 1.35);   // a bedroom door right beside that wall
      const len = Math.min(wantLen, 3.2, lv1 - k0 - (mode === 'enf' ? (doorNear ? 1.05 : 0.1) : 0.9));
      if (len >= 1.2 - 1e-6 && l1 - l0 >= 2.5 && !odHere) cands.push({ back: false, lo, k0, len, sc: (len >= 1.5 ? 0 : -6) + (shallow ? 3 : 0) - (gl ? 2 : 0) - (hallAt ? 1 : 0) - (doorNear ? 1 : 0) - (lo ? 0.2 : 0) + len });
    }
    cands.sort((p, q) => q.sc - p.sc);
    const c = cands[0];
    if (!c) P.dropped.push(kitchen);
    else if (c.back) {
      const len = c.len, kd = Math.min(clamp(ldep - 1.3, 1.1, 1.75), ldep - 0.3);
      // which end of the stretch: against a side wall — not a glazed one — else the end away from the hall
      const atHi = Math.abs(f[1] - l1) < 1e-6, atLo = Math.abs(f[0] - l0) < 1e-6 && !loPart;
      const gHi = atHi && !!glaze[side(false)], gLo = atLo && !!glaze[side(true)];
      const toHi = (atHi && !gHi) ? true : (atLo && !gLo) ? false : gHi ? false : gLo ? true : (h0 + h1) / 2 < (f[0] + f[1]) / 2;
      const s0 = toHi ? f[1] - len : f[0], s1 = s0 + len;
      const endHi = Math.abs(s1 - l1) < 1e-6, endLo = Math.abs(s0 - l0) < 1e-6;
      kitFront = room(kitchen, s0, vb, s1, vb + kd, { front: 'back', tall: len < 1.7 ? 'none' : endHi ? side(false) : endLo ? side(true) : side(false) });
      livPoly = polyX([...(s0 > l0 + 1e-3 ? [[l0, vb], [s0, vb]] : []), [s0, vb + kd], [s1, vb + kd], ...(s1 < l1 - 1e-3 ? [[s1, vb], [l1, vb]] : []), [l1, lv1], [l0, lv1]]);
    } else {
      const { k0, len } = c, kwd = Math.min(1.8, Math.max(1.3, (l1 - l0) - 1.6)), atBack = k0 <= vb + 1e-3;
      if (c.lo) {
        kitFront = room(kitchen, l0, k0, l0 + kwd, k0 + len, { front: 'side', kside: sideU(true), tall: len < 1.7 ? 'none' : null });
        livPoly = polyX(atBack ? [[l0 + kwd, vb], [l1, vb], [l1, lv1], [l0, lv1], [l0, k0 + len], [l0 + kwd, k0 + len]]
          : [[l0, vb], [l1, vb], [l1, lv1], [l0, lv1], [l0, k0 + len], [l0 + kwd, k0 + len], [l0 + kwd, k0], [l0, k0]]);
      } else {
        kitFront = room(kitchen, l1 - kwd, k0, l1, k0 + len, { front: 'side', kside: sideU(false), tall: len < 1.7 ? 'none' : null });
        livPoly = polyX(atBack ? [[l0, vb], [l1 - kwd, vb], [l1 - kwd, k0 + len], [l1, k0 + len], [l1, lv1], [l0, lv1]]
          : [[l0, vb], [l1, vb], [l1, k0], [l1 - kwd, k0], [l1 - kwd, k0 + len], [l1, k0 + len], [l1, lv1], [l0, lv1]]);
      }
    }
  }
  const livRoom = room(living, l0, vb, l1, lv1, { ...(livPoly ? { poly: livPoly } : {}), mid: mode === 'enf' });
  if (mode === 'enf') livRoom.frontDoors = bedRooms.map(r => r.doorU);
  // where people come into the living: the hall opening, else the mouth of the bedroom corridor / the kitchen side
  livRoom.hallU = (hallLiv ? [X(hallLiv[0]), X(hallLiv[1])] : mode === 'strip' ? [X(cR), X(cR)] : [X(h1), X(h1)]).sort((a, b) => a - b);
  if (mode === 'strip' && nb) livRoom.mouth = sideU(true);

  // ---------------- facade: one bay per room on the window wall
  const frontRooms = (mode === 'enf' ? bedRooms : [...bedRooms, livRoom]).slice().sort((a, b) => a.rect[0] - b.rect[0]);
  if (P.front) frontRooms.forEach(r => L.facade.push({ u0: r.rect[0], u1: r.rect[2], room: r, slide: false }));
  // glazed side walls (corner flats): a window bay for every living room / bedroom that touches the wall
  for (const sd2 of ['left', 'right']) {
    if (!glaze[sd2]) continue;
    for (const r of [livRoom, ...bedRooms]) {
      if (!(sd2 === 'left' ? r.rect[0] <= ul + 1e-6 : r.rect[2] >= ur - 1e-6)) continue;
      let v0 = r.rect[1] + 0.4, v1 = r.rect[3] >= vF - 1e-6 ? vF - (P.front ? 0.6 : 0.25) : r.rect[3] - 0.4;
      if (r === livRoom && kitFront) {
        const k = kitFront.rect, touch = sd2 === 'left' ? k[0] <= ul + 1e-6 : k[2] >= ur - 1e-6;
        if (touch) v0 = Math.max(v0, kitFront.front === 'back' ? k[1] + 0.62 + 0.15 : k[3] + 0.1);   // past the run itself
      }
      r.glazed = sd2 === 'left' ? 'u0' : 'u1';
      if (v1 - v0 >= 0.8) L.sideBays.push({ side: sd2, v0, v1, room: r, door: false });
    }
  }

  // ---------------- outdoor room on its side
  if (od) {
    let bays = od.side === 'front' ? null : L.sideBays.filter(b => b.side === od.side);
    if (bays && !bays.length) { od.side = 'front'; od.a0 = 0; od.a1 = W; bays = null; P.notes.push('outdoor moved to the front wall'); }
    if (!bays && !L.facade.length) { P.outdoor = null; P.dropped.push(od); P.notes.push('no window wall for the outdoor room'); }
    else if (!bays) {
      const minLen = Math.min(W, od.kind === 'terrace' ? 3.0 : 2.4);
      if (od.a1 - od.a0 < minLen) { const c = clamp((od.a0 + od.a1) / 2, minLen / 2, W - minLen / 2); od.a0 = c - minLen / 2; od.a1 = c + minLen / 2; }
      // it must face at least one pane of a room: slide it towards the living when it would miss them all
      const ext = L.facade.map(f => ({ f, a: f.u0 + 0.2, b: f.u1 - 0.2 }));
      if (!ext.some(e => overlap(od.a0, od.a1, e.a, e.b) >= Math.min(1.3, e.b - e.a))) {
        const e = ext.find(q => q.f.room.kind === 'living') || ext[0], len = od.a1 - od.a0, c = clamp((od.a0 + od.a1) / 2, e.a + 0.8 - len / 2, e.b - 0.8 + len / 2);
        od.a0 = clamp(c - len / 2, 0, W - len); od.a1 = od.a0 + len;
      }
      const main = ext.filter(e => overlap(od.a0, od.a1, e.a, e.b) >= Math.min(1.0, e.b - e.a - 0.05))
        .sort((p, q) => (q.f.room.kind === 'living' ? 1 : 0) - (p.f.room.kind === 'living' ? 1 : 0) || overlap(od.a0, od.a1, q.a, q.b) - overlap(od.a0, od.a1, p.a, p.b));
      main.forEach((e, i) => { e.f.door = true; e.f.slide = i === 0; });
      if (!main.length && ext.length) { ext[0].f.door = true; ext[0].f.slide = true; }
      for (const e of ext) if (e.f.door) e.f.room.frontDoor = true;
    } else {
      const b = bays.find(q => q.room.kind === 'living') || bays.slice().sort((p, q) => (q.v1 - q.v0) - (p.v1 - p.v0))[0];
      b.door = true; b.room.sideDoor = od.side;
      let a0 = b.v0 - 0.3, a1 = Math.min(D, b.v1 + 0.45);
      const want = Math.max(od.real, 2.2);
      if (a1 - a0 < want) { a0 = Math.max(vc, a1 - want); if (a1 - a0 < want) a1 = Math.min(D, a0 + want); }
      od.a0 = a0; od.a1 = a1;
    }
    if (P.outdoor) {
      L.outRoom = { kind: od.kind, name: od.name, nk: od.nk, area: od.area, level: 0, outdoor: true, side: od.side, rect: [0, 0, 0, 0], poly: [] };
      setOutdoorRect(P, L.outRoom, od);
      L.rooms.push(L.outRoom);
    }
  }
  L.hasOutdoor = !!P.outdoor; L.outdoor = P.outdoor;

  // which side wall of the living takes the TV: the outer one, unless it is glazed or carries the kitchen run
  let tvSide = sideU(false);
  const bad = s => (livRoom.glazed === s) || (kitFront && kitFront.front === 'side' && kitFront.kside === s);
  if (bad(tvSide) && !bad(sideU(true))) tvSide = sideU(true);
  Object.assign(L.zones, { mode, flip, hall, strip, stripRect, svc, kitchenRoom, kitFront, livRoom, bedRooms, vb, vs, vm, bd, tvSide,
    hallRect: hall.rect, hasStrip: mode === 'strip' });
  if (mode === 'enf' && !livRoom.glazed) P.notes.push('living without a window (box too narrow for a room beside it)');
  return L;
}
// plan rect of the outdoor room from its side, span and depth
function setOutdoorRect(P, r, od) {
  r.rect = od.side === 'front' ? [od.a0, P.D, od.a1, P.D + od.depth] : od.side === 'left' ? [-od.depth, od.a0, 0, od.a1] : [P.W, od.a0, P.W + od.depth, od.a1];
  r.poly = rectPoly(...r.rect);
}

// ================================================================== SHELL
function buildShell(ctx, L) {
  const { P, m, sg, cut } = ctx;
  const y0 = L.y, H = cut ? 1.1 : CH, top = y0 + H;
  const wallM = m.wall, cap = m.cutCap;
  const segs = ctx.segs[L.lv] = [];      // solid wall pieces for skirting: {axis, c, a0, a1, faces:[-1,+1]}
  const wallPiece = (axis, c, a0, a1, t, yA, yB, faces, mat = wallM) => {
    if (a1 - a0 < 0.005 || yB - yA < 0.005) return;
    if (axis === 'u') box(sg, mat, a0, yA, c - t / 2, a1, yB, c + t / 2); else box(sg, mat, c - t / 2, yA, a0, c + t / 2, yB, a1);
    if (yA <= y0 + 0.01) {
      const hC = Math.min(yB, y0 + 2.2);
      if (axis === 'u') collider(ctx.cg, a0, y0 + 0.02, c - t / 2, a1, hC, c + t / 2); else collider(ctx.cg, c - t / 2, y0 + 0.02, a0, c + t / 2, hC, a1);
      segs.push({ axis, c, a0, a1, t, faces });
    }
    if (cut && yB >= top - 0.001) { if (axis === 'u') box(sg, cap, a0, top, c - t / 2, a1, top + 0.012, c + t / 2); else box(sg, cap, c - t / 2, top, a0, c + t / 2, top + 0.012, a1); }
  };
  const wallWithGaps = (axis, c, a0, a1, gaps, t = TW, faces = [-1, 1]) => {
    let s = a0;
    for (const [g0, g1, gh] of gaps) {
      const A = Math.max(a0, g0), B = Math.min(a1, g1);
      if (B <= A) continue;
      wallPiece(axis, c, s, A, t, y0, top, faces);
      if (gh < H) wallPiece(axis, c, A, B, t, y0 + gh, top, faces);     // lintel
      s = B;
    }
    wallPiece(axis, c, s, a1, t, y0, top, faces);
  };
  // shell: back wall, side walls (solid, or glazed for a corner flat); the entrance is in one of them
  const e = P.entry, eGap = [[e.p - ENTRY_W / 2, e.p + ENTRY_W / 2, ENTRY_H]];
  wallWithGaps('u', P.vc / 2, 0, P.W, e.wall === 'back' ? eGap : [], P.vc, [1]);
  for (const side of ['left', 'right']) {
    if (P.glaze[side] && L.sideBays.some(b => b.side === side)) { buildSideGlazing(ctx, L, side); continue; }
    wallWithGaps('v', side === 'left' ? PW / 2 : P.W - PW / 2, P.vc, P.vF, e.wall === side ? eGap : [], PW, [side === 'left' ? 1 : -1]);
  }
  // partitions
  for (const w of L.wallsU) wallWithGaps('u', w.v, w.u0, w.u1, w.gaps);
  for (const w of L.wallsV) wallWithGaps('v', w.u, w.v0, w.v1, w.gaps);
  // entrance door + interior door frames with open leaves (not in the cutaway)
  if (!cut) buildEntrance(ctx);
  if (!cut) for (const d of L.doors) buildInteriorDoor(ctx, L, d);
  // floors (per room, partition coords → seams hide under walls)
  const flo = { bath: m.floorBath, storage: m.floor, dressing: m.floor };
  for (const r of L.rooms) {
    if (r.outdoor || r.closet) continue;
    const mat = flo[r.kind] || (r.kind === 'hall' ? (m.floorHall || (m.fam === 'milano' ? m.marble : m.floor)) : m.floor);
    floorPoly(sg, mat, r, y0, P);
  }
  // floor collider (reaching a little through the entrance, into the common hall)
  collider(ctx.cg, e.wall === 'left' ? -0.35 : 0, -0.2, e.wall === 'back' ? -0.35 : 0, e.wall === 'right' ? P.W + 0.35 : P.W, 0, P.D, 'floor');
  if (!cut) buildCeiling(ctx, L);
  // skirting + bath tiling + feature walls
  finishWalls(ctx, L);
}
// Floors: rectangles in partition coords; L-shaped rooms are decomposed into rects from their polygon's bounding strips.
function floorPoly(sg, mat, r, y, P) {
  const rects = polyRects(r.poly);
  for (const [u0, v0, u1, v1] of rects) {
    // extend to shell outer faces so nothing shows under walls
    const a = u0 <= P.ul + 1e-6 ? 0 : u0, c = u1 >= P.ur - 1e-6 ? P.W : u1, b = v0 <= P.vc + 1e-6 ? 0 : v0, d = v1 >= P.vF - 1e-6 ? P.D : v1;
    hrect(sg, mat, a, b, c, d, y, 1);
  }
}
// Decompose a rectilinear polygon into rectangles (slab method along v).
function polyRects(poly) {
  const vs = [...new Set(poly.map(p => +p[1].toFixed(4)))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < vs.length - 1; i++) {
    const vm = (vs[i] + vs[i + 1]) / 2, xs = [];
    for (let k = 0; k < poly.length; k++) {
      const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % poly.length];
      if (Math.abs(x0 - x1) < 1e-6 && (y0 - vm) * (y1 - vm) < 0) xs.push(x0);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], vs[i], xs[k + 1], vs[i + 1]]);
  }
  return out;
}

function buildCeiling(ctx, L) {
  const { P, m, sg } = ctx;
  const y = L.y + CH;
  hrect(sg, m.ceiling, 0, 0, P.W, P.D, y, -1);
  // downlights (recessed): ring + emissive disc, on a ~1.3 m grid per room
  for (const r of L.rooms) {
    if (r.outdoor || r.closet) continue;
    const [a0, b0, a1, b1] = clearRect(P, r);
    if (r.kind === 'living' && a1 - a0 >= 2.2 && b1 - b0 >= 2.2) { coveCeiling(ctx, L, r, [a0, b0, a1, b1]); continue; }
    const rects = r.kind === 'hall' ? polyRects(r.poly) : [[a0, b0, a1, b1]];
    for (const [u0, v0, u1, v1] of rects) {
      const nu = Math.max(1, Math.round((u1 - u0) / 1.4)), nv = Math.max(1, Math.round((v1 - v0) / 1.5));
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const u = u0 + (u1 - u0) * (i + 0.5) / nu, v = v0 + (v1 - v0) * (j + 0.5) / nv;
        downlight(ctx, u, y, v);
        downlightFx(ctx, L, u, v, r.kind === 'bath' ? 0.8 : 1);
      }
    }
  }
}
// Light a downlight leaves behind: a soft pool on the floor and, if a wall is close, the classic scallop wash.
function downlightFx(ctx, L, u, v, k = 1) {
  const { m, sg } = ctx, y0 = L.y;
  FX.fxFlat(sg, m.glowFaint, 'disc', u, y0 + 0.005, v, 1.7 * k, 1.7 * k);
  if (k < 1) return;                                   // small tiled rooms: the pool only (scallops read as spots)
  for (const s of ctx.segs[L.lv] || []) for (const f of s.faces) {
    const off = s.c + f * s.t / 2, [a, b] = s.axis === 'u' ? [u, v] : [v, u], dist = (b - off) * f;
    if (dist < 0.08 || dist > 0.8 || a < s.a0 + 0.3 || a > s.a1 - 0.3 || s.low) continue;
    const w = 0.55 + dist * 0.9, h = 1.25 + dist * 0.9, yc = y0 + CH - 0.03 - h / 2;
    if (s.axis === 'u') FX.fxQuad(sg, m.glow, 'scallop', [a, yc, off + f * 0.013], [w, 0, 0], [0, h, 0]);
    else FX.fxQuad(sg, m.glow, 'scallop', [off + f * 0.013, yc, a], [0, 0, w], [0, h, 0]);
  }
}
function downlight(ctx, u, y, v, p) {
  const { m } = ctx, sg = p || ctx.sg;
  FX.cyl(sg, 0.05, 0.05, 0.004, ctx.m.fam === 'nordic' ? m.blackMetal : m.metal, u, y - 0.006, v, 20);
  FX.disc(sg, 0.036, m.lightEmit, u, y - 0.0065, v, [HALF, 0, 0], 16);
  FX.bloom(sg, u, y - 0.03, v, 0.22, 0.5);
}
// Living: dropped perimeter bulkhead with a hidden LED cove and downlights in the drop.
function coveCeiling(ctx, L, r, [a0, b0, a1, b1]) {
  const { m, sg } = ctx;
  const y = L.y + CH, drop = 0.14, band = 0.42, yb = y - drop;
  const cv0 = b0;
  // band along the facade (curtain pocket) and along the two sides
  box(sg, m.ceiling, a0, yb, b1 - band, a1, y - 0.002, b1);
  box(sg, m.ceiling, a0, yb, cv0, a0 + band, y - 0.002, b1 - band);
  box(sg, m.ceiling, a1 - band, yb, cv0, a1, y - 0.002, b1 - band);
  box(sg, m.ceiling, a0 + band, yb, cv0, a1 - band, y - 0.002, cv0 + band);
  // LED lines on the inner lips (emissive strips just under the ceiling)
  box(sg, m.led, a0 + band, y - 0.03, b1 - band - 0.012, a1 - band, y - 0.018, b1 - band - 0.002);
  box(sg, m.led, a0 + band + 0.002, y - 0.03, cv0 + band, a0 + band + 0.012, y - 0.018, b1 - band);
  box(sg, m.led, a1 - band - 0.012, y - 0.03, cv0 + band, a1 - band - 0.002, y - 0.018, b1 - band);
  box(sg, m.led, a0 + band, y - 0.03, cv0 + band + 0.002, a1 - band, y - 0.018, cv0 + band + 0.012);
  if (m.styleId === 'paris') {
    // plaster crown on the inner lip of the bulkhead (the LED cove sits behind it)
    for (const [d, h0, h1] of [[0.045, 0, 0.03], [0.028, 0.03, 0.06], [0.012, 0.06, 0.085]]) {
      const u0 = a0 + band - d, u1 = a1 - band + d, v0 = cv0 + band - d, v1 = b1 - band + d, ya = yb + h0 - 0.012, yc = yb + h1 - 0.012;
      box(sg, m.moulding, u0, ya, v0, u1, yc, cv0 + band); box(sg, m.moulding, u0, ya, b1 - band, u1, yc, v1);
      box(sg, m.moulding, u0, ya, cv0 + band, a0 + band, yc, b1 - band); box(sg, m.moulding, a1 - band, ya, cv0 + band, u1, yc, b1 - band);
    }
  }
  // downlights in the bands
  const n = Math.max(2, Math.round((a1 - a0) / 1.3));
  for (let i = 0; i < n; i++) { const u = a0 + (a1 - a0) * (i + 0.5) / n; downlight(ctx, u, yb, b1 - band / 2 - 0.05); FX.fxFlat(sg, m.glowFaint, 'disc', u, L.y + 0.005, b1 - 0.6, 1.5, 1.5); }
  const k = Math.max(1, Math.round((b1 - band - cv0) / 1.5));
  for (let j = 0; j < k; j++) { const v = cv0 + band + (b1 - 2 * band - cv0) * (j + 0.5) / k; for (const u of [a0 + band / 2, a1 - band / 2]) { downlight(ctx, u, yb, v); downlightFx(ctx, L, u, v, 1); } }
  // the hidden LED washes the recessed ceiling: a bright band fading inwards from every lip
  const iu0 = a0 + band, iu1 = a1 - band, iv0 = cv0 + band, iv1 = b1 - band, wash = Math.min(0.75, (iv1 - iv0) / 2, (iu1 - iu0) / 2);
  FX.fxQuad(sg, m.glow, 'grad', [(iu0 + iu1) / 2, y - 0.004, iv1 - wash / 2], [iu1 - iu0, 0, 0], [0, 0, wash]);
  FX.fxQuad(sg, m.glow, 'grad', [(iu0 + iu1) / 2, y - 0.004, iv0 + wash / 2], [iu1 - iu0, 0, 0], [0, 0, -wash]);
  FX.fxQuad(sg, m.glow, 'grad', [iu0 + wash / 2, y - 0.004, (iv0 + iv1) / 2], [0, 0, iv1 - iv0], [-wash, 0, 0]);
  FX.fxQuad(sg, m.glow, 'grad', [iu1 - wash / 2, y - 0.004, (iv0 + iv1) / 2], [0, 0, iv1 - iv0], [wash, 0, 0]);
}

// ---------------- doors
// The entrance is built in its own frame (x along the wall, centred on the door; z into the flat; wall thickness t), so
// it works in the back wall and in a side wall alike. The leaf is hinged on the jamb at +x — the right-hand one seen
// from inside — and swings inwards.
function entryFrame(P, o) {
  const e = P.entry;
  if (e.wall === 'back') o.position.set(e.p, 0, 0);
  else if (e.wall === 'left') { o.position.set(0, 0, e.p); o.rotation.y = HALF; }
  else { o.position.set(P.W, 0, e.p); o.rotation.y = -HALF; }
  return o;
}
function buildEntrance(ctx) {
  const { P, m, sg, unit } = ctx;
  const t = P.entry.wall === 'back' ? P.vc : PW;
  const eg = entryFrame(P, new THREE.Group()); sg.add(eg);
  const u0 = -ENTRY_W / 2, u1 = ENTRY_W / 2;
  const fm = m.doorFrame, vIn = t;
  // interior casing (architrave) + jamb linings
  box(eg, fm, u0 - 0.07, 0, vIn, u0, ENTRY_H + 0.07, vIn + 0.015);
  box(eg, fm, u1, 0, vIn, u1 + 0.07, ENTRY_H + 0.07, vIn + 0.015);
  box(eg, fm, u0 - 0.07, ENTRY_H, vIn, u1 + 0.07, ENTRY_H + 0.07, vIn + 0.015);
  box(eg, fm, u0, 0, 0, u0 + 0.015, ENTRY_H, t); box(eg, fm, u1 - 0.015, 0, 0, u1, ENTRY_H, t); box(eg, fm, u0, ENTRY_H - 0.015, 0, u1, ENTRY_H, t);
  box(eg, m.stone, u0, 0, 0, u1, 0.004, t);   // threshold
  // leaf: ONE mesh (two material groups), hinged on the right jamb, swings inward (+z)
  const lw = ENTRY_W - 0.04, lh = ENTRY_H - 0.02, lt = 0.06;
  let leafG = new THREE.BoxGeometry(lw, lh, lt).toNonIndexed();
  leafG.translate(-lw / 2, lh / 2, 0);
  if (m.styleId === 'paris') {
    // panelled inner face: two raised moulding frames
    const bits = [leafG], fr = (y0, y1) => { const w = lw - 0.3, sw = 0.028, z = lt / 2 + 0.004;
      for (const [bw, bh, bx, by] of [[w, sw, 0, y0 + sw / 2], [w, sw, 0, y1 - sw / 2], [sw, y1 - y0 - 2 * sw, -(w - sw) / 2, (y0 + y1) / 2], [sw, y1 - y0 - 2 * sw, (w - sw) / 2, (y0 + y1) / 2]]) {
        const b = new THREE.BoxGeometry(bw, bh, 0.008).toNonIndexed(); b.translate(-lw / 2 + bx, by, z); bits.push(b); } };
    fr(0.18, 0.94); fr(1.16, lh - 0.18);
    leafG = mergeGeometries(bits); bits.forEach(b => b.dispose());
  }
  const hdl = [];
  for (const side of [1, -1]) {
    const hz = side * (lt / 2 + 0.035);
    const g1 = new THREE.BoxGeometry(0.02, 0.02, 0.06).toNonIndexed(); g1.translate(-lw + 0.08, 1.05, side * (lt / 2 + 0.03)); hdl.push(g1);
    const g2 = new THREE.BoxGeometry(0.16, 0.022, 0.022).toNonIndexed(); g2.translate(-lw + 0.14, 1.05, hz); hdl.push(g2);
  }
  const hg = mergeGeometries(hdl);
  const leafGeo = mergeGeometries([leafG, hg], true);
  leafG.dispose(); hg.dispose(); hdl.forEach(g => g.dispose());
  const leaf = new THREE.Mesh(leafGeo, [m.doorLeaf, m.metal]);
  leaf.name = 'apt-door-leaf';
  wireEntranceDress(leaf, -lw / 2, lh / 2, lw, lh, lt, -lw + 0.08);
  const pivot = new THREE.Group(); pivot.name = 'apt-door-hinge';
  pivot.position.set(u1 - 0.02, 0.01, t / 2);
  pivot.add(leaf);
  pivot.userData.keep = true;
  leaf.userData.solid = true; leaf.userData.dynamic = true; leaf.userData.doorLeaf = true; leaf.userData.unitId = unit.id;
  leaf.userData.action = { type: 'aptDoor', unitId: unit.id };
  const OPEN = 1.62;
  let anim = null;
  leaf.userData.toggle = (open) => {
    const want = open === undefined ? !leaf.userData._open : !!open;
    if (want === !!leaf.userData._open && !anim) return Promise.resolve();
    leaf.userData._open = want; leaf.userData.open = want;
    const from = pivot.rotation.y, to = want ? OPEN : 0, t0 = performance.now(), dur = 800;
    if (anim) anim.cancel = true;
    const me = anim = { cancel: false };
    leaf.userData._anim = true;
    return new Promise(res => {
      const step = () => {
        if (me.cancel) return res();
        const k = Math.min(1, (performance.now() - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        pivot.rotation.y = from + (to - from) * e; pivot.updateMatrixWorld(true);
        if (k < 1) requestAnimationFrame(step); else { anim = null; leaf.userData._anim = false; res(); }
      };
      step();
    });
  };
  const holder = entryFrame(P, new THREE.Group()); holder.name = 'apt-door';
  holder.add(pivot);
  ctx.door = { leaf, pivot, holder };
  ctx.root.add(holder);
}
function buildInteriorDoor(ctx, L, d) {
  const { m, sg } = ctx;
  const y0 = L.y, w = DOOR_W, h = DOOR_H, fm = m.doorFrame, t = TW + 0.012;
  const g = new THREE.Group();
  // frame in local coords: opening along x centred at 0, wall thickness along z
  FX.box(g, 0.06, h + 0.06, 0.012, fm, -w / 2 - 0.03, 0, t / 2);
  FX.box(g, 0.06, h + 0.06, 0.012, fm, w / 2 + 0.03, 0, t / 2);
  FX.box(g, w + 0.12, 0.06, 0.012, fm, 0, h, t / 2);
  FX.box(g, 0.06, h + 0.06, 0.012, fm, -w / 2 - 0.03, 0, -t / 2);
  FX.box(g, 0.06, h + 0.06, 0.012, fm, w / 2 + 0.03, 0, -t / 2);
  FX.box(g, w + 0.12, 0.06, 0.012, fm, 0, h, -t / 2);
  FX.box(g, 0.012, h, TW, fm, -w / 2 + 0.006, 0, 0); FX.box(g, 0.012, h, TW, fm, w / 2 - 0.006, 0, 0); FX.box(g, w, 0.012, TW, fm, 0, h - 0.012, 0);
  // leaf opened ~95° into the room (+z side), hinge at x = hinge*w/2
  const lf = FX.grp(g, d.hinge * (w / 2 - 0.02), 0, TW / 2 + 0.02, d.hinge < 0 ? -HALF * 1.02 : HALF * 1.02);
  FX.box(lf, w - 0.04, h - 0.02, 0.04, m.doorLeaf, -d.hinge * (w - 0.04) / 2, 0.005, 0.02);
  if (m.styleId === 'paris') for (const z of [-0.002, 0.042]) { const cx = -d.hinge * (w - 0.04) / 2; FX.mouldFrame(lf, m.moulding, cx, 0.16, 0.9, w - 0.26, z, 0.024, 0.008); FX.mouldFrame(lf, m.moulding, cx, 1.02, h - 0.16, w - 0.26, z, 0.024, 0.008); }
  FX.box(lf, 0.13, 0.018, 0.02, m.metal, -d.hinge * (w - 0.1), 1.02, 0.055);
  FX.box(lf, 0.13, 0.018, 0.02, m.metal, -d.hinge * (w - 0.1), 1.02, -0.015);
  if (d.axis === 'u') { g.position.set(d.p, y0, d.c); g.rotation.y = d.into > 0 ? 0 : PI; }
  else { g.position.set(d.c, y0, d.p); g.rotation.y = d.into > 0 ? HALF : -HALF; }
  sg.add(g);
}

// ---------------- window walls: piers, glazing, balcony doors, the outdoor room
// A window wall in its own frame: x along the wall, z outwards. fr.g (visuals, baked) and fr.cg (colliders) carry the
// transform, so the same builders make the front facade and a glazed side wall. toPlan(x, z) → plan [u, v].
function wallFrame(ctx, side) {
  const { P, sg, cg } = ctx;
  if (side === 'front') return { side, g: sg, cg, s0: 0, s1: P.W, zF: P.vF, zD: P.D, th: FW, lim: [0, P.W], toPlan: (x, z) => [x, z], fromPlan: a => a, doors: [], main: null, panes: 0 };
  const g = new THREE.Group(), c = new THREE.Group();
  for (const o of [g, c]) { if (side === 'left') o.rotation.y = -HALF; else { o.rotation.y = HALF; o.position.set(P.W, 0, P.D); } }
  sg.add(g); cg.add(c);
  return {
    side, g, cg: c, s0: side === 'left' ? P.vc : P.D - P.vF, s1: side === 'left' ? P.vF : P.D - P.vc, zF: -PW, zD: 0, th: PW, lim: [0, P.D],
    toPlan: side === 'left' ? (x, z) => [-z, x] : (x, z) => [P.W + z, P.D - x], fromPlan: side === 'left' ? a => a : a => P.D - a,
    doors: [], main: null, panes: 0,
  };
}
// bays: [{a0, a1 (clear glazing extent, frame x), room, sill, door, slide, want}] sorted by a0. Everything of the wall
// between and around them is solid (fr.solid(a, b) builds it). Returns nothing; fills fr.doors / fr.main / fr.panes.
function glazedWall(ctx, L, fr, bays, od) {
  const { m, cut } = ctx, g = fr.g, y0 = L.y;
  const head = cut ? 1.1 : 2.45, top = y0 + (cut ? 1.1 : CH), zF = fr.zF, zD = fr.zD, vg = zD - Math.min(0.11, fr.th * 0.55), sk = Math.min(0.012, fr.th / 4);
  const solid = (a, b, yA = y0, yB = top) => {
    if (b - a < 0.01 || yB - yA < 0.01) return;
    box(g, m.wall, a, yA, zF, b, yB, zD - sk);
    box(g, m.exterior, a, yA, zD - sk, b, yB, zD);
    if (yA <= y0 + 0.01) collider(fr.cg, a, y0 + 0.02, zF, b, Math.min(yB, y0 + 2.2), zD);
    if (cut && yB >= top - 0.001) box(g, m.cutCap, a, top, zF, b, top + 0.012, zD);
    if (yA <= y0 + 0.01 && fr.seg) fr.seg(a, b, yB < top - 0.01);
  };
  let s = fr.s0;
  for (const f of bays) { solid(s, f.a0); s = f.a1; }
  solid(s, fr.s1);
  const frm = m.frame, ft = Math.min(0.055, fr.th * 0.5);
  for (const f of bays) {
    const a = f.a0, b = f.a1, sill = f.sill || 0;
    if (b - a < 0.3) { solid(a, b); continue; }
    const yH = y0 + head, topY = Math.min(yH, top);
    if (!cut) solid(a, b, yH, top);                                    // head bulkhead
    // panes
    const n = Math.max(1, Math.round((b - a) / 1.25)), pw = (b - a) / n;
    let di = -1;
    if (f.door && od) {
      // the pane that becomes the door: the one nearest to where the room wants it, among those facing the outdoor room
      // (f.lane: the stretch of the wall the room keeps free of furniture — a pane inside it comes first)
      const want = f.want ?? (a + b) / 2, lane = f.lane || null;
      let bestD = 1e9;
      for (let k = 0; k < n; k++) {
        const p0 = a + k * pw, p1 = p0 + pw, c = (p0 + p1) / 2;
        const dd = Math.abs(c - want) - (lane ? 10 * Math.min(0.8, Math.max(0, overlap(p0, p1, lane[0], lane[1]))) : 0) - 4 * Math.max(0, overlap(p0, p1, od.x0, od.x1)) / pw;
        if (dd < bestD) { bestD = dd; di = k; }
      }
      if (di >= 0) {
        const p0 = a + di * pw, p1 = p0 + pw;
        // the outdoor room reaches at least over its door (it grows that far when the free pane lies beside it)
        od.x0 = Math.max(fr.lim[0], Math.min(od.x0, p0 - 0.25)); od.x1 = Math.min(fr.lim[1], Math.max(od.x1, p1 + 0.25));
        if (f.slide || fr.main == null) fr.main = (p0 + p1) / 2;
        fr.doors.push([p0, p1]);
      }
    }
    if (sill < 0.02) box(g, m.stone, a, y0, zF, b, y0 + 0.012, zD);    // threshold
    for (let k = 0; k < n; k++) {
      const p0 = a + k * pw, p1 = p0 + pw;
      fr.panes++;
      if (k === di) {
        if (sill >= 0.02) box(g, m.stone, p0, y0, zF, p1, y0 + 0.012, zD);
        const rec = buildBalconyDoor(ctx, L, fr, f, p0, p1, n === 1 ? 0 : k + 1 < n ? 1 : -1, vg, topY, sill >= 0.02);
        f.openU = [p0 + 0.03, p1 - 0.03]; f.doorRec = rec;
        continue;
      }
      if (sill >= 0.02) {
        solid(p0, p1, y0, y0 + sill);
        box(g, m.stone, p0, y0 + sill, zF - 0.03, p1, y0 + sill + 0.025, zD);    // window board
      }
      box(g, m.glazing, p0 + 0.02, y0 + sill + 0.05, vg - 0.006, p1 - 0.02, topY - 0.04, vg + 0.006);
      if (sill < 0.02) collider(fr.cg, p0, y0 + 0.02, vg - 0.05, p1, y0 + 2.2, vg + 0.05);
      else collider(fr.cg, p0, y0 + sill, vg - 0.05, p1, y0 + 2.2, vg + 0.05);
    }
    if (!cut) {
      // daylight falling in through the bay: brightest at the glass, fading into the room
      const dl = sill >= 0.02 ? 1.5 : 2.4;
      FX.fxQuad(g, m.daylight, 'grad', [(a + b) / 2, y0 + 0.006, zF - dl / 2], [b - a + 0.3, 0, 0], [0, 0, dl]);
      FX.fxQuad(g, m.daylight, 'grad', [(a + b) / 2, y0 + CH - 0.006, zF - 0.8], [b - a, 0, 0], [0, 0, 1.6]);
      if (fr.side === 'front') for (const [uw, dir] of [[a, 1], [b, -1]]) FX.fxQuad(g, m.daylight, 'grad', [uw + dir * 0.012, y0 + 1.25, zF - 0.9], [0, 2.5, 0], [0, 0, 1.8]);
    }
    // frame: mullions + rails
    const yS = y0 + sill + (sill >= 0.02 ? 0.025 : 0.012);
    for (let k = 0; k <= n; k++) {
      const x = a + k * pw, atDoor = k === di || k === di + 1;
      box(g, frm, x - ft / 2, atDoor ? y0 + 0.012 : yS, vg - ft / 2, x + ft / 2, topY, vg + ft / 2);
    }
    for (let k = 0; k < n; k++) {
      if (k === di && sill >= 0.02) continue;
      box(g, frm, a + k * pw, yS, vg - ft / 2, a + (k + 1) * pw, yS + 0.038, vg + ft / 2);
    }
    box(g, frm, a, topY - 0.045, vg - ft / 2, b, topY, vg + ft / 2);
  }
}
// The front facade (after furnishing: the rooms say where they want their balcony door).
function buildFacade(ctx, L) {
  const { P, cut } = ctx, fr = wallFrame(ctx, 'front'), od = L.outdoor && L.outdoor.side === 'front' ? L.outdoor : null;
  const bays = [];
  L.facade.forEach((f, i) => {
    const a = i === 0 ? P.ul + 0.12 : f.u0 + 0.16, b = i === L.facade.length - 1 ? P.ur - 0.12 : f.u1 - 0.16;
    const want = (f.room.kind === 'living' ? ctx.slideU : f.room.slideU) ?? (a + b) / 2;
    bays.push({ a0: a, a1: b, room: f.room, sill: 0, door: !!f.door, slide: !!f.slide, want, lane: f.room.kind === 'living' ? ctx.slideLane : f.room.slideLane, f });
  });
  if (od) { od.x0 = od.a0; od.x1 = od.a1; }
  // (a flat with windows in a side wall only: the front wall is solid and takes skirting like any wall)
  if (!bays.length) fr.seg = (a, b) => ctx.segs[L.lv].push({ axis: 'u', c: (P.vF + P.D) / 2, a0: a, a1: b, t: P.D - P.vF, faces: [-1] });
  glazedWall(ctx, L, fr, bays, od);
  for (const b of bays) {
    if (b.slide && !cut) ctx.lightSpots.push({ u: (b.a0 + b.a1) / 2, v: P.vF - 0.9, y: L.y, h: 1.5, k: 0.75, pri: 0.5, col: 0xfff2e4, dist: 6.5 });
    if (!cut && b.room && b.room.rect) roomFalloff(ctx, L, b.room);
    b.f.openU = b.openU;
  }
  ctx.frames.front = fr;
  if (od) { od.a0 = od.x0; od.a1 = od.x1; setOutdoorRect(P, L.outRoom, od); buildOutdoor(ctx, L, fr, od); }
}
// A glazed side wall of a corner flat: windows with a sill for the rooms along it; with the outdoor room on this side,
// one pane is the door. Built with the shell (its solid stretches take skirting like any wall).
function buildSideGlazing(ctx, L, side) {
  const { P } = ctx, fr = wallFrame(ctx, side), od = L.outdoor && L.outdoor.side === side ? L.outdoor : null;
  const c = side === 'left' ? PW / 2 : P.W - PW / 2, face = side === 'left' ? 1 : -1;
  fr.seg = (a, b, low) => { const v0 = side === 'left' ? a : P.D - b, v1 = side === 'left' ? b : P.D - a; ctx.segs[L.lv].push({ axis: 'v', c, a0: v0, a1: v1, t: PW, faces: [face], low }); };
  const bays = L.sideBays.filter(b => b.side === side).map(b => {
    const x0 = fr.fromPlan(b.v0), x1 = fr.fromPlan(b.v1);
    return { a0: Math.min(x0, x1), a1: Math.max(x0, x1), room: b.room, sill: 0.9, door: !!b.door, slide: !!b.door, sb: b, want: fr.fromPlan(b.v1 - 0.6) };
  }).sort((p, q) => p.a0 - q.a0);
  if (od) { const x0 = fr.fromPlan(od.a0), x1 = fr.fromPlan(od.a1); od.x0 = Math.min(x0, x1); od.x1 = Math.max(x0, x1); }
  glazedWall(ctx, L, fr, bays, od);
  ctx.frames[side] = fr;
  if (od) {
    const v0 = side === 'left' ? od.x0 : P.D - od.x1, v1 = side === 'left' ? od.x1 : P.D - od.x0;
    od.a0 = v0; od.a1 = v1; setOutdoorRect(P, L.outRoom, od); buildOutdoor(ctx, L, fr, od);
  }
}
// Openable door to the balcony / glazed balcony / terrace in pane [p0, p1] (glazing plane vg) of window wall `fr`.
// Leaves are movers (see buildMovers) tagged with spec.door; a thin collider fills the opening while the door is closed.
//   milano / nordic: lift-and-slide leaf on the outer track, slides over its neighbour pane (dir = ±1)
//   riviera (or a single-pane bay / a pane between sill windows, dir = 0): a pair of outward-opening french doors
function buildBalconyDoor(ctx, L, fr, f, p0, p1, dir, vg, topY, forceFrench) {
  const { m, cut } = ctx, sg = fr.g, y0 = L.y, pw = p1 - p0, frm = m.frame, gl = m.glazing;
  const hm = m.fam === 'nordic' ? m.blackMetal : m.fam === 'milano' ? m.brass : (m.brass || m.metal);
  const id = 'bd' + L.lv + '-' + ctx.balconyDoors.length;
  const french = dir === 0 || forceFrench || m.fam === 'riviera';
  const H = topY - y0;
  const [cu, cv] = fr.toPlan((p0 + p1) / 2, vg), [, w0] = fr.toPlan(p0, vg), [, w1] = fr.toPlan(p1, vg);
  const front = fr.side === 'front';
  // plan record. A door in the front wall runs along u (p0 … p1 at v); a door in a side wall runs along v: then
  // axis = 'v', p0 = p1 = u of the wall, a0 … a1 its extent along v, out = the outward direction (−1 left, +1 right).
  const rec = { id, level: L.lv, room: f.room.kind, roomName: f.room.name, u: cu, v: cv, y: y0, p0: front ? p0 : cu, p1: front ? p1 : cu,
    axis: front ? 'u' : 'v', a0: front ? p0 : Math.min(w0, w1), a1: front ? p1 : Math.max(w0, w1), out: front ? 1 : fr.side === 'left' ? -1 : 1, side: fr.side,
    kind: french ? 'french' : 'slide', collider: null, proxies: [], open: false };
  if (french) {
    // outward-opening (onto the balcony): the leaves never sweep through curtains / plants inside
    const lw = pw / 2 - 0.03 - 0.004, rb = 0.12, st = 0.065, T = Math.min(0.06, fr.th * 0.55), yb = 0.052, hh = H - 0.047 - yb;
    for (const side of [-1, 1]) {
      // side -1: hinged on p0, leaf extends +x; side +1: hinged on p1, extends -x. Origin at the hinge, outer face.
      const hx = side < 0 ? p0 + 0.03 : p1 - 0.03, sx = -side;
      const lf = new THREE.Group(); lf.position.set(hx, y0 + yb, vg + T / 2);
      lf.userData.mover = { type: 'hinge', axis: 'y', angle: -sx * 1.62, dur: 1000, tag: 'balconyDoor', door: id };
      const bx = (x0, x1, yA, yB, z0, z1, mat) => box(lf, mat, Math.min(sx * x0, sx * x1), yA, z0, Math.max(sx * x0, sx * x1), yB, z1);
      bx(0, st, 0, hh, -T, 0, frm); bx(lw - st, lw, 0, hh, -T, 0, frm);               // stiles
      bx(st, lw - st, 0, rb, -T, 0, frm); bx(st, lw - st, hh - st, hh, -T, 0, frm);   // bottom + top rails
      for (const k of [1, 2]) { const y = rb + (hh - st - rb) * k / 3; bx(st, lw - st, y - 0.012, y + 0.012, -T / 2 - 0.012, -T / 2 + 0.012, frm); }   // glazing bars
      bx(st, lw - st, rb, hh - st, -T / 2 - 0.004, -T / 2 + 0.004, gl);
      // lever handle on the meeting stile (inside face) + rose; small pull outside
      bx(lw - st / 2 - 0.02, lw - st / 2 + 0.02, 1.0, 1.16, -T - 0.008, -T, hm);
      bx(lw - st / 2 - 0.13, lw - st / 2 + 0.005, 1.1, 1.12, -T - 0.05, -T - 0.03, hm);
      bx(lw - st / 2 - 0.01, lw - st / 2 + 0.01, 1.1, 1.12, -T - 0.035, -T - 0.008, hm);
      bx(lw - st / 2 - 0.01, lw - st / 2 + 0.01, 1.02, 1.18, 0, 0.012, hm);
      // hinges (outside)
      for (const y of [0.25, hh / 2, hh - 0.25]) bx(-0.004, 0.012, y - 0.06, y + 0.06, -0.004, 0.012, hm);
      sg.add(lf);
    }
  } else {
    // outer track: clear of the mullions (vg ± 0.0275) so the leaf and its inner handle pass over the fixed pane
    const z0 = vg + 0.05, z1 = vg + 0.084, sw = 0.055;
    const lf = new THREE.Group(); lf.position.set(p0, y0, 0);
    lf.userData.mover = { type: 'slide', dir: [dir, 0, 0], dist: pw - 0.06, dur: 1300, tag: 'balconyDoor', door: id };
    const bx = (x0, x1, yA, yB, zA, zB, mat) => box(lf, mat, x0, yA, zA, x1, yB, zB);
    bx(0, sw, 0.012, H, z0, z1, frm); bx(pw - sw, pw, 0.012, H, z0, z1, frm);
    bx(sw, pw - sw, 0.012, 0.075, z0, z1, frm); bx(sw, pw - sw, H - sw, H, z0, z1, frm);
    bx(sw, pw - sw, 0.075, H - sw, z0 + 0.013, z0 + 0.021, gl);
    // pull handle on the leading stile (the edge away from the stack), inside and outside
    const hx = dir > 0 ? sw / 2 : pw - sw / 2;
    bx(hx - 0.011, hx + 0.011, 0.86, 1.34, z0 - 0.02, z0 - 0.008, hm);
    for (const y of [0.9, 1.3]) bx(hx - 0.007, hx + 0.007, y - 0.008, y + 0.008, z0 - 0.008, z0, hm);
    bx(hx - 0.008, hx + 0.008, 0.95, 1.25, z1, z1 + 0.012, hm);
    // lift-and-slide lever
    bx(hx - 0.012, hx + 0.012, 1.02, 1.08, z0 - 0.014, z0, hm);
    sg.add(lf);
  }
  if (!cut) {
    rec.collider = collider(fr.cg, p0, y0 + 0.02, vg - 0.06, p1, y0 + 2.2, vg + 0.08);
    rec.collider.name = 'col-balcony-door'; rec.collider.userData.balconyDoor = id;
  }
  ctx.balconyDoors.push(rec);
  return rec;
}
// Rooms lit from one glazed side fall off towards the back: gradient shade decals on the ceiling, floor and side walls
// (dense at the corridor side, clear at the glass). Cheap stand-in for baked GI; unlit decals → merge into 1 draw call.
function roomFalloff(ctx, L, r) {
  const { P, m, sg } = ctx, [a0, b0, a1, b1] = clearRect(P, r), y0 = L.y, d = b1 - b0, w = a1 - a0, vm = (b0 + b1) / 2;
  if (d < 2 || w < 1.5) return;
  FX.fxQuad(sg, m.shade, 'fall', [(a0 + a1) / 2, y0 + CH - 0.006, vm], [w + 0.1, 0, 0], [0, 0, -d]);
  FX.fxQuad(sg, m.shade, 'fall', [(a0 + a1) / 2, y0 + 0.0115, vm], [w + 0.1, 0, 0], [0, 0, -d]);
  // side walls: only where a real wall runs (openings to a kitchen / hall stay clear); each piece carries its slice
  // of the room-long gradient
  for (const s of ctx.segs[L.lv] || []) {
    if (s.axis !== 'v' || s.low) continue;
    for (const f of s.faces) {
      const face = s.c + f * s.t / 2, uq = face + f * 0.013;
      if (!(Math.abs(face - a0) < 0.03 && f > 0) && !(Math.abs(face - a1) < 0.03 && f < 0)) continue;
      const p0 = Math.max(b0, s.a0), p1 = Math.min(b1, s.a1);
      if (p1 - p0 < 0.1) continue;
      fxSlice(ctx, m.shade, 'fall', uq, y0 + CH / 2, CH + 0.2, p0, p1, b0, b1);
    }
  }
  FX.fxQuad(sg, m.shade, 'soft', [(a0 + a1) / 2, y0 + CH / 2, b0 + 0.013], [w * 1.2, 0, 0], [0, CH * 1.6, 0]);
}
// Vertical decal on a wall of constant u, spanning v ∈ [p0, p1] but mapped as a slice of a cell stretched over
// [g0 (dense edge), g1] — so pieces of one gradient line up across door openings.
const FXC = { fall: [0, 2] };
function fxSlice(ctx, mat, cell, u, yc, h, p0, p1, g0, g1) {
  const [cx, cy] = FXC[cell], L = g1 - g0, t0 = (g1 - p0) / L, t1 = (g1 - p1) / L;   // t = cell v (1 = dense edge)
  const geo = new THREE.BufferGeometry(), y0 = yc - h / 2, y1 = yc + h / 2;
  geo.setAttribute('position', new THREE.Float32BufferAttribute([u, y0, p0, u, y1, p0, u, y1, p1, u, y0, p1], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  const U = (x) => cx * 0.25 + x * 0.25, V = (t) => 0.75 - cy * 0.25 + t * 0.25;
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([U(0.02), V(t0), U(0.98), V(t0), U(0.98), V(t1), U(0.02), V(t1)], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  ctx.tmpGeos.push(geo);
  const o = new THREE.Mesh(geo, mat); ctx.sg.add(o); return o;
}
// The outdoor room beyond window wall `fr`, over the span od.x0 … od.x1 (frame x), od.depth deep.
//   loggia  = glazed balcony (Засклений балкон): side walls, soffit, parapet with glazing above it
//   balcony = open, glass railing on three sides, soffit      terrace = open to the sky, deeper
function buildOutdoor(ctx, L, fr, od) {
  const { m, cut } = ctx, g = fr.g, cg = fr.cg;
  const y0 = L.y, D = fr.zD, v1 = D + od.depth, kind = od.kind, x0 = od.x0, x1 = od.x1, W = x1 - x0;
  const fy = y0 + 0.015;
  hrect(g, m.floorOut, x0 + 0.02, D, x1 - 0.02, v1 - 0.02, fy, 1);
  box(g, m.exterior, x0, y0 - 0.25, D, x1, y0, v1);               // slab (edge visible from outside)
  box(g, m.exterior, x0 + 0.001, y0, v1 - 0.02, x1 - 0.001, fy + 0.1, v1);    // upstand
  collider(cg, x0, y0 - 0.2, D - 0.05, x1, fy, v1, 'floor');
  const railH = 1.05;
  const railGlass = (a0, b0, a1, b1) => {
    box(g, m.glass, a0, fy + 0.1, b0, a1, fy + railH - 0.04, b1);
    collider(cg, Math.min(a0, a1) - 0.02, fy, Math.min(b0, b1) - 0.02, Math.max(a0, a1) + 0.02, fy + 1.2, Math.max(b0, b1) + 0.02);
  };
  // front railing
  railGlass(x0 + 0.04, v1 - 0.05, x1 - 0.04, v1 - 0.035);
  box(g, m.frame, x0 + 0.02, fy + railH - 0.04, v1 - 0.07, x1 - 0.02, fy + railH, v1 - 0.015);
  if (kind === 'loggia') {
    // side walls + soffit. Nothing here may be coplanar with the tower facade (exterior.js), which stays visible around
    // the unit: the side walls stand a little proud, the soffit hangs 1.5 cm below the slab above and stops short of
    // its edge (coplanar faces z-fight on phone GPUs).
    const h = cut ? 1.1 : CH, wt = 0.135, sy = y0 + CH - 0.015;
    for (const [a, b] of [[x0, x0 + wt], [x1 - wt, x1]]) { box(g, m.exterior, a, y0, D, b, y0 + h, v1); collider(cg, a, y0, D, b, y0 + 2.2, v1); }
    if (!cut) {
      box(g, m.exterior, x0, sy, D, x1, y0 + CH + 0.25, v1 - 0.02); downlight(ctx, (x0 + x1) / 2, sy, D + od.depth / 2, g);
      // glazing above the parapet: sashes between slim posts
      const a = x0 + wt, b = x1 - wt, n = Math.max(1, Math.round((b - a) / 1.1)), pw = (b - a) / n, zg = v1 - 0.045;
      box(g, m.glazing, a, fy + railH, zg - 0.005, b, sy - 0.03, zg + 0.005);
      for (let k = 0; k <= n; k++) box(g, m.frame, a + k * pw - 0.02, fy + railH, zg - 0.025, a + k * pw + 0.02, sy, zg + 0.025);
      box(g, m.frame, a, sy - 0.04, zg - 0.025, b, sy, zg + 0.025);
      collider(cg, a, fy + 1.0, zg - 0.03, b, y0 + 2.2, zg + 0.03);
    }
  } else {
    for (const u of [x0 + 0.05, x1 - 0.05]) { railGlass(u - 0.008, D + 0.02, u + 0.008, v1 - 0.05); box(g, m.frame, u - 0.02, fy + railH - 0.04, D, u + 0.02, fy + railH, v1 - 0.05); }
    // soffit (slab above) over a balcony — a terrace is open to the sky
    if (!cut && kind !== 'terrace') box(g, m.exterior, x0 + 0.14, y0 + CH - 0.02, D + 0.01, x1 - 0.14, y0 + CH + 0.16, v1 - 0.02);
  }
  // furniture
  const bp = fr.main ?? (x0 + x1) / 2;
  const cv = D + Math.min(od.depth / 2, 1.2) - 0.05;
  // keep the table and the potted plant out of the swing / path of every door to this outdoor space
  const doors = fr.doors;
  const blocks = (u0, u1) => doors.some(([q0, q1]) => u1 > q0 - 0.12 && u0 < q1 + 0.12);
  const inSpan = c => c > x0 + 0.95 && c < x1 - 0.95;
  let tu = bp < (x0 + x1) / 2 ? Math.max(bp + 1.55, x1 - 1.1) : Math.min(bp - 1.55, x0 + 1.1);
  if (blocks(tu - 0.85, tu + 0.85) || !inSpan(tu)) {
    const cands = [x0 + 1.1, x1 - 1.1];
    const edges = [x0, ...doors.flat().sort((p, q) => p - q), x1];
    for (let i = 0; i + 1 < edges.length; i += 2) cands.push((edges[i] + edges[i + 1]) / 2);
    tu = cands.find(c => inSpan(c) && !blocks(c - 0.85, c + 0.85)) ?? null;
  }
  // a deep terrace takes the table away from the doors, towards the railing
  if (tu == null && od.depth >= 2.4 && W > 2.2) { tu = clamp(bp, x0 + 1.0, x1 - 1.0); put(g, F.outdoorTable(m), tu, v1 - 0.95, '+v', fy); }
  else if (W > 4.2 && tu != null) put(g, F.outdoorTable(m), tu, od.depth >= 2.4 ? D + od.depth / 2 : cv, '+v', fy);
  const tuu = tu ?? bp;
  if (W > 2.0) put(g, F.planter(m, { len: Math.min(1.2, W * 0.18) }), tuu < (x0 + x1) / 2 ? x1 - 0.75 : x0 + 0.75, v1 - 0.28, '-v', fy);
  const pu = tuu < (x0 + x1) / 2 ? x1 - 0.4 : x0 + 0.4, pu2 = x0 + x1 - pu;
  const plantU = !blocks(pu - 0.3, pu + 0.3) ? pu : !blocks(pu2 - 0.3, pu2 + 0.3) ? pu2 : null;
  if (plantU != null) {
    if (kind === 'terrace') put(g, F.plant(m, { kind: 'olive', h: 1.6, seed: 9 }), plantU, D + 0.4, '+v', fy);
    else put(g, F.plant(m, { kind: 'snake', h: 0.8, seed: 21 }), plantU, D + 0.35, '+v', fy);
  }
  // exterior wall light next to the door (clear of every door leaf)
  const lu = [x0 + 0.3, x1 - 0.3].find(u => !blocks(u - 0.1, u + 0.1));
  if (!cut && lu != null) { FX.box(g, 0.08, 0.2, 0.06, m.frame, lu, y0 + 2.0, D + 0.03); FX.box(g, 0.06, 0.15, 0.005, m.lightEmit, lu, y0 + 2.02, D + 0.062); }
}

// ---------------- skirting, bath tiling, feature walls
function finishWalls(ctx, L) {
  const { P, m, sg } = ctx;
  const y0 = L.y;
  const baths = L.rooms.filter(r => r.kind === 'bath').map(r => ({ r, c: clearRect(P, r) }));
  const inBath = (u, v) => baths.find(b => u > b.c[0] - 0.08 && u < b.c[2] + 0.08 && v > b.c[1] - 0.08 && v < b.c[3] + 0.08);
  const paris = m.styleId === 'paris';
  const skM = m.skirting, sh = paris ? 0.13 : 0.08, st = paris ? 0.018 : 0.014;
  const halls = L.rooms.filter(r => r.kind === 'hall').map(r => r.poly);
  for (const s of ctx.segs[L.lv] || []) {
    for (const f of s.faces) {
      const off = s.c + f * s.t / 2;
      const mid = (s.a0 + s.a1) / 2, len = s.a1 - s.a0;
      const [pu, pv] = s.axis === 'u' ? [mid, off + f * 0.1] : [off + f * 0.1, mid];
      if (pv > P.vF + 0.01 || pv < 0 || pu < 0 || pu > P.W) continue;
      const bath = inBath(pu, pv);
      // ambient-occlusion strips in the junctions: floor (dense), wall foot, ceiling + wall head (soft)
      const W = (y, depth, into, mat) => s.axis === 'u'
        ? FX.fxQuad(sg, mat, 'grad', [mid, y, off + f * into], [len, 0, 0], [0, depth, 0])
        : FX.fxQuad(sg, mat, 'grad', [off + f * into, y, mid], [0, 0, len], [0, depth, 0]);
      const Fl = (y, wdt, mat) => s.axis === 'u'
        ? FX.fxQuad(sg, mat, 'grad', [mid, y, off + f * wdt / 2], [len, 0, 0], [0, 0, -f * wdt])
        : FX.fxQuad(sg, mat, 'grad', [off + f * wdt / 2, y, mid], [0, 0, len], [-f * wdt, 0, 0]);
      if (len > 0.12) {
        // vertical corner occlusion at both ends of the wall run (inside corners / door jambs)
        if (!ctx.cut && !s.low && len > 0.5) for (const [ae, sgn] of [[s.a0, 1], [s.a1, -1]]) {
          const cw = 0.28, ca = ae + sgn * cw / 2;
          if (s.axis === 'u') FX.fxQuad(sg, m.aoSoft, 'corner', [ca, y0 + CH / 2, off + f * 0.011], [0, CH, 0], [-sgn * cw, 0, 0]);
          else FX.fxQuad(sg, m.aoSoft, 'corner', [off + f * 0.011, y0 + CH / 2, ca], [0, CH, 0], [0, 0, -sgn * cw]);
        }
        Fl(y0 + 0.004, 0.32, m.ao);
        W(y0 + (bath ? 0.2 : 0.08 + 0.17), bath ? -0.4 : -0.34, 0.012, m.aoSoft);
        if (!ctx.cut && !s.low) { Fl(y0 + CH - 0.004, 0.3, m.aoSoft); W(y0 + CH - 0.15, 0.3, 0.012, m.aoSoft); }
      }
      if (bath) continue;
      if (s.axis === 'u') box(sg, skM, s.a0, y0, Math.min(off, off + f * st), s.a1, y0 + sh, Math.max(off, off + f * st));
      else box(sg, skM, Math.min(off, off + f * st), y0, s.a0, Math.max(off, off + f * st), y0 + sh, s.a1);
      if (paris && !ctx.cut && !s.low) boiserie(ctx, L, s, f, off, inBath);
      // entrance halls: LED line under a floating skirting washes the floor
      if (!ctx.cut && len > 0.5 && halls.some(poly => pointInPoly([pu, pv], poly))) {
        const e = st + 0.004;
        if (s.axis === 'u') box(sg, m.led, s.a0 + 0.05, y0 + 0.006, Math.min(off + f * e, off + f * (e + 0.006)), s.a1 - 0.05, y0 + 0.012, Math.max(off + f * e, off + f * (e + 0.006)));
        else box(sg, m.led, Math.min(off + f * e, off + f * (e + 0.006)), y0 + 0.006, s.a0 + 0.05, Math.max(off + f * e, off + f * (e + 0.006)), y0 + 0.012, s.a1 - 0.05);
        Fl(y0 + 0.006, 0.42, m.glowFaint);
      }
    }
  }
  // bath cladding: the four inner faces, minus the door opening
  const H = ctx.cut ? 1.1 : CH;
  for (const { r, c } of baths) {
    const [a0, b0, a1, b1] = c, t = 0.008, e = 0.001;
    const dr = r.door;
    const clad = (side) => {
      let gaps = [];
      if (dr && dr.wall === side && side !== 'front') gaps = [[dr.v - DOOR_W / 2 - 0.06, dr.v + DOOR_W / 2 + 0.06]];
      if (dr && dr.wall === 'front' && side === 'front') gaps = [[dr.u - DOOR_W / 2 - 0.06, dr.u + DOOR_W / 2 + 0.06]];
      const along = side === 'left' || side === 'right' ? [b0, b1] : [a0, a1];
      let s0 = along[0];
      const pieces = [];
      for (const [g0, g1] of gaps) { pieces.push([s0, g0, H]); pieces.push([g0, g1, DOOR_H + 0.07]); s0 = g1; }
      pieces.push([s0, along[1], H]);
      for (const [p0, p1, hFrom] of pieces) {
        if (p1 - p0 < 0.01) continue;
        const yA = hFrom === H ? y0 : y0 + hFrom, yB = y0 + H - 0.002;
        if (yB <= yA) continue;
        if (side === 'back') box(sg, m.wallBath, p0, yA, b0 + e, p1, yB, b0 + e + t);
        if (side === 'front') box(sg, m.wallBath, p0, yA, b1 - e - t, p1, yB, b1 - e);
        if (side === 'left') box(sg, m.wallBath, a0 + e, yA, p0, a0 + e + t, yB, p1);
        if (side === 'right') box(sg, m.wallBath, a1 - e - t, yA, p0, a1 - e, yB, p1);
      }
    };
    ['back', 'front', 'left', 'right'].forEach(clad);
  }
}

// Paris: Haussmann wall dressing on one wall face — plaster cornice under the ceiling, a chair rail, and moulded
// panel frames below and above it (boiserie). The face is first cut into free stretches where partitions meet it;
// trims stop short of door casings and the cornice carries on over door heads. The band between 0.95 and 1.15 m stays
// clear (wall switches live there). All of it is one material → one baked draw call.
function boiserie(ctx, L, s, f, off, inBath) {
  const { m, sg, P } = ctx, y0 = L.y, M = m.moulding, top = y0 + CH;
  const cuts = [];
  for (const q of ctx.segs[L.lv] || []) {
    if (q.axis === s.axis || q.c < s.a0 - 0.01 || q.c > s.a1 + 0.01) continue;
    const p = off + f * 0.03;
    if (p > q.a0 - 0.02 && p < q.a1 + 0.02) cuts.push([q.c - q.t / 2, q.c + q.t / 2]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const runs = []; let a = s.a0;
  for (const [c0, c1] of cuts) { if (c0 - a > 0.02) runs.push([a, c0]); a = Math.max(a, c1); }
  if (s.a1 - a > 0.02) runs.push([a, s.a1]);
  // how far a door opening reaches beyond a run end (0 = no door there)
  const en = P.entry, enAxis = en.wall === 'back' ? 'u' : 'v', enC = en.wall === 'back' ? P.vc / 2 : en.wall === 'left' ? PW / 2 : P.W - PW / 2;
  const doorAt = (x) => {
    for (const d of L.doors) if (d.axis === s.axis && Math.abs(d.c - s.c) < 0.09 && Math.abs(Math.abs(x - d.p) - DOOR_W / 2) < 0.04) return DOOR_W / 2;
    if (s.axis === enAxis && Math.abs(s.c - enC) < 0.02 && Math.abs(Math.abs(x - en.p) - ENTRY_W / 2) < 0.04) return ENTRY_W / 2;
    return 0;
  };
  const B = (a0, a1, ya, yb, d) => { if (a1 - a0 < 0.01) return; if (s.axis === 'u') box(sg, M, a0, ya, Math.min(off, off + f * d), a1, yb, Math.max(off, off + f * d)); else box(sg, M, Math.min(off, off + f * d), ya, a0, Math.max(off, off + f * d), yb, a1); };
  const frame = (a0, a1, ya, yb) => { const w = 0.026, d = 0.009; if (a1 - a0 < 0.12 || yb - ya < 0.12) return; B(a0, a1, ya, ya + w, d); B(a0, a1, yb - w, yb, d); B(a0, a0 + w, ya + w, yb - w, d); B(a1 - w, a1, ya + w, yb - w, d); };
  for (const [r0, r1] of runs) {
    const mid = (r0 + r1) / 2, [pu, pv] = s.axis === 'u' ? [mid, off + f * 0.1] : [off + f * 0.1, mid];
    if (inBath(pu, pv) || pv > P.vF + 0.01 || pv < 0) continue;
    const d0 = Math.abs(r0 - s.a0) < 0.01 ? doorAt(r0) : 0, d1 = Math.abs(r1 - s.a1) < 0.01 ? doorAt(r1) : 0;
    // cornice: cyma-like stack of three steps + a small bead below
    const c0 = r0 - d0, c1 = r1 + d1;
    B(c0, c1, top - 0.03, top, 0.075); B(c0, c1, top - 0.062, top - 0.03, 0.05); B(c0, c1, top - 0.092, top - 0.062, 0.026); B(c0, c1, top - 0.122, top - 0.11, 0.014);
    const e0 = r0 + (d0 ? 0.075 : 0), e1 = r1 - (d1 ? 0.075 : 0), len = e1 - e0;
    if (len < 0.3) continue;
    B(e0, e1, y0 + 0.885, y0 + 0.93, 0.02); B(e0, e1, y0 + 0.87, y0 + 0.885, 0.011);           // chair rail
    if (len < 0.56) continue;
    const mg = 0.13, gap = 0.12, n = Math.max(1, Math.round((len - 2 * mg + gap) / 1.12)), pw = (len - 2 * mg - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
      const x0 = e0 + mg + i * (pw + gap), x1 = x0 + pw;
      frame(x0, x1, y0 + 0.24, y0 + 0.79);
      frame(x0, x1, y0 + 1.17, top - 0.25);
    }
  }
}

// ================================================================== FURNISHING
function furnish(ctx, L) {
  const { sg } = ctx;
  const Z = L.zones, y = L.y;
  ctx.curLevel = L;
  const g = new THREE.Group(); g.position.y = y; sg.add(g);
  // service rooms and the kitchen first: they decide where the washing machine goes (utility room / kitchen run),
  // the hall then gets a laundry cupboard if neither could take it
  for (const r of Z.svc) {
    if (r.kind === 'bath') furnishBath(ctx, L, g, r);
    else if (r.kind === 'dressing') furnishDressing(ctx, L, g, r);
    else furnishStorage(ctx, L, g, r);
  }
  if (Z.kitchenRoom) furnishKitchenBack(ctx, L, g, Z.kitchenRoom);
  if (Z.kitFront) furnishKitchenFront(ctx, L, g, Z.kitFront);
  if (Z.hall) furnishHall(ctx, L, g, Z.hall);
  if (Z.livRoom) (Z.livRoom.mid ? furnishLivingMid : furnishLiving)(ctx, L, g, Z.livRoom);
  Z.bedRooms.forEach((r, i) => furnishBedroom(ctx, L, g, r, i));
}
// Motorised curtains for a room's glazing: registers the group (its wall switch is placed after furnishing).
function motorCurtains(ctx, L, g, r, w, u, v, y, ref) {
  const id = 'cur' + L.lv + '-' + ctx.curtains.length;
  put(g, F.motorCurtains(ctx.m, { w, h: y - 0.04, id }), u, v, '-v', y);
  ctx.curtains.push({ id, level: L.lv, room: r, kind: r.kind, roomName: r.name, u, v, y: L.y + y, ref });
}
// a wall item: keeps wall switches clear of it (plan position of its centre on the wall face, half-length along the wall)
function busy(ctx, L, u, v, face, half, y0, y1) { ctx.busy.push({ lv: L.lv, u, v, face, half, y0, y1 }); }

function hang(ctx, g, obj, u, yTop, v, face) {  // wall items (art / mirrors) — skipped in the cutaway
  if (ctx.cut) return null;
  return put(g, obj, u, v, face, yTop);
}
function artOn(ctx, g, u, v, face, w, h, i, yc = 1.55) {
  const a = F.artFrame(ctx.m, { w, h, i });
  if (ctx.curLevel) busy(ctx, ctx.curLevel, u, v, face, w / 2 + 0.05, yc - h / 2 - 0.08, yc + h / 2);
  return hang(ctx, g, a, u, yc + h / 2, v, face);
}

function furnishHall(ctx, L, g, r) {
  const { P, m } = ctx, Z = L.zones, e = P.entry;
  const [a0, b0, a1, b1] = clearRect(P, { rect: r.rect });        // the entry part [hall | band depth]
  const w = a1 - a0, d = b1 - b0;
  // is that side of the hall a plain wall (no door in it, not the entrance wall, not open to the kitchen)?
  const plain = (left) => {
    const edge = left ? r.rect[0] : r.rect[2], k = Z.kitchenRoom;
    if (k && Math.abs((left ? k.rect[2] : k.rect[0]) - edge) < 1e-3) return false;
    if (e.wall === (left ? 'left' : 'right')) return false;
    return !Z.svc.some(s => s.door && s.door.wall !== 'front' && Math.abs(s.door.u - edge) < 0.06);
  };
  const needLaundry = !ctx.laundry && !ctx.cut;
  // built-in coat wardrobe (and the laundry cupboard) along a side wall, from the entrance wall inwards
  // a door in the front wall of the band within reach of that side wall (a bedroom door off the corridor, a
  // bathroom entered from the front): the storage stops short of it
  const doorBy = (left) => (L.backWallGaps || []).some(([g0, g1, gh]) => gh < 50 && (left ? g0 < a0 + 1.0 && g1 > a0 : g1 > a1 - 1.0 && g0 < a1));
  const wardrobeOn = (left) => {
    const u = left ? a0 + 0.3 : a1 - 0.3, face = left ? '+u' : '-u', vEnd = doorBy(left) ? b1 - 0.95 : b1 - 0.05;
    let v0 = b0 + 0.05;
    if (needLaundry && d > 1.6 && vEnd - b0 >= 0.7) { put(g, F.laundryTower(m, { h: ctx.tallH, cabinet: true }), left ? a0 + 0.32 : a1 - 0.32, b0 + 0.36, face); ctx.laundry = 'hall'; v0 = b0 + 0.71; }
    const len = Math.min(vEnd - v0, 2.0);
    if (len > 0.85) put(g, F.wardrobe(m, { len, h: ctx.tallH, kind: 'hall', sliding: true }), u, v0 + len / 2, face);
  };
  const benchOn = (left) => {
    const bench = new THREE.Group(); FX.box(bench, 0.9, 0.06, 0.36, m.wood, 0, 0.42, 0); for (const sx of [-1, 1]) FX.box(bench, 0.04, 0.42, 0.34, m.metal, sx * 0.42, 0, 0);
    FX.cyl(bench, 0.12, 0.12, 0.07, m.cushionA, 0.2, 0.48, 0, 14);
    bench.userData.solidBox = { w: 0.9, d: 0.36, h: 0.5 };
    put(g, bench, left ? a0 + 0.2 : a1 - 0.2, doorBy(left) ? b0 + 0.55 : Math.min(b1 - 0.5, (b0 + b1) / 2 + 0.2), left ? '+u' : '-u');
  };
  if (e.wall === 'back') {
    // the leaf is hinged on the right jamb and parks ~0.5 m to the right of the door centre
    const gapL = e.p - ENTRY_W / 2 - a0, gapR = a1 - (e.p + ENTRY_W / 2);
    if (plain(true) && gapL >= 0.62 && d > 1.2) wardrobeOn(true);
    else if (plain(false) && gapR >= 0.74 && d > 1.2) wardrobeOn(false);
    else if (w > 1.9 && plain(true) && gapL >= 0.45 && d > 1.5) benchOn(true);
    else if (w > 1.9 && plain(false) && gapR >= 0.6 && d > 1.5) benchOn(false);
    else if (!ctx.cut && d > 1.6 && plain(true) && gapL < 0.62) hang(ctx, g, F.mirror(m, { w: 0.6, h: 0.9 }), a0, 1.15, b0 + Math.max(1.25, d / 2), '+u');
  } else {
    // entrance in a side wall: the storage stands against the opposite side of the hall
    const farLeft = e.wall === 'right';
    if (plain(farLeft) && w >= 1.75 && d > 1.2) wardrobeOn(farLeft);
    else if (!ctx.cut && w > 1.0) hang(ctx, g, F.mirror(m, { w: 0.6, h: 0.9 }), (a0 + a1) / 2, 1.15, b0, '+v');
  }
  FX.box(g, Math.max(0.6, Math.min(w - 0.5, 2.2)), 0.008, Math.max(0.8, d - 0.6), m.rug, clamp(e.wall === 'back' ? e.p : (a0 + a1) / 2, a0 + 0.6, a1 - 0.6), 0.0015, (b0 + b1) / 2 + 0.1);
  // bedroom corridor: runner rug
  if (Z.stripRect) {
    const [s0, t0, s1, t1] = Z.stripRect;
    FX.box(g, Math.max(0.5, s1 - s0 - 0.7), 0.008, 0.7, m.rug, (s0 + s1) / 2, 0.0015, (t0 + t1) / 2);
    ctx.lightSpots.push({ u: (s0 + s1) / 2, v: (t0 + t1) / 2, y: L.y, k: 0.5, pri: 4 });
  }
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2, y: L.y, k: 0.6, pri: 3 });
}

function furnishBath(ctx, L, g, r) {
  const { P, m } = ctx;
  const [a0, b0, a1, b1] = clearRect(P, r);
  const w = a1 - a0, d = b1 - b0;
  const style = m.styleId, dr = r.door || {}, front = dr.wall === 'front';
  // s = +1: the door is on / near the low-u wall and the fixtures are laid out from there; −1: mirrored
  const s = dr.wall === 'right' ? -1 : front ? (dr.u - a0 <= a1 - dr.u ? 1 : -1) : 1;
  const U = t => s > 0 ? a0 + t : a1 - t, far = s > 0 ? a1 : a0, toNear = s > 0 ? '-u' : '+u';
  const H = ctx.cut ? 1.05 : 2.0;
  const shower = (t0, t1, dd) => { const u0 = Math.min(U(t0), U(t1)), sw = Math.abs(t1 - t0); put(g, F.shower(m, { w: sw, d: dd, h: H }), u0 + sw / 2, b0, '+v'); ctx.showers.push([g, u0, b0, sw, dd, L]); };
  if (d >= 1.9) {
    // wet zone along the back wall
    if (w >= 2.75) { put(g, F.bathtub(m, { len: 1.7, cut: ctx.cut }), U(0.85), b0, '+v'); shower(1.72, w, 0.9); }
    else if (style === 'milano' || w < 1.62) shower(0, w, 0.95);
    else put(g, F.bathtub(m, { len: Math.min(1.75, w - 0.04), cut: ctx.cut }), (a0 + a1) / 2, b0, '+v');
    if (!front) {
      // vanity on the front wall towards the far side, toilet on the far wall
      const vl = w - 0.95 >= 0.6 ? Math.min(1.4, w - 0.95) : w >= 1.15 ? 0.55 : 0;      // (a slim bathroom: hand basin only)
      if (vl >= 0.55) { const vu = U(w - 0.05 - vl / 2); put(g, F.vanity(m, { len: vl }), vu, b1, '-v'); mirrorAt(ctx, g, vu, b1, '-v', vl); }
      if (w >= 1.5) put(g, F.toilet(m), far, b0 + 1.35, toNear);
      else put(g, F.toilet(m), U(w - 0.3), b0 + 0.97, '+v');                               // too slim to stand across: against the shower end
    } else {
      // door in the front wall: toilet on the far side wall, a short vanity beside the door if the wall has room
      put(g, F.toilet(m), far, b0 + (d >= 2.1 ? 1.4 : 1.3), toNear);
      const freeW = s > 0 ? a1 - (dr.u + DOOR_W / 2 + 0.1) : (dr.u - DOOR_W / 2 - 0.1) - a0, vl = Math.min(1.0, freeW - 0.05);
      if (vl >= 0.6 && d >= 2.1) { const vu = U(w - 0.05 - vl / 2); put(g, F.vanity(m, { len: vl }), vu, b1, '-v'); mirrorAt(ctx, g, vu, b1, '-v', vl); }
    }
    const bm = new THREE.Group(); FX.soft(bm, 0.8, 0.014, 0.5, m.towel2, 0, 0.001, 0, null, { e: [0.08, 0.8, 0.08], seg: 12 }); bm.userData.noSolid = true; put(g, bm, U(Math.min(1.0, w / 2)), b0 + 1.2, '+v');
    if (w > 1.8 && !front) FX.plantSmall(g, m, U(0.2), 0, b1 - 0.2, 0.35, 0.4);
  } else {
    // shallow bath: fixtures along the back wall from the door side: vanity | toilet | shower (a tub if wide)
    const wet = w >= 3.3 ? 1.64 : 0.97;
    const vl = clamp(w - wet - 0.62 - 0.05, 0.55, 1.4);
    let t = 0.02;
    put(g, F.vanity(m, { len: vl }), U(t + vl / 2), b0, '+v'); mirrorAt(ctx, g, U(t + vl / 2), b0, '+v', vl); t += vl + 0.04;
    put(g, F.toilet(m), U(t + 0.3), b0, '+v'); t += 0.62;
    const ww = w - t;
    if (w >= 3.3) put(g, F.bathtub(m, { len: Math.min(1.7, ww - 0.02), cut: ctx.cut }), U(t + ww / 2), b0, '+v');
    else if (ww >= 0.6) shower(t, w, Math.min(0.95, d - 0.45));
  }
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2, y: L.y, k: 0.55, pri: 2 });
}
function mirrorAt(ctx, g, u, v, face, vl) {
  const { m } = ctx;
  if (ctx.cut) return;
  const mw = Math.min(0.9, vl - 0.1), mh = m.fam === 'nordic' ? mw : 0.95;
  put(g, F.mirror(m, { w: mw, h: mh, cabinet: true }), u, v, face, m.fam === 'nordic' ? 1.05 : 1.08);
  if (m.fam !== 'nordic') {
    // pair of sconces left/right of the mirror
    const off = mw / 2 + 0.12;
    const s1 = new THREE.Group(); FX.sconce(s1, m, 0, 0, 0); put(g, s1, 0, 0, face); positionAlong(s1, u, v, face, -off, 1.6);
    const s2 = new THREE.Group(); FX.sconce(s2, m, 0, 0, 0); put(g, s2, 0, 0, face); positionAlong(s2, u, v, face, off, 1.6);
  } else {
    // LED halo behind the round mirror
    const h = new THREE.Group(); FX.torus(h, mw / 2 + 0.01, 0.006, m.led, 0, mh / 2, 0.01, [0, 0, 0], PI * 2, 40);
    FX.fxQuad(h, m.glow, 'disc', [0, mh / 2, 0.014], [mw * 1.7, 0, 0], [0, mh * 1.7, 0]); put(g, h, u, v, face, 1.05);
  }
}
function positionAlong(obj, u, v, face, off, y) {
  const r = FACE[face];
  obj.position.set(u + Math.cos(r) * off, y, v - Math.sin(r) * off);
}
function furnishStorage(ctx, L, g, r) {
  const { P, m } = ctx;
  const [a0, b0, a1, b1] = clearRect(P, r);
  const w = a1 - a0;
  // utility: shelving along the back wall, washer + dryer if wide
  let u = a0 + 0.05;
  if (w >= 0.66 && !ctx.laundry) { put(g, F.laundryTower(m, {}), u + 0.3, b0 + 0.31, '+v'); ctx.laundry = 'storage'; u += 0.65; }
  const sw = a1 - u - 0.05;
  if (sw > 0.4) put(g, F.bookshelf(m, { w: sw, h: ctx.cut ? 1.05 : 2.1 }), u + sw / 2, b0 + 0.17, '+v');
  else if (sw > 0.22) {   // slim shelf: detergents, iron, laundry basket
    const sh = new THREE.Group();
    for (const y of [0.0, 0.6, 1.2]) FX.box(sh, sw, 0.02, 0.28, m.woodLight, 0, y + 0.35, 0);
    for (const sx of [-1, 1]) FX.box(sh, 0.015, 1.6, 0.28, m.metal, sx * (sw / 2 - 0.008), 0, 0);
    FX.cyl(sh, 0.12, 0.1, 0.3, m.rattan, 0, 0, 0.0, 16);
    sh.userData.solidBox = { w: sw, d: 0.3, h: 1.6 };
    put(g, sh, u + sw / 2, b0 + 0.16, '+v');
  }
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2, y: L.y, k: 0.3, pri: 6 });
}
function furnishDressing(ctx, L, g, r) {
  const { P, m } = ctx;
  const [a0, b0, a1, b1] = clearRect(P, r);
  put(g, F.wardrobe(m, { len: a1 - a0 - 0.02, h: ctx.tallH, kind: 'dress', sliding: a1 - a0 > 1.9, seed: 2 }), (a0 + a1) / 2, b0 + 0.3, '+v');
  const ot = new THREE.Group(); FX.cyl(ot, 0.28, 0.28, 0.42, m.fabricAccent, 0, 0, 0, 24); ot.userData.solidBox = { w: 0.56, d: 0.56, h: 0.45 };
  if (b1 - b0 > 1.9 && a1 - a0 > 1.5) put(g, ot, (a0 + a1) / 2 + (r.door && r.door.wall === 'left' ? 0.3 : r.door && r.door.wall === 'right' ? -0.3 : 0), (b0 + 0.6 + b1) / 2, '+v');
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2, y: L.y, k: 0.3, pri: 6 });
}

function furnishKitchenBack(ctx, L, g, r) {
  const { P, m } = ctx;
  const [a0, b0, a1, b1] = clearRect(P, r);
  const len = a1 - a0;
  const kr = put(g, F.kitchenRun(m, len, { tall: ctx.cut ? 'none' : (r.tall || 'left'), ceiling: CH, washer: !ctx.laundry, uppers: !ctx.cut, hood: !ctx.cut, cut: ctx.cut }), (a0 + a1) / 2, b0 + 0.31, '+v');
  if (kr.userData.hasWasher) ctx.laundry = 'kitchen';
  ctx.kitchen = { u0: a0, u1: a1, v: b1 };
  // pendant pair over the counter zone
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2 + 0.2, y: L.y, k: 0.7, pri: 2 });
}
function furnishKitchenFront(ctx, L, g, r) {
  const { P, m } = ctx;
  const [a0, b0, a1, b1] = clearRect(P, r);
  if (r.front === 'back') {
    // along the back wall of the living (the front wall of the service band), fronts facing the room
    const u0 = r.rect[0] <= P.ul + 1e-6 ? a0 : r.rect[0] + 0.02, u1 = r.rect[2] >= P.ur - 1e-6 ? a1 : r.rect[2] - 0.02, len = u1 - u0;
    const kr = put(g, F.kitchenRun(m, len, { tall: ctx.cut ? 'none' : (r.tall || 'right'), ceiling: CH, washer: !ctx.laundry && len >= 2.2, uppers: !ctx.cut, cut: ctx.cut }), (u0 + u1) / 2, b0 + 0.31, '+v');
    if (kr.userData.hasWasher) ctx.laundry = 'kitchen';
    ctx.kitchen = { u0, u1, v: b0 + 0.62 };
  } else {
    // along a side wall of the living, fronts facing into the room; tall units at the back end
    const len = r.rect[3] - r.rect[1] - 0.04, vm = (r.rect[1] + r.rect[3]) / 2, hi = r.kside === 'u1';
    const kr = put(g, F.kitchenRun(m, len, { tall: ctx.cut || r.tall === 'none' ? 'none' : hi ? 'left' : 'right', ceiling: CH, washer: !ctx.laundry && len >= 2.2, uppers: !ctx.cut, cut: ctx.cut }), hi ? a1 - 0.31 : a0 + 0.31, vm, hi ? '-u' : '+u');
    if (kr.userData.hasWasher) ctx.laundry = 'kitchen';
    ctx.kitchenSide = { side: r.kside, u: hi ? a1 - 0.62 : a0 + 0.62, v0: r.rect[1], v1: r.rect[3] };
  }
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2, y: L.y, k: 0.6, pri: 2 });
}

// Free stretch of [u0, u1] along the living's back wall that no opening (hall, bathroom door) leads into; the opening
// of the kitchen itself does not count. Returns the widest one.
function freeBack(L, u0, u1) {
  const k = L.zones.kitchenRoom, cuts = [];
  for (const [g0, g1] of L.backWallGaps || []) {
    if (k && g0 >= k.rect[0] - 0.01 && g1 <= k.rect[2] + 0.01) continue;
    cuts.push([g0 - 0.3, g1 + 0.3]);
  }
  cuts.sort((p, q) => p[0] - q[0]);
  let best = null, s = u0;
  const take = (a, b) => { if (b - a > 0.05 && (!best || b - a > best[1] - best[0])) best = [a, b]; };
  for (const [c0, c1] of cuts) { if (c1 <= u0 || c0 >= u1) continue; take(s, Math.min(c0, u1)); s = Math.max(s, c1); }
  take(s, u1);
  return best;
}
function furnishLiving(ctx, L, g, r) {
  const { P, m } = ctx, Z = L.zones;
  const [a0, b0, a1, b1] = clearRect(P, r);
  const kf = Z.kitFront;
  const zb0 = (kf && kf.front === 'back') ? kf.rect[3] + 0.2 : b0;
  const ks = ctx.kitchenSide || null;
  // furnishable width: without the kitchen run along a side wall and the lane to a balcony door in a side wall
  let z0 = a0, z1 = a1;
  if (ks) { if (ks.side === 'u1') z1 = ks.u - 0.25; else z0 = ks.u + 0.25; }
  if (r.sideDoor === 'left') z0 = Math.max(z0, a0 + 0.95);
  if (r.sideDoor === 'right') z1 = Math.min(z1, a1 - 0.95);
  // where the hall opens straight into the room, the first metre in front of the opening stays clear
  const hallHere = !(kf && kf.front === 'back') && overlap(r.hallU[0], r.hallU[1], z0, z1) > 0.3;
  let zbL = hallHere ? Math.max(zb0, b0 + 1.0) : zb0;
  if (hallHere && b1 - 0.5 - zbL < 2.0) {
    // shallow room: rather than moving back, the furniture keeps to the part of the width beside the opening
    const fb = freeBack(L, z0, z1);
    if (fb && fb[1] - fb[0] >= 1.9) { z0 = fb[0]; z1 = fb[1]; zbL = zb0; }
  }
  const w = z1 - z0, d = b1 - zb0, vEnd = b1 - (P.front ? 0.5 : 0.08);   // keep a walking aisle along the windows
  const kitBack = ctx.kitchen && !(kf && kf.front === 'back') ? ctx.kitchen : null;
  const wantIsl = ctx.opts.island !== false && kitBack && !ks;
  const isWall = side => (side === 'u1' ? z1 === a1 : z0 === a0);
  const solidWall = side => isWall(side) && r.glazed !== side;
  let tv = Z.tvSide;
  if (!isWall(tv) && isWall(tv === 'u1' ? 'u0' : 'u1')) tv = tv === 'u1' ? 'u0' : 'u1';
  const other = tv === 'u1' ? 'u0' : 'u1';
  ctx.slideU = clamp((tv === 'u1' ? z1 - 1.15 : z0 + 1.15), a0 + 0.6, a1 - 0.6);
  ctx.slideLane = [ctx.slideU - 0.6, ctx.slideU + 0.6];
  if (!P.front) {
    // no windows in the front wall (a flat lit from its side wall): the sofa stands against that wall, facing the room
    const len = clamp(w - 0.2, 1.6, 2.5), room = b1 - Math.max(zbL, zb0);
    if (w >= len + 0.1 && room >= 1.9) {
      const uc = r.sideDoor === 'left' ? z1 - len / 2 - 0.1 : r.sideDoor === 'right' ? z0 + len / 2 + 0.1 : (z0 + z1) / 2;
      put(g, F.sofa(m, { len }), uc, b1 - 0.52, '-v');
      if (room >= 2.9) { put(g, F.coffeeTable(m), uc, b1 - 1.6, '+v'); put(g, F.rug(m, { w: Math.min(w - 0.2, len + 0.6), d: 2.0 }), uc, b1 - 1.25, '+v'); }
      if (!ctx.cut) artOn(ctx, g, uc, b1, '-v', Math.min(1.4, len - 0.4), 0.8, 0, 1.75);
      ctx.lightSpots.push({ u: uc, v: b1 - 1.2, y: L.y, k: 1.0, pri: 0 });
    }
    ctx.livingEye = { u: (z0 + z1) / 2, v: zb0 + 0.2 };
  } else if (w < 2.5 || vEnd - zbL < 2.0 || !isWall(tv)) {
    // too small for a lounge with a TV wall: a sofa with its back to the room (or to the kitchen run), facing the windows
    const back = (kf && kf.front === 'back') ? Math.max(b0, kf.rect[1] + 1.42) : zbL + (kitBack ? 1.0 : 0.1);
    nook(ctx, L, g, [z0, Math.max(back, vEnd - 2.7), z1, vEnd], (r.hallU[0] + r.hallU[1]) / 2, !!r.sideDoor);
  } else if (d >= 4.3) {
    // dining at the back (by the kitchen, clear of the openings in the back wall), lounge by the windows; where the
    // run is long enough the kitchen island takes the left part of it and the table moves along (see islandBeside)
    const dd = 2.0, fb = freeBack(L, r.mouth === 'u0' ? Math.max(z0, a0 + 1.0) : z0, r.mouth === 'u1' ? Math.min(z1, a1 - 1.0) : z1) || [z0, z0];
    // (openings all along the back wall: the table stands a metre into the room, across the width, if the depth takes it)
    const wide = fb[1] - fb[0] >= 2.2, dv0 = wide ? zb0 : zbL, room = vEnd - (dv0 + dd + 0.35) >= 2.3;
    const dz = wide ? [fb[0], zb0, fb[1], zb0 + dd] : [z0, dv0, z1, dv0 + dd];
    if (wide || room) dining(ctx, L, g, dz, wide ? kitBack : null, wide && wantIsl && kitBack.u0 >= fb[0] - 0.4 && kitBack.u1 <= fb[1] + 0.4 ? islandBeside(ctx, L, g, dz, kitBack) : null);
    lounge(ctx, L, g, [z0, wide || room ? dv0 + dd + 0.35 : Math.max(zbL, vEnd - 3.3), z1, vEnd], tv, solidWall(other));
  } else if (w >= 6.2) {
    // side by side: the lounge at the end away from the kitchen (TV on that end wall), dining next to the kitchen
    const lo = Z.flip ? 'u1' : 'u0', end = solidWall(lo) ? lo : tv;
    const wl = Math.max(3.7, w * 0.54);
    if (end === 'u0') {
      lounge(ctx, L, g, [z0, zbL + 0.55, z0 + wl, vEnd], 'u0', false);
      dining(ctx, L, g, [z0 + wl + 0.2, zbL + 0.55, z1, vEnd], null);
    } else {
      lounge(ctx, L, g, [z1 - wl, zbL + 0.55, z1, vEnd], 'u1', false);
      dining(ctx, L, g, [z0, zbL + 0.55, z1 - wl - 0.2, vEnd], null);
    }
  } else {
    lounge(ctx, L, g, [z0, Math.max(zbL, vEnd - 3.3), z1, vEnd], tv, solidWall(other));
  }
  if (!ctx.cut && P.front) motorCurtains(ctx, L, g, r, a1 - a0 - 0.2, (a0 + a1) / 2, b1 - 0.2, CH - 0.15, [(r.hallU[0] + r.hallU[1]) / 2, Z.vb]);
  ctx.balconyU = clamp((a0 + a1) / 2, 1.2, P.W - 1.2);
}
// Small sitting corner: a sofa (or an armchair) with its back to the room, facing the windows.
function nook(ctx, L, g, [u0, v0, u1, v1], passU, hasLane = false) {
  const { m } = ctx, zw = u1 - u0, zd = v1 - v0;
  if (zw < 1.3 || zd < 1.2) return;
  // a passage of 0.85 m stays beside it, on the side people come from (passU) — unless the zone already leaves a lane
  const len = clamp(zw - (hasLane ? 0.15 : 0.95), 1.6, 2.3), fits = zw - len >= (hasLane ? 0.1 : 0.9) && zd >= 1.5;
  const uc = !fits ? (u0 + u1) / 2 : (passU ?? u0) <= (u0 + u1) / 2 ? u1 - len / 2 - 0.05 : u0 + len / 2 + 0.05;
  if (fits) {
    put(g, F.sofa(m, { len }), uc, v0 + 0.52, '+v');
    if (zd >= 2.3) { put(g, F.coffeeTable(m), uc, v0 + 1.55, '+v'); put(g, F.rug(m, { w: Math.min(zw - 0.3, len + 0.6), d: Math.min(2.2, zd - 0.2) }), uc, v0 + 1.2, '+v'); }
  } else if (zw >= 1.7) put(g, F.armchair(m), (passU ?? u0) <= uc ? u1 - 0.55 : u0 + 0.55, v0 + 0.5, '+v');
  ctx.lightSpots.push({ u: uc, v: (v0 + v1) / 2, y: L.y, k: 0.9, pri: 0 });
  ctx.livingEye = { u: u0 + 0.4, v: v0 };
}
// The open kitchen-living of a narrow deep flat (between the service band and the bedrooms): furniture stays out of
// the lane from the hall to the bedroom doors.
function furnishLivingMid(ctx, L, g, r) {
  const { P, m } = ctx, Z = L.zones;
  const [a0, b0, a1, b1] = clearRect(P, r);
  const kf = Z.kitFront, ks = ctx.kitchenSide || null;
  const zb0 = (kf && kf.front === 'back') ? kf.rect[3] + 0.15 : b0 + 0.1, v1 = b1 - 0.12;
  let z0 = a0, z1 = a1;
  if (ks) { if (ks.side === 'u1') z1 = ks.u - 0.2; else z0 = ks.u + 0.2; }
  if (r.sideDoor === 'left') z0 = Math.max(z0, a0 + 0.95);
  if (r.sideDoor === 'right') z1 = Math.min(z1, a1 - 0.95);
  const pts = [(r.hallU[0] + r.hallU[1]) / 2, ...(r.frontDoors || [])];
  const l0 = Math.min(...pts) - 0.55, l1 = Math.max(...pts) + 0.55;
  const parts = [[z0, Math.min(z1, l0)], [Math.max(z0, l1), z1]].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  const [f0, f1] = parts[0], fw = f1 - f0, fd = v1 - zb0;
  if (fw >= 3.0 && fd >= 2.6) lounge(ctx, L, g, [f0, zb0, f1, v1], f1 === a1 ? 'u1' : 'u0', f1 === a1 ? f0 === a0 : f1 === a1, true);
  else if (fw >= 2.2 && fd >= 1.7) dining(ctx, L, g, [f0, zb0, f1, v1], null);
  else if (fw >= 1.3 && fd >= 1.9 && (f0 === a0 || f1 === a1)) {
    // a two-seater against the side wall, looking across the room
    const left = f0 === a0, len = clamp(fd - 0.2, 1.6, 2.2);
    if (fw >= 1.0) put(g, F.sofa(m, { len }), left ? a0 + 0.52 : a1 - 0.52, zb0 + 0.1 + len / 2, left ? '+u' : '-u');
    ctx.lightSpots.push({ u: (f0 + f1) / 2, v: (zb0 + v1) / 2, y: L.y, k: 0.9, pri: 0 });
  } else if (fw >= 1.1 && fd >= 1.1) put(g, F.armchair(m), (f0 + f1) / 2, zb0 + Math.min(0.6, fd / 2), '+v');
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2, y: L.y, k: 0.9, pri: 0.2 });
  if (!ctx.livingEye) ctx.livingEye = { u: a0 + 0.4, v: b0 + 0.3 };
}
// Lounge zone z = [u0, v0, u1, v1]; TV on side tvOn ('u0' | 'u1'); farIsWall: the opposite side is a real wall;
// inner: the zone does not end at the windows (no plant / armchair on that edge).
function lounge(ctx, L, g, z, tvOn, farIsWall, inner = false) {
  const { m } = ctx;
  const [u0, v0, u1, v1] = z, zw = u1 - u0, zd = v1 - v0, s = m.fam;
  const t = tvOn === 'u1' ? 1 : -1, tvWall = t > 0 ? u1 : u0, farWall = t > 0 ? u0 : u1;
  const toTV = t > 0 ? '+u' : '-u', fromTV = t > 0 ? '-u' : '+u';
  const lc = (v0 + v1) / 2;
  const sofaLen = clamp(zd - 0.7, 1.9, 2.5);
  const floating = zw >= 4.6 || !farIsWall;
  const sofaU = floating ? tvWall - t * Math.min(3.05, zw - 0.55) : farWall + t * 0.52;
  put(g, F.sofa(m, { len: sofaLen }), sofaU, lc, toTV);
  const ctU = sofaU + t * 1.0;
  if (zw >= 3.0) put(g, F.coffeeTable(m), ctU, lc, s === 'milano' ? '+u' : '+v');
  const rugU = Math.min(3.0, Math.abs(tvWall - sofaU) + 0.1), rugV = Math.min(sofaLen + 0.9, zd + 0.2);
  put(g, F.rug(m, { w: rugV, d: rugU }), sofaU + t * (rugU / 2 - 0.35), lc, '+u');
  const tvLen = Math.min(2.2, zd - 0.45);
  // paris: where the wall behind the sofa is free the Carrara chimneypiece stands there under a tall gilt overmantel
  // mirror (and the TV wall gets its console); otherwise it stands against the marble chimney breast under the TV
  const sblP = Math.min(1.8, zd - 0.4);
  const mantelFar = m.styleId === 'paris' && !ctx.cut && farIsWall && floating && Math.abs(farWall - sofaU) > 1.1 && sblP >= 1.45;
  if (m.styleId === 'paris' && !mantelFar) put(g, F.fireplace(m, { w: clamp(Math.min(3.2, zd + 0.3) - 1.25, 1.4, 1.7), tv: true }), tvWall - t * 0.232, lc, fromTV);
  else put(g, F.tvUnit(m, { len: tvLen }), tvWall - t * 0.3, lc, fromTV);
  if (!ctx.cut) { put(g, F.tv(m, { w: 1.45, live: true, glowZ: s === 'riviera' ? -0.012 : -0.043 }), tvWall - t * 0.1, lc, fromTV, 1.0); (ctx.tvRooms ||= []).push('living'); }
  featureWall(ctx, g, tvWall, lc, fromTV, Math.min(3.2, zd + 0.3));
  busy(ctx, L, tvWall, lc, fromTV, Math.min(3.2, zd + 0.3) / 2 + 0.05, 0, CH);
  // armchair facing the sofa from the window side (only in deep lounges, keeps the lane free)
  if (zd >= 3.3 && zw >= 3.75 && !inner) put(g, F.armchair(m), ctU - t * 0.1, v1 - 0.35, PI);
  // floor lamp behind the window end of the sofa, side table at the back end against the far wall (off the lanes)
  // (the milano arc lamp reaches over the sofa, towards the TV)
  const lampF = s === 'milano' ? (t > 0 ? '+v' : '-v') : '+v';
  if (floating) put(g, F.floorLamp(m), sofaU - t * 0.35, Math.min(v1 - 0.1, lc + sofaLen / 2 + 0.05), lampF);
  else put(g, F.floorLamp(m), sofaU - t * 0.25, Math.min(v1 - 0.1, lc + sofaLen / 2 + 0.3), lampF);
  if (!floating && lc - sofaLen / 2 - 0.3 > v0 + 0.25) put(g, F.sideTable(m), sofaU - t * 0.1, lc - sofaLen / 2 - 0.3, '+v');
  if (!inner) put(g, F.plant(m, { h: 1.7, seed: 4 }), tvWall - t * 0.3, v1 + 0.2, '+v');       // facade corner of the TV wall
  if (farIsWall && !floating) artOn(ctx, g, farWall, lc, toTV, 1.1, 0.8, 0, 1.7);
  else if (farIsWall && Math.abs(farWall - sofaU) > 1.1) {
    if (mantelFar) { put(g, F.fireplace(m, { w: clamp(sblP - 0.1, 1.4, 1.6), mirror: true, ceil: CH }), farWall + t * 0.172, lc, toTV); busy(ctx, L, farWall, lc, toTV, 0.95, 0, 2.5); }
    else {
      const sbl = Math.min(1.8, zd - 0.4); halo(ctx, put(g, F.sideboard(m, { len: sbl }), farWall + t * 0.24, lc, toTV), -sbl / 2 + 0.25, -0.235, 1.2);
      if (m.styleId === 'paris') { hang(ctx, g, F.mirror(m, { w: 0.95, h: 1.35 }), farWall, 0.98, lc, toTV); busy(ctx, L, farWall, lc, toTV, 0.55, 0.9, 2.4); }   // tall arched brass mirror over the sideboard
      else artOn(ctx, g, farWall, lc, toTV, 1.2, 0.9, 0, 1.8);
    }
  }
  ctx.lightSpots.push({ u: (sofaU + tvWall) / 2, v: lc, y: L.y, k: 1.0, pri: 0 });
  ctx.livingEye = { u: farWall + t * 0.6, v: v0 };
  return { sofaU, t, back: sofaU - t * 0.52 };       // back: the far side of the sofa (and of the lamp beside it)
}
// ---------------- kitchen island (kitchen along the entrance wall)
const ISL_D = 0.86, ISL_AISLE = 0.95;
// Island of the given u-range [uL, uR] (≥ 1.4 m), parallel to the run and 0.95 m in front of it, centred on `uc` as far
// as the range allows; worktop + sink towards the run, stools towards the living.
function placeIsland(ctx, L, g, uL, uR, uc) {
  const { m, P } = ctx, len = Math.min(2.4, Math.floor((uR - uL) * 20 + 1e-6) / 20);
  if (len < 1.4) return null;
  const u = clamp(uc ?? (uL + uR) / 2, uL + len / 2, uR - len / 2), v0 = P.vc + 0.63 + ISL_AISLE, v = v0 + ISL_D / 2;
  if (v + ISL_D / 2 + 0.8 > L.zones.vb + 2.0) return null;        // shallow band: no room in front of the run
  put(g, F.island(m, { len, depth: ISL_D }), u, v, '+v');
  ctx.island = { u: +u.toFixed(2), v: +v.toFixed(2), len, depth: ISL_D, level: L.lv, u0: +(u - len / 2).toFixed(3), u1: +(u + len / 2).toFixed(3) };
  return ctx.island;
}
// Flats with the dining table in front of the run: the island stands on the left part of the run, the table to its
// right with a 0.9 m passage between them (each end of the island stays open, 0.95 m to the wall on the left).
// Returns the dining override {tl, tu} or null when the run is too short for both.
function islandBeside(ctx, L, g, z, kit) {
  const [u0, , u1, ] = z, zw = u1 - u0;
  if (zw < 2.2) return null;
  const narrow = zw < 4.4, tl0 = narrow ? clamp(zw - 1.85, 1.2, 1.6) : clamp(zw - 1.4, 1.2, 2.0), uL = Math.max(u0, kit.u0) + ISL_AISLE;
  for (const tl of [...new Set([tl0, Math.min(tl0, 1.6), 1.2])]) {
    const tuMax = u1 - 0.85 - tl / 2, room = tuMax - tl / 2 - 0.05 - 0.9 - uL;        // island length that still fits
    if (room < 1.4) continue;
    const len = Math.min(2.4, Math.floor(room * 20 + 1e-6) / 20);
    const tu0 = narrow ? tuMax : clamp((Math.max(u0, kit.u0) + Math.min(u1, kit.u1)) / 2, u0 + tl / 2 + 0.8, u1 - tl / 2 - 0.8);
    const tu = Math.min(tuMax, Math.max(tu0, uL + len + 0.9 + 0.05 + tl / 2)), uR = tu - tl / 2 - 0.05 - 0.9;
    if (!placeIsland(ctx, L, g, uL, uR)) continue;
    return { tl, tu };
  }
  return null;
}
function dining(ctx, L, g, z, kitBack, ov = null) {
  const { m } = ctx;
  const [u0, v0, u1, v1] = z, zw = u1 - u0, zd = v1 - v0;
  if (zw < 2.2 || zd < 1.7) return;
  const along = zw >= zd;                               // table axis along u (usual) or along v
  const narrow = (along ? zw : zd) < 4.4;
  const tl = ov ? ov.tl : narrow ? clamp((along ? zw : zd) - 1.85, 1.2, 1.6) : clamp((along ? zw : zd) - 1.4, 1.2, 2.0), tw = narrow || tl < 1.7 ? 0.85 : 0.95;
  let tu = (u0 + u1) / 2, tv = (v0 + v1) / 2;
  if (kitBack && along) tu = narrow ? u1 - 0.85 - tl / 2 : clamp((Math.max(u0, kitBack.u0) + Math.min(u1, kitBack.u1)) / 2, u0 + tl / 2 + 0.8, u1 - tl / 2 - 0.8);
  if (ov) tu = ov.tu;                                   // moved along the run to leave the island its place
  if (along && kitBack) tv = clamp(v0 + 1.2, v0 + 0.95, v1 - 0.8);
  const grpT = new THREE.Group();
  put(grpT, F.diningTable(m, { len: tl, width: tw }), 0, 0, '+v');
  const nC = Math.max(1, Math.floor(tl / 0.6));
  for (let i = 0; i < nC; i++) {
    const cu = -tl / 2 + tl / nC * (i + 0.5);
    for (const side of [-1, 1]) {
      put(grpT, F.diningChair(m), cu, side * (tw / 2 + 0.12), side < 0 ? '+v' : '-v');
      put(grpT, F.tableSetting(m, { y: 0.76 }), cu, side * (tw / 2 - 0.2), side < 0 ? '-v' : '+v');
    }
  }
  if (!ctx.cut) {
    put(grpT, F.pendant(m, { kind: 'dining', drop: 0.85, len: Math.min(1.2, tl - 0.3) }), 0, 0, '+v', CH);
    FX.fxFlat(grpT, m.glowFaint, 'rect', 0, 0.762, 0, tl + 0.3, tw + 0.25);
    FX.fxFlat(grpT, m.glowFaint, 'disc', 0, 0.006, 0, tl + 2.2, tw + 2.2);
  }
  grpT.userData.solidBox = { w: tl + 0.1, d: tw + 0.25, h: 0.8 };
  put(g, grpT, tu, tv, along ? '+v' : '+u');
  ctx.lightSpots.push({ u: tu, v: tv, y: L.y, k: 0.8, pri: 1 });
  ctx.diningAt = { u: tu, v: tv };
}
function featureWall(ctx, g, uWall, vc, face, len) {
  const { m } = ctx;
  if (ctx.cut) return;
  const s = m.fam, H = CH - 0.02, grp = new THREE.Group();
  if (m.styleId === 'paris') {
    // chimney-breast of book-matched Carrara (plinth, brass-edged slab, stepped marble crown) behind the TV, flanked by
    // boiserie bays with tall antiqued-mirror panels in brass frames and globe sconces
    const Hv = CH - 0.16, mw = Math.min(len - 0.1, clamp(len - 1.25, 1.4, 1.7) + 0.22), sw = (len - mw) / 2, M = m.moulding;
    FX.box(grp, len, Hv, 0.014, M, 0, 0, 0.007);
    FX.box(grp, mw, Hv - 0.02, 0.06, m.marble, 0, 0, 0.03);
    FX.box(grp, mw + 0.07, 0.11, 0.085, m.marble, 0, 0, 0.0425);
    FX.box(grp, mw + 0.05, 0.03, 0.08, m.marble, 0, Hv - 0.13, 0.04); FX.box(grp, mw + 0.1, 0.04, 0.1, m.marble, 0, Hv - 0.1, 0.05); FX.box(grp, mw + 0.03, 0.06, 0.07, m.marble, 0, Hv - 0.06, 0.035);
    for (const sx of [-1, 1]) FX.box(grp, 0.012, Hv - 0.24, 0.066, m.brass, sx * (mw / 2 - 0.05), 0.11, 0.033);
    FX.box(grp, mw - 0.1, 0.012, 0.066, m.brass, 0, Hv - 0.142, 0.033);
    FX.mouldFrame(grp, m.brass, 0, 0.975, 1.0 + 1.45 * 0.565 + 0.025, 1.5, 0.07, 0.022, 0.02);     // the TV sits in a brass picture frame
    if (sw > 0.36) for (const sx of [-1, 1]) {
      const x = sx * (mw / 2 + sw / 2 + 0.02), pw = Math.min(0.62, sw - 0.2);
      FX.mouldFrame(grp, M, x, 0.2, 0.8, pw + 0.06, 0.02, 0.026, 0.012);
      FX.box(grp, pw + 0.1, 0.04, 0.03, M, x, 0.88, 0.02);
      FX.box(grp, pw, Hv - 1.42, 0.006, m.mirror, x, 1.08, 0.017);
      FX.mouldFrame(grp, m.brass, x, 1.06, Hv - 0.32, pw + 0.04, 0.022, 0.02, 0.016);
      FX.mouldFrame(grp, M, x, 1.0, Hv - 0.26, pw + 0.16, 0.02, 0.026, 0.012);
      if (pw > 0.36) FX.sconce(grp, m, x, 1.68, 0.02);
    }
  } else if (m.styleId === 'monaco') {
    // Art-Deco panelling: fluted walnut bays framed by polished brass pilasters, a brass plinth band and a stepped
    // brass crown; a hidden LED behind the crown grazes the reeds
    const bays = Math.max(2, Math.round(len / 0.75)), bw = len / bays, n = Math.max(6, Math.round((bw - 0.05) / 0.055));
    FX.box(grp, len, H, 0.02, m.woodDark, 0, 0, 0.01);
    for (let b = 0; b < bays; b++) {
      const x0 = -len / 2 + b * bw + 0.025, w = bw - 0.05;
      for (let i = 0; i < n; i++) FX.cyl(grp, 0.026, 0.026, H - 0.3, m.woodDark, x0 + (i + 0.5) * w / n, 0.16, 0.026, 10);
    }
    for (let b = 0; b <= bays; b++) FX.box(grp, 0.03, H, 0.06, m.brass, -len / 2 + b * bw, 0, 0.03);
    FX.box(grp, len + 0.02, 0.15, 0.065, m.brass, 0, 0, 0.0325);
    FX.box(grp, len + 0.02, 0.025, 0.08, m.brass, 0, H - 0.14, 0.04); FX.box(grp, len + 0.02, 0.02, 0.1, m.brass, 0, H - 0.115, 0.05);
    FX.box(grp, len - 0.05, 0.008, 0.012, m.led, 0, H - 0.15, 0.07);
    FX.fxQuad(grp, m.glow, 'grad', [0, H - 0.7, 0.055], [len, 0, 0], [0, 1.1, 0]);
  } else if (m.styleId === 'kyoto') {
    // oak slats over a smoked-oak backing, floating above a stone-lined LED cove (indirect light up and down)
    const n = Math.round(len / 0.085);
    FX.box(grp, len, H, 0.015, m.woodDark, 0, 0, 0.0075);
    for (let i = 0; i < n; i++) FX.box(grp, 0.045, H - 0.12, 0.035, m.woodLight, -len / 2 + (i + 0.5) * len / n, 0.1, 0.0325);
    FX.box(grp, len, 0.1, 0.16, m.stone, 0, 0, 0.08);
    FX.box(grp, len - 0.04, 0.008, 0.01, m.led, 0, 0.1, 0.15);
    FX.box(grp, len - 0.04, 0.008, 0.01, m.led, 0, H - 0.02, 0.06);
    FX.fxQuad(grp, m.glow, 'grad', [0, H - 0.55, 0.052], [len, 0, 0], [0, 1.1, 0]);
    FX.fxQuad(grp, m.glowFaint, 'grad', [0, 0.65, 0.052], [len, 0, 0], [0, -1.1, 0]);
  } else if (s === 'milano') {
    // fluted walnut panels with a brass shadow gap
    const n = Math.round(len / 0.06);
    for (let i = 0; i < n; i++) FX.cyl(grp, 0.028, 0.028, H, m.woodDark, -len / 2 + (i + 0.5) * len / n, 0.0, 0.02, 10);
    FX.box(grp, len + 0.02, 0.012, 0.05, m.brass, 0, 0.0, 0.025);
  } else if (s === 'nordic') {
    const n = Math.round(len / 0.1);
    FX.box(grp, len, H, 0.012, m.blackMetal, 0, 0, 0.006);
    for (let i = 0; i < n; i++) FX.box(grp, 0.055, H, 0.03, m.woodLight, -len / 2 + (i + 0.5) * len / n, 0, 0.027);
  } else {
    // limewash plaster panel with an arched niche outline
    FX.box(grp, len, H, 0.02, m.wallAccent, 0, 0, 0.01);
    const sh = new THREE.Shape(), aw = Math.min(1.1, len * 0.4), ah = 1.9;
    sh.moveTo(-len / 2, 0); sh.lineTo(len / 2, 0); sh.lineTo(len / 2, H); sh.lineTo(-len / 2, H); sh.lineTo(-len / 2, 0);
    const hole = new THREE.Path(); hole.moveTo(-aw / 2, 0.55); hole.lineTo(aw / 2, 0.55); hole.lineTo(aw / 2, ah - aw / 2); hole.absarc(0, ah - aw / 2, aw / 2, 0, PI, false); hole.lineTo(-aw / 2, 0.55);
    sh.holes.push(hole);
    const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false, curveSegments: 18 });
    const me = new THREE.Mesh(eg, m.wallAccent); me.position.z = 0.02; grp.add(me);
    ctx.tmpGeos.push(eg);
  }
  put(g, grp, uWall, vc, face, 0.0);
}

function furnishBedroom(ctx, L, g, r, idx) {
  const { P, m } = ctx;
  const [a0, b0, a1, b1] = clearRect(P, r);
  const w = a1 - a0, d = b1 - b0;
  const beds = L.zones.bedRooms, master = r === beds.slice().sort((x, y) => y.area - x.area)[0];
  const doors = (r.backDoors && r.backDoors.length ? r.backDoors : [r.doorU]).slice().sort((p, q) => p - q);
  // headboard wall: the side wall away from the room door (+1 = a1, −1 = a0)
  // (a balcony door in a side wall wins: the bed never stands in front of it)
  let hs = r.doorSide === 'u1' ? -1 : 1;
  const headDoor = r.sideDoor === (hs > 0 ? 'right' : 'left');
  if (headDoor) hs = -hs;
  const head = hs > 0 ? a1 : a0, opp = hs > 0 ? a0 : a1;
  const Hd = t => head - hs * t, Op = t => opp + hs * t;          // t metres from the head wall / from the opposite wall
  const toOpp = hs > 0 ? '-u' : '+u', toHead = hs > 0 ? '+u' : '-u';
  const headGlazed = r.glazed === (hs > 0 ? 'u1' : 'u0'), oppGlazed = r.glazed === (hs > 0 ? 'u0' : 'u1');
  r.headSide = hs;
  let bedC;
  // (a room a little under 2.95 m with a balcony door in a side wall still takes the bed across: that keeps the wall free)
  if (w >= 2.95 || (r.sideDoor && w >= 2.7)) {
    const bw = master || w >= 3.3 ? 1.6 : 1.4, free = w - 2.1;
    // bed along u, headboard on the head wall
    const wardrobeBack = w >= 3.4 && d >= bw + 0.66 + 0.6 + 0.5 && doors.length === 1 && !headDoor && (hs > 0 ? doors[0] + 0.45 <= Hd(2.2) : doors[0] - 0.45 >= Hd(2.2));
    // (head on the room-door side — only when a balcony door takes the other wall: the bed moves towards the windows)
    // a door of the back wall that opens onto the bed itself (not beside its foot): the bed moves towards the windows too
    const doorAtBed = headDoor || doors.some(x => hs > 0 ? x + 0.45 > Hd(2.2) : x - 0.45 < Hd(2.2));
    const vmin = wardrobeBack && !doorAtBed ? b0 + 0.62 : doorAtBed ? b0 + clamp(d - bw - 0.05, 0, 0.9) : b0;
    const vcb = doorAtBed ? vmin + bw / 2 : clamp((vmin + b1) / 2, vmin + bw / 2 + 0.5, Math.max(vmin + bw / 2 + 0.5, b1 - bw / 2 - 0.45));
    put(g, F.bed(m, { w: bw }), Hd(1.08), vcb, toOpp);
    bedC = [Hd(1.08), vcb];
    for (const side of [-1, 1]) { const vv = vcb + side * (bw / 2 + 0.33); if (vv - 0.22 > vmin + 0.02 && vv + 0.22 < b1 - 0.05) halo(ctx, put(g, F.nightstand(m, { seed: side + idx }), Hd(0.23), vv, toOpp), -0.07, -0.197, 0.8); }
    if (!headGlazed) { featureWallBed(ctx, g, head, vcb, toOpp, Math.min(bw + 1.2, d - 0.1)); artOn(ctx, g, head, vcb, toOpp, Math.min(1.2, bw), 0.7, 1 + idx, 1.55); }
    let oppUsed = false;
    if (wardrobeBack) {
      // along the back wall, between the door and the head wall
      const wu0 = hs > 0 ? doors[0] + 0.72 : a0 + 0.02, wu1 = hs > 0 ? a1 - 0.02 : doors[0] - 0.72, wlen = Math.min(wu1 - wu0, 2.4);
      if (wlen > 0.9) put(g, F.wardrobe(m, { len: wlen, h: ctx.tallH, seed: idx }), hs > 0 ? wu0 + wlen / 2 : wu1 - wlen / 2, b0 + 0.3, '+v');
    } else if (free >= 1.3 && d > 2.2 && !oppGlazed && !(r.frontDoor && d < bw + 1.6)) { const wl = Math.min(1.8, d - 1.4); put(g, F.wardrobe(m, { len: wl, h: ctx.tallH, seed: idx + 1 }), Op(0.3), b0 + 1.0 + wl / 2, toHead); oppUsed = true; }
    const sideDoor = !!r.sideDoor && oppGlazed;                    // balcony door in the opposite (glazed) wall: keep it clear
    let oppEdge = oppUsed ? 0.65 : 0.02;                            // how far the piece on the opposite wall reaches into the room
    if (!master && !oppUsed && free >= 1.0 && !sideDoor && !r.frontDoor) { put(g, F.desk(m, { len: 1.0 }), Op(0.3), b1 - 0.7, toHead); oppEdge = 0.65; }
    else if (master && !oppUsed && free >= 2.0 && !sideDoor) { put(g, F.armchair(m), Op(0.55), b1 - 0.6, hs > 0 ? 2.4 : -2.4); oppEdge = 1.15; }
    // balcony door lane: between the opposite-wall piece (wardrobe / desk / armchair) and the bed zone
    r.slideU = (Op(oppUsed ? 0.95 : master ? (free >= 2.0 ? 1.2 : 0.3) : 0.75) + Hd(2.15)) / 2;
    // no aisle between the bed and the windows: the door has to be beside the bed
    r.slideLane = b1 - (vcb + bw / 2) >= 0.8 && oppEdge < 0.6 ? null : [Op(oppEdge), b1 - (vcb + bw / 2) >= 0.8 ? head : Hd(2.2)].sort((p, q) => p - q);
    put(g, F.rug(m, { w: Math.min(2.4, bw + 1.2), d: 2.0 }), Hd(1.3), vcb, '+u');
    // master bedroom: a wall TV facing the bed (opposite wall), unless the wardrobe / a window is there
    const tw = 1.1;
    if (master && !ctx.cut && !oppUsed && !oppGlazed && vcb - tw / 2 > b0 + 0.95 && vcb + tw / 2 < b1 - 0.35) {
      put(g, F.tv(m, { w: tw, live: true, glowZ: -0.02 }), Op(0.035), vcb, toHead, 1.05); (ctx.tvRooms ||= []).push('bedroom');
      busy(ctx, L, opp, vcb, toHead, tw / 2 + 0.1, 0.9, 1.75);
      const ledge = new THREE.Group(); FX.box(ledge, 1.3, 0.035, 0.24, s3(m), 0, 0.62, 0.12); FX.bookStack(ledge, m, 2, -0.4, 0.655, 0.12, 41 + idx, 0.2); FX.vase(ledge, m, 0.45, 0.655, 0.12, 0.22, m.ceramic2, false);
      ledge.userData.noSolid = true; put(g, ledge, opp, vcb, toHead);
    } else if (master && !ctx.cut && oppUsed && free - 0.3 - 0.42 - 0.62 >= 0.7) {
      // the wardrobe has the opposite wall: a low media console at the foot of the bed with the TV on a pedestal
      const bu = Hd(2.1 + 0.3 + 0.21), con = F.tvUnit(m, { len: Math.min(1.5, bw + 0.1) });
      put(g, con, bu, vcb, toHead);
      const tvg = new THREE.Group(); FX.box(tvg, 0.28, 0.012, 0.2, m.blackMetal, 0, 0, -0.02); FX.box(tvg, 0.05, 0.12, 0.03, m.blackMetal, 0, 0, -0.05);
      put(g, tvg, bu - hs * 0.05, vcb, toHead, 0.475);
      put(g, F.tv(m, { w: 1.0, live: true, glowZ: -0.02 }), bu - hs * 0.05, vcb, toHead, 0.56); (ctx.tvRooms ||= []).push('bedroom');
    }
  } else {
    // narrow room: headboard on the back wall beside the door(s), bed along v
    const leftFree = doors[0] - 0.43 - a0, rightFree = a1 - (doors[doors.length - 1] + 0.43);
    // the bed goes to the wider side of the door — but not against a side wall with the balcony door when the other side takes it
    let onRight = rightFree >= leftFree;
    if (r.sideDoor === (onRight ? 'right' : 'left') && (onRight ? leftFree : rightFree) >= 1.25) onRight = !onRight;
    const s0 = onRight ? doors[doors.length - 1] + 0.43 : a0, s1 = onRight ? a1 : doors[0] - 0.43, span = s1 - s0;
    const bw = span >= 1.62 ? 1.6 : span >= 1.42 ? 1.4 : 1.2;
    const bu = clamp((s0 + s1) / 2, a0 + bw / 2 + 0.02, a1 - bw / 2 - 0.02);
    put(g, F.bed(m, { w: bw }), bu, b0 + 1.08, '+v');
    bedC = [bu, b0 + 1.08];
    const nsU = onRight ? a1 - 0.22 : a0 + 0.22;
    if ((onRight ? a1 - (bu + bw / 2) : bu - bw / 2 - a0) > 0.46) halo(ctx, put(g, F.nightstand(m, { w: 0.42 }), nsU, b0 + 0.22, '+v'), -0.06, -0.187, 0.8);
    featureWallBed(ctx, g, bu, b0, '+v', Math.max(1.0, Math.min(bw + 0.5, span + 0.2)));
    artOn(ctx, g, bu, b0, '+v', Math.min(1.1, bw), 0.6, 1 + idx, 1.65);
    // wardrobe beyond the foot of the bed, on the bed's side wall (the other side is the way through to the window)
    const freeD = d - 2.2, wallGlazed = r.glazed === (onRight ? 'u1' : 'u0');
    if (freeD > 1.3 && w > 2.05 && !wallGlazed) { const wl = Math.min(1.6, freeD - 0.35); put(g, F.wardrobe(m, { len: wl, h: ctx.tallH, seed: idx + 2 }), onRight ? a1 - 0.3 : a0 + 0.3, b1 - 0.12 - wl / 2, onRight ? '-u' : '+u'); }
    else if (d > 2.9 && !wallGlazed) put(g, F.plant(m, { kind: 'snake', h: 0.9, seed: 7 + idx }), onRight ? a1 - 0.3 : a0 + 0.3, b1 - 0.3, '+v');
    // the balcony door belongs to the free strip beside the bed
    r.slideU = onRight ? (a0 + bu - bw / 2) / 2 : (bu + bw / 2 + a1) / 2;
    r.slideLane = d - 2.15 >= 0.8 ? null : onRight ? [a0, bu - bw / 2 - 0.1] : [bu + bw / 2 + 0.1, a1];
    r.narrow = true;
  }
  if (!ctx.cut && P.front) motorCurtains(ctx, L, g, r, w - 0.2, (a0 + a1) / 2, b1 - 0.12, CH - 0.05, [r.doorU, r.rect[1]]);
  if (!ctx.cut) put(g, F.pendant(m, { kind: 'bed', drop: 0.45 }), bedC[0], bedC[1], '+v', CH);
  ctx.lightSpots.push({ u: (a0 + a1) / 2, v: (b0 + b1) / 2, y: L.y, k: 0.7, pri: 1 });
}
// warm halo on the wall behind a lamp that stands against it (x, z in the furniture's local frame)
// (y = height of the lamp shade's centre: the hourglass of light escaping above and below the shade)
function halo(ctx, obj, x, z, y = 1.0) {
  if (ctx.cut || !obj) return obj;
  FX.fxQuad(obj, ctx.m.lampGlow, 'lamp', [x, y, z], [1.35, 0, 0], [0, 1.9, 0]);
  return obj;
}
const s3 = (m) => m.fam === 'nordic' ? m.woodLight : m.woodDark;
function featureWallBed(ctx, g, u, v, face, len) {
  const { m } = ctx;
  if (ctx.cut) return;
  if (ctx.curLevel) busy(ctx, ctx.curLevel, u, v, face, len / 2 + 0.05, 0, CH);
  const s = m.fam, grp = new THREE.Group(), H = CH - 0.02;
  if (m.styleId === 'paris') {
    // boiserie in a blush-greige infill: a wide centre panel behind the headboard between two slim ones (double
    // mouldings), a chair rail, and a pair of brass globe sconces
    const Hb = CH - 0.13, M = m.moulding, cw = clamp(len * 0.56, 1.0, len - 0.2), swd = (len - cw) / 2 - 0.16;
    FX.box(grp, len, Hb, 0.012, m.wallAccent, 0, 0, 0.006);
    FX.box(grp, len, 0.13, 0.02, m.skirting, 0, 0, 0.01);
    FX.mouldFrame(grp, M, 0, 0.26, Hb - 0.14, cw, 0.018, 0.034, 0.014); FX.mouldFrame(grp, M, 0, 0.33, Hb - 0.21, cw - 0.14, 0.016, 0.014, 0.008);
    if (swd > 0.2) for (const sx of [-1, 1]) {
      const x = sx * (cw / 2 + 0.1 + swd / 2);
      FX.mouldFrame(grp, M, x, 0.26, Hb - 0.14, swd, 0.018, 0.034, 0.014); FX.mouldFrame(grp, M, x, 0.33, Hb - 0.21, swd - 0.14, 0.016, 0.014, 0.008);
      if (swd > 0.3) FX.sconce(grp, m, x, 1.55, 0.014);
    }
    put(g, grp, u, v, face, 0);
    return;
  }
  if (m.styleId === 'monaco') {
    // navy velvet channel-upholstered wall panel in a brass frame, flanked by walnut
    FX.box(grp, len, H, 0.02, m.woodDark, 0, 0, 0.01);
    const pw = Math.min(len - 0.3, 2.6), n = Math.round(pw / 0.14);
    for (let i = 0; i < n; i++) FX.rbox(grp, pw / n - 0.006, 1.5, 0.07, 0.03, m.headboard, -pw / 2 + (i + 0.5) * pw / n, 0.45, 0.04);
    FX.box(grp, pw + 0.06, 0.03, 0.09, m.brass, 0, 0.42, 0.045); FX.box(grp, pw + 0.06, 0.03, 0.09, m.brass, 0, 1.95, 0.045);
    for (const sx of [-1, 1]) FX.box(grp, 0.03, 1.56, 0.09, m.brass, sx * (pw / 2 + 0.015), 0.42, 0.045);
  } else if (m.styleId === 'kyoto') {
    // smoked-oak wainscot up to 1.25 m with a ledge (ikebana, books) — the bed's pale slatted headboard stands in front
    FX.box(grp, len, 1.25, 0.03, m.woodDark, 0, 0, 0.015);
    FX.box(grp, len, 0.035, 0.16, m.woodDark, 0, 1.25, 0.08);
    FX.vase(grp, m, len / 2 - 0.22, 1.285, 0.08, 0.2, m.ceramic2, true); FX.bookStack(grp, m, 2, -len / 2 + 0.3, 1.285, 0.08, 57, 0.15);
  } else if (s === 'milano') { FX.box(grp, len, H, 0.02, m.woodDark, 0, 0, 0.01); for (let i = 1; i < 4; i++) FX.box(grp, 0.006, H, 0.004, m.brass, -len / 2 + i * len / 4, 0, 0.022); }
  else if (s === 'nordic') { FX.box(grp, len, 1.2, 0.02, m.wallAccent, 0, 0, 0.01); FX.box(grp, len, 0.02, 0.12, m.woodLight, 0, 1.2, 0.06); FX.vase(grp, m, len / 2 - 0.2, 1.22, 0.06, 0.18, m.ceramic2, false); FX.bookStack(grp, m, 2, -len / 2 + 0.25, 1.22, 0.06, 55, 0.2); }
  else { FX.box(grp, len, H, 0.02, m.wallAccent, 0, 0, 0.01); }
  // hidden LED slot in the ceiling along the bed wall: a grazing wash down the feature wall
  FX.box(grp, len, 0.012, 0.03, m.led, 0, CH - 0.014, 0.05);
  FX.fxQuad(grp, m.glow, 'grad', [0, CH - 0.55, 0.026], [len, 0, 0], [0, 1.1, 0]);
  FX.fxQuad(grp, m.glowFaint, 'grad', [0, CH - 0.004, 0.25], [len, 0, 0], [0, 0, -0.45]);
  put(g, grp, u, v, face, 0);
}

// ================================================================== CURTAIN SWITCHES
// Each curtained room gets its wall switch on the room side of a wall, as close as possible to where you come in
// (the room's door / the hall opening), at 1.05 m: clear of furniture, wall art / TV / feature panels, door openings and
// the leaf of an open door, and away from the window wall (where the curtains stack).
function placeSwitches(ctx, L) {
  const { P, m, sg } = ctx;
  const recs = ctx.curtains.filter(c => c.level === L.lv);
  if (!recs.length) return;
  sg.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(sg.matrixWorld).invert(), boxes = [], b = new THREE.Box3(), M = new THREE.Matrix4();
  sg.traverse(o => {
    if (!o.userData.collider || o.name !== 'col-furniture') return;
    b.copy(UBOX.boundingBox || (UBOX.computeBoundingBox(), UBOX.boundingBox)).applyMatrix4(M.multiplyMatrices(inv, o.matrixWorld));
    if (b.min.y < L.y + 1.25 && b.max.y > L.y + 0.2) boxes.push([b.min.x - 0.07, b.min.z - 0.07, b.max.x + 0.07, b.max.z + 0.07]);
  });
  // door zones along walls: [axis, c, face, s0, s1]
  const dz = [], leaves = [];
  for (const d of L.doors) {
    const hinge = d.axis === 'u' ? d.p + d.hinge * 0.39 * (d.into > 0 ? 1 : -1) : d.p - d.hinge * 0.39 * (d.into > 0 ? 1 : -1);
    dz.push([d.axis, d.c, 0, d.p - 0.56, d.p + 0.56], [d.axis, d.c, d.into, Math.min(d.p, hinge) - 0.4, Math.max(d.p, hinge) + 0.4]);
    // the open leaf stands ~perpendicular to its wall at the hinge: nothing goes on a wall right behind it
    const a = d.c + d.into * 0.05, b = d.c + d.into * 0.9;
    leaves.push(d.axis === 'u' ? [hinge, a, hinge, b] : [a, hinge, b, hinge]);
  }
  const segD = (px, pz, [x0, z0, x1, z1]) => { const dx = x1 - x0, dzz = z1 - z0, t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dzz) / (dx * dx + dzz * dzz || 1))); return Math.hypot(px - x0 - dx * t, pz - z0 - dzz * t); };
  const en = P.entry;
  if (en.wall === 'back') dz.push(['u', P.vc / 2, 0, en.p - 0.62, en.p + 0.95]);
  else dz.push(['v', en.wall === 'left' ? PW / 2 : P.W - PW / 2, 0, en.p - 0.95, en.p + 0.95]);
  const FACEOF = { '+v': ['u', 1], '-v': ['u', -1], '+u': ['v', 1], '-u': ['v', -1] };
  const used = [];
  for (const rec of recs) {
    const r = rec.room, [ra0, rb0, ra1, rb1] = clearRect(P, r), ref = rec.ref || [(ra0 + ra1) / 2, rb0];
    let best = null;
    for (const sgm of ctx.segs[L.lv] || []) for (const f of sgm.faces) {
      if (sgm.low) continue;
      const off = sgm.c + f * sgm.t / 2;
      const onRoom = sgm.axis === 'u' ? ((f > 0 && Math.abs(off - rb0) < 0.04) || (f < 0 && Math.abs(off - rb1) < 0.04)) : ((f > 0 && Math.abs(off - ra0) < 0.04) || (f < 0 && Math.abs(off - ra1) < 0.04));
      if (!onRoom) continue;
      const lo = Math.max(sgm.a0, sgm.axis === 'u' ? ra0 : rb0) + 0.12, hi = Math.min(sgm.a1, sgm.axis === 'u' ? ra1 : rb1) - 0.12;
      for (let a = lo; a <= hi; a += 0.04) {
        const [u, v] = sgm.axis === 'u' ? [a, off] : [off, a];
        if (v > P.vF - 0.55) continue;                                          // window wall / curtain stacks
        const pu = sgm.axis === 'u' ? u : u + f * 0.08, pv = sgm.axis === 'u' ? v + f * 0.08 : v;
        if (!pointInPoly([pu, pv], r.poly)) continue;
        if (dz.some(([ax, c, fc, s0, s1]) => ax === sgm.axis && Math.abs(c - sgm.c) < 0.08 && (fc === 0 || fc === f) && a > s0 && a < s1)) continue;
        if (boxes.some(([x0, z0, x1, z1]) => pu > x0 && pu < x1 && pv > z0 && pv < z1)) continue;
        if (leaves.some(l => segD(u, v, l) < 0.32)) continue;
        if (ctx.busy.some(q => { if (q.lv !== L.lv) return false; const [ax, fs] = FACEOF[q.face] || []; if (ax !== sgm.axis || fs !== f) return false;
          const qc = ax === 'u' ? q.v : q.u, qa = ax === 'u' ? q.u : q.v; return Math.abs(qc - off) < 0.12 && Math.abs(qa - a) < q.half + 0.06 && q.y0 < 1.2 && q.y1 > 0.95; })) continue;
        if (used.some(([uu, vv]) => Math.hypot(uu - u, vv - v) < 0.3)) continue;
        const d = Math.hypot(pu - ref[0], pv - ref[1]);
        if (!best || d < best.d) best = { d, u, v, face: sgm.axis === 'u' ? (f > 0 ? '+v' : '-v') : (f > 0 ? '+u' : '-u') };
      }
    }
    if (!best) continue;
    used.push([best.u, best.v]);
    const sw = F.curtainSwitch(m, { id: rec.id });
    sw.position.set(best.u, L.y + 1.05, best.v); sw.rotation.y = FACE[best.face]; sg.add(sw);
    rec.switch = { u: best.u, v: best.v, y: L.y + 1.05, face: best.face };
    busy(ctx, L, best.u, best.v, best.face, 0.08, 0.95, 1.15);
  }
}

// Curtain groups → public records (state lives in the mover group).
function wireCurtains(ctx, movers) {
  const out = [];
  for (const rec of ctx.curtains) {
    const g = movers.groups.get(rec.id);
    if (!g) continue;
    out.push({ id: rec.id, level: rec.level, room: rec.kind, roomName: rec.roomName, u: rec.u, v: rec.v, y: rec.y, switch: rec.switch || null,
      get open() { return g.open; }, toggle: (open, o) => g.toggle(open, o) });
  }
  return out;
}
// Live TV screens (kept out of the bake by furniture.js): tap toggles; the picture advances only while drawn.
function wireTvs(ctx, root) {
  const { m, unit } = ctx, out = [], roomsQ = ctx.tvRooms.slice();
  const tick = () => tickTv();
  root.traverse(o => { if (o.userData.tvScreen) out.push(o); });
  return out.map((scr, i) => {
    const glow = scr.children.find(c => c.name === 'tv-glow');
    let on = true;
    const ud = scr.userData;
    ud.action = { type: 'aptDoor', unitId: unit.id, part: 'tv' }; ud.piece = 'tv'; ud.open = ud._open = true; ud.tv = true;
    scr.onBeforeRender = tick;
    const toggle = (want) => {
      want = want === undefined ? !on : !!want;
      on = want; ud.open = ud._open = want;
      scr.material = want ? m.tvLive : m.screen;
      scr.onBeforeRender = want ? tick : NOOP_R;
      if (glow) glow.visible = want;
      return Promise.resolve();
    };
    ud.toggle = toggle;
    return { room: roomsQ[i] || 'living', mesh: scr, get on() { return on; }, toggle };
  });
}
const NOOP_R = () => {};
const WATER_PIECES = new Set(['toilet', 'vanity', 'bathtub', 'shower', 'kitchen']);

// ================================================================== LIGHTS
function buildLights(ctx) {
  const S = ctx.m.style, col = new THREE.Color(S.lightColor);
  const spots = ctx.lightSpots.slice().sort((a, b) => a.pri - b.pri);
  const MAX = ctx.opts.maxLights ?? 7;
  const lights = [];
  for (const s of spots) {
    if (lights.length >= MAX) break;
    // hung at ~1.8 m (not just under the slab): a point light 40 cm below the ceiling burns a hot, hue-shifted
    // spot onto it; lower and a little dimmer, the ceiling reads as the soft even wash of real downlights
    const h = s.h ?? 2.0;
    if (lights.some(l => Math.abs(l.position.y - (s.y + h)) < 1 && Math.hypot(l.position.x - s.u, l.position.z - s.v) < 1.6)) continue;
    const l = new THREE.PointLight(s.col ? new THREE.Color(s.col) : col, (s.h == null ? 5.2 : 6.0) * s.k * (ctx.opts.lightScale ?? 1), s.dist ?? 7.5, 1.6);
    l.position.set(s.u, s.y + h, s.v);
    l.name = 'apt-light';
    lights.push(l);
  }
  return lights;
}

// ================================================================== MAIN
// Plan frame → unit frame. A flat planned in the turned frame (P.rot) is turned back: its inner group is rotated by
// ±90° and every returned coordinate goes through pt() / dir() / face().
function unitMap(P) {
  if (!P.rot) return { rot: 0, pt: (u, v) => [u, v], dir: (du, dv) => [du, dv], face: f => f };
  if (P.rot === 'L') return { rot: 'L', pt: (u, v) => [P.UW - v, u], dir: (du, dv) => [-dv, du], face: f => ({ '+u': '+v', '-u': '-v', '+v': '-u', '-v': '+u' })[f] || f };
  return { rot: 'R', pt: (u, v) => [v, P.UD - u], dir: (du, dv) => [dv, -du], face: f => ({ '+u': '-v', '-u': '+v', '+v': '+u', '-v': '-u' })[f] || f };
}
function build(unit, styleId, opts = {}) {
  if (!unit || !TYPES[unit.type]) throw new Error('apartment: unknown type ' + (unit && unit.type));
  const m = getMaterials(styleId);
  const P = planUnit(unit), L = P.levels[0], Z = L.zones, MAP = unitMap(P);
  const root = new THREE.Group(); root.name = 'apartment-' + unit.id + '-' + m.styleId + (opts.cutaway ? '-cut' : '');
  const sg = new THREE.Group(); sg.name = 'static-src';
  const cg = new THREE.Group(); cg.name = 'colliders';
  const ctx = { tallH: opts.cutaway ? 1.05 : CH - 0.05, P, m, sg, cg, root, unit, cut: !!opts.cutaway, opts, segs: {}, frames: {}, lightSpots: [], showers: [], tmpGeos: [], slideU: null, slideLane: null, balconyDoors: [], curtains: [], busy: [], tvRooms: [], laundry: null, curLevel: null };
  CUR_M = m;
  const T0 = performance.now();
  try {
    buildShell(ctx, L);
    furnish(ctx, L);
    buildFacade(ctx, L);
    if (!ctx.cut) placeSwitches(ctx, L);
  } finally { CUR_M = null; }
  // shower glass panels are solid — up to just above the walker's waist-height probe only (probes: 0.3 / 1.0 / 1.6 m,
  // and nothing is walked into at 1.6 that is not also there at 1.0), so that taps aimed through the glass at the
  // mixer, the rain head and the shampoo niche (all above 1.1 m) reach them instead of stopping at the panel
  for (const [, u, v, w, d, Lv] of ctx.showers) {
    const gw = Math.min(w - 0.1, 1.0);
    collider(cg, u + w - gw, Lv.y + 0.02, v + d - 0.03, u + w, Lv.y + 1.08, v + d + 0.03);
  }
  // bake static geometry (halo markers first: they become one camera-facing billboard mesh)
  const baked = new THREE.Group(); baked.name = 'baked';
  root.add(baked);
  // openable fronts → dynamic batch + click proxies (the cutaway bakes them closed with everything else)
  const T1 = performance.now();
  const movers = opts.cutaway ? null : buildMovers(ctx, sg, root);
  const doors = opts.cutaway ? [] : wireBalconyDoors(ctx, movers);
  const curtains = movers ? wireCurtains(ctx, movers) : [];
  const T2 = performance.now();
  const halos = opts.cutaway ? null : bloomMesh(sg, m);
  bake(sg, baked);
  const T3 = performance.now();
  if (halos) baked.add(halos);
  // dispose temporary (non-cached) geometries used only as bake sources
  ctx.tmpGeos.forEach(g => g.dispose());
  cg.updateMatrixWorld(true);
  root.add(cg);
  // cutaway (dollhouse) models are viewed from outside the rooms: a soft warm sky/ground fill replaces the room lights
  // (the materials take only a fraction of the IBL, so without it the walls read almost black)
  const lights = opts.cutaway ? [Object.assign(new THREE.HemisphereLight(0xfff1e0, 0x9a8a74, 1.5), { name: 'apt-fill' })] : buildLights(ctx);
  lights.forEach(l => root.add(l));
  // the turned frame: everything built so far hangs in `root`; the returned group is in unit coordinates
  let group = root;
  if (P.rot) {
    group = new THREE.Group(); group.name = root.name; root.name = 'apartment-frame';
    if (P.rot === 'L') { root.position.set(P.UW, 0, 0); root.rotation.y = -HALF; } else { root.position.set(0, 0, P.UD); root.rotation.y = HALF; }
    group.add(root); group.updateMatrixWorld(true);
  }
  const mapPoly = poly => poly.map(([u, v]) => { const [x, z] = MAP.pt(u, v); return [+x.toFixed(3), +z.toFixed(3)]; });
  // rooms for HUD / minimap (unit coordinates). name = the name printed on the plans, nk / key = its i18n keys
  // ('room.kitchenLiving' / 'walk.room.kitchenLiving'), size = clear width × depth in the plan frame
  const rooms = [];
  for (const r of L.rooms) {
    let center = polyCentroid(r.poly);
    if (r.kind === 'hall' && r.entry) center = P.entry.wall === 'back' ? [clamp(P.entry.p, r.rect[0] + 0.5, r.rect[2] - 0.4), (P.vc + Z.vb) / 2] : [(r.rect[0] + r.rect[2]) / 2, clamp(P.entry.p, P.vc + 0.5, Z.vb - 0.4)];
    else if (!pointInPoly(center, r.poly)) center = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
    const c = MAP.pt(center[0], center[1]), cr = r.outdoor ? r.rect : clearRect(P, r);
    rooms.push({ kind: r.kind, name: r.name, nk: r.nk, key: 'walk.' + r.nk, area: r.area, level: 0, y: 0, center: [+c[0].toFixed(3), +c[1].toFixed(3)], poly: mapPoly(r.poly),
      size: [+(cr[2] - cr[0]).toFixed(2), +(cr[3] - cr[1]).toFixed(2)], ...(r.outdoor ? { outdoor: true, side: r.side } : {}) });
  }
  // balcony point: just outside the main door of the outdoor room
  const od = L.outdoor, ofr = od ? ctx.frames[od.side] : null;
  let balconyPoint = null;
  if (od && ofr) {
    let x = clamp(ofr.main ?? (od.x0 + od.x1) / 2, od.x0 + 0.45, od.x1 - 0.45);
    if (od.kind === 'loggia') {   // T32: stand in front of the middle of a glazing sash — a post of the loggia glazing used to cut the view in two
      const a = od.x0 + 0.135, b = od.x1 - 0.135, n = Math.max(1, Math.round((b - a) / 1.1)), pw = (b - a) / n;
      x = a + (clamp(Math.floor((x - a) / pw), 0, n - 1) + 0.5) * pw;
    }
    const [pu, pv] = ofr.toPlan(x, ofr.zD + Math.min(0.75, od.depth / 2));
    const [bu, bv] = MAP.pt(pu, pv);
    balconyPoint = { u: +bu.toFixed(3), v: +bv.toFixed(3), level: 0, side: od.side };
  }
  // balcony doors, curtains, cabinets: plan records → unit coordinates
  if (P.rot) {
    for (const d of doors) {
      const [u, v] = MAP.pt(d.u, d.v), [, w0] = MAP.pt(d.a0, d.v), [, w1] = MAP.pt(d.a1, d.v);
      Object.assign(d, { u, v, p0: u, p1: u, axis: 'v', a0: Math.min(w0, w1), a1: Math.max(w0, w1), out: P.rot === 'L' ? -1 : 1, side: P.rot === 'L' ? 'left' : 'right' });
    }
    for (const c of curtains) {
      [c.u, c.v] = MAP.pt(c.u, c.v);
      if (c.switch) { const [su, sv] = MAP.pt(c.switch.u, c.switch.v); c.switch = { ...c.switch, u: su, v: sv, face: MAP.face(c.switch.face) }; }
    }
    if (movers) for (const px of movers.proxies) {
      const c = px.userData.center, f = px.userData.front;
      if (c) { const [x, z] = MAP.pt(c[0], c[2]); px.userData.center = [x, c[1], z]; }
      if (f) { const [x, z] = MAP.dir(f[0], f[2]); px.userData.front = [x, f[1], z]; }
    }
    if (ctx.island) { const [x, z] = MAP.pt(ctx.island.u, ctx.island.v); Object.assign(ctx.island, { u: +x.toFixed(2), v: +z.toFixed(2), axis: 'v' }); }
  }
  // the door the balconyPoint faces (the main one), else the first door
  const mainDoor = () => {
    if (!doors.length) return null;
    if (!balconyPoint) return doors[0];
    return doors.slice().sort((a, b) => Math.hypot(a.u - balconyPoint.u, a.v - balconyPoint.v) - Math.hypot(b.u - balconyPoint.u, b.v - balconyPoint.v))[0];
  };
  if (opts.startOnBalcony && doors.length) mainDoor()?.toggle(true, { instant: true });
  const tvs = opts.cutaway ? [] : wireTvs(ctx, root);
  // play pieces (island tap / chopping board / salad bowl, chalk): proxies become tap targets
  // … and the water play: toilet lids & flush plates, basin / bath / kitchen taps, showers, shampoo pumps
  const fixtures = [];
  root.traverse(o => { if (o.userData.playPart) { o.userData.action = { type: 'aptDoor', unitId: unit.id, part: o.userData.playPart }; if (WATER_PIECES.has(o.userData.piece)) fixtures.push(o); } });
  // curtains start closed and open (room by room) when the visitor enters: on window 'vrc:apt-enter' {unitId},
  // on apt.openCurtains(), or — as a fallback — the first time a frame is rendered from inside the apartment.
  // opts.curtains: 'open' (built open, e.g. stills / panoramas) | 'closed' (no automatic opening) | 'auto' (default)
  let seqTok = 0, autoDone = opts.curtains === 'open' || opts.curtains === 'closed';
  const openCurtains = (o = {}) => {
    autoDone = true;
    const tok = ++seqTok, gap = o.instant ? 0 : (o.stagger ?? 650);
    return Promise.all(curtains.map((c, i) => new Promise(res => {
      const go = () => { if (tok !== seqTok) return res(); c.toggle(true, { instant: !!o.instant }).then(res); };
      if (!gap || !i) go(); else setTimeout(go, gap * i);
    })));
  };
  const closeCurtains = (o = {}) => { ++seqTok; return Promise.all(curtains.map(c => c.toggle(false, o))); };
  if (opts.curtains === 'open') openCurtains({ instant: true });
  const onEnter = (e) => { const id = e && e.detail && e.detail.unitId; if (!id || id === unit.id) openCurtains(); };
  const hasWin = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (hasWin && curtains.length) window.addEventListener('vrc:apt-enter', onEnter);
  let disposed = false;
  if (movers && curtains.length && !autoDone) {
    const cp = new THREE.Vector3();
    movers.onFrame((cam) => {
      if (autoDone || !cam) return;
      cp.setFromMatrixPosition(cam.matrixWorld); root.worldToLocal(cp);
      if (cp.x > 0.1 && cp.x < P.W - 0.1 && cp.z > 0.2 && cp.z < P.D - 0.25 && cp.y > -0.3 && cp.y < CH + 0.3) { autoDone = true; setTimeout(() => { if (!disposed) openCurtains(); }, 500); }
    });
  }
  const disposeAll = () => {
    disposed = true; ++seqTok;
    if (hasWin) window.removeEventListener('vrc:apt-enter', onEnter);
    baked.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    if (ctx.door) ctx.door.leaf.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (movers) movers.dispose();
  };
  // camera presets, in unit coordinates
  const views = cameraViews(ctx, P);
  for (const k of Object.keys(views)) {
    const q = views[k], [px, pz] = MAP.pt(q.pos[0], q.pos[2]), [tx, tz] = MAP.pt(q.target[0], q.target[2]);
    q.pos = [px, q.pos[1], pz]; q.target = [tx, q.target[1], tz];
  }
  // plan summary in UNIT coordinates (walk.js reads ul / vc / doorU for the door monitor); the planner's own frame
  // and data are under plan.canon
  const hr = Z.hall.rect, du = P.rot === 'L' ? P.UW - P.entry.p : P.entry.p;
  const k = Z.kitchenRoom, leftWall = !P.rot && (hr[0] <= P.ul + 1e-6 || !(k && Math.abs(k.rect[2] - hr[0]) < 1e-3));
  const sides = P.rot === 'L' ? { front: 'left' } : P.rot === 'R' ? { front: 'right' } : { front: 'front', left: 'left', right: 'right' };
  const windows = { front: 0, left: 0, right: 0 };
  for (const s of Object.keys(ctx.frames)) windows[sides[s]] += ctx.frames[s].panes;
  const plan = {
    W: P.UW, D: P.UD, rot: P.rot, mode: Z.mode, flip: Z.flip, levels: P.levels, duplex: false,
    ul: leftWall ? (hr[0] <= P.ul + 1e-6 ? P.ul : hr[0] + TW / 2) : du - 0.96, ur: P.UW - PW, vc: PW + (P.rot ? 0 : CW - PW), vF: P.UD - FW, vb: P.rot ? null : Z.vb, doorU: du,
    entry: P.entry, glaze: P.glaze, outdoor: od ? { kind: od.kind, side: od.unitSide, depth: od.depth } : null, windows,
    dropped: P.dropped.map(r => ({ kind: r.kind, name: r.name, area: r.area })), notes: P.notes, T: P.T, canon: P,
  };
  return {
    group, rooms, entrance: { u: du, v: 0 }, balconyPoint, lights, plan, views,
    stats: { meshes: baked.children.length + (ctx.door ? 2 : 0) + (movers ? movers.batches : 0), colliders: cg.children.length, fronts: movers ? movers.count : 0, ms: { furnish: Math.round(T1 - T0), fronts: Math.round(T2 - T1), bake: Math.round(T3 - T2) } },
    doorLeaf: ctx.door ? ctx.door.leaf : null,
    // every openable cabinet door / drawer / appliance door (invisible click proxies with action + toggle)
    cabinets: movers ? movers.proxies.filter(p => !p.userData.balconyDoor && !p.userData.curtain) : [], closeCabinets: movers ? movers.closeAll : () => Promise.resolve(),
    // doors to the balcony / glazed balcony / terrace: [{id, level, room, u, v, y, p0, p1, axis, a0, a1, out, side,
    //   kind:'slide'|'french', open, toggle(open)→Promise, collider, proxies}] (unit-local). axis 'u': the door lies in
    //   a wall along u (p0 … p1 at v). axis 'v': in a wall along v — then p0 = p1 = u of that wall and a0 … a1 is its
    //   extent along v; out = ±1, the outward direction along u. Each toggle fires window 'vrc:colliders-changed'.
    balconyDoors: doors,
    openBalconyDoor: () => { const d = mainDoor(); return d ? d.toggle(true) : Promise.resolve(); },
    // motorised curtains: [{id, level, room, roomName, u, v, y, switch:{u,v,y,face}, open, toggle(open, {instant})}]
    curtains, openCurtains, closeCurtains,
    get curtainsOpen() { return curtains.some(c => c.open); },
    // TVs (living + master bedroom): [{room, mesh, on, toggle(on)}]; on while the apartment is shown
    tvs, setTvs: (on) => Promise.all(tvs.map(t => t.toggle(on))),
    laundry: ctx.laundry,
    // kitchen island {u, v, len, depth, level} if this plan has one; snooker / game: always null (no duplexes here)
    island: ctx.island || null, snooker: null, game: null,
    // water play proxies (userData: playPart 'toiletLid'|'flush'|'tap'|'bathTap'|'shower'|'shampoo', piece, open, toggle)
    fixtures,
    closeBalconyDoors: () => Promise.all(doors.filter(d => d.open).map(d => d.toggle(false))),
    dispose: disposeAll,
  };
}
// Collect userData.bloom markers under `src` into one billboard mesh (4 verts per halo, expanded in the shader).
function bloomMesh(src, m) {
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert(), list = [], v = new THREE.Vector3();
  src.traverse(o => { if (o.userData.bloom) { v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv); list.push([v.x, v.y, v.z, o.userData.bloom.size, o.userData.bloom.k]); } });
  if (!list.length) return null;
  const n = list.length, pos = new Float32Array(n * 12), cor = new Float32Array(n * 8), sz = new Float32Array(n * 4), kk = new Float32Array(n * 4), idx = [];
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  list.forEach(([x, y, z, s, k], i) => {
    for (let j = 0; j < 4; j++) { const q = i * 4 + j; pos.set([x, y, z], q * 3); cor.set(C[j], q * 2); sz[q] = s; kk[q] = k; }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('corner', new THREE.BufferAttribute(cor, 2));
  g.setAttribute('bsize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('bk', new THREE.BufferAttribute(kk, 1)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(); g.computeBoundingSphere(); g.boundingSphere.radius += 1;
  const mesh = new THREE.Mesh(g, m.bloom);
  mesh.name = 'halos'; mesh.renderOrder = 3; mesh.matrixAutoUpdate = false; mesh.raycast = () => {}; mesh.userData.noExport = true;
  return mesh;
}
function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Suggested camera presets (plan frame; build() turns them into unit coordinates): used by dev pages and stills.
function cameraViews(ctx, P) {
  const E = 1.5, L = P.levels[0], Z = L.zones, v = {};
  const liv = Z.livRoom;
  if (liv) {
    const [a0, b0, a1, b1] = clearRect(P, liv), kf = Z.kitFront;
    const vb0 = (kf && kf.front === 'back' ? kf.rect[3] : b0) + 0.35, R = Z.tvSide === 'u1';
    v.living = { pos: [R ? a0 + 0.35 : a1 - 0.35, E, Math.min(vb0, b1 - 1.2)], target: [R ? a1 - 0.6 : a0 + 0.6, 1.2, b1 - 0.4], fov: 66 };
    // from the window side back into the room (dining / kitchen side)
    v.living2 = { pos: [R ? a0 + 0.45 : a1 - 0.45, E, b1 - 0.3], target: [R ? a1 - 1.2 : a0 + 1.2, 1.15, b0 + 0.3], fov: 68 };
  }
  const k = ctx.kitchen || null, ks = ctx.kitchenSide;
  if (k) v.kitchen = { pos: [clamp((k.u0 + k.u1) / 2 - 0.9, P.ul + 0.4, P.ur - 0.4), E, Math.min(k.v + 2.2, P.vF - 0.5)], target: [(k.u0 + k.u1) / 2 + 0.4, 1.1, k.v - 0.6] };
  else if (ks) v.kitchen = { pos: [ks.side === 'u1' ? Math.max(P.ul + 0.4, ks.u - 2.4) : Math.min(P.ur - 0.4, ks.u + 2.4), E, (ks.v0 + ks.v1) / 2 + 1.2], target: [ks.side === 'u1' ? P.ur : P.ul, 1.1, (ks.v0 + ks.v1) / 2 - 0.3] };
  if (Z.bedRooms.length) {
    const r = Z.bedRooms.slice().sort((x, z) => z.area - x.area)[0], [a0, b0, a1, b1] = clearRect(P, r), hs = r.headSide || 1;
    v.bedroom = !r.narrow
      ? { pos: [hs > 0 ? a0 + 0.35 : a1 - 0.35, E, b0 + 0.95], target: [hs > 0 ? a1 - 0.4 : a0 + 0.4, 1.0, b1 - 1.2], fov: 72 }
      : { pos: [(a0 + a1) / 2 - 0.25, E, b1 - 0.35], target: [(a0 + a1) / 2 + 0.2, 0.8, b0 + 0.3], fov: 72 };
  }
  const bath = Z.svc.find(s => s.kind === 'bath');
  if (bath) {
    const [a0, b0, a1, b1] = clearRect(P, bath), dr = bath.door || {};
    if (dr.wall === 'left') v.bath = { pos: [a0 + 0.12, 1.55, dr.v + 0.25], target: [a1 - 0.2, 1.0, b0 + 0.3], fov: 80 };
    else if (dr.wall === 'right') v.bath = { pos: [a1 - 0.12, 1.55, dr.v + 0.25], target: [a0 + 0.2, 1.0, b0 + 0.3], fov: 80 };
    else v.bath = { pos: [(dr.u ?? (a0 + a1) / 2) - 0.1, 1.5, b1 + 0.7], target: [(a0 + a1) / 2 + 0.2, 1.0, b0], fov: 72 };
  }
  const od = L.outdoor, fr = od ? ctx.frames[od.side] : null;
  if (od && fr) {
    const p = fr.toPlan(od.x0 + (od.x1 - od.x0) * 0.18, fr.zD + 0.3), t = fr.toPlan(od.x0 + (od.x1 - od.x0) * 0.8, fr.zD + od.depth + 3);
    v.balcony = { pos: [p[0], E, p[1]], target: [t[0], 1.0, t[1]], outside: true };
  }
  v.hall = P.entry.wall === 'back' ? { pos: [P.entry.p, E, P.vc + 0.25], target: [P.entry.p + 0.3, 1.2, P.vF], fov: 75 }
    : { pos: [P.entry.wall === 'left' ? P.ul + 0.25 : P.ur - 0.25, E, P.entry.p], target: [P.W / 2, 1.2, P.vF], fov: 75 };
  v.top = { pos: [P.W / 2, 40, P.D / 2 + 0.8], target: [P.W / 2, 0, P.D / 2 + 0.8], fov: 17 };
  v.dollhouse = { pos: [P.W * 1.25 + 2.5, 8.5, P.D + BD + 5.2], target: [P.W / 2, 0.3, P.D / 2 + 0.3], fov: 40 };
  return v;
}

// ================================================================== REAL INTERIOR (V3)
// buildApartment() for a unit that has a real interior (data.js interiorOf(unit): room polygons, doors, windows,
// fixtures extracted from the architectural plans, unit-local [u, v]). Everything is generated from the polygons:
//   · every room builds ITS side of its walls: each polygon edge is extruded outwards by half the gap to the room
//     beyond it (partitions), by the whole gap towards an own outdoor space, by the wall thickness of the data
//     (exterior / party / entrance wall) where nothing of the flat lies beyond; corners are mitred;
//   · doors, passages and windows cut the pieces (openings are projected onto the edges they lie on);
//   · floors / ceilings are the triangulated polygons; outdoor spaces get glazing, side walls or a parapet on the
//     edges that do not adjoin a room;
//   · drawn fixtures are placed with the furniture kit (facing worked out from the nearest wall), the rest is
//     furnished by room kind along free wall stretches.
// The fitted-box planner above stays as the fallback for a unit without an interior (and if this path throws).
const RD = ROOM_DEFAULTS || {};
const RWIN = RD.window || {}, RDOOR = RD.door || {};
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0], dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]], add2 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const len2 = a => Math.hypot(a[0], a[1]);
function signedArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
// nearest hit of the ray p + t·d (t in (1e-5, tmax]) with the boundary of a polygon
function rayPoly(p, d, poly, tmax = Infinity) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ax = a[0] - p[0], ay = a[1] - p[1];
    const t = (ax * ey - ay * ex) / den, s = (ax * d[1] - ay * d[0]) / den;
    if (t > 1e-5 && t <= tmax && s >= -1e-6 && s <= 1 + 1e-6 && t < best) best = t;
  }
  return best;
}
function segDist(p, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
}
function polyDist(p, poly) { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length])); return d; }
function polyBox(poly) { let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity; for (const [u, v] of poly) { if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; } return [u0, v0, u1, v1]; }

// ---------------------------------------------------------------- the plan (geometry only; cached per layout)
const RP_CACHE = new Map();
function rpSpace(r, out) {
  let poly = [];
  for (const p of r.poly || []) { const q = poly[poly.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-3) poly.push([+p[0], +p[1]]); }
  if (poly.length > 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-3) poly.pop();
  if (signedArea(poly) < 0) poly.reverse();
  const edges = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9, d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    edges.push({ i, a, b, d, n: [d[1], -d[0]], len: l, ops: [], ivs: [], k0: 0, k1: 0 });
  }
  const c = r.c && pointInPoly(r.c, poly) ? [+r.c[0], +r.c[1]] : polyCentroid(poly);
  return { id: r.id, kind: r.kind, nk: r.nk || NK[r.kind] || 'room.other', name: r.name || r.kind, area: +r.area || polyArea(poly), out: !!out, glazed: !!r.glazed, kitchen: !!r.kitchen, wc: !!r.wc,
    poly, edges, c, box: polyBox(poly), segs: [] };
}
function rpPlan(unit, I) {
  const hit = RP_CACHE.get(I.key || unit.type);
  if (hit && hit.I === I) return hit;
  const W = I.wall || {}, wExt = W.ext || 0.5, wParty = W.party || 0.25, wPart = W.part || 0.12;
  const outer = I.outer && I.outer.length > 2 ? I.outer : null;
  const spaces = [];
  for (const r of I.rooms || []) if (r && r.poly && r.poly.length >= 3) spaces.push(rpSpace(r, false));
  for (const r of I.outdoor || []) if (r && r.poly && r.poly.length >= 3) spaces.push(rpSpace(r, true));
  const byId = new Map(spaces.map(s => [s.id, s]));
  const warn = [];
  // ---- openings: doors / passages / windows projected onto the edges they lie on
  // (a door record whose direction is a few degrees off its wall — axis-aligned in a slanted facade — is turned
  // onto the wall: the leaf and the frame then stand in the opening that is cut)
  const doors = (I.doors || []).filter(d => d && d.p && d.dir && d.w > 0).map(d => {
    const o = { ...d, p: [+d.p[0], +d.p[1]], dir: [+d.dir[0], +d.dir[1]], n: d.n ? [+d.n[0], +d.n[1]] : [-d.dir[1], d.dir[0]], t: Math.max(0, +d.t || 0) };
    let best = null;
    for (const S of spaces) {
      if (S.out || (d.rooms && !d.rooms.includes(S.id))) continue;
      for (const e of S.edges) {
        const c = Math.abs(cross2(e.d, o.dir)); if (c > 0.21) continue;
        const rel = sub2(o.p, e.a), dist = dot2(rel, e.n), s = dot2(rel, e.d);
        if (dist < -0.12 || dist > o.t / 2 + 0.16 || s < -0.05 || s > e.len + 0.05) continue;
        if (!best || Math.abs(dist - o.t / 2) < best.q) best = { q: Math.abs(dist - o.t / 2), e, c };
      }
    }
    if (best && best.c > 0.012) {
      const e = best.e, sg = dot2(e.d, o.dir) >= 0 ? 1 : -1;
      o.dir = [e.d[0] * sg, e.d[1] * sg];
      const nn = dot2(e.n, o.n) >= 0 ? 1 : -1; o.n = [e.n[0] * nn, e.n[1] * nn];
      if (d.hinge) { const hs = dot2(sub2(d.hinge, o.p), o.dir) <= 0 ? -1 : 1; o.hinge = add2(o.p, o.dir, hs * o.w / 2); }
    }
    return o;
  });
  for (const d of doors) {
    const t = +d.t || 0, half = d.w / 2;
    let n = 0;
    // (every room edge the opening lies on — also a third room's that shares the wall line; a passage between two
    // overlapping polygons lies INSIDE both, hence the symmetric tolerance)
    for (const S of spaces) {
      if (S.out) continue;
      const mine = !d.rooms || d.rooms.includes(S.id);
      for (const e of S.edges) {
        // the part of the edge inside the door's span (a door in a curved wall crosses several chords of it)
        if (Math.abs(cross2(e.d, d.dir)) > 0.45) continue;
        const sa = dot2(sub2(e.a, d.p), d.dir), sb = dot2(sub2(e.b, d.p), d.dir);
        if (Math.abs(sb - sa) < 1e-6) continue;
        let k0 = (-half - sa) / (sb - sa), k1 = (half - sa) / (sb - sa);
        if (k0 > k1) [k0, k1] = [k1, k0];
        k0 = Math.max(0, k0); k1 = Math.min(1, k1);
        if (k1 - k0 < 1e-6) continue;
        const a0 = k0 * e.len, a1 = k1 * e.len;
        if (a1 - a0 < 0.05) continue;
        const pm = add2(e.a, e.d, (a0 + a1) / 2), across = dot2(sub2(pm, d.p), d.n), lim = t / 2 + 0.14;
        // (the edge is the room face of the door's wall: at most half the wall from its centre line; outward of the room)
        if (Math.abs(across) > lim) continue;
        const dist = dot2(sub2(d.p, pm), e.n);
        if (dist < (mine ? -lim : -0.1)) continue;
        e.ops.push({ a0, a1, y0: 0, y1: d.type === 'passage' ? 99 : (+d.h || RDOOR[d.type] || 2.05), door: d }); n++;
      }
    }
    if (!n && d.type !== 'passage') warn.push('door ' + d.id + ' lies on no room edge');
  }
  for (const w of I.windows || []) {
    const S = byId.get(w.room); if (!S || !w.pts || w.pts.length < 2) continue;
    const def = RWIN[w.partition ? 'partition' : w.kind] || [0.85, 2.45];
    const sill = Number.isFinite(+w.sill) ? +w.sill : def[0], head = Number.isFinite(+w.head) ? +w.head : def[1];
    let n = 0;
    for (let k = 0; k + 1 < w.pts.length; k++) {
      const p = w.pts[k], q = w.pts[k + 1], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l < 0.03) continue;
      const wd = [(q[0] - p[0]) / l, (q[1] - p[1]) / l], mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      for (const e of S.edges) {
        if (Math.abs(cross2(e.d, wd)) > 0.2) continue;
        if (Math.abs(dot2(sub2(mid, e.a), e.n)) > 0.09) continue;
        const s0 = dot2(sub2(p, e.a), e.d), s1 = dot2(sub2(q, e.a), e.d), a0 = Math.max(0, Math.min(s0, s1)), a1 = Math.min(e.len, Math.max(s0, s1));
        if (a1 - a0 < 0.04) continue;
        e.ops.push({ a0, a1, y0: sill, y1: head, win: w, t: +w.t || 0 }); n++;
      }
    }
    if (!n) warn.push('window ' + w.id + ' lies on no edge of ' + w.room);
  }
  // ---- what lies beyond every edge → intervals {s0, s1, cls, t}
  let plate = null, others = [], halls = [];
  try {
    plate = plateOf(unit.building, unit.floor);
    others = unitsOn(unit.building, unit.floor).filter(o => o.id !== unit.id && o.poly && o.poly.length > 2).map(o => o.poly);
    halls = (plate && plate.hall) || [];
  } catch { /* stand-alone use (tests with stub data) */ }
  const beyondIsOutside = (p) => {
    if (!plate || !unit.frame) return false;
    let q; try { q = unitToLocal(unit, p[0], p[1]); } catch { return false; }
    if (others.some(poly => pointInPoly(q, poly))) return false;
    if (halls.some(h => q[0] > h.x0 - 0.4 && q[0] < h.x1 + 0.4 && q[1] > h.z0 - 0.4 && q[1] < h.z1 + 0.4)) return false;
    const c = plate.core;
    for (const r of [c, ...((c && c.lifts) || []), ...((c && c.stairs) || [])]) if (r && Number.isFinite(r.x0) && q[0] > r.x0 - 0.3 && q[0] < r.x1 + 0.3 && q[1] > r.z0 - 0.3 && q[1] < r.z1 + 0.3) return false;
    return true;
  };
  const STEP = 0.02;
  for (const S of spaces) for (const e of S.edges) {
    const n = Math.max(1, Math.ceil(e.len / STEP)), ds = e.len / n;
    let cur = null;
    const runs = [];
    for (let i = 0; i < n; i++) {
      // (the ray starts 2 cm INSIDE the room, so a room that touches this edge — a passage — is met at t = 2 cm)
      const s = (i + 0.5) * ds, p = [e.a[0] + e.d[0] * s - e.n[0] * 0.02, e.a[1] + e.d[1] * s - e.n[1] * 0.02];
      let g = Infinity, who = null;
      for (const T of spaces) {
        if (T === S) continue;
        if (p[0] < T.box[0] - 1 || p[0] > T.box[2] + 1 || p[1] < T.box[1] - 1 || p[1] > T.box[3] + 1) continue;
        // (a room that overlaps this edge — two polygons drawn into each other at a wide opening — counts as touching)
        const t = pointInPoly([p[0] + e.n[0] * 0.04, p[1] + e.n[1] * 0.04], T.poly) ? 0 : Math.max(0, rayPoly(p, e.n, T.poly, 1.0) - 0.02);
        if (t < g) { g = t; who = T; }
      }
      let cls = 'none', key = 'none';
      if (who) {
        if (S.out) { cls = who.out ? 'none' : 'skip'; key = cls; }
        else if (who.out) { cls = 'own'; key = 'own' + Math.round(g * 25); }
        else if (g < 0.015) { cls = 'touch'; key = 'touch'; }             // the polygons touch: no wall (the data's rule)
        else { cls = 'part'; key = 'part' + Math.round(g * 50); }
      }
      if (cur && cur.key === key) { cur.s1 = (i + 1) * ds; cur.gs.push(g); }
      else runs.push(cur = { key, cls, s0: i * ds, s1: (i + 1) * ds, gs: [g], to: who });
    }
    // swallow slivers (a neighbour's corner seen for a few centimetres)
    for (let k = runs.length - 1; k >= 0 && runs.length > 1; k--) {
      const r = runs[k];
      if (r.s1 - r.s0 >= 0.07) continue;
      const nb = runs[k - 1] || runs[k + 1];
      if (runs[k - 1]) nb.s1 = r.s1; else nb.s0 = r.s0;
      runs.splice(k, 1);
    }
    for (const r of runs) {
      const gs = r.gs.filter(Number.isFinite).sort((x, y) => x - y), g = gs.length ? gs[gs.length >> 1] : 0;
      const iv = { s0: r.s0, s1: r.s1, cls: r.cls, t: 0, ext: false, to: r.to ? r.to.id : null };
      const mid = (r.s0 + r.s1) / 2, pm = [e.a[0] + e.d[0] * mid, e.a[1] + e.d[1] * mid];
      if (S.out) {
        if (r.cls === 'skip') iv.t = 0;
        else { iv.cls = S.kind === 'loggia' || S.glazed ? 'side' : 'rail'; iv.t = 0.1; iv.ext = true; }
      } else if (r.cls === 'touch') iv.t = 0;
      else if (r.cls === 'part') iv.t = Math.max(0.03, g / 2);
      else if (r.cls === 'own') { iv.t = Math.max(0.1, g); iv.ext = true; }
      else {
        // nothing of this flat beyond: the entrance wall reaches the hall edge (v = 0); else exterior or party wall
        const wt = e.ops.filter(o => o.t > 0 && o.a1 > r.s0 && o.a0 < r.s1).map(o => o.t)[0];
        const dr = e.ops.find(o => o.door && o.door.type !== 'passage' && o.door.t > 0 && o.a1 > r.s0 && o.a0 < r.s1);
        if (e.n[1] < -0.97 && pm[1] > 0.04 && pm[1] < 0.9) { iv.cls = 'hall'; iv.t = pm[1]; }
        else if (wt) { iv.cls = 'ext'; iv.t = wt; iv.ext = true; }
        else if (dr) { iv.cls = dr.door.type === 'entrance' ? 'hall' : 'ext'; iv.t = dr.door.t; iv.ext = dr.door.type === 'balcony'; }
        else if (outer && pointInPoly(add2(pm, e.n, 0.06), outer) && r.s1 - r.s0 < 0.6) { iv.cls = 'inner'; iv.t = wPart / 2; }   // a stub at a junction of partitions
        else if (beyondIsOutside(add2(pm, e.n, 0.95)) && beyondIsOutside(add2(pm, e.n, 0.6))) { iv.cls = 'ext'; iv.t = wExt; iv.ext = true; }
        else { iv.cls = 'party'; iv.t = wParty; }
      }
      iv.t = Math.min(iv.t, 1.0);
      e.ivs.push(iv);
    }
    e.ops.sort((p, q) => p.a0 - q.a0);
  }
  // collinear neighbours on one wall line share the thicker exterior thickness (a window's wall carries on beside it)
  for (const S of spaces) {
    if (S.out) continue;
    for (const e of S.edges) for (const iv of e.ivs) {
      if (iv.cls !== 'ext' && iv.cls !== 'party') continue;
      for (const f of S.edges) {
        if (f === e || Math.abs(cross2(e.d, f.d)) > 0.02 || dot2(e.d, f.d) < 0 || Math.abs(dot2(sub2(f.a, e.a), e.n)) > 0.02) continue;
        for (const jv of f.ivs) if (jv.cls === 'ext' && jv.t > iv.t) { iv.t = jv.t; iv.cls = 'ext'; iv.ext = true; }
      }
    }
  }
  // ---- mitres at the polygon corners
  for (const S of spaces) {
    const E = S.edges, n = E.length;
    for (let i = 0; i < n; i++) {
      const e = E[i], p = E[(i + n - 1) % n];
      const ie = e.ivs[0], ip = p.ivs[p.ivs.length - 1];
      const te = ie && ie.s0 < 0.01 ? ie.t : 0, tp = ip && ip.s1 > p.len - 0.01 ? ip.t : 0;
      e.k0 = 0; p.k1 = 0;
      if (te <= 0 || tp <= 0) continue;
      const den = cross2(e.d, p.d);
      if (Math.abs(den) < 0.08) continue;
      const diff = [p.n[0] * tp - e.n[0] * te, p.n[1] * tp - e.n[1] * te];
      const y = cross2(diff, p.d) / den;                                    // along e.d from the corner
      const M = [e.a[0] + e.n[0] * te + e.d[0] * y, e.a[1] + e.n[1] * te + e.d[1] * y];
      const x = dot2(sub2(M, [e.a[0] + p.n[0] * tp, e.a[1] + p.n[1] * tp]), p.d);
      const lim = 2.2 * Math.max(te, tp);
      if (Math.abs(y) > lim || Math.abs(x) > lim || y > e.len * 0.9 || -x > p.len * 0.9) continue;
      e.k0 = y; p.k1 = x;
    }
  }
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const S of spaces) { u0 = Math.min(u0, S.box[0]); v0 = Math.min(v0, S.box[1]); u1 = Math.max(u1, S.box[2]); v1 = Math.max(v1, S.box[3]); }
  // ---- balcony doors that do not open onto their outdoor polygon. Up to 1.7 m beside it (the drawn polygon is one
  // bay of a balcony strip, the door opens onto the next bay): that bay is added as a deck of its own, from the door
  // to the drawn polygon. Farther (a door to the garden): the door stays shut.
  const decks = [];
  for (const d of doors) {
    if (d.type !== 'balcony') continue;
    const O = byId.get(d.rooms && d.rooms[1]);
    const q = add2(d.p, d.n, d.t / 2 + 0.35);
    if (O && pointInPoly(q, O.poly)) continue;
    if (O && polyDist(q, O.poly) < 0.3) continue;
    const dist = O ? polyDist(q, O.poly) : Infinity;
    let ok = false;
    if (O && dist <= 1.7) {
      let s0 = Infinity, s1 = -Infinity, n1 = -Infinity;
      for (const pt of O.poly) { const r = sub2(pt, d.p), a = dot2(r, d.dir), b = dot2(r, d.n); s0 = Math.min(s0, a); s1 = Math.max(s1, a); n1 = Math.max(n1, b); }
      const hw = d.w / 2 + 0.3, depth = Math.min(n1, d.t / 2 + 1.5);
      if (depth > d.t / 2 + 0.6) {
        const a0 = s0 > hw - 0.05 ? -hw : s1 < -hw + 0.05 ? s1 + 0.06 : Math.min(-hw, s0), a1 = s0 > hw - 0.05 ? s0 - 0.06 : s1 < -hw + 0.05 ? hw : Math.max(hw, s1);
        const Pt = (a, b) => [d.p[0] + d.dir[0] * a + d.n[0] * b, d.p[1] + d.dir[1] * a + d.n[1] * b];
        decks.push({ id: 'k-' + d.id, door: d.id, space: O.id, poly: [Pt(a0, d.t / 2), Pt(a1, d.t / 2), Pt(a1, depth), Pt(a0, depth)], d: d.dir, n: d.n, a0, a1, w0: d.t / 2, w1: depth, p: d.p, toHi: s0 > hw - 0.05 });
        ok = true;
      }
    }
    if (!ok) { d.fixed = true; warn.push('door ' + d.id + ' does not open onto ' + (O ? O.id : 'an outdoor space') + ' (kept shut)'); }
  }
  for (const O of spaces) if (O.out) O.detached = !doors.some(d => d.type === 'balcony' && !d.fixed && d.rooms && d.rooms[1] === O.id && !decks.some(k => k.door === d.id));
  const P = { I, key: I.key || unit.type, doors, decks, spaces, byId, rooms: spaces.filter(s => !s.out), outdoor: spaces.filter(s => s.out), warn, bbox: { u0, v0, u1, v1 }, wExt, wParty };
  RP_CACHE.set(P.key, P);
  return P;
}
// Solid wall stretches of every space (for furnishing): [{a, b, d, nin, len, wins:[{s0, s1, sill}], cls}] — wall
// pieces between door openings, joined across collinear edges. Outdoor spaces: every edge counts.
function rpSegs(P) {
  for (const S of P.spaces) {
    const raw = [];
    for (const e of S.edges) for (const iv of e.ivs) {
      if (!S.out && !(iv.t > 0)) continue;
      const cuts = e.ops.filter(o => o.door && o.a1 > iv.s0 + 1e-4 && o.a0 < iv.s1 - 1e-4);
      let s = iv.s0;
      const emit = (x0, x1) => {
        if (x1 - x0 < 0.02) return;
        const wins = e.ops.filter(o => o.win && o.a1 > x0 && o.a0 < x1).map(o => ({ s0: Math.max(0, o.a0 - x0), s1: Math.min(x1, o.a1) - x0, sill: o.y0 }));
        raw.push({ a: add2(e.a, e.d, x0), b: add2(e.a, e.d, x1), d: e.d, nin: [-e.n[0], -e.n[1]], len: x1 - x0, wins, cls: iv.cls });
      };
      for (const o of cuts) { emit(s, Math.min(o.a0, iv.s1)); s = Math.max(s, o.a1); }
      emit(s, iv.s1);
    }
    const out = [];
    for (const r of raw) {
      const l = out[out.length - 1];
      if (l && Math.abs(cross2(l.d, r.d)) < 0.02 && dot2(l.d, r.d) > 0 && Math.hypot(l.b[0] - r.a[0], l.b[1] - r.a[1]) < 0.03) {
        for (const w of r.wins) l.wins.push({ s0: w.s0 + l.len, s1: w.s1 + l.len, sill: w.sill });
        l.b = r.b; l.len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
      } else out.push({ ...r, wins: r.wins.slice() });
    }
    if (out.length > 1) {
      const f = out[0], l = out[out.length - 1];
      if (Math.abs(cross2(l.d, f.d)) < 0.02 && dot2(l.d, f.d) > 0 && Math.hypot(l.b[0] - f.a[0], l.b[1] - f.a[1]) < 0.03) {
        for (const w of f.wins) l.wins.push({ s0: w.s0 + l.len, s1: w.s1 + l.len, sill: w.sill });
        l.b = f.b; l.len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]); out.shift();
      }
    }
    S.segs = out;
  }
}

// ---------------------------------------------------------------- geometry accumulators (one mesh per material)
function rpAcc() {
  const map = new Map();
  const arr = (mat) => { let a = map.get(mat); if (!a) map.set(mat, a = { p: [], n: [] }); return a; };
  const tri = (mat, a, b, c, n) => {
    // winding follows the wanted normal
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const A = arr(mat);
    if (gx * n[0] + gy * n[1] + gz * n[2] >= 0) A.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    else A.p.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
    A.n.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
  };
  const quad = (mat, a, b, c, d, n) => { tri(mat, a, b, c, n); tri(mat, a, c, d, n); };
  // vertical quad over the plan segment p → q between y0 and y1, facing plan direction nn
  const vquad = (mat, p, q, y0, y1, nn) => quad(mat, [p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], [nn[0], 0, nn[1]]);
  // horizontal plan quad at height y
  const hquad = (mat, a, b, c, d, y, up) => quad(mat, [a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], [d[0], y, d[1]], [0, up, 0]);
  // box along the plan direction d: centre c, half-length hl along d, half-width hw across, y0 … y1
  const obox = (mat, c, d, hl, hw, y0, y1) => {
    if (hl <= 0 || hw <= 0 || y1 - y0 <= 0) return;
    const nx = -d[1], ny = d[0];
    const A = [c[0] - d[0] * hl - nx * hw, c[1] - d[1] * hl - ny * hw], B = [c[0] + d[0] * hl - nx * hw, c[1] + d[1] * hl - ny * hw];
    const C = [c[0] + d[0] * hl + nx * hw, c[1] + d[1] * hl + ny * hw], D = [c[0] - d[0] * hl + nx * hw, c[1] - d[1] * hl + ny * hw];
    vquad(mat, A, B, y0, y1, [-nx, -ny]); vquad(mat, D, C, y0, y1, [nx, ny]);
    vquad(mat, A, D, y0, y1, [-d[0], -d[1]]); vquad(mat, B, C, y0, y1, d);
    hquad(mat, A, B, C, D, y1, 1); hquad(mat, A, B, C, D, y0, -1);
  };
  // box in the frame of an edge: s0 … s1 along d from the point a, w0 … w1 along the normal nn
  const ebox = (mat, a, d, nn, s0, s1, w0, w1, y0, y1) => {
    if (s1 - s0 <= 1e-4 || w1 - w0 <= 1e-4 || y1 - y0 <= 1e-4) return;
    const P = (s, w) => [a[0] + d[0] * s + nn[0] * w, a[1] + d[1] * s + nn[1] * w];
    const A = P(s0, w0), B = P(s1, w0), C = P(s1, w1), D = P(s0, w1);
    vquad(mat, A, B, y0, y1, [-nn[0], -nn[1]]); vquad(mat, D, C, y0, y1, nn);
    vquad(mat, A, D, y0, y1, [-d[0], -d[1]]); vquad(mat, B, C, y0, y1, d);
    hquad(mat, A, B, C, D, y1, 1); hquad(mat, A, B, C, D, y0, -1);
  };
  // triangulated polygon at height y (up = 1 floor, −1 ceiling)
  const poly = (mat, pts, y, up) => {
    const c = pts.map(p => new THREE.Vector2(p[0], p[1]));
    let f = [];
    try { f = THREE.ShapeUtils.triangulateShape(c, []); } catch { f = []; }
    if (!f.length) for (let i = 1; i + 1 < pts.length; i++) f.push([0, i, i + 1]);
    for (const [i, j, k] of f) tri(mat, [pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[k][0], y, pts[k][1]], [0, up, 0]);
  };
  const flush = (parent, tmp) => {
    for (const [mat, A] of map) {
      if (!A.p.length || !mat) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
      tmp.push(g);
      parent.add(new THREE.Mesh(g, mat));
    }
    map.clear();
  };
  return { tri, quad, vquad, hquad, obox, ebox, poly, flush };
}
// collider box along a plan direction (rotated unit box)
function ocollider(p, c, d, hl, hw, y0, y1, kind = 'solid') {
  const o = collider(p, -hl, y0, -hw, hl, y1, hw, kind);
  o.position.set(c[0], (y0 + y1) / 2, c[1]);
  o.rotation.y = Math.atan2(-d[1], d[0]);
  return o;
}
// polygon collider (walkable floor of a room / an outdoor space)
function pcollider(p, pts, y, tmp) {
  if (!COLMAT) { COLMAT = new THREE.MeshBasicMaterial({ visible: false }); COLMAT.name = 'collider'; }
  const c = pts.map(q => new THREE.Vector2(q[0], q[1]));
  let f = [];
  try { f = THREE.ShapeUtils.triangulateShape(c, []); } catch { f = []; }
  if (!f.length) for (let i = 1; i + 1 < pts.length; i++) f.push([0, i, i + 1]);
  const pos = [];
  for (const t of f) for (const i of t) pos.push(pts[i][0], y, pts[i][1]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const o = new THREE.Mesh(g, COLMAT);
  o.userData.keep = true; o.userData.collider = true; o.userData.floor = true; o.name = 'col-floor';
  if (tmp) tmp.push(g);
  p.add(o); return o;
}

// ---------------------------------------------------------------- shell: walls, openings, floors, ceilings, outdoor
const rpFloorMat = (m, S) => S.out ? m.floorOut : S.kind === 'bath' ? m.floorBath : S.kind === 'hall' ? (m.floorHall || (m.fam === 'milano' ? m.marble : m.floor)) : m.floor;
const rpWallMat = (m, S) => S.out ? m.exterior : S.kind === 'bath' ? m.wallBath : m.wall;
function rpShell(ctx) {
  const { P, m, A, cut, sg, cg } = ctx, H = cut ? 1.1 : CH;
  const paris = m.styleId === 'paris', sh = paris ? 0.13 : 0.08, st = paris ? 0.018 : 0.014;
  for (const S of P.spaces) {
    const wm = rpWallMat(m, S), capM = S.out ? m.exterior : m.wall;
    for (const e of S.edges) {
      const nin = [-e.n[0], -e.n[1]];
      const Pt = (s, w) => [e.a[0] + e.d[0] * s + e.n[0] * w, e.a[1] + e.d[1] * s + e.n[1] * w];
      for (const iv of e.ivs) {
        if (!(iv.t > 0) || iv.cls === 'skip') continue;
        const rail = iv.cls === 'rail', Hw = rail ? Math.min(0.42, H) : H, t = iv.t;
        const ops = e.ops.filter(o => o.a1 > iv.s0 + 1e-4 && o.a0 < iv.s1 - 1e-4);
        const xs = [iv.s0, iv.s1];
        for (const o of ops) { xs.push(Math.max(iv.s0, Math.min(iv.s1, o.a0)), Math.max(iv.s0, Math.min(iv.s1, o.a1))); }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k++) {
          const x0 = xs[k], x1 = xs[k + 1];
          if (x1 - x0 < 0.004) continue;
          const mid = (x0 + x1) / 2, op = ops.find(o => mid > o.a0 && mid < o.a1) || null;
          const spans = [];
          if (!op) spans.push([0, Hw]);
          else {
            if (op.y0 > 0.03) spans.push([0, Math.min(op.y0, Hw)]);
            if (!cut && !rail && op.y1 < Hw - 0.02) spans.push([op.y1, Hw]);
          }
          if (op && op.win && !op.built) { op.built = true; }
          if (!spans.length) continue;
          const atS = x0 < 0.004, atE = x1 > e.len - 0.004;
          const sM = atS ? e.k0 : 0, eM = atE ? e.k1 : 0;
          const a = Pt(x0, 0), b = Pt(x1, 0), a2 = Pt(x0 + sM, t), b2 = Pt(x1 + eM, t);
          for (const [y0, y1] of spans) {
            if (y1 - y0 < 0.004) continue;
            A.vquad(wm, a, b, y0, y1, nin);
            if (iv.ext) A.vquad(m.exterior, a2, b2, y0, y1, e.n);
            else if (cut && iv.cls !== 'part' && iv.cls !== 'touch') A.vquad(m.wall, a2, b2, y0, y1, e.n);
            if (!(atS && sM !== 0)) A.vquad(capM, a, a2, y0, y1, [-e.d[0], -e.d[1]]);
            if (!(atE && eM !== 0)) A.vquad(capM, b, b2, y0, y1, e.d);
            if (cut || y1 < H - 0.01) A.hquad(cut && y1 >= H - 0.01 ? m.cutCap : rail ? m.stone : capM, a, b, b2, a2, y1 + (cut && y1 >= H - 0.01 ? 0.001 : 0), 1);
            if (y0 > 0.01) A.hquad(capM, a, b, b2, a2, y0, -1);
          }
          if (spans[0][0] > 0.01) continue;                                         // a lintel only
          // collider (wall, sill wall, parapet)
          const c0 = x0 + Math.min(0, sM), c1 = x1 + Math.max(0, eM), top = rail ? 1.3 : Math.min(spans[0][1], 2.2);
          if (top > 0.06) ocollider(cg, Pt((c0 + c1) / 2, t / 2), e.d, (c1 - c0) / 2, t / 2, 0.02, top);
          if (rail) {
            const g = Math.max(0.02, t / 2);
            A.ebox(m.glass, e.a, e.d, e.n, x0 + 0.01, x1 - 0.01, g - 0.008, g + 0.008, Hw, 1.06);
            A.ebox(m.frame, e.a, e.d, e.n, x0, x1, g - 0.03, g + 0.03, 1.06, 1.1);
            for (const x of [x0, x1]) A.ebox(m.frame, e.a, e.d, e.n, x - 0.02, x + 0.02, g - 0.02, g + 0.02, Hw, 1.06);
          }
          if (S.out) continue;
          // skirting + junction shading (floor, wall foot; ceiling and wall head under a full-height piece)
          const low = spans[0][1] < H - 0.01, len = x1 - x0, pm = Pt(mid, 0);
          if (S.kind !== 'bath') A.ebox(m.skirting, e.a, e.d, nin, x0, x1, 0, st, 0, Math.min(sh, spans[0][1]));
          if (len > 0.12 && !ctx.noFx) {
            const R = [e.d[0] * len, 0, e.d[1] * len];
            FX.fxQuad(sg, m.ao, 'grad', [pm[0] + nin[0] * 0.16, 0.004, pm[1] + nin[1] * 0.16], R, [e.n[0] * 0.32, 0, e.n[1] * 0.32]);
            if (spans[0][1] > 0.5) FX.fxQuad(sg, m.aoSoft, 'grad', [pm[0] + nin[0] * 0.016, S.kind === 'bath' ? 0.2 : 0.25, pm[1] + nin[1] * 0.016], R, [0, S.kind === 'bath' ? -0.4 : -0.34, 0]);
            if (!cut && !low) {
              FX.fxQuad(sg, m.aoSoft, 'grad', [pm[0] + nin[0] * 0.15, CH - 0.004, pm[1] + nin[1] * 0.15], R, [e.n[0] * 0.3, 0, e.n[1] * 0.3]);
              FX.fxQuad(sg, m.aoSoft, 'grad', [pm[0] + nin[0] * 0.016, CH - 0.15, pm[1] + nin[1] * 0.016], R, [0, 0.3, 0]);
            }
          }
        }
        // windows of this stretch
        for (const o of ops) if (o.win && !o.done) { o.done = true; rpWindow(ctx, S, e, o, t); }
      }
      for (const o of e.ops) { delete o.done; delete o.built; }
    }
  }
  // ---- floors, ceilings, walkable regions
  for (const S of P.spaces) {
    if (!S.out) {
      A.poly(rpFloorMat(m, S), S.poly, 0, 1);
      if (!cut) A.poly(m.ceiling, S.poly, CH, -1);
      const c = pcollider(cg, S.poly, 0, ctx.colGeos); c.userData.room = S.id;
    } else {
      const fy = 0.012;
      A.poly(m.floorOut, S.poly, fy, 1);
      A.poly(m.exterior, S.poly, -0.25, -1);
      for (const e of S.edges) for (const iv of e.ivs) if (iv.cls !== 'skip') A.vquad(m.exterior, add2(e.a, e.d, iv.s0), add2(e.a, e.d, iv.s1), -0.25, fy, e.n);
      // (the soffit hangs 1.5 cm below the slab above: nothing coplanar with the tower's own geometry)
      if (!cut && S.kind !== 'terrace') { A.poly(m.exterior, S.poly, CH - 0.015, -1); rpDownlight(ctx, S.c[0], CH - 0.015, S.c[1]); }
      const c = pcollider(cg, S.poly, fy, ctx.colGeos); c.userData.room = S.id;
    }
  }
  // ---- deck strips between a balcony door and its outdoor polygon (rpPlan)
  for (const k of P.decks) {
    const O = P.byId.get(k.space), fy = 0.012, Pt = (a, b) => [k.p[0] + k.d[0] * a + k.n[0] * b, k.p[1] + k.d[1] * a + k.n[1] * b];
    A.poly(m.floorOut, k.poly, fy, 1); A.poly(m.exterior, k.poly, -0.25, -1);
    pcollider(cg, k.poly, fy, ctx.colGeos).userData.room = k.space;
    const glazed = O && (O.glazed || O.kind === 'loggia'), top = cut ? 1.1 : glazed ? 2.6 : 1.08;
    const side = (a, b0, b1) => {          // closing piece across the strip at a
      A.ebox(m.frame, Pt(a, 0), k.n, k.d, b0, b1, -0.03, 0.03, 0, 0.1); A.ebox(glazed ? m.glazing : m.glass, Pt(a, 0), k.n, k.d, b0, b1, -0.006, 0.006, 0.1, top);
      A.ebox(m.frame, Pt(a, 0), k.n, k.d, b0, b1, -0.03, 0.03, top, top + 0.04);
      ocollider(cg, Pt(a, (b0 + b1) / 2), k.n, (b1 - b0) / 2, 0.05, 0.02, glazed ? 2.2 : 1.3);
    };
    // outer edge + the free end
    A.ebox(m.frame, Pt(0, k.w1), k.d, k.n, k.a0, k.a1, -0.03, 0.03, 0, 0.1); A.ebox(glazed ? m.glazing : m.glass, Pt(0, k.w1), k.d, k.n, k.a0, k.a1, -0.006, 0.006, 0.1, top);
    A.ebox(m.frame, Pt(0, k.w1), k.d, k.n, k.a0, k.a1, -0.03, 0.03, top, top + 0.04);
    ocollider(cg, Pt((k.a0 + k.a1) / 2, k.w1), k.d, (k.a1 - k.a0) / 2, 0.05, 0.02, glazed ? 2.2 : 1.3);
    side(k.a0, k.w0, k.w1); side(k.a1, k.w0, k.w1);
    A.vquad(m.exterior, Pt(k.a0, k.w1), Pt(k.a1, k.w1), -0.25, fy, k.n);
    if (!cut && glazed) A.poly(m.exterior, k.poly, CH - 0.015, -1);
  }
}
// One straight piece of glazing in the opening `op` of edge e (wall thickness t): frame, glass, board, collider.
function rpWindow(ctx, S, e, op, t) {
  const { m, A, cut, sg, cg } = ctx, H = cut ? 1.1 : CH;
  const a0 = op.a0, a1 = op.a1, len = a1 - a0;
  const g = S.out ? t / 2 : clamp(t * 0.62, 0.05, Math.max(0.05, t - 0.07));
  const board = !S.out && op.y0 >= 0.3;
  const yb = op.y0 + (board ? 0.025 : 0), yt = Math.min(op.y1, H);
  const Pt = (s, w) => [e.a[0] + e.d[0] * s + e.n[0] * w, e.a[1] + e.d[1] * s + e.n[1] * w];
  if (board && op.y0 < H) A.ebox(m.stone, e.a, e.d, e.n, a0, a1, -0.035, g, op.y0, op.y0 + 0.025);
  if (!board && op.y0 <= 0.03) A.ebox(m.stone, e.a, e.d, e.n, a0, a1, 0, t, 0, 0.012);
  if (yt - yb > 0.12) {
    const ft = 0.05, fd = S.out ? 0.06 : 0.07, w0 = g - fd / 2, w1 = g + fd / 2, frm = m.frame;
    const curved = !!op.win.curved && (op.win.pts || []).length > 3;
    // on a curve the glazing line lies outside the room polygon: every chord is lengthened to meet its neighbours
    let x0 = a0, x1 = a1;
    if (curved) {
      const E = S.edges, i = E.indexOf(e), pe = E[(i + E.length - 1) % E.length], ne = E[(i + 1) % E.length];
      const ext = (d0, d1) => { const c = cross2(d0, d1), dt = dot2(d0, d1); return clamp(g * Math.tan(Math.atan2(c, dt) / 2), -0.25, 0.25); };
      if (a0 < 0.03) x0 = a0 - ext(pe.d, e.d);
      if (a1 > e.len - 0.03) x1 = a1 + ext(e.d, ne.d);
    }
    if (curved) {
      // segmented glass: a slim post at a joint about every metre of the curve (and at both ends of the glazing)
      const st = ctx.curveSt.get(op.win) || { acc: 9 }; ctx.curveSt.set(op.win, st);
      if (st.left == null) { st.left = 0; for (const f of S.edges) for (const o of f.ops) if (o.win === op.win) st.left++; }
      if (st.acc >= 0.9) { A.ebox(frm, e.a, e.d, e.n, x0 - 0.02, x0 + 0.02, w0, w1, yb, yt); st.acc = 0; }
      st.acc += len;
      if (--st.left <= 0) A.ebox(frm, e.a, e.d, e.n, x1 - 0.04, x1, w0, w1, yb, yt);
    } else {
      const n = Math.max(1, Math.round(len / 1.2)), pw = len / n;
      for (let k = 0; k <= n; k++) {
        const x = a0 + k * pw, x0 = k === 0 ? x : k === n ? x - ft : x - ft / 2;
        A.ebox(frm, e.a, e.d, e.n, x0, x0 + ft, w0, w1, yb, yt);
      }
    }
    A.ebox(frm, e.a, e.d, e.n, x0, x1, w0, w1, yb, yb + 0.045);
    if (!cut || yt < H - 0.001) A.ebox(frm, e.a, e.d, e.n, x0, x1, w0, w1, yt - 0.045, yt);
    if (!cut && !curved && yb < 0.3 && yt > 2.2 && (S.out || op.win.kind === 'panoramic')) A.ebox(frm, e.a, e.d, e.n, a0, a1, w0, w1, 1.06, 1.1);
    // V19: the first pane of a straight window is a tilt sash (bottom-hinged, the top tilts into the room at a tap)
    const tilt = !cut && !curved && !S.out && len >= 0.45 && yt - yb > 0.7;
    if (tilt) {
      const n = Math.max(1, Math.round(len / 1.2)), pw = len / n, sx0 = a0 + ft, sx1 = n > 1 ? a0 + pw - ft / 2 : a1 - ft, sy0 = yb + 0.045, sy1 = yt - 0.045;
      if (n > 1) A.ebox(m.glazing, e.a, e.d, e.n, a0 + pw, a1 - 0.02, g - 0.006, g + 0.006, yb + 0.03, yt - 0.03);
      const sw = sx1 - sx0, sh = sy1 - sy0, th = Math.atan2(-e.d[1], e.d[0]), zl = [-e.d[1], e.d[0]], sgn = (zl[0] * -e.n[0] + zl[1] * -e.n[1]) >= 0 ? 1 : -1;
      const base = Pt(sx0, g), mv = new THREE.Group(); mv.position.set(base[0], sy0, base[1]); mv.rotation.y = th;
      mv.userData.mover = { type: 'hinge', axis: 'x', angle: 0.105 * sgn, dur: 750, tag: 'window', part: 'window', keep: true };
      const fw = 0.045, dz = 0.056;
      FX.box(mv, sw, fw, dz, frm, sw / 2, 0, 0); FX.box(mv, sw, fw, dz, frm, sw / 2, sh - fw, 0);
      FX.box(mv, fw, sh - 2 * fw, dz, frm, fw / 2, fw, 0); FX.box(mv, fw, sh - 2 * fw, dz, frm, sw - fw / 2, fw, 0);
      FX.box(mv, sw - 2 * fw + 0.01, sh - 2 * fw + 0.01, 0.012, m.glazing, sw / 2, fw - 0.005, 0);
      const hz = sgn * (dz / 2 + 0.012), hx = sw - fw / 2;                       // tilt-and-turn handle on the room side
      FX.box(mv, 0.03, 0.07, 0.012, m.steel, hx, sh / 2 - 0.035, sgn * (dz / 2 + 0.006));
      FX.box(mv, 0.016, 0.13, 0.016, m.steel, hx, sh / 2 - 0.13, hz);
      sg.add(mv);
    } else
    A.ebox(m.glazing, e.a, e.d, e.n, curved ? x0 : a0 + 0.02, curved ? x1 : a1 - 0.02, g - 0.006, g + 0.006, yb + 0.03, yt - (cut ? 0 : 0.03));
  }
  ocollider(cg, Pt((a0 + a1) / 2, g), e.d, len / 2, 0.05, Math.max(0.02, Math.min(op.y0, 2.0)), 2.2).name = 'col-glass';
  if (!cut && !S.out && !ctx.noFx && len > 0.4) {
    // daylight falling in: brightest at the glass, fading into the room
    const dl = board ? 1.5 : 2.4, c = Pt((a0 + a1) / 2, -dl / 2), c2 = Pt((a0 + a1) / 2, -0.8);
    FX.fxQuad(sg, m.daylight, 'grad', [c[0], 0.006, c[1]], [e.d[0] * (len + 0.3), 0, e.d[1] * (len + 0.3)], [e.n[0] * dl, 0, e.n[1] * dl]);
    FX.fxQuad(sg, m.daylight, 'grad', [c2[0], CH - 0.006, c2[1]], [e.d[0] * len, 0, e.d[1] * len], [e.n[0] * 1.6, 0, e.n[1] * 1.6]);
  }
  ctx.wins.push({ S, e, op, t, g, len, mid: Pt((a0 + a1) / 2, 0), nin: [-e.n[0], -e.n[1]] });
}
function rpDownlight(ctx, u, y, v, lit = null) {
  const { m, sg } = ctx;
  if (ctx.cut) return;
  (ctx.downs ||= []).push([u, v]);                               // V18: the ceiling speakers keep clear of the downlights
  FX.cyl(sg, 0.05, 0.05, 0.004, m.fam === 'nordic' ? m.blackMetal : m.metal, u, y - 0.006, v, 20);
  if (lit) FX.disc(sg, 0.036, m.metal, u, y - 0.006, v, [HALF, 0, 0], 16);   // V19: the dark lens of a switched-off downlight
  FX.disc(lit || sg, 0.036, m.lightEmit, u, y - 0.0065, v, [HALF, 0, 0], 16);
  FX.bloom(lit || sg, u, y - 0.03, v, 0.22, 0.5);
}

// ---------------------------------------------------------------- doors
// Every door / passage of the data → threshold (+ walkable strip through the wall), frame and, for a door with a
// leaf, a hinged mover. Interior leaves hang on the drawn hinge and swing into the drawn room; they rest OPEN
// (opts.doors: 'closed' starts them shut — they then open when the camera comes near and close behind it); a tap
// toggles them. Balcony / terrace doors start closed and are listed in balconyDoors (the walkthrough opens them on
// approach). The entrance: opening, reveal, frame and the leaf the walkthrough operates (apt.doorLeaf — walk.js hides
// the hall's copy for a loaded flat); opts.entranceLeaf === false leaves the opening empty.
function rpDoors(ctx) {
  const { P, I, m, A, cut, cg, sg, unit } = ctx;
  for (const d of P.doors) {
    const t = Math.max(0, +d.t || 0), hw = d.w / 2, dir = d.dir, n = d.n || [-dir[1], dir[0]];
    const r0 = P.byId.get(d.rooms && d.rooms[0]) || null, r1 = P.byId.get(d.rooms && d.rooms[1]) || null;
    const Pt = (s, w) => [d.p[0] + dir[0] * s + n[0] * w, d.p[1] + dir[1] * s + n[1] * w];
    const h = d.type === 'passage' ? null : Math.min(+d.h || RDOOR[d.type] || 2.05, CH - 0.05);
    const rec = { id: d.id, type: d.type, rooms: (d.rooms || []).slice(), u: d.p[0], v: d.p[1], p: [d.p[0], d.p[1]], dir: [dir[0], dir[1]], n: [n[0], n[1]], w: d.w, t, h,
      axis: Math.abs(dir[0]) >= Math.abs(dir[1]) ? 'u' : 'v', fixed: !!d.fixed, est: !!d.est, swing: d.swing || null, hinge: d.hinge ? [d.hinge[0], d.hinge[1]] : null, state: d.type === 'passage' ? 'none' : 'closed', open: false, y: 0, level: 0 };
    ctx.doors.push(rec);
    // floor through the wall + its walkable strip
    if (t > 0.015) {
      const ht = t / 2 + 0.006;
      const fm = d.type === 'passage' || d.type === 'interior' ? rpFloorMat(m, r1 && !r1.out ? r1 : r0 || r1 || { kind: 'hall' }) : m.stone;
      A.hquad(fm, Pt(-hw, -ht), Pt(hw, -ht), Pt(hw, ht), Pt(-hw, ht), d.type === 'passage' || d.type === 'interior' ? 0 : 0.004, 1);
      if (!cut && d.type === 'passage') A.hquad(m.ceiling, Pt(-hw, -ht), Pt(hw, -ht), Pt(hw, ht), Pt(-hw, ht), CH, -1);
    }
    if (d.type === 'entrance') ocollider(cg, Pt(0, -0.15), dir, hw + 0.05, t / 2 + 0.3, -0.2, 0, 'floor');
    else ocollider(cg, d.p, dir, hw, t / 2 + 0.16, -0.2, d.type === 'balcony' ? 0.006 : 0, 'floor');
    if (d.type === 'passage') { ctx.zones.push({ c: d.p, d: dir, hl: Math.max(0.3, hw - 0.05), hw: Math.min(0.55, 0.25 + d.w * 0.12), kind: 'passage', id: d.id }); continue; }
    if (d.fixed) {
      // a glazed door that leads nowhere in this model (see rpPlan): shut for good — frame, leaf and a solid collider
      const g0 = -t / 2 + clamp(t * 0.62, 0.05, Math.max(0.05, t - 0.07)), hh = cut ? 1.1 : h;
      for (const sx of [-1, 1]) A.ebox(m.frame, d.p, dir, n, sx < 0 ? -hw : hw - 0.07, sx < 0 ? -hw + 0.07 : hw, g0 - 0.03, g0 + 0.03, 0, hh);
      A.ebox(m.frame, d.p, dir, n, -hw, hw, g0 - 0.03, g0 + 0.03, 0, 0.1);
      if (!cut) A.ebox(m.frame, d.p, dir, n, -hw, hw, g0 - 0.03, g0 + 0.03, h - 0.07, h);
      A.ebox(m.glazing, d.p, dir, n, -hw + 0.07, hw - 0.07, g0 - 0.005, g0 + 0.005, 0.1, hh - (cut ? 0 : 0.07));
      ocollider(cg, Pt(0, g0), dir, hw, 0.05, 0.02, 2.2).name = 'col-glass';
      rec.state = 'fixed';
      continue;
    }
    // swing side: +1 = towards rooms[1] (along n)
    let sgn = d.swing ? (d.swing === (d.rooms && d.rooms[1]) ? 1 : -1) : d.type === 'balcony' ? 1 : d.type === 'entrance' ? 1 : -1;
    const hingeAt = d.hinge ? dot2(sub2(d.hinge, d.p), dir) : -hw;                  // along dir from the centre (−hw: the data's rule)
    const hs = hingeAt <= 0 ? -1 : 1;
    rec.swingSign = sgn;
    // keep-out zones: the swept quarter and the approach on the other side
    ctx.zones.push({ c: Pt(0, sgn * (t / 2 + d.w / 2)), d: dir, hl: hw + 0.03, hw: d.w / 2 + 0.02, kind: 'swing', id: d.id, hinge: Pt(hs * hw, sgn * t / 2), r: d.w, type: d.type });
    if (d.type === 'balcony') for (const sd of [-1, 1]) ctx.zones.push({ c: Pt(0, sd * (t / 2 + 0.3)), d: dir, hl: hw + 0.2, hw: 0.3, core: hw, kind: 'approach', id: d.id, type: 'balcony', fixed: true });
    else ctx.zones.push({ c: Pt(0, -sgn * (t / 2 + 0.35)), d: dir, hl: hw, hw: 0.35, kind: 'approach', id: d.id, type: d.type });
    if (cut) { rec.leaf = { d, sgn, hs, hw, t, h, lt: 0.04 }; continue; }
    // ---- frame: linings in the reveal + architraves on both faces (a glazed door: a slim metal frame at the leaf)
    const fm = d.type === 'balcony' ? m.frame : m.doorFrame;
    const lt = d.type === 'balcony' ? 0.05 : d.type === 'entrance' ? 0.06 : 0.04;
    const g0 = -t / 2 + clamp(t * 0.62, 0.05, Math.max(0.05, t - 0.07));     // plane of a glazed door's frame, along n from the wall centre
    if (d.type !== 'balcony') {
      for (const sx of [-1, 1]) A.ebox(fm, d.p, dir, n, sx < 0 ? -hw : hw - 0.015, sx < 0 ? -hw + 0.015 : hw, -t / 2, t / 2, 0, h);
      A.ebox(fm, d.p, dir, n, -hw, hw, -t / 2, t / 2, h - 0.015, h);
      for (const f of d.type === 'entrance' ? [1] : [-1, 1]) {
        const w0 = f > 0 ? t / 2 : -t / 2 - 0.014, w1 = f > 0 ? t / 2 + 0.014 : -t / 2;
        A.ebox(fm, d.p, dir, n, -hw - 0.065, -hw, w0, w1, 0, h + 0.065);
        A.ebox(fm, d.p, dir, n, hw, hw + 0.065, w0, w1, 0, h + 0.065);
        A.ebox(fm, d.p, dir, n, -hw, hw, w0, w1, h, h + 0.065);
      }
    } else {
      for (const sx of [-1, 1]) A.ebox(fm, d.p, dir, n, sx < 0 ? -hw : hw - 0.04, sx < 0 ? -hw + 0.04 : hw, g0 - 0.035, g0 + 0.035, 0, h);
      A.ebox(fm, d.p, dir, n, -hw, hw, g0 - 0.035, g0 + 0.035, h - 0.04, h);
    }
    rec.leaf = { d, sgn, hs, hw, t, h, lt };
  }
}
// How far (radians, ≤ max) a leaf of width w hinged at `hinge` can swing from the closed direction ld towards sw
// before it meets a placed piece.
function rpSweep(ctx, hinge, ld, sw, w, max) {
  let ok = 0;
  for (let a = 0.12; a <= max + 1e-6; a += 0.087) {
    const dx = ld[0] * Math.cos(a) + sw[0] * Math.sin(a), dy = ld[1] * Math.cos(a) + sw[1] * Math.sin(a);
    let hit = false;
    for (let k = 2; k <= 8 && !hit; k++) {
      const p = [hinge[0] + dx * w * k / 8, hinge[1] + dy * w * k / 8];
      for (const q of ctx.occ) { const r = sub2(p, q.c); if (Math.abs(dot2(r, q.d)) < q.hl + 0.03 && Math.abs(cross2(q.d, r)) < q.hw + 0.03) { hit = true; break; } }
    }
    if (hit) break;
    ok = a;
  }
  return Math.min(max, ok + 0.05);
}
// Second pass (after the drawn fixtures stand): the leaves. A leaf swings as drawn; where a drawn piece stands in its
// way it swings to the other side if that is free, else it opens as far as it can.
function rpLeaves(ctx) {
  const { P, m, sg, cg, unit, cut } = ctx;
  for (const rec of ctx.doors) {
    const L = rec.leaf; if (!L) continue;
    delete rec.leaf;
    const { d, hw, t, h, lt } = L, dir = d.dir, n = d.n || [-dir[1], dir[0]];
    let sgn = L.sgn, hs = L.hs;
    const Pt = (s, w) => [d.p[0] + dir[0] * s + n[0] * w, d.p[1] + dir[1] * s + n[1] * w];
    let ld = [-hs * dir[0], -hs * dir[1]];
    const OPEN = d.type === 'balcony' ? 1.5 : d.type === 'entrance' ? 1.62 : 1.56;
    const free = (sg2) => {
      const tip = Pt(0, sg2 * (t / 2 + d.w * 0.6));
      if (!(d.type === 'entrance' && sg2 < 0) && !P.spaces.some(S => pointInPoly(tip, S.poly))) return 0;
      return rpSweep(ctx, Pt(hs * hw, sg2 * t / 2), ld, [n[0] * sg2, n[1] * sg2], d.w, OPEN);
    };
    if ((ctx.sb && ctx.sb.flip && ctx.sb.flip.has(d.id)) || (ctx.flip && ctx.flip.has(d.id))) sgn = -sgn;
    let ang = free(sgn);
    if (d.type === 'entrance' && !d.swing) {
      // The swing of this entrance door is not on the drawing: it is hung to open into the flat. Where the open leaf
      // would then stand across the only way in (4A04: a 0.95 m entrance hall, a 0.93 m leaf) it is hung on the other
      // jamb, and where that does not help either it opens outwards, into the common hall (as 311 flats are drawn).
      const shut = (h2, s2) => {
        const hp = Pt(h2 * hw, s2 * t / 2), od = [n[0] * s2, n[1] * s2];
        return rpBlocks(ctx, { c: add2(hp, od, d.w / 2), d: od, hl: d.w / 2, hw: 0.04 });
      };
      if (sgn > 0 && shut(hs, 1)) {
        if (!shut(-hs, 1)) { hs = -hs; ld = [-hs * dir[0], -hs * dir[1]]; ctx.notes.push('entrance door ' + d.id + ': swing not drawn — hung on the other jamb (the open leaf would close the way in)'); }
        else { sgn = -1; ctx.notes.push('entrance door ' + d.id + ': swing not drawn — opens into the common hall (inwards the open leaf would close the way in)'); }
        ang = free(sgn);
      }
      // … and a leaf that opens inwards rests against the side wall next to its jamb: hung on the far jamb it would
      // stand free in the entrance hall and, with a wardrobe placed by rule behind it, pocket the visitor between
      // leaf, wall and wardrobe (4A04: 1.26 m of hall behind the leaf on one jamb, 0.17 m on the other).
      if (sgn > 0) {
        const behind = (h2) => { let s = 0; for (; s < 2; s += 0.05) { const q = Pt(h2 * (hw + 0.03 + s), t / 2 + d.w * 0.5); if (!P.rooms.some(S => pointInPoly(q, S.poly))) break; } return s; };
        const b0 = behind(hs), b1 = behind(-hs);
        if (b0 > 0.6 && b1 < b0 - 0.3 && !shut(-hs, 1)) {
          const keep = [hs, ld, ang];
          hs = -hs; ld = [-hs * dir[0], -hs * dir[1]];
          const a2 = free(sgn);
          if (a2 >= OPEN - 0.12) { ang = a2; ctx.notes.push('entrance door ' + d.id + ': swing not drawn — hung on the jamb next to the side wall (the open leaf rests against it)'); }
          else { hs = keep[0]; ld = keep[1]; ang = keep[2]; }
        }
      }
    }
    if (ang < OPEN - 0.12) {
      const other = free(-sgn);
      if (other > ang + 0.2) { sgn = -sgn; ang = other; ctx.notes.push('door ' + d.id + ' swings to the other side (a drawn piece stands in its way)'); }
      if (ang < OPEN - 0.12) ctx.notes.push('door ' + d.id + ' opens ' + Math.round(ang * 57.3) + '° only');
      ang = Math.max(0.5, ang);
    }
    rec.swingSign = sgn; rec.openAngle = ang; rec.hingeSide = hs;
    const z = ctx.zones.find(q => q.kind === 'swing' && q.id === d.id);
    if (z) { z.c = Pt(0, sgn * (t / 2 + d.w / 2)); z.hinge = Pt(hs * hw, sgn * t / 2); z.angle = ang; z.ld = ld; z.sw = [n[0] * sgn, n[1] * sgn]; }
    const za = ctx.zones.find(q => q.kind === 'approach' && q.id === d.id && !q.fixed);
    if (za) za.c = Pt(0, -sgn * (t / 2 + 0.35));
    if (cut) continue;
    // plane of the leaf, measured along n from the wall centre
    const g0 = d.type === 'balcony' ? -t / 2 + clamp(t * 0.62, 0.05, Math.max(0.05, t - 0.07)) : d.type === 'entrance' ? -t / 2 + 0.04 : sgn * Math.max(0, t / 2 - 0.03);
    const lw = d.w - (d.type === 'balcony' ? 0.09 : 0.04), lh = h - (d.type === 'balcony' ? 0.05 : 0.02);
    const hx = hs * (hw - (d.type === 'balcony' ? 0.045 : 0.02));
    const piv = Pt(hx, g0);
    // local frame of the leaf: +x from the hinge to the latch, +z = lz
    const lz = [-ld[1], ld[0]], side = dot2(lz, n) * sgn >= 0 ? 1 : -1;
    const ry = Math.atan2(-ld[1], ld[0]);
    rec.hingeAt = [piv[0], piv[1]]; rec.leafDir = ld;
    if (d.type === 'entrance') {
      if (ctx.opts.entranceLeaf === false) continue;
      rpEntranceLeaf(ctx, rec, piv, ry, -side * ang, lw, lh, lt);
      continue;
    }
    const r0 = P.byId.get(d.rooms && d.rooms[0]) || null;
    const lf = new THREE.Group(); lf.position.set(piv[0], 0.008, piv[1]); lf.rotation.y = ry;
    const bx = (x0, x1, y0, y1, z0, z1, mat) => box(lf, mat, x0, y0, z0, x1, y1, z1);
    if (d.type === 'balcony') {
      const stl = 0.07, T = lt, hm = m.fam === 'nordic' ? m.blackMetal : (m.brass || m.metal);
      bx(0, stl, 0, lh, -T / 2, T / 2, m.frame); bx(lw - stl, lw, 0, lh, -T / 2, T / 2, m.frame);
      bx(stl, lw - stl, 0, 0.1, -T / 2, T / 2, m.frame); bx(stl, lw - stl, lh - stl, lh, -T / 2, T / 2, m.frame);
      bx(stl, lw - stl, 0.1, lh - stl, -0.005, 0.005, m.glazing);
      for (const z2 of [-1, 1]) { bx(lw - stl / 2 - 0.012, lw - stl / 2 + 0.012, 1.0, 1.14, z2 > 0 ? T / 2 : -T / 2 - 0.01, z2 > 0 ? T / 2 + 0.01 : -T / 2, hm); bx(lw - stl / 2 - 0.13, lw - stl / 2 + 0.01, 1.08, 1.1, z2 > 0 ? T / 2 + 0.03 : -T / 2 - 0.05, z2 > 0 ? T / 2 + 0.05 : -T / 2 - 0.03, hm); }
      lf.userData.mover = { type: 'hinge', axis: 'y', angle: -side * ang, dur: 1000, tag: 'balconyDoor', door: d.id };
    } else {
      bx(0, lw, 0, lh, -lt / 2, lt / 2, m.doorLeaf);
      if (m.styleId === 'paris') for (const z2 of [-lt / 2 - 0.002, lt / 2 + 0.002]) { FX.mouldFrame(lf, m.moulding, lw / 2, 0.16, 0.9, lw - 0.26, z2, 0.024, 0.008); FX.mouldFrame(lf, m.moulding, lw / 2, 1.02, lh - 0.16, lw - 0.26, z2, 0.024, 0.008); }
      for (const z2 of [-1, 1]) { bx(lw - 0.17, lw - 0.04, 1.01, 1.03, z2 > 0 ? lt / 2 + 0.03 : -lt / 2 - 0.05, z2 > 0 ? lt / 2 + 0.05 : -lt / 2 - 0.03, m.metal); bx(lw - 0.075, lw - 0.055, 1.0, 1.04, z2 > 0 ? lt / 2 : -lt / 2 - 0.03, z2 > 0 ? lt / 2 + 0.03 : -lt / 2, m.metal); }
      lf.userData.mover = { type: 'hinge', axis: 'y', angle: -side * ang, dur: 900, tag: 'door', idoor: d.id, part: 'door' };
    }
    sg.add(lf);
    rec.collider = ocollider(cg, d.p, dir, hw, Math.max(0.05, t / 2), 0.02, 2.2);
    rec.collider.name = d.type === 'balcony' ? 'col-balcony-door' : 'col-door';
    rec.collider.userData[d.type === 'balcony' ? 'balconyDoor' : 'interiorDoor'] = d.id;
    rec.kind = d.sliding ? 'slide' : 'french';
    rec.room = r0 ? r0.kind : 'living'; rec.roomName = r0 ? r0.name : '';
    // compat fields of the fitted-box builder (walk.js): a door along u spans p0 … p1 at v; one along v has p0 = p1 = u
    // and its extent a0 … a1 along v, out = ±1 the outward direction along u
    if (rec.axis === 'u') { rec.p0 = d.p[0] - hw * Math.abs(dir[0]); rec.p1 = d.p[0] + hw * Math.abs(dir[0]); rec.a0 = rec.p0; rec.a1 = rec.p1; rec.out = n[1] >= 0 ? 1 : -1; }
    else { rec.p0 = rec.p1 = d.p[0]; rec.a0 = d.p[1] - hw * Math.abs(dir[1]); rec.a1 = d.p[1] + hw * Math.abs(dir[1]); rec.out = n[0] >= 0 ? 1 : -1; }
    if (d.type === 'balcony') { rec.side = rpSideOf(unit, d.p, n); ctx.balconyDoors.push(rec); } else ctx.idoors.push(rec);
  }
}
function rpSideOf(unit, p, n) {
  if (Math.abs(n[0]) > Math.abs(n[1])) return n[0] < 0 ? 'left' : 'right';
  return n[1] < 0 ? 'back' : 'front';
}
// V20 (v0.7.1): the flat's entrance leaf and the corridor leaf it stands in for are ONE door. The corridor shows the
// commons leaf (walnut of the building finish + brass trim) while the flat is not built; once it is, walk.js hides that
// leaf and this one is operated — it used to wear the interior style's door material (white in Nordic / Paris, cream in
// Riviera, dark oak in Milano) so the door changed colour the moment it was tapped. leaf.userData.dress(body, trim) puts the
// corridor leaf's own materials on it (both faces, edges, handles) with the same world-scale veneer projection and the
// same brass inlay lines + peephole, so it looks exactly the same closed, while opening and open; dress(null) undoes it.
// cx, cy: centre of the leaf body in the leaf's local frame; w, h, t: its size; hx: x of the handles (peephole above them).
function wireEntranceDress(leaf, cx, cy, w, h, t, hx) {
  const styleMats = leaf.material.slice();
  let trim = null, uvStyle = null;
  leaf.userData.styleMats = styleMats;
  leaf.userData.dress = (body, metal) => {
    const g = leaf.geometry;
    if (!body) {
      if (uvStyle) { g.setAttribute('uv', uvStyle); uvStyle = null; }
      leaf.material = styleMats; if (trim) trim.visible = false; leaf.userData.dressed = null; return;
    }
    if (!uvStyle) {
      uvStyle = g.attributes.uv;
      const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {   // commons.js worldUV(…, 1) of a box centred on the leaf
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i) - cx, y = p.getY(i) - cy, z = p.getZ(i);
        if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const mt = metal || styleMats[1];
    leaf.material = [body, mt];
    if (!trim) {
      // brass inlay lines at −0.55 / 0 / +0.55 m from the middle and the peephole ring 0.37 m over the handle, on both faces
      // (as commons.js doorLeaf)
      const parts = [], h2 = t / 2;
      for (const s of [1, -1]) {
        for (const y of [0.55, 0, -0.55]) { const b = new THREE.BoxGeometry(w - 0.2, 0.008, 0.005).toNonIndexed(); b.translate(cx, cy + y, s * (h2 + 0.0015)); parts.push(b); }
        const r = new THREE.BoxGeometry(0.04, 0.04, 0.005).toNonIndexed(); r.translate(hx, 1.05 + 0.37, s * (h2 + 0.0025)); parts.push(r);
      }
      trim = new THREE.Mesh(mergeGeometries(parts, false), mt); parts.forEach(b => b.dispose());
      trim.name = 'apt-door-trim'; trim.raycast = () => {};
      leaf.add(trim);
    }
    trim.material = mt; trim.visible = true;
    leaf.userData.dressed = { body, metal: mt };
  };
}
function rpEntranceLeaf(ctx, rec, piv, ry, angle, lw, lh, lt) {
  const { m, unit } = ctx;
  let leafG = new THREE.BoxGeometry(lw, lh, lt).toNonIndexed();
  leafG.translate(lw / 2, lh / 2, 0);
  const hdl = [];
  for (const side of [1, -1]) {
    const g1 = new THREE.BoxGeometry(0.02, 0.02, 0.06).toNonIndexed(); g1.translate(lw - 0.08, 1.05, side * (lt / 2 + 0.03)); hdl.push(g1);
    const g2 = new THREE.BoxGeometry(0.16, 0.022, 0.022).toNonIndexed(); g2.translate(lw - 0.14, 1.05, side * (lt / 2 + 0.035)); hdl.push(g2);
  }
  const hg = mergeGeometries(hdl), leafGeo = mergeGeometries([leafG, hg], true);
  leafG.dispose(); hg.dispose(); hdl.forEach(g => g.dispose());
  const leaf = new THREE.Mesh(leafGeo, [m.doorLeaf, m.metal]); leaf.name = 'apt-door-leaf';
  wireEntranceDress(leaf, lw / 2, lh / 2, lw, lh, lt, lw - 0.08);
  const pivot = new THREE.Group(); pivot.name = 'apt-door-hinge'; pivot.add(leaf); pivot.userData.keep = true;
  const holder = new THREE.Group(); holder.name = 'apt-door'; holder.position.set(piv[0], 0.01, piv[1]); holder.rotation.y = ry; holder.add(pivot);
  leaf.userData.solid = true; leaf.userData.dynamic = true; leaf.userData.doorLeaf = true; leaf.userData.unitId = unit.id;
  leaf.userData.action = { type: 'aptDoor', unitId: unit.id };
  let anim = null;
  leaf.userData.toggle = (open) => {
    const want = open === undefined ? !leaf.userData._open : !!open;
    if (want === !!leaf.userData._open && !anim) return Promise.resolve();
    leaf.userData._open = want; leaf.userData.open = want; rec.open = want;
    const from = pivot.rotation.y, to = want ? angle : 0, t0 = performance.now(), dur = 800;
    if (anim) anim.cancel = true;
    const me = anim = { cancel: false };
    leaf.userData._anim = true;
    return new Promise(res => {
      const step = () => {
        if (me.cancel) return res();
        const k = Math.min(1, (performance.now() - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        pivot.rotation.y = from + (to - from) * e; pivot.updateMatrixWorld(true);
        if (k < 1) requestAnimationFrame(step); else { anim = null; leaf.userData._anim = false; res(); }
      };
      step();
    });
  };
  rec.toggle = leaf.userData.toggle;
  ctx.door = { leaf, pivot, holder };
  ctx.root.add(holder);
}

// ---------------------------------------------------------------- furnishing
// Oriented rectangles in plan: {c, d (unit, along the length), hl, hw}.
function rectOverlap(A, B, pad = 0) {
  const axes = [A.d, [-A.d[1], A.d[0]], B.d, [-B.d[1], B.d[0]]];
  const rel = [B.c[0] - A.c[0], B.c[1] - A.c[1]];
  for (const ax of axes) {
    const ra = Math.abs(dot2(A.d, ax)) * A.hl + Math.abs(cross2(A.d, ax)) * A.hw, rb = Math.abs(dot2(B.d, ax)) * B.hl + Math.abs(cross2(B.d, ax)) * B.hw;
    if (Math.abs(dot2(rel, ax)) > ra + rb + pad - 1e-9) return false;
  }
  return true;
}
function rectPts(R, shrink = 0) {
  const hl = Math.max(0.01, R.hl - shrink), hw = Math.max(0.01, R.hw - shrink), d = R.d, n = [-d[1], d[0]], out = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0], [0, 0]]) out.push([R.c[0] + d[0] * hl * a + n[0] * hw * b, R.c[1] + d[1] * hl * a + n[1] * hw * b]);
  return out;
}
const rectInPoly = (R, poly, tol = 0.03) => rectPts(R, tol).every(p => pointInPoly(p, poly));
// Is the rectangle free in space S: inside its polygon, clear of the placed pieces, of columns and (unless o.zones
// === false) of door swings, approaches and passages?
function rpFree(ctx, S, R, o = {}) {
  if (o.anyRoom ? !rectPts(R, o.tol ?? 0.03).every(p => ctx.P.rooms.some(T => pointInPoly(p, T.poly))) : !rectInPoly(R, S.poly, o.tol ?? 0.03)) return false;
  for (const q of ctx.occ) if (q !== o.skip && rectOverlap(R, q, o.pad ?? -0.012)) return false;
  for (const c of ctx.I.columns || []) if (Math.hypot(c.c[0] - R.c[0], c.c[1] - R.c[1]) < (c.r || 0.25) + Math.max(R.hl, R.hw) && rectOverlap(R, { c: c.c, d: [1, 0], hl: c.r || 0.25, hw: c.r || 0.25 })) return false;
  if (o.zones !== false) for (const z of ctx.zones) { if (o.passages === false && z.kind === 'passage') continue; if (rectOverlap(R, z, -0.01)) return false; }
  return true;
}
// Place a furniture group; registers its footprint. o.box: {w, d, x?, z?} overrides the piece's solidBox for the
// footprint (pieces without a collider that still take floor), o.free: no footprint.
function rpPut(ctx, S, obj, p, ang, y = 0, o = {}) {
  put(ctx.g, obj, p[0], p[1], ang, y);
  const sb = o.box || (obj.userData.noSolid ? null : obj.userData.solidBox);
  if (sb && !o.free) {
    const xv = [Math.cos(ang), -Math.sin(ang)], fv = [Math.sin(ang), Math.cos(ang)];
    const c = [p[0] + xv[0] * (sb.x || 0) + fv[0] * (sb.z || 0), p[1] + xv[1] * (sb.x || 0) + fv[1] * (sb.z || 0)];
    const rec = { c, d: xv, hl: sb.w / 2, hw: sb.d / 2, h: sb.h || 1, tag: o.tag || obj.userData.piece || '', room: S ? S.id : null, y };
    if (y < 0.5) ctx.occ.push(rec);
    obj.userData.rpRect = rec;
  }
  return obj;
}
const angOf = f => Math.atan2(f[0], f[1]);                    // rotation.y of a piece whose front (+z) looks along f
const xOf = ang => [Math.cos(ang), -Math.sin(ang)];
// does a footprint stand in front of a window of S (within `depth` of the glass)?
function rpWinFront(S, R, depth = 0.5) {
  for (const seg of S.segs) for (const q of seg.wins) {
    if (q.s1 - q.s0 < 0.05) continue;
    if (rectOverlap(R, { c: add2(add2(seg.a, seg.d, (q.s0 + q.s1) / 2), seg.nin, depth / 2), d: seg.d, hl: (q.s1 - q.s0) / 2, hw: depth / 2 }, -0.02)) return true;
  }
  return false;
}
// Free stretch along a wall of S: a w × d footprint with its back on the wall. o: tall (no window behind), h (height
// of the piece: windows with a lower sill are refused), clear (free depth in front), score(p, seg, s) → higher is better.
function rpWallSpot(ctx, S, w, d, o = {}) {
  let best = null;
  for (const seg of S.segs) {
    if (seg.len < w - 1e-3) continue;
    if (o.cls && !o.cls(seg)) continue;
    const xs = [];
    for (let s = w / 2; s <= seg.len - w / 2 + 1e-6; s += 0.1) xs.push(s);
    xs.push(seg.len - w / 2);
    if (seg.len > w + 0.6) xs.push(seg.len / 2);
    for (const s of xs) {
      if (seg.wins.some(q => q.s1 > s - w / 2 + 0.02 && q.s0 < s + w / 2 - 0.02 && (o.tall || q.sill < (o.h ?? 0.8) + 0.02))) continue;
      const p = add2(seg.a, seg.d, s), c = add2(p, seg.nin, d / 2 + 0.012);
      const R = { c, d: seg.d, hl: w / 2, hw: d / 2 };
      if (!rpFree(ctx, S, R, o)) continue;
      if (o.winFront && rpWinFront(S, R, o.winFront)) continue;
      if (o.clear) {
        const Rc = { c: add2(p, seg.nin, d + 0.012 + o.clear / 2), d: seg.d, hl: Math.max(0.1, w / 2 - 0.08), hw: o.clear / 2 };
        if (!rpFree(ctx, S, Rc, { zones: false, tol: 0.02 })) continue;
      }
      const end = Math.min(s - w / 2, seg.len - s - w / 2);
      const sc = (o.score ? o.score(p, seg, s, c) : 0) + (o.corner ? -end * (o.corner === true ? 1 : o.corner) : 0) + (o.centre ? -Math.abs(s - seg.len / 2) * o.centre : 0);
      if (!best || sc > best.sc + 1e-9) best = { sc, p, c, seg, s, nin: seg.nin, d: seg.d, ang: angOf(seg.nin) };
    }
  }
  return best;
}
// The four sides of a drawn fixture box and how far the room's boundary is beyond each.
function rpSides(S, f) {
  const r = (+f.rot || 0) * PI / 180, e1 = [Math.cos(r), Math.sin(r)], e2 = [-Math.sin(r), Math.cos(r)];
  const s1 = Math.max(0.05, +f.s[0]), s2 = Math.max(0.05, +f.s[1]), c = [+f.c[0], +f.c[1]];
  const mk = (dir, half, w) => {
    // (three rays across the side: a notch or an opening beside the middle does not fool the measure)
    const px = [-dir[1], dir[0]];
    // (measured to the WALLS — the solid stretches — not to an open edge towards the next room)
    let g = Infinity;
    for (const k of [-0.3, 0, 0.3]) { const q = add2(c, px, k * w); g = Math.min(g, raySegs(q, dir, S.segs)); }
    return { dir, half, w, gap: g - half };
  };
  return { c, s1, s2, sides: [mk(e1, s1 / 2, s2), mk([-e1[0], -e1[1]], s1 / 2, s2), mk(e2, s2 / 2, s1), mk([-e2[0], -e2[1]], s2 / 2, s1)] };
}
function raySegs(p, d, segs) {
  let best = Infinity;
  for (const s of segs) {
    const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1], den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ax = s.a[0] - p[0], ay = s.a[1] - p[1], t = (ax * ey - ay * ex) / den, k = (ax * d[1] - ay * d[0]) / den;
    if (t > 1e-6 && k >= -0.02 && k <= 1.02 && t < best) best = t;
  }
  return best;
}
// Which side is the back. mode: 'long' (the back is a long side), 'short', 'any'.
function rpBack(S, f, mode = 'any', o = {}) {
  const B = rpSides(S, f), sq = Math.abs(B.s1 - B.s2) < 0.08;
  let c = B.sides;
  if (!sq && mode === 'long') c = c.filter(s => s.w >= Math.max(B.s1, B.s2) - 1e-6);
  if (!sq && mode === 'short') c = c.filter(s => s.w <= Math.min(B.s1, B.s2) + 1e-6);
  if (o.filter) { const k = c.filter(o.filter); if (k.length) c = k; }
  const toC = sub2(S.c, B.c), l = len2(toC) || 1;
  const score = s => Math.max(-0.05, s.gap) + (s.gap > (o.snap ?? 0.3) + 0.05 ? 1 : 0) + 0.04 * dot2(s.dir, toC) / l;      // near a wall, front towards the room
  const s = c.slice().sort((p, q) => score(p) - score(q))[0];
  const lim = o.snap ?? 0.3, front = [-s.dir[0], -s.dir[1]], snap = s.gap < lim ? Math.max(-0.1, s.gap) : 0;
  return { c: B.c, back: s.dir, front, gap: s.gap, w: s.w, dp: s.half * 2, wall: add2(B.c, s.dir, s.half + snap), ang: angOf(front), atWall: s.gap < lim, B };
}
// how far a piece of the given depth can reach along ±x from the wall point without leaving the room
function rpReach(S, wall, front, xv, depth) {
  const q = add2(wall, front, Math.min(depth, 0.3));
  if (!pointInPoly(q, S.poly)) return [0, 0];
  return [rayPoly(q, [-xv[0], -xv[1]], S.poly) - 0.015, rayPoly(q, xv, S.poly) - 0.015];
}
function rpMirror(ctx, S, p, ang, vl) {
  const { m } = ctx;
  if (ctx.cut) return;
  const mw = clamp(vl - 0.1, 0.4, 0.9), mh = m.fam === 'nordic' ? mw : 0.95;
  rpPut(ctx, S, F.mirror(m, { w: mw, h: mh, cabinet: true }), p, ang, m.fam === 'nordic' ? 1.05 : 1.08, { free: true });
}
// table + chairs (+ settings, pendant) as one group, long axis = local x
function rpDiningSet(ctx, tl, tw, sides = 2, pend = true) {
  const { m } = ctx, grp = new THREE.Group();
  put(grp, F.diningTable(m, { len: tl, width: tw }), 0, 0, 0);
  const nC = Math.max(1, Math.floor(tl / 0.6));
  for (let i = 0; i < nC; i++) {
    const cu = -tl / 2 + tl / nC * (i + 0.5);
    for (const side of sides === 2 ? [-1, 1] : [1]) {
      put(grp, F.diningChair(m), cu, side * (tw / 2 + 0.12), side < 0 ? 0 : PI);
      put(grp, F.tableSetting(m, { y: 0.76 }), cu, side * (tw / 2 - 0.2), side < 0 ? PI : 0);
    }
  }
  if (!ctx.cut && pend) {
    put(grp, F.pendant(m, { kind: 'dining', drop: 0.85, len: Math.min(1.2, Math.max(0.5, tl - 0.3)) }), 0, 0, 0, CH);
    FX.fxFlat(grp, m.glowFaint, 'rect', 0, 0.762, 0, tl + 0.3, tw + 0.25);
    FX.fxFlat(grp, m.glowFaint, 'disc', 0, 0.006, 0, tl + 2.2, tw + 2.2);
  }
  grp.userData.solidBox = { w: tl + 0.06, d: tw + 0.06, h: 0.8 };
  grp.userData.piece = 'dining';
  return grp;
}
// Walk-in shower in a w × d box centred on c: the back and the +x side want a wall.
function rpShower(ctx, S, c, w, d) {
  const { m } = ctx;
  let best = null;
  for (const [bd, hb, hx] of [[[1, 0], w / 2, d / 2], [[-1, 0], w / 2, d / 2], [[0, 1], d / 2, w / 2], [[0, -1], d / 2, w / 2]]) {
    const f = [-bd[0], -bd[1]], ang = angOf(f), xv = xOf(ang);
    const gb = rayPoly(c, bd, S.poly) - hb, gx = rayPoly(c, xv, S.poly) - hx;
    const sc = Math.min(1, Math.abs(gb)) + Math.min(1, Math.abs(gx)) * 0.9;
    if (!best || sc < best.sc) best = { sc, bd, f, ang, gb, W: hx * 2, D: hb * 2, hb };
  }
  const W = clamp(best.W, 0.75, 1.6), D = clamp(best.D, 0.75, 1.1);
  const wall = add2(c, best.bd, best.hb + (Math.abs(best.gb) < 0.25 ? best.gb : 0));
  const sh = F.shower(m, { w: W, d: D, h: ctx.cut ? 1.05 : 2.0 });
  rpPut(ctx, S, sh, wall, best.ang, 0, { box: { w: W, d: D, z: D / 2 }, tag: 'shower' });
  const gp = sh.userData.glassPanel;
  if (gp) collider(sh, gp.x - gp.w / 2, 0.02, gp.z - 0.03, gp.x + gp.w / 2, 1.08, gp.z + 0.03).name = 'col-furniture';
  return sh;
}

// ---- walkability guard. A coarse grid (10 cm) of the flat: a cell is walkable when it lies in a space (or in a door
// opening) at least a body's half-width from the walls. rpReach0() counts the targets (both sides of every door, an
// inner point of every space) reached from the entrance with the placed pieces as obstacles; a rule-based piece that
// lowers the count is taken out again (rpTry).
const NAV_R = 0.27, NAV_TIGHT = 0.25;
function rpNav(P, I, G = 0.1, NAV_R = 0.27) {
  const key = (G === 0.1 ? 'nav' : 'navFine') + (NAV_R === 0.27 ? '' : NAV_R);
  if (P[key]) return P[key];
  const bb = P.bbox, u0 = bb.u0 - 0.2, v0 = Math.min(bb.v0, 0) - 0.4, nx = Math.ceil((bb.u1 + 0.2 - u0) / G), nz = Math.ceil((bb.v1 + 0.2 - v0) / G);
  const base = new Uint8Array(nx * nz);          // 1 = blocked
  const strips = P.doors.filter(d => !d.fixed).map(d => ({ p: d.p, dir: d.dir, hw: d.w / 2 - NAV_R + 0.06, ht: (+d.t || 0) / 2 + NAV_R + 0.12 }));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const p = [u0 + (i + 0.5) * G, v0 + (j + 0.5) * G];
    let ok = strips.some(s => { const r = sub2(p, s.p); return Math.abs(dot2(r, s.dir)) < s.hw && Math.abs(cross2(s.dir, r)) < s.ht; });
    if (!ok) for (const S of P.spaces) {
      if (p[0] < S.box[0] || p[0] > S.box[2] || p[1] < S.box[1] || p[1] > S.box[3] || !pointInPoly(p, S.poly)) continue;
      ok = !S.segs.some(sg => segDist(p, sg.a, sg.b) < NAV_R);
      break;
    }
    if (!ok) ok = P.decks.some(k => pointInPoly(p, k.poly) && polyDist(p, k.poly) > 0.2);
    if (ok) for (const c of I.columns || []) if (Math.hypot(p[0] - c.c[0], p[1] - c.c[1]) < (c.r || 0.25) + NAV_R) ok = false;
    base[j * nx + i] = ok ? 0 : 1;
  }
  const targets = [];
  for (const d of P.doors) { if (d.fixed) continue; const n = d.n, k = (+d.t || 0) / 2 + 0.45; if (d.type !== 'entrance') targets.push(add2(d.p, n, -k)); targets.push(add2(d.p, n, k)); }
  // a space counts as reached when any of its walkable cells is
  const cells = P.spaces.map(S => { const out = []; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { if (base[j * nx + i]) continue; const p = [u0 + (i + 0.5) * G, v0 + (j + 0.5) * G]; if (p[0] > S.box[0] && p[0] < S.box[2] && p[1] > S.box[1] && p[1] < S.box[3] && pointInPoly(p, S.poly)) out.push(j * nx + i); } return out; });
  const ent = P.doors.find(d => d.type === 'entrance');
  const start = ent ? add2(ent.p, ent.n || [0, 1], (+ent.t || 0) / 2 + 0.3) : P.rooms[0].c;
  return (P[key] = { G, u0, v0, nx, nz, base, targets, start, cells });
}
function rpReach0(ctx, noGhost = false, fine = false) {
  fine = ctx.navFine === 'tight' ? 'tight' : fine || !!ctx.navFine;   // (a flat whose sofa-bed needed the 5 cm grid keeps it for every later piece)
  // 'tight': the 5 cm grid with a 0.25 m body (the walkthrough's is 0.24 m) — the last resort of the sofa-bed search
  const NAV_R = fine === 'tight' ? NAV_TIGHT : 0.27;
  const N = rpNav(ctx.P, ctx.I, fine ? 0.05 : 0.1, NAV_R), { G, u0, v0, nx, nz } = N, blk = N.base.slice(), W = fine ? 8 : 4;
  for (const q of ctx.occ) {
    if (q.wallOnly || (noGhost && q.ghost)) continue;
    const ext = Math.abs(q.d[0]) * q.hl + Math.abs(q.d[1]) * q.hw + NAV_R, ezt = Math.abs(q.d[1]) * q.hl + Math.abs(q.d[0]) * q.hw + NAV_R;
    const i0 = Math.max(0, Math.floor((q.c[0] - ext - u0) / G)), i1 = Math.min(nx - 1, Math.floor((q.c[0] + ext - u0) / G));
    const j0 = Math.max(0, Math.floor((q.c[1] - ezt - v0) / G)), j1 = Math.min(nz - 1, Math.floor((q.c[1] + ezt - v0) / G));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = [u0 + (i + 0.5) * G - q.c[0], v0 + (j + 0.5) * G - q.c[1]];
      const dx = Math.max(0, Math.abs(dot2(r, q.d)) - q.hl), dz = Math.max(0, Math.abs(cross2(q.d, r)) - q.hw);
      if (dx * dx + dz * dz < NAV_R * NAV_R) blk[j * nx + i] = 1;
    }
  }
  const seen = new Uint8Array(nx * nz), st = [];
  const cell = p => { const i = Math.floor((p[0] - u0) / G), j = Math.floor((p[1] - v0) / G); return i >= 0 && j >= 0 && i < nx && j < nz ? j * nx + i : -1; };
  const near = (p, f) => { const c = cell(p); if (c < 0) return false; const i = c % nx, j = (c - i) / nx; for (let a = -W; a <= W; a++) for (let b = -W; b <= W; b++) { const x = i + a, y = j + b; if (x >= 0 && y >= 0 && x < nx && y < nz && f(y * nx + x)) return true; } return false; };
  near(N.start, k => { if (!blk[k] && !seen[k]) { seen[k] = 1; st.push(k); } return false; });
  while (st.length) {
    const k = st.pop(), i = k % nx, j = (k - i) / nx;
    if (i > 0 && !blk[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; st.push(k - 1); }
    if (i < nx - 1 && !blk[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; st.push(k + 1); }
    if (j > 0 && !blk[k - nx] && !seen[k - nx]) { seen[k - nx] = 1; st.push(k - nx); }
    if (j < nz - 1 && !blk[k + nx] && !seen[k + nx]) { seen[k + nx] = 1; st.push(k + nx); }
  }
  let n = 0;
  for (const t of N.targets) if (near(t, k => seen[k] === 1)) n++;
  for (const c of N.cells) if (c.some(k => seen[k] === 1)) n += 3;
  let count = 0; for (let k = 0; k < seen.length; k++) count += seen[k];
  return { n, seen, blk, count, fine };
}
// does state `b` (after a piece was added) lose a target or cut floor off that state `a` could reach?
function rpWorse(a, b, lim = a.fine ? 160 : 40) {
  if (b.n < a.n) return true;
  let cover = 0;
  for (let k = 0; k < a.seen.length; k++) if (a.seen[k] && b.blk[k]) cover++;
  return a.count - b.count - cover > lim;                    // floor cut off beyond what the piece covers (0.4 m² of nooks allowed)
}
// A piece stays only if everything that could be reached before it can still be reached (o.quiet: no note).
function rpTry(ctx, S, obj, p, ang, y = 0, o = {}) {
  const n0 = ctx.occ.length, before = rpReach0(ctx);
  rpPut(ctx, S, obj, p, ang, y, o);
  if (ctx.occ.length === n0) return obj;
  const after = rpReach0(ctx);
  if (rpWorse(before, after)) { ctx.occ.length = n0; if (obj.parent) obj.parent.remove(obj); if (!o.quiet) ctx.notes.push((o.tag || obj.userData.piece || 'piece') + ' in ' + (S ? S.id : '?') + ' not placed (it would block the way)'); return null; }
  return obj;
}
// does a footprint stand in a door's swing (as drawn) or right in front of a balcony door?
function rpDoorHit(ctx, R) {
  return ctx.zones.some(z => ((z.kind === 'swing' && z.type !== 'entrance') || (z.kind === 'approach' && z.type === 'balcony')) && rectOverlap(R, z.core ? { ...z, hl: z.core } : z, -0.04));
}
// would a footprint block the way? (no object is made)
function rpBlocks(ctx, R) {
  const before = rpReach0(ctx);
  ctx.occ.push(R); const after = rpReach0(ctx); ctx.occ.pop();
  return rpWorse(before, after);
}
// ---- drawn fixtures → pieces
function rpFixtures(ctx) {
  const { P, I, m, cut } = ctx;
  const fx = (I.fixtures || []).filter(f => f && f.c && f.s && P.byId.get(f.room));
  const of = (S, kinds) => fx.filter(f => f.room === S.id && kinds.includes(f.kind));
  ctx.drawn = new Set(fx.map(f => f.kind));
  // a one-room flat: the sofa of its living room is a sofa-bed (rpSofaBed). The loose pieces drawn in that room
  // (sofa, bed, table) wait until it stands — it needs free floor in front of it for the opened bed.
  const T1 = TYPES[ctx.unit.type];
  if (T1 && T1.rooms === 1 && ctx.opts.sofaBed !== false) {
    const livs = P.rooms.filter(r => r.kind === 'living').sort((a, b) => b.area - a.area);
    const S = livs.find(r => fx.some(f => f.room === r.id && f.kind === 'sofa')) || livs[0];
    if (S) ctx.sb = { S, held: [], done: false, tried: false };
  }
  // (an entrance door drawn to open into the flat keeps its swing too; one whose swing is not on the drawing is hung
  // by rpLeaves after the pieces stand — to the side that is free)
  const swingBlocked = (R) => ctx.zones.some(z => z.kind === 'swing' && (z.type !== 'entrance' || (P.doors.find(d => d.id === z.id) || {}).swing) && P.rooms.some(T => pointInPoly(z.c, T.poly)) && rectOverlap(R, z, -0.06));
  // V7: the wardrobe drawn in a hall nearest to the entrance door is THE entrance wardrobe (mirror door, open niche)
  const entD = P.doors.find(d => d.type === 'entrance');
  ctx.entryW = entD ? fx.filter(f => f.kind === 'wardrobe' && P.byId.get(f.room).kind === 'hall').sort((a, b) => Math.hypot(a.c[0] - entD.p[0], a.c[1] - entD.p[1]) - Math.hypot(b.c[0] - entD.p[0], b.c[1] - entD.p[1]))[0] || null : null;
  const bedHeld = [], wardHeld = [];
  ctx.swingBlocked = swingBlocked; ctx.entD = entD;
  // ---- kitchens: runs + hobs + sinks that touch form one line (or an island when they stand free)
  for (const S of P.spaces) {
    const ks = of(S, ['kitchen-run', 'hob', 'sink']).filter(f => !f.sub);
    const used = new Set();
    for (const seed of ks) {
      if (used.has(seed)) continue;
      const cl = [seed]; used.add(seed);
      for (let i = 0; i < cl.length; i++) for (const g of ks) {
        if (used.has(g)) continue;
        const a = cl[i];
        if (Math.abs(a.c[0] - g.c[0]) < (a.s[0] + g.s[0]) / 2 + 0.3 && Math.abs(a.c[1] - g.c[1]) < (a.s[1] + g.s[1]) / 2 + 0.3) { cl.push(g); used.add(g); }
      }
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (const f of cl) { u0 = Math.min(u0, f.c[0] - f.s[0] / 2); u1 = Math.max(u1, f.c[0] + f.s[0] / 2); v0 = Math.min(v0, f.c[1] - f.s[1] / 2); v1 = Math.max(v1, f.c[1] + f.s[1] / 2); }
      const box = { kind: 'kitchen-run', room: S.id, c: [(u0 + u1) / 2, (v0 + v1) / 2], s: [u1 - u0, v1 - v0], rot: 0 };
      const hob = cl.find(f => f.kind === 'hob') || null, sink = cl.find(f => f.kind === 'sink') || null;
      (ctx.kitPlan ||= []).push({ S, box, hob, sink, cl });
    }
  }
  // fridges standing at the end of a line join it as its tall column
  const joined = new Set();
  for (const k of ctx.kitPlan || []) {
    const B = rpBack(k.S, k.box, 'long');
    k.B = B; k.xv = xOf(B.ang);
    k.island = !B.atWall && B.gap > 0.45;
    if (k.island) continue;
    k.x0 = -B.w / 2; k.x1 = B.w / 2;                             // extent along xv about the box centre
    for (const f of of(k.S, ['fridge'])) {
      if (joined.has(f)) continue;
      const rel = sub2(f.c, B.c), ax = dot2(rel, k.xv), off = dot2(rel, B.back), fw = Math.abs(dot2(k.xv, [1, 0])) > 0.7 ? f.s[0] : f.s[1];
      if (Math.abs(off) > 0.2) continue;
      if (Math.abs(ax - (k.x1 + fw / 2)) < 0.15) { k.tall = 'right'; k.x1 = ax + fw / 2; joined.add(f); }
      else if (Math.abs(ax - (k.x0 - fw / 2)) < 0.15) { k.tall = 'left'; k.x0 = ax - fw / 2; joined.add(f); }
      // (drawn inside the run's box: the column stands at the nearer end)
      else if (ax > k.x0 - 0.1 && ax < k.x1 + 0.1) { k.tall = ax > (k.x0 + k.x1) / 2 ? 'right' : 'left'; k.x0 = Math.min(k.x0, ax - fw / 2); k.x1 = Math.max(k.x1, ax + fw / 2); joined.add(f); }
    }
    // a washing machine drawn in the line is the run's integrated one
    for (const f of of(k.S, ['washing-machine'])) {
      if (joined.has(f)) continue;
      const rel = sub2(f.c, B.c), ax = dot2(rel, k.xv), off = dot2(rel, B.back);
      if (Math.abs(off) < 0.2 && ax > k.x0 - 0.45 && ax < k.x1 + 0.45) { k.washer = true; k.x0 = Math.min(k.x0, ax - 0.3); k.x1 = Math.max(k.x1, ax + 0.3); joined.add(f); }
    }
  }
  // ---- the kitchens first (fixed installations; the loose furniture then makes way). While a short run grows along
  // its wall the drawn boxes of everything else count as taken.
  const inKit = new Set((ctx.kitPlan || []).flatMap(k => k.cl));
  const resv = fx.filter(f => !inKit.has(f) && !joined.has(f) && ['fridge', 'washing-machine', 'wardrobe', 'toilet', 'basin', 'bathtub', 'shower', 'sofa', 'bed'].includes(f.kind)).map(f => { const r = (+f.rot || 0) * PI / 180; return { c: [+f.c[0], +f.c[1]], d: [Math.cos(r), Math.sin(r)], hl: f.s[0] / 2, hw: f.s[1] / 2, resv: true }; });
  ctx.occ.push(...resv);
  for (const k of (ctx.kitPlan || []).slice().sort((a, b) => (a.island ? 1 : 0) - (b.island ? 1 : 0))) { try { rpKitchen(ctx, k); } catch (err) { ctx.notes.push('kitchen: ' + (err && err.message)); } }
  ctx.occ = ctx.occ.filter(q => !q.resv);
  // a fixed appliance as drawn; where that shuts a way or a door, moved along its wall; a washing machine may drop out
  const nudge = (S, B, w, dp, make, must) => {
    const xv = xOf(B.ang);
    for (const off of [0, 0.15, -0.15, 0.3, -0.3, 0.5, -0.5]) {
      const p = add2(add2(B.wall, xv, off), B.front, dp / 2), R = { c: p, d: xv, hl: w / 2, hw: dp / 2 };
      if (off && !rpFree(ctx, S, R, { zones: false, tol: 0.01 })) continue;
      if (rpDoorHit(ctx, R) || rpBlocks(ctx, R)) continue;
      return make(add2(B.wall, xv, off), p);
    }
    if (must) return make(B.wall, add2(B.wall, B.front, dp / 2));
    ctx.notes.push((must === false ? 'washing machine' : 'piece') + ' in ' + S.id + ' left out (it would block a door or the way)');
    return null;
  };
  // ---- everything else, as drawn
  let seed = 1;
  for (const f of fx) {
    const S = P.byId.get(f.room);
    if (ctx.sb && S === ctx.sb.S && (f.kind === 'sofa' || f.kind === 'bed' || (f.kind === 'table' && !f.sub))) { ctx.sb.held.push(f); continue; }
    try {
      switch (f.kind) {
        case 'kitchen-run': case 'hob': case 'sink': if (!f.sub) break;   // (handled as lines)
        // falls through
        case 'table': rpTable(ctx, S, f); break;
        case 'toilet': { const B = rpBack(S, f, 'short', { snap: 0.5 }); nudge(S, B, 0.4, 0.6, (w) => rpPut(ctx, S, F.toilet(m), w, B.ang), true); break; }
        case 'basin': {
          // (a hand basin shallower than the kit's 0.5 m vanity is squeezed to the drawn depth)
          const B = rpBack(S, f, 'long', { snap: 0.5 }), vl = clamp(B.w, 0.45, 1.4), dp = clamp(B.dp, 0.34, 0.5), van = F.vanity(m, { len: vl });
          van.scale.z = dp / 0.5;
          nudge(S, B, vl, dp, (w) => { rpPut(ctx, S, van, w, B.ang, 0, { box: { w: vl, d: dp, z: dp / 2 } }); if (B.atWall) rpMirror(ctx, S, w, B.ang, vl); return van; }, true);
          break;
        }
        case 'bathtub': {
          // (squeezed to the drawn width where the plan's tub is slimmer than the kit's 0.78 m)
          // … and slimmer / shorter still where it would stand in the way of the door
          const B = rpBack(S, f, 'long', { snap: 0.5 }), len0 = clamp(B.w, 1.5, 1.8), k0 = clamp(B.dp / 0.78, 0.86, 1), xv = xOf(B.ang);
          let pick = null;
          for (const [len, kz] of [[len0, k0], [len0, Math.min(k0, 0.88)], [len0, 0.82], [1.5, 0.82]]) for (const off of len < B.w - 0.05 ? [0, (B.w - len) / 2, -(B.w - len) / 2] : [0]) {
            const w = add2(B.wall, xv, off), q = { len, kz, w };
            if (!pick) pick = q;
            if (!rpBlocks(ctx, { c: add2(w, B.front, 0.39 * kz), d: xv, hl: len / 2, hw: 0.39 * kz })) { pick = q; break; }
            pick = q;
          }
          const tub = F.bathtub(m, { len: pick.len, cut });
          tub.scale.z = pick.kz;
          rpPut(ctx, S, tub, pick.w, B.ang, 0, { box: { w: pick.len, d: 0.78 * pick.kz, z: 0.39 * pick.kz }, tag: 'bathtub' });
          break;
        }
        case 'shower': rpShower(ctx, S, [f.c[0], f.c[1]], f.s[0], f.s[1]); break;
        case 'washing-machine': {
          if (joined.has(f)) break;
          const B = rpBack(S, f, 'any', { snap: 0.45 });
          const wm = nudge(S, B, 0.6, 0.6, (w, p) => rpPut(ctx, S, F.washer(m, {}), p, B.ang), false);
          if (wm) { ctx.laundry = 'drawn'; rpWasherCab(ctx, S, wm, B); }
          break;
        }
        case 'fridge': {
          if (joined.has(f)) break;
          const B = rpBack(S, f, 'any');
          nudge(S, B, 0.6, 0.62, (w, p) => rpPut(ctx, S, F.fridge(m, { h: cut ? 1.05 : Math.min(2.3, CH - 0.1) }), p, B.ang), true); ctx.fridge = true;
          break;
        }
        case 'wardrobe': if (S.kind === 'bedroom') wardHeld.push([S, f]); else rpDrawnWardrobe(ctx, S, f, seed++); break;      // (bedrooms: after the bed)
        case 'sofa': rpSofa(ctx, S, rpBack(S, f, 'long')); break;
        case 'bed': if (S.kind === 'bedroom') bedHeld.push([S, f]); else rpBed(ctx, S, f, seed++); break;     // (bedrooms: after everything else that is drawn)
        default: break;
      }
    } catch (err) { ctx.notes.push('fixture ' + f.kind + ' in ' + f.room + ': ' + (err && err.message)); }
  }
  // V7: every bedroom gets a double bed (the largest of 1.8 / 1.6 / 1.4 m that fits) and its bridge unit
  // The wardrobes drawn in a bedroom are placed after its bed. The bed is first looked for with their drawn boxes kept
  // free (the architect's arrangement); where no double bed then fits with every way open, the bed comes first and
  // the wardrobes give way (shorter, shallower or left out — a wardrobe is then placed by rule on another wall).
  for (const S of P.rooms.filter(r => r.kind === 'bedroom')) {
    const bf = bedHeld.filter(q => q[0] === S).map(q => q[1]), wf = wardHeld.filter(q => q[0] === S).map(q => q[1]);
    if (!bf.length && !wf.length) continue;
    const tB = performance.now();
    try {
      if (bf.length) {
        const boxOf = f => { const r = (+f.rot || 0) * PI / 180; return { c: [+f.c[0], +f.c[1]], d: [Math.cos(r), Math.sin(r)], hl: f.s[0] / 2, hw: f.s[1] / 2, resv: true, h: 2 }; };
        // (the result of the search is kept with the layout's plan: a flat is built again for every style, floor
        // and visit — the pieces stand the same way each time)
        const memo = (P.bedPicks ||= new Map()), hit = memo.get(S.id);
        let pick = null, passA = false;
        if (hit && rpFree(ctx, S, hit.pick.R, { zones: false, tol: 0.03 })) { pick = hit.pick; passA = hit.passA; if (passA) ctx.occ.push(...wf.map(boxOf)); }
        else {
          if (wf.length) { ctx.occ.push(...wf.map(boxOf)); pick = rpDoubleFind(ctx, S, bf[0], BED_TIER_A); passA = !!pick; if (!pick) ctx.occ = ctx.occ.filter(q => !q.resv); }
          if (!pick) pick = rpDoubleFind(ctx, S, bf[0], 99, true);
          if (pick) memo.set(S.id, { pick, passA });
        }
        if (pick && wf.length && !passA) ctx.notes.push('bed in ' + S.id + ': the drawn wardrobe gives way to the double bed');
        rpDoublePlace(ctx, S, pick, bf[0], seed++);
        ctx.occ = ctx.occ.filter(q => !q.resv);
      }
      for (const f of wf) rpDrawnWardrobe(ctx, S, f, seed++);
    } catch (err) { ctx.occ = ctx.occ.filter(q => !q.resv); ctx.notes.push('bedroom ' + S.id + ': ' + (err && err.message)); }
    ctx.msBeds = (ctx.msBeds || 0) + performance.now() - tB;
  }
  // (a flat with no drawn kitchen: the kitchen line is placed by rule first — rpRules — and the sofa-bed after it)
  if (ctx.sb && (ctx.kitPlan || []).length) rpSofaBed(ctx);
}
// ---- the sofa-bed of a one-room flat (furniture.js sofaBed: opens into a double bed about 1.6 × 2.0 m).
// It stands where the plan draws the sofa when the bed can open there, else along another wall of the living room,
// else (a room that cannot hold both) in the place of the drawn bed. The floor the opened bed takes is kept free:
// inside the room, clear of every piece, door swing, door approach and passage, and every room and outdoor space must
// stay reachable with the bed OPEN. That floor then stays in ctx.occ as a ghost footprint, so that nothing placed
// later (coffee table, TV unit, dining set, plant, standing points, camera views) stands on it.
// The variants, best first: the pull-out 1.6 m wide (bed at right angles to the wall, 1.04 m of floor in front), the
// "book" 1.58 m (bed along the wall, 0.62 m in front — for narrow rooms), the pull-out 1.4 m wide, the book 1.4 m
// (0.44 m in front). L: planned length (the
// widest style's, so that a flat is furnished alike in every style).
const SB_KINDS = [{ kind: 'pull', wb: 1.6, L: 1.96, bonus: 0.6 }, { kind: 'book', wb: 1.6, L: 1.96, bonus: 0.4 }, { kind: 'pull', wb: 1.4, L: 1.76, bonus: 0.15 }, { kind: 'book', wb: 1.4, L: 1.96, bonus: 0 }];
function rpSofaBed(ctx) { const t0 = performance.now(); try { return rpSofaBed0(ctx); } finally { ctx.msSb = (ctx.msSb || 0) + performance.now() - t0; } }
function rpSofaBed0(ctx) {
  const sb = ctx.sb; if (!sb || sb.tried) return; sb.tried = true;
  const { P, m, cut } = ctx, S = sb.S;
  const sofas = sb.held.filter(f => f.kind === 'sofa'), beds = sb.held.filter(f => f.kind === 'bed'), tables = sb.held.filter(f => f.kind === 'table');
  const boxOf = f => { const r = (+f.rot || 0) * PI / 180; return { c: [+f.c[0], +f.c[1]], d: [Math.cos(r), Math.sin(r)], hl: f.s[0] / 2, hw: f.s[1] / 2 }; };
  const groups = tables.filter(f => Math.min(+f.s[0], +f.s[1]) >= 1.8);        // a sitting group drawn as one box (sofa + table)
  const dps = P.doors.filter(d => d.rooms && d.rooms.includes(S.id)).map(d => d.p);
  const fd = p => Math.min(3, ...dps.map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
  const open2 = P.rooms.filter(r => r !== S && (r.kind === 'kitchen' || r.kind === 'living'));
  const aisles = ctx.kitchens.map(k => ({ c: add2(k.p, k.front, 0.31 + 0.36), d: xOf(k.ang), hl: k.len / 2, hw: 0.36 }));
  const search = (keepBeds) => {
    const n0 = ctx.occ.length;
    if (keepBeds) for (const f of beds) ctx.occ.push({ ...boxOf(f), tmp: true });
    const cands = [], st = { keepBeds, tried: 0, sofa: 0, bed: 0, zone: 0, aisle: 0, way: 0 }, dbg = ctx.opts.sbDebug ? (st.dbg = []) : null;
    let KD = SB_KINDS[0], L = 0, D = 0, EXT = 0, EW = 0;
    const add = (p, f, sc, seg) => {
      const xv = xOf(angOf(f));
      st.tried++; sc += KD.bonus;
      // the wall behind: a window there costs (a low sill much more), and the back stands off it for the curtain
      const sg = seg || S.segs.find(q => dot2(q.nin, f) > 0.95 && Math.abs(dot2(sub2(p, q.a), q.nin)) < 0.1 && dot2(sub2(p, q.a), q.d) > -0.05 && dot2(sub2(p, q.a), q.d) < q.len + 0.05);
      if (sg) { const s = dot2(sub2(p, sg.a), sg.d), ws = sg.wins.filter(q => q.s1 > s - L / 2 + 0.05 && q.s0 < s + L / 2 - 0.05); if (ws.length) { p = add2(p, f, 0.2); sc -= ws.some(q => q.sill < 0.8) ? 1.6 : 0.5; } }
      else sc -= 0.4;                                                              // free-standing (drawn away from the walls)
      const Rc = { c: add2(p, f, D / 2 + 0.012), d: xv, hl: L / 2, hw: D / 2 }, Ro = { c: add2(p, f, D + 0.012 + EXT / 2), d: xv, hl: EW / 2, hw: EXT / 2 };
      const no = (r) => { st[r === 'bedwall' ? 'bed' : r]++; if (dbg && dbg.length < 400) dbg.push({ p, f, k: KD.kind + KD.wb, r }); };
      if (!rpFree(ctx, S, Rc, { tol: 0.02, zones: false })) return no('sofa');
      // the opened bed may reach through a wide opening into the next room (a kitchen niche), never through a wall
      const inS = rectInPoly(Ro, S.poly, 0.02);
      if (!inS && (!rectPts(Ro, 0.02).every(q => pointInPoly(q, S.poly) || open2.some(T => pointInPoly(q, T.poly))) || rpHitsWalls(P, Ro))) return no('bedwall');
      if (!rpFree(ctx, S, Ro, { tol: 0.02, zones: false, anyRoom: true })) return no('bed');
      const flips = [];
      const z1 = rpSbZones(ctx, Rc, Ro, flips, false), z2 = z1 === null ? null : rpSbZones(ctx, Ro, Rc, flips, true);
      if (z2 === null) return no('zone');
      if (aisles.some(a => rectOverlap(Rc, a, -0.02))) return no('aisle');
      sc -= z1 + z2 + (inS ? 0 : 0.6);
      // room to walk past the foot and along a side of the opened bed
      const ray = (o, d2) => P.rooms.some(T => pointInPoly(o, T.poly)) ? Math.min(...P.rooms.filter(T => pointInPoly(o, T.poly)).map(T => rayPoly(o, d2, T.poly))) : 0;
      const foot = ray(Ro.c, f) - EXT / 2, sideA = ray(Ro.c, xv) - EW / 2, sideB = ray(Ro.c, [-xv[0], -xv[1]]) - EW / 2;
      sc += (foot >= 0.6 ? 0.6 : 0) + (foot >= 1.0 ? 0.3 : 0) + (Math.max(sideA, sideB) >= 0.55 ? 0.5 : 0) + (Math.min(sideA, sideB) >= 0.55 ? 0.2 : 0);
      for (const t of tables) { const B = boxOf(t); if (rectOverlap(Ro, B, -0.05) || rectOverlap(Rc, B, -0.05)) sc -= 0.8; }
      if (aisles.some(a => rectOverlap(Ro, a, -0.02))) sc -= 0.8;
      cands.push({ p, f, xv, Rc, Ro, sc, KD, flips });
    };
    const offs = [0]; for (let o = 0.1; o <= 1.21; o += 0.1) offs.push(o, -o);
    for (KD of SB_KINDS) {
    const Z = FX.sofaBedSize(m, KD.wb, KD.kind); L = KD.L; D = Z.D; EXT = Z.ext; EW = KD.kind === 'book' ? Z.extW : KD.wb + 0.06;
    // (where the plan draws the piece: slid along its wall, and a step off it where the wall has a jog)
    const drawn = (B, sc) => { const xv = xOf(B.ang); for (const fo of [0, 0.1, 0.2]) for (const o of offs) add(add2(add2(B.wall, xv, o), B.front, fo), B.front, sc - Math.abs(o) * 0.6 - fo * 2); };
    for (const f of sofas) drawn(rpBack(S, f, 'long'), 3);
    for (const f of groups) { const B = rpBack(S, f, 'any'); if (B.atWall) drawn(B, 2.5); }
    if (!keepBeds) for (const f of beds) { const B = rpBack(S, f, Math.min(+f.s[0], +f.s[1]) >= 1.45 ? 'long' : 'short'); if (B.atWall) drawn(B, 2); }
    for (const seg of S.segs) {
      if (seg.len < L + 0.02) continue;
      const xs = []; for (let s = L / 2 + 0.01; s <= seg.len - L / 2 - 0.01 + 1e-6; s += 0.1) xs.push(s);
      xs.push(seg.len - L / 2 - 0.01, seg.len / 2);
      for (const s of xs) { const p = add2(seg.a, seg.d, s); add(p, seg.nin, Math.min(2, fd(p)) * 0.2 - Math.abs(s - seg.len / 2) * 0.1, seg); }
    }
    }
    cands.sort((a, b) => b.sc - a.sc);
    let best = null, before = null, beforeF = null, beforeT = null, fineTries = 0;
    // (second pass, only when no position passes: a 0.25 m body on the 5 cm grid — 4B01, 0.55 m between the washing
    // machine and the opened bed)
    for (const tiers of [[false, true], ['tight']]) {
    if (best) break;
    for (const c of cands) {
      // the sofa must cut nothing off; with the bed OPEN every room, outdoor space and door must still be reached
      // (floor left behind the opened bed may be out of reach: the walkthrough moves a visitor standing there)
      // (10 cm grid first; a way it cannot resolve — a 0.6 … 0.7 m gap — is checked again on a 5 cm grid)
      let okWay = false;
      for (const fine of tiers) {
        const b0 = fine === 'tight' ? (beforeT = beforeT || rpReach0(ctx, false, 'tight')) : fine ? (beforeF = beforeF || rpReach0(ctx, false, true)) : (before = before || rpReach0(ctx));
        ctx.occ.push(c.Rc); const a1 = rpReach0(ctx, false, fine); ctx.occ.push(c.Ro); const a2 = rpReach0(ctx, false, fine); ctx.occ.length -= 2;
        if (!rpWorse(b0, a1, fine ? 160 : 40) && a2.n >= b0.n) { okWay = true; c.fine = fine; break; }
        if (fine || ++fineTries > 60) break;
      }
      if (!okWay) { if (tiers[0] === false) { st.way++; if (dbg) dbg.push({ p: c.p, f: c.f, k: c.KD.kind + c.KD.wb, r: 'way' }); } continue; }
      best = c; break;
    }
    }
    st.ok = cands.length;
    (sb.stats ||= []).push(st);
    ctx.occ.length = n0;
    return best;
  };
  let seed = 41;
  const place = (best, keep) => {
    const wb = best.KD.wb, kind = best.KD.kind;
    const obj = F.sofaBed(m, { kind, wb, static: cut, t: ctx.opts.sofaBed === 'open' ? 1 : 0 }), K = obj.userData.sofaBed, ang = angOf(best.f);
    const pc = add2(best.p, best.f, K.D / 2 + 0.012);
    rpPut(ctx, S, obj, pc, ang, 0, { tag: 'sofaBed' });
    const Ro = { c: add2(best.p, best.f, K.D + 0.012 + K.ext / 2), d: best.xv, hl: K.extW / 2, hw: K.ext / 2, h: 0.55, tag: 'sofaBed-open', room: S.id, y: 0, ghost: true };
    ctx.occ.push(Ro);
    (S.has ||= {}).sofa = { p: pc, f: best.f, ang, len: K.L, xv: best.xv, wall: true, bed: true };
    ctx.sofaBed = { obj, K, S, p: best.p, f: best.f, xv: best.xv, ang, pc, Rc: obj.userData.rpRect, Ro, wb, kind, keptBed: keep && beds.length > 0, replacedBed: !keep && beds.length > 0, from: sofas.length ? 'sofa' : beds.length ? 'bed' : 'rule' };
    if (kind === 'pull' && wb < 1.6) ctx.notes.push('sofa-bed in ' + S.id + ': 1.4 m wide (no wall takes a 1.6 m one with the bed open)');
    if (kind === 'book') ctx.notes.push('sofa-bed in ' + S.id + ': opens along the wall' + (wb < 1.6 ? ', 1.4 m wide' : '') + ' (the room is too narrow for the pull-out)');
    sb.flip = best.flips.length ? new Set(best.flips) : null;
    if (best.flips.length) ctx.notes.push('sofa-bed in ' + S.id + ': door ' + best.flips.join(', ') + ' swings to its other side (the opened bed takes its drawn swing)');
    for (const f of beds) {
      if (!keep) { ctx.notes.push('drawn bed in ' + S.id + ' replaced by the sofa-bed (the room cannot hold both with the bed open)'); continue; }
      try { rpBed(ctx, S, f, seed++); } catch (err) { ctx.notes.push('fixture bed in ' + f.room + ': ' + (err && err.message)); }
    }
  };
  let done = false;
  for (const keep of beds.length ? [true, false] : [false]) {
    const best = search(keep); if (!best) continue;
    // (with the drawn bed kept: undone if the bed, as it really stands, shuts a way)
    if (best.fine) ctx.navFine = best.fine;
    if (best.fine === 'tight') ctx.notes.push('sofa-bed in ' + S.id + ': a tight way past the opened bed (0.5 m)');
    const snap = { occ: ctx.occ.length, kids: ctx.g.children.length, notes: ctx.notes.length, busy: ctx.busy.length, has: S.has ? { ...S.has } : null }, before = rpReach0(ctx);
    place(best, keep);
    if (keep && (rpWorse(before, rpReach0(ctx, true)) || rpReach0(ctx).n < before.n)) {
      ctx.occ.length = snap.occ; ctx.notes.length = snap.notes; ctx.busy.length = snap.busy; S.has = snap.has; ctx.sofaBed = null; sb.flip = null;
      for (const o of ctx.g.children.slice(snap.kids)) ctx.g.remove(o);
      continue;
    }
    done = true; break;
  }
  if (!done) {
    // no wall of the room lets the bed open: the pieces as drawn, a plain sofa (listed in notes/V5-sofa.md)
    ctx.notes.push('sofa-bed: no position in ' + S.id + ' where the bed can open — furnished as drawn');
    sb.fail = true;
    for (const f of sb.held) { try { if (f.kind === 'sofa') rpSofa(ctx, S, rpBack(S, f, 'long')); else if (f.kind === 'bed') rpBed(ctx, S, f, seed++); else rpTable(ctx, S, f); } catch (err) { ctx.notes.push('fixture ' + f.kind + ' in ' + f.room + ': ' + (err && err.message)); } }
    return;
  }
  sb.done = true;
  for (const f of tables) { try { rpTable(ctx, S, f); } catch (err) { ctx.notes.push('fixture table in ' + f.room + ': ' + (err && err.message)); } }
}
// does a plan rectangle cross a solid wall stretch of any room?
function rpHitsWalls(P, R) {
  const n = [-R.d[1], R.d[0]], hl = R.hl - 0.03, hw = R.hw - 0.03;
  for (const S of P.rooms) for (const sg of S.segs) {
    const a = sub2(sg.a, R.c), b = sub2(sg.b, R.c);
    const ax = dot2(a, R.d), ay = dot2(a, n), dx = dot2(b, R.d) - ax, dy = dot2(b, n) - ay;
    // Liang–Barsky: the segment against the box
    let t0 = 0, t1 = 1, ok = true;
    for (const [pp, qq] of [[-dx, ax + hl], [dx, hl - ax], [-dy, ay + hw], [dy, hw - ay]]) {
      if (Math.abs(pp) < 1e-12) { if (qq < 0) { ok = false; break; } continue; }
      const r = qq / pp;
      if (pp < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (ok && t1 - t0 > 1e-6) return true;
  }
  return false;
}
// The door zones against a footprint of the sofa-bed, as the leaf really sweeps: null = it stands in a swing (the
// quarter circle of the leaf), across a passage (less than 0.75 m of its line left clear) or in front of a balcony
// door; else a penalty for standing close to a door (its approach side, a passage).
function rpSbZones(ctx, R, other, flips, isBed) {
  let pen = 0;
  // an interior or balcony door whose drawn swing the piece takes may swing to its other side (a balcony door then
  // opens onto the balcony) — if the leaves are not hung yet (rpLeaves) and that side is free
  const canFlip = (z) => {
    if (!flips || ctx.leavesDone || (z.type !== 'interior' && z.type !== 'balcony')) return false;
    if (flips.includes(z.id)) return true;
    const rec = ctx.doors.find(q => q.id === z.id), L = rec && rec.leaf; if (!L || L.noFlip) return false;
    const d = L.d, n = d.n || [-d.dir[1], d.dir[0]], sg = -L.sgn, t = L.t;
    const tip = [d.p[0] + n[0] * sg * (t / 2 + d.w * 0.6), d.p[1] + n[1] * sg * (t / 2 + d.w * 0.6)];
    if (!ctx.P.spaces.some(S => pointInPoly(tip, S.poly))) return false;
    const hp = [d.p[0] + d.dir[0] * L.hs * L.hw + n[0] * sg * t / 2, d.p[1] + d.dir[1] * L.hs * L.hw + n[1] * sg * t / 2];
    if (rpSweep(ctx, hp, [-L.hs * d.dir[0], -L.hs * d.dir[1]], [n[0] * sg, n[1] * sg], d.w, 1.56) < 1.44) return false;
    // … and the leaf, open on that side, must not close a way
    const od = [n[0] * sg, n[1] * sg];
    if (rpBlocks(ctx, { c: add2(hp, od, d.w / 2), d: od, hl: d.w / 2, hw: 0.03 })) return false;
    flips.push(z.id); return true;
  };
  const inR = (Q, x, y, pad = 0) => { const r = [x - Q.c[0], y - Q.c[1]]; return Math.abs(dot2(r, Q.d)) < Q.hl + pad && Math.abs(cross2(Q.d, r)) < Q.hw + pad; };
  for (const z of ctx.zones) {
    if (!rectOverlap(R, z, 0.02)) continue;
    const n = [-z.d[1], z.d[0]];
    if (z.kind === 'swing') {
      if (!z.hinge) return null;
      const r = z.r + 0.03;
      for (let a = -r; a <= r; a += 0.05) for (let b = -r; b <= r; b += 0.05) {
        if (a * a + b * b > r * r) continue;
        const x = z.hinge[0] + z.d[0] * a + n[0] * b, y = z.hinge[1] + z.d[1] * a + n[1] * b;
        if (!inR(z, x, y, 0.02)) continue;
        if (inR(R, x, y, 0.02)) { if (canFlip(z)) { pen += z.type === 'balcony' ? 1.5 : 1.2; a = b = 99; } else return null; }
      }
      pen += 0.3;
    } else if (z.kind === 'passage') {
      let run = 0, best = 0;
      for (let a = -z.hl - 0.05; a <= z.hl + 0.05; a += 0.03) {
        const x = z.c[0] + z.d[0] * a, y = z.c[1] + z.d[1] * a;
        if (inR(R, x, y, 0.02) || (other && inR(other, x, y, 0.02)) || ctx.occ.some(q => !q.wallOnly && inR(q, x, y))) run = 0; else { run += 0.03; best = Math.max(best, run); }
      }
      if (best < Math.min(0.75, z.hl * 2 - 0.02)) return null;
      pen += 0.4;
    } else if (z.kind === 'approach' && z.type === 'balcony') {
      const core = z.core ?? z.hl;
      if (rectOverlap(R, { ...z, hl: core }, -0.03)) {
        // the sofa never stands in front of a balcony door; the OPENED bed may cover a corner of that front if at
        // least 0.6 m of the door's width stays clear
        if (!isBed) return null;
        let run = 0, best = 0;
        for (let a = -core; a <= core + 1e-6; a += 0.03) {
          let cov = false;
          for (let b = -z.hw; b <= z.hw + 1e-6 && !cov; b += 0.1) cov = inR(R, z.c[0] + z.d[0] * a + n[0] * b, z.c[1] + z.d[1] * a + n[1] * b, 0.02);
          if (cov) run = 0; else { run += 0.03; best = Math.max(best, run); }
        }
        if (best < 0.6) return null;
        pen += 0.9;
      }
      pen += 0.2;
    } else pen += 0.7;
  }
  return pen;
}
function rpSofa(ctx, S, B) {
  const { m } = ctx, xv = xOf(B.ang), [rn, rp] = rpReach(S, B.wall, B.front, xv, 0.5);
  const a0 = Math.max(-B.w / 2, -rn), a1 = Math.min(B.w / 2, rp), len = clamp(Math.floor((a1 - a0) * 20) / 20, 1.5, 2.9);
  const dp = clamp(B.dp, 0.86, 0.98);
  for (const l2 of [len, Math.max(1.5, len - 0.5), 1.5]) for (const off of l2 < a1 - a0 - 0.1 ? [0, (a1 - a0 - l2) / 2, -(a1 - a0 - l2) / 2] : [0]) {
    const p = add2(add2(B.wall, xv, (a0 + a1) / 2 + off), B.front, dp / 2 + 0.01), R = { c: p, d: xv, hl: l2 / 2, hw: dp / 2 };
    if (rpDoorHit(ctx, R) || rpBlocks(ctx, R)) continue;
    rpPut(ctx, S, F.sofa(m, { len: l2, depth: dp }), p, B.ang);
    (S.has ||= {}).sofa = { p, f: B.front, ang: B.ang, len: l2, xv, wall: B.atWall };
    return;
  }
  ctx.notes.push('sofa in ' + S.id + ' left out (it would block the way)');
}
function rpBed(ctx, S, f, seed) {
  const { m, cut } = ctx;
  // The drawn box of a double bed takes in its nightstands: the head is on a LONG side; a single bed's on a short one.
  // Beds are drawn shorter than the kit's 2.05 m: the piece is squeezed to the drawn length (not below 80 %).
  const dbl = Math.min(+f.s[0], +f.s[1]) >= 1.45;
  const B = rpBack(S, f, dbl ? 'long' : 'short'), xv = xOf(B.ang);
  const bw0 = B.w >= 1.75 ? 1.6 : B.w >= 1.5 ? 1.4 : B.w >= 1.25 ? 1.2 : 0.9;
  const kz = clamp(B.dp / 2.12, 0.8, 1), Lb = 2.15 * kz;
  // V7: a bed drawn smaller than a double (under 1.4 m wide or under 1.9 m long) in the living room of a flat whose
  // sofa opens into a double bed is left out — the sofa-bed is that room's double bed
  if (ctx.sb && S.kind !== 'bedroom' && (bw0 < 1.4 || kz < 0.88)) { ctx.notes.push('drawn bed in ' + S.id + ' left out (smaller than a double bed: the sofa-bed is the double bed of this room)'); return; }
  // as drawn; where that shuts a way: a narrower bed, pushed to either side of the drawn box
  let pick = null;
  const cands = [];
  for (const k2 of kz > 0.83 ? [kz, 0.8] : [kz]) for (const bw of [bw0, 1.4, 1.2, 0.9]) {
    if (bw > bw0) continue;
    const sl = Math.max(0, (B.w - bw - 0.2) / 2), L2 = 2.15 * k2;
    for (const off of sl > 0.05 ? [0, sl, -sl] : [0]) cands.push({ bw, kz: k2, Lb: L2, p: add2(add2(B.wall, xv, off), B.front, L2 / 2 + 0.01) });
  }
  const rectOf = q => ({ c: q.p, d: xv, hl: q.bw / 2 + 0.1, hw: q.Lb / 2 });
  // 1. clear of the door swings and of every way; 2. of every way (the door then swings to its other side); 3. narrowest
  pick = cands.find(q => !rpDoorHit(ctx, rectOf(q)) && !rpBlocks(ctx, rectOf(q))) || cands.find(q => !rpBlocks(ctx, rectOf(q)));
  if (!pick) { pick = cands[cands.length - 3] || cands[cands.length - 1]; ctx.notes.push('bed in ' + S.id + ': no size keeps every way open (narrowest kept)'); }
  const { bw, p } = pick;
  const bedO = F.bed(m, { w: bw }); bedO.scale.z = pick.kz;
  const bed = rpPut(ctx, S, bedO, p, B.ang, 0, { box: { w: bw + 0.2, d: pick.Lb }, tag: 'bed' });
  const wallP = add2(p, B.front, -(pick.Lb / 2 + 0.01));
  (S.has ||= {}).bed = { p, f: B.front, ang: B.ang, bw, xv, wall: wallP, atWall: B.atWall };
  rpBedSet(ctx, S, S.has.bed, seed);
  return bed;
}
// nightstands, pendant, rug and the dressed head wall of a placed bed
function rpBedSet(ctx, S, b, seed = 1) {
  const { m, cut } = ctx;
  for (const side of [-1, 1]) {
    const c = add2(add2(b.wall, b.xv, side * (b.bw / 2 + 0.1 + 0.26)), b.f, 0.215);
    if (!rpFree(ctx, S, { c, d: b.xv, hl: 0.24, hw: 0.2 })) continue;
    const ns = rpTry(ctx, S, F.nightstand(m, { seed: seed + side }), c, b.ang, 0, { quiet: true });
    if (ns && b.atWall) halo(ctx, ns, -0.07, -0.197, 0.8);
  }
  if (!cut) rpPut(ctx, S, F.pendant(m, { kind: 'bed', drop: 0.45 }), b.p, b.ang, CH, { free: true });
  const rc = add2(b.p, b.f, 0.35), R = { c: rc, d: b.xv, hl: Math.min(1.2, b.bw / 2 + 0.6), hw: 1.0 };
  if (rectInPoly(R, S.poly, 0.02)) rpPut(ctx, S, F.rug(m, { w: R.hl * 2, d: 2.0 }), rc, b.ang, 0, { free: true });
  if (cut || !b.atWall) return;
  // head wall: only on a plain straight stretch
  const seg = S.segs.find(s => Math.abs(dot2(sub2(b.wall, s.a), s.nin)) < 0.06 && dot2(s.nin, b.f) > 0.95 && dot2(sub2(b.wall, s.a), s.d) > 0 && dot2(sub2(b.wall, s.a), s.d) < s.len);
  if (!seg) return;
  const s = dot2(sub2(b.wall, seg.a), seg.d), free = (h) => !seg.wins.some(q => q.s1 > s - h && q.s0 < s + h);
  const half = Math.min(b.bw / 2 + 0.6, s - 0.02, seg.len - s - 0.02);
  const wp = add2(seg.a, seg.d, s);
  if (half >= b.bw / 2 - 0.05 && free(half)) { featureWallBed(ctx, ctx.g, wp[0], wp[1], b.ang, half * 2); artOn(ctx, ctx.g, wp[0], wp[1], b.ang, Math.min(1.2, b.bw), 0.7, seed, 1.55); }
}
// A wardrobe drawn on the plan
function rpDrawnWardrobe(ctx, S, f, seed) {
  const { P, m, cut } = ctx, swingBlocked = ctx.swingBlocked, entD = ctx.entD;
  {
          // V7: fitted, floor to ceiling, where the plan draws it. In a hall: 0.6 m deep, shallower (0.45 / 0.38 m)
          // where less than 0.9 m of passage would remain in front; where it would shut a way or stand in a door's
          // swing: shorter from either end.
          const B = rpBack(S, f, 'long'), xv = xOf(B.ang), hall = S.kind === 'hall', dress = S.kind === 'dressing';
          const D0 = dress ? clamp(Math.round(B.dp * 100) / 100, 0.4, 0.5) : B.dp > 0.7 ? 0.6 : clamp(Math.round(B.dp * 100) / 100, 0.5, 0.6);
          const bedroom = S.kind === 'bedroom';
          const depths = hall ? [0.6, D0, 0.45, 0.38].filter((d, i, a) => a.indexOf(d) === i) : bedroom ? [D0, 0.45].filter((d, i, a) => d <= D0 && a.indexOf(d) === i) : [D0];
          let pick = null, fall = null;
          const [rn0, rp0] = rpReach(S, B.wall, B.front, xv, 0.38);
          const A0 = Math.max(-B.w / 2, -rn0), A1 = Math.min(B.w / 2, rp0), len0 = Math.floor((A1 - A0) * 100) / 100;
          const lens = len0 < 0.5 ? [] : [[A0, A1], [A0, A0 + len0 * 0.7], [A1 - len0 * 0.7, A1], [A0, A0 + len0 * 0.45], [A1 - len0 * 0.45, A1]];
          for (const [c0, c1] of lens) {
            for (const D of depths) {
              const [rn, rp] = rpReach(S, B.wall, B.front, xv, D), b0 = Math.max(c0, -rn), b1 = Math.min(c1, rp);
              const l2 = Math.floor((b1 - b0) * 100) / 100; if (l2 < 0.5) continue;
              const p = add2(add2(B.wall, xv, (b0 + b1) / 2), B.front, D / 2 + 0.004), R = { c: p, d: xv, hl: l2 / 2, hw: D / 2 };
              // (a bedroom: clear of the bed, its towers and the floor beside it, 0.6 m to stand in front)
              if (bedroom && (ctx.occ.some(o => rectOverlap(R, o, -0.012)) || ctx.zones.some(z => z.kind === 'bedside' && rectOverlap(R, z, -0.01)) || !rpFree(ctx, S, { c: add2(p, B.front, D / 2 + 0.3), d: xv, hl: Math.max(0.1, l2 / 2 - 0.06), hw: 0.3 }, { zones: false, tol: 0.012 }))) continue;
              if (swingBlocked(R) || rpBlocks(ctx, R)) continue;
              const q = { p, l2, D, b0, b1, R };
              // (a hall: 0.9 m of passage in front of it)
              q.pass = !hall || rpFree(ctx, S, { c: add2(p, B.front, D / 2 + 0.45), d: xv, hl: Math.max(0.1, l2 / 2 - 0.06), hw: 0.45 }, { zones: false, tol: 0.012, anyRoom: true });
              if (!fall || (q.D === D0 && fall.D > D0 && q.l2 >= fall.l2 - 0.01)) fall = q;      // (as drawn, if nothing keeps 0.9 m)
              if (q.pass) { pick = q; break; }
            }
            if (pick) break;
          }
          pick = pick || fall;
          if (!pick) { ctx.notes.push('wardrobe in ' + S.id + ' left out (it would block a door or the way)'); return; }
          const { p, l2, D } = pick, entry = f === ctx.entryW, ceil = cut ? 0 : CH - ctx.tallH;
          let obj;
          if (dress) obj = F.dressing(m, { len: l2, h: ctx.tallH, d: D, seed });
          else if (hall) {
            // the open niche (bench, shoe shelf, hooks) at the end nearer to the entrance door
            const eS = entD ? dot2(sub2(entD.p, p), xv) >= 0 ? 1 : -1 : 1;
            obj = F.hallWardrobe(m, { len: l2, h: ctx.tallH, d: D, ceil, seed, sliding: D >= 0.5 && l2 >= 1.5, niche: entry && l2 >= 1.9 ? 0.62 : 0, nicheSide: eS, mirror: entry ? undefined : false });
          } else obj = F.wardrobe(m, { len: l2, h: ctx.tallH, d: D, kind: 'bed', sliding: l2 > 1.9, fitted: true, mirror: l2 > 1.9 ? 1 : -1, ceil, seed });
          rpPut(ctx, S, obj, p, B.ang, 0, { tag: dress ? 'dressing' : 'wardrobe' });
          (S.has ||= {}).wardrobe = { len: l2, d: D, drawn: true, p };
          if (bedroom && (l2 < len0 - 0.05 || D < D0 - 0.01)) ctx.notes.push('wardrobe in ' + S.id + ': ' + l2.toFixed(2) + ' × ' + D.toFixed(2) + ' m (drawn ' + len0.toFixed(2) + ' × ' + D0.toFixed(2) + ': the double bed needs the room)');
          if (hall) { (ctx.hallW ||= []).push({ room: S.id, len: l2, d: D, drawn: true, entry, niche: !!obj.userData.hasNiche, mirror: !!obj.userData.hasMirror, pass: pick.pass, p }); if (!pick.pass) ctx.notes.push('wardrobe in ' + S.id + ': less than 0.9 m of passage in front of it (as drawn)'); if (l2 < len0 - 0.05) ctx.notes.push('wardrobe in ' + S.id + ': shorter than drawn (' + l2.toFixed(2) + ' of ' + len0.toFixed(2) + ' m: door / way)'); if (D < D0 - 0.01) ctx.notes.push('wardrobe in ' + S.id + ': ' + D.toFixed(2) + ' m deep (0.9 m of passage kept)'); }
          return;
        }
}
// ================================================================ V7-furnish: double beds, bridge units, fitted joinery
// (notes/V7-furnish.md)
const BED_D = 2.22, BED_SIZES = [1.8, 1.6, 1.4], Y_BRIDGE = 1.95;
const inRect = (Q, p, pad = 0) => { const r = sub2(p, Q.c); return Math.abs(dot2(r, Q.d)) < Q.hl + pad && Math.abs(cross2(Q.d, r)) < Q.hw + pad; };
// collider of a piece that hangs on the wall / stands on another piece (furniture.js userData.box3)
function rpHiCol(obj) {
  const b = obj.userData.box3; if (!b) return null;
  const zc = b.zc ?? 0, c = collider(obj, -b.w / 2, b.y0 || 0, zc - b.d / 2, b.w / 2, b.h, zc + b.d / 2);
  c.name = 'col-furniture-high'; return c;
}
// One long side of a bed (w wide, dep long, head at wallP on a wall running along d, inward normal nin; sd = −1 / +1
// along d): g = the width of free floor beside it (0.5 / 0.4 / 0.3 m strips, measured beyond the first 0.45 m where a
// tower or a bedside table stands); open = at least `need`; closed = it lies against a wall (a slanted one too).
function rpBedSide(ctx, S, wallP, d, nin, w, sd, need = 0.5, dep = BED_D) {
  const e = [d[0] * sd, d[1] * sd];
  let g = 0, strip = null;
  for (const x of [need, 0.4, 0.3]) {
    if (x > need) continue;
    const st = { c: add2(add2(wallP, e, w / 2 + x / 2), nin, 0.45 + (dep - 0.45) / 2), d, hl: x / 2, hw: (dep - 0.45) / 2 };
    if (rpFree(ctx, S, st, { zones: false, tol: 0.01 })) { g = x; strip = st; break; }
  }
  if (g >= need) return { open: true, closed: false, g, strip };
  let lo = Infinity, hi = 0;
  for (const t of [0.3, dep / 2, dep - 0.2]) {
    const q = add2(add2(wallP, e, w / 2 - 0.03), nin, t);
    let gi = pointInPoly(q, S.poly) ? rayPoly(q, e, S.poly) - 0.03 : 0;
    for (let a = 0.03; a < Math.min(gi, 0.5); a += 0.03) if (ctx.occ.some(o => !o.wallOnly && inRect(o, add2(q, e, a)))) { gi = 9; break; }     // (a piece, not a wall)
    lo = Math.min(lo, gi); hi = Math.max(hi, gi);
  }
  return { open: false, closed: lo <= 0.06 && hi <= 0.3, g: Math.min(hi, 9), semi: g >= 0.3, wallGap: lo };
}
// The double bed of a bedroom. Sizes 1.8 / 1.6 / 1.4 × 2.0 m, the head on a solid wall stretch (a stretch never
// spans a door), the footprint clear of every piece, door swing, door approach, passage and balcony-door front;
// each long side is against a wall or has free floor, at least one has 0.5 m (the 1.8 m bed: both; a slit under
// 0.3 m beside a bed is refused); no way may be shut. Where the plan draws a bed its head wall and position win
// unless another wall takes a bed two sizes larger. What gives way when nothing fits, in this order (BED_TIERS):
// the head under a window with a normal sill · a 1.9 m long mattress · both · the head under a low window ·
// 0.4 m beside the bed · the tightest body (0.5 m of passage, as the sofa-bed of 4B01).
// The door zones against a bed's footprint: not in the quarter circle a leaf sweeps, not within 0.5 m in front of a
// door opening (0.6 m of a balcony door's, on its full width), not across a passage. (That every door is still
// reached is the walk test's part.)
// may a balcony door whose drawn swing a bed takes open outwards instead (the leaves are hung after the drawn pieces)?
function rpCanFlip(ctx, z, interior) {
  if (ctx.leavesDone || (z.type !== 'balcony' && !(interior && z.type === 'interior'))) return false;
  const rec = ctx.doors.find(q => q.id === z.id), L = rec && rec.leaf; if (!L || L.noFlip) return false;
  const d = L.d, n = d.n || [-d.dir[1], d.dir[0]], sg = -L.sgn, t = L.t;
  const tip = [d.p[0] + n[0] * sg * (t / 2 + d.w * 0.6), d.p[1] + n[1] * sg * (t / 2 + d.w * 0.6)];
  if (!ctx.P.spaces.some(S => pointInPoly(tip, S.poly)) && !ctx.P.decks.some(k => pointInPoly(tip, k.poly))) return false;
  const hp = [d.p[0] + d.dir[0] * L.hs * L.hw + n[0] * sg * t / 2, d.p[1] + d.dir[1] * L.hs * L.hw + n[1] * sg * t / 2];
  if (rpSweep(ctx, hp, [-L.hs * d.dir[0], -L.hs * d.dir[1]], [n[0] * sg, n[1] * sg], d.w, 1.56) < 1.44) return false;
  // … an interior leaf, open on that side, must not close a way nor meet another door's swing
  if (z.type === 'interior') {
    const od = [n[0] * sg, n[1] * sg], Rl = { c: add2(hp, od, d.w / 2), d: od, hl: d.w / 2, hw: 0.03 };
    if (rpBlocks(ctx, Rl)) return false;
    const Rz = { c: [d.p[0] + n[0] * sg * (t / 2 + d.w / 2), d.p[1] + n[1] * sg * (t / 2 + d.w / 2)], d: d.dir, hl: d.w / 2, hw: d.w / 2 };
    if (ctx.zones.some(q => q !== z && (q.kind === 'swing' || q.kind === 'passage') && rectOverlap(Rz, q, -0.05))) return false;
  }
  return true;
}
function rpBedZones(ctx, R, why, flips, flipI) {
  for (const z of ctx.zones) {
    if (z.kind === 'bedside' || !rectOverlap(R, z, 0.0)) continue;
    const n = [-z.d[1], z.d[0]];
    if (z.kind === 'swing') {
      if (!z.hinge) { if (why) why[z.kind + ':' + z.id] = (why[z.kind + ':' + z.id] || 0) + 1; return false; }
      const r = z.r + 0.02;
      for (let a = -r; a <= r; a += 0.04) for (let b = -r; b <= r; b += 0.04) {
        if (a * a + b * b > r * r) continue;
        const p = [z.hinge[0] + z.d[0] * a + n[0] * b, z.hinge[1] + z.d[1] * a + n[1] * b];
        if (inRect(z, p, 0.02) && inRect(R, p, 0.01)) { if (flips && (flips.includes(z.id) || rpCanFlip(ctx, z, flipI))) { if (!flips.includes(z.id)) flips.push(z.id); a = b = 99; continue; } if (why) why[z.kind + ':' + z.id] = (why[z.kind + ':' + z.id] || 0) + 1; return false; }
      }
    } else if (z.kind === 'approach') {
      if (z.type === 'balcony') { if (rectOverlap(R, { ...z, hl: z.core ?? z.hl }, -0.02)) { if (why) why[z.kind + ':' + z.id] = (why[z.kind + ':' + z.id] || 0) + 1; return false; } continue; }
      // the 0.5 m nearest to the opening (the zone is 0.7 m deep; its far 0.2 m may be covered)
      const dr = ctx.P.doors.find(d => d.id === z.id), toDoor = dr ? (dot2(sub2(dr.p, z.c), n) >= 0 ? 1 : -1) : 0;
      const core = toDoor ? { ...z, c: add2(z.c, n, toDoor * 0.1), hw: z.hw - 0.1 } : z;
      if (rectOverlap(R, core, -0.02)) { if (why) why[z.kind + ':' + z.id] = (why[z.kind + ':' + z.id] || 0) + 1; return false; }
    } else if (rectOverlap(R, z, -0.01)) { if (why) why[z.kind + ':' + z.id] = (why[z.kind + ':' + z.id] || 0) + 1; return false; }
  }
  return true;
}
// (compact: the same mattress on a frame with a thin wall-hung headboard and the duvet tucked in at the foot —
// 2.13 m from the wall instead of 2.22)
const BED_TIERS = [{ L: 2.0, win: 0, need: 0.5 }, { L: 2.0, win: 1, need: 0.5 }, { L: 2.0, win: 0, need: 0.5, compact: true }, { L: 2.0, win: 1, need: 0.5, compact: true },
  { L: 1.9, win: 0, need: 0.5, compact: true, flipI: true }, { L: 1.9, win: 1, need: 0.5, compact: true, flipI: true }, { L: 2.0, win: 2, need: 0.5, flipI: true }, { L: 1.9, win: 2, need: 0.4, compact: true, flipI: true }, { L: 1.9, win: 2, need: 0.4, compact: true, tight: true, flipI: true }];
const BED_TIER_A = 5;                 // (the last tier tried with the drawn wardrobes kept in their place)
// has a walker any floor inside the plan rectangle R in the reach result `res`?
function rpSeenIn(ctx, res, R, fine) {
  const N = rpNav(ctx.P, ctx.I, fine ? 0.05 : 0.1, fine === 'tight' ? NAV_TIGHT : 0.27), { G, u0, v0, nx, nz } = N;
  const ext = Math.abs(R.d[0]) * R.hl + Math.abs(R.d[1]) * R.hw, ezt = Math.abs(R.d[1]) * R.hl + Math.abs(R.d[0]) * R.hw;
  const i0 = Math.max(0, Math.floor((R.c[0] - ext - u0) / G)), i1 = Math.min(nx - 1, Math.floor((R.c[0] + ext - u0) / G)), j0 = Math.max(0, Math.floor((R.c[1] - ezt - v0) / G)), j1 = Math.min(nz - 1, Math.floor((R.c[1] + ezt - v0) / G));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (res.seen[j * nx + i] && inRect(R, [u0 + (i + 0.5) * G, v0 + (j + 0.5) * G], 0.03)) return true;
  return false;
}
function rpDoubleFind(ctx, S, f, maxTier = 99, needW = false) {
  const { P } = ctx;
  const dps = P.doors.filter(d => d.rooms && d.rooms.includes(S.id) && d.type !== 'balcony').map(d => d.p);
  const fd = p => Math.min(3, ...dps.map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
  let B = null;
  if (f) { try { B = rpBack(S, f, Math.min(+f.s[0], +f.s[1]) >= 1.45 ? 'long' : 'short'); } catch { B = null; } }
  const stats = [];
  const collect = (T, st) => {
    const out = [], dep = T.L + (T.compact ? 0.13 : 0.22);
    for (const seg of S.segs) for (const bw of BED_SIZES) {
      const w = bw + 0.1; if (seg.len < w + 0.02) { st.short++; continue; }
      const xs = []; for (let x = w / 2 + 0.012; x <= seg.len - w / 2 - 0.012 + 1e-6; x += 0.05) xs.push(x);
      xs.push(seg.len - w / 2 - 0.012);
      for (const x of xs) {
        st.tried++;
        const ws = seg.wins.filter(q => q.s1 > x - w / 2 + 0.03 && q.s0 < x + w / 2 - 0.03), win = ws.length ? (ws.some(q => q.sill < 0.8) ? 2 : 1) : 0;
        if (win > T.win) { st.win++; continue; }
        const wallP = add2(seg.a, seg.d, x), R = { c: add2(wallP, seg.nin, dep / 2 + 0.006), d: seg.d, hl: w / 2, hw: dep / 2 };
        if (!rpFree(ctx, S, R, { tol: 0.03, zones: false })) { st.taken++; if (!rectInPoly(R, S.poly, 0.03)) st.out++; else st.occ++; continue; }
        const flips = [];
        if (!rpBedZones(ctx, R, st.why, flips, !!T.flipI)) { st.taken++; st.zone++; continue; }
        const sides = [rpBedSide(ctx, S, wallP, seg.d, seg.nin, w, -1, T.need, dep), rpBedSide(ctx, S, wallP, seg.d, seg.nin, w, 1, T.need, dep)];
        const nOpen = (sides[0].open ? 1 : 0) + (sides[1].open ? 1 : 0);
        if (!nOpen || (bw > 1.7 && nOpen < 2)) { st.sides++; continue; }
        // (the other side: against a wall, or usable floor; a slit beside the bed costs)
        const slit = sides.some(q => !q.open && !q.closed && !q.semi);
        let sc = bw * 5 + (nOpen === 2 ? 0.6 : slit ? -0.9 : sides.some(q => q.semi) ? -0.2 : 0) + Math.min(2, fd(R.c)) * 0.15 - Math.abs(x - seg.len / 2) * (nOpen === 2 ? 0.2 : 0) - flips.reduce((a, id) => a + ((ctx.doors.find(q => q.id === id) || {}).type === 'balcony' ? 1.2 : 2.5), 0);
        let drawn = false;
        if (B && dot2(seg.nin, B.front) > 0.95 && Math.abs(dot2(sub2(B.wall, wallP), seg.nin)) < 0.35) { const off = Math.abs(dot2(sub2(B.c, wallP), seg.d)); if (off < 1.2) { drawn = true; sc += 1.6 - off * 0.5; } }
        // foot: room to walk past it, or it stands against the far wall
        const foot = rayPoly(add2(wallP, seg.nin, dep - 0.05), seg.nin, S.poly) - 0.05;
        sc += foot >= 0.55 ? 0.3 : foot > 0.15 ? -0.3 : 0;
        out.push({ seg, x, bw, w, win, wallP, R, sides, nOpen, sc, drawn, foot, dep, L: T.L, tight: !!T.tight, compact: !!T.compact, flips });
      }
    }
    return out.sort((a, b) => b.sc - a.sc);
  };
  // With the bed in place a wardrobe must still find a wall (needW; not asked when the plan's own wardrobes stand):
  // per tier the best pair (bed, wardrobe) wins — a narrower bed with a proper wardrobe beats a wider bed with none
  // or with a 0.38 m one. Where no bed of a tier leaves room for a wardrobe the later tiers (compact frame, 1.9 m)
  // are asked; if none does, the largest bed stands without one.
  const wardScore = (c) => {
    const n0 = ctx.occ.length, z0 = ctx.zones.length;
    ctx.occ.push({ ...c.R, tag: 'bed' });
    // (its towers: 0.45 × 0.42 on every open side)
    for (const [k, sd] of [[0, -1], [1, 1]]) if (c.sides[k].open) { const T = { c: add2(add2(c.wallP, c.seg.d, sd * (c.w / 2 + 0.015 + 0.225)), c.seg.nin, 0.216), d: c.seg.d, hl: 0.225, hw: 0.21 }; if (rpFree(ctx, S, T, { tol: 0.008 })) ctx.occ.push(T); }
    const zs = c.sides.filter(q => q.open && q.strip).map(q => ({ ...q.strip, kind: 'bedside', id: S.id }));
    ctx.zones.push(...zs);
    let w = rpBedroomWardrobe(ctx, S, { dry: true }), given = false;
    if (!w && zs.length === 2) { ctx.zones.length = z0; ctx.zones.push(zs.slice().sort((a, b) => b.hl - a.hl)[0]); w = rpBedroomWardrobe(ctx, S, { dry: true }); given = !!w; }
    ctx.occ.length = n0; ctx.zones.length = z0;
    c.ward = w ? { D: w.D, len: w.len, given } : null;
    return !w ? -4 : (w.D >= 0.6 ? 3 : w.D >= 0.45 ? 2 : 1.2) + Math.min(2.4, w.len) * 0.5 - (w.len < 0.8 ? 1 : 0) - (given ? 0.5 : 0);
  };
  let keep = null;
  for (let tier = 0; tier < BED_TIERS.length && tier <= maxTier; tier++) {
    const T = BED_TIERS[tier], st = { tier, why: {}, short: 0, tried: 0, win: 0, taken: 0, out: 0, occ: 0, zone: 0, sides: 0, way: 0 };
    stats.push(st);
    const fine = T.tight ? 'tight' : T.compact ? true : false;
    let before = null, n = 0, best = null;
    const failed = [], got = {};
    for (const c of collect(T, st)) {
      // (a neighbour of a position that shuts a way shuts it too: 0.2 m steps there)
      if (failed.some(q => q.seg === c.seg && q.bw === c.bw && Math.abs(q.x - c.x) < 0.16) || failed.filter(q => q.seg === c.seg && q.bw === c.bw).length >= 4) continue;
      if (needW && (got[c.bw] || 0) >= 3) continue;                       // (three positions per width are compared)
      if (needW && (best && best.ward && best.bw > c.bw + 0.3 && best.ward.D >= 0.6)) break;
      if (++n > 70) break;
      before = before || rpReach0(ctx, false, fine);
      ctx.occ.push(c.R); const after = rpReach0(ctx, false, fine); ctx.occ.pop();
      // every door and room still reached, and the bed itself from an open side (floor left behind it — a pocket
      // between its foot and a curved wall — may be out of reach)
      let cover = 0; for (let k = 0; k < before.seen.length; k++) if (before.seen[k] && after.blk[k]) cover++;
      const pocket = (before.count - after.count - cover) * (after.fine ? 0.0025 : 0.01);            // m² of floor no longer reached
      if (after.n < before.n || pocket > 1.2 || !c.sides.some(q => q.open && q.strip && rpSeenIn(ctx, after, q.strip, after.fine))) { st.way++; failed.push(c); continue; }
      c.tier = tier; c.stats = stats;
      if (!needW) return c;
      got[c.bw] = (got[c.bw] || 0) + 1;
      c.total = c.sc + wardScore(c);
      if (!best || c.total > best.total + 1e-9) best = c;
      // (the first — best placed — bed of the widest size with a full wardrobe: nothing later beats it)
      if (c.ward && c.ward.D >= 0.6 && c.ward.len >= 1.2 && !c.ward.given && c === best && n === 1) break;
    }
    if (best && best.ward) return best;
    if (best && !keep) keep = best;
    if (keep && tier >= BED_TIER_A) break;                                  // (no bed leaves room for a wardrobe: the largest stands)
  }
  if (keep) return keep;
  if (ctx.opts.bedDebug || maxTier >= 99) ctx.notes.push('bed in ' + S.id + ': search ' + JSON.stringify(stats.filter((q, i) => !i || i === stats.length - 1).map(q => ({ tier: q.tier, tried: q.tried, win: q.win, out: q.out, occ: q.occ, zone: q.zone, sides: q.sides, way: q.way, why: q.why }))));
  return null;
}
function rpDoublePlace(ctx, S, pick, f, seed = 1) {
  const { m } = ctx;
  if (!pick) {
    ctx.notes.push('bed in ' + S.id + ': NO double bed fits — placed as drawn');
    (ctx.beds ||= []).push({ room: S.id, bw: 0, fail: true });
    if (f) rpBed(ctx, S, f, seed);
    return null;
  }
  const { seg, bw, wallP, sides, tier, dep } = pick, ang = angOf(seg.nin), xv = xOf(ang);
  const bedO = F.bed(m, { w: bw, len: pick.L, slim: true, flat: pick.compact, tuck: pick.compact });
  // (the piece: headboard 0.07 behind the frame, the duvet 0.07 beyond its foot; a wall panel of the bridge unit
  // behind the head — none in the tightest tier)
  // the model's origin is its frame centre; behind it the headboard (0.07; the compact one 0.015) and, for the
  // standard bed, the wall panel of the bridge unit (0.02)
  const org = 0.012 + (pick.compact ? 0.015 : 0.09) + (pick.L + 0.05) / 2, cF = 0.012 + (dep - 0.02) / 2;
  bedO.userData.solidBox = { w: bw + 0.1, d: dep - 0.02, h: 0.6, z: cF - org };
  const pc = add2(wallP, seg.nin, cF);
  rpPut(ctx, S, bedO, add2(wallP, seg.nin, org), ang, 0, { tag: 'bed' });
  if (pick.tight) ctx.navFine = 'tight'; else if (pick.compact && !ctx.navFine) ctx.navFine = true;
  if (pick.flips && pick.flips.length) {
    ctx.flip = ctx.flip || new Set();
    for (const id of pick.flips) {
      ctx.flip.add(id);
      const dr = ctx.doors.find(q => q.id === id), L = dr && dr.leaf; if (!L) continue;
      L.noFlip = true;
      // the keep-out zones follow the leaf at once (the leaves themselves are hung by rpLeaves)
      const d = L.d, n = d.n || [-d.dir[1], d.dir[0]], sg = -L.sgn, t = L.t;
      const z = ctx.zones.find(q => q.kind === 'swing' && q.id === id); if (z) { z.c = [d.p[0] + n[0] * sg * (t / 2 + d.w / 2), d.p[1] + n[1] * sg * (t / 2 + d.w / 2)]; z.hinge = [d.p[0] + d.dir[0] * L.hs * L.hw + n[0] * sg * t / 2, d.p[1] + d.dir[1] * L.hs * L.hw + n[1] * sg * t / 2]; }
      const za = ctx.zones.find(q => q.kind === 'approach' && q.id === id && !q.fixed); if (za) za.c = [d.p[0] - n[0] * sg * (t / 2 + 0.35), d.p[1] - n[1] * sg * (t / 2 + 0.35)];
      ctx.notes.push('bed in ' + S.id + ': ' + (dr.type === 'balcony' ? 'balcony door ' + id + ' opens outwards' : 'door ' + id + ' swings to its other side') + ' (the bed takes its drawn swing)');
    }
  }
  const rec = { room: S.id, bw, len: pick.L, drawn: pick.drawn, underWindow: pick.win, tier, compact: !!pick.compact, open: [sides[0].open, sides[1].open], foot: +pick.foot.toFixed(2), dep, wall: [+wallP[0].toFixed(3), +wallP[1].toFixed(3)], front: seg.nin, d: seg.d, towers: [0, 0], row: 0, tables: 0, wardrobe: null };
  (ctx.beds ||= []).push(rec);
  const b = (S.has ||= {}).bed = { p: pc, f: seg.nin, ang, bw, xv, wall: wallP, atWall: true, double: true, seg, s: pick.x, sides, win: pick.win, rec, tight: pick.tight, compact: pick.compact, dep };
  if (bw < 1.6) ctx.notes.push('bed in ' + S.id + ': 1.4 m wide (the room takes no wider double bed with 0.5 m beside it)');
  if (pick.L < 2) ctx.notes.push('bed in ' + S.id + ': mattress ' + bw + ' × 1.9 m (a 2.0 m one would shut a way)');
  if (pick.win) ctx.notes.push('bed in ' + S.id + ': head under a window (no other wall takes a double bed)');
  if (BED_TIERS[tier].need < 0.5 && !sides.some(q => q.g >= 0.5)) ctx.notes.push('bed in ' + S.id + ': 0.4 m beside it');
  if (pick.compact) ctx.notes.push('bed in ' + S.id + ': compact frame (thin headboard) — the standard one would shut a way');
  if (pick.tight) ctx.notes.push('bed in ' + S.id + ': a tight way past it (0.5 m)');
  if (f && !pick.drawn) ctx.notes.push('bed in ' + S.id + ': not on the drawn wall (a double bed does not fit there)');
  rpBedDress(ctx, S, b, seed);
  // the floor beside the bed stays free of what is placed later
  for (const q of sides) if (q.open && q.strip) ctx.zones.push({ ...q.strip, kind: 'bedside', id: S.id });
  return b;
}
function rpDouble(ctx, S, f, seed = 1) { return rpDoublePlace(ctx, S, rpDoubleFind(ctx, S, f, 99, true), f, seed); }
// Bridge unit over a double bed: a tower on every open side (0.45 / 0.36 m wide, 0.42 deep, with a bedside niche),
// a row of wall cabinets over the head between them (underside 1.95 m, 0.38 deep, LED line, wall panel behind the
// head); no tower where a window, the end of the wall or a slanted side wall is in the way — then a bedside table;
// the row alone hangs on brackets; no row under a window.
function rpBedDress(ctx, S, b, seed = 1) {
  const { m, cut } = ctx, seg = b.seg, w = b.bw + 0.1, H = ctx.tallH, ceil = cut ? 0 : CH - H, rec = b.rec;
  const spanOK = (a0, a1) => a0 >= -0.005 && a1 <= seg.len + 0.005, winIn = (a0, a1) => seg.wins.some(q => q.s1 > a0 + 0.02 && q.s0 < a1 - 0.02);
  const at = (x, dep) => add2(add2(seg.a, seg.d, x), seg.nin, dep);
  const lx = dot2(seg.d, b.xv) >= 0 ? 1 : -1;                      // seg.d in the bed's local x
  const tw = [0, 0];
  if (!b.win) for (const [k, sd] of [[0, -1], [1, 1]]) {
    if (!b.sides[k].open) continue;
    for (const W of [0.45, 0.36]) {
      const a0 = sd < 0 ? b.s - w / 2 - 0.015 - W : b.s + w / 2 + 0.015, a1 = a0 + W;
      if (!spanOK(a0, a1) || winIn(a0 - 0.05, a1 + 0.05)) continue;
      const c = at((a0 + a1) / 2, 0.21 + 0.006);
      if (!rpFree(ctx, S, { c, d: seg.d, hl: W / 2, hw: 0.21 }, { tol: 0.008 }) || rpWinFront(S, { c, d: seg.d, hl: W / 2, hw: 0.21 }, 0.5)) continue;
      const t = F.tower(m, { w: W, h: H, d: 0.42, yB: Y_BRIDGE, side: sd * lx, seed: seed + k, ceil });
      if (rpTry(ctx, S, t, c, b.ang, 0, { tag: 'tower', quiet: true })) { tw[k] = W; break; }
    }
  }
  // the row over the head
  let a0 = b.s - w / 2 - 0.015, a1 = b.s + w / 2 + 0.015;
  if (b.sides[0].closed) a0 = Math.max(0.005, b.s - w / 2 - b.sides[0].g + 0.004);
  if (b.sides[1].closed) a1 = Math.min(seg.len - 0.005, b.s + w / 2 + b.sides[1].g - 0.004);
  let row = false;
  if (!cut && !b.win && spanOK(a0, a1) && !winIn(a0, a1)) {
    const len = a1 - a0, oh = F.overhead(m, { len, d: 0.38, hh: H - Y_BRIDGE, ceil, brackets: !tw[0] && !tw[1], panel: b.compact ? 0 : Y_BRIDGE, panelW: len });
    oh.userData.box3.zc = 0.19;
    rpPut(ctx, S, oh, at((a0 + a1) / 2, 0.003), b.ang, Y_BRIDGE, { free: true }); rpHiCol(oh);
    row = true; rec.row = +len.toFixed(2);
  }
  rec.towers = tw;
  if (!row && !cut) ctx.notes.push('bed in ' + S.id + ': no cabinets over the head (' + (b.win ? 'window' : 'window / end of the wall') + ')');
  else if (!tw[0] && !tw[1] && !cut) ctx.notes.push('bed in ' + S.id + ': cabinet row over the head without side towers (no room beside the bed / window)');
  // bedside tables where no tower stands
  for (const [k, sd] of [[0, -1], [1, 1]]) {
    if (tw[k] || !b.sides[k].open) continue;
    const c = at(b.s + sd * (w / 2 + 0.03 + 0.24), 0.215);
    if (!rpFree(ctx, S, { c, d: seg.d, hl: 0.24, hw: 0.2 })) continue;
    const ns = rpTry(ctx, S, F.nightstand(m, { seed: seed + sd }), c, b.ang, 0, { quiet: true });
    if (ns) { rec.tables++; halo(ctx, ns, -0.07, -0.197, 0.8); }
  }
  if (!cut && !row) rpPut(ctx, S, F.pendant(m, { kind: 'bed', drop: 0.45 }), add2(b.p, b.f, 0.15), b.ang, CH, { free: true });     // (under a bridge unit its LED line is the reading light)
  const rc = add2(b.p, b.f, 0.4), R = { c: rc, d: b.xv, hl: Math.min(1.25, b.bw / 2 + 0.45), hw: 1.0 };
  if (rectInPoly(R, S.poly, 0.02) && !ctx.occ.some(q => q.tag !== 'bed' && rectOverlap(R, q, -0.02))) rpPut(ctx, S, F.rug(m, { w: R.hl * 2, d: 2.0 }), rc, b.ang, 0, { free: true });
  if (!row && !cut && !b.win) {
    const half = Math.min(b.bw / 2 + 0.6, b.s - 0.02, seg.len - b.s - 0.02), wp = at(b.s, 0);
    if (half >= b.bw / 2 - 0.05 && !winIn(b.s - half, b.s + half)) { featureWallBed(ctx, ctx.g, wp[0], wp[1], b.ang, half * 2); artOn(ctx, ctx.g, wp[0], wp[1], b.ang, Math.min(1.2, b.bw), 0.7, seed, 1.55); }
  }
}
// The wardrobe of a bedroom (or of a living room that sleeps) by rule: full height, on a plain wall stretch, never in
// front of a window; 0.6 m deep with 0.7 m free in front, then 0.6 free, then 0.45 / 0.38 m deep, as long as the wall
// allows (2.4 … 0.8 m; 0.6 m as the last resort). o.dry: only find the place (→ { D, len, sp }) — the bed search
// asks whether a bed position leaves room for a wardrobe.
const WARD_TIERS = [[0.6, 0.7, [2.4, 2.0, 1.8, 1.6, 1.4, 1.2, 1.0]], [0.6, 0.6, [1.6, 1.2, 1.0, 0.8]], [0.45, 0.6, [2.0, 1.6, 1.2, 1.0, 0.8]], [0.38, 0.6, [2.0, 1.6, 1.2, 1.0, 0.8]], [0.6, 0.6, [0.6]], [0.45, 0.55, [0.6]]];
function rpBedroomWardrobe(ctx, S, o = {}) {
  const { m, cut, P } = ctx;
  const dps = P.doors.filter(d => d.rooms && d.rooms.includes(S.id)).map(d => d.p), ws = ctx.wins.filter(w => w.S === S).map(w => w.mid);
  const fd = p => Math.min(3, ...dps.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))), wd = p => ws.length ? Math.min(...ws.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))) : 3;
  for (const [D, clear, lens] of WARD_TIERS) for (const len of lens) {
    const sp = rpWallSpot(ctx, S, len, D, { tall: true, winFront: 0.5, clear, corner: 0.8, score: (p) => Math.min(2, wd(p)) * 0.4 - fd(p) * 0.15 });
    if (!sp) continue;
    const c = add2(sp.p, sp.nin, D / 2 + 0.012), slide = len > 1.9 && D >= 0.5;
    if (o.dry) { if (rpBlocks(ctx, { c, d: sp.d, hl: len / 2, hw: D / 2 + (slide ? 0.015 : 0) })) continue; return { D, len, sp }; }
    const wr = F.wardrobe(m, { len, h: ctx.tallH, d: D, kind: 'bed', sliding: slide, fitted: true, mirror: slide ? 1 : -1, ceil: cut ? 0 : CH - ctx.tallH, seed: o.seed || 1 });
    if (rpTry(ctx, S, wr, c, sp.ang, 0, { tag: 'wardrobe', quiet: true })) { (S.has ||= {}).wardrobe = { len, d: D, p: sp.p }; return { D, len, sp }; }
  }
  return null;
}
// A cupboard over a washing machine that stands in a niche (a wall behind it and a wall or a piece close on a side)
function rpWasherCab(ctx, S, wm, B) {
  const { m, cut } = ctx;
  if (cut || !B.atWall) return;
  const r = wm.userData.rpRect; if (!r) return;
  const xv = xOf(B.ang), back = [-B.front[0], -B.front[1]];
  if (raySegs(r.c, back, S.segs) > 0.42) return;
  const g = [raySegs(r.c, xv, S.segs), raySegs(r.c, [-xv[0], -xv[1]], S.segs)];
  if (Math.min(g[0], g[1]) > 0.3 + 0.16) return;                       // free-standing along its wall: left as it is
  const seg = S.segs.find(q => dot2(q.nin, B.front) > 0.95 && Math.abs(dot2(sub2(r.c, q.a), q.nin) - 0.3) < 0.15 && dot2(sub2(r.c, q.a), q.d) > 0 && dot2(sub2(r.c, q.a), q.d) < q.len);
  if (!seg) return;
  const sx = dot2(sub2(r.c, seg.a), seg.d);
  if (seg.wins.some(q => q.s1 > sx - 0.32 && q.s0 < sx + 0.32)) return;
  // nothing hung on the wall there (a mirror) and no piece reaching into the cupboard's place
  const R = { c: r.c, d: xv, hl: 0.318, hw: 0.3 };
  if (ctx.occ.some(q => q !== r && rectOverlap(R, q, -0.012))) return;
  const cab = F.washerCab(m, { h: ctx.tallH, ceil: CH - ctx.tallH });
  rpPut(ctx, S, cab, r.c, B.ang, 0, { free: true }); rpHiCol(cab);
  (ctx.extras ||= []).push({ kind: 'washer-cupboard', room: S.id });
}
// The entrance wardrobe where the plan draws none in a hall (or the drawn one had to be left out): on a free wall of
// the entrance hall, then of another hall / corridor — 0.6 m deep with 0.9 m of passage in front, else 0.45 / 0.38 m
// deep — and, if no hall has a place, on the nearest wall of the room the hall opens into.
function rpEntranceWardrobe(ctx) {
  const { P, m, cut } = ctx;
  if ((ctx.hallW || []).length) { ctx.hallWardrobe = true; return; }
  const ent = P.doors.find(d => d.type === 'entrance'), E = ent ? P.byId.get(ent.rooms[1]) : P.rooms[0];
  if (!E) return;
  const ep = ent ? ent.p : E.c, de = p => Math.hypot(p[0] - ep[0], p[1] - ep[1]);
  // rooms by steps from the entrance room
  const dist = new Map([[E.id, 0]]), q = [E];
  while (q.length) { const A = q.shift(); for (const d of P.doors) { if (!d.rooms || !d.rooms.includes(A.id) || d.type === 'balcony' || d.type === 'entrance') continue; const T = P.byId.get(d.rooms[0] === A.id ? d.rooms[1] : d.rooms[0]); if (T && !T.out && !dist.has(T.id)) { dist.set(T.id, dist.get(A.id) + 1); q.push(T); } } }
  const halls = P.rooms.filter(r => r.kind === 'hall' && dist.has(r.id)).sort((a, b) => dist.get(a.id) - dist.get(b.id));
  if (E.kind !== 'hall' && !halls.includes(E)) halls.unshift(E);
  const ceil = cut ? 0 : CH - ctx.tallH;
  let seed = 61;
  const tryIn = (S, depths, lens, clear, adjoining) => {
    for (const [D, minLen] of depths) for (const len of lens) {
      if (len < minLen) continue;
      const sp = rpWallSpot(ctx, S, len, D, { tall: true, winFront: 0.5, clear, corner: 0.4, score: (p) => -de(p) * 0.25 });
      if (!sp) continue;
      const eS = dot2(sub2(ep, sp.p), xOf(sp.ang)) >= 0 ? 1 : -1;
      const obj = F.hallWardrobe(m, { len, h: ctx.tallH, d: D, ceil, seed: seed++, sliding: D >= 0.5 && len >= 1.5, niche: len >= 1.9 ? 0.62 : 0, nicheSide: eS });
      if (!rpTry(ctx, S, obj, add2(sp.p, sp.nin, D / 2 + 0.012), sp.ang, 0, { tag: 'wardrobe', quiet: true })) continue;
      (S.has ||= {}).wardrobe = { len, d: D, p: sp.p };
      (ctx.hallW ||= []).push({ room: S.id, len, d: D, drawn: false, entry: true, niche: !!obj.userData.hasNiche, mirror: !!obj.userData.hasMirror, pass: true, adjoining: !!adjoining, p: sp.p });
      ctx.hallWardrobe = true;
      if (D < 0.6) ctx.notes.push('entrance wardrobe in ' + S.id + ': ' + D.toFixed(2) + ' m deep (the hall is narrow: 0.9 m of passage kept)');
      if (adjoining) ctx.notes.push('entrance wardrobe: no place in the hall — on the nearest wall of ' + S.id + ' (' + S.kind + ')');
      return true;
    }
    return false;
  };
  const lens = [2.4, 2.0, 1.8, 1.5, 1.2, 1.0, 0.8, 0.6];
  for (const S of halls) if (tryIn(S, [[0.6, 0.8], [0.45, 0.8], [0.38, 0.8], [0.6, 0.6], [0.45, 0.6], [0.38, 0.6]], lens, 0.9)) return;
  // no hall has a place: the room next to the entrance hall
  const next = P.rooms.filter(r => r.kind !== 'bath' && r.kind !== 'hall' && dist.has(r.id)).sort((a, b) => dist.get(a.id) - dist.get(b.id) || de(a.c) - de(b.c));
  for (const S of next.slice(0, 2)) if (tryIn(S, [[0.6, 0.8], [0.45, 0.8], [0.38, 0.6]], [1.8, 1.5, 1.2, 1.0, 0.8, 0.6], 0.8, true)) return;
  ctx.notes.push('entrance wardrobe: NO place found (hall and adjoining rooms)');
}
// A tall pantry cabinet at a free end of the kitchen run (one per flat): flush with the run, a wall behind it, no
// window, 0.8 m free in front, clear of every door zone and passage.
function rpPantry(ctx) {
  const { m, cut } = ctx;
  for (const k of ctx.kitchens) {
    const S = k.S, xv = xOf(k.ang);
    if (S.kind !== 'kitchen' && !(S.kind === 'living' && S.area >= 14)) continue;
    const wallC = add2(k.p, k.front, -0.31);
    const seg = S.segs.find(q => dot2(q.nin, k.front) > 0.95 && Math.abs(dot2(sub2(wallC, q.a), q.nin)) < 0.1 && dot2(sub2(wallC, q.a), q.d) > -0.1 && dot2(sub2(wallC, q.a), q.d) < q.len + 0.1);
    if (!seg) continue;
    for (const W of [0.6, 0.45]) for (const e of [1, -1]) {
      const c = add2(k.p, xv, e * (k.len / 2 + W / 2 + 0.004)), sx = dot2(sub2(c, seg.a), seg.d);
      if (sx - W / 2 < -0.01 || sx + W / 2 > seg.len + 0.01 || seg.wins.some(q => q.s1 > sx - W / 2 - 0.05 && q.s0 < sx + W / 2 + 0.05)) continue;
      const R = { c, d: xv, hl: W / 2, hw: 0.3 };
      if (!rpFree(ctx, S, R, { tol: 0.012 }) || rpDoorHit(ctx, R) || rpWinFront(S, R, 0.5)) continue;
      if (!rpFree(ctx, S, { c: add2(c, k.front, 0.3 + 0.4), d: xv, hl: W / 2 - 0.05, hw: 0.4 }, { zones: false, tol: 0.012, anyRoom: true })) continue;
      const pn = F.pantry(m, { w: W, h: cut ? 1.05 : Math.min(2.3, CH - 0.1), side: -e });
      if (!rpTry(ctx, S, pn, c, k.ang, 0, { tag: 'pantry', quiet: true })) continue;
      (ctx.extras ||= []).push({ kind: 'pantry', room: S.id, w: W });
      return;
    }
  }
}
function rpTable(ctx, S, f) {
  const { m } = ctx;
  const B0 = rpSides(S, f), L = Math.max(B0.s1, B0.s2), W = Math.min(B0.s1, B0.s2);
  const r = (+f.rot || 0) * PI / 180, along = B0.s1 >= B0.s2 ? [Math.cos(r), Math.sin(r)] : [-Math.sin(r), Math.cos(r)];
  const ang = Math.atan2(-along[1], along[0]);                 // local x along the long axis
  const c = B0.c;
  if (f.sub === 'bar-counter') {
    // a counter with stools: on the open side of the drawn box (the kitchen run takes the wall side), stools towards
    // the room; it leaves a way into the kitchen at one end
    const B = rpBack(S, f, 'any');
    const liv = ctx.P.rooms.filter(r => r.kind === 'living').sort((a, b) => b.area - a.area)[0];
    if (liv && liv !== S) {
      const d = sub2(liv.c, c), ax = Math.abs(d[0]) >= Math.abs(d[1]) ? [Math.sign(d[0]), 0] : [0, Math.sign(d[1])];
      B.front = ax; B.ang = angOf(ax); B.w = ax[0] ? +f.s[1] : +f.s[0]; B.dp = ax[0] ? +f.s[0] : +f.s[1];
    }
    const xv = xOf(B.ang);
    for (const len of [clamp(B.w - 0.85, 1.4, 2.2), 1.4]) {
      const isl = F.island(m, { len, depth: 0.7 }), sb = isl.userData.solidBox, sl = Math.max(0, (B.w - len) / 2);
      for (const off of sl > 0.1 ? [sl, -sl, 0] : [0]) for (const back of [B.dp / 2 - 0.35 - 0.3, B.dp / 2 - 0.35 - 0.6, 0]) {
        const p = add2(add2(c, xv, off), B.front, back), R = { c: add2(p, B.front, sb.z || 0), d: xv, hl: sb.w / 2, hw: sb.d / 2 };
        if (!rpFree(ctx, S, R, { zones: false, tol: 0, anyRoom: true })) continue;
        if (ctx.occ.some(q => rectOverlap({ ...R, hw: R.hw + 0.55 }, q, -0.02) && Math.abs(dot2(q.d, xv)) > 0.9 && q.tag === 'kitchen')) continue;   // a working aisle behind it
        if (rpDoorHit(ctx, R) || rpBlocks(ctx, R)) continue;
        rpPut(ctx, S, isl, p, B.ang); ctx.island = { u: +p[0].toFixed(2), v: +p[1].toFixed(2), len, depth: 0.7, level: 0 };
        return;
      }
    }
    ctx.notes.push('bar counter in ' + S.id + ' left out (door / way)');
    return;
  }
  if (L <= 0.85) { rpTry(ctx, S, F.sideTable(m), c, ang, 0, { quiet: true }); return; }
  if (W >= 1.8 && !(S.has && S.has.sofa)) {
    // a box this big is a sitting group (sofa + round table drawn as one): the sofa on the side that has a wall,
    // a small table set in the rest of the box
    const B = rpBack(S, f, 'any');
    if (B.atWall) {
      rpSofa(ctx, S, { ...B, dp: 0.9 });
      const so = S.has && S.has.sofa;
      const rest = B.dp - 0.95, tc = add2(B.wall, B.front, 0.95 + rest / 2);
      if (so && rest >= 0.8) {
        const R = { c: tc, d: xOf(B.ang), hl: 0.38, hw: 0.38 };
        if (rpFree(ctx, S, R, { passages: false, tol: 0 }) && !rpBlocks(ctx, R)) { rpPut(ctx, S, rpDiningSet(ctx, 0.7, 0.7, 2), tc, B.ang + HALF, 0, { tag: 'table' }); S.has.table = true; ctx.diningAt = { u: tc[0], v: tc[1] }; }
      }
      if (so) return;
    }
  }
  let tl, tw, sides = 2;
  if (W < 0.85) { tl = clamp(L, 0.9, 2.2); tw = clamp(W, 0.6, 0.8); const B = rpBack(S, f, 'long'); if (B.atWall) sides = 1; }
  else if (L < 1.15) { tl = 0.7; tw = 0.7; }
  else if (L <= 1.6) { tl = 0.9; tw = 0.85; }
  else { tl = clamp(L - 0.5, 1.2, 2.2); tw = 0.9; }
  let a = ang;
  if (sides === 1) { const B = rpBack(S, f, 'long'); a = B.ang + PI; }            // chairs (local +z side) towards the room
  // as drawn; where the set would shut a way or stand in a door: smaller, then shifted inside the drawn box
  const xv = xOf(a), zv = [Math.sin(a), Math.cos(a)];
  for (const [l2, w2] of [[tl, tw], [Math.min(tl, 1.2), 0.8], [0.9, 0.8], [0.7, 0.7]]) {
    if (l2 > tl + 1e-6) continue;
    const sx = Math.max(0, (L - l2) / 2 - 0.05), sz = Math.max(0, (W - w2) / 2 - 0.05);
    for (const [ox, oz] of [[0, 0], [sx, 0], [-sx, 0], [0, sz], [0, -sz], [sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz]]) {
      if ((ox && sx < 0.1) || (oz && sz < 0.1)) continue;
      const p = add2(add2(c, xv, ox), zv, oz), R = { c: p, d: xv, hl: l2 / 2 + 0.03, hw: w2 / 2 + 0.03 };
      if (!rpFree(ctx, S, R, { passages: false, tol: 0.0, pad: -0.05 }) || rpBlocks(ctx, R)) continue;
      rpPut(ctx, S, rpDiningSet(ctx, l2, w2, sides), p, a, 0, { tag: 'table' });
      (S.has ||= {}).table = true; ctx.diningAt = { u: p[0], v: p[1] };
      return;
    }
  }
  ctx.notes.push('table in ' + S.id + ' left out (no room)');
}
function rpKitchen(ctx, k) {
  const { m, cut } = ctx, S = k.S, B = k.B;
  if (k.island) {
    // parallel to the run it belongs to, stools towards the room
    const run = ctx.kitchens.filter(q => q.S === S || true).sort((p, q) => Math.hypot(p.p[0] - B.c[0], p.p[1] - B.c[1]) - Math.hypot(q.p[0] - B.c[0], q.p[1] - B.c[1]))[0];
    if (run) { B.ang = run.ang; B.front = run.front; k.xv = xOf(run.ang); }
    // as drawn; where that stands in front of a door or shuts a way: shorter, moved along / off its line
    for (const len of [clamp(Math.max(B.w, 1.6), 1.4, 2.4), 1.4]) {
      const isl = F.island(m, { len, depth: 0.86 }), sb = isl.userData.solidBox;
      for (const [ox, oz] of [[0, 0], [0.4, 0], [-0.4, 0], [0.8, 0], [-0.8, 0], [0, -0.3], [0.4, -0.3], [-0.4, -0.3], [0, 0.3]]) {
        const p = add2(add2(B.c, k.xv, ox), B.front, oz), R = { c: add2(p, B.front, sb.z || 0), d: k.xv, hl: sb.w / 2, hw: sb.d / 2 };
        if (!rpFree(ctx, S, R, { zones: false, anyRoom: true }) || rpDoorHit(ctx, R) || rpBlocks(ctx, R)) continue;
        rpPut(ctx, S, isl, p, B.ang); ctx.island = { u: +p[0].toFixed(2), v: +p[1].toFixed(2), len, depth: 0.86, level: 0 };
        return;
      }
    }
    ctx.notes.push('kitchen island in ' + S.id + ' left out (door / way)');
    return;
  }
  const xv = k.xv, wall = B.wall;                                  // wall point under the box centre
  let x0 = k.x0, x1 = k.x1;
  // a short drawn run grows along its wall as far as the room, other pieces and door zones allow (at most 3.2 m)
  const okAt = (a0, a1) => rpFree(ctx, S, { c: add2(add2(wall, xv, (a0 + a1) / 2), B.front, 0.32), d: xv, hl: (a1 - a0) / 2, hw: 0.3 }, { passages: false, tol: 0.02 });
  const [rn, rp] = rpReach(S, wall, B.front, xv, 0.6);
  x0 = Math.max(x0, -rn); x1 = Math.min(x1, rp);
  while (!okAt(x0, x1) && x1 - x0 > 0.7) { if (dot2(sub2(S.c, wall), xv) > (x0 + x1) / 2) x0 += 0.05; else x1 -= 0.05; }
  const want = S.kind === 'kitchen' ? 2.4 : 2.1;
  for (let it = 0; it < 80 && x1 - x0 < want; it++) {
    let grown = false;
    if (x1 + 0.05 <= rp && okAt(x0, x1 + 0.05)) { x1 += 0.05; grown = true; }
    if (x1 - x0 < want && x0 - 0.05 >= -rn && okAt(x0 - 0.05, x1)) { x0 -= 0.05; grown = true; }
    if (!grown) break;
  }
  // … and gives way where it would shut a passage
  for (let it = 0; it < 30 && x1 - x0 > 1.2 && rpBlocks(ctx, { c: add2(add2(wall, xv, (x0 + x1) / 2), B.front, 0.31), d: xv, hl: (x1 - x0) / 2, hw: 0.31 }); it++) {
    if (dot2(sub2(S.c, wall), xv) > (x0 + x1) / 2) x1 -= 0.1; else x0 += 0.1;
  }
  const len = Math.floor((x1 - x0) * 100) / 100;
  if (len < 0.6) { ctx.notes.push('kitchen run in ' + S.id + ' left out (no room)' + (ctx.opts.debug ? ' ' + JSON.stringify({ wall, xv, front: B.front, gap: B.gap, w: B.w, rn, rp, x0, x1, k0: k.x0, k1: k.x1, ok: okAt(k.x0, k.x1), occ: ctx.occ.length }) : '')); return; }
  const p = add2(add2(wall, xv, (x0 + x1) / 2), B.front, 0.31);
  // the hob end as drawn
  const ref = k.hob || k.sink, rx = ref ? dot2(sub2(ref.c, p), xv) : 0;
  // a window behind the run: no wall units, no hood
  const seg = S.segs.find(s => Math.abs(dot2(sub2(wall, s.a), s.nin)) < 0.08 && dot2(s.nin, B.front) > 0.95);
  let win = false;
  if (seg) { const s = dot2(sub2(add2(wall, xv, (x0 + x1) / 2), seg.a), seg.d); win = seg.wins.some(q => q.s1 > s - len / 2 && q.s0 < s + len / 2); }
  const tall = cut ? 'none' : (k.tall || 'none');
  // an L-shaped kitchen is drawn as two lines: each leg carries what is drawn on it (the other gets drawers only)
  const legs = (ctx.kitPlan || []).filter(q => q.S === S && !q.island), lone = legs.length < 2;
  const anyHob = legs.some(q => q.hob), anySink = legs.some(q => q.sink), longest = legs.slice().sort((p, q) => (q.x1 - q.x0) - (p.x1 - p.x0))[0] === k;
  const noHob = !lone && (anyHob ? !k.hob : !longest), noSink = !lone && (anySink ? !k.sink : !longest);
  // (the regular plan has the sink towards −x and the hob towards +x; the compact one starts with what it carries at −x)
  const compactPath = noHob || noSink || len - (tall === 'none' ? 0 : 0.6) < 1.65;
  const flip = !ref ? false : compactPath ? rx > 0 : k.hob ? rx < 0 : rx > 0;
  const kr = F.kitchenRun(m, len, { tall, ovenColumn: false, ceiling: CH, washer: (k.washer || (!ctx.laundry && !ctx.drawn.has('washing-machine'))) && len >= 2.7 && lone, uppers: !cut && !win && B.atWall, hood: !cut && !win && B.atWall && !noHob, cut, flip,
    compact: true, plain: noHob && noSink, noHob, noSink });
  rpPut(ctx, S, kr, p, B.ang, 0, { tag: 'kitchen' });
  if (kr.userData.hasWasher || k.washer) ctx.laundry = 'kitchen';
  if (k.tall && !cut) ctx.fridge = true;
  ctx.kitchens.push({ S, p, ang: B.ang, len, front: B.front });
}

// ---- rule-based furnishing of what the plan does not draw (by room kind, along free wall stretches)
function rpRules(ctx) {
  const { P, I, m, cut } = ctx;
  const doorPts = S => P.doors.filter(d => d.rooms && d.rooms.includes(S.id)).map(d => d.p);
  const farFromDoors = (S, k = 1) => { const ps = doorPts(S); return (p) => k * Math.min(3, ...ps.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))); };
  const winDist = (S) => { const ws = ctx.wins.filter(w => w.S === S).map(w => w.mid); return (p) => ws.length ? Math.min(...ws.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))) : 3; };
  const has = (S, k) => !!(S.has && S.has[k]);
  const hasBedroom = P.rooms.some(r => r.kind === 'bedroom');
  // ---- kitchen (a flat with no drawn kitchen at all)
  if (!(ctx.kitPlan || []).length) {
    const S = P.rooms.find(r => r.kind === 'kitchen') || P.rooms.find(r => r.kind === 'living' && r.kitchen) || P.rooms.find(r => r.kind === 'living');
    if (S) {
      const wd = winDist(S), fd = farFromDoors(S, 0.2);
      for (const len of [3.0, 2.7, 2.4, 2.1, 1.8, 1.5, 1.2]) {
        const sp = rpWallSpot(ctx, S, len, 0.62, { tall: true, clear: 0.8, passages: S.kind !== 'kitchen', corner: 0.6, score: (p) => (S.kind === 'kitchen' ? 0 : Math.min(2.5, wd(p)) * 0.5) + fd(p) });
        if (!sp) continue;
        const endL = sp.s - len / 2, endR = sp.seg.len - sp.s - len / 2;
        const tall = cut || ctx.fridge || len < 2.4 ? 'none' : endL <= endR ? 'left' : 'right';
        const kr = F.kitchenRun(m, len, { tall, ovenColumn: false, ceiling: CH, washer: !ctx.laundry && len >= 2.7, uppers: !cut, hood: !cut, cut, compact: true });
        if (!rpTry(ctx, S, kr, add2(sp.p, sp.nin, 0.31 + 0.012), sp.ang, 0, { tag: 'kitchen' })) continue;
        if (kr.userData.hasWasher) ctx.laundry = 'kitchen';
        if (tall !== 'none') ctx.fridge = true;
        ctx.kitchens.push({ S, p: sp.c, ang: sp.ang, len, front: sp.nin });
        break;
      }
      if (!ctx.fridge && ctx.kitchens.length) {
        const kp = ctx.kitchens[0].p, sp = rpWallSpot(ctx, S, 0.6, 0.62, { tall: true, clear: 0.6, score: (p) => -Math.hypot(p[0] - kp[0], p[1] - kp[1]) });
        if (sp && rpTry(ctx, S, F.fridge(m, { h: cut ? 1.05 : Math.min(2.3, CH - 0.1) }), add2(sp.p, sp.nin, 0.322), sp.ang)) ctx.fridge = true;
      }
    }
  }
  if (ctx.sb && !ctx.sb.tried) rpSofaBed(ctx);
  try { rpEntranceWardrobe(ctx); } catch (err) { ctx.notes.push('entrance wardrobe: ' + (err && err.message)); }
  let seed = 11;
  const order = { bath: 0, kitchen: 1, hall: 2, dressing: 3, bedroom: 4, living: 5 };
  for (const S of P.rooms.slice().sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))) {
    const mine = (I.fixtures || []).filter(f => f.room === S.id).map(f => f.kind);
    const fd = farFromDoors(S), wd = winDist(S);
    try {
      if (S.kind === 'bath') {
        if (!mine.includes('toilet')) { const sp = rpWallSpot(ctx, S, 0.5, 0.66, { tall: true, clear: 0.4, score: (p) => fd(p) * 0.3, corner: 0.3 }); if (sp) rpTry(ctx, S, F.toilet(m), sp.p, sp.ang); }
        if (!mine.includes('basin')) for (const vl of S.wc ? [0.6, 0.5] : [1.0, 0.8, 0.6, 0.5]) {
          const sp = rpWallSpot(ctx, S, vl, 0.5, { tall: true, clear: 0.45, score: (p) => -fd(p) * 0.2 });
          if (sp && rpTry(ctx, S, F.vanity(m, { len: vl }), sp.p, sp.ang)) { rpMirror(ctx, S, sp.p, sp.ang, vl); break; }
        }
        if (!S.wc && !mine.includes('bathtub') && !mine.includes('shower')) {
          let done = false;
          if (S.area >= 3.4 && m.styleId !== 'milano') { const sp = rpWallSpot(ctx, S, 1.72, 0.8, { tall: true, clear: 0.45, corner: 2, score: (p) => fd(p) * 0.4 }); if (sp && rpTry(ctx, S, F.bathtub(m, { len: 1.7, cut }), sp.p, sp.ang)) done = true; }
          if (!done) for (const w of [1.0, 0.9, 0.8]) { const sp = rpWallSpot(ctx, S, w, 0.9, { tall: true, clear: 0.3, corner: 3, score: (p) => fd(p) * 0.4 }); if (sp) { rpShower(ctx, S, sp.c, w, 0.9); break; } }
        }
        ctx.lightSpots.push({ u: S.c[0], v: S.c[1], y: 0, k: 0.55, pri: 2 });
      } else if (S.kind === 'hall') {
        // (the entrance wardrobe: rpEntranceWardrobe; a wall mirror only where no wardrobe door of this hall is one)
        if (!cut && !(ctx.hallW || []).some(q => q.room === S.id && q.mirror)) { const sp = rpWallSpot(ctx, S, 0.7, 0.08, { tall: true, passages: false, score: (p) => -fd(p) * 0.1 }); if (sp) rpTry(ctx, S, F.mirror(m, { w: 0.6, h: 0.9 }), sp.p, sp.ang, 1.15, { free: true }); }
        ctx.lightSpots.push({ u: S.c[0], v: S.c[1], y: 0, k: 0.6, pri: 3 });
      } else if (S.kind === 'dressing') {
        // V7: the open fit-out (shelving, rails, drawers) on every wall that leaves 0.6 m to stand in
        let runs = has(S, 'wardrobe') ? 1 : 0;
        for (let n = 0; n < 3 && runs < 3; n++) { let done = false; for (const D of [0.45, 0.36]) { for (const len of [2.4, 2.0, 1.6, 1.3, 1.0, 0.8, 0.6]) {
          const sp = rpWallSpot(ctx, S, len, D, { tall: true, winFront: 0.5, clear: 0.6, corner: 0.5 });
          if (sp && rpTry(ctx, S, F.dressing(m, { len, h: ctx.tallH, d: D, seed: seed++ }), add2(sp.p, sp.nin, D / 2 + 0.012), sp.ang, 0, { tag: 'dressing', quiet: true })) { done = true; runs++; break; }
        } if (done) break; } if (!done) break; }
        (ctx.extras ||= []).push({ kind: 'dressing', room: S.id, runs });
        if (!runs) ctx.notes.push('dressing room ' + S.id + ': no wall takes shelving with 0.6 m left to stand in');
        ctx.lightSpots.push({ u: S.c[0], v: S.c[1], y: 0, k: 0.3, pri: 6 });
      } else if (S.kind === 'kitchen') {
        ctx.lightSpots.push({ u: S.c[0], v: S.c[1], y: 0, k: 0.7, pri: 2 });
      } else if (S.kind === 'bedroom' || S.kind === 'living') {
        const sleeps = S.kind === 'bedroom' || (!hasBedroom && !S.kitchen && S === P.rooms.find(r => r.kind === 'living'));
        // bed
        if (S.kind === 'bedroom' && !has(S, 'bed')) rpDouble(ctx, S, null, seed++);
        if (sleeps && !has(S, 'bed') && !(S.has && S.has.sofa && S.has.sofa.bed)) {
          for (const [bw, ns] of [[1.6, 1], [1.6, 0], [1.4, 0], [0.9, 0]]) {
            if (S.kind === 'living' && bw < 1.4) break;
            const w = bw + 0.2 + ns * 1.1;
            const sp = rpWallSpot(ctx, S, w, 2.17, { tall: true, clear: 0.55, centre: 0.25, score: (p, seg) => fd(p) * 0.5 + Math.min(1.2, wd(p)) * 0.3 });
            if (!sp) continue;
            const b = { p: add2(sp.p, sp.nin, 1.085 + 0.012), f: sp.nin, ang: sp.ang, bw, xv: xOf(sp.ang), wall: sp.p, atWall: true };
            if (!rpTry(ctx, S, F.bed(m, { w: bw }), b.p, b.ang)) continue;
            (S.has ||= {}).bed = b; rpBedSet(ctx, S, b, seed++);
            break;
          }
        }
        // wardrobe
        if (S.kind === 'living') rpLounge(ctx, S, fd, wd, seed++);
        // V7: a fitted wardrobe in every bedroom (0.6 m deep, as long as the free wall allows; 0.45 m deep where
        // only that fits); a living room that sleeps gets one when the hall's is short
        const hallLen = Math.max(0, ...(ctx.hallW || []).map(q => q.len));
        if (sleeps && !has(S, 'wardrobe') && !(S.kind === 'living' && (S.area < 14 || hallLen >= 1.2))) {
          let done = !!rpBedroomWardrobe(ctx, S, { seed: seed++ });
          // (a small bedroom: the wardrobe may close the narrower side of a bed that is open on both)
          if (!done && S.kind === 'bedroom') {
            const zs = ctx.zones.filter(z => z.kind === 'bedside' && z.id === S.id);
            if (zs.length === 2) { const z = zs.sort((a, b) => a.hl - b.hl)[0]; ctx.zones.splice(ctx.zones.indexOf(z), 1); done = !!rpBedroomWardrobe(ctx, S, { seed: seed++ }); if (done) { ctx.notes.push('bedroom ' + S.id + ': the wardrobe stands beside the bed (one side of the bed stays open)'); if (S.has.bed && S.has.bed.rec) S.has.bed.rec.sideGiven = true; } else ctx.zones.push(z); }
          }
          if (!done && S.kind === 'bedroom') {
            // (a bedroom with its own dressing room, or a flat with one off the hall: that is its wardrobe)
            const own = P.doors.filter(d => d.rooms && d.rooms.includes(S.id)).map(d => P.byId.get(d.rooms[0] === S.id ? d.rooms[1] : d.rooms[0])).find(T => T && T.kind === 'dressing');
            const dr = own || P.rooms.find(T => T.kind === 'dressing');
            if (dr) { S.has.wardrobe = { len: 0, d: 0, dressing: dr.id, own: !!own }; ctx.notes.push('bedroom ' + S.id + ': no free wall for a wardrobe beside the double bed — ' + (own ? 'its own dressing room ' : 'the dressing room ') + dr.id + ' is its wardrobe'); }
            else ctx.notes.push('bedroom ' + S.id + ': NO wardrobe (no free wall for one beside the double bed)');
          }
          else if (done && S.kind === 'bedroom' && S.has.wardrobe.d < 0.6) ctx.notes.push('bedroom ' + S.id + ': wardrobe ' + S.has.wardrobe.d + ' m deep (no wall takes a 0.6 m one)');
        }
        if (S.kind === 'bedroom' && S.has && S.has.bed && S.has.bed.rec) S.has.bed.rec.wardrobe = has(S, 'wardrobe') ? { len: S.has.wardrobe.len, d: S.has.wardrobe.d, drawn: !!S.has.wardrobe.drawn, dressing: S.has.wardrobe.dressing || null } : null;
        if (S.kind !== 'living') {
          // a desk by the window, the TV facing the bed in the largest bedroom
          const b = S.has && S.has.bed;
          if (b && !cut && S === ctx.master) {
            const D = rayPoly(b.p, b.f, S.poly), W = add2(b.p, b.f, D);
            const seg = S.segs.find(s => Math.abs(dot2(sub2(W, s.a), s.nin)) < 0.06 && dot2(s.nin, b.f) < -0.9 && dot2(sub2(W, s.a), s.d) > 0.6 && dot2(sub2(W, s.a), s.d) < s.len - 0.6);
            const s = seg ? dot2(sub2(W, seg.a), seg.d) : 0;
            if (seg && D > 1.9 && D < 4.6 && !seg.wins.some(q => q.s1 > s - 0.65 && q.s0 < s + 0.65) && rpFree(ctx, S, { c: add2(W, seg.nin, 0.1), d: seg.d, hl: 0.6, hw: 0.08 }, { passages: false })) {
              rpTry(ctx, S, F.tv(m, { w: 1.1, live: true, glowZ: -0.02 }), add2(W, seg.nin, 0.035), angOf(seg.nin), 1.05, { free: true }); ctx.tvRooms.push('bedroom');
            }
          }
          if (S.area >= 10.5) {
            const sp = rpWallSpot(ctx, S, 1.0, 0.6, { h: 0.76, clear: 0.6, score: (p) => -wd(p) });
            if (sp && rpTry(ctx, S, F.desk(m, { len: 1.0 }), add2(sp.p, sp.nin, 0.312), sp.ang, 0, { quiet: true })) {
              // V7: a desk niche — two lit shelves over it where the wall behind is plain
              if (!cut && !sp.seg.wins.some(q => q.s1 > sp.s - 0.55 && q.s0 < sp.s + 0.55)) { const ws = F.wallShelves(m, { len: 1.0, seed }); ws.userData.box3.zc = 0.11; rpPut(ctx, S, ws, add2(sp.p, sp.nin, 0.004), sp.ang, 1.28, { free: true }); rpHiCol(ws); (ctx.extras ||= []).push({ kind: 'desk-shelves', room: S.id }); }
            }
          }
          // … and a slim lit bookcase in a large bedroom
          if (S.area >= 12.5) { const sp = rpWallSpot(ctx, S, 0.5, 0.32, { tall: true, winFront: 0.5, clear: 0.7, corner: 1.2, score: (p) => fd(p) * 0.1 }); if (sp && rpTry(ctx, S, F.shelfTower(m, { w: 0.5, h: ctx.tallH, ceil: cut ? 0 : CH - ctx.tallH, seed }), add2(sp.p, sp.nin, 0.16 + 0.012), sp.ang, 0, { tag: 'shelves', quiet: true })) (ctx.extras ||= []).push({ kind: 'bookcase', room: S.id }); }
          ctx.lightSpots.push({ u: S.c[0], v: S.c[1], y: 0, k: 0.7, pri: 1 });
        }
      }
    } catch (err) { ctx.notes.push('furnish ' + S.id + ': ' + (err && err.message)); }
  }
  try { rpPantry(ctx); } catch (err) { ctx.notes.push('pantry: ' + (err && err.message)); }
  // a flat with no washing machine drawn: in its largest bathroom that has the room for it
  if (!ctx.laundry && !ctx.drawn.has('washing-machine')) for (const S of P.rooms.filter(r => r.kind === 'bath' && !r.wc).sort((a, b) => b.area - a.area)) {
    const sp = rpWallSpot(ctx, S, 0.62, 0.6, { tall: true, clear: 0.5, corner: 1 });
    if (sp && rpTry(ctx, S, F.washer(m, {}), add2(sp.p, sp.nin, 0.31), sp.ang, 0, { quiet: true })) { ctx.laundry = 'bath'; break; }
  }
  // a flat that still has no washing machine: a laundry cupboard in the hall
  if (!ctx.laundry && !ctx.drawn.has('washing-machine') && !cut) for (const S of P.rooms.filter(r => r.kind === 'hall')) {
    const sp = rpWallSpot(ctx, S, 0.68, 0.64, { tall: true, clear: 0.7, corner: 1 });
    if (sp) { rpTry(ctx, S, F.laundryTower(m, { h: ctx.tallH, cabinet: true }), add2(sp.p, sp.nin, 0.332), sp.ang); ctx.laundry = 'hall'; break; }
  }
  // ---- outdoor spaces
  for (const S of P.outdoor) {
    try {
      const fd = farFromDoors(S);
      const fy = 0.012;
      let sp = S.area >= 3.2 ? rpWallSpot(ctx, S, 1.62, 0.72, { score: (p) => fd(p), corner: 0.5 }) : null;
      if (sp) rpTry(ctx, S, F.outdoorTable(m), add2(sp.p, sp.nin, 0.37), sp.ang, fy);
      else { sp = rpWallSpot(ctx, S, 0.74, 0.74, { score: (p) => fd(p), corner: 1 }); if (sp) rpTry(ctx, S, F.outdoorChair(m), add2(sp.p, sp.nin, 0.38), sp.ang, fy, { box: { w: 0.72, d: 0.72 } }); }
      if (S.kind === 'terrace' && S.area > 7) {
        sp = rpWallSpot(ctx, S, 2.0, 0.8, { score: (p) => fd(p) * 0.5, corner: 0.5 });
        if (sp) rpTry(ctx, S, F.outdoorLounge(m, { w: 2.0 }), add2(sp.p, sp.nin, 0.42), sp.ang, fy);
        sp = rpWallSpot(ctx, S, 1.2, 0.38, { cls: s => s.cls === 'rail', score: (p) => fd(p) * 0.3 });
        if (sp) rpTry(ctx, S, F.planter(m, { len: 1.2 }), add2(sp.p, sp.nin, 0.2), sp.ang, fy);
      }
      sp = rpWallSpot(ctx, S, 0.5, 0.5, { corner: 2, score: (p) => fd(p) * 0.2 });
      if (sp) rpTry(ctx, S, F.plant(m, S.kind === 'terrace' ? { kind: 'olive', h: 1.6, seed: 9 } : { kind: 'snake', h: 0.8, seed: 21 }), add2(sp.p, sp.nin, 0.27), sp.ang, fy, { box: { w: 0.45, d: 0.45 } });
    } catch (err) { ctx.notes.push('furnish ' + S.id + ': ' + (err && err.message)); }
  }
}
// Living room: sofa (as drawn or along a free wall), coffee table, rug, TV opposite, floor lamp, dining set, plant.
const hasBedroomK = P => P.rooms.some(r => r.kind === 'bedroom');
function rpLounge(ctx, S, fd, wd, seed) {
  const { P, I, m, cut } = ctx;
  let so = S.has && S.has.sofa;
  const bed = S.has && S.has.bed;
  if (!so && !(bed && S.area < 15)) {
    for (const len of [2.3, 2.0, 1.7]) {
      // against a plain wall, with a wall to take the TV 2.4 – 5.5 m in front of it
      const sp = rpWallSpot(ctx, S, len, 1.0, { h: 0.8, clear: 0.8, centre: 0.15, score: (p, seg, s, c) => {
        const D = rayPoly(c, seg.nin, S.poly);
        return (D > 2.2 && D < 5.6 ? 1.2 : 0) + Math.min(2, fd(p)) * 0.3 + (seg.wins.length ? -0.6 : 0);
      } });
      if (!sp) continue;
      const p = add2(sp.p, sp.nin, 0.5 + 0.012);
      if (!rpTry(ctx, S, F.sofa(m, { len }), p, sp.ang)) continue;
      so = (S.has ||= {}).sofa = { p, f: sp.nin, ang: sp.ang, len, xv: xOf(sp.ang), wall: true };
      break;
    }
  }
  if (so) {
    // coffee table + rug
    const tc = add2(so.p, so.f, 0.49 + 0.75);
    const ct = F.coffeeTable(m), sb = ct.userData.solidBox || { w: 1.1, d: 0.7 };
    if (!so.bed && !(S.has && S.has.table && I.fixtures.some(f => f.room === S.id && f.kind === 'table' && Math.hypot(f.c[0] - tc[0], f.c[1] - tc[1]) < 1.3)) && rpFree(ctx, S, { c: tc, d: so.xv, hl: sb.w / 2 + 0.05, hw: sb.d / 2 + 0.3 }, { passages: false })) rpTry(ctx, S, ct, tc, so.ang);
    // a sofa-bed keeps the floor in front of it free: a small table beside an arm instead of the coffee table
    if (so.bed) for (const sd of [-1, 1]) {
      const c = add2(add2(so.p, so.xv, sd * (so.len / 2 + 0.27)), so.f, 0.1);
      if (rpFree(ctx, S, { c, d: so.xv, hl: 0.23, hw: 0.23 }) && rpTry(ctx, S, F.sideTable(m, { lamp: false }), c, so.ang, 0, { quiet: true })) { so.sideAt = sd; break; }
    }
    const rc = add2(so.p, so.f, 0.95), R = { c: rc, d: so.xv, hl: Math.min(1.5, so.len / 2 + 0.3), hw: 1.0 };
    if (rectInPoly(R, S.poly, 0.02)) rpTry(ctx, S, F.rug(m, { w: R.hl * 2, d: 2.0 }), rc, so.ang, 0, { free: true });
    // TV wall opposite
    const D = rayPoly(so.p, so.f, S.poly), W = add2(so.p, so.f, D);
    const seg = S.segs.find(s => Math.abs(dot2(sub2(W, s.a), s.nin)) < 0.06 && dot2(s.nin, so.f) < -0.9 && dot2(sub2(W, s.a), s.d) > 0 && dot2(sub2(W, s.a), s.d) < s.len);
    if (seg && D > 2.2 && D < 6.2) {
      const s0 = dot2(sub2(W, seg.a), seg.d);
      let tvDone = false;
      for (const tl of [2.0, 1.6, 1.2]) {
        const s = clamp(s0, tl / 2 + 0.02, seg.len - tl / 2 - 0.02);
        if (seg.len < tl + 0.04 || Math.abs(s - s0) > 0.9 || seg.wins.some(q => q.s1 > s - tl / 2 && q.s0 < s + tl / 2)) continue;
        const wp = add2(seg.a, seg.d, s), a = angOf(seg.nin);
        if (!rpFree(ctx, S, { c: add2(wp, seg.nin, 0.23), d: seg.d, hl: tl / 2, hw: 0.21 })) continue;
        rpTry(ctx, S, F.tvUnit(m, { len: tl }), add2(wp, seg.nin, 0.222), a);
        // V7: a slim lit shelf tower at an end of the media unit (rooms from 14 m²; a plain wall behind, clear of every way)
        if (S.area >= 14) for (const e of [1, -1]) {
          const sx = s + e * (tl / 2 + 0.06 + 0.25);
          if (sx < 0.27 || sx > seg.len - 0.27 || seg.wins.some(q => q.s1 > sx - 0.3 && q.s0 < sx + 0.3)) continue;
          const c = add2(add2(seg.a, seg.d, sx), seg.nin, 0.16 + 0.012);
          if (!rpFree(ctx, S, { c, d: seg.d, hl: 0.25, hw: 0.16 }, { tol: 0.012 }) || rpWinFront(S, { c, d: seg.d, hl: 0.25, hw: 0.16 }, 0.5)) continue;
          if (rpTry(ctx, S, F.shelfTower(m, { w: 0.5, h: ctx.tallH, ceil: cut ? 0 : CH - ctx.tallH, seed, side: -e }), c, a, 0, { tag: 'shelves', quiet: true })) { (ctx.extras ||= []).push({ kind: 'media-shelves', room: S.id }); break; }
        }
        if (!cut) {
          rpTry(ctx, S, F.tv(m, { w: Math.min(1.45, tl - 0.1), live: true, glowZ: m.fam === 'riviera' ? -0.012 : -0.043 }), add2(wp, seg.nin, 0.1), a, 1.0, { free: true }); ctx.tvRooms.push('living');
          const fwl = Math.min(3.2, 2 * Math.min(s, seg.len - s) - 0.04);
          if (fwl >= tl + 0.3 && !seg.wins.some(q => q.s1 > s - fwl / 2 && q.s0 < s + fwl / 2)) featureWall(ctx, ctx.g, wp[0], wp[1], a, fwl);
        }
        tvDone = true;
        break;
      }
      // (the opened sofa-bed reaches the wall unit's place: the TV alone, on the wall)
      if (!tvDone && so.bed && !cut && s0 > 0.7 && s0 < seg.len - 0.7 && !seg.wins.some(q => q.s1 > s0 - 0.7 && q.s0 < s0 + 0.7)) {
        const wp = add2(seg.a, seg.d, s0);
        if (rpFree(ctx, S, { c: add2(wp, seg.nin, 0.06), d: seg.d, hl: 0.62, hw: 0.05 }, { passages: false })) { rpTry(ctx, S, F.tv(m, { w: 1.2, live: true, glowZ: -0.02 }), add2(wp, seg.nin, 0.035), angOf(seg.nin), 1.05, { free: true }); ctx.tvRooms.push('living'); }
      }
    }
    // floor lamp at an end of the sofa
    for (const sd of [1, -1]) {
      if (so.sideAt === sd) continue;
      const c = add2(add2(so.p, so.xv, sd * (so.len / 2 + 0.26)), so.f, -0.2);
      if (rpFree(ctx, S, { c, d: so.xv, hl: 0.2, hw: 0.2 })) { rpTry(ctx, S, F.floorLamp(m), c, so.ang); break; }
    }
    // V7: a studio (no bedroom): wall cabinets over the sofa-bed — underside at 1.95 m, 0.35 m deep, so the opened
    // bed keeps its headroom — on a plain wall stretch behind it
    let ohDone = false;
    if (!cut && so.wall && so.bed && !hasBedroomK(P)) {
      const seg2 = S.segs.find(s => Math.abs(dot2(sub2(so.p, s.a), s.nin) - 0.52) < 0.1 && dot2(s.nin, so.f) > 0.95 && dot2(sub2(so.p, s.a), s.d) > 0 && dot2(sub2(so.p, s.a), s.d) < s.len);
      if (seg2) {
        const s = dot2(sub2(so.p, seg2.a), seg2.d);
        for (const len of [Math.min(2.4, so.len + 0.4), so.len, 1.5]) {
          const s2 = clamp(s, len / 2 + 0.02, seg2.len - len / 2 - 0.02);
          if (seg2.len < len + 0.04 || Math.abs(s2 - s) > 0.35 || seg2.wins.some(q => q.s1 > s2 - len / 2 - 0.05 && q.s0 < s2 + len / 2 + 0.05)) continue;
          const wp = add2(seg2.a, seg2.d, s2);
          // (nothing tall stands under it: a wardrobe, a fridge)
          if (ctx.occ.some(q => (q.h || 0) > 1.7 && rectOverlap({ c: add2(wp, seg2.nin, 0.19), d: seg2.d, hl: len / 2, hw: 0.18 }, q, -0.01))) continue;
          const oh = F.overhead(m, { len, d: 0.35, hh: ctx.tallH - Y_BRIDGE, ceil: CH - ctx.tallH, brackets: true });
          oh.userData.box3.zc = 0.175;
          rpPut(ctx, S, oh, add2(wp, seg2.nin, 0.003), so.ang, Y_BRIDGE, { free: true }); rpHiCol(oh);
          ctx.overSofa = { room: S.id, len: +len.toFixed(2), y: Y_BRIDGE, d: 0.35 }; ohDone = true;
          if (s > 0.7 && s < seg2.len - 0.7) artOn(ctx, ctx.g, add2(seg2.a, seg2.d, s)[0], add2(seg2.a, seg2.d, s)[1], so.ang, 1.1, 0.55, 0, 1.47);
          break;
        }
      }
      if (!ohDone) ctx.notes.push('sofa-bed in ' + S.id + ': no wall cabinets over it (window behind / short wall)');
    } else if (!cut && so.bed && !hasBedroomK(P)) ctx.notes.push('sofa-bed in ' + S.id + ': no wall cabinets over it (it does not stand against a wall)');
    if (!cut && so.wall && !bed && !ohDone) {
      const seg2 = S.segs.find(s => Math.abs(dot2(sub2(add2(so.p, so.f, -0.5), s.a), s.nin)) < 0.1 && dot2(s.nin, so.f) > 0.95);
      if (seg2) { const s = dot2(sub2(so.p, seg2.a), seg2.d); if (s > 0.7 && s < seg2.len - 0.7 && !seg2.wins.some(q => q.s1 > s - 0.7 && q.s0 < s + 0.7)) { const wp = add2(seg2.a, seg2.d, s); artOn(ctx, ctx.g, wp[0], wp[1], so.ang, 1.2, 0.8, 0, 1.75); } }
    }
    ctx.lightSpots.push({ u: so.p[0] + so.f[0] * 1.0, v: so.p[1] + so.f[1] * 1.0, y: 0, k: 1.0, pri: 0 });
  } else ctx.lightSpots.push({ u: S.c[0], v: S.c[1], y: 0, k: 1.0, pri: 0 });
  // dining set where the plan draws no table: the largest free rectangle
  if (!ctx.diningAt && !ctx.island && (S.kitchen || !P.rooms.some(r => r.kind === 'living' && r.kitchen))) {
    const fr = rpFreeRect(ctx, S);
    if (fr) {
      const w = fr[2] - fr[0], d = fr[3] - fr[1], along = w >= d, L = Math.max(w, d), Wd = Math.min(w, d);
      let tl = 0, tw = 0.85;
      if (L >= 2.5 && Wd >= 2.3) tl = clamp(L - 1.3, 1.2, 1.8); else if (L >= 2.0 && Wd >= 2.0) { tl = 0.9; } else if (L >= 1.7 && Wd >= 1.6) { tl = 0.7; tw = 0.7; }
      if (tl) {
        const c = [(fr[0] + fr[2]) / 2, (fr[1] + fr[3]) / 2];
        if (rpTry(ctx, S, rpDiningSet(ctx, tl, tw, 2), c, along ? 0 : HALF, 0, { box: { w: tl + 0.1, d: tw + 1.0 }, tag: 'dining' })) {
          ctx.diningAt = { u: c[0], v: c[1] };
          ctx.lightSpots.push({ u: c[0], v: c[1], y: 0, k: 0.8, pri: 1 });
        }
      }
    }
  }
  if (!bed || S.area > 18) { const sp = rpWallSpot(ctx, S, 0.9, 0.85, { h: 2, tall: false, corner: 1.5, clear: 0.3, score: (p) => -wd(p) * 0.8 }); if (sp) {
      // the big plant belongs in a corner; by a plain wall a slim one stands close to it, at a wall end none at all
      const q = add2(sp.p, sp.nin, 0.42); let walls = 0;
      for (let k = 0; k < 8; k++) { const r = [q[0] + Math.cos(k * Math.PI / 4 + sp.ang) * 0.85, q[1] + Math.sin(k * Math.PI / 4 + sp.ang) * 0.85]; if (!pointInPoly(r, S.poly)) walls++; }
      if (walls >= 4) rpTry(ctx, S, F.plant(m, { h: 1.5, seed: 4 + seed }), q, sp.ang, 0, { box: { w: 0.6, d: 0.6 } });
      else if (walls >= 3) rpTry(ctx, S, F.plant(m, { kind: 'snake', h: 0.9, seed: 7 + seed }), add2(sp.p, sp.nin, 0.24), sp.ang, 0, { box: { w: 0.4, d: 0.4 } });
    } }
}
// Largest axis-aligned free rectangle of a room (10 cm grid; clear of walls, pieces, door zones) → [u0, v0, u1, v1].
function rpFreeRect(ctx, S, o = {}) {
  const G = 0.1, [bu0, bv0, bu1, bv1] = S.box, nx = Math.ceil((bu1 - bu0) / G), nz = Math.ceil((bv1 - bv0) / G);
  if (nx < 2 || nz < 2 || nx * nz > 40000) return null;
  const free = new Uint8Array(nx * nz), pad = o.pad ?? 0.3;
  const blk = [...ctx.occ.map(q => ({ ...q, hl: q.hl + pad, hw: q.hw + pad })), ...ctx.zones];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const p = [bu0 + (i + 0.5) * G, bv0 + (j + 0.5) * G];
    if (!pointInPoly(p, S.poly) || polyDist(p, S.poly) < (o.wall ?? 0.25)) continue;
    let ok = true;
    for (const q of blk) { const r = sub2(p, q.c); if (Math.abs(dot2(r, q.d)) < q.hl && Math.abs(cross2(q.d, r)) < q.hw) { ok = false; break; } }
    if (ok) free[j * nx + i] = 1;
  }
  let best = null, ba = 0;
  const hgt = new Int32Array(nx);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) hgt[i] = free[j * nx + i] ? hgt[i] + 1 : 0;
    const st = [];
    for (let i = 0; i <= nx; i++) {
      const h = i < nx ? hgt[i] : 0; let start = i;
      while (st.length && st[st.length - 1][1] > h) {
        const [si, sh] = st.pop(), w = i - si;
        // (a square-ish rectangle is worth more than a long sliver)
        const a = Math.min(w, sh * 1.6) * Math.min(sh, w * 1.6);
        if (a > ba) { ba = a; best = [bu0 + si * G, bv0 + (j - sh + 1) * G, bu0 + i * G, bv0 + (j + 1) * G]; }
        start = si;
      }
      if (!st.length || st[st.length - 1][1] < h) st.push([start, h]);
    }
  }
  return best;
}
// Recessed downlights on a grid inside every room + the lamps' light pools.
// V19: every room is its own lighting circuit — its downlights' lit lenses, halos and floor pools live in one small
// unbaked group (lit-<room>), switched by a wall switch beside the way in (F.lightSwitch: a mover group whose listener
// shows / hides the group and tells the walkthrough to dim the room's real lights: window 'vrc:apt-light').
function rpLights(ctx) {
  const { P, m, sg, cut } = ctx;
  if (cut) return;
  ctx.circuits = [];
  for (const S of P.rooms) {
    const lt = new THREE.Group();
    const [u0, v0, u1, v1] = S.box, nu = Math.max(1, Math.round((u1 - u0) / 1.5)), nv = Math.max(1, Math.round((v1 - v0) / 1.5));
    let n = 0;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const p = [u0 + (u1 - u0) * (i + 0.5) / nu, v0 + (v1 - v0) * (j + 0.5) / nv];
      if (!pointInPoly(p, S.poly) || polyDist(p, S.poly) < 0.35) continue;
      rpDownlight(ctx, p[0], CH, p[1], lt); n++;
      FX.fxFlat(lt, m.glowFaint, 'disc', p[0], 0.005, p[1], S.kind === 'bath' ? 1.35 : 1.7, S.kind === 'bath' ? 1.35 : 1.7);
    }
    if (!n) { rpDownlight(ctx, S.c[0], CH, S.c[1], lt); FX.fxFlat(lt, m.glowFaint, 'disc', S.c[0], 0.005, S.c[1], 1.4, 1.4); }
    const id = 'light-' + S.id, out = new THREE.Group(); out.name = 'lit-' + S.id; out.userData.keep = true;
    bake(lt, out); const h = bloomMesh(lt, m); if (h) out.add(h);
    lt.traverse(o => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) { /* source geometries are cached kit geometry */ } });
    sg.add(out);
    const rec = { id, room: S.id, group: out, on: true, switch: null };
    // the switch: on a plain wall stretch of the room, beside the door you come in by (the curtain switch keeps its place)
    const dr = P.doors.find(d => d.rooms && d.rooms.includes(S.id) && d.type !== 'balcony') || null;
    const ref = dr ? dr.p : S.c;
    if (S.segs && S.segs.length) {
      const sp = rpWallSpot(ctx, S, 0.14, 0.05, { tall: true, passages: false, score: (p) => -Math.hypot(p[0] - ref[0], p[1] - ref[1]) });
      if (sp) {
        const sw = F.lightSwitch(m, { id });
        sw.position.set(sp.p[0], 1.1, sp.p[1]); sw.rotation.y = sp.ang; sg.add(sw);
        rec.switch = { u: sp.p[0], v: sp.p[1], y: 1.1 };
        ctx.occ.push({ c: add2(sp.p, sp.nin, 0.03), d: sp.d, hl: 0.1, hw: 0.03, h: 0.2, tag: 'switch', room: S.id, wallOnly: true });
      }
    }
    ctx.circuits.push(rec);
  }
}
// V19: the TV remote — on the coffee table of the TV's room, else on a side table, else on the sofa seat beside the arm.
// Unbaked (it is picked up: hidden while the visitor holds it) with a finger-sized tap box; part 'remote'.
function rpRemote(ctx) {
  const { m, sg, cut, unit, P } = ctx;
  if (cut) return;
  sg.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(sg.matrixWorld).invert(), w = new THREE.Vector3(), q = new THREE.Quaternion();
  let tvRoom = null; const pieces = [];
  sg.traverse(o => {
    const ud = o.userData || {};
    if (ud.tvScreen && !tvRoom) { o.getWorldPosition(w).applyMatrix4(inv); o.getWorldQuaternion(q); const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q); tvRoom = P.rooms.find(r => pointInPoly([w.x + n.x * 0.5, w.z + n.z * 0.5], r.poly)) || null; }
    if (ud.piece === 'coffeeTable' || ud.piece === 'sideTable' || ud.piece === 'sofa' || ud.piece === 'sofaBed' || ud.piece === 'sofaBook') pieces.push(o);
  });
  const roomOf = (o) => { o.getWorldPosition(w).applyMatrix4(inv); return P.rooms.find(r => pointInPoly([w.x, w.z], r.poly)) || null; };
  const inRoom = pieces.filter(o => !tvRoom || roomOf(o) === tvRoom);
  const pick = (k) => inRoom.find(o => k.includes(o.userData.piece)) || pieces.find(o => k.includes(o.userData.piece));
  let at = null, ry = 0, where = null;
  const ct = pick(['coffeeTable']), st = !ct && pick(['sideTable']), so = !ct && !st && pick(['sofa', 'sofaBed', 'sofaBook']);
  if (ct) { const p = ct.localToWorld(new THREE.Vector3(0.18, ct.userData.top ?? 0.4, 0.12)).applyMatrix4(inv); ct.getWorldQuaternion(q); at = p; ry = new THREE.Euler().setFromQuaternion(q).y + 0.35; where = 'coffeeTable'; }
  else if (st) { const p = st.localToWorld(new THREE.Vector3(0.1, 0.525, 0.07)).applyMatrix4(inv); at = p; ry = 0.6; where = 'sideTable'; }
  else if (so) {   // the seat beside one arm (from the sofa's footprint record: centre, long axis, half length)
    const R = ctx.occ.find(q => /sofa/i.test(q.tag || '') && (!tvRoom || q.room === tvRoom.id)) || ctx.occ.find(q => /sofa/i.test(q.tag || ''));
    if (R) { const c = add2(R.c, R.d, Math.max(0, R.hl - 0.34)); at = new THREE.Vector3(c[0], 0.45, c[1]); ry = Math.atan2(R.d[0], R.d[1]) + 0.25; where = 'sofa'; } }
  if (!at) {        // no seating in the TV's room (a kitchen-dining room): on the table there, else a sideboard / desk / bed
    const ok = q => q.h >= 0.4 && q.h <= 1.0 && q.hl > 0.2 && q.hw > 0.15;
    const R = ['table', 'dining', 'sideboard', 'tvUnit', 'desk', 'nightstand', 'bed'].map(k => ctx.occ.find(q => (q.tag || '') === k && ok(q) && (!tvRoom || q.room === tvRoom.id)) || ctx.occ.find(q => (q.tag || '') === k && ok(q))).find(Boolean);
    if (R) { const c = add2(R.c, R.d, Math.min(0.3, R.hl * 0.5)); at = new THREE.Vector3(c[0], R.h + 0.002, c[1]); ry = Math.atan2(R.d[0], R.d[1]) + 0.4; where = R.tag; }
  }
  if (!at) return;
  const r = new THREE.Group(); bake(F.remote(m), r); r.position.copy(at); r.rotation.y = ry; r.userData.keep = true; r.name = 'tv-remote';   // 4 draw calls
  r.traverse(o => { if (o.isMesh) o.raycast = NO_RAYCAST; });
  if (!COLMAT) { COLMAT = new THREE.MeshBasicMaterial({ visible: false }); COLMAT.name = 'collider'; }
  const px = new THREE.Mesh(UBOX, COLMAT); px.name = 'tv-remote'; px.position.set(0, 0.03, 0); px.scale.set(0.16, 0.08, 0.3); r.add(px);
  const ud = px.userData; ud.piece = 'remote'; ud.open = ud._open = false; ud.keepState = true; ud.action = { type: 'aptDoor', unitId: unit.id, part: 'remote' };
  ud.toggle = (on) => { const want = on === undefined ? !ud.open : !!on; ud.open = ud._open = want; for (const c of r.children) if (c !== px) c.visible = !want; return Promise.resolve(); };
  sg.add(r);
  ctx.remote = { where, room: tvRoom ? tvRoom.id : null, proxy: px, group: r };
}
// V19: lamps (floor / table / pendant / chandelier / sconce) switch on and off at a tap: the bulbs, light pools and halos
// of each lamp go into one small unbaked group with an invisible tap box around the lamp.
const LAMP_PIECES = new Set(['floorLamp', 'tableLamp', 'pendant', 'chandelier', 'lanternPendant', 'globeChandelier', 'sconce']);
function rpLampsLive(ctx) {
  const { m, sg, cut, unit } = ctx;
  if (cut) return;
  const LIT = new Set([m.bulb, m.glow, m.glowFaint, m.lampGlow, m.lightEmit]);
  sg.updateMatrixWorld(true);
  const lamps = [];
  sg.traverse(o => { if (o.userData && LAMP_PIECES.has(o.userData.piece)) { for (let p = o.parent; p; p = p.parent) if (p.userData && LAMP_PIECES.has(p.userData.piece)) return; lamps.push(o); } });
  ctx.lamps = [];
  const inv = new THREE.Matrix4().copy(sg.matrixWorld).invert();
  for (const L of lamps) {
    const parts = [];
    L.traverse(o => { if ((o.isMesh && LIT.has(o.material)) || (o.userData && o.userData.bloom)) parts.push(o); });
    if (!parts.length) continue;
    const tmp = new THREE.Group(); tmp.matrixAutoUpdate = false;
    for (const o of parts) { const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); o.parent.remove(o); M.decompose(o.position, o.quaternion, o.scale); tmp.add(o); }
    tmp.updateMatrixWorld(true);
    const out = new THREE.Group(); out.name = 'lamp-lit'; out.userData.keep = true;
    bake(tmp, out); const h = bloomMesh(tmp, m); if (h) out.add(h);
    sg.add(out);
    const bb = new THREE.Box3().setFromObject(L), c = bb.getCenter(new THREE.Vector3()).applyMatrix4(inv), sz = bb.getSize(new THREE.Vector3());
    if (!COLMAT) { COLMAT = new THREE.MeshBasicMaterial({ visible: false }); COLMAT.name = 'collider'; }
    const px = new THREE.Mesh(UBOX, COLMAT); px.name = 'lamp-' + L.userData.piece; px.userData.keep = true;
    px.position.copy(c); px.scale.set(Math.max(0.12, Math.min(sz.x, 0.7)), Math.max(0.12, sz.y), Math.max(0.12, Math.min(sz.z, 0.7)));
    let on = true;
    const ud = px.userData; ud.piece = L.userData.piece; ud.open = ud._open = true; ud.action = { type: 'aptDoor', unitId: unit.id, part: 'lamp' }; ud.keepState = true;
    ud.toggle = (want) => { want = want === undefined ? !on : !!want; on = want; ud.open = ud._open = want; out.visible = want; return Promise.resolve(); };
    sg.add(px);
    ctx.lamps.push({ piece: L.userData.piece, proxy: px, group: out, get on() { return on; }, toggle: ud.toggle });
  }
}
// ---------------------------------------------------------------- V18: built-in surround sound (owner, 10 Oct)
// Every flat: a 5.1 system in the living room — front left / right in-wall speakers flanking the TV, a slim soundbar
// under the set (centre channel), an in-wall subwoofer low on the TV wall, two in-ceiling surrounds behind the seating —
// and flush in-ceiling speakers in the other rooms (bedrooms 2, kitchen / hall / bathroom 1, large rooms 2). All of it is
// derived from the room polygons, the placed TV, the windows, doors and the downlights; flush grilles (micro-perforated,
// white on the ceiling, graphite in the wall) baked into the flat's meshes like the joinery (+2 materials = +2 draw calls).
// The positions are published as apt.speakers (unit frame) — the walkthrough's apartment radio reads them.
let SPK_M = null;
function spkMats() {
  if (SPK_M) return SPK_M;
  let map = null;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#3a3a3a';
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(4 + i * 8 + (j % 2 ? 4 : 0), 4 + j * 8, 2.3, 0, Math.PI * 2); x.fill(); }
    map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(22, 22); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  } catch { map = null; }                                                                  // (no DOM: a plain grille)
  SPK_M = {
    white: new THREE.MeshStandardMaterial({ name: 'spk.grilleWhite', color: 0xeeece7, roughness: 0.55, metalness: 0.25, map }),
    dark: new THREE.MeshStandardMaterial({ name: 'spk.grilleDark', color: 0x55575a, roughness: 0.5, metalness: 0.45, map }),
  };
  return SPK_M;
}
// V18: the living room of every flat gets a wall TV — when the furnishing rules found no wall opposite the sofa, the
// best plain wall stretch: no window, no door swing / passage in front, no tall furniture, the widest view across the
// room, facing the sofa where there is one. Wall-hung (bottom edge 1.05 m), so it never blocks a way.
function rpEnsureTv(ctx) {
  const { P, m, cut } = ctx;
  if (cut) return;
  ctx.sg.updateMatrixWorld(true);
  const have = new Set(), wp3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), nv = new THREE.Vector3();
  ctx.sg.traverse(o => { if (!o.userData || !o.userData.tvScreen) return; o.getWorldPosition(wp3); o.getWorldQuaternion(q4); nv.set(0, 0, 1).applyQuaternion(q4);
    const pr = [wp3.x + nv.x * 0.4, wp3.z + nv.z * 0.4], S = P.rooms.find(r => pointInPoly(pr, r.poly)); if (S) have.add(S.id); });
  let livs = P.rooms.filter(r => r.kind === 'living' && !r.out);
  if (!livs.length) livs = P.rooms.filter(r => !r.out && r.kind === 'bedroom').sort((a, b) => b.area - a.area).slice(0, 1);
  if (livs.some(S => have.has(S.id))) return;
  const S = livs.sort((a, b) => b.area - a.area)[0]; if (!S || !S.segs) return;
  const sofa = ctx.occ.find(q => q.room === S.id && /sofa/i.test(q.tag || ''));
  let best = null;
  for (const [hl, minAcross, loose] of [[0.65, 1.8, false], [0.52, 1.3, false], [0.47, 1.0, true]]) {
  if (best) break;
  for (const seg of S.segs) {
    if (seg.len < hl * 2) continue;
    for (let s = hl; s <= seg.len - hl + 1e-6; s += 0.1) {
      if (seg.wins.some(q => q.s1 > s - hl - 0.05 && q.s0 < s + hl + 0.05)) continue;
      const wp = add2(seg.a, seg.d, s), across = rayPoly(add2(wp, seg.nin, 0.05), seg.nin, S.poly);
      if (!(across > minAcross)) continue;
      const R = { c: add2(wp, seg.nin, 0.16), d: seg.d, hl: hl + 0.03, hw: 0.16 };
      if (!pointInPoly(R.c, S.poly)) continue;
      // (last pass: a wall-hung set only meets a door leaf or tall furniture — floor clearances and lamps do not matter)
      if (ctx.zones.some(z => (loose ? z.kind === 'swing' : (z.kind === 'swing' || z.kind === 'approach' || z.kind === 'passage')) && rectOverlap(R, z.core ? { ...z, hl: z.core } : z))) continue;
      if (ctx.occ.some(q => (q.h == null || q.h > (loose ? 1.1 : 0.95) || /kitchen|fridge|wardrobe|pantry|shel|cabinet|island|desk|table/i.test(q.tag || '')) && !(loose && /lamp/i.test(q.tag || '')) && rectOverlap(R, q))) continue;
      let sc = Math.min(across, 4.5) - Math.abs(s - seg.len / 2) * 0.12;
      if (sofa) { const to = sub2(sofa.c, wp), l = Math.hypot(to[0], to[1]) || 1; sc += 2.2 * dot2(seg.nin, [to[0] / l, to[1] / l]); }
      if (!best || sc > best.sc) best = { sc, seg, s, wp, hl };
    }
  }
  }
  if (!best) { ctx.notes.push('tv: no free wall in ' + S.id); return; }
  const w = best.hl < 0.5 ? 0.9 : best.hl < 0.6 ? 1.0 : best.seg.len >= 2.2 ? 1.45 : 1.2;
  rpTry(ctx, S, F.tv(m, { w, live: true, glowZ: -0.02 }), add2(best.wp, best.seg.nin, 0.035), angOf(best.seg.nin), 1.05, { free: true, quiet: true });
  ctx.tvRooms.push(S.kind === 'living' ? 'living' : 'bedroom'); (ctx.extras ||= []).push({ kind: 'tv-added', room: S.id });
}
const SPK_ROOMS = { bedroom: 2, kitchen: 1, hall: 1, bath: 1, wc: 1, dining: 1, study: 1, cabinet: 1 };
function rpSpeakers(ctx) {
  const { P, m, sg, cut } = ctx;
  if (cut || ctx.noSpeakers) return;
  const M = spkMats(), out = (ctx.speakers = []), downs = ctx.downs || [];
  const H = FX.HALF;
  const ceilOK = (S, p, clr = 0.32) => pointInPoly(p, S.poly) && polyDist(p, S.poly) >= clr && !downs.some(d => Math.hypot(d[0] - p[0], d[1] - p[1]) < 0.36);
  // nudge a ceiling point until it is clear of the walls and the downlights (small spiral search)
  const ceilSpot = (S, p) => { if (ceilOK(S, p)) return p; for (let r = 0.15; r <= 0.9; r += 0.15) for (let a = 0; a < 12; a++) { const q = [p[0] + Math.cos(a * Math.PI / 6) * r, p[1] + Math.sin(a * Math.PI / 6) * r]; if (ceilOK(S, q)) return q; } return null; };
  const ceil = (S, p, role) => {
    const q = ceilSpot(S, p) || (S.area < 4 ? (ceilOK(S, p, 0.2) ? p : null) : null); if (!q || out.some(o => o.y > 2 && Math.hypot(o.u - q[0], o.v - q[1]) < 0.5)) return null;
    FX.cyl(sg, 0.118, 0.118, 0.007, M.white, q[0], CH - 0.007, q[1], 28);               // bezel, flush with the ceiling
    FX.disc(sg, 0.104, M.white, q[0], CH - 0.0075, q[1], [H, 0, 0], 28);               // micro-perforated grille
    const s = { role, room: S.id, kind: S.kind, u: +q[0].toFixed(3), v: +q[1].toFixed(3), y: +(CH - 0.01).toFixed(3), mount: 'ceiling' };
    out.push(s); return s;
  };
  // ---- living rooms: 5.1 around the TV
  sg.updateMatrixWorld(true);
  const tvs = []; sg.traverse(o => { if (o.userData && o.userData.tvScreen) tvs.push(o); });
  const wp = new THREE.Vector3(), wn = new THREE.Vector3(), q4 = new THREE.Quaternion();
  const living = new Set();
  for (const scr of tvs) {
    scr.getWorldPosition(wp); scr.getWorldQuaternion(q4); wn.set(0, 0, 1).applyQuaternion(q4);
    const n = [wn.x, wn.z], nl = Math.hypot(n[0], n[1]) || 1; n[0] /= nl; n[1] /= nl;
    const c0 = [wp.x, wp.z], probe = [c0[0] + n[0] * 0.4, c0[1] + n[1] * 0.4];
    const S = P.rooms.find(r => pointInPoly(probe, r.poly));
    if (!S || living.has(S.id) || (S.kind !== 'living' && !(ctx.extras || []).some(x => x.kind === 'tv-added' && x.room === S.id))) continue;
    // the wall behind the set (the screen hangs 4–11 cm in front of it)
    const dw = rayPoly([c0[0] + n[0] * 0.02, c0[1] + n[1] * 0.02], [-n[0], -n[1]], S.poly), c = Number.isFinite(dw) && dw < 0.4 ? [c0[0] + n[0] * (0.02 - dw), c0[1] + n[1] * (0.02 - dw)] : c0;
    living.add(S.id);
    const tw = scr.userData.tvScreen.w, th = scr.userData.tvScreen.h, yc = wp.y, d = [-n[1], n[0]];        // d: along the wall
    // soundbar (centre channel) under the set, on the wall
    const sbW = Math.min(1.2, tw * 0.78), yb = yc - th / 2 - 0.16;
    const sb = new THREE.Group(); sb.position.set(c[0] + n[0] * 0.045, 0, c[1] + n[1] * 0.045); sb.rotation.y = Math.atan2(n[0], n[1]);   // on the wall, under the set
    FX.rbox(sb, sbW, 0.072, 0.085, 0.02, m.darkPlastic, 0, yb, 0);
    FX.box(sb, sbW - 0.03, 0.05, 0.004, M.dark, 0, yb + 0.011, 0.043);
    FX.box(sb, 0.05, 0.004, 0.002, m.lightEmit || m.darkPlastic, sbW / 2 - 0.06, yb + 0.006, 0.0455);    // status light
    sg.add(sb);
    out.push({ role: 'C', room: S.id, kind: S.kind, u: +c[0].toFixed(3), v: +c[1].toFixed(3), y: +(yb + 0.036).toFixed(3), mount: 'soundbar', n });
    // in-wall front left / right (and the subwoofer) on the TV wall: clear of windows, doors and tall furniture
    const wallFree = (along, w, y0, y1) => {
      const q = [c[0] + d[0] * along, c[1] + d[1] * along];
      const inner = [q[0] + n[0] * 0.2, q[1] + n[1] * 0.2];
      if (!pointInPoly(inner, S.poly) || polyDist(inner, S.poly) < 0.12) return null;
      if (rayPoly(inner, [-n[0], -n[1]], S.poly) > 0.3) return null;                      // the wall is not there (an alcove / opening)
      for (const W of ctx.wins) { const rel = [q[0] - W.mid[0], q[1] - W.mid[1]]; if (Math.abs(rel[0] * W.e.d[0] + rel[1] * W.e.d[1]) < W.len / 2 + w / 2 + 0.12 && Math.abs(rel[0] * W.e.n[0] + rel[1] * W.e.n[1]) < 0.45) return null; }
      const R = { c: [q[0] + n[0] * 0.15, q[1] + n[1] * 0.15], d, hl: w / 2 + 0.03, hw: 0.15 };
      // a flush grille only meets a door leaf (swing) or furniture standing in front of it (floor clearances do not matter)
      if (ctx.zones.some(z => (z.kind === 'swing' || (y0 < 0.5 && z.kind === 'passage')) && rectOverlap(R, z.core ? { ...z, hl: z.core } : z))) return null;
      if (ctx.occ.some(o => (o.h == null || o.h > y0) && rectOverlap(R, o))) return null;
      return q;
    };
    const fw = 0.2, fh = 0.36, y0 = Math.max(0.55, yc - fh / 2);
    for (const [role, sgn] of [['FL', -1], ['FR', 1]]) {
      let q = null;
      for (const extra of [0.32, 0.45, 0.6, 0.22]) { q = wallFree(sgn * (tw / 2 + extra), fw, y0, y0 + fh); if (q) break; }
      if (!q) { const alt = ceil(S, [c[0] + d[0] * sgn * (tw / 2 + 0.3) + n[0] * 0.6, c[1] + d[1] * sgn * (tw / 2 + 0.3) + n[1] * 0.6], role); if (alt) alt.fallback = 'ceiling'; continue; }
      const g = new THREE.Group(); g.position.set(q[0] + n[0] * 0.004, 0, q[1] + n[1] * 0.004); g.rotation.y = Math.atan2(n[0], n[1]);
      FX.rbox(g, fw + 0.024, fh + 0.024, 0.008, 0.004, M.white, 0, y0 - 0.012, 0);          // flush frame (paint-matched)
      FX.box(g, fw, fh, 0.004, M.dark, 0, y0, 0.0035);                                         // grille
      sg.add(g);
      out.push({ role, room: S.id, kind: S.kind, u: +q[0].toFixed(3), v: +q[1].toFixed(3), y: +(y0 + fh / 2).toFixed(3), mount: 'wall', n });
    }
    // subwoofer: square in-wall grille low on the TV wall, on the side with room
    for (const along of [-(tw / 2 + 0.3), tw / 2 + 0.3, -(tw / 2 + 0.75), tw / 2 + 0.75]) {
      const q = wallFree(along, 0.3, 0.12, 0.42); if (!q) continue;
      const g = new THREE.Group(); g.position.set(q[0] + n[0] * 0.004, 0, q[1] + n[1] * 0.004); g.rotation.y = Math.atan2(n[0], n[1]);
      FX.rbox(g, 0.324, 0.324, 0.008, 0.004, M.white, 0, 0.12 - 0.012, 0); FX.box(g, 0.3, 0.3, 0.004, M.dark, 0, 0.12, 0.0035);
      sg.add(g); out.push({ role: 'LFE', room: S.id, kind: S.kind, u: +q[0].toFixed(3), v: +q[1].toFixed(3), y: 0.27, mount: 'wall', n }); break;
    }
    // (no room beside the set: the slim in-wall subwoofer goes low on another plain wall of the room)
    if (!out.some(o => o.role === 'LFE' && o.room === S.id)) {
      lfe: for (const seg of S.segs || []) {
        if (seg.len < 0.6) continue;
        for (let t = 0.3; t <= seg.len - 0.3 + 1e-6; t += 0.15) {
          if (seg.wins.some(w => w.s1 > t - 0.3 && w.s0 < t + 0.3 && w.sill < 0.5)) continue;
          const q = add2(seg.a, seg.d, t), sn = seg.nin, R = { c: add2(q, sn, 0.15), d: seg.d, hl: 0.18, hw: 0.15 };
          if (!pointInPoly(R.c, S.poly)) continue;
          if (ctx.zones.some(z => (z.kind === 'swing' || z.kind === 'approach' || z.kind === 'passage') && rectOverlap(R, z.core ? { ...z, hl: z.core } : z))) continue;
          if (ctx.occ.some(o => rectOverlap(R, o))) continue;
          const g = new THREE.Group(); g.position.set(q[0] + sn[0] * 0.004, 0, q[1] + sn[1] * 0.004); g.rotation.y = Math.atan2(sn[0], sn[1]);
          FX.rbox(g, 0.324, 0.324, 0.008, 0.004, M.white, 0, 0.12 - 0.012, 0); FX.box(g, 0.3, 0.3, 0.004, M.dark, 0, 0.12, 0.0035);
          sg.add(g); out.push({ role: 'LFE', room: S.id, kind: S.kind, u: +q[0].toFixed(3), v: +q[1].toFixed(3), y: 0.27, mount: 'wall', n: sn.slice() }); break lfe;
        }
      }
    }
    // surrounds: in the ceiling behind the seating (≈ 85 % of the room depth in front of the TV, ≤ 3.6 m), ±1.1 m aside
    const depth = Math.min(rayPoly([c[0] + n[0] * 0.05, c[1] + n[1] * 0.05], n, S.poly), 6);
    const back = Math.max(1.6, Math.min(3.6, (Number.isFinite(depth) ? depth : 3) * 0.85 - 0.25));
    for (const [role, sgn] of [['SL', -1], ['SR', 1]]) {
      let s = null;
      for (const lat of [1.1, 0.85, 1.35, 0.6]) { s = ceil(S, [c[0] + n[0] * back + d[0] * sgn * lat, c[1] + n[1] * back + d[1] * sgn * lat], role); if (s) break; }
    }
  }
  // living rooms without a TV (a kitchen-living whose set went elsewhere): two ceiling speakers
  for (const S of P.rooms) {
    if (S.out) continue;
    const k = S.kind === 'living' ? (living.has(S.id) ? 0 : 2) : (SPK_ROOMS[S.kind] || 0);
    if (!k || S.area < 1.4) continue;
    const [u0, v0, u1, v1] = S.box, lu = u1 - u0, lv = v1 - v0;
    const two = k >= 2 || (S.area > 14 && lu * lv > 0), ax = lu >= lv ? [1, 0] : [0, 1], half = Math.min(1.0, Math.max(lu, lv) * 0.25);
    if (two && Math.max(lu, lv) > 2.4) { ceil(S, [S.c[0] - ax[0] * half, S.c[1] - ax[1] * half], 'L'); ceil(S, [S.c[0] + ax[0] * half, S.c[1] + ax[1] * half], 'R'); }
    else ceil(S, S.c, 'M');
  }
}

// A standing point in every space: on the floor, clear of walls and furniture, as central as that allows.
function rpStand(ctx, S, o = {}) {
  const G = 0.1, [u0, v0, u1, v1] = S.box, MIN = o.min ?? 0.3;
  const occ = ctx.occ.filter(q => q.room === S.id || true);
  let best = null;
  const near = o.near || S.c;
  for (let v = v0 + G / 2; v < v1; v += G) for (let u = u0 + G / 2; u < u1; u += G) {
    const p = [u, v];
    if (!pointInPoly(p, S.poly)) continue;
    if (o.ok && !o.ok(p)) continue;
    let cl = polyDist(p, S.poly);
    if (cl < MIN) continue;
    for (const q of occ) {
      const r = sub2(p, q.c), dx = Math.max(0, Math.abs(dot2(r, q.d)) - q.hl), dz = Math.max(0, Math.abs(cross2(q.d, r)) - q.hw);
      cl = Math.min(cl, Math.hypot(dx, dz));
      if (cl < MIN) break;
    }
    if (cl < MIN) continue;
    const sc = Math.min(cl, o.cap ?? 0.75) * 2 - Math.hypot(p[0] - near[0], p[1] - near[1]) * (o.pull ?? 0.35);
    if (!best || sc > best.sc) best = { sc, p, cl };
  }
  if (!best && (o.min ?? 0.3) > 0.13) return rpStand(ctx, S, { ...o, min: (o.min ?? 0.3) - 0.08 });
  return best ? [+best.p[0].toFixed(3), +best.p[1].toFixed(3)] : [+S.c[0].toFixed(3), +S.c[1].toFixed(3)];
}

// ---------------------------------------------------------------- curtains (straight windows of living rooms / bedrooms)
function rpCurtains(ctx) {
  const { P, I, m, cut } = ctx;
  if (cut || ctx.opts.curtains === 'none') return;
  for (const S of P.rooms) {
    if (S.kind !== 'living' && S.kind !== 'bedroom') continue;
    // one track per straight window wall stretch: the windows of a wall stretch are joined
    for (const seg of S.segs) {
      const ws = seg.wins.filter(w => w.s1 - w.s0 > 0.25);
      if (!ws.length || seg.len < 1.2) continue;
      const a0 = Math.max(0.05, Math.min(...ws.map(w => w.s0)) - 0.25), a1 = Math.min(seg.len - 0.05, Math.max(...ws.map(w => w.s1)) + 0.25), w = a1 - a0;
      if (w < 1.1) continue;
      const p = add2(add2(seg.a, seg.d, (a0 + a1) / 2), seg.nin, 0.14);
      // (not across a door to the balcony, not through furniture standing at the window)
      if (ctx.zones.some(z => z.kind !== 'passage' && z.kind !== 'bedside' && rectOverlap({ c: p, d: seg.d, hl: w / 2, hw: 0.1 }, z, -0.02))) continue;
      const id = 'cur0-' + ctx.curtains.length;
      rpPut(ctx, S, F.motorCurtains(m, { w, h: CH - 0.05 - 0.04, id }), p, angOf(seg.nin), CH - 0.05, { free: true });
      const dr = P.doors.find(d => d.rooms && d.rooms.includes(S.id) && d.type !== 'balcony');
      ctx.curtains.push({ id, level: 0, room: S, kind: S.kind, roomName: S.name, u: p[0], v: p[1], y: CH - 0.05, ref: dr ? dr.p : S.c });
    }
  }
  // wall switch of every curtain: on a plain wall stretch of the room, as near as possible to where you come in
  for (const rec of ctx.curtains) {
    const S = rec.room;
    const sp = rpWallSpot(ctx, S, 0.16, 0.05, { tall: true, passages: false, score: (p) => -Math.hypot(p[0] - rec.ref[0], p[1] - rec.ref[1]) });
    if (!sp) continue;
    const sw = F.curtainSwitch(m, { id: rec.id });
    sw.position.set(sp.p[0], 1.05, sp.p[1]); sw.rotation.y = sp.ang; ctx.sg.add(sw);
    const face = Math.abs(sp.nin[0]) > Math.abs(sp.nin[1]) ? (sp.nin[0] > 0 ? '+u' : '-u') : (sp.nin[1] > 0 ? '+v' : '-v');
    rec.switch = { u: sp.p[0], v: sp.p[1], y: 1.05, face };
    ctx.occ.push({ c: add2(sp.p, sp.nin, 0.03), d: sp.d, hl: 0.1, hw: 0.03, h: 0.2, tag: 'switch', room: S.id, wallOnly: true });
  }
}

// ---------------------------------------------------------------- main (real interior)
function buildReal(unit, styleId, opts, I) {
  const m = getMaterials(styleId);
  const P = rpPlan(unit, I);
  if (!P.rooms.length) throw new Error('apartment: interior without rooms');
  if (!P.segsDone) { rpSegs(P); P.segsDone = true; }
  for (const S of P.spaces) S.has = null;
  const cut = !!opts.cutaway;
  const root = new THREE.Group(); root.name = 'apartment-' + unit.id + '-' + m.styleId + (cut ? '-cut' : '');
  const sg = new THREE.Group(); sg.name = 'static-src';
  const cg = new THREE.Group(); cg.name = 'colliders';
  const ctx = { real: true, tallH: cut ? 1.05 : CH - 0.05, P, I, m, sg, cg, root, unit, cut, opts, A: rpAcc(), tmpGeos: [], colGeos: [], lightSpots: [], wins: [], doors: [], idoors: [], balconyDoors: [],
    zones: [], occ: [], kitchens: [], curveSt: new Map(), curtains: [], busy: [], tvRooms: [], notes: [], laundry: null, sb: null, sofaBed: null, curLevel: null, segs: {}, showers: [], noFx: !!opts.noFx };
  ctx.master = P.rooms.filter(r => r.kind === 'bedroom').sort((a, b) => b.area - a.area)[0] || null;
  ctx.g = new THREE.Group(); sg.add(ctx.g);
  CUR_M = m;
  const T0 = performance.now();
  try {
    rpShell(ctx);
    rpDoors(ctx);
    ctx.A.flush(sg, ctx.tmpGeos);
    // columns
    for (const c of I.columns || []) { FX.cyl(sg, c.r || 0.25, c.r || 0.25, cut ? 1.1 : CH, m.wall, c.c[0], 0, c.c[1], 28); ocollider(cg, c.c, [1, 0], (c.r || 0.25) * 0.9, (c.r || 0.25) * 0.9, 0.02, 2.2); }
    rpFixtures(ctx);
    rpLeaves(ctx); ctx.leavesDone = true;
    { const tR = performance.now(); rpRules(ctx); ctx.msRules = performance.now() - tR; }
    rpCurtains(ctx);
    rpLights(ctx);
    try { rpLampsLive(ctx); } catch (e) { ctx.notes.push('lamps: ' + (e && e.message)); }      // V19: lamps switch on / off
    try { rpEnsureTv(ctx); } catch (e) { ctx.notes.push('tv: ' + (e && e.message)); }          // V18: a TV in every flat (Kvartal 95 channel)
    try { rpRemote(ctx); } catch (e) { ctx.notes.push('remote: ' + (e && e.message)); }        // V19: the TV remote on the coffee table / by the sofa
    try { rpSpeakers(ctx); } catch (e) { ctx.notes.push('speakers: ' + (e && e.message)); }   // V18: surround sound (never breaks a flat)
  } finally { CUR_M = null; }
  const baked = new THREE.Group(); baked.name = 'baked';
  root.add(baked);
  // the sofa-bed's colliders: its own box (always solid) and the floor the opened bed takes (solid while open)
  let sbCols = null;
  if (ctx.sofaBed) {
    const q = ctx.sofaBed, own = q.obj.children.find(c => c.userData.collider) || null;
    const ext = ocollider(cg, q.Ro.c, q.Ro.d, q.Ro.hl, q.Ro.hw, 0.02, 0.62);
    ext.name = 'col-sofabed'; ext.userData.solid = false; ext.raycast = NO_RAYCAST;
    sbCols = { own, ext };
  }
  const T1 = performance.now();
  const movers = cut ? null : buildMovers(ctx, sg, root);
  const bdoors = cut ? [] : wireBalconyDoors(ctx, movers);
  const idoors = cut ? [] : wireBalconyDoors({ unit, balconyDoors: ctx.idoors }, movers, 'interiorDoor');
  for (const d of ctx.doors) if (d.type === 'balcony' || d.type === 'interior') { const live = typeof d.toggle === 'function'; d.state = live ? 'closed' : 'fixed'; }
  const curtains = movers ? wireCurtains(ctx, movers) : [];
  // V19: room circuits — the switch's mover group carries the state (open = on); lights start on
  const circuits = (ctx.circuits || []).map(c => {
    const g = movers && movers.groups.get(c.id);
    const rec = { id: c.id, room: c.room, group: c.group, switch: c.switch, get on() { return c.on; },
      toggle: (on) => { if (g) return g.toggle(on); const want = on === undefined ? !c.on : !!on; apply(want); return Promise.resolve(); } };
    const apply = (on) => {
      c.on = on; c.group.visible = on;
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vrc:apt-light', { detail: { unitId: unit.id, room: c.room, on } })); } catch { /* no DOM */ }
    };
    if (g) { for (const mv of g.mvs) if (mv.proxy) { mv.proxy.userData.keepState = true; mv.proxy.userData.room = c.room; } g.listeners.push(apply); g.toggle(true, { instant: true }); }
    return rec;
  });
  const T2 = performance.now();
  const halos = cut ? null : bloomMesh(sg, m);
  bake(sg, baked);
  const T3 = performance.now();
  if (halos) baked.add(halos);
  ctx.tmpGeos.forEach(g => g.dispose());
  cg.updateMatrixWorld(true);
  root.add(cg);
  const lights = cut ? [Object.assign(new THREE.HemisphereLight(0xfff1e0, 0x9a8a74, 1.5), { name: 'apt-fill' })] : buildLights(ctx);
  lights.forEach(l => root.add(l));
  for (const l of lights) { const S = P.rooms.find(r => pointInPoly([l.position.x, l.position.z], r.poly)); if (S) l.userData.room = S.id; }   // V19: circuit
  const group = root;
  // interior doors rest open (opts.doors: 'closed' → shut until someone comes near)
  const doorsMode = opts.doors === 'closed' ? 'closed' : 'open';
  if (doorsMode === 'open') for (const d of idoors) d.toggle(true, { instant: true });
  // ---- rooms (unit coordinates)
  const r3 = x => +x.toFixed(3);
  const rooms = [], standPoints = [];
  const NV = rpNav(P, I, ctx.navFine ? 0.05 : 0.1, ctx.navFine === 'tight' ? NAV_TIGHT : 0.27), RS = rpReach0(ctx);
  const ent = P.doors.find(d => d.type === 'entrance') || null;
  for (const S of P.spaces) {
    const near = S.out ? (() => { const d = ctx.balconyDoors.find(q => q.rooms.includes(S.id)); return d ? add2(d.p, d.n, d.t / 2 + 0.75) : S.c; })() : S.c;
    // (among the floor a walker can reach from the entrance, where the room has any)
    const ci = P.spaces.indexOf(S), has = NV.cells[ci].some(k => RS.seen[k]);
    const ok = has ? (p) => { const i = Math.floor((p[0] - NV.u0) / NV.G), j = Math.floor((p[1] - NV.v0) / NV.G); return i >= 0 && j >= 0 && i < NV.nx && j < NV.nz && RS.seen[j * NV.nx + i] === 1; } : null;
    let stand = rpStand(ctx, S, S.out ? { near, pull: 0.6, cap: 0.5, ok, min: has ? 0.2 : 0.3 } : { ok, min: has ? 0.2 : 0.3 });
    if (has && !ok(stand)) {
      // (a room filled by its furniture: the reachable cell nearest to its centre)
      let bd = Infinity;
      for (const k of NV.cells[ci]) { if (!RS.seen[k]) continue; const i = k % NV.nx, j = (k - i) / NV.nx, q = [NV.u0 + (i + 0.5) * NV.G, NV.v0 + (j + 0.5) * NV.G], d = Math.hypot(q[0] - S.c[0], q[1] - S.c[1]); if (d < bd) { bd = d; stand = [r3(q[0]), r3(q[1])]; } }
    }
    const b = S.box;
    const rec = { id: S.id, kind: S.kind, name: S.name, nk: S.nk, key: 'walk.' + S.nk, area: S.area, level: 0, y: 0, center: stand, label: [r3(S.c[0]), r3(S.c[1])], stand,
      poly: S.poly.map(p => [r3(p[0]), r3(p[1])]), size: [+(b[2] - b[0]).toFixed(2), +(b[3] - b[1]).toFixed(2)] };
    if (S.out) { rec.outdoor = true; rec.glazed = S.glazed; rec.side = rpOutSide(unit, S); if (S.detached) rec.detached = true; }
    if (S.kitchen) rec.kitchen = true;
    rooms.push(rec);
    if (S.kind !== 'dressing' || S.area > 3) standPoints.push({ id: 'p-' + S.id, room: S.id, kind: S.kind, u: stand[0], v: stand[1], outdoor: !!S.out });
  }
  // ---- outdoor points: just outside the door of each outdoor space
  const outdoorPoints = [];
  for (const S of P.outdoor) {
    const r = rooms.find(q => q.id === S.id);
    outdoorPoints.push({ id: S.id, u: r.stand[0], v: r.stand[1], level: 0, side: r.side, kind: S.kind });
  }
  const mainOut = outdoorPoints.slice().sort((a, b) => (ctx.balconyDoors.some(d => d.rooms.includes(b.id) && typeof d.toggle === 'function') ? 1 : 0) - (ctx.balconyDoors.some(d => d.rooms.includes(a.id) && typeof d.toggle === 'function') ? 1 : 0))[0] || null;
  const balconyPoint = mainOut ? { u: mainOut.u, v: mainOut.v, level: 0, side: mainOut.side, id: mainOut.id } : null;
  const mainDoor = () => {
    if (!bdoors.length) return null;
    if (!balconyPoint) return bdoors[0];
    return bdoors.slice().sort((a, b) => Math.hypot(a.u - balconyPoint.u, a.v - balconyPoint.v) - Math.hypot(b.u - balconyPoint.u, b.v - balconyPoint.v))[0];
  };
  if (opts.startOnBalcony && bdoors.length) mainDoor()?.toggle(true, { instant: true });
  const tvs = cut ? [] : wireTvs(ctx, root);
  const sofaBed = rpWireSofaBed(ctx, sbCols, () => disposed);
  const fixtures = [];
  root.traverse(o => { if (o.userData.playPart) { o.userData.action = { type: 'aptDoor', unitId: unit.id, part: o.userData.playPart }; if (WATER_PIECES.has(o.userData.piece)) fixtures.push(o); } });
  // ---- curtains: closed until the visitor enters (as in the fitted-box builder)
  let seqTok = 0, autoDone = opts.curtains === 'open' || opts.curtains === 'closed';
  const openCurtains = (o = {}) => {
    autoDone = true;
    const tok = ++seqTok, gap = o.instant ? 0 : (o.stagger ?? 650);
    return Promise.all(curtains.map((c, i) => new Promise(res => {
      const go = () => { if (tok !== seqTok) return res(); c.toggle(true, { instant: !!o.instant }).then(res); };
      if (!gap || !i) go(); else setTimeout(go, gap * i);
    })));
  };
  const closeCurtains = (o = {}) => { ++seqTok; return Promise.all(curtains.map(c => c.toggle(false, o))); };
  if (opts.curtains === 'open') openCurtains({ instant: true });
  const onEnter = (e) => { const id = e && e.detail && e.detail.unitId; if (!id || id === unit.id) openCurtains(); };
  const hasWin = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (hasWin && curtains.length) window.addEventListener('vrc:apt-enter', onEnter);
  let disposed = false;
  const inside = (u, v) => P.rooms.some(S => u > S.box[0] && u < S.box[2] && v > S.box[1] && v < S.box[3] && pointInPoly([u, v], S.poly));
  if (movers) {
    // per frame (the camera that draws the flat): curtains open on the first frame from inside; a closed interior
    // door opens when the camera comes near and, in 'closed' mode, shuts again behind it
    const cp = new THREE.Vector3(), st = new Map();
    let last = 0;
    movers.onFrame((cam) => {
      if (!cam || disposed) return;
      const now = performance.now(); if (now - last < 120) return; last = now;
      cp.setFromMatrixPosition(cam.matrixWorld); root.worldToLocal(cp);
      if (cp.y < -0.3 || cp.y > CH + 0.3) return;
      if (!autoDone && curtains.length && inside(cp.x, cp.z)) { autoDone = true; setTimeout(() => { if (!disposed) openCurtains(); }, 500); }
      for (const d of idoors) {
        const dist = Math.hypot(cp.x - d.u, cp.z - d.v);
        let s = st.get(d); if (!s) st.set(d, s = { auto: false, far: 0, tapped: false });
        if (!d.open) { if (dist < 1.35 && !s.hold) { s.auto = true; s.far = 0; d.toggle(true); } else if (dist > 1.9) s.hold = false; }
        else if (doorsMode === 'closed' && s.auto) { if (dist > 2.6) { if (!s.far) s.far = now; else if (now - s.far > 2000) { s.auto = false; s.far = 0; d.toggle(false); } } else s.far = 0; }
      }
    });
    // a door the visitor shuts by a tap stays shut until they step back
    for (const d of idoors) for (const px of d.proxies || []) {
      const tg = px.userData.toggle;
      px.userData.toggle = (open) => { const s = st.get(d) || { }; st.set(d, s); const want = open === undefined ? !d.open : !!open; if (!want) s.hold = true; s.auto = false; return tg(open); };
      if (d.collider) d.collider.userData.toggle = px.userData.toggle;
    }
  }
  const disposeAll = () => {
    disposed = true; ++seqTok;
    if (hasWin) window.removeEventListener('vrc:apt-enter', onEnter);
    baked.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    ctx.colGeos.forEach(g => g.dispose());
    if (ctx.door) ctx.door.leaf.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (movers) movers.dispose();
  };
  // ---- camera presets
  const views = rpViews(ctx, rooms, balconyPoint);
  // ---- plan summary. The fitted-box fields (ul, ur, vc, vF, vb) keep a compatible meaning where one exists:
  //   vc = room face of the entrance wall at the door, ul = the entrance room's wall on the low-u side of the door at
  //   that face (walk.js hangs the door monitor between ul and the door), doorU = entrance u. W / D are the unit's
  //   fitted box; the real extent is `bbox` (rooms reach outside 0 … W / 0 … D).
  const du = ent ? ent.p[0] : (unit.door && unit.door.u) || 0, et = ent ? (+ent.t || 0.25) : 0.25;
  const eS = ent ? P.byId.get(ent.rooms[1]) : P.rooms[0];
  let ul = du - 1, ur = du + 1;
  if (eS) { const q = [du, et + 0.06]; if (pointInPoly(q, eS.poly)) { ul = du - rayPoly(q, [-1, 0], eS.poly); ur = du + rayPoly(q, [1, 0], eS.poly); } }
  const bb = P.bbox;
  const nWin = { front: 0, left: 0, right: 0, back: 0 };
  for (const w of ctx.wins) if (!w.S.out) { const k = rpSideOf(unit, w.mid, w.e.n); nWin[k]++; }
  const od0 = P.outdoor[0] || null;
  const plan = {
    real: true, mode: 'real', rot: 0, flip: false, duplex: false, levels: [], W: unit.width, D: unit.depth,
    ul: r3(ul), ur: r3(ur), vc: r3(et), vF: r3(bb.v1), vb: null, doorU: r3(du),
    entry: { wall: 'back', p: r3(du), t: r3(et) }, glaze: { left: nWin.left > 0, right: nWin.right > 0 },
    outdoor: od0 ? { kind: od0.kind, side: rooms.find(r => r.id === od0.id).side, depth: null } : null, windows: nWin,
    dropped: [], notes: ctx.notes.concat(P.warn), sofaBedSearch: ctx.sb ? ctx.sb.stats || [] : null, T: TYPES[unit.type] || null, bbox: { u0: r3(bb.u0), v0: r3(bb.v0), u1: r3(bb.u1), v1: r3(bb.v1) }, interior: I, canon: null,
  };
  const doors = ctx.doors.map(d => d);
  for (const d of doors) { Object.defineProperty(d, 'state', { enumerable: true, configurable: true, get() { return d.type === 'passage' ? 'none' : d.type === 'entrance' && !ctx.door ? 'none' : typeof d.toggle !== 'function' ? 'fixed' : d.open ? 'open' : 'closed'; },
    // 'open' / 'closed' (or true / false) operates the door through its own toggle; anything else is ignored
    set(v) { const want = v === 'open' || v === true ? true : v === 'closed' || v === false ? false : null; if (want !== null && typeof d.toggle === 'function' && want !== !!d.open) d.toggle(want); } }); }
  return {
    group, rooms, entrance: { u: r3(du), v: 0 }, balconyPoint, lights, plan, views, real: true,
    // unit-local bounding box of the whole flat incl. outdoor spaces, every door / passage, standing points
    bbox: plan.bbox, doors, standPoints, outdoorPoints, decks: P.decks.map(k => ({ id: k.id, door: k.door, space: k.space, poly: k.poly.map(q => [r3(q[0]), r3(q[1])]) })),
    sofaBed,
    // V7: what was fitted (tests, notes): hall wardrobes, the bed of every bedroom with its bridge unit and wardrobe,
    // the cabinets over the sofa-bed, the extras
    joinery: { hall: ctx.hallW || [], beds: ctx.beds || [], overSofa: ctx.overSofa || null, extras: ctx.extras || [], livingWardrobe: P.rooms.filter(r => r.kind === 'living' && r.has && r.has.wardrobe).map(r => r.id) },
    furniture: ctx.occ.filter(q => !q.wallOnly && !q.ghost).map(q => ({ tag: q.tag, room: q.room, c: [r3(q.c[0]), r3(q.c[1])], d: [r3(q.d[0]), r3(q.d[1])], hl: r3(q.hl), hw: r3(q.hw), h: q.h })),
    zones: ctx.zones.map(z => ({ kind: z.kind, id: z.id, c: [r3(z.c[0]), r3(z.c[1])], d: z.d, hl: r3(z.hl), hw: r3(z.hw), hinge: z.hinge || null, r: z.r || null, type: z.type || null, angle: z.angle ?? null, ld: z.ld || null, sw: z.sw || null, core: z.core ?? null })),
    stats: { meshes: baked.children.length + (ctx.door ? 2 : 0) + (movers ? movers.batches : 0), colliders: cg.children.length, fronts: movers ? movers.count : 0, windows: ctx.wins.length, windowIds: new Set(ctx.wins.map(w => w.op.win.id)).size,
      ms: { furnish: Math.round(T1 - T0), fronts: Math.round(T2 - T1), bake: Math.round(T3 - T2), beds: Math.round(ctx.msBeds || 0), sb: Math.round(ctx.msSb || 0), rules: Math.round(ctx.msRules || 0) } },
    doorLeaf: ctx.door ? ctx.door.leaf : null,
    cabinets: movers ? movers.proxies.filter(p => !p.userData.balconyDoor && !p.userData.curtain && !p.userData.interiorDoor && !p.userData.keepState) : [], closeCabinets: movers ? movers.closeAll : () => Promise.resolve(),
    balconyDoors: bdoors, interiorDoors: idoors,
    openBalconyDoor: () => { const d = mainDoor(); return d ? d.toggle(true) : Promise.resolve(); },
    openDoors: (o = {}) => Promise.all(idoors.map(d => d.toggle(true, o))), closeDoors: (o = {}) => Promise.all(idoors.map(d => d.toggle(false, o))),
    curtains, openCurtains, closeCurtains,
    get curtainsOpen() { return curtains.some(c => c.open); },
    speakers: ctx.speakers || [],
    tvs, setTvs: (on) => Promise.all(tvs.map(t => t.toggle(on))),
    laundry: ctx.laundry, island: ctx.island || null, snooker: null, game: null, fixtures,
    circuits, lamps: ctx.lamps || [], remote: ctx.remote || null,
    // V19: every tap target of the flat in one registry ({kind, name, piece, part, proxy, toggle, state}; interact.js)
    interactables: cut ? [] : collectInteractables(root, { extra: sofaBed && !sofaBed.fixed ? [{ kind: 'sofaBed', name: 'sofa-bed', piece: 'sofaBed', part: null, proxy: sofaBed.collider || sofaBed.bedCollider, toggle: (on) => sofaBed.toggle(on), state: () => !!sofaBed.open }] : [] }),
    closeBalconyDoors: () => Promise.all(bdoors.filter(d => d.open).map(d => d.toggle(false))),
    dispose: disposeAll,
  };
}
// The sofa-bed of a one-room flat → the record published as apt.sofaBed (null when the flat has none):
//   { room, open, state: 'closed' | 'open', toggle(open?, { instant, dur }) → Promise, set(t), t, dur,
//     closed {c, d, hl, hw} (the sofa), bed {c, d, hl, hw} (the floor the opened bed takes in front of it),
//     footprint (both), p (wall point), front, wb (mattress width), len (mattress length), collider, bedCollider,
//     keptBed / replacedBed / from }
// Both colliders carry userData.action = { type: 'sofaBed', unitId } (the walkthrough's tap target). The bed
// collider is solid only while the bed is open; every change fires window 'vrc:colliders-changed'
// ({ unitId, sofaBed: true, open, collider }). The default state is CLOSED (cutaway and 360° export see a sofa).
function rpWireSofaBed(ctx, cols, isDisposed) {
  const q = ctx.sofaBed; if (!q) return null;
  const { unit } = ctx, K = q.K, r3 = x => +x.toFixed(3);
  const rect = R => ({ c: [r3(R.c[0]), r3(R.c[1])], d: [r3(R.d[0]), r3(R.d[1])], hl: r3(R.hl), hw: r3(R.hw) });
  const full = { c: add2(q.p, q.f, (K.D + K.ext) / 2 + 0.012), d: q.xv, hl: K.L / 2, hw: (K.D + K.ext) / 2 };
  const rec = { room: q.S.id, open: false, t: 0, dur: K.dur, closed: rect(q.Rc || { c: q.pc, d: q.xv, hl: K.L / 2, hw: K.D / 2 }), bed: rect(q.Ro), footprint: rect(full),
    p: [r3(q.p[0]), r3(q.p[1])], front: [r3(q.f[0]), r3(q.f[1])], kind: K.kind, wb: K.bedW, len: K.bedLen, keptBed: q.keptBed, replacedBed: q.replacedBed, from: q.from,
    collider: cols ? cols.own : null, bedCollider: cols ? cols.ext : null, promise: null };
  Object.defineProperty(rec, 'state', { enumerable: true, get() { return rec.open ? 'open' : 'closed'; } });
  if (ctx.cut || !cols) { rec.toggle = () => Promise.resolve(); rec.set = () => {}; rec.fixed = true; rec.open = ctx.opts.sofaBed === 'open'; return rec; }
  const act = { type: 'sofaBed', unitId: unit.id };
  for (const c of [cols.own, cols.ext]) if (c) { c.userData.action = act; c.userData.sofaBed = true; c.userData.open = false; }
  const fire = () => { try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vrc:colliders-changed', { detail: { unitId: unit.id, sofaBed: true, open: rec.open, collider: cols.ext } })); } catch { /* no DOM */ } };
  const solid = (on) => { const c = cols.ext; if (c.userData.solid === on) return; c.userData.solid = on; c.raycast = on ? MESH_RAYCAST : NO_RAYCAST; fire(); };
  let tok = 0;
  rec.set = (t) => { rec.t = Math.max(0, Math.min(1, t)); K.set(rec.t); };
  rec.toggle = (open, o = {}) => {
    const want = open === undefined ? !rec.open : !!open;
    if (want === rec.open) return rec.promise || Promise.resolve();
    rec.open = want;
    for (const c of [cols.own, cols.ext]) if (c) c.userData.open = c.userData._open = want;
    const me = ++tok;
    // opening: the floor is taken at once (the walkthrough moves a visitor standing there aside); closing: it is free
    // again once the frame is back under the seat
    if (want) solid(true);
    if (o.instant || isDisposed()) { rec.set(want ? 1 : 0); if (!want) solid(false); rec.promise = null; return Promise.resolve(); }
    const from = rec.t, to = want ? 1 : 0, dur = (o.dur > 0 ? o.dur : K.dur) * Math.max(0.3, Math.abs(to - from)), t0 = performance.now();   // o.dur: ms for the whole travel (the walkthrough's slow self-folding)
    const p = rec.promise = new Promise(res => {
      const step = () => {
        if (me !== tok) return res();
        if (isDisposed()) return res();
        const k = Math.min(1, (performance.now() - t0) / dur);
        rec.set(from + (to - from) * k);
        if (k < 1) requestAnimationFrame(step); else { if (!want) solid(false); if (rec.promise === p) rec.promise = null; res(); }
      };
      step();
    });
    return p;
  };
  if (ctx.opts.sofaBed === 'open') rec.toggle(true, { instant: true });        // (dev / tests; the default is closed)
  return rec;
}
// which side of the fitted box an outdoor space lies on (walk.js looks out sideways from a 'left' / 'right' one)
function rpOutSide(unit, S) {
  const c = polyCentroid(S.poly), W = +unit.width || 0, D = +unit.depth || 0;
  const beyond = { front: c[1] - D, left: -c[0], right: c[0] - W, back: -c[1] };
  return Object.keys(beyond).reduce((s, k) => beyond[k] > beyond[s] ? k : s, 'front');
}
function rpViews(ctx, rooms, bp) {
  const { P } = ctx, E = 1.5, v = {};
  const bb = P.bbox, cu = (bb.u0 + bb.u1) / 2, cv = (bb.v0 + bb.v1) / 2, span = Math.max(bb.u1 - bb.u0, bb.v1 - bb.v0);
  // from a standing point towards the farthest corner of the room (the long view), a little down
  const look = (r, fov) => {
    let best = null, bd = -1;
    for (const p of r.poly) { const d = Math.hypot(p[0] - r.stand[0], p[1] - r.stand[1]); if (d > bd) { bd = d; best = p; } }
    return { pos: [r.stand[0], E, r.stand[1]], target: [best[0], 1.1, best[1]], fov };
  };
  const from = (r, tp, fov) => {
    // stand at the point of the room farthest from the target, look at it
    let best = r.stand, bd = -1;
    const S = P.byId.get(r.id), [u0, v0, u1, v1] = S.box;
    for (let a = v0 + 0.2; a < v1; a += 0.2) for (let b = u0 + 0.2; b < u1; b += 0.2) {
      const p = [b, a];
      if (!pointInPoly(p, S.poly) || polyDist(p, S.poly) < 0.3) continue;
      if (ctx.occ.some(q => { const rr = sub2(p, q.c); return Math.abs(dot2(rr, q.d)) < q.hl + 0.2 && Math.abs(cross2(q.d, rr)) < q.hw + 0.2; })) continue;
      // not behind an open door leaf
      if (ctx.zones.some(z => { if (z.kind !== 'swing') return false; const rr = sub2(p, z.c); return Math.abs(dot2(rr, z.d)) < z.hl + 0.35 && Math.abs(cross2(z.d, rr)) < z.hw + 0.35; })) continue;
      const d = Math.hypot(p[0] - tp[0], p[1] - tp[1]);
      if (!(d > bd && d < 5.5)) continue;
      // the target must be in sight: the line stays inside the room, clear of its walls
      let seen = true;
      for (let k = 1; k < 12 && seen; k++) { const q = [p[0] + (tp[0] - p[0]) * k / 12 * 0.85, p[1] + (tp[1] - p[1]) * k / 12 * 0.85]; if (!pointInPoly(q, S.poly) || polyDist(q, S.poly) < 0.12) seen = false; }
      if (seen) { bd = d; best = p; }
    }
    return { pos: [best[0], E, best[1]], target: [tp[0], 1.0, tp[1]], fov };
  };
  const liv = rooms.find(r => r.kind === 'living');
  if (liv) {
    const S = P.byId.get(liv.id), so = S.has && S.has.sofa;
    v.living = so ? from(liv, so.p, 68) : look(liv, 68);
    v.living2 = look(liv, 70);
  }
  const k = ctx.kitchens[0];
  if (k) { const r = rooms.find(q => q.id === k.S.id); v.kitchen = from(r, k.p, 70); }
  const bedR = rooms.filter(r => r.kind === 'bedroom').sort((a, b) => b.area - a.area)[0] || rooms.find(r => { const S = P.byId.get(r.id); return S.has && S.has.bed; });
  if (bedR) { const S = P.byId.get(bedR.id), b = S.has && S.has.bed; v.bedroom = b ? from(bedR, b.p, 72) : look(bedR, 72); }
  const bath = rooms.find(r => r.kind === 'bath');
  if (bath) v.bath = look(bath, 80);
  if (bp) {
    // along the balcony (towards its far end), turned outwards
    const r = rooms.find(q => q.id === bp.id), S = P.byId.get(bp.id), c = polyCentroid(r.poly);
    const e = S.edges.slice().sort((a, b) => b.len - a.len)[0], sgn = dot2(sub2(c, [bp.u, bp.v]), e.d) >= 0 ? 1 : -1;
    const out = [c[0] - cu, c[1] - cv], l = Math.hypot(out[0], out[1]) || 1;
    v.balcony = { pos: [bp.u, E, bp.v], target: [bp.u + e.d[0] * sgn * 3 + out[0] / l * 2.2, 1.25, bp.v + e.d[1] * sgn * 3 + out[1] / l * 2.2], fov: 78, outside: true };
  }
  const hall = rooms.find(r => r.kind === 'hall') || rooms[0];
  v.hall = look(hall, 75);
  v.top = { pos: [cu, 40, cv + 0.01], target: [cu, 0, cv], fov: Math.max(12, Math.min(34, span * 1.75)) };
  v.dollhouse = { pos: [cu + span * 0.75 + 1.5, span * 0.85 + 2, cv + span * 0.8 + 2.5], target: [cu, 0.3, cv], fov: 40 };
  return v;
}

// Public builders. A unit with a real interior is built from it; the fitted-box planner is the fallback.
function buildAny(unit, styleId, opts) {
  let I = null;
  if (!opts.box) { try { I = unit && (unit.interior !== false) ? interiorOf(unit) : null; } catch { I = null; } }
  if (I && I.rooms && I.rooms.length) {
    try { return buildReal(unit, styleId, opts, I); }
    catch (err) { try { console.warn('[apartment] real interior failed for ' + (unit && unit.id) + ' — fitted box used', err); } catch { /* no console */ } CUR_M = null; }
  }
  return build(unit, styleId, opts);
}
export function buildApartment(unit, styleId = 'milano', opts = {}) { return buildAny(unit, styleId, opts); }
export function buildApartmentCutaway(unit, styleId = 'milano', opts = {}) { return buildAny(unit, styleId, { ...opts, cutaway: true }); }
// Plan only (no geometry). Fitted-box plan: rooms, mode, windows (tests / tools of the fallback path).
export function planApartment(unit) { return planUnit(unit); }
// The geometry plan of a real interior (spaces with edges, wall intervals, openings, wall stretches) or null.
export function planInterior(unit) { const I = interiorOf(unit); if (!I) return null; const P = rpPlan(unit, I); if (!P.segsDone) { rpSegs(P); P.segsDone = true; } return P; }
export { STYLES } from './materials.js';
