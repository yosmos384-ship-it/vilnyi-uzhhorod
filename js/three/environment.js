// ЖК VILNYI (Uzhhorod) — site environment.
// Sky dome + IBL + fog + lights per mode (day / dusk / night); the plot with its courtyard (lawns, paths, the central
// ring, playground circles, terraces, hedges, trees — data.js COURTYARD); the streets with their real geometry (data.js
// STREETS, extended by site-layout.js), pavements, markings, crossings, lamps, tree rows and street-name signs; the
// neighbours (data.js CONTEXT_BLOCKS: fuel station, 2-storey buildings, 5- and 9-storey slabs, private houses); a belt of
// private houses on their lots and apartment blocks further out; and a far skyline with the low Carpathian foothills to
// the north and north-east. Everything is procedural; repeats are instanced or merged (see notes/T18.md for the count).
//
// The site-specific layout comes from ./site-layout.js (CONTRACT §4.5). It is imported dynamically: when it is missing,
// throws or exports something unusable, an inline minimal layout (plot + STREETS + CONTEXT_BLOCKS) is used instead.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS, B_IDS, CONTEXT_BLOCKS, LEVELS, PLOT, COMPASS, RAMPS, COURTYARD, PODIUM, STREETS, SITE_EXTRAS, SITE_CENTER as DATA_CENTER, localToWorld, footprintOf } from '../data.js';

// Uniforms shared with exterior.js (window glow etc. follow the environment mode).
export const SHARED = {
  uTime: { value: 0 }, uGlow: { value: 1 }, uLit: { value: 0.6 }, uNight: { value: 1 },
  envMap: null, envIntensity: 1, mats: new Set(), mode: 'dusk',
};
// Materials registered here get the sky IBL as their own envMap, so they keep outdoor reflections even while the
// walkthrough swaps scene.environment to an interior RoomEnvironment.
export function registerMaterial(m) {
  SHARED.mats.add(m);
  if (SHARED.envMap) applyEnv(m);
  return m;
}
function applyEnv(m) {
  const had = !!m.envMap;
  m.envMap = SHARED.envMap;
  m.envMapIntensity = (m.userData.envBase ?? 1) * SHARED.envIntensity;
  if (!had) m.needsUpdate = true;
}

export const SITE_CENTER = Array.isArray(DATA_CENTER) && DATA_CENTER.length === 2 ? [DATA_CENTER[0], DATA_CENTER[1]] : [0, 0];
const TAU = Math.PI * 2;
const LOW = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const glf = v => (Number.isInteger(v) ? v + '.' : String(v));   // number → GLSL float literal

// Optional sibling module context.js (the neighbouring buildings of CONTEXT_BLOCKS in more detail). It is fetched as soon
// as this module evaluates (not awaited at top level: it imports SHARED from here, and a top-level await would deadlock
// that cycle). Until it resolves — or if it is missing or throws — the inline version below is used.
let MODS = null;
const MODS_P = (() => {
  const load = (p, fn) => import(p).then(m => (typeof m[fn] === 'function' ? m : null)).catch(e => { console.info(`[env] ${p} not used:`, e && e.message); return null; });
  return load('./context.js', 'createContext').then(context => (MODS = { context }));
})();

// The site layout (data only, no three.js, no import of this module → safe to await here).
let SL = null;
try { SL = await import('./site-layout.js'); } catch (e) { console.info('[env] ./site-layout.js not used (inline minimal layout):', e && e.message); }

// ------------------------------------------------------------------ modes
// band = the thin warm glow hugging the whole horizon (blue hour), haze = how much the lowest sky melts into the fog.
// sunAz = true bearing (day: mid-morning sun from the east-south-east lights both street fronts; dusk: sunset in the
// west-north-west, behind the complex when seen from the street corner). hill / hillK = colour and strength of the foothills.
// Exposure is expressed through the light/sky intensities (the renderer's exposure belongs to the host page).
const MODES = {
  day: {
    sunEl: 42, sunAz: 118, sunCol: '#fff1dc', sunI: 2.8, disc: 0.99985,   // V4: softer day — less sun, more sky fill (shadows were near black next to the path-traced stills)
    hemiSky: '#d3e2f4', hemiGnd: '#6e6752', hemiI: 0.8, env: 0.95,
    zenith: '#3f78c0', horizon: '#cfdce6', horizonSun: '#f3efe6', band: '#000000', ground: '#8c9096', city: '#000000', sunGlow: 0.35,
    clouds: 0.3, cloudLit: '#ffffff', cloudShade: '#c3ccd8', stars: 0, haze: 1, streaks: 0.45, streakLit: '#f4f1ea', streakShade: '#b9c4d0',
    fog: '#c6d1da', fogD: 0.0006, glow: 0, lit: 0, night: 0, lights: 0, hill: '#4f6f63', hillK: 0.75,
  },
  dusk: {  // blue hour, as the developer's night render: deep blue sky, pink/orange band on the horizon
    sunEl: -4, sunAz: 292, sunCol: '#ffc49a', sunI: 0.3, disc: 0.99975,
    hemiSky: '#8898cc', hemiGnd: '#3a3028', hemiI: 1.12, env: 0.8,   // T32: 0.82 left the ground almost black from above (aerial hero, 360° capture)
    zenith: '#0a1a44', horizon: '#3a5698', horizonSun: '#f39a62', band: '#f28a5e', ground: '#101218', city: '#3a2418', sunGlow: 1.0,
    clouds: 0.22, cloudLit: '#e88a70', cloudShade: '#243062', stars: 0.2, haze: 1, streaks: 0.8, streakLit: '#ff9a70', streakShade: '#2c3564',
    fog: '#5a5478', fogD: 0.00032, glow: 1, lit: 0.55, night: 0.85, lights: 1, hill: '#1a2242', hillK: 0.9,
  },
  night: {
    sunEl: 36, sunAz: 145, sunCol: '#b8c8ff', sunI: 0.26, disc: 0.99993,
    hemiSky: '#2a3864', hemiGnd: '#14120f', hemiI: 0.42, env: 0.8,
    zenith: '#02050f', horizon: '#16203e', horizonSun: '#1c2442', band: '#4a2c1c', ground: '#050508', city: '#4a2c18', sunGlow: 0.15,
    clouds: 0.16, cloudLit: '#2a3150', cloudShade: '#07080f', stars: 1.0, haze: 1, streaks: 0.35, streakLit: '#3a3446', streakShade: '#0a0c16',
    fog: '#24253a', fogD: 0.0003, glow: 1, lit: 0.5, night: 1, lights: 1.1, hill: '#080b16', hillK: 0.9,
  },
};

// ------------------------------------------------------------------ GLSL
const GLSL_NOISE = /* glsl */`
float vr_h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vr_h13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vr_noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(vr_h12(i), vr_h12(i + vec2(1., 0.)), u.x), mix(vr_h12(i + vec2(0., 1.)), vr_h12(i + vec2(1., 1.)), u.x), u.y); }
float vr_fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * vr_noise(p); p = p * 2.03 + 19.7; a *= .5; } return s; }
`;
const GLSL_SKY = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHorizonSun; uniform vec3 uGroundCol;
uniform vec3 uSunCol; uniform float uSunGlow; uniform float uSunDisc; uniform vec3 uCityGlow;
uniform vec3 uBand; uniform vec3 uFogCol; uniform float uHaze;
vec3 vr_sky(vec3 d){
  float y = d.y;
  vec2 dh = normalize(d.xz + vec2(1e-5)); vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(dh, sh) * .5 + .5;
  float yy = max(y, 0.);
  vec3 hor = mix(uHorizon, uHorizonSun, pow(az, 6.) * .75);
  // zenith → horizon: slow at the top, fast in the last 15° (optical depth), like a real clear sky
  vec3 c = mix(hor, uZenith, pow(smoothstep(0., .62, yy), .55));
  c += uHorizonSun * uSunGlow * pow(az, 7.) * exp(-yy * 6.) * .55;
  // blue-hour band: a warm glow around the whole horizon, strongest towards the sun
  c += uBand * (.28 + .72 * pow(az, 2.)) * exp(-yy * 15.) * .55;
  c += uCityGlow * exp(-yy * 14.);
  // aerial haze: the sky meets the fogged far ground in exactly the fog colour — no seam, no dark stripe on the horizon
  c = mix(c, uFogCol, uHaze * exp(-yy * 110.));
  float cs = max(dot(d, uSunDir), 0.);
  c += uSunCol * (smoothstep(uSunDisc, uSunDisc + .00008, cs) * 14. + pow(cs, 90.) * .6 * uSunGlow + pow(cs, 7.) * .12 * uSunGlow);
  if (y < 0.) c = uFogCol + uCityGlow * .5 * exp(y * 40.);   // below the horizon: the fogged far ground
  return c;
}
`;
const GLSL_SKY_MAIN = /* glsl */`
uniform float uClouds; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uStars; uniform float uTime;
uniform float uStreaks; uniform vec3 uStreakLit; uniform vec3 uStreakShade;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = vr_sky(d);
#ifdef DETAIL
  if (d.y > 0.) {
    vec2 p = d.xz / (d.y + .1) * 1.35 + vec2(uTime * .003, uTime * .001);
    float n = vr_fbm(p * vec2(.8, 2.4));
    float cov = smoothstep(1. - uClouds, 1. - uClouds + .3, n) * smoothstep(.04, .3, d.y);
    float cs = max(dot(d, uSunDir), 0.);
    vec3 cc = mix(uCloudShade, uCloudLit, clamp(pow(cs, 2.5) * 1.2 + (n - .5) * .8 + .25, 0., 1.));
    c = mix(c, cc, cov * .88);
    // low stratus streaks hugging the horizon (lit from below by the set sun at dusk), fading into the haze
    vec2 dh2 = normalize(d.xz + vec2(1e-5));
    float sn = vr_fbm(dh2 * 2.6 + vec2(d.y * 58., -d.y * 41.) + uTime * .0015);
    float sb = smoothstep(.01, .035, d.y) * smoothstep(.2, .07, d.y);
    float sk = smoothstep(.52, .78, sn) * sb * uStreaks;
    float sAz = pow(max(dot(dh2, normalize(uSunDir.xz + vec2(1e-5))) * .5 + .5, 0.), 3.);
    c = mix(c, mix(uStreakShade, uStreakLit, clamp(sAz * 1.2 + (sn - .6) * 1.5, 0., 1.)), sk * .75);
    if (uStars > 0.) {
      vec3 sp = d * 380.; vec3 sc = floor(sp); float h = vr_h13(sc);
      float st = step(.9983, h) * smoothstep(.42, .05, length(fract(sp) - .5));
      st *= (.55 + .45 * sin(uTime * (1.5 + h * 3.) + h * 90.)) * (.4 + 2.2 * fract(h * 71.3));
      c += vec3(.9, .93, 1.) * st * uStars * smoothstep(.03, .3, d.y) * (1. - cov);
    }
  }
#endif
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const SKY_VS = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); p.z = p.w * .99999; gl_Position = p; }
`;


// ------------------------------------------------------------------ helpers
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const C = h => new THREE.Color(h);
function canvasTex(w, h, draw, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
function radialTex(inner = 0.0) {
  return canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(Math.max(0.01, inner), 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }, { srgb: false });
}
// flat geometry from a 2D shape given in world (x,z); lies at height y, faces up
function flatShapeGeo(shape, y = 0, uvScale = 1) {
  const g = new THREE.ShapeGeometry(shape, 24);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / uvScale, -p.getZ(i) / uvScale);
  return g;
}
const shapeFromXZ = pts => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
const pathFromXZ = pts => new THREE.Path(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
function ellipsePts(cx, cz, rx, rz, n, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = i / n * TAU, x = Math.cos(a) * rx, z = Math.sin(a) * rz; out.push([cx + x * Math.cos(rot) - z * Math.sin(rot), cz + x * Math.sin(rot) + z * Math.cos(rot)]); }
  return out;
}
// ------------------------------------------------------------------ materials with shader patches
// Buildings with procedural windows (context blocks, houses, city). Works for plain and instanced meshes.
function windowMaterial(o) {
  const m = new THREE.MeshStandardMaterial({ color: o.color || '#ffffff', roughness: o.rough ?? 0.85, metalness: 0 });
  const U = {
    uWinP: { value: new THREE.Vector4(o.colW, o.floorH, o.winW, o.winH) },
    uWinO: { value: new THREE.Vector4(o.base || 0, o.slab || 0, o.fin || 0, o.boost ?? 1) },
    uAcc: { value: new THREE.Vector4(...C(o.accent || '#000000').toArray(), o.accentAmt || 0) },
    uGlassC: { value: C(o.glass || '#262d36') }, uRoofC: { value: C(o.roof || '#4e4d50') }, uSlabC: { value: C(o.slabCol || '#f4efe6') },
    uLitK: { value: o.litK ?? 1 },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, { uGlow: SHARED.uGlow, uLit: SHARED.uLit });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed; varying vec3 vWP; varying vec3 vWN; varying float vSeed;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        mat4 vrM = modelMatrix;
        #ifdef USE_INSTANCING
        vrM = modelMatrix * instanceMatrix;
        #endif
        vWP = (vrM * vec4(position, 1.)).xyz; vWN = normalize(mat3(vrM) * normal); vSeed = aSeed;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + `
        uniform vec4 uWinP; uniform vec4 uWinO; uniform vec4 uAcc; uniform vec3 uGlassC; uniform vec3 uRoofC; uniform vec3 uSlabC; uniform float uGlow; uniform float uLit; uniform float uLitK;
        varying vec3 vWP; varying vec3 vWN; varying float vSeed;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 vrN = normalize(vWN);
        float vrRoof = step(.6, vrN.y);
        vec2 vrF = vec2(dot(vWP.xz, vec2(-vrN.z, vrN.x)), vWP.y - uWinO.x);
        vec2 vrC = vrF / uWinP.xy;
        vec2 vrId = floor(vrC); vec2 vrG = fract(vrC);
        vec2 vrHalf = uWinP.zw / uWinP.xy * .5;
        vec2 vrW = max(fwidth(vrC), vec2(1e-4));
        float vrWin = smoothstep(vrHalf.x + vrW.x, vrHalf.x - vrW.x, abs(vrG.x - .5)) * smoothstep(vrHalf.y + vrW.y, vrHalf.y - vrW.y, abs(vrG.y - .5));
        vrWin *= (1. - vrRoof) * step(0., vrF.y);
        float vrFar = clamp(max(vrW.x, vrW.y) * 1.6 - .25, 0., 1.);
        float vrCov = (uWinP.z * uWinP.w) / (uWinP.x * uWinP.y) * (1. - vrRoof) * step(0., vrF.y);
        vrWin = mix(vrWin, vrCov, vrFar);
        float vrS = floor(vSeed + .5);                       // integer seed (varyings are not exact)
        float vrR = vr_h12(vrId + vec2(vrS * 7., vrS * 3.));
        float vrLit = mix(step(1. - uLit * uLitK, vrR), uLit * uLitK, vrFar);
        float vrSlab = uWinO.y * smoothstep(.07 + vrW.y, .07 - vrW.y, vrG.y) * (1. - vrRoof) * (1. - vrFar * .6);
        float vrFin = uWinO.z * smoothstep(.04 + vrW.x, .04 - vrW.x, abs(fract(vrC.x / 2.) - .5) - .46) * (1. - vrRoof) * (1. - vrFar);
        // accent columns (coloured cladding strips framing some window columns, full height)
        float vrAc = step(vr_h12(vec2(vrId.x * 1.3 + vrS, vrS * .7 + 5.)), uAcc.w) * step(abs(vrG.x - .5), vrHalf.x + .09) * (1. - vrRoof) * step(0., vrF.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, uAcc.rgb, vrAc * (1. - vrFar * .5));
        diffuseColor.rgb = mix(diffuseColor.rgb, uGlassC, vrWin);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSlabC, clamp(vrSlab + vrFin, 0., 1.) * (1. - vrWin));
        diffuseColor.rgb = mix(diffuseColor.rgb, uRoofC, vrRoof);
        vec3 vrWarm = mix(vec3(1., .58, .28), vec3(1., .82, .6), vr_h12(vrId * 1.7 + vrS));
        vec3 vrEm = vrWarm * vrWin * vrLit * uGlow * uWinO.w * (.5 + .9 * fract(vrR * 13.1));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .12, vrWin * (1. - vrFar * .6));')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, .8, vrWin * (1. - vrFar));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vrEm + diffuseColor.rgb * vec3(1., .8, .6) * uGlow * .05 * (1. - vrWin);');
  };
  m.customProgramCacheKey = () => 'vr-win';
  m.userData.win = { ...o };
  m.userData.envBase = 0.6;
  return m;
}

// Ground: world-space noise colouring (grass / dry grass / soil) so the huge plane never tiles visibly
// Beyond the modelled belt (r0) the ground paints the suburbs on to the horizon: the continued street grid, lots with
// roofs seen from above, dark tree masses and woodland; at night the streets and windows glow. Details fade to their
// average colour as they shrink below a pixel, so the far field never shimmers.
function groundMaterial(r0, r1) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uGlow = SHARED.uGlow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvGW = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW; uniform float uGlow;\n' + GLSL_NOISE + GLSL_GRID)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vGW.xz;
        float gn = vr_fbm(p * .011); float gn2 = vr_fbm(p * .09 + 7.); float gn3 = vr_noise(p * .6);
        vec3 gc = mix(vec3(.085, .125, .05), vec3(.16, .17, .085), smoothstep(.35, .7, gn));
        gc = mix(gc, vec3(.17, .145, .1), smoothstep(.62, .85, gn2) * .5);
        gc *= .85 + .3 * gn3;
        float dC = length(p - vec2(${glf(SITE_CENTER[0])}, ${glf(SITE_CENTER[1])}));
        float far = smoothstep(${r0.toFixed(1)}, ${(r0 + 80).toFixed(1)}, dC);
        float far2 = smoothstep(${r1.toFixed(1)}, ${(r1 + 120).toFixed(1)}, dC);    // beyond the instanced far houses
        vec3 vrEmG = vec3(0.);
        if (far > 0.) {
          float px = max(length(fwidth(p)), 1e-3);                 // metres per pixel
          vec2 st = vr_street(p);
          float road = 1. - smoothstep(3.2 - px * .5, 3.2 + px * .5, st.x);
          float walk = 1. - smoothstep(5.8 - px * .5, 5.8 + px * .5, st.x);
          // lots: 13 × 19 m cells, a roof in most of them
          vec2 lc = vec2(floor(p.x / 13.), floor(p.y / 19.));
          float h = vr_h12(lc), h2 = vr_h12(lc + 17.3);
          vec2 lf = fract(vec2(p.x / 13., p.y / 19.)) - .5;
          vec2 hs = vec2(.26 + .12 * h2, .2 + .1 * h);
          float roof = step(abs(lf.x - (h - .5) * .2), hs.x) * step(abs(lf.y - (h2 - .5) * .3), hs.y) * step(.18, h) * (1. - walk) * far2;
          vec3 rc = h2 < .55 ? mix(vec3(.3, .09, .05), vec3(.38, .15, .08), h) : h2 < .85 ? mix(vec3(.1, .1, .11), vec3(.2, .2, .2), h) : vec3(.55, .52, .46);
          float wd = vr_fbm(p * .004 + 3.) * .7 + vr_noise(p * .011) * .3;
          float forest = smoothstep(.56, .6, wd);
          float tree = smoothstep(.5, .56, vr_fbm(p * .045 + 11.) * .6 + wd * .55) * (1. - road) * far2;
          forest *= far2;
          vec3 yard = mix(gc, vec3(.1, .11, .06), .4);
          vec3 det = mix(yard, rc, roof * (1. - forest));
          det = mix(det, vec3(.03, .055, .02) * (.8 + .5 * vr_noise(p * .3)), max(tree, forest * (1. - road)));
          det = mix(det, vec3(.3, .29, .27), walk - road);
          det = mix(det, vec3(.05, .05, .055), road);
          // average colour of the pattern, used when a lot is only a few pixels
          vec3 avg = mix(mix(yard, vec3(.22, .12, .08), .22), vec3(.035, .055, .025), .45 + forest * .5);
          avg = mix(avg, vec3(.06, .06, .065), .08);
          det = mix(det, avg, smoothstep(1.2, 5., px));
          gc = mix(gc, det, far);
          // night: street lighting + lit windows, averaged far away
          float lamp = exp(-pow(mod(st.y, 34.) - 17., 2.) * .02) * (1. - smoothstep(0., 9., st.x));
          float win = roof * step(.62, fract(h * 13.7 + h2 * 3.1));
          float nearE = lamp * .1 + win * .2 + walk * .02;
          float farE = (.04 * (1. - forest) + .008) * far2 + .01;
          vrEmG = vec3(1., .62, .3) * uGlow * far * mix(nearE, farE, smoothstep(1.5, 6., px));
        }
        diffuseColor.rgb = gc;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vrEmG;');
  };
  m.customProgramCacheKey = () => 'vr-ground2';
  m.userData.envBase = 0.3;
  return m;
}

// Standard material whose map is sampled in world XZ (used for tiling paving / lawns on arbitrary geometry)
function stdMat(o) { const { envBase = 0.6, ...rest } = o; const m = new THREE.MeshStandardMaterial(rest); m.userData.envBase = envBase; return m; }

