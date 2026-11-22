// ЖК VILNYI — V30 realistic pedestrians: rigged MakeHuman CC0 characters (assets/v30/people/*.glb, built by
// src/people30/ in the private project: MakeHuman / MPFB2 CC0 bodies, skins, clothes, hair; one atlas + one mesh each).
// Every GLB is skinned to the SAME 17 bones as people-body.js (BONES), in the same rest pose (arms down, facing +z,
// left = +x), so the existing pose code (poseWalk / poseStatic / ragdoll, applyPose) drives them unchanged.
// makeRealFigure(T) returns the makeFigure() interface: { mesh, rig, T, K, tris, pose, apply(), dispose(), scale }.
//   const kit = await loadRealPeople({ low });  kit.figure(T) → figure | null (null = keep the procedural body)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BONES, newPose, applyPose } from './people-body.js';

const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
// id → gender, age band ('y' < 35, 'a' 35–58, 's' senior)
export const REAL_CHARS = {
  m1: ['m', 'y'], m2: ['m', 'y'], m6: ['m', 'y'], m3: ['m', 'a'], m4: ['m', 'a'], m5: ['m', 's'],
  f1: ['f', 'y'], f2: ['f', 'y'], f5: ['f', 'y'], f3: ['f', 'a'], f4: ['f', 's'],
};
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
let _kit = null;
/** Loads the character set once (low = phone set: *-lo.glb, 512 px atlases). Resolves to the kit (kit.ready false on failure). */
export function loadRealPeople({ low = false, pbr = true } = {}) {
  if (_kit) return _kit;
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const models = {};
  _kit = Promise.all(Object.keys(REAL_CHARS).map(async id => {
    try {
      const gl = await loader.loadAsync(BASE + id + (low ? '-lo' : '-hi') + '.glb');
      gl.scene.updateMatrixWorld(true);
      let sm = null; gl.scene.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
      if (!sm) return;
      // plain float geometry in world space (the GLBs are meshopt + quantized: normalized integer attributes)
      const geo = floatGeometry(sm.geometry, sm.matrixWorld);
      // joints of the rest pose (world) and the remap of skin indices to the BONES order
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
      const mat = pbr ? new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
      mat.name = 'v30-person-' + id; mat.envMapIntensity = 0.6;
      models[id] = { id, geo, mat, J, H, headY: J[BONES.indexOf('head')][1], tris: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3 };
      src.dispose?.();
    } catch (e) { console.info('[people-real] ' + id + ' not used', e && e.message); }
  })).then(() => {
    const ids = Object.keys(models);
    const pool = (g, a) => ids.filter(id => REAL_CHARS[id][0] === g && REAL_CHARS[id][1] === a);
    return {
      ready: ids.length > 0, models, low,
      /** A near-tier figure for traits T, or null (children, uniforms and couriers keep the procedural body). */
      figure(T) {
        if (!ids.length || (T.kid || 0) > 0.15 || (T.role && T.role !== 'civil' && T.role !== 'jogger')) return null;
        const g = T.gender === 'f' ? 'f' : 'm', a = T.ageYears < 35 ? 'y' : T.ageYears < 58 ? 'a' : 's';
        let L = pool(g, a); if (!L.length) L = pool(g, 'y'); if (!L.length) L = ids.filter(id => REAL_CHARS[id][0] === g); if (!L.length) L = ids;
        return makeRealFigure(models[L[Math.floor(H32(T.seed, 31) * L.length) % L.length]], T);
      },
      dispose() { for (const m of Object.values(models)) { m.geo.dispose(); m.mat.map?.dispose(); m.mat.dispose(); } _kit = null; },
    };
  }).catch(e => { console.info('[people-real] not used', e && e.message); return { ready: false, figure: () => null, dispose() {} }; });
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
