// ЖК VILNYI (Uzhhorod) — photoreal 360° tour (Matterport-style). Path-traced equirectangular panoramas (Blender Cycles,
// rendered offline from the same procedural scenes as the live 3D walkthrough — see pano-work/) on a light three.js viewer:
// drag / swipe to look, wheel / pinch to zoom, gold floor rings to glide between standing points (re-projected cross-fade
// with a slight zoom), room chips, style switcher, minimap from the room polygons, Reserve, and a Photo-real ↔ Live 3D toggle.
//
//   export async function openPanoTour(container, { unitId, styleId, mode, room, pointId, yaw, i18n, lang, dir,
//                                                   onExit(state), onReserve(unitId), onSwitchTo3D(state) })
//     → { ok, setStyle(id), setMode('day'|'dusk'|'night'), getState(), dispose(), styles, modes, mode, pointId }
//   export const tourReady: Promise<manifest>;  export function hasTour(typeId[, styleId]) → boolean (after tourReady)
//   export function tourInfo(typeId) → { type, mapped, refUnit, styles[], modes[] } | null      (after tourReady)
//
// The style switch offers only the styles of PROJECT.styles (data.js) that have panoramas; the light switch offers the
// modes (day / dusk / night) rendered for the current scene. Switching style, light or point keeps the view direction.
//
// Manifest: assets/tour/tour.json (written by pano-work/build_tour.py)
//   types[typeId]  = { refUnit, width, depth, azimuth, rooms:[{kind,name,level,poly:[[u,v]…]}],
//                      styles:{ styleId:{ points:[…], modes:{ day:{points:[…]}, dusk:{…}, night:{…} } } } }
//   types[typeId]  = { mapTo: otherTypeId }   → the panoramas of a representative layout ("sample apartment" badge)
//   commons[key]   = { building, floor, frame:'building', points:[…], modes:{…} }      (key: lobby | corridor | parking)
//   commonsBy[bId][key] = same, per building; the viewer uses the unit's building, else `commons`
//   point = { id, room, level, pos:[u, v, y], yawOffset, links:[{ to, yaw, dist }], img:{ '2k': path, '4k': path } }
//   pos is unit-local (types) or building-local x/z (commons); y = floor height of the level; the camera sat at y + eye.
// Projection: image centre = +v (+z) of the scene frame, left quarter = +u; yaw = three.js camera rotation.y (+ yawOffset).
import * as THREE from 'three';
import { unitById, unitLabel, corridorsOf, coresOf, PROJECT, UNITS, TYPES, plateOf, interiorOf, unitToLocal } from './data.js';
import { tt, RTL } from './i18n-tour.js';

