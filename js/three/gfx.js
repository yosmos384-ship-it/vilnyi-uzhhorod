// ЖК VILNYI (Uzhhorod) — V28 graphics pipeline for the outdoor worlds (GT drive, helicopter, city).
//
// One scene render into an HDR target (half float, depth texture, MSAA on high / ultra) and a short chain of full-screen
// passes, all written here (no EffectComposer — every pass reads the one depth texture, nothing renders the scene twice):
//   AO (depth-only, half res, bilateral blur) · SSR on wet / clean roads (ultra) · bloom (dual filter, 5 mips) ·
//   composite = depth of field (cut-scenes) + camera motion blur + AO + reflections + bloom → AgX / ACES tone mapping →
//   sRGB → colour grade LUT (32³, generated per light mode) → vignette, grain, letterbox · FXAA (tiers without MSAA).
// Plus a camera-fitted, texel-snapped sun shadow (one cascade around the car) and the tier table / setting.
// The 'low' tier and any failure fall back to the plain renderer.render() path (exactly the pre-V28 picture).
//
// Interface (walk.js / heli-app.js):
//   const g = createGfx(renderer, { world: 'drive' | 'heli', touch });
//   g.render(scene, camera, dt, { out, near, groundY })   out: an sRGB render target to draw into instead of the screen
//   g.setMode('day' | 'dusk' | 'night') · g.setQuality(q) · g.setCinema({ dof: {focus, range, amount} | null, bars: 0..1 })
//   g.attachSun(light, focusFn) · g.dispose() · g.q (resolved tier) · g.backend ('webgl2')
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const QUALITIES = ['low', 'medium', 'high', 'ultra'];
const LS = 'vrc.gfx.q';
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------------ setting (⋯ menu) + auto detection
export function qualitySetting() {
  try { const m = /[?&]gfx=(auto|low|medium|high|ultra|off)\b/.exec(location.search); if (m) return m[1] === 'off' ? 'low' : m[1]; } catch { /* */ }
  try { const v = localStorage.getItem(LS); if (v && (v === 'auto' || QUALITIES.includes(v))) return v; } catch { /* */ }
  return 'auto';
}
export function setQualitySetting(v) { try { localStorage.setItem(LS, v); } catch { /* private mode */ } }
export function gpuName(renderer) {
  try {
    const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
  } catch { return ''; }
}
/** auto tier: phones / tablets → medium (low on weak ones), desktops → high, strong desktop GPUs → ultra. */
export function autoQuality(renderer) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const mem = nav.deviceMemory || 8, cores = nav.hardwareConcurrency || 8;
  const g = gpuName(renderer);
  if (TOUCH) {
    if (mem <= 3 || /Mali-G5|Mali-T|Adreno \(TM\) [3-5]\d\d|PowerVR/i.test(g)) return 'low';   // (iOS reports few cores: not used)
    return 'medium';
  }
  if (/SwiftShader|llvmpipe|lavapipe|Software|Basic Render/i.test(g)) return 'medium';
  if (/RTX|RX ?[6-9]\d{3}|Radeon Pro|Apple M\d (Pro|Max|Ultra)|Apple M[3-9]|Arc A[57]/i.test(g)) return 'ultra';
  if (/Intel.*(HD|UHD) Graphics [1-6]\d\d\b|GMA|Mali|Adreno/i.test(g)) return 'medium';
  return 'high';
}
export function resolveQuality(renderer, s = qualitySetting()) { return s === 'auto' ? autoQuality(renderer) : s; }

// per tier: msaa samples, fxaa, bloom, ao (taps), motion blur, ssr, dof, shadow map size / half extent (m), grain, render scale
const TIERS = {
  low:    { post: false, probe: 0 },
  medium: { post: true, msaa: 0, fxaa: true,  bloom: 4, ao: 0,  mb: false, ssr: false, dof: true, shadow: 1024, extent: 45,  grain: 0.025, scale: 1, probe: 64, probeFaces: 1, probeEvery: 4 },
  high:   { post: true, msaa: 4, fxaa: false, bloom: 5, ao: 8,  mb: true,  ssr: 18,    dof: true, shadow: 2048, extent: 90,  grain: 0.02,  scale: 1, probe: 128, probeFaces: 1, probeEvery: 2 },
  ultra:  { post: true, msaa: 4, fxaa: false, bloom: 5, ao: 12, mb: true,  ssr: 28,    dof: true, shadow: 4096, extent: 140, grain: 0.018, scale: 1, probe: 256, probeFaces: 2, probeEvery: 1 },
};

