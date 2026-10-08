// Live 3D complex for the hero and the finder "live view". One renderer/scene is shared: the canvas moves into
// whichever host (hero or finder) is on screen, so a phone only ever holds one WebGL context for this.
// If three.js or the exterior / environment modules are missing or throw, it reports 'failed' and the page keeps its
// static imagery (hero slides + the SVG elevation in the finder).
// Nothing here knows how many buildings there are or how tall they are: orbit, finder angles, fits and floor picking all
// come from data.js (footprints, buildingCenter, roofY, topFloor) and from the exterior API (CONTRACT §4.1).
//
// V4 — stills first. The hero slide shows a path-traced picture of the complex (assets/hero3d/<view>-<mode>.webp, made by
// pano-work/hero/) and this engine starts from exactly the camera that picture was rendered with
// (assets/hero3d/views.json: position, target, lens, and the `object-fit: cover` crop of the picture in this container is
// reproduced with a view offset). The canvas stays transparent over the still (class `has-stills` on the host, set by
// hero-slides.js once a still is on screen) and takes over — class `is-3d`, a cross-fade from the same view — only when
// the visitor drags or taps; some seconds after they let go the camera glides home and the still fades back in.
// Without views.json / stills the old behaviour remains (slow orbit, always live).
const VIEWS_URL = 'assets/hero3d/views.json';
const EXPOSURE = { day: 1.0, dusk: 1.6, night: 1.85 };   // per light mode (the night model was too dark next to the stills)
const RETURN_AFTER = 5.5;                                   // seconds without input before the camera goes home
import { PROJECT, BUILDINGS, B_IDS, DEFAULT_SEL, SITE_CENTER, floorY, roofY, floorsOf, topFloor, floorFromY, buildingCenter, localToWorld, worldToLocal, footprintOf } from './data.js';

const TAU = Math.PI * 2;

function v3(THREE, a) {
  if (!a) return null;
  if (a.isVector3) return a.clone();
  if (Array.isArray(a)) return new THREE.Vector3(a[0], a[1], a[2]);
  if (typeof a.x === 'number') return new THREE.Vector3(a.x, a.y, a.z);
  return null;
}

// World bbox of one tower's typical footprint (through localToWorld, so a rotated tower is still right)
function towerBox(id) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of footprintOf(id)) {
    const [wx, wz] = localToWorld(id, x, z); x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
  }
  return { x0, x1, z0, z1, y0: floorY(id, 1), y1: roofY(id) };
}
// Axis-aligned world box of the whole complex from data
function complexBox(boxes) {
  const all = Object.values(boxes);
  return { x0: Math.min(...all.map(b => b.x0)), x1: Math.max(...all.map(b => b.x1)), z0: Math.min(...all.map(b => b.z0)), z1: Math.max(...all.map(b => b.z1)),
    top: Math.max(...B_IDS.map(roofY)) + 3 };
}
const clampFloor = (b, f) => Math.max(1, Math.min(topFloor(b), Math.round(+f) || 1));
// Local point inside (or within `pad` metres of) a polygon
function nearPoly(poly, x, z, pad) {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    best = Math.min(best, Math.hypot(x - ax - dx * k, z - az - dz * k));
  }
  return inside || best <= pad;
}

