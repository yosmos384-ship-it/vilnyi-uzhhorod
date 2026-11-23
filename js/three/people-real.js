// ЖК VILNYI — V30 realistic pedestrians: rigged MakeHuman CC0 characters (assets/v30/people/*.glb, built by
// src/people30/ in the private project: MakeHuman / MPFB2 CC0 bodies, skins, clothes, hair; one atlas + one mesh each).
// Every GLB is skinned to the SAME 17 bones as people-body.js (BONES), in the same rest pose (arms down, facing +z,
// left = +x), so the existing pose code (poseWalk / poseStatic / ragdoll, applyPose) drives them unchanged.
// makeRealFigure(T) returns the makeFigure() interface: { mesh, rig, T, K, tris, pose, apply(), dispose(), scale }.
//   const kit = await loadRealPeople({ low });  kit.figure(T) → figure | null (null = keep the procedural body)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BONES, newPose, applyPose, LIMB_OF, LOW_OF, VS_HEAD } from './people-body.js';

const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
// id → gender, age band ('y' < 35, 'a' 35–58, 's' senior, 'k' child), role (V32: children, police, couriers, waiters, staff)
export const REAL_CHARS = {
  m1: ['m', 'y'], m2: ['m', 'y'], m6: ['m', 'y'], m3: ['m', 'a'], m4: ['m', 'a'], m5: ['m', 's'],
  f1: ['f', 'y'], f2: ['f', 'y'], f5: ['f', 'y'], f3: ['f', 'a'], f4: ['f', 's'],
  k1: ['m', 'k', 'kid'], k2: ['f', 'k', 'kid'], p1: ['m', 'a', 'police'], p2: ['f', 'y', 'police'], c1: ['m', 'y', 'courier'], w1: ['m', 'y', 'waiter'], s1: ['f', 'y', 'staff'],
};
const BASE_SET = ['m1', 'm2', 'm6', 'm3', 'm4', 'm5', 'f1', 'f2', 'f5', 'f3', 'f4'];      // V30: loaded with the kit
const ROLE_OF = (T) => (T.kid || 0) > 0.15 ? 'kid' : !T.role || T.role === 'civil' || T.role === 'jogger' ? 'civil' : ['police', 'courier', 'waiter', 'staff'].includes(T.role) ? T.role : null;
const BASE = new URL('../../assets/v30/people/', import.meta.url).href;
const H32 = (a, b = 0) => { let h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x7F4A7C15, 0xC2B2AE35); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return (h >>> 0) / 4294967296; };