// ------------------------------------------------------------------ colour grades (generated LUTs)
// lift / gamma / gain per channel in display space, saturation, contrast (S-curve around .5), warm/cool split toning,
// exposure bias in stops (applied before the tone curve), bloom amount, wetness of the roads (SSR mask), tone mapper.
const GRADES = {
  day:   { lift: [0.0, 0.004, 0.012], gamma: [1.02, 1.0, 0.99], gain: [1.04, 1.0, 0.95], sat: 1.12, con: 1.16, split: [0.03, 0.004], ev: -0.05, bloom: 0.045, thr: 1.6, wet: 0.12, tm: 'aces' },
  dusk:  { lift: [0.012, 0.006, 0.03], gamma: [0.98, 1.0, 1.03], gain: [1.07, 0.99, 0.94], sat: 1.15, con: 1.12, split: [0.04, -0.02], ev: 0.1, bloom: 0.08, thr: 1.0, wet: 0.55, tm: 'aces' },
  night: { lift: [0.006, 0.01, 0.028], gamma: [1.0, 1.0, 1.04], gain: [1.06, 1.0, 0.93], sat: 1.12, con: 1.14, split: [0.045, -0.03], ev: 0.2, bloom: 0.11, thr: 0.8, wet: 0.75, tm: 'aces' },
};
const LUT_N = 32;
function makeLut(G) {
  const n = LUT_N, data = new Uint8Array(n * n * n * 4);
  const sc = x => { const c = G.con; return x < 0.5 ? 0.5 * Math.pow(2 * x, c) : 1 - 0.5 * Math.pow(2 - 2 * x, c); };
  let i = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    let c = [r / (n - 1), g / (n - 1), b / (n - 1)];
    // lift / gamma / gain (ASC-CDL-like)
    c = c.map((v, k) => Math.pow(Math.max(0, G.gain[k] * (v + G.lift[k] * (1 - v))), 1 / G.gamma[k]));
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    // split toning: shadows cool (teal), highlights warm
    const sh = 1 - Math.min(1, l * 2), hi = Math.max(0, l * 2 - 1);
    c[0] += G.split[0] * hi + G.split[1] * sh * 0.5; c[2] += -G.split[0] * hi * 0.8 - G.split[1] * sh;
    c[1] += -G.split[1] * sh * 0.3;
    c = c.map(v => l + (v - l) * G.sat);
    c = c.map(v => sc(Math.min(1, Math.max(0, v))));
    data[i++] = Math.round(c[0] * 255); data[i++] = Math.round(c[1] * 255); data[i++] = Math.round(c[2] * 255); data[i++] = 255;
  }
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ shaders
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DEPTH = /* glsl */`
uniform sampler2D tDepth; uniform mat4 uProjInv; uniform float uNear, uFar;
float rawDepth(vec2 uv){ return texture2D(tDepth, uv).x; }
vec3 viewPos(vec2 uv, float d){ vec4 p = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
vec3 viewPos(vec2 uv){ return viewPos(uv, rawDepth(uv)); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewNormal(vec2 uv, vec3 P, vec2 px){
  vec3 r = viewPos(uv + vec2(px.x, 0.)), l = viewPos(uv - vec2(px.x, 0.)), t = viewPos(uv + vec2(0., px.y)), b = viewPos(uv - vec2(0., px.y));
  vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
  vec3 dy = abs(t.z - P.z) < abs(P.z - b.z) ? t - P : P - b;
  vec3 N = normalize(cross(dx, dy));
  return dot(N, P) > 0. ? -N : N;
}`;

const AO_FS = /* glsl */`
varying vec2 vUv; uniform vec2 uPx; uniform mat4 uProj; uniform float uRadius, uIntensity, uFade;
${DEPTH}
void main(){
  float d = rawDepth(vUv);
  if (d >= 0.99999) { gl_FragColor = vec4(1.); return; }
  vec3 P = viewPos(vUv, d), N = viewNormal(vUv, P, uPx);
  float rs = clamp(uRadius * uProj[1][1] * 0.5 / max(0.1, -P.z), 2.0 * uPx.y, 0.12);
  float a0 = ign(gl_FragCoord.xy) * 6.2832, occ = 0.;
  for (int i = 0; i < AO_TAPS; i++) {
    float fi = float(i), r = (fi + 0.5) / float(AO_TAPS);
    float an = a0 + fi * 2.39996;
    vec2 o = vec2(cos(an), sin(an)) * r * rs * vec2(uPx.y / uPx.x, 1.0);
    vec3 S = viewPos(vUv + o);
    vec3 v = S - P; float L = length(v);
    float fall = 1.0 - smoothstep(0.4, 1.0, L / uRadius);
    occ += max(0., dot(N, v / max(L, 1e-4)) - 0.08) * fall;
  }
  float ao = clamp(1.0 - uIntensity * occ / float(AO_TAPS), 0.0, 1.0);
  ao = mix(ao, 1.0, smoothstep(uFade * 0.5, uFade, -P.z));
  gl_FragColor = vec4(ao, -P.z, 0., 1.);
}`;
const AO_BLUR_FS = /* glsl */`
varying vec2 vUv; uniform sampler2D tAo; uniform vec2 uDir;
void main(){
  vec2 c = texture2D(tAo, vUv).xy; float s = c.x, w = 1.0;
  for (int i = -3; i <= 3; i++) { if (i == 0) continue;
    vec2 t = texture2D(tAo, vUv + uDir * float(i)).xy;
    float k = exp(-float(i * i) / 8.0) * (1.0 - smoothstep(0.0, 0.08 * c.y + 0.1, abs(t.y - c.y)));
    s += t.x * k; w += k; }
  gl_FragColor = vec4(s / w, c.y, 0., 1.);
}`;

