// ЖК VILNYI — V32 (v0.16): hand-built models of Uzhhorod's landmarks in the GT drive world and the helicopter view.
// Castle, Greek-Catholic cathedral, theatre on Teatralna square, philharmonic (former synagogue), White House (regional
// administration), university main building, pedestrian bridge, Petőfi square + the linden alley on набережна Незалежності.
// Built in Blender by our own code (src/landmarks31/ in the private project) on OpenStreetMap footprints (© OpenStreetMap
// contributors, ODbL); materials = CC0 ambientCG textures (assets/v31/landmarks/tex, CREDITS.txt). Each model replaces the
// procedural building(s) of the city at its footprint (city.js skips CITY.lmHide), the bridge's generated railings / piers
// (CITY.lmRoads) and adds the alley's lindens (tree-kit species 'linden').
//   const kit = await loadLandmarks({ low, pbr });  kit.group (add to the city group) · kit.update(x, z) · kit.setMode(m) · kit.dispose()
// LODs: '-lo' (one mesh, vertex colours, ~0.3–1.8 k tris) everywhere in range; '-hi' (PBR, shared CC0 textures) near the focus.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = new URL('../../assets/v31/landmarks/', import.meta.url).href;
// material name → texture set, tint from the GLB, roughness, metalness, uv scale already in the GLB
const SETS = { plaster: 1, brick: 1, stone: 1, granite: 1, roof: 1, metal: 1, concrete: 1, paving: 1, wood: 1 };
const MAT = {
  plaster_cream: 'plaster', plaster_ochre: 'plaster', plaster_mint: 'plaster', plaster_white: 'plaster', plaster_beige: 'plaster', plaster_grey: 'plaster',
  trim: 'plaster', terracotta: 'plaster', brick_yellow: 'brick', stone: 'stone', granite: 'granite', roof_tiles: 'roof', roof_metal: 'metal',
  copper: 'metal', gold: null, glass: null, steel_green: 'metal', concrete: 'concrete', paving: 'paving', bronze: 'metal', wood: 'wood', dark: null, lamp: null,
};

/** One kit per city instance (the drive world and the helicopter view each have their own; the files come from the HTTP cache). */
export function loadLandmarks({ low = false, pbr = !low } = {}) {
  return (async () => {
    const res = await fetch(BASE + 'landmarks.json'); if (!res.ok) throw new Error('landmarks.json ' + res.status);
    const M = await res.json();
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const tl = new THREE.TextureLoader(), px = low ? 256 : 512, tex = {};
    const T = (set, kind) => { const k = set + kind; if (tex[k] !== undefined) return tex[k];
      const t = tl.load(BASE + 'tex/' + set + '-' + kind + '-' + px + '.webp', undefined, undefined, () => { tex[k] = null; });
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = low ? 2 : 8; t.colorSpace = kind === 'd' ? THREE.SRGBColorSpace : THREE.NoColorSpace; return (tex[k] = t); };
    const mats = new Map(); let night = 0;
    const lit = [];                                     // glass + lamps: a warm glow at dusk / night
    function shared(src) {
      const name = (src && src.name || '').replace(/^lm_/, '');
      if (mats.has(name)) return mats.get(name);
      let m;
      if (name === 'vc') m = pbr ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
      else {
        const set = MAT[name], col = src.color ? src.color.clone() : new THREE.Color(0xcccccc);
        const o = { color: col };
        if (set) { o.map = T(set, 'd'); if (pbr && set !== 'metal') o.normalMap = T(set, 'n'); }
        if (pbr) m = new THREE.MeshStandardMaterial(Object.assign(o, { roughness: src.roughness ?? 0.85, metalness: src.metalness ?? 0 }));
        else m = new THREE.MeshLambertMaterial(o);
        if (name === 'glass' || name === 'lamp') { m.emissive = new THREE.Color(name === 'lamp' ? 0xffd49a : 0xffc070); m.emissiveIntensity = 0; lit.push(m); }
        if (pbr && name === 'glass') { m.roughness = 0.08; m.metalness = 0.2; m.envMapIntensity = 1.2; }
      }
      m.name = 'v31-lm-' + name; mats.set(name, m); return m;
    }
    const prep = (scene) => { scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; const nm = ms.map(shared); o.material = Array.isArray(o.material) ? nm : nm[0]; ms.forEach(x => x.dispose && x.dispose()); o.castShadow = true; o.receiveShadow = true; o.matrixAutoUpdate = false; o.updateMatrix(); } }); return scene; };
    const group = new THREE.Group(); group.name = 'vrc-landmarks';
    const items = Object.entries(M.items).map(([key, v]) => {
      const g = new THREE.Group(); g.name = 'lm-' + key; g.position.set(v.c[0], 0, v.c[1]); g.updateMatrix(); g.matrixAutoUpdate = false; group.add(g);
      return { key, ...v, file: { hi: v.hi, lo: v.lo }, g, lo: null, hi: null, loP: null, hiP: null, lod: -1 };
    });
    const load = (it, which) => {
      const k = which + 'P'; if (it[k]) return it[k];
      return (it[k] = loader.loadAsync(BASE + it.file[which]).then(gl => { if (disposed) return null; const s = prep(gl.scene); s.name = it.key + '-' + which; s.visible = false; it.g.add(s); it[which] = s; it.lod = -1; return s; })
        .catch(e => { console.info('[landmarks] ' + it.key + ' ' + which + ' not used', e && e.message); return null; }));
    };
    const HI = low ? 110 : 260, FAR = low ? 900 : 1500;
    let disposed = false;
    const kit = {
      ready: true, manifest: M, group, items,
      hide: new Set(items.flatMap(it => it.hide)), roads: new Set(items.flatMap(it => it.roads || [])), trees: M.trees || [],
      /** focus = the camera / car position (world x, z): picks each model's LOD, loads models on demand. */
      update(x, z) {
        if (disposed) return;
        for (const it of items) {
          const d = Math.max(0, Math.hypot(it.c[0] - x, it.c[1] - z) - it.r);
          let want = d < HI ? 1 : d < FAR ? 0 : -1;
          if (want === 1 && !it.hi) { load(it, 'hi'); want = it.lo ? 0 : -1; if (!it.lo) load(it, 'lo'); }
          if (want === 0 && !it.lo) { load(it, 'lo'); want = -1; }
          if (want !== it.lod) { if (it.hi) it.hi.visible = want === 1; if (it.lo) it.lo.visible = want === 0; it.lod = want; }
        }
      },
      setMode(m) { night = m === 'night' ? 1 : m === 'dusk' ? 0.7 : 0; for (const x of lit) x.emissiveIntensity = x.name.endsWith('lamp') ? night * 2.2 : night * 0.35; },
      stats() { let tris = 0, calls = 0; for (const it of items) for (const s of [it.hi, it.lo]) if (s && s.visible) s.traverse(o => { if (o.isMesh) { calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
        return { tris: Math.round(tris), calls, hi: items.filter(i => i.lod === 1).map(i => i.key), lo: items.filter(i => i.lod === 0).length }; },
      dispose() { disposed = true; group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); for (const m of mats.values()) m.dispose(); for (const t of Object.values(tex)) if (t) t.dispose(); group.parent?.remove(group); },
    };
    return kit;
  })().catch(e => { console.info('[landmarks] not used', e && e.message); return null; });
}