/** Copy of a (possibly quantized) geometry with Float32 attributes, positions / normals transformed by matrix. */
export function floatGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) {
    const n = a.count, s = a.itemSize, keepInt = k === 'skinIndex', out = keepInt ? new Uint16Array(n * s) : new Float32Array(n * s), get = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < n; i++) for (let c = 0; c < s; c++) out[i * s + c] = a[get[c]](i);
    g.setAttribute(k, keepInt ? new THREE.Uint16BufferAttribute(out, s) : new THREE.BufferAttribute(out, s));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  if (matrix) { g.applyMatrix4(matrix); }
  return g;
}
/** A loaded GLB → model { id, geo (BONES skin order, feet on y 0), mat, J, H, headY, tris }. */
function parseModel(gl, id, mat) {
  gl.scene.updateMatrixWorld(true);
  let sm = null; gl.scene.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  if (!sm) return null;
  const geo = floatGeometry(sm.geometry, sm.matrixWorld);
  const J = BONES.map(() => [0, 0, 0]), remap = new Uint16Array(sm.skeleton.bones.length), P = new THREE.Vector3();
  sm.skeleton.bones.forEach((b, i) => { const k = BONES.indexOf(b.name); remap[i] = k < 0 ? 4 : k; if (k >= 0) { b.getWorldPosition(P); J[k] = [P.x, P.y, P.z]; } });
  const si = geo.attributes.skinIndex, out = new Uint16Array(si.count * 4);
  for (let i = 0; i < si.count * 4; i++) out[i] = remap[si.array[i]];
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out, 4));
  geo.computeBoundingBox(); const y0 = geo.boundingBox.min.y; geo.translate(0, -y0, 0); for (const j of J) j[1] -= y0;
  const H = geo.boundingBox.max.y - geo.boundingBox.min.y;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H / 2, 0), H * 0.75);
  const src = sm.material, map = src.map || null;
  if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
  const m = mat(map); m.name = 'v30-person-' + id; m.envMapIntensity = 0.6;
  src.dispose?.();
  return { id, geo, mat: m, J, H, headY: J[BONES.indexOf('head')][1], tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 };
}
// V32: the mid tier (13–34 m) — one InstancedMesh per character with the limbs swung in the vertex shader (the gait of the
// procedural mid tier, people-body.js VS_HEAD), on a ~1 k-triangle copy of the character (*-mid.glb, 256 px atlas).
function midModel(md) {
  const g = new THREE.BufferGeometry(), src = md.geo, n = src.attributes.position.count;
  g.setAttribute('position', src.attributes.position); g.setAttribute('normal', src.attributes.normal); if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
  if (src.index) g.setIndex(src.index);
  const si = src.attributes.skinIndex, sw = src.attributes.skinWeight, limb = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    // two strongest bones → limb segment (1 arm L, 2 arm R, 3 leg L, 4 leg R), its weight, how much is the lower part
    let b0 = 0, w0 = -1, b1 = 0, w1 = -1;
    for (let c = 0; c < 4; c++) { const b = si.array[i * 4 + c], w = sw.getComponent ? sw.getComponent(i, c) : sw.array[i * 4 + c]; if (w > w0) { b1 = b0; w1 = w0; b0 = b; w0 = w; } else if (w > w1) { b1 = b; w1 = w; } }
    const l0 = LIMB_OF[b0] || 0, l1 = w1 > 0.05 ? LIMB_OF[b1] || 0 : 0, t = w1 > 0.05 ? w1 / (w0 + w1) : 0;
    let seg = 0, lw = 0, low = 0;
    if (l0 && l1 && l0 === l1) { seg = l0; lw = 1; low = LOW_OF[b0] * (1 - t) + LOW_OF[b1] * t; } else if (l0) { seg = l0; lw = 1 - t; low = LOW_OF[b0] * (1 - t); } else if (l1) { seg = l1; lw = t; low = LOW_OF[b1] * t; }
    limb[i * 4] = seg; limb[i * 4 + 1] = lw; limb[i * 4 + 2] = low;
  }
  g.setAttribute('aLimb', new THREE.BufferAttribute(limb, 4));
  g.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute('aVar', new THREE.BufferAttribute(new Float32Array(n * 2).fill(-1), 2));
  const J = md.J, Y = (k) => J[BONES.indexOf(k)][1];
  const piv = [(Y('armL') + Y('armR')) / 2, (Y('foreL') + Y('foreR')) / 2, (Y('thighL') + Y('thighR')) / 2, (Y('shinL') + Y('shinR')) / 2];
  const legU = piv[2] - piv[3];
  const mat = new THREE.MeshLambertMaterial({ map: md.mat.map, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPal = { value: null }; sh.uniforms.uPiv = { value: new THREE.Vector4(...piv) }; sh.uniforms.uLegU = { value: legU };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VS_HEAD)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n pAngles(); objectNormal = pBend(objectNormal, 0.0);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = pBend(transformed, 1.0); transformed.y += pDy;');
  };
  mat.customProgramCacheKey = () => 'vrc-people-realmid';
  mat.name = 'v32-person-mid-' + md.id;
  return { id: md.id, geo: g, mat, headY: md.headY, tris: md.tris, H: md.H };
}
let _kit = null;
/** Loads the V30 character set once (low = phone set: *-lo.glb, 512 px atlases); the V32 role characters and the mid-tier
 *  copies load on first use (kit.figure / kit.midFor return null until then; kit.pending(T) says whether to ask again). */