const SSR_FS = /* glsl */`
varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uPx; uniform mat4 uProj, uViewInv; uniform float uWet, uGroundY, uTime;
${DEPTH}
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
vec2 proj(vec3 v){ vec4 c = uProj * vec4(v, 1.); return c.xy / c.w * 0.5 + 0.5; }
void main(){
  float d = rawDepth(vUv);
  if (d >= 0.99999) { gl_FragColor = vec4(0.); return; }
  vec3 P = viewPos(vUv, d), N = viewNormal(vUv, P, uPx);
  vec3 Nw = (uViewInv * vec4(N, 0.)).xyz, W = (uViewInv * vec4(P, 1.)).xyz;
  if (Nw.y < 0.9 || W.y > uGroundY + 0.6 || -P.z > 120.) { gl_FragColor = vec4(0.); return; }
  // puddles + damp asphalt: low-frequency world-space mask, always a little sheen on a clean road
  float m = smoothstep(0.42, 0.7, vn(W.xz * 0.12) * 0.65 + vn(W.xz * 0.5) * 0.35);
  float wet = clamp(uWet * (0.35 + 0.65 * m), 0.0, 1.0);
  { vec3 b0 = texture2D(tColor, vUv).rgb; float mx = max(b0.r, max(b0.g, b0.b)), mn = min(b0.r, min(b0.g, b0.b));
    wet *= 1.0 - smoothstep(0.2, 0.45, (mx - mn) / max(mx, 1e-4)); }   // grass / painted areas do not mirror: grey surfaces only
  if (wet < 0.02) { gl_FragColor = vec4(0.); return; }
  vec3 V = normalize(P), R = normalize(reflect(V, N));
  if (R.z > 0.2) { gl_FragColor = vec4(0.); return; }
  float t = 0.25 + ign(gl_FragCoord.xy) * 0.4, hit = 0.; vec2 huv = vec2(0.);
  vec3 Q = P;
  for (int i = 0; i < SSR_STEPS; i++) {
    Q = P + R * t; vec2 uv = proj(Q);
    if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1. || Q.z > -uNear) break;
    float sz = viewPos(uv).z;
    float dz = sz - Q.z;                    // > 0: the ray is behind the surface seen there
    if (dz > 0. && dz < 0.6 + t * 0.06) {
      // refine
      float a = t - (0.25 + t * 0.12), b = t;
      for (int k = 0; k < 4; k++) { float mm = 0.5 * (a + b); vec3 M = P + R * mm; vec2 u2 = proj(M); if (viewPos(u2).z - M.z > 0.) b = mm; else a = mm; }
      huv = proj(P + R * b); hit = 1.; break;
    }
    t += 0.25 + t * 0.12;
  }
  if (hit < 0.5) { gl_FragColor = vec4(0.); return; }
  vec2 e = smoothstep(0.0, 0.08, huv) * smoothstep(1.0, 0.92, huv);
  float fade = e.x * e.y * (1.0 - smoothstep(30., 120., -P.z)) * (1.0 - smoothstep(-0.2, 0.2, R.z));
  float cosT = max(0., dot(-V, N)), F = 0.02 + 0.98 * pow(1. - cosT, 5.);
  vec3 c = texture2D(tColor, huv).rgb;
  gl_FragColor = vec4(min(c, vec3(40.)), clamp(fade * wet * (0.25 + 0.75 * F) * 1.4, 0., 1.));
}`;

const PRE_FS = /* glsl */`
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uPx; uniform float uThr;
void main(){
  vec3 c = vec3(0.);
  c += texture2D(tSrc, vUv + uPx * vec2(-1., -1.)).rgb; c += texture2D(tSrc, vUv + uPx * vec2(1., -1.)).rgb;
  c += texture2D(tSrc, vUv + uPx * vec2(-1., 1.)).rgb; c += texture2D(tSrc, vUv + uPx * vec2(1., 1.)).rgb;
  c *= 0.25; c = min(c, vec3(60.));
  float l = max(c.r, max(c.g, c.b)), k = uThr * 0.5;
  float s = clamp(l - uThr + k, 0., 2. * k); s = s * s / (4. * k + 1e-4);
  gl_FragColor = vec4(c * max(s, l - uThr) / max(l, 1e-4), 1.);
}`;
const DOWN_FS = /* glsl */`
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uPx;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 4.;
  c += texture2D(tSrc, vUv + uPx * vec2(-1., -1.)).rgb; c += texture2D(tSrc, vUv + uPx * vec2(1., -1.)).rgb;
  c += texture2D(tSrc, vUv + uPx * vec2(-1., 1.)).rgb; c += texture2D(tSrc, vUv + uPx * vec2(1., 1.)).rgb;
  gl_FragColor = vec4(c / 8., 1.);
}`;
const UP_FS = /* glsl */`
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uPx;
void main(){
  vec3 c = vec3(0.);
  c += texture2D(tSrc, vUv + uPx * vec2(-2., 0.)).rgb; c += texture2D(tSrc, vUv + uPx * vec2(2., 0.)).rgb;
  c += texture2D(tSrc, vUv + uPx * vec2(0., -2.)).rgb; c += texture2D(tSrc, vUv + uPx * vec2(0., 2.)).rgb;
  c += texture2D(tSrc, vUv + uPx * vec2(-1., -1.)).rgb * 2.; c += texture2D(tSrc, vUv + uPx * vec2(1., -1.)).rgb * 2.;
  c += texture2D(tSrc, vUv + uPx * vec2(-1., 1.)).rgb * 2.; c += texture2D(tSrc, vUv + uPx * vec2(1., 1.)).rgb * 2.;
  gl_FragColor = vec4(c / 12., 1.);
}`;