// ------------------------------------------------------------------ geometry builders
function crownGeometry(detail, lobes, seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < lobes; i++) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    let r, x = 0, y, z = 0;
    if (i === 0) { r = lobes > 2 ? 0.62 : 0.9; y = 0; }
    else { r = 0.36 + rnd() * 0.16; const a = rnd() * TAU, d = 0.34 + rnd() * 0.22; x = Math.cos(a) * d; z = Math.sin(a) * d; y = (rnd() - 0.35) * 0.7; }
    g.scale(r, r * 0.9, r); g.translate(x, y, z);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    parts.push(g);
  }
  const g = mergeVertices(mergeGeometries(parts), 1e-3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 7.1 + v.y * 4.3) * Math.cos(v.z * 6.7 - v.y * 3.1) * 0.07 + Math.sin(v.x * 17.3 + v.z * 13.7 + v.y * 5.) * 0.035;
    const len = v.length(); v.multiplyScalar((len + n) / Math.max(len, 1e-3));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeBoundingBox();
  const bb = g.boundingBox; const h = bb.max.y - bb.min.y, w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); g.scale(2 / w, 1 / h, 2 / w);   // unit crown: radius 1, height 1, base at y=0
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), rr = Math.hypot(p.getX(i), p.getZ(i));
    const k = (0.55 + 0.45 * Math.pow(Math.min(1, Math.max(0, y)), 0.7)) * (0.78 + 0.22 * Math.min(1, rr));
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.95;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// Close-range crown: ~40 alpha-tested leaf cards spread through an ellipsoid (normals point away from the crown centre
// so the lighting stays soft and round) around a dark inner core that hides the see-through gaps.
function leafCrownGeometry(seed, cards = 40) {
  const rnd = mulberry32(seed), parts = [];
  const core = new THREE.IcosahedronGeometry(0.72, 0); core.deleteAttribute('uv'); core.scale(1, 0.62, 1); core.translate(0, 0.5, 0);
  { const n = core.attributes.position.count, uv = new Float32Array(n * 2).fill(0.5); core.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const col = new Float32Array(n * 3).fill(0.5); core.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  { // round (radial) normals so the inner core never shows as flat facets between the leaf cards
    const p = core.attributes.position, n = core.attributes.normal, r = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { r.set(p.getX(i), (p.getY(i) - 0.5) * 1.3, p.getZ(i)).normalize(); n.setXYZ(i, r.x, r.y, r.z); }
    core.getAttribute('color').array.fill(0.62);
  }
  parts.push(core.index ? core.toNonIndexed() : core);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < cards; i++) {
    // random point in the upper-weighted ellipsoid
    let x, y, z; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
    const r = 0.55 + 0.45 * Math.cbrt(rnd());
    c.set(x, y, z).normalize().multiplyScalar(r * 0.78); c.y = 0.5 + c.y * 0.55;
    const g = new THREE.PlaneGeometry(0.62, 0.62);
    e.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI); q.setFromEuler(e); g.applyQuaternion(q); g.translate(c.x, c.y, c.z);
    const n = new THREE.Vector3(c.x, (c.y - 0.45) * 1.4, c.z).normalize(), p = g.attributes.position, nn = g.attributes.normal;
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k); nn.setXYZ(k, n.x, n.y, n.z);
      const sh = 0.72 + 0.4 * Math.min(1, Math.max(0, v.y)) * (0.7 + 0.3 * Math.hypot(v.x, v.z) / 0.8);
      col.set([sh, sh, sh * 0.96], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const g = mergeGeometries(parts);
  return g;
}
let LEAF_TEX = null;
function leafTexture() {
  if (LEAF_TEX) return LEAF_TEX;
  LEAF_TEX = canvasTex(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.fillStyle = '#2c3a1c'; g.beginPath(); g.arc(w / 2, w / 2, 7, 0, TAU); g.fill();   // opaque centre (the core samples it)
    const rr = mulberry32(31);
    for (let i = 0; i < 520; i++) {
      const a = rr() * TAU, d = Math.sqrt(rr()) * w * 0.44, x = w / 2 + Math.cos(a) * d, y = w / 2 + Math.sin(a) * d;
      const l = 36 + rr() * 36, sat = 32 + rr() * 26;
      g.fillStyle = `hsl(${80 + rr() * 30},${sat}%,${l}%)`;
      g.save(); g.translate(x, y); g.rotate(rr() * TAU); g.beginPath(); g.ellipse(0, 0, 4 + rr() * 6, 2 + rr() * 3, 0, 0, TAU); g.fill(); g.restore();
    }
  }, { srgb: true });
  LEAF_TEX.anisotropy = 4;
  return LEAF_TEX;
}
// 8-triangle crown for the far belt: a squashed octahedron with spherical normals (reads as a soft blob at 1–2 km)
function blobGeometry() {
  const g = new THREE.OctahedronGeometry(1, 0); g.deleteAttribute('uv');
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); n.setXYZ(i, ...v.clone().normalize().toArray());
    const y = v.y * 0.5 + 0.5; p.setXYZ(i, v.x, y, v.z);
    const k = 0.55 + 0.45 * y; col.set([k, k, k * 0.95], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function carGeometry() {
  const body = new THREE.BoxGeometry(4.3, 0.75, 1.8); body.translate(0, 0.62, 0);
  const cab = new THREE.BoxGeometry(2.3, 0.6, 1.62); cab.translate(-0.25, 1.28, 0);
  const cp = cab.attributes.position; for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 1.4) { cp.setX(i, cp.getX(i) * 0.82 - 0.1); cp.setZ(i, cp.getZ(i) * 0.9); }
  cab.computeVertexNormals();
  const paint = (g, k) => { const n = g.attributes.position.count; const c = new Float32Array(n * 3).fill(k); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const parts = [paint(body.toNonIndexed(), 1), paint(cab.toNonIndexed(), 0.13)];
  for (const [x, z] of [[1.35, 0.82], [1.35, -0.82], [-1.35, 0.82], [-1.35, -0.82]]) {   // wheels (dark discs, 8 sides)
    const w = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 8); w.rotateX(Math.PI / 2); w.translate(x, 0.33, z); parts.push(paint(w.toNonIndexed(), 0.05));
  }
  const g = mergeGeometries(parts);
  g.deleteAttribute('uv');
  return g;
}

// ------------------------------------------------------------------ geography (true orientation)
// The world frame is the site frame of data.js (origin = centre of the courtyard ring, +x towards вул. Грушевського,
// +z towards вул. Заньковецької); true north is given by data.js COMPASS (bearing of −z). Streets, neighbours and the
// courtyard come from data.js / site-layout.js in world metres, so everything sits at its real bearing.
const WAZ = b => b - COMPASS.negZ;                                           // true bearing → world bearing (from −z, clockwise)
const wDir = b => { const a = WAZ(b) * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; };

function inPoly(poly, x, z) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function distSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
function distPoly(poly, x, z, closed = true) {
  let d = Infinity; const n = poly.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) { const a = poly[i], b = poly[(i + 1) % n]; d = Math.min(d, distSeg(x, z, a[0], a[1], b[0], b[1])); }
  return d;
}
const nearPoly = (poly, x, z, m) => inPoly(poly, x, z) || (m > 0 && distPoly(poly, x, z) < m);


const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPt = p => Array.isArray(p) && isNum(p[0]) && isNum(p[1]);
const isPoly = p => Array.isArray(p) && p.length >= 3 && p.every(isPt);
const arr = v => (Array.isArray(v) ? v : []);
// "world polygons (may be [])": one polygon or a list of polygons → always a list
const polyList = z => { const a = arr(z); return !a.length ? [] : isPt(a[0]) ? (isPoly(a) ? [a] : []) : a.filter(isPoly); };
const bboxOf = pts => pts.reduce((b, [x, z]) => { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); return b; }, { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
const centroidOf = pts => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };
const boxed = poly => ({ poly, ...bboxOf(poly) });
const nearBoxed = (b, x, z, m) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m && nearPoly(b.poly, x, z, m);

// The plot and the massing that stands on it (world): every distinct outline of each tower (the ground plate and the
// upper plates differ), the podium volumes, the solid site extras; around it the neighbours of CONTEXT_BLOCKS.
const SITE_PLOT = isPoly(PLOT) ? PLOT : [[-45, -42], [50, -42], [50, 58], [-45, 58]];
const PLOT_BB = bboxOf(SITE_PLOT);
const BLD_BASE = [], BLD_POLYS = [];
for (const id of B_IDS) {
  const b = BUILDINGS[id]; if (!b) continue;
  const seen = new Set();
  for (const f of [1, 2, Math.ceil((b.floors || 2) / 2), b.floors || 1]) {
    let o = null; try { o = footprintOf(id, f); } catch { o = null; }
    if (!isPoly(o)) continue;
    const key = o.length + ':' + o[0].join(',') + ':' + o[o.length >> 1].join(',');
    if (seen.has(key)) continue; seen.add(key);
    const w = boxed(o.map(([x, z]) => localToWorld(id, x, z)));
    BLD_POLYS.push(w); if (f === 1) BLD_BASE.push(w);
  }
}
const POD_POLYS = arr(PODIUM).filter(p => p && isPoly(p.poly)).map(p => boxed(p.poly));
const EXTRAS = arr(SITE_EXTRAS).filter(e => e && isPoly(e.poly));
const CTX = arr(CONTEXT_BLOCKS).filter(b => b && isPoly(b.poly)).map(b => ({ ...b, ...bboxOf(b.poly) }));
const SOLIDS = [...BLD_POLYS, ...POD_POLYS, ...EXTRAS.filter(e => e.h > 0).map(e => boxed(e.poly))];
function nearBuilding(x, z, m) {
  for (const p of SOLIDS) if (nearBoxed(p, x, z, m)) return true;
  for (const b of CTX) if (nearBoxed(b, x, z, m)) return true;
  return false;
}
const CY = COURTYARD || {};
const RING = CY.ring && isNum(CY.ring.r0) && isNum(CY.ring.r1) ? CY.ring : null;
const CY_PATHS = arr(CY.paths).filter(p => p && isPoly(p.poly)).map(p => boxed(p.poly));
const CY_DRIVES = arr(CY.driveways).filter(p => p && isPoly(p.poly)).map(p => boxed(p.poly));
const CY_CIRCLES = arr(CY.playground && CY.playground.circles).filter(c => c && isPt(c.c) && isNum(c.r));
const CY_HARD = [...arr(CY.terraces).filter(isPoly), ...arr(CY.steps).filter(s => s && isPoly(s.poly)).map(s => s.poly)].map(boxed);
const RAMP_LIST = arr(RAMPS).filter(r => r && isNum(r.x0) && isNum(r.x1) && isNum(r.z0) && isNum(r.z1));
const streetName = id => { const s = arr(STREETS).find(q => q.id === id); return (s && s.name && (s.name.uk || s.name.en)) || null; };

// ------------------------------------------------------------------ site layout (site-layout.js, or the inline minimal one)
// T_ROADS [{id, w, main, pts, name}] · Z_TRACED / Z_IND / Z_MID / Z_GREEN [polygon…] · HALLS [{poly, h, roof}] ·
// MIDRISE [{w, L, W, b, fl, roof}] · SITE {x0, x1, z0, z1} · YARD {x, z} · PLAY [x0, x1, z0, z1] | null ·
// LAWNS [[x0, x1, z0, z1, r]…] · PATHS [[pts, width]…] · PLAZAS [[x, z, r]…] · SITE_LOTS [[x0, x1, z0, z1, rows]…]
const okRoad = r => r && isNum(r.w) && r.w > 1 && Array.isArray(r.pts) && r.pts.length >= 2 && r.pts.every(isPt);
const normRoad = r => ({ id: String(r.id ?? 'street'), w: r.w, main: !!r.main, pts: r.pts, name: (r.name && (r.name.uk || (typeof r.name === 'string' && r.name))) || streetName(r.id), est: !!r.est });
function fallbackLayout() {
  const c = isPt(CY.center) ? CY.center : SITE_CENTER, pg = CY.playground;
  return {
    src: 'inline',
    T_ROADS: arr(STREETS).filter(okRoad).map(normRoad),
    Z_TRACED: [ellipsePts(SITE_CENTER[0], SITE_CENTER[1], 430, 430, 28)],   // the mapped streets: no generic grid inside
    Z_IND: [], Z_MID: [], Z_GREEN: [], HALLS: [], MIDRISE: [],
    SITE: { x0: PLOT_BB.x0 - 45, x1: PLOT_BB.x1 + 45, z0: PLOT_BB.z0 - 45, z1: PLOT_BB.z1 + 45 },
    YARD: { x: c[0], z: c[1] },
    PLAY: pg && [pg.x0, pg.x1, pg.z0, pg.z1].every(isNum) ? [pg.x0, pg.x1, pg.z0, pg.z1] : null,
    LAWNS: [],
    PATHS: arr(CY.paths).filter(p => p && Array.isArray(p.pts) && p.pts.length >= 2 && p.pts.every(isPt)).map(p => [p.pts, isNum(p.w) ? p.w : 2.4]),
    PLAZAS: RING ? [[c[0], c[1], RING.r1]] : [],
    SITE_LOTS: [],
    // optional extras of site-layout.js (beyond CONTRACT §4.5); null / [] → generated here instead
    TREES: null, LAMPS: null, CROSSINGS: null, GREEN_PATCHES: [], PARKING_POCKETS: [], HILLS: null,
  };
}
function resolveLayout(m) {
  const o = fallbackLayout();
  if (!m) return o;
  o.src = 'site-layout'; o.fallbackFor = [];
  const take = (k, v) => { if (v !== undefined && v !== null) o[k] = v; else o.fallbackFor.push(k); };
  const roads = arr(m.T_ROADS).filter(okRoad).map(normRoad);
  take('T_ROADS', roads.length ? roads : undefined);
  const zt = polyList(m.Z_TRACED);
  take('Z_TRACED', zt.length ? zt : undefined);
  for (const k of ['Z_IND', 'Z_MID', 'Z_GREEN']) take(k, k in m ? polyList(m[k]) : undefined);
  take('HALLS', Array.isArray(m.HALLS) ? m.HALLS.filter(h => h && isPoly(h.poly) && isNum(h.h) && h.h > 0) : undefined);
  take('MIDRISE', Array.isArray(m.MIDRISE) ? m.MIDRISE.filter(q => q && isPt(q.w) && isNum(q.L) && isNum(q.W) && isNum(q.fl)).map(q => ({ ...q, b: isNum(q.b) ? q.b : COMPASS.negZ + 90 })) : undefined);
  const S = m.SITE;
  take('SITE', S && [S.x0, S.x1, S.z0, S.z1].every(isNum) && S.x0 <= PLOT_BB.x0 && S.x1 >= PLOT_BB.x1 && S.z0 <= PLOT_BB.z0 && S.z1 >= PLOT_BB.z1 && S.x1 - S.x0 < 600 && S.z1 - S.z0 < 600 ? { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 } : undefined);
  take('YARD', m.YARD && isNum(m.YARD.x) && isNum(m.YARD.z) ? { x: m.YARD.x, z: m.YARD.z } : undefined);
  if ('PLAY' in m) o.PLAY = Array.isArray(m.PLAY) && m.PLAY.length >= 4 && m.PLAY.slice(0, 4).every(isNum) ? m.PLAY.slice(0, 4) : null; else o.fallbackFor.push('PLAY');
  take('LAWNS', Array.isArray(m.LAWNS) ? m.LAWNS.filter(l => Array.isArray(l) && l.slice(0, 4).every(isNum) && l[1] > l[0] && l[3] > l[2]).map(l => [l[0], l[1], l[2], l[3], isNum(l[4]) ? l[4] : 1.5]) : undefined);
  take('PATHS', Array.isArray(m.PATHS) ? m.PATHS.filter(p => Array.isArray(p) && Array.isArray(p[0]) && p[0].length >= 2 && p[0].every(isPt)).map(p => [p[0], isNum(p[1]) ? p[1] : 2.4]) : undefined);
  take('PLAZAS', Array.isArray(m.PLAZAS) ? m.PLAZAS.filter(p => Array.isArray(p) && p.slice(0, 3).every(isNum)) : undefined);
  take('SITE_LOTS', Array.isArray(m.SITE_LOTS) ? m.SITE_LOTS.filter(l => Array.isArray(l) && l.slice(0, 4).every(isNum) && Array.isArray(l[4])) : undefined);
  // ---- optional extras (each one validated on its own; a bad or missing one just falls back to the generated version)
  const withP = a => arr(a).filter(t => t && isPt(t.p));
  const trees = withP(m.TREES);
  if (trees.length >= 10) o.TREES = trees.map(t => ({ p: t.p, h: isNum(t.h) ? t.h : 8, r: isNum(t.r) ? t.r : 2.2, kind: t.kind || 'street' }));
  const lamps = withP(m.LAMPS).filter(l => isPt(l.dir));
  if (lamps.length >= 10) o.LAMPS = lamps.map(l => ({ p: l.p, dir: l.dir, h: isNum(l.h) && l.h > 3 ? l.h : 9 }));
  const cross = arr(m.CROSSINGS).filter(c => c && isPt(c.c) && isPt(c.along) && isNum(c.len) && isNum(c.w));
  if (cross.length) o.CROSSINGS = cross.map(c => ({ c: c.c, along: c.along, len: c.len, w: c.w }));
  o.GREEN_PATCHES = arr(m.GREEN_PATCHES).filter(q => q && isPoly(q.poly)).map(q => ({ poly: q.poly, kind: q.kind || 'lawn' }));
  o.PARKING_POCKETS = arr(m.PARKING_POCKETS).filter(q => q && isPoly(q.poly)).map(q => ({ poly: q.poly, kind: q.kind || 'parking',
    rows: arr(q.rows).filter(r => r && isPt(r.from) && isPt(r.to) && isNum(r.n) && r.n > 0 && isPt(r.bay) && isPt(r.dir)) }));
  const hills = arr(m.SKYLINE && m.SKYLINE.hills).filter(h => h && isNum(h.from) && isNum(h.to));
  if (hills.length) o.HILLS = hills.map(h => ({ from: h.from, to: h.to, rel: isNum(h.rel) ? h.rel : 1 }));
  return o;
}
let T_ROADS, Z_TRACED, Z_IND, Z_MID, Z_GREEN, HALLS, MIDRISE, SITE, YARD, PLAY, LAWNS, PATHS, PLAZAS, SITE_LOTS, LAYOUT_SRC = 'inline';
let X_TREES, X_LAMPS, X_CROSS, X_GREEN, X_POCKETS, X_HILLS;   // the optional extras
let LAYOUT = null;
function useLayout(o) {
  ({ T_ROADS, Z_TRACED, Z_IND, Z_MID, Z_GREEN, HALLS, MIDRISE, SITE, YARD, PLAY, LAWNS, PATHS, PLAZAS, SITE_LOTS } = o);
  ({ TREES: X_TREES, LAMPS: X_LAMPS, CROSSINGS: X_CROSS, GREEN_PATCHES: X_GREEN, PARKING_POCKETS: X_POCKETS, HILLS: X_HILLS } = o);
  // a neighbour that CONTEXT_BLOCKS already carries is not built twice
  MIDRISE = MIDRISE.filter(q => !CTX.some(b => nearBoxed(b, q.w[0], q.w[1], 12)));
  HALLS = HALLS.filter(h => { const [cx, cz] = centroidOf(h.poly); return !CTX.some(b => nearBoxed(b, cx, cz, 4)); });
  LAYOUT_SRC = o.src; LAYOUT = null;
  if (o.fallbackFor && o.fallbackFor.length) console.info('[env] site-layout.js: inline values used for', o.fallbackFor.join(', '));
}
try { useLayout(resolveLayout(SL)); } catch (e) { console.warn('[env] site-layout.js unusable, inline minimal layout', e); useLayout(fallbackLayout()); }

// ------------------------------------------------------------------ neighbourhood layout (computed once, deterministic)
// Occupancy raster (3 m cells) keeps roads, lots, houses, the plot and the neighbours from overlapping. Values:
// 0 free · 1 house · 2 yard · 3 asphalt · 4 sidewalk · 5 blocked (plot, neighbours, halls, blocks) · 6 estate ground ·
// 7 service / industrial yard (no houses; sheds and a few trees)
const OCC_CS = 3;
function makeOcc(cx, cz, R) {
  const n = Math.ceil(2 * R / OCC_CS), a = new Uint8Array(n * n), x0 = cx - R, z0 = cz - R;
  const idx = (x, z) => { const i = Math.floor((x - x0) / OCC_CS), j = Math.floor((z - z0) / OCC_CS); return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i; };
  const at = (x, z) => { const k = idx(x, z); return k < 0 ? 255 : a[k]; };
  const set = (x, z, v, soft) => { const k = idx(x, z); if (k >= 0 && (!soft || a[k] === 0)) a[k] = v; };
  // oriented rect: centre, unit axis u (half length hu), normal axis n = (-uz, ux) (half length hn)
  const rect = (cx, cz, ux, uz, hu, hn, fn) => {
    for (let s = -hu; s <= hu + 1e-6; s += Math.min(1.5, hu || 1.5)) for (let t = -hn; t <= hn + 1e-6; t += Math.min(1.5, hn || 1.5)) {
      if (fn(cx + ux * s - uz * t, cz + uz * s + ux * t) === false) return false;
    }
    return true;
  };
  const free = (cx, cz, ux, uz, hu, hn, yardOK = false) => rect(cx, cz, ux, uz, hu, hn, (x, z) => { const v = at(x, z); return v === 0 || (yardOK && v === 2); });
  const mark = (cx, cz, ux, uz, hu, hn, v, soft = false) => rect(cx, cz, ux, uz, hu, hn, (x, z) => { set(x, z, v, soft); });
  const fillPoly = (poly, v) => {  // scanline over cell rows
    let zmin = Infinity, zmax = -Infinity; for (const [, z] of poly) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    for (let z = Math.floor((zmin - z0) / OCC_CS) * OCC_CS + z0 + OCC_CS / 2; z < zmax; z += OCC_CS) {
      const xs = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z)) xs.push(xi + (z - zi) * (xj - xi) / (zj - zi));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = xs[k]; x < xs[k + 1]; x += OCC_CS) set(x, z, v);
    }
  };
  return { at, set, free, mark, fillPoly };
}

// The generic street grid of the suburbs (gently wobbling, never ruler-straight). The same formulas run in the ground
// shader (GLSL_GRID) so the painted far streets continue the modelled ones out to the horizon.
const GRID = { GZ: 76, GX: 172 };
const gridZ = (k, x) => SITE_CENTER[1] + 38 + k * GRID.GZ + 6 * Math.sin(k * 1.7) + 4 * Math.sin(x / 260 + k);
const gridX = (j, z) => SITE_CENTER[0] + 60 + j * GRID.GX + 15 * Math.sin(j * 2.3) + 5 * Math.sin(z / 310 + j * 1.3);
const GLSL_GRID = /* glsl */`
float vr_gz(float k, float x){ return ${glf(SITE_CENTER[1] + 38)} + k * ${GRID.GZ}. + 6. * sin(k * 1.7) + 4. * sin(x / 260. + k); }
float vr_gx(float j, float z){ return ${glf(SITE_CENTER[0] + 60)} + j * ${GRID.GX}. + 15. * sin(j * 2.3) + 5. * sin(z / 310. + j * 1.3); }
// distance to the nearest grid street (x = along-street coordinate of the nearest one, for lamp spacing)
vec2 vr_street(vec2 p){
  float k = floor((p.y - ${glf(SITE_CENTER[1] + 38)}) / ${GRID.GZ}. + .5), j = floor((p.x - ${glf(SITE_CENTER[0] + 60)}) / ${GRID.GX}. + .5);
  float dz = min(min(abs(p.y - vr_gz(k, p.x)), abs(p.y - vr_gz(k - 1., p.x))), abs(p.y - vr_gz(k + 1., p.x)));
  float dx = min(min(abs(p.x - vr_gx(j, p.y)), abs(p.x - vr_gx(j - 1., p.y))), abs(p.x - vr_gx(j + 1., p.y)));
  return dz < dx ? vec2(dz, p.x) : vec2(dx, p.y);
}
`;
// Smooth value noise (JS) for woods / parks: 0..1
function vnoise(x, z) {
  const h = (i, j) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return (h(i, j) * (1 - ux) + h(i + 1, j) * ux) * (1 - uz) + (h(i, j + 1) * (1 - ux) + h(i + 1, j + 1) * ux) * uz;
}
const woods = (x, z) => vnoise(x / 260, z / 260) * 0.65 + vnoise(x / 90 + 17, z / 90 + 5) * 0.35;