const MANIFEST_URL = new URL('../assets/tour/tour.json', import.meta.url);
const ASSET_BASE = new URL('../assets/tour/', import.meta.url);
let MAN = null;
export const tourReady = fetch(MANIFEST_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
  .then(m => (MAN = m && m.types ? m : { types: {}, commons: {} }));
const MODES = ['day', 'dusk', 'night'];
// a layout without its own renders points to a representative one (mapTo); follow the chain (at most a few steps)
function resolveType(man, typeId) {
  let id = typeId, t = man && man.types && id ? man.types[id] : null, n = 0;
  while (t && t.mapTo && n++ < 4) { id = t.mapTo; t = man.types[id]; }
  return t && t.styles ? { id, t, mapped: id !== typeId } : null;
}
// light modes of one style / commons entry: { mode: points[] } (a manifest without modes is one 'day' set)
function modesOf(e) {
  const out = {};
  if (e && e.modes) for (const m of MODES) { const P = e.modes[m] && e.modes[m].points; if (P && P.length) out[m] = P; }
  if (!Object.keys(out).length && e && e.points && e.points.length) out.day = e.points;
  return out;
}
// the styles offered: PROJECT.styles (ids or {id}) when the project lists them, else what the manifest has (at most four)
function allowedStyles(have) {
  const list = PROJECT && Array.isArray(PROJECT.styles) && PROJECT.styles.length ? PROJECT.styles.map(s => (typeof s === 'string' ? s : s && s.id)).filter(Boolean) : null;
  return (list ? list.filter(s => have.includes(s)) : have).slice(0, 4);
}
// The manifest layout that serves a layout: its own panoramas, the manifest's `mapTo`, or — when the manifest names
// nothing — the rendered layout with the same number of rooms and the nearest total area ("sample apartment").
const _typeMeta = (() => { let M = null; return k => { if (!M) { M = {}; for (const u of UNITS) if (!M[u.type]) M[u.type] = { rooms: u.rooms, area: (TYPES[u.type] && TYPES[u.type].total) || 0 }; } return M[k] || null; }; })();
const _hasPanos = t => !!(t && t.styles && Object.keys(t.styles).some(k => Object.keys(modesOf(t.styles[k])).length));
function repType(man, typeId) {
  const own = resolveType(man, typeId);
  if (own && _hasPanos(own.t)) return own;
  const me = _typeMeta(typeId); if (!me || !man || !man.types) return null;
  let best = null, bd = Infinity;
  for (const k of Object.keys(man.types)) {
    const t = man.types[k]; if (t.mapTo || !_hasPanos(t)) continue;
    const o = _typeMeta(k); if (!o || o.rooms !== me.rooms) continue;
    const d = Math.abs(o.area - me.area); if (d < bd) { bd = d; best = k; }
  }
  return best ? { id: best, t: man.types[best], mapped: true } : null;
}
/** After tourReady: the layout whose panoramas a layout is shown with → { type, mapped } | null. */
export function tourTypeFor(typeId) { const r = repType(MAN, typeId); return r ? { type: r.id, mapped: r.mapped } : null; }
/** After tourReady: the common-area panoramas of a building → { lobby?, corridor?, parking? } (manifest entries) | null. */
export function tourCommons(bId) { return (MAN && MAN.commonsBy && MAN.commonsBy[bId]) || null; }
// the last state handed to onSwitchTo3D / onExit (walk.js reads it when the page opens the walkthrough afterwards)
function stash(state) { try { window.VRC_TOUR_LAST = { t: Date.now(), state }; } catch { /* no window */ } return state; }
export function hasTour(typeId, styleId) {
  const r = repType(MAN, typeId); if (!r) return false;
  const st = r.t.styles || {};
  const ok = s => !!(st[s] && Object.keys(modesOf(st[s])).length);
  return styleId ? ok(styleId) : Object.keys(st).some(ok);
}
export function tourInfo(typeId) {
  const r = repType(MAN, typeId); if (!r) return null;
  const styles = allowedStyles(Object.keys(r.t.styles || {}).filter(s => Object.keys(modesOf(r.t.styles[s])).length));
  const modes = MODES.filter(m => styles.some(s => modesOf(r.t.styles[s])[m]));
  return styles.length ? { type: r.id, mapped: r.mapped, refUnit: r.t.refUnit, styles, modes } : null;
}
const FOV0 = 78, FOV_MIN = 32, FOV_MAX = 100;
const COMMONS = ['lobby', 'corridor', 'parking'];
const ROOM_ORDER = ['hall', 'living', 'kitchen', 'bedroom', 'dressing', 'bath', 'storage', 'balcony', 'loggia', 'terrace'];

const CSS = `
.pt{position:absolute;inset:0;overflow:hidden;background:#050505;color:#f3ead7;font-family:"Manrope","Inter Tight","Heebo","Assistant",system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;--g:#c9a45c;--g2:#e6c987;--bg:rgba(8,8,8,.62);--ln:rgba(201,164,92,.42);
  --st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px)}
.pt *{box-sizing:border-box}
.pt button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;touch-action:manipulation}
.pt canvas.pt-gl{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.pt canvas.pt-gl.drag{cursor:grabbing}.pt canvas.pt-gl.hot{cursor:pointer}
.pt-p{background:var(--bg);-webkit-backdrop-filter:blur(12px) saturate(1.15);backdrop-filter:blur(12px) saturate(1.15);border:1px solid var(--ln);border-radius:12px}
.pt-title{position:absolute;top:calc(10px + var(--st));inset-inline-start:10px;padding:6px 12px 7px;max-width:min(46vw,440px);pointer-events:none}
.pt-title .t1{font-family:"Cormorant Garamond","Bodoni Moda",Georgia,serif;font-size:18px;line-height:1.15;letter-spacing:.04em;color:var(--g2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-title .t2{font-size:11.5px;line-height:1.3;opacity:.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext}
.pt-badge{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:999px;font-size:10.5px;background:rgba(201,164,92,.16);border:1px solid var(--ln);color:var(--g2);white-space:nowrap}
.pt-badge[hidden]{display:none}
.pt-exit{position:absolute;top:calc(10px + var(--st));inset-inline-end:10px;height:36px;padding:0 14px 0 11px;display:flex;align-items:center;gap:7px;font-size:12.5px;letter-spacing:.03em}
.pt-exit svg{width:14px;height:14px}
.pt-exit:hover{border-color:var(--g)}
.pt-side{position:absolute;inset-inline-end:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px}
.pt-side button{width:38px;height:38px;display:grid;place-items:center;font-size:18px;line-height:1}
.pt-side button.on{background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111;border-color:transparent}
.pt-side svg{width:18px;height:18px}
.pt-bottom{position:absolute;left:0;right:0;bottom:calc(10px + var(--sb));display:flex;flex-direction:column;align-items:center;gap:7px;pointer-events:none;padding:0 10px}
.pt-bottom>*{pointer-events:auto;max-width:100%}
.pt-styles{display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px}
.pt-styles .lbl{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--g);padding:0 8px 0 9px;white-space:nowrap}
.pt-styles button{height:28px;padding:0 12px;border-radius:999px;font-size:12px;white-space:nowrap}
.pt-styles button.on{background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111;font-weight:700}
.pt-time{display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px}
.pt-time button{height:28px;padding:0 11px;border-radius:999px;font-size:12px;white-space:nowrap;display:flex;align-items:center;gap:6px}
.pt-time button svg{width:15px;height:15px;flex:none;display:block}
.pt-time button.on{background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111;font-weight:700}
.pt-time button:not(.on):hover{color:var(--g2)}
.pt-row{flex-wrap:wrap}
.pt-styles[hidden],.pt-time[hidden]{display:none}
.pt.phone .pt-time button{padding:0 10px}.pt.phone .pt-time button span{display:none}
.pt.phone .pt-styles button{padding:0 10px;font-size:11.5px}
.pt-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px;max-width:min(100%,860px);-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%);padding-inline:12px}
.pt-chips::-webkit-scrollbar{display:none}
.pt-chip{flex:0 0 auto;height:32px;padding:0 13px;border-radius:999px;font-size:12.5px;white-space:nowrap;background:var(--bg);border:1px solid var(--ln);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.pt-chip.on{background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111;font-weight:700;border-color:transparent}
.pt-chip.sep{border-style:dashed;opacity:.9}
.pt-chip:hover:not(.on){border-color:var(--g)}
.pt-map{position:absolute;inset-inline-start:10px;bottom:calc(92px + var(--sb));padding:6px;border-radius:12px;transition:opacity .3s}
.pt-map canvas{display:block;width:150px;height:150px;cursor:pointer}
.pt-map .cap{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--g);text-align:center;margin-top:3px}
.pt-hint{position:absolute;left:50%;bottom:calc(100px + var(--sb));transform:translateX(-50%);padding:8px 14px;border-radius:999px;font-size:12px;white-space:nowrap;opacity:0;transition:opacity .6s;pointer-events:none;max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis}
.pt-hint.show{opacity:1}
.pt-legal{position:absolute;inset-inline-end:10px;bottom:calc(4px + var(--sb));font-size:9.5px;opacity:.55;pointer-events:none}
.pt-mode{position:absolute;top:calc(10px + var(--st));left:50%;transform:translateX(-50%);display:flex;gap:2px;padding:3px;border-radius:999px;z-index:2}
.pt-mode button{height:30px;padding:0 14px;border-radius:999px;font-size:12.5px;letter-spacing:.02em;white-space:nowrap;display:flex;align-items:center;gap:6px}
.pt-mode button svg{width:15px;height:15px;flex:none;display:block}
.pt button.pt-p{background:var(--bg)}
.pt-mode button.on{background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111;font-weight:700;cursor:default}
.pt-mode button:not(.on):hover{color:var(--g2)}
.pt-row{display:flex;align-items:center;justify-content:center;gap:8px;max-width:100%}
.pt .pt-res{height:34px;padding:0 18px;border-radius:999px;background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111!important;font-weight:700;font-size:12.5px;letter-spacing:.04em;white-space:nowrap;box-shadow:0 6px 22px rgba(0,0,0,.4)}
.pt .pt-res:hover{filter:brightness(1.08)}
.pt .pt-res[disabled]{opacity:.45;cursor:default}
.pt.phone .pt-mode{top:calc(56px + var(--st))}
.pt.phone .pt-mode button{height:28px;padding:0 12px;font-size:12px}
.pt.phone .pt-map{top:calc(100px + var(--st))}
.pt.phone .pt-res{height:32px;padding:0 14px}
.pt-load{position:absolute;inset:0;display:grid;place-items:center;background:#050505;transition:opacity .5s;z-index:5}
.pt-load.off{opacity:0;pointer-events:none}
.pt-load .in{display:flex;flex-direction:column;align-items:center;gap:14px;font-size:13px;color:var(--g2);text-align:center;padding:0 24px}
.pt-spin{width:34px;height:34px;border-radius:50%;border:2px solid rgba(201,164,92,.25);border-top-color:var(--g2);animation:ptspin 1s linear infinite}
@keyframes ptspin{to{transform:rotate(360deg)}}
.pt-busy{position:absolute;top:50%;left:50%;width:26px;height:26px;margin:-13px;border-radius:50%;border:2px solid rgba(201,164,92,.2);border-top-color:var(--g2);animation:ptspin 1s linear infinite;opacity:0;transition:opacity .2s;pointer-events:none}
.pt-busy.on{opacity:1}
.pt.phone .pt-title{max-width:calc(100% - 120px)}
.pt.phone .pt-map{bottom:auto;top:calc(100px + var(--st))}
.pt.phone .pt-map canvas{width:104px;height:104px}
.pt.phone .pt-side{top:auto;bottom:calc(148px + var(--sb));transform:none}
.pt.phone .pt-side .zm{display:none}
.pt.phone .pt-hint{bottom:calc(142px + var(--sb));font-size:11.5px;white-space:normal;text-align:center;border-radius:14px;width:max-content}
.pt.phone .pt-styles .lbl{display:none}
.pt.phone .pt-legal{inset-inline-end:auto;inset-inline-start:10px}
.pt.embedded .pt-title{max-width:min(40vw,440px)}
.pt.phone.embedded .pt-title{max-width:calc(50% - 70px)}
.pt.phone.embedded .pt-map{top:calc(110px + var(--st))}
.pt.embedded .pt-mode{display:none}
.pt-exit[hidden]{display:none}
`;

const ICON = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>',
  day: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
  dusk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 17h18M6 20.5h12M7 17a5 5 0 0 1 10 0M12 5v3M4.6 9.6l2 2M19.4 9.6l-2 2"/></svg>',
  night: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  gyro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M3 9c-1 2-1 4 0 6M21 9c1 2 1 4 0 6"/></svg>',
};