const COMP_FS = /* glsl */`
varying vec2 vUv;
uniform sampler2D tScene, tAo, tSsr, tBloom; uniform sampler3D tLut;
uniform vec2 uPx; uniform float uBloom, uAoK, uGrain, uTime, uBars, uVig, uEv;
uniform mat4 uPrevVP, uViewInvP; uniform float uMbK, uMbNear;
uniform vec3 uDof; // focus distance (m), range (m), max radius (px)
${DEPTH}
${THREE.ShaderChunk.tonemapping_pars_fragment}
float viewZ(vec2 uv){ return -viewPos(uv).z; }
void main(){
  vec2 uv = vUv;
  vec3 c = texture2D(tScene, uv).rgb;
  float d = rawDepth(uv);
  float z = -viewPos(uv, d).z;
#ifdef DOF
  if (uDof.z > 0.5) {
    float coc = clamp(abs(z - uDof.x) / max(uDof.y, 0.01) - 1.0, 0.0, 1.0) * uDof.z;
    if (d >= 0.99999) coc = uDof.z;
    if (coc > 0.6) {
      vec3 acc = c; float w = 1.; float a0 = ign(gl_FragCoord.xy) * 6.2832;
      for (int i = 0; i < 16; i++) { float fi = float(i), r = sqrt((fi + 0.5) / 16.) * coc, an = a0 + fi * 2.39996;
        vec2 o = vec2(cos(an), sin(an)) * r * uPx; vec3 s = texture2D(tScene, uv + o).rgb;
        float zs = viewZ(uv + o); float k = zs < z - 1.0 ? smoothstep(0.0, 1.0, (abs(zs - uDof.x) / max(uDof.y, 0.01) - 1.0) * uDof.z / max(r, 1.)) : 1.0;
        acc += s * k; w += k; }
      c = acc / w;
    }
  }
#endif
#ifdef MB
  if (uMbK > 0.001 && d < 0.99999 && z > uMbNear) {
    vec4 wp = uViewInvP * vec4(vec3(uv, d) * 2. - 1., 1.); wp /= wp.w;
    vec4 pp = uPrevVP * wp; vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
    vec2 vel = (uv - puv) * uMbK * smoothstep(uMbNear, uMbNear + 4., z);
    float L = length(vel / uPx); if (L > 40.) vel *= 40. / L;
    if (L > 1.0) { vec3 acc = c; float n = 1.; float j = ign(gl_FragCoord.xy) - 0.5;
      for (int i = 1; i <= 8; i++) { float f = (float(i) + j) / 8. - 0.5; vec2 q = uv - vel * f;
        if (viewZ(q) > uMbNear) { acc += texture2D(tScene, q).rgb; n += 1.; } }
      c = acc / n; }
  }
#endif
#ifdef SSR
  vec4 rf = texture2D(tSsr, uv); c = mix(c, rf.rgb, rf.a);
#endif
#ifdef AO
  float ao = texture2D(tAo, uv).x; c *= mix(1.0, ao, uAoK);
#endif
#ifdef BLOOM
  c += texture2D(tBloom, uv).rgb * uBloom;
#endif
  c *= exp2(uEv);
#ifdef ACES
  c = ACESFilmicToneMapping(c);
#else
  c = AgXToneMapping(c);
#endif
  c = sRGBTransferOETF(vec4(c, 1.)).rgb;
  c = texture(tLut, c * (float(LUT_N) - 1.) / float(LUT_N) + 0.5 / float(LUT_N)).rgb;
  vec2 q = uv - 0.5; c *= 1.0 - uVig * dot(q, q) * 1.6;
  c += (ign(gl_FragCoord.xy + fract(uTime * 7.3) * 113.) - 0.5) * uGrain;
  if (uBars > 0.) { float b = uBars * 0.11; if (uv.y < b || uv.y > 1. - b) c = vec3(0.); }
  gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
}`;

const FXAA_FS = /* glsl */`
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uPx;
float lu(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 rgbM = texture2D(tSrc, vUv).rgb;
  vec3 nw = texture2D(tSrc, vUv + vec2(-1., -1.) * uPx).rgb, ne = texture2D(tSrc, vUv + vec2(1., -1.) * uPx).rgb;
  vec3 sw = texture2D(tSrc, vUv + vec2(-1., 1.) * uPx).rgb, se = texture2D(tSrc, vUv + vec2(1., 1.) * uPx).rgb;
  float lNW = lu(nw), lNE = lu(ne), lSW = lu(sw), lSE = lu(se), lM = lu(rgbM);
  float mn = min(lM, min(min(lNW, lNE), min(lSW, lSE))), mx = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (mx - mn < max(0.0312, mx * 0.125)) { gl_FragColor = vec4(rgbM, 1.); return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.), vec2(8.)) * uPx;
  vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1. / 3. - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2. / 3. - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lb = lu(b);
  gl_FragColor = vec4((lb < mn || lb > mx) ? a : b, 1.);
}`;

