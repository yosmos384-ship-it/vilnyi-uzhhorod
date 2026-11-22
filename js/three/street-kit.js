// ЖК VILNYI (Uzhhorod) — V28 street dressing kit: real CC0 street furniture (Poly Haven, CC0 1.0 — polyhaven.com/license)
// instanced over the whole streamed city: street lamps, litter bins, benches, fire hydrants, utility boxes, manhole covers.
// Files: assets/v28/street/*.glb (glTF-Transform: simplified, meshopt-compressed, WebP textures ≤ 512 px).
// One InstancedMesh per material part for the whole city (≈ 12 draw calls in all); city.js gives the placements per tile.
//
//   const kit = await loadStreetKit({ low });   kit.group → scene; kit.rebuild(items) with items = [{ k, x, y, z, yaw, s }]
//   kit.setNight(k 0..1) (lamp glass glow) · kit.dispose()
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// k → file, which top-level mesh to keep (some Poly Haven files hold two variants side by side), max instances
export const KIT = {
  lamp: { f: 'street_lamp_01', pick: null, max: 900 },
  bin: { f: 'metal_trash_can', pick: 'metal_trash_can_handle_left', max: 500 },
  bench: { f: 'painted_wooden_bench', pick: null, max: 300 },
  hydrant: { f: 'fire_hydrant', pick: 'fire_hydrant_aged', max: 300 },
  box1: { f: 'utility_box_01', pick: null, max: 200 },
  box2: { f: 'utility_box_02', pick: null, max: 200 },
  manhole: { f: 'water_manhole_cover', pick: null, max: 800 },
};
const BASE = new URL('../../assets/v28/street/', import.meta.url).href;

export async function loadStreetKit(opts = {}) {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const group = new THREE.Group(); group.name = 'v28-street-kit';
  const parts = {};            // k → [{ mesh: InstancedMesh, base: Matrix4 }]
  const glass = [];
  const disposables = [];
  await Promise.all(Object.entries(KIT).map(async ([k, d]) => {
    let gl;
    try { gl = await loader.loadAsync(BASE + d.f + '.glb'); } catch (e) { console.info('[street-kit] ' + d.f + ' not used', e && e.message); return; }
    gl.scene.updateMatrixWorld(true);
    let root = gl.scene;
    if (d.pick) { const n = gl.scene.getObjectByName(d.pick); if (n) root = n; }
    // centre the kept variant on x/z (the source files place variants side by side)
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
    const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
    const list = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(shift, o.matrixWorld));
      const m = o.material.clone();
      m.envMapIntensity = 1;
      if (/glass/i.test(m.name || '')) { m.emissive = new THREE.Color('#ffcf8a'); m.emissiveMap = m.map || null; m.emissiveIntensity = 0; glass.push(m); }
      const im = new THREE.InstancedMesh(g, m, d.max); im.count = 0; im.name = 'kit-' + k; im.frustumCulled = false;
      im.castShadow = k !== 'manhole'; im.receiveShadow = true; im.userData._gfxC = 1;      // gfx.js: flags already set
      group.add(im); list.push(im); disposables.push(g, m);
    });
    parts[k] = list;
    parts[k].h = box.max.y - box.min.y;
  }));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function rebuild(items) {
    const n = {}; for (const k in parts) n[k] = 0;
    for (const it of items) {
      const L = parts[it.k]; if (!L || n[it.k] >= KIT[it.k].max) continue;
      Q.setFromAxisAngle(UP, it.yaw || 0); P.set(it.x, it.y || 0, it.z); const s = it.s || 1; S.set(s, s, s);
      M4.compose(P, Q, S);
      for (const im of L) im.setMatrixAt(n[it.k], M4);
      n[it.k]++;
    }
    for (const k in parts) for (const im of parts[k]) { im.count = n[k]; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.frustumCulled = n[k] > 0; }
    return n;
  }
  function setNight(k) { for (const m of glass) m.emissiveIntensity = k * 3.2; }
  function dispose() { for (const d of disposables) d.dispose && d.dispose(); for (const k in parts) for (const im of parts[k]) im.dispose(); if (group.parent) group.parent.remove(group); }
  return { group, parts, rebuild, setNight, dispose, heightOf: k => (parts[k] && parts[k].h) || 1, ready: Object.keys(parts).length > 0 };
}