// ------------------------------------------------------------------ shader: two panoramas projected on proxy spheres
// While walking from A to B the camera moves between the capture points; each panorama is re-projected through a sphere
// around its own capture point (radius ≈ room scale), which gives the forward-motion parallax of a real walk-through.
const VERT = `
out vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = `
precision highp float;
in vec3 vW;
uniform sampler2D tA; uniform sampler2D tB;
uniform vec3 cA; uniform vec3 cB; uniform float rA; uniform float rB; uniform float k; uniform float fade;
out vec4 oc;
const float PI = 3.141592653589793;
vec3 proj(vec3 o, vec3 d, vec3 c, float R){
  vec3 q = o - c; float b = dot(q, d); float h = b*b - (dot(q,q) - R*R);
  float t = -b + sqrt(max(h, 0.0)); return normalize(q + t*d);
}
vec4 equi(sampler2D t, vec3 d){
  float u = 0.5 + atan(-d.x, d.z) / (2.0*PI);
  float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / PI;
  // seam-free mip selection: take the u derivative from whichever of u / u+0.5 is continuous here
  float u2 = fract(u + 0.5);
  vec2 dx = vec2(dFdx(u), dFdx(v)), dy = vec2(dFdy(u), dFdy(v));
  vec2 dx2 = vec2(dFdx(u2), dFdx(v)), dy2 = vec2(dFdy(u2), dFdy(v));
  if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
  return textureGrad(t, vec2(u, v), dx, dy);
}
void main(){
  vec3 d = normalize(vW - cameraPosition);
  vec4 a = equi(tA, proj(cameraPosition, d, cA, rA));
  vec4 col = a;
  if (k > 0.0) { vec4 b = equi(tB, proj(cameraPosition, d, cB, rB)); col = mix(a, b, k); }
  // the panoramas are sRGB JPEGs sampled as linear (correct filtering and cross-fade); encode for the canvas again —
  // without this the picture comes out about one stop too dark and over-saturated
  oc = linearToOutputTexel(vec4(col.rgb * fade, 1.0));
}`;

function strFor(opts) {
  const i18n = opts.i18n;
  const langV = opts.lang || (i18n && (typeof i18n.lang === 'function' ? i18n.lang() : i18n.lang)) || document.documentElement.lang || 'en';
  const lang = String(langV).slice(0, 2);
  const dirV = opts.dir || (i18n && (typeof i18n.dir === 'function' ? i18n.dir() : i18n.dir)) || (RTL.has(lang) ? 'rtl' : 'ltr');
  const T = (key) => {
    // site i18n first for the shared vocabulary (walk.* / rooms), then our own table
    const siteKey = { lobby: 'walk.lobby', corridor: 'walk.corridor', parking: 'walk.parking', balcony: 'walk.balcony', reserve: 'walk.reserve' }[key.replace(/^r\./, '')]
      || (/^s\.[a-z0-9_-]+$/i.test(key) ? 'style.' + key.slice(2) + '.n' : null);
    if (siteKey && i18n && typeof i18n.t === 'function') {
      try { const s = i18n.t(siteKey); if (typeof s === 'string' && s && s !== siteKey) return s; } catch { /* optional */ }
    }
    return tt(lang, key);
  };
  return { lang, dir: dirV === 'rtl' ? 'rtl' : 'ltr', T };
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const baseId = id => id.replace(/-\d+$/, '');

export async function openPanoTour(container, opts = {}) {
  const man = await tourReady;
  const { lang, dir, T } = strFor(opts);
  const unit = opts.unitId ? unitById(opts.unitId) : null;
  // normalise points: links → id list (+ hotspot info), img → 2k (lo) / 4k (img)
  const norm = (P) => (P || []).map(p => ({ ...p, linkInfo: p.links || [], links: (p.links || []).map(l => (typeof l === 'string' ? l : l.to)),
    lo: p.img && (p.img['2k'] || p.img.lo), img: p.img && (p.img['4k'] || p.img['2k']) }));

  // ---------------------------------------------------------------- which scene / style
  const sceneDefs = {};   // key → { kind:'apt'|'commons', def, typeId?, sample? }
  const typeId = (unit && unit.type) || opts.typeId;
  stash(null);
  const normModes = (e) => { const o = {}; for (const [m, P] of Object.entries(modesOf(e))) o[m] = norm(P); return o; };
  const RT = repType(man, typeId);
  if (RT) {
    const t = RT.t, styles = {};
    const have = Object.keys(t.styles || {}).filter(k => Object.keys(modesOf(t.styles[k])).length);
    for (const k of allowedStyles(have)) styles[k] = { modes: normModes(t.styles[k]) };
    if (Object.keys(styles).length) sceneDefs.apt = { kind: 'apt', def: { ...t, styles }, typeId: RT.id, mapped: RT.mapped, sample: !!(RT.mapped || (unit && t.refUnit && unit.id !== t.refUnit)) };
  }
  // common areas of the unit's own building (commonsBy[building]), else the default set
  // (V4: only the unit's OWN building — another tower's lobby is not shown as this one's; without a unit: the default set)
  const bld = (unit && unit.building) || opts.building;
  const CM = bld ? ((man.commonsBy && man.commonsBy[bld]) || {}) : (man.commons || {});
  // a lift hall is rendered on one floor of the tower: exact for every floor of the same plate, a sample for the others
  const corridorExact = !!(unit && CM.corridor && plateOf(unit.building, unit.floor) && plateOf(unit.building, unit.floor) === plateOf(CM.corridor.building || unit.building, CM.corridor.floor));
  for (const c of COMMONS) if (CM[c] && Object.keys(modesOf(CM[c])).length) sceneDefs[c] = { kind: 'commons', def: { ...CM[c], styles: { default: { modes: normModes(CM[c]) } } } };
  const stylesOf = (key) => { const d = sceneDefs[key]; return d ? Object.keys(d.def.styles || {}) : []; };
  const modesFor = (key, style) => { const d = sceneDefs[key], st = d && d.def.styles[style]; return st ? MODES.filter(m => st.modes[m]) : []; };
  const pickMode = (key, style, want) => { const L = modesFor(key, style); return L.includes(want) ? want : L.includes('day') ? 'day' : L[0]; };

  // ---------------------------------------------------------------- DOM
  if (!document.getElementById('pt-css')) { const st = document.createElement('style'); st.id = 'pt-css'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div');
  root.className = 'pt'; root.dir = dir; root.lang = lang;
  if (opts.embedded || (container.classList && container.classList.contains('vw-pano'))) root.classList.add('embedded');
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(root);
  const isPhone = () => root.clientWidth < 640 || root.clientHeight < 500;
  root.classList.toggle('phone', isPhone());

  const roomOpt = opts.room || opts.startRoom;
  let startRoom = roomOpt && typeof roomOpt === 'object' ? roomOpt.kind : roomOpt;
  if (startRoom === 'lift') startRoom = 'corridor';
  if (startRoom === 'apartment') startRoom = 'living';
  const startKey = COMMONS.includes(startRoom) && sceneDefs[startRoom] ? startRoom : (sceneDefs.apt ? 'apt' : null);
  if (!startKey) {
    root.innerHTML = `<div class="pt-load"><div class="in"><div>${esc(T('soonHint'))}</div><div class="pt-row">
      ${opts.onSwitchTo3D ? `<button class="pt-res" type="button" data-a="3d">${esc(T('live3d'))}</button>` : ''}
      <button class="pt-p pt-exit" type="button" data-a="x" style="position:static">${ICON.x}<span>${esc(T('exit'))}</span></button></div></div></div>`;
    root.onclick = e => {
      const a = e.target.closest('button[data-a]')?.dataset.a; if (!a) return;
      dispose();
      if (a === '3d') opts.onSwitchTo3D({ unitId: opts.unitId, styleId: opts.styleId, room: { kind: startRoom || 'living', index: 0 } });
      else opts.onExit && opts.onExit(null);
    };
    function dispose() { root.remove(); }
    return { ok: false, dispose, close: dispose };
  }

  root.innerHTML = `
    <canvas class="pt-gl" tabindex="0" aria-label="${esc(T('title'))}"></canvas>
    <div class="pt-p pt-title"><div class="t1">${esc(T('title'))}</div><div class="t2"></div><div class="pt-badge" hidden>${esc(T('sample'))}</div></div>
    <button class="pt-p pt-exit" type="button">${ICON.x}<span>${esc(T('exit'))}</span></button>
    <div class="pt-p pt-mode" role="group" aria-label="${esc(T('toggle'))}">
      <button type="button" class="on" aria-pressed="true">${ICON.cam}<span>${esc(T('photo'))}</span></button>
      <button type="button" data-m="3d" aria-pressed="false" ${opts.onSwitchTo3D ? '' : 'hidden'}>${ICON.cube}<span>${esc(T('live3d'))}</span></button>
    </div>
    <div class="pt-side">
      <button class="pt-p zm" type="button" data-z="-1" aria-label="${esc(T('zoomIn'))}">+</button>
      <button class="pt-p zm" type="button" data-z="1" aria-label="${esc(T('zoomOut'))}">−</button>
      <button class="pt-p gy" type="button" hidden aria-label="${esc(T('gyro'))}" title="${esc(T('gyro'))}">${ICON.gyro}</button>
    </div>
    <div class="pt-p pt-map"><canvas width="300" height="300"></canvas><div class="cap">${esc(T('plan'))}</div></div>
    <div class="pt-p pt-hint">${esc(T('hint'))}</div>
    <div class="pt-bottom"><div class="pt-row"><div class="pt-p pt-styles"></div><div class="pt-p pt-time" role="group" aria-label="${esc(T('light'))}"></div>${opts.onReserve && unit ? `<button type="button" class="pt-res">${esc(T('reserve'))}</button>` : ''}</div><div class="pt-chips"></div></div>
    <div class="pt-legal">${esc(T('illus'))}</div>
    <div class="pt-busy"></div>
    <div class="pt-load"><div class="in"><div class="pt-spin"></div><div>${esc(T('loading'))}</div></div></div>`;
  const $ = s => root.querySelector(s);
  const el = { canvas: $('canvas.pt-gl'), t1: $('.pt-title .t1'), t2: $('.pt-title .t2'), badge: $('.pt-badge'), exit: $('.pt-exit'), styles: $('.pt-styles'), time: $('.pt-time'), chips: $('.pt-chips'),
    map: $('.pt-map'), mode: $('.pt-mode'), res: $('.pt-res'), mapC: $('.pt-map canvas'), hint: $('.pt-hint'), load: $('.pt-load'), busy: $('.pt-busy'), gy: $('.pt-side .gy') };

  // ---------------------------------------------------------------- three
  const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const maxTex = renderer.capabilities.maxTextureSize || 4096;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV0, 1, 0.05, 200);
  camera.rotation.order = 'YXZ';
  const blank = new THREE.DataTexture(new Uint8Array([5, 5, 5, 255]), 1, 1); blank.needsUpdate = true;
  const U = { tA: { value: blank }, tB: { value: blank }, cA: { value: new THREE.Vector3() }, cB: { value: new THREE.Vector3() },
    rA: { value: 4 }, rB: { value: 4 }, k: { value: 0 }, fade: { value: 1 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 32), new THREE.ShaderMaterial({
    uniforms: U, vertexShader: VERT, fragmentShader: FRAG, glslVersion: THREE.GLSL3, side: THREE.BackSide, depthWrite: false, depthTest: false }));
  sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  // hotspot rings (floor circles at the neighbouring capture points)
  const ringGeo = new THREE.RingGeometry(0.2, 0.26, 56).rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(0.2, 40).rotateX(-Math.PI / 2);
  const hitGeo = new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2);
  const hotGroup = new THREE.Group(); scene.add(hotGroup);
  const mkMat = (o, c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false });

  // ---------------------------------------------------------------- state
  const S = {
    key: startKey, style: null, mode: MODES.includes(opts.mode) ? opts.mode : 'day', wantMode: MODES.includes(opts.mode) ? opts.mode : 'day', point: null, yaw: 0, pitch: -0.05, fov: FOV0, vy: 0, vp: 0,
    trans: null, dirty: true, disposed: false, touched: false, gyro: null, lastT: performance.now(),
  };
  const pts = () => { const d = sceneDefs[S.key]; const st = d && d.def.styles[S.style]; return (st && (st.modes[S.mode] || st.modes[pickMode(S.key, S.style, S.mode)])) || []; };
  const byId = (id) => pts().find(p => p.id === id);
  const eyeOf = (p) => new THREE.Vector3(p.pos[0], (p.pos[2] || 0) + (man.eye || 1.6), p.pos[1]);

  // ---------------------------------------------------------------- textures (LRU; low-res first, full-res after)
  const loader = new THREE.TextureLoader();
  const cache = new Map();   // url → { p: Promise<Texture>, t: Texture|null, used }
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function tex(url) {
    let e = cache.get(url);
    if (!e) {
      e = { t: null, used: performance.now() };
      e.p = new Promise((res, rej) => loader.load(new URL(url, ASSET_BASE).href, t => {
        t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
        t.wrapS = THREE.RepeatWrapping; t.anisotropy = aniso; e.t = t; res(t);
      }, undefined, rej));
      cache.set(url, e);
      trim();
    }
    e.used = performance.now();
    return e.p;
  }
  function trim() {   // LRU per tier: the 2k tier is also what gets preloaded (neighbours, other light modes)
    const keep = new Set([U.tA.value, U.tB.value]), phone = isPhone();
    const all = [...cache.entries()].sort((a, b) => b[1].used - a[1].used);
    const drop = (list, n) => { for (const [u, e] of list.slice(n)) if (e.t && !keep.has(e.t)) { e.t.dispose(); cache.delete(u); } };
    drop(all.filter(([u]) => /-4k\.jpg$/.test(u)), phone ? 1 : 3);
    drop(all.filter(([u]) => !/-4k\.jpg$/.test(u)), phone ? 6 : 12);
  }
  // tier choice: phones, data-saver connections and GPUs below 4096 px stay on the 2k tier
  const saver = () => !!(navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || '')));
  const hiOK = (p) => p.img && p.img !== p.lo && maxTex >= 4096 && !isPhone() && !saver();
  async function bestNow(p) {   // lo immediately (or hi if cached), hi later
    const hiE = p.img && cache.get(p.img);
    if (hiE && hiE.t && hiOK(p)) return hiE.t;
    return tex(p.lo || p.img);
  }
  function upgrade(p) {
    if (!hiOK(p) || !p.lo) return;
    tex(p.img).then(t => {
      if (S.disposed || S.point !== p) return;
      if (S.trans) { S.pendingHi = t; return; }
      U.tA.value = t; S.dirty = true;
    }).catch(() => {});
  }
  let preTok = 0;
  function preloadNeighbours(p) {
    const tok = ++preTok;
    // 1) the linked points (what a tap on a ring needs) — 2k tier only; the 4k tier is fetched on arrival
    for (const id of (p.links || []).slice(0, isPhone() ? 3 : 6)) { const q = byId(id); if (q) tex(q.lo || q.img).catch(() => {}); }
    // 2) a little later, when the visitor stays: the same point in the other light modes and styles (instant switches)
    if (saver()) return;
    setTimeout(() => {
      if (S.disposed || tok !== preTok || S.point !== p) return;
      const d = sceneDefs[S.key], st = d && d.def.styles[S.style];
      for (const m of modesFor(S.key, S.style)) { if (m === S.mode) continue; const q = st.modes[m].find(x => x.id === p.id); if (q) tex(q.lo || q.img).catch(() => {}); }
      if (!isPhone()) for (const s2 of stylesOf(S.key)) { if (s2 === S.style) continue; const P2 = d.def.styles[s2].modes[pickMode(S.key, s2, S.mode)] || []; const q = P2.find(x => x.id === p.id); if (q) tex(q.lo || q.img).catch(() => {}); }
    }, 1400);
  }

  // ---------------------------------------------------------------- hotspots
  function buildHotspots() {
    hotGroup.clear();
    const p = S.point; if (!p) return;
    for (const id of p.links || []) {
      const q = byId(id); if (!q || (q.level || 0) !== (p.level || 0)) continue;
      const g = new THREE.Group();
      g.position.set(q.pos[0], (q.pos[2] || 0) + 0.02, q.pos[1]);
      const ring = new THREE.Mesh(ringGeo, mkMat(0.95, 0xe6c987)), disc = new THREE.Mesh(discGeo, mkMat(0.22, 0xffffff));
      const hit = new THREE.Mesh(hitGeo, mkMat(0, 0xffffff)); hit.userData.target = q.id;
      ring.renderOrder = disc.renderOrder = 2; g.add(disc, ring, hit); g.userData = { ring, disc, id: q.id };
      hotGroup.add(g);
    }
    // the entrance door: from the flat's point nearest to it out to the lift hall, and back in from there
    const pt = portalOf(p);
    if (pt) {
      const g = new THREE.Group();
      g.position.set(pt.pos[0], 0.02, pt.pos[1]);
      const ring = new THREE.Mesh(ringGeo, mkMat(0.95, 0xffffff)), disc = new THREE.Mesh(discGeo, mkMat(0.3, 0xe6c987));
      const hit = new THREE.Mesh(hitGeo, mkMat(0, 0xffffff)); hit.userData.portal = pt;
      ring.renderOrder = disc.renderOrder = 2; g.add(disc, ring, hit); g.userData = { ring, disc, id: '__door', portal: pt };
      hotGroup.add(g);
    }
    S.dirty = true;
  }
  // Entrance portal of the current point, or null. Flat side: the point nearest to the entrance door (within 5 m);
  // lift hall side: the points within 9 m of the flat's door (same plate only — on another plate the doors differ).
  const ENT = (() => {
    if (!unit || !sceneDefs.apt || !sceneDefs.corridor) return null;
    try {
      const I = interiorOf(sceneDefs.apt.typeId), d = I && I.doors.find(q => q.type === 'entrance'); if (!d) return null;
      const own = unitToLocal(unit, unit.door.u, 0), V = unit.frame.V;
      return { p: [d.p[0], d.p[1]], t: +d.t || 0.2, own, V, exact: corridorExact && !sceneDefs.apt.mapped };
    } catch { return null; }
  })();
  function portalOf(p) {
    if (!ENT) return null;
    if (S.key === 'apt') {
      const P = pts(); let best = null, bd = 5;
      for (const q of P) { const dd = Math.hypot(q.pos[0] - ENT.p[0], q.pos[1] - ENT.p[1]); if (dd < bd) { bd = dd; best = q; } }
      if (!best || best.id !== p.id) return null;
      // the corridor point nearest to this flat's door (exact plate) or the first one; arrive looking away from the door
      const CP = (sceneDefs.corridor.def.styles.default.modes[pickMode('corridor', 'default', S.mode)]) || [];
      let cp = CP[0], cd = Infinity; if (ENT.exact) for (const q of CP) { const dd = Math.hypot(q.pos[0] - ENT.own[0], q.pos[1] - ENT.own[1]); if (dd < cd) { cd = dd; cp = q; } }
      if (!cp) return null;
      return { pos: [ENT.p[0], Math.max(0.3, ENT.t + 0.25)], scene: 'corridor', pointId: cp.id, yaw: ENT.exact ? Math.atan2(ENT.V[0], ENT.V[1]) : undefined };
    }
    if (S.key === 'corridor' && ENT.exact) {
      if (Math.hypot(p.pos[0] - ENT.own[0], p.pos[1] - ENT.own[1]) > 9) return null;
      const P = (() => { const d = sceneDefs.apt, st = d.def.styles[S.aptStyle] || d.def.styles[Object.keys(d.def.styles)[0]]; return st.modes[S.mode] || st.modes[Object.keys(st.modes)[0]] || []; })();
      let best = null, bd = 5; for (const q of P) { const dd = Math.hypot(q.pos[0] - ENT.p[0], q.pos[1] - ENT.p[1]); if (dd < bd) { bd = dd; best = q; } }
      if (!best) return null;
      return { pos: [ENT.own[0] - ENT.V[0] * 0.35, ENT.own[1] - ENT.V[1] * 0.35], scene: 'apt', pointId: best.id, yaw: Math.PI };
    }
    return null;
  }

  // ---------------------------------------------------------------- HUD
  // the plan's own name of the room the point stands in (manifest rooms carry nk = 'room.kitchenLiving' …; the site's
  // dictionaries have it as walk.<nk>) — the same words as the live walkthrough's labels; else the generic room kind
  function planName(p) {
    const d = sceneDefs[S.key] && sceneDefs[S.key].def, r = d && d.rooms && d.rooms.find(q => q.nk && q.poly && pointInPoly(p.pos, q.poly));
    if (!r || !opts.i18n || typeof opts.i18n.t !== 'function') return null;
    try { const k = 'walk.' + r.nk, v = opts.i18n.t(k); return typeof v === 'string' && v && v !== k ? v : null; } catch { return null; }
  }
  function roomLabel(p) {
    if (COMMONS.includes(p.room)) return T('r.' + p.room);
    const pn = planName(p);
    if (pn) { const same = [...new Set(pts().filter(q => planName(q) === pn).map(q => baseId(q.id)))]; return pn + (same.length > 1 ? ' ' + (same.indexOf(baseId(p.id)) + 1) : ''); }
    const name = T('r.' + p.room);
    const same = [...new Set(pts().filter(q => q.room === p.room).map(q => baseId(q.id)))];
    const n = same.length > 1 ? ' ' + (same.indexOf(baseId(p.id)) + 1) : '';
    return name + n + ((p.level || 0) > 0 ? ' · ' + T('upper') : '');
  }
  function renderTitle() {
    const p = S.point; if (!p) return;
    let head;
    if (S.key === 'apt') head = unit ? ((opts.i18n && typeof opts.i18n.unitLabel === 'function' && opts.i18n.unitLabel(unit)) || unitLabel(unit)) : T('apartment');
    else head = T('building');
    el.t1.textContent = roomLabel(p);
    el.t2.textContent = head;
    el.badge.hidden = !((S.key === 'apt' && sceneDefs.apt.sample) || (S.key === 'corridor' && (opts.corridorSample || (unit && !corridorExact))));
  }
  function renderStyles() {
    const list = S.key === 'apt' ? stylesOf('apt') : [];
    el.styles.hidden = list.length < 2;
    el.styles.innerHTML = `<span class="lbl">${esc(T('design'))}</span>` + list.map(s => `<button type="button" data-s="${s}" class="${s === S.style ? 'on' : ''}" aria-pressed="${s === S.style}">${esc(T('s.' + s) === 's.' + s ? s : T('s.' + s))}</button>`).join('');
    renderTime();
  }
  function renderTime() {
    const list = modesFor(S.key, S.style);
    el.time.hidden = list.length < 2;
    el.time.innerHTML = list.map(m => `<button type="button" data-t="${m}" class="${m === S.mode ? 'on' : ''}" aria-pressed="${m === S.mode}" aria-label="${esc(T('m.' + m))}" title="${esc(T('m.' + m))}">${ICON[m]}<span>${esc(T('m.' + m))}</span></button>`).join('');
  }
  function renderChips() {
    const P = pts(), seen = new Set(), chips = [];
    const order = (p) => { const i = ROOM_ORDER.indexOf(p.room); return (i < 0 ? 50 : i) * 10 + (p.level || 0); };
    for (const p of [...P].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))) {
      const b = baseId(p.id); if (seen.has(b)) continue; seen.add(b);
      chips.push({ key: S.key, id: p.id, base: b, label: roomLabel(p), on: S.point && baseId(S.point.id) === b });
    }
    if (S.key === 'apt') {
      for (const c of COMMONS) if (sceneDefs[c]) chips.push({ key: c, label: T('r.' + c), sep: true });
    } else {
      if (sceneDefs.apt) chips.unshift({ key: 'apt', label: T('apartment'), sep: true });
      for (const c of COMMONS) if (sceneDefs[c] && c !== S.key) chips.push({ key: c, label: T('r.' + c), sep: true });
    }
    el.chips.innerHTML = chips.map((c, i) => `<button type="button" class="pt-chip${c.on ? ' on' : ''}${c.sep ? ' sep' : ''}" data-i="${i}">${esc(c.label)}</button>`).join('');
    el.chips._list = chips;
    const on = el.chips.querySelector('.on'); if (on && on.scrollIntoView) try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch { /* old Safari */ }
  }

  // minimap ---------------------------------------------------------
  const mctx = el.mapC.getContext('2d');
  let mapTf = null;
  function mapFrame() {
    const d = sceneDefs[S.key].def, P = pts();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    if (S.key === 'apt' && d.rooms) for (const r of d.rooms) for (const [x, z] of r.poly) add(x, z);
    for (const p of P) add(p.pos[0], p.pos[1]);
    const pad = S.key === 'apt' ? 0.4 : 3;
    x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const W = el.mapC.width, s = (W - 16) / Math.max(x1 - x0, z1 - z0);
    return { s, ox: (W - (x1 - x0) * s) / 2 - x0 * s, oz: (W - (z1 - z0) * s) / 2 - z0 * s };
  }
  function drawMap() {
    const P = pts(); if (!P.length) return;
    mapTf = mapFrame();
    const { s, ox, oz } = mapTf, W = el.mapC.width, X = x => ox + x * s, Z = z => oz + z * s;
    mctx.clearRect(0, 0, W, W);
    const d = sceneDefs[S.key].def, lv = (S.point && S.point.level) || 0;
    mctx.lineJoin = 'round';
    if (S.key === 'apt' && d.rooms) {
      for (const r of d.rooms) {
        if ((r.level || 0) !== lv) continue;
        mctx.beginPath(); r.poly.forEach(([x, z], i) => (i ? mctx.lineTo(X(x), Z(z)) : mctx.moveTo(X(x), Z(z)))); mctx.closePath();
        const cur = S.point && S.point.room === r.kind && pointInPoly(S.point.pos, r.poly);
        mctx.fillStyle = cur ? 'rgba(201,164,92,.22)' : ['balcony', 'loggia', 'terrace'].includes(r.kind) ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.08)';
        mctx.fill(); mctx.strokeStyle = 'rgba(230,201,135,.75)'; mctx.lineWidth = 2; mctx.stroke();
      }
    } else {
      mctx.strokeStyle = 'rgba(230,201,135,.55)'; mctx.lineWidth = 2; mctx.fillStyle = 'rgba(255,255,255,.07)';
      const mb = d.building || (unit && unit.building) || opts.building;   // hall + core rects of the plate the common area belongs to
      const rects = S.key === 'parking' || !mb ? [] : [...corridorsOf(mb, d.floor), ...coresOf(mb, d.floor)];
      for (const r of rects) { mctx.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); mctx.strokeRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); }
    }
    for (const p of P) {
      if ((p.level || 0) !== lv) continue;
      mctx.beginPath(); mctx.arc(X(p.pos[0]), Z(p.pos[1]), 5, 0, Math.PI * 2);
      mctx.fillStyle = 'rgba(230,201,135,.9)'; mctx.fill();
    }
    if (S.point) {
      const cx = X(S.point.pos[0]), cz = Z(S.point.pos[1]);
      const a = Math.atan2(-Math.cos(S.yaw), -Math.sin(S.yaw)), half = (S.fov * camera.aspect) * Math.PI / 360;
      const g = mctx.createRadialGradient(cx, cz, 0, cx, cz, 44);
      g.addColorStop(0, 'rgba(230,201,135,.55)'); g.addColorStop(1, 'rgba(230,201,135,0)');
      mctx.beginPath(); mctx.moveTo(cx, cz); mctx.arc(cx, cz, 44, a - Math.min(half, 1.2), a + Math.min(half, 1.2)); mctx.closePath(); mctx.fillStyle = g; mctx.fill();
      mctx.beginPath(); mctx.arc(cx, cz, 8, 0, Math.PI * 2); mctx.fillStyle = '#e6c987'; mctx.fill();
      mctx.lineWidth = 3; mctx.strokeStyle = '#111'; mctx.stroke();
    }
  }
  function pointInPoly([x, y], poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ---------------------------------------------------------------- navigation
  function setBusy(on) { el.busy.classList.toggle('on', !!on); }
  async function go(target, { walk = true, keepYaw = true, yaw } = {}) {
    if (!target || S.trans || S.disposed) return;
    const from = S.point;
    if (from === target) return;
    setBusy(true);
    let t;
    try { t = await bestNow(target); } catch (e) { setBusy(false); console.warn('[pano] load failed', target.img, e); return; }
    setBusy(false);
    if (S.disposed) return;
    const linked = from && walk && (from.links || []).includes(target.id) && (from.level || 0) === (target.level || 0);
    const A = from ? eyeOf(from) : eyeOf(target), B = eyeOf(target);
    const dist = A.distanceTo(B);
    U.tB.value = t; U.cB.value.copy(B);
    const R = linked ? Math.max(2.6, dist * 1.25) : 50;
    U.rA.value = R; U.rB.value = R;
    if (!linked) U.cA.value.copy(camera.position);
    S.trans = { t0: performance.now(), dur: linked ? clamp(650 + dist * 170, 700, 1500) : 650, A, B: linked ? B : A.clone(), target, linked,
      yaw0: S.yaw, yaw1: yaw !== undefined ? yaw : keepYaw || !linked ? S.yaw : S.yaw, fov0: S.fov };
    if (!linked) { U.cB.value.copy(A); }
    hotGroup.visible = false;
    S.point = target;
    renderTitle(); renderChips(); drawMap();
  }
  function finishTrans() {
    const tr = S.trans; S.trans = null;
    U.tA.value = S.pendingHi || U.tB.value; S.pendingHi = null;
    U.cA.value.copy(eyeOf(S.point)); U.cB.value.copy(U.cA.value); U.k.value = 0; U.rA.value = 4;
    camera.position.copy(eyeOf(S.point));
    S.fov = tr.fov0;
    hotGroup.visible = true; buildHotspots();
    upgrade(S.point); preloadNeighbours(S.point);
    S.dirty = true;
  }
  function stepTrans(now) {
    const tr = S.trans; if (!tr) return;
    const x = clamp((now - tr.t0) / tr.dur, 0, 1), e = ease(x);
    if (tr.linked) {
      camera.position.lerpVectors(tr.A, tr.B, e);
      U.k.value = clamp((x - 0.15) / 0.65, 0, 1);
      S.fov = tr.fov0 - Math.sin(x * Math.PI) * 6;
    } else {
      U.k.value = e;
    }
    if (tr.yaw1 !== tr.yaw0) S.yaw = tr.yaw0 + wrapPi(tr.yaw1 - tr.yaw0) * e;
    S.dirty = true;
    if (x >= 1) finishTrans();
  }
  async function enterScene(key, { pointId, room, roomIndex = 0, yaw, style } = {}) {
    const d = sceneDefs[key]; if (!d) return;
    const styles = stylesOf(key);
    const near = { monaco: 'milano', kyoto: 'nordic', paris: 'riviera' }[style || opts.styleId];   // designs without renders → the nearest rendered one
    const st = style && styles.includes(style) ? style : (key === 'apt' ? (styles.includes(S.aptStyle) ? S.aptStyle : styles.includes(opts.styleId) ? opts.styleId : styles.includes(near) ? near : styles[0]) : styles[0]);
    const prevKey = S.key; S.key = key; S.style = st; if (key === 'apt') S.aptStyle = st;
    S.mode = pickMode(key, st, S.wantMode);
    const P = pts();
    let p = (pointId && P.find(q => q.id === pointId)) || (room && (P.find(q => q.room === room && (q.roomIndex || 0) === roomIndex) || P.find(q => q.room === room || baseId(q.id) === room)));
    if (!p && room === 'living') p = P.find(q => q.room === 'living');
    p = p || P.find(q => q.room === 'living') || P[0];
    if (yaw === undefined) yaw = p.view ?? p.yaw ?? 0;
    const first = !S.point;
    if (first) {
      const t = await bestNow(p);
      if (S.disposed) return;
      S.point = p; S.yaw = yaw; U.tA.value = t; camera.position.copy(eyeOf(p)); U.cA.value.copy(camera.position); U.cB.value.copy(camera.position);
      buildHotspots(); upgrade(p); preloadNeighbours(p);
      renderTitle(); renderStyles(); renderChips(); drawMap(); S.dirty = true;
    } else {
      S.point = S.point;   // keep for fade origin
      await go(p, { walk: false, yaw });
      if (prevKey !== key) S.point = p;
      renderStyles(); renderChips(); drawMap();
    }
  }
  // the same point (else the nearest one) of another panorama set, cross-faded in place: view direction and zoom stay
  async function swapSet(apply) {
    const cur = S.point;
    apply();
    const P = pts();
    let p = P.find(q => q.id === cur.id);
    if (!p) { let bd = Infinity; for (const q of P) { const dd = Math.hypot(q.pos[0] - cur.pos[0], q.pos[1] - cur.pos[1]) + ((q.level || 0) !== (cur.level || 0) ? 50 : 0); if (dd < bd) { bd = dd; p = q; } } }
    S.point = { ...cur, id: '__prev' };   // force a cross-fade in place
    await go(p, { walk: false });
    if (S.point !== p && !S.trans) { S.point = p; buildHotspots(); }   // the load failed: stay consistent
    renderStyles();
  }
  async function setStyle(styleId) {
    if (S.key !== 'apt' || !stylesOf('apt').includes(styleId) || styleId === S.style || S.trans) return false;
    await swapSet(() => { S.style = styleId; S.aptStyle = styleId; S.mode = pickMode(S.key, styleId, S.wantMode); });
    return true;
  }
  async function setMode(mode) {
    if (!modesFor(S.key, S.style).includes(mode) || mode === S.mode || S.trans) return false;
    S.wantMode = mode;
    await swapSet(() => { S.mode = mode; });
    return true;
  }

  // ---------------------------------------------------------------- input
  const ptrs = new Map();
  let drag = null, pinch = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(cx, cy) {
    const r = el.canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(hotGroup.children.map(g => g.children[2]), false);
    if (hits.length) return hits[0].object.userData.portal || byId(hits[0].object.userData.target);
    // otherwise: the linked point closest to the clicked direction (within ~16°)
    let best = null, bd = 0.28;
    for (const g of hotGroup.children) {
      const v = g.position.clone().sub(camera.position).normalize();
      const a = Math.acos(clamp(v.dot(ray.ray.direction), -1, 1));
      if (a < bd) { bd = a; best = g.userData.portal || byId(g.userData.id); }
    }
    return best;
  }
  function touched() {
    if (!S.touched) { S.touched = true; setTimeout(() => el.hint.classList.remove('show'), 1800); }
  }
  el.canvas.addEventListener('pointerdown', e => {
    el.canvas.setPointerCapture && el.canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    touched();
    if (ptrs.size === 1) { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: 0 }; S.vy = S.vp = 0; el.canvas.classList.add('drag'); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: S.fov }; drag = null; }
  });
  el.canvas.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      S.fov = clamp(pinch.fov * pinch.d / Math.max(d, 1), FOV_MIN, FOV_MAX); S.dirty = true; return;
    }
    if (drag) {
      const k = (S.fov * Math.PI / 180) / el.canvas.clientHeight;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (S.gyro) { S.gyro.off += dx * k; }
      else { S.yaw += dx * k; S.pitch = clamp(S.pitch + dy * k, -1.45, 1.45); }
      const dt = Math.max(1, performance.now() - drag.t);
      S.vy = dx * k / dt * 16; S.vp = dy * k / dt * 16;
      drag.x = e.clientX; drag.y = e.clientY; drag.t = performance.now(); S.dirty = true;
      return;
    }
    if (e.pointerType === 'mouse') {   // hover feedback
      const h = pick(e.clientX, e.clientY);
      el.canvas.classList.toggle('hot', !!h);
      for (const g of hotGroup.children) { const on = h && (h.scene ? g.userData.portal === h : g.userData.id === h.id); g.userData.ring.material.opacity = on ? 1 : 0.85; g.userData.disc.material.opacity = on ? 0.45 : 0.2; g.scale.setScalar(on ? 1.18 : 1); }
      S.dirty = true;
    }
  });
  const up = e => {
    const wasTap = drag && drag.moved < 8 && ptrs.size === 1;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) {
      el.canvas.classList.remove('drag');
      if (drag && performance.now() - drag.t > 80) { S.vy = S.vp = 0; }
      if (wasTap) { const target = pick(e.clientX, e.clientY); if (target && target.scene) enterScene(target.scene, { pointId: target.pointId, yaw: target.yaw }); else if (target) go(target); }
      drag = null;
    }
  };
  el.canvas.addEventListener('pointerup', up);
  el.canvas.addEventListener('pointercancel', up);
  el.canvas.addEventListener('wheel', e => { e.preventDefault(); touched(); S.fov = clamp(S.fov * Math.exp(e.deltaY * 0.0012), FOV_MIN, FOV_MAX); S.dirty = true; }, { passive: false });
  el.canvas.addEventListener('keydown', e => {
    const k = e.key, step = 0.12;
    if (k === 'ArrowLeft') S.yaw += step; else if (k === 'ArrowRight') S.yaw -= step;
    else if (k === 'ArrowUp') S.pitch = clamp(S.pitch + step, -1.45, 1.45); else if (k === 'ArrowDown') S.pitch = clamp(S.pitch - step, -1.45, 1.45);
    else if (k === '+' || k === '=') S.fov = clamp(S.fov - 6, FOV_MIN, FOV_MAX); else if (k === '-') S.fov = clamp(S.fov + 6, FOV_MIN, FOV_MAX);
    else return;
    e.preventDefault(); touched(); S.dirty = true;
  });
  root.querySelectorAll('.pt-side .zm').forEach(b => b.onclick = () => { touched(); S.fov = clamp(S.fov + (+b.dataset.z) * 10, FOV_MIN, FOV_MAX); S.dirty = true; });
  el.styles.onclick = e => { const b = e.target.closest('button[data-s]'); if (b) { touched(); setStyle(b.dataset.s); } };
  el.time.onclick = e => { const b = e.target.closest('button[data-t]'); if (b) { touched(); setMode(b.dataset.t); } };
  el.chips.onclick = e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    touched();
    const c = el.chips._list[+b.dataset.i];
    if (c.key !== S.key) { enterScene(c.key, {}); return; }
    const p = byId(c.id);
    if (p && (!S.point || baseId(S.point.id) !== c.base)) { const w = (S.point.links || []).includes(p.id); go(p, { walk: w, yaw: w ? undefined : p.view }); }
  };
  el.mapC.addEventListener('click', e => {
    if (!mapTf) return;
    const r = el.mapC.getBoundingClientRect(), sx = el.mapC.width / r.width;
    const mx = (e.clientX - r.left) * sx, mz = (e.clientY - r.top) * sx;
    let best = null, bd = 26;
    for (const p of pts()) { const d = Math.hypot(mapTf.ox + p.pos[0] * mapTf.s - mx, mapTf.oz + p.pos[1] * mapTf.s - mz); if (d < bd && (p.level || 0) === ((S.point && S.point.level) || 0)) { bd = d; best = p; } }
    if (best) { touched(); go(best, { walk: (S.point.links || []).includes(best.id) }); }
  });
  el.exit.onclick = () => { const s = getState(); dispose(); opts.onExit && opts.onExit(s); };
  el.exit.hidden = opts.exit === false;
  el.mode.onclick = e => {
    if (!e.target.closest('button[data-m="3d"]') || !opts.onSwitchTo3D) return;
    const s = stash(getState()); dispose(); opts.onSwitchTo3D(s);
  };
  if (el.res) el.res.onclick = () => { touched(); opts.onReserve(unit.id, getState()); };

  // gyroscope (only after an explicit tap; iOS asks for permission) --------------------------------
  const hasDO = typeof window.DeviceOrientationEvent !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  el.gy.hidden = !hasDO;
  const zee = new THREE.Vector3(0, 0, 1), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), eul = new THREE.Euler(), gq = new THREE.Quaternion(), ge = new THREE.Euler(0, 0, 0, 'YXZ');
  function onOrient(ev) {
    if (!S.gyro || ev.alpha == null) return;
    const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    eul.set(ev.beta * Math.PI / 180, ev.alpha * Math.PI / 180, -ev.gamma * Math.PI / 180, 'YXZ');
    gq.setFromEuler(eul); gq.multiply(q1); gq.multiply(q0.setFromAxisAngle(zee, -orient));
    ge.setFromQuaternion(gq, 'YXZ');
    if (S.gyro.base === null) S.gyro.base = S.yaw - ge.y;
    S.gyro.yaw = ge.y; S.gyro.pitch = clamp(ge.x, -1.45, 1.45); S.dirty = true;
  }
  el.gy.onclick = async () => {
    touched();
    if (S.gyro) { S.gyro = null; el.gy.classList.remove('on'); window.removeEventListener('deviceorientation', onOrient); return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') throw new Error('denied');
      }
      S.gyro = { base: null, off: 0, yaw: 0, pitch: 0 }; el.gy.classList.add('on');
      window.addEventListener('deviceorientation', onOrient);
    } catch { el.hint.textContent = T('gyroOff'); el.hint.classList.add('show'); setTimeout(() => el.hint.classList.remove('show'), 2500); }
  };

  // ---------------------------------------------------------------- loop
  function resize() {
    const w = root.clientWidth || 1, h = root.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; root.classList.toggle('phone', isPhone()); S.dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(root); resize();
  function frame(now) {
    if (S.disposed) return;
    const dt = Math.min(0.05, (now - S.lastT) / 1000); S.lastT = now;
    stepTrans(now);
    if (!drag && !S.gyro && (Math.abs(S.vy) > 1e-4 || Math.abs(S.vp) > 1e-4)) {
      S.yaw += S.vy; S.pitch = clamp(S.pitch + S.vp, -1.45, 1.45); S.vy *= 0.9; S.vp *= 0.9; S.dirty = true;
    } else if (!S.touched && !S.trans && !S.gyro) { S.yaw += dt * 0.035; S.dirty = true; }
    if (S.gyro && S.gyro.base !== null) { S.yaw = S.gyro.yaw + S.gyro.base + S.gyro.off; S.pitch = S.gyro.pitch; }
    if (S.dirty) {
      camera.rotation.set(S.pitch, S.yaw, 0); camera.fov = S.fov; camera.updateProjectionMatrix();
      sky.position.copy(camera.position);
      // rings: fade with distance, face-on size stays readable
      for (const g of hotGroup.children) {
        const d = g.position.distanceTo(camera.position);
        g.userData.ring.material.opacity = Math.min(g.userData.ring.material.opacity, 1) * 0 + clamp(1.25 - d * 0.08, 0.45, 0.95);
      }
      renderer.render(scene, camera);
      S.dirty = false;
      if (performance.now() - (S.mapT || 0) > 90) { drawMap(); S.mapT = performance.now(); }
    }
  }
  renderer.setAnimationLoop(frame);

  function getState() {
    const p = S.point; if (!p) return null;
    const yaw = wrapPi(S.yaw), pitch = S.pitch;
    if (S.key === 'apt') return { unitId: unit ? unit.id : opts.unitId, styleId: S.style, mode: S.mode, type: sceneDefs.apt.typeId, room: { kind: p.room, index: p.roomIndex || 0, level: p.level || 0 },
      u: p.pos[0], v: p.pos[1], level: p.level || 0, yaw, pitch, pointId: p.id, sample: sceneDefs.apt.sample, mapped: !!sceneDefs.apt.mapped, style0: S.style0, mode0: S.mode0 };
    const d = sceneDefs[S.key].def;
    // exact = the panorama's coordinates are valid on the visitor's own floor (lobby; lift hall of the same plate)
    const exact = S.key !== 'corridor' || corridorExact;
    return { unitId: unit ? unit.id : opts.unitId, styleId: S.aptStyle || opts.styleId, mode: S.mode, room: { kind: p.room, index: 0, level: 0 }, frame: 'building', building: d.building, floor: d.floor, scene: S.key, exact,
      x: p.pos[0], z: p.pos[1], yaw, pitch, pointId: p.id, style0: S.style0, mode0: S.mode0 };
  }
  function dispose() {
    if (S.disposed) return; S.disposed = true;
    renderer.setAnimationLoop(null); ro.disconnect(); window.removeEventListener('deviceorientation', onOrient);
    for (const e of cache.values()) if (e.t) e.t.dispose();
    cache.clear(); sky.geometry.dispose(); sky.material.dispose(); ringGeo.dispose(); discGeo.dispose(); hitGeo.dispose();
    hotGroup.traverse(o => o.material && o.material.dispose());
    renderer.dispose(); root.remove();
  }

  // ---------------------------------------------------------------- start
  try {
    await enterScene(startKey, { pointId: opts.pointId, room: COMMONS.includes(startRoom) ? undefined : (startRoom || 'living'), roomIndex: roomOpt && typeof roomOpt === 'object' ? roomOpt.index | 0 : 0, yaw: opts.yaw, style: opts.styleId });
    if (isFinite(opts.pitch)) S.pitch = clamp(opts.pitch, -1.45, 1.45);
    // what the viewer opened with — a style / light mode it only fell back to is not the visitor's choice
    S.style0 = S.aptStyle || null; S.mode0 = S.mode;
    if (isFinite(opts.yaw)) S.touched = true;            // arrived from the live 3D looking somewhere: no idle rotation
  } catch (e) {
    console.warn('[pano] start failed', e);
    el.load.querySelector('.in').innerHTML = `<div>${esc(T('none'))}</div>`;
    return { ok: false, dispose, close: dispose };
  }
  el.load.classList.add('off');
  el.hint.classList.add('show'); setTimeout(() => { if (!S.touched) el.hint.classList.remove('show'); }, 6000);
  el.canvas.focus({ preventScroll: true });

  // (tests / stills) the current view as a JPEG data URL
  const snapshot = (q = 0.86) => { camera.rotation.set(S.pitch, S.yaw, 0); camera.fov = S.fov; camera.updateProjectionMatrix(); sky.position.copy(camera.position); renderer.render(scene, camera); return el.canvas.toDataURL('image/jpeg', q); };
  root._ptSnapshot = snapshot;
  return { ok: true, setStyle, setMode, getState, snapshot, dispose, close: dispose, get scene() { return S.key; }, get pointId() { return S.point && S.point.id; }, get mode() { return S.mode; }, get styleId() { return S.style; },
    get styles() { return stylesOf('apt'); }, get modes() { return modesFor(S.key, S.style); }, get sample() { return !!(sceneDefs.apt && sceneDefs.apt.sample); } };
}
export default openPanoTour;