const mat = (fs, uniforms, defines = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
const rt = (w, h, o = {}) => { const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, depthBuffer: false, ...o });
  t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter; t.texture.generateMipmaps = false; return t; };

// ------------------------------------------------------------------ the pipeline
export function createGfx(renderer, opts = {}) {
  const world = opts.world || 'drive', extentK = opts.extentK || 1;
  let setting = qualitySetting(), q = resolveQuality(renderer, setting), T = TIERS[q];
  let mode = 'day', G = GRADES.day, dead = false, failed = 0;
  const luts = {}; const lutOf = m => (luts[m] ||= makeLut(GRADES[m] || GRADES.day));
  const quad = new FullScreenQuad(null);
  const vp = new THREE.Vector4(), size = new THREE.Vector2();
  let W = 0, H = 0, R = null;          // targets
  const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4(), viewInvP = new THREE.Matrix4();
  let havePrev = false, time = 0;
  const cine = { dof: null, bars: 0, barsT: 0 };
  const sunS = { light: null, focus: null, savedMap: null };
  const depthU = () => ({ tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uNear: { value: 0.1 }, uFar: { value: 1000 } });
  let M = null;
  const S = { lastMs: 0, frames: 0 };

  function buildMaterials() {
    disposeMaterials();
    const def = { LUT_N };
    if (T.ao) def.AO = 1; if (T.ssr) def.SSR = 1; if (T.bloom) def.BLOOM = 1; if (T.mb) def.MB = 1; if (T.dof) def.DOF = 1;
    if (G.tm === 'aces') def.ACES = 1;
    M = {
      ao: T.ao ? mat(AO_FS, { ...depthU(), uPx: { value: new THREE.Vector2() }, uProj: { value: new THREE.Matrix4() }, uRadius: { value: 1.2 }, uIntensity: { value: 1.6 }, uFade: { value: 160 } }, { AO_TAPS: T.ao }) : null,
      aoBlur: T.ao ? mat(AO_BLUR_FS, { tAo: { value: null }, uDir: { value: new THREE.Vector2() } }) : null,
      ssr: T.ssr ? mat(SSR_FS, { ...depthU(), tColor: { value: null }, uPx: { value: new THREE.Vector2() }, uProj: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uWet: { value: 0 }, uGroundY: { value: 0 }, uTime: { value: 0 } }, { SSR_STEPS: T.ssr }) : null,
      pre: T.bloom ? mat(PRE_FS, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uThr: { value: 1 } }) : null,
      down: T.bloom ? mat(DOWN_FS, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } }) : null,
      up: T.bloom ? mat(UP_FS, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } }) : null,
      comp: mat(COMP_FS, { ...depthU(), tScene: { value: null }, tAo: { value: null }, tSsr: { value: null }, tBloom: { value: null }, tLut: { value: lutOf(mode) },
        uPx: { value: new THREE.Vector2() }, uBloom: { value: 0 }, uAoK: { value: 0.75 }, uGrain: { value: T.grain || 0 }, uTime: { value: 0 }, uBars: { value: 0 }, uVig: { value: 0.32 }, uEv: { value: 0 },
        uPrevVP: { value: new THREE.Matrix4() }, uViewInvP: { value: new THREE.Matrix4() }, uMbK: { value: 0 }, uMbNear: { value: 5 }, uDof: { value: new THREE.Vector3() },
        toneMappingExposure: { value: 1 } }, def),
      fxaa: T.fxaa ? mat(FXAA_FS, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } }) : null,
    };
    if (M.up) { M.up.blending = THREE.AdditiveBlending; M.up.transparent = true; }
  }
  function disposeMaterials() { if (M) for (const k in M) if (M[k]) M[k].dispose(); M = null; }
  function disposeTargets() { if (R) { for (const k in R) { const v = R[k]; if (Array.isArray(v)) v.forEach(t => t.dispose()); else if (v) v.dispose(); } } R = null; W = H = 0; }
  function ensureTargets(w, h) {
    if (R && w === W && h === H) return;
    disposeTargets(); W = w; H = h;
    const scene = rt(w, h, { depthBuffer: true, samples: T.msaa || 0 });
    scene.depthTexture = new THREE.DepthTexture(w, h); scene.depthTexture.type = THREE.UnsignedIntType;
    scene.depthTexture.minFilter = scene.depthTexture.magFilter = THREE.NearestFilter;
    R = { scene, ao: null, ao2: null, ssr: null, bloom: [], ldr: null };
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    if (T.ao) { R.ao = rt(hw, hh, { type: THREE.HalfFloatType }); R.ao2 = rt(hw, hh, { type: THREE.HalfFloatType }); }
    if (T.ssr) R.ssr = rt(hw, hh);
    if (T.bloom) for (let i = 0, bw = hw, bh = hh; i < T.bloom; i++, bw = Math.max(1, bw >> 1), bh = Math.max(1, bh >> 1)) R.bloom.push(rt(bw, bh));
    if (T.fxaa) { R.ldr = rt(w, h, { type: THREE.UnsignedByteType }); }
  }
  function setDepthU(m, cam) {
    m.uniforms.tDepth.value = R.scene.depthTexture; m.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    m.uniforms.uNear.value = cam.near; m.uniforms.uFar.value = cam.far;
  }
  const pass = (m, target) => { quad.material = m; renderer.setRenderTarget(target); quad.render(renderer); };
  // shadow flags for everything that streams into the scene (city chunks, traffic, people): receive on lit opaque meshes,
  // cast on the ones taller than 0.35 m (road decals and markings do not cast). Checked every 2.5 s while shadows are on.
  let castT = 0; const _sz = new THREE.Vector3();
  function markCasters(scene) {
    const now = performance.now(); if (now - castT < 2500) return; castT = now;
    scene.traverse(o => {
      if (!o.isMesh || o.userData._gfxC) return;
      o.userData._gfxC = 1;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.isShaderMaterial || m.isMeshBasicMaterial || m.transparent || o.renderOrder < -100) return;
      o.receiveShadow = true;
      const gm = o.geometry; if (!gm) return;
      if (!gm.boundingBox) gm.computeBoundingBox();
      gm.boundingBox.getSize(_sz);
      if (_sz.y > 0.35 || o.isSkinnedMesh || o.isInstancedMesh) o.castShadow = true;
    });
  }

  // ---- sun shadow fitted around the car (one cascade), texel snapped so it does not shimmer when the camera moves
  const _f = new THREE.Vector3(), _ld = new THREE.Vector3(), _m = new THREE.Matrix4(), _p = new THREE.Vector3();
  function sunTick(camera) {
    const L = sunS.light; if (!L || !T.shadow) return;
    const f = sunS.focus ? sunS.focus(_f) : _f.copy(camera.position);
    if (!f) return;
    const ext = T.extent * extentK;
    _ld.copy(L.position).sub(L.target.position).normalize();
    if (_ld.y < 0.12) { L.castShadow = false; return; }       // sun at / under the horizon: no sun shadows (dusk, night ambience)
    L.castShadow = true;
    const sc = L.shadow.camera;
    if (L.shadow.mapSize.x !== T.shadow) { L.shadow.mapSize.set(T.shadow, T.shadow); if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; } }
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = ext * 6; sc.updateProjectionMatrix();
    // snap the focus to whole shadow texels in light space
    const texel = (2 * ext) / T.shadow;
    _m.lookAt(_p.set(0, 0, 0), _ld.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = _m.clone().invert();
    _p.copy(f).applyMatrix4(inv); _p.x = Math.round(_p.x / texel) * texel; _p.y = Math.round(_p.y / texel) * texel; _p.applyMatrix4(_m);
    L.target.position.copy(_p); L.position.copy(_p).addScaledVector(_ld, ext * 3);
    // the hosts freeze static matrices (matrixAutoUpdate = false): recompute both explicitly
    L.target.updateMatrix(); L.target.updateMatrixWorld(true); L.updateMatrix(); L.updateMatrixWorld(true);
    L.shadow.bias = -0.0004 * (T.shadow / 2048); L.shadow.normalBias = 0.05 + texel * 0.6; L.shadow.radius = 2;
  }

  // 'auto' only: a tier that cannot hold ≈ 26 fps for 4 s steps down once every 8 s (ultra → high → medium → low).
  // Off in automated browsers (tests set the tier themselves), as js/three/dynres.js.
  const AUTO_OK = !(typeof navigator !== 'undefined' && navigator.webdriver);
  const perf = { ema: 1 / 60, n: 0, cool: 0 };
  function autoStep(dt) {
    if (!AUTO_OK || setting !== 'auto' || dt > 0.25) return;
    perf.ema += (dt - perf.ema) * 0.03; perf.n++;
    const now = performance.now();
    if (perf.n > 240 && now > perf.cool && perf.ema > 1 / 26) {
      const i = QUALITIES.indexOf(q);
      if (i > 0) { q = QUALITIES[i - 1]; T = TIERS[q]; disposeTargets(); buildMaterials(); havePrev = false; if (sunS.light) applyShadowMode(); api.q = q; console.info('[gfx] auto quality →', q); }
      perf.n = 0; perf.cool = now + 8000; perf.ema = 1 / 40;
    }
  }
  function render(scene, camera, dt = 1 / 60, o = {}) {
    if (dead) return renderer.render(scene, camera);
    autoStep(dt);
    if (!T.post) { sunTick(camera); probeTick(scene); return renderer.render(scene, camera); }
    try {
      const t0 = performance.now();
      time += dt;
      const out = o.out || null;
      let w, h;
      if (out) { w = out.width; h = out.height; }
      else { renderer.getViewport(vp); const pr = renderer.getPixelRatio(); w = Math.round(vp.z * pr); h = Math.round(vp.w * pr); }
      ensureTargets(Math.max(2, Math.round(w * (T.scale || 1))), Math.max(2, Math.round(h * (T.scale || 1))));
      sunTick(camera); if (T.shadow && sunS.light) markCasters(scene);
      probeTick(scene);
      // scene → HDR target (three applies no tone mapping / sRGB into a plain render target: linear HDR)
      const prevTarget = renderer.getRenderTarget(), ac = renderer.autoClear;
      renderer.setRenderTarget(R.scene); renderer.autoClear = true; renderer.clear(); renderer.render(scene, camera);
      const px = M.comp.uniforms.uPx.value.set(1 / W, 1 / H);
      // AO
      if (M.ao) {
        setDepthU(M.ao, camera); M.ao.uniforms.uPx.value.set(1 / W, 1 / H); M.ao.uniforms.uProj.value.copy(camera.projectionMatrix);
        pass(M.ao, R.ao);
        M.aoBlur.uniforms.tAo.value = R.ao.texture; M.aoBlur.uniforms.uDir.value.set(1 / R.ao.width, 0); pass(M.aoBlur, R.ao2);
        M.aoBlur.uniforms.tAo.value = R.ao2.texture; M.aoBlur.uniforms.uDir.value.set(0, 1 / R.ao.height); pass(M.aoBlur, R.ao);
      }
      // SSR
      if (M.ssr) {
        setDepthU(M.ssr, camera); const u = M.ssr.uniforms;
        u.tColor.value = R.scene.texture; u.uPx.value.set(1 / W, 1 / H); u.uProj.value.copy(camera.projectionMatrix); u.uViewInv.value.copy(camera.matrixWorld);
        u.uWet.value = o.wet ?? G.wet; u.uGroundY.value = o.groundY ?? 0; u.uTime.value = time;
        pass(M.ssr, R.ssr);
      }
      // bloom
      if (M.pre) {
        const B = R.bloom;
        M.pre.uniforms.tSrc.value = R.scene.texture; M.pre.uniforms.uPx.value.set(0.5 / W, 0.5 / H); M.pre.uniforms.uThr.value = G.thr; pass(M.pre, B[0]);
        for (let i = 1; i < B.length; i++) { M.down.uniforms.tSrc.value = B[i - 1].texture; M.down.uniforms.uPx.value.set(1 / B[i - 1].width, 1 / B[i - 1].height); pass(M.down, B[i]); }
        renderer.autoClear = false;
        for (let i = B.length - 1; i > 0; i--) { M.up.uniforms.tSrc.value = B[i].texture; M.up.uniforms.uPx.value.set(0.5 / B[i].width, 0.5 / B[i].height); pass(M.up, B[i - 1]); }
        renderer.autoClear = true;
      }
      // composite
      const C = M.comp, cu = C.uniforms;
      setDepthU(C, camera);
      cu.tScene.value = R.scene.texture; cu.tAo.value = R.ao ? R.ao.texture : null; cu.tSsr.value = R.ssr ? R.ssr.texture : null; cu.tBloom.value = R.bloom.length ? R.bloom[0].texture : null;
      cu.tLut.value = lutOf(mode); cu.uBloom.value = G.bloom * (o.bloomK ?? 1); cu.uTime.value = time; cu.uEv.value = G.ev; cu.toneMappingExposure.value = renderer.toneMappingExposure;
      cine.bars += (cine.barsT - cine.bars) * Math.min(1, dt * 3); cu.uBars.value = cine.bars < 0.002 ? 0 : cine.bars;
      const dof = cine.dof; cu.uDof.value.set(dof ? dof.focus : 0, dof ? (dof.range || 3) : 1, dof && T.dof ? (dof.amount ?? 8) * (W / 1280) : 0);
      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      viewInvP.copy(curVP).invert();
      cu.uViewInvP.value.copy(viewInvP); cu.uPrevVP.value.copy(havePrev ? prevVP : curVP);
      cu.uMbK.value = T.mb && havePrev && !o.noBlur ? Math.min(1, 0.55 / Math.max(1 / 240, dt) / 60) : 0;
      cu.uMbNear.value = o.near ?? 6;
      prevVP.copy(curVP); havePrev = true;
      if (M.fxaa) { pass(C, R.ldr); M.fxaa.uniforms.tSrc.value = R.ldr.texture; M.fxaa.uniforms.uPx.value.set(1 / W, 1 / H); pass(M.fxaa, out); }
      else pass(C, out);
      renderer.setRenderTarget(out ? prevTarget === out ? out : prevTarget : null); renderer.autoClear = ac;
      if (out) renderer.setRenderTarget(null);
      S.lastMs = performance.now() - t0; S.frames++;
      return px;
    } catch (e) {
      console.warn('[gfx] post-processing failed, plain rendering from now on', e);
      if (++failed > 2) { dead = true; }
      renderer.setRenderTarget(null);
      return renderer.render(scene, camera);
    }
  }

  function setQuality(v) {
    setting = v || 'auto';
    const nq = resolveQuality(renderer, setting);
    if (nq === q && M) return q;
    q = nq; T = TIERS[q]; disposeTargets(); buildMaterials(); havePrev = false;
    if (sunS.light) applyShadowMode();
    api.q = q;
    return q;
  }
  function setMode(m) { mode = GRADES[m] ? m : 'day'; const tm0 = G.tm; G = GRADES[mode]; if (G.tm !== tm0) buildMaterials(); }
  function setCinema(c = {}) { if ('dof' in c) cine.dof = c.dof; if ('bars' in c) cine.barsT = c.bars || 0; }
  // the renderer's shadow map follows the tier; restored on detach / dispose
  function applyShadowMode() {
    const on = !!T.shadow;
    if (renderer.shadowMap.enabled !== on) { renderer.shadowMap.enabled = on; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.needsUpdate = true; }
    if (sunS.light) sunS.light.castShadow = on;
  }
  function attachSun(light, focusFn) {
    if (sunS.light === light) { sunS.focus = focusFn || sunS.focus; return; }
    detachSun();
    sunS.light = light; sunS.focus = focusFn || null;
    sunS.saved = { cast: light.castShadow, map: light.shadow.mapSize.clone(), shadowMap: renderer.shadowMap.enabled, type: renderer.shadowMap.type,
      cam: { l: light.shadow.camera.left, r: light.shadow.camera.right, t: light.shadow.camera.top, b: light.shadow.camera.bottom, n: light.shadow.camera.near, f: light.shadow.camera.far },
      bias: light.shadow.bias, nb: light.shadow.normalBias, pos: light.position.clone(), tgt: light.target.position.clone() };
    applyShadowMode();
  }
  function detachSun() {
    const L = sunS.light, s = sunS.saved; if (!L || !s) { sunS.light = null; return; }
    L.castShadow = s.cast; L.shadow.mapSize.copy(s.map); if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; }
    const c = L.shadow.camera; c.left = s.cam.l; c.right = s.cam.r; c.top = s.cam.t; c.bottom = s.cam.b; c.near = s.cam.n; c.far = s.cam.f; c.updateProjectionMatrix();
    L.shadow.bias = s.bias; L.shadow.normalBias = s.nb; L.position.copy(s.pos); L.target.position.copy(s.tgt);
    renderer.shadowMap.enabled = s.shadowMap; renderer.shadowMap.type = s.type; renderer.shadowMap.needsUpdate = true;
    sunS.light = null; sunS.saved = null;
  }
  // ---- reflection probe: a small cube map of the street around the car, one face per frame (round robin), used as the
  // envMap of the car materials (paint, glass, chrome, wheels) → the cars reflect the real buildings, lamps and sky
  const probe = { rt: null, cams: null, face: 0, mats: null, pos: null, hide: null, size: 0, base: new Map(), n: 0 };
  function attachProbe({ mats, pos, hide } = {}) { probe.mats = mats; probe.pos = pos; probe.hide = hide; }
  function probeTick(scene) {
    const size = T.probe || 0;
    if (!size || !probe.mats || !probe.pos) { probeRestore(); return; }
    if (!probe.rt || probe.size !== size) {
      if (probe.rt) probe.rt.dispose();
      probe.size = size;
      probe.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      probe.cam = new THREE.CubeCamera(0.5, 600, probe.rt);
      probe.face = 0; probe.n = 0;
    }
    probe.tick = (probe.tick || 0) + 1;
    if (probe.n >= 6 && probe.tick % (T.probeEvery || 1)) return;
    if (!probe.pos(probe.cam.position)) return;
    probe.cam.updateMatrixWorld(true);
    const hidden = (probe.hide && probe.hide()) || [], vis = hidden.map(o => o.visible);
    hidden.forEach(o => { o.visible = false; });
    const cams = probe.cam.children, prevT = renderer.getRenderTarget(), xr = renderer.xr.enabled; renderer.xr.enabled = false;
    const steps = probe.n < 6 ? 6 : (T.probeFaces || 1);            // all six faces on the first frame, then round robin
    for (let k = 0; k < steps; k++) {
      const f = probe.face; probe.face = (probe.face + 1) % 6;
      renderer.setRenderTarget(probe.rt, f); renderer.clear(); renderer.render(scene, cams[f]);
    }
    renderer.setRenderTarget(prevT); renderer.xr.enabled = xr;
    hidden.forEach((o, i) => { o.visible = vis[i]; });
    probe.n += steps;
    probe.rt.texture.needsPMREMUpdate = true;
    for (const m of probe.mats()) {
      if (!m || !('envMap' in m)) continue;
      if (!probe.base.has(m)) probe.base.set(m, m.envMap);
      if (m.envMap !== probe.rt.texture) { m.envMap = probe.rt.texture; m.needsUpdate = true; }
    }
  }
  function probeRestore() {
    for (const [m, e] of probe.base) { m.envMap = e; m.needsUpdate = true; }
    probe.base.clear();
  }
  function detachProbe() { probeRestore(); probe.mats = probe.pos = probe.hide = null; }

  function dispose() { detachProbe(); if (probe.rt) probe.rt.dispose(); detachSun(); disposeTargets(); disposeMaterials(); for (const k in luts) luts[k].dispose(); quad.dispose(); dead = true; }

  buildMaterials();
  const api = { q, backend: 'webgl2', world, render, setQuality, setMode, setCinema, attachSun, detachSun, attachProbe, detachProbe, dispose,
    get setting() { return setting; }, get stats() { return { ...S, W, H, tier: q }; }, get alive() { return !dead; }, reset() { havePrev = false; } };
  return api;
}
