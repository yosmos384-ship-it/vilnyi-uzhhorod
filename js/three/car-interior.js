// ЖК VILNYI (Ужгород) — V25 (v0.11): the detailed, realistic cabin of the car the visitor drives (driver's view).
// Loaded lazily by drive.js the first time the driver's view is used (nothing of it is downloaded before). It replaces the
// simple merged interior of car-models.js on THAT car only: a lofted dashboard with an instrument hood, a stitched lip and a
// trim band (walnut, brushed aluminium or carbon — the model's interior scheme), air vents, a floating centre screen behind
// glass, a digital instrument cluster, the climate panel, the centre console with an armrest, a decorative selector (two
// pedals — there is no gear to choose), the three-spoke wheel (stitched leather rim, switches, a fictional emblem, paddles)
// that turns with the steering, sculpted seats with quilted centre panels, door cards (armrest, pull handle, opener, speaker,
// switches, ambient light), sun visors, an overhead console, an alcantara headliner, the pedals and the mirror housing.
// Materials are physically based (normal / roughness / AO / albedo maps generated here, no files) and lit by the scene's sky
// (PMREM environment) with cabin-aware shading: analytic sun shadows of the roof, the doors and the cowl, cabin occlusion,
// the light of the instruments and the ambient strips at night. The windscreen gets reflections, a little dirt, sun glare and
// rain drops that the real wipers clear. No maker's names, logos or badges anywhere.
// API: attachCabin(car, { quality: 'high' | 'medium' | 'low', renderer }) → cabin
//   cabin.update(st) every frame (st: { dt, steerZ, night 0…1, sunWorld (THREE.Vector3 towards the sun), wipers, wipT,
//     camera }), cabin.drawCluster(state) (the same state object as car-models.js cockpit.draw), cabin.setActive(bool),
//   cabin.dispose(). The car's own dispose() disposes the cabin too.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cabinFrame, INTERIORS } from './car-models.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

// ======================================================================================= procedural textures
// Tileable value / cell noise on a w×w torus. Every material kind gets three maps: normal (tangent space), ORM (R = ambient
// occlusion, G = roughness, B = metalness — what three.js reads from aoMap / roughnessMap / metalnessMap) and albedo (sRGB).
function hashI(x, y, s) { let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, per, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), m = k => ((k % per) + per) % per;
  const a = hashI(m(xi), m(yi), s), b = hashI(m(xi + 1), m(yi), s), c = hashI(m(xi), m(yi + 1), s), d = hashI(m(xi + 1), m(yi + 1), s);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, per, s, oct = 4) { let a = 0, w = 0.5, f = 1; for (let o = 0; o < oct; o++) { a += w * vnoise(x * f, y * f, per * f, s + o * 17); w *= 0.5; f *= 2; } return a; }
function cell(x, y, per, s) {   // F1, F2 of a jittered grid (Worley), tileable
  const xi = Math.floor(x), yi = Math.floor(y); let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, mx = ((cx % per) + per) % per, my = ((cy % per) + per) % per;
    const px = cx + hashI(mx, my, s), py = cy + hashI(mx, my, s + 9), d = (px - x) ** 2 + (py - y) ** 2;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return [Math.sqrt(f1), Math.sqrt(f2)];
}
const TEX = new Map();
// height(u, v) in 0…1 (u, v in 0…1) + rough(u, v, h) + albedo(u, v, h) → [r, g, b] 0…1 (linear-ish, stored as sRGB)
function bake(key, N, { height, rough, albedo, ao = null, metal = 0, strength = 2 }) {
  if (TEX.has(key)) return TEX.get(key);
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = height((i + 0.5) / N, (j + 0.5) / N);
  const nrm = new Uint8Array(N * N * 4), orm = new Uint8Array(N * N * 4), alb = new Uint8Array(N * N * 4); let rSum = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = H[k], hx = H[j * N + ((i + 1) % N)] - H[j * N + ((i - 1 + N) % N)], hy = H[((j + 1) % N) * N + i] - H[((j - 1 + N) % N) * N + i];
    let nx = -hx * strength * N / 256, ny = -hy * strength * N / 256, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = k * 4, u = (i + 0.5) / N, v = (j + 0.5) / N;
    nrm[o] = (nx * 0.5 + 0.5) * 255; nrm[o + 1] = (ny * 0.5 + 0.5) * 255; nrm[o + 2] = (nz * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
    orm[o] = clamp(ao ? ao(u, v, h) : 1) * 255; orm[o + 1] = clamp(rough(u, v, h)) * 255; rSum += orm[o + 1] / 255; orm[o + 2] = clamp(typeof metal === 'function' ? metal(u, v, h) : metal) * 255; orm[o + 3] = 255;
    const c = albedo(u, v, h); alb[o] = clamp(c[0]) * 255; alb[o + 1] = clamp(c[1]) * 255; alb[o + 2] = clamp(c[2]) * 255; alb[o + 3] = 255;
  }
  const mk = (data, srgb) => { const t = new THREE.DataTexture(data, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  const out = { normal: mk(nrm, false), orm: mk(orm, false), albedo: mk(alb, true), meanRough: Math.max(0.05, rSum / (N * N)) };
  TEX.set(key, out); return out;
}
const G3 = g => [g, g, g];
const KINDS = {
  // full-grain leather: cell grain with deeper creases, a few long soft wrinkles
  leather: N => bake('leather' + N, N, { strength: 2.4,
    height: (u, v) => { const [a, b] = cell(u * 46, v * 46, 46, 3); const g = sstep(0.0, 0.35, b - a); const w = fbm(u * 3, v * 3, 3, 7, 3); return 0.65 * g + 0.35 * w; },
    rough: (u, v, h) => 0.42 + (1 - h) * 0.22, ao: (u, v, h) => 0.8 + h * 0.2, albedo: (u, v, h) => G3(0.86 + h * 0.14 + (fbm(u * 6, v * 6, 6, 11, 2) - 0.5) * 0.12) }),
  // quilted seat centre: diamond quilting sunk along stitched seams + perforation holes + the leather grain
  quilt: N => bake('quilt' + N, N, { strength: 3.2,
    height: (u, v) => { const a = (u + v) * 4, b = (u - v) * 4, da = Math.abs(a - Math.round(a)), db = Math.abs(b - Math.round(b)); const seam = Math.min(da, db);
      const pill = sstep(0.0, 0.16, seam); const px = u * 64, py = v * 64, hole = Math.hypot(px - Math.round(px), py - Math.round(py)) < 0.17 && seam > 0.08 ? 0.35 : 0; const [c1, c2] = cell(u * 46, v * 46, 46, 5); return pill * 0.8 + sstep(0, 0.3, c2 - c1) * 0.15 - hole; },
    rough: (u, v, h) => 0.45 + (1 - clamp(h)) * 0.3, ao: (u, v, h) => 0.62 + clamp(h) * 0.38, albedo: (u, v, h) => G3(0.84 + clamp(h) * 0.16) }),
  // soft-touch dashboard skin: fine dimpled grain
  soft: N => bake('soft' + N, N, { strength: 1.2,
    height: (u, v) => { const [a] = cell(u * 90, v * 90, 90, 13); return 1 - clamp(a * 1.4); }, rough: (u, v, h) => 0.62 + (1 - h) * 0.15, albedo: (u, v, h) => G3(0.92 + h * 0.08) }),
  // alcantara / suede: fibres — fine random height, very rough, a soft mottle
  suede: N => bake('suede' + N, N, { strength: 0.9,
    height: (u, v) => fbm(u * 64, v * 64, 64, 21, 2) * 0.7 + fbm(u * 8, v * 8, 8, 23, 2) * 0.3, rough: () => 0.95, albedo: (u, v, h) => G3(0.86 + h * 0.18) }),
  // carbon fibre: 2×2 twill of tows, glossy resin
  carbon: N => bake('carbon' + N, N, { strength: 1.6,
    height: (u, v) => { const n = 16, i = Math.floor(u * n), j = Math.floor(v * n), warp = ((i + j) % 4) < 2, f = warp ? (u * n) % 1 : (v * n) % 1; return Math.sin(f * Math.PI) * 0.8 + (warp ? 0.2 : 0); },
    rough: () => 0.32, albedo: (u, v) => { const n = 16, i = Math.floor(u * n), j = Math.floor(v * n), warp = ((i + j) % 4) < 2, f = warp ? (v * n * 6) % 1 : (u * n * 6) % 1; const k = (warp ? 0.2 : 0.11) + Math.sin(f * Math.PI) * 0.035; return [k, k, k * 1.05]; } }),
  // brushed aluminium: long straight streaks along u
  brushed: N => bake('brushed' + N, N, { strength: 0.8, metal: 1,
    height: (u, v) => fbm(u * 2, v * 220, 2, 31, 3) * 0.7 + vnoise(u * 4, v * 900, 4, 33) * 0.3, rough: (u, v, h) => 0.24 + h * 0.12, albedo: (u, v, h) => G3(0.8 + h * 0.18) }),
  // open-pore walnut under lacquer: growth rings across u, pores, figure
  wood: N => bake('wood' + N, N, { strength: 0.5,
    height: (u, v) => { const r = (u * 22 + fbm(u * 2, v * 2, 2, 41, 3) * 0.9) % 1; const pore = vnoise(u * 256, v * 16, 256, 43) > 0.8 ? -0.35 : 0; return sstep(0.3, 0.7, Math.abs(r - 0.5) * 2) * 0.4 + pore; },
    rough: () => 0.3, albedo: (u, v) => { const r = (u * 22 + fbm(u * 2, v * 2, 2, 41, 3) * 0.9) % 1, ring = Math.pow(Math.abs(r - 0.5) * 2, 4), f = fbm(u * 24, v * 3, 24, 45, 3), fig = fbm(u * 4, v * 8, 4, 47, 2); const k = 0.6 + ring * 0.09 + (f - 0.5) * 0.12 + (fig - 0.5) * 0.22; return [0.5 * k, 0.3 * k, 0.17 * k]; } }),
  // cut-pile carpet
  carpet: N => bake('carpet' + N, N, { strength: 2.2,
    height: (u, v) => vnoise(u * 160, v * 160, 160, 51) * 0.7 + fbm(u * 10, v * 10, 10, 53, 2) * 0.3, rough: () => 1, ao: (u, v, h) => 0.7 + h * 0.3, albedo: (u, v, h) => G3(0.75 + h * 0.3) }),
  // speaker grille: a hexagonal field of holes in a metal sheet
  grille: N => bake('grille' + N, N, { strength: 2, metal: (u, v, h) => (h > 0.5 ? 1 : 0),
    height: (u, v) => { const n = 24, y = v * n, row = Math.floor(y), x = u * n + (row % 2) * 0.5, d = Math.hypot(x - Math.floor(x) - 0.5, y - row - 0.5); return d < 0.3 ? 0 : 1; },
    rough: (u, v, h) => (h > 0.5 ? 0.35 : 0.9), ao: (u, v, h) => (h > 0.5 ? 1 : 0.2), albedo: (u, v, h) => (h > 0.5 ? G3(0.55) : G3(0.03)) }),
};

// ======================================================================================= materials
// The cabin's lighting terms, injected into MeshStandardMaterial (so the scene's lights, the sky environment, tone mapping
// and fog stay exactly as everywhere else — and no new light enters the scene: a new light would recompile every program).
function cabinUniforms() {
  return {
    uCarInv: { value: new THREE.Matrix4() }, uSunCar: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 },
    uRoof: { value: new THREE.Vector4(0.55, 1.2, -1, 0.3) }, uPano: { value: 0 }, uSide: { value: new THREE.Vector2(0.8, 0.9) },
    uCowl: { value: new THREE.Vector2(0.5, 0.9) }, uRear: { value: new THREE.Vector2(-1.8, 0.9) }, uFloor: { value: 0.25 },
    uFoot: { value: new THREE.Vector3(0.06, 0.85, 0) }, uGlowA: { value: new THREE.Vector3() }, uGlowB: { value: new THREE.Vector3() },
    uStrip: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uStripCol: { value: new THREE.Color('#ff9a4a') },
  };
}
const CABIN_VS_DECL = 'uniform mat4 uCarInv;\nvarying vec3 vCabP;\nvarying vec3 vCabN;\n';
const CABIN_FS_DECL = `uniform vec3 uSunCar; uniform float uNight; uniform vec4 uRoof; uniform float uPano; uniform vec2 uSide; uniform vec2 uCowl; uniform vec2 uRear;
uniform float uFloor; uniform vec3 uFoot; uniform vec3 uGlowA; uniform vec3 uGlowB; uniform vec4 uStrip[4]; uniform vec3 uStripCol;
varying vec3 vCabP; varying vec3 vCabN;
// sunlight that reaches a point of the cabin: blocked by the roof, the doors below the belt line, the cowl in front, the
// rear deck behind (soft edges = penumbra growing with the distance to the edge)
float cabSun(vec3 p, vec3 L) {
  float vis = smoothstep(-0.02, 0.06, L.y);
  if (L.y > 0.01) { float t = (uRoof.y - p.y) / L.y; if (t > 0.0) { vec3 h = p + L * t; float pen = 0.03 + t * 0.04;
    float inX = smoothstep(uRoof.x + pen, uRoof.x - pen, abs(h.x)), inZ = smoothstep(uRoof.z - pen, uRoof.z + pen, h.z) * smoothstep(uRoof.w + pen, uRoof.w - pen, h.z);
    vis *= 1.0 - inX * inZ * (1.0 - uPano * 0.55); } }
  if (abs(L.x) > 0.01) { float t = (sign(L.x) * uSide.x - p.x) / L.x; if (t > 0.0) { float y = p.y + L.y * t; vis *= smoothstep(uSide.y - 0.03 - t * 0.03, uSide.y + 0.03 + t * 0.03, y); } }
  if (L.z > 0.01) { float t = (uCowl.x - p.z) / L.z; if (t > 0.0) { float y = p.y + L.y * t; vis *= smoothstep(uCowl.y - 0.03, uCowl.y + 0.05, y); } }
  if (L.z < -0.01) { float t = (uRear.x - p.z) / L.z; if (t > 0.0) { float y = p.y + L.y * t; vis *= smoothstep(uRear.y - 0.03, uRear.y + 0.05, y); } }
  return vis;
}
// ambient occlusion of the cabin: the footwells under the dash, the floor, the corners at the roof
float cabAO(vec3 p, vec3 n) {
  float a = mix(0.62, 1.0, smoothstep(uFloor, uFloor + 0.42, p.y));
  float under = smoothstep(uFoot.x - 0.15, uFoot.x + 0.1, p.z) * (1.0 - smoothstep(uFoot.y - 0.42, uFoot.y - 0.08, p.y));
  a *= 1.0 - 0.32 * under;
  a *= mix(1.0, 0.82, smoothstep(uRoof.y - 0.18, uRoof.y, p.y));
  a *= 0.82 + 0.18 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  return a;
}
// light of the instruments, the screen and the ambient strips (it matters at night)
vec3 cabGlow(vec3 p, vec3 n) {
  vec3 g = vec3(0.0);
  vec3 d = uGlowA - p; float l2 = dot(d, d); g += vec3(1.0, 0.86, 0.66) * 0.07 / (l2 * 9.0 + 0.04) * max(0.25, dot(n, normalize(d)));
  d = uGlowB - p; l2 = dot(d, d); g += vec3(0.75, 0.85, 1.0) * 0.06 / (l2 * 9.0 + 0.04) * max(0.25, dot(n, normalize(d)));
  for (int i = 0; i < 4; i++) { vec3 e = uStrip[i].xyz - p; float q = dot(e, e); g += uStripCol * uStrip[i].w / (q * 22.0 + 0.05) * max(0.2, dot(n, normalize(e))); }
  return g * uNight;
}
`;
function cabinize(mat, U, key) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + CABIN_VS_DECL)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCabP = (uCarInv * modelMatrix * vec4(transformed, 1.0)).xyz; vCabN = normalize(mat3(uCarInv) * mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CABIN_FS_DECL)
      .replace('#include <lights_fragment_begin>', 'float cabSunK = cabSun(vCabP, normalize(uSunCar));\n' + THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cabSunK;'))
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float cao = cabAO(vCabP, normalize(vCabN)); reflectedLight.indirectDiffuse *= cao; reflectedLight.indirectSpecular *= cao * cao; reflectedLight.directDiffuse += diffuseColor.rgb * cabGlow(vCabP, normalize(vCabN)); }');
  };
  mat.customProgramCacheKey = () => 'vrc-cabin-' + key;
  return mat;
}