export function loadRealPeople({ low = false, pbr = true } = {}) {
  if (_kit) return _kit;
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const models = {}, mids = {}, loading = new Map(), failed = new Set();
  const nearMat = (map) => pbr ? new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
  const fetchModel = (id, lod) => {
    const key = id + '-' + lod; if (loading.has(key)) return loading.get(key);
    const pr = loader.loadAsync(BASE + key + '.glb').then(gl => { const md = parseModel(gl, id, nearMat); if (!md) throw new Error('no skinned mesh');
      if (lod === 'mid') mids[id] = midModel(md); else models[id] = md; return md; })
      .catch(e => { failed.add(key); console.info('[people-real] ' + key + ' not used', e && e.message); return null; });
    loading.set(key, pr); return pr;
  };
  const near = low ? 'lo' : 'hi';
  const pool = (role, g, a) => { const all = Object.keys(REAL_CHARS).filter(id => (REAL_CHARS[id][2] || 'civil') === role);
    let L = all.filter(id => REAL_CHARS[id][0] === g && (!a || REAL_CHARS[id][1] === a)); if (!L.length) L = all.filter(id => REAL_CHARS[id][0] === g); if (!L.length) L = all; return L; };
  const choose = (T) => { const role = ROLE_OF(T); if (!role) return null;
    const g = T.gender === 'f' ? 'f' : 'm', a = role === 'civil' ? (T.ageYears < 35 ? 'y' : T.ageYears < 58 ? 'a' : 's') : null;
    let L = pool(role, g, a); if (role === 'civil' && !L.length) L = pool(role, g, 'y'); if (!L.length) return null;
    return L[Math.floor(H32(T.seed, 31) * L.length) % L.length]; };
  _kit = Promise.all(BASE_SET.map(id => fetchModel(id, near))).then(() => {
    const ids = Object.keys(models);
    return {
      ready: ids.length > 0, models, mids, low,
      /** A near-tier figure for traits T, or null (procedural body: concierge, a model not loaded yet or missing). */
      figure(T) {
        const id = choose(T); if (!id) return null;
        if (!models[id]) { if (!failed.has(id + '-' + near)) fetchModel(id, near); return null; }
        return makeRealFigure(models[id], T);
      },
      /** true while the real model for T is still loading (ask again later). */
      pending(T) { const id = choose(T); return !!id && !models[id] && !failed.has(id + '-' + near); },
      /** V32: the mid-tier model for traits T (instanced), or null (procedural mid tier). */
      midFor(T) { const id = choose(T); if (!id) return null; if (mids[id]) return mids[id]; if (!failed.has(id + '-mid')) fetchModel(id, 'mid'); return null; },
      midScale(md, T) { const headK = T.height - T.headH + 0.014; return Math.max(0.8, Math.min(1.2, headK / md.headY)); },
      dispose() { for (const m of Object.values(models)) { m.geo.dispose(); m.mat.map?.dispose(); m.mat.dispose(); } for (const m of Object.values(mids)) { m.geo.dispose(); m.mat.dispose(); } _kit = null; },
    };
  }).catch(e => { console.info('[people-real] not used', e && e.message); return { ready: false, figure: () => null, pending: () => false, midFor: () => null, dispose() {} }; });
  return _kit;
}

/** A figure on a loaded model, scaled so its head joint matches the procedural skeleton of T (the poses are built for it). */
export function makeRealFigure(md, T, K = null) {
  const bones = BONES.map(n => { const b = new THREE.Bone(); b.name = n; return b; });
  BONES.forEach((_, i) => { const p = PARENT[i], a = md.J[i], q = p < 0 ? [0, 0, 0] : md.J[p]; bones[i].position.set(a[0] - q[0], a[1] - q[1], a[2] - q[2]); if (p >= 0) bones[p].add(bones[i]); });
  bones[0].updateMatrixWorld(true);
  const rig = { bones, skeleton: new THREE.Skeleton(bones), K: { J: md.J }, hipY: md.J[0][1] };
  const mesh = new THREE.SkinnedMesh(md.geo, md.mat); mesh.name = 'vrc-person-real'; mesh.add(bones[0]); mesh.bind(rig.skeleton); mesh.frustumCulled = false;
  mesh.castShadow = true; mesh.receiveShadow = false;
  const headK = T.height - T.headH + 0.014;                 // people-body.js skeleton(): y.head = C + 0.014
  const scale = Math.max(0.8, Math.min(1.2, headK / md.headY));
  const pose = newPose();
  return { mesh, rig, T, K: rig.K, tris: md.tris, pose, scale, real: md.id,
    apply() { applyPose(rig, pose); },
    dispose() { rig.skeleton.dispose(); mesh.parent?.remove(mesh); } };
}
