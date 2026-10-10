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
// V19 (v0.7): the TV is a real TV — a remote lies on the coffee table / by the sofa (tap = pick it up): power, channel ▲▼,
// number keys, volume ± and mute, with the channel number + name shown on the screen like a TV's on-screen display.
// Channels = Ukrainian broadcasters' OWN official YouTube channels only (tv-channels.js: live broadcasts, uploads, and on
// channel 9 a different Kvartal 95 episode in every flat). The state (power, channel, volume, mute) lasts for the session.
import { createRadio, STATIONS } from './radio.js';
import { CHANNELS, K95_CHANNEL, channelUrl, channelPage } from './tv-channels.js';
import { UNITS } from '../data.js';

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
.vw-tvx .osd{position:absolute;left:26px;top:22px;display:flex;align-items:baseline;gap:14px;color:#fff;font:700 54px/1 system-ui,-apple-system,Segoe UI,Arial,sans-serif;text-shadow:0 2px 6px rgba(0,0,0,.85),0 0 2px #000;opacity:0;transition:opacity .35s;pointer-events:none}
.vw-tvx .osd b{color:#7dff8a;font-weight:800;min-width:1.2em}.vw-tvx .osd span{font-size:30px;font-weight:600}.vw-tvx .osd i{font:700 16px/1 system-ui,Arial,sans-serif;background:#e2483d;padding:4px 7px;border-radius:4px;align-self:center;font-style:normal}
.vw-tvx .osd.on,.vw-tvx .vol.on{opacity:1}
.vw-tvx .vol{position:absolute;left:60px;right:60px;bottom:34px;height:30px;display:flex;align-items:center;gap:12px;color:#fff;font:700 22px/1 system-ui,Arial,sans-serif;text-shadow:0 2px 4px #000;opacity:0;transition:opacity .35s;pointer-events:none}
.vw-tvx .vol .bar{flex:1;height:12px;border-radius:6px;background:rgba(255,255,255,.25);overflow:hidden;box-shadow:0 0 0 2px rgba(0,0,0,.4)}.vw-tvx .vol .bar u{display:block;height:100%;background:#7dff8a}
.vw-tvx .off{position:absolute;inset:0;background:#000;display:none}.vw-tvx.pwoff .off{display:block}
.vw-rc{position:absolute;right:calc(12px + var(--sr));bottom:calc(96px + var(--sb));z-index:7;width:156px;padding:12px 12px 14px;border-radius:26px 26px 34px 34px;background:linear-gradient(#26262a,#141416);border:1px solid #3a3a40;box-shadow:0 14px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);color:#eee;font:12px/1.2 system-ui,-apple-system,Segoe UI,Arial,sans-serif;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.vw.phone .vw-rc{right:auto;left:50%;transform:translateX(-50%);bottom:calc(84px + var(--sb));width:min(300px,calc(100% - 24px));border-radius:22px}
.vw-rc .lcd{background:#0b1a10;border:1px solid #23402a;border-radius:8px;padding:6px 8px;margin-bottom:9px;color:#8dffa0;font:600 13px/1.25 ui-monospace,Menlo,Consolas,monospace;min-height:34px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.vw-rc .lcd b{font-size:15px}.vw-rc .lcd span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vw-rc .top,.vw-rc .num,.vw-rc .rck{display:grid;gap:7px}.vw-rc .top{grid-template-columns:repeat(3,1fr);margin-bottom:9px}.vw-rc .num{grid-template-columns:repeat(3,1fr);margin-bottom:9px}.vw-rc .rck{grid-template-columns:1fr 1fr}
.vw.phone .vw-rc .num{grid-template-columns:repeat(5,1fr)}.vw.phone .vw-rc .rck{grid-template-columns:repeat(4,1fr)}
.vw-rc button{height:34px;border:0;border-radius:17px;background:#38383e;color:#f1f1f1;font:600 13px/1 system-ui,Arial,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px;box-shadow:inset 0 -2px 0 rgba(0,0,0,.35)}
.vw-rc button:active,.vw-rc button.hit{background:#55555d;transform:translateY(1px)}
.vw-rc button:focus-visible{outline:2px solid #c9a45c;outline-offset:1px}
.vw-rc [data-r=power]{background:#b8322a;color:#fff}.vw-rc [data-r=close]{background:#2a2a2f;color:#c9a45c}
.vw-rc [data-r=mute].on{background:#c9a45c;color:#141210}
.vw-rc .rck button{border-radius:10px;font-size:12px}
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

// the channel card shown on the 3D screens of the flat while the embed is not laid over them: number + name like an OSD
function channelCard(THREE, t, ch) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 288; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 512, 288); g.addColorStop(0, '#16202c'); g.addColorStop(1, '#07080b'); x.fillStyle = g; x.fillRect(0, 0, 512, 288);
  x.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < 9; i++) x.fillRect(0, 30 + i * 30, 512, 1);
  x.fillStyle = '#e8463c'; x.beginPath(); x.roundRect ? x.roundRect(206, 92, 100, 70, 16) : x.rect(206, 92, 100, 70); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(244, 110); x.lineTo(244, 144); x.lineTo(274, 127); x.closePath(); x.fill();
  x.textAlign = 'left'; x.fillStyle = '#7dff8a'; x.font = '800 44px system-ui, Arial, sans-serif'; x.fillText(String(ch.n), 22, 58);
  x.fillStyle = '#fff'; x.font = '700 30px system-ui, Arial, sans-serif'; x.fillText(ch.name, 22 + 30 * String(ch.n).length + 14, 56);
  x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,.72)'; x.font = '500 15px system-ui, Arial, sans-serif'; x.fillText((ch.mode === 'live' ? '● LIVE · ' : '') + 'YouTube ' + ch.handle, 256, 204);
  x.fillStyle = 'rgba(227,196,124,.9)'; x.font = '500 14px system-ui, Arial, sans-serif'; x.fillText(String(t('walk.tv.tapHint')).slice(0, 60), 256, 258);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
}
const SS_TV = 'vrc.tv';
function tvLoad() { try { const o = JSON.parse(sessionStorage.getItem(SS_TV) || 'null'); if (o && typeof o === 'object') return o; } catch { /* */ } return null; }
function tvSave(st) { try { sessionStorage.setItem(SS_TV, JSON.stringify(st)); } catch { /* private mode */ } }
const RC_IC = {
  power: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
  mute: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/** host: { THREE, root (.vw), hud, t(key), toast(msg, ms), camera, canvas, blocked(fromVec3, toVec3) → bool, phone() }
 *  → { enter({ unitId, tvs }), leave(), frame(), tapTv(mesh), toggleMute(), next(), prev(), get inside, get muted, get source, refreshTexts(), dispose(),
 *      V19: openRemote(proxy), closeRemote(), press(key), power(on), setChannel(n), chUp(), chDown(), volUp(), volDown(), tvMute(), tv (state) } */
export function createHomeMedia(host) {
  const { THREE } = host;
  let R = null, inside = false, unitId = null, unitIndex = 0, fadeTok = 0, muted = ssGet(SS_MUTE) === '1', source = ssGet(SS_SOURCE) === 'tv' ? 'tv' : 'radio';
  let tvs = [], ov = null, panel = null, visT = 0, vis = null, disposed = false, rc = null, rcProxy = null, digits = '', digT = 0, osdT = 0, volT = 0;
  const cards = new Map(); let offMat = null;
  const saved = tvLoad() || {};
  const TV = { power: saved.power !== false, ch: CHANNELS.some(c => c.n === saved.ch) ? saved.ch : K95_CHANNEL, vol: Number.isFinite(saved.vol) ? Math.max(0, Math.min(100, saved.vol)) : 60, mute: !!saved.mute, fallback: false };
  const chan = () => CHANNELS.find(c => c.n === TV.ch) || CHANNELS[0];
  const persist = () => tvSave({ power: TV.power, ch: TV.ch, vol: TV.vol, mute: TV.mute });
  const style = document.createElement('style'); style.textContent = CSS; host.hud.appendChild(style);
  const pill = document.createElement('div'); pill.className = 'vw-hm'; pill.setAttribute('role', 'group');
  pill.innerHTML = `<button data-h="mute">${IC.mute}</button><button data-h="prev">${IC.prev}</button><div class="st" aria-live="polite"><b></b><i></i></div><button data-h="next">${IC.next}</button><button data-h="tv">${IC.tv}</button><button data-h="full">${IC.full}</button>`;
  host.hud.appendChild(pill);
  const stopAll = (el) => { for (const n of ['pointerdown', 'pointerup', 'click', 'wheel', 'touchstart']) el.addEventListener(n, ev => ev.stopPropagation(), { passive: n !== 'click' }); };
  stopAll(pill);
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
  const tvAudible = () => inside && !muted && source === 'tv' && TV.power;
  function sync() { if (want()) radioOn(); else radioOff(); tvSound(tvAudible()); render(); }

  function render() {
    if (disposed) return;
    const t = host.t, st = R && R.state, s = st && st.station, ch = chan();
    pill.classList.toggle('muted', muted); pill.classList.toggle('tvsrc', source === 'tv');
    pill.classList.toggle('live', !!(st && st.on && st.status === 'playing' && !muted && source === 'radio'));
    const name = source === 'tv' ? ch.n + ' · ' + ch.name : (s ? s.name : (STATIONS.find(x => x.id === (ssGet(SS_STATION) || 'hitfm')) || STATIONS[0] || {}).name || t('walk.radio.title'));
    q('.st b').textContent = name;
    q('.st i').textContent = muted ? t('walk.home.muted') : source === 'tv' ? (TV.power ? t('walk.tv.sound') : t('walk.tv.off')) : !st || !st.on ? t('walk.radio.connecting')
      : (s && s.freq ? s.freq + ' · ' : '') + (st.status === 'playing' ? t('walk.radio.live') : st.status === 'error' ? t('walk.radio.none') : t('walk.radio.connecting'));
    const mb = q('[data-h=mute]'), lab = t(muted ? 'walk.home.unmute' : 'walk.home.mute'); mb.title = lab; mb.setAttribute('aria-label', lab); mb.setAttribute('aria-pressed', String(muted));
    for (const [k, key] of [['prev', 'walk.radio.prev'], ['next', 'walk.radio.next'], ['full', 'walk.tv.open']]) { const b = q(`[data-h=${k}]`); b.title = t(key); b.setAttribute('aria-label', t(key)); }
    const tb = q('[data-h=tv]'); tb.classList.toggle('on', source === 'tv'); tb.title = t(source === 'tv' ? 'walk.tv.radioBack' : 'walk.tv.sound'); tb.setAttribute('aria-label', tb.title); tb.setAttribute('aria-pressed', String(source === 'tv'));
    pill.setAttribute('aria-label', t('walk.home.radio'));
    renderRc();
  }

  // ---- the TV picture
  function cmd(fr, func, args = []) { try { fr && fr.contentWindow && fr.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch { /* not ready */ } }
  function tvSound(on) {
    const fr = ov && ov.frame;
    if (fr) { if (on && !TV.mute) { cmd(fr, 'unMute'); cmd(fr, 'setVolume', [TV.vol]); cmd(fr, 'playVideo'); } else cmd(fr, 'mute'); }
  }
  const origin = () => (typeof location !== 'undefined' && /^https?:/.test(location.origin) ? location.origin : '');
  const curUrl = (o = {}) => channelUrl(chan(), { unitIndex, mute: true, fallback: TV.fallback, origin: origin(), ...o });
  function ensureOverlay() {
    if (ov || disposed || !TV.power) return ov;
    const wrap = document.createElement('div'); wrap.className = 'vw-tvx'; wrap.setAttribute('aria-hidden', 'true');
    const fr = document.createElement('iframe');
    fr.title = chan().name; fr.allow = 'autoplay; encrypted-media; picture-in-picture'; fr.referrerPolicy = 'strict-origin-when-cross-origin'; fr.loading = 'eager';
    fr.addEventListener('load', () => {
      try { fr.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'vrc-tv', channel: 'widget' }), '*'); } catch { /* */ }
      cmd(fr, 'mute'); setTimeout(() => tvSound(tvAudible()), 600);
    });
    fr.src = curUrl();
    const osd = document.createElement('div'); osd.className = 'osd';
    const vol = document.createElement('div'); vol.className = 'vol'; vol.innerHTML = '<span></span><div class="bar"><u></u></div>';
    const off = document.createElement('div'); off.className = 'off';
    wrap.append(fr, osd, vol, off);
    host.root.insertBefore(wrap, host.hud);
    ov = { wrap, frame: fr, osd, vol, shown: false };
    showOsd();
    return ov;
  }
  function dropOverlay() { if (!ov) return; try { ov.frame.src = 'about:blank'; ov.wrap.remove(); } catch { /* */ } ov = null; }
  // YouTube's player answers the 'listening' handshake with events; onError on a live channel (no broadcast right now /
  // not embeddable) → the same channel's own uploads playlist
  const onMsg = (ev) => {
    if (!ov || ev.source !== ov.frame.contentWindow) return;
    let d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
    if (!d || typeof d !== 'object') return;
    if (d.event === 'onError' && chan().mode === 'live' && !TV.fallback) { TV.fallback = true; ov.frame.src = curUrl(); }
    if (d.event === 'onReady' || d.event === 'initialDelivery') tvSound(tvAudible());
  };
  window.addEventListener('message', onMsg);
  function showOsd() {
    const ch = chan();
    if (ov) {
      ov.osd.innerHTML = ''; const b = document.createElement('b'), sp = document.createElement('span'); b.textContent = ch.n; sp.textContent = ch.name; ov.osd.append(b, sp);
      if (ch.mode === 'live' && !TV.fallback) { const i = document.createElement('i'); i.textContent = host.t('walk.tv.liveBadge'); ov.osd.append(i); }
      ov.osd.classList.add('on'); clearTimeout(osdT); osdT = setTimeout(() => ov && ov.osd.classList.remove('on'), 3200);
    }
    renderRc();
  }
  function showVol() {
    if (ov) { ov.vol.querySelector('span').textContent = TV.mute ? host.t('walk.tv.muteOsd') : String(TV.vol); ov.vol.querySelector('u').style.width = (TV.mute ? 0 : TV.vol) + '%'; ov.vol.classList.add('on'); clearTimeout(volT); volT = setTimeout(() => ov && ov.vol.classList.remove('on'), 2200); }
    renderRc();
  }
  function cardOf(ch) { let c = cards.get(ch.n); if (!c) { c = channelCard(THREE, host.t, ch); cards.set(ch.n, c); } return c; }
  function screenMat() { if (!TV.power) { if (!offMat) offMat = new THREE.MeshBasicMaterial({ color: '#050506' }); return offMat; } return cardOf(chan()); }
  function swapScreens(on) {
    for (const T of tvs) {
      const m = T.mesh; if (!m) continue;
      if (on) { if (!m.userData._k95) { m.userData._k95 = { mat: m.material, obr: m.onBeforeRender }; m.onBeforeRender = () => {}; } m.material = screenMat(); }
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
      let hid = false;
      for (const [a, b] of [[0, 0], ...CORN.map(([a, b]) => [a * 0.8, b * 0.8])]) { _v.set(a, b, 0.02).applyMatrix4(m.matrixWorld); if (host.blocked(eye, _v.clone())) { hid = true; break; } }
      if (hid) continue;
      if (!best || dist < best.dist) best = { T, dist };
    }
    return best;
  }

  // ---- the remote control (HTML, shown while the visitor holds the remote)
  function renderRc() {
    if (!rc) return;
    const t = host.t, ch = chan();
    rc.querySelector('.lcd b').textContent = TV.power ? (digits ? digits + '_' : String(ch.n)) : t('walk.tv.off');
    rc.querySelector('.lcd span').textContent = TV.power ? ch.name + (TV.mute ? ' · ' + t('walk.tv.muteOsd') : ' · ' + t('walk.tv.vol') + ' ' + TV.vol) : '';
    rc.querySelector('[data-r=mute]').classList.toggle('on', TV.mute);
    for (const [k, key] of [['power', 'walk.tv.power'], ['mute', 'walk.tv.mute'], ['close', 'walk.tv.putDown'], ['chUp', 'walk.tv.chUp'], ['chDown', 'walk.tv.chDown'], ['volUp', 'walk.tv.volUp'], ['volDown', 'walk.tv.volDown']]) { const b = rc.querySelector(`[data-r=${k}]`); if (b) { b.title = t(key); b.setAttribute('aria-label', t(key)); } }
    rc.setAttribute('aria-label', t('walk.tv.remote'));
  }
  function buildRc() {
    const d = document.createElement('div'); d.className = 'vw-rc'; d.setAttribute('role', 'dialog');
    d.innerHTML = `<div class="lcd" aria-live="polite"><b></b><span></span></div>
      <div class="top"><button data-r="power">${RC_IC.power}</button><button data-r="mute">${RC_IC.mute}</button><button data-r="close">${RC_IC.close}</button></div>
      <div class="num">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => `<button data-r="d${n}">${n}</button>`).join('')}</div>
      <div class="rck"><button data-r="chUp">CH ▲</button><button data-r="volUp">VOL +</button><button data-r="chDown">CH ▼</button><button data-r="volDown">VOL −</button></div>`;
    stopAll(d);
    for (const n of ['keydown']) d.addEventListener(n, ev => ev.stopPropagation());
    d.addEventListener('click', ev => { const b = ev.target.closest('[data-r]'); if (!b) return; b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); api.press(b.dataset.r); });
    host.hud.appendChild(d); rc = d; renderRc();
    setTimeout(() => { try { d.querySelector('[data-r=power]').focus({ preventScroll: true }); } catch { /* */ } }, 30);
  }
  const takeSound = () => { if (TV.power && source !== 'tv') { source = 'tv'; ssSet(SS_SOURCE, 'tv'); if (muted) { muted = false; ssSet(SS_MUTE, '0'); } sync(); } };
  function applyChannel() {
    TV.fallback = false; persist();
    if (ov) { ov.frame.title = chan().name; ov.frame.src = curUrl(); }
    if (inside) swapScreens(true);
    showOsd(); render();
  }

  const api = {
    get inside() { return inside; }, get muted() { return muted; }, get source() { return source; }, get unitId() { return unitId; },
    get radio() { return R; }, get overlay() { return ov; }, get remoteOpen() { return !!rc; },
    get tv() { const ch = chan(); return { power: TV.power, ch: ch.n, name: ch.name, mode: ch.mode, vol: TV.vol, mute: TV.mute, fallback: TV.fallback, unitIndex, url: curUrl(), src: ov ? ov.frame.src : '', osd: ov ? ov.osd.textContent : '', osdOn: !!(ov && ov.osd.classList.contains('on')), lcd: rc ? rc.querySelector('.lcd').textContent : '' }; },
    enter({ unitId: id, tvs: list } = {}) {
      if (disposed) return;
      const same = inside && id === unitId;
      inside = true; unitId = id; host.root.classList.add('inapt');
      unitIndex = Math.max(0, UNITS.findIndex(u => u.id === id));
      if (!same) { swapScreens(false); tvs = (list || []).filter(T => T && T.mesh); swapScreens(true); if (ov) ov.frame.src = curUrl(); }
      sync();
    },
    leave() {
      if (!inside) return;
      api.closeRemote();
      inside = false; unitId = null; host.root.classList.remove('inapt');
      radioOff(1100); swapScreens(false); tvs = []; dropOverlay(); api.closePanel(true); vis = null; render();
    },
    /** per animation frame: lay the embed over the TV in view */
    frame() {
      if (!inside || !tvs.length || disposed || panel || !TV.power) { if (ov && ov.shown) { ov.wrap.style.visibility = 'hidden'; ov.shown = false; } return; }
      const now = performance.now();
      if (now - visT > 220) { visT = now; vis = visibleTv(); if (vis) ensureOverlay(); }
      if (!ov) return;
      const P = vis && projected(vis.T.mesh);
      if (!P) { if (ov.shown) { ov.wrap.style.visibility = 'hidden'; ov.shown = false; } return; }
      ov.wrap.style.transform = quadMatrix3d(640, 360, P);
      if (!ov.shown) { ov.wrap.style.visibility = 'visible'; ov.shown = true; }
    },
    setSource(s) { source = s === 'tv' ? 'tv' : 'radio'; ssSet(SS_SOURCE, source); if (source === 'tv' && muted) { muted = false; ssSet(SS_MUTE, '0'); } if (source === 'tv' && !TV.power) { TV.power = true; persist(); swapScreens(inside); } if (source === 'tv') ensureOverlay(); sync(); host.toast && host.toast(host.t(source === 'tv' ? 'walk.tv.sound' : 'walk.tv.radioBack'), 1400); },
    tapTv() { if (!TV.power) { api.power(true); return true; } api.setSource(source === 'tv' ? 'radio' : 'tv'); showOsd(); return true; },
    toggleMute() { muted = !muted; ssSet(SS_MUTE, muted ? '1' : '0'); sync(); return muted; },
    next() { if (source !== 'radio') api.setSource('radio'); const r = radio(); if (!r) return; if (muted) { muted = false; ssSet(SS_MUTE, '0'); } try { r.setDuck(1); r.next(); ssSet(SS_STATION, r.state.station.id); } catch { /* */ } render(); },
    prev() { if (source !== 'radio') api.setSource('radio'); const r = radio(); if (!r) return; if (muted) { muted = false; ssSet(SS_MUTE, '0'); } try { r.setDuck(1); r.prev(); ssSet(SS_STATION, r.state.station.id); } catch { /* */ } render(); },
    // ---- V19: TV + remote
    power(on) {
      const want = on === undefined ? !TV.power : !!on; if (want === TV.power) return;
      TV.power = want; persist();
      if (!want) { dropOverlay(); if (source === 'tv') { source = 'radio'; ssSet(SS_SOURCE, 'radio'); } }
      else { source = 'tv'; ssSet(SS_SOURCE, 'tv'); if (muted) { muted = false; ssSet(SS_MUTE, '0'); } ensureOverlay(); }
      if (inside) swapScreens(true);
      sync(); if (want) showOsd(); renderRc();
    },
    setChannel(n) { const ch = CHANNELS.find(c => c.n === +n); if (!ch) { digits = ''; renderRc(); return false; } if (!TV.power) { TV.power = true; ensureOverlay(); } TV.ch = ch.n; takeSound(); applyChannel(); return true; },
    chUp() { const i = CHANNELS.findIndex(c => c.n === TV.ch); api.setChannel(CHANNELS[(i + 1) % CHANNELS.length].n); },
    chDown() { const i = CHANNELS.findIndex(c => c.n === TV.ch); api.setChannel(CHANNELS[(i - 1 + CHANNELS.length) % CHANNELS.length].n); },
    volUp() { if (!TV.power) return; TV.mute = false; TV.vol = Math.min(100, TV.vol + 10); persist(); takeSound(); tvSound(tvAudible()); showVol(); },
    volDown() { if (!TV.power) return; TV.vol = Math.max(0, TV.vol - 10); persist(); takeSound(); tvSound(tvAudible()); showVol(); },
    tvMute() { if (!TV.power) return; TV.mute = !TV.mute; persist(); if (!TV.mute) takeSound(); tvSound(tvAudible()); showVol(); },
    press(k) {
      if (k === 'close') return api.closeRemote();
      if (k === 'power') return api.power();
      if (k === 'mute') return api.tvMute();
      if (/^d\d$/.test(k)) {
        if (!TV.power) api.power(true);
        digits = (digits + k.slice(1)).slice(-2); clearTimeout(digT); renderRc();
        const go = () => { const n = parseInt(digits, 10); digits = ''; if (!api.setChannel(n)) { host.toast && host.toast(host.t('walk.tv.noChannel'), 1200); renderRc(); } };
        if (digits.length >= 2 || CHANNELS.every(c => c.n < parseInt(digits, 10) * 10)) go(); else digT = setTimeout(go, 1300);
        return;
      }
      if (api[k]) api[k]();
    },
    openRemote(proxy) {
      if (rc || disposed) return;
      rcProxy = proxy || null; try { rcProxy && rcProxy.userData.toggle && rcProxy.userData.toggle(true); } catch { /* */ }
      buildRc(); if (TV.power) { ensureOverlay(); showOsd(); }
    },
    closeRemote() {
      if (!rc) return;
      try { rc.remove(); } catch { /* */ } rc = null; digits = ''; clearTimeout(digT);
      try { rcProxy && rcProxy.userData.toggle && rcProxy.userData.toggle(false); } catch { /* */ } rcProxy = null;
    },
    openPanel() {
      if (panel || disposed) return;
      const t = host.t, ch = chan(), d = document.createElement('div'); d.className = 'vw-tvp'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', ch.name);
      d.innerHTML = `<div class="box"><div class="vid"><iframe allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><div class="bar"><span></span><a target="_blank" rel="noopener"></a><button class="vw-btn vw-gold" data-h="close"></button></div></div>`;
      const fr = d.querySelector('iframe'); fr.title = ch.name; fr.src = curUrl({ mute: false, controls: true });
      d.querySelector('.bar span').textContent = ch.n + ' · ' + String(t('walk.tv.official')).replace('{name}', ch.name); const a = d.querySelector('.bar a'); a.href = channelPage(ch); a.textContent = 'YouTube';
      d.querySelector('[data-h=close]').textContent = t('walk.tv.close');
      for (const n of ['pointerdown', 'pointerup', 'wheel', 'touchstart', 'keydown']) d.addEventListener(n, ev => ev.stopPropagation(), { passive: n !== 'keydown' });
      d.addEventListener('click', ev => { ev.stopPropagation(); if (ev.target === d || ev.target.closest('[data-h=close]')) api.closePanel(); });
      host.hud.appendChild(d); panel = d;
      radioOff(400); tvSound(false);                                    // one sound at a time: the panel has it
      setTimeout(() => { try { d.querySelector('[data-h=close]').focus(); } catch { /* */ } }, 50);
    },
    closePanel(quiet = false) { if (!panel) return; try { panel.querySelector('iframe').src = 'about:blank'; panel.remove(); } catch { /* */ } panel = null; if (!quiet) sync(); },
    get panelOpen() { return !!panel; },
    refreshTexts() { render(); for (const c of cards.values()) { try { c.map.dispose(); c.dispose(); } catch { /* */ } } cards.clear(); if (inside) swapScreens(true); },
    dispose() {
      disposed = true; fadeTok++; api.closeRemote(); swapScreens(false); dropOverlay(); if (panel) { try { panel.remove(); } catch { /* */ } panel = null; }
      window.removeEventListener('message', onMsg); clearTimeout(osdT); clearTimeout(volT); clearTimeout(digT);
      if (R) { try { R.dispose(); } catch { /* */ } } R = null; try { pill.remove(); style.remove(); } catch { /* */ }
      for (const c of cards.values()) { try { c.map.dispose(); c.dispose(); } catch { /* */ } } cards.clear(); if (offMat) offMat.dispose();
      host.root.classList.remove('inapt');
    },
  };
  render();
  return api;
}