export function createHero3D({ heroHost, finderHost, onFloor = () => {}, onState = () => {}, reducedMotion = false } = {}) {
  let THREE, env, complex, renderer, scene, camera, raf = 0, last = 0, failed = false, ready = false;
  let exteriorMod = null;
  const okB = b => Object.prototype.hasOwnProperty.call(BUILDINGS, b);
  const sel0 = okB(DEFAULT_SEL?.b) ? { b: DEFAULT_SEL.b, f: clampFloor(DEFAULT_SEL.b, DEFAULT_SEL.f) } : { b: B_IDS[0], f: 1 };
  const state = { mode: 'dusk', host: null, where: 'hero', visible: new Map(), paused: false, hoverFloor: null, sel: sel0, lit: null };
  const boxes = Object.fromEntries(B_IDS.map(id => [id, towerBox(id)]));
  const box = complexBox(boxes);
  const center = { x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2 };
  const radius = Math.max(...Object.values(boxes).map(b => Math.max(...[[b.x0, b.z0], [b.x0, b.z1], [b.x1, b.z0], [b.x1, b.z1]].map(([x, z]) => Math.hypot(x - center.x, z - center.z)))));
  // Hero orbit start: the camera stands on the side of the lowest tower, so the taller ones rise behind it
  const lowest = B_IDS.reduce((a, b) => (roofY(b) < roofY(a) ? b : a), B_IDS[0]);
  const lc = buildingCenter(lowest);
  const orbit = { az: Math.atan2(lc[1] - center.z, lc[0] - center.x), dist: 150, h: 80, target: null, drag: null, idleT: 0, speed: TAU / 260, own: false };
  // Finder view: a stable framing of the whole selected building (every floor in view). Choosing a floor only moves the
  // gold band — the camera never jumps; switching building orbits smoothly around the complex to the other tower.
  // Each tower is seen from its OUTER side (the direction from the courtyard centre through the tower), so no other
  // tower of the complex stands between the camera and it.
  const FINDER_AZ = Object.fromEntries(B_IDS.map(b => {
    const c = buildingCenter(b), dx = c[0] - SITE_CENTER[0], dz = c[1] - SITE_CENTER[1];
    return [b, Math.hypot(dx, dz) > 0.5 ? Math.atan2(dz, dx) : orbit.az];
  }));
  const finderCam = { cur: null };
  const fitCache = new Map();
  let camGoalPos = null, camGoalTgt = null, curTgt = null;
  // stills-first state (see the header): the views of the stills, the one in use, live / still, hidden warm-up frames
  let VIEWS = null, home = null, live = false, warmT = 0, fadeT = 0, heroFov = 34, finderFov = 34;
  const viewsP = fetch(VIEWS_URL).then(r => (r.ok ? r.json() : null)).then(j => { VIEWS = j && j.views && j.views.land ? j : null; return VIEWS; }).catch(() => null);
  const hasStills = () => !!(VIEWS && heroHost && heroHost.classList.contains('has-stills'));
  const viewFor = aspect => { const v = VIEWS.views; return v.port && aspect < (VIEWS.portraitBelow || 0.95) ? v.port : v.land; };
  function setLive(on, why) {
    if (live === on) return;
    live = on; orbit.idleT = 0;
    if (heroHost) heroHost.classList.toggle('is-3d', on);
    if (!on) fadeT = 0.9;                                    // keep drawing while the canvas fades out
    try { document.dispatchEvent(new CustomEvent('vrc:hero3d-live', { detail: { live: on, why: why || '' } })); } catch (e) { /* ignore */ }
    kick();
  }

  // The hero 3D is one slide of the hero slideshow (js/hero-slides.js). It only counts as "on screen" while that slide
  // is active, and the whole engine is only built once it is needed: that slide is reached, or the finder comes near.
  let heroActive = false, needResolve = null;
  const needed = new Promise(r => { needResolve = r; });
  const onHeroEvt = e => {
    heroActive = !!e.detail?.active;
    if (heroActive) needResolve();
    if (ready) { if (!heroActive) state.visible.set(heroHost, 0); else ioSync(); pickHost(); }
  };
  document.addEventListener('vrc:hero3d', onHeroEvt);
  // created after the slideshow already reached the 3D slide (slow start): the event was missed — read the slide itself
  if (heroHost && heroHost.classList.contains('hs-slide') && heroHost.classList.contains('is-on')) { heroActive = true; needResolve(); }
  const onStillsEvt = () => { warmT = Math.max(warmT, 0.3); kick(); };       // a still appeared / failed: re-check who is on screen
  document.addEventListener('vrc:hero3d-stills', onStillsEvt);
  const nearIo = finderHost ? new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { needResolve(); nearIo.disconnect(); } }, { rootMargin: '900px 0px' }) : null;
  nearIo?.observe(finderHost);
  function ioSync() {
    if (!heroHost) return;
    const r = heroHost.getBoundingClientRect();
    const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    state.visible.set(heroHost, r.height ? vis / r.height : 0);
  }
  const announce = st => { window.__vrcHero3D = st; document.dispatchEvent(new CustomEvent('vrc:hero3d-state', { detail: st })); };
  announce('created');

  function fail(e) {
    console.warn('[hero3d] 3D unavailable, using static imagery:', e?.message || e);
    cancelAnimationFrame(raf); raf = 0;
    failed = true; ready = false;
    try { state.host?.classList.remove('is-live'); } catch (err) { /* ignore */ }
    try { onState('failed'); } catch (err) { /* the page must survive its own handler */ }
    announce('failed'); disposeGL();
    return false;
  }

  async function init() {
    if (failed) return false;
    if (ready) return true;
    if (PROJECT?.features && !PROJECT.features.hero3d) return fail('switched off (PROJECT.features.hero3d)');
    await needed;
    try {
      // T32: probe first — three.js logs console.error when it cannot create a context
      if (!window.WebGLRenderingContext || !(() => { try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch (e) { return false; } })()) throw new Error('no webgl');
      THREE = await import('three');
      const [envMod, extMod] = await Promise.all([import('./three/environment.js'), import('./three/exterior.js'), viewsP]);
      if (typeof extMod.createComplex !== 'function' || typeof envMod.createEnvironment !== 'function') throw new Error('exterior / environment API missing');
      exteriorMod = extMod;
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
      if (!renderer.getContext()) throw new Error('webgl context');
      const coarse = matchMedia('(pointer: coarse)').matches;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = EXPOSURE[state.mode] || 1.0;
      renderer.shadowMap.enabled = !coarse;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.className = 'hero3d-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(34, 16 / 9, 1, 12000);
      env = envMod.createEnvironment(scene, renderer, { mode: state.mode });
      if (env?.group && !env.group.parent) scene.add(env.group);
      complex = extMod.createComplex({});
      if (!complex?.group?.isObject3D) throw new Error('createComplex returned no group');
      scene.add(complex.group);

      // Starting orbit from the exterior module's preferred view when it provides one. A view that does not look at this
      // complex (a target far outside it — e.g. a value left over from another project) is ignored.
      const dv = extMod.DEFAULT_VIEW;
      let tgt = v3(THREE, dv?.target);
      const pos = v3(THREE, dv?.position || dv?.camera || dv?.pos);
      const sane = tgt && pos && [tgt.x, tgt.y, tgt.z, pos.x, pos.y, pos.z].every(Number.isFinite)
        && Math.hypot(tgt.x - center.x, tgt.z - center.z) < radius * 0.6 && Math.hypot(pos.x - tgt.x, pos.z - tgt.z) > radius * 0.5 && pos.y > tgt.y;
      if (sane) {
        const dx = pos.x - tgt.x, dz = pos.z - tgt.z;
        orbit.az = Math.atan2(dz, dx); orbit.dist = Math.hypot(dx, dz); orbit.h = pos.y - tgt.y; orbit.own = true;
        if (dv.fov > 10 && dv.fov < 90) camera.fov = dv.fov;
      } else {
        tgt = new THREE.Vector3(center.x, box.top * 0.3, center.z);
      }
      orbit.target = tgt;
      curTgt = tgt.clone();
      heroFov = finderFov = camera.fov;
      renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
      renderer.domElement.addEventListener('webglcontextrestored', () => kick());
      homeTgt = new THREE.Vector3(); orbit.daz = 0;
      placeHeroCamera(0, true);
      bindPointer(renderer.domElement);
      ready = true;
      if (/[?&]debug3d\b/.test(location.search)) window.__vrcHeroDbg = { THREE, scene, camera, complex, renderer, pick: (x, y, t) => pick(x, y, t), FINDER_AZ, fitCache, finderCam, orbit, state,
        get live() { return live; }, get home() { return home; }, setLive, renderHome: () => { if (state.where === 'hero') { orbit.daz = 0; placeHeroCamera(0, true); } renderOnce(); } };
      if (heroActive) ioSync();
      pickHost();
      renderOnce();
    } catch (e) {
      return fail(e);
    }
    try { onState('ready'); } catch (e) { console.warn('[hero3d] onState handler:', e?.message || e); }
    announce('ready');
    // the visitor already pulled at the still while the model was loading: hand over now
    try { if (home && state.where === 'hero' && Date.now() - (+heroHost.dataset.want || 0) < 4000) setLive(true, 'wanted'); } catch (e) { /* ignore */ }
    return true;
  }

  // ---------- camera ----------
  // Scale of the orbit (distance and height together) at which every tower, ground to roof, stays inside the frame at
  // every azimuth of the slow turn, for this aspect and this vertical view offset. Replaces per-project magic factors.
  function heroFit(aspect, offY) {
    const key = 'hero:' + aspect.toFixed(3) + ':' + offY.toFixed(3) + ':' + camera.fov;
    if (fitCache.has(key)) return fitCache.get(key);
    const pts = [];
    for (const b of Object.values(boxes)) for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [b.y0, b.y1 + 3]) pts.push(new THREE.Vector3(x, y, z));
    const cam = new THREE.PerspectiveCamera(camera.fov, aspect, 1, 5000), tgt = orbit.target, p = new THREE.Vector3();
    const fits = s => {
      for (let i = 0; i < 16; i++) {
        const az = i * TAU / 16;
        cam.position.set(tgt.x + Math.cos(az) * orbit.dist * s, tgt.y + orbit.h * s, tgt.z + Math.sin(az) * orbit.dist * s); cam.lookAt(tgt); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        for (const c of pts) { p.copy(c).project(cam); const y = p.y + offY; if (Math.abs(p.x) > 0.9 || y > 0.8 || y < -0.86 || p.z > 1) return false; }
      }
      return true;
    };
    let s = orbit.own ? 1 : 0.5; while (s < 6 && !fits(s)) s *= 1.03;
    fitCache.set(key, s); return s;
  }
  function placeHeroCamera(dt, snap) {
    if (home) {
      // orbit round the still's own target; `daz` = how far the visitor has turned it. Away from home the orbit widens
      // a little (views.json orbitScale) so no tower leaves the frame at any azimuth.
      const v = home, t = v.target, p = v.position;
      const dx = p[0] - t[0], dz = p[2] - t[2], az0 = Math.atan2(dz, dx), d0 = Math.hypot(dx, dz), h0 = p[1] - t[1];
      const far = Math.min(1, Math.abs(orbit.daz) / 0.6), s = 1 + ((v.orbitScale || 1) - 1) * far * far * (3 - 2 * far);
      const az = az0 + orbit.daz;
      const pos = new THREE.Vector3(t[0] + Math.cos(az) * d0 * s, t[1] + h0 * s, t[2] + Math.sin(az) * d0 * s);
      camGoalPos = pos; camGoalTgt = homeTgt.set(t[0], t[1], t[2]);
      if (snap) { camera.position.copy(pos); curTgt.copy(camGoalTgt); camera.lookAt(curTgt); }
      return;
    }
    const aspect = camera.aspect || 1.6;
    const fit = heroFit(aspect, viewOffY);
    const d = orbit.dist * fit, h = orbit.h * fit;
    const tgt = orbit.target;
    const pos = new THREE.Vector3(tgt.x + Math.cos(orbit.az) * d, tgt.y + h, tgt.z + Math.sin(orbit.az) * d);
    camGoalPos = pos; camGoalTgt = tgt;
    if (snap) { camera.position.copy(pos); curTgt.copy(tgt); camera.lookAt(curTgt); }
  }
  let homeTgt = null;
  function bandBox(b, f) { try { const bb = exteriorMod?.floorBandBox?.(b, f); return bb && v3(THREE, bb.min) && v3(THREE, bb.max) ? bb : null; } catch (e) { return null; } }
  // A low tower is not shown in extreme close-up: its distance is at least 75 % of the tallest tower's, so the podium
  // and the neighbours it stands between stay in the picture and a building switch does not feel like a zoom jump.
  function finderFit(b, aspect) {
    const key = 'f:' + b + ':' + aspect.toFixed(3) + ':' + camera.fov;
    if (fitCache.has(key)) return fitCache.get(key);
    const raw = towerFit(b, aspect), dMin = 0.75 * Math.max(...B_IDS.map(id => towerFit(id, aspect).d));
    const d = Math.max(raw.d, dMin), out = { tgt: raw.tgt, d, h: d * 0.36 };
    fitCache.set(key, out); return out;
  }
  // Distance at which the selected building's box (ground → roof) fits the view at this aspect, with a margin
  function towerFit(b, aspect) {
    const key = b + ':' + aspect.toFixed(3) + ':' + camera.fov;
    if (fitCache.has(key)) return fitCache.get(key);
    // whole tower = union of the bottom and the top floor bands (plates differ between floors); data bbox as the fallback
    const tb = boxes[b], box0 = bandBox(b, 1), boxT = bandBox(b, topFloor(b));
    const mn = new THREE.Vector3(tb.x0, tb.y0, tb.z0), mx = new THREE.Vector3(tb.x1, tb.y1, tb.z1);
    if (box0 && boxT) { mn.copy(v3(THREE, box0.min)).min(v3(THREE, boxT.min)); mx.copy(v3(THREE, box0.max)).max(v3(THREE, boxT.max)); }
    const tgt = mn.clone().add(mx).multiplyScalar(0.5); tgt.y = mn.y + (mx.y - mn.y) * 0.46;
    const corners = [];
    for (const x of [mn.x, mx.x]) for (const y of [mn.y, mx.y]) for (const z of [mn.z, mx.z]) corners.push(new THREE.Vector3(x, y, z));
    const cam = new THREE.PerspectiveCamera(camera.fov, aspect, 1, 5000);
    const fits = d => {
      {
        const az = FINDER_AZ[b];
        cam.position.set(tgt.x + Math.cos(az) * d, tgt.y + d * 0.36, tgt.z + Math.sin(az) * d); cam.lookAt(tgt); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        for (const c of corners) { const p = c.clone().project(cam); if (Math.abs(p.x) > 0.94 || Math.abs(p.y) > 0.86 || p.z > 1) return false; }
      }
      return true;
    };
    let d = 30; while (d < 900 && !fits(d)) d *= 1.04;
    const out = { tgt, d, h: d * 0.36 };
    fitCache.set(key, out); return out;
  }
  function placeFinderCamera(dt, snap) {
    const { b } = state.sel;
    const aspect = camera.aspect || 1.3;
    const fit = finderFit(b, aspect);
    const goal = { az: FINDER_AZ[b], tgt: fit.tgt, d: fit.d, h: fit.h };
    const c = finderCam.cur;
    if (snap || !c) finderCam.cur = { az: goal.az, tgt: goal.tgt.clone(), d: goal.d, h: goal.h };
    else {
      // orbit (angle, distance, target) instead of a straight-line fly, so a building switch glides around the blocks
      const k = 1 - Math.pow(0.02, dt);
      let da = goal.az - c.az; da = Math.atan2(Math.sin(da), Math.cos(da));
      c.az += da * k; c.d += (goal.d - c.d) * k; c.h += (goal.h - c.h) * k; c.tgt.lerp(goal.tgt, k);
    }
    const cur = finderCam.cur;
    const az = cur.az;   // no idle swing: a still image is easier to tap and never "moves under the finger"
    const pos = new THREE.Vector3(cur.tgt.x + Math.cos(az) * cur.d, cur.tgt.y + cur.h, cur.tgt.z + Math.sin(az) * cur.d);
    camGoalPos = pos; camGoalTgt = cur.tgt;
    if (snap) { camera.position.copy(pos); curTgt.copy(cur.tgt); camera.lookAt(curTgt); }
  }

  // ---------- loop ----------
  function frame(now) {
    raf = 0;
    if (!ready || state.paused || !state.host || document.hidden) return;
    const rdt = last ? Math.min(1.5, (now - last) / 1000) : 0.016;      // real time (slow devices): the hidden warm-up and the fade are wall-clock
    const dt = Math.min(0.05, rdt); last = now;
    let still = false;
    if (state.where === 'hero') {
      if (home) {
        // stills first: no idle orbit. After RETURN_AFTER s without input the camera glides home; there the still returns.
        const stills = hasStills();
        if (stills !== lastStills) { lastStills = stills; if (!stills) setLive(true, 'no-stills'); else if (!orbit.drag && Math.abs(orbit.daz) < 1e-3) setLive(false, 'stills'); }
        if (!orbit.drag) {
          orbit.idleT += rdt;
          if (live && stills && orbit.idleT > RETURN_AFTER) {
            orbit.daz *= Math.pow(0.03, Math.min(0.5, rdt));
            if (Math.abs(orbit.daz) < 0.0015) { orbit.daz = 0; if (camera.position.distanceTo(camGoalPos) < 0.12) { camera.position.copy(camGoalPos); setLive(false, 'home'); } }
          }
        }
        placeHeroCamera(dt);
        if (!live) { camera.position.copy(camGoalPos); curTgt.copy(camGoalTgt); }
        still = !live && stills;
      } else {
        if (!orbit.drag) { orbit.idleT += dt; if (!reducedMotion && orbit.idleT > 2.5) orbit.az += orbit.speed * dt; }
        placeHeroCamera(dt);
      }
    } else {
      placeFinderCamera(dt);
    }
    const k = state.where === 'hero' ? 1 - Math.pow(0.001, (home ? Math.min(0.5, rdt) : dt) * 1.4) : 1;   // finder: placeFinderCamera already eases; hero on a slow device: real time, so the return home takes seconds, not frames
    camera.position.lerp(camGoalPos, k); curTgt.lerp(camGoalTgt, k); camera.lookAt(curTgt);
    if (still) {                                   // the still is on screen: draw only while warming up / fading, then sleep
      warmT = Math.max(0, warmT - rdt); fadeT = Math.max(0, fadeT - rdt);
      if (warmT <= 0 && fadeT <= 0) { try { env?.update?.(dt, camera); renderer.render(scene, camera); } catch (e) { /* ignore */ } return; }
    }
    try { env?.update?.(dt, camera); } catch (e) { /* keep rendering */ }
    try { renderer.render(scene, camera); renderErr = 0; } catch (e) { if (++renderErr >= 3) { fail(e); return; } }
    raf = requestAnimationFrame(frame);
  }
  let renderErr = 0, lastStills = null;
  function kick() { if (!raf && ready && !state.paused && state.host) { last = 0; raf = requestAnimationFrame(frame); } }
  function renderOnce() { if (!ready || !state.host) return; resize(true); try { env?.update?.(0.016, camera); } catch (e) {} renderer.render(scene, camera); state.host.classList.add('is-live'); }

  // ---------- host management (which container owns the canvas) ----------
  const io = new IntersectionObserver(entries => {
    for (const e of entries) state.visible.set(e.target, e.isIntersecting && (e.target !== heroHost || heroActive) ? e.intersectionRatio : 0);
    pickHost();
  }, { threshold: [0, 0.05, 0.25, 0.5, 0.75, 1] });
  if (heroHost) io.observe(heroHost);
  if (finderHost) io.observe(finderHost);
  const ro = new ResizeObserver(() => resize());
  let lastSize = [0, 0];

  function pickHost() {
    if (!ready) return;
    const hv = state.visible.get(heroHost) || 0, fv = state.visible.get(finderHost) || 0;
    let host = null, where = null;
    if (fv > 0 && (fv >= hv || hv < 0.05)) { host = finderHost; where = 'finder'; } else if (hv > 0) { host = heroHost; where = 'hero'; }
    if (!host) { state.host = null; cancelAnimationFrame(raf); raf = 0; return; }
    if (host !== state.host) {
      if (state.host) { ro.unobserve(state.host); state.host.classList.remove('is-live'); }
      state.host = host; state.where = where; offKey = '';
      (host.querySelector('.hero3d-slot') || host).appendChild(renderer.domElement);
      ro.observe(host);
      resize(true);
      state.hoverFloor = null;
      try { complex.hoverFloor?.(null, null); } catch (e) { /* optional */ }
      if (where === 'hero') { highlight(state.sel.b, null); orbit.daz = 0; lastStills = null; if (home) { live = false; heroHost.classList.remove('is-3d'); warmT = 1.2; } placeHeroCamera(0, true); }
      else { highlight(state.sel.b, state.sel.f); placeFinderCamera(0, true); }
      requestAnimationFrame(() => host.classList.add('is-live'));
    }
    kick();
  }
  function resize(force = false) {
    if (!ready || !state.host) return;
    const r = state.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    // iOS shows/hides its address bar while scrolling: a height-only change under 120 px is ignored (the canvas is
    // CSS-stretched for that moment) instead of reallocating the drawing buffer and re-framing the camera.
    if (!force && w === lastSize[0] && h !== lastSize[1] && Math.abs(h - lastSize[1]) < 120) return;
    lastSize = [w, h];
    const c = renderer.domElement;
    if (c.width !== Math.round(w * renderer.getPixelRatio()) || c.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
    }
    applyOffset(w, h);
    if (state.where === 'hero' && home) { placeHeroCamera(0, !live); warmT = Math.max(warmT, 0.3); kick(); }
  }
  // In the hero the headline sits on the reading-start side, so the complex is framed toward the other side
  // (and lower on portrait phones). Off-centre framing via a view offset keeps the orbit maths centred.
  let offKey = '', viewOffY = 0;   // viewOffY: the same shift in NDC units (+ = the picture moves up)
  function applyOffset(w, h) {
    const rtl = document.documentElement.dir === 'rtl';
    let ox = 0, oy = 0;
    if (state.where === 'hero' && VIEWS) {
      // The still fills the slide with `object-fit: cover` at `object-position: pos` — the camera shows the same window
      // of the same picture: the still's full frame is the camera's full frame, the slide is a view offset into it.
      const v = viewFor(w / h), as = v.aspect, pos = v.pos || [0.5, 0.5];
      const fw = Math.max(w, h * as), fh = fw / as, x = (fw - w) * pos[0], y = (fh - h) * pos[1];
      const key = ['still', w, h, as, v.fov, pos[0], pos[1]].join();
      if (home !== v) { home = v; if (ready) placeHeroCamera(0, true); }
      if (key === offKey) return; offKey = key; viewOffY = 0;
      camera.fov = v.fov; camera.aspect = as;
      camera.setViewOffset(fw, fh, x, y, w, h); camera.updateProjectionMatrix();
      return;
    }
    home = state.where === 'hero' ? home : null;
    if (camera.fov !== (state.where === 'hero' ? heroFov : finderFov)) { camera.fov = state.where === 'hero' ? heroFov : finderFov; offKey = ''; }
    camera.aspect = w / h;
    if (state.where === 'hero') {
      // v1.6: the hero text sits below the image, so the complex is centred, nudged up clear of the slide controls
      oy = w / h > 1.15 ? h * 0.09 : h * 0.13; void rtl;   // T32: 0.05 left the podium under the slide caption on landscape screens (≈ 1000–1440 px)
    }
    const key = [w, h, ox, oy, camera.fov].join();
    if (key === offKey) return; offKey = key;
    viewOffY = 2 * oy / h;
    if (ox || oy) camera.setViewOffset(w, h, ox, oy, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  // ---------- picking ----------
  // A tap/click raycasts against the real facade meshes of every tower and turns the hit height into that tower's floor
  // (so what you touch is what you get, at any angle, on every facade). The podium is not a floor target, but it hides
  // what stands behind it: a hit on it counts only where it is the wall of a tower's own embedded floors. The invisible
  // per-floor pick volumes of the exterior module are the fallback, and touch also probes a few points around the finger.
  let ray, ndc, facadeList = null, bandList = null, nPodium = 0;
  const TOUCH_PROBE = [[0, 0], [0, -7], [0, 7], [-7, 0], [7, 0], [0, -14], [0, 14], [-14, 0], [14, 0]];
  const act = (b, f) => ({ type: 'floor', building: b, floor: f });
  const validAct = a => !!a && a.type === 'floor' && okB(a.building) && Number.isInteger(a.floor) && a.floor >= 1 && a.floor <= topFloor(a.building);
  function buildingOf(o) { for (let p = o; p; p = p.parent) { const m = /^bldg-(\w+)$/.exec(p.name || ''); if (m) return okB(m[1]) ? m[1] : null; } return null; }
  function towerAt(pt) {   // podium hit → the tower whose plate on that level contains the point (1.2 m tolerance)
    for (const b of B_IDS) {
      const f = clampFloor(b, floorFromY(b, pt.y));
      if (pt.y > roofY(b)) continue;
      const [lx, lz] = worldToLocal(b, pt.x, pt.z);
      if (nearPoly(footprintOf(b, f) || footprintOf(b), lx, lz, 1.2)) return act(b, f);
    }
    return null;
  }
  function pickAt(clientX, clientY) {
    ray = ray || new THREE.Raycaster(); ndc = ndc || new THREE.Vector2();
    const r = renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(facadeList, false)[0];
    if (hit) {
      const b = buildingOf(hit.object);
      if (b) return act(b, clampFloor(b, floorFromY(b, hit.point.y)));
      return towerAt(hit.point);                                   // podium: never look through it
    }
    const a = ray.intersectObjects(bandList, false)[0]?.object?.userData?.action;
    return validAct(a) ? act(a.building, a.floor) : null;
  }
  function pick(clientX, clientY, touch = false) {
    if (!complex) return null;
    if (!facadeList) {
      facadeList = [];
      const add = o => { if (o.isMesh && !(o.name || '').startsWith('pick-') && o.visible && !/-(frame|hedge|led)$/.test(o.name || '')) facadeList.push(o); };   // thin mullions are skipped: the glass behind them is hit instead (5× cheaper)
      for (const g of Object.values(complex.buildings || {})) g?.traverse?.(add);
      nPodium = facadeList.length; complex.podium?.traverse?.(add); nPodium = facadeList.length - nPodium;
      // only real floors of the tower they belong to (no parking band, nothing above the top floor)
      bandList = (complex.pickables || []).filter(m => validAct(m?.userData?.action));
      if (!facadeList.length && !bandList.length) return null;
    }
    for (const [dx, dy] of (touch ? TOUCH_PROBE : [[0, 0]])) { const a = pickAt(clientX + dx, clientY + dy); if (a) return a; }
    return null;
  }
  // One gold band at a time: the band of a tower that is no longer selected is cleared explicitly (§4.1 does not say
  // whether highlightFloor(b, f) clears the other towers).
  function highlight(b, f) {
    try {
      if (state.lit && state.lit !== b) complex.highlightFloor?.(state.lit, null);
      complex.highlightFloor?.(b, f);
      state.lit = f == null ? null : b;
    } catch (e) { /* optional */ }
    kick();
  }
  function preview(a) {
    const key = a ? a.building + ':' + a.floor : null;
    if (key === state.hoverFloor) return;
    state.hoverFloor = key;
    const same = a && a.building === state.sel.b && a.floor === state.sel.f && state.where === 'finder';
    try { complex.hoverFloor ? complex.hoverFloor(a && !same ? a.building : null, a && !same ? a.floor : null) : (a ? highlight(a.building, a.floor) : restore()); } catch (e) { /* optional */ }
    onState('hover', a);
    kick();
  }
  function restore() { highlight(state.sel.b, state.where === 'finder' ? state.sel.f : null); }
  function bindPointer(c) {
    const SLOP = 10;
    let down = null; let lastMove = 0;
    c.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      const touch = e.pointerType !== 'mouse';
      down = { x: e.clientX, y: e.clientY, az: orbit.az, t: e.timeStamp, moved: 0, id: e.pointerId, touch };   // event time, not handler time: a slow frame must not turn a tap into a "long press"
      state.pointerDown = true;
      if (state.where === 'hero') { orbit.drag = down; down.daz = orbit.daz || 0; if (home && !live) setLive(true, 'pointer'); }
      if (touch) preview(pick(e.clientX, e.clientY, true));   // finger down: show which floor a tap would choose
    });
    c.addEventListener('pointermove', e => {
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x; down.moved = Math.max(down.moved, Math.hypot(dx, e.clientY - down.y));
        if (down.touch && down.moved > SLOP) preview(null);         // it became a scroll / drag, not a tap
        if (state.where === 'hero' && orbit.drag) { orbit.az = down.az - dx * 0.006; orbit.daz = down.daz - dx * 0.006; orbit.idleT = 0; kick(); }
        return;
      }
      if (e.pointerType !== 'mouse') return;
      if (state.where === 'hero' && home && !live) { c.style.cursor = 'grab'; return; }   // the still is showing: no hover band until the visitor takes over
      if (state.where === 'hero') orbit.idleT = Math.min(orbit.idleT, RETURN_AFTER - 2.5);   // a moving mouse keeps the model live a little longer
      const now = performance.now(); if (now - lastMove < 50) return; lastMove = now;
      const a = pick(e.clientX, e.clientY);
      c.style.cursor = a ? 'pointer' : (state.where === 'hero' ? 'grab' : 'default');
      preview(a);
    });
    const end = (e, cancelled) => {
      if (!down || (e && e.pointerId !== down.id)) return;
      const d = down; down = null; state.pointerDown = false; orbit.drag = null; orbit.idleT = 0;
      const wasTap = !cancelled && d.moved <= SLOP && (e ? e.timeStamp - d.t : 0) < 800;
      let a = null;
      if (wasTap) a = pick(e.clientX, e.clientY, d.touch) || (d.touch && state.hoverFloor ? parseKey(state.hoverFloor) : null);
      if (d.touch) preview(null);
      if (validAct(a)) {
        state.sel = { b: a.building, f: a.floor };
        if (state.where === 'finder') highlight(a.building, a.floor);
        onFloor(a.building, a.floor, state.where);
      }
    };
    const parseKey = k => { const [building, f] = k.split(':'); return act(building, +f); };
    c.addEventListener('pointerup', e => end(e, false));
    c.addEventListener('pointercancel', e => end(e, true));
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !down) preview(null); });
    c.addEventListener('contextmenu', e => { if (down?.touch) e.preventDefault(); });
  }

  function disposeGL() {
    try { complex?.dispose?.(); env?.dispose?.(); renderer?.dispose?.(); renderer?.domElement?.remove(); } catch (e) { /* ignore */ }
  }

  return {
    init,
    get ready() { return ready; },
    get failed() { return failed; },
    relayout() { offKey = ''; resize(true); kick(); },  // call after a language (direction) change
    setMode(m) { state.mode = m; try { env?.setMode?.(m); if (renderer) renderer.toneMappingExposure = EXPOSURE[m] || 1; } catch (e) {} warmT = 1.5; kick(); },
    get live() { return live; },
    goLive() { if (ready && state.where === 'hero' && home) setLive(true, 'api'); },
    // Finder selection: frame this building/floor and outline it
    focusFloor(b, f) {
      if (!okB(b)) return;
      f = clampFloor(b, f);
      state.sel = { b, f };
      if (!ready) return;
      if (state.where === 'finder') highlight(b, f);
      kick();
    },
    // chip hover (desktop) → lighter preview band on the 3D
    previewFloor(b, f) {
      if (!ready || state.where !== 'finder') return;
      const off = f == null || !okB(b) || !floorsOf(b).includes(+f) || (b === state.sel.b && +f === state.sel.f);
      try { complex.hoverFloor?.(off ? null : b, off ? null : +f); } catch (e) {}
      kick();
    },
    highlightUnits(ids) { try { complex?.setUnitHighlight?.(ids && ids.length ? ids : null); } catch (e) {} kick(); },
    pause() { state.paused = true; cancelAnimationFrame(raf); raf = 0; },
    resume() { state.paused = false; kick(); },
    dispose() { this.pause(); io.disconnect(); ro.disconnect(); nearIo?.disconnect(); document.removeEventListener('vrc:hero3d', onHeroEvt); document.removeEventListener('vrc:hero3d-stills', onStillsEvt); disposeGL(); ready = false; },
  };
}