// trims of the four interior schemes of car-models.js INTERIORS: 0 cognac + walnut, 1 ivory + aluminium, 2 black + wood,
// 3 oxblood + carbon; thread colours for the stitching
const SCHEME = [
  { trim: 'wood', thread: '#e6d6b4', amb: '#ffae5c', wheel: '#1c1917' },
  { trim: 'brushed', thread: '#6b5a44', amb: '#9fd0ff', wheel: '#1d1b19' },
  { trim: 'wood', thread: '#c08a46', amb: '#ffb46a', wheel: '#161514' },
  { trim: 'carbon', thread: '#d9c7a4', amb: '#ff5a3c', wheel: '#1a1615' },
];
const QUALITY = {
  high: { tex: 512, texSmall: 256, wheel: [128, 16], seatSeg: 6, maps: true, rain: true, glare: true, bloom: true, stitches: true, clusterPx: 1024 },
  medium: { tex: 256, texSmall: 256, wheel: [80, 10], seatSeg: 4, maps: true, rain: true, glare: true, bloom: true, stitches: true, clusterPx: 768 },
  low: { tex: 0, texSmall: 0, wheel: [48, 8], seatSeg: 2, maps: false, rain: false, glare: false, bloom: false, stitches: false, clusterPx: 512 },
};
export const CABIN_QUALITIES = Object.keys(QUALITY);

// one standard PBR material: colour, roughness, metalness, optional generated maps (k = metres → texture repeats)
function pbr(U, { color, rough = 0.6, metal = 0, kind = null, N = 256, repeat = 4, env = 0.55, normalScale = 1, side = THREE.FrontSide, maps = true, clearcoat = 0, ao = true }) {
  const P = { color: new THREE.Color(color), roughness: rough, metalness: metal, envMapIntensity: env, side };
  const m = clearcoat ? new THREE.MeshPhysicalMaterial({ ...P, clearcoat, clearcoatRoughness: 0.06 }) : new THREE.MeshStandardMaterial(P);
  if (kind && maps && N) {
    const T = KINDS[kind](N), rep = t => { const c = t.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = true; return c; };
    m.normalMap = rep(T.normal); m.normalScale.set(normalScale, normalScale);
    m.roughnessMap = rep(T.orm); m.roughness = 1;                       // the map holds the roughness (G); the factor multiplies it
    if (metal > 0) { m.metalnessMap = m.roughnessMap; m.metalness = 1; }
    if (ao) m.aoMap = m.roughnessMap;
    m.map = rep(T.albedo);
    m.roughness = Math.min(2, rough / T.meanRough);                   // the factor scales the map: the material keeps its own level
  }
  return cabinize(m, U, 'std');
}
function materials(U, ic, sc, Q) {
  const N = Q.tex, n2 = Q.texSmall, maps = Q.maps;
  const trim = sc.trim === 'wood' ? { color: '#ffffff', rough: 0.3, kind: 'wood', repeat: 1.6, clearcoat: 1, env: 0.8 }
    : sc.trim === 'carbon' ? { color: '#ffffff', rough: 0.3, kind: 'carbon', repeat: 12, clearcoat: 1, env: 0.9 }
      : { color: '#c9ccd0', rough: 0.3, metal: 1, kind: 'brushed', repeat: 3, env: 1.0 };
  const M = {
    leather: pbr(U, { color: ic.leather, rough: 0.44, kind: 'leather', N, repeat: 16, normalScale: 0.75, maps, env: 1.0 }),
    quilt: pbr(U, { color: ic.leather, rough: 0.46, kind: 'quilt', N, repeat: 2.6, normalScale: 1.6, maps, env: 1.0 }),
    dark: pbr(U, { color: lighten(ic.dark, 0.035), rough: 0.68, kind: 'soft', N: n2, repeat: 8, normalScale: 0.6, maps, env: 0.8 }),
    darkLeather: pbr(U, { color: lighten(ic.dark, 0.05), rough: 0.55, kind: 'leather', N, repeat: 16, normalScale: 0.55, maps, env: 0.85 }),
    wheel: pbr(U, { color: sc.wheel, rough: 0.5, kind: 'leather', N, repeat: 22, normalScale: 0.7, maps, env: 0.85 }),
    suede: pbr(U, { color: '#3d3b38', rough: 0.95, kind: 'suede', N: n2, repeat: 6, normalScale: 0.5, maps, env: 0.6, side: THREE.DoubleSide }),
    trim: pbr(U, { ...trim, N: Math.max(N, n2), maps }),
    metal: pbr(U, { color: '#d4d6da', rough: 0.22, metal: 1, kind: 'brushed', N: n2, repeat: 8, normalScale: 0.4, maps, env: 1.1 }),
    chrome: pbr(U, { color: '#e8e9ec', rough: 0.07, metal: 1, env: 1.25, maps: false }),
    piano: pbr(U, { color: '#060607', rough: 0.12, metal: 0, env: 0.55, maps: false, clearcoat: Q.maps ? 1 : 0 }),
    plastic: pbr(U, { color: '#1a1a1a', rough: 0.8, kind: 'soft', N: n2, repeat: 9, normalScale: 0.5, maps, env: 0.7 }),
    rubber: pbr(U, { color: '#0b0b0b', rough: 0.9, maps: false, env: 0.2 }),
    carpet: pbr(U, { color: '#262422', rough: 1, kind: 'carpet', N: n2, repeat: 10, normalScale: 1, maps, env: 0.5 }),
    grille: pbr(U, { color: '#3a3b3e', rough: 0.4, metal: 0.6, kind: 'grille', N: n2, repeat: 14, normalScale: 1, maps, env: 0.6 }),
    thread: pbr(U, { color: sc.thread, rough: 0.75, maps: false, env: 0.3 }),
    amb: new THREE.MeshBasicMaterial({ color: new THREE.Color(sc.amb), toneMapped: true }),
    lens: new THREE.MeshBasicMaterial({ color: '#2a2a2a', toneMapped: true }),
  };
  M.amb.userData.base = new THREE.Color(sc.amb);
  return M;
}
function lighten(hex, k) { const c = new THREE.Color(hex); c.r += k; c.g += k; c.b += k; return '#' + c.getHexString(); }

