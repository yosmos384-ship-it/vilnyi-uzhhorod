// ЖК VILNYI (Ужгород) — sound and picture inside a flat of the walkthrough (V18, owner's instructions of 10 October).
// Loaded by walk.js only when the visitor first stands in a flat (nothing of it is downloaded before).
//
// RADIO: a Ukrainian FM station starts as the visitor enters a flat — the same real stations and live HTTPS streams as the
// car radio (radio.js STATIONS; nothing is stored in the site). A station scanner (‹ name ›) and a mute button stay on screen
// while the visitor is inside; the mute choice and the station are remembered for the browser session (sessionStorage).
// Sound: clean stereo through one <audio> element. (Routing it through a WebAudio panner placed at the flat's in-wall
// speakers would need CORS headers that 9 of the 11 stations do not send — the browser would then play silence.)
// Autoplay: walk.js calls enter() from the frame loop; the page unlocked an <audio> element inside the tap that opened the
// walkthrough (radio.js takes it from window.__vrcAudioPool), and Chromium allows sound after any tap on the page.
//
// TV: every TV of the flat shows the Ukrainian «Квартал 95» — the official YouTube channel «Студія Квартал 95 Online»
// (UCfCVlxInB4VuaDFLGqEQqaA). The channel had no live broadcast when this was built (its /live page is the channel page), so
// the TV plays the channel's own uploads playlist (UU…) through the standard privacy-enhanced YouTube embed — no other
// source, no IPTV. A cross-origin video cannot be a WebGL texture, so the embed is laid over the 3D screen as a CSS-3D
// transformed <iframe> while the screen is in view and nothing stands in front of it (pointer events pass through to the
// 3D view); otherwise the 3D screen shows a channel card. The TV starts muted while the radio plays — one sound at a time:
// a tap on the TV (or the TV button) moves the sound to the TV and pauses the radio; tapping again gives it back. «⤢» opens
// the official embed in a panel with YouTube's own controls (also the fallback when the in-place picture cannot be shown).
import { createRadio, STATIONS } from './radio.js';

export const K95 = {
  name: 'Студія Квартал 95 Online', channelId: 'UCfCVlxInB4VuaDFLGqEQqaA', uploads: 'UUfCVlxInB4VuaDFLGqEQqaA',
  url: 'https://www.youtube.com/@studiya95kvartal', checked: '2026-10-10',
};
export function k95EmbedUrl({ mute = true, controls = false } = {}) {
  const o = typeof location !== 'undefined' && /^https?:/.test(location.origin) ? '&origin=' + encodeURIComponent(location.origin) : '';
  return `https://www.youtube-nocookie.com/embed/videoseries?list=${K95.uploads}&autoplay=1&mute=${mute ? 1 : 0}&controls=${controls ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1${o}`;
}

const SS_MUTE = 'vrc.home.muted', SS_STATION = 'vrc.home.station', SS_SOURCE = 'vrc.home.source';
const ssGet = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };
export const HOME_VOLUME = 0.42;

