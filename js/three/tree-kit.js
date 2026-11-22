// ЖК VILNYI (Uzhhorod) — V30 street trees: five tree models made for this site (src/trees30 in the private project) with
// CC0 leaf scans and bark (ambientCG LeafSet004 / 010 / 014 / 001 / 019, Bark014 / Bark012; Poly Haven bark_platanus).
// Alpha-tested leaf-cluster cards, wind sway in the vertex shader, three LODs per species (hi mesh, lo mesh, impostor =
// two crossed quads rendered from the hi tree), all instanced over the streamed city: ≤ 5 × 5 draw calls in all.
//   const kit = await loadTreeKit({ low, uTime });  kit.group → scene; kit.rebuild(trees, fx, fz) with trees = [[x, z, h, kind], …]
//   kit.setMode('day' | 'dusk' | 'night') · kit.dispose()
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { floatGeometry } from './people-real.js';

export const SPECIES = ['linden', 'maple', 'hornbeam', 'ornamental', 'spruce'];
const BASE = new URL('../../assets/v30/trees/', import.meta.url).href;
const hash = (a, b) => { let h = Math.imul((a | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x7F4A7C15, 0xC2B2AE35); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return (h >>> 0) / 4294967296; };
// late-autumn / evergreen tints of the leaves (instance colours; Uzhhorod in November keeps green, yellow and rust trees)
const TINT = [[1, 1, 1], [1, 1, 1], [0.92, 1.0, 0.82], [1.25, 1.08, 0.55], [1.35, 0.95, 0.5], [1.1, 1.05, 0.75]].map(c => new THREE.Color(...c));

function windify(mat, U, leaf) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aWind; uniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 ip = vec3(0.);
        #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
        #endif
        float ph = aWind.z * 6.283 + ip.x * .13 + ip.z * .11, fl = aWind.x * aWind.x;
        float s = sin(uTime * 1.1 + ph) * .7 + sin(uTime * 2.3 + ph * 1.7) * .3;
        transformed.x += fl * s * .22 * uWind; transformed.z += fl * cos(uTime * .9 + ph) * .12 * uWind;
        ${leaf ? 'transformed += normal * aWind.y * sin(uTime * 7. + ph * 9. + position.y * 2.) * .05 * uWind;' : ''} }`);
  };
  mat.customProgramCacheKey = () => 'v30-tree-' + (leaf ? 'l' : 'b');
}

export async function loadTreeKit(opts = {}) {
  const low = !!opts.low, U = { uTime: opts.uTime || { value: 0 }, uWind: { value: 1 } };
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); const tl = new THREE.TextureLoader();
  const group = new THREE.Group(); group.name = 'v30-trees';
  const sp = {}, disposables = [], leafMats = [];
  const CAP = low ? { hi: 0, lo: 260, imp: 900 } : { hi: 160, lo: 520, imp: 1600 };
  await Promise.all(SPECIES.map(async (name, si) => {
    let gl; try { gl = await loader.loadAsync(BASE + 'tree-' + name + (low ? '-lo' : '') + '.glb'); } catch (e) { console.info('[tree-kit] ' + name + ' not used', e && e.message); return; }
    const parts = { hi: [], lo: [] }; let H = 1;
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse(o => {
      if (!o.isMesh) return; const lod = /^hi/.test(o.name) ? 'hi' : 'lo', leaf = /leaf/.test(o.name);
      if (lod === 'hi' && low) return;
      const g = floatGeometry(o.geometry, o.matrixWorld);
      if (g.attributes.color) { const c = g.attributes.color, w = new Float32Array(c.count * 3); for (let i = 0; i < c.count; i++) { w[i * 3] = c.getX(i); w[i * 3 + 1] = c.getY(i); w[i * 3 + 2] = c.getZ(i); } g.setAttribute('aWind', new THREE.BufferAttribute(w, 3)); g.deleteAttribute('color'); }
      else g.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      g.computeBoundingBox(); H = Math.max(H, g.boundingBox.max.y);
      const src = o.material, map = src.map; if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
      const m = low ? new THREE.MeshLambertMaterial({ map, alphaTest: leaf ? 0.45 : 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide })
        : new THREE.MeshStandardMaterial({ map, roughness: leaf ? 0.7 : 0.95, metalness: 0, alphaTest: leaf ? 0.45 : 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide });
      m.name = 'v30-tree-' + name + (leaf ? '-leaf' : '-bark'); windify(m, U, leaf); if (leaf) leafMats.push(m);
      const im = new THREE.InstancedMesh(g, m, CAP[lod]); im.count = 0; im.frustumCulled = false; im.name = 'tree-' + name + '-' + lod + (leaf ? '-leaf' : '-bark');
      im.castShadow = true; im.receiveShadow = true; im.userData._gfxC = 1; if (leaf) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP[lod] * 3).fill(1), 3);
      group.add(im); parts[lod].push(im); disposables.push(g, m); src.dispose?.();
    });
    // impostor: two crossed quads with the front / side renders (assets/v30/trees/<name>-imp.webp, 2:1 atlas)
    let imp = null;
    try {
      const meta = await (await fetch(BASE + name + '-imp.json')).json();
      const tex = await tl.loadAsync(BASE + name + '-imp' + (low ? '-512' : '') + '.webp'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const S = meta.scale, g = new THREE.BufferGeometry(), p = [], uv = [], n = [], w = [], idx = [];
      for (let k = 0; k < 2; k++) { const b = p.length / 3, ax = k ? [0, 0, 1] : [1, 0, 0], nr = k ? [1, 0.9, 0] : [0, 0.9, 1];
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const s = (u - 0.5) * S; p.push(ax[0] * s * (k ? 1 : 1), v * S, ax[2] * s * (k ? -1 : 1)); uv.push(k * 0.5 + u * 0.5, v); n.push(...nr); w.push(v * 0.6, 0, 0); }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(w, 3)); g.setIndex(idx);
      const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }); m.name = 'v30-tree-' + name + '-imp'; windify(m, U, false); leafMats.push(m);
      imp = new THREE.InstancedMesh(g, m, CAP.imp); imp.count = 0; imp.frustumCulled = false; imp.name = 'tree-' + name + '-imp'; imp.castShadow = false; imp.receiveShadow = false; imp.userData._gfxC = 1;
      imp.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP.imp * 3).fill(1), 3);
      group.add(imp); disposables.push(g, m, tex); imp.userData.H = meta.H;
    } catch (e) { console.info('[tree-kit] impostor ' + name + ' not used', e && e.message); }
    sp[name] = { parts, imp, H: imp ? imp.userData.H : H };
  }));
  const ready = Object.keys(sp).length > 0;
  const R = low ? { hi: 0, lo: 70, imp: 300 } : { hi: 55, lo: 150, imp: 460 };
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const speciesOf = (x, z, kind) => kind === 1 ? 'spruce' : kind === 2 ? 'ornamental' : (h => h < 0.45 ? 'linden' : h < 0.7 ? 'maple' : 'hornbeam')(hash(x * 3, z * 7));
  let stats = { hi: 0, lo: 0, imp: 0 };
  function rebuild(trees, fx, fz) {
    const n = {}; for (const k in sp) n[k] = { hi: 0, lo: 0, imp: 0 };
    const R2 = { hi: R.hi * R.hi, lo: R.lo * R.lo, imp: R.imp * R.imp };
    for (const t of trees) {
      const [x, z, h, kind] = t, dx = x - fx, dz = z - fz, d2 = dx * dx + dz * dz; if (d2 > R2.imp) continue;
      let name = speciesOf(x, z, kind); if (!sp[name]) name = Object.keys(sp)[0]; const S0 = sp[name];
      const lod = d2 < R2.hi && S0.parts.hi.length ? 'hi' : d2 < R2.lo && S0.parts.lo.length ? 'lo' : 'imp';
      const list = lod === 'imp' ? (S0.imp ? [S0.imp] : []) : S0.parts[lod]; if (!list.length) continue;
      const i = n[name][lod]; if (i >= list[0].count + 1e9 || i >= (lod === 'imp' ? CAP.imp : CAP[lod])) continue;
      const hh = hash(x * 10, z * 10), sc = Math.max(0.5, Math.min(1.6, h / S0.H * (0.9 + 0.2 * hh)));
      Q.setFromAxisAngle(UP, lod === 'imp' ? 0 : hh * 6.283); P.set(x, 0, z); S.set(sc, sc, sc); M4.compose(P, Q, S);
      const tint = TINT[name === 'spruce' ? 0 : Math.floor(hash(x, z * 3) * TINT.length)];
      for (const im of list) { im.setMatrixAt(i, M4); if (im.instanceColor) im.setColorAt(i, tint); }
      n[name][lod]++;
    }
    stats = { hi: 0, lo: 0, imp: 0 };
    for (const k in sp) { const S0 = sp[k];
      for (const lod of ['hi', 'lo']) for (const im of S0.parts[lod]) { im.count = n[k][lod]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      if (S0.imp) { S0.imp.count = n[k].imp; S0.imp.instanceMatrix.needsUpdate = true; S0.imp.instanceColor.needsUpdate = true; }
      stats.hi += n[k].hi; stats.lo += n[k].lo; stats.imp += n[k].imp; }
    return stats;
  }
  function setMode(m) { for (const mt of leafMats) mt.color.setScalar(m === 'night' ? 0.55 : m === 'dusk' ? 0.75 : 1); U.uWind.value = m === 'night' ? 0.6 : 1; }
  function dispose() { for (const d of disposables) d.dispose && d.dispose(); for (const c of group.children) c.dispose && c.dispose(); group.parent?.remove(group); }
  return { group, ready, rebuild, setMode, dispose, get stats() { return stats; }, R };
}