function computeLayout(low) {
  if (LAYOUT && LAYOUT.low === low) return LAYOUT;
  const rnd = mulberry32(4711);
  const [SX, SZ] = SITE_CENTER;
  // R_HOUSE: fully modelled houses (window shader, fences, garden trees); up to R_FAR: simple instanced houses
  const R_GRID = low ? 1350 : 1980, R_HOUSE = low ? 760 : 1180, R_FAR = R_GRID - 30;
  const occ = makeOcc(SX, SZ, R_GRID + 60);
  // blocked areas
  // (6 = the ground of a mid-rise estate: no houses, but trees between the blocks)
  for (const z of Z_MID) occ.fillPoly(z, 6);
  for (const z of Z_IND) occ.fillPoly(z, 7);
  for (const z of Z_GREEN) occ.fillPoly(z, 5);
  occ.fillPoly(offsetPolyXZ(SITE_PLOT, 4), 5);
  for (const h of HALLS) occ.fillPoly(offsetPolyXZ(h.poly, 5), 5);
  for (const b of CTX) occ.fillPoly(offsetPolyXZ(b.poly, b.kind === 'house' ? 6 : 4), 5);
  for (const e of EXTRAS) occ.fillPoly(offsetPolyXZ(e.poly, 2), 5);
  for (const m of MIDRISE) { const [ux, uz] = wDir(m.b); occ.mark(m.w[0], m.w[1], ux, uz, m.L / 2 + 4, m.W / 2 + 4, 5); }

  // ---- roads: the mapped streets + a generic grid beyond them, aligned with the local street pattern (world x / z)
  const roads = T_ROADS.map(r => ({ id: r.id, w: r.w, main: !!r.main, pts: r.pts, name: r.name, traced: true }));
  const tracedSegs = [];
  for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) tracedSegs.push([r.pts[i], r.pts[i + 1], r.w]);
  const nearParallelTraced = (x, z, dx, dz) => {
    for (const [a, b] of tracedSegs) {
      if (distSeg(x, z, a[0], a[1], b[0], b[1]) > 17) continue;
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
      if (Math.abs((ex * dx + ez * dz) / L) > 0.8) return true;
    }
    return false;
  };
  const inZone = (zs, x, z) => zs.some(p => inPoly(p, x, z));
  const gridOK = (x, z, dx, dz) => Math.hypot(x - SX, z - SZ) < R_GRID && !nearPoly(SITE_PLOT, x, z, 9) &&
    !inZone(Z_TRACED, x, z) && !inZone(Z_IND, x, z) && !inZone(Z_MID, x, z) && !inZone(Z_GREEN, x, z) &&
    !HALLS.some(h => nearPoly(h.poly, x, z, 8)) && !nearBuilding(x, z, 8) && !nearParallelTraced(x, z, dx, dz);
  const STEP = 12, { GZ, GX } = GRID;
  const gridLines = [];
  for (let k = -Math.ceil(R_GRID / GZ); k <= Math.ceil(R_GRID / GZ); k++) gridLines.push({ axis: 'x', c: s => gridZ(k, s) });
  for (let k = -Math.ceil(R_GRID / GX); k <= Math.ceil(R_GRID / GX); k++) gridLines.push({ axis: 'z', c: s => gridX(k, s) });
  for (const gl of gridLines) {
    let run = null;
    const flush = () => { if (run && run.length >= 4) roads.push({ id: 'grid', w: 6, pts: run, axis: gl.axis }); run = null; };
    for (let s = -R_GRID; s <= R_GRID; s += STEP) {
      const [ax, az] = gl.axis === 'x' ? [SX + s, gl.c(SX + s)] : [gl.c(SZ + s), SZ + s];
      const [bx, bz] = gl.axis === 'x' ? [ax + STEP, gl.c(ax + STEP)] : [gl.c(az + STEP), az + STEP];
      const ok = gridOK((ax + bx) / 2, (az + bz) / 2, gl.axis === 'x' ? 1 : 0, gl.axis === 'x' ? 0 : 1);
      if (ok) { if (!run) run = [[ax, az]]; run.push([bx, bz]); } else flush();
    }
    flush();
  }
  // mark roads + sidewalks
  for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    occ.mark(mx, mz, ux, uz, L / 2 + 1, r.w / 2 + 2.6, 4, true);
    occ.mark(mx, mz, ux, uz, L / 2 + 0.5, r.w / 2, 3);
  }

  // ---- lots + houses along the streets (walked by arc length, so lot widths never repeat with the road vertices)
  const lots = [], houses = [], gTrees = [], fences = [], farHouses = [], farTrees = [];
  const walls = ['#e6ddcc', '#ece4d4', '#dccfb8', '#efe9de', '#dcc7a3', '#d3cdc2', '#e8d7ba', '#e1dbd0', '#cfc1a6', '#eadcc3', '#d8cbb5', '#c9c3b8', '#e4d3b0', '#f0ebe2'];
  const roofsT = ['#8a4a37', '#7a4434', '#935640', '#6e3d30', '#9a5f48', '#85503e', '#5f3a2e', '#8f4a36', '#7c5040', '#6a4a3e'];
  const roofsG = ['#56585c', '#65676b', '#47494d', '#5d5550', '#4d5a66', '#3f4145', '#727477', '#6b5a4c', '#5a4a3e'];
  const yards = ['#4f5e33', '#56663a', '#5e6a3e', '#4a5a34', '#646a44', '#6e6c5a', '#7a776e', '#525e37', '#5a6440'];
  const houseOK = (x, z) => Math.hypot(x - SX, z - SZ) < R_FAR;
  const pick = (a, k) => a[k % a.length];
  // ---- sheds and small warehouses of the service / industrial zones (generic, like the houses: the layout only gives the zone)
  const sheds = [], shedRoofs = ['#8d9296', '#7a7f84', '#9a8f84', '#6f7477', '#a39f96', '#7d6a5c'];
  for (const zp of Z_IND) {
    const bb = bboxOf(zp);
    for (let x = bb.x0 + 14; x < bb.x1 - 10; x += 38) for (let z = bb.z0 + 12; z < bb.z1 - 8; z += 30) {
      const cx = x + (rnd() - 0.5) * 12, cz = z + (rnd() - 0.5) * 10, turn = rnd() < 0.35, len = 16 + rnd() * 22, wid = 8 + rnd() * 7, k = Math.floor(rnd() * 97);
      if (rnd() < 0.4 || !inPoly(zp, cx, cz) || nearPoly(SITE_PLOT, cx, cz, 20)) continue;
      const hu = (turn ? wid : len) / 2, hn = (turn ? len : wid) / 2;
      let ok = true;
      for (let a = -hu - 4; a <= hu + 4 && ok; a += 1.5) for (let b = -hn - 4; b <= hn + 4; b += 1.5) if (occ.at(cx + a, cz + b) !== 7) { ok = false; break; }
      if (!ok) continue;
      occ.mark(cx, cz, 1, 0, hu + 1.5, hn + 1.5, 5);
      sheds.push({ poly: [[cx - hu, cz - hn], [cx + hu, cz - hn], [cx + hu, cz + hn], [cx - hu, cz + hn]], h: 4.2 + (k % 7) * 0.5, roof: pick(shedRoofs, k), est: true });
    }
  }
  const placeAlong = (r, minFront) => {
    const P = r.pts, cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = cum[cum.length - 1];
    const at = s => {
      let i = 0; while (i < P.length - 2 && cum[i + 1] < s) i++;
      const l = cum[i + 1] - cum[i] || 1, f = (s - cum[i]) / l, ux = (P[i + 1][0] - P[i][0]) / l, uz = (P[i + 1][1] - P[i][1]) / l;
      return [P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f, ux, uz];
    };
    for (const side of [1, -1]) {
      let s = 2 + rnd() * 8;
      while (s < total - 4) {
        const fw = minFront - 1 + rnd() * 7.5;
        const sc = s + fw / 2;
        if (sc > total - 2) break;
        s += fw;
        const [px, pz, ux, uz] = at(sc), nx = -uz, nz = ux;
        const hw = Math.min(fw - 2.6, 6.5 + rnd() * 6.5), hd = 7 + rnd() * 6, fy = 1.8 + rnd() * rnd() * 9;
        const off = r.w / 2 + 2.6 + fy + hd / 2;
        const hx = px + nx * side * off, hz = pz + nz * side * off;
        if (!houseOK(hx, hz) || rnd() < 0.06) continue;
        const dc = Math.hypot(hx - SX, hz - SZ);
        if (dc > 320 && woods(hx, hz) > 0.64) continue;                      // pockets of woodland between the streets
        if (!occ.free(hx, hz, ux, uz, hw / 2 + 1.2, hd / 2 + 1.2, true)) continue;
        const ld = 24 + rnd() * 14, l0 = r.w / 2 + 2.6;
        occ.mark(px + nx * side * (l0 + ld / 2), pz + nz * side * (l0 + ld / 2), ux, uz, fw / 2 - 0.4, ld / 2 - 0.4, 2, true);
        occ.mark(hx, hz, ux, uz, hw / 2, hd / 2, 1);
        const k = Math.floor(rnd() * 1e6), yaw0 = Math.atan2(-uz * side, ux * side);
        const r1 = rnd(), fl = r1 < 0.38 ? 1 : r1 < 0.9 ? 2 : 3, grey = rnd() < 0.34, rt = rnd();
        const back = (b, l) => [px + nx * side * b + ux * l, pz + nz * side * b + uz * l];
        if (dc > R_HOUSE) {   // far belt: simple instanced house + one or two back-yard trees
          farHouses.push({ x: hx, z: hz, yaw: yaw0 + (rnd() - 0.5) * 0.12, w: hw, d: hd, h: fl * 2.85 + 0.4, turn: rnd() < 0.3, wall: pick(walls, k), roofC: grey ? pick(roofsG, k) : pick(roofsT, k), lit: rnd() });
          const nT = rnd() < 0.3 ? 2 : 1;
          for (let t = 0; t < nT; t++) farTrees.push([...back(off + hd / 2 + 3 + rnd() * 12, (rnd() - 0.5) * fw * 0.8), 0.8 + rnd() * 0.6]);
          continue;
        }
        lots.push({ x: px + nx * side * (l0 + ld / 2), z: pz + nz * side * (l0 + ld / 2), ux, uz, fw, ld, yard: pick(yards, k), drive: rnd() < 0.55 ? (rnd() < 0.5 ? -1 : 1) : 0, px, pz, side, hw, off });
        houses.push({ x: hx, z: hz, yaw: yaw0 + (rnd() - 0.5) * (rnd() < 0.2 ? 0.2 : 0.06), w: hw, d: hd, h: fl * 2.85 + 0.45,
          roof: rt < 0.48 ? 'gable' : rt < 0.93 ? 'hip' : 'flat', turn: rnd() < 0.25, wall: pick(walls, k), roofC: grey ? pick(roofsG, k) : pick(roofsT, k) });
        // side wing (L-shaped plans, garages, porches)
        if (rnd() < 0.32) {
          const sd = rnd() < 0.5 ? -1 : 1, w3 = 3.2 + rnd() * 3.2, d3 = hd * (0.55 + rnd() * 0.5), l3 = sd * (hw / 2 + w3 / 2 - 0.2), b3 = off + (rnd() - 0.3) * 2.5;
          const [wx, wz] = back(b3, l3);
          if (occ.free(wx, wz, ux, uz, w3 / 2 - 0.3, d3 / 2, true)) {
            occ.mark(wx, wz, ux, uz, w3 / 2, d3 / 2, 1);
            houses.push({ x: wx, z: wz, yaw: yaw0, w: w3, d: d3, h: 2.85 + 0.35, roof: rnd() < 0.35 ? 'flat' : 'hip', turn: rnd() < 0.5, wall: pick(walls, k + 5), roofC: grey ? pick(roofsG, k) : pick(roofsT, k) });
          }
        }
        // front fence, garden trees (front, side, back yard — the lots are leafy, as on the satellite view)
        if (rnd() < 0.85) fences.push({ x: px + nx * side * (l0 + 0.15), z: pz + nz * side * (l0 + 0.15), ux, uz, L: fw - 0.8, h: 1.1 + rnd() * 0.8, c: rnd() });
        if (rnd() < 0.6) gTrees.push([...back(l0 + 1.5 + rnd() * 2, (rnd() < 0.5 ? -1 : 1) * (fw / 2 - 2)), 0.6 + rnd() * 0.45]);
        const nb = 2 + Math.floor(rnd() * 3.5);
        for (let t = 0; t < nb; t++) gTrees.push([...back(off + hd / 2 + 2.5 + rnd() * (ld - hd - fy - 4), (rnd() - 0.5) * fw * 0.8), 0.7 + rnd() * 0.65]);
        // back-yard house / annex (the lots are long and densely built)
        if (rnd() < 0.45) {
          const w2 = Math.min(fw - 3, 5 + rnd() * 5), d2 = 5 + rnd() * 4, b2 = off + hd / 2 + 2.5 + rnd() * 5 + d2 / 2, l2 = (rnd() - 0.5) * (fw - w2 - 2);
          const [ax2, az2] = back(b2, l2);
          if (houseOK(ax2, az2) && occ.free(ax2, az2, ux, uz, w2 / 2 + 0.6, d2 / 2 + 0.6, true)) {
            occ.mark(ax2, az2, ux, uz, w2 / 2, d2 / 2, 1);
            const g2 = rnd() < 0.4, rt2 = rnd();
            houses.push({ x: ax2, z: az2, yaw: yaw0 + (rnd() - 0.5) * 0.1, w: w2, d: d2, h: (rnd() < 0.7 ? 1 : 2) * 2.85 + 0.35,
              roof: rt2 < 0.55 ? 'gable' : rt2 < 0.85 ? 'hip' : 'flat', turn: rnd() < 0.4, wall: pick(walls, k + 3), roofC: g2 ? pick(roofsG, k + 1) : pick(roofsT, k + 2) });
          }
        }
      }
    }
  };
  for (const r of roads) if (r.traced && !r.main) placeAlong(r, 10.5);
  for (const r of roads) if (r.axis === 'x') placeAlong(r, 11);
  for (const r of roads) if (r.traced && r.main) placeAlong(r, 13);
  for (const r of roads) if (r.axis === 'z') placeAlong(r, 11.5);

  // ---- woodland and leftover green: every free cell may carry a tree, far more likely inside the 'woods' field
  const wTrees = [];
  for (let x = SX - R_FAR; x < SX + R_FAR; x += 7.5) for (let z = SZ - R_FAR; z < SZ + R_FAR; z += 7.5) {
    const jx = x + (rnd() - 0.5) * 6, jz = z + (rnd() - 0.5) * 6, dc = Math.hypot(jx - SX, jz - SZ);
    if (dc > R_FAR || dc < 95) continue;
    const v = occ.at(jx, jz); if (v !== 0 && v !== 2 && v !== 6 && v !== 7) continue;
    if (dc < 150 && v !== 6) continue;
    const w = woods(jx, jz), p = v === 6 ? 0.2 : v === 7 ? 0.07 : v === 2 ? 0.05 : w > 0.64 ? 0.8 : w > 0.55 ? 0.3 : 0.05;
    if (rnd() > p || nearBuilding(jx, jz, 4)) continue;
    (dc > R_HOUSE ? farTrees : wTrees).push([jx, jz, 0.8 + rnd() * 0.6]);
  }

  // ---- street trees, lamps, city lights, parked cars along the streets
  // street trees and lamps: those of the layout where it has them (the traced streets), generated along the rest
  const sTrees = [], lights = [], kerbCars = [];
  const lamps = X_LAMPS ? X_LAMPS.map(l => [l.p[0], l.p[1], Math.atan2(l.dir[0], l.dir[1]), l.h / 9]) : [];
  for (const r of roads) {
    const genTrees = !(X_TREES && r.traced), genLamps = !(X_LAMPS && r.traced);
    let acc = rnd() * 20, lampAcc = rnd() * 30, lightAcc = rnd() * 30, carAcc = 0;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      for (let s = 0; s < L; s += 2) {
        const x = ax + ux * s, z = az + uz * s, dc = Math.hypot(x - SX, z - SZ);
        acc += 2; lampAcc += 2; lightAcc += 2; carAcc += 2;
        if (genTrees && (r.traced ? dc < 520 : dc < R_HOUSE) && acc > 11) {
          acc = 0;
          for (const sd of [1, -1]) {
            const tx = x + nx * sd * (r.w / 2 + 1.5), tz = z + nz * sd * (r.w / 2 + 1.5), v = occ.at(tx, tz);
            if ((v === 4 || v === 0 || v === 6 || v === 7 || (v === 5 && dc < 140)) && rnd() < (r.traced ? 0.72 : 0.3) && !inPoly(SITE_PLOT, tx, tz) && !nearBuilding(tx, tz, 3) && !roadsNear(roads, tx, tz, 0.6)) sTrees.push([tx, tz, 0.8 + rnd() * 0.35]);
          }
        }
        if (genLamps && dc < (r.traced ? 460 : 240) && lampAcc > 30) {
          lampAcc = 0; const sd = (Math.floor(s / 30) + i) % 2 ? 1 : -1;
          const lx = x + nx * sd * (r.w / 2 + 1.1), lz = z + nz * sd * (r.w / 2 + 1.1);
          if (occ.at(lx, lz) !== 1 && !nearBuilding(lx, lz, 2) && !roadsNear(roads, lx, lz, 0.2)) lamps.push([lx, lz, Math.atan2(-nx * sd, -nz * sd)]);
        } else if (lightAcc > 33) {
          lightAcc = 0; const sd = rnd() < 0.5 ? 1 : -1;
          lights.push([x + nx * sd * (r.w / 2 + 1), z + nz * sd * (r.w / 2 + 1)]);
        }
        if (r.traced && !r.main && dc < 330 && carAcc > 6.2) {
          carAcc = 0;
          if (rnd() < 0.3) { const sd = rnd() < 0.5 ? 1 : -1; const cx = x + nx * sd * (r.w / 2 - 1.1), cz = z + nz * sd * (r.w / 2 - 1.1); if (!nearPoly(SITE_PLOT, cx, cz, 2)) kerbCars.push([cx, cz, Math.atan2(-uz, ux) + (rnd() < 0.5 ? 0 : Math.PI)]); }
        }
      }
    }
  }
  // ---- park trees: the green areas of the layout (parks, squares)
  const pTrees = [];
  for (const zg of Z_GREEN) {
    const bb = bboxOf(zg), n = Math.min(low ? 120 : 320, Math.round((bb.x1 - bb.x0) * (bb.z1 - bb.z0) / 110));
    for (let i = 0; i < n; i++) {
      const x = bb.x0 + rnd() * (bb.x1 - bb.x0), z = bb.z0 + rnd() * (bb.z1 - bb.z0);
      if (inPoly(zg, x, z) && !roadsNear(roads, x, z, 5) && !nearBuilding(x, z, 4)) pTrees.push([x, z, 0.8 + rnd() * 0.5]);
    }
  }
  LAYOUT = { low, roads, lots, houses, sheds, gTrees, wTrees, fences, farHouses, farTrees, sTrees, lamps, lights, kerbCars, pTrees, R_GRID, R_HOUSE, R_FAR, occ };
  return LAYOUT;
}
function roadsNear(roads, x, z, m) {
  for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    if (Math.abs(a[0] - x) > 200 && Math.abs(b[0] - x) > 200) continue;
    if (distSeg(x, z, a[0], a[1], b[0], b[1]) < r.w / 2 + m) return true;
  }
  return false;
}
// Offset a simple polygon outward by d (miter via averaged edge normals; fine for the gentle plot / hall outlines)
function offsetPolyXZ(poly, d) {
  let a = 0; for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; a += x0 * z1 - x1 * z0; }
  const sg = a > 0 ? 1 : -1, n = poly.length;
  return poly.map((p, i) => {
    const q0 = poly[(i - 1 + n) % n], q1 = poly[(i + 1) % n];
    const e0 = [p[0] - q0[0], p[1] - q0[1]], e1 = [q1[0] - p[0], q1[1] - p[1]];
    const l0 = Math.hypot(...e0) || 1, l1 = Math.hypot(...e1) || 1;
    const n0 = [sg * e0[1] / l0, -sg * e0[0] / l0], n1 = [sg * e1[1] / l1, -sg * e1[0] / l1];
    const mx = n0[0] + n1[0], mz = n0[1] + n1[1], ml = Math.hypot(mx, mz) || 1, cos = (mx * n1[0] + mz * n1[1]) / ml;
    const k = d / Math.max(0.35, cos);
    return [p[0] + mx / ml * k, p[1] + mz / ml * k];
  });
}

function nearPath(x, z, m) {
  for (const [pts, w] of PATHS) for (let i = 0; i < pts.length - 1; i++) if (distSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < w / 2 + m) return true;
  for (const p of CY_PATHS) if (nearBoxed(p, x, z, m)) return true;
  for (const p of CY_DRIVES) if (nearBoxed(p, x, z, m)) return true;
  if (RING) { const d = Math.hypot(x - YARD.x, z - YARD.z); if (d > RING.r0 - m && d < RING.r1 + m) return true; }
  return PLAZAS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + m);
}
// playground circles, terraces, steps, ramps: nothing is planted there
function onHardscape(x, z, m) {
  for (const c of CY_CIRCLES) if (Math.hypot(x - c.c[0], z - c.c[1]) < c.r + m) return true;
  for (const p of CY_HARD) if (nearBoxed(p, x, z, m)) return true;
  for (const r of RAMP_LIST) if (x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m) return true;
  return false;
}
// nearest point of a polyline to (x, z): { x, z, ux, uz, d }
function projectOnLine(pts, x, z) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; if (L2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { x: px, z: pz, ux: dx / L, uz: dz / L, d }; }
  }
  return best;
}
// crossings and T-junctions of the named streets within `rMax` of the site: [{ x, z, a, b, ua: [ux, uz], ub }]
function junctionsOf(roads, rMax) {
  const out = [], near = (x, z) => Math.hypot(x - SITE_CENTER[0], z - SITE_CENTER[1]) < rMax;
  const add = (x, z, a, b) => {
    if (!near(x, z) || out.some(j => Math.hypot(j.x - x, j.z - z) < 14)) return;
    const pa = projectOnLine(a.pts, x, z), pb = projectOnLine(b.pts, x, z); if (!pa || !pb) return;
    if (Math.abs(pa.ux * pb.ux + pa.uz * pb.uz) > 0.94) return;               // the same street continuing under another id
    out.push({ x, z, a, b, ua: [pa.ux, pa.uz], ub: [pb.ux, pb.uz] });
  };
  const R = roads.filter(r => r.traced && r.name);
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j]; if (a.name === b.name) continue;
    for (let p = 0; p < a.pts.length - 1; p++) for (let q = 0; q < b.pts.length - 1; q++) {
      const [x1, z1] = a.pts[p], [x2, z2] = a.pts[p + 1], [x3, z3] = b.pts[q], [x4, z4] = b.pts[q + 1];
      if (!near(x1, z1) && !near(x2, z2)) continue;
      const den = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3); if (Math.abs(den) < 1e-9) continue;
      const t = ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / den, u = ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) add(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, a, b);
    }
    for (const [s, o] of [[a, b], [b, a]]) for (const e of [s.pts[0], s.pts[s.pts.length - 1]]) {   // T-junctions
      const pr = projectOnLine(o.pts, e[0], e[1]); if (pr && pr.d < o.w / 2 + 4) add(pr.x, pr.z, a, b);
    }
  }
  return out;
}