// ======================================================================================= geometry helpers
// box-projected UVs in metres (a texture repeat k per metre is set on the material)
function uvBox(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ax >= ay && ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else if (ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else { uv[i * 2] = x; uv[i * 2 + 1] = y; } }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
function prep(g) { if (g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); if (!g.attributes.uv) uvBox(g); return g; }
const RB = (w, h, d, r, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.05, h / 2.05, d / 2.05));
// bins of geometry per material; at the end one mesh per material
function Bins() {
  const b = {};
  return { add(mat, g, { uv = 'box' } = {}) { g = prep(g); if (uv === 'box') uvBox(g); (b[mat] || (b[mat] = [])).push(g); return g; }, get: b };
}
// a surface from a grid of points P[i][j] = [x, y, z] (i across, j along); normals toward `inside` (a point) when given
function gridSurface(P, { closeI = false, flipTo = null, uvScale = 1 } = {}) {
  const ni = P.length, nj = P[0].length, pos = [], uv = [], idx = [];
  const len = []; for (let i = 0; i < ni; i++) { let s = 0; len.push([0]); for (let j = 1; j < nj; j++) { s += Math.hypot(P[i][j][0] - P[i][j - 1][0], P[i][j][1] - P[i][j - 1][1], P[i][j][2] - P[i][j - 1][2]); len[i].push(s); } }
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) { pos.push(...P[i][j]); uv.push(P[i][j][0] * uvScale, len[i][j] * uvScale); }
  const I = closeI ? ni : ni - 1;
  for (let i = 0; i < I; i++) for (let j = 0; j < nj - 1; j++) { const a = i * nj + j, b = ((i + 1) % ni) * nj + j; idx.push(a, b, b + 1, a, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  if (flipTo) { const n = g.attributes.normal, p = g.attributes.position; let d = 0; for (let k = 0; k < n.count; k++) d += n.getX(k) * (flipTo[0] - p.getX(k)) + n.getY(k) * (flipTo[1] - p.getY(k)) + n.getZ(k) * (flipTo[2] - p.getZ(k)); if (d < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); } }
  return g;
}
// Catmull–Rom through 2-D points [[a, b], …], n samples
function spline(pts, n) {
  const out = [];
  for (let k = 0; k <= n; k++) { const t = k / n * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(t)), f = t - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * f + (2 * a - 5 * b + 4 * c2 - d) * f * f + (-a + 3 * b - 3 * c2 + d) * f * f * f);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]); }
  return out;
}
// a tube along a 3-D polyline (stitch threads, piping, handles, the wheel rim when r varies) — r(t) radius, rd(t) depth radius
function tube(path, r, { seg = 6, closed = false, rd = null, up = [0, 1, 0] } = {}) {
  const n = path.length, P = [];
  for (let i = 0; i < n; i++) {
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const T = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); let Nn = new THREE.Vector3(...up).cross(T); if (Nn.lengthSq() < 1e-6) Nn = new THREE.Vector3(1, 0, 0).cross(T); Nn.normalize(); const Bn = T.clone().cross(Nn).normalize();
    const t = i / (n - 1), rr = typeof r === 'function' ? r(t, i) : r, dd = rd ? (typeof rd === 'function' ? rd(t, i) : rd) : rr, ring = [];
    for (let k = 0; k <= seg; k++) { const q = k / seg * TAU, c = Math.cos(q), s = Math.sin(q); ring.push([path[i][0] + Nn.x * c * rr + Bn.x * s * dd, path[i][1] + Nn.y * c * rr + Bn.y * s * dd, path[i][2] + Nn.z * c * rr + Bn.z * s * dd]); }
    P.push(ring);
  }
  if (closed) P.push(P[0]);
  return gridSurface(P, { uvScale: 1 });
}
// a dashed thread (stitches) along a polyline: little flat capsules 5 mm long every 9 mm, lying on the surface
function stitches(path, { len = 0.0055, gap = 0.0035, w = 0.0012, lift = 0.0012, normalAt = null } = {}) {
  const parts = []; let acc = 0, on = true;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = new THREE.Vector3(...path[i]), b = new THREE.Vector3(...path[i + 1]), d = b.clone().sub(a), L = d.length(); if (L < 1e-5) continue; d.divideScalar(L);
    let s = 0;
    while (s < L) { const step = Math.min(L - s, (on ? len : gap) - acc); if (on && step > 1e-4) { const p0 = a.clone().addScaledVector(d, s), p1 = a.clone().addScaledVector(d, s + step), nn = normalAt ? normalAt(p0) : new THREE.Vector3(0, 1, 0);
        const side = d.clone().cross(nn).normalize().multiplyScalar(w), lf = nn.clone().multiplyScalar(lift), q = [p0.clone().add(side).add(lf), p0.clone().sub(side).add(lf), p1.clone().sub(side).add(lf), p1.clone().add(side).add(lf)];
        parts.push(...q[0].toArray(), ...q[1].toArray(), ...q[2].toArray(), ...q[0].toArray(), ...q[2].toArray(), ...q[3].toArray()); }
      s += step; acc += step; if (acc >= (on ? len : gap) - 1e-6) { acc = 0; on = !on; } }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3)); g.computeVertexNormals(); return g;
}

// ======================================================================================= the cabin
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
function placed(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) { _m4.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')).setPosition(x, y, z); g.applyMatrix4(_m4); return g; }
const lin = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));

