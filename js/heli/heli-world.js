// heli-world.js — V26 «Helicopter view»: what the city looks like from the air, on top of the OSM city of V8-city.
//   · ground: free satellite imagery (EOX Sentinel-2 cloudless 2016, CC BY 4.0) composited in the browser with the OSM roads,
//     rails and building footprints (crisp lines over the 10 m photo), the river cut out (city.js draws it), the plot's own
//     rectangle cut out (environment.js draws the site plan there);
//   · relief beyond the city (Terrain Tiles DEM) with the wider satellite picture — the Carpathian foothills on the horizon;
//   · trees: every tree of the city data (mapped + generated street / park / garden trees) as instanced crowns, + Bozdosh park;
//   · night: street-lamp glow points along the streets;
//   · heightAt(x, z): ground / building / landmark / tower height for the helicopter's collision and the autopilot.
// Nothing here is loaded before the visitor presses «Helicopter view».
import * as THREE from 'three';

const BASE = new URL('../../assets/heli/', import.meta.url).href;
const merc = {
  x: (lon, z) => (lon + 180) / 360 * Math.pow(2, z),
  y: (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); },
  lon: (x, z) => x / Math.pow(2, z) * 360 - 180,
  lat: (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, z)))) * 180 / Math.PI,
};
const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + src)); im.src = src; });
const idle = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 60 }) : setTimeout(r, 0)));
function inPoly(p, x, z) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
const hash = (x, z) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * createHeliWorld({ scene, renderer, CD, D, phone, meta }) → world
 * CD = city-data.js module (loaded), D = data.js module (llToWorld / worldToLL). Call world.build() (async, in steps).
 */