const CSS = `
.vw-hm{position:absolute;left:50%;transform:translateX(-50%);top:calc(102px + var(--st));z-index:4;display:none;align-items:center;gap:4px;padding:4px;border-radius:999px;background:rgba(14,14,16,.72);border:1px solid rgba(201,164,92,.35);color:#f2ead8;font:12px/1.2 system-ui,-apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:calc(100% - 24px - var(--sl) - var(--sr));pointer-events:auto;touch-action:manipulation}
.vw.inapt .vw-hm{display:flex}
.vw.driving .vw-hm,.vw.m360 .vw-hm{display:none!important}
.vw-hm button{flex:0 0 auto;width:34px;height:34px;border-radius:50%;border:0;background:transparent;color:inherit;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.vw-hm button:hover,.vw-hm button:focus-visible{background:rgba(255,255,255,.1);outline:none}
.vw-hm [data-h=mute]{background:rgba(201,164,92,.18)}
.vw-hm [data-h=mute] .x{display:none}.vw-hm.muted [data-h=mute] .x{display:inline}.vw-hm.muted [data-h=mute] .w{display:none}
.vw-hm .st{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;align-items:center;padding:0 2px;max-width:200px}
.vw-hm .st b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.vw-hm .st i{font-style:normal;opacity:.7;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.vw-hm.live .st i::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#e2483d;margin-inline-end:5px;vertical-align:1px}
.vw-hm [data-h=tv].on{background:#c9a45c;color:#141210}
.vw-hm.tvsrc .st{opacity:.55}
.vw.phone .vw-hm{top:calc(96px + var(--st))}
.vw-tvx{position:absolute;left:0;top:0;width:640px;height:360px;transform-origin:0 0;pointer-events:none;visibility:hidden;z-index:1;background:#000;overflow:hidden}
.vw-tvx iframe{width:100%;height:100%;border:0;display:block;pointer-events:none}
.vw-tvp{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;background:rgba(5,4,3,.8);padding:calc(12px + var(--st)) calc(12px + var(--sr)) calc(12px + var(--sb)) calc(12px + var(--sl))}
.vw-tvp .box{width:min(960px,100%);background:#0d0d0e;border:1px solid rgba(201,164,92,.35);border-radius:12px;overflow:hidden}
.vw-tvp .vid{position:relative;width:100%;aspect-ratio:16/9;background:#000}
.vw-tvp iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.vw-tvp .bar{display:flex;align-items:center;gap:10px;padding:8px 12px;color:#e9e3d6;font-size:12px}
.vw-tvp .bar a{color:#e3c47c}.vw-tvp .bar span{flex:1;min-width:0}
`;
const IC = {
  mute: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="w" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/><path class="x" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  prev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  tv: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8.5 20.5h7M12 17v3.5"/></svg>',
  full: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

// ---------------------------------------------------------------- CSS-3D placement of the embed over the 3D screen
// 3×3 projective map that sends the unit square of the <iframe> (w × h px) to the 4 projected screen corners.
function adj(m) { return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]]; }
function mm(a, b) { const c = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; c[3 * i + j] = s; } return c; }
function mv(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
function basis(p) { const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1]; const v = mv(adj(m), [p[3][0], p[3][1], 1]); return mm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); }
export function quadMatrix3d(w, h, dst) {         // dst: [tl, tr, bl, br] in px → CSS matrix3d() string
  const s = basis([[0, 0], [w, 0], [0, h], [w, h]]), d = basis(dst), t = mm(d, adj(s));
  for (let i = 0; i < 9; i++) t[i] /= t[8];
  return `matrix3d(${t[0]},${t[3]},0,${t[6]},${t[1]},${t[4]},0,${t[7]},0,0,1,0,${t[2]},${t[5]},0,${t[8]})`;
}

// the channel card shown on the 3D screens of the flat while the embed is not laid over them
function channelCard(THREE, t) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 288; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 512, 288); g.addColorStop(0, '#1a1426'); g.addColorStop(1, '#08070b'); x.fillStyle = g; x.fillRect(0, 0, 512, 288);
  x.fillStyle = 'rgba(255,255,255,.06)'; for (let i = 0; i < 9; i++) x.fillRect(0, 30 + i * 30, 512, 1);
  x.fillStyle = '#e8463c'; x.beginPath(); x.roundRect ? x.roundRect(206, 82, 100, 70, 16) : x.rect(206, 82, 100, 70); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(244, 100); x.lineTo(244, 134); x.lineTo(274, 117); x.closePath(); x.fill();
  x.textAlign = 'center'; x.fillStyle = '#fff'; x.font = '700 30px system-ui, Arial, sans-serif'; x.fillText('Квартал 95', 256, 200);
  x.fillStyle = 'rgba(255,255,255,.7)'; x.font = '500 16px system-ui, Arial, sans-serif'; x.fillText(K95.name + ' · YouTube', 256, 228);
  x.fillStyle = 'rgba(227,196,124,.9)'; x.font = '500 14px system-ui, Arial, sans-serif'; x.fillText(String(t('walk.tv.tapHint')).slice(0, 60), 256, 262);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
}

/** host: { THREE, root (.vw), hud, t(key), toast(msg, ms), camera, canvas, blocked(fromVec3, toVec3) → bool, phone() }
 *  → { enter({ unitId, tvs }), leave(), frame(), tapTv(mesh), toggleMute(), next(), prev(), get inside, get muted, get source, refreshTexts(), dispose() } */