export function attachCabin(car, { quality = 'medium', renderer = null } = {}) {
  if (car.cabin) return car.cabin;
  const Q = QUALITY[quality] || QUALITY.medium;
  const icIndex = car.interiorIndex ?? 0;
  const F = cabinFrame(car.kind, icIndex), S = F.S, sh = F.shell, G = S.gh, ic = F.ic, sc = SCHEME[F.icIndex % SCHEME.length];
  const U = cabinUniforms(), M = materials(U, ic, sc, Q);
  const main = Bins(), door = Bins(), wheelB = Bins(), steerB = Bins();
  const dx = S.driverX, fw = sh.fw, dRear = sh.dRear, dh = sh.dh, yb = sh.yb, two = sh.two;
  const head = new THREE.Vector3(...F.head);
  const hinge = F.door ? F.door.hinge : null, inDoor = z => F.door && z > F.door.z0 && z < F.door.z1;
  const bin = (sg, z) => (sg > 0 && hinge && inDoor(z) ? door : main);
  const toDoor = g => { if (hinge) g.translate(-hinge[0], 0, -hinge[2]); return g; };
  const roofY = S.dlo.open ? null : S.H - 0.055;
  const own = [];          // textures / materials of canvases, disposed with the cabin

  // ---------------------------------------------------------------- shell: door cards, floor, bulkhead (car-models.js)
  const SM = { leather: 'leather', dark: 'dark', accent: 'trim', carpet: 'carpet' };
  for (const [k, g] of Object.entries(sh.main || {})) if (g) main.add(SM[k] || 'dark', g.clone());
  for (const [k, g] of Object.entries(sh.door || {})) if (g) door.add(SM[k] || 'dark', g.clone());
  if (F.headliner) main.add('suede', F.headliner.clone());

  // ---------------------------------------------------------------- dashboard: a lofted skin across the cabin
  const prof = x => {
    const zf = sh.zf(x);
    return [[zf - 0.004, dh - 0.003], [lerp(zf, dRear, 0.5), dh + 0.009], [dRear + 0.04, dh + 0.005], [dRear + 0.006, dh - 0.016], [dRear - 0.004, dh - 0.05],
      [dRear - 0.002, dh - 0.1], [dRear + 0.006, dh - 0.145], [dRear + 0.05, dh - 0.24], [dRear + 0.13, dh - 0.34], [dRear + 0.22, dh - 0.41]];
  };
  const NJ = Q.maps ? 54 : 30, xs = lin(-fw + 0.012, fw - 0.012, Q.maps ? 64 : 34), JL = Math.round(NJ * 3 / 9), JF = Math.round(NJ * 5 / 9), JT = Math.round(NJ * 6 / 9);
  const prow = xs.map(x => spline(prof(x), NJ).map(([z, y]) => [x, y, z]));
  const sub = (j0, j1) => prow.map(r => r.slice(j0, j1 + 1));
  const inside = [dx, dh + 0.3, dRear - 0.6];
  main.add('dark', gridSurface(sub(0, JL), { flipTo: inside }), { uv: 'keep' });
  main.add('leather', gridSurface(sub(JL, JF), { flipTo: inside }), { uv: 'keep' });
  main.add('dark', gridSurface(sub(JF, NJ), { flipTo: inside }), { uv: 'keep' });
  if (Q.stitches) for (const j of [JL + 1, JF - 1]) main.add('thread', stitches(prow.map(r => [r[j][0], r[j][1], r[j][2] - 0.0012]), { normalAt: () => new THREE.Vector3(0, 0.3, -1).normalize() }), { uv: 'box' });
  // trim band across the face (walnut / aluminium / carbon), with a chrome pinstripe under it and the ambient strip
  { const band = prow.map(r => { const a = r[JT - 1], b = r[JT + 2]; return [[a[0], a[1], a[2] - 0.007], [b[0], b[1], b[2] - 0.007]]; });
    main.add('trim', gridSurface(band, { flipTo: inside, uvScale: 1 }), { uv: 'keep' });
    main.add('chrome', tube(prow.map(r => [r[JT + 3][0], r[JT + 3][1], r[JT + 3][2] - 0.008]), 0.0018, { seg: 4 }));
    main.add('amb', tube(prow.filter((r, i) => i % 2 === 0).map(r => [r[JT + 4][0], r[JT + 4][1] - 0.004, r[JT + 4][2] - 0.006]), 0.0013, { seg: 3 })); }
  // a panel at `pos` turned to face `target` (car frame): its +z looks at the target, it stays upright
  const faceM = (pos, target) => new THREE.Matrix4().lookAt(target, pos, new THREE.Vector3(0, 1, 0)).setPosition(pos);
  // ---------------------------------------------------------------- the instrument binnacle: a stitched leather cowl over the cluster
  const clu = { x: dx, y: dh + 0.074, z: dRear + 0.035, w: 0.3, h: 0.106 };
  { const cw = clu.w + 0.09, top = dh + 0.138, z0 = dRear - 0.04, z1 = dRear + 0.16;
    // a curved leather visor: it rises from the dash, arches over the instruments and ends in a rolled lip; its ends sweep down
    const prof = [[z1, dh + 0.004], [z1 - 0.05, top - 0.004], [z0 + 0.06, top + 0.004], [z0 + 0.012, top - 0.004], [z0, top - 0.018], [z0 + 0.014, top - 0.03]];
    const nI = Q.maps ? 40 : 24, nJ = Q.maps ? 26 : 14, outer = [], inner = [];
    for (let i = 0; i < nI; i++) { const t = i / (nI - 1) * 2 - 1, x = dx + t * cw / 2, e = 1 - sstep(0.72, 1, Math.abs(t));
      const pr = spline(prof, nJ); outer.push(pr.map(([z, y]) => [x, dh + (y - dh) * (0.06 + 0.94 * e), z])); inner.push(pr.map(([z, y]) => [x, dh + (y - 0.007 - dh) * (0.06 + 0.94 * e), z + 0.004])); }
    main.add('darkLeather', gridSurface(outer, { flipTo: [dx, top + 1, dRear] }), { uv: 'keep' });
    main.add('dark', gridSurface(inner, { flipTo: [dx, dh - 0.4, dRear] }), { uv: 'keep' });
    main.add('piano', RB(clu.w + 0.036, clu.h + 0.026, 0.02, 0.008, 2).translate(0, 0, -0.012).applyMatrix4(faceM(new THREE.Vector3(clu.x, clu.y, clu.z), head)));
    if (Q.stitches) { const j = Math.round(nJ * 0.62); main.add('thread', stitches(outer.slice(3, nI - 3).map(r => [r[j][0], r[j][1] + 0.0008, r[j][2]]))); }
  }
  // ---------------------------------------------------------------- centre screen: a slim tablet on a stand, under glass
  const scr = { x: 0, y: dh + 0.06, z: dRear + 0.03, w: 0.3, h: 0.16 };
  main.add('piano', RB(scr.w + 0.018, scr.h + 0.018, 0.016, 0.009, 2).translate(0, 0, -0.016).applyMatrix4(faceM(new THREE.Vector3(0, scr.y, scr.z - 0.006), new THREE.Vector3(0, head.y, head.z))));
  main.add('piano', placed(RB(0.12, 0.05, 0.05, 0.012, 2), { x: 0, y: dh + 0.0, z: dRear + 0.06 }));
  // ---------------------------------------------------------------- air vents: two in the middle under the screen, a round one at each end
  { const vy = dh - 0.075, vz = dRear - 0.012;
    for (const s of [-1, 1]) {
      main.add('chrome', placed(RB(0.125, 0.042, 0.012, 0.006, 2), { x: s * 0.075, y: vy, z: vz }));
      main.add('rubber', placed(RB(0.113, 0.031, 0.012, 0.004, 1), { x: s * 0.075, y: vy, z: vz - 0.002 }));
      for (const k of [-1, 0, 1]) main.add('metal', placed(new THREE.BoxGeometry(0.108, 0.003, 0.012), { x: s * 0.075, y: vy + k * 0.009, z: vz - 0.004, rx: -0.25 }));
      const rx = s * (fw - 0.11), ry = dh - 0.055;
      main.add('chrome', placed(new THREE.TorusGeometry(0.038, 0.0055, 8, Q.maps ? 32 : 16), { x: rx, y: ry, z: vz - 0.002 }));
      main.add('rubber', placed(new THREE.CircleGeometry(0.036, 24), { x: rx, y: ry, z: vz + 0.004, ry: Math.PI }));
      for (const k of [-1, 0, 1]) main.add('metal', placed(new THREE.BoxGeometry(0.066, 0.004, 0.01), { x: rx, y: ry + k * 0.016, z: vz - 0.001, rx: -0.3 }));
      main.add('chrome', placed(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 12), { x: rx, y: ry, z: vz - 0.008, rx: Math.PI / 2 }));
    } }
  // ---------------------------------------------------------------- climate panel on the waterfall between dash and console
  const cz0 = two ? sh.z0 + 0.02 : S.seat - 0.4, czF = S.seat + 0.42;
  const wf = { top: [dh - 0.17, dRear + 0.03], bot: [yb + 0.29, czF] };
  { const P = [-0.12, 0.12].map(x => [[x, wf.top[0], wf.top[1]], [x, (wf.top[0] + wf.bot[0]) / 2 + 0.02, (wf.top[1] + wf.bot[1]) / 2 + 0.03], [x, wf.bot[0], wf.bot[1]]]);
    main.add('dark', gridSurface(P, { flipTo: [0, dh, dRear - 0.5] }), { uv: 'keep' });
    for (const s of [-1, 1]) main.add('dark', gridSurface([0.12, 0.14].map(x => [[s * x, wf.top[0], wf.top[1]], [s * x, (wf.top[0] + wf.bot[0]) / 2 + 0.02, (wf.top[1] + wf.bot[1]) / 2 + 0.03], [s * x, wf.bot[0], wf.bot[1]]]).map(r => r.map(p => [p[0], p[1], p[2] + (Math.abs(p[0]) > 0.13 ? 0.02 : 0)])), { flipTo: [0, dh, dRear - 0.5] }), { uv: 'keep' }); }
  // ---------------------------------------------------------------- centre console: tunnel, trim insert, controller, start button, cup holders, armrest
  { const L = czF - cz0, zc = (czF + cz0) / 2;
    main.add('dark', placed(RB(0.27, 0.27, L, 0.04, 3), { x: 0, y: yb + 0.135, z: zc }));
    main.add('trim', placed(RB(0.17, 0.01, L * 0.42, 0.004, 2), { x: 0, y: yb + 0.272, z: czF - L * 0.26 }));
    main.add('metal', placed(new THREE.CylinderGeometry(0.03, 0.031, 0.022, Q.maps ? 40 : 20), { x: 0.0, y: yb + 0.288, z: czF - L * 0.48 }));
    main.add('chrome', placed(new THREE.TorusGeometry(0.031, 0.0025, 6, 32), { x: 0, y: yb + 0.299, z: czF - L * 0.48, rx: Math.PI / 2 }));
    main.add('piano', placed(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 20), { x: 0.075, y: yb + 0.282, z: czF - L * 0.2 }));
    main.add('amb', placed(new THREE.TorusGeometry(0.0145, 0.0018, 6, 24), { x: 0.075, y: yb + 0.288, z: czF - L * 0.2, rx: Math.PI / 2 }));
    for (const s of [-1, 1]) main.add('rubber', placed(new THREE.CircleGeometry(0.036, 24), { x: s * 0.045, y: yb + 0.2725, z: czF - L * 0.68, rx: -Math.PI / 2 }));
    // the selector: decorative only (two pedals — there is no gear to choose), a leather boot and a machined knob
    main.add('darkLeather', placed(new THREE.CylinderGeometry(0.018, 0.034, 0.045, 18), { x: 0, y: yb + 0.29, z: czF - L * 0.05 }));
    main.add('metal', placed(RB(0.034, 0.046, 0.062, 0.014, 3), { x: 0, y: yb + 0.33, z: czF - L * 0.05, rx: -0.25 }));
    main.add('piano', placed(RB(0.026, 0.008, 0.04, 0.003, 1), { x: 0, y: yb + 0.355, z: czF - L * 0.05 - 0.006, rx: -0.25 }));
    if (!two || L > 0.5) { main.add('leather', placed(RB(0.2, 0.06, Math.min(0.32, L * 0.42), 0.025, 3), { x: 0, y: yb + 0.3, z: cz0 + Math.min(0.32, L * 0.42) / 2 + 0.02 }));
      if (Q.stitches) main.add('thread', stitches(lin(cz0 + 0.04, cz0 + Math.min(0.32, L * 0.42), 20).map(z => [0, yb + 0.331, z]))); }
  }
  // ---------------------------------------------------------------- seats
  const seat = (x, z, rear) => {
    const w = rear ? 0.5 : 0.53, cy = S.cushion - (rear ? 0.02 : 0), rec = S.H < 1.25 ? 0.42 : S.H < 1.42 ? 0.32 : 0.24, seg = Q.seatSeg;
    const bh = clamp(S.eye - cy - 0.1, 0.42, rear ? 0.56 : 0.62), out = Math.sign(x) || 1;
    const bolster = (g, axis, k, wk = 0.3) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const lx = p.getX(i), ax = Math.abs(lx) / (w / 2);
      if (axis === 'y' && p.getY(i) > 0) p.setY(i, p.getY(i) + k * sstep(wk, 0.9, ax)); if (axis === 'z' && p.getZ(i) > 0) p.setZ(i, p.getZ(i) + k * sstep(wk, 0.9, ax)); } g.computeVertexNormals(); return g; };
    main.add('leather', placed(bolster(RB(w, 0.13, 0.52, 0.045, seg), 'y', 0.04), { x, y: cy - 0.065, z: z + 0.07 }));
    main.add('quilt', placed(RB(w * 0.56, 0.02, 0.4, 0.008, 2), { x, y: cy + 0.004, z: z + 0.07 }));
    // the back: built upright at the hinge, then reclined
    const BM = new THREE.Matrix4().makeRotationX(-rec).setPosition(x, cy - 0.02, z - 0.19);
    const back = bolster(RB(w - 0.02, bh, 0.12, 0.05, seg), 'z', 0.06, 0.38); { const p = back.attributes.position; for (let i = 0; i < p.count; i++) { const t = (p.getY(i) + bh / 2) / bh; p.setX(i, p.getX(i) * (1 - 0.12 * sstep(0.62, 1, t))); } back.computeVertexNormals(); }
    back.translate(0, bh / 2, 0); main.add('leather', back.applyMatrix4(BM));
    const ins = RB(w * 0.48, bh * 0.6, 0.014, 0.006, 2); ins.translate(0, bh * 0.44, 0.062); main.add('quilt', ins.applyMatrix4(BM));
    main.add('plastic', placed(RB(w - 0.04, bh * 0.92, 0.012, 0.012, 2), { y: bh * 0.47, z: -0.064 }).applyMatrix4(BM));
    const hr = RB(0.25, 0.18, 0.095, 0.045, seg); hr.translate(0, bh + 0.11, 0.0); main.add('leather', hr.applyMatrix4(BM));
    for (const s of [-1, 1]) { const post = new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10); post.translate(s * 0.07, bh + 0.02, 0); main.add('metal', post.applyMatrix4(BM)); }
    if (Q.stitches) { for (const s of [-1, 1]) { const pth = lin(0.1, bh * 0.82, 26).map(y => new THREE.Vector3(s * w * 0.255, y, 0.06 + 0.06 * sstep(0.38, 0.9, (w * 0.255) / (w / 2)) + 0.004).applyMatrix4(BM).toArray()); main.add('thread', stitches(pth, { normalAt: () => new THREE.Vector3(0, Math.sin(rec), Math.cos(rec)) })); }
      for (const s of [-1, 1]) main.add('thread', stitches(lin(z - 0.17, z + 0.31, 26).map(zz => [x + s * w * 0.29, cy + 0.008, zz]))); }
    main.add('plastic', placed(RB(0.022, 0.12, 0.46, 0.008, 1), { x: x + out * (w / 2 + 0.008), y: cy - 0.09, z: z + 0.06 }));
    for (const s of [-1, 1]) main.add('metal', placed(new THREE.BoxGeometry(0.025, 0.02, 0.55), { x: x + s * 0.17, y: yb + 0.012, z: z + 0.05 }));
  };
  seat(dx, S.seat, false); seat(-dx, S.seat, false);
  if (!two && sh.zRearSeat - 0.3 > sh.z0) { seat(dx - 0.03, sh.zRearSeat, true); seat(-dx + 0.03, sh.zRearSeat, true); }
  // ---------------------------------------------------------------- door cards: armrest, pull handle, opener, speaker, switches, ambient light
  const strips = [];
  for (const sg of [1, -1]) {
    const zA = F.door ? F.door.z0 + 0.12 : S.seat - 0.3, zB = F.door ? F.door.z1 - 0.1 : S.seat + 0.6, zm = clamp(S.seat + 0.1, zA, zB);
    const yArm = S.cushion + 0.2, xw = sh.sideX(zm, yArm) - 0.035, B = z => bin(sg, z), add = (b, mat, g) => b.add(mat, b === door ? toDoor(g) : g);
    const zArm0 = Math.max(zA, S.seat - 0.22), zArm1 = Math.min(zB, S.seat + 0.34), zAm = (zArm0 + zArm1) / 2, bA = B(zAm);
    add(bA, 'leather', placed(RB(0.07, 0.042, zArm1 - zArm0, 0.018, 3), { x: sg * (xw - 0.035), y: yArm, z: zAm }));
    if (Q.stitches) add(bA, 'thread', stitches(lin(zArm0 + 0.02, zArm1 - 0.02, 24).map(z => [sg * (xw - 0.064), yArm + 0.019, z])));
    add(B(zArm1), 'metal', placed(RB(0.018, 0.024, 0.15, 0.008, 2), { x: sg * (xw - 0.055), y: yArm + 0.07, z: zArm1 - 0.05, rx: -0.35 }));
    add(B(zArm1), 'piano', placed(RB(0.045, 0.012, 0.085, 0.004, 1), { x: sg * (xw - 0.04), y: yArm + 0.024, z: zArm1 - 0.06 }));
    for (const k of [0, 1]) add(B(zArm1), 'metal', placed(RB(0.012, 0.01, 0.02, 0.003, 1), { x: sg * (xw - 0.04 + (k ? 0.012 : -0.012)), y: yArm + 0.033, z: zArm1 - 0.055 }));
    const yOp = sh.belt(zm) - 0.13, zOp = Math.min(zB - 0.02, S.seat + 0.42);
    add(B(zOp), 'piano', placed(RB(0.018, 0.04, 0.11, 0.008, 1), { x: sg * (xw - 0.006), y: yOp, z: zOp }));
    add(B(zOp), 'chrome', placed(RB(0.012, 0.016, 0.08, 0.006, 2), { x: sg * (xw - 0.02), y: yOp, z: zOp + 0.005 }));
    const ySp = yb + 0.2, zSp = Math.min(zB - 0.08, S.seat + 0.5), xSp = sh.sideX(zSp, ySp) - 0.034, bS = B(zSp);
    const disc = new THREE.CircleGeometry(0.066, Q.maps ? 40 : 20);
    add(bS, 'grille', placed(disc, { x: sg * (xSp - 0.004), y: ySp, z: zSp, ry: -sg * Math.PI / 2 }));
    add(bS, 'metal', placed(new THREE.TorusGeometry(0.068, 0.0045, 8, Q.maps ? 40 : 20), { x: sg * (xSp - 0.004), y: ySp, z: zSp, ry: Math.PI / 2 }));
    const yAm = sh.belt(zm) - 0.075, path = lin(zA + 0.04, zB - 0.04, 14).map(z => [sg * (sh.sideX(z, yAm) - 0.042), yAm, z]);
    const bAmb = B(zm);
    if (bAmb === door) door.add('amb', toDoor(tube(path, 0.0016, { seg: 3 }))); else main.add('amb', tube(path, 0.0016, { seg: 3 }));
    strips.push(new THREE.Vector4(path[3][0], yAm, path[3][2], 0.5), new THREE.Vector4(path[10][0], yAm, path[10][2], 0.5));
  }
  // ---------------------------------------------------------------- roof: sun visors, overhead console with reading lamps
  if (roofY) {
    const zv = G.zT1 - 0.11;
    for (const s of [-1, 1]) { main.add('suede', placed(RB(0.33, 0.016, 0.15, 0.007, 2), { x: s * 0.3, y: roofY - 0.028, z: zv, rx: 0.06 }));
      main.add('plastic', placed(RB(0.03, 0.012, 0.022, 0.004, 1), { x: s * 0.13, y: roofY - 0.02, z: zv + 0.05 })); }
    main.add('plastic', placed(RB(0.2, 0.03, 0.13, 0.012, 2), { x: 0, y: roofY - 0.022, z: zv - 0.02 }));
    for (const s of [-1, 1]) main.add('lens', placed(new THREE.CircleGeometry(0.016, 16), { x: s * 0.05, y: roofY - 0.038, z: zv - 0.02, rx: Math.PI / 2 }));
  }
  // ---------------------------------------------------------------- pedals (two: brake and gas) and the foot rest
  { const pz = Math.min(sh.z1 - 0.12, S.seat + 0.92), px = dx;
    main.add('metal', placed(RB(0.11, 0.07, 0.012, 0.006, 2), { x: px + 0.035, y: yb + 0.19, z: pz, rx: -0.55 }));
    for (const k of [-1, 0, 1]) main.add('rubber', placed(new THREE.BoxGeometry(0.1, 0.006, 0.004), { x: px + 0.035, y: yb + 0.19 + k * 0.018, z: pz - 0.007, rx: -0.55 }));
    main.add('metal', placed(RB(0.055, 0.18, 0.012, 0.006, 2), { x: px - 0.12, y: yb + 0.1, z: pz + 0.02, rx: -0.75 }));
    main.add('metal', placed(RB(0.065, 0.2, 0.014, 0.006, 2), { x: px + 0.21, y: yb + 0.1, z: pz - 0.02, rx: -0.85 }));
  }

  // the climate panel: a piano-black strip with printed (and at night backlit) controls on the upper waterfall
  const clim = { y: lerp(wf.top[0], wf.bot[0], 0.22), z: lerp(wf.top[1], wf.bot[1], 0.22) - 0.004 };
  { const al = Math.atan2(wf.top[1] - wf.bot[1], wf.top[0] - wf.bot[0]); clim.rx = al; clim.n = [0, Math.sin(al), -Math.cos(al)]; main.add('piano', placed(RB(0.2, 0.075, 0.008, 0.004, 1), { x: 0, y: clim.y, z: clim.z, rx: al })); }
  // ---------------------------------------------------------------- the steering wheel (turns with the steering) and its column
  const Wg = new THREE.Group(); Wg.name = 'cabin-wheel';
  { const R = 0.183, n = Q.wheel[0], gr = (a, c) => { let d = Math.abs(((a - c) % TAU + TAU) % TAU); d = Math.min(d, TAU - d); return Math.exp(-((d / 0.42) ** 2)); };
    const ang = lin(0, TAU, n + 1).slice(0, n), pt = a => { let y = R * Math.sin(a); if (y < -0.13) y = -0.13 + (y + 0.13) * 0.3; return [R * Math.cos(a), y, 0]; };
    const rr = a => 0.0165 + 0.0035 * (gr(a, 0) + gr(a, Math.PI)), path = ang.map(pt);
    wheelB.add('wheel', tube(path, (t, i) => rr(ang[i]), { closed: true, seg: Q.wheel[1], rd: (t, i) => rr(ang[i]) * 1.22, up: [0, 0, 1] }));
    const mk = lin(Math.PI / 2 - 0.075, Math.PI / 2 + 0.075, 8);
    wheelB.add('thread', tube(mk.map(pt), 0.0174, { seg: Q.wheel[1], rd: 0.0174 * 1.24, up: [0, 0, 1] }));
    if (Q.stitches) for (const zz of [-0.0045, 0.0045]) wheelB.add('thread', stitches(ang.filter(a => Math.abs(a - Math.PI / 2) > 0.09).map(a => { const p = pt(a), l = Math.hypot(p[0], p[1]), k = (l - rr(a) * 0.95) / l; return [p[0] * k, p[1] * k, zz]; }), { normalAt: p => new THREE.Vector3(-p.x, -p.y, 0).normalize() }));
    for (const s of [-1, 1]) {
      wheelB.add('wheel', placed(RB(0.115, 0.034, 0.022, 0.01, 2), { x: s * 0.115, y: -0.004, z: -0.004 }));
      wheelB.add('metal', placed(RB(0.09, 0.006, 0.004, 0.002, 1), { x: s * 0.118, y: -0.024, z: -0.016 }));
      wheelB.add('piano', placed(RB(0.05, 0.03, 0.008, 0.004, 1), { x: s * 0.098, y: 0.012, z: -0.015 }));
      wheelB.add('metal', placed(RB(0.012, 0.072, 0.01, 0.004, 1), { x: s * 0.02, y: -0.088, z: -0.006, rz: s * 0.1 }));   // (no shift paddles: two pedals, no gears)
    }
    wheelB.add('darkLeather', placed(RB(0.13, 0.1, 0.042, 0.02, 3), { x: 0, y: -0.006, z: -0.012 }));
    // a fictional emblem (a winged chevron) — not any maker's mark
    const E = new THREE.Shape(); E.moveTo(-0.024, 0.01); E.lineTo(-0.009, 0.01); E.lineTo(0, -0.003); E.lineTo(0.009, 0.01); E.lineTo(0.024, 0.01); E.lineTo(0, -0.015); E.closePath();
    const eg = new THREE.ExtrudeGeometry(E, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0007, bevelSize: 0.0006, bevelSegments: 1 }); eg.translate(0, 0, -0.036);
    wheelB.add('chrome', eg);
    // the column, its shroud and the two stalks (indicators / wipers) — they do not turn
    steerB.add('plastic', placed(new THREE.CylinderGeometry(0.04, 0.05, 0.27, 20, 1, true), { x: 0, y: -0.018, z: 0.17, rx: Math.PI / 2 }));
    for (const s of [-1, 1]) { steerB.add('plastic', placed(RB(0.012, 0.012, 0.115, 0.005, 1), { x: s * 0.07, y: -0.01, z: 0.07, ry: s * 0.55 })); steerB.add('metal', placed(RB(0.016, 0.016, 0.02, 0.006, 1), { x: s * 0.1, y: -0.01, z: 0.025, ry: s * 0.55 })); }
  }
  // switch legends on the spokes (lit at night)
  const climTex = (() => { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192; const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 192);
    g.fillStyle = '#f2efe6'; g.strokeStyle = '#f2efe6'; g.lineWidth = 5; g.lineCap = 'round'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 40px Arial, sans-serif';
    g.fillText('21.5°', 70, 96); g.fillText('21.0°', 442, 96);
    // fan, A/C, recirculation, front / rear demist, seat heating (plain pictograms)
    const ic = (x, f) => { g.save(); g.translate(x, 96); f(); g.restore(); };
    ic(160, () => { for (let k = 0; k < 3; k++) { g.save(); g.rotate(k * 2.094); g.beginPath(); g.ellipse(0, -14, 8, 14, 0, 0, TAU); g.stroke(); g.restore(); } });
    ic(225, () => { g.font = '700 30px Arial, sans-serif'; g.fillText('A/C', 0, 2); });
    ic(290, () => { g.beginPath(); g.arc(0, 0, 18, 0.6, 5.6); g.stroke(); g.beginPath(); g.moveTo(14, -16); g.lineTo(18, -6); g.lineTo(8, -6); g.stroke(); });
    ic(352, () => { g.beginPath(); g.moveTo(-20, 12); g.quadraticCurveTo(0, -20, 20, 12); g.stroke(); for (const x of [-8, 0, 8]) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x + 3, -6); g.stroke(); } });
    g.fillStyle = 'rgba(255,170,60,.9)'; g.fillRect(140, 150, 40, 5); g.fillRect(205, 150, 40, 5);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; own.push(t); return t; })();
  const climMat = new THREE.MeshBasicMaterial({ map: climTex, color: new THREE.Color(0.4, 0.4, 0.4), toneMapped: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); own.push(climMat);
  { const pg = new THREE.PlaneGeometry(0.18, 0.0675); pg.rotateY(Math.PI); const m = new THREE.Mesh(pg, climMat); m.name = 'cabin-climate'; m.position.set(0, clim.y + clim.n[1] * 0.0048, clim.z + clim.n[2] * 0.0048); m.rotation.x = clim.rx; m.renderOrder = 3; main.extra = (main.extra || []).concat([m]); own.push(pg); }
  const icons = (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 256, 64);
    g.strokeStyle = g.fillStyle = '#f4f1ea'; g.lineWidth = 4; g.lineCap = 'round'; g.font = '700 26px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('+', 32, 18); g.fillText('−', 32, 46); g.beginPath(); g.arc(96, 32, 12, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(96, 24); g.lineTo(96, 32); g.lineTo(102, 36); g.stroke();
    g.beginPath(); g.moveTo(152, 20); g.lineTo(152, 44); g.moveTo(144, 26); g.lineTo(144, 38); g.moveTo(160, 26); g.lineTo(160, 38); g.moveTo(136, 30); g.lineTo(136, 34); g.moveTo(168, 30); g.lineTo(168, 34); g.stroke();
    g.beginPath(); g.moveTo(208, 22); g.lineTo(232, 32); g.lineTo(208, 42); g.closePath(); g.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; own.push(t); return t; })();
  const iconMat = new THREE.MeshBasicMaterial({ map: icons, color: new THREE.Color(0.35, 0.35, 0.35), toneMapped: true }); own.push(iconMat);
  for (const s of [-1, 1]) { const pg = new THREE.PlaneGeometry(0.044, 0.026); const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, (s < 0 ? 0 : 0.5) + uv.getX(i) * 0.5); pg.rotateY(Math.PI); pg.translate(s * 0.098, 0.012, -0.0195); const m = new THREE.Mesh(pg, iconMat); m.name = 'cabin-wheel-legend'; Wg.add(m); }

  // ---------------------------------------------------------------- instrument cluster (own canvas) and centre screen (the cockpit's canvas)
  const ck = car.cockpit || (car.ensureCockpit && car.ensureCockpit());
  const clusterCv = document.createElement('canvas'); clusterCv.width = Q.clusterPx; clusterCv.height = Math.round(Q.clusterPx * 0.352);
  const clusterTex = new THREE.CanvasTexture(clusterCv); clusterTex.colorSpace = THREE.SRGBColorSpace; clusterTex.anisotropy = 4; own.push(clusterTex);
  const panelMat = tex => { const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); own.push(m); return m; };
  const facing = (w, h, pos, target, mat, name) => { const g = new THREE.PlaneGeometry(w, h); const m = new THREE.Mesh(g, mat); m.name = name; m.position.copy(pos);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(target, pos, new THREE.Vector3(0, 1, 0))); m.updateMatrix(); m.matrixAutoUpdate = false; m.renderOrder = 2; own.push(g); return m; };
  const cluPos = new THREE.Vector3(clu.x, clu.y, clu.z), scrPos = new THREE.Vector3(scr.x, scr.y, scr.z - 0.006);
  const panels = [facing(clu.w, clu.h, cluPos, head, panelMat(clusterTex), 'cabin-cluster')];
  if (ck && ck.screen) panels.push(facing(scr.w, scr.h, scrPos, new THREE.Vector3(0, head.y, head.z), panelMat(ck.screen.tex), 'cabin-screen'));
  const coverMat = cabinize(new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.1, depthWrite: false }), U, 'cover'); own.push(coverMat);
  for (const p of panels.slice()) { const c = p.clone(); c.material = coverMat; c.name = p.name + '-glass'; c.position.add(_v.set(0, 0, 0)); c.translateZ(0.002); c.updateMatrix(); panels.push(c); }
  // faux bloom: a soft halo round the instruments and the screen at night
  const glowTex = (() => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d');
    for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(255,236,200,${0.05 * (1 - k / 14)})`; g.lineWidth = 2 + k * 1.6; g.beginPath(); g.roundRect(22, 14, 84, 36, 6); g.stroke(); }
    g.fillStyle = 'rgba(255,236,200,0.05)'; g.fillRect(22, 14, 84, 36); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; own.push(t); return t; })();
  const bloomMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }); own.push(bloomMat);
  const blooms = Q.bloom ? [facing(clu.w * 1.5, clu.h * 1.8, cluPos.clone().add(new THREE.Vector3(0, 0, -0.004)), head, bloomMat, 'cabin-bloom-cluster'), facing(scr.w * 1.5, scr.h * 1.7, scrPos.clone().add(new THREE.Vector3(0, 0, -0.004)), new THREE.Vector3(0, head.y, head.z), bloomMat, 'cabin-bloom-screen')] : [];

  // ---------------------------------------------------------------- the rear-view mirror: a frameless housing behind the live picture
  if (ck && ck.mirrors && roofY) {
    const p = ck.mirrors.geometry.attributes.position, A = new THREE.Vector3().fromBufferAttribute(p, 0), B = new THREE.Vector3().fromBufferAttribute(p, 1), D = new THREE.Vector3().fromBufferAttribute(p, 5), C = new THREE.Vector3().fromBufferAttribute(p, 2);
    const c = A.clone().add(B).add(C).add(D).multiplyScalar(0.25), rgt = B.clone().sub(A), up = D.clone().sub(A), nrm = rgt.clone().cross(up).normalize(); if (nrm.dot(head.clone().sub(c)) < 0) nrm.negate();
    const hg = RB(rgt.length() + 0.016, up.length() + 0.016, 0.03, 0.012, 2), basis = new THREE.Matrix4().makeBasis(rgt.clone().normalize(), up.clone().normalize(), nrm); hg.applyMatrix4(basis); hg.translate(c.x - nrm.x * 0.017, c.y - nrm.y * 0.017, c.z - nrm.z * 0.017);
    main.add('piano', hg); main.add('piano', placed(new THREE.CylinderGeometry(0.007, 0.011, Math.max(0.03, roofY - c.y - 0.02), 10), { x: c.x, y: (roofY + c.y) / 2 + 0.005, z: c.z + 0.025 }));
    const old = car.group.getObjectByName('cockpit-mirror-housing'); if (old) old.visible = false;
  }

  // ---------------------------------------------------------------- windscreen: reflections, a little dirt, sun glare, rain drops cleared by the wipers
  const glassFx = [];
  const WU = { uRain: { value: 0 }, uWip: { value: 0 }, uTime: { value: 0 }, uGlare: { value: Q.glare ? 1 : 0 }, uSunView: { value: new THREE.Vector3(0, 0, -1) }, uSunK: { value: 0 },
    uScr: { value: new THREE.Vector4() }, uPiv: { value: new THREE.Vector4() }, uArm: { value: 0.5 }, uFront: { value: head.z + 0.25 }, uDash: { value: new THREE.Vector3(dx, 0.08, 0) } };
  if (F.glass) {
    const keys = car.glassKeys ? car.glassKeys(head) : null, scrK = keys && keys.screen && keys.screen.length === 4 ? keys.screen : null;
    if (scrK) { const bot = scrK[2].clone().add(scrK[3]).multiplyScalar(0.5), top = scrK[0].clone().add(scrK[1]).multiplyScalar(0.5), dyz = new THREE.Vector2(top.y - bot.y, top.z - bot.z).normalize(); WU.uScr.value.set(bot.y, bot.z, dyz.x, dyz.y); }
    const wl = Math.min(0.56, S.W * 0.27); WU.uPiv.value.set(-0.06, 0.035, -(S.W * 0.31), 0.035); WU.uArm.value = wl;
    const gm = cabinize(new THREE.MeshStandardMaterial({ color: '#0d1215', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.02, envMapIntensity: 1.0, depthWrite: false, side: THREE.DoubleSide }), U, 'glassfx');
    const base = gm.onBeforeCompile;
    gm.onBeforeCompile = sh => { base(sh); Object.assign(sh.uniforms, WU);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uRain, uWip, uTime, uGlare, uSunK, uArm, uFront; uniform vec3 uSunView, uDash; uniform vec4 uScr, uPiv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
// seconds since a wiper last passed over the point (x, s) of the windscreen (s = metres up the glass)
float sinceWipe(vec2 q) {
  float best = 99.0;
  for (int k = 0; k < 2; k++) { vec2 pv = k == 0 ? uPiv.xy : uPiv.zw; vec2 d = q - pv; float L = length(d); if (L > uArm || d.y < -0.02) continue;
    float th = clamp(atan(d.y, d.x), 0.06, 1.42), c = 1.0 - 2.0 * (th - 0.06) / 1.36, t1 = acos(clamp(c, -1.0, 1.0)) / 6.2831853, ph = fract(uWip);
    best = min(best, min(fract(ph - t1 + 1.0), fract(ph - (1.0 - t1) + 1.0)) * 1.3); }
  return best;
}`).replace('#include <opaque_fragment>', `{
  float front = step(uFront, vCabP.z) * (1.0 - step(0.62, abs(vCabN.x)));
  vec2 q = vec2(vCabP.x, (vCabP.y - uScr.x) * uScr.z + (vCabP.z - uScr.y) * uScr.w);
  float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  float dirt = (vn(q * 9.0) * 0.6 + vn(q * 31.0) * 0.4); dirt = smoothstep(0.45, 0.95, dirt) * (0.35 + 0.65 * smoothstep(0.25, 0.0, q.y)) * front;
  vec3 vd = normalize(-vViewPosition); float g = pow(max(dot(vd, uSunView), 0.0), 7.0) * uSunK * uGlare;
  float a = diffuseColor.a + clamp(lum * 1.6, 0.0, 0.5) + dirt * 0.05 + g * (0.06 + dirt * 0.9);
  outgoingLight += vec3(1.0, 0.92, 0.8) * g * (0.25 + dirt * 2.5);
  // the instruments' glow reflected low in the glass in front of the driver at night
  float rd = exp(-pow(length(q - uDash.xy) / 0.16, 2.0)) * front * uNight; outgoingLight += vec3(1.0, 0.85, 0.6) * rd * 0.25; a += rd * 0.15;
  if (uRain > 0.01 && front > 0.5) {
    vec2 cell = floor(q / 0.026), f = fract(q / 0.026) - 0.5; float hs = h21(cell), r = 0.12 + 0.2 * h21(cell + 7.1);
    vec2 c = vec2(h21(cell + 3.3), h21(cell + 5.7)) - 0.5; c *= 0.5; float d = length(f - c);
    float age = sinceWipe(q), on = step(hs * 1.25, age * 0.9) * uRain;
    float drop = (1.0 - smoothstep(r * 0.75, r, d)) * on;
    float lens = clamp((f.y - c.y) / r * 0.5 + 0.5, 0.0, 1.0);
    float lit = 0.12 + 0.88 * (1.0 - uNight);
    outgoingLight = mix(outgoingLight, mix(vec3(0.02, 0.025, 0.03), vec3(0.95, 0.97, 1.0) * lit, lens * lens), drop * 0.7);
    a = mix(a, 0.75, drop * 0.85);
  }
  diffuseColor.a = clamp(a, 0.0, 0.92);
}
#include <opaque_fragment>`);
    };
    gm.customProgramCacheKey = () => 'vrc-cabin-glassfx'; own.push(gm);
    const gmesh = new THREE.Mesh(F.glass, gm); gmesh.name = 'cabin-glassfx'; gmesh.renderOrder = 4; gmesh.matrixAutoUpdate = false; glassFx.push(gmesh);
    if (F.door && F.door.glass && car.door) { const dm = new THREE.Mesh(F.door.glass, gm); dm.name = 'cabin-glassfx-door'; dm.renderOrder = 4; dm.matrixAutoUpdate = false; glassFx.push(dm); }
  }

  // ---------------------------------------------------------------- assemble: one mesh per material and place
  const group = new THREE.Group(); group.name = 'vrc-cabin';
  const meshes = [];
  const build = (bins, parent, prefix) => { for (const [mat, list] of Object.entries(bins.get)) { if (!list.length || !M[mat]) continue;
    const g = mergeGeometries(list, false); if (!g) continue; g.computeBoundingSphere(); for (const x of list) x.dispose();
    const m = new THREE.Mesh(g, M[mat]); m.name = prefix + mat; m.matrixAutoUpdate = false; m.updateMatrix(); parent.add(m); meshes.push(m); } };
  build(main, group, 'cabin-');
  const doorG = car.door || null; const doorPart = new THREE.Group(); doorPart.name = 'vrc-cabin-door'; if (doorG) { build(door, doorPart, 'cabin-door-'); doorG.add(doorPart); }
  const steerPart = new THREE.Group(); steerPart.name = 'vrc-cabin-steer'; build(steerB, steerPart, 'cabin-col-'); build(wheelB, Wg, 'cabin-wheel-'); steerPart.add(Wg);
  if (car.steering) car.steering.add(steerPart); else group.add(steerPart);
  for (const p of panels) group.add(p); for (const b of blooms) group.add(b); for (const m of main.extra || []) { m.updateMatrix(); m.matrixAutoUpdate = false; group.add(m); }
  for (const g of glassFx) { if (g.name === 'cabin-glassfx-door') doorPart.add(g); else group.add(g); }
  car.group.add(group);
  const oldW = car.steering && car.steering.getObjectByName('steering-wheel');
  const hideOld = ['interior', 'door-card'].map(n => car.group.getObjectByName(n)).concat([oldW, ck && ck.cluster && ck.cluster.mesh, ck && ck.screen && ck.screen.mesh]).filter(Boolean);

  // fixed shading data of this model
  { const zM = S.seat + 0.1, bY = sh.belt(zM);
    U.uRoof.value.set(G.roofW || 0.56, S.H - 0.03, G.zT2 ?? -1, G.zT1 ?? 0.3); U.uPano.value = S.dlo.pano ? 1 : 0;
    U.uSide.value.set(sh.sideX(zM, bY - 0.05) + 0.05, bY); U.uCowl.value.set(sh.zf(0), dh + 0.01); U.uRear.value.set((G.zC ?? -1.8) + 0.12, sh.belt(G.zC ?? -1.8));
    U.uFloor.value = yb; U.uFoot.value.set(dRear + 0.05, dh, 0); U.uGlowA.value.copy(cluPos); U.uGlowB.value.copy(scrPos);
    strips.slice(0, 4).forEach((s, i) => U.uStrip.value[i].copy(s)); U.uStripCol.value.set(sc.amb); WU.uDash.value.set(dx, 0.07, 0); }

  // ---------------------------------------------------------------- the cluster drawing (digital, no gear letters: two pedals)
  const CF = '"Manrope", "Inter Tight", Arial, Helvetica, sans-serif', vDial = Math.ceil((S.perf.vmax + 25) / 40) * 40, ev = S.perf.eng === 'ev';
  let ckKey = '', ckT = 0;
  function drawCluster(st) {
    const now = performance.now(); if (now - ckT < 55) return; const kmh = Math.round(st.kmh || 0), W0 = st.warn || {};
    const key = [kmh, Math.round((st.rpm || 0) / 80), st.lights ? 1 : 0, st.left ? 1 : 0, st.right ? 1 : 0, st.limit || 0, st.disabled ? 1 : 0, Math.round((st.fuel ?? 0.7) * 40), Math.round((st.temp ?? 0.5) * 20), Object.values(W0).map(v => (v ? 1 : 0)).join(''), st.night ? 1 : 0, st.clock, st.reversing ? 1 : 0, st.odo != null ? Math.round(st.odo * 10) : ''].join('|');
    if (key === ckKey) return; ckKey = key; ckT = now;
    const g = clusterCv.getContext('2d'), W = 1024, H = 360; g.save(); g.scale(clusterCv.width / W, clusterCv.height / H);
    const bg = g.createRadialGradient(512, 150, 40, 512, 180, 620); bg.addColorStop(0, '#0d1017'); bg.addColorStop(1, '#020305'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const dial = (cx, cy, R, frac, { max, step, minor, label, red = 2, unit, digits }) => {
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, A = f => a0 + (a1 - a0) * f;
      const ring = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); ring.addColorStop(0, '#9aa0a8'); ring.addColorStop(0.45, '#f4f5f7'); ring.addColorStop(0.55, '#7b8088'); ring.addColorStop(1, '#d9dce0');
      g.lineWidth = 5; g.strokeStyle = ring; g.beginPath(); g.arc(cx, cy, R + 8, 0, TAU); g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(cx, cy, R - 24, 0, TAU); g.stroke();
      if (red < 1) { g.strokeStyle = '#d4332a'; g.lineWidth = 9; g.beginPath(); g.arc(cx, cy, R - 4, A(red), a1); g.stroke(); }
      const arc = g.createLinearGradient(cx - R, 0, cx + R, 0); arc.addColorStop(0, '#b88a3c'); arc.addColorStop(1, '#ffd38a');
      g.save(); g.shadowColor = 'rgba(255,190,90,.8)'; g.shadowBlur = 14; g.strokeStyle = arc; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.arc(cx, cy, R - 4, a0, A(clamp(frac, 0, 1.0))); g.stroke(); g.restore();
      const n = Math.round(max / minor);
      for (let i = 0; i <= n; i++) { const v = i * minor, big = v % step === 0, a = A(i / n), c = Math.cos(a), s = Math.sin(a);
        g.strokeStyle = big ? '#eef0f4' : 'rgba(238,240,244,.45)'; g.lineWidth = big ? 3 : 1.6; g.beginPath(); g.moveTo(cx + c * (R - 10), cy + s * (R - 10)); g.lineTo(cx + c * (R - (big ? 26 : 18)), cy + s * (R - (big ? 26 : 18))); g.stroke();
        if (big) { g.fillStyle = '#dfe2e8'; g.font = `600 ${Math.round(R * 0.13)}px ${CF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(label(v)), cx + c * (R - 46), cy + s * (R - 46)); } }
      const a = A(clamp(frac, 0, 1.02)), c = Math.cos(a), s = Math.sin(a);
      g.save(); g.shadowColor = 'rgba(255,80,30,.95)'; g.shadowBlur = 16; g.strokeStyle = '#ff4a1f'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx + c * (R * 0.38), cy + s * (R * 0.38)); g.lineTo(cx + c * (R - 12), cy + s * (R - 12)); g.stroke(); g.restore();
      const hub = g.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, R * 0.36); hub.addColorStop(0, '#20242c'); hub.addColorStop(1, '#07080b'); g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, R * 0.36, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(217,180,106,.55)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#f6f3ea'; g.font = `700 ${Math.round(R * 0.3)}px ${CF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(digits, cx, cy + R * 0.1);
      g.fillStyle = '#9ba2ad'; g.font = `600 ${Math.round(R * 0.1)}px ${CF}`; g.fillText(unit, cx, cy + R * 0.24);
    };
    const red = st.redline || 7000, top = Math.ceil(red / 1000) + 1;
    dial(190, 186, 150, kmh / vDial, { max: vDial, step: vDial > 260 ? 40 : 20, minor: 10, label: v => v, unit: (st.labels && st.labels.kmh) || 'km/h', digits: String(kmh) });
    if (ev) dial(834, 186, 150, (st.rpm || 0) / (st.redline || 16000), { max: 100, step: 20, minor: 5, label: v => v, unit: '% kW', digits: String(Math.round(100 * (st.rpm || 0) / (st.redline || 16000))) });
    else dial(834, 186, 150, (st.rpm || 0) / (top * 1000), { max: top * 1000, step: 1000, minor: 250, label: v => v / 1000, red: red / (top * 1000), unit: '×1000 rpm', digits: (Math.max(0, st.rpm || 0) / 1000).toFixed(1) });
    // the middle: indicators, lights, limit, clock, odometer, fuel / coolant, warning lamps (no gear indication anywhere)
    const arrow = (x, dir, on) => { g.save(); if (on) { g.shadowColor = '#39d353'; g.shadowBlur = 12; } g.fillStyle = on ? '#39d353' : 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(x + dir * 22, 44); g.lineTo(x, 24); g.lineTo(x, 36); g.lineTo(x - dir * 20, 36); g.lineTo(x - dir * 20, 52); g.lineTo(x, 52); g.lineTo(x, 64); g.closePath(); g.fill(); g.restore(); };
    arrow(440, -1, st.left); arrow(584, 1, st.right);
    g.fillStyle = st.lights ? '#4da3ff' : 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(518, 44, 11, -Math.PI / 2, Math.PI / 2); g.closePath(); g.fill(); for (let i = -1; i <= 1; i++) g.fillRect(494, 42 + i * 8, 14, 3);
    g.textAlign = 'center'; g.fillStyle = '#e9e5da'; g.font = `600 30px ${CF}`; g.textBaseline = 'alphabetic'; g.fillText(st.clock || '', 512, 120);
    g.fillStyle = '#7f8792'; g.font = `600 17px ${CF}`; if (st.odo != null) g.fillText(st.odo.toFixed(1) + ' km', 512, 148);
    if (st.limit) { g.fillStyle = '#f5f2ea'; g.beginPath(); g.arc(512, 196, 25, 0, TAU); g.fill(); g.strokeStyle = '#c8231e'; g.lineWidth = 6.5; g.stroke(); g.fillStyle = '#111'; g.font = `700 22px ${CF}`; g.textBaseline = 'middle'; g.fillText(String(st.limit), 512, 197); g.textBaseline = 'alphabetic'; }
    const bar = (x, y, w, frac, lo, hi, warn) => { g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x, y, w, 7); g.fillStyle = warn ? '#ff7a3a' : '#d9b46a'; g.fillRect(x, y, w * clamp(frac), 7); g.fillStyle = '#8b929c'; g.font = `600 14px ${CF}`; g.textAlign = 'right'; g.fillText(lo, x - 8, y + 8); g.textAlign = 'left'; g.fillText(hi, x + w + 8, y + 8); };
    bar(436, 250, 64, st.fuel ?? 0.7, ev ? '0' : 'E', ev ? '%' : 'F', (st.fuel ?? 0.7) < 0.12); bar(548, 250, 52, st.temp ?? 0.5, 'C', 'H', (st.temp ?? 0.5) > 0.85);
    const lamp = (x, y, kind, col, on) => { g.save(); g.translate(x, y); if (on) { g.shadowColor = col; g.shadowBlur = 10; } g.strokeStyle = g.fillStyle = on ? col : 'rgba(255,255,255,.07)'; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (kind === 'engine') { g.beginPath(); g.moveTo(-11, -4); g.lineTo(-5, -4); g.lineTo(-2, -8); g.lineTo(7, -8); g.lineTo(7, -4); g.lineTo(12, -4); g.lineTo(12, 7); g.lineTo(7, 7); g.lineTo(4, 10); g.lineTo(-7, 10); g.lineTo(-7, 5); g.lineTo(-11, 5); g.closePath(); g.stroke(); }
      else if (kind === 'abs') { g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.stroke(); g.font = `700 10px ${CF}`; g.fillText('ABS', 0, 1); }
      else if (kind === 'brake') { g.beginPath(); g.arc(0, 0, 10, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, 14.5, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(0, 0, 14.5, Math.PI - 0.9, Math.PI + 0.9); g.stroke(); g.fillRect(-1.3, -6, 2.6, 7.5); g.fillRect(-1.3, 3.5, 2.6, 2.6); }
      else if (kind === 'hazard') { g.beginPath(); g.moveTo(0, -12); g.lineTo(13, 10); g.lineTo(-13, 10); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, -4); g.lineTo(6, 6); g.lineTo(-6, 6); g.closePath(); g.stroke(); }
      else if (kind === 'fuel') { g.strokeRect(-7, -10, 11, 20); g.fillRect(-5, -8, 7, 6); g.beginPath(); g.moveTo(4, -4); g.lineTo(9, -1); g.lineTo(9, 8); g.stroke(); }
      else if (kind === 'door') { g.strokeRect(-6, -11, 12, 22); g.beginPath(); g.moveTo(6, -8); g.lineTo(14, -2); g.lineTo(6, 3); g.stroke(); }
      else if (kind === 'temp') { g.beginPath(); g.moveTo(0, -11); g.lineTo(0, 4); g.stroke(); g.beginPath(); g.arc(0, 7, 4, 0, TAU); g.fill(); }
      g.restore(); };
    lamp(392, 300, 'fuel', '#ffb020', W0.fuel); lamp(432, 300, 'engine', '#ffb020', W0.engine || st.disabled); lamp(472, 300, 'abs', '#ffb020', W0.abs); lamp(512, 300, 'brake', '#ff3b30', W0.hand);
    lamp(552, 300, 'hazard', '#ff3b30', W0.hazard); lamp(592, 300, 'door', '#ff3b30', W0.door); lamp(632, 300, 'temp', '#ff3b30', W0.temp);
    // glass: a faint reflection band across the top
    const gl = g.createLinearGradient(0, 0, 0, 90); gl.addColorStop(0, 'rgba(255,255,255,.06)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, 90);
    if (st.night) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, W, H); }
    g.restore(); clusterTex.needsUpdate = true;
  }
  drawCluster({ kmh: 0, rpm: 0, clock: '' });

  // ---------------------------------------------------------------- per frame
  let sunL = null, sunT = 0, active = true, rain = 0;
  const _cv = new THREE.Vector3(), _sp = new THREE.Vector3(), _tp = new THREE.Vector3(), _m3 = new THREE.Matrix3();
  function findSun(scene) { let best = null; scene.traverse(o => { if (o.isDirectionalLight && (!best || o.intensity > best.intensity)) best = o; }); return best; }
  const cabin = {
    group, quality, meshes, materials: M, uniforms: U, drawCluster, clusterCanvas: clusterCv,
    update(st = {}) {
      if (!active) return;
      car.group.updateMatrixWorld(); U.uCarInv.value.copy(car.group.matrixWorld).invert();
      const now = performance.now(), scene = st.scene || null;
      if (scene && (!sunL || now - sunT > 2000)) { sunT = now; sunL = findSun(scene); }
      if (sunL) { sunL.getWorldPosition(_sp); sunL.target.getWorldPosition(_tp); _cv.copy(_sp).sub(_tp).normalize(); const wd = _cv.clone(); _m3.setFromMatrix4(U.uCarInv.value); _cv.applyMatrix3(_m3).normalize(); U.uSunCar.value.copy(_cv);
        if (st.camera) { WU.uSunView.value.copy(wd).transformDirection(st.camera.matrixWorldInverse); } WU.uSunK.value = clamp(sunL.intensity / 2) * (1 - (st.night || 0)); }
      const nt = clamp(st.night || 0); U.uNight.value = nt;
      M.amb.color.copy(M.amb.userData.base).multiplyScalar(0.06 + 1.5 * nt);
      iconMat.color.setScalar(0.3 + 0.7 * nt); climMat.color.setScalar(0.32 + 0.6 * nt); bloomMat.opacity = Q.bloom ? 0.04 + 0.6 * nt : 0;
      if (oldW) Wg.rotation.z = oldW.rotation.z;
      rain += ((st.wipers && Q.rain ? 1 : 0) - rain) * clamp((st.dt || 0.016) * 0.6); WU.uRain.value = rain; WU.uWip.value = st.wipT || 0; WU.uTime.value = now / 1000;
    },
    setActive(on) { active = !!on; group.visible = active; doorPart.visible = active; steerPart.visible = active; for (const o of hideOld) o.visible = !active; if (car.lights && car.lights.userData.uHideDash) car.lights.userData.uHideDash.value = active ? 1 : 0; },
    dispose() { for (const m of meshes) { m.geometry.dispose(); m.parent && m.parent.remove(m); } for (const m of Object.values(M)) m.dispose();   // (the generated maps are shared by every cabin through TEX: kept)
      for (const o of own) o.dispose && o.dispose(); for (const g of glassFx) g.parent && g.parent.remove(g);
      group.parent && group.parent.remove(group); doorPart.parent && doorPart.parent.remove(doorPart); steerPart.parent && steerPart.parent.remove(steerPart);
      for (const o of hideOld) o.visible = true; if (car.lights && car.lights.userData.uHideDash) car.lights.userData.uHideDash.value = 0; if (car.cabin === cabin) car.cabin = null; },
  };
  cabin.setActive(true);
  // the car's own dispose() takes the cabin with it
  const d0 = car.dispose; try { car.dispose = function () { try { cabin.dispose(); } catch { /* */ } return d0.apply(this, arguments); }; } catch { /* */ }
  car.cabin = cabin;
  void renderer;
  return cabin;
}
/** what the device should get when nobody chose: touch screens medium, computers high */
export function cabinQualityAuto() {
  let touch = false; try { touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; } catch { /* */ }
  return touch ? 'medium' : 'high';
}
/** development aid: the generated maps of a material kind (tools/v25 previews) */
export function debugBake(kind, N = 256) { return KINDS[kind] ? KINDS[kind](N) : null; }