export function createHeliWorld({ scene, CD, D, phone = false }) {
  const group = new THREE.Group(); group.name = 'heli-world';
  scene.add(group);
  const own = [];
  const st = { meta: null, core: null, outer: null, trees: [], lamps: null, mode: 'day', ready: false, dem: null, demBase: 112 };
  const CITY = CD.CITY;
  const toW = (lat, lon) => D.llToWorld(lat, lon);
  const B = CITY.bounds;

  // ---------------------------------------------------------------- ground (satellite + OSM lines)
  async function buildCore() {
    const meta = st.meta, c = meta.core, z = c.z, n = c.n;
    const img = await loadImage(BASE + (phone ? 'sat-core-1k.webp' : 'sat-core.webp'));
    const S = phone ? 2048 : 4096, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, S, S);
    // a touch of contrast / saturation lift (Sentinel-2 at 10 m is soft and hazy)
    try { g.globalCompositeOperation = 'soft-light'; g.fillStyle = 'rgba(128,128,128,0.35)'; g.fillRect(0, 0, S, S); } catch (e) { /* old canvas */ }
    g.globalCompositeOperation = 'source-over';
    const px = (x, zz) => { const [la, lo] = D.worldToLL(x, zz); return [(merc.x(lo, z) - c.x0) / n * S, (merc.y(la, z) - c.y0) / n * S]; };
    const ppm = S / (n * 40075016.7 * Math.cos(48.615 * Math.PI / 180) / Math.pow(2, z));   // canvas px per metre
    const path = (pts, close) => { g.beginPath(); pts.forEach((p, i) => { const q = px(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); };
    await idle();
    // building footprints (beyond the 3D city's reach they are what reads as "city" from above)
    const ROOF = { house: '#8a5a48', apartments: '#7b7774', panel: '#8d8b86', oldtown: '#9a5f45', retail: '#8f9294', industrial: '#8a8c88', civic: '#8e7c6c', church: '#6b7a76', castle: '#8c5a44', station: '#7a7470', garage: '#77787a', shed: '#7d6f62', canopy: '#9a9c9e' };
    g.globalAlpha = 0.72; let k = 0;
    for (const b of CITY.buildings) { g.fillStyle = ROOF[b.kind] || '#857f78'; path(b.poly, true); g.fill(); if (++k % 1500 === 0) await idle(); }
    g.globalAlpha = 1;
    // roads: carriageways (darker asphalt), pedestrian streets (paving), rails
    g.lineCap = 'round'; g.lineJoin = 'round';
    const roads = CITY.roads.slice().sort((a, b) => (a.car ? 1 : 0) - (b.car ? 1 : 0));
    k = 0;
    for (const r of roads) {
      if (r.tunnel) continue; let col, w;
      if (r.car) { col = r.cls === 'service' ? '#6c6c6a' : '#4c4e52'; w = r.w; }
      else if (r.cls === 'pedestrian' || r.cls === 'living') { col = '#a7a196'; w = Math.max(3, r.w || 5); }
      else if (r.cls === 'footway' || r.cls === 'path') { col = '#b3aa98'; w = 2; }
      else continue;
      g.strokeStyle = col; g.globalAlpha = r.car ? 0.9 : 0.7; g.lineWidth = Math.max(1, w * ppm); path(r.pts, false); g.stroke();
      if (++k % 2500 === 0) await idle();
    }
    // centre lines of the big roads (a hint of markings from 100–200 m)
    g.globalAlpha = 0.55; g.strokeStyle = '#d9d6cc'; g.setLineDash([3 * ppm, 6 * ppm]);
    for (const r of CITY.roads) if (r.car && r.w >= 9 && !r.tunnel) { g.lineWidth = Math.max(0.6, 0.15 * ppm); path(r.pts, false); g.stroke(); }
    g.setLineDash([]); g.globalAlpha = 0.85; g.strokeStyle = '#3e3a36';
    for (const rl of CITY.rails || []) { g.lineWidth = Math.max(1, 3 * (rl.tracks || 1) * ppm); path(rl.pts, false); g.stroke(); }
    g.globalAlpha = 1;
    // holes: water (city.js draws the river with its embankments below ground level) and the plot rectangle (site plan)
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    const sm = CITY.seam; path([[sm.x0, sm.z0], [sm.x1, sm.z0], [sm.x1, sm.z1], [sm.x0, sm.z1]], true); g.fill();
    g.globalCompositeOperation = 'source-over';
    await idle();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    // mesh: a grid in Web-Mercator, every vertex placed with llToWorld (the world frame is rotated against north)
    const N = 64, pos = [], uv = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const la = merc.lat(c.y0 + n * j / N, z), lo = merc.lon(c.x0 + n * i / N, z), [x, zz] = toW(la, lo);
      pos.push(x, -0.04, zz); uv.push(i / N, j / N);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c2 = a + N + 1, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'heli-sat-core'; mesh.renderOrder = -2; group.add(mesh);
    own.push(tex, geo, mat); st.core = { mesh, mat, cv };
    // water: a reflective layer over the photo's river, shaped by the OSM water polygons (alpha map)
    { const W2 = S / 2, wc = document.createElement('canvas'); wc.width = wc.height = W2; const wg = wc.getContext('2d'); wg.fillStyle = '#000'; wg.fillRect(0, 0, W2, W2); wg.fillStyle = '#fff';
      const k2 = W2 / S; for (const a of CITY.areas) if (a.kind === 'water') { wg.beginPath(); a.poly.forEach((p, i) => { const q = px(p[0], p[1]); i ? wg.lineTo(q[0] * k2, q[1] * k2) : wg.moveTo(q[0] * k2, q[1] * k2); }); wg.closePath(); wg.fill(); }
      const at = new THREE.CanvasTexture(wc); at.flipY = false; at.anisotropy = 4;
      const wm = new THREE.MeshPhysicalMaterial({ color: '#203a3c', roughness: 0.07, metalness: 0, alphaMap: at, transparent: true, opacity: 0.88, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
      const w = new THREE.Mesh(geo, wm); w.name = 'heli-water'; w.renderOrder = -1; group.add(w); own.push(at, wm); st.water = w; }
    // core extent in world (for the outer terrain's hole and the relief ramp)
    st.coreLL = { s: merc.lat(c.y0 + n, z), n: merc.lat(c.y0, z), w: merc.lon(c.x0, z), e: merc.lon(c.x0 + n, z) };
  }

  async function buildOuter() {
    const meta = st.meta, o = meta.outer, z = o.z, n = o.n;
    let img = null; try { img = await loadImage(BASE + 'sat-outer.webp'); } catch (e) { console.warn('[heli] outer imagery', e); }
    let dem = null;
    try { const r = await fetch(BASE + 'dem-outer.u16'); if (r.ok) dem = new Uint16Array(await r.arrayBuffer()); } catch (e) { console.warn('[heli] dem', e); }
    const W = meta.dem.w, H = meta.dem.h;
    const demAt = (u, v) => { if (!dem) return st.demBase; const x = Math.max(0, Math.min(W - 1.001, u * (W - 1))), y = Math.max(0, Math.min(H - 1.001, v * (H - 1))), i = x | 0, j = y | 0, fx = x - i, fy = y - j;
      const a = dem[j * W + i], b = dem[j * W + i + 1], c = dem[(j + 1) * W + i], d = dem[(j + 1) * W + i + 1]; return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy; };
    { // base level = DEM at the plot
      const [la, lo] = D.worldToLL(0, 0); st.demBase = demAt((merc.x(lo, z) - o.x0) / n, (merc.y(la, z) - o.y0) / n); }
    st.dem = { demAt, o };
    const N = phone ? 96 : 160, pos = [], uv = [], idx = [];
    const cl = st.coreLL, cx0 = merc.x(cl.w, z), cx1 = merc.x(cl.e, z), cy0 = merc.y(cl.n, z), cy1 = merc.y(cl.s, z);
    const ramp = (X, Y) => {                                    // 0 inside the core square … 1 at 1.8 km outside it (tile units → metres)
      const m = 40075016.7 * Math.cos(48.615 * Math.PI / 180) / Math.pow(2, z);
      const dx = Math.max(cx0 - X, 0, X - cx1) * m, dy = Math.max(cy0 - Y, 0, Y - cy1) * m, d = Math.hypot(dx, dy) - 150;
      const t = Math.max(0, Math.min(1, d / 1800)); return t * t * (3 - 2 * t);
    };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const X = o.x0 + n * i / N, Y = o.y0 + n * j / N, la = merc.lat(Y, z), lo = merc.lon(X, z), [x, zz] = toW(la, lo);
      const h = Math.max(-1.5, (demAt(i / N, j / N) - st.demBase)) * ramp(X, Y) - 0.6;
      pos.push(x, h, zz); uv.push(i / N, j / N);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c2 = a + N + 1, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
    let tex = null; if (img) { tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4; tex.needsUpdate = true; own.push(tex); }
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: tex ? 0xffffff : 0x5b6b4a });
    // the core square is drawn by the city ground → discard the outer terrain there (no z-fighting at any distance)
    const U = { uCore: { value: new THREE.Vector4((cx0 - o.x0) / n, (cy0 - o.y0) / n, (cx1 - o.x0) / n, (cy1 - o.y0) / n) }, uSat: { value: 1 } };
    mat.onBeforeCompile = (sh) => { sh.uniforms.uCore = U.uCore; sh.uniforms.uSat = U.uSat;
      sh.fragmentShader = 'uniform vec4 uCore;\nuniform float uSat;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 q = vMapUv; if (q.x > uCore.x + 0.0004 && q.x < uCore.z - 0.0004 && q.y > uCore.y + 0.0004 && q.y < uCore.w - 0.0004) discard; }
        diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSat);`); };
    mat.customProgramCacheKey = () => 'heli-outer';
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'heli-terrain'; mesh.renderOrder = -3; group.add(mesh);
    own.push(geo, mat); st.outer = { mesh, mat, U };
  }

  // ---------------------------------------------------------------- trees (instanced crowns, 500 m chunks)
  async function buildTrees(BOZ) {
    const pts = [];                                           // [x, z, h, kind]
    let k = 0;
    for (const [key] of CD.cityTiles()) { const [ix, iz] = key.split(':').map(Number); const p = CD.tileProps(ix, iz); for (const t of p.trees) if (!phone || t[3] !== 2) pts.push(t); if (++k % 20 === 0) await idle(); }
    if (BOZ && BOZ.length > 2) {                              // Bozdosh park (no area in the city extract): crowns on a jittered 9 m grid
      const poly = BOZ.map(([la, lo]) => toW(la, lo)); let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      const sp = phone ? 12 : 9;
      for (let x = x0; x < x1; x += sp) for (let z = z0; z < z1; z += sp) { const h = hash(x * 3, z * 7), jx = x + (h - 0.5) * sp * 0.8, jz = z + (hash(z, x) - 0.5) * sp * 0.8;
        if (h < 0.18 || !inPoly(poly, jx, jz) || CD.inWater(jx, jz) || CD.buildingAt(jx, jz)) continue; const r = CD.roadAt(jx, jz, 6); if (r && r.on) continue; pts.push([jx, jz, 12 + h * 10, h < 0.3 ? 1 : 0]); }
    }
    const chunks = new Map(), CH = 500;
    for (const t of pts) { const key = Math.floor(t[0] / CH) + ':' + Math.floor(t[1] / CH); let a = chunks.get(key); if (!a) chunks.set(key, a = []); a.push(t); }
    const geoD = new THREE.IcosahedronGeometry(1, phone ? 0 : 1); geoD.translate(0, 0.15, 0);
    const geoC = new THREE.ConeGeometry(1, 2.2, phone ? 5 : 7, 1); geoC.translate(0, 0.6, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    own.push(geoD, geoC, mat);
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sv = new THREE.Vector3(), C = new THREE.Color();
    const GREENS = ['#3d5a2a', '#4a6a30', '#355226', '#56723a', '#2f4a25', '#5c6f34'];
    for (const [, list] of chunks) {
      for (const conifer of [false, true]) {
        const L = list.filter(t => (t[3] === 1) === conifer); if (!L.length) continue;
        const im = new THREE.InstancedMesh(conifer ? geoC : geoD, mat, L.length); im.name = 'heli-trees';
        L.forEach((t, i) => { const h = t[2] || 8, r = t[3] === 2 ? h * 0.42 : conifer ? h * 0.26 : h * 0.36, hs = hash(t[0], t[1]);
          P.set(t[0], conifer ? h * 0.25 : h - r * 0.9, t[1]); Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hs * 6.28); Sv.set(r * (0.9 + hs * 0.25), conifer ? h * 0.42 : r * 0.82, r * (1.1 - hs * 0.25));
          M4.compose(P, Q, Sv); im.setMatrixAt(i, M4); C.set(GREENS[(hs * GREENS.length) | 0]).multiplyScalar(0.85 + hash(t[1], t[0]) * 0.3); if (conifer) C.multiplyScalar(0.75); im.setColorAt(i, C); });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); group.add(im); st.trees.push(im);
      }
      await idle();
    }
    st.treeCount = pts.length;
  }

  // ---------------------------------------------------------------- night: street-lamp glow along the streets
  async function buildLamps() {
    const pos = [], col = [];
    let k = 0;
    for (const [key] of CD.cityTiles()) { const [ix, iz] = key.split(':').map(Number); const p = CD.tileProps(ix, iz);
      for (const l of p.lamps) { pos.push(l[0], 7.5, l[1]); const w = hash(l[0], l[1]) < 0.35; col.push(w ? 1 : 1, w ? 0.92 : 0.72, w ? 0.8 : 0.42); }
      if (++k % 40 === 0) await idle(); }
    for (let i = 0; i < CITY.lamps.length; i += 3) { pos.push(CITY.lamps[i], 7.5, CITY.lamps[i + 1]); col.push(1, 0.78, 0.5); }
    // the big streets get lamps every 32 m on both sides even where the data has none
    for (const r of CITY.roads) { if (!r.car || r.w < 9 || r.tunnel) continue; for (let s = 10; s < r.len; s += 32) { const q = CD.pointAt(r, s), off = r.w / 2 + 0.8;
      for (const sd of [1, -1]) { pos.push(q.x - q.dz * off * sd, 8, q.z + q.dx * off * sd); col.push(1, 0.8, 0.52); } } }
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeBoundingSphere();
    const mat = new THREE.PointsMaterial({ size: 26, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.9, fog: true });
    const pts = new THREE.Points(geo, mat); pts.name = 'heli-lamps'; pts.visible = false; pts.renderOrder = 5; group.add(pts);
    own.push(tex, geo, mat); st.lamps = { pts, mat, count: pos.length / 3 };
  }

  // ---------------------------------------------------------------- heights for collision / autopilot
  const extraBoxes = [];                                      // { x0, z0, x1, z1, h } (our towers, landmark models)
  function terrainY(x, z) {
    if (!st.dem || (x > B.x0 - 200 && x < B.x1 + 200 && z > B.z0 - 200 && z < B.z1 + 200)) return 0;
    const [la, lo] = D.worldToLL(x, z), o = st.dem.o, X = merc.x(lo, o.z), Y = merc.y(la, o.z);
    const cl = st.coreLL; if (!cl) return 0;
    const cx0 = merc.x(cl.w, o.z), cx1 = merc.x(cl.e, o.z), cy0 = merc.y(cl.n, o.z), cy1 = merc.y(cl.s, o.z), m = 40075016.7 * Math.cos(48.615 * Math.PI / 180) / Math.pow(2, o.z);
    const d = Math.hypot(Math.max(cx0 - X, 0, X - cx1) * m, Math.max(cy0 - Y, 0, Y - cy1) * m) - 150, t = Math.max(0, Math.min(1, d / 1800)), r = t * t * (3 - 2 * t);
    return Math.max(-1.5, st.dem.demAt((X - o.x0) / o.n, (Y - o.y0) / o.n) - st.demBase) * r;
  }
  /** Highest solid surface under (x, z) within radius r: ground, OSM building roofs, our towers, landmark models. */
  function heightAt(x, z, r = 0) {
    let h = terrainY(x, z);
    for (const b of CD.buildingsNear(x, z, r + 1)) { if (r > 0 ? polyNear(b.poly, x, z, r) : inPoly(b.poly, x, z)) h = Math.max(h, b.h + (b.roof === 'flat' ? 0.5 : 3)); }
    for (const e of extraBoxes) if (x > e.x0 - r && x < e.x1 + r && z > e.z0 - r && z < e.z1 + r) h = Math.max(h, e.h);
    return h;
  }
  function polyNear(p, x, z, r) {
    if (inPoly(p, x, z)) return true;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[j], b = p[i], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz || 1; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l; t = Math.max(0, Math.min(1, t)); if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < r) return true; }
    return false;
  }

  function setMode(m) {
    st.mode = m;
    const k = m === 'day' ? 1 : m === 'dusk' ? 0.55 : 0.2;
    if (st.core) st.core.mat.color.setRGB(k * (m === 'dusk' ? 1.04 : m === 'night' ? 0.82 : 1), k * (m === 'night' ? 0.88 : 1), k * (m === 'night' ? 1.15 : m === 'dusk' ? 0.95 : 1));
    if (st.outer) st.outer.U.uSat.value = m === 'day' ? 1 : 0.7;
    if (st.lamps) { st.lamps.pts.visible = m !== 'day'; st.lamps.mat.opacity = m === 'night' ? 0.95 : 0.7; }
  }

  return {
    group, st, heightAt, terrainY, extraBoxes, setMode,
    /** Loads and builds everything; onStep(label) is called between the steps (for the loading veil). */
    async build(onStep, BOZ) {
      const r = await fetch(BASE + 'sat.json'); st.meta = await r.json();
      onStep && onStep('ground'); await buildCore();
      onStep && onStep('terrain'); await buildOuter();
      setMode(st.mode); st.ready = true;
      return this;
    },
    /** Trees + lamps: after the first frame (they are not needed for the cut-scene on the road). */
    async buildLater(BOZ) { await buildTrees(BOZ); await buildLamps(); setMode(st.mode); },
    dispose() { for (const o of own) o.dispose && o.dispose(); for (const t of st.trees) t.dispose && t.dispose(); scene.remove(group); },
  };
}