export function createHomeMedia(host) {
  const { THREE } = host;
  let R = null, inside = false, unitId = null, fadeTok = 0, muted = ssGet(SS_MUTE) === '1', source = ssGet(SS_SOURCE) === 'tv' ? 'tv' : 'radio';
  let tvs = [], card = null, ov = null, panel = null, visT = 0, vis = null, disposed = false;
  const style = document.createElement('style'); style.textContent = CSS; host.hud.appendChild(style);
  const pill = document.createElement('div'); pill.className = 'vw-hm'; pill.setAttribute('role', 'group');
  pill.innerHTML = `<button data-h="mute">${IC.mute}</button><button data-h="prev">${IC.prev}</button><div class="st" aria-live="polite"><b></b><i></i></div><button data-h="next">${IC.next}</button><button data-h="tv">${IC.tv}</button><button data-h="full">${IC.full}</button>`;
  host.hud.appendChild(pill);
  for (const n of ['pointerdown', 'pointerup', 'click', 'wheel', 'touchstart']) pill.addEventListener(n, ev => ev.stopPropagation(), { passive: n !== 'click' });
  pill.addEventListener('click', ev => {
    const b = ev.target.closest('[data-h]'); if (!b) return;
    const k = b.dataset.h;
    if (k === 'mute') api.toggleMute(); else if (k === 'prev') api.prev(); else if (k === 'next') api.next();
    else if (k === 'tv') api.setSource(source === 'tv' ? 'radio' : 'tv'); else if (k === 'full') api.openPanel();
  });
  const q = s => pill.querySelector(s);

  const radio = () => {
    if (R || disposed) return R;
    try { R = createRadio({ stations: STATIONS, volume: HOME_VOLUME, remember: false, connectMs: 8000 }); R.onChange(render); } catch { R = null; }
    return R;
  };
  const fade = (from, to, ms, then) => {
    const tok = ++fadeTok, t0 = performance.now();
    const step = () => { if (tok !== fadeTok || !R) return; const k = Math.min(1, (performance.now() - t0) / ms); try { R.setDuck(from + (to - from) * k); } catch { /* */ } if (k < 1) setTimeout(step, 40); else if (then) then(); };
    step();
  };
  const want = () => inside && !muted && source === 'radio';
  function radioOn() {
    const r = radio(); if (!r) return;
    if (r.state.on && r.state.status !== 'error') { fade(r.state.duck ?? 1, 1, 500); return; }
    const id = ssGet(SS_STATION) || 'hitfm';
    try { r.setDuck(0); r.setMuted(false); r.tune(id); } catch { return; }
    fade(0, 1, 1400);
  }
  function radioOff(ms = 900) { if (!R || !R.state.on) return; fade(R.state.duck ?? 1, 0, ms, () => { try { R.stop(false); } catch { /* */ } render(); }); }
  function sync() { if (want()) radioOn(); else radioOff(); tvSound(inside && !muted && source === 'tv'); render(); }

  function render() {
    if (disposed) return;
    const t = host.t, st = R && R.state, s = st && st.station;
    pill.classList.toggle('muted', muted); pill.classList.toggle('tvsrc', source === 'tv');
    pill.classList.toggle('live', !!(st && st.on && st.status === 'playing' && !muted && source === 'radio'));
    const name = source === 'tv' ? 'Квартал 95' : (s ? s.name : (STATIONS.find(x => x.id === (ssGet(SS_STATION) || 'hitfm')) || STATIONS[0] || {}).name || t('walk.radio.title'));
    q('.st b').textContent = name;
    q('.st i').textContent = muted ? t('walk.home.muted') : source === 'tv' ? t('walk.tv.sound') : !st || !st.on ? t('walk.radio.connecting')
      : (s && s.freq ? s.freq + ' · ' : '') + (st.status === 'playing' ? t('walk.radio.live') : st.status === 'error' ? t('walk.radio.none') : t('walk.radio.connecting'));
    const mb = q('[data-h=mute]'), lab = t(muted ? 'walk.home.unmute' : 'walk.home.mute'); mb.title = lab; mb.setAttribute('aria-label', lab); mb.setAttribute('aria-pressed', String(muted));
    for (const [k, key] of [['prev', 'walk.radio.prev'], ['next', 'walk.radio.next'], ['full', 'walk.tv.open']]) { const b = q(`[data-h=${k}]`); b.title = t(key); b.setAttribute('aria-label', t(key)); }
    const tb = q('[data-h=tv]'); tb.classList.toggle('on', source === 'tv'); tb.title = t(source === 'tv' ? 'walk.tv.radioBack' : 'walk.tv.sound'); tb.setAttribute('aria-label', tb.title); tb.setAttribute('aria-pressed', String(source === 'tv'));
    pill.setAttribute('aria-label', t('walk.home.radio'));
  }

  // ---- the TV picture
  function cmd(fr, func, args = []) { try { fr && fr.contentWindow && fr.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch { /* not ready */ } }
  function tvSound(on) {
    const fr = ov && ov.frame;
    if (fr) { if (on) { cmd(fr, 'unMute'); cmd(fr, 'setVolume', [70]); cmd(fr, 'playVideo'); } else cmd(fr, 'mute'); }
  }
  function ensureOverlay() {
    if (ov || disposed) return ov;
    const wrap = document.createElement('div'); wrap.className = 'vw-tvx'; wrap.setAttribute('aria-hidden', 'true');
    const fr = document.createElement('iframe');
    fr.title = K95.name; fr.allow = 'autoplay; encrypted-media; picture-in-picture'; fr.referrerPolicy = 'strict-origin-when-cross-origin'; fr.loading = 'eager';
    fr.src = k95EmbedUrl({ mute: true });
    fr.addEventListener('load', () => { cmd(fr, 'mute'); setTimeout(() => tvSound(inside && !muted && source === 'tv'), 600); });
    wrap.appendChild(fr);
    host.root.insertBefore(wrap, host.hud);
    ov = { wrap, frame: fr, shown: false };
    return ov;
  }
  function dropOverlay() { if (!ov) return; try { ov.frame.src = 'about:blank'; ov.wrap.remove(); } catch { /* */ } ov = null; }
  function swapScreens(on) {
    for (const T of tvs) {
      const m = T.mesh; if (!m) continue;
      if (on) { if (!m.userData._k95) { m.userData._k95 = { mat: m.material, obr: m.onBeforeRender }; if (!card) card = channelCard(THREE, host.t); m.material = card; m.onBeforeRender = () => {}; } }
      else if (m.userData._k95) { m.material = m.userData._k95.mat; m.onBeforeRender = m.userData._k95.obr; delete m.userData._k95; }
    }
  }
  const _v = new THREE.Vector3(), _c = new THREE.Vector3();
  const CORN = [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]];        // tl, tr, bl, br of the screen plane (local, ±½)
  function projected(mesh) {
    const cam = host.camera, W = host.canvas.clientWidth, H = host.canvas.clientHeight; if (!W || !H) return null;
    mesh.updateWorldMatrix(true, false);
    const out = [];
    for (const [a, b] of CORN) {
      _v.set(a, b, 0).applyMatrix4(mesh.matrixWorld);
      const d = _c.copy(_v).applyMatrix4(cam.matrixWorldInverse); if (d.z > -0.1) return null;    // behind / at the eye
      _v.project(cam); out.push([(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H]);
    }
    return out;
  }
  function visibleTv() {
    const cam = host.camera; let best = null;
    cam.getWorldPosition(_c); const eye = _c.clone();
    for (const T of tvs) {
      const m = T.mesh; if (!m || !m.visible) continue;
      m.getWorldPosition(_v); const dist = eye.distanceTo(_v); if (dist > 9) continue;
      const P = projected(m); if (!P) continue;
      const W = host.canvas.clientWidth, H = host.canvas.clientHeight;
      const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
      if (Math.max(...xs) < 0 || Math.min(...xs) > W || Math.max(...ys) < 0 || Math.min(...ys) > H) continue;
      if (Math.max(...xs) - Math.min(...xs) < 36) continue;
      // nothing in front of it: the walkthrough's colliders between the eye and the centre + four inset corners
      let hid = false;
      for (const [a, b] of [[0, 0], ...CORN.map(([a, b]) => [a * 0.8, b * 0.8])]) { _v.set(a, b, 0.02).applyMatrix4(m.matrixWorld); if (host.blocked(eye, _v.clone())) { hid = true; break; } }
      if (hid) continue;
      if (!best || dist < best.dist) best = { T, dist };
    }
    return best;
  }

  const api = {
    get inside() { return inside; }, get muted() { return muted; }, get source() { return source; }, get unitId() { return unitId; },
    get radio() { return R; }, get overlay() { return ov; },
    enter({ unitId: id, tvs: list } = {}) {
      if (disposed) return;
      const same = inside && id === unitId;
      inside = true; unitId = id; host.root.classList.add('inapt');
      if (!same) { swapScreens(false); tvs = (list || []).filter(T => T && T.mesh); swapScreens(true); }
      sync();
    },
    leave() {
      if (!inside) return;
      inside = false; unitId = null; host.root.classList.remove('inapt');
      radioOff(1100); swapScreens(false); tvs = []; dropOverlay(); api.closePanel(true); vis = null; render();
    },
    /** per animation frame: lay the embed over the TV in view */
    frame() {
      if (!inside || !tvs.length || disposed || panel) { if (ov && ov.shown) { ov.wrap.style.visibility = 'hidden'; ov.shown = false; } return; }
      const now = performance.now();
      if (now - visT > 220) { visT = now; vis = visibleTv(); if (vis) ensureOverlay(); }
      if (!ov) return;
      const P = vis && projected(vis.T.mesh);
      if (!P) { if (ov.shown) { ov.wrap.style.visibility = 'hidden'; ov.shown = false; } return; }
      ov.wrap.style.transform = quadMatrix3d(640, 360, P);
      if (!ov.shown) { ov.wrap.style.visibility = 'visible'; ov.shown = true; }
    },
    setSource(s) { source = s === 'tv' ? 'tv' : 'radio'; ssSet(SS_SOURCE, source); if (source === 'tv' && muted) { muted = false; ssSet(SS_MUTE, '0'); } if (source === 'tv') ensureOverlay(); sync(); host.toast && host.toast(host.t(source === 'tv' ? 'walk.tv.sound' : 'walk.tv.radioBack'), 1400); },
    tapTv() { api.setSource(source === 'tv' ? 'radio' : 'tv'); return true; },
    toggleMute() { muted = !muted; ssSet(SS_MUTE, muted ? '1' : '0'); sync(); return muted; },
    next() { if (source !== 'radio') api.setSource('radio'); const r = radio(); if (!r) return; if (muted) { muted = false; ssSet(SS_MUTE, '0'); } try { r.setDuck(1); r.next(); ssSet(SS_STATION, r.state.station.id); } catch { /* */ } render(); },
    prev() { if (source !== 'radio') api.setSource('radio'); const r = radio(); if (!r) return; if (muted) { muted = false; ssSet(SS_MUTE, '0'); } try { r.setDuck(1); r.prev(); ssSet(SS_STATION, r.state.station.id); } catch { /* */ } render(); },
    openPanel() {
      if (panel || disposed) return;
      const t = host.t, d = document.createElement('div'); d.className = 'vw-tvp'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', K95.name);
      d.innerHTML = `<div class="box"><div class="vid"><iframe allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><div class="bar"><span></span><a target="_blank" rel="noopener"></a><button class="vw-btn vw-gold" data-h="close"></button></div></div>`;
      const fr = d.querySelector('iframe'); fr.title = K95.name; fr.src = k95EmbedUrl({ mute: false, controls: true });
      d.querySelector('.bar span').textContent = t('walk.tv.source'); const a = d.querySelector('.bar a'); a.href = K95.url; a.textContent = 'YouTube';
      d.querySelector('[data-h=close]').textContent = t('walk.tv.close');
      for (const n of ['pointerdown', 'pointerup', 'wheel', 'touchstart', 'keydown']) d.addEventListener(n, ev => ev.stopPropagation(), { passive: n !== 'keydown' });
      d.addEventListener('click', ev => { ev.stopPropagation(); if (ev.target === d || ev.target.closest('[data-h=close]')) api.closePanel(); });
      host.hud.appendChild(d); panel = d;
      radioOff(400); tvSound(false);                                    // one sound at a time: the panel has it
      setTimeout(() => { try { d.querySelector('[data-h=close]').focus(); } catch { /* */ } }, 50);
    },
    closePanel(quiet = false) { if (!panel) return; try { panel.querySelector('iframe').src = 'about:blank'; panel.remove(); } catch { /* */ } panel = null; if (!quiet) sync(); },
    get panelOpen() { return !!panel; },
    refreshTexts() { render(); if (card) { try { card.map.dispose(); card.dispose(); } catch { /* */ } card = null; if (inside) { swapScreens(false); swapScreens(true); } } },
    dispose() {
      disposed = true; fadeTok++; swapScreens(false); dropOverlay(); if (panel) { try { panel.remove(); } catch { /* */ } panel = null; }
      if (R) { try { R.dispose(); } catch { /* */ } } R = null; try { pill.remove(); style.remove(); } catch { /* */ }
      if (card) { try { card.map.dispose(); card.dispose(); } catch { /* */ } card = null; }
      host.root.classList.remove('inapt');
    },
  };
  render();
  return api;
}
