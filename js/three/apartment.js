// ЖК VILNYI — procedural, fully furnished apartment interiors.
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
import { TYPES, GEOM, LEVELS } from '../data.js';
import { getMaterials, tickTv } from './materials.js';
import { F, FX } from './furniture.js';

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
    px.name = door ? 'balcony-door' : sp.curtain ? 'curtain-' + part : 'cabinet-front'; px.matrixAutoUpdate = false;
    px.userData.action = door ? { type: 'aptDoor', unitId: unit.id, part, door } : sp.curtain ? { type: 'aptDoor', unitId: unit.id, part, curtain: sp.group } : { type: 'aptDoor', unitId: unit.id, part };
    px.userData.cabinet = !door && !sp.curtain; px.userData.open = false;
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
        if (!mv.open || mv.spec.door || mv.spec.curtain) continue;
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
function wireBalconyDoors(ctx, movers) {
  const { unit } = ctx, out = [];
  const fire = (d) => {
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vrc:colliders-changed', { detail: { unitId: unit.id, door: d.id, open: d.open, collider: d.collider } })); } catch { /* no DOM */ }
  };
  for (const d of ctx.balconyDoors) {
    d.proxies = movers ? movers.proxies.filter(p => p.userData.balconyDoor === d.id) : [];
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
      cu.action = { type: 'aptDoor', unitId: unit.id, part: 'balconyDoor', door: d.id };
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
    if (ctx.door) ctx.door.leaf.geometry.dispose();
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

export function buildApartment(unit, styleId = 'milano', opts = {}) { return build(unit, styleId, opts); }
export function buildApartmentCutaway(unit, styleId = 'milano', opts = {}) { return build(unit, styleId, { ...opts, cutaway: true }); }
// Plan only (no geometry): rooms, mode, windows — cheap, for tests and tools.
export function planApartment(unit) { return planUnit(unit); }
export { STYLES } from './materials.js';
