// heli-app.js — V26 «Helicopter view» (entry point). openHeli({ lang, from, onClose }) builds a full-screen overlay with
// its own renderer and scene: the site's sky / light / plot (environment.js) + our towers (exterior.js) + the OSM city of
// V8-city (city.js, building volumes) + the satellite ground, relief, trees, night lamps (heli-world.js) + hand-built
// landmarks (heli-landmarks.js) + the helicopter (heli-model.js) and its pilot (heli-pilot.js). Cut-scene → spin-up →
// guided tour (autopilot, heli-flight.js) or manual flight; chase / cockpit / cinematic cameras; synthesised sound.
// Everything is imported only when the visitor presses the button; nothing of it is on the page before.
// Google is NOT used here (the city of env.city.enable() would start the Google 3D tiles — this module builds its own city).
import * as THREE from 'three';
import { START, LANDMARKS, BOZDOSH, IMAGERY, heliLang, heliT } from './heli-data.js';

const CSS = `
.heli{position:fixed;inset:0;z-index:2147483000;background:#0b0d10;color:#eef1f4;font:14px/1.35 Manrope,Inter,Heebo,Arial,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden}
.heli canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.heli [hidden]{display:none!important}
.heli button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;margin:0;padding:0;background:none;border:0;line-height:1.2;text-transform:none;letter-spacing:normal;box-shadow:none}
.heli .hb{min-width:40px;min-height:40px;border:1px solid rgba(255,255,255,.18);background:rgba(14,16,20,.62);border-radius:12px;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.heli .hb:hover{background:rgba(30,33,40,.8)} .heli .hb[aria-pressed="true"]{background:rgba(224,168,78,.9);color:#16130c;border-color:transparent}
.heli .hb svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.heli .top{position:absolute;left:calc(10px + env(safe-area-inset-left,0px));right:calc(10px + env(safe-area-inset-right,0px));top:calc(10px + env(safe-area-inset-top,0px));display:flex;align-items:flex-start;gap:8px;pointer-events:none;z-index:3}
.heli .top>*{pointer-events:auto}
.heli .left{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px;pointer-events:none}
.heli .ttl{min-width:0;display:flex;flex-direction:column;gap:2px;pointer-events:none}
.heli .ttl b{font-size:16px;letter-spacing:.02em;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.heli .ttl span{font-size:12px;opacity:.85;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.heli .tools{display:flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end;flex:0 0 auto}
.heli .banner{position:absolute;left:50%;top:calc(var(--toph,90px) + 8px);transform:translateX(-50%);max-width:min(680px,calc(100% - 24px));text-align:center;pointer-events:none;opacity:0;transition:opacity .5s,transform .5s;z-index:2}
.heli .banner.on{opacity:1}
.heli .banner .n{display:inline-block;font-size:clamp(18px,3.4vw,30px);font-weight:700;line-height:1.2;padding:8px 16px;border-radius:14px;background:linear-gradient(180deg,rgba(10,12,16,.72),rgba(10,12,16,.5));text-shadow:0 1px 2px rgba(0,0,0,.5)}
.heli .banner .s{display:block;margin-top:6px;font-size:12px;opacity:.85;letter-spacing:.04em}
.heli .banner .bar{display:block;height:3px;margin:8px auto 0;width:160px;border-radius:2px;background:rgba(255,255,255,.2);overflow:hidden}
.heli .banner .bar i{display:block;height:100%;width:0;background:#e0a84e}
.heli .phase{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(148px + env(safe-area-inset-bottom,0px));font-size:13px;padding:6px 12px;border-radius:10px;background:rgba(10,12,16,.55);pointer-events:none;opacity:0;transition:opacity .4s;white-space:normal;text-align:center;max-width:calc(100% - 24px);z-index:2}
.heli .phase.on{opacity:1}
.heli .inst{position:static;display:grid;grid-template-columns:auto auto;gap:2px 10px;font:600 12px/1.3 ui-monospace,Menlo,Consolas,monospace;background:rgba(10,12,16,.5);padding:6px 9px;border-radius:10px;pointer-events:none;z-index:2}
.heli .inst i{font-style:normal;opacity:.7;font-family:Manrope,Inter,Arial,sans-serif;font-weight:500}
.heli .bot{position:absolute;left:calc(10px + env(safe-area-inset-left,0px));right:calc(10px + env(safe-area-inset-right,0px));bottom:calc(46px + env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;pointer-events:none;z-index:3}
.heli .bot>*{pointer-events:auto}
.heli .seg{display:inline-flex;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.18);background:rgba(14,16,20,.62)}
.heli .seg .hb{border:0;border-radius:0;background:transparent}
.heli .seg .hb[aria-pressed="true"]{background:rgba(224,168,78,.92)}
.heli .attr{position:absolute;right:calc(6px + env(safe-area-inset-right,0px));bottom:calc(3px + env(safe-area-inset-bottom,0px));font:10px/1.25 Arial,sans-serif;color:rgba(255,255,255,.82);background:rgba(0,0,0,.38);padding:2px 6px;border-radius:3px;max-width:calc(100% - 12px);text-align:end;z-index:3}
.heli .attr{border:0;cursor:pointer}.heli .attr::before{content:'';position:absolute;left:0;right:0;bottom:0;height:40px}
.heli .attrpop{position:absolute;right:calc(6px + env(safe-area-inset-right,0px));bottom:calc(24px + env(safe-area-inset-bottom,0px));max-width:min(420px,calc(100% - 12px));background:rgba(12,14,18,.94);border-radius:10px;padding:4px 10px;z-index:6;display:flex;flex-direction:column;font:12px/1.35 Arial,sans-serif}
.heli .attrpop a{color:#eef1f4;text-decoration:none;min-height:40px;display:flex;align-items:center}
.heli .stick{position:absolute;bottom:calc(106px + env(safe-area-inset-bottom,0px));width:132px;height:132px;border-radius:50%;background:rgba(14,16,20,.35);border:1px solid rgba(255,255,255,.22);display:none;z-index:2;touch-action:none}
.heli .stick.l{left:calc(16px + env(safe-area-inset-left,0px))} .heli .stick.r{right:calc(16px + env(safe-area-inset-right,0px))}
.heli .stick i{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,255,255,.28);border:1px solid rgba(255,255,255,.5)}
.heli .stick b{position:absolute;left:0;right:0;top:-18px;text-align:center;font-size:11px;font-weight:500;opacity:.8;pointer-events:none}
.heli.manual .stick{display:block}
.heli .hint{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100px + env(safe-area-inset-bottom,0px));font-size:12px;max-width:min(560px,calc(100% - 24px));text-align:center;background:rgba(10,12,16,.55);padding:6px 10px;border-radius:10px;display:none;z-index:2}
.heli.manual.kbd .hint{display:block}
.heli.manual.touch .hint{display:none}
.heli.manual.kbd .phase{bottom:calc(170px + env(safe-area-inset-bottom,0px))}
.heli .veil{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:radial-gradient(circle at 50% 40%,#1b2230,#07090c);z-index:5;text-align:center;padding:24px;transition:opacity .6s}
.heli .veil.off{opacity:0;pointer-events:none}
.heli .veil b{font-size:20px} .heli .veil span{font-size:13px;opacity:.75;max-width:420px}
.heli .veil .spin{width:46px;height:46px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:#e0a84e;animation:hspin 1s linear infinite}
.heli .veil .pr{width:200px;height:3px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden}.heli .veil .pr i{display:block;height:100%;width:0;background:#e0a84e;transition:width .3s}
@keyframes hspin{to{transform:rotate(360deg)}}
.heli .flash{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);background:rgba(160,30,20,.78);padding:8px 14px;border-radius:10px;font-weight:600;opacity:0;transition:opacity .3s;pointer-events:none;z-index:4;max-width:calc(100% - 24px);text-align:center}
.heli .flash.on{opacity:1}
.heli .fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:1}
.heli[dir="rtl"] .tools{justify-content:flex-start}
@media (max-width:620px){.heli .hb .lb{display:none}.heli .ttl b{font-size:14px}.heli .bot{bottom:calc(44px + env(safe-area-inset-bottom,0px))}.heli .stick{width:118px;height:118px;bottom:calc(112px + env(safe-area-inset-bottom,0px))}}
@media (max-height:460px){.heli .banner .n{font-size:18px;padding:5px 12px}.heli .stick{bottom:calc(92px + env(safe-area-inset-bottom,0px));width:104px;height:104px}.heli .inst{display:none}.heli .phase{bottom:calc(96px + env(safe-area-inset-bottom,0px))}}
.heli .lb2{display:inline}
.heli.manual.touch .bot .lb2{display:none}
.heli.manual.touch .bot .hb{padding:0 10px}
.heli.manual.touch .bot{left:50%;right:auto;transform:translateX(-50%);flex-wrap:nowrap}
@media (max-width:420px){.heli .bot .lb2{display:none}.heli .bot .seg .lb2{display:inline}.heli.manual .bot .seg .lb2{display:none}}
@media (max-height:460px){.heli.manual.touch .stick{bottom:calc(46px + env(safe-area-inset-bottom,0px))}.heli.manual.touch .inst{display:none}}
@media (max-width:380px){.heli .seg .lb2{font-size:12px}.heli .bot .hb{padding:0 9px}.heli .tools .hb{padding:0 9px;min-width:40px}.heli .tools{gap:4px}.heli .ttl b{font-size:13px;overflow-wrap:anywhere}}
@media (max-width:460px){.heli .g3d-btn .t{display:none}.heli .g3d-btn{padding:0 9px}}
`;
const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M3 8h4l2-2h6l2 2h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dusk: '<svg viewBox="0 0 24 24"><path d="M3 18h18M6 18a6 6 0 0 1 12 0M12 6v3M5 10l1.6 1.2M19 10l-1.6 1.2"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  snd: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  land: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>',
  tour: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  stick: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="3"/><path d="M12 9v8M7 21h10"/></svg>',
  again: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M5 5l8 7-8 7zM15 5v14"/></svg>',
};
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage off */ } } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let ACTIVE = null;
/** Opens the helicopter view. → Promise<controller { close() }> */
export async function openHeli(opts = {}) {
  if (ACTIVE) return ACTIVE;
  const lang = heliLang(opts.lang), t = (k) => heliT(lang, k);
  const q = new URLSearchParams(location.search);
  const touch = matchMedia('(pointer: coarse)').matches;
  const phone = touch && Math.min(screen.width, screen.height) < 820;
  // ---------------------------------------------------------------- DOM
  if (!document.getElementById('heli-css')) { const st = document.createElement('style'); st.id = 'heli-css'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'heli' + (touch ? ' touch' : ' kbd'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', t('title'));
  root.lang = lang; root.dir = lang === 'he' ? 'rtl' : 'ltr';
  root.innerHTML = `
    <div class="veil"><div class="spin"></div><b>${t('loading')}</b><span>${t('loadingSub')}</span><div class="pr"><i></i></div></div>
    <div class="top"><div class="left"><div class="ttl"><b>${t('title')}</b><span class="sub"></span></div>
      <div class="inst" aria-hidden="true"><i>${t('speed')}</i><span data-v="spd">0</span><i>${t('alt')}</i><span data-v="alt">0</span><i>${t('hdg')}</i><span data-v="hdg">0</span></div></div>
      <div class="tools">
        <button class="hb" data-a="cam" aria-label="${t('cam')}" title="${t('cam')}">${ICON.cam}<span class="lb">${t('camChase')}</span></button>
        <button class="hb" data-a="light" aria-label="${t('light')}" title="${t('light')}">${ICON.sun}<span class="lb">${t('day')}</span></button>
        <button class="hb" data-a="snd" aria-label="${t('sound')}" title="${t('sound')}">${ICON.snd}</button>
        <button class="hb" data-a="close" aria-label="${t('close')}" title="${t('close')}">${ICON.close}</button>
      </div></div>
    <div class="banner" aria-live="polite"><span class="n"></span><span class="s"></span><span class="bar"><i></i></span></div>
    <div class="phase" aria-live="polite"></div>
    <div class="flash" role="status"></div>
    <div class="fade" aria-hidden="true"></div>
    <div class="hint">${t('manualHint')}</div>
    <div class="stick l" data-s="l"><b>${t('alt')} · ${t('hdg')}</b><i></i></div><div class="stick r" data-s="r"><b>${t('speed')}</b><i></i></div>
    <div class="bot">
      <div class="seg" role="group"><button class="hb" data-a="auto" aria-pressed="true" aria-label="${t('tour')}">${ICON.tour}<span class="lb2">${t('tour')}</span></button><button class="hb" data-a="manual" aria-pressed="false" aria-label="${t('manual')}">${ICON.stick}<span class="lb2">${t('manual')}</span></button></div>
      <button class="hb" data-a="back" hidden aria-label="${t('backTour')}">${ICON.tour}<span class="lb2">${t('backTour')}</span></button>
      <button class="hb" data-a="land" aria-label="${t('land')}">${ICON.land}<span class="lb2">${t('land')}</span></button>
      <button class="hb" data-a="skip" hidden aria-label="${t('skip')}">${ICON.skip}<span class="lb2">${t('skip')}</span></button>
      <button class="hb" data-a="again" hidden aria-label="${t('again')}">${ICON.again}<span class="lb2">${t('again')}</span></button>
    </div>
    <button class="attr" data-a="attr" type="button" dir="ltr" aria-expanded="false">© OpenStreetMap contributors · ${IMAGERY.short} · Terrain Tiles</button>
    <div class="attrpop" dir="ltr" hidden><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors (ODbL)</a><a href="${IMAGERY.link}" target="_blank" rel="noopener">${IMAGERY.attribution}</a><a href="${IMAGERY.reliefLink}" target="_blank" rel="noopener">${IMAGERY.relief}</a></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
  const veilPr = $('.veil .pr i'), T0 = performance.now(), DBG = q.has('heliDebug'); const progress = (k) => { veilPr.style.width = Math.round(k * 100) + '%'; if (DBG) console.info('[heli] load', k, Math.round(performance.now() - T0) + ' ms'); };
  let closed = false;
  const ctl = { close: () => close(), root };
  ACTIVE = ctl;

  // audio context must be created inside the tap that opened the view
  let audio = null;
  try { const A = await import('./heli-audio.js'); audio = A.createHeliAudio(); audio.resume(); } catch (e) { console.warn('[heli] audio', e); }

  const S = { cam: q.get('heliCam') || LS.get('vrc-heli-cam', 'cockpit'), mode: 'day', intro: true, introT: 0, look: { yaw: 0, pitch: 0, dist: 1 }, last: performance.now(), fps: { n: 0, t0: performance.now(), v: 0, hist: [] }, panelT: 0, bannerT: 0, flashT: 0, frames: 0, skip: false };
  let renderer, scene, camera, env, city, world, lmk, heli, pilot, flight, complex, dyn, raf = 0, CD, D, g3d = null, classicHidden = false;
  try {
    progress(0.05);
    const [ENV, EXT, CDm, Dm, W, LM, HM, PL, FL, DR] = await Promise.all([
      import('../three/environment.js'), import('../three/exterior.js'), import('../three/city-data.js'), import('../data.js'),
      import('./heli-world.js'), import('./heli-landmarks.js'), import('./heli-model.js'), import('./heli-pilot.js'), import('./heli-flight.js'), import('../three/dynres.js'),
    ]);
    CD = CDm; D = Dm;
    if (closed) return ctl;
    progress(0.2);
    renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: 'high-performance', preserveDrawingBuffer: q.has('heliShots') });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.shadowMap.enabled = false;
    root.insertBefore(renderer.domElement, root.firstChild);
    dyn = DR.createDynRes(renderer, { max: DR.ratioCap(1.75, 1.5), min: 0.7, start: phone ? 1.25 : DR.ratioCap(1.75, 1.5) });
    const size = () => { const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight; renderer.setSize(w, h, false); if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); } };
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, 1, 0.4, 32000); size();
    const mode0 = ['day', 'dusk', 'night'].includes(q.get('heliMode')) ? q.get('heliMode') : LS.get('vrc-heli-light', 'day');
    env = ENV.createEnvironment(scene, renderer, { mode: mode0 });
    await Promise.race([env.ready, new Promise(r => setTimeout(r, 4000))]);
    progress(0.3);
    try { complex = EXT.createComplex({}); scene.add(complex.group); } catch (e) { console.warn('[heli] complex', e); }
    await CD.loadCity(); progress(0.45);
    const CITYm = await import('../three/city.js');
    city = await CITYm.createCity(scene, { mode: mode0, detail: 'far', r1: phone ? 1150 : 1700, quality: phone ? 'low' : 'high', frameMs: +q.get('heliFrameMs') || undefined });
    for (const n of ['city-far-ground', 'city-skirt', 'city-banks', 'city-water']) { const o = city.group.getObjectByName(n); if (o) o.visible = false; }
    hideBelt(env.group, CD.CITY.seam);
    progress(0.55);
    world = W.createHeliWorld({ scene, CD, D, phone });
    await world.build((s) => progress(s === 'ground' ? 0.62 : 0.75));
    lmk = LM.buildLandmarks({ CD, D }); scene.add(lmk.group); world.extraBoxes.push(...lmk.boxes);
    if (complex) { complex.group.updateMatrixWorld(true); for (const c of complex.group.children) { const b = new THREE.Box3().setFromObject(c); if (isFinite(b.max.y) && b.max.y > 6) world.extraBoxes.push({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, h: b.max.y + 1 }); } }
    progress(0.85);
    heli = HM.createHeli({ phone }); scene.add(heli.root);
    pilot = await PL.createPilot({ phone, antialias: !phone }); heli.body.add(pilot.group); if (pilot.setCockpit) pilot.setCockpit(heli.controls);
    if (closed) return ctl;
    // Google mode: the photoreal city is not flat (castle hill …) → its surface, sampled by rays, joins the OSM heights
    const g3dCells = new Map(); let g3dRays = 0; const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), RO = new THREE.Vector3();
    const g3dFloorAt = (x, z) => {
      if (!g3d || !g3d.active || !g3d.holder) return -Infinity;
      const k = Math.round(x / 24) + ':' + Math.round(z / 24); let c = g3dCells.get(k);
      if (c && performance.now() - c.t < 20000) return c.y;
      if (g3dRays >= 6) return c ? c.y : -Infinity; g3dRays++;
      RO.set(Math.round(x / 24) * 24, 1500, Math.round(z / 24) * 24); ray.set(RO, DOWN); ray.far = 3000;
      let y = -Infinity; try { const h = ray.intersectObject(g3d.holder, true); if (h.length) y = h[0].point.y; } catch (e) { /* tiles changing */ }
      if (g3dCells.size > 4000) g3dCells.clear(); g3dCells.set(k, { y, t: performance.now() }); return y;
    };
    const flyWorld = { terrainY: (x, z) => Math.max(world.terrainY(x, z), g3dFloorAt(x, z) - 2), heightAt: (x, z, r) => Math.max(world.heightAt(x, z, r), g3dFloorAt(x, z)) };
    ctl._g3dTick = () => { g3dRays = 0; };
    const [sx, sz] = D.llToWorld(START.lat, START.lon);
    const lms = LANDMARKS.map(L => { const [x, z] = D.llToWorld(L.lat, L.lon); return { ...L, x, z, nameT: L.name[lang] || L.name.en }; });
    flight = FL.createFlight({ world: flyWorld, start: { x: sx, z: sz, heading: START.heading }, landmarks: lms, onEvent });
    heli.root.position.set(sx, 0, sz); heli.root.rotation.y = START.heading;
    city.update(0, heli.root.position); await city.ensureTiles(sx, sz, 300, true);
    // ---- Google Photorealistic 3D Tiles as the city (owner's Map Tiles key, js/maps-config.js) — fallback: the OSM city +
    // free satellite ground above. Policies as in js/three/google3d.js: Google logo + attributions, no caching / pre-fetch,
    // the classic city hidden while Google is shown, 403 / 429 / no coverage → back to the classic city with a note.
    try {
      const G3 = await import('../three/google3d.js');
      if (G3.google3dConfigured() && !q.has('heliNoGoogle')) {
        let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of D.PLOT) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        g3d = G3.attachGoogle3D(THREE, {
          id: 'heli', lang, renderer, parent: scene, host: root, camera, quality: phone ? 'low' : 'high',
          frame: { toLL: (x, z) => D.worldToLL(x, z), fromLL: (la, lo) => D.llToWorld(la, lo), h0: 156 },
          clip: [{ x: (x0 + x1) / 2, z: (z0 + z1) / 2, ux: 1, uz: 0, hw: (x1 - x0) / 2 + 1, hd: (z1 - z0) / 2 + 1, top: 400 }], padColor: '#7d7b74',
          hideClassic(h) { classicHidden = h; for (const o of [city.group, world.group, lmk.group]) o.visible = !h; for (const a of root.querySelectorAll('.attr, .attrpop')) a.style.display = h ? 'none' : ''; },
          refPoints(x, z) { const out = []; for (const r of CD.roadsNear(x, z, 60)) { if (!r.car || r.bridge || r.tunnel) continue; for (const p of r.pts) out.push(p); }
            return out.map(p => [p[0], p[1], Math.hypot(p[0] - x, p[1] - z)]).filter(p => p[2] < 70).sort((a, b) => a[2] - b[2]).slice(0, 14); },
          tint: () => (S.mode === 'night' ? 0.3 : S.mode === 'dusk' ? 0.62 : 1),
          mountButton(b) { const tools = root.querySelector('.tools'); b.classList.add('hb-g3d'); tools.insertBefore(b, tools.firstChild); return true; },
          say: (txt, ms) => { try { showPhase(txt, (ms || 3000) / 1000); } catch (e) { /* HUD not ready */ } },
          cls: 'g3d-heli', css: '.g3d-wrap.g3d-heli{left:50%;transform:translateX(-50%);top:calc(56px + env(safe-area-inset-top,0px))}.heli .g3d-btn{min-height:40px;height:40px;border-radius:12px}',
        });
        g3d.enter();
      }
    } catch (e) { console.warn('[heli] google 3D unavailable', e); g3d = null; }
    applyMode(mode0);
    addEventListener('resize', size); ctl._size = size;
    progress(1);
    // warm-up: compile every shader before the first visible frame
    try { camera.position.set(sx + 20, 6, sz - 10); camera.lookAt(sx, 1, sz); if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { /* not fatal */ }
    if (closed) return ctl;
    world.buildLater(BOZDOSH).then(() => { if (!closed) { try { renderer.compile(scene, camera); } catch (e) { /* later */ } } }).catch(e => console.warn('[heli] trees', e));
    $('.veil').classList.add('off');
  } catch (e) {
    console.error('[heli] failed', e);
    const v = $('.veil'); v.innerHTML = `<b>${t('error')}</b><span>${String(e && e.message || e).slice(0, 160)}</span><button class="hb" data-a="close">${t('close')}</button>`;
    v.querySelector('[data-a="close"]').onclick = () => close();
    return ctl;
  }

  // ---------------------------------------------------------------- state, HUD
  S.mode = env.mode;
  if (!['chase', 'cockpit', 'orbit'].includes(S.cam)) S.cam = 'cockpit';
  const camLabels = { chase: 'camChase', cockpit: 'camCockpit', orbit: 'camOrbit' };
  const btn = (a) => root.querySelector(`[data-a="${a}"]`);
  const setCamBtn = () => { btn('cam').querySelector('.lb').textContent = t(camLabels[S.cam]); };
  const setLightBtn = () => { const b = btn('light'); b.innerHTML = (S.mode === 'day' ? ICON.sun : S.mode === 'dusk' ? ICON.dusk : ICON.moon) + `<span class="lb">${t(S.mode)}</span>`; };
  const setSndBtn = () => { const b = btn('snd'); const m = !audio || audio.muted; b.innerHTML = m ? ICON.mute : ICON.snd; b.setAttribute('aria-pressed', String(!m)); };
  setCamBtn(); setLightBtn(); setSndBtn();
  const fadeEl = $('.fade');
  try { const top = $('.top'); const ro = new ResizeObserver(() => root.style.setProperty('--toph', Math.ceil(top.getBoundingClientRect().bottom) + 'px')); ro.observe(top); ctl._ro = ro; } catch (e) { /* old browser: default */ }
  const banner = $('.banner'), phaseEl = $('.phase'), flashEl = $('.flash'), sub = $('.ttl .sub');
  const showPhase = (txt, secs = 3) => { phaseEl.textContent = txt; phaseEl.classList.toggle('on', !!txt); S.phaseHide = secs ? performance.now() + secs * 1000 : 0; };
  const flash = (txt) => { flashEl.textContent = txt; flashEl.classList.add('on'); S.flashT = 1.8; };
  function onEvent(type, d) {
    if (type === 'leg') { sub.textContent = `${t('fly')}: ${d.lm.nameT}`; }
    else if (type === 'phase') { const p = d.phase; if (p === 'spinup') showPhase(t('startup'), 0); else if (p === 'takeoff') showPhase(t('takeoff'), 4); else if (p === 'land') showPhase(t('landing'), 0); else if (p === 'transit') phaseEl.classList.remove('on'); else if (p === 'return' || p === 'goland') { sub.textContent = START.street[lang] || START.street.en; } else if (p === 'free') { phaseEl.classList.remove('on'); sub.textContent = t('manual'); } }
    else if (type === 'landed') { showPhase(t('landed'), 6); sub.textContent = t('tourDone'); btn('again').hidden = false; }
    else if (type === 'bounce' || type === 'unstick') { flash(t('recover')); }
    else if (type === 'mode') updateModeUI();
  }
  function updateModeUI() {
    const m = flight.s.mode; root.classList.toggle('manual', m === 'manual');
    btn('auto').setAttribute('aria-pressed', String(m === 'tour')); btn('manual').setAttribute('aria-pressed', String(m === 'manual'));
    btn('back').hidden = m !== 'manual';
    btn('land').hidden = ['parked', 'spinup', 'landed', 'land', 'goland', 'return'].includes(flight.s.phase) && m === 'tour';
    btn('skip').hidden = !S.intro;
    btn('again').hidden = flight.s.phase !== 'landed';
  }
  function applyMode(m) {
    S.mode = m; env.setMode(m); city.setMode(m); world.setMode(m); if (heli) { heli.setMode(m); heli.landLight = m !== 'day'; }
    // aerial haze: lighter than at street level, so the city reads to the horizon
    if (scene.fog && scene.fog.isFogExp2) scene.fog.density *= m === 'day' ? 0.42 : 0.6;
    renderer.toneMappingExposure = m === 'day' ? 1.0 : m === 'dusk' ? 1.08 : 1.15;
    LS.set('vrc-heli-light', m);
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a; if (audio) audio.resume();
    if (a === 'attr') { const pop = $('.attrpop'); pop.hidden = !pop.hidden; b.setAttribute('aria-expanded', String(!pop.hidden)); return; }
    if (a === 'close') close();
    else if (a === 'cam') { S.cam = S.cam === 'chase' ? 'cockpit' : S.cam === 'cockpit' ? 'orbit' : 'chase'; S.look.yaw = S.look.pitch = 0; LS.set('vrc-heli-cam', S.cam); setCamBtn(); }
    else if (a === 'light') { applyMode(S.mode === 'day' ? 'dusk' : S.mode === 'dusk' ? 'night' : 'day'); setLightBtn(); }
    else if (a === 'snd') { if (audio) audio.setMuted(!audio.muted); setSndBtn(); }
    else if (a === 'auto' || a === 'back') { flight.setMode('tour'); updateModeUI(); }
    else if (a === 'manual') { flight.setMode('manual'); updateModeUI(); }
    else if (a === 'land') { flight.land(); updateModeUI(); }
    else if (a === 'skip') { S.skip = true; }
    else if (a === 'again') { flight.setMode('tour'); flight.takeoffAgain(); updateModeUI(); }
  });
  // keyboard
  const keys = new Set();
  const onKey = (e) => { if (closed) return; if (e.key === 'Escape') { close(); return; } const down = e.type === 'keydown'; if (down) keys.add(e.code); else keys.delete(e.code);
    if (down && ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); if (flight.s.mode !== 'manual' && !S.intro && flight.s.phase !== 'spinup') { flight.setMode('manual'); updateModeUI(); } }
    if (down && e.code === 'KeyC') btn('cam').click(); };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);
  // touch sticks
  const sticks = { l: { x: 0, y: 0, id: null }, r: { x: 0, y: 0, id: null } };
  root.querySelectorAll('.stick').forEach(el => {
    const k = el.dataset.s, knob = el.querySelector('i'), st = sticks[k];
    const move = (e) => { const r = el.getBoundingClientRect(), R = r.width / 2; let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } st.x = x; st.y = y; knob.style.transform = `translate(${x * R * 0.6}px,${y * R * 0.6}px)`; };
    el.addEventListener('pointerdown', (e) => { st.id = e.pointerId; el.setPointerCapture(e.pointerId); move(e); e.preventDefault(); if (audio) audio.resume(); });
    el.addEventListener('pointermove', (e) => { if (st.id === e.pointerId) move(e); });
    const up = (e) => { if (st.id !== e.pointerId) return; st.id = null; st.x = st.y = 0; knob.style.transform = ''; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  // look around (drag on the picture), zoom (wheel / pinch)
  const drag = { id: null, x: 0, y: 0, pts: new Map(), d0: 0 };
  renderer.domElement.addEventListener('pointerdown', (e) => { drag.pts.set(e.pointerId, [e.clientX, e.clientY]); if (drag.id == null) { drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; } if (drag.pts.size === 2) { const [a, b] = [...drag.pts.values()]; drag.d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); drag.dist0 = S.look.dist; } if (audio) audio.resume(); });
  renderer.domElement.addEventListener('pointermove', (e) => { if (!drag.pts.has(e.pointerId)) return; drag.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag.pts.size === 2) { const [a, b] = [...drag.pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); S.look.dist = clamp(drag.dist0 * drag.d0 / Math.max(20, d), 0.45, 2.6); return; }
    if (e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; S.look.yaw -= dx * 0.005; S.look.pitch = clamp(S.look.pitch - dy * 0.004, -0.9, 0.7); S.look.t = performance.now(); });
  const pend = (e) => { drag.pts.delete(e.pointerId); if (e.pointerId === drag.id) drag.id = null; };
  renderer.domElement.addEventListener('pointerup', pend); renderer.domElement.addEventListener('pointercancel', pend);
  renderer.domElement.addEventListener('wheel', (e) => { S.look.dist = clamp(S.look.dist * (e.deltaY > 0 ? 1.1 : 0.9), 0.45, 2.6); e.preventDefault(); }, { passive: false });
  const onVis = () => { if (!audio) return; if (document.hidden) audio.suspend(); else audio.resume(); };
  document.addEventListener('visibilitychange', onVis);

  // ---------------------------------------------------------------- dust (landing / take-off)
  const dust = (() => {
    const N = phone ? 90 : 160, pos = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c), mat = new THREE.PointsMaterial({ size: 7, map: tex, color: '#b7a88f', transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts); let k = 0;
    return { update(dt, x, y, z, rpm, agl, gy) {
      const strength = rpm > 0.6 ? clamp(1 - agl / 16, 0, 1) * rpm : 0; mat.opacity = 0.55 * Math.max(strength, mat.opacity * 0.98);
      const spawn = Math.floor(strength * 160 * dt + Math.random());
      for (let s = 0; s < spawn; s++) { const i = k++ % N, a = Math.random() * 6.283, r = 2 + Math.random() * 4; pos[i * 3] = x + Math.sin(a) * r; pos[i * 3 + 1] = gy + 0.3; pos[i * 3 + 2] = z + Math.cos(a) * r; vel[i * 3] = Math.sin(a) * (6 + Math.random() * 6); vel[i * 3 + 1] = 0.6 + Math.random() * 1.5; vel[i * 3 + 2] = Math.cos(a) * (6 + Math.random() * 6); life[i] = 1.6; }
      for (let i = 0; i < N; i++) { if (life[i] <= 0) { pos[i * 3 + 1] = -999; continue; } life[i] -= dt; pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt; vel[i * 3] *= 0.97; vel[i * 3 + 2] *= 0.97; }
      geo.attributes.position.needsUpdate = true; pts.visible = mat.opacity > 0.01; },
      dispose() { geo.dispose(); mat.dispose(); tex.dispose(); scene.remove(pts); } };
  })();

  // ---------------------------------------------------------------- cut-scene, seen through the visitor's (client's) eyes:
  // the pilot walks up, opens the PASSENGER door and invites the client in; the client boards and sits in the front
  // passenger seat (left); she closes his door, walks round the nose to her own door (right), climbs in, shuts it → start.
  const SIDE = heli.SIDE, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const seatPos = new THREE.Vector3().copy(heli.seat.position); seatPos.y = pilot.seatHipY(1.01);
  const PS = heli.pDoorStep.clone(), PI_ = V3(-SIDE * 2.7, 0, 3.0), STEPUP = V3(SIDE * 1.18, 0.42, 1.52);
  const A0 = V3(-SIDE * 9.5, 0, 10.5), CLIENT = V3(-SIDE * 4.8, 1.68, 4.4), CSTEP = V3(-SIDE * 1.95, 2.02, 1.7), CEYE = heli.eye.position.clone();
  const ROUND = [PS.clone().add(V3(-SIDE * 0.5, 0, 0.4)), V3(-SIDE * 2.4, 0, 4.9), V3(SIDE * 2.4, 0, 4.9), heli.doorStep.clone()];
  const plen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += pts[i].distanceTo(pts[i - 1]); return l; };
  const along = (pts, d, out) => { for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); if (d <= l || i === pts.length - 1) { out.lerpVectors(pts[i - 1], pts[i], Math.min(1, d / (l || 1))); return Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); } d -= l; } return 0; };
  const W1 = A0.distanceTo(PS) / 1.35, W2 = plen(ROUND) / 1.35;
  const TL = {}; { let t0 = 0; for (const [k, d] of [['walk', W1], ['popen', 1.2], ['invite', 1.8], ['board', 3.4], ['pclose', 1.1], ['round', W2], ['reach', 1.0], ['climb', 2.0], ['close', 1.0]]) { t0 += d; TL[k] = t0; } }
  const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  pilot.group.position.copy(A0); pilot.group.rotation.y = yawTo(A0, PS);
  const _p = new THREE.Vector3();
  function intro(dt) {
    S.introT += dt; const T = S.introT, G = pilot.group;
    const ph = (k0, k1) => clamp((T - (TL[k0] || 0)) / ((TL[k1]) - (TL[k0] || 0)), 0, 1);
    if (T < TL.walk) { const k = T / TL.walk; G.position.lerpVectors(A0, PS, k); G.rotation.y = yawTo(A0, PS); pilot.walk(k * A0.distanceTo(PS) / 1.45 * Math.PI * 2, 1); showPhase(t('boarding'), 0); }
    else if (T < TL.popen) { const k = ph('walk', 'popen'); G.position.copy(PS); G.rotation.y = Math.atan2(SIDE, 0); pilot.reach(Math.sin(k * Math.PI)); heli.pDoorOpen = sm(0.25, 1, k); }
    else if (T < TL.invite) { const k = ph('popen', 'invite'); G.position.lerpVectors(PS, PI_, sm(0, 0.6, k)); G.rotation.y = THREE.MathUtils.lerp(Math.atan2(SIDE, 0), yawTo(PI_, CLIENT), sm(0, 0.7, k)); pilot.invite(sm(0.3, 0.8, k)); heli.pDoorOpen = 1; }
    else if (T < TL.board) { const k = ph('invite', 'board'); G.position.copy(PI_); G.rotation.y = yawTo(PI_, CLIENT); pilot.invite(1 - sm(0.5, 1, k)); }
    else if (T < TL.pclose) { const k = ph('board', 'pclose'); G.position.lerpVectors(PI_, ROUND[0], sm(0, 0.5, k)); G.rotation.y = Math.atan2(SIDE, 0); pilot.reach(Math.sin(k * Math.PI)); heli.pDoorOpen = 1 - sm(0.3, 1, k); }
    else if (T < TL.round) { const k = ph('pclose', 'round'), d = k * plen(ROUND); G.rotation.y = along(ROUND, d, G.position); pilot.walk(d / 1.45 * Math.PI * 2, 1); heli.pDoorOpen = 0; }
    else if (T < TL.reach) { const k = ph('round', 'reach'); G.position.copy(heli.doorStep); G.rotation.y = Math.atan2(-SIDE, 0); pilot.reach(Math.sin(k * Math.PI)); heli.doorOpen = sm(0.25, 1, k); }
    else if (T < TL.climb) { const k = ph('reach', 'climb'); if (k < 0.45) G.position.lerpVectors(heli.doorStep, STEPUP, sm(0, 0.45, k)); else G.position.lerpVectors(STEPUP, seatPos, sm(0.45, 1, k)); G.rotation.y = THREE.MathUtils.lerp(Math.atan2(-SIDE, 0), 0, sm(0.35, 0.95, k)); pilot.climb(k); }
    else if (T < TL.close) { const k = ph('climb', 'close'); G.position.copy(seatPos); G.rotation.y = 0; pilot.sit(T); heli.doorOpen = 1 - sm(0, 1, k); }
    if (pilot.lookAtClient) pilot.lookAtClient(T > TL.climb + 0.3 && T < TL.close + 1.5);
    if (T < TL.close) { /* cut-scene continues */ }
    else { S.intro = false; heli.doorOpen = 0; heli.pDoorOpen = 0; G.position.copy(seatPos); G.rotation.y = 0; pilot.sit(T); flight.start(); updateModeUI(); }
  }
  /** the client's eye during the cut-scene (helicopter local frame): position + look target */
  function introEye(outP, outL) {
    const T = S.introT, G = pilot.group, head = _p.copy(G.position); head.y += 1.5;
    S.fadeK = 0;
    if (T < TL.invite) { outP.copy(CLIENT); outL.copy(head); }
    else if (T < TL.board) { const k = clamp((T - TL.invite) / (TL.board - TL.invite), 0, 1);
      if (k < 0.45) outP.lerpVectors(CLIENT, CSTEP, sm(0, 0.45, k)); else outP.lerpVectors(CSTEP, CEYE, sm(0.45, 1, k));
      outL.lerpVectors(V3(-SIDE * 0.9, 1.4, 1.6), V3(-SIDE * 0.42, 1.6, 6), sm(0.35, 1, k));
      S.fadeK = Math.sin(clamp((k - 0.36) / 0.36, 0, 1) * Math.PI); }
    else { outP.copy(CEYE); const fwd = V3(-SIDE * 0.42, 1.65, 8);
      const watch = T < TL.close ? 1 - sm(TL.climb + 0.4, TL.close, T) : 0; outL.lerpVectors(fwd, head, watch * 0.85); }
  }
  function skipIntro() { S.introT = TL.close + 0.01; intro(0); S.skip = false; }
  if (q.get('heliIntro') === '0') skipIntro();
  updateModeUI();

  // ---------------------------------------------------------------- cameras
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), eyeQ = new THREE.Quaternion(), eyeP = new THREE.Vector3();
  let camInit = false;
  function placeCamera(dt) {
    if (S.camOverride) { const o = S.camOverride; camera.position.set(o[0], o[1], o[2]); camera.up.set(0, 1, 0); camera.lookAt(o[3], o[4], o[5]); camera.fov = o[6] || 50; camera.near = 0.4; camera.updateProjectionMatrix(); return; }
    const s = flight.s, hp = heli.root.position, yaw = s.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let want = tmpV, look = tmpV2, fov = 55, near = 0.4;
    if (S.intro) {                                            // cut-scene: first person, the client's eyes
      introEye(eyeP, tmpV2); const P = heli.body.localToWorld(eyeP.clone()), L = heli.body.localToWorld(tmpV2.clone());
      if (!camInit) { camPos.copy(P); camLook.copy(L); camInit = true; }
      camPos.lerp(P, damp(8, dt)); camLook.lerp(L, damp(5, dt));
      camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(camLook);
      fadeEl.style.opacity = (S.fadeK || 0).toFixed(3);
      if (Math.abs(camera.fov - 60) > 0.01 || camera.near !== 0.08) { camera.fov = 60; camera.near = 0.08; camera.updateProjectionMatrix(); }
      return;
    }
    if (fadeEl.style.opacity !== '0') fadeEl.style.opacity = '0';
    if (S.cam === 'cockpit') {
      heli.eye.getWorldPosition(eyeP); heli.eye.getWorldQuaternion(eyeQ);
      camera.position.copy(eyeP); camera.quaternion.copy(eyeQ);
      camera.rotateY(Math.PI - 0.3 + S.look.yaw * 1.2); camera.rotateX(-0.15 + S.look.pitch * 0.9);    // eye looks along +z: camera's −z is its view
      camera.fov = 72; camera.near = 0.08; camera.updateProjectionMatrix();
      if (!drag.id && S.look.t && performance.now() - S.look.t > 2500) { S.look.yaw *= 1 - damp(1.2, dt); S.look.pitch *= 1 - damp(1.2, dt); }
      return;
    } else if (S.cam === 'orbit') {                           // cinematic: slow circle, landmark behind the helicopter when there is one
      const L = S.bannerL; S.orbA = (S.orbA || 0) + dt * 0.12; let a = S.orbA + S.look.yaw;
      if (L) a = Math.atan2(hp.x - L.x, hp.z - L.z) + 0.5 * Math.sin(S.orbA * 0.8) + S.look.yaw;
      const R = 30 * S.look.dist; want.set(hp.x + Math.sin(a) * R, hp.y + 7 + 6 * Math.sin(S.orbA * 0.5) + S.look.pitch * 20, hp.z + Math.cos(a) * R);
      look.set(hp.x, hp.y + 1.5, hp.z); if (L) look.lerp(new THREE.Vector3(L.x, hp.y * 0.4, L.z), 0.25);
      fov = 50;
    } else {                                                  // chase
      const sp = flight.speed, back = (16 + sp * 0.12) * S.look.dist, up = 4.6 * S.look.dist + 1.5;
      const a = yaw + Math.PI + S.look.yaw; want.set(hp.x + Math.sin(a) * back, hp.y + up + S.look.pitch * -10, hp.z + Math.cos(a) * back);
      look.set(hp.x + fx * (6 + sp * 0.25), hp.y + 1.8, hp.z + fz * (6 + sp * 0.25));
      fov = 55 + Math.min(10, sp * 0.12);
      if (!drag.id && S.look.t && performance.now() - S.look.t > 2500) { S.look.yaw *= 1 - damp(0.8, dt); S.look.pitch *= 1 - damp(0.8, dt); }
    }
    // keep the camera above ground / roofs
    const gh = world.heightAt(want.x, want.z, 1) + 1.2; if (want.y < gh) want.y = gh;
    if (!camInit) { camPos.copy(want); camLook.copy(look); camInit = true; }
    const k = S.cam === 'orbit' ? damp(1.6, dt) : damp(S.intro ? 2.2 : 4.5, dt);
    camPos.lerp(want, k); camLook.lerp(look, Math.min(1, k * 1.6));
    camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(camLook);
    if (Math.abs(camera.fov - fov) > 0.05 || camera.near !== near) { camera.fov += (fov - camera.fov) * damp(2, dt); camera.near = near; camera.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------- loop
  const inst = { spd: $('[data-v="spd"]'), alt: $('[data-v="alt"]'), hdg: $('[data-v="hdg"]') };
  let detail = 'full';
  // controls → flight input
  function readInput() {
    const I = flight.input;
    if (flight.s.mode === 'manual') {
      const kx = (a, b) => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);
      I.col = clamp(kx('KeyW', 'KeyS') - sticks.l.y, -1, 1); I.yaw = clamp(kx('KeyA', 'KeyD') * 1 - sticks.l.x, -1, 1);
      I.pitch = clamp(kx('ArrowUp', 'ArrowDown') - sticks.r.y, -1, 1); I.roll = clamp(kx('ArrowRight', 'ArrowLeft') + kx('KeyE', 'KeyQ') + sticks.r.x, -1, 1);
    } else { I.col = I.yaw = I.pitch = I.roll = 0; }
  }
  function frame(now) {
    if (closed) return;
    raf = requestAnimationFrame(frame);
    const dt = clamp((now - S.last) / 1000, 0, 0.1); S.last = now; const tA = performance.now();
    if (S.skip && S.intro) skipIntro();
    if (S.intro) intro(dt);
    readInput();
    if (!S.intro) flight.step(dt);
    const s = flight.s;
    heli.root.position.set(s.x, s.y, s.z); heli.root.rotation.y = s.yaw;
    heli.body.rotation.x = -s.pitch; heli.body.rotation.z = s.roll;
    heli.rpm = s.rpm; heli.update(dt);
    // cockpit controls follow the manual inputs (manual) or the autopilot's attitude / climb / turn (tour); the pilot's hands
    // and feet follow them (V27)
    { const man = s.mode === 'manual' && !S.intro, I = flight.input;
      const fwd = man ? I.pitch : clamp(-s.pitch * 2.6, -1, 1), lat = man ? I.roll : clamp(s.roll * 1.8, -1, 1);
      const col = s.onGround && !man ? -0.8 : (man ? I.col : clamp(0.1 + s.vy / 5, -1, 1)), ped = man ? -I.yaw : clamp(-s.yawRate / 0.5, -1, 1);
      if (heli.controls) heli.controls.set(fwd, lat, col, ped);
      if (!S.intro) { if (pilot.fly) pilot.fly(s.t, null, dt); else if (flight.s.phase !== 'parked') pilot.sit(s.t); } }
    // city detail: streets / shopfronts near the ground, building volumes only from the air
    const agl = s.y - world.terrainY(s.x, s.z);
    if (detail === 'far' && agl < 35) { detail = 'full'; city.setDetail('full'); } else if (detail === 'full' && agl > 70) { detail = 'far'; city.setDetail('far'); }
    placeCamera(dt);
    const vel = tmpV.set(s.vx, 0, s.vz);
    env.update(dt, camera); if (!classicHidden) city.update(dt, heli.root.position, vel);
    if (g3d) { if (ctl._g3dTick) ctl._g3dTick(); g3d.update(camera, dt); if (g3d.tiles && !S.g3dTuned) { g3d.tiles.errorTarget = phone ? 40 : 24; S.g3dTuned = true; } }
    dust.update(dt, s.x, s.y, s.z, s.rpm, agl, world.terrainY(s.x, s.z));
    if (audio) audio.update({ rpm: s.rpm, spool: s.spool, speed: flight.speed, cockpit: S.cam === 'cockpit' && !S.intro, dist: camera.position.distanceTo(heli.root.position), collective: s.collective });
    // HUD
    if ((S.panelT -= dt) <= 0) { S.panelT = 0.12;
      const hdg = ((s.yaw * 180 / Math.PI) % 360 + 360) % 360, kmh = flight.speed * 3.6;
      // heading in compass degrees: world +z bearing is not north; convert via the data frame
      const [la0, lo0] = D.worldToLL(s.x, s.z), [la1, lo1] = D.worldToLL(s.x + Math.sin(s.yaw), s.z + Math.cos(s.yaw)), brg = (Math.atan2((lo1 - lo0) * Math.cos(la0 * Math.PI / 180), la1 - la0) * 180 / Math.PI + 360) % 360;
      inst.spd.textContent = Math.round(kmh) + ' ' + t('kmh'); inst.alt.textContent = Math.round(agl) + ' ' + t('m'); inst.hdg.textContent = String(Math.round(brg)).padStart(3, '0') + '°';
      if (S.cam === 'cockpit' || S.intro) heli.drawPanel({ pitch: s.pitch, roll: s.roll, kmh, alt: agl, hdg: brg, vs: s.vy, rpm: s.rpm, mode: s.mode });
      S.hdgN = brg; void hdg;
      { const L = s.phase === 'orbit' && s.orbit ? s.orbit.L : null;            // the banner follows the flight state
        if (L !== S.bannerL) { S.bannerL = L; if (L) { banner.querySelector('.n').textContent = L.nameT; banner.querySelector('.s').textContent = `${s.leg + 1} ${t('of')} ${LANDMARKS.length}`; } banner.classList.toggle('on', !!L); }
        if (L) banner.querySelector('.bar i').style.width = (clamp(s.orbit.t / L.hold, 0, 1) * 100).toFixed(0) + '%'; }
      if (S.phaseHide && performance.now() > S.phaseHide) { phaseEl.classList.remove('on'); S.phaseHide = 0; }
      if (S.flashT > 0) { S.flashT -= 0.12; if (S.flashT <= 0) flashEl.classList.remove('on'); }
      if (btn('land').hidden !== (['parked', 'spinup', 'landed', 'land', 'goland', 'return'].includes(s.phase) && s.mode === 'tour')) updateModeUI();
      if (btn('skip').hidden === S.intro) updateModeUI();
    }
    if (S.noRender) return;                                     // tests: simulation only
    const tB = performance.now(); renderer.render(scene, camera); const tC = performance.now();
    S.tUpd = S.tUpd == null ? tB - tA : S.tUpd * 0.8 + (tB - tA) * 0.2; S.tRen = S.tRen == null ? tC - tB : S.tRen * 0.8 + (tC - tB) * 0.2;
    dyn.frame(now);
    // fps meter (exposed for the tests)
    S.frames++; S.fps.n++; if (now - S.fps.t0 > 1000) { S.fps.v = S.fps.n * 1000 / (now - S.fps.t0); S.fps.hist.push(+S.fps.v.toFixed(1)); if (S.fps.hist.length > 120) S.fps.hist.shift(); S.fps.n = 0; S.fps.t0 = now; }
  }
  raf = requestAnimationFrame(frame);

  function close() {
    if (closed) return; closed = true; ACTIVE = null;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); if (ctl._size) removeEventListener('resize', ctl._size); document.removeEventListener('visibilitychange', onVis);
    try { audio && audio.dispose(); } catch (e) { /* closed */ }
    try { dust && dust.dispose(); } catch (e) { /* gone */ }
    try { g3d && g3d.dispose(); } catch (e) { /* gone */ }
    for (const o of [pilot, heli, lmk, world, city, env]) { try { o && o.dispose && o.dispose(); } catch (e) { console.warn('[heli] dispose', e); } }
    try { if (complex) { scene.remove(complex.group); complex.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } } catch (e) { /* gone */ }
    try { renderer && renderer.dispose(); renderer && renderer.forceContextLoss && renderer.forceContextLoss(); } catch (e) { /* gone */ }
    try { ctl._ro && ctl._ro.disconnect(); } catch (e) { /* gone */ }
    root.remove(); document.documentElement.style.overflow = prevOverflow;
    delete window.__heli;
    try { opts.onClose && opts.onClose(); } catch (e) { /* host */ }
  }
  // test / tooling hooks
  window.__heli = {
    get state() { const s = flight.s; return { phase: s.phase, mode: s.mode, leg: s.leg, visited: s.visited.slice(), holds: s.holdLog.slice(), x: s.x, y: s.y, z: s.z, speed: flight.speed, rpm: s.rpm, bounces: s.bounces, intro: S.intro, cam: S.cam, light: S.mode, landed: s.landedAt, banner: S.bannerL ? S.bannerL.id : null, g3d: g3d ? g3d.stats() : null, tUpd: S.tUpd, tRen: S.tRen, fps: S.fps.v, fpsHist: S.fps.hist.slice(), frames: S.frames, pr: renderer.getPixelRatio() }; },
    flight, world, city, heli, pilot, camera, renderer, scene, THREE, lms: flight && LANDMARKS, S,
    /** tests / pictures: put the helicopter somewhere, hovering under manual control */
    place(x, y, z, yaw = 0) { if (S.intro) skipIntro(); phaseEl.classList.remove('on'); S.phaseHide = 0; const f = flight.s; f.rpm = f.spool = 1; flight.setMode('manual'); f.phase = 'free'; f.x = x; f.y = y; f.z = z; f.yaw = yaw; f.vx = f.vy = f.vz = 0; updateModeUI(); },
    shotCam(a) { S.camOverride = a; },
    noRender(v) { S.noRender = !!v; },
    snapCam() { camInit = false; },
    introAt(t) { if (!S.intro) return false; S.introT = t; intro(0); camInit = false; return Object.assign({}, TL); },
    skipIntro, setCam(c) { S.cam = c; setCamBtn(); }, setLight(m) { applyMode(m); setLightBtn(); },
    /** run the simulation faster (tests): n steps of dt without rendering */
    /** tests: n seconds of flight with the live controls (keys held / sticks pushed), no rendering */
    tick(sec, dt = 1 / 30) { if (S.intro) skipIntro(); for (let i = 0; i < sec / dt; i++) { readInput(); flight.step(dt); } camInit = false; },
    fastForward(sec, dt = 1 / 30) { if (S.intro) skipIntro(); for (let i = 0; i < sec / dt; i++) flight.step(dt); camInit = false; },
    info() { const i = renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geo: i.memory.geometries, tex: i.memory.textures, programs: i.programs ? i.programs.length : 0, city: city.stats() }; },
    close,
  };
  return ctl;
}

/** The generic belt of environment.js (neighbourhood carpet, generic houses, far skyline, flat ground …) is hidden where the
 *  real city stands — same rule as environment.js hideBeltForCity (which only runs on env.city.enable()). */
function hideBelt(group, S) {
  const HIDE = new Set(['carpet', 'road-strips', 'houses', 'blocks', 'far-houses', 'skyline', 'ground', 'hills']);
  const m = 6, M4 = new THREE.Matrix4(), P = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const out = (x, z) => x < S.x0 - m || x > S.x1 + m || z < S.z0 - m || z > S.z1 + m;
  group.updateMatrixWorld(true);
  const visit = (o) => {
    if (HIDE.has(o.name)) { o.visible = false; return; }
    if (o.name === 'traffic') { o.visible = false; return; }
    if (o.isInstancedMesh) { let hid = 0; for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M4); P.setFromMatrixPosition(M4).applyMatrix4(o.matrixWorld); if (out(P.x, P.z)) { o.setMatrixAt(i, ZERO); hid++; } } if (hid) { o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere && o.computeBoundingSphere(); } return; }
    if (o.isMesh && o.geometry && !['sky', 'site-plan', 'night-lights', 'street-signs', 'site-furniture'].includes(o.name)) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; if (b && (b.max.x < S.x0 - m || b.min.x > S.x1 + m || b.max.z < S.z0 - m || b.min.z > S.z1 + m)) o.visible = false; }
    for (const c of o.children) visit(c);
  };
  for (const c of group.children) visit(c);
}