// ================================================================== createEnvironment
export function createEnvironment(scene, renderer, opts = {}) {
  const mode0 = opts.mode || 'dusk';
  const shadows = opts.shadows ?? !!(renderer && renderer.shadowMap && renderer.shadowMap.enabled);
  const group = new THREE.Group(); group.name = 'vrc-environment';
  const disposables = [];
  const rnd = mulberry32(20260929);
  const nightOnly = [];      // objects visible only at dusk/night
  const tickers = [];        // per-frame updaters
  const treeSets = [];
  let L;
  try { L = computeLayout(LOW); }
  catch (e) { console.warn('[env] layout failed with site-layout.js data, using the inline minimal layout', e); useLayout(fallbackLayout()); L = computeLayout(LOW); }
  let parkedCars = [], nightU = null, hillU = null, signMat = null;
  const _v2 = new THREE.Vector2();
  // One failing builder must never take the whole environment (or the page) down.
  const safe = (name, fn) => { try { return fn(); } catch (e) { console.warn(`[env] ${name} skipped:`, e); return null; } };
  const JUNCTIONS = safe('junctions', () => junctionsOf(L.roads, 420)) || [];
  // The inline fallback for context.js lives in its own group so it can be dropped when the module takes over.
  const ctxG = new THREE.Group(); ctxG.name = 'env-inline-context';
  group.add(ctxG);
  let tgt = group;                                   // where the builders below add their meshes
  const within = (g, fn) => { const prev = tgt; tgt = g; try { return fn(); } finally { tgt = prev; } };
  const ext = { context: null };
  let mode = null, disposed = false;
  let cityCtl = null;                                // the real city (V8-city), see below
  const makeExt = (key, mod) => {
    if (!mod) return null;
    try {
      // T32: the two streets that frame the plot get context.js' lane-true traffic (it keeps clear of the kerb-parked cars);
      // buildTraffic() below takes its own cars off those streets as soon as that traffic is running.
      const inst = mod.createContext({ shadows, lowDetail: LOW, traffic: true });
      if (!inst || !inst.group) throw new Error('no group');
      group.add(inst.group);
      if (mode) inst.setMode && inst.setMode(mode);
      return inst;
    } catch (e) { console.warn(`[env] ${key}.js failed, using the inline version`, e); return null; }
  };
  const useMods = opts.modules !== false;           // opts.modules=false forces the inline versions (debugging)
  if (MODS && useMods) ext.context = makeExt('context', MODS.context);

  // ---------------- lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5); group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.target.position.set(SITE_CENTER[0], 0, SITE_CENTER[1] + 8);
  group.add(sun, sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
    const sc = sun.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 10; sc.far = 1400;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
  }

  // ---------------- sky
  const SKYU = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: C('#000') }, uHorizon: { value: C('#000') },
    uHorizonSun: { value: C('#000') }, uGroundCol: { value: C('#000') }, uSunCol: { value: C('#fff') },
    uSunGlow: { value: 1 }, uSunDisc: { value: 0.9998 }, uCityGlow: { value: C('#000') },
    uBand: { value: C('#000') }, uFogCol: { value: C('#000') }, uHaze: { value: 0 },
  };
  const skyDetailU = { ...SKYU, uClouds: { value: 0.3 }, uCloudLit: { value: C('#fff') }, uCloudShade: { value: C('#888') }, uStars: { value: 0 }, uTime: SHARED.uTime,
    uStreaks: { value: 0 }, uStreakLit: { value: C('#fff') }, uStreakShade: { value: C('#888') } };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyDetailU, vertexShader: SKY_VS, fragmentShader: '#define DETAIL\n' + GLSL_NOISE + GLSL_SKY + GLSL_SKY_MAIN,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMat);
  dome.frustumCulled = false; dome.renderOrder = -1e6; dome.name = 'sky';
  group.add(dome);
  const envScene = new THREE.Scene();
  const envSkyMat = new THREE.ShaderMaterial({
    uniforms: { ...SKYU, uClouds: { value: 0 }, uCloudLit: { value: C('#fff') }, uCloudShade: { value: C('#fff') }, uStars: { value: 0 }, uTime: SHARED.uTime, uStreaks: { value: 0 }, uStreakLit: { value: C('#fff') }, uStreakShade: { value: C('#fff') } },
    vertexShader: SKY_VS, fragmentShader: GLSL_NOISE + GLSL_SKY + GLSL_SKY_MAIN, side: THREE.BackSide, depthWrite: false,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envSkyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCache = {};

  // ---------------- ground, neighbourhood carpet, site plan, street strips
  {
    const g = new THREE.CircleGeometry(9000, 64); g.rotateX(-Math.PI / 2); g.translate(SITE_CENTER[0], -0.1, SITE_CENTER[1]);
    const ground = new THREE.Mesh(g, registerMaterial(groundMaterial(L.R_HOUSE + 60, L.R_FAR - 80)));
    ground.receiveShadow = shadows; ground.name = 'ground';
    group.add(ground);
  }
  safe('carpet', buildCarpet);
  safe('site plan', () => group.add(buildSitePlan()));
  safe('road strips', buildRoadStrips);

  // ---------------- objects
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', emissive: C('#ffc88a'), emissiveIntensity: 0, roughness: 0.4 });
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTex(0.05), color: C('#ffb467'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  disposables.push(poolMat.map);
  const poolsBy = new Map();   // group → [[x, z, radius]]
  const addPool = (x, z, r) => { if (!poolsBy.has(tgt)) poolsBy.set(tgt, []); poolsBy.get(tgt).push([x, z, r]); };
  safe('site objects', buildSiteObjects);
  safe('street signs', buildStreetSigns);
  if (!ext.context) safe('context', () => within(ctxG, buildContext));
  safe('neighbourhood', buildNeighbourhood);
  safe('skyline', buildSkyline);
  safe('hills', buildHills);
  safe('traffic', buildTraffic);
  safe('night lights', buildNightLights);
  safe('trees', buildDeferred);

  // A module that arrives after this call replaces its inline fallback.
  const dropGroup = g => {
    group.remove(g);
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  };
  const ready = MODS || !useMods ? Promise.resolve() : MODS_P.then(m => {
    if (disposed) return;
    if (!ext.context && (ext.context = makeExt('context', m.context))) dropGroup(ctxG);
  });
  if (ext.context) group.remove(ctxG);

  // ---------------- mode
  function setMode(m) {
    m = MODES[m] ? m : 'dusk'; mode = m; SHARED.mode = m;
    const P = MODES[m];
    const el = THREE.MathUtils.degToRad(P.sunEl), az = THREE.MathUtils.degToRad(WAZ(P.sunAz));   // sunAz = true bearing
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    SKYU.uSunDir.value.copy(dir);
    SKYU.uZenith.value.set(P.zenith); SKYU.uHorizon.value.set(P.horizon); SKYU.uHorizonSun.value.set(P.horizonSun);
    SKYU.uGroundCol.value.set(P.ground); SKYU.uSunCol.value.set(P.sunCol); SKYU.uSunGlow.value = P.sunGlow; SKYU.uSunDisc.value = P.disc;
    SKYU.uCityGlow.value.set(P.city); SKYU.uBand.value.set(P.band); SKYU.uFogCol.value.set(P.fog); SKYU.uHaze.value = P.haze;
    skyDetailU.uClouds.value = P.clouds; skyDetailU.uCloudLit.value.set(P.cloudLit); skyDetailU.uCloudShade.value.set(P.cloudShade); skyDetailU.uStars.value = P.stars;
    skyDetailU.uStreaks.value = P.streaks || 0; skyDetailU.uStreakLit.value.set(P.streakLit || '#fff'); skyDetailU.uStreakShade.value.set(P.streakShade || '#888');
    const ld = dir.clone(); if (ld.y < 0.2) { ld.y = 0.2; ld.normalize(); }
    sun.position.copy(sun.target.position).addScaledVector(ld, 700);
    sun.color.set(P.sunCol); sun.intensity = P.sunI;
    hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGnd); hemi.intensity = P.hemiI;
    scene.fog = new THREE.FogExp2(C(P.fog), P.fogD);
    scene.background = C(P.fog);
    SHARED.uGlow.value = P.glow; SHARED.uLit.value = P.lit; SHARED.uNight.value = P.night;
    if (!envCache[m]) envCache[m] = pmrem.fromScene(envScene, 0.02).texture;
    scene.environment = envCache[m];
    SHARED.envMap = envCache[m]; SHARED.envIntensity = P.env;
    for (const mm of SHARED.mats) applyEnv(mm);
    for (const o of nightOnly) o.visible = P.night > 0;
    lampHeadMat.emissiveIntensity = P.night * 3.5;
    if (nightU) { nightU.uI.value = P.lights; nightU.uFogD.value = P.fogD; }
    if (hillU) { hillU.uHill.value.set(P.hill); hillU.uHillK.value = P.hillK; }
    if (signMat) signMat.emissiveIntensity = P.night * 0.35;
    poolMat.opacity = P.night > 0 ? 0.75 * P.night + 0.1 : 0;
    if (ext.context && ext.context.setMode) { try { ext.context.setMode(m); } catch (err) { console.warn(err); } }
    if (cityCtl && cityCtl.api) cityCtl.api.setMode(m);
  }
  setMode(mode0);
  scene.add(group);

  function update(dt, camera) {
    dt = Math.min(dt || 0, 0.1);
    SHARED.uTime.value += dt;
    if (camera) dome.position.copy(camera.position);
    if (nightU && renderer) nightU.uViewH.value = renderer.getDrawingBufferSize(_v2).y;
    for (const f of tickers) f(dt, camera);
    if (ext.context && ext.context.update) ext.context.update(dt, camera);
    if (!cityCtl) return;
    if (cityCtl.api) cityCtl.api.update(dt, camera);
    if (camera && cityCtl.auto && (!cityCtl.promise || cityCtl.detail === 'far') && camera.position.y < 8 && camera.position.y > -1 && !inPoly(SITE_PLOT, camera.position.x, camera.position.z)) cityCtl.enable();
  }

  function dispose() {
    disposed = true;
    if (cityCtl && cityCtl.api) { try { cityCtl.api.dispose(); } catch (err) { console.warn(err); } cityCtl.api = null; cityCtl.active = false; }
    if (attrEl) { attrEl.remove(); attrEl = null; }
    if (ext.context) { const e = ext.context; if (e.dispose) { try { e.dispose(); } catch (err) { console.warn(err); } } if (e.group) group.remove(e.group); }
    scene.remove(group);
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) { if (m.map) m.map.dispose(); SHARED.mats.delete(m); m.dispose(); }
    });
    for (const t of disposables) t.dispose && t.dispose();
    for (const k of Object.keys(envCache)) envCache[k].dispose();
    envSkyMat.dispose(); pmrem.dispose();
    if (Object.values(envCache).includes(scene.environment)) scene.environment = null;
    if (SHARED.envMap && Object.values(envCache).includes(SHARED.envMap)) SHARED.envMap = null;
    scene.fog = null; scene.background = null;
  }

  // ---------------- the real city (V8-city): OpenStreetMap streets, buildings, river … beyond the near-plot rectangle.
  // Never built (nor downloaded) for the hero / panorama / plain walkthrough scene. It starts on city.enable() — drive.js calls it
  // when the visitor gets into a car — or, only with opts.city === 'auto', the first time update() sees the camera at street level outside the plot. One way: the generic belt of this module is hidden for good.
  cityCtl = { active: false, api: null, promise: null, auto: opts.city === 'auto', error: null,
    enable(o = {}) {                                 // o.detail: 'far' = building volumes only (balcony views); a later enable() without it upgrades to full detail
      const want = o.detail === 'far' ? 'far' : 'full';
      if (cityCtl.promise) { if (want === 'full') { cityCtl.detail = 'full'; if (cityCtl.api) cityCtl.api.setDetail('full'); } return cityCtl.promise; }
      cityCtl.detail = want;
      cityCtl.promise = import('./city.js').then(m => m.createCity(scene, { mode, quality: opts.cityQuality, detail: want })).then(api => {
        api.setDetail(cityCtl.detail);
        if (disposed) { api.dispose(); return null; }
        cityCtl.api = api; cityCtl.active = true; hideBeltForCity(); api.setMode(mode); showAttribution();
        return api;
      }).catch(e => { cityCtl.error = e; console.warn('[env] city failed to load — the generic neighbourhood stays', e); return null; });
      return cityCtl.promise;
    } };
  const HIDE_FOR_CITY = new Set(['carpet', 'road-strips', 'houses', 'blocks', 'far-houses', 'skyline', 'ground']);
  function hideBeltForCity() {
    const S = SITE, m = 6, out = (x, z) => x < S.x0 - m || x > S.x1 + m || z < S.z0 - m || z > S.z1 + m;
    const M4 = new THREE.Matrix4(), P = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    const visit = o => {
      if (o.name === 'vrc-city' || o.name === 'traffic' || (ext.context && o === ext.context.group)) return;
      if (HIDE_FOR_CITY.has(o.name)) { o.visible = false; o.userData.cityHidden = true; return; }
      if (o.isInstancedMesh) { let hid = 0; for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M4); P.setFromMatrixPosition(M4).applyMatrix4(o.matrixWorld); if (out(P.x, P.z)) { o.setMatrixAt(i, ZERO); hid++; } } if (hid) { o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere && o.computeBoundingSphere(); } return; }
      if (o.isMesh && o.geometry && !['sky', 'hills', 'site-plan', 'night-lights', 'street-signs', 'site-furniture'].includes(o.name)) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; if (b && (b.max.x < S.x0 - m || b.min.x > S.x1 + m || b.max.z < S.z0 - m || b.min.z > S.z1 + m)) { o.visible = false; o.userData.cityHidden = true; } }
      for (const c of o.children) visit(c);
    };
    group.updateMatrixWorld(true); for (const c of group.children) visit(c);
    for (let i = nightOnly.length - 1; i >= 0; i--) if (nightOnly[i].userData.cityHidden) nightOnly.splice(i, 1);
  }
  let attrEl = null;
  function showAttribution() {
    const host = renderer && renderer.domElement && renderer.domElement.parentElement; if (!host || attrEl || typeof document === 'undefined') return;
    attrEl = document.createElement('a'); attrEl.className = 'vrc-osm-attribution'; attrEl.href = 'https://www.openstreetmap.org/copyright'; attrEl.target = '_blank'; attrEl.rel = 'noopener';
    attrEl.textContent = '© OpenStreetMap contributors'; attrEl.dir = 'ltr';
    attrEl.style.cssText = 'position:absolute;right:6px;bottom:4px;z-index:5;font:10px/1.2 Arial,sans-serif;color:rgba(255,255,255,.82);background:rgba(0,0,0,.38);padding:2px 6px;border-radius:3px;text-decoration:none;pointer-events:auto';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(attrEl);
  }

  // ready: resolves once context.js has been tried (stills wait for it); modules: the live instances;
  // layout: 'site-layout' | 'inline' (which layout data the environment was built from)
  return { group, sun, hemi, setMode, update, dispose, ready, modules: ext, layout: LAYOUT_SRC, get mode() { return mode; }, city: cityCtl };

  // ================================================================ painting helpers (world units on a canvas)
  function polyPath(g, pts, close = true) { g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z)); if (close) g.closePath(); }
  function noisePattern(g, base, dark, light, n = 900, size = 64) {
    const c = document.createElement('canvas'); c.width = c.height = size; const q = c.getContext('2d');
    q.fillStyle = base; q.fillRect(0, 0, size, size);
    const rr = mulberry32(size + n);
    for (let i = 0; i < n; i++) { q.fillStyle = rr() < 0.5 ? dark : light; q.fillRect(rr() * size, rr() * size, 1 + rr(), 1 + rr()); }
    return g.createPattern(c, 'repeat');
  }
  // service / industrial zone: worn asphalt and concrete yards with patches of rough grass (same seeds on both canvases)
  function paintYardZone(g, poly) {
    const bb = bboxOf(poly), rr = mulberry32((Math.round(bb.x0 * 3 + bb.z0 * 7) | 0) || 5), W = bb.x1 - bb.x0, H = bb.z1 - bb.z0;
    // T32: a large zone is the unused land north-west of the plot (plans p.3 / p.20: open field with scrub, a few sheds and
    // old hard-standings) — a dry meadow with some concrete pads; a small one is a paved court. From above the former
    // all-grey version with big random rectangles read as an unfinished area.
    const field = W * H > 20000;
    const tones = field ? ['#8f8b7e', '#7d7a70', '#5f6b42', '#66703f', '#55623a', '#6a7446', '#857c63', '#5a6a3c', '#74794f', '#7f7a62']
      : ['#5c5c5f', '#6c6a66', '#9a968c', '#a5a096', '#5f6b42', '#66703f', '#77735f', '#55623a'];
    const hard = field ? k => k < 2 : k => !(k === 4 || k === 5 || k === 7);
    g.save(); polyPath(g, poly); g.clip();
    g.fillStyle = field ? '#6f7450' : '#84817a'; g.fillRect(bb.x0, bb.z0, W, H);
    for (let i = 0, n = Math.round(W * H / (field ? 260 : 380)); i < n; i++) {
      const x = bb.x0 + rr() * W, z = bb.z0 + rr() * H, w = 12 + rr() * 44, d = 10 + rr() * 32, k = Math.floor(rr() * tones.length), a = rr() * 3;
      g.fillStyle = tones[k];
      if (!hard(k)) {   // rough grass / bare earth: a cluster of small soft blobs
        g.globalAlpha = 0.3 + rr() * 0.25;
        for (let j = 0; j < 7; j++) { g.beginPath(); g.ellipse(x + (rr() - 0.5) * w * 0.8, z + (rr() - 0.5) * d * 0.8, 3 + rr() * w * 0.22, 2.5 + rr() * d * 0.2, a + rr(), 0, TAU); g.fill(); }
      } else if (field) { g.globalAlpha = 0.35 + rr() * 0.3; g.fillRect(x - w * 0.3, z - d * 0.3, w * 0.6, d * 0.6); }
      else { g.globalAlpha = 0.4 + rr() * 0.4; g.fillRect(x - w / 2, z - d / 2, w, d); }
    }
    g.globalAlpha = 1; g.restore();
  }
  // parking courts / forecourts of the layout: asphalt, bay lines; green patches (verges, islands, pitches)
  function paintPockets(g, asphalt, lines) {
    for (const q of X_POCKETS) {
      g.fillStyle = asphalt; polyPath(g, q.poly); g.fill();
      if (!lines) continue;
      g.strokeStyle = 'rgba(236,236,230,0.8)'; g.lineWidth = 0.12;
      for (const r of q.rows) {
        const dx = (r.to[0] - r.from[0]) / r.n, dz = (r.to[1] - r.from[1]) / r.n, dl = Math.hypot(r.dir[0], r.dir[1]) || 1, ex = r.dir[0] / dl * r.bay[1], ez = r.dir[1] / dl * r.bay[1];
        for (let i = 0; i <= r.n; i++) { const x = r.from[0] + dx * i, z = r.from[1] + dz * i; g.beginPath(); g.moveTo(x, z); g.lineTo(x + ex, z + ez); g.stroke(); }
      }
    }
  }
  function paintGreen(g, fine) {
    for (const q of X_GREEN) {
      g.fillStyle = q.kind === 'pitch' ? '#5f8238' : '#4f6a2d'; polyPath(g, q.poly); g.fill();
      if (fine) { g.strokeStyle = q.kind === 'pitch' ? 'rgba(240,240,235,0.7)' : 'rgba(205,200,186,0.9)'; g.lineWidth = q.kind === 'pitch' ? 0.5 : 0.2; g.stroke(); }
    }
  }
  function paintLots(g, detail) {
    for (const l of L.lots) {
      const { x, z, ux, uz, fw, ld } = l, nx = -uz, nz = ux, hu = fw / 2, hn = ld / 2;
      const c = [[x - ux * hu - nx * hn, z - uz * hu - nz * hn], [x + ux * hu - nx * hn, z + uz * hu - nz * hn], [x + ux * hu + nx * hn, z + uz * hu + nz * hn], [x - ux * hu + nx * hn, z - uz * hu + nz * hn]];
      g.fillStyle = l.yard; polyPath(g, c); g.fill();
      if (detail) { g.strokeStyle = 'rgba(225,220,205,0.55)'; g.lineWidth = 0.25; g.stroke(); }
      if (l.drive) {   // paved driveway from the street to the house side
        const s = l.side;
        const bx = l.px + ux * l.drive * (l.hw / 2 + 1.6), bz = l.pz + uz * l.drive * (l.hw / 2 + 1.6);
        const e = l.off + 2, w = 1.4;
        g.fillStyle = '#a8a39a';
        polyPath(g, [[bx + nx * s * 3 - ux * w, bz + nz * s * 3 - uz * w], [bx + nx * s * 3 + ux * w, bz + nz * s * 3 + uz * w], [bx + nx * s * e + ux * w, bz + nz * s * e + uz * w], [bx + nx * s * e - ux * w, bz + nz * s * e - uz * w]]); g.fill();
      }
    }
    // tree shadows / shrubs in the back yards (cheap texture detail)
    if (detail) {
      const rr = mulberry32(99);
      for (const [x, z, s] of L.gTrees) { g.fillStyle = rr() < 0.5 ? 'rgba(30,45,15,0.35)' : 'rgba(45,60,20,0.3)'; g.beginPath(); g.arc(x + 1, z + 1, 2.6 * s, 0, TAU); g.fill(); }
    }
  }
  function paintRoads(g, markings, ppm) {
    const strokeAll = (w, col, filter = () => true) => {
      g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const r of L.roads) { if (!filter(r)) continue; g.lineWidth = w(r); polyPath(g, r.pts, false); g.stroke(); }
    };
    strokeAll(r => r.w + 5.6, '#b9b3a8');                       // sidewalks
    strokeAll(r => r.w + 0.9, '#8d887f');                       // kerbs
    g.save(); g.fillStyle = noisePattern(g, '#2e2f33', 'rgba(0,0,0,0.25)', 'rgba(255,255,255,0.06)', 500, 32);
    g.strokeStyle = g.fillStyle;
    for (const r of L.roads) { g.lineWidth = r.w; polyPath(g, r.pts, false); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); }
    g.restore();
    if (!markings) return;
    g.strokeStyle = 'rgba(238,238,232,0.85)'; g.lineWidth = Math.max(0.14, 1.2 / ppm); g.lineCap = 'butt';
    g.setLineDash([3, 6]);
    for (const r of L.roads) if (r.w >= 7) { polyPath(g, r.pts, false); g.stroke(); }
    g.setLineDash([]);
    for (const r of L.roads) if (r.main) {   // edge lines
      for (const sd of [1, -1]) {
        const pts = r.pts.map((p, i) => { const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * sd * (r.w / 2 - 0.45), p[1] + dx / l * sd * (r.w / 2 - 0.45)]; });
        polyPath(g, pts, false); g.stroke();
      }
    }
  }

  // tiled paving as a canvas pattern (pxm pattern pixels per metre; tiles tw × th metres in running bond)
  function tilePattern(g, base, joint, tw = 1.2, th = 0.6, pxm = 20, seed = 5) {
    const w = Math.round(tw * pxm), h = Math.round(th * pxm * 2);
    const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d');
    q.fillStyle = base; q.fillRect(0, 0, w, h);
    const rr = mulberry32(seed);
    for (let i = 0; i < 60; i++) { q.fillStyle = rr() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.045)'; q.fillRect(rr() * w, rr() * h, 2 + rr() * 5, 2 + rr() * 3); }
    q.fillStyle = joint;
    q.fillRect(0, 0, w, 1); q.fillRect(0, h / 2, w, 1); q.fillRect(0, 0, 1, h / 2); q.fillRect(w / 2, h / 2, 1, h / 2);
    const p = g.createPattern(c, 'repeat');
    if (p && p.setTransform && typeof DOMMatrix === 'function') p.setTransform(new DOMMatrix().scale(1 / pxm)); else return base;
    return p;
  }

  // ================================================================ carpet: lots, yards, streets of the neighbourhood (low-res decal)
  function buildCarpet() {
    const RC = L.R_HOUSE + 90, ppm = LOW ? 0.8 : 1.05;
    const x0 = SITE_CENTER[0] - RC, z0 = SITE_CENTER[1] - RC, W = 2 * RC;
    const n = Math.round(W * ppm);
    const tex = canvasTex(n, n, g => {
      g.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -z0 * ppm);
      const fillP = (pts, c) => { g.fillStyle = c; polyPath(g, pts); g.fill(); };
      for (const z of Z_GREEN) fillP(z, '#56692f');                    // parks
      for (const z of Z_IND) paintYardZone(g, z);                      // service / industrial yards
      for (const z of Z_MID) fillP(z, '#62703f');                      // the green courtyards of the apartment estates
      for (const h of HALLS) fillP(offsetPolyXZ(h.poly, 6), '#7d7a73');
      for (const m of MIDRISE) { const [ux, uz] = wDir(m.b), hu = m.L / 2 + 5, hn = m.W / 2 + 5, [cx, cz] = m.w; fillP([[cx - ux * hu + uz * hn, cz - uz * hu - ux * hn], [cx + ux * hu + uz * hn, cz + uz * hu - ux * hn], [cx + ux * hu - uz * hn, cz + uz * hu + ux * hn], [cx - ux * hu - uz * hn, cz - uz * hu + ux * hn]], '#8d897f'); }
      for (const b of CTX) fillP(offsetPolyXZ(b.poly, b.kind === 'house' ? 6 : 4), b.kind === 'house' ? '#58663a' : '#8d897f');
      paintLots(g, false);
      paintPockets(g, '#3a3b3f', false); paintGreen(g, false);
      paintRoads(g, false, ppm);
      // cut the site-plan rect (it has its own surface)
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(SITE.x0 + 0.5, SITE.z0 + 0.5, SITE.x1 - SITE.x0 - 1, SITE.z1 - SITE.z0 - 1);
      g.globalCompositeOperation = 'source-over';
    }, { aniso: 8 });
    disposables.push(tex);
    const geo = new THREE.PlaneGeometry(W, W); geo.rotateX(-Math.PI / 2); geo.translate(SITE_CENTER[0], -0.06, SITE_CENTER[1]);
    const mat = stdMat({ map: tex, roughness: 0.95, alphaTest: 0.5, envBase: 0.3 });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvSW = (modelMatrix * vec4(position,1.)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vSW;\n' + GLSL_NOISE)
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= .84 + .3 * vr_noise(vSW * 1.7) * vr_noise(vSW * .23 + 3.);');
    };
    mat.customProgramCacheKey = () => 'vr-carpet';
    registerMaterial(mat);
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = shadows; mesh.name = 'carpet';
    group.add(mesh);
  }

  // ================================================================ site plan (the plot, its courtyard, the adjacent streets and neighbours' ground)
  function buildSitePlan() {
    const W = SITE.x1 - SITE.x0, H = SITE.z1 - SITE.z0;
    const ppm = Math.min(LOW ? 4 : 6.5, (LOW ? 2048 : 4096) / Math.max(W, H));
    const cw = Math.round(W * ppm), ch = Math.round(H * ppm);
    const bays = [];
    const tex = canvasTex(cw, ch, g => {
      g.setTransform(ppm, 0, 0, ppm, -SITE.x0 * ppm, -SITE.z0 * ppm);
      const R = (x0, x1, z0, z1, c) => { g.fillStyle = c; g.fillRect(x0, z0, x1 - x0, z1 - z0); };
      const fillP = (pts, c) => { g.fillStyle = c; polyPath(g, pts); g.fill(); };
      // a polygon grown by d (round corners): fill + stroke of width 2d
      const grown = (pts, d, c) => { g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 2 * d; g.lineJoin = 'round'; polyPath(g, pts); g.fill(); g.stroke(); };
      const disc = (x, z, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, z, r, 0, TAU); g.fill(); };
      const asphalt = noisePattern(g, '#3a3b3f', 'rgba(0,0,0,0.2)', 'rgba(255,255,255,0.05)', 300, 32);
      const pave = tilePattern(g, '#c9bfae', 'rgba(80,70,55,0.22)', 1.2, 0.6, 20, 5);          // warm stone pavers (pavements, aprons)
      const paveLight = tilePattern(g, '#dcd3c2', 'rgba(110,98,80,0.2)', 0.8, 0.4, 20, 7);     // courtyard paths
      const paveDrive = tilePattern(g, '#8d8982', 'rgba(40,38,34,0.25)', 0.4, 0.2, 20, 9);     // driveways (small grey setts)
      const deck = tilePattern(g, '#9b7653', 'rgba(50,30,15,0.35)', 2.4, 0.14, 20, 11);        // timber terraces
      const lawnPat = noisePattern(g, '#4f6a2b', 'rgba(20,40,5,0.16)', 'rgba(170,190,90,0.08)', 600, 40);

      // ---- neighbourhood: grass base, zones, house lots
      g.fillStyle = noisePattern(g, '#4e5c35', 'rgba(20,35,10,0.22)', 'rgba(170,180,100,0.08)', 900, 48); g.fillRect(SITE.x0, SITE.z0, W, H);
      for (const z of Z_GREEN) fillP(z, '#56692f');
      for (const z of Z_IND) paintYardZone(g, z);
      for (const z of Z_MID) fillP(z, '#5e6c3c');
      paintLots(g, true);
      // ---- neighbours' ground: paved forecourts (site extras with no height), yards of the private houses, aprons of the rest
      for (const e of EXTRAS) if (!(e.h > 0)) fillP(e.poly, asphalt);
      for (const h of HALLS) grown(h.poly, 5, '#7d7a73');
      for (const m of MIDRISE) { const [ux, uz] = wDir(m.b), hu = m.L / 2 + 4, hn = m.W / 2 + 4, [cx, cz] = m.w; fillP([[cx - ux * hu + uz * hn, cz - uz * hu - ux * hn], [cx + ux * hu + uz * hn, cz + uz * hu - ux * hn], [cx + ux * hu - uz * hn, cz + uz * hu + ux * hn], [cx - ux * hu - uz * hn, cz - uz * hu + ux * hn]], '#8d897f'); }
      for (const b of CTX) {
        if (b.kind === 'house') { grown(b.poly, 6, '#58663a'); g.strokeStyle = 'rgba(225,220,205,0.5)'; g.lineWidth = 0.25; polyPath(g, offsetPolyXZ(b.poly, 6)); g.stroke(); grown(b.poly, 1, '#a39d92'); }
        else if (b.kind === 'fuel' || b.kind === 'canopy') grown(b.poly, 3.5, asphalt);
        else grown(b.poly, b.floors >= 5 ? 5 : b.kind === 'pavilion' ? 1.5 : 3, b.floors >= 5 ? '#99948a' : '#a39d92');
      }

      paintPockets(g, asphalt, true);
      // ---- the pavement belt round the plot (between the red line and the kerbs)
      grown(SITE_PLOT, 5, pave);
      paintGreen(g, true);
      // vehicle entrances: an asphalt link from the gate to the nearest street
      const mains = L.roads.filter(r => r.traced);
      for (const e of arr(CY.entrances)) {
        if (!e || e.kind !== 'vehicle' || !isPt(e.p)) continue;
        let best = null; for (const r of mains) { const p = projectOnLine(r.pts, e.p[0], e.p[1]); if (p && (!best || p.d < best.d)) best = p; }
        if (!best || best.d > 40) continue;
        g.strokeStyle = paveDrive; g.lineWidth = 6.5; g.lineCap = 'butt'; g.beginPath(); g.moveTo(e.p[0], e.p[1]); g.lineTo(best.x, best.z); g.stroke();
      }

      // ---- the plot: lawn base, driveways, aprons, lawns, paths, the ring, playgrounds, terraces, steps, ramps
      g.save(); polyPath(g, SITE_PLOT); g.clip();
      g.fillStyle = lawnPat; g.fillRect(SITE.x0, SITE.z0, W, H);
      for (const d of CY_DRIVES) fillP(d.poly, paveDrive);
      for (const p of [...BLD_BASE, ...POD_POLYS]) grown(p.poly, 2.4, pave);
      // lawns of the layout: mowing stripes + a light kerb
      const lawn = (x0, x1, z0, z1, r) => {
        g.save(); g.beginPath(); g.roundRect(x0, z0, x1 - x0, z1 - z0, r); g.clip();
        R(x0, x1, z0, z1, '#4d6a2c');
        for (let x = x0; x < x1; x += 3) R(x, x + 1.5, z0, z1, 'rgba(120,150,70,0.10)');
        const rr = mulberry32(Math.round(x0 * 7 + z0));
        for (let i = 0; i < (x1 - x0) * (z1 - z0) * 0.8; i++) { g.fillStyle = rr() < 0.5 ? 'rgba(20,40,5,0.10)' : 'rgba(170,190,90,0.07)'; g.fillRect(x0 + rr() * (x1 - x0), z0 + rr() * (z1 - z0), 0.5 + rr(), 0.5 + rr()); }
        g.restore();
        g.strokeStyle = 'rgba(210,205,190,0.9)'; g.lineWidth = 0.18; g.beginPath(); g.roundRect(x0, z0, x1 - x0, z1 - z0, r); g.stroke();
      };
      for (const l of LAWNS) lawn(...l);
      // the central ring: paved annulus round a lawn disc
      if (RING) {
        disc(YARD.x, YARD.z, RING.r1, paveLight);
        g.strokeStyle = 'rgba(120,105,85,0.35)'; g.lineWidth = 0.06;
        for (let r = RING.r0 + 0.6; r < RING.r1; r += 0.6) { g.beginPath(); g.arc(YARD.x, YARD.z, r, 0, TAU); g.stroke(); }
        g.strokeStyle = 'rgba(120,110,95,0.6)'; g.lineWidth = 0.2; g.beginPath(); g.arc(YARD.x, YARD.z, RING.r1, 0, TAU); g.stroke();
      }
      // paths: the drawn outlines of data.js COURTYARD + the centre lines of the layout
      for (const p of CY_PATHS) { fillP(p.poly, paveLight); g.strokeStyle = 'rgba(120,110,95,0.5)'; g.lineWidth = 0.15; g.stroke(); }
      for (const [pts, w] of PATHS) {
        const m = pts[pts.length >> 1]; if (CY_PATHS.some(p => nearBoxed(p, m[0], m[1], 0.3))) continue;   // already painted from its outline
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = 'rgba(120,110,95,0.5)'; g.lineWidth = w + 0.3; polyPath(g, pts, false); g.stroke(); g.strokeStyle = paveLight; g.lineWidth = w; g.stroke();
      }
      if (RING) { disc(YARD.x, YARD.z, RING.r0, '#4d6a2c'); g.strokeStyle = '#b7ae9d'; g.lineWidth = 0.3; g.beginPath(); g.arc(YARD.x, YARD.z, RING.r0, 0, TAU); g.stroke(); }
      for (const [x, z, r] of PLAZAS) {
        if (RING && Math.hypot(x - YARD.x, z - YARD.z) < 2) continue;
        if (CY_CIRCLES.some(c => Math.hypot(x - c.c[0], z - c.c[1]) < 2)) continue;
        disc(x, z, r, paveLight);
      }
      // playground circles (rubber surfacing, ochre and brown as on the general plan)
      CY_CIRCLES.forEach((c, i) => {
        disc(c.c[0], c.c[1], c.r, i % 2 ? '#9c6b42' : '#d2a23e');
        g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.12; g.beginPath(); g.arc(c.c[0], c.c[1], c.r - 0.1, 0, TAU); g.stroke();
        if (c.r > 4) disc(c.c[0], c.c[1], c.r * 0.35, i % 2 ? '#b98a5a' : '#e6c46a');
      });
      for (const t of arr(CY.terraces)) if (isPoly(t)) { fillP(t, deck); g.strokeStyle = 'rgba(50,30,15,0.5)'; g.lineWidth = 0.1; g.stroke(); }
      for (const s of arr(CY.steps)) {
        if (!s || !isPoly(s.poly)) continue;
        const bb = bboxOf(s.poly); fillP(s.poly, '#bfb8aa');
        g.save(); polyPath(g, s.poly); g.clip(); g.strokeStyle = 'rgba(70,62,50,0.45)'; g.lineWidth = 0.07;
        if (bb.x1 - bb.x0 > bb.z1 - bb.z0) for (let z = bb.z0; z < bb.z1; z += 0.45) { g.beginPath(); g.moveTo(bb.x0, z); g.lineTo(bb.x1, z); g.stroke(); }
        else for (let x = bb.x0; x < bb.x1; x += 0.45) { g.beginPath(); g.moveTo(x, bb.z0); g.lineTo(x, bb.z1); g.stroke(); }
        g.restore();
      }
      // open-air car parks (none in this project, kept generic): asphalt, bays 2.5 m × 5 m → parked cars
      for (const [x0, x1, z0, z1, rows] of SITE_LOTS) {
        g.fillStyle = asphalt; g.fillRect(x0, z0, x1 - x0, z1 - z0);
        g.strokeStyle = 'rgba(236,236,230,0.85)'; g.lineWidth = 0.12;
        for (const row of rows) {
          if (!Array.isArray(row) || !isNum(row[0]) || !isNum(row[1])) continue;
          const [a, b] = row;
          g.beginPath(); g.moveTo(a, z0 + 0.5); g.lineTo(a, z1 - 0.5); g.stroke();
          for (let z = z0 + 0.5; z < z1 - 0.5; z += 2.5) { g.beginPath(); g.moveTo(a, z); g.lineTo(b, z); g.stroke(); bays.push([(a + b) / 2, z + 1.25, 0]); }
        }
      }
      g.restore();
      // lawn strips drawn outside the red line
      arr(CY.lawns).forEach(l => { if (isPoly(l) && !inPoly(SITE_PLOT, ...centroidOf(l))) fillP(l, '#4d6a2c'); });
      // plot kerb
      g.strokeStyle = '#8e897f'; g.lineWidth = 0.3; polyPath(g, SITE_PLOT); g.stroke();
      // soft contact shadow around the building footprints
      g.save(); g.filter = `blur(${Math.round(1.2 * ppm)}px)`; g.fillStyle = 'rgba(20,16,10,0.5)';
      for (const p of [...BLD_BASE, ...POD_POLYS]) { polyPath(g, p.poly); g.fill(); }
      for (const b of CTX) { polyPath(g, b.poly); g.fill(); }
      g.restore();
      // under the buildings: plain screed; the car-park ramps (inside the towers) run down into the dark
      for (const p of [...BLD_BASE, ...POD_POLYS]) fillP(p.poly, '#6b665d');
      for (const r of RAMP_LIST) {
        const top = r.top === 'max' ? 1 : 0, ax = r.axis === 'x';
        const a = ax ? [top ? r.x1 : r.x0, 0] : [0, top ? r.z1 : r.z0], b = ax ? [top ? r.x0 : r.x1, 0] : [0, top ? r.z0 : r.z1];
        const rg = g.createLinearGradient(a[0], a[1], b[0], b[1]); rg.addColorStop(0, '#3a3a3d'); rg.addColorStop(0.6, '#0e0e10');
        g.fillStyle = rg; g.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
      }

      // ---- streets on top
      paintRoads(g, true, ppm);
      // zebra crossings: at the junctions next to the plot and opposite the pedestrian entrances
      g.fillStyle = 'rgba(240,240,236,0.9)';
      const zebra = (r, x, z) => {
        const p = projectOnLine(r.pts, x, z); if (!p || p.d > 1.5) return;
        const { ux, uz } = p;
        for (let s = -r.w / 2 + 0.4; s < r.w / 2 - 0.2; s += 1) {
          const cx = p.x - uz * s, cz = p.z + ux * s;
          polyPath(g, [[cx - ux * 2 - uz * 0.25, cz - uz * 2 + ux * 0.25], [cx + ux * 2 - uz * 0.25, cz + uz * 2 + ux * 0.25], [cx + ux * 2 + uz * 0.25, cz + uz * 2 - ux * 0.25], [cx - ux * 2 + uz * 0.25, cz - uz * 2 - ux * 0.25]]); g.fill();
        }
      };
      if (X_CROSS) for (const c of X_CROSS) {   // the crossings of the layout
        const al = Math.hypot(c.along[0], c.along[1]) || 1, ux = c.along[0] / al, uz = c.along[1] / al, hw = c.w / 2;
        for (let t = -c.len / 2 + 0.4; t < c.len / 2 - 0.2; t += 1) {
          const cx = c.c[0] - uz * t, cz = c.c[1] + ux * t;
          polyPath(g, [[cx - ux * hw - uz * 0.25, cz - uz * hw + ux * 0.25], [cx + ux * hw - uz * 0.25, cz + uz * hw + ux * 0.25], [cx + ux * hw + uz * 0.25, cz + uz * hw - ux * 0.25], [cx - ux * hw + uz * 0.25, cz - uz * hw - ux * 0.25]]); g.fill();
        }
      }
      else for (const j of JUNCTIONS) {
        if (!(j.a.main || j.b.main) || !nearPoly(SITE_PLOT, j.x, j.z, 60)) continue;
        for (const [r, u, o] of [[j.a, j.ua, j.b], [j.b, j.ub, j.a]]) for (const s of [1, -1]) zebra(r, j.x + u[0] * s * (o.w / 2 + 4.5), j.z + u[1] * s * (o.w / 2 + 4.5));
      }
      if (!X_CROSS) for (const e of arr(CY.entrances)) {
        if (!e || e.kind !== 'pedestrian' || !isPt(e.p)) continue;
        for (const r of L.roads) { if (!r.main) continue; const p = projectOnLine(r.pts, e.p[0], e.p[1]); if (p && p.d < 20 && !JUNCTIONS.some(j => Math.hypot(j.x - p.x, j.z - p.z) < 22)) zebra(r, p.x, p.z); }
      }
    }, { aniso: 8 });
    disposables.push(tex);
    parkedCars = bays.filter(() => rnd() < 0.78).map(([x, z, yaw]) => [x, z, yaw]);
    const geo = new THREE.BufferGeometry();
    const y = -0.03;   // just below interior floors (y=0) to avoid z-fighting with ground-floor units
    geo.setAttribute('position', new THREE.Float32BufferAttribute([SITE.x0, y, SITE.z0, SITE.x0, y, SITE.z1, SITE.x1, y, SITE.z1, SITE.x1, y, SITE.z0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mat = stdMat({ map: tex, roughness: 0.92, metalness: 0, envBase: 0.35 });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvSW = (modelMatrix * vec4(position,1.)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vSW;\n' + GLSL_NOISE)
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= (.88 + .24 * vr_noise(vSW * 3.1) * vr_noise(vSW * .7 + 3.)) * (.9 + .2 * vr_noise(vSW * 19.) * vr_noise(vSW * 7.3 + 5.));\nfloat vrGr = smoothstep(.01, .06, diffuseColor.g - diffuseColor.r);\ndiffuseColor.rgb *= mix(1., .7 + .6 * vr_noise(vSW * 37.) * vr_noise(vSW * 13. + 2.), vrGr * .75);\ndiffuseColor.g *= mix(1., .92 + .16 * vr_noise(vSW * 2.3 + 9.), vrGr);');
    };
    mat.customProgramCacheKey = () => 'vr-site';
    registerMaterial(mat);
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = shadows; mesh.name = 'site-plan';
    return mesh;
  }

  // ================================================================ 3D road strips outside the site plan (crisp markings up close)
  function buildRoadStrips() {
    const roadTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#2c2d30'; g.fillRect(0, 0, w, h);
      const rr = mulberry32(3);
      for (let i = 0; i < 5000; i++) { g.fillStyle = rr() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.14)'; g.fillRect(rr() * w, rr() * h, 1.5, 1.5); }
      g.fillStyle = 'rgba(235,235,230,0.8)';
      g.fillRect(0, h * 0.5 - 2, w * 0.33, 4);
    }, { srgb: true, repeat: true });
    disposables.push(roadTex);
    const RMAX = LOW ? 420 : 720;
    const pos = [], uv = [], idx = [];
    const inSite = (x, z) => x > SITE.x0 && x < SITE.x1 && z > SITE.z0 && z < SITE.z1;
    for (const r of L.roads) for (let i = 0; i < r.pts.length - 1; i++) {
      let a = r.pts[i], b = r.pts[i + 1];
      const segs = clipOutRect(a, b);
      for (const [p, q] of segs) {
        const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz); if (len < 0.5) continue;
        if (Math.hypot((p[0] + q[0]) / 2 - SITE_CENTER[0], (p[1] + q[1]) / 2 - SITE_CENTER[1]) > RMAX) continue;
        const nx = -dz / len * r.w / 2, nz = dx / len * r.w / 2, k = pos.length / 3;
        pos.push(p[0] + nx, 0, p[1] + nz, p[0] - nx, 0, p[1] - nz, q[0] - nx, 0, q[1] - nz, q[0] + nx, 0, q[1] + nz);
        const u0 = 0, u1 = len / 9;
        uv.push(u0, 0, u0, 1, u1, 1, u1, 0);
        idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
      }
    }
    void inSite;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    const m = registerMaterial(stdMat({ map: roadTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, envBase: 0.3 }));
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = shadows; mesh.name = 'road-strips'; group.add(mesh);
  }
  function clipOutRect(a, b) {   // parts of segment a→b outside the SITE rect
    const ts = [0, 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    for (const [p, d, v] of [[a[0], dx, SITE.x0], [a[0], dx, SITE.x1], [a[1], dz, SITE.z0], [a[1], dz, SITE.z1]]) if (Math.abs(d) > 1e-9) { const t = (v - p) / d; if (t > 0 && t < 1) ts.push(t); }
    ts.sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i < ts.length - 1; i++) {
      const tm = (ts[i] + ts[i + 1]) / 2, x = a[0] + dx * tm, z = a[1] + dz * tm;
      if (x > SITE.x0 && x < SITE.x1 && z > SITE.z0 && z < SITE.z1) continue;
      out.push([[a[0] + dx * ts[i], a[1] + dz * ts[i]], [a[0] + dx * ts[i + 1], a[1] + dz * ts[i + 1]]]);
    }
    return out;
  }

  // ================================================================ landscaping objects on and around the plot
  function inst(geo, mat, list, fn, cast = false) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); const o = new THREE.Object3D();
    list.forEach((p, i) => { fn(o, p, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.count = list.length; m.castShadow = cast; m.computeBoundingSphere(); tgt.add(m); return m;
  }
  // vertex-coloured box (optionally tilted) for the merged furniture meshes
  function colBox(out, w, h, d, x, y, z, c, rx = 0, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(0, h / 2, 0);
    if (rx) g.rotateX(rx); if (ry) g.rotateY(ry);
    g.translate(x, y, z); paintGeo(g, c); g.deleteAttribute('uv'); out.push(g);
  }
  function paintGeo(g, c) {
    const n = g.attributes.position.count, cc = new Float32Array(n * 3), cl = C(c);
    for (let i = 0; i < n; i++) cc.set([cl.r, cl.g, cl.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); return g;
  }
  // upright prism over a world polygon, y0 → y1 (non-indexed, flat normals, no uv)
  function prism(poly, y0, y1) {
    const g = new THREE.ExtrudeGeometry(shapeFromXZ(poly), { depth: y1 - y0, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  }
  function buildSiteObjects() {
    const inPlot = (x, z) => inPoly(SITE_PLOT, x, z);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    // ---- trees of the courtyard and the pavements (data.js COURTYARD.trees) + the tree rows along the streets around the plot
    // (site-layout.js TREES when it has them: courtyard + street rows + green patches, already cleared of roads and buildings)
    const site = [];
    if (X_TREES) for (const t of X_TREES) { if (!nearBuilding(t.p[0], t.p[1], 0.8)) site.push([t.p[0], t.p[1], clamp(t.h / 7.6, 0.8, 1.5)]); }
    else for (const t of arr(CY.trees)) { if (!t || !isPt(t.p) || nearBuilding(t.p[0], t.p[1], 0.8)) continue; site.push([t.p[0], t.p[1], clamp((isNum(t.r) ? t.r : 1.5) / 1.55, 0.8, 1.6)]); }
    const rows = L.sTrees.filter(([x, z]) => Math.hypot(x - SITE_CENTER[0], z - SITE_CENTER[1]) < 260 && !site.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 5));
    treeSets.push({ pts: site.concat(rows), leafy: true, h: [6, 9], r: [1.7, 2.7], trunk: [2.3, 3.1], cast: shadows, uplight: true, hue: 'site' });
    // young trees scattered over the lawns of the layout (off the paths), shrubs and flowering beds along lawn edges and paths
    const young = [], shrubs = [];
    const rr = mulberry32(77);
    const free = (x, z, m) => inPlot(x, z) && !nearBuilding(x, z, m) && !onHardscape(x, z, 0.4);
    for (const [x0, x1, z0, z1] of LAWNS) {
      for (let x = x0 + 2.5; x < x1 - 2; x += 5.5) for (let z = z0 + 2.5; z < z1 - 2; z += 5.5) {
        const px = x + (rr() - 0.5) * 3.5, pz = z + (rr() - 0.5) * 3.5;
        if (rr() < 0.34 && free(px, pz, 3) && !nearPath(px, pz, 2.2) && !site.some(([sx, sz]) => Math.hypot(sx - px, sz - pz) < 5)) young.push([px, pz, 0.55 + rr() * 0.3]);
      }
      const per = [];
      for (let x = x0 + 1; x < x1 - 1; x += 1.6) per.push([x, z0 + 0.9], [x, z1 - 0.9]);
      for (let z = z0 + 1; z < z1 - 1; z += 1.6) per.push([x0 + 0.9, z], [x1 - 0.9, z]);
      for (const [px, pz] of per) if (rr() < 0.5 && free(px, pz, 1.2) && !nearPath(px, pz, 0.6)) shrubs.push([px + (rr() - 0.5) * 0.6, pz + (rr() - 0.5) * 0.6, 0.45 + rr() * 0.6, rr()]);
    }
    for (const [pts, w] of PATHS) for (let i = 0; i < pts.length - 1; i++) {   // low planting along the footpaths
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < 0.5) continue;
      const nx = -(bz - az) / l, nz = (bx - ax) / l;
      for (let t = 1.5; t < l - 1; t += 1.3) for (const sd of [1, -1]) if (rr() < 0.4) {
        const px = ax + (bx - ax) * t / l + nx * sd * (w / 2 + 0.7), pz = az + (bz - az) * t / l + nz * sd * (w / 2 + 0.7);
        if (free(px, pz, 1) && !nearPath(px, pz, -0.15)) shrubs.push([px, pz, 0.35 + rr() * 0.35, rr()]);
      }
    }
    if (RING) for (let k = 0; k < 26; k++) {   // a flowering border round the lawn disc of the ring
      const a = k / 26 * TAU + 0.1, r = RING.r0 - 0.7 - rr() * 0.5;
      if (rr() < 0.8) shrubs.push([YARD.x + Math.cos(a) * r, YARD.z + Math.sin(a) * r, 0.35 + rr() * 0.3, 0.8 + rr() * 0.2]);
    }
    treeSets.push({ pts: young, leafy: true, h: [5.5, 8], r: [1.7, 2.5], trunk: [2.2, 2.8], cast: shadows, uplight: true, hue: 'young' });
    // ---- lamps: street (9 m), courtyard posts (4.2 m), bollards (0.9 m)
    const street = L.lamps, posts = [], bollards = [];
    const addPost = (x, z) => { if (inPlot(x, z) && !nearBuilding(x, z, 1) && !onHardscape(x, z, 0.3) && !nearPath(x, z, -0.2) && !posts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 7) && !site.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 1.5)) posts.push([x, z]); };
    if (RING) for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + 0.52; addPost(YARD.x + Math.cos(a) * (RING.r1 + 0.8), YARD.z + Math.sin(a) * (RING.r1 + 0.8)); }
    const lines = PATHS.concat(arr(CY.paths).filter(p => p && Array.isArray(p.pts) && p.pts.every(isPt)).map(p => [p.pts, isNum(p.w) ? p.w : 2.4]));
    for (const [pts, w] of lines) {
      let acc = 6, side = 1;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < 0.5) continue;
        const ux = (bx - ax) / l, uz = (bz - az) / l;
        for (let t = 0; t < l; t += 1) { acc += 1; if (acc < 13) continue; acc = 0; side = -side; addPost(ax + ux * t - uz * side * (w / 2 + 0.6), az + uz * t + ux * side * (w / 2 + 0.6)); }
      }
    }
    if (RING) for (let k = 0; k < 10; k++) { const a = k / 10 * TAU + 0.2; bollards.push([YARD.x + Math.cos(a) * (RING.r0 + 0.35), YARD.z + Math.sin(a) * (RING.r0 + 0.35)]); }
    for (const c of CY_CIRCLES) if (c.r > 4) for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + 0.6, x = c.c[0] + Math.cos(a) * (c.r + 0.3), z = c.c[1] + Math.sin(a) * (c.r + 0.3); if (!nearBuilding(x, z, 0.8) && inPlot(x, z)) bollards.push([x, z]); }
    for (const [px, pz] of posts) for (let i = shrubs.length - 1; i >= 0; i--) if (Math.hypot(shrubs[i][0] - px, shrubs[i][1] - pz) < shrubs[i][2] + 0.35) shrubs.splice(i, 1);   // no shrub round a lamp post
    if (shrubs.length) {
      const ico = new THREE.IcosahedronGeometry(1, 0); ico.deleteAttribute('uv'); ico.deleteAttribute('normal');
      const sg = mergeVertices(ico); sg.computeVertexNormals(); sg.scale(1, 0.62, 1); sg.translate(0, 0.35, 0);
      const sm = registerMaterial(stdMat({ color: '#ffffff', roughness: 0.9, envBase: 0.25 }));
      const cols = ['#3f5a26', '#4a6a2c', '#35502a', '#5b6e30', '#3c5530', '#7a5a8e', '#c9c3d6', '#b25a6a', '#d8d2b0', '#4d6b35'];
      const c = new THREE.Color();
      const im = inst(sg, sm, shrubs, (o, [x, z, s, k]) => { o.position.set(x, 0, z); o.scale.set(s, s * (0.8 + k * 0.5), s); o.rotation.set(0, k * 9, 0); });
      shrubs.forEach(([, , , k], i) => im.setColorAt(i, c.set(cols[Math.floor(k * (k < 0.8 ? 6 : 10)) % cols.length])));
      im.name = 'shrubs';
    }
    const metal = registerMaterial(stdMat({ color: '#2b2b2d', roughness: 0.45, metalness: 0.7 }));
    const sPole = new THREE.CylinderGeometry(0.07, 0.11, 9, 8); sPole.translate(0, 4.5, 0);
    const sArm = new THREE.BoxGeometry(0.08, 0.08, 1.6); sArm.translate(0, 8.95, 0.75);
    const sHead = new THREE.BoxGeometry(0.34, 0.1, 0.8); sHead.translate(0, 8.9, 1.45);
    if (street.length) {
      inst(mergeGeometries([sPole, sArm]), metal, street, (o, [x, z, yaw, k = 1]) => { o.position.set(x, 0, z); o.rotation.set(0, yaw, 0); o.scale.set(1, k, 1); }, shadows);
      inst(sHead, lampHeadMat, street, (o, [x, z, yaw, k = 1]) => { o.position.set(x, 8.9 * (k - 1), z); o.rotation.set(0, yaw, 0); }).name = 'lamp-heads-street';
      for (const [x, z, yaw] of street) addPool(x + Math.sin(yaw) * 1.4, z + Math.cos(yaw) * 1.4, 12);
    }
    if (posts.length) {
      const pPole = new THREE.CylinderGeometry(0.05, 0.06, 3.9, 8); pPole.translate(0, 1.95, 0);
      const pHead = new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12); pHead.translate(0, 4.1, 0);
      inst(pPole, metal, posts, (o, [x, z]) => o.position.set(x, 0, z));
      inst(pHead, lampHeadMat, posts, (o, [x, z]) => o.position.set(x, 0, z)).name = 'lamp-heads-post';
      for (const [x, z] of posts) addPool(x, z, 5.5);
    }
    if (bollards.length) {
      const bPole = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 10); bPole.translate(0, 0.4, 0);
      const bHead = new THREE.CylinderGeometry(0.085, 0.085, 0.12, 10); bHead.translate(0, 0.86, 0);
      inst(mergeGeometries([bPole, bHead]), lampHeadMat, bollards, (o, [x, z]) => o.position.set(x, 0, z)).name = 'lamp-bollards';
      for (const [x, z] of bollards) addPool(x, z, 2.2);
    }
    for (const r of RAMP_LIST) if (isPt(r.from)) addPool(r.from[0], r.from[1], 4);   // the car-park portals

    // ---- benches: round the lawn disc of the ring (backs to the tree), at the playground circles (facing in)
    const benches = [];
    if (RING) for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; benches.push([YARD.x + Math.cos(a) * (RING.r0 + 0.75), YARD.z + Math.sin(a) * (RING.r0 + 0.75), -a + Math.PI / 2]); }
    for (const c of CY_CIRCLES) if (c.r > 4) for (let k = 0; k < 3; k++) {
      const a = k / 3 * TAU + 1.1, x = c.c[0] + Math.cos(a) * (c.r - 0.6), z = c.c[1] + Math.sin(a) * (c.r - 0.6);
      if (!nearBuilding(x, z, 1) && !CY_CIRCLES.some(q => q !== c && Math.hypot(x - q.c[0], z - q.c[1]) < q.r)) benches.push([x, z, -a - Math.PI / 2]);
    }
    if (benches.length) {
      const seat = new THREE.BoxGeometry(1.9, 0.08, 0.5); seat.translate(0, 0.45, 0);
      const back = new THREE.BoxGeometry(1.9, 0.45, 0.06); back.translate(0, 0.72, -0.24);
      const wood = registerMaterial(stdMat({ color: '#8a5a36', roughness: 0.6 }));
      inst(mergeGeometries([seat, back]), wood, benches, (o, [x, z, yaw]) => { o.position.set(x, 0, z); o.rotation.set(0, yaw, 0); });
    }

    // ---- hedges (data.js COURTYARD.hedges: one clipped box per point)
    const hBoxes = arr(CY.hedges).filter(isPt).filter(([x, z]) => !nearBuilding(x, z, 0.3));
    if (hBoxes.length) {
      const hg = new THREE.BoxGeometry(1.5, 0.9, 0.8); hg.translate(0, 0.45, 0);
      inst(hg, registerMaterial(stdMat({ color: '#3d5a28', roughness: 0.95, envBase: 0.2 })), hBoxes, (o, [x, z]) => o.position.set(x, 0, z));
    }

    // ---- playground equipment on the circles, the barbecue pergola (one merged vertex-coloured mesh)
    const play = [];
    const cb = (w, h, d, x, y, z, c, rx, ry) => colBox(play, w, h, d, x, y, z, c, rx, ry);
    const cyl = (r, h, x, y, z, c, seg = 20) => { const g = new THREE.CylinderGeometry(r, r, h, seg).toNonIndexed(); g.translate(x, y + h / 2, z); paintGeo(g, c); g.deleteAttribute('uv'); play.push(g); };
    const big = CY_CIRCLES.filter(c => !nearBuilding(c.c[0], c.c[1], 1.5)).slice().sort((a, b) => b.r - a.r);
    big.forEach((c, i) => {
      const [x, z] = c.c, k = i % 4;
      if (k === 0 && c.r > 4) {          // play tower with a slide and a net wall
        cb(2, 0.15, 2, x, 1.4, z, '#e8e2d4');
        for (const [dx, dz] of [[-0.94, -0.94], [0.94, -0.94], [-0.94, 0.94], [0.94, 0.94]]) cb(0.12, 2.7, 0.12, x + dx, 0, z + dz, '#d8a33c');
        cb(2.4, 0.12, 2.4, x, 2.7, z, '#3f8686');
        cb(0.8, 0.08, 3.3, x, 0.04, z + 2.45, '#c85a3a', -0.44);
        cb(1.9, 1.3, 0.08, x, 0.1, z - 1, '#4f7fb0');
        cb(0.1, 2.2, 0.1, x - 3.4, 0, z - 1.6, '#4f7fb0'); cb(0.1, 2.2, 0.1, x - 3.4, 0, z + 1.6, '#4f7fb0'); cb(0.1, 0.1, 3.3, x - 3.4, 2.2, z, '#4f7fb0');
        cb(0.45, 0.06, 0.2, x - 3.4, 0.5, z - 0.6, '#2b2b2d'); cb(0.45, 0.06, 0.2, x - 3.4, 0.5, z + 0.6, '#2b2b2d');
      } else if (k === 1) {              // carousel + two spring riders
        cyl(1.25, 0.22, x, 0.18, z, '#d8a33c'); cyl(0.08, 0.9, x, 0.4, z, '#2b2b2d', 8);
        cb(0.9, 0.05, 0.05, x, 1.05, z, '#c85a3a'); cb(0.05, 0.05, 0.9, x, 1.05, z, '#c85a3a');
        if (c.r > 3.5) { cb(0.3, 0.55, 0.9, x + c.r * 0.55, 0.25, z + 1, '#4f7fb0'); cb(0.3, 0.55, 0.9, x - c.r * 0.5, 0.25, z - 1.2, '#7aa646'); }
      } else if (k === 2) {              // sandbox
        const s = Math.min(1.9, c.r * 0.5);
        cb(2 * s, 0.1, 2 * s, x, 0, z, '#dcc79a');
        cb(2 * s + 0.3, 0.3, 0.15, x, 0, z - s, '#8a5a36'); cb(2 * s + 0.3, 0.3, 0.15, x, 0, z + s, '#8a5a36'); cb(0.15, 0.3, 2 * s, x - s, 0, z, '#8a5a36'); cb(0.15, 0.3, 2 * s, x + s, 0, z, '#8a5a36');
      } else {                           // balance beams
        cb(2.2, 0.12, 0.14, x, 0.3, z - 0.5, '#8a5a36'); cb(0.14, 0.12, 1.8, x + 0.6, 0.45, z + 0.6, '#8a5a36');
        cb(0.12, 0.3, 0.12, x - 1, 0, z - 0.5, '#2b2b2d'); cb(0.12, 0.3, 0.12, x + 1, 0, z - 0.5, '#2b2b2d');
      }
    });
    for (const p of arr(CY.pergolas)) {
      if (!p || !isPt(p.p)) continue;
      const [x, z] = p.p;
      if (EXTRAS.some(e => e.h > 0 && nearPoly(e.poly, x, z, 2.5)) || nearBuilding(x, z, 1.2)) continue;   // built with the site extras elsewhere
      const hw = 2.1, hd = 1.6;
      for (const [dx, dz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) cb(0.14, 2.6, 0.14, x + dx, 0, z + dz, '#5d4630');
      cb(2 * hw + 0.6, 0.16, 0.12, x, 2.6, z - hd, '#5d4630'); cb(2 * hw + 0.6, 0.16, 0.12, x, 2.6, z + hd, '#5d4630');
      for (let s = -hw; s <= hw + 0.01; s += 0.6) cb(0.08, 0.12, 2 * hd + 0.7, x + s, 2.76, z, '#7a5c3f');
      cb(1.7, 0.07, 0.75, x - 0.3, 0.74, z, '#8a5a36'); cb(0.1, 0.74, 0.6, x - 1, 0, z, '#3a342d'); cb(0.1, 0.74, 0.6, x + 0.4, 0, z, '#3a342d');
      cb(1.7, 0.06, 0.32, x - 0.3, 0.44, z - 0.75, '#8a5a36'); cb(1.7, 0.06, 0.32, x - 0.3, 0.44, z + 0.75, '#8a5a36');
      cb(0.7, 0.85, 0.55, x + 1.6, 0, z - 0.9, '#2e2f31'); cb(0.74, 0.06, 0.6, x + 1.6, 0.85, z - 0.9, '#55585c');   // the grill
      addPool(x, z, 3.5);
    }
    if (play.length) {
      const pm = new THREE.Mesh(mergeGeometries(play), registerMaterial(stdMat({ color: '#ffffff', vertexColors: true, roughness: 0.6 })));
      pm.name = 'site-furniture'; pm.castShadow = shadows; group.add(pm);
    }
  }

  // ================================================================ street-name signs (Ukrainian, as on the street) + the bus-stop sign
  function buildStreetSigns() {
    const posts = [];          // { x, z, plates: [{ name, yaw, y }] }
    const [SX, SZ] = SITE_CENTER;
    const js = JUNCTIONS.slice().sort((p, q) => Math.hypot(p.x - SX, p.z - SZ) - Math.hypot(q.x - SX, q.z - SZ)).slice(0, LOW ? 8 : 16);
    for (const j of js) {
      let best = null;
      for (const s of [1, -1]) for (const t of [1, -1]) {
        const x = j.x + j.ua[0] * s * (j.b.w / 2 + 1.5) + j.ub[0] * t * (j.a.w / 2 + 1.5), z = j.z + j.ua[1] * s * (j.b.w / 2 + 1.5) + j.ub[1] * t * (j.a.w / 2 + 1.5);
        if (roadsNear(L.roads, x, z, 0.5) || nearBuilding(x, z, 0.8)) continue;
        const d = Math.hypot(x - SX, z - SZ); if (!best || d < best.d) best = { x, z, d };
      }
      if (!best) continue;
      posts.push({ x: best.x, z: best.z, plates: [{ name: j.a.name, yaw: Math.atan2(-j.ua[1], j.ua[0]), y: 2.78 }, { name: j.b.name, yaw: Math.atan2(-j.ub[1], j.ub[0]), y: 2.44 }] });
    }
    // bus stop: a sign post at the kerb in front of the pavilion of CONTEXT_BLOCKS
    const stops = [];
    for (const b of CTX) {
      if (b.kind !== 'pavilion') continue;
      const [cx, cz] = centroidOf(b.poly); let pr = null, road = null;
      for (const r of L.roads) { if (!r.traced) continue; const p = projectOnLine(r.pts, cx, cz); if (p && (!pr || p.d < pr.d)) { pr = p; road = r; } }
      if (!pr || pr.d > 40 || pr.d < 0.1) continue;
      const dx = (cx - pr.x) / pr.d, dz = (cz - pr.z) / pr.d, off = road.w / 2 + 0.9;
      const half = Math.max(...b.poly.map(([x, z]) => Math.abs((x - cx) * pr.ux + (z - cz) * pr.uz))) + 1.2;   // at the end of the pavilion
      stops.push({ x: pr.x + dx * off + pr.ux * half, z: pr.z + dz * off + pr.uz * half, yaw: Math.atan2(-pr.uz, pr.ux) + Math.PI / 2 });
    }
    if (!posts.length && !stops.length) return;
    const names = [...new Set(posts.flatMap(p => p.plates.map(q => q.name)))];
    const RW = 512, RH = 80, rowsN = names.length + 1;
    const tex = canvasTex(RW, RH * rowsN, g => {
      g.fillStyle = '#8a8d90'; g.fillRect(0, 0, RW, RH * rowsN);
      names.forEach((nm, i) => {
        const y = i * RH;
        g.fillStyle = '#f4f4f0'; g.beginPath(); g.roundRect(0, y, RW, RH, 12); g.fill();
        g.fillStyle = '#17408b'; g.beginPath(); g.roundRect(5, y + 5, RW - 10, RH - 10, 9); g.fill();
        g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        let fs = 44; do { g.font = `600 ${fs}px "Helvetica Neue", Arial, "DejaVu Sans", sans-serif`; fs -= 2; } while (g.measureText(nm).width > RW - 40 && fs > 16);
        g.fillText(nm, RW / 2, y + RH / 2 + 2);
      });
      // last row: the bus-stop plate (left square); the rest of the row stays grey (the posts sample it)
      const y = names.length * RH;
      g.fillStyle = '#17408b'; g.beginPath(); g.roundRect(2, y + 2, RH - 4, RH - 4, 8); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(12, y + 12, RH - 24, RH - 24, 5); g.fill();
      g.fillStyle = '#111111'; g.beginPath(); g.roundRect(22, y + 26, 36, 24, 5); g.fill();                 // bus pictogram
      g.fillStyle = '#ffffff'; g.fillRect(26, y + 30, 28, 9);
      g.fillStyle = '#111111'; g.beginPath(); g.arc(30, y + 53, 4, 0, TAU); g.arc(50, y + 53, 4, 0, TAU); g.fill();
    }, { aniso: 8 });
    disposables.push(tex);
    const geos = [];
    const setUV = (g, u0, u1, v0, v1) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); return g; };
    const grey = g => setUV(g, 0.5, 0.52, 0.2 / rowsN, 0.3 / rowsN);            // a grey patch of the last row (v = 0 is the canvas bottom)
    const plate = (w, h, y, yaw, x, z, u0, u1, v0, v1) => {
      for (const side of [0, 1]) {
        const g = new THREE.PlaneGeometry(w, h); if (side) g.rotateY(Math.PI);
        g.translate(w / 2 + 0.05, y, side ? -0.012 : 0.012); setUV(g, u0, u1, v0, v1); g.rotateY(yaw); g.translate(x, 0, z); geos.push(g);
      }
    };
    const pole = (x, z, h) => { const g = new THREE.CylinderGeometry(0.035, 0.035, h, 6); g.translate(x, h / 2, z); geos.push(grey(g)); };
    for (const p of posts) {
      pole(p.x, p.z, 3);
      for (const q of p.plates) { const i = names.indexOf(q.name); plate(1.8, 0.28, q.y, q.yaw, p.x, p.z, 0, 1, 1 - (i + 1) / rowsN, 1 - i / rowsN); }
    }
    for (const s of stops) { pole(s.x, s.z, 2.9); plate(0.6, 0.6, 2.55, s.yaw, s.x, s.z, 0, RH / RW, 0, 1 / rowsN); }
    signMat = registerMaterial(stdMat({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.55, metalness: 0.1, envBase: 0.4 }));
    const mesh = new THREE.Mesh(mergeGeometries(geos.map(g => (g.index ? g.toNonIndexed() : g))), signMat); mesh.name = 'street-signs'; group.add(mesh);
  }

  // ================================================================ the neighbours (inline fallback for context.js)
  // Simple extruded volumes from CONTEXT_BLOCKS[].poly: apartment slabs and small buildings with procedural windows,
  // shops with shopfronts, private houses with tent roofs, plain sheds, the fuel-station canopy on columns.
  function buildContext() {
    const res = [], shop = [], misc = [];
    const seeded = (g, s) => { g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(s), 1)); return g; };
    const slabTones = ['#cdbfa8', '#d4cab8', '#c9c2b4', '#d8cdb6'], lowTones = ['#ddd2bd', '#cfc9bd', '#d9d4c8', '#c8bda9'], roofT = ['#8a4a37', '#7a4434', '#935640', '#6e3d30', '#5d5550'];
    CTX.forEach((b, i) => {
      const fl = Math.max(1, b.floors || 1), poly = b.poly, [cx, cz] = centroidOf(poly), seed = Math.round(Math.abs(b.x0) * 3 + Math.abs(b.z0) * 7 + i * 13) % 997;
      const kind = b.kind || 'other';
      if (kind === 'canopy') {            // fuel-station canopy: a slab on columns over the pump islands
        misc.push(paintGeo(prism(poly, 4.7, 5.35), '#eceae4'), paintGeo(prism(offsetPolyXZ(poly, -0.5), 4.55, 4.7), '#cfd2d4'));
        const cols = poly.length <= 6 ? poly : poly.filter((_, k) => k % Math.ceil(poly.length / 5) === 0);
        for (const [x, z] of cols) colBox(misc, 0.45, 4.6, 0.45, cx + (x - cx) * 0.6, 0, cz + (z - cz) * 0.6, '#dcdad4');
        for (const [x, z] of cols.slice(0, 4)) { colBox(misc, 0.55, 1.5, 1.1, cx + (x - cx) * 0.3, 0.15, cz + (z - cz) * 0.3, '#3c4046'); colBox(misc, 1.2, 0.15, 2.6, cx + (x - cx) * 0.3, 0, cz + (z - cz) * 0.3, '#b9b6ae'); }
        addPool(cx, cz, 10);
      } else if (kind === 'house' || (kind === 'residential' && fl <= 2)) {      // private house / old 2-storey block: plastered walls, tent roof
        const h = fl * 2.9 + 0.4, bb = bboxOf(poly), rh = Math.min(bb.x1 - bb.x0, bb.z1 - bb.z0) * 0.34;
        res.push(seeded(paintGeo(prism(poly, 0, h), lowTones[i % lowTones.length]), seed));
        const eave = offsetPolyXZ(poly, 0.5), pos = [];
        let a = 0; for (let k = 0; k < eave.length; k++) { const p = eave[k], q = eave[(k + 1) % eave.length]; a += p[0] * q[1] - q[0] * p[1]; }
        for (let k = 0; k < eave.length; k++) { const p = eave[k], q = eave[(k + 1) % eave.length]; if (a > 0) pos.push(q[0], h, q[1], p[0], h, p[1], cx, h + rh, cz); else pos.push(p[0], h, p[1], q[0], h, q[1], cx, h + rh, cz); }
        const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.computeVertexNormals();
        misc.push(paintGeo(rg, roofT[i % roofT.length]));
      } else if (kind === 'utility' || kind === 'ruin') {
        misc.push(paintGeo(prism(poly, 0, kind === 'ruin' ? fl * 3 : fl * 3.2), kind === 'ruin' ? '#938d82' : '#aaa69d'));
      } else if (kind === 'commercial' || kind === 'fuel' || kind === 'pavilion') {
        const h = (kind === 'pavilion' ? 3.1 : 4.2) + (fl - 1) * 3.3;
        shop.push(seeded(paintGeo(prism(poly, 0, h), kind === 'fuel' ? '#e6e4de' : lowTones[i % lowTones.length]), seed));
        if (kind === 'pavilion') misc.push(paintGeo(prism(offsetPolyXZ(poly, 0.9), h, h + 0.18), '#40444a'));   // the shelter roof over the stop
      } else {                            // apartment slabs, other small buildings
        const h = fl * 3.0 + (fl >= 3 ? 0.9 : 0.5);
        res.push(seeded(paintGeo(prism(poly, 0, h), fl >= 3 ? slabTones[i % slabTones.length] : lowTones[i % lowTones.length]), seed));
        if (fl >= 5) { const bb = bboxOf(poly), w = Math.min(7, (bb.x1 - bb.x0) * 0.3), d = Math.min(5, (bb.z1 - bb.z0) * 0.3); colBox(misc, w, 2.4, d, cx, h, cz, '#b9b4aa'); }   // lift machine room
      }
    });
    const add = (list, mat, name) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(list), mat); mesh.castShadow = shadows; mesh.receiveShadow = shadows; mesh.name = name; tgt.add(mesh);
    };
    const rm = registerMaterial(windowMaterial({ color: '#ffffff', colW: 3.3, floorH: 3.0, winW: 1.45, winH: 1.5, base: 0.3, glass: '#39424c', roof: '#5a5855', boost: 0.75, litK: 0.9 }));
    const sm = registerMaterial(windowMaterial({ color: '#ffffff', colW: 4.2, floorH: 3.6, winW: 3.2, winH: 2.3, base: 0.25, glass: '#2c3640', roof: '#55585c', boost: 1.1, litK: 1.4 }));
    rm.vertexColors = true; sm.vertexColors = true;
    add(res, rm, 'context-res'); add(shop, sm, 'context-shop');
    add(misc.map(g => { if (!g.attributes.normal) g.computeVertexNormals(); return g; }), registerMaterial(stdMat({ color: '#ffffff', vertexColors: true, roughness: 0.8, envBase: 0.4 })), 'context-misc');
  }

  // ================================================================ neighbourhood: private houses, fences, garden trees, halls, apartment blocks
  function buildNeighbourhood() {
    const { houses } = L;
    const o = new THREE.Object3D(), c = new THREE.Color();
    if (houses.length) {
      const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
      const hm = registerMaterial(windowMaterial({ color: '#c6c2bb', colW: 3.4, floorH: 2.85, winW: 1.25, winH: 1.35, base: 0.45, glass: '#343c46', roof: '#4d4a47', boost: 0.75, litK: 0.85 }));
      const body = new THREE.InstancedMesh(box, hm, houses.length);
      const seeds = new Float32Array(houses.length);
      // gable: eaves at y=0 (z = ±0.5), ridge at y=1 along x; hip: ridge x ∈ ±0.22
      const gable = new THREE.BufferGeometry();
      gable.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
        0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
        -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
      ], 3)); gable.computeVertexNormals();
      const r = 0.22;
      const hip = new THREE.BufferGeometry();
      hip.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, 0, 0.5, 0.5, 0, 0.5, r, 1, 0, -0.5, 0, 0.5, r, 1, 0, -r, 1, 0,
        0.5, 0, -0.5, -0.5, 0, -0.5, -r, 1, 0, 0.5, 0, -0.5, -r, 1, 0, r, 1, 0,
        -0.5, 0, -0.5, -0.5, 0, 0.5, -r, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, r, 1, 0,
      ], 3)); hip.computeVertexNormals();
      const rMat = registerMaterial(stdMat({ color: '#ffffff', roughness: 0.78 }));
      rMat.onBeforeCompile = sh => {   // roof tiles: horizontal courses + noise, darker towards the eaves
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRp = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRp;\n' + GLSL_NOISE)
          .replace('#include <color_fragment>', `#include <color_fragment>
            float crs = smoothstep(.0, .25, fract(vRp.y * 9.)) * .12 + .88;
            diffuseColor.rgb *= crs * (.9 + .2 * vr_noise(vRp.xz * 13. + vRp.y * 5.)) * (.85 + .15 * vRp.y);`);
      };
      rMat.customProgramCacheKey = () => 'vr-roof';
      const gl = houses.filter(h => h.roof === 'gable'), hp = houses.filter(h => h.roof === 'hip');
      const extraRoofs = MIDRISE.filter(m => m.roof);
      const gm = new THREE.InstancedMesh(gable, rMat, gl.length), hm2 = new THREE.InstancedMesh(hip, rMat, hp.length + extraRoofs.length);
      houses.forEach((h, i) => {
        o.position.set(h.x, 0, h.z); o.rotation.set(0, h.yaw, 0); o.scale.set(h.w, h.h, h.d); o.updateMatrix(); body.setMatrixAt(i, o.matrix);
        body.setColorAt(i, c.set(h.wall)); seeds[i] = Math.floor(rnd() * 997);
      });
      const putRoof = (mesh, list, off = 0) => list.forEach((h, i) => {
        const w = h.turn ? h.d : h.w, d = h.turn ? h.w : h.d;
        o.position.set(h.x, h.h, h.z); o.rotation.set(0, h.yaw + (h.turn ? Math.PI / 2 : 0), 0);
        o.scale.set(w + 0.8, Math.min(w, d) * (h.pitch || 0.36), d + 0.8); o.updateMatrix(); mesh.setMatrixAt(i + off, o.matrix); mesh.setColorAt(i + off, c.set(h.roofC));
      });
      putRoof(gm, gl); putRoof(hm2, hp);
      putRoof(hm2, extraRoofs.map(m => ({ x: m.w[0], z: m.w[1], yaw: midYaw(m), w: m.L, d: m.W, h: m.fl * 2.85 + 1.2, roofC: m.roof, pitch: 0.28 })), hp.length);
      box.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      for (const m of [body, gm, hm2]) { m.computeBoundingSphere(); m.castShadow = shadows && m !== body ? false : false; m.receiveShadow = false; group.add(m); }
      body.name = 'houses';
      // fences along the lot fronts
      const F = L.fences;
      if (F.length) {
        const fg = new THREE.BoxGeometry(1, 1, 0.12); fg.translate(0, 0.5, 0);
        const fm = new THREE.InstancedMesh(fg, registerMaterial(stdMat({ color: '#ffffff', roughness: 0.7, envBase: 0.3 })), F.length);
        const fc = ['#e8e4dc', '#9a9790', '#5b4f44', '#3b4a3c', '#c9c2b5', '#2e2f31'];
        F.forEach((f, i) => { o.position.set(f.x, 0, f.z); o.rotation.set(0, Math.atan2(-f.uz, f.ux), 0); o.scale.set(f.L, f.h, 1); o.updateMatrix(); fm.setMatrixAt(i, o.matrix); fm.setColorAt(i, c.set(fc[Math.floor(f.c * fc.length)])); });
        fm.computeBoundingSphere(); group.add(fm);
      }
    }
    // the apartment blocks of the layout + a few estates of collective housing beyond the house belt (clusters, not a
    // uniform scatter)
    const blocks = MIDRISE.map(m => ({ x: m.w[0], z: m.w[1], w: m.L, d: m.W, h: m.fl * 2.85 + 1.2, rot: midYaw(m) }));
    {
      const [cx, cz] = SITE_CENTER;
      for (let e = 0; e < (LOW ? 7 : 14); e++) {
        const a = rnd() * TAU, rr = L.R_FAR + 80 + rnd() * 1300;
        const ex = cx + Math.cos(a) * rr, ez = cz + Math.sin(a) * rr;
        const n = 3 + Math.floor(rnd() * 5), fl = rnd() < 0.4 ? 10 : 4 + Math.floor(rnd() * 5), rot = (rnd() - 0.5) * 0.3;
        for (let i = 0; i < n; i++) {
          const vertical = rnd() < 0.4, len = 28 + rnd() * 40;
          const x = ex + (i % 3) * 55 + (rnd() - 0.5) * 12, z = ez + Math.floor(i / 3) * 48 + (rnd() - 0.5) * 12;
          blocks.push({ x, z, w: vertical ? 13 : len, d: vertical ? len : 13, h: (fl + Math.floor(rnd() * 2)) * 2.8 + 1, rot });
        }
      }
    }
    if (blocks.length) {
      const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
      const bm = registerMaterial(windowMaterial({ color: '#dedbd5', colW: 3.0, floorH: 2.8, winW: 1.5, winH: 1.45, base: 0.6, slab: 0.5, glass: '#46525e', roof: '#4d4c4f', slabCol: '#e8e2d8', boost: 0.8, litK: 0.8 }));
      const mesh = new THREE.InstancedMesh(box, bm, blocks.length);
      const seeds = new Float32Array(blocks.length);
      const tones = ['#e4ddd0', '#d8cfc0', '#ece6db', '#cfc8bd', '#e0d2bd', '#d9d9d6', '#e8d8c4'];
      blocks.forEach((b, i) => { o.position.set(b.x, 0, b.z); o.rotation.set(0, b.rot, 0); o.scale.set(b.w, b.h, b.d); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); mesh.setColorAt(i, c.set(tones[i % tones.length])); seeds[i] = Math.floor(rnd() * 997); });
      box.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      mesh.computeBoundingSphere(); mesh.name = 'blocks'; mesh.castShadow = shadows; group.add(mesh);
    }
    // large non-residential buildings of the layout (extruded outlines, one mesh + roof tint)
    const halls = HALLS.concat(L.sheds || []);
    if (halls.length) {
      const walls = [], roofs = [];
      for (const h of halls) {
        const shape = shapeFromXZ(h.poly);
        const g = new THREE.ExtrudeGeometry(shape, { depth: h.h, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
        g.deleteAttribute('uv'); g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(11), 1));
        walls.push(g.index ? g.toNonIndexed() : g);
        const rg = new THREE.ShapeGeometry(shape); rg.rotateX(-Math.PI / 2); rg.translate(0, h.h + 0.06, 0); rg.deleteAttribute('uv');
        const n = rg.attributes.position.count, cl = C(h.roof || '#9ea4a8'), col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([cl.r, cl.g, cl.b], i * 3);
        rg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        roofs.push(rg.index ? rg.toNonIndexed() : rg);
      }
      const wm = registerMaterial(windowMaterial({ color: '#c9c6bf', colW: 7, floorH: 4.5, winW: 4.5, winH: 1.1, base: 1.2, glass: '#555c63', roof: '#9ea4a8', boost: 0.4 }));
      group.add(new THREE.Mesh(mergeGeometries(walls.map(g => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; })), wm));
      // roofs: corrugated look via stripes along the long side
      const rm = registerMaterial(stdMat({ color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0.35 }));
      rm.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vHw;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvHw = (modelMatrix * vec4(position,1.)).xz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHw;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= .9 + .1 * step(.5, fract(dot(vHw, vec2(.34, .94)) * .08)) + .06 * sin(dot(vHw, vec2(.94, -.34)) * 3.);');
      };
      rm.customProgramCacheKey = () => 'vr-hallroof';
      group.add(new THREE.Mesh(mergeGeometries(roofs), rm));
    }
    buildFarHouses();
    // garden + woodland trees: 3-lobe crowns near the site, single-lobe (20 triangles) further out, 8-triangle blobs in
    // the far belt. Counts are capped (random subsample) to keep the whole scene under ~1M triangles.
    const gClose = [], gNear = [], gMid = [], RN = LOW ? 220 : 320, RC = LOW ? 0 : 190;
    const streetFar = L.sTrees.filter(([x, z]) => Math.hypot(x - SITE_CENTER[0], z - SITE_CENTER[1]) >= 260);
    for (const p of L.gTrees.concat(L.wTrees, streetFar)) { const d = Math.hypot(p[0] - SITE_CENTER[0], p[1] - SITE_CENTER[1]); (d < RC ? gClose : d < RN ? gNear : gMid).push(p); }
    // the gardens right around the plot are seen from the street: leaf-card crowns there
    treeSets.push({ pts: gClose, leafy: true, h: [6, 11], r: [2.6, 4.2], trunk: [1.8, 2.6], cast: false, hue: 'garden' });
    const cap = (a, n) => { if (a.length <= n) return a; const k = n / a.length; return a.filter(() => rnd() < k); };
    treeSets.push({ pts: cap(gNear, LOW ? 1400 : 3200), detail: 0, lobes: 3, h: [6, 11.5], r: [2.8, 4.6], trunk: [1.7, 2.5], cast: false, hue: 'garden' });
    treeSets.push({ pts: cap(gMid, LOW ? 3500 : 7500), detail: 0, lobes: 1, noTrunk: true, h: [6, 11.5], r: [2.9, 4.6], trunk: [1.6, 2.4], cast: false, hue: 'garden' });
    treeSets.push({ pts: cap(L.farTrees, LOW ? 2500 : 8000), blob: true, h: [5, 9], r: [2.4, 3.8], trunk: [1.6, 2.2], cast: false, hue: 'garden' });
  }

  // Far belt (R_HOUSE … R_FAR): one instanced mesh, box + hip roof in a single geometry (aRoof marks the roof), wall and
  // roof colours per instance; at night a share of the houses glow warm (their windows, averaged at this distance).
  function buildFarHouses() {
    const F = L.farHouses; if (!F.length) return;
    const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); box.translate(0, 0.5, 0);
    { const p = box.attributes.position, keep = []; for (let i = 0; i < p.count; i += 3) { if (!(p.getY(i) < 0.01 && p.getY(i + 1) < 0.01 && p.getY(i + 2) < 0.01)) keep.push(i); }
      const pos = new Float32Array(keep.length * 9), nor = new Float32Array(keep.length * 9);
      keep.forEach((i, k) => { for (let j = 0; j < 3; j++) { pos.set([p.getX(i + j), p.getY(i + j), p.getZ(i + j)], (k * 3 + j) * 3); nor.set([box.attributes.normal.getX(i + j), box.attributes.normal.getY(i + j), box.attributes.normal.getZ(i + j)], (k * 3 + j) * 3); } });
      box.setAttribute('position', new THREE.BufferAttribute(pos, 3)); box.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); box.deleteAttribute('uv'); }
    const r = 0.2, H = 0.42, y = 1;
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.55, y, 0.55, 0.55, y, 0.55, r, y + H, 0, -0.55, y, 0.55, r, y + H, 0, -r, y + H, 0,
      0.55, y, -0.55, -0.55, y, -0.55, -r, y + H, 0, 0.55, y, -0.55, -r, y + H, 0, r, y + H, 0,
      -0.55, y, -0.55, -0.55, y, 0.55, -r, y + H, 0, 0.55, y, 0.55, 0.55, y, -0.55, r, y + H, 0,
    ], 3)); roof.computeVertexNormals();
    const flag = (g, v) => { g.setAttribute('aRoof', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); return g; };
    const geo = mergeGeometries([flag(box, 0), flag(roof, 1)]);
    const roofC = new Float32Array(F.length * 3), lit = new Float32Array(F.length);
    const m = registerMaterial(stdMat({ color: '#d2cfc9', roughness: 0.85, envBase: 0.4 }));
    m.onBeforeCompile = sh => {
      sh.uniforms.uGlow = SHARED.uGlow;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRoof; attribute vec3 aRoofC; attribute float aLit; varying float vLitF;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, aRoofC * 1.25, aRoof); vLitF = step(.62, aLit) * (1. - aRoof) * (.6 + aLit);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLitF; uniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1., .6, .28) * vLitF * uGlow * .22;');
    };
    m.customProgramCacheKey = () => 'vr-farhouse';
    const mesh = new THREE.InstancedMesh(geo, m, F.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    F.forEach((h, i) => {
      o.position.set(h.x, 0, h.z); o.rotation.set(0, h.yaw + (h.turn ? Math.PI / 2 : 0), 0);
      o.scale.set(h.turn ? h.d : h.w, h.h, h.turn ? h.w : h.d); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(h.wall)); c.set(h.roofC); roofC.set([c.r, c.g, c.b], i * 3); lit[i] = h.lit;
    });
    geo.setAttribute('aRoofC', new THREE.InstancedBufferAttribute(roofC, 3)); geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
    mesh.computeBoundingSphere(); mesh.name = 'far-houses'; group.add(mesh);
  }
  function midYaw(m) { const [dx, dz] = wDir(m.b); return Math.atan2(-dz, dx); }

  // Distant ring: the apartment districts of the town, denser towards the centre (true bearing ≈ 20–110°, north-east).
  // Uzhhorod has no high-rise skyline: 5–9 storeys, a few 14–16 storey towers.
  function buildSkyline() {
    const towers = [];
    const [cx, cz] = SITE_CENTER;
    const N = LOW ? 220 : 480, R0 = L.R_FAR + 200;
    for (let i = 0; i < N; i++) {
      const city = rnd() < 0.45;
      const b = city ? 20 + rnd() * 90 : rnd() * 360;
      const hilly = b > 318 || b < 112;                                 // the foothills start ≈ 2.5 km out in this sector
      const r = R0 + Math.pow(rnd(), 0.8) * (hilly ? Math.max(100, 2350 - R0) : 2200);
      const [dx, dz] = wDir(b), x = cx + dx * r, z = cz + dz * r;
      const tall = rnd() < 0.06;
      const h = tall ? 40 + rnd() * 12 : 14 + rnd() * 15;
      const w = tall ? 18 + rnd() * 10 : 14 + rnd() * 50, d = tall ? 16 + rnd() * 8 : 12 + rnd() * 6;
      towers.push({ x, z, w, d, h, rot: rnd() < 0.8 ? 0 : 0.5, tall });
    }
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const m = registerMaterial(windowMaterial({ color: '#ffffff', colW: 3.2, floorH: 3.0, winW: 1.9, winH: 1.7, base: 0, slab: 0.3, glass: '#71849a', roof: '#48474a', slabCol: '#e7e2d9', boost: 1.3 }));
    const mesh = new THREE.InstancedMesh(box, m, towers.length);
    const seeds = new Float32Array(towers.length); const o = new THREE.Object3D(), c = new THREE.Color();
    towers.forEach((t, i) => {
      o.position.set(t.x, 0, t.z); o.rotation.set(0, t.rot, 0); o.scale.set(t.w, t.h, t.d); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(t.tall ? ['#c3c9cc', '#d9d4ca', '#b9b4aa'][i % 3] : ['#ddd6ca', '#d2cabd', '#e6e1d8', '#c9c4bb'][i % 4]));
      seeds[i] = Math.floor(rnd() * 997);
    });
    box.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.computeBoundingSphere(); mesh.name = 'skyline'; tgt.add(mesh);
  }

  // The Carpathian foothills: three low wooded ridges across the north – north-east – east horizon (true bearing
  // ≈ 318° → 112°), flat plain elsewhere. One mesh; drawn without scene fog — each ridge is mixed towards the horizon
  // haze by its own factor (aerial perspective), and melts into it completely at its foot.
  function buildHills() {
    const [cx, cz] = SITE_CENTER, N = LOW ? 72 : 132;
    let B0 = 318, SPAN = 154, PEAK = 0.6;                              // default: true bearing 318° → 112°, highest in the north-east
    if (X_HILLS) {                                                     // the sector(s) of site-layout.js SKYLINE.hills, 10° of taper each side
      const un = b => ((b - X_HILLS[0].from) % 360 + 360) % 360;       // degrees clockwise from the first sector's start
      const end = Math.max(...X_HILLS.map(h => un(h.from) + ((h.to - h.from) % 360 + 360) % 360));
      const top = X_HILLS.reduce((a, h) => (h.rel > a.rel ? h : a));
      if (end > 20 && end < 300) { B0 = X_HILLS[0].from - 10; SPAN = end + 20; PEAK = (un(top.from) + (((top.to - top.from) % 360 + 360) % 360) / 2 + 10) / SPAN; }
    }
    const ridges = [{ r: 2500, h: 125, s: 1.7, k: 0.66 }, { r: 3300, h: 235, s: 5.3, k: 0.5 }, { r: 4300, h: 370, s: 9.1, k: 0.36 }];
    const pos = [], aK = [], idx = [];
    for (const rg of ridges) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const t = i / N, [dx, dz] = wDir(B0 + SPAN * t);
        const taper = Math.pow(Math.sin(Math.PI * t), 0.55);
        const n = 0.5 + 0.5 * (0.58 * vnoise(t * 7 + rg.s, rg.s) + 0.3 * vnoise(t * 19 + rg.s, 3.3) + 0.12 * vnoise(t * 53, rg.s));
        const x = cx + dx * rg.r, z = cz + dz * rg.r;
        pos.push(x, -3, z, x, rg.h * taper * n * (1 + 0.3 * Math.exp(-Math.pow((t - PEAK) / 0.25, 2))), z);
        aK.push(rg.k, 0, rg.k, 1);
        if (i < N) { const j = base + i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aK', new THREE.Float32BufferAttribute(aK, 2)); g.setIndex(idx);
    hillU = { uFogCol: SKYU.uFogCol, uHill: { value: C('#4f6f63') }, uHillK: { value: 0.75 } };
    const m = new THREE.ShaderMaterial({
      uniforms: hillU, fog: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec2 aK; varying vec2 vK; varying vec3 vP;
        void main(){ vK = aK; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: GLSL_NOISE + /* glsl */`
        uniform vec3 uFogCol; uniform vec3 uHill; uniform float uHillK; varying vec2 vK; varying vec3 vP;
        void main(){
          float wood = .88 + .24 * vr_noise(vec2(atan(vP.z, vP.x) * 260., vP.y * .05));   // forest texture
          vec3 c = mix(uFogCol, uHill * wood, vK.x * uHillK * smoothstep(0., .45, vK.y));
          gl_FragColor = vec4(c, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.name = 'hills'; mesh.frustumCulled = false; group.add(mesh);
  }

  function buildTraffic() {
    const carGeo = carGeometry();
    const carMat = registerMaterial(stdMat({ color: '#ffffff', vertexColors: true, roughness: 0.28, metalness: 0.55, envBase: 1 }));
    const paints = ['#f2f2f2', '#1c1c1e', '#8a8d93', '#2b3a55', '#6d1d1d', '#c9c7c2', '#3c4a3a', '#101216', '#b8b3a8', '#44474d'];
    const c = new THREE.Color(), o = new THREE.Object3D();
    // cars of the open-air car parks of the layout (none in this project) + kerbside cars along the side streets
    for (const [list, g] of [[parkedCars, group], [L.kerbCars, group]]) {
      if (!list.length) continue;
      const pm = new THREE.InstancedMesh(carGeo, carMat, list.length);
      list.forEach(([x, z, yaw, y = 0], i) => { o.position.set(x, y, z); o.rotation.set(0, yaw, 0); o.scale.set(1, 1, 1); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); pm.setColorAt(i, c.set(paints[(i * 3 + (list === L.kerbCars ? 1 : 0)) % paints.length])); });
      pm.computeBoundingSphere(); pm.castShadow = shadows; g.add(pm);
    }
    // moving traffic on the through roads (polylines)
    const paths = L.roads.filter(r => r.main).map(r => {
      const cum = [0]; for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      return { r, cum, L: cum[cum.length - 1] };
    });
    const cars = [];
    const nCars = paths.length ? (LOW ? 24 : 54) : 0;
    for (let i = 0; i < nCars; i++) { const p = paths[i % paths.length]; cars.push({ p, s: rnd() * p.L, dir: rnd() < 0.5 ? 1 : -1, v: 8 + rnd() * 6 }); }
    const mm = new THREE.InstancedMesh(carGeo, carMat, cars.length);
    mm.frustumCulled = false; mm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cars.forEach((_, i) => mm.setColorAt(i, c.set(paints[(i * 7) % paints.length])));
    mm.name = 'traffic'; group.add(mm);
    const lp = new Float32Array(cars.length * 4 * 3), lc = new Float32Array(cars.length * 4 * 3);
    cars.forEach((_, i) => { lc.set([1, 0.92, 0.8, 1, 0.92, 0.8, 1, 0.08, 0.04, 1, 0.08, 0.04], i * 12); });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    const glowTex = radialTex(0.12); disposables.push(glowTex);
    const lm = new THREE.PointsMaterial({ size: 1.6, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const lights = new THREE.Points(lg, lm); lights.frustumCulled = false; group.add(lights); nightOnly.push(lights);
    let ctxStreets = null;            // ids of the streets context.js drives on (known once its traffic has started)
    const step = (dt) => {
      if (!ctxStreets) { const tr = ext.context && ext.context.traffic; if (tr && tr.paths && tr.paths.length) ctxStreets = new Set(tr.paths.map(q => q.street)); }
      for (let i = 0; i < cars.length; i++) {
        const k = cars[i], { p } = k; k.s = (k.s + k.v * dt) % p.L;
        if (ctxStreets && (ctxStreets.has(p.r.id) || ctxStreets.has(p.r.street))) {      // that street has the lane-true traffic: hide this car
          o.position.set(0, -500, 0); o.rotation.set(0, 0, 0); o.scale.set(0, 0, 0); o.updateMatrix(); mm.setMatrixAt(i, o.matrix); o.scale.set(1, 1, 1);
          for (let q = 0; q < 12; q += 3) lp.set([0, -500, 0], i * 12 + q);
          continue;
        }
        const s = k.dir > 0 ? k.s : p.L - k.s;
        let j = 0; while (j < p.cum.length - 2 && p.cum[j + 1] < s) j++;
        const a = p.r.pts[j], b = p.r.pts[j + 1], seg = p.cum[j + 1] - p.cum[j] || 1, f = (s - p.cum[j]) / seg;
        let dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg; if (k.dir < 0) { dx = -dx; dz = -dz; }
        const rx = -dz, rz = dx, lane = p.r.w / 4 + 0.2;
        const x = a[0] + (b[0] - a[0]) * f + rx * lane, z = a[1] + (b[1] - a[1]) * f + rz * lane;
        o.position.set(x, 0, z); o.rotation.set(0, Math.atan2(-dz, dx), 0); o.updateMatrix(); mm.setMatrixAt(i, o.matrix);
        const fx = x + dx * 2.2, fz = z + dz * 2.2, bx = x - dx * 2.2, bz = z - dz * 2.2;
        lp.set([fx + rx * 0.65, 0.7, fz + rz * 0.65, fx - rx * 0.65, 0.7, fz - rz * 0.65, bx + rx * 0.65, 0.8, bz + rz * 0.65, bx - rx * 0.65, 0.8, bz - rz * 0.65], i * 12);
      }
      mm.instanceMatrix.needsUpdate = true; lg.attributes.position.needsUpdate = true;
    };
    step(0);
    tickers.push(dt => { if (dt > 0) step(dt); });
  }

  // Night lights as one point cloud: street lamps (modelled + the continued grid to the horizon), porch / window lights
  // of the houses, district glows far away. Screen-size clamped with energy kept, twinkling with distance (air shimmer),
  // attenuated like the fog; woodland stays dark as on the developer's night render.
  function buildNightLights() {
    const r2 = mulberry32(515), P = [], [SX, SZ] = SITE_CENTER;
    const cols = [[1, 0.62, 0.3], [1, 0.62, 0.3], [1, 0.7, 0.4], [1, 0.82, 0.6], [0.9, 0.93, 1]];
    const add = (x, y, z, size, ci = Math.floor(r2() * cols.length), k = 1) => P.push(x, y, z, size, ...cols[ci].map(v => v * k), r2());
    for (const [x, z, yaw, k = 1] of L.lamps) add(x + Math.sin(yaw) * 1.45, 8.75 * k, z + Math.cos(yaw) * 1.45, 1.1, r2() < 0.7 ? 0 : 3, 1.6);
    // lamps along the rest of the modelled streets
    for (const r of L.roads) {
      let acc = r2() * 30;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < 0.01) continue;
        const ux = (bx - ax) / l, uz = (bz - az) / l;
        for (let t = 0; t < l; t += 3) {
          acc += 3; if (acc < 31) continue; acc = r2() * 4; if (r2() < 0.35) continue;
          const x = ax + ux * t, z = az + uz * t, dc = Math.hypot(x - SX, z - SZ);
          if (dc < (r.traced ? 470 : 250)) continue;
          const sd = r2() < 0.5 ? 1 : -1; add(x - uz * sd * (r.w / 2 + 0.5), 7.5, z + ux * sd * (r.w / 2 + 0.5), 2.4, r2() < 0.8 ? 0 : 3, 0.6 + r2() * 0.5);
        }
      }
    }
    // porch / window lights
    for (const h of L.houses) if (r2() < 0.45) { const fx = -Math.sin(h.yaw), fz = -Math.cos(h.yaw); add(h.x + fx * (h.d / 2 + 0.3), 2 + r2() * (h.h - 2.5), h.z + fz * (h.d / 2 + 0.3), 1.1, 2 + Math.floor(r2() * 2), 0.9); }
    for (const h of L.farHouses) if (h.lit > 0.45) add(h.x, 2.5, h.z, 1.6, 1 + Math.floor(r2() * 3), 0.9);
    // beyond the modelled belt: lamps along the continued grid + scattered house lights, to the horizon
    const RF = L.R_FAR, RH = LOW ? 7000 : 8500, step = LOW ? 48 : 34;
    const okFar = (x, z) => { const d = Math.hypot(x - SX, z - SZ); return d > RF && d < RH && woods(x, z) < 0.62; };
    for (let k = -Math.ceil(RH / GRID.GZ); k <= Math.ceil(RH / GRID.GZ); k++) for (let x = SX - RH; x < SX + RH; x += step * (0.8 + r2() * 0.4)) {
      const z = gridZ(k, x); if (r2() < 0.5 && okFar(x, z)) add(x + (r2() - 0.5) * 12, 7, z + (r2() < 0.5 ? 4 : -4), 2.4, r2() < 0.85 ? 0 : 3, 0.35 + r2() * 0.5);
    }
    for (let j = -Math.ceil(RH / GRID.GX); j <= Math.ceil(RH / GRID.GX); j++) for (let z = SZ - RH; z < SZ + RH; z += step * (0.8 + r2() * 0.4)) {
      const x = gridX(j, z); if (r2() < 0.5 && okFar(x, z)) add(x + (r2() < 0.5 ? 4 : -4), 7, z + (r2() - 0.5) * 12, 2.4, r2() < 0.85 ? 0 : 3, 0.35 + r2() * 0.5);
    }
    for (let i = 0; i < (LOW ? 20000 : 50000); i++) {
      const a = r2() * TAU, rr = RF + Math.pow(r2(), 0.62) * (RH - RF), x = SX + Math.cos(a) * rr, z = SZ + Math.sin(a) * rr;
      if (okFar(x, z)) add(x, 3, z, 2.2, r2() < 0.88 ? Math.floor(r2() * 3) : 3 + Math.floor(r2() * 2), 0.6 + r2() * 0.4);
    }
    const n = P.length / 8, buf = new THREE.InterleavedBuffer(new Float32Array(P), 8);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    g.setAttribute('aSize', new THREE.InterleavedBufferAttribute(buf, 1, 3));
    g.setAttribute('aCol', new THREE.InterleavedBufferAttribute(buf, 3, 4));
    g.setAttribute('aSeed', new THREE.InterleavedBufferAttribute(buf, 1, 7));
    const U = { uTime: SHARED.uTime, uI: { value: 1 }, uViewH: { value: 1080 }, uFogD: { value: 0.0003 } };
    nightU = U;
    const m = new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float aSize; attribute vec3 aCol; attribute float aSeed;
        uniform float uTime; uniform float uI; uniform float uViewH; uniform float uFogD;
        varying vec3 vCol;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.); float dist = -mv.z;
          gl_Position = projectionMatrix * mv;
          float px = aSize * projectionMatrix[1][1] * uViewH * .5 / max(dist, 1.);
          float s = clamp(px, 2.2, 22.);
          float e = min(1., px / 2.2);                       // energy kept when clamped to the minimum size
          float tw = mix(1., .6 + .4 * sin(uTime * (1.1 + aSeed * 2.3) + aSeed * 60.), smoothstep(500., 1600., dist));
          float fog = exp(-pow(dist * uFogD * .42, 2.));
          vCol = aCol * uI * (.35 + .65 * e) * tw * fog;
          gl_PointSize = s;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol;
        void main(){
          vec2 q = gl_PointCoord * 2. - 1.; float r2 = dot(q, q); if (r2 > 1.) discard;
          float a = exp(-r2 * 9.) * 1.2 + exp(-r2 * 2.5) * .22;
          gl_FragColor = vec4(vCol * a, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(g, m); pts.name = 'night-lights'; pts.frustumCulled = false; pts.renderOrder = 6;
    group.add(pts); nightOnly.push(pts);
    void n;
  }

  function buildDeferred() {   // trees (all sets), light pools
    if (L.pTrees.length) treeSets.push({ pts: L.pTrees, detail: 0, lobes: 3, h: [7, 12], r: [2.6, 4.2], trunk: [2.4, 3.4], cast: false, hue: 'park' });
    for (const set of treeSets) if (set.pts.length) safe('trees', () => addTrees(set));
    for (const [g, pools] of poolsBy) {
      if (!pools.length) continue;
      const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
      const m = new THREE.InstancedMesh(pg, poolMat, pools.length); const o = new THREE.Object3D();
      pools.forEach(([x, z, r], i) => { o.position.set(x, 0.03, z); o.scale.set(r * 2, 1, r * 2); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
      m.computeBoundingSphere(); m.renderOrder = 2; g.add(m); nightOnly.push(m);
    }
  }

  function addTrees(set) {
    const { pts } = set;
    const crown = set.leafy ? leafCrownGeometry(91 + pts.length) : set.blob ? blobGeometry() : crownGeometry(set.detail, set.lobes, 17 + set.detail * 3 + set.lobes);
    const trunkG = set.detail > 0 || set.leafy ? new THREE.CylinderGeometry(0.1, 0.16, 1, 6) : new THREE.CylinderGeometry(0.1, 0.16, 1, 4, 1, true); trunkG.translate(0, 0.5, 0);
    const cm = registerMaterial(set.leafy
      ? stdMat({ color: '#ffffff', vertexColors: true, map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, envBase: 0.35 })
      : stdMat({ color: '#ffffff', vertexColors: true, roughness: 0.88, envBase: 0.3 }));
    const up = set.uplight ? 1 : set.blob ? 0 : 0.3;   // site trees are uplit; garden trees catch street / window light
    if (set.leafy) {
      cm.onBeforeCompile = sh => {
        sh.uniforms.uGlow = SHARED.uGlow;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTy;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTy = position.y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTy; uniform float uGlow;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance += vec3(1., .62, .3) * uGlow * ${up.toFixed(2)} * .6 * pow(1. - clamp(vTy, 0., 1.), 2.2) * diffuseColor.rgb;`);
      };
      cm.customProgramCacheKey = () => 'vr-leaf-' + up;
    } else cm.onBeforeCompile = sh => {
      sh.uniforms.uGlow = SHARED.uGlow;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTp = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTp; uniform float uGlow;\n' + GLSL_NOISE)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float lf = vr_noise(vTp.xy * 9. + vTp.z * 3.1) * vr_noise(vTp.zy * 8.3 - vTp.x * 2.7);
          diffuseColor.rgb *= .68 + .8 * lf;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(1., .62, .3) * uGlow * ${up.toFixed(2)} * .5 * pow(1. - clamp(vTp.y, 0., 1.), 2.5) * diffuseColor.rgb;`);
    };
    if (!set.leafy) cm.customProgramCacheKey = () => 'vr-tree-' + up;
    const crowns = new THREE.InstancedMesh(crown, cm, pts.length);
    const trunks = set.blob || set.noTrunk ? null : new THREE.InstancedMesh(trunkG, registerMaterial(stdMat({ color: '#4a3b2e', roughness: 1, envBase: 0.2 })), pts.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    // lush, varied canopies: deep greens with olive, blue-green and a few yellowish / copper crowns (limes, birches, plums)
    const pal = set.hue === 'young' ? ['#5a7a30', '#678a36', '#4f7030', '#739038', '#5f8038', '#80903a']
      : set.hue === 'site' ? ['#44652a', '#52702e', '#3b5a25', '#5f7534', '#4a6b31', '#6a7636', '#3e6030']
      : set.hue === 'garden' ? ['#3e5a26', '#4a642b', '#344f22', '#556c31', '#43602c', '#5e6a34', '#51692f', '#2f4a26', '#3a5a34', '#48602e']
      : ['#34501f', '#3d5823', '#2e481d', '#475a27', '#3a4e24', '#526030'];
    const rare = set.hue === 'garden' ? 0.975 : 2;   // a few copper-leaf plums / purple beeches in the gardens
    pts.forEach(([x, z, s = 1, y = 0], i) => {
      const h = (set.h[0] + rnd() * (set.h[1] - set.h[0])) * s, r = (set.r[0] + rnd() * (set.r[1] - set.r[0])) * s, th = (set.trunk[0] + rnd() * (set.trunk[1] - set.trunk[0])) * s;
      const ch = Math.max(1, h - th);
      // V4: fuller crowns that start lower on the trunk (the narrow crowns on tall sticks read as toy trees from above);
      // the path-traced hero stills (pano-work/hero) grow their trees from exactly these instance matrices
      const base = th * 0.72, rk = 1.22;
      o.position.set(x, y + base, z); o.rotation.set(0, rnd() * TAU, 0); o.scale.set(r * rk, ch + th * 0.85 - base, r * rk * (0.85 + rnd() * 0.3)); o.updateMatrix(); crowns.setMatrixAt(i, o.matrix);
      if (rnd() > rare) c.set(rnd() < 0.6 ? '#4a2c30' : '#5e5a2c'); else c.set(pal[Math.floor(rnd() * pal.length)]);
      c.offsetHSL((rnd() - 0.5) * 0.035, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.09 + 0.05); crowns.setColorAt(i, c);
      if (trunks) { o.position.set(x, y, z); o.scale.set(s * 1.1, th * 1.05, s * 1.1); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix); }
    });
    crowns.castShadow = set.cast; crowns.receiveShadow = set.cast;
    crowns.name = 'trees-' + (set.hue || 'far') + (set.leafy ? '-leafy' : set.blob ? '-blob' : '-crown'); crowns.userData.treeV = 2; crowns.computeBoundingSphere(); (set.g || group).add(crowns);
    if (trunks) { trunks.name = 'tree-trunks'; trunks.castShadow = set.cast; trunks.computeBoundingSphere(); (set.g || group).add(trunks); }
  }
}
